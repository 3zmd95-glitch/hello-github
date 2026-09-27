import { describe, expect, it } from "vitest";
import type { Demographic, SocialAccount, SocialPostStat, SocialSnapshot } from "./domain";
import {
  AGE_BUCKETS,
  OVERVIEW_ROWS,
  allOverview,
  averageSample,
  averages,
  countryCode,
  countryName,
  demographicsFor,
  engagementOfPost,
  flagEmoji,
  latestDemographicsDay,
  parseCsvTable,
  parseDemographicsJson,
  parseInstagramCsv,
  parseKind,
  parseMyContentCsv,
  parsePostsCsv,
  parsePublishedAt,
  parseTikTokStudioCsv,
  parseYouTubeStudioCsv,
  platformOverview,
  postCounts,
  postStatsToCsv,
  postsInWindow,
  replaceDemographics,
  topPostsThisWeek,
  upsertPostStats,
  weeklyDiff,
  whatChanged,
} from "./analytics";

const NOW = "2026-09-27T12:00:00.000Z";

const post = (
  platform: SocialPostStat["platform"],
  postId: string,
  day: string,
  views: number,
  likes = 0,
  comments = 0,
  shares = 0,
  extra: Partial<SocialPostStat> = {},
): SocialPostStat => ({
  platform,
  postId,
  publishedAt: `${day}T10:00:00.000Z`,
  kind: "video",
  views,
  likes,
  comments,
  shares,
  ...extra,
});

const posts: SocialPostStat[] = [
  post("tiktok", "t1", "2026-09-25", 1000, 100, 10, 5, { saves: 5 }),
  post("tiktok", "t2", "2026-09-20", 500, 50),
  post("tiktok", "t3", "2026-09-15", 2000, 200, 20, 20),
  post("tiktok", "t4", "2026-09-10", 0),
  post("tiktok", "t5", "2026-09-01", 500, 25),
  post("tiktok", "t6", "2026-08-01", 10_000, 1000),
  post("tiktok", "s1", "2026-09-26", 300, 30, 0, 0, { kind: "story" }),
  post("threads", "th1", "2026-09-22", 1000, 8, 3, 1, { kind: "thread" }),
  post("threads", "th2", "2026-09-23", 1000, 10, 4, 2, { kind: "thread" }),
  post("tiktok", "future", "2026-10-05", 99_999),
];

const snapshots: SocialSnapshot[] = [
  {
    platform: "tiktok",
    day: "2026-09-27",
    followers: 1200,
    views30d: 0,
    engagementRate: 7.8,
    avgLikes: 2300,
    avgViews: 30_200,
  },
  {
    platform: "tiktok",
    day: "2026-09-19",
    followers: 1150,
    views30d: 0,
    engagementRate: 7,
    avgViews: 30_000,
  },
  { platform: "tiktok", day: "2026-09-21", followers: 1180, views30d: 0, engagementPct: 7.5 },
  {
    platform: "threads",
    day: "2026-09-27",
    followers: 0,
    views30d: 0,
    engagementRate: 6.5,
    avgLikes: 8,
    avgViews: 1100,
    avgShares: 1,
  },
  {
    platform: "instagram",
    day: "2026-09-27",
    followers: 272,
    views30d: 0,
    avgLikes: 0,
    avgViews: 0,
    totalPosts: 14,
  },
  { platform: "instagram", day: "2026-08-01", followers: 250, views30d: 100 },
];

const accounts: SocialAccount[] = [{ platform: "tiktok", handle: "3z.prod" }];
const state = { snapshots, postStats: posts, accounts };

describe("post activity", () => {
  it("postsInWindow keeps posts inside the window, newest first, never future ones", () => {
    expect(postsInWindow(posts, "tiktok", 7, NOW).map((p) => p.postId)).toEqual(["s1", "t1"]);
    expect(postsInWindow(posts, null, 7, NOW)).toHaveLength(4);
    expect(postsInWindow(posts, "tiktok", 30, NOW)).toHaveLength(6);
    expect(postsInWindow(posts, "youtube", 90, NOW)).toEqual([]);
  });

  it("postCounts gives the three counters per platform and summed", () => {
    expect(postCounts(posts, "tiktok", NOW)).toEqual({ posts7d: 2, posts30d: 6, posts90d: 7 });
    expect(postCounts(posts, null, NOW)).toEqual({ posts7d: 4, posts30d: 8, posts90d: 9 });
  });
});

