import { describe, expect, it } from "vitest";
import { applyInstagramEvidence, applyTikTokEvidence } from "./discoverSources";
import type { DiscoverItem } from "./discover";
import type { InstagramSource } from "../workers/scout/src/instagramSource";

const item: DiscoverItem = {
  platform: "ig",
  url: "https://www.instagram.com/reel/DRpa87-Eo9V/",
  title: "Viral tutorial 2026",
  snippet: "100K likes",
  handle: "wrong",
  stats: { likes: 100000 },
  lang: "en",
  section: "tutorial",
  published: "2025-11-29T00:00:00Z",
};
const source: InstagramSource = {
  status: "available",
  url: "https://www.instagram.com/p/DRpa87-Eo9V/",
  title: "Actual caption",
  description: "Anime beat sync edit",
  author: "animeglimps",
  thumbnailUrl: "",
  observedAt: "2026-10-09T16:00:00Z",
  provenance: "instagram-public-embed",
  likes: 10,
};
describe("source-bound category evidence", () => {
  it("replaces inflated indexed counts and contaminated descriptions without mutating input", () => {
    const enriched = applyInstagramEvidence(item, source);
    expect(enriched).toMatchObject({
      title: source.description,
      snippet: source.description,
      handle: source.author,
      stats: { likes: 10 },
      published: item.published,
      evidence: { source: "instagram-public-embed", likes: 10, observedAt: source.observedAt },
    });
    expect(item.stats?.likes).toBe(100000);
    expect(enriched.evidence).not.toHaveProperty("published");
  });
  it("never assigns another post's evidence or promotes unavailable/hidden counts", () => {
    expect(
      applyInstagramEvidence(item, { ...source, url: "https://www.instagram.com/p/OTHER/" }),
    ).toBe(item);
    expect(applyInstagramEvidence(item, { ...source, status: "unavailable" })).toBe(item);
    const hidden = applyInstagramEvidence(item, { ...source, likes: undefined, description: "" });
    expect(hidden.stats).toBeUndefined();
    expect(hidden.snippet).toBe("");
    expect(hidden.title).toBe(source.author);
    expect(hidden.evidence?.likes).toBeUndefined();
  });
  it("retains a newer observation when a stale source response arrives", () => {
    const current = applyInstagramEvidence(item, source);
    expect(
      applyInstagramEvidence(current, {
        ...source,
        observedAt: "2026-10-08T16:00:00Z",
        likes: 50000,
      }),
    ).toBe(current);
    const tiktok: DiscoverItem = {
      ...item,
      platform: "tt",
      url: "https://www.tiktok.com/@editor/video/7555977965763398943",
      evidence: {
        source: "tiktok-public-page",
        observedAt: source.observedAt!,
        availability: "unavailable",
      },
    };
    expect(
      applyTikTokEvidence(tiktok, {
        status: "available",
        url: tiktok.url,
        observedAt: "2026-10-08T16:00:00Z",
        provenance: "tiktok-public-page",
        caption: "Old cached caption",
        views: 100000,
      }),
    ).toBe(tiktok);
  });
});
