import type { DiscoverItem, DiscoverPlatform } from "./discover";
import type { DiscoverCandidate } from "./discoverFeed";
import type { DiscoverForYouRow } from "./discoverForYou";
import { creatorKey } from "./discoverRanking";
import { editFormatQuery, type EditFormat } from "./editFormats";
import type { TrendingEffects } from "./effects";
import { canonicalRefUrl, hasArabic } from "./research";
import { CREATIVE } from "../workers/scout/src/categories/quality";
import { normalizeTerm } from "../workers/scout/src/discover/terms";
import { postedAt } from "../workers/scout/src/postDate";

/**
 * Trending edits (owner, 22 Oct 2026: "the same technique across many editors recently"). Zero credits: the posts
 * Discover already read (the local For You corpus, by each post's own date) and the Worker's daily effects/format doc
 * (`GET /effects/trending`, a KV read). Every row carries a creator count and first → last dates; never a chart.
 */

export interface TrendingEdit {
  /** The technique's matching form: a CREATIVE name when any of its aliases matches, else the folded name. */
  key: string;
  name: { en: string; ar?: string };
  source: "local" | "effects" | "format" | "merged";
  tier: "trending" | "emerging";
  creators: number;
  /** Distinct Discover categories; 0 when only the Worker counted it (shown as "—"). */
  categories: number;
  /** ISO days (YYYY-MM-DD, UTC). */
  firstSeen: string;
  lastSeen: string;
  rising: boolean;
  /** True when the only date is the daily scan's own (a Worker row with no dated sample). */
  scanDated?: boolean;
  /** The two sources' own counts: posts Discover read (local) and the daily scan's 7-day identified accounts. */
  localCreators?: number;
  scanCreators?: number;
  /** Local breadth is met (3+ posts, creators and 2+ categories in 30 days) but no post is under 14 days old: the daily
   * scan (accounts in the last 7 days) can supply the recent part. */
  needsRecent?: boolean;
  /** At most 3: a different platform first, newest first. */
  examples: DiscoverItem[];
  formatKey?: string;
  learnQuery: string;
}

const DAY = 86_400_000;
/** Local counting window; "trending" also needs a post inside RECENT. */
const WINDOW = 30 * DAY;
const RECENT = 14 * DAY;
/** The Worker's growth ratio (recent / before): from 1.5 a technique is "rising", from 2 a Worker-only row trends. */
const RISING_GROWTH = 1.5;
const TRENDING_GROWTH = 2;
/** Growth alone trends a Worker-only row only from this many accounts (3 accounts at x3 is emerging, rising). */
const TRENDING_GROWTH_CREATORS = 5;
const TRENDING_CREATORS = 10;
const MAX_ROWS = 12;

const ALIASES = new Map<string, string>();
for (const [name, aliases] of Object.entries(CREATIVE))
  for (const alias of [name, ...aliases]) ALIASES.set(normalizeTerm(alias), name);

