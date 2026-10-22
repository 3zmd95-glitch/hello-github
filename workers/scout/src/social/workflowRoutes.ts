/**
 * ⚙️ Cloud workflow routes (packet DT-7B, planning/tools/38-cloud-workflows.md): the authenticated surface of the
 * WorkflowCoordinator. scout.ts has already checked the origin and the bearer (as for every /social/* route).
 *
 *   GET  /social/workflows/authority                                   → { ownerKey }
 *   POST /social/workflows/registrations          { ownerKey, workflowId, expectedEpoch, revision, workflowDigest }
 *   POST /social/workflows/registrations/:id      { ownerKey, registrationEpoch, expectedRevision, revision,
 *                                                   workflowDigest }   (the update; POST, since the Worker's CORS
 *                                                   answer allows GET, POST, DELETE only)
 *   POST /social/workflows/registrations/:id/{pause,resume,unregister} { ownerKey, registrationEpoch, expectedRevision }
 *   POST /social/workflows/occurrences            { body, payloadDigest }   (the ownerKey is inside the body)
 *   GET  /social/workflows/occurrences/:id?ownerKey=                   → full receipt | absent | pruned
 *   POST /social/workflows/occurrences/:id/cancel { ownerKey }
 *   POST /social/workflows/occurrences/:id/ack    { ownerKey, receiptVersion }
 *   POST /social/workflows/occurrences/:id/run    { ownerKey }   (DT-7B-2: run or resume, no query string)
 *   GET  /social/workflows/changes?ownerKey=&after=&limit=             → { ownerKey, items, nextAfter, more }
 *
 * Requests: a 32 KiB streaming budget (413 too_large before any coordinator call), exact key sets, strict query
 * strings (no unknown or repeated parameter), ids `^[A-Za-z0-9_-]{1,64}$` (else unsupported_id). Only `run` executes
 * anything: it names the occurrence and the ownerKey, nothing else; the coordinator's fixed server builder (the
 * dashboard's real draft builders) does the work. No route commits a caller's step, output or finish, and nothing
 * here reads a header, field or parameter that could choose a builder, output, snapshot, clock or retry policy.
 * Answers (DT-7B-R1: complete, request-bound proof): every success echoes the ownerKey and the addressed id and is
 * checked against the coordinator's own semantics —
 *   receipt    the whole immutable body re-checked with the admission validator at its own admission time
 *              (`createdAt`), its payload digest recomputed, its identity bound to the receipt's fields, the
 *              state/step/output table below, every output an exact allowlisted draft with its digest recomputed;
 *   feed item  every step and output typed and linked, the same state table, draft digests recomputed. A feed item
 *              has no body, so it proves no body/target binding: the full status receipt stays the authority;
 *   mutation   bound to the request (epoch, revision, digest, paused flag, state, cancel/ack outcome);
 *   run        (DT-7B-2) `{ ownerKey, occurrence, committed, stopped }` exactly: the full receipt above, committed an
 *              integer 0..RUN_COMMITS_MAX and at most the resolved (done/failed) steps, stopped terminal exactly
 *              when the receipt is terminal, paused only on a pending receipt with nothing committed, limit only
 *              with RUN_COMMITS_MAX commits.
 * Coordinator refusals pass only as the operation's own errors with typed, request-bound extras (the ownerKey added
 * once the coordinator has accepted it). Anything else — an error mixed with proof, another ownerKey, another
 * occurrence, a malformed or contradictory receipt, page or refusal — is 503 receipt_unavailable, with no part of the
 * answer echoed and no further coordinator call. The object is always WORKFLOW_OBJECT (server-selected).
 */

import { readCapped } from "./instagramPublicSend";
import {
  ACK_RETENTION_MS,
  purgeAt,
  WORKFLOW_OBJECT,
  CHANGES_LIMIT_MAX,
  EPOCHS_MAX,
  RUN_COMMITS_MAX,
} from "./workflowCoordinator";
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
} from "./workflowProtocol";

export interface WorkflowReply {
  json(body: unknown, status: number): Response;
}

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