describe("averages", () => {
  it("engagementOfPost is interactions over views in percent, null without views", () => {
    expect(engagementOfPost(posts[0])).toBe(12);
    expect(engagementOfPost({ views: 3, likes: 1, comments: 0, shares: 0 })).toBe(33.33);
    expect(engagementOfPost(posts[3])).toBeNull();
  });

  it("uses the 30-day window when it has 5 posts and skips stories", () => {
    const a = averages(posts, "tiktok", NOW, 1200);
    expect(a).toEqual({
      avgViews: 800,
      avgLikes: 75,
      avgComments: 6,
      avgShares: 5,
      engagementRate: 9.75,
      engagementByFollowers: 7.17,
      sample: 5,
      window: "30d",
    });
    expect(averageSample(posts, "tiktok", NOW).posts.map((p) => p.postId)).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
    ]);
  });

  it("falls back to the last 20 posts when fewer than 5 are recent", () => {
    const a = averages(posts, "threads", NOW);
    expect(a).toEqual({
      avgViews: 1000,
      avgLikes: 9,
      avgComments: 4,
      avgShares: 2,
      engagementRate: 1.4,
      engagementByFollowers: null,
      sample: 2,
      window: "last20",
    });
    expect(averages(posts, "threads", NOW, 0).engagementByFollowers).toBeNull();
    expect(averageSample(posts, "tiktok", NOW, ["story"]).posts.map((p) => p.postId)).toEqual([
      "s1",
    ]);
    expect(averages([], "youtube", NOW)).toEqual({
      avgViews: null,
      avgLikes: null,
      avgComments: null,
      avgShares: null,
      engagementRate: null,
      engagementByFollowers: null,
      sample: 0,
      window: "last20",
    });
  });
});

