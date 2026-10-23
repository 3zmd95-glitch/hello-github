import { describe, expect, it } from "vitest";
import { rateQuote } from "./rates";
import {
  BrandDealSchema,
  BusinessKitSchema,
  DEFAULT_RATE_SETTINGS,
  RateSettingsSchema,
  SocialPostStatSchema,
  SocialSnapshotSchema,
  type BrandDeal,
  type BusinessKit,
  type SocialPostStatInput,
  type SocialSnapshotInput,
} from "./domain";
import {
  dealRate,
  dealReplyDraft,
  kitFileName,
  kitIssues,
  kitMetrics,
  kitProjection,
  type KitSource,
} from "./businessKit";

// 💼 Business Kit (packet DT-5): per-platform metrics with their own provenance (saved snapshot day, posts sample and
// range, missing, stale), never pooled; the deal reply's price; the allowlisted public projection.

const NOW = "2026-10-16T09:00:00.000Z"; // 12:00 in Riyadh
const snap = (s: SocialSnapshotInput) => SocialSnapshotSchema.parse(s);
const stat = (s: SocialPostStatInput) => SocialPostStatSchema.parse(s);
/** n TikTok posts, one per day back from `fromDay` (Riyadh noon), 100 views and 5 likes each. */
const tiktokPosts = (n: number, fromDay = 15) =>
  Array.from({ length: n }, (_, i) =>
    stat({
      platform: "tiktok",
      postId: `t${i}`,
      publishedAt: `2026-10-${String(fromDay - i).padStart(2, "0")}T09:00:00.000Z`,
      kind: "video",
      views: 100,
      likes: 5,
      comments: 1,
      shares: 0,
    }),
  );
const state = (over: Partial<Parameters<typeof kitMetrics>[0]> = {}) => ({
  snapshots: [],
  postStats: [],
  accounts: [],
  ...over,
});

