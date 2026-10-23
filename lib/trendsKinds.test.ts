import { describe, expect, it, vi } from "vitest";
import ar from "@/messages/trends.ar.json";
import en from "@/messages/trends.en.json";
import { EMPTY_TRENDS, TrendItemSchema, type TrendItem } from "./domain";
import { newestProofAt, SOURCE_KEY, sourceLabel, trendKind, visibleTrends } from "./trends";
import { fetchTrends } from "./trendsClient";

// Scout 02: the Worker's TikTok Discovery hashtag rows (kind, the 7-day window, the proof videos with the dates
// their ids carry) and the kind filter (Hashtags / Sounds / Topics) of the radar.

const NOW = new Date("2026-10-23T10:00:00Z");

/** A row the Worker's `runTikTokTags` writes. */
const tiktokRow = {
  id: "tiktok:SA:tag-velocityedit",
  platform: "tiktok",
  region: "SA",
  lang: "ar",
  title: "#velocityedit",
  url: "https://www.tiktok.com/tag/velocityedit",
  score: 100,
  source: "TikTok Discovery",
  seenAt: "2026-10-23T06:00:00.000Z",
  expiresAt: "2026-10-25T06:00:00.000Z",
  tags: ["special-effects"],
  kind: "hashtag",
  periodDays: 7,
  proof: [
    {
      url: "https://www.tiktok.com/@alice/video/7561234567890123456",
      creator: "@alice",
      postedAt: "2026-10-21T09:00:00.000Z",
    },
    { url: "https://www.tiktok.com/@bob/video/7560000000000000000" },
  ],
};

const item = (over: Partial<TrendItem> & { id: string }): TrendItem =>
  TrendItemSchema.parse({
    platform: "google",
    region: "SA",
    lang: "ar",
    title: over.id,
    source: "Google Trends",
    seenAt: "2026-10-23T06:00:00.000Z",
    ...over,
  });

describe("TrendItemSchema: TikTok Discovery rows", () => {
  it("keeps kind, periodDays and the proof videos as the Worker sent them", () => {
    const row = TrendItemSchema.parse(tiktokRow);
    expect(row).toMatchObject({ kind: "hashtag", periodDays: 7 });
    expect(row.proof).toEqual(tiktokRow.proof);
  });

  it("still reads a row without them (the feed before scout 02)", () => {
    const row = TrendItemSchema.parse({ ...tiktokRow, kind: undefined, proof: undefined });
    expect(row.kind).toBeUndefined();
    expect(row.proof).toBeUndefined();
    expect(row.periodDays).toBe(7);
  });

  it("refuses a proof link that is not https and a kind it does not know", () => {
    const bad = (proof: unknown) => TrendItemSchema.safeParse({ ...tiktokRow, proof }).success;
    expect(bad([{ url: "http://www.tiktok.com/@a/video/1" }])).toBe(false);
    expect(bad([{ url: "javascript:alert(1)" }])).toBe(false);
    expect(bad([{ url: "https://www.tiktok.com/@a/video/1", postedAt: "yesterday" }])).toBe(false);
    expect(TrendItemSchema.safeParse({ ...tiktokRow, kind: "meme" }).success).toBe(false);
  });

  it("GET /trends carries the proof through the client", async () => {
    const feed = {
      items: [tiktokRow],
      fetchedAt: "2026-10-23T06:00:00.000Z",
      degraded: false,
      sources: [],
    };
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(feed), { headers: { "Content-Type": "application/json" } }),
    );
    const res = await fetchTrends({ url: "https://scout.test", token: "t" }, { fetchImpl });
    expect(res.ok && res.feed.items[0].proof).toHaveLength(2);
  });
});

