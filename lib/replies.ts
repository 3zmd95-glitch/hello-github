import {
  AutoRepliesDocSchema,
  AutoReplySchema,
  type AutoRepliesDoc,
  type AutoReply,
  type ReplyTrigger,
  type SocialStatusMap,
} from "./domain";
import type { ScoutConfig } from "./scoutClient";
import { call, post as jsonPost, type SocialResult, type SocialSyncOpts } from "./socialSync";

/**
 * 💬 Auto-reply rules (our own Smart Reply): how a comment, a DM or a story reply is matched against the owner's
 * keywords, how the reply is built, what blocks saving, and the Worker calls. Pure functions;
 * `components/social/useReplies.ts` holds the fetched document. The Worker
 * (`workers/scout/src/social/replyCore.ts` + `replies.ts`) is the source of truth and runs the same matcher and
 * builders, so what the tester here says is what the Worker will do.
 */

/** Only Instagram has comment replies and DMs in its API (Threads and YouTube: no DMs; TikTok: nothing). */
export const REPLY_PLATFORMS = ["instagram"] as const;

export const KEYWORDS_MAX = 10;
export const KEYWORD_MAX = 40;
export const BUTTONS_MAX = 3;
export const BUTTON_TITLE_MAX = 20;
export const PUBLIC_MAX = 2200;
export const PUBLIC_REPLIES_MAX = 3;
/** Instagram: a text message "must be UTF-8 and be a 1000 bytes or less" (about 500 Arabic letters). */
export const DM_TEXT_BYTES = 1000;
/** The button template's text limit, in characters. */
export const TEMPLATE_TEXT_MAX = 640;
/** Instagram usernames are at most 30 characters; the size check counts «تابعني» with the longest one. */
export const USERNAME_MAX = 30;
export const FOLLOW_TITLE = "تابعني";

/**
 * Comment text and keywords compared loosely: case, Arabic diacritics and tatweel, alef and yaa variants and
 * punctuation/emoji do not matter ("لَت!" matches "لت"). Identical to the Worker's function.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesAutoReply(
  text: string,
  a: Pick<AutoReply, "keywords" | "match">,
): boolean {
  const t = normalizeForMatch(text);
  if (!t) return false;
  return a.keywords.some((k) => {
    const n = normalizeForMatch(k);
    return !!n && (a.match === "exact" ? t === n : t.includes(n));
  });
}

/**
 * The switched-on rule that would answer: for a comment, specific-post rules first, then "any post"; for a DM or
 * a story reply, the oldest message rule. The Worker's order.
 */
export function firstMatch(
  text: string,
  replies: readonly AutoReply[],
  trigger: ReplyTrigger = "comment",
): AutoReply | undefined {
  const on = replies.filter((r) => r.enabled && r.trigger === trigger);
  if (trigger === "message") {
    return [...on]
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
      .find((r) => matchesAutoReply(text, r));
  }
  return (
    on.find((r) => r.postId !== null && matchesAutoReply(text, r)) ??
    on.find((r) => r.postId === null && matchesAutoReply(text, r))
  );
}

/** "لت, lut، preset" → ["لت", "lut", "preset"]: commas (Arabic too) or new lines, trimmed, no duplicates. */
export function splitKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,،\n]/)) {
    const k = raw.trim();
    const n = normalizeForMatch(k);
    if (!k || !n || seen.has(n)) continue;
    seen.add(n);
    out.push(k);
  }
  return out;
}

export function newAutoReply(
  id: string = crypto.randomUUID(),
  trigger: ReplyTrigger = "comment",
): AutoReply {
  return AutoReplySchema.parse({ id, trigger });
}

/* ---------- the reply as the Worker builds it (workers/scout/src/social/replyCore.ts) ---------- */

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export const profileUrl = (username: string): string =>
  `https://www.instagram.com/${encodeURIComponent(username)}/`;

export interface LinkButton {
  title: string;
  url: string;
}

