/**
 * ⚙️ Cloud workflow registration controller (packet DT-7C-2B-2, planning/tools/38-cloud-workflows.md): UNCONSUMED.
 * Register/unregister with a durable intent and explicit exact recovery, over the accepted session
 * (`cloudWorkflowClient.ts`) and an injected persistence (the store's `cloudRegistrationPersistence`, or a test double).
 * Nothing imports it; constructing it makes no request and reads no storage.
 *
 *   order     capture (synchronous: detached request, plain authority, generations) -> durable verified read ->
 *             locked CAS create (pending, exact read-back) -> locked CAS reservation (dispatching) -> ONE execute ->
 *             the outcome written to the ORIGINAL intent by CAS (operationId + attempt). A failed, unsupported or
 *             unreadable persistence step means zero mutation requests.
 *   fences    configuration (any actual origin/token change, A-B-A included), visit, dispose, the installed-authority
 *             generation and a latest-action sequence; rechecked after every await, inside every locked mutate and
 *             immediately before execute. A moved fence before execute sends nothing (a reservation is released as
 *             not dispatched); after execute the outcome is still recorded on its own intent and the caller gets
 *             `stale`. A saved intent is never retargeted to current settings.
 *   recovery  explicit only: the identical stored request, re-validated, after a handshake installed since this
 *             controller's last attempt for the key, whose authority equals the record's, and after a durable
 *             reservation; one recovery per key at a time here, and two tabs cannot reserve from the same base.
 *             Nothing replays on construction, reload, hydration, import, reset or a network error.
 *   no abort  this controller attaches no abort listener (no reentrant callback can launch a session action).
 */

import {
  createCloudWorkflowSession,
  type ClientFetch,
  type ConfigureResult,
  type ExecuteResult,
} from "./cloudWorkflowClient";
import { authorityOf, type Authority } from "./cloudWorkflowProtocol";
import {
  checkAnswer,
  createIntent,
  findRecord,
  isRecoverable,
  prepareIntent,
  recordOutcome,
  reserveAttempt,
  sameData,
  wireOf,
  type IntentState,
  type LifecycleRequest,
  type Outcome,
  type PersistFailure,
  type RegistrationPersistence,
  type RegistrationRecord,
} from "./cloudWorkflowRegistration";

export type { PersistFailure, RegistrationPersistence };

export type ControllerRefusal =
  | "disposed"
  | "not_configured"
  | "no_authority"
  | "invalid_request"
  | "foreign_owner"
  | "foreign_origin"
  | "superseded"
  | "unreadable"
  | "unresolved"
  | "capacity"
  | "missing"
  | "not_recoverable"
  | "busy"
  | "handshake_required"
  | "stale_record"
  | "not_persisted"
  | "unsupported_save";

export type ControllerResult =
  /** Nothing was sent. `key`/`operationId` name an intent that is durably saved (pending or recoverable). */
  | {
      readonly kind: "refused";
      readonly reason: ControllerRefusal;
      readonly dispatched: false;
      readonly key?: string;
      readonly operationId?: string;
    }
  /**
   * A fence moved (whatever happened is recorded on the original intent only), or the operation was replaced by a
   * newer intent on its key before its outcome arrived (DT-7C-2B-2-R1: nothing recorded, the newer record untouched).
   */
  | {
      readonly kind: "stale";
      readonly key: string;
      readonly operationId: string;
      readonly dispatched: boolean;
    }
  /** One attempt finished; `state` is the intent's durable state (`persisted: false`: it stayed dispatching). */
  | {
      readonly kind: "recorded";
      readonly key: string;
      readonly operationId: string;
      readonly state: IntentState;
      readonly dispatched: boolean;
      readonly persisted: boolean;
    };

export type HandshakeResult =
  | { readonly ok: true; readonly authority: Authority }
  | { readonly ok: false; readonly reason: string };

export interface RegistrationController {
  configure(next: { origin: unknown; token: unknown }): ConfigureResult;
  invalidateVisit(): void;
  dispose(): void;
  handshake(): Promise<HandshakeResult>;
  register(request: unknown): Promise<ControllerResult>;
  unregister(request: unknown, workflowDigest: unknown): Promise<ControllerResult>;
  recover(key: unknown): Promise<ControllerResult>;
}

interface Ctx {
  readonly cfgGen: number;
  readonly visitGen: number;
  readonly authGen: number;
  readonly auth: Authority | null;
  seq: number;
}

