import { describe, expect, it, vi } from "vitest";
import type { EffectPlatform, EffectPost } from "../effects/types";
import { YT_VIDEOS_URL } from "../trends/youtube";
import { YT_SEARCH_URL } from "../trends/youtubeSearch";
import { categoryById } from "./defs";
import { BRAVE_VIDEOS_URL, BRAVE_WEB_URL, braveTop, readTop, scanTop, youtubeTop } from "./top";

// Top videos per platform (planning/tools/19-category-trends.md §6), the owner: "Every category should show at least 50
// results in every platform with top tier results". Fake keys only; nothing leaves the machine.

const NOW = new Date("2026-10-07T05:40:00Z");
const YT_KEY = "yt-test-key";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const base = (u: URL) => `${u.origin}${u.pathname}`;

/** A fake YouTube: search.list finds `ids` (most viewed first, as `order=viewCount` does), videos.list answers each id
 * asked with its snippet and `views[id]` (left out: a hidden count). `over` replaces either answer. */
function youtube(
  ids: string[],
  views: Record<string, number | undefined> = {},
  over: { search?: () => Response; videos?: () => Response } = {},
) {
  return vi.fn<typeof fetch>(async (input) => {
    const u = new URL(String(input));
    if (base(u) === YT_SEARCH_URL)
      return over.search?.() ?? json({ items: ids.map((videoId) => ({ id: { videoId } })) });
    if (base(u) === YT_VIDEOS_URL)
      return (
        over.videos?.() ??
        json({
          items: u.searchParams
            .get("id")!
            .split(",")
            .map((id) => ({
              id,
              snippet: {
                title: `Car edit ${id}`,
                channelTitle: `Channel ${id}`,
                channelId: `UC_${id}`,
                description: `How ${id} was shot ${"and edited ".repeat(30)}`,
                publishedAt: "2026-10-01T10:00:00Z",
                thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
              },
              statistics: views[id] === undefined ? {} : { viewCount: String(views[id]) },
            })),
        })
      );
    return json({ error: "not_found" }, 404);
  });
}

