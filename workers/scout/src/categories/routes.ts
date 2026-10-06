/**
 * HTTP surface of the category pages (planning/tools/19-category-trends.md §2):
 *
 *   GET  /categories/:id        → { status, updatedAt, notes?, items, lessons? }: the stored page without the job's
 *                                 memory (history, meta) or diagnostics; { status: "never", items: [] } before the
 *                                 first scan; 502 { error: "upstream" } when KV can't be read
 *   POST /categories/:id/run    → scans that category now (about 30–90 s with lessons; handed to waitUntil too) and
 *                                 answers like the GET. Once per UTC day unless `force: true` or that day's run failed;
 *                                 at most 3 spending runs a category a UTC day, forced ones included (note `attempts`).
 *                                 Body `{ force?: boolean }` or empty; anything else is a 400.
 *
 * Only the built-in categories of genres.json have a page: any other id, or any other method, is the router's 404.
 * The router in `scout.ts` has already checked CORS and the bearer token.
 */

import { json, parseForce, type EffectsDeps } from "../effects/routes";
import type { EffectsEnv } from "../effects/sources";
import { categoryById } from "./defs";
import { readCategory, runCategory } from "./run";
import type { CategoryDoc } from "./types";

const ROUTE = /^\/categories\/([a-z][a-z0-9-]*)(\/run)?$/;

/** JSON leaves `notes` and `lessons` out when there are none. */
const answer = ({ status, updatedAt, notes, items, lessons }: CategoryDoc) => ({
  status,
  updatedAt,
  notes,
  items,
  lessons,
});

export async function handleCategories(
  req: Request,
  env: EffectsEnv,
  cors: Headers,
  deps: EffectsDeps = {},
): Promise<Response | null> {
  const m = new URL(req.url).pathname.match(ROUTE);
  if (!m || !categoryById(m[1])) return null;
  const [, id, run] = m;
  if (!run && req.method === "GET") {
    // undefined: KV could not be read; null: never scanned. A malformed `lessons` is left out.
    const doc = await readCategory(env, id).catch(() => undefined);
    if (doc === undefined) return json({ error: "upstream" }, 502, cors);
    return json(doc ? answer(doc) : { status: "never", items: [] }, 200, cors);
  }
  if (run && req.method === "POST") {
    const force = await parseForce(req);
    if (force === null) return json({ error: "bad_request" }, 400, cors);
    // The run never throws. Handed to waitUntil too: a dropped request leaves it up to 30 s more to finish and save.
    const task = runCategory(env, id, { fetch: deps.fetch, now: deps.now?.(), force });
    deps.waitUntil?.(task);
    return json(answer(await task), 200, cors);
  }
  return null;
}
