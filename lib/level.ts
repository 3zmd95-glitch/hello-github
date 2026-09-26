/**
 * Level curve: reaching level n needs `50 × n^1.5` cumulative XP (rounded), with level 1 at 0 XP.
 * The same curve is used for the overall level and per-program levels.
 */
export function xpForLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.round(50 * n ** 1.5);
}

/** Highest level whose threshold is ≤ xp. */
export function levelFromXp(xp: number): number {
  if (!(xp > 0)) return 1;
  // Invert the curve for a starting guess, then correct for rounding.
  let n = Math.max(1, Math.floor((xp / 50) ** (2 / 3)));
  while (xpForLevel(n + 1) <= xp) n++;
  while (n > 1 && xpForLevel(n) > xp) n--;
  return n;
}

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  current: number;
  /** XP the current level spans (to the next level). */
  needed: number;
  /** current / needed, 0..1. */
  ratio: number;
}

export function levelProgress(xp: number): LevelProgress {
  const safe = Math.max(0, xp);
  const level = levelFromXp(safe);
  const start = xpForLevel(level);
  const needed = xpForLevel(level + 1) - start;
  const current = safe - start;
  return { level, current, needed, ratio: needed > 0 ? current / needed : 0 };
}
