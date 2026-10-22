/**
 * ⚙️ Cloud workflow registration intents (packet DT-7C-2B-2, planning/tools/38-cloud-workflows.md): PURE, unconsumed.
 * The durable browser record of one register/unregister decision per workflow and what the Worker answered for it.
 * Nothing here fetches, stores, reads a clock or knows a credential: `store/index.ts` persists it under the shared
 * `3z-prod-articles` lock and `cloudWorkflowRegistrationClient.ts` drives it. Observed registration only — never
 * ownership or delivery.
 *
 *   key       `canonicalJson([origin, ownerKey, workflowId])`: the canonical origin the caller asked, the server
 *             ownerKey a handshake returned and the workflow id. Records never merge or retarget across keys.
 *   intent    immutable identity (seq, operationId, createdAt, the exact validated request, its descriptor path/body,
 *             revision, digest) plus progress (state, attempts, maybeApplied, reservedFrom, the deciding answer).
 *             One unresolved intent per key. States: pending -> dispatching -> settled | uncertain | refused |
 *             divergent (the full table is in the DT-7C-2B-2 handoff record). A typed refusal never clears an earlier
 *             uncertainty; only a bound ok answer for the identical request settles it.
 *   last      the newest bound registration observation of the key, monotonic by (epoch, active < unregistered,
 *             revision, updatedAt); equal order with other content is a contradiction.
 *   proof     answers are kept as plain wire JSON and accepted only after `verifyRegistrations` re-parses them
 *             through the pinned `parseAnswer` (Parsed.authority + request binding). No serialized brand is trusted.
 *   capacity  100 keys; a new key at the cap is refused, an existing key keeps working; no eviction.
 */

import {
  DIGEST_RE,
  WF_ID_RE,
  canonicalJson,
  exactKeys,
  fits,
  isCount,
  isIso,
  isObj,
  isVersion,
  type Obj,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityKey,
  authorityOf,
  cloneJson,
  deepFreeze,
  describeRequest,
  detachRequest,
  parseAnswer,
  type Authority,
  type CloudRequest,
  type Parsed,
} from "./cloudWorkflowProtocol";

export const REGISTRATION_CAPACITY = 100;

export interface RegisterRequest {
  readonly kind: "register";
  readonly ownerKey: string;
  readonly workflowId: string;
  readonly expectedEpoch: number;
  readonly revision: number;
  readonly workflowDigest: string;
}
export interface UnregisterRequest {
  readonly kind: "unregister";
  readonly ownerKey: string;
  readonly workflowId: string;
  readonly registrationEpoch: number;
  readonly expectedRevision: number;
}
export type LifecycleRequest = RegisterRequest | UnregisterRequest;

export type IntentState =
  "pending" | "dispatching" | "settled" | "uncertain" | "refused" | "divergent";
const STATES: readonly unknown[] = [
  "pending",
  "dispatching",
  "settled",
  "uncertain",
  "refused",
  "divergent",
];
/** States a reservation may start from (the explicit recovery set plus the first dispatch). */
const RESERVABLE: readonly unknown[] = ["pending", "dispatching", "uncertain", "divergent"];

/** One Worker answer exactly as the wire carried it (plain JSON; untrusted until re-parsed). */
export interface WireAnswer {
  readonly status: number;
  readonly body: Obj;
}

export interface Intent {
  readonly seq: number;
  readonly operationId: string;
  readonly createdAt: string;
  readonly request: LifecycleRequest;
  readonly path: string;
  readonly body: Obj;
  readonly revision: number;
  readonly workflowDigest: string;
  readonly state: IntentState;
  readonly attempts: number;
  /** Some finished attempt was dispatched without a definitive answer of its own. */
  readonly maybeApplied: boolean;
  /** The state a live reservation started from (dispatching only). */
  readonly reservedFrom: IntentState | null;
  readonly answer: WireAnswer | null;
}

export interface Observed {
  readonly request: LifecycleRequest;
  readonly answer: WireAnswer;
}

export interface RegistrationRecord {
  readonly key: string;
  readonly origin: string;
  readonly ownerKey: string;
  readonly workflowId: string;
  readonly intent: Intent;
  readonly last: Observed | null;
}

export interface CloudRegistrations {
  readonly v: 1;
  /** Bumped by every changing commit. */
  readonly generation: number;
  readonly records: readonly RegistrationRecord[];
}

