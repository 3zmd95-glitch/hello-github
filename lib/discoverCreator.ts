import type { DiscoverItem } from "./discover";
import { discoverPostKey } from "./discoverFeed";
import {
  applyYoutubeEvidence,
  parseYoutubeSource,
  primeYoutubeEvidence,
  type YoutubeSource,
} from "./youtubeEvidence";

export const YOUTUBE_CREATOR_MAX_UPLOADS = 12;
export const YOUTUBE_CREATOR_CACHE_MS = 15 * 60_000;
const MAX_CACHE = 64;
const MAX_REPLY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 6000;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const VIDEO_ID = /^[\w-]{11}$/;
const API = "https://www.googleapis.com/youtube/v3/";
export interface YoutubeCreatorSeed {
  url: string;
  channelId: string;
  profile: string;
  author: string;
}
export type YoutubeCreatorError =
  "missing_key" | "invalid_seed" | "auth" | "quota" | "network" | "unavailable" | "cancelled";
export type YoutubeCreatorStage = "seed" | "channel" | "uploads" | "videos";
export type YoutubeCreatorResult =
  | {
      ok: true;
      channel: { id: string; profile: string; author: string };
      items: DiscoverItem[];
      examined: number;
      omitted: number;
      cached: boolean;
      checkedAt: string;
      requests: number;
    }
  | { ok: false; error: YoutubeCreatorError; stage: YoutubeCreatorStage; requests: number };
type Cached = {
  channel: { id: string; profile: string; author: string };
  items: DiscoverItem[];
  seeds: Set<string>;
  examined: number;
  checkedAt: string;
  until: number;
};
/** Keys and verified video/channel bindings live only in this bounded memory cache, never the library. */
const cache = new Map<string, Cached>();
export function resetYoutubeCreatorCache(): void {
  cache.clear();
}