describe("kitMetrics", () => {
  it("shows a saved snapshot with its observed day and never the snapshot's 30-day views", () => {
    const [ig] = kitMetrics(
      state({
        snapshots: [
          snap({
            platform: "instagram",
            day: "2026-10-10",
            followers: 1200,
            views30d: 50_000,
            engagementRate: 4.2,
            avgViews: 900,
          }),
        ],
        accounts: [{ platform: "instagram", handle: "3z.prod" }],
      }),
      NOW,
    );
    expect(ig).toEqual({
      platform: "instagram",
      handle: "3z.prod",
      followers: { source: "snapshot", value: 1200, observedDay: "2026-10-10" },
      engagement: { source: "snapshot", value: 4.2, observedDay: "2026-10-10" },
      avgViews: { source: "snapshot", value: 900, observedDay: "2026-10-10" },
      avgLikes: { source: "none" },
      stale: false,
    });
    expect(JSON.stringify(ig)).not.toContain("views30d");
    expect(JSON.stringify(ig)).not.toContain("50000");
  });

  it("uses posts from five up (sample and date range), the snapshot below five: the 4/5 boundary", () => {
    const snapshots = [
      snap({ platform: "tiktok", day: "2026-10-12", followers: 8000, engagementRate: 9.9 }),
    ];
    const four = kitMetrics(state({ snapshots, postStats: tiktokPosts(4) }), NOW)[0];
    expect(four.engagement).toEqual({ source: "snapshot", value: 9.9, observedDay: "2026-10-12" });
    // No snapshot field for views: the computed value fills in, labelled with its real sample of 4.
    expect(four.avgViews).toEqual({
      source: "posts",
      value: 100,
      sample: 4,
      range: { from: "2026-10-12", to: "2026-10-15" },
    });
    const five = kitMetrics(state({ snapshots, postStats: tiktokPosts(5) }), NOW)[0];
    expect(five.engagement).toEqual({
      source: "posts",
      value: 6,
      sample: 5,
      range: { from: "2026-10-11", to: "2026-10-15" },
    });
    expect(five.avgLikes).toMatchObject({ source: "posts", value: 5, sample: 5 });
    // Followers always come from the snapshot.
    expect(five.followers).toEqual({ source: "snapshot", value: 8000, observedDay: "2026-10-12" });
  });

  it("leaves out future posts, stories and future snapshots", () => {
    const future = stat({
      platform: "tiktok",
      postId: "future",
      publishedAt: "2026-10-30T09:00:00.000Z",
      views: 1_000_000,
      likes: 1_000_000,
    });
    const story = stat({
      platform: "tiktok",
      postId: "story",
      publishedAt: "2026-10-15T10:00:00.000Z",
      kind: "story",
      views: 1_000_000,
    });
    const [tt] = kitMetrics(
      state({
        postStats: [...tiktokPosts(5), future, story],
        snapshots: [
          snap({ platform: "tiktok", day: "2026-10-01", followers: 7000 }),
          snap({ platform: "tiktok", day: "2026-10-20", followers: 99_000 }),
        ],
      }),
      NOW,
    );
    expect(tt.avgViews).toEqual({
      source: "posts",
      value: 100,
      sample: 5,
      range: { from: "2026-10-11", to: "2026-10-15" },
    });
    expect(tt.followers).toEqual({ source: "snapshot", value: 7000, observedDay: "2026-10-01" });
  });

  it("marks a snapshot older than 30 days stale and a platform without numbers missing", () => {
    const list = kitMetrics(
      state({
        snapshots: [
          snap({ platform: "youtube", day: "2026-09-01", followers: 300 }),
          snap({ platform: "instagram", day: "2026-09-20", followers: 1200 }),
        ],
        accounts: [{ platform: "threads", handle: "3z.threads" }],
      }),
      NOW,
    );
    expect(list.map((m) => m.platform)).toEqual(["instagram", "youtube", "threads"]);
    expect(list.find((m) => m.platform === "youtube")!.stale).toBe(true);
    expect(list.find((m) => m.platform === "instagram")!.stale).toBe(false);
    expect(list.find((m) => m.platform === "threads")).toEqual({
      platform: "threads",
      handle: "3z.threads",
      followers: { source: "none" },
      engagement: { source: "none" },
      avgViews: { source: "none" },
      avgLikes: { source: "none" },
      stale: false,
    });
    // Asked for explicitly, a platform with nothing at all is listed as missing.
    expect(kitMetrics(state(), NOW, ["snapchat"])[0].followers).toEqual({ source: "none" });
    expect(kitMetrics(state(), NOW)).toEqual([]);
  });

  it("is per platform only: no pooled or total figure anywhere", () => {
    const list = kitMetrics(
      state({
        snapshots: [
          snap({ platform: "instagram", day: "2026-10-10", followers: 1200 }),
          snap({ platform: "tiktok", day: "2026-10-10", followers: 8000 }),
        ],
      }),
      NOW,
    );
    for (const m of list)
      expect(Object.keys(m).sort()).toEqual(
        ["avgLikes", "avgViews", "engagement", "followers", "handle", "platform", "stale"].sort(),
      );
    expect(JSON.stringify(list)).not.toMatch(/total|pooled|9200/i);
  });
});

const kit = (over: Partial<BusinessKit> = {}): BusinessKit =>
  BusinessKitSchema.parse({ commitId: "c1", updatedAt: NOW, ...over });