describe("trendKind", () => {
  it("is the row's own kind when the Worker set one", () => {
    expect(trendKind(item({ id: "a", kind: "sound", source: "Google Trends" }))).toBe("sound");
  });

  it("reads it from the source for rows stored before kinds existed", () => {
    expect(trendKind(item({ id: "g", source: "Google Trends" }))).toBe("topic");
    expect(trendKind(item({ id: "k", platform: "tiktok", source: "kworb.net" }))).toBe("sound");
    expect(trendKind(item({ id: "t", platform: "tiktok", source: "TikTok Discovery" }))).toBe(
      "hashtag",
    );
  });

  it("calls a #title a hashtag, whatever scanned it, and leaves videos and the rest without a kind", () => {
    expect(
      trendKind(item({ id: "s", platform: "instagram", source: "Tavily scan", title: "#سعودي" })),
    ).toBe("hashtag");
    expect(
      trendKind(
        item({ id: "q", platform: "instagram", source: "Tavily scan", title: "Song name" }),
      ),
    ).toBeUndefined();
    expect(
      trendKind(item({ id: "y", platform: "youtube", source: "YouTube charts", title: "Video" })),
    ).toBeUndefined();
  });
});

describe("visibleTrends by kind", () => {
  const items = [
    item({ id: "tag-sa", score: 100, kind: "hashtag", source: "TikTok Discovery" }),
    item({ id: "topic", score: 90 }),
    item({ id: "sound", score: 80, platform: "tiktok", source: "kworb.net" }),
    item({ id: "video", score: 70, platform: "youtube", source: "YouTube charts" }),
    item({ id: "scan-tag", score: 60, platform: "instagram", source: "Tavily scan", title: "#x" }),
  ];
  const state = { ...EMPTY_TRENDS, items };
  const ids = (kind?: "hashtag" | "sound" | "topic") =>
    visibleTrends(state, { kind }, NOW).map((i) => i.id);

  it("shows everything without a kind filter and only that kind with one", () => {
    expect(ids()).toHaveLength(5);
    expect(ids("hashtag")).toEqual(["tag-sa", "scan-tag"]);
    expect(ids("sound")).toEqual(["sound"]);
    expect(ids("topic")).toEqual(["topic"]);
  });
});

describe("newestProofAt (the proof under a hashtag)", () => {
  const row = (proof: TrendItem["proof"]) => item({ id: "p", proof });
  it("is the latest post time TikTok's own ids carry, ignoring videos without one", () => {
    expect(
      newestProofAt(
        row([
          { url: "https://www.tiktok.com/@a/video/1", postedAt: "2026-10-18T09:00:00.000Z" },
          { url: "https://www.tiktok.com/@b/video/2", postedAt: "2026-10-21T09:00:00.000Z" },
          { url: "https://www.tiktok.com/@c/video/3" },
        ]),
      ),
    ).toBe("2026-10-21T09:00:00.000Z");
  });
  it("is undefined without dated proof", () => {
    expect(newestProofAt(row(undefined))).toBeUndefined();
    expect(newestProofAt(row([{ url: "https://www.tiktok.com/@c/video/3" }]))).toBeUndefined();
  });
});

describe("messages for TikTok Discovery", () => {
  const keys = [
    "trends.source.tiktok",
    "trends.kindLabel",
    "trends.kind.all",
    "trends.kind.hashtag",
    "trends.kind.sound",
    "trends.kind.topic",
    "trends.kindOne.hashtag",
    "trends.period",
    "trends.proof.title",
    "trends.proof.newest",
  ] as const;

  it("exist in Arabic and English", () => {
    for (const k of keys) {
      expect(Object.keys(ar), k).toContain(k);
      expect(Object.keys(en), k).toContain(k);
    }
  });

  it("names the source in the UI language", () => {
    expect(SOURCE_KEY["TikTok Discovery"]).toBe("trends.source.tiktok");
    const t = (lang: typeof ar) => (key: string) => (lang as Record<string, string>)[key] ?? key;
    expect(sourceLabel("TikTok Discovery", t(ar) as never)).toBe(ar["trends.source.tiktok"]);
    expect(sourceLabel("TikTok Discovery", t(en) as never)).toBe("TikTok Discovery");
  });
});
