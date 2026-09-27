import { describe, expect, it } from "vitest";
import type { GemEvent } from "./domain";
import {
  FREEZE_REWARD_ID,
  GEM_RULES,
  canBuy,
  defaultRewards,
  ensureBuiltInRewards,
  gemBalance,
  questGems,
  rewardText,
} from "./gems";

const ev = (amount: number, reason: GemEvent["reason"] = "quest"): GemEvent => ({
  id: String(Math.random()),
  amount,
  at: "2026-09-26T10:00:00.000Z",
  reason,
});

describe("gems", () => {
  it("quest gems are xp/5 rounded, at least 1", () => {
    expect(questGems(15)).toBe(3);
    expect(questGems(10)).toBe(2);
    expect(questGems(3)).toBe(1);
    expect(questGems(0)).toBe(1);
    expect(questGems(38)).toBe(8);
    expect(questGems(60)).toBe(12);
  });

  it("has the documented fixed awards", () => {
    expect(GEM_RULES).toEqual({
      mastery: 10,
      dayComplete: 5,
      review: 5,
      badge: 15,
      boss: 50,
      season: 30,
    });
  });

  it("balance sums the ledger, purchases are negative", () => {
    expect(gemBalance([])).toBe(0);
    expect(gemBalance([ev(20), ev(5, "dayComplete"), ev(-40, "purchase")])).toBe(-15);
  });
});

describe("rewards shop rules", () => {
  it("seeds the built-in freeze and three editable examples", () => {
    const r = defaultRewards();
    expect(r.map((x) => x.id)).toEqual([FREEZE_REWARD_ID, "dinner", "lut-pack", "pro-mist"]);
    expect(r[0]).toMatchObject({ cost: 40, repeatable: true, builtIn: true });
    expect(r.filter((x) => x.builtIn)).toHaveLength(1);
    expect(r.find((x) => x.id === "pro-mist")).toMatchObject({ cost: 600, minLevel: 10 });
  });

  it("ensureBuiltInRewards re-adds a missing freeze and keeps the rest", () => {
    const custom = { id: "x", name: "X", cost: 1, repeatable: true, icon: "x" };
    expect(ensureBuiltInRewards([custom]).map((r) => r.id)).toEqual([FREEZE_REWARD_ID, "x"]);
    const all = defaultRewards();
    expect(ensureBuiltInRewards(all)).toEqual(all);
  });

  it("rewardText picks the language or the plain string", () => {
    expect(rewardText("Dinner", "ar")).toBe("Dinner");
    expect(rewardText({ ar: "عشا", en: "Dinner" }, "en")).toBe("Dinner");
    expect(rewardText({ ar: "عشا", en: "Dinner" }, "ar")).toBe("عشا");
    expect(rewardText(undefined, "ar")).toBe("");
  });

  it("canBuy checks unknown → level → owned → gems", () => {
    const [freeze, , lut, mist] = defaultRewards();
    expect(canBuy(undefined, { gems: 999, level: 99, owned: false })).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(canBuy(mist, { gems: 999, level: 9, owned: false })).toEqual({
      ok: false,
      reason: "level",
    });
    expect(canBuy(lut, { gems: 999, level: 1, owned: true })).toEqual({
      ok: false,
      reason: "owned",
    });
    expect(canBuy(freeze, { gems: 39, level: 1, owned: true })).toEqual({
      ok: false,
      reason: "gems",
    });
    expect(canBuy(freeze, { gems: 40, level: 1, owned: true })).toEqual({ ok: true });
  });
});
