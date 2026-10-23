"use client";

import { createStore, get, update, type UseStore } from "idb-keyval";
import type { DiscoverItem, DiscoverPlatform } from "./discover";
import type { Lang } from "./domain";

export type NativeQueries = Partial<Record<DiscoverPlatform, string>>;
export type NativeConnection = "checking" | "connected" | "missing" | "permission";
export type NativeSearchErrorCode =
  | "missing"
  | "permission"
  | "timeout"
  | "invalid-response"
  | "invalid-query"
  | "unavailable"
  | "expired";
export class NativeSearchError extends Error {
  constructor(public readonly code: NativeSearchErrorCode) {
    super(code);
    this.name = "NativeSearchError";
  }
}
export interface NativeResult {
  platform: DiscoverPlatform;
  url: string;
  title: string;
  handle?: string;
  thumb?: string;
  position: number;
  observedAt: string;
  /** Unverified text displayed by the native search page; never numeric source evidence. */
  displayedStats?: string;
}
export interface NativePlatformSnapshot {
  status: "loading" | "done" | "empty" | "needs-attention" | "error";
  results: NativeResult[];
  searchUrl: string;
  /** Earlier loaded cards removed from the bounded browsing window; not platform supply. */
  omittedCount?: number;
  /** App-owned fallback metadata: these cards came from an earlier successful search. */
  staleAsOf?: string;
  error?: string;
  /** Empty because the platform rendered its own "No results" screen for this exact query. */
  noResults?: true;
}
export interface NativeJobSnapshot {
  jobId: string;
  status: "running" | "complete" | "cancelled";
  platforms: Partial<Record<DiscoverPlatform, NativePlatformSnapshot>>;
  hasMore: boolean;
  /** A Deep search ran the normal budget because Discover was not in front (the helper's reason). */
  deepSkipped?: string;
}
export interface NativeSearchSnapshot extends NativeJobSnapshot {
  genreId: string;
  queries: NativeQueries;
  cached: boolean;
  asOf: string;
  /** Set when the explicit Deep search ran it (the helper may show its tabs); absent = quiet. */
  deep?: true;
}

/** A failed read must not erase the last successful batch for this exact category/platform query. */
export function retainFailedNativePlatforms(
  previous: NativeSearchSnapshot | null,
  next: NativeSearchSnapshot,
): NativeSearchSnapshot {
  if (!previous || previous.genreId !== next.genreId) return next;
  const platforms = { ...next.platforms };
  for (const platform of ["ig", "tt", "yt"] as const) {
    const current = platforms[platform];
    const prior = previous.platforms[platform];
    if (
      !current ||
      !prior ||
      !next.queries[platform] ||
      next.queries[platform] !== previous.queries[platform] ||
      !["error", "needs-attention"].includes(current.status) ||
      current.results.length ||
      !prior.results.length ||
      // Cards kept or cached while More was still loading were received too.
      (!["done", "loading"].includes(prior.status) && !prior.staleAsOf)
    )
      continue;
    platforms[platform] = {
      ...current,
      results: prior.results,
      omittedCount: prior.omittedCount,
      staleAsOf: prior.staleAsOf ?? previous.asOf,
    };
  }
  return { ...next, platforms };
}

/** The fresh native order is authoritative for cards it shows. A retained card it
 * no longer shows stays right after its nearest preceding shown card (or first).
 * Same rule as the helper's merge in extensions/discover-import/native-search.js. */
function observedOrder<T>(byKey: Map<string, T>, order: string[]): T[] {
  const rank = new Map<string, number>();
  for (const key of order) if (!rank.has(key)) rank.set(key, rank.size);
  const trailing = new Map<string | null, string[]>([[null, []]]);
  let anchor: string | null = null;
  for (const key of byKey.keys()) {
    if (rank.has(key)) trailing.set((anchor = key), []);
    else trailing.get(anchor)!.push(key);
  }
  const shown = [...trailing.keys()].filter((key): key is string => key !== null);
  shown.sort((a, b) => rank.get(a)! - rank.get(b)!);
  return [null, ...shown]
    .flatMap((key) => (key === null ? [] : [key]).concat(trailing.get(key)!))
    .map((key) => byKey.get(key)!);
}

