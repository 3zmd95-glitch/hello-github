import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { lookupInstagramMedia } from "../../workers/scout/src/instagramMedia";
import { instagramPostUrl } from "../../workers/scout/src/instagramPreview";

const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const MAX_FRAME_BYTES = 512 * 1024;
const MAX_DURATION_SECONDS = 90;
const FRAME_COUNT = 8;
const TIMEOUT_MS = 35000;
const SOURCE = "instagram-public-embed-video" as const;

export type FormatVideoFailure =
  | "source-unavailable"
  | "too-large"
  | "too-long"
  | "download-failed"
  | "decoder-unavailable"
  | "decode-failed"
  | "cancelled";

export type InstagramFramesResult =
  | {
      status: "available";
      source: typeof SOURCE;
      sourceUrl: string;
      observedAt: string;
      durationSeconds: number;
      videoSha256: string;
      frames: Array<{
        mime: "image/jpeg";
        bytes: Buffer;
        timestampSeconds: number;
        sha256: string;
      }>;
    }
  | { status: "unavailable"; source: typeof SOURCE; sourceUrl: string; reason: FormatVideoFailure };

type RunProcess = (
  executable: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;
/** Trusted test seam; never populated from a request or public source metadata. */
export interface FormatVideoOptions {
  runProcess?: RunProcess;
}

class VideoError extends Error {
  constructor(readonly reason: FormatVideoFailure) {
    super(reason);
  }
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const runProcess: RunProcess = (executable, args, signal) =>
  new Promise((resolveOutput, reject) => {
    if (signal.aborted) {
      reject(new VideoError("cancelled"));
      return;
    }
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stderrBytes = 0;
    let failed = false;
    const abort = () => {
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length + chunk.length > 64 * 1024) {
        failed = true;
        abort();
        return;
      }
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 16 * 1024) {
        failed = true;
        abort();
      }
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      signal.removeEventListener("abort", abort);
      reject(new VideoError(error.code === "ENOENT" ? "decoder-unavailable" : "decode-failed"));
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new VideoError("cancelled"));
      else if (code !== 0 || failed) reject(new VideoError("decode-failed"));
      else resolveOutput(output);
    });
  });

async function downloadVideo(
  url: string,
  doFetch: typeof fetch,
  signal: AbortSignal,
): Promise<Buffer> {
  const response = await doFetch(url, {
    headers: { Accept: "video/mp4", Referer: "https://www.instagram.com/" },
    credentials: "omit",
    redirect: "manual",
    signal,
  });
  if (
    !response.ok ||
    response.status !== 200 ||
    !response.headers.get("content-type")?.toLowerCase().startsWith("video/mp4") ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new VideoError("download-failed");
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_VIDEO_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new VideoError("too-large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  const cancelRead = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancelRead, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new VideoError("cancelled");
      const next = await reader.read();
      if (signal.aborted) throw new VideoError("cancelled");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_VIDEO_BYTES) throw new VideoError("too-large");
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    signal.removeEventListener("abort", cancelRead);
    await reader.cancel().catch(() => undefined);
  }
  const bytes = Buffer.concat(chunks, size);
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp")
    throw new VideoError("download-failed");
  return bytes;
}

/** Requested seek positions spread over the clip; each frame is decoded nearest that position. */
export function formatFrameTimestamps(duration: number): number[] {
  const last = Math.max(0, duration - Math.min(0.25, duration / 10));
  return Array.from({ length: FRAME_COUNT }, (_, index) =>
    Number(((last * index) / (FRAME_COUNT - 1)).toFixed(3)),
  );
}

