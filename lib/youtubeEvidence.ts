import type { DiscoverItem, DiscoverSourceEvidence } from "./discover";
import { discoverPostKey } from "./discoverFeed";
import { youtubeStatsUrl, YOUTUBE_STATS_MAX_IDS } from "./research";

export interface YoutubeSource {
  url: string;
  title: string;
  description: string;
  author: string;
  profile?: string;
  evidence: DiscoverSourceEvidence;
}
export type YoutubeSources = Record<string, YoutubeSource>;
const TIMEOUT_MS = 6000;
const MAX_REPLY_BYTES = 1024 * 1024;
const CACHE_MAX = 500;
const SOURCE_TTL_MS = 6 * 60 * 60_000;
const UNKNOWN_TTL_MS = 15 * 60_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
type Entry = { source: YoutubeSource | null; checkedAt: number; expiresAt: number };
/** Memory only: a configured API key never enters an export, source record or localStorage cache. */
const cache = new Map<string, Entry>();
const cacheKey = (key: string, id: string) => JSON.stringify([key, id]);
export function resetYoutubeEvidenceCache(): void {
  cache.clear();
}

function remember(key: string, entry: Entry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function count(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}
function date(value: unknown, now: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now + CLOCK_SKEW_MS
    ? new Date(parsed).toISOString()
    : undefined;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length")) > MAX_REPLY_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REPLY_BYTES) return undefined;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function parseYoutubeSource(
  value: unknown,
  requested: ReadonlySet<string>,
  now: number,
): YoutubeSource | null {
  if (!record(value) || typeof value.id !== "string" || !requested.has(value.id)) return null;
  const status = record(value.status) ? value.status : {};
  const unavailable =
    status.privacyStatus === "private" ||
    status.uploadStatus === "deleted" ||
    status.uploadStatus === "rejected";
  const snippet = record(value.snippet) ? value.snippet : {};
  if (
    !unavailable &&
    (typeof snippet.title !== "string" ||
      typeof snippet.description !== "string" ||
      typeof snippet.channelTitle !== "string")
  )
    return null;
  const title = typeof snippet.title === "string" ? snippet.title.slice(0, 1000) : "";
  const description =
    typeof snippet.description === "string" ? snippet.description.slice(0, 6000) : "";
  const author = typeof snippet.channelTitle === "string" ? snippet.channelTitle.slice(0, 200) : "";
  const channel =
    typeof snippet.channelId === "string" && CHANNEL_ID.test(snippet.channelId)
      ? snippet.channelId
      : undefined;
  const stats = record(value.statistics) ? value.statistics : {};
  const views = count(stats.viewCount);
  const likes = count(stats.likeCount);
  const published = date(snippet.publishedAt, now);
  return {
    url: `https://www.youtube.com/watch?v=${value.id}`,
    title,
    description,
    author,
    ...(channel ? { profile: `https://www.youtube.com/channel/${channel}` } : {}),
    evidence: {
      source: "youtube-api",
      observedAt: new Date(now).toISOString(),
      caption: `${title} ${description}`.trim().slice(0, 4000),
      author,
      ...(views !== undefined ? { views } : {}),
      ...(likes !== undefined ? { likes } : {}),
      ...(published ? { published } : {}),
      ...(unavailable ? { availability: "unavailable" } : {}),
    },
  };
}

/** Share sources parsed from an official videos.list reply with the card hydrator. Memory only.
 * Callers must use parseYoutubeSource on the bounded official response, never an indexed item. */
export function primeYoutubeEvidence(
  apiKey: string,
  sources: readonly YoutubeSource[],
  now = Date.now(),
): void {
  const key = apiKey.trim();
  if (!key || !Number.isFinite(now)) return;
  for (const source of sources) {
    const id = new URL(source.url).searchParams.get("v");
    const observed = Date.parse(source.evidence.observedAt);
    if (
      !id ||
      !VIDEO_ID.test(id) ||
      source.url !== `https://www.youtube.com/watch?v=${id}` ||
      source.evidence.source !== "youtube-api" ||
      !Number.isFinite(observed) ||
      observed > now + CLOCK_SKEW_MS ||
      now - observed >= SOURCE_TTL_MS
    )
      continue;
    const stored = cache.get(cacheKey(key, id));
    if (stored && stored.checkedAt > observed) continue;
    remember(cacheKey(key, id), {
      source: structuredClone(source),
      checkedAt: observed,
      expiresAt: observed + SOURCE_TTL_MS,
    });
  }
}

/** One read-only official videos.list batch for already retrieved IDs, never another video search.
 * With no existing dashboard key this is a no-op. Missing IDs and failed responses stay unknown. */
export async function fetchYoutubeEvidence(
  items: readonly Pick<DiscoverItem, "platform" | "url">[],
  apiKey: string | undefined,
  options: { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal } = {},
): Promise<YoutubeSources> {
  const key = apiKey?.trim();
  const result: YoutubeSources = {};
  if (!key || options.signal?.aborted) return result;
  const clock = options.now ?? Date.now;
  const startedAt = clock();
  if (!Number.isFinite(startedAt)) return result;
  for (const [key, entry] of cache) if (entry.expiresAt <= startedAt) cache.delete(key);
  const requested = new Map<string, string>();
  for (const item of items) {
    if (item.platform !== "yt") continue;
    const url = discoverPostKey("yt", item.url);
    const id = url && new URL(url).searchParams.get("v");
    if (url && id && VIDEO_ID.test(id)) requested.set(id, url);
  }
  const missing: string[] = [];
  for (const [id, url] of requested) {
    const hit = cache.get(cacheKey(key, id));
    if (hit && hit.expiresAt > startedAt && hit.checkedAt <= startedAt + CLOCK_SKEW_MS) {
      if (hit.source) result[url] = hit.source;
    } else if (missing.length < YOUTUBE_STATS_MAX_IDS) missing.push(id);
  }
  if (!missing.length) return result;
  const url = new URL(youtubeStatsUrl(key, missing));
  url.searchParams.set("part", "snippet,statistics,status");
  // Limit response size and omit fields we neither show nor evaluate.
  url.searchParams.set(
    "fields",
    "items(id,snippet(title,description,channelTitle,channelId,publishedAt),statistics(viewCount,likeCount),status(privacyStatus,uploadStatus))",
  );
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const deadline = new Promise<undefined>((resolve) => {
      const end = () => {
        controller.abort();
        resolve(undefined);
      };
      timer = setTimeout(end, TIMEOUT_MS);
      onAbort = end;
      options.signal?.addEventListener("abort", end, { once: true });
    });
    const pending = (options.fetch ?? fetch)(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(boundedJson)
      .catch(() => undefined);
    const body = await Promise.race([pending, deadline]);
    if (options.signal?.aborted || !record(body) || !Array.isArray(body.items)) return result;
    const observedAt = clock();
    if (!Number.isFinite(observedAt)) return result;
    const ids = new Set(missing);
    const sources = new Map<string, YoutubeSource>();
    for (const item of body.items) {
      const source = parseYoutubeSource(item, ids, observedAt);
      if (source) sources.set(new URL(source.url).searchParams.get("v")!, source);
    }
    for (const id of missing) {
      const source = sources.get(id) ?? null;
      remember(cacheKey(key, id), {
        source,
        checkedAt: observedAt,
        expiresAt: observedAt + (source ? SOURCE_TTL_MS : UNKNOWN_TTL_MS),
      });
      if (source) result[source.url] = source;
    }
    return result;
  } catch {
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Replace indexed fields only with evidence bound to this exact ID. A stale API cache cannot roll back a newer source. */
export function applyYoutubeEvidence(item: DiscoverItem, source?: YoutubeSource): DiscoverItem {
  if (
    item.platform !== "yt" ||
    !source ||
    source.evidence.source !== "youtube-api" ||
    discoverPostKey("yt", source.url) !== discoverPostKey("yt", item.url) ||
    !discoverPostKey("yt", item.url)
  )
    return item;
  const nextTime = Date.parse(source.evidence.observedAt);
  if (
    !Number.isFinite(nextTime) ||
    (item.evidence?.source === "youtube-api" && Date.parse(item.evidence.observedAt) >= nextTime)
  )
    return item;
  const { likes, views } = source.evidence;
  return {
    ...item,
    title: source.title || item.title,
    snippet: source.description,
    handle: source.author || item.handle,
    ...(source.profile ? { profile: source.profile } : {}),
    ...(source.evidence.published ? { published: source.evidence.published } : {}),
    stats:
      likes === undefined && views === undefined
        ? undefined
        : {
            ...(likes !== undefined ? { likes } : {}),
            ...(views !== undefined ? { views } : {}),
          },
    evidence: source.evidence,
  };
}
