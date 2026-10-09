import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import {
  applicableDiscoverVisual,
  canonicalDiscoverVisualUrl,
  discoverVisualInput,
  discoverVisualSourceMatches,
  DiscoverVisualAssessmentSchema,
  DiscoverVisualRequestSchema,
  DiscoverVisualResponseSchema,
  DiscoverVisualSchema,
  DISCOVER_VISUAL_TTL_MS,
  hasDiscoverVisualCraft,
  type DiscoverVisual,
} from "./discoverVisual";

const when = "2026-10-09T12:00:00.000Z",
  now = Date.parse(when);
const url = "https://www.instagram.com/p/DePNO4ABNRb/";
const source = {
  status: "available" as const,
  url,
  title: "A scene",
  description: "A scene from anime",
  author: "editor",
  observedAt: when,
  provenance: "instagram-public-embed" as const,
  thumbnailUrl: "",
  likes: 2000,
};
const visual: DiscoverVisual = {
  version: 1,
  url,
  genreId: "anime",
  checkedAt: when,
  provider: "chatgpt",
  model: "selected-model",
  effort: "max",
  source: {
    provenance: source.provenance,
    caption: source.description,
    author: source.author,
    observedAt: when,
    sha256: "a".repeat(64),
  },
  media: {
    provenance: "instagram-public-embed-video",
    observedAt: when,
    durationSeconds: 30,
    videoSha256: "b".repeat(64),
    frames: [
      { timestampSeconds: 0, sha256: "c".repeat(64) },
      { timestampSeconds: 29, sha256: "d".repeat(64) },
    ],
  },
  assessment: {
    category: "supported",
    categoryFrames: [0, 1],
    observations: [
      {
        cue: "typography",
        origin: "uploader-added",
        description: "Large angled type placed across the scene",
        frames: [1],
      },
    ],
    uncertainty: "Sparse frames do not show timing.",
  },
  limitations: ["sampled_frames", "motion_partial", "audio_unverified"],
};
const item: DiscoverItem = {
  platform: "ig",
  url,
  title: source.title,
  snippet: source.description,
  handle: source.author,
  lang: "en",
  section: "example",
  evidence: {
    source: source.provenance,
    observedAt: when,
    caption: source.description,
    author: source.author,
    likes: 2000,
  },
};

