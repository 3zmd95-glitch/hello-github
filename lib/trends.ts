import {
  TrendItemSchema,
  type Genre,
  type Idea,
  type Lang,
  type SaudiEvent,
  type TrendItem,
  type TrendPlatform,
  type TrendRegion,
  type TrendsState,
} from "./domain";
import { discoverGenreHref } from "./genres";
import type { MessageKey } from "./i18n";
import { addDays, daysBetween } from "./streak";

/**
 * 📈 Trend Radar rules (round 30, planning/tools/08-trends.md, planning/handovers/mastermind-2026-09-28.md):
 * which rows of the persisted feed show, how stale a feed is, niche-keyword highlighting that ignores Arabic
 * diacritics, the idea text a trend becomes, and the Saudi moments calendar (upcoming events and their trend
 * rows). Round 31 adds the edit genres: rows the Worker's keyword scan tagged with a genre id, the filter
 * that reads them (Discover's "most viewed this week" strip; the radar itself filters by language and
 * platform only, Discover is the one place for genres), the name a row's genre chip shows and the Discover
 * link it opens, and the ⭐ rule that does not count a genre's own search words. Pure functions only; the
 * store keeps the feed and lib/trendsClient talks to the Worker.
 */

/* ---------- Keywords ---------- */

/** The owner's niche keywords (proposed defaults, 08-trends.md "Owner's part"); highlighted in the radar. */
export const DEFAULT_TREND_KEYWORDS: Record<Lang, readonly string[]> = {
  ar: ["تصوير", "مونتاج", "دافنشي", "تصحيح الألوان", "كاميرا", "صانع محتوى"],
  en: [
    "davinci resolve",
    "color grading",
    "b-roll",
    "iphone videography",
    "video editing",
    "content creator",
  ],
};

/**
 * Fold text for matching: lower-case, no Arabic diacritics (U+064B–U+0652) or kashida (U+0640), alef forms
 * (أ إ آ) → ا, ة → ه, ى → ي, one space between words.
 */