describe("kitIssues", () => {
  it("flags each problem once, and nothing for a clean kit", () => {
    const clean = kit({
      tagline: { ar: "مونتير", en: "" },
      bio: { ar: "", en: "Editor" },
      contact: {
        email: "hi@3z.example",
        website: "https://3z.example",
        location: { ar: "", en: "" },
      },
      services: [{ id: "s1", name: { ar: "", en: "Editing" }, desc: { ar: "", en: "" } }],
      rateCard: [
        {
          id: "r1",
          deliverable: { ar: "ريل", en: "" },
          priceSar: null,
          note: { ar: "", en: "" },
        },
      ],
      pastWork: [{ id: "w1", title: { ar: "", en: "Ad" }, url: "https://x.example/1" }],
    });
    expect(kitIssues(clean)).toEqual([]);
    const bad = kit({
      contact: { email: "nope", website: "http://3z.example", location: { ar: "", en: "" } },
      services: [{ id: "s1", name: { ar: " ", en: "" }, desc: { ar: "", en: "" } }],
      rateCard: [
        { id: "r1", deliverable: { ar: "", en: "" }, priceSar: 100, note: { ar: "", en: "" } },
      ],
      pastWork: [{ id: "w1", title: { ar: "x", en: "" }, url: "javascript:alert(1)" }],
    });
    expect(kitIssues(bad).map((i) => i.code)).toEqual([
      "tagline-empty-both",
      "bio-empty-both",
      "email-format",
      "website-not-https",
      "service-name-empty",
      "rate-deliverable-empty",
      "pastwork-url-not-https",
    ]);
    expect(kitIssues(bad).find((i) => i.code === "service-name-empty")!.index).toBe(0);
  });
});

describe("kitProjection", () => {
  const source = (over: Partial<KitSource> = {}) =>
    ({
      businessKit: kit({
        tagline: { ar: "أصوّر وأمنتج", en: "I film and edit" },
        services: [{ id: "s1", name: { ar: "مونتاج", en: "Editing" }, desc: { ar: "", en: "" } }],
        rateCard: [
          {
            id: "r1",
            deliverable: { ar: "ريل", en: "Reel" },
            platform: "instagram",
            priceSar: 1500,
            note: { ar: "", en: "" },
          },
        ],
        estimator: {
          sarPerThousandFollowers: 77,
          engagementMultiplier: 3,
          deliverable: { post: 1, story: 1, reel: 1, video: 1 },
        },
      }),
      socialSnapshots: [snap({ platform: "instagram", day: "2026-10-10", followers: 1200 })],
      socialPostStats: [],
      socialAccounts: [],
      // Private slices a caller might pass along: none may leak into the public file.
      brandDeals: [
        {
          id: "d1",
          brand: "Secret Brand",
          valueSar: 9999,
          contact: "pr@secret.example",
          notes: "private deal note",
        },
      ],
      settings: { apiKeys: { scoutToken: "super-secret-token" } },
      xpEvents: [{ id: "x1" }],
      ...over,
    }) as KitSource;

  const keysDeep = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        out.add(k);
        keysDeep(x, out);
      }
    return out;
  };

  it("is an allowlisted public file: kit text, rate card and metrics only", () => {
    const p = kitProjection(source(), NOW);
    expect(Object.keys(p)).toEqual([
      "app",
      "version",
      "generatedAt",
      "lang",
      "tagline",
      "bio",
      "contact",
      "services",
      "rateCard",
      "pastWork",
      "metrics",
    ]);
    expect(p).toMatchObject({
      app: "3z-prod-media-kit",
      version: 1,
      generatedAt: NOW,
      lang: ["ar", "en"],
      tagline: { ar: "أصوّر وأمنتج", en: "I film and edit" },
      services: [{ name: { ar: "مونتاج", en: "Editing" }, desc: { ar: "", en: "" } }],
      rateCard: [{ deliverable: { ar: "ريل", en: "Reel" }, platform: "instagram", priceSar: 1500 }],
    });
    expect(p.metrics.map((m) => m.platform)).toEqual(["instagram"]);
    const keys = keysDeep(p);
    for (const k of [
      "brandDeals",
      "estimator",
      "apiKeys",
      "settings",
      "scoutToken",
      "socialSnapshots",
      "xpEvents",
      "views30d",
      "commitId",
      "revision",
      "sarPerThousandFollowers",
    ])
      expect(keys.has(k), k).toBe(false);
    const text = JSON.stringify(p);
    for (const secret of [
      "Secret Brand",
      "9999",
      "pr@secret.example",
      "private deal note",
      "super-secret-token",
      "77",
    ])
      expect(text).not.toContain(secret);
  });

  it("follows the featured platforms and works before the kit is first saved", () => {
    const featured = kitProjection(
      source({ businessKit: kit({ featuredPlatforms: ["tiktok"] }) }),
      NOW,
    );
    expect(featured.metrics).toEqual([
      {
        platform: "tiktok",
        handle: null,
        followers: { source: "none" },
        engagement: { source: "none" },
        avgViews: { source: "none" },
        avgLikes: { source: "none" },
        stale: false,
      },
    ]);
    const empty = kitProjection(source({ businessKit: null }), NOW);
    expect(empty.tagline).toEqual({ ar: "", en: "" });
    expect(empty.services).toEqual([]);
    expect(empty.metrics.map((m) => m.platform)).toEqual(["instagram"]);
  });

  it("names the file after the Riyadh day", () => {
    expect(kitFileName(new Date("2026-10-16T22:30:00.000Z"))).toBe(
      "3z-prod-media-kit-2026-10-17.json",
    );
    // A draft that is not saved yet says so in the file name (Amendment A).
    expect(kitFileName(new Date("2026-10-16T09:00:00.000Z"), true)).toBe(
      "3z-prod-media-kit-2026-10-16-unsaved.json",
    );
  });
});