/** One technique's identity across languages and sources (lower-case, punctuation stripped, CREATIVE aliases). */
export function editKey(...names: (string | undefined)[]): string {
  const folded = names.filter((name): name is string => !!name?.trim()).map(normalizeTerm);
  return folded.map((name) => ALIASES.get(name)).find(Boolean) ?? folded[0] ?? "";
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const tutorialQuery = (en: string) => `${en} edit tutorial`;

const dateOf = (item: DiscoverItem) => Date.parse(item.published ?? "") || 0;

/** Newest first (undated last), one dated post per platform before a second from any platform, at most 3,
 * one per post. */
function pickExamples(items: readonly DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  const unique = [...items]
    .sort((a, b) => dateOf(b) - dateOf(a))
    .filter((item) => {
      const key = canonicalRefUrl(item.platform, item.url);
      return !seen.has(key) && !!seen.add(key);
    });
  const platforms = new Set<DiscoverPlatform>();
  const first = unique.filter(
    (item) => !!dateOf(item) && !platforms.has(item.platform) && platforms.add(item.platform),
  );
  return [...first, ...unique.filter((item) => !first.includes(item))].slice(0, 3);
}

/** Techniques named in For You rows posted within 30 days by 2+ known creators; "trending" (3+ posts, 3+ creators,
 * 2+ categories) also needs a post in the last 14 days. */
export function localTrendingEdits(
  rows: readonly Pick<DiscoverForYouRow, "item" | "genreId" | "evidence">[],
  now = Date.now(),
): TrendingEdit[] {
  const groups = new Map<
    string,
    { creator: string; genreId: string; at: number; item: DiscoverItem }[]
  >();
  for (const { item, genreId, evidence } of rows) {
    const at = Date.parse(
      evidence.date.published ?? item.published ?? postedAt(item.url, new Date(now)) ?? "",
    );
    const creator = creatorKey(item);
    // No date or no known creator: no proof, so no count.
    if (!Number.isFinite(at) || now - at > WINDOW || at - now > DAY || creator.startsWith("post:"))
      continue;
    const post = { creator, genreId, at, item: { ...item, published: new Date(at).toISOString() } };
    for (const technique of new Set(evidence.techniques))
      groups.set(technique, [...(groups.get(technique) ?? []), post]);
  }
  return [...groups].flatMap(([technique, posts]) => {
    const creators = new Set(posts.map((post) => post.creator)).size;
    const categories = new Set(posts.map((post) => post.genreId)).size;
    const broad = posts.length >= 3 && creators >= 3 && categories >= 2;
    const recent = posts.some((post) => now - post.at <= RECENT);
    const tier =
      broad && recent ? "trending" : posts.length >= 2 && creators >= 2 ? "emerging" : null;
    if (!tier) return [];
    const within = (from: number, to: number) =>
      new Set(posts.filter((p) => now - p.at >= from && now - p.at < to).map((p) => p.creator))
        .size;
    const times = posts.map((post) => post.at);
    const ar = CREATIVE[technique]?.find(hasArabic);
    return [
      {
        key: editKey(technique),
        name: { en: technique, ...(ar ? { ar } : {}) },
        source: "local" as const,
        tier,
        creators,
        categories,
        localCreators: creators,
        ...(broad && !recent ? { needsRecent: true } : {}),
        firstSeen: isoDay(Math.min(...times)),
        lastSeen: isoDay(Math.max(...times)),
        rising: within(-DAY, 3 * DAY) > within(3 * DAY, 6 * DAY),
        examples: pickExamples(posts.map((post) => post.item)),
        learnQuery: tutorialQuery(technique),
      },
    ];
  });
}

const platformOf = (url: string): DiscoverPlatform | null => {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return host === "tiktok.com"
    ? "tt"
    : host === "instagram.com"
      ? "ig"
      : host === "youtube.com" || host === "youtu.be"
        ? "yt"
        : null;
};

/** The daily scan's own time: its `updatedAt`, while that scan is under 3 days old (lib/effects
 * rowVisible's age); null for no scan, a never-run one or a stale one. */
function scanAt(data: TrendingEffects | null, now: number): number | null {
  if (!data || data.status === "never") return null;
  const at = Date.parse(data.updatedAt ?? "");
  return now - at <= 3 * DAY && at - now <= DAY ? at : null;
}

/** The day of the daily scan the Worker rows rest on (YYYY-MM-DD, UTC), or null when no row can rest on one. */
export function workerScanDay(data: TrendingEffects | null, now = Date.now()): string | null {
  const at = scanAt(data, now);
  return at === null ? null : isoDay(at);
}

/** Posts Discover has read, and how many were posted in the last 14 days (real post dates only). */
export function postCounts(
  candidates: readonly Pick<DiscoverCandidate, "item">[],
  now = Date.now(),
): { posts: number; recent: number } {
  const recent = candidates.filter(({ item }) => {
    const at = Date.parse(
      item.published ?? item.evidence?.published ?? postedAt(item.url, new Date(now)) ?? "",
    );
    return Number.isFinite(at) && now - at <= RECENT && at - now <= DAY;
  }).length;
  return { posts: candidates.length, recent };
}

/** A Worker-counted row: 2+ identified accounts in 7 days. Its dates are its samples' days inside 14 days, else
 * the day of the daily scan itself (a real date). Samples older than 14 days are not shown. With no category count from posts Discover read it is
 * "trending" only at 10+ accounts or doubled growth, else emerging. */
function workerRow(
  edit: Omit<
    TrendingEdit,
    "tier" | "firstSeen" | "lastSeen" | "categories" | "rising" | "scanDated"
  >,
  dates: number[],
  growth: number,
  scan: number,
  now: number,
): TrendingEdit[] {
  const inWindow = (at: number) => Number.isFinite(at) && now - at <= RECENT && at - now <= DAY;
  const times = dates.filter(inWindow);
  if (edit.creators < 2) return [];
  return [
    {
      ...edit,
      examples: edit.examples.filter((item) => !item.published || inWindow(dateOf(item))),
      tier:
        edit.creators >= TRENDING_CREATORS ||
        (growth >= TRENDING_GROWTH && edit.creators >= TRENDING_GROWTH_CREATORS)
          ? "trending"
          : "emerging",
      categories: 0,
      firstSeen: isoDay(times.length ? Math.min(...times) : scan),
      lastSeen: isoDay(times.length ? Math.max(...times) : scan),
      rising: growth >= RISING_GROWTH,
      scanCreators: edit.creators,
      ...(times.length ? {} : { scanDated: true }),
    },
  ];
}

/** The daily scan's effects and edit formats, while that scan is under 3 days old (lib/effects rowVisible's age). */
export function workerTrendingEdits(
  data: TrendingEffects | null,
  now = Date.now(),
): TrendingEdit[] {
  const scan = scanAt(data, now);
  if (!data || scan === null) return [];
  const effects = data.items.flatMap((effect) => {
    const samples = effect.samples ?? [];
    const examples = samples.flatMap((sample): DiscoverItem[] => {
      const platform = platformOf(sample.url);
      if (!platform) return [];
      const handle = platform === "tt" ? (sample.url.match(/\/(@[\w.-]+)\//)?.[1] ?? "") : "";
      return [
        {
          platform,
          url: sample.url,
          handle,
          title: sample.title,
          snippet: "",
          published: sample.published,
          lang: "en",
          section: "example",
        },
      ];
    });
    return workerRow(
      {
        key: editKey(effect.name.en, effect.name.ar),
        name: effect.name,
        source: "effects",
        creators: effect.creators,
        examples: pickExamples(examples),
        learnQuery: tutorialQuery(effect.name.en),
      },
      samples.map((sample) => Date.parse(sample.published)),
      effect.growth,
      scan,
      now,
    );
  });
  const formats = (data.formats ?? []).flatMap((format: EditFormat) =>
    workerRow(
      {
        key: editKey(format.name.en, format.name.ar),
        name: format.name,
        source: "format",
        creators: format.evidence.creators7d,
        examples: pickExamples(
          format.samples.map((sample) => ({
            platform: sample.platform,
            url: sample.url,
            handle: sample.handle ?? "",
            title: sample.title,
            snippet: "",
            ...(sample.published ? { published: sample.published } : {}),
            lang: "en" as const,
            section: "example" as const,
          })),
        ),
        formatKey: format.key,
        learnQuery: editFormatQuery(format, "tutorials"),
      },
      [format.evidence.latestPostAt, ...format.samples.map((sample) => sample.published)].map(
        (date) => Date.parse(date ?? ""),
      ),
      0,
      scan,
      now,
    ),
  );
  return [...effects, ...formats];
}

/** One row per technique key (most creators, widest dates, examples capped at 3), sorted: trending, rising,
 * creators, latest day; at most 12. */
export function mergeTrendingEdits(
  lists: readonly (readonly TrendingEdit[])[],
  limit = MAX_ROWS,
): TrendingEdit[] {
  const rows = new Map<string, TrendingEdit>();
  for (const edit of lists.flat()) {
    const seen = rows.get(edit.key);
    if (!seen) {
      rows.set(edit.key, edit);
      continue;
    }
    const format = seen.formatKey ? seen : edit.formatKey ? edit : null;
    rows.set(edit.key, {
      ...seen,
      name: {
        en: seen.name.en,
        ...((seen.name.ar ?? edit.name.ar) ? { ar: seen.name.ar ?? edit.name.ar } : {}),
      },
      source: seen.source === edit.source ? seen.source : "merged",
      // Each source is judged by its own rule; a local row lacking only a recent post is completed by the scan’s
      // accounts of the last 7 days (the other source), so it is never worse off than a row without a scan.
      tier:
        seen.tier === "trending" ||
        edit.tier === "trending" ||
        (seen.needsRecent && !!edit.scanCreators) ||
        (edit.needsRecent && !!seen.scanCreators)
          ? "trending"
          : "emerging",
      creators: Math.max(seen.creators, edit.creators),
      categories: Math.max(seen.categories, edit.categories),
      firstSeen: seen.firstSeen < edit.firstSeen ? seen.firstSeen : edit.firstSeen,
      lastSeen: seen.lastSeen > edit.lastSeen ? seen.lastSeen : edit.lastSeen,
      rising: seen.rising || edit.rising,
      ...(seen.scanDated || edit.scanDated ? { scanDated: true } : {}),
      ...(seen.localCreators || edit.localCreators
        ? { localCreators: Math.max(seen.localCreators ?? 0, edit.localCreators ?? 0) }
        : {}),
      ...(seen.scanCreators || edit.scanCreators
        ? { scanCreators: Math.max(seen.scanCreators ?? 0, edit.scanCreators ?? 0) }
        : {}),
      examples: pickExamples([...seen.examples, ...edit.examples]),
      ...(format ? { formatKey: format.formatKey, learnQuery: format.learnQuery } : {}),
    });
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        Number(b.tier === "trending") - Number(a.tier === "trending") ||
        b.creators - a.creators ||
        Number(b.rising) - Number(a.rising) ||
        b.lastSeen.localeCompare(a.lastSeen),
    )
    .slice(0, limit);
}
