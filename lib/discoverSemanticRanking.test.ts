import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import {
  DiscoverCandidatesSchema,
  mergeDiscoverCandidates,
  type DiscoverCandidate,
} from "./discoverFeed";
import type { DiscoverSemantic } from "./discoverSemantic";
import { discoverEvidence, rankDiscoverItems } from "./discoverRanking";

const now = Date.parse("2026-10-11T12:00:00Z");
const captions = [
  "A brand-new day in New York City! 🗽 I had to hop on this trend of showing the beauty of this incredible city through my camera, inspired by the last Spider-Man movie. Hope you guys like it! #newyork #brandnewday #sonyalpha #cinematic #filmmaking ",
  "Made a little something during my flight. #cinematic #filmtok #filmmaking #cinematography #colourgrading #film #shortfilm #fyi",
  "Cinematic frames from Nice 🇫🇷 #fyp #filmmakers #colorgrading #davinciresolve #southoffrance ",
];
const urls = [
  "https://www.tiktok.com/@alvarovaliente_/video/7672800453221944589",
  "https://www.tiktok.com/@lewisonfilm/video/7490121492424903958",
  "https://www.tiktok.com/@alessvisuals/video/7677300576404770069",
];
function record(index = 2): DiscoverCandidate {
  const caption = captions[index];
  const item: DiscoverItem = {
    url: urls[index],
    platform: "tt",
    title: caption,
    snippet: "",
    lang: "en",
    section: "example",
    handle: "@creator",
    outsideCategory: true,
    evidence: {
      source: "tiktok-public-page",
      caption,
      author: "creator",
      observedAt: new Date(now).toISOString(),
      likes: 27600,
      views: 131800,
      published: "2026-08-23T18:47:26Z",
    },
  };
  const semantic: DiscoverSemantic = {
    version: 1,
    url: item.url,
    genreId: "travel",
    checkedAt: new Date(now).toISOString(),
    model: "gpt-6-astra",
    effort: "low",
    source: {
      provenance: "tiktok-public-page",
      caption,
      author: "creator",
      observedAt: new Date(now).toISOString(),
    },
    assessment: {
      category: "supported",
      categoryQuote: caption.trim(),
      project: "described",
      projectQuote: caption.trim(),
      reason: "The source describes a completed creative destination or journey film.",
    },
  };
  return { genreId: "travel", item, obtainedAt: new Date(now).toISOString(), semantic };
}
const rank = (
  entry: DiscoverCandidate,
  mode: "inspiration" | "popular" | "learning" = "inspiration",
) =>
  rankDiscoverItems([entry.item], {
    genreId: entry.genreId,
    now,
    mode,
    visual: { [entry.item.url]: entry },
  });

describe("source-bound caption context in category ranking", () => {
  it.each([0, 1, 2])(
    "recovers travel reference %s without inventing a named effect, lesson or current trend",
    (index) => {
      const entry = record(index);
      expect(rankDiscoverItems([entry.item], { genreId: "travel", now }).items).toHaveLength(0);
      expect(rank(entry).items).toHaveLength(1);
      expect(rank(entry, "popular").items).toHaveLength(0);
      expect(rank(entry, "learning").items).toHaveLength(0);
      const proof = discoverEvidence(entry.item, "travel", now, entry);
      expect(proof).toMatchObject({
        categoryMatch: true,
        project: true,
        craft: "generic",
        teaching: false,
        techniques: [],
        popular: false,
      });
      expect(proof.visual).toBeUndefined();
      expect(proof.reasons).toContain("caption-context");
      expect(proof.reasons).toContain("old-post");
    },
  );
  it("preserves engagement floors, source availability, source binding and category scope", () => {
    const entry = record();
    const variants: DiscoverCandidate[] = [
      {
        ...entry,
        item: { ...entry.item, evidence: { ...entry.item.evidence!, likes: 5, views: 50 } },
      },
      {
        ...entry,
        item: { ...entry.item, evidence: { ...entry.item.evidence!, availability: "unavailable" } },
      },
      {
        ...entry,
        item: {
          ...entry.item,
          evidence: { ...entry.item.evidence!, caption: "Shopping for things that look nice." },
        },
      },
      {
        ...entry,
        item: { ...entry.item, evidence: { ...entry.item.evidence!, author: "another" } },
      },
      { ...entry, genreId: "anime" },
      {
        ...entry,
        semantic: { ...entry.semantic!, checkedAt: new Date(now - 86400001).toISOString() },
      },
      {
        ...entry,
        semantic: { ...entry.semantic!, checkedAt: new Date(now + 600000).toISOString() },
      },
    ];
    for (const variant of variants) expect(rank(variant).items).toHaveLength(0);
  });
  it("does not promote uncertain, mismatched or category-only judgments", () => {
    const entry = record();
    for (const patch of [
      { category: "uncertain" as const },
      { category: "mismatch" as const },
      { project: "none" as const },
    ]) {
      expect(
        rank({
          ...entry,
          semantic: { ...entry.semantic!, assessment: { ...entry.semantic!.assessment, ...patch } },
        }).items,
      ).toHaveLength(0);
    }
  });
  it("does not bypass an explicit source promotion even if a model mislabels it", () => {
    const entry = record();
    const caption = "Travel cinematic film: shop now for my preset pack, discount code in bio!";
    const changed = {
      ...entry,
      item: { ...entry.item, title: caption, evidence: { ...entry.item.evidence!, caption } },
      semantic: {
        ...entry.semantic!,
        source: { ...entry.semantic!.source, caption },
        assessment: {
          ...entry.semantic!.assessment,
          categoryQuote: caption,
          projectQuote: caption,
        },
      },
    };
    expect(rank(changed).items).toHaveLength(0);
  });
  it("retains assessments through metadata refresh/serialization and invalidates changed source text", () => {
    const entry = record();
    const refreshed = {
      ...entry,
      semantic: undefined,
      item: {
        ...entry.item,
        evidence: {
          ...entry.item.evidence!,
          likes: 30000,
          observedAt: new Date(now + 1000).toISOString(),
        },
      },
    };
    const merged = mergeDiscoverCandidates([entry], [refreshed]);
    expect(merged[0].semantic).toEqual(entry.semantic);
    expect(DiscoverCandidatesSchema.parse(JSON.parse(JSON.stringify(merged)))[0].semantic).toEqual(
      entry.semantic,
    );
    const changed = {
      ...refreshed,
      item: {
        ...refreshed.item,
        evidence: {
          ...refreshed.item.evidence!,
          caption: "Revised source",
          observedAt: new Date(now + 2000).toISOString(),
        },
      },
    };
    expect(mergeDiscoverCandidates(merged, [changed])[0].semantic).toBeUndefined();
  });
  it("never revives an older positive after a newer negative assessment", () => {
    const entry = record();
    const newer = {
      ...entry,
      semantic: {
        ...entry.semantic!,
        checkedAt: new Date(now + 1000).toISOString(),
        assessment: { ...entry.semantic!.assessment, category: "mismatch" as const },
      },
    };
    const merged = mergeDiscoverCandidates([entry], [newer]);
    expect(merged[0].semantic?.assessment.category).toBe("mismatch");
    expect(rank(merged[0]).items).toHaveLength(0);
    expect(mergeDiscoverCandidates(merged, [entry])[0].semantic?.assessment.category).toBe(
      "mismatch",
    );
  });
});