describe("kitMetrics amendments (A3 future data, B2 engagement denominator)", () => {
  it("counts only posts with views in the engagement sample and range, like the Growth average", () => {
    // Five sample posts; the newest and the oldest have no views, so engagement comes from three.
    const posts = tiktokPosts(5).map((p, i) => (i === 0 || i === 4 ? { ...p, views: 0 } : p));
    const [tt] = kitMetrics(state({ postStats: posts }), NOW);
    expect(tt.engagement).toEqual({
      source: "posts",
      value: 6,
      sample: 3,
      range: { from: "2026-10-12", to: "2026-10-14" },
    });
    // Views and likes still average all five posts.
    expect(tt.avgViews).toEqual({
      source: "posts",
      value: 60,
      sample: 5,
      range: { from: "2026-10-11", to: "2026-10-15" },
    });
  });

  it("drops an imported future snapshot and future posts before averaging", () => {
    const future = stat({
      platform: "instagram",
      postId: "f1",
      publishedAt: "2026-11-01T09:00:00.000Z",
      views: 5000,
      likes: 500,
    });
    const list = kitMetrics(
      state({
        snapshots: [snap({ platform: "instagram", day: "2026-12-01", followers: 999_999 })],
        postStats: [future],
      }),
      NOW,
    );
    // Only future data: nothing to show for the report date.
    expect(list).toEqual([]);
    const [ig] = kitMetrics(
      state({
        snapshots: [snap({ platform: "instagram", day: "2026-12-01", followers: 999_999 })],
        postStats: [future],
      }),
      NOW,
      ["instagram"],
    );
    expect(ig.followers).toEqual({ source: "none" });
    expect(ig.avgViews).toEqual({ source: "none" });
  });
});

describe("kitMetrics R1 repair (R6 offset timestamps)", () => {
  it("takes the range from the real instants, not the ISO text, for every post metric", () => {
    // Codex's pair: the Oct 15 text is Oct 16 in Riyadh, the Oct 16 text is Oct 15.
    const posts = [
      ["later", "2026-10-15T23:30:00-12:00"],
      ["earlier", "2026-10-16T00:30:00+14:00"],
    ].map(([postId, publishedAt]) =>
      stat({ platform: "instagram", postId, publishedAt, views: 100, likes: 10 }),
    );
    const [ig] = kitMetrics(state({ postStats: posts }), "2026-10-17T09:00:00.000Z");
    for (const key of ["avgViews", "avgLikes", "engagement"] as const) {
      expect(ig[key]).toMatchObject({
        source: "posts",
        sample: 2,
        range: { from: "2026-10-15", to: "2026-10-16" },
      });
    }
  });
});

