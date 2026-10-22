import { z } from "zod";
import { sha256Hex } from "./digest";
import type { ScoutConfig } from "./scoutClient";

/**
 * 📥 Inbox client (packet DT-6A, planning/tools/36-inbox.md): the Scout Worker's read-only `/social/inbox/*` routes
 * (Instagram conversations, messages, owned media and comments). Every call is a GET with the owner's bearer; the
 * Worker never sends, marks seen or touches the reply automation. Fetched bodies live in memory only
 * (components/social/inbox/useInbox.ts); drafts are the only inbox data the store persists (`inboxDrafts`).
 *
 * Same contract as lib/socialSync (nothing throws, failures are typed), with its own small fetch because `call()`
 * folds the inbox-only codes (no_permission, not_eligible, cursor_invalid, stale) into "upstream".
 */

/** A draft's longest text (characters). */
export const INBOX_DRAFT_MAX = 2000;
/** Drafts kept on this device; the oldest go first. */
export const INBOX_DRAFTS_MAX = 200;
/** Items one list keeps in memory (a local cap: Load more stops here and says so). */
export const INBOX_ITEMS_MAX = 500;

export type Capability =
  | "ok"
  | "no_permission"
  | "token_expired"
  | "rate_limited"
  | "not_eligible"
  | "not_connected"
  | "upstream";

export type InboxErrorCode =
  | "unconfigured"
  | "auth"
  | "network"
  | "not_configured"
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "rate_limited"
  | "not_eligible"
  | "upstream"
  | "cursor_invalid"
  | "stale"
  | "bad_request"
  /** YouTube (DT-6B-1): comments turned off on the video, or the video is gone. */
  | "comments_disabled"
  | "video_not_found";

/** See workers/scout/src/social/inboxRead.ts `Coverage`. */
export const COVERAGES = [
  "more",
  "end",
  "cap",
  "partial",
  "history_unavailable",
  "unavailable",
] as const;
export type Coverage = (typeof COVERAGES)[number];

export interface InboxError {
  code: InboxErrorCode;
  /** On list failures: partial (a later page), unavailable (the first page) or history_unavailable. */
  coverage?: Coverage;
}

/* ---------- schemas (allowlisted fields only: anything else is refused) ---------- */

const Id = z.string().min(1).max(256);
const Name = z.string().max(64);
const When = z.string().max(40).nullable();
const Text = z.string().max(INBOX_DRAFT_MAX);
const CapabilitySchema = z.enum([
  "ok",
  "no_permission",
  "token_expired",
  "rate_limited",
  "not_eligible",
  "not_connected",
  "upstream",
]);
const Direction = z.enum(["in", "out", "unknown"]);
const Person = z.strictObject({ id: Id.optional(), username: Name.optional() });

const AccountSchema = z.strictObject({
  accountId: Id,
  handle: Name.nullable(),
  generation: z.string().regex(/^[0-9a-f]{32}$/),
  capabilities: z.strictObject({ messages: CapabilitySchema, comments: CapabilitySchema }),
});
export type InboxAccount = z.infer<typeof AccountSchema>;

const ConversationSchema = z.strictObject({
  id: Id,
  updatedAt: When,
  participants: z.array(Person).max(10),
});
const MessageSchema = z.strictObject({
  id: Id,
  createdAt: When,
  direction: Direction,
  from: Person.nullable(),
  text: Text,
  kind: z.enum(["text", "story_reply", "story_mention", "share", "unsupported", "empty"]),
});
const MediaSchema = z.strictObject({
  id: Id,
  caption: z.string().max(200).optional(),
  permalink: z
    .string()
    .refine((u) => providerLink(u) === u)
    .optional(),
  timestamp: When,
  commentsCount: z.number().int().min(0),
});
const CommentSchema = z.strictObject({
  id: Id,
  text: Text,
  author: Person.nullable(),
  createdAt: When,
  direction: Direction,
});
export type ConversationItem = z.infer<typeof ConversationSchema>;
export type MessageItem = z.infer<typeof MessageSchema>;
export type MediaItem = z.infer<typeof MediaSchema>;
export type CommentItem = z.infer<typeof CommentSchema>;

