// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  NativeVideoCaptureSchema,
  canonicalNativeVideoUrl,
  nativeVideoCaptureHash,
  NATIVE_VIDEO_FRAME_MAX_BYTES,
} from "./nativeVideoCapture";

const jpeg = (value: number, width = 960) =>
  "data:image/jpeg;base64," +
  Buffer.from([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    0,
    10,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    value,
    255,
    217,
  ]).toString("base64");
const capture = {
  version: 1 as const,
  provenance: "browser-visible-video" as const,
  platform: "tt" as const,
  url: "https://www.tiktok.com/@editor/video/7137219803013500203",
  capturedAt: "2026-10-11T08:00:00.000Z",
  durationSeconds: 30,
  frames: [0, 1].map((value) => ({
    timestampSeconds: value * 5,
    capturedAt: `2026-10-11T08:00:0${value}.000Z`,
    dataUrl: jpeg(value),
  })),
};

describe("manual native video screenshot boundary", () => {
  it("canonicalizes public TikTok posts only, keeping imports canonical", () => {
    expect(canonicalNativeVideoUrl(capture.url.replace("www.", "") + "/?tracking=1")).toBe(
      capture.url,
    );
    for (const url of [
      "http://www.tiktok.com/@editor/video/7137219803013500203",
      capture.url.replace(".com", ".com.evil.test"),
      capture.url.replace("www.", "user@www."),
      capture.url.replace("www.", "www.\\"),
      "https://www.tiktok.com/@editor",
      "https://vm.tiktok.com/123/",
    ]) {
      expect(canonicalNativeVideoUrl(url)).toBeNull();
      expect(NativeVideoCaptureSchema.safeParse({ ...capture, url }).success).toBe(false);
    }
    expect(
      NativeVideoCaptureSchema.safeParse({ ...capture, url: capture.url + "?tracking=1" }).success,
    ).toBe(false);
  });
  it("binds hashes to every image, timestamp and original date independent of object insertion order", async () => {
    expect(NativeVideoCaptureSchema.safeParse(capture).success).toBe(true);
    const hash = await nativeVideoCaptureHash(capture);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const { frames: reorderedFrames, ...rest } = capture;
    expect(await nativeVideoCaptureHash({ frames: reorderedFrames, ...rest })).toBe(hash);
    for (const frames of [
      [{ ...capture.frames[0], dataUrl: jpeg(3) }, capture.frames[1]],
      [capture.frames[0], { ...capture.frames[1], timestampSeconds: 6 }],
      [capture.frames[0], { ...capture.frames[1], capturedAt: "2026-10-11T08:00:02.000Z" }],
    ])
      expect(await nativeVideoCaptureHash({ ...capture, frames })).not.toBe(hash);
  });
  it("rejects fake video provenance, extra fields, duplicate/too-close moments and inconsistent dates", () => {
    for (const invalid of [
      { ...capture, videoSha256: "a".repeat(64) },
      { ...capture, provenance: "instagram-public-embed-video" },
      { ...capture, frames: [capture.frames[0]] },
      { ...capture, frames: Array(9).fill(capture.frames[0]) },
      { ...capture, durationSeconds: 91 },
      { ...capture, durationSeconds: 4 },
      { ...capture, capturedAt: "2026-10-11T07:00:00.000Z" },
      { ...capture, frames: [capture.frames[0], { ...capture.frames[1], timestampSeconds: 0.05 }] },
      {
        ...capture,
        frames: [capture.frames[0], { ...capture.frames[1], dataUrl: capture.frames[0].dataUrl }],
      },
      {
        ...capture,
        frames: [
          capture.frames[0],
          { ...capture.frames[1], capturedAt: "2026-10-11T07:59:59.000Z" },
        ],
      },
    ])
      expect(NativeVideoCaptureSchema.safeParse(invalid).success).toBe(false);
  });
  it("bounds decoded JPEG bytes and dimensions and rejects non-JPEG payloads", () => {
    for (const dataUrl of [
      jpeg(1, 961),
      "data:image/png;base64,/9j/",
      "data:image/jpeg;base64,AAAA",
      "data:image/jpeg;base64,!!!!",
      "data:image/jpeg;base64," + Buffer.alloc(NATIVE_VIDEO_FRAME_MAX_BYTES + 1).toString("base64"),
    ])
      expect(
        NativeVideoCaptureSchema.safeParse({
          ...capture,
          frames: [{ ...capture.frames[0], dataUrl }, capture.frames[1]],
        }).success,
      ).toBe(false);
  });
});
