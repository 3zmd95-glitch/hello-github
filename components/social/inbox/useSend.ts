"use client";

import { create } from "zustand";
import {
  bindIntent,
  cancelSend,
  confirmSend,
  prepareSend,
  sendDigest,
  sendStatus,
  type SendErrorCode,
  type SendExpect,
  type SendIntent,
  type SendResult,
  type SendState,
} from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import { inboxDraftBase, useStore, type InboxDraft, type InboxSendOp } from "@/store";
import { selectedChannel, useProviderInbox } from "./useProviderInbox";

/**
 * 📤 Reviewed YouTube public replies, client side (packet DT-6B-2A, planning/tools/37-inbox-send.md). One operation per
 * draft scope: Prepare (the handle is persisted BEFORE the request, so a reload asks about the same operation instead
 * of making another), Review (the Worker's canonical intent), Send (the handle says "dispatching" BEFORE the confirm
 * request), then sent / rejected / unknown. Check status reads the same operation back; nothing here ever resends.
 *
 * Views live in memory (never persisted, never exported). DT-6B-2A-R1:
 * - Every action captures its connection ONCE (Worker URL + token, the scope's action session, the YouTube channel +
 *   generation) and sends only through that capture; after every await it checks the capture against the live
 *   settings and channel again, and a move means zero requests and a "closed" view (2A-1).
 * - Only the newest action of a scope may change its view: an older answer is dropped, never written over a newer view.
 *   A moved connection closes the view (2A-2).
 * - An answer is trusted only about the operation asked for (bindIntent, 2A-4); the stored handle only moves forward
 *   (the store's receipt-version rules, 2A-2); a canonical operation is shown only once its handle is durable (2A-6);
 *   an unconfirmed cancel keeps the handle (2A-5).
 * DT-6B-2A-R2:
 * - The provider and its visit are part of the capture: leaving YouTube (or picking another channel), even and back
 *   again, ends every pending action before its request (2A-R1-A). An answer already on its way is still recorded.
 * - A Worker answer is shown only when it became the durable handle; an answer the store refused (another tab recorded
 *   newer proof or replaced the operation) shows "superseded" with Check status for the stored operation (2A-R1-B).
 * - Confirm, and Status / Cancel from a known review, also bind the reviewed parent, video and thread (2A-R1-C).
 */

export type SendPhase =
  | "idle"
  | "preparing"
  | "review"
  | "sending"
  | "sent"
  | "rejected"
  | "unknown"
  | "expired"
  | "cancelled"
  | "error"
  | "closed";

export interface SendView {
  phase: SendPhase;
  intent: SendIntent | null;
  error:
    | SendErrorCode
    | "notPersisted"
    | "conflictLocal"
    | "capacity"
    | "cancelFailed"
    | "clearFailed"
    | "superseded"
    | "unrecorded"
    | null;
  detail?: string;
}

/** What a draft box knows about where its reply would go. */
export interface SendTarget {
  sendRef: string;
  account: string;
  generation: string;
}

const IDLE: SendView = { phase: "idle", intent: null, error: null };
const CLOSED: SendView = { ...IDLE, phase: "closed" };

export const useSendViews = create<{ views: Record<string, SendView> }>()(() => ({ views: {} }));

let epoch = 0;
const sessions: Record<string, number> = {};

/** Clears every review view; an answer still on its way lands as "closed" (tests; a connection change does this). */
export function resetSendViews(): void {
  epoch += 1;
  useSendViews.setState({ views: {} }, true);
}

useStore.subscribe((s, prev) => {
  const k = s.settings.apiKeys;
  const was = prev.settings.apiKeys;
  if (k.scoutUrl !== was.scoutUrl || k.scoutToken !== was.scoutToken) resetSendViews();
});

/** The provider visit as the send layer sees it (2A-R1-A): every provider or channel move is a new one. */
let visit = 0;
useProviderInbox.subscribe((s, prev) => {
  if (s.provider !== prev.provider || s.channelId !== prev.channelId) visit += 1;
});

