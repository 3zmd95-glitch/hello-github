"use client";

import { create } from "zustand";
import {
  bindDmControl,
  dmControlKey,
  instagramDmControlReadiness,
  requestDmControlRegister,
  requestDmControlResume,
  requestDmControlStatus,
  requestDmControlTakeover,
  type DmControlConflict,
  type DmControlDetail,
  type DmControlErrorCode,
  type DmControlMode,
  type DmControlReadiness,
  type DmControlResult,
  type DmControlView,
} from "@/lib/inboxInstagramDmControl";
import { workerOrigin } from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import { useStore, type InboxInstagramDmControl } from "@/store";
import { useInbox } from "./useInbox";
import { useProviderInbox } from "./useProviderInbox";

/**
 * 🛟 Verified-handle takeover/resume of one Instagram conversation, client side (packet DT-6B-2C-5B,
 * planning/tools/37-inbox-send.md). Its own views, slice (`inboxInstagramDmControls`, keyed `origin|account|conversation`)
 * and fences; nothing is shared with the DM send client: no action here sends a message, and Send never calls these.
 *
 * - A NEW registration asks `instagramDmControlReadiness()`, closed in production ("unavailable", nothing stored or
 *   asked). Only tests inject `{ readiness }`. Status, takeover and resume of an existing verified handle ask no
 *   readiness, account read, row or provider: the matching configured Worker's bearer, the stored account and handle.
 *   A handle of another Worker (or with none configured) is never asked.
 * - Takeover/resume need an explicit review of the stored mode, revision and counts; the requested mode and the reviewed
 *   revision are persisted BEFORE the request (a failed write means no request); the answer applies only when its exact
 *   record is what storage holds after the commit. After a Status or a conflict, another change needs a new review.
 * - Every action captures once the connection (URL + token + epoch), the visit (provider, account, conversation, tab) and
 *   its own session, and re-checks them after every await and right before the request. A validated answer is still
 *   recorded after a move (it is proof about the Worker), but shown as "closed".
 * - A lost, malformed or mismatched mutation keeps its pending action as `uncertain`: Check status only, never repeated.
 *   A validated Status proves the current mode and revision, never who changed it. It lets go of a pending action only
 *   when it observed that exact action when it started AND proves it can no longer apply (a newer revision, or the
 *   expected revision already in the requested mode); otherwise the pending action stays (DT-6B-2C-5B-R1). A narrow
 *   conflict proves the change was not applied; it is shown only as what storage committed (newer stored proof wins,
 *   a failed save is said) and records mode and revision without counts. `not_found` is
 *   "unavailable, possibly retired": neither automatic mode nor a resolution. A lost registration keeps its honest
 *   uncertainty without a handle; only a new explicit registration may converge on it. Late answers never move the
 *   revision back or drop another action's pending work.
 */

export type DmControlAction = "takeover" | "resume";

export type DmControlPhase =
  | "idle"
  | "busy"
  /** A validated full view from Status or registration. */
  | "status"
  | "review"
  | "confirming"
  /** A validated takeover/resume answer (`changed` says whether the mode moved). */
  | "done"
  | "conflict"
  /** A request may have reached the Worker without a usable answer: Check status only. */
  | "uncertain"
  /** `not_found`: the handle is unavailable on the Worker (possibly retired). */
  | "unavailable"
  | "error"
  | "closed";

export interface DmControlUiView {
  phase: DmControlPhase;
  /** The last validated full view of this action (the only source of in-flight rows). */
  view?: DmControlView;
  conflict?: DmControlConflict;
  review?: { action: DmControlAction; expectedRevision: number; mode: DmControlMode };
  changed?: boolean;
  /** A Status settled an earlier pending action (without saying who changed the mode). */
  resolved?: boolean;
  /** The commit id of the durable record `view` was recorded as: its rows count only while storage still holds it. */
  commit?: string;
  error?:
    | DmControlErrorCode
    | "unavailable"
    | "notPersisted"
    | "conflictLocal"
    | "capacity"
    | "superseded"
    | "unrecorded"
    | "unresolved"
    | "checkFirst"
    | "foreign"
    | null;
  detail?: DmControlDetail;
}

