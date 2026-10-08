import { access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractInstagramFrames,
  formatFrameTimestamps,
  type FormatVideoOptions,
} from "./formatVideo";

const POST = "https://www.instagram.com/p/DdP6LgrT_aD/";
const VIDEO = "https://instagram.example.fbcdn.net/video.mp4";
const VIDEO_BYTES = Buffer.from("0000ftypisom0000synthetic fixture");
function source(duration = 15.916) {
  const value = {
    context: { type: "GraphVideo", shortcode: "DdP6LgrT_aD", copyright_blocked: false },
    gql_data: {
      shortcode_media: {
        __typename: "GraphVideo",
        shortcode: "DdP6LgrT_aD",
        is_video: true,
        video_url: VIDEO,
        video_duration: duration,
        dimensions: { width: 502, height: 886 },
      },
    },
  };
  return new Response(`<script>{"contextJSON":${JSON.stringify(JSON.stringify(value))}}</script>`, {
    headers: { "Content-Type": "text/html" },
  });
}
function fetchFixture(duration = 15.916, media?: () => Response) {
  return vi.fn<typeof fetch>(async (input) =>
    String(input) === VIDEO
      ? (media?.() ?? new Response(VIDEO_BYTES, { headers: { "Content-Type": "video/mp4" } }))
      : source(duration),
  );
}
function processFixture(duration = 15.916) {
  return vi.fn<NonNullable<FormatVideoOptions["runProcess"]>>(async (executable, args) => {
    if (executable === "ffprobe")
      return JSON.stringify({
        format: { duration: String(duration) },
        streams: [{ codec_type: "video", width: 502, height: 886 }],
      });
    await writeFile(
      args.at(-1)!,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(args[args.indexOf("-ss") + 1])]),
    );
    return "";
  });
}

