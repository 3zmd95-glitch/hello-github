"use client";

import { create } from "zustand";
import {
  bindDmIntent,
  cancelInstagramDm as cancelDmRequest,
  confirmInstagramDm,
  dmBodyDigest,
  dmOpKey,
  dmTextEligible,
  instagramDmSendReadiness,
  instagramDmStatus,
  prepareInstagramDm,
  type DmDetail,
  type DmErrorCode,
  type DmExpect,
  type DmIntent,
  type DmObserved,
  type DmResult,
  type DmSendReadiness,
  type DmSendState,
} from "@/lib/inboxInstagramDmSend";
import { inboxScope, workerOrigin } from "@/lib/inbox";
import { scoutConfig, type ScoutConfig } from "@/lib/scoutClient";
import {
  INBOX_IG_DM_SETTLED,
  inboxDraftBase,
  useStore,
  type InboxDraft,
  type InboxInstagramDmSendOp,
} from "@/store";
import { useInbox } from "./useInbox";
import { useProviderInbox } from "./useProviderInbox";

/**
 * 💬 Reviewed Instagram DMs answering one inbound message of an opened conversation, client side (packet DT-6B-2C-5A,
 * planning/tools/37-inbox-send.md). Its own views, handle slice (`inboxInstagramDmSendOps`, keyed
 * `origin|account|conversation|inbound message`) and fences; nothing is shared with the public-reply, Threads or YouTube
 * clients, and nothing here registers a control handle, takes over, resumes or changes a conversation's mode.
 *
 * - Readiness comes from `instagramDmSendReadiness()`, closed in production: Prepare and Send ask nothing and say
 *   "unavailable". Only tests inject `{ readiness }`. Check status and Cancel of a prepared review never ask readiness,
 *   a row, a draft or the account read.
 * - The handle is persisted BEFORE every request: "preparing" before Prepare, "confirming" (the pending-confirm mark)
 *   before Confirm. A failed write means no request. A Worker answer is shown only when the handle stored after its
 *   commit is exactly that receipt (operation, version, state); otherwise the view follows what is stored.
 * - Every action captures once the Worker URL + token, the config epoch, the provider visit, the Instagram account and its
 *   READER generation, the open conversation, the DM visit (selected inbound message, its editor, the tab), the saved
 *   draft revision and its own session, and re-checks them after every await and right before the request; A → B → A
 *   never revives. The reader generation only fences visits; the DM send generation and the Worker-proven inbound time
 *   are learned from the prepared intent and bound after that; the generations are never compared.
 * - A lost settlement (`settlement: "pending"`) stays `dispatching` with what was observed: an observed refusal is not a
 *   rejection, frees nothing and offers Check status only, like dispatching, unknown, a lost or malformed answer and an
 *   interrupted confirm. No automatic confirm, retry, new operation or polling; `not_found` never means "not sent". An
 *   unresolved handle blocks a new Prepare for that inbound message. Status and Cancel go only to the handle's own Worker.
 * - The C4-R1 guarantees carry over: a preparing handle is let go only while it is still that exact record, a prepared
 *   read never undoes the pending-confirm mark, which goes back to its review only by the two named rollbacks of that
 *   exact mark, shown only when read back exactly.
 */

export type DmSendPhase =
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

export interface DmSendView {
  phase: DmSendPhase;
  intent: DmIntent | null;
  /** What a lost settlement observed (only beside dispatching): uncertainty, never an outcome. */
  pending?: DmObserved;
  error:
    | DmErrorCode
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
  detail?: DmDetail;
}

/**
 * Where a reviewed DM would go: the account on screen (with its reader generation), the open conversation and the one
 * explicitly selected inbound message (its sender as recipient, its own time as the row shows it).
 */
export interface DmSendTarget {
  account: string;
  readerGeneration: string;
  conversationId: string;
  recipientId: string;
  inboundMessageId: string;
  /** The selected row's own time (compared with the Worker-proven time by instant). */
  inboundAt: string;
}

/** Test-only injection of readiness (production never passes it). */
export interface DmSendDeps {
  readiness?: () => DmSendReadiness;
}

