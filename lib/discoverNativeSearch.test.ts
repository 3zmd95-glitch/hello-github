// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeNativeResults } from "@/extensions/discover-import/native-protocol.js";
import {
  NATIVE_CACHE_TTL_MS,
  NATIVE_HELPER_STORAGE_KEY,
  attachNativeHelper,
  canonicalNativeUrl,
  initializeNativeHelper,
  nativeHelperStatus,
  nativeResultsToItems,
  pollNativeSearch,
  readNativeSearchCache,
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
  it("rejects mismatched poll jobs", async () => {
    attachNativeHelper(id);
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn((_id, _message, callback) => callback(raw())) },
    });
    await expect(pollNativeSearch("different-job")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});

describe("native payload boundary", () => {
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
    expect(validateNativeSnapshot(raw(Array.from({ length: 91 }, () => card())))).toBeNull();
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
  it("persists in the separate store and gracefully tolerates unavailable storage", async () => {
    for (let i = 0; i < 15; i++) await writeNativeSearchCache(cached(`category-${i}`));
    expect(persistence.value).toHaveLength(12);
    expect((await readNativeSearchCache("category-14"))?.cached).toBe(true);
    persistence.unavailable = true;
    await expect(writeNativeSearchCache(cached())).resolves.toBeUndefined();
    await expect(readNativeSearchCache("anime")).resolves.toBeNull();
  });
});
