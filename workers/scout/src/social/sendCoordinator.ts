/**
 * 📤 SendCoordinator (packet DT-6B-2A, planning/tools/37-inbox-send.md): the claim authority of reviewed inbox sends, a
 * SQLite-backed Durable Object (wrangler.jsonc binding SEND_COORDINATOR, migration "v1-send"), one object per
 * `<provider>|<account>`. KV is never the claim store: it has no atomic read-modify-write.
 *
 *   prepare  stores one immutable intent. The same operation id with the same payload returns it again; with another
 *            payload it is `conflict`. Another operation id for the same live submission (account, draft revision,
 *            parent comment, text digest) converges on the existing intent, so two tabs cannot prepare it twice.
 *   claim    prepared → dispatching in one UPDATE, exactly once; any other state is returned as is (claimed: false).
 *   settle   dispatching → sent | rejected | unknown, once.
 *   cancel   prepared → cancelled; nothing else.
 *
 * No network call is made here; the caller's provider POST happens after a committed claim. A prepared intent expires
 * at its review deadline; `dispatching` and `unknown` never expire, are never purged and can never be claimed again.
 * Terminal rows (sent, rejected, expired, cancelled) are purged after RETENTION_MS; their operation ids (and a sent
 * row's submission) stay in `tombstones`, so nothing purged becomes dispatchable again.
 *
 * Plain class with `fetch` (no `cloudflare:workers` import), so index.ts can export it while the plain-Node tests still
 * import index.ts. The caller passes `now` (the Worker's clock; tests move it).
 */

/** Terminal rows are kept this long (90 days), then purged and tombstoned. */
export const RETENTION_MS = 90 * 86_400_000;

export type SendState =
  "prepared" | "dispatching" | "sent" | "rejected" | "unknown" | "expired" | "cancelled";

export interface PrepareInput {
  operationId: string;
  provider: string;
  account: string;
  generation: string;
  threadId: string;
  videoId: string;
  parentCommentId: string;
  text: string;
  digest: string;
  draftRevision: string;
  /** ms since epoch. */
  reviewExpiresAt: number;
}

export type Outcome =
  | { state: "sent"; providerCommentId: string }
  | { state: "rejected"; code: string; detail?: string }
  | { state: "unknown"; reason: string };

export type CoordinatorCall =
  | { op: "prepare"; input: PrepareInput; now: number }
  | { op: "claim"; operationId: string; digest: string; now: number }
  | { op: "settle"; operationId: string; outcome: Outcome; now: number }
  | { op: "cancel"; operationId: string; now: number }
  | { op: "get"; operationId: string; now: number };

export interface Intent {
  operationId: string;
  provider: string;
  account: string;
  generation: string;
  threadId: string;
  videoId: string;
  parentCommentId: string;
  text: string;
  digest: string;
  draftRevision: string;
  state: SendState;
  reviewExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  settledAt?: string;
  providerCommentId?: string;
  failureCode?: string;
  failureDetail?: string;
  unknownReason?: string;
}

export type CoordinatorAnswer =
  | { intent: Intent; claimed?: boolean; settled?: boolean }
  | { error: "conflict" | "not_found" | "bad_request" };

type Row = Record<string, string | number | null>;

interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] };
}
interface StorageLike {
  sql: SqlLike;
  transactionSync<T>(fn: () => T): T;
}

