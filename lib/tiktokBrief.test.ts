import { describe, expect, it } from "vitest";
import { SocialPostStatSchema } from "./domain";
import { safeTikTokPostUrl, tiktokBrief, tiktokBriefCsv } from "./tiktokBrief";

const now = Date.parse("2026-10-04T20:59:59Z");
const post = (postId: string, days: number, views: number, shares = 0) =>
  SocialPostStatSchema.parse({
    platform: "tiktok",
    postId,
    publishedAt: new Date(now - days * 86_400_000).toISOString(),
    views,
    shares,
  });

describe("TikTok creator brief", () => {
  it("uses the selected publishing cohort, excluding future/old/other-platform posts", () => {
    const result = tiktokBrief(
      [
        post("a", 1, 100),
        post("b", 2, 400),
        post("boundary", 7, 10000),
        post("future", -1, 900),
        { ...post("ig", 1, 999), platform: "instagram" },
      ],
      now,
      7,
    );
    expect(result.posts.map((p) => p.postId)).toEqual(["a", "b"]);
    expect(result.totalViews).toBe(500);
    expect(result.medianViews).toBe(250);
  });
  it("ranks by the chosen goal, deduplicates IDs, and does not divide by zero", () => {
    const result = tiktokBrief(
      [post("a", 1, 1000, 2), post("b", 1, 200, 8), post("b", 1, 200, 10)],
      now,
      7,
      "shares",
    );
    expect(result.top.map((p) => p.postId)).toEqual(["b", "a"]);
    expect(result.sharesPerThousand).toBe(10);
    expect(tiktokBrief([post("zero", 1, 0)], now, 7).sharesPerThousand).toBeNull();
    expect(tiktokBrief([], now, 30).medianViews).toBeNull();
  });
  it("opens only TikTok post URLs and drops tracking parameters", () => {
    expect(safeTikTokPostUrl("https://www.tiktok.com/@3z.prod/photo/123?a=b")).toBe(
      "https://www.tiktok.com/@3z.prod/photo/123",
    );
    for (const url of [
      "javascript:alert(1)",
      "https://tiktok.com.evil.test/@x/video/123",
      "https://x@tiktok.com/@x/video/123",
      "https://tiktok.com/login",
    ])
      expect(safeTikTokPostUrl(url)).toBeNull();
  });
  it("exports quoted bilingual text without spreadsheet formula execution", () => {
    const csv = tiktokBriefCsv([
      { ...post("a", 1, 10), title: '=HYPERLINK("x")\nلت', permalink: "javascript:alert(1)" },
    ]);
    expect(csv).toContain("Lifetime views");
    expect(csv).toContain('"\'=HYPERLINK(""x"")\nلت"');
    expect(csv).not.toContain("javascript:");
  });
});
