import type { DiscoverItem } from "./discover";
import {
  canonicalDiscoverVisualUrl,
  type DiscoverVisual,
  type DiscoverVisualObservation,
} from "./discoverVisual";

export function discoverVisualObservationFixture(
  visual: DiscoverVisual,
): DiscoverVisualObservation {
  return structuredClone({
    version: visual.version,
    url: visual.url,
    genreId: visual.genreId,
    checkedAt: visual.checkedAt,
    source: visual.source,
    media: visual.media,
  });
}

/** Synthetic post-bound sampled evidence shared only by ranking/persistence tests. */
export function discoverVisualFixture(
  item: DiscoverItem,
  genreId: string,
  now: number,
): DiscoverVisual {
  const checkedAt = new Date(now).toISOString();
  return {
    version: 1,
    url: canonicalDiscoverVisualUrl(item.url)!,
    genreId,
    checkedAt,
    provider: "chatgpt",
    model: "test-vision",
    effort: "high",
    source: {
      provenance: "instagram-public-embed",
      caption: item.evidence?.caption ?? "",
      author: item.evidence?.author ?? "",
      observedAt: checkedAt,
      sha256: "a".repeat(64),
    },
    media: {
      provenance: "instagram-public-embed-video",
      observedAt: checkedAt,
      durationSeconds: 12,
      videoSha256: "b".repeat(64),
      frames: [
        { timestampSeconds: 0, sha256: "c".repeat(64) },
        { timestampSeconds: 11, sha256: "d".repeat(64) },
      ],
    },
    assessment: {
      category: "supported",
      categoryFrames: [0, 1],
      observations: [
        {
          cue: "typography",
          origin: "uploader-added",
          description: "Large layered title treatment",
          frames: [1],
        },
      ],
      uncertainty: "Sparse frames cannot establish movement or audio timing.",
    },
    limitations: ["sampled_frames", "motion_partial", "audio_unverified"],
  };
}