/** Test-only injection of the registration readiness (production never passes it). */
export interface DmControlDeps {
  readiness?: () => DmControlReadiness;
}

/** The conversation a registration is for, and the recipient the owner already selected (checked, never assumed). */
export interface DmControlTarget {
  account: string;
  conversationId: string;
  recipientId?: string;
}

type Entry = InboxInstagramDmControl;
type Draft = Omit<Entry, "updatedAt" | "commitId">;
type Pending = NonNullable<Entry["pending"]>;

const IDLE: DmControlUiView = { phase: "idle" };
const CLOSED: DmControlUiView = { phase: "closed" };

export const useInstagramDmControlViews = create<{ views: Record<string, DmControlUiView> }>()(
  () => ({ views: {} }),
);

let epoch = 0;
let visit = 0;
const sessions: Record<string, number> = {};

/** Clears every view; an answer still on its way lands as "closed" (tests; a connection change does this). */
export function resetInstagramDmControlViews(): void {
  epoch += 1;
  useInstagramDmControlViews.setState({ views: {} }, true);
}

useStore.subscribe((s, prev) => {
  const k = s.settings.apiKeys;
  const was = prev.settings.apiKeys;
  if (k.scoutUrl !== was.scoutUrl || k.scoutToken !== was.scoutToken)
    resetInstagramDmControlViews();
});
useProviderInbox.subscribe((s, prev) => {
  if (s.provider !== prev.provider) visit += 1;
});
useInbox.subscribe((s, prev) => {
  if (
    s.account?.accountId !== prev.account?.accountId ||
    s.account?.generation !== prev.account?.generation ||
    s.conversationId !== prev.conversationId ||
    s.tab !== prev.tab
  )
    visit += 1;
});

