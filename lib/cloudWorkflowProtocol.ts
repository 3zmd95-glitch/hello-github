/**
 * ⚙️ Cloud workflow browser protocol (packet DT-7C-1, planning/tools/38-cloud-workflows.md): PURE, unactivated.
 * Strict request descriptors and answer parsers for the Worker's `/social/workflows/*` surface. Nothing here fetches,
 * stores, reads a clock or knows a credential: a later packet owns transport, fences and the durable outbox.
 *
 *   authority   canonical HTTP(S) origin (captured by the caller; the Worker echoes `ownerKey`, never an origin) plus
 *               the server `ownerKey`. The parser does NOT prove the transport destination: it only binds the answer
 *               to the origin the caller says it asked.
 *   keys        `canonicalJson([origin, ownerKey])` / `canonicalJson([origin, ownerKey, occurrenceId])`: a JSON array
 *               of strings, so no delimiter ambiguity. No bearer or fingerprint ever enters a key or descriptor.
 *   requests    `describeRequest` -> `{ method, path (with query), body }` only: ids encoded, allowlisted fields,
 *               no header, no origin, no Authorization.
 *   answers     `parseAnswer` -> `ok` (validated success), `refused` (an error this operation may answer, typed and
 *               request-bound) or `invalid` (anything else: mixed error/success, unknown keys, foreign owner/id/
 *               epoch/digest, contradictory steps/outputs, wrong status code). Never a partial success.
 *   receipts    a FULL receipt (immutable body, payload digest, steps, outputs) recomputes the body and every output
 *               digest, links each output to its done step and `wf:<occurrence>:<action>` id, and validates the body
 *               at the receipt's own admission time (`createdAt`), not today's clock. A compact FEED item has no body:
 *               it proves no body/target binding and can never authorize an adoption or an acknowledgement (only
 *               receipts this module verified do: `ackRequestFor`, `adoptionProofOf`).
 *
 * The wire rules are the Worker's (workflowRoutes.ts/workflowCoordinator.ts/workflowProtocol.ts); the body/draft
 * validators, canonical JSON and digests are REUSED from workflowProtocol.ts (read-only import, no copy). The few
 * coordinator constants below cannot be imported (the coordinator is Worker-only): cloudWorkflowProtocol.wire.test.ts
 * pins them to the coordinator's exports so any drift fails.
 */

import {
  ACTION_KINDS,
  ACTIONS_MAX,
  canonicalJson,
  checkBody,
  DIGEST_RE,
  exactKeys,
  fits,
  isCount,
  isIso,
  isObj,
  isVersion,
  outputIdOf,
  OWNER_KEY_RE,
  payloadDigestOf,
  REQUEST_BYTES_MAX,
  sha256Hex,
  STEP_ERRORS,
  validDraft,
  validOutput,
  WF_ID_RE,
  type Obj,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";

export type { Obj, OccurrenceBody };

/* ---------- constants the coordinator owns (pinned by the wire test) ---------- */

export const EPOCHS_MAX = 50;
export const CHANGES_LIMIT_MAX = 50;
export const RUN_COMMITS_MAX = 5;
export const FINISH_RETENTION_MS = 180 * 86_400_000;
export const ACK_RETENTION_MS = 90 * 86_400_000;
const purgeAt = (finishedAt: number, firstAckAt: number | null) =>
  firstAckAt === null
    ? finishedAt + FINISH_RETENTION_MS
    : Math.min(finishedAt + FINISH_RETENTION_MS, firstAckAt + ACK_RETENTION_MS);

/* ---------- authority and keys ---------- */

export interface Authority {
  readonly origin: string;
  readonly ownerKey: string;
}

/** Plain `scheme://host[:port]` only: no credentials, query, fragment, path, backslash or whitespace. */
const ORIGIN_RE = /^https?:\/\/[^\s/?#\\@]+\/?$/i;

/**
 * The canonical origin of a configured Worker endpoint (lower-case scheme and host, default port removed, IDN as
 * ASCII), or null. A credential, query, fragment or any non-root path is REJECTED, never silently stripped.
 */
export function canonicalOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !ORIGIN_RE.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
    return u.origin === "null" ? null : u.origin;
  } catch {
    return null;
  }
}

/** The authority of a canonical origin and a server ownerKey, or null. */
export function authorityOf(origin: unknown, ownerKey: unknown): Authority | null {
  const o = canonicalOrigin(origin);
  return o !== null && fits(ownerKey, OWNER_KEY_RE) ? Object.freeze({ origin: o, ownerKey }) : null;
}

/** Unambiguous structured authority key. */
export const authorityKey = (a: Authority): string => canonicalJson([a.origin, a.ownerKey]);

/** Unambiguous structured authority + occurrence key, or null for an unsupported occurrence id. */
export const occurrenceKey = (a: Authority, occurrenceId: string): string | null =>
  fits(occurrenceId, WF_ID_RE) ? canonicalJson([a.origin, a.ownerKey, occurrenceId]) : null;

/* ---------- typed answer shapes ---------- */

export type WorkflowError =
  | "bad_request"
  | "unsupported_id"
  | "too_large"
  | "digest_mismatch"
  | "authority_mismatch"
  | "conflict"
  | "not_registered"
  | "unknown_epoch"
  | "registration_behind"
  | "capacity"
  | "pruned"
  | "absent"
  | "running"
  | "not_terminal"
  | "future_version"
  | "not_configured"
  | "receipt_unavailable"
  | "method_not_allowed";

export type OccurrenceState = "pending" | "running" | "done" | "partial" | "failed" | "cancelled";
export type StepStatus = "pending" | "done" | "failed" | "skipped";

export interface Registration {
  readonly workflowId: string;
  readonly registrationEpoch: number;
  readonly revision: number;
  readonly workflowDigest: string;
  readonly state: "active" | "unregistered";
  readonly paused: boolean;
  readonly updatedAt: string;
  readonly epochs: readonly { epoch: number; openedAt: string; closedAt?: string }[];
}

export interface ReceiptStep {
  readonly idx: number;
  readonly actionId: string;
  readonly kind: "idea" | "post" | "plan";
  readonly status: StepStatus;
  readonly outputId?: string;
  readonly outputDigest?: string;
  readonly error?: string;
  readonly at?: string;
}

export interface ReceiptOutput {
  readonly outputId: string;
  readonly actionId: string;
  readonly kind: "idea" | "post" | "plan";
  readonly digest: string;
  readonly record: Obj;
}

