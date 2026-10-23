/**
 * ⚙️ Cloud workflow reconciliation controller (packet DT-7C-2C, planning/tools/38-cloud-workflows.md): UNCONSUMED.
 * Explicit, bounded reconciliation of verified full cloud receipts into the local drafts, over the accepted session
 * (`cloudWorkflowClient.ts`) and an injected persistence (the store's `cloudReconciliationPersistence`, or a test
 * double). Nothing imports it; constructing it makes no request and reads no storage.
 *
 *   reconcile  ONE `changes` page (limit ≤ 50) from the durable authority cursor; per item in `change_seq` order at most
 *              ONE full status (none when the item is already proven at or past its version). Compact items are
 *              discovery only: every adoption comes from a parser-verified full status receipt. Each item's durable
 *              handled result or recoverable pending record and the cursor advance to its sequence are ONE locked
 *              commit, so the cursor never passes an unrecorded item. Typed refusal / mismatch / absent / invalid ⇒
 *              pending, continue; transport uncertainty ⇒ pending, stop; proof-full, a moved fence or a persistence
 *              failure ⇒ stop with the cursor unchanged. No drain loop: `more` / `blocked` go back to the caller.
 *   check      ONE status for one occurrence key of the current authority (pending recovery, a journal entry, a proof,
 *              or an unknown id = initial proof); a row is committed, a pruned answer retires, absent writes nothing.
 *   ack        ONE acknowledgement, only after the store re-checked the durable proof under the lock (terminal, every
 *              output accounted for, owned outputs present, same proof bytes and generations) and built the request
 *              from the parser-branded receipt; the request starts synchronously inside that hold and is never awaited
 *              there. Nothing is written from an ack answer (an ack is never delivery evidence); a lost ack stays
 *              `unconfirmed` and can be checked (`check`) or repeated explicitly (idempotent on the Worker).
 *   fences     this controller's configuration/visit/handshake generations, a latest-action sequence, disposal and the
 *              store's in-memory configuration/visit fence; captured once per action, rechecked after every await and,
 *              through `live`, inside every locked commit/dispatch. A moved fence is `stale` with the session's own
 *              dispatched fact; nothing from a stale answer is committed.
 *   never      automatic action on construction/hydration/import/reset/reconnect/error, Submit/Run/Cancel/registration,
 *              retry, polling, background request, publish job, provider call or local execution.
 */

import {
  createCloudWorkflowSession,
  handshakeFailure,
  type ClientFetch,
  type ConfigureResult,
  type ExecuteResult,
  type RefusalReason,
  type UncertainCategory,
} from "./cloudWorkflowClient";
import {
  CHANGES_LIMIT_MAX,
  authorityOf,
  occurrenceKey,
  type Authority,
  type CloudRequest,
  type FeedItem,
  type OccurrenceBody,
  type Parsed,
} from "./cloudWorkflowProtocol";
import type { CloudFence, HandshakeResult } from "./cloudWorkflowOccurrenceClient";

/** What the durable state knows about one occurrence of the current authority (verified by the store). */
export interface LocalBinding {
  readonly journal?: { readonly body: OccurrenceBody; readonly payloadDigest: string };
  readonly proof?: {
    readonly payloadDigest: string;
    readonly receiptVersion: number;
    readonly terminal: boolean;
    readonly eligible: boolean;
  };
  readonly tombstone?: { readonly payloadDigest: string };
  readonly pending?: boolean;
  /** A stored proof or journal entry that failed re-verification now: never used, never overwritten. */
  readonly invalid?: boolean;
}
export interface ReconSnapshot {
  /** Opaque: the store's captured base, handed back to `commit`/`dispatchAck` (rechecked under the lock). */
  readonly base: object;
  readonly cursor: number;
  readonly local: Readonly<Record<string, LocalBinding>>;
}
export type SnapshotRead =
  | { readonly ok: true; readonly snapshot: ReconSnapshot }
  | { readonly ok: false; readonly reason: "unreadable" | "journal-unreadable" | "not-persisted" };

