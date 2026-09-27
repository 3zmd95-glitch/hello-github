"use client";

import { useEffect, useSyncExternalStore } from "react";
import { withBasePath } from "@/lib/basePath";
import type { SocialStatusMap } from "@/lib/domain";
import type { MessageKey } from "@/lib/i18n";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import {
  applySocialData,
  pullIsDue,
  sinceFor,
  socialConnectUrl,
  socialData,
  socialDisconnect,
  socialStatus,
  socialSyncErrorMessageKey,
  socialSyncNow,
  type SocialPlatform,
  type SocialSyncError,
  type SocialSyncOutcome,
} from "@/lib/socialSync";
import { useStore } from "@/store";

/**
 * Live account sync glue between the Scout Worker (`lib/socialSync`) and the store. The activity (busy flag,
 * last error) lives at module level so the Settings card, the analytics header and the shell share one pull
 * at a time, and `pullIfDue` throttles automatic pulls to once an hour through the persisted `lastPullAt`.
 */

interface Activity {
  busy: boolean;
  /** Message key of the last failed action in this session, cleared by the next action. */
  error: MessageKey | null;
}

const IDLE: Activity = { busy: false, error: null };
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

export type ActionResult = { ok: true } | { ok: false; error: MessageKey };
export type SyncResult = ({ ok: true } & SocialSyncOutcome) | { ok: false; error: MessageKey };

let inflight: Promise<ActionResult> | null = null;
let lastAttemptAt = 0;
/** After a failed automatic pull, wait this long before trying again on the next route change. */
export const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

function currentConfig(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

const keyOf = (error: SocialSyncError): MessageKey => socialSyncErrorMessageKey(error);

function fail(error: MessageKey, remember = true): { ok: false; error: MessageKey } {
  if (remember) useStore.getState().setSocialPullResult({ at: null, error });
  setActivity({ busy: false, error });
  return { ok: false, error };
}

/**
 * `GET /social/status` then `GET /social/data?since=…`, written into the store. Concurrent callers share the
 * one request in flight. Never throws.
 */
export function pullSocial(): Promise<ActionResult> {
  if (inflight) return inflight;
  const cfg = currentConfig();
  if (!cfg) return Promise.resolve(fail("settings.accounts.err.unconfigured", false));
  lastAttemptAt = Date.now();
  setActivity({ busy: true, error: null });
  inflight = (async (): Promise<ActionResult> => {
    const status = await socialStatus(cfg);
    if (!status.ok) return fail(keyOf(status.error));
    const store = useStore.getState();
    store.setSocialSyncStatus(status.platforms);
    const data = await socialData(cfg, sinceFor(store.socialSync.lastPullAt));
    if (!data.ok) return fail(keyOf(data.error));
    try {
      applySocialData(useStore.getState(), data.data);
    } catch {
      // A row the store's schema refuses: the Worker sent something we do not understand.
      return fail("settings.accounts.err.badRequest");
    }
    useStore.getState().setSocialPullResult({ at: new Date().toISOString(), error: null });
    setActivity({ busy: false, error: null });
    return { ok: true };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Pull when the Worker is configured, nothing is in flight, the last pull is an hour old and no recent failure. */
export function pullIfDue(now: number = Date.now()): void {
  if (inflight || !currentConfig()) return;
  if (!pullIsDue(useStore.getState().socialSync.lastPullAt, now)) return;
  if (now - lastAttemptAt < RETRY_AFTER_FAILURE_MS) return;
  void pullSocial();
}

/** `POST /social/sync` (all connected platforms), then a pull. */
export async function syncSocialNow(platforms?: readonly SocialPlatform[]): Promise<SyncResult> {
  const cfg = currentConfig();
  if (!cfg) return fail("settings.accounts.err.unconfigured", false);
  setActivity({ busy: true, error: null });
  // The Worker has a per-request call budget, so each platform gets its own sync call for full depth.
  const connected = platforms ?? connectedPlatforms();
  const synced: SocialPlatform[] = [];
  const errors: Record<string, string> = {};
  if (connected.length === 0) {
    const r = await socialSyncNow(cfg);
    if (!r.ok) return fail(keyOf(r.error), false);
    synced.push(...(r.synced as SocialPlatform[]));
    Object.assign(errors, r.errors);
  }
  for (const platform of connected) {
    const r = await socialSyncNow(cfg, [platform]);
    if (!r.ok) return fail(keyOf(r.error), false);
    synced.push(...(r.synced as SocialPlatform[]));
    Object.assign(errors, r.errors);
  }
  const pulled = await pullSocial();
  if (!pulled.ok) return { ok: false, error: pulled.error };
  return { ok: true, synced, errors };
}

/** Platforms the last status pull reported as connected (empty when unknown). */
function connectedPlatforms(): SocialPlatform[] {
  const status = useStore.getState().socialSync.status;
  if (!status) return [];
  return (Object.keys(status) as SocialPlatform[]).filter((p) => status[p]?.connected);
}

/** The page the Worker sends the owner back to after OAuth (Settings, where the accounts card lives). */
export function connectReturnTo(): string {
  return `${window.location.origin}${withBasePath("/settings/")}`;
}

/** Ask the Worker for the OAuth URL and go there; the Worker redirects back to Settings when done. */
export async function connectSocial(platform: SocialPlatform): Promise<ActionResult> {
  const cfg = currentConfig();
  if (!cfg) return fail("settings.accounts.err.unconfigured", false);
  setActivity({ busy: true, error: null });
  const r = await socialConnectUrl(cfg, platform, connectReturnTo());
  if (!r.ok) return fail(keyOf(r.error), false);
  // Busy stays on: the page is leaving.
  window.location.assign(r.url);
  return { ok: true };
}

/** `DELETE /social/connect/:platform`, then refresh the status (the stored numbers stay). */
export async function disconnectSocial(platform: SocialPlatform): Promise<ActionResult> {
  const cfg = currentConfig();
  if (!cfg) return fail("settings.accounts.err.unconfigured", false);
  setActivity({ busy: true, error: null });
  const r = await socialDisconnect(cfg, platform);
  if (!r.ok) return fail(keyOf(r.error), false);
  return pullSocial();
}

export interface SocialSyncApi {
  /** The Worker URL and token are set (and the URL is valid). */
  configured: boolean;
  status: SocialStatusMap | null;
  lastPullAt: string | null;
  busy: boolean;
  /** This session's last failure, or the persisted last pull error. */
  error: MessageKey | null;
  connect(platform: SocialPlatform): Promise<ActionResult>;
  disconnect(platform: SocialPlatform): Promise<ActionResult>;
  syncNow(): Promise<SyncResult>;
  pull(): Promise<ActionResult>;
}

/**
 * Connected-accounts state for a screen. With `auto`, an hourly pull runs when the screen mounts (or the
 * Worker gets configured while it is open).
 */
export function useSocialSync({ auto = false }: { auto?: boolean } = {}): SocialSyncApi {
  const apiKeys = useStore((s) => s.settings.apiKeys);
  const sync = useStore((s) => s.socialSync);
  const configured = scoutConfig(apiKeys.scoutUrl, apiKeys.scoutToken) !== null;
  const act = useSyncExternalStore(subscribe, getActivity, getServerActivity);

  useEffect(() => {
    if (auto && configured) pullIfDue();
  }, [auto, configured]);

  return {
    configured,
    status: sync.status,
    lastPullAt: sync.lastPullAt,
    busy: act.busy,
    error: act.error ?? (sync.lastPullError as MessageKey | null),
    connect: connectSocial,
    disconnect: disconnectSocial,
    syncNow: syncSocialNow,
    pull: pullSocial,
  };
}
