/**
 * ⚙️ WorkflowCoordinator (packet DT-7B, planning/tools/38-cloud-workflows.md): the durable authority of cloud workflow
 * occurrences, a SQLite-backed Durable Object (wrangler.jsonc binding WORKFLOW_COORDINATOR, migration
 * "v5-workflows"). ONE object for this single-owner dashboard, named WORKFLOW_OBJECT by the server: never chosen from a
 * caller's ownerKey or bearer. Local only: not provisioned, not activated, no cron, no browser wiring.
 *
 *   meta                  owner_key (`wfo_` + 32 hex, minted once: INSERT OR IGNORE, so it survives restarts and code
 *                         deployments and changes only with new storage), change_seq (monotonic), purged_at
 *   registrations         one row per workflow: current epoch, revision (the owner's workflow revision), digest,
 *                         state active | unregistered, and the retained `paused` flag
 *   registration_epochs   every epoch ever opened, with opened_at and the closed_at cutoff (kept forever)
 *   occurrences           the immutable accepted body (canonical JSON), its server-computed payload digest, state
 *                         pending | running | done | partial | failed | cancelled, receipt_version, change_seq,
 *                         first_ack_at / acked_version
 *   steps, outputs        one step per action; allowlisted draft outputs `wf:<occurrenceId>:<actionId>`
 *   missed                bounded schedule intervals (created now, unused until DT-7D)
 *   tombstones            purged occurrence ids with their digest: permanent, never reusable
 *
 * Binding rules (DT-7B decisions 1–6):
 *   authority   every call but `authority` names the ownerKey; another key → authority_mismatch, nothing changes.
 *   register    CAS on (epoch, revision). `register` carries expectedEpoch: 0 = first registration, N = re-register
 *               after epoch N was unregistered; a replay of an applied register (same revision + digest, epoch
 *               expectedEpoch + 1) answers the row unchanged, so a lost answer never mints another epoch. update /
 *               pause / resume / unregister name the epoch and expected revision: a delayed call for a closed epoch
 *               cannot touch a re-registration at the same revision.
 *   admission   the body's (workflowId, epoch, revision, executionAt): no registration → not_registered; an epoch never
 *               opened → unknown_epoch; executionAt before that epoch's own opened_at → not_registered (DT-7B-R1: a
 *               new occurrence needs opened_at ≤ executionAt ≤ closed_at of the exact named epoch, no skew allowance
 *               before opening); a revision above that epoch's last revision → registration_behind (open) or
 *               not_registered (closed); a closed epoch admits only executionAt ≤ its closed_at cutoff. An identical
 *               accepted occurrence is answered (created: false) before any of these checks. The body is stored
 *               exactly as accepted and is never rebound to a newer registration.
 *   pause       the workflow row's retained `paused` flag gates EVERY epoch of that workflow (delayed old-epoch work
 *               included). It is checked in the same transaction as the first pending → running step; a running
 *               occurrence finishes. Only pause/resume change it; unregister and re-register keep it. Unregister
 *               neither cancels nor moves existing cloud work.
 *   steps       commitStep is ONE transaction: the captured payload digest and receipt version still current, state
 *               pending | running, idx = the next pending index, every earlier step done, (pending) not paused. A
 *               builder error fails the step and skips every later step (fail-fast). An existing output is adopted
 *               only for the identical (occurrence, action, kind, digest), else the step fails `output-conflict`.
 *               The output digest (async) is computed before the transaction; the transaction rechecks everything.
 *               finish refuses while a step is pending: done (all done) | partial (a step done, then a failure) |
 *               failed (none done); a terminal row is answered unchanged. cancel: pending only (no step done).
 *   feed        every transition sets change_seq = ++meta.change_seq. `changes(after, limit ≤ 50)`: rows with
 *               change_seq > after in order; nextAfter = the last returned seq (or `after` when none); more = a row
 *               beyond it existed. A latest-receipt feed: intermediate states may coalesce; a later change of an older
 *               row always gets a higher seq.
 *   ack         only the exact current terminal receipt version: a future one is refused, a lower one is a no-op, a
 *               nonterminal / absent / pruned row has its own answer. The first valid ack stores first_ack_at (the
 *               Worker clock, `now`); repeats never move it. Ack bumps neither receipt_version nor change_seq.
 *   retention   terminal rows are purged at min(finished + 180 d, first ack + 90 d) when acknowledged, else
 *               finished + 180 d, into a permanent tombstone; nonterminal rows never. At most once per PURGE_EVERY_MS.
 *   run         (DT-7B-2) the one executor path: `{ op, ownerKey, occurrenceId, now }` exactly (any other key, e.g. a
 *               builder, output, snapshot, clock, retry or toggle, is bad_request). Inside this object it loops: read
 *               the row, build the next pending step with the statically imported fixed builder (workflowRun.ts
 *               `runStep`: the dashboard's real lib/workflows buildOutput) from the stored immutable body, commit it
 *               through commitStep with the observed receipt version + payload digest, finish when nothing is
 *               pending. Bounded: at most RUN_COMMITS_MAX committed steps and RUN_STALE_MAX stale (raced) commits per
 *               call, then it stops with the current receipt. Answer `{ ownerKey, occurrence, committed, stopped }`,
 *               stopped = terminal | paused (the pause gate refused the first step) | limit | contention. It never
 *               spins, never marks success on contention and never acknowledges; absent / pruned as elsewhere.
 *
 * `drainOne` (an executor loop over a caller-injected builder) is exported for tests only: no route or cron calls it,
 * and no env, header or body enables it or selects a builder for `run`.
 *
 * Plain class with `fetch` (no `cloudflare:workers` import), so index.ts can export it while plain-Node tests import
 * index.ts. The caller passes `now` (the routes: the Worker clock).
 */

