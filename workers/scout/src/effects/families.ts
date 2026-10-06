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

export function familiesForDay(day: string): string[] {
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const start = (dayNumber % 3) * QUERIES_PER_DAY;
  return FAMILY_QUERIES.slice(start, start + QUERIES_PER_DAY);
}
