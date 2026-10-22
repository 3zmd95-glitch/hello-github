import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendsStateSchema, type Lang, type TrendItemInput } from "./domain";
import { allGenres, GENRES } from "./genres";
import {
  arabicFirst,
  cachedYoutubeSearch,
  canonicalRefUrl,
  clearYoutubeCache,
  compactCount,
  decodeEntities,
  dedupeByUrl,
  detectPlatform,
  GENRE_WEEK_MAX,
  genreWeekItems,
  hasArabic,
  hashtagSlug,
  headlineStat,
  interleavePlatforms,
  RESEARCH_TABS,
  itemFromRef,
  itemFromTrend,
  itemFromYoutube,
  normalizeRef,
  peekYoutubeSearch,
  platformSearchUrl,
  popularityOf,
  programSearchHint,
  publishedAfterFor,
  refFromItem,
  researchHashtag,
  researchQuery,
  scoutPlatformsFor,
  searchLinks,
  sortByPopularity,
  withProgramHint,
  youtubeDurationFor,
  youtubeQuery,
  youtubeSearch,
  youtubeSearchUrl,
  youtubeStatsUrl,
  YOUTUBE_CACHE_TTL_MS,
  YOUTUBE_STATS_MAX_IDS,
} from "./research";

const topic = { ar: "قص المشهد", en: "match cut" };

describe("searchLinks", () => {
  it("builds AR and EN YouTube and TikTok search URLs", () => {
    const links = searchLinks(topic);
    expect(links.yt.ar).toBe(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(topic.ar)}`,
    );
    expect(links.yt.en).toBe(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(topic.en)}`,
    );
    expect(links.tt.ar).toBe(`https://www.tiktok.com/search?q=${encodeURIComponent(topic.ar)}`);
    expect(links.tt.en).toBe(`https://www.tiktok.com/search?q=${encodeURIComponent(topic.en)}`);
  });

  it("builds an Instagram keyword search in both languages", () => {
    const links = searchLinks(topic);
    expect(links.igKeyword.ar).toBe(
      `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(topic.ar)}`,
    );
    expect(links.igKeyword.en).toBe(
      `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(topic.en)}`,
    );
  });

  it("builds a single EN-derived Instagram hashtag page", () => {
    expect(searchLinks(topic).igHashtag).toBe("https://www.instagram.com/explore/tags/matchcut/");
    expect(searchLinks({ ar: "x", en: "Slow Motion #2!" }).igHashtag).toBe(
      "https://www.instagram.com/explore/tags/slowmotion2/",
    );
  });

  it("appends a davinci resolve suffix to the YouTube EN query only for the davinci program", () => {
    const withHint = searchLinks(topic, "davinci");
    expect(withHint.yt.en).toContain(encodeURIComponent("match cut davinci resolve"));
    expect(withHint.yt.ar).toBe(searchLinks(topic).yt.ar); // AR query is untouched
    expect(withHint.tt.en).toBe(searchLinks(topic).tt.en); // other platforms are untouched

    const otherProgram = searchLinks(topic, "camera");
    expect(otherProgram.yt.en).toBe(searchLinks(topic).yt.en);
  });
});

describe("youtubeQuery", () => {
  it("returns the plain AR/EN topic text outside the davinci hint", () => {
    expect(youtubeQuery(topic, "ar")).toBe(topic.ar);
    expect(youtubeQuery(topic, "en")).toBe(topic.en);
    expect(youtubeQuery(topic, "ar", "davinci")).toBe(topic.ar);
  });

  it("suffixes only the EN query when the program is davinci", () => {
    expect(youtubeQuery(topic, "en", "davinci")).toBe("match cut davinci resolve");
  });
});

describe("hashtagSlug", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(hashtagSlug("Match Cut")).toBe("matchcut");
    expect(hashtagSlug("B-Roll (2024)!")).toBe("broll2024");
    expect(hashtagSlug("")).toBe("");
  });
});

describe("detectPlatform", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc", "yt"],
    ["https://youtu.be/abc", "yt"],
    ["https://www.tiktok.com/@someone/video/1", "tt"],
    ["https://www.instagram.com/reel/abc/", "ig"],
    ["https://example.com/article", "web"],
    ["not a url", "web"],
  ] as const)("%s -> %s", (url, platform) => {
    expect(detectPlatform(url)).toBe(platform);
  });
});

describe("normalizeRef", () => {
  it("pulls an @handle out of a TikTok URL and keeps the given title", () => {
    const ref = normalizeRef("https://www.tiktok.com/@editor.sam/video/123", "Great match cut");
    expect(ref).toEqual({
      platform: "tt",
      handle: "@editor.sam",
      title: "Great match cut",
      url: "https://www.tiktok.com/@editor.sam/video/123",
    });
  });

  it("pulls an @handle out of a YouTube channel URL", () => {
    const ref = normalizeRef("https://www.youtube.com/@CaptainDisillusion/videos");
    expect(ref.handle).toBe("@CaptainDisillusion");
    expect(ref.title).toBe("@CaptainDisillusion"); // no title given -> falls back to the handle
  });

  it("falls back to the hostname when there is no @handle", () => {
    const ref = normalizeRef("https://www.instagram.com/explore/tags/matchcut/");
    expect(ref.platform).toBe("ig");
    expect(ref.handle).toBe("instagram.com");
  });

  it("uses an explicit handle when given", () => {
    const ref = normalizeRef("https://example.com/post/1", "A guide", "3z_prod");
    expect(ref).toEqual({
      platform: "web",
      handle: "3z_prod",
      title: "A guide",
      url: "https://example.com/post/1",
    });
  });

  it("throws on an invalid URL", () => {
    expect(() => normalizeRef("not a url")).toThrow();
  });

  it("stores the canonical URL, so a pasted link matches the search card", () => {
    expect(
      normalizeRef("https://www.tiktok.com/@editor.sam/video/123?is_from_webapp=1&sender_device=pc")
        .url,
    ).toBe("https://www.tiktok.com/@editor.sam/video/123");
    expect(normalizeRef("https://youtu.be/dQw4w9WgXcQ?t=42").url).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    const reel = normalizeRef("https://www.instagram.com/editor.ali/reel/ABC-12_x/?igsh=abc");
    expect(reel).toMatchObject({
      platform: "ig",
      handle: "@editor.ali",
      url: "https://www.instagram.com/p/ABC-12_x",
    });
  });
});

