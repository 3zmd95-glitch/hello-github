/**
 * The one cron trigger (`*\/5 * * * *`): every five minutes the auto-post queue publishes what is due, and
 * a few ticks do another job instead, so every invocation keeps the free plan's full subrequest budget for
 * one job: the four ticks from 03:00 to 03:30 UTC (06:00–06:30 Riyadh) run the daily sync of one platform
 * each, and the Trend Radar ticks (round 30, planning/tools/08-trends.md) refresh the trend feed. One
 * trigger rather than many also stays inside the free plan's cron limit (five per account). A publish tick
 * that moved nothing also polls Instagram comments for the auto-replies (replies.ts): the two never share
 * one tick, so each keeps its full budget.
 */

import { runTrends, summarize, type TrendsRunSummary } from "../trends/run";
import type { TrendKind, TrendsEnv } from "../trends/types";
import { runDue, type RunResult } from "./publish";
import { pollReplies, type PollResult } from "./replies";
import type { SocialEnv } from "./store";
import { syncIfConnected, type SyncAllResult, type SyncDeps } from "./sync";
import type { SocialPlatform } from "./types";

export const TICK_CRON = "*/5 * * * *";

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
 * scan at 00:15 Riyadh on Sunday. Every slot must sit on the five-minute grid of `TICK_CRON` (the trigger
 * never fires on any other minute, so an off-grid slot never runs; a test guards it); the :05 / :15 minutes
 * keep clear of the sync slots and of the top of the hour.
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

export type TickResult =
  | { sync: SyncAllResult }
  | { publish: RunResult; replies?: PollResult }
  | { trends: TrendsRunSummary };

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
  env: SocialEnv & TrendsEnv,
  scheduledTime: number,
  deps: SyncDeps = {},
): Promise<TickResult> {
  const platform = SYNC_SLOTS[utcSlot(scheduledTime)];
  if (platform) return { sync: await syncIfConnected(env, platform, deps) };
  const now = deps.now ?? new Date(scheduledTime);
  const kind = trendKindAt(scheduledTime);
  if (kind) {
    const feed = await runTrends(env, { kinds: [kind], fetch: deps.fetch, now });
    return { trends: summarize([kind], feed) };
  }
  const publish = await runDue(env, { fetch: deps.fetch, now });
  if (publish.advanced.length) return { publish };
  return { publish, replies: await pollReplies(env, { fetch: deps.fetch, now }) };
}
