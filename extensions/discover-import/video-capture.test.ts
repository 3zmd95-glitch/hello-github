// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendCapturedFrame,
  cropVideoScreenshot,
  hasScreenshotDetail,
  sameCaptureTarget,
  visibleTikTokVideo,
} from "./video-capture.js";

const url = "https://www.tiktok.com/@coffee/video/7692598509207325966";
const bounds = {
  x: 20,
  y: 10,
  left: 20,
  top: 10,
  right: 320,
  bottom: 410,
  width: 300,
  height: 400,
};
const target = {
  url,
  capturedAt: "2026-10-11T16:00:00.000Z",
  timestampSeconds: 1,
  durationSeconds: 8,
  rect: { x: 20, y: 10, width: 300, height: 400 },
  viewport: { width: 1000, height: 800 },
};
const dataUrl = "data:image/jpeg;base64,/9j/AAA=";

beforeEach(() => {
  document.body.innerHTML = '<article><a href="/@coffee">Coffee</a><video></video></article>';
  const video = document.querySelector("video")!;
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 2 },
    videoWidth: { configurable: true, value: 900 },
    videoHeight: { configurable: true, value: 1200 },
    duration: { configurable: true, value: 8 },
    currentTime: { configurable: true, value: 1 },
  });
  video.getBoundingClientRect = () => bounds as DOMRect;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => video });
  vi.stubGlobal("window", { location: { href: url }, innerWidth: 1000, innerHeight: 800 });
  vi.stubGlobal("getComputedStyle", () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
    objectFit: "cover",
    objectPosition: "50% 50%",
  }));
});

describe("screenshot detail beyond sparse player controls", () => {
  // The capture validator samples one pixel in each 16; these are synthetic image samples.
  const pixels = (light: (index: number) => number) => {
    const data = new Uint8ClampedArray(10000 * 64);
    for (let index = 0; index < 10000; index++)
      data[index * 64] = data[index * 64 + 1] = data[index * 64 + 2] = light(index);
    return data;
  };
  it("rejects near-black crops with sparse bright icons, captions and compression noise", () => {
    // Approximate the observed failed crop: almost all black, <2% controls with full contrast.
    const overlayOnly = pixels((index) =>
      index % 100 < 1 ? 255 : index % 100 < 2 ? 24 : index % 3,
    );
    expect(hasScreenshotDetail(overlayOnly)).toBe(false);
    expect(hasScreenshotDetail(pixels(() => 0))).toBe(false);
    expect(hasScreenshotDetail(pixels(() => 255))).toBe(false);
  });
  it("keeps dark scene detail without requiring bright pixels or high average brightness", () => {
    expect(hasScreenshotDetail(pixels((index) => 2 + (index % 17)))).toBe(true);
    expect(hasScreenshotDetail(pixels((index) => (index % 10 === 0 ? 28 : 2)))).toBe(true);
    expect(hasScreenshotDetail(pixels((index) => 30 + (index % 180)))).toBe(true);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("visible player capture scope", () => {
  it("returns only a canonical post, visible geometry and approximate player time", () => {
    expect(visibleTikTokVideo()).toMatchObject({
      url,
      timestampSeconds: 1,
      durationSeconds: 8,
      rect: target.rect,
    });
    expect(Object.keys(visibleTikTokVideo()).sort()).toEqual([
      "capturedAt",
      "durationSeconds",
      "rect",
      "timestampSeconds",
      "url",
      "viewport",
    ]);
  });
  it.each([
    "https://www.tiktok.com/search?q=coffee",
    "https://www.tiktok.com/messages",
    "https://www.tiktok.com/@coffee",
    "https://www.tiktok.com.evil.test/@coffee/video/7692598509207325966",
    "http://www.tiktok.com/@coffee/video/7692598509207325966",
  ])("never captures outside an exact public post: %s", (href) => {
    vi.stubGlobal("window", { location: { href }, innerWidth: 1000, innerHeight: 800 });
    expect(visibleTikTokVideo()).toEqual({ error: "unsupported" });
  });
  it("rejects another creator, hidden documents, partial players and covering content", () => {
    document.querySelector("a")!.href = "/@other";
    expect(visibleTikTokVideo()).toEqual({ error: "ambiguous" });
    document.querySelector("a")!.href = "/@coffee";
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    expect(visibleTikTokVideo()).toEqual({ error: "unsupported" });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const video = document.querySelector("video")!;
    video.getBoundingClientRect = () => ({ ...bounds, left: -1 }) as DOMRect;
    expect(visibleTikTokVideo()).toEqual({ error: "ambiguous" });
    video.getBoundingClientRect = () => bounds as DOMRect;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => document.body,
    });
    expect(visibleTikTokVideo()).toEqual({ error: "overlay" });
  });
  it("rejects unready media and multiple fully visible players", () => {
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "readyState", { configurable: true, value: 0 });
    expect(visibleTikTokVideo()).toEqual({ error: "not-ready" });
    const other = video.cloneNode() as HTMLVideoElement;
    other.getBoundingClientRect = () => bounds as DOMRect;
    video.parentElement!.append(other);
    expect(visibleTikTokVideo()).toEqual({ error: "ambiguous" });
  });
  it("crops contain letterbox padding out of the proposed rectangle", () => {
    Object.defineProperty(document.querySelector("video"), "videoWidth", { value: 1200 });
    vi.stubGlobal("getComputedStyle", () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      objectFit: "contain",
      objectPosition: "50% 50%",
    }));
    expect(visibleTikTokVideo()).toMatchObject({ rect: { x: 20, y: 60, width: 300, height: 300 } });
  });
});