/** A complete, verified receipt: the only thing that can authorize an adoption or an acknowledgement. */
export interface FullReceipt {
  readonly occurrenceId: string;
  readonly workflowId: string;
  readonly kind: "manual" | "article-ready";
  readonly registrationEpoch: number;
  readonly revision: number;
  readonly body: OccurrenceBody;
  readonly payloadDigest: string;
  readonly state: OccurrenceState;
  readonly receiptVersion: number;
  readonly changeSeq: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly ackedVersion: number;
  readonly steps: readonly ReceiptStep[];
  readonly outputs: readonly ReceiptOutput[];
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly firstAckAt?: string;
  readonly purgeAt?: string;
}

/** A compact change-feed item: typed and linked, but body-free, so it proves no body/target binding. */
export interface FeedItem {
  readonly occurrenceId: string;
  readonly workflowId: string;
  readonly changeSeq: number;
  readonly state: OccurrenceState;
  readonly receiptVersion: number;
  readonly payloadDigest: string;
  readonly steps: readonly ReceiptStep[];
  readonly outputs?: readonly ReceiptOutput[];
}

/** What the caller already holds and wants the answer bound to (all optional, each exact). */
export interface ReceiptExpectation {
  readonly body?: OccurrenceBody;
  readonly payloadDigest?: string;
  readonly receiptVersion?: number;
  readonly outputIds?: readonly string[];
}

export type CloudRequest =
  | { kind: "authority" }
  | {
      kind: "register";
      ownerKey: string;
      workflowId: string;
      expectedEpoch: number;
      revision: number;
      workflowDigest: string;
    }
  | {
      kind: "update";
      ownerKey: string;
      workflowId: string;
      registrationEpoch: number;
      expectedRevision: number;
      revision: number;
      workflowDigest: string;
    }
  | {
      kind: "pause" | "resume" | "unregister";
      ownerKey: string;
      workflowId: string;
      registrationEpoch: number;
      expectedRevision: number;
    }
  | { kind: "submit"; body: OccurrenceBody; payloadDigest: string }
  | { kind: "status"; ownerKey: string; occurrenceId: string; expect?: ReceiptExpectation }
  | { kind: "cancel"; ownerKey: string; occurrenceId: string; expect?: ReceiptExpectation }
  | { kind: "run"; ownerKey: string; occurrenceId: string; expect?: ReceiptExpectation }
  | { kind: "ack"; ownerKey: string; occurrenceId: string; receiptVersion: number }
  | { kind: "changes"; ownerKey: string; after: number; limit?: number };

export type RequestKind = CloudRequest["kind"];

export type StatusFound =
  | { readonly found: "row"; readonly receipt: FullReceipt }
  | { readonly found: "absent"; readonly occurrenceId: string }
  | {
      readonly found: "pruned";
      readonly occurrenceId: string;
      readonly payloadDigest: string;
      readonly prunedAt: string;
    };

export type InvalidReason =
  | "origin"
  | "request"
  | "status"
  | "envelope"
  | "owner"
  | "binding"
  | "receipt"
  | "registration"
  | "feed"
  | "refusal";

export interface Invalid {
  readonly outcome: "invalid";
  readonly reason: InvalidReason;
}
export interface Refused {
  readonly outcome: "refused";
  readonly error: WorkflowError;
  readonly status: number;
  /** Present when the Worker echoed the ownerKey (every refusal except the bare ones). */
  readonly authority?: Authority;
  /** The refusal's typed extras: workflowId, occurrenceId, registration, payloadDigest, prunedAt, state, receiptVersion. */
  readonly fields: Readonly<Obj>;
}
export type Parsed =
  | { readonly outcome: "ok"; readonly kind: "authority"; readonly authority: Authority }
  | {
      readonly outcome: "ok";
      readonly kind: "register";
      readonly authority: Authority;
      readonly registration: Registration;
      readonly created: boolean;
    }
  | {
      readonly outcome: "ok";
      readonly kind: "update" | "pause" | "resume" | "unregister";
      readonly authority: Authority;
      readonly registration: Registration;
      readonly changed: boolean;
    }
  | {
      readonly outcome: "ok";
      readonly kind: "submit";
      readonly authority: Authority;
      readonly created: boolean;
      readonly receipt: FullReceipt;
    }
  | {
      readonly outcome: "ok";
      readonly kind: "status";
      readonly authority: Authority;
      readonly result: StatusFound;
    }
  | {
      readonly outcome: "ok";
      readonly kind: "cancel";
      readonly authority: Authority;
      readonly cancelled: boolean;
      readonly receipt: FullReceipt;
    }
  | {
      readonly outcome: "ok";
      readonly kind: "run";
      readonly authority: Authority;
      readonly committed: number;
      readonly stopped: "terminal" | "paused" | "limit" | "contention";
      readonly receipt: FullReceipt;
    }
  | {
      readonly outcome: "ok";
      readonly kind: "ack";
      readonly authority: Authority;
      readonly acknowledged: boolean;
      readonly occurrenceId: string;
      readonly receiptVersion: number;
      readonly ackedVersion: number;
      readonly firstAckAt?: string;
      readonly purgeAt: string;
    }
  | {
      readonly outcome: "ok";
      readonly kind: "changes";
      readonly authority: Authority;
      readonly items: readonly FeedItem[];
      readonly nextAfter: number;
      readonly more: boolean;
    }
  | Refused
  | Invalid;

/* ---------- request descriptors ---------- */

export interface Descriptor {
  readonly method: "GET" | "POST";
  /** Fixed route plus (GET only) the fixed query string. Relative to the Worker origin the caller captured. */
  readonly path: string;
  readonly body?: Obj;
}
export type Described =
  { readonly ok: true; readonly descriptor: Descriptor } | { readonly ok: false };

const enc = encodeURIComponent;
const BASE = "/social/workflows";

