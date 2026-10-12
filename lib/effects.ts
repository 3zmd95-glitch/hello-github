import { hasArabic } from "./research";
import { scoutCall, type ScoutConfig } from "./scoutClient";
import { EDIT_FORMAT_VERSION, parseEditFormats, type EditFormat } from "./editFormats";

/**
 * Trending effects in Discover (planning/tools/18-trending-effects.md §4): the Worker's daily list of editing effects
 * (`GET /effects/trending`, a KV read, no credits), kept 1 h per Worker in this tab's sessionStorage, and the first
 * scan (`POST /effects/run`). An effect MIRRORS the fields the row uses of `EffectItem` in
 * workers/scout/src/effects/types.ts (hand-copied): change both together.
 */

export interface TrendingEffect {
  key: string;
  name: { en: string; ar?: string };
  what?: { en: string; ar?: string };
  termId?: string;
  isNew: boolean;
  creators: number;
  growth: number;
  youtube?: { newVideos: number; views7d: number; growth?: number };
  samples?: { url: string; title: string; published: string }[];
}

export interface TrendingEffects {
  formatVersion?: number;
  formats?: EditFormat[];
  /** v1 counts only identified platform accounts. Older cached numbers are not trustworthy. */
  evidenceVersion?: number;
  status: "ok" | "partial" | "failed" | "never";
  updatedAt?: string;
  /** Why a run went as it did; "attempts": the Worker's tries for the day are spent (the scan button rests). */
  notes?: string[];
  items: TrendingEffect[];
}

const STATUSES = new Set(["ok", "partial", "failed", "never"]);
/** The Worker shows its top 12 (MAX_ITEMS in the Worker's types.ts). */
const MAX_ITEMS = 12;
const CACHE_TTL_MS = 60 * 60 * 1000;
/** A list older than this is not "this week" any more: the row hides. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "3z-effects-v3|";
export const EFFECTS_EVIDENCE_VERSION = 1;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** `{ en, ar? }` with English text, else undefined; the Arabic only in Arabic script (English first, live fix 1: a
 * transliteration such as "taswir mash' al" is no Arabic). Category lessons read their texts with it too. */
export function textOf(x: unknown): { en: string; ar?: string } | undefined {
  if (!isObj(x) || !isStr(x.en) || !x.en.trim()) return undefined;
  return { en: x.en.trim(), ...(isStr(x.ar) && hasArabic(x.ar) ? { ar: x.ar.trim() } : {}) };
}

function sampleOf(x: unknown): NonNullable<TrendingEffect["samples"]>[number] | null {
  if (
    !isObj(x) ||
    !isStr(x.url) ||
    !isStr(x.title) ||
    !isStr(x.published) ||
    !Number.isFinite(Date.parse(x.published))
  )
    return null;
  try {
    const u = new URL(x.url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const post =
      (host === "instagram.com" &&
        /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/[\w-]+\/?$/.test(u.pathname)) ||
      (host === "tiktok.com" && /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(u.pathname)) ||
      (host === "youtube.com" &&
        ((u.pathname === "/watch" && !!u.searchParams.get("v")) ||
          /^\/shorts\/[\w-]+\/?$/.test(u.pathname))) ||
      (host === "youtu.be" && /^\/[\w-]+\/?$/.test(u.pathname));
    return u.protocol === "https:" && !u.username && !u.password && post
      ? {
          url: u.href,
          title: x.title.slice(0, 160),
          published: new Date(x.published).toISOString(),
        }
      : null;
  } catch {
    return null;
  }
}

function parseEffect(x: unknown, trusted: boolean): TrendingEffect | null {
  if (!isObj(x) || !isStr(x.key) || !isNum(x.creators) || !isNum(x.growth)) return null;
  // No English name, no chip: a tap searches it.
  const name = textOf(x.name);
  if (!name) return null;
  const what = textOf(x.what);
  const yt = x.youtube;
  const youtube =
    isObj(yt) && isNum(yt.newVideos) && isNum(yt.views7d)
      ? {
          newVideos: yt.newVideos,
          views7d: yt.views7d,
          ...(isNum(yt.growth) ? { growth: yt.growth } : {}),
        }
      : undefined;
  return {
    key: x.key,
    name,
    ...(what ? { what } : {}),
    ...(isStr(x.termId) ? { termId: x.termId } : {}),
    isNew: x.isNew === true,
    creators: x.creators,
    growth: x.growth,
    ...(youtube ? { youtube } : {}),
    ...(trusted && Array.isArray(x.samples)
      ? {
          samples: x.samples
            .map(sampleOf)
            .filter((s): s is NonNullable<typeof s> => !!s)
            .slice(0, 2),
        }
      : {}),
  };
}

/**
 * The Worker's answer checked field by field: a broken effect is dropped (and a broken `what` or `youtube` from an
 * effect), at most 12 are kept; null without a known status or an item list. Legacy ideas have no trusted evidence.
 */
export function parseTrendingEffects(raw: unknown): TrendingEffects | null {
  if (!isObj(raw) || !STATUSES.has(raw.status as string) || !Array.isArray(raw.items)) return null;
  return {
    ...(raw.formatVersion === EDIT_FORMAT_VERSION
      ? { formatVersion: EDIT_FORMAT_VERSION, formats: parseEditFormats(raw.formats) }
      : {}),
    ...(raw.evidenceVersion === EFFECTS_EVIDENCE_VERSION
      ? { evidenceVersion: EFFECTS_EVIDENCE_VERSION }
      : {}),
    status: raw.status as TrendingEffects["status"],
    ...(isStr(raw.updatedAt) ? { updatedAt: raw.updatedAt } : {}),
    ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter(isStr) } : {}),
    items: raw.items
      .map((x) => parseEffect(x, raw.evidenceVersion === EFFECTS_EVIDENCE_VERSION))
      .filter((e): e is TrendingEffect => !!e)
      .slice(0, MAX_ITEMS),
  };
}

