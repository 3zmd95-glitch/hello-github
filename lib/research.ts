import { RefSchema, type Lang, type Program, type Ref, type RefPlatform } from "./domain";

/**
 * Scout v0 (build plan 1.13, master plan round 23): platform search links for a topic, a pasted-link
 * normalizer, and a thin wrapper around the free YouTube Data API v3 `search.list` endpoint. No backend,
 * no server key: everything here runs on the phone, and the owner's own YouTube key (if any) lives in
 * Settings/localStorage.
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
}

export type YoutubeSearchError =
  | { type: "quota" }
  | { type: "forbidden" }
  | { type: "network" }
  | { type: "unknown"; status?: number };

export type YoutubeSearchResult =
  { ok: true; items: YoutubeVideo[] } | { ok: false; error: YoutubeSearchError };

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
  return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
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

/** Run one YouTube search. Never throws: network and API errors come back as a typed `{ ok: false }`. */
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
  return { ok: true, items };
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
const ytMemory = new Map<string, { at: number; items: YoutubeVideo[] }>();
const ytInflight = new Map<string, Promise<YoutubeSearchResult>>();

/** Cached results for exactly this request (same key, query and options), without fetching. */
export function peekYoutubeSearch(
  apiKey: string,
  q: string,
  opts: YoutubeSearchOpts = {},
  now = Date.now(),
): YoutubeVideo[] | undefined {
  const hit = ytMemory.get(youtubeSearchUrl(apiKey, q, opts));
  return hit && now - hit.at < YOUTUBE_CACHE_TTL_MS ? hit.items : undefined;
}

/**
 * {@link youtubeSearch} with a per-session memory cache and in-flight dedupe keyed on the full request URL
 * (query, language, duration, published-after), so switching tabs or filters back and forth costs nothing.
 * Only successful answers are cached.
 */
export async function cachedYoutubeSearch(
  apiKey: string,
  q: string,
  opts: YoutubeSearchOpts = {},
  now = Date.now(),
): Promise<YoutubeSearchResult> {
  const key = youtubeSearchUrl(apiKey, q, opts);
  const hit = peekYoutubeSearch(apiKey, q, opts, now);
  if (hit) return { ok: true, items: hit };
  const pending = ytInflight.get(key);
  if (pending) return pending;
  const run = youtubeSearch(apiKey, q, opts).then((r) => {
    if (r.ok) ytMemory.set(key, { at: now, items: r.items });
    return r;
  });
  ytInflight.set(key, run);
  try {
    return await run;
  } finally {
    ytInflight.delete(key);
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

/** One card in the research panel, whatever it came from (YouTube Data API, Scout Worker, a saved ref). */
export interface ResearchItem {
  platform: RefPlatform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
  thumb?: string;
}

export function itemFromYoutube(v: YoutubeVideo): ResearchItem {
  return {
    platform: "yt",
    handle: v.channel,
    title: v.title || v.url,
    snippet: v.description,
    url: v.url,
    ...(v.thumb ? { thumb: v.thumb } : {}),
  };
}

export function itemFromRef(r: Ref): ResearchItem {
  return { ...r, snippet: "" };
}

/** The {@link Ref} saved when a card is attached to a skill. */
export function refFromItem(i: ResearchItem): Ref {
  return {
    platform: i.platform,
    handle: i.handle,
    title: i.title || i.url,
    url: i.url,
    ...(i.thumb ? { thumb: i.thumb } : {}),
  };
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