const isId = (v: unknown): v is string => fits(v, WF_ID_RE);
const isOwner = (v: unknown): v is string => fits(v, OWNER_KEY_RE);
const isDigest = (v: unknown): v is string => fits(v, DIGEST_RE);
const KEYS: Record<RequestKind, readonly [readonly string[], readonly string[]]> = {
  authority: [["kind"], []],
  register: [["kind", "ownerKey", "workflowId", "expectedEpoch", "revision", "workflowDigest"], []],
  update: [
    [
      "kind",
      "ownerKey",
      "workflowId",
      "registrationEpoch",
      "expectedRevision",
      "revision",
      "workflowDigest",
    ],
    [],
  ],
  pause: [["kind", "ownerKey", "workflowId", "registrationEpoch", "expectedRevision"], []],
  resume: [["kind", "ownerKey", "workflowId", "registrationEpoch", "expectedRevision"], []],
  unregister: [["kind", "ownerKey", "workflowId", "registrationEpoch", "expectedRevision"], []],
  submit: [["kind", "body", "payloadDigest"], []],
  status: [["kind", "ownerKey", "occurrenceId"], ["expect"]],
  cancel: [["kind", "ownerKey", "occurrenceId"], ["expect"]],
  run: [["kind", "ownerKey", "occurrenceId"], ["expect"]],
  ack: [["kind", "ownerKey", "occurrenceId", "receiptVersion"], []],
  changes: [["kind", "ownerKey", "after"], ["limit"]],
};

function expectationOk(e: unknown): boolean {
  if (e === undefined) return true;
  if (!isObj(e) || !exactKeys(e, [], ["body", "payloadDigest", "receiptVersion", "outputIds"]))
    return false;
  return (
    (e.body === undefined || (isObj(e.body) && checkBody(e.body, bodyNow(e.body)).ok)) &&
    (e.payloadDigest === undefined || isDigest(e.payloadDigest)) &&
    (e.receiptVersion === undefined || isVersion(e.receiptVersion)) &&
    (e.outputIds === undefined ||
      (Array.isArray(e.outputIds) && e.outputIds.every((i) => typeof i === "string")))
  );
}
/** The instant a body is admitted-checked at when only the caller's copy is known: its own executionAt. */
const bodyNow = (b: unknown): number =>
  isObj(b) && typeof b.executionAt === "string" ? Date.parse(b.executionAt) : Number.NaN;

/** The request descriptor (method, fixed route/query, allowlisted body) of a typed request, or `{ ok: false }`. */
export function describeRequest(req: CloudRequest): Described {
  const bad: Described = { ok: false };
  if (!isObj(req) || typeof req.kind !== "string" || !(req.kind in KEYS)) return bad;
  const [required, optional] = KEYS[req.kind as RequestKind];
  if (!exactKeys(req, required, optional)) return bad;
  const r = req as Obj;
  const done = (method: "GET" | "POST", path: string, body?: Obj): Described => ({
    ok: true,
    descriptor: Object.freeze({
      method,
      path,
      ...(body ? { body: freeze(cloneJson(body)) as Obj } : {}),
    }),
  });
  switch (req.kind) {
    case "authority":
      return done("GET", `${BASE}/authority`);
    case "register":
      if (!(
        isOwner(r.ownerKey) &&
        isId(r.workflowId) &&
        isCount(r.expectedEpoch) &&
        isVersion(r.revision) &&
        isDigest(r.workflowDigest)
      ))
        return bad;
      return done("POST", `${BASE}/registrations`, {
        ownerKey: r.ownerKey,
        workflowId: r.workflowId,
        expectedEpoch: r.expectedEpoch,
        revision: r.revision,
        workflowDigest: r.workflowDigest,
      });
    case "update":
      if (!(
        isOwner(r.ownerKey) &&
        isId(r.workflowId) &&
        isVersion(r.registrationEpoch) &&
        isCount(r.expectedRevision) &&
        isVersion(r.revision) &&
        isDigest(r.workflowDigest)
      ))
        return bad;
      return done("POST", `${BASE}/registrations/${enc(r.workflowId)}`, {
        ownerKey: r.ownerKey,
        registrationEpoch: r.registrationEpoch,
        expectedRevision: r.expectedRevision,
        revision: r.revision,
        workflowDigest: r.workflowDigest,
      });
    case "pause":
    case "resume":
    case "unregister":
      if (!(
        isOwner(r.ownerKey) &&
        isId(r.workflowId) &&
        isVersion(r.registrationEpoch) &&
        isCount(r.expectedRevision)
      ))
        return bad;
      return done("POST", `${BASE}/registrations/${enc(r.workflowId)}/${req.kind}`, {
        ownerKey: r.ownerKey,
        registrationEpoch: r.registrationEpoch,
        expectedRevision: r.expectedRevision,
      });
    case "submit": {
      if (!isObj(r.body) || !isDigest(r.payloadDigest)) return bad;
      if (!checkBody(r.body, bodyNow(r.body)).ok) return bad;
      const out = { body: r.body, payloadDigest: r.payloadDigest };
      // The Worker's 32 KiB streaming budget (a validated body is at most 16 KiB, so this is a backstop).
      if (new TextEncoder().encode(JSON.stringify(out)).length > REQUEST_BYTES_MAX) return bad;
      return done("POST", `${BASE}/occurrences`, out);
    }
    case "status":
    case "cancel":
    case "run":
    case "ack": {
      if (!isOwner(r.ownerKey) || !isId(r.occurrenceId) || !expectationOk(r.expect)) return bad;
      const base = `${BASE}/occurrences/${enc(r.occurrenceId)}`;
      if (req.kind === "status") return done("GET", `${base}?ownerKey=${enc(r.ownerKey)}`);
      if (req.kind === "ack") {
        if (!isVersion(r.receiptVersion)) return bad;
        return done("POST", `${base}/ack`, {
          ownerKey: r.ownerKey,
          receiptVersion: r.receiptVersion,
        });
      }
      return done("POST", `${base}/${req.kind}`, { ownerKey: r.ownerKey });
    }
    case "changes": {
      if (!isOwner(r.ownerKey) || !isCount(r.after) || r.after > 999_999_999_999_999) return bad;
      if (
        r.limit !== undefined &&
        !(
          Number.isSafeInteger(r.limit) &&
          (r.limit as number) >= 1 &&
          (r.limit as number) <= CHANGES_LIMIT_MAX
        )
      )
        return bad;
      const lim = r.limit === undefined ? "" : `&limit=${r.limit}`;
      return done("GET", `${BASE}/changes?ownerKey=${enc(r.ownerKey)}&after=${r.after}${lim}`);
    }
    default:
      return bad;
  }
}

