/**
 * Weekly Tavily scan (round 30, planning/tools/08-trends.md): the interim Instagram / TikTok / Shorts
 * signal. Eight searches limited to the platform sites (plus one against the weekly trend blogs), Arabic
 * with `country: "saudi arabia"` and English with `country: "united states"`, `time_range: "week"`. The
 * pages' titles and snippets are mined for `#hashtags` and "quoted names", ranked by how many pages
 * mention them. That is "indexed this week", not a popularity ranking: the label is "Tavily scan".
 * Budget: 8 credits per run (`TAVILY_QUERIES.length`), 1,000 a month shared with `/search`, and at most one
 * run per ISO week (KV stamp `trends:tavily:<week>`, one read and, after a scan, one write) unless forced.
 */

import { hasTavilyStamp, isoWeek, writeTavilyStamp } from "./kv";
import {
  DAY_MS,
  fetchText,
  isoPlus,
  langOfText,
  oneLine,
  rankScore,
  slugify,
  trendId,
} from "./normalize";
import {
  SOURCE_LABELS,
  type SourceCtx,
  type SourceOutput,
  type TrendItem,
  type TrendPlatform,
  type TrendRegion,
} from "./types";

/** The same endpoint `POST /search` (scout.ts) uses. */
export const TAVILY_URL = "https://api.tavily.com/search";
export const TAVILY_MAX_RESULTS = 10;
export const TAVILY_TTL_MS = 14 * DAY_MS;
/** Rows kept per run. */
export const TAVILY_MAX_ITEMS = 40;

export const PLATFORM_SITES = ["tiktok.com", "instagram.com", "youtube.com", "threads.net"];
export const BLOG_SITES = [
  "buffer.com",
  "heyorca.com",
  "later.com",
  "socialpilot.co",
  "lightreel.ai",
];

export interface TavilyQuery {
  query: string;
  country: string;
  language?: "ar" | "en";
  region: TrendRegion;
  include_domains: string[];
}

export const TAVILY_QUERIES: readonly TavilyQuery[] = [
  ...[
    "ترند تيك توك السعودية هذا الأسبوع",
    "ترندات انستقرام ريلز السعودية",
    "أكثر الهاشتاقات انتشارًا في السعودية",
    "ترند يوتيوب شورتس السعودية",
  ].map((query): TavilyQuery => ({
    query,
    country: "saudi arabia",
    language: "ar",
    region: "SA",
    include_domains: PLATFORM_SITES,
  })),
  ...[
    "TikTok trending sounds this week",
    "Instagram Reels trends this week",
    "YouTube Shorts trends this week",
  ].map((query): TavilyQuery => ({
    query,
    country: "united states",
    language: "en",
    region: "US",
    include_domains: PLATFORM_SITES,
  })),
  {
    query: "trending audio Reels TikTok this week",
    country: "united states",
    language: "en",
    region: "global",
    include_domains: BLOG_SITES,
  },
];

export interface TavilyHit {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

export interface TavilyBody {
  results?: TavilyHit[];
  usage?: { credits?: number };
}

/** Hashtags that say nothing about a topic. */
export const HASHTAG_STOPLIST = new Set(
  [
    "fyp",
    "fypage",
    "foryou",
    "foryoupage",
    "viral",
    "trending",
    "trend",
    "trends",
    "explore",
    "explorepage",
    "reels",
    "reel",
    "shorts",
    "short",
    "tiktok",
    "instagram",
    "youtube",
    "threads",
    "video",
    "follow",
    "like",
    "love",
    "اكسبلور",
    "اكسبلورر",
    "ترند",
    "ترندات",
    "فوريو",
    "تيك_توك",
    "تيكتوك",
    "انستقرام",
    "ريلز",
    "يوتيوب",
    "شورتس",
    "لايك",
    "فولو",
  ].map((s) => s.toLowerCase()),
);

const HASHTAG_RE = /#([\p{L}\p{N}_]{2,60})/gu;
const QUOTED_RE = /["“«]([^"“”«»\n]{3,60})["”»]/gu;

/** Distinct `#hashtags` and "quoted names" of a text, in order of appearance, junk removed. */
export function extractTerms(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const k = term.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(term);
  };
  for (const m of text.matchAll(HASHTAG_RE)) {
    const body = m[1].replace(/_+$/g, "");
    if (body.length < 2 || /^[\p{N}_]+$/u.test(body)) continue;
    if (HASHTAG_STOPLIST.has(body.toLowerCase())) continue;
    add(`#${body}`);
  }
  for (const m of text.matchAll(QUOTED_RE)) {
    const name = m[1].trim();
    if (!name || name.length < 3 || /^[\p{N}\s.,!?-]+$/u.test(name)) continue;
    if (name.split(/\s+/).length > 8) continue;
    add(name);
  }
  return out;
}

