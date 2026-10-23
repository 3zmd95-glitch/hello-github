import type { Platform, SocialPostStat } from "./domain";
import { BEST_TIME, bestTime } from "./social";

/**
 * A5 · "When did my posts do best?" (planning/tools/09-metricool-beacons.md). The platform's own post numbers
 * (`socialPostStats`, filled by the daily sync and the CSV import) are bucketed by Riyadh weekday x 2-hour block.
 * A post's score is its views against the platform's median, capped at 4x so one viral post cannot decide it; a
 * cell's score is shrunk toward "average" ((sum + 2) / (n + 2)) so a lucky single post cannot win either. Below
 * 20 settled posts on a platform the owner keeps the usual times (`BEST_TIME`) and is told how many are missing.
 * This is "when your posts did best", not "when your audience is online". Pure functions only.
 */

export const BT_MIN_POSTS = 20;
export const BT_WINDOW_DAYS = 180;
/** Counters of a younger post are not settled yet. */
export const BT_SETTLE_HOURS = 72;
export const BT_SCORE_CAP = 4;
/** The prior: this many imaginary posts of score 1 ("average") join every cell. */
export const BT_PRIOR = 2;
/** A cell needs this many posts to be named a best time. */
export const BT_MIN_CELL = 2;
/** Chips offered in the post dialog, and slots listed in Growth. */
export const BT_TOP = 3;
export const BT_BLOCKS = 12;

const BLOCK_MIN = 120;
const HOUR_MS = 3_600_000;
const RIYADH_OFFSET_MS = 3 * HOUR_MS;