export const emptyRegistrations = (): CloudRegistrations => ({ v: 1, generation: 0, records: [] });

/** Canonical equality of plain data (false for anything canonical JSON cannot carry). */
export const sameData = (a: unknown, b: unknown): boolean => {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
};
const same = sameData;
const isToken = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= 200;

/** The structured key, or null for an unsupported workflow id. */
export const registrationKey = (a: Authority, workflowId: unknown): string | null =>
  fits(workflowId, WF_ID_RE) ? canonicalJson([a.origin, a.ownerKey, workflowId]) : null;

export const findRecord = (s: CloudRegistrations, key: string): RegistrationRecord | undefined =>
  s.records.find((r) => r.key === key);

/** A key with this intent accepts no new intent: its outcome may still change. */
export const isUnresolved = (i: Intent): boolean =>
  i.state === "pending" ||
  i.state === "dispatching" ||
  i.state === "uncertain" ||
  (i.state === "divergent" && i.maybeApplied);
/** Explicit recovery (the identical request again) is allowed exactly for unresolved intents. */
export const isRecoverable = isUnresolved;

/* ---------- capture and validation (sync) ---------- */

export type Prepared = {
  readonly ok: true;
  readonly key: string;
  readonly origin: string;
  readonly ownerKey: string;
  readonly workflowId: string;
  readonly request: LifecycleRequest;
  readonly path: string;
  readonly body: Obj;
  readonly revision: number;
  readonly workflowDigest: string;
};

/**
 * A detached, frozen, validated lifecycle request for `authority` (plain data captured once: later edits of the caller's
 * object change nothing). Unregister needs the digest of the revision it unregisters; a register's digest is its own.
 * Never throws.
 */
export function prepareIntent(
  raw: unknown,
  authority: Authority,
  digest?: unknown,
): Prepared | { readonly ok: false; readonly reason: "invalid" | "foreign_owner" } {
  const invalid = { ok: false, reason: "invalid" } as const;
  try {
    const req = detachRequest(raw as CloudRequest) as unknown as Obj;
    if (req.kind !== "register" && req.kind !== "unregister") return invalid;
    const d = describeRequest(req as unknown as CloudRequest);
    if (!d.ok || d.descriptor.method !== "POST" || !d.descriptor.body) return invalid;
    if (req.ownerKey !== authority.ownerKey) return { ok: false, reason: "foreign_owner" };
    const register = req.kind === "register";
    if (register && digest !== undefined && digest !== req.workflowDigest) return invalid;
    const workflowDigest = register ? req.workflowDigest : digest;
    if (!fits(workflowDigest, DIGEST_RE)) return invalid;
    const key = registrationKey(authority, req.workflowId);
    if (!key) return invalid;
    return {
      ok: true,
      key,
      origin: authority.origin,
      ownerKey: authority.ownerKey,
      workflowId: req.workflowId as string,
      request: deepFreeze(req) as unknown as LifecycleRequest,
      path: d.descriptor.path,
      body: cloneJson(d.descriptor.body) as Obj,
      revision: (register ? req.revision : req.expectedRevision) as number,
      workflowDigest,
    };
  } catch {
    return invalid;
  }
}

/* ---------- structural parse (sync) ---------- */

const answerShapeOk = (a: unknown): a is WireAnswer =>
  isObj(a) && exactKeys(a, ["status", "body"]) && Number.isSafeInteger(a.status) && isObj(a.body);

function requestOk(req: unknown, r: Obj): req is LifecycleRequest {
  if (!isObj(req) || (req.kind !== "register" && req.kind !== "unregister")) return false;
  return (
    describeRequest(req as unknown as CloudRequest).ok &&
    req.ownerKey === r.ownerKey &&
    req.workflowId === r.workflowId
  );
}

