import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import {
  applicableDiscoverVisual,
  CapturedVideoReviewResponseSchema,
  canonicalDiscoverVisualEvidenceUrl,
  discoverVisualMediaMatches,
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
const visual: DiscoverVisual & {
  media: Extract<DiscoverVisual["media"], { provenance: "instagram-public-embed-video" }>;
} = {
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
  it("reuses dated frame judgments without renewing them or accepting future checks", () => {
    expect(discoverVisualSourceMatches(visual, item)).toBe(true);
    for (const days of [1, 7, 60]) {
      const later = now + days * DISCOVER_VISUAL_TTL_MS;
      const refreshed = {
        ...item,
        evidence: { ...item.evidence!, observedAt: new Date(later).toISOString(), likes: 3000 },
      };
      for (const current of [item, refreshed])
        expect(applicableDiscoverVisual({ genreId: "anime", visual }, current, later)).toEqual(
          visual,
        );
    }
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

describe("captured screenshot visual evidence", () => {
  const ttUrl = "https://www.tiktok.com/@editor/video/7137219803013500203";
  const ttSource = {
    status: "available" as const,
    url: ttUrl,
    provenance: "tiktok-public-page" as const,
    observedAt: when,
    caption: source.description,
    author: source.author,
    likes: 2000,
  };
  const captured: DiscoverVisual = {
    ...visual,
    url: ttUrl,
    source: { ...visual.source, provenance: "tiktok-public-page" },
    media: {
      provenance: "browser-visible-video",
      observedAt: when,
      durationSeconds: 30,
      captureSha256: "b".repeat(64),
      frames: visual.media.frames.map((frame) => ({ ...frame, capturedAt: when })),
    },
  };
  const ttItem: DiscoverItem = {
    ...item,
    platform: "tt",
    url: ttUrl,
    evidence: { ...item.evidence!, source: "tiktok-public-page" },
  };
  it("keeps Instagram-only identities strict while source-bound screenshot assessments are reusable", () => {
    expect(canonicalDiscoverVisualUrl(ttUrl)).toBeNull();
    expect(canonicalDiscoverVisualEvidenceUrl(ttUrl)).toBe(ttUrl);
    expect(DiscoverVisualSchema.safeParse(captured).success).toBe(true);
    expect(
      applicableDiscoverVisual({ genreId: "anime", visual: captured }, ttItem, now + 7 * 86400000),
    ).toEqual(captured);
    expect(hasDiscoverVisualCraft(captured)).toBe(true);
    for (const altered of [
      { ...ttItem, url: ttUrl.replace("editor", "someone") },
      { ...ttItem, evidence: { ...ttItem.evidence!, caption: "Changed" } },
      { ...ttItem, evidence: { ...ttItem.evidence!, author: "other" } },
      { ...ttItem, evidence: { ...ttItem.evidence!, availability: "unavailable" as const } },
    ])
      expect(
        applicableDiscoverVisual({ genreId: "anime", visual: captured }, altered, now),
      ).toBeUndefined();
    expect(
      applicableDiscoverVisual(
        {
          genreId: "anime",
          visual: { ...captured, checkedAt: new Date(now + 600000).toISOString() },
        },
        ttItem,
        now,
      ),
    ).toBeUndefined();
  });
  it("rejects fabricated original-video provenance, mixed source identities, repeated pixels and invalid citations", () => {
    for (const bad of [
      { ...captured, media: { ...captured.media, videoSha256: "a".repeat(64) } },
      { ...captured, source: visual.source },
      { ...captured, media: visual.media },
      { ...captured, url },
      {
        ...captured,
        media: {
          ...captured.media,
          frames: [
            captured.media.frames[0],
            { ...captured.media.frames[1], sha256: captured.media.frames[0].sha256 },
          ],
        },
      },
      { ...captured, assessment: { ...captured.assessment, categoryFrames: [7] } },
    ])
      expect(DiscoverVisualSchema.safeParse(bad).success).toBe(false);
    expect(
      hasDiscoverVisualCraft({
        ...captured,
        assessment: { ...captured.assessment, observations: [] },
      }),
    ).toBe(false);
    const changed = {
      ...captured,
      media: { ...captured.media, captureSha256: "f".repeat(64) },
    } as DiscoverVisual;
    expect(discoverVisualMediaMatches(captured, changed)).toBe(false);
    expect(
      applicableDiscoverVisual(
        {
          genreId: "anime",
          visual: captured,
          visualObservation: {
            version: changed.version,
            url: changed.url,
            genreId: changed.genreId,
            checkedAt: changed.checkedAt,
            source: changed.source,
            media: changed.media,
          },
        },
        ttItem,
        now,
      ),
    ).toBeUndefined();
  });
  it("keeps response source, capture and selection provenance independent of metadata counts", () => {
    const response = {
      status: "assessed",
      selection: { provider: "chatgpt", model: captured.model, effort: captured.effort },
      visual: captured,
      source: ttSource,
      cached: false,
      modelCalls: 1,
    };
    expect(CapturedVideoReviewResponseSchema.safeParse(response).success).toBe(true);
    expect(DiscoverVisualResponseSchema.safeParse(response).success).toBe(false);
    for (const bad of [
      { ...response, source: { ...ttSource, author: "other" } },
      { ...response, source: { ...ttSource, caption: "changed" } },
      { ...response, source: { ...ttSource, status: "unknown" } },
      { ...response, visual },
      { ...response, cached: true },
      { ...response, selection: { ...response.selection, model: "fallback" } },
    ])
      expect(CapturedVideoReviewResponseSchema.safeParse(bad).success).toBe(false);
    const input = JSON.parse(discoverVisualInput("anime", ttSource, captured.media));
    expect(input.source).toEqual({ caption: source.description, author: source.author });
    expect(input.sampling.limitations).toContain("not original media");
    expect(input.sampling.limitations).toContain("approximate");
  });
});
