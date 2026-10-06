import { describe, expect, it, vi } from "vitest";
import { TAVILY_URL } from "../trends/tavily";
import { searchFamilies, youtubeCheck } from "./sources";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ENV = { TAVILY_API_KEY: "k", YOUTUBE_API_KEY: "y" };
const NOW = new Date("2026-10-07T05:35:00Z");

describe("searchFamilies", () => {
  it("asks Tavily once per query over both sites, keeps post pages and sums the credits", async () => {
    const doFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query !== "clone yourself video trend") return json({ results: [] }); // no usage: 1 credit
      return json({
        results: [
          {
            url: "https://www.tiktok.com/@ed/video/1",
            title: "Clone yourself in CapCut",
            content: "#cloneyourself",
          },
          {
            url: "https://www.instagram.com/mia/reel/C1/",
            title: "Swagger Trend",
            content: "clone effect",
          },
          { url: "https://www.tiktok.com/@ed", title: "ed on TikTok" },
          { url: "https://www.instagram.com/mia/", title: "mia" },
        ],
        usage: { credits: 2 },
      });
    });
    const out = await searchFamilies(ENV, doFetch, [
      "clone yourself video trend",
      "speed ramp trend edit",
    ]);
    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(String(doFetch.mock.calls[0][0])).toBe(TAVILY_URL);
    expect(JSON.parse(String(doFetch.mock.calls[0][1]?.body))).toEqual({
      query: "clone yourself video trend",
      include_domains: ["tiktok.com", "instagram.com"],
      max_results: 20,
      search_depth: "basic",
      include_published_date: true,
      include_usage: true,
      time_range: "week",
      language: "en",
    });
    expect(out).toEqual({
      posts: [
        {
          platform: "tt",
          handle: "@ed",
          title: "Clone yourself in CapCut",
          snippet: "#cloneyourself",
          url: "https://www.tiktok.com/@ed/video/1",
        },
        {
          platform: "ig",
          handle: "@mia",
          title: "Swagger Trend",
          snippet: "clone effect",
          url: "https://www.instagram.com/p/C1",
        },
      ],
      credits: 3,
      errors: [],
    });
  });

  it("names each failure: auth, quota, upstream, a timeout, no key", async () => {
    const status: Record<string, number> = { a: 401, b: 432, c: 429, d: 500 };
    const doFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query === "slow") return new Promise<Response>(() => {});
      return json({ error: "no" }, status[query]);
    });
    const out = await searchFamilies(ENV, doFetch, ["a", "b", "c", "d", "slow"], 20);
    expect(out).toEqual({
      posts: [],
      credits: 0,
      errors: ["auth", "quota", "quota", "upstream", "upstream"],
    });
    const none = vi.fn<typeof fetch>();
    expect((await searchFamilies({}, none, ["a"])).errors).toEqual(["not_configured"]);
    expect(none).not.toHaveBeenCalled();
  });
});

/** A fake YouTube: `search.list` answers each query's video ids, `videos.list` their views. */
function youtube(videos: Record<string, string[]>, views: Record<string, number>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/search")) {
      const ids = videos[url.searchParams.get("q") ?? ""] ?? [];
      return json({
        items: ids.map((id) => ({ id: { videoId: id }, snippet: { title: `video ${id}` } })),
      });
    }
    const ids = (url.searchParams.get("id") ?? "").split(",");
    return json({
      items: ids.map((id) => ({ id, statistics: { viewCount: String(views[id] ?? 0) } })),
    });
  });
}
const calls = (doFetch: ReturnType<typeof youtube>, path: string) =>
  doFetch.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith(path));

describe("youtubeCheck", () => {
  it("sums each effect's views from one stats call (a video two effects share counts for both)", async () => {
    const doFetch = youtube(
      { "clone effect edit": ["a", "b"], "swagger trend edit": ["a", "c"] },
      { a: 100, b: 50, c: 7 },
    );
    const out = await youtubeCheck(
      ENV,
      doFetch,
      [
        { key: "clone-effect", en: "clone effect" },
        { key: "swagger-trend", en: "swagger trend" },
      ],
      NOW,
    );
    expect(out).toEqual({
      results: {
        "clone-effect": { newVideos: 2, views7d: 150 },
        "swagger-trend": { newVideos: 2, views7d: 107 },
      },
      errors: [],
    });
    expect(calls(doFetch, "/search")).toHaveLength(2);
    const search = new URL(String(calls(doFetch, "/search")[0][0]));
    expect(search.searchParams.get("publishedAfter")).toBe("2026-09-30T05:35:00.000Z");
    expect(calls(doFetch, "/videos")).toHaveLength(1);
  });

  it("fits 6 effects in one stats call of ≤ 50 ids: views come from each effect's first 8 videos", async () => {
    const effects = Array.from({ length: 6 }, (_, e) => ({ key: `k${e}`, en: `fx${e}` }));
    const videos = Object.fromEntries(
      effects.map((fx, e) => [`${fx.en} edit`, Array.from({ length: 20 }, (_, v) => `e${e}v${v}`)]),
    );
    const views = Object.fromEntries(
      Object.values(videos)
        .flat()
        .map((id) => [id, 1]),
    );
    const doFetch = youtube(videos, views);
    const out = await youtubeCheck(ENV, doFetch, effects, NOW);
    const [stats] = calls(doFetch, "/videos");
    expect(new URL(String(stats[0])).searchParams.get("id")!.split(",")).toHaveLength(48);
    for (const fx of effects) expect(out.results[fx.key]).toEqual({ newVideos: 20, views7d: 8 });
    expect(calls(doFetch, "/search")).toHaveLength(6);
  });

  it("gives no numbers, not zeros, when the stats call fails", async () => {
    const doFetch = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname.endsWith("/search")
        ? json({ items: [{ id: { videoId: "a" }, snippet: { title: "video a" } }] })
        : json({ error: "down" }, 500),
    );
    const out = await youtubeCheck(ENV, doFetch, [{ key: "a", en: "a" }], NOW);
    expect(out).toEqual({ results: {}, errors: ["youtube_stats"] });
  });

  it("stops asking once YouTube's daily cap is reached", async () => {
    const doFetch = vi.fn<typeof fetch>(async () =>
      json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403),
    );
    const out = await youtubeCheck(
      ENV,
      doFetch,
      [
        { key: "a", en: "a" },
        { key: "b", en: "b" },
      ],
      NOW,
    );
    expect(out).toEqual({ results: {}, errors: ["youtube_cap"] });
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});
