/**
 * Trending effects, the outbound calls (planning/tools/18-trending-effects.md §1): three Tavily searches per effect
 * family, Discover's own per-platform call (1 credit each), and the YouTube check of the top effects (one
 * `search.list` each, then one `videos.list` for all their views).
 */

import type { SearchAiBinding } from "../discover/ai";
import { CALL_TIMEOUT_MS, tavilyCall, youtubeCall } from "../discover/fetchers";
import { usageKeys, type TavilyUsage } from "../discover/usage";
import type { ScoutResult } from "../normalize";
import { enrichYoutubeStats, YT_STATS_MAX } from "../youtubeStats";
import { FAMILY_QUERIES } from "./families";
import type { EffectPost } from "./types";

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

/**
 * Each family's searches. Neither window wins alone (live, 2026-10-06): "clone yourself video trend" found 9 clone
 * posts over a week and 2 over a month; "gif stickers" found 0 sticker posts over a week and 7 over a month. TikTok
 * gave 1 post a search either way: the month only.
 */
const SEARCHES = [
  { platform: "ig", timeRange: "week", stat: "igWeek" },
  { platform: "ig", timeRange: "month", stat: "igMonth" },
  { platform: "tt", timeRange: "month", stat: "tt" },
] as const;
/** Tavily's month nearly spent (Discover's cached usage figure): the Instagram month search alone. */
const TIGHT_SEARCHES = [SEARCHES[1]];
const TIGHT_SHARE = 0.9;

/** A family's post pages found by each search, and its posts once each (the log line's figures). */
export type FamilyStats = {
  family: number;
  tt: number;
  igWeek: number;
  igMonth: number;
  posts: number;
};

/** True when Discover's cached Tavily figure (10 minutes in KV) says ≥ 90 % of the month is used; a missing or
 * unreadable figure, or no known limit, is not tight. */
async function budgetTight(env: EffectsEnv): Promise<boolean> {
  try {
    const usage = JSON.parse(
      (await env.SOCIAL_KV?.get(usageKeys.tavily, "text")) ?? "null",
    ) as TavilyUsage | null;
    return usage?.limit ? usage.used / usage.limit >= TIGHT_SHARE : false;
  } catch {
    return false;
  }
}

export async function searchFamilies(
  env: EffectsEnv,
  doFetch: typeof fetch,
  queries: readonly string[],
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<{
  posts: EffectPost[];
  credits: number;
  errors: string[];
  families: FamilyStats[];
  tight: boolean;
}> {
  if (!env.TAVILY_API_KEY)
    return { posts: [], credits: 0, errors: ["not_configured"], families: [], tight: false };
  const tight = await budgetTight(env);
  const out = { posts: [] as EffectPost[], credits: 0, errors: [] as string[] };
  const families = queries.map((q) => ({
    stats: { family: FAMILY_QUERIES.indexOf(q) + 1, tt: 0, igWeek: 0, igMonth: 0, posts: 0 },
    urls: new Set<string>(),
  }));
  // One search of each family at a time (6 calls): a Worker keeps 6 connections open and queues the rest, whose time
  // limit would run while they wait.
  for (const { platform, timeRange, stat } of tight ? TIGHT_SEARCHES : SEARCHES) {
    const replies = await Promise.all(
      queries.map((q) =>
        tavilyCall(env, doFetch, { q, platform, lang: "en", timeRange }, timeoutMs),
      ),
    );
    replies.forEach((r, i) => {
      if (!r.ok) return void out.errors.push(r.error);
      out.credits += r.credits;
      const { stats, urls } = families[i];
      stats[stat] = r.cards.length;
      // A post two searches found is one post.
      for (const { handle, title, snippet, url } of r.cards)
        if (!urls.has(url)) {
          urls.add(url);
          out.posts.push({ platform, handle, title, snippet, url });
        }
    });
  }
  return {
    ...out,
    families: families.map(({ stats, urls }) => ({ ...stats, posts: urls.size })),
    tight,
  };
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
