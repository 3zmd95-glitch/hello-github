import { describe, expect, it } from "vitest";
import { xpForLevel } from "./level";
import { FINAL_RANK_END_LEVEL, RANKS, rankFromXp, rankIndexForLevel, tierLabel } from "./rank";

describe("ranks", () => {
  it("has 17 ranks at the planned levels", () => {
    expect(RANKS).toHaveLength(17);
    expect(RANKS.map((r) => r.level)).toEqual([
      1, 2, 3, 5, 6, 8, 10, 12, 15, 18, 21, 24, 28, 32, 36, 42, 50,
    ]);
    expect(RANKS[0]).toEqual({ level: 1, ar: "مبتدئ متحمّس", en: "Hyped Beginner" });
    expect(RANKS[16]).toEqual({ level: 50, ar: "عزّ الأساطير", en: "Glory of Legends" });
  });

  it("starts as Hyped Beginner I", () => {
    const r = rankFromXp(0);
    expect(r.index).toBe(0);
    expect(r.tier).toBe(1);
    expect(r.nextRank?.en).toBe("Shot Hunter");
    expect(r.step).toBe(1);
  });

  it("splits a rank into thirds by XP", () => {
    // Rank 0 runs from level 1 (0 XP) to level 2 (141 XP): thirds at 47 and 94.
    expect(rankFromXp(46).tier).toBe(1);
    expect(rankFromXp(47).tier).toBe(2);
    expect(rankFromXp(93).tier).toBe(2);
    expect(rankFromXp(94).tier).toBe(3);
    expect(rankFromXp(140).tier).toBe(3);
    const next = rankFromXp(141);
    expect(next.index).toBe(1);
    expect(next.tier).toBe(1);
  });

  it("skipped levels stay in the previous rank (level 4 is still Camera Carrier)", () => {
    expect(rankIndexForLevel(4)).toBe(2);
    const r = rankFromXp(xpForLevel(4));
    expect(r.rank.en).toBe("Camera Carrier");
    expect(r.startXp).toBe(xpForLevel(3));
    expect(r.endXp).toBe(xpForLevel(5));
  });

  it("final rank tiers run to level 60", () => {
    const start = xpForLevel(50);
    const end = xpForLevel(FINAL_RANK_END_LEVEL);
    const r = rankFromXp(start);
    expect(r.rank.en).toBe("Glory of Legends");
    expect(r.nextRank).toBeNull();
    expect(r.tier).toBe(1);
    expect(r.endXp).toBe(end);
    expect(rankFromXp(start + Math.ceil((end - start) / 3)).tier).toBe(2);
    expect(rankFromXp(end - 1).tier).toBe(3);
    expect(rankFromXp(end * 10).tier).toBe(3);
    expect(rankFromXp(end * 10).step).toBe(51);
  });

  it("step never decreases as XP grows", () => {
    let last = 0;
    for (let xp = 0; xp < xpForLevel(61); xp += 37) {
      const s = rankFromXp(xp).step;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(last).toBe(51);
  });

  it("labels tiers", () => {
    expect([1, 2, 3].map((t) => tierLabel(t as 1 | 2 | 3))).toEqual(["I", "II", "III"]);
  });
});
