/**
 * TikTok trending sounds from kworb.net (round 30, planning/tools/08-trends.md), SA and US: a plain HTML
 * table (`Pos | P+ | Artist - Title`), top 30 each, labelled "kworb.net" (a third-party aggregator, not
 * TikTok's own list). OFF by default: the owner enables it by adding `kworb` to `TREND_SOURCES` once he has
 * agreed to read the site with attribution (question 3 of the mastermind handover).
 */

import {
  cleanText,
  DAY_MS,
  fetchText,
  isoPlus,
  langForRegion,
  rankScore,
  slugify,
  trendId,
  UA,
} from "./normalize";
import {
  SOURCE_LABELS,
  type SourceCtx,
  type SourceOutput,
  type TrendItem,
  type TrendRegion,
} from "./types";

export const KWORB_MAX = 30;
export const KWORB_TTL_MS = 2 * DAY_MS;
export const KWORB_REGIONS: readonly { region: TrendRegion; url: string }[] = [
  { region: "SA", url: "https://kworb.net/charts/tiktok/sa.html" },
  { region: "US", url: "https://kworb.net/charts/tiktok/us.html" },
];

export interface KworbRow {
  pos: number;
  /** "=", "+1", "-2", "NEW", … as the page prints it. */
  change: string;
  title: string;
}

/** `<tr><td>1</td><td>=</td><td class="mp text"><div>Artist - Title</div></td></tr>` rows, in page order. */
export function parseKworb(html: string): KworbRow[] {
  const rows: KworbRow[] = [];
  const re = /<tr>\s*<td>(\d+)<\/td>\s*<td>([^<]*)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
  for (const m of html.matchAll(re)) {
    const title = cleanText(m[3]);
    if (!title) continue;
    rows.push({ pos: Number(m[1]), change: m[2].trim() || "=", title });
  }
  return rows;
}

export function tiktokSearchUrl(title: string): string {
  return `https://www.tiktok.com/search?q=${encodeURIComponent(title)}`;
}

export function kworbItems(rows: KworbRow[], region: TrendRegion, now: Date): TrendItem[] {
  const top = rows.slice(0, KWORB_MAX);
  const seenAt = now.toISOString();
  const expiresAt = isoPlus(now, KWORB_TTL_MS);
  return top.map((r, i) => ({
    id: trendId("tiktok", region, slugify(r.title)),
    platform: "tiktok",
    region,
    lang: langForRegion(region),
    title: r.title,
    url: tiktokSearchUrl(r.title),
    score: rankScore(i + 1, top.length),
    source: SOURCE_LABELS.kworb,
    // A NEW row gets no English "why": the `new` tag is what the dashboard translates.
    why: r.change === "NEW" ? undefined : `#${r.pos} (${r.change})`,
    seenAt,
    expiresAt,
    tags: ["sound", ...(r.change === "NEW" ? ["new"] : [])],
  }));
}

/** Both charts (2 calls). */
export async function runKworb(ctx: SourceCtx): Promise<SourceOutput> {
  const items: TrendItem[] = [];
  for (const { region, url } of KWORB_REGIONS) {
    const r = await fetchText(ctx.fetch, ctx.budget, url, { headers: { "User-Agent": UA } });
    if (!r.ok) return { ok: false, error: `${region}: http ${r.status}` };
    const rows = parseKworb(r.text);
    if (!rows.length) return { ok: false, error: `${region}: no table` };
    items.push(...kworbItems(rows, region, ctx.now));
  }
  return { ok: true, items };
}
