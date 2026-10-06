/**
 * Trending effects, scoring (planning/tools/18-trending-effects.md §2): distinct creators over the last 7 days of scans,
 * growth between the last 3 days and the 3 before (each family is searched once per 3-day window), NEW for effects
 * outside the dictionary first seen within 7 days, a small YouTube boost. History holds ≤ 14 days and ≤ 60 keys.
 */

import {
  HISTORY_DAYS,
  HISTORY_KEYS,
  IDS_PER_DAY,
  MAX_ITEMS,
  MIN_CREATORS,
  type Candidate,
  type EffectItem,
  type EffectMeta,
  type HistoryEntry,
} from "./types";

const DAY_MS = 86_400_000;

/** b - a in whole UTC days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

export function creatorsBetween(
  entries: readonly HistoryEntry[],
  today: string,
  fromDaysAgo: number,
  toDaysAgo: number,
): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    const ago = daysBetween(e.day, today);
    if (ago >= fromDaysAgo && ago <= toDaysAgo) for (const id of e.ids) ids.add(id);
  }
  return ids;
}

/** Today's creators replace any earlier run of the same day; entries older than 14 days go, then the keys with the
 * fewest creators this week until 60 are left (on a tie, the key last seen longest ago goes first). */
export function mergeHistory(
  history: Record<string, HistoryEntry[]>,
  day: string,
  today: Map<string, Candidate>,
): Record<string, HistoryEntry[]> {
  const out: Record<string, HistoryEntry[]> = {};
  for (const [key, entries] of Object.entries(history)) {
    const kept = entries.filter((e) => e.day !== day && daysBetween(e.day, day) < HISTORY_DAYS);
    if (kept.length) out[key] = kept;
  }
  for (const [key, c] of today) {
    out[key] = [...(out[key] ?? []), { day, ids: [...c.ids].slice(0, IDS_PER_DAY) }];
  }
  const keys = Object.keys(out);
  if (keys.length > HISTORY_KEYS) {
    const week = new Map(keys.map((k) => [k, creatorsBetween(out[k], day, 0, 6).size]));
    const last = new Map(
      keys.map((k) => [k, out[k].reduce((d, e) => (e.day > d ? e.day : d), "")]),
    );
    const order = (a: string, b: string) =>
      week.get(b)! - week.get(a)! || daysBetween(last.get(a)!, last.get(b)!);
    for (const k of keys.sort(order).slice(HISTORY_KEYS)) delete out[k];
  }
  return out;
}

export function setViews(
  history: Record<string, HistoryEntry[]>,
  day: string,
  views: Record<string, number>,
): void {
  for (const [key, v] of Object.entries(views)) {
    const entry = history[key]?.find((e) => e.day === day);
    if (entry) entry.views7d = v;
  }
}

/** Today's YouTube views7d against the last earlier recorded views7d. */
function viewsRatio(entries: readonly HistoryEntry[], today: string): number | undefined {
  const now = entries.find((e) => e.day === today)?.views7d;
  const before = entries
    .filter((e) => e.day < today && e.views7d !== undefined)
    .sort((a, b) => daysBetween(a.day, b.day))[0]?.views7d;
  return now === undefined || before === undefined || before <= 0 ? undefined : now / before;
}

/** The YouTube views ratio rounded to 0.1, for the "▶ ↑N×" note. */
export function youtubeGrowth(entries: readonly HistoryEntry[], today: string): number | undefined {
  const ratio = viewsRatio(entries, today);
  return ratio === undefined ? undefined : Math.round(ratio * 10) / 10;
}

export function scoreEffects(
  history: Record<string, HistoryEntry[]>,
  meta: Record<string, EffectMeta>,
  today: string,
  youtube: Record<string, { newVideos: number; views7d: number }>,
): EffectItem[] {
  const scored = Object.entries(history).flatMap(([key, entries]) => {
    const m = meta[key];
    if (!m) return [];
    const creators = creatorsBetween(entries, today, 0, 6).size;
    if (creators < MIN_CREATORS) return [];
    const recent = creatorsBetween(entries, today, 0, 2).size;
    const before = creatorsBetween(entries, today, 3, 5).size;
    // No creators in days 3–5: new (growth 3) when seen in days 0–2, else fading (growth 0).
    const growth = before === 0 ? (recent > 0 ? 3 : 0) : Math.round((recent / before) * 100) / 100;
    const firstSeen = entries.reduce((d, e) => (e.day < d ? e.day : d), today);
    const ytGrowth = youtubeGrowth(entries, today);
    const yt = youtube[key];
    const boost = (viewsRatio(entries, today) ?? 0) >= 1.5 ? 1.25 : 1; // the real ratio, not the rounded one
    const item: EffectItem = {
      key,
      name: m.name,
      ...(m.what ? { what: m.what } : {}),
      ...(m.termId ? { termId: m.termId } : {}),
      isNew: !m.termId && daysBetween(firstSeen, today) < 7,
      checked: m.checked,
      creators,
      posts: m.posts,
      platforms: m.platforms,
      growth,
      ...(yt
        ? { youtube: { ...yt, ...(ytGrowth !== undefined ? { growth: ytGrowth } : {}) } }
        : {}),
      samples: m.samples,
    };
    return [{ item, score: creators * Math.min(growth, 4) * boost, firstSeen }];
  });
  // Equal scores: the effect first seen more recently goes first.
  return scored
    .sort((a, b) => b.score - a.score || daysBetween(a.firstSeen, b.firstSeen))
    .slice(0, MAX_ITEMS)
    .map((s) => s.item);
}
