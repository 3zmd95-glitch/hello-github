"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/domain";
import {
  getScoutUsage,
  scoutConfig,
  scoutSearch,
  subscribeScoutUsage,
  type ScoutConfig,
  type ScoutError,
  type ScoutPlatform,
  type ScoutResult,
} from "@/lib/scoutClient";
import { getApiKey, useStore } from "@/store";

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

// Stable arrays so effects don't re-run on every render.
const TT_IG: readonly ScoutPlatform[] = ["tt", "ig"];
const TT_IG_YT: readonly ScoutPlatform[] = ["tt", "ig", "yt"];

export type ScoutSearchState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ok"; results: ScoutResult[] }
  | { status: "error"; error: ScoutError };

type Settled =
  | { for: string; status: "ok"; results: ScoutResult[] }
  | { for: string; status: "error"; error: ScoutError };

/**
 * One Worker search per (query, language). TikTok + Instagram always; YouTube too when there's no YouTube
 * Data API key (the Worker is then the YouTube fallback). The skill sheet / Discover call this from both the
 * TikTok·Instagram section and the YouTube section with the same arguments, so it's one request (shared
 * in flight, then cached) and one credit.
 */
export function useScoutSearch(query: string, lang: Lang, enabled = true): ScoutSearchState {
  const config = useScoutConfig();
  const hasYoutubeKey = !!useStore((s) => getApiKey(s, "youtube"));
  const platforms = hasYoutubeKey ? TT_IG : TT_IG_YT;
  const q = query.trim();
  const active = enabled && !!config && q.length > 0;
  const key = `${platforms.join(",")}|${lang}|${q}`;
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    scoutSearch(config, { q, platforms, lang, max: platforms.length * 5 }).then((r) => {
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
  }, [active, config, q, platforms, lang, key]);

  if (!active) return { status: "off" };
  if (!settled || settled.for !== key) return { status: "loading" };
  return settled.status === "ok"
    ? { status: "ok", results: settled.results }
    : { status: "error", error: settled.error };
}
