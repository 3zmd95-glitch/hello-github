import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  arabicFirst,
  cachedYoutubeSearch,
  clearYoutubeCache,
  decodeEntities,
  dedupeByUrl,
  detectPlatform,
  hasArabic,
  hashtagSlug,
  interleavePlatforms,
  itemFromYoutube,
  normalizeRef,
  peekYoutubeSearch,
  platformSearchUrl,
  programSearchHint,
  publishedAfterFor,
  refFromItem,
  scoutPlatformsFor,
  searchLinks,
  withProgramHint,
  youtubeDurationFor,
  youtubeQuery,
  youtubeSearch,
  youtubeSearchUrl,
  YOUTUBE_CACHE_TTL_MS,
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  it("serves the same request from memory and dedupes concurrent calls", async () => {
    const fetchImpl = ok();
    const now = 1_000_000;
    const [a, b] = await Promise.all([
      cachedYoutubeSearch("K", "q", { fetchImpl, videoDuration: "short" }, now),
      cachedYoutubeSearch("K", "q", { fetchImpl, videoDuration: "short" }, now),
    ]);
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(peekYoutubeSearch("K", "q", { videoDuration: "short" }, now)).toHaveLength(1);
    // Another filter is another request.
    expect(peekYoutubeSearch("K", "q", { videoDuration: "long" }, now)).toBeUndefined();
    await cachedYoutubeSearch("K", "q", { fetchImpl, videoDuration: "long" }, now);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
