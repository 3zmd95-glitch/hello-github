import { describe, expect, it } from "vitest";
import {
  EditFormatSchema,
  editFormatQuery,
  filterFormatAnswer,
  formatItemMatches,
  formatFreshness,
  mergeEditFormats,
  parseEditFormats,
  type EditFormat,
} from "./editFormats";
import { parseTrendingEffects } from "./effects";
import { REVIEWED_FORMAT_SEEDS } from "./formatSeeds";
import type { DiscoverAnswer, DiscoverItem } from "./discover";

const NOW = Date.parse("2026-10-07T20:00:00Z");
const FORMAT: EditFormat = {
  key: "trip-baby-cutout",
  name: { en: "TRIP BABY cutout figures" },
  visualPattern: { en: "Repeated cutout figures" },
  audio: { title: "TRIP BABY", artist: "A$AP Rocky" },
  firstSeen: "2026-10-05T10:00:00Z",
  lastChecked: "2026-10-07T12:00:00Z",
  evidence: {
    state: "candidate",
    creators7d: 1,
    posts7d: 1,
    latestPostAt: "2026-10-06T12:00:00Z",
    scope: "indexed-public-posts",
  },
  samples: [
    {
      url: "https://www.instagram.com/reel/EXAMPLE/",
      platform: "ig",
      handle: "editor",
      title: "Repeated cutout figures to TRIP BABY",
      published: "2026-10-06T12:00:00Z",
      observedAt: "2026-10-07T12:00:00Z",
      patternQuote: "Repeated cutout figures",
      audioQuote: "TRIP BABY",
    },
  ],
};

