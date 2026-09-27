import { z } from "zod";
import {
  DemographicSchema,
  GenderSchema,
  PLATFORMS,
  SocialPostStatSchema,
  type Demographic,
  type DemographicDimension,
  type Gender,
  type LText,
  type Lang,
  type Platform,
  type PostStatKind,
  type SocialAccount,
  type SocialPostStat,
  type SocialSnapshot,
} from "./domain";
import {
  engagementOf,
  latestSnapshot,
  parseCount,
  parseDay,
  parseNumber,
  platformFromAlias,
  type CsvError,
} from "./growth";
import { PLATFORM_META } from "./social";
import { addDays, dayKey, daysBetween } from "./streak";

/**
 * Social Analytics rules (round 27): the Beacons "Social Analytics" page rebuilt from the handover, computed
 * over the store's `socialSnapshots` (platform_daily), `socialPostStats` (posts) and `demographics` arrays.
 * Metric names are the handover's so the numbers can be compared with Beacons. Pure functions only; the
 * importers at the end turn platform exports into rows for the store.
 */

/* ---------- Helpers ---------- */

export type Now = Date | number | string;

const DAY_MS = 86_400_000;
const toMs = (now: Now): number => (typeof now === "number" ? now : new Date(now).getTime());
const round2 = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const meanInt = (xs: readonly number[]): number | null => {
  const m = mean(xs);
  return m === null ? null : Math.round(m);
};
const mean2 = (xs: readonly number[]): number | null => {
  const m = mean(xs);
  return m === null ? null : round2(m);
};
const newestFirst = (a: SocialPostStat, b: SocialPostStat): number =>
  b.publishedAt.localeCompare(a.publishedAt);

/** Stories are 24-hour posts; Beacons leaves them out of averages and top posts. */
const isStory = (p: SocialPostStat): boolean => p.kind === "story";

/* ---------- Post activity ---------- */

/**
 * Published posts of a platform (null = every platform) from the last `days` days up to `now` (future-dated
 * rows are left out), newest first. Stories included: the counters count everything published.
 */
export function postsInWindow(
  stats: readonly SocialPostStat[],
  platform: Platform | null,
  days: number,
  now: Now = new Date(),
): SocialPostStat[] {
  const end = toMs(now);
  const start = end - days * DAY_MS;
  return stats
    .filter((p) => {
      if (platform && p.platform !== platform) return false;
      const t = Date.parse(p.publishedAt);
      return t > start && t <= end;
    })
    .sort(newestFirst);
}

export interface PostCounts {
  posts7d: number;
  posts30d: number;
  posts90d: number;
}

/** "Posts last week / last month / last 90 days" for a platform (null = all platforms summed). */
export function postCounts(
  stats: readonly SocialPostStat[],
  platform: Platform | null,
  now: Now = new Date(),
): PostCounts {
  return {
    posts7d: postsInWindow(stats, platform, 7, now).length,
    posts30d: postsInWindow(stats, platform, 30, now).length,
    posts90d: postsInWindow(stats, platform, 90, now).length,
  };
}

/* ---------- Averages ---------- */

/** (likes + comments + shares + saves) ÷ views × 100 for one post, 2 decimals; null when it has no views. */
export function engagementOfPost(
  post: Pick<SocialPostStat, "views" | "likes" | "comments" | "shares" | "saves">,
): number | null {
  if (post.views <= 0) return null;
  return round2(
    ((post.likes + post.comments + post.shares + (post.saves ?? 0)) / post.views) * 100,
  );
}

export type SampleWindow = "30d" | "last20";

/** The averaging window the handover prescribes: 30 days, or the last 20 posts when fewer than 5 fall in it. */
export const AVERAGE_WINDOW_DAYS = 30;
export const AVERAGE_MIN_POSTS = 5;
export const AVERAGE_FALLBACK_POSTS = 20;

/**
 * The posts an average is computed over: those of `kinds` (null = every kind but stories) published in the
 * last 30 days; when fewer than 5, the last 20 such posts instead. Newest first.
 */
export function averageSample(
  stats: readonly SocialPostStat[],
  platform: Platform,
  now: Now = new Date(),
  kinds: readonly PostStatKind[] | null = null,
): { posts: SocialPostStat[]; window: SampleWindow } {
  const keep = (p: SocialPostStat) => (kinds ? kinds.includes(p.kind) : !isStory(p));
  const recent = postsInWindow(stats, platform, AVERAGE_WINDOW_DAYS, now).filter(keep);
  if (recent.length >= AVERAGE_MIN_POSTS) return { posts: recent, window: "30d" };
  const end = toMs(now);
  const all = stats
    .filter((p) => p.platform === platform && keep(p) && Date.parse(p.publishedAt) <= end)
    .sort(newestFirst)
    .slice(0, AVERAGE_FALLBACK_POSTS);
  return { posts: all, window: "last20" };
}

export interface Averages {
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  avgShares: number | null;
  /** Mean of engagementOfPost over the sample (posts without views skipped), percent, 2 decimals. */
  engagementRate: number | null;
  /** (likes + comments + shares) ÷ followers × 100, mean over the sample; null without followers. */
  engagementByFollowers: number | null;
  /** Posts the averages were computed over (0 = no data). */
  sample: number;
  window: SampleWindow;
}

/**
 * Avg. views / likes / comments / shares and the engagement rates for a platform, per the handover rule (see
 * averageSample). Counts are rounded to integers, rates to 2 decimals. Pass the platform's follower count to
 * get the by-followers variant.
 */
export function averages(
  stats: readonly SocialPostStat[],
  platform: Platform,
  now: Now = new Date(),
  followers?: number | null,
): Averages {
  const { posts, window } = averageSample(stats, platform, now);
  const eng = posts.map(engagementOfPost).filter((e): e is number => e !== null);
  const interactions = posts.map((p) => p.likes + p.comments + p.shares);
  const byFollowers =
    followers && followers > 0 && posts.length
      ? round2(((mean(interactions) ?? 0) / followers) * 100)
      : null;
  return {
    avgViews: meanInt(posts.map((p) => p.views)),
    avgLikes: meanInt(posts.map((p) => p.likes)),
    avgComments: meanInt(posts.map((p) => p.comments)),
    avgShares: meanInt(posts.map((p) => p.shares)),
    engagementRate: mean2(eng),
    engagementByFollowers: byFollowers,
    sample: posts.length,
    window,
  };
}

