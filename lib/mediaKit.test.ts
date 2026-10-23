import { describe, expect, it } from "vitest";
import type { KitMetric } from "./businessKit";
import { PLATFORMS, type Demographic, type SocialPostStat } from "./domain";
import { kitAudience, kitRecentPosts, kitTotalFollowers } from "./mediaKit";

// 📄 Media-kit page (planning/tools/09 D2): the numbers that are not in kitMetrics. Only stored data, never invented.

const NOW = new Date("2026-10-23T09:00:00+03:00");
const NONE = { source: "none" } as const;
const metric = (platform: KitMetric["platform"], followers: number | null): KitMetric => ({
  platform,
  handle: null,
  followers:
    followers === null ? NONE : { source: "snapshot", value: followers, observedDay: "2026-10-20" },
  engagement: NONE,
  avgViews: NONE,
  avgLikes: NONE,
  stale: false,
});

describe("kitTotalFollowers", () => {
  it("adds only the saved follower counts and says across how many platforms", () => {
    expect(
      kitTotalFollowers([
        metric("instagram", 272),
        metric("tiktok", 1_200),
        metric("threads", null),
      ]),
    ).toEqual({ value: 1_472, platforms: 2, of: 3 });
  });

  it("leaves out a count from a stale snapshot, but the platform still counts in the 'of'", () => {
    const old = (p: KitMetric["platform"], n: number): KitMetric => ({
      ...metric(p, n),
      stale: true,
    });
    expect(kitTotalFollowers([metric("instagram", 272), old("tiktok", 1_200)])).toEqual({
      value: 272,
      platforms: 1,
      of: 2,
    });
    expect(kitTotalFollowers([old("instagram", 272), old("tiktok", 1_200)])).toBeNull();
  });

  it("is null when no platform has a count (the page shows a dash)", () => {
    expect(kitTotalFollowers([metric("threads", null)])).toBeNull();
    expect(kitTotalFollowers([])).toBeNull();
  });
});

const demo = (
  platform: Demographic["platform"],
  day: string,
  dimension: Demographic["dimension"],
  key: string,
  pct: number,
  gender?: Demographic["gender"],
): Demographic => ({ platform, day, dimension, key, pct, ...(gender ? { gender } : {}) });

describe("kitAudience", () => {
  const rows: Demographic[] = [
    demo("instagram", "2026-10-01", "gender", "male", 60),
    demo("instagram", "2026-10-01", "gender", "female", 40),
    demo("instagram", "2026-10-01", "age", "25-34", 50),
    demo("instagram", "2026-10-01", "age", "18-24", 30),
    demo("instagram", "2026-10-01", "age", "45-54", 20),
    demo("instagram", "2026-10-01", "country", "SA", 31.5),
    demo("instagram", "2026-10-01", "country", "IQ", 17),
    demo("instagram", "2026-10-01", "country", "other", 20),
    demo("instagram", "2026-10-01", "country", "EG", 10.1),
    demo("instagram", "2026-10-01", "country", "MA", 9),
    demo("instagram", "2026-10-01", "country", "YE", 8),
    demo("instagram", "2026-10-01", "country", "OM", 4.4),
    // An older day is ignored in favour of the newest one per dimension.
    demo("instagram", "2026-09-01", "country", "KW", 99),
    demo("tiktok", "2026-10-02", "country", "SA", 70),
    // Dated after today (Riyadh): dropped.
    demo("youtube", "2026-10-30", "country", "SA", 100),
  ];

  it("gives, per platform, gender, age buckets in order and the top 5 countries without 'other'", () => {
    const a = kitAudience(rows, ["instagram"], NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toEqual({
      platform: "instagram",
      day: "2026-10-01",
      gender: { male: 60, female: 40 },
      age: [
        { bucket: "18-24", pct: 30 },
        { bucket: "25-34", pct: 50 },
        { bucket: "45-54", pct: 20 },
      ],
      countries: [
        { code: "SA", pct: 31.5 },
        { code: "IQ", pct: 17 },
        { code: "EG", pct: 10.1 },
        { code: "MA", pct: 9 },
        { code: "YE", pct: 8 },
      ],
    });
  });

  it("sums an age × gender split into one bar per bucket, and leaves missing parts out", () => {
    const a = kitAudience(
      [
        demo("tiktok", "2026-10-02", "age", "18-24", 20, "male"),
        demo("tiktok", "2026-10-02", "age", "18-24", 25, "female"),
      ],
      ["tiktok"],
      NOW,
    );
    expect(a[0].age).toEqual([{ bucket: "18-24", pct: 45 }]);
    expect(a[0].gender).toBeNull();
    expect(a[0].countries).toEqual([]);
  });

  it("skips platforms without rows, future-dated rows and platforms not asked for", () => {
    expect(kitAudience(rows, ["youtube", "threads"], NOW)).toEqual([]);
    expect(kitAudience(rows, ["tiktok", "instagram"], NOW).map((x) => x.platform)).toEqual([
      "tiktok",
      "instagram",
    ]);
    expect(kitAudience([], [...PLATFORMS], NOW)).toEqual([]);
  });
});

const post = (over: Partial<SocialPostStat>): SocialPostStat => ({
  platform: "instagram",
  postId: "p",
  publishedAt: "2026-10-20T10:00:00+03:00",
  kind: "reel",
  views: 100,
  likes: 10,
  comments: 0,
  shares: 0,
  ...over,
});

describe("kitRecentPosts", () => {
  it("lists the newest posts of the shown platforms, no stories, nothing from the future", () => {
    const list = kitRecentPosts(
      [
        post({ postId: "old", publishedAt: "2026-09-01T10:00:00+03:00", title: "Old" }),
        post({ postId: "new", publishedAt: "2026-10-22T10:00:00+03:00", title: "  New reel  " }),
        post({ postId: "story", kind: "story", publishedAt: "2026-10-22T12:00:00+03:00" }),
        post({ postId: "future", publishedAt: "2026-11-01T10:00:00+03:00" }),
        post({ postId: "yt", platform: "youtube", publishedAt: "2026-10-23T01:00:00+03:00" }),
        post({ postId: "mid", publishedAt: "2026-10-21T10:00:00+03:00", views: 5_000, likes: 400 }),
      ],
      ["instagram"],
      NOW,
      2,
    );
    expect(list.map((p) => p.postId)).toEqual(["new", "mid"]);
    expect(list[0]).toMatchObject({ platform: "instagram", title: "New reel", views: 100 });
    expect(list[1]).toMatchObject({ title: null, views: 5_000, likes: 400 });
  });

  it("orders by the real instant, not the text of the date", () => {
    const list = kitRecentPosts(
      [
        post({ postId: "a", publishedAt: "2026-10-22T23:30:00+00:00" }),
        post({ postId: "b", publishedAt: "2026-10-22T23:00:00-05:00" }),
      ],
      ["instagram"],
      NOW,
    );
    expect(list.map((p) => p.postId)).toEqual(["b", "a"]);
  });

  it("cuts a very long title", () => {
    const [p] = kitRecentPosts([post({ title: "x".repeat(300) })], ["instagram"], NOW);
    expect(p.title!.length).toBeLessThanOrEqual(90);
    expect(p.title!.endsWith("…")).toBe(true);
  });
});
