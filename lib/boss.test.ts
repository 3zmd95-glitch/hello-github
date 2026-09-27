import { describe, expect, it } from "vitest";
import type { XpEvent } from "./domain";
import { xpForLevel } from "./level";
import {
  BOSSES,
  BOSS_BASE_HP,
  bossDamage,
  bossForMonth,
  bossHp,
  bossState,
  daysInMonth,
  monthKey,
} from "./boss";

const ev = (amount: number, at: string, source: XpEvent["source"] = "quest"): XpEvent => ({
  id: `${at}-${amount}-${source}`,
  source,
  amount,
  at,
});

describe("boss", () => {
  it("has at least 6 bilingual bosses", () => {
    expect(BOSSES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(BOSSES.map((b) => b.id)).size).toBe(BOSSES.length);
    for (const b of BOSSES) {
      expect(b.name.ar).toBeTruthy();
      expect(b.name.en).toBeTruthy();
      expect(b.hp).toBe(BOSS_BASE_HP);
    }
  });

  it("monthKey uses the Riyadh day", () => {
    expect(monthKey("2026-09-30T21:30:00Z")).toBe("2026-10"); // already October in Riyadh
    expect(monthKey("2026-09-30T20:30:00Z")).toBe("2026-09");
  });

  it("rotates bosses month by month and wraps at year ends", () => {
    const a = bossForMonth("2026-09");
    const b = bossForMonth("2026-10");
    expect(a.id).not.toBe(b.id);
    expect(bossForMonth("2026-12").id).not.toBe(bossForMonth("2027-01").id);
    const cycle = Array.from(
      { length: BOSSES.length },
      (_, i) => bossForMonth(`2027-${String(i + 1).padStart(2, "0")}`).id,
    );
    expect(new Set(cycle).size).toBe(BOSSES.length);
  });

  it("HP is 300 at level 1 and grows 10 % per level", () => {
    expect(bossHp(BOSSES[0], 1)).toBe(300);
    expect(bossHp(BOSSES[0], 3)).toBe(360);
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2028-02")).toBe(29);
  });

  it("damage counts quest, mastery, drill and review XP of the month only", () => {
    const events = [
      ev(15, "2026-09-05T10:00:00Z"),
      ev(20, "2026-09-06T10:00:00Z", "mastery"),
      ev(5, "2026-09-07T10:00:00Z", "drill"),
      ev(10, "2026-09-08T10:00:00Z", "review"),
      ev(3, "2026-09-08T11:00:00Z", "micro"),
      ev(40, "2026-08-31T10:00:00Z"),
      ev(40, "2026-09-30T21:30:00Z"), // October in Riyadh
    ];
    expect(bossDamage(events, "2026-09")).toBe(50);
    const s = bossState(events, new Date("2026-09-27T10:00:00Z"));
    expect(s.month).toBe("2026-09");
    expect(s.hp).toBe(300); // 40 XP before the month → still level 1
    expect(s).toMatchObject({ damage: 50, hpLeft: 250, defeated: false, daysLeft: 4 });
    expect(s.ratio).toBeCloseTo(50 / 300);
  });

  it("scales HP with the level at month start and flags defeat", () => {
    const before = [ev(xpForLevel(3), "2026-08-10T10:00:00Z")]; // level 3 before September
    const s = bossState(before, new Date("2026-09-01T10:00:00Z"));
    expect(s.hp).toBe(360);
    expect(s.daysLeft).toBe(30);
    const win = bossState(
      [...before, ev(400, "2026-09-02T10:00:00Z")],
      new Date("2026-09-02T10:00:00Z"),
    );
    expect(win.defeated).toBe(true);
    expect(win.hpLeft).toBe(0);
    expect(win.ratio).toBe(1);
  });
});