/** A submit request for an admitted-shaped body: the payload digest is the canonical digest of that body. */
export async function submitRequestOf(
  body: unknown,
): Promise<{ readonly ok: true; readonly request: CloudRequest } | { readonly ok: false }> {
  if (!isObj(body) || !checkBody(body, bodyNow(body)).ok) return { ok: false };
  const copy = cloneJson(body) as unknown as OccurrenceBody;
  return {
    ok: true,
    request: { kind: "submit", body: copy, payloadDigest: await payloadDigestOf(copy) },
  };
}

/* ---------- plain-data helpers ---------- */

/** Deep copy of plain JSON data (null, boolean, string, finite number, array, plain object); throws otherwise. */
export function cloneJson(v: unknown, depth = 0): unknown {
  if (depth > 32) throw new TypeError("deep");
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError("number");
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => cloneJson(x, depth + 1));
  if (typeof v === "object" && v !== null) {
    const proto = Object.getPrototypeOf(v) as unknown;
    if (proto !== Object.prototype && proto !== null) throw new TypeError("proto");
    // fromEntries defines own data properties (a "__proto__" key stays a key).
    return Object.fromEntries(
      Object.keys(v).map((k) => [k, cloneJson((v as Obj)[k], depth + 1)] as const),
    );
  }
  throw new TypeError("unsupported");
}

/** Deep-freeze plain data (returns the same object). */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Obj)) deepFreeze(x);
  }
  return v;
}
const freeze = deepFreeze;

/* ---------- answer parsing ---------- */

class Bad extends Error {
  constructor(readonly why: InvalidReason) {
    super(why);
  }
}
function need(ok: boolean, why: InvalidReason = "envelope"): asserts ok {
  if (!ok) throw new Bad(why);
}

const STATUS: Record<WorkflowError, number> = {
  bad_request: 400,
  unsupported_id: 400,
  too_large: 413,
  digest_mismatch: 400,
  authority_mismatch: 409,
  conflict: 409,
  not_registered: 409,
  unknown_epoch: 409,
  registration_behind: 409,
  capacity: 409,
  pruned: 409,
  absent: 404,
  running: 409,
  not_terminal: 409,
  future_version: 409,
  not_configured: 503,
  receipt_unavailable: 503,
  method_not_allowed: 405,
};
/** Bare refusals: the Worker answers `{ error }` and nothing else (no ownerKey, no extras). */
const PURE = new Set<string>(["bad_request", "unsupported_id", "too_large", "authority_mismatch"]);
/** Answered by the router for any operation (request limits and service state), never by the coordinator. */
const ROUTER = new Set<string>([
  "bad_request",
  "unsupported_id",
  "too_large",
  "method_not_allowed",
  "receipt_unavailable",
  "not_configured",
]);
const REFUSAL_FIELDS: Record<string, readonly string[]> = {
  digest_mismatch: [],
  capacity: [],
  conflict: [],
  not_registered: ["workflowId"],
  unknown_epoch: ["workflowId"],
  registration_behind: ["workflowId"],
  pruned: ["occurrenceId", "payloadDigest", "prunedAt"],
  absent: ["occurrenceId"],
  running: ["occurrenceId"],
  not_terminal: ["occurrenceId", "state", "receiptVersion"],
  future_version: ["occurrenceId", "receiptVersion"],
};
const CONTROL_ERRORS = ["authority_mismatch", "not_registered", "conflict"];
/** The coordinator errors each operation can answer (workflowRoutes.ts OP_ERRORS). */
const OP_ERRORS: Record<RequestKind, readonly string[]> = {
  authority: [],
  submit: [
    "authority_mismatch",
    "digest_mismatch",
    "pruned",
    "conflict",
    "not_registered",
    "unknown_epoch",
    "registration_behind",
    "capacity",
  ],
  register: ["authority_mismatch", "conflict", "capacity"],
  update: CONTROL_ERRORS,
  pause: CONTROL_ERRORS,
  resume: CONTROL_ERRORS,
  unregister: CONTROL_ERRORS,
  status: ["authority_mismatch"],
  changes: ["authority_mismatch"],
  cancel: ["authority_mismatch", "pruned", "absent", "running"],
  ack: ["authority_mismatch", "pruned", "absent", "not_terminal", "future_version"],
  run: ["authority_mismatch", "pruned", "absent"],
};

const STATES = new Set(["pending", "running", "done", "partial", "failed", "cancelled"]);
const TERMINAL = new Set(["done", "partial", "failed", "cancelled"]);
const STEP_FAILURES: readonly unknown[] = [...STEP_ERRORS, "output-conflict"];
const RUN_STOPS: readonly unknown[] = ["terminal", "paused", "limit", "contention"];

/** The state/step table and receipt versions of the coordinator (workflowRoutes.ts STEP_TABLE). */
const STEP_TABLE: Record<
  string,
  { re: RegExp; version: (done: number, failed: number) => number }
> = {
  pending: { re: /^p+$/, version: () => 1 },
  running: { re: /^(d+p+|d+|d*fs*)$/, version: (d, f) => 1 + d + f },
  done: { re: /^d+$/, version: (d) => d + 2 },
  partial: { re: /^d+fs*$/, version: (d) => d + 3 },
  failed: { re: /^fs*$/, version: () => 3 },
  cancelled: { re: /^s+$/, version: () => 2 },
};

function stepsOk(
  steps: unknown,
  occurrenceId: string,
  state: string,
  version: unknown,
  body?: OccurrenceBody,
): steps is Obj[] {
  const table = STEP_TABLE[state];
  if (!table || !Array.isArray(steps) || steps.length < 1 || steps.length > ACTIONS_MAX)
    return false;
  if (body && steps.length !== body.snapshot.actions.length) return false;
  const ids = new Set<unknown>();
  let shape = "";
  for (const [idx, s] of steps.entries()) {
    if (
      !isObj(s) ||
      !exactKeys(
        s,
        ["idx", "actionId", "kind", "status"],
        ["outputId", "outputDigest", "error", "at"],
      ) ||
      s.idx !== idx ||
      !fits(s.actionId, WF_ID_RE) ||
      ids.has(s.actionId) ||
      !(ACTION_KINDS as readonly unknown[]).includes(s.kind) ||
      (body &&
        (s.actionId !== body.snapshot.actions[idx].id ||
          s.kind !== body.snapshot.actions[idx].kind))
    )
      return false;
    ids.add(s.actionId);
    const none = (...k: string[]) => k.every((key) => s[key] === undefined);
    const fields =
      s.status === "done"
        ? s.outputId === outputIdOf(occurrenceId, s.actionId as string) &&
          isDigest(s.outputDigest) &&
          isIso(s.at) &&
          none("error")
        : s.status === "failed"
          ? STEP_FAILURES.includes(s.error) && isIso(s.at) && none("outputId", "outputDigest")
          : (s.status === "pending" || s.status === "skipped") &&
            none("outputId", "outputDigest", "error", "at");
    if (!fields) return false;
    shape += (s.status as string)[0];
  }
  const count = (c: string) => shape.split(c).length - 1;
  return table.re.test(shape) && version === table.version(count("d"), count("f"));
}

