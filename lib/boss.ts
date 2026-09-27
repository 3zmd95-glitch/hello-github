import type { LText, XpEvent } from "./domain";
import { levelFromXp } from "./level";
import { dayKey } from "./streak";

/**
 * Monthly boss (master plan round 9): one boss per Riyadh month with an HP bar that XP damages. Damage is the
 * XP earned in that month from quests, mastery bonuses, drills and reviews (micro-actions keep the streak, they
 * do not hit the boss). Everything is derived from the XP ledger, so the state needs no extra storage; the store
 * only remembers which months were celebrated.
 */

export interface Boss {
  id: string;
  name: LText;
  icon: string;
  /** Base HP before level scaling. */
  hp: number;
}

/** Rotation, month by month. */
export const BOSSES: readonly Boss[] = [
  { id: "showreel", name: { ar: "وحش الشوريل", en: "Showreel Monster" }, icon: "🎞️", hp: 300 },
  { id: "deadline", name: { ar: "غول الديدلاين", en: "Deadline Ogre" }, icon: "⏰", hp: 300 },
  { id: "render", name: { ar: "عفريت الرندر", en: "Render Gremlin" }, icon: "🖥️", hp: 300 },
  {
    id: "blank-timeline",
    name: { ar: "شبح التايملاين الفاضي", en: "Blank Timeline Ghost" },
    icon: "👻",
    hp: 300,
  },
  { id: "noise", name: { ar: "تنّين النويز", en: "Noise Dragon" }, icon: "🐉", hp: 300 },
  {
    id: "flat-look",
    name: { ar: "مومياء اللوك الباهت", en: "Flat Look Mummy" },
    icon: "🧟",
    hp: 300,
  },
  {
    id: "shaky-cam",
    name: { ar: "زلزال الكاميرا المهزوزة", en: "Shaky Cam Quake" },
    icon: "🌪️",
    hp: 300,
  },
  {
    id: "algorithm",
    name: { ar: "أخطبوط الخوارزمية", en: "Algorithm Octopus" },
    icon: "🐙",
    hp: 300,
  },
];

/** HP in month 1 (level 1). */
export const BOSS_BASE_HP = 300;
/** HP grows gently with the owner's level at the start of the month: +10 % per level above 1. */
export const BOSS_HP_PER_LEVEL = 0.1;

/** XP sources that damage the boss. */
export const BOSS_DAMAGE_SOURCES: ReadonlySet<XpEvent["source"]> = new Set([
  "quest",
  "mastery",
  "drill",
  "review",
]);

/** "YYYY-MM" of an instant in Riyadh. */
export function monthKey(date: Date | string | number = new Date()): string {
  return dayKey(date).slice(0, 7);
}

/** Boss for a month key, rotating through BOSSES. */
export function bossForMonth(month: string): Boss {
  const [y, m] = month.split("-").map(Number);
  const idx = (y * 12 + (m - 1)) % BOSSES.length;
  return BOSSES[(idx + BOSSES.length) % BOSSES.length];
}

/** HP for a boss when the owner starts the month at `level`. */
export function bossHp(boss: Boss, level: number): number {
  return Math.round(boss.hp * (1 + BOSS_HP_PER_LEVEL * Math.max(0, level - 1)));
}

/** Number of days in a "YYYY-MM" month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface BossState {
  boss: Boss;
  /** "YYYY-MM" (Riyadh). */
  month: string;
  hp: number;
  /** XP dealt this month. */
  damage: number;
  hpLeft: number;
  /** damage / hp, 0..1. */
  ratio: number;
  defeated: boolean;
  /** Days left in the month, counting today. */
  daysLeft: number;
}

/** Damage dealt in a month: XP from the damaging sources with a Riyadh day inside that month. */
export function bossDamage(xpEvents: readonly XpEvent[], month: string): number {
  let n = 0;
  for (const e of xpEvents)
    if (BOSS_DAMAGE_SOURCES.has(e.source) && e.amount > 0 && monthKey(e.at) === month)
      n += e.amount;
  return n;
}

export function bossState(xpEvents: readonly XpEvent[], now: Date = new Date()): BossState {
  const month = monthKey(now);
  const boss = bossForMonth(month);
  let xpBefore = 0;
  for (const e of xpEvents) if (monthKey(e.at) < month) xpBefore += e.amount;
  const hp = bossHp(boss, levelFromXp(xpBefore));
  const damage = bossDamage(xpEvents, month);
  const hpLeft = Math.max(0, hp - damage);
  const today = Number(dayKey(now).slice(8, 10));
  return {
    boss,
    month,
    hp,
    damage,
    hpLeft,
    ratio: Math.min(1, damage / hp),
    defeated: damage >= hp,
    daysLeft: daysInMonth(month) - today + 1,
  };
}
