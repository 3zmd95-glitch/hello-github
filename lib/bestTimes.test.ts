import { describe, expect, it } from "vitest";
import type { SocialPostStat } from "./domain";
import {
  BT_MIN_POSTS,
  bestTimeFor,
  blockLabel,
  learnBestTimes,
  riyadhParts,
  timesForDay,
} from "./bestTimes";
import { BEST_TIME } from "./social";

/** Fri Oct 23 2026, 12:00 Riyadh. */
const NOW = Date.parse("2026-10-23T12:00:00+03:00");

let seq = 0;
/** One TikTok video published at `at` (Riyadh wall clock, "YYYY-MM-DDTHH:MM"). */
const stat = (at: string, views: number, extra: Partial<SocialPostStat> = {}): SocialPostStat => ({
  platform: "tiktok",
  postId: `p${++seq}`,
  publishedAt: `${at}:00+03:00`,
  kind: "video",
  views,
  likes: 0,
  comments: 0,
  shares: 0,
  ...extra,
});

/** One post per day in `days`, all at `time` ("HH:MM") with `views`. */
const batch = (days: string[], time: string, views: number): SocialPostStat[] =>
  days.map((d) => stat(`${d}T${time}`, views));

/** `n` posts on consecutive September evenings (21:00), every one with `views`. */
const spread = (n: number, views: number): SocialPostStat[] =>
  Array.from({ length: n }, (_, i) =>
    stat(`2026-09-${String(i + 1).padStart(2, "0")}T21:00`, views),
  );

// 2026-09-02 is a Wednesday; +7 days each. Every date below is well over 72 h before NOW.
const WEDNESDAYS = ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"];
const MONDAYS = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
const SUNDAYS = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"];

describe("riyadhParts", () => {
  it("reads weekday and minutes on the Riyadh clock (UTC+3), across midnight", () => {
    // 18:30 UTC Thursday = 21:30 Riyadh Thursday
    expect(riyadhParts(Date.parse("2026-10-01T18:30:00Z"))).toEqual({
      dow: 4,
      minutes: 21 * 60 + 30,
    });
    // 22:30 UTC Thursday = 01:30 Riyadh Friday
    expect(riyadhParts(Date.parse("2026-10-01T22:30:00Z"))).toEqual({ dow: 5, minutes: 90 });
  });
});

describe("learnBestTimes: which posts count", () => {
  it("reports not ready below 20 posts and says how many it saw", () => {
    const r = learnBestTimes(batch(WEDNESDAYS, "21:00", 1000), "tiktok", NOW);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("few");
    expect(r.posts).toBe(5);
    expect(r.needed).toBe(BT_MIN_POSTS);
    expect(r.top).toEqual([]);
  });

  it("drops stories, other platforms, posts under 72 h old and posts over 180 days old", () => {
    const stats = [
      stat("2026-10-01T21:00", 100),
      stat("2026-10-02T21:00", 100, { kind: "story" }),
      stat("2026-10-03T21:00", 100, { platform: "instagram" }),
      stat("2026-10-21T09:00", 100), // 51 h before NOW: counters not settled
      stat("2026-04-01T21:00", 100), // more than 180 days before NOW
      stat("2026-10-25T21:00", 100), // in the future
    ];
    expect(learnBestTimes(stats, "tiktok", NOW).posts).toBe(1);
  });

  it("is not ready when most posts have no views (nothing to compare)", () => {
    const r = learnBestTimes(spread(20, 0), "tiktok", NOW);
    expect(r.posts).toBe(20);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("noViews");
  });
});

/** 29 posts: Wednesday ~21:00 does 4x the others; a lone lucky Monday-09:00 post does 40x. */
function peakStats(): SocialPostStat[] {
  return [
    ...batch(WEDNESDAYS, "21:00", 4000),
    ...batch(WEDNESDAYS.slice(0, 3), "21:20", 4000),
    ...batch(MONDAYS, "13:00", 1000),
    ...batch(SUNDAYS, "21:00", 1000),
    ...batch(SUNDAYS, "15:00", 1000),
    ...batch(MONDAYS, "17:00", 1000),
    stat("2026-09-14T09:00", 40000),
  ];
}