describe("deal reply draft (DT-5-R1 coverage gap)", () => {
  const deal = (over: Partial<BrandDeal> = {}): BrandDeal =>
    BrandDealSchema.parse({
      id: "d1",
      brand: "Brand A",
      deliverable: "1 reel",
      valueSar: 1200,
      createdAt: NOW,
      updatedAt: NOW,
      commitId: "d1-c",
      ...over,
    });
  const withCard = kit({
    services: [
      { id: "s1", name: { ar: "مونتاج", en: "Video editing" }, desc: { ar: "", en: "" } },
      { id: "s2", name: { ar: "تصوير", en: "" }, desc: { ar: "", en: "" } },
    ],
    rateCard: [
      {
        id: "r1",
        deliverable: { ar: "ريل", en: "Reel" },
        priceSar: 1500,
        note: { ar: "", en: "" },
      },
    ],
  });

  it("prefers the owner's rate card for the deliverable, else the rate calculator, else nothing", () => {
    expect(dealRate(deal(), withCard, [])).toEqual({ kind: "card", sar: 1500 });
    // No card row for a story: the calculator from the saved follower count (no views saved: followers only).
    const [ig] = kitMetrics(
      state({ snapshots: [snap({ platform: "instagram", day: "2026-10-10", followers: 10_000 })] }),
      NOW,
    );
    expect(dealRate(deal({ deliverable: "2 stories" }), withCard, [ig])).toEqual({
      kind: "estimate",
      sar: rateQuote(DEFAULT_RATE_SETTINGS, 10_000, null, "story")!.sar,
    });
    expect(rateQuote(DEFAULT_RATE_SETTINGS, 10_000, null, "story")!.sar).toBe(80);
    // The owner's own assumptions and the platform's average views count; a bundle is its own deliverable.
    const [tt] = kitMetrics(
      state({
        snapshots: [snap({ platform: "tiktok", day: "2026-10-10", followers: 10_000 })],
        postStats: tiktokPosts(5),
      }),
      NOW,
    );
    const mine = RateSettingsSchema.parse({ sarPerThousandViews: 100 });
    expect(dealRate(deal({ deliverable: "story + post package" }), withCard, [tt], mine)).toEqual({
      kind: "estimate",
      sar: rateQuote(mine, 10_000, 100, "bundle")!.sar,
    });
    // A video is not one of the calculator's deliverables, and nothing to go on makes up no number.
    expect(dealRate(deal({ deliverable: "a YouTube video" }), withCard, [ig])).toBeNull();
    expect(dealRate(deal({ deliverable: "2 stories" }), withCard, [])).toBeNull();
    expect(dealRate(deal({ deliverable: "" }), withCard, [ig])).toBeNull();
  });

  it("builds a bilingual draft from the deal and the kit, Arabic first, within the limit", () => {
    const text = dealReplyDraft(deal(), withCard, { kind: "card", sar: 1500 });
    expect(text.indexOf("مرحبا")).toBeLessThan(text.indexOf("Hi Brand A"));
    for (const part of ["Brand A", "1 reel", "1,200", "1,500", "Video editing", "مونتاج", "تصوير"])
      expect(text).toContain(part);
    // Empty parts leave their line out rather than printing blanks.
    const bare = dealReplyDraft(deal({ deliverable: "", valueSar: null }), kit(), null);
    expect(bare).toContain("Brand A");
    expect(bare).not.toMatch(/SAR|ريال|undefined|null/);
    const long = dealReplyDraft(
      deal({ brand: "B".repeat(120), deliverable: "x".repeat(200) }),
      withCard,
      {
        kind: "estimate",
        sar: 900,
      },
    );
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long).toContain("900");
  });
});
