/**
 * Daily YouTube keyword scan (round 30, planning/tools/08-trends.md; the genres and the rotation: round 31):
 * `search.list` "most viewed this week" for the owner's niche keywords and for the edit genres' main
 * queries (genres.ts), Arabic against SA / `relevanceLanguage=ar`, English against US / `en`, Shorts only,
 * 10 per keyword, then ONE `videos.list` for the statistics. Since 2026-06-01 `search.list` has its own
 * bucket of 100 calls a day per Google Cloud project, shared with the Discover screen, so this module
 * spends at most `SEARCH_CAP` calls per run and per UTC day (KV counter `trends:ytsearch:<day>`). The plan
 * is longer than one day's cap (12 niche + 24 genre keywords by default), so it rotates by UTC day: each
 * day searches the next `SEARCH_CAP` keywords and the rows of the others stay in the feed until their own
 * next search (`SourceCtx.previous`), which comes within two days with the default lists. The rows are
 * scored by views per language (`rankByViews`), so the Arabic tab has its own rank 1. KV has no atomic
 * increment, so the day's cap is best-effort when two runs overlap: each reserves its calls before
 * spending them, which narrows the window to the reads of the counter.
 */

import { GENRE_KEYWORDS } from "./genres";
import { readSearchCount, utcDay, writeSearchCount } from "./kv";
import { DAY_MS, fetchText, isExpired, rankScore, sortItems } from "./normalize";
import {
  SOURCE_LABELS,
  type SourceCtx,
  type SourceOutput,
  type TrendItem,
  type TrendLang,
  type TrendRegion,
  type TrendsEnv,
} from "./types";
import { parseYtBody, YT_VIDEOS_URL, ytErrorCode, ytItems } from "./youtube";

export const YT_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
/** Hard cap of `search.list` calls per run and per UTC day (82 of the day's 100 stay free for Discover). */
export const SEARCH_CAP = 18;
export const SEARCH_PER_KEYWORD = 10;
export const SEARCH_WINDOW_MS = 7 * DAY_MS;
export const YT_SEARCH_TTL_MS = 7 * DAY_MS;
/** `videos.list` takes at most 50 ids, so one run brings at most 50 new rows. */
export const STATS_MAX_IDS = 50;

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
  /** The edit genre whose main query this is (genres.ts); a niche keyword has none. */
  genre?: string;
}

type KeywordEnv = Pick<TrendsEnv, "TREND_KEYWORDS_AR" | "TREND_KEYWORDS_EN">;

/** A comma list from the env, or the defaults; blanks dropped, duplicates removed. */
export function parseKeywords(raw: string | undefined, defaults: readonly string[]): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(list.length ? list : defaults)];
}

/** What names a keyword in the plan and on its rows (`region` + `tags[0]`). */
const keywordKey = (kw: Pick<Keyword, "q" | "region">) => `${kw.region}:${kw.q}`;

/**
 * One language's keywords: the owner's niche ones, then the genres' main queries. A niche keyword that is
 * also a genre's main query is searched once and carries the genre.
 */
function languageKeywords(niche: string[], region: TrendRegion, lang: "ar" | "en"): Keyword[] {
  const byQuery = new Map<string, Keyword>();
  for (const q of niche) {
    const key = q.toLowerCase();
    if (!byQuery.has(key)) byQuery.set(key, { q, region, lang });
  }
  for (const g of GENRE_KEYWORDS) {
    if (g.lang !== lang) continue;
    const key = g.q.toLowerCase();
    const same = byQuery.get(key);
    if (same) same.genre ??= g.genre;
    else byQuery.set(key, { q: g.q, region, lang, genre: g.genre });
  }
  return [...byQuery.values()];
}

/**
 * The whole plan before the day's rotation: per language the niche keywords then the genres' main queries,
 * Arabic and English interleaved, so any stretch of it covers both tabs.
 */