function intentOk(i: unknown, r: Obj): i is Intent {
  if (
    !isObj(i) ||
    !exactKeys(i, [
      "seq",
      "operationId",
      "createdAt",
      "request",
      "path",
      "body",
      "revision",
      "workflowDigest",
      "state",
      "attempts",
      "maybeApplied",
      "reservedFrom",
      "answer",
    ])
  )
    return false;
  if (!isVersion(i.seq) || !isToken(i.operationId) || !isIso(i.createdAt)) return false;
  if (!requestOk(i.request, r)) return false;
  const req = i.request;
  const d = describeRequest(req as unknown as CloudRequest);
  if (!d.ok || d.descriptor.path !== i.path || !same(d.descriptor.body, i.body)) return false;
  const register = req.kind === "register";
  if (i.revision !== (register ? req.revision : req.expectedRevision)) return false;
  if (!fits(i.workflowDigest, DIGEST_RE) || (register && i.workflowDigest !== req.workflowDigest))
    return false;
  const s = i.state;
  if (!STATES.includes(s) || !isCount(i.attempts) || typeof i.maybeApplied !== "boolean")
    return false;
  if (s === "dispatching" ? !RESERVABLE.includes(i.reservedFrom) : i.reservedFrom !== null)
    return false;
  if (s !== "pending" && i.attempts < 1) return false;
  if (s === "refused" && i.maybeApplied) return false;
  if (s === "settled" && i.maybeApplied) return false;
  if (s === "uncertain" && !i.maybeApplied) return false;
  if (i.answer !== null && !answerShapeOk(i.answer)) return false;
  if ((s === "settled" || s === "refused" || s === "divergent") && i.answer === null) return false;
  return true;
}

function recordOk(r: unknown): r is RegistrationRecord {
  if (!isObj(r) || !exactKeys(r, ["key", "origin", "ownerKey", "workflowId", "intent", "last"]))
    return false;
  const a = authorityOf(r.origin, r.ownerKey);
  if (!a || a.origin !== r.origin || r.key !== registrationKey(a, r.workflowId)) return false;
  if (!intentOk(r.intent, r)) return false;
  const l = r.last;
  return (
    l === null ||
    (isObj(l) &&
      exactKeys(l, ["request", "answer"]) &&
      requestOk(l.request, r) &&
      answerShapeOk(l.answer))
  );
}

/**
 * The registrations a stored/imported value holds, as a detached copy, or null when it is not exactly that (unknown
 * keys, a retargeted key, a foreign owner, a descriptor that is not the request's, a duplicate, over capacity...).
 * Answers are re-parsed asynchronously by `verifyRegistrations`.
 */
export function parseRegistrations(raw: unknown): CloudRegistrations | null {
  let s: unknown;
  try {
    s = cloneJson(raw);
  } catch {
    return null;
  }
  if (!isObj(s) || !exactKeys(s, ["v", "generation", "records"]) || s.v !== 1) return null;
  if (!isCount(s.generation) || !Array.isArray(s.records)) return null;
  if (s.records.length > REGISTRATION_CAPACITY) return null;
  let prev = "";
  for (const r of s.records as unknown[]) {
    if (!recordOk(r) || r.key <= prev) return null; // sorted, unique
    prev = r.key;
  }
  return s as unknown as CloudRegistrations;
}

/** A stored slice: absent is empty (never saved); anything else must parse (null = unreadable). */
export const readRegistrations = (raw: unknown): CloudRegistrations | null =>
  raw === undefined ? emptyRegistrations() : parseRegistrations(raw);

/* ---------- answers (async re-parse through the pinned parser) ---------- */

/** The wire answer a parser result came from (ok register/unregister or a typed refusal), or null. */
export function wireOf(p: Parsed): WireAnswer | null {
  if (p.outcome === "ok" && (p.kind === "register" || p.kind === "unregister")) {
    const flag = p.kind === "register" ? { created: p.created } : { changed: p.changed };
    return {
      status: 200,
      body: {
        ownerKey: p.authority.ownerKey,
        registration: cloneJson(p.registration) as Obj,
        ...flag,
      },
    };
  }
  if (p.outcome === "refused")
    return {
      status: p.status,
      body: {
        error: p.error,
        ...(p.authority ? { ownerKey: p.authority.ownerKey } : {}),
        ...(cloneJson(p.fields) as Obj),
      },
    };
  return null;
}

/** The answer re-parsed for its request at the record's authority, or null when it is not a bound answer now. */
export async function checkAnswer(
  request: LifecycleRequest,
  answer: WireAnswer,
  authority: Authority,
): Promise<Parsed | null> {
  const p = await parseAnswer(request as unknown as CloudRequest, answer, {
    origin: authority.origin,
  });
  if (p.outcome === "invalid") return null;
  if (p.outcome === "ok" && p.kind !== request.kind) return null;
  if (p.authority && authorityKey(p.authority) !== authorityKey(authority)) return null;
  return p;
}

