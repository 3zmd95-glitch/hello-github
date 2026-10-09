import { describe, expect, it, vi } from "vitest";
import { encryptJson } from "../social/crypto";
import { GENRES } from "../trends/genres";
import {
  TIKTOK_CAPTION_MAX,
  TIKTOK_INDUSTRY,
  tiktokTop,
  TT_EFFECTS,
  TT_PHOTO,
  TT_TRENDING_URL,
  TT_VIDEOS_URL,
} from "./tiktok";

const SCOUT = "test-scout";
const ACCESS = "fake-business-token";
const TOKEN = await encryptJson(SCOUT, {
  access_token: ACCESS,
  advertiser_ids: ["adv1"],
  connectedAt: "2026-10-07T00:00:00Z",
});
const kv = (token: string | null = TOKEN) =>
  ({ get: vi.fn(async () => token) }) as unknown as KVNamespace;
const env = (over: Record<string, unknown> = {}) => ({
  SOCIAL_KV: kv(),
  SCOUT_TOKEN: SCOUT,
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ok = (list: unknown[]) => json({ code: 0, data: { list } });
const tag = (id: string, name: string, rank = 1) => ({
  hashtag_id: id,
  hashtag_name: name,
  rank_position: rank,
  top_country_list: ["US"],
});
const vid = (id: string, handle = `creator${id}`) => ({
  video_id: id,
  share_url: `https://www.tiktok.com/@${handle}/video/${id}?lang=en`,
});
type Overrides = {
  tags?: unknown[];
  effects?: unknown[];
  photo?: unknown[];
  trending?: (category: string) => Response;
  videos?: (ids: string[]) => Response;
  caption?: (url: URL) => Response;
};
function network(over: Overrides = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const u = new URL(String(input));
    const base = `${u.origin}${u.pathname}`;
    if (base === TT_TRENDING_URL) {
      const category = u.searchParams.get("category_name")!;
      return (
        over.trending?.(category) ??
        ok(
          category === TT_EFFECTS
            ? (over.effects ?? [])
            : category === TT_PHOTO
              ? (over.photo ?? [])
              : (over.tags ?? [tag("1", "foodedit")]),
        )
      );
    }
    if (base === TT_VIDEOS_URL) {
      const ids = JSON.parse(u.searchParams.get("hashtag_ids")!) as string[];
      return (
        over.videos?.(ids) ??
        ok(ids.map((id) => ({ hashtag_id: id, top_video_list: [vid(id + "01"), vid(id + "02")] })))
      );
    }
    if (base === "https://www.tiktok.com/oembed")
      return (
        over.caption?.(new URL(u.searchParams.get("url")!)) ??
        json({
          title: "Food cinematic speed ramp commercial",
          thumbnail_url: "https://cdn.example/thumbnail.jpg",
        })
      );
    return json({}, 404);
  });
}

