import { z } from "zod";
import {
  InboxCommentSchema,
  InboxConversationSchema,
  InboxMessageSchema,
  InboxOverviewSchema,
  InboxPostSchema,
  type InboxComment,
  type InboxConversation,
  type InboxMessage,
  type InboxOverview,
  type InboxPlatform,
  type InboxPost,
} from "./domain";
import type { MessageKey } from "./i18n";
import type { ScoutConfig } from "./scoutClient";
import type { SocialSyncErrorType } from "./socialSync";

/**
 * Client for the Scout Worker's global inbox (`/social/inbox/*`, planning/tools/51-global-inbox.md): the
 * Instagram DMs and comments the every-minute reader keeps in the Worker's InboxStore, read here a page at a
 * time. Same shape as lib/socialSync: bearer token from Settings (`scoutConfig`), nothing throws, failures are
 * a typed `{ ok: false, error }`. Unlike socialSync the body's `error` and `detail` are kept for every refused
 * answer: the inbox codes (`window_closed`, `rejected`...) are the screens' business, not a fixed key table.
 */

/** Instagram's DM text limit, in UTF-8 bytes (not letters: an Arabic letter is two). */
export const DM_TEXT_BYTES = 1000;
/** A comment reply's limit, in characters, per platform. */
export const IG_COMMENT_MAX = 2200;
export const TT_COMMENT_MAX = 150;
/** How often an open thread asks the Worker for news. */
export const INBOX_POLL_MS = 15_000;

export type InboxError = {
  type:
    | SocialSyncErrorType
    | "window_closed"
    | "too_long"
    | "rejected"
    | "no_permission"
    | "not_eligible"
    | "not_available"
    | "not_found";
  detail?: string;
};
export type InboxResult<T> = ({ ok: true } & T) | { ok: false; error: InboxError };

/* ---------- answers ---------- */

/** Every list answers its page, `more`, and `next`: the opaque cursor to hand back as `before`. */
const page = { more: z.boolean(), next: z.string().nullable() };

const OverviewAnswer = InboxOverviewSchema.transform((overview) => ({ overview }));
const ConversationsAnswer = z.object({ conversations: z.array(InboxConversationSchema), ...page });
const ThreadAnswer = z.object({
  conversation: InboxConversationSchema,
  messages: z.array(InboxMessageSchema),
  ...page,
  window: z.object({ open: z.boolean(), closesAt: z.string().nullable() }),
});
const PostsAnswer = z.object({ posts: z.array(InboxPostSchema), ...page });
const CommentsAnswer = z.object({
  post: InboxPostSchema,
  comments: z.array(InboxCommentSchema),
  ...page,
});
const RefreshAnswer = z.object({ scanRequestedAt: z.string() });
const OkAnswer = z.object({ ok: z.literal(true) });
/** What the Worker answers a send with: the stored row (a DM, a public reply) or just the id (a private reply). */
const SendAnswer = z.object({ message: InboxMessageSchema });
const ReplyAnswer = z.object({ reply: InboxCommentSchema });
const PrivateAnswer = z.object({ message: z.object({ id: z.string() }) });

/* ---------- call ---------- */

async function errorFrom(res: Response): Promise<InboxError> {
  if (res.status === 401) return { type: "auth" };
  if (res.status === 429) return { type: "rate_limited" };
  try {
    const body = (await res.json()) as { error?: unknown; detail?: unknown };
    if (body.error === "origin" || body.error === "unauthorized") return { type: "auth" };
    return {
      type: typeof body.error === "string" ? (body.error as InboxError["type"]) : "upstream",
      detail: typeof body.detail === "string" ? body.detail : undefined,
    };
  } catch {
    return { type: "upstream" }; // Not JSON (a Cloudflare error page).
  }
}

/**
 * One authenticated Worker call, its answer checked against `schema`. Exported for the send routes. `sends` marks a
 * call that puts a message out (a DM, a reply): once the request may have left, no answer we can read is not "failed"
 * but unconfirmed (a network error, or a 2xx whose body is not the expected one), so the screen keeps the text and
 * tells the owner to check before sending again. A refused answer (non-2xx) is the Worker's word and stays as it is.
 */
