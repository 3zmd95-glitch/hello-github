import { describe, expect, it } from "vitest";
import {
  BusinessPrefsSchema,
  DEFAULT_BUSINESS_PREFS,
  DEFAULT_RATE_SETTINGS,
  RATE_DELIVERABLES,
  RateSettingsSchema,
} from "./domain";
import { rateQuote, rateTable, roundRate } from "./rates";

// 💰 Rate calculator (planning/tools/09 D3): followers × average views × deliverable, every factor the owner's own.

const S = DEFAULT_RATE_SETTINGS; // 15 SAR / 1k followers, 20 SAR / 1k views, reel 1.5 story 0.5 post 1 bundle 2.5

describe("roundRate", () => {
  it("rounds to 10 SAR below 500 and to 50 SAR from 500 up, never to 0 for a positive amount", () => {
    expect(roundRate(0)).toBe(0);
    expect(roundRate(96)).toBe(100);
    expect(roundRate(94)).toBe(90);
    expect(roundRate(499)).toBe(500);
    expect(roundRate(520)).toBe(500);
    expect(roundRate(530)).toBe(550);
    expect(roundRate(1_237.5)).toBe(1_250);
    // A small account still gets a number, not "0 SAR".
    expect(roundRate(3)).toBe(10);
  });
});

describe("rateQuote", () => {
  it("is (followers/1000 × per-1k followers + avg views/1000 × per-1k views) × the deliverable multiplier", () => {
    // 12,000 followers → 180; 40,000 views → 800; base 980.
    expect(rateQuote(S, 12_000, 40_000, "post")).toEqual({
      followers: 12_000,
      avgViews: 40_000,
      followersPart: 180,
      viewsPart: 800,
      base: 980,
      multiplier: 1,
      raw: 980,
      sar: 1_000,
      viewsMissing: false,
    });
    expect(rateQuote(S, 12_000, 40_000, "reel")!.raw).toBe(1_470);
    expect(rateQuote(S, 12_000, 40_000, "reel")!.sar).toBe(1_450);
    expect(rateQuote(S, 12_000, 40_000, "story")!.sar).toBe(490);
    expect(rateQuote(S, 12_000, 40_000, "bundle")!.sar).toBe(2_450);
  });

  it("follows the owner's edits", () => {
    const mine = RateSettingsSchema.parse({
      sarPerThousandFollowers: 0,
      sarPerThousandViews: 100,
      multiplier: { reel: 2, story: 1, post: 1, bundle: 3 },
    });
    expect(rateQuote(mine, 5_000, 10_000, "reel")!.raw).toBe(2_000);
    expect(rateQuote(mine, 5_000, 10_000, "bundle")!.raw).toBe(3_000);
  });

  it("says when average views are missing and prices from followers only", () => {
    const q = rateQuote(S, 1_200, null, "post")!;
    expect(q.viewsMissing).toBe(true);
    expect(q.avgViews).toBeNull();
    expect(q.viewsPart).toBe(0);
    expect(q.raw).toBe(18);
    expect(q.sar).toBe(20);
  });

  it("has no number without followers (never invented)", () => {
    expect(rateQuote(S, null, 5_000, "reel")).toBeNull();
    expect(rateQuote(S, 0, 5_000, "reel")).toBeNull();
    expect(rateQuote(S, Number.NaN, 5_000, "reel")).toBeNull();
  });

  it("keeps two decimals in the explanation numbers", () => {
    const q = rateQuote(S, 272, 333, "story")!;
    expect(q.followersPart).toBe(4.08);
    expect(q.viewsPart).toBe(6.66);
    expect(q.raw).toBe(5.37);
    expect(q.sar).toBe(10);
  });
});

describe("rateTable", () => {
  it("quotes every deliverable in order for one platform's numbers", () => {
    const rows = rateTable(S, 12_000, 40_000);
    expect(rows.map((r) => r.deliverable)).toEqual([...RATE_DELIVERABLES]);
    expect(rows.map((r) => r.quote!.sar)).toEqual([1_450, 490, 1_000, 2_450]);
    expect(rateTable(S, null, 40_000).every((r) => r.quote === null)).toBe(true);
  });
});

describe("settings schema", () => {
  it("fills every default for an old save and keeps the owner's numbers", () => {
    expect(BusinessPrefsSchema.parse({})).toEqual(DEFAULT_BUSINESS_PREFS);
    const p = BusinessPrefsSchema.parse({
      rates: { sarPerThousandViews: 35, multiplier: { reel: 2 } },
      blocks: { posts: false },
    });
    expect(p.rates).toEqual({
      sarPerThousandFollowers: 15,
      sarPerThousandViews: 35,
      multiplier: { reel: 2, story: 0.5, post: 1, bundle: 2.5 },
    });
    expect(p.blocks.posts).toBe(false);
    expect(p.blocks.about).toBe(true);
  });

  it("refuses negative, infinite and non-numeric rates", () => {
    expect(RateSettingsSchema.safeParse({ sarPerThousandViews: -1 }).success).toBe(false);
    expect(RateSettingsSchema.safeParse({ sarPerThousandViews: Infinity }).success).toBe(false);
    expect(RateSettingsSchema.safeParse({ multiplier: { reel: "2" } }).success).toBe(false);
  });
});
