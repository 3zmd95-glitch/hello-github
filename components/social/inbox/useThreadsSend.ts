"use client";

import { create } from "zustand";
import {
  bindThreadsIntent,
  cancelThreadsSend,
  confirmThreadsSend,
  prepareThreadsSend,
  threadsSendDigest,
  threadsSendReadiness,
  threadsSendStatus,
  type ThreadsExpect,
  type ThreadsIntent,
  type ThreadsSendDetail,
  type ThreadsSendErrorCode,
  type ThreadsSendResult,
  type ThreadsSendState,
} from "@/lib/inboxThreadsSend";
import { workerOrigin } from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import {
  INBOX_THREADS_SEND_SETTLED,
  inboxDraftBase,
  useStore,
  type InboxDraft,
  type InboxThreadsSendOp,
} from "@/store";
import { useProviderInbox } from "./useProviderInbox";

/**
 * 📤 Reviewed Threads replies, client side (packet DT-6B-2B-2, planning/tools/37-inbox-send.md). Its own views, handle
 * slice and fences; nothing is shared with the YouTube client (useSend.ts).
 *
 * - Readiness comes from `threadsSendReadiness()` (lib/inboxThreadsSend.ts), which is closed in production: Prepare,
 *   Send and Resume ask nothing and say "unavailable". Check status and Cancel of a retained operation stay reachable.
 * - The handle is persisted BEFORE every request: "preparing" before Prepare, "confirming" before Confirm or Resume
 *   (local uncertainty: the request may have left). A Worker answer is shown only when it became the durable handle of
 *   the same operation; otherwise the view follows the stored handle ("superseded" / "unrecorded" + Check status).
 * - Every action captures the Worker URL + token, the config epoch, the provider and its visit, the Threads account and
 *   generation, and its own session; it re-checks them after every await and right before the request. A move means no
 *   request and a "closed" view; leaving Threads and coming back never revives the abandoned action.
 * - creating, publishing, unknown_creation and unknown_publication are status only. A durable `created` may resume
 *   publication (never a new container), after its review, with readiness, whatever the original review deadline.
 * DT-6B-2B-2-R1: a recorded container or publication id is immutable (parser binding + store refusal); an answer is
 * shown only when the handle stored after its commit is exactly that receipt (operation, version, state); Check status
 * is handle-only recovery: the handle's own account on the handle's own Worker (its recorded origin, else its scope
 * key's), whatever account is on screen, with the connection/visit/latest-action fences; a successful "Clear draft"
 * is announced to every mounted editor of its scope (`onThreadsDraftCleared`).
 */

export type ThreadsSendPhase =
  | "idle"
  | "preparing"
  | "review"
  | "confirming"
  | "creating"
  | "created"
  | "publishing"
  | "published"
  | "rejected"
  | "unknown_creation"
  | "unknown_publication"
  /** Local uncertainty: a request may have reached the Worker; only Check status follows. */
  | "uncertain"
  | "expired"
  | "cancelled"
  | "error"
  | "closed";

export interface ThreadsSendView {
  phase: ThreadsSendPhase;
  intent: ThreadsIntent | null;
  error:
    | ThreadsSendErrorCode
    | "unavailable"
    | "notPersisted"
    | "conflictLocal"
    | "capacity"
    | "cancelFailed"
    | "clearFailed"
    | "superseded"
    | "unrecorded"
    | null;
  detail?: ThreadsSendDetail;
}

/** Where a reviewed reply would go: the row's sealed target, the account and the exact root post and reply. */
export interface ThreadsSendTarget {
  sendRef: string | undefined;
  account: string;
  generation: string;
  rootPostId: string;
  replyToId: string;
}

const IDLE: ThreadsSendView = { phase: "idle", intent: null, error: null };
const CLOSED: ThreadsSendView = { ...IDLE, phase: "closed" };

export const useThreadsSendViews = create<{ views: Record<string, ThreadsSendView> }>()(() => ({
  views: {},
}));

