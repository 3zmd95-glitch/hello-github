/**
 * Trending effects, scoring (planning/tools/18-trending-effects.md §2): distinct creators who posted in the last 7 days
 * (history days are post days since 2026-10-07, "Real post dates"), growth between the last 3 days and the 3 before
 * (none in the last 3 days: growth 0, shown after every effect with a score), NEW for effects outside the dictionary
 * first seen by a scan within 7 days, a small YouTube boost. History holds ≤ 14 days and ≤ 400 keys.
 */

import { TERMS } from "../discover/terms";
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
/** Dictionary entries that are trends (the clone effect, GIF stickers), not always-busy editing techniques. */
const TREND_TERMS = new Set(TERMS.filter((t) => t.trend).map((t) => t.id));

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

/** Each creator goes into the entry of the day they posted (live, 2026-10-07: filed under the scan's day, "this week"
 * counted scans of September posts). The same creator on the same day counts once, ≤ 30 a day, and an earlier run's
 * creators stay; entries older than 14 days go. Over `maxKeys` (400; a category keeps 200), the cut keeps `keepFirst`
 * (protected names) first, then the most creators this week, then the latest seen; `cut` collects the keys it dropped. */
export function mergeHistory(
  history: Record<string, HistoryEntry[]>,
  day: string,
  today: Map<string, Candidate>,
  keepFirst: ReadonlySet<string> = new Set(),
  cut: string[] = [],
  maxKeys = HISTORY_KEYS,
): Record<string, HistoryEntry[]> {
  const out: Record<string, HistoryEntry[]> = {};
  for (const [key, entries] of Object.entries(history)) {
    const kept = entries.filter((e) => daysBetween(e.day, day) < HISTORY_DAYS);
    if (kept.length) out[key] = kept;
  }
  // Another run (Scan again) adds to each day's creators: a name it does not find keeps its earlier ones.
  for (const [key, c] of today) {
    const byDay = new Map<string, string[]>();
    for (const [id, posted] of c.days) byDay.set(posted, [...(byDay.get(posted) ?? []), id]);
    let entries = out[key] ?? [];
    for (const [posted, ids] of byDay) {
      const earlier = entries.find((e) => e.day === posted);
      const merged = [...new Set([...(earlier?.ids ?? []), ...ids])].slice(0, IDS_PER_DAY);
      entries = [
        ...entries.filter((e) => e.day !== posted),
        { ...earlier, day: posted, ids: merged },
      ];
    }
    if (entries.length) out[key] = entries;
  }
  const keys = Object.keys(out);
  if (keys.length > maxKeys) {
    const week = new Map(keys.map((k) => [k, creatorsBetween(out[k], day, 0, 6).size]));
    const last = new Map(
      keys.map((k) => [k, out[k].reduce((d, e) => (e.day > d ? e.day : d), "")]),
    );
    const order = (a: string, b: string) =>
      Number(keepFirst.has(b)) - Number(keepFirst.has(a)) ||
      week.get(b)! - week.get(a)! ||
      daysBetween(last.get(a)!, last.get(b)!);
    for (const k of keys.sort(order).slice(maxKeys)) {
      delete out[k];
      cut.push(k);
    }
  }
  return out;
}

export function setViews(
  history: Record<string, HistoryEntry[]>,
  day: string,
  views: Record<string, number>,
): void {
  for (const [key, v] of Object.entries(views)) {
    const entries = history[key];
    if (!entries) continue;
    const i = entries.findIndex((e) => e.day === day);
    // Today's entry, made when no creator posted today (days are post days); a copy, the previous document's stays.
    if (i < 0) entries.push({ day, ids: [], views7d: v });
    else entries[i] = { ...entries[i], views7d: v };
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
  /** Creators this week an effect needs: Trending effects' 3; a category asks 2 (planning/tools/19-category-trends.md
   * §2). Either way `meta` holds only the names the AI approved and the dictionary's. */
  minCreators = MIN_CREATORS,
): EffectItem[] {
  const scored = Object.entries(history).flatMap(([key, entries]) => {
    const m = meta[key];
    if (!m) return [];
    const creators = creatorsBetween(entries, today, 0, 6).size;
    const recent = creatorsBetween(entries, today, 0, 2).size;
    // Under the minimum this week. Days are post days: creators who posted 3–6 days ago are still this week's (the live
    // clone effect, Oct 1 and 3 on Oct 7), so a quiet effect shows, after every effect with a score (growth 0).
    if (creators < minCreators) return [];
    const before = creatorsBetween(entries, today, 3, 5).size;
    // None in the last 3 days: 0; none in days 3–5: new (growth 3).
    const growth = !recent ? 0 : before === 0 ? 3 : Math.round((recent / before) * 100) / 100;
    // The scan day it was first seen (a name from before the field: its oldest day).
    const firstSeen = m.firstSeen ?? entries.reduce((d, e) => (e.day < d ? e.day : d), today);
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
    // A trend: a name the AI found outside the dictionary, or a dictionary entry marked `trend`.
    const trend = !m.termId || TREND_TERMS.has(m.termId);
    return [{ item, score: creators * Math.min(growth, 4) * boost, firstSeen, trend }];
  });
  // An effect with growth 0 (none in the last 3 days) comes after every effect with a score. Among those: trends first,
  // then the editing techniques the dictionary knows (slow motion, glitch), which always have many creators: live, they
  // filled the list and pushed the owner's GIF stickers (6 creators) out of it. Within each, by score; equal scores: the
  // effect first seen more recently goes first.
  return scored
    .sort(
      (a, b) =>
        Number(b.score > 0) - Number(a.score > 0) ||
        Number(b.trend) - Number(a.trend) ||
        b.score - a.score ||
        daysBetween(a.firstSeen, b.firstSeen),
    )
    .slice(0, MAX_ITEMS)
    .map((s) => s.item);
}