/** The radar platform of a result page by its host; blogs count as Instagram (their Reels round-ups). */
export function platformOfUrl(url: string | undefined): TrendPlatform {
  let host = "";
  try {
    host = new URL(url ?? "").hostname.toLowerCase();
  } catch {
    return "instagram";
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (is("tiktok.com")) return "tiktok";
  if (is("instagram.com")) return "instagram";
  if (is("youtube.com") || host === "youtu.be") return "youtube";
  if (is("threads.net") || is("threads.com")) return "threads";
  return "instagram";
}

interface TermStat {
  term: string;
  pages: number;
  region: TrendRegion;
  best: TavilyHit;
}

/** Terms counted across every query's results (a page counts once per term), best page first. */
export function scanTerms(results: { query: TavilyQuery; hits: TavilyHit[] }[]): TermStat[] {
  const stats = new Map<string, TermStat>();
  for (const { query, hits } of results) {
    for (const hit of hits) {
      const terms = extractTerms(`${hit.title ?? ""}\n${hit.content ?? ""}`);
      for (const term of terms) {
        const k = term.toLowerCase();
        const had = stats.get(k);
        if (had) had.pages += 1;
        else stats.set(k, { term, pages: 1, region: query.region, best: hit });
      }
    }
  }
  return [...stats.values()].sort((a, b) => b.pages - a.pages);
}

export function tavilyItems(stats: TermStat[], now: Date): TrendItem[] {
  const top = stats.slice(0, TAVILY_MAX_ITEMS);
  const seenAt = now.toISOString();
  const expiresAt = isoPlus(now, TAVILY_TTL_MS);
  return top.map((s, i) => {
    const platform = platformOfUrl(s.best.url);
    return {
      id: trendId(platform, s.region, slugify(s.term)),
      platform,
      region: s.region,
      lang: langOfText(s.term),
      title: s.term,
      url: s.best.url,
      score: rankScore(i + 1, top.length),
      volume: s.pages,
      source: SOURCE_LABELS.tavily,
      why: oneLine(s.best.content),
      seenAt,
      expiresAt,
      tags: ["scan"],
    };
  });
}

/** The request body for one query, the shape `POST /search` sends plus `country` / `language`. */
export function tavilyRequest(q: TavilyQuery): Record<string, unknown> {
  return {
    query: q.query,
    include_domains: q.include_domains,
    max_results: TAVILY_MAX_RESULTS,
    search_depth: "basic",
    time_range: "week",
    country: q.country,
    ...(q.language ? { language: q.language } : {}),
  };
}

export const ALREADY_SCANNED = "already scanned this week";

/**
 * Eight calls, eight credits, once per ISO week: a second run the same week keeps the stored rows and
 * answers `ALREADY_SCANNED` unless `ctx.force`. Stops at the first quota / auth error; what came before
 * still counts (and stamps the week, since the credits are spent).
 */
export async function runTavily(ctx: SourceCtx): Promise<SourceOutput> {
  const key = ctx.env.TAVILY_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  const week = isoWeek(ctx.now);
  // A KV error here throws (run.ts reports it) rather than spending credits blind.
  if (!ctx.force && (await hasTavilyStamp(ctx.env, week))) {
    return { ok: true, items: [], skipped: true, note: ALREADY_SCANNED };
  }
  const results: { query: TavilyQuery; hits: TavilyHit[] }[] = [];
  let error: string | undefined;
  for (const query of TAVILY_QUERIES) {
    if (!ctx.budget.ok) {
      error = "budget";
      break;
    }
    const r = await fetchText(ctx.fetch, ctx.budget, TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(tavilyRequest(query)),
    });
    if (r.status === 401 || r.status === 403) {
      error = "auth";
      break;
    }
    if (r.status === 429 || r.status === 432 || r.status === 433) {
      error = "quota";
      break;
    }
    if (!r.ok) {
      error = `http ${r.status}`;
      break;
    }
    let body: TavilyBody | null = null;
    try {
      body = JSON.parse(r.text) as TavilyBody;
    } catch {
      body = null;
    }
    results.push({ query, hits: body?.results ?? [] });
  }
  if (!results.length) return { ok: false, error: error ?? "empty" };
  try {
    await writeTavilyStamp(ctx.env, week, ctx.now.toISOString());
  } catch {
    // The rows matter more than the stamp; the next run the same week would scan again.
  }
  return {
    ok: true,
    items: tavilyItems(scanTerms(results), ctx.now),
    degraded: !!error,
    note: error ? `stopped after ${results.length} queries: ${error}` : undefined,
  };
}