import {
  canonicalJson,
  checkBody,
  DIGEST_RE,
  exactKeys,
  fits,
  isCount,
  isObj,
  isVersion,
  OWNER_KEY_RE,
  payloadDigestOf,
  sha256Hex,
  STEP_ERRORS,
  validOutput,
  WF_ID_RE,
  type Obj,
  type OccurrenceBody,
  type WorkflowActionBody,
} from "./workflowProtocol";
import { runStep } from "./workflowRun";

/** The one object of this single-owner dashboard (server-selected). */
export const WORKFLOW_OBJECT = "workflows|owner";
/** Non-terminal (pending + running) occurrences at most. */
export const OPEN_MAX = 500;
export const REGISTRATIONS_MAX = 20;
/** Epochs one workflow may open (re-registrations). */
export const EPOCHS_MAX = 50;
export const CHANGES_LIMIT_MAX = 50;
export const FINISH_RETENTION_MS = 180 * 86_400_000;
export const ACK_RETENTION_MS = 90 * 86_400_000;
export const PURGE_EVERY_MS = 3_600_000;
/**
 * DT-7B-2: committed steps per `run` call. An occurrence has at most ACTIONS_MAX = 5 steps and the finish follows
 * the last one, so `limit` is a defensive bound that a real body does not reach.
 */
export const RUN_COMMITS_MAX = 5;
/** DT-7B-2: stale (raced) step commits one `run` call tolerates before it stops with `contention`. */
export const RUN_STALE_MAX = 3;

export type OccurrenceState = "pending" | "running" | "done" | "partial" | "failed" | "cancelled";
const TERMINAL = "('done','partial','failed','cancelled')";
const isTerminal = (s: unknown) =>
  s === "done" || s === "partial" || s === "failed" || s === "cancelled";

/** The purge deadline of a terminal occurrence (decision 1). */
export const purgeAt = (finishedAt: number, firstAckAt: number | null) =>
  firstAckAt === null
    ? finishedAt + FINISH_RETENTION_MS
    : Math.min(finishedAt + FINISH_RETENTION_MS, firstAckAt + ACK_RETENTION_MS);

export interface WorkflowStep {
  idx: number;
  actionId: string;
  kind: string;
  status: "pending" | "done" | "failed" | "skipped";
  outputId?: string;
  outputDigest?: string;
  error?: string;
  at?: string;
}
export interface WorkflowOutput {
  outputId: string;
  actionId: string;
  kind: string;
  digest: string;
  record: Obj;
}
export interface OccurrenceReceipt {
  occurrenceId: string;
  workflowId: string;
  kind: string;
  registrationEpoch: number;
  revision: number;
  body: OccurrenceBody;
  payloadDigest: string;
  state: OccurrenceState;
  receiptVersion: number;
  changeSeq: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  firstAckAt?: string;
  ackedVersion: number;
  purgeAt?: string;
  steps: WorkflowStep[];
  outputs: WorkflowOutput[];
}

export type StepBuilder = (ctx: {
  body: OccurrenceBody;
  idx: number;
  action: WorkflowActionBody;
  prior: WorkflowOutput[];
}) => { record: unknown } | { error: string } | Promise<{ record: unknown } | { error: string }>;

