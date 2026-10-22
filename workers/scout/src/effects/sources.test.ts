import { describe, expect, it, vi } from "vitest";
import { TAVILY_USAGE_URL, usageKeys } from "../discover/usage";
import { instagramShortcodeAt, tiktokIdAt } from "../postDate";
import { TAVILY_URL } from "../trends/tavily";
import { familiesForSlot } from "./families";
import { monthTight, searchFamilies, youtubeCheck } from "./sources";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
/** Discover's figure kept, 8 % of the month: the searches here never ask Tavily's /usage first. */
const ENV = {
  TAVILY_API_KEY: "k",
  YOUTUBE_API_KEY: "y",
  SOCIAL_KV: usageKv(JSON.stringify({ used: 80, limit: 1000 })),
};

describe("monthTight (90 % of the month's credits, both jobs)", () => {
  it("counts a positive pay-as-you-go limit in the month; no figure or no plan limit is not tight", () => {
    expect(monthTight(null)).toBe(false);
    expect(monthTight({ used: 950, limit: null })).toBe(false);
    expect(monthTight({ used: 899, limit: 1000 })).toBe(false);
    expect(monthTight({ used: 900, limit: 1000 })).toBe(true);
    expect(monthTight({ used: 1000, limit: 1000, paygoUsed: 400, paygoLimit: 625 })).toBe(false); // 86 %
    expect(monthTight({ used: 1000, limit: 1000, paygoUsed: 500, paygoLimit: 625 })).toBe(true); // 92 %
    // No known pay-as-you-go allowance: the plan alone.
    expect(monthTight({ used: 950, limit: 1000, paygoLimit: null })).toBe(true);
  });
});