describe("learnBestTimes: the model", () => {
  it("puts the proven peak first at 100%, with a time taken from the posts in it", () => {
    const r = learnBestTimes(peakStats(), "tiktok", NOW);
    expect(r.ready).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.posts).toBe(29);
    expect(r.top[0]).toMatchObject({ dow: 3, block: 10, n: 8, pct: 100, time: "21:00" });
  });

  it("never lets one lucky post win: a single-post cell is not a top slot", () => {
    const r = learnBestTimes(peakStats(), "tiktok", NOW);
    expect(r.top.some((c) => c.block === 4)).toBe(false); // 08:00-10:00 holds only the 40x post
    for (const c of r.top) expect(c.n).toBeGreaterThanOrEqual(2);
    expect(r.top.length).toBeLessThanOrEqual(3);
  });

  it("caps each post's score at 4x the platform median", () => {
    // 20 ordinary posts (median 1000) and two huge ones, alone in Thursday 10:00-12:00
    const huge = [stat("2026-09-03T10:00", 1_000_000), stat("2026-09-10T10:00", 1_000_000)];
    const r = learnBestTimes([...spread(20, 1000), ...huge], "tiktok", NOW);
    const cell = r.cells.find((c) => c.dow === 4 && c.block === 5);
    // two capped posts (score 4 each): (4 + 4 + 2 * 1) / (2 + 2) = 2.5, not tens of thousands
    expect(cell?.score).toBeCloseTo(2.5, 5);
  });

  it("shades every cell as a percent of the best one, and leaves empty cells at 0", () => {
    const r = learnBestTimes(peakStats(), "tiktok", NOW);
    expect(r.cells).toHaveLength(7 * 12);
    for (const c of r.cells) {
      expect(c.pct).toBeGreaterThanOrEqual(0);
      expect(c.pct).toBeLessThanOrEqual(100);
      if (c.n === 0) expect(c.pct).toBe(0);
    }
  });
});

describe("timesForDay", () => {
  it("falls back to the usual times, best-for-that-day first, while there is too little data", () => {
    const r = learnBestTimes(batch(WEDNESDAYS, "21:00", 1000), "tiktok", NOW);
    // 2026-10-21 is a Wednesday, 2026-10-23 a Friday (the weekend slot first)
    expect(timesForDay(r, "2026-10-21")).toEqual({
      times: ["21:00", "21:30", "13:00"],
      learned: false,
    });
    expect(timesForDay(r, "2026-10-23").times).toEqual(["21:30", "21:00", "13:00"]);
    expect(timesForDay(r, undefined).times).toEqual(BEST_TIME.tiktok);
  });

  it("puts that weekday's own peak first, then the best times across the week, up to three", () => {
    const r = learnBestTimes(peakStats(), "tiktok", NOW);
    const wed = timesForDay(r, "2026-10-21");
    expect(wed.learned).toBe(true);
    expect(wed.times).toEqual(["21:00", "13:00", "15:00"]);
  });

  it("without a day it ranks the blocks over the whole week", () => {
    const r = learnBestTimes(peakStats(), "tiktok", NOW);
    const any = timesForDay(r, undefined);
    expect(any.learned).toBe(true);
    expect(any.times[0]).toBe("21:00");
    expect(new Set(any.times).size).toBe(any.times.length);
  });
});

describe("bestTimeFor", () => {
  it("is the first suggestion: learned when there is data, the usual time when there is not", () => {
    expect(bestTimeFor(peakStats(), "tiktok", "2026-10-21", NOW)).toBe("21:00");
    expect(bestTimeFor([], "x", undefined, NOW)).toBe("13:00");
    expect(bestTimeFor([], "tiktok", "2026-10-23", NOW)).toBe("21:30");
  });
});

describe("posts that only have a day", () => {
  /** A CSV row with a date and no time is stamped noon Riyadh and marked `timeKnown: false`. */
  const dayOnly = (day: string, views: number) => stat(`${day}T12:00`, views, { timeKnown: false });

  it("never learn from them: 20 of them are not 20 posts, and make no noon peak", () => {
    const r = learnBestTimes(
      Array.from({ length: 20 }, (_, i) =>
        dayOnly(`2026-09-${String(i + 1).padStart(2, "0")}`, 5000),
      ),
      "tiktok",
      NOW,
    );
    expect(r.ready).toBe(false);
    expect(r.posts).toBe(0);
    expect(r.top).toEqual([]);
  });

  it("leave a real peak where it is, however loud the day-only rows are", () => {
    const noisy = Array.from({ length: 30 }, (_, i) =>
      dayOnly(`2026-08-${String((i % 28) + 1).padStart(2, "0")}`, 90_000),
    );
    const r = learnBestTimes([...peakStats(), ...noisy], "tiktok", NOW);
    expect(r.posts).toBe(29);
    expect(r.top[0]).toMatchObject({ dow: 3, block: 10, time: "21:00" });
    expect(r.cells.filter((c) => c.block === 6).every((c) => c.n <= 5)).toBe(true);
    expect(timesForDay(r, "2026-10-21").times).not.toContain("12:00");
  });
});

describe("blockLabel", () => {
  it("names a 2-hour block by its hours", () => {
    expect(blockLabel(10)).toBe("20–22");
    expect(blockLabel(0)).toBe("00–02");
  });
});