export function keywordList(env: KeywordEnv): Keyword[] {
  const ar = languageKeywords(
    parseKeywords(env.TREND_KEYWORDS_AR, DEFAULT_KEYWORDS_AR),
    "SA",
    "ar",
  );
  const en = languageKeywords(
    parseKeywords(env.TREND_KEYWORDS_EN, DEFAULT_KEYWORDS_EN),
    "US",
    "en",
  );
  const out: Keyword[] = [];
  for (let i = 0; i < Math.max(ar.length, en.length); i++) {
    if (ar[i]) out.push(ar[i]);
    if (en[i]) out.push(en[i]);
  }
  return out;
}

/** Whole UTC days since 1970-01-01. */
export function dayNumber(now: Date): number {
  return Math.floor(now.getTime() / DAY_MS);
}

/**
 * Where the day's searches start in a plan of `length` keywords: every UTC day takes the next
 * `SEARCH_CAP` keywords, wrapping around, so the whole plan is searched every
 * ceil(length / SEARCH_CAP) days. A plan that fits in one run is not rotated.
 */
export function planOffset(now: Date, length: number): number {
  if (length <= SEARCH_CAP) return 0;
  return (dayNumber(now) * SEARCH_CAP) % length;
}

/**
 * The plan in the day's order: `keywordList` rotated by `planOffset`, so its first `SEARCH_CAP` keywords
 * are the ones this UTC day searches and the next day starts where this one stops.
 */
export function keywordPlan(env: KeywordEnv, now: Date): Keyword[] {
  const list = keywordList(env);
  const offset = planOffset(now, list.length);
  return [...list.slice(offset), ...list.slice(0, offset)];
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
  u.searchParams.set("id", ids.slice(0, STATS_MAX_IDS).join(","));
  u.searchParams.set("maxResults", String(STATS_MAX_IDS));
  u.searchParams.set("key", key);
  return u.toString();
}

/**
 * The videos the one statistics call asks about: at most `max`, taken in turns from the keywords (each
 * keyword's list is in `search.list` order, most viewed first), so a long plan does not spend the 50 ids
 * on its first five keywords.
 */
export function pickVideoIds(
  found: readonly (readonly string[])[],
  max: number = STATS_MAX_IDS,
): string[] {
  const out: string[] = [];
  const longest = Math.max(0, ...found.map((list) => list.length));
  for (let i = 0; i < longest && out.length < max; i++) {
    for (const list of found) {
      if (i < list.length && out.length < max) out.push(list[i]);
    }
  }
  return out;
}

/**
 * The stored rows of this source that stay after a run: those of a keyword that is still in the plan and
 * was not searched now (another day of the rotation, or cut by the cap, the budget or an error), unless
 * they expired or the run found the same video again.
 */
export function keptRows(
  previous: readonly TrendItem[],
  plan: readonly Keyword[],
  searched: ReadonlySet<string>,
  freshIds: ReadonlySet<string>,
  now: Date,
): TrendItem[] {
  const planned = new Set(plan.map(keywordKey));
  return previous.filter((row) => {
    if (row.source !== SOURCE_LABELS.youtubeSearch || isExpired(row, now)) return false;
    const key = keywordKey({ q: row.tags?.[0] ?? "", region: row.region });
    return planned.has(key) && !searched.has(key) && !freshIds.has(row.id);
  });
}

/**
 * Scores the rows by views, each language on its own: rank 1 = 100 for the most viewed Arabic row among
 * the Arabic rows and for the most viewed English row among the English ones, across every keyword of
 * that language (rows with equal views keep their order). English Shorts have far more views than Arabic
 * ones, so one ranking for both would leave the Arabic tab with the low scores. On an equal score and
 * `seenAt` the Arabic row comes first.
 */
export function rankByViews(rows: readonly TrendItem[]): TrendItem[] {
  const byLang = new Map<TrendLang, TrendItem[]>([
    ["ar", []],
    ["en", []],
  ]);
  for (const row of rows) {
    const same = byLang.get(row.lang);
    if (same) same.push(row);
    else byLang.set(row.lang, [row]);
  }
  const scored: TrendItem[] = [];
  for (const list of byLang.values()) {
    const byViews = [...list].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    scored.push(...byViews.map((row, i) => ({ ...row, score: rankScore(i + 1, byViews.length) })));
  }
  return sortItems(scored);
}

