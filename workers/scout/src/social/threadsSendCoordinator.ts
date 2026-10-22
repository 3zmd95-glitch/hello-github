/**
 * 📤 ThreadsSendCoordinator (packet DT-6B-2B-1, planning/tools/37-inbox-send.md): the claim authority of reviewed
 * Threads replies, a SQLite-backed Durable Object (wrangler.jsonc binding THREADS_SEND_COORDINATOR, migration
 * "v2-threads-send"), one object per `threads|<account>`. Separate from the YouTube SendCoordinator (one stage, its own
 * table and states, unchanged): a Threads reply is two provider writes, each behind its own atomic claim.
 *
 *   prepare          stores one immutable intent. The same operation id with the same payload returns it again; with
 *                    another payload it is `conflict`. Another operation id for the same live submission (provider,
 *                    account, draft revision, reply target, text digest) converges on the existing intent.
 *   claimCreate      prepared → creating, in one UPDATE … RETURNING, exactly once.
 *   recordContainer  creating → created with the provider's container id, durable BEFORE any publish claim.
 *   claimPublish     created → publishing, in one UPDATE … RETURNING, exactly once.
 *   settle           publishing → published (a string published id only); creating | publishing → rejected;
 *                    creating → unknown_creation; publishing → unknown_publication. Once.
 *   cancel           prepared → cancelled; nothing else.
 *
 * Every write increments `receipt_version`. No network call is made here. A prepared intent expires at its review
 * deadline; creating, created, publishing and both unknown states never expire, are never purged and are never claimed
 * again (no lease, no retry, no text/time matching). Finished rows (published, rejected, cancelled, expired) are purged
 * after RETENTION_MS; their ids (and a published row's submission) stay in `tombstones`. No token or seal key is ever
 * stored: the row holds ids, the reviewed text and its digest.
 *
 * Plain class with `fetch` (no `cloudflare:workers` import), so index.ts can export it while plain-Node tests import
 * index.ts. The caller passes `now`.
 */

import { PATH_ID_RE } from "./inboxReadCommon";

/** Finished rows are kept this long (90 days), then purged and tombstoned. */
export const RETENTION_MS = 90 * 86_400_000;

export type ThreadsSendState =
  | "prepared"
  | "creating"
  | "created"
  | "publishing"
  | "published"
  | "rejected"
  | "cancelled"
  | "expired"
  | "unknown_creation"
  | "unknown_publication";

export interface ThreadsPrepareInput {
  operationId: string;
  account: string;
  generation: string;
  rootPostId: string;
  replyToId: string;
  text: string;
  digest: string;
  draftRevision: string;
  /** ms since epoch. */
  reviewExpiresAt: number;
}

export type ThreadsOutcome =
  | { state: "published"; publishedId: string }
  | { state: "rejected"; code: string; detail?: string }
  | { state: "unknown_creation"; reason: string }
  | { state: "unknown_publication"; reason: string };

export type ThreadsCall =
  | { op: "prepare"; input: ThreadsPrepareInput; now: number }
  | { op: "claimCreate"; operationId: string; digest: string; now: number }
  | { op: "recordContainer"; operationId: string; containerId: string; now: number }
  | { op: "claimPublish"; operationId: string; digest: string; now: number }
  | { op: "settle"; operationId: string; outcome: ThreadsOutcome; now: number }
  | { op: "cancel"; operationId: string; now: number }
  | { op: "get"; operationId: string; now: number };

export interface ThreadsIntent {
  operationId: string;
  provider: "threads";
  account: string;
  generation: string;
  rootPostId: string;
  replyToId: string;
  text: string;
  digest: string;
  draftRevision: string;
  state: ThreadsSendState;
  reviewExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  createClaimedAt?: string;
  containerId?: string;
  /** When the container id became durable (column created_at_provider). */
  containerRecordedAt?: string;
  publishClaimedAt?: string;
  publishedId?: string;
  failureCode?: string;
  failureDetail?: string;
  unknownReason?: string;
  receiptVersion: number;
}

export type ThreadsAnswer =
  | { intent: ThreadsIntent; claimed?: boolean; recorded?: boolean; settled?: boolean }
  | { error: "conflict" | "not_found" | "bad_request" };

type Row = Record<string, string | number | null>;

interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] };
}
interface StorageLike {
  sql: SqlLike;
  transactionSync<T>(fn: () => T): T;
}

/** States one live submission can be in: a second intent for it could post twice or hide an uncertain one. */
const LIVE =
  "('prepared','creating','created','publishing','published','unknown_creation','unknown_publication')";
