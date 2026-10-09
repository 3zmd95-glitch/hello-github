import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiscoverLibrary,
  type DiscoverLibraryAdapter,
  type DiscoverLibrarySnapshot,
  type DiscoverLibraryStatus,
} from "./discoverLibrary";
import {
  accumulateCategoryCandidates,
  mergeDiscoverCandidates,
  type DiscoverCandidate,
} from "./discoverFeed";

const date = new Date("2026-10-09T12:00:00Z");
const candidates = (id: string) =>
  accumulateCategoryCandidates(
    [],
    [
      {
        platform: "ig",
        url: `https://www.instagram.com/p/${id}`,
        handle: "editor",
        title: "Coffee match cut",
        snippet: "Coffee match cut",
        section: "example",
        lang: "en",
      },
    ],
    { genreId: "coffee", now: date },
  );
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function harness(disk: DiscoverLibrarySnapshot = { version: 1, epoch: "", candidates: [] }) {
  const state = {
    candidates: [] as DiscoverCandidate[],
    epoch: disk.epoch,
    pending: false,
    status: "loading" as DiscoverLibraryStatus,
  };
  const adapter: DiscoverLibraryAdapter = {
    available: () => true,
    read: vi.fn(async () => structuredClone(disk)),
    write: vi.fn(async (snapshot, replace) => {
      disk =
        !replace && disk.epoch && disk.epoch !== snapshot.epoch
          ? disk
          : {
              ...snapshot,
              candidates: replace
                ? snapshot.candidates
                : mergeDiscoverCandidates(disk.candidates, snapshot.candidates),
            };
      return disk;
    }),
  };
  const library = createDiscoverLibrary(
    adapter,
    {
      current: () => state.candidates,
      epoch: () => state.epoch,
      pendingReplacement: () => state.pending,
      apply: (items, epoch) => {
        state.candidates = items;
        if (epoch !== undefined) state.epoch = epoch;
      },
      status: (status) => {
        state.status = status;
        if (status === "ready") state.pending = false;
      },
    },
    50,
  );
  return { state, adapter, library, disk: () => disk };
}
afterEach(() => vi.useRealTimers());

describe("durable discovery library lifecycle", () => {
  it("merges legacy records and startup mutations before confirming migration", async () => {
    const h = harness({ version: 1, epoch: "", candidates: candidates("DISK") });
    const read = deferred<unknown>();
    vi.mocked(h.adapter.read).mockReturnValue(read.promise);
    h.state.candidates = candidates("LEGACY");
    const loading = h.library.hydrate();
    h.state.candidates = mergeDiscoverCandidates(h.state.candidates, candidates("NEW"));
    h.library.changed();
    expect(h.library.durable()).toBe(false);
    expect(h.state.status).toBe("loading");
    read.resolve({ version: 1, epoch: "", candidates: candidates("DISK") });
    await loading;
    await h.library.flush();
    expect(h.state.candidates).toHaveLength(3);
    expect(h.disk().candidates).toHaveLength(3);
    expect(h.library.durable()).toBe(true);
    expect(h.state.status).toBe("ready");
  });

  it("fences a delayed read after reset and keeps replacement intent through a newer mutation", async () => {
    const h = harness({ version: 1, epoch: "old", candidates: candidates("OLD") });
    const read = deferred<unknown>();
    vi.mocked(h.adapter.read).mockReturnValue(read.promise);
    const loading = h.library.hydrate();
    h.state.epoch = "reset";
    h.state.pending = true;
    h.state.candidates = [];
    h.library.replace();
    h.state.candidates = candidates("NEW");
    h.library.changed();
    read.resolve({ version: 1, epoch: "old", candidates: candidates("OLD") });
    await loading;
    await h.library.flush();
    expect(h.state.candidates.map((entry) => entry.item.url)).toEqual([
      "https://www.instagram.com/p/NEW",
    ]);
    expect(h.disk().epoch).toBe("reset");
    expect(h.disk().candidates).toEqual(h.state.candidates);
    expect(vi.mocked(h.adapter.write).mock.calls.at(-1)?.[1]).toBe(true);
  });

  it("serializes a replacement after an already-running old write so old data cannot resurrect", async () => {
    const h = harness();
    await h.library.hydrate();
    const pending = deferred<DiscoverLibrarySnapshot>();
    vi.mocked(h.adapter.write).mockImplementationOnce(() => pending.promise);
    h.state.candidates = candidates("OLD");
    h.library.changed();
    await Promise.resolve();
    h.state.epoch = "import";
    h.state.pending = true;
    h.state.candidates = candidates("IMPORTED");
    h.library.replace();
    pending.resolve({ version: 1, epoch: "", candidates: candidates("OLD") });
    await h.library.flush();
    expect(h.disk().epoch).toBe("import");
    expect(h.disk().candidates).toEqual(candidates("IMPORTED"));
    expect(h.state.candidates).toEqual(candidates("IMPORTED"));
  });

  it("keeps a bounded-fallback signal after failure and retains pending replacement for reload", async () => {
    const h = harness({ version: 1, epoch: "old", candidates: candidates("OLD") });
    await h.library.hydrate();
    expect(h.library.durable()).toBe(true);
    vi.mocked(h.adapter.write).mockRejectedValueOnce(new Error("quota exceeded"));
    h.state.epoch = "reset";
    h.state.pending = true;
    h.state.candidates = [];
    h.library.replace();
    await h.library.flush();
    expect(h.library.durable()).toBe(false);
    expect(h.state.status).toBe("unavailable");
    expect(h.state.pending).toBe(true);
    const reload = harness(h.disk());
    reload.state.epoch = "reset";
    reload.state.pending = true;
    await reload.library.rehydrate();
    expect(reload.disk().epoch).toBe("reset");
    expect(reload.disk().candidates).toEqual([]);
  });

  it("adopts another tab's epoch after localStorage hydration without retaining old candidates", async () => {
    const h = harness({ version: 1, epoch: "old", candidates: candidates("OLD") });
    await h.library.hydrate();
    h.state.epoch = "other-tab";
    h.state.candidates = [];
    vi.mocked(h.adapter.read).mockResolvedValue({
      version: 1,
      epoch: "other-tab",
      candidates: candidates("OTHER"),
    });
    vi.mocked(h.adapter.write).mockImplementation(async (snapshot) => snapshot);
    await h.library.rehydrate();
    expect(h.state.candidates).toEqual(candidates("OTHER"));
    expect(h.state.status).toBe("ready");
  });

  it("times out a blocked startup read without a late overwrite or provider retry", async () => {
    vi.useFakeTimers();
    const h = harness();
    const read = deferred<unknown>();
    vi.mocked(h.adapter.read).mockReturnValue(read.promise);
    h.state.candidates = candidates("LEGACY");
    const loading = h.library.hydrate();
    await vi.advanceTimersByTimeAsync(51);
    await loading;
    expect(h.state.status).toBe("unavailable");
    expect(h.adapter.read).toHaveBeenCalledOnce();
    expect(h.adapter.write).not.toHaveBeenCalled();
    read.resolve({ version: 1, epoch: "", candidates: candidates("LATE") });
    await Promise.resolve();
    expect(h.state.candidates).toEqual(candidates("LEGACY"));
  });
});
