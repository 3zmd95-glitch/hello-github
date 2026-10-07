/**
 * A Discover category's scan (planning/tools/19-category-trends.md §2): its 2 queries × 3 searches (6 credits) →
 * Trending effects' candidates, AI cleanup and 7-day memory, with the camera words, the category's own generic words,
 * its context line and a 200-name memory → its top 12, trends first, with no YouTube check → one KV document
 * `category:<id>`. Once per UTC day unless forced or that day's run failed; at most 3 spending runs a category a UTC
 * day, forced ones included (`category:attempts:<id>:<day>`); paused at 90 % of the month's Tavily credits (§4).
 * When its lessons are 6 or more days old (or missing) the scan also refreshes them (lessons.ts), saved after the
 * trends. Never throws: a day that fails keeps the last page and its lessons.
 */

import { isRecord } from "../effects/ai";
import { readEffects, writeEffects } from "../effects/kv";
import { countAttempt, failed, noted, rememberPosts, type Memory } from "../effects/run";
import { scoreEffects } from "../effects/score";
import {
  monthTight,
  monthUsage,
  searchFamilies,
  type EffectsEnv,
  type FamilyStats,
} from "../effects/sources";
import type { Genre } from "../trends/genres";
import { utcDay } from "../trends/kv";
import {
  aiContext,
  attemptsKey,
  CATEGORY_KEYS,
  CATEGORY_SUFFIXES,
  categoryById,
  categoryGeneric,
  categoryKey,
  categoryQueries,
} from "./defs";
import { lessonsDue, refreshLessons } from "./lessons";
import { AREAS, type CategoryDoc } from "./types";

export type CategoryRunOptions = {
  fetch?: typeof fetch;
  now?: Date;
  force?: boolean;
  /** Each Tavily call (default 12 s). */
  timeoutMs?: number;
  /** Each AI call (default 60 s). */
  aiTimeoutMs?: number;
  /** The wait before the lessons' save (default a timer; tests pass their own). */
  sleep?: (ms: number) => Promise<void>;
};

/** KV takes one write a key a second and refuses a quicker one (429, social/store.ts): the lessons' save comes at least
 * this long after the trends'. */
const SAVE_GAP_MS = 1_100;
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A category's stored page: null before its first scan; throws when KV can't be read. KV's document is checked at its
 * top level only (readEffects), so its lessons are untrusted too: a malformed `lessons` is dropped, never handed on
 * (the next scan refreshes it). Each technique is the page's to check (lib/categories.ts drops a bad one alone).
 */
export async function readCategory(env: EffectsEnv, id: string): Promise<CategoryDoc | null> {
  const doc = await readEffects<CategoryDoc>(env, categoryKey(id));
  const l: unknown = doc?.lessons;
  if (!doc || l === undefined) return doc;
  return isRecord(l) && typeof l.updatedAt === "string" && AREAS.every((a) => Array.isArray(l[a]))
    ? doc
    : { ...doc, lessons: undefined };
}

async function scan(
  env: EffectsEnv,
  doFetch: typeof fetch,
  g: Genre,
  prev: CategoryDoc | null,
  now: Date,
  today: string,
  opts: CategoryRunOptions,
): Promise<{ doc: CategoryDoc; credits: number; families: FamilyStats[]; memory?: Memory }> {
  const queries = categoryQueries(g);
  // `tight: false`: a category never cuts back; it pauses before searching instead (runCategory).
  const { posts, credits, errors, families } = await searchFamilies(
    env,
    doFetch,
    queries,
    opts.timeoutMs,
    {
      numbering: queries,
      tight: false,
    },
  );
  const notes = new Set(errors);
  if (!posts.length && errors.length)
    return { doc: failed(prev, today, now, [...notes]), credits, families };
  const { history, meta, shown, memory } = await rememberPosts(env, prev, today, posts, notes, {
    aiTimeoutMs: opts.aiTimeoutMs,
    extract: { suffixes: CATEGORY_SUFFIXES, generic: categoryGeneric(g) },
    aiContext: aiContext(g),
    maxKeys: CATEGORY_KEYS,
  });
  return {
    credits,
    families,
    memory,
    doc: {
      ranOn: today,
      updatedAt: now.toISOString(),
      status: notes.size ? "partial" : "ok",
      ...(notes.size ? { notes: [...notes] } : {}),
      // No YouTube check (§4): the shared 100 `search.list` a day stay untouched.
      items: scoreEffects(history, shown, today, {}),
      ...(prev?.lessons ? { lessons: prev.lessons } : {}),
      meta,
      history,
    },
  };
}