async function outputsOk(
  outputs: unknown,
  steps: Obj[],
  draft: (record: unknown, step: Obj) => boolean,
): Promise<boolean> {
  const done = steps.filter((s) => s.status === "done");
  if (!Array.isArray(outputs) || outputs.length !== done.length) return false;
  for (const [n, o] of outputs.entries()) {
    const s = done[n];
    if (
      !isObj(o) ||
      !exactKeys(o, ["outputId", "actionId", "kind", "digest", "record"]) ||
      o.outputId !== s.outputId ||
      o.actionId !== s.actionId ||
      o.kind !== s.kind ||
      o.digest !== s.outputDigest ||
      !draft(o.record, s) ||
      (await sha256Hex(canonicalJson(o.record))) !== o.digest
    )
      return false;
  }
  return true;
}

function registrationOk(r: unknown, workflowId: string): r is Obj {
  if (!isObj(r)) return false;
  return (
    exactKeys(r, [
      "workflowId",
      "registrationEpoch",
      "revision",
      "workflowDigest",
      "state",
      "paused",
      "updatedAt",
      "epochs",
    ]) &&
    r.workflowId === workflowId &&
    isVersion(r.registrationEpoch) &&
    (r.registrationEpoch as number) <= EPOCHS_MAX &&
    isVersion(r.revision) &&
    isDigest(r.workflowDigest) &&
    (r.state === "active" || r.state === "unregistered") &&
    typeof r.paused === "boolean" &&
    isIso(r.updatedAt) &&
    Array.isArray(r.epochs) &&
    r.epochs.length === r.registrationEpoch &&
    r.epochs.every(
      (e: unknown, n: number, all: unknown[]) =>
        isObj(e) &&
        exactKeys(e, ["epoch", "openedAt"], ["closedAt"]) &&
        e.epoch === n + 1 &&
        isIso(e.openedAt) &&
        (e.closedAt === undefined || isIso(e.closedAt)) &&
        (e.closedAt !== undefined) === (n < all.length - 1 || r.state === "unregistered"),
    )
  );
}

/** Receipts this module verified (a shape alone is not proof: only membership is). */
const verified = new WeakSet<object>();

async function receiptOf(
  raw: unknown,
  ownerKey: string,
  occurrenceId: string,
  expect: ReceiptExpectation | undefined,
): Promise<FullReceipt> {
  need(isObj(raw), "receipt");
  const o = raw;
  need(
    exactKeys(
      o,
      [
        "occurrenceId",
        "workflowId",
        "kind",
        "registrationEpoch",
        "revision",
        "body",
        "payloadDigest",
        "state",
        "receiptVersion",
        "changeSeq",
        "createdAt",
        "updatedAt",
        "ackedVersion",
        "steps",
        "outputs",
      ],
      ["startedAt", "finishedAt", "firstAckAt", "purgeAt"],
    ) &&
      o.occurrenceId === occurrenceId &&
      STATES.has(o.state as string) &&
      isVersion(o.receiptVersion) &&
      isVersion(o.changeSeq) &&
      isDigest(o.payloadDigest) &&
      isIso(o.createdAt) &&
      isIso(o.updatedAt) &&
      isCount(o.ackedVersion),
    "receipt",
  );
  // The immutable body as admitted: the admission validator at the receipt's OWN admission time.
  const chk = checkBody(o.body, Date.parse(o.createdAt as string));
  need(chk.ok, "receipt");
  const body = chk.body;
  need(
    body.ownerKey === ownerKey &&
      body.occurrenceId === occurrenceId &&
      body.workflowId === o.workflowId &&
      body.kind === o.kind &&
      body.registrationEpoch === o.registrationEpoch &&
      body.revision === o.revision &&
      (await payloadDigestOf(body)) === o.payloadDigest,
    "receipt",
  );
  const v = o.receiptVersion as number;
  const acked = o.ackedVersion as number;
  if (o.state === "pending" || o.state === "running") {
    need(
      o.finishedAt === undefined &&
        o.purgeAt === undefined &&
        o.firstAckAt === undefined &&
        acked === 0 &&
        (o.state === "pending"
          ? o.startedAt === undefined && o.updatedAt === o.createdAt
          : isIso(o.startedAt)),
      "receipt",
    );
  } else {
    const firstAck = o.firstAckAt === undefined ? null : Date.parse(o.firstAckAt as string);
    need(
      isIso(o.finishedAt) &&
        o.updatedAt === o.finishedAt &&
        (o.state === "cancelled" ? o.startedAt === undefined : isIso(o.startedAt)) &&
        (acked === 0 || acked === v) &&
        (o.firstAckAt === undefined || isIso(o.firstAckAt)) &&
        (firstAck !== null) === acked >= 1 &&
        o.purgeAt === new Date(purgeAt(Date.parse(o.finishedAt as string), firstAck)).toISOString(),
      "receipt",
    );
  }
  need(stepsOk(o.steps, occurrenceId, o.state as string, v, body), "receipt");
  need(
    await outputsOk(o.outputs, o.steps as Obj[], (record, s) =>
      validOutput(record, body, s.idx as number),
    ),
    "receipt",
  );
  if (expect) {
    need(
      expect.body === undefined || canonicalJson(expect.body) === canonicalJson(body),
      "binding",
    );
    need(expect.payloadDigest === undefined || expect.payloadDigest === o.payloadDigest, "binding");
    need(expect.receiptVersion === undefined || expect.receiptVersion === v, "binding");
    need(
      expect.outputIds === undefined ||
        canonicalJson(expect.outputIds) ===
          canonicalJson((o.outputs as Obj[]).map((x) => x.outputId)),
      "binding",
    );
  }
  const receipt = freeze(o) as unknown as FullReceipt;
  verified.add(receipt);
  return receipt;
}