describe("youtubeTop (T1, stored with the page)", () => {
  it("asks search.list for the main query's most viewed videos of the last 30 days, then videos.list for their views", async () => {
    const fetch = youtube(["carVid00001", "carVid00002"], { carVid00001: 5, carVid00002: 9 });
    await youtubeTop({ YOUTUBE_API_KEY: YT_KEY }, fetch, "car edit", NOW);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [search, videos] = fetch.mock.calls.map(([u]) => new URL(String(u)));
    expect(base(search)).toBe(YT_SEARCH_URL);
    expect(Object.fromEntries(search.searchParams)).toEqual({
      part: "snippet",
      type: "video",
      order: "viewCount",
      q: "car edit",
      publishedAfter: "2026-09-07T05:40:00.000Z",
      maxResults: "50",
      relevanceLanguage: "en",
      safeSearch: "moderate",
      key: YT_KEY,
    });
    expect(base(videos)).toBe(YT_VIDEOS_URL);
    expect(Object.fromEntries(videos.searchParams)).toEqual({
      part: "statistics,snippet",
      id: "carVid00001,carVid00002",
      key: YT_KEY,
    });
  });

  it("keeps at most 50, the most viewed first, each with its title, channel, views, date and thumbnail", async () => {
    const ids = Array.from({ length: 55 }, (_, i) => `carVid${String(i).padStart(5, "0")}`);
    // Fewer views the later in the search: the list has to be sorted, a hidden count goes last.
    const views: Record<string, number | undefined> = Object.fromEntries(
      ids.map((id, i) => [id, (i + 1) * 10]),
    );
    views[ids[7]] = undefined;
    const fetch = youtube(ids, views);
    const { videos: top } = (await youtubeTop(
      { YOUTUBE_API_KEY: YT_KEY },
      fetch,
      "car edit",
      NOW,
    ))!;
    // One videos.list takes 50 ids: only the first 50 found are asked.
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get("id")!.split(",")).toEqual(
      ids.slice(0, 50),
    );
    expect(top).toHaveLength(50);
    expect(top[0]).toEqual({
      url: `https://www.youtube.com/watch?v=${ids[49]}`,
      title: `Car edit ${ids[49]}`,
      creator: `Channel ${ids[49]}`,
      views: 500,
      publishedAt: "2026-10-01T10:00:00Z",
      thumbnail: `https://i.ytimg.com/vi/${ids[49]}/mqdefault.jpg`,
    });
    const counts = top.map((v) => v.views);
    expect(counts.slice(0, -1)).toEqual(
      [...counts.slice(0, -1)].sort((a, b) => (b ?? 0) - (a ?? 0)),
    );
    expect(top.at(-1)).toEqual(expect.not.objectContaining({ views: expect.anything() }));
    expect(top.at(-1)!.url).toBe(`https://www.youtube.com/watch?v=${ids[7]}`);
  });

  it("no key: no list and no call; a call that fails: no list; a search that finds nothing: an empty list", async () => {
    const none = youtube(["carVid00001"]);
    expect(await youtubeTop({}, none, "car edit", NOW)).toBeNull();
    expect(none).not.toHaveBeenCalled();
    const env = { YOUTUBE_API_KEY: YT_KEY };
    const quota = { error: { errors: [{ reason: "quotaExceeded" }] } };
    for (const over of [
      { search: () => json(quota, 403) },
      { search: () => new Response("<html>", { status: 200 }) },
      { videos: () => json({ error: "boom" }, 500) },
    ])
      expect(await youtubeTop(env, youtube(["carVid00001"], {}, over), "car edit", NOW)).toBeNull();
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await youtubeTop(env, offline, "car edit", NOW)).toBeNull();
    const nothing = youtube([]);
    expect(await youtubeTop(env, nothing, "car edit", NOW)).toEqual({ videos: [], posts: [] });
    expect(nothing).toHaveBeenCalledTimes(1);
  });

  it("T5: hands each video on as a post for the trends: title and description as text, its channel id the creator (C4)", async () => {
    const fetch = youtube(["carVid00001", "carVid00002"], { carVid00001: 5, carVid00002: 9 });
    const { videos, posts } = (await youtubeTop(
      { YOUTUBE_API_KEY: YT_KEY },
      fetch,
      "car edit",
      NOW,
    ))!;
    // The same videos in the same order; the description clipped as Discover's YouTube cards are (220 characters).
    expect(posts.map((p) => p.url)).toEqual(videos.map((v) => v.url));
    expect(posts[0]).toEqual({
      platform: "yt",
      // The channel's id, never its name: two channels may share a name (C4). The list shows the name.
      handle: "UC_carVid00002",
      title: "Car edit carVid00002",
      snippet: expect.stringMatching(/^How carVid00002 was shot and edited/),
      url: "https://www.youtube.com/watch?v=carVid00002",
    });
    expect(posts[0].snippet.length).toBeLessThanOrEqual(220);
  });
});

describe("scanTop (T2 and T3, the scan's own posts, stored)", () => {
  const post = (platform: EffectPlatform, id: string, handle = ""): EffectPost => ({
    platform,
    handle,
    title: `post ${id}`,
    snippet: "",
    url:
      platform === "ig"
        ? `https://www.instagram.com/p/${id}`
        : `https://www.tiktok.com/@t/video/${id}`,
  });
  const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((id) =>
    post("ig", id, id === "A" || id === "C" ? `@${id.toLowerCase()}` : ""),
  );
  const t = post("tt", "1", "@t");
  /** As searchFamilies hands them: each search's posts in Tavily's order, a post once a search. Search 1 finds A, B
   * and D; search 2 finds C, B and E; search 3 finds B, C and the TikTok post. */
  const posts = [a, b, d, c, b, e, b, c, t];

  it("each Instagram post once: the ones more of the searches found first, then as first seen; a creator when known", () => {
    expect(scanTop(posts, "ig")).toEqual([
      { url: b.url, title: "post B" }, // 3 searches
      { url: c.url, title: "post C", creator: "@c" }, // 2
      { url: a.url, title: "post A", creator: "@a" }, // 1, seen first
      { url: d.url, title: "post D" },
      { url: e.url, title: "post E" },
    ]);
    // T3: the TikTok posts the scan saw (a category scan searches Instagram alone since live fix 1: usually none).
    expect(scanTop(posts, "tt")).toEqual([{ url: t.url, title: "post 1", creator: "@t" }]);
    expect(scanTop([a, b], "tt")).toEqual([]);
  });

  it("keeps at most 50, in the order first seen when every post was found once", () => {
    const many = Array.from({ length: 60 }, (_, i) => post("ig", `P${i}`));
    const top = scanTop(many, "ig");
    expect(top).toHaveLength(50);
    expect(top.map((v) => v.url)).toEqual(many.slice(0, 50).map((p) => p.url));
  });
});

