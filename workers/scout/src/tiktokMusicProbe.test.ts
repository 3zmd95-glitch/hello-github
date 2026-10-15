import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "./scout";
import { encryptJson } from "./social/crypto";
import { TT_CML_TRENDING_URL } from "./tiktokMusicProbe";

// GET /tiktokads/music-probe through the Worker's router. Every value here is fake.

const SCOUT = "scout-token";
const ACCESS = "fake-access-token";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-15T13:40:00Z");
const TOKEN = await encryptJson(SCOUT, {
  access_token: ACCESS,
  advertiser_ids: ["adv1"],
  connectedAt: "2026-10-07T09:00:00.000Z",
});

const kv = (token: string | null = TOKEN) => {
  const put = vi.fn();
  return {
    put,
    kv: {
      get: vi.fn(async (key: string) => (key === "tiktokads:token" ? token : null)),
      put,
      delete: vi.fn(),
    } as unknown as KVNamespace,
  };
};
const env = (k = kv().kv): Env => ({ SCOUT_TOKEN: SCOUT, SOCIAL_KV: k });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const probe = (e: Env, fetch: typeof globalThis.fetch, query = "", token: string | null = SCOUT) =>
  handle(
    new Request(`${BASE}/tiktokads/music-probe${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    e,
    undefined,
    { fetch, now: () => NOW },
  );

const TRACK = {
  commercial_music_id: "777",
  commercial_music_name: "Song A",
  artist: "Artist A",
  rank_position: "1",
  genres: ["Pop"],
  preview_url: "https://p16.example/preview.mp3",
  trending_history: Array.from({ length: 10 }, (_, i) => ({
    date: `2026-10-0${i}`,
    rank_position_daily: "1",
  })),
  trending_song_clip: {
    song_clip_id: "888",
    duration: 30,
    preview_url: "https://p16.example/c.mp3",
  },
};

describe("GET /tiktokads/music-probe", () => {
  it("asks the 4 attempts with the stored token, shows each answer, writes nothing and never echoes the token", async () => {
    const k = kv();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const u = new URL(String(input));
      if (u.href.startsWith(TT_CML_TRENDING_URL))
        return json({ code: 0, message: "OK", data: { list: Array(12).fill(TRACK) } });
      const type = u.searchParams.get("discovery_type");
      if (type === "HASHTAG")
        return json({
          code: 0,
          message: "OK",
          data: { list: [{ hashtag_id: 5, hashtag_name: "newsong", rank_position: "2" }] },
        });
      return json({ code: 40002, message: `discovery_type invalid ${ACCESS}` });
    });
    const res = await probe(env(k.kv), fetch, "?country=sa&range=30");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain("adv1");
    const body = JSON.parse(text);
    expect(body).toMatchObject({ country: "SA", dateRange: "30DAY", fetchedAt: NOW.toISOString() });
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [, init] of fetch.mock.calls)
      expect((init?.headers as Record<string, string>)["Access-Token"]).toBe(ACCESS);
    const urls = fetch.mock.calls.map(([u]) => new URL(String(u)));
    expect(urls[0].searchParams.get("business_id")).toBe("adv1");
    expect(
      urls.every(
        (u) =>
          u.searchParams.get("country_code") === "SA" &&
          u.searchParams.get("date_range") === "30DAY",
      ),
    ).toBe(true);
    expect(urls.slice(1).map((u) => u.searchParams.get("discovery_type"))).toEqual([
      "MUSIC",
      "SONG",
      "HASHTAG",
    ]);
    expect(urls[3].searchParams.get("category_name")).toBe("MUSIC");

    const [cml, music, song, tags] = body.attempts;
    expect(cml).toMatchObject({ name: "cml_trending_list", status: 200, code: 0, count: 12 });
    expect(cml.params.business_id).toBe("<advertiser_id>");
    expect(cml.items).toHaveLength(10);
    expect(cml.items[0]).toMatchObject({
      rank: "1",
      title: "Song A",
      artist: "Artist A",
      id: "777",
      trendingClipId: "888",
      previewUrl: "https://p16.example/preview.mp3",
    });
    expect(cml.items[0].history).toHaveLength(7);
    expect(music).toMatchObject({
      code: 40002,
      count: 0,
      items: [],
      message: "discovery_type invalid …",
    });
    expect(song.name).toBe("trending_list_SONG");
    expect(tags.items[0]).toMatchObject({ title: "newsong", id: "5", rank: "2" });
    expect(k.put).not.toHaveBeenCalled();
  });

  it("a TikTok failure or no answer is data: its code, message or HTTP status", async () => {
    let n = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      n++;
      if (n === 1)
        return json({ code: 40105, message: "Access token is incorrect or has been revoked." });
      if (n === 2) return new Response("down", { status: 503 });
      throw new Error("network");
    });
    const res = await probe(env(), fetch);
    expect(res.status).toBe(200);
    const { attempts, dateRange, country } = await res.json<{
      attempts: Record<string, unknown>[];
      dateRange: string;
      country: string;
    }>();
    expect([country, dateRange]).toEqual(["US", "7DAY"]);
    expect(attempts[0]).toMatchObject({ status: 200, code: 40105, count: 0 });
    expect(attempts[1]).toMatchObject({ status: 503, code: null, message: null });
    expect(attempts[2]).toMatchObject({ status: 0, code: null });
  });

  it("not connected (no token, one sealed with another SCOUT_TOKEN): 409 not_connected, nothing asked", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const other = await encryptJson("another", { access_token: ACCESS, advertiser_ids: ["adv1"] });
    for (const k of [kv(null), kv(other)]) {
      const res = await probe(env(k.kv), fetch);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "not_connected" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("needs the bearer, and only SA|US and 7|30", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect((await probe(env(), fetch, "", null)).status).toBe(401);
    expect((await probe(env(), fetch, "", "wrong")).status).toBe(401);
    expect((await probe(env(), fetch, "?country=GB")).status).toBe(400);
    expect((await probe(env(), fetch, "?range=90")).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