const IDLE: DmSendView = { phase: "idle", intent: null, error: null };
const CLOSED: DmSendView = { ...IDLE, phase: "closed" };

export const useInstagramDmViews = create<{ views: Record<string, DmSendView> }>()(() => ({
  views: {},
}));

let epoch = 0;
const sessions: Record<string, number> = {};

/** Clears every view; an answer still on its way lands as "closed" (tests; a connection change does this). */
export function resetInstagramDmViews(): void {
  epoch += 1;
  useInstagramDmViews.setState({ views: {} }, true);
}

useStore.subscribe((s, prev) => {
  const k = s.settings.apiKeys;
  const was = prev.settings.apiKeys;
  if (k.scoutUrl !== was.scoutUrl || k.scoutToken !== was.scoutToken) resetInstagramDmViews();
});

/** Every provider move and every Instagram account or reader-generation change is a new visit. */
let visit = 0;
/** Every change of the open conversation is a new selection. */
let selection = 0;
/**
 * The DM visit: a new token whenever another inbound message is selected, the DM editor mounts or unmounts (closing the
 * conversation, leaving the page, A → B → A) or the Inbox tab changes. Prepare and Send capture it and re-check it after
 * every await and right before the request; Status and Cancel do not.
 */
let dmVisit = 0;
export function newInstagramDmVisit(): void {
  dmVisit += 1;
}
useProviderInbox.subscribe((s, prev) => {
  if (s.provider !== prev.provider) visit += 1;
});
useInbox.subscribe((s, prev) => {
  if (
    s.account?.accountId !== prev.account?.accountId ||
    s.account?.generation !== prev.account?.generation
  )
    visit += 1;
  if (s.conversationId !== prev.conversationId) selection += 1;
  if (s.tab !== prev.tab) dmVisit += 1;
});

function config(): ScoutConfig | null {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/** The persisted handle of an inbound message, if any. */
export const instagramDmOp = (key: string): InboxInstagramDmSendOp | undefined =>
  useStore.getState().inboxInstagramDmSendOps[key];

/** The private draft scope a handle's conversation keeps its draft under (never the text itself). */
export const dmDraftScope = (
  op: Pick<InboxInstagramDmSendOp, "workerOrigin" | "account" | "conversationId">,
): string => inboxScope(op.workerOrigin, op.account, "conversation", op.conversationId);

/** A handle whose operation may still be (or have been) sent: no new operation starts for this inbound message. */
export const isLiveInstagramDmOp = (op: InboxInstagramDmSendOp | undefined): boolean =>
  !!op && !INBOX_IG_DM_SETTLED.includes(op.state);

const PHASE: Record<DmSendState, DmSendPhase> = {
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
  dmVisit: number;
  account: string;
  readerGeneration: string;
  conversationId: string;
  /** The conversation's draft scope and its saved revision when the action started (null: none). */
  draftScope: string;
  draft: string | null;
  /** The connection every request of this action goes to; never re-read. */
  cfg: ScoutConfig | null;
  /** That connection's Worker origin (recorded on the handle). */
  origin: string | null;
  /** Status / Cancel: bound to the handle, not to the account, conversation, message or draft on screen. */
  status: boolean;
}

function capture(key: string, t: Partial<DmSendTarget>, status = false): Fence {
  sessions[key] = (sessions[key] ?? 0) + 1;
  const cfg = config();
  const origin = workerOrigin(cfg);
  const draftScope = inboxScope(
    origin ?? "",
    t.account ?? "",
    "conversation",
    t.conversationId ?? "",
  );
  return {
    epoch,
    session: sessions[key],
    visit,
    selection,
    dmVisit,
    account: t.account ?? "",
    readerGeneration: t.readerGeneration ?? "",
    conversationId: t.conversationId ?? "",
    draftScope,
    draft: useStore.getState().inboxDrafts[draftScope]?.commitId ?? null,
    cfg,
    origin,
    status,
  };
}

/**
 * The connection and the Instagram visit the action captured are still the live ones, and (except for status) its
 * account, reader generation, open conversation, DM visit and saved draft revision too.
 */
function connected(f: Fence): boolean {
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
        f.dmVisit === dmVisit &&
        s.conversationId === f.conversationId &&
        (useStore.getState().inboxDrafts[f.draftScope]?.commitId ?? null) === f.draft))
  );
}