describe("canonicalRefUrl (mirrors the Worker's canonicalUrl)", () => {
  it.each([
    [
      "yt",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "yt",
      "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    ["yt", "https://youtu.be/dQw4w9WgXcQ?si=xyz", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    [
      "yt",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "yt",
      "https://www.youtube.com/@CaptainDisillusion/videos/",
      "https://www.youtube.com/@CaptainDisillusion/videos",
    ],
    ["ig", "https://www.instagram.com/reel/ABC123/", "https://www.instagram.com/p/ABC123"],
    ["ig", "https://instagram.com/reels/ABC123", "https://www.instagram.com/p/ABC123"],
    [
      "ig",
      "https://www.instagram.com/p/ABC123/?img_index=2#x",
      "https://www.instagram.com/p/ABC123",
    ],
    ["ig", "https://www.instagram.com/tv/ABC123", "https://www.instagram.com/p/ABC123"],
    [
      "ig",
      "https://www.instagram.com/editor.ali/reel/ABC123/",
      "https://www.instagram.com/p/ABC123",
    ],
    [
      "ig",
      "https://www.instagram.com/explore/tags/matchcut/",
      "https://www.instagram.com/explore/tags/matchcut",
    ],
    [
      "tt",
      "https://www.tiktok.com/@a/video/7300000000000000001?is_from_webapp=1",
      "https://www.tiktok.com/@a/video/7300000000000000001",
    ],
    [
      "tt",
      "https://m.tiktok.com/@a/video/7300000000000000001/",
      "https://www.tiktok.com/@a/video/7300000000000000001",
    ],
    ["tt", "https://vm.tiktok.com/ZMabc/", "https://vm.tiktok.com/ZMabc"],
    ["tt", "https://m.tiktok.com/v/123.html", "https://www.tiktok.com/v/123.html"],
    // An "original audio" page is not a post: it keeps its own path.
    [
      "ig",
      "https://www.instagram.com/reels/audio/932615931412635/?hl=en",
      "https://www.instagram.com/reels/audio/932615931412635",
    ],
    ["ig", "https://m.instagram.com/someuser/", "https://www.instagram.com/someuser"],
    ["yt", "https://youtube.com/@chan/", "https://www.youtube.com/@chan"],
    ["web", "https://Example.COM/post/1/?utm_source=x#top", "https://example.com/post/1"],
    ["web", "https://WWW.Example.com/a/b/?q=1#h", "https://example.com/a/b"],
  ] as const)("%s %s", (platform, url, canonical) => {
    expect(canonicalRefUrl(platform, url)).toBe(canonical);
  });

  it("returns an unparsable URL trimmed but unchanged", () => {
    expect(canonicalRefUrl("web", " not a url ")).toBe("not a url");
  });
});

describe("youtubeSearchUrl", () => {
  it("builds the search.list request with the fixed params plus language/region", () => {
    const url = youtubeSearchUrl("KEY123", "match cut", { relevanceLanguage: "en" });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.googleapis.com/youtube/v3/search");
    expect(parsed.searchParams.get("part")).toBe("snippet");
    expect(parsed.searchParams.get("type")).toBe("video");
    expect(parsed.searchParams.get("maxResults")).toBe("8");
    expect(parsed.searchParams.get("q")).toBe("match cut");
    expect(parsed.searchParams.get("key")).toBe("KEY123");
    expect(parsed.searchParams.get("regionCode")).toBe("SA");
    expect(parsed.searchParams.get("relevanceLanguage")).toBe("en");
  });

  it("omits relevanceLanguage when not given and honours a custom region/maxResults", () => {
    const url = youtubeSearchUrl("KEY", "q", { regionCode: "US", maxResults: 3 });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("relevanceLanguage")).toBe(false);
    expect(parsed.searchParams.get("regionCode")).toBe("US");
    expect(parsed.searchParams.get("maxResults")).toBe("3");
  });
});

