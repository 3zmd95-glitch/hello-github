/**
 * 💬 Auto-replies (a copy of Beacons' Smart Reply, `planning/tools/10-auto-replies.md`; v2 in
 * `planning/tools/14-auto-replies-v2.md`): when someone comments a keyword on one of the owner's Instagram posts,
 * send them a private DM with the link and reply under the comment. Instagram only for now (Threads and YouTube
 * have no DMs; TikTok has no comment API). The poller answers comments (this file) and DMs (`inbox.ts`); the parts
 * both share (keyword matching, building and sending the reply, Instagram's size limits and refusals) live in
 * `replyCore.ts`.
 *
 * Detection is **polling**, not webhooks: Meta only sends comment webhooks to apps that are Live with
 * Advanced Access, and the owner's app is in Development mode. So the cron (cron.ts) polls every minute (on the
 * five-minute ticks only when the publish queue moved nothing): it lists the watched posts, reads the comments of
 * the posts whose `comments_count` changed (or everything once an hour), matches them against the automations and
 * answers. The same poll then reads the newest conversations for the message rules and the default reply
 * (`inbox.ts`).
 *
 * Instagram API with Instagram Login (scopes instagram_business_manage_comments + _manage_messages):
 *   GET  /me?fields=user_id,username                              the professional account id (cached)
 *   GET  /{ig-user-id}/media?fields=id,comments_count&limit=…     the newest posts ("any post" automations)
 *   GET  /{media-id}?fields=id,comments_count                     a specific post's count
 *   GET  /{media-id}/comments?fields=id,text,username,from,timestamp
 *   POST /{ig-user-id}/messages           { recipient: { comment_id }, message: { attachment | text } }
 *        the "private reply": one message per comment, within 7 days of the comment. Sent FIRST: the
 *        public reply says "sent it to you privately", so it only goes out once the DM did.
 *   POST /{comment-id}/replies            message=…               the public reply under the comment
 *   Short DMs with links go out as a generic card through GET /go/:id/:n, which counts the click and redirects;
 *   longer DMs keep the full text and "title: link" lines. A refused private-reply card falls back once to those lines.
 *
 * Storage is split by writer, so no request path ever overwrites another's data (KV is last-write-wins):
 *   replies:doc     AutomationsDoc  what the owner configured (rules, pause, default reply); written only by
 *                                   POST/DELETE /social/replies, POST /social/replies/settings and "Check now"
 *                                   (POST /social/replies/poll, a scan request the next tick picks up)
 *   replies:state   PollState       what the poller learned (answered comments, conversation positions, counters,
 *                                   log, lock); written only by pollReplies, which also holds a short lock while
 *                                   it answers
 *   replies:clicks  ClicksDoc       taps on the /go links; written only by handleGo (capped per day)
 * An idle tick writes nothing, and the write guard (WRITE_SLOW, WRITE_STOP) caps the poller's writes per UTC day.
 */

import { Budget, clip, fetchJson, formPost, int, type Http } from "./http";
import { IG_API } from "./instagram";
import { metaList, type MetaError, type MetaPage } from "./meta";
import { credentials, isExpired, PROVIDERS } from "./oauth";
import {
  answerFor,
  answerInbox,
  CONVO_TTL_MS,
  inboxActive,
  readInbox,
  WINDOW_MS,
  type ConversationBatch,
  type InboxDeps,
} from "./inbox";
import {
  DEFAULT_STATS_ID,
  dmFits,
  DM_TEXT_BYTES,
  graph,
  LOG_TEXT_CLIP,
  matches,
  MAX_RETRIES,
  messageButtons,
  normalizeForMatch,
  pickPublicReply,
  ReplyError,
  sendReply,
  TICK_STOPPERS,
  toReplyCode,
  utf8Bytes,
  type ReplyErrorCode,
  type ReplyFailure,
} from "./replyCore";
import { Store, type SocialEnv } from "./store";
import { riyadhDay } from "./time";
import { SocialError, type TokenSet } from "./types";

export { DEFAULT_STATS_ID, graph, matches, normalizeForMatch, ReplyError } from "./replyCore";
export type { ReplyErrorCode } from "./replyCore";

/* ---------- document types (shared shape with the dashboard's lib/replies.ts) ---------- */

export type ReplyMatch = "contains" | "exact";

export interface ReplyButton {
  /** ≤ BUTTON_TITLE_MAX characters. */
  title: string;
  /** https only. */
  url: string;
}

export interface ReplyStats {
  /** Private replies sent. */
  sends: number;
  publicReplies: number;
  failures: number;
  /** Taps on the /go links (merged from `replies:clicks` when read). */
  clicks: number;
  lastSentAt?: string;
  lastError?: ReplyErrorCode;
}

/** What starts a rule (round 34): a comment on a post, or a DM / story reply. */
export type ReplyTrigger = "comment" | "message";

/** What the owner typed in the builder. */
export interface AutomationInput {
  id: string;
  enabled: boolean;
  trigger: ReplyTrigger;
  /** Comment rules: Instagram media id; null = any of the newest posts. Always null for message rules. */
  postId: string | null;
  /** Display only (copied from the synced posts by the dashboard). */
  permalink?: string;
  title?: string;
  thumbUrl?: string;
  keywords: string[];
  match: ReplyMatch;
  /** Comment rules: up to PUBLIC_REPLIES_MAX, one picked at random; `{username}` becomes @handle. [] = none. */
  publicReplies: string[];
  dmText: string;
  buttons: ReplyButton[];
  /** Adds «تابعني» (the account's profile) after the link buttons. */
  followButton: boolean;
}

