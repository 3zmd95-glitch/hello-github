/**
 * Pure helpers shared by the trend sources (round 30, planning/tools/08-trends.md): ids, rank scores, text
 * clean-up, the budgeted text fetch, and the merge that builds the next `trends:latest` document.
 */

import { Budget } from "../social/http";
import type { TrendItem, TrendLang, TrendPlatform, TrendRegion, TrendSourceLabel } from "./types";

/** The feed never holds more than this many rows (all sources together). */
export const MAX_ITEMS = 200;
export const SLUG_MAX = 80;

/** Letters and digits of any script stay; everything else becomes one "-". */
export function slugify(text: string): string {
  return text
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** "<platform>:<region>:<slug>": stable across runs for the same row of the same source. */
export function trendId(platform: TrendPlatform, region: TrendRegion, slug: string): string {
  return `${platform}:${region}:${slug || "untitled"}`;
}

/** Rank 1 = 100, linear down the list (rank `total` = 100 / total), rounded. */
export function rankScore(rank: number, total: number): number {
  if (total <= 0 || rank < 1) return 0;
  const r = Math.min(rank, total);
  return Math.max(0, Math.min(100, Math.round((100 * (total - r + 1)) / total)));
}

export const ARABIC_RE = /[؀-ۿ]/;

export function hasArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

/** The region decides the tab a row shows in: SA rows are `ar`, US rows `en`, global rows `mixed`. */
export function langForRegion(region: TrendRegion): TrendLang {
  return region === "SA" ? "ar" : region === "US" ? "en" : "mixed";
}

/** `ar` when the text has Arabic letters, else `en` (hashtags, scan hits). */
export function langOfText(text: string): TrendLang {
  return hasArabic(text) ? "ar" : "en";
}

/** Decodes the few entities feeds and pages use (no DOMParser in Workers). */
export function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Tags stripped, whitespace collapsed, entities decoded. */
export function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** At most `max` characters on one line; undefined when empty. */
export function oneLine(text: string | undefined, max = 160): string | undefined {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** "20000+" → 20000, "12K" → 12000, "1.2M" → 1200000, "1,234" → 1234; undefined when nothing parses. */
export function parseVolume(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*([kKmM])?/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return Math.round(n * mult);
}

export function isoPlus(now: Date, ms: number): string {
  return new Date(now.getTime() + ms).toISOString();
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Removes `undefined` fields so the stored document equals what the dashboard receives. */
export function compactItem(item: TrendItem): TrendItem {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (v !== undefined) out[k] = v;
  return out as unknown as TrendItem;
}

/* ---------- fetch ---------- */

export interface TextReply {
  status: number;
  ok: boolean;
  text: string;
}

/** The time limit of one outbound call, body included: a hung site must not stall the sources after it. */
export const FETCH_TIMEOUT_MS = 12_000;

/**
 * One budgeted call whose body is read as text (JSON, XML and HTML sources alike). Transport failures and
 * the time limit (`timeoutMs`, which covers the body read too) throw a plain Error; HTTP errors are returned
 * for the caller to judge. Not `http.fetch(url)`: see social/http.ts.
 */
export async function fetchText(
  doFetch: typeof fetch,
  budget: Budget,
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<TextReply> {
  if (!budget.ok) throw new Error("budget");
  budget.take();
  try {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } catch {
    throw new Error(`fetch failed: ${new URL(url).host}`);
  }
}

/** A browser-like User-Agent: Google Trends, kworb and trends24 answer plain clients with it. */
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

/* ---------- merge ---------- */

const time = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/** Score desc (unscored last), then seenAt desc; stable for equal keys. */
export function sortItems(items: TrendItem[]): TrendItem[] {
  return [...items].sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sa !== sb) return sb - sa;
    const ta = time(a.seenAt) || 0;
    const tb = time(b.seenAt) || 0;
    return tb - ta;
  });
}

/** One row per id; on a clash the higher score wins (a video in two YouTube charts keeps its best rank). */
export function dedupe(items: TrendItem[]): TrendItem[] {
  const byId = new Map<string, TrendItem>();
  for (const item of items) {
    const had = byId.get(item.id);
    if (!had || (item.score ?? -1) > (had.score ?? -1)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function isExpired(item: TrendItem, now: Date): boolean {
  const t = time(item.expiresAt);
  return Number.isFinite(t) && t <= now.getTime();
}

/**
 * The next feed's rows: `fresh` replaces every stored row of the sources in `replaced` (the ones that ran
 * now, whether they succeeded or not — a failed source keeps its old rows), the other sources' rows stay
 * until their own next run or their `expiresAt`, and the result is deduped, sorted and capped. A fresh row
 * whose id was already stored keeps the stored `seenAt` (first seen), so "new this week" stays honest.
 */
export function mergeItems(
  existing: TrendItem[],
  fresh: TrendItem[],
  replaced: ReadonlySet<TrendSourceLabel>,
  now: Date,
): TrendItem[] {
  // An expired row that comes back is new again.
  const firstSeen = new Map<string, string>();
  for (const i of existing) {
    if (i.seenAt && !isExpired(i, now) && !firstSeen.has(i.id)) firstSeen.set(i.id, i.seenAt);
  }
  const kept = existing.filter((i) => !replaced.has(i.source) && !isExpired(i, now));
  const freshIds = new Set(fresh.map((i) => i.id));
  const merged = [
    ...fresh.map((i) => ({ ...i, seenAt: firstSeen.get(i.id) ?? i.seenAt })),
    ...kept.filter((i) => !freshIds.has(i.id)),
  ];
  return sortItems(dedupe(merged.map(compactItem))).slice(0, MAX_ITEMS);
}
