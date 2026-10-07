import { describe, expect, it, vi } from "vitest";
import {
  enrichThumbs,
  enrichYoutubeStats,
  handle,
  oembedEndpoint,
  safeEqual,
  TAVILY_URL,
  THUMB_ENRICH_MAX,
  YT_STATS_MAX,
  type Env,
} from "./scout";
import type { ScoutResult } from "./normalize";
import { instagramShortcodeAt, tiktokIdAt } from "./postDate";

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

    const social = {
      configured: { instagram: false, threads: false, youtube: false, tiktok: false },
      kv: false,
    };
    const trends = { youtube: false, sources: ["google", "youtube", "tavily", "events"] };
    const authed = await handle(req("/health"), ENV);
    expect(await authed.json()).toEqual({
      ok: true,
      auth: true,
      tavily: true,
      social,
      trends,
      discover: true,
      discoverSubscriptions: true,
    });

    const noKey = await handle(req("/health"), { ...ENV, TAVILY_API_KEY: undefined });
    expect(await noKey.json()).toEqual({
      ok: true,
      auth: true,
      tavily: false,
      social,
      trends,
      discover: true,
      discoverSubscriptions: true,
    });

    const wrong = await handle(req("/health", { token: "wrong" }), ENV);
    expect(wrong.status).toBe(401);
  });

  it("DISCOVER_V2 'off' sends dashboards back to /search; the /discover routes stay served", async () => {
    const discover = async (DISCOVER_V2?: string) => {
      const res = await handle(req("/health"), { ...ENV, DISCOVER_V2 });
      return ((await res.json()) as { discover?: boolean }).discover;
    };
    expect(await discover("off")).toBe(false);
    expect(await discover(undefined)).toBe(true);
    expect(await discover("on")).toBe(true);
    // The connector runs the same pipeline, so the routes answer either way.
    const picks = await handle(req("/discover/picks"), { ...ENV, DISCOVER_V2: "off" });
    expect(picks.status).toBe(200);
    expect(await picks.json()).toEqual({ picks: [] });
  });

  it("unknown routes are 404 (after auth)", async () => {
    expect((await handle(req("/nope"), ENV)).status).toBe(404);
    expect((await handle(req("/nope", { token: null }), ENV)).status).toBe(401);
  });
});

