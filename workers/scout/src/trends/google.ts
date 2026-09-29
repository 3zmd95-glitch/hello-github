/**
 * Google Trends "Trending now" for SA (Arabic tab) and US (English tab), round 30, planning/tools/08-trends.md.
 *
 * Primary: the `batchexecute` RPC the trending page itself loads (`rpcid i0OFE`, unofficial). Probed live on
 * 2026-09-28 from a residential Windows IP: the answer starts with `)]}'`, then a JSON array whose first row
 * is `["wrb.fr","i0OFE","<json string>", …]`; that string parses to `[null, rows]` and each row is
 *
 *   [title, null, geo, [startUnix], [endUnix] | null, null, approxVolume, null, growthPct,
 *    relatedQueries[], categoryIds[], [[newsId, lang, geo], …], title]
 *
 * (13 cells; SA gave 66 rows for 24 h, US 367). The RPC has no headlines, so the RSS feed
 * (`/trending/rss?geo=…`, 10 items with `ht:approx_traffic`, `ht:news_item_*`, `ht:picture`) is fetched
 * too and merged by title for `why`, `url` and `thumb`. RSS alone (RPC failed) → `degraded`.
 */

import {
  cleanText,
  decodeEntities,
  DAY_MS,
  fetchText,
  isoPlus,
  langForRegion,
  oneLine,
  parseVolume,
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

export const GOOGLE_RPC_URL = "https://trends.google.com/_/TrendsUi/data/batchexecute";
export const GOOGLE_RSS_URL = "https://trends.google.com/trending/rss";
/** Rows kept per region (the RPC returns hundreds for the US). */
export const GOOGLE_MAX_PER_REGION = 25;
/** Hours of the RPC window. */
export const GOOGLE_HOURS = 24;
/** A Google row stays this long when the source cannot be refreshed (429 from a Cloudflare IP, say). */
export const GOOGLE_TTL_MS = 2 * DAY_MS;

export const GOOGLE_REGIONS: readonly { region: TrendRegion; geo: string; hl: string }[] = [
  { region: "SA", geo: "SA", hl: "ar" },
  { region: "US", geo: "US", hl: "en-US" },
];

export interface GoogleRpcRow {
  title: string;
  startUnix?: number;
  /** Set when Google marks the trend as over. */
  endUnix?: number;
  volume?: number;
  growthPct?: number;
  related: string[];
}

export interface GoogleRssItem {
  title: string;
  volume?: number;
  picture?: string;
  newsTitle?: string;
  newsUrl?: string;
  newsSource?: string;
}

/** The `f.req` form field for one region (the shape trendflow-js documents). */
export function googleRpcBody(geo: string, hl: string, hours = GOOGLE_HOURS): string {
  const inner = JSON.stringify([null, null, geo, 0, hl, hours, 1]);
  const outer = JSON.stringify([[["i0OFE", inner, null, "generic"]]]);
  return new URLSearchParams({ "f.req": outer }).toString();
}

export function googleRpcUrl(hl: string): string {
  return `${GOOGLE_RPC_URL}?rpcids=i0OFE&source-path=%2Ftrending&hl=${encodeURIComponent(hl)}`;
}

const num = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;

/**
 * The JSON arrays of a batchexecute body: one array as probed, or (chunked framing) several, each on its
 * own line after a byte-count line.
 */
function rpcChunks(body: string): unknown[] {
  try {
    return [JSON.parse(body)];
  } catch {
    const out: unknown[] = [];
    for (const line of body.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || /^\d+$/.test(l)) continue;
      try {
        out.push(JSON.parse(l));
      } catch {
        // Not a chunk; skip.
      }
    }
    return out;
  }
}

/** Parses the RPC answer; throws on any shape it does not recognise (the caller then falls back). */
export function parseGoogleRpc(raw: string): GoogleRpcRow[] {
  const body = raw.replace(/^\)\]\}'/, "").trim();
  const rowsOfChunks = rpcChunks(body).flatMap((c) => (Array.isArray(c) ? c : []));
  const row = rowsOfChunks.find(
    (r): r is unknown[] => Array.isArray(r) && r[0] === "wrb.fr" && r[1] === "i0OFE",
  );
  if (!row || typeof row[2] !== "string") throw new Error("rpc: no i0OFE row");
  const inner = JSON.parse(row[2]) as unknown;
  const rows = Array.isArray(inner) && Array.isArray(inner[1]) ? (inner[1] as unknown[]) : null;
  if (!rows) throw new Error("rpc: no rows");
  const out: GoogleRpcRow[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || typeof r[0] !== "string" || !r[0].trim()) continue;
    const start = Array.isArray(r[3]) ? num(r[3][0]) : undefined;
    const end = Array.isArray(r[4]) ? num(r[4][0]) : undefined;
    const related = Array.isArray(r[9])
      ? r[9].filter((q): q is string => typeof q === "string" && q.trim() !== "")
      : [];
    out.push({
      title: r[0].trim(),
      startUnix: start,
      endUnix: end,
      volume: num(r[6]),
      growthPct: num(r[8]),
      related,
    });
  }
  if (!out.length) throw new Error("rpc: empty");
  return out;
}

