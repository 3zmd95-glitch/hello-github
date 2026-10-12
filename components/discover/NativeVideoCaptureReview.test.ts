// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { allGenres } from "@/lib/genres";
import { localAiStatus } from "@/lib/localAi";
import {
  nativeCaptureFixture,
  capturedReviewResponseFixture,
} from "@/lib/nativeVideoCapture.fixture";
import {
  reviewCapturedVideo,
  type CapturedVideoReviewResult,
} from "@/lib/nativeVideoCaptureClient";
import { useStore } from "@/store";
import NativeVideoCaptureReview from "./NativeVideoCaptureReview";

vi.mock("@/lib/localAi", async (original) => ({
  ...(await original<typeof import("@/lib/localAi")>()),
  localAiStatus: vi.fn(),
}));
vi.mock("@/lib/nativeVideoCaptureClient", async (original) => ({
  ...(await original<typeof import("@/lib/nativeVideoCaptureClient")>()),
  reviewCapturedVideo: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
const onReviewed = vi.fn();
const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="native-video-${id}"]`)!;
const settle = async () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const change = async (id: string, value: string) => {
  act(() => {
    ($(id) as HTMLSelectElement).value = value;
    $(id).dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
};
const load = async (value: unknown = nativeCaptureFixture(), size?: number) => {
  const text = JSON.stringify(value);
  const input = $("file") as HTMLInputElement;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [{ name: "capture.json", size: size ?? text.length, text: async () => text }],
  });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
};
const open = async () => {
  act(() => {
    history.replaceState(null, "", "/discover/#video-capture");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await settle();
};
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("No automatic request allowed"))),
  );
  vi.mocked(localAiStatus).mockClear();
  vi.mocked(localAiStatus).mockResolvedValue({
    available: true,
    providers: {
      chatgpt: {
        connected: true,
        sharing: true,
        accountId: "selected-account",
        models: [{ id: "gpt-6-astra", name: "GPT-6 Astra", efforts: ["medium", "max"] }],
      },
      claude: { connected: false, models: [] },
    },
  });
  vi.mocked(reviewCapturedVideo).mockReset();
  onReviewed.mockReset();
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverCandidates: [],
    discoverFeedback: [],
    inspirations: [],
  });
  useStore.getState().setSettings({ lang: "en" });
  history.replaceState(null, "", "/discover/");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(createElement(NativeVideoCaptureReview, { genres: allGenres([]), onReviewed })),
  );
  await settle();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("opens the helper handoff from Discover and previews locally without inference or persistence", async () => {
  expect(localAiStatus).not.toHaveBeenCalled();
  await open();
  await load();
  expect($("model").textContent).toBe("ChatGPT · gpt-6-astra · max");
  expect($("preview").querySelectorAll("img")).toHaveLength(2);
  expect($("preview").querySelector("a")?.href).toBe(nativeCaptureFixture().url);
  expect(($("check") as HTMLButtonElement).disabled).toBe(true);
  expect(reviewCapturedVideo).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(useStore.getState().discoverCandidates).toEqual([]);
  expect(useStore.getState().inspirations).toEqual([]);
  expect(useStore.getState().discoverFeedback).toEqual([]);
});

it("checks one selected post/category/model only when clicked and stores hashes, never pictures", async () => {
  await open();
  const capture = nativeCaptureFixture();
  await load(capture);
  await change("category", "coffee");
  vi.mocked(reviewCapturedVideo).mockImplementation(async (request) => ({
    ok: true,
    data: await capturedReviewResponseFixture(request),
  }));
  act(() => {
    $("check").click();
    $("check").click();
  });
  await settle();
  expect(reviewCapturedVideo).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reviewCapturedVideo).mock.calls[0][0]).toEqual({
    provider: "chatgpt",
    model: "gpt-6-astra",
    effort: "max",
    accountId: "selected-account",
    genreId: "coffee",
    lang: "en",
    allowModel: true,
    capture,
  });
  expect(onReviewed).toHaveBeenCalledExactlyOnceWith("coffee");
  const candidates = useStore.getState().discoverCandidates;
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    genreId: "coffee",
    item: { url: capture.url, platform: "tt" },
    visual: { media: { provenance: "browser-visible-video" } },
  });
  expect(JSON.stringify(candidates)).not.toContain("data:image");
  expect($("preview")).toBeNull();
  expect(useStore.getState().inspirations).toEqual([]);
  expect(useStore.getState().discoverFeedback).toEqual([]);
});

it("leaves the previous result unchanged after a model failure", async () => {
  await open();
  await load();
  await change("category", "coffee");
  vi.mocked(reviewCapturedVideo).mockImplementation(async (request) => ({
    ok: true,
    data: await capturedReviewResponseFixture(request),
  }));
  act(() => $("check").click());
  await settle();
  const previous = useStore.getState().discoverCandidates;
  await load();
  vi.mocked(reviewCapturedVideo).mockResolvedValue({ ok: false, error: "assessment_failed" });
  act(() => $("check").click());
  await settle();
  expect(useStore.getState().discoverCandidates).toBe(previous);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "previous assessment is unchanged",
  );
  expect($("preview")).not.toBeNull();
});

it("rejects unsupported and oversize files before any model call", async () => {
  await open();
  await load({ ...nativeCaptureFixture(), unknown: true });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect($("preview")).toBeNull();
  await load(nativeCaptureFixture(), 3 * 1024 * 1024);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("too large");
  expect(reviewCapturedVideo).not.toHaveBeenCalled();
});

it("does not substitute a weaker model when the preferred model is absent", async () => {
  vi.mocked(localAiStatus).mockResolvedValue({
    available: true,
    providers: {
      chatgpt: {
        connected: true,
        sharing: true,
        accountId: "selected-account",
        models: [{ id: "other-model", name: "Other", efforts: ["high"] }],
      },
      claude: { connected: false, models: [] },
    },
  });
  await open();
  await load();
  await change("category", "coffee");
  expect($("model")).toBeNull();
  expect(($("check") as HTMLButtonElement).disabled).toBe(true);
  expect(reviewCapturedVideo).not.toHaveBeenCalled();
});

it("discarding a pending review prevents its late result from being saved", async () => {
  await open();
  await load();
  await change("category", "coffee");
  let finish!: (result: CapturedVideoReviewResult) => void;
  vi.mocked(reviewCapturedVideo).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => $("check").click());
  const request = vi.mocked(reviewCapturedVideo).mock.calls[0][0];
  act(() => $("clear").click());
  const response = await capturedReviewResponseFixture(request);
  await act(async () => finish({ ok: true, data: response }));
  expect(useStore.getState().discoverCandidates).toEqual([]);
  expect(onReviewed).not.toHaveBeenCalled();
});