/** Fetch an exact public post's clip, then decode only a small sample of local JPEGs. */
export async function extractInstagramFrames(
  input: string,
  doFetch: typeof fetch = fetch,
  signal?: AbortSignal,
  options: FormatVideoOptions = {},
): Promise<InstagramFramesResult> {
  const sourceUrl = instagramPostUrl(input) ?? "";
  const unavailable = (reason: FormatVideoFailure): InstagramFramesResult => ({
    status: "unavailable",
    source: SOURCE,
    sourceUrl,
    reason,
  });
  if (!sourceUrl) return unavailable("source-unavailable");
  if (signal?.aborted) return unavailable("cancelled");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT_MS);
  const run = options.runProcess ?? runProcess;
  const parent = resolve(tmpdir());
  let directory: string | undefined;
  let decoding = false;
  try {
    const media = await lookupInstagramMedia(sourceUrl, doFetch, controller.signal);
    if (controller.signal.aborted) throw new VideoError("cancelled");
    if (media.status !== "available") throw new VideoError("source-unavailable");
    if (media.video.durationSeconds > MAX_DURATION_SECONDS) throw new VideoError("too-long");
    const bytes = await downloadVideo(media.video.url, doFetch, controller.signal);
    directory = await mkdtemp(join(parent, "3z-format-video-"));
    const inputFile = join(directory, "source.mp4");
    await writeFile(inputFile, bytes);
    decoding = true;
    const probeText = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-max_alloc",
        "67108864",
        "-protocol_whitelist",
        "file",
        "-f",
        "mov",
        "-enable_drefs",
        "0",
        "-use_absolute_path",
        "0",
        "-i",
        inputFile,
        "-select_streams",
        "v:0",
        "-show_entries",
        "format=duration:stream=codec_type,width,height",
        "-of",
        "json",
      ],
      controller.signal,
    );
    let probe: {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    try {
      probe = JSON.parse(probeText);
    } catch {
      throw new VideoError("decode-failed");
    }
    const durationSeconds = Number(probe.format?.duration);
    const stream = probe.streams?.[0];
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      stream?.codec_type !== "video" ||
      !Number.isInteger(stream.width) ||
      !Number.isInteger(stream.height) ||
      !stream.width ||
      stream.width < 0 ||
      !stream.height ||
      stream.height < 0 ||
      stream.width > 4096 ||
      stream.height > 4096
    )
      throw new VideoError("decode-failed");
    if (durationSeconds > MAX_DURATION_SECONDS) throw new VideoError("too-long");
    const frames: Extract<InstagramFramesResult, { status: "available" }>["frames"] = [];
    const timestamps = formatFrameTimestamps(durationSeconds);
    // Two decoder processes at a time; every child settles before temporary files are removed.
    for (let index = 0; index < timestamps.length; index += 2) {
      const batch = await Promise.allSettled(
        timestamps.slice(index, index + 2).map(async (timestampSeconds, offset) => {
          const frameFile = join(directory!, `frame-${index + offset}.jpg`);
          await run(
            "ffmpeg",
            [
              "-nostdin",
              "-v",
              "error",
              "-max_alloc",
              "67108864",
              "-y",
              "-threads",
              "1",
              "-protocol_whitelist",
              "file",
              "-f",
              "mov",
              "-enable_drefs",
              "0",
              "-use_absolute_path",
              "0",
              "-ss",
              timestampSeconds.toFixed(3),
              "-i",
              inputFile,
              "-map",
              "0:v:0",
              "-an",
              "-sn",
              "-dn",
              "-frames:v",
              "1",
              "-vf",
              "scale=640:640:force_original_aspect_ratio=decrease",
              "-filter_threads",
              "1",
              "-q:v",
              "4",
              "-threads",
              "1",
              frameFile,
            ],
            controller.signal,
          );
          const info = await stat(frameFile);
          if (!info.isFile() || info.size < 3 || info.size > MAX_FRAME_BYTES)
            throw new VideoError("decode-failed");
          const frameBytes = await readFile(frameFile);
          if (frameBytes[0] !== 0xff || frameBytes[1] !== 0xd8 || frameBytes[2] !== 0xff)
            throw new VideoError("decode-failed");
          return {
            mime: "image/jpeg" as const,
            bytes: frameBytes,
            timestampSeconds,
            sha256: hash(frameBytes),
          };
        }),
      );
      for (const result of batch) {
        if (result.status === "rejected") throw result.reason;
        frames.push(result.value);
      }
    }
    return {
      status: "available",
      source: SOURCE,
      sourceUrl,
      observedAt: new Date().toISOString(),
      durationSeconds,
      videoSha256: hash(bytes),
      frames,
    };
  } catch (error) {
    return unavailable(
      controller.signal.aborted
        ? "cancelled"
        : error instanceof VideoError
          ? error.reason
          : decoding
            ? "decode-failed"
            : "download-failed",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (directory) {
      const owned = resolve(directory);
      // Only this call's mkdtemp result, directly inside the OS temporary directory, may be removed.
      if (dirname(owned) === parent && basename(owned).startsWith("3z-format-video-")) {
        await rm(owned, { recursive: true, force: true });
      }
    }
  }
}
