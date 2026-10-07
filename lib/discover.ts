import type { Genre, Lang } from "./domain";
import { subscriptionPlan, type AiSelection } from "./localAi";
import {
  hasArabic,
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
 * the answer cached 24 h on this device when the Worker calls it complete and it found something (memory,
 * and localStorage within a budget: the app's saved progress shares that quota), and the pure helpers the
 * sections screen uses. The answer's shape MIRRORS workers/scout/src/discover/types.ts (hand-copied): change
 * both together.
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
  /** Shown for the typed idea although it does not mention the selected category (nothing had both). */
  outsideCategory?: true;
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
  | { ok: true; retried?: boolean; partial?: DiscoverPlatformError }
  | { ok: false; error: DiscoverPlatformError };

/** Producer's retrieval/labeling contract, mirrored from workers/scout/src/discover/types.ts. */
export const DISCOVER_QUALITY_VERSION = 7;

export interface DiscoverAnswer {
  /** Missing on older Workers: can be displayed, but must never enter the current cache. */
  qualityVersion?: number;
  topicKey: string;
  understood: {
    termId?: string;
    label: { ar: string; en: string };
    exact: boolean;
    ai?: boolean;
    provider?: "chatgpt" | "claude";
    model?: string;
    effort?: string;
  };
  alternatives: DiscoverAlternative[];
  items: DiscoverItem[];
  creators: DiscoverCreator[];
  platforms: Partial<Record<DiscoverPlatform, DiscoverPlatformStatus>>;
  cost: { tavily: number; youtubeSearch: number };
  cached: boolean;
  /** The Worker could keep it: every query answered (or had no key) and something was found. */
  complete: boolean;
}

export interface DiscoverRequest {
  q: string;
  mode?: "ai";
  /** Local planner selection; only its validated plan is sent to Scout. No credentials. */
  subscription?: AiSelection;
  exact?: boolean;
  term?: string;
  genreQuery?: { ar?: string; en?: string };
  program?: string;
  /** "ar" adds the Arabic tutorials query; "en" (or none, from an older dashboard) plans English only (English first). */
  lang?: Lang;
  /** A trend chip's search (the 🔥 row, a category's style): cards need an editing cue. Keyword searches only. */
  editing?: true;
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

/** The Worker's limits (workers/scout/src/discover/routes.ts): it refuses longer text rather than cut it. */
const MAX_Q = 200;
const MAX_PROGRAM = 60;
const MAX_GENRE_QUERY = 100;

/** Trimmed and cut to `max` UTF-16 units (the Worker's count), never ending in half an emoji. */
const clip = (text: string, max: number) =>
  text
    .trim()
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trim();

/**
 * A keyword search's language, worked out for each search (the owner, 2026-10-07: "English First"): Arabic when what was
 * typed has Arabic letters or Arabic first is on (the Worker then adds the Arabic tutorials query), else English. So a
 * trend chip's English never sticks to the next search.
 */
export function discoverLang(typed: string, arFirst: boolean): Lang {
  return arFirst || hasArabic(typed) ? "ar" : "en";
}

export function discoverRequestFrom(input: {
  mode?: "ai";
  subscription?: AiSelection;
  base: string;
  genre?: Pick<Genre, "queries">;
  programHint?: string;
  recency: Recency;
  length: LengthFilter;
  pick?: DiscoverPick;
  /** The panel's "Arabic first": the search asks Arabic too ({@link discoverLang}). */
  arFirst?: boolean;
  /** A trend chip's search (keyword searches). */
  editing?: boolean;
}): DiscoverRequest | null {
  const typed = clip(input.base, input.mode === "ai" ? 600 : MAX_Q);
  const ar = clip(input.genre?.queries.ar[0] ?? "", MAX_GENRE_QUERY);
  const en = clip(input.genre?.queries.en[0] ?? "", MAX_GENRE_QUERY);
  // Nothing typed: the genre's own query is the topic (English, else Arabic), so it is not sent twice.
  const q = typed || en || ar;
  // Symbols or emoji only: the Worker would refuse it (no word to search).
  if (!/[\p{L}\p{N}]/u.test(q)) return null;
  const genreQuery = { ...(ar && ar !== q ? { ar } : {}), ...(en && en !== q ? { en } : {}) };
  const program = clip(input.programHint ?? "", MAX_PROGRAM);
  return {
    q,
    ...(input.mode === "ai" ? { mode: "ai" as const } : {}),
    ...(input.mode === "ai" && input.subscription ? { subscription: input.subscription } : {}),
    ...(input.pick?.exact ? { exact: true } : {}),
    ...(input.pick?.term ? { term: input.pick.term } : {}),
    ...(genreQuery.ar || genreQuery.en ? { genreQuery } : {}),
    ...(program ? { program } : {}),
    // An AI brief plans its own languages.
    ...(input.mode !== "ai" ? { lang: discoverLang(typed, !!input.arFirst) } : {}),
    ...(input.mode !== "ai" && input.editing ? { editing: true as const } : {}),
    ...(input.recency !== "any" ? { timeRange: input.recency } : {}),
    ...(input.length !== "any" ? { ytLength: input.length } : {}),
  };
}

/* ---------- the answer ---------- */

const PLATFORM_SET = new Set(["tt", "ig", "yt"]);
const PLATFORM_ERRORS = new Set(["quota", "auth", "upstream", "daily_cap", "not_configured"]);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const isStr = (x: unknown): x is string => typeof x === "string";

/** `{ ar, en }` when both are text. */
const labelOf = (x: unknown): { ar: string; en: string } | undefined =>
  isObj(x) && isStr(x.ar) && isStr(x.en) ? { ar: x.ar, en: x.en } : undefined;

/** What the Worker spent: a number ≥ 0, else 0. */
const spentOf = (x: unknown): number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0;

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
    ...(x.outsideCategory === true ? { outsideCategory: true as const } : {}),
    ...(isStr(x.profile) ? { profile: x.profile } : {}),
  };
}

function parseAlternative(x: unknown): DiscoverAlternative | null {
  if (!isObj(x)) return null;
  if (x.exact === true) return { exact: true };
  const label = labelOf(x.label);
  return isStr(x.termId) && label ? { termId: x.termId, label } : null;
}

function parseStatus(x: unknown): DiscoverPlatformStatus | null {
  if (!isObj(x)) return null;
  if (x.ok === true) {
    return {
      ok: true,
      ...(typeof x.retried === "boolean" ? { retried: x.retried } : {}),
      ...(PLATFORM_ERRORS.has(x.partial as string)
        ? { partial: x.partial as DiscoverPlatformError }
        : {}),
    };
  }
  if (x.ok === false && PLATFORM_ERRORS.has(x.error as string)) {
    return { ok: false, error: x.error as DiscoverPlatformError };
  }
  return null;
}

/**
 * The Worker's answer checked field by field: a broken item, alternative or platform status is dropped, a
 * cost that is not a number ≥ 0 is 0, an answer without its topic, items or both labels is null.
 */
export function parseDiscoverAnswer(raw: unknown): DiscoverAnswer | null {
  if (!isObj(raw) || !Array.isArray(raw.items) || !isObj(raw.understood) || !isStr(raw.topicKey))
    return null;
  const u = raw.understood;
  const label = labelOf(u.label);
  if (!label) return null;
  const items = raw.items.map(parseItem).filter((i): i is DiscoverItem => !!i);
  const creators = Array.isArray(raw.creators)
    ? (raw.creators.filter(
        (c) => isObj(c) && PLATFORM_SET.has(c.platform as string) && isStr(c.url),
      ) as DiscoverCreator[])
    : [];
  const alternatives = Array.isArray(raw.alternatives)
    ? raw.alternatives.map(parseAlternative).filter((a): a is DiscoverAlternative => !!a)
    : [];
  const platforms: DiscoverAnswer["platforms"] = {};
  for (const [p, s] of Object.entries(isObj(raw.platforms) ? raw.platforms : {})) {
    const status = parseStatus(s);
    if (status && PLATFORM_SET.has(p)) platforms[p as DiscoverPlatform] = status;
  }
  const cost: Record<string, unknown> = isObj(raw.cost) ? raw.cost : {};
  return {
    ...(Number.isSafeInteger(raw.qualityVersion) && (raw.qualityVersion as number) >= 0
      ? { qualityVersion: raw.qualityVersion as number }
      : {}),
    topicKey: raw.topicKey,
    understood: {
      ...(isStr(u.termId) ? { termId: u.termId } : {}),
      label,
      exact: u.exact === true,
      ...(u.ai === true ? { ai: true } : {}),
      ...(u.provider === "chatgpt" || u.provider === "claude" ? { provider: u.provider } : {}),
      ...(isStr(u.model) ? { model: u.model } : {}),
      ...(isStr(u.effort) ? { effort: u.effort } : {}),
    },
    alternatives,
    items,
    creators,
    platforms,
    cost: { tavily: spentOf(cost.tavily), youtubeSearch: spentOf(cost.youtubeSearch) },
    cached: raw.cached === true,
    // A Worker from before the flag: complete when every platform answered or has no key.
    complete:
      raw.complete === undefined
        ? Object.values(platforms).every((s) =>
            s?.ok ? !s.partial : s?.error === "not_configured",
          )
        : raw.complete === true,
  };
}

/* ---------- cache ---------- */

export const DISCOVER_CACHE_KEY = "3z-discover-cache";
/** 7: known-category searches share the craft gate; older answers must not bypass it. */
export const DISCOVER_CACHE_VERSION = 7;
export const DISCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Answers kept on the device, newest first (memory keeps this session's). */
export const DISCOVER_CACHE_MAX = 8;
/**
 * Characters the kept answers may take in localStorage: the app's saved progress shares the quota, and its
 * persist loses progress when that is full.
 */
export const DISCOVER_CACHE_BUDGET = 1_000_000;

const PREFIX = `v${DISCOVER_CACHE_VERSION}|`;

interface Entry {
  at: number;
  answer: DiscoverAnswer;
}
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<DiscoverResult>>();
/**
 * The device's kept answers, read and checked once per storage, then kept in step by each write and clear (a
 * miss or a peek does not read storage again). ponytail: read once per tab, so another tab's answers are not
 * seen until a reload and the next write here drops them; re-read before writing if that ever matters.
 */
let stored: { from: KeyValueStorage | null; entries: Record<string, Entry> } | undefined;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Where a request is cached: the version, the Worker URL and the request in a stable form. */
export function discoverRequestKey(config: ScoutConfig, req: DiscoverRequest): string {
  return `${PREFIX}${config.url}|${JSON.stringify({
    q: req.q.trim().toLowerCase().replace(/\s+/g, " "),
    mode: req.mode ?? "keyword",
    subscription:
      req.mode === "ai" && req.subscription
        ? [
            req.subscription.provider,
            req.subscription.model,
            req.subscription.effort ?? "",
            req.subscription.accountId ?? "",
          ]
        : undefined,
    exact: !!req.exact,
    term: req.term ?? "",
    genre: [req.genreQuery?.ar ?? "", req.genreQuery?.en ?? ""],
    program: req.program ?? "",
    lang: req.lang ?? "en",
    editing: !!req.editing,
    timeRange: req.timeRange ?? "",
    ytLength: req.ytLength ?? "",
    platforms: [...(req.platforms ?? [])].sort(),
  })}`;
}

/** The storage's kept answers: entries of this version with a time and a sound answer (checked once). */
function storedOf(storage: KeyValueStorage | null): Record<string, Entry> {
  if (stored?.from === storage) return stored.entries;
  const entries: Record<string, Entry> = {};
  try {
    const raw = JSON.parse(storage?.getItem(DISCOVER_CACHE_KEY) ?? "{}") as unknown;
    for (const [k, e] of Object.entries(isObj(raw) ? raw : {})) {
      if (!k.startsWith(PREFIX) || !isObj(e) || typeof e.at !== "number") continue;
      const answer = parseDiscoverAnswer(e.answer);
      if (answer && cacheable(answer)) entries[k] = { at: e.at, answer };
    }
  } catch {
    // Unreadable: nothing kept.
  }
  stored = { from: storage, entries };
  return entries;
}

/** Drops the kept answers from the storage (memory keeps this session's). */
function forgetStored(storage: KeyValueStorage | null): void {
  stored = { from: storage, entries: {} };
  try {
    storage?.removeItem(DISCOVER_CACHE_KEY);
  } catch {
    // ignore
  }
}

const fresh = (e: Entry | undefined, now: number): e is Entry =>
  !!e && now - e.at < DISCOVER_CACHE_TTL_MS;

/** A new frontend may still be talking to an old Worker during rollout. Its complete flag is insufficient. */
const cacheable = (answer: DiscoverAnswer): boolean =>
  answer.qualityVersion === DISCOVER_QUALITY_VERSION && answer.complete && answer.items.length > 0;

function cacheGet(
  key: string,
  storage: KeyValueStorage | null,
  now: number,
): DiscoverAnswer | undefined {
  const mem = memory.get(key);
  if (fresh(mem, now) && cacheable(mem.answer)) return mem.answer;
  const kept = storedOf(storage)[key];
  if (fresh(kept, now)) {
    memory.set(key, kept);
    return kept.answer;
  }
  return undefined;
}

function cacheSet(
  key: string,
  answer: DiscoverAnswer,
  storage: KeyValueStorage | null,
  now: number,
): void {
  if (!cacheable(answer)) return;
  // Kept as a hit serves it: from the cache, and it costs nothing then.
  const entry: Entry = {
    at: now,
    answer: { ...answer, cached: true, cost: { tavily: 0, youtubeSearch: 0 } },
  };
  memory.set(key, entry);
  if (!storage) return;
  const older = Object.entries(storedOf(storage))
    .filter(([k, e]) => k !== key && fresh(e, now))
    .sort(([, a], [, b]) => b.at - a.at);
  // Newest first, at most DISCOVER_CACHE_MAX, while the whole stays within DISCOVER_CACHE_BUDGET characters.
  const kept: [string, Entry][] = [];
  const parts: string[] = [];
  let size = 2; // the braces
  for (const [k, e] of [[key, entry] as [string, Entry], ...older]) {
    const part = `${JSON.stringify(k)}:${JSON.stringify(e)}`;
    size += part.length + (parts.length > 0 ? 1 : 0);
    if (parts.length === DISCOVER_CACHE_MAX || size > DISCOVER_CACHE_BUDGET) break;
    kept.push([k, e]);
    parts.push(part);
  }
  try {
    storage.setItem(DISCOVER_CACHE_KEY, `{${parts.join(",")}}`);
    stored = { from: storage, entries: Object.fromEntries(kept) };
  } catch {
    // Full or blocked: give the room back to the app's saved progress; memory still serves this session.
    forgetStored(storage);
  }
}

export function clearDiscoverCache(storage: KeyValueStorage | null = defaultStorage()): void {
  memory.clear();
  inflight.clear();
  forgetStored(storage);
}

export function peekDiscover(
  config: ScoutConfig | null,
  req: DiscoverRequest | null,
): DiscoverAnswer | undefined {
  if (!config || !req) return undefined;
  const hit = cacheGet(discoverRequestKey(config, req), defaultStorage(), Date.now());
  return hit && answerMatchesPlanner(hit, req) ? hit : undefined;
}

function answerMatchesPlanner(answer: DiscoverAnswer, req: DiscoverRequest): boolean {
  if (req.mode !== "ai") return true;
  if (!answer.understood.ai) return false;
  return req.subscription
    ? answer.understood.provider === req.subscription.provider &&
        answer.understood.model === req.subscription.model &&
        answer.understood.effort === req.subscription.effort
    : !answer.understood.provider;
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
    if (hit && answerMatchesPlanner(hit, req)) return { ok: true, answer: hit };
  }
  const running = inflight.get(key);
  if (running) return running;
  const run = (async (): Promise<DiscoverResult> => {
    const { subscription, ...body } = req;
    let aiPlan;
    if (req.mode === "ai" && subscription) {
      // Check before inference: older Workers silently ignore aiPlan and run their own model.
      const capabilities = await scoutCall(
        config,
        "/health",
        { method: "GET", signal: opts.signal },
        opts,
      );
      if (!capabilities.ok) return capabilities;
      if (!isObj(capabilities.data) || capabilities.data.discoverSubscriptions !== true)
        return { ok: false, error: { type: "subscription_worker_upgrade" } };
      const planned = await subscriptionPlan(subscription, req, opts.fetchImpl, opts.signal);
      if (!planned.ok) return planned;
      aiPlan = planned.data;
    }
    const r = await scoutCall(
      config,
      "/discover",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...(aiPlan ? { aiPlan } : {}) }),
        signal: opts.signal,
      },
      opts,
    );
    if (!r.ok) return r;
    const answer = parseDiscoverAnswer(r.data);
    if (!answer) return { ok: false, error: { type: "upstream" } };
    // An older Worker ignores unknown request fields. Never present its keyword answer as AI search.
    if (!answerMatchesPlanner(answer, req))
      return {
        ok: false,
        error: { type: subscription ? "subscription_worker_upgrade" : "ai_unavailable" },
      };
    // Require the producing Worker's quality version, not just this frontend's cache-key version.
    if (cacheable(answer)) cacheSet(key, answer, storage, now());
    return { ok: true, answer };
  })();
  inflight.set(key, run);
  const forget = () => {
    if (inflight.get(key) === run) inflight.delete(key);
  };
  opts.signal?.addEventListener("abort", forget, { once: true });
  try {
    return await run;
  } finally {
    opts.signal?.removeEventListener("abort", forget);
    forget();
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
  // All: Instagram and TikTok first (the owner, 2026-10-07), each group keeping its order.
  if (opts.tab === "all")
    list = [...list.filter((i) => i.platform !== "yt"), ...list.filter((i) => i.platform === "yt")];
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

/* ---------- Claude's picks ---------- */

/** One post the connector's `save_picks` stored. MIRRORS `Pick` in workers/scout/src/discover/picks.ts. */
export interface ClaudePick {
  url: string;
  platform: DiscoverPlatform;
  title: string;
  handle?: string;
  /** YouTube only (an i.ytimg.com picture); a TikTok card asks /oembed itself, Instagram has none. */
  thumb?: string;
  label: DiscoverSection;
  note?: string;
  savedAt: string;
}

export interface PicksTopic {
  topicKey: string;
  topic: string;
  savedAt: string;
  items: ClaudePick[];
}

const isHttps = (x: unknown): x is string => isStr(x) && x.startsWith("https://");

/** Claude chose these after reading web pages: only https links and pictures get onto a card. */
function parsePick(x: unknown): ClaudePick | null {
  if (!isObj(x) || !PLATFORM_SET.has(x.platform as string) || !isHttps(x.url) || !isStr(x.title))
    return null;
  return {
    url: x.url,
    platform: x.platform as DiscoverPlatform,
    title: x.title,
    label: x.label === "tutorial" ? "tutorial" : "example",
    savedAt: isStr(x.savedAt) ? x.savedAt : "",
    ...(isStr(x.handle) ? { handle: x.handle } : {}),
    ...(isHttps(x.thumb) ? { thumb: x.thumb } : {}),
    ...(isStr(x.note) ? { note: x.note } : {}),
  };
}

/** The Worker's `{ picks }`, newest topic first; a broken pick is dropped, and a topic left without any. */
export function parsePicks(raw: unknown): PicksTopic[] {
  if (!isObj(raw) || !Array.isArray(raw.picks)) return [];
  return raw.picks.flatMap((t) => {
    if (!isObj(t) || !isStr(t.topicKey) || !isStr(t.topic) || !Array.isArray(t.items)) return [];
    const items = t.items.map(parsePick).filter((p): p is ClaudePick => !!p);
    return items.length
      ? [
          {
            topicKey: t.topicKey,
            topic: t.topic,
            savedAt: isStr(t.savedAt) ? t.savedAt : "",
            items,
          },
        ]
      : [];
  });
}

/** `GET /discover/picks`: a KV read on the Worker, no search credits. */
export async function discoverPicks(
  config: ScoutConfig,
  opts: ScoutSearchOpts = {},
): Promise<{ ok: true; picks: PicksTopic[] } | { ok: false; error: ScoutError }> {
  const r = await scoutCall(config, "/discover/picks", {}, opts);
  return r.ok ? { ok: true, picks: parsePicks(r.data) } : r;
}

/** A topic's picks: the one saved under the answer's `topicKey` (one meaning of a word, not its spelling). */
export function picksFor(picks: readonly PicksTopic[], topicKey: string): PicksTopic | undefined {
  return picks.find((t) => t.topicKey === topicKey);
}
