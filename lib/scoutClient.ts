import type { Lang } from "./domain";

/**
 * Client for the Scout Worker (build plan 1.14, `workers/scout/`): TikTok / Instagram / YouTube search via
 * Tavily, oEmbed enrichment for pasted links, and a health check. The Worker URL and token live in
 * Settings (`settings.apiKeys.scoutUrl` / `scoutToken`), on this device only.
 *
 * Tavily's free plan is 1,000 searches a month, so every search is cached per topic and Worker (memory +
 * localStorage, 24 h, 10 min for an empty answer, 50 entries, versioned by {@link SCOUT_CACHE_VERSION}) and
 * each real call bumps a per-month counter the UI shows ("~N of 1000 this month").
 * Nothing here throws: failures come back as a typed `{ ok: false, error }`.
 */

export type ScoutPlatform = "tt" | "ig" | "yt";
const PLATFORMS: readonly ScoutPlatform[] = ["tt", "ig", "yt"];

export interface ScoutConfig {
  url: string;
  token: string;
}

/**
 * How far a post went, when the source says so (round 31): YouTube views / likes / comments from the Data
 * API, TikTok and Instagram likes / comments read off the page's heading. Non-negative whole numbers; a
 * count nobody reported is left out. MIRRORS `Stats` in `workers/scout/src/normalize.ts` (hand-copied).
 */
export interface Stats {
  views?: number;
  likes?: number;
  comments?: number;
}

export interface ScoutResult {
  platform: ScoutPlatform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
  thumb?: string;
  /** Only when the Worker found at least one count (never an empty object). */
  stats?: Stats;
}

export interface ScoutOembed {
  title: string;
  author: string;
  thumb: string;
  url: string;
}

export type ScoutErrorType =
  | "unconfigured"
  | "quota"
  | "auth"
  | "network"
  | "upstream"
  | "ai_unavailable"
  | "ai_limit"
  | "local_ai_unavailable"
  | "subscription_auth"
  | "subscription_limit"
  | "subscription_model"
  | "subscription_failed"
  | "subscription_worker_upgrade";
export interface ScoutError {
  type: ScoutErrorType;
  status?: number;
}

export type ScoutSearchResult =
  { ok: true; results: ScoutResult[]; cached: boolean } | { ok: false; error: ScoutError };
export type ScoutOembedResult = { ok: true; data: ScoutOembed } | { ok: false; error: ScoutError };
export type ScoutHealthResult =
  { ok: true; tavily: boolean; discover: boolean } | { ok: false; error: ScoutError };

/** Recency filter, sent to the Worker as `timeRange` (Tavily `time_range`). */
export type ScoutTimeRange = "week" | "month" | "year";

export interface ScoutSearchParams {
  q: string;
  platforms: readonly ScoutPlatform[];
  lang?: Lang;
  max?: number;
  /** Only results published in the last week / month / year (omit for any time). */
  timeRange?: ScoutTimeRange;
  /** Ask the Worker for thumbnails (TikTok oEmbed enrichment). The Worker defaults to true. */
  thumbs?: boolean;
}

/** Minimal Storage surface we use (so tests can pass a plain Map-backed fake). */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ScoutOpts {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `window.localStorage` (null = memory only). */
  storage?: KeyValueStorage | null;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface ScoutSearchOpts extends ScoutOpts {
  signal?: AbortSignal;
  /** Skip the cache read and ask the Worker again (a "search again" button); the answer is still cached. */
  force?: boolean;
}

export const SCOUT_CACHE_KEY = "3z-scout-cache";
export const SCOUT_USAGE_KEY = "3z-scout-usage";
/**
 * Bump when the Worker's result shape or normalization changes, so results cached from the old Worker
 * (e.g. Instagram cards titled just "Instagram", before v2; cards without `stats`, before v3) are never
 * served again.
 */
export const SCOUT_CACHE_VERSION = 3;
export const SCOUT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** An empty answer is often a Tavily hiccup or a too-narrow filter: keep it only briefly. */
export const SCOUT_CACHE_EMPTY_TTL_MS = 10 * 60 * 1000;
export const SCOUT_CACHE_MAX = 50;
/** Tavily's free monthly allowance (searches). */
export const SCOUT_MONTHLY_FREE = 1000;

/* ---------- config ---------- */

/** An https URL, or http on localhost/127.0.0.1 (for `wrangler dev`). */
export function isValidScoutUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol === "https:") return !!u.hostname;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

