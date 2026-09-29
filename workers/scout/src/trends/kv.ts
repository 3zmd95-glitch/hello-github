/**
 * KV keys of the Trend Radar (round 30, planning/tools/08-trends.md), on the same `SOCIAL_KV` binding as
 * the social side (social/store.ts owns those keys; these live here so the two jobs stay in separate files):
 *
 *   trends:latest          TrendsFeed — the feed `GET /trends` serves (one document, one write per run)
 *   trends:prev            TrendsFeed — the previous good feed, copied before a run with ≥ 1 ok source
 *   trends:ytsearch:<day>  "<n>"      — `search.list` calls reserved on that UTC day (youtubeSearch.ts), 2-day TTL
 *   trends:tavily:<week>   ISO time   — set after the weekly scan of that ISO week succeeded (tavily.ts), 8-day TTL
 */

import { EMPTY_FEED, type TrendsEnv, type TrendsFeed } from "./types";

export const trendKeys = {
  latest: "trends:latest",
  prev: "trends:prev",
  ytsearch: (utcDay: string) => `trends:ytsearch:${utcDay}`,
  tavily: (isoWeek: string) => `trends:tavily:${isoWeek}`,
};

/** The counter key lives two days: a day's cap needs it only on that day. */
export const YTSEARCH_COUNTER_TTL_S = 2 * 86_400;
/** The weekly stamp outlives its week by a day. */
export const TAVILY_STAMP_TTL_S = 8 * 86_400;

/** "YYYY-MM-DD" in UTC (the YouTube quota resets at midnight Pacific; a UTC day is the conservative cut). */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-Www", the ISO 8601 week (Monday first) of a UTC date, e.g. 2026-09-28 → "2026-W40". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // The week's Thursday decides its year.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function isFeed(x: unknown): x is TrendsFeed {
  if (!x || typeof x !== "object") return false;
  const f = x as Record<string, unknown>;
  return Array.isArray(f.items) && Array.isArray(f.sources) && typeof f.degraded === "boolean";
}

/** The stored feed, or null when there is none (or KV is not bound / the document is corrupt). */
export async function readFeed(
  env: TrendsEnv,
  key: string = trendKeys.latest,
): Promise<TrendsFeed | null> {
  if (!env.SOCIAL_KV) return null;
  const text = await env.SOCIAL_KV.get(key, "text");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isFeed(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `trends:latest` or the empty (degraded) feed: what `GET /trends` answers. */
export async function latestFeed(env: TrendsEnv): Promise<TrendsFeed> {
  return (await readFeed(env)) ?? EMPTY_FEED;
}

export async function writeFeed(
  env: TrendsEnv,
  feed: TrendsFeed,
  key: string = trendKeys.latest,
): Promise<void> {
  if (!env.SOCIAL_KV) return;
  await env.SOCIAL_KV.put(key, JSON.stringify(feed));
}

/** `search.list` calls already spent today. */
export async function readSearchCount(env: TrendsEnv, day: string): Promise<number> {
  if (!env.SOCIAL_KV) return 0;
  const text = await env.SOCIAL_KV.get(trendKeys.ytsearch(day), "text");
  const n = Number(text ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function writeSearchCount(env: TrendsEnv, day: string, count: number): Promise<void> {
  if (!env.SOCIAL_KV) return;
  await env.SOCIAL_KV.put(trendKeys.ytsearch(day), String(count), {
    expirationTtl: YTSEARCH_COUNTER_TTL_S,
  });
}

/** Whether the weekly scan of that ISO week already ran (false without KV). */
export async function hasTavilyStamp(env: TrendsEnv, week: string): Promise<boolean> {
  if (!env.SOCIAL_KV) return false;
  return (await env.SOCIAL_KV.get(trendKeys.tavily(week), "text")) !== null;
}

export async function writeTavilyStamp(env: TrendsEnv, week: string, at: string): Promise<void> {
  if (!env.SOCIAL_KV) return;
  await env.SOCIAL_KV.put(trendKeys.tavily(week), at, { expirationTtl: TAVILY_STAMP_TTL_S });
}
