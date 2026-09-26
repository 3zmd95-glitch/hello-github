import { describe, expect, it } from "vitest";
import {
  FOCUS_MULT,
  MASTERY_BONUS,
  MICRO_XP_MAX,
  MICRO_XP_MIN,
  QUEST_XP,
  TIER_MULT,
  microXp,
  questXp,
  skillMaxXp,
} from "./xp";

describe("xp", () => {
  it("has the v1 base values", () => {
    expect(QUEST_XP).toEqual({ train: 10, research: 15, produce: 25, article: 30 });
    expect(MASTERY_BONUS).toBe(20);
    expect(TIER_MULT).toEqual({ 1: 1, 2: 1.5, 3: 2 });
    expect(FOCUS_MULT).toBe(1.25);
  });

  it("scales quest XP by tier", () => {
    expect(questXp("train", 1)).toBe(10);
    expect(questXp("train", 2)).toBe(15);
    expect(questXp("train", 3)).toBe(20);
    expect(questXp("article", 3)).toBe(60);
  });

  it("rounds to integers", () => {
    // 25 × 1.5 = 37.5 → 38 ; 15 × 1.5 = 22.5 → 23
    expect(questXp("produce", 2)).toBe(38);
    expect(questXp("research", 2)).toBe(23);
    for (const t of [1, 2, 3] as const)
      for (const q of ["train", "research", "produce", "article"] as const)
        expect(Number.isInteger(questXp(q, t))).toBe(true);
  });

  it("computes the full XP of a skill", () => {
    expect(skillMaxXp(1)).toBe(80 + 20);
    expect(skillMaxXp(2)).toBe(15 + 23 + 38 + 45 + 20);
  });

  it("micro-action XP is 3, inside the 2–5 range", () => {
    expect(microXp()).toBe(3);
    expect(microXp()).toBeGreaterThanOrEqual(MICRO_XP_MIN);
    expect(microXp()).toBeLessThanOrEqual(MICRO_XP_MAX);
  });
});
