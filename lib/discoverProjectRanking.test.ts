import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import { discoverEvidence, rankDiscoverItems } from "./discoverRanking";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";

const at = "2026-10-11T14:30:00.000Z";
const now = Date.parse(at);
const source = (caption: string, platform: DiscoverItem["platform"] = "ig"): DiscoverItem => ({
  platform,
  url: {
    ig: "https://www.instagram.com/p/ProjectScope/",
    tt: "https://www.tiktok.com/@editor/video/7690000000000000001",
    yt: "https://www.youtube.com/watch?v=ScopeSource",
  }[platform],
  title: caption,
  snippet: "",
  handle: "editor",
  lang: "en",
  section: "example",
  evidence: {
    source: (
      { ig: "instagram-public-embed", tt: "tiktok-public-page", yt: "youtube-api" } as const
    )[platform],
    caption,
    author: "editor",
    observedAt: at,
    published: at,
    likes: 50000,
    views: 100000,
  },
});

describe("completed creative source claims in editor feeds", () => {
  it.each(
    Object.keys(CATEGORY_PROFILES).flatMap((genreId) =>
      (["ig", "tt", "yt"] as const).map((platform) => ({ genreId, platform })),
    ),
  )(
    "$genreId/$platform keeps real projects and lessons while excluding prospective high-engagement edits",
    ({ genreId, platform }) => {
      const subject = CATEGORY_PROFILES[genreId].subject.en;
      for (const caption of [
        `I will make a ${subject} montage tomorrow`,
        `Should I make a cinematic ${subject} film?`,
        `I will try a ${subject} speed ramp tomorrow`,
      ]) {
        const item = source(caption, platform);
        expect(discoverEvidence(item, genreId, now).techniques).toEqual([]);
        for (const mode of ["inspiration", "popular", "learning"] as const)
          expect(rankDiscoverItems([item], { genreId, now, mode }).items).toHaveLength(0);
      }
      const finished = source(`Cinematic ${subject} film`, platform);
      expect(rankDiscoverItems([finished], { genreId, now }).items).toHaveLength(1);
      expect(rankDiscoverItems([finished], { genreId, now, mode: "popular" }).items).toHaveLength(
        1,
      );
      const lesson = source(`5 Easy Steps To Make A Cinematic ${subject} Film`, platform);
      expect(rankDiscoverItems([lesson], { genreId, now, mode: "learning" }).items).toHaveLength(1);
      expect(rankDiscoverItems([lesson], { genreId, now }).items).toHaveLength(0);
      expect(rankDiscoverItems([lesson], { genreId, now, mode: "popular" }).items).toHaveLength(0);
    },
  );
  it("keeps the real Travel instructional title in Learn without claiming it is a current edit", () => {
    const item = source("5 Easy Steps To Make A Cinematic Travel Film");
    item.platform = "yt";
    item.url = "https://www.youtube.com/watch?v=zTWCCcJAsA4";
    item.evidence = {
      ...item.evidence!,
      source: "youtube-api",
      views: 47900,
      published: "2025-12-15T00:00:00.000Z",
    };
    const options = { genreId: "travel", now };
    expect(rankDiscoverItems([item], { ...options, mode: "learning" }).items).toHaveLength(1);
    expect(rankDiscoverItems([item], options).items).toHaveLength(0);
    expect(rankDiscoverItems([item], { ...options, mode: "popular" }).items).toHaveLength(0);
  });
});