/* ---------- Overview (the page's cards) ---------- */

/** Card metrics, named after the handover's rows. */
export const METRIC_KEYS = [
  "totalFollowers",
  "totalSubscribers",
  "engagement",
  "engagementByFollowers",
  "avgLikes",
  "avgViews",
  "avgComments",
  "avgShares",
  "avgReelsViews",
  "avgStoryViews",
  "avgStoryClicks",
  "totalPosts",
  "avgVideoViews",
  "avgVideoWatchTime",
  "avgShortsViews",
  "avgShortsWatchTime",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricFormat = "count" | "pct" | "seconds";

export const METRIC_LABELS: Record<MetricKey, LText> = {
  totalFollowers: { ar: "إجمالي المتابعين", en: "Total Followers" },
  totalSubscribers: { ar: "إجمالي المشتركين", en: "Total Subscribers" },
  engagement: { ar: "التفاعل", en: "Engagement" },
  engagementByFollowers: { ar: "التفاعل على المتابعين", en: "Follower Engagement" },
  avgLikes: { ar: "متوسط اللايكات", en: "Avg. Likes" },
  avgViews: { ar: "متوسط المشاهدات", en: "Avg. Views" },
  avgComments: { ar: "متوسط التعليقات", en: "Avg. Comments" },
  avgShares: { ar: "متوسط المشاركات", en: "Avg. Shares" },
  avgReelsViews: { ar: "متوسط مشاهدات الريلز", en: "Avg. Reels Views" },
  avgStoryViews: { ar: "متوسط مشاهدات الستوري", en: "Avg. Story Views" },
  avgStoryClicks: { ar: "متوسط نقرات الستوري", en: "Avg. Story Clicks" },
  totalPosts: { ar: "إجمالي المنشورات", en: "Total Posts" },
  avgVideoViews: { ar: "متوسط مشاهدات الفيديو", en: "Avg. Video Views" },
  avgVideoWatchTime: { ar: "متوسط وقت مشاهدة الفيديو", en: "Avg. Video Watch Time" },
  avgShortsViews: { ar: "متوسط مشاهدات الشورتس", en: "Avg. Shorts Views" },
  avgShortsWatchTime: { ar: "متوسط وقت مشاهدة الشورتس", en: "Avg. Shorts Watch Time" },
};

export const METRIC_FORMAT: Record<MetricKey, MetricFormat> = {
  totalFollowers: "count",
  totalSubscribers: "count",
  engagement: "pct",
  engagementByFollowers: "pct",
  avgLikes: "count",
  avgViews: "count",
  avgComments: "count",
  avgShares: "count",
  avgReelsViews: "count",
  avgStoryViews: "count",
  avgStoryClicks: "count",
  totalPosts: "count",
  avgVideoViews: "count",
  avgVideoWatchTime: "seconds",
  avgShortsViews: "count",
  avgShortsWatchTime: "seconds",
};

/** The "<Platform> Overview" card rows per platform, in the handover's order. */
export const OVERVIEW_ROWS: Record<Platform, MetricKey[]> = {
  instagram: [
    "totalFollowers",
    "engagement",
    "avgLikes",
    "avgViews",
    "avgReelsViews",
    "avgStoryViews",
    "avgStoryClicks",
  ],
  youtube: [
    "totalSubscribers",
    "engagement",
    "avgLikes",
    "avgComments",
    "avgVideoViews",
    "avgVideoWatchTime",
    "avgShortsViews",
    "avgShortsWatchTime",
  ],
  tiktok: ["engagement", "avgViews", "avgLikes", "avgShares", "avgComments"],
  threads: ["totalFollowers", "engagement", "avgLikes", "avgViews", "avgShares", "avgComments"],
  x: ["totalFollowers", "engagement", "avgLikes", "avgViews", "avgShares", "avgComments"],
  snapchat: ["totalFollowers", "engagement", "avgLikes", "avgViews", "avgShares", "avgComments"],
};

/** The rows of a platform card in the "All" view (Followers reads Subscribers on YouTube). */
export const PLATFORM_CARD_ROWS: MetricKey[] = [
  "totalFollowers",
  "engagement",
  "avgLikes",
  "avgViews",
];

export type MetricSource = "posts" | "snapshot" | "none";

export interface OverviewRow {
  metric: MetricKey;
  label: LText;
  format: MetricFormat;
  value: number | null;
  source: MetricSource;
}

export interface PlatformOverview {
  platform: Platform;
  account: SocialAccount | null;
  /** The latest snapshot of the platform, if any. */
  snapshot: SocialSnapshot | null;
  /** Followers (subscribers on YouTube), from the latest snapshot. */
  followers: number | null;
  /** Every metric's value after merging computed averages with the snapshot. */
  metrics: Record<MetricKey, number | null>;
  sources: Record<MetricKey, MetricSource>;
  /** The "<Platform> Overview" card rows (OVERVIEW_ROWS order). */
  rows: OverviewRow[];
  /** Followers, Engagement, Avg. Likes, Avg. Views for the "All" view card. */
  cardRows: OverviewRow[];
  /** Posts last 7 / 30 / 90 days from the imported post stats (the snapshot's posts7d… when none). */
  posts: PostCounts;
  /** Posts behind the computed averages; 0 when they all came from the snapshot. */
  sample: number;
  /** True when the platform has a snapshot, post stats or a saved account. */
  connected: boolean;
}

export interface AnalyticsState {
  snapshots: readonly SocialSnapshot[];
  postStats: readonly SocialPostStat[];
  accounts: readonly SocialAccount[];
}

/** Averages of one kind of post (Reels, Shorts, videos, stories) for the per-platform extras. */
function kindAverages(
  stats: readonly SocialPostStat[],
  platform: Platform,
  now: Now,
  kinds: readonly PostStatKind[],
): { views: number | null; watchTime: number | null; sample: number } {
  const { posts } = averageSample(stats, platform, now, kinds);
  const watch = posts.flatMap((p) => (p.watchTimeS === undefined ? [] : [p.watchTimeS]));
  return {
    views: meanInt(posts.map((p) => p.views)),
    watchTime: mean2(watch),
    sample: posts.length,
  };
}

/**
 * Everything the "<Platform> Overview" and the "All" platform card need for one platform. Each metric merges
 * the value computed from the imported posts with the latest snapshot's field: computed wins when at least 5
 * posts back it, the snapshot wins otherwise, and a computed value fills in when the snapshot lacks the field.
 * Followers always come from the snapshot.
 */
export function platformOverview(
  state: AnalyticsState,
  platform: Platform,
  now: Now = new Date(),
): PlatformOverview {
  const snapshot = latestSnapshot(state.snapshots, platform) ?? null;
  const account = state.accounts.find((a) => a.platform === platform) ?? null;
  const followers = snapshot?.followers ?? null;
  const avg = averages(state.postStats, platform, now, followers);
  const reels = kindAverages(state.postStats, platform, now, ["reel"]);
  const stories = kindAverages(state.postStats, platform, now, ["story"]);
  const videos = kindAverages(state.postStats, platform, now, ["video"]);
  const shorts = kindAverages(state.postStats, platform, now, ["short"]);
  const platformPosts = state.postStats.filter((p) => p.platform === platform);

  const computed: Record<MetricKey, { value: number | null; sample: number }> = {
    totalFollowers: { value: null, sample: 0 },
    totalSubscribers: { value: null, sample: 0 },
    engagement: { value: avg.engagementRate, sample: avg.sample },
    engagementByFollowers: { value: avg.engagementByFollowers, sample: avg.sample },
    avgLikes: { value: avg.avgLikes, sample: avg.sample },
    avgViews: { value: avg.avgViews, sample: avg.sample },
    avgComments: { value: avg.avgComments, sample: avg.sample },
    avgShares: { value: avg.avgShares, sample: avg.sample },
    avgReelsViews: { value: reels.views, sample: reels.sample },
    avgStoryViews: { value: stories.views, sample: stories.sample },
    avgStoryClicks: { value: null, sample: 0 },
    totalPosts: {
      value: platformPosts.length ? platformPosts.length : null,
      sample: platformPosts.length,
    },
    avgVideoViews: { value: videos.views, sample: videos.sample },
    avgVideoWatchTime: { value: videos.watchTime, sample: videos.sample },
    avgShortsViews: { value: shorts.views, sample: shorts.sample },
    avgShortsWatchTime: { value: shorts.watchTime, sample: shorts.sample },
  };
  const fromSnapshot: Record<MetricKey, number | null> = {
    totalFollowers: followers,
    totalSubscribers: followers,
    engagement: snapshot ? engagementOf(snapshot) : null,
    engagementByFollowers: snapshot?.engagementByFollowers ?? null,
    avgLikes: snapshot?.avgLikes ?? null,
    avgViews: snapshot?.avgViews ?? null,
    avgComments: snapshot?.avgComments ?? null,
    avgShares: snapshot?.avgShares ?? null,
    avgReelsViews: snapshot?.avgReelsViews ?? null,
    avgStoryViews: snapshot?.avgStoryViews ?? null,
    avgStoryClicks: snapshot?.avgStoryClicks ?? null,
    totalPosts: snapshot?.totalPosts ?? null,
    avgVideoViews: snapshot?.avgVideoViews ?? null,
    avgVideoWatchTime: snapshot?.avgVideoWatchTime ?? null,
    avgShortsViews: snapshot?.avgShortsViews ?? null,
    avgShortsWatchTime: snapshot?.avgShortsWatchTime ?? null,
  };

  const metrics = {} as Record<MetricKey, number | null>;
  const sources = {} as Record<MetricKey, MetricSource>;
  for (const key of METRIC_KEYS) {
    const c = computed[key];
    const s = fromSnapshot[key];
    if (c.value !== null && c.sample >= AVERAGE_MIN_POSTS) {
      metrics[key] = c.value;
      sources[key] = "posts";
    } else if (s !== null) {
      metrics[key] = s;
      sources[key] = "snapshot";
    } else {
      metrics[key] = c.value;
      sources[key] = c.value === null ? "none" : "posts";
    }
  }
  const row = (metric: MetricKey): OverviewRow => ({
    metric,
    label: METRIC_LABELS[metric],
    format: METRIC_FORMAT[metric],
    value: metrics[metric],
    source: sources[metric],
  });
  const cardRows = PLATFORM_CARD_ROWS.map((m) =>
    row(m === "totalFollowers" && platform === "youtube" ? "totalSubscribers" : m),
  );

  const counted = postCounts(state.postStats, platform, now);
  const posts: PostCounts = platformPosts.length
    ? counted
    : {
        posts7d: snapshot?.posts7d ?? 0,
        posts30d: snapshot?.posts30d ?? 0,
        posts90d: snapshot?.posts90d ?? 0,
      };

  return {
    platform,
    account,
    snapshot,
    followers,
    metrics,
    sources,
    rows: OVERVIEW_ROWS[platform].map(row),
    cardRows,
    posts,
    sample: avg.sample,
    connected: snapshot !== null || account !== null || platformPosts.length > 0,
  };
}

export interface AllOverview {
  /** Sum of followers over the connected platforms with a snapshot. */
  totalFollowers: number;
  /** Means over the platforms that have the value (percent, 2 decimals). */
  avgEngagement: number | null;
  avgLikes: number | null;
  avgViews: number | null;
  /** Post counters summed over every platform. */
  posts: PostCounts;
  /** Connected platforms only (a snapshot, post stats or an account), in PLATFORMS order. */
  platforms: PlatformOverview[];
}

/** The "All" view: KPI row + one card per connected platform. */
export function allOverview(
  state: AnalyticsState,
  now: Now = new Date(),
  platforms: readonly Platform[] = PLATFORMS,
): AllOverview {
  const cards = platforms.map((p) => platformOverview(state, p, now)).filter((o) => o.connected);
  const pluck = (key: MetricKey) =>
    cards.flatMap((o) => (o.metrics[key] === null ? [] : [o.metrics[key] as number]));
  const posts = cards.reduce<PostCounts>(
    (acc, o) => ({
      posts7d: acc.posts7d + o.posts.posts7d,
      posts30d: acc.posts30d + o.posts.posts30d,
      posts90d: acc.posts90d + o.posts.posts90d,
    }),
    { posts7d: 0, posts30d: 0, posts90d: 0 },
  );
  return {
    totalFollowers: pluck("totalFollowers").reduce((a, b) => a + b, 0),
    avgEngagement: mean2(pluck("engagement")),
    avgLikes: meanInt(pluck("avgLikes")),
    avgViews: meanInt(pluck("avgViews")),
    posts,
    platforms: cards,
  };
}

/* ---------- Demographics ---------- */

/** Age buckets in display order (Beacons shows 13-17 … 55-64; 65+ for completeness). */
export const AGE_BUCKETS = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;

/** ISO-3166 alpha-2 codes → bilingual names for the countries the owner's audience comes from. */
export const COUNTRY_NAMES: Record<string, LText> = {
  SA: { ar: "السعودية", en: "Saudi Arabia" },
  EG: { ar: "مصر", en: "Egypt" },
  IQ: { ar: "العراق", en: "Iraq" },
  LY: { ar: "ليبيا", en: "Libya" },
  AE: { ar: "الإمارات", en: "UAE" },
  MA: { ar: "المغرب", en: "Morocco" },
  YE: { ar: "اليمن", en: "Yemen" },
  OM: { ar: "عُمان", en: "Oman" },
  KW: { ar: "الكويت", en: "Kuwait" },
  QA: { ar: "قطر", en: "Qatar" },
  BH: { ar: "البحرين", en: "Bahrain" },
  JO: { ar: "الأردن", en: "Jordan" },
  SY: { ar: "سوريا", en: "Syria" },
  LB: { ar: "لبنان", en: "Lebanon" },
  PS: { ar: "فلسطين", en: "Palestine" },
  SD: { ar: "السودان", en: "Sudan" },
  TN: { ar: "تونس", en: "Tunisia" },
  DZ: { ar: "الجزائر", en: "Algeria" },
  US: { ar: "أمريكا", en: "United States" },
  GB: { ar: "بريطانيا", en: "United Kingdom" },
  DE: { ar: "ألمانيا", en: "Germany" },
  FR: { ar: "فرنسا", en: "France" },
  TR: { ar: "تركيا", en: "Turkey" },
  IN: { ar: "الهند", en: "India" },
  PK: { ar: "باكستان", en: "Pakistan" },
  ID: { ar: "إندونيسيا", en: "Indonesia" },
  other: { ar: "دول أخرى", en: "Others" },
};

const COUNTRY_ALIASES: Record<string, string> = {
  "saudi arabia": "SA",
  ksa: "SA",
  "kingdom of saudi arabia": "SA",
  السعودية: "SA",
  "united arab emirates": "AE",
  uae: "AE",
  الإمارات: "AE",
  الامارات: "AE",
  "united states": "US",
  usa: "US",
  "united states of america": "US",
  "united kingdom": "GB",
  uk: "GB",
  others: "other",
  other: "other",
  أخرى: "other",
  "دول أخرى": "other",
};

/** "Saudi Arabia" / "sa" / "السعودية" → "SA"; unknown names come back trimmed as typed. */
export function countryCode(nameOrCode: string): string {
  const raw = nameOrCode.trim();
  const lower = raw.toLowerCase();
  if (COUNTRY_ALIASES[lower]) return COUNTRY_ALIASES[lower];
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  for (const [code, name] of Object.entries(COUNTRY_NAMES))
    if (name.en.toLowerCase() === lower || name.ar === raw) return code;
  return raw;
}

/** Bilingual name of a country code (falls back to the code itself). */
export function countryName(code: string, lang: Lang): string {
  const name = COUNTRY_NAMES[code] ?? COUNTRY_NAMES[countryCode(code)];
  return name ? name[lang] || name.ar : code;
}

/** 🇸🇦 for "SA"; 🌍 for "other" or anything that is not a two-letter code. */
export function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "🌍";
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export interface DemographicsQuery {
  /** For `age`: Beacons' Male / Female toggle. Omit for the "All" view. */
  gender?: Gender;
  /** A specific snapshot day; the latest day with data otherwise. */
  day?: string;
}

/** The newest day a platform has rows for a dimension, or null. */
export function latestDemographicsDay(
  demographics: readonly Demographic[],
  platform: Platform,
  dimension?: DemographicDimension,
): string | null {
  let best: string | null = null;
  for (const d of demographics) {
    if (d.platform !== platform || (dimension && d.dimension !== dimension)) continue;
    if (!best || d.day > best) best = d.day;
  }
  return best;
}

/**
 * One breakdown of a platform on its latest day (or `day`), largest share first. Without `gender`, `age`
 * returns the ungendered rows, or, when the platform only has age × gender rows, their per-bucket sums (the
 * "All" toggle); with `gender`, only that gender's rows. Other dimensions ignore `gender`.
 */
export function demographicsFor(
  demographics: readonly Demographic[],
  platform: Platform,
  dimension: DemographicDimension,
  { gender, day }: DemographicsQuery = {},
): Demographic[] {
  const target = day ?? latestDemographicsDay(demographics, platform, dimension);
  if (!target) return [];
  const rows = demographics.filter(
    (d) => d.platform === platform && d.dimension === dimension && d.day === target,
  );
  const byPct = (a: Demographic, b: Demographic) => b.pct - a.pct || a.key.localeCompare(b.key);
  if (dimension !== "age") return [...rows].sort(byPct);
  if (gender) return rows.filter((d) => d.gender === gender).sort(byPct);
  const all = rows.filter((d) => d.gender === undefined);
  if (all.length) return all.sort(byPct);
  const sums = new Map<string, number>();
  for (const d of rows) sums.set(d.key, (sums.get(d.key) ?? 0) + d.pct);
  return [...sums]
    .map(([key, pct]) => ({ platform, day: target, dimension, key, pct: round2(pct) }))
    .sort(byPct);
}

/* ---------- Top posts ---------- */

/** The best posts of the last 7 days, all platforms: views, then likes, comments, shares. Stories excluded. */
export function topPostsThisWeek(
  stats: readonly SocialPostStat[],
  now: Now = new Date(),
  n = 6,
): SocialPostStat[] {
  return postsInWindow(stats, null, 7, now)
    .filter((p) => !isStory(p))
    .sort(
      (a, b) =>
        b.views - a.views || b.likes - a.likes || b.comments - a.comments || b.shares - a.shares,
    )
    .slice(0, Math.max(0, n));
}

/* ---------- What changed this week ---------- */

export interface PlatformWeekDiff {
  platform: Platform;
  latest: SocialSnapshot;
  /** The snapshot nearest to 7 days before `latest` (older snapshots only); null when it is the only one. */
  baseline: SocialSnapshot | null;
  /** Days between baseline and latest. */
  days: number | null;
  followers: number | null;
  followersPct: number | null;
  /** Delta of avgViews when both snapshots have it, of views30d otherwise. */
  views: number | null;
  viewsPct: number | null;
  viewsMetric: "avgViews" | "views30d" | null;
  /** Engagement rate delta in percentage points. */
  engagement: number | null;
}

const pctChange = (from: number, to: number): number | null =>
  from === 0 ? null : Math.round(((to - from) / from) * 1000) / 10;

/**
 * Week-over-week deltas per platform: the latest snapshot (dated up to `now`) against the snapshot closest to
 * 7 days before it (ties go to the older one). Platforms without a snapshot are left out.
 */
export function weeklyDiff(
  snapshots: readonly SocialSnapshot[],
  now: Now = new Date(),
): PlatformWeekDiff[] {
  const today = dayKey(toMs(now));
  const past = snapshots.filter((s) => s.day <= today);
  const out: PlatformWeekDiff[] = [];
  for (const platform of PLATFORMS) {
    const latest = latestSnapshot(past, platform);
    if (!latest) continue;
    const target = addDays(latest.day, -7);
    let baseline: SocialSnapshot | null = null;
    for (const s of past) {
      if (s.platform !== platform || s.day >= latest.day) continue;
      if (!baseline) {
        baseline = s;
        continue;
      }
      const d = Math.abs(daysBetween(target, s.day));
      const b = Math.abs(daysBetween(target, baseline.day));
      if (d < b || (d === b && s.day < baseline.day)) baseline = s;
    }
    const views = (s: SocialSnapshot, metric: "avgViews" | "views30d") =>
      metric === "avgViews" ? (s.avgViews ?? null) : s.views30d;
    let viewsMetric: PlatformWeekDiff["viewsMetric"] = null;
    if (baseline) {
      if (latest.avgViews !== undefined && baseline.avgViews !== undefined)
        viewsMetric = "avgViews";
      else if (latest.views30d > 0 || baseline.views30d > 0) viewsMetric = "views30d";
    }
    const lv = baseline && viewsMetric ? views(latest, viewsMetric) : null;
    const bv = baseline && viewsMetric ? views(baseline, viewsMetric) : null;
    const le = engagementOf(latest);
    const be = baseline ? engagementOf(baseline) : null;
    out.push({
      platform,
      latest,
      baseline,
      days: baseline ? daysBetween(baseline.day, latest.day) : null,
      followers: baseline ? latest.followers - baseline.followers : null,
      followersPct: baseline ? pctChange(baseline.followers, latest.followers) : null,
      views: lv !== null && bv !== null ? lv - bv : null,
      viewsPct: lv !== null && bv !== null ? pctChange(bv, lv) : null,
      viewsMetric,
      engagement: le !== null && be !== null ? round2(le - be) : null,
    });
  }
  return out;
}

/** Latin digits with thousands separators (the handover keeps numbers in Latin digits in Arabic too). */
const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const signed = (n: number): string => (n > 0 ? `+${fmt(n)}` : fmt(n));

/**
 * "What changed this week?" as up to 4 plain sentences (rules, no AI): platforms ordered by the size of their
 * follower change (then engagement), one sentence each. Says so when there is nothing to compare with.
 */
export function whatChanged(diff: readonly PlatformWeekDiff[], lang: Lang): string[] {
  const L = (t: LText) => t[lang] || t.ar;
  if (!diff.length)
    return [
      L({
        ar: "ما عندنا لقطات بعد. سجّل أرقام هذا الأسبوع ونقارن الأسبوع الجاي.",
        en: "No snapshots yet. Record this week's numbers and compare next week.",
      }),
    ];
  const weight = (d: PlatformWeekDiff) =>
    Math.abs(d.followersPct ?? 0) * 1000 +
    Math.abs(d.followers ?? 0) +
    Math.abs(d.engagement ?? 0) * 100;
  const ordered = [...diff].sort((a, b) => {
    const ab = a.baseline ? 0 : 1;
    const bb = b.baseline ? 0 : 1;
    return ab - bb || weight(b) - weight(a);
  });
  const out: string[] = [];
  for (const d of ordered.slice(0, 4)) {
    const name = L(PLATFORM_META[d.platform].name);
    if (!d.baseline) {
      out.push(
        L({
          ar: `${name}: أول لقطة، نقارن الأسبوع الجاي.`,
          en: `${name}: first snapshot, nothing to compare with yet.`,
        }),
      );
      continue;
    }
    const parts: string[] = [];
    if (d.followers !== null && d.followers !== 0) {
      const pct = d.followersPct === null ? "" : ` (${signed(d.followersPct)}%)`;
      parts.push(
        L({
          ar: `المتابعين ${signed(d.followers)}${pct}`,
          en: `followers ${signed(d.followers)}${pct}`,
        }),
      );
    }
    if (d.engagement !== null && d.engagement !== 0) {
      const from = engagementOf(d.baseline) ?? 0;
      const to = engagementOf(d.latest) ?? 0;
      parts.push(
        L({
          ar: `التفاعل من ${fmt(from)}% إلى ${fmt(to)}%`,
          en: `engagement ${fmt(from)}% → ${fmt(to)}%`,
        }),
      );
    }
    if (d.views !== null && d.views !== 0 && d.viewsMetric) {
      const label =
        d.viewsMetric === "avgViews"
          ? { ar: "متوسط المشاهدات", en: "avg. views" }
          : { ar: "مشاهدات ٣٠ يوم", en: "30-day views" };
      const pct = d.viewsPct === null ? "" : ` (${signed(d.viewsPct)}%)`;
      parts.push(
        L({
          ar: `${label.ar} ${signed(d.views)}${pct}`,
          en: `${label.en} ${signed(d.views)}${pct}`,
        }),
      );
    }
    if (!parts.length) {
      out.push(L({ ar: `${name}: ما تغيّر شي هذا الأسبوع.`, en: `${name}: no change this week.` }));
      continue;
    }
    out.push(
      lang === "en"
        ? `${name}: ${parts.join(", ")} this week.`
        : `${name}: ${parts.join("، ")} هذا الأسبوع.`,
    );
  }
  return out;
}

/* ---------- CSV export ---------- */

export const POST_STATS_CSV_COLUMNS = [
  "platform",
  "postId",
  "publishedAt",
  "kind",
  "title",
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "watchTimeS",
  "permalink",
  "thumbUrl",
] as const;

const csvCell = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The "My Content" export: one header line (POST_STATS_CSV_COLUMNS) and one line per post in the given order,
 * RFC 4180 quoting, `\n` line ends. parsePostsCsv reads it back unchanged.
 */
export function postStatsToCsv(stats: readonly SocialPostStat[]): string {
  const lines = [POST_STATS_CSV_COLUMNS.join(",")];
  for (const p of stats) lines.push(POST_STATS_CSV_COLUMNS.map((c) => csvCell(p[c])).join(","));
  return lines.join("\n");
}

/* ---------- CSV import ---------- */

export interface CsvTable {
  header: string[];
  /** Data records with the 1-based line each one started on. */
  rows: { line: number; cells: string[] }[];
  delimiter: string;
}

/**
 * Split CSV text into records (RFC 4180: quoted cells may hold the delimiter, quotes doubled, and line
 * breaks). The delimiter (`,`, `;` or tab) is the one most used on the header line; a BOM is dropped; blank
 * lines are skipped. The first record is the header.
 */
export function parseCsvTable(text: string): CsvTable {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  const delimiter = counts[0].n > 0 ? counts[0].d : ",";

  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== "")) records.push({ line: recordLine, cells });
    cells = [];
    recordLine = line;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\r") {
      // handled with the following \n (or alone as a line end)
      if (src[i + 1] !== "\n") {
        line++;
        endRecord();
      }
    } else if (ch === "\n") {
      line++;
      endRecord();
    } else cell += ch;
  }
  if (cell !== "" || cells.length) endRecord();
  const [head, ...rows] = records;
  return { header: (head?.cells ?? []).map((h) => h.trim()), rows, delimiter };
}