let epoch = 0;
const sessions: Record<string, number> = {};

/** Clears every view; an answer still on its way lands as "closed" (tests; a connection change does this). */
export function resetThreadsSendViews(): void {
  epoch += 1;
  useThreadsSendViews.setState({ views: {} }, true);
}

useStore.subscribe((s, prev) => {
  const k = s.settings.apiKeys;
  const was = prev.settings.apiKeys;
  if (k.scoutUrl !== was.scoutUrl || k.scoutToken !== was.scoutToken) resetThreadsSendViews();
});

/** Every provider move and every Threads account or generation change is a new visit. */
let visit = 0;
useProviderInbox.subscribe((s, prev) => {
  if (
    s.provider !== prev.provider ||
    s.threads?.accountId !== prev.threads?.accountId ||
    s.threads?.generation !== prev.threads?.generation
  )
    visit += 1;
});

function config(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/** The persisted handle of a scope, if any. */
export const threadsOp = (scope: string): InboxThreadsSendOp | undefined =>
  useStore.getState().inboxThreadsSendOps[scope];

/** A handle whose operation may still be (or have been) published: no new operation starts on this scope. */
export const isLiveThreadsOp = (op: InboxThreadsSendOp | undefined): boolean =>
  !!op && !INBOX_THREADS_SEND_SETTLED.includes(op.state);

const PHASE: Record<ThreadsSendState, ThreadsSendPhase> = {
  prepared: "review",
  creating: "creating",
  created: "created",
  publishing: "publishing",
  published: "published",
  rejected: "rejected",
  cancelled: "cancelled",
  expired: "expired",
  unknown_creation: "unknown_creation",
  unknown_publication: "unknown_publication",
};

interface Fence {
  epoch: number;
  session: number;
  visit: number;
  account: string;
  generation: string;
  /** The connection every request of this action goes to; never re-read. */
  cfg: ScoutConfig | null;
  /** That connection's Worker origin (recorded on the handle). */
  origin: string | null;
  /** Status only (DT-6B-2B-2-R1): bound to the handle, not to the account on screen. */
  status: boolean;
}

function capture(scope: string, account: string, generation: string, status = false): Fence {
  sessions[scope] = (sessions[scope] ?? 0) + 1;
  const cfg = config();
  return {
    epoch,
    session: sessions[scope],
    visit,
    account,
    generation,
    cfg,
    origin: workerOrigin(cfg),
    status,
  };
}

/**
 * The connection and the Threads visit the action captured are still the live ones, and (except for status) its account
 * and generation too.
 */
function connected(f: Fence): boolean {
  const c = config();
  const s = useProviderInbox.getState();
  return (
    f.epoch === epoch &&
    f.visit === visit &&
    s.provider === "threads" &&
    !!c &&
    c.url === f.cfg?.url &&
    c.token === f.cfg?.token &&
    (f.status || (s.threads?.accountId === f.account && s.threads.generation === f.generation))
  );
}

/**
 * The Worker an operation lives on (DT-6B-2B-2-R1): its recorded origin, else the origin in its v2 scope key
 * (`v2|threads|origin|account|comment|id`, written before 2B-2-R1). Never the current one by default.
 */
export function threadsOpOrigin(scope: string, op: InboxThreadsSendOp): string {
  if (op.workerOrigin) return op.workerOrigin;
  try {
    return decodeURIComponent(scope.split("|")[2] ?? "");
  } catch {
    return "";
  }
}

/** Requests about an operation go only to its own Worker, with that Worker's token. */
const ownWorker = (scope: string, op: InboxThreadsSendOp, f: Fence): boolean =>
  !!f.origin && threadsOpOrigin(scope, op) === f.origin;

const latest = (scope: string, f: Fence): boolean => f.session === sessions[scope];
const current = (scope: string, f: Fence): boolean => latest(scope, f) && connected(f);
const ready = (): boolean => threadsSendReadiness().ok;

/** An older action's answer is dropped; the newest one's after a move is "closed". */
function show(scope: string, f: Fence | null, view: ThreadsSendView): void {
  if (f && !latest(scope, f)) return;
  const next = f && !connected(f) ? CLOSED : view;
  useThreadsSendViews.setState((s) => ({ views: { ...s.views, [scope]: next } }));
}

type Handle = Omit<InboxThreadsSendOp, "updatedAt" | "commitId">;
type Identity = Pick<Handle, "operationId" | "account" | "draftRevision" | "digest">;

/** A local step: the store keeps the stored receipt's version and ids. */
const stepOf = (i: Identity, state: Handle["state"]): Handle => ({
  operationId: i.operationId,
  account: i.account,
  draftRevision: i.draftRevision,
  digest: i.digest,
  state,
});

/** A Worker receipt: identifiers, state and its integer version only (never the text). */
const handleOf = (i: ThreadsIntent): Handle => ({
  ...stepOf(i, i.state),
  receiptVersion: i.receiptVersion,
  ...(i.containerId ? { containerId: i.containerId } : {}),
  ...(i.publishedId ? { publishedId: i.publishedId } : {}),
});

/** Every write records the Worker the action's requests go to (the store refuses another one for the operation). */
const write = (scope: string, h: Handle, expected: string | null, f: Fence) =>
  useStore
    .getState()
    .setInboxThreadsSendOp(
      scope,
      { ...h, ...(f.origin ? { workerOrigin: f.origin } : {}) },
      expected,
    );

/** The handle stored after the commit is exactly this receipt (another writer may have landed after it). */
const committed = (c: InboxThreadsSendOp | null | undefined, i: ThreadsIntent): boolean =>
  !!c &&
  c.operationId === i.operationId &&
  c.receiptVersion === i.receiptVersion &&
  c.state === i.state;

/** What a bare handle proves (Status/Cancel after a reload know no text or target). */
const expectOf = (h: InboxThreadsSendOp | ThreadsIntent): ThreadsExpect => ({
  operationId: h.operationId,
  account: h.account,
  draftRevision: h.draftRevision,
  digest: h.digest,
  ...(h.containerId ? { containerId: h.containerId } : {}),
  ...(h.publishedId ? { publishedId: h.publishedId } : {}),
});

/** A reviewed intent also proves its generation, root post, reply and text. */
const expectOfIntent = (i: ThreadsIntent): ThreadsExpect => ({
  ...expectOf(i),
  generation: i.generation,
  rootPostId: i.rootPostId,
  replyToId: i.replyToId,
  text: i.text,
});

function expectFor(scope: string, op: InboxThreadsSendOp): ThreadsExpect {
  const known = useThreadsSendViews.getState().views[scope]?.intent;
  return known?.operationId === op.operationId
    ? { ...expectOfIntent(known), ...expectOf(op) }
    : expectOf(op);
}

const localError = (reason: string): ThreadsSendView["error"] =>
  reason === "conflict" ? "conflictLocal" : reason === "capacity" ? "capacity" : "notPersisted";

const errorView = (r: Extract<ThreadsSendResult, { ok: false }>): ThreadsSendView => ({
  ...IDLE,
  phase: "error",
  error: r.error,
  ...(r.detail ? { detail: r.detail } : {}),
});

const intentView = (i: ThreadsIntent): ThreadsSendView => ({
  ...IDLE,
  phase: PHASE[i.state],
  intent: i,
});

const UNAVAILABLE: ThreadsSendView = {
  ...IDLE,
  phase: "error",
  error: "unavailable",
  detail: "permission_unverified",
};

/** A refused durable write: the view follows what is stored now, with Check status for it. */
function reconcile(scope: string, f: Fence, reason: string): void {
  if (!threadsOp(scope)) return show(scope, f, CLOSED);
  const error = reason === "stale" || reason === "conflict" ? "superseded" : "unrecorded";
  show(scope, f, { ...IDLE, phase: "error", error });
}

/** Records a Worker answer; it is shown only when exactly that receipt is the durable handle after the commit. */
async function settle(scope: string, f: Fence, i: ThreadsIntent, expected: string): Promise<void> {
  const w = await write(scope, handleOf(i), expected, f);
  if (w.ok && committed(w.current, i)) return show(scope, f, intentView(i));
  reconcile(scope, f, w.ok ? "conflict" : w.reason);
}

/** Prepare: persist the handle, then ask the Worker to validate the target and store the immutable intent. */
export async function prepareThreadsReply(
  scope: string,
  target: ThreadsSendTarget,
  text: string,
  draftRevision: string,
): Promise<void> {
  const existing = threadsOp(scope);
  if (isLiveThreadsOp(existing)) return checkThreadsReply(scope);
  if (!ready() || !target.sendRef) return show(scope, null, UNAVAILABLE);
  const sendRef = target.sendRef;
  const f = capture(scope, target.account, target.generation);
  if (!connected(f)) return show(scope, f, CLOSED);
  show(scope, null, { ...IDLE, phase: "preparing" });
  const operationId = newThreadsOperationId();
  const digest = threadsSendDigest(text);
  const store = useStore.getState();
  const w = await write(
    scope,
    { operationId, account: target.account, draftRevision, digest, state: "preparing" },
    existing?.operationId ?? null,
    f,
  );
  if (!w.ok) return show(scope, f, { ...IDLE, phase: "error", error: localError(w.reason) });
  if (!current(scope, f) || !ready()) {
    // The action, its connection or readiness moved while the handle was written: no request at all.
    await store.clearInboxThreadsSendOp(scope, operationId);
    return show(scope, f, CLOSED);
  }
  const r = bindThreadsIntent(
    await prepareThreadsSend(f.cfg, { operationId, sendRef, text, draftRevision }),
    {
      account: target.account,
      generation: target.generation,
      rootPostId: target.rootPostId,
      replyToId: target.replyToId,
      draftRevision,
      digest,
      text: text.trim(),
    },
  );
  if (!r.ok && r.error === "mismatch")
    // An answer about something else is not trusted; the handle stays for Check status.
    return show(scope, f, { ...IDLE, phase: "uncertain", error: "mismatch" });
  if (!r.ok) {
    // Nothing can be published without a confirm, so a failed prepare lets go of its handle.
    await store.clearInboxThreadsSendOp(scope, operationId);
    return show(scope, f, errorView(r));
  }
  // Another tab may have prepared the same saved draft first: the handle follows the Worker's canonical operation, and
  // its review opens only once exactly that receipt is the durable handle here (read back after the commit).
  const w2 = await write(scope, handleOf(r.intent), operationId, f);
  if (!w2.ok) return show(scope, f, { ...IDLE, phase: "error", error: localError(w2.reason) });
  if (!committed(w2.current, r.intent)) return reconcile(scope, f, "conflict");
  show(scope, f, intentView(r.intent));
}

/** Local or ambiguous failures of a confirm: the request may have reached the Worker. */
const UNCERTAIN: readonly string[] = [
  "network",
  "upstream",
  "auth",
  "mismatch",
  "receipt_unavailable",
];

/** One explicit confirm from a reviewed `prepared` (create, then publish) or a durable `created` (publish only). */
async function dispatch(
  scope: string,
  target: ThreadsSendTarget,
  from: "prepared" | "created",
): Promise<void> {
  const view = useThreadsSendViews.getState().views[scope];
  const intent = view?.intent;
  const phase = from === "prepared" ? "review" : "created";
  if (!intent || view.phase !== phase || intent.state !== from) return;
  if (!ready()) return show(scope, null, { ...view, error: "unavailable" });
  const f = capture(scope, target.account, target.generation);
  const op = threadsOp(scope);
  if (op?.operationId !== intent.operationId || op.state !== from)
    // The stored handle moved on (another tab): never act on the older view.
    return reconcile(scope, f, "stale");
  if (
    !connected(f) ||
    !ownWorker(scope, op, f) ||
    intent.account !== target.account ||
    intent.generation !== target.generation ||
    intent.replyToId !== target.replyToId ||
    intent.rootPostId !== target.rootPostId
  )
    return show(scope, f, CLOSED);
  show(scope, null, { ...view, phase: "confirming" });
  const w = await write(scope, stepOf(op, "confirming"), op.operationId, f);
  if (!w.ok) return show(scope, f, { ...view, error: localError(w.reason) });
  if (!current(scope, f) || !ready()) {
    // No request after a move; the mark goes back, since nothing was sent.
    await write(scope, stepOf(op, from), op.operationId, f);
    return show(scope, f, CLOSED);
  }
  const r = bindThreadsIntent(
    await confirmThreadsSend(f.cfg, {
      operationId: intent.operationId,
      digest: intent.digest,
      account: intent.account,
    }),
    expectOfIntent(intent),
  );
  if (r.ok) return settle(scope, f, r.intent, intent.operationId);
  if (UNCERTAIN.includes(r.error))
    return show(scope, f, { ...IDLE, phase: "uncertain", intent, error: r.error });
  // Every other code is refused before any claim: nothing was created or published, and the review still stands,
  // unless another tab recorded newer proof meanwhile.
  const back = await write(scope, stepOf(op, from), op.operationId, f);
  if (!back.ok) return reconcile(scope, f, back.reason);
  show(scope, f, {
    ...view,
    phase,
    error: r.error,
    ...(r.detail ? { detail: r.detail } : {}),
  });
}

/** Send: the one confirm of a reviewed `prepared` operation. Never repeated by itself. */
export const confirmThreadsReply = (scope: string, target: ThreadsSendTarget) =>
  dispatch(scope, target, "prepared");

/** Resume publication of a durable `created` operation (its container exists): publish only, never recreate. */
export const resumeThreadsPublish = (scope: string, target: ThreadsSendTarget) =>
  dispatch(scope, target, "created");

/** The view of a stored handle whose lookup failed: local marks are uncertain, durable stages stay as they were. */
function lastKnown(op: InboxThreadsSendOp): ThreadsSendPhase {
  if (op.state === "preparing" || op.state === "confirming") return "uncertain";
  return ["creating", "created", "publishing", "unknown_creation", "unknown_publication"].includes(
    op.state,
  )
    ? PHASE[op.state as ThreadsSendState]
    : "error";
}

/**
 * Check status: reads the stored operation back. Handle-only recovery (DT-6B-2B-2-R1): it needs no row, draft, send
 * permission or account read; it asks the handle's own account, on the handle's own Worker only (another Worker's
 * handle is never asked and never gets this connection's token), behind the connection/visit/latest-action fences.
 */
export async function checkThreadsReply(scope: string): Promise<void> {
  const op = threadsOp(scope);
  const f = capture(scope, op?.account ?? "", "", true);
  if (!op) return show(scope, f, IDLE);
  if (!ownWorker(scope, op, f) || !connected(f)) return show(scope, f, CLOSED);
  const prev = useThreadsSendViews.getState().views[scope];
  if (!prev || ["idle", "closed", "error"].includes(prev.phase))
    show(scope, null, { ...IDLE, phase: "preparing" });
  const r = bindThreadsIntent(
    await threadsSendStatus(f.cfg, op.operationId, op.account),
    expectFor(scope, op),
  );
  if (r.ok) return settle(scope, f, r.intent, op.operationId);
  // Another tab replaced the operation while this one was looked up: show what is stored now.
  if (threadsOp(scope)?.operationId !== op.operationId) return reconcile(scope, f, "conflict");
  if (r.error === "not_found" && op.state === "preparing") {
    // The prepare never reached the coordinator: nothing exists to publish.
    await useStore.getState().clearInboxThreadsSendOp(scope, op.operationId);
    return show(scope, f, IDLE);
  }
  const intent = prev?.intent?.operationId === op.operationId ? prev.intent : null;
  // An answer that contradicts the handle (another publication id, too) is never recorded: the stored proof stands.
  const phase = lastKnown(op);
  show(scope, f, {
    ...IDLE,
    phase,
    intent: phase === "error" ? null : intent,
    error: r.error,
    ...(r.detail ? { detail: r.detail } : {}),
  });
}

/**
 * Cancel a review: the Worker ends a prepared intent only (no provider call). The handle goes only once a cancelled or
 * expired answer for this operation proves it; otherwise it stays.
 */
export async function cancelThreadsReply(scope: string): Promise<void> {
  const op = threadsOp(scope);
  const view = useThreadsSendViews.getState().views[scope];
  const live = useProviderInbox.getState().threads;
  const f = capture(scope, live?.accountId ?? "", live?.generation ?? "");
  const done = view?.phase === "review" ? { ...IDLE, phase: "cancelled" as const } : IDLE;
  if (!op || (op.state !== "prepared" && op.state !== "preparing"))
    return show(scope, f, view && view.phase !== "review" ? view : done);
  if (op.account !== f.account || !ownWorker(scope, op, f) || !connected(f))
    return show(scope, f, CLOSED);
  const store = useStore.getState();
  const r = bindThreadsIntent(
    await cancelThreadsSend(f.cfg, op.operationId, op.account),
    expectFor(scope, op),
  );
  if (r.ok && (r.intent.state === "cancelled" || r.intent.state === "expired")) {
    await store.clearInboxThreadsSendOp(scope, op.operationId);
    // DT-6B-2B-2-R2: the open review ends on this validated receipt (its handle is gone): a truthful terminal view.
    return show(
      scope,
      f,
      view?.phase === "review" ? { ...IDLE, phase: PHASE[r.intent.state], intent: r.intent } : IDLE,
    );
  }
  if (r.ok) return settle(scope, f, r.intent, op.operationId);
  if (r.error === "not_found" && op.state === "preparing") {
    await store.clearInboxThreadsSendOp(scope, op.operationId);
    return show(scope, f, done);
  }
  show(scope, f, { ...IDLE, phase: "error", error: "cancelFailed" });
}

type ClearedListener = (scope: string, draft: InboxDraft) => void;
const clearedListeners = new Set<ClearedListener>();

/**
 * DT-6B-2B-2-R1 (2B2-4): every mounted editor hears a successful "Clear draft", from any opener (its row or the recovery
 * list), with the scope and the exact discarded draft (its revision and text); a failed or skipped discard says nothing.
 * Memory only. Returns the unsubscribe.
 */
export function onThreadsDraftCleared(hear: ClearedListener): () => void {
  clearedListeners.add(hear);
  return () => {
    clearedListeners.delete(hear);
  };
}

/**
 * Close a settled operation. `clearDraft` discards the draft only when it is still the revision that was published; a
 * newer edit is never touched. Returns the discarded draft (null when none was), or "failed" when the discard did not
 * land (then nothing is closed).
 */
export async function finishThreadsReply(
  scope: string,
  clearDraft = false,
): Promise<InboxDraft | null | "failed"> {
  const op = threadsOp(scope);
  if (isLiveThreadsOp(op)) return null;
  const store = useStore.getState();
  let cleared: InboxDraft | null = null;
  if (clearDraft && op?.state === "published") {
    const draft = store.inboxDrafts[scope];
    if (draft && draft.commitId === op.draftRevision) {
      if (!(await store.discardInboxDraft(scope, inboxDraftBase(draft))).ok) {
        const view = useThreadsSendViews.getState().views[scope];
        if (view) show(scope, null, { ...view, error: "clearFailed" });
        return "failed";
      }
      cleared = draft;
      for (const hear of clearedListeners) hear(scope, draft);
    }
  }
  if (op) await store.clearInboxThreadsSendOp(scope, op.operationId);
  sessions[scope] = (sessions[scope] ?? 0) + 1;
  show(scope, null, IDLE);
  return cleared;
}

/** A fresh operation id the Worker accepts ([A-Za-z0-9_-]{8,64}). */
function newThreadsOperationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
