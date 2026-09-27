import type { GemEvent, Lang, Reward, RewardText } from "./domain";

/**
 * Gems: the private currency (master plan round 9). Earned by playing, spent in the rewards shop on a streak
 * freeze or saved toward real-world rewards the owner defines. Every movement is a ledger event; the balance
 * is the sum.
 */

/** Quest gems = max(1, round(xp / GEM_PER_XP)). */
export const GEM_PER_XP = 5;

/** Fixed gem awards per event. */
export const GEM_RULES = {
  /** Skill mastered (all 4 quests). */
  mastery: 10,
  /** Today's flow reached ③ (once per Riyadh day). */
  dayComplete: 5,
  /** Weekly review saved (once per week). */
  review: 5,
  /** Badge earned. */
  badge: 15,
  /** Monthly boss defeated. */
  boss: 50,
  /** Season target reached. */
  season: 30,
} as const;

/** Gems for a quest worth `xp` (after the focus multiplier, if any). */
export function questGems(xp: number): number {
  return Math.max(1, Math.round(xp / GEM_PER_XP));
}

/** Current balance: the sum of the ledger. */
export function gemBalance(events: readonly GemEvent[]): number {
  return events.reduce((n, e) => n + e.amount, 0);
}

/* ---------- Rewards shop rules ---------- */

/** Id of the built-in streak-freeze reward. */
export const FREEZE_REWARD_ID = "freeze";
export const FREEZE_REWARD_COST = 40;

/** Rewards seeded on first run. The owner edits or removes the examples; the freeze is built in. */
export function defaultRewards(): Reward[] {
  return [
    {
      id: FREEZE_REWARD_ID,
      name: { ar: "تجميد الشعلة", en: "Streak freeze" },
      desc: {
        ar: "يوم واحد تفوّته والشعلة تبقى شاغلة",
        en: "One missed day keeps the flame alive",
      },
      cost: FREEZE_REWARD_COST,
      repeatable: true,
      icon: "🧊",
      builtIn: true,
    },
    {
      id: "dinner",
      name: { ar: "عشا في مكانك المفضل", en: "Dinner at your favorite spot" },
      cost: 250,
      repeatable: true,
      icon: "🍽️",
    },
    {
      id: "lut-pack",
      name: { ar: "باقة LUT من صانع محتوى تحبه", en: "A LUT pack from a creator you like" },
      cost: 180,
      repeatable: false,
      icon: "🎨",
    },
    {
      id: "pro-mist",
      name: { ar: "فلتر Black Pro-Mist", en: "Black Pro-Mist filter" },
      cost: 600,
      minLevel: 10,
      repeatable: false,
      icon: "🔮",
    },
  ];
}

/** Make sure the built-in rewards exist (old saves or imports may lack them). */
export function ensureBuiltInRewards(rewards: readonly Reward[]): Reward[] {
  const builtIns = defaultRewards().filter((r) => r.builtIn);
  const missing = builtIns.filter((b) => !rewards.some((r) => r.id === b.id));
  return missing.length ? [...missing, ...rewards] : [...rewards];
}

/** Seeded rewards carry bilingual names, owner-typed ones are plain strings. */
export function rewardText(text: RewardText | undefined, lang: Lang): string {
  if (text === undefined) return "";
  return typeof text === "string" ? text : text[lang] || text.ar;
}

export type BuyRefusal = "gems" | "level" | "owned" | "unknown" | "full";

export interface BuyCheck {
  ok: boolean;
  reason?: BuyRefusal;
}

/**
 * Can the owner buy this reward? Checks, in order: known reward, level requirement, already owned when not
 * repeatable, enough gems. (The freeze cap is checked by the store, which knows the streak.)
 */
export function canBuy(
  reward: Reward | undefined,
  ctx: { gems: number; level: number; owned: boolean },
): BuyCheck {
  if (!reward) return { ok: false, reason: "unknown" };
  if (reward.minLevel !== undefined && ctx.level < reward.minLevel)
    return { ok: false, reason: "level" };
  if (!reward.repeatable && ctx.owned) return { ok: false, reason: "owned" };
  if (ctx.gems < reward.cost) return { ok: false, reason: "gems" };
  return { ok: true };
}
