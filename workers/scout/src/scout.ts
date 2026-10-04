/**
 * 3z Scout Worker v0 (build plan 1.14, master plan round 24).
 *
 *   GET  /health          → { ok: true } ; with a valid token also { tavily: boolean, auth: true }
 *   POST /search          → Tavily search limited to tiktok.com / instagram.com / youtube.com, normalized cards
 *                           (optional `timeRange`; TikTok thumbnails enriched via oEmbed unless `thumbs: false`;
 *                           `stats` on a card when its counts are known: TikTok / Instagram from the page
 *                           text, YouTube from one `videos.list` when YOUTUBE_API_KEY is set)
 *   GET  /oembed?url=     → TikTok / YouTube oEmbed passthrough { title, author, thumb, url }, cached 1 day
 *                           (TikTok 6 h; Instagram public Open Graph preview 1 h, unavailable 5 min)
 *   POST /discover        → Discover v2: one sectioned search (discover/, planning/tools/13-discover-search-v2.md)
 *   GET  /discover/usage  → Tavily's usage and today's YouTube / connector counters
 *   GET  /discover/picks  → Claude's picks for Discover, all or `?topic=` (saved by the connector's save_picks)
 *   GET  /trends          → the Trend Radar feed (trends/routes.ts, round 30, planning/tools/08-trends.md)
 *   POST /trends/run      → refresh the feed now
 *   GET  /go/:id/:n       → 302 to an auto-reply button's link, counting the tap (social/replies.ts)
 *   /mcp, /authorize, /token, /register → served by index.ts (OAuth + MCP): the Claude connector
 *                           (discover/mcp.ts, discover/auth.ts)
 *
 * Every route but OPTIONS, GET /health, the OAuth callbacks and /go needs `Authorization: Bearer
 * <SCOUT_TOKEN>`. CORS reflects the request Origin only when it is in ALLOWED_ORIGINS.
 *
 * Request handling lives here rather than in `index.ts` because a Worker's main module may export only
 * handlers (workerd treats every named export as an entrypoint), and the tests need `handle` and helpers.
 */

import { handleDiscover } from "./discover/routes";
import {
  normalizeHits,
  PLATFORM_DOMAIN,
  PLATFORMS,
  tiktokTitleFromOembed,
  type Platform,
  type ScoutResult,
  type TavilyHit,
} from "./normalize";
import { allowedOrigins, DEFAULT_ALLOWED_ORIGINS } from "./origins";
import { handleGo } from "./social/replies";
import { handleOAuthCallback, handleSocial, healthSocial } from "./social/routes";
import type { SocialEnv } from "./social/store";
import { handleTrends, healthTrends } from "./trends/routes";
import { TAVILY_URL } from "./trends/tavily";
import type { TrendsEnv } from "./trends/types";
import { enrichYoutubeStats } from "./youtubeStats";

export { DEFAULT_ALLOWED_ORIGINS, TAVILY_URL };
export { enrichYoutubeStats, YT_STATS_MAX, youtubeStatsUrl } from "./youtubeStats";

export interface Env extends SocialEnv, TrendsEnv {
  AI?: import("./discover/ai").SearchAiBinding;
  /** Secret: Tavily API key (https://app.tavily.com). */
  TAVILY_API_KEY?: string;
  /** Secret: the shared owner token the dashboard sends as a Bearer token. */
  SCOUT_TOKEN?: string;
  /** Var: comma-separated list of origins allowed to call the Worker from a browser. */
  ALLOWED_ORIGINS?: string;
  /** Var: YouTube `search.list` calls Discover and the connector may spend a UTC day (default 70). */
  DISCOVER_YT_CAP?: string;
  /** Var: Tavily lookups the Claude connector may spend a Riyadh day (default 60). */
  MCP_DAILY_LOOKUPS?: string;
  /** Var: "off" makes /health say `discover: false`, so dashboards go back to /search (default on). */
  DISCOVER_V2?: string;
}

/** Test seams: the global `fetch` and `caches.default` are used when these are omitted. */
export interface Deps {
  fetch?: typeof fetch;
  cache?: Cache | null;
  /**
   * Timeout of each call that enriches search results (ms): every oEmbed lookup and the YouTube
   * statistics call. Tests shorten it.
   */
  oembedTimeoutMs?: number;
  /** "Now" for the social routes (day keys, token expiry). */
  now?: () => Date;
}

const MAX_RESULTS_CAP = 20;
const OEMBED_TTL_S = 86_400;
/**
 * TikTok oEmbed replies are cached for 6 h only: their thumbnail URLs are signed and die after about 48 h,
 * and the dashboard caches search results on top of this edge cache.
 */
