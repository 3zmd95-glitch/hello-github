import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearScoutCache,
  getScoutUsage,
  isValidScoutUrl,
  monthKey,
  peekScoutSearch,
  SCOUT_CACHE_EMPTY_TTL_MS,
  SCOUT_CACHE_KEY,
  SCOUT_CACHE_MAX,
  SCOUT_CACHE_TTL_MS,
  SCOUT_USAGE_KEY,
  scoutCacheKey,
  scoutStorageKey,
  scoutConfig,
  scoutErrorMessageKey,
  scoutHealth,
  scoutOembed,
  scoutSearch,
  subscribeScoutUsage,
  type KeyValueStorage,
} from "./scoutClient";

function fakeStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CONFIG = { url: "https://scout.test", token: "tok" };
const RESULTS = [
  {
    platform: "tt",
    handle: "@editor.sam",
    title: "Match cut",
    snippet: "snip",
    url: "https://www.tiktok.com/@editor.sam/video/1",
  },
  {
    platform: "ig",
    handle: "@cuts",
    title: "Reel",
    snippet: "",
    url: "https://www.instagram.com/cuts/reel/abc",
    thumb: "https://cdn.example/t.jpg",
  },
];

let storage: ReturnType<typeof fakeStorage>;
let t = new Date(2026, 8, 27, 12).getTime();
const now = () => t;

beforeEach(() => {
  storage = fakeStorage();
  t = new Date(2026, 8, 27, 12).getTime();
  clearScoutCache(null);
});

describe("config", () => {
  it("accepts https URLs and local wrangler dev, nothing else", () => {
    expect(isValidScoutUrl("https://3z-scout.me.workers.dev")).toBe(true);
    expect(isValidScoutUrl("http://localhost:8787")).toBe(true);
    expect(isValidScoutUrl("http://3z-scout.me.workers.dev")).toBe(false);
    expect(isValidScoutUrl("ftp://x")).toBe(false);
    expect(isValidScoutUrl("not a url")).toBe(false);
  });

  it("builds a config only when both URL and token are set, trimming the trailing slash", () => {
    expect(scoutConfig("https://scout.test/", " tok ")).toEqual(CONFIG);
    expect(scoutConfig("https://scout.test", "")).toBeNull();
    expect(scoutConfig(undefined, "tok")).toBeNull();
    expect(scoutConfig("http://evil.test", "tok")).toBeNull();
  });

  it("maps errors to message keys", () => {
    expect(scoutErrorMessageKey({ type: "quota" })).toBe("research.scoutErrQuota");
    expect(scoutErrorMessageKey({ type: "auth" })).toBe("research.scoutErrAuth");
    expect(scoutErrorMessageKey({ type: "network" })).toBe("research.scoutErrNetwork");
    expect(scoutErrorMessageKey({ type: "upstream" })).toBe("research.scoutErrUpstream");
    expect(scoutErrorMessageKey({ type: "unconfigured" })).toBe("research.scoutNotConfigured");
  });
});

