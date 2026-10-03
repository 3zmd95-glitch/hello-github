import type { Genre, Lang } from "./domain";
import {
  popularityOf,
  type LengthFilter,
  type Recency,
  type ResearchTab,
  type SortMode,
} from "./research";
import {
  parseStats,
  scoutCall,
  type KeyValueStorage,
  type ScoutConfig,
  type ScoutError,
  type ScoutSearchOpts,
  type Stats,
} from "./scoutClient";

/**
 * Discover v2 client (round 33, planning/tools/13-discover-search-v2.md): one `POST /discover` per search,
 * the answer cached 24 h on this device (memory + localStorage, 30 entries) when complete (every platform
 * answered or has no key) and not empty, and the pure helpers the sections screen uses. The answer's shape
 * MIRRORS workers/scout/src/discover/types.ts (hand-copied): change both together.
 */

export type DiscoverPlatform = "tt" | "ig" | "yt";
export type DiscoverSection = "example" | "tutorial";

export interface DiscoverItem {
  platform: DiscoverPlatform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
  thumb?: string;
  stats?: Stats;
  published?: string;
  lang: Lang;
  section: DiscoverSection;
  offTopic?: true;
  profile?: string;
}

export interface DiscoverCreator {
  platform: DiscoverPlatform;
  handle: string;
  url: string;
  count: number;
  views?: number;
}

export type DiscoverAlternative =
  { termId: string; label: { ar: string; en: string } } | { exact: true };
export type DiscoverPlatformError = "quota" | "auth" | "upstream" | "daily_cap" | "not_configured";
export type DiscoverPlatformStatus =
  { ok: true; retried?: boolean } | { ok: false; error: DiscoverPlatformError };

export interface DiscoverAnswer {
  topicKey: string;
  understood: { termId?: string; label: { ar: string; en: string }; exact: boolean };
  alternatives: DiscoverAlternative[];
  items: DiscoverItem[];
  creators: DiscoverCreator[];
  platforms: Partial<Record<DiscoverPlatform, DiscoverPlatformStatus>>;
  cost: { tavily: number; youtubeSearch: number };
  cached: boolean;
}

export interface DiscoverRequest {
  q: string;
  exact?: boolean;
  term?: string;
  genreQuery?: { ar?: string; en?: string };
  program?: string;
  timeRange?: "week" | "month" | "year";
  ytLength?: "short" | "long";
  platforms?: DiscoverPlatform[];
}

export type DiscoverResult =
  { ok: true; answer: DiscoverAnswer } | { ok: false; error: ScoutError };

/** The owner's "Not this?" choice for the current topic. */
export interface DiscoverPick {
  term?: string;
  exact?: boolean;
}

/* ---------- the request ---------- */

export function discoverRequestFrom(input: {
  base: string;
  genre?: Pick<Genre, "queries">;
  programHint?: string;
  recency: Recency;
  length: LengthFilter;
  pick?: DiscoverPick;
}): DiscoverRequest | null {
  const genreQuery = input.genre
    ? { ar: input.genre.queries.ar[0], en: input.genre.queries.en[0] }
    : undefined;
  const q = input.base.trim() || genreQuery?.en || genreQuery?.ar || "";
  if (!q) return null;
  return {
    q,
    ...(input.pick?.exact ? { exact: true } : {}),
    ...(input.pick?.term ? { term: input.pick.term } : {}),
    ...(genreQuery ? { genreQuery } : {}),
    ...(input.programHint ? { program: input.programHint } : {}),
    ...(input.recency !== "any" ? { timeRange: input.recency } : {}),
    ...(input.length !== "any" ? { ytLength: input.length } : {}),
  };
}

/* ---------- the answer ---------- */

const PLATFORM_SET = new Set(["tt", "ig", "yt"]);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const isStr = (x: unknown): x is string => typeof x === "string";

function parseItem(x: unknown): DiscoverItem | null {
  if (!isObj(x)) return null;
  if (
    !PLATFORM_SET.has(x.platform as string) ||
    !isStr(x.url) ||
    !isStr(x.title) ||
    !isStr(x.handle)
  )
    return null;
  if (x.section !== "example" && x.section !== "tutorial") return null;
  const stats = parseStats(x.stats);
  return {
    platform: x.platform as DiscoverPlatform,
    handle: x.handle,
    title: x.title,
    snippet: isStr(x.snippet) ? x.snippet : "",
    url: x.url,
    lang: x.lang === "ar" ? "ar" : "en",
    section: x.section,
    ...(isStr(x.thumb) ? { thumb: x.thumb } : {}),
    ...(stats ? { stats } : {}),
    ...(isStr(x.published) ? { published: x.published } : {}),
    ...(x.offTopic === true ? { offTopic: true as const } : {}),
    ...(isStr(x.profile) ? { profile: x.profile } : {}),
  };
}

