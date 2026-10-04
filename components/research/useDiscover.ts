"use client";

import { useEffect, useState } from "react";
import {
  discoverPicks,
  discoverRequestKey,
  discoverSearch,
  discoverUsage,
  type DiscoverAnswer,
  type DiscoverRequest,
  type DiscoverUsage,
  type PicksTopic,
} from "@/lib/discover";
import { scoutHealth, type ScoutConfig, type ScoutError } from "@/lib/scoutClient";
import { LOADING, OFF, useScoutConfig, type Tagged } from "./useScout";

/**
 * Whether the configured Worker serves Discover v2 (`/health` → `discover: true`), asked once per Worker URL and
 * session (memory + sessionStorage); null while unknown. An older Worker means false: the panel then keeps the
 * per-platform `/search` path. A failed check is not remembered (asked again next time).
 */
const capsMemory = new Map<string, boolean>();
const CAPS_KEY = "3z-scout-caps";

function readCaps(url: string): boolean | undefined {
  if (capsMemory.has(url)) return capsMemory.get(url);
  try {
    const all = JSON.parse(sessionStorage.getItem(CAPS_KEY) ?? "{}") as Record<string, unknown>;
    const v = all[url];
    if (typeof v !== "boolean") return undefined;
    // Read once: the panel renders on every keystroke.
    capsMemory.set(url, v);
    return v;
  } catch {
    return undefined;
  }
}

function writeCaps(url: string, discover: boolean): void {
  capsMemory.set(url, discover);
  try {
    const all = JSON.parse(sessionStorage.getItem(CAPS_KEY) ?? "{}") as Record<string, unknown>;
    sessionStorage.setItem(CAPS_KEY, JSON.stringify({ ...all, [url]: discover }));
  } catch {
    // memory only
  }
}

/** Forget what every Worker said it serves (memory and this session's storage). Also used by tests. */
export function clearScoutCaps(): void {
  capsMemory.clear();
  try {
    sessionStorage.removeItem(CAPS_KEY);
  } catch {
    // ignore
  }
}

export function useScoutCaps(config: ScoutConfig | null): { discover: boolean } | null {
  const url = config?.url ?? "";
  const [checked, setChecked] = useState<{ url: string; discover: boolean } | null>(null);
  const known = url ? readCaps(url) : undefined;
  useEffect(() => {
    if (!config || known !== undefined) return;
    let alive = true;
    void scoutHealth(config).then((r) => {
      const discover = r.ok && r.discover;
      if (r.ok) writeCaps(config.url, discover);
      if (alive) setChecked({ url: config.url, discover });
    });
    return () => {
      alive = false;
    };
  }, [config, known]);
  if (!config) return null;
  if (known !== undefined) return { discover: known };
  return checked?.url === url ? { discover: checked.discover } : null;
}

export type DiscoverState =
  | typeof OFF
  | typeof LOADING
  | Tagged<{ status: "ok"; answer: DiscoverAnswer }>
  | Tagged<{ status: "error"; error: ScoutError }>;

type Settled = Exclude<DiscoverState, typeof OFF | typeof LOADING>;

/**
 * Whether a settled answer still stands for request `key` at search attempt `attempt`. The answer to this attempt
 * does. An earlier attempt's does only while the new one is free: a complete answer with posts, which the browser
 * cache serves at no cost (lib/discover `discoverSearch` keeps exactly those), and no `force`. Anything else is a
 * paid search (about 6 Tavily credits), so it shows as one.
 */
function stands(s: Settled, key: string, attempt: number, force: boolean): boolean {
  if (s.key !== key) return false;
  if (s.attempt === attempt) return true;
  return !force && s.status === "ok" && s.answer.complete && s.answer.items.length > 0;
}

/**
 * One Discover v2 search (null = off). A new `attempt` asks again; `force` skips the cache. While a new attempt
 * runs, the answer on screen stays only when the new one costs nothing (see {@link stands}).
 */
export function useDiscoverQuery(
  req: DiscoverRequest | null,
  attempt: number,
  force = false,
): DiscoverState {
  const config = useScoutConfig();
  const key = config && req ? discoverRequestKey(config, req) : "";
  const body = req ? JSON.stringify(req) : "";
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!config || !body) return;
    let alive = true;
    void discoverSearch(config, JSON.parse(body) as DiscoverRequest, { force }).then((r) => {
      if (!alive) return;
      setSettled(
        r.ok
          ? { key, attempt, status: "ok", answer: r.answer }
          : { key, attempt, status: "error", error: r.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [config, body, key, attempt, force]);

  if (!config || !req) return OFF;
  return settled && stands(settled, key, attempt, force) ? settled : LOADING;
}

/**
 * `GET /discover/usage`, asked again whenever `refresh` changes to a number (after each answer lands); null while
 * a search runs keeps the figure shown and asks nothing.
 */
export function useDiscoverUsage(
  config: ScoutConfig | null,
  refresh: number | null,
): DiscoverUsage | null {
  const [usage, setUsage] = useState<DiscoverUsage | null>(null);
  useEffect(() => {
    if (!config || refresh === null) return;
    let alive = true;
    void discoverUsage(config).then((r) => {
      if (alive && r.ok) setUsage(r.usage);
    });
    return () => {
      alive = false;
    };
  }, [config, refresh]);
  return config ? usage : null;
}

/**
 * Claude's picks from the Worker (a KV read, no search credits), asked again whenever `refresh` changes (each
 * search, each Discover visit); null asks nothing. A failed read shows nothing: the last picks stay.
 */
export function useDiscoverPicks(config: ScoutConfig | null, refresh: number): PicksTopic[] {
  const [picks, setPicks] = useState<PicksTopic[]>([]);
  useEffect(() => {
    if (!config) return;
    let alive = true;
    void discoverPicks(config).then((r) => {
      if (alive && r.ok) setPicks(r.picks);
    });
    return () => {
      alive = false;
    };
  }, [config, refresh]);
  return config ? picks : [];
}
