import { programs as seedPrograms } from "@/data";
import { skillKind, suggestCombo, type Combo, type SkillKind } from "./combo";
import type { LText, Program, QuestCompletion, QuestType, Settings, Skill, Tier } from "./domain";
import { doneQuestsBySkill, rankQuestCandidates, type QuestPick } from "./planner";
import { dayKey } from "./streak";

/**
 * Weekly plan, rules-based (build plan 2.3; AI drafting comes in Sprint 4).
 * The week is Saturday–Friday in Riyadh (see streak.ts). Everything here is pure and deterministic:
 * the same progress + settings + week always give the same plan, so nothing needs to be stored yet.
 *
 * Note: combo.ts imports the time table below and this file imports `suggestCombo`; the cycle is safe
 * because neither module calls the other at load time. Keep it that way.
 */

/* ---------- Time model (round 8: < 5 h/week) ---------- */

/** Minutes one quest takes at tier 1. */
export const QUEST_MINUTES: Record<QuestType, number> = {
  train: 30,
  research: 20,
  produce: 60,
  article: 45,
};

/** Time factor per difficulty tier (XP uses its own multipliers in xp.ts). */
export const TIER_TIME: Record<Tier, number> = { 1: 1, 2: 1.25, 3: 1.5 };

/** Weekly time budget: 5 hours. */
export const WEEK_BUDGET_MIN = 300;

/** At most one planned item per day of the week; the budget usually stops the plan earlier. */
export const MAX_ITEMS = 7;

/**
 * Where the heaviest item goes first: Tue, Mon, Wed (mid-week), then Sun, Thu, and the light
 * ends of the week last (Sat, Fri). Days are 0 = Saturday … 6 = Friday.
 */
export const DAY_PREFERENCE: readonly number[] = [3, 2, 4, 1, 5, 0, 6];

/** Minutes for one quest, scaled by tier and rounded to 5 minutes. */
export function questMinutes(quest: QuestType, tier: Tier): number {
  return Math.round((QUEST_MINUTES[quest] * TIER_TIME[tier]) / 5) * 5;
}

/* ---------- Types ---------- */

export type PlanKind = SkillKind | "combo";

export interface PlanItem {
  /** Stable across rebuilds: "week:skillId:quest" or "week:combo:comboId". */
  id: string;
  /** 0 = Saturday … 6 = Friday. */
  day: number;
  skillId: string;
  quest: QuestType;
  /** Combo only: the software skill whose produce quest is finished with the same clip. */
  partnerSkillId?: string;
  minutes: number;
  xp: number;
  kind: PlanKind;
  comboId?: string;
  /** Short bilingual coach reason (round 15). */
  reason: LText;
}

export interface WeekPlan {
  /** Saturday day key that starts the week. */
  week: string;
  items: PlanItem[];
  minutes: number;
  xp: number;
  budgetMin: number;
  craft: number;
  software: number;
  combos: number;
}

export interface WeekPlanInput {
  skills: readonly Skill[];
  completions: readonly QuestCompletion[];
  settings: Pick<Settings, "gear" | "davinciEdition">;
  /** Saturday day key ("YYYY-MM-DD") that starts the week (streak.ts `weekKey`). */
  weekStart: string;
  budgetMin?: number;
  /** Tie-breaker between equally ranked candidates; defaults to the week key. */
  seed?: string | number;
  /** Program list used to tell craft from software; defaults to the seed programs. */
  programs?: readonly Program[];
}

export interface PlanProgress {
  done: number;
  total: number;
  minutesDone: number;
  xpDone: number;
}

/* ---------- Reasons ---------- */

const REASON = {
  combo: (): LText => ({
    ar: "كومبو الأسبوع: صوّر وعدّل في كليب واحد",
    en: "This week's combo: shoot and edit one clip",
  }),
  mastery: (done: number): LText => ({
    ar: `أقرب للإتقان ${done}/4`,
    en: `Nearest to mastery ${done}/4`,
  }),
  balance: (): LText => ({
    ar: "يحفظ التوازن بين الحرفة والبرامج",
    en: "Keeps the craft/software balance",
  }),
  fits: (minutes: number): LText => ({
    ar: `يناسب الـ ${minutes} دقيقة الباقية`,
    en: `Fits the remaining ${minutes} min`,
  }),
};

/* ---------- Helpers ---------- */

/** FNV-1a, so tie-breaking is stable for the same seed and skill. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The (skillId, quest) pairs an item completes: one for a quest, two for a combo. */
export function itemQuests(item: PlanItem): { skillId: string; quest: QuestType }[] {
  const list = [{ skillId: item.skillId, quest: item.quest }];
  if (item.partnerSkillId) list.push({ skillId: item.partnerSkillId, quest: item.quest });
  return list;
}

/** An item is done when every quest it covers is completed (at any time, before or during the week). */
export function isItemDone(
  item: PlanItem,
  done: ReadonlyMap<string, ReadonlySet<QuestType>>,
): boolean {
  return itemQuests(item).every((q) => done.get(q.skillId)?.has(q.quest) ?? false);
}

export function planProgress(
  plan: Pick<WeekPlan, "items">,
  completions: readonly QuestCompletion[],
): PlanProgress {
  const done = doneQuestsBySkill(completions);
  const progress: PlanProgress = { done: 0, total: plan.items.length, minutesDone: 0, xpDone: 0 };
  for (const item of plan.items) {
    if (!isItemDone(item, done)) continue;
    progress.done++;
    progress.minutesDone += item.minutes;
    progress.xpDone += item.xp;
  }
  return progress;
}

