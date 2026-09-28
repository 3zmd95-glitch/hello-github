/**
 * The one cron trigger (`*\/5 * * * *`): every five minutes the auto-post queue publishes what is due, and
 * the four ticks from 03:00 to 03:30 UTC (06:00–06:30 Riyadh) run the daily sync of one platform each
 * instead, so every invocation keeps the free plan's full subrequest budget for one job. One trigger rather
 * than five also stays inside the free plan's cron limit (five per account).
 */

import { runDue, type RunResult } from "./publish";
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

export type TickResult = { sync: SyncAllResult } | { publish: RunResult };

const pad = (n: number) => String(n).padStart(2, "0");

/** The UTC "HH:MM" of a scheduled time (Cloudflare fires on the minute; seconds are dropped). */
export function utcSlot(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export async function runTick(
  env: SocialEnv,
  scheduledTime: number,
  deps: SyncDeps = {},
): Promise<TickResult> {
  const platform = SYNC_SLOTS[utcSlot(scheduledTime)];
  if (platform) return { sync: await syncIfConnected(env, platform, deps) };
  return {
    publish: await runDue(env, { fetch: deps.fetch, now: deps.now ?? new Date(scheduledTime) }),
  };
}