export interface FeedRef {
  readonly occurrenceId: string;
  readonly changeSeq: number;
  readonly receiptVersion: number;
  readonly payloadDigest: string;
}
export type CommitInput =
  | {
      readonly kind: "receipt" | "pruned";
      readonly parsed: Parsed;
      readonly request: CloudRequest;
      readonly cursor?: number;
    }
  | {
      readonly kind: "pending";
      readonly item: FeedRef;
      readonly reason: string;
      readonly cursor: number;
    }
  | { readonly kind: "cursor"; readonly cursor: number };
export type CommitChange =
  "bound" | "observed" | "proven" | "same" | "older" | "retired" | "none" | "pending" | "cursor";
export type CommitRefusal =
  | "stale"
  | "unreadable"
  | "journal-unreadable"
  | "retired"
  | "mismatch"
  | "conflict"
  | "proof-full"
  /** DT-7C-2C-R1: the tombstone bound is reached; retirement preserves all existing evidence (nothing written). */
  | "retirement-full"
  | "invalid"
  | "not-persisted"
  | "unsupported-save";
export type CommitOutcome =
  | {
      readonly ok: true;
      readonly change: CommitChange;
      readonly delivered?: boolean;
      readonly adopted?: number;
      readonly collisions?: readonly string[];
    }
  | { readonly ok: false; readonly reason: CommitRefusal };
export type AckRefusal =
  | "missing"
  | "retired"
  | "not-terminal"
  | "collision"
  | "inconsistent"
  | "stale"
  | "unreadable"
  | "journal-unreadable"
  | "invalid"
  | "not-persisted"
  | "unsupported-save";

export interface ReconciliationPersistence {
  fence(): CloudFence;
  /** The verified durable view for one authority: its cursor and the bindings of the asked occurrence ids. */
  snapshot(authority: Authority, occurrenceIds: readonly string[]): Promise<SnapshotRead>;
  /** One locked commit against `base` (`live()` is checked inside the hold: false = `stale`, nothing written). */
  commit(base: object, input: CommitInput, live: () => boolean): Promise<CommitOutcome>;
  /** Under the lock: eligibility re-checked, then `go(ack request)` runs synchronously inside the hold. */
  dispatchAck<T>(
    base: object,
    occurrenceId: string,
    go: (request: CloudRequest) => T | null,
  ): Promise<
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: AckRefusal | "superseded" }
  >;
}

export type ControlRefusal =
  | RefusalReason
  | "handshake_required"
  | "invalid_key"
  | "foreign_key"
  | "invalid_limit"
  | "not_eligible"
  | "unreadable"
  | "journal-unreadable"
  | "not-persisted"
  | AckRefusal;

export interface ItemResult {
  readonly occurrenceId: string;
  readonly changeSeq: number;
  readonly outcome: "bound" | "observed" | "proven" | "unchanged" | "retired" | "pending";
  /** Pending: why (the typed refusal, `mismatch`, `absent`, `invalid`, `unconfirmed:<category>`...). */
  readonly reason?: string;
  readonly collisions?: readonly string[];
}
export type ReconcileResult =
  | { readonly kind: "refused"; readonly reason: ControlRefusal; readonly dispatched: false }
  /** The changes request itself was refused by the Worker (typed, dispatched). */
  | { readonly kind: "rejected"; readonly parsed: Parsed }
  | {
      readonly kind: "page";
      /** The durable cursor after this call. */
      readonly cursor: number;
      readonly more: boolean;
      readonly items: readonly ItemResult[];
      readonly blocked: null | { readonly occurrenceId?: string; readonly reason: string };
    }
  | {
      readonly kind: "unconfirmed";
      readonly dispatched: boolean;
      readonly category: UncertainCategory;
    }
  | { readonly kind: "stale"; readonly dispatched: boolean; readonly items: readonly ItemResult[] };

export type CheckResult =
  | {
      readonly kind: "refused";
      readonly reason: ControlRefusal;
      readonly dispatched: false;
      readonly key?: string;
    }
  | {
      readonly kind: "answered";
      readonly key: string;
      readonly parsed: Parsed;
      readonly recorded: CommitOutcome | null;
    }
  | {
      readonly kind: "unconfirmed";
      readonly key: string;
      readonly dispatched: boolean;
      readonly category: UncertainCategory;
      readonly parsed?: Parsed;
    }
  | {
      readonly kind: "stale";
      readonly key: string;
      readonly dispatched: boolean;
      readonly recorded: CommitOutcome | null;
    };