const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    accountId: Id,
    generation: z.string().regex(/^[0-9a-f]{32}$/),
    fetchedAt: z.string().max(40),
    items: z.array(item).max(25),
    next: z.string().max(2000).nullable(),
    coverage: z.enum(COVERAGES),
  });
export interface InboxPage<T> {
  accountId: string;
  generation: string;
  fetchedAt: string;
  items: T[];
  next: string | null;
  coverage: Coverage;
}

const parser =
  <T>(schema: z.ZodType<T>) =>
  (raw: unknown): T | null => {
    const r = schema.safeParse(raw);
    return r.success ? r.data : null;
  };
export const parseAccount = parser(AccountSchema);
export const parseConversationsPage = parser<InboxPage<ConversationItem>>(
  pageOf(ConversationSchema),
);
export const parseMessagesPage = parser<InboxPage<MessageItem>>(pageOf(MessageSchema));
export const parseMediaPage = parser<InboxPage<MediaItem>>(pageOf(MediaSchema));
export const parseCommentsPage = parser<InboxPage<CommentItem>>(pageOf(CommentSchema));

/* ---------- scopes, links, drafts ---------- */

export type InboxScopeKind =
  /** Lists (memory). */
  | "conversations"
  | "messages"
  | "media"
  | "comments"
  /** Draft targets (persisted drafts are keyed by these). */
  | "conversation"
  | "comment";

/** One key per Worker origin + stable account id + kind + id (never the handle, never the token). */
export function inboxScope(
  origin: string,
  accountId: string,
  kind: InboxScopeKind,
  id = "",
): string {
  return [origin, accountId, kind, id].map(encodeURIComponent).join("|");
}

/** The configured Worker's origin, or null. */
export function workerOrigin(cfg: ScoutConfig | null): string | null {
  try {
    return cfg ? new URL(cfg.url).origin : null;
  } catch {
    return null;
  }
}

/** Only https links on instagram.com / www.instagram.com, without credentials; anything else is undefined. */
export function providerLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return undefined;
    return host === "instagram.com" || host === "www.instagram.com" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export const validDraft = (text: string): boolean => text.length <= INBOX_DRAFT_MAX;

/* ---------- lists ---------- */

export interface InboxList<T> {
  items: T[];
  next: string | null;
  coverage: Coverage | null;
  error: InboxErrorCode | null;
  fetchedAt: string | null;
}

export const emptyList = <T>(): InboxList<T> => ({
  items: [],
  next: null,
  coverage: null,
  error: null,
  fetchedAt: null,
});

/**
 * A fetched page into a list: a first page (`replace`) starts over, a later one appends the ids not already in
 * (first copy wins). At INBOX_ITEMS_MAX the list stops with coverage "cap".
 */
export function mergePages<T extends { id: string }>(
  list: InboxList<T>,
  page: InboxPage<T>,
  replace = false,
): InboxList<T> {
  const base = replace ? [] : list.items;
  const seen = new Set(base.map((i) => i.id));
  const items = [...base, ...page.items.filter((i) => !seen.has(i.id) && seen.add(i.id))];
  if (items.length >= INBOX_ITEMS_MAX)
    return {
      items: items.slice(0, INBOX_ITEMS_MAX),
      next: null,
      coverage: "cap",
      error: null,
      fetchedAt: page.fetchedAt,
    };
  return {
    items,
    next: page.next,
    coverage: page.coverage,
    error: null,
    fetchedAt: page.fetchedAt,
  };
}

/**
 * A failed read into a list: the items already shown stay (coverage "partial", `next` kept so Load more can try
 * again by hand); with none, the list is "unavailable" (or "history_unavailable"), never an empty account.
 */
export function mergeFailure<T>(list: InboxList<T>, error: InboxError): InboxList<T> {
  if (list.items.length) return { ...list, coverage: "partial", error: error.code };
  return {
    ...emptyList<T>(),
    coverage: error.coverage === "history_unavailable" ? "history_unavailable" : "unavailable",
    error: error.code,
  };
}

/* ---------- transport ---------- */

const CODES: ReadonlySet<string> = new Set<InboxErrorCode>([
  "not_configured",
  "not_connected",
  "no_permission",
  "token_expired",
  "rate_limited",
  "not_eligible",
  "upstream",
  "cursor_invalid",
  "stale",
  "bad_request",
  "comments_disabled",
  "video_not_found",
]);

