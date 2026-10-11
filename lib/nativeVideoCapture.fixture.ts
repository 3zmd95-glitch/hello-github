import { nativeVideoCaptureHash, type NativeVideoCapture } from "./nativeVideoCapture";
import type { CapturedVideoReviewRequest, CapturedVideoReviewResponse } from "./discoverVisual";

/** Synthetic bounded JPEG headers for schema/UI tests; never native footage or a live model result. */
export function nativeCaptureFixture(now = Date.now()): NativeVideoCapture {
  const capturedAt = new Date(now - 10_000).toISOString();
  return {
    version: 1,
    provenance: "browser-visible-video",
    platform: "tt",
    url: "https://www.tiktok.com/@editor/video/1234567890123456789",
    capturedAt,
    durationSeconds: 12,
    frames: [0, 6].map((timestampSeconds, index) => ({
      timestampSeconds,
      capturedAt: new Date(now - 10_000 + index * 1_000).toISOString(),
      dataUrl:
        "data:image/jpeg;base64," +
        btoa(
          String.fromCharCode(
            255,
            216,
            255,
            192,
            0,
            11,
            8,
            0,
            2,
            0,
            2 + index,
            1,
            1,
            17,
            0,
            255,
            217,
          ),
        ),
    })),
  };
}

export function capturedReviewRequestFixture(now = Date.now()): CapturedVideoReviewRequest {
  return {
    provider: "chatgpt",
    model: "gpt-6-astra",
    effort: "max",
    accountId: "selected-account",
    genreId: "coffee",
    lang: "en",
    allowModel: true,
    capture: nativeCaptureFixture(now),
  };
}

export async function capturedReviewResponseFixture(
  request = capturedReviewRequestFixture(),
  now = Date.now(),
): Promise<Extract<CapturedVideoReviewResponse, { status: "assessed" }>> {
  const { provider, model, effort, accountId, capture, genreId } = request;
  const checkedAt = new Date(now).toISOString();
  return {
    status: "assessed",
    selection: { provider, model, effort, accountId },
    cached: false,
    modelCalls: 1,
    source: {
      status: "available",
      url: capture.url,
      observedAt: checkedAt,
      provenance: "tiktok-public-page",
      caption: "#coffee",
      author: "editor",
      likes: 2000,
      views: 50000,
      published: checkedAt,
    },
    visual: {
      version: 1,
      rubricVersion: 2,
      url: capture.url,
      genreId,
      checkedAt,
      provider,
      model,
      effort,
      source: {
        provenance: "tiktok-public-page",
        caption: "#coffee",
        author: "editor",
        observedAt: checkedAt,
        sha256: "a".repeat(64),
      },
      media: {
        provenance: "browser-visible-video",
        observedAt: capture.capturedAt,
        durationSeconds: capture.durationSeconds,
        captureSha256: await nativeVideoCaptureHash(capture),
        frames: capture.frames.map((frame, index) => ({
          timestampSeconds: frame.timestampSeconds,
          capturedAt: frame.capturedAt,
          sha256: (index ? "b" : "c").repeat(64),
        })),
      },
      assessment: {
        category: "supported",
        categoryFrames: [0, 1],
        observations: [
          {
            cue: "compositing",
            origin: "uploader-added",
            description: "Cup cutouts layered over a hand drawn title.",
            frames: [0, 1],
          },
        ],
        cinematography: null,
        uncertainty: "Selected screenshots only; motion and audio are unverified.",
      },
      limitations: ["sampled_frames", "motion_partial", "audio_unverified"],
    },
  };
}