type PostColumn =
  | "platform"
  | "postId"
  | "publishedAt"
  | "kind"
  | "title"
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "watchTimeS"
  | "duration"
  | "permalink"
  | "thumbUrl";

/**
 * Header names (lower-case, spaces collapsed) the post importers recognise, per field. Covers our own export,
 * the Beacons "My Content" CSV, TikTok Studio, the Instagram professional dashboard and YouTube Studio.
 */
export const POST_COLUMN_ALIASES: Record<PostColumn, string[]> = {
  platform: ["platform", "network", "channel", "social", "social platform", "account", "source"],
  postId: [
    "postid",
    "post id",
    "post_id",
    "id",
    "video id",
    "video_id",
    "media id",
    "media_id",
    "content",
    "content id",
    "item id",
  ],
  publishedAt: [
    "publishedat",
    "published at",
    "published",
    "publish date",
    "publish time",
    "video publish time",
    "post time",
    "post date",
    "posted",
    "posted at",
    "date",
    "date posted",
    "created",
    "created at",
    "create time",
    "create_time",
    "timestamp",
    "time",
    "datetime",
  ],
  kind: ["kind", "type", "post type", "media type", "content type", "format", "media_product_type"],
  title: ["title", "video title", "caption", "description", "text", "name", "post"],
  views: [
    "views",
    "view count",
    "view_count",
    "total views",
    "video views",
    "plays",
    "play count",
    "impressions",
  ],
  likes: ["likes", "like count", "like_count", "total likes", "hearts"],
  comments: [
    "comments",
    "comment count",
    "comment_count",
    "total comments",
    "comments added",
    "replies",
    "reply count",
  ],
  shares: ["shares", "share count", "share_count", "total shares", "reposts", "retweets"],
  saves: ["saves", "saved", "save count", "bookmarks", "favorites", "favourites"],
  watchTimeS: [
    "watchtimes",
    "watch time",
    "watch time (s)",
    "watch time (seconds)",
    "watch time (hours)",
    "watch time (minutes)",
    "average watch time",
    "avg watch time",
    "avg. watch time",
    "total watch time",
    "average view duration",
    "avg view duration",
    "total play time",
  ],
  duration: ["duration", "duration (s)", "video duration", "length"],
  permalink: [
    "permalink",
    "link",
    "url",
    "post link",
    "video link",
    "share url",
    "share_url",
    "post url",
    "video url",
  ],
  thumbUrl: [
    "thumburl",
    "thumb url",
    "thumbnail",
    "thumbnail url",
    "thumb",
    "cover",
    "cover image",
    "cover_image_url",
    "image",
  ],
};