describe("overview", () => {
  it("lets computed averages win over the snapshot when 5+ posts back them", () => {
    const o = platformOverview(state, "tiktok", NOW);
    expect(o.followers).toBe(1200);
    expect(o.account?.handle).toBe("3z.prod");
    expect(o.snapshot?.day).toBe("2026-09-27");
    expect(o.metrics.engagement).toBe(9.75);
    expect(o.sources.engagement).toBe("posts");
    expect(o.metrics.avgLikes).toBe(75);
    expect(o.metrics.totalFollowers).toBe(1200);
    expect(o.sources.totalFollowers).toBe("snapshot");
    expect(o.metrics.avgStoryViews).toBe(300); // one story, no snapshot value: computed fills in
    expect(o.sources.avgStoryViews).toBe("posts");
    expect(o.metrics.avgStoryClicks).toBeNull();
    expect(o.sources.avgStoryClicks).toBe("none");
    expect(o.rows.map((r) => r.metric)).toEqual(OVERVIEW_ROWS.tiktok);
    expect(o.rows[0]).toEqual({
      metric: "engagement",
      label: { ar: "التفاعل", en: "Engagement" },
      format: "pct",
      value: 9.75,
      source: "posts",
    });
    expect(o.cardRows.map((r) => r.metric)).toEqual([
      "totalFollowers",
      "engagement",
      "avgLikes",
      "avgViews",
    ]);
    expect(o.posts).toEqual({ posts7d: 2, posts30d: 6, posts90d: 7 });
    expect(o.sample).toBe(5);
    expect(o.connected).toBe(true);
  });

  it("prefers the snapshot with fewer than 5 posts and fills gaps from the posts", () => {
    const o = platformOverview(state, "threads", NOW);
    expect(o.metrics.engagement).toBe(6.5);
    expect(o.sources.engagement).toBe("snapshot");
    expect(o.metrics.avgLikes).toBe(8);
    expect(o.metrics.avgComments).toBe(4); // not in the snapshot: computed from the 2 posts
    expect(o.sources.avgComments).toBe("posts");
    expect(o.rows.map((r) => r.metric)).toEqual(OVERVIEW_ROWS.threads);
    expect(o.posts).toEqual({ posts7d: 2, posts30d: 2, posts90d: 2 });
  });

  it("uses the snapshot's counters and reads Subscribers on YouTube; unknown platforms are not connected", () => {
    const ig = platformOverview(state, "instagram", NOW);
    expect(ig.metrics.engagement).toBeNull();
    expect(ig.metrics.totalPosts).toBe(14);
    expect(ig.rows).toHaveLength(7);
    expect(ig.rows[0].value).toBe(272);
    expect(ig.posts).toEqual({ posts7d: 0, posts30d: 0, posts90d: 0 });
    const yt = platformOverview(
      {
        snapshots: [
          { platform: "youtube", day: "2026-09-27", followers: 6, views30d: 0, posts30d: 3 },
        ],
        postStats: [],
        accounts: [],
      },
      "youtube",
      NOW,
    );
    expect(yt.cardRows[0]).toMatchObject({ metric: "totalSubscribers", value: 6 });
    expect(yt.rows[0].metric).toBe("totalSubscribers");
    expect(yt.posts).toEqual({ posts7d: 0, posts30d: 3, posts90d: 0 });
    expect(platformOverview(state, "youtube", NOW).connected).toBe(false);
    expect(platformOverview(state, "snapchat", NOW).metrics.avgViews).toBeNull();
  });

  it("allOverview sums followers, averages the platforms with data and lists connected ones", () => {
    const all = allOverview(state, NOW);
    expect(all.platforms.map((p) => p.platform)).toEqual(["tiktok", "instagram", "threads"]);
    expect(all.totalFollowers).toBe(1472);
    expect(all.avgEngagement).toBe(8.13); // mean of 9.75 and 6.5
    expect(all.avgLikes).toBe(28); // mean of 75, 0, 8
    expect(all.avgViews).toBe(633); // mean of 800, 0, 1100
    expect(all.posts).toEqual({ posts7d: 4, posts30d: 8, posts90d: 9 });
    expect(allOverview({ snapshots: [], postStats: [], accounts: [] }, NOW)).toEqual({
      totalFollowers: 0,
      avgEngagement: null,
      avgLikes: null,
      avgViews: null,
      posts: { posts7d: 0, posts30d: 0, posts90d: 0 },
      platforms: [],
    });
  });
});