function config(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/** The persisted handle of a scope, if any. */
export const sendOp = (scope: string): InboxSendOp | undefined =>
  useStore.getState().inboxSendOps[scope];

/** A handle whose operation may still be (or have been) sent: no new operation starts on this scope. */
export const isLiveOp = (op: InboxSendOp | undefined): boolean =>
  !!op && ["preparing", "prepared", "dispatching", "unknown"].includes(op.state);

const PHASE: Record<SendState, SendPhase> = {
  prepared: "review",
  dispatching: "unknown",
  sent: "sent",
  rejected: "rejected",
  unknown: "unknown",
  expired: "expired",
  cancelled: "cancelled",
};

interface Fence {
  epoch: number;
  session: number;
  provider: string;
  visit: number;
  account: string;
  generation: string;
  /** The connection every request of this action goes to; never re-read. */
  cfg: ScoutConfig | null;
}

function capture(scope: string, account: string, generation: string): Fence {
  sessions[scope] = (sessions[scope] ?? 0) + 1;
  const provider = useProviderInbox.getState().provider;
  return { epoch, session: sessions[scope], provider, visit, account, generation, cfg: config() };
}

/** The connection, provider visit and channel the action captured are still the live ones. */
function connected(f: Fence): boolean {
  const c = config();
  const ch = selectedChannel();
  return (
    f.epoch === epoch &&
    f.visit === visit &&
    f.provider === useProviderInbox.getState().provider &&
    c?.url === f.cfg?.url &&
    c?.token === f.cfg?.token &&
    ch?.accountId === f.account &&
    ch.generation === f.generation
  );
}

const latest = (scope: string, f: Fence): boolean => f.session === sessions[scope];
const current = (scope: string, f: Fence): boolean => latest(scope, f) && connected(f);

/** An older action's answer is dropped; the newest one's after a connection move is "closed". */
function show(scope: string, f: Fence | null, view: SendView): void {
  if (f && !latest(scope, f)) return;
  const next = f && !connected(f) ? CLOSED : view;
  useSendViews.setState((s) => ({ views: { ...s.views, [scope]: next } }));
}

type Handle = Omit<InboxSendOp, "updatedAt" | "commitId">;
type Identity = Pick<Handle, "operationId" | "account" | "draftRevision" | "digest">;

/** A local step (no new Worker answer): the store keeps the handle's receipt version. */
const stepOf = (i: Identity, state: Handle["state"]): Handle => ({
  operationId: i.operationId,
  account: i.account,
  draftRevision: i.draftRevision,
  digest: i.digest,
  state,
});

/** A Worker answer: its `updatedAt` is the receipt version, so an older answer never replaces it. */
function handleOf(i: SendIntent): Handle {
  const v = Date.parse(i.updatedAt);
  return { ...stepOf(i, i.state), ...(Number.isFinite(v) && v >= 0 ? { receiptVersion: v } : {}) };
}

const record = (scope: string, i: SendIntent, expected: string) =>
  useStore.getState().setInboxSendOp(scope, handleOf(i), expected);

/** What a handle proves about its operation (Status/Cancel know no text or generation). */
const expectOf = (h: Identity): SendExpect => ({
  operationId: h.operationId,
  account: h.account,
  draftRevision: h.draftRevision,
  digest: h.digest,
});

/** A reviewed intent also proves its immutable target (2A-R1-C). */
const expectOfIntent = (i: SendIntent): SendExpect => ({
  ...expectOf(i),
  generation: i.generation,
  text: i.text,
  parentCommentId: i.parentCommentId,
  videoId: i.videoId,
  threadId: i.threadId,
});

/** Status / Cancel: the review this tab saw of the same operation binds more; a bare handle binds only itself. */
function expectFor(scope: string, op: InboxSendOp): SendExpect {
  const known = useSendViews.getState().views[scope]?.intent;
  return known?.operationId === op.operationId ? expectOfIntent(known) : expectOf(op);
}

const localError = (reason: string): SendView["error"] =>
  reason === "conflict" ? "conflictLocal" : reason === "capacity" ? "capacity" : "notPersisted";

/**
 * 2A-R1-B: a refused durable write means this tab's answer is not the truth any more. The view follows the stored
 * handle instead: "superseded" (another tab won) or "unrecorded" (this browser could not save), with Check status for
 * the operation that is actually stored; with no handle left, the view closes.
 */
function reconcile(scope: string, f: Fence, reason: string): void {
  if (!sendOp(scope)) return show(scope, f, CLOSED);
  const error = reason === "stale" || reason === "conflict" ? "superseded" : "unrecorded";
  show(scope, f, { ...IDLE, phase: "error", error });
}

/** Records a Worker answer and shows it only when it became the durable handle. */
async function settle(scope: string, f: Fence, i: SendIntent, expected: string): Promise<void> {
  const w = await record(scope, i, expected);
  if (w.ok && sendOp(scope)?.operationId === i.operationId) return show(scope, f, intentView(i));
  reconcile(scope, f, w.ok ? "conflict" : w.reason);
}

const errorView = (r: Extract<SendResult, { ok: false }>): SendView => ({
  ...IDLE,
  phase: "error",
  error: r.error,
  ...(r.detail ? { detail: r.detail } : {}),
});

const intentView = (i: SendIntent): SendView => ({ ...IDLE, phase: PHASE[i.state], intent: i });

/** Prepare: persist the handle, then ask the Worker to validate the target and store the immutable intent. */
export async function prepareReply(
  scope: string,
  target: SendTarget,
  text: string,
  draftRevision: string,
): Promise<void> {
  const existing = sendOp(scope);
  if (isLiveOp(existing)) return checkReply(scope, target);
  const f = capture(scope, target.account, target.generation);
  show(scope, null, { ...IDLE, phase: "preparing" });
  const operationId = newOperationId();
  const digest = sendDigest(text);
  const store = useStore.getState();
  const w = await store.setInboxSendOp(
    scope,
    { operationId, account: target.account, draftRevision, digest, state: "preparing" },
    existing?.operationId ?? null,
  );
  if (!w.ok) return show(scope, f, { ...IDLE, phase: "error", error: localError(w.reason) });
  if (!current(scope, f)) {
    // 2A-1: the action or its connection moved while the handle was written: no request at all.
    await store.clearInboxSendOp(scope, operationId);
    return show(scope, f, CLOSED);
  }
  const r = bindIntent(
    await prepareSend(f.cfg, { operationId, sendRef: target.sendRef, text, draftRevision }),
    {
      account: target.account,
      generation: target.generation,
      draftRevision,
      digest,
      text: text.trim(),
    },
  );
  if (!r.ok && r.error === "mismatch")
    // 2A-4: an answer about something else is not trusted; the handle stays for Check status.
    return show(scope, f, { ...IDLE, phase: "unknown", error: "mismatch" });
  if (!r.ok) {
    // Nothing can be sent without a confirm, so a failed prepare simply lets go of its handle.
    await store.clearInboxSendOp(scope, operationId);
    return show(scope, f, errorView(r));
  }
  // Another tab may have prepared the same saved draft first: the Worker answers that operation and the handle follows.
  // 2A-6: its review opens only once that handle is durable here; otherwise the original handle stays.
  const w2 = await record(scope, r.intent, operationId);
  if (!w2.ok) return show(scope, f, { ...IDLE, phase: "error", error: localError(w2.reason) });
  show(scope, f, intentView(r.intent));
}

/** Send: the handle says "dispatching" before the one confirm request. Never repeated by itself. */
export async function confirmReply(scope: string, target: SendTarget): Promise<void> {
  const view = useSendViews.getState().views[scope];
  const intent = view?.intent;
  if (!intent || view.phase !== "review" || intent.state !== "prepared") return;
  const f = capture(scope, target.account, target.generation);
  if (!connected(f) || intent.account !== target.account || intent.generation !== target.generation)
    return show(scope, f, CLOSED);
  show(scope, null, { ...view, phase: "sending" });
  const store = useStore.getState();
  const w = await store.setInboxSendOp(scope, stepOf(intent, "dispatching"), intent.operationId);
  if (!w.ok) return show(scope, f, { ...view, phase: "review", error: localError(w.reason) });
  if (!current(scope, f)) {
    // 2A-1: no POST after a move; the mark goes back to prepared, since nothing was sent.
    await store.setInboxSendOp(scope, stepOf(intent, "prepared"), intent.operationId);
    return show(scope, f, CLOSED);
  }
  const r = bindIntent(
    await confirmSend(f.cfg, {
      operationId: intent.operationId,
      digest: intent.digest,
      account: intent.account,
    }),
    expectOfIntent(intent),
  );
  if (r.ok) return settle(scope, f, r.intent, intent.operationId);
  if (["network", "upstream", "auth", "mismatch"].includes(r.error))
    // The request may have reached YouTube (or the answer named something else): unknown until Check status.
    return show(scope, f, { ...IDLE, phase: "unknown", intent, error: r.error });
  // Every other code is refused before the claim: nothing was sent and the review still stands, unless another tab
  // recorded newer proof meanwhile: then Send never reopens over it (2A-R1-B).
  const back = await store.setInboxSendOp(scope, stepOf(intent, "prepared"), intent.operationId);
  if (!back.ok) return reconcile(scope, f, back.reason);
  show(scope, f, { ...view, phase: "review", error: r.error });
}

/**
 * Check status: reads the same operation back (after a reload, a lost answer or an uncertain send). It needs only the
 * stored handle (2A-7): no saved draft and no earlier answer.
 */
export async function checkReply(scope: string, target: SendTarget): Promise<void> {
  const op = sendOp(scope);
  const f = capture(scope, target.account, target.generation);
  if (!op) return show(scope, f, IDLE);
  const prev = useSendViews.getState().views[scope];
  if (!prev || ["idle", "closed", "error"].includes(prev.phase))
    show(scope, null, { ...IDLE, phase: "preparing" });
  if (!connected(f)) return show(scope, f, CLOSED);
  const r = bindIntent(await sendStatus(f.cfg, op.operationId, op.account), expectFor(scope, op));
  if (r.ok) return settle(scope, f, r.intent, op.operationId);
  // Another tab replaced the operation while this one was looked up: show what is stored now.
  if (sendOp(scope)?.operationId !== op.operationId) return reconcile(scope, f, "conflict");
  if (r.error === "not_found" && op.state === "preparing") {
    // The prepare never reached the coordinator: nothing exists to send.
    await useStore.getState().clearInboxSendOp(scope, op.operationId);
    return show(scope, f, IDLE);
  }
  if (op.state === "dispatching" || op.state === "unknown" || r.error === "mismatch")
    return show(scope, f, {
      ...IDLE,
      phase: "unknown",
      intent: prev?.intent?.operationId === op.operationId ? prev.intent : null,
      error: r.error,
    });
  show(scope, f, errorView(r));
}

/**
 * Cancel a review: the Worker ends the prepared intent (no provider call). The handle goes only once a cancelled or
 * expired answer for this operation proves it (2A-5); otherwise it stays, because another tab may have sent it.
 */
export async function cancelReply(scope: string): Promise<void> {
  const op = sendOp(scope);
  const view = useSendViews.getState().views[scope];
  const ch = selectedChannel();
  const f = capture(scope, ch?.accountId ?? "", ch?.generation ?? "");
  const done = view?.phase === "review" ? { ...IDLE, phase: "cancelled" as const } : IDLE;
  if (!op || (op.state !== "prepared" && op.state !== "preparing")) return show(scope, f, done);
  const store = useStore.getState();
  const r = bindIntent(await cancelSend(f.cfg, op.operationId, op.account), expectFor(scope, op));
  if (r.ok && (r.intent.state === "cancelled" || r.intent.state === "expired")) {
    await store.clearInboxSendOp(scope, op.operationId);
    return show(scope, f, done);
  }
  if (r.ok) return settle(scope, f, r.intent, op.operationId);
  if (r.error === "not_found" && op.state === "preparing") {
    await store.clearInboxSendOp(scope, op.operationId);
    return show(scope, f, done);
  }
  show(scope, f, { ...IDLE, phase: "error", error: "cancelFailed" });
}

/**
 * Close a settled operation (sent, rejected, expired, cancelled). `clearDraft` discards the draft only when it is still
 * the revision that was sent; a newer edit or another draft is never touched. Returns the discarded draft (null when
 * none was), or "failed" when the discard did not land: then nothing is closed (2A-9).
 */
export async function finishReply(
  scope: string,
  clearDraft = false,
): Promise<InboxDraft | null | "failed"> {
  const op = sendOp(scope);
  if (isLiveOp(op)) return null;
  const store = useStore.getState();
  let cleared: InboxDraft | null = null;
  if (clearDraft && op?.state === "sent") {
    const draft = store.inboxDrafts[scope];
    if (draft && draft.commitId === op.draftRevision) {
      if (!(await store.discardInboxDraft(scope, inboxDraftBase(draft))).ok) {
        const view = useSendViews.getState().views[scope];
        if (view) show(scope, null, { ...view, error: "clearFailed" });
        return "failed";
      }
      cleared = draft;
    }
  }
  if (op) await store.clearInboxSendOp(scope, op.operationId);
  sessions[scope] = (sessions[scope] ?? 0) + 1;
  show(scope, null, IDLE);
  return cleared;
}

/** A fresh operation id the Worker accepts ([A-Za-z0-9_-]{8,64}). */
export function newOperationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
