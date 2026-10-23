import {
  NativeVideoCaptureSchema,
  NATIVE_VIDEO_CAPTURE_MAX_BYTES,
  canonicalNativeVideoUrl,
  nativeVideoCaptureHash,
  type NativeVideoCapture,
} from "./nativeVideoCapture";
import {
  CapturedVideoReviewRequestSchema,
  CapturedVideoReviewResponseSchema,
  type CapturedVideoReviewRequest,
  type CapturedVideoReviewResponse,
} from "./discoverVisual";
import { isLocalAiHost } from "./localAi";

export type NativeCaptureImportResult =
  | { ok: true; capture: NativeVideoCapture }
  | { ok: false; error: "invalid_capture" | "capture_too_large" };

/** Read one bounded helper file into memory only. Importing never starts a source/model request. */
export async function readNativeVideoCapture(
  file: Pick<File, "size" | "name" | "text">,
): Promise<NativeCaptureImportResult> {
  if (file.size > NATIVE_VIDEO_CAPTURE_MAX_BYTES) return { ok: false, error: "capture_too_large" };
  if (!file.size || !/\.json$/i.test(file.name)) return { ok: false, error: "invalid_capture" };
  try {
    const text = await file.text();
    if (new TextEncoder().encode(text).byteLength > NATIVE_VIDEO_CAPTURE_MAX_BYTES)
      return { ok: false, error: "capture_too_large" };
    const parsed = NativeVideoCaptureSchema.safeParse(JSON.parse(text));
    return parsed.success
      ? { ok: true, capture: parsed.data }
      : { ok: false, error: "invalid_capture" };
  } catch {
    return { ok: false, error: "invalid_capture" };
  }
}

export type CapturedVideoReviewResult =
  { ok: true; data: CapturedVideoReviewResponse } | { ok: false; error: string };

/** One explicit request, using exactly the selected subscription model and effort. No fallback. */
export async function reviewCapturedVideo(
  input: CapturedVideoReviewRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CapturedVideoReviewResult> {
  if (!isLocalAiHost()) return { ok: false, error: "local_ai_unavailable" };
  const parsed = CapturedVideoReviewRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_capture" };
  const request = parsed.data;
  try {
    const response = await fetchImpl("/api/local-ai/review-captured-video", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Local-AI": "1" },
      body: JSON.stringify(request),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(190000)])
        : AbortSignal.timeout(190000),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      return { ok: false, error: "local_ai_unavailable" };
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = raw && typeof raw === "object" && "error" in raw ? raw.error : undefined;
      return { ok: false, error: typeof error === "string" ? error : "assessment_failed" };
    }
    const checked = CapturedVideoReviewResponseSchema.safeParse(raw);
    if (!checked.success) return { ok: false, error: "invalid_response" };
    const data = checked.data;
    const visual = data.status === "assessed" ? data.visual : data.observation;
    const url = canonicalNativeVideoUrl(request.capture.url);
    const captureHash = visual ? await nativeVideoCaptureHash(request.capture) : undefined;
    if (
      data.selection.provider !== request.provider ||
      data.selection.model !== request.model ||
      data.selection.effort !== request.effort ||
      data.selection.accountId !== request.accountId ||
      (data.source && canonicalNativeVideoUrl(data.source.url) !== url) ||
      (visual &&
        (visual.url !== url ||
          visual.genreId !== request.genreId ||
          visual.media.provenance !== "browser-visible-video" ||
          visual.media.captureSha256 !== captureHash ||
          visual.media.observedAt !== request.capture.capturedAt ||
          visual.media.durationSeconds !== request.capture.durationSeconds ||
          visual.media.frames.length !== request.capture.frames.length ||
          visual.media.frames.some(
            (frame, index) =>
              frame.timestampSeconds !== request.capture.frames[index].timestampSeconds ||
              frame.capturedAt !== request.capture.frames[index].capturedAt,
          ))) ||
      (!request.allowModel && data.modelCalls !== 0)
    )
      return { ok: false, error: "invalid_response" };
    return { ok: true, data };
  } catch {
    return { ok: false, error: signal?.aborted ? "cancelled" : "assessment_failed" };
  }
}
