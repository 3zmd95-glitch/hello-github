"use client";

import { create } from "zustand";
import {
  bindInstagramIntent,
  cancelInstagramSend,
  confirmInstagramSend,
  instagramSendDigest,
  instagramSendReadiness,
  instagramSendStatus,
  prepareInstagramSend,
  type InstagramExpect,
  type InstagramIntent,
  type InstagramSendDetail,
  type InstagramSendErrorCode,
  type InstagramSendReadiness,
  type InstagramSendResult,
  type InstagramSendState,
} from "@/lib/inboxInstagramSend";
import { workerOrigin } from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import {
  INBOX_IG_SEND_SETTLED,
  inboxDraftBase,
  useStore,
  type InboxDraft,
  type InboxInstagramSendOp,
} from "@/store";
import { useInbox } from "./useInbox";
import { useProviderInbox } from "./useProviderInbox";

/**
 * 📤 Reviewed Instagram public comment replies, client side (packet DT-6B-2C-4, planning/tools/37-inbox-send.md). Its own
 * views, handle slice (`inboxInstagramSendOps`, keyed `instagram|<comment draft scope>`) and fences; nothing is shared
 * with the YouTube or Threads clients.
 *
 * - Readiness comes from `instagramSendReadiness()`, closed in production: Prepare and Send ask nothing and say
 *   "unavailable". Only tests inject `{ readiness }`. Check status and Cancel of a prepared review never ask readiness,
 *   a row, a draft or the account read.
 * - The handle is persisted BEFORE every request: "preparing" before Prepare, "confirming" (the pending-confirm mark)
 *   before Confirm. A failed write means no request. A Worker answer is shown only when the handle stored after its
 *   commit is exactly that receipt (operation, version, state); otherwise the view follows what is stored
 *   ("superseded" / "unrecorded" + Check status).
 * - Every action captures once the Worker URL + token, the config epoch, the provider visit, the Instagram account and
 *   its READER generation, the open post, the saved draft revision and its own session, and re-checks them after every
 *   await and right before the request. A move means no request and a "closed" view; coming back (A → B → A) never
 *   revives it. The reader generation only fences visits; the send generation is learned from the prepared intent and
 *   bound after that; the two are never compared.
 * - dispatching, unknown, a lost or malformed answer and an interrupted confirm are status only: no automatic confirm,
 *   retry, new operation or polling, and `not_found` never means "not delivered". An unresolved handle blocks a new
 *   Prepare. Status and Cancel go only to the handle's own Worker with the current token (never another origin's).
 * - DT-6B-2C-4-R1: a preparing handle is let go only while it is still that exact record (a stale failure or not_found
 *   never erases later proof); a prepared read never undoes the pending-confirm mark (status only), which goes back to
 *   its review only by the two named rollbacks of that exact mark, shown only when read back exactly; Prepare and Send
 *   are also fenced by the comment/editor visit (another comment, its editor closing or remounting, another tab).
 */

export type InstagramSendPhase =
  | "idle"
  | "preparing"
  | "review"
  | "confirming"
  | "dispatching"
  | "sent"
  | "rejected"
  | "unknown"
  | "already_claimed"
  /** Local uncertainty: a request may have reached the Worker; only Check status follows. */
  | "uncertain"
  | "expired"
  | "cancelled"
  | "error"
  | "closed";

export interface InstagramSendView {
  phase: InstagramSendPhase;
  intent: InstagramIntent | null;
  error:
    | InstagramSendErrorCode
    | "unavailable"
    | "notPersisted"
    | "conflictLocal"
    | "capacity"
    | "cancelFailed"
    | "clearFailed"
    | "superseded"
    | "unrecorded"
    | "unresolved"
    | null;
  detail?: InstagramSendDetail;
}

/** Where a reviewed reply would go: the account on screen (with its reader generation), the owned post, the comment. */
export interface InstagramSendTarget {
  account: string;
  readerGeneration: string;
  mediaId: string;
  commentId: string;
}

/** Test-only injection of readiness (production never passes it). */
export interface InstagramSendDeps {
  readiness?: () => InstagramSendReadiness;
}

