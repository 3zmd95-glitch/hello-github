/**
 * 3z Scout Worker v0 (build plan 1.14, master plan round 24).
 *
 *   GET  /health          → { ok: true } ; with a valid token also { tavily: boolean, auth: true }
 *   POST /search          → Tavily search limited to tiktok.com / instagram.com / youtube.com, normalized cards
 *   GET  /oembed?url=     → TikTok / YouTube oEmbed passthrough { title, author, thumb, url }, cached 1 day
 *
 * Every route but OPTIONS and GET /health needs `Authorization: Bearer <SCOUT_TOKEN>`. CORS reflects the
 * request Origin only when it is in ALLOWED_ORIGINS.
 *
 * Request handling lives here rather than in `index.ts` because a Worker's main module may export only
 * handlers (workerd treats every named export as an entrypoint), and the tests need `handle` and helpers.
 */

import {
  normalizeHits,
  PLATFORM_DOMAIN,
  PLATFORMS,
  type Platform,
  type TavilyHit,
} from "./normalize";

export interface Env {
  /** Secret: Tavily API key (https://app.tavily.com). */
  TAVILY_API_KEY?: string;
  /** Secret: the shared owner token the dashboard sends as a Bearer token. */
  SCOUT_TOKEN?: string;
  /** Var: comma-separated list of origins allowed to call the Worker from a browser. */
  ALLOWED_ORIGINS?: string;
}

/** Test seams: the global `fetch` and `caches.default` are used when these are omitted. */
export interface Deps {
  fetch?: typeof fetch;
  cache?: Cache | null;
}

export const DEFAULT_ALLOWED_ORIGINS = "http://localhost:3000,https://3zmd95-glitch.github.io";
export const TAVILY_URL = "https://api.tavily.com/search";
const MAX_RESULTS_CAP = 20;
const OEMBED_TTL_S = 86_400;

type ScoutError =
  "unauthorized" | "origin" | "bad_request" | "not_found" | "quota" | "auth" | "upstream";

/* ---------- helpers ---------- */

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function corsHeaders(origin: string | null, env: Env): Headers {
  const h = new Headers({ Vary: "Origin" });
  if (origin && allowedOrigins(env).includes(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
  return { q, platforms, lang: b.lang as SearchBody["lang"], max: b.max as number | undefined };
}

interface TavilyResponse {
  results?: TavilyHit[];
  usage?: { credits?: number };
}

async function handleSearch(req: Request, env: Env, cors: Headers, doFetch: typeof fetch) {
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

async function handleOembed(
  req: Request,
  cors: Headers,
  doFetch: typeof fetch,
  cache: Cache | null,
  ctx?: ExecutionContext,
) {
  const videoUrl = new URL(req.url).searchParams.get("url") ?? "";
  const endpoint = oembedEndpoint(videoUrl);
  if (!endpoint) return fail("bad_request", 400, cors);

  // Cache on the upstream URL (a GET key no client can forge), without the per-origin CORS headers.
  const cacheKey = new Request(endpoint, { method: "GET" });
  const hit = cache ? await cache.match(cacheKey) : undefined;
  if (hit) {
    const body = await hit.text();
    return new Response(body, { status: 200, headers: mergeHeaders(hit.headers, cors) });
  }

  let res: Response;
  try {
    res = await doFetch(endpoint, { headers: { Accept: "application/json" } });
  } catch {
    return fail("upstream", 502, cors);
  }
  if (res.status === 400 || res.status === 404) return fail("not_found", 404, cors);
  if (!res.ok) return fail("upstream", 502, cors);
  let raw: RawOembed;
  try {
    raw = (await res.json()) as RawOembed;
  } catch {
    return fail("upstream", 502, cors);
  }
  // TikTok's author_url is https://www.tiktok.com/@handle: prefer the "@handle" over the display name.
  const atHandle = raw.author_url?.match(/tiktok\.com\/(@[\w.-]+)/)?.[1];
  const body = JSON.stringify({
    title: raw.title ?? "",
    author: atHandle ?? raw.author_name ?? "",
    thumb: raw.thumbnail_url ?? "",
    url: videoUrl,
  });
  if (cache) {
    const toCache = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${OEMBED_TTL_S}`,
      },
    });
    const put = cache.put(cacheKey, toCache);
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(body, { status: 200, headers });
}

function mergeHeaders(base: Headers, cors: Headers): Headers {
  const h = new Headers();
  const ct = base.get("Content-Type");
  if (ct) h.set("Content-Type", ct);
  cors.forEach((v, k) => h.set(k, v));
  return h;
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

  const token = checkToken(req, env);

  if (pathname === "/health" && req.method === "GET") {
    if (token === "invalid") return fail("unauthorized", 401, cors);
    if (token === "valid")
      return json({ ok: true, auth: true, tavily: !!env.TAVILY_API_KEY }, 200, cors);
    return json({ ok: true }, 200, cors);
  }

  if (token !== "valid") return fail("unauthorized", 401, cors);

  const doFetch = deps.fetch ?? fetch;
  if (pathname === "/search" && req.method === "POST") return handleSearch(req, env, cors, doFetch);
  if (pathname === "/oembed" && req.method === "GET") {
    const cache = deps.cache === undefined ? defaultCache() : deps.cache;
    return handleOembed(req, cors, doFetch, cache, ctx);
  }
  return fail("not_found", 404, cors);
}
