"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/domain";
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

type Settled =
  | { for: string; status: "ok"; results: ScoutResult[] }
  | { for: string; status: "error"; error: ScoutError };

/** The Worker request for a query, or null when there's nothing to ask (no query or no platforms). */
export function scoutParams(
  q: string,
  platforms: readonly ScoutPlatform[] | null,
  lang: Lang,
  timeRange?: ScoutTimeRange,
): ScoutSearchParams | null {
  const query = q.trim();
  if (!query || !platforms || platforms.length === 0) return null;
  // One platform: 10 results of it; several: 5 each (one Tavily credit either way).
  const max = platforms.length === 1 ? 10 : platforms.length * 5;
  return { q: query, platforms, lang, max, timeRange, thumbs: true };
}

/**
 * One Worker search for `params` (null = off). Results are cached per request in `scoutClient` (memory +
 * localStorage) and identical in-flight searches are shared, so re-rendering or switching back to a tab
 * never spends a second credit.
 */
export function useScoutQuery(params: ScoutSearchParams | null): ScoutSearchState {
  const config = useScoutConfig();
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
          ? { for: key, status: "ok", results: r.results }
          : { for: key, status: "error", error: r.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [active, config, key, q, platforms, lang, max, timeRange]);

  if (!active) return { status: "off" };
  if (!settled || settled.for !== key) return { status: "loading" };
  return settled.status === "ok"
    ? { status: "ok", results: settled.results }
    : { status: "error", error: settled.error };
}