const refused = (
  reason: ControllerRefusal,
  key?: string,
  operationId?: string,
): ControllerResult => ({
  kind: "refused",
  reason,
  dispatched: false,
  ...(key ? { key, operationId } : {}),
});
const PERSIST: Record<PersistFailure["reason"], ControllerRefusal> = {
  "not-persisted": "not_persisted",
  "unsupported-save": "unsupported_save",
  "registrations-unreadable": "unreadable",
};
const sameRecord = (a: RegistrationRecord | undefined, b: RegistrationRecord | undefined) =>
  sameData(a ?? null, b ?? null);
type Step<T> = ({ ok: true } & T) | { ok: false; reason: ControllerRefusal };
/** A step's refusal, persistence failures included. */
const why = (r: { ok: false; reason: string }): ControllerRefusal =>
  r.reason in PERSIST
    ? PERSIST[r.reason as PersistFailure["reason"]]
    : (r.reason as ControllerRefusal);

export function createRegistrationController(deps: {
  fetch: ClientFetch;
  persistence: RegistrationPersistence;
  now?: () => Date;
  newId?: () => string;
}): RegistrationController {
  const session = createCloudWorkflowSession({ fetch: deps.fetch });
  const store = deps.persistence;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let cfg: { origin: string; token: string } | null = null;
  let auth: Authority | null = null;
  let cfgGen = 0;
  let visitGen = 0;
  let authGen = 0;
  let latest = 0;
  let disposed = false;
  /** key -> the authority generation this controller last dispatched an attempt of it under. */
  const attemptedUnder = new Map<string, number>();
  const recovering = new Set<string>();

  const capture = (): Ctx => ({ cfgGen, visitGen, authGen, auth, seq: latest });
  const holds = (c: Ctx): boolean =>
    !disposed &&
    c.cfgGen === cfgGen &&
    c.visitGen === visitGen &&
    c.authGen === authGen &&
    c.auth === auth &&
    c.seq === latest;
  /** The action takes the next sequence number: every older action's fence moves. */
  const take = (c: Ctx) => void (c.seq = ++latest);
  const lost = (): ControllerResult => refused(disposed ? "disposed" : "superseded");

  function configure(next: { origin: unknown; token: unknown }): ConfigureResult {
    if (disposed) return { ok: false, reason: "disposed" };
    // Each caller field is read exactly once; the session gets the same values.
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
    take(c);
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
      authGen++;
      return { ok: true, authority: a };
    }
    return { ok: false, reason: r.kind === "refused" ? r.reason : r.kind };
  }

  /** The outcome of one execute, as something the pure module records (answers re-parsed in their persisted form). */
  async function outcomeOf(
    res: ExecuteResult,
    request: LifecycleRequest,
    a: Authority,
  ): Promise<Outcome> {
    if (res.kind === "refused") return { kind: "not_dispatched" };
    if (res.kind === "stale" || res.kind === "uncertain")
      return res.meta.dispatched ? { kind: "uncertain" } : { kind: "not_dispatched" };
    const answer = wireOf(res.parsed);
    const parsed = answer && (await checkAnswer(request, answer, a));
    if (!answer || !parsed || !sameData(parsed, res.parsed)) return { kind: "uncertain" };
    return { kind: "answer", answer, parsed };
  }

  /** Reserve the next attempt of `expected` (CAS on the whole verified record), execute once, record the outcome. */
  async function dispatch(
    c: Ctx,
    expected: RegistrationRecord,
    request: LifecycleRequest,
  ): Promise<ControllerResult> {
    const { key } = expected;
    const op = expected.intent.operationId;
    const a = c.auth!;
    const reserved = await store.commit<Step<{ attempt: number }>>((fresh) => {
      if (!holds(c)) return { result: { ok: false, reason: "superseded" } };
      if (!sameRecord(findRecord(fresh, key), expected))
        return { result: { ok: false, reason: "stale_record" } };
      const r = reserveAttempt(fresh, key, expected.intent);
      if (!r.ok)
        return {
          result: { ok: false, reason: r.reason === "stale" ? "stale_record" : r.reason },
        };
      return { next: r.next, result: { ok: true, attempt: r.attempt } };
    });
    if (!reserved.ok)
      return reserved.reason === "superseded" // a fence moved under the lock: nothing was written
        ? { kind: "stale", key, operationId: op, dispatched: false }
        : refused(why(reserved), key, op);
    const attempt = reserved.attempt;
    attemptedUnder.set(key, c.authGen);
    const record = (o: Outcome) =>
      store.commit<{ ok: true; state: IntentState | null }>((fresh) => {
        const r = recordOutcome(fresh, key, op, attempt, o);
        return r.changed
          ? { next: r.next, result: { ok: true, state: r.state } }
          : { result: { ok: true, state: r.state } };
      });
    if (!holds(c)) {
      await record({ kind: "not_dispatched" });
      return { kind: "stale", key, operationId: op, dispatched: false };
    }
    const res = await session.execute(request, a);
    const o = await outcomeOf(res, request, a);
    const w = await record(o);
    const dispatched = o.kind !== "not_dispatched";
    // DT-7C-2B-2-R1: `state: null` = the operation is no longer the key's intent (another tab settled and replaced
    // it); nothing was written and there is no durable state of this operation to report.
    if (!holds(c) || (w.ok && w.state === null))
      return { kind: "stale", key, operationId: op, dispatched };
    return {
      kind: "recorded",
      key,
      operationId: op,
      state: w.ok && w.state ? w.state : "dispatching",
      dispatched,
      persisted: w.ok,
    };
  }

  /** A new intent: captured, validated, durably created (pending), then dispatched once. */
  async function begin(
    raw: unknown,
    digest: unknown,
    kind: LifecycleRequest["kind"],
  ): Promise<ControllerResult> {
    if (disposed) return refused("disposed");
    if (!cfg) return refused("not_configured");
    const c = capture();
    if (!c.auth) return refused("no_authority");
    const p = prepareIntent(raw, c.auth, digest); // caller accessors run here, after the capture
    if (!holds(c)) return lost();
    if (!p.ok) return refused(p.reason === "foreign_owner" ? "foreign_owner" : "invalid_request");
    if (p.request.kind !== kind) return refused("invalid_request");
    take(c);
    const operationId = newId();
    const createdAt = now().toISOString();
    const cur = await store.read();
    if (!holds(c)) return lost();
    if (!cur) return refused("unreadable");
    const before = findRecord(cur, p.key);
    const pre = createIntent(cur, p, operationId, createdAt);
    if (!pre.ok) return refused(pre.reason);
    const made = await store.commit<Step<{ record: RegistrationRecord }>>((fresh) => {
      if (!holds(c)) return { result: { ok: false, reason: "superseded" } };
      if (!sameRecord(findRecord(fresh, p.key), before))
        return { result: { ok: false, reason: "stale_record" } };
      const r = createIntent(fresh, p, operationId, createdAt);
      return r.ok
        ? { next: r.next, result: { ok: true, record: r.record } }
        : { result: { ok: false, reason: r.reason } };
    });
    if (!made.ok) return made.reason === "superseded" ? lost() : refused(why(made));
    // Durable and read back: from here on a moved fence leaves the intent pending (explicit recovery later).
    if (!holds(c)) return { kind: "stale", key: p.key, operationId, dispatched: false };
    return dispatch(c, made.record, p.request);
  }

  async function recover(rawKey: unknown): Promise<ControllerResult> {
    if (disposed) return refused("disposed");
    if (!cfg) return refused("not_configured");
    const c = capture();
    if (!c.auth) return refused("no_authority");
    if (typeof rawKey !== "string") return refused("invalid_request");
    const key = rawKey;
    if (attemptedUnder.get(key) === c.authGen) return refused("handshake_required");
    if (recovering.has(key)) return refused("busy");
    take(c);
    recovering.add(key);
    try {
      const cur = await store.read();
      if (!holds(c)) return lost();
      if (!cur) return refused("unreadable");
      const rec = findRecord(cur, key);
      if (!rec) return refused("missing");
      if (rec.origin !== c.auth.origin) return refused("foreign_origin");
      if (rec.ownerKey !== c.auth.ownerKey) return refused("foreign_owner");
      const i = rec.intent;
      if (!isRecoverable(i)) return refused("not_recoverable");
      // The identical stored request, re-validated: never rebuilt, retargeted or given a new epoch/revision/body.
      const p = prepareIntent(i.request, c.auth, i.workflowDigest);
      if (!p.ok || p.key !== key || p.path !== i.path || !sameData(p.body, i.body))
        return refused("invalid_request");
      return await dispatch(c, rec, p.request);
    } finally {
      recovering.delete(key);
    }
  }

  return {
    configure,
    invalidateVisit,
    dispose,
    handshake,
    register: (request) => begin(request, undefined, "register"),
    unregister: (request, workflowDigest) => begin(request, workflowDigest, "unregister"),
    recover,
  };
}
