import {
  RefSchema,
  type Genre,
  type Lang,
  type Program,
  type Ref,
  type RefPlatform,
  type TrendItem,
  type TrendsState,
} from "./domain";
import { genreHashtag, genreQuery } from "./genres";
import { parseStats, type Stats } from "./scoutClient";
import { visibleTrends, volumeUnit } from "./trends";

export type { Stats };

/**
 * Scout v0 (build plan 1.13, master plan round 23): platform search links for a topic, a pasted-link
 * normalizer, and a thin wrapper around the free YouTube Data API v3 `search.list` endpoint. No backend,
 * no server key: everything here runs on the phone, and the owner's own YouTube key (if any) lives in
 * Settings/localStorage. Round 31 adds the edit-genre query ({@link researchQuery}), the view / like counts
 * of a post (`stats`), the "Most popular" order ({@link sortByPopularity}) and the "Most viewed this week"
 * strip of a genre, read from the Trend Radar's feed ({@link genreWeekItems}).
 */

/** Program id whose YouTube EN search gets an extra " davinci resolve" suffix (almost always what's meant). */
export const DAVINCI_PROGRAM_ID = "davinci";

export interface Topic {
  ar: string;
  en: string;
}

/** One URL per language, for the platforms where both an AR and an EN search make sense. */
export type LangUrls = Record<Lang, string>;

export interface ResearchLinks {
  yt: LangUrls;
  tt: LangUrls;
  /** Instagram keyword search, both languages. */
  igKeyword: LangUrls;
  /** Instagram hashtag page. Hashtags are Latin slugs, so only one (EN-derived) variant exists. */
  igHashtag: string;
}

/** The YouTube query text for a language: the EN query gets " davinci resolve" appended for that program. */
export function youtubeQuery(topic: Topic, lang: Lang, programHint?: string): string {
  if (lang === "en" && programHint === DAVINCI_PROGRAM_ID) return `${topic.en} davinci resolve`;
  return topic[lang];
}

/** Instagram hashtag slug: the EN topic, lowercased, with everything but letters/digits stripped. */
export function hashtagSlug(topicEn: string): string {
  return topicEn.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The "+ program" search hint for a program: its English name for app programs ("DaVinci Resolve",
 * "CapCut"), nothing for craft programs (appending "Camera" to a query narrows nothing useful).
 */
export function programSearchHint(program: Pick<Program, "kind" | "name"> | undefined) {
  return program?.kind === "app" ? program.name.en : undefined;
}

/** The query with the program hint appended (once, case-insensitively), or the query as is. */
export function withProgramHint(query: string, hint?: string): string {
  const q = query.trim();
  if (!hint || !q) return q;
  return q.toLowerCase().includes(hint.toLowerCase()) ? q : `${q} ${hint}`;
}

/**
 * The search text the research panel sends (round 31): the topic (or the skill's name), then the picked
 * genre's main query in the search language, then the program hint ("Smart Bins" + cars + DaVinci →
 * "Smart Bins car edit DaVinci Resolve"). A genre with no topic is a search of its own ("car edit");
 * without a genre the text is what it always was.
 */
export function researchQuery(base: string, lang: Lang, genre?: Genre, hint?: string): string {
  return withProgramHint(genre ? genreQuery(genre, lang, base) : base, hint);
}

/**
 * The Instagram hashtag slug behind the "open on platform" menu: the genre's own hashtag when the genre is
 * the whole search (no topic), else the slug of `slugSource` (the skill's EN name, or the Discover topic).
 * Empty = no hashtag link (an Arabic topic, a custom genre without hashtags).
 */
export function researchHashtag(base: string, slugSource: string, genre?: Genre): string {
  if (genre && !base.trim()) return genreHashtag(genre) ?? "";
  return hashtagSlug(slugSource);
}

const ytUrl = (q: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const ttUrl = (q: string) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`;
const igKeywordUrl = (q: string) =>
  `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}`;
const igHashtagUrl = (slug: string) => `https://www.instagram.com/explore/tags/${slug}/`;

/** The in-app search page for a query on one platform (Instagram: the keyword search). */
export function platformSearchUrl(platform: "yt" | "tt" | "ig", q: string): string {
  if (platform === "yt") return ytUrl(q);
  if (platform === "tt") return ttUrl(q);
  return igKeywordUrl(q);
}

/**
 * Search links for a topic on the three research platforms: YouTube and TikTok in both languages,
 * Instagram as a keyword search (both languages) and a hashtag page (EN-derived slug only). `programHint`
 * is a program id; only `"davinci"` currently changes anything (the YouTube EN suffix above).
 */
export function searchLinks(topic: Topic, programHint?: string): ResearchLinks {
  return {
    yt: {
      ar: ytUrl(youtubeQuery(topic, "ar", programHint)),
      en: ytUrl(youtubeQuery(topic, "en", programHint)),
    },
    tt: { ar: ttUrl(topic.ar), en: ttUrl(topic.en) },
    igKeyword: { ar: igKeywordUrl(topic.ar), en: igKeywordUrl(topic.en) },
    igHashtag: igHashtagUrl(hashtagSlug(topic.en)),
  };
}

/** Detect which platform a pasted URL belongs to; anything else (or an unparsable URL) is "web". */
export function detectPlatform(url: string): RefPlatform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "web";
  }
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "yt";
  if (host.includes("tiktok.com")) return "tt";
  if (host.includes("instagram.com")) return "ig";
  return "web";
}