export type InboxResult<T> = { ok: true; data: T } | { ok: false; error: InboxError };

/** One authenticated GET to the Worker; `{ ok: false }` keeps the inbox code and any list coverage. */
export async function inboxGet(
  cfg: ScoutConfig | null,
  path: string,
  fetchImpl?: typeof fetch,
): Promise<InboxResult<unknown>> {
  if (!cfg) return { ok: false, error: { code: "unconfigured" } };
  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.url}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
  } catch {
    return { ok: false, error: { code: "network" } };
  }
  type Body = { error?: unknown; coverage?: unknown } | null;
  let body: Body;
  try {
    body = (await res.json()) as Body;
  } catch {
    body = null;
  }
  if (res.ok) return body ? { ok: true, data: body } : { ok: false, error: { code: "upstream" } };
  const raw = body?.error;
  const code: InboxErrorCode =
    res.status === 401 || raw === "unauthorized" || raw === "origin" || raw === "auth"
      ? "auth"
      : typeof raw === "string" && CODES.has(raw)
        ? (raw as InboxErrorCode)
        : res.status === 429
          ? "rate_limited"
          : res.status === 400
            ? "bad_request"
            : "upstream";
  const coverage = (COVERAGES as readonly unknown[]).includes(body?.coverage)
    ? (body!.coverage as Coverage)
    : undefined;
  return { ok: false, error: { code, ...(coverage ? { coverage } : {}) } };
}

export type PageResult<T> = { ok: true; page: InboxPage<T> } | { ok: false; error: InboxError };
type Acc = Pick<InboxAccount, "accountId" | "generation">;

const query = (acc: Acc, cursor?: string) =>
  `?${new URLSearchParams({
    account: acc.accountId,
    generation: acc.generation,
    ...(cursor ? { cursor } : {}),
  })}`;

/**
 * One list page. DT-6A-R1 (6A-5): a page is this account's only when it names the account and generation it was
 * asked for; any other identity is `stale` (its rows are never merged).
 */
async function getPage<T>(
  cfg: ScoutConfig | null,
  acc: Acc,
  path: string,
  parse: (raw: unknown) => InboxPage<T> | null,
  fetchImpl?: typeof fetch,
): Promise<PageResult<T>> {
  const r = await inboxGet(cfg, path, fetchImpl);
  if (!r.ok) return r;
  const page = parse(r.data);
  if (!page) return { ok: false, error: { code: "upstream" } };
  if (page.accountId !== acc.accountId || page.generation !== acc.generation)
    return { ok: false, error: { code: "stale" } };
  return { ok: true, page };
}

export async function inboxAccount(
  cfg: ScoutConfig | null,
  fetchImpl?: typeof fetch,
): Promise<{ ok: true; account: InboxAccount } | { ok: false; error: InboxError }> {
  const r = await inboxGet(cfg, "/social/inbox/account", fetchImpl);
  if (!r.ok) return r;
  const account = parseAccount(r.data);
  return account ? { ok: true, account } : { ok: false, error: { code: "upstream" } };
}

export const inboxConversations = (
  cfg: ScoutConfig | null,
  acc: Acc,
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    acc,
    `/social/inbox/conversations${query(acc, cursor)}`,
    parseConversationsPage,
    fetchImpl,
  );

export const inboxMessages = (
  cfg: ScoutConfig | null,
  acc: Acc,
  conversationId: string,
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    acc,
    `/social/inbox/conversations/${encodeURIComponent(conversationId)}/messages${query(acc, cursor)}`,
    parseMessagesPage,
    fetchImpl,
  );

export const inboxMedia = (
  cfg: ScoutConfig | null,
  acc: Acc,
  cursor?: string,
  fetchImpl?: typeof fetch,
) => getPage(cfg, acc, `/social/inbox/media${query(acc, cursor)}`, parseMediaPage, fetchImpl);

export const inboxComments = (
  cfg: ScoutConfig | null,
  acc: Acc,
  mediaId: string,
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    acc,
    `/social/inbox/media/${encodeURIComponent(mediaId)}/comments${query(acc, cursor)}`,
    parseCommentsPage,
    fetchImpl,
  );