/** Continue an exact saved search without claiming its retained cards were observed again. */
export function appendNativeSearchSnapshot(
  previous: NativeSearchSnapshot | null,
  next: NativeSearchSnapshot,
): NativeSearchSnapshot {
  if (
    !previous ||
    previous.genreId !== next.genreId ||
    Object.keys(previous.queries).length !== Object.keys(next.queries).length ||
    Object.entries(next.queries).some(
      ([platform, query]) => previous.queries[platform as DiscoverPlatform] !== query,
    )
  )
    return next;
  const platforms = { ...next.platforms };
  for (const platform of PLATFORMS) {
    const prior = previous.platforms[platform];
    const current = platforms[platform];
    if (!prior || !current) continue;
    const key = (result: NativeResult) => canonicalNativeUrl(platform, result.url) ?? result.url;
    const combined = new Map(prior.results.map((result) => [key(result), result]));
    const refreshed = new Set(current.results.map(key));
    for (const result of current.results) combined.set(key(result), result);
    const dropped = Math.max(0, combined.size - NATIVE_MAX_RESULTS);
    const results = observedOrder(combined, [...refreshed])
      .slice(dropped)
      .map((result, index) => ({
        ...result,
        position: index + 1,
      }));
    const staleAsOf = results.some((result) => !refreshed.has(key(result)))
      ? (prior.staleAsOf ?? previous.asOf)
      : undefined;
    platforms[platform] = {
      ...current,
      results,
      omittedCount: Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max((prior.omittedCount ?? 0) + dropped, current.omittedCount ?? 0),
      ),
      ...(staleAsOf ? { staleAsOf } : {}),
    };
  }
  return { ...next, platforms };
}

export const NATIVE_MAX_RESULTS = 300;
// The 12 most recently searched categories (measured 22 Oct 2026, per category: typical 24 cards ≈ 20 KiB, full 900 ≈ 0.7 MiB, worst ≈ 3 MiB); older ones show Checked references.
export const NATIVE_CACHE_CATEGORIES = 12;
/** The Search tab's keyword results: cache entries kept beside the categories, never evicting one. */
export const NATIVE_SEARCH_SCOPE = "search";
/** The Search tab's CapCut and DaVinci Resolve sections (owner's editors), also beside the categories. */
export const NATIVE_EDITOR_SCOPES = { capcut: "search-capcut", davinci: "search-davinci" } as const;
const SEARCH_SCOPES = new Set<string>([
  NATIVE_SEARCH_SCOPE,
  ...Object.values(NATIVE_EDITOR_SCOPES),
]);
export const NATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NATIVE_HELPER_STORAGE_KEY = "3z-prod-native-helper-id";
export const NATIVE_HELPER_EVENT = "3z-native-helper-change";
const PLATFORMS = ["ig", "tt", "yt"] as const;
const HELPER_ID = /^[a-p]{32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number, min = 1): value is string =>
  typeof value === "string" &&
  value.trim().length >= min &&
  value.length <= max &&
  !CONTROL.test(value);
const jobIdValid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const recentDate = (value: unknown, now: number, maxAge = Infinity): value is string => {
  if (!text(value, 40) || !/^\d{4}-\d\d-\d\dT/.test(value)) return false;
  const stamp = Date.parse(value);
  return (
    Number.isFinite(stamp) &&
    stamp >= 946684800000 &&
    stamp <= now + 300000 &&
    now - stamp <= maxAge
  );
};