const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() || undefined : undefined;
};

/** Parses the RSS feed with regexes (Workers have no DOMParser). Items without a title are skipped. */
export function parseGoogleRss(xml: string): GoogleRssItem[] {
  const items: GoogleRssItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = tag(block, "title");
    if (!title) continue;
    const news = block.match(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/)?.[1] ?? "";
    items.push({
      title,
      volume: parseVolume(tag(block, "ht:approx_traffic")),
      picture: tag(block, "ht:picture"),
      newsTitle: tag(news, "ht:news_item_title"),
      newsUrl: tag(news, "ht:news_item_url"),
      newsSource: tag(news, "ht:news_item_source"),
    });
  }
  return items;
}

export function exploreUrl(title: string, geo: string): string {
  return `https://trends.google.com/trends/explore?q=${encodeURIComponent(title)}&geo=${geo}`;
}

const key = (title: string) => cleanText(title).toLowerCase();

/**
 * Rows of one region as TrendItems: the RPC rows (active ones first, by volume then growth) enriched from the
 * RSS by title; or the RSS items alone when the RPC gave nothing.
 */
export function googleItems(
  region: TrendRegion,
  geo: string,
  rpc: GoogleRpcRow[] | null,
  rss: GoogleRssItem[],
  now: Date,
): TrendItem[] {
  const seenAt = now.toISOString();
  const expiresAt = isoPlus(now, GOOGLE_TTL_MS);
  const byTitle = new Map(rss.map((i) => [key(i.title), i]));
  const lang = langForRegion(region);
  const base = (title: string, rank: number, total: number, news?: GoogleRssItem): TrendItem => ({
    id: trendId("google", region, slugify(title)),
    platform: "google",
    region,
    lang,
    title,
    url: news?.newsUrl ?? exploreUrl(title, geo),
    thumb: news?.picture,
    score: rankScore(rank, total),
    source: SOURCE_LABELS.google,
    why: oneLine(news?.newsTitle),
    seenAt,
    expiresAt,
    tags: [],
  });

  if (rpc) {
    const active = rpc.filter((r) => r.endUnix === undefined);
    const pool = active.length >= 10 ? active : rpc;
    const sorted = [...pool]
      .sort(
        (a, b) =>
          (b.volume ?? 0) - (a.volume ?? 0) ||
          (b.growthPct ?? 0) - (a.growthPct ?? 0) ||
          (b.startUnix ?? 0) - (a.startUnix ?? 0),
      )
      .slice(0, GOOGLE_MAX_PER_REGION);
    return sorted.map((r, i) => {
      const news = byTitle.get(key(r.title));
      const item = base(r.title, i + 1, sorted.length, news);
      item.volume = r.volume ?? news?.volume;
      item.growthPct = r.growthPct;
      item.tags = r.related.filter((q) => key(q) !== key(r.title)).slice(0, 3);
      return item;
    });
  }
  return rss.slice(0, GOOGLE_MAX_PER_REGION).map((i, idx) => {
    const item = base(i.title, idx + 1, Math.min(rss.length, GOOGLE_MAX_PER_REGION), i);
    item.volume = i.volume;
    return item;
  });
}

async function fetchRpc(ctx: SourceCtx, geo: string, hl: string): Promise<GoogleRpcRow[]> {
  const r = await fetchText(ctx.fetch, ctx.budget, googleRpcUrl(hl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": UA,
    },
    body: googleRpcBody(geo, hl),
  });
  if (!r.ok) throw new Error(`rpc: http ${r.status}`);
  return parseGoogleRpc(r.text);
}

async function fetchRss(ctx: SourceCtx, geo: string): Promise<GoogleRssItem[]> {
  const r = await fetchText(ctx.fetch, ctx.budget, `${GOOGLE_RSS_URL}?geo=${geo}`, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" },
  });
  if (!r.ok) throw new Error(`rss: http ${r.status}`);
  const items = parseGoogleRss(r.text);
  if (!items.length) throw new Error("rss: empty");
  return items;
}

/** Google Trends for both regions (2 calls each). Fails only when a region has neither the RPC nor the RSS. */
export async function runGoogle(ctx: SourceCtx): Promise<SourceOutput> {
  const items: TrendItem[] = [];
  const notes: string[] = [];
  let degraded = false;
  for (const { region, geo, hl } of GOOGLE_REGIONS) {
    let rpc: GoogleRpcRow[] | null = null;
    let rss: GoogleRssItem[] = [];
    let rpcError = "";
    try {
      rpc = await fetchRpc(ctx, geo, hl);
    } catch (e) {
      rpcError = (e as Error).message;
    }
    try {
      rss = await fetchRss(ctx, geo);
    } catch (e) {
      if (!rpc) return { ok: false, error: `${geo}: ${rpcError}; ${(e as Error).message}` };
      notes.push(`${geo}: ${(e as Error).message}`);
    }
    if (!rpc) {
      degraded = true;
      notes.push(`${geo}: ${rpcError} (rss only)`);
    }
    items.push(...googleItems(region, geo, rpc, rss, ctx.now));
  }
  return { ok: true, items, degraded, note: notes.join("; ") || undefined };
}