describe("searchFamilies", () => {
  it("counts a positive pay-as-you-go limit in the month, as category scans do", async () => {
    const searches = async (usage: object) => {
      const doFetch = vi.fn<typeof fetch>(async () => json({ results: [] }));
      const env = { ...ENV, SOCIAL_KV: usageKv(JSON.stringify(usage)) };
      const out = await searchFamilies(env, doFetch, familiesForSlot(0));
      return { searches: doFetch.mock.calls.length, tight: out.tight };
    };
    // 950 of the plan's 1,000 used, 500 more on pay-as-you-go: 950 of 1,500, all 18 searches.
    expect(await searches({ used: 950, limit: 1000, paygoUsed: 0, paygoLimit: 500 })).toEqual({
      searches: 18,
      tight: false,
    });
    // The same without a pay-as-you-go limit: tight, the 6 Instagram month searches.
    expect(await searches({ used: 950, limit: 1000 })).toEqual({ searches: 6, tight: true });
  });

  it("asks Tavily 3 times a family (Instagram over a week and a month, TikTok over a month), keeps each family's post pages once and sums the credits", async () => {
    // Each post's date comes from its own id (the job counts creators on the day they posted).
    const oct5 = new Date("2026-10-05T10:00:00.000Z");
    const [c1, c2] = [instagramShortcodeAt(oct5, 1), instagramShortcodeAt(oct5, 2)];
    const video = tiktokIdAt(oct5, 1);
    const reel = (id: string, handle: string, title: string) => ({
      url: `https://www.instagram.com/${handle}/reel/${id}/`,
      title,
      content: "gif stickers by @theboogley",
    });
    const replies: Record<string, unknown[]> = {
      // Each window finds its own posts, and both find C1: one post.
      "ig week": [reel(c1, "mia", "Swagger Trend"), { url: "https://www.instagram.com/mia/" }],
      "ig month": [reel(c1, "mia", "Swagger Trend"), reel(c2, "zoe", "moving stickers")],
      "tt month": [
        {
          url: `https://www.tiktok.com/@ed/video/${video}`,
          title: "Clone yourself",
          content: "#clone",
        },
        { url: "https://www.tiktok.com/@ed", title: "ed on TikTok" },
      ],
    };
    const doFetch = vi.fn<typeof fetch>(async (_url, init) => {
      const body = bodyOf(init);
      if (body.query !== "gif stickers video edit") return json({ results: [] }); // no usage: 1 credit
      return json({ results: replies[kindOf(body)], usage: { credits: 2 } });
    });
    const out = await searchFamilies(
      ENV,
      doFetch,
      ["gif stickers video edit", "speed ramp trend edit"],
      undefined,
      { now: new Date("2026-10-07T05:35:00Z") },
    );

    expect(doFetch).toHaveBeenCalledTimes(6);
    expect(String(doFetch.mock.calls[0][0])).toBe(TAVILY_URL);
    const bodies = doFetch.mock.calls.map(([, init]) => bodyOf(init));
    expect(bodies.filter((b) => b.query === "gif stickers video edit").map(kindOf)).toEqual([
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
          url: `https://www.instagram.com/p/${c1}`,
          published: "2026-10-05T10:00:00.000Z",
        },
        {
          platform: "ig",
          handle: "@zoe",
          title: "moving stickers",
          snippet: "gif stickers by @theboogley",
          url: `https://www.instagram.com/p/${c2}`,
          published: "2026-10-05T10:00:00.000Z",
        },
        {
          platform: "tt",
          handle: "@ed",
          title: "Clone yourself",
          snippet: "#clone",
          url: `https://www.tiktok.com/@ed/video/${video}`,
          published: "2026-10-05T10:00:00.000Z",
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

  it("with Tavily's month 90 % spent, only the Instagram month search a family: Discover's figure, else Tavily's /usage asked once", async () => {
    /** `usage`: Tavily's /usage answer when no figure is kept (by default none: a 404). */
    const scan = async (kv?: KVNamespace, usage = () => json({ error: "not_found" }, 404)) => {
      const doFetch = vi.fn<typeof fetch>(async (url) =>
        String(url) === TAVILY_USAGE_URL ? usage() : json({ results: [] }),
      );
      const out = await searchFamilies({ ...ENV, SOCIAL_KV: kv }, doFetch, ["a", "b"]);
      const searches = doFetch.mock.calls.filter(([url]) => String(url) === TAVILY_URL);
      return {
        out,
        kinds: searches.map(([, init]) => kindOf(bodyOf(init))),
        asked: doFetch.mock.calls.length - searches.length,
      };
    };
    // A figure Discover keeps: used as it is.
    const tight = await scan(usageKv(JSON.stringify({ used: 900, limit: 1000, plan: "free" })));
    expect(tight).toMatchObject({ kinds: ["ig month", "ig month"], asked: 0 });
    expect(tight.out).toMatchObject({ credits: 2, tight: true });
    // None kept (05:35 UTC: nobody opened Discover in the last 10 minutes): Tavily's own figure, asked once.
    const asked = await scan(undefined, () =>
      json({ account: { plan_usage: 950, plan_limit: 1000 } }),
    );
    expect(asked).toMatchObject({ kinds: ["ig month", "ig month"], asked: 1 });
    expect(asked.out.tight).toBe(true);
    // Under 90 % or no known limit (nothing asked), or no figure at all (none kept, a broken one or KV failing, and
    // the /usage call failing): every search.
    const full: [KVNamespace | undefined, number][] = [
      [usageKv(JSON.stringify({ used: 899, limit: 1000 })), 0],
      [usageKv(JSON.stringify({ used: 950, limit: null })), 0],
      [undefined, 1],
      [usageKv(""), 1],
      [usageKv("{not json"), 1],
      [usageKv(new Error("KV GET failed")), 1],
    ];
    for (const [kv, calls] of full) {
      const out = await scan(kv);
      expect(out.kinds).toHaveLength(6);
      expect(out).toMatchObject({ asked: calls, out: { tight: false } });
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

  it("numbers a category's searches by their place in its own list, and takes its budget decision", async () => {
    const get = vi.fn(async () => JSON.stringify({ used: 999, limit: 1000 }));
    const doFetch = vi.fn<typeof fetch>(async () => json({ results: [] }));
    const queries = ["car edit trend", "cinematic car edit"];
    const out = await searchFamilies(
      { ...ENV, SOCIAL_KV: { get } as unknown as KVNamespace },
      doFetch,
      queries,
      undefined,
      { numbering: queries, tight: false },
    );
    expect(out.families.map((f) => f.family)).toEqual([1, 2]);
    // All 3 searches of each query: the 99 % figure is never read, because the caller already decided.
    expect(out.tight).toBe(false);
    expect(doFetch).toHaveBeenCalledTimes(6);
    expect(get).not.toHaveBeenCalled();
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
