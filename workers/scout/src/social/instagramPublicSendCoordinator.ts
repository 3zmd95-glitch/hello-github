/**
 * 📤 InstagramPublicSendCoordinator (packet DT-6B-2C-1, planning/tools/37-inbox-send.md): the claim authority of every
 * Instagram public comment reply, a SQLite-backed Durable Object (wrangler.jsonc binding INSTAGRAM_PUBLIC_SEND_COORDINATOR,
 * migration "v3-instagram-public-send"), one object per `instagram|<igUserId>` (`/me`'s `user_id`). Separate from the
 * YouTube and Threads coordinators (unchanged).
 *
 * Two tables in one object, so a manual confirm claims in ONE transaction:
 *   intents         the reviewed manual operations (immutable text, digest, target, generation, review deadline)
 *   public_effects  one row per (account, comment): whoever inserts it first owns that comment's public reply. The
 *                   actor is `manual:<operationId>` (inboxSendInstagram.ts) or `auto:<automationId>` (replies.ts).
 *
 *   prepare       stores one immutable intent; same operation + payload returns it, another payload is `conflict`;
 *                 another operation for the same live submission converges. Reserves no effect.
 *   claimConfirm  one transaction: intent prepared → dispatching (UPDATE … RETURNING), then INSERT the effect
 *                 ON CONFLICT DO NOTHING RETURNING. An effect already there (or retired) makes the intent
 *                 `already_claimed`: terminal and truthful, and the caller sends nothing.
 *   claimAuto     the same INSERT for the automatic acknowledgement; the loser gets the existing row.
 *   settle        claimed → sent | rejected | unknown, once, by the claiming actor only; mirrored into the manual intent.
 *   cancel        prepared → cancelled; never touches an effect.
 *
 * Local restriction of this first slice (not an Instagram rule): one public attempt per comment. A claimed effect is
 * never reopened by expiry, purge, failure or a new operation; an explicit follow-up/override is later reviewed work.
 * `claimed` and `unknown` effects (and dispatching/unknown intents) never expire and are never purged. Finished rows
 * are purged after RETENTION_MS into `tombstones` (operation ids, sent submissions, effects), so nothing purged is
 * usable again. Every write increments `receipt_version`. No network call is made here, and no token is stored.
 *
 * DT-6B-2C-1-R1: the purge runs from `prepare`, `claimAuto` and `settle` (automatic-only traffic never prepares), at
 * most once per PURGE_EVERY_MS: the last run time lives in `meta` and is written in the purge's own transaction, so a
 * failed purge is retried by the next call.
 *
 * Plain class with `fetch` (no `cloudflare:workers` import), so index.ts can export it while plain-Node tests import
 * index.ts. The caller passes `now`.
 */

import { PATH_ID_RE } from "./inboxReadCommon";

/** Finished rows are kept this long (90 days), then purged and tombstoned. */
export const RETENTION_MS = 90 * 86_400_000;
/** The purge runs at most this often (one hour). */
export const PURGE_EVERY_MS = 3_600_000;

export type IgSendState =
  | "prepared"
  | "dispatching"
  | "sent"
  | "rejected"
  | "unknown"
  | "expired"
  | "cancelled"
  | "already_claimed";

export type EffectState = "claimed" | "sent" | "rejected" | "unknown";

export interface IgPrepareInput {
  operationId: string;
  account: string;
  generation: string;
  mediaId: string;
  commentId: string;
  text: string;
  digest: string;
  draftRevision: string;
  /** ms since epoch. */
  reviewExpiresAt: number;
}

export type IgOutcome =
  | { state: "sent"; providerReplyId: string }
  | { state: "rejected"; code: string; detail?: string }
  | { state: "unknown"; reason: string };

export type IgPublicCall =
  | { op: "prepare"; input: IgPrepareInput; now: number }
  | { op: "claimConfirm"; operationId: string; digest: string; now: number }
  | { op: "claimAuto"; account: string; commentId: string; automationId: string; now: number }
  | {
      op: "settle";
      account: string;
      commentId: string;
      actor: string;
      outcome: IgOutcome;
      now: number;
    }
  | { op: "cancel"; operationId: string; now: number }
  | { op: "get"; operationId: string; now: number }
  | { op: "getEffect"; account: string; commentId: string; now: number };

export interface IgIntent {
  operationId: string;
  provider: "instagram";
  account: string;
  generation: string;
  mediaId: string;
  commentId: string;
  text: string;
  digest: string;
  draftRevision: string;
  state: IgSendState;
  reviewExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  settledAt?: string;
  providerReplyId?: string;
  failureCode?: string;
  /** For already_claimed: who holds the comment ("automatic", "manual") or "retired" (a purged effect). */
  failureDetail?: string;
  unknownReason?: string;
  receiptVersion: number;
}

