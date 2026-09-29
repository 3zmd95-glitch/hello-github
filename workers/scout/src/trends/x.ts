/**
 * X (Twitter) trends for Saudi Arabia from trends24.in (round 30, planning/tools/08-trends.md): the first
 * (latest) hourly snapshot list of the page, top 30, labelled "trends24.in". OFF by default: the owner
 * enables it by adding `x` to `TREND_SOURCES` after agreeing to read the site with attribution (no terms
 * page could be found; getdaytrends, which forbids it, stays a manual link).
 */

import {
  cleanText,
  DAY_MS,
  decodeEntities,
  fetchText,
  isoPlus,
  langOfText,
  parseVolume,
  rankScore,
  slugify,
  trendId,
  UA,
} from "./normalize";
import { SOURCE_LABELS, type SourceCtx, type SourceOutput, type TrendItem } from "./types";

export const TRENDS24_URL = "https://trends24.in/saudi-arabia/";
export const X_MAX = 30;
/** Hourly snapshots: a row not refreshed within a day is gone. */
export const X_TTL_MS = DAY_MS;

export interface XRow {
  name: string;
  url?: string;
  /** Tweet count as printed ("12K"), when the page shows one. */
  count?: number;
}

/**
 * The first `<ol class=trend-card__list>` (the newest snapshot); each `<li>` holds
 * `<a href="…" class=trend-link>NAME</a>` and a `<span class=tweet-count data-count="…">`.
 */
export function parseTrends24(html: string): XRow[] {
  const start = html.search(/<ol[^>]*class=["']?trend-card__list["']?[^>]*>/);
  if (start < 0) return [];
  const end = html.indexOf("</ol>", start);
  const list = html.slice(start, end < 0 ? undefined : end);
  const rows: XRow[] = [];
  for (const m of list.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const li = m[1];
    const a = li.match(
      /<a\s+href=["']([^"']+)["'][^>]*class=["']?trend-link["']?[^>]*>([\s\S]*?)<\/a>/,
    );
    if (!a) continue;
    const name = cleanText(a[2]);
    if (!name) continue;
    const count = li.match(/data-count=["']([^"']*)["']/)?.[1];
    rows.push({ name, url: decodeEntities(a[1]), count: parseVolume(count) });
  }
  return rows;
}

export function xItems(rows: XRow[], now: Date): TrendItem[] {
  const top = rows.slice(0, X_MAX);
  const seenAt = now.toISOString();
  const expiresAt = isoPlus(now, X_TTL_MS);
  return top.map((r, i) => ({
    id: trendId("x", "SA", slugify(r.name)),
    platform: "x",
    region: "SA",
    lang: langOfText(r.name),
    title: r.name,
    url: r.url ?? `https://x.com/search?q=${encodeURIComponent(r.name)}`,
    score: rankScore(i + 1, top.length),
    volume: r.count,
    source: SOURCE_LABELS.x,
    seenAt,
    expiresAt,
    tags: r.name.startsWith("#") ? ["hashtag"] : [],
  }));
}

/** One call. */
export async function runX(ctx: SourceCtx): Promise<SourceOutput> {
  const r = await fetchText(ctx.fetch, ctx.budget, TRENDS24_URL, { headers: { "User-Agent": UA } });
  if (!r.ok) return { ok: false, error: `http ${r.status}` };
  const rows = parseTrends24(r.text);
  if (!rows.length) return { ok: false, error: "no list" };
  return { ok: true, items: xItems(rows, ctx.now) };
}