const normHeader = (h: string): string =>
  h.toLowerCase().replace(/[‎‏]/g, "").replace(/\s+/g, " ").trim();

/** Which input column feeds each field, by header alias (exact match first, then with "(…)" stripped). */
function mapColumns(header: readonly string[]): Partial<Record<PostColumn, number>> {
  const out: Partial<Record<PostColumn, number>> = {};
  const norm = header.map(normHeader);
  const bare = norm.map((h) => h.replace(/\s*\(.*?\)\s*/g, " ").trim());
  for (const [field, aliases] of Object.entries(POST_COLUMN_ALIASES) as [PostColumn, string[]][]) {
    for (const alias of aliases) {
      let idx = norm.indexOf(alias);
      if (idx === -1) idx = bare.indexOf(alias);
      if (idx !== -1 && !Object.values(out).includes(idx)) {
        out[field] = idx;
        break;
      }
    }
  }
  return out;
}

const KIND_ALIASES: [RegExp, PostStatKind][] = [
  [/^reels?$/, "reel"],
  [/^(story|stories)$/, "story"],
  [/^shorts?$/, "short"],
  [/^(video|videos|clip|long[- ]?form|video_on_demand)$/, "video"],
  [/^(image|images|photo|photos|picture|carousel|carousel_album|album)$/, "image"],
  [/^(thread|threads|text|text post)$/, "thread"],
];

