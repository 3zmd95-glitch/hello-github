import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "./discover";
import {
  expandYoutubeCreator,
  resetYoutubeCreatorCache,
  youtubeCreatorSeed,
  YOUTUBE_CREATOR_CACHE_MS,
} from "./discoverCreator";
import {
  fetchYoutubeEvidence,
  parseYoutubeSource,
  primeYoutubeEvidence,
  resetYoutubeEvidenceCache,
} from "./youtubeEvidence";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const CHANNEL = "UCabcdefghijklmnopqrstuv";
const OTHER_CHANNEL = "UCzyxwvutsrqponmlkjihgfe";
const PLAYLIST = "UUabcdefghijklmnopqrstuv";
const SEED = "dyyF6YHbW6s";
const NEXT = "uL3SWSm97-I";
const THIRD = "NgFiMUG2fkQ";
const KEY = "existing-dashboard-key";
const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const seed = (id = SEED): DiscoverItem => ({
  platform: "yt",
  url: videoUrl(id),
  profile: `https://www.youtube.com/channel/${CHANNEL}`,
  title: "Indexed title",
  snippet: "Old search description",
  handle: "Indexed author",
  lang: "en",
  section: "example",
  evidence: { source: "youtube-api", observedAt: new Date(NOW).toISOString() },
});
const apiVideo = (id = SEED, channelId = CHANNEL) => ({
  id,
  snippet: {
    title: `Anime beat sync edit ${id}`,
    description: "An actual upload description",
    channelTitle: "Actual creator",
    channelId,
    publishedAt: "2026-10-01T10:00:00Z",
    thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq720.jpg` } },
  },
  statistics: { viewCount: "27800", likeCount: "1234" },
  status: { privacyStatus: "public", uploadStatus: "processed" },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const channels = () => ({
  items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: { uploads: PLAYLIST } } }],
});
const uploads = (ids: string[] = [SEED, NEXT, THIRD]) => ({
  nextPageToken: "must-not-be-followed",
  items: ids.map((id) => ({
    contentDetails: { videoId: id },
    snippet: { publishedAt: "2026-10-09T11:00:00Z" },
  })),
});
function sequence(
  bodies: (unknown | Response)[] = [
    { items: [apiVideo()] },
    channels(),
    uploads(),
    { items: [apiVideo(THIRD), apiVideo(), apiVideo(NEXT)] },
  ],
) {
  let next = 0;
  return vi.fn<typeof globalThis.fetch>(async () => {
    const body = bodies[next++];
    if (body === undefined) throw new Error("Unexpected additional request");
    return body instanceof Response ? body : json(body);
  });
}
const options = (fetch: typeof globalThis.fetch) => ({ fetch, now: () => NOW });
beforeEach(() => {
  resetYoutubeCreatorCache();
  resetYoutubeEvidenceCache();
});
afterEach(() => vi.useRealTimers());

describe("explicit official YouTube creator acquisition", () => {
  it("checks one uploads page with four list calls and grounds returned posts in exact native video records", async () => {
    const fetch = sequence();
    const result = await expandYoutubeCreator(seed(), KEY, options(fetch));
    expect(result).toMatchObject({
      ok: true,
      cached: false,
      examined: 3,
      omitted: 1,
      requests: 4,
      checkedAt: new Date(NOW).toISOString(),
      channel: { id: CHANNEL, profile: seed().profile, author: "Actual creator" },
    });
    if (!result.ok) throw new Error("Expected native uploads");
    expect(result.items.map((item) => item.url)).toEqual([videoUrl(NEXT), videoUrl(THIRD)]);
    expect(result.items[0]).toMatchObject({
      title: `Anime beat sync edit ${NEXT}`,
      snippet: "An actual upload description",
      handle: "Actual creator",
      profile: seed().profile,
      published: "2026-10-01T10:00:00.000Z",
      stats: { views: 27800, likes: 1234 },
      thumb: `https://i.ytimg.com/vi/${NEXT}/hq720.jpg`,
      evidence: {
        source: "youtube-api",
        observedAt: new Date(NOW).toISOString(),
        published: "2026-10-01T10:00:00.000Z",
        caption: `Anime beat sync edit ${NEXT} An actual upload description`,
      },
    });
    const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map((url) => url.origin + url.pathname)).toEqual([
      "https://www.googleapis.com/youtube/v3/videos",
      "https://www.googleapis.com/youtube/v3/channels",
      "https://www.googleapis.com/youtube/v3/playlistItems",
      "https://www.googleapis.com/youtube/v3/videos",
    ]);
    expect(urls[0].searchParams.get("id")).toBe(SEED);
    expect(urls[1].searchParams.get("id")).toBe(CHANNEL);
    expect(urls[2].searchParams.get("playlistId")).toBe(PLAYLIST);
    expect(urls[2].searchParams.get("maxResults")).toBe("12");
    expect(urls[3].searchParams.get("id")).toBe(`${SEED},${NEXT},${THIRD}`);
    for (const [url, init] of fetch.mock.calls) {
      expect(new URL(String(url)).searchParams.has("pageToken")).toBe(false);
      expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
    }
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("primes the existing card source cache so applying new uploads makes no fifth list call", async () => {
    const fetch = sequence();
    const result = await expandYoutubeCreator(seed(), KEY, options(fetch));
    if (!result.ok) throw new Error("Expected native uploads");
    const sources = await fetchYoutubeEvidence(result.items, KEY, options(fetch));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(Object.keys(sources)).toEqual([videoUrl(NEXT), videoUrl(THIRD)]);
    expect(sources[videoUrl(NEXT)].evidence.observedAt).toBe(new Date(NOW).toISOString());
    const otherKeyFetch = vi.fn<typeof globalThis.fetch>(async () => json({ items: [] }));
    await fetchYoutubeEvidence(result.items, "another-key", options(otherKeyFetch));
    expect(otherKeyFetch).toHaveBeenCalledOnce();
  });

  it("rejects missing native eligibility and unsupported profiles without any request", async () => {
    const fetch = sequence();
    for (const profile of [
      "https://www.youtube.com/@actualcreator",
      `https://youtube.com.evil.test/channel/${CHANNEL}`,
      `https://www.youtube.com/channel/${CHANNEL}?owner=1`,
      `https://evil@www.youtube.com/channel/${CHANNEL}`,
      `http://www.youtube.com/channel/${CHANNEL}`,
    ]) {
      expect(youtubeCreatorSeed({ ...seed(), profile }, NOW)).toBeNull();
      expect(await expandYoutubeCreator({ ...seed(), profile }, KEY, options(fetch))).toMatchObject(
        {
          ok: false,
          error: "invalid_seed",
          requests: 0,
        },
      );
    }
    expect(youtubeCreatorSeed({ ...seed(), evidence: undefined }, NOW)).toBeNull();
    expect(
      youtubeCreatorSeed(
        {
          ...seed(),
          evidence: { source: "indexed-excerpt", observedAt: new Date(NOW).toISOString() },
        },
        NOW,
      ),
    ).toBeNull();
    expect(await expandYoutubeCreator(seed(), undefined, options(fetch))).toMatchObject({
      ok: false,
      error: "missing_key",
      requests: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verifies the seed video and refuses a profile pointing at a different real channel", async () => {
    const fetch = sequence([{ items: [apiVideo(SEED, OTHER_CHANNEL)] }]);
    expect(await expandYoutubeCreator(seed(), KEY, options(fetch))).toEqual({
      ok: false,
      error: "invalid_seed",
      stage: "seed",
      requests: 1,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("omits unknown, private, unlisted, failed, foreign-channel and unsolicited video records", async () => {
    const ids = Array.from({ length: 13 }, (_, i) => String(i).padStart(11, "0"));
    const privateVideo = {
      ...apiVideo(ids[1]),
      status: { privacyStatus: "private", uploadStatus: "processed" },
    };
    const unlisted = {
      ...apiVideo(ids[2]),
      status: { privacyStatus: "unlisted", uploadStatus: "processed" },
    };
    const failed = {
      ...apiVideo(ids[3]),
      status: { privacyStatus: "public", uploadStatus: "failed" },
    };
    const fetch = sequence([
      { items: [apiVideo()] },
      channels(),
      uploads([ids[0], ids[0], ...ids.slice(1)]),
      {
        items: [
          apiVideo(ids[0]),
          privateVideo,
          unlisted,
          failed,
          apiVideo(ids[4], OTHER_CHANNEL),
          apiVideo(ids[12]),
          apiVideo(ids[0]),
        ],
      },
    ]);
    const result = await expandYoutubeCreator(seed(), KEY, options(fetch));
    expect(result).toMatchObject({ ok: true, examined: 12, omitted: 11, requests: 4 });
    if (!result.ok) throw new Error("Expected bounded result");
    expect(result.items.map((item) => item.url)).toEqual([videoUrl(ids[0])]);
    const requested = new URL(String(fetch.mock.calls[3][0])).searchParams.get("id")!.split(",");
    expect(requested).toEqual(ids.slice(0, 11));
    expect(result.items.every((item) => item.evidence?.availability !== "unavailable")).toBe(true);
  });

  it("does not substitute playlist-add dates, inferred counts, or unrelated thumbnails", async () => {
    const native = apiVideo(NEXT);
    native.snippet.publishedAt = "2030-10-09T10:00:00Z";
    native.statistics = { viewCount: "0", likeCount: "not-reported" };
    native.snippet.thumbnails.high.url = `https://i.ytimg.com/vi/${SEED}/hq720.jpg`;
    const fetch = sequence([
      { items: [apiVideo()] },
      channels(),
      uploads([NEXT]),
      { items: [native] },
    ]);
    const result = await expandYoutubeCreator(seed(), KEY, options(fetch));
    if (!result.ok) throw new Error("Expected native upload");
    expect(result.items[0].published).toBeUndefined();
    expect(result.items[0].evidence?.published).toBeUndefined();
    expect(result.items[0].stats).toEqual({ views: 0 });
    expect(result.items[0].thumb).toBe(`https://i.ytimg.com/vi/${NEXT}/hqdefault.jpg`);
  });

  it("distinguishes a valid empty uploads page from an invalid or inaccessible channel", async () => {
    const empty = sequence([{ items: [apiVideo()] }, channels(), uploads([])]);
    expect(await expandYoutubeCreator(seed(), KEY, options(empty))).toMatchObject({
      ok: true,
      items: [],
      examined: 0,
      omitted: 0,
      requests: 3,
    });
    resetYoutubeCreatorCache();
    const missing = sequence([{ items: [apiVideo()] }, { items: [] }]);
    expect(await expandYoutubeCreator(seed(), KEY, options(missing))).toEqual({
      ok: false,
      error: "unavailable",
      stage: "channel",
      requests: 2,
    });
  });
});

describe("verified creator cache", () => {
  it("reuses the same verified seed without requests and isolates returned mutations", async () => {
    const fetch = sequence();
    const first = await expandYoutubeCreator(seed(), KEY, options(fetch));
    if (!first.ok) throw new Error("Expected native uploads");
    first.items[0].title = "Caller mutation";
    const cached = await expandYoutubeCreator(seed(), KEY, options(fetch));
    expect(cached).toMatchObject({ ok: true, cached: true, requests: 0 });
    if (!cached.ok) throw new Error("Expected cached uploads");
    expect(cached.items[0].title).toBe(`Anime beat sync edit ${NEXT}`);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("uses the cache for already validated returned seeds and verifies unseen seeds before channel reuse", async () => {
    const fetch = sequence();
    await expandYoutubeCreator(seed(), KEY, options(fetch));
    const returnedSeed = await expandYoutubeCreator(seed(NEXT), KEY, options(fetch));
    expect(returnedSeed).toMatchObject({ ok: true, cached: true, requests: 0 });
    if (!returnedSeed.ok) throw new Error("Expected cached uploads");
    expect(returnedSeed.items.map((item) => item.url)).toEqual([videoUrl(SEED), videoUrl(THIRD)]);
    const unseen = "00000000009";
    const verify = sequence([{ items: [apiVideo(unseen)] }]);
    expect(await expandYoutubeCreator(seed(unseen), KEY, options(verify))).toMatchObject({
      ok: true,
      cached: true,
      requests: 1,
    });
    const wrongChannel = sequence([{ items: [apiVideo("00000000008", OTHER_CHANNEL)] }]);
    expect(await expandYoutubeCreator(seed("00000000008"), KEY, options(wrongChannel))).toEqual({
      ok: false,
      error: "invalid_seed",
      stage: "seed",
      requests: 1,
    });
  });

  it("expires after fifteen minutes and never shares verification across dashboard keys", async () => {
    await expandYoutubeCreator(seed(), KEY, options(sequence()));
    const otherKey = sequence();
    expect(
      await expandYoutubeCreator(seed(), "other-dashboard-key", options(otherKey)),
    ).toMatchObject({ ok: true, cached: false, requests: 4 });
    const expired = sequence();
    expect(
      await expandYoutubeCreator(seed(), KEY, {
        fetch: expired,
        now: () => NOW + YOUTUBE_CREATOR_CACHE_MS,
      }),
    ).toMatchObject({ ok: true, cached: false, requests: 4 });
  });

  it("labels source language independently of UI language and keeps that fact across cached switches", async () => {
    const nativeArabic = apiVideo(THIRD);
    nativeArabic.snippet.description = "شرح التعديل والمؤثرات";
    const fetch = sequence([
      { items: [apiVideo()] },
      channels(),
      uploads([NEXT, THIRD]),
      { items: [apiVideo(NEXT), nativeArabic] },
    ]);
    const first = await expandYoutubeCreator(seed(), KEY, { ...options(fetch), lang: "ar" });
    if (!first.ok) throw new Error("Expected native uploads");
    expect(first.items.map((item) => item.lang)).toEqual(["en", "ar"]);
    const cached = await expandYoutubeCreator(seed(), KEY, { ...options(fetch), lang: "en" });
    if (!cached.ok) throw new Error("Expected cached uploads");
    expect(cached.items.map((item) => item.lang)).toEqual(["en", "ar"]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("does not roll back newer evidence while priming returned native sources", async () => {
    const newer = apiVideo(NEXT);
    newer.statistics.likeCount = "5";
    await fetchYoutubeEvidence([seed(NEXT)], KEY, {
      fetch: sequence([{ items: [newer] }]),
      now: () => NOW + 1000,
    });
    const older = parseYoutubeSource(apiVideo(NEXT), new Set([NEXT]), NOW)!;
    primeYoutubeEvidence(KEY, [older], NOW + 1000);
    const fetch = sequence();
    const source = await fetchYoutubeEvidence([seed(NEXT)], KEY, { fetch, now: () => NOW + 1000 });
    expect(fetch).not.toHaveBeenCalled();
    expect(source[videoUrl(NEXT)].evidence.likes).toBe(5);
  });
});

describe("bounded truthful creator failures", () => {
  it.each([
    [0, 403, "quotaExceeded", "quota", "seed"],
    [1, 403, "keyInvalid", "auth", "channel"],
    [2, 429, "rateLimitExceeded", "quota", "uploads"],
    [3, 503, "backendError", "unavailable", "videos"],
  ] as const)(
    "stops at failed stage %s without retry or empty success",
    async (at, status, reason, error, stage) => {
      const bodies: unknown[] = [
        { items: [apiVideo()] },
        channels(),
        uploads(),
        { items: [apiVideo(NEXT)] },
      ];
      bodies[at] = json({ error: { errors: [{ reason }] } }, status);
      const fetch = sequence(bodies);
      expect(await expandYoutubeCreator(seed(), KEY, options(fetch))).toEqual({
        ok: false,
        error,
        stage,
        requests: at + 1,
      });
      expect(fetch).toHaveBeenCalledTimes(at + 1);
      const retry = sequence();
      expect(await expandYoutubeCreator(seed(), KEY, options(retry))).toMatchObject({
        ok: true,
        cached: false,
        requests: 4,
      });
    },
  );

  it("preserves HTTP auth failures even when the provider returns non-JSON, and distinguishes network errors", async () => {
    expect(
      await expandYoutubeCreator(
        seed(),
        KEY,
        options(sequence([new Response("Unauthorized", { status: 401 })])),
      ),
    ).toEqual({ ok: false, error: "auth", stage: "seed", requests: 1 });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("Network unavailable");
    });
    expect(await expandYoutubeCreator(seed(), KEY, options(fetch))).toEqual({
      ok: false,
      error: "network",
      stage: "seed",
      requests: 1,
    });
  });

  it.each(["declared", "streamed"] as const)(
    "rejects and cancels %s responses over one MiB",
    async (kind) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(kind === "streamed" ? 1024 * 1024 + 1 : 1));
        },
        cancel,
      });
      const response = new Response(body, {
        headers: kind === "declared" ? { "Content-Length": String(1024 * 1024 + 1) } : {},
      });
      expect(await expandYoutubeCreator(seed(), KEY, options(sequence([response])))).toEqual({
        ok: false,
        error: "unavailable",
        stage: "seed",
        requests: 1,
      });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("returns cancellation promptly even if a fetch implementation ignores the abort signal", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const pending = expandYoutubeCreator(seed(), KEY, {
      ...options(fetch),
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: "cancelled", stage: "seed", requests: 1 });
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(
      await expandYoutubeCreator(seed(), KEY, { ...options(fetch), signal: controller.signal }),
    ).toMatchObject({ ok: false, error: "cancelled", requests: 0 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("enforces the six-second deadline independently of an unresponsive fetch", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const pending = expandYoutubeCreator(seed(), KEY, options(fetch));
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toEqual({ ok: false, error: "network", stage: "seed", requests: 1 });
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("does not accept an unrelated channel record or malformed successful response as empty", async () => {
    const unrelated = {
      items: [{ id: OTHER_CHANNEL, contentDetails: { relatedPlaylists: { uploads: PLAYLIST } } }],
    };
    expect(
      await expandYoutubeCreator(
        seed(),
        KEY,
        options(sequence([{ items: [apiVideo()] }, unrelated])),
      ),
    ).toEqual({ ok: false, error: "unavailable", stage: "channel", requests: 2 });
    expect(await expandYoutubeCreator(seed(), KEY, options(sequence([{ unrelated: [] }])))).toEqual(
      { ok: false, error: "unavailable", stage: "seed", requests: 1 },
    );
  });
});