/* ---------- Builder ---------- */

type Draft = Omit<PlanItem, "day">;

function questItem(week: string, pick: QuestPick, kind: SkillKind, reason: LText): Draft {
  return {
    id: `${week}:${pick.skill.id}:${pick.quest}`,
    skillId: pick.skill.id,
    quest: pick.quest,
    minutes: questMinutes(pick.quest, pick.skill.tier),
    xp: pick.xp,
    kind,
    reason,
  };
}

function comboItem(week: string, combo: Combo): Draft {
  return {
    id: `${week}:combo:${combo.id}`,
    skillId: combo.craftSkillId,
    quest: "produce",
    partnerSkillId: combo.softwareSkillId,
    minutes: combo.minutes,
    xp: combo.xp,
    kind: "combo",
    comboId: combo.id,
    reason: REASON.combo(),
  };
}

/**
 * Spread items over the week: heaviest first onto the least loaded day, mid-week preferred
 * (DAY_PREFERENCE), never two produce quests (a combo counts as one) on the same day.
 */
function assignDays(drafts: readonly Draft[]): PlanItem[] {
  const load = new Array<number>(7).fill(0);
  const hasProduce = new Array<boolean>(7).fill(false);
  const ordered = [...drafts].sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id));
  const items: PlanItem[] = [];
  for (const draft of ordered) {
    const isProduce = draft.quest === "produce";
    let day = -1;
    for (const d of DAY_PREFERENCE) {
      if (isProduce && hasProduce[d]) continue;
      if (day === -1 || load[d] < load[day]) day = d;
    }
    if (day === -1) day = DAY_PREFERENCE[0]; // unreachable while MAX_ITEMS ≤ 7
    load[day] += draft.minutes;
    if (isProduce) hasProduce[day] = true;
    items.push({ ...draft, day });
  }
  return items.sort((a, b) => a.day - b.day || b.minutes - a.minutes || a.id.localeCompare(b.id));
}

/**
 * Build the week's plan. Only progress from before `weekStart` shapes the picks, so ticking a planned
 * quest during the week marks it done instead of redrawing the plan; anything completed before the
 * week can never be planned.
 *
 * Mix per week (round 21): 1 combo + 1 craft quest + 1–2 software quests, then the best remaining
 * candidates while the total stays within the budget.
 */
export function buildWeekPlan(input: WeekPlanInput): WeekPlan {
  const { skills, settings, weekStart } = input;
  const budgetMin = input.budgetMin ?? WEEK_BUDGET_MIN;
  const seed = String(input.seed ?? weekStart);
  const programs = input.programs ?? seedPrograms;
  const before = input.completions.filter((c) => dayKey(c.at) < weekStart);

  const candidates = rankQuestCandidates(skills, before, settings)
    .map((pick, index) => ({ pick, index, tie: hash32(`${seed}:${pick.skill.id}`) }))
    .sort(
      (a, b) =>
        b.pick.done - a.pick.done ||
        a.pick.skill.tier - b.pick.skill.tier ||
        a.tie - b.tie ||
        a.index - b.index,
    )
    .map((c) => c.pick);

  const drafts: Draft[] = [];
  const used = new Set<string>();
  let minutes = 0;
  const remaining = () => budgetMin - minutes;
  const take = (draft: Draft) => {
    drafts.push(draft);
    minutes += draft.minutes;
    used.add(draft.skillId);
    if (draft.partnerSkillId) used.add(draft.partnerSkillId);
  };

  // 1) This week's combo (one clip, two produce quests).
  const combo = suggestCombo({ skills, completions: before, settings, programs });
  if (combo && combo.minutes <= remaining()) take(comboItem(weekStart, combo));

  // 2) Balance: one craft quest, then one or two software quests.
  const takeKind = (kind: SkillKind) => {
    const pick = candidates.find(
      (p) =>
        !used.has(p.skill.id) &&
        skillKind(p.skill, programs) === kind &&
        questMinutes(p.quest, p.skill.tier) <= remaining(),
    );
    if (!pick) return;
    const reason = pick.done > 0 ? REASON.mastery(pick.done) : REASON.balance();
    take(questItem(weekStart, pick, kind, reason));
  };
  takeKind("craft");
  takeKind("software");
  takeKind("software");

  // 3) Fill what is left of the budget with the best remaining candidates.
  for (const pick of candidates) {
    if (drafts.length >= MAX_ITEMS) break;
    if (used.has(pick.skill.id)) continue;
    const need = questMinutes(pick.quest, pick.skill.tier);
    const left = remaining();
    if (need > left) continue;
    const reason = pick.done > 0 ? REASON.mastery(pick.done) : REASON.fits(left);
    take(questItem(weekStart, pick, skillKind(pick.skill, programs), reason));
  }

  const items = assignDays(drafts);
  return {
    week: weekStart,
    items,
    minutes,
    xp: items.reduce((n, i) => n + i.xp, 0),
    budgetMin,
    craft: items.filter((i) => i.kind === "craft").length,
    software: items.filter((i) => i.kind === "software").length,
    combos: items.filter((i) => i.kind === "combo").length,
  };
}
