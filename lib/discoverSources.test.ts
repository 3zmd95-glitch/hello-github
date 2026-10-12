import { describe, expect, it } from "vitest";
import { applyInstagramEvidence, applyTikTokEvidence } from "./discoverSources";
import { discoverEvidence, rankDiscoverItems } from "./discoverRanking";
import type { DiscoverItem } from "./discover";
import type { InstagramSource } from "../workers/scout/src/instagramSource";
import { instagramShortcodeAt, postedAt } from "../workers/scout/src/postDate";

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
      published: postedAt(source.url, new Date(source.observedAt!)),
      evidence: { source: "instagram-public-embed", likes: 10, observedAt: source.observedAt },
    });
    expect(item.stats?.likes).toBe(100000);
    expect(enriched.evidence?.published).toBe(enriched.published);
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

  it("backfills an undated native import from its older real shortcode, never the observation time", () => {
    const url = "https://www.instagram.com/p/Cku9_F9Bu5J/";
    const original = { ...item, url, published: undefined };
    const enriched = applyInstagramEvidence(original, { ...source, url });
    expect(enriched.published?.slice(0, 10)).toBe("2022-11-09");
    expect(enriched.evidence?.published).toBe(enriched.published);
    expect(enriched.published).not.toBe(source.observedAt);
    expect(original.published).toBeUndefined();
  });

  it("replaces a falsely recent indexed date so an older source post cannot enter Popular", () => {
    const url = "https://www.instagram.com/p/Cku9_F9Bu5J/";
    const currentSource = { ...source, url, likes: 5000 };
    const enriched = applyInstagramEvidence(
      { ...item, url, published: "2026-10-08T12:00:00Z" },
      currentSource,
    );
    const now = Date.parse(source.observedAt!);
    expect(discoverEvidence(enriched, "anime", now)).toMatchObject({
      eligible: true,
      popular: false,
      engagement: { fresh: true, strong: true },
      date: { basis: "source", recent: false },
    });
    expect(rankDiscoverItems([enriched], { genreId: "anime", mode: "popular", now }).items).toEqual(
      [],
    );
  });

  it("allows a recent ID date into Popular when its native caption and counts also qualify", () => {
    const published = "2026-10-08T12:00:00.000Z";
    const url = `https://www.instagram.com/p/${instagramShortcodeAt(new Date(published))}/`;
    const enriched = applyInstagramEvidence(
      { ...item, url, published: undefined },
      { ...source, url, likes: 5000 },
    );
    const now = Date.parse(source.observedAt!);
    expect(enriched.published).toBe(published);
    expect(enriched.evidence?.published).toBe(published);
    expect(discoverEvidence(enriched, "anime", now)).toMatchObject({
      popular: true,
      date: { basis: "source", recent: true },
    });
    expect(
      rankDiscoverItems([enriched], { genreId: "anime", mode: "popular", now }).items,
    ).toMatchObject([{ published, evidence: { published } }]);
  });

  it.each(["missing", "wrong-item", "wrong-evidence", "wrong-both"])(
    "repairs %s dates on an identical source response once",
    (state) => {
      const current = applyInstagramEvidence(item, source);
      const wrong = "2026-10-08T12:00:00Z";
      const legacy = {
        ...current,
        published:
          state === "missing" ? undefined : state === "wrong-evidence" ? current.published : wrong,
        evidence: {
          ...current.evidence!,
          published:
            state === "missing"
              ? undefined
              : state === "wrong-item"
                ? current.evidence?.published
                : wrong,
        },
      };
      const repaired = applyInstagramEvidence(legacy, source);
      expect(repaired).not.toBe(legacy);
      expect(repaired.published).toBe(postedAt(source.url, new Date(source.observedAt!)));
      expect(repaired.evidence?.published).toBe(repaired.published);
      expect(applyInstagramEvidence(repaired, source)).toBe(repaired);
    },
  );

  it("does not backfill dates from an older source response", () => {
    const current = {
      ...applyInstagramEvidence(item, source),
      published: undefined,
    };
    current.evidence = { ...current.evidence!, published: undefined };
    expect(applyInstagramEvidence(current, { ...source, observedAt: "2026-10-08T16:00:00Z" })).toBe(
      current,
    );
    expect(current.published).toBeUndefined();
    expect(current.evidence.published).toBeUndefined();
  });

  it.each([
    instagramShortcodeAt(new Date("2026-10-09T16:00:00.001Z")),
    instagramShortcodeAt(new Date("2027-10-09T16:00:00Z")),
    "DY-MjkYNiWGDY-MjkYNiWG",
  ])("never derives a future or impossible date from %s", (code) => {
    const url = `https://www.instagram.com/p/${code}/`;
    const enriched = applyInstagramEvidence(
      { ...item, url, published: undefined },
      { ...source, url },
    );
    expect(enriched.published).toBeUndefined();
    expect(enriched.evidence?.published).toBeUndefined();
  });
});
