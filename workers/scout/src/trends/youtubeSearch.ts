/**
 * Daily YouTube keyword scan (round 30, planning/tools/08-trends.md): `search.list` "most viewed this week"
 * for the owner's niche keywords (Arabic against SA / `relevanceLanguage=ar`, English against US / `en`,
 * Shorts only, 10 per keyword), then ONE `videos.list` for the statistics. Since 2026-06-01 `search.list`
 * has its own bucket of 100 calls a day per Google Cloud project, shared with the Discover screen, so this
 * module spends at most `SEARCH_CAP` calls per run and per UTC day (KV counter `trends:ytsearch:<day>`). KV
 * has no atomic increment, so the day's cap is best-effort when two runs overlap: each reserves its calls
 * before spending them, which narrows the window to the reads of the counter.
 */

import { readSearchCount, utcDay, writeSearchCount } from "./kv";
import { DAY_MS, fetchText, rankScore, sortItems } from "./normalize";
import {
  SOURCE_LABELS,
  type SourceCtx,
  type SourceOutput,
  type TrendItem,
  type TrendRegion,
} from "./types";
import { parseYtBody, YT_VIDEOS_URL, ytErrorCode, ytItems, type YtVideo } from "./youtube";

export const YT_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
/** Hard cap of `search.list` calls per run and per UTC day. */
export const SEARCH_CAP = 12;
export const SEARCH_PER_KEYWORD = 10;
export const SEARCH_WINDOW_MS = 7 * DAY_MS;
export const YT_SEARCH_TTL_MS = 7 * DAY_MS;

/** The dashboard's `DEFAULT_TREND_KEYWORDS` (lib/trends.ts), hand-copied; wrangler.jsonc carries the same. */
export const DEFAULT_KEYWORDS_AR = [
  "تصوير",
  "مونتاج",
  "دافنشي",
  "تصحيح الألوان",
  "كاميرا",
  "صانع محتوى",
] as const;
export const DEFAULT_KEYWORDS_EN = [
  "davinci resolve",
  "color grading",
  "b-roll",
  "iphone videography",
  "video editing",
  "content creator",
] as const;

export interface Keyword {
  q: string;
  region: TrendRegion;
  lang: "ar" | "en";
}

/** A comma list from the env, or the defaults; blanks dropped, duplicates removed. */
export function parseKeywords(raw: string | undefined, defaults: readonly string[]): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(list.length ? list : defaults)];
}

/** Arabic and English keywords interleaved, so a small cap still covers both tabs. */
export function keywordPlan(env: {
  TREND_KEYWORDS_AR?: string;
  TREND_KEYWORDS_EN?: string;
}): Keyword[] {
  const ar = parseKeywords(env.TREND_KEYWORDS_AR, DEFAULT_KEYWORDS_AR).map((q): Keyword => ({
    q,
    region: "SA",
    lang: "ar",
  }));
  const en = parseKeywords(env.TREND_KEYWORDS_EN, DEFAULT_KEYWORDS_EN).map((q): Keyword => ({
    q,
    region: "US",
    lang: "en",
  }));
  const out: Keyword[] = [];
  for (let i = 0; i < Math.max(ar.length, en.length); i++) {
    if (ar[i]) out.push(ar[i]);
    if (en[i]) out.push(en[i]);
  }
  return out;
}

export function searchUrl(key: string, kw: Keyword, now: Date): string {
  const u = new URL(YT_SEARCH_URL);
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("order", "viewCount");
  u.searchParams.set("publishedAfter", new Date(now.getTime() - SEARCH_WINDOW_MS).toISOString());
  u.searchParams.set("regionCode", kw.region);
  u.searchParams.set("relevanceLanguage", kw.lang);
  u.searchParams.set("videoDuration", "short");
  u.searchParams.set("maxResults", String(SEARCH_PER_KEYWORD));
  u.searchParams.set("q", kw.q);
  u.searchParams.set("key", key);
  return u.toString();
}

