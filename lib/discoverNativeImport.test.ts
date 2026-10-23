import { describe, expect, it } from "vitest";
import { NATIVE_IMPORT_PREFIX, nativeImportItems, parseNativeImport } from "./discoverNativeImport";
import type { DiscoverCandidate } from "./discoverFeed";

const tt = "https://www.tiktok.com/@editor/video/1234567890123456789";
const hash = (value: unknown) => NATIVE_IMPORT_PREFIX + encodeURIComponent(JSON.stringify(value));
describe("native search import boundary", () => {
  it.each([
    ["tt", tt + "?tracking=1", tt],
    [
      "ig",
      "https://instagram.com/reel/NativeEdit/?igsh=tracking",
      "https://www.instagram.com/p/NativeEdit",
    ],
    [
      "yt",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ?si=tracking",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
  ])("canonicalizes %s and deduplicates identities", (platform, raw, canonical) => {
    expect(parseNativeImport(hash({ version: 1, platform, urls: [raw, canonical] }))).toEqual({
      version: 1,
      platform,
      urls: [canonical],
    });
  });
  it.each([
    null,
    [],
    {},
    { version: 2, platform: "tt", urls: [tt] },
    { version: 1, platform: "web", urls: [tt] },
    { version: 1, platform: "tt", urls: [] },
    { version: 1, platform: "tt", urls: Array(25).fill(tt) },
    { version: 1, platform: "tt", urls: [tt], likes: 1000000 },
    ...[
      "http://www.tiktok.com/@editor/video/1234567890123456789",
      "https://tiktok.com.evil.test/@editor/video/1234567890123456789",
      "https://user@tiktok.com/@editor/video/1234567890123456789",
      "https://tiktok.com:444/@editor/video/1234567890123456789",
      "https://tiktok.com/@editor",
      "https://tiktok.com/@editor/video/123",
      "https://instagram.com/p/NativeEdit",
      " " + tt,
      "javascript:alert(1)",
      42,
    ].map((url) => ({ version: 1, platform: "tt", urls: [url] })),
    { version: 1, platform: "yt", urls: ["https://youtube.com/watch?v=dQw4w9WgXcQ&v=dQw4w9WgXcQ"] },
  ])("rejects malformed or mixed payload %#", (value) =>
    expect(parseNativeImport(hash(value))).toBeNull(),
  );
  it("ignores other fragments and refuses bad encoding or oversized input", () => {
    for (const value of [
      "#other",
      NATIVE_IMPORT_PREFIX + "%",
      NATIVE_IMPORT_PREFIX + "x".repeat(12000),
    ])
      expect(parseNativeImport(value)).toBeNull();
  });
  it("imports only selected identities, preserving native evidence and category flags", () => {
    const payload = parseNativeImport(hash({ version: 1, platform: "tt", urls: [tt] }))!;
    const blank = nativeImportItems(payload, [tt], "coffee", [], "en")[0];
    expect(blank.evidence).toBeUndefined();
    expect(blank.stats).toBeUndefined();
    expect(blank.snippet).toBe("");
    const existing: DiscoverCandidate = {
      genreId: "anime",
      obtainedAt: new Date().toISOString(),
      item: {
        ...blank,
        title: "Real source",
        offTopic: true,
        evidence: {
          source: "tiktok-public-page",
          observedAt: new Date().toISOString(),
          caption: "Actual caption",
          likes: 5,
        },
      },
    };
    const copied = nativeImportItems(payload, [tt], "coffee", [existing], "en")[0];
    expect(copied.evidence).toEqual(existing.item.evidence);
    expect(copied.offTopic).toBeUndefined();
    expect(nativeImportItems(payload, [tt], "anime", [existing], "en")[0].offTopic).toBe(true);
    expect(nativeImportItems(payload, [], "coffee", [existing], "en")).toEqual([]);
  });
});
