import { describe, expect, it } from "vitest";
import {
  canonicalNativePost,
  nativeSearchUrl,
  parseNativeRequest,
  sanitizeNativeResults,
  sameNativeSearchPage,
  trustedDiscoverSender,
} from "./native-protocol.js";

const sender = {
  url: "http://localhost:3000/discover/#anything",
  origin: "http://localhost:3000",
  tab: { id: 7 },
  frameId: 0,
};
const search = { version: 1, type: "search", requestId: "test-1", queries: { ig: "anime edit" } };

describe("native connector sender and request boundaries", () => {
  it("accepts only the precise local Discover top-level sender", () => {
    expect(trustedDiscoverSender(sender)).toBe(true);
    for (const url of [
      "http://localhost/discover/",
      "http://localhost:3001/discover/",
      "https://localhost:3000/discover/",
      "http://localhost:3000/",
      "http://localhost:3000/discover",
      "http://localhost:3000/discover/private/",
      "http://localhost.evil:3000/discover/",
      "http://name:password@localhost:3000/discover/",
    ])
      expect(trustedDiscoverSender({ ...sender, url })).toBe(false);
    expect(trustedDiscoverSender({ ...sender, frameId: 1 })).toBe(false);
    expect(trustedDiscoverSender({ ...sender, origin: "null" })).toBe(false);
    expect(trustedDiscoverSender({ ...sender, tab: {} })).toBe(false);
  });
  it("validates commands and bounded search queries without accepting URL commands", () => {
    expect(parseNativeRequest(search)).toEqual(search);
    expect(
      parseNativeRequest({
        ...search,
        queries: { ig: "  مونتاج أنمي  ", tt: "anime edit", yt: "anime edit" },
      })?.queries,
    ).toEqual({ ig: "مونتاج أنمي", tt: "anime edit", yt: "anime edit" });
    for (const bad of [
      null,
      [],
      {},
      { ...search, version: 2 },
      { ...search, requestId: "../bad" },
      { ...search, queries: {} },
      { ...search, queries: { ig: " " } },
      { ...search, queries: { ig: "x".repeat(121) } },
      { ...search, queries: { ig: "a\nb" } },
      { ...search, queries: { fb: "edit" } },
      { ...search, url: "https://evil.example" },
    ])
      expect(parseNativeRequest(bad)).toBeNull();
    for (const type of ["status", "poll", "cancel", "more"]) {
      const value = type === "status" ? { version: 1, type } : { version: 1, type, jobId: "job-1" };
      expect(parseNativeRequest(value)).toEqual(value);
      expect(parseNativeRequest({ ...value, extra: true })).toBeNull();
    }
  });
  it("encodes query values into fixed native public search routes", () => {
    expect(nativeSearchUrl("ig", "anime edit&x=1")).toBe(
      "https://www.instagram.com/explore/search/keyword/?q=anime%20edit%26x%3D1",
    );
    expect(nativeSearchUrl("tt", "coffee")).toBe("https://www.tiktok.com/search?q=coffee");
    expect(nativeSearchUrl("yt", "coffee")).toBe(
      "https://www.youtube.com/results?search_query=coffee",
    );
    expect(() => nativeSearchUrl("fb", "coffee")).toThrow();
  });
});

describe("returned card sanitization", () => {
  it("bounds rolling snapshots at300 cards and deduplicates canonical post identities", () => {
    const cards = Array.from({ length: 320 }, (_, index) => ({
      url: `https://www.instagram.com/reel/Post${index}/`,
    }));
    const result = sanitizeNativeResults(
      "ig",
      [{ url: "https://www.instagram.com/p/Post0/" }, ...cards],
      "now",
    );
    expect(result).toHaveLength(300);
    expect(result[1].url).toBe("https://www.instagram.com/reel/Post1/");
    expect(result.at(-1)?.position).toBe(300);
    expect(
      sanitizeNativeResults(
        "yt",
        [
          { url: "https://www.youtube.com/shorts/abcdefghijk" },
          { url: "https://www.youtube.com/watch?v=abcdefghijk" },
        ],
        "now",
      ),
    ).toHaveLength(1);
  });
  it("accepts harmless native URL normalization but never a different or ambiguous query", () => {
    const expected = nativeSearchUrl("ig", "anime edit");
    expect(
      sameNativeSearchPage(
        "ig",
        "https://www.instagram.com/explore/search/keyword?q=anime+edit&tracking=1",
        expected,
      ),
    ).toBe(true);
    expect(
      sameNativeSearchPage(
        "ig",
        "https://www.instagram.com/explore/search/keyword/?q=other",
        expected,
      ),
    ).toBe(false);
    expect(
      sameNativeSearchPage(
        "ig",
        "https://www.instagram.com/explore/search/keyword/?q=anime%20edit&q=other",
        expected,
      ),
    ).toBe(false);
    expect(
      sameNativeSearchPage(
        "ig",
        "https://www.instagram.com/direct/inbox/?q=anime%20edit",
        expected,
      ),
    ).toBe(false);
  });
  it("preserves public post kind and removes tracking parameters", () => {
    expect(canonicalNativePost("ig", "https://www.instagram.com/reel/Ab_cd-12/?utm_source=x")).toBe(
      "https://www.instagram.com/reel/Ab_cd-12/",
    );
    expect(canonicalNativePost("ig", "https://www.instagram.com/p/Ab12")).toBe(
      "https://www.instagram.com/p/Ab12/",
    );
    expect(canonicalNativePost("yt", "https://www.youtube.com/shorts/abcdefghijk?feature=x")).toBe(
      "https://www.youtube.com/shorts/abcdefghijk",
    );
    expect(canonicalNativePost("yt", "https://www.youtube.com/watch?v=abcdefghijk&x=1")).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    expect(
      canonicalNativePost("tt", "https://www.tiktok.com/@name/video/1234567890123456789?x=1"),
    ).toBe("https://www.tiktok.com/@name/video/1234567890123456789");
  });
  it.each([
    "https://www.instagram.com/direct/inbox/",
    "https://www.instagram.com/stories/a/123/",
    "http://www.instagram.com/reel/Ab12/",
    "https://www.instagram.com:8443/reel/Ab12/",
    "https://name:password@www.instagram.com/reel/Ab12/",
    "https://www.instagram.com.evil/reel/Ab12/",
    "javascript:alert(1)",
    "https://www.instagram.com/reel/Ab12/\n",
  ])("rejects unsafe or private destinations: %s", (url) => {
    expect(canonicalNativePost("ig", url)).toBeNull();
  });
  it("keeps blank-title cards and only bounded rendered fields, never invented stats", () => {
    const url = "https://www.instagram.com/reel/Ab12/";
    const result = sanitizeNativeResults(
      "ig",
      [
        { url, title: "", thumb: "blob:bad", views: 999999, transcript: "secret" },
        { url, title: "duplicate" },
        { url: "https://evil.test/reel/Ab12" },
      ],
      "2026-10-11T00:00:00.000Z",
    );
    expect(result).toEqual([
      { platform: "ig", url, title: "", position: 1, observedAt: "2026-10-11T00:00:00.000Z" },
    ]);
    expect(
      sanitizeNativeResults(
        "ig",
        [
          {
            url,
            title: "A".repeat(800),
            displayedStats: "1.2M views",
            thumb: "https://cdn.example/thumb.jpg",
          },
        ],
        "now",
      )[0],
    ).toMatchObject({
      title: "A".repeat(400),
      displayedStats: "1.2M views",
      thumb: "https://cdn.example/thumb.jpg",
    });
  });
});