/** What an unlabelled post most likely is on each platform. */
export const DEFAULT_KIND: Record<Platform, PostStatKind> = {
  tiktok: "video",
  instagram: "reel",
  youtube: "video",
  threads: "thread",
  x: "other",
  snapchat: "video",
};

/** "Reel", "Shorts", "VIDEO" → kind; null when unknown. */
export function parseKind(raw: string): PostStatKind | null {
  const s = raw.trim().toLowerCase();
  for (const [re, kind] of KIND_ALIASES) if (re.test(s)) return kind;
  return null;
}

/**
 * A post's publish time as an ISO instant. Accepts ISO 8601 (with or without zone; none = Riyadh),
 * "YYYY-MM-DD HH:MM[:SS]", a day only (YYYY-MM-DD, DD/MM/YYYY: noon Riyadh), a Unix timestamp (s or ms) and
 * anything Date.parse understands ("Sep 20, 2026"). Null when unreadable.
 */
export function parsePublishedAt(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    return new Date(s.length <= 10 ? n * 1000 : n).toISOString();
  }
  const day = parseDay(s);
  if (day) return new Date(`${day}T12:00:00+03:00`).toISOString();
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (m) {
    const zone = m[3] ? m[3].toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, "$1:$2") : "+03:00";
    const t = Date.parse(`${m[1]}T${m[2]}${zone}`);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** "1:23" / "0:01:23" → seconds; "90" → 90; with `unit` from the header ("hours", "minutes") scaled. */