it("rejects navigation, layout movement and loops between before/after observations", () => {
  expect(sameCaptureTarget(target, { ...target, timestampSeconds: 1.2 })).toBe(true);
  for (const changed of [
    { ...target, url: url.replace("coffee", "other") },
    { ...target, timestampSeconds: 0.5 },
    { ...target, timestampSeconds: 2.1 },
    { ...target, rect: { ...target.rect, x: 23 } },
    { error: "overlay" },
    undefined,
  ])
    expect(sameCaptureTarget(target, changed)).toBe(false);
});

it("keeps manual capture identity and distinct increasing moments without inventing video provenance", () => {
  const first = appendCapturedFrame(null, target, dataUrl);
  expect(first).toMatchObject({
    version: 1,
    provenance: "browser-visible-video",
    platform: "tt",
    url,
    frames: [{ timestampSeconds: 1 }],
  });
  expect(first).not.toHaveProperty("videoSha256");
  expect(() => appendCapturedFrame(first, { ...target, timestampSeconds: 2 }, dataUrl)).toThrow(
    "repeat",
  );
  expect(() =>
    appendCapturedFrame(first, { ...target, timestampSeconds: 0.5 }, dataUrl + "a"),
  ).toThrow("repeat");
  expect(() =>
    appendCapturedFrame(first, { ...target, url: url.replace("coffee", "other") }, dataUrl + "a"),
  ).toThrow("changed");
  const second = appendCapturedFrame(first, { ...target, timestampSeconds: 2 }, dataUrl + "a");
  expect(second.frames).toHaveLength(2);
  expect(first.frames).toHaveLength(1);
  expect(() =>
    appendCapturedFrame({ ...first, frames: Array(8).fill(first.frames[0]) }, target, dataUrl),
  ).toThrow("full");
});

it("uses only the video crop when encoding and discards the original screenshot bitmap", async () => {
  const bitmap = { width: 2000, height: 1600, close: vi.fn() };
  const drawImage = vi.fn();
  const pixelData = new Uint8ClampedArray(128);
  pixelData[64] = pixelData[65] = pixelData[66] = 200;
  const context = { drawImage, getImageData: () => ({ data: pixelData }) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(dataUrl);
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: async () => new Blob() }));
  expect(await cropVideoScreenshot("data:image/png;base64,AAAA", target)).toBe(dataUrl);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 40, 20, 600, 800, 0, 0, 600, 800);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledExactlyOnceWith("data:image/png;base64,AAAA");
  pixelData.fill(0);
  await expect(cropVideoScreenshot("data:image/png;base64,AAAA", target)).rejects.toThrow("blank");
  expect(bitmap.close).toHaveBeenCalledTimes(2);
});
