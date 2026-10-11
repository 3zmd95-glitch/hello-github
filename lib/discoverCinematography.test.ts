import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import { discoverVisualFixture } from "./discoverVisual.fixture";
import {
  DiscoverVisualSchema,
  DiscoverVisualAssessmentV2Schema,
  hasDiscoverCinematography,
  hasDiscoverVisualCraft,
} from "./discoverVisual";
import { rankDiscoverItems } from "./discoverRanking";

const now = Date.parse("2026-10-11T12:00:00Z");
// Caption/count/date observed in native Chrome; observations below are synthetic gate fixtures,
// not a claim that a model has positively assessed this actual film.
const caption =
  "Taking Coffee making to the next level!\n\nYou gotta rotate your phone for this one. Had so much fun filming this video at Dissolved Solids. If you’re a coffee or cocktail lover then you should definitely give this place a try.\n\nHuge shoutout to @tracia___, @dissolvedsolids and @mad.vsion for helping me bring this video to life.\n\n#coffee #filmmaker #filmmaking #videography #photography";
const claim = "Had so much fun filming this video at Dissolved Solids.";
const item: DiscoverItem = {
  platform: "ig",
  url: "https://www.instagram.com/p/Cku9_F9Bu5J/",
  title: "Taking Coffee making to the next level!",
  snippet: caption,
  handle: "mad.vsion",
  lang: "en",
  section: "example",
  evidence: {
    source: "instagram-public-embed",
    observedAt: new Date(now).toISOString(),
    caption,
    author: "mad.vsion",
    likes: 82100,
    published: "2022-11-09T00:00:00Z",
  },
};
function production(card = item) {
  const visual = discoverVisualFixture(card, "coffee", now);
  visual.rubricVersion = 2;
  visual.assessment.observations = [];
  visual.assessment.cinematography = {
    footage: "live-action",
    attribution: { status: "creator-claim", quote: claim },
    observations: [
      {
        cue: "composition",
        description: "Close framing isolates the portafilter against the arranged equipment.",
        frames: [0],
      },
      {
        cue: "staging",
        description: "The foreground cup and pouring vessel form distinct depth layers.",
        frames: [1],
      },
    ],
  };
  return visual;
}
function ranked(
  card = item,
  visual = production(card),
  mode: "inspiration" | "popular" | "learning" = "inspiration",
) {
  return rankDiscoverItems([card], {
    genreId: "coffee",
    now,
    mode,
    visual: { [card.url.replace(/\/$/, "")]: { visual } },
  });
}