describe("bounded Instagram video frame sampling", () => {
  it("samples eight positions across the entire clip and returns only hashed JPEG bytes", async () => {
    const doFetch = fetchFixture(61.322);
    const runProcess = processFixture(61.322);
    const result = await extractInstagramFrames(POST, doFetch, undefined, { runProcess });
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.frames).toHaveLength(8);
    expect(result.frames[0].timestampSeconds).toBe(0);
    expect(result.frames.at(-1)?.timestampSeconds).toBeGreaterThan(61);
    expect(result.videoSha256).toMatch(/^[a-f\d]{64}$/);
    expect(
      result.frames.every((frame) => frame.mime === "image/jpeg" && frame.sha256.length === 64),
    ).toBe(true);
    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(doFetch.mock.calls[1][1]).toEqual(
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
    const probeArgs = runProcess.mock.calls[0][1];
    const localFile = probeArgs[probeArgs.indexOf("-i") + 1];
    expect(localFile).not.toContain("https:");
    await expect(access(dirname(localFile))).rejects.toThrow();
    for (const [, args] of runProcess.mock.calls) {
      expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("file");
      expect(args).toContain("-enable_drefs");
      expect(args).not.toContain(VIDEO);
    }
  });
  it("rejects source and decoded durations beyond ninety seconds", async () => {
    const doFetch = fetchFixture(91);
    const runProcess = processFixture();
    expect(await extractInstagramFrames(POST, doFetch, undefined, { runProcess })).toMatchObject({
      status: "unavailable",
      reason: "too-long",
    });
    expect(doFetch).toHaveBeenCalledOnce();
    expect(runProcess).not.toHaveBeenCalled();
    const probe = processFixture(91);
    expect(
      await extractInstagramFrames(POST, fetchFixture(), undefined, { runProcess: probe }),
    ).toMatchObject({ status: "unavailable", reason: "too-long" });
    expect(probe).toHaveBeenCalledOnce();
    await expect(
      access(dirname(probe.mock.calls[0][1][probe.mock.calls[0][1].indexOf("-i") + 1])),
    ).rejects.toThrow();
  });
  it("enforces both declared and streamed byte limits", async () => {
    for (const media of [
      () =>
        new Response("small", {
          headers: { "Content-Type": "video/mp4", "Content-Length": String(13 * 1024 * 1024) },
        }),
      () =>
        new Response(new Uint8Array(12 * 1024 * 1024 + 1), {
          headers: { "Content-Type": "video/mp4" },
        }),
    ]) {
      const runProcess = processFixture();
      expect(
        await extractInstagramFrames(POST, fetchFixture(15, media), undefined, { runProcess }),
      ).toMatchObject({ status: "unavailable", reason: "too-large" });
      expect(runProcess).not.toHaveBeenCalled();
    }
  });
  it("rejects redirects, non-MP4 responses and forged MP4 content", async () => {
    for (const media of [
      () => new Response(null, { status: 302 }),
      () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
      () =>
        new Response("#EXTM3U https://internal/secret", {
          headers: { "Content-Type": "video/mp4" },
        }),
    ])
      expect(
        await extractInstagramFrames(POST, fetchFixture(15, media), undefined, {
          runProcess: processFixture(),
        }),
      ).toMatchObject({ status: "unavailable", reason: "download-failed" });
  });
  it("fails closed on invalid decoded output and cleans its own temporary directory", async () => {
    const runProcess = processFixture();
    runProcess.mockImplementationOnce(async () => "not JSON");
    const result = await extractInstagramFrames(POST, fetchFixture(), undefined, { runProcess });
    expect(result).toMatchObject({ status: "unavailable", reason: "decode-failed" });
    const args = runProcess.mock.calls[0][1];
    await expect(access(dirname(args[args.indexOf("-i") + 1]))).rejects.toThrow();
  });
  it("does not silently fall back to a thumbnail after cancellation or a missing public clip", async () => {
    const doFetch = fetchFixture();
    expect(await extractInstagramFrames(POST, doFetch, AbortSignal.abort())).toMatchObject({
      status: "unavailable",
      reason: "cancelled",
    });
    expect(doFetch).not.toHaveBeenCalled();
    expect(
      await extractInstagramFrames(POST, async () => new Response(null, { status: 404 })),
    ).toMatchObject({ status: "unavailable", reason: "source-unavailable" });
  });
  it("cancels a stalled response body without waiting for the network to finish", async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    const doFetch = fetchFixture(
      15,
      () =>
        new Response(new ReadableStream({ cancel: cancelled }), {
          headers: { "Content-Type": "video/mp4" },
        }),
    );
    const pending = extractInstagramFrames(POST, doFetch, controller.signal);
    await vi.waitFor(() => expect(doFetch).toHaveBeenCalledTimes(2));
    controller.abort();
    expect(await pending).toMatchObject({ status: "unavailable", reason: "cancelled" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("returns an explicit missing-decoder result and removes the owned input file", async () => {
    vi.stubEnv("PATH", "");
    try {
      expect(await extractInstagramFrames(POST, fetchFixture())).toMatchObject({
        status: "unavailable",
        reason: "decoder-unavailable",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("rejects invalid decoded dimensions and oversized output frames", async () => {
    for (const width of [-5, 2.5, 8192]) {
      const runProcess = processFixture();
      runProcess.mockImplementationOnce(async () =>
        JSON.stringify({
          format: { duration: "15" },
          streams: [{ codec_type: "video", width, height: 640 }],
        }),
      );
      expect(
        await extractInstagramFrames(POST, fetchFixture(), undefined, { runProcess }),
      ).toMatchObject({ status: "unavailable", reason: "decode-failed" });
      expect(runProcess).toHaveBeenCalledOnce();
    }
    const oversized = processFixture();
    oversized.mockImplementation(async (executable, args) => {
      if (executable === "ffprobe")
        return JSON.stringify({
          format: { duration: "15" },
          streams: [{ codec_type: "video", width: 502, height: 886 }],
        });
      await writeFile(args.at(-1)!, Buffer.alloc(512 * 1024 + 1));
      return "";
    });
    expect(
      await extractInstagramFrames(POST, fetchFixture(), undefined, { runProcess: oversized }),
    ).toMatchObject({ status: "unavailable", reason: "decode-failed" });
  });
  it("keeps positions within even very short clips", () => {
    const times = formatFrameTimestamps(0.2);
    expect(times).toHaveLength(8);
    expect(times.at(-1)).toBeLessThan(0.2);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
