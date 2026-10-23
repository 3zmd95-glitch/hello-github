import { describe, expect, it } from "vitest";
import { FAMILY_QUERIES, QUERIES_PER_DAY, familiesForDay } from "./families";

describe("effect families", () => {
  it("has 18 unique queries, 6 a day, each searched once in every 3 days", () => {
    expect(FAMILY_QUERIES).toHaveLength(18);
    expect(new Set(FAMILY_QUERIES).size).toBe(18);
    const days = ["2026-10-06", "2026-10-07", "2026-10-08"].map(familiesForDay);
    for (const day of days) expect(day).toHaveLength(QUERIES_PER_DAY);
    // Each day reserves two of the existing six searches for specific song/format discovery; no extra budget.
    for (const day of days) {
      expect(day[4]).toMatch(/song|beat|music/);
      expect(day[5]).toMatch(/audio|song/);
    }
    expect(days.flat().sort()).toEqual([...FAMILY_QUERIES].sort());
    expect(familiesForDay("2026-10-09")).toEqual(days[0]);
  });
});
