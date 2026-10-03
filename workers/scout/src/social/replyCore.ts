/**
 * 💬 Auto replies, the parts both polls share (planning/tools/14-auto-replies-v2.md): keyword matching and how a
 * reply is built — the link buttons (through the Worker's /go counter), the optional «تابعني» button, the plain-text
 * form, the button template, Instagram's size limits and the random public reply; then how Instagram's refusals are
 * read (with the retry and stop policy) and the send call itself. The comment poll (replies.ts) and the DM poll
 * (inbox.ts) import from here; the dashboard mirrors the matching and the building in lib/replies.ts.
 */

import { fetchJson, type Http, type JsonReply } from "./http";
import { IG_API } from "./instagram";
import { metaBody, type MetaError } from "./meta";
import type { ReplyButton, ReplyMatch } from "./replies";
import { SocialError } from "./types";

/** Instagram: a text message "must be UTF-8 and be a 1000 bytes or less" (about 500 Arabic letters). */
export const DM_TEXT_BYTES = 1000;
/** The button template's text limit, in characters. */
export const TEMPLATE_TEXT_MAX = 640;
/** Instagram usernames are at most 30 characters; the size check counts «تابعني» with the longest one. */
export const USERNAME_MAX = 30;
/** The follow invitation's button title. */
export const FOLLOW_TITLE = "تابعني";
/** The stats key and log id of the default reply (never an automation id). */
export const DEFAULT_STATS_ID = "default";

/* ---------- matching ---------- */

/**
 * Comment text and keywords compared loosely: case, Arabic diacritics and tatweel, alef and yaa variants and
 * punctuation/emoji do not matter ("لَت!" matches "لت"). Same function in the dashboard (lib/replies.ts).
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

export function matches(
  text: string,
  a: { keywords: readonly string[]; match: ReplyMatch },
): boolean {
  const t = normalizeForMatch(text);
  if (!t) return false;
  return a.keywords.some((k) => {
    const n = normalizeForMatch(k);
    return !!n && (a.match === "exact" ? t === n : t.includes(n));
  });
}

/* ---------- building a reply ---------- */

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export const profileUrl = (username: string): string =>
  `https://www.instagram.com/${encodeURIComponent(username)}/`;

/** A button as Instagram gets it. */
export interface LinkButton {
  title: string;
  url: string;
}

/**
 * The reply's buttons: the owner's links (through `/go/:id/:n`, which counts the tap, when the Worker's origin is
 * known), then «تابعني» when it is switched on and the account's username is known (no username, no button).
 */
export function messageButtons(
  a: { id: string; buttons: readonly ReplyButton[]; followButton?: boolean },
  origin: string | undefined,
  username: string | undefined,
): LinkButton[] {
  const links = a.buttons.map((b, i) => ({
    title: b.title,
    url: origin ? `${origin}/go/${encodeURIComponent(a.id)}/${i}` : b.url,
  }));
  return a.followButton && username
    ? [...links, { title: FOLLOW_TITLE, url: profileUrl(username) }]
    : links;
}

/** The plain-text form: the text, then one "title: link" line per button (v1's DM, and the template fallback). */
export function textBody(text: string, buttons: readonly LinkButton[]): string {
  const lines = buttons.map((b) => `${b.title}: ${b.url}`);
  return [text.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

/** The Send API's `message`: plain text without buttons, else a button template. */
export function messagePayload(
  text: string,
  buttons: readonly LinkButton[],
): Record<string, unknown> {
  if (!buttons.length) return { text: text.trim() };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.trim(),
        buttons: buttons.map((b) => ({ type: "web_url", url: b.url, title: b.title })),
      },
    },
  };
}

/**
 * Whether a DM fits Instagram's limits in both forms it may take: the plain text with its link lines (also what a
 * refused template falls back to) within 1,000 bytes, counting «تابعني» with the longest possible username, and a
 * template's text within 640 characters.
 */
export function dmFits(
  a: { id: string; dmText: string; buttons: readonly ReplyButton[]; followButton?: boolean },
  origin: string | undefined,
): boolean {
  const buttons = messageButtons(a, origin, "x".repeat(USERNAME_MAX));
  if (utf8Bytes(textBody(a.dmText, buttons)) > DM_TEXT_BYTES) return false;
  return !buttons.length || a.dmText.trim().length <= TEMPLATE_TEXT_MAX;
}

/** One of the non-blank public replies, at random (identical replies at volume read as spam). */
export function pickPublicReply(
  replies: readonly string[],
  random: () => number = Math.random,
): string | undefined {
  const usable = replies.map((r) => r.trim()).filter(Boolean);
  return usable.length ? usable[Math.floor(random() * usable.length)] : undefined;
}

/* ---------- errors ---------- */

export type ReplyErrorCode =
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "rate_limited"
  /** Instagram refused (the platform's words in `detail`). */
  | "rejected"
  | "upstream"
  /** Instagram takes no private reply to this comment: too old, already answered, deleted, or blocked. */
  | "not_eligible";