export type AckResult =
  | {
      readonly kind: "refused";
      readonly reason: ControlRefusal;
      readonly dispatched: false;
      readonly key?: string;
    }
  | { readonly kind: "answered"; readonly key: string; readonly parsed: Parsed }
  | {
      readonly kind: "unconfirmed";
      readonly key: string;
      readonly dispatched: boolean;
      readonly category: UncertainCategory;
      readonly parsed?: Parsed;
    }
  | { readonly kind: "stale"; readonly key: string; readonly dispatched: boolean };

export interface ReconciliationController {
  configure(next: { origin: unknown; token: unknown }): ConfigureResult;
  invalidateVisit(): void;
  dispose(): void;
  handshake(): Promise<HandshakeResult>;
  reconcile(opts?: { limit?: number }): Promise<ReconcileResult>;
  check(key: unknown): Promise<CheckResult>;
  ack(key: unknown): Promise<AckResult>;
}

interface Ctx {
  readonly cfgGen: number;
  readonly visitGen: number;
  readonly authGen: number;
  readonly auth: Authority | null;
  readonly fence: CloudFence;
  seq: number;
}
const sameFence = (a: CloudFence, b: CloudFence) => a.config === b.config && a.visit === b.visit;
const ITEM_OUTCOME: Record<CommitChange, ItemResult["outcome"]> = {
  bound: "bound",
  observed: "observed",
  proven: "proven",
  same: "unchanged",
  older: "unchanged",
  none: "unchanged",
  cursor: "unchanged",
  retired: "retired",
  pending: "pending",
};
/** Commit refusals that are a durable fact about the item (recorded as pending); the rest stop the page. */
const ITEM_REFUSALS = new Set<string>(["mismatch", "conflict", "retired", "invalid"]);

/** The occurrence id of a key of exactly this authority, or why not. */
function idOfKey(
  key: unknown,
  a: Authority,
): { ok: true; id: string } | { ok: false; reason: ControlRefusal } {
  if (typeof key !== "string") return { ok: false, reason: "invalid_key" };
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return { ok: false, reason: "invalid_key" };
  }
  if (!Array.isArray(parts) || parts.length !== 3 || typeof parts[2] !== "string")
    return { ok: false, reason: "invalid_key" };
  const id = parts[2];
  const mine = occurrenceKey(a, id);
  if (!mine) return { ok: false, reason: "invalid_key" };
  return mine === key ? { ok: true, id } : { ok: false, reason: "foreign_key" };
}

