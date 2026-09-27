import { skills } from "@/data";
import type {
  BadgeAward,
  FocusSession,
  LText,
  MicroAction,
  QuestCompletion,
  Review,
  XpEvent,
} from "./domain";
import type { StreakResult } from "./streak";

/**
 * Badge catalogue (master plan "Gamification rules" + round 15). Each badge is a pure check over a context the
 * store builds from its state; the store awards the badges whose check turns true and were not earned yet.
 */

export interface BadgeContext {
  completions: readonly QuestCompletion[];
  microActions: readonly MicroAction[];
  xpEvents: readonly XpEvent[];
  streak: StreakResult;
  masteredSkillIds: ReadonlySet<string>;
  /** Program id → level from that program's XP. */
  programLevels: Readonly<Record<string, number>>;
  /** Pillar id → level from that pillar's XP. */
  pillarLevels: Readonly<Record<string, number>>;
  chestsOpened: number;
  focusSessions: readonly FocusSession[];
  reviews: readonly Review[];
  bossesDefeated: readonly string[];
  seasonsFinished: readonly string[];
  now: Date;
}

export interface Badge {
  id: string;
  icon: string;
  name: LText;
  desc: LText;
  check(ctx: BadgeContext): boolean;
}

/** A section counts as a "region" for the first-region badge when it has at least this many skills. */
export const REGION_MIN_SKILLS = 2;
/** Program level that makes an island "yours". */
export const ISLAND_LEVEL = 5;
/** Pillar level for the pillar badge. */
export const PILLAR_LEVEL = 5;

const questCount = (ctx: BadgeContext) => ctx.completions.length;

/** Every skill of some section (with ≥ REGION_MIN_SKILLS skills) is mastered. */
export function hasMasteredRegion(mastered: ReadonlySet<string>): boolean {
  const bySection = new Map<string, string[]>();
  for (const s of skills) {
    const key = `${s.programId}/${s.sectionId}`;
    const list = bySection.get(key);
    if (list) list.push(s.id);
    else bySection.set(key, [s.id]);
  }
  for (const ids of bySection.values())
    if (ids.length >= REGION_MIN_SKILLS && ids.every((id) => mastered.has(id))) return true;
  return false;
}