/** An automation as stored (`replies:doc`): the owner's part only, no counters. */
export interface Automation extends AutomationInput {
  createdAt: string;
  updatedAt: string;
  /** ISO: when it was last switched on; comments from before are left alone. */
  enabledAt?: string;
}

/** An automation as the dashboard sees it: the poller's counters and the clicks merged in. */
export interface AutomationView extends Automation {
  stats: ReplyStats;
}

/** What a log entry answered (round 34): a comment, a DM, a story reply, or a DM with the default reply. */
export type ReplyKind = "comment" | "message" | "story" | "default";

export interface ReplyLogEntry {
  at: string;
  kind: ReplyKind;
  /** The rule, or DEFAULT_STATS_ID for the default reply. */
  automationId: string;
  /** Comments: the post and the comment. */
  postId?: string;
  commentId?: string;
  /** DMs and story replies: the person's message. */
  messageId?: string;
  username?: string;
  /** The comment or message, clipped. */
  text: string;
  publicReply: "sent" | "skipped" | "failed";
  dm: "sent" | "failed";
  error?: ReplyErrorCode;
  /** The platform's words (never a token). */
  detail?: string;
}

/** A message the poll sent: to whom (Instagram-scoped id) and when. */
export interface SentMessage {
  to: string;
  at: string;
}

/** The answer to a DM that matches no rule (round 34): at most once per person per 24 hours. */
export interface DefaultReply {
  enabled: boolean;
  text: string;
  /** ISO: when it was last switched on; messages from before are left alone. */
  enabledAt?: string;
  updatedAt: string;
}

/** `replies:doc`: the owner's automations and settings. */
export interface AutomationsDoc {
  v: 1;
  /** The Worker's origin, recorded on every save (the cron has no request URL for the /go links). */
  origin?: string;
  /** Pause all: the poll answers nothing while true. */
  paused?: boolean;
  defaultReply?: DefaultReply;
  /** ISO: "Check now" — the next poll reads every watched post (a full scan) when this is newer than its last one. */
  scanRequestedAt?: string;
  automations: Record<string, Automation>;
}

/** An automation as KV may hold it: documents from before round 34 lack the v2 fields and carry `publicReply`. */
type StoredAutomation = Omit<Automation, "trigger" | "publicReplies" | "followButton"> &
  Partial<Pick<Automation, "trigger" | "publicReplies" | "followButton">> & { publicReply?: string };
export type StoredDoc = Omit<AutomationsDoc, "automations"> & {
  automations: Record<string, StoredAutomation>;
};

/** `replies:state`: what the poller learned. */
export interface PollState {
  v: 1;
  /** From GET /me, cached after the first poll. */
  igUserId?: string;
  ownerUsername?: string;
  /** mediaId → the comments_count last seen once its comments were fully answered. */
  watch: Record<string, { count: number; seenAt: string }>;
  /** commentId → ISO answered (or given up on); pruned after HANDLED_TTL_MS. */
  handled: Record<string, string>;
  /** Comment or DM message id → failures so far (transient ones, and permission refusals). */
  retries: Record<string, number>;
  /** Message id → the poll's own sends (pruned after SENT_TTL_MS): tells its DMs from the owner's (inbox.ts). */
  sent: Record<string, SentMessage>;
  /** ISO: when the DM side first ran; nothing older is ever answered (inbox.ts). */
  inboxSince?: string;
  /** Conversation id → the newest message handled (pruned after CONVO_TTL_MS). */
  convos: Record<string, { seenAt: string }>;
  /** Instagram-scoped id → when the default reply last went to that person (pruned after a day). */
  defaultSentAt: Record<string, string>;
  /** automationId → counters (clicks live in `replies:clicks`). */
  stats: Record<string, ReplyStats>;
  /** Newest first, at most LOG_MAX. */
  log: ReplyLogEntry[];
  lastPollAt?: string;
  lastFullScanAt?: string;
  lastError?: ReplyErrorCode;
  /** The platform's words for lastError (Meta's code and subcode at the end), when it gave any. */
  lastErrorDetail?: string;
  /** ISO: a poll is answering comments or DMs until then (keeps two overlapping polls from both answering). */
  lockUntil?: string;
  /** replies:state writes on a UTC day (Cloudflare's daily limits reset at 00:00 UTC). */
  writes?: { day: string; count: number };
}

/** `replies:clicks`: taps on the /go links, with the daily write cap (Riyadh day). */
export interface ClicksDoc {
  v: 1;
  day?: string;
  today: number;
  byAutomation: Record<string, number>;
}

/* ---------- limits ---------- */

