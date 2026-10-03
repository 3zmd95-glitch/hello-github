import { describe, expect, it, vi } from "vitest";
import { discoverKeys, reserveYoutube, tavilyCall, youtubeCall } from "./fetchers";

const NOW = new Date("2026-10-03T09:00:00Z");

type Entry = { value: string; expirationTtl?: number };
function fakeKV() {
  const store = new Map<string, Entry>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    },
  } as unknown as KVNamespace & { store: Map<string, Entry> };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("tavilyCall", () => {
  it("asks 20 results from one platform in the query's language, with dates and usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        results: [{ url: "https://www.tiktok.com/@a/video/1", title: "flash edit", content: "x" }],
        usage: { credits: 1 },
      }),
    );
    const out = await tavilyCall({ TAVILY_API_KEY: "k" }, fetchMock, {
      q: "شرح فلاش",
      platform: "tt",
      lang: "ar",
      timeRange: "month",
    });
    expect(out).toMatchObject({ ok: true, credits: 1 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
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

  it("maps Tavily's errors", async () => {
    const call = { q: "x", platform: "ig" as const, lang: "en" as const };
    expect(await tavilyCall({}, vi.fn(), call)).toEqual({ ok: false, error: "not_configured" });
    expect(
      await tavilyCall(
        { TAVILY_API_KEY: "k" },
        vi.fn(async () => json({}, 432)),
        call,
      ),
    ).toEqual({ ok: false, error: "quota" });
    expect(
      await tavilyCall(
        { TAVILY_API_KEY: "k" },
        vi.fn(async () => json({}, 401)),
        call,
      ),
    ).toEqual({ ok: false, error: "auth" });
    expect(
      await tavilyCall(
        { TAVILY_API_KEY: "k" },
        vi.fn(async () => json({}, 500)),
        call,
      ),
    ).toEqual({ ok: false, error: "upstream" });
    expect(
      await tavilyCall(
        { TAVILY_API_KEY: "k" },
        vi.fn(async () => {
          throw new TypeError("down");
        }),
        call,
      ),
    ).toEqual({ ok: false, error: "upstream" });
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
});

describe("reserveYoutube", () => {
  it("grants calls up to the day's cap and counts them", async () => {
    const kv = fakeKV();
    const env = { SOCIAL_KV: kv, DISCOVER_YT_CAP: "5" };
    expect(await reserveYoutube(env, 3, NOW)).toBe(3);
    expect(await reserveYoutube(env, 3, NOW)).toBe(2);
    expect(await reserveYoutube(env, 3, NOW)).toBe(0);
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
});