const isConflict = (p: Parsed) => p.outcome === "refused" && p.error === "conflict";
const registrationIn = (a: WireAnswer): Obj | null =>
  isObj(a.body.registration) ? a.body.registration : null;

/** Every stored answer and observation passes the pinned parser now and fits its state. */
export async function verifyRegistrations(s: CloudRegistrations): Promise<boolean> {
  for (const r of s.records) {
    const auth = authorityOf(r.origin, r.ownerKey);
    if (!auth) return false;
    const i = r.intent;
    if (i.answer) {
      const p = await checkAnswer(i.request, i.answer, auth);
      if (!p) return false;
      const fits =
        i.state === "settled"
          ? p.outcome === "ok" &&
            (i.request.kind !== "unregister" ||
              registrationIn(i.answer)?.workflowDigest === i.workflowDigest)
          : i.state === "refused" || i.state === "uncertain"
            ? p.outcome === "refused" && !isConflict(p)
            : i.state === "divergent"
              ? p.outcome === "ok" || isConflict(p)
              : i.state === "dispatching";
      if (!fits) return false;
    }
    if (r.last) {
      const p = await checkAnswer(r.last.request, r.last.answer, auth);
      if (!p || !(p.outcome === "ok" || isConflict(p)) || !registrationIn(r.last.answer))
        return false;
    }
  }
  return true;
}

/** Exact read-back: the stored slice is, canonically, the one a commit wrote. */
export const registrationsIs = (stored: unknown, expected: CloudRegistrations): boolean =>
  stored !== undefined && same(stored, expected);

/* ---------- the persistence contract (implemented by store/index.ts) ---------- */

export type PersistFailure = {
  readonly ok: false;
  readonly reason: "not-persisted" | "unsupported-save" | "registrations-unreadable";
};
/** A verified durable read and one serialized compare-and-set transaction with an exact read-back. */
export interface RegistrationPersistence {
  read(): Promise<CloudRegistrations | null>;
  commit<T>(
    mutate: (
      fresh: CloudRegistrations,
    ) => { readonly next: CloudRegistrations; readonly result: T } | { readonly result: T },
  ): Promise<T | PersistFailure>;
}

/* ---------- transitions (sync, pure) ---------- */

const put = (s: CloudRegistrations, rec: RegistrationRecord): CloudRegistrations => ({
  ...s,
  generation: s.generation + 1,
  records: [...s.records.filter((r) => r.key !== rec.key), rec].sort((x, y) =>
    x.key < y.key ? -1 : 1,
  ),
});

/** A new pending intent (the caller validated it with `prepareIntent`). */
export function createIntent(
  s: CloudRegistrations,
  p: Prepared,
  operationId: string,
  createdAt: string,
):
  | { readonly ok: true; readonly next: CloudRegistrations; readonly record: RegistrationRecord }
  | { readonly ok: false; readonly reason: "unresolved" | "capacity" } {
  const cur = findRecord(s, p.key);
  if (cur && isUnresolved(cur.intent)) return { ok: false, reason: "unresolved" };
  if (!cur && s.records.length >= REGISTRATION_CAPACITY) return { ok: false, reason: "capacity" };
  const record: RegistrationRecord = {
    key: p.key,
    origin: p.origin,
    ownerKey: p.ownerKey,
    workflowId: p.workflowId,
    intent: {
      seq: (cur?.intent.seq ?? 0) + 1,
      operationId,
      createdAt,
      request: cloneJson(p.request) as unknown as LifecycleRequest,
      path: p.path,
      body: cloneJson(p.body) as Obj,
      revision: p.revision,
      workflowDigest: p.workflowDigest,
      state: "pending",
      attempts: 0,
      maybeApplied: false,
      reservedFrom: null,
      answer: null,
    },
    last: cur?.last ?? null,
  };
  return { ok: true, next: put(s, record), record };
}