/** Saves the document; a write that fails says so in the answer (`kv`), as Trending effects does. */
async function save(env: EffectsEnv, key: string, doc: CategoryDoc): Promise<CategoryDoc> {
  try {
    await writeEffects(env, doc, key);
    return doc;
  } catch {
    console.error(JSON.stringify({ category: { write: "failed" } }));
    return noted(doc, "kv");
  }
}

export async function runCategory(
  env: EffectsEnv,
  id: string,
  opts: CategoryRunOptions = {},
): Promise<CategoryDoc> {
  const now = opts.now ?? new Date();
  const today = utcDay(now);
  const g = categoryById(id);
  if (!g) return failed(null, today, now, ["unknown"]);
  const key = categoryKey(id);
  // undefined: KV could not be read, so nothing is spent or written over a memory this run never saw.
  const prev = await readCategory(env, id).catch(() => undefined);
  // Once a day, unless forced; a day whose run failed may run again (the page's retry), a good day may not.
  if (prev && !opts.force && prev.ranOn === today && prev.status !== "failed") return prev;
  let doc: CategoryDoc;
  let credits = 0;
  let families: FamilyStats[] | undefined;
  let memory: Memory | undefined;
  let error: string | undefined;
  // The day's cap. true: the page may be saved (the attempt counted, or none needed: a pause spends nothing); false:
  // over the cap, nothing spent or written; undefined: the counter could not be kept (saved, noted "attempts_kv").
  let attempt: boolean | undefined = true;
  if (prev === undefined) doc = failed(null, today, now, ["kv"]);
  // The month's credits nearly spent (Discover's figure, else Tavily's /usage): paused before any search, the last
  // page kept, no attempt counted.
  else if (monthTight(await monthUsage(env, opts.fetch ?? fetch, opts.timeoutMs)))
    doc = failed(prev, today, now, ["tavily_budget"]);
  else {
    // Every spending run counts, forced ones too (§2: at most 3 a category a UTC day).
    attempt = await countAttempt(env, attemptsKey(id, today));
    if (attempt === false)
      doc = prev ? noted(prev, "attempts") : failed(null, today, now, ["attempts"]);
    else {
      try {
        ({ doc, credits, families, memory } = await scan(
          env,
          opts.fetch ?? fetch,
          g,
          prev,
          now,
          today,
          opts,
        ));
      } catch (e) {
        // A code error, not post text; clipped all the same.
        error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        doc = failed(prev, today, now, ["error"]);
      }
      if (attempt === undefined) doc = noted(doc, "attempts_kv");
    }
  }
  // Counts and our own ids only, never names or post text; kept with the page for the live check.
  const diagnostics = {
    id,
    status: doc.status,
    items: doc.items.length,
    credits,
    notes: doc.notes,
    error,
    families,
    ...memory,
  };
  console.log(JSON.stringify({ category: diagnostics }));
  if (attempt === false || prev === undefined) return doc;
  doc = await save(env, key, { ...doc, diagnostics });
  const savedAt = Date.now();
  // The lessons (§3): after a scan that searched (a tight month never does) and saved (lessons that can't be stored
  // aren't bought: they stay due), when they are 6 days old or missing; they need the AI. Saved a second time, so a
  // slow refresh (the request dropped, waitUntil's 30 s over) never costs the trends.
  // ponytail: lessons share the scan's invocation (spec §4); if live CPU or wall time is too high, give them a slot.
  if (
    doc.status === "failed" ||
    doc.notes?.includes("kv") ||
    !env.AI ||
    !lessonsDue(prev?.lessons, today)
  )
    return doc;
  let lessons: Record<string, unknown>;
  try {
    const r = await refreshLessons(env, opts.fetch ?? fetch, g, doc.items, now, doc.lessons, opts);
    lessons = r.counts;
    // A refresh with nothing new: last week's lessons stay (§3).
    doc = r.lessons ? { ...doc, lessons: r.lessons } : noted(doc, "lessons");
  } catch (e) {
    lessons = { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
    doc = noted(doc, "lessons");
  }
  console.log(JSON.stringify({ category: { id, lessons } }));
  // Whatever is left of the 1.1 s since the trends' save (never more, if the clock moved back).
  const wait = SAVE_GAP_MS - Math.max(0, Date.now() - savedAt);
  if (wait > 0) await (opts.sleep ?? realSleep)(wait);
  return save(env, key, { ...doc, diagnostics: { ...diagnostics, lessons } });
}