/** The links (through the Worker's /go counter when its origin is known), then «تابعني» when on and known. */
export function messageButtons(
  a: Pick<AutoReply, "id" | "buttons" | "followButton">,
  origin: string | undefined,
  username: string | undefined,
): LinkButton[] {
  const links = a.buttons.map((b, i) => ({
    title: b.title.trim(),
    url: origin ? `${origin}/go/${encodeURIComponent(a.id)}/${i}` : b.url.trim(),
  }));
  return a.followButton && username
    ? [...links, { title: FOLLOW_TITLE, url: profileUrl(username) }]
    : links;
}

/** The plain-text form: the text, then one "title: link" line per button. */
export function textBody(text: string, buttons: readonly LinkButton[]): string {
  const lines = buttons.map((b) => `${b.title}: ${b.url}`);
  return [text.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

/** Bytes left in the DM's plain-text form, counted like the Worker's `dmFits`; negative = too long. */
export function dmBytesLeft(
  a: Pick<AutoReply, "id" | "dmText" | "buttons" | "followButton">,
  origin: string | undefined,
): number {
  return (
    DM_TEXT_BYTES -
    utf8Bytes(textBody(a.dmText, messageButtons(a, origin, "x".repeat(USERNAME_MAX))))
  );
}

export type ReplyProblemCode =
  | "noKeywords"
  | "tooManyKeywords"
  | "keywordTooLong"
  | "noDm"
  | "dmTooLong"
  | "templateTooLong"
  | "publicTooLong"
  | "tooManyPublic"
  | "badUrl"
  | "noTitle"
  | "tooManyButtons"
  | "notConnected"
  | "noPermission";

export interface ReplyProblem {
  code: ReplyProblemCode;
  max?: number;
}

const isHttps = (s: string): boolean => {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};

/** What keeps a rule from being saved (the Worker's rules), plus the account state. */
export function replyProblems(
  a: AutoReply,
  status: SocialStatusMap | null,
  origin?: string,
): ReplyProblem[] {
  const out: ReplyProblem[] = [];
  const keywords = a.keywords.filter((k) => normalizeForMatch(k));
  if (!keywords.length) out.push({ code: "noKeywords" });
  else if (keywords.length > KEYWORDS_MAX) out.push({ code: "tooManyKeywords" });
  else if (keywords.some((k) => k.trim().length > KEYWORD_MAX)) {
    out.push({ code: "keywordTooLong", max: KEYWORD_MAX });
  }
  const buttonCount = a.buttons.length + (a.followButton ? 1 : 0);
  if (!a.dmText.trim()) out.push({ code: "noDm" });
  else if (dmBytesLeft(a, origin) < 0) out.push({ code: "dmTooLong" });
  else if (buttonCount && a.dmText.trim().length > TEMPLATE_TEXT_MAX) {
    out.push({ code: "templateTooLong", max: TEMPLATE_TEXT_MAX });
  }
  if (a.trigger === "comment") {
    if (a.publicReplies.length > PUBLIC_REPLIES_MAX) {
      out.push({ code: "tooManyPublic", max: PUBLIC_REPLIES_MAX });
    }
    if (a.publicReplies.some((r) => r.length > PUBLIC_MAX)) {
      out.push({ code: "publicTooLong", max: PUBLIC_MAX });
    }
  }
  if (buttonCount > BUTTONS_MAX) out.push({ code: "tooManyButtons" });
  if (a.buttons.some((b) => !b.title.trim())) out.push({ code: "noTitle" });
  if (a.buttons.some((b) => !isHttps(b.url.trim()))) out.push({ code: "badUrl" });
  if (status) {
    const ig = status.instagram;
    if (!ig?.connected) out.push({ code: "notConnected" });
    else if (!ig.canReply) out.push({ code: "noPermission" });
  }
  return out;
}

/** What keeps the default reply from being saved (the Worker's rule). */
export function defaultReplyProblems(d: { enabled: boolean; text: string }): ReplyProblem[] {
  const text = d.text.trim();
  if (d.enabled && !text) return [{ code: "noDm" }];
  if (utf8Bytes(text) > DM_TEXT_BYTES) return [{ code: "dmTooLong" }];
  return [];
}

/** The DM as the Worker sends it: the text, then one "title: link" line per button (via /go when known). */
export function dmPreview(
  a: Pick<AutoReply, "id" | "dmText" | "buttons" | "followButton">,
  origin?: string,
): string {
  return textBody(a.dmText, messageButtons(a, origin, undefined));
}

/** Click-through rate in whole percent, or null before the first send. */
export function ctr(sends: number, clicks: number): number | null {
  if (sends <= 0) return null;
  return Math.round((clicks / sends) * 100);
}

/** The `POST /social/replies` body: what the owner typed, tidied; the Worker keeps its own counters. */
export function replyInput(a: AutoReply): Record<string, unknown> {
  const onPost = a.trigger === "comment";
  return {
    id: a.id,
    enabled: a.enabled,
    trigger: a.trigger,
    postId: onPost ? a.postId : null,
    ...(onPost && a.permalink ? { permalink: a.permalink } : {}),
    ...(onPost && a.title ? { title: a.title } : {}),
    ...(onPost && a.thumbUrl ? { thumbUrl: a.thumbUrl } : {}),
    keywords: a.keywords.map((k) => k.trim()).filter((k) => normalizeForMatch(k)),
    match: a.match,
    publicReplies: onPost ? a.publicReplies.map((r) => r.trim()).filter(Boolean) : [],
    dmText: a.dmText.trim(),
    buttons: a.buttons.map((b) => ({ title: b.title.trim(), url: b.url.trim() })),
    followButton: a.followButton,
  };
}

/** The Worker's document with only the parts the dashboard understands; null when unreadable. */
export function parseRepliesDoc(raw: unknown): AutoRepliesDoc | null {
  const parsed = AutoRepliesDocSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* ---------- Worker calls (`/social/replies`) ---------- */

export async function repliesList(
  config: ScoutConfig | null,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ doc: AutoRepliesDoc }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/replies", {}, opts);
  if (!r.ok) return r;
  const doc = parseRepliesDoc(r.data);
  return doc ? { ok: true, doc } : { ok: false, error: { type: "upstream" } };
}

export async function repliesSave(
  config: ScoutConfig | null,
  automation: AutoReply,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ automation: AutoReply }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/replies", jsonPost(replyInput(automation)), opts);
  if (!r.ok) return r;
  const parsed = AutoReplySchema.safeParse((r.data as { automation?: unknown })?.automation);
  return parsed.success
    ? { ok: true, automation: parsed.data }
    : { ok: false, error: { type: "upstream" } };
}

export async function repliesDelete(
  config: ScoutConfig | null,
  id: string,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<object>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(
    config,
    `/social/replies/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    opts,
  );
  return r.ok ? { ok: true } : r;
}

export interface RepliesSettings {
  paused?: boolean;
  defaultReply?: { enabled: boolean; text: string };
}

/** `POST /social/replies/settings`: pause all, or the default reply; answers with the fresh document. */
export async function repliesSettings(
  config: ScoutConfig | null,
  settings: RepliesSettings,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ doc: AutoRepliesDoc }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/replies/settings", jsonPost(settings), opts);
  if (!r.ok) return r;
  const doc = parseRepliesDoc(r.data);
  return doc ? { ok: true, doc } : { ok: false, error: { type: "upstream" } };
}

export interface PollOutcome {
  checked: number;
  sent: number;
  failed: number;
  /** Why the Worker did nothing (`locked` = a check is already running). */
  skipped?: string;
}

/** `POST /social/replies/poll`: read the comments now; answers with the outcome and the fresh document. */
export async function repliesPoll(
  config: ScoutConfig | null,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ doc: AutoRepliesDoc; outcome: PollOutcome }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/replies/poll", jsonPost({}), opts);
  if (!r.ok) return r;
  const doc = parseRepliesDoc(r.data);
  const raw = (
    r.data as {
      result?: { checked?: unknown; sent?: unknown; failed?: unknown; skipped?: unknown };
    }
  )?.result;
  if (!doc) return { ok: false, error: { type: "upstream" } };
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    ok: true,
    doc,
    outcome: {
      checked: typeof raw?.checked === "number" ? raw.checked : 0,
      sent: count(raw?.sent),
      failed: count(raw?.failed),
      ...(typeof raw?.skipped === "string" ? { skipped: raw.skipped } : {}),
    },
  };
}