describe("readTop (T4, a stored page's lists: KV is untrusted)", () => {
  const ok = {
    url: "https://www.youtube.com/watch?v=carVid00001",
    title: "Car edit",
    creator: "Car Channel",
    views: 1200,
    publishedAt: "2026-10-01T10:00:00Z",
    thumbnail: "https://i.ytimg.com/vi/carVid00001/mqdefault.jpg",
  };

  it("drops a malformed entry alone, reads a list that is no list as empty, keeps ≤ 50 each", () => {
    const top = readTop({
      updatedAt: "2026-10-07T05:40:00.000Z",
      yt: [
        ok,
        { ...ok, url: "http://www.youtube.com/watch?v=carVid00002" }, // not https
        { ...ok, url: "javascript:alert(1)" },
        { ...ok, title: 5 },
        null,
        "a video",
        // Odd optional fields are left out, the entry kept.
        { ...ok, creator: 7, views: -1, publishedAt: 3, thumbnail: "http://x.example/t.jpg" },
      ],
      ig: "soon",
      tt: Array.from({ length: 60 }, () => ok),
    });
    expect(top).toEqual({
      updatedAt: "2026-10-07T05:40:00.000Z",
      yt: [ok, { url: ok.url, title: ok.title }],
      ig: [],
      tt: Array.from({ length: 50 }, () => ok),
    });
  });

  it("is undefined for a page from before §6 or a top that is none", () => {
    for (const x of [undefined, null, "soon", [], { yt: [ok] }, { updatedAt: 5, yt: [] }])
      expect(readTop(x), JSON.stringify(x)).toBeUndefined();
  });
});

