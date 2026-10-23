// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  capturedReviewRequestFixture,
  capturedReviewResponseFixture,
  nativeCaptureFixture,
} from "./nativeVideoCapture.fixture";
import { NATIVE_VIDEO_CAPTURE_MAX_BYTES } from "./nativeVideoCapture";
import { readNativeVideoCapture, reviewCapturedVideo } from "./nativeVideoCaptureClient";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
const file = (value: unknown) => {
  const contents = typeof value === "string" ? value : JSON.stringify(value);
  return { size: contents.length, name: "capture.json", text: vi.fn(async () => contents) };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

it("reads only a bounded, strict helper file and rejects unknown, malformed and wrong-source payloads", async () => {
  expect((await readNativeVideoCapture(file(nativeCaptureFixture()))).ok).toBe(true);
  for (const bad of [
    "{",
    null,
    { ...nativeCaptureFixture(), account: "secret" },
    { ...nativeCaptureFixture(), platform: "ig" },
    { ...nativeCaptureFixture(), url: "https://evil.test/@editor/video/1234567890123456789" },
    { ...nativeCaptureFixture(), frames: [] },
  ])
    expect(await readNativeVideoCapture(file(bad))).toEqual({
      ok: false,
      error: "invalid_capture",
    });
  const oversized = { ...file(nativeCaptureFixture()), size: NATIVE_VIDEO_CAPTURE_MAX_BYTES + 1 };
  expect(await readNativeVideoCapture(oversized)).toEqual({
    ok: false,
    error: "capture_too_large",
  });
  expect(oversized.text).not.toHaveBeenCalled();
});

it("makes one explicit call with exactly the selected model and image set", async () => {
  const request = capturedReviewRequestFixture();
  const result = await capturedReviewResponseFixture(request);
  const fetcher = vi.fn(async () => json(result));
  expect(await reviewCapturedVideo(request, undefined, fetcher)).toEqual({
    ok: true,
    data: result,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
  ).toEqual(request);
});

it("rejects another model, account, category, post or capture receipt", async () => {
  const request = capturedReviewRequestFixture();
  const original = await capturedReviewResponseFixture(request);
  const variants = [
    { ...original, selection: { ...original.selection, accountId: "other" } },
    { ...original, selection: { ...original.selection, model: "other" } },
    { ...original, visual: { ...original.visual, genreId: "cars" } },
    {
      ...original,
      source: {
        ...original.source,
        url: original.source.url.replace("1234567890123456789", "1234567890123456788"),
      },
    },
    {
      ...original,
      visual: {
        ...original.visual,
        media: { ...original.visual.media, captureSha256: "d".repeat(64) },
      },
    },
  ];
  for (const response of variants)
    expect(
      await reviewCapturedVideo(
        request,
        undefined,
        vi.fn(async () => json(response)),
      ),
    ).toEqual({ ok: false, error: "invalid_response" });
});

it("does not retry a model failure or make a call for invalid captures", async () => {
  const fetcher = vi.fn(async () => json({ error: "subscription_limit" }, 429));
  expect(await reviewCapturedVideo(capturedReviewRequestFixture(), undefined, fetcher)).toEqual({
    ok: false,
    error: "subscription_limit",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const invalid = capturedReviewRequestFixture();
  invalid.capture.frames = [];
  expect(await reviewCapturedVideo(invalid, undefined, fetcher)).toEqual({
    ok: false,
    error: "invalid_capture",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