/** Instagram path segments that are routes, never an account name. */
const IG_RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "stories", "accounts"]);

/**
 * Pull an "@handle" out of a URL path when it names the account: TikTok / YouTube "/@name/...", Instagram
 * "/<name>/reel/<id>" (some shared links carry the account before the post).
 */
function handleFromPath(platform: RefPlatform, pathname: string): string | undefined {
  if (platform === "tt" || platform === "yt") return pathname.match(/\/(@[\w.-]+)/)?.[1];
  if (platform === "ig") {
    const [first, second] = pathname.split("/").filter(Boolean);
    if (first && second && !IG_RESERVED.has(first.toLowerCase()) && IG_RESERVED.has(second)) {
      return `@${first}`;
    }
  }
  return undefined;
}

/** YouTube video id from a watch / shorts / youtu.be URL. */
function youtubeVideoId(u: URL): string | undefined {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return u.pathname.split("/")[1] || undefined;
  if (u.pathname === "/watch") return u.searchParams.get("v") || undefined;
  return u.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
}

/**
 * The one canonical form of a post URL, used to store refs and to compare search cards with saved refs.
 * MIRRORS `canonicalUrl` in `workers/scout/src/normalize.ts` (the Worker returns search results in this
 * form); keep the two in step.
 *
 * - YouTube watch / shorts / youtu.be → `https://www.youtube.com/watch?v=<id>`
 * - Instagram /p, /reel, /reels, /tv (also "/<user>/reel/<id>") → `https://www.instagram.com/p/<id>`
 * - TikTok "/@user/video/<id>" (any subdomain) → `https://www.tiktok.com/@<user>/video/<id>`
 * - anything else → `https://<host><path>`: host lower-cased with a leading "www." / "m." dropped ("www." put
 *   back for tiktok.com, instagram.com and youtube.com), no query, hash or trailing "/". Instagram
 *   "original audio" pages (/reels/audio/<id>) are not posts and take this path.
 *
 * An unparsable URL comes back trimmed but otherwise as given.
 */