function parseSeconds(raw: string, header: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const n = parseNumber(s);
  if (n === null) return null;
  const h = header.toLowerCase();
  if (/hour/.test(h)) return Math.round(n * 3600);
  if (/min/.test(h)) return Math.round(n * 60);
  return n;
}

const idFromUrl = (url: string): string | null => {
  const path = url
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean).pop();
  if (!seg || /^(www\.)?[a-z0-9.-]+\.[a-z]{2,}$/i.test(seg)) return null;
  const v = /[?&]v=([^&]+)/.exec(url);
  return (v?.[1] ?? seg).replace(/^@/, "");
};

export interface ParsedPostsCsv {
  stats: SocialPostStat[];
  errors: CsvError[];
  /** Input columns that fed each field (for the import preview). */
  columns: Partial<Record<PostColumn, string>>;
}

/**
 * Liberal post-stats importer shared by every platform export: columns are found by header alias (see
 * POST_COLUMN_ALIASES); `platformHint` is used when a row has no platform column or an unknown value. A
 * missing postId is derived from the permalink, else from platform + time + title. A missing kind is read
 * from a duration column on YouTube (≤ 180 s = short) or falls back to DEFAULT_KIND. Rows whose first cell is
 * "Total" (YouTube Studio's summary line) are skipped; rows without a readable date, platform or any number
 * are reported in `errors` with their line. Later rows for the same platform + postId win.
 */