/** Requests about an operation go only to its own Worker, with that Worker's token. */
const ownWorker = (op: InboxInstagramDmSendOp, f: Fence): boolean =>
  !!f.origin && op.workerOrigin === f.origin;

const latest = (key: string, f: Fence): boolean => f.session === sessions[key];
const current = (key: string, f: Fence): boolean => latest(key, f) && connected(f);

/** An older action's answer is dropped; the newest one's after a move is "closed". */
function show(key: string, f: Fence | null, view: DmSendView): void {
  if (f && !latest(key, f)) return;
  const next = f && !connected(f) ? CLOSED : view;
  useInstagramDmViews.setState((s) => ({ views: { ...s.views, [key]: next } }));
}

type Handle = Omit<InboxInstagramDmSendOp, "updatedAt" | "commitId" | "workerOrigin">;

/** A local step: the store keeps the stored receipt's version, inbound time, send generation and message id. */
const stepOf = (o: InboxInstagramDmSendOp | Handle, state: Handle["state"]): Handle => ({
  operationId: o.operationId,
  account: o.account,
  conversationId: o.conversationId,
  recipientId: o.recipientId,
  inboundMessageId: o.inboundMessageId,
  draftRevision: o.draftRevision,
  digest: o.digest,
  state,
});

/** A Worker receipt: identifiers, state, its version, the learned inbound time and send generation (never the text). */
const handleOf = (i: DmIntent, pending?: DmObserved): Handle => ({
  ...stepOf(i as unknown as Handle, i.state),
  receiptVersion: i.receiptVersion,
  inboundAt: i.inboundAt,
  sendGeneration: i.generation,
  ...(i.state === "sent" && i.providerMessageId ? { providerMessageId: i.providerMessageId } : {}),
  ...(i.state === "dispatching" && pending ? { pending } : {}),
});

/** Every write records the Worker the action's requests go to (the store refuses another one for the operation). */
const write = (key: string, h: Handle, expected: string | null, f: Fence) =>
  useStore
    .getState()
    .setInboxInstagramDmSendOp(key, { ...h, workerOrigin: f.origin ?? "" }, expected);

/** The handle stored after the commit is exactly this receipt (another writer may have landed after it). */
const committed = (c: InboxInstagramDmSendOp | null | undefined, i: DmIntent): boolean =>
  !!c &&
  c.operationId === i.operationId &&
  c.receiptVersion === i.receiptVersion &&
  c.state === i.state;

/** What a bare handle proves (Status/Cancel after a reload know no text). */
const expectOf = (h: InboxInstagramDmSendOp): DmExpect => ({
  operationId: h.operationId,
  account: h.account,
  conversationId: h.conversationId,
  recipientId: h.recipientId,
  inboundMessageId: h.inboundMessageId,
  draftRevision: h.draftRevision,
  digest: h.digest,
  ...(h.inboundAt ? { inboundAt: h.inboundAt } : {}),
  ...(h.sendGeneration ? { sendGeneration: h.sendGeneration } : {}),
  ...(h.providerMessageId ? { providerMessageId: h.providerMessageId } : {}),
});

/** A reviewed intent also proves its canonical text, inbound time and send generation. */
function expectFor(key: string, op: InboxInstagramDmSendOp): DmExpect {
  const known = useInstagramDmViews.getState().views[key]?.intent;
  return known?.operationId === op.operationId
    ? {
        ...expectOf(op),
        text: known.text,
        inboundAt: op.inboundAt ?? known.inboundAt,
        sendGeneration: op.sendGeneration ?? known.generation,
      }
    : expectOf(op);
}

const localError = (reason: string): DmSendView["error"] =>
  reason === "conflict" ? "conflictLocal" : reason === "capacity" ? "capacity" : "notPersisted";

const errorView = (r: Extract<DmResult, { ok: false }>): DmSendView => ({
  ...IDLE,
  phase: "error",
  error: r.error,
  ...(r.detail ? { detail: r.detail } : {}),
});