interface SearchHit {
  id?: { videoId?: string };
}

/**
 * Runs the keyword searches the day's cap still allows (the first ones of `plan`, by default the day's
 * rotation of the whole plan), then one `videos.list`. A row is tagged with the first keyword that found
 * its video and carries `genre` when a genre's keyword found it in this run; the rows this run brought
 * and the ones it keeps (`keptRows`) are ranked together by views, the Arabic rows among themselves and
 * the English rows among themselves (`rankByViews`: rank 1 = 100 in each language). The counter is
 * written before the first search (the run's searches reserved) and again only to refund the calls a
 * stop left unspent; a call counts as spent once it was sent, even when its answer never came.
 */
export async function runYoutubeSearch(
  ctx: SourceCtx,
  plan: readonly Keyword[] = keywordPlan(ctx.env, ctx.now),
): Promise<SourceOutput> {
  const key = ctx.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  const day = utcDay(ctx.now);
  const used = await readSearchCount(ctx.env, day);
  const allowed = Math.max(0, SEARCH_CAP - used);
  if (!allowed) return { ok: false, error: "daily cap reached" };

  // The statistics call needs one slot too.
  const searches = plan.slice(0, Math.max(0, Math.min(allowed, ctx.budget.left - 1)));
  if (!searches.length) return { ok: false, error: "budget" };

  await writeSearchCount(ctx.env, day, used + searches.length);
  const byVideo = new Map<string, Keyword>();
  const genreOf = new Map<string, string>();
  /** Per keyword, in search order, the videos it was the first to find. */
  const found: string[][] = [];
  /** The keywords whose search answered: their stored rows are replaced. */
  const searched = new Set<string>();
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
    searched.add(keywordKey(kw));
    const mine: string[] = [];
    for (const hit of body.items ?? []) {
      const id = hit.id?.videoId;
      if (!id) continue;
      if (kw.genre && !genreOf.has(id)) genreOf.set(id, kw.genre);
      if (byVideo.has(id)) continue;
      byVideo.set(id, kw);
      mine.push(id);
    }
    found.push(mine);
  }
  if (spent < searches.length) {
    try {
      await writeSearchCount(ctx.env, day, used + spent);
    } catch {
      // The reservation stays: over-counting only costs today's unused calls.
    }
  }
  if (error && !byVideo.size) return { ok: false, error };

  const picked = new Set(pickVideoIds(found));
  const ids = [...byVideo.keys()].filter((id) => picked.has(id));
  const rows: TrendItem[] = [];
  if (ids.length && ctx.budget.ok) {
    const r = await fetchText(ctx.fetch, ctx.budget, statsUrl(key, ids));
    const body = parseYtBody(r.text);
    if (!r.ok || !body) return { ok: false, error: ytErrorCode(r.status, body) };
    for (const v of body.items ?? []) {
      const kw = v.id ? byVideo.get(v.id) : undefined;
      if (!v.id || !kw) continue;
      const [row] = ytItems([v], kw.region, ctx.now, {
        source: SOURCE_LABELS.youtubeSearch,
        tags: [kw.q],
        ttlMs: YT_SEARCH_TTL_MS,
        slugPrefix: "q-",
      });
      const genre = genreOf.get(v.id);
      if (row) rows.push({ ...row, lang: kw.lang, ...(genre ? { genre } : {}) });
    }
  }
  const kept = keptRows(
    ctx.previous ?? [],
    plan,
    searched,
    new Set(rows.map((r) => r.id)),
    ctx.now,
  );
  return {
    ok: true,
    items: rankByViews([...rows, ...kept]),
    degraded: !!error,
    note: error
      ? `stopped early: ${error}`
      : `${spent} search calls (${used + spent}/${SEARCH_CAP} today)`,
  };
}
