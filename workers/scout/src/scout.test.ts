import { describe, expect, it, vi } from "vitest";
import {
  enrichThumbs,
  handle,
  oembedEndpoint,
  safeEqual,
  TAVILY_URL,
  THUMB_ENRICH_MAX,
  type Env,
} from "./scout";
import type { ScoutResult } from "./normalize";

const TOKEN = "s3cret-token";
const ENV: Env = {
  TAVILY_API_KEY: "tvly-test",
  SCOUT_TOKEN: TOKEN,
  ALLOWED_ORIGINS: "http://localhost:3000,https://3zmd95-glitch.github.io",
};
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";

function req(
  path: string,
  init: RequestInit & { token?: string | null; origin?: string | null } = {},
): Request {
  const { token = TOKEN, origin = APP, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (origin !== null) headers.set("Origin", origin);
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

function searchReq(body: unknown, token: string | null = TOKEN): Request {
  return req("/search", {
    method: "POST",
    token,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A mocked fetch that answers every call with `res` and records the calls. */
function fakeFetch(res: () => Response) {
  return vi.fn<typeof fetch>(async () => res());
}

/** An in-memory stand-in for `caches.default`. */
function fakeCache(): Cache & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    async match(key: RequestInfo | URL) {
      const url = key instanceof Request ? key.url : String(key);
      return store.get(url)?.clone();
    },
    async put(key: RequestInfo | URL, res: Response) {
      const url = key instanceof Request ? key.url : String(key);
      store.set(url, res.clone());
    },
    async delete() {
      return false;
    },
  } as unknown as Cache & { store: Map<string, Response> };
}

describe("safeEqual", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("auth", () => {
  const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));

  it("rejects /search without a token", async () => {
    const res = await handle(searchReq({ q: "x", platforms: ["tt"] }, null), ENV, undefined, {
      fetch: fetchMock,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects /search with a wrong token", async () => {
    const res = await handle(searchReq({ q: "x", platforms: ["tt"] }, "nope"), ENV, undefined, {
      fetch: fetchMock,
    });
    expect(res.status).toBe(401);
  });

  it("rejects everything when the Worker has no SCOUT_TOKEN configured", async () => {
    const res = await handle(
      searchReq({ q: "x", platforms: ["tt"] }),
      { ...ENV, SCOUT_TOKEN: undefined },
      undefined,
      { fetch: fetchMock },
    );
    expect(res.status).toBe(401);
  });

  it("rejects /oembed without a token", async () => {
    const res = await handle(
      req("/oembed?url=https://www.tiktok.com/@a/video/1", { token: null }),
      ENV,
    );
    expect(res.status).toBe(401);
  });

  it("GET /health is open, and reports Tavily only with a valid token", async () => {
    const open = await handle(req("/health", { token: null }), ENV);
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ ok: true });

    const authed = await handle(req("/health"), ENV);
    expect(await authed.json()).toEqual({ ok: true, auth: true, tavily: true });

    const noKey = await handle(req("/health"), { ...ENV, TAVILY_API_KEY: undefined });
    expect(await noKey.json()).toEqual({ ok: true, auth: true, tavily: false });

    const wrong = await handle(req("/health", { token: "wrong" }), ENV);
    expect(wrong.status).toBe(401);
  });

  it("unknown routes are 404 (after auth)", async () => {
    expect((await handle(req("/nope"), ENV)).status).toBe(404);
    expect((await handle(req("/nope", { token: null }), ENV)).status).toBe(401);
  });
});

describe("CORS", () => {
  it("answers a preflight from an allowed origin and reflects it", async () => {
    const res = await handle(req("/search", { method: "OPTIONS", token: null }), ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(res.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
    expect(res.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("refuses a preflight and requests from an unknown origin without reflecting it", async () => {
    const pre = await handle(
      req("/search", { method: "OPTIONS", token: null, origin: "https://evil.example" }),
      ENV,
    );
    expect(pre.status).toBe(403);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(pre.headers.get("Vary")).toBe("Origin");

    const get = await handle(req("/health", { origin: "https://evil.example" }), ENV);
    expect(get.status).toBe(403);
    expect(get.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("uses the default origin list when ALLOWED_ORIGINS is unset", async () => {
    const res = await handle(req("/health", { origin: "http://localhost:3000" }), {
      ...ENV,
      ALLOWED_ORIGINS: undefined,
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("allows server-side calls with no Origin (curl), without CORS headers", async () => {
    const res = await handle(req("/health", { origin: null }), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("reflects the origin on error responses too", async () => {
    const res = await handle(req("/search", { method: "POST", token: "bad" }), ENV);
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });
});

describe("POST /search", () => {
  const TAVILY_HITS = {
    results: [
      {
        title: "Match cut transitions",
        url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001?lang=en",
        content: "How to  do a\nmatch cut in CapCut",
      },
      // Same video with another tracking query → deduped.
      {
        title: "dupe",
        url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001?is_from_webapp=1",
        content: "dupe",
      },
      // A TikTok profile / tag page → not a video → dropped.
      { title: "profile", url: "https://www.tiktok.com/@editor.sam", content: "" },
      { title: "tag", url: "https://www.tiktok.com/tag/matchcut", content: "" },
      // Instagram reel with the account in the path.
      {
        title: "Reel by cutsbyfaisal",
        url: "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF/",
        content: "Match cut reel",
      },
      // Instagram post without an account in the path → hostname as handle.
      { title: "Post", url: "https://www.instagram.com/p/XyZ123/", content: "A post" },
      // Instagram explore page → dropped.
      { title: "Explore", url: "https://www.instagram.com/explore/tags/matchcut/", content: "" },
      // YouTube watch + shorts, a channel page (dropped).
      {
        title: "Match cut tutorial - YouTube",
        url: "https://www.youtube.com/watch?v=abc123XYZ&t=10s",
        content: "yt",
      },
      { title: "Short", url: "https://youtube.com/shorts/sh0rt1d", content: "short" },
      { title: "Channel", url: "https://www.youtube.com/@someone", content: "" },
      // Not one of our platforms at all.
      { title: "Blog", url: "https://example.com/match-cut", content: "" },
    ],
    usage: { credits: 1 },
  };

  it("sends the Tavily request with domain filters, capped max and the key", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));
    const res = await handle(
      searchReq({ q: "match cut", platforms: ["tt", "ig"], lang: "en", max: 50 }),
      ENV,
      undefined,
      { fetch: fetchMock },
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TAVILY_URL);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tvly-test");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "match cut",
      include_domains: ["tiktok.com", "instagram.com"],
      max_results: 20,
      search_depth: "basic",
      include_images: true,
    });
  });

  it("defaults max_results to 10", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));
    await handle(searchReq({ q: "x", platforms: ["yt"] }), ENV, undefined, { fetch: fetchMock });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).max_results).toBe(10);
  });

  it("normalizes, filters non-video pages, and dedupes", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(TAVILY_HITS));
    const res = await handle(
      searchReq({ q: "match cut", platforms: ["tt", "ig", "yt"] }),
      ENV,
      undefined,
      { fetch: fetchMock },
    );
    const body = (await res.json()) as { results: unknown[]; credits: { used: number } };
    expect(body.credits).toEqual({ used: 1 });
    expect(body.results).toEqual([
      {
        platform: "tt",
        handle: "@editor.sam",
        title: "Match cut transitions",
        snippet: "How to do a match cut in CapCut",
        url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001",
      },
      {
        platform: "ig",
        handle: "@cutsbyfaisal",
        title: "Reel by cutsbyfaisal",
        snippet: "Match cut reel",
        url: "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF",
      },
      {
        platform: "ig",
        handle: "instagram.com",
        title: "Post",
        snippet: "A post",
        url: "https://www.instagram.com/p/XyZ123",
      },
      {
        platform: "yt",
        handle: "youtube.com",
        title: "Match cut tutorial - YouTube",
        snippet: "yt",
        url: "https://www.youtube.com/watch?v=abc123XYZ",
        thumb: "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg",
      },
      {
        platform: "yt",
        handle: "youtube.com",
        title: "Short",
        snippet: "short",
        url: "https://youtube.com/shorts/sh0rt1d",
        thumb: "https://i.ytimg.com/vi/sh0rt1d/hqdefault.jpg",
      },
    ]);
  });

  it("keeps only the requested platforms even if Tavily returns others", async () => {
    const fetchMock = fakeFetch(() => jsonResponse(TAVILY_HITS));
    const res = await handle(searchReq({ q: "x", platforms: ["ig"] }), ENV, undefined, {
      fetch: fetchMock,
    });
    const body = (await res.json()) as { results: { platform: string }[] };
    expect(body.results.map((r) => r.platform)).toEqual(["ig", "ig"]);
  });

  it.each([
    [{ platforms: ["tt"] }],
    [{ q: "", platforms: ["tt"] }],
    [{ q: "x", platforms: [] }],
    [{ q: "x", platforms: ["fb"] }],
    [{ q: "x", platforms: ["tt"], lang: "fr" }],
    [{ q: "x", platforms: ["tt"], max: 0 }],
    [{ q: "x", platforms: ["tt"], timeRange: "day" }],
    [{ q: "x", platforms: ["tt"], thumbs: "yes" }],
  ])("rejects a bad body %j with 400", async (body) => {
    const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));
    const res = await handle(searchReq(body), ENV, undefined, { fetch: fetchMock });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [432, 429, "quota"],
    [433, 429, "quota"],
    [429, 429, "quota"],
    [401, 502, "auth"],
    [500, 502, "upstream"],
  ])("maps Tavily %i to %i %s", async (upstream, status, error) => {
    const fetchMock = fakeFetch(() => jsonResponse({ detail: { error: "x" } }, upstream));
    const res = await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, {
      fetch: fetchMock,
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it("maps a network failure to upstream and a missing Tavily key to auth", async () => {
    const boom = vi.fn(async () => {
      throw new Error("offline");
    });
    const res = await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, {
      fetch: boom,
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream" });

    const noKey = await handle(
      searchReq({ q: "x", platforms: ["tt"] }),
      { ...ENV, TAVILY_API_KEY: undefined },
      undefined,
      { fetch: boom },
    );
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).toEqual({ error: "auth" });
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

describe("GET /oembed", () => {
  it("only proxies TikTok and YouTube", () => {
    expect(oembedEndpoint("https://www.tiktok.com/@a/video/1")).toBe(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent("https://www.tiktok.com/@a/video/1")}`,
    );
    expect(oembedEndpoint("https://vm.tiktok.com/ZMabc/")).toMatch(
      /^https:\/\/www\.tiktok\.com\/oembed/,
    );
    expect(oembedEndpoint("https://www.youtube.com/watch?v=x")).toMatch(
      /^https:\/\/www\.youtube\.com\/oembed\?url=.+&format=json$/,
    );
    expect(oembedEndpoint("https://youtu.be/x")).toMatch(/youtube\.com\/oembed/);
    expect(oembedEndpoint("https://www.instagram.com/reel/x/")).toBeNull();
    expect(oembedEndpoint("https://tiktok.com.evil.example/x")).toBeNull();
    expect(oembedEndpoint("https://eviltiktok.com/x")).toBeNull();
    expect(oembedEndpoint("javascript:alert(1)")).toBeNull();
    expect(oembedEndpoint("not a url")).toBeNull();
  });

  it("rejects a non-allowlisted URL with 400 without fetching", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({}));
    const res = await handle(
      req(`/oembed?url=${encodeURIComponent("https://example.com/x")}`),
      ENV,
      undefined,
      { fetch: fetchMock, cache: null },
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes TikTok oEmbed, prefers the @handle, and caches for a day", async () => {
    const video = "https://www.tiktok.com/@editor.sam/video/123";
    const fetchMock = fakeFetch(() =>
      jsonResponse({
        title: "Match cut in 10s",
        author_name: "Sam the Editor",
        author_url: "https://www.tiktok.com/@editor.sam",
        thumbnail_url: "https://p16.tiktokcdn.com/thumb.jpg",
      }),
    );
    const cache = fakeCache();
    const waitUntil = vi.fn();
    const ctx = { waitUntil, passThroughOnException() {} } as unknown as ExecutionContext;
    const path = `/oembed?url=${encodeURIComponent(video)}`;

    const first = await handle(req(path), ENV, ctx, { fetch: fetchMock, cache });
    expect(first.status).toBe(200);
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await first.json()).toEqual({
      title: "Match cut in 10s",
      author: "@editor.sam",
      thumb: "https://p16.tiktokcdn.com/thumb.jpg",
      url: video,
    });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    const cached = [...cache.store.values()][0];
    expect(cached.headers.get("Cache-Control")).toBe("public, max-age=86400");

    // Second call (another allowed origin) is served from the cache with that origin's CORS header.
    const second = await handle(req(path, { origin: "http://localhost:3000" }), ENV, ctx, {
      fetch: fetchMock,
      cache,
    });
    expect(second.status).toBe(200);
    expect(second.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(((await second.json()) as { title: string }).title).toBe("Match cut in 10s");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the YouTube author name and maps a 404 to not_found", async () => {
    const yt = fakeFetch(() =>
      jsonResponse({
        title: "T",
        author_name: "Channel",
        thumbnail_url: "https://i.ytimg.com/x.jpg",
      }),
    );
    const ok = await handle(
      req(`/oembed?url=${encodeURIComponent("https://www.youtube.com/watch?v=abc")}`),
      ENV,
      undefined,
      { fetch: yt, cache: null },
    );
    expect(((await ok.json()) as { author: string }).author).toBe("Channel");
    expect(String(yt.mock.calls[0][0])).toMatch(/format=json/);

    const missing = await handle(
      req(`/oembed?url=${encodeURIComponent("https://www.tiktok.com/@a/video/9")}`),
      ENV,
      undefined,
      { fetch: fakeFetch(() => new Response("Not found", { status: 404 })), cache: null },
    );
    expect(missing.status).toBe(404);
  });
});

describe("POST /search: timeRange and thumbnails", () => {
  const TT1 = "https://www.tiktok.com/@editor.sam/video/7300000000000000001";
  const TT2 = "https://www.tiktok.com/@cuts/video/7300000000000000002";
  const HITS = {
    results: [
      { title: "TT one", url: TT1, content: "a" },
      { title: "TT two", url: TT2, content: "b" },
      { title: "Reel", url: "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF/", content: "c" },
      { title: "YT", url: "https://www.youtube.com/watch?v=abc123XYZ", content: "d" },
    ],
  };

  /** Tavily answers with HITS; TikTok oEmbed answers per video via `oembed(url)`. */
  function routedFetch(oembed: (videoUrl: string, init?: RequestInit) => Promise<Response>) {
    return vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === TAVILY_URL) return jsonResponse(HITS);
      if (url.startsWith("https://www.tiktok.com/oembed?url=")) {
        return oembed(decodeURIComponent(url.split("url=")[1]), init);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it("passes timeRange through to Tavily as time_range", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));
    await handle(searchReq({ q: "x", platforms: ["tt"], timeRange: "week" }), ENV, undefined, {
      fetch: fetchMock,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).time_range).toBe("week");

    const noRange = fakeFetch(() => jsonResponse({ results: [] }));
    await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, { fetch: noRange });
    expect(JSON.parse(String(noRange.mock.calls[0][1]?.body))).not.toHaveProperty("time_range");
  });

  it("enriches TikTok results with oEmbed thumbnails; YouTube from the id; Instagram stays bare", async () => {
    const fetchMock = routedFetch(async (video) =>
      jsonResponse({
        title: "t",
        thumbnail_url: `https://p16.tiktokcdn.com/${video.slice(-1)}.jpg`,
      }),
    );
    const res = await handle(
      searchReq({ q: "match cut", platforms: ["tt", "ig", "yt"] }),
      ENV,
      undefined,
      { fetch: fetchMock, cache: null },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: ScoutResult[]; credits: { used: number } };
    expect(body.credits).toEqual({ used: 1 });
    expect(body.results.map((r) => [r.platform, r.thumb])).toEqual([
      ["tt", "https://p16.tiktokcdn.com/1.jpg"],
      ["tt", "https://p16.tiktokcdn.com/2.jpg"],
      ["ig", undefined],
      ["yt", "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg"],
    ]);
    // 1 Tavily call + 2 oEmbed calls, all oEmbed calls carry an abort signal.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls.slice(1)) {
      expect(String(url)).toMatch(/^https:\/\/www\.tiktok\.com\/oembed\?url=/);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("skips enrichment entirely with thumbs: false", async () => {
    const fetchMock = routedFetch(async () => jsonResponse({ thumbnail_url: "https://x/y.jpg" }));
    const res = await handle(
      searchReq({ q: "x", platforms: ["tt"], thumbs: false }),
      ENV,
      undefined,
      { fetch: fetchMock, cache: null },
    );
    const body = (await res.json()) as { results: ScoutResult[] };
    expect(body.results.every((r) => r.thumb === undefined)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tolerates oEmbed failures and timeouts: the search still answers, those cards just have no thumb", async () => {
    const fetchMock = routedFetch((video, init) => {
      if (video === TT1) {
        // Never answers on its own; only the abort (timeout) ends it.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return Promise.resolve(new Response("nope", { status: 500 }));
    });
    const started = Date.now();
    const res = await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, {
      fetch: fetchMock,
      cache: null,
      oembedTimeoutMs: 30,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: ScoutResult[] };
    expect(body.results.map((r) => r.url)).toEqual([TT1, TT2]);
    expect(body.results.every((r) => r.thumb === undefined)).toBe(true);
  });

  it("gives up on an oEmbed call that ignores the abort signal", async () => {
    const fetchMock = routedFetch(() => new Promise<Response>(() => {}));
    const res = await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, {
      fetch: fetchMock,
      cache: null,
      oembedTimeoutMs: 20,
    });
    expect(res.status).toBe(200);
  });

  it("reuses the cached oEmbed path (a second search makes no new oEmbed call)", async () => {
    const fetchMock = routedFetch(async () =>
      jsonResponse({ thumbnail_url: "https://p16.tiktokcdn.com/c.jpg" }),
    );
    const cache = fakeCache();
    await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, {
      fetch: fetchMock,
      cache,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const again = await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, {
      fetch: fetchMock,
      cache,
    });
    const body = (await again.json()) as { results: ScoutResult[] };
    expect(body.results[0].thumb).toBe("https://p16.tiktokcdn.com/c.jpg");
    // Only Tavily again; both thumbnails came from the cache.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // The same cache also serves GET /oembed for that link.
    const oe = await handle(req(`/oembed?url=${encodeURIComponent(TT1)}`), ENV, undefined, {
      fetch: fetchMock,
      cache,
    });
    expect(((await oe.json()) as { thumb: string }).thumb).toBe("https://p16.tiktokcdn.com/c.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("enrichThumbs", () => {
  it(`enriches at most ${THUMB_ENRICH_MAX} TikTok results, in parallel`, async () => {
    const results: ScoutResult[] = Array.from({ length: THUMB_ENRICH_MAX + 3 }, (_, i) => ({
      platform: "tt",
      handle: "@a",
      title: `t${i}`,
      snippet: "",
      url: `https://www.tiktok.com/@a/video/${i}`,
    }));
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return jsonResponse({ thumbnail_url: "https://p16.tiktokcdn.com/t.jpg" });
    });
    await enrichThumbs(results, fetchMock, null, undefined, 1000);
    expect(fetchMock).toHaveBeenCalledTimes(THUMB_ENRICH_MAX);
    expect(peak).toBe(THUMB_ENRICH_MAX);
    expect(results.filter((r) => r.thumb)).toHaveLength(THUMB_ENRICH_MAX);
    expect(results.slice(THUMB_ENRICH_MAX).every((r) => r.thumb === undefined)).toBe(true);
  });

  it("ignores non-https thumbnails", async () => {
    const results: ScoutResult[] = [
      {
        platform: "tt",
        handle: "@a",
        title: "t",
        snippet: "",
        url: "https://www.tiktok.com/@a/video/1",
      },
    ];
    await enrichThumbs(
      results,
      vi.fn<typeof fetch>(async () => jsonResponse({ thumbnail_url: "javascript:alert(1)" })),
      null,
      undefined,
      1000,
    );
    expect(results[0].thumb).toBeUndefined();
  });
});
