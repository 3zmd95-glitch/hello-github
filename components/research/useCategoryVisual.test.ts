// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import type { DiscoverVisualRequest, DiscoverVisualResponse } from "@/lib/discoverVisual";
import * as client from "@/lib/discoverVisualClient";
import { useStore } from "@/store";
import { useCategoryVisual, type CategoryVisualQueue } from "./useCategoryVisual";

const selection = {
  provider: "chatgpt" as const,
  model: "chosen-model",
  effort: "ultra",
  accountId: "account",
};
const item = (id: number): DiscoverItem => ({
  platform: "ig",
  url: `https://www.instagram.com/p/Post${id}/`,
  title: "#anime",
  snippet: "#anime",
  handle: `editor${id}`,
  lang: "en",
  section: "example",
  evidence: {
    source: "instagram-public-embed",
    author: `editor${id}`,
    caption: "#anime",
    observedAt: new Date().toISOString(),
    likes: 3000 - id,
  },
});
function response(request: DiscoverVisualRequest, cached = false): DiscoverVisualResponse {
  const at = new Date().toISOString();
  const author = `editor${request.url.match(/Post(\d+)/)![1]}`;
  return {
    status: "assessed",
    selection,
    cached,
    modelCalls: cached ? 0 : 1,
    source: {
      status: "available",
      url: request.url,
      title: "#anime",
      description: "#anime",
      thumbnailUrl: "",
      author,
      observedAt: at,
      provenance: "instagram-public-embed",
      likes: 3000,
    },
    visual: {
      version: 1,
      url: request.url,
      genreId: request.genreId,
      checkedAt: at,
      provider: "chatgpt",
      model: selection.model,
      effort: selection.effort,
      source: {
        provenance: "instagram-public-embed",
        caption: "#anime",
        author,
        observedAt: at,
        sha256: "a".repeat(64),
      },
      media: {
        provenance: "instagram-public-embed-video",
        observedAt: at,
        durationSeconds: 20,
        videoSha256: "b".repeat(64),
        frames: [
          { timestampSeconds: 0, sha256: "c".repeat(64) },
          { timestampSeconds: 19, sha256: "d".repeat(64) },
        ],
      },
      assessment: {
        category: "supported",
        categoryFrames: [0],
        observations: [
          {
            cue: "typography",
            origin: "uploader-added",
            description: "Large graphic text",
            frames: [0, 1],
          },
        ],
        uncertainty: "Sparse samples",
      },
      limitations: ["sampled_frames", "motion_partial", "audio_unverified"],
    },
  };
}
let queue: CategoryVisualQueue;
let host: HTMLDivElement;
let root: Root;
let items: DiscoverItem[];
let props: { genreId: string; active: boolean; lang: "en" | "ar"; platform: string; now: number };
function Harness() {
  const value = useCategoryVisual({ ...props, items });
  useLayoutEffect(() => {
    queue = value;
  });
  return null;
}
const render = () => act(() => root.render(createElement(Harness)));
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverLibraryEpoch: "epoch",
    discoverCandidates: [],
    discoverFeedback: [],
  });
  items = Array.from({ length: 6 }, (_, id) => item(id));
  useStore.getState().accumulateDiscoverCandidates(items, { genreId: "anime" });
  props = { genreId: "anime", active: true, lang: "en", platform: "all", now: Date.now() };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(client, "assessCategoryVisual").mockImplementation(async (request) => ({
    ok: true,
    data: response(request),
  }));
  render();
  act(() => {
    queue.setChoice(selection);
    queue.setOpen(true);
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("explicit category visual queue", () => {
  it("does nothing on rendering, ordinary navigation or feedback; an explicit action makes two sequential calls and persists the results", async () => {
    render();
    act(() =>
      useStore.getState().setDiscoverFeedback({
        url: items[5].url,
        platform: "ig",
        creator: items[5].handle,
        genreId: "anime",
        action: "more",
      }),
    );
    expect(client.assessCategoryVisual).not.toHaveBeenCalled();
    await act(async () => {
      await queue.assess();
    });
    expect(client.assessCategoryVisual).toHaveBeenCalledTimes(2);
    expect(
      useStore.getState().discoverCandidates.filter((candidate) => candidate.visual),
    ).toHaveLength(2);
    expect(queue.progress).toMatchObject({ status: "done", attempted: 2, assessed: 2 });
    render();
    await settle();
    expect(client.assessCategoryVisual).toHaveBeenCalledTimes(2);
  });
  it("caps media failures at four attempts and continues to two successful cached/uncertain assessments", async () => {
    const mock = vi.mocked(client.assessCategoryVisual);
    mock.mockResolvedValueOnce({
      ok: true,
      data: { status: "unavailable", selection, error: "source_frames_too_large", modelCalls: 0 },
    });
    mock.mockResolvedValueOnce({
      ok: true,
      data: { status: "unavailable", selection, error: "source_unavailable", modelCalls: 0 },
    });
    mock.mockImplementation(async (request) => ({ ok: true, data: response(request, true) }));
    await act(async () => {
      await queue.assess();
    });
    expect(mock).toHaveBeenCalledTimes(4);
    expect(queue.progress).toMatchObject({ status: "done", attempted: 4, assessed: 2 });
  });
  it.each([
    "account_changed",
    "budget",
    "busy",
    "model_unavailable",
    "source_frames_decoder_unavailable",
    "network",
  ])("stops immediately on %s without another candidate", async (error) => {
    vi.mocked(client.assessCategoryVisual).mockResolvedValue({
      ok: true,
      data: { status: "unavailable", selection, error, modelCalls: 0 },
    });
    await act(async () => {
      await queue.assess();
    });
    expect(client.assessCategoryVisual).toHaveBeenCalledTimes(1);
    expect(queue.progress).toMatchObject({ status: "error", error });
  });
  it.each(["cancel", "category", "navigation", "model", "epoch", "option"])(
    "aborts and rejects a late response after %s",
    async (reason) => {
      let resolve!: (value: client.CategoryVisualResult) => void;
      vi.mocked(client.assessCategoryVisual).mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = queue.assess();
      });
      const [request, signal] = vi.mocked(client.assessCategoryVisual).mock.calls[0];
      act(() => {
        if (reason === "cancel") queue.cancel();
        if (reason === "option") queue.setAfterLookup(false);
        if (reason === "model") queue.setChoice({ ...selection, model: "other" });
        if (reason === "epoch") useStore.setState({ discoverLibraryEpoch: "replacement" });
        if (reason === "category") {
          props = { ...props, genreId: "cars" };
          root.render(createElement(Harness));
        }
        if (reason === "navigation") {
          props = { ...props, active: false };
          root.render(createElement(Harness));
        }
      });
      expect(signal?.aborted).toBe(true);
      await act(async () => {
        resolve({ ok: true, data: response(request) });
        await pending;
      });
      expect(useStore.getState().discoverCandidates.some((candidate) => candidate.visual)).toBe(
        false,
      );
      expect(client.assessCategoryVisual).toHaveBeenCalledTimes(1);
    },
  );
  it("only starts a captured, opted-in lookup cohort once and drops it if the selection changed", async () => {
    expect(queue.captureNextLookup()).toBeUndefined();
    act(() => queue.setAfterLookup(true));
    expect(client.assessCategoryVisual).not.toHaveBeenCalled();
    const after = queue.captureNextLookup()!;
    act(() => after([items[4], items[5]]));
    await settle();
    expect(
      vi.mocked(client.assessCategoryVisual).mock.calls.map(([request]) => request.url),
    ).toEqual([items[4].url, items[5].url]);
    expect(queue.afterLookup).toBe(false);
    expect(queue.captureNextLookup()).toBeUndefined();
    act(() => after(items));
    await settle();
    expect(client.assessCategoryVisual).toHaveBeenCalledTimes(2);
    act(() => queue.setAfterLookup(true));
    const stale = queue.captureNextLookup()!;
    act(() => queue.setChoice({ ...selection, accountId: "another" }));
    act(() => stale(items));
    await settle();
    expect(client.assessCategoryVisual).toHaveBeenCalledTimes(2);
  });
  it("makes expired assessments eligible after the clock advances without starting another request", async () => {
    const clock = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    await act(async () => {
      await queue.assess();
    });
    expect(queue.eligibleCount).toBe(4);
    vi.setSystemTime(clock + 86400001);
    props = { ...props, now: Date.now() };
    render();
    expect(queue.eligibleCount).toBe(6);
    expect(client.assessCategoryVisual).toHaveBeenCalledTimes(2);
    await act(async () => {
      await queue.assess();
    });
    expect(client.assessCategoryVisual).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