export async function inboxCall<S extends z.ZodType<object>>(
  config: ScoutConfig | null,
  path: string,
  schema: S,
  init: RequestInit = {},
  sends = false,
): Promise<InboxResult<z.infer<S>>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const unreadable = (type: InboxError["type"]): InboxResult<never> => ({
    ok: false,
    error: sends ? { type: "upstream", detail: "unconfirmed" } : { type },
  });
  let res: Response;
  try {
    res = await fetch(`${config.url}/social/inbox${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${config.token}` },
    });
  } catch {
    return unreadable("network");
  }
  if (!res.ok) return { ok: false, error: await errorFrom(res) };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return unreadable("upstream");
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, ...parsed.data } : unreadable("upstream");
}

/** `?platform=&before=`: `all` and a missing cursor are left out; `before` is the Worker's opaque cursor. */
function query(q: { platform?: InboxPlatform | "all"; before?: string }): string {
  const params = new URLSearchParams();
  if (q.platform && q.platform !== "all") params.set("platform", q.platform);
  if (q.before) params.set("before", q.before);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/* ---------- API ---------- */

/** `GET /social/inbox`: per platform, whether it is connected and when the reader last looked. */
export const inboxOverview = (
  config: ScoutConfig | null,
): Promise<InboxResult<{ overview: InboxOverview }>> => inboxCall(config, "", OverviewAnswer);

/** `GET /social/inbox/conversations`: the newest conversations first. */
export const inboxConversations = (
  config: ScoutConfig | null,
  q: { platform?: InboxPlatform | "all"; before?: string },
): Promise<
  InboxResult<{ conversations: InboxConversation[]; more: boolean; next: string | null }>
> => inboxCall(config, `/conversations${query(q)}`, ConversationsAnswer);

/** `GET /social/inbox/conversations/:id`: one conversation, its newest messages, and whether Instagram still lets us reply. */
export const inboxThread = (
  config: ScoutConfig | null,
  id: string,
  q: { before?: string },
): Promise<
  InboxResult<{
    conversation: InboxConversation;
    messages: InboxMessage[];
    more: boolean;
    next: string | null;
    window: { open: boolean; closesAt: string | null };
  }>
> => inboxCall(config, `/conversations/${encodeURIComponent(id)}${query(q)}`, ThreadAnswer);

/** `GET /social/inbox/posts`: the posts with their comment counts, newest first. */
export const inboxPosts = (
  config: ScoutConfig | null,
  q: { platform?: InboxPlatform | "all"; before?: string },
): Promise<InboxResult<{ posts: InboxPost[]; more: boolean; next: string | null }>> =>
  inboxCall(config, `/posts${query(q)}`, PostsAnswer);

/** `GET /social/inbox/posts/:platform/:postId/comments`: one post and its newest comments. */
export const inboxComments = (
  config: ScoutConfig | null,
  platform: InboxPlatform,
  postId: string,
  q: { before?: string },
): Promise<
  InboxResult<{ post: InboxPost; comments: InboxComment[]; more: boolean; next: string | null }>
> =>
  inboxCall(
    config,
    `/posts/${platform}/${encodeURIComponent(postId)}/comments${query(q)}`,
    CommentsAnswer,
  );

/** `POST /social/inbox/refresh`: asks the reader to scan everything on its next tick. */
export const inboxRefresh = (
  config: ScoutConfig | null,
): Promise<InboxResult<{ scanRequestedAt: string }>> =>
  inboxCall(config, "/refresh", RefreshAnswer, { method: "POST" });

/** `DELETE /social/inbox`: empties the Worker's store (the owner's "wipe" in Settings). */
export const inboxWipe = (config: ScoutConfig | null): Promise<InboxResult<{ ok: true }>> =>
  inboxCall(config, "", OkAnswer, { method: "DELETE" });

/* ---------- sends (Instagram only; the Worker has no idempotency guard: callers lock while one is pending) ---------- */

const post = (body: object): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
/** A call that puts a message out (see `inboxCall`'s `sends`). */
const sendText = <S extends z.ZodType<object>>(
  config: ScoutConfig | null,
  path: string,
  schema: S,
  text: string,
) => inboxCall(config, path, schema, post({ text }), true);
const commentPath = (platform: InboxPlatform, id: string) =>
  `/comments/${platform}/${encodeURIComponent(id)}`;

/**
 * `POST /social/inbox/conversations/:id/send`: a DM to the person. The answer's text is clipped for the log, so the
 * thread is read again after a send rather than spliced from it.
 */
export const inboxSend = (
  config: ScoutConfig | null,
  id: string,
  text: string,
): Promise<InboxResult<{ message: InboxMessage }>> =>
  sendText(config, `/conversations/${encodeURIComponent(id)}/send`, SendAnswer, text);

/** `POST /social/inbox/comments/:platform/:id/reply`: a public reply under a comment. */
export const inboxReply = (
  config: ScoutConfig | null,
  platform: InboxPlatform,
  commentId: string,
  text: string,
): Promise<InboxResult<{ reply: InboxComment }>> =>
  sendText(config, `${commentPath(platform, commentId)}/reply`, ReplyAnswer, text);

/** `POST /social/inbox/comments/instagram/:id/private`: a DM to the commenter, by the comment. */
export const inboxPrivate = (
  config: ScoutConfig | null,
  commentId: string,
  text: string,
): Promise<InboxResult<{ message: { id: string } }>> =>
  sendText(config, `${commentPath("instagram", commentId)}/private`, PrivateAnswer, text);

/** `POST /social/inbox/comments/:platform/:id/hide`: hides (`true`) or shows (`false`) a comment. */
export const inboxHide = (
  config: ScoutConfig | null,
  platform: InboxPlatform,
  commentId: string,
  hidden: boolean,
): Promise<InboxResult<{ ok: true }>> =>
  inboxCall(config, `${commentPath(platform, commentId)}/hide`, OkAnswer, post({ hidden }));

/** `DELETE /social/inbox/comments/:platform/:id`: deletes the owner's own comment (another's is `no_permission`). */
export const inboxDelete = (
  config: ScoutConfig | null,
  platform: InboxPlatform,
  commentId: string,
): Promise<InboxResult<{ ok: true }>> =>
  inboxCall(config, commentPath(platform, commentId), OkAnswer, { method: "DELETE" });

/* ---------- helpers ---------- */

const ERROR_KEYS: Partial<Record<InboxError["type"], MessageKey>> = {
  auth: "inbox.err.auth",
  not_found: "inbox.err.notFound",
  rejected: "inbox.err.rejected",
  no_permission: "inbox.err.noPermission",
  not_eligible: "inbox.err.notEligible",
  rate_limited: "inbox.err.rateLimited",
  network: "inbox.err.network",
  not_available: "inbox.notAvailable",
  unconfigured: "inbox.needWorker",
  token_expired: "inbox.tokenExpired",
  window_closed: "inbox.window.closed",
  too_long: "inbox.tooLong",
};

/** The copy for a failed call; any other code (the Worker names it) reads as the platform's problem. */
export const inboxErrorKey = (error: InboxError): MessageKey =>
  (Object.hasOwn(ERROR_KEYS, error.type) && ERROR_KEYS[error.type]) || "inbox.err.upstream";

/** A send the platform may have taken even though no answer came: the owner checks the app before sending again. */
export const isUnconfirmed = (error: InboxError): boolean =>
  error.type === "upstream" && error.detail === "unconfirmed";

/** A text's length in UTF-8 bytes: Instagram's DM limit counts these. */
export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** The key `inboxSeen` keeps a conversation's or post's last-opened time under. */
export const seenKey = (platform: InboxPlatform, kind: "conversation" | "post", id: string) =>
  `${platform}:${kind}:${id}`;

/** How many items are newer than the moment they were last opened (or were never opened). ISO times compare as text. */
export const unreadCount = (
  items: { key: string; at: string }[],
  seen: Record<string, string>,
): number => items.filter((i) => !seen[i.key] || i.at > seen[i.key]).length;
