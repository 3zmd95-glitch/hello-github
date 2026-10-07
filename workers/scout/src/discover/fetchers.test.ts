import { describe, expect, it, vi } from "vitest";
import { TAVILY_URL } from "../trends/tavily";
import { discoverKeys, reserveYoutube, tavilyCall, youtubeCall, youtubeCap } from "./fetchers";

const NOW = new Date("2026-10-03T09:00:00Z");

type Entry = { value: string; expirationTtl?: number };
function fakeKV() {
  const store = new Map<string, Entry>();
  const kv = {
    store,
    puts: 0,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      kv.puts += 1;
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    },
  };
  return kv as unknown as KVNamespace & { store: Map<string, Entry>; puts: number };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const answering = (status: number) => vi.fn<typeof fetch>(async () => json({}, status));
const failing = () =>
  vi.fn<typeof fetch>(async () => {
    throw new TypeError("down");
  });
/**
 * Never answers on its own: only the abort (the time limit) ends it, with a rejection as a real fetch's.
 * Vitest fails the run on an unhandled rejection, so these tests also show that rejection is handled.
 */
const hangingFetch = () =>
  vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );

describe("tavilyCall", () => {
  it("asks 20 results from one platform in the query's language, with dates and usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        results: [
          { url: "https://www.tiktok.com/@a/video/1", title: "flash edit", content: "x" },
          { url: "https://www.tiktok.com/@zen", title: "Zen (@zen) | TikTok", content: "editor" },
        ],
        usage: { credits: 1 },
      }),
    );
    const out = await tavilyCall({ TAVILY_API_KEY: "k" }, fetchMock, {
      q: "شرح فلاش",
      platform: "tt",
      lang: "ar",
      timeRange: "month",
    });
    // The post and the profile page, as normalizeDiscoverHits reads them for TikTok.
    expect(out).toEqual({
      ok: true,
      cards: [
        {
          platform: "tt",
          handle: "@a",
          title: "flash edit",
          snippet: "x",
          url: "https://www.tiktok.com/@a/video/1",
        },
      ],
      profiles: [{ platform: "tt", handle: "@zen", url: "https://www.tiktok.com/@zen" }],
      credits: 1,
    });
    const [input, init] = fetchMock.mock.calls[0];
    expect(input).toBe(TAVILY_URL);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer k");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      query: "شرح فلاش",
      include_domains: ["tiktok.com"],
      max_results: 20,
      search_depth: "basic",
      include_published_date: true,
      include_usage: true,
      language: "ar",
      country: "saudi arabia",
      time_range: "month",
    });
  });

  it("leaves country and time_range out of an English search with no time range", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ results: [] }));
    const out = await tavilyCall({ TAVILY_API_KEY: "k" }, fetchMock, {
      q: "flash transition",
      platform: "ig",
      lang: "en",
    });
    expect(out).toEqual({ ok: true, cards: [], profiles: [], credits: 1 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ include_domains: ["instagram.com"], language: "en" });
    expect(body).not.toHaveProperty("country");
    expect(body).not.toHaveProperty("time_range");
  });

  it("maps Tavily's errors", async () => {
    const call = { q: "x", platform: "ig" as const, lang: "en" as const };
    const env = { TAVILY_API_KEY: "k" };
    expect(await tavilyCall({}, vi.fn(), call)).toEqual({ ok: false, error: "not_configured" });
    for (const [status, error] of [
      [401, "auth"],
      [403, "auth"],
      [429, "quota"],
      [432, "quota"],
      [433, "quota"],
      [500, "upstream"],
    ] as const) {
      expect(await tavilyCall(env, answering(status), call), `HTTP ${status}`).toEqual({
        ok: false,
        error,
      });
    }
    expect(await tavilyCall(env, failing(), call)).toEqual({ ok: false, error: "upstream" });
  });

  it("lets go of a refused answer's unread body (a Worker keeps only 6 connections open)", async () => {
    const call = { q: "x", platform: "ig" as const, lang: "en" as const };
    for (const status of [401, 432, 500]) {
      let cancelled = false;
      const body = new ReadableStream({ cancel: () => void (cancelled = true) });
      const refused = vi.fn<typeof fetch>(async () => new Response(body, { status }));
      expect(await tavilyCall({ TAVILY_API_KEY: "k" }, refused, call)).toMatchObject({ ok: false });
      expect(cancelled).toBe(true);
    }
  });

  it("gives up after the time limit: the call is aborted, the answer is upstream", async () => {
    const fetchMock = hangingFetch();
    const call = { q: "x", platform: "tt" as const, lang: "en" as const };
    expect(await tavilyCall({ TAVILY_API_KEY: "k" }, fetchMock, call, 20)).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("searches several platforms in one call (category lessons, 1 credit): their post cards, no profiles", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        results: [
          { url: "https://www.youtube.com/watch?v=rollTut0001", title: "Rolling shot tutorial" },
          { url: "https://www.tiktok.com/@ed/video/1", title: "rolling shot" },
          { url: "https://www.tiktok.com/@ed", title: "ed on TikTok" },
        ],
        usage: { credits: 1 },
      }),
    );
    const out = await tavilyCall({ TAVILY_API_KEY: "k" }, fetchMock, {
      q: "car rolling shot tutorial",
      platform: ["yt", "ig", "tt"],
      lang: "en",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      include_domains: string[];
    };
    expect(body.include_domains).toEqual(["youtube.com", "instagram.com", "tiktok.com"]);
    expect(out).toMatchObject({ ok: true, credits: 1, profiles: [] });
    expect(out.ok && out.cards.map((c) => c.platform)).toEqual(["yt", "tt"]);
  });
});

