import { z } from "zod";

export const NATIVE_VIDEO_CAPTURE_MAX_BYTES = 2 * 1024 * 1024;
export const NATIVE_VIDEO_FRAME_MAX_BYTES = 160 * 1024;

/** Identity only; this module never opens a browser or fetches media. */
export function canonicalNativeVideoUrl(input: string): string | null {
  if (/[\\\u0000-\u0020\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !["www.tiktok.com", "tiktok.com"].includes(url.hostname) ||
      !/^\/@[\w.-]+\/video\/\d{15,22}\/?$/.test(url.pathname)
    )
      return null;
    return `https://www.tiktok.com${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

/** Bounded JPEG header validation, including dimensions, before transporting user pixels. */
function validJpeg(dataUrl: string): boolean {
  const encoded = dataUrl.slice("data:image/jpeg;base64,".length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  let bytes: string;
  try {
    bytes = atob(encoded);
  } catch {
    return false;
  }
  if (
    bytes.length > NATIVE_VIDEO_FRAME_MAX_BYTES ||
    bytes.length < 12 ||
    bytes.charCodeAt(0) !== 255 ||
    bytes.charCodeAt(1) !== 216 ||
    bytes.charCodeAt(bytes.length - 2) !== 255 ||
    bytes.charCodeAt(bytes.length - 1) !== 217
  )
    return false;
  const word = (at: number) => bytes.charCodeAt(at) * 256 + bytes.charCodeAt(at + 1);
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes.charCodeAt(offset++) !== 255) return false;
    while (bytes.charCodeAt(offset) === 255) offset++;
    const marker = bytes.charCodeAt(offset++);
    if (marker === 218 || marker === 217) return false;
    const length = word(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([192, 193, 194].includes(marker)) {
      const height = word(offset + 3),
        width = word(offset + 5);
      return length >= 8 && width > 0 && height > 0 && Math.max(width, height) <= 960;
    }
    offset += length;
  }
  return false;
}

const Frame = z.strictObject({
  timestampSeconds: z.number().min(0).max(90),
  capturedAt: z.string().datetime(),
  dataUrl: z
    .string()
    .startsWith("data:image/jpeg;base64,")
    .max(22 + Math.ceil(NATIVE_VIDEO_FRAME_MAX_BYTES / 3) * 4)
    .refine(validJpeg, "Invalid bounded JPEG"),
});
export const NativeVideoCaptureSchema = z
  .strictObject({
    version: z.literal(1),
    provenance: z.literal("browser-visible-video"),
    platform: z.literal("tt"),
    url: z
      .string()
      .max(1000)
      .refine((url) => canonicalNativeVideoUrl(url) === url),
    capturedAt: z.string().datetime(),
    durationSeconds: z.number().positive().max(90),
    frames: z.array(Frame).min(2).max(8),
  })
  .superRefine((capture, ctx) => {
    if (
      capture.capturedAt !== capture.frames[0]?.capturedAt ||
      new Set(capture.frames.map((frame) => frame.dataUrl)).size !== capture.frames.length ||
      capture.frames.some(
        (frame, index, frames) =>
          frame.timestampSeconds > capture.durationSeconds ||
          (index > 0 &&
            (frame.timestampSeconds - frames[index - 1].timestampSeconds < 0.1 - 1e-8 ||
              Date.parse(frame.capturedAt) < Date.parse(frames[index - 1].capturedAt))),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid or repeated capture timeline" });
  });
export type NativeVideoCapture = z.infer<typeof NativeVideoCaptureSchema>;

/** Hashes the validated, fixed-order snapshot including every supplied image and original date. */
export async function nativeVideoCaptureHash(capture: NativeVideoCapture): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(NativeVideoCaptureSchema.parse(capture)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}