describe("scoutSearch", () => {
  it("is unconfigured without a config and never fetches", async () => {
    const fetchImpl = vi.fn();
    const r = await scoutSearch(null, { q: "x", platforms: ["tt"] }, { fetchImpl, storage });
    expect(r).toEqual({ ok: false, error: { type: "unconfigured" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs to /search with the Bearer token and returns parsed results", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ results: [...RESULTS, { platform: "fb", url: "x" }], credits: { used: 1 } }),
    );
    const r = await scoutSearch(
      CONFIG,
      { q: " match cut ", platforms: ["tt", "ig"], lang: "en", max: 10 },
      { fetchImpl, storage, now },
    );
    expect(r).toEqual({ ok: true, results: RESULTS, cached: false });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://scout.test/search");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toEqual({
      q: "match cut",
      platforms: ["tt", "ig"],
      lang: "en",
      max: 10,
    });
  });

  it("sends timeRange and thumbs, and keys the cache on them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: RESULTS }));
    const base = { q: "match cut", platforms: ["tt"] as const, lang: "ar" as const };
    await scoutSearch(
      CONFIG,
      { ...base, timeRange: "week", thumbs: true },
      { fetchImpl, storage, now },
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      q: "match cut",
      platforms: ["tt"],
      lang: "ar",
      timeRange: "week",
      thumbs: true,
    });
    // Another range, or no thumbnails, is another search (and another credit)...
    await scoutSearch(CONFIG, { ...base, timeRange: "month" }, { fetchImpl, storage, now });
    await scoutSearch(
      CONFIG,
      { ...base, timeRange: "week", thumbs: false },
      { fetchImpl, storage, now },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // ...while the same range again is served from the cache; thumbs undefined means the default (true).
    const again = await scoutSearch(
      CONFIG,
      { ...base, timeRange: "week" },
      { fetchImpl, storage, now },
    );
    expect(again.ok && again.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(getScoutUsage({ storage, now })).toBe(3);
    expect(scoutCacheKey({ ...base, timeRange: "week" })).not.toBe(scoutCacheKey(base));
  });

  it("peeks at the cache without fetching or counting", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: RESULTS }));
    const params = { q: "x", platforms: ["tt", "ig"] as const };
    expect(peekScoutSearch(CONFIG, params, { storage, now })).toBeUndefined();
    await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(peekScoutSearch(CONFIG, params, { storage, now })).toEqual(RESULTS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getScoutUsage({ storage, now })).toBe(1);
  });

  it("serves a repeated topic from the cache (memory, then storage) and counts only real calls", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: RESULTS }));
    const params = { q: "Match Cut", platforms: ["tt", "ig"] as const, lang: "en" as const };
    await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    const again = await scoutSearch(
      CONFIG,
      { ...params, q: "match   cut", platforms: ["ig", "tt"] },
      { fetchImpl, storage, now },
    );
    expect(again).toEqual({ ok: true, results: RESULTS, cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getScoutUsage({ storage, now })).toBe(1);

    // A "reload": memory gone, localStorage still has it.
    clearScoutCache(null);
    const afterReload = await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(afterReload.ok && afterReload.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data.get(SCOUT_CACHE_KEY)!)).toHaveProperty([
      scoutStorageKey(CONFIG, params),
    ]);
  });

  it("expires cache entries after 24 h", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: RESULTS }));
    const params = { q: "x", platforms: ["tt"] as const };
    await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    t += SCOUT_CACHE_TTL_MS + 1;
    const r = await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(r.ok && r.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps an empty answer for 10 minutes only", async () => {
    const replies = [[], RESULTS];
    const fetchImpl = vi.fn(async () => jsonResponse({ results: replies.shift() }));
    const params = { q: "rare topic", platforms: ["ig"] as const };
    await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    // Within the window: served from the cache, no second credit.
    t += SCOUT_CACHE_EMPTY_TTL_MS - 1;
    const soon = await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(soon).toEqual({ ok: true, results: [], cached: true });
    expect(peekScoutSearch(CONFIG, params, { storage, now })).toEqual([]);
    // After it: asked again (also after a reload), and the non-empty answer replaces it.
    t += 2;
    expect(peekScoutSearch(CONFIG, params, { storage, now })).toBeUndefined();
    clearScoutCache(null);
    const later = await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(later).toEqual({ ok: true, results: RESULTS, cached: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("force skips the cache read, then caches the fresh answer", async () => {
    const replies = [RESULTS.slice(0, 1), RESULTS];
    const fetchImpl = vi.fn(async () => jsonResponse({ results: replies.shift() }));
    const params = { q: "x", platforms: ["tt", "ig"] as const };
    await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    const forced = await scoutSearch(CONFIG, params, { fetchImpl, storage, now, force: true });
    expect(forced).toEqual({ ok: true, results: RESULTS, cached: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getScoutUsage({ storage, now })).toBe(2);
    const after = await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(after).toEqual({ ok: true, results: RESULTS, cached: true });
  });

  it("keys the cache on the Worker URL and the cache version", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: RESULTS }));
    const params = { q: "x", platforms: ["ig"] as const };
    const other = { url: "https://other-scout.test", token: "tok" };
    await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(peekScoutSearch(other, params, { storage, now })).toBeUndefined();
    expect(peekScoutSearch(null, params, { storage, now })).toBeUndefined();
    const r = await scoutSearch(other, params, { fetchImpl, storage, now });
    expect(r.ok && r.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(scoutStorageKey(CONFIG, params)).toBe(`v2|https://scout.test|${scoutCacheKey(params)}`);
  });

  it("never serves or keeps entries cached by the old (unversioned) client", async () => {
    const params = { q: "x", platforms: ["ig"] as const };
    const stale = [{ ...RESULTS[1], title: "Instagram" }];
    storage.data.set(
      SCOUT_CACHE_KEY,
      JSON.stringify({ [scoutCacheKey(params)]: { at: t, results: stale } }),
    );
    expect(peekScoutSearch(CONFIG, params, { storage, now })).toBeUndefined();
    const fetchImpl = vi.fn(async () => jsonResponse({ results: RESULTS.slice(1) }));
    const r = await scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    expect(r).toEqual({ ok: true, results: RESULTS.slice(1), cached: false });
    const stored = JSON.parse(storage.data.get(SCOUT_CACHE_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual([scoutStorageKey(CONFIG, params)]);
  });

  it("keeps at most 50 topics in storage, dropping the oldest", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    for (let i = 0; i < SCOUT_CACHE_MAX + 5; i++) {
      t += 1000;
      await scoutSearch(
        CONFIG,
        { q: `topic ${i}`, platforms: ["tt"] },
        { fetchImpl, storage, now },
      );
    }
    const stored = JSON.parse(storage.data.get(SCOUT_CACHE_KEY)!) as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(SCOUT_CACHE_MAX);
    expect(stored).not.toHaveProperty([
      scoutStorageKey(CONFIG, { q: "topic 0", platforms: ["tt"] }),
    ]);
    expect(stored).toHaveProperty([scoutStorageKey(CONFIG, { q: "topic 54", platforms: ["tt"] })]);
  });

  it("shares one request between concurrent identical searches", async () => {
    let resolve!: (r: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    const params = { q: "x", platforms: ["tt", "ig", "yt"] as const };
    const a = scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    const b = scoutSearch(CONFIG, params, { fetchImpl, storage, now });
    await Promise.resolve();
    resolve(jsonResponse({ results: RESULTS }));
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(getScoutUsage({ storage, now })).toBe(1);
  });

  it.each([
    [429, { error: "quota" }, "quota"],
    [401, { error: "unauthorized" }, "auth"],
    [502, { error: "auth" }, "auth"],
    [502, { error: "upstream" }, "upstream"],
    [500, "oops", "upstream"],
  ])("maps HTTP %i %j to %s and caches nothing", async (status, body, type) => {
    const fetchImpl = vi.fn(async () => jsonResponse(body, status));
    const r = await scoutSearch(CONFIG, { q: "x", platforms: ["tt"] }, { fetchImpl, storage, now });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.type).toBe(type);
    expect(storage.data.has(SCOUT_CACHE_KEY)).toBe(false);
    expect(getScoutUsage({ storage, now })).toBe(0);
  });

  it("maps a thrown fetch to network", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await scoutSearch(CONFIG, { q: "x", platforms: ["tt"] }, { fetchImpl, storage });
    expect(r).toEqual({ ok: false, error: { type: "network" } });
  });
});