export class ReplyError extends Error {
  constructor(
    readonly code: ReplyErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = "ReplyError";
  }
}

/**
 * Meta's messaging errors, code 10 = "permission denied", carry subcodes that say whose problem it is:
 *   app-level (the token lacks the permission)      → no_permission, nothing else works this tick
 *   this conversation (outside the messaging window) → not_eligible, final for this comment
 *   this recipient (cannot receive messages now)    → rejected, final for this comment
 * Code 100 with subcode 2534025 is the private-reply refusal itself ("The comment is invalid for a private
 * reply": older than 7 days, already answered privately, deleted, or the account blocks message requests).
 */
const APP_PERMISSION_SUBCODES = new Set([1404170, 2534077, 1893063]);
const WINDOW_SUBCODES = new Set([2534022, 2018278, 2018065]);
const PRIVATE_REPLY_INVALID = { code: 100, subcode: 2534025 };

/** A Graph reply as a body; refusals keep Instagram's words, permission problems get their own codes. */
export function graph<T extends MetaError>(reply: JsonReply<T>, what: string): T {
  const err = reply.body?.error;
  if (err?.code === PRIVATE_REPLY_INVALID.code && err.error_subcode === PRIVATE_REPLY_INVALID.subcode) {
    throw new ReplyError("not_eligible", err.message);
  }
  if (err?.code === 10) {
    const sub = err.error_subcode;
    if (sub !== undefined && WINDOW_SUBCODES.has(sub)) throw new ReplyError("not_eligible", err.message);
    if (sub === undefined || APP_PERMISSION_SUBCODES.has(sub)) {
      throw new ReplyError("no_permission", err.message ?? `${what}: permission denied`);
    }
    throw new ReplyError("rejected", err.message ?? `${what}: ${sub}`);
  }
  try {
    return metaBody(reply, what);
  } catch (e) {
    if (!(e instanceof SocialError)) throw e;
    // The log shows Instagram's own words, not our code prefixes.
    const words = err?.message ?? `${what}: ${reply.status}`;
    if (e.code === "upstream" && reply.status >= 400 && reply.status < 500) {
      throw new ReplyError("rejected", words);
    }
    if (e.code === "token_expired" || e.code === "rate_limited") throw new ReplyError(e.code, words);
    throw e;
  }
}

export function toReplyCode(e: unknown): { code: ReplyErrorCode; detail?: string; transient: boolean } {
  if (e instanceof ReplyError) {
    return {
      code: e.code,
      detail: e.message,
      transient: e.code === "upstream" || e.code === "rate_limited",
    };
  }
  if (e instanceof SocialError) {
    const code: ReplyErrorCode =
      e.code === "token_expired" || e.code === "rate_limited" || e.code === "not_connected"
        ? e.code
        : "upstream";
    return { code, detail: e.message, transient: code === "upstream" || code === "rate_limited" };
  }
  return { code: "upstream", detail: String((e as Error)?.message ?? e), transient: true };
}

/** A glitching comment or message is tried this many times, then given up on. */
export const MAX_RETRIES = 3;
/** Codes after which nothing else will work this tick. */
export const TICK_STOPPERS: ReadonlySet<ReplyErrorCode> = new Set<ReplyErrorCode>([
  "token_expired",
  "rate_limited",
  "no_permission",
  "not_connected",
]);
/** Log entries keep this much of the comment or message. */
export const LOG_TEXT_CLIP = 120;

/* ---------- sending ---------- */

/** Where a reply goes: a person (inside the 24-hour window) or, for the private reply, a comment. */
export type Recipient = { id: string } | { comment_id: string };

export interface SendTarget {
  http: Http;
  /** The professional account id (`user_id` from GET /me). */
  igUserId: string;
  token: string;
}

/**
 * Sends one reply and returns the Send API's message id. With buttons it is a button template; a private reply
 * whose template Instagram refuses (code 100 with any subcode but 2534025, "already answered") goes once more as
 * plain text with "title: link" lines — a refused call does not use up the comment's one private reply. Throws
 * like `graph`.
 */
export async function sendReply(
  t: SendTarget,
  recipient: Recipient,
  text: string,
  buttons: readonly LinkButton[],
): Promise<string | undefined> {
  const post = (message: Record<string, unknown>) =>
    fetchJson<MetaError & { message_id?: string }>(t.http, `${IG_API}/${t.igUserId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ recipient, message }),
    });
  let reply = await post(messagePayload(text, buttons));
  const err = reply.body?.error;
  const templateRefused =
    buttons.length > 0 &&
    "comment_id" in recipient &&
    err?.code === 100 &&
    err.error_subcode !== PRIVATE_REPLY_INVALID.subcode;
  if (templateRefused && t.http.budget.ok) reply = await post({ text: textBody(text, buttons) });
  return graph(reply, "dm").message_id;
}
