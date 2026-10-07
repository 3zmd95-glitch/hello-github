/**
 * Top videos per platform on a category page (planning/tools/19-category-trends.md §6). The owner: "Every category
 * should show at least 50 results in every platform with top tier results".
 * - YouTube, stored with the page: the category's main query by views over the last 30 days, one `search.list` and
 *   one `videos.list` a scan, outside Discover's `DISCOVER_YT_CAP` (66 since §6: 18 + 6 + 66 + 4 = 94 of the 100 a day).
 * - Instagram and TikTok, stored: the scan's own Tavily posts, the ones more searches found first.
 * - On demand for TikTok and Instagram (`GET /categories/:id/top/:platform`): Brave's Search API, merged with the
 *   stored list. Brave's terms: "shall not store, cache, or create a database of Search Results, in whole or in part,
 *   other than transient storage required for operation". Its results are never written: the only KV write is the
 *   day's request counter.
 */

import { CALL_TIMEOUT_MS, capVar, timed } from "../discover/fetchers";
import { clip, isRecord } from "../effects/ai";
import type { EffectsEnv } from "../effects/sources";
import type { EffectPlatform, EffectPost } from "../effects/types";
import {
  canonicalUrl,
  cleanText,
  cleanTikTokTitle,
  handleFromUrl,
  instagramCard,
  isGenericTikTokTitle,
  isVideoUrl,
  PLATFORM_DOMAIN,
  platformForHost,
} from "../normalize";
import type { Genre } from "../trends/genres";
import { utcDay } from "../trends/kv";
import { YT_VIDEOS_URL, ytThumb, type YtListResponse } from "../trends/youtube";
import { YT_SEARCH_URL } from "../trends/youtubeSearch";
import { ytCount } from "../youtubeStats";
import type { TopLists, TopVideo } from "./types";

export type TopPlatform = keyof Omit<TopLists, "updatedAt">;
/** The platforms Brave tops up (YouTube's list comes from its own API). */
export type BravePlatform = Exclude<TopPlatform, "yt">;
export const TOP_MAX = 50;
const MONTH_MS = 30 * 86_400_000;
const TITLE_MAX = 160;
/** As Discover's YouTube cards clip a description. */
const SNIPPET_MAX = 220;
const NAME_MAX = 80;
const AGE_MAX = 40;
const VIDEO_ID = /^[\w-]{6,}$/;

export const BRAVE_VIDEOS_URL = "https://api.search.brave.com/res/v1/videos/search";
export const BRAVE_WEB_URL = "https://api.search.brave.com/res/v1/web/search";
/** Brave's web search answers at most 20 results a page. */
const WEB_COUNT = 20;
const BRAVE_DAILY = 40;
const COUNTER_TTL_S = 2 * 86_400;
export const braveCountKey = (day: string) => `brave:count:${day}`;

export interface TopEnv extends EffectsEnv {
  /** Secret, optional: Brave's Search API key (the owner adds it in Cloudflare). Never logged or echoed. */
  BRAVE_API_KEY?: string;
  /** Var: Brave requests a UTC day (default 40; "0" turns Brave off). */
  BRAVE_DAILY?: string;
}

/** `GET /categories/:id/top/:platform`: Brave's results merged with the stored list (`source: "brave"`), or the stored
 * list alone and why (`source: "scan"`). */
export interface TopAnswer {
  platform: BravePlatform;
  items: TopVideo[];
  source: "brave" | "scan";
  note?: "no_key" | "brave_failed" | "daily_cap";
  endpoint?: "videos" | "web";
}

type Reply = { status: number; body: unknown };

/** GET `url` as JSON within `timeoutMs`, body included: its status (0 when no answer came) and its body (null when it is
 * no JSON or no 2xx; a refused body is let go, so it does not hold one of the Worker's 6 connections). */
async function getJson(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Reply> {
  try {
    const out = await timed(timeoutMs, async (signal): Promise<Reply> => {
      const res = await doFetch(url, { signal, headers });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { status: res.status, body: null };
      }
      return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
    });
    return out ?? { status: 0, body: null };
  } catch {
    return { status: 0, body: null };
  }
}