/** Outbound calls one poll may make (the tick's publish queue moved nothing, so the budget is ours). */
export const REPLIES_FETCH_BUDGET = 30;
/** Answers per tick, comments and DMs together (a comment costs up to three calls, a DM one). */
export const REPLY_CAP = 8;
/** Newest posts watched for "any post" automations. */
export const WATCH_ANY_MAX = 5;
/** Specific posts looked up on top of that. */
export const WATCH_SPECIFIC_MAX = 3;
/** Posts whose comments may be read in one tick: every watched post (a safety net, not a gate). */
export const WATCH_MAX = WATCH_ANY_MAX + WATCH_SPECIFIC_MAX;
export const COMMENTS_PAGE = 50;
/** Instagram allows the private reply within 7 days of the comment; handled ids are kept as long. */
export const REPLY_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const HANDLED_TTL_MS = REPLY_WINDOW_MS;
/** The ids of the poll's own sends are kept a day (the owner-chatting check looks back 24 hours). */
export const SENT_TTL_MS = 24 * 60 * 60_000;
/** Comments are re-read regardless of the count once this often (a deleted + new comment keeps the count). */
export const FULL_SCAN_EVERY_MS = 60 * 60_000;
export const LOG_MAX = 50;
/** A poll holds the lock this long at most (a crashed poll frees it by expiry; the ticks until then skip). */
export const POLL_LOCK_MS = 4 * 60_000;
/** replies:state writes in a UTC day from which the poll runs on five-minute ticks only… */
export const WRITE_SLOW = 300;
/** …and from which it answers nothing until 00:00 UTC. The free plan allows 1,000 KV writes a day for every
 * key of the Worker together (the sync, the publish queue, the Trend Radar, /go). ponytail: one shared counter;
 * move the poller's state to D1 when instant mode (webhooks) lands, since then every event writes. */
export const WRITE_STOP = 600;
/** Counted clicks per day (the redirect keeps working past it; protects the free plan's KV writes). */
export const CLICK_WRITES_PER_DAY = 200;
/** One counted tap per visitor per link per this many seconds (Cache API, per colo). */
export const GO_THROTTLE_S = 60;
export const KEYWORDS_MAX = 10;
export const KEYWORD_MAX = 40;
export const BUTTONS_MAX = 3;
export const BUTTON_TITLE_MAX = 20;
export const PUBLIC_MAX = 2200;
/** Public replies per comment rule (one is picked at random each time). */
export const PUBLIC_REPLIES_MAX = 3;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
/** Route words under /social/replies, and the default reply's stats key: never an automation id. */
const RESERVED_IDS = new Set(["poll", "settings", DEFAULT_STATS_ID]);

export const emptyAutomations = (): AutomationsDoc => ({ v: 1, automations: {} });
export const emptyState = (): PollState => ({
  v: 1,
  watch: {},
  handled: {},
  retries: {},
  sent: {},
  convos: {},
  defaultSentAt: {},
  stats: {},
  log: [],
});
export const emptyClicks = (): ClicksDoc => ({ v: 1, today: 0, byAutomation: {} });
export const emptyStats = (): ReplyStats => ({ sends: 0, publicReplies: 0, failures: 0, clicks: 0 });

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** The write guard today: "slow" (five-minute ticks only), "stop" (nothing until 00:00 UTC), or nothing. */
export function writeGuard(
  state: Pick<PollState, "writes">,
  now: Date,
): "slow" | "stop" | undefined {
  const n = state.writes?.day === utcDay(now) ? state.writes.count : 0;
  return n >= WRITE_STOP ? "stop" : n >= WRITE_SLOW ? "slow" : undefined;
}

/** The document in the v2 shape: v1 automations become comment rules with their one public reply. */
export function readAutomations(raw: StoredDoc | null): AutomationsDoc {
  const doc: StoredDoc = raw ?? emptyAutomations();
  const automations: Record<string, Automation> = {};
  for (const [id, a] of Object.entries(doc.automations)) {
    const { publicReply, ...rest } = a;
    automations[id] = {
      ...rest,
      trigger: a.trigger ?? "comment",
      publicReplies: a.publicReplies ?? (publicReply?.trim() ? [publicReply.trim()] : []),
      followButton: a.followButton ?? false,
    };
  }
  return { ...doc, automations };
}

/** An automation with its counters, as the dashboard reads it. */
export function view(a: Automation, state: PollState, clicks: ClicksDoc): AutomationView {
  return {
    ...a,
    stats: { ...(state.stats[a.id] ?? emptyStats()), clicks: clicks.byAutomation[a.id] ?? 0 },
  };
}

/* ---------- the public reply ---------- */

const fill = (template: string, username: string | undefined) =>
  template.replace(/\{username\}/g, username ? `@${username}` : "").trim();

/* ---------- validation ---------- */

const isHttps = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};