export interface IgEffect {
  account: string;
  commentId: string;
  actor: string;
  state: EffectState;
  claimedAt: string;
  settledAt?: string;
  providerReplyId?: string;
  failureCode?: string;
  unknownReason?: string;
  receiptVersion: number;
}

export type IgPublicAnswer =
  | { intent: IgIntent; claimed?: boolean; effect?: IgEffect }
  | { claimed: boolean; effect?: IgEffect }
  | { effect: IgEffect; settled?: boolean; intent?: IgIntent }
  | { error: "conflict" | "not_found" | "bad_request" };

type Row = Record<string, string | number | null>;

interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): unknown[] };
}
interface StorageLike {
  sql: SqlLike;
  transactionSync<T>(fn: () => T): T;
}

/** States one live submission can be in: a second intent for it could send twice or hide an uncertain one. */
const LIVE = "('prepared','dispatching','sent','unknown')";
const FINISHED = "('sent','rejected','expired','cancelled','already_claimed')";
const ACTOR_RE = /^(manual|auto):[A-Za-z0-9_-]{1,100}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS intents (
  operation_id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL,
  account TEXT NOT NULL,
  generation TEXT NOT NULL,
  media_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  text TEXT NOT NULL,
  digest TEXT NOT NULL,
  draft_revision TEXT NOT NULL,
  state TEXT NOT NULL,
  review_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed_at INTEGER,
  settled_at INTEGER,
  provider_reply_id TEXT,
  failure_code TEXT,
  failure_detail TEXT,
  unknown_reason TEXT,
  receipt_version INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS live_submission ON intents (submission_key) WHERE state IN ${LIVE};
CREATE TABLE IF NOT EXISTS public_effects (
  account TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  state TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  settled_at INTEGER,
  provider_reply_id TEXT,
  failure_code TEXT,
  unknown_reason TEXT,
  receipt_version INTEGER NOT NULL,
  PRIMARY KEY (account, comment_id)
);
CREATE TABLE IF NOT EXISTS tombstones (key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)
`;

const iso = (ms: unknown) => new Date(Number(ms)).toISOString();
const at = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: iso(v) });
const opt = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: v });

function intentOf(r: Row): IgIntent {
  return {
    operationId: String(r.operation_id),
    provider: "instagram",
    account: String(r.account),
    generation: String(r.generation),
    mediaId: String(r.media_id),
    commentId: String(r.comment_id),
    text: String(r.text),
    digest: String(r.digest),
    draftRevision: String(r.draft_revision),
    state: r.state as IgSendState,
    reviewExpiresAt: iso(r.review_expires_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ...at("claimedAt", r.claimed_at),
    ...at("settledAt", r.settled_at),
    ...opt("providerReplyId", r.provider_reply_id),
    ...opt("failureCode", r.failure_code),
    ...opt("failureDetail", r.failure_detail),
    ...opt("unknownReason", r.unknown_reason),
    receiptVersion: Number(r.receipt_version),
  } as IgIntent;
}

function effectOf(r: Row): IgEffect {
  return {
    account: String(r.account),
    commentId: String(r.comment_id),
    actor: String(r.actor),
    state: r.state as EffectState,
    claimedAt: iso(r.claimed_at),
    ...at("settledAt", r.settled_at),
    ...opt("providerReplyId", r.provider_reply_id),
    ...opt("failureCode", r.failure_code),
    ...opt("unknownReason", r.unknown_reason),
    receiptVersion: Number(r.receipt_version),
  } as IgEffect;
}

const submissionKey = (i: IgPrepareInput) =>
  ["instagram", i.account, i.draftRevision, i.commentId, i.digest].join("|");
const effectKey = (account: string, commentId: string) => `effect|${account}|${commentId}`;

/** The fields an operation id is bound to: a retry must repeat every one of them. */
const PAYLOAD = [
  ["account", "account"],
  ["generation", "generation"],
  ["mediaId", "media_id"],
  ["commentId", "comment_id"],
  ["text", "text"],
  ["digest", "digest"],
  ["draftRevision", "draft_revision"],
] as const;

const isId = (v: unknown): v is string => typeof v === "string" && PATH_ID_RE.test(v);

export class InstagramPublicSendCoordinator {
  private readonly storage: StorageLike;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage as unknown as StorageLike;
    for (const statement of SCHEMA.split(";").map((s) => s.trim()))
      if (statement) this.storage.sql.exec(statement);
  }

  async fetch(req: Request): Promise<Response> {
    let call: IgPublicCall;
    try {
      call = (await req.json()) as IgPublicCall;
    } catch {
      return Response.json({ error: "bad_request" });
    }
    return Response.json(this.run(call));
  }

  run(call: IgPublicCall): IgPublicAnswer {
    if (!call || typeof call !== "object" || !Number.isFinite(call.now))
      return { error: "bad_request" };
    // Synchronous from here on: a Durable Object runs this without interleaving another request.
    this.expire(call.now);
    if (call.op === "prepare" || call.op === "claimAuto" || call.op === "settle")
      this.purge(call.now);
    switch (call.op) {
      case "prepare":
        return this.prepare(call.input, call.now);
      case "claimConfirm":
        return this.claimConfirm(call.operationId, call.digest, call.now);
      case "claimAuto":
        return this.claimAuto(call.account, call.commentId, call.automationId, call.now);
      case "settle":
        return this.settle(call, call.now);
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
      case "getEffect": {
        const e = this.effect(call.account, call.commentId);
        return e ? { effect: effectOf(e) } : { error: "not_found" };
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

  private effect(account: unknown, commentId: unknown): Row | null {
    if (typeof account !== "string" || typeof commentId !== "string") return null;
    return (
      (this.sql(
        "SELECT * FROM public_effects WHERE account = ? AND comment_id = ?",
        account,
        commentId,
      ).toArray()[0] as Row | undefined) ?? null
    );
  }

  private retired(key: string): boolean {
    return this.sql("SELECT 1 FROM tombstones WHERE key = ?", key).toArray().length > 0;
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

  /** Finished rows past RETENTION_MS become tombstones; at most once per PURGE_EVERY_MS (a clock moved back runs it). */
  private purge(now: number) {
    const last = this.sql("SELECT value FROM meta WHERE key = 'purged_at'").toArray()[0] as
      Row | undefined;
    if (last && now >= Number(last.value) && now - Number(last.value) < PURGE_EVERY_MS) return;
    this.storage.transactionSync(() => {
      this.sql(
        "INSERT INTO meta (key, value) VALUES ('purged_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        now,
      );
      const cutoff = now - RETENTION_MS;
      this.sql(
        `INSERT OR IGNORE INTO tombstones (key)
         SELECT 'op|' || operation_id FROM intents WHERE state IN ${FINISHED} AND updated_at < ?
         UNION ALL
         SELECT 'sub|' || submission_key FROM intents WHERE state = 'sent' AND updated_at < ?
         UNION ALL
         SELECT 'effect|' || account || '|' || comment_id FROM public_effects
           WHERE state IN ('sent','rejected') AND settled_at < ?`,
        cutoff,
        cutoff,
        cutoff,
      );
      this.sql(`DELETE FROM intents WHERE state IN ${FINISHED} AND updated_at < ?`, cutoff);
      this.sql(
        "DELETE FROM public_effects WHERE state IN ('sent','rejected') AND settled_at < ?",
        cutoff,
      );
    });
  }

  private prepare(i: IgPrepareInput, now: number): IgPublicAnswer {
    if (!i || typeof i !== "object" || typeof i.operationId !== "string")
      return { error: "bad_request" };
    if (!PAYLOAD.every(([k]) => typeof i[k] === "string") || !Number.isFinite(i.reviewExpiresAt))
      return { error: "bad_request" };
    if (![i.account, i.mediaId, i.commentId].every(isId)) return { error: "bad_request" };
    const key = submissionKey(i);
    return this.storage.transactionSync((): IgPublicAnswer => {
      if (this.retired(`op|${i.operationId}`) || this.retired(`sub|${key}`))
        return { error: "conflict" };
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
        `INSERT INTO intents (operation_id, submission_key, account, generation, media_id, comment_id, text, digest,
           draft_revision, state, review_expires_at, created_at, updated_at, receipt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, 1)`,
        i.operationId,
        key,
        i.account,
        i.generation,
        i.mediaId,
        i.commentId,
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

  /** The effect insert both claims share; null when the row (or its tombstone) already exists. */
  private insertEffect(account: string, commentId: string, actor: string, now: number) {
    if (this.retired(effectKey(account, commentId))) return null;
    return (
      (this.sql(
        `INSERT INTO public_effects (account, comment_id, actor, state, claimed_at, receipt_version)
         VALUES (?, ?, ?, 'claimed', ?, 1) ON CONFLICT DO NOTHING RETURNING *`,
        account,
        commentId,
        actor,
        now,
      ).toArray()[0] as Row | undefined) ?? null
    );
  }

  private claimConfirm(operationId: string, digest: string, now: number): IgPublicAnswer {
    const r = this.row(operationId);
    if (!r) return { error: "not_found" };
    if (r.digest !== digest) return { error: "conflict" };
    return this.storage.transactionSync((): IgPublicAnswer => {
      const moved = this.sql(
        `UPDATE intents SET state = 'dispatching', claimed_at = ?, updated_at = ?, receipt_version = receipt_version + 1
         WHERE operation_id = ? AND state = 'prepared' RETURNING operation_id`,
        now,
        now,
        operationId,
      ).toArray().length;
      if (!moved) return { intent: intentOf(this.row(operationId)!), claimed: false };
      const account = String(r.account);
      const commentId = String(r.comment_id);
      const won = this.insertEffect(account, commentId, `manual:${operationId}`, now);
      if (won)
        return { intent: intentOf(this.row(operationId)!), claimed: true, effect: effectOf(won) };
      // Someone else holds this comment's public reply: this operation ends here, truthfully, and sends nothing.
      const held = this.effect(account, commentId);
      const by = !held
        ? "retired"
        : String(held.actor).startsWith("auto:")
          ? "automatic"
          : "manual";
      // Same transaction as the move above: one receipt write, so one version step from `prepared`.
      this.sql(
        `UPDATE intents SET state = 'already_claimed', claimed_at = NULL, updated_at = ?, failure_code = 'already_claimed',
           failure_detail = ?, receipt_version = ?
         WHERE operation_id = ?`,
        now,
        by,
        Number(r.receipt_version) + 1,
        operationId,
      );
      return {
        intent: intentOf(this.row(operationId)!),
        claimed: false,
        ...(held ? { effect: effectOf(held) } : {}),
      };
    });
  }

  private claimAuto(
    account: string,
    commentId: string,
    automationId: string,
    now: number,
  ): IgPublicAnswer {
    if (!isId(account) || !isId(commentId) || !ACTOR_RE.test(`auto:${automationId}`))
      return { error: "bad_request" };
    const won = this.insertEffect(account, commentId, `auto:${automationId}`, now);
    if (won) return { claimed: true, effect: effectOf(won) };
    const held = this.effect(account, commentId);
    return { claimed: false, ...(held ? { effect: effectOf(held) } : {}) };
  }

  private settle(c: Extract<IgPublicCall, { op: "settle" }>, now: number): IgPublicAnswer {
    const o = c.outcome;
    if (!o || typeof o !== "object" || !["sent", "rejected", "unknown"].includes(o.state))
      return { error: "bad_request" };
    if (o.state === "sent" && !isId(o.providerReplyId)) return { error: "bad_request" };
    if (typeof c.actor !== "string" || !ACTOR_RE.test(c.actor)) return { error: "bad_request" };
    if (!this.effect(c.account, c.commentId)) return { error: "not_found" };
    const replyId = o.state === "sent" ? o.providerReplyId : null;
    const code = o.state === "rejected" ? String(o.code) : null;
    const detail = o.state === "rejected" && o.detail ? String(o.detail) : null;
    const reason = o.state === "unknown" ? String(o.reason) : null;
    return this.storage.transactionSync((): IgPublicAnswer => {
      const settled =
        this.sql(
          `UPDATE public_effects SET state = ?, settled_at = ?, provider_reply_id = ?, failure_code = ?, unknown_reason = ?,
             receipt_version = receipt_version + 1
           WHERE account = ? AND comment_id = ? AND actor = ? AND state = 'claimed' RETURNING account`,
          o.state,
          now,
          replyId,
          code,
          reason,
          c.account,
          c.commentId,
          c.actor,
        ).toArray().length === 1;
      const op = c.actor.startsWith("manual:") ? c.actor.slice("manual:".length) : null;
      if (settled && op)
        this.sql(
          `UPDATE intents SET state = ?, settled_at = ?, updated_at = ?, provider_reply_id = ?, failure_code = ?,
             failure_detail = ?, unknown_reason = ?, receipt_version = receipt_version + 1
           WHERE operation_id = ? AND state = 'dispatching'`,
          o.state,
          now,
          now,
          replyId,
          code,
          detail,
          reason,
          op,
        );
      const intent = op ? this.row(op) : null;
      return {
        effect: effectOf(this.effect(c.account, c.commentId)!),
        settled,
        ...(intent ? { intent: intentOf(intent) } : {}),
      };
    });
  }
}