const answered = (r: Reply): r is { status: number; body: Record<string, unknown> } =>
  r.status >= 200 && r.status < 300 && isRecord(r.body);

/** Text as shown: one line, without bidi marks, clipped; "" for anything else. */
const text = (x: unknown, max: number) =>
  typeof x === "string" ? (clip(cleanText(x), max) as string) : "";

function withParams(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** The most viewed first; a count nobody showed after every known one, in the order found (the sort is stable). */
const byViews = (a: TopVideo, b: TopVideo) => (b.views ?? -1) - (a.views ?? -1);

const isHttps = (x: unknown): x is string => typeof x === "string" && x.startsWith("https://");

/** One stored video, checked: [] when it has no https link or no title; an odd optional field is left out. */
function storedVideo(x: unknown): TopVideo[] {
  if (!isRecord(x) || !isHttps(x.url) || typeof x.title !== "string") return [];
  const views = ytCount(x.views);
  return [
    {
      url: x.url,
      title: x.title,
      ...(typeof x.creator === "string" && x.creator ? { creator: x.creator } : {}),
      ...(views !== undefined ? { views } : {}),
      ...(typeof x.publishedAt === "string" ? { publishedAt: x.publishedAt } : {}),
      ...(isHttps(x.thumbnail) ? { thumbnail: x.thumbnail } : {}),
    },
  ];
}

/**
 * A stored page's `top`, entry by entry (KV is untrusted, as the lessons are): a malformed entry is dropped alone,
 * a list that is no list is empty, ≤ 50 each. undefined for a page from before §6 or a `top` that is none.
 */
export function readTop(x: unknown): TopLists | undefined {
  if (!isRecord(x) || typeof x.updatedAt !== "string") return undefined;
  const list = (p: TopPlatform) =>
    (Array.isArray(x[p]) ? (x[p] as unknown[]) : []).flatMap(storedVideo).slice(0, TOP_MAX);
  return { updatedAt: x.updatedAt, yt: list("yt"), ig: list("ig"), tt: list("tt") };
}

/**
 * The stored Instagram or TikTok list: the scan's posts of that platform, each once. The ones more of the scan's
 * searches found come first, then in the order first seen (the searches' order, then Tavily's rank); ≤ 50.
 * `searchFamilies` keeps a post once a search, so a post's count is the number of searches that found it. The creator
 * is the handle the URL or the page text gave, when there is one; Tavily gives no views.
 */
export function scanTop(posts: readonly EffectPost[], platform: EffectPlatform): TopVideo[] {
  const seen = new Map<string, { post: EffectPost; found: number }>();
  for (const post of posts) {
    if (post.platform !== platform) continue;
    const known = seen.get(post.url);
    if (known) known.found++;
    else seen.set(post.url, { post, found: 1 });
  }
  // A Map keeps the order first seen, and the sort is stable.
  return [...seen.values()]
    .sort((x, y) => y.found - x.found)
    .slice(0, TOP_MAX)
    .map(({ post }) => ({
      url: post.url,
      title: post.title,
      ...(post.handle ? { creator: post.handle } : {}),
    }));
}

/**
 * YouTube's stored list: the most viewed videos of `q` (the category's main query) over the last 30 days, ≤ 50, the
 * most viewed first. Also the same videos as posts for the category's trends (§2: `posts`, in the same order), their
 * title and description the text and their channel the creator, the shape and clipping of Discover's YouTube cards
 * (discover/fetchers.ts `youtubeCall`). null without the key or when either call fails (the scan notes `youtube`);
 * empty lists when the search found nothing.
 */
export async function youtubeTop(
  env: { YOUTUBE_API_KEY?: string },
  doFetch: typeof fetch,
  q: string,
  now: Date,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<{ videos: TopVideo[]; posts: EffectPost[] } | null> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return null;
  const headers = { Accept: "application/json" };
  const found = await getJson(
    doFetch,
    withParams(YT_SEARCH_URL, {
      part: "snippet",
      type: "video",
      order: "viewCount",
      q,
      publishedAfter: new Date(now.getTime() - MONTH_MS).toISOString(),
      maxResults: String(TOP_MAX),
      relevanceLanguage: "en",
      safeSearch: "moderate",
      key,
    }),
    headers,
    timeoutMs,
  );
  if (!answered(found)) return null;
  const hits = Array.isArray(found.body.items) ? found.body.items : [];
  const ids = [
    ...new Set(
      hits.flatMap((it) => {
        const id = isRecord(it) && isRecord(it.id) ? it.id.videoId : undefined;
        return typeof id === "string" && VIDEO_ID.test(id) ? [id] : [];
      }),
    ),
  ].slice(0, TOP_MAX);
  if (!ids.length) return { videos: [], posts: [] };
  // One call for every id: the views to sort by, and the channel, title and description as YouTube writes them
  // (search.list's are HTML-escaped).
  const stats = await getJson(
    doFetch,
    withParams(YT_VIDEOS_URL, { part: "statistics,snippet", id: ids.join(","), key }),
    headers,
    timeoutMs,
  );
  if (!answered(stats)) return null;
  const items = (stats.body as YtListResponse).items;
  const list: { video: TopVideo; post: EffectPost }[] = (Array.isArray(items) ? items : [])
    .flatMap((v): { video: TopVideo; post: EffectPost }[] => {
      const title = text(v?.snippet?.title, TITLE_MAX);
      if (typeof v?.id !== "string" || !VIDEO_ID.test(v.id) || !title) return [];
      const url = `https://www.youtube.com/watch?v=${v.id}`;
      const creator = text(v.snippet?.channelTitle, NAME_MAX);
      const description = (v.snippet as { description?: unknown } | undefined)?.description;
      const views = ytCount(v.statistics?.viewCount);
      const publishedAt = v.snippet?.publishedAt;
      const thumbnail = ytThumb(v);
      return [
        {
          video: {
            url,
            title,
            ...(creator ? { creator } : {}),
            ...(views !== undefined ? { views } : {}),
            ...(typeof publishedAt === "string" ? { publishedAt } : {}),
            ...(thumbnail?.startsWith("https://") ? { thumbnail } : {}),
          },
          post: {
            platform: "yt",
            handle: creator,
            title,
            snippet: text(description, SNIPPET_MAX),
            url,
          },
        },
      ];
    })
    .sort((a, b) => byViews(a.video, b.video))
    .slice(0, TOP_MAX);
  return { videos: list.map((f) => f.video), posts: list.map((f) => f.post) };
}

/**
 * One Brave result as a top video of `platform`: [] unless its link is an https post of that platform (one post a
 * page, not a profile, tag or sound page; `meta_url.hostname` is the link's own host). The link is made canonical like
 * the Worker's other post links; the title loses the platform's wrapping (" | TikTok", "<name> on Instagram: …"), and
 * a TikTok title that says nothing gives way to its creator.
 */
function braveVideo(x: unknown, platform: BravePlatform): TopVideo[] {
  if (!isRecord(x) || typeof x.url !== "string") return [];
  let u: URL;
  try {
    u = new URL(x.url);
  } catch {
    return [];
  }
  if (
    u.protocol !== "https:" ||
    platformForHost(u.hostname) !== platform ||
    !isVideoUrl(platform, u)
  )
    return [];
  const video = isRecord(x.video) ? x.video : {};
  const author = isRecord(video.author) ? video.author : {};
  let creator = text(video.creator, NAME_MAX) || text(author.name, NAME_MAX);
  const raw = cleanText(typeof x.title === "string" ? x.title : "");
  let title: string;
  if (platform === "tt") {
    const t = cleanTikTokTitle(raw);
    creator ||= handleFromUrl("tt", u);
    title = isGenericTikTokTitle(t) ? creator : t;
  } else {
    const desc = cleanText(typeof x.description === "string" ? x.description : "");
    const card = instagramCard(handleFromUrl("ig", u), raw, desc);
    creator ||= card.handle;
    title = card.title;
  }
  title = text(title, TITLE_MAX);
  if (!title) return [];
  const views = ytCount(video.views);
  const thumbnail = isRecord(x.thumbnail) ? x.thumbnail.src : undefined;
  const age = text(x.age, AGE_MAX);
  return [
    {
      url: canonicalUrl(platform, u),
      title,
      ...(creator ? { creator } : {}),
      ...(views !== undefined ? { views } : {}),
      ...(isHttps(thumbnail) ? { thumbnail } : {}),
      ...(age ? { age } : {}),
    },
  ];
}

const results = (x: unknown): unknown[] =>
  isRecord(x) && Array.isArray(x.results) ? x.results : [];

/**
 * A TikTok or Instagram tab's list, asked when the page opens the tab: Brave's video search for the category's
 * main query on the platform's site over the last month, in English; a second page when the first left fewer than 50
 * matches. Its matches come first, the most viewed first, then the stored ones it lacks: ≤ 50. The video endpoint
 * refused (a 4xx other than 429: not in the plan) gives way to Brave's web search (its web and video results, 20 a
 * page, the same two pages). At most `BRAVE_DAILY` requests a UTC day, counted in KV (best-effort, as Discover's
 * YouTube counter); without the key, past the day's requests, or when Brave fails (429 included), the stored list with
 * why. Nothing Brave answered is written anywhere.
 */
export async function braveTop(
  env: TopEnv,
  doFetch: typeof fetch,
  g: Genre,
  platform: BravePlatform,
  stored: readonly TopVideo[],
  now: Date,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<TopAnswer> {
  const scan = (note: NonNullable<TopAnswer["note"]>): TopAnswer => ({
    platform,
    items: stored.slice(0, TOP_MAX),
    source: "scan",
    note,
  });
  const key = env.BRAVE_API_KEY;
  if (!key) return scan("no_key");
  const counter = braveCountKey(utcDay(now));
  let used = 0;
  try {
    used = Number(await env.SOCIAL_KV?.get(counter)) || 0;
  } catch {
    // A counter KV can't read never stops a search (the cap is best-effort).
  }
  const left = capVar(env.BRAVE_DAILY, BRAVE_DAILY) - used;
  if (left <= 0) return scan("daily_cap");
  const q = `${g.queries.en[0]} site:${PLATFORM_DOMAIN[platform]}`;
  const headers = { Accept: "application/json", "X-Subscription-Token": key };
  let made = 0;
  /** One endpoint's pages, its matches once each; or the first page's failure, its status (-1: the day's cap). A
   * second page that fails, or that the day has no request left for, keeps the first's. */
  const pages = async (
    endpoint: string,
    count: number,
    read: (body: Record<string, unknown>) => unknown[],
  ): Promise<TopVideo[] | number> => {
    const found = new Map<string, TopVideo>();
    for (let offset = 0; offset < 2 && found.size < TOP_MAX; offset++) {
      if (made >= left) return offset ? [...found.values()] : -1;
      made++;
      const params = {
        q,
        count: String(count),
        offset: String(offset),
        freshness: "pm",
        search_lang: "en",
        safesearch: "moderate",
      };
      const r = await getJson(doFetch, withParams(endpoint, params), headers, timeoutMs);
      if (!answered(r)) {
        if (offset) break;
        return r.status;
      }
      for (const v of read(r.body).flatMap((x) => braveVideo(x, platform)))
        if (!found.has(v.url)) found.set(v.url, v);
    }
    return [...found.values()];
  };
  let endpoint: NonNullable<TopAnswer["endpoint"]> = "videos";
  let found = await pages(BRAVE_VIDEOS_URL, TOP_MAX, results);
  if (typeof found === "number" && found >= 400 && found < 500 && found !== 429) {
    endpoint = "web";
    found = await pages(BRAVE_WEB_URL, WEB_COUNT, (b) => [...results(b.web), ...results(b.videos)]);
  }
  try {
    if (made)
      await env.SOCIAL_KV?.put(counter, String(used + made), { expirationTtl: COUNTER_TTL_S });
  } catch {
    // Best-effort, as reading it.
  }
  if (typeof found === "number") return scan(found === -1 ? "daily_cap" : "brave_failed");
  const brave = found.sort(byViews);
  const shown = new Set(brave.map((v) => v.url));
  return {
    platform,
    items: [...brave, ...stored.filter((v) => !shown.has(v.url))].slice(0, TOP_MAX),
    source: "brave",
    endpoint,
  };
}
