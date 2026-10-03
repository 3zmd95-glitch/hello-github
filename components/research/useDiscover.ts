"use client";

import { useEffect, useState } from "react";
import {
  discoverRequestKey,
  discoverSearch,
  discoverUsage,
  type DiscoverAnswer,
  type DiscoverRequest,
  type DiscoverUsage,
} from "@/lib/discover";
import { scoutHealth, type ScoutConfig, type ScoutError } from "@/lib/scoutClient";
import { LOADING, OFF, settledFor, useScoutConfig, type Tagged } from "./useScout";

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
 * One Discover v2 search (null = off). A new `attempt` asks again after an error; `force` skips the cache, and
 * the answer it replaces does not stand meanwhile (the search shows as running).
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
  return settled && settledFor(settled, key, attempt) && (!force || settled.attempt === attempt)
    ? settled
    : LOADING;
}

/** `GET /discover/usage`, asked again whenever `refresh` changes (after each answered search). */
export function useDiscoverUsage(
  config: ScoutConfig | null,
  refresh: number,
): DiscoverUsage | null {
  const [usage, setUsage] = useState<DiscoverUsage | null>(null);
  useEffect(() => {
    if (!config) return;
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