describe("youtubeSearch", () => {
  it("maps a successful response to videos", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: { videoId: "abc123" },
            snippet: {
              title: "Match cut tutorial",
              channelTitle: "Editor Sam",
              thumbnails: { medium: { url: "https://i.ytimg.com/vi/abc123/mqdefault.jpg" } },
            },
          },
          { id: {}, snippet: { title: "no video id, skipped" } },
        ],
      }),
    });
    const result = await youtubeSearch("KEY", "match cut", { fetchImpl });
    // The search, then the statistics call (this mock answers it with the search body: no counts in it).
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calledUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("q")).toBe("match cut");
    expect(result).toEqual({
      ok: true,
      items: [
        {
          videoId: "abc123",
          title: "Match cut tutorial",
          channel: "Editor Sam",
          description: "",
          thumb: "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
          url: "https://www.youtube.com/watch?v=abc123",
        },
      ],
    });
  });

  it("maps a 403 quota response to a typed quota error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { errors: [{ reason: "quotaExceeded" }] } }),
    });
    const result = await youtubeSearch("KEY", "q", { fetchImpl });
    expect(result).toEqual({ ok: false, error: { type: "quota" } });
  });

  it("maps a plain 403 (e.g. bad referrer restriction) to a forbidden error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { errors: [{ reason: "accessNotConfigured" }] } }),
    });
    const result = await youtubeSearch("KEY", "q", { fetchImpl });
    expect(result).toEqual({ ok: false, error: { type: "forbidden" } });
  });

  it("maps other error statuses to an unknown error carrying the status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });
    const result = await youtubeSearch("KEY", "q", { fetchImpl });
    expect(result).toEqual({ ok: false, error: { type: "unknown", status: 500 } });
  });

  it("maps a network failure to a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await youtubeSearch("KEY", "q", { fetchImpl });
    expect(result).toEqual({ ok: false, error: { type: "network" } });
  });

  it("returns an empty list when the response has no items", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await youtubeSearch("KEY", "q", { fetchImpl });
    expect(result).toEqual({ ok: true, items: [] });
    // Nothing found, nothing to count: no statistics call.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("youtubeSearch statistics (one videos.list call after the search)", () => {
  const SEARCH = {
    items: [
      { id: { videoId: "a1" }, snippet: { title: "One" } },
      { id: { videoId: "b2" }, snippet: { title: "Two" } },
      { id: { videoId: "c3" }, snippet: { title: "Three" } },
    ],
  };
  /** A fetch that answers the search with SEARCH and the statistics call with whatever `stats` does. */
  const fetchWith = (stats: () => Promise<unknown>) =>
    vi
      .fn()
      .mockImplementation(async (url: string) =>
        url.includes("/youtube/v3/videos?") ? stats() : { ok: true, json: async () => SEARCH },
      );
  const statsBody = (items: unknown[]) => async () => ({ ok: true, json: async () => ({ items }) });

  it("fills views, likes and comments by video id", async () => {
    const fetchImpl = fetchWith(
      statsBody([
        { id: "a1", statistics: { viewCount: "1200345", likeCount: "45000", commentCount: "310" } },
        // Likes hidden by the channel: the API leaves the field out.
        { id: "b2", statistics: { viewCount: "980" } },
        // c3 is missing from the answer; an id nobody asked for is ignored.
        { id: "zz", statistics: { viewCount: "5" } },
      ]),
    );
    const r = await youtubeSearch("KEY", "car edit", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const statsUrl = new URL(fetchImpl.mock.calls[1][0] as string);
    expect(statsUrl.origin + statsUrl.pathname).toBe(
      "https://www.googleapis.com/youtube/v3/videos",
    );
    expect(statsUrl.searchParams.get("part")).toBe("statistics");
    expect(statsUrl.searchParams.get("id")).toBe("a1,b2,c3");
    expect(statsUrl.searchParams.get("key")).toBe("KEY");
    expect(r.ok && r.items.map((v) => v.stats)).toEqual([
      { views: 1200345, likes: 45000, comments: 310 },
      { views: 980 },
      undefined,
    ]);
    // A video without counts has no `stats` key at all.
    expect(r.ok && "stats" in r.items[2]).toBe(false);
    // The call answered: nothing to ask again.
    expect("statsMissing" in r).toBe(false);
  });

  it("keeps only whole, non-negative counts", async () => {
    const fetchImpl = fetchWith(
      statsBody([
        { id: "a1", statistics: { viewCount: "-5", likeCount: "12.5", commentCount: "lots" } },
        { id: "b2", statistics: { viewCount: 77, likeCount: null } },
        { id: "c3" },
      ]),
    );
    const r = await youtubeSearch("KEY", "q", { fetchImpl });
    expect(r.ok && r.items.map((v) => v.stats)).toEqual([undefined, { views: 77 }, undefined]);
  });

  it.each([
    [
      "an API error (quota)",
      true,
      async () => ({ ok: false, status: 403, json: async () => ({}) }),
    ],
    [
      "a network failure or a timeout",
      true,
      async () => {
        throw new Error("offline");
      },
    ],
    [
      "a body that is not JSON",
      true,
      async () => ({
        ok: true,
        json: async () => {
          throw new Error("not json");
        },
      }),
    ],
    // The call answered, with nothing in it: no numbers, and no reason to ask again.
    ["a body without items", false, async () => ({ ok: true, json: async () => ({}) })],
  ])("keeps the videos, without stats, on %s", async (_name, missing, stats) => {
    const fetchImpl = fetchWith(stats);
    const r = await youtubeSearch("KEY", "q", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.ok && r.items.map((v) => v.videoId)).toEqual(["a1", "b2", "c3"]);
    expect(r.ok && r.items.some((v) => "stats" in v)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Only a call that did not answer is marked (the cache then asks for the numbers again).
    expect(r.ok && r.statsMissing).toBe(missing ? true : undefined);
  });

  it("asks for at most 50 ids", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `v${i}`);
    const u = new URL(youtubeStatsUrl("K", ids));
    expect(u.searchParams.get("id")?.split(",")).toEqual(ids.slice(0, YOUTUBE_STATS_MAX_IDS));
    expect(YOUTUBE_STATS_MAX_IDS).toBe(50);
  });
});

describe("youtubeSearchUrl v2 options", () => {
  it("adds videoDuration (not for any) and publishedAfter", () => {
    const u = new URL(
      youtubeSearchUrl("K", "q", {
        videoDuration: "short",
        publishedAfter: "2026-09-20T00:00:00Z",
        relevanceLanguage: "ar",
      }),
    );
    expect(u.searchParams.get("videoDuration")).toBe("short");
    expect(u.searchParams.get("publishedAfter")).toBe("2026-09-20T00:00:00Z");
    expect(u.searchParams.get("relevanceLanguage")).toBe("ar");
    const any = new URL(youtubeSearchUrl("K", "q", { videoDuration: "any" }));
    expect(any.searchParams.has("videoDuration")).toBe(false);
    expect(any.searchParams.has("publishedAfter")).toBe(false);
  });

  it("adds order=viewCount for the popular sort only, so the relevance request stays the same", () => {
    const popular = new URL(youtubeSearchUrl("K", "car edit", { order: "viewCount" }));
    expect(popular.searchParams.get("order")).toBe("viewCount");
    const plain = youtubeSearchUrl("K", "car edit");
    expect(new URL(plain).searchParams.has("order")).toBe(false);
    expect(youtubeSearchUrl("K", "car edit", { order: undefined })).toBe(plain);
  });

  it("maps the filters", () => {
    expect(youtubeDurationFor("any")).toBeUndefined();
    expect(youtubeDurationFor("short")).toBe("short");
    expect(youtubeDurationFor("long")).toBe("long");
    const now = Date.UTC(2026, 8, 27, 15, 30);
    expect(publishedAfterFor("any", now)).toBeUndefined();
    expect(publishedAfterFor("week", now)).toBe("2026-09-20T00:00:00Z");
    expect(publishedAfterFor("month", now)).toBe("2026-08-28T00:00:00Z");
    expect(publishedAfterFor("year", now)).toBe("2025-09-27T00:00:00Z");
    // Stable across the day (so it doesn't bust the cache every millisecond).
    expect(publishedAfterFor("week", now + 60_000)).toBe(publishedAfterFor("week", now));
  });
});