/* ---------- Threads and YouTube comment reads (packet DT-6B-1) ---------- */

/**
 * The providers the Inbox reads. Instagram keeps every DT-6A key and route above exactly as they are; Threads and
 * YouTube use `/social/inbox/<provider>/*` (workers/scout/src/social/inboxReadThreads.ts, inboxReadYouTube.ts) and
 * the versioned `inboxScopeV2` namespace.
 */
export type InboxProvider = "instagram" | "threads" | "youtube";
export type CommentProvider = Exclude<InboxProvider, "instagram">;

export type InboxScopeKindV2 =
  /** Lists (memory). */
  | "posts"
  | "replies"
  | "videos"
  | "threads"
  /** Draft target (persisted drafts): one comment or reply. */
  | "comment";

/**
 * A new-provider key: `v2|<provider>|<origin>|<account id>|<kind>|<id>`, each part URI-encoded. A legacy Instagram
 * scope starts with an encoded origin (never the bare "v2"), so the two namespaces cannot collide and old drafts keep
 * resolving under their stored keys.
 */
export function inboxScopeV2(
  provider: CommentProvider,
  origin: string,
  accountId: string,
  kind: InboxScopeKindV2,
  id = "",
): string {
  return ["v2", ...[provider, origin, accountId, kind, id].map(encodeURIComponent)].join("|");
}

const LINK_MAX = 2048;

/** An https link on exactly one of `hosts`, without credentials or port, at most 2,048 characters. */
function exactLink(url: string | undefined, hosts: readonly string[]): string | undefined {
  if (!url || url.length > LINK_MAX) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return undefined;
    if (!hosts.includes(u.hostname.toLowerCase())) return undefined;
    const out = u.toString();
    return out.length <= LINK_MAX ? out : undefined;
  } catch {
    return undefined;
  }
}

export const threadsLink = (url: string | undefined) =>
  exactLink(url, ["www.threads.net", "www.threads.com"]);
export const youtubeLink = (url: string | undefined) =>
  exactLink(url, ["www.youtube.com", "youtu.be"]);

const Gen = z.string().regex(/^[0-9a-f]{32}$/);
const Ref = z.string().min(3).max(1500);

const ThreadsAccountSchema = z.strictObject({
  provider: z.literal("threads"),
  accountId: Id,
  handle: Name.nullable(),
  generation: Gen,
  capabilities: z.strictObject({
    replies: CapabilitySchema,
    /** DT-6B-2B-1: Threads sending is not ready (endpoint permission unverified); absent on older Workers. */
    sendReplies: z.literal("permission_unverified").optional(),
  }),
});
export type ThreadsAccount = z.infer<typeof ThreadsAccountSchema>;

const YouTubeChannelSchema = z.strictObject({
  accountId: Id,
  title: Name.nullable(),
  generation: Gen,
  uploads: Ref.nullable(),
});
export type YouTubeChannel = z.infer<typeof YouTubeChannelSchema>;
const YouTubeAccountSchema = z.strictObject({
  provider: z.literal("youtube"),
  needsSelection: z.boolean(),
  channels: z.array(YouTubeChannelSchema).max(10),
  capabilities: z.strictObject({
    comments: CapabilitySchema,
    /** DT-6B-2A: "ok" only when the stored grant can post replies (youtube.force-ssl); absent on older Workers. */
    sendComments: CapabilitySchema.optional(),
  }),
});
export type YouTubeAccount = z.infer<typeof YouTubeAccountSchema>;

