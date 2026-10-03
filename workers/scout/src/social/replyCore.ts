/**
 * 💬 Auto replies, the parts both polls share (planning/tools/14-auto-replies-v2.md): keyword matching and how a
 * reply is built — the link buttons (through the Worker's /go counter), the optional «تابعني» button, the plain-text
 * form, the button template, Instagram's size limits and the random public reply. The comment poll (replies.ts) and
 * the DM poll (inbox.ts) import from here; the dashboard mirrors it in lib/replies.ts.
 */

import type { ReplyButton, ReplyMatch } from "./replies";

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
