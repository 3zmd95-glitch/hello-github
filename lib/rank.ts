import { levelFromXp, xpForLevel } from "./level";

export interface Rank {
  /** Level at which the rank unlocks. */
  level: number;
  ar: string;
  en: string;
}

/** 17 ranks (master plan round 9). Each has tiers I → II → III: 51 steps in total. */
export const RANKS: readonly Rank[] = [
  { level: 1, ar: "مبتدئ متحمّس", en: "Hyped Beginner" },
  { level: 2, ar: "صيّاد اللقطات", en: "Shot Hunter" },
  { level: 3, ar: "شايل الكاميرا", en: "Camera Carrier" },
  { level: 5, ar: "ملك الزوايا", en: "King of Angles" },
  { level: 6, ar: "فنان القص", en: "Cut Artist" },
  { level: 8, ar: "مروّض الإضاءة", en: "Light Tamer" },
  { level: 10, ar: "ساحر الألوان", en: "Color Wizard" },
  { level: 12, ar: "سلطان الصوت", en: "Sultan of Sound" },
  { level: 15, ar: "ذيب المونتاج", en: "Edit Wolf" },
  { level: 18, ar: "معلّم الفيوجن", en: "Fusion Master" },
  { level: 21, ar: "وحش الإنتاج", en: "Production Beast" },
  { level: 24, ar: "شيخ القصة", en: "Story Sheikh" },
  { level: 28, ar: "هامور المحتوى", en: "Content Tycoon" },
  { level: 32, ar: "صقر السينما", en: "Cinema Falcon" },
  { level: 36, ar: "الأسطورة", en: "The Legend" },
  { level: 42, ar: "أبو الإبداع", en: "Father of Creativity" },
  { level: 50, ar: "عزّ الأساطير", en: "Glory of Legends" },
];

/** The final rank's tiers run up to this level's XP threshold. */
export const FINAL_RANK_END_LEVEL = 60;

export type RankTier = 1 | 2 | 3;

export interface RankState {
  rank: Rank;
  /** Index into RANKS (0..16). */
  index: number;
  /** I, II or III inside the rank, by XP progress. */
  tier: RankTier;
  nextRank: Rank | null;
  /** XP where this rank starts and where the next rank (or level 60 for the final rank) starts. */
  startXp: number;
  endXp: number;
  /** 0..51 overall step count (index × 3 + tier), handy for "tier-up" detection. */
  step: number;
}

export function rankIndexForLevel(level: number): number {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (RANKS[i].level <= level) idx = i;
  return idx;
}

export function rankFromXp(xp: number): RankState {
  const safe = Math.max(0, xp);
  const index = rankIndexForLevel(levelFromXp(safe));
  const rank = RANKS[index];
  const nextRank = RANKS[index + 1] ?? null;
  const startXp = xpForLevel(rank.level);
  const endXp = xpForLevel(nextRank ? nextRank.level : FINAL_RANK_END_LEVEL);
  const third = (endXp - startXp) / 3;
  const tier = Math.min(3, 1 + Math.floor((safe - startXp) / third)) as RankTier;
  return { rank, index, tier, nextRank, startXp, endXp, step: index * 3 + tier };
}

/** Roman numeral label for a tier. */
export function tierLabel(tier: RankTier): "I" | "II" | "III" {
  return tier === 1 ? "I" : tier === 2 ? "II" : "III";
}