const IDLE: InstagramSendView = { phase: "idle", intent: null, error: null };
const CLOSED: InstagramSendView = { ...IDLE, phase: "closed" };

export const useInstagramSendViews = create<{ views: Record<string, InstagramSendView> }>()(() => ({
  views: {},
}));

let epoch = 0;
const sessions: Record<string, number> = {};

/** Clears every view; an answer still on its way lands as "closed" (tests; a connection change does this). */
export function resetInstagramSendViews(): void {
  epoch += 1;
  useInstagramSendViews.setState({ views: {} }, true);
}

useStore.subscribe((s, prev) => {
  const k = s.settings.apiKeys;
  const was = prev.settings.apiKeys;
  if (k.scoutUrl !== was.scoutUrl || k.scoutToken !== was.scoutToken) resetInstagramSendViews();
});

/** Every provider move and every Instagram account or reader-generation change is a new visit. */
let visit = 0;
/** Every change of the open post is a new selection. */
let selection = 0;
useProviderInbox.subscribe((s, prev) => {
  if (s.provider !== prev.provider) visit += 1;
});
useInbox.subscribe((s, prev) => {
  if (
    s.account?.accountId !== prev.account?.accountId ||
    s.account?.generation !== prev.account?.generation
  )
    visit += 1;
  if (s.mediaId !== prev.mediaId) selection += 1;
  if (s.tab !== prev.tab) commentVisit += 1;
});

/**
 * DT-6B-2C-4-R1 (2C4-4): the comment/editor visit. A new token whenever another comment is selected (same post
 * included), a comment's editor mounts or unmounts (closing it, leaving the page, A → B → A) or the Inbox tab changes.
 * Prepare and Send capture it and re-check it after every await and right before the request; Status and Cancel do not.
 */
let commentVisit = 0;
export function newInstagramCommentVisit(): void {
  commentVisit += 1;
}