const ThreadsPostSchema = z.strictObject({
  id: Id,
  ref: Ref,
  text: z.string().max(200).optional(),
  permalink: z
    .string()
    .refine((u) => threadsLink(u) === u)
    .optional(),
  timestamp: When,
  mediaType: Name.optional(),
});
const ThreadsReplySchema = z.strictObject({
  id: Id,
  text: Text,
  author: Person.nullable(),
  createdAt: When,
  direction: Direction,
  kind: z.enum(["text", "media"]),
  rootId: Id.optional(),
  parentId: Id.optional(),
  /** DT-6B-2B-1: a direct reply's sealed send target (carried, unused by the app until DT-6B-2B-2). */
  sendRef: Ref.optional(),
});
const YouTubeVideoSchema = z.strictObject({
  id: Id,
  ref: Ref,
  title: z.string().max(200).optional(),
  permalink: z
    .string()
    .refine((u) => youtubeLink(u) === u)
    .optional(),
  timestamp: When,
});
const YouTubeCommentSchema = z.strictObject({
  id: Id,
  text: Text,
  author: Person.nullable(),
  createdAt: When,
  direction: Direction,
  parentId: Id.optional(),
  /** DT-6B-2A: an embedded reply carries its top-level parent's send target, and says so. */
  sendRef: Ref.optional(),
  replyParentNote: z.literal(true).optional(),
});
const YouTubeThreadSchema = z.strictObject({
  id: Id,
  ref: Ref,
  /** DT-6B-2A: the sealed send target of this top-level comment (absent when the Worker could not mint one). */
  sendRef: Ref.optional(),
  comment: YouTubeCommentSchema,
  /** null: YouTube gave no usable count (DT-6B-1-R1 B1-3), so the full reply list is offered, never a made-up 0. */
  totalReplyCount: z.number().int().min(0).nullable(),
  replies: z.array(YouTubeCommentSchema).max(25),
  repliesCoverage: z.literal("embedded"),
});
export type ThreadsPost = z.infer<typeof ThreadsPostSchema>;
export type ThreadsReply = z.infer<typeof ThreadsReplySchema>;
export type YouTubeVideo = z.infer<typeof YouTubeVideoSchema>;
export type YouTubeComment = z.infer<typeof YouTubeCommentSchema>;
export type YouTubeThread = z.infer<typeof YouTubeThreadSchema>;

/** A page that names its provider, account and generation (the response identity the fences check). */
const providerPageOf = <T extends z.ZodType>(provider: CommentProvider, item: T) =>
  z.strictObject({
    provider: z.literal(provider),
    accountId: Id,
    generation: Gen,
    fetchedAt: z.string().max(40),
    items: z.array(item).max(25),
    next: z.string().max(2000).nullable(),
    coverage: z.enum(COVERAGES),
  });

export const parseThreadsAccount = parser(ThreadsAccountSchema);
export const parseYouTubeAccount = parser(YouTubeAccountSchema);
export const parseThreadsPostsPage = parser<InboxPage<ThreadsPost>>(
  providerPageOf("threads", ThreadsPostSchema),
);
export const parseThreadsRepliesPage = parser<InboxPage<ThreadsReply>>(
  providerPageOf("threads", ThreadsReplySchema),
);
export const parseYouTubeVideosPage = parser<InboxPage<YouTubeVideo>>(
  providerPageOf("youtube", YouTubeVideoSchema),
);
export const parseYouTubeThreadsPage = parser<InboxPage<YouTubeThread>>(
  providerPageOf("youtube", YouTubeThreadSchema),
);
export const parseYouTubeRepliesPage = parser<InboxPage<YouTubeComment>>(
  providerPageOf("youtube", YouTubeCommentSchema),
);

const providerAccount =
  <T>(path: string, parse: (raw: unknown) => T | null) =>
  async (
    cfg: ScoutConfig | null,
    fetchImpl?: typeof fetch,
  ): Promise<{ ok: true; account: T } | { ok: false; error: InboxError }> => {
    const r = await inboxGet(cfg, path, fetchImpl);
    if (!r.ok) return r;
    const account = parse(r.data);
    return account ? { ok: true, account } : { ok: false, error: { code: "upstream" } };
  };

export const threadsAccount = providerAccount("/social/inbox/threads/account", parseThreadsAccount);
export const youtubeAccount = providerAccount("/social/inbox/youtube/account", parseYouTubeAccount);

const providerQuery = (acc: Acc, extra: Record<string, string | undefined> = {}) => {
  const params = new URLSearchParams({ account: acc.accountId, generation: acc.generation });
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  return `?${params}`;
};

/** A sealed ref as one path segment. */
const seg = (ref: string) => encodeURIComponent(ref);

/** The provider is checked by the parser (a literal); account and generation by getPage (`stale`). */
export const threadsPosts = (
  cfg: ScoutConfig | null,
  acc: Acc,
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    acc,
    `/social/inbox/threads/posts${providerQuery(acc, { cursor })}`,
    parseThreadsPostsPage,
    fetchImpl,
  );