const intentView = (i: DmIntent, pending?: DmObserved): DmSendView => ({
  ...IDLE,
  phase: PHASE[i.state],
  intent: i,
  ...(i.state === "dispatching" && pending ? { pending } : {}),
});

const UNAVAILABLE: DmSendView = {
  ...IDLE,
  phase: "error",
  error: "unavailable",
  detail: "permission_unverified",
};

/** A refused durable write: the view follows what is stored now, with Check status for it. */
function reconcile(key: string, f: Fence, reason: string): void {
  if (!instagramDmOp(key)) return show(key, f, CLOSED);
  const error = reason === "stale" || reason === "conflict" ? "superseded" : "unrecorded";
  show(key, f, { ...IDLE, phase: "error", error });
}

/** Records a Worker answer; it is shown only when exactly that receipt is the durable handle after the commit. */
async function settle(
  key: string,
  f: Fence,
  i: DmIntent,
  expected: string,
  pending?: DmObserved,
): Promise<void> {
  const op = instagramDmOp(key);
  // A prepared read while a Confirm is pending or uncertain cannot prove that Confirm will not land: the mark stays and
  // the view is status only (no Send). The store refuses that write too.
  if (op?.operationId === i.operationId && op.state === "confirming" && i.state === "prepared")
    return show(key, f, { ...IDLE, phase: "uncertain", intent: i });
  const w = await write(key, handleOf(i, pending), expected, f);
  if (w.ok && committed(w.current, i)) return show(key, f, intentView(i, w.current?.pending));
  reconcile(key, f, w.ok ? "conflict" : w.reason);
}

/** Lets a preparing handle go only while it is still the exact record this action knew; false: newer proof stays. */
async function letGo(key: string, f: Fence, prep: InboxInstagramDmSendOp): Promise<boolean> {
  const gone = await useStore.getState().clearInboxInstagramDmSendOpIf(key, {
    operationId: prep.operationId,
    state: "preparing",
    receiptVersion: prep.receiptVersion,
    commitId: prep.commitId,
  });
  if (!gone.ok) reconcile(key, f, gone.reason);
  return gone.ok;
}

/**
 * The pending-confirm mark becomes its review again only by name, from that exact mark: "beforeRequest" (this action's
 * own fence failed; no Confirm request was made) or "preClaimRefusal" (that Confirm request was refused conclusively
 * before any claim). The view applies only when the record read back after the commit is exactly the one written.
 */
async function rollback(
  key: string,
  f: Fence,
  mark: InboxInstagramDmSendOp,
  why: "beforeRequest" | "preClaimRefusal",
  view: DmSendView,
): Promise<void> {
  const back = await useStore.getState().rollbackInboxInstagramDmSendConfirm(key, mark, why);
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
    return show(key, f, view);
  reconcile(key, f, back.ok ? "conflict" : back.reason);
}
const rollbackDmBeforeRequest = (key: string, f: Fence, mark: InboxInstagramDmSendOp) =>
  rollback(key, f, mark, "beforeRequest", CLOSED);
const rollbackDmOnPreClaimRefusal = (
  key: string,
  f: Fence,
  mark: InboxInstagramDmSendOp,
  view: DmSendView,
) => rollback(key, f, mark, "preClaimRefusal", view);

/** The handle key of a target on the configured Worker (null without one). */
export function instagramDmKey(t: DmSendTarget): string | null {
  const origin = workerOrigin(config());
  return origin ? dmOpKey(origin, t.account, t.conversationId, t.inboundMessageId) : null;
}