async function feedOk(x: Obj, ownerKey: string, after: number, limit: number): Promise<void> {
  need(
    exactKeys(x, ["ownerKey", "items", "nextAfter", "more"]) &&
      x.ownerKey === ownerKey &&
      Array.isArray(x.items) &&
      x.items.length <= limit &&
      typeof x.more === "boolean",
    "feed",
  );
  let seq = after;
  const ids = new Set<unknown>();
  for (const i of x.items as unknown[]) {
    need(
      isObj(i) &&
        exactKeys(
          i,
          [
            "occurrenceId",
            "workflowId",
            "changeSeq",
            "state",
            "receiptVersion",
            "payloadDigest",
            "steps",
          ],
          ["outputs"],
        ) &&
        fits(i.occurrenceId, WF_ID_RE) &&
        !ids.has(i.occurrenceId) &&
        fits(i.workflowId, WF_ID_RE) &&
        isVersion(i.changeSeq) &&
        (i.changeSeq as number) > seq &&
        STATES.has(i.state as string) &&
        isVersion(i.receiptVersion) &&
        isDigest(i.payloadDigest) &&
        stepsOk(i.steps, i.occurrenceId as string, i.state as string, i.receiptVersion) &&
        TERMINAL.has(i.state as string) === (i.outputs !== undefined),
      "feed",
    );
    // Body-free drafts: the feed proves no body/target binding (a full status receipt does).
    need(
      i.outputs === undefined ||
        (await outputsOk(i.outputs, i.steps as Obj[], (record, s) =>
          validDraft(record, s.kind as string, s.outputId as string),
        )),
      "feed",
    );
    ids.add(i.occurrenceId);
    seq = i.changeSeq as number;
  }
  need(x.nextAfter === seq && (x.items.length > 0 || x.more === false), "feed");
}

const ownerOf = (req: CloudRequest): string =>
  req.kind === "submit"
    ? (req.body.ownerKey as string)
    : req.kind === "authority"
      ? ""
      : req.ownerKey;

/** A typed refusal of this operation, bound to this request (workflowRoutes.ts `answer`). */
function refusalOf(req: CloudRequest, origin: string, status: number, x: Obj): Refused {
  const e = x.error;
  need(typeof e === "string" && e in STATUS, "refusal");
  const code = e as WorkflowError;
  need(ROUTER.has(code) || OP_ERRORS[req.kind].includes(code), "refusal");
  if (code === "not_configured") {
    need(
      exactKeys(x, ["error", "detail"]) && x.detail === "workflow-store" && status === 503,
      "refusal",
    );
    return Object.freeze({
      outcome: "refused",
      error: code,
      status,
      fields: freeze({ detail: x.detail }),
    });
  }
  if (PURE.has(code) || code === "method_not_allowed" || code === "receipt_unavailable") {
    need(exactKeys(x, ["error"]) && status === STATUS[code], "refusal");
    return Object.freeze({ outcome: "refused", error: code, status, fields: freeze({}) });
  }
  const owner = ownerOf(req);
  const submit = req.kind === "submit";
  const idRef =
    req.kind === "submit"
      ? req.body.occurrenceId
      : "occurrenceId" in req
        ? req.occurrenceId
        : undefined;
  const wfRef =
    req.kind === "submit" ? req.body.workflowId : "workflowId" in req ? req.workflowId : undefined;
  const allowed =
    code === "conflict" ? (submit ? ["occurrenceId"] : ["registration"]) : REFUSAL_FIELDS[code];
  need(exactKeys(x, ["error", "ownerKey", ...allowed]) && x.ownerKey === owner, "refusal");
  need(x.occurrenceId === undefined || x.occurrenceId === idRef, "refusal");
  need(x.workflowId === undefined || x.workflowId === wfRef, "refusal");
  if (x.registration !== undefined) {
    const r = x.registration as Obj | null;
    need(
      r === null ? conflictOk(req, null) : registrationOk(r, wfRef as string) && conflictOk(req, r),
      "refusal",
    );
  }
  need(
    (x.payloadDigest === undefined || isDigest(x.payloadDigest)) &&
      (x.prunedAt === undefined || isIso(x.prunedAt)) &&
      (x.receiptVersion === undefined || isVersion(x.receiptVersion)),
    "refusal",
  );
  if (code === "not_terminal")
    need(
      x.state === "pending"
        ? x.receiptVersion === 1
        : x.state === "running" && (x.receiptVersion as number) >= 2,
      "refusal",
    );
  if (code === "future_version")
    need(req.kind === "ack" && (x.receiptVersion as number) < req.receiptVersion, "refusal");
  // A pruned id answers 410 on cancel/ack/run (its row is gone), 409 on submit (never reusable).
  need(status === (code === "pruned" && !submit ? 410 : STATUS[code]), "status");
  const { error: _error, ownerKey: _owner, ...rest } = x;
  void _error;
  void _owner;
  return Object.freeze({
    outcome: "refused",
    error: code,
    status,
    authority: Object.freeze({ origin, ownerKey: owner }),
    fields: freeze(rest),
  });
}

/** The registration a request would have succeeded with / a conflict must not equal (workflowRoutes.ts). */
function appliedBy(req: CloudRequest, r: Obj): boolean {
  switch (req.kind) {
    case "register":
      return (
        r.state === "active" &&
        r.registrationEpoch === req.expectedEpoch + 1 &&
        r.revision === req.revision &&
        r.workflowDigest === req.workflowDigest
      );
    case "update":
      return (
        r.registrationEpoch === req.registrationEpoch &&
        r.state === "active" &&
        r.revision === req.revision &&
        r.workflowDigest === req.workflowDigest
      );
    case "pause":
    case "resume":
    case "unregister":
      return (
        r.registrationEpoch === req.registrationEpoch &&
        r.revision === req.expectedRevision &&
        (req.kind === "unregister"
          ? r.state === "unregistered"
          : r.paused === (req.kind === "pause"))
      );
    default:
      return false;
  }
}
function conflictOk(req: CloudRequest, r: Obj | null): boolean {
  if (req.kind === "register") {
    const epoch = req.expectedEpoch + 1;
    return r === null
      ? req.expectedEpoch !== 0
      : !appliedBy(req, r) && !(r.state === "unregistered" && r.registrationEpoch === epoch - 1);
  }
  if (r === null) return false;
  if (req.kind === "update")
    return (
      !appliedBy(req, r) &&
      !(
        r.registrationEpoch === req.registrationEpoch &&
        r.state === "active" &&
        r.revision === req.expectedRevision &&
        req.revision > req.expectedRevision
      )
    );
  if (req.kind === "pause" || req.kind === "resume" || req.kind === "unregister")
    return !(r.registrationEpoch === req.registrationEpoch && r.revision === req.expectedRevision);
  return false;
}

