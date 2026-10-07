/**
 * Top videos per platform on a category page (planning/tools/19-category-trends.md §6). The owner: "Every category
 * should show at least 50 results in every platform with top tier results".
 * - YouTube, stored with the page: the category's main query by views over the last 30 days, one `search.list` and
 *   one `videos.list` on the cron's scans and a category's first top scan only (Scan again keeps the stored list),
 *   outside Discover's `DISCOVER_YT_CAP` (66 since §6: 18 + 6 + 66 + 4 cron scans = 94 of the 100 a day).
 * - Instagram and TikTok, stored: the scan's own Tavily posts, the ones more searches found first.
 * - On demand for TikTok and Instagram (`GET /categories/:id/top/:platform`): Brave's Search API, its matches in their
 *   own group as Brave gave them, beside the stored list. Brave's terms: "shall not store, cache, or create a database
 *   of Search Results, in whole or in part, other than transient storage required for operation". Its results are
 *   never written: the only KV write is the day's request counter.
 */

import { CALL_TIMEOUT_MS, capVar, timed } from "../discover/fetchers";
import { clip, isRecord } from "../effects/ai";
import type { EffectsEnv } from "../effects/sources";
import type { EffectPlatform, EffectPost } from "../effects/types";
import {
  canonicalUrl,
  cleanText,
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

/** `GET /categories/:id/top/:platform`: the stored list (`scan`) and Brave's own group (`brave`, `source: "brave"`), or
 * the stored list alone and why (`source: "scan"`). `stats`, with Brave's group only, says what Brave sent (its raw
 * results across pages and sections, and how many came from each of the 8 most seen hosts), for the live checks; the
 * dashboard ignores it. */
export interface TopAnswer {
  platform: BravePlatform;
  scan: TopVideo[];
  brave: TopVideo[];
  source: "brave" | "scan";
  note?: "no_key" | "brave_failed" | "daily_cap";
  endpoint?: "videos" | "web";
  stats?: { raw: number; hosts: Record<string, number> };
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
      const snippet = v.snippet as { description?: unknown; channelId?: unknown } | undefined;
      const description = snippet?.description;
      // The trends count a channel by its id: two channels may share a name. The list shows the name.
      const channel = typeof snippet?.channelId === "string" ? snippet.channelId : "";
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
            handle: channel,
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
 * One Brave result as a top video of `platform`, as Brave gave it (its title only clipped for display, its creator,
 * views, thumbnail and age as sent): [] unless its link is an https post of that platform (one post a page, not a
 * profile, tag or sound page; `meta_url.hostname` is the link's own host) with a title. The link is made canonical
 * only to dedupe it against the stored list and so the app's player can play it.
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
  const title = typeof x.title === "string" ? (clip(x.title, TITLE_MAX) as string) : "";
  if (!title) return [];
  const video = isRecord(x.video) ? x.video : {};
  const author = isRecord(video.author) ? video.author : {};
  const creator = text(video.creator, NAME_MAX) || text(author.name, NAME_MAX);
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

/** One of Brave's endpoints: its page size, the most pages a tab asks, and its answer's sections of results, in the
 * order they are shown. */
type Endpoint = {
  name: NonNullable<TopAnswer["endpoint"]>;
  url: string;
  count: number;
  pages: number;
  sections: (body: Record<string, unknown>) => unknown[][];
};
/** First: the web search honours `site:`. Its own results, then its video results (sections never interleaved). */
const WEB: Endpoint = {
  name: "web",
  url: BRAVE_WEB_URL,
  count: WEB_COUNT,
  pages: 3,
  sections: (b) => [results(b.web), results(b.videos)],
};
/** The fallback: live, it matched no TikTok or Instagram post (it seems to ignore `site:`). */
const VIDEOS: Endpoint = {
  name: "videos",
  url: BRAVE_VIDEOS_URL,
  count: TOP_MAX,
  pages: 2,
  sections: (b) => [results(b)],
};
/** The web search's answers that mean "not in the plan": the video search instead (401 is a bad key: no fallback). */
const NOT_IN_PLAN = new Set([403, 404, 422]);
const HOSTS_MAX = 8;

/** How many of the raw results came from each host, the 8 most seen first (ties as first seen); a result whose link
 * does not parse counts for none. */
function hostCounts(raw: unknown[]): Record<string, number> {
  const n = new Map<string, number>();
  for (const x of raw) {
    if (!isRecord(x) || typeof x.url !== "string") continue;
    try {
      const host = new URL(x.url).hostname;
      n.set(host, (n.get(host) ?? 0) + 1);
    } catch {
      // No link: counted in `raw` alone.
    }
  }
  return Object.fromEntries([...n].sort((a, b) => b[1] - a[1]).slice(0, HOSTS_MAX));
}

/**
 * A TikTok or Instagram tab's list, asked when the page opens the tab: the stored list (`scan`) and, apart, Brave's
 * matches (`brave`) in Brave's own order, as Brave gave them (Brave's terms bar modifying results): never sorted,
 * never interleaved, the posts the stored list already holds left out, 50 in all. Brave's web search for the
 * category's main query on the platform's site over the last month, in English: its web results, then its video
 * results, up to 3 pages of 20; another page only when the last had 20 web results, Brave has more and fewer than
 * needed matched. The web search refused with 403, 404 or 422 (not in the plan) gives way to Brave's video search (50
 * a page, up to 2 pages, the same rules), which live matched no TikTok or Instagram post. At most `BRAVE_DAILY`
 * requests a UTC day, counted in KV: 3 (or what is left) reserved before the first request and corrected after
 * (best-effort, as Discover's YouTube counter, over-counting when two opens overlap). Without the key or with
 * `BRAVE_DAILY` "0" (`no_key`), past the day's requests (`daily_cap`), or when Brave fails (`brave_failed`: 401 and
 * 429 included), the stored list alone. Nothing Brave answered is written anywhere: `stats` is in the answer only.
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
  const scan = stored.slice(0, TOP_MAX);
  const alone = (note: NonNullable<TopAnswer["note"]>): TopAnswer => ({
    platform,
    scan,
    brave: [],
    source: "scan",
    note,
  });
  const key = env.BRAVE_API_KEY;
  const daily = capVar(env.BRAVE_DAILY, BRAVE_DAILY);
  if (!key || !daily) return alone("no_key");
  const counter = braveCountKey(utcDay(now));
  let used = 0;
  try {
    used = Number(await env.SOCIAL_KV?.get(counter)) || 0;
  } catch {
    // A counter KV can't read never stops a search (the cap is best-effort).
  }
  const left = daily - used;
  if (left <= 0) return alone("daily_cap");
  const count = async (n: number) => {
    try {
      await env.SOCIAL_KV?.put(counter, String(used + n), { expirationTtl: COUNTER_TTL_S });
    } catch {
      // Best-effort, as reading it.
    }
  };
  const planned = Math.min(3, left);
  await count(planned);
  const q = `${g.queries.en[0]} site:${PLATFORM_DOMAIN[platform]}`;
  const headers = { Accept: "application/json", "X-Subscription-Token": key };
  const need = TOP_MAX - scan.length;
  let made = 0;
  /** An endpoint's matches, sections in order across its pages, each post once and none the stored list holds. */
  const matches = (e: Endpoint, bodies: Record<string, unknown>[]): TopVideo[] => {
    const seen = new Set(scan.map((v) => v.url));
    const sections = bodies.map(e.sections);
    return (sections[0] ?? [])
      .flatMap((_, s) => sections.flatMap((page) => page[s]))
      .flatMap((x) => braveVideo(x, platform))
      .filter((v) => {
        if (seen.has(v.url)) return false;
        seen.add(v.url);
        return true;
      });
  };
  /** An endpoint's answered pages, or the first page's failure, its status (-1: the day has no request left for it). */
  const ask = async (e: Endpoint): Promise<Record<string, unknown>[] | number> => {
    const bodies: Record<string, unknown>[] = [];
    for (let offset = 0; offset < e.pages; offset++) {
      if (made >= left) return offset ? bodies : -1;
      made++;
      const params = {
        q,
        count: String(e.count),
        offset: String(offset),
        freshness: "pm",
        search_lang: "en",
        safesearch: "moderate",
      };
      const r = await getJson(doFetch, withParams(e.url, params), headers, timeoutMs);
      if (!answered(r)) {
        // A later page that fails keeps the ones before.
        if (offset) break;
        return r.status;
      }
      bodies.push(r.body);
      const full = e.sections(r.body)[0].length >= e.count;
      const more = !isRecord(r.body.query) || r.body.query.more_results_available !== false;
      if (!full || !more || matches(e, bodies).length >= need) break;
    }
    return bodies;
  };
  let served = WEB;
  let found = await ask(WEB);
  if (typeof found === "number" && NOT_IN_PLAN.has(found)) {
    served = VIDEOS;
    found = await ask(VIDEOS);
  }
  if (made !== planned) await count(made);
  if (typeof found === "number") return alone(found === -1 ? "daily_cap" : "brave_failed");
  const raw = found.flatMap(served.sections).flat();
  return {
    platform,
    scan,
    brave: matches(served, found).slice(0, Math.max(0, need)),
    source: "brave",
    endpoint: served.name,
    stats: { raw: raw.length, hosts: hostCounts(raw) },
  };
}