/** The Worker's answer checked field by field (a broken item is dropped, a broken answer is null). */
export function parseDiscoverAnswer(raw: unknown): DiscoverAnswer | null {
  if (!isObj(raw) || !Array.isArray(raw.items) || !isObj(raw.understood) || !isStr(raw.topicKey))
    return null;
  const items = raw.items.map(parseItem).filter((i): i is DiscoverItem => !!i);
  const creators = Array.isArray(raw.creators)
    ? (raw.creators.filter(
        (c) => isObj(c) && PLATFORM_SET.has(c.platform as string) && isStr(c.url),
      ) as DiscoverCreator[])
    : [];
  return {
    topicKey: raw.topicKey,
    understood: raw.understood as DiscoverAnswer["understood"],
    alternatives: Array.isArray(raw.alternatives)
      ? (raw.alternatives as DiscoverAlternative[])
      : [],
    items,
    creators,
    platforms: isObj(raw.platforms) ? (raw.platforms as DiscoverAnswer["platforms"]) : {},
    cost: isObj(raw.cost) ? (raw.cost as DiscoverAnswer["cost"]) : { tavily: 0, youtubeSearch: 0 },
    cached: raw.cached === true,
  };
}

/* ---------- cache ---------- */

export const DISCOVER_CACHE_KEY = "3z-discover-cache";
export const DISCOVER_CACHE_VERSION = 1;
export const DISCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DISCOVER_CACHE_MAX = 30;

interface Entry {
  at: number;
  answer: DiscoverAnswer;
}
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<DiscoverResult>>();

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Where a request is cached: the version, the Worker URL and the request in a stable form. */
export function discoverRequestKey(config: ScoutConfig, req: DiscoverRequest): string {
  return `v${DISCOVER_CACHE_VERSION}|${config.url}|${JSON.stringify({
    q: req.q.trim().toLowerCase().replace(/\s+/g, " "),
    exact: !!req.exact,
    term: req.term ?? "",
    genre: [req.genreQuery?.ar ?? "", req.genreQuery?.en ?? ""],
    program: req.program ?? "",
    timeRange: req.timeRange ?? "",
    ytLength: req.ytLength ?? "",
    platforms: [...(req.platforms ?? [])].sort(),
  })}`;
}

