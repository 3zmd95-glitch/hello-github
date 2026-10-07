/**
 * HTTP surface of the category pages (planning/tools/19-category-trends.md §2, §6):
 *
 *   GET  /categories/:id        → { status, updatedAt, notes?, items, lessons?, top? }: the stored page without the
 *                                 job's memory (history, meta) or diagnostics; { status: "never", items: [] } before
 *                                 the first scan; 502 { error: "upstream" } when KV can't be read
 *   POST /categories/:id/run    → scans that category now (about 30–90 s; up to about 5 minutes when the
 *                                 lessons refresh with llama retries; handed to waitUntil too) and
 *                                 answers like the GET. Once per UTC day unless `force: true` or that day's run failed;
 *                                 at most 3 spending runs a category a UTC day, forced ones included (note `attempts`).
 *                                 Body `{ force?: boolean }` or empty; anything else is a 400.
 *   GET  /categories/:id/top/tt → a TikTok (or `/ig` Instagram) tab's lists: the stored one and Brave's own group, as
 *                                 Brave gave it, { platform, scan, brave, source, note?, endpoint?, stats? } (top.ts
 *                                 `braveTop`), never kept (`Cache-Control: no-store`; Brave's terms forbid storing
 *                                 its results)
 *
 * Only the built-in categories of genres.json have a page: any other id, or any other method, is the router's 404.
 * The router in `scout.ts` has already checked CORS and the bearer token.
 */

import { json, parseForce, type EffectsDeps } from "../effects/routes";
import { categoryById } from "./defs";
import { readCategory, runCategory } from "./run";
import { braveTop, type BravePlatform, type TopEnv } from "./top";
import type { CategoryDoc } from "./types";

const ROUTE = /^\/categories\/([a-z][a-z0-9-]*)(?:(\/run)|\/top\/(tt|ig))?$/;

/** JSON leaves `notes`, `lessons` and `top` out when there are none. */
const answer = ({ status, updatedAt, notes, items, lessons, top }: CategoryDoc) => ({
  status,
  updatedAt,
  notes,
  items,
  lessons,
  top,
});

export async function handleCategories(
  req: Request,
  env: TopEnv,
  cors: Headers,
  deps: EffectsDeps = {},
): Promise<Response | null> {
  const m = new URL(req.url).pathname.match(ROUTE);
  const g = m ? categoryById(m[1]) : undefined;
  if (!m || !g) return null;
  const [, id, run, platform] = m;
  if (platform && req.method === "GET") {
    // undefined: KV could not be read, so Brave's list stands alone. Never throws.
    const doc = await readCategory(env, id).catch(() => undefined);
    const p = platform as BravePlatform;
    const top = await braveTop(
      env,
      deps.fetch ?? fetch,
      g,
      p,
      doc?.top?.[p] ?? [],
      deps.now?.() ?? new Date(),
    );
    const headers = new Headers(cors);
    headers.set("Cache-Control", "no-store");
    return json(top, 200, headers);
  }
  if (!platform && !run && req.method === "GET") {
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
