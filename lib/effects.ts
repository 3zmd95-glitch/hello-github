import { scoutCall, type ScoutConfig } from "./scoutClient";

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
}

export interface TrendingEffects {
  status: "ok" | "partial" | "failed" | "never";
  updatedAt?: string;
  /** Why a run went as it did; "attempts": the Worker's tries for the day are spent (the scan button rests). */
  notes?: string[];
  items: TrendingEffect[];
}

const STATUSES = new Set(["ok", "partial", "failed", "never"]);
/** The Worker shows its top 8 (MAX_ITEMS in the Worker's types.ts). */
const MAX_ITEMS = 8;
const CACHE_TTL_MS = 60 * 60 * 1000;
/** A list older than this is not "this week" any more: the row hides. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "3z-effects|";

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** `{ en, ar? }` with English text, else undefined. */
function textOf(x: unknown): { en: string; ar?: string } | undefined {
  if (!isObj(x) || !isStr(x.en) || !x.en.trim()) return undefined;
  return { en: x.en.trim(), ...(isStr(x.ar) && x.ar.trim() ? { ar: x.ar.trim() } : {}) };
}

function parseEffect(x: unknown): TrendingEffect | null {
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
  };
}

/**
 * The Worker's answer checked field by field: a broken effect is dropped (and a broken `what` or `youtube` from an
 * effect), at most 8 are kept; null without a known status or an item list.
 */
export function parseTrendingEffects(raw: unknown): TrendingEffects | null {
  if (!isObj(raw) || !STATUSES.has(raw.status as string) || !Array.isArray(raw.items)) return null;
  return {
    status: raw.status as TrendingEffects["status"],
    ...(isStr(raw.updatedAt) ? { updatedAt: raw.updatedAt } : {}),
    ...(Array.isArray(raw.notes) ? { notes: raw.notes.filter(isStr) } : {}),
    items: raw.items
      .map(parseEffect)
      .filter((e): e is TrendingEffect => !!e)
      .slice(0, MAX_ITEMS),
  };
}

function readCache(url: string, now: number): TrendingEffects | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + url) ?? "null") as unknown;
    return isObj(kept) && isNum(kept.at) && now - kept.at < CACHE_TTL_MS
      ? parseTrendingEffects(kept.data)
      : null;
  } catch {
    return null;
  }
}

function writeCache(url: string, data: TrendingEffects, now: number): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ at: now, data }));
  } catch {
    // Blocked or full: asked again on the next visit.
  }
}

/** This tab's copy of the list when it is under an hour old, read at once (no request); null otherwise. */
export function cachedTrendingEffects(
  config: ScoutConfig,
  now = Date.now(),
): TrendingEffects | null {
  return readCache(config.url, now);
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
  if (data?.items.length) writeCache(config.url, data, now);
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
    if (data?.items.length) writeCache(config.url, data, Date.now());
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