export function createReconciliationController(deps: {
  fetch: ClientFetch;
  persistence: ReconciliationPersistence;
}): ReconciliationController {
  const session = createCloudWorkflowSession({ fetch: deps.fetch });
  const store = deps.persistence;
  let cfg: { origin: string; token: string } | null = null;
  let auth: Authority | null = null;
  let authFence: CloudFence | null = null;
  let cfgGen = 0;
  let visitGen = 0;
  let authGen = 0;
  let latest = 0;
  let disposed = false;

  const capture = (): Ctx => ({
    cfgGen,
    visitGen,
    authGen,
    auth,
    fence: store.fence(),
    seq: latest,
  });
  const holds = (c: Ctx): boolean =>
    !disposed &&
    c.cfgGen === cfgGen &&
    c.visitGen === visitGen &&
    c.authGen === authGen &&
    c.auth === auth &&
    c.seq === latest &&
    sameFence(c.fence, store.fence());

  function configure(next: { origin: unknown; token: unknown }): ConfigureResult {
    if (disposed) return { ok: false, reason: "disposed" };
    const origin = next?.origin;
    const token = next?.token;
    const r = session.configure({ origin, token });
    const target = r.ok ? { origin: r.origin, token: token as string } : null;
    const unchanged =
      cfg === target ||
      (cfg !== null &&
        target !== null &&
        cfg.origin === target.origin &&
        cfg.token === target.token);
    if (!unchanged) {
      cfgGen++;
      cfg = target;
      auth = null;
    }
    return r;
  }
  function invalidateVisit(): void {
    if (disposed) return;
    session.invalidateVisit();
    visitGen++;
    auth = null;
  }
  function dispose(): void {
    disposed = true;
    session.dispose();
    cfg = null;
    auth = null;
    cfgGen++;
    visitGen++;
  }
  async function handshake(): Promise<HandshakeResult> {
    if (disposed) return { ok: false, reason: "disposed" };
    if (!cfg) return { ok: false, reason: "not_configured" };
    const c = capture();
    c.seq = ++latest;
    const want = cfg.origin;
    const r = await session.handshake();
    if (!holds(c)) return { ok: false, reason: "stale" };
    if (
      r.kind === "answer" &&
      r.meta.installed === true &&
      r.parsed.outcome === "ok" &&
      r.parsed.kind === "authority"
    ) {
      const a = authorityOf(r.parsed.authority.origin, r.parsed.authority.ownerKey);
      if (!a || a.origin !== want) return { ok: false, reason: "invalid" };
      auth = a;
      authFence = c.fence;
      authGen++;
      return { ok: true, authority: a };
    }
    return { ok: false, reason: handshakeFailure(r) };
  }

  /** The common entry guard; on success the action owns the latest sequence. */
  function begin(): { ok: true; c: Ctx; a: Authority } | { ok: false; reason: ControlRefusal } {
    if (disposed) return { ok: false, reason: "disposed" };
    if (!cfg) return { ok: false, reason: "not_configured" };
    const c = capture();
    if (!c.auth) return { ok: false, reason: "no_authority" };
    if (!authFence || !sameFence(authFence, c.fence))
      return { ok: false, reason: "handshake_required" };
    return { ok: true, c, a: c.auth };
  }
  const lostReason = (): ControlRefusal => (disposed ? "disposed" : "superseded");

  async function reconcile(opts?: { limit?: number }): Promise<ReconcileResult> {
    const refused = (reason: ControlRefusal): ReconcileResult => ({
      kind: "refused",
      reason,
      dispatched: false,
    });
    const limit = opts?.limit ?? CHANGES_LIMIT_MAX;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > CHANGES_LIMIT_MAX)
      return refused("invalid_limit");
    const g = begin();
    if (!g.ok) return refused(g.reason);
    const { c, a } = g;
    c.seq = ++latest;
    const live = () => holds(c);

    const s0 = await store
      .snapshot(a, [])
      .catch((): SnapshotRead => ({ ok: false, reason: "not-persisted" }));
    if (!holds(c)) return refused(lostReason());
    if (!s0.ok) return refused(s0.reason);
    const after = s0.snapshot.cursor;
    const res = await session.execute({ kind: "changes", ownerKey: a.ownerKey, after, limit }, a);
    const items: ItemResult[] = [];
    if (res.kind === "refused")
      return holds(c) ? refused(res.reason) : { kind: "stale", dispatched: false, items };
    if (res.kind === "stale") return { kind: "stale", dispatched: res.dispatched, items };
    if (res.kind === "uncertain")
      return holds(c)
        ? { kind: "unconfirmed", dispatched: res.meta.dispatched, category: res.category }
        : { kind: "stale", dispatched: res.meta.dispatched, items };
    if (!holds(c)) return { kind: "stale", dispatched: true, items };
    const page = res.parsed;
    if (page.outcome !== "ok" || page.kind !== "changes") return { kind: "rejected", parsed: page };

    let cursor = after;
    const feed: readonly FeedItem[] = page.items;
    const done = (blocked: { occurrenceId?: string; reason: string } | null): ReconcileResult => ({
      kind: "page",
      cursor,
      more: page.more || items.length < feed.length,
      items,
      blocked,
    });
    if (!feed.length) return done(null);
    const snap = await store
      .snapshot(
        a,
        feed.map((i) => i.occurrenceId),
      )
      .catch((): SnapshotRead => ({ ok: false, reason: "not-persisted" }));
    if (!holds(c)) return { kind: "stale", dispatched: true, items };
    if (!snap.ok) return done({ reason: snap.reason });
    const { base, local } = snap.snapshot;

    for (const item of feed) {
      if (!holds(c)) return { kind: "stale", dispatched: true, items };
      const id = item.occurrenceId;
      const seq = item.changeSeq;
      const ref: FeedRef = {
        occurrenceId: id,
        changeSeq: seq,
        receiptVersion: item.receiptVersion,
        payloadDigest: item.payloadDigest,
      };
      const pending = (reason: string): CommitInput => ({
        kind: "pending",
        item: ref,
        reason,
        cursor: seq,
      });
      const l = local[id] ?? {};
      const known =
        l.journal?.payloadDigest ?? l.proof?.payloadDigest ?? l.tombstone?.payloadDigest;
      let input: CommitInput;
      let stopAfter: string | null = null;
      if (l.invalid) input = pending("invalid");
      else if (known !== undefined && known !== item.payloadDigest) input = pending("mismatch");
      else if (l.tombstone) input = pending("retired");
      else if (l.proof && l.proof.receiptVersion >= item.receiptVersion)
        input = { kind: "cursor", cursor: seq };
      else {
        const request: CloudRequest = {
          kind: "status",
          ownerKey: a.ownerKey,
          occurrenceId: id,
          expect: l.journal
            ? { body: l.journal.body, payloadDigest: l.journal.payloadDigest }
            : { payloadDigest: item.payloadDigest },
        };
        const r = await session.execute(request, a);
        if (r.kind === "stale" || !holds(c))
          return {
            kind: "stale",
            dispatched: r.kind === "refused" ? false : r.kind === "stale" ? r.dispatched : true,
            items,
          };
        if (r.kind === "refused") return done({ occurrenceId: id, reason: r.reason });
        if (r.kind === "uncertain") {
          stopAfter = `unconfirmed:${r.category}`;
          input = pending(stopAfter);
        } else {
          const p = r.parsed;
          if (p.outcome === "refused") input = pending(p.error);
          else if (p.outcome !== "ok" || p.kind !== "status") input = pending("invalid");
          else if (p.result.found === "row")
            input = { kind: "receipt", parsed: p, request, cursor: seq };
          else if (p.result.found === "pruned")
            input = { kind: "pruned", parsed: p, request, cursor: seq };
          else input = pending("absent");
        }
      }
      let out = await store
        .commit(base, input, live)
        .catch((): CommitOutcome => ({ ok: false, reason: "not-persisted" }));
      if (
        !out.ok &&
        (input.kind === "receipt" || input.kind === "pruned") &&
        ITEM_REFUSALS.has(out.reason)
      ) {
        const why = out.reason;
        if (!holds(c)) return { kind: "stale", dispatched: true, items };
        out = await store
          .commit(base, pending(why), live)
          .catch((): CommitOutcome => ({ ok: false, reason: "not-persisted" }));
        if (out.ok) out = { ok: true, change: "pending" };
        if (out.ok) {
          cursor = Math.max(cursor, seq);
          items.push({ occurrenceId: id, changeSeq: seq, outcome: "pending", reason: why });
          continue;
        }
      }
      if (!holds(c)) return { kind: "stale", dispatched: true, items };
      if (!out.ok) return done({ occurrenceId: id, reason: out.reason });
      cursor = Math.max(cursor, seq);
      items.push({
        occurrenceId: id,
        changeSeq: seq,
        outcome: ITEM_OUTCOME[out.change],
        ...(input.kind === "pending" ? { reason: input.reason } : {}),
        ...(out.collisions?.length ? { collisions: out.collisions } : {}),
      });
      if (stopAfter) return done({ occurrenceId: id, reason: stopAfter });
    }
    return done(null);
  }

  async function check(rawKey: unknown): Promise<CheckResult> {
    const refused = (reason: ControlRefusal, key?: string): CheckResult => ({
      kind: "refused",
      reason,
      dispatched: false,
      ...(key !== undefined ? { key } : {}),
    });
    const g = begin();
    if (!g.ok) return refused(g.reason);
    const { c, a } = g;
    const k = idOfKey(rawKey, a);
    if (!k.ok) return refused(k.reason);
    const key = rawKey as string;
    const id = k.id;
    c.seq = ++latest;
    const live = () => holds(c);
    const snap = await store
      .snapshot(a, [id])
      .catch((): SnapshotRead => ({ ok: false, reason: "not-persisted" }));
    if (!holds(c)) return refused(lostReason(), key);
    if (!snap.ok) return refused(snap.reason, key);
    const l = snap.snapshot.local[id] ?? {};
    if (l.invalid) return refused("invalid", key);
    const digest = l.journal?.payloadDigest ?? l.proof?.payloadDigest ?? l.tombstone?.payloadDigest;
    const request: CloudRequest = {
      kind: "status",
      ownerKey: a.ownerKey,
      occurrenceId: id,
      ...(l.journal
        ? { expect: { body: l.journal.body, payloadDigest: l.journal.payloadDigest } }
        : digest
          ? { expect: { payloadDigest: digest } }
          : {}),
    };
    const res: ExecuteResult = await session.execute(request, a);
    const stale = (dispatched: boolean, recorded: CommitOutcome | null = null): CheckResult => ({
      kind: "stale",
      key,
      dispatched,
      recorded,
    });
    if (res.kind === "refused") return holds(c) ? refused(res.reason, key) : stale(false);
    if (res.kind === "stale") return stale(res.dispatched);
    if (res.kind === "uncertain")
      return holds(c)
        ? {
            kind: "unconfirmed",
            key,
            dispatched: res.meta.dispatched,
            category: res.category,
            ...(res.parsed ? { parsed: res.parsed } : {}),
          }
        : stale(res.meta.dispatched);
    if (!holds(c)) return stale(true);
    const p = res.parsed;
    let recorded: CommitOutcome | null = null;
    if (p.outcome === "ok" && p.kind === "status" && p.result.found !== "absent")
      recorded = await store
        .commit(
          snap.snapshot.base,
          { kind: p.result.found === "row" ? "receipt" : "pruned", parsed: p, request },
          live,
        )
        .catch((): CommitOutcome => ({ ok: false, reason: "not-persisted" }));
    if (!holds(c)) return stale(true, recorded);
    return { kind: "answered", key, parsed: p, recorded };
  }

  async function ack(rawKey: unknown): Promise<AckResult> {
    const refused = (reason: ControlRefusal, key?: string): AckResult => ({
      kind: "refused",
      reason,
      dispatched: false,
      ...(key !== undefined ? { key } : {}),
    });
    const g = begin();
    if (!g.ok) return refused(g.reason);
    const { c, a } = g;
    const k = idOfKey(rawKey, a);
    if (!k.ok) return refused(k.reason);
    const key = rawKey as string;
    c.seq = ++latest;
    const snap = await store
      .snapshot(a, [k.id])
      .catch((): SnapshotRead => ({ ok: false, reason: "not-persisted" }));
    if (!holds(c)) return refused(lostReason(), key);
    if (!snap.ok) return refused(snap.reason, key);
    if (!snap.snapshot.local[k.id]?.proof?.eligible) return refused("not_eligible", key);
    const flight: { p?: Promise<ExecuteResult> } = {};
    let sent:
      | { readonly ok: true; readonly value: Promise<ExecuteResult> }
      | { readonly ok: false; readonly reason: AckRefusal | "superseded" };
    try {
      sent = await store.dispatchAck(snap.snapshot.base, k.id, (request) =>
        holds(c) ? (flight.p = session.execute(request, a)) : null,
      );
    } catch {
      sent = { ok: false, reason: "not-persisted" };
    }
    if (flight.p) sent = { ok: true, value: flight.p }; // a started request is never relabelled "not sent"
    if (!sent.ok)
      return sent.reason === "superseded" ? refused(lostReason(), key) : refused(sent.reason, key);
    const res = await sent.value;
    const stale = (dispatched: boolean): AckResult => ({ kind: "stale", key, dispatched });
    if (res.kind === "refused") return holds(c) ? refused(res.reason, key) : stale(false);
    if (res.kind === "stale") return stale(res.dispatched);
    if (res.kind === "uncertain")
      return holds(c)
        ? {
            kind: "unconfirmed",
            key,
            dispatched: res.meta.dispatched,
            category: res.category,
            ...(res.parsed ? { parsed: res.parsed } : {}),
          }
        : stale(res.meta.dispatched);
    if (!holds(c)) return stale(true);
    return { kind: "answered", key, parsed: res.parsed };
  }

  return { configure, invalidateVisit, dispose, handshake, reconcile, check, ack };
}