describe("caption-grounded TikTok category discovery", () => {
  it("covers every built-in category with an official industry", () =>
    expect(Object.keys(TIKTOK_INDUSTRY).sort()).toEqual(GENRES.map((g) => g.id).sort()));
  it("requires real captions, records metadata provenance and never sends the Business token to public oEmbed", async () => {
    const fetch = network();
    const result = await tiktokTop(env(), fetch, "food", 1000, null);
    expect(result.videos).toHaveLength(2);
    expect(result.videos![0]).toMatchObject({
      title: "Food cinematic speed ramp commercial",
      source: "tiktok-discovery",
      evidence: { basis: "metadata", subjects: ["food"] },
      thumbnail: "https://cdn.example/thumbnail.jpg",
    });
    for (const [url, init] of fetch.mock.calls)
      expect(new Headers(init?.headers).get("Access-Token")).toBe(
        String(url).startsWith("https://business-api.tiktok.com/") ? ACCESS : null,
      );
    expect(JSON.stringify(result)).not.toContain(ACCESS);
  });
  it("never recommends a category hashtag without a useful creative caption", async () => {
    const fetch = network({
      tags: [tag("1", "food")],
      caption: (url) =>
        json({
          title: url.pathname.endsWith("101")
            ? "literally me around food #pov #viral"
            : "Food processors commercial product review",
        }),
    });
    const result = await tiktokTop(env(), fetch, "food", 1000, null);
    expect(result.videos).toEqual([]);
    expect(result.note).toBeUndefined();
    expect(result.diagnostics).toMatchObject({ captioned: 2, videos: 0 });
  });
  it("does not fill Food with unrelated car edits or generic industry hashtags", async () => {
    const fetch = network({
      tags: [tag("1", "trunkortreat"), tag("2", "foodprices")],
      effects: [tag("3", "caredit"), tag("4", "capcut")],
      photo: [tag("5", "screenshot")],
    });
    expect((await tiktokTop(env(), fetch, "food", 1000, null)).videos).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("checks at most12 unique captions and ranks specific metadata instead of hashtag order", async () => {
    const fetch = network({
      videos: () =>
        ok([
          {
            hashtag_id: "1",
            top_video_list: [
              vid("1"),
              vid("1"),
              ...Array.from({ length: 30 }, (_, i) => vid(String(i + 2))),
            ],
          },
        ]),
      caption: (url) =>
        json({
          title: url.pathname.endsWith("/2")
            ? "Food cinematic match cut speed ramp commercial"
            : "Food edit",
        }),
    });
    const result = await tiktokTop(env(), fetch, "food", 1000, null);
    expect(result.diagnostics).toMatchObject({ captionCandidates: TIKTOK_CAPTION_MAX });
    expect(
      fetch.mock.calls.filter(([u]) => String(u).startsWith("https://www.tiktok.com/oembed")),
    ).toHaveLength(TIKTOK_CAPTION_MAX);
    // Reading twelve captions does not promise twelve recommendations: the other eleven only say "Food edit".
    expect(result.videos).toHaveLength(1);
    expect(result.videos![0].url.endsWith("/2")).toBe(true);
  });
  it("considers multiple hashtags and caps repeated creators at3", async () => {
    const fetch = network({
      tags: [tag("1", "foodedit"), tag("2", "food")],
      videos: () =>
        ok([
          { hashtag_id: "2", top_video_list: [vid("201", "other")] },
          { hashtag_id: "1", top_video_list: [1, 2, 3, 4, 5].map((n) => vid(String(n), "same")) },
        ]),
    });
    expect(
      (await tiktokTop(env(), fetch, "food", 1000, null)).videos?.map((v) => v.creator),
    ).toEqual(["@same", "@other", "@same", "@same"]);
  });
  it("limits concurrent public caption requests to three", async () => {
    const fake = network({
      videos: () =>
        ok([
          {
            hashtag_id: "1",
            top_video_list: Array.from({ length: 20 }, (_, i) => vid(String(i + 1))),
          },
        ]),
    });
    let active = 0;
    let peak = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (!String(input).includes("/oembed")) return fake(input, init);
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await fake(input, init);
      } finally {
        active--;
      }
    });
    await tiktokTop(env(), fetch, "food", 1000, null);
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });
  it("rejects malformed, offsite, photo, short and non-playable URLs before oEmbed", async () => {
    const links = [
      "http://www.tiktok.com/@a/video/1",
      "https://evil.test/@a/video/1",
      "https://www.tiktok.com/@a/photo/1",
      "https://vm.tiktok.com/123",
      "https://www.tiktok.com/video/1",
      "https://www.tiktok.com/@/video/1",
    ];
    const fetch = network({
      videos: () =>
        ok([{ hashtag_id: "1", top_video_list: links.map((share_url) => ({ share_url })) }]),
    });
    expect((await tiktokTop(env(), fetch, "food", 1000, null)).videos).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("uses valid country codes and defaults to US, prioritizing category-specific creative tags", async () => {
    for (const [given, expected] of [
      [" sa ", "SA"],
      ["not-a-country", "US"],
    ]) {
      const fetch = network({ tags: [tag("1", "food", 1), tag("2", "foodedit", 9)] });
      await tiktokTop(env({ TIKTOK_DISCOVERY_COUNTRY: given }), fetch, "food", 1000, null);
      const api = fetch.mock.calls.filter(([u]) => String(u).includes("business-api"));
      expect(
        api.every(([u]) => new URL(String(u)).searchParams.get("country_code") === expected),
      ).toBe(true);
      expect(new URL(String(api.at(-1)![0])).searchParams.get("hashtag_ids")).toBe('["2","1"]');
    }
  });
  it("reuses the normalized public oEmbed cache and saves new captions in that format", async () => {
    const cache = {
      match: vi.fn(async (req: Request) =>
        req.url.includes("101")
          ? json({
              title: "Food match cut commercial",
              author: "@cached",
              thumb: "https://cdn.example/cached.jpg",
              url: "https://www.tiktok.com/@creator101/video/101",
            })
          : undefined,
      ),
      put: vi.fn(async () => {}),
    } as unknown as Cache;
    const fetch = network();
    expect((await tiktokTop(env(), fetch, "food", 1000, cache)).videos).toHaveLength(2);
    expect(fetch.mock.calls.filter(([u]) => String(u).includes("/oembed"))).toHaveLength(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const response = (cache.put as ReturnType<typeof vi.fn>).mock.calls[0][1] as Response;
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=21600");
    expect(await response.json()).toMatchObject({
      title: "Food cinematic speed ramp commercial",
      url: "https://www.tiktok.com/@creator102/video/102",
    });
  });
  it("excludes missing or malformed captions without inventing captions", async () => {
    for (const caption of [
      () => json({}, 404),
      () => json({ title: 42 }),
      () => new Response("<html>"),
      () => {
        throw new Error("offline");
      },
    ])
      expect((await tiktokTop(env(), network({ caption }), "food", 1000, null)).videos).toEqual([]);
  });
  it("handles edit-list failures independently when the industry supplies candidates", async () => {
    const fetch = network({
      trending: (category) =>
        [TT_EFFECTS, TT_PHOTO].includes(category) ? json({}, 500) : ok([tag("1", "food")]),
    });
    expect((await tiktokTop(env(), fetch, "food", 1000, null)).videos).toHaveLength(2);
  });
  it("makes no calls without a usable token and advertiser", async () => {
    const noAdvertiser = await encryptJson(SCOUT, {
      access_token: ACCESS,
      advertiser_ids: [],
      connectedAt: "2026-10-07T00:00:00Z",
    });
    for (const e of [
      env({ SOCIAL_KV: kv(null) }),
      env({ SCOUT_TOKEN: "rotated" }),
      env({ SOCIAL_KV: kv(noAdvertiser) }),
      env({ SOCIAL_KV: undefined }),
    ]) {
      const fetch = network();
      expect(await tiktokTop(e, fetch, "food", 1000, null)).toEqual({ note: "tiktok_auth" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it("sanitizes API errors and distinguishes them from connected empty results", async () => {
    for (const over of [
      { trending: () => json({ code: 40105, message: `Token ${ACCESS} ${"x".repeat(200)}` }) },
      { videos: () => json({}, 502) },
    ]) {
      const result = await tiktokTop(env(), network(over), "food", 1000, null);
      expect(result.note).toBe("tiktok");
      expect(result.videos).toBeUndefined();
      expect(String(result.diagnostics?.message).length).toBeLessThanOrEqual(120);
      expect(JSON.stringify(result)).not.toContain(ACCESS);
    }
  });
  it("never throws when token storage fails", async () => {
    const fetch = network();
    const broken = {
      get: async () => {
        throw new Error("KV down");
      },
    } as unknown as KVNamespace;
    expect(await tiktokTop(env({ SOCIAL_KV: broken }), fetch, "food", 1000, null)).toMatchObject({
      note: "tiktok",
      diagnostics: { message: "KV down" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