export function parsePostsCsv(text: string, platformHint?: Platform): ParsedPostsCsv {
  const table = parseCsvTable(text);
  const cols = mapColumns(table.header);
  const stats: SocialPostStat[] = [];
  const errors: CsvError[] = [];
  const columns: ParsedPostsCsv["columns"] = {};
  for (const [field, idx] of Object.entries(cols) as [PostColumn, number][])
    columns[field] = table.header[idx];
  if (!table.header.length) return { stats, errors, columns };
  if (cols.publishedAt === undefined) {
    errors.push({ line: 1, message: "no date column found (date / published / publish time)" });
    return { stats, errors, columns };
  }
  const get = (cells: string[], field: PostColumn): string | undefined => {
    const idx = cols[field];
    return idx === undefined ? undefined : cells[idx]?.trim();
  };
  for (const { line, cells } of table.rows) {
    if (/^total$/i.test(cells[0]?.trim() ?? "")) continue;
    const platform =
      (get(cells, "platform") ? platformFromAlias(get(cells, "platform")!) : null) ??
      platformHint ??
      null;
    if (!platform) {
      errors.push({ line, message: `unknown platform "${get(cells, "platform") ?? ""}"` });
      continue;
    }
    const publishedAt = parsePublishedAt(get(cells, "publishedAt") ?? "");
    if (!publishedAt) {
      errors.push({ line, message: `bad date "${get(cells, "publishedAt") ?? ""}"` });
      continue;
    }
    const num = (field: PostColumn): number | undefined => {
      const raw = get(cells, field);
      if (raw === undefined || raw === "" || raw === "-" || raw === "–") return undefined;
      const n = parseCount(raw);
      return n === null ? undefined : n;
    };
    const views = num("views");
    const likes = num("likes");
    const comments = num("comments");
    const shares = num("shares");
    const saves = num("saves");
    if ([views, likes, comments, shares].every((v) => v === undefined)) {
      errors.push({ line, message: "no views / likes / comments / shares" });
      continue;
    }
    const title = get(cells, "title") || undefined;
    const permalink = get(cells, "permalink") || undefined;
    const thumbUrl = get(cells, "thumbUrl") || undefined;
    const postId =
      get(cells, "postId") ||
      (permalink ? idFromUrl(permalink) : null) ||
      `${platform}:${publishedAt}:${(title ?? "").slice(0, 40)}`;
    let kind = get(cells, "kind") ? parseKind(get(cells, "kind")!) : null;
    const durationRaw = get(cells, "duration");
    if (!kind && platform === "youtube" && durationRaw) {
      const d = parseSeconds(durationRaw, "");
      if (d !== null) kind = d <= 180 ? "short" : "video";
    }
    const watchRaw = get(cells, "watchTimeS");
    const watchTimeS =
      watchRaw && cols.watchTimeS !== undefined
        ? parseSeconds(watchRaw, table.header[cols.watchTimeS])
        : null;
    const parsed = SocialPostStatSchema.safeParse({
      platform,
      postId,
      publishedAt,
      kind: kind ?? DEFAULT_KIND[platform],
      ...(title ? { title } : {}),
      views: views ?? 0,
      likes: likes ?? 0,
      comments: comments ?? 0,
      shares: shares ?? 0,
      ...(saves !== undefined ? { saves } : {}),
      ...(watchTimeS !== null ? { watchTimeS } : {}),
      ...(permalink ? { permalink } : {}),
      ...(thumbUrl ? { thumbUrl } : {}),
    });
    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues.map((e) => e.message).join("; ") });
      continue;
    }
    const i = stats.findIndex(
      (s) => s.platform === parsed.data.platform && s.postId === parsed.data.postId,
    );
    if (i === -1) stats.push(parsed.data);
    else stats[i] = parsed.data;
  }
  return { stats, errors, columns };
}

