// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseStore } from "idb-keyval";
import { accumulateCategoryCandidates } from "../lib/discoverFeed";

const backend = vi.hoisted(() => ({
  value: undefined as unknown,
  gate: undefined as Promise<void> | undefined,
  failWrite: false,
  writes: vi.fn(),
  abort: vi.fn(),
}));

// Exercise the production adapter's atomic updater and transaction-abort path without a new DB dependency.
vi.mock("idb-keyval", () => ({
  createStore: () =>
    (async (_, callback) => {
      const transaction = { abort: backend.abort };
      return callback({ transaction } as unknown as IDBObjectStore);
    }) satisfies UseStore,
  get: async () => structuredClone(backend.value),
  update: async (_key: string, updater: (old: unknown) => unknown, store: UseStore) =>
    store("readwrite", async () => {
      backend.writes();
      const aborts = backend.abort.mock.calls.length;
      const next = updater(structuredClone(backend.value));
      await backend.gate;
      if (backend.abort.mock.calls.length !== aborts) throw new Error("transaction aborted");
      if (backend.failWrite) throw new Error("quota exceeded");
      backend.value = structuredClone(next);
    }),
}));

const now = new Date("2026-10-09T12:00:00Z");
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
    { genreId: "coffee", now },
  );
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal("indexedDB", {});
  backend.value = undefined;
  backend.gate = undefined;
  backend.failWrite = false;
  backend.writes.mockClear();
  backend.abort.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("candidate library store migration", () => {
  it("keeps legacy fallback until confirmed commit, omits it afterward, and restores it after failure", async () => {
    const { useStore, hydrateStore, flushDiscoverLibrary, STORAGE_KEY } = await import("./index");
    const legacy = candidates("LEGACY");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          ...useStore.getState(),
          discoverCandidates: legacy,
          bonusFreezes: 2,
        },
      }),
    );
    const pending = deferred();
    backend.gate = pending.promise;
    const loading = hydrateStore();
    await vi.waitFor(() => expect(backend.writes).toHaveBeenCalledOnce());
    expect(useStore.getState().discoverLibraryStatus).toBe("loading");
    expect(() => useStore.getState().exportState(now)).toThrow("still loading");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.discoverCandidates).toEqual(legacy);
    pending.resolve();
    await loading;
    expect(useStore.getState().discoverLibraryStatus).toBe("ready");
    const migrated = JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
    expect(migrated).not.toHaveProperty("discoverCandidates");
    expect(migrated.bonusFreezes).toBe(2);
    expect(backend.value).toMatchObject({ candidates: legacy });

    backend.failWrite = true;
    useStore
      .getState()
      .accumulateDiscoverCandidates([candidates("NEW")[0].item], { genreId: "coffee", now });
    await flushDiscoverLibrary();
    expect(useStore.getState().discoverLibraryStatus).toBe("unavailable");
    const fallback = JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
    expect(fallback.discoverCandidates).toHaveLength(2);
    expect(fallback.bonusFreezes).toBe(2);
    expect(JSON.parse(useStore.getState().exportState(now)).state.discoverCandidates).toHaveLength(
      2,
    );
    expect(backend.value).toMatchObject({ candidates: legacy });
  });

  it("exports the full durable corpus and replacement import/reset do not merge old records back", async () => {
    const { useStore, hydrateStore, flushDiscoverLibrary, STORAGE_KEY } = await import("./index");
    backend.value = { version: 1, epoch: "", candidates: candidates("DISK") };
    await hydrateStore();
    const backup = JSON.parse(useStore.getState().exportState(now));
    expect(backup.state.discoverCandidates).toEqual(candidates("DISK"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state).not.toHaveProperty(
      "discoverCandidates",
    );
    backup.state.discoverCandidates = candidates("IMPORTED");
    useStore.getState().importState(JSON.stringify(backup));
    useStore
      .getState()
      .accumulateDiscoverCandidates([candidates("STARTUP")[0].item], { genreId: "coffee", now });
    await flushDiscoverLibrary();
    expect(backend.value).toMatchObject({
      candidates: [...candidates("IMPORTED"), ...candidates("STARTUP")],
    });
    useStore.getState().reset();
    await flushDiscoverLibrary();
    expect(backend.value).toMatchObject({ candidates: [] });
    expect(useStore.getState().discoverLibraryPendingReplacement).toBe(false);
    await useStore.persist.rehydrate();
    await flushDiscoverLibrary();
    expect(useStore.getState().discoverCandidates).toEqual([]);
  });
});

describe("native candidate adapter fences", () => {
  it("adopts a newer disk epoch on ordinary writes and changes it only for explicit replacement", async () => {
    const { indexedDiscoverLibrary } = await import("../lib/discoverLibrary");
    const adapter = indexedDiscoverLibrary();
    backend.value = { version: 1, epoch: "new", candidates: candidates("NEW") };
    const stale = { version: 1 as const, epoch: "old", candidates: candidates("OLD") };
    expect(await adapter.write(stale, false)).toMatchObject({
      epoch: "new",
      candidates: candidates("NEW"),
    });
    expect(backend.value).toMatchObject({ epoch: "new", candidates: candidates("NEW") });
    expect(await adapter.write({ ...stale, epoch: "import" }, true)).toMatchObject({
      epoch: "import",
      candidates: candidates("OLD"),
    });
    expect(backend.value).toMatchObject({ epoch: "import", candidates: candidates("OLD") });
  });

  it("aborts a stalled transaction before timeout settles and prevents a late commit", async () => {
    vi.useFakeTimers();
    const { indexedDiscoverLibrary } = await import("../lib/discoverLibrary");
    const pending = deferred();
    backend.gate = pending.promise;
    const adapter = indexedDiscoverLibrary();
    const write = adapter.write({ version: 1, epoch: "", candidates: candidates("LATE") }, false);
    const rejected = expect(write).rejects.toThrow("write timed out");
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    expect(backend.abort).toHaveBeenCalledOnce();
    pending.resolve();
    await Promise.resolve();
    expect(backend.value).toBeUndefined();
  });
});
