"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { TrendsState } from "@/lib/domain";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import { trendsStale } from "@/lib/trends";
import {
  fetchTrends,
  runTrends,
  trendsErrorMessageKey,
  type TrendsMessageKey,
} from "@/lib/trendsClient";
import { useStore } from "@/store";

/**
 * 📈 Trend Radar glue (round 30, planning/tools/08-trends.md): the persisted feed comes from the store, the
 * Worker is read through lib/trendsClient. On mount, when the Worker is configured and the feed is older than
 * `trendsStale`'s 6 hours, one `GET /trends` refreshes it; `refresh()` is the 🔄 button (`POST /trends/run`,
 * then `GET /trends` so the store holds the Worker's canonical copy). No polling: the Worker's cron runs the
 * sources, the radar only reads. Activity lives at module level so every mount shares one request in flight.
 */

interface Activity {
  loading: boolean;
  /** Message key of the last failed call in this session, cleared by the next call. */
  error: TrendsMessageKey | null;
}

const IDLE: Activity = { loading: false, error: null };
let activity: Activity = IDLE;
const listeners = new Set<() => void>();

function setActivity(patch: Partial<Activity>): void {
  activity = { ...activity, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getActivity = () => activity;
const getServerActivity = () => IDLE;

let inflight: Promise<boolean> | null = null;

function currentConfig(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/**
 * Read the Worker's feed into the store (`GET /trends`), optionally after a `POST /trends/run`. Concurrent
 * callers share the one request in flight. Resolves true when the store got a new feed. Never throws.
 */
export function pullTrends(run = false): Promise<boolean> {
  if (inflight) return inflight;
  const cfg = currentConfig();
  if (!cfg) {
    setActivity({ loading: false, error: "trends.err.unconfigured" });
    return Promise.resolve(false);
  }
  setActivity({ loading: true, error: null });
  inflight = (async (): Promise<boolean> => {
    if (run) {
      const ran = await runTrends(cfg);
      if (!ran.ok) {
        setActivity({ loading: false, error: trendsErrorMessageKey(ran.error) });
        return false;
      }
    }
    const got = await fetchTrends(cfg);
    if (!got.ok) {
      setActivity({ loading: false, error: trendsErrorMessageKey(got.error) });
      return false;
    }
    useStore.getState().setTrends(got.feed);
    setActivity({ loading: false, error: null });
    return true;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export interface TrendsApi {
  /** The persisted feed plus the dismissed ids (lib/trends' visibleTrends filters it). */
  feed: TrendsState;
  /** The Worker URL and token are set (and the URL is valid). */
  configured: boolean;
  loading: boolean;
  error: TrendsMessageKey | null;
  /** The 🔄 button: run every source now, then read the feed back. */
  refresh(): Promise<boolean>;
}

/** The radar's state for a screen: one stale-check pull on mount, then only what the owner asks for. */
export function useTrends(): TrendsApi {
  const feed = useStore((s) => s.trends);
  const apiKeys = useStore((s) => s.settings.apiKeys);
  const configured = scoutConfig(apiKeys.scoutUrl, apiKeys.scoutToken) !== null;
  const act = useSyncExternalStore(subscribe, getActivity, getServerActivity);

  useEffect(() => {
    if (!configured) return;
    if (trendsStale(useStore.getState().trends.fetchedAt, new Date())) void pullTrends();
  }, [configured]);

  const refresh = useCallback(() => pullTrends(true), []);

  return { feed, configured, loading: act.loading, error: act.error, refresh };
}