/** Coordinator refusals: their exact extra fields. Errors before the authority check carry nothing more. */
const PURE = new Set(["bad_request", "unsupported_id", "too_large", "authority_mismatch"]);
const REFUSAL_FIELDS: Record<string, readonly string[]> = {
  bad_request: [],
  unsupported_id: [],
  too_large: [],
  authority_mismatch: [],
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

type Kind =
  | "authority"
  | "register"
  | "update"
  | "pause"
  | "resume"
  | "unregister"
  | "submit"
  | "status"
  | "cancel"
  | "ack"
  | "run"
  | "changes";

/** DT-7B-R1: the errors each coordinator operation can answer (workflowCoordinator.ts `call` and its op). */
const CONTROL_ERRORS = ["bad_request", "authority_mismatch", "not_registered", "conflict"];
const OP_ERRORS: Record<Kind, readonly string[]> = {
  authority: [],
  submit: [
    "bad_request",
    "unsupported_id",
    "too_large",
    "authority_mismatch",
    "digest_mismatch",
    "pruned",
    "conflict",
    "not_registered",
    "unknown_epoch",
    "registration_behind",
    "capacity",
  ],
  register: ["bad_request", "authority_mismatch", "conflict", "capacity"],
  update: CONTROL_ERRORS,
  pause: CONTROL_ERRORS,
  resume: CONTROL_ERRORS,
  unregister: CONTROL_ERRORS,
  status: ["bad_request", "authority_mismatch"],
  changes: ["bad_request", "authority_mismatch"],
  cancel: ["bad_request", "authority_mismatch", "pruned", "absent", "running"],
  ack: ["bad_request", "authority_mismatch", "pruned", "absent", "not_terminal", "future_version"],
  run: ["bad_request", "authority_mismatch", "pruned", "absent"],
};
/** DT-7B-2: why a `run` call stopped (workflowCoordinator.ts `run`). */
const RUN_STOPS: readonly unknown[] = ["terminal", "paused", "limit", "contention"];

function kindOf(rest: string[]): { kind: Kind; id?: string } | null {
  const [family, id, verb, extra] = rest;
  if (extra !== undefined) return null;
  if (family === "authority" && id === undefined) return { kind: "authority" };
  if (family === "changes" && id === undefined) return { kind: "changes" };
  if (family === "registrations") {
    if (id === undefined) return { kind: "register" };
    if (verb === undefined) return { kind: "update", id };
    return verb === "pause" || verb === "resume" || verb === "unregister"
      ? { kind: verb, id }
      : null;
  }
  if (family === "occurrences") {
    if (id === undefined) return { kind: "submit" };
    if (verb === undefined) return { kind: "status", id };
    return verb === "cancel" || verb === "ack" || verb === "run" ? { kind: verb, id } : null;
  }
  return null;
}

const GET: ReadonlySet<Kind> = new Set(["authority", "status", "changes"]);
/** Exact request keys of each POST. */
const KEYS: Partial<Record<Kind, readonly string[]>> = {
  register: ["ownerKey", "workflowId", "expectedEpoch", "revision", "workflowDigest"],
  update: ["ownerKey", "registrationEpoch", "expectedRevision", "revision", "workflowDigest"],
  pause: ["ownerKey", "registrationEpoch", "expectedRevision"],
  resume: ["ownerKey", "registrationEpoch", "expectedRevision"],
  unregister: ["ownerKey", "registrationEpoch", "expectedRevision"],
  submit: ["body", "payloadDigest"],
  cancel: ["ownerKey"],
  ack: ["ownerKey", "receiptVersion"],
  run: ["ownerKey"],
};
/** Exact query parameters of each GET (required, optional). */
const QUERY: Partial<Record<Kind, [readonly string[], readonly string[]]>> = {
  authority: [[], []],
  status: [["ownerKey"], []],
  changes: [["ownerKey", "after"], ["limit"]],
};

class Refused extends Error {
  constructor(readonly code: WorkflowError) {
    super(code);
  }
}

async function readBody(req: Request): Promise<Obj> {
  let text: string | null;
  try {
    text = await readCapped(req.body, REQUEST_BYTES_MAX);
  } catch {
    throw new Refused("bad_request");
  }
  if (text === null) throw new Refused("too_large");
  try {
    const v = JSON.parse(text) as unknown;
    if (isObj(v)) return v;
  } catch {
    /* refused below */
  }
  throw new Refused("bad_request");
}

function readQuery(url: URL, required: readonly string[], optional: readonly string[]): Obj {
  const out: Obj = {};
  for (const [k, v] of url.searchParams) {
    if ((!required.includes(k) && !optional.includes(k)) || k in out)
      throw new Refused("bad_request");
    out[k] = v;
  }
  if (!required.every((k) => k in out)) throw new Refused("bad_request");
  return out;
}

const INT_RE = /^(0|[1-9]\d{0,14})$/;
const need = (ok: boolean) => {
  if (!ok) throw new Refused("bad_request");
};
const needId = (v: unknown) => {
  need(typeof v === "string");
  if (!WF_ID_RE.test(v as string)) throw new Refused("unsupported_id");
};
const isOwner = (v: unknown): v is string => fits(v, OWNER_KEY_RE);
const isDigest = (v: unknown): v is string => fits(v, DIGEST_RE);

/* ---------- answer shapes ---------- */

const STATES = new Set(["pending", "running", "done", "partial", "failed", "cancelled"]);
const TERMINAL = new Set(["done", "partial", "failed", "cancelled"]);
/** What a failed step may carry: a builder error, or the store's own output-conflict. */
const STEP_FAILURES: readonly unknown[] = [...STEP_ERRORS, "output-conflict"];

/**
 * DT-7B-R1: the coordinator's state/step table (submit, commitStep, finish, cancel in workflowCoordinator.ts), over
 * the step statuses as letters (pending, done, failed, skipped), with the receipt version each path reaches: 1 at
 * submit, +1 per committed step (a fail-fast skip is part of its commit), +1 at finish or cancel.
 */
const STEP_TABLE: Record<
  string,
  { re: RegExp; version: (done: number, failed: number) => number }
> = {
  pending: { re: /^p+$/, version: () => 1 },
  // A resolved prefix then a pending suffix, every step done before finish, or a fail-fast before finish.
  running: { re: /^(d+p+|d+|d*fs*)$/, version: (d, f) => 1 + d + f },
  done: { re: /^d+$/, version: (d) => d + 2 },
  partial: { re: /^d+fs*$/, version: (d) => d + 3 },
  failed: { re: /^fs*$/, version: () => 3 },
  cancelled: { re: /^s+$/, version: () => 2 },
};

/**
 * Typed steps of `occurrenceId` in the coordinator's table for `state`/`version`: contiguous idx from 0, unique
 * action ids of a supported kind (the body's actions when one is known), per-status fields.
 */
function validSteps(
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

/** One output per done step, in order, linked to it, `draft`-valid, its record digest recomputed. */
async function validOutputs(
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

function validRegistration(r: unknown, workflowId: string): r is Obj {
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
        // DT-7B-R1: every earlier epoch closed; the current one closed exactly when unregistered.
        (e.closedAt !== undefined) === (n < all.length - 1 || r.state === "unregistered"),
    )
  );
}

/** A full receipt of `occurrenceId` under `ownerKey`, with its complete body, digest and step/output proof. */
async function validReceipt(o: unknown, ownerKey: string, occurrenceId: string): Promise<boolean> {
  if (!isObj(o)) return false;
  if (
    !exactKeys(
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
    ) ||
    o.occurrenceId !== occurrenceId ||
    !STATES.has(o.state as string) ||
    !isVersion(o.receiptVersion) ||
    !isVersion(o.changeSeq) ||
    !isDigest(o.payloadDigest) ||
    !isIso(o.createdAt) ||
    !isIso(o.updatedAt) ||
    !isCount(o.ackedVersion)
  )
    return false;
  // The immutable body, exactly as admitted: the admission validator at its own admission time.
  const chk = checkBody(o.body, Date.parse(o.createdAt as string));
  if (!chk.ok) return false;
  const body = chk.body;
  if (
    body.ownerKey !== ownerKey ||
    body.occurrenceId !== occurrenceId ||
    body.workflowId !== o.workflowId ||
    body.kind !== o.kind ||
    body.registrationEpoch !== o.registrationEpoch ||
    body.revision !== o.revision ||
    (await payloadDigestOf(body)) !== o.payloadDigest
  )
    return false;
  // Timestamps and acknowledgement per state.
  const v = o.receiptVersion as number;
  const acked = o.ackedVersion as number;
  if (o.state === "pending" || o.state === "running") {
    if (
      o.finishedAt !== undefined ||
      o.purgeAt !== undefined ||
      o.firstAckAt !== undefined ||
      acked !== 0 ||
      (o.state === "pending"
        ? o.startedAt !== undefined || o.updatedAt !== o.createdAt
        : !isIso(o.startedAt))
    )
      return false;
  } else {
    const firstAck = o.firstAckAt === undefined ? null : Date.parse(o.firstAckAt as string);
    if (
      !isIso(o.finishedAt) ||
      o.updatedAt !== o.finishedAt ||
      (o.state === "cancelled" ? o.startedAt !== undefined : !isIso(o.startedAt)) ||
      (acked !== 0 && acked !== v) ||
      (o.firstAckAt !== undefined && !isIso(o.firstAckAt)) ||
      (firstAck !== null) !== acked >= 1 ||
      o.purgeAt !== new Date(purgeAt(Date.parse(o.finishedAt as string), firstAck)).toISOString()
    )
      return false;
  }
  return (
    validSteps(o.steps, occurrenceId, o.state as string, v, body) &&
    validOutputs(o.outputs, o.steps, (record, s) => validOutput(record, body, s.idx as number))
  );
}

/** A receipt answer is proof only when it validates completely; anything thrown is not proof. */
const receiptProof = (o: unknown, ownerKey: string, occurrenceId: string) =>
  validReceipt(o, ownerKey, occurrenceId).catch(() => false);

async function validFeed(x: Obj, ownerKey: string, after: number, limit: number): Promise<boolean> {
  if (!exactKeys(x, ["ownerKey", "items", "nextAfter", "more"]) || x.ownerKey !== ownerKey)
    return false;
  if (!Array.isArray(x.items) || x.items.length > limit || typeof x.more !== "boolean")
    return false;
  let seq = after;
  const ids = new Set<unknown>();
  for (const i of x.items as unknown[]) {
    if (
      !isObj(i) ||
      !exactKeys(
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
      ) ||
      !fits(i.occurrenceId, WF_ID_RE) ||
      ids.has(i.occurrenceId) ||
      !fits(i.workflowId, WF_ID_RE) ||
      !isVersion(i.changeSeq) ||
      (i.changeSeq as number) <= seq ||
      !STATES.has(i.state as string) ||
      !isVersion(i.receiptVersion) ||
      !isDigest(i.payloadDigest) ||
      !validSteps(i.steps, i.occurrenceId as string, i.state as string, i.receiptVersion) ||
      TERMINAL.has(i.state as string) !== (i.outputs !== undefined) ||
      // Body-free drafts: the feed proves no body/target binding (full status does).
      (i.outputs !== undefined &&
        !(await validOutputs(i.outputs, i.steps, (record, s) =>
          validDraft(record, s.kind as string, s.outputId as string),
        )))
    )
      return false;
    ids.add(i.occurrenceId);
    seq = i.changeSeq as number;
  }
  // The precise cursor rule: the last returned seq, or `after` itself when nothing was returned.
  return x.nextAfter === seq && (x.items.length > 0 || x.more === false);
}

/* ---------- the handler ---------- */

async function coordinate(ns: DurableObjectNamespace, call: Obj): Promise<Obj> {
  try {
    const stub = ns.get(ns.idFromName(WORKFLOW_OBJECT));
    const res = await stub.fetch("https://workflow-coordinator/", {
      method: "POST",
      body: JSON.stringify(call),
    });
    if (!res.ok) throw new Refused("receipt_unavailable");
    const v = (await res.json()) as unknown;
    if (!isObj(v)) throw new Refused("receipt_unavailable");
    return v;
  } catch {
    throw new Refused("receipt_unavailable");
  }
}

/** `/social/workflows/*`; `rest` is the path after "workflows". Answers null when the path is not ours. */
export async function handleWorkflows(
  req: Request,
  rest: string[],
  deps: { coordinator: DurableObjectNamespace | undefined; now: () => Date },
  reply: WorkflowReply,
): Promise<Response | null> {
  const route = kindOf(rest);
  if (!route) return null;
  const { kind, id } = route;
  const fail = (error: WorkflowError, more: Obj = {}) =>
    reply.json({ error, ...more }, STATUS[error]);
  if (req.method !== (GET.has(kind) ? "GET" : "POST")) return fail("method_not_allowed");
  if (!deps.coordinator) return fail("not_configured", { detail: "workflow-store" });
  const ns = deps.coordinator;
  const now = () => deps.now().getTime();

  try {
    if (id !== undefined) needId(id);
    const url = new URL(req.url);
    let input: Obj;
    if (GET.has(kind)) {
      const [required, optional] = QUERY[kind]!;
      input = readQuery(url, required, optional);
    } else {
      input = await readBody(req);
      need(exactKeys(input, KEYS[kind]!));
    }

    // The submitted ids (submit/register), bound into refusals and receipts.
    let bodyId: string | undefined;
    let bodyWorkflow: string | undefined;
    /** DT-7B-R1: a conflict's registration must not be the very answer this request would have succeeded with. */
    let conflictOk: (r: Obj | null) => boolean = () => false;
    /** A coordinator answer: a typed refusal of this operation (bound to this request) or the validated success. */
    const answer = async (
      x: Obj,
      ok: (x: Obj) => boolean | Promise<boolean>,
      owner: string,
      status = 200,
    ) => {
      if ("error" in x) {
        const e = x.error;
        const fields = typeof e === "string" ? REFUSAL_FIELDS[e] : undefined;
        if (!fields || !OP_ERRORS[kind].includes(e as string)) return fail("receipt_unavailable");
        const extra = Object.keys(x).filter((k) => k !== "error");
        // conflict carries the addressed id or the current registration; every other refusal its exact fields.
        const conflictKeys = kind === "submit" ? ["occurrenceId"] : ["registration"];
        const allowed = e === "conflict" ? conflictKeys : fields;
        if (!extra.every((k) => allowed.includes(k)) || !allowed.every((k) => k in x))
          return fail("receipt_unavailable");
        if (x.occurrenceId !== undefined && x.occurrenceId !== (id ?? bodyId))
          return fail("receipt_unavailable");
        if (x.workflowId !== undefined && x.workflowId !== (id ?? bodyWorkflow))
          return fail("receipt_unavailable");
        if (
          x.registration !== undefined &&
          (x.registration === null
            ? !conflictOk(null)
            : !validRegistration(x.registration, (id ?? bodyWorkflow) as string) ||
              !conflictOk(x.registration))
        )
          return fail("receipt_unavailable");
        if (
          (x.payloadDigest !== undefined && !isDigest(x.payloadDigest)) ||
          (x.prunedAt !== undefined && !isIso(x.prunedAt)) ||
          (x.receiptVersion !== undefined && !isVersion(x.receiptVersion)) ||
          // not_terminal: pending (always version 1) or running (≥ 2, one per committed step).
          (e === "not_terminal" &&
            !(x.state === "pending"
              ? x.receiptVersion === 1
              : x.state === "running" && (x.receiptVersion as number) >= 2)) ||
          // future_version: only above the current version.
          (e === "future_version" &&
            !((x.receiptVersion as number) < (input.receiptVersion as number)))
        )
          return fail("receipt_unavailable");
        const code = e as WorkflowError;
        const { error: _e, ...rest } = x;
        void _e;
        if (PURE.has(code)) return fail(code);
        // A pruned id answers 410 on cancel/ack (its row is gone), 409 on submit (never reusable).
        const status = code === "pruned" && kind !== "submit" ? 410 : STATUS[code];
        return reply.json({ error: code, ownerKey: owner, ...rest }, status);
      }
      return (await ok(x)) ? reply.json(x, status) : fail("receipt_unavailable");
    };

    if (kind === "authority") {
      const x = await coordinate(ns, { op: "authority", now: now() });
      return exactKeys(x, ["ownerKey"]) && isOwner(x.ownerKey)
        ? reply.json(x, 200)
        : fail("receipt_unavailable");
    }

    if (kind === "submit") {
      need(isObj(input.body) && isDigest(input.payloadDigest));
      const b = input.body as Obj;
      if (typeof b.occurrenceId === "string") bodyId = b.occurrenceId;
      if (typeof b.workflowId === "string") bodyWorkflow = b.workflowId;
      const owner = typeof b.ownerKey === "string" ? b.ownerKey : "";
      const x = await coordinate(ns, {
        op: "submit",
        body: b,
        payloadDigest: input.payloadDigest,
        now: now(),
      });
      const created = x.created === true;
      return await answer(
        x,
        async (y) => {
          const o = y.occurrence as Obj;
          return (
            exactKeys(y, ["ownerKey", "occurrence", "created"]) &&
            y.ownerKey === owner &&
            typeof y.created === "boolean" &&
            (await receiptProof(o, owner, bodyId!)) &&
            // The exact accepted body and the digest the caller computed.
            canonicalJson(o.body) === canonicalJson(b) &&
            o.payloadDigest === input.payloadDigest &&
            // A new row is the fresh pending receipt; a replay is the stored row in any state.
            (!y.created || (o.state === "pending" && o.receiptVersion === 1))
          );
        },
        owner,
        created ? 201 : 200,
      );
    }

    // Every other route names the authority it expects.
    need(isOwner(input.ownerKey));
    const owner = input.ownerKey as string;

    if (kind === "register") {
      needId(input.workflowId);
      need(
        isCount(input.expectedEpoch) && isVersion(input.revision) && isDigest(input.workflowDigest),
      );
      bodyWorkflow = input.workflowId as string;
      const epoch = (input.expectedEpoch as number) + 1;
      // The coordinator's success condition for this request (a new epoch or the replay of an applied one).
      const applied = (r: Obj) =>
        r.state === "active" &&
        r.registrationEpoch === epoch &&
        r.revision === input.revision &&
        r.workflowDigest === input.workflowDigest;
      // conflict: no row only when an existing epoch was expected; never the replay, never a re-registrable row.
      conflictOk = (r) =>
        r === null
          ? input.expectedEpoch !== 0
          : !applied(r) && !(r.state === "unregistered" && r.registrationEpoch === epoch - 1);
      const x = await coordinate(ns, { op: "register", ...input, now: now() });
      return await answer(
        x,
        (y) => {
          const r = y.registration as Obj;
          return (
            exactKeys(y, ["ownerKey", "registration", "created"]) &&
            y.ownerKey === owner &&
            typeof y.created === "boolean" &&
            validRegistration(r, bodyWorkflow!) &&
            applied(r) &&
            // A newly opened epoch opens at the registration's own update.
            (!y.created || (r.epochs as Obj[])[epoch - 1].openedAt === r.updatedAt)
          );
        },
        owner,
      );
    }
    if (kind === "update" || kind === "pause" || kind === "resume" || kind === "unregister") {
      need(isVersion(input.registrationEpoch) && isCount(input.expectedRevision));
      if (kind === "update") need(isVersion(input.revision) && isDigest(input.workflowDigest));
      const ep = input.registrationEpoch;
      const expected = input.expectedRevision as number;
      const current = (r: Obj) => r.registrationEpoch === ep;
      // The request's own success, bound to its epoch, revision, digest, paused flag or state.
      const bound =
        kind === "update"
          ? (r: Obj) =>
              current(r) &&
              r.state === "active" &&
              r.revision === input.revision &&
              r.workflowDigest === input.workflowDigest
          : (r: Obj) =>
              current(r) &&
              r.revision === expected &&
              (kind === "unregister"
                ? r.state === "unregistered"
                : r.paused === (kind === "pause"));
      conflictOk = (r) =>
        r !== null &&
        (kind === "update"
          ? !bound(r) &&
            !(
              current(r) &&
              r.state === "active" &&
              r.revision === expected &&
              (input.revision as number) > expected
            )
          : !(current(r) && r.revision === expected));
      const x = await coordinate(ns, { op: kind, ...input, workflowId: id, now: now() });
      return await answer(
        x,
        (y) => {
          const r = y.registration as Obj;
          return (
            exactKeys(y, ["ownerKey", "registration", "changed"]) &&
            y.ownerKey === owner &&
            typeof y.changed === "boolean" &&
            validRegistration(r, id!) &&
            bound(r) &&
            // A changed update moved past the expected revision; a changed unregister closed the epoch now.
            (!y.changed ||
              (kind === "update"
                ? (input.revision as number) > expected
                : kind !== "unregister" ||
                  (r.epochs as Obj[])[(ep as number) - 1].closedAt === r.updatedAt))
          );
        },
        owner,
      );
    }
    if (kind === "status") {
      const x = await coordinate(ns, {
        op: "status",
        ownerKey: owner,
        occurrenceId: id,
        now: now(),
      });
      return await answer(
        x,
        async (y) =>
          y.ownerKey === owner &&
          (exactKeys(y, ["ownerKey", "occurrence"])
            ? await receiptProof(y.occurrence, owner, id!)
            : y.state === "absent"
              ? exactKeys(y, ["ownerKey", "occurrenceId", "state"]) && y.occurrenceId === id
              : y.state === "pruned" &&
                exactKeys(y, ["ownerKey", "occurrenceId", "state", "payloadDigest", "prunedAt"]) &&
                y.occurrenceId === id &&
                isDigest(y.payloadDigest) &&
                isIso(y.prunedAt)),
        owner,
      );
    }
    if (kind === "cancel") {
      const x = await coordinate(ns, {
        op: "cancel",
        ownerKey: owner,
        occurrenceId: id,
        now: now(),
      });
      return await answer(
        x,
        async (y) => {
          const state = (y.occurrence as Obj | undefined)?.state as string;
          return (
            exactKeys(y, ["ownerKey", "occurrence", "cancelled"]) &&
            y.ownerKey === owner &&
            typeof y.cancelled === "boolean" &&
            // cancelled: the cancelled receipt; not cancelled: a terminal row the coordinator left unchanged.
            (y.cancelled ? state === "cancelled" : TERMINAL.has(state)) &&
            (await receiptProof(y.occurrence, owner, id!))
          );
        },
        owner,
      );
    }
    if (kind === "ack") {
      need(isVersion(input.receiptVersion));
      const v = input.receiptVersion as number;
      const x = await coordinate(ns, {
        op: "ack",
        ownerKey: owner,
        occurrenceId: id,
        receiptVersion: v,
        now: now(),
      });
      return await answer(
        x,
        (y) =>
          exactKeys(
            y,
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
          y.ownerKey === owner &&
          y.occurrenceId === id &&
          typeof y.acknowledged === "boolean" &&
          isVersion(y.receiptVersion) &&
          isCount(y.ackedVersion) &&
          isIso(y.purgeAt) &&
          (y.firstAckAt === undefined || isIso(y.firstAckAt)) &&
          // A terminal row's version never moves, so it is acknowledged at exactly that version or not at all;
          // firstAckAt exists exactly then and bounds the purge (≤ firstAck + 90 d).
          (y.ackedVersion === 0 || y.ackedVersion === y.receiptVersion) &&
          (y.firstAckAt !== undefined) === (y.ackedVersion as number) >= 1 &&
          (y.firstAckAt === undefined ||
            Date.parse(y.purgeAt as string) <=
              Date.parse(y.firstAckAt as string) + ACK_RETENTION_MS) &&
          // Proof only for the exact version asked; a lower one proves nothing new.
          (y.acknowledged
            ? y.receiptVersion === v && y.ackedVersion === v
            : v < (y.receiptVersion as number)),
        owner,
      );
    }
    if (kind === "run") {
      // DT-7B-2: the id and the ownerKey only — no query parameter either.
      need(url.search === "");
      const x = await coordinate(ns, { op: "run", ownerKey: owner, occurrenceId: id, now: now() });
      return await answer(
        x,
        async (y) => {
          const o = y.occurrence as Obj | undefined;
          const state = o?.state as string;
          const c = y.committed as number;
          return (
            exactKeys(y, ["ownerKey", "occurrence", "committed", "stopped"]) &&
            y.ownerKey === owner &&
            Number.isSafeInteger(c) &&
            c >= 0 &&
            c <= RUN_COMMITS_MAX &&
            RUN_STOPS.includes(y.stopped) &&
            (y.stopped === "terminal") === TERMINAL.has(state) &&
            (y.stopped !== "paused" || (state === "pending" && c === 0)) &&
            (y.stopped !== "limit" || c === RUN_COMMITS_MAX) &&
            (await receiptProof(o, owner, id!)) &&
            // Each commit resolved exactly one step (done or failed; a fail-fast skip is part of it).
            c <=
              (o!.steps as Obj[]).filter((s) => s.status === "done" || s.status === "failed").length
          );
        },
        owner,
      );
    }
    // changes
    need(fits(input.after, INT_RE) && (input.limit === undefined || fits(input.limit, INT_RE)));
    const after = Number(input.after);
    const limit = input.limit === undefined ? CHANGES_LIMIT_MAX : Number(input.limit);
    need(Number.isSafeInteger(after) && limit >= 1 && limit <= CHANGES_LIMIT_MAX);
    const x = await coordinate(ns, { op: "changes", ownerKey: owner, after, limit, now: now() });
    return await answer(x, (y) => validFeed(y, owner, after, limit).catch(() => false), owner);
  } catch (e) {
    if (e instanceof Refused) return fail(e.code);
    return fail("receipt_unavailable");
  }
}