describe("youtubeSearch text", () => {
  it("decodes HTML entities in titles, channels and descriptions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: { videoId: "v1" },
            snippet: {
              title: "Tom &amp; Jerry&#39;s &quot;cut&quot;",
              channelTitle: "A &lt;B&gt;",
              description: "it&#39;s",
            },
          },
        ],
      }),
    });
    const r = await youtubeSearch("K", "q", { fetchImpl });
    expect(r.ok && r.items[0]).toMatchObject({
      title: 'Tom & Jerry\'s "cut"',
      channel: "A <B>",
      description: "it's",
      thumb: "",
    });
    expect(decodeEntities("a &amp;amp; b")).toBe("a &amp; b");
  });
});

describe("cachedYoutubeSearch", () => {
  beforeEach(() => clearYoutubeCache());

  const ok = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: { videoId: "v1" }, snippet: { title: "One" } }] }),
    });
  /** How many of the calls were searches (every successful search is followed by one statistics call). */
  const searches = (fetchImpl: ReturnType<typeof ok>) =>
    fetchImpl.mock.calls.filter(([url]) => String(url).includes("/youtube/v3/search?")).length;

  it("serves the same request from memory and dedupes concurrent calls", async () => {
    const fetchImpl = ok();
    const now = 1_000_000;
    const [a, b] = await Promise.all([
      cachedYoutubeSearch("K", "q", { fetchImpl, videoDuration: "short" }, now),
      cachedYoutubeSearch("K", "q", { fetchImpl, videoDuration: "short" }, now),
    ]);
    expect(a).toEqual(b);
    expect(searches(fetchImpl)).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // + its one statistics call
    expect(peekYoutubeSearch("K", "q", { videoDuration: "short" }, now)).toHaveLength(1);
    // Another filter is another request.
    expect(peekYoutubeSearch("K", "q", { videoDuration: "long" }, now)).toBeUndefined();
    await cachedYoutubeSearch("K", "q", { fetchImpl, videoDuration: "long" }, now);
    expect(searches(fetchImpl)).toBe(2);
    // Expired after the TTL.
    expect(
      peekYoutubeSearch("K", "q", { videoDuration: "short" }, now + YOUTUBE_CACHE_TTL_MS + 1),
    ).toBeUndefined();
  });

  it("does not cache errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await cachedYoutubeSearch("K", "q", { fetchImpl });
    await cachedYoutubeSearch("K", "q", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps the popular order apart from the relevance one, each with its statistics", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("/youtube/v3/videos?")
          ? { items: [{ id: "v1", statistics: { viewCount: "5000" } }] }
          : { items: [{ id: { videoId: "v1" }, snippet: { title: "One" } }] },
    }));
    const now = 2_000_000;
    await cachedYoutubeSearch("K", "car edit", { fetchImpl }, now);
    expect(peekYoutubeSearch("K", "car edit", {}, now)?.[0].stats).toEqual({ views: 5000 });
    expect(peekYoutubeSearch("K", "car edit", { order: "viewCount" }, now)).toBeUndefined();
    await cachedYoutubeSearch("K", "car edit", { fetchImpl, order: "viewCount" }, now);
    expect(searches(fetchImpl)).toBe(2);
    expect(new URL(fetchImpl.mock.calls[2][0] as string).searchParams.get("order")).toBe(
      "viewCount",
    );
    // Back to relevance: from the cache.
    await cachedYoutubeSearch("K", "car edit", { fetchImpl }, now);
    expect(searches(fetchImpl)).toBe(2);
    // Both statistics calls answered: nothing was asked again.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  describe("after a statistics call that failed", () => {
    const SEARCH = {
      items: [
        { id: { videoId: "a1" }, snippet: { title: "One" } },
        { id: { videoId: "b2" }, snippet: { title: "Two" } },
      ],
    };
    // b2 hides its counts: an answer without it is still an answer.
    const STATS = { items: [{ id: "a1", statistics: { viewCount: "5000", likeCount: "40" } }] };
    const A1 = { views: 5000, likes: 40 };

    /** The search always answers; the statistics call fails `failures` times (a 500), then answers. */
    const flaky = (failures: number) => {
      let asked = 0;
      return vi.fn().mockImplementation(async (url: string) => {
        if (!url.includes("/youtube/v3/videos?")) return { ok: true, json: async () => SEARCH };
        asked += 1;
        return asked <= failures
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, json: async () => STATS };
      });
    };
    /** The API paths asked so far, in order. */
    const paths = (fetchImpl: ReturnType<typeof flaky>) =>
      fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname);
    const SEARCH_PATH = "/youtube/v3/search";
    const STATS_PATH = "/youtube/v3/videos";

    it("asks for the numbers alone on the next hit, never the search again", async () => {
      const fetchImpl = flaky(1);
      const now = 3_000_000;
      const first = await cachedYoutubeSearch("K", "car edit", { fetchImpl }, now);
      expect(first).toMatchObject({ ok: true, statsMissing: true });
      expect(first.ok && first.items.map((v) => v.videoId)).toEqual(["a1", "b2"]);
      expect(first.ok && first.items.some((v) => "stats" in v)).toBe(false);
      expect(paths(fetchImpl)).toEqual([SEARCH_PATH, STATS_PATH]);
      // Cached all the same (the search is the expensive part), without numbers.
      expect(peekYoutubeSearch("K", "car edit", {}, now)?.some((v) => "stats" in v)).toBe(false);

      const later = now + 60_000;
      const second = await cachedYoutubeSearch("K", "car edit", { fetchImpl }, later);
      // Exactly one more request: the 1-unit statistics call for the cached videos.
      expect(paths(fetchImpl)).toEqual([SEARCH_PATH, STATS_PATH, STATS_PATH]);
      const asked = new URL(fetchImpl.mock.calls[2][0] as string);
      expect(asked.searchParams.get("part")).toBe("statistics");
      expect(asked.searchParams.get("id")).toBe("a1,b2");
      expect(asked.searchParams.get("key")).toBe("K");
      expect(second.ok && second.items.map((v) => [v.videoId, v.title, v.stats])).toEqual([
        ["a1", "One", A1],
        ["b2", "Two", undefined],
      ]);
      expect("statsMissing" in second).toBe(false);
      // The cache has the numbers now, so a later hit costs nothing at all.
      expect(peekYoutubeSearch("K", "car edit", {}, later)?.[0].stats).toEqual(A1);
      const third = await cachedYoutubeSearch("K", "car edit", { fetchImpl }, later);
      expect(third).toEqual(second);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      // The entry kept the time of the search: it expires 30 minutes after that, not after the numbers.
      const lastMs = now + YOUTUBE_CACHE_TTL_MS - 1;
      expect(peekYoutubeSearch("K", "car edit", {}, lastMs)).toHaveLength(2);
      expect(peekYoutubeSearch("K", "car edit", {}, lastMs + 1)).toBeUndefined();
    });

    it("shares one statistics call between concurrent hits", async () => {
      const fetchImpl = flaky(1);
      const now = 4_000_000;
      await cachedYoutubeSearch("K", "q", { fetchImpl }, now);
      const [a, b] = await Promise.all([
        cachedYoutubeSearch("K", "q", { fetchImpl }, now),
        cachedYoutubeSearch("K", "q", { fetchImpl }, now),
      ]);
      expect(a).toEqual(b);
      expect(a.ok && a.items[0].stats).toEqual(A1);
      expect(paths(fetchImpl)).toEqual([SEARCH_PATH, STATS_PATH, STATS_PATH]);
    });

    it("gives the cached videos back as they were when it fails again, and keeps trying", async () => {
      const fetchImpl = flaky(2);
      const now = 5_000_000;
      const first = await cachedYoutubeSearch("K", "q", { fetchImpl }, now);
      const second = await cachedYoutubeSearch("K", "q", { fetchImpl }, now);
      if (!first.ok || !second.ok) throw new Error("both searches should have answered");
      expect(second.items).toBe(first.items);
      expect(second.statsMissing).toBe(true);
      expect(peekYoutubeSearch("K", "q", {}, now)).toBe(first.items);
      expect(paths(fetchImpl)).toEqual([SEARCH_PATH, STATS_PATH, STATS_PATH]);

      const third = await cachedYoutubeSearch("K", "q", { fetchImpl }, now);
      expect(paths(fetchImpl)).toEqual([SEARCH_PATH, STATS_PATH, STATS_PATH, STATS_PATH]);
      expect(third.ok && third.items.map((v) => v.stats)).toEqual([A1, undefined]);
      // The list handed out earlier was not touched.
      expect(first.items.some((v) => "stats" in v)).toBe(false);
    });

    it("searches again once the entry has expired, numbers or not", async () => {
      const fetchImpl = flaky(1);
      const now = 6_000_000;
      await cachedYoutubeSearch("K", "q", { fetchImpl }, now);
      const r = await cachedYoutubeSearch("K", "q", { fetchImpl }, now + YOUTUBE_CACHE_TTL_MS);
      expect(paths(fetchImpl)).toEqual([SEARCH_PATH, STATS_PATH, SEARCH_PATH, STATS_PATH]);
      expect(r.ok && r.items[0].stats).toEqual(A1);
    });
  });
});