/** Prepare: persist the handle, then ask the Worker to prove the target and store the immutable intent. */
export async function prepareInstagramDmReply(
  key: string,
  target: DmSendTarget,
  text: string,
  draftRevision: string,
  deps: DmSendDeps = {},
): Promise<void> {
  const ready = () => (deps.readiness ?? instagramDmSendReadiness)().ok;
  const existing = instagramDmOp(key);
  if (isLiveInstagramDmOp(existing))
    return show(key, null, { ...IDLE, phase: "error", error: "unresolved" });
  if (!ready()) return show(key, null, UNAVAILABLE);
  const f = capture(key, target);
  // Only the saved exact revision of this conversation, for the key of exactly this target, can be reviewed.
  if (
    !f.origin ||
    key !== dmOpKey(f.origin, target.account, target.conversationId, target.inboundMessageId) ||
    !connected(f) ||
    f.draft !== draftRevision
  )
    return show(key, f, CLOSED);
  // DT-6B-3C: a new review needs at most 1000 UTF-8 bytes of the canonical text (never cut to fit).
  const canonical = dmTextEligible(text);
  if (canonical === null) return show(key, f, { ...IDLE, phase: "error", error: "text_invalid" });
  show(key, null, { ...IDLE, phase: "preparing" });
  const operationId = newInstagramDmOperationId();
  const digest = dmBodyDigest(target.recipientId, canonical);
  const ids = {
    account: target.account,
    conversationId: target.conversationId,
    recipientId: target.recipientId,
    inboundMessageId: target.inboundMessageId,
  };
  const w = await write(
    key,
    { operationId, ...ids, draftRevision, digest, state: "preparing" },
    existing?.operationId ?? null,
    f,
  );
  if (!w.ok) return show(key, f, { ...IDLE, phase: "error", error: localError(w.reason) });
  const prep = w.current;
  if (prep?.operationId !== operationId || prep.state !== "preparing")
    return reconcile(key, f, "conflict");
  if (!current(key, f) || !ready()) {
    // The action, its connection, its target, its draft or readiness moved while the handle was written: no request.
    if (await letGo(key, f, prep)) show(key, f, CLOSED);
    return;
  }
  const r = bindDmIntent(
    await prepareInstagramDm(f.cfg, { operationId, ...ids, text, draftRevision }),
    { ...ids, rowAt: target.inboundAt, draftRevision, digest, text: canonical },
  );
  if (!r.ok && r.error === "mismatch")
    // An answer about something else is not trusted; the handle stays for Check status.
    return show(key, f, { ...IDLE, phase: "uncertain", error: "mismatch" });
  if (!r.ok) {
    // Nothing can be sent without a confirm, so a failed prepare lets go of its handle, while it is still unchanged.
    if (await letGo(key, f, prep)) show(key, f, errorView(r));
    return;
  }
  // The identical submission may have been prepared first (another tab): the handle follows the Worker's operation,
  // and its review opens only once exactly that receipt is the durable handle here (read back after the commit).
  const w2 = await write(key, handleOf(r.intent), operationId, f);
  if (!w2.ok) return show(key, f, { ...IDLE, phase: "error", error: localError(w2.reason) });
  if (!committed(w2.current, r.intent)) return reconcile(key, f, "conflict");
  show(key, f, intentView(r.intent));
}

/**
 * The Worker's refusals of a confirm that the DM route (inboxSendInstagramDm.ts) gives only before `claimConfirm`, while
 * the stored intent is still prepared (anything past prepared is answered as an intent): a changed digest (`conflict`),
 * no connection, an expired token, the closed gate (`no_permission`), a reconnect (`stale`, also at the final fence), the
 * stored text over today's limit (`text_invalid`, DT-6B-3C) and the ownership chain over the stored target
 * (`account_mismatch`, `target_unverified`, `target_invalid`). Only these roll
 * the pending-confirm mark back. Every other failure (lost, malformed, mismatched, not_found, receipt_unavailable,
 * upstream, rate limits, a missing store...) stays status only.
 */
const PRE_CLAIM: readonly string[] = [
  "conflict",
  "not_connected",
  "token_expired",
  "no_permission",
  "stale",
  "text_invalid",
  "account_mismatch",
  "target_unverified",
  "target_invalid",
];

