/**
 * Trend Radar types (round 30, planning/tools/08-trends.md, planning/handovers/mastermind-2026-09-28.md).
 *
 * Hand-copied from the dashboard's zod schemas in `lib/domain.ts` (`TrendItemSchema`, `TrendSourceStatusSchema`,
 * `TrendsFeedSchema`), the same convention as `social/types.ts`: the Worker has no zod and its tsconfig only
 * covers `src/`, so the two sides are kept in step by hand and by the tests.
 */

import type { Budget } from "../social/http";

export const TREND_PLATFORMS = [
  "google",
  "youtube",
  "tiktok",
  "instagram",
  "threads",
  "x",
  "event",
] as const;
export type TrendPlatform = (typeof TREND_PLATFORMS)[number];

export const TREND_REGIONS = ["SA", "US", "global"] as const;
export type TrendRegion = (typeof TREND_REGIONS)[number];

/** Language of the row's title: `mixed` for rows that carry both (events, hashtags). */
export type TrendLang = "ar" | "en" | "mixed";

/**
 * One row of the radar, as `GET /trends` returns it. Only Google Trends and the YouTube charts are true
 * popularity rankings; `source` is the attribution label the UI always shows.
 */
export interface TrendItem {
  /** Stable per source + region + slug, e.g. "google:SA:حساب-المواطن" (normalize.ts `trendId`). */
  id: string;
  platform: TrendPlatform;
  region: TrendRegion;
  lang: TrendLang;
  title: string;
  url?: string;
  thumb?: string;
  /**
   * 0..100, relative within its source (rank 1 = 100); the keyword scan ranks its Arabic rows and its
   * English rows apart (youtubeSearch.ts `rankByViews`).
   */
  score?: number;
  growthPct?: number;
  volume?: number;
  /** "Google Trends" | "YouTube charts" | "YouTube search" | "kworb.net" | "Tavily scan" | "trends24.in" | "3z calendar". */
  source: TrendSourceLabel;
  /** One line of context: the first news headline or the search snippet. */
  why?: string;
  /** ISO with offset: when the row was first seen (normalize.ts `mergeItems` keeps it across runs). */
  seenAt: string;
  /** ISO with offset; the row is dropped once past it. */
  expiresAt?: string;
  tags: string[];
  skillHint?: string;
  /**
   * Edit-genre id (round 31, planning/data/genres.json): set by the daily keyword scan on rows a genre's
   * main query found (youtubeSearch.ts); rows of a niche keyword and of every other source leave it out.
   */
  genre?: string;
}

/** The attribution labels, exactly as the dashboard shows them (never "trending" for a chart or a scan). */
export const SOURCE_LABELS = {
  google: "Google Trends",
  youtube: "YouTube charts",
  youtubeSearch: "YouTube search",
  kworb: "kworb.net",
  tavily: "Tavily scan",
  x: "trends24.in",
  events: "3z calendar",
} as const;
export type TrendSourceKey = keyof typeof SOURCE_LABELS;
export type TrendSourceLabel = (typeof SOURCE_LABELS)[TrendSourceKey];

/** One source's outcome in the last run (`kv`: the feed could not be read or saved; never stored). */
export interface TrendSourceStatus {
  name: TrendSourceLabel | "kv";
  ok: boolean;
  at?: string;
  error?: string;
}

/** The body of `GET /trends` (200 even when empty: `degraded` true, no items). */
export interface TrendsFeed {
  items: TrendItem[];
  fetchedAt: string | null;
  /** True when at least one configured source failed and the feed is the previous good copy (or empty). */
  degraded: boolean;
  sources: TrendSourceStatus[];
}

export const EMPTY_FEED: TrendsFeed = { items: [], fetchedAt: null, degraded: true, sources: [] };

/** Bindings the trend job reads (a subset of the Worker's `Env`). */
export interface TrendsEnv {
  SOCIAL_KV?: KVNamespace;
  /** Secret: Tavily API key (the weekly scan shares it with `/search`). */
  TAVILY_API_KEY?: string;
  /** Secret: a Google Cloud API key restricted to the YouTube Data API v3 (charts + keyword search). */
  YOUTUBE_API_KEY?: string;
  /** Var: comma list of enabled sources (default `DEFAULT_TREND_SOURCES` in run.ts). */
  TREND_SOURCES?: string;
  /**
   * Vars: comma lists of the owner's niche keywords for the daily YouTube search (the edit genres' main
   * queries are scanned too, from the bundled planning/data/genres.json: genres.ts).
   */
  TREND_KEYWORDS_AR?: string;
  TREND_KEYWORDS_EN?: string;
}

/** What every source gets for one run (run.ts): the bindings, a fetch with a shared call budget, "now". */
export interface SourceCtx {
  env: TrendsEnv;
  fetch: typeof fetch;
  budget: Budget;
  now: Date;
  /** `POST /trends/run { force: true }`: run the weekly scan even when this week's is done. */
  force?: boolean;
  /**
   * The stored feed's rows, for a source that refreshes only a part of its own rows per run (the keyword
   * scan rotates its keywords by day and keeps the rows of the ones it did not search today).
   */
  previous?: readonly TrendItem[];
}

/**
 * What one source produced. `ok: false` keeps the source's previous rows and marks the feed degraded
 * (unless the error is `not_configured`: a missing key is a setup state, not a failure). `skipped`: the
 * source chose not to run (the weekly scan already ran this week); its previous rows stay, `note` says why.
 */
export type SourceOutput =
  | { ok: true; items: TrendItem[]; degraded?: boolean; note?: string; skipped?: boolean }
  | { ok: false; error: string };

/** When a source runs: every 6 h, once a day, or once a week (cron.ts `TREND_SLOTS`). */
export type TrendKind = "fast" | "daily" | "weekly";
export const TREND_KINDS: readonly TrendKind[] = ["fast", "daily", "weekly"];

export function isTrendKind(x: unknown): x is TrendKind {
  return typeof x === "string" && (TREND_KINDS as readonly string[]).includes(x);
}
