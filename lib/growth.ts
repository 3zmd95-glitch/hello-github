import {
  PLATFORMS,
  SocialSnapshotSchema,
  type AudienceAsk,
  type Platform,
  type SocialSnapshot,
} from "./domain";
import { addDays, dayKey } from "./streak";

/**
 * Growth rules for the 📱 Social world: numbers are entered by hand (or imported from a CSV) until the
 * platform APIs are approved (planning/tools/03-social-media.md). Everything here is pure and works on the
 * store's `socialSnapshots` and `audienceAsks` arrays.
 */

const sameKey = (a: SocialSnapshot, b: SocialSnapshot) =>
  a.platform === b.platform && a.day === b.day;

/**
 * `engagementPct` (the pre-analytics name) and `engagementRate` (the handover's) are aliases: when only one
 * is set, the other is filled from it. Rows with both, or neither, come back unchanged (same reference).
 */
export function normalizeSnapshot(snap: SocialSnapshot): SocialSnapshot {
  const { engagementPct, engagementRate } = snap;
  if (engagementPct === undefined && engagementRate !== undefined)
    return { ...snap, engagementPct: engagementRate };
  if (engagementRate === undefined && engagementPct !== undefined)
    return { ...snap, engagementRate: engagementPct };
  return snap;
}

/** The engagement rate (percent) of a snapshot under either name, or null when it has none. */
export function engagementOf(
  snap: Pick<SocialSnapshot, "engagementPct" | "engagementRate">,
): number | null {
  return snap.engagementRate ?? snap.engagementPct ?? null;
}

/**
 * `list` with `incoming` applied (normalized, see normalizeSnapshot): an entry for the same platform + day
 * replaces the earlier one.
 */
export function upsertSnapshots(
  list: readonly SocialSnapshot[],
  incoming: readonly SocialSnapshot[],
): SocialSnapshot[] {
  const out = [...list];
  for (const raw of incoming) {
    const snap = normalizeSnapshot(raw);
    const i = out.findIndex((s) => sameKey(s, snap));
    if (i === -1) out.push(snap);
    else out[i] = snap;
  }
  return out;
}

/** The most recent snapshot of a platform, if any. */
export function latestSnapshot(
  snapshots: readonly SocialSnapshot[],
  platform: Platform,
): SocialSnapshot | undefined {
  let best: SocialSnapshot | undefined;
  for (const s of snapshots) if (s.platform === platform && (!best || s.day > best.day)) best = s;
  return best;
}

export interface SnapshotDelta {
  latest: SocialSnapshot | null;
  /** The snapshot the deltas compare against (the newest one at least `days` before `latest`). */
  baseline: SocialSnapshot | null;
  followers: number | null;
  followersPct: number | null;
  views: number | null;
  viewsPct: number | null;
}

const pct = (from: number, to: number): number | null =>
  from === 0 ? null : Math.round(((to - from) / from) * 1000) / 10;

/**
 * Change over roughly `days` days: the latest snapshot against the newest one dated at least `days` before it.
 * Deltas are null when the platform has no snapshot or no earlier one far enough back.
 */
export function snapshotDelta(
  snapshots: readonly SocialSnapshot[],
  platform: Platform,
  days = 30,
): SnapshotDelta {
  const latest = latestSnapshot(snapshots, platform) ?? null;
  const empty: SnapshotDelta = {
    latest,
    baseline: null,
    followers: null,
    followersPct: null,
    views: null,
    viewsPct: null,
  };
  if (!latest) return empty;
  const cutoff = addDays(latest.day, -days);
  let baseline: SocialSnapshot | null = null;
  for (const s of snapshots) {
    if (s.platform !== platform || s.day > cutoff) continue;
    if (!baseline || s.day > baseline.day) baseline = s;
  }
  if (!baseline) return empty;
  return {
    latest,
    baseline,
    followers: latest.followers - baseline.followers,
    followersPct: pct(baseline.followers, latest.followers),
    views: latest.views30d - baseline.views30d,
    viewsPct: pct(baseline.views30d, latest.views30d),
  };
}

export interface Totals {
  followers: number;
  views30d: number;
  /** Mean of the platforms that report engagement, or null when none does. */
  engagementPct: number | null;
  /** Platforms with at least one snapshot. */
  platforms: Platform[];
}

