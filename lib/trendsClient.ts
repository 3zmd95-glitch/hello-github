import { TrendsFeedSchema, type TrendsFeed } from "./domain";
import type { ScoutConfig } from "./scoutClient";
import {
  call,
  post,
  type SocialResult,
  type SocialSyncError,
  type SocialSyncOpts,
} from "./socialSync";

/**
 * 📈 Trend Radar client (round 30, planning/tools/08-trends.md, planning/handovers/mastermind-2026-09-28.md):
 * the two Worker routes the radar uses. `GET /trends` returns the last feed the Worker's cron wrote to KV
 * (`trends:latest`, 200 even when empty) and `POST /trends/run` runs the enabled fast sources now and
 * returns the same shape. Both are read through lib/socialSync's `call` (bearer token, typed errors, nothing thrown)
 * and validated with `TrendsFeedSchema` so the store only ever sees a feed it understands.
 */

export type TrendsResult = SocialResult<{ feed: TrendsFeed }>;

export type TrendsMessageKey =
  | "trends.err.unconfigured"
  | "trends.err.auth"
  | "trends.err.network"
  | "trends.err.rateLimited"
  | "trends.err.upstream";

/** Message key (in messages/trends.*.json) for a Worker error, coarser than the accounts card's mapping. */
export function trendsErrorMessageKey(error: SocialSyncError): TrendsMessageKey {
  switch (error.type) {
    case "unconfigured":
      return "trends.err.unconfigured";
    case "auth":
      return "trends.err.auth";
    case "network":
      return "trends.err.network";
    case "rate_limited":
      return "trends.err.rateLimited";
    default:
      return "trends.err.upstream";
  }
}

/** A body that is not a feed (an HTML error page, a half-written KV doc) counts as an upstream failure. */
function parseFeed(data: unknown): TrendsResult {
  const parsed = TrendsFeedSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: { type: "upstream" } };
  return { ok: true, feed: parsed.data };
}

/** `GET /trends`: the Worker's last feed (empty and `degraded` when it never ran). */
export async function fetchTrends(
  config: ScoutConfig | null,
  opts: SocialSyncOpts = {},
): Promise<TrendsResult> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/trends", {}, opts);
  if (!r.ok) return r;
  return parseFeed(r.data);
}

/**
 * `POST /trends/run` with `{ kinds: ["fast"] }`: run the enabled fast sources now (never the weekly Tavily
 * scan, which spends credits); answers with the fresh feed.
 */
export async function runTrends(
  config: ScoutConfig | null,
  opts: SocialSyncOpts = {},
): Promise<TrendsResult> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/trends/run", post({ kinds: ["fast"] }), opts);
  if (!r.ok) return r;
  return parseFeed(r.data);
}