describe("demographics", () => {
  const d = (
    platform: Demographic["platform"],
    day: string,
    dimension: Demographic["dimension"],
    key: string,
    pct: number,
    gender?: Demographic["gender"],
  ): Demographic => ({ platform, day, dimension, key, pct, ...(gender ? { gender } : {}) });
  const rows: Demographic[] = [
    d("tiktok", "2026-09-27", "gender", "male", 56),
    d("tiktok", "2026-09-27", "gender", "female", 44),
    d("tiktok", "2026-09-27", "age", "18-24", 25),
    d("tiktok", "2026-09-27", "age", "25-34", 53),
    d("tiktok", "2026-09-27", "age", "25-34", 30, "male"),
    d("tiktok", "2026-09-27", "age", "18-24", 15, "male"),
    d("tiktok", "2026-09-27", "age", "25-34", 23, "female"),
    d("tiktok", "2026-09-27", "age", "18-24", 10, "female"),
    d("tiktok", "2026-09-27", "country", "EG", 3.1),
    d("tiktok", "2026-09-27", "country", "SA", 73.1),
    d("tiktok", "2026-09-27", "country", "other", 16),
    d("tiktok", "2026-09-01", "gender", "male", 50),
    d("tiktok", "2026-09-01", "gender", "female", 50),
    d("instagram", "2026-09-27", "age", "25-34", 40, "male"),
    d("instagram", "2026-09-27", "age", "25-34", 10.4, "female"),
    d("instagram", "2026-09-27", "age", "18-24", 30, "male"),
  ];

  it("returns the latest day's rows, largest first, honouring the gender toggle", () => {
    expect(demographicsFor(rows, "tiktok", "gender").map((r) => [r.key, r.pct])).toEqual([
      ["male", 56],
      ["female", 44],
    ]);
    expect(demographicsFor(rows, "tiktok", "gender", { day: "2026-09-01" })[0].pct).toBe(50);
    expect(demographicsFor(rows, "tiktok", "country").map((r) => r.key)).toEqual([
      "SA",
      "other",
      "EG",
    ]);
    expect(demographicsFor(rows, "tiktok", "age").map((r) => r.key)).toEqual(["25-34", "18-24"]);
    expect(demographicsFor(rows, "tiktok", "age", { gender: "female" })).toEqual([
      d("tiktok", "2026-09-27", "age", "25-34", 23, "female"),
      d("tiktok", "2026-09-27", "age", "18-24", 10, "female"),
    ]);
    expect(demographicsFor(rows, "tiktok", "city")).toEqual([]);
    expect(demographicsFor(rows, "youtube", "gender")).toEqual([]);
    expect(latestDemographicsDay(rows, "tiktok")).toBe("2026-09-27");
    expect(latestDemographicsDay(rows, "instagram", "gender")).toBeNull();
  });

  it("sums age × gender rows for the All view when no ungendered rows exist", () => {
    expect(demographicsFor(rows, "instagram", "age")).toEqual([
      { platform: "instagram", day: "2026-09-27", dimension: "age", key: "25-34", pct: 50.4 },
      { platform: "instagram", day: "2026-09-27", dimension: "age", key: "18-24", pct: 30 },
    ]);
    expect(AGE_BUCKETS[2]).toBe("25-34");
  });

  it("maps countries to codes, names and flags", () => {
    expect(countryCode("Saudi Arabia")).toBe("SA");
    expect(countryCode("sa")).toBe("SA");
    expect(countryCode("السعودية")).toBe("SA");
    expect(countryCode("others")).toBe("other");
    expect(countryCode("Egypt")).toBe("EG");
    expect(countryCode("Narnia")).toBe("Narnia");
    expect(countryName("SA", "ar")).toBe("السعودية");
    expect(countryName("Iraq", "en")).toBe("Iraq");
    expect(countryName("ZZ", "en")).toBe("ZZ");
    expect(flagEmoji("SA")).toBe("🇸🇦");
    expect(flagEmoji("other")).toBe("🌍");
  });

  it("replaceDemographics swaps whole platform + day + dimension sets", () => {
    const out = replaceDemographics(rows, [d("tiktok", "2026-09-27", "gender", "male", 60)]);
    expect(out.filter((r) => r.platform === "tiktok" && r.dimension === "gender")).toEqual([
      d("tiktok", "2026-09-01", "gender", "male", 50),
      d("tiktok", "2026-09-01", "gender", "female", 50),
      d("tiktok", "2026-09-27", "gender", "male", 60),
    ]);
    expect(out).toHaveLength(rows.length - 1);
  });
});