describe("specific edit formats", () => {
  it("keeps a supported audio and visual pairing, separate from a generic technique", () => {
    const parsed = parseEditFormats([FORMAT], NOW);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].samples[0].basis).toBe("caption");
    expect(parseEditFormats([{ ...FORMAT, audio: undefined }], NOW)).toEqual([]);
    expect(
      parseEditFormats(
        [{ ...FORMAT, samples: [{ ...FORMAT.samples[0], audioQuote: undefined }] }],
        NOW,
      ),
    ).toEqual([]);
    expect(
      parseEditFormats(
        [{ ...FORMAT, samples: [{ ...FORMAT.samples[0], patternQuote: undefined }] }],
        NOW,
      ),
    ).toEqual([]);
  });

  it("never combines different visuals only because they share the same song", () => {
    const different = {
      ...FORMAT,
      key: "trip-baby-zoom",
      visualPattern: { en: "Beat-synced crash zooms" },
    };
    expect(mergeEditFormats([FORMAT, different], [], [])).toHaveLength(2);
    const refreshed = {
      ...FORMAT,
      lastChecked: "2026-10-07T15:00:00Z",
      name: { en: "Updated descriptive title" },
    };
    expect(
      mergeEditFormats([refreshed], [], [{ format: FORMAT, followedAt: "2026-10-06T00:00:00Z" }]),
    ).toEqual([refreshed]);
    expect(
      mergeEditFormats([], [], [{ format: FORMAT, followedAt: "2026-10-06T00:00:00Z" }]),
    ).toEqual([FORMAT]);
  });

  it("rejects invalid provenance, unsafe links, future dates and inconsistent evidence", () => {
    for (const bad of [
      { ...FORMAT, source: "reviewed-reference" },
      { ...FORMAT, evidence: { ...FORMAT.evidence, scope: "reviewed-references" } },
      { ...FORMAT, evidence: { ...FORMAT.evidence, state: "repeated" } },
      { ...FORMAT, evidence: { ...FORMAT.evidence, creators7d: 2 } },
      { ...FORMAT, lastChecked: "2026-10-09T00:00:00Z" },
      { ...FORMAT, firstSeen: "2026-10-09T00:00:00Z" },
      { ...FORMAT, samples: [{ ...FORMAT.samples[0], published: "2026-10-09T00:00:00Z" }] },
      { ...FORMAT, samples: [{ ...FORMAT.samples[0], published: undefined }] },
      { ...FORMAT, samples: [{ ...FORMAT.samples[0], url: "javascript:alert(1)" }] },
      {
        ...FORMAT,
        audio: { ...FORMAT.audio, url: "https://www.instagram.com.evil.test/reels/audio/123/" },
      },
    ])
      expect(parseEditFormats([bad], NOW)).toEqual([]);
    const falseReview = {
      ...FORMAT,
      reviewNote: { en: "We watched this" },
      samples: [{ ...FORMAT.samples[0], basis: "partial-playback" }],
    };
    const parsed = parseEditFormats([falseReview], NOW)[0];
    expect(parsed.reviewNote).toBeUndefined();
    expect(parsed.samples[0].basis).toBe("caption");
  });

  it("keeps older candidates but never describes old or undated sources as recently repeated", () => {
    expect(formatFreshness(FORMAT, NOW)).toBe("recent");
    expect(
      formatFreshness(
        { ...FORMAT, evidence: { ...FORMAT.evidence, latestPostAt: undefined } },
        NOW,
      ),
    ).toBe("unknown");
    expect(formatFreshness({ ...FORMAT, lastChecked: "2026-10-09T00:00:00Z" }, NOW)).toBe("stale");
    const older = {
      ...FORMAT,
      evidence: {
        ...FORMAT.evidence,
        latestPostAt: "2026-09-20T12:00:00Z",
        creators7d: 0,
        posts7d: 0,
      },
    };
    expect(formatFreshness(older, NOW)).toBe("stale");
    expect(parseEditFormats([older], NOW)).toHaveLength(1);
    expect(
      parseEditFormats(
        [
          {
            ...older,
            evidence: { ...older.evidence, state: "repeated", creators7d: 3, posts7d: 3 },
          },
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it("keeps the song and visual pattern in bounded example and learning searches", () => {
    expect(editFormatQuery(FORMAT, "examples")).toBe('"TRIP BABY" cutout figures edit examples');
    expect(editFormatQuery(FORMAT, "tutorials")).toContain("cutout figures edit tutorial");
    const huge = {
      ...FORMAT,
      audio: { title: "song ".repeat(100), artist: "artist ".repeat(100) },
      visualPattern: { en: "pattern ".repeat(100) },
    };
    expect(editFormatQuery(huge, "tutorials").length).toBeLessThanOrEqual(200);
  });

  it("only reads versioned dynamic formats and retains reviewed references with an older backend", () => {
    const legacy = parseTrendingEffects({ status: "ok", items: [], formats: [FORMAT] })!;
    expect(legacy.formats).toBeUndefined();
    const current = parseTrendingEffects({
      status: "ok",
      items: [],
      formatVersion: 1,
      formats: [FORMAT],
    })!;
    expect(current.formats).toHaveLength(1);
    expect(REVIEWED_FORMAT_SEEDS.length).toBeGreaterThan(0);
    for (const seed of REVIEWED_FORMAT_SEEDS)
      expect(EditFormatSchema.safeParse(seed).success).toBe(true);
    expect(mergeEditFormats(legacy.formats ?? [], REVIEWED_FORMAT_SEEDS, [])).toEqual(
      REVIEWED_FORMAT_SEEDS,
    );
  });
});

describe("selected-format searches", () => {
  const FORMAT = REVIEWED_FORMAT_SEEDS[0];
  const item = (
    title: string,
    snippet = "",
    overrides: Partial<DiscoverItem> = {},
  ): DiscoverItem => ({
    title,
    snippet,
    platform: "yt",
    handle: "editor",
    url: "https://www.youtube.com/watch?v=OtherReference",
    lang: "en",
    section: "example",
    ...overrides,
  });
  it("uses the track named by the specific format, not its artist/album news identity", () => {
    expect(editFormatQuery(FORMAT, "tutorials")).toBe(
      '"TRIP BABY" repeating figures edit tutorial',
    );
    expect(editFormatQuery(FORMAT, "examples")).not.toMatch(/DON'T BE DUMB|A\$AP/);
    const unsplit = {
      ...FORMAT,
      name: { en: "A music loop" },
      audio: { title: "First Song / Second Song" },
    };
    expect(editFormatQuery(unsplit, "examples")).toContain('"First Song / Second Song"');
  });

  it("rejects the observed album/news/fashion/review noise and generic LUT or cutout tutorials", () => {
    const unrelated = [
      item(
        "A$AP Rocky announces DON'T BE DUMB album",
        "2024 album news, songs including TRIP BABY",
      ),
      item(
        "A$AP Rocky at Paris Fashion Week 2026",
        "His cinematic looks repeat. DON'T BE DUMB / TRIP BABY",
      ),
      item(
        "TRIP BABY hip hop album review",
        "A$AP Rocky has repeated success. Here is a breakdown.",
      ),
      item(
        "Cinematic LUT pack tutorial",
        "Get cinematic shots and recreate the film look. TRIP BABY",
      ),
      item(
        "2023 cutout animation tutorial",
        "How to layer repeated cutout figures in After Effects",
      ),
      item("TRIP BABY lyrics", "Sing along to the beat, a repeating chorus"),
      item(
        "DON'T BE DUMB repeated figures tutorial",
        "Learn this editing technique from the album",
      ),
      item(
        "TRIP BABYSONG repeating figures tutorial",
        "A different song whose name has a shared prefix",
      ),
    ];
    for (const candidate of unrelated) {
      expect(formatItemMatches(candidate, FORMAT, "examples"), candidate.title).toBe(false);
      expect(formatItemMatches(candidate, FORMAT, "tutorials"), candidate.title).toBe(false);
    }
  });

  it("requires both the specific soundtrack and visual recipe, with real teaching words for Learn", () => {
    const example = item(
      "TRIP BABY repeating figures edit",
      "Layered copies of the person across scenes",
    );
    expect(formatItemMatches(example, FORMAT, "examples")).toBe(true);
    expect(formatItemMatches(example, FORMAT, "tutorials")).toBe(false);
    const tutorial = item(
      "How to edit repeating figures to TRIP BABY",
      "After Effects tutorial and breakdown",
      { section: "tutorial" },
    );
    expect(formatItemMatches(tutorial, FORMAT, "tutorials")).toBe(true);
    expect(
      formatItemMatches(item("Clone yourself editing tutorial #TRIPBABY"), FORMAT, "tutorials"),
    ).toBe(true);
    expect(
      formatItemMatches(
        item("TRIP BABY crash zoom tutorial", "Beat synced crash zooms"),
        FORMAT,
        "tutorials",
      ),
    ).toBe(false);
    // The same source can be a valid result for another selected visual format.
    const zooms = {
      ...FORMAT,
      key: "trip-baby-crash-zooms",
      name: { en: "TRIP BABY crash zooms" },
      visualPattern: { en: "Beat synced crash zooms" },
    };
    expect(formatItemMatches(item("TRIP BABY crash zoom tutorial"), zooms, "tutorials")).toBe(true);
  });

  it("does not confuse voice cloning with repeated visual figures", () => {
    const voice = item(
      "TRIP BABY voice cloning tutorial: clone yourself",
      "Make an AI copy of your voice",
    );
    expect(formatItemMatches(voice, FORMAT, "tutorials")).toBe(false);
    expect(formatItemMatches(voice, FORMAT, "examples")).toBe(false);
    const visual = item(
      "TRIP BABY voice cloning and visual edit tutorial: clone yourself",
      "Rotoscope cutout figures and duplicate video layers for the montage",
    );
    expect(formatItemMatches(visual, FORMAT, "tutorials")).toBe(true);
  });

  it("keeps an already reviewed reference despite missing new search metadata, without inventing a tutorial", () => {
    const known = item("Feeling out of place lately", "", {
      platform: "ig",
      url: "https://www.instagram.com/p/DdP6LgrT_aD/?tracking=1",
    });
    expect(formatItemMatches(known, FORMAT, "examples")).toBe(true);
    expect(formatItemMatches(known, FORMAT, "tutorials")).toBe(false);
  });

  it("constrains named formats too, rather than treating a format name as a visual inspection", () => {
    const named: EditFormat = {
      ...FORMAT,
      audio: undefined,
      namedFormat: "Paper Portal",
      name: { en: "Paper Portal" },
      visualPattern: { en: "Rotating split screen panels" },
    };
    expect(
      formatItemMatches(
        item("Paper Portal tutorial", "Rotate split screen panels with keyframes"),
        named,
        "tutorials",
      ),
    ).toBe(true);
    expect(
      formatItemMatches(
        item("Paper Portal review", "Stationery and paper products"),
        named,
        "examples",
      ),
    ).toBe(false);
  });

  it("filters and recounts all result sections without mutating the ordinary cached answer or inventing creators", () => {
    const valid = item("TRIP BABY repeating figures tutorial", "A full editing breakdown", {
      handle: "@editor",
      stats: { views: 50 },
      offTopic: true,
    });
    const noise = item("A$AP Rocky fashion news", "TRIP BABY", {
      handle: "news",
      stats: { views: 9000 },
    });
    const answer: DiscoverAnswer = {
      topicKey: "raw-search",
      understood: { label: { en: "Raw search", ar: "بحث" }, exact: false },
      alternatives: [{ exact: true }],
      items: [valid, noise],
      creators: [
        {
          platform: "yt",
          handle: "editor",
          url: "https://www.youtube.com/@editor",
          count: 9,
          views: 5000,
        },
        {
          platform: "yt",
          handle: "news",
          url: "https://www.youtube.com/@news",
          count: 1,
          views: 9000,
        },
      ],
      platforms: { yt: { ok: true }, ig: { ok: false, error: "quota" } },
      cost: { tavily: 4, youtubeSearch: 2 },
      cached: true,
      complete: true,
    };
    const before = structuredClone(answer);
    const filtered = filterFormatAnswer(answer, FORMAT, "tutorials");
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].offTopic).toBeUndefined();
    expect(filtered.creators).toEqual([
      {
        platform: "yt",
        handle: "editor",
        url: "https://www.youtube.com/@editor",
        count: 1,
        views: 50,
      },
    ]);
    expect(filtered.alternatives).toEqual([]);
    expect(filtered.cost).toEqual(answer.cost);
    expect(filtered.platforms).toEqual(answer.platforms);
    expect(answer).toEqual(before);
    const empty = filterFormatAnswer({ ...answer, items: [noise] }, FORMAT, "tutorials");
    expect(empty.items).toEqual([]);
    expect(empty.creators).toEqual([]);
  });
});
