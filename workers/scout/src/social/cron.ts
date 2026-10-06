/**
 * The one cron trigger (`* * * * *`) polls the auto replies (comments and DMs, replies.ts) every minute;
 * on the five-minute grid it keeps today's schedule — the auto-post queue, the daily sync slots, the Trend
 * Radar slots, the daily trending effects slot, and the replies when publishing moved nothing. Each invocation
 * runs one job, so it keeps the free plan's full subrequest budget: the four grid ticks from 03:00 to 03:30 UTC
 * (06:00–06:30 Riyadh) run the daily sync of one platform each, the Trend Radar ticks (round 30,
 * planning/tools/08-trends.md) refresh the trend feed, the 05:35 UTC tick runs the trending effects job
 * (planning/tools/18-trending-effects.md), the four 05:40–05:55 UTC ticks each scan one Discover category
 * (planning/tools/19-category-trends.md), and the other grid ticks publish what is due. One
 * trigger rather than many also stays inside the free plan's cron limit (five per account). A publish tick
 * that moved nothing also polls the auto replies: the two never share one tick, so each keeps its full
 * budget.
 */

import { CATEGORY_SLOTS, categoriesForDay } from "../categories/defs";
import { runCategory } from "../categories/run";
import { runEffects } from "../effects/run";
import type { EffectsEnv } from "../effects/sources";
import { utcDay } from "../trends/kv";
import { runTrends, summarize, type TrendsRunSummary } from "../trends/run";
import type { TrendKind, TrendsEnv } from "../trends/types";
import { runDue, type RunResult } from "./publish";
import { pollReplies, type PollResult } from "./replies";
import type { SocialEnv } from "./store";
import { syncIfConnected, type SyncAllResult, type SyncDeps } from "./sync";
import type { SocialPlatform } from "./types";

export const TICK_CRON = "* * * * *";

/** UTC "HH:MM" of the ticks that sync instead of publishing. */
export const SYNC_SLOTS: Record<string, SocialPlatform> = {
  "03:00": "instagram",
  "03:10": "threads",
  "03:20": "youtube",
  "03:30": "tiktok",
};

/**
 * UTC "HH:MM" of the ticks that refresh the trend feed instead of publishing: the fast sources every six
 * hours, the daily YouTube keyword search at 00:05 Riyadh, and (Saturdays only, `WEEKLY_SLOT`) the Tavily
 * scan at 00:15 Riyadh on Sunday. Every slot must sit on the five-minute grid (the other minutes only poll
 * the replies, so an off-grid slot never runs; a test guards it); the :05 / :15 minutes keep clear of the
 * sync slots and of the top of the hour.
 */
export const TREND_SLOTS: Record<string, TrendKind> = {
  "00:05": "fast",
  "06:05": "fast",
  "12:05": "fast",
  "18:05": "fast",
  "21:05": "daily",
};
export const WEEKLY_SLOT = "21:15";
/** `Date.getUTCDay()` of the weekly scan: Saturday. */
export const WEEKLY_DAY = 6;
/** UTC "HH:MM" of the daily trending effects run: 08:35 Riyadh, on the five-minute grid (a test guards it). */
export const EFFECTS_SLOT = "05:35";

export type TickResult =
  | { sync: SyncAllResult }
  | { publish: RunResult; replies?: PollResult }
  | { trends: TrendsRunSummary }
  | { effects: { status: string; items: number; notes?: string[] } }
  | { category: { id: string; status: string; items: number; notes?: string[] } }
  | { replies: PollResult };

const pad = (n: number) => String(n).padStart(2, "0");

/** The UTC "HH:MM" of a scheduled time (Cloudflare fires on the minute; seconds are dropped). */
export function utcSlot(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The trend kind a tick runs, if it is a trend tick. */
export function trendKindAt(ms: number): TrendKind | undefined {
  const slot = utcSlot(ms);
  if (slot === WEEKLY_SLOT && new Date(ms).getUTCDay() === WEEKLY_DAY) return "weekly";
  return TREND_SLOTS[slot];
}

export async function runTick(
  env: SocialEnv & TrendsEnv & EffectsEnv,
  scheduledTime: number,
  deps: SyncDeps = {},
): Promise<TickResult> {
  const now = deps.now ?? new Date(scheduledTime);
  // Off the five-minute grid only the replies run (every sync, effects, category and trend slot sits on the grid).
  if (new Date(scheduledTime).getUTCMinutes() % 5 !== 0) {
    return { replies: await pollReplies(env, { fetch: deps.fetch, now, fiveMinuteTick: false }) };
  }
  const platform = SYNC_SLOTS[utcSlot(scheduledTime)];
  if (platform) return { sync: await syncIfConnected(env, platform, deps) };
  if (utcSlot(scheduledTime) === EFFECTS_SLOT) {
    const { status, items, notes } = await runEffects(env, { fetch: deps.fetch, now });
    return { effects: { status, items: items.length, notes } };
  }
  // The 4 category slots (05:40–05:55 UTC): slot i scans the day's i-th category (planning/tools/19-category-trends.md).
  const category = categoriesForDay(utcDay(now))[CATEGORY_SLOTS.indexOf(utcSlot(scheduledTime))];
  if (category) {
    const { status, items, notes } = await runCategory(env, category, { fetch: deps.fetch, now });
    return { category: { id: category, status, items: items.length, notes } };
  }
  const kind = trendKindAt(scheduledTime);
  if (kind) {
    const feed = await runTrends(env, { kinds: [kind], fetch: deps.fetch, now });
    return { trends: summarize([kind], feed) };
  }
  const publish = await runDue(env, { fetch: deps.fetch, now });
  if (publish.advanced.length) return { publish };
  return { publish, replies: await pollReplies(env, { fetch: deps.fetch, now }) };
}