/** The usable config from the two stored settings, or null when either is missing or the URL is invalid. */
export function scoutConfig(url?: string, token?: string): ScoutConfig | null {
  const u = url?.trim();
  const t = token?.trim();
  if (!u || !t || !isValidScoutUrl(u)) return null;
  return { url: u.replace(/\/+$/, ""), token: t };
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const storageOf = (opts: ScoutOpts) =>
  opts.storage === undefined ? defaultStorage() : opts.storage;
const nowOf = (opts: ScoutOpts) => (opts.now ?? Date.now)();

/* ---------- error mapping ---------- */

export type ScoutErrorMessageKey =
  | "search.localAiUnavailable"
  | "search.subscriptionAuth"
  | "search.subscriptionLimit"
  | "search.subscriptionModel"
  | "search.subscriptionFailed"
  | "search.subscriptionWorkerUpgrade"
  | "search.aiUnavailable"
  | "search.aiLimit"
  | "research.scoutNotConfigured"
  | "research.scoutErrQuota"
  | "research.scoutErrAuth"
  | "research.scoutErrNetwork"
  | "research.scoutErrUpstream";

/** Message key (in `messages/*.json`) for a {@link ScoutError}. */
export function scoutErrorMessageKey(error: ScoutError): ScoutErrorMessageKey {
  switch (error.type) {
    case "local_ai_unavailable":
      return "search.localAiUnavailable";
    case "subscription_auth":
      return "search.subscriptionAuth";
    case "subscription_limit":
      return "search.subscriptionLimit";
    case "subscription_model":
      return "search.subscriptionModel";
    case "subscription_failed":
      return "search.subscriptionFailed";
    case "subscription_worker_upgrade":
      return "search.subscriptionWorkerUpgrade";
    case "ai_unavailable":
      return "search.aiUnavailable";
    case "ai_limit":
      return "search.aiLimit";
    case "unconfigured":
      return "research.scoutNotConfigured";
    case "quota":
      return "research.scoutErrQuota";
    case "auth":
      return "research.scoutErrAuth";
    case "network":
      return "research.scoutErrNetwork";
    default:
      return "research.scoutErrUpstream";
  }
}

async function errorFrom(res: Response): Promise<ScoutError> {
  let code: unknown;
  try {
    code = ((await res.json()) as { error?: unknown }).error;
  } catch {
    // Not JSON (e.g. a Cloudflare error page); map by status below.
  }
  if (res.status === 401 || code === "auth" || code === "unauthorized" || code === "origin") {
    return { type: "auth", status: res.status };
  }
  if (code === "ai_unavailable" || code === "ai_limit") return { type: code, status: res.status };
  if (code === "quota" || res.status === 429) return { type: "quota", status: res.status };
  return { type: "upstream", status: res.status };
}

async function call(
  config: ScoutConfig,
  path: string,
  init: RequestInit,
  opts: ScoutOpts,
): Promise<{ ok: true; data: unknown } | { ok: false; error: ScoutError }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${config.url}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${config.token}` },
    });
  } catch {
    return { ok: false, error: { type: "network" } };
  }
  if (!res.ok) return { ok: false, error: await errorFrom(res) };
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: { type: "upstream", status: res.status } };
  }
}

/** The authenticated Worker call (JSON in and out), for the other Worker clients (lib/discover.ts). */
export const scoutCall = call;

/* ---------- search cache ---------- */

interface CacheEntry {
  at: number;
  results: ScoutResult[];
}

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ScoutSearchResult>>();

/**
 * Request key for a search: platforms (sorted), language, max, time range, thumbnails flag and the
 * normalized query text. Identifies the request only; the cache stores it under {@link scoutStorageKey}.
 */
export function scoutCacheKey(p: ScoutSearchParams): string {
  const q = p.q.trim().toLowerCase().replace(/\s+/g, " ");
  const thumbs = p.thumbs === false ? "0" : "1";
  return `${[...p.platforms].sort().join(",")}|${p.lang ?? ""}|${p.max ?? ""}|${p.timeRange ?? ""}|${thumbs}|${q}`;
}

const versionPrefix = `v${SCOUT_CACHE_VERSION}|`;

/**
 * Where a search is cached: {@link SCOUT_CACHE_VERSION}, the Worker URL (a different Worker is a different
 * source) and the request key.
 */
export function scoutStorageKey(config: ScoutConfig, p: ScoutSearchParams): string {
  return `${versionPrefix}${config.url}|${scoutCacheKey(p)}`;
}

/** How long an entry stays fresh: 24 h, or 10 min for an empty result list. */
const ttlOf = (e: CacheEntry) =>
  e.results.length === 0 ? SCOUT_CACHE_EMPTY_TTL_MS : SCOUT_CACHE_TTL_MS;

const isFresh = (key: string, e: unknown, now: number): e is CacheEntry => {
  if (!key.startsWith(versionPrefix) || !e || typeof e !== "object") return false;
  const c = e as CacheEntry;
  return typeof c.at === "number" && Array.isArray(c.results) && now - c.at < ttlOf(c);
};

function readStored(storage: KeyValueStorage | null): Record<string, CacheEntry> {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(SCOUT_CACHE_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function cacheGet(key: string, opts: ScoutOpts): ScoutResult[] | undefined {
  const now = nowOf(opts);
  const mem = memory.get(key);
  if (isFresh(key, mem, now)) return mem.results;
  const stored = readStored(storageOf(opts))[key];
  if (isFresh(key, stored, now)) {
    memory.set(key, stored);
    return stored.results;
  }
  return undefined;
}

function cacheSet(key: string, results: ScoutResult[], opts: ScoutOpts): void {
  const now = nowOf(opts);
  const entry = { at: now, results };
  memory.set(key, entry);
  const storage = storageOf(opts);
  if (!storage) return;
  const all: Record<string, unknown> = { ...readStored(storage), [key]: entry };
  // Stale, malformed and old-version entries are dropped on every write.
  const kept = Object.entries(all)
    .filter((kv): kv is [string, CacheEntry] => isFresh(kv[0], kv[1], now))
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, SCOUT_CACHE_MAX);
  try {
    storage.setItem(SCOUT_CACHE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage full or blocked: the in-memory cache still saves credits for this session.
  }
}

/** Forget every cached search (memory and storage). Also used by tests. */
export function clearScoutCache(storage: KeyValueStorage | null = defaultStorage()): void {
  memory.clear();
  inflight.clear();
  try {
    storage?.removeItem(SCOUT_CACHE_KEY);
  } catch {
    // ignore
  }
}

/* ---------- monthly usage counter ---------- */

export interface ScoutUsage {
  month: string;
  count: number;
}

/** "YYYY-MM" in local time. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const usageListeners = new Set<() => void>();

/** Real Worker searches made this calendar month on this device (0 in a new month). */
export function getScoutUsage(opts: ScoutOpts = {}): number {
  const storage = storageOf(opts);
  if (!storage) return 0;
  try {
    const u = JSON.parse(storage.getItem(SCOUT_USAGE_KEY) ?? "null") as ScoutUsage | null;
    return u && u.month === monthKey(nowOf(opts)) && typeof u.count === "number" ? u.count : 0;
  } catch {
    return 0;
  }
}

function bumpScoutUsage(opts: ScoutOpts): void {
  const storage = storageOf(opts);
  if (!storage) return;
  const next: ScoutUsage = { month: monthKey(nowOf(opts)), count: getScoutUsage(opts) + 1 };
  try {
    storage.setItem(SCOUT_USAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  usageListeners.forEach((l) => l());
}

/** Subscribe to usage changes (for `useSyncExternalStore`). Returns the unsubscribe function. */
export function subscribeScoutUsage(listener: () => void): () => void {
  usageListeners.add(listener);
  return () => usageListeners.delete(listener);
}

/* ---------- API ---------- */

const STAT_KEYS = ["views", "likes", "comments"] as const;

/**
 * The counts worth keeping from a `stats` object of unknown shape: finite numbers ≥ 0, rounded down to whole
 * numbers. Anything else (a string, a negative, NaN, Infinity) is dropped; undefined when no count is left,
 * so a card never carries an empty `stats`.
 */
export function parseStats(raw: unknown): Stats | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Stats = {};
  for (const k of STAT_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseResults(data: unknown): ScoutResult[] {
  const raw = (data as { results?: unknown })?.results;
  if (!Array.isArray(raw)) return [];
  const out: ScoutResult[] = [];
  for (const r of raw as Partial<ScoutResult>[]) {
    if (!r || typeof r.url !== "string" || !PLATFORMS.includes(r.platform as ScoutPlatform))
      continue;
    const stats = parseStats(r.stats);
    out.push({
      platform: r.platform as ScoutPlatform,
      handle: typeof r.handle === "string" ? r.handle : "",
      title: typeof r.title === "string" && r.title ? r.title : r.url,
      snippet: typeof r.snippet === "string" ? r.snippet : "",
      url: r.url,
      ...(typeof r.thumb === "string" && /^https?:\/\//.test(r.thumb) ? { thumb: r.thumb } : {}),
      ...(stats ? { stats } : {}),
    });
  }
  return out;
}

/**
 * Search through the Worker. Served from the per-topic cache when possible (`cached: true`, no credit
 * spent) unless `opts.force`; concurrent identical searches share one request. Each real successful call
 * bumps the monthly counter. Empty answers are cached for {@link SCOUT_CACHE_EMPTY_TTL_MS} only.
 */
export async function scoutSearch(
  config: ScoutConfig | null,
  params: ScoutSearchParams,
  opts: ScoutSearchOpts = {},
): Promise<ScoutSearchResult> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const key = scoutStorageKey(config, params);
  const hit = opts.force ? undefined : cacheGet(key, opts);
  if (hit) return { ok: true, results: hit, cached: true };
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = (async (): Promise<ScoutSearchResult> => {
    const r = await call(
      config,
      "/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: params.q.trim(),
          platforms: params.platforms,
          lang: params.lang,
          max: params.max,
          timeRange: params.timeRange,
          thumbs: params.thumbs,
        }),
      },
      opts,
    );
    if (!r.ok) return r;
    const results = parseResults(r.data);
    bumpScoutUsage(opts);
    cacheSet(key, results, opts);
    return { ok: true, results, cached: false };
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/**
 * The cached results for a search on this Worker, if any, without fetching or spending a credit (for tab
 * count badges). Same key and freshness rules as {@link scoutSearch}.
 */
export function peekScoutSearch(
  config: ScoutConfig | null,
  params: ScoutSearchParams,
  opts: ScoutOpts = {},
): ScoutResult[] | undefined {
  return config ? cacheGet(scoutStorageKey(config, params), opts) : undefined;
}

/** TikTok / YouTube oEmbed through the Worker (title, author, thumbnail for a pasted link). */
export async function scoutOembed(
  config: ScoutConfig | null,
  videoUrl: string,
  opts: ScoutOpts = {},
): Promise<ScoutOembedResult> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, `/oembed?url=${encodeURIComponent(videoUrl)}`, {}, opts);
  if (!r.ok) return r;
  const d = (r.data ?? {}) as Partial<ScoutOembed>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const thumb = str(d.thumb);
  return {
    ok: true,
    data: {
      title: str(d.title),
      author: str(d.author),
      thumb: /^https?:\/\//.test(thumb) ? thumb : "",
      url: str(d.url) || videoUrl,
    },
  };
}

/**
 * `GET /health` with the token: ok when the Worker accepts it; `tavily` says whether its key is set,
 * `discover` whether it serves `POST /discover` (false for a Worker from before Discover v2).
 */
export async function scoutHealth(
  config: ScoutConfig | null,
  opts: ScoutOpts = {},
): Promise<ScoutHealthResult> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/health", {}, opts);
  if (!r.ok) return r;
  const d = (r.data ?? {}) as { ok?: unknown; tavily?: unknown; discover?: unknown };
  // The Worker only reports `tavily` once it has accepted the token; a bare `{ ok: true }` means it didn't
  // check it (no Authorization reached it), so treat that as an auth problem too.
  if (d.ok !== true || typeof d.tavily !== "boolean") return { ok: false, error: { type: "auth" } };
  return { ok: true, tavily: d.tavily, discover: d.discover === true };
}
