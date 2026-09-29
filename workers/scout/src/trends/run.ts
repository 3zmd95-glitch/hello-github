/**
 * The Trend Radar job (round 30, planning/tools/08-trends.md, planning/handovers/mastermind-2026-09-28.md):
 * runs the enabled sources of the asked kinds, replaces their rows in the one-document feed
 * `trends:latest` (the other sources' rows stay until their own next run or their `expiresAt`), keeps the
 * previous good copy in `trends:prev`, and records one status per source. Called by the cron slots
 * (social/cron.ts `TREND_SLOTS`) and by `POST /trends/run`; never throws: a failed feed read runs the
 * sources but writes nothing (so no source's rows are wiped), a failed write answers the computed feed
 * marked degraded with a `kv` status.
 *
 * Budget: 38 outbound calls per invocation (`RUN_BUDGET`; the rest of the free plan's 50 subrequests go to
 * KV, at most eight: one feed read, at most two feed writes, the search counter on daily runs (one read,
 * the reservation write, at most one refund write) and the weekly stamp on weekly runs (one read, one
 * write)). A fast run spends ≤ 11 (Google 4, YouTube charts 4, kworb 2, trends24 1), the daily run ≤ 19
 * (18 keyword searches and the statistics call, round 31), the weekly scan 8. Every cron tick runs one
 * kind; a manual `POST /trends/run` asking for all three at once adds up to exactly 38, so nothing is
 * left to grow into without raising the budget or splitting that run.
 */

import { Budget } from "../social/http";
import { runEvents } from "./events";
import { runGoogle } from "./google";
import { runKworb } from "./kworb";
import { readFeed, trendKeys, writeFeed } from "./kv";
import { mergeItems } from "./normalize";
import { runTavily } from "./tavily";
import {
  SOURCE_LABELS,
  type SourceCtx,
  type SourceOutput,
  type TrendItem,
  type TrendKind,
  type TrendsEnv,
  type TrendsFeed,
  type TrendSourceLabel,
  type TrendSourceStatus,
} from "./types";
import { runX } from "./x";
import { runYoutube } from "./youtube";
import { runYoutubeSearch } from "./youtubeSearch";

export const RUN_BUDGET = 38;