/** This tab's copy kept under `key` while under an hour old, checked by `parse`; null otherwise or with storage
 * blocked. Shared with lib/categories. */
export function readTabCache<T>(
  key: string,
  now: number,
  parse: (raw: unknown) => T | null,
): T | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(key) ?? "null") as unknown;
    return isObj(kept) && isNum(kept.at) && now - kept.at < CACHE_TTL_MS ? parse(kept.data) : null;
  } catch {
    return null;
  }
}

/** Keeps `data` under `key` in this tab (shared with lib/categories); blocked or full storage keeps nothing. */
export function writeTabCache(key: string, data: unknown, now: number): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: now, data }));
  } catch {
    // Blocked or full: asked again on the next visit.
  }
}

/** This tab's copy of the list when it is under an hour old, read at once (no request); null otherwise. */
export function cachedTrendingEffects(
  config: ScoutConfig,
  now = Date.now(),
): TrendingEffects | null {
  return readTabCache(CACHE_PREFIX + config.url, now, parseTrendingEffects);
}

/**
 * The list, from this tab's copy when it is under an hour old; null hides the row (an older Worker's 404, a refused
 * token, no network, a broken answer). Only a list is kept: not null, not "never" or a failed first run (the next
 * run can land any minute), not an empty run.
 */
export async function fetchTrendingEffects(
  config: ScoutConfig,
  opts: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<TrendingEffects | null> {
  const now = opts.now ?? Date.now();
  const kept = cachedTrendingEffects(config, now);
  if (kept) return kept;
  const r = await scoutCall(config, "/effects/trending", {}, { fetchImpl: opts.fetchImpl });
  const data = r.ok ? parseTrendingEffects(r.data) : null;
  if (data && (data.items.length || data.formats?.length))
    writeTabCache(CACHE_PREFIX + config.url, data, now);
  return data;
}

const running = new Map<string, Promise<TrendingEffects | null>>();

/**
 * Runs the Worker's scan now (about 30–60 s). The first scan: at most once a day, as the Worker answers the day's list
 * after that, unless the day's run failed. `force` (Scan again) runs it anyway, past the once-a-day guard and the 3
 * tries a day, spending its credits again. One request per Worker at a time, since the Worker's once-a-day check has
 * no lock: a second tap, or a tap after leaving Discover and coming back, waits for the same answer. A list is kept
 * like a fetched one, so it is not lost when the row has gone; null when the request failed (the Worker's own failed
 * run answers `failed` with no list, and the button stays). Past its 3 tries a UTC day the Worker spends nothing and
 * answers its stored list noted "attempts".
 */
export async function runTrendingEffectsNow(
  config: ScoutConfig,
  opts: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<TrendingEffects | null> {
  const pending = running.get(config.url);
  if (pending) return pending;
  const run = (async () => {
    const init: RequestInit = opts.force
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        }
      : { method: "POST" };
    const r = await scoutCall(config, "/effects/run", init, { fetchImpl: opts.fetchImpl });
    const data = r.ok ? parseTrendingEffects(r.data) : null;
    if (data && (data.items.length || data.formats?.length))
      writeTabCache(CACHE_PREFIX + config.url, data, Date.now());
    return data;
  })();
  running.set(config.url, run);
  try {
    return await run;
  } finally {
    running.delete(config.url);
  }
}

/** The scan this tab is running on that Worker, if any: Discover, opened again meanwhile, waits for it. */
export function scanInFlight(config: ScoutConfig): Promise<TrendingEffects | null> | undefined {
  return running.get(config.url);
}

/**
 * What a chip searches: the effect's English name. For a dictionary effect (`termId`) the Worker sends the
 * dictionary's own English label there, so Discover reads the same entry.
 */
export function effectQuery(e: TrendingEffect): string {
  return e.name.en;
}

/** Which state the row is in at `now`. */
export function rowVisible(
  t: TrendingEffects | null,
  now: number,
): "hidden" | "never" | "list" | "stale-failed" {
  if (!t) return "hidden";
  // Never run, or every run so far failed (no list yet; a failed run keeps its first failure's time, so before the
  // age check): the first-scan button.
  if (t.status === "never" || (t.status === "failed" && !t.items.length)) return "never";
  // Older than 3 days, or no date to tell: not shown as this week's.
  if (!(now - Date.parse(t.updatedAt ?? "") <= MAX_AGE_MS)) return "hidden";
  if (t.status === "failed") return "stale-failed";
  // A run that found nothing has nothing to show.
  return t.items.length ? "list" : "hidden";
}