describe("usage counter", () => {
  it("counts per month and notifies subscribers", async () => {
    const listener = vi.fn();
    const unsub = subscribeScoutUsage(listener);
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    await scoutSearch(CONFIG, { q: "a", platforms: ["tt"] }, { fetchImpl, storage, now });
    await scoutSearch(CONFIG, { q: "b", platforms: ["tt"] }, { fetchImpl, storage, now });
    expect(getScoutUsage({ storage, now })).toBe(2);
    expect(JSON.parse(storage.data.get(SCOUT_USAGE_KEY)!)).toEqual({ month: "2026-09", count: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();

    // Next month starts from zero.
    t = new Date(2026, 9, 1, 9).getTime();
    expect(getScoutUsage({ storage, now })).toBe(0);
    await scoutSearch(CONFIG, { q: "c", platforms: ["tt"] }, { fetchImpl, storage, now });
    expect(JSON.parse(storage.data.get(SCOUT_USAGE_KEY)!)).toEqual({ month: "2026-10", count: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("formats month keys as YYYY-MM", () => {
    expect(monthKey(new Date(2026, 0, 5).getTime())).toBe("2026-01");
  });
});

describe("scoutOembed", () => {
  it("GETs /oembed with the encoded URL and normalizes the reply", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        title: " Match cut ",
        author: "@editor.sam",
        thumb: "https://cdn.example/t.jpg",
        url: "https://www.tiktok.com/@editor.sam/video/1",
      }),
    );
    const video = "https://www.tiktok.com/@editor.sam/video/1?x=1";
    const r = await scoutOembed(CONFIG, video, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://scout.test/oembed?url=${encodeURIComponent(video)}`,
    );
    expect(r).toEqual({
      ok: true,
      data: {
        title: "Match cut",
        author: "@editor.sam",
        thumb: "https://cdn.example/t.jpg",
        url: "https://www.tiktok.com/@editor.sam/video/1",
      },
    });
  });

  it("drops a non-http thumbnail and reports errors", async () => {
    const bad = vi.fn(async () => jsonResponse({ title: "T", thumb: "javascript:x" }));
    const r = await scoutOembed(CONFIG, "https://youtu.be/x", { fetchImpl: bad });
    expect(r.ok && r.data.thumb).toBe("");
    const denied = vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401));
    expect(await scoutOembed(CONFIG, "https://youtu.be/x", { fetchImpl: denied })).toEqual({
      ok: false,
      error: { type: "auth", status: 401 },
    });
    expect(await scoutOembed(null, "https://youtu.be/x")).toEqual({
      ok: false,
      error: { type: "unconfigured" },
    });
  });
});

describe("scoutHealth", () => {
  it("is ok with a token-confirmed reply and reports the Tavily key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ok: true, auth: true, tavily: false }),
    );
    expect(await scoutHealth(CONFIG, { fetchImpl })).toEqual({ ok: true, tavily: false });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/health");
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("treats a wrong token (401) or an unauthenticated reply as auth", async () => {
    const wrong = vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401));
    expect(await scoutHealth(CONFIG, { fetchImpl: wrong })).toMatchObject({
      ok: false,
      error: { type: "auth" },
    });
    const bare = vi.fn(async () => jsonResponse({ ok: true }));
    expect(await scoutHealth(CONFIG, { fetchImpl: bare })).toEqual({
      ok: false,
      error: { type: "auth" },
    });
  });
});