/** Send: the one explicit confirm of a reviewed `prepared` operation. Never repeated by itself. */
export async function confirmInstagramDmReply(
  key: string,
  target: DmSendTarget,
  deps: DmSendDeps = {},
): Promise<void> {
  const ready = () => (deps.readiness ?? instagramDmSendReadiness)().ok;
  const view = useInstagramDmViews.getState().views[key];
  const intent = view?.intent;
  if (!intent || view.phase !== "review" || intent.state !== "prepared") return;
  if (!ready()) return show(key, null, { ...view, error: "unavailable" });
  // DT-6B-3C: an older review whose text is over today's limit is never sent: no mark, no request; it stays for Check
  // status and Cancel (a new review needs an edited, saved draft).
  if (dmTextEligible(intent.text) !== intent.text)
    return show(key, null, { ...view, error: "text_invalid" });
  const f = capture(key, target);
  const op = instagramDmOp(key);
  if (op?.operationId !== intent.operationId || op.state !== "prepared")
    // The stored handle moved on (another tab): never act on the older view.
    return reconcile(key, f, "stale");
  if (
    !connected(f) ||
    !ownWorker(op, f) ||
    intent.account !== target.account ||
    intent.conversationId !== target.conversationId ||
    intent.recipientId !== target.recipientId ||
    intent.inboundMessageId !== target.inboundMessageId
  )
    return show(key, f, CLOSED);
  show(key, null, { ...view, phase: "confirming" });
  const w = await write(key, stepOf(op, "confirming"), op.operationId, f);
  if (!w.ok) return show(key, f, { ...view, error: localError(w.reason) });
  const mark = w.op;
  if (
    !mark ||
    w.current?.operationId !== op.operationId ||
    w.current.state !== "confirming" ||
    w.current.commitId !== mark.commitId
  )
    return reconcile(key, f, "conflict");
  // Checked right before the request: no await between here and the fetch.
  if (!current(key, f) || !ready()) return rollbackDmBeforeRequest(key, f, mark);
  const r = bindDmIntent(
    await confirmInstagramDm(f.cfg, {
      operationId: intent.operationId,
      digest: intent.digest,
      account: intent.account,
    }),
    {
      ...expectOf(op),
      text: intent.text,
      inboundAt: op.inboundAt ?? intent.inboundAt,
      sendGeneration: op.sendGeneration ?? intent.generation,
    },
  );
  if (r.ok) return settle(key, f, r.intent, intent.operationId, r.pending);
  if (!PRE_CLAIM.includes(r.error))
    return show(key, f, { ...IDLE, phase: "uncertain", intent, error: r.error });
  // Refused before any claim: nothing was sent, and the review still stands, unless newer proof was recorded meanwhile.
  return rollbackDmOnPreClaimRefusal(key, f, mark, {
    ...view,
    phase: "review",
    error: r.error,
    ...(r.detail ? { detail: r.detail } : {}),
  });
}

/** The view of a stored handle whose lookup failed: local marks are uncertain, durable uncertainty stays as it was. */
function lastKnown(op: InboxInstagramDmSendOp): DmSendPhase {
  if (op.state === "preparing" || op.state === "confirming") return "uncertain";
  return op.state === "dispatching" || op.state === "unknown" ? op.state : "error";
}

/**
 * Check status: reads the stored operation back. Handle-only recovery: no row, draft, readiness or account read; the
 * handle's own account, on the handle's own Worker only, behind the connection/visit/latest-action fences.
 */
export async function checkInstagramDmReply(key: string): Promise<void> {
  const op = instagramDmOp(key);
  const f = capture(key, { account: op?.account }, true);
  if (!op) return show(key, f, IDLE);
  if (!ownWorker(op, f) || !connected(f)) return show(key, f, CLOSED);
  const prev = useInstagramDmViews.getState().views[key];
  if (!prev || ["idle", "closed", "error"].includes(prev.phase))
    show(key, null, { ...IDLE, phase: "preparing" });
  const r = bindDmIntent(
    await instagramDmStatus(f.cfg, op.operationId, op.account),
    expectFor(key, op),
  );
  if (r.ok) return settle(key, f, r.intent, op.operationId);
  if (instagramDmOp(key)?.operationId !== op.operationId) return reconcile(key, f, "conflict");
  if (r.error === "not_found" && op.state === "preparing") {
    // The prepare never reached the coordinator and no confirm was ever marked (unless the handle moved on meanwhile).
    if (await letGo(key, f, op)) show(key, f, IDLE);
    return;
  }
  const intent = prev?.intent?.operationId === op.operationId ? prev.intent : null;
  const phase = lastKnown(op);
  show(key, f, {
    ...IDLE,
    phase,
    intent: phase === "error" ? null : intent,
    ...(op.pending ? { pending: op.pending } : {}),
    error: r.error,
    ...(r.detail ? { detail: r.detail } : {}),
  });
}