export const TIKTOK_OEMBED_TTL_S = 21_600;
/** At most this many TikTok results get an oEmbed thumbnail per search (fetched in parallel). */
export const THUMB_ENRICH_MAX = 10;
/**
 * Each enrichment call (an oEmbed lookup, the YouTube statistics call) gives up after this long; the
 * cards then stay as they were.
 */
export const THUMB_TIMEOUT_MS = 2500;
const TIME_RANGES = ["week", "month", "year"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

type ScoutError =
  "unauthorized" | "origin" | "bad_request" | "not_found" | "quota" | "auth" | "upstream";

/* ---------- helpers ---------- */

function corsHeaders(origin: string | null, env: Env): Headers {
  const h = new Headers({ Vary: "Origin" });
  if (origin && allowedOrigins(env).includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

function json(body: unknown, status: number, cors: Headers, extra?: HeadersInit): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (extra) new Headers(extra).forEach((v, k) => headers.set(k, v));
  return new Response(JSON.stringify(body), { status, headers });
}

const fail = (error: ScoutError, status: number, cors: Headers) => json({ error }, status, cors);

/** Constant-time string compare (length leak only), so the token can't be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** "valid" | "invalid" (a token was sent but is wrong, or the Worker has none) | "missing". */
function checkToken(req: Request, env: Env): "valid" | "invalid" | "missing" {
  const header = req.headers.get("Authorization");
  if (!header) return "missing";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!env.SCOUT_TOKEN || !token) return "invalid";
  return safeEqual(token, env.SCOUT_TOKEN) ? "valid" : "invalid";
}

/* ---------- /search ---------- */

interface SearchBody {
  q: string;
  platforms: Platform[];
  lang?: "ar" | "en";
  max?: number;
  /** Tavily `time_range`: only pages published in the last week / month / year. */
  timeRange?: TimeRange;
  /** Enrich results with thumbnails (TikTok via oEmbed). Default true. */
  thumbs: boolean;
}

function parseSearchBody(raw: unknown): SearchBody | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const q = typeof b.q === "string" ? b.q.trim() : "";
  if (!q || q.length > 200) return null;
  if (!Array.isArray(b.platforms) || b.platforms.length === 0) return null;
  const platforms = [...new Set(b.platforms)].filter((p): p is Platform =>
    PLATFORMS.includes(p as Platform),
  );
  if (platforms.length !== new Set(b.platforms).size) return null;
  if (b.lang !== undefined && b.lang !== "ar" && b.lang !== "en") return null;
  if (b.max !== undefined && (typeof b.max !== "number" || !Number.isFinite(b.max) || b.max < 1)) {
    return null;
  }
  if (b.timeRange !== undefined && !TIME_RANGES.includes(b.timeRange as TimeRange)) return null;
  if (b.thumbs !== undefined && typeof b.thumbs !== "boolean") return null;
  return {
    q,
    platforms,
    lang: b.lang as SearchBody["lang"],
    max: b.max as number | undefined,
    timeRange: b.timeRange as TimeRange | undefined,
    thumbs: b.thumbs !== false,
  };
}

interface TavilyResponse {
  results?: TavilyHit[];
  usage?: { credits?: number };
}

async function handleSearch(
  req: Request,
  env: Env,
  cors: Headers,
  doFetch: typeof fetch,
  cache: Cache | null,
  ctx: ExecutionContext | undefined,
  timeoutMs: number,
) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("bad_request", 400, cors);
  }
  const body = parseSearchBody(raw);
  if (!body) return fail("bad_request", 400, cors);
  if (!env.TAVILY_API_KEY) return fail("auth", 503, cors);

  let res: Response;
  try {
    res = await doFetch(TAVILY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query: body.q,
        include_domains: body.platforms.map((p) => PLATFORM_DOMAIN[p]),
        max_results: Math.min(Math.floor(body.max ?? 10), MAX_RESULTS_CAP),
        search_depth: "basic",
        include_images: true,
        ...(body.timeRange ? { time_range: body.timeRange } : {}),
        // Tavily's `language` steers the results' language (round 30: Arabic searches were English-only).
        ...(body.lang ? { language: body.lang } : {}),
      }),
    });
  } catch {
    return fail("upstream", 502, cors);
  }

  // Tavily: 401 bad key · 429 rate limit · 432 plan limit · 433 pay-as-you-go limit.
  if (res.status === 401 || res.status === 403) return fail("auth", 502, cors);
  if (res.status === 429 || res.status === 432 || res.status === 433) {
    return fail("quota", 429, cors);
  }
  if (!res.ok) return fail("upstream", 502, cors);

  let data: TavilyResponse;
  try {
    data = (await res.json()) as TavilyResponse;
  } catch {
    return fail("upstream", 502, cors);
  }
  const results = normalizeHits(data.results ?? [], body.platforms);
  if (body.thumbs) await enrichThumbs(results, doFetch, cache, ctx, timeoutMs);
  // Not a thumbnail: the counts are asked for with `thumbs: false` too (one call, YouTube cards only).
  await enrichYoutubeStats(results, env, doFetch, timeoutMs);
  // A basic search costs 1 credit; Tavily reports the exact figure in `usage` when it sends one.
  return json({ results, credits: { used: data.usage?.credits ?? 1 } }, 200, cors);
}

