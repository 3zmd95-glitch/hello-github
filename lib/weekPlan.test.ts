import { describe, expect, it } from "vitest";
import { skills as seedSkills } from "@/data";
import { DEFAULT_SETTINGS } from "@/store";
import type { Program, QuestCompletion, QuestType, Skill } from "./domain";
import { QUEST_TYPES } from "./domain";
import {
  buildWeekPlan,
  isItemDone,
  itemQuests,
  MAX_ITEMS,
  planProgress,
  questMinutes,
  WEEK_BUDGET_MIN,
} from "./weekPlan";
import { doneQuestsBySkill } from "./planner";
import { addDays } from "./streak";

/* ---------- Fixtures ---------- */

const WEEK = "2026-09-26"; // a Saturday (Riyadh)
const settings = DEFAULT_SETTINGS; // phone + lights, Studio edition

const programs: Program[] = [
  {
    id: "camera",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "الكاميرا", en: "Camera" },
    icon: "📷",
    color: "#4f8cff",
    sections: [{ id: "s", name: { ar: "س", en: "S" } }],
  },
  {
    id: "davinci",
    pillarId: "editing",
    kind: "app",
    name: { ar: "دافنشي", en: "DaVinci" },
    icon: "🎬",
    color: "#e0493b",
    sections: [{ id: "s", name: { ar: "س", en: "S" } }],
  },
];

const q = (s: string) => ({ ar: s, en: s });
function skill(id: string, programId: string, tier: 1 | 2 | 3 = 1): Skill {
  return {
    id,
    programId,
    sectionId: "s",
    name: q(id),
    tier,
    gear: "any",
    studio: false,
    source: "draft",
    quests: { train: q("t"), research: q("r"), produce: q("p"), article: q("a") },
    refs: [],
  };
}

/** A completion on a day key (noon Riyadh), or before the week by default. */
function done(skillId: string, quest: QuestType, day = addDays(WEEK, -3)): QuestCompletion {
  return { skillId, quest, at: `${day}T12:00:00+03:00` };
}

const seedPlan = () =>
  buildWeekPlan({ skills: seedSkills, completions: [], settings, weekStart: WEEK });

/* ---------- Tests ---------- */

describe("questMinutes", () => {
  it("scales by tier and rounds to 5 minutes", () => {
    expect(questMinutes("train", 1)).toBe(30);
    expect(questMinutes("research", 2)).toBe(25);
    expect(questMinutes("produce", 2)).toBe(75);
    expect(questMinutes("produce", 3)).toBe(90);
    expect(questMinutes("article", 2)).toBe(55);
    expect(questMinutes("article", 3)).toBe(70);
    for (const quest of QUEST_TYPES)
      for (const tier of [1, 2, 3] as const) expect(questMinutes(quest, tier) % 5).toBe(0);
  });
});

