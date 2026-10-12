/**
 * Observed editing techniques (planning/tools/18-trending-effects.md): identified accounts in indexed posts dated
 * within 7 days, ordered by recent accounts and then weekly accounts. Rotating search samples do not prove trends.
 * Legacy growth/first-seen fields remain API-compatible but are not popularity claims. History holds ≤ 14 days / 400 keys.
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
    const observations = c.observations ?? [...c.days].map(([id, posted]) => ({ id, day: posted }));
    for (const { id, day: posted } of observations)
      byDay.set(posted, [...(byDay.get(posted) ?? []), id]);
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
    // No baseline means no measured growth. Search coverage is not comparable enough to use this as popularity.
    const growth = before ? Math.round((recent / before) * 100) / 100 : 0;
    // The scan day it was first seen (a name from before the field: its oldest day).
    const firstSeen = m.firstSeen ?? entries.reduce((d, e) => (e.day < d ? e.day : d), today);
    const ytGrowth = youtubeGrowth(entries, today);
    const yt = youtube[key];
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
      samples: m.samples
        .filter((s) => {
          const at = Date.parse(s.published ?? "");
          if (!Number.isFinite(at)) return false;
          const ago = daysBetween(new Date(at).toISOString().slice(0, 10), today);
          return ago >= 0 && ago <= 6;
        })
        .slice(0, 2),
    };
    // Rank observed accounts and recency, without treating static dictionary flags or search-sample ratios as trends.
    return [{ item, recent, firstSeen }];
  });
  // Recent account observations first. A first-seen tie-break is discovery order, never evidence of a new trend.
  return scored
    .sort(
      (a, b) =>
        b.recent - a.recent ||
        b.item.creators - a.item.creators ||
        daysBetween(a.firstSeen, b.firstSeen),
    )
    .slice(0, MAX_ITEMS)
    .map((s) => s.item);
}