/**
 * Cancel a prepared review: the Worker ends a prepared intent only (no provider call). Needs no readiness, row or account
 * read. The handle goes only once a cancelled or expired answer for this operation proves it; any other answer is shown
 * as it is, and a failure keeps the handle.
 */
export async function cancelInstagramDmReply(key: string): Promise<void> {
  const op = instagramDmOp(key);
  const view = useInstagramDmViews.getState().views[key];
  const f = capture(key, { account: op?.account }, true);
  const done = view?.phase === "review" ? { ...IDLE, phase: "cancelled" as const } : IDLE;
  if (!op || (op.state !== "prepared" && op.state !== "preparing"))
    return show(key, f, view && view.phase !== "review" ? view : done);
  if (!ownWorker(op, f) || !connected(f)) return show(key, f, CLOSED);
  const store = useStore.getState();
  const r = bindDmIntent(
    await cancelDmRequest(f.cfg, op.operationId, op.account),
    expectFor(key, op),
  );
  if (r.ok && (r.intent.state === "cancelled" || r.intent.state === "expired")) {
    const gone = await store.clearInboxInstagramDmSendOp(key, op.operationId);
    if (!gone.ok) return reconcile(key, f, gone.reason);
    // The validated terminal receipt stays on the view (its handle is gone): Close ends it.
    return show(key, f, intentView(r.intent));
  }
  if (r.ok) return settle(key, f, r.intent, op.operationId);
  if (r.error === "not_found" && op.state === "preparing") {
    if (await letGo(key, f, op)) show(key, f, done);
    return;
  }
  show(key, f, { ...IDLE, phase: "error", error: "cancelFailed" });
}

type ClearedListener = (scope: string, draft: InboxDraft) => void;
const clearedListeners = new Set<ClearedListener>();

/**
 * Every mounted conversation editor hears a successful "Clear draft" (from its review or the recovery list) with the
 * conversation's draft scope and the exact discarded draft; a failed or skipped discard says nothing. Memory only.
 */
export function onInstagramDmDraftCleared(hear: ClearedListener): () => void {
  clearedListeners.add(hear);
  return () => {
    clearedListeners.delete(hear);
  };
}

/**
 * Close a settled operation. `clearDraft` discards the conversation's draft only when it is still the revision that was
 * sent (its saved revision, never a guess from the canonical text); a newer edit is never touched. Returns the discarded
 * draft (null when none was), or "failed" when the discard did not land (then nothing is closed).
 */
export async function finishInstagramDmReply(
  key: string,
  clearDraft = false,
): Promise<InboxDraft | null | "failed"> {
  const op = instagramDmOp(key);
  if (isLiveInstagramDmOp(op)) return null;
  const store = useStore.getState();
  let cleared: InboxDraft | null = null;
  if (clearDraft && op?.state === "sent") {
    const scope = dmDraftScope(op);
    const draft = store.inboxDrafts[scope];
    if (draft && draft.commitId === op.draftRevision) {
      if (!(await store.discardInboxDraft(scope, inboxDraftBase(draft))).ok) {
        const view = useInstagramDmViews.getState().views[key];
        if (view) show(key, null, { ...view, error: "clearFailed" });
        return "failed";
      }
      cleared = draft;
      for (const hear of clearedListeners) hear(scope, draft);
    }
  }
  if (op) await store.clearInboxInstagramDmSendOp(key, op.operationId);
  sessions[key] = (sessions[key] ?? 0) + 1;
  show(key, null, IDLE);
  return cleared;
}

/** A fresh operation id the Worker accepts ([A-Za-z0-9_-]{8,64}). */
function newInstagramDmOperationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