describe("buildWeekPlan", () => {
  it("respects the budget and never plans more than one item per day", () => {
    const plan = seedPlan();
    expect(plan.budgetMin).toBe(WEEK_BUDGET_MIN);
    expect(plan.minutes).toBeLessThanOrEqual(WEEK_BUDGET_MIN);
    expect(plan.minutes).toBe(plan.items.reduce((n, i) => n + i.minutes, 0));
    expect(plan.xp).toBe(plan.items.reduce((n, i) => n + i.xp, 0));
    expect(plan.items.length).toBeGreaterThanOrEqual(3);
    expect(plan.items.length).toBeLessThanOrEqual(MAX_ITEMS);
    for (const item of plan.items) expect(item.day).toBeGreaterThanOrEqual(0);
    for (const item of plan.items) expect(item.day).toBeLessThanOrEqual(6);
  });

  it("respects a small custom budget", () => {
    const plan = buildWeekPlan({
      skills: seedSkills,
      completions: [],
      settings,
      weekStart: WEEK,
      budgetMin: 60,
    });
    expect(plan.minutes).toBeLessThanOrEqual(60);
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.combos).toBe(0); // a combo needs two produce quests, more than 60 min
  });

  it("is deterministic for the same input and rotates ties with the seed", () => {
    expect(seedPlan()).toEqual(seedPlan());
    const other = buildWeekPlan({
      skills: seedSkills,
      completions: [],
      settings,
      weekStart: WEEK,
      seed: "another-week",
    });
    expect(other.minutes).toBeLessThanOrEqual(WEEK_BUDGET_MIN);
    expect(other.items.map((i) => i.id)).not.toEqual(seedPlan().items.map((i) => i.id));
  });

  it("hits the weekly mix with the seed data: 1 combo, ≥ 1 craft, ≥ 1 software", () => {
    const plan = seedPlan();
    expect(plan.combos).toBe(1);
    expect(plan.craft).toBeGreaterThanOrEqual(1);
    expect(plan.software).toBeGreaterThanOrEqual(1);
    const combo = plan.items.find((i) => i.kind === "combo")!;
    expect(combo.comboId).toBe("log-cst");
    expect(combo.skillId).toBe("iphone-log-prores");
    expect(combo.partnerSkillId).toBe("cst-log-workflow");
    expect(combo.quest).toBe("produce");
    expect(itemQuests(combo)).toHaveLength(2);
    // The combo's skills are not planned twice.
    const others = plan.items.filter((i) => i.kind !== "combo").map((i) => i.skillId);
    expect(others).not.toContain("iphone-log-prores");
    expect(others).not.toContain("cst-log-workflow");
    // Each item carries a bilingual reason and stable id.
    for (const item of plan.items) {
      expect(item.reason.ar.length).toBeGreaterThan(0);
      expect(item.reason.en.length).toBeGreaterThan(0);
      expect(item.id.startsWith(`${WEEK}:`)).toBe(true);
    }
  });

  it("never puts two produce quests on the same day and puts the heaviest item mid-week", () => {
    // Six skills whose next quest is produce (research + train done before the week).
    const skills = [
      ...[1, 2, 3].map((n) => skill(`c${n}`, "camera")),
      ...[1, 2, 3].map((n) => skill(`d${n}`, "davinci")),
    ];
    const completions = skills.flatMap((s) => [done(s.id, "train"), done(s.id, "research")]);
    const plan = buildWeekPlan({
      skills,
      completions,
      settings,
      weekStart: WEEK,
      programs,
      budgetMin: 600,
    });
    const produceDays = plan.items.filter((i) => i.quest === "produce").map((i) => i.day);
    expect(new Set(produceDays).size).toBe(produceDays.length);
    const heaviest = [...plan.items].sort((a, b) => b.minutes - a.minutes)[0];
    expect([2, 3, 4]).toContain(heaviest.day);
  });

  it("never plans a quest completed before the week, and marks quests completed during it as done", () => {
    const skills = [skill("c1", "camera"), skill("c2", "camera"), skill("d1", "davinci")];
    const before = [done("c1", "research")];
    const plan = buildWeekPlan({
      skills,
      completions: before,
      settings,
      weekStart: WEEK,
      programs,
    });
    expect(plan.items.some((i) => i.skillId === "c1" && i.quest === "research")).toBe(false);
    // c1 is nearest to mastery, so the generic combo takes its produce quest; c2 gets the craft slot.
    expect(plan.items.find((i) => i.kind === "combo")?.skillId).toBe("c1");
    expect(plan.items.some((i) => i.skillId === "c2" && i.quest === "research")).toBe(true);

    // Ticking a planned item mid-week: the plan itself does not change, the item is just done.
    const planned = plan.items.find((i) => i.kind !== "combo")!;
    const during = [...before, done(planned.skillId, planned.quest, addDays(WEEK, 2))];
    const same = buildWeekPlan({
      skills,
      completions: during,
      settings,
      weekStart: WEEK,
      programs,
    });
    expect(same.items.map((i) => i.id)).toEqual(plan.items.map((i) => i.id));
    expect(isItemDone(planned, doneQuestsBySkill(during))).toBe(true);

    const progress = planProgress(plan, during);
    expect(progress).toEqual({
      done: 1,
      total: plan.items.length,
      minutesDone: planned.minutes,
      xpDone: planned.xp,
    });
  });

  it("counts a combo as done only when both produce quests are completed", () => {
    const plan = seedPlan();
    const combo = plan.items.find((i) => i.kind === "combo")!;
    const half = [done(combo.skillId, "produce", addDays(WEEK, 3))];
    expect(planProgress(plan, half).done).toBe(0);
    const both = [...half, done(combo.partnerSkillId!, "produce", addDays(WEEK, 3))];
    expect(planProgress(plan, both).done).toBe(1);
    expect(planProgress(plan, both).xpDone).toBe(combo.xp);
  });

  it("returns an empty plan when nothing is available", () => {
    const empty = buildWeekPlan({ skills: [], completions: [], settings, weekStart: WEEK });
    expect(empty).toEqual({
      week: WEEK,
      items: [],
      minutes: 0,
      xp: 0,
      budgetMin: WEEK_BUDGET_MIN,
      craft: 0,
      software: 0,
      combos: 0,
    });
    const locked = buildWeekPlan({
      skills: seedSkills,
      completions: [],
      settings: { gear: [], davinciEdition: "free" },
      weekStart: WEEK,
    });
    // Only gear-free, non-Studio skills remain, still within budget.
    expect(locked.minutes).toBeLessThanOrEqual(WEEK_BUDGET_MIN);
    for (const item of locked.items) {
      const s = seedSkills.find((x) => x.id === item.skillId)!;
      expect(s.gear).toBe("any");
      expect(s.studio).toBe(false);
    }
    expect(planProgress(empty, [])).toEqual({ done: 0, total: 0, minutesDone: 0, xpDone: 0 });
  });
});