function publicUrl(value: unknown): URL | null {
  if (!text(value, 2048) || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

/** Only public post URLs survive; tracking strings and fragments are dropped. */
export function canonicalNativeUrl(platform: DiscoverPlatform, value: unknown): string | null {
  const url = publicUrl(value);
  if (!url) return null;
  if (platform === "ig" && ["instagram.com", "www.instagram.com"].includes(url.hostname)) {
    const match = /^\/(?:p|reel|reels)\/([\w-]{5,64})\/?$/.exec(url.pathname);
    return match ? `https://www.instagram.com/p/${match[1]}/` : null;
  }
  if (
    platform === "tt" &&
    ["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(url.hostname)
  ) {
    const match = /^\/@([\w.-]{1,64})\/video\/(\d{10,30})\/?$/.exec(url.pathname);
    return match ? `https://www.tiktok.com/@${match[1]}/video/${match[2]}` : null;
  }
  if (platform === "yt") {
    let id: string | null = null;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
      id =
        url.pathname === "/watch"
          ? url.searchParams.get("v")
          : (/^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null);
    } else if (url.hostname === "youtu.be")
      id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  return null;
}

function searchUrl(platform: DiscoverPlatform, value: unknown): string | null {
  const url = publicUrl(value);
  if (!url) return null;
  if (
    (platform === "ig" &&
      ["www.instagram.com", "instagram.com"].includes(url.hostname) &&
      /^\/explore\/(?:search(?:\/keyword)?\/?|tags\/[\w%.-]+\/?)$/.test(url.pathname)) ||
    (platform === "tt" &&
      ["www.tiktok.com", "tiktok.com"].includes(url.hostname) &&
      /^\/search\/?$/.test(url.pathname)) ||
    (platform === "yt" &&
      ["www.youtube.com", "youtube.com"].includes(url.hostname) &&
      url.pathname === "/results")
  ) {
    url.hash = "";
    return url.href;
  }
  return null;
}
function thumbnail(platform: DiscoverPlatform, value: unknown): string | undefined {
  const url = publicUrl(value);
  if (!url) return;
  const hosts =
    platform === "ig"
      ? ["cdninstagram.com", "fbcdn.net"]
      : platform === "tt"
        ? [
            "tiktokcdn.com",
            "tiktokcdn-us.com",
            "tiktokcdn-eu.com",
            "byteoversea.com",
            "ibytedtos.com",
            "ibyteimg.com",
            "tiktok.com",
          ]
        : ["ytimg.com"];
  if (hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
    return url.href;
}
function nativeResult(
  value: unknown,
  platform: DiscoverPlatform,
  now: number,
): NativeResult | null {
  if (!isObject(value) || value.platform !== platform) return null;
  const url = canonicalNativeUrl(platform, value.url);
  if (
    !url ||
    !text(value.title, 1000, 0) ||
    !recentDate(value.observedAt, now) ||
    typeof value.position !== "number" ||
    !Number.isSafeInteger(value.position) ||
    value.position < 0 ||
    value.position > 10000
  )
    return null;
  return {
    platform,
    url,
    title: value.title.trim(),
    position: value.position,
    observedAt: new Date(value.observedAt).toISOString(),
    ...(text(value.handle, 100) ? { handle: value.handle.trim() } : {}),
    ...(thumbnail(platform, value.thumb) ? { thumb: thumbnail(platform, value.thumb) } : {}),
    ...(text(value.displayedStats, 200) ? { displayedStats: value.displayedStats.trim() } : {}),
  };
}

export function validateNativeQueries(value: unknown): NativeQueries | null {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => !PLATFORMS.includes(key as DiscoverPlatform))
  )
    return null;
  const result: NativeQueries = {};
  for (const platform of PLATFORMS) {
    if (value[platform] === undefined) continue;
    if (!text(value[platform], 120)) return null;
    result[platform] = value[platform].trim();
  }
  return Object.keys(result).length ? result : null;
}

export function validateNativeSnapshot(
  value: unknown,
  expectedJobId?: string,
  now = Date.now(),
): NativeJobSnapshot | null {
  if (
    !isObject(value) ||
    value.ok !== true ||
    !jobIdValid(value.jobId) ||
    (expectedJobId !== undefined && value.jobId !== expectedJobId) ||
    !["running", "complete", "cancelled"].includes(String(value.status)) ||
    !isObject(value.platforms)
  )
    return null;
  const platforms: NativeJobSnapshot["platforms"] = {};
  if (Object.keys(value.platforms).some((key) => !PLATFORMS.includes(key as DiscoverPlatform)))
    return null;
  for (const platform of PLATFORMS) {
    const raw = value.platforms[platform];
    if (raw === undefined) continue;
    if (
      !isObject(raw) ||
      !["loading", "done", "empty", "needs-attention", "error"].includes(String(raw.status)) ||
      !Array.isArray(raw.results) ||
      raw.results.length > NATIVE_MAX_RESULTS ||
      (raw.omittedCount !== undefined &&
        (typeof raw.omittedCount !== "number" ||
          !Number.isSafeInteger(raw.omittedCount) ||
          raw.omittedCount < 0))
    )
      return null;
    const nativeSearchUrl = searchUrl(platform, raw.searchUrl);
    if (!nativeSearchUrl) return null;
    const seen = new Set<string>();
    const results = raw.results
      .flatMap((entry) => {
        const parsed = nativeResult(entry, platform, now);
        if (!parsed || seen.has(parsed.url)) return [];
        seen.add(parsed.url);
        return [parsed];
      })
      .sort((a, b) => a.position - b.position);
    platforms[platform] = {
      status: raw.status as NativePlatformSnapshot["status"],
      results,
      searchUrl: nativeSearchUrl,
      ...(typeof raw.omittedCount === "number" ? { omittedCount: raw.omittedCount } : {}),
      ...(text(raw.error, 200) ? { error: raw.error } : {}),
      ...(raw.status === "empty" && raw.noResults === true ? { noResults: true as const } : {}),
    };
  }
  if (typeof value.hasMore !== "boolean") return null;
  const deepSkipped = isObject(value.diagnostics) ? value.diagnostics.deepSkipped : undefined;
  return {
    jobId: value.jobId,
    status: value.status as NativeJobSnapshot["status"],
    platforms,
    hasMore: value.hasMore,
    ...(typeof deepSkipped === "string" && /^[a-z-]{1,40}$/.test(deepSkipped)
      ? { deepSkipped }
      : {}),
  };
}

/** There are no private browser APIs here; the user connects the installed extension's public ID. */
interface ExternalRuntime {
  lastError?: { message?: string };
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void;
}
function runtime(): ExternalRuntime | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { chrome?: { runtime?: ExternalRuntime } }).chrome?.runtime;
}
let volatileHelperId: string | undefined;
export function attachNativeHelper(id: string): boolean {
  if (!HELPER_ID.test(id) || typeof window === "undefined") return false;
  volatileHelperId = id;
  try {
    window.localStorage.setItem(NATIVE_HELPER_STORAGE_KEY, id);
    volatileHelperId = undefined;
  } catch {
    /* This tab still works. */
  }
  window.dispatchEvent(new Event(NATIVE_HELPER_EVENT));
  return true;
}
export function nativeHelperId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(NATIVE_HELPER_STORAGE_KEY);
    if (saved && HELPER_ID.test(saved)) return saved;
  } catch {
    /* Storage can be disabled. */
  }
  return volatileHelperId ?? null;
}
/** Call at app mount too: the popup can connect before a category is open. Other hashes are untouched. */
export function initializeNativeHelper(): string | null {
  if (typeof window === "undefined") return null;
  const match = /^#discover-helper=([a-p]{32})$/.exec(window.location.hash);
  if (match) {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
    attachNativeHelper(match[1]);
  }
  return nativeHelperId();
}
function helperError(value: unknown): NativeSearchError {
  const error = isObject(value) ? value.error : undefined;
  return new NativeSearchError(
    error === "job-not-found"
      ? "expired"
      : typeof error === "string" && /permission|not.connected|access.denied|forbidden/i.test(error)
        ? "permission"
        : "unavailable",
  );
}
function send(message: unknown, helperId = nativeHelperId()): Promise<unknown> {
  const api = runtime();
  if (!helperId || !api?.sendMessage) return Promise.reject(new NativeSearchError("missing"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new NativeSearchError("timeout"));
    }, 8000);
    const finish = (error?: NativeSearchError, response?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(response);
    };
    try {
      api.sendMessage(helperId, message, (response) => {
        // Chrome requires lastError to be read while the callback is active.
        const lastError = api.lastError;
        if (lastError)
          return finish(
            new NativeSearchError(
              /permission|not.allowed|denied/i.test(lastError.message ?? "")
                ? "permission"
                : "missing",
            ),
          );
        if (isObject(response) && response.ok === false) return finish(helperError(response));
        finish(undefined, response);
      });
    } catch {
      finish(new NativeSearchError("missing"));
    }
  });
}
export async function nativeHelperStatus(): Promise<Exclude<NativeConnection, "checking">> {
  try {
    const value = await send({ version: 1, type: "status" });
    if (
      !isObject(value) ||
      value.ok !== true ||
      value.version !== 1 ||
      typeof value.connected !== "boolean"
    )
      throw new NativeSearchError("invalid-response");
    return value.connected ? "connected" : "permission";
  } catch (error) {
    return error instanceof NativeSearchError && error.code === "permission"
      ? "permission"
      : "missing";
  }
}
/** A quiet search (the normal Search button) sends no `deep` field, so helpers before 0.3.7 still accept it. */
export async function startNativeSearch(
  queries: NativeQueries,
  requestId: string,
  { deep = false }: { deep?: boolean } = {},
): Promise<string> {
  const valid = validateNativeQueries(queries);
  if (!valid || !jobIdValid(requestId)) throw new NativeSearchError("invalid-query");
  const value = await send({
    version: 1,
    type: "search",
    requestId,
    queries: valid,
    ...(deep ? { deep: true } : {}),
  });
  if (!isObject(value) || value.ok !== true || !jobIdValid(value.jobId))
    throw new NativeSearchError("invalid-response");
  return value.jobId;
}
export async function pollNativeSearch(jobId: string): Promise<NativeJobSnapshot> {
  if (!jobIdValid(jobId)) throw new NativeSearchError("invalid-query");
  const parsed = validateNativeSnapshot(await send({ version: 1, type: "poll", jobId }), jobId);
  if (!parsed) throw new NativeSearchError("invalid-response");
  return parsed;
}
export async function moreNativeSearch(jobId: string): Promise<void> {
  if (!jobIdValid(jobId)) throw new NativeSearchError("invalid-query");
  const parsed = validateNativeSnapshot(await send({ version: 1, type: "more", jobId }), jobId);
  if (!parsed) throw new NativeSearchError("invalid-response");
}
export async function cancelNativeSearch(jobId: string): Promise<void> {
  if (!jobIdValid(jobId)) return;
  const parsed = validateNativeSnapshot(await send({ version: 1, type: "cancel", jobId }), jobId);
  if (!parsed || parsed.status !== "cancelled") throw new NativeSearchError("invalid-response");
}