export const threadsReplies = (
  cfg: ScoutConfig | null,
  acc: Acc,
  postRef: string,
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    acc,
    `/social/inbox/threads/posts/${seg(postRef)}/replies${providerQuery(acc, { cursor })}`,
    parseThreadsRepliesPage,
    fetchImpl,
  );

export const youtubeVideos = (
  cfg: ScoutConfig | null,
  channel: Acc & { uploads: string | null },
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    channel,
    `/social/inbox/youtube/videos${providerQuery(channel, { uploads: channel.uploads ?? "", cursor })}`,
    parseYouTubeVideosPage,
    fetchImpl,
  );

export const youtubeThreads = (
  cfg: ScoutConfig | null,
  acc: Acc,
  videoRef: string,
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    acc,
    `/social/inbox/youtube/videos/${seg(videoRef)}/threads${providerQuery(acc, { cursor })}`,
    parseYouTubeThreadsPage,
    fetchImpl,
  );

export const youtubeReplies = (
  cfg: ScoutConfig | null,
  acc: Acc,
  commentRef: string,
  cursor?: string,
  fetchImpl?: typeof fetch,
) =>
  getPage(
    cfg,
    acc,
    `/social/inbox/youtube/comments/${seg(commentRef)}/replies${providerQuery(acc, { cursor })}`,
    parseYouTubeRepliesPage,
    fetchImpl,
  );

/* ---------- reviewed YouTube replies (packet DT-6B-2A, planning/tools/37-inbox-send.md) ---------- */

/** Where a send operation stands on the Worker (workers/scout/src/social/sendCoordinator.ts). */
export const SEND_STATES = [
  "prepared",
  "dispatching",
  "sent",
  "rejected",
  "unknown",
  "expired",
  "cancelled",
] as const;
export type SendState = (typeof SEND_STATES)[number];

export type SendErrorCode =
  | "unconfigured"
  | "auth"
  | "network"
  | "not_configured"
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "stale"
  | "bad_request"
  | "text_invalid"
  | "target_invalid"
  | "not_public"
  | "not_replyable"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  /** DT-6B-2A-R1 (2A-4), client side only: the answer named another operation, account, revision or text. */
  | "mismatch";

const SEND_CODES: ReadonlySet<string> = new Set<SendErrorCode>([
  "not_configured",
  "not_connected",
  "no_permission",
  "token_expired",
  "stale",
  "bad_request",
  "text_invalid",
  "target_invalid",
  "not_public",
  "not_replyable",
  "not_found",
  "conflict",
  "rate_limited",
  "upstream",
  "receipt_unavailable",
]);
/** What a not_configured answer names as missing. */
export const SEND_SETUP = ["kv", "seal", "receipt-store"] as const;

const Stamp = z.string().max(40);
const SendIntentSchema = z
  .strictObject({
    operationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    provider: z.literal("youtube"),
    account: Id,
    generation: Gen,
    threadId: Id,
    videoId: Id,
    parentCommentId: Id,
    text: z.string().min(1).max(INBOX_DRAFT_MAX),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    draftRevision: z.string().min(1).max(64),
    state: z.enum(SEND_STATES),
    reviewExpiresAt: Stamp,
    createdAt: Stamp,
    updatedAt: Stamp,
    claimedAt: Stamp.optional(),
    settledAt: Stamp.optional(),
    providerCommentId: Id.optional(),
    failureCode: z.string().max(64).optional(),
    failureDetail: z.string().max(300).optional(),
    unknownReason: z.string().max(32).optional(),
  })
  .refine(
    // DT-6B-2A-R1 (2A-4): a settled receipt carries its proof (sent: the new comment's id; rejected: the reason).
    (i) =>
      (i.state !== "sent" || !!i.providerCommentId) && (i.state !== "rejected" || !!i.failureCode),
  );
export type SendIntent = z.infer<typeof SendIntentSchema>;
export const parseSendIntent = parser(SendIntentSchema);

/** The digest the Worker binds a reviewed text to: SHA-256 hex of the trimmed text. */
export const sendDigest = (text: string): string => sha256Hex(text.trim());

const LINK_ID_RE = /^[A-Za-z0-9_.-]{1,256}$/;