/** Compare-and-set reservation of the next attempt (first dispatch or explicit recovery). */
export function reserveAttempt(
  s: CloudRegistrations,
  key: string,
  base: { readonly operationId: string; readonly attempts: number; readonly state: IntentState },
):
  | { readonly ok: true; readonly next: CloudRegistrations; readonly attempt: number }
  | { readonly ok: false; readonly reason: "missing" | "stale" | "not_recoverable" } {
  const cur = findRecord(s, key);
  if (!cur) return { ok: false, reason: "missing" };
  const i = cur.intent;
  if (i.operationId !== base.operationId || i.attempts !== base.attempts || i.state !== base.state)
    return { ok: false, reason: "stale" };
  if (!isRecoverable(i)) return { ok: false, reason: "not_recoverable" };
  const attempt = i.attempts + 1;
  const intent: Intent = {
    ...i,
    state: "dispatching",
    attempts: attempt,
    reservedFrom: i.state,
    // The attempt a crashed/other dispatch left behind may have gone out.
    maybeApplied: i.maybeApplied || i.state === "dispatching",
  };
  return { ok: true, next: put(s, { ...cur, intent }), attempt };
}

/** What one attempt produced: a parser-validated answer (see `checkAnswer`), or no definitive answer. */
export type Outcome =
  | { readonly kind: "answer"; readonly answer: WireAnswer; readonly parsed: Parsed }
  | { readonly kind: "uncertain" }
  | { readonly kind: "not_dispatched" };

/** `b` relative to `a` (two registration snapshots of one workflow and authority). */
export function compareRegistrations(a: Obj, b: Obj): "older" | "same" | "newer" | "conflict" {
  const order = (r: Obj) => [
    r.registrationEpoch as number,
    r.state === "unregistered" ? 1 : 0,
    r.revision as number,
    Date.parse(r.updatedAt as string),
  ];
  const [x, y] = [order(a), order(b)];
  for (let n = 0; n < x.length; n++) if (x[n] !== y[n]) return y[n] > x[n] ? "newer" : "older";
  return same(a, b) ? "same" : "conflict";
}

/** `last` with an observation folded in; `undefined` = an equal-order contradiction. */
function foldLast(last: Observed | null, o: Observed | null): Observed | null | undefined {
  const next = o && registrationIn(o.answer);
  if (!o || !next) return last;
  const prev = last && registrationIn(last.answer);
  if (!last || !prev) return o;
  const order = compareRegistrations(prev, next);
  return order === "conflict" ? undefined : order === "newer" ? o : last;
}

type Recorded =
  | { readonly changed: true; readonly next: CloudRegistrations; readonly state: IntentState }
  | {
      readonly changed: false;
      readonly state: IntentState | null;
      readonly reason: "stale" | "same";
    };

/**
 * One attempt's outcome written to its ORIGINAL intent (operationId + attempt). A bound ok answer settles any
 * unresolved intent (it proves the identical request applied); every other outcome only moves the latest live
 * reservation. Anything else (another operation, an older attempt, a resolved intent) writes nothing.
 */
export function recordOutcome(
  s: CloudRegistrations,
  key: string,
  operationId: string,
  attempt: number,
  o: Outcome,
): Recorded {
  const cur = findRecord(s, key);
  if (!cur || cur.intent.operationId !== operationId)
    return { changed: false, state: null, reason: "stale" };
  const i = cur.intent;
  const stale: Recorded = { changed: false, state: i.state, reason: "stale" };
  const write = (patch: Partial<Intent>, last = cur.last): Recorded => {
    const intent: Intent = { ...i, reservedFrom: null, ...patch };
    return { changed: true, next: put(s, { ...cur, intent, last }), state: intent.state };
  };
  const observed = (a: WireAnswer): Observed => ({ request: i.request, answer: a });

  if (o.kind === "answer" && o.parsed.outcome === "ok") {
    if (i.state === "settled")
      return same(i.answer, o.answer) ? { changed: false, state: i.state, reason: "same" } : stale;
    if (!isUnresolved(i) || attempt < 1 || attempt > i.attempts) return stale;
    const folded = foldLast(cur.last, observed(o.answer));
    const reg = registrationIn(o.answer);
    const digestOk = i.request.kind !== "unregister" || reg?.workflowDigest === i.workflowDigest;
    const settled = folded !== undefined && digestOk;
    return write(
      { state: settled ? "settled" : "divergent", maybeApplied: false, answer: o.answer },
      folded === undefined ? cur.last : folded,
    );
  }
  if (i.state !== "dispatching" || i.attempts !== attempt) return stale;
  const from = i.reservedFrom;
  if (o.kind === "not_dispatched")
    return write({ state: from === "dispatching" ? "uncertain" : (from as IntentState) });
  if (o.kind === "uncertain")
    return write({ state: from === "divergent" ? "divergent" : "uncertain", maybeApplied: true });
  if (isConflict(o.parsed)) {
    const folded = foldLast(cur.last, observed(o.answer));
    return write(
      { state: "divergent", answer: o.answer },
      folded === undefined ? cur.last : folded,
    );
  }
  // A typed refusal of this attempt: clean only when no earlier attempt may have applied.
  if (!i.maybeApplied) return write({ state: "refused", answer: o.answer });
  return from === "divergent"
    ? write({ state: "divergent" })
    : write({ state: "uncertain", answer: o.answer });
}