function config(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/** The handle key of a comment draft scope, and back. */
export const igOpKey = (scope: string): string => `instagram|${scope}`;
export const igDraftScope = (key: string): string => key.slice("instagram|".length);

/** The persisted handle of a comment draft scope, if any. */
export const instagramOp = (scope: string): InboxInstagramSendOp | undefined =>
  useStore.getState().inboxInstagramSendOps[igOpKey(scope)];

/** A handle whose operation may still be (or have been) sent: no new operation starts on this scope. */
export const isLiveInstagramOp = (op: InboxInstagramSendOp | undefined): boolean =>
  !!op && !INBOX_IG_SEND_SETTLED.includes(op.state);

const PHASE: Record<InstagramSendState, InstagramSendPhase> = {
  prepared: "review",
  dispatching: "dispatching",
  sent: "sent",
  rejected: "rejected",
  unknown: "unknown",
  already_claimed: "already_claimed",
  expired: "expired",
  cancelled: "cancelled",
};

interface Fence {
  epoch: number;
  session: number;
  visit: number;
  selection: number;
  commentVisit: number;
  account: string;
  readerGeneration: string;
  mediaId: string;
  /** The saved draft revision of the scope when the action started (null: none). */
  draft: string | null;
  /** The connection every request of this action goes to; never re-read. */
  cfg: ScoutConfig | null;
  /** That connection's Worker origin (recorded on the handle). */
  origin: string | null;
  /** Status / Cancel: bound to the handle, not to the account, post or draft on screen. */
  status: boolean;
}

function capture(scope: string, t: Partial<InstagramSendTarget>, status = false): Fence {
  sessions[scope] = (sessions[scope] ?? 0) + 1;
  const cfg = config();
  return {
    epoch,
    session: sessions[scope],
    visit,
    selection,
    commentVisit,
    account: t.account ?? "",
    readerGeneration: t.readerGeneration ?? "",
    mediaId: t.mediaId ?? "",
    draft: useStore.getState().inboxDrafts[scope]?.commitId ?? null,
    cfg,
    origin: workerOrigin(cfg),
    status,
  };
}

/**
 * The connection and the Instagram visit the action captured are still the live ones, and (except for status) its
 * account, reader generation, open post, comment/editor visit and saved draft revision too.
 */
function connected(f: Fence, scope: string): boolean {
  const c = config();
  const s = useInbox.getState();
  return (
    f.epoch === epoch &&
    f.visit === visit &&
    useProviderInbox.getState().provider === "instagram" &&
    !!c &&
    c.url === f.cfg?.url &&
    c.token === f.cfg?.token &&
    (f.status ||
      (s.account?.accountId === f.account &&
        s.account.generation === f.readerGeneration &&
        f.selection === selection &&
        f.commentVisit === commentVisit &&
        s.mediaId === f.mediaId &&
        (useStore.getState().inboxDrafts[scope]?.commitId ?? null) === f.draft))
  );
}

/** Requests about an operation go only to its own Worker, with that Worker's token. */
const ownWorker = (op: InboxInstagramSendOp, f: Fence): boolean =>
  !!f.origin && op.workerOrigin === f.origin;

const latest = (scope: string, f: Fence): boolean => f.session === sessions[scope];
const current = (scope: string, f: Fence): boolean => latest(scope, f) && connected(f, scope);

/** An older action's answer is dropped; the newest one's after a move is "closed". */
function show(scope: string, f: Fence | null, view: InstagramSendView): void {
  if (f && !latest(scope, f)) return;
  const next = f && !connected(f, scope) ? CLOSED : view;
  useInstagramSendViews.setState((s) => ({ views: { ...s.views, [scope]: next } }));
}

type Handle = Omit<InboxInstagramSendOp, "updatedAt" | "commitId" | "workerOrigin">;

/** A local step: the store keeps the stored receipt's version, send generation and reply id. */
const stepOf = (o: InboxInstagramSendOp | Handle, state: Handle["state"]): Handle => ({
  operationId: o.operationId,
  account: o.account,
  mediaId: o.mediaId,
  commentId: o.commentId,
  draftRevision: o.draftRevision,
  digest: o.digest,
  state,
});

/** A Worker receipt: identifiers, state, its integer version and the learned send generation (never the text). */
const handleOf = (i: InstagramIntent): Handle => ({
  ...stepOf(i as unknown as Handle, i.state),
  receiptVersion: i.receiptVersion,
  sendGeneration: i.generation,
  ...(i.state === "sent" && i.providerReplyId ? { providerReplyId: i.providerReplyId } : {}),
});

/** Every write records the Worker the action's requests go to (the store refuses another one for the operation). */
const write = (scope: string, h: Handle, expected: string | null, f: Fence) =>
  useStore
    .getState()
    .setInboxInstagramSendOp(igOpKey(scope), { ...h, workerOrigin: f.origin ?? "" }, expected);

/** The handle stored after the commit is exactly this receipt (another writer may have landed after it). */
const committed = (c: InboxInstagramSendOp | null | undefined, i: InstagramIntent): boolean =>
  !!c &&
  c.operationId === i.operationId &&
  c.receiptVersion === i.receiptVersion &&
  c.state === i.state;

/** What a bare handle proves (Status/Cancel after a reload know no text). */
const expectOf = (h: InboxInstagramSendOp): InstagramExpect => ({
  operationId: h.operationId,
  account: h.account,
  draftRevision: h.draftRevision,
  digest: h.digest,
  mediaId: h.mediaId,
  commentId: h.commentId,
  ...(h.sendGeneration ? { sendGeneration: h.sendGeneration } : {}),
  ...(h.providerReplyId ? { providerReplyId: h.providerReplyId } : {}),
});

/** A reviewed intent also proves its canonical text and send generation. */
function expectFor(scope: string, op: InboxInstagramSendOp): InstagramExpect {
  const known = useInstagramSendViews.getState().views[scope]?.intent;
  return known?.operationId === op.operationId
    ? { ...expectOf(op), text: known.text, sendGeneration: op.sendGeneration ?? known.generation }
    : expectOf(op);
}

const localError = (reason: string): InstagramSendView["error"] =>
  reason === "conflict" ? "conflictLocal" : reason === "capacity" ? "capacity" : "notPersisted";

const errorView = (r: Extract<InstagramSendResult, { ok: false }>): InstagramSendView => ({
  ...IDLE,
  phase: "error",
  error: r.error,
  ...(r.detail ? { detail: r.detail } : {}),
});

const intentView = (i: InstagramIntent): InstagramSendView => ({
  ...IDLE,
  phase: PHASE[i.state],
  intent: i,
});

const UNAVAILABLE: InstagramSendView = {
  ...IDLE,
  phase: "error",
  error: "unavailable",
  detail: "permission_unverified",
};

/** A refused durable write: the view follows what is stored now, with Check status for it. */
function reconcile(scope: string, f: Fence, reason: string): void {
  if (!instagramOp(scope)) return show(scope, f, CLOSED);
  const error = reason === "stale" || reason === "conflict" ? "superseded" : "unrecorded";
  show(scope, f, { ...IDLE, phase: "error", error });
}

/** Records a Worker answer; it is shown only when exactly that receipt is the durable handle after the commit. */
async function settle(
  scope: string,
  f: Fence,
  i: InstagramIntent,
  expected: string,
): Promise<void> {
  const op = instagramOp(scope);
  // The Worker's lost-receipt answer (`unknown` at the claim's version) and a later read of that same claim
  // (`dispatching`, same version) are one uncertainty: the stored `unknown` stays, the view is status only.
  if (
    op?.operationId === i.operationId &&
    op.state === "unknown" &&
    i.state === "dispatching" &&
    op.receiptVersion === i.receiptVersion
  )
    return show(scope, f, intentView(i));
  // 2C4-2: a prepared read while a Confirm is pending or uncertain cannot prove that Confirm will not land: the mark
  // stays and the view is status only (no Send). The store refuses that write too.
  if (op?.operationId === i.operationId && op.state === "confirming" && i.state === "prepared")
    return show(scope, f, { ...IDLE, phase: "uncertain", intent: i });
  const w = await write(scope, handleOf(i), expected, f);
  if (w.ok && committed(w.current, i)) return show(scope, f, intentView(i));
  reconcile(scope, f, w.ok ? "conflict" : w.reason);
}

/**
 * 2C4-1: lets a preparing handle go only while it is still the exact record this action knew (a request may have been
 * sent since: a late failure or not_found never erases later proof). False: the newer proof stays and the view follows
 * what is stored.
 */
async function letGo(scope: string, f: Fence, prep: InboxInstagramSendOp): Promise<boolean> {
  const gone = await useStore.getState().clearInboxInstagramSendOpIf(igOpKey(scope), {
    operationId: prep.operationId,
    state: "preparing",
    receiptVersion: prep.receiptVersion,
    commitId: prep.commitId,
  });
  if (!gone.ok) reconcile(scope, f, gone.reason);
  return gone.ok;
}

/**
 * 2C4-2 / 2C4-3: the pending-confirm mark becomes its review again only by name, from that exact mark: "beforeRequest"
 * (this action's own fence failed; no Confirm request was made) or "preClaimRefusal" (that Confirm request was refused
 * conclusively before any claim). The view applies only when the record read back after the commit is exactly the one
 * written; otherwise it follows what is stored (superseded / unrecorded + Check status).
 */
async function rollback(
  scope: string,
  f: Fence,
  mark: InboxInstagramSendOp,
  why: "beforeRequest" | "preClaimRefusal",
  view: InstagramSendView,
): Promise<void> {
  const back = await useStore
    .getState()
    .rollbackInboxInstagramSendConfirm(igOpKey(scope), mark, why);
  const c = back.ok ? back.current : null;
  const w = back.ok ? back.op : null;
  if (
    c &&
    w &&
    c.operationId === w.operationId &&
    c.receiptVersion === w.receiptVersion &&
    c.state === "prepared" &&
    c.commitId === w.commitId
  )
    return show(scope, f, view);
  reconcile(scope, f, back.ok ? "conflict" : back.reason);
}
const rollbackBeforeRequest = (scope: string, f: Fence, mark: InboxInstagramSendOp) =>
  rollback(scope, f, mark, "beforeRequest", CLOSED);
const rollbackOnPreClaimRefusal = (
  scope: string,
  f: Fence,
  mark: InboxInstagramSendOp,
  view: InstagramSendView,
) => rollback(scope, f, mark, "preClaimRefusal", view);

/** Prepare: persist the handle, then ask the Worker to prove the target and store the immutable intent. */
export async function prepareInstagramReply(
  scope: string,
  target: InstagramSendTarget,
  text: string,
  draftRevision: string,
  deps: InstagramSendDeps = {},
): Promise<void> {
  const ready = () => (deps.readiness ?? instagramSendReadiness)().ok;
  const existing = instagramOp(scope);
  if (isLiveInstagramOp(existing))
    return show(scope, null, { ...IDLE, phase: "error", error: "unresolved" });
  if (!ready()) return show(scope, null, UNAVAILABLE);
  const f = capture(scope, target);
  // Only the saved exact revision can be reviewed.
  if (!connected(f, scope) || f.draft !== draftRevision) return show(scope, f, CLOSED);
  show(scope, null, { ...IDLE, phase: "preparing" });
  const operationId = newInstagramOperationId();
  const digest = instagramSendDigest(text);
  const w = await write(
    scope,
    {
      operationId,
      account: target.account,
      mediaId: target.mediaId,
      commentId: target.commentId,
      draftRevision,
      digest,
      state: "preparing",
    },
    existing?.operationId ?? null,
    f,
  );
  if (!w.ok) return show(scope, f, { ...IDLE, phase: "error", error: localError(w.reason) });
  const prep = w.current;
  if (prep?.operationId !== operationId || prep.state !== "preparing")
    return reconcile(scope, f, "conflict");
  if (!current(scope, f) || !ready()) {
    // The action, its connection, its target, its draft or readiness moved while the handle was written: no request.
    if (await letGo(scope, f, prep)) show(scope, f, CLOSED);
    return;
  }
  const r = bindInstagramIntent(
    await prepareInstagramSend(f.cfg, {
      operationId,
      account: target.account,
      mediaId: target.mediaId,
      commentId: target.commentId,
      text,
      draftRevision,
    }),
    {
      account: target.account,
      mediaId: target.mediaId,
      commentId: target.commentId,
      draftRevision,
      digest,
      text: text.trim(),
    },
  );
  if (!r.ok && r.error === "mismatch")
    // An answer about something else is not trusted; the handle stays for Check status.
    return show(scope, f, { ...IDLE, phase: "uncertain", error: "mismatch" });
  if (!r.ok) {
    // Nothing can be sent without a confirm, so a failed prepare lets go of its handle, while it is still unchanged.
    if (await letGo(scope, f, prep)) show(scope, f, errorView(r));
    return;
  }
  // Another tab may have prepared the same saved draft first: the handle follows the Worker's canonical operation, and
  // its review opens only once exactly that receipt is the durable handle here (read back after the commit).
  const w2 = await write(scope, handleOf(r.intent), operationId, f);
  if (!w2.ok) return show(scope, f, { ...IDLE, phase: "error", error: localError(w2.reason) });
  if (!committed(w2.current, r.intent)) return reconcile(scope, f, "conflict");
  show(scope, f, intentView(r.intent));
}

/**
 * 2C4-2: the Worker's refusals of a confirm that come conclusively before any claim (the intent is still prepared):
 * only these roll the pending-confirm mark back. `target_invalid` and `capacity` are in the ruling's list though this
 * transport currently reads them as `upstream`. Every other failure (lost, malformed, mismatched, not_found, a missing
 * receipt store, rate limits...) may follow a request that reached the Worker: status only.
 */
const PRE_CLAIM: readonly string[] = [
  "no_permission",
  "stale",
  "account_mismatch",
  "target_unverified",
  "target_invalid",
  "token_expired",
  "text_invalid",
  "conflict",
  "capacity",
];

/** Send: the one explicit confirm of a reviewed `prepared` operation. Never repeated by itself. */
export async function confirmInstagramReply(
  scope: string,
  target: InstagramSendTarget,
  deps: InstagramSendDeps = {},
): Promise<void> {
  const ready = () => (deps.readiness ?? instagramSendReadiness)().ok;
  const view = useInstagramSendViews.getState().views[scope];
  const intent = view?.intent;
  if (!intent || view.phase !== "review" || intent.state !== "prepared") return;
  if (!ready()) return show(scope, null, { ...view, error: "unavailable" });
  const f = capture(scope, target);
  const op = instagramOp(scope);
  if (op?.operationId !== intent.operationId || op.state !== "prepared")
    // The stored handle moved on (another tab): never act on the older view.
    return reconcile(scope, f, "stale");
  if (
    !connected(f, scope) ||
    !ownWorker(op, f) ||
    intent.account !== target.account ||
    intent.mediaId !== target.mediaId ||
    intent.commentId !== target.commentId
  )
    return show(scope, f, CLOSED);
  show(scope, null, { ...view, phase: "confirming" });
  const w = await write(scope, stepOf(op, "confirming"), op.operationId, f);
  if (!w.ok) return show(scope, f, { ...view, error: localError(w.reason) });
  const mark = w.op;
  if (
    !mark ||
    w.current?.operationId !== op.operationId ||
    w.current.state !== "confirming" ||
    w.current.commitId !== mark.commitId
  )
    return reconcile(scope, f, "conflict");
  // Checked right before the request: no await between here and the fetch.
  if (!current(scope, f) || !ready()) return rollbackBeforeRequest(scope, f, mark);
  const r = bindInstagramIntent(
    await confirmInstagramSend(f.cfg, {
      operationId: intent.operationId,
      digest: intent.digest,
      account: intent.account,
    }),
    { ...expectOf(op), text: intent.text, sendGeneration: op.sendGeneration ?? intent.generation },
  );
  if (r.ok) return settle(scope, f, r.intent, intent.operationId);
  if (!PRE_CLAIM.includes(r.error))
    return show(scope, f, { ...IDLE, phase: "uncertain", intent, error: r.error });
  // Refused before any claim: nothing was sent, and the review still stands, unless newer proof was recorded meanwhile.
  return rollbackOnPreClaimRefusal(scope, f, mark, {
    ...view,
    phase: "review",
    error: r.error,
    ...(r.detail ? { detail: r.detail } : {}),
  });
}

/** The view of a stored handle whose lookup failed: local marks are uncertain, durable uncertainty stays as it was. */
function lastKnown(op: InboxInstagramSendOp): InstagramSendPhase {
  if (op.state === "preparing" || op.state === "confirming") return "uncertain";
  return op.state === "dispatching" || op.state === "unknown" ? op.state : "error";
}

/**
 * Check status: reads the stored operation back. Handle-only recovery: it needs no row, draft, readiness or account
 * read; it asks the handle's own account, on the handle's own Worker only (another Worker's handle is never asked and
 * never gets this connection's token), behind the connection/visit/latest-action fences.
 */
export async function checkInstagramReply(scope: string): Promise<void> {
  const op = instagramOp(scope);
  const f = capture(scope, { account: op?.account }, true);
  if (!op) return show(scope, f, IDLE);
  if (!ownWorker(op, f) || !connected(f, scope)) return show(scope, f, CLOSED);
  const prev = useInstagramSendViews.getState().views[scope];
  if (!prev || ["idle", "closed", "error"].includes(prev.phase))
    show(scope, null, { ...IDLE, phase: "preparing" });
  const r = bindInstagramIntent(
    await instagramSendStatus(f.cfg, op.operationId, op.account),
    expectFor(scope, op),
  );
  if (r.ok) return settle(scope, f, r.intent, op.operationId);
  // Another tab replaced the operation while this one was looked up: show what is stored now.
  if (instagramOp(scope)?.operationId !== op.operationId) return reconcile(scope, f, "conflict");
  if (r.error === "not_found" && op.state === "preparing") {
    // The prepare never reached the coordinator, and no confirm was ever marked: nothing exists to send (unless the
    // handle moved on meanwhile: then that newer proof stays).
    if (await letGo(scope, f, op)) show(scope, f, IDLE);
    return;
  }
  const intent = prev?.intent?.operationId === op.operationId ? prev.intent : null;
  // An answer that contradicts the handle is never recorded: the stored proof stands.
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
 * Cancel a prepared review: the Worker ends a prepared intent only (no provider call). Needs no readiness, row or
 * account read (the handle's own account and Worker). The handle goes only once a cancelled or expired answer for this
 * operation proves it; any other answer is shown as it is, and a failure keeps the handle.
 */
export async function cancelInstagramReply(scope: string): Promise<void> {
  const op = instagramOp(scope);
  const view = useInstagramSendViews.getState().views[scope];
  const f = capture(scope, { account: op?.account }, true);
  const done = view?.phase === "review" ? { ...IDLE, phase: "cancelled" as const } : IDLE;
  if (!op || (op.state !== "prepared" && op.state !== "preparing"))
    return show(scope, f, view && view.phase !== "review" ? view : done);
  if (!ownWorker(op, f) || !connected(f, scope)) return show(scope, f, CLOSED);
  const store = useStore.getState();
  const r = bindInstagramIntent(
    await cancelInstagramSend(f.cfg, op.operationId, op.account),
    expectFor(scope, op),
  );
  if (r.ok && (r.intent.state === "cancelled" || r.intent.state === "expired")) {
    const gone = await store.clearInboxInstagramSendOp(igOpKey(scope), op.operationId);
    if (!gone.ok) return reconcile(scope, f, gone.reason);
    // The validated terminal receipt stays on the view (its handle is gone): Close ends it.
    return show(scope, f, intentView(r.intent));
  }
  if (r.ok) return settle(scope, f, r.intent, op.operationId);
  if (r.error === "not_found" && op.state === "preparing") {
    if (await letGo(scope, f, op)) show(scope, f, done);
    return;
  }
  show(scope, f, { ...IDLE, phase: "error", error: "cancelFailed" });
}

type ClearedListener = (scope: string, draft: InboxDraft) => void;
const clearedListeners = new Set<ClearedListener>();

/**
 * Every mounted editor hears a successful "Clear draft" (from its row or the recovery list) with the scope and the exact
 * discarded draft (revision and text); a failed or skipped discard says nothing. Memory only. Returns the unsubscribe.
 */
export function onInstagramDraftCleared(hear: ClearedListener): () => void {
  clearedListeners.add(hear);
  return () => {
    clearedListeners.delete(hear);
  };
}

/**
 * Close a settled operation. `clearDraft` discards the draft only when it is still the revision that was sent (its
 * saved revision, never a guess from the trimmed text); a newer edit is never touched. Returns the discarded draft (null
 * when none was), or "failed" when the discard did not land (then nothing is closed).
 */
export async function finishInstagramReply(
  scope: string,
  clearDraft = false,
): Promise<InboxDraft | null | "failed"> {
  const op = instagramOp(scope);
  if (isLiveInstagramOp(op)) return null;
  const store = useStore.getState();
  let cleared: InboxDraft | null = null;
  if (clearDraft && op?.state === "sent") {
    const draft = store.inboxDrafts[scope];
    if (draft && draft.commitId === op.draftRevision) {
      if (!(await store.discardInboxDraft(scope, inboxDraftBase(draft))).ok) {
        const view = useInstagramSendViews.getState().views[scope];
        if (view) show(scope, null, { ...view, error: "clearFailed" });
        return "failed";
      }
      cleared = draft;
      for (const hear of clearedListeners) hear(scope, draft);
    }
  }
  if (op) await store.clearInboxInstagramSendOp(igOpKey(scope), op.operationId);
  sessions[scope] = (sessions[scope] ?? 0) + 1;
  show(scope, null, IDLE);
  return cleared;
}

/** A fresh operation id the Worker accepts ([A-Za-z0-9_-]{8,64}). */
function newInstagramOperationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