type Row = Record<string, string | number | null>;
interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] };
}
interface StorageLike {
  sql: SqlLike;
  transactionSync<T>(fn: () => T): T;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registrations (
  workflow_id TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  workflow_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  paused INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS registration_epochs (
  workflow_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  PRIMARY KEY (workflow_id, epoch)
);
CREATE TABLE IF NOT EXISTS occurrences (
  occurrence_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  registration_epoch INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  receipt_version INTEGER NOT NULL,
  change_seq INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  first_ack_at INTEGER,
  acked_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS occurrences_state ON occurrences (state);
CREATE TABLE IF NOT EXISTS steps (
  occurrence_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  action_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  output_id TEXT,
  output_digest TEXT,
  error TEXT,
  at INTEGER,
  PRIMARY KEY (occurrence_id, idx)
);
CREATE TABLE IF NOT EXISTS outputs (
  output_id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  record_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS missed (
  workflow_id TEXT NOT NULL,
  from_slot INTEGER NOT NULL,
  to_slot INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, from_slot)
);
CREATE TABLE IF NOT EXISTS tombstones (
  occurrence_id TEXT PRIMARY KEY,
  payload_digest TEXT NOT NULL,
  pruned_at INTEGER NOT NULL
)
`;

const iso = (ms: unknown) => new Date(Number(ms)).toISOString();
const at = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: iso(v) });
const isId = (v: unknown): v is string => fits(v, WF_ID_RE);
const isDigest = (v: unknown): v is string => fits(v, DIGEST_RE);

function newOwnerKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return "wfo_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class WorkflowCoordinator {
  private readonly storage: StorageLike;
  private readonly ownerKey: string;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage as unknown as StorageLike;
    for (const statement of SCHEMA.split(";").map((s) => s.trim()))
      if (statement) this.storage.sql.exec(statement);
    // Minted once: a later constructor's random key is ignored.
    this.sql("INSERT OR IGNORE INTO meta (key, value) VALUES ('owner_key', ?)", newOwnerKey());
    this.sql("INSERT OR IGNORE INTO meta (key, value) VALUES ('change_seq', '0')");
    this.ownerKey = this.meta("owner_key")!;
  }

  async fetch(req: Request): Promise<Response> {
    let call: unknown;
    try {
      call = await req.json();
    } catch {
      return Response.json({ error: "bad_request" });
    }
    return Response.json(await this.call(call));
  }

  /** Async preparation (digests) outside any transaction, then the synchronous, transactional part. */
  async call(input: unknown): Promise<Obj> {
    if (!isObj(input) || !Number.isSafeInteger(input.now) || typeof input.op !== "string")
      return { error: "bad_request" };
    const c = input;
    const now = c.now as number;
    if (c.op === "authority") return { ownerKey: this.ownerKey };
    if (c.op === "submit") {
      const chk = checkBody(c.body, now);
      if (!chk.ok) return { error: chk.error };
      if (chk.body.ownerKey !== this.ownerKey) return { error: "authority_mismatch" };
      if (!isDigest(c.payloadDigest)) return { error: "bad_request" };
      const digest = await payloadDigestOf(chk.body);
      if (c.payloadDigest !== digest) return { error: "digest_mismatch" };
      this.purge(now);
      return this.submit(chk.body, digest, now);
    }
    if (!fits(c.ownerKey, OWNER_KEY_RE)) return { error: "bad_request" };
    if (c.ownerKey !== this.ownerKey) return { error: "authority_mismatch" };
    this.purge(now);
    switch (c.op) {
      case "register":
        if (
          !isId(c.workflowId) ||
          !isCount(c.expectedEpoch) ||
          !isVersion(c.revision) ||
          !isDigest(c.workflowDigest)
        )
          return { error: "bad_request" };
        return this.register(c.workflowId, c.expectedEpoch, c.revision, c.workflowDigest, now);
      case "update":
        if (
          !isId(c.workflowId) ||
          !isVersion(c.registrationEpoch) ||
          !isCount(c.expectedRevision) ||
          !isVersion(c.revision) ||
          !isDigest(c.workflowDigest)
        )
          return { error: "bad_request" };
        return this.update(
          c.workflowId,
          c.registrationEpoch,
          c.expectedRevision,
          c.revision,
          c.workflowDigest,
          now,
        );
      case "pause":
      case "resume":
      case "unregister":
        if (!isId(c.workflowId) || !isVersion(c.registrationEpoch) || !isCount(c.expectedRevision))
          return { error: "bad_request" };
        return this.control(c.op, c.workflowId, c.registrationEpoch, c.expectedRevision, now);
      case "status":
        if (!isId(c.occurrenceId)) return { error: "bad_request" };
        return this.status(c.occurrenceId);
      case "changes":
        if (
          !isCount(c.after) ||
          !Number.isSafeInteger(c.limit) ||
          (c.limit as number) < 1 ||
          (c.limit as number) > CHANGES_LIMIT_MAX
        )
          return { error: "bad_request" };
        return this.changes(c.after, c.limit as number);
      case "cancel":
        if (!isId(c.occurrenceId)) return { error: "bad_request" };
        return this.cancel(c.occurrenceId, now);
      case "ack":
        if (!isId(c.occurrenceId) || !isVersion(c.receiptVersion)) return { error: "bad_request" };
        return this.ack(c.occurrenceId, c.receiptVersion, now);
      case "finish":
        if (!isId(c.occurrenceId)) return { error: "bad_request" };
        return this.finish(c.occurrenceId, now);
      case "commitStep":
        return this.commitStep(c, now);
      case "run":
        // DT-7B-2: exactly these keys; nothing in the call can choose a builder, output, snapshot or clock.
        if (!exactKeys(c, ["op", "ownerKey", "occurrenceId", "now"]) || !isId(c.occurrenceId))
          return { error: "bad_request" };
        return this.run(c.occurrenceId, now);
      default:
        return { error: "bad_request" };
    }
  }

  private sql(query: string, ...bindings: (string | number | null)[]) {
    return this.storage.sql.exec(query, ...bindings);
  }
  private one(query: string, ...bindings: (string | number | null)[]): Row | undefined {
    return this.sql(query, ...bindings).toArray()[0] as Row | undefined;
  }
  private meta(key: string): string | undefined {
    const r = this.one("SELECT value FROM meta WHERE key = ?", key);
    return r ? String(r.value) : undefined;
  }
  /** The next change sequence; the caller holds the transaction. */
  private nextSeq(): number {
    const r = this.one(
      "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'change_seq' RETURNING value",
    )!;
    return Number(r.value);
  }
  private occurrenceRow(id: string) {
    return this.one("SELECT * FROM occurrences WHERE occurrence_id = ?", id);
  }
  private tombstone(id: string) {
    return this.one("SELECT * FROM tombstones WHERE occurrence_id = ?", id);
  }
  private prunedAnswer(t: Row) {
    return {
      occurrenceId: String(t.occurrence_id),
      payloadDigest: String(t.payload_digest),
      prunedAt: iso(t.pruned_at),
    };
  }

  /* ---------- registrations ---------- */

  private registration(workflowId: string): Obj | null {
    const r = this.one("SELECT * FROM registrations WHERE workflow_id = ?", workflowId);
    if (!r) return null;
    const epochs = (
      this.sql(
        "SELECT * FROM registration_epochs WHERE workflow_id = ? ORDER BY epoch",
        workflowId,
      ).toArray() as Row[]
    ).map((e) => ({
      epoch: Number(e.epoch),
      openedAt: iso(e.opened_at),
      ...at("closedAt", e.closed_at),
    }));
    return {
      workflowId,
      registrationEpoch: Number(r.epoch),
      revision: Number(r.revision),
      workflowDigest: String(r.workflow_digest),
      state: String(r.state),
      paused: Number(r.paused) === 1,
      updatedAt: iso(r.updated_at),
      epochs,
    };
  }

  private register(
    workflowId: string,
    expectedEpoch: number,
    revision: number,
    digest: string,
    now: number,
  ): Obj {
    return this.storage.transactionSync((): Obj => {
      const r = this.one("SELECT * FROM registrations WHERE workflow_id = ?", workflowId);
      const open = (epoch: number) =>
        this.sql(
          "INSERT INTO registration_epochs (workflow_id, epoch, revision, opened_at) VALUES (?, ?, ?, ?)",
          workflowId,
          epoch,
          revision,
          now,
        );
      if (!r) {
        if (expectedEpoch !== 0) return { error: "conflict", registration: null };
        const n = this.one("SELECT COUNT(*) AS n FROM registrations")!;
        if (Number(n.n) >= REGISTRATIONS_MAX) return { error: "capacity" };
        this.sql(
          `INSERT INTO registrations (workflow_id, epoch, revision, workflow_digest, state, paused, updated_at)
           VALUES (?, 1, ?, ?, 'active', 0, ?)`,
          workflowId,
          revision,
          digest,
          now,
        );
        open(1);
        return {
          ownerKey: this.ownerKey,
          registration: this.registration(workflowId),
          created: true,
        };
      }
      const epoch = Number(r.epoch);
      if (r.state === "unregistered" && epoch === expectedEpoch) {
        if (epoch >= EPOCHS_MAX) return { error: "capacity" };
        // The retained pause flag is kept (decision 2).
        this.sql(
          `UPDATE registrations SET epoch = ?, revision = ?, workflow_digest = ?, state = 'active', updated_at = ?
           WHERE workflow_id = ?`,
          epoch + 1,
          revision,
          digest,
          now,
          workflowId,
        );
        open(epoch + 1);
        return {
          ownerKey: this.ownerKey,
          registration: this.registration(workflowId),
          created: true,
        };
      }
      // The replay of an applied register (a lost answer): unchanged, no new epoch.
      if (
        r.state === "active" &&
        epoch === expectedEpoch + 1 &&
        Number(r.revision) === revision &&
        r.workflow_digest === digest
      )
        return {
          ownerKey: this.ownerKey,
          registration: this.registration(workflowId),
          created: false,
        };
      return { error: "conflict", registration: this.registration(workflowId) };
    });
  }

  private update(
    workflowId: string,
    epoch: number,
    expected: number,
    revision: number,
    digest: string,
    now: number,
  ): Obj {
    return this.storage.transactionSync((): Obj => {
      const r = this.one("SELECT * FROM registrations WHERE workflow_id = ?", workflowId);
      if (!r) return { error: "not_registered", workflowId };
      const current = r.state === "active" && Number(r.epoch) === epoch;
      if (current && Number(r.revision) === revision && r.workflow_digest === digest)
        return {
          ownerKey: this.ownerKey,
          registration: this.registration(workflowId),
          changed: false,
        };
      if (!current || Number(r.revision) !== expected || revision <= expected)
        return { error: "conflict", registration: this.registration(workflowId) };
      this.sql(
        "UPDATE registrations SET revision = ?, workflow_digest = ?, updated_at = ? WHERE workflow_id = ?",
        revision,
        digest,
        now,
        workflowId,
      );
      this.sql(
        "UPDATE registration_epochs SET revision = ? WHERE workflow_id = ? AND epoch = ?",
        revision,
        workflowId,
        epoch,
      );
      return {
        ownerKey: this.ownerKey,
        registration: this.registration(workflowId),
        changed: true,
      };
    });
  }

  private control(
    op: "pause" | "resume" | "unregister",
    workflowId: string,
    epoch: number,
    expected: number,
    now: number,
  ): Obj {
    return this.storage.transactionSync((): Obj => {
      const r = this.one("SELECT * FROM registrations WHERE workflow_id = ?", workflowId);
      if (!r) return { error: "not_registered", workflowId };
      if (Number(r.epoch) !== epoch || Number(r.revision) !== expected)
        return { error: "conflict", registration: this.registration(workflowId) };
      let changed = false;
      if (op === "unregister") {
        if (r.state === "active") {
          this.sql(
            "UPDATE registrations SET state = 'unregistered', updated_at = ? WHERE workflow_id = ?",
            now,
            workflowId,
          );
          this.sql(
            "UPDATE registration_epochs SET closed_at = ? WHERE workflow_id = ? AND epoch = ?",
            now,
            workflowId,
            epoch,
          );
          changed = true;
        }
      } else {
        const paused = op === "pause" ? 1 : 0;
        if (Number(r.paused) !== paused) {
          this.sql(
            "UPDATE registrations SET paused = ?, updated_at = ? WHERE workflow_id = ?",
            paused,
            now,
            workflowId,
          );
          changed = true;
        }
      }
      return { ownerKey: this.ownerKey, registration: this.registration(workflowId), changed };
    });
  }

  /* ---------- occurrences ---------- */

  private receipt(r: Row): OccurrenceReceipt {
    const id = String(r.occurrence_id);
    const stepRows = this.sql(
      "SELECT * FROM steps WHERE occurrence_id = ? ORDER BY idx",
      id,
    ).toArray() as Row[];
    const steps = stepRows.map(
      (s) =>
        ({
          idx: Number(s.idx),
          actionId: String(s.action_id),
          kind: String(s.kind),
          status: String(s.status),
          ...(s.output_id === null ? {} : { outputId: String(s.output_id) }),
          ...(s.output_digest === null ? {} : { outputDigest: String(s.output_digest) }),
          ...(s.error === null ? {} : { error: String(s.error) }),
          ...at("at", s.at),
        }) as WorkflowStep,
    );
    const outputs: WorkflowOutput[] = [];
    for (const s of stepRows) {
      if (s.status !== "done" || s.output_id === null) continue;
      const o = this.one("SELECT * FROM outputs WHERE output_id = ?", String(s.output_id));
      if (o)
        outputs.push({
          outputId: String(o.output_id),
          actionId: String(o.action_id),
          kind: String(o.kind),
          digest: String(o.digest),
          record: JSON.parse(String(o.record_json)) as Obj,
        });
    }
    const terminal = isTerminal(r.state);
    const firstAck = r.first_ack_at === null ? null : Number(r.first_ack_at);
    return {
      occurrenceId: id,
      workflowId: String(r.workflow_id),
      kind: String(r.kind),
      registrationEpoch: Number(r.registration_epoch),
      revision: Number(r.revision),
      body: JSON.parse(String(r.body_json)) as OccurrenceBody,
      payloadDigest: String(r.payload_digest),
      state: r.state as OccurrenceState,
      receiptVersion: Number(r.receipt_version),
      changeSeq: Number(r.change_seq),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      ...at("startedAt", r.started_at),
      ...at("finishedAt", r.finished_at),
      ...at("firstAckAt", r.first_ack_at),
      ackedVersion: Number(r.acked_version),
      ...(terminal ? { purgeAt: iso(purgeAt(Number(r.finished_at), firstAck)) } : {}),
      steps,
      outputs,
    };
  }

  private answer(id: string, more: Obj = {}): Obj {
    return { ownerKey: this.ownerKey, occurrence: this.receipt(this.occurrenceRow(id)!), ...more };
  }

  private submit(body: OccurrenceBody, digest: string, now: number): Obj {
    return this.storage.transactionSync((): Obj => {
      const id = body.occurrenceId;
      const t = this.tombstone(id);
      if (t) return { error: "pruned", ...this.prunedAnswer(t) };
      const existing = this.occurrenceRow(id);
      if (existing)
        return existing.payload_digest === digest
          ? this.answer(id, { created: false })
          : { error: "conflict", occurrenceId: id };
      const workflowId = body.workflowId;
      const reg = this.one("SELECT * FROM registrations WHERE workflow_id = ?", workflowId);
      if (!reg) return { error: "not_registered", workflowId };
      const ep = this.one(
        "SELECT * FROM registration_epochs WHERE workflow_id = ? AND epoch = ?",
        workflowId,
        body.registrationEpoch,
      );
      if (!ep) return { error: "unknown_epoch", workflowId };
      // DT-7B-R1: a new occurrence belongs to the named epoch's own interval, never to an earlier local-only time.
      if (Date.parse(body.executionAt) < Number(ep.opened_at))
        return { error: "not_registered", workflowId };
      if (ep.closed_at === null) {
        if (body.revision > Number(ep.revision))
          return { error: "registration_behind", workflowId };
      } else if (
        body.revision > Number(ep.revision) ||
        Date.parse(body.executionAt) > Number(ep.closed_at)
      )
        return { error: "not_registered", workflowId };
      const open = this.one(
        "SELECT COUNT(*) AS n FROM occurrences WHERE state IN ('pending','running')",
      )!;
      if (Number(open.n) >= OPEN_MAX) return { error: "capacity" };
      this.sql(
        `INSERT INTO occurrences (occurrence_id, workflow_id, kind, registration_epoch, revision, body_json,
           payload_digest, state, receipt_version, change_seq, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`,
        id,
        workflowId,
        body.kind,
        body.registrationEpoch,
        body.revision,
        canonicalJson(body),
        digest,
        this.nextSeq(),
        now,
        now,
      );
      body.snapshot.actions.forEach((a, idx) =>
        this.sql(
          "INSERT INTO steps (occurrence_id, idx, action_id, kind, status) VALUES (?, ?, ?, ?, 'pending')",
          id,
          idx,
          a.id,
          a.kind,
        ),
      );
      return this.answer(id, { created: true });
    });
  }

  private status(id: string): Obj {
    if (this.occurrenceRow(id)) return this.answer(id);
    const t = this.tombstone(id);
    return t
      ? { ownerKey: this.ownerKey, state: "pruned", ...this.prunedAnswer(t) }
      : { ownerKey: this.ownerKey, occurrenceId: id, state: "absent" };
  }

  private changes(after: number, limit: number): Obj {
    const rows = this.sql(
      "SELECT * FROM occurrences WHERE change_seq > ? ORDER BY change_seq LIMIT ?",
      after,
      limit + 1,
    ).toArray() as Row[];
    const items = rows.slice(0, limit).map((r) => {
      const o = this.receipt(r);
      return {
        occurrenceId: o.occurrenceId,
        workflowId: o.workflowId,
        changeSeq: o.changeSeq,
        state: o.state,
        receiptVersion: o.receiptVersion,
        payloadDigest: o.payloadDigest,
        steps: o.steps,
        ...(isTerminal(o.state) ? { outputs: o.outputs } : {}),
      };
    });
    return {
      ownerKey: this.ownerKey,
      items,
      nextAfter: items.length ? items[items.length - 1].changeSeq : after,
      more: rows.length > limit,
    };
  }

  /** absent | pruned refusals for an occurrence-addressed mutation. */
  private missing(id: string): Obj {
    const t = this.tombstone(id);
    return t ? { error: "pruned", ...this.prunedAnswer(t) } : { error: "absent", occurrenceId: id };
  }

  private cancel(id: string, now: number): Obj {
    return this.storage.transactionSync((): Obj => {
      const r = this.occurrenceRow(id);
      if (!r) return this.missing(id);
      if (r.state === "running") return { error: "running", occurrenceId: id };
      if (r.state !== "pending") return this.answer(id, { cancelled: false });
      // Pending means no step is done (the first committed step makes it running).
      this.sql(
        "UPDATE steps SET status = 'skipped' WHERE occurrence_id = ? AND status = 'pending'",
        id,
      );
      this.sql(
        `UPDATE occurrences SET state = 'cancelled', finished_at = ?, updated_at = ?,
           receipt_version = receipt_version + 1, change_seq = ?
         WHERE occurrence_id = ? AND state = 'pending'`,
        now,
        now,
        this.nextSeq(),
        id,
      );
      return this.answer(id, { cancelled: true });
    });
  }

  private ack(id: string, version: number, now: number): Obj {
    return this.storage.transactionSync((): Obj => {
      const r = this.occurrenceRow(id);
      if (!r) return this.missing(id);
      const current = Number(r.receipt_version);
      if (!isTerminal(r.state))
        return { error: "not_terminal", occurrenceId: id, state: r.state, receiptVersion: current };
      if (version > current)
        return { error: "future_version", occurrenceId: id, receiptVersion: current };
      const acknowledged = version === current;
      // Only the first exact terminal ack sets the clock; nothing here bumps the version or the feed.
      if (acknowledged && r.first_ack_at === null)
        this.sql(
          "UPDATE occurrences SET first_ack_at = ?, acked_version = ? WHERE occurrence_id = ?",
          now,
          current,
          id,
        );
      const o = this.occurrenceRow(id)!;
      return {
        ownerKey: this.ownerKey,
        occurrenceId: id,
        acknowledged,
        receiptVersion: current,
        ackedVersion: Number(o.acked_version),
        ...at("firstAckAt", o.first_ack_at),
        purgeAt: iso(
          purgeAt(Number(o.finished_at), o.first_ack_at === null ? null : Number(o.first_ack_at)),
        ),
      };
    });
  }

  private finish(id: string, now: number): Obj {
    return this.storage.transactionSync((): Obj => {
      const r = this.occurrenceRow(id);
      if (!r) return this.missing(id);
      if (isTerminal(r.state)) return this.answer(id, { finished: false });
      const n = (status: string) =>
        Number(
          this.one(
            "SELECT COUNT(*) AS n FROM steps WHERE occurrence_id = ? AND status = ?",
            id,
            status,
          )!.n,
        );
      if (n("pending") > 0) return { error: "steps_pending", ...this.answer(id) };
      const state = n("failed") === 0 ? "done" : n("done") > 0 ? "partial" : "failed";
      // DT-7B-2-R1: never earlier than the row's durable lifecycle time (an older captured clock cannot move it back).
      const stamp = Math.max(now, Number(r.updated_at));
      this.sql(
        `UPDATE occurrences SET state = ?, finished_at = ?, updated_at = ?, receipt_version = receipt_version + 1,
           change_seq = ?
         WHERE occurrence_id = ?`,
        state,
        stamp,
        stamp,
        this.nextSeq(),
        id,
      );
      return this.answer(id, { finished: true });
    });
  }

  private async commitStep(c: Obj, now: number): Promise<Obj> {
    const id = c.occurrenceId;
    const idx = c.idx;
    const out = c.output;
    if (
      !isId(id) ||
      !Number.isSafeInteger(idx) ||
      (idx as number) < 0 ||
      !isVersion(c.receiptVersion) ||
      !isDigest(c.payloadDigest) ||
      !isObj(out)
    )
      return { error: "bad_request" };
    const row = this.occurrenceRow(id);
    if (!row) return this.missing(id);
    const body = JSON.parse(String(row.body_json)) as OccurrenceBody;
    const action = body.snapshot.actions[idx as number];
    if (!action) return { error: "bad_request" };
    let built: { record: Obj; digest: string } | { error: string };
    if (Object.keys(out).length === 1 && (STEP_ERRORS as readonly unknown[]).includes(out.error))
      built = { error: out.error as string };
    else if (Object.keys(out).length === 1 && validOutput(out.record, body, idx as number))
      // Async, outside the transaction; the transaction below rechecks version, digest and next step.
      built = { record: out.record as Obj, digest: await sha256Hex(canonicalJson(out.record)) };
    else return { error: "bad_request" };
    return this.storage.transactionSync((): Obj => {
      const r = this.occurrenceRow(id);
      if (!r) return this.missing(id);
      const stale = () => ({ error: "stale", ...this.answer(id) });
      if (
        r.payload_digest !== c.payloadDigest ||
        Number(r.receipt_version) !== c.receiptVersion ||
        (r.state !== "pending" && r.state !== "running")
      )
        return stale();
      const next = this.one(
        "SELECT MIN(idx) AS i FROM steps WHERE occurrence_id = ? AND status = 'pending'",
        id,
      )!;
      const notDone = this.one(
        "SELECT COUNT(*) AS n FROM steps WHERE occurrence_id = ? AND idx < ? AND status != 'done'",
        id,
        idx as number,
      )!;
      if (next.i === null || Number(next.i) !== idx || Number(notDone.n) !== 0) return stale();
      if (r.state === "pending") {
        const reg = this.one(
          "SELECT paused FROM registrations WHERE workflow_id = ?",
          String(r.workflow_id),
        );
        if (!reg || Number(reg.paused) === 1) return { error: "paused", ...this.answer(id) };
      }
      // DT-7B-2-R1: the stamp is max(captured Worker clock, the row's durable lifecycle time) read in this very
      // transaction, so adopting a newer invocation's progress never moves started/step/updated times backward.
      const stamp = Math.max(now, Number(r.updated_at));
      const fail = (error: string) => {
        this.sql(
          "UPDATE steps SET status = 'failed', error = ?, at = ? WHERE occurrence_id = ? AND idx = ?",
          error,
          stamp,
          id,
          idx as number,
        );
        // Fail-fast (decision 3): every later step is skipped; earlier outputs stay.
        this.sql(
          "UPDATE steps SET status = 'skipped' WHERE occurrence_id = ? AND idx > ? AND status = 'pending'",
          id,
          idx as number,
        );
      };
      if ("error" in built) fail(built.error);
      else {
        const outputId = String(built.record.id);
        const held = this.one("SELECT * FROM outputs WHERE output_id = ?", outputId);
        const same =
          held &&
          held.occurrence_id === id &&
          held.action_id === action.id &&
          held.kind === action.kind &&
          held.digest === built.digest;
        if (held && !same) fail("output-conflict");
        else {
          if (!held)
            this.sql(
              `INSERT INTO outputs (output_id, occurrence_id, action_id, kind, record_json, digest, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              outputId,
              id,
              action.id,
              action.kind,
              canonicalJson(built.record),
              built.digest,
              stamp,
            );
          this.sql(
            `UPDATE steps SET status = 'done', output_id = ?, output_digest = ?, at = ?
             WHERE occurrence_id = ? AND idx = ? AND status = 'pending'`,
            outputId,
            built.digest,
            stamp,
            id,
            idx as number,
          );
        }
      }
      this.sql(
        `UPDATE occurrences SET state = 'running', started_at = COALESCE(started_at, ?), updated_at = ?,
           receipt_version = receipt_version + 1, change_seq = ?
         WHERE occurrence_id = ?`,
        stamp,
        stamp,
        this.nextSeq(),
        id,
      );
      return this.answer(id, { committed: true });
    });
  }

  /**
   * DT-7B-2: drive one occurrence with the fixed server builder, each step through the step-CAS above (the pause
   * gate, fail-fast, adoption and versioning are commitStep's own). The builder clock is the body's executionAt;
   * `now` (the Worker clock) stamps commits and the finish, raised inside each transaction to the row's durable
   * lifecycle time (DT-7B-2-R1), so a run that adopts a newer invocation's progress stays chronological.
   */
  private async run(id: string, now: number): Promise<Obj> {
    let committed = 0;
    let stale = 0;
    for (;;) {
      const row = this.occurrenceRow(id);
      if (!row) return this.missing(id);
      const o = this.receipt(row);
      const stop = (stopped: string) => ({
        ownerKey: this.ownerKey,
        occurrence: o,
        committed,
        stopped,
      });
      if (isTerminal(o.state)) return stop("terminal");
      if (stale >= RUN_STALE_MAX) return stop("contention");
      const next = o.steps.find((s) => s.status === "pending");
      if (!next) {
        // Nothing pending: finish (synchronous, no interleaving since the read); the next pass answers it.
        if ("error" in this.finish(id, now)) stale++;
        continue;
      }
      if (committed >= RUN_COMMITS_MAX) return stop("limit");
      const output = await runStep({
        body: o.body,
        idx: next.idx,
        action: o.body.snapshot.actions[next.idx],
        prior: o.outputs,
      });
      const r = await this.commitStep(
        {
          occurrenceId: id,
          idx: next.idx,
          receiptVersion: o.receiptVersion,
          payloadDigest: o.payloadDigest,
          output,
        },
        now,
      );
      if (r.committed === true) committed++;
      else if (r.error === "stale") stale++;
      else if (r.error === "paused")
        return { ownerKey: this.ownerKey, occurrence: r.occurrence, committed, stopped: "paused" };
      else return r;
    }
  }

  /* ---------- retention ---------- */

  /** Terminal rows past their deadline become permanent tombstones; at most once per PURGE_EVERY_MS. */
  private purge(now: number) {
    const last = this.meta("purged_at");
    if (last !== undefined && now >= Number(last) && now - Number(last) < PURGE_EVERY_MS) return;
    this.storage.transactionSync(() => {
      this.sql(
        "INSERT INTO meta (key, value) VALUES ('purged_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        String(now),
      );
      const due = this.sql(
        `SELECT occurrence_id, payload_digest FROM occurrences
         WHERE state IN ${TERMINAL} AND (CASE WHEN first_ack_at IS NULL THEN finished_at + ?
           ELSE MIN(finished_at + ?, first_ack_at + ?) END) <= ?`,
        FINISH_RETENTION_MS,
        FINISH_RETENTION_MS,
        ACK_RETENTION_MS,
        now,
      ).toArray() as Row[];
      for (const r of due) {
        const id = String(r.occurrence_id);
        this.sql(
          "INSERT OR IGNORE INTO tombstones (occurrence_id, payload_digest, pruned_at) VALUES (?, ?, ?)",
          id,
          String(r.payload_digest),
          now,
        );
        this.sql("DELETE FROM outputs WHERE occurrence_id = ?", id);
        this.sql("DELETE FROM steps WHERE occurrence_id = ?", id);
        this.sql("DELETE FROM occurrences WHERE occurrence_id = ?", id);
      }
    });
  }
}

