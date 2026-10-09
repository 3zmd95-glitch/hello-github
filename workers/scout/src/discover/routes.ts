/**
 * Discover v2 routes (planning/tools/13-discover-search-v2.md), behind the owner token like `/search`:
 *   POST /discover        → the sectioned answer (run.ts)
 *   GET  /discover/usage  → Tavily's usage and today's counters (usage.ts)
 *   GET  /discover/picks  → Claude's picks, all or `?topic=` (picks.ts)
 * Returns null for any other path, so the router goes on (and answers 404 at the end).
 */

import { PLATFORMS, type Platform } from "../normalize";
import { SearchAiError } from "./ai";
import { ExternalAiPlanSchema } from "./ai-plan";
import { readPicks } from "./picks";
import { runDiscover } from "./run";
import { normalizeTerm } from "./terms";
import type { DiscoverRequest, DiscoverTimeRange } from "./types";
import { discoverUsage, type UsageEnv } from "./usage";

const TIME_RANGES: readonly DiscoverTimeRange[] = ["week", "month", "year"];
const TERM_ID = /^[a-z][a-z0-9-]{0,59}$/;

function reply(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

/** undefined: absent; null: present but not a usable text of at most `max` characters once trimmed. */
function optText(x: unknown, max: number): string | undefined | null {
  if (x === undefined) return undefined;
  const text = typeof x === "string" ? x.trim() : "";
  return text && text.length <= max ? text : null;
}

export function parseDiscoverBody(raw: unknown): DiscoverRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const q = typeof b.q === "string" ? b.q.trim() : "";
  // Symbols or emoji only ("🔥🔥", "!!!"): no word left to plan or match.
  if (b.mode !== undefined && b.mode !== "ai") return null;
  if (!q || q.length > (b.mode === "ai" ? 600 : 200) || !normalizeTerm(q)) return null;
  // A trend chip's search (`editing`) is a keyword search, as exact and "Not this?" are.
  if (b.mode === "ai" && (b.exact || b.term || b.editing)) return null;
  let aiPlan: DiscoverRequest["aiPlan"];
  if (b.aiPlan !== undefined) {
    if (b.mode !== "ai") return null;
    const parsed = ExternalAiPlanSchema.safeParse(b.aiPlan);
    if (!parsed.success) return null;
    aiPlan = parsed.data;
  }
  if (b.exact !== undefined && typeof b.exact !== "boolean") return null;
  if (b.term !== undefined && (typeof b.term !== "string" || !TERM_ID.test(b.term))) return null;
  const program = optText(b.program, 60);
  if (program === null) return null;
  if (b.timeRange !== undefined && !TIME_RANGES.includes(b.timeRange as DiscoverTimeRange))
    return null;
  if (b.ytLength !== undefined && b.ytLength !== "short" && b.ytLength !== "long") return null;
  if (b.lang !== undefined && b.lang !== "ar" && b.lang !== "en") return null;
  if (b.editing !== undefined && typeof b.editing !== "boolean") return null;
  let genreQuery: DiscoverRequest["genreQuery"];
  if (b.genreQuery !== undefined) {
    if (!b.genreQuery || typeof b.genreQuery !== "object") return null;
    const g = b.genreQuery as Record<string, unknown>;
    const ar = optText(g.ar, 100);
    const en = optText(g.en, 100);
    if (ar === null || en === null) return null;
    // `{}` (no words in either language) is no genre.
    if (ar || en) genreQuery = { ...(ar ? { ar } : {}), ...(en ? { en } : {}) };
  }
  let platforms: Platform[] | undefined;
  if (b.platforms !== undefined) {
    if (!Array.isArray(b.platforms) || b.platforms.length === 0) return null;
    if (!b.platforms.every((p) => PLATFORMS.includes(p as Platform))) return null;
    platforms = [...new Set(b.platforms as Platform[])];
  }
  return {
    q,
    ...(b.mode === "ai" ? { mode: "ai" as const } : {}),
    ...(aiPlan ? { aiPlan } : {}),
    ...(b.exact === true ? { exact: true } : {}),
    ...(typeof b.term === "string" ? { term: b.term } : {}),
    ...(genreQuery ? { genreQuery } : {}),
    ...(program ? { program } : {}),
    ...(b.lang ? { lang: b.lang as "ar" | "en" } : {}),
    ...(b.editing === true ? { editing: true as const } : {}),
    ...(b.timeRange ? { timeRange: b.timeRange as DiscoverTimeRange } : {}),
    ...(b.ytLength ? { ytLength: b.ytLength as "short" | "long" } : {}),
    ...(platforms ? { platforms } : {}),
  };
}

export async function handleDiscover(
  req: Request,
  env: UsageEnv,
  cors: Headers,
  deps: { fetch?: typeof fetch; now?: () => Date },
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (pathname !== "/discover" && !pathname.startsWith("/discover/")) return null;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now?.() ?? new Date();
  if (pathname === "/discover" && req.method === "POST") {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return reply({ error: "bad_request" }, 400, cors);
    }
    const body = parseDiscoverBody(raw);
    if (!body) return reply({ error: "bad_request" }, 400, cors);
    try {
      return reply(await runDiscover(env, body, { fetch: doFetch, now }), 200, cors);
    } catch (error) {
      if (error instanceof SearchAiError)
        return reply({ error: error.code }, error.code === "ai_limit" ? 429 : 503, cors);
      return reply({ error: "upstream" }, 502, cors);
    }
  }
  if (pathname === "/discover/usage" && req.method === "GET") {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    const response = reply(
      await discoverUsage(env, doFetch, now, undefined, { refresh }),
      200,
      cors,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (pathname === "/discover/picks" && req.method === "GET") {
    const topic = new URL(req.url).searchParams.get("topic") || undefined;
    return reply({ picks: await readPicks(env, topic) }, 200, cors);
  }
  return null;
}