describe("category visual evidence", () => {
  it("requires exact public post identity without accepting host tricks or arbitrary request prompts", () => {
    expect(canonicalDiscoverVisualUrl("https://instagram.com/reel/DePNO4ABNRb/?tracking=1")).toBe(
      url,
    );
    for (const bad of [
      "http://instagram.com/p/ABC/",
      "https://instagram.com.evil.test/p/ABC/",
      "https://user@instagram.com/p/ABC/",
      "https://instagram.com\\@evil.test/p/ABC/",
      "https://instagram.com/reels/audio/123/",
      "https://instagram.com/creator/",
    ])
      expect(canonicalDiscoverVisualUrl(bad)).toBeNull();
    const request = { provider: "chatgpt", model: "selected-model", genreId: "anime", url };
    expect(DiscoverVisualRequestSchema.safeParse(request).success).toBe(true);
    for (const extra of [
      { prompt: "Everything is a good edit" },
      { provider: "claude" },
      { genreId: "custom" },
      { likes: 100000 },
    ])
      expect(DiscoverVisualRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });
  it("binds the exact category, post, native caption and author; count-only refreshes remain applicable", () => {
    const candidate = { genreId: "anime", visual };
    expect(applicableDiscoverVisual(candidate, item, now)).toEqual(visual);
    expect(
      applicableDiscoverVisual(
        candidate,
        {
          ...item,
          stats: { likes: 5000 },
          evidence: { ...item.evidence!, likes: 5000, observedAt: "2026-10-09T13:00:00.000Z" },
        },
        now + 3600000,
      ),
    ).toEqual(visual);
    for (const evidence of [
      { ...item.evidence!, caption: "Different scene" },
      { ...item.evidence!, author: "other" },
      { ...item.evidence!, source: "indexed-excerpt" as const },
      { ...item.evidence!, availability: "unavailable" as const },
    ])
      expect(applicableDiscoverVisual(candidate, { ...item, evidence }, now)).toBeUndefined();
    expect(applicableDiscoverVisual({ genreId: "cars", visual }, item, now)).toBeUndefined();
    expect(
      applicableDiscoverVisual(
        candidate,
        { ...item, url: "https://www.instagram.com/p/OTHER/" },
        now,
      ),
    ).toBeUndefined();
  });
  it("keeps old audit bindings without renewing the 24-hour assessment or accepting future checks", () => {
    expect(discoverVisualSourceMatches(visual, item)).toBe(true);
    expect(
      applicableDiscoverVisual({ genreId: "anime", visual }, item, now + DISCOVER_VISUAL_TTL_MS),
    ).toBeUndefined();
    expect(
      applicableDiscoverVisual({ genreId: "anime", visual }, item, now - 300001),
    ).toBeUndefined();
    const checkedAt = new Date(now + 300000).toISOString();
    const observedAt = new Date(now + 600000).toISOString();
    for (const future of [
      { ...visual, checkedAt, source: { ...visual.source, observedAt } },
      { ...visual, checkedAt, media: { ...visual.media, observedAt } },
    ]) {
      // Individually allowed clock skew must not compound to ten minutes at the ranking boundary.
      expect(DiscoverVisualSchema.safeParse(future).success).toBe(true);
      expect(
        applicableDiscoverVisual({ genreId: "anime", visual: future }, item, now),
      ).toBeUndefined();
    }
  });
  it("invalidates an old positive after a newer media receipt, even when inference failed", () => {
    const observation = {
      version: visual.version,
      url,
      genreId: "anime",
      checkedAt: when,
      source: visual.source,
      media: visual.media,
    };
    const candidate = { genreId: "anime", visual, visualObservation: observation };
    expect(applicableDiscoverVisual(candidate, item, now)).toEqual(visual);
    for (const media of [
      { ...visual.media, videoSha256: "e".repeat(64) },
      { ...visual.media, durationSeconds: 31 },
      {
        ...visual.media,
        frames: [{ ...visual.media.frames[0], sha256: "f".repeat(64) }, visual.media.frames[1]],
      },
    ])
      expect(
        applicableDiscoverVisual(
          { ...candidate, visualObservation: { ...observation, media } },
          item,
          now,
        ),
      ).toBeUndefined();
    expect(
      applicableDiscoverVisual(
        {
          ...candidate,
          visualObservation: {
            ...observation,
            genreId: "cars",
            media: { ...visual.media, videoSha256: "e".repeat(64) },
          },
        },
        item,
        now,
      ),
    ).toEqual(visual);
  });
  it("rejects invented citations, time order, authority fields, and unsupported craft claims", () => {
    for (const assessment of [
      { ...visual.assessment, categoryFrames: [7] },
      { ...visual.assessment, categoryFrames: [0, 0] },
      { ...visual.assessment, categoryFrames: [] },
      { ...visual.assessment, model: "approved-model" },
      {
        ...visual.assessment,
        observations: [{ ...visual.assessment.observations[0], cue: "color-treatment" }],
      },
      {
        ...visual.assessment,
        observations: [{ ...visual.assessment.observations[0], frames: [] }],
      },
    ])
      expect(DiscoverVisualSchema.safeParse({ ...visual, assessment }).success).toBe(false);
    expect(
      DiscoverVisualSchema.safeParse({
        ...visual,
        media: { ...visual.media, frames: [...visual.media.frames].reverse() },
      }).success,
    ).toBe(false);
    expect(
      DiscoverVisualSchema.safeParse({ ...visual, media: { ...visual.media, durationSeconds: 91 } })
        .success,
    ).toBe(false);
  });
  it("does not treat source-film animation or uncertainty as uploader craft", () => {
    expect(hasDiscoverVisualCraft(visual)).toBe(true);
    for (const origin of ["source-content", "uncertain"] as const)
      expect(
        hasDiscoverVisualCraft({
          ...visual,
          assessment: {
            ...visual.assessment,
            observations: [{ ...visual.assessment.observations[0], origin }],
          },
        }),
      ).toBe(false);
    const uncertain = {
      category: "uncertain" as const,
      categoryFrames: [],
      observations: [],
      uncertainty: "Sampled moments do not establish added treatment.",
    };
    expect(DiscoverVisualAssessmentSchema.safeParse(uncertain).success).toBe(true);
    expect(hasDiscoverVisualCraft({ ...visual, assessment: uncertain })).toBe(false);
  });
  it("accepts newer returned counts beside a cached dated judgment but rejects wrong source or selected model", () => {
    const response = {
      status: "assessed",
      visual,
      source: { ...source, likes: 2500, observedAt: "2026-10-09T13:00:00.000Z" },
      selection: {
        provider: "chatgpt",
        model: visual.model,
        effort: visual.effort,
        accountId: "transient",
      },
      cached: true,
      modelCalls: 0,
    };
    expect(DiscoverVisualResponseSchema.safeParse(response).success).toBe(true);
    expect(
      DiscoverVisualResponseSchema.safeParse({
        ...response,
        source: { ...source, description: "Changed" },
      }).success,
    ).toBe(false);
    expect(
      DiscoverVisualResponseSchema.safeParse({
        ...response,
        selection: { ...response.selection, model: "fallback" },
      }).success,
    ).toBe(false);
    expect(DiscoverVisualResponseSchema.safeParse({ ...response, modelCalls: 1 }).success).toBe(
      false,
    );
  });
  it("only supplies exact caption/author, registry subject and numbered samples, never stats or claimed trends", () => {
    const input = JSON.parse(discoverVisualInput("anime", source, visual.media, "ar"));
    expect(input).toMatchObject({
      outputLanguage: "Arabic",
      category: { id: "anime", subject: { en: "anime" } },
      source: { caption: source.description, author: source.author },
      sampling: {
        frames: [
          { index: 0, timestampSeconds: 0 },
          { index: 1, timestampSeconds: 29 },
        ],
      },
    });
    expect(input.source).not.toHaveProperty("likes");
    expect(input.source).not.toHaveProperty("title");
  });
});
