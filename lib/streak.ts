/**
 * Daily streak on the Riyadh day boundary (Asia/Riyadh, UTC+3, no DST).
 * A day counts when any quest or micro-action happened. A missed day can be covered by a streak freeze:
 * frozen days keep the chain alive but do not add to its length.
 * Freezes: 1 earned per week (Sat–Fri) with ≥ 1 active day; stock capped at 2.
 */

export const TIME_ZONE = "Asia/Riyadh";
export const FREEZE_CAP = 2;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" of the given instant in Riyadh. */
export function dayKey(date: Date | string | number = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  const parts = dayFormatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Shift a day key by n calendar days. */
export function addDays(key: string, n: number): string {
  return utcToKey(keyToUtc(key) + n * 86_400_000);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / 86_400_000);
}

/** Saturday that starts the (Saudi, Sat–Fri) week containing the day. */
export function weekKey(key: string): string {
  const dow = new Date(keyToUtc(key)).getUTCDay(); // 0 Sun … 6 Sat
  return addDays(key, -((dow + 1) % 7));
}

function toKey(today: Date | string): string {
  return typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : dayKey(today);
}

export interface StreakResult {
  /** Active days in the current chain (frozen days bridge but do not count). */
  current: number;
  /** Longest chain ever, same counting. */
  best: number;
  /** Whether today already counts. */
  todayDone: boolean;
}

export function computeStreak(
  activeDays: ReadonlySet<string>,
  freezesUsedOn: ReadonlySet<string>,
  today: Date | string = new Date(),
): StreakResult {
  const todayKey = toKey(today);
  const covered = (k: string) => activeDays.has(k) || freezesUsedOn.has(k);
  const todayDone = activeDays.has(todayKey);

  // Current chain: from today if covered, else from yesterday (today is still open).
  let current = 0;
  let day = covered(todayKey) ? todayKey : addDays(todayKey, -1);
  while (covered(day)) {
    if (activeDays.has(day)) current++;
    day = addDays(day, -1);
  }

  // Best chain over all history up to today.
  const keys = [...new Set([...activeDays, ...freezesUsedOn])].filter((k) => k <= todayKey).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    if (prev === null || daysBetween(prev, k) !== 1) run = 0;
    if (activeDays.has(k)) run++;
    best = Math.max(best, run);
    prev = k;
  }

  return { current, best: Math.max(best, current), todayDone };
}

/** Freeze stock from a number of active weeks, before any are used: 1 per week, capped. */
export function freezesEarned(weeksActive: number): number {
  return Math.max(0, Math.min(FREEZE_CAP, Math.floor(weeksActive)));
}

/** Number of distinct Sat–Fri weeks with at least one active day. */
export function countActiveWeeks(activeDays: Iterable<string>): number {
  return new Set([...activeDays].map(weekKey)).size;
}

/**
 * Freezes available now. Walks history in order: the first active day of each week adds one (stock capped
 * at FREEZE_CAP), each used freeze removes one.
 */
export function freezeStock(
  activeDays: ReadonlySet<string>,
  freezesUsedOn: ReadonlySet<string>,
  today: Date | string = new Date(),
): number {
  const todayKey = toKey(today);
  const days = [...new Set([...activeDays, ...freezesUsedOn])].filter((k) => k <= todayKey).sort();
  const creditedWeeks = new Set<string>();
  let stock = 0;
  for (const d of days) {
    if (freezesUsedOn.has(d)) stock = Math.max(0, stock - 1);
    if (activeDays.has(d) && !creditedWeeks.has(weekKey(d))) {
      creditedWeeks.add(weekKey(d));
      stock = Math.min(FREEZE_CAP, stock + 1);
    }
  }
  return stock;
}

/**
 * Days that should be frozen to keep the streak alive: the missed days between the last covered day and
 * yesterday. Returns [] when nothing is missing, there is no streak to save, or the stock is too small.
 */
export function daysToFreeze(
  activeDays: ReadonlySet<string>,
  freezesUsedOn: ReadonlySet<string>,
  today: Date | string = new Date(),
): string[] {
  const todayKey = toKey(today);
  const covered = (k: string) => activeDays.has(k) || freezesUsedOn.has(k);
  const past = [...new Set([...activeDays, ...freezesUsedOn])].filter((k) => k < todayKey).sort();
  const last = past.at(-1);
  if (!last) return [];
  const missing: string[] = [];
  for (let d = addDays(last, 1); d < todayKey; d = addDays(d, 1)) if (!covered(d)) missing.push(d);
  if (missing.length === 0) return [];
  return missing.length <= freezeStock(activeDays, freezesUsedOn, todayKey) ? missing : [];
}
