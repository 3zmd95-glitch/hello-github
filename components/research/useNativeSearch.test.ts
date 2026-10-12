// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENRES } from "@/data/genres";
import * as native from "@/lib/discoverNativeSearch";
import { useNativeSearch, type NativeSearchState } from "./useNativeSearch";

const anime = GENRES.find((genre) => genre.id === "anime")!;
const travel = GENRES.find((genre) => genre.id === "travel")!;
function job(
  jobId: string,
  status: native.NativeJobSnapshot["status"] = "complete",
  hasMore = true,
): native.NativeJobSnapshot {
  return {
    jobId,
    status,
    hasMore,
    platforms: {
      ig: {
        status: status === "running" ? "loading" : "done",
        results: [
          {
            platform: "ig",
            url: `https://www.instagram.com/p/${jobId.replaceAll("-", "")}/`,
            title: "Native example",
            position: 1,
            observedAt: new Date().toISOString(),
          },
        ],
        searchUrl: "https://www.instagram.com/explore/search/keyword/?q=edit",
      },
    },
  };
}
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
let state: NativeSearchState;
let props: Parameters<typeof useNativeSearch>[0];
function Harness() {
  const result = useNativeSearch(props);
  useLayoutEffect(() => {
    state = result;
  });
  return null;
}
const render = () =>
  act(async () => {
    root.render(createElement(Harness));
  });
const search = () =>
  act(async () => {
    state.search({ ig: "anime edit", tt: "anime AMV", yt: "anime edit" });
  });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  props = { genre: anime, active: true };
  vi.spyOn(native, "initializeNativeHelper").mockReturnValue("a".repeat(32));
  vi.spyOn(native, "nativeHelperStatus").mockResolvedValue("connected");
  vi.spyOn(native, "readNativeSearchCache").mockResolvedValue(null);
  vi.spyOn(native, "writeNativeSearchCache").mockResolvedValue();
  vi.spyOn(native, "startNativeSearch").mockResolvedValue("job-anime");
  vi.spyOn(native, "pollNativeSearch").mockResolvedValue(job("job-anime"));
  vi.spyOn(native, "cancelNativeSearch").mockResolvedValue();
  vi.spyOn(native, "moreNativeSearch").mockResolvedValue();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native category search lifecycle", () => {
  it("reports cache readiness and never starts a native search from an effect", async () => {
    const cache = deferred<native.NativeSearchSnapshot | null>();
    vi.mocked(native.readNativeSearchCache).mockReturnValue(cache.promise);
    await render();
    expect(state.ready).toBe(false);
    expect(state.connection).toBe("connected");
    expect(native.startNativeSearch).not.toHaveBeenCalled();
    const saved = {
      ...job("cached-anime"),
      genreId: anime.id,
      queries: { ig: "anime" },
      cached: true,
      asOf: new Date().toISOString(),
    };
    await act(async () => {
      cache.resolve(saved);
    });
    expect(state.ready).toBe(true);
    expect(state.snapshot).toEqual(saved);
    expect(state.canMore).toBe(false);
    expect(native.startNativeSearch).not.toHaveBeenCalled();
  });
  it("cancels a late job acknowledgement after a category change", async () => {
    const start = deferred<string>();
    vi.mocked(native.startNativeSearch).mockReturnValue(start.promise);
    await render();
    await search();
    props = { genre: travel, active: true };
    await render();
    expect(state.snapshot).toBeNull();
    expect(state.busy).toBe(false);
    await act(async () => {
      start.resolve("late-anime");
    });
    expect(native.cancelNativeSearch).toHaveBeenCalledWith("late-anime");
    expect(native.pollNativeSearch).not.toHaveBeenCalled();
    expect(state.snapshot).toBeNull();
  });
  it("never applies or caches a stale category's completed poll", async () => {
    const oldPoll = deferred<native.NativeJobSnapshot>();
    vi.mocked(native.pollNativeSearch).mockReturnValueOnce(oldPoll.promise);
    await render();
    await search();
    props = { genre: travel, active: true };
    await render();
    vi.mocked(native.startNativeSearch).mockResolvedValueOnce("job-travel");
    vi.mocked(native.pollNativeSearch).mockResolvedValueOnce(job("job-travel"));
    await search();
    expect(state.snapshot?.genreId).toBe("travel");
    await act(async () => {
      oldPoll.resolve(job("job-anime"));
    });
    expect(state.snapshot?.jobId).toBe("job-travel");
    expect(native.cancelNativeSearch).toHaveBeenCalledWith("job-anime");
    expect(native.writeNativeSearchCache).toHaveBeenCalledTimes(1);
    expect(vi.mocked(native.writeNativeSearchCache).mock.calls[0][0].genreId).toBe("travel");
  });
  it("polls only running jobs at one second intervals and stops on completion", async () => {
    vi.useFakeTimers();
    vi.mocked(native.pollNativeSearch).mockResolvedValueOnce(job("job-anime", "running"));
    await render();
    await search();
    expect(state.busy).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(native.pollNativeSearch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(state.busy).toBe(false);
    expect(state.canMore).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(native.pollNativeSearch).toHaveBeenCalledTimes(2);
  });
  it("deduplicates continuation clicks and respects the helper's continuation limit", async () => {
    await render();
    await search();
    const more = deferred<void>();
    vi.mocked(native.moreNativeSearch).mockReturnValue(more.promise);
    act(() => {
      state.more();
      state.more();
    });
    expect(native.moreNativeSearch).toHaveBeenCalledOnce();
    vi.mocked(native.pollNativeSearch).mockResolvedValue(job("job-anime", "complete", false));
    await act(async () => {
      more.resolve();
    });
    expect(state.canMore).toBe(false);
    await act(async () => {
      state.more();
    });
    expect(native.moreNativeSearch).toHaveBeenCalledOnce();
  });
  it("cancels on unmount and never repolls a disposed job", async () => {
    vi.useFakeTimers();
    vi.mocked(native.pollNativeSearch).mockResolvedValue(job("job-anime", "running"));
    await render();
    await search();
    act(() => root.unmount());
    mounted = false;
    expect(native.cancelNativeSearch).toHaveBeenCalledWith("job-anime");
    await vi.advanceTimersByTimeAsync(5000);
    expect(native.pollNativeSearch).toHaveBeenCalledOnce();
  });
  it("keeps repeated explicit continuation available beyond two batches and at the retained-window bound", async () => {
    const window = job("job-anime");
    const seed = window.platforms.ig!.results[0];
    window.platforms.ig!.results = Array.from({ length: 300 }, (_, index) => ({
      ...seed,
      url: `https://www.instagram.com/p/Window${index}/`,
      position: index + 1,
    }));
    vi.mocked(native.pollNativeSearch).mockResolvedValue(window);
    await render();
    await search();
    for (let index = 0; index < 4; index++) {
      expect(state.canMore).toBe(true);
      await act(async () => {
        state.more();
      });
    }
    expect(native.moreNativeSearch).toHaveBeenCalledTimes(4);
    expect(state.snapshot?.platforms.ig?.results).toHaveLength(300);
    expect(state.canMore).toBe(true);
  });
  it("consumes a helper connection even while no category is active", async () => {
    props = { genre: anime, active: false };
    await render();
    expect(native.initializeNativeHelper).toHaveBeenCalled();
    expect(native.readNativeSearchCache).not.toHaveBeenCalled();
    expect(native.startNativeSearch).not.toHaveBeenCalled();
  });
});
