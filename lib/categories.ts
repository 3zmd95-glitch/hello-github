import { parseTrendingEffects, readTabCache, writeTabCache, type TrendingEffects } from "./effects";
import { scoutCall, type ScoutConfig } from "./scoutClient";

/**
 * Category pages in Discover (planning/tools/19-category-trends.md §1): a category's trends and lessons from the Worker
 * (`GET /categories/:id`, a KV read, no credits), kept 1 h per Worker and category in this tab's sessionStorage, and its
 * scan (`POST /categories/:id/run`). The trend chips are Trending effects' items (lib/effects parses them). A lesson
 * MIRRORS `Lessons` in workers/scout/src/categories/types.ts (hand-copied): change both together.
 */

export type Area = "photo" | "video" | "edit";
export const AREAS: readonly Area[] = ["photo", "video", "edit"];

export interface LessonVideo {
  url: string;
  title: string;
  platform: "yt" | "tt" | "ig";
  kind: "example" | "tutorial";
  lang: "en" | "ar";
}
export interface Technique {
  name: { en: string; ar: string };
  howTo: { en: string; ar: string };
  skillId?: string;
  videos: LessonVideo[];
}
export interface Lessons {
  updatedAt: string;
  photo: Technique[];
  video: Technique[];
  edit: Technique[];
}
export interface CategoryPageData extends TrendingEffects {
  lessons?: Lessons;
}

const CACHE_PREFIX = "3z-category|";
const PER_AREA = 3;
/** The Worker's most a technique: 2 examples, 1 tutorial and 1 Arabic tutorial. */
const VIDEOS = 4;
const PLATFORMS = new Set(["yt", "tt", "ig"]);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const isStr = (x: unknown): x is string => typeof x === "string";

/** `{ en, ar }` with text in both, trimmed; else undefined. */
function both(x: unknown): { en: string; ar: string } | undefined {
  if (!isObj(x) || !isStr(x.en) || !isStr(x.ar) || !x.en.trim() || !x.ar.trim()) return undefined;
  return { en: x.en.trim(), ar: x.ar.trim() };
}

function parseVideo(x: unknown): LessonVideo | null {
  if (!isObj(x) || !isStr(x.url) || !x.url.startsWith("https://") || !isStr(x.title)) return null;
  if (!PLATFORMS.has(x.platform as string)) return null;
  if (x.kind !== "example" && x.kind !== "tutorial") return null;
  if (x.lang !== "en" && x.lang !== "ar") return null;
  return {
    url: x.url,
    title: x.title,
    platform: x.platform as LessonVideo["platform"],
    kind: x.kind,
    lang: x.lang,
  };
}

function parseTechnique(x: unknown): Technique | null {
  if (!isObj(x)) return null;
  const name = both(x.name);
  const howTo = both(x.howTo);
  const videos = Array.isArray(x.videos)
    ? x.videos
        .map(parseVideo)
        .filter((v): v is LessonVideo => !!v)
        .slice(0, VIDEOS)
    : [];
  // A technique without a video is never shown (spec §3); a technique without both languages neither.
  if (!name || !howTo || !videos.length) return null;
  return { name, howTo, ...(isStr(x.skillId) && x.skillId ? { skillId: x.skillId } : {}), videos };
}

function parseLessons(x: unknown): Lessons | undefined {
  if (!isObj(x) || !isStr(x.updatedAt)) return undefined;
  const shelf = (a: Area) => {
    const list = x[a];
    return Array.isArray(list)
      ? list
          .map(parseTechnique)
          .filter((t): t is Technique => !!t)
          .slice(0, PER_AREA)
      : [];
  };
  const lessons = {
    updatedAt: x.updatedAt,
    photo: shelf("photo"),
    video: shelf("video"),
    edit: shelf("edit"),
  };
  return AREAS.some((a) => lessons[a].length) ? lessons : undefined;
}

/** The Worker's answer checked field by field (the trends as lib/effects reads them); null without a known status or
 * an item list. */
export function parseCategory(raw: unknown): CategoryPageData | null {
  const base = parseTrendingEffects(raw);
  if (!base) return null;
  const lessons = isObj(raw) ? parseLessons(raw.lessons) : undefined;
  return { ...base, ...(lessons ? { lessons } : {}) };
}

/** Something to show: trends or lessons. */
const hasPage = (d: CategoryPageData) => d.items.length > 0 || !!d.lessons;

/** Which state the page is in: the first scan before anything shows; the old page after a failed update; the page. */
export function pageState(d: CategoryPageData): "never" | "stale" | "page" {
  if (d.status === "never" || (d.status === "failed" && !hasPage(d))) return "never";
  return d.status === "failed" ? "stale" : "page";
}

const cacheKey = (config: ScoutConfig, id: string) => `${CACHE_PREFIX}${config.url}|${id}`;

/** This tab's copy of the page when under an hour old, read at once (no request); null otherwise. */
export function cachedCategory(
  config: ScoutConfig,
  id: string,
  now = Date.now(),
): CategoryPageData | null {
  return readTabCache(cacheKey(config, id), now, parseCategory);
}

/**
 * The page, from this tab's copy when under an hour old; null when this Worker has no page (an older Worker's 404, a
 * refused token, no network, a broken answer). Only a page with something to show is kept.
 */
export async function fetchCategory(
  config: ScoutConfig,
  id: string,
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<CategoryPageData | null> {
  const now = opts.now ?? Date.now();
  const kept = cachedCategory(config, id, now);
  if (kept) return kept;
  const r = await scoutCall(
    config,
    `/categories/${encodeURIComponent(id)}`,
    {},
    { fetchImpl: opts.fetchImpl },
  );
  const data = r.ok ? parseCategory(r.data) : null;
  if (data && hasPage(data)) writeTabCache(cacheKey(config, id), data, now);
  return data;
}

const running = new Map<string, Promise<CategoryPageData | null>>();

/**
 * Scans the category now (about a minute, more when its lessons are due). One request per Worker and category at a
 * time, since the Worker's once-a-day check has no lock: a second tap waits for the same answer. `force` (Scan again)
 * passes the once-a-day guard; it still counts against the Worker's 3 tries a day, after which the answer is noted
 * "attempts". A page is kept like a fetched one; null when the request failed.
 */
export async function runCategoryNow(
  config: ScoutConfig,
  id: string,
  opts: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<CategoryPageData | null> {
  const key = cacheKey(config, id);
  const pending = running.get(key);
  if (pending) return pending;
  const run = (async () => {
    const init: RequestInit = opts.force
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        }
      : { method: "POST" };
    const r = await scoutCall(config, `/categories/${encodeURIComponent(id)}/run`, init, {
      fetchImpl: opts.fetchImpl,
    });
    const data = r.ok ? parseCategory(r.data) : null;
    if (data && hasPage(data)) writeTabCache(key, data, Date.now());
    return data;
  })();
  running.set(key, run);
  try {
    return await run;
  } finally {
    running.delete(key);
  }
}

/** The scan this tab is running on that category, if any: the page, opened again meanwhile, waits for it. */
export function categoryScanInFlight(
  config: ScoutConfig,
  id: string,
): Promise<CategoryPageData | null> | undefined {
  return running.get(cacheKey(config, id));
}