/** Own properties without the `undefined` ones: an explicit `undefined` optional key means "absent" everywhere here. */
const definedOnly = (o: Obj): Obj =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** A detached JSON copy of a request (and its `expect`); anything that is not plain data is an invalid request. */
export function detachRequest(req: CloudRequest): CloudRequest {
  try {
    need(isObj(req));
    const r = definedOnly(req as Obj);
    if (isObj(r.expect)) r.expect = definedOnly(r.expect);
    return cloneJson(r) as unknown as CloudRequest;
  } catch {
    throw new Bad("request");
  }
}

/**
 * Parse one Worker answer for the request that produced it. `ctx.origin` is the endpoint the CALLER says it asked
 * (captured context); the answer is bound to it, not proven to come from it. Never throws; never a partial success.
 */
export async function parseAnswer(
  request: CloudRequest,
  answer: { status: number; body: unknown },
  ctx: { origin: unknown },
): Promise<Parsed> {
  try {
    // DT-7C-1-R1: ONE detached copy of the request and every nested expectation (expected body, digest, version,
    // output ids, submit body), taken before the first await. Everything below validates, binds and returns from this
    // copy; the caller's objects are neither frozen nor read again, so editing them while digests are pending cannot
    // certify (or spoil) the answer.
    const req = detachRequest(request);
    const origin = canonicalOrigin(ctx?.origin);
    need(origin !== null, "origin");
    need(describeRequest(req).ok, "request");
    need(isObj(answer) && Number.isSafeInteger(answer.status), "status");
    const status = answer.status;
    const x = cloneJson(answer.body);
    need(isObj(x), "envelope");
    if ("error" in x) return refusalOf(req, origin, status, x);
    const owner = ownerOf(req);
    const authority = (ownerKey: string): Authority => Object.freeze({ origin, ownerKey });
    const ok = (v: object): Parsed => Object.freeze({ outcome: "ok", ...v }) as Parsed;
    need(status === 200 || (req.kind === "submit" && status === 201), "status");

    switch (req.kind) {
      case "authority": {
        need(exactKeys(x, ["ownerKey"]) && isOwner(x.ownerKey));
        return ok({ kind: "authority", authority: authority(x.ownerKey) });
      }
      case "register": {
        need(
          exactKeys(x, ["ownerKey", "registration", "created"]) &&
            x.ownerKey === owner &&
            typeof x.created === "boolean" &&
            registrationOk(x.registration, req.workflowId),
          "registration",
        );
        const r = x.registration as Obj;
        need(
          appliedBy(req, r) &&
            (!x.created || (r.epochs as Obj[])[req.expectedEpoch].openedAt === r.updatedAt),
          "registration",
        );
        return ok({
          kind: "register",
          authority: authority(owner),
          registration: freeze(r) as unknown as Registration,
          created: x.created,
        });
      }
      case "update":
      case "pause":
      case "resume":
      case "unregister": {
        need(
          exactKeys(x, ["ownerKey", "registration", "changed"]) &&
            x.ownerKey === owner &&
            typeof x.changed === "boolean" &&
            registrationOk(x.registration, req.workflowId),
          "registration",
        );
        const r = x.registration as Obj;
        need(appliedBy(req, r), "registration");
        // A changed update moved past the expected revision; a changed unregister closed the epoch now.
        need(
          !x.changed ||
            (req.kind === "update"
              ? req.revision > req.expectedRevision
              : req.kind !== "unregister" ||
                (r.epochs as Obj[])[req.registrationEpoch - 1].closedAt === r.updatedAt),
          "registration",
        );
        return ok({
          kind: req.kind,
          authority: authority(owner),
          registration: freeze(r) as unknown as Registration,
          changed: x.changed,
        });
      }
      case "submit": {
        need(exactKeys(x, ["ownerKey", "occurrence", "created"]) && x.ownerKey === owner);
        need(typeof x.created === "boolean" && status === (x.created ? 201 : 200), "status");
        const receipt = await receiptOf(x.occurrence, owner, req.body.occurrenceId, {
          body: req.body,
          payloadDigest: req.payloadDigest,
        });
        // A new row is the fresh pending receipt; a replay is the stored row in any state.
        need(
          !x.created || (receipt.state === "pending" && receipt.receiptVersion === 1),
          "receipt",
        );
        return ok({ kind: "submit", authority: authority(owner), created: x.created, receipt });
      }
      case "status": {
        need(x.ownerKey === owner);
        let result: StatusFound;
        if (exactKeys(x, ["ownerKey", "occurrence"])) {
          result = {
            found: "row",
            receipt: await receiptOf(x.occurrence, owner, req.occurrenceId, req.expect),
          };
        } else if (x.state === "absent") {
          need(
            exactKeys(x, ["ownerKey", "occurrenceId", "state"]) &&
              x.occurrenceId === req.occurrenceId,
          );
          result = { found: "absent", occurrenceId: req.occurrenceId };
        } else {
          need(
            x.state === "pruned" &&
              exactKeys(x, ["ownerKey", "occurrenceId", "state", "payloadDigest", "prunedAt"]) &&
              x.occurrenceId === req.occurrenceId &&
              isDigest(x.payloadDigest) &&
              isIso(x.prunedAt),
          );
          // A tombstone of other content than the caller holds is another occurrence under this id.
          need(
            req.expect?.payloadDigest === undefined || req.expect.payloadDigest === x.payloadDigest,
            "binding",
          );
          result = {
            found: "pruned",
            occurrenceId: req.occurrenceId,
            payloadDigest: x.payloadDigest as string,
            prunedAt: x.prunedAt as string,
          };
        }
        return ok({ kind: "status", authority: authority(owner), result: freeze(result) });
      }
      case "cancel": {
        need(exactKeys(x, ["ownerKey", "occurrence", "cancelled"]) && x.ownerKey === owner);
        need(typeof x.cancelled === "boolean");
        const receipt = await receiptOf(x.occurrence, owner, req.occurrenceId, req.expect);
        // cancelled: the cancelled receipt; not cancelled: a terminal row the coordinator left unchanged.
        need(x.cancelled ? receipt.state === "cancelled" : TERMINAL.has(receipt.state), "receipt");
        return ok({ kind: "cancel", authority: authority(owner), cancelled: x.cancelled, receipt });
      }
      case "run": {
        need(
          exactKeys(x, ["ownerKey", "occurrence", "committed", "stopped"]) && x.ownerKey === owner,
        );
        const c = x.committed;
        need(
          typeof c === "number" &&
            Number.isSafeInteger(c) &&
            c >= 0 &&
            c <= RUN_COMMITS_MAX &&
            RUN_STOPS.includes(x.stopped),
        );
        const receipt = await receiptOf(x.occurrence, owner, req.occurrenceId, req.expect);
        need(
          (x.stopped === "terminal") === TERMINAL.has(receipt.state) &&
            (x.stopped !== "paused" || (receipt.state === "pending" && c === 0)) &&
            (x.stopped !== "limit" || c === RUN_COMMITS_MAX) &&
            // Each commit resolved exactly one step (done or failed; a fail-fast skip is part of it).
            c <= receipt.steps.filter((s) => s.status === "done" || s.status === "failed").length,
          "receipt",
        );
        return ok({
          kind: "run",
          authority: authority(owner),
          committed: c,
          stopped: x.stopped as "terminal" | "paused" | "limit" | "contention",
          receipt,
        });
      }
      case "ack": {
        need(
          exactKeys(
            x,
            [
              "ownerKey",
              "occurrenceId",
              "acknowledged",
              "receiptVersion",
              "ackedVersion",
              "purgeAt",
            ],
            ["firstAckAt"],
          ) &&
            x.ownerKey === owner &&
            x.occurrenceId === req.occurrenceId &&
            typeof x.acknowledged === "boolean" &&
            isVersion(x.receiptVersion) &&
            isCount(x.ackedVersion) &&
            isIso(x.purgeAt) &&
            (x.firstAckAt === undefined || isIso(x.firstAckAt)),
        );
        const acked = x.ackedVersion as number;
        need(
          // A terminal row's version never moves: acknowledged at exactly that version or not at all; firstAckAt
          // exists exactly then and bounds the purge (<= firstAck + 90 d).
          (acked === 0 || acked === x.receiptVersion) &&
            (x.firstAckAt !== undefined) === acked >= 1 &&
            (x.firstAckAt === undefined ||
              Date.parse(x.purgeAt as string) <=
                Date.parse(x.firstAckAt as string) + ACK_RETENTION_MS) &&
            // Proof only for the exact version asked; a lower one proves nothing new.
            (x.acknowledged
              ? x.receiptVersion === req.receiptVersion && acked === req.receiptVersion
              : req.receiptVersion < (x.receiptVersion as number)),
          "binding",
        );
        return ok({
          kind: "ack",
          authority: authority(owner),
          acknowledged: x.acknowledged,
          occurrenceId: x.occurrenceId,
          receiptVersion: x.receiptVersion,
          ackedVersion: acked,
          ...(x.firstAckAt !== undefined ? { firstAckAt: x.firstAckAt } : {}),
          purgeAt: x.purgeAt,
        });
      }
      case "changes": {
        await feedOk(x, owner, req.after, req.limit ?? CHANGES_LIMIT_MAX);
        return ok({
          kind: "changes",
          authority: authority(owner),
          items: freeze(x.items) as unknown as FeedItem[],
          nextAfter: x.nextAfter,
          more: x.more,
        });
      }
      default:
        return { outcome: "invalid", reason: "request" };
    }
  } catch (e) {
    return { outcome: "invalid", reason: e instanceof Bad ? e.why : "envelope" };
  }
}

