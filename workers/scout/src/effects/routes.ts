/**
 * HTTP surface of Trending effects (planning/tools/18-trending-effects.md §3):
 *
 *   GET  /effects/trending            → { status, ranOn, updatedAt, notes?, items }: the stored document without the
 *                                       job's memory (history, meta); { status: "never", items: [] } before the
 *                                       first run
 *   POST /effects/run  { force? }     → runs the daily job now (it waits for the run, about 30–60 s) and answers
 *                                       like the GET. Once per UTC day: a second run that day answers the stored
 *                                       document unless `force: true`, or unless that day's run failed (then it
 *                                       runs again). The body is `{ force?: boolean }` or empty; anything else is
 *                                       a 400.
 *
 * A KV read failure on GET answers 502 { error: "upstream" } with the CORS headers; the run never throws (it notes
 * "kv" instead). The router in `scout.ts` has already checked CORS and the bearer token.
 */

import { readEffects } from "./kv";
import { runEffects } from "./run";
import type { EffectsEnv } from "./sources";
import type { EffectsDoc } from "./types";

export interface EffectsDeps {
  fetch?: typeof fetch;
  /** Test seam for "now". */
  now?: () => Date;
  /** `ctx.waitUntil`: keeps a run going for up to 30 s after its request is dropped. */
  waitUntil?: (task: Promise<unknown>) => void;
}

function json(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

/** The document without the job's memory (JSON leaves `notes` out when there are none). */
const answer = ({ status, ranOn, updatedAt, notes, items }: EffectsDoc) => ({
  status,
  ranOn,
  updatedAt,
  notes,
  items,
});

/** `force` of the run body (false when the body is empty); null when the body is not `{ force?: boolean }`. */
async function parseForce(req: Request): Promise<boolean | null> {
  const text = await req.text();
  if (!text.trim()) return false;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { force, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length || (force !== undefined && typeof force !== "boolean")) return null;
  return force === true;
}

/** Answers an `/effects/*` request, or returns null when the path is not one of ours. */
export async function handleEffects(
  req: Request,
  env: EffectsEnv,
  cors: Headers,
  deps: EffectsDeps = {},
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (pathname === "/effects/trending" && req.method === "GET") {
    // undefined: KV could not be read; null: no document yet.
    const doc = await readEffects(env).catch(() => undefined);
    if (doc === undefined) return json({ error: "upstream" }, 502, cors);
    return json(doc ? answer(doc) : { status: "never", items: [] }, 200, cors);
  }
  if (pathname === "/effects/run" && req.method === "POST") {
    const force = await parseForce(req);
    if (force === null) return json({ error: "bad_request" }, 400, cors);
    // The run never throws. Handed to waitUntil too: a dropped request (the page closed mid-run) leaves it up to 30 s
    // more to finish and save.
    const run = runEffects(env, { fetch: deps.fetch, now: deps.now?.(), force });
    deps.waitUntil?.(run);
    return json(answer(await run), 200, cors);
  }
  return null;
}
