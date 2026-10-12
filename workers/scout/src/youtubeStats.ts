/**
 * YouTube view / like / comment counts for search cards (round 31, the "Most popular" sort): ONE
 * `videos.list?part=snippet,statistics` for every YouTube card. Moved out of scout.ts in round 33 so Discover v2
 * (discover/run.ts) uses it without an import cycle; scout.ts re-exports it.
 */

import { youtubeVideoId, type ScoutResult, type Stats } from "./normalize";
import { YT_VIDEOS_URL } from "./trends/youtube";

/** `videos.list` takes at most this many ids in one call. */
export const YT_STATS_MAX = 50;
/** The statistics call gives up after this long; the cards then stay without counts. */
export const STATS_TIMEOUT_MS = 2500;

/** Only fields requested from the exact-video response; counts are usually numeric strings. */
interface YtStatsReply {
  items?: {
    id?: unknown;
    statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown };
    snippet?: {
      title?: unknown;
      description?: unknown;
      channelTitle?: unknown;
      publishedAt?: unknown;
    };
  }[];
}

/** A count as the API sends it, as a whole number ≥ 0; undefined when it is missing (hidden likes) or odd. Brave's
 * views are read the same way (categories/top.ts). */
export function ytCount(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

export function youtubeStatsUrl(key: string, ids: readonly string[]): string {
  const u = new URL(YT_VIDEOS_URL);
  u.searchParams.set("part", "snippet,statistics");
  u.searchParams.set(
    "fields",
    "items(id,snippet(title,description,channelTitle,publishedAt),statistics(viewCount,likeCount,commentCount))",
  );
  u.searchParams.set("id", ids.slice(0, YT_STATS_MAX).join(","));
  u.searchParams.set("key", key);
  return u.toString();
}

/**
 * Give YouTube results their view, like and comment counts (round 31, the "Most popular" sort): ONE
 * `videos.list?part=snippet,statistics` for every YouTube card (at most {@link YT_STATS_MAX} ids, 1 quota unit,
 * one subrequest), only when `YOUTUBE_API_KEY` is set. It never fails the search: without the key, on
 * an HTTP error, a broken body or after `timeoutMs` the cards stay as they were. A count YouTube does
 * not send (hidden likes, comments off) is left out, and a card never gets an empty `stats`. Mutates
 * `results` in place. Statistics without a complete native text snippet remain counts only: they never certify
 * a search excerpt, author or date as native metadata.
 */
export async function enrichYoutubeStats(
  results: ScoutResult[],
  env: { YOUTUBE_API_KEY?: string },
  doFetch: typeof fetch,
  timeoutMs = STATS_TIMEOUT_MS,
): Promise<void> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return;
  const byId = new Map<string, ScoutResult>();
  for (const r of results) {
    if (r.platform !== "yt" || byId.size >= YT_STATS_MAX) continue;
    let id: string | undefined;
    try {
      id = youtubeVideoId(new URL(r.url));
    } catch {
      // Not a URL: the card just stays without counts.
    }
    if (id && !byId.has(id)) byId.set(id, r);
  }
  if (!byId.size) return;

  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(undefined);
    }, timeoutMs);
  });
  const ask = async (): Promise<YtStatsReply | undefined> => {
    const res = await doFetch(youtubeStatsUrl(key, [...byId.keys()]), {
      headers: { Accept: "application/json" },
      signal: ac.signal,
    });
    return res.ok ? ((await res.json()) as YtStatsReply) : undefined;
  };
  try {
    // The race also ends a call that ignores the abort signal; the body read is inside the limit.
    const reply = await Promise.race([ask().catch(() => undefined), timeout]);
    const items = Array.isArray(reply?.items) ? reply.items : [];
    for (const item of items) {
      const card = typeof item?.id === "string" ? byId.get(item.id) : undefined;
      if (!card) continue;
      const stats: Stats = {};
      const views = ytCount(item.statistics?.viewCount);
      const likes = ytCount(item.statistics?.likeCount);
      const comments = ytCount(item.statistics?.commentCount);
      if (views !== undefined) stats.views = views;
      if (likes !== undefined) stats.likes = likes;
      if (comments !== undefined) stats.comments = comments;
      const hasStats = Object.keys(stats).length > 0;
      if (hasStats) card.stats = stats;
      const snippet = item.snippet;
      if (
        typeof snippet?.title === "string" &&
        snippet.title.trim() &&
        typeof snippet.description === "string" &&
        typeof snippet.channelTitle === "string" &&
        snippet.channelTitle.trim()
      ) {
        const now = Date.now();
        const title = snippet.title.slice(0, 1000);
        const description = snippet.description.slice(0, 6000);
        const author = snippet.channelTitle.slice(0, 200);
        const date =
          typeof snippet.publishedAt === "string" ? Date.parse(snippet.publishedAt) : NaN;
        const published =
          Number.isFinite(date) && date > 0 && date <= now + 5 * 60_000
            ? new Date(date).toISOString()
            : undefined;
        card.title = title.slice(0, 160);
        card.snippet = description.slice(0, 220);
        card.handle = author;
        if (published) card.published = published;
        else delete card.published;
        if (!hasStats) delete card.stats;
        card.evidence = {
          source: "youtube-api",
          observedAt: new Date(now).toISOString(),
          caption: `${title}\n${description}`.trim().slice(0, 4000),
          author,
          ...(views !== undefined ? { views } : {}),
          ...(likes !== undefined ? { likes } : {}),
          ...(published ? { published } : {}),
        };
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
