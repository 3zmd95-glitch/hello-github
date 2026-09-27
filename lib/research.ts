import { RefSchema, type Lang, type Ref, type RefPlatform } from "./domain";

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

const ytUrl = (q: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const ttUrl = (q: string) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`;
const igKeywordUrl = (q: string) =>
  `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}`;
const igHashtagUrl = (slug: string) => `https://www.instagram.com/explore/tags/${slug}/`;

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

/** Pull an "@handle" out of a TikTok/YouTube channel-style URL path, when the path has one. */
function handleFromPath(pathname: string): string | undefined {
  return pathname.match(/\/(@[\w.-]+)/)?.[1];
}

/**
 * Build a saved {@link Ref} from a pasted URL. The handle comes from a TikTok/YouTube "@name" in the URL
 * path when there is one, else the hostname; the title falls back to that handle, then the raw URL.
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
  const fromPath =
    parsed && (platform === "tt" || platform === "yt")
      ? handleFromPath(parsed.pathname)
      : undefined;
  const finalHandle = handle?.trim() || fromPath || host || url;
  const finalTitle = title?.trim() || finalHandle;
  return RefSchema.parse({ platform, handle: finalHandle, title: finalTitle, url });
}

/* ---------- YouTube Data API v3 (in-app results; owner supplies the key) ---------- */

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channel: string;
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

export interface YoutubeSearchOpts {
  relevanceLanguage?: Lang;
  regionCode?: string;
  maxResults?: number;
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
  return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
}

interface RawSearchResponse {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
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
      title: it.snippet?.title ?? "",
      channel: it.snippet?.channelTitle ?? "",
      thumb: it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? "",
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  return { ok: true, items };
}