/** Beacons Home → My Content → "Download as CSV" (has a platform column) or our own postStatsToCsv output. */
export function parseMyContentCsv(text: string): ParsedPostsCsv {
  return parsePostsCsv(text);
}

/** TikTok Studio → Analytics → Content export (Video title, Video link, Video publish time, Total views…). */
export function parseTikTokStudioCsv(text: string): ParsedPostsCsv {
  return parsePostsCsv(text, "tiktok");
}

/** Instagram professional dashboard / Meta Business Suite content export. */
export function parseInstagramCsv(text: string): ParsedPostsCsv {
  return parsePostsCsv(text, "instagram");
}

/**
 * YouTube Studio → Analytics → Content → Export "Table data" (Content, Video title, Video publish time,
 * Duration, Views, Watch time (hours), Likes, Comments added, Shares). Duration decides short vs video.
 */
export function parseYouTubeStudioCsv(text: string): ParsedPostsCsv {
  return parsePostsCsv(text, "youtube");
}

/* ---------- Demographics import ---------- */

const PctValue = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : parseNumber(v);
  if (n === null || n < 0 || n > 100) {
    ctx.addIssue({ code: "custom", message: `bad percentage "${v}"` });
    return z.NEVER;
  }
  return n;
});
const PctMap = z.record(z.string(), PctValue);

/** The manual demographics entry (TikTok Studio → Analytics → Followers, typed in by hand). */
export const DemographicsEntrySchema = z.object({
  platform: z.string(),
  /** Riyadh day of the reading; today when omitted. */
  day: z.string().optional(),
  gender: PctMap.optional(),
  age: PctMap.optional(),
  /** Age × gender: { male: { "25-34": 30 }, female: { … } }. */
  ageByGender: z.object({ male: PctMap.optional(), female: PctMap.optional() }).optional(),
  country: PctMap.optional(),
  countries: PctMap.optional(),
  city: PctMap.optional(),
  cities: PctMap.optional(),
});
export type DemographicsEntry = z.input<typeof DemographicsEntrySchema>;

export interface ParsedDemographics {
  demographics: Demographic[];
  errors: string[];
}

/** Rows for the store from one validated entry (country keys are normalised to ISO codes). */
export function demographicsFromEntry(
  entry: z.output<typeof DemographicsEntrySchema>,
  today: string = dayKey(),
): { rows: Demographic[]; error: string | null } {
  const platform = platformFromAlias(entry.platform);
  if (!platform) return { rows: [], error: `unknown platform "${entry.platform}"` };
  const day = entry.day ? parseDay(entry.day) : today;
  if (!day) return { rows: [], error: `bad day "${entry.day}" (use YYYY-MM-DD)` };
  const rows: Demographic[] = [];
  const push = (
    dimension: DemographicDimension,
    map: Record<string, number> | undefined,
    keyOf: (k: string) => string = (k) => k.trim(),
    gender?: Gender,
  ) => {
    for (const [k, pct] of Object.entries(map ?? {})) {
      const key = keyOf(k);
      if (!key) continue;
      rows.push({ platform, day, dimension, key, pct, ...(gender ? { gender } : {}) });
    }
  };
  push("gender", entry.gender, (k) => {
    const g = GenderSchema.safeParse(k.trim().toLowerCase());
    return g.success ? g.data : k.trim().toLowerCase();
  });
  push("age", entry.age);
  push("age", entry.ageByGender?.male, undefined, "male");
  push("age", entry.ageByGender?.female, undefined, "female");
  push("country", entry.country ?? entry.countries, countryCode);
  push("city", entry.city ?? entry.cities);
  const parsed = z.array(DemographicSchema).safeParse(rows);
  if (!parsed.success)
    return { rows: [], error: parsed.error.issues.map((e) => e.message).join("; ") };
  return { rows: parsed.data, error: null };
}

/**
 * Parse a manual demographics entry (one object or an array of them) typed as JSON:
 * `{ "platform": "tiktok", "day": "2026-09-27", "gender": { "male": 56, "female": 44 },
 *    "age": { "18-24": 25, "25-34": 53 }, "country": { "Saudi Arabia": 73.1, "others": 16 }, "city": {} }`.
 * Percentages may be numbers or strings ("25%"); country names or codes are normalised to ISO codes. Bad
 * entries are reported in `errors` and skipped; the good rows go to importDemographics.
 */
export function parseDemographicsJson(text: string, today: string = dayKey()): ParsedDemographics {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { demographics: [], errors: ["not valid JSON"] };
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const demographics: Demographic[] = [];
  const errors: string[] = [];
  list.forEach((item, i) => {
    const parsed = DemographicsEntrySchema.safeParse(item);
    const at = list.length > 1 ? `entry ${i + 1}: ` : "";
    if (!parsed.success) {
      errors.push(
        at + parsed.error.issues.map((e) => `${e.path.join(".")} ${e.message}`).join("; "),
      );
      return;
    }
    const { rows, error } = demographicsFromEntry(parsed.data, today);
    if (error) errors.push(at + error);
    else demographics.push(...rows);
  });
  return { demographics, errors };
}

/* ---------- Store helpers (pure) ---------- */

/** `list` with `incoming` applied: the same platform + postId replaces the earlier row. */
export function upsertPostStats(
  list: readonly SocialPostStat[],
  incoming: readonly SocialPostStat[],
): SocialPostStat[] {
  const out = [...list];
  for (const p of incoming) {
    const i = out.findIndex((s) => s.platform === p.platform && s.postId === p.postId);
    if (i === -1) out.push(p);
    else out[i] = p;
  }
  return out;
}

/**
 * `list` with `incoming` applied: every platform + day + dimension set that appears in `incoming` is replaced
 * as a whole (a re-import of a breakdown never leaves stale slices behind).
 */
export function replaceDemographics(
  list: readonly Demographic[],
  incoming: readonly Demographic[],
): Demographic[] {
  const groups = new Set(incoming.map((d) => `${d.platform}|${d.day}|${d.dimension}`));
  return [...list.filter((d) => !groups.has(`${d.platform}|${d.day}|${d.dimension}`)), ...incoming];
}
