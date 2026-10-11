// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENRES } from "@/data/genres";
import type { DiscoverAnswer, DiscoverItem, DiscoverResult } from "@/lib/discover";
import * as expansion from "@/lib/discoverExpansion";
import * as native from "@/lib/tiktokAccess";
import { useStore } from "@/store";
import { useCategoryRefresh, type CategoryRefreshQueue } from "./useCategoryRefresh";

const config = { url: "https://worker.test", token: "fixture" };
const travel = GENRES.find((genre) => genre.id === "travel")!;
function item(platform: "tt" | "yt", id: number, observed = false): DiscoverItem {
  const at = new Date().toISOString();
  const title = "Travel cinematic film";
  return {
    platform,
    url:
      platform === "tt"
        ? `https://www.tiktok.com/@editor/video/755999999900000${String(id).padStart(4, "0")}`
        : `https://www.youtube.com/watch?v=Refresh${String(id).padStart(4, "0")}`,
    title,
    snippet: title,
    handle: "editor",
    lang: "en",
    section: "example",
    ...(observed
      ? {
          evidence: {
            source: platform === "tt" ? ("tiktok-public-page" as const) : ("youtube-api" as const),
            observedAt: at,
            published: at,
            author: "editor",
            caption: title,
            views: 40000,
          },
        }
      : {}),
  };
}
const tt = (
  items: DiscoverItem[] = [],
  unseenRemaining = 0,
): Awaited<ReturnType<typeof native.acquireTikTokEdits>> => ({
  ok: true,
  value: {
    version: 1,
    categoryId: "travel",
    country: "US",
    dateRange: "7DAY",
    checkedAt: new Date().toISOString(),
    status: "accepted",
    captioned: 0,
    items,
    supply: { matchedHashtags: 1, videoCandidates: items.length, unseenRemaining, skippedKnown: 0 },
  },
});
const yt = (
  items: DiscoverItem[] = [],
  override: Partial<DiscoverAnswer> = {},
): DiscoverResult => ({
  ok: true,
  answer: {
    topicKey: "travel",
    understood: { label: { en: "Travel", ar: "سفر" }, exact: true },
    alternatives: [],
    creators: [],
    items,
    platforms: { yt: { ok: true } },
    cost: { tavily: 0, youtubeSearch: 1 },
    cached: false,
    complete: true,
    ...override,
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
let queue: CategoryRefreshQueue;
let props: Parameters<typeof useCategoryRefresh>[0];
function Harness() {
  const value = useCategoryRefresh(props);
  useLayoutEffect(() => {
    queue = value;
  });
  return null;
}
const render = () => act(() => root.render(createElement(Harness)));
const run = () =>
  act(async () => {
    await queue.run();
  });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverLibraryEpoch: "epoch",
    discoverCandidates: [],
    discoverFeedback: [],
    inspirations: [],
  });
  useStore.getState().setSettings({
    apiKeys: { youtube: "youtube-key", scoutUrl: config.url, scoutToken: config.token },
  });
  props = { genre: travel, tab: "all", country: "US", active: true, config };
  vi.spyOn(native, "acquireTikTokEdits").mockResolvedValue(tt());
  vi.spyOn(expansion, "expandCategory").mockResolvedValue(yt());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  render();
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("explicit category refresh", () => {
  it.each(["inactive", "instagram", "unconfigured", "loading"] as const)(
    "never requests automatically or when %s",
    async (reason) => {
      expect(native.acquireTikTokEdits).not.toHaveBeenCalled();
      expect(expansion.expandCategory).not.toHaveBeenCalled();
      if (reason === "inactive") props = { ...props, active: false };
      if (reason === "instagram") props = { ...props, tab: "ig" };
      if (reason === "unconfigured") props = { ...props, config: null };
      if (reason === "loading") act(() => useStore.setState({ discoverLibraryStatus: "loading" }));
      render();
      expect(queue.canRun).toBe(false);
      await run();
      expect(native.acquireTikTokEdits).not.toHaveBeenCalled();
      expect(expansion.expandCategory).not.toHaveBeenCalled();
    },
  );
  it("runs All sequentially and updates qualified counts only when returned sources support them", async () => {
    const first = deferred<Awaited<ReturnType<typeof native.acquireTikTokEdits>>>();
    vi.mocked(native.acquireTikTokEdits).mockReturnValue(first.promise);
    vi.mocked(expansion.expandCategory).mockResolvedValue(yt([item("yt", 1, true)]));
    let pending!: Promise<void>;
    act(() => {
      pending = queue.run();
      void queue.run();
    });
    expect(native.acquireTikTokEdits).toHaveBeenCalledTimes(1);
    expect(expansion.expandCategory).not.toHaveBeenCalled();
    expect(queue.busy).toBe(true);
    await act(async () => {
      first.resolve(tt([item("tt", 1)]));
      await pending;
    });
    expect(expansion.expandCategory).toHaveBeenCalledExactlyOnceWith(
      config,
      travel,
      expect.objectContaining({
        platform: "yt",
        ytOrder: "viewCount",
        round: 0,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(queue.outcome).toMatchObject({
      status: "done",
      returned: 2,
      added: 2,
      inspiration: 1,
      popular: 1,
    });
    act(() =>
      useStore
        .getState()
        .accumulateDiscoverCandidates([item("tt", 1, true), item("yt", 99, true)], {
          genreId: "travel",
        }),
    );
    expect(queue.outcome).toMatchObject({ returned: 2, added: 2, inspiration: 2, popular: 2 });
    expect(useStore.getState().discoverFeedback).toEqual([]);
    expect(useStore.getState().inspirations).toEqual([]);
    expect(native.acquireTikTokEdits).toHaveBeenCalledTimes(1);
    expect(expansion.expandCategory).toHaveBeenCalledTimes(1);
  });
  it("compares baseline qualifications, deduplicates aliases and recomputes qualification losses", async () => {
    props = { ...props, tab: "yt" };
    const old = item("yt", 1, true);
    act(() =>
      useStore.getState().accumulateDiscoverCandidates([old, item("yt", 2)], { genreId: "travel" }),
    );
    render();
    vi.mocked(expansion.expandCategory).mockResolvedValue(
      yt([
        old,
        { ...old, url: "https://youtu.be/Refresh0001?utm_source=test" },
        item("yt", 2, true),
        item("yt", 3),
        { ...item("yt", 9), platform: "ig", url: "https://www.instagram.com/reel/Post9/" },
      ]),
    );
    await run();
    expect(queue.outcome).toMatchObject({ returned: 3, added: 1, inspiration: 1, popular: 1 });
    act(() =>
      useStore
        .getState()
        .accumulateDiscoverCandidates([item("yt", 3, true)], { genreId: "travel" }),
    );
    expect(queue.outcome).toMatchObject({ inspiration: 2, popular: 2 });
    act(() =>
      useStore.setState({
        discoverCandidates: useStore.getState().discoverCandidates.map((candidate) =>
          candidate.item.url === item("yt", 2).url
            ? {
                ...candidate,
                item: {
                  ...candidate.item,
                  evidence: { ...candidate.item.evidence!, availability: "unavailable" },
                },
              }
            : candidate,
        ),
      }),
    );
    expect(queue.outcome).toMatchObject({ inspiration: 1, popular: 1 });
    expect(
      useStore.getState().discoverCandidates.some((candidate) => candidate.item.platform === "ig"),
    ).toBe(false);
  });
  it("does not count positive preference bypasses or dismissed posts as new qualifications", async () => {
    props = { ...props, tab: "yt" };
    const weak = item("yt", 1);
    const hidden = item("yt", 2, true);
    act(() => {
      useStore.getState().setDiscoverFeedback({
        genreId: "travel",
        platform: "yt",
        url: weak.url,
        creator: "editor",
        action: "more",
      });
      useStore.getState().setDiscoverFeedback({
        genreId: "travel",
        platform: "yt",
        url: hidden.url,
        creator: "editor",
        action: "less",
      });
    });
    render();
    vi.mocked(expansion.expandCategory).mockResolvedValue(yt([weak, hidden]));
    await run();
    expect(queue.outcome).toMatchObject({ returned: 2, added: 2, inspiration: 0, popular: 0 });
  });
  it("counts retained additions instead of raw links and excludes category-known TikTok IDs", async () => {
    props = { ...props, tab: "tt" };
    act(() => {
      useStore.getState().accumulateDiscoverCandidates([item("tt", 88)], { genreId: "coffee" });
      useStore
        .getState()
        .accumulateDiscoverCandidates(
          [item("tt", 77, true), ...Array.from({ length: 99 }, (_, id) => item("yt", id, true))],
          { genreId: "travel" },
        );
    });
    render();
    vi.mocked(native.acquireTikTokEdits).mockResolvedValueOnce(tt([item("tt", 1)], 1));
    await run();
    expect(vi.mocked(native.acquireTikTokEdits).mock.calls[0][2]?.excludeVideoIds).toEqual(
      native.knownTikTokIds([item("tt", 77)]),
    );
    expect(queue.outcome).toMatchObject({ returned: 1, added: 0, inspiration: 0, popular: 0 });
    expect(queue.tiktokExhausted).toBe(false);
    vi.mocked(native.acquireTikTokEdits).mockResolvedValueOnce(tt());
    await run();
    expect(vi.mocked(native.acquireTikTokEdits).mock.calls[1][2]?.excludeVideoIds).toEqual(
      native.knownTikTokIds([item("tt", 77), item("tt", 1)]),
    );
    expect(queue.tiktokExhausted).toBe(true);
    expect(queue.canRun).toBe(false);
    await run();
    expect(native.acquireTikTokEdits).toHaveBeenCalledTimes(2);
  });
  it("keeps partial lane failures independent and reports partial YouTube supply honestly", async () => {
    vi.mocked(native.acquireTikTokEdits).mockResolvedValue({ ok: false, error: "timeout" });
    vi.mocked(expansion.expandCategory).mockResolvedValue(
      yt([item("yt", 1, true)], {
        platforms: { yt: { ok: true, partial: "quota" } },
        cached: true,
      }),
    );
    await run();
    expect(queue.outcome).toMatchObject({
      status: "done",
      returned: 1,
      added: 1,
      inspiration: 1,
      lanes: [
        { platform: "tt", status: "error", error: "timeout", returned: 0 },
        { platform: "yt", status: "done", error: "quota", cached: true, returned: 1 },
      ],
    });
    vi.mocked(native.acquireTikTokEdits).mockResolvedValue(tt([item("tt", 1)]));
    vi.mocked(expansion.expandCategory).mockResolvedValue(
      yt([], { platforms: { yt: { ok: false, error: "daily_cap" } } }),
    );
    await run();
    expect(queue.outcome).toMatchObject({
      status: "done",
      returned: 1,
      added: 1,
      inspiration: 0,
      lanes: [
        { platform: "tt", status: "done" },
        { platform: "yt", status: "error", error: "daily_cap" },
      ],
    });
  });
  it("surfaces nonaccepted and thrown failures without merging results or stopping the other lane", async () => {
    const unavailable = tt();
    if (unavailable.ok) unavailable.value.status = "not_connected";
    vi.mocked(native.acquireTikTokEdits).mockResolvedValue(unavailable);
    vi.mocked(expansion.expandCategory).mockRejectedValue(new Error("network"));
    await run();
    expect(queue.outcome).toMatchObject({
      status: "error",
      returned: 0,
      added: 0,
      lanes: [
        { status: "error", error: "not_connected" },
        { status: "error", error: "network" },
      ],
    });
    expect(useStore.getState().discoverCandidates).toEqual([]);
  });
  it("does not spend a YouTube round when cancelled during TikTok", async () => {
    const first = deferred<Awaited<ReturnType<typeof native.acquireTikTokEdits>>>();
    vi.mocked(native.acquireTikTokEdits).mockReturnValueOnce(first.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = queue.run();
    });
    const signal = vi.mocked(native.acquireTikTokEdits).mock.calls[0][2]?.signal;
    act(() => queue.cancel());
    expect(signal?.aborted).toBe(true);
    expect(queue.outcome?.status).toBe("cancelled");
    await act(async () => {
      first.resolve(tt([item("tt", 1)]));
      await pending;
    });
    expect(expansion.expandCategory).not.toHaveBeenCalled();
    expect(useStore.getState().discoverCandidates).toEqual([]);
    await run();
    expect(vi.mocked(expansion.expandCategory).mock.calls[0][2].round).toBe(0);
  });
  it("caps YouTube at three started rounds per category across platform and country changes", async () => {
    props = { ...props, tab: "yt" };
    render();
    const initialRun = queue.run;
    await act(async () => {
      // A retained callback cannot evade the limit before React commits the updated disabled state.
      for (let i = 0; i < 4; i++) await initialRun();
    });
    expect(vi.mocked(expansion.expandCategory).mock.calls.map((call) => call[2].round)).toEqual([
      0, 1, 2,
    ]);
    expect(queue.youtubeExhausted).toBe(true);
    expect(queue.canRun).toBe(false);
    props = { ...props, tab: "all", country: "SA" };
    render();
    await run();
    expect(expansion.expandCategory).toHaveBeenCalledTimes(3);
    expect(queue.outcome?.lanes[1].status).toBe("skipped");
    props = { ...props, tab: "yt", genre: GENRES.find((genre) => genre.id === "coffee")! };
    render();
    await run();
    expect(vi.mocked(expansion.expandCategory).mock.calls[3][2].round).toBe(0);
  });
  it("bounds TikTok exclusions and exhausts after 200 observed identities even if supply remains", async () => {
    props = { ...props, tab: "tt" };
    render();
    for (let offset = 0; offset < 200; offset += 12) {
      const batch = Array.from({ length: Math.min(12, 200 - offset) }, (_, id) =>
        item("tt", offset + id),
      );
      vi.mocked(native.acquireTikTokEdits).mockResolvedValueOnce(tt(batch, 1));
      await run();
    }
    expect(native.acquireTikTokEdits).toHaveBeenCalledTimes(17);
    expect(
      vi
        .mocked(native.acquireTikTokEdits)
        .mock.calls.every((call) => call[2]!.excludeVideoIds!.length <= 200),
    ).toBe(true);
    expect(queue.tiktokExhausted).toBe(true);
    expect(queue.canRun).toBe(false);
    await run();
    expect(native.acquireTikTokEdits).toHaveBeenCalledTimes(17);
  });
  it("keeps completed TikTok candidates but ignores YouTube arriving after cancellation", async () => {
    vi.mocked(native.acquireTikTokEdits).mockResolvedValue(tt([item("tt", 1)]));
    const next = deferred<DiscoverResult>();
    vi.mocked(expansion.expandCategory).mockReturnValue(next.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = queue.run();
    });
    expect(expansion.expandCategory).toHaveBeenCalledTimes(1);
    act(() => queue.cancel());
    expect(vi.mocked(expansion.expandCategory).mock.calls[0][2].signal?.aborted).toBe(true);
    await act(async () => {
      next.resolve(yt([item("yt", 1, true)]));
      await pending;
    });
    expect(queue.outcome).toMatchObject({
      status: "cancelled",
      returned: 1,
      added: 1,
      inspiration: 0,
    });
    expect(
      useStore.getState().discoverCandidates.map((candidate) => candidate.item.platform),
    ).toEqual(["tt"]);
  });
  it.each([
    "active",
    "category",
    "definition",
    "platform",
    "country",
    "config",
    "key",
    "loading",
    "reset",
    "import",
    "unmount",
  ] as const)("rejects late acquisition after %s changes", async (change) => {
    const first = deferred<Awaited<ReturnType<typeof native.acquireTikTokEdits>>>();
    vi.mocked(native.acquireTikTokEdits).mockReturnValue(first.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = queue.run();
    });
    const signal = vi.mocked(native.acquireTikTokEdits).mock.calls[0][2]?.signal;
    act(() => {
      if (change === "active") props = { ...props, active: false };
      if (change === "category")
        props = { ...props, genre: GENRES.find((genre) => genre.id === "coffee")! };
      if (change === "definition")
        props = { ...props, genre: { ...travel, name: { en: "Changed", ar: "تغيير" } } };
      if (change === "platform") props = { ...props, tab: "yt" };
      if (change === "country") props = { ...props, country: "SA" };
      if (change === "config") props = { ...props, config: { ...config, token: "changed" } };
      if (change === "key") useStore.getState().setSettings({ apiKeys: { youtube: "changed" } });
      if (change === "loading") useStore.setState({ discoverLibraryStatus: "loading" });
      if (change === "reset") useStore.getState().reset();
      if (change === "import") useStore.getState().importState(useStore.getState().exportState());
      if (change === "unmount") {
        root.unmount();
        mounted = false;
      }
    });
    if (mounted) render();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      first.resolve(tt([item("tt", 1)]));
      await pending;
    });
    expect(useStore.getState().discoverCandidates).toEqual([]);
    expect(expansion.expandCategory).not.toHaveBeenCalled();
    if (mounted) expect(queue.busy).toBe(false);
  });
  it("rechecks the library epoch after a synchronous reset during accumulation", async () => {
    vi.mocked(native.acquireTikTokEdits).mockResolvedValue(tt([item("tt", 1)]));
    const stop = useStore.subscribe((state, previous) => {
      if (state.discoverCandidates.length && !previous.discoverCandidates.length) state.reset();
    });
    await run();
    stop();
    expect(useStore.getState().discoverCandidates).toEqual([]);
    expect(expansion.expandCategory).not.toHaveBeenCalled();
  });
});