/* ---------- what a verified receipt (and only it) authorizes ---------- */

/** True only for a receipt `parseAnswer` returned: a feed item, or any look-alike object, never passes. */
export const isVerifiedReceipt = (v: unknown): v is FullReceipt =>
  typeof v === "object" && v !== null && verified.has(v);

/**
 * The acknowledgement request of a verified TERMINAL receipt at exactly its version, or null. A compact feed item
 * (no body/target binding) and a non-terminal receipt never authorize one.
 */
export function ackRequestFor(receipt: unknown): CloudRequest | null {
  if (!isVerifiedReceipt(receipt) || !TERMINAL.has(receipt.state)) return null;
  return {
    kind: "ack",
    ownerKey: receipt.body.ownerKey,
    occurrenceId: receipt.occurrenceId,
    receiptVersion: receipt.receiptVersion,
  };
}

/** The outputs a later adoption may write, from a verified TERMINAL receipt only; null otherwise. */
export function adoptionProofOf(receipt: unknown): {
  readonly occurrenceId: string;
  readonly receiptVersion: number;
  readonly payloadDigest: string;
  readonly outputs: readonly ReceiptOutput[];
} | null {
  if (!isVerifiedReceipt(receipt) || !TERMINAL.has(receipt.state)) return null;
  return Object.freeze({
    occurrenceId: receipt.occurrenceId,
    receiptVersion: receipt.receiptVersion,
    payloadDigest: receipt.payloadDigest,
    outputs: receipt.outputs,
  });
}

/* ---------- occurrence ids ---------- */

/** A manual occurrence id supplied fresh by the caller: the id alphabet, and never a reserved `ar-`/`sc-` prefix. */
export const isManualOccurrenceId = (id: unknown): id is string =>
  fits(id, WF_ID_RE) && !/^(ar|sc)-/.test(id);

const b64url = (hex: string): string => {
  let s = "";
  for (let i = 0; i < hex.length; i += 2)
    s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * The Ready occurrence id: `ar-` + unpadded base64url of all 32 SHA-256 bytes of
 * `canonicalJson([workflowId, articleId, readyCommitId])` (46 characters). Deterministic; a new Ready commit is a
 * new id; no truncation, colon or delimiter ambiguity. Null for an unsupported component.
 */
export async function readyOccurrenceId(
  workflowId: unknown,
  articleId: unknown,
  readyCommitId: unknown,
): Promise<string | null> {
  if (!isId(workflowId) || !isId(articleId)) return null;
  if (typeof readyCommitId !== "string" || readyCommitId.length < 1 || readyCommitId.length > 200)
    return null;
  return `ar-${b64url(await sha256Hex(canonicalJson([workflowId, articleId, readyCommitId])))}`;
}
