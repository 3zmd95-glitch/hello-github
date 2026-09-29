import {
  AutoRepliesDocSchema,
  AutoReplySchema,
  type AutoRepliesDoc,
  type AutoReply,
  type SocialStatusMap,
} from "./domain";
import type { ScoutConfig } from "./scoutClient";
import { call, post as jsonPost, type SocialResult, type SocialSyncOpts } from "./socialSync";

/**
 * 💬 Auto-reply rules (a copy of Beacons' Smart Reply): how a comment is matched against the owner's keywords,
 * what blocks saving, the DM preview, and the Worker calls. Pure functions; `components/social/useReplies.ts`
 * holds the fetched document. The Worker (`workers/scout/src/social/replies.ts`) is the source of truth and
 * runs the same matcher, so what the tester here says is what the Worker will do.
 */

/** Only Instagram has comment replies and DMs in its API (Threads and YouTube: no DMs; TikTok: nothing). */
export const REPLY_PLATFORMS = ["instagram"] as const;

export const KEYWORDS_MAX = 10;
export const KEYWORD_MAX = 40;
export const BUTTONS_MAX = 3;
export const BUTTON_TITLE_MAX = 20;
export const DM_MAX = 1000;
export const PUBLIC_MAX = 2200;

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

/** The switched-on automation that would answer a comment: specific-post ones first, then "any post". */
export function firstMatch(text: string, replies: readonly AutoReply[]): AutoReply | undefined {
  const on = replies.filter((r) => r.enabled);
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

export function newAutoReply(id: string = crypto.randomUUID()): AutoReply {
  return AutoReplySchema.parse({ id });
}

export type ReplyProblemCode =
  | "noKeywords"
  | "tooManyKeywords"
  | "keywordTooLong"
  | "noDm"
  | "dmTooLong"
  | "publicTooLong"
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

/** What keeps an automation from being saved (the same rules the Worker enforces), plus the account state. */
export function replyProblems(a: AutoReply, status: SocialStatusMap | null): ReplyProblem[] {
  const out: ReplyProblem[] = [];
  const keywords = a.keywords.filter((k) => normalizeForMatch(k));
  if (!keywords.length) out.push({ code: "noKeywords" });
  else if (keywords.length > KEYWORDS_MAX) out.push({ code: "tooManyKeywords" });
  else if (keywords.some((k) => k.trim().length > KEYWORD_MAX)) {
    out.push({ code: "keywordTooLong", max: KEYWORD_MAX });
  }
  if (!a.dmText.trim()) out.push({ code: "noDm" });
  else if (a.dmText.length > DM_MAX) out.push({ code: "dmTooLong", max: DM_MAX });
  if (a.publicReply.length > PUBLIC_MAX) out.push({ code: "publicTooLong", max: PUBLIC_MAX });
  if (a.buttons.length > BUTTONS_MAX) out.push({ code: "tooManyButtons" });
  if (a.buttons.some((b) => !b.title.trim())) out.push({ code: "noTitle" });
  if (a.buttons.some((b) => !isHttps(b.url.trim()))) out.push({ code: "badUrl" });
  if (status) {
    const ig = status.instagram;
    if (!ig?.connected) out.push({ code: "notConnected" });
    else if (!ig.canReply) out.push({ code: "noPermission" });
  }
  return out;
}

/** The DM as the Worker sends it: the text, then one "title: link" line per button (via /go when known). */
export function dmPreview(a: Pick<AutoReply, "id" | "dmText" | "buttons">, origin?: string): string {
  const lines = a.buttons.map(
    (b, i) =>
      `${b.title.trim()}: ${origin ? `${origin}/go/${encodeURIComponent(a.id)}/${i}` : b.url.trim()}`,
  );
  return [a.dmText.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

/** Click-through rate in whole percent, or null before the first send. */
export function ctr(sends: number, clicks: number): number | null {
  if (sends <= 0) return null;
  return Math.round((clicks / sends) * 100);
}

/** The `POST /social/replies` body: what the owner typed, tidied; the Worker keeps its own counters. */
export function replyInput(a: AutoReply): Record<string, unknown> {
  return {
    id: a.id,
    enabled: a.enabled,
    postId: a.postId,
    ...(a.permalink ? { permalink: a.permalink } : {}),
    ...(a.title ? { title: a.title } : {}),
    ...(a.thumbUrl ? { thumbUrl: a.thumbUrl } : {}),
    keywords: a.keywords.map((k) => k.trim()).filter((k) => normalizeForMatch(k)),
    match: a.match,
    publicReply: a.publicReply.trim(),
    dmText: a.dmText.trim(),
    buttons: a.buttons.map((b) => ({ title: b.title.trim(), url: b.url.trim() })),
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