export function canonicalRefUrl(platform: RefPlatform, url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim();
  }
  if (platform === "yt") {
    const id = youtubeVideoId(u);
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  if (platform === "ig") {
    const id = u.pathname.match(IG_POST_PATH)?.[1];
    if (id) return `https://www.instagram.com/p/${id}`;
  }
  if (platform === "tt") {
    const m = u.pathname.match(TT_VIDEO_PATH);
    if (m) return `https://www.tiktok.com/${m[1]}/video/${m[2]}`;
  }
  let host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  if (PLATFORM_HOSTS.includes(host)) host = `www.${host}`;
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}`;
}

/** Same patterns as `workers/scout/src/normalize.ts`: one Instagram post (never an audio page), one TikTok video. */
const IG_POST_PATH = /^\/(?:[\w.]+\/)?(?:reels?|p|tv)\/(?!audio\/)([\w-]+)\/?$/;
const TT_VIDEO_PATH = /^\/(@[\w.-]+)\/video\/(\d+)/;
const PLATFORM_HOSTS: readonly string[] = ["tiktok.com", "instagram.com", "youtube.com"];

/**
 * Build a saved {@link Ref} from a pasted URL, stored in its {@link canonicalRefUrl} form so it matches the
 * search card for the same post. The handle comes from the URL path when it names the account (TikTok /
 * YouTube "@name", Instagram "/<name>/reel/..."), else the hostname; the title falls back to that handle.
 * Throws if `url` isn't a valid URL (the paste-a-link form should validate before calling this).
 */
export function normalizeRef(url: string, title?: string, handle?: string): Ref {
  const platform = detectPlatform(url);
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  const host = parsed?.hostname.replace(/^www\./, "");
  const fromPath = parsed ? handleFromPath(platform, parsed.pathname) : undefined;
  const finalHandle = handle?.trim() || fromPath || host || url;
  const finalTitle = title?.trim() || finalHandle;
  return RefSchema.parse({
    platform,
    handle: finalHandle,
    title: finalTitle,
    url: parsed ? canonicalRefUrl(platform, url) : url,
  });
}

/* ---------- YouTube Data API v3 (in-app results; owner supplies the key) ---------- */

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channel: string;
  /** Snippet description (may be empty). */
  description: string;
  thumb: string;
  url: string;
  /** Views / likes / comments from `videos.list`, when that second call answered for this video. */
  stats?: Stats;
}

export type YoutubeSearchError =
  | { type: "quota" }
  | { type: "forbidden" }
  | { type: "network" }
  | { type: "unknown"; status?: number };

export type YoutubeSearchResult =
  | {
      ok: true;
      items: YoutubeVideo[];
      /**
       * The statistics call did not answer (network, quota, a timeout): the videos are here, their numbers
       * are not. {@link cachedYoutubeSearch} remembers it and asks for the numbers alone next time.
       */
      statsMissing?: true;
    }
  | { ok: false; error: YoutubeSearchError };

export type YoutubeErrorMessageKey =
  "research.errQuota" | "research.errForbidden" | "research.errNetwork" | "research.errUnknown";

/** Message key (in `messages/*.json`, under `research.err*`) for a {@link YoutubeSearchError}. */
export function youtubeErrorMessageKey(error: YoutubeSearchError): YoutubeErrorMessageKey {
  switch (error.type) {
    case "quota":
      return "research.errQuota";
    case "forbidden":
      return "research.errForbidden";
    case "network":
      return "research.errNetwork";
    default:
      return "research.errUnknown";
  }
}

/** YouTube `videoDuration`: short < 4 min, medium 4 to 20 min, long > 20 min. */
export type YoutubeDuration = "short" | "medium" | "long" | "any";

export interface YoutubeSearchOpts {
  relevanceLanguage?: Lang;
  regionCode?: string;
  maxResults?: number;
  /** Only videos of this length ("any", or omitted, sends nothing). */
  videoDuration?: YoutubeDuration;
  /** RFC 3339 date-time: only videos published after it (see {@link publishedAfterFor}). */
  publishedAfter?: string;
  /**
   * "viewCount" = most viewed first (the "Most popular" sort). Omitted = YouTube's relevance order, and the
   * request URL (so the cache key) stays what it was before the sort existed.
   */
  order?: "viewCount";
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Build the `search.list` request URL. Exported so URL-building is testable without a network call. */
export function youtubeSearchUrl(apiKey: string, q: string, opts: YoutubeSearchOpts = {}): string {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(opts.maxResults ?? 8),
    q,
    key: apiKey,
    regionCode: opts.regionCode ?? "SA",
  });
  if (opts.relevanceLanguage) params.set("relevanceLanguage", opts.relevanceLanguage);
  if (opts.videoDuration && opts.videoDuration !== "any") {
    params.set("videoDuration", opts.videoDuration);
  }
  if (opts.publishedAfter) params.set("publishedAfter", opts.publishedAfter);
  if (opts.order) params.set("order", opts.order);
  return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
}

/** `videos.list` takes at most 50 ids per call. */
export const YOUTUBE_STATS_MAX_IDS = 50;
/** The statistics call never holds the cards back longer than this. */
export const YOUTUBE_STATS_TIMEOUT_MS = 6000;

/**
 * Build the `videos.list?part=statistics` request for the videos of one search (1 quota unit, against 100
 * for the search itself). Exported so URL-building is testable without a network call.
 */
