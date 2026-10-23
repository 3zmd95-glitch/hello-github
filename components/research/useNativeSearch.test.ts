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
  it("keeps a cached successful batch after a same-query refresh fails and retains its original age", async () => {
    const asOf = new Date(Date.now() - 3600000).toISOString();
    const saved = {
      ...job("cached-anime"),
      genreId: anime.id,
      queries: { ig: "anime edit", tt: "anime AMV", yt: "anime edit" },
      cached: true,
      asOf,
    };
    vi.mocked(native.readNativeSearchCache).mockResolvedValue(saved);
    const failedJob = job("job-anime");
    failedJob.platforms.ig = {
      ...failedJob.platforms.ig!,
      status: "error",
      results: [],
      error: "read-failed",
    };
    vi.mocked(native.pollNativeSearch).mockResolvedValue(failedJob);
    await render();
    await search();
    expect(state.snapshot?.platforms.ig).toMatchObject({
      status: "error",
      error: "read-failed",
      staleAsOf: asOf,
      results: saved.platforms.ig!.results,
    });
    expect(native.writeNativeSearchCache).toHaveBeenLastCalledWith(state.snapshot);
    await search();
    expect(state.snapshot?.platforms.ig?.staleAsOf).toBe(asOf);
  });
  it("keeps cards cached mid-read after an identical refresh fails", async () => {
    const asOf = new Date(Date.now() - 3600000).toISOString();
    const saved = {
      ...job("cached-anime", "running"),
      genreId: anime.id,
      queries: { ig: "anime edit", tt: "anime AMV", yt: "anime edit" },
      cached: true,
      asOf,
    };
    vi.mocked(native.readNativeSearchCache).mockResolvedValue(saved);
    const failedJob = job("job-anime");
    failedJob.platforms.ig = { ...failedJob.platforms.ig!, status: "error", results: [] };
    vi.mocked(native.pollNativeSearch).mockResolvedValue(failedJob);
    await render();
    await search();
    expect(state.snapshot?.platforms.ig).toMatchObject({
      status: "error",
      staleAsOf: asOf,
      results: saved.platforms.ig!.results,
    });
  });
  it("never revives older-query cards or a late refresh after a different query starts", async () => {
    await render();
    await search();
    const late = deferred<native.NativeJobSnapshot>();
    vi.mocked(native.pollNativeSearch).mockReturnValueOnce(late.promise);
    await search();
    const failedJob = job("different-query");
    failedJob.platforms.ig = {
      ...failedJob.platforms.ig!,
      status: "error",
      results: [],
      error: "read-failed",
    };
    vi.mocked(native.startNativeSearch).mockResolvedValueOnce("different-query");
    vi.mocked(native.pollNativeSearch).mockResolvedValueOnce(failedJob);
    await act(async () => {
      state.search({ ig: "travel edit" });
    });
    expect(state.snapshot?.platforms.ig?.results).toEqual([]);
    await act(async () => {
      late.resolve(job("job-anime"));
    });
    expect(state.snapshot?.jobId).toBe("different-query");
    expect(state.snapshot?.platforms.ig?.results).toEqual([]);
    expect(state.snapshot?.platforms.ig?.staleAsOf).toBeUndefined();
  });
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
    expect(state.canMore).toBe(true);
    expect(native.startNativeSearch).not.toHaveBeenCalled();
  });
  it("resumes a cached search only on request with its exact queries and one additional batch", async () => {
    vi.useFakeTimers();
    const saved: native.NativeSearchSnapshot = {
      ...job("cached-anime"),
      genreId: anime.id,
      queries: { ig: "saved precise query" },
      cached: true,
      asOf: new Date(Date.now() - 3600000).toISOString(),
    };
    vi.mocked(native.readNativeSearchCache).mockResolvedValue(saved);
    const start = deferred<string>();
    vi.mocked(native.startNativeSearch).mockReturnValueOnce(start.promise);
    const loading = job("resumed-job", "running");
    loading.platforms.ig!.results = [];
    const duplicate = { ...job("resumed-job"), platforms: saved.platforms };
    vi.mocked(native.pollNativeSearch)
      .mockResolvedValueOnce(loading)
      .mockResolvedValueOnce(duplicate)
      .mockResolvedValueOnce(job("resumed-job"));
    await render();
    expect(native.startNativeSearch).not.toHaveBeenCalled();
    act(() => {
      state.more();
      state.more();
    });
    expect(native.startNativeSearch).toHaveBeenCalledExactlyOnceWith(
      saved.queries,
      expect.any(String),
      { deep: false },
    );
    expect(state.busy).toBe(true);
    expect(state.snapshot).toEqual(saved);
    await act(async () => {
      start.resolve("resumed-job");
    });
    expect(state.snapshot?.platforms.ig?.results).toEqual(saved.platforms.ig!.results);
    expect(state.snapshot?.platforms.ig?.staleAsOf).toBe(saved.asOf);
    expect(native.moreNativeSearch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(native.moreNativeSearch).toHaveBeenCalledExactlyOnceWith("resumed-job");
    expect(state.snapshot?.platforms.ig?.results.map((result) => result.url)).toEqual([
      saved.platforms.ig!.results[0].url,
      job("resumed-job").platforms.ig!.results[0].url,
    ]);
    expect(state.snapshot?.platforms.ig?.staleAsOf).toBe(saved.asOf);
    expect(state.busy).toBe(false);
    expect(state.canMore).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(native.startNativeSearch).toHaveBeenCalledOnce();
    expect(native.moreNativeSearch).toHaveBeenCalledOnce();
    expect(native.pollNativeSearch).toHaveBeenCalledTimes(3);
  });
  it("recovers an expired continuation once and does not loop if the replacement also expires", async () => {
    await render();
    await search();
    const saved = state.snapshot;
    vi.mocked(native.moreNativeSearch).mockRejectedValue(new native.NativeSearchError("expired"));
    vi.mocked(native.startNativeSearch).mockResolvedValueOnce("replacement-job");
    vi.mocked(native.pollNativeSearch).mockResolvedValueOnce(job("replacement-job"));
    await act(async () => {
      state.more();
    });
    expect(native.startNativeSearch).toHaveBeenCalledTimes(2);
    expect(native.startNativeSearch).toHaveBeenLastCalledWith(saved!.queries, expect.any(String), {
      deep: false,
    });
    expect(native.moreNativeSearch).toHaveBeenCalledTimes(2);
    expect(state.error).toBe("expired");
    expect(state.busy).toBe(false);
    expect(state.snapshot?.platforms.ig?.results).toHaveLength(2);
    expect(state.canMore).toBe(true);
  });
  it("keeps old cards and honest error status if a resumed platform fails", async () => {
    const saved: native.NativeSearchSnapshot = {
      ...job("cached-anime"),
      genreId: anime.id,
      queries: { ig: "saved query" },
      cached: true,
      asOf: new Date(Date.now() - 3600000).toISOString(),
    };
    vi.mocked(native.readNativeSearchCache).mockResolvedValue(saved);
    const failedJob = job("job-anime");
    failedJob.platforms.ig = {
      ...failedJob.platforms.ig!,
      status: "error",
      results: [],
      error: "read-failed",
    };
    vi.mocked(native.pollNativeSearch).mockResolvedValue(failedJob);
    await render();
    await act(async () => {
      state.more();
    });
    expect(state.snapshot?.platforms.ig).toMatchObject({
      status: "error",
      error: "read-failed",
      results: saved.platforms.ig!.results,
      staleAsOf: saved.asOf,
    });
    expect(native.moreNativeSearch).not.toHaveBeenCalled();
    expect(state.busy).toBe(false);
  });
  it("cancels a resumed search before its acknowledgement without starting a follow-up batch", async () => {
    vi.mocked(native.readNativeSearchCache).mockResolvedValue({
      ...job("cached-anime"),
      genreId: anime.id,
      queries: { ig: "saved query" },
      cached: true,
      asOf: new Date().toISOString(),
    });
    const start = deferred<string>();
    vi.mocked(native.startNativeSearch).mockReturnValueOnce(start.promise);
    await render();
    act(() => {
      state.more();
      state.cancel();
    });
    expect(state.canMore).toBe(false);
    await act(async () => {
      start.resolve("late-resume");
    });
    expect(native.cancelNativeSearch).toHaveBeenCalledWith("late-resume");
    expect(native.pollNativeSearch).not.toHaveBeenCalled();
    expect(native.moreNativeSearch).not.toHaveBeenCalled();
  });
  it("does not append a resumed response after a new query replaces it", async () => {
    vi.mocked(native.readNativeSearchCache).mockResolvedValue({
      ...job("cached-anime"),
      genreId: anime.id,
      queries: { ig: "saved query" },
      cached: true,
      asOf: new Date().toISOString(),
    });
    const oldPoll = deferred<native.NativeJobSnapshot>();
    vi.mocked(native.pollNativeSearch).mockReturnValueOnce(oldPoll.promise);
    await render();
    await act(async () => {
      state.more();
    });
    vi.mocked(native.startNativeSearch).mockResolvedValueOnce("new-query");
    const replacement = job("new-query");
    vi.mocked(native.pollNativeSearch).mockResolvedValueOnce(replacement);
    await act(async () => {
      state.search({ ig: "different query" });
    });
    await act(async () => {
      oldPoll.resolve(job("old-resume"));
    });
    expect(state.snapshot?.queries).toEqual({ ig: "different query" });
    expect(state.snapshot?.platforms.ig?.results).toEqual(replacement.platforms.ig!.results);
    expect(native.moreNativeSearch).not.toHaveBeenCalled();
    expect(native.writeNativeSearchCache).toHaveBeenCalledOnce();
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
  it("does not offer a helper continuation for a finished search after a rejected query", async () => {
    vi.mocked(native.pollNativeSearch).mockResolvedValue(job("job-anime", "complete", false));
    await render();
    await search();
    expect(state.canMore).toBe(false);
    await act(async () => {
      state.search({ ig: "x".repeat(121) });
    });
    expect(state.error).toBe("invalid-query");
    expect(state.canMore).toBe(false);
    await act(async () => {
      state.more();
    });
    expect(native.moreNativeSearch).not.toHaveBeenCalled();
    expect(native.startNativeSearch).toHaveBeenCalledOnce();
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

describe("quiet Search and explicit Deep search (packet 22)", () => {
  it("starts quiet by default, passes an explicit Deep search through and keeps its mode on the snapshot", async () => {
    await render();
    await search();
    expect(native.startNativeSearch).toHaveBeenLastCalledWith(
      { ig: "anime edit", tt: "anime AMV", yt: "anime edit" },
      expect.any(String),
      { deep: false },
    );
    expect(state.snapshot?.deep).toBeUndefined();
    vi.mocked(native.startNativeSearch).mockResolvedValueOnce("job-deep");
    vi.mocked(native.pollNativeSearch).mockResolvedValueOnce(job("job-deep"));
    await act(async () => {
      state.search({ ig: "anime edit" }, { deep: true });
    });
    expect(native.startNativeSearch).toHaveBeenLastCalledWith(
      { ig: "anime edit" },
      expect.any(String),
      { deep: true },
    );
    expect(state.snapshot?.deep).toBe(true);
    expect(native.writeNativeSearchCache).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobId: "job-deep", deep: true }),
    );
  });
  it("resumes a saved deep search as a deep job", async () => {
    const saved: native.NativeSearchSnapshot = {
      ...job("cached-anime"),
      genreId: anime.id,
      queries: { ig: "saved precise query" },
      cached: true,
      asOf: new Date(Date.now() - 3600000).toISOString(),
      deep: true,
    };
    vi.mocked(native.readNativeSearchCache).mockResolvedValue(saved);
    await render();
    await act(async () => {
      state.more();
    });
    expect(native.startNativeSearch).toHaveBeenCalledExactlyOnceWith(
      saved.queries,
      expect.any(String),
      { deep: true },
    );
  });
});

describe("source tabs require a manual action", () => {
  it.each([false, true])("never automatically resumes a cached job (deep %s)", async (deep) => {
    vi.mocked(native.readNativeSearchCache).mockResolvedValue({
      ...job("cached"),
      genreId: anime.id,
      queries: { ig: "anime edit" },
      cached: true,
      asOf: new Date().toISOString(),
      ...(deep ? { deep: true } : {}),
    });
    await render();
    expect(state.canAutoMore).toBe(false);
    await act(async () => state.more({ automatic: true }));
    expect(native.startNativeSearch).not.toHaveBeenCalled();
    expect(native.moreNativeSearch).not.toHaveBeenCalled();
    await act(async () => state.more());
    expect(native.startNativeSearch).toHaveBeenCalledOnce();
  });
  it("never automatically continues a deep job that could steal focus", async () => {
    await render();
    await act(async () => state.search({ ig: "anime edit" }, { deep: true }));
    expect(state.canMore).toBe(true);
    expect(state.canAutoMore).toBe(false);
    await act(async () => state.more({ automatic: true }));
    expect(native.moreNativeSearch).not.toHaveBeenCalled();
    await act(async () => state.more());
    expect(native.moreNativeSearch).toHaveBeenCalledOnce();
  });
  it.each(["more", "poll"])(
    "an expired automatic %s stops instead of opening replacement tabs",
    async (at) => {
      await render();
      await search();
      expect(state.canAutoMore).toBe(true);
      const error = new native.NativeSearchError("expired");
      if (at === "more") vi.mocked(native.moreNativeSearch).mockRejectedValueOnce(error);
      else vi.mocked(native.pollNativeSearch).mockRejectedValueOnce(error);
      await act(async () => state.more({ automatic: true }));
      expect(native.moreNativeSearch).toHaveBeenCalledOnce();
      expect(native.startNativeSearch).toHaveBeenCalledOnce();
      expect(state.error).toBe("expired");
      expect(state.canAutoMore).toBe(false);
    },
  );
  it("continues a live quiet job without starting another search", async () => {
    await render();
    await search();
    expect(state.canAutoMore).toBe(true);
    await act(async () => state.more({ automatic: true }));
    expect(native.moreNativeSearch).toHaveBeenCalledOnce();
    expect(native.startNativeSearch).toHaveBeenCalledOnce();
  });
});
