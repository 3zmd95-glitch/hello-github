import type { QuestType, Tier } from "./domain";

/** Base XP per quest type (master plan, gamification rules v1). */
export const QUEST_XP: Record<QuestType, number> = {
  train: 10,
  research: 15,
  produce: 25,
  article: 30,
};

/** Bonus awarded once when all 4 quests of a skill are done. */
export const MASTERY_BONUS = 20;

/** Difficulty multipliers: Basic ×1 · Intermediate ×1.5 · Advanced ×2. */
export const TIER_MULT: Record<Tier, number> = { 1: 1, 2: 1.5, 3: 2 };

/** Focus session multiplier (+25 %), used from Sprint 2. */
export const FOCUS_MULT = 1.25;

/** XP for a 10-minute drill on a mastered skill (spaced repetition, Sprint 2). */
export const DRILL_XP = 5;

/** XP for the weekly review, once per Sat–Fri week (Sprint 2). */
export const REVIEW_XP = 10;

/** Micro-action XP range; v1 awards the fixed middle value. */
export const MICRO_XP_MIN = 2;
export const MICRO_XP_MAX = 5;

/** XP for one quest, scaled by tier and rounded to an integer. */
export function questXp(type: QuestType, tier: Tier): number {
  return Math.round(QUEST_XP[type] * TIER_MULT[tier]);
}

/** Total XP a skill can give: its 4 quests plus the mastery bonus. */
export function skillMaxXp(tier: Tier): number {
  return (
    (Object.keys(QUEST_XP) as QuestType[]).reduce((n, q) => n + questXp(q, tier), 0) + MASTERY_BONUS
  );
}

/**
 * XP for a 5-minute micro-action. Documented range is 2–5 XP ({@link MICRO_XP_MIN}–{@link MICRO_XP_MAX});
 * v1 always gives 3 so the streak, not the XP, is the reason to do them.
 */
export function microXp(): number {
  return 3;
}

/** Quest XP while a focus session runs: ×FOCUS_MULT, rounded (the mastery bonus is never boosted). */
export function focusedXp(xp: number): number {
  return Math.round(xp * FOCUS_MULT);
}
