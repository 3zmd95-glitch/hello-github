/**
 * Trending effects, the outbound calls (planning/tools/18-trending-effects.md §1): one Tavily search per effect family
 * over TikTok and Instagram together (1 credit each), and the YouTube check of the top effects (one `search.list` each,
 * then one `videos.list` for all their views).
 */

import type { SearchAiBinding } from "../discover/ai";
import { CALL_TIMEOUT_MS, timed, youtubeCall } from "../discover/fetchers";
import { normalizeDiscoverHits, type ScoutResult, type TavilyHit } from "../normalize";
import { TAVILY_URL } from "../trends/tavily";
import { enrichYoutubeStats, YT_STATS_MAX } from "../youtubeStats";
import type { EffectPlatform, EffectPost } from "./types";

export interface EffectsEnv {
  TAVILY_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  AI?: SearchAiBinding;
  SOCIAL_KV?: KVNamespace;
}

/** Effects checked on YouTube per run: 6 of the 100 `search.list` calls a day. */
export const YT_EFFECTS = 6;
/** One `videos.list` takes ≤ 50 ids, so each effect's views7d sums its first 8 videos (6 × 8 = 48). */
const VIEWS_PER_EFFECT = Math.floor(YT_STATS_MAX / YT_EFFECTS);
const PLATFORMS: readonly EffectPlatform[] = ["tt", "ig"];

type Search = { posts: EffectPost[]; credits: number } | { error: string };

async function searchOne(
  key: string,
  doFetch: typeof fetch,
  query: string,
  timeoutMs: number,
): Promise<Search> {
  try {
    const out = await timed(timeoutMs, async (signal): Promise<Search> => {
      const res = await doFetch(TAVILY_URL, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query,
          include_domains: ["tiktok.com", "instagram.com"],
          max_results: 20,
          search_depth: "basic",
          include_published_date: true,
          include_usage: true,
          time_range: "week",
          language: "en",
        }),
      });
      if (res.status === 401 || res.status === 403) return { error: "auth" };
      if (res.status === 429 || res.status === 432 || res.status === 433) return { error: "quota" };
      if (!res.ok) return { error: "upstream" };
      const data = (await res.json()) as { results?: unknown; usage?: { credits?: number } };
      const hits = (Array.isArray(data.results) ? data.results : []) as TavilyHit[];
      // Each platform keeps its own post pages; profile pages are dropped.
      const posts = PLATFORMS.flatMap((platform) =>
        normalizeDiscoverHits(hits, platform).cards.map(({ handle, title, snippet, url }) => ({
          platform,
          handle,
          title,
          snippet,
          url,
        })),
      );
      return { posts, credits: data.usage?.credits ?? 1 };
    });
    return out ?? { error: "upstream" };
  } catch {
    return { error: "upstream" };
  }
}

export async function searchFamilies(
  env: EffectsEnv,
  doFetch: typeof fetch,
  queries: readonly string[],
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<{ posts: EffectPost[]; credits: number; errors: string[] }> {
  const key = env.TAVILY_API_KEY;
  if (!key) return { posts: [], credits: 0, errors: ["not_configured"] };
  const replies = await Promise.all(queries.map((q) => searchOne(key, doFetch, q, timeoutMs)));
  const out = { posts: [] as EffectPost[], credits: 0, errors: [] as string[] };
  for (const r of replies) {
    if ("error" in r) out.errors.push(r.error);
    else {
      out.posts.push(...r.posts);
      out.credits += r.credits;
    }
  }
  return out;
}

/**
 * Errors are notes: "youtube_cap" (the day's quota is spent: no more calls), "youtube_stats" (the views call gave
 * nothing: no numbers rather than zeros) or "youtube_<error>".
 */
export async function youtubeCheck(
  env: EffectsEnv,
  doFetch: typeof fetch,
  effects: readonly { key: string; en: string }[],
  now: Date,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<{ results: Record<string, { newVideos: number; views7d: number }>; errors: string[] }> {
  const found: { key: string; newVideos: number; counted: ScoutResult[] }[] = [];
  const errors = new Set<string>();
  for (const { key, en } of effects.slice(0, YT_EFFECTS)) {
    const reply = await youtubeCall(
      env,
      doFetch,
      { q: `${en} edit`, lang: "en", timeRange: "week" },
      now,
      timeoutMs,
    );
    if (reply.ok)
      found.push({
        key,
        newVideos: reply.cards.length,
        counted: reply.cards.slice(0, VIEWS_PER_EFFECT),
      });
    else if (reply.error === "daily_cap") {
      errors.add("youtube_cap");
      break;
    } else errors.add(`youtube_${reply.error}`);
  }
  const cards = found.flatMap((f) => f.counted);
  await enrichYoutubeStats(cards, env, doFetch);
  // A video two effects share gets its stats on one card only: read the views by URL.
  const views = new Map<string, number>();
  for (const c of cards) if (c.stats?.views !== undefined) views.set(c.url, c.stats.views);
  if (cards.length && !views.size) return { results: {}, errors: [...errors, "youtube_stats"] };
  const results = Object.fromEntries(
    found.map(({ key, newVideos, counted }) => [
      key,
      { newVideos, views7d: counted.reduce((sum, c) => sum + (views.get(c.url) ?? 0), 0) },
    ]),
  );
  return { results, errors: [...errors] };
}