const FINISHED = "('published','rejected','cancelled','expired')";
/** The one state each outcome may settle from. */
const SETTLES_FROM: Record<ThreadsOutcome["state"], string> = {
  published: "('publishing')",
  rejected: "('creating','publishing')",
  unknown_creation: "('creating')",
  unknown_publication: "('publishing')",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS intents (
  operation_id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL,
  account TEXT NOT NULL,
  generation TEXT NOT NULL,
  root_post_id TEXT NOT NULL,
  reply_to_id TEXT NOT NULL,
  text TEXT NOT NULL,
  digest TEXT NOT NULL,
  draft_revision TEXT NOT NULL,
  state TEXT NOT NULL,
  review_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  create_claimed_at INTEGER,
  container_id TEXT,
  created_at_provider INTEGER,
  publish_claimed_at INTEGER,
  published_id TEXT,
  failure_code TEXT,
  failure_detail TEXT,
  unknown_reason TEXT,
  receipt_version INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS live_submission ON intents (submission_key) WHERE state IN ${LIVE};
CREATE TABLE IF NOT EXISTS tombstones (operation_id TEXT PRIMARY KEY, submission_key TEXT);
CREATE INDEX IF NOT EXISTS tombstone_submission ON tombstones (submission_key);
`;

const iso = (ms: unknown) => new Date(Number(ms)).toISOString();

function intentOf(r: Row): ThreadsIntent {
  const at = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: iso(v) });
  const opt = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: v });
  return {
    operationId: String(r.operation_id),
    provider: "threads",
    account: String(r.account),
    generation: String(r.generation),
    rootPostId: String(r.root_post_id),
    replyToId: String(r.reply_to_id),
    text: String(r.text),
    digest: String(r.digest),
    draftRevision: String(r.draft_revision),
    state: r.state as ThreadsSendState,
    reviewExpiresAt: iso(r.review_expires_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ...at("createClaimedAt", r.create_claimed_at),
    ...opt("containerId", r.container_id),
    ...at("containerRecordedAt", r.created_at_provider),
    ...at("publishClaimedAt", r.publish_claimed_at),
    ...opt("publishedId", r.published_id),
    ...opt("failureCode", r.failure_code),
    ...opt("failureDetail", r.failure_detail),
    ...opt("unknownReason", r.unknown_reason),
    receiptVersion: Number(r.receipt_version),
  } as ThreadsIntent;
}

const submissionKey = (i: ThreadsPrepareInput) =>
  ["threads", i.account, i.draftRevision, i.replyToId, i.digest].join("|");

/** The fields an operation id is bound to: a retry must repeat every one of them. */
const PAYLOAD = [
  ["account", "account"],
  ["generation", "generation"],
  ["rootPostId", "root_post_id"],
  ["replyToId", "reply_to_id"],
  ["text", "text"],
  ["digest", "digest"],
  ["draftRevision", "draft_revision"],
] as const;

const isId = (v: unknown): v is string => typeof v === "string" && PATH_ID_RE.test(v);

export class ThreadsSendCoordinator {
  private readonly storage: StorageLike;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage as unknown as StorageLike;
    for (const statement of SCHEMA.split(";").map((s) => s.trim()))
      if (statement) this.storage.sql.exec(statement);
  }

  async fetch(req: Request): Promise<Response> {
    let call: ThreadsCall;
    try {
      call = (await req.json()) as ThreadsCall;
    } catch {
      return Response.json({ error: "bad_request" });
    }
    return Response.json(this.run(call));
  }

  run(call: ThreadsCall): ThreadsAnswer {
    if (!call || typeof call !== "object" || !Number.isFinite(call.now))
      return { error: "bad_request" };
    // Synchronous from here on: a Durable Object runs this without interleaving another request.
    this.expire(call.now);
    switch (call.op) {
      case "prepare":
        return this.prepare(call.input, call.now);
      case "claimCreate":
        return this.step(call.operationId, call.digest, "prepared", "creating", call.now);
      case "recordContainer":
        return this.record(call.operationId, call.containerId, call.now);
      case "claimPublish":
        return this.step(call.operationId, call.digest, "created", "publishing", call.now);
      case "settle":
        return this.settle(call.operationId, call.outcome, call.now);
      case "cancel": {
        if (!this.row(call.operationId)) return { error: "not_found" };
        this.sql(
          `UPDATE intents SET state = 'cancelled', updated_at = ?, receipt_version = receipt_version + 1
           WHERE operation_id = ? AND state = 'prepared'`,
          call.now,
          call.operationId,
        );
        return { intent: intentOf(this.row(call.operationId)!) };
      }
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
      `UPDATE intents SET state = 'expired', updated_at = ?, receipt_version = receipt_version + 1
       WHERE state = 'prepared' AND review_expires_at <= ?`,
      now,
      now,
    );
  }

  private purge(now: number) {
    this.storage.transactionSync(() => {
      const cutoff = now - RETENTION_MS;
      this.sql(
        `INSERT OR IGNORE INTO tombstones (operation_id, submission_key)
         SELECT operation_id, CASE WHEN state = 'published' THEN submission_key END FROM intents
         WHERE state IN ${FINISHED} AND updated_at < ?`,
        cutoff,
      );
      this.sql(`DELETE FROM intents WHERE state IN ${FINISHED} AND updated_at < ?`, cutoff);
    });
  }

  private prepare(i: ThreadsPrepareInput, now: number): ThreadsAnswer {
    if (!i || typeof i !== "object" || typeof i.operationId !== "string")
      return { error: "bad_request" };
    if (!PAYLOAD.every(([k]) => typeof i[k] === "string") || !Number.isFinite(i.reviewExpiresAt))
      return { error: "bad_request" };
    this.purge(now);
    const key = submissionKey(i);
    return this.storage.transactionSync((): ThreadsAnswer => {
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
        `INSERT INTO intents (operation_id, submission_key, account, generation, root_post_id, reply_to_id, text,
           digest, draft_revision, state, review_expires_at, created_at, updated_at, receipt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, 1)`,
        i.operationId,
        key,
        i.account,
        i.generation,
        i.rootPostId,
        i.replyToId,
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

  /** One stage claim: `from` → `to` in a single UPDATE … RETURNING; any other state is returned as is. */
  private step(
    operationId: string,
    digest: string,
    from: "prepared" | "created",
    to: "creating" | "publishing",
    now: number,
  ): ThreadsAnswer {
    const r = this.row(operationId);
    if (!r) return { error: "not_found" };
    if (r.digest !== digest) return { error: "conflict" };
    const stamp = to === "creating" ? "create_claimed_at" : "publish_claimed_at";
    const claimed =
      this.sql(
        `UPDATE intents SET state = ?, ${stamp} = ?, updated_at = ?, receipt_version = receipt_version + 1
         WHERE operation_id = ? AND state = ? RETURNING operation_id`,
        to,
        now,
        now,
        operationId,
        from,
      ).toArray().length === 1;
    return { intent: intentOf(this.row(operationId)!), claimed };
  }

  private record(operationId: string, containerId: unknown, now: number): ThreadsAnswer {
    if (!isId(containerId)) return { error: "bad_request" };
    if (!this.row(operationId)) return { error: "not_found" };
    const recorded =
      this.sql(
        `UPDATE intents SET state = 'created', container_id = ?, created_at_provider = ?, updated_at = ?,
           receipt_version = receipt_version + 1
         WHERE operation_id = ? AND state = 'creating' AND container_id IS NULL RETURNING operation_id`,
        containerId,
        now,
        now,
        operationId,
      ).toArray().length === 1;
    return { intent: intentOf(this.row(operationId)!), recorded };
  }

  private settle(operationId: string, o: ThreadsOutcome, now: number): ThreadsAnswer {
    if (!o || typeof o !== "object" || !Object.hasOwn(SETTLES_FROM, o.state))
      return { error: "bad_request" };
    if (o.state === "published" && !isId(o.publishedId)) return { error: "bad_request" };
    if (!this.row(operationId)) return { error: "not_found" };
    const settled =
      this.sql(
        `UPDATE intents SET state = ?, updated_at = ?, published_id = ?, failure_code = ?, failure_detail = ?,
           unknown_reason = ?, receipt_version = receipt_version + 1
         WHERE operation_id = ? AND state IN ${SETTLES_FROM[o.state]} RETURNING operation_id`,
        o.state,
        now,
        o.state === "published" ? o.publishedId : null,
        o.state === "rejected" ? String(o.code) : null,
        o.state === "rejected" && o.detail ? String(o.detail) : null,
        o.state === "unknown_creation" || o.state === "unknown_publication"
          ? String(o.reason)
          : null,
        operationId,
      ).toArray().length === 1;
    return { intent: intentOf(this.row(operationId)!), settled };
  }
}