function channelId(profile: string | undefined): string | null {
  if (!profile || /[\\\u0000-\u0020\u007f]/.test(profile)) return null;
  try {
    const parsed = new URL(profile);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !["youtube.com", "www.youtube.com"].includes(parsed.hostname) ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const id = parsed.pathname.match(/^\/channel\/([^/]+)\/?$/)?.[1];
    return id && CHANNEL_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}
/** UI eligibility only. Expansion verifies video -> channel with official source data before following it. */
export function youtubeCreatorSeed(
  item: DiscoverItem,
  now = Date.now(),
): YoutubeCreatorSeed | null {
  if (
    item.platform !== "yt" ||
    item.evidence?.source !== "youtube-api" ||
    item.evidence.availability === "unavailable"
  )
    return null;
  const observed = Date.parse(item.evidence.observedAt),
    channel = channelId(item.profile);
  const url = discoverPostKey("yt", item.url);
  const id = url && new URL(url).searchParams.get("v");
  if (
    !channel ||
    !url ||
    !id ||
    !VIDEO_ID.test(id) ||
    !Number.isFinite(observed) ||
    observed <= 0 ||
    !Number.isFinite(now) ||
    observed > now + 300000
  )
    return null;
  return {
    url,
    channelId: channel,
    profile: `https://www.youtube.com/channel/${channel}`,
    author: item.evidence.author ?? item.handle,
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
class CreatorFailure extends Error {
  constructor(readonly code: YoutubeCreatorError) {
    super(code);
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_REPLY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new CreatorFailure("unavailable");
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REPLY_BYTES) throw new CreatorFailure("unavailable");
      text += decoder.decode(chunk.value, { stream: true });
    }
    try {
      return JSON.parse(text + decoder.decode());
    } catch {
      throw new CreatorFailure("unavailable");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
function httpError(status: number, body: unknown): YoutubeCreatorError {
  const error = record(body) && record(body.error) ? body.error : {};
  const reasons = Array.isArray(error.errors)
    ? error.errors.flatMap((entry) =>
        record(entry) && typeof entry.reason === "string" ? [entry.reason] : [],
      )
    : [];
  if (
    status === 429 ||
    error.status === "RESOURCE_EXHAUSTED" ||
    reasons.some((reason) =>
      [
        "quotaExceeded",
        "dailyLimitExceeded",
        "rateLimitExceeded",
        "userRateLimitExceeded",
      ].includes(reason),
    )
  )
    return "quota";
  if (
    status === 401 ||
    status === 403 ||
    reasons.some((reason) =>
      ["keyInvalid", "authError", "accessNotConfigured", "ipRefererBlocked"].includes(reason),
    )
  )
    return "auth";
  return "unavailable";
}
async function readApi(
  endpoint: "videos" | "channels" | "playlistItems",
  params: Record<string, string>,
  apiKey: string,
  doFetch: typeof fetch,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const url = new URL(endpoint, API);
  for (const [key, value] of Object.entries({ ...params, key: apiKey }))
    url.searchParams.set(key, value);
  const controller = new AbortController();
  const stopped = Promise.withResolvers<never>();
  const end = () => {
    controller.abort();
    stopped.reject(new CreatorFailure(signal?.aborted ? "cancelled" : "network"));
  };
  const timer = setTimeout(end, TIMEOUT_MS);
  signal?.addEventListener("abort", end, { once: true });
  try {
    if (signal?.aborted) throw new CreatorFailure("cancelled");
    const pending = doFetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      let body: unknown;
      try {
        body = await boundedJson(response);
      } catch (error) {
        if (!response.ok) throw new CreatorFailure(httpError(response.status, undefined));
        throw error;
      }
      if (!response.ok || (record(body) && body.error))
        throw new CreatorFailure(httpError(response.status, body));
      if (!record(body) || !Array.isArray(body.items)) throw new CreatorFailure("unavailable");
      return body;
    });
    return await Promise.race([pending, stopped.promise]);
  } catch (error) {
    if (signal?.aborted) throw new CreatorFailure("cancelled");
    throw error instanceof CreatorFailure ? error : new CreatorFailure("network");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", end);
  }
}
const VIDEO_FIELDS =
  "items(id,snippet(title,description,channelTitle,channelId,publishedAt,thumbnails(default(url),medium(url),high(url))),statistics(viewCount,likeCount),status(privacyStatus,uploadStatus))";
function publicSource(value: unknown, ids: ReadonlySet<string>, now: number): YoutubeSource | null {
  if (
    !record(value) ||
    !record(value.status) ||
    value.status.privacyStatus !== "public" ||
    value.status.uploadStatus !== "processed"
  )
    return null;
  return parseYoutubeSource(value, ids, now);
}
function thumb(value: unknown, id: string): string {
  const snippet = record(value) && record(value.snippet) ? value.snippet : {};
  const thumbnails = record(snippet.thumbnails) ? snippet.thumbnails : {};
  for (const size of ["high", "medium", "default"]) {
    const row = thumbnails[size];
    if (!record(row) || typeof row.url !== "string") continue;
    try {
      const url = new URL(row.url);
      if (
        url.protocol === "https:" &&
        url.hostname === "i.ytimg.com" &&
        !url.port &&
        !url.username &&
        !url.password &&
        (url.pathname.startsWith(`/vi/${id}/`) || url.pathname.startsWith(`/vi_webp/${id}/`))
      )
        return url.toString();
    } catch {
      /* Use the established exact-video thumbnail below. */
    }
  }
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** One explicit uploads-page acquisition; never search.list, pagination, retry, or inference. */
export async function expandYoutubeCreator(
  item: DiscoverItem,
  apiKey: string | undefined,
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    signal?: AbortSignal;
    lang?: "ar" | "en";
  } = {},
): Promise<YoutubeCreatorResult> {
  let stage: YoutubeCreatorStage = "seed",
    requests = 0;
  const fail = (error: YoutubeCreatorError): YoutubeCreatorResult => ({
    ok: false,
    error,
    stage,
    requests,
  });
  if (options.signal?.aborted) return fail("cancelled");
  const key = apiKey?.trim();
  if (!key) return fail("missing_key");
  const clock = options.now ?? Date.now,
    now = clock(),
    seed = youtubeCreatorSeed(item, now);
  if (!seed) return fail("invalid_seed");
  const id = new URL(seed.url).searchParams.get("v")!;
  const cacheKey = JSON.stringify([key, seed.channelId]);
  for (const [key, entry] of cache)
    if (entry.until <= now || Date.parse(entry.checkedAt) > now + 300000) cache.delete(key);
  const result = (entry: Cached, cached: boolean): YoutubeCreatorResult => {
    const items = entry.items.filter((entry) => entry.url !== seed.url);
    return {
      ok: true,
      channel: structuredClone(entry.channel),
      items: structuredClone(items),
      examined: entry.examined,
      omitted: Math.max(0, entry.examined - items.length),
      cached,
      checkedAt: entry.checkedAt,
      requests,
    };
  };
  const cached = cache.get(cacheKey);
  if (cached?.seeds.has(id)) return result(cached, true);
  const read = (
    endpoint: "videos" | "channels" | "playlistItems",
    params: Record<string, string>,
  ) => {
    if (options.signal?.aborted) throw new CreatorFailure("cancelled");
    requests++;
    return readApi(endpoint, params, key, options.fetch ?? fetch, options.signal);
  };
  try {
    const verified = await read("videos", {
      part: "snippet,statistics,status",
      id,
      fields: VIDEO_FIELDS,
    });
    const seedSource = (verified.items as unknown[])
      .map((raw) => publicSource(raw, new Set([id]), clock()))
      .find((source) => !!source);
    if (!seedSource?.profile) return fail("unavailable");
    if (seedSource.profile !== seed.profile) return fail("invalid_seed");
    primeYoutubeEvidence(key, [seedSource], clock());
    if (cached && cached.until > clock()) {
      if (cached.seeds.size >= 64) cached.seeds.delete(cached.seeds.values().next().value!);
      cached.seeds.add(id);
      return result(cached, true);
    }
    stage = "channel";
    const channels = await read("channels", {
      part: "contentDetails",
      id: seed.channelId,
      fields: "items(id,contentDetails(relatedPlaylists(uploads)))",
    });
    const channel = (channels.items as unknown[]).find(
      (row) => record(row) && row.id === seed.channelId,
    );
    const content = record(channel) && record(channel.contentDetails) ? channel.contentDetails : {};
    const playlists = record(content.relatedPlaylists) ? content.relatedPlaylists : {};
    const uploads = playlists.uploads;
    if (typeof uploads !== "string" || !/^[\w-]{10,100}$/.test(uploads)) return fail("unavailable");
    stage = "uploads";
    const page = await read("playlistItems", {
      part: "contentDetails",
      playlistId: uploads,
      maxResults: String(YOUTUBE_CREATOR_MAX_UPLOADS),
      fields: "items(contentDetails(videoId))",
    });
    const rows = (page.items as unknown[]).slice(0, YOUTUBE_CREATOR_MAX_UPLOADS);
    const ids = [
      ...new Set(
        rows.flatMap((row) => {
          const details = record(row) && record(row.contentDetails) ? row.contentDetails : {};
          return typeof details.videoId === "string" && VIDEO_ID.test(details.videoId)
            ? [details.videoId]
            : [];
        }),
      ),
    ];
    const items: DiscoverItem[] = [],
      sources: YoutubeSource[] = [];
    if (ids.length) {
      stage = "videos";
      const videos = await read("videos", {
        part: "snippet,statistics,status",
        id: ids.join(","),
        fields: VIDEO_FIELDS,
      });
      const requested = new Set(ids),
        seen = new Set<string>();
      for (const row of videos.items as unknown[]) {
        const source = publicSource(row, requested, clock());
        if (!source || source.profile !== seed.profile || seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push(source);
        const videoId = new URL(source.url).searchParams.get("v")!;
        items.push(
          applyYoutubeEvidence(
            {
              platform: "yt",
              url: source.url,
              handle: "",
              title: "",
              snippet: "",
              lang: /[\u0600-\u06ff]/.test(source.title + source.description) ? "ar" : "en",
              section: "example",
              thumb: thumb(row, videoId),
            },
            source,
          ),
        );
      }
      // Preserve uploads-page order; videos.list need not return the requested IDs in that order.
      items.sort(
        (a, b) =>
          ids.indexOf(new URL(a.url).searchParams.get("v")!) -
          ids.indexOf(new URL(b.url).searchParams.get("v")!),
      );
    }
    if (options.signal?.aborted) return fail("cancelled");
    const checked = clock();
    if (!Number.isFinite(checked)) return fail("unavailable");
    primeYoutubeEvidence(key, sources, checked);
    const entry: Cached = {
      channel: { id: seed.channelId, profile: seed.profile, author: seedSource.author },
      items,
      seeds: new Set([id, ...sources.map((source) => new URL(source.url).searchParams.get("v")!)]),
      examined: rows.length,
      checkedAt: new Date(checked).toISOString(),
      until: checked + YOUTUBE_CREATOR_CACHE_MS,
    };
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    return result(entry, false);
  } catch (error) {
    return fail(error instanceof CreatorFailure ? error.code : "network");
  }
}