/** Sum of the latest snapshot of every platform. */
export function totals(snapshots: readonly SocialSnapshot[]): Totals {
  const out: Totals = { followers: 0, views30d: 0, engagementPct: null, platforms: [] };
  const eng: number[] = [];
  for (const platform of PLATFORMS) {
    const s = latestSnapshot(snapshots, platform);
    if (!s) continue;
    out.platforms.push(platform);
    out.followers += s.followers;
    out.views30d += s.views30d;
    if (s.engagementPct !== undefined) eng.push(s.engagementPct);
  }
  if (eng.length)
    out.engagementPct = Math.round((eng.reduce((a, b) => a + b, 0) / eng.length) * 10) / 10;
  return out;
}

export interface SeriesPoint {
  day: string;
  followers: number;
  views30d: number;
}

/** A platform's snapshots from the last `days` days (ending at `today`), oldest first, for charts. */
export function series(
  snapshots: readonly SocialSnapshot[],
  platform: Platform,
  days = 90,
  today: string = dayKey(),
): SeriesPoint[] {
  const from = addDays(today, -days);
  return snapshots
    .filter((s) => s.platform === platform && s.day >= from && s.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map(({ day, followers, views30d }) => ({ day, followers, views30d }));
}

/**
 * Total followers on each day with a snapshot in the last `days` days (ending at `today`), oldest first: every
 * platform's latest number on or before that day, summed. For the Studio's growth sparkline.
 */
export function followerTrail(
  snapshots: readonly SocialSnapshot[],
  days = 30,
  today: string = dayKey(),
): { day: string; followers: number }[] {
  const from = addDays(today, -days);
  const daysWithData = [
    ...new Set(snapshots.filter((s) => s.day >= from && s.day <= today).map((s) => s.day)),
  ].sort();
  return daysWithData.map((day) => {
    const upTo = snapshots.filter((s) => s.day <= day);
    const followers = PLATFORMS.reduce(
      (sum, p) => sum + (latestSnapshot(upTo, p)?.followers ?? 0),
      0,
    );
    return { day, followers };
  });
}

/** The platform with the largest follower gain over `days` days, or null when no platform has a baseline. */
export function bestPlatform(
  snapshots: readonly SocialSnapshot[],
  days = 30,
): { platform: Platform; followers: number; followersPct: number | null } | null {
  let best: { platform: Platform; followers: number; followersPct: number | null } | null = null;
  for (const platform of PLATFORMS) {
    const d = snapshotDelta(snapshots, platform, days);
    if (d.followers === null) continue;
    if (!best || d.followers > best.followers)
      best = { platform, followers: d.followers, followersPct: d.followersPct };
  }
  return best;
}

/* ---------- CSV import ---------- */

export interface CsvError {
  /** 1-based line number in the input. */
  line: number;
  message: string;
}

export interface ParsedStatsCsv {
  snapshots: SocialSnapshot[];
  errors: CsvError[];
}

/** Platform names and short forms accepted by the importers (lower-case). */
export const PLATFORM_ALIASES: Record<string, Platform> = {
  tiktok: "tiktok",
  tt: "tiktok",
  instagram: "instagram",
  ig: "instagram",
  insta: "instagram",
  youtube: "youtube",
  yt: "youtube",
  threads: "threads",
  thread: "threads",
  th: "threads",
  x: "x",
  twitter: "x",
  snapchat: "snapchat",
  snap: "snapchat",
  sc: "snapchat",
};

/** "TikTok", " ig ", "Threads" → platform; null when unknown. */
export function platformFromAlias(raw: string): Platform | null {
  return PLATFORM_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/** "1200", "1,200", "1.2k", "3M" → integer; null when not a number. */
export function parseCount(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "").toLowerCase();
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Math.round(n);
}

/** "7.8", "7.8%", "1,234.5" → number (not rounded); null when not a number. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-09-27" or "27/09/2026" or "27-09-2026" → day key; null otherwise. */
export function parseDay(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Optional snapshot metrics a stats CSV may carry as extra header-named columns (any order, after the first five). */
const SNAPSHOT_METRIC_COLUMNS = [
  "engagementRate",
  "engagementByFollowers",
  "avgViews",
  "avgLikes",
  "avgComments",
  "avgShares",
  "posts7d",
  "posts30d",
  "posts90d",
  "avgReelsViews",
  "avgStoryViews",
  "avgStoryClicks",
  "totalPosts",
  "avgVideoViews",
  "avgVideoWatchTime",
  "avgShortsViews",
  "avgShortsWatchTime",
] as const;
type SnapshotMetricColumn = (typeof SNAPSHOT_METRIC_COLUMNS)[number];
const metricByHeader = new Map<string, SnapshotMetricColumn>(
  SNAPSHOT_METRIC_COLUMNS.map((c) => [c.toLowerCase(), c]),
);

/**
 * Parse a simple CSV of `platform,day,followers,views30d[,engagementPct][,<metric>…]` (an optional header
 * line, `;` or `,` separators, blank lines skipped, `#` comments skipped). Platform accepts short forms (tt,
 * ig, yt, th, x, sc). With a header line, further columns named after snapshot metrics (avgViews, avgLikes,
 * avgComments, avgShares, posts7d, posts30d, posts90d, avgReelsViews, …, case-insensitive) are read too; an
 * empty cell leaves the metric unset. Bad lines are reported in `errors` and skipped; later lines for the same
 * platform + day win. Results are normalized (engagementPct ↔ engagementRate).
 */
export function parseStatsCsv(text: string): ParsedStatsCsv {
  const snapshots: SocialSnapshot[] = [];
  const errors: CsvError[] = [];
  const lines = text.split(/\r?\n/);
  let extraColumns: { index: number; metric: SnapshotMetricColumn }[] = [];
  /** Column 5 is the engagement rate unless a header names it as another metric. */
  let engagementAt4 = true;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const cells = trimmed
      .split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && cells[0]?.toLowerCase() === "platform") {
      engagementAt4 = cells[4] === undefined || /^engagement(pct|rate)?$/i.test(cells[4]);
      extraColumns = cells.flatMap((name, index) => {
        const metric = index >= 4 ? metricByHeader.get(name.toLowerCase()) : undefined;
        return metric && !(index === 4 && engagementAt4) ? [{ index, metric }] : [];
      });
      return; // header
    }
    if (cells.length < 4) {
      errors.push({ line, message: "expected platform,day,followers,views30d[,engagementPct]" });
      return;
    }
    const platform = PLATFORM_ALIASES[cells[0].toLowerCase()];
    if (!platform) {
      errors.push({ line, message: `unknown platform "${cells[0]}"` });
      return;
    }
    const day = parseDay(cells[1]);
    if (!day) {
      errors.push({ line, message: `bad day "${cells[1]}" (use YYYY-MM-DD)` });
      return;
    }
    const followers = parseCount(cells[2]);
    const views30d = parseCount(cells[3]);
    if (followers === null || views30d === null) {
      errors.push({ line, message: "followers and views30d must be numbers" });
      return;
    }
    const eng = engagementAt4 ? cells[4]?.replace("%", "").trim() : undefined;
    const engagementPct = eng ? Number(eng) : undefined;
    const extras: Partial<Record<SnapshotMetricColumn, number>> = {};
    for (const { index, metric } of extraColumns) {
      const value = cells[index] === undefined ? null : parseNumber(cells[index]);
      if (value !== null) extras[metric] = value;
    }
    const parsed = SocialSnapshotSchema.safeParse({
      platform,
      day,
      followers,
      views30d,
      ...(engagementPct !== undefined && !Number.isNaN(engagementPct) ? { engagementPct } : {}),
      ...extras,
    });
    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues.map((e) => e.message).join("; ") });
      return;
    }
    const snap = normalizeSnapshot(parsed.data);
    const idx = snapshots.findIndex((s) => sameKey(s, snap));
    if (idx === -1) snapshots.push(snap);
    else snapshots[idx] = snap;
  });
  return { snapshots, errors };
}

/* ---------- Audience asks ---------- */

/** The most-mentioned asks, ties broken by the newest first. */
export function topAsks(asks: readonly AudienceAsk[], n = 3): AudienceAsk[] {
  return [...asks]
    .sort((a, b) => b.count - a.count || b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(0, n));
}