describe("top posts and what changed", () => {
  it("topPostsThisWeek ranks by views, likes, comments, shares and skips stories", () => {
    expect(topPostsThisWeek(posts, NOW).map((p) => p.postId)).toEqual(["t1", "th2", "th1"]);
    expect(topPostsThisWeek(posts, NOW, 2).map((p) => p.postId)).toEqual(["t1", "th2"]);
    expect(topPostsThisWeek(posts, NOW, 0)).toEqual([]);
  });

  it("weeklyDiff compares with the snapshot nearest to 7 days back (ties go to the older one)", () => {
    const diff = weeklyDiff(snapshots, NOW);
    expect(diff.map((d) => d.platform)).toEqual(["tiktok", "instagram", "threads"]);
    const tt = diff[0];
    expect(tt.baseline?.day).toBe("2026-09-19");
    expect(tt.days).toBe(8);
    expect(tt.followers).toBe(50);
    expect(tt.followersPct).toBe(4.3);
    expect(tt.engagement).toBe(0.8);
    expect(tt.views).toBe(200);
    expect(tt.viewsPct).toBe(0.7);
    expect(tt.viewsMetric).toBe("avgViews");
    const ig = diff[1];
    expect(ig.baseline?.day).toBe("2026-08-01");
    expect(ig.followers).toBe(22);
    expect(ig.engagement).toBeNull();
    expect(ig.viewsMetric).toBe("views30d");
    expect(ig.views).toBe(-100);
    expect(diff[2].baseline).toBeNull();
    expect(diff[2].followers).toBeNull();
    // Snapshots dated after `now` are ignored.
    expect(weeklyDiff(snapshots, "2026-09-20T00:00:00Z")[0].latest.day).toBe("2026-09-19");
  });

  it("whatChanged writes up to 4 plain sentences in either language", () => {
    const diff = weeklyDiff(snapshots, NOW);
    const en = whatChanged(diff, "en");
    expect(en).toHaveLength(3);
    expect(en[0]).toBe("Instagram: followers +22 (+8.8%), 30-day views -100 (-100%) this week.");
    expect(en[1]).toBe(
      "TikTok: followers +50 (+4.3%), engagement 7% → 7.8%, avg. views +200 (+0.7%) this week.",
    );
    expect(en[2]).toBe("Threads: first snapshot, nothing to compare with yet.");
    const ar = whatChanged(diff, "ar");
    expect(ar[1]).toContain("تيك توك: المتابعين +50 (+4.3%)");
    expect(ar[2]).toContain("أول لقطة");
    expect(whatChanged([], "en")[0]).toContain("No snapshots yet");
    const flat = weeklyDiff(
      [
        { platform: "x", day: "2026-09-27", followers: 5, views30d: 0 },
        { platform: "x", day: "2026-09-20", followers: 5, views30d: 0 },
      ],
      NOW,
    );
    expect(whatChanged(flat, "en")).toEqual(["X: no change this week."]);
    const many = weeklyDiff(
      ["tiktok", "instagram", "youtube", "threads", "x", "snapchat"].map((p) => ({
        platform: p as SocialSnapshot["platform"],
        day: "2026-09-27",
        followers: 1,
        views30d: 0,
      })),
      NOW,
    );
    expect(whatChanged(many, "ar")).toHaveLength(4);
  });
});

