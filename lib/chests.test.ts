import { describe, expect, it } from "vitest";
import {
  CHEST_EVERY,
  CHEST_GEMS,
  CREATIVE_PROMPTS,
  chestProgress,
  chestsEarned,
  lootFor,
} from "./chests";

describe("chests", () => {
  it("one chest every 5 quests", () => {
    expect(CHEST_EVERY).toBe(5);
    expect(chestsEarned(0)).toBe(0);
    expect(chestsEarned(4)).toBe(0);
    expect(chestsEarned(5)).toBe(1);
    expect(chestsEarned(14)).toBe(2);
  });

  it("chestProgress fills toward the next chest and flags a waiting one", () => {
    expect(chestProgress(3, 0)).toEqual({ done: 3, needed: 5, ready: false, pending: 0 });
    expect(chestProgress(5, 0)).toEqual({ done: 5, needed: 5, ready: true, pending: 1 });
    expect(chestProgress(7, 1)).toEqual({ done: 2, needed: 5, ready: false, pending: 0 });
    expect(chestProgress(12, 0)).toEqual({ done: 5, needed: 5, ready: true, pending: 2 });
  });

  it("loot is deterministic and never leaves the table", () => {
    for (let n = 1; n <= 60; n++) {
      const a = lootFor(n);
      expect(lootFor(n)).toEqual(a);
      if (a.kind === "gems") expect(CHEST_GEMS).toContain(a.amount);
      if (a.kind === "freeze") expect(a.amount).toBe(1);
      if (a.kind === "prompt") expect(CREATIVE_PROMPTS[a.index]).toEqual(a.prompt);
    }
  });

  it("every loot kind shows up within the first 30 chests", () => {
    const kinds = new Set(Array.from({ length: 30 }, (_, i) => lootFor(i + 1).kind));
    expect([...kinds].sort()).toEqual(["freeze", "gems", "prompt"]);
  });

  it("has at least 8 bilingual prompts", () => {
    expect(CREATIVE_PROMPTS.length).toBeGreaterThanOrEqual(8);
    for (const p of CREATIVE_PROMPTS) {
      expect(p.ar.length).toBeGreaterThan(0);
      expect(p.en.length).toBeGreaterThan(0);
    }
  });
});