/**
 * TEST-ONLY executor loop: drives one occurrence through `call` (a coordinator transport) with an injected builder,
 * re-reading after every stale answer, until it is terminal or paused. No production path calls it.
 */
export async function drainOne(
  call: (c: Obj) => Promise<Obj>,
  ownerKey: string,
  occurrenceId: string,
  build: StepBuilder,
  now: () => number,
): Promise<Obj> {
  for (let guard = 0; guard < 50; guard++) {
    const s = await call({ op: "status", ownerKey, occurrenceId, now: now() });
    const o = s.occurrence as OccurrenceReceipt | undefined;
    if (!o || isTerminal(o.state)) return s;
    const next = o.steps.find((x) => x.status === "pending");
    if (!next) {
      const f = await call({ op: "finish", ownerKey, occurrenceId, now: now() });
      if (!("error" in f)) return { ownerKey: f.ownerKey, occurrence: f.occurrence };
      continue;
    }
    const output = await build({
      body: o.body,
      idx: next.idx,
      action: o.body.snapshot.actions[next.idx],
      prior: o.outputs,
    });
    const r = await call({
      op: "commitStep",
      ownerKey,
      occurrenceId,
      idx: next.idx,
      receiptVersion: o.receiptVersion,
      payloadDigest: o.payloadDigest,
      output,
      now: now(),
    });
    if (r.error === "paused" || r.error === "bad_request") return r;
  }
  return { error: "stale" };
}