export function normalizeTrendText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when any keyword occurs in the title or tags (case- and diacritics-insensitive substring). */
export function matchesKeywords(item: TrendItem, keywords: readonly string[]): boolean {
  const haystack = normalizeTrendText([item.title, ...item.tags].join(" "));
  return keywords.some((k) => {
    const needle = normalizeTrendText(k);
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * The radar's ⭐ rule (round 31): `matchesKeywords`, except that a row of a genre the app knows (`genres` is
 * lib/genres' `allGenres(customGenres)`) does not count that genre's own search words. The Worker's keyword
 * scan tags every row with the query that found it (`tags[0]`), and genre queries such as "مونتاج أكل" or
 * "تصوير قهوة" contain niche words, so every row of those genres would be starred for how it was found and
 * not for what it is. The tags equal to one of the genre's queries (Arabic or English, same folding as the
 * keywords) are left out, unless the tag is itself a niche keyword (the Worker searches a keyword that is
 * both only once). A genre row is then starred when its title matches a niche keyword or a niche keyword
 * found it. A row without a genre, or with an id the app does not know, matches on its title and every tag.
 */
export function matchesNiche(
  item: TrendItem,
  keywords: readonly string[],
  genres: readonly Genre[],
): boolean {
  const genre = item.genre ? genres.find((g) => g.id === item.genre) : undefined;
  if (!genre) return matchesKeywords(item, keywords);
  const own = new Set([...genre.queries.ar, ...genre.queries.en].map(normalizeTrendText));
  const niche = new Set(keywords.map(normalizeTrendText));
  const tags = item.tags.filter((tag) => {
    const folded = normalizeTrendText(tag);
    return !own.has(folded) || niche.has(folded);
  });
  return matchesKeywords({ ...item, tags }, keywords);
}

/* ---------- Feed ---------- */

export interface TrendFilter {
  region?: TrendRegion;
  platform?: TrendPlatform;
  /** `mixed` rows (events, hashtags) show under both languages. */
  lang?: Lang;
  /**
   * Edit-genre id (round 31): only the rows tagged with exactly this id; rows without a genre drop out.
   * Discover's strip uses it; the radar does not filter by genre.
   */
  genre?: string;
  /** Free-text search over title + tags (same folding as the keywords). */
  q?: string;
}

/** Rows of the feed that still show: not dismissed, not expired, matching the filter; best score first, then newest. */
export function visibleTrends(
  state: TrendsState,
  filter: TrendFilter = {},
  now: Date = new Date(),
): TrendItem[] {
  const dismissed = new Set(state.dismissed);
  const nowMs = now.getTime();
  const q = filter.q?.trim();
  return state.items
    .filter((i) => !dismissed.has(i.id))
    .filter((i) => !i.expiresAt || Date.parse(i.expiresAt) > nowMs)
    .filter((i) => !filter.region || i.region === filter.region)
    .filter((i) => !filter.platform || i.platform === filter.platform)
    .filter((i) => !filter.lang || i.lang === filter.lang || i.lang === "mixed")
    .filter((i) => !filter.genre || i.genre === filter.genre)
    .filter((i) => !q || matchesKeywords(i, [q]))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.seenAt.localeCompare(a.seenAt));
}

/** True when the feed was never fetched, its time is unreadable, or it is older than `maxAgeHours`. */
export function trendsStale(fetchedAt: string | null, now: Date, maxAgeHours = 6): boolean {
  if (!fetchedAt) return true;
  const at = Date.parse(fetchedAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > maxAgeHours * 3_600_000;
}

/**
 * The Worker's raw source labels (workers/scout/src/trends/types.ts SOURCE_LABELS) → their message keys, so the
 * Arabic-first UI shows the attribution in the owner's language. The raw label stays the source of truth
 * (`data-source`, the idea text); an unknown label shows verbatim.
 */
export const SOURCE_KEY: Readonly<Record<string, MessageKey>> = {
  "Google Trends": "trends.source.google",
  "YouTube charts": "trends.source.youtube",
  "YouTube search": "trends.source.youtubeSearch",
  "kworb.net": "trends.source.kworb",
  "Tavily scan": "trends.source.tavily",
  "trends24.in": "trends.source.x",
  "3z calendar": "trends.source.events",
};

/** The localized source badge for a row: its message when the label is known, else the raw label. */
export function sourceLabel(source: string, t: (key: MessageKey) => string): string {
  const key = Object.hasOwn(SOURCE_KEY, source) ? SOURCE_KEY[source] : undefined;
  return key ? t(key) : source;
}

/** The ideas-bank text a trend row becomes ("💡 احفظ كفكرة"): "📈 ترند: <title> (<source>)". */
export function trendIdeaText(item: TrendItem, lang: Lang): string {
  const label = lang === "ar" ? "📈 ترند" : "📈 Trend";
  return `${label}: ${item.title} (${item.source})`;
}

/**
 * The bank's idea for a trend, saved in either UI language (the text's prefix depends on it), so switching
 * the language does not make 💡 / 📱 save the same trend twice.
 */
export function savedTrendIdea(ideas: readonly Idea[], item: TrendItem): Idea | undefined {
  const texts = [trendIdeaText(item, "ar"), trendIdeaText(item, "en")];
  return ideas.find((i) => i.source === "trend" && texts.includes(i.text));
}

/* ---------- Edit genres (round 31) ---------- */

/**
 * What a row's genre chip says: "<emoji> <name>" in the UI language for a genre the app knows ("🚗 سيارات" /
 * "🚗 Cars"; `genres` is lib/genres' `allGenres(customGenres)`), or the raw id when the app does not know it
 * (a newer Worker, a custom genre the owner removed).
 */
export function trendGenreLabel(id: string, genres: readonly Genre[], lang: Lang): string {
  const genre = genres.find((g) => g.id === id);
  return genre ? `${genre.emoji} ${genre.name[lang]}` : id;
}

/**
 * Where a row's genre chip goes: Discover opened on that genre (lib/genres' `discoverGenreHref`), the one
 * place for edit genres. Undefined for an id the app does not know: Discover has no chip for it, so the
 * radar's chip stays plain text.
 */
export function trendGenreHref(id: string, genres: readonly Genre[]): string | undefined {
  return genres.some((g) => g.id === id) ? discoverGenreHref(id) : undefined;
}

/* ---------- Saudi moments calendar ---------- */

export interface UpcomingEvent {
  event: SaudiEvent;
  /** Days until the event starts; 0 while a multi-day event is running. */
  inDays: number;
}

/** Last day an event counts (its `endDate`, else its `date`). */
const lastDay = (e: SaudiEvent): string => e.endDate ?? e.date;

/**
 * Events that start within `withinDays` of `today` (a Riyadh day key), plus those already running (their
 * `endDate` has not passed), sorted by date. Past events are left out.
 */
export function upcomingEvents(
  events: readonly SaudiEvent[],
  today: string,
  withinDays = 60,
): UpcomingEvent[] {
  return events
    .filter((e) => lastDay(e) >= today)
    .map((e) => ({ event: e, inDays: e.date <= today ? 0 : daysBetween(today, e.date) }))
    .filter((u) => u.inDays <= withinDays)
    .sort(
      (a, b) => a.event.date.localeCompare(b.event.date) || a.event.id.localeCompare(b.event.id),
    );
}

/**
 * A calendar event as a radar row (platform `event`, region SA, source "3z calendar", both names in the title,
 * the hashtags as `why`). It expires at the Riyadh midnight after its last day.
 */
export function eventToTrendItem(event: SaudiEvent, nowIso: string): TrendItem {
  return TrendItemSchema.parse({
    id: `event:SA:${event.id}`,
    platform: "event",
    region: "SA",
    lang: "mixed",
    title: `${event.name.ar} · ${event.name.en}`,
    source: "3z calendar",
    ...(event.hashtags.length ? { why: event.hashtags.join(" ") } : {}),
    seenAt: nowIso,
    expiresAt: `${addDays(lastDay(event), 1)}T00:00:00+03:00`,
    tags: [event.kind, ...event.hashtags],
  });
}