export function statsUrl(key: string, ids: string[]): string {
  const u = new URL(YT_VIDEOS_URL);
  u.searchParams.set("part", "snippet,contentDetails,statistics");
  u.searchParams.set("id", ids.slice(0, 50).join(","));
  u.searchParams.set("maxResults", "50");
  u.searchParams.set("key", key);
  return u.toString();
}

interface SearchHit {
  id?: { videoId?: string };
}

/**
 * Runs the keyword searches the day's cap still allows, then one `videos.list`; rows are ranked by views
 * across every keyword (rank 1 = 100) and tagged with their keyword. The counter is written before the
 * first search (the whole plan reserved) and again only to refund the calls a stop left unspent; a call
 * counts as spent once it was sent, even when its answer never came.
 */
export async function runYoutubeSearch(ctx: SourceCtx): Promise<SourceOutput> {
  const key = ctx.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  const day = utcDay(ctx.now);
  const used = await readSearchCount(ctx.env, day);
  const allowed = Math.max(0, SEARCH_CAP - used);
  if (!allowed) return { ok: false, error: "daily cap reached" };

  const plan = keywordPlan(ctx.env).slice(0, allowed);
  // The statistics call needs one slot too.
  const searches = plan.slice(0, Math.max(0, Math.min(plan.length, ctx.budget.left - 1)));
  if (!searches.length) return { ok: false, error: "budget" };

  await writeSearchCount(ctx.env, day, used + searches.length);
  const byVideo = new Map<string, Keyword>();
  let spent = 0;
  let error: string | undefined;
  for (const kw of searches) {
    spent += 1;
    let r: Awaited<ReturnType<typeof fetchText>>;
    try {
      r = await fetchText(ctx.fetch, ctx.budget, searchUrl(key, kw, ctx.now));
    } catch (e) {
      error = String((e as Error)?.message ?? e);
      break;
    }
    const body = parseYtBody(r.text) as { items?: SearchHit[]; error?: unknown } | null;
    if (!r.ok || !body) {
      error = ytErrorCode(r.status, body as never);
      break;
    }
    for (const hit of body.items ?? []) {
      const id = hit.id?.videoId;
      if (id && !byVideo.has(id)) byVideo.set(id, kw);
    }
  }
  if (spent < searches.length) {
    try {
      await writeSearchCount(ctx.env, day, used + spent);
    } catch {
      // The reservation stays: over-counting only costs today's unused calls.
    }
  }
  if (error && !byVideo.size) return { ok: false, error };

  const ids = [...byVideo.keys()];
  const items: TrendItem[] = [];
  if (ids.length && ctx.budget.ok) {
    const r = await fetchText(ctx.fetch, ctx.budget, statsUrl(key, ids));
    const body = parseYtBody(r.text);
    if (!r.ok || !body) return { ok: false, error: ytErrorCode(r.status, body) };
    const videos = (body.items ?? []).filter((v): v is YtVideo & { id: string } => !!v.id);
    const byViews = [...videos].sort(
      (a, b) => Number(b.statistics?.viewCount ?? 0) - Number(a.statistics?.viewCount ?? 0),
    );
    byViews.forEach((v, i) => {
      const kw = byVideo.get(v.id)!;
      const [row] = ytItems([v], kw.region, ctx.now, {
        source: SOURCE_LABELS.youtubeSearch,
        tags: [kw.q],
        ttlMs: YT_SEARCH_TTL_MS,
        slugPrefix: "q-",
      });
      if (row) items.push({ ...row, lang: kw.lang, score: rankScore(i + 1, byViews.length) });
    });
  }
  return {
    ok: true,
    items: sortItems(items),
    degraded: !!error,
    note: error
      ? `stopped early: ${error}`
      : `${spent} search calls (${used + spent}/${SEARCH_CAP} today)`,
  };
}