/** The `TREND_SOURCES` keys. kworb and x are off until the owner agrees (README "Trend Radar"). */
export const SOURCE_KEYS = ["google", "youtube", "kworb", "x", "tavily", "events"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
export const DEFAULT_TREND_SOURCES = "google,youtube,tavily,events";

export interface SourceDef {
  /** The `TREND_SOURCES` gate (`youtube` covers the charts and the daily search). */
  key: SourceKey;
  label: TrendSourceLabel;
  kind: TrendKind;
  run: (ctx: SourceCtx) => Promise<SourceOutput>;
}

export const SOURCES: readonly SourceDef[] = [
  { key: "google", label: SOURCE_LABELS.google, kind: "fast", run: runGoogle },
  { key: "youtube", label: SOURCE_LABELS.youtube, kind: "fast", run: runYoutube },
  { key: "kworb", label: SOURCE_LABELS.kworb, kind: "fast", run: runKworb },
  { key: "x", label: SOURCE_LABELS.x, kind: "fast", run: runX },
  { key: "events", label: SOURCE_LABELS.events, kind: "fast", run: runEvents },
  { key: "youtube", label: SOURCE_LABELS.youtubeSearch, kind: "daily", run: runYoutubeSearch },
  { key: "tavily", label: SOURCE_LABELS.tavily, kind: "weekly", run: runTavily },
];

/** The enabled source keys (unknown names ignored), in `SOURCE_KEYS` order. */
export function enabledSources(env: Pick<TrendsEnv, "TREND_SOURCES">): SourceKey[] {
  const raw = env.TREND_SOURCES?.trim() ? env.TREND_SOURCES : DEFAULT_TREND_SOURCES;
  const asked = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  return SOURCE_KEYS.filter((k) => asked.has(k));
}

export interface RunTrendsDeps {
  kinds: TrendKind[];
  now?: Date;
  fetch?: typeof fetch;
  /** Outbound calls allowed for this run (default RUN_BUDGET). */
  budget?: number;
  /** Run the weekly scan even when this ISO week's already ran (`POST /trends/run { force: true }`). */
  force?: boolean;
}

/** What the cron logs (the feed itself is too big for a log line). */
export interface TrendsRunSummary {
  kinds: TrendKind[];
  items: number;
  degraded: boolean;
  sources: TrendSourceStatus[];
}

const EMPTY: TrendsFeed = { items: [], fetchedAt: null, degraded: true, sources: [] };

/** A source's rows that a failed run keeps: only `not_configured` is not a failure of the data. */
const isFailure = (s: TrendSourceStatus) => !s.ok && s.error !== "not_configured";

const errorText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

export async function runTrends(env: TrendsEnv, deps: RunTrendsDeps): Promise<TrendsFeed> {
  const now = deps.now ?? new Date();
  const at = now.toISOString();
  let previous = EMPTY;
  let readError: string | undefined;
  try {
    previous = (await readFeed(env)) ?? EMPTY;
  } catch (e) {
    readError = errorText(e);
  }
  const enabled = new Set(enabledSources(env));
  const todo = SOURCES.filter((s) => deps.kinds.includes(s.kind) && enabled.has(s.key));
  const keepLabels = new Set<string>(SOURCES.filter((s) => enabled.has(s.key)).map((s) => s.label));

  const ctx: SourceCtx = {
    env,
    fetch: deps.fetch ?? fetch,
    budget: new Budget(deps.budget ?? RUN_BUDGET),
    now,
    previous: previous.items,
    ...(deps.force ? { force: true } : {}),
  };
  const fresh: TrendItem[] = [];
  const replaced = new Set<TrendSourceLabel>();
  const statuses: TrendSourceStatus[] = [];
  let partial = false;
  /** Whether any source brought new rows (a skipped one did not). */
  let anyRan = false;
  for (const source of todo) {
    let out: SourceOutput;
    try {
      out = await source.run(ctx);
    } catch (e) {
      out = { ok: false, error: errorText(e) };
    }
    if (out.ok) {
      if (!out.skipped) {
        fresh.push(...out.items);
        replaced.add(source.label);
        anyRan = true;
      }
      if (out.degraded) partial = true;
      statuses.push({
        name: source.label,
        ok: true,
        at,
        ...(out.note ? { error: out.note.slice(0, 200) } : {}),
      });
    } else {
      statuses.push({ name: source.label, ok: false, at, error: out.error.slice(0, 200) });
    }
  }

  const ranLabels = new Set<string>(todo.map((s) => s.label));
  const sources = [
    ...previous.sources.filter((s) => keepLabels.has(s.name) && !ranLabels.has(s.name)),
    ...statuses,
  ];
  // Rows of a source the owner switched off leave at once, not at their expiry.
  const kept = previous.items.filter((i) => keepLabels.has(i.source));
  const items = mergeItems(kept, fresh, replaced, now);
  const anyOk = statuses.some((s) => s.ok);
  const feed: TrendsFeed = {
    items,
    fetchedAt: anyRan ? at : previous.fetchedAt,
    degraded: partial || sources.some(isFailure) || (!anyOk && !items.length),
    sources,
  };
  // Without the stored feed a write would wipe every other source's rows: answer, do not save.
  if (readError !== undefined) return kvFailed(feed, at, `read failed: ${readError}`);
  if (!todo.length) return feed;
  try {
    if (anyRan && (previous.items.length || previous.fetchedAt)) {
      await writeFeed(env, previous, trendKeys.prev);
    }
    await writeFeed(env, feed);
  } catch (e) {
    return kvFailed(feed, at, `write failed: ${errorText(e)}`);
  }
  return feed;
}

/** The computed feed, marked degraded with a `kv` status (never stored: KV is what failed). */
function kvFailed(feed: TrendsFeed, at: string, error: string): TrendsFeed {
  return {
    ...feed,
    degraded: true,
    sources: [...feed.sources, { name: "kv", ok: false, at, error: error.slice(0, 200) }],
  };
}

export function summarize(kinds: TrendKind[], feed: TrendsFeed): TrendsRunSummary {
  return { kinds, items: feed.items.length, degraded: feed.degraded, sources: feed.sources };
}
