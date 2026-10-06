/** Effect families searched in turn (planning/tools/18-trending-effects.md §1): 6 a day, each family every 3 days. */
export const FAMILY_QUERIES: readonly string[] = [
  "clone yourself video trend",
  "gif stickers",
  "new transition trend reels",
  "text effect trend capcut",
  "speed ramp trend edit",
  "ai effect video trend",
  "zoom effect trend edit",
  "glitch effect trend reels",
  "freeze frame trend edit",
  "mask transition trend",
  "reverse video trend capcut",
  "body morph effect trend",
  "3d photo effect trend",
  "light leak glow effect trend",
  "split screen video trend",
  "beat sync edit trend",
  "slow motion trend reels",
  "camera trick trend video",
];
export const QUERIES_PER_DAY = 6;

/** The turns of the rotation: 18 families, 6 at a time. */
export const SLOTS = FAMILY_QUERIES.length / QUERIES_PER_DAY;

/** A UTC day's turn: 0 (families 1–6), 1 (7–12) or 2 (13–18), one after another. */
export function daySlot(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % SLOTS;
}

export function familiesForSlot(slot: number): string[] {
  const start = slot * QUERIES_PER_DAY;
  return FAMILY_QUERIES.slice(start, start + QUERIES_PER_DAY);
}

export function familiesForDay(day: string): string[] {
  return familiesForSlot(daySlot(day));
}
