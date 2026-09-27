import { describe, expect, it } from "vitest";
import { skills } from "@/data";
import type { PlanItem as StoredPlanItem } from "@/lib/domain";
import { rankQuestCandidates } from "@/lib/planner";
import { buildWeekPlan, DAY_PREFERENCE, questMinutes } from "@/lib/weekPlan";
import { questXp } from "@/lib/xp";
import { DEFAULT_SETTINGS } from "@/store";
import {
  applyOverlay,
  backlog,
  isManual,
  isTombstone,
  lightestDay,
  manualId,
  manualRow,
  tombstoneFor,
} from "./overlay";

const WEEK = "2026-09-26"; // a Saturday (Riyadh)
const settings = DEFAULT_SETTINGS;

const derived = () => buildWeekPlan({ skills, completions: [], settings, weekStart: WEEK });
const candidates = () => rankQuestCandidates(skills, [], settings);

describe("applyOverlay", () => {
  it("returns the derived plan untouched when nothing is stored", () => {
    const plan = derived();
    const out = applyOverlay(plan, []);
    expect(out.items.map((i) => i.id)).toEqual(plan.items.map((i) => i.id));
    expect(out.items.every((i) => i.manual === false)).toBe(true);
    expect(out.minutes).toBe(plan.minutes);
    expect(out.xp).toBe(plan.xp);
    expect({ craft: out.craft, software: out.software, combos: out.combos }).toEqual({
      craft: plan.craft,
      software: plan.software,
      combos: plan.combos,
    });
  });

  it("a tombstone (by rules, minutes 0, derived id) hides that derived item and its minutes / XP", () => {
    const plan = derived();
    const gone = plan.items[0];
    const stone = tombstoneFor(WEEK, gone);
    expect(isTombstone(stone)).toBe(true);
    expect(isManual(stone)).toBe(false);
    const out = applyOverlay(plan, [stone]);
    expect(out.items.map((i) => i.id)).not.toContain(gone.id);
    expect(out.items).toHaveLength(plan.items.length - 1);
    expect(out.minutes).toBe(plan.minutes - gone.minutes);
    expect(out.xp).toBe(plan.xp - gone.xp);
  });

  it("a rules row with minutes > 0 is not a tombstone and hides nothing", () => {
    const plan = derived();
    const row: StoredPlanItem = { ...tombstoneFor(WEEK, plan.items[0]), minutes: 30 };
    expect(isTombstone(row)).toBe(false);
    expect(applyOverlay(plan, [row]).items).toHaveLength(plan.items.length);
  });

  it("a manual row (by me) adds an item with the skill's XP, kind and the 'you' flag", () => {
    const plan = derived();
    const pick = backlog(candidates(), plan)[0];
    const row = manualRow(WEEK, pick, 5);
    expect(isManual(row)).toBe(true);
    expect(row.id).toBe(manualId(WEEK, pick.skill.id, pick.quest));
    expect(row.minutes).toBe(questMinutes(pick.quest, pick.skill.tier));
    const out = applyOverlay(plan, [row]);
    const added = out.items.find((i) => i.id === row.id);
    expect(added).toMatchObject({
      manual: true,
      day: 5,
      skillId: pick.skill.id,
      quest: pick.quest,
      xp: questXp(pick.quest, pick.skill.tier),
    });
    expect(out.minutes).toBe(plan.minutes + row.minutes);
    expect(out.xp).toBe(plan.xp + added!.xp);
    expect(out.craft + out.software + out.combos).toBe(out.items.length);
  });

  it("ignores rows of other weeks and rows for unknown skills", () => {
    const plan = derived();
    const pick = backlog(candidates(), plan)[0];
    const otherWeek = manualRow("2026-10-03", pick, 1);
    const unknown: StoredPlanItem = { ...manualRow(WEEK, pick, 1), skillId: "no-such-skill" };
    const out = applyOverlay(plan, [otherWeek, unknown]);
    expect(out.items).toHaveLength(plan.items.length);
  });

  it("keeps items sorted by day, then heaviest first", () => {
    const plan = derived();
    const picks = backlog(candidates(), plan);
    const rows = [manualRow(WEEK, picks[0], 0), manualRow(WEEK, picks[1], 6)];
    const out = applyOverlay(plan, rows);
    for (let i = 1; i < out.items.length; i++) {
      const a = out.items[i - 1];
      const b = out.items[i];
      expect(a.day <= b.day).toBe(true);
      if (a.day === b.day) expect(a.minutes >= b.minutes).toBe(true);
    }
  });
});

describe("lightestDay", () => {
  it("picks the day with the least minutes, mid-week first on ties", () => {
    expect(lightestDay([])).toBe(DAY_PREFERENCE[0]);
    const items = DAY_PREFERENCE.map((day) => ({ day, minutes: 30 }));
    items[5] = { day: items[5].day, minutes: 0 };
    expect(lightestDay(items)).toBe(items[5].day);
  });

  it("the whole derived plan lands additions on an empty day when one exists", () => {
    const plan = derived();
    const day = lightestDay(plan.items);
    const used = new Set(plan.items.map((i) => i.day));
    if (used.size < 7) expect(used.has(day)).toBe(false);
  });
});

describe("backlog", () => {
  it("lists the next candidates on skills the plan does not cover, capped at 8", () => {
    const plan = derived();
    const list = backlog(candidates(), plan);
    expect(list.length).toBeLessThanOrEqual(8);
    expect(list.length).toBeGreaterThan(0);
    const planned = new Set(plan.items.flatMap((i) => [i.skillId, i.partnerSkillId]));
    for (const c of list) expect(planned.has(c.skill.id)).toBe(false);
  });

  it("drops a quest once it was added by hand", () => {
    const plan = derived();
    const first = backlog(candidates(), plan)[0];
    const out = applyOverlay(plan, [manualRow(WEEK, first, 2)]);
    expect(backlog(candidates(), out).map((c) => c.skill.id)).not.toContain(first.skill.id);
  });

  it("offers a removed derived quest again", () => {
    const plan = derived();
    const gone = plan.items.find((i) => i.kind !== "combo")!;
    const out = applyOverlay(plan, [tombstoneFor(WEEK, gone)]);
    expect(backlog(candidates(), out, 100).map((c) => c.skill.id)).toContain(gone.skillId);
  });
});
