/**
 * TikTok hashtag trends for SA and US (scout 02, planning/tools/08-trends.md): the Discovery API's
 * `trending_list` per region and industry, the merge by rank, the stoplist, the proof videos with the dates their
 * own ids carry, the partial-failure rules and the daily slot's budget. Mocked fetch + in-memory KV; every value
 * is fake, and no test prints the token.
 */

import { describe, expect, it, vi } from "vitest";
import { TT_TRENDING_URL, TT_VIDEOS_URL } from "../categories/tiktok";
import { tiktokIdAt } from "../postDate";
import { Budget } from "../social/http";
import { encryptJson } from "../social/crypto";
import { runTrends, SOURCES, enabledSources } from "./run";
import { latestFeed } from "./kv";
import {
  runTikTokTags,
  TIKTOK_PROOF_TAGS,
  TIKTOK_PROOF_VIDEOS,
  TIKTOK_TAGS_PER_REGION,
} from "./tiktokTags";
import { SOURCE_LABELS, type SourceCtx, type TrendItem, type TrendsEnv } from "./types";

const SCOUT = "s3cret-token";
const ACCESS = "fake-business-access-token";
/** 2026-10-23 12:00 Riyadh (a Friday). */
const NOW = new Date("2026-10-23T09:00:00Z");
const DAY = 86_400_000;
const TOKEN = await encryptJson(SCOUT, {
  access_token: ACCESS,
  advertiser_ids: ["adv1"],
  connectedAt: "2026-10-07T00:00:00.000Z",
});