/** 0 = Sunday … 6 = Saturday, and minutes since midnight, on the Riyadh clock (UTC+3, no daylight saving). */
export function riyadhParts(ms: number): { dow: number; minutes: number } {
  const d = new Date(ms + RIYADH_OFFSET_MS);
  return { dow: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

const pad = (n: number): string => String(n).padStart(2, "0");
const hhmm = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** "20–22" for block 10. */
export function blockLabel(block: number): string {
  return `${pad(block * 2)}–${pad(block * 2 + 2)}`;
}

export interface BestCell {
  /** JS weekday (0 = Sunday), or null for a block taken over the whole week. */
  dow: number | null;
  /** 0–11: the 2-hour block of the Riyadh day. */
  block: number;
  /** Posts in the cell. */
  n: number;
  /** Shrunk average score; 1 = an average post. */
  score: number;
  /** Score as a percent of the best cell (Metricool's "% view"); 0 for an empty cell. */
  pct: number;
  /** "HH:MM" to suggest: the posts' own median time in the block, on a 5-minute grid. */
  time: string;
}

export interface LearnedTimes {
  platform: Platform;
  /** Settled posts of the platform in the window. */
  posts: number;
  needed: number;
  ready: boolean;
  /** Why not ready: too few posts, or most have no views. */
  reason: "few" | "noViews" | null;
  /** 7 x 12 cells, weekday-major (JS weekday order). Empty until ready. */
  cells: BestCell[];
  /** The 12 blocks over the whole week. Empty until ready. */
  blocks: BestCell[];
  /** Up to 3 proven cells, best first. Empty until ready. */
  top: BestCell[];
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const byRank = (a: BestCell, b: BestCell): number =>
  b.score - a.score || b.n - a.n || (a.dow ?? 0) - (b.dow ?? 0) || a.block - b.block;

function makeCell(
  dow: number | null,
  block: number,
  scores: readonly number[],
  minutes: readonly number[],
): BestCell {
  const n = scores.length;
  const sum = scores.reduce((a, b) => a + b, 0);
  const lo = block * BLOCK_MIN;
  const mid = n ? Math.round(median(minutes) / 5) * 5 : lo + BLOCK_MIN / 2;
  return {
    dow,
    block,
    n,
    score: (sum + BT_PRIOR) / (n + BT_PRIOR),
    pct: 0,
    time: hhmm(Math.min(Math.max(mid, lo), lo + BLOCK_MIN - 5)),
  };
}

/** Fills `pct`: against the best proven cell (n >= 2), or the best cell of any size when none is proven. */
function shade(cells: BestCell[]): void {
  const proven = cells.filter((c) => c.n >= BT_MIN_CELL);
  const pool = proven.length ? proven : cells.filter((c) => c.n > 0);
  const best = Math.max(...pool.map((c) => c.score), 0);
  for (const c of cells)
    c.pct = c.n === 0 || best <= 0 ? 0 : Math.min(100, Math.round((c.score / best) * 100));
}

/** The numbers behind the heat map and the time chips for one platform, as of `now` (ms). */
export function learnBestTimes(
  stats: readonly SocialPostStat[],
  platform: Platform,
  now: number,
): LearnedTimes {
  const newest = now - BT_SETTLE_HOURS * HOUR_MS;
  const oldest = now - BT_WINDOW_DAYS * 24 * HOUR_MS;
  const used = stats
    .filter((p) => p.platform === platform && p.kind !== "story")
    .map((p) => ({ ms: Date.parse(p.publishedAt), views: p.views }))
    .filter((p) => p.ms > oldest && p.ms <= newest);
  const base = {
    platform,
    posts: used.length,
    needed: BT_MIN_POSTS,
    cells: [] as BestCell[],
    blocks: [] as BestCell[],
    top: [] as BestCell[],
  };
  if (used.length < BT_MIN_POSTS) return { ...base, ready: false, reason: "few" };
  const mid = median(used.map((p) => p.views));
  if (mid <= 0) return { ...base, ready: false, reason: "noViews" };

  const slots = new Map<string, { scores: number[]; minutes: number[] }>();
  for (const p of used) {
    const { dow, minutes } = riyadhParts(p.ms);
    const block = Math.floor(minutes / BLOCK_MIN);
    for (const key of [`${dow}:${block}`, `*:${block}`]) {
      const slot = slots.get(key) ?? { scores: [], minutes: [] };
      slot.scores.push(Math.min(p.views / mid, BT_SCORE_CAP));
      slot.minutes.push(minutes);
      slots.set(key, slot);
    }
  }
  const empty = { scores: [], minutes: [] };
  const cell = (dow: number | null, block: number) => {
    const s = slots.get(`${dow ?? "*"}:${block}`) ?? empty;
    return makeCell(dow, block, s.scores, s.minutes);
  };
  const cells: BestCell[] = [];
  for (let dow = 0; dow < 7; dow++) for (let b = 0; b < BT_BLOCKS; b++) cells.push(cell(dow, b));
  const blocks = Array.from({ length: BT_BLOCKS }, (_, b) => cell(null, b));
  shade(cells);
  shade(blocks);
  const top = cells
    .filter((c) => c.n >= BT_MIN_CELL)
    .sort(byRank)
    .slice(0, BT_TOP);
  return { ...base, ready: true, reason: null, cells, blocks, top };
}

export interface TimeSuggestions {
  /** Up to 3 "HH:MM", best first. */
  times: string[];
  /** True when they come from the owner's own posts, false for the usual times. */
  learned: boolean;
}

/** The usual times of a platform, the best one for `day` first. */
function usualTimes(platform: Platform, day?: string): string[] {
  return [...new Set([bestTime(platform, day), ...BEST_TIME[platform]])].slice(0, BT_TOP);
}

const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * Times to offer for a post on `day`: that weekday's own proven blocks first, then the best blocks of the
 * whole week (one per block), at most three. The usual times while the platform has too little data.
 */
export function timesForDay(learned: LearnedTimes, day?: string): TimeSuggestions {
  if (learned.ready) {
    const picks: BestCell[] = [];
    const seen = new Set<number>();
    const add = (cs: readonly BestCell[]) => {
      for (const c of [...cs].filter((x) => x.n >= BT_MIN_CELL).sort(byRank)) {
        if (picks.length < BT_TOP && !seen.has(c.block)) {
          seen.add(c.block);
          picks.push(c);
        }
      }
    };
    if (day) add(learned.cells.filter((c) => c.dow === weekdayOf(day)));
    add(learned.blocks);
    if (picks.length) return { times: picks.map((c) => c.time), learned: true };
  }
  return { times: usualTimes(learned.platform, day), learned: false };
}

/** The one best "HH:MM" for a post on `day`: from the owner's numbers, the usual time while there are too few. */
export function bestTimeFor(
  stats: readonly SocialPostStat[],
  platform: Platform,
  day: string | undefined,
  now: number,
): string {
  return timesForDay(learnBestTimes(stats, platform, now), day).times[0];
}