export function youtubeStatsUrl(apiKey: string, videoIds: readonly string[]): string {
  const params = new URLSearchParams({
    part: "statistics",
    id: videoIds.slice(0, YOUTUBE_STATS_MAX_IDS).join(","),
    key: apiKey,
  });
  return `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
}

interface RawSearchResponse {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
    };
  }[];
}

interface RawErrorResponse {
  error?: { errors?: { reason?: string }[] };
}

interface RawStatsResponse {
  items?: {
    id?: unknown;
    statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown };
  }[];
}

/** A count from the API, which sends numbers as strings ("12345"); undefined when hidden or malformed. */
function countOf(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  return typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

/**
 * Views / likes / comments by video id, from ONE `videos.list` call. Never throws and never fails the
 * search. A Map when the call answered (maybe empty: hidden counts, or no ids to ask about); undefined when
 * it did not (an API error, the network, a timeout, a body that isn't JSON), so the caller can tell "no
 * numbers" from "ask again".
 */
async function youtubeStats(
  apiKey: string,
  videoIds: readonly string[],
  doFetch: typeof fetch,
): Promise<Map<string, Stats> | undefined> {
  const out = new Map<string, Stats>();
  if (videoIds.length === 0) return out;
  try {
    const res = await doFetch(youtubeStatsUrl(apiKey, videoIds), {
      signal: timeoutSignal(YOUTUBE_STATS_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as RawStatsResponse;
    for (const it of data.items ?? []) {
      if (typeof it?.id !== "string") continue;
      const stats = parseStats({
        views: countOf(it.statistics?.viewCount),
        likes: countOf(it.statistics?.likeCount),
        comments: countOf(it.statistics?.commentCount),
      });
      if (stats) out.set(it.id, stats);
    }
  } catch {
    // The cards go without numbers for now.
    return undefined;
  }
  return out;
}

/** The videos with the numbers the statistics call gave; a video it did not name stays as it was. */
function withStats(
  items: readonly YoutubeVideo[],
  stats: ReadonlyMap<string, Stats>,
): YoutubeVideo[] {
  return items.map((v) => {
    const s = stats.get(v.videoId);
    return s ? { ...v, stats: s } : v;
  });
}

/**
 * Run one YouTube search, then one `videos.list` call for the statistics of the videos it found (views,
 * likes, comments; 1 quota unit). Never throws: network and API errors of the search come back as a typed
 * `{ ok: false }`; a failure of the statistics call keeps the videos, without `stats`, and says so with
 * `statsMissing`.
 */
export async function youtubeSearch(
  apiKey: string,
  q: string,
  opts: YoutubeSearchOpts = {},
): Promise<YoutubeSearchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(youtubeSearchUrl(apiKey, q, opts));
  } catch {
    return { ok: false, error: { type: "network" } };
  }
  if (!res.ok) {
    let reason: string | undefined;
    try {
      reason = ((await res.json()) as RawErrorResponse).error?.errors?.[0]?.reason;
    } catch {
      // Body wasn't JSON; fall through to the status-based mapping below.
    }
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      return { ok: false, error: { type: "quota" } };
    }
    if (res.status === 403) return { ok: false, error: { type: "forbidden" } };
    return { ok: false, error: { type: "unknown", status: res.status } };
  }
  const data = (await res.json()) as RawSearchResponse;
  const items: YoutubeVideo[] = [];
  for (const it of data.items ?? []) {
    const videoId = it.id?.videoId;
    if (!videoId) continue;
    items.push({
      videoId,
      title: decodeEntities(it.snippet?.title ?? ""),
      channel: decodeEntities(it.snippet?.channelTitle ?? ""),
      description: decodeEntities(it.snippet?.description ?? ""),
      thumb: it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? "",
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  const stats = await youtubeStats(
    apiKey,
    items.map((v) => v.videoId),
    doFetch,
  );
  if (!stats) return { ok: true, items, statsMissing: true };
  return { ok: true, items: withStats(items, stats) };
}

/** The API returns HTML-escaped snippet text ("Tom &amp; Jerry", "it&#39;s"); decode the common entities. */
export function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|#x27|apos);/g, (m, name: string) => {
    switch (name) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      default:
        return "'";
    }
  });
}

/* ---------- YouTube cache (memory, per session) ---------- */

/** A search costs 100 of the key's 10,000 daily units, so repeats within this window are served locally. */
export const YOUTUBE_CACHE_TTL_MS = 30 * 60 * 1000;

/** One cached search: what it found, when, and whether its numbers are still owed. */
interface YoutubeCacheEntry {
  /** When the search was made; a later statistics call never moves it. */
  at: number;
  items: YoutubeVideo[];
  /** The statistics call failed for this search: the next hit asks for the numbers again. */
  statsMissing?: true;
}

const ytMemory = new Map<string, YoutubeCacheEntry>();
const ytInflight = new Map<string, Promise<YoutubeSearchResult>>();

/** The cache entry of a request while it is within {@link YOUTUBE_CACHE_TTL_MS}. */
function freshYoutubeEntry(key: string, now: number): YoutubeCacheEntry | undefined {
  const hit = ytMemory.get(key);
  return hit && now - hit.at < YOUTUBE_CACHE_TTL_MS ? hit : undefined;
}

/**
 * Cached results for exactly this request (same key, query and options), without fetching. They carry the
 * numbers as soon as a statistics call has answered for them, the first one or a later one.
 */
export function peekYoutubeSearch(
  apiKey: string,
  q: string,
  opts: YoutubeSearchOpts = {},
  now = Date.now(),
): YoutubeVideo[] | undefined {
  return freshYoutubeEntry(youtubeSearchUrl(apiKey, q, opts), now)?.items;
}

/**
 * The numbers for a cached search whose statistics call failed: ONE `videos.list` call for the cached
 * videos (1 quota unit), never the search again (100). When it answers, the entry is rewritten with the
 * numbers and keeps its original time; when it fails again the cached videos come back as they were and
 * the next hit tries once more.
 */
async function refillYoutubeStats(
  apiKey: string,
  key: string,
  hit: YoutubeCacheEntry,
  doFetch: typeof fetch,
): Promise<YoutubeSearchResult> {
  const stats = await youtubeStats(
    apiKey,
    hit.items.map((v) => v.videoId),
    doFetch,
  );
  if (!stats) return { ok: true, items: hit.items, statsMissing: true };
  const items = withStats(hit.items, stats);
  // Unless the entry was replaced or forgotten while the call was out.
  if (ytMemory.get(key) === hit) ytMemory.set(key, { at: hit.at, items });
  return { ok: true, items };
}

/**
 * {@link youtubeSearch} with a per-session memory cache and in-flight dedupe keyed on the full request URL
 * (query, language, duration, published-after, order), so switching tabs or filters back and forth costs
 * nothing. Only successful answers are cached, with whatever statistics came with them. A cached search
 * whose statistics call had failed is served from memory too, after asking for its numbers alone once more
 * (see {@link refillYoutubeStats}; concurrent callers share that one request), so "Search again" can bring
 * the numbers back without paying for the search twice.
 */
export async function cachedYoutubeSearch(
  apiKey: string,
  q: string,
  opts: YoutubeSearchOpts = {},
  now = Date.now(),
): Promise<YoutubeSearchResult> {
  const key = youtubeSearchUrl(apiKey, q, opts);
  const hit = freshYoutubeEntry(key, now);
  const refill = !!hit?.statsMissing && hit.items.length > 0;
  if (hit && !refill) return { ok: true, items: hit.items };
  const pending = ytInflight.get(key);
  if (pending) return pending;
  const run = hit
    ? refillYoutubeStats(apiKey, key, hit, opts.fetchImpl ?? fetch)
    : youtubeSearch(apiKey, q, opts).then((r) => {
        if (r.ok) {
          ytMemory.set(key, {
            at: now,
            items: r.items,
            ...(r.statsMissing ? { statsMissing: true as const } : {}),
          });
        }
        return r;
      });
  ytInflight.set(key, run);
  try {
    return await run;
  } finally {
    if (ytInflight.get(key) === run) ytInflight.delete(key);
  }
}

/** Forget cached YouTube searches (tests). */
export function clearYoutubeCache(): void {
  ytMemory.clear();
  ytInflight.clear();
}

/* ---------- Research UI v2 (build plan 1.15): tabs, filters, unified result items ---------- */

export type ResearchTab = "all" | "yt" | "tt" | "ig";
export const RESEARCH_TABS: readonly ResearchTab[] = ["all", "yt", "tt", "ig"];
export type Recency = "any" | "week" | "month" | "year";
export type LengthFilter = "any" | "short" | "long";
/** The Sort filter: the order the sources gave, or the most viewed / liked first. */
export type SortMode = "relevance" | "popular";

const RECENCY_DAYS: Record<Exclude<Recency, "any">, number> = { week: 7, month: 30, year: 365 };

/**
 * YouTube `publishedAfter` for a recency filter: midnight UTC of the day `N` days back (rounded to the day
 * so the request URL, and so the cache key, stays stable all day). Undefined for "any".
 */
export function publishedAfterFor(recency: Recency, now = Date.now()): string | undefined {
  if (recency === "any") return undefined;
  const d = new Date(now - RECENCY_DAYS[recency] * 86_400_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** YouTube `videoDuration` for the length filter ("Shorts < 4 min" → short, "Long > 20 min" → long). */
export function youtubeDurationFor(length: LengthFilter): YoutubeDuration | undefined {
  return length === "any" ? undefined : length;
}

/**
 * Which platforms a tab asks the Scout Worker for. YouTube goes to the YouTube Data API when the owner has a
 * key (then the Worker is never asked for it), else to the Worker. Null = no Worker call for this tab.
 */
export function scoutPlatformsFor(
  tab: ResearchTab,
  hasYoutubeKey: boolean,
): ("tt" | "ig" | "yt")[] | null {
  switch (tab) {
    case "all":
      return hasYoutubeKey ? ["tt", "ig"] : ["tt", "ig", "yt"];
    case "yt":
      return hasYoutubeKey ? null : ["yt"];
    default:
      return [tab];
  }
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** True when the text has any Arabic-script letter. */
export function hasArabic(text: string): boolean {
  return ARABIC.test(text);
}

/**
 * Stable sort: items whose title or snippet (the caption) has Arabic script first, the rest after, each
 * group in original order. Many Arabic posts carry an English or emoji-only title over an Arabic caption.
 */
export function arabicFirst<T extends { title: string; snippet?: string }>(
  items: readonly T[],
): T[] {
  const ar = (i: T) => hasArabic(i.title) || hasArabic(i.snippet ?? "");
  return [...items.filter(ar), ...items.filter((i) => !ar(i))];
}

/**
 * One number to rank a post by: its views when known, else its likes × 10 (about one like per ten views,
 * so a TikTok with likes only can sit next to a YouTube video with views). Undefined when neither is known.
 */
export function popularityOf(stats?: Stats): number | undefined {
  if (stats?.views !== undefined) return stats.views;
  if (stats?.likes !== undefined) return stats.likes * 10;
  return undefined;
}

/**
 * The "Most popular" order: posts with a known {@link popularityOf} first, highest first; the rest after, in
 * their original order. Stable (ties keep their order) and never touches the list it was given.
 */
export function sortByPopularity<T extends { stats?: Stats }>(items: readonly T[]): T[] {
  const known: { item: T; score: number }[] = [];
  const unknown: T[] = [];
  for (const item of items) {
    const score = popularityOf(item.stats);
    if (score === undefined) unknown.push(item);
    else known.push({ item, score });
  }
  known.sort((a, b) => b.score - a.score);
  return [...known.map((k) => k.item), ...unknown];
}

/** What the stats chip of a card shows: the views when known, else the likes; undefined without either. */
export function headlineStat(
  stats?: Stats,
): { kind: "views" | "likes"; value: number } | undefined {
  if (stats?.views !== undefined) return { kind: "views", value: stats.views };
  if (stats?.likes !== undefined) return { kind: "likes", value: stats.likes };
  return undefined;
}

/**
 * A count the short way, in the language of the dashboard ("1.2M", "45K", "1.2 مليون"). The digits are
 * pinned to Latin ones, like everywhere else in the dashboard: left alone, "ar" prints Arabic-Indic digits
 * on some (older) browsers.
 */
export function compactCount(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang, {
    notation: "compact",
    maximumFractionDigits: 1,
    numberingSystem: "latn",
  }).format(n);
}

/** One card in the research panel, whatever it came from (YouTube Data API, Scout Worker, a saved ref). */
export interface ResearchItem {
  platform: RefPlatform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
  thumb?: string;
  /** Known for search cards only, when the source gave counts; a saved {@link Ref} never keeps them. */
  stats?: Stats;
}

export function itemFromYoutube(v: YoutubeVideo): ResearchItem {
  return {
    platform: "yt",
    handle: v.channel,
    title: v.title || v.url,
    snippet: v.description,
    url: v.url,
    ...(v.thumb ? { thumb: v.thumb } : {}),
    ...(v.stats ? { stats: v.stats } : {}),
  };
}

export function itemFromRef(r: Ref): ResearchItem {
  return { ...r, snippet: "" };
}

/** The {@link Ref} saved when a card is attached to a skill (its counts are not kept: they go stale). */
export function refFromItem(i: ResearchItem): Ref {
  return {
    platform: i.platform,
    handle: i.handle,
    title: i.title || i.url,
    url: i.url,
    ...(i.thumb ? { thumb: i.thumb } : {}),
  };
}

/* ---------- "Most viewed this week": the Trend Radar's rows of a genre, as cards ---------- */

/** How many of the radar's rows the "Most viewed this week" strip shows. */
export const GENRE_WEEK_MAX = 6;

const HTTP_URL = /^https?:\/\//i;
const YT_WATCH = "https://www.youtube.com/watch?v=";

/**
 * A Trend Radar row as a card of the research panel. The rows of a genre come from the Worker's daily
 * YouTube keyword scan: the views are the row's `volume`, and the channel is what the Worker writes in the
 * `why` of a YouTube row (no handle when it sent none). The link goes in its {@link canonicalRefUrl} form,
 * like a search card's, so attaching it saves the same reference. Undefined for a row that is not a YouTube
 * video with a link (a watch, Shorts or youtu.be address): nothing to open or attach.
 */
export function itemFromTrend(row: TrendItem): ResearchItem | undefined {
  const url = row.url?.trim();
  if (row.platform !== "youtube" || !url || !HTTP_URL.test(url)) return undefined;
  if (detectPlatform(url) !== "yt") return undefined;
  const canonical = canonicalRefUrl("yt", url);
  if (!canonical.startsWith(YT_WATCH)) return undefined;
  // Only a number that counts views becomes views (a scan row's volume counts pages, lib/trends volumeUnit).
  const stats = volumeUnit(row) === "views" ? parseStats({ views: row.volume }) : undefined;
  return {
    platform: "yt",
    handle: row.why?.trim() ?? "",
    title: row.title,
    snippet: "",
    url: canonical,
    ...(row.thumb && HTTP_URL.test(row.thumb) ? { thumb: row.thumb } : {}),
    ...(stats ? { stats } : {}),
  };
}

/**
 * The "Most viewed this week" strip of a genre: the rows of the radar's feed tagged with it that still show
 * (lib/trends' `visibleTrends`: not dismissed, not expired), in the search language, best score first, as
 * cards; the first {@link GENRE_WEEK_MAX}, each video once. They are the most viewed results of the
 * Worker's keyword search for the genre this week, not a trending list of the platform. Empty without a
 * genre and for a genre the feed has no rows of (the Worker scans the built-in genres only, so an owner's
 * own genre has none).
 */
export function genreWeekItems(
  feed: TrendsState,
  genreId: string | undefined,
  lang: Lang,
  now: Date = new Date(),
): ResearchItem[] {
  if (!genreId) return [];
  const rows = visibleTrends(feed, { genre: genreId, lang }, now);
  return dedupeByUrl(rows.flatMap((row) => itemFromTrend(row) ?? [])).slice(0, GENRE_WEEK_MAX);
}

/**
 * Merge lists into one, first occurrence of each post wins. URLs are compared in their
 * {@link canonicalRefUrl} form (a saved "youtu.be/x?t=5" and a search card "youtube.com/watch?v=x" are one
 * post); the kept item is returned unchanged.
 */
export function dedupeByUrl<T extends { url: string }>(...lists: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = canonicalRefUrl(detectPlatform(item.url), item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

const PLATFORM_ORDER: readonly RefPlatform[] = ["yt", "tt", "ig", "web"];

/**
 * Round-robin by platform (YouTube, TikTok, Instagram, web), keeping each platform's own order, so the
 * "All" tab mixes sources instead of showing ten YouTube cards before the first TikTok.
 */
export function interleavePlatforms<T extends { platform: RefPlatform }>(items: readonly T[]): T[] {
  const queues = PLATFORM_ORDER.map((p) => items.filter((i) => i.platform === p));
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}