function config(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/** The stored control of a conversation, if any. */
export const instagramDmControl = (key: string): Entry | undefined =>
  useStore.getState().inboxInstagramDmControls[key];

/** The control key of a conversation on the configured Worker (null without one). */
export function instagramDmControlKey(account: string, conversationId: string): string | null {
  const origin = workerOrigin(config());
  return origin ? dmControlKey(origin, account, conversationId) : null;
}

interface Fence {
  epoch: number;
  visit: number;
  session: number;
  cfg: ScoutConfig | null;
  origin: string | null;
}

function capture(key: string): Fence {
  sessions[key] = (sessions[key] ?? 0) + 1;
  const cfg = config();
  return { epoch, visit, session: sessions[key], cfg, origin: workerOrigin(cfg) };
}

/** The connection and the visit the action captured are still the live ones. */
function connected(f: Fence): boolean {
  const c = config();
  return (
    f.epoch === epoch &&
    f.visit === visit &&
    !!c &&
    c.url === f.cfg?.url &&
    c.token === f.cfg?.token
  );
}
const latest = (key: string, f: Fence) => f.session === sessions[key];
const current = (key: string, f: Fence) => latest(key, f) && connected(f);
/** Requests about a handle go only to its own Worker, with that Worker's token. */
const ownWorker = (e: Entry, f: Fence) => !!f.origin && e.workerOrigin === f.origin;

/** An older action's answer is dropped; the newest one's after a move is "closed". */
function show(key: string, f: Fence | null, v: DmControlUiView): void {
  if (f && !latest(key, f)) return;
  const next = f && !connected(f) ? CLOSED : v;
  useInstagramDmControlViews.setState((s) => ({ views: { ...s.views, [key]: next } }));
}

/** A copy of `o` without `keys`. */
const omit = <T extends object>(o: T, keys: readonly string[]): T =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T;
const draftOf = (e: Entry): Draft => omit(e, ["updatedAt", "commitId"]);
const withoutCounts = (d: Draft): Draft =>
  omit(d, ["inFlightTotal", "inFlightTruncated", "uncertainTotal"]);
const withoutPending = (d: Draft): Draft => omit(d, ["pending", "uncertain"]);

/** Writes `next` over the record this action read; true only when exactly that record is durable after the commit. */
async function write(key: string, next: Draft | null, expected: string | null) {
  const w = await useStore.getState().setInboxInstagramDmControl(key, next, expected);
  const applied = w.ok && (next ? w.current?.commitId === w.entry?.commitId : !w.current);
  return { w, applied };
}

const localError = (reason: string): DmControlUiView["error"] =>
  reason === "conflict" || reason === "stale"
    ? "conflictLocal"
    : reason === "capacity"
      ? "capacity"
      : "notPersisted";

const errorView = (r: Extract<DmControlResult, { ok: false }>, phase: DmControlPhase) => ({
  phase,
  error: r.error,
  ...(r.detail ? { detail: r.detail } : {}),
});

/** One pending action is exactly another (its whole persisted record is its identity). */
const samePending = (a: Pending | undefined, b: Pending | undefined): boolean =>
  !!a &&
  !!b &&
  a.action === b.action &&
  a.at === b.at &&
  a.expectedRevision === b.expectedRevision &&
  a.requestedMode === b.requestedMode;

/**
 * Whether `v` settles the stored pending action `p` (DT-6B-2C-5B-R1): only the exact action this answer belongs to
 * (`seen`: the one a Status observed when it started, or the action's own), and only on proof: its own answer, or a
 * Status showing a newer revision than the expected one (it can no longer apply) or the expected revision already in the
 * requested mode. A Status at the expected revision in the other mode cannot prove the request will never land.
 */
function settles(p: Pending, v: DmControlView, source: "status" | "answer", seen?: Pending) {
  if (!samePending(p, seen)) return false;
  if (source === "answer" || p.action === "register") return true;
  const expected = p.expectedRevision ?? Infinity;
  const { revision, mode } = v.conversation;
  return revision > expected || (revision === expected && mode === p.requestedMode);
}

/**
 * Records a validated full view over what storage holds now (never the revision backwards, never another handle or
 * recipient); `seen` is the pending action this answer belongs to (see `settles`). `commit` is the durable record's.
 */
async function record(
  key: string,
  origin: string,
  v: DmControlView,
  source: "status" | "answer",
  seen?: Pending,
): Promise<{
  out: "ok" | "regressive" | "mismatch" | "failed";
  resolved: boolean;
  commit?: string;
}> {
  const cur = instagramDmControl(key);
  const c = v.control;
  const conv = v.conversation;
  if (
    (cur?.handleId && cur.handleId !== c.handleId) ||
    (cur?.recipientId && cur.recipientId !== c.recipientId)
  )
    return { out: "mismatch", resolved: false };
  if (cur?.revision !== undefined && conv.revision < cur.revision)
    return { out: "regressive", resolved: false };
  if (cur?.revision === conv.revision && cur.mode !== conv.mode)
    return { out: "mismatch", resolved: false };
  const keep = cur?.pending && !settles(cur.pending, v, source, seen) ? cur : undefined;
  const next: Draft = {
    workerOrigin: cur?.workerOrigin ?? origin,
    account: c.account,
    conversationId: c.conversationId,
    handleId: c.handleId,
    recipientId: c.recipientId,
    registeredGeneration: c.registeredGeneration,
    evidenceDigest: c.evidenceDigest,
    mode: conv.mode,
    revision: conv.revision,
    inFlightTotal: v.inFlightTotal,
    inFlightTruncated: v.inFlightTruncated,
    uncertainTotal: v.uncertainTotal,
    ...(keep
      ? { pending: keep.pending, ...(keep.uncertain ? { uncertain: keep.uncertain } : {}) }
      : {}),
  };
  const { w, applied } = await write(key, next, cur?.commitId ?? null);
  const resolved = source === "status" && !!cur?.pending && !keep;
  return applied && w.ok
    ? { out: "ok", resolved, commit: w.current?.commitId }
    : { out: "failed", resolved: false };
}

/** Lets this action's own pending action go (it made no request, or the Worker refused it conclusively). */
async function letGo(key: string, mine: Pending): Promise<boolean> {
  const cur = instagramDmControl(key);
  if (!cur || !samePending(cur.pending, mine)) return false;
  const next = cur.handleId ? withoutPending(draftOf(cur)) : null;
  return (await write(key, next, cur.commitId)).applied;
}

/** Marks this action's own pending action as possibly received (Check status only). */
async function markUncertain(key: string, mine: Pending): Promise<void> {
  const cur = instagramDmControl(key);
  if (!cur || !samePending(cur.pending, mine)) return;
  const uncertain = mine.action === "register" ? "registration" : "mutation";
  await write(key, { ...draftOf(cur), uncertain }, cur.commitId);
}

/** Persists `pending` over the record read; returns the durable mark, or shows why nothing is asked. */
async function persistPending(
  key: string,
  f: Fence,
  base: Draft,
  pending: Pending,
  expected: string | null,
): Promise<Entry | null> {
  const { w, applied } = await write(key, { ...base, pending }, expected);
  if (!w.ok) {
    show(key, f, { phase: "error", error: localError(w.reason) });
    return null;
  }
  if (!applied || w.current?.pending?.at !== pending.at) {
    show(key, f, { phase: "error", error: "superseded" });
    return null;
  }
  return w.current;
}

const UNAVAILABLE: DmControlUiView = {
  phase: "error",
  error: "unavailable",
  detail: "permission_unverified",
};

/** Refusals the Worker gives before the coordinator registers anything: the registration did not happen. */
const REGISTER_REFUSED: readonly string[] = [
  "auth",
  "not_configured",
  "not_connected",
  "no_permission",
  "token_expired",
  "stale",
  "account_mismatch",
  "bad_request",
  "target_unverified",
  "target_invalid",
  "conflict",
  "capacity",
  "rate_limited",
];

/**
 * Register: an explicit, gated request for the Worker to prove the conversation and mint (or converge on) its handle.
 * The handle and the recipient come only from the validated answer; it never changes the mode.
 */
export async function registerInstagramDmControl(
  key: string,
  t: DmControlTarget,
  deps: DmControlDeps = {},
): Promise<void> {
  const ready = () => (deps.readiness ?? instagramDmControlReadiness)().ok;
  if (!ready()) return show(key, null, UNAVAILABLE);
  const f = capture(key);
  if (!f.origin || key !== dmControlKey(f.origin, t.account, t.conversationId) || !connected(f))
    return show(key, f, CLOSED);
  const e = instagramDmControl(key);
  if (e?.pending && e.pending.action !== "register")
    return show(key, f, { phase: "error", error: "unresolved" });
  show(key, null, { phase: "busy" });
  const pending: Pending = { action: "register", at: new Date().toISOString() };
  const base: Draft = e
    ? withoutPending(draftOf(e))
    : { workerOrigin: f.origin, account: t.account, conversationId: t.conversationId };
  const mark = await persistPending(key, f, base, pending, e?.commitId ?? null);
  if (!mark) return;
  if (!current(key, f) || !ready()) {
    await letGo(key, pending);
    return show(key, f, CLOSED);
  }
  const r = bindDmControl(
    await requestDmControlRegister(f.cfg, { account: t.account, conversationId: t.conversationId }),
    {
      account: t.account,
      conversationId: t.conversationId,
      recipientId: t.recipientId ?? e?.recipientId,
      handleId: e?.handleId,
    },
  );
  if (r.ok) {
    const { out, commit } = await record(key, f.origin, r.view, "answer", pending);
    if (out === "ok") return show(key, f, { phase: "status", view: r.view, commit });
    if (out === "failed") return show(key, f, { phase: "uncertain", error: "unrecorded" });
    await markUncertain(key, pending);
    return show(key, f, {
      phase: "uncertain",
      error: out === "mismatch" ? "mismatch" : "superseded",
    });
  }
  if (REGISTER_REFUSED.includes(r.error)) {
    await letGo(key, pending);
    return show(key, f, errorView(r, "error"));
  }
  await markUncertain(key, pending);
  show(key, f, errorView(r, "uncertain"));
}

/** Check status: reads the handle back from its own Worker (bearer + stored account + handle only). */
export async function checkInstagramDmControl(key: string): Promise<void> {
  const e = instagramDmControl(key);
  const f = capture(key);
  if (!e?.handleId) return show(key, f, IDLE);
  if (!ownWorker(e, f)) return show(key, f, { phase: "error", error: "foreign" });
  if (!connected(f)) return show(key, f, CLOSED);
  show(key, null, { phase: "busy" });
  const r = bindDmControl(await requestDmControlStatus(f.cfg, e.handleId, e.account), {
    account: e.account,
    conversationId: e.conversationId,
    recipientId: e.recipientId,
    handleId: e.handleId,
  });
  if (r.ok) {
    // The pending action this read observed when it started: the only one it may settle.
    const { out, resolved, commit } = await record(
      key,
      e.workerOrigin,
      r.view,
      "status",
      e.pending,
    );
    if (out === "ok") return show(key, f, { phase: "status", view: r.view, resolved, commit });
    return show(key, f, {
      phase: "error",
      error: out === "regressive" ? "superseded" : out === "mismatch" ? "mismatch" : "unrecorded",
    });
  }
  if (r.error === "not_found") return show(key, f, { phase: "unavailable", error: "not_found" });
  show(key, f, errorView(r, instagramDmControl(key)?.pending ? "uncertain" : "error"));
}

/**
 * Opens the explicit review of one change over the stored mode, revision and counts. Needs a verified handle of the
 * configured Worker, known counts (a conflict drops them: Check status first) and no unresolved action.
 */
export async function openInstagramDmControlReview(
  key: string,
  action: DmControlAction,
): Promise<void> {
  const e = instagramDmControl(key);
  const f = capture(key);
  if (!e?.handleId || e.revision === undefined)
    return show(key, f, { phase: "error", error: "checkFirst" });
  if (!ownWorker(e, f)) return show(key, f, { phase: "error", error: "foreign" });
  if (e.pending || e.uncertain) return show(key, f, { phase: "error", error: "unresolved" });
  if (e.inFlightTotal === undefined) return show(key, f, { phase: "error", error: "checkFirst" });
  // Rows and counts of a view count only while storage still holds the exact record it was recorded as: counts change
  // without a revision change, so another tab's newer check means the stored totals, rows not loaded (DT-6B-2C-5B-R1).
  const prev = useInstagramDmControlViews.getState().views[key];
  const fresh = prev?.view && prev.commit === e.commitId ? prev : undefined;
  show(key, f, {
    phase: "review",
    review: {
      action,
      expectedRevision: e.revision,
      mode: action === "takeover" ? "human" : "auto",
    },
    ...(fresh ? { view: fresh.view, commit: fresh.commit } : {}),
  });
}

/** Refusals of a takeover/resume given before any change could happen. */
const MUTATION_REFUSED: readonly string[] = ["auth", "not_configured", "bad_request", "not_found"];

/** Confirm: the one explicit takeover/resume of the open review. Never repeated by itself. */
export async function confirmInstagramDmControl(key: string): Promise<void> {
  const v = useInstagramDmControlViews.getState().views[key];
  const review = v?.phase === "review" ? v.review : undefined;
  if (!review) return;
  const e = instagramDmControl(key);
  const f = capture(key);
  if (!e?.handleId || e.revision !== review.expectedRevision || e.pending || e.uncertain)
    return show(key, f, { phase: "error", error: "superseded" });
  if (!ownWorker(e, f) || !connected(f)) return show(key, f, CLOSED);
  show(key, null, { ...v, phase: "confirming" });
  const pending: Pending = {
    action: review.action,
    expectedRevision: review.expectedRevision,
    requestedMode: review.mode,
    at: new Date().toISOString(),
  };
  const mark = await persistPending(key, f, draftOf(e), pending, e.commitId);
  if (!mark) return;
  // Checked right before the request: no await between here and the fetch.
  if (!current(key, f)) {
    await letGo(key, pending);
    return show(key, f, CLOSED);
  }
  const send = review.action === "takeover" ? requestDmControlTakeover : requestDmControlResume;
  const r = bindDmControl(
    await send(f.cfg, e.handleId, {
      account: e.account,
      expectedRevision: review.expectedRevision,
    }),
    {
      account: e.account,
      conversationId: e.conversationId,
      recipientId: e.recipientId,
      handleId: e.handleId,
    },
  );
  if (r.ok) {
    const { out, commit } = await record(key, e.workerOrigin, r.view, "answer", pending);
    if (out === "ok")
      return show(key, f, { phase: "done", view: r.view, changed: r.view.changed, commit });
    if (out === "regressive") {
      // Newer proof is already stored: this answer is older; the pending action it answers is settled by it.
      await letGo(key, pending);
      return show(key, f, { phase: "error", error: "superseded" });
    }
    if (out === "mismatch") await markUncertain(key, pending);
    return show(key, f, {
      phase: "uncertain",
      error: out === "mismatch" ? "mismatch" : "unrecorded",
    });
  }
  if (r.error === "conflict" && r.conflict) {
    // Shown only as what storage committed: newer stored proof wins; a failed save is said (pending stays, Check status).
    const { ok, current } = await recordConflict(key, r.conflict, pending);
    const c = r.conflict.conversation;
    if (ok && current?.mode === c.mode && current.revision === c.revision)
      return show(key, f, { phase: "conflict", conflict: r.conflict });
    return show(key, f, {
      phase: "error",
      error: !ok
        ? "unrecorded"
        : current?.revision !== undefined && current.revision > c.revision
          ? "superseded"
          : "mismatch",
    });
  }
  if (MUTATION_REFUSED.includes(r.error)) {
    await letGo(key, pending);
    return show(key, f, errorView(r, r.error === "not_found" ? "unavailable" : "error"));
  }
  await markUncertain(key, pending);
  show(key, f, errorView(r, "uncertain"));
}

/**
 * A bound narrow conflict: the change was not applied. Its mode and revision are recorded when newer (the counts are
 * dropped, never manufactured); this action's own pending action is let go (and no other one). `ok`: the result is
 * durable (or nothing needed writing); `current`: what storage holds after it, which is what the sheet may show.
 */
async function recordConflict(
  key: string,
  c: DmControlConflict,
  mine: Pending,
): Promise<{ ok: boolean; current: Entry | null }> {
  const cur = instagramDmControl(key);
  if (!cur?.handleId || cur.handleId !== c.control.handleId) return { ok: false, current: null };
  const conv = c.conversation;
  const newer = cur.revision === undefined || conv.revision > cur.revision;
  const mineOpen = samePending(cur.pending, mine);
  if (!newer && !mineOpen) return { ok: true, current: cur };
  let next = draftOf(cur);
  if (newer) next = { ...withoutCounts(next), mode: conv.mode, revision: conv.revision };
  if (mineOpen) next = withoutPending(next);
  const { w, applied } = await write(key, next, cur.commitId);
  return applied && w.ok
    ? { ok: true, current: w.current ?? null }
    : { ok: false, current: instagramDmControl(key) ?? null };
}