const optString = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * The request body as an AutomationInput, or the reason it is refused (`detail` names the field). `origin` (the
 * Worker's own) sizes the /go link lines the DM carries. Message rules keep no post and no public replies.
 */
export function parseAutomationInput(
  body: unknown,
  origin?: string,
): { ok: true; automation: AutomationInput } | { ok: false; detail: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const bad = (detail: string) => ({ ok: false as const, detail });
  if (typeof b.id !== "string" || !ID_RE.test(b.id) || RESERVED_IDS.has(b.id)) return bad("id");
  const trigger = b.trigger ?? "comment";
  if (trigger !== "comment" && trigger !== "message") return bad("trigger");
  if (b.postId !== null && b.postId !== undefined && typeof b.postId !== "string") {
    return bad("postId");
  }
  if (typeof b.postId === "string" && !/^[0-9A-Za-z_-]{1,64}$/.test(b.postId)) return bad("postId");
  if (!Array.isArray(b.keywords) || !b.keywords.length || b.keywords.length > KEYWORDS_MAX) {
    return bad("keywords");
  }
  const keywords: string[] = [];
  for (const k of b.keywords) {
    if (typeof k !== "string") return bad("keywords");
    const trimmed = k.trim();
    if (!trimmed || trimmed.length > KEYWORD_MAX) return bad("keywords");
    if (!normalizeForMatch(trimmed)) return bad("keywords");
    keywords.push(trimmed);
  }
  const match = b.match ?? "contains";
  if (match !== "contains" && match !== "exact") return bad("match");
  // v2 sends `publicReplies`; a v1 dashboard's single `publicReply` still works.
  const rawReplies =
    b.publicReplies ?? (typeof b.publicReply === "string" ? [b.publicReply] : []);
  if (!Array.isArray(rawReplies) || rawReplies.length > PUBLIC_REPLIES_MAX) {
    return bad("publicReplies");
  }
  const publicReplies: string[] = [];
  for (const r of rawReplies) {
    if (typeof r !== "string" || r.length > PUBLIC_MAX) return bad("publicReplies");
    if (r.trim()) publicReplies.push(r.trim());
  }
  if (typeof b.dmText !== "string" || !b.dmText.trim()) return bad("dmText");
  const followButton = b.followButton === true;
  const rawButtons = b.buttons === undefined ? [] : b.buttons;
  if (!Array.isArray(rawButtons) || rawButtons.length + (followButton ? 1 : 0) > BUTTONS_MAX) {
    return bad("buttons");
  }
  const buttons: ReplyButton[] = [];
  for (const raw of rawButtons) {
    const btn = (raw ?? {}) as Record<string, unknown>;
    const title = optString(btn.title, BUTTON_TITLE_MAX);
    if (!title) return bad("buttons.title");
    if (!isHttps(btn.url)) return bad("buttons.url");
    buttons.push({ title, url: btn.url });
  }
  const onPost = trigger === "comment";
  const permalink = onPost ? optString(b.permalink, 300) : undefined;
  const title = onPost ? optString(b.title, 120) : undefined;
  const automation: AutomationInput = {
    id: b.id,
    enabled: b.enabled !== false,
    trigger,
    postId: onPost && typeof b.postId === "string" ? b.postId : null,
    ...(permalink ? { permalink } : {}),
    ...(title ? { title } : {}),
    ...(onPost && isHttps(b.thumbUrl) ? { thumbUrl: b.thumbUrl } : {}),
    keywords,
    match,
    publicReplies: onPost ? publicReplies : [],
    dmText: b.dmText.trim(),
    buttons,
    followButton,
  };
  return dmFits(automation, origin) ? { ok: true, automation } : bad("dmText");
}

/** A saved automation: the new fields over the old, creation kept, `enabledAt` stamped on switch-on. */
export function mergeAutomation(
  existing: Automation | undefined,
  input: AutomationInput,
  now: Date,
): Automation {
  const at = now.toISOString();
  const turnedOn = input.enabled && !existing?.enabled;
  return {
    ...input,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(existing?.enabledAt && !turnedOn ? { enabledAt: existing.enabledAt } : {}),
    ...(turnedOn ? { enabledAt: at } : {}),
  };
}

/** `POST /social/replies/settings`: pause all, and the default reply. */
export interface SettingsInput {
  paused?: boolean;
  defaultReply?: { enabled: boolean; text: string };
}

export function parseSettingsInput(
  body: unknown,
): { ok: true; settings: SettingsInput } | { ok: false; detail: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const settings: SettingsInput = {};
  if (b.paused !== undefined) {
    if (typeof b.paused !== "boolean") return { ok: false, detail: "paused" };
    settings.paused = b.paused;
  }
  if (b.defaultReply !== undefined) {
    const d = (b.defaultReply ?? {}) as Record<string, unknown>;
    if (typeof d.enabled !== "boolean" || typeof d.text !== "string") {
      return { ok: false, detail: "defaultReply" };
    }
    const text = d.text.trim();
    if ((d.enabled && !text) || utf8Bytes(text) > DM_TEXT_BYTES) {
      return { ok: false, detail: "defaultReply" };
    }
    settings.defaultReply = { enabled: d.enabled, text };
  }
  return { ok: true, settings };
}

/** The saved settings over the old; the default reply's `enabledAt` is stamped when it is switched on. */
export function mergeSettings(doc: AutomationsDoc, s: SettingsInput, now: Date): AutomationsDoc {
  const at = now.toISOString();
  const next: AutomationsDoc = { ...doc };
  if (s.paused !== undefined) next.paused = s.paused;
  if (s.defaultReply) {
    const was = doc.defaultReply;
    const turnedOn = s.defaultReply.enabled && !was?.enabled;
    const enabledAt = turnedOn ? at : was?.enabledAt;
    next.defaultReply = { ...s.defaultReply, updatedAt: at, ...(enabledAt ? { enabledAt } : {}) };
  }
  return next;
}

/* ---------- the poll ---------- */

export interface PollDeps {
  fetch?: typeof fetch;
  now?: Date;
  budget?: number;
  /** Picks the public reply (tests pass a fixed source). */
  random?: () => number;
  /** False on the cron's off-grid minutes, which the guard's "slow" mode skips. Default true. */
  fiveMinuteTick?: boolean;
}

export interface PollResult {
  /** Posts whose comments were read. */
  checked: number;
  /** Comment and message ids answered (the DM went out). */
  sent: string[];
  failed: string[];
  /** Why nothing was done. */
  skipped?:
    "none" | "not_connected" | "no_permission" | "token_expired" | "locked" | "paused" | "guard";
  /** A failure that stopped the poll, or the last post whose comments could not be read. */
  error?: ReplyErrorCode;
  /** The failure's words (never a token). */
  detail?: string;
}

interface IgMe extends MetaError {
  user_id?: string | number;
  username?: string;
}
interface IgMedia extends MetaError {
  id?: string;
  comments_count?: number | string;
}
interface IgComment {
  id?: string;
  text?: string;
  username?: string;
  from?: { id?: string; username?: string };
  timestamp?: string;
}

/** The automation that answers a comment: specific-post ones first, then "any post"; none before `enabledAt`. */
export function pickAutomation(
  enabled: Automation[],
  mediaId: string,
  text: string,
  commentMs: number,
): Automation | undefined {
  const fits = (a: Automation) =>
    (!a.enabledAt || Date.parse(a.enabledAt) <= commentMs) && matches(text, a);
  return (
    enabled.find((a) => a.postId === mediaId && fits(a)) ??
    enabled.find((a) => a.postId === null && fits(a))
  );
}

/**
 * One poll: reads the watched posts' new comments and the new DMs (inbox.ts) and answers the matching ones while
 * the budget and the per-tick cap allow. Writes `replies:state` once at the end (twice when it answered: the lock
 * first), and only when something changed; the write guard counts every write. Does nothing while paused or while
 * the guard holds it back. Never throws.
 */
export async function pollReplies(env: SocialEnv, deps: PollDeps = {}): Promise<PollResult> {
  const result: PollResult = { checked: 0, sent: [], failed: [] };
  const store = Store.from(env);
  if (!store) return { ...result, skipped: "not_connected" };
  const now = deps.now ?? new Date();
  const at = now.toISOString();
  const random = deps.random ?? Math.random;
  const config = readAutomations(await store.getReplies<StoredDoc>());
  if (config.paused) return { ...result, skipped: "paused" };
  const enabled = Object.values(config.automations).filter(
    (a) => a.enabled && a.trigger === "comment",
  );
  const dmOn = inboxActive(config);
  if (!enabled.length && !dmOn) return { ...result, skipped: "none" };
  // Documents written before round 34 get the new fields.
  const state: PollState = { ...emptyState(), ...(await store.getRepliesState<PollState>()) };
  if (state.lockUntil && Date.parse(state.lockUntil) > now.getTime()) {
    return { ...result, skipped: "locked" };
  }
  const guard = writeGuard(state, now);
  if (guard === "stop" || (guard === "slow" && deps.fiveMinuteTick === false)) {
    return { ...result, skipped: "guard" };
  }

  let changed = false;
  const statsOf = (id: string): ReplyStats => (state.stats[id] ??= emptyStats());
  const addLog = (entry: ReplyLogEntry) => {
    state.log.unshift(entry);
    if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
  };
  // The poll's error, with its words for the account card (cleared by a poll that ends without one).
  const setError = (failure?: ReplyFailure) => {
    const detail = failure?.detail?.slice(0, 200);
    if (state.lastError !== failure?.code || state.lastErrorDetail !== detail) {
      state.lastError = failure?.code;
      state.lastErrorDetail = detail;
      changed = true;
    }
  };
  // Every write of the state is counted for the write guard.
  const put = async () => {
    const day = utcDay(now);
    state.writes = { day, count: (state.writes?.day === day ? state.writes.count : 0) + 1 };
    await store.putRepliesState(state);
  };
  // The result. Never thrown (the store already tried twice): a lost result is logged and reported instead.
  const save = async () => {
    if (!changed) return;
    state.lastPollAt = at;
    state.lockUntil = undefined;
    try {
      await put();
    } catch (e) {
      const detail = `replies:state not saved: ${String((e as Error)?.message ?? e)}`.slice(0, 200);
      console.log(JSON.stringify({ replies: "save", error: "upstream", detail }));
      result.error = "upstream";
      result.detail = detail;
    }
  };
  // Counters of automations the owner deleted go with them.
  for (const id of Object.keys(state.stats)) {
    if (!config.automations[id] && id !== DEFAULT_STATS_ID) {
      delete state.stats[id];
      changed = true;
    }
  }

  const http: Http = {
    fetch: deps.fetch ?? fetch,
    budget: new Budget(deps.budget ?? REPLIES_FETCH_BUDGET),
  };

  // Tokens with the reply scopes, refreshed when due.
  const creds = credentials(env, "instagram");
  let tokens: TokenSet | null = await store.getTokens("instagram");
  if (!creds || !tokens) {
    setError({ code: "not_connected" });
    await save();
    return { ...result, skipped: "not_connected" };
  }
  if (!tokens.canReply) {
    setError({ code: "no_permission" });
    await save();
    return { ...result, skipped: "no_permission" };
  }
  try {
    const provider = PROVIDERS.instagram;
    if (provider.needsRefresh(tokens, now)) {
      tokens = await provider.refresh(creds, tokens, http, now);
      await store.putTokens("instagram", tokens);
    } else if (isExpired(tokens, now)) {
      throw new SocialError("token_expired", "long-lived token expired");
    }
  } catch (e) {
    const { code, detail } = toReplyCode(e);
    setError({ code, detail });
    await save();
    return {
      ...result,
      ...(code === "token_expired" ? { skipped: "token_expired" as const } : {}),
      error: code,
      ...(detail ? { detail: detail.slice(0, 200) } : {}),
    };
  }
  const token = tokens.accessToken;
  const withToken = (url: string) =>
    `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;

  try {
    if (!state.igUserId) {
      const me = graph(
        await fetchJson<IgMe>(http, withToken(`${IG_API}/me?fields=user_id,username`)),
        "me",
      );
      if (me.user_id === undefined) throw new ReplyError("upstream", "me: no user_id");
      state.igUserId = String(me.user_id);
      if (me.username) state.ownerUsername = me.username;
      changed = true;
    }
    const igUserId = state.igUserId;

    // The posts to watch: the newest ones for "any post", plus the specific ones not among them. A post that
    // cannot be looked up (deleted, wrong id) is noted on its automations and skipped, not the whole poll.
    const media: { id: string; count: number }[] = [];
    if (enabled.some((a) => a.postId === null)) {
      const list = graph(
        await fetchJson<MetaPage<IgMedia>>(
          http,
          withToken(`${IG_API}/${igUserId}/media?fields=id,comments_count&limit=${WATCH_ANY_MAX}`),
        ),
        "media",
      );
      for (const m of list.data ?? []) if (m.id) media.push({ id: m.id, count: int(m.comments_count) });
    }
    const specific = [...new Set(enabled.map((a) => a.postId).filter((p): p is string => !!p))];
    for (const id of specific.slice(0, WATCH_SPECIFIC_MAX)) {
      if (media.some((m) => m.id === id)) continue;
      if (!http.budget.ok) break;
      try {
        const m = graph(
          await fetchJson<IgMedia>(http, withToken(`${IG_API}/${id}?fields=id,comments_count`)),
          "post",
        );
        media.push({ id, count: int(m.comments_count) });
      } catch (e) {
        const { code } = toReplyCode(e);
        if (TICK_STOPPERS.has(code)) throw e;
        for (const a of enabled) {
          if (a.postId !== id) continue;
          const s = statsOf(a.id);
          if (s.lastError !== code) {
            s.lastError = code;
            changed = true;
          }
        }
      }
    }

    // Everything once an hour, and on the tick after "Check now" (the dashboard's scan request).
    const fullScan =
      !state.lastFullScanAt ||
      now.getTime() - Date.parse(state.lastFullScanAt) >= FULL_SCAN_EVERY_MS ||
      Date.parse(config.scanRequestedAt ?? "") > Date.parse(state.lastFullScanAt);
    const toRead = media
      .filter((m) => fullScan || (state.watch[m.id]?.count ?? -1) !== m.count)
      .slice(0, WATCH_MAX);

    // New matching comments, oldest first. A post whose comments cannot be read is left for the next tick.
    const candidates: { comment: IgComment; automation: Automation; mediaId: string }[] = [];
    const read = new Set<string>();
    for (const m of toRead) {
      if (!http.budget.ok) break;
      let comments: IgComment[];
      try {
        comments = await metaList<IgComment>(
          http,
          withToken(
            `${IG_API}/${m.id}/comments?fields=id,text,username,from,timestamp&limit=${COMMENTS_PAGE}`,
          ),
          "comments",
          COMMENTS_PAGE * 2,
          2,
          graph,
        );
      } catch (e) {
        const { code, detail } = toReplyCode(e);
        if (TICK_STOPPERS.has(code)) throw e;
        result.error = code;
        if (detail) result.detail = detail.slice(0, 200);
        // Forget the count we had, so the post is read again next tick even if it did not change.
        if (state.watch[m.id]) {
          delete state.watch[m.id];
          changed = true;
        }
        continue;
      }
      result.checked += 1;
      read.add(m.id);
      for (const c of comments) {
        if (!c.id || state.handled[c.id]) continue;
        const ts = Date.parse(c.timestamp ?? "");
        if (!Number.isFinite(ts) || ts < now.getTime() - REPLY_WINDOW_MS) continue;
        if (c.from?.id === igUserId) continue;
        if (state.ownerUsername && (c.username ?? c.from?.username) === state.ownerUsername) continue;
        const automation = pickAutomation(enabled, m.id, c.text ?? "", ts);
        if (automation) candidates.push({ comment: c, automation, mediaId: m.id });
      }
    }
    if (fullScan && toRead.length && read.size === toRead.length) {
      state.lastFullScanAt = at;
      changed = true;
    }
    candidates.sort((x, y) => (x.comment.timestamp ?? "").localeCompare(y.comment.timestamp ?? ""));

    // The DMs and story replies (inbox.ts). A conversations read that fails leaves the comments alone, even a tick
    // stopper (the comments are answered, then the poll ends: there are no DMs to answer), and is the poll's error
    // unless answering stops it.
    const inbox: InboxDeps = { http, token, igUserId, config, state, now, statsOf, log: addLog };
    let batches: ConversationBatch[] = [];
    let readError: ReplyFailure | undefined;
    if (dmOn) {
      try {
        const read = await readInbox(inbox);
        batches = read.batches;
        if (read.changed) changed = true;
      } catch (e) {
        const { code, detail } = toReplyCode(e);
        readError = { code, detail };
        result.error = code;
        if (detail) result.detail = detail.slice(0, 200);
      }
    }
    const dmToAnswer = batches.some((b) => b.items.some((i) => answerFor(inbox, b, i)));

    // Claim the comments and messages before answering, so a poll overlapping this one waits.
    if (candidates.length || dmToAnswer) {
      state.lockUntil = new Date(now.getTime() + POLL_LOCK_MS).toISOString();
      changed = true;
      await put();
    }

    const attempted = new Set<string>();
    let stop: ReplyFailure | undefined;
    for (const { comment: c, automation: a, mediaId } of candidates) {
      if (stop || result.sent.length >= REPLY_CAP) break;
      const buttons = messageButtons(a, config.origin, state.ownerUsername);
      const pub = pickPublicReply(a.publicReplies, random);
      // The DM, its text fallback when Instagram refuses buttons, and the public reply.
      if (http.budget.left < 1 + (buttons.length ? 1 : 0) + (pub ? 1 : 0)) break;
      const id = c.id!;
      attempted.add(id);
      const username = c.username ?? c.from?.username;
      const s = statsOf(a.id);
      const entry: ReplyLogEntry = {
        at,
        kind: "comment",
        automationId: a.id,
        postId: mediaId,
        commentId: id,
        ...(username ? { username } : {}),
        text: clip(c.text, LOG_TEXT_CLIP) ?? "",
        publicReply: "skipped",
        dm: "failed",
      };
      const finish = (code: ReplyErrorCode, detail?: string) => {
        if (TICK_STOPPERS.has(code)) stop = { code, detail };
      };
      // The DM first: it is the part Instagram allows once per comment, and the public reply promises it.
      let dmSent = false;
      try {
        const { messageId, recipientId } = await sendReply(
          { http, igUserId, token },
          { comment_id: id },
          a.dmText,
          buttons,
        );
        dmSent = true;
        entry.dm = "sent";
        s.sends += 1;
        s.lastSentAt = at;
        s.lastError = undefined;
        state.handled[id] = at;
        delete state.retries[id];
        if (messageId) state.sent[messageId] = { to: recipientId ?? c.from?.id ?? "", at };
        result.sent.push(id);
      } catch (e) {
        const { code, detail, transient } = toReplyCode(e);
        entry.error = code;
        if (detail) entry.detail = detail.slice(0, 200);
        s.failures += 1;
        s.lastError = code;
        result.failed.push(id);
        finish(code, detail);
        if (code === "token_expired" || code === "rate_limited") {
          // Nothing recorded: the same comment is tried first next time.
        } else if (transient || code === "no_permission") {
          // Retried on later reads; given up on after MAX_RETRIES so one odd comment cannot block the rest.
          const tries = (state.retries[id] ?? 0) + 1;
          if (tries >= MAX_RETRIES) {
            state.handled[id] = at;
            delete state.retries[id];
          } else {
            state.retries[id] = tries;
          }
        } else {
          state.handled[id] = at;
          delete state.retries[id];
        }
      }
      // The public reply, only once the DM went out; a failure here is logged, never retried.
      if (dmSent && pub && http.budget.ok) {
        try {
          graph(
            await fetchJson<MetaError>(
              http,
              `${IG_API}/${id}/replies`,
              formPost({ message: fill(pub, username), access_token: token }),
            ),
            "reply",
          );
          entry.publicReply = "sent";
          s.publicReplies += 1;
        } catch (e) {
          const { code, detail } = toReplyCode(e);
          entry.publicReply = "failed";
          entry.error ??= code;
          if (detail && !entry.detail) entry.detail = detail.slice(0, 200);
          finish(code, detail);
        }
      }
      changed = true;
      addLog(entry);
    }
    if (!stop && batches.length) {
      const dms = await answerInbox(inbox, batches, REPLY_CAP - result.sent.length);
      result.sent.push(...dms.sent);
      result.failed.push(...dms.failed);
      if (dms.changed) changed = true;
      stop = dms.stop;
    }
    setError(stop ?? readError);

    // Remember each read post's count only once every matching comment on it was attempted; a post with
    // comments left (cap, budget, stop) is read again next tick.
    for (const m of toRead) {
      if (!read.has(m.id)) continue;
      const left = candidates.some((x) => x.mediaId === m.id && !attempted.has(x.comment.id!));
      if (left) {
        if (state.watch[m.id]) {
          delete state.watch[m.id];
          changed = true;
        }
      } else if (state.watch[m.id]?.count !== m.count) {
        state.watch[m.id] = { count: m.count, seenAt: at };
        changed = true;
      }
    }
  } catch (e) {
    const { code, detail } = toReplyCode(e);
    setError({ code, detail });
    result.error = code;
    if (detail) result.detail = detail.slice(0, 200);
  }

  // Forget answered comments once Instagram would refuse a private reply anyway.
  for (const [id, when] of Object.entries(state.handled)) {
    if (now.getTime() - Date.parse(when) > HANDLED_TTL_MS) {
      delete state.handled[id];
      delete state.retries[id];
      changed = true;
    }
  }
  // Expired send ids, conversation positions and default-reply times leave with the next real write: dropping them
  // alone writes nothing (an idle poll stays idle).
  for (const [mid, s] of Object.entries(state.sent)) {
    if (now.getTime() - Date.parse(s.at) > SENT_TTL_MS) delete state.sent[mid];
  }
  for (const [id, c] of Object.entries(state.convos)) {
    if (now.getTime() - Date.parse(c.seenAt) > CONVO_TTL_MS) delete state.convos[id];
  }
  for (const [person, when] of Object.entries(state.defaultSentAt)) {
    if (now.getTime() - Date.parse(when) > WINDOW_MS) delete state.defaultSentAt[person];
  }
  await save();
  return result;
}

/* ---------- HTTP: /social/replies ---------- */

interface Reply {
  json(body: unknown, status: number): Response;
  fail(error: "not_configured" | "bad_request"): Response;
}

/** What `GET /social/replies` answers (never tokens or the handled ids). */
export function publicDoc(
  config: AutomationsDoc,
  state: PollState,
  clicks: ClicksDoc,
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    automations: Object.values(config.automations)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((a) => view(a, state, clicks)),
    log: state.log,
    paused: config.paused === true,
    ...(config.defaultReply
      ? {
          defaultReply: {
            ...config.defaultReply,
            stats: state.stats[DEFAULT_STATS_ID] ?? emptyStats(),
          },
        }
      : {}),
    ...(config.origin ? { origin: config.origin } : {}),
    ...(state.igUserId ? { igUserId: state.igUserId } : {}),
    ...(state.ownerUsername ? { ownerUsername: state.ownerUsername } : {}),
    ...(state.lastPollAt ? { lastPollAt: state.lastPollAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {}),
    ...(state.lastErrorDetail ? { lastErrorDetail: state.lastErrorDetail } : {}),
    ...(writeGuard(state, now) ? { guard: writeGuard(state, now) } : {}),
  };
}

async function readAll(store: Store): Promise<[AutomationsDoc, PollState, ClicksDoc]> {
  const [config, state, clicks] = await Promise.all([
    store.getReplies<StoredDoc>(),
    store.getRepliesState<PollState>(),
    store.getReplyClicks<ClicksDoc>(),
  ]);
  return [readAutomations(config), state ?? emptyState(), clicks ?? emptyClicks()];
}

/** `/social/replies[/:id | /poll | /settings]`; `rest` is the path after "replies". Null when the path is not ours. */
export async function handleReplies(
  req: Request,
  rest: string[],
  store: Store | null,
  now: Date,
  reply: Reply,
): Promise<Response | null> {
  const [first, extra] = rest;
  if (extra !== undefined) return null;

  if (!first && req.method === "GET") {
    if (!store) return reply.fail("not_configured");
    return reply.json(publicDoc(...(await readAll(store)), now), 200);
  }

  if (!first && req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return reply.json({ error: "bad_request", detail: "json" }, 400);
    }
    const parsed = parseAutomationInput(body, new URL(req.url).origin);
    if (!parsed.ok) return reply.json({ error: "bad_request", detail: parsed.detail }, 400);
    if (!store) return reply.fail("not_configured");
    const [config, state, clicks] = await readAll(store);
    const automation = mergeAutomation(
      config.automations[parsed.automation.id],
      parsed.automation,
      now,
    );
    config.automations[automation.id] = automation;
    config.origin = new URL(req.url).origin;
    await store.putReplies(config);
    return reply.json({ automation: view(automation, state, clicks) }, 200);
  }

  if (first === "settings" && req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return reply.json({ error: "bad_request", detail: "json" }, 400);
    }
    const parsed = parseSettingsInput(body);
    if (!parsed.ok) return reply.json({ error: "bad_request", detail: parsed.detail }, 400);
    if (!store) return reply.fail("not_configured");
    const [config, state, clicks] = await readAll(store);
    const next = mergeSettings(config, parsed.settings, now);
    next.origin = new URL(req.url).origin;
    await store.putReplies(next);
    return reply.json(publicDoc(next, state, clicks, now), 200);
  }

  // "Check now" is a scan request, not a poll: the next tick reads every watched post. A poll from here would run in
  // the dashboard's colo, could read a copy of replies:state up to a minute old and overwrite the cron's result.
  if (first === "poll" && req.method === "POST") {
    if (!store) return reply.fail("not_configured");
    const [config, state, clicks] = await readAll(store);
    config.scanRequestedAt = now.toISOString();
    config.origin = new URL(req.url).origin;
    await store.putReplies(config);
    return reply.json({ scanRequested: true, ...publicDoc(config, state, clicks, now) }, 200);
  }

  if (first && ID_RE.test(first) && req.method === "DELETE") {
    if (!store) return reply.fail("not_configured");
    const config = readAutomations(await store.getReplies<StoredDoc>());
    if (config.automations[first]) {
      delete config.automations[first];
      await store.putReplies(config);
    }
    return reply.json({ ok: true }, 200);
  }

  return null;
}

/* ---------- HTTP: GET /go/:id/:n (public, no bearer) ---------- */

/**
 * Counts the tap (best-effort) and redirects to the button's link. Only owner-saved https links are ever redirected to.
 * Writes go to `replies:clicks` alone (never the automations or the poller's state), at most
 * CLICK_WRITES_PER_DAY a day, and one per visitor per link per minute when a Cache is available.
 */
export async function handleGo(
  req: Request,
  env: SocialEnv,
  id: string,
  n: number,
  now: Date = new Date(),
  cache: Cache | null = null,
): Promise<Response> {
  const store = Store.from(env);
  const config = store ? readAutomations(await store.getReplies<StoredDoc>()) : null;
  const button = config?.automations[id]?.buttons[n];
  if (!store || !button) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const redirect = () =>
    new Response(null, {
      status: 302,
      headers: {
        Location: button.url,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  if (cache) {
    const visitor = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const key = new Request(
      `https://replies.invalid/go/${encodeURIComponent(visitor)}/${encodeURIComponent(id)}/${n}`,
    );
    if (await cache.match(key)) return redirect();
    await cache.put(
      key,
      new Response("1", { headers: { "Cache-Control": `max-age=${GO_THROTTLE_S}` } }),
    );
  }
  const clicks = (await store.getReplyClicks<ClicksDoc>()) ?? emptyClicks();
  const day = riyadhDay(now);
  if (clicks.day !== day) {
    clicks.day = day;
    clicks.today = 0;
  }
  if (clicks.today < CLICK_WRITES_PER_DAY) {
    clicks.today += 1;
    clicks.byAutomation[id] = (clicks.byAutomation[id] ?? 0) + 1;
    // Counted best-effort: a refused write (KV's one write per key per second) never costs the follower the link.
    try {
      await store.putReplyClicks(clicks);
    } catch (e) {
      console.log(JSON.stringify({ go: id, error: String((e as Error)?.message ?? e) }));
    }
  }
  return redirect();
}