function fakeKV(token: string | null = TOKEN) {
  const store = new Map<string, string>();
  const kv = {
    store,
    writes: 0,
    reads: 0,
    async get(key: string) {
      kv.reads += 1;
      return key === "tiktokads:token" ? token : (store.get(key) ?? null);
    },
    async put(key: string, value: string) {
      kv.writes += 1;
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return kv as unknown as KVNamespace & { store: Map<string, string>; writes: number };
}

const env = (kv: KVNamespace | undefined = fakeKV()): TrendsEnv => ({
  SCOUT_TOKEN: SCOUT,
  SOCIAL_KV: kv,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ok = (list: unknown[]) => json({ code: 0, message: "OK", data: { list } });

const tag = (id: number, name: string, rank: number, countries = ["SA", "US"]) => ({
  hashtag_id: String(id),
  hashtag_name: name,
  rank_position: rank,
  top_country_list: countries,
});

/** A TikTok video the way `video_list` sends it: a share link with the creator and the id. */
const video = (n: number, at: Date, handle = `creator${n}`) => {
  const id = tiktokIdAt(at, n);
  return { video_id: id, share_url: `https://www.tiktok.com/@${handle}/video/${id}?lang=en` };
};

type Region = "SA" | "US";
interface Answers {
  /** The `trending_list` answer for a region and industry. */
  lists?: (region: Region, industry: string) => Response;
  /** The `video_list` answer for a region and its asked hashtag ids. */
  videos?: (region: Region, ids: string[]) => Response;
}

/** Default: two hashtags per industry (ranks 1-2), the same `#shared` ranked 3rd in MUSIC and 2nd in PHOTOGRAPHY. */
const DEFAULT_LISTS: Record<string, unknown[]> = {
  SPECIAL_EFFECTS: [tag(11, "velocityedit", 1), tag(12, "fyp", 2), tag(13, "greenscreen", 3)],
  PHOTOGRAPHY: [tag(21, "cinematic", 1), tag(99, "shared", 2)],
  MUSIC: [tag(31, "newsong", 1), tag(32, "أغنية_جديدة", 2), tag(99, "shared", 3)],
};

function discovery(over: Answers = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const u = new URL(String(input));
    const base = `${u.origin}${u.pathname}`;
    const region = u.searchParams.get("country_code") as Region;
    if (base === TT_TRENDING_URL) {
      const industry = u.searchParams.get("category_name")!;
      return over.lists?.(region, industry) ?? ok(DEFAULT_LISTS[industry] ?? []);
    }
    if (base === TT_VIDEOS_URL) {
      const ids = JSON.parse(u.searchParams.get("hashtag_ids")!) as string[];
      return (
        over.videos?.(region, ids) ??
        ok(
          ids.map((id) => ({
            hashtag_id: id,
            top_video_list: [
              video(Number(id) * 10 + 1, new Date(NOW.getTime() - 2 * DAY)),
              video(Number(id) * 10 + 2, new Date(NOW.getTime() - 5 * DAY)),
            ],
          })),
        )
      );
    }
    return new Response("nope", { status: 404 });
  });
}

const ctx = (
  fetchImpl: typeof fetch,
  over: Omit<Partial<SourceCtx>, "budget" | "env"> & { budget?: number; env?: TrendsEnv } = {},
): SourceCtx => ({
  env: over.env ?? env(),
  fetch: fetchImpl,
  budget: new Budget(over.budget ?? 38),
  now: NOW,
  ...(over.previous ? { previous: over.previous } : {}),
});

const calls = (f: ReturnType<typeof discovery>) => f.mock.calls.map(([i]) => new URL(String(i)));
const rows = (out: Awaited<ReturnType<typeof runTikTokTags>>): TrendItem[] =>
  out.ok ? out.items : [];

describe("runTikTokTags", () => {
  it("is not_configured (and spends nothing) without a connected TikTok for Business token", async () => {
    const f = discovery();
    expect(await runTikTokTags(ctx(f, { env: env(fakeKV(null)) }))).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(await runTikTokTags(ctx(f, { env: { SCOUT_TOKEN: SCOUT } }))).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("asks SA and US, three industries each, over 7 days, plus one proof call per region (8 calls)", async () => {
    const f = discovery();
    const budget = new Budget(38);
    const out = await runTikTokTags({ ...ctx(f), budget });
    expect(out.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(8);
    expect(budget.left).toBe(30);

    const lists = calls(f).filter((u) => u.pathname.endsWith("/trending_list/"));
    expect(
      lists.map((u) => [u.searchParams.get("country_code"), u.searchParams.get("category_name")]),
    ).toEqual(
      expect.arrayContaining(
        ["SA", "US"].flatMap((c) => ["SPECIAL_EFFECTS", "PHOTOGRAPHY", "MUSIC"].map((i) => [c, i])),
      ),
    );
    for (const u of lists) {
      expect(u.searchParams.get("discovery_type")).toBe("HASHTAG");
      expect(u.searchParams.get("date_range")).toBe("7DAY");
      expect(u.searchParams.get("advertiser_id")).toBe("adv1");
    }
    for (const [, init] of f.mock.calls)
      expect((init?.headers as Record<string, string>)["Access-Token"]).toBe(ACCESS);
    const proofs = calls(f).filter((u) => u.pathname.endsWith("/video_list/"));
    expect(proofs.map((u) => u.searchParams.get("country_code")).sort()).toEqual(["SA", "US"]);
    for (const u of proofs) {
      expect(u.searchParams.get("discovery_type")).toBe("HASHTAG");
      expect(u.searchParams.get("date_range")).toBe("7DAY");
      expect(JSON.parse(u.searchParams.get("hashtag_ids")!).length).toBeLessThanOrEqual(10);
    }
  });

  it("makes hashtag rows: SA is the Arabic tab, US the English one, merged by rank, junk and duplicates out", async () => {
    const out = await runTikTokTags(ctx(discovery()));
    const sa = rows(out).filter((i) => i.region === "SA");
    const us = rows(out).filter((i) => i.region === "US");
    // fyp is on the stoplist; "shared" is in two lists and shows once, with both industries.
    expect(sa.map((i) => i.title)).toEqual([
      "#velocityedit",
      "#cinematic",
      "#newsong",
      "#shared",
      "#أغنية_جديدة",
      "#greenscreen",
    ]);
    expect(us).toHaveLength(sa.length);
    expect(sa[0]).toMatchObject({
      id: "tiktok:SA:tag-velocityedit",
      platform: "tiktok",
      region: "SA",
      lang: "ar",
      source: "TikTok Discovery",
      kind: "hashtag",
      periodDays: 7,
      url: "https://www.tiktok.com/tag/velocityedit",
      score: 100,
      seenAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 2 * DAY).toISOString(),
      tags: ["special-effects"],
    });
    expect(us[0]).toMatchObject({ id: "tiktok:US:tag-velocityedit", lang: "en", region: "US" });
    expect(sa.find((i) => i.title === "#shared")?.tags).toEqual(["photography", "music"]);
    expect(sa.find((i) => i.title === "#أغنية_جديدة")?.url).toBe(
      `https://www.tiktok.com/tag/${encodeURIComponent("أغنية_جديدة")}`,
    );
    // Scores fall with the merged rank, rank 1 = 100.
    const scores = sa.map((i) => i.score!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.at(-1)).toBeGreaterThan(0);
    expect(SOURCE_LABELS.tiktok).toBe("TikTok Discovery");
  });

  it("keeps at most 15 hashtags a region", async () => {
    const many = Array.from({ length: 40 }, (_, i) => tag(1000 + i, `tag${i}`, i + 1));
    const out = await runTikTokTags(
      ctx(discovery({ lists: (_r, industry) => ok(industry === "MUSIC" ? many : []) })),
    );
    expect(TIKTOK_TAGS_PER_REGION).toBe(15);
    expect(rows(out).filter((i) => i.region === "SA")).toHaveLength(15);
    expect(rows(out).filter((i) => i.region === "SA")[14].title).toBe("#tag14");
  });

  it("shows the top videos of the first hashtags with the date their own ids carry, newest facts only from TikTok", async () => {
    const at = new Date(NOW.getTime() - 3 * DAY);
    const out = await runTikTokTags(
      ctx(
        discovery({
          videos: (_r, ids) =>
            ok(
              ids.map((id) => ({
                hashtag_id: id,
                top_video_list: [
                  video(1, at, "alice"),
                  { video_id: "5", share_url: "https://evil.example/@x/video/5" },
                  { share_url: "https://www.tiktok.com/video/123" },
                  video(2, new Date(at.getTime() - DAY), "bob"),
                  video(3, new Date(at.getTime() - 2 * DAY), "carol"),
                  video(4, new Date(at.getTime() - 3 * DAY), "dave"),
                ],
              })),
            ),
        }),
      ),
    );
    const first = rows(out).find((i) => i.id === "tiktok:SA:tag-velocityedit")!;
    expect(TIKTOK_PROOF_VIDEOS).toBe(3);
    expect(first.proof).toHaveLength(3);
    expect(first.proof![0]).toEqual({
      url: `https://www.tiktok.com/@alice/video/${tiktokIdAt(at, 1)}`,
      creator: "@alice",
      postedAt: at.toISOString().replace(/\.\d+Z$/, ".000Z"),
    });
    expect(first.proof!.map((p) => p.creator)).toEqual(["@alice", "@bob", "@carol"]);
    // Only the first 10 get a proof call; the 11th hashtag has none.
    expect(TIKTOK_PROOF_TAGS).toBe(10);
  });

  it("asks videos only for hashtags that are top in that country, at most 10", async () => {
    const lists = Array.from({ length: 14 }, (_, i) =>
      tag(2000 + i, `t${i}`, i + 1, i === 1 ? ["US"] : ["SA", "US"]),
    );
    const f = discovery({ lists: (_r, industry) => ok(industry === "MUSIC" ? lists : []) });
    const out = await runTikTokTags(ctx(f));
    const sa = calls(f).find(
      (u) => u.pathname.endsWith("/video_list/") && u.searchParams.get("country_code") === "SA",
    )!;
    const asked = JSON.parse(sa.searchParams.get("hashtag_ids")!) as string[];
    expect(asked).toHaveLength(10);
    expect(asked).not.toContain("2001");
    expect(rows(out).find((i) => i.title === "#t1" && i.region === "SA")?.proof).toBeUndefined();
    // The row itself stays: the country's own list ranks it.
    expect(rows(out).some((i) => i.title === "#t1" && i.region === "SA")).toBe(true);
  });

  it("a region whose lists fail keeps its previous rows and marks the run partial; the other region is fresh", async () => {
    const old: TrendItem = {
      id: "tiktok:SA:tag-old",
      platform: "tiktok",
      region: "SA",
      lang: "ar",
      title: "#old",
      source: SOURCE_LABELS.tiktok,
      seenAt: "2026-10-22T09:00:00.000Z",
      tags: [],
      kind: "hashtag",
    };
    const other: TrendItem = { ...old, id: "google:SA:x", source: SOURCE_LABELS.google };
    const out = await runTikTokTags(
      ctx(
        discovery({
          lists: (region, industry) =>
            region === "SA"
              ? json({ code: 40002, message: `bad request ${ACCESS}` })
              : ok(DEFAULT_LISTS[industry]),
        }),
        { previous: [old, other] },
      ),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.degraded).toBe(true);
    expect(out.note).toContain("SA");
    expect(out.note).toContain("40002");
    expect(out.note).not.toContain(ACCESS);
    expect(out.items.filter((i) => i.region === "SA").map((i) => i.id)).toEqual([old.id]);
    expect(out.items.filter((i) => i.region === "US").length).toBeGreaterThan(0);
  });

  it("does not carry a failed region's expired rows forward: they end at their own expiry", async () => {
    const gone: TrendItem = {
      id: "tiktok:SA:tag-gone",
      platform: "tiktok",
      region: "SA",
      lang: "ar",
      title: "#gone",
      source: SOURCE_LABELS.tiktok,
      seenAt: "2026-10-18T09:00:00.000Z",
      expiresAt: "2026-10-20T09:00:00.000Z",
      tags: [],
      kind: "hashtag",
    };
    const alive: TrendItem = {
      ...gone,
      id: "tiktok:SA:tag-alive",
      expiresAt: "2026-10-24T09:00:00.000Z",
    };
    const out = await runTikTokTags(
      ctx(
        discovery({
          lists: (region, industry) =>
            region === "SA" ? json({ code: 40002, message: "no" }) : ok(DEFAULT_LISTS[industry]),
        }),
        { previous: [gone, alive] },
      ),
    );
    expect(
      rows(out)
        .filter((i) => i.region === "SA")
        .map((i) => i.id),
    ).toEqual([alive.id]);
  });

  it("an empty SA list is a failure of SA, not an empty region", async () => {
    const out = await runTikTokTags(
      ctx(
        discovery({
          lists: (region, industry) => ok(region === "SA" ? [] : DEFAULT_LISTS[industry]),
        }),
      ),
    );
    expect(out.ok && out.degraded).toBe(true);
    expect(out.ok && out.note).toContain("SA: no hashtags");
    expect(rows(out).filter((i) => i.region === "SA")).toEqual([]);
  });

  it("fails (and never leaks the token) when both regions fail", async () => {
    const out = await runTikTokTags(
      ctx(discovery({ lists: () => json({ code: 40105, message: `revoked ${ACCESS}` }) })),
    );
    expect(out.ok).toBe(false);
    const text = JSON.stringify(out);
    expect(text).toContain("40105");
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain("adv1");
  });

  it("rows still show when the proof call fails; the run is partial and says so", async () => {
    const out = await runTikTokTags(
      ctx(discovery({ videos: () => json({ code: 40002, message: "no" }) })),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.degraded).toBe(true);
    expect(out.note).toContain("videos");
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items.every((i) => i.proof === undefined)).toBe(true);
  });

  it("one failed industry list leaves the others' rows", async () => {
    const out = await runTikTokTags(
      ctx(
        discovery({
          lists: (_r, industry) =>
            industry === "MUSIC"
              ? new Response("down", { status: 503 })
              : ok(DEFAULT_LISTS[industry]),
        }),
      ),
    );
    expect(out.ok && out.degraded).toBe(true);
    expect(rows(out).some((i) => i.title === "#newsong")).toBe(false);
    expect(rows(out).some((i) => i.title === "#velocityedit")).toBe(true);
  });

  it("stops at the run budget instead of throwing: SA gets its lists, US gets nothing, and the note says budget", async () => {
    const f = discovery();
    const out = await runTikTokTags(ctx(f, { budget: 3 }));
    expect(f.mock.calls.length).toBe(3);
    expect(out.ok && out.degraded).toBe(true);
    expect(out.ok && out.note).toContain("budget");
    expect(out.ok && out.note).toContain("US");
    expect(rows(out).some((i) => i.region === "US")).toBe(false);
    expect(rows(out).filter((i) => i.region === "SA").length).toBeGreaterThan(0);
    expect(rows(out).every((i) => i.proof === undefined)).toBe(true);
  });

  it("decodes a proof video's post time from the literal TikTok id (not through the test helper)", async () => {
    // 7692240280929520917 >> 32 = 1790989255 s = 2026-10-03T01:00:55Z.
    const out = await runTikTokTags(
      ctx(
        discovery({
          videos: (_r, ids) =>
            ok(
              ids.map((id) => ({
                hashtag_id: id,
                top_video_list: [
                  {
                    video_id: "7692240280929520917",
                    share_url: "https://www.tiktok.com/@dana/video/7692240280929520917?lang=en",
                  },
                ],
              })),
            ),
        }),
      ),
    );
    const first = rows(out).find((i) => i.id === "tiktok:SA:tag-velocityedit")!;
    expect(first.proof).toEqual([
      {
        url: "https://www.tiktok.com/@dana/video/7692240280929520917",
        creator: "@dana",
        postedAt: "2026-10-03T01:00:55.000Z",
      },
    ]);
  });

  it("puts the problems before the counts, so the clip keeps what went wrong", async () => {
    const out = await runTikTokTags(
      ctx(
        discovery({
          lists: (region, industry) => ok(region === "SA" ? [] : DEFAULT_LISTS[industry]),
          videos: () => json({ code: 40002, message: "x".repeat(150) }),
        }),
      ),
    );
    expect(out.ok && out.note).toMatch(/^SA: no hashtags/);
    expect(out.ok && out.note!.length).toBeLessThanOrEqual(200);
    expect(out.ok && out.note).toContain("US videos: code 40002");
  });
});

describe("the TikTok source in the run", () => {
  it("is a daily source, on by default, after the keyword search", () => {
    expect(SOURCES.map((s) => `${s.kind}:${s.label}`)).toContain("daily:TikTok Discovery");
    const labels = SOURCES.filter((s) => s.kind === "daily").map((s) => s.label);
    expect(labels).toEqual(["YouTube search", "TikTok Discovery"]);
    expect(enabledSources({})).toContain("tiktok");
    expect(enabledSources({ TREND_SOURCES: "google" })).not.toContain("tiktok");
  });

  it("a daily run stores the rows in the one feed write and reports the source", async () => {
    const kv = fakeKV();
    const f = discovery();
    const feed = await runTrends(env(kv), { kinds: ["daily"], now: NOW, fetch: f });
    const tt = feed.items.filter((i) => i.source === SOURCE_LABELS.tiktok);
    expect(tt.length).toBeGreaterThan(0);
    expect(feed.sources.find((s) => s.name === SOURCE_LABELS.tiktok)).toMatchObject({ ok: true });
    expect((await latestFeed(env(kv))).items.some((i) => i.proof?.length)).toBe(true);
    // Only YouTube search is not configured here; TikTok spent its 8 calls and the feed was written once.
    expect(f).toHaveBeenCalledTimes(8);
    expect(kv.writes).toBe(1);
  });

  it("without a token the source is a setup state, not a failure", async () => {
    const f = discovery();
    const feed = await runTrends(
      { ...env(fakeKV(null)), TREND_SOURCES: "tiktok,events" },
      { kinds: ["fast", "daily"], now: NOW, fetch: f },
    );
    expect(f).not.toHaveBeenCalled();
    expect(feed.sources.find((s) => s.name === SOURCE_LABELS.tiktok)).toMatchObject({
      ok: false,
      error: "not_configured",
    });
    expect(feed.degraded).toBe(false);
  });
});