/** The public link of one comment under its video, on exactly www.youtube.com; anything else is undefined. */
export function youtubeCommentLink(videoId: string, commentId: string): string | undefined {
  if (!LINK_ID_RE.test(videoId) || !LINK_ID_RE.test(commentId)) return undefined;
  return youtubeLink(
    `https://www.youtube.com/watch?${new URLSearchParams({ v: videoId, lc: commentId })}`,
  );
}

export type SendResult =
  | { ok: true; intent: SendIntent }
  | { ok: false; error: SendErrorCode; detail?: (typeof SEND_SETUP)[number] };

/**
 * What the client already knows about an operation (DT-6B-2A-R1, 2A-4). `operationId` is left out only for Prepare,
 * where the Worker may answer another tab's operation for the same submission (same account, revision and text);
 * Status/Confirm/Cancel always name it. `generation`, `text` and the immutable target (DT-6B-2A-R2, 2A-R1-C: parent
 * comment, video and thread, known once a review was seen) are checked when known; nothing unknown is invented.
 */
export interface SendExpect {
  operationId?: string;
  account: string;
  generation?: string;
  draftRevision: string;
  digest: string;
  text?: string;
  parentCommentId?: string;
  videoId?: string;
  threadId?: string;
}

const KNOWN_WHEN_GIVEN = ["generation", "text", "parentCommentId", "videoId", "threadId"] as const;

/** An answer about anything other than the expected operation is `mismatch`: never shown, never recorded. */
export function bindIntent(r: SendResult, e: SendExpect): SendResult {
  if (!r.ok) return r;
  const i = r.intent;
  const same =
    (e.operationId === undefined || i.operationId === e.operationId) &&
    i.provider === "youtube" &&
    i.account === e.account &&
    i.draftRevision === e.draftRevision &&
    i.digest === e.digest &&
    sendDigest(i.text) === i.digest &&
    KNOWN_WHEN_GIVEN.every((k) => e[k] === undefined || i[k] === e[k]);
  return same ? r : { ok: false, error: "mismatch" };
}

/** One authenticated send call; nothing throws, and only an answer that parses as an intent is a success. */
async function sendCall(
  cfg: ScoutConfig | null,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  fetchImpl?: typeof fetch,
): Promise<SendResult> {
  if (!cfg) return { ok: false, error: "unconfigured" };
  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.url}/social/inbox/youtube/send${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  let data: { intent?: unknown; error?: unknown; detail?: unknown } | null;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    data = null;
  }
  if (res.ok) {
    const intent = parseSendIntent(data?.intent);
    return intent ? { ok: true, intent } : { ok: false, error: "upstream" };
  }
  const raw = data?.error;
  if (res.status === 401 || raw === "unauthorized" || raw === "origin")
    return { ok: false, error: "auth" };
  const error =
    typeof raw === "string" && SEND_CODES.has(raw) ? (raw as SendErrorCode) : "upstream";
  const detail = (SEND_SETUP as readonly unknown[]).includes(data?.detail)
    ? (data!.detail as (typeof SEND_SETUP)[number])
    : undefined;
  return { ok: false, error, ...(error === "not_configured" && detail ? { detail } : {}) };
}

export const prepareSend = (
  cfg: ScoutConfig | null,
  body: { operationId: string; sendRef: string; text: string; draftRevision: string },
  fetchImpl?: typeof fetch,
) => sendCall(cfg, "POST", "/prepare", body, fetchImpl);

export const confirmSend = (
  cfg: ScoutConfig | null,
  body: { operationId: string; digest: string; account: string },
  fetchImpl?: typeof fetch,
) => sendCall(cfg, "POST", "/confirm", body, fetchImpl);

export const sendStatus = (
  cfg: ScoutConfig | null,
  operationId: string,
  account: string,
  fetchImpl?: typeof fetch,
) =>
  sendCall(
    cfg,
    "GET",
    `/${encodeURIComponent(operationId)}?${new URLSearchParams({ account })}`,
    undefined,
    fetchImpl,
  );

export const cancelSend = (
  cfg: ScoutConfig | null,
  operationId: string,
  account: string,
  fetchImpl?: typeof fetch,
) => sendCall(cfg, "POST", `/${encodeURIComponent(operationId)}/cancel`, { account }, fetchImpl);
