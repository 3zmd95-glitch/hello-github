/**
 * Discover v2 step 2: the outbound calls (planning/tools/13-discover-search-v2.md). One Tavily search per
 * TikTok / Instagram query (20 results, the same 1 credit as 10), one YouTube `search.list` per YouTube query
 * (20 results, 1 of the project's 100 calls a day), and the day's YouTube reservation: Discover and the connector
 * may spend `DISCOVER_YT_CAP` (70) calls a UTC day, so the Trend Radar keeps its 18. KV has no atomic increment:
 * the cap is best-effort when two searches overlap (the radar's counter works the same way).
 */

import {
  normalizeDiscoverHits,
  PLATFORM_DOMAIN,
  type Profile,
  type ScoutResult,
} from "../normalize";
import { utcDay } from "../trends/kv";
import { TAVILY_URL } from "../trends/tavily";
import { YT_SEARCH_URL } from "../trends/youtubeSearch";
import type { Lang } from "./terms";
import type { DiscoverTimeRange, PlatformError } from "./types";

export interface FetchEnv {
  AI?: import("./ai").SearchAiBinding;
  TAVILY_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  SOCIAL_KV?: KVNamespace;
  /** Var: `search.list` calls Discover and the connector may spend a UTC day (default 70). */
  DISCOVER_YT_CAP?: string;
}

export const CALL_TIMEOUT_MS = 12_000;
export const RESULTS_PER_CALL = 20;
export const DEFAULT_YT_CAP = 70;
const COUNTER_TTL_S = 2 * 86_400;
const SNIPPET_MAX = 220;
const TITLE_MAX = 160;
const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<DiscoverTimeRange, number> = { week: 7, month: 30, year: 365 };

export const discoverKeys = {
  yt: (day: string) => `discover:yt:${day}`,
};

/** Runs `run` with a hard limit (body included) so one slow site cannot hold the whole search. */
async function timed<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(ac.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Tavily ---------- */

export type TavilyOutcome =
  | { ok: true; cards: ScoutResult[]; profiles: Profile[]; credits: number }
  | { ok: false; error: PlatformError };

export async function tavilyCall(
  env: FetchEnv,
  doFetch: typeof fetch,
  call: { q: string; platform: "tt" | "ig"; lang: Lang; timeRange?: DiscoverTimeRange },
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<TavilyOutcome> {
  if (!env.TAVILY_API_KEY) return { ok: false, error: "not_configured" };
  const key = env.TAVILY_API_KEY;
  try {
    const out = await timed(timeoutMs, async (signal): Promise<TavilyOutcome> => {
      const res = await doFetch(TAVILY_URL, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: call.q,
          include_domains: [PLATFORM_DOMAIN[call.platform]],
          max_results: RESULTS_PER_CALL,
          search_depth: "basic",
          include_images: true,
          include_published_date: true,
          include_usage: true,
          language: call.lang,
          ...(call.lang === "ar" ? { country: "saudi arabia" } : {}),
          ...(call.timeRange ? { time_range: call.timeRange } : {}),
        }),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: "auth" };
      if (res.status === 429 || res.status === 432 || res.status === 433)
        return { ok: false, error: "quota" };
      if (!res.ok) return { ok: false, error: "upstream" };
      const data = (await res.json()) as { results?: unknown[]; usage?: { credits?: number } };
      const hits = (Array.isArray(data.results) ? data.results : []) as Parameters<
        typeof normalizeDiscoverHits
      >[0];
      const { cards, profiles } = normalizeDiscoverHits(hits, call.platform);
      return { ok: true, cards, profiles, credits: data.usage?.credits ?? 1 };
    });
    return out ?? { ok: false, error: "upstream" };
  } catch {
    return { ok: false, error: "upstream" };
  }
}

/* ---------- YouTube ---------- */

