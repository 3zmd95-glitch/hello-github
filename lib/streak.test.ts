import { describe, expect, it } from "vitest";
import {
  addDays,
  bonusFreezesSpent,
  computeStreak,
  countActiveWeeks,
  dayKey,
  daysBetween,
  daysToFreeze,
  earnedFreezeStock,
  freezeStock,
  freezesEarned,
  weekKey,
} from "./streak";

const set = (...d: string[]) => new Set(d);

describe("dayKey (Riyadh)", () => {
  it("uses the Riyadh day boundary (UTC+3)", () => {
    expect(dayKey(new Date("2026-09-26T20:59:59Z"))).toBe("2026-09-26"); // 23:59:59 Riyadh
    expect(dayKey(new Date("2026-09-26T21:00:00Z"))).toBe("2026-09-27"); // 00:00 Riyadh
    expect(dayKey("2026-01-01T00:30:00+03:00")).toBe("2026-01-01");
    expect(dayKey("2025-12-31T21:30:00Z")).toBe("2026-01-01");
  });

  it("does day arithmetic across months and years", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-09-20", "2026-09-27")).toBe(7);
  });

  it("weeks start on Saturday", () => {
    expect(weekKey("2026-09-26")).toBe("2026-09-26"); // Saturday
    expect(weekKey("2026-10-02")).toBe("2026-09-26"); // Friday
    expect(weekKey("2026-10-03")).toBe("2026-10-03"); // next Saturday
  });
});

describe("computeStreak", () => {
  const today = "2026-09-26";

  it("is zero with no activity", () => {
    expect(computeStreak(set(), set(), today)).toEqual({ current: 0, best: 0, todayDone: false });
  });

  it("counts consecutive days ending today", () => {
    const r = computeStreak(set("2026-09-24", "2026-09-25", "2026-09-26"), set(), today);
    expect(r).toEqual({ current: 3, best: 3, todayDone: true });
  });

  it("keeps the streak alive until today ends", () => {
    const r = computeStreak(set("2026-09-24", "2026-09-25"), set(), today);
    expect(r).toEqual({ current: 2, best: 2, todayDone: false });
  });

  it("breaks after a missed day", () => {
    const r = computeStreak(
      set("2026-09-20", "2026-09-21", "2026-09-22", "2026-09-24"),
      set(),
      today,
    );
    expect(r.current).toBe(0);
    expect(r.best).toBe(3);
  });

  it("a freeze bridges a missed day but does not add to the count", () => {
    const active = set("2026-09-23", "2026-09-25", "2026-09-26");
    expect(computeStreak(active, set(), today).current).toBe(2);
    expect(computeStreak(active, set("2026-09-24"), today)).toEqual({
      current: 3,
      best: 3,
      todayDone: true,
    });
  });

  it("a freeze on yesterday keeps an unfinished today alive", () => {
    const r = computeStreak(set("2026-09-24"), set("2026-09-25"), today);
    expect(r.current).toBe(1);
    expect(r.todayDone).toBe(false);
  });

  it("accepts a Date for today", () => {
    const r = computeStreak(set("2026-09-26"), set(), new Date("2026-09-26T20:00:00Z"));
    expect(r.todayDone).toBe(true);
    const late = computeStreak(set("2026-09-26"), set(), new Date("2026-09-26T21:30:00Z"));
    expect(late).toEqual({ current: 1, best: 1, todayDone: false }); // already the 27th in Riyadh
  });

  it("ignores future days in best", () => {
    expect(computeStreak(set("2026-09-27", "2026-09-28"), set(), today).best).toBe(0);
  });
});

describe("freezes", () => {
  it("earns 1 per active week, capped at 2", () => {
    expect(freezesEarned(0)).toBe(0);
    expect(freezesEarned(1)).toBe(1);
    expect(freezesEarned(5)).toBe(2);
  });

  it("counts active Sat–Fri weeks", () => {
    expect(countActiveWeeks(["2026-09-26", "2026-10-02", "2026-10-03"])).toBe(2);
  });

  it("stock goes up per active week and down per used freeze", () => {
    const active = set("2026-09-12", "2026-09-19", "2026-09-26"); // 3 Saturdays → 3 weeks
    expect(freezeStock(active, set(), "2026-09-26")).toBe(2);
    expect(freezeStock(active, set("2026-09-20"), "2026-09-26")).toBe(2); // 2 → 1 → +1 = 2
    expect(freezeStock(set("2026-09-12"), set("2026-09-13"), "2026-09-14")).toBe(0);
  });

  it("bonus freezes add on top of the earned stock, capped at 5 in total", () => {
    const active = set("2026-09-12", "2026-09-19", "2026-09-26"); // earned 2
    expect(freezeStock(active, set(), "2026-09-26", 1)).toBe(3);
    expect(freezeStock(active, set(), "2026-09-26", 9)).toBe(5);
    expect(freezeStock(set(), set(), "2026-09-26", 2)).toBe(2);
    expect(earnedFreezeStock(active, set(), "2026-09-26")).toBe(2);
  });

  it("earned freezes are spent first, bonus ones last", () => {
    const active = set("2026-09-18", "2026-09-19", "2026-09-23"); // earned 2
    // A 3-day gap needs 2 earned + 1 bonus.
    expect(daysToFreeze(active, set(), "2026-09-27")).toEqual([]);
    const gap = daysToFreeze(active, set(), "2026-09-27", 1);
    expect(gap).toEqual(["2026-09-24", "2026-09-25", "2026-09-26"]);
    expect(bonusFreezesSpent(active, set(), "2026-09-27", gap.length)).toBe(1);
    // After spending: the earned walk clamps at 0 for the bonus-paid day, so earned stock is 0, not −1.
    const used = set(...gap);
    expect(earnedFreezeStock(active, used, "2026-09-27")).toBe(0);
    expect(freezeStock(active, used, "2026-09-27", 0)).toBe(0);
    // A 1-day gap with 2 earned costs no bonus freeze.
    expect(bonusFreezesSpent(active, set(), "2026-09-25", 1)).toBe(0);
  });

  it("daysToFreeze returns the gap when stock covers it", () => {
    const active = set("2026-09-18", "2026-09-19", "2026-09-23"); // Fri + Sat: 2 weeks → stock 2
    expect(daysToFreeze(active, set(), "2026-09-25")).toEqual(["2026-09-24"]);
    expect(daysToFreeze(active, set(), "2026-09-26")).toEqual(["2026-09-24", "2026-09-25"]);
    expect(daysToFreeze(active, set(), "2026-09-27")).toEqual([]); // 3 missing > stock
    expect(daysToFreeze(active, set(), "2026-09-24")).toEqual([]); // nothing missing yet
    expect(daysToFreeze(set(), set(), "2026-09-24")).toEqual([]);
  });
});
