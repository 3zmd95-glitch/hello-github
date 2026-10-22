// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeNativeResults } from "@/extensions/discover-import/native-protocol.js";
import {
  NATIVE_CACHE_TTL_MS,
  NATIVE_HELPER_STORAGE_KEY,
  attachNativeHelper,
  appendNativeSearchSnapshot,
  canonicalNativeUrl,
  initializeNativeHelper,
  nativeHelperStatus,
  nativeResultsToItems,
  moreNativeSearch,
  pollNativeSearch,
  readNativeSearchCache,
  retainFailedNativePlatforms,
  startNativeSearch,
  validNativeCache,
  validateNativeQueries,
  validateNativeSnapshot,
  writeNativeSearchCache,
  type NativeSearchSnapshot,
} from "./discoverNativeSearch";

const persistence = vi.hoisted(() => ({ value: undefined as unknown, unavailable: false }));
vi.mock("idb-keyval", () => ({
  createStore: vi.fn(() => "native-cache"),
  get: vi.fn(async () => {
    if (persistence.unavailable) throw new Error("blocked");
    return persistence.value;
  }),
  update: vi.fn(async (_key, updater) => {
    if (persistence.unavailable) throw new Error("quota");
    persistence.value = updater(persistence.value);
  }),
}));
const id = "abcdefghijklmnopabcdefghijklmnop";
const at = () => new Date().toISOString();
const card = (override: Record<string, unknown> = {}) => ({
  platform: "ig",
  url: "https://www.instagram.com/reel/Native123/?igsh=tracking",
  title: "Anime AMV edit",
  handle: "editor",
  thumb: "https://scontent.cdninstagram.com/post.jpg",
  position: 1,
  observedAt: at(),
  ...override,
});
const raw = (cards = [card()]) => ({
  ok: true,
  jobId: "job-1",
  status: "complete",
  hasMore: true,
  platforms: {
    ig: {
      status: "done",
      results: cards,
      searchUrl: "https://www.instagram.com/explore/search/keyword/?q=anime",
    },
  },
});
const cached = (genreId = "anime", asOf = at()): NativeSearchSnapshot => ({
  ...validateNativeSnapshot(raw())!,
  genreId,
  asOf,
  queries: { ig: "anime" },
  cached: false,
});
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  persistence.value = undefined;
  persistence.unavailable = false;
  vi.stubGlobal("indexedDB", {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native helper attachment and messaging", () => {
  it("consumes only a complete valid connection fragment and stores just the public ID", () => {
    window.history.replaceState({ state: "kept" }, "", `/?view=browse#discover-helper=${id}`);
    expect(initializeNativeHelper()).toBe(id);
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?view=browse");
    expect(window.history.state).toEqual({ state: "kept" });
    expect(localStorage.getItem(NATIVE_HELPER_STORAGE_KEY)).toBe(id);
    window.history.replaceState(null, "", "/#discover-helper=invalid&section=anime");
    initializeNativeHelper();
    expect(window.location.hash).toBe("#discover-helper=invalid&section=anime");
    expect(attachNativeHelper("a".repeat(31))).toBe(false);
  });
  it("checks the exact callback runtime error and does not leak its raw message", async () => {
    attachNativeHelper(id);
    const lastError = vi.fn(() => ({ message: "permission denied private detail" }));
    const runtime = {
      sendMessage: vi.fn((_id, _message, callback) => callback(undefined)),
      get lastError() {
        return lastError();
      },
    };
    vi.stubGlobal("chrome", { runtime });
    expect(await nativeHelperStatus()).toBe("permission");
    expect(lastError).toHaveBeenCalledOnce();
  });
  it("rejects an unacknowledged request after eight seconds", async () => {
    vi.useFakeTimers();
    attachNativeHelper(id);
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn() } });
    const result = startNativeSearch({ ig: "anime" }, "request-1").catch((error) => error.code);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toBe("timeout");
  });
  it("sends deep only for an explicit Deep search, so a quiet search stays valid for older helpers", async () => {
    attachNativeHelper(id);
    const sendMessage = vi.fn((_id, _message, callback) => callback({ ok: true, jobId: "job-1" }));
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await startNativeSearch({ ig: "anime" }, "request-1");
    await startNativeSearch({ ig: "anime" }, "request-2", { deep: false });
    await startNativeSearch({ ig: "anime" }, "request-3", { deep: true });
    expect(sendMessage.mock.calls.map(([, message]) => message)).toEqual([
      { version: 1, type: "search", requestId: "request-1", queries: { ig: "anime" } },
      { version: 1, type: "search", requestId: "request-2", queries: { ig: "anime" } },
      { version: 1, type: "search", requestId: "request-3", queries: { ig: "anime" }, deep: true },
    ]);
  });
  it("rejects mismatched poll jobs", async () => {
    attachNativeHelper(id);
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn((_id, _message, callback) => callback(raw())) },
    });
    await expect(pollNativeSearch("different-job")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it("distinguishes an expired owned job from a generic helper failure", async () => {
    attachNativeHelper(id);
    const sendMessage = vi.fn((_id, _message, callback) =>
      callback({ ok: false, error: "job-not-found" }),
    );
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await expect(moreNativeSearch("expired-job")).rejects.toMatchObject({ code: "expired" });
    sendMessage.mockImplementation((_id, _message, callback) =>
      callback({ ok: false, error: "internal-error" }),
    );
    await expect(moreNativeSearch("expired-job")).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("native payload boundary", () => {
  it.each([
    [
      "https://www.youtube.com/watch?v=Abcdef12345",
      "https://i.ytimg.com/vi/Abcdef12345/hqdefault.jpg",
    ],
    [
      "https://www.youtube.com/shorts/Abcdef12345",
      "https://i.ytimg.com/vi/Abcdef12345/hqdefault.jpg",
    ],
    ["https://www.youtube.com/watch?v=short", undefined],
    ["https://private.test/watch?v=Abcdef12345", undefined],
  ])("derives a missing YouTube poster only from a valid video URL: %s", (url, expected) => {
    const snapshot = cached();
    snapshot.platforms = {
      yt: {
        status: "done",
        searchUrl: "https://www.youtube.com/results?search_query=anime",
        results: [{ platform: "yt", url, title: "Native video", position: 1, observedAt: at() }],
      },
    };
    expect(nativeResultsToItems(snapshot, "en")[0].thumb).toBe(expected);
    const provided = "https://i.ytimg.com/vi/Abcdef12345/hq720.jpg";
    snapshot.platforms.yt!.results[0].thumb = provided;
    expect(nativeResultsToItems(snapshot, "en")[0].thumb).toBe(provided);
  });
  it("preserves Instagram tiles with no visible title without inventing source text", () => {
    const fromBridge = sanitizeNativeResults("ig", [card({ title: "" })], at());
    const parsed = validateNativeSnapshot(raw(fromBridge));
    expect(parsed?.platforms.ig?.results).toHaveLength(1);
    expect(parsed?.platforms.ig?.results[0].title).toBe("");
    const item = nativeResultsToItems({ ...cached(), ...parsed! }, "en")[0];
    expect(item.title).toBe("Native search result");
    expect(item).not.toHaveProperty("evidence");
  });
  it("interleaves source positions without reranking unknown engagement", () => {
    const snapshot = cached();
    snapshot.platforms.ig!.results.push({
      ...snapshot.platforms.ig!.results[0],
      url: "https://www.instagram.com/p/NativeTwo/",
      position: 2,
    });
    snapshot.platforms.tt = {
      status: "done",
      searchUrl: "https://www.tiktok.com/search?q=anime",
      results: [
        {
          platform: "tt",
          url: "https://www.tiktok.com/@editor/video/1234567890123456789",
          title: "TikTok edit",
          observedAt: at(),
          position: 1,
        },
      ],
    };
    expect(nativeResultsToItems(snapshot, "en").map((item) => item.platform)).toEqual([
      "ig",
      "tt",
      "ig",
    ]);
  });
  it("canonicalizes public links and discards duplicates and unsafe cards", () => {
    const parsed = validateNativeSnapshot(
      raw([
        card(),
        card({ url: "https://instagram.com/p/Native123/" }),
        card({ url: "http://127.0.0.1/private" }),
        card({ url: "https://instagram.com.evil.test/p/Native234/" }),
        card({
          url: "https://www.instagram.com/p/Native345/",
          observedAt: new Date(Date.now() + 600000).toISOString(),
        }),
        card({ url: "https://www.instagram.com/p/Native456/", platform: "tt" }),
      ]),
    );
    expect(parsed?.platforms.ig?.results).toHaveLength(1);
    expect(parsed?.platforms.ig?.results[0].url).toBe("https://www.instagram.com/p/Native123/");
    expect(canonicalNativeUrl("yt", "https://youtu.be/Abcdef12345?t=30")).toBe(
      "https://www.youtube.com/watch?v=Abcdef12345",
    );
    expect(
      canonicalNativeUrl("tt", "https://www.tiktok.com/@edit/video/1234567890123456789?lang=en"),
    ).toBe("https://www.tiktok.com/@edit/video/1234567890123456789");
    expect(canonicalNativeUrl("ig", "https://secret@instagram.com/p/Native123/")).toBeNull();
  });
  it("strips evidence and numeric claims while allowing displayed stats only as text", () => {
    const snapshot = {
      ...cached(),
      ...validateNativeSnapshot(
        raw([
          card({
            likes: 999999,
            stats: { likes: 999999 },
            evidence: { source: "instagram-public-embed", likes: 999999 },
            displayedStats: "12K views",
            thumb: "https://127.0.0.1/internal.png",
          }),
        ]),
      )!,
    };
    const [item] = nativeResultsToItems(snapshot, "en");
    expect(item).not.toHaveProperty("evidence");
    expect(item).not.toHaveProperty("stats");
    expect(item).not.toHaveProperty("thumb");
    expect(item.snippet).toBe("Shown in native search: 12K views");
    expect(snapshot.platforms.ig?.results[0]).not.toHaveProperty("likes");
  });
  it("rejects oversized collections, malformed states, wrong search hosts and unbounded queries", () => {
    expect(validateNativeSnapshot(raw(Array.from({ length: 301 }, () => card())))).toBeNull();
    expect(validateNativeSnapshot({ ...raw(), hasMore: "yes" })).toBeNull();
    expect(validateNativeSnapshot({ ...raw(), status: "authenticated" })).toBeNull();
    expect(
      validateNativeSnapshot({
        ...raw(),
        platforms: { ig: { ...raw().platforms.ig, searchUrl: "https://localhost/search" } },
      }),
    ).toBeNull();
    expect(validateNativeQueries({ ig: "a".repeat(121) })).toBeNull();
    expect(validateNativeQueries({ ig: "  " })).toBeNull();
    expect(validateNativeQueries({ ig: "anime", cookie: "secret" })).toBeNull();
  });
  it("keeps the helper's short Deep search skip reason and nothing else from its diagnostics", () => {
    expect(
      validateNativeSnapshot({ ...raw(), diagnostics: { deepSkipped: "window-not-focused" } }),
    ).toMatchObject({ deepSkipped: "window-not-focused" });
    expect(validateNativeSnapshot(raw())).not.toHaveProperty("deepSkipped");
    for (const deepSkipped of [true, "", "x".repeat(41), "<b>window</b>"])
      expect(validateNativeSnapshot({ ...raw(), diagnostics: { deepSkipped } })).not.toHaveProperty(
        "deepSkipped",
      );
    expect(
      validateNativeSnapshot({ ...raw(), diagnostics: { focus: { skipReason: "quiet" } } }),
    ).not.toHaveProperty("diagnostics");
  });
  it("keeps the helper's No results marker only on an empty platform, and a timeout as a failed read", () => {
    const platform = (extra: Record<string, unknown>) =>
      validateNativeSnapshot({
        ...raw(),
        platforms: { ig: { ...raw().platforms.ig, results: [], ...extra } },
      })?.platforms.ig;
    expect(platform({ status: "empty", noResults: true })).toMatchObject({
      status: "empty",
      noResults: true,
    });
    expect(platform({ status: "empty" })).not.toHaveProperty("noResults");
    expect(platform({ status: "empty", noResults: "yes" })).not.toHaveProperty("noResults");
    expect(platform({ status: "error", noResults: true })).not.toHaveProperty("noResults");
    expect(platform({ status: "error", error: "search-timeout" })).toMatchObject({
      status: "error",
      error: "search-timeout",
    });
    expect(platform({ status: "error", error: "timeout" })).toMatchObject({ error: "timeout" });
  });
  it.each([
    "data:image/png;base64,abc",
    "blob:https://instagram.com/image",
    "https://cdninstagram.com.evil.test/image.png",
  ])("drops unsafe thumbnail %s", (thumb) => {
    expect(
      validateNativeSnapshot(raw([card({ thumb })]))?.platforms.ig?.results[0].thumb,
    ).toBeUndefined();
  });
});

describe("bounded native category cache", () => {
  it("keeps a saved Deep search's mode and nothing else in its place", () => {
    expect(validNativeCache([{ ...cached(), deep: true }])[0].deep).toBe(true);
    expect(validNativeCache([{ ...cached(), deep: "yes" }])[0]).not.toHaveProperty("deep");
    expect(validNativeCache([cached()])[0]).not.toHaveProperty("deep");
  });
  it("appends resumed cards in platform order, deduplicates aliases, and retains the original age", async () => {
    const oldTime = new Date(Date.now() - 3600000).toISOString();
    const previous = cached("anime", oldTime);
    previous.platforms.ig!.results[0].observedAt = oldTime;
    const next = cached();
    next.jobId = "resumed-job";
    next.platforms.ig!.results = [
      { ...next.platforms.ig!.results[0], url: "https://www.instagram.com/p/NewNative/" },
    ];
    const merged = appendNativeSearchSnapshot(previous, next);
    expect(merged.platforms.ig!.results.map((result) => result.url)).toEqual([
      "https://www.instagram.com/p/Native123/",
      "https://www.instagram.com/p/NewNative/",
    ]);
    expect(merged.platforms.ig!.results[0].observedAt).toBe(oldTime);
    expect(merged.platforms.ig!.staleAsOf).toBe(oldTime);
    expect(merged.platforms.ig!.results.map((result) => result.position)).toEqual([1, 2]);
    await writeNativeSearchCache(merged);
    expect((await readNativeSearchCache("anime"))?.platforms.ig!.staleAsOf).toBe(oldTime);

    next.platforms.ig!.results.unshift({
      ...previous.platforms.ig!.results[0],
      url: "https://www.instagram.com/reel/Native123/",
      title: "Reobserved",
      observedAt: at(),
    });
    const refreshed = appendNativeSearchSnapshot(previous, next);
    expect(refreshed.platforms.ig!.results).toHaveLength(2);
    expect(refreshed.platforms.ig!.results[0].title).toBe("Reobserved");
    expect(refreshed.platforms.ig!.staleAsOf).toBeUndefined();
    expect(appendNativeSearchSnapshot(previous, { ...next, queries: { ig: "travel" } })).toEqual({
      ...next,
      queries: { ig: "travel" },
    });
    expect(appendNativeSearchSnapshot(previous, { ...next, genreId: "travel" })).toEqual({
      ...next,
      genreId: "travel",
    });
  });
  it("places resumed cards in the fresh native order and anchors retained-only cards", () => {
    const seed = cached().platforms.ig!.results[0];
    const rows = (ids: string[], path = "p") =>
      ids.map((id, index) => ({
        ...seed,
        url: `https://www.instagram.com/${path}/${id}/`,
        title: id,
        position: index + 1,
      }));
    const ids = (snapshot: NativeSearchSnapshot) =>
      snapshot.platforms.ig!.results.map((result) => result.url.split("/").at(-2));
    const previous = cached();
    previous.platforms.ig!.results = rows(["PostA", "PostC"]);
    const next = cached();
    next.platforms.ig!.results = rows(["PostA", "PostB", "PostC", "PostD"]);
    const merged = appendNativeSearchSnapshot(previous, next);
    expect(ids(merged)).toEqual(["PostA", "PostB", "PostC", "PostD"]);
    expect(merged.platforms.ig!.results.map((result) => result.position)).toEqual([1, 2, 3, 4]);
    expect(merged.platforms.ig!.staleAsOf).toBeUndefined();

    previous.platforms.ig!.results = rows(["PostA", "PostX", "PostC"]);
    // A duplicate alias of A in the fresh snapshot is the same card.
    next.platforms.ig!.results = [
      ...rows(["PostA"], "reel"),
      ...rows(["PostA", "PostB", "PostC", "PostD"]),
    ];
    const anchored = appendNativeSearchSnapshot(previous, next);
    expect(ids(anchored)).toEqual(["PostA", "PostX", "PostB", "PostC", "PostD"]);
    expect(anchored.platforms.ig!.staleAsOf).toBe(previous.asOf);
    expect(appendNativeSearchSnapshot(previous, { ...next, genreId: "travel" })).toEqual({
      ...next,
      genreId: "travel",
    });
  });
  it("rolls resumed windows without counting the same helper omissions or poll twice", () => {
    const previous = cached();
    const seed = previous.platforms.ig!.results[0];
    const rows = Array.from({ length: 330 }, (_, index) => ({
      ...seed,
      url: `https://www.instagram.com/p/Window${index}/`,
      position: index + 1,
    }));
    previous.platforms.ig!.results = rows.slice(0, 300);
    const next = cached();
    next.platforms.ig!.results = rows.slice(30);
    next.platforms.ig!.omittedCount = 30;
    const result = appendNativeSearchSnapshot(previous, next);
    expect(result.platforms.ig!.results).toHaveLength(300);
    expect(result.platforms.ig!.omittedCount).toBe(30);
    expect(result.platforms.ig!.results[0].url).toBe(rows[30].url);
    expect(appendNativeSearchSnapshot(result, next).platforms.ig!.omittedCount).toBe(30);
    previous.platforms.ig!.omittedCount = 90;
    expect(appendNativeSearchSnapshot(previous, next).platforms.ig!.omittedCount).toBe(120);
  });
  it("retains only failed same-category/platform queries, and persists honest stale metadata", async () => {
    const previous = cached();
    previous.asOf = new Date(Date.now() - 3600000).toISOString();
    const next = cached();
    next.platforms.ig = {
      ...next.platforms.ig!,
      status: "error",
      results: [],
      error: "read-failed",
    };
    const fallback = retainFailedNativePlatforms(previous, next);
    expect(fallback.platforms.ig).toMatchObject({
      status: "error",
      staleAsOf: previous.asOf,
      results: previous.platforms.ig!.results,
    });
    await writeNativeSearchCache(fallback);
    expect((await readNativeSearchCache("anime"))?.platforms.ig?.staleAsOf).toBe(previous.asOf);
    expect(
      validateNativeSnapshot({ ...fallback, ok: true })?.platforms.ig?.staleAsOf,
    ).toBeUndefined();
    expect(
      retainFailedNativePlatforms(previous, { ...next, genreId: "travel" }).platforms.ig?.results,
    ).toEqual([]);
    expect(
      retainFailedNativePlatforms(previous, { ...next, queries: { ig: "another query" } }).platforms
        .ig?.results,
    ).toEqual([]);
    next.platforms.ig!.status = "empty";
    expect(retainFailedNativePlatforms(previous, next).platforms.ig?.results).toEqual([]);
    next.platforms.ig!.status = "needs-attention";
    expect(retainFailedNativePlatforms(previous, next).platforms.ig?.results).toEqual(
      previous.platforms.ig!.results,
    );
    next.platforms.ig!.results = [
      { ...previous.platforms.ig!.results[0], url: "https://www.instagram.com/p/FreshNative/" },
    ];
    expect(retainFailedNativePlatforms(previous, next).platforms.ig?.results).toEqual(
      next.platforms.ig!.results,
    );
  });
  it("keeps cached TikTok cards when a same-query refresh hits the source-error screen, then an explicit retry replaces them", () => {
    const tiktok = (count: number, start = 0, status = "done", error?: string) => ({
      status,
      ...(error ? { error } : {}),
      searchUrl: "https://www.tiktok.com/search?q=perfume",
      results: Array.from({ length: count }, (_, i) =>
        card({
          platform: "tt",
          url: `https://www.tiktok.com/@editor/video/70000000000000${String(start + i).padStart(5, "0")}`,
          title: `TikTok ${start + i}`,
          handle: "@editor",
          thumb: "https://p16.tiktokcdn.com/thumb.jpg",
          position: start + i + 1,
        }),
      ),
    });
    const snapshot = (platform: unknown, asOf: string): NativeSearchSnapshot => ({
      ...validateNativeSnapshot({
        ok: true,
        jobId: "job-1",
        status: "complete",
        hasMore: false,
        platforms: { tt: platform },
      })!,
      genreId: "perfume",
      asOf,
      queries: { tt: "perfume" },
      cached: false,
    });
    const previous = snapshot(tiktok(3), new Date(Date.now() - 3600000).toISOString());
    expect(previous.platforms.tt?.results).toHaveLength(3);
    const failed = snapshot(tiktok(0, 0, "error", "read-failed"), at());
    expect(failed.platforms.tt).toMatchObject({ status: "error", results: [] });
    const retained = retainFailedNativePlatforms(previous, failed);
    expect(retained.platforms.tt).toMatchObject({
      status: "error",
      error: "read-failed",
      staleAsOf: previous.asOf,
    });
    expect(retained.platforms.tt?.results).toEqual(previous.platforms.tt!.results);
    // The later successful explicit retry replaces them and drops the stale label.
    const fresh = snapshot(tiktok(5, 10), at());
    const replaced = retainFailedNativePlatforms(retained, fresh);
    expect(replaced.platforms.tt?.status).toBe("done");
    expect(replaced.platforms.tt?.results).toEqual(fresh.platforms.tt!.results);
    expect(replaced.platforms.tt?.results).toHaveLength(5);
    expect(replaced.platforms.tt?.staleAsOf).toBeUndefined();
  });
  it("retains cards received while a platform was still loading when the identical refresh fails", () => {
    const previous = cached();
    previous.asOf = new Date(Date.now() - 3600000).toISOString();
    previous.platforms.ig!.status = "loading";
    const answer = (status: "error" | "needs-attention" | "empty") => {
      const next = cached();
      next.platforms.ig = { ...next.platforms.ig!, status, results: [], error: "read-failed" };
      return next;
    };
    for (const status of ["error", "needs-attention"] as const)
      expect(retainFailedNativePlatforms(previous, answer(status)).platforms.ig).toMatchObject({
        status,
        staleAsOf: previous.asOf,
        results: previous.platforms.ig!.results,
      });
    const otherQuery = { ...answer("error"), queries: { ig: "another query" } };
    expect(retainFailedNativePlatforms(previous, otherQuery).platforms.ig?.results).toEqual([]);
    const emptySource = retainFailedNativePlatforms(previous, answer("empty")).platforms.ig;
    expect(emptySource?.results).toEqual([]);
    expect(emptySource?.staleAsOf).toBeUndefined();
    previous.platforms.ig!.results = [];
    const nothing = retainFailedNativePlatforms(previous, answer("error")).platforms.ig;
    expect(nothing?.results).toEqual([]);
    expect(nothing?.staleAsOf).toBeUndefined();
  });
  it("restores a cached loading platform honestly: received cards are done, an unfinished read is an error", async () => {
    const staleAsOf = new Date(Date.now() - 3600000).toISOString();
    const saved = cached();
    saved.status = "running";
    saved.queries = { ig: "anime", tt: "anime" };
    saved.platforms.ig = { ...saved.platforms.ig!, status: "loading", staleAsOf };
    saved.platforms.tt = {
      status: "loading",
      results: [],
      searchUrl: "https://www.tiktok.com/search?q=anime",
    };
    const [restored] = validNativeCache([saved]);
    expect(restored.platforms.ig).toMatchObject({
      status: "done",
      results: saved.platforms.ig.results,
      staleAsOf,
    });
    expect(restored.platforms.tt).toMatchObject({ status: "error", results: [] });
    await writeNativeSearchCache(saved);
    const reopened = await readNativeSearchCache("anime");
    expect(reopened?.platforms.ig).toMatchObject({
      status: "done",
      results: saved.platforms.ig.results,
      staleAsOf,
    });
    expect(reopened?.platforms.tt?.status).toBe("error");
  });
  it("accepts and caches a rolling 300-card window without treating omitted cards as results", async () => {
    const response = raw(
      Array.from({ length: 300 }, (_, index) =>
        card({
          url: `https://www.instagram.com/p/Native${index}/`,
          position: index + 1,
        }),
      ),
    );
    const parsed = validateNativeSnapshot({
      ...response,
      platforms: { ig: { ...response.platforms.ig, omittedCount: 420 } },
    });
    expect(parsed?.platforms.ig?.results).toHaveLength(300);
    expect(parsed?.platforms.ig?.omittedCount).toBe(420);
    await writeNativeSearchCache({ ...cached(), ...parsed! });
    const restored = await readNativeSearchCache("anime");
    expect(restored?.platforms.ig?.results).toHaveLength(300);
    expect(restored?.platforms.ig?.omittedCount).toBe(420);
    expect(restored?.cached).toBe(true);
    expect(validateNativeSnapshot(raw())?.platforms.ig).not.toHaveProperty("omittedCount");
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "30", null])(
    "rejects invalid omittedCount %s",
    (omittedCount) => {
      const response = raw();
      expect(
        validateNativeSnapshot({
          ...response,
          platforms: { ig: { ...response.platforms.ig, omittedCount } },
        }),
      ).toBeNull();
    },
  );
  it("keeps the latest twelve distinct categories for seven days with a cached marker", () => {
    const now = Date.now();
    const entries = Array.from({ length: 16 }, (_, index) =>
      cached(`category-${index}`, new Date(now - index * 1000).toISOString()),
    );
    const result = validNativeCache(
      [
        cached("expired", new Date(now - NATIVE_CACHE_TTL_MS - 1).toISOString()),
        ...entries,
        entries[0],
      ],
      now,
    );
    expect(result).toHaveLength(12);
    expect(result.map((entry) => entry.genreId)).toEqual(
      entries.slice(0, 12).map((entry) => entry.genreId),
    );
    expect(result.every((entry) => entry.cached)).toBe(true);
  });
  it("keeps the Search tab's one entry beside twelve categories: a keyword search never evicts one", async () => {
    for (let i = 0; i < 12; i++) await writeNativeSearchCache(cached(`category-${i}`));
    await writeNativeSearchCache(cached("search"));
    await writeNativeSearchCache(cached("search"));
    expect(persistence.value).toHaveLength(13);
    for (let i = 0; i < 12; i++)
      expect(await readNativeSearchCache(`category-${i}`)).not.toBeNull();
    expect(await readNativeSearchCache("search")).not.toBeNull();
  });
  it("keeps the CapCut and DaVinci Resolve search entries beside twelve categories too", async () => {
    for (let i = 0; i < 12; i++) await writeNativeSearchCache(cached(`category-${i}`));
    for (const scope of ["search", "search-capcut", "search-davinci"])
      await writeNativeSearchCache(cached(scope));
    expect(persistence.value).toHaveLength(15);
    for (let i = 0; i < 12; i++)
      expect(await readNativeSearchCache(`category-${i}`)).not.toBeNull();
    for (const scope of ["search", "search-capcut", "search-davinci"])
      expect(await readNativeSearchCache(scope)).not.toBeNull();
  });
  it("persists in the separate store and gracefully tolerates unavailable storage", async () => {
    for (let i = 0; i < 15; i++) await writeNativeSearchCache(cached(`category-${i}`));
    expect(persistence.value).toHaveLength(12);
    expect((await readNativeSearchCache("category-14"))?.cached).toBe(true);
    persistence.unavailable = true;
    await expect(writeNativeSearchCache(cached())).resolves.toBeUndefined();
    await expect(readNativeSearchCache("anime")).resolves.toBeNull();
  });
});
