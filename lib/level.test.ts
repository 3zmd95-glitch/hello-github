import { describe, expect, it } from "vitest";
import { levelFromXp, levelProgress, xpForLevel } from "./level";

describe("level curve", () => {
  it("level 1 is free, then 50·n^1.5", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(141); // 50 × 2.828
    expect(xpForLevel(3)).toBe(260);
    expect(xpForLevel(4)).toBe(400);
    expect(xpForLevel(10)).toBe(1581);
    expect(xpForLevel(60)).toBe(23238);
  });

  it("is strictly increasing", () => {
    for (let n = 1; n < 100; n++) expect(xpForLevel(n + 1)).toBeGreaterThan(xpForLevel(n));
  });

  it("levelFromXp matches thresholds exactly at the edges", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(-5)).toBe(1);
    expect(levelFromXp(140)).toBe(1);
    expect(levelFromXp(141)).toBe(2);
    expect(levelFromXp(259)).toBe(2);
    expect(levelFromXp(260)).toBe(3);
    for (let n = 2; n <= 80; n++) {
      expect(levelFromXp(xpForLevel(n))).toBe(n);
      expect(levelFromXp(xpForLevel(n) - 1)).toBe(n - 1);
    }
  });

  it("levelProgress reports progress inside the level", () => {
    expect(levelProgress(0)).toEqual({ level: 1, current: 0, needed: 141, ratio: 0 });
    const p = levelProgress(200);
    expect(p.level).toBe(2);
    expect(p.current).toBe(59);
    expect(p.needed).toBe(119);
    expect(p.ratio).toBeCloseTo(59 / 119);
    expect(levelProgress(260).ratio).toBe(0);
  });
});