describe("CSV export and import", () => {
  it("postStatsToCsv round-trips through parseMyContentCsv", () => {
    const stats: SocialPostStat[] = [
      post("tiktok", "t1", "2026-09-25", 1000, 100, 10, 5, {
        saves: 5,
        watchTimeS: 12.5,
        title: 'Grade, "fast"',
        permalink: "https://www.tiktok.com/@3z.prod/video/t1",
        thumbUrl: "https://p16.example/t1.jpg",
      }),
      post("threads", "th1", "2026-09-22", 1000, 8, 3, 1, { kind: "thread" }),
    ];
    const csv = postStatsToCsv(stats);
    expect(csv.split("\n")[0]).toBe(
      "platform,postId,publishedAt,kind,title,views,likes,comments,shares,saves,watchTimeS,permalink,thumbUrl",
    );
    expect(csv.split("\n")[1]).toContain('"Grade, ""fast"""');
    const back = parseMyContentCsv(csv);
    expect(back.errors).toEqual([]);
    expect(back.stats).toEqual(stats);
    expect(postStatsToCsv([]).split("\n")).toHaveLength(1);
  });

  it("parseCsvTable handles delimiters, quotes and line breaks inside cells", () => {
    const t = parseCsvTable('﻿a;b;c\n1;"x;y";"two\nlines"\n\n2;;3\r\n');
    expect(t.delimiter).toBe(";");
    expect(t.header).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([
      { line: 2, cells: ["1", "x;y", "two\nlines"] },
      { line: 5, cells: ["2", "", "3"] },
    ]);
    expect(parseCsvTable("").header).toEqual([]);
  });

  it("reads a Beacons My Content CSV by header names and derives ids from links", () => {
    const { stats, errors, columns } = parseMyContentCsv(
      [
        "Platform,Date,Title,Type,Views,Likes,Comments,Shares,Link",
        "TikTok,2026-09-25,How I grade,Video,1.2k,100,10,5,https://www.tiktok.com/@3z.prod/video/7350000000000000000",
        "Instagram,25/09/2026,Studio tour,Reel,300,20,2,1,https://www.instagram.com/reel/C9abc/",
        "Threads,2026-09-24 21:03,Quick tip,,1100,8,3,1,",
        "YouTube,2026-09-23,Short one,Shorts,2,0,0,0,https://www.youtube.com/watch?v=abc123",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(columns).toMatchObject({ platform: "Platform", publishedAt: "Date", views: "Views" });
    expect(stats[0]).toEqual({
      platform: "tiktok",
      postId: "7350000000000000000",
      publishedAt: "2026-09-25T09:00:00.000Z",
      kind: "video",
      title: "How I grade",
      views: 1200,
      likes: 100,
      comments: 10,
      shares: 5,
      permalink: "https://www.tiktok.com/@3z.prod/video/7350000000000000000",
    });
    expect(stats[1]).toMatchObject({
      platform: "instagram",
      postId: "C9abc",
      publishedAt: "2026-09-25T09:00:00.000Z",
      kind: "reel",
    });
    expect(stats[2]).toMatchObject({
      platform: "threads",
      kind: "thread",
      publishedAt: "2026-09-24T18:03:00.000Z",
      postId: "threads:2026-09-24T18:03:00.000Z:Quick tip",
    });
    expect(stats[3]).toMatchObject({ platform: "youtube", kind: "short", postId: "abc123" });
  });

  it("reads a TikTok Studio export with a platform hint and watch time", () => {
    const { stats, errors } = parseTikTokStudioCsv(
      [
        "Video title,Video link,Video publish time,Total views,Total likes,Total comments,Total shares,Average watch time",
        '"Grade, fast",https://www.tiktok.com/@3z.prod/video/123,2026-09-20 21:03:11,5000,400,20,30,0:12',
        "No numbers,https://www.tiktok.com/@3z.prod/video/124,2026-09-21 10:00:00,,,,,",
      ].join("\n"),
    );
    expect(stats).toEqual([
      {
        platform: "tiktok",
        postId: "123",
        publishedAt: "2026-09-20T18:03:11.000Z",
        kind: "video",
        title: "Grade, fast",
        views: 5000,
        likes: 400,
        comments: 20,
        shares: 30,
        watchTimeS: 12,
        permalink: "https://www.tiktok.com/@3z.prod/video/123",
      },
    ]);
    expect(errors).toEqual([{ line: 3, message: "no views / likes / comments / shares" }]);
  });

  it("reads a YouTube Studio table: skips the Total row, splits shorts by duration, scales hours", () => {
    const { stats, errors } = parseYouTubeStudioCsv(
      [
        "Content,Video title,Video publish time,Duration,Views,Watch time (hours),Subscribers,Likes,Comments added,Shares",
        "Total,,,,2100,10.5,1,60,7,3",
        'abc123,My short,"Sep 20, 2026",45,100,0.5,1,10,2,1',
        "def456,Long one,2026-09-01,600,2000,10,0,50,5,2",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({
      platform: "youtube",
      postId: "abc123",
      kind: "short",
      title: "My short",
      views: 100,
      likes: 10,
      comments: 2,
      shares: 1,
      watchTimeS: 1800,
    });
    expect(stats[0].publishedAt.startsWith("2026-09-")).toBe(true);
    expect(stats[1]).toMatchObject({ postId: "def456", kind: "video", watchTimeS: 36_000 });
    expect(parseInstagramCsv("Date,Views\n2026-09-01,5").stats[0]).toMatchObject({
      platform: "instagram",
      kind: "reel",
      views: 5,
    });
  });

  it("reports rows it cannot read with their line numbers, later duplicates win", () => {
    const { stats, errors } = parsePostsCsv(
      [
        "platform,date,views",
        "facebook,2026-09-01,5",
        "tiktok,someday,5",
        "tiktok,2026-09-01,5",
        "tiktok,2026-09-01,7",
        ",2026-09-02,9",
      ].join("\n"),
    );
    expect(stats.map((s) => s.views)).toEqual([7]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 6]);
    expect(errors[0].message).toContain("facebook");
    expect(parsePostsCsv("title,views\nhello,5").errors[0]).toEqual({
      line: 1,
      message: "no date column found (date / published / publish time)",
    });
    expect(parsePostsCsv("", "tiktok")).toEqual({ stats: [], errors: [], columns: {} });
    expect(parsePostsCsv("date,views\n2026-09-02,9", "tiktok").stats[0].platform).toBe("tiktok");
  });

  it("parsePublishedAt and parseKind accept the formats the exports use", () => {
    expect(parsePublishedAt("2026-09-25")).toBe("2026-09-25T09:00:00.000Z");
    expect(parsePublishedAt("25/09/2026")).toBe("2026-09-25T09:00:00.000Z");
    expect(parsePublishedAt("2026-09-20 21:03:11")).toBe("2026-09-20T18:03:11.000Z");
    expect(parsePublishedAt("2026-09-20T21:03:11+0300")).toBe("2026-09-20T18:03:11.000Z");
    expect(parsePublishedAt("2026-09-20T18:03:11.000Z")).toBe("2026-09-20T18:03:11.000Z");
    expect(parsePublishedAt("1790000000")).toBe(new Date(1_790_000_000_000).toISOString());
    expect(parsePublishedAt("")).toBeNull();
    expect(parsePublishedAt("someday")).toBeNull();
    expect(parseKind("Reels")).toBe("reel");
    expect(parseKind("STORY")).toBe("story");
    expect(parseKind("carousel_album")).toBe("image");
    expect(parseKind("mystery")).toBeNull();
  });

  it("upsertPostStats replaces by platform + postId", () => {
    const out = upsertPostStats(posts.slice(0, 2), [
      { ...posts[0], views: 1 },
      post("threads", "t1", "2026-09-01", 2),
    ]);
    expect(out.map((p) => `${p.platform}:${p.postId}:${p.views}`)).toEqual([
      "tiktok:t1:1",
      "tiktok:t2:500",
      "threads:t1:2",
    ]);
  });
});

describe("parseDemographicsJson", () => {
  it("turns the manual entry into rows with ISO country codes", () => {
    const { demographics, errors } = parseDemographicsJson(
      JSON.stringify({
        platform: "TikTok",
        day: "2026-09-27",
        gender: { Male: 56, female: "44%" },
        age: { "18-24": 25, "25-34": 53 },
        ageByGender: { male: { "25-34": 30 }, female: { "25-34": 23 } },
        country: { "Saudi Arabia": 73.1, others: 16, EG: 3.1 },
        city: { Riyadh: 40 },
      }),
    );
    expect(errors).toEqual([]);
    const day = "2026-09-27";
    expect(demographics).toEqual([
      { platform: "tiktok", day, dimension: "gender", key: "male", pct: 56 },
      { platform: "tiktok", day, dimension: "gender", key: "female", pct: 44 },
      { platform: "tiktok", day, dimension: "age", key: "18-24", pct: 25 },
      { platform: "tiktok", day, dimension: "age", key: "25-34", pct: 53 },
      { platform: "tiktok", day, dimension: "age", key: "25-34", pct: 30, gender: "male" },
      { platform: "tiktok", day, dimension: "age", key: "25-34", pct: 23, gender: "female" },
      { platform: "tiktok", day, dimension: "country", key: "SA", pct: 73.1 },
      { platform: "tiktok", day, dimension: "country", key: "other", pct: 16 },
      { platform: "tiktok", day, dimension: "country", key: "EG", pct: 3.1 },
      { platform: "tiktok", day, dimension: "city", key: "Riyadh", pct: 40 },
    ]);
  });

  it("defaults the day, accepts arrays and reports bad entries", () => {
    const ok = parseDemographicsJson(
      JSON.stringify([
        { platform: "ig", countries: { Iraq: 17 } },
        { platform: "facebook", gender: { male: 1 } },
        { platform: "tiktok", gender: { male: 101 } },
        { platform: "tiktok", day: "yesterday" },
      ]),
      "2026-09-27",
    );
    expect(ok.demographics).toEqual([
      { platform: "instagram", day: "2026-09-27", dimension: "country", key: "IQ", pct: 17 },
    ]);
    expect(ok.errors).toHaveLength(3);
    expect(ok.errors[0]).toContain("facebook");
    expect(ok.errors[1]).toContain("101");
    expect(ok.errors[2]).toContain("YYYY-MM-DD");
    expect(parseDemographicsJson("{nope").errors).toEqual(["not valid JSON"]);
    expect(parseDemographicsJson("[]")).toEqual({ demographics: [], errors: [] });
  });
});