describe("creator route authentication", () => {
  const input = {
    brief: "Demonstrate a window-light coffee shot.",
    title: "Window light",
    platform: "tiktok",
    language: "en",
    tone: "educational",
    durationSeconds: 30,
    script: { hook: "", beats: ["", "", ""], cta: "" },
  };
  const draft = {
    hook: "Try this window-light setup.",
    beats: ["Position the cup.", "Turn toward the window.", "Show the result."],
    cta: "Try a different angle.",
    caption: "A coffee shot using window light.",
    hashtags: ["#coffee"],
    shots: [
      { type: "hook", text: "Finished cup shot" },
      { type: "wide", text: "Window and table" },
      { type: "closeup", text: "Cup details" },
    ],
  };
  const creatorEnv = () => {
    const values = new Map<string, string>();
    const get = vi.fn(async (key: string) => values.get(key) ?? null);
    const put = vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    });
    const run = vi.fn(async () => ({ response: draft }));
    const env: Env = { ...ENV, AI: { run }, SOCIAL_KV: { get, put } as unknown as KVNamespace };
    return { env, run, get, put };
  };
  const creatorReq = (token: string | null, origin = APP) =>
    req("/creator/draft", {
      method: "POST",
      token,
      origin,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

  it.each([null, "wrong-owner-token"])(
    "rejects owner token %s before AI or quota storage",
    async (token) => {
      const { env, run, get, put } = creatorEnv();
      const response = await handle(creatorReq(token), env);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(run).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    },
  );

  it("routes an authenticated request through creator validation, inference and no-store JSON", async () => {
    const { env, run, put } = creatorEnv();
    const response = await handle(creatorReq(TOKEN), env, undefined, {
      now: () => new Date("2026-10-04T10:00:00Z"),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draft });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(run).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("creator:budget:2026-10-04", "1", expect.any(Object));
  });

  it("rejects an untrusted browser origin even with the correct owner token", async () => {
    const { env, run, get } = creatorEnv();
    const response = await handle(creatorReq(TOKEN, "https://untrusted.example"), env);
    expect(response.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
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
      // Instagram post without an account in the path or the text → no handle (never the hostname).
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

  it("sends the Tavily request with domain filters, capped max, the language and the key", async () => {
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
      language: "en",
    });
  });

  it("defaults max_results to 10 and sends no language when none was asked", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));
    await handle(searchReq({ q: "x", platforms: ["yt"] }), ENV, undefined, { fetch: fetchMock });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.max_results).toBe(10);
    expect("language" in sent).toBe(false);
  });

  it("forwards an Arabic lang as Tavily's language", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));
    await handle(searchReq({ q: "مونتاج", platforms: ["tt"], lang: "ar" }), ENV, undefined, {
      fetch: fetchMock,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).language).toBe("ar");
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
        // TikTok and Instagram posts are dated by their own id (postDate.ts).
        published: "2023-11-11T00:48:18.000Z",
      },
      {
        platform: "ig",
        handle: "@cutsbyfaisal",
        title: "Reel by cutsbyfaisal",
        snippet: "Match cut reel",
        url: "https://www.instagram.com/p/C1abcDEF",
        published: "2011-08-24T21:31:47.855Z",
      },
      {
        platform: "ig",
        handle: "",
        title: "Post",
        snippet: "A post",
        url: "https://www.instagram.com/p/XyZ123",
        published: "2011-08-24T21:07:04.765Z",
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
        url: "https://www.youtube.com/watch?v=sh0rt1d",
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

  it("normalizes TikTok oEmbed, prefers the @handle, and caches it for 6 hours", async () => {
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
    expect(cached.headers.get("Cache-Control")).toBe("public, max-age=21600");

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

  // The Posted filter by real dates, as Discover's (2026-10-07: Tavily's Instagram "week" held posts from 2023).
  it("asks Tavily a wider window for TikTok and Instagram (week → month); with YouTube, the asked one", async () => {
    const sent = async (platforms: string[], timeRange?: string) => {
      const fetchMock = fakeFetch(() => jsonResponse({ results: [] }));
      await handle(searchReq({ q: "x", platforms, timeRange }), ENV, undefined, {
        fetch: fetchMock,
      });
      return JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    };
    expect((await sent(["ig"], "week")).time_range).toBe("month");
    expect((await sent(["tt"], "week")).time_range).toBe("month");
    expect((await sent(["tt", "ig"], "month")).time_range).toBe("month");
    expect((await sent(["ig"], "year")).time_range).toBe("year");
    // A YouTube card here has no date to check: Tavily's own window stays.
    expect((await sent(["yt"], "week")).time_range).toBe("week");
    expect((await sent(["tt", "ig", "yt"], "week")).time_range).toBe("week");
    expect(await sent(["tt"])).not.toHaveProperty("time_range");
  });

  it("a week search keeps the TikTok / Instagram posts their own ids date within 7 days; an undated one stays", async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    const igOld = `https://www.instagram.com/p/${instagramShortcodeAt(ago(10))}`;
    const igFresh = `https://www.instagram.com/p/${instagramShortcodeAt(ago(3))}`;
    // Its shortcode decodes past tomorrow: no date, so nothing says it is old.
    const igUndated = "https://www.instagram.com/p/zzzzzzzzzzz";
    const ttOld = `https://www.tiktok.com/@cuts/video/${tiktokIdAt(ago(10))}`;
    const ttFresh = `https://www.tiktok.com/@cuts/video/${tiktokIdAt(ago(3))}`;
    const fetchMock = fakeFetch(() =>
      jsonResponse({
        results: [igOld, igFresh, igUndated, ttOld, ttFresh].map((url, i) => ({
          title: `post ${i}`,
          url,
          content: "",
        })),
      }),
    );
    const res = await handle(
      searchReq({ q: "x", platforms: ["tt", "ig"], timeRange: "week", thumbs: false }),
      ENV,
      undefined,
      { fetch: fetchMock },
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).time_range).toBe("month");
    const body = (await res.json()) as { results: ScoutResult[] };
    expect(body.results.map((r) => r.url)).toEqual([igFresh, igUndated, ttFresh]);
    expect(body.results.find((r) => r.url === igUndated)).not.toHaveProperty("published");
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

  it("a 'TikTok - Make Your Day' hit ends with the oEmbed caption as its title", async () => {
    const video = "https://www.tiktok.com/@filmbro/video/7412345678901234569";
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === TAVILY_URL) {
        return jsonResponse({
          results: [{ title: "TikTok - Make Your Day", url: video, content: "" }],
        });
      }
      return jsonResponse({
        title: "Match cut with a door #matchcut",
        thumbnail_url: "https://p16.tiktokcdn.com/door.jpg",
      });
    });
    const res = await handle(searchReq({ q: "x", platforms: ["tt"] }), ENV, undefined, {
      fetch: fetchMock,
      cache: null,
    });
    const body = (await res.json()) as { results: ScoutResult[] };
    expect(body.results).toEqual([
      {
        platform: "tt",
        handle: "@filmbro",
        title: "Match cut with a door #matchcut",
        snippet: "",
        url: video,
        thumb: "https://p16.tiktokcdn.com/door.jpg",
        published: "2024-09-08T18:46:55.000Z",
      },
    ]);
  });

  it("caches YouTube oEmbed for a day and TikTok oEmbed for 6 hours", async () => {
    const cache = fakeCache();
    const fetchMock = fakeFetch(() =>
      jsonResponse({ title: "T", thumbnail_url: "https://x/y.jpg" }),
    );
    for (const video of [
      "https://www.youtube.com/watch?v=abc",
      "https://www.tiktok.com/@a/video/1",
    ]) {
      await handle(req(`/oembed?url=${encodeURIComponent(video)}`), ENV, undefined, {
        fetch: fetchMock,
        cache,
      });
    }
    const ttl = [...cache.store.entries()].map(([k, v]) => [
      new URL(k).hostname,
      v.headers.get("Cache-Control"),
    ]);
    expect(ttl).toEqual([
      ["www.youtube.com", "public, max-age=86400"],
      ["www.tiktok.com", "public, max-age=21600"],
    ]);
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

  it("replaces a generic TikTok title with the oEmbed caption it already fetched", async () => {
    const results: ScoutResult[] = [
      {
        platform: "tt",
        handle: "@filmbro",
        title: "@filmbro",
        snippet: "",
        url: "https://www.tiktok.com/@filmbro/video/7412345678901234569",
      },
      {
        platform: "tt",
        handle: "@noor.edits",
        title: "match cut but make it smooth #transition",
        snippet: "",
        url: "https://www.tiktok.com/@noor.edits/video/7412345678901234570",
      },
    ];
    await enrichThumbs(
      results,
      vi.fn<typeof fetch>(async () =>
        jsonResponse({
          title: "Door match cut 🚪 #matchcut  | TikTok",
          thumbnail_url: "https://p16.tiktokcdn.com/t.jpg",
        }),
      ),
      null,
      undefined,
      1000,
    );
    expect(results[0].title).toBe("Door match cut 🚪 #matchcut");
    // A real title is kept.
    expect(results[1].title).toBe("match cut but make it smooth #transition");
  });

  it("keeps the card title when the oEmbed title is generic or missing", async () => {
    const card = (): ScoutResult => ({
      platform: "tt",
      handle: "@a",
      title: "@a",
      snippet: "",
      url: "https://www.tiktok.com/@a/video/1",
    });
    const generic = [card()];
    await enrichThumbs(
      generic,
      vi.fn<typeof fetch>(async () => jsonResponse({ title: "TikTok - Make Your Day" })),
      null,
      undefined,
      1000,
    );
    expect(generic[0].title).toBe("@a");
    const none = [card()];
    await enrichThumbs(
      none,
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ thumbnail_url: "https://p16.tiktokcdn.com/t.jpg" }),
      ),
      null,
      undefined,
      1000,
    );
    expect(none[0]).toMatchObject({ title: "@a", thumb: "https://p16.tiktokcdn.com/t.jpg" });
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

describe("enrichYoutubeStats", () => {
  const KEY_ENV = { YOUTUBE_API_KEY: "yt-key" };
  const yt = (id: string): ScoutResult => ({
    platform: "yt",
    handle: "youtube.com",
    title: id,
    snippet: "",
    url: `https://www.youtube.com/watch?v=${id}`,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  });
  const tt = (): ScoutResult => ({
    platform: "tt",
    handle: "@a",
    title: "t",
    snippet: "",
    url: "https://www.tiktok.com/@a/video/1",
    stats: { likes: 5 },
  });

  it("asks videos.list once for every YouTube card and fills views, likes and comments", async () => {
    const results = [yt("aaa"), tt(), yt("bbb"), yt("ccc"), yt("ddd")];
    const fetchMock = fakeFetch(() =>
      jsonResponse({
        items: [
          {
            id: "bbb",
            statistics: { viewCount: "1200000", likeCount: "45000", commentCount: "310" },
          },
          // Hidden likes, no views yet.
          { id: "aaa", statistics: { viewCount: "0", commentCount: 7 } },
          // Nothing to show: the card gets no `stats` at all.
          { id: "ccc", statistics: {} },
          // Not a count.
          { id: "ddd", statistics: { viewCount: "-5", likeCount: "12.5", commentCount: "abc" } },
          // Not one of ours.
          { id: "zzz", statistics: { viewCount: "9" } },
          { statistics: { viewCount: "9" } },
        ],
      }),
    );
    await enrichYoutubeStats(results, KEY_ENV, fetchMock, 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://www.googleapis.com/youtube/v3/videos");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: "statistics",
      id: "aaa,bbb,ccc,ddd",
      key: "yt-key",
    });
    expect(results.map((r) => r.stats)).toEqual([
      { views: 0, comments: 7 },
      { likes: 5 },
      { views: 1_200_000, likes: 45_000, comments: 310 },
      undefined,
      undefined,
    ]);
    expect(results.filter((r) => "stats" in r)).toHaveLength(3);
  });

  it("makes no call without the key or without a YouTube card", async () => {
    const fetchMock = fakeFetch(() => jsonResponse({ items: [] }));
    const results = [yt("aaa")];
    await enrichYoutubeStats(results, {}, fetchMock, 1000);
    await enrichYoutubeStats(results, { YOUTUBE_API_KEY: "" }, fetchMock, 1000);
    await enrichYoutubeStats([tt()], KEY_ENV, fetchMock, 1000);
    await enrichYoutubeStats([], KEY_ENV, fetchMock, 1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toEqual([yt("aaa")]);
  });

  it(`asks about at most ${YT_STATS_MAX} videos`, async () => {
    const results = Array.from({ length: YT_STATS_MAX + 5 }, (_, i) => yt(`v${i}`));
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const ids = new URL(String(input)).searchParams.get("id")!.split(",");
      return jsonResponse({ items: ids.map((id) => ({ id, statistics: { viewCount: "10" } })) });
    });
    await enrichYoutubeStats(results, KEY_ENV, fetchMock, 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.slice(0, YT_STATS_MAX).every((r) => r.stats?.views === 10)).toBe(true);
    expect(results.slice(YT_STATS_MAX).every((r) => r.stats === undefined)).toBe(true);
  });

  it("leaves the cards as they were on an HTTP error, a broken body or a network failure", async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => jsonResponse({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403),
      async () => new Response("<html>not json</html>", { status: 200 }),
      async () => jsonResponse({ items: "nope" }),
      async () => jsonResponse(null),
      async () => {
        throw new TypeError("network down");
      },
    ];
    for (const answer of answers) {
      const results = [yt("aaa"), tt()];
      const fetchMock = vi.fn<typeof fetch>(answer);
      await expect(enrichYoutubeStats(results, KEY_ENV, fetchMock, 1000)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(results).toEqual([yt("aaa"), tt()]);
    }
  });

  it("gives up after the timeout: the call is aborted, and one that ignores the abort is left behind", async () => {
    let aborted = false;
    const hung = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    );
    const results = [yt("aaa")];
    const started = Date.now();
    await enrichYoutubeStats(results, KEY_ENV, hung, 30);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(aborted).toBe(true);
    expect(results).toEqual([yt("aaa")]);

    const deaf = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    await enrichYoutubeStats(results, KEY_ENV, deaf, 20);
    expect(deaf).toHaveBeenCalledTimes(1);
    expect(results).toEqual([yt("aaa")]);

    // The body read is inside the limit too.
    const slowBody = vi.fn<typeof fetch>(
      async () =>
        ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as unknown as Response,
    );
    await enrichYoutubeStats(results, KEY_ENV, slowBody, 20);
    expect(results).toEqual([yt("aaa")]);
  });
});

