import { describe, expect, it, vi } from "vitest";
import { usageKeys } from "../discover/usage";
import { TAVILY_URL } from "../trends/tavily";
import { searchFamilies, youtubeCheck } from "./sources";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ENV = { TAVILY_API_KEY: "k", YOUTUBE_API_KEY: "y" };
const NOW = new Date("2026-10-07T05:35:00Z");

type Body = { query: string; include_domains: string[]; time_range: string };
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body)) as Body;
/** Which search a request is: "ig week", "ig month", "tt month". */
const kindOf = ({ include_domains: [site], time_range }: Body) =>
  `${site === "instagram.com" ? "ig" : "tt"} ${time_range}`;
/** A KV holding Discover's cached Tavily usage as this text (or throwing it). */
const usageKv = (text: string | Error) =>
  ({
    get: vi.fn(async (key: string) => {
      if (text instanceof Error) throw text;
      return key === usageKeys.tavily ? text : null;
    }),
  }) as unknown as KVNamespace;

describe("searchFamilies", () => {
  it("asks Tavily 3 times a family (Instagram over a week and a month, TikTok over a month), keeps each family's post pages once and sums the credits", async () => {
    const reel = (id: string, handle: string, title: string) => ({
      url: `https://www.instagram.com/${handle}/reel/${id}/`,
      title,
      content: "gif stickers by @theboogley",
    });
    const replies: Record<string, unknown[]> = {
      // Each window finds its own posts, and both find C1: one post.
      "ig week": [reel("C1", "mia", "Swagger Trend"), { url: "https://www.instagram.com/mia/" }],
      "ig month": [reel("C1", "mia", "Swagger Trend"), reel("C2", "zoe", "moving stickers")],
      "tt month": [
        { url: "https://www.tiktok.com/@ed/video/1", title: "Clone yourself", content: "#clone" },
        { url: "https://www.tiktok.com/@ed", title: "ed on TikTok" },
      ],
    };
    const doFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const body = bodyOf(init);
      if (body.query !== "gif stickers") return json({ results: [] }); // no usage: 1 credit
      return json({ results: replies[kindOf(body)], usage: { credits: 2 } });
    });
    const out = await searchFamilies(ENV, doFetch, ["gif stickers", "speed ramp trend edit"]);

    expect(doFetch).toHaveBeenCalledTimes(6);
    expect(String(doFetch.mock.calls[0][0])).toBe(TAVILY_URL);
    const bodies = doFetch.mock.calls.map(([, init]) => bodyOf(init));
    expect(bodies.filter((b) => b.query === "gif stickers").map(kindOf)).toEqual([
      "ig week",
      "ig month",
      "tt month",
    ]);
    for (const body of bodies)
      expect(body).toMatchObject({
        max_results: 20,
        search_depth: "basic",
        include_published_date: true,
        include_usage: true,
        language: "en",
      });
    expect(out).toEqual({
      posts: [
        {
          platform: "ig",
          handle: "@mia",
          title: "Swagger Trend",
          snippet: "gif stickers by @theboogley",
          url: "https://www.instagram.com/p/C1",
        },
        {
          platform: "ig",
          handle: "@zoe",
          title: "moving stickers",
          snippet: "gif stickers by @theboogley",
          url: "https://www.instagram.com/p/C2",
        },
        {
          platform: "tt",
          handle: "@ed",
          title: "Clone yourself",
          snippet: "#clone",
          url: "https://www.tiktok.com/@ed/video/1",
        },
      ],
      credits: 9,
      errors: [],
      // Family numbers in FAMILY_QUERIES (1-based); post pages found by each search; posts once each.
      families: [
        { family: 2, tt: 1, igWeek: 1, igMonth: 2, posts: 3 },
        { family: 5, tt: 0, igWeek: 0, igMonth: 0, posts: 0 },
      ],
      tight: false,
    });
  });

  it("with Tavily's month 90 % spent (Discover's cached figure), only the Instagram month search a family", async () => {
    const scan = async (kv?: KVNamespace) => {
      const doFetch = vi.fn<typeof fetch>(async () => json({ results: [] }));
      const out = await searchFamilies({ ...ENV, SOCIAL_KV: kv }, doFetch, ["a", "b"]);
      return { out, kinds: doFetch.mock.calls.map(([, init]) => kindOf(bodyOf(init))) };
    };
    const tight = await scan(usageKv(JSON.stringify({ used: 900, limit: 1000, plan: "free" })));
    expect(tight.kinds).toEqual(["ig month", "ig month"]);
    expect(tight.out).toMatchObject({ credits: 2, tight: true });
    // Under 90 %, no figure kept, a broken one, no known limit, or KV failing: every search.
    for (const kv of [
      usageKv(JSON.stringify({ used: 899, limit: 1000 })),
      undefined,
      usageKv(""),
      usageKv("{not json"),
      usageKv(JSON.stringify({ used: 950, limit: null })),
      usageKv(new Error("KV GET failed")),
    ]) {
      const full = await scan(kv);
      expect(full.kinds).toHaveLength(6);
      expect(full.out.tight).toBe(false);
    }
  });

  it("names each failure: auth, quota, upstream, a timeout, no key", async () => {
    const status: Record<string, number> = { a: 401, b: 432, c: 429, d: 500 };
    const doFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const { query } = bodyOf(init);
      if (query === "slow") return new Promise<Response>(() => {});
      return json({ error: "no" }, status[query]);
    });
    const out = await searchFamilies(ENV, doFetch, ["a", "b", "c", "d", "slow"], 20);
    expect(out).toMatchObject({ posts: [], credits: 0 });
    // Each of the 3 searches a family.
    expect(out.errors).toEqual(
      Array(3).fill(["auth", "quota", "quota", "upstream", "upstream"]).flat(),
    );
    const none = vi.fn<typeof fetch>();
    expect((await searchFamilies({}, none, ["a"])).errors).toEqual(["not_configured"]);
    expect(none).not.toHaveBeenCalled();
  });

  it("runs 6 searches at a time, so none waits for a connection while its time runs", async () => {
    let open = 0;
    let most = 0;
    const doFetch = vi.fn<typeof fetch>(async () => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return json({ results: [] });
    });
    const six = ["a", "b", "c", "d", "e", "f"];
    expect((await searchFamilies(ENV, doFetch, six)).errors).toEqual([]);
    expect(doFetch).toHaveBeenCalledTimes(18);
    expect(most).toBe(6);
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
