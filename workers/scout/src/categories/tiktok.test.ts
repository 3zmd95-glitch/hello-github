import { describe, expect, it, vi } from "vitest";
import { encryptJson } from "../social/crypto";
import { GENRES } from "../trends/genres";
import {
  TIKTOK_INDUSTRY,
  tiktokTop,
  TT_EFFECTS,
  TT_PHOTO,
  TT_TRENDING_URL,
  TT_VIDEOS_URL,
} from "./tiktok";

// The TikTok tab's list from TikTok's Discovery API (planning/tools/19-category-trends.md §6), against a fake TikTok.
// Every value here is fake.

const SCOUT = "scout-token";
const ACCESS = "fake-access-token";
const TOKEN = await encryptJson(SCOUT, {
  access_token: ACCESS,
  advertiser_ids: ["adv1", "adv2"],
  connectedAt: "2026-10-07T09:00:00.000Z",
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** KV holding the sealed token (`tiktokads:token`), or none. */
const kv = (token: string | null = TOKEN) =>
  ({
    get: vi.fn(async (key: string) => (key === "tiktokads:token" ? token : null)),
  }) as unknown as KVNamespace;
const env = (over: Record<string, unknown> = {}) => ({
  SOCIAL_KV: kv(),
  SCOUT_TOKEN: SCOUT,
  ...over,
});

/** TikTok's popular hashtag n (id 100n), of rank `rank`, popular in `countries`, named `car<n>` (a Cars subject word
 * without an edit cue: tier 3) unless `name` says otherwise. */
const tag = (n: number, countries = ["US", "GB"], rank: unknown = String(n), name = `car${n}`) => ({
  hashtag_id: String(1000 + n),
  hashtag_name: name,
  rank_position: rank,
  rank_change: 0,
  posts: 1200,
  views: 250_000,
  views_global_lifetime: 9_000_000,
  posts_global_lifetime: 40_000,
  top_country_list: countries,
  trending_history: [],
});
/** Hashtag t's i-th video: its share link carries a query, as TikTok's do. */
const vid = (t: number, i: number) => {
  const id = `${t}${String(i).padStart(2, "0")}`;
  return {
    video_id: id,
    embed_url: `https://www.tiktok.com/embed/v2/${id}`,
    share_url: `https://www.tiktok.com/@c${t}_${i}/video/${id}?is_from_webapp=1&sender_device=pc`,
  };
};
/** The top video hashtag t's i-th video becomes. */
const top = (t: number, i: number) => ({
  url: `https://www.tiktok.com/@c${t}_${i}/video/${t}${String(i).padStart(2, "0")}`,
  title: `#car${t}`,
  creator: `@c${t}_${i}`,
});
const TAGS = Array.from({ length: 12 }, (_, i) => tag(i + 1));
const ok = (list: unknown[]) => json({ code: 0, message: "OK", data: { list } });
/** Hashtag ids as `video_list` takes them, from their numbers. */
const ids = (...n: number[]) => JSON.stringify(n.map((x) => String(1000 + x)));

/** A fake TikTok: `trending_list` answers `tags` for the category's industry and `edits[category]` (else none) for
 * SPECIAL_EFFECTS and PHOTOGRAPHY, `video_list` 20 videos for each hashtag asked, unless told otherwise. */
function tiktok(
  over: { trending?: (category: string) => Response; videos?: (asked: string[]) => Response } = {},
  tags: unknown[] = TAGS,
  edits: Record<string, unknown[]> = {},
) {
  return vi.fn<typeof fetch>(async (input) => {
    const u = new URL(String(input));
    const base = `${u.origin}${u.pathname}`;
    const category = u.searchParams.get("category_name") ?? "";
    if (base === TT_TRENDING_URL)
      return (
        over.trending?.(category) ??
        ok([TT_EFFECTS, TT_PHOTO].includes(category) ? (edits[category] ?? []) : tags)
      );
    if (base === TT_VIDEOS_URL) {
      const asked = JSON.parse(u.searchParams.get("hashtag_ids")!) as string[];
      return (
        over.videos?.(asked) ??
        ok(
          asked.map((id) => ({
            hashtag_id: id,
            hashtag_name: `tag${Number(id) - 1000}`,
            top_video_list: Array.from({ length: 20 }, (_, i) => vid(Number(id) - 1000, i + 1)),
          })),
        )
      );
    }
    return json({ error: "not_found" }, 404);
  });
}
const asked = (fetch: ReturnType<typeof tiktok>, n: number) =>
  new URL(String(fetch.mock.calls[n][0]));
/** The `video_list` call: the last, after the 3 `trending_list` calls. */
const videoCall = (fetch: ReturnType<typeof tiktok>) => asked(fetch, 3);
/** The diagnostics of tier-3 hashtags n…, named car<n>. */
const tier3 = (...n: number[]) => n.map((x) => ({ name: `car${x}`, tier: 3 }));

describe("tiktokTop", () => {
  it("asks the popular hashtags of the category's industry, SPECIAL_EFFECTS and PHOTOGRAPHY in the country over 7 days, then one video_list call, the token in Access-Token", async () => {
    const fetch = tiktok();
    await tiktokTop(env(), fetch, "cars");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(TT_TRENDING_URL).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/discovery/trending_list/",
    );
    expect(TT_VIDEOS_URL).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/discovery/video_list/",
    );
    const trending = asked(fetch, 0);
    expect(`${trending.origin}${trending.pathname}`).toBe(TT_TRENDING_URL);
    // The first advertiser the owner granted.
    expect(Object.fromEntries(trending.searchParams)).toEqual({
      advertiser_id: "adv1",
      discovery_type: "HASHTAG",
      country_code: "US",
      category_name: "AUTOMOTIVE",
      date_range: "7DAY",
    });
    // The 2 edit lists: the same advertiser, country and 7 days.
    expect([TT_EFFECTS, TT_PHOTO]).toEqual(["SPECIAL_EFFECTS", "PHOTOGRAPHY"]);
    for (const [n, category_name] of [
      [1, "SPECIAL_EFFECTS"],
      [2, "PHOTOGRAPHY"],
    ] as const) {
      const u = asked(fetch, n);
      expect(`${u.origin}${u.pathname}`).toBe(TT_TRENDING_URL);
      expect(Object.fromEntries(u.searchParams)).toEqual({
        advertiser_id: "adv1",
        discovery_type: "HASHTAG",
        country_code: "US",
        category_name,
        date_range: "7DAY",
      });
    }
    const videos = videoCall(fetch);
    expect(`${videos.origin}${videos.pathname}`).toBe(TT_VIDEOS_URL);
    // At most 10 hashtags, as a JSON array of strings.
    expect(Object.fromEntries(videos.searchParams)).toEqual({
      advertiser_id: "adv1",
      discovery_type: "HASHTAG",
      hashtag_ids: ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
      country_code: "US",
      date_range: "7DAY",
    });
    for (const [, init] of fetch.mock.calls)
      expect(new Headers(init?.headers).get("Access-Token")).toBe(ACCESS);
  });

  it("names each category's industry (category_name), level 2 where one fits; every built-in category has one", async () => {
    expect(TIKTOK_INDUSTRY).toEqual({
      cars: "AUTOMOTIVE",
      food: "FOOD",
      anime: "ANIMATION_AND_COMICS",
      travel: "GENERAL_TRAVEL",
      football: "CONVENTIONAL_AND_MAINSTREAM_SPORTS",
      coffee: "DRINKS",
      perfume: "BEAUTY",
      camping: "OUTDOOR_RECREATION",
      fashion: "OUTFITS",
      gaming: "VIDEO_GAMES",
      weddings: "ROMANCE",
      gym: "EXERCISE_AND_FITNESS",
    });
    expect(Object.keys(TIKTOK_INDUSTRY).sort()).toEqual(GENRES.map((g) => g.id).sort());
    for (const [id, industry] of Object.entries(TIKTOK_INDUSTRY)) {
      const fetch = tiktok();
      const r = await tiktokTop(env(), fetch, id);
      expect(asked(fetch, 0).searchParams.get("category_name"), id).toBe(industry);
      expect(r.diagnostics).toMatchObject({ industry });
    }
  });

  it("asks in TIKTOK_DISCOVERY_COUNTRY, US unless it is a 2-letter code", async () => {
    const cases: [string | undefined, string][] = [
      [undefined, "US"],
      ["", "US"],
      ["sa", "SA"],
      [" GB ", "GB"],
      ["Saudi", "US"],
    ];
    for (const [value, country] of cases) {
      const fetch = tiktok();
      const r = await tiktokTop(env({ TIKTOK_DISCOVERY_COUNTRY: value }), fetch, "cars");
      expect(fetch.mock.calls.length).toBe(4);
      for (let n = 0; n < 4; n++)
        expect(asked(fetch, n).searchParams.get("country_code"), value).toBe(country);
      expect(r.diagnostics).toMatchObject({ country });
    }
  });

  it("takes the 10 best-ranked hashtags popular in the country; with fewer than 3 there, the others fill in by rank", async () => {
    // 14 hashtags in TikTok's order, ranked as strings ("10" after "9"); ranks 1, 4 and 9 are not popular in the US.
    const order = [7, 1, 14, 3, 9, 2, 12, 5, 4, 13, 6, 11, 8, 10];
    const inUs = (keep: number[]) =>
      order.map((n) => tag(n, keep.includes(n) ? ["US"] : ["GB", "SA"]));
    const videoIds = async (tags: unknown[]) => {
      const fetch = tiktok({}, tags);
      await tiktokTop(env(), fetch, "cars");
      return videoCall(fetch).searchParams.get("hashtag_ids");
    };
    expect(await videoIds(inUs([2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14]))).toBe(
      ids(2, 3, 5, 6, 7, 8, 10, 11, 12, 13),
    );
    // 2 in the US: those first, then the rest by rank, to 10.
    expect(await videoIds(inUs([6, 9]))).toBe(ids(6, 9, 1, 2, 3, 4, 5, 7, 8, 10));
    // 3 in the US are enough: those alone.
    expect(await videoIds(inUs([11, 2, 5]))).toBe(ids(2, 5, 11));
    // A hashtag without an id or a name can't be asked or titled; one without a rank comes last.
    const odd = [
      { ...tag(1), hashtag_name: " " },
      { ...tag(2), hashtag_id: undefined },
      { ...tag(3, ["US"]), rank_position: undefined },
      tag(4, ["US"], "9"),
      tag(5, ["US"], 2),
      "junk",
    ];
    expect(await videoIds(odd)).toBe(ids(5, 4, 3));
  });

  it("round-robins the hashtags' videos in rank order into 50 at most: the 1st of each, then the 2nd…", async () => {
    // video_list answers the hashtags in another order than asked: the rank order stands.
    const fetch = tiktok({
      videos: (asked) =>
        ok(
          [...asked].reverse().map((id) => ({
            hashtag_id: id,
            hashtag_name: "as TikTok names it",
            top_video_list: Array.from({ length: 20 }, (_, i) => vid(Number(id) - 1000, i + 1)),
          })),
        ),
    });
    const r = await tiktokTop(env(), fetch, "cars");
    const tags = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(r.videos).toEqual([1, 2, 3, 4, 5].flatMap((i) => tags.map((t) => top(t, i))));
    expect(r.note).toBeUndefined();
    expect(r.diagnostics).toEqual({
      hashtags: tier3(...tags),
      lists: { industry: 12, effects: 0, photo: 0 },
      videos: 50,
      raw: 200,
      country: "US",
      industry: "AUTOMOTIVE",
    });
  });

  it("a video under two hashtags shows once, in its first place; fewer videos than 50 are all kept", async () => {
    const shared = vid(1, 2);
    const fetch = tiktok(
      {
        videos: () =>
          ok([
            { hashtag_id: "1001", top_video_list: [vid(1, 1), shared] },
            { hashtag_id: "1002", top_video_list: [shared, vid(2, 2), vid(2, 3)] },
            { hashtag_id: "1003", top_video_list: [vid(3, 1)] },
          ]),
      },
      [tag(1), tag(2), tag(3)],
    );
    const r = await tiktokTop(env(), fetch, "cars");
    // Hashtag 2's first video is hashtag 1's second: it keeps hashtag 2's place (the first it reached) and title.
    expect(r.videos).toEqual([
      top(1, 1),
      { ...top(1, 2), title: "#car2" },
      top(3, 1),
      top(2, 2),
      top(2, 3),
    ]);
    expect(r.diagnostics).toMatchObject({ hashtags: tier3(1, 2, 3), videos: 5, raw: 6 });
  });

  it("picks edit hashtags first: tier 1 an edit cue and a subject word, tier 2 an edit cue from SPECIAL_EFFECTS or PHOTOGRAPHY, tier 3 a subject word, tier 4 the industry's others; each by rank, each hashtag once", async () => {
    const food = [
      tag(1, ["US"], "1", "trunkortreat"), // neither: tier 4
      tag(2, ["US"], "2", "foodie"), // tier 3
      tag(3, ["US"], "3", "cinematic"), // an edit cue in the industry's list: tier 4 here, tier 2 below
      tag(4, ["US"], "4", "FoodEdit"), // tier 1
      tag(5, ["US"], "5", "restaurants"), // tier 3
      tag(6, ["US"], "6", "asmrcooking"), // an edit cue, no subject word for Food: tier 4
    ];
    const edits = {
      SPECIAL_EFFECTS: [
        tag(7, ["US"], "3", "transition"), // tier 2
        tag(8, ["US"], "1", "streetfoodbroll"), // tier 1 from the effects list
        tag(3, ["US"], "9", "cinematic"), // #cinematic again: tier 2, once
      ],
      PHOTOGRAPHY: [
        tag(9, ["US"], "1", "photography"), // neither, in an edit list: left out
        tag(10, ["US"], "2", "slowmo"), // tier 2
        tag(2, ["US"], "7", "foodie"), // #foodie again: still tier 3, once
      ],
    };
    const fetch = tiktok({}, food, edits);
    const r = await tiktokTop(env(), fetch, "food");
    expect(videoCall(fetch).searchParams.get("hashtag_ids")).toBe(ids(8, 4, 10, 7, 3, 2, 5, 1, 6));
    expect(r.diagnostics).toMatchObject({
      hashtags: [
        { name: "streetfoodbroll", tier: 1 },
        { name: "FoodEdit", tier: 1 },
        { name: "slowmo", tier: 2 },
        { name: "transition", tier: 2 },
        { name: "cinematic", tier: 2 },
        { name: "foodie", tier: 3 },
        { name: "restaurants", tier: 3 },
        { name: "trunkortreat", tier: 4 },
        { name: "asmrcooking", tier: 4 },
      ],
      lists: { industry: 6, effects: 3, photo: 3 },
      industry: "FOOD",
    });
    // Tier order, then turns: each hashtag's 1st video (tier 1 first, tier 4 last), then its 2nd…
    const order = [8, 4, 10, 7, 3, 2, 5, 1, 6];
    const names = r.diagnostics!.hashtags as { name: string }[];
    expect(r.videos!.slice(0, 9).map((v) => v.title)).toEqual(names.map((h) => `#${h.name}`));
    expect(r.videos!.slice(0, 9).map((v) => v.url)).toEqual(order.map((t) => top(t, 1).url));
    expect(r.videos![9].url).toBe(top(8, 2).url);
  });

  it("keeps the country rule in each tier: 3 or more popular in the country stand alone, fewer fill in by rank", async () => {
    const edits = {
      SPECIAL_EFFECTS: [
        tag(1, ["GB"], "1", "caredit"), // tier 1, not in the US
        tag(2, ["US"], "2", "cinematiccar"), // tier 1, in the US
        tag(3, ["US"], "3", "transition"),
        tag(4, ["US"], "4", "effects"),
        tag(5, ["US"], "5", "edits"),
        tag(6, ["GB"], "6", "montage"), // tier 2, not in the US: 3 there already
      ],
    };
    const fetch = tiktok({}, [tag(7, ["GB"]), tag(8, ["US"])], edits);
    await tiktokTop(env(), fetch, "cars");
    // Tier 1: 1 in the US, so #caredit fills in; tier 2: 3 in the US alone; tier 3: 1 in the US, #car7 fills in.
    expect(videoCall(fetch).searchParams.get("hashtag_ids")).toBe(ids(2, 1, 3, 4, 5, 8, 7));
  });

  it("an edit list failing leaves it out (null in lists); the industry's failing fails the scan", async () => {
    const fetch = tiktok({
      trending: (category) =>
        category === TT_PHOTO ? json({ code: 50002, message: "System error", data: {} }) : ok(TAGS),
    });
    const r = await tiktokTop(env(), fetch, "cars");
    expect(r.note).toBeUndefined();
    expect(r.diagnostics).toMatchObject({ lists: { industry: 12, effects: 12, photo: null } });
    expect(r.videos).toHaveLength(50);
  });

  it("keeps a video only on an https tiktok.com link to one video with its creator's handle, without the query", async () => {
    const links = [
      "https://m.tiktok.com/@ok.one/video/111?_r=1&u_code=x",
      "http://www.tiktok.com/@plain/video/222",
      "https://vm.tiktok.com/ZMabc123/",
      // No handle: the app's player needs one (lib/embed's embedId), so no "/@/video/<id>" is made up.
      "https://www.tiktok.com/@/video/333",
      "https://www.tiktok.com/video/444",
      "https://www.tiktok.com/@user/photo/555",
      "https://tiktok.com.evil.example/@user/video/666",
      "not a link",
      undefined,
    ];
    const fetch = tiktok(
      {
        videos: () =>
          ok([
            {
              hashtag_id: "1001",
              top_video_list: links.map((share_url, i) => ({ video_id: `9${i}`, share_url })),
            },
          ]),
      },
      [tag(1)],
    );
    const r = await tiktokTop(env(), fetch, "cars");
    expect(r.videos).toEqual([
      { url: "https://www.tiktok.com/@ok.one/video/111", title: "#car1", creator: "@ok.one" },
    ]);
    expect(r.diagnostics).toMatchObject({ videos: 1, raw: links.length });
  });

  it("no popular hashtag: no video_list call, an empty list", async () => {
    const fetch = tiktok({}, []);
    expect(await tiktokTop(env(), fetch, "food")).toEqual({
      videos: [],
      diagnostics: {
        hashtags: [],
        lists: { industry: 0, effects: 0, photo: 0 },
        videos: 0,
        raw: 0,
        country: "US",
        industry: "FOOD",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("no subject or edit word in any list: the industry's 10 best by rank (the old rule), all tier 4, so the tab is never thin", async () => {
    // Food's tags are car1…car12 (no Food word, no edit cue); the edit lists hold none with an edit cue either.
    const edits = {
      SPECIAL_EFFECTS: [tag(20, ["US"], "1", "halloween")],
      PHOTOGRAPHY: [tag(21, ["US"], "1", "sunset")],
    };
    const fetch = tiktok({}, TAGS, edits);
    const r = await tiktokTop(env(), fetch, "food");
    expect(videoCall(fetch).searchParams.get("hashtag_ids")).toBe(
      ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
    );
    expect(r.diagnostics).toMatchObject({
      hashtags: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ name: `car${n}`, tier: 4 })),
    });
    expect(r.videos).toHaveLength(50);
  });

  it("not connected (no token, one sealed with another SCOUT_TOKEN, or no advertiser): nothing asked, noted tiktok_auth", async () => {
    const noAdvertiser = await encryptJson(SCOUT, {
      access_token: ACCESS,
      advertiser_ids: [],
      connectedAt: "2026-10-07T09:00:00.000Z",
    });
    for (const e of [
      env({ SOCIAL_KV: kv(null) }),
      env({ SCOUT_TOKEN: "rotated" }),
      env({ SOCIAL_KV: kv(noAdvertiser) }),
      env({ SOCIAL_KV: undefined }),
    ]) {
      const fetch = tiktok();
      expect(await tiktokTop(e, fetch, "cars")).toEqual({ note: "tiktok_auth" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("TikTok's error code, an HTTP failure or no answer: noted tiktok with its code and message (≤ 120 characters, never the token)", async () => {
    const long = `Access token ${ACCESS} is invalid or has been revoked. ${"x".repeat(200)}`;
    const cases: [Parameters<typeof tiktok>[0], Record<string, unknown>, number][] = [
      [{ trending: () => json({ code: 40105, message: long, data: {} }) }, { code: 40105 }, 3],
      [
        { videos: () => json({ code: 50002, message: "System error", data: {} }) },
        { code: 50002, message: "System error" },
        4,
      ],
      [
        { trending: () => json({ message: "bad gateway" }, 502) },
        { code: 502, message: "HTTP 502" },
        3,
      ],
      [
        { trending: () => new Response("<html>", { status: 200 }) },
        { code: 200, message: "HTTP 200" },
        3,
      ],
      [
        {
          trending: () => {
            throw new Error("network");
          },
        },
        { code: 0, message: "no answer" },
        3,
      ],
    ];
    for (const [over, diagnostics, calls] of cases) {
      const fetch = tiktok(over);
      const r = await tiktokTop(env(), fetch, "cars");
      expect(r.note).toBe("tiktok");
      expect(r.videos).toBeUndefined();
      expect(r.diagnostics).toMatchObject(diagnostics);
      expect(String(r.diagnostics!.message).length).toBeLessThanOrEqual(120);
      expect(JSON.stringify(r)).not.toContain(ACCESS);
      expect(fetch).toHaveBeenCalledTimes(calls);
    }
  });

  it("never throws: a token KV can't read is noted tiktok, nothing asked", async () => {
    const broken = {
      get: vi.fn(async () => {
        throw new Error("KV down");
      }),
    } as unknown as KVNamespace;
    const fetch = tiktok();
    expect(await tiktokTop(env({ SOCIAL_KV: broken }), fetch, "cars")).toEqual({
      note: "tiktok",
      diagnostics: { code: 0, message: "KV down" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