describe("POST /search: stats", () => {
  const YT_ENV: Env = { ...ENV, YOUTUBE_API_KEY: "yt-key" };
  const HITS = {
    results: [
      {
        title: "Match cut in 10s | TikTok",
        url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001",
        content: "13.5K Likes, 120 Comments. TikTok video from Sam (@editor.sam)",
      },
      {
        title: "Instagram",
        url: "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF/",
        content: '1,234 likes, 56 comments - cutsbyfaisal on June 11, 2025: "Match cut"',
      },
      { title: "YT", url: "https://www.youtube.com/watch?v=abc123XYZ", content: "1M views" },
      { title: "Short", url: "https://youtube.com/shorts/sh0rt1d", content: "short" },
    ],
  };
  const YT_STATS = {
    items: [
      {
        id: "abc123XYZ",
        statistics: { viewCount: "98765", likeCount: "4321", commentCount: "12" },
      },
      { id: "sh0rt1d", statistics: { viewCount: "500" } },
    ],
  };

  /** Tavily answers HITS, TikTok oEmbed a thumbnail, `videos.list` what `stats` says; the order is kept. */
  function routedFetch(stats: (url: URL, init?: RequestInit) => Promise<Response>) {
    const order: string[] = [];
    const fn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === TAVILY_URL) {
        order.push("tavily");
        return jsonResponse(HITS);
      }
      if (url.startsWith("https://www.tiktok.com/oembed?url=")) {
        order.push("oembed");
        return jsonResponse({ title: "t", thumbnail_url: "https://p16.tiktokcdn.com/1.jpg" });
      }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?")) {
        order.push("stats");
        return stats(new URL(url), init);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    return Object.assign(fn, { order });
  }

  type Body = { results: ScoutResult[]; credits: { used: number } };
  const stat = (body: Body) => body.results.map((r) => [r.platform, r.stats]);

  it("TikTok and Instagram from the page text, YouTube from one videos.list after the thumbnails", async () => {
    const fetchMock = routedFetch(async (url) => {
      expect(Object.fromEntries(url.searchParams)).toEqual({
        part: "statistics",
        id: "abc123XYZ,sh0rt1d",
        key: "yt-key",
      });
      return jsonResponse(YT_STATS);
    });
    const res = await handle(
      searchReq({ q: "match cut", platforms: ["tt", "ig", "yt"] }),
      YT_ENV,
      undefined,
      { fetch: fetchMock, cache: null },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(stat(body)).toEqual([
      ["tt", { likes: 13_500, comments: 120 }],
      ["ig", { likes: 1234, comments: 56 }],
      ["yt", { views: 98_765, likes: 4321, comments: 12 }],
      ["yt", { views: 500 }],
    ]);
    expect(fetchMock.order).toEqual(["tavily", "oembed", "stats"]);
    // The rest of the reply is what it was.
    expect(body.credits).toEqual({ used: 1 });
    expect(body.results[0]).toMatchObject({ thumb: "https://p16.tiktokcdn.com/1.jpg" });
    expect(body.results[2]).toMatchObject({
      url: "https://www.youtube.com/watch?v=abc123XYZ",
      thumb: "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg",
    });
  });

  it("asks for the YouTube counts with thumbs: false too, and makes no call without the key", async () => {
    const bare = routedFetch(async () => jsonResponse(YT_STATS));
    const res = await handle(
      searchReq({ q: "x", platforms: ["tt", "ig", "yt"], thumbs: false }),
      YT_ENV,
      undefined,
      { fetch: bare, cache: null },
    );
    expect(bare.order).toEqual(["tavily", "stats"]);
    expect(stat((await res.json()) as Body)[2]).toEqual([
      "yt",
      { views: 98_765, likes: 4321, comments: 12 },
    ]);

    const noKey = routedFetch(async () => jsonResponse(YT_STATS));
    const plain = await handle(
      searchReq({ q: "x", platforms: ["tt", "ig", "yt"] }),
      ENV,
      undefined,
      { fetch: noKey, cache: null },
    );
    expect(noKey.order).toEqual(["tavily", "oembed"]);
    const body = (await plain.json()) as Body;
    expect(stat(body)).toEqual([
      ["tt", { likes: 13_500, comments: 120 }],
      ["ig", { likes: 1234, comments: 56 }],
      ["yt", undefined],
      ["yt", undefined],
    ]);
    expect(body.results.filter((r) => "stats" in r)).toHaveLength(2);

    // Only YouTube cards need the call.
    const ttOnly = routedFetch(async () => jsonResponse(YT_STATS));
    await handle(searchReq({ q: "x", platforms: ["tt"] }), YT_ENV, undefined, {
      fetch: ttOnly,
      cache: null,
    });
    expect(ttOnly.order).toEqual(["tavily", "oembed"]);
  });

  it("never fails the search over the statistics call (quota, timeout)", async () => {
    const quota = routedFetch(async () =>
      jsonResponse({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403),
    );
    const res = await handle(searchReq({ q: "x", platforms: ["yt"] }), YT_ENV, undefined, {
      fetch: quota,
      cache: null,
    });
    expect(res.status).toBe(200);
    expect(stat((await res.json()) as Body)).toEqual([
      ["yt", undefined],
      ["yt", undefined],
    ]);

    const hung = routedFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const started = Date.now();
    const slow = await handle(searchReq({ q: "x", platforms: ["yt"] }), YT_ENV, undefined, {
      fetch: hung,
      cache: null,
      oembedTimeoutMs: 30,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(slow.status).toBe(200);
    expect(((await slow.json()) as Body).results.map((r) => r.url)).toEqual([
      "https://www.youtube.com/watch?v=abc123XYZ",
      "https://www.youtube.com/watch?v=sh0rt1d",
    ]);
  });
});