interface YtSearchReply {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      channelId?: string;
      publishedAt?: string;
      thumbnails?: Partial<Record<"default" | "medium" | "high", { url?: string }>>;
    };
  }[];
  error?: { errors?: { reason?: string }[] };
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
};
const decode = (s: string) => s.replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e] ?? e);
const clip = (s: string, max: number) => {
  const flat = decode(s).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

export type YoutubeOutcome =
  { ok: true; cards: (ScoutResult & { profile?: string })[] } | { ok: false; error: PlatformError };

export function youtubeSearchUrl(
  key: string,
  call: { q: string; lang: Lang; timeRange?: DiscoverTimeRange; ytLength?: "short" | "long" },
  now: Date,
): string {
  const u = new URL(YT_SEARCH_URL);
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("maxResults", String(RESULTS_PER_CALL));
  u.searchParams.set("q", call.q);
  u.searchParams.set("relevanceLanguage", call.lang);
  u.searchParams.set("regionCode", call.lang === "ar" ? "SA" : "US");
  if (call.ytLength) u.searchParams.set("videoDuration", call.ytLength);
  if (call.timeRange) {
    u.searchParams.set(
      "publishedAfter",
      new Date(now.getTime() - RANGE_DAYS[call.timeRange] * DAY_MS).toISOString(),
    );
  }
  u.searchParams.set("key", key);
  return u.toString();
}

export async function youtubeCall(
  env: FetchEnv,
  doFetch: typeof fetch,
  call: { q: string; lang: Lang; timeRange?: DiscoverTimeRange; ytLength?: "short" | "long" },
  now: Date,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<YoutubeOutcome> {
  if (!env.YOUTUBE_API_KEY) return { ok: false, error: "not_configured" };
  const url = youtubeSearchUrl(env.YOUTUBE_API_KEY, call, now);
  try {
    const out = await timed(timeoutMs, async (signal): Promise<YoutubeOutcome> => {
      const res = await doFetch(url, { signal, headers: { Accept: "application/json" } });
      let body: YtSearchReply | null = null;
      try {
        body = (await res.json()) as YtSearchReply;
      } catch {
        body = null;
      }
      if (!res.ok) {
        const reason = body?.error?.errors?.[0]?.reason ?? "";
        if (/quota|dailyLimit|rateLimit/i.test(reason)) return { ok: false, error: "daily_cap" };
        if (res.status === 400 || res.status === 403) return { ok: false, error: "auth" };
        return { ok: false, error: "upstream" };
      }
      // A 2xx reply that is not JSON is no answer (an empty success would be cached for 6 h).
      if (!body) return { ok: false, error: "upstream" };
      const cards = (body.items ?? []).flatMap((it) => {
        const id = it.id?.videoId;
        const s = it.snippet;
        if (!id || !s?.title) return [];
        const thumb =
          s.thumbnails?.medium?.url ??
          s.thumbnails?.high?.url ??
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        // The same ISO form as the Tavily cards (normalize.ts), so dates sort as text.
        const t = Date.parse(s.publishedAt ?? "");
        return [
          {
            platform: "yt" as const,
            handle: clip(s.channelTitle ?? "", 80),
            title: clip(s.title, TITLE_MAX),
            snippet: clip(s.description ?? "", SNIPPET_MAX),
            url: `https://www.youtube.com/watch?v=${id}`,
            thumb,
            ...(typeof s.publishedAt === "string" && !Number.isNaN(t)
              ? { published: new Date(t).toISOString() }
              : {}),
            ...(s.channelId ? { profile: `https://www.youtube.com/channel/${s.channelId}` } : {}),
          },
        ];
      });
      return { ok: true, cards };
    });
    return out ?? { ok: false, error: "upstream" };
  } catch {
    return { ok: false, error: "upstream" };
  }
}

/* ---------- the day's YouTube calls ---------- */

/** `DISCOVER_YT_CAP` if it is a number ≥ 0 ("0" turns YouTube off); unset, blank or other: 70. */
export function youtubeCap(env: FetchEnv): number {
  const raw = env.DISCOVER_YT_CAP?.trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_YT_CAP;
}

export async function youtubeUsedToday(env: FetchEnv, now: Date): Promise<number> {
  if (!env.SOCIAL_KV) return 0;
  const n = Number((await env.SOCIAL_KV.get(discoverKeys.yt(utcDay(now)), "text")) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Reserves up to `wanted` calls of today's cap; returns how many were granted (all of them without KV). A counter
 * write that fails (KV takes one write per key a second, so two overlapping searches can collide) still grants what
 * was left, never more; a counter that cannot be read throws (the caller decides).
 */
export async function reserveYoutube(env: FetchEnv, wanted: number, now: Date): Promise<number> {
  if (!env.SOCIAL_KV) return wanted;
  const used = await youtubeUsedToday(env, now);
  const granted = Math.max(0, Math.min(wanted, youtubeCap(env) - used));
  if (granted > 0) {
    await env.SOCIAL_KV.put(discoverKeys.yt(utcDay(now)), String(used + granted), {
      expirationTtl: COUNTER_TTL_S,
    }).catch(() => undefined);
  }
  return granted;
}