describe("braveTop (on demand: Brave's results are never stored, and shown as Brave gave them)", () => {
  const CARS = categoryById("cars")!;
  const BRAVE_KEY = "brave-test-key";
  const DAY_KEY = "brave:count:2026-10-07";

  /** Brave's result for TikTok post n: its title as Brave writes it, its views when given (a number, or text), its
   * creator and Brave's thumbnail. */
  const ttHit = (n: number, views?: number | string, over: Record<string, unknown> = {}) => ({
    type: "video_result",
    url: `https://www.tiktok.com/@car${n}/video/${7_000_000 + n}`,
    title: `Car edit ${n} | TikTok`,
    description: "",
    age: "3 days ago",
    meta_url: { hostname: "www.tiktok.com" },
    thumbnail: { src: `https://imgs.search.brave.com/t${n}.jpg` },
    video: { ...(views === undefined ? {} : { views }), creator: `car${n}` },
    ...over,
  });
  /** What the page gets for `ttHit(n, views)`: the title as given. */
  const ttTop = (n: number, views?: number) => ({
    url: `https://www.tiktok.com/@car${n}/video/${7_000_000 + n}`,
    title: `Car edit ${n} | TikTok`,
    creator: `car${n}`,
    ...(views === undefined ? {} : { views }),
    thumbnail: `https://imgs.search.brave.com/t${n}.jpg`,
    age: "3 days ago",
  });
  /** A result that is no TikTok post (a YouTube video): it fills a page, never the list. */
  const other = (n: number) => ({
    url: `https://www.youtube.com/watch?v=other${String(n).padStart(6, "0")}`,
    title: `other ${n}`,
    meta_url: { hostname: "www.youtube.com" },
  });
  /** A video search page of `size` raw results: `hits` first, other sites after; `more`: Brave's
   * `query.more_results_available`. */
  const page = (hits: unknown[], size: number, more = true) => ({
    query: { more_results_available: more },
    results: [...hits, ...Array.from({ length: size - hits.length }, (_, i) => other(i))],
  });
  const tts = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ttHit(from + i));
  const SCAN = [{ url: "https://www.tiktok.com/@scan/video/9000001", title: "scan post" }];

  function fakeKV(count?: string) {
    const store = new Map<string, string>(count ? [[DAY_KEY, count]] : []);
    return {
      store,
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      // The counter's TTL is read from the call itself.
      put: vi.fn<(key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>>(
        async (key, value) => {
          store.set(key, value);
        },
      ),
    };
  }
  const env = (kv = fakeKV(), over: Record<string, string> = {}) => ({
    BRAVE_API_KEY: BRAVE_KEY,
    SOCIAL_KV: kv as unknown as KVNamespace,
    ...over,
  });
  /** The KV writes, as [key, value]. */
  const puts = (kv: ReturnType<typeof fakeKV>) => kv.put.mock.calls.map(([k, v]) => [k, v]);
  /** Brave answering its video search with `videos(offset)` and its web search with `web(offset)`. */
  function brave(
    answers: { videos?: (offset: number) => Response; web?: (offset: number) => Response } = {},
  ) {
    return vi.fn<typeof fetch>(async (input) => {
      const u = new URL(String(input));
      const offset = Number(u.searchParams.get("offset"));
      if (base(u) === BRAVE_VIDEOS_URL) return answers.videos?.(offset) ?? json({ results: [] });
      if (base(u) === BRAVE_WEB_URL) return answers.web?.(offset) ?? json({});
      return json({ error: "not_found" }, 404);
    });
  }
  /** The requests made, as "endpoint:offset". */
  const asked = (fetch: ReturnType<typeof brave>) =>
    fetch.mock.calls.map(([u]) => {
      const url = new URL(String(u));
      return `${base(url) === BRAVE_WEB_URL ? "web" : "videos"}:${url.searchParams.get("offset")}`;
    });

  it("asks Brave's video search for the main query on the platform's site over a month, in English, the key in a header", async () => {
    const fifty = tts(1, 50);
    const fetch = brave({ videos: () => json(page(fifty, 50)) });
    const r = await braveTop(env(), fetch, CARS, "tt", [], NOW);
    // 50 matches: no second page.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [[input, init]] = fetch.mock.calls;
    const u = new URL(String(input));
    expect(base(u)).toBe(BRAVE_VIDEOS_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      q: "car edit site:tiktok.com",
      count: "50",
      offset: "0",
      freshness: "pm",
      search_lang: "en",
      safesearch: "moderate",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Subscription-Token")).toBe(BRAVE_KEY);
    expect(headers.get("Accept")).toBe("application/json");
    expect(String(input)).not.toContain(BRAVE_KEY);
    expect(r).toEqual({
      platform: "tt",
      scan: [],
      brave: fifty.map((_, i) => ttTop(i + 1)),
      source: "brave",
      endpoint: "videos",
    });
    const ig = brave();
    await braveTop(env(), ig, CARS, "ig", [], NOW);
    expect(new URL(String(ig.mock.calls[0][0])).searchParams.get("q")).toBe(
      "car edit site:instagram.com",
    );
  });

  it("C2: keeps Brave's https posts of the platform in Brave's order, titles and counts as given, links made canonical", async () => {
    const results = [
      ttHit(1, "3400"), // views as text
      ttHit(2, 1200),
      ttHit(3, 9, { url: "http://www.tiktok.com/@car3/video/7000003" }), // not https
      ttHit(4, 9, {
        url: "https://www.youtube.com/watch?v=carVid00004",
        meta_url: { hostname: "www.youtube.com" },
      }), // another site
      ttHit(5, 9, { url: "https://www.tiktok.com/@car5" }), // a profile, not a post
      ttHit(6, 9, { url: "https://tiktok.example/@car6/video/7000006" }), // its link elsewhere
      ttHit(7, undefined, {
        url: "https://m.tiktok.com/@car7/video/7000007?is_from_webapp=1",
        video: { author: { name: "Car Seven" } },
      }),
      ttHit(2, 1200), // the same post again: shown once, where Brave first put it
      { url: 5, title: "x" },
      null,
      "a result",
      // A title as Brave wrote it, however generic; odd views, thumbnail and age left out.
      ttHit(8, -5, {
        title: "TikTok - Make Your Day",
        thumbnail: { src: "http://imgs.example/t8.jpg" },
        age: 3,
      }),
      // The most viewed, last as Brave put it: never sorted to the top.
      ttHit(9, 99_999),
    ];
    const r = await braveTop(
      env(),
      brave({ videos: () => json({ results }) }),
      CARS,
      "tt",
      [],
      NOW,
    );
    expect(r.brave).toEqual([
      ttTop(1, 3400),
      ttTop(2, 1200),
      {
        url: "https://www.tiktok.com/@car7/video/7000007",
        title: "Car edit 7 | TikTok",
        creator: "Car Seven",
        thumbnail: "https://imgs.search.brave.com/t7.jpg",
        age: "3 days ago",
      },
      {
        url: "https://www.tiktok.com/@car8/video/7000008",
        title: "TikTok - Make Your Day",
        creator: "car8",
      },
      ttTop(9, 99_999),
    ]);
  });

  it("C2: the stored list apart (`scan`), Brave's items it already holds left out, 50 in all", async () => {
    const stored = [{ url: ttTop(2).url, title: "scan copy of 2" }, ...SCAN];
    const results = [ttHit(1), ttHit(2, 10), ttHit(3, 5000)];
    const r = await braveTop(
      env(),
      brave({ videos: () => json({ results }) }),
      CARS,
      "tt",
      stored,
      NOW,
    );
    expect(r).toEqual({
      platform: "tt",
      scan: stored,
      brave: [ttTop(1), ttTop(3, 5000)],
      source: "brave",
      endpoint: "videos",
    });
    const scan = Array.from({ length: 20 }, (_, i) => ({
      url: `https://www.tiktok.com/@scan/video/${9_000_100 + i}`,
      title: `scan ${i}`,
    }));
    const capped = await braveTop(
      env(),
      brave({ videos: () => json(page(tts(1, 45), 50)) }),
      CARS,
      "tt",
      scan,
      NOW,
    );
    expect(capped.scan).toEqual(scan);
    expect(capped.brave).toEqual(tts(1, 30).map((_, i) => ttTop(i + 1)));
  });

  it("C6: a second page only when the first was full, Brave has more, and fewer than 50 matched; a failed one keeps the first", async () => {
    // Page 0: 50 results, 30 of them TikTok posts (1–30); page 1: posts 21–50. 50 once each, in Brave's order.
    const two = brave({ videos: (o) => json(page(tts(o * 20 + 1, o * 20 + 30), 50)) });
    const r = await braveTop(env(), two, CARS, "tt", [], NOW);
    expect(asked(two)).toEqual(["videos:0", "videos:1"]);
    expect(r.brave.map((v) => v.url)).toEqual(tts(1, 50).map((_, i) => ttTop(i + 1).url));
    // Fewer results than asked for: Brave has nothing more.
    const short = brave({ videos: () => json(page(tts(1, 30), 30)) });
    expect((await braveTop(env(), short, CARS, "tt", [], NOW)).brave).toHaveLength(30);
    expect(asked(short)).toEqual(["videos:0"]);
    // A full page, but Brave says there are no more results.
    const last = brave({ videos: () => json(page(tts(1, 30), 50, false)) });
    await braveTop(env(), last, CARS, "tt", [], NOW);
    expect(asked(last)).toEqual(["videos:0"]);
    const flaky = brave({
      videos: (o) => (o ? json({}, 500) : json(page([ttHit(1)], 50))),
    });
    expect(await braveTop(env(), flaky, CARS, "tt", SCAN, NOW)).toEqual({
      platform: "tt",
      scan: SCAN,
      brave: [ttTop(1)],
      source: "brave",
      endpoint: "videos",
    });
    expect(asked(flaky)).toEqual(["videos:0", "videos:1"]);
  });

  it("C9: the video endpoint refused with 403, 404 or 422 (not in the plan): web search, its web results then its videos", async () => {
    for (const refused of [403, 404, 422]) {
      const kv = fakeKV();
      // A full first page (20 web results, 1 a TikTok post) asks for a second.
      const webPage = (hits: unknown[]) => [
        ...hits,
        ...Array.from({ length: 20 - hits.length }, (_, i) => other(i)),
      ];
      const fetch = brave({
        videos: () => json({ error: { code: "OPTION_NOT_IN_PLAN" } }, refused),
        web: (o) =>
          json(
            o
              ? { web: { results: [ttHit(3)] }, videos: { results: [ttHit(4)] } }
              : { web: { results: webPage([ttHit(1)]) }, videos: { results: [ttHit(2, 99)] } },
          ),
      });
      const r = await braveTop(env(kv), fetch, CARS, "tt", [], NOW);
      expect(asked(fetch), String(refused)).toEqual(["videos:0", "web:0", "web:1"]);
      expect(Object.fromEntries(new URL(String(fetch.mock.calls[1][0])).searchParams)).toEqual({
        q: "car edit site:tiktok.com",
        count: "20",
        offset: "0",
        freshness: "pm",
        search_lang: "en",
        safesearch: "moderate",
      });
      // Each section in Brave's order, never interleaved: the web results of both pages, then their videos.
      expect(r).toEqual({
        platform: "tt",
        scan: [],
        brave: [ttTop(1), ttTop(3), ttTop(2, 99), ttTop(4)],
        source: "brave",
        endpoint: "web",
      });
      // Every request counts against the day, the refused one too: 2 reserved, then 3.
      expect(puts(kv)).toEqual([
        [DAY_KEY, "2"],
        [DAY_KEY, "3"],
      ]);
    }
    const down = brave({ videos: () => json({}, 422), web: () => json({}, 500) });
    expect(await braveTop(env(), down, CARS, "tt", SCAN, NOW)).toEqual({
      platform: "tt",
      scan: SCAN,
      brave: [],
      source: "scan",
      note: "brave_failed",
    });
  });

  it("C9: 401, 429, or any other failure: the stored list noted 'brave_failed', and no web search", async () => {
    const failures = [
      () => json({ error: "unauthorized" }, 401),
      () => json({ error: "rate limited" }, 429),
      () => json({ error: "boom" }, 500),
      () => new Response("<html>", { status: 200 }),
      () => {
        throw new TypeError("offline");
      },
    ];
    for (const videos of failures) {
      const fetch = brave({ videos });
      expect(await braveTop(env(), fetch, CARS, "tt", SCAN, NOW)).toEqual({
        platform: "tt",
        scan: SCAN,
        brave: [],
        source: "scan",
        note: "brave_failed",
      });
      expect(asked(fetch)).toEqual(["videos:0"]);
    }
  });

  it("C8: without BRAVE_API_KEY, or with BRAVE_DAILY \"0\" (off): the stored list noted 'no_key'; nothing asked, read or written", async () => {
    for (const e of [{}, { BRAVE_API_KEY: BRAVE_KEY, BRAVE_DAILY: "0" }]) {
      const kv = fakeKV();
      const fetch = brave();
      expect(
        await braveTop(
          { ...e, SOCIAL_KV: kv as unknown as KVNamespace },
          fetch,
          CARS,
          "ig",
          SCAN,
          NOW,
        ),
      ).toEqual({ platform: "ig", scan: SCAN, brave: [], source: "scan", note: "no_key" });
      expect(fetch).not.toHaveBeenCalled();
      expect(kv.get).not.toHaveBeenCalled();
      expect(kv.put).not.toHaveBeenCalled();
    }
  });

  it("C5: at most BRAVE_DAILY requests a UTC day (default 40), reserved before the first and corrected after; past it 'daily_cap'", async () => {
    const kv = fakeKV();
    const capped = env(kv, { BRAVE_DAILY: "3" });
    // A full page with 1 match: 2 requests an open.
    const twoPages = () => brave({ videos: () => json(page([ttHit(1)], 50)) });
    await braveTop(capped, twoPages(), CARS, "tt", [], NOW);
    expect(kv.put).toHaveBeenLastCalledWith(DAY_KEY, "2", { expirationTtl: 172_800 });
    // 1 left: the first page alone.
    const lastOne = twoPages();
    expect((await braveTop(capped, lastOne, CARS, "tt", [], NOW)).brave).toEqual([ttTop(1)]);
    expect(asked(lastOne)).toEqual(["videos:0"]);
    expect(kv.store.get(DAY_KEY)).toBe("3");
    const over = twoPages();
    expect(await braveTop(capped, over, CARS, "tt", SCAN, NOW)).toEqual({
      platform: "tt",
      scan: SCAN,
      brave: [],
      source: "scan",
      note: "daily_cap",
    });
    expect(over).not.toHaveBeenCalled();
    // 2 reserved, 1 made: corrected down after.
    const once = fakeKV();
    await braveTop(
      env(once),
      brave({ videos: () => json(page([ttHit(1)], 1)) }),
      CARS,
      "tt",
      [],
      NOW,
    );
    expect(puts(once)).toEqual([
      [DAY_KEY, "2"],
      [DAY_KEY, "1"],
    ]);
    // The default is 40; a value that is no number ≥ 0 is the default.
    for (const [count, daily, note] of [
      ["40", undefined, "daily_cap"],
      ["39", undefined, undefined],
      ["39", "-1", undefined],
      ["39", "lots", undefined],
    ] as const) {
      const r = await braveTop(
        env(fakeKV(count), daily === undefined ? {} : { BRAVE_DAILY: daily }),
        twoPages(),
        CARS,
        "tt",
        [],
        NOW,
      );
      expect(r.note, `${count} used, BRAVE_DAILY ${daily}`).toBe(note);
    }
  });

  it("writes nothing from Brave to KV: only the day's counter, reserved before the first request", async () => {
    const kv = fakeKV();
    const fetch = brave({ videos: (o) => json(page([ttHit(o + 1, 5)], 50)) });
    const r = await braveTop(env(kv), fetch, CARS, "tt", [], NOW);
    expect(r.brave).toHaveLength(2);
    expect(puts(kv)).toEqual([[DAY_KEY, "2"]]);
    expect(kv.put.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
  });
});