/* ---------- /oembed ---------- */

/** The oEmbed endpoint for an allowed video URL (TikTok or YouTube only), else null. */
export function oembedEndpoint(videoUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(videoUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  const enc = encodeURIComponent(u.toString());
  if (is("tiktok.com")) return `https://www.tiktok.com/oembed?url=${enc}`;
  if (is("youtube.com") || host === "youtu.be") {
    return `https://www.youtube.com/oembed?url=${enc}&format=json`;
  }
  return null;
}

interface RawOembed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

/** A normalized oEmbed reply, as `/oembed` returns it and the cache stores it. */
interface OembedBody {
  title: string;
  author: string;
  thumb: string;
  url: string;
}

type OembedLookup =
  | { ok: true; body: string; data: OembedBody }
  | { ok: false; error: "bad_request" | "not_found" | "upstream" };

/**
 * The shared, cached oEmbed path (used by `GET /oembed` and by search thumbnail enrichment). Cached on the
 * upstream URL (a GET key no client can forge), without any per-origin CORS headers: YouTube for a day,
 * TikTok for {@link TIKTOK_OEMBED_TTL_S} (signed thumbnails).
 */
async function lookupOembed(
  videoUrl: string,
  doFetch: typeof fetch,
  cache: Cache | null,
  ctx?: ExecutionContext,
  signal?: AbortSignal,
): Promise<OembedLookup> {
  // Load the HTML parser only for Instagram card previews, never for searches or other platforms.
  const host = (() => {
    try {
      return new URL(videoUrl).hostname;
    } catch {
      return "";
    }
  })();
  if (["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host)) {
    const { instagramPostUrl, lookupInstagramPreview } = await import("./instagramPreview");
    const post = instagramPostUrl(videoUrl);
    return post
      ? lookupInstagramPreview(post, doFetch, cache, ctx)
      : { ok: false, error: "bad_request" };
  }
  const endpoint = oembedEndpoint(videoUrl);
  if (!endpoint) return { ok: false, error: "bad_request" };

  const cacheKey = new Request(endpoint, { method: "GET" });
  const hit = cache ? await cache.match(cacheKey) : undefined;
  if (hit) {
    const body = await hit.text();
    try {
      return { ok: true, body, data: JSON.parse(body) as OembedBody };
    } catch {
      // A corrupt entry: fall through and refetch.
    }
  }

  let res: Response;
  try {
    res = await doFetch(endpoint, { headers: { Accept: "application/json" }, signal });
  } catch {
    return { ok: false, error: "upstream" };
  }
  if (res.status === 400 || res.status === 404) return { ok: false, error: "not_found" };
  if (!res.ok) return { ok: false, error: "upstream" };
  let raw: RawOembed;
  try {
    raw = (await res.json()) as RawOembed;
  } catch {
    return { ok: false, error: "upstream" };
  }
  // TikTok's author_url is https://www.tiktok.com/@handle: prefer the "@handle" over the display name.
  const atHandle = raw.author_url?.match(/tiktok\.com\/(@[\w.-]+)/)?.[1];
  const data: OembedBody = {
    title: raw.title ?? "",
    author: atHandle ?? raw.author_name ?? "",
    thumb: raw.thumbnail_url ?? "",
    url: videoUrl,
  };
  const body = JSON.stringify(data);
  if (cache) {
    const ttl = endpoint.startsWith("https://www.tiktok.com/") ? TIKTOK_OEMBED_TTL_S : OEMBED_TTL_S;
    const toCache = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${ttl}`,
      },
    });
    const put = cache.put(cacheKey, toCache).catch(() => {});
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return { ok: true, body, data };
}

async function handleOembed(
  req: Request,
  cors: Headers,
  doFetch: typeof fetch,
  cache: Cache | null,
  ctx?: ExecutionContext,
) {
  const videoUrl = new URL(req.url).searchParams.get("url") ?? "";
  const r = await lookupOembed(videoUrl, doFetch, cache, ctx);
  if (!r.ok) {
    const status = r.error === "bad_request" ? 400 : r.error === "not_found" ? 404 : 502;
    return fail(r.error, status, cors);
  }
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(r.body, { status: 200, headers });
}

/* ---------- thumbnail enrichment ---------- */

/**
 * One oEmbed lookup that never takes longer than `ms` (aborted, then treated as a miss): the https
 * thumbnail and the title (the video's caption), each undefined when missing.
 */
async function oembedThumb(
  videoUrl: string,
  doFetch: typeof fetch,
  cache: Cache | null,
  ctx: ExecutionContext | undefined,
  ms: number,
): Promise<{ thumb?: string; title?: string }> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(undefined);
    }, ms);
  });
  try {
    const r = await Promise.race([
      lookupOembed(videoUrl, doFetch, cache, ctx, ac.signal).catch(() => undefined),
      timeout,
    ]);
    if (!r || !r.ok) return {};
    const { thumb, title } = r.data;
    return {
      thumb: typeof thumb === "string" && /^https:\/\//.test(thumb) ? thumb : undefined,
      title: typeof title === "string" && title ? title : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Give TikTok results a thumbnail from TikTok's public oEmbed (the first {@link THUMB_ENRICH_MAX}, in
 * parallel, each capped at `timeoutMs`; failures are ignored). The same reply's title (the caption)
 * replaces a card title that is generic ("TikTok - Make Your Day") or just the handle. YouTube results already carry the
 * `i.ytimg.com` thumbnail from `normalizeHits`. Instagram's oEmbed returns no thumbnail (Meta removed it on
 * 2025-11-03); cards request public Instagram previews separately through /oembed. Mutates
 * `results` in place.
 */
export async function enrichThumbs(
  results: ScoutResult[],
  doFetch: typeof fetch,
  cache: Cache | null,
  ctx: ExecutionContext | undefined,
  timeoutMs = THUMB_TIMEOUT_MS,
): Promise<void> {
  const targets = results.filter((r) => r.platform === "tt").slice(0, THUMB_ENRICH_MAX);
  await Promise.all(
    targets.map(async (r) => {
      const { thumb, title } = await oembedThumb(r.url, doFetch, cache, ctx, timeoutMs);
      if (thumb) r.thumb = thumb;
      const better = tiktokTitleFromOembed(r, title);
      if (better) r.title = better;
    }),
  );
}

/* ---------- router ---------- */

function defaultCache(): Cache | null {
  const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default ?? null;
}

export async function handle(
  req: Request,
  env: Env,
  ctx?: ExecutionContext,
  deps: Deps = {},
): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin, env);
  const originAllowed = !origin || cors.has("Access-Control-Allow-Origin");
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: originAllowed ? 204 : 403, headers: cors });
  }
  // Browsers from other sites never get a usable answer; refuse early instead of spending credits.
  if (!originAllowed) return fail("origin", 403, cors);

  // The OAuth providers send the owner's browser here (top-level navigation, no bearer): the one-time
  // `state` nonce is the credential.
  const callback = pathname.match(/^\/oauth\/([a-z]+)\/callback$/);
  if (callback && req.method === "GET") {
    return handleOAuthCallback(req, env, callback[1], { fetch: deps.fetch, now: deps.now });
  }

  // Links in the auto-reply DMs: the reader's browser follows them (no bearer); they only redirect.
  const go = pathname.match(/^\/go\/([A-Za-z0-9_-]{1,100})\/(\d)$/);
  if (go && req.method === "GET") {
    const cache = deps.cache === undefined ? defaultCache() : deps.cache;
    return handleGo(req, env, go[1], Number(go[2]), deps.now?.(), cache);
  }

  const token = checkToken(req, env);

  if (pathname === "/health" && req.method === "GET") {
    if (token === "invalid") return fail("unauthorized", 401, cors);
    if (token === "valid") {
      return json(
        {
          ok: true,
          auth: true,
          tavily: !!env.TAVILY_API_KEY,
          social: healthSocial(env),
          trends: healthTrends(env),
          // The kill switch: /discover stays served (the connector runs the same pipeline).
          discover: env.DISCOVER_V2 !== "off",
          // Clients check this before spending subscription inference on a local plan.
          discoverSubscriptions: env.DISCOVER_V2 !== "off",
        },
        200,
        cors,
      );
    }
    return json({ ok: true }, 200, cors);
  }

  if (token !== "valid") return fail("unauthorized", 401, cors);

  const doFetch = deps.fetch ?? fetch;
  const cache = deps.cache === undefined ? defaultCache() : deps.cache;
  if (pathname === "/search" && req.method === "POST") {
    const timeoutMs = deps.oembedTimeoutMs ?? THUMB_TIMEOUT_MS;
    return handleSearch(req, env, cors, doFetch, cache, ctx, timeoutMs);
  }
  if (pathname === "/oembed" && req.method === "GET") {
    return handleOembed(req, cors, doFetch, cache, ctx);
  }
  const discover = await handleDiscover(req, env, cors, { fetch: deps.fetch, now: deps.now });
  if (discover) return discover;
  const social = await handleSocial(req, env, cors, { fetch: deps.fetch, now: deps.now });
  if (social) return social;
  const trends = await handleTrends(req, env, cors, { fetch: deps.fetch, now: deps.now });
  if (trends) return trends;
  return fail("not_found", 404, cors);
}
