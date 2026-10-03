"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AutoRepliesDoc, AutoReply } from "@/lib/domain";
import type { MessageKey } from "@/lib/i18n";
import {
  repliesDelete,
  repliesList,
  repliesPoll,
  repliesSave,
  repliesSettings,
  type PollOutcome,
  type RepliesSettings,
} from "@/lib/replies";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import { socialSyncErrorMessageKey } from "@/lib/socialSync";
import { useStore } from "@/store";

/**
 * The auto-replies document as the Worker holds it (`GET /social/replies`), kept at module level like the
 * account sync's activity so the screen and the Settings card share one copy. Nothing is persisted here: the
 * Worker's KV document is the source of truth and is re-read whenever the screen mounts.
 */

export interface RepliesState {
  doc: AutoRepliesDoc | null;
  busy: boolean;
  /** Message key of the last failed call in this session, cleared by the next call. */
  error: MessageKey | null;
  loadedAt: number | null;
}

const IDLE: RepliesState = { doc: null, busy: false, error: null, loadedAt: null };
let state: RepliesState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<RepliesState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getState = () => state;
const getServerState = () => IDLE;

function currentConfig(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

function fail(error: { type: Parameters<typeof socialSyncErrorMessageKey>[0]["type"] }): false {
  set({ busy: false, error: socialSyncErrorMessageKey(error) });
  return false;
}

let inflight: Promise<boolean> | null = null;

/** `GET /social/replies`; concurrent callers share the request. */
export function loadReplies(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    const cfg = currentConfig();
    if (!cfg) return fail({ type: "unconfigured" });
    set({ busy: true, error: null });
    const r = await repliesList(cfg);
    if (!r.ok) return fail(r.error);
    set({ doc: r.doc, busy: false, loadedAt: Date.now() });
    return true;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Adds or replaces one automation; the document is patched from the Worker's answer. */
export async function saveReply(automation: AutoReply): Promise<boolean> {
  const cfg = currentConfig();
  if (!cfg) return fail({ type: "unconfigured" });
  set({ busy: true, error: null });
  const r = await repliesSave(cfg, automation);
  if (!r.ok) return fail(r.error);
  const doc = state.doc ?? { automations: [], log: [], paused: false };
  const rest = doc.automations.filter((a) => a.id !== r.automation.id);
  set({ doc: { ...doc, automations: [r.automation, ...rest] }, busy: false });
  return true;
}

export async function deleteReply(id: string): Promise<boolean> {
  const cfg = currentConfig();
  if (!cfg) return fail({ type: "unconfigured" });
  set({ busy: true, error: null });
  const r = await repliesDelete(cfg, id);
  if (!r.ok) return fail(r.error);
  const doc = state.doc ?? { automations: [], log: [], paused: false };
  set({ doc: { ...doc, automations: doc.automations.filter((a) => a.id !== id) }, busy: false });
  return true;
}

/** Pause all, or the default reply; the document comes back fresh from the Worker. */
export async function saveSettings(settings: RepliesSettings): Promise<boolean> {
  const cfg = currentConfig();
  if (!cfg) return fail({ type: "unconfigured" });
  set({ busy: true, error: null });
  const r = await repliesSettings(cfg, settings);
  if (!r.ok) return fail(r.error);
  set({ doc: r.doc, busy: false, loadedAt: Date.now() });
  return true;
}

/** "Check now": the Worker reads the comments at once and answers with the fresh document. */
export async function checkReplies(): Promise<PollOutcome | null> {
  const cfg = currentConfig();
  if (!cfg) {
    fail({ type: "unconfigured" });
    return null;
  }
  set({ busy: true, error: null });
  const r = await repliesPoll(cfg);
  if (!r.ok) {
    fail(r.error);
    return null;
  }
  set({ doc: r.doc, busy: false, loadedAt: Date.now() });
  return r.outcome;
}

/** The document for a screen; loads it once the Worker is configured. */
export function useReplies(): RepliesState & { configured: boolean } {
  const apiKeys = useStore((s) => s.settings.apiKeys);
  const configured = scoutConfig(apiKeys.scoutUrl, apiKeys.scoutToken) !== null;
  const s = useSyncExternalStore(subscribe, getState, getServerState);

  useEffect(() => {
    if (configured) void loadReplies();
  }, [configured]);

  return { ...s, configured };
}
