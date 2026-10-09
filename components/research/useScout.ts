"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/domain";
import { dedupeByUrl } from "@/lib/research";
import {
  getScoutUsage,
  scoutCacheKey,
  scoutConfig,
  scoutSearch,
  subscribeScoutUsage,
  type ScoutConfig,
  type ScoutError,
  type ScoutPlatform,
  type ScoutResult,
  type ScoutSearchParams,
  type ScoutTimeRange,
} from "@/lib/scoutClient";
import { useStore } from "@/store";
import { useActiveSnapshot } from "./useActiveSnapshot";

/**
 * The Scout Worker config from Settings, or null. Selects the two strings separately (primitives, so the
 * Zustand snapshot stays stable) and memoizes the object.
 */
export function useScoutConfig(): ScoutConfig | null {
  const url = useStore((s) => s.settings.apiKeys.scoutUrl);
  const token = useStore((s) => s.settings.apiKeys.scoutToken);
  return useMemo(() => scoutConfig(url, token), [url, token]);
}

/** Real Worker searches this month on this device (re-renders when a search spends a credit). */
export function useScoutUsage(): number {
  return useSyncExternalStore(
    subscribeScoutUsage,
    () => getScoutUsage(),
    () => 0,
  );
}

export type ScoutSearchState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ok"; results: ScoutResult[] }
  | { status: "error"; error: ScoutError };

/**
 * A settled answer tagged with the request it answers (`key`) and the search attempt (the panel's
 * "Search" press counter) it came from. The hooks return it as is, so a state object stays the same
 * between renders (stable for `useMemo` dependencies).
 */
export type Tagged<T> = T & { key: string; attempt: number };

type Settled = Tagged<
  { status: "ok"; results: ScoutResult[] } | { status: "error"; error: ScoutError }
>;

/** Shared, stable "off" / "loading" states for the query hooks. */
export const OFF = { status: "off" } as const;
export const LOADING = { status: "loading" } as const;

/**
 * Whether a settled answer still stands for request `key` at search attempt `attempt`. A success does for
 * any attempt (pressing Search again on the same query is served from the cache, no credit spent); an
 * error only for the attempt that got it, so pressing Search after an error shows loading and asks again
 * instead of leaving the old error up.
 */
export function settledFor(
  s: { key: string; attempt: number; status: "ok" | "error" } | null,
  key: string,
  attempt: number,
): boolean {
  return !!s && s.key === key && (s.status === "ok" || s.attempt === attempt);
}

/** The Worker request for a query, or null when there's nothing to ask (no query or no platforms). */
export function scoutParams(
  q: string,
  platforms: readonly ScoutPlatform[] | null,
  lang: Lang,
  timeRange?: ScoutTimeRange,
): ScoutSearchParams | null {
  const query = q.trim();
  if (!query || !platforms || platforms.length === 0) return null;
  // The panel asks for one platform per request: 10 results of it, one Tavily credit. A mixed request is
  // capped as a whole and one platform can crowd out the others, so the All tab is built from the
  // single-platform requests. (The Worker still accepts several platforms; they share 5 each.)
  const max = platforms.length === 1 ? 10 : platforms.length * 5;
  return { q: query, platforms, lang, max, timeRange, thumbs: true };
}

/** One platform's answer for a tab badge: its cards, "error", or undefined while unknown. */
export type PlatformPart<T> = readonly T[] | "error" | undefined;

/**
 * The All tab's badge from the answers of every platform that has a source: the number of distinct posts
 * across them. Undefined while any of them is still unknown (the badge never shows a partial count) or
 * when none has answered; a platform that failed counts as empty.
 */
export function unionCount<T extends { url: string }>(
  parts: readonly PlatformPart<T>[],
): number | undefined {
  if (parts.length === 0 || parts.some((p) => p === undefined)) return undefined;
  const lists = parts.filter((p): p is readonly T[] => Array.isArray(p));
  return lists.length === 0 ? undefined : dedupeByUrl(...lists).length;
}

/**
 * One Worker search for `params` (null = off). Results are cached per request in `scoutClient` (memory +
 * localStorage) and identical in-flight searches are shared, so re-rendering or switching back to a tab
 * never spends a second credit. A new `attempt` (the panel's "Search" press counter) asks again after an
 * error; a cached success still costs nothing.
 */
export function useScoutQuery(
  requested: ScoutSearchParams | null,
  requestedAttempt = 0,
  enabled = true,
): ScoutSearchState {
  const configured = useScoutConfig();
  const selection = useActiveSnapshot(
    { config: configured, params: requested, attempt: requestedAttempt },
    enabled,
  );
  const { config = null, params = null, attempt = 0 } = selection ?? {};
  const key = params ? scoutCacheKey(params) : "";
  const active = !!config && !!params;
  const [settled, setSettled] = useState<Settled | null>(null);
  // Primitive copies for the effect's dependency list (the params object is rebuilt every render).
  const q = params?.q ?? "";
  const platforms = params?.platforms.join(",") ?? "";
  const lang = params?.lang;
  const max = params?.max;
  const timeRange = params?.timeRange;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const list = platforms.split(",") as ScoutPlatform[];
    scoutSearch(config, { q, platforms: list, lang, max, timeRange, thumbs: true }).then((r) => {
      if (!alive) return;
      setSettled(
        r.ok
          ? { key, attempt, status: "ok", results: r.results }
          : { key, attempt, status: "error", error: r.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [active, config, key, attempt, q, platforms, lang, max, timeRange]);

  if (!active) return OFF;
  return settled && settledFor(settled, key, attempt) ? settled : LOADING;
}

/**
 * Per-platform Worker errors grouped by kind (first occurrence order), so the same failure on every
 * platform (a bad token, the monthly limit) is said once, naming the platforms it hit.
 */
export function groupErrors<P extends string>(
  list: readonly { platform: P; error: ScoutError }[],
): { error: ScoutError; platforms: P[] }[] {
  const out: { error: ScoutError; platforms: P[] }[] = [];
  for (const { platform, error } of list) {
    const g = out.find((x) => x.error.type === error.type);
    if (g) g.platforms.push(platform);
    else out.push({ error, platforms: [platform] });
  }
  return out;
}