describe("visible cinematography with separate source attribution", () => {
  it("admits a filmed reference through separate visual/attribution evidence without naming an edit or making an old film trendy", () => {
    expect(rankDiscoverItems([item], { genreId: "coffee", now }).items).toEqual([]);
    const visual = production();
    expect(DiscoverVisualSchema.safeParse(visual).success).toBe(true);
    expect(hasDiscoverCinematography(visual)).toBe(true);
    expect(hasDiscoverVisualCraft(visual)).toBe(true);
    expect(ranked().items).toHaveLength(1);
    expect(ranked().evidence[item.url].techniques).toEqual([]);
    expect(ranked(item, visual, "popular").items).toEqual([]);
    expect(ranked(item, visual, "learning").items).toEqual([]);
  });
  it.each(["film-tv-excerpt", "animation", "gameplay", "uncertain"] as const)(
    "does not admit %s as live-action cinematography",
    (footage) => {
      const visual = production();
      visual.assessment.cinematography!.footage = footage;
      expect(hasDiscoverCinematography(visual)).toBe(false);
      expect(ranked(item, visual).items).toEqual([]);
    },
  );
  it.each(["creator-claim", "third-party", "unattributed", "uncertain"] as const)(
    "admits the same visible craft with %s attribution without changing that attribution",
    (status) => {
      const sourceCaption = status === "creator-claim" ? caption : "Coffee in the morning.";
      const card = {
        ...item,
        snippet: sourceCaption,
        evidence: { ...item.evidence!, caption: sourceCaption },
      };
      const visual = production(card);
      const attribution = { status, quote: status === "creator-claim" ? claim : "" };
      visual.assessment.cinematography!.attribution = attribution;
      expect(DiscoverVisualSchema.safeParse(visual).success).toBe(true);
      expect(hasDiscoverCinematography(visual)).toBe(true);
      expect(ranked(card, visual).items).toHaveLength(1);
      expect(visual.assessment.cinematography!.attribution).toEqual(attribution);
      expect(ranked(card, visual, "popular").items).toEqual([]);
      expect(ranked(card, visual, "learning").items).toEqual([]);
    },
  );
  it.each(["uncertain", "mismatch"] as const)(
    "requires supported category rather than %s",
    (category) => {
      const visual = production();
      visual.assessment.category = category;
      expect(hasDiscoverCinematography(visual)).toBe(false);
      expect(ranked(item, visual).items).toEqual([]);
    },
  );
  it.each(["empty", "single", "repeated", "shot-variety-only"] as const)(
    "rejects %s observations even when the sampled images differ",
    (caseName) => {
      const visual = production();
      const cinema = visual.assessment.cinematography!;
      cinema.attribution = { status: "unattributed", quote: "" };
      if (caseName === "empty") cinema.observations = [];
      if (caseName === "single")
        cinema.observations = [{ ...cinema.observations[0], frames: [0, 1] }];
      if (caseName === "repeated")
        cinema.observations[1].description = `  ${cinema.observations[0].description.toUpperCase().replaceAll(" ", "  ")}  `;
      if (caseName === "shot-variety-only")
        cinema.observations = [
          { cue: "shot-variety", description: "A wide view of the scene.", frames: [0] },
          { cue: "shot-variety", description: "A closer view of the same scenery.", frames: [1] },
        ];
      expect(DiscoverVisualSchema.safeParse(visual).success).toBe(true);
      expect(hasDiscoverCinematography(visual)).toBe(false);
      expect(ranked(item, visual).items).toEqual([]);
    },
  );
  it("rejects invented attribution, one still, identical stills and fabricated citations", () => {
    const visual = production();
    visual.assessment.cinematography!.attribution.quote = "I filmed all these shots myself.";
    expect(DiscoverVisualSchema.safeParse(visual).success).toBe(false);
    expect(hasDiscoverCinematography(visual)).toBe(false);
    const one = production();
    one.assessment.cinematography!.observations[1].frames = [0];
    expect(hasDiscoverCinematography(one)).toBe(false);
    const same = production();
    same.media.frames[1].sha256 = same.media.frames[0].sha256;
    expect(hasDiscoverCinematography(same)).toBe(false);
    const missing = production();
    missing.assessment.cinematography!.observations[1].frames = [7];
    expect(DiscoverVisualSchema.safeParse(missing).success).toBe(false);
    expect(hasDiscoverCinematography(missing)).toBe(false);
    expect(ranked(item, missing).items).toEqual([]);
  });
  it.each(["creator-claim", "third-party", "unattributed", "uncertain"] as const)(
    "grounds every displayed %s quotation in the source",
    (status) => {
      const visual = production();
      visual.assessment.cinematography!.attribution = {
        status,
        quote: "An invented source quotation.",
      };
      expect(DiscoverVisualSchema.safeParse(visual).success).toBe(false);
      expect(hasDiscoverCinematography(visual)).toBe(false);
      expect(ranked(item, visual).items).toEqual([]);
      visual.assessment.cinematography!.attribution.quote = claim;
      expect(DiscoverVisualSchema.safeParse(visual).success).toBe(true);
      expect(hasDiscoverCinematography(visual)).toBe(true);
    },
  );
  it("preserves source engagement, source identity and substantive exclusions", () => {
    for (const likes of [5, undefined]) {
      const card = { ...item, evidence: { ...item.evidence!, likes } };
      expect(ranked(card).items).toEqual([]);
    }
    const changed = { ...item, evidence: { ...item.evidence!, author: "another-author" } };
    expect(ranked(changed, production()).items).toEqual([]);
    const banned = {
      ...item,
      evidence: { ...item.evidence!, caption: caption + "\nBuy now discount code" },
    };
    expect(ranked(banned, production(banned)).items).toEqual([]);
  });
  it("keeps legacy added-graphics evidence readable without treating it as a cinematography check", () => {
    const legacy = discoverVisualFixture(item, "coffee", now);
    expect(DiscoverVisualSchema.safeParse(legacy).success).toBe(true);
    expect(hasDiscoverVisualCraft(legacy)).toBe(true);
    expect(hasDiscoverCinematography(legacy)).toBe(false);
    expect(DiscoverVisualAssessmentV2Schema.safeParse(legacy.assessment).success).toBe(false);
    expect(
      DiscoverVisualAssessmentV2Schema.safeParse({ ...legacy.assessment, cinematography: null })
        .success,
    ).toBe(true);
    const masquerade = production();
    delete masquerade.rubricVersion;
    expect(DiscoverVisualSchema.safeParse(masquerade).success).toBe(false);
  });
});