function readStored(storage: KeyValueStorage | null): Record<string, Entry> {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(DISCOVER_CACHE_KEY) ?? "{}") as unknown;
    return isObj(raw) ? (raw as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

const fresh = (e: Entry | undefined, now: number): e is Entry =>
  !!e && typeof e.at === "number" && now - e.at < DISCOVER_CACHE_TTL_MS && isObj(e.answer);

/** A fresh kept answer, as served from here: `cached`, and it cost nothing this time. */
function cacheGet(
  key: string,
  storage: KeyValueStorage | null,
  now: number,
): DiscoverAnswer | undefined {
  let e = memory.get(key);
  if (!fresh(e, now)) {
    e = readStored(storage)[key];
    if (!fresh(e, now)) return undefined;
    memory.set(key, e);
  }
  return { ...e.answer, cached: true, cost: { tavily: 0, youtubeSearch: 0 } };
}

function cacheSet(
  key: string,
  answer: DiscoverAnswer,
  storage: KeyValueStorage | null,
  now: number,
): void {
  const entry = { at: now, answer };
  memory.set(key, entry);
  if (!storage) return;
  const kept = Object.entries({ ...readStored(storage), [key]: entry })
    .filter(([k, e]) => k.startsWith(`v${DISCOVER_CACHE_VERSION}|`) && fresh(e, now))
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, DISCOVER_CACHE_MAX);
  try {
    storage.setItem(DISCOVER_CACHE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage full or blocked: memory still saves credits for this session.
  }
}

export function clearDiscoverCache(storage: KeyValueStorage | null = defaultStorage()): void {
  memory.clear();
  inflight.clear();
  try {
    storage?.removeItem(DISCOVER_CACHE_KEY);
  } catch {
    // ignore
  }
}

export function peekDiscover(
  config: ScoutConfig | null,
  req: DiscoverRequest | null,
): DiscoverAnswer | undefined {
  if (!config || !req) return undefined;
  return cacheGet(discoverRequestKey(config, req), defaultStorage(), Date.now());
}

export async function discoverSearch(
  config: ScoutConfig,
  req: DiscoverRequest,
  opts: ScoutSearchOpts = {},
): Promise<DiscoverResult> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? Date.now;
  const key = discoverRequestKey(config, req);
  if (!opts.force) {
    const hit = cacheGet(key, storage, now());
    if (hit) return { ok: true, answer: hit };
  }
  const running = inflight.get(key);
  if (running) return running;
  const run = (async (): Promise<DiscoverResult> => {
    const r = await scoutCall(
      config,
      "/discover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      },
      opts,
    );
    if (!r.ok) return r;
    const answer = parseDiscoverAnswer(r.data);
    if (!answer) return { ok: false, error: { type: "upstream" } };
    // Kept only when complete, as the Worker does: every platform answered (one without its key never
    // will) and something was found (an empty answer can be a fluke of the moment).
    const complete = Object.values(answer.platforms).every(
      (s) => s?.ok || s?.error === "not_configured",
    );
    if (complete && answer.items.length > 0) cacheSet(key, answer, storage, now());
    return { ok: true, answer };
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/* ---------- views ---------- */

export interface ViewOpts {
  tab: ResearchTab;
  showHidden: boolean;
}

const onTab = (i: DiscoverItem, tab: ResearchTab) => tab === "all" || i.platform === tab;

/** Arabic posts first, each group keeping its order. */
function arabicFirstOf(list: DiscoverItem[]): DiscoverItem[] {
  return [...list.filter((i) => i.lang === "ar"), ...list.filter((i) => i.lang !== "ar")];
}

function byPopularity(list: DiscoverItem[]): DiscoverItem[] {
  return list
    .map((item, i) => ({ item, i, p: popularityOf(item.stats) }))
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1) || a.i - b.i)
    .map((x) => x.item);
}

export function sectionItems(
  answer: DiscoverAnswer,
  section: DiscoverSection,
  opts: ViewOpts & { sort: SortMode; arFirst: boolean },
): DiscoverItem[] {
  let list = answer.items.filter(
    (i) => i.section === section && onTab(i, opts.tab) && (opts.showHidden || !i.offTopic),
  );
  if (opts.sort === "popular") list = byPopularity(list);
  if (opts.arFirst) list = arabicFirstOf(list);
  return list;
}

/** The shown posts with the biggest numbers (views, else likes x 10), 6 by default; ties: newest first. */
export function popularItems(answer: DiscoverAnswer, opts: ViewOpts, max = 6): DiscoverItem[] {
  return answer.items
    .filter(
      (i) =>
        onTab(i, opts.tab) &&
        (opts.showHidden || !i.offTopic) &&
        popularityOf(i.stats) !== undefined,
    )
    .sort(
      (a, b) =>
        (popularityOf(b.stats) ?? 0) - (popularityOf(a.stats) ?? 0) ||
        (b.published ?? "").localeCompare(a.published ?? ""),
    )
    .slice(0, max);
}

export function tabCounts(
  answer: DiscoverAnswer,
  showHidden: boolean,
): Record<ResearchTab, number> {
  const shown = answer.items.filter((i) => showHidden || !i.offTopic);
  const n = (p: DiscoverPlatform) => shown.filter((i) => i.platform === p).length;
  return { all: shown.length, tt: n("tt"), ig: n("ig"), yt: n("yt") };
}

export function hiddenCount(answer: DiscoverAnswer, tab: ResearchTab): number {
  return answer.items.filter((i) => i.offTopic && onTab(i, tab)).length;
}

export function creatorsOn(answer: DiscoverAnswer, tab: ResearchTab): DiscoverCreator[] {
  return answer.creators.filter((c) => tab === "all" || c.platform === tab);
}

/* ---------- usage ---------- */

export interface DiscoverUsage {
  tavily:
    | {
        used: number;
        limit: number | null;
        plan?: string;
        paygoUsed?: number;
        paygoLimit?: number | null;
      }
    | { error: string };
  youtube: { usedToday: number; cap: number };
  connector: { usedToday: number; cap: number };
}

export async function discoverUsage(
  config: ScoutConfig,
  opts: ScoutSearchOpts = {},
): Promise<{ ok: true; usage: DiscoverUsage } | { ok: false; error: ScoutError }> {
  const r = await scoutCall(config, "/discover/usage", {}, opts);
  if (!r.ok) return r;
  const d = r.data as DiscoverUsage;
  if (!isObj(d) || !isObj(d.tavily) || !isObj(d.youtube) || !isObj(d.connector)) {
    return { ok: false, error: { type: "upstream" } };
  }
  return { ok: true, usage: d };
}
