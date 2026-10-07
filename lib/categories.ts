import {
  parseTrendingEffects,
  readTabCache,
  textOf,
  writeTabCache,
  type TrendingEffects,
} from "./effects";
import { scoutCall, type ScoutConfig } from "./scoutClient";
import { canEmbed } from "./embed";

/**
 * Category pages in Discover (planning/tools/19-category-trends.md §1): a category's trends and lessons from the Worker
 * (`GET /categories/:id`, a KV read, no credits), kept 1 h per Worker and category in this tab's sessionStorage, and its
 * scan (`POST /categories/:id/run`). The trend chips are Trending effects' items (lib/effects parses them). A lesson
 * MIRRORS `Lessons` in workers/scout/src/categories/types.ts (hand-copied): change both together. So does a top video
 * (§6), the fields the page shows of `TopVideo`; Brave's lists (`fetchCategoryTop`) are never kept in storage.
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
/** English first (live fix 1): the Arabic name and how-to only when they are in Arabic script. The English how-to is
 * "Shoot: …\nSettings: …\nEdit: …" since live fix 2 (older lessons: one paragraph); the page shows its lines. */
export interface Technique {
  name: { en: string; ar?: string };
  howTo: { en: string; ar?: string };
  /** Prompts for the viewer and a suggested exercise, never analysis of the video's actual frames or settings. */
  study?: {
    watchFor: { en: string; ar?: string };
    tryIt: { en: string; ar?: string };
    sourceBasis: "title-and-description";
  };
  skillId?: string;
  videos: LessonVideo[];
}
/** The Worker's `v` (its lessons version) is not read: the page shows lessons of any version. */
export interface Lessons {
  updatedAt: string;
  photo: Technique[];
  video: Technique[];
  edit: Technique[];
}
/** The 🏆 row's tabs (§6), in their order: Instagram and TikTok first (the owner, 2026-10-07), the first one chosen. */
export type TopPlatform = "yt" | "tt" | "ig";
export const TOP_PLATFORMS: readonly TopPlatform[] = ["ig", "tt", "yt"];
/** A list holds at most this many, best first. */
export const TOP_MAX = 50;
export interface TopVideo {
  url: string;
  title: string;
  creator?: string;
  views?: number;
  thumbnail?: string;
  publishedAt?: string;
  snippet?: string;
  source?: "tavily" | "youtube" | "tiktok-discovery";
  evidence?: { basis: "metadata"; subjects: string[]; techniques: string[] };
}
/** The lists stored with the page: YouTube's most viewed of the month, the scan's Instagram posts, and TikTok's trending
 * videos from its Discovery API (titled with their hashtag; the card's oEmbed lookup brings the caption). */
export interface TopLists {
  updatedAt: string;
  yt: TopVideo[];
  tt: TopVideo[];
  ig: TopVideo[];
}
/** A TikTok or Instagram tab's lists (`GET /categories/:id/top/:platform`): the stored one (`scan`) and Brave's own
 * group (`brave`, in Brave's order, as Brave gave it), with why when Brave gave none. */
export interface TopAnswer {
  scan: TopVideo[];
  brave: TopVideo[];
  source: "brave" | "scan";
  note?: "no_key" | "brave_failed" | "daily_cap";
  discoveryStatus?: "not_connected" | "unavailable" | "ready" | "not_scanned";
}
export interface CategoryPageData extends TrendingEffects {
  lessons?: Lessons;
  top?: TopLists;
}

// Read stored candidates through the new metadata relevance gate once after upgrading the experience.
const CACHE_PREFIX = "3z-category-v2|";
const PER_AREA = 3;
/** The Worker's most a technique: 3 English videos (examples, and a tutorial when one teaches) and 1 Arabic tutorial. */
const VIDEOS = 4;
const PLATFORMS = new Set(["yt", "tt", "ig"]);
const NOTES = new Set(["no_key", "brave_failed", "daily_cap"]);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const isStr = (x: unknown): x is string => typeof x === "string";
const isHttps = (x: unknown): x is string => isStr(x) && x.startsWith("https://");

function parseTopVideo(x: unknown): TopVideo | null {
  if (!isObj(x) || !isHttps(x.url) || !isStr(x.title) || !x.title.trim()) return null;
  const views = x.views;
  const labels = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((s): s is string => isStr(s) && !!s.trim() && s.length <= 100).slice(0, 8)
      : [];
  const evidence =
    isObj(x.evidence) && x.evidence.basis === "metadata"
      ? {
          basis: "metadata" as const,
          subjects: labels(x.evidence.subjects),
          techniques: labels(x.evidence.techniques),
        }
      : undefined;
  return {
    url: x.url,
    title: x.title,
    ...(isStr(x.creator) && x.creator ? { creator: x.creator } : {}),
    ...(typeof views === "number" && Number.isSafeInteger(views) && views >= 0 ? { views } : {}),
    ...(isHttps(x.thumbnail) ? { thumbnail: x.thumbnail } : {}),
    ...(isStr(x.publishedAt) && Number.isFinite(Date.parse(x.publishedAt))
      ? { publishedAt: x.publishedAt }
      : {}),
    ...(isStr(x.snippet) && x.snippet ? { snippet: x.snippet.slice(0, 1000) } : {}),
    ...(["tavily", "youtube", "tiktok-discovery"].includes(x.source as string)
      ? { source: x.source as TopVideo["source"] }
      : {}),
    ...(evidence && evidence.techniques.length ? { evidence } : {}),
  };
}

/** A list checked entry by entry: a broken video dropped alone, ≤ 50. */
const topList = (x: unknown): TopVideo[] =>
  Array.isArray(x)
    ? x
        .map(parseTopVideo)
        .filter((v): v is TopVideo => !!v)
        .slice(0, TOP_MAX)
    : [];