export const BADGES: readonly Badge[] = [
  {
    id: "first-mastery",
    icon: "⭐",
    name: { ar: "أول إتقان", en: "First Mastery" },
    desc: { ar: "أتقنت أول مهارة: ٤ مهام كاملة", en: "Mastered your first skill: all 4 quests" },
    check: (ctx) => ctx.masteredSkillIds.size >= 1,
  },
  {
    id: "streak-7",
    icon: "🔥",
    name: { ar: "أسبوع شعلة", en: "7-Day Flame" },
    desc: { ar: "٧ أيام ورا بعض", en: "A 7-day streak" },
    check: (ctx) => ctx.streak.best >= 7,
  },
  {
    id: "streak-30",
    icon: "🌋",
    name: { ar: "شهر شعلة", en: "30-Day Flame" },
    desc: { ar: "٣٠ يوم ورا بعض، وحش!", en: "A 30-day streak. Beast." },
    check: (ctx) => ctx.streak.best >= 30,
  },
  {
    id: "quests-10",
    icon: "🎯",
    name: { ar: "عشر مهام", en: "Ten Quests" },
    desc: { ar: "خلّصت ١٠ مهام", en: "Completed 10 quests" },
    check: (ctx) => questCount(ctx) >= 10,
  },
  {
    id: "quests-50",
    icon: "🏹",
    name: { ar: "خمسين مهمة", en: "Fifty Quests" },
    desc: { ar: "خلّصت ٥٠ مهمة", en: "Completed 50 quests" },
    check: (ctx) => questCount(ctx) >= 50,
  },
  {
    id: "quests-100",
    icon: "💯",
    name: { ar: "مية مهمة", en: "Hundred Quests" },
    desc: { ar: "خلّصت ١٠٠ مهمة", en: "Completed 100 quests" },
    check: (ctx) => questCount(ctx) >= 100,
  },
  {
    id: "first-proof",
    icon: "🎬",
    name: { ar: "أول إنتاج بإثبات", en: "First Proof" },
    desc: { ar: "أول فيديو إنتاج مع رابط إثبات", en: "First Produce quest with a proof link" },
    check: (ctx) => ctx.completions.some((c) => c.quest === "produce" && !!c.proofUrl),
  },
  {
    id: "first-article",
    icon: "✍️",
    name: { ar: "أول مقال", en: "First Article" },
    desc: { ar: "خلّصت أول مهمة مقال", en: "Completed your first Article quest" },
    check: (ctx) => ctx.completions.some((c) => c.quest === "article"),
  },
  {
    id: "first-region",
    icon: "🗺️",
    name: { ar: "أول منطقة", en: "First Region" },
    desc: { ar: "أتقنت كل مهارات قسم كامل", en: "Mastered every skill of one section" },
    check: (ctx) => hasMasteredRegion(ctx.masteredSkillIds),
  },
  {
    id: "first-island",
    icon: "🏝️",
    name: { ar: "أول جزيرة", en: "First Island" },
    desc: { ar: "برنامج وصل لفل ٥", en: "A program reached level 5" },
    check: (ctx) => Object.values(ctx.programLevels).some((l) => l >= ISLAND_LEVEL),
  },
  {
    id: "pillar-5",
    icon: "🏛️",
    name: { ar: "ركيزة لفل ٥", en: "Pillar Five" },
    desc: { ar: "ركيزة كاملة وصلت لفل ٥", en: "A whole pillar reached level 5" },
    check: (ctx) => Object.values(ctx.pillarLevels).some((l) => l >= PILLAR_LEVEL),
  },
  {
    id: "first-chest",
    icon: "📦",
    name: { ar: "أول صندوق", en: "First Chest" },
    desc: { ar: "فتحت أول علبة فيلم", en: "Opened your first film canister" },
    check: (ctx) => ctx.chestsOpened >= 1,
  },
  {
    id: "focus-10",
    icon: "🧪",
    name: { ar: "عشر جرعات تركيز", en: "Ten Potions" },
    desc: { ar: "١٠ جلسات تركيز", en: "Ten focus sessions" },
    check: (ctx) => ctx.focusSessions.length >= 10,
  },
  {
    id: "first-review",
    icon: "📊",
    name: { ar: "أول مراجعة", en: "First Review" },
    desc: { ar: "كتبت أول مراجعة أسبوع", en: "Wrote your first weekly review" },
    check: (ctx) => ctx.reviews.length >= 1,
  },
  {
    id: "boss-slayer",
    icon: "⚔️",
    name: { ar: "قاتل الوحوش", en: "Boss Slayer" },
    desc: { ar: "هزمت أول وحش شهري", en: "Defeated your first monthly boss" },
    check: (ctx) => ctx.bossesDefeated.length >= 1,
  },
  {
    id: "season-finisher",
    icon: "🏁",
    name: { ar: "خلّص الموسم", en: "Season Finisher" },
    desc: { ar: "وصلت هدف موسم كامل", en: "Reached a season's target" },
    check: (ctx) => ctx.seasonsFinished.length >= 1,
  },
];

const badgeIndex = new Map(BADGES.map((b) => [b.id, b]));

export function getBadge(id: string): Badge | undefined {
  return badgeIndex.get(id);
}

/** Badges whose check passes now and that are not in `earned` yet, in catalogue order. */
export function newBadges(ctx: BadgeContext, earned: readonly BadgeAward[]): Badge[] {
  const have = new Set(earned.map((b) => b.id));
  return BADGES.filter((b) => !have.has(b.id) && b.check(ctx));
}
