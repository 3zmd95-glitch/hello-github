import { AGE_BUCKETS, demographicsFor, latestDemographicsDay, type Now } from "./analytics";
import type { KitMetric } from "./businessKit";
import type { Demographic, Platform, PostStatKind, SocialPostStat } from "./domain";
import { dayKey } from "./streak";

/**
 * 📄 The media-kit page's extra numbers (planning/tools/09 D2). Pure. Everything is read from what the app already
 * stores (Growth snapshots, imported posts, audience breakdowns); nothing is estimated and a missing number stays
 * missing (the page prints "—"). The per-platform followers / engagement / views / likes come from `kitMetrics`.
 */

/**
 * A plain sum of the saved follower counts, with how many platforms it covers (not a unique-audience figure). A count
 * from a snapshot older than KIT_STALE_DAYS is left out (its platform still counts in `of`), so a total never mixes in
 * numbers the page itself calls old.
 */
export interface KitTotal {
  value: number;
  /** Platforms that have a saved count. */
  platforms: number;
  /** Platforms shown in the kit. */
  of: number;
}

export function kitTotalFollowers(metrics: readonly KitMetric[]): KitTotal | null {
  let value = 0;
  let platforms = 0;
  for (const m of metrics)
    if (m.followers.source === "snapshot" && !m.stale) {
      value += m.followers.value;
      platforms += 1;
    }
  return platforms ? { value, platforms, of: metrics.length } : null;
}

export interface KitAudience {
  platform: Platform;
  /** The newest day any of the shown rows was saved for. */
  day: string;
  gender: { male: number | null; female: number | null } | null;
  age: { bucket: string; pct: number }[];
  /** The top 5 countries, largest first ("other" is left out). */
  countries: { code: string; pct: number }[];
}

const TOP_COUNTRIES = 5;

/**
 * Audience breakdowns of `platforms` (in that order), each dimension on its own newest day; rows dated after today
 * (Riyadh) are dropped, as for snapshots. Platforms without any gender, age or country row are left out.
 */
export function kitAudience(
  demographics: readonly Demographic[],
  platforms: readonly Platform[],
  now: Now = new Date(),
): KitAudience[] {
  const today = dayKey(typeof now === "string" ? Date.parse(now) : now);
  const rows = demographics.filter((d) => d.day <= today);
  const out: KitAudience[] = [];
  for (const platform of platforms) {
    const gender = demographicsFor(rows, platform, "gender");
    const male = gender.find((r) => r.key === "male")?.pct ?? null;
    const female = gender.find((r) => r.key === "female")?.pct ?? null;
    const ages = demographicsFor(rows, platform, "age");
    const known: readonly string[] = AGE_BUCKETS;
    const rank = (b: string) => (known.includes(b) ? known.indexOf(b) : known.length);
    const age = ages
      .map((r) => ({ bucket: r.key, pct: r.pct }))
      .sort((a, b) => rank(a.bucket) - rank(b.bucket) || a.bucket.localeCompare(b.bucket));
    const countries = demographicsFor(rows, platform, "country")
      .filter((r) => r.key !== "other")
      .slice(0, TOP_COUNTRIES)
      .map((r) => ({ code: r.key, pct: r.pct }));
    const hasGender = male !== null || female !== null;
    if (!hasGender && !age.length && !countries.length) continue;
    out.push({
      platform,
      day: latestDemographicsDay(rows, platform) ?? today,
      gender: hasGender ? { male, female } : null,
      age,
      countries,
    });
  }
  return out;
}

export interface KitPost {
  platform: Platform;
  postId: string;
  publishedAt: string;
  kind: PostStatKind;
  /** Trimmed, at most 90 characters; null when the platform gave none. */
  title: string | null;
  views: number;
  likes: number;
}

const TITLE_MAX = 90;
const RECENT_POSTS = 6;

/** The newest posts of `platforms` published by `now` (stories left out, as in the averages), newest first. */
export function kitRecentPosts(
  stats: readonly SocialPostStat[],
  platforms: readonly Platform[],
  now: Now = new Date(),
  limit = RECENT_POSTS,
): KitPost[] {
  const end = typeof now === "number" ? now : new Date(now).getTime();
  return stats
    .filter(
      (p) =>
        platforms.includes(p.platform) && p.kind !== "story" && Date.parse(p.publishedAt) <= end,
    )
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, limit)
    .map((p) => {
      const t = (p.title ?? "").trim();
      return {
        platform: p.platform,
        postId: p.postId,
        publishedAt: p.publishedAt,
        kind: p.kind,
        title: t ? (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t) : null,
        views: p.views,
        likes: p.likes,
      };
    });
}