/** Native cards carry text and a source link, never forged API/engagement evidence. */
export function nativeResultsToItems(
  snapshot: NativeSearchSnapshot | null,
  lang: Lang,
): DiscoverItem[] {
  if (!snapshot) return [];
  const length = Math.max(
    0,
    ...PLATFORMS.map((platform) => snapshot.platforms[platform]?.results.length ?? 0),
  );
  const interleaved = Array.from({ length }, (_, index) =>
    PLATFORMS.flatMap((platform) => {
      const result = snapshot.platforms[platform]?.results[index];
      return result ? [result] : [];
    }),
  ).flat();
  return interleaved.map((result): DiscoverItem => {
    const youtubeUrl = result.platform === "yt" ? canonicalNativeUrl("yt", result.url) : null;
    const youtubeId = youtubeUrl?.match(/\?v=([\w-]{11})$/)?.[1];
    // Reuse the exact-video poster used by Discover references; native DOM images may be lazy loaded.
    const thumb =
      thumbnail(result.platform, result.thumb) ??
      (youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : undefined);
    return {
      platform: result.platform,
      url: result.url,
      title: result.title || (lang === "ar" ? "نتيجة من بحث المنصة" : "Native search result"),
      handle: result.handle ?? "",
      snippet: result.displayedStats
        ? `${lang === "ar" ? "ظاهر في نتائج البحث" : "Shown in native search"}: ${result.displayedStats}`
        : "",
      ...(thumb ? { thumb } : {}),
      lang,
      section: "example",
    };
  });
}