/* ---------- import merge (sync, pure) ---------- */

const RANK: Record<IntentState, number> = {
  pending: 0,
  dispatching: 1,
  uncertain: 1,
  refused: 2,
  divergent: 3,
  settled: 4,
};
const IDENTITY = [
  "seq",
  "operationId",
  "createdAt",
  "request",
  "path",
  "body",
  "revision",
  "workflowDigest",
] as const;

/** Two copies of the same intent, merged monotonically; null = contradiction. */
function mergeProgress(a: Intent, b: Intent): Intent | null {
  if (same(a, b)) return a;
  if (a.state === "settled" && b.state === "settled") {
    const x = registrationIn(a.answer!);
    const y = registrationIn(b.answer!);
    return x && y && compareRegistrations(x, y) === "conflict" ? null : a;
  }
  const win = RANK[b.state] > RANK[a.state] ? b : a;
  const maybe = win.state !== "settled" && (a.maybeApplied || b.maybeApplied);
  const state: IntentState = win.state === "refused" && maybe ? "uncertain" : win.state;
  return {
    ...win,
    state,
    attempts: Math.max(a.attempts, b.attempts),
    maybeApplied: maybe,
    reservedFrom: state === "dispatching" ? win.reservedFrom : null,
  };
}

function mergeRecord(cur: RegistrationRecord, imp: RegistrationRecord): RegistrationRecord | null {
  const last = cur.last && imp.last ? foldLast(cur.last, imp.last) : (cur.last ?? imp.last);
  if (last === undefined) return null;
  const a = cur.intent;
  const b = imp.intent;
  let intent: Intent | null = a;
  if (a.seq === b.seq) {
    if (IDENTITY.some((k) => !same(a[k], b[k]))) return null;
    intent = mergeProgress(a, b);
  } else if (b.seq > a.seq) intent = isUnresolved(a) ? null : b; // never over local unresolved work
  // b.seq < a.seq: an older backup never resurrects a decision this device moved past.
  return intent && { ...cur, intent, last };
}

/**
 * An imported slice merged into the fresh durable one (see the module header and the handoff record): keys of both
 * are kept; one key's copies merge monotonically; an identity/intent contradiction refuses the whole merge
 * (`conflict`, with the keys); a union over capacity refuses it. Unchanged: `changed: false`, the fresh slice itself.
 */
export function mergeRegistrations(
  fresh: CloudRegistrations,
  imported: CloudRegistrations,
):
  | { readonly ok: true; readonly next: CloudRegistrations; readonly changed: boolean }
  | {
      readonly ok: false;
      readonly reason: "conflict" | "capacity";
      readonly keys: readonly string[];
    } {
  const byKey = new Map(fresh.records.map((r) => [r.key, r]));
  const contradicted: string[] = [];
  for (const r of imported.records) {
    const cur = byKey.get(r.key);
    const merged = cur ? mergeRecord(cur, r) : r;
    if (merged) byKey.set(r.key, merged);
    else contradicted.push(r.key);
  }
  if (contradicted.length) return { ok: false, reason: "conflict", keys: contradicted.sort() };
  if (byKey.size > REGISTRATION_CAPACITY) return { ok: false, reason: "capacity", keys: [] };
  const records = [...byKey.values()].sort((x, y) => (x.key < y.key ? -1 : 1));
  if (same(records, fresh.records)) return { ok: true, next: fresh, changed: false };
  return {
    ok: true,
    next: { ...fresh, generation: fresh.generation + 1, records },
    changed: true,
  };
}