/** States one live submission can be in: a second intent for it would send twice or hide an uncertain send. */
const LIVE = "('prepared','dispatching','sent','unknown')";
const TERMINAL = "('sent','rejected','expired','cancelled')";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS intents (
  operation_id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  account TEXT NOT NULL,
  generation TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  parent_comment_id TEXT NOT NULL,
  text TEXT NOT NULL,
  digest TEXT NOT NULL,
  draft_revision TEXT NOT NULL,
  state TEXT NOT NULL,
  review_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed_at INTEGER,
  settled_at INTEGER,
  provider_comment_id TEXT,
  failure_code TEXT,
  failure_detail TEXT,
  unknown_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS live_submission ON intents (submission_key) WHERE state IN ${LIVE};
CREATE TABLE IF NOT EXISTS tombstones (operation_id TEXT PRIMARY KEY, submission_key TEXT);
CREATE INDEX IF NOT EXISTS tombstone_submission ON tombstones (submission_key);
`;

const iso = (ms: unknown) => new Date(Number(ms)).toISOString();

function intentOf(r: Row): Intent {
  const opt = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: v });
  return {
    operationId: String(r.operation_id),
    provider: String(r.provider),
    account: String(r.account),
    generation: String(r.generation),
    threadId: String(r.thread_id),
    videoId: String(r.video_id),
    parentCommentId: String(r.parent_comment_id),
    text: String(r.text),
    digest: String(r.digest),
    draftRevision: String(r.draft_revision),
    state: r.state as SendState,
    reviewExpiresAt: iso(r.review_expires_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ...(r.claimed_at === null ? {} : { claimedAt: iso(r.claimed_at) }),
    ...(r.settled_at === null ? {} : { settledAt: iso(r.settled_at) }),
    ...opt("providerCommentId", r.provider_comment_id),
    ...opt("failureCode", r.failure_code),
    ...opt("failureDetail", r.failure_detail),
    ...opt("unknownReason", r.unknown_reason),
  } as Intent;
}

const submissionKey = (i: PrepareInput) =>
  [i.provider, i.account, i.draftRevision, i.parentCommentId, i.digest].join("|");

/** The fields an operation id is bound to: a retry must repeat every one of them. */
const PAYLOAD = [
  ["provider", "provider"],
  ["account", "account"],
  ["generation", "generation"],
  ["threadId", "thread_id"],
  ["videoId", "video_id"],
  ["parentCommentId", "parent_comment_id"],
  ["text", "text"],
  ["digest", "digest"],
  ["draftRevision", "draft_revision"],
] as const;

export class SendCoordinator {
  private readonly storage: StorageLike;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage as unknown as StorageLike;
    for (const statement of SCHEMA.split(";").map((s) => s.trim()))
      if (statement) this.storage.sql.exec(statement);
  }

  async fetch(req: Request): Promise<Response> {
    let call: CoordinatorCall;
    try {
      call = (await req.json()) as CoordinatorCall;
    } catch {
      return Response.json({ error: "bad_request" });
    }
    return Response.json(this.run(call));
  }

  run(call: CoordinatorCall): CoordinatorAnswer {
    if (!call || typeof call !== "object" || !Number.isFinite(call.now))
      return { error: "bad_request" };
    // Synchronous from here on: a Durable Object runs this without interleaving another request.
    this.expire(call.now);
    switch (call.op) {
      case "prepare":
        return this.prepare(call.input, call.now);
      case "claim":
        return this.claim(call.operationId, call.digest, call.now);
      case "settle":
        return this.settle(call.operationId, call.outcome, call.now);
      case "cancel":
        return this.transition(call.operationId, "prepared", "cancelled", call.now);
      case "get": {
        const r = this.row(call.operationId);
        return r ? { intent: intentOf(r) } : { error: "not_found" };
      }
      default:
        return { error: "bad_request" };
    }
  }

  private sql(query: string, ...bindings: (string | number | null)[]) {
    return this.storage.sql.exec(query, ...bindings);
  }

  private row(operationId: unknown): Row | null {
    if (typeof operationId !== "string") return null;
    return (
      (this.sql("SELECT * FROM intents WHERE operation_id = ?", operationId).toArray()[0] as
        Row | undefined) ?? null
    );
  }

  /** A prepared intent past its review deadline is expired before anything reads it. */
  private expire(now: number) {
    this.sql(
      "UPDATE intents SET state = 'expired', updated_at = ? WHERE state = 'prepared' AND review_expires_at <= ?",
      now,
      now,
    );
  }

  private purge(now: number) {
    this.storage.transactionSync(() => {
      const cutoff = now - RETENTION_MS;
      this.sql(
        `INSERT OR IGNORE INTO tombstones (operation_id, submission_key)
         SELECT operation_id, CASE WHEN state = 'sent' THEN submission_key END FROM intents
         WHERE state IN ${TERMINAL} AND updated_at < ?`,
        cutoff,
      );
      this.sql(`DELETE FROM intents WHERE state IN ${TERMINAL} AND updated_at < ?`, cutoff);
    });
  }

  private prepare(i: PrepareInput, now: number): CoordinatorAnswer {
    if (!i || typeof i !== "object" || !PAYLOAD.every(([k]) => typeof i[k] === "string"))
      return { error: "bad_request" };
    if (!Number.isFinite(i.reviewExpiresAt)) return { error: "bad_request" };
    this.purge(now);
    const key = submissionKey(i);
    return this.storage.transactionSync((): CoordinatorAnswer => {
      const retired = this.sql(
        "SELECT 1 FROM tombstones WHERE operation_id = ? OR submission_key = ?",
        i.operationId,
        key,
      ).toArray();
      if (retired.length) return { error: "conflict" };
      const existing = this.row(i.operationId);
      if (existing)
        return PAYLOAD.every(([k, col]) => existing[col] === i[k])
          ? { intent: intentOf(existing) }
          : { error: "conflict" };
      const live = this.sql(
        `SELECT * FROM intents WHERE submission_key = ? AND state IN ${LIVE}`,
        key,
      ).toArray()[0] as Row | undefined;
      if (live) return { intent: intentOf(live) };
      this.sql(
        `INSERT INTO intents (operation_id, submission_key, provider, account, generation, thread_id, video_id,
           parent_comment_id, text, digest, draft_revision, state, review_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`,
        i.operationId,
        key,
        i.provider,
        i.account,
        i.generation,
        i.threadId,
        i.videoId,
        i.parentCommentId,
        i.text,
        i.digest,
        i.draftRevision,
        i.reviewExpiresAt,
        now,
        now,
      );
      return { intent: intentOf(this.row(i.operationId)!) };
    });
  }

  private claim(operationId: string, digest: string, now: number): CoordinatorAnswer {
    const r = this.row(operationId);
    if (!r) return { error: "not_found" };
    if (r.digest !== digest) return { error: "conflict" };
    const claimed =
      this.sql(
        "UPDATE intents SET state = 'dispatching', claimed_at = ?, updated_at = ? WHERE operation_id = ? AND state = 'prepared' RETURNING operation_id",
        now,
        now,
        operationId,
      ).toArray().length === 1;
    return { intent: intentOf(this.row(operationId)!), claimed };
  }

  private settle(operationId: string, o: Outcome, now: number): CoordinatorAnswer {
    if (!o || !["sent", "rejected", "unknown"].includes(o.state)) return { error: "bad_request" };
    const r = this.row(operationId);
    if (!r) return { error: "not_found" };
    const settled =
      this.sql(
        `UPDATE intents SET state = ?, settled_at = ?, updated_at = ?, provider_comment_id = ?, failure_code = ?,
           failure_detail = ?, unknown_reason = ?
         WHERE operation_id = ? AND state = 'dispatching' RETURNING operation_id`,
        o.state,
        now,
        now,
        o.state === "sent" ? String(o.providerCommentId) : null,
        o.state === "rejected" ? String(o.code) : null,
        o.state === "rejected" && o.detail ? String(o.detail) : null,
        o.state === "unknown" ? String(o.reason) : null,
        operationId,
      ).toArray().length === 1;
    return { intent: intentOf(this.row(operationId)!), settled };
  }

  private transition(
    operationId: string,
    from: SendState,
    to: SendState,
    now: number,
  ): CoordinatorAnswer {
    if (!this.row(operationId)) return { error: "not_found" };
    this.sql(
      "UPDATE intents SET state = ?, updated_at = ? WHERE operation_id = ? AND state = ?",
      to,
      now,
      operationId,
      from,
    );
    return { intent: intentOf(this.row(operationId)!) };
  }
}