let cacheStore: UseStore | undefined;
const cacheDb = () => (cacheStore ??= createStore("3z-prod-native-search", "categories"));
export function validNativeCache(value: unknown, now = Date.now()): NativeSearchSnapshot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  let categories = 0;
  return value
    .slice(0, 100)
    .flatMap((entry) => {
      if (
        !isObject(entry) ||
        !text(entry.genreId, 120) ||
        !recentDate(entry.asOf, now, NATIVE_CACHE_TTL_MS)
      )
        return [];
      const queries = validateNativeQueries(entry.queries);
      const snapshot = validateNativeSnapshot({ ...entry, ok: true }, undefined, now);
      if (!queries || !snapshot) return [];
      if (isObject(entry.platforms))
        for (const platform of PLATFORMS) {
          const raw = entry.platforms[platform];
          const restored = snapshot.platforms[platform];
          if (!restored) continue;
          // A cache written mid-read is idle once reopened: received cards are done; an empty unfinished read failed.
          if (restored.status === "loading")
            restored.status = restored.results.length ? "done" : "error";
          // The bridge cannot supply this marker; only persisted app fallbacks restore it.
          if (isObject(raw) && recentDate(raw.staleAsOf, now)) restored.staleAsOf = raw.staleAsOf;
        }
      return [
        {
          ...snapshot,
          genreId: entry.genreId,
          queries,
          cached: true,
          asOf: entry.asOf,
          ...(entry.deep === true ? { deep: true as const } : {}),
        },
      ];
    })
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))
    .filter((entry) => {
      if (seen.has(entry.genreId)) return false;
      seen.add(entry.genreId);
      return SEARCH_SCOPES.has(entry.genreId) || categories++ < NATIVE_CACHE_CATEGORIES;
    });
}
async function cacheTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Native cache unavailable")), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function readNativeSearchCache(genreId: string): Promise<NativeSearchSnapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const entries = validNativeCache(await cacheTimeout(get("recent", cacheDb())));
    return entries.find((entry) => entry.genreId === genreId) ?? null;
  } catch {
    return null;
  }
}
export async function writeNativeSearchCache(snapshot: NativeSearchSnapshot): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await cacheTimeout(
      update<unknown>(
        "recent",
        (old) => validNativeCache([snapshot, ...validNativeCache(old)]),
        cacheDb(),
      ),
    );
  } catch {
    /* Search remains usable when storage is full, blocked, or unavailable. */
  }
}
