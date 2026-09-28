/**
 * HTTP surface of the Trend Radar (round 30, planning/tools/08-trends.md; contract in lib/domain.ts
 * `TrendsFeedSchema`):
 *
 *   GET  /trends                       → TrendsFeed (200 even when empty: { items: [], fetchedAt: null,
 *                                                    degraded: true, sources: [] })
 *   POST /trends/run   { kinds?, force? } → runs every enabled source of those kinds now (default: ["fast"],
 *                                        the dashboard's refresh button: the daily search and the weekly
 *                                        scan spend a capped quota and have their own cron slots) and
 *                                        answers the new feed; the weekly scan runs once per ISO week
 *                                        unless `force: true`
 *
 * A KV failure answers 502 { error: "upstream" } with the CORS headers. The router in `scout.ts` has
 * already checked CORS and the bearer token.
 */

import { latestFeed } from "./kv";
import { enabledSources, runTrends, type SourceKey } from "./run";
import { isTrendKind, type TrendKind, type TrendsEnv } from "./types";

export interface TrendsDeps {
  fetch?: typeof fetch;
  /** Test seam for "now". */
  now?: () => Date;
}

function json(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

/** `health.trends`: whether the YouTube key is set and which sources are enabled. */
export function healthTrends(env: TrendsEnv): { youtube: boolean; sources: SourceKey[] } {
  return { youtube: !!env.YOUTUBE_API_KEY, sources: enabledSources(env) };
}

/** What a manual run does when the body names no kinds: the fast sources only (no quota-capped source). */
export const DEFAULT_RUN_KINDS: readonly TrendKind[] = ["fast"];

export interface RunBody {
  kinds: TrendKind[];
  force: boolean;
}

/** `{ kinds, force }` of the run body (`["fast"]`, false when absent); null when the body is not that shape. */
export async function parseRunBody(req: Request): Promise<RunBody | null> {
  const text = await req.text();
  if (!text.trim()) return { kinds: [...DEFAULT_RUN_KINDS], force: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { kinds, force } = raw as { kinds?: unknown; force?: unknown };
  if (force !== undefined && typeof force !== "boolean") return null;
  if (kinds === undefined) return { kinds: [...DEFAULT_RUN_KINDS], force: force === true };
  if (!Array.isArray(kinds) || !kinds.length || !kinds.every(isTrendKind)) return null;
  return { kinds: [...new Set(kinds)], force: force === true };
}

/** Answers a `/trends*` request, or returns null when the path is not one of ours. */
export async function handleTrends(
  req: Request,
  env: TrendsEnv,
  cors: Headers,
  deps: TrendsDeps = {},
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (pathname === "/trends" && req.method === "GET") {
    try {
      return json(await latestFeed(env), 200, cors);
    } catch {
      return json({ error: "upstream" }, 502, cors);
    }
  }
  if (pathname === "/trends/run" && req.method === "POST") {
    const body = await parseRunBody(req);
    if (!body) return json({ error: "bad_request", detail: "body" }, 400, cors);
    try {
      const feed = await runTrends(env, {
        kinds: body.kinds,
        force: body.force,
        fetch: deps.fetch,
        now: deps.now?.(),
      });
      return json(feed, 200, cors);
    } catch {
      return json({ error: "upstream" }, 502, cors);
    }
  }
  return null;
}
