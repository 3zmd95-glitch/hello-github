// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseStore } from "idb-keyval";
import { accumulateCategoryCandidates } from "../lib/discoverFeed";
import type { DiscoverVisual } from "../lib/discoverVisual";

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
  it("retains a changed-media receipt through the production IDB updater and a fresh store reload", async () => {
    const [candidate] = candidates("VISUAL");
    const visual: DiscoverVisual = {
      version: 1,
      url: "https://www.instagram.com/p/VISUAL/",
      genreId: "coffee",
      checkedAt: now.toISOString(),
      source: {
        provenance: "instagram-public-embed",
        caption: "Coffee match cut",
        author: "editor",
        observedAt: now.toISOString(),
        sha256: "a".repeat(64),
      },
      media: {
        provenance: "instagram-public-embed-video",
        observedAt: now.toISOString(),
        durationSeconds: 12,
        videoSha256: "b".repeat(64),
        frames: [
          { timestampSeconds: 0, sha256: "c".repeat(64) },
          { timestampSeconds: 6, sha256: "d".repeat(64) },
        ],
      },
      provider: "chatgpt",
      model: "gpt-6-astra",
      effort: "max",
      assessment: {
        category: "supported",
        categoryFrames: [0],
        observations: [
          { cue: "layout", origin: "uploader-added", description: "Two panels.", frames: [1] },
        ],
        uncertainty: "Samples only.",
      },
      limitations: ["sampled_frames", "motion_partial", "audio_unverified"],
    };
    candidate.item.evidence = {
      source: "instagram-public-embed",
      caption: "Coffee match cut",
      author: "editor",
      observedAt: now.toISOString(),
      likes: 2000,
    };
    candidate.visual = visual;
    backend.value = { version: 1, epoch: "visual-library", candidates: [candidate] };
    const first = await import("./index");
    await first.hydrateStore();
    expect(first.useStore.getState().discoverCandidates[0].visual).toEqual(visual);
    const later = "2026-10-09T12:02:00Z";
    const observation = {
      version: visual.version,
      url: visual.url,
      genreId: visual.genreId,
      checkedAt: later,
      source: visual.source,
      media: { ...visual.media, observedAt: later, videoSha256: "e".repeat(64) },
    };
    const selection = { provider: "chatgpt" as const, model: visual.model, effort: visual.effort };
    expect(
      first.useStore.getState().applyDiscoverVisualResult(
        {
          status: "unavailable",
          error: "ai_limit",
          selection,
          modelCalls: 1,
          observation,
          source: {
            status: "available",
            url: visual.url,
            title: "Coffee match cut",
            description: "Coffee match cut",
            author: "editor",
            thumbnailUrl: "",
            provenance: "instagram-public-embed",
            observedAt: later,
            likes: 3000,
          },
        },
        {
          epoch: first.useStore.getState().discoverLibraryEpoch,
          genreId: "coffee",
          url: candidate.item.url,
          selection,
          isCurrent: () => true,
        },
        new Date(later),
      ),
    ).toBe("applied");
    await first.flushDiscoverLibrary();
    expect(backend.value).toMatchObject({
      candidates: [{ visualObservation: observation, item: { evidence: { likes: 3000 } } }],
    });
    expect(
      (backend.value as { candidates: (typeof candidate)[] }).candidates[0].visual,
    ).toBeUndefined();
    vi.resetModules();
    const reloaded = await import("./index");
    await reloaded.hydrateStore();
    const restored = reloaded.useStore.getState().discoverCandidates[0];
    expect(restored.visual).toBeUndefined();
    expect(restored.visualObservation).toEqual(observation);
    expect(restored.item.evidence?.likes).toBe(3000);
  });

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