describe("research v2 helpers", () => {
  it("routes tabs to Worker platforms depending on the YouTube key", () => {
    expect(scoutPlatformsFor("all", false)).toEqual(["tt", "ig", "yt"]);
    expect(scoutPlatformsFor("all", true)).toEqual(["tt", "ig"]);
    expect(scoutPlatformsFor("yt", false)).toEqual(["yt"]);
    expect(scoutPlatformsFor("yt", true)).toBeNull();
    expect(scoutPlatformsFor("tt", true)).toEqual(["tt"]);
    expect(scoutPlatformsFor("ig", false)).toEqual(["ig"]);
  });

  it("detects Arabic script and sorts Arabic titles first, stably", () => {
    expect(hasArabic("قص المشهد")).toBe(true);
    expect(hasArabic("match cut ✂️")).toBe(false);
    const items = [{ title: "a" }, { title: "ب" }, { title: "c" }, { title: "match cut مونتاج" }];
    expect(arabicFirst(items).map((i) => i.title)).toEqual(["ب", "match cut مونتاج", "a", "c"]);
  });

  it("counts an Arabic caption (snippet) as Arabic even when the title isn't", () => {
    const items = [
      { title: "Match cut", snippet: "how to" },
      { title: "Reel by @editor.ali 🔥", snippet: "طريقة القص على الحركة في كاب كات" },
      { title: "Speed ramp" },
    ];
    expect(arabicFirst(items).map((i) => i.title)).toEqual([
      "Reel by @editor.ali 🔥",
      "Match cut",
      "Speed ramp",
    ]);
  });

  it("appends the program hint once", () => {
    expect(withProgramHint("match cut", "DaVinci Resolve")).toBe("match cut DaVinci Resolve");
    expect(withProgramHint("match cut davinci resolve", "DaVinci Resolve")).toBe(
      "match cut davinci resolve",
    );
    expect(withProgramHint(" match cut ", undefined)).toBe("match cut");
    expect(withProgramHint("", "CapCut")).toBe("");
    expect(programSearchHint({ kind: "app", name: { ar: "كاب كات", en: "CapCut" } })).toBe(
      "CapCut",
    );
    expect(programSearchHint({ kind: "craft", name: { ar: "x", en: "Camera" } })).toBeUndefined();
    expect(programSearchHint(undefined)).toBeUndefined();
  });

  it("builds platform search URLs", () => {
    expect(platformSearchUrl("yt", "a b")).toBe(
      "https://www.youtube.com/results?search_query=a%20b",
    );
    expect(platformSearchUrl("tt", "a b")).toBe("https://www.tiktok.com/search?q=a%20b");
    expect(platformSearchUrl("ig", "a b")).toBe(
      "https://www.instagram.com/explore/search/keyword/?q=a%20b",
    );
  });

  it("maps items to refs and dedupes by URL", () => {
    const item = itemFromYoutube({
      videoId: "v",
      title: "T",
      channel: "C",
      description: "D",
      thumb: "https://i.ytimg.com/vi/v/mqdefault.jpg",
      url: "https://www.youtube.com/watch?v=v",
    });
    expect(item).toEqual({
      platform: "yt",
      handle: "C",
      title: "T",
      snippet: "D",
      url: "https://www.youtube.com/watch?v=v",
      thumb: "https://i.ytimg.com/vi/v/mqdefault.jpg",
    });
    expect(refFromItem(item)).toEqual({
      platform: "yt",
      handle: "C",
      title: "T",
      url: "https://www.youtube.com/watch?v=v",
      thumb: "https://i.ytimg.com/vi/v/mqdefault.jpg",
    });
    expect(
      dedupeByUrl(
        [{ url: "a", n: 1 }],
        [
          { url: "a", n: 2 },
          { url: "b", n: 3 },
        ],
      ),
    ).toEqual([
      { url: "a", n: 1 },
      { url: "b", n: 3 },
    ]);
  });

  it("dedupes the same post across URL variants, keeping the first item as is", () => {
    const saved = { url: "https://youtu.be/dQw4w9WgXcQ?t=5", n: 1 };
    expect(
      dedupeByUrl(
        [saved, { url: "https://www.instagram.com/reel/ABC123/", n: 2 }],
        [
          { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", n: 3 },
          { url: "https://www.instagram.com/p/ABC123", n: 4 },
          { url: "https://www.tiktok.com/@a/video/1?is_from_webapp=1", n: 5 },
          { url: "https://www.tiktok.com/@a/video/1", n: 6 },
        ],
      ).map((i) => i.n),
    ).toEqual([1, 2, 5]);
    expect(dedupeByUrl([saved])[0]).toBe(saved);
  });
});

describe("RESEARCH_TABS", () => {
  it("puts Instagram and TikTok first (the owner, 2026-10-07), keeping the stored tab names", () => {
    expect(RESEARCH_TABS).toEqual(["all", "ig", "tt", "yt"]);
  });
});

describe("interleavePlatforms", () => {
  it("round-robins YouTube, TikTok, Instagram, web, keeping each platform's order", () => {
    const items = [
      { platform: "yt" as const, n: 1 },
      { platform: "yt" as const, n: 2 },
      { platform: "yt" as const, n: 3 },
      { platform: "tt" as const, n: 4 },
      { platform: "ig" as const, n: 5 },
      { platform: "tt" as const, n: 6 },
    ];
    expect(interleavePlatforms(items).map((i) => i.n)).toEqual([1, 4, 5, 2, 6, 3]);
    expect(interleavePlatforms([])).toEqual([]);
  });
});

describe("researchQuery (topic + edit genre + program hint)", () => {
  const cars = GENRES.find((g) => g.id === "cars")!;
  const own = allGenres([{ id: "custom-drift", name: "Drift", query: "drift  edit" }]).at(-1)!;

  it("is the main query of the genre, in the search language, when there is no topic", () => {
    expect(researchQuery("", "ar", cars)).toBe("ايديت سيارات");
    expect(researchQuery("  ", "en", cars)).toBe("car edit");
  });

  it("puts the topic first, then the genre, then the program hint", () => {
    expect(researchQuery("Smart Bins", "en", cars)).toBe("Smart Bins car edit");
    expect(researchQuery(" drift   night ", "ar", cars)).toBe("drift night ايديت سيارات");
    expect(researchQuery("Smart Bins", "en", cars, "DaVinci Resolve")).toBe(
      "Smart Bins car edit DaVinci Resolve",
    );
    expect(researchQuery("", "en", cars, "CapCut")).toBe("car edit CapCut");
    // The hint is never said twice.
    expect(researchQuery("capcut transitions", "en", cars, "CapCut")).toBe(
      "capcut transitions car edit",
    );
  });

  it("is the topic as it always was without a genre", () => {
    expect(researchQuery(" match cut ", "en")).toBe("match cut");
    expect(researchQuery("match cut", "ar", undefined, "DaVinci Resolve")).toBe(
      "match cut DaVinci Resolve",
    );
    expect(researchQuery("", "en", undefined, "CapCut")).toBe("");
  });

  it("uses the words of a custom genre for both languages", () => {
    expect(own.emoji).toBe("✨");
    expect(researchQuery("", "ar", own)).toBe("drift edit");
    expect(researchQuery("night", "en", own)).toBe("night drift edit");
  });

  it("picks the Instagram hashtag: the genre hashtag for a genre-only search, else the topic slug", () => {
    expect(researchHashtag("", "", cars)).toBe("caredit");
    expect(researchHashtag("  ", "  ", cars)).toBe("caredit");
    expect(researchHashtag("match cut", "match cut", cars)).toBe("matchcut");
    expect(researchHashtag("match cut", "match cut")).toBe("matchcut");
    // A skill: always the slug of its EN name (the base is never empty there).
    expect(researchHashtag("الـ Smart Bins", "Smart Bins + Keywords", cars)).toBe(
      "smartbinskeywords",
    );
    // No Latin letters in the topic, or a custom genre (no hashtags): no link.
    expect(researchHashtag("قص المشهد", "قص المشهد", cars)).toBe("");
    expect(researchHashtag("", "", own)).toBe("");
    expect(researchHashtag("", "")).toBe("");
  });
});

describe("popularity (the Most popular sort and the stats chip)", () => {
  it("ranks by views, else by likes x 10, else not at all", () => {
    expect(popularityOf({ views: 1200, likes: 900 })).toBe(1200);
    expect(popularityOf({ views: 0, likes: 50 })).toBe(0);
    expect(popularityOf({ likes: 45 })).toBe(450);
    expect(popularityOf({ likes: 0 })).toBe(0);
    expect(popularityOf({ comments: 12 })).toBeUndefined();
    expect(popularityOf({})).toBeUndefined();
    expect(popularityOf(undefined)).toBeUndefined();
  });

  it("sorts known popularity first (highest first), the rest after in their order, stably", () => {
    const items = [
      { n: "plain-1" },
      { n: "yt-5k", stats: { views: 5000 } },
      { n: "tt-700-likes", stats: { likes: 700 } },
      { n: "plain-2", stats: { comments: 3 } },
      { n: "yt-9k-a", stats: { views: 9000 } },
      { n: "yt-9k-b", stats: { views: 9000, likes: 1 } },
      { n: "ig-0", stats: { likes: 0 } },
    ];
    const before = items.map((i) => i.n);
    expect(sortByPopularity(items).map((i) => i.n)).toEqual([
      "yt-9k-a",
      "yt-9k-b",
      "tt-700-likes",
      "yt-5k",
      "ig-0",
      "plain-1",
      "plain-2",
    ]);
    // The list it was given is left alone; the items themselves are the same objects.
    expect(items.map((i) => i.n)).toEqual(before);
    expect(sortByPopularity(items)[0]).toBe(items[4]);
    expect(sortByPopularity([])).toEqual([]);
    // 900 likes weigh as much as 9,000 views: a tie, so the order they came in.
    const tie = [
      { n: "tt", stats: { likes: 900 } },
      { n: "yt", stats: { views: 9000 } },
    ];
    expect(sortByPopularity(tie).map((i) => i.n)).toEqual(["tt", "yt"]);
    expect(sortByPopularity([...tie].reverse()).map((i) => i.n)).toEqual(["yt", "tt"]);
  });

  it("keeps Arabic first on top of the popular order, each group by popularity", () => {
    const items = [
      { title: "car edit", stats: { views: 100 } },
      { title: "ايديت سيارات", stats: { views: 50 } },
      { title: "drift", stats: { views: 900 } },
      { title: "هجولة", stats: { likes: 700 } },
      { title: "مونتاج" },
    ];
    expect(arabicFirst(sortByPopularity(items)).map((i) => i.title)).toEqual([
      "هجولة",
      "ايديت سيارات",
      "مونتاج",
      "drift",
      "car edit",
    ]);
  });

  it("shows views on the chip when known, else likes", () => {
    expect(headlineStat({ views: 1200, likes: 45 })).toEqual({ kind: "views", value: 1200 });
    expect(headlineStat({ likes: 45, comments: 2 })).toEqual({ kind: "likes", value: 45 });
    expect(headlineStat({ views: 0 })).toEqual({ kind: "views", value: 0 });
    expect(headlineStat({ comments: 2 })).toBeUndefined();
    expect(headlineStat(undefined)).toBeUndefined();
  });

  it("writes counts the short way, one decimal at most, always in Latin digits", () => {
    expect(compactCount(1_200_345, "en")).toBe("1.2M");
    expect(compactCount(45_000, "en")).toBe("45K");
    expect(compactCount(999, "en")).toBe("999");
    expect(compactCount(0, "en")).toBe("0");
    // Arabic words, Latin digits (the space before the word is a no-break one).
    expect(compactCount(1_200_345, "ar")).toMatch(/^1\.2\sمليون$/);
    expect(compactCount(45_000, "ar")).toMatch(/^45\sألف$/);
    expect(compactCount(999, "ar")).toBe("999");
    expect(compactCount(0, "ar")).toBe("0");
    // Pinned, not left to the browser: even a locale that asks for Arabic-Indic digits (what some older
    // browsers print for plain "ar") gets Latin ones.
    const arabicDigits = "ar-u-nu-arab";
    expect(new Intl.NumberFormat(arabicDigits, { notation: "compact" }).format(45_000)).toMatch(
      /^٤٥\sألف$/,
    );
    expect(compactCount(45_000, arabicDigits as Lang)).toMatch(/^45\sألف$/);
    expect(compactCount(1_200_345, arabicDigits as Lang)).toMatch(/^1\.2\sمليون$/);
  });

  it("carries stats from a YouTube video to its card, and never into a saved reference", () => {
    const item = itemFromYoutube({
      videoId: "v",
      title: "T",
      channel: "C",
      description: "",
      thumb: "",
      url: "https://www.youtube.com/watch?v=v",
      stats: { views: 1200, likes: 45 },
    });
    expect(item.stats).toEqual({ views: 1200, likes: 45 });
    const ref = refFromItem(item);
    expect(ref).toEqual({
      platform: "yt",
      handle: "C",
      title: "T",
      url: "https://www.youtube.com/watch?v=v",
    });
    expect("stats" in itemFromRef(ref)).toBe(false);
  });
});

describe("Most viewed this week (the Trend Radar's rows of a genre, as cards)", () => {
  const NOW = new Date("2026-09-29T09:00:00Z");
  const SEEN_AT = "2026-09-28T03:00:00Z";

  /** A row as the Worker's keyword scan writes it for a genre's main query. */
  const row = (over: Partial<TrendItemInput> & { id: string }): TrendItemInput => ({
    platform: "youtube",
    region: "SA",
    lang: "ar",
    title: over.id,
    url: `https://www.youtube.com/shorts/${over.id}`,
    source: "YouTube search",
    seenAt: SEEN_AT,
    genre: "cars",
    ...over,
  });
  const feed = (items: TrendItemInput[], dismissed: string[] = []) =>
    TrendsStateSchema.parse({ items, fetchedAt: SEEN_AT, dismissed });
  const titles = (items: { title: string }[]) => items.map((i) => i.title);
  const parsed = (over: Partial<TrendItemInput> & { id: string }) => feed([row(over)]).items[0];

  it("turns a YouTube row into a card: views from the volume, the channel as the handle", () => {
    const item = itemFromTrend(
      parsed({
        id: "abc",
        title: "مونتاج سيارات في جدة",
        thumb: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
        volume: 1_250_000,
        why: " قناة السيارات ",
        score: 80,
        tags: ["ايديت سيارات", "short"],
      }),
    );
    expect(item).toEqual({
      platform: "yt",
      handle: "قناة السيارات",
      title: "مونتاج سيارات في جدة",
      snippet: "",
      // The link of a search card (and of a saved reference) for the same video.
      url: "https://www.youtube.com/watch?v=abc",
      thumb: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
      stats: { views: 1_250_000 },
    });
    expect(item!.url).toBe(canonicalRefUrl("yt", "https://www.youtube.com/shorts/abc"));
    expect(refFromItem(item!)).toEqual({
      platform: "yt",
      handle: "قناة السيارات",
      title: "مونتاج سيارات في جدة",
      url: "https://www.youtube.com/watch?v=abc",
      thumb: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
    });
  });

  it("leaves out what the row does not have: no handle, no thumbnail, no numbers", () => {
    const item = itemFromTrend(parsed({ id: "bare", url: "https://www.youtube.com/watch?v=bare" }));
    expect(item).toEqual({
      platform: "yt",
      handle: "",
      title: "bare",
      snippet: "",
      url: "https://www.youtube.com/watch?v=bare",
    });
    expect(itemFromTrend(parsed({ id: "zero", volume: 0 }))?.stats).toEqual({ views: 0 });
    expect(itemFromTrend(parsed({ id: "t", thumb: "data:image/png;base64,AAAA" }))?.thumb).toBe(
      undefined,
    );
  });

  it("counts views only when the row's number is views (a scan row's volume counts pages)", () => {
    expect(
      itemFromTrend(parsed({ id: "chart", source: "YouTube charts", volume: 900 }))?.stats,
    ).toEqual({
      views: 900,
    });
    const scan = itemFromTrend(parsed({ id: "scan", source: "Tavily scan", volume: 12 }));
    expect(scan?.url).toBe("https://www.youtube.com/watch?v=scan");
    expect(scan?.stats).toBeUndefined();
  });

  it("skips a row with nothing to open, and one that is not a YouTube video", () => {
    expect(itemFromTrend(parsed({ id: "no-url", url: undefined }))).toBeUndefined();
    expect(itemFromTrend(parsed({ id: "blank", url: "  " }))).toBeUndefined();
    expect(itemFromTrend(parsed({ id: "js", url: "javascript:alert(1)" }))).toBeUndefined();
    expect(
      itemFromTrend(parsed({ id: "g", platform: "google", url: "https://trends.google.com/x" })),
    ).toBeUndefined();
    // A YouTube row whose link is not one video: a channel page, a search, another site's /watch.
    expect(
      itemFromTrend(parsed({ id: "ch", url: "https://www.youtube.com/@cars" })),
    ).toBeUndefined();
    expect(
      itemFromTrend(parsed({ id: "s", url: "https://www.youtube.com/results?search_query=car" })),
    ).toBeUndefined();
    expect(
      itemFromTrend(parsed({ id: "x", url: "https://example.com/watch?v=abc" })),
    ).toBeUndefined();
    // Every video address the Worker may write becomes the one watch link.
    expect(itemFromTrend(parsed({ id: "b", url: "https://youtu.be/xyz" }))?.url).toBe(
      "https://www.youtube.com/watch?v=xyz",
    );
    expect(
      itemFromTrend(parsed({ id: "m", url: "https://m.youtube.com/watch?v=xyz&t=4" }))?.url,
    ).toBe("https://www.youtube.com/watch?v=xyz");
  });

  it("shows the rows of the genre in the search language only, best score first", () => {
    const state = feed([
      row({ id: "cars-ar-70", score: 70 }),
      row({ id: "cars-en-85", region: "US", lang: "en", score: 85 }),
      row({ id: "food-ar-99", genre: "food", score: 99 }),
      row({ id: "cars-ar-90", score: 90 }),
      row({ id: "cars-mixed-60", lang: "mixed", score: 60 }),
      row({ id: "plain-ar-100", genre: undefined, score: 100 }),
      row({ id: "cars-ar-none" }),
    ]);
    expect(titles(genreWeekItems(state, "cars", "ar", NOW))).toEqual([
      "cars-ar-90",
      "cars-ar-70",
      "cars-mixed-60",
      "cars-ar-none",
    ]);
    expect(titles(genreWeekItems(state, "cars", "en", NOW))).toEqual([
      "cars-en-85",
      "cars-mixed-60",
    ]);
    expect(titles(genreWeekItems(state, "food", "ar", NOW))).toEqual(["food-ar-99"]);
    expect(genreWeekItems(state, "food", "en", NOW)).toEqual([]);
  });

  it("is empty without a genre, and for a genre the feed has no rows of", () => {
    const state = feed([row({ id: "cars-ar", score: 70 }), row({ id: "plain", genre: undefined })]);
    expect(genreWeekItems(state, undefined, "ar", NOW)).toEqual([]);
    expect(genreWeekItems(state, "", "ar", NOW)).toEqual([]);
    expect(genreWeekItems(state, "custom-هجولة", "ar", NOW)).toEqual([]);
    expect(genreWeekItems(state, "anime", "ar", NOW)).toEqual([]);
    expect(genreWeekItems(feed([]), "cars", "ar", NOW)).toEqual([]);
  });

  it("keeps the first six, after the rows without a link are skipped", () => {
    expect(GENRE_WEEK_MAX).toBe(6);
    const state = feed([
      row({ id: "top-no-link", score: 100, url: undefined }),
      ...Array.from({ length: 9 }, (_, i) => row({ id: `v${i}`, score: 90 - i })),
    ]);
    expect(titles(genreWeekItems(state, "cars", "ar", NOW))).toEqual([
      "v0",
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
    ]);
  });

  it("leaves out dismissed and expired rows, and shows a video once", () => {
    const state = feed(
      [
        row({ id: "gone", score: 95 }),
        row({ id: "old", score: 90, expiresAt: "2026-09-29T08:59:59Z" }),
        row({ id: "still", score: 85, expiresAt: "2026-09-29T09:00:01Z" }),
        row({ id: "twice-a", score: 80, url: "https://www.youtube.com/shorts/same" }),
        row({ id: "twice-b", score: 75, url: "https://youtu.be/same?t=3" }),
      ],
      ["gone"],
    );
    expect(titles(genreWeekItems(state, "cars", "ar", NOW))).toEqual(["still", "twice-a"]);
  });
});