function parseTop(x: unknown): TopLists | undefined {
  if (!isObj(x) || !isStr(x.updatedAt)) return undefined;
  return { updatedAt: x.updatedAt, yt: topList(x.yt), tt: topList(x.tt), ig: topList(x.ig) };
}

function parseVideo(x: unknown): LessonVideo | null {
  if (!isObj(x) || !isStr(x.url) || !x.url.startsWith("https://") || !isStr(x.title)) return null;
  if (!PLATFORMS.has(x.platform as string)) return null;
  if (x.kind !== "example" && x.kind !== "tutorial") return null;
  if (x.lang !== "en" && x.lang !== "ar") return null;
  // A page or product URL labelled "example" is not a post. Check its actual host before canonicalizing its path.
  try {
    const host = new URL(x.url).hostname.toLowerCase();
    const domains =
      x.platform === "yt"
        ? ["youtube.com", "youtu.be"]
        : x.platform === "tt"
          ? ["tiktok.com"]
          : ["instagram.com"];
    if (
      !domains.some((d) => host === d || host.endsWith(`.${d}`)) ||
      !canEmbed(x.platform as LessonVideo["platform"], x.url) ||
      !x.title.trim()
    )
      return null;
  } catch {
    return null;
  }
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
  const name = textOf(x.name);
  const howTo = textOf(x.howTo);
  const videos = Array.isArray(x.videos)
    ? x.videos
        .map(parseVideo)
        .filter((v): v is LessonVideo => !!v)
        .slice(0, VIDEOS)
    : [];
  // A technique without a video is never shown (spec §3); one without an English name and how-to neither.
  if (!name || !howTo || !videos.length) return null;
  const studyText = (raw: unknown) => {
    const text = textOf(raw);
    if (!text || text.en.length > 600) return undefined;
    return { en: text.en, ...(text.ar && text.ar.length <= 600 ? { ar: text.ar } : {}) };
  };
  const watchFor = isObj(x.study) ? studyText(x.study.watchFor) : undefined;
  const tryIt = isObj(x.study) ? studyText(x.study.tryIt) : undefined;
  const study =
    isObj(x.study) && x.study.sourceBasis === "title-and-description" && watchFor && tryIt
      ? { watchFor, tryIt, sourceBasis: "title-and-description" as const }
      : undefined;
  // Older generated lessons included unrelated references. Only individually refreshed, example-backed study cards
  // are shown, even when a partial refresh has not advanced the document's lessons version yet.
  if (!study || !videos.some((v) => v.kind === "example")) return null;
  return {
    name,
    howTo,
    ...(study ? { study } : {}),
    ...(isStr(x.skillId) && x.skillId ? { skillId: x.skillId } : {}),
    videos,
  };
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
  const top = isObj(raw) ? parseTop(raw.top) : undefined;
  return { ...base, ...(lessons ? { lessons } : {}), ...(top ? { top } : {}) };
}

/**
 * A TikTok or Instagram tab's lists (`GET /categories/:id/top/:platform`): the stored list and Brave's own group, or the
 * stored list alone with why, and where they came from (the page credits Brave under its group). Asked when the tab
 * first opens and kept in the page's state for that visit only, never in this tab's storage: Brave's terms forbid
 * keeping its results. null when the request fails.
 */
export async function fetchCategoryTop(
  config: ScoutConfig,
  id: string,
  platform: "tt" | "ig",
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<TopAnswer | null> {
  const r = await scoutCall(
    config,
    `/categories/${encodeURIComponent(id)}/top/${platform}`,
    {},
    { fetchImpl: opts.fetchImpl },
  );
  if (!r.ok || !isObj(r.data) || !Array.isArray(r.data.scan) || !Array.isArray(r.data.brave))
    return null;
  const note = r.data.note;
  return {
    scan: topList(r.data.scan),
    brave: topList(r.data.brave),
    source: r.data.source === "brave" ? "brave" : "scan",
    ...(NOTES.has(note as string) ? { note: note as TopAnswer["note"] } : {}),
    ...(["not_connected", "unavailable", "ready", "not_scanned"].includes(
      r.data.discoveryStatus as string,
    )
      ? { discoveryStatus: r.data.discoveryStatus as TopAnswer["discoveryStatus"] }
      : {}),
  };
}

/**
 * "Connect TikTok trends" (§6): `POST /tiktokads/connect` with the page's address, answered with TikTok for Business's
 * authorization page. The Worker sends the owner back to that address with `?tiktokads=connected` (or
 * `?tiktokads_error=<reason>`). null when the Worker can't (not configured, refused, no network) or answers no http(s)
 * address.
 */
export async function tiktokConnectUrl(
  config: ScoutConfig,
  returnTo: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const r = await scoutCall(
    config,
    "/tiktokads/connect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnTo }),
    },
    { fetchImpl: opts.fetchImpl },
  );
  const url = r.ok && isObj(r.data) ? r.data.url : undefined;
  return isStr(url) && /^https?:\/\//.test(url) ? url : null;
}

/** Something to show: trends or lessons. */
const hasPage = (d: CategoryPageData) =>
  d.items.length > 0 || !!d.lessons || TOP_PLATFORMS.some((p) => !!d.top?.[p].length);
/** Kept in this tab's copy only with its lessons (a scan saves its trends, then its lessons a little later, and a
 * GET between the two must not hide them for an hour). */
const keep = (d: CategoryPageData | null): d is CategoryPageData => !!d?.lessons;

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
 * refused token, no network, a broken answer). Only a page with its lessons is kept (`keep`).
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
  if (keep(data)) writeTabCache(cacheKey(config, id), data, now);
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
    if (keep(data)) writeTabCache(key, data, Date.now());
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