describe("youtubeCall", () => {
  it("searches 20 videos in the query's language and region, cards with channel links", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        items: [
          {
            id: { videoId: "abc" },
            snippet: {
              title: "Flash &amp; glow transition",
              description: "tutorial",
              channelTitle: "Cinecom",
              channelId: "UC1",
              publishedAt: "2026-09-01T00:00:00Z",
              thumbnails: { medium: { url: "https://i.ytimg.com/vi/abc/mqdefault.jpg" } },
            },
          },
        ],
      }),
    );
    const out = await youtubeCall(
      { YOUTUBE_API_KEY: "y" },
      fetchMock,
      { q: "شرح فلاش", lang: "ar", timeRange: "week", ytLength: "short" },
      NOW,
    );
    expect(out).toEqual({
      ok: true,
      cards: [
        {
          platform: "yt",
          handle: "Cinecom",
          title: "Flash & glow transition",
          snippet: "tutorial",
          url: "https://www.youtube.com/watch?v=abc",
          thumb: "https://i.ytimg.com/vi/abc/mqdefault.jpg",
          published: "2026-09-01T00:00:00.000Z",
          profile: "https://www.youtube.com/channel/UC1",
        },
      ],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("maxResults")).toBe("20");
    expect(url.searchParams.get("relevanceLanguage")).toBe("ar");
    expect(url.searchParams.get("regionCode")).toBe("SA");
    expect(url.searchParams.get("videoDuration")).toBe("short");
    expect(url.searchParams.get("publishedAfter")).toBe("2026-09-26T09:00:00.000Z");
  });

  it("maps quota to daily_cap and other refusals to auth", async () => {
    const call = { q: "x", lang: "en" as const };
    expect(await youtubeCall({}, vi.fn(), call, NOW)).toEqual({
      ok: false,
      error: "not_configured",
    });
    const quota = json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
    expect(
      await youtubeCall(
        { YOUTUBE_API_KEY: "y" },
        vi.fn(async () => quota),
        call,
        NOW,
      ),
    ).toEqual({ ok: false, error: "daily_cap" });
    const bad = json({ error: { errors: [{ reason: "keyInvalid" }] } }, 400);
    expect(
      await youtubeCall(
        { YOUTUBE_API_KEY: "y" },
        vi.fn(async () => bad),
        call,
        NOW,
      ),
    ).toEqual({ ok: false, error: "auth" });
  });

  it("answers upstream on a server error or a failed fetch", async () => {
    const call = { q: "x", lang: "en" as const };
    const env = { YOUTUBE_API_KEY: "y" };
    expect(await youtubeCall(env, answering(500), call, NOW)).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(await youtubeCall(env, failing(), call, NOW)).toEqual({ ok: false, error: "upstream" });
  });

  it("answers upstream, never an empty success, when a 2xx reply is not JSON", async () => {
    const broken = vi.fn<typeof fetch>(
      async () => new Response("<html>oops</html>", { status: 200 }),
    );
    expect(
      await youtubeCall({ YOUTUBE_API_KEY: "y" }, broken, { q: "x", lang: "en" }, NOW),
    ).toEqual({ ok: false, error: "upstream" });
  });

  it("gives up after the time limit: the call is aborted, the answer is upstream", async () => {
    const fetchMock = hangingFetch();
    const call = { q: "x", lang: "en" as const };
    expect(await youtubeCall({ YOUTUBE_API_KEY: "y" }, fetchMock, call, NOW, 20)).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

describe("youtubeCap", () => {
  it("reads DISCOVER_YT_CAP: blank is unset (70), only a number ≥ 0 overrides, 0 turns YouTube off", () => {
    expect(youtubeCap({})).toBe(70);
    expect(youtubeCap({ DISCOVER_YT_CAP: "" })).toBe(70);
    expect(youtubeCap({ DISCOVER_YT_CAP: "   " })).toBe(70);
    expect(youtubeCap({ DISCOVER_YT_CAP: "abc" })).toBe(70);
    expect(youtubeCap({ DISCOVER_YT_CAP: "-1" })).toBe(70);
    expect(youtubeCap({ DISCOVER_YT_CAP: "0" })).toBe(0);
    expect(youtubeCap({ DISCOVER_YT_CAP: "40" })).toBe(40);
  });
});

describe("reserveYoutube", () => {
  it("grants calls up to the day's cap and counts them; a full day writes nothing", async () => {
    const kv = fakeKV();
    const env = { SOCIAL_KV: kv, DISCOVER_YT_CAP: "5" };
    expect(await reserveYoutube(env, 3, NOW)).toBe(3);
    expect(await reserveYoutube(env, 3, NOW)).toBe(2);
    expect(kv.puts).toBe(2);
    expect(await reserveYoutube(env, 3, NOW)).toBe(0);
    expect(kv.puts).toBe(2);
    expect(kv.store.get(discoverKeys.yt("2026-10-03"))).toEqual({
      value: "5",
      expirationTtl: 172_800,
    });
  });

  it("grants everything without KV (local dev) and uses 70 by default", async () => {
    expect(await reserveYoutube({}, 3, NOW)).toBe(3);
    const kv = fakeKV();
    await kv.put(discoverKeys.yt("2026-10-03"), "69");
    expect(await reserveYoutube({ SOCIAL_KV: kv }, 3, NOW)).toBe(1);
  });

  it("keeps the computed grant when the counter write fails (KV takes one write per key a second)", async () => {
    const kv = fakeKV();
    await kv.put(discoverKeys.yt("2026-10-03"), "69");
    Object.assign(kv, {
      put: async () => {
        throw new Error("KV PUT failed: 429 Too Many Requests");
      },
    });
    expect(await reserveYoutube({ SOCIAL_KV: kv }, 3, NOW)).toBe(1);
  });
});
