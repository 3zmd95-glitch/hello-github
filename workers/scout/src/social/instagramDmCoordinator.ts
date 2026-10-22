/**
 * 💬 InstagramDmCoordinator (packet DT-6B-2C-2, planning/tools/37-inbox-send.md): the durable authority of every
 * existing-conversation Instagram DM the Worker sends, a SQLite-backed Durable Object (wrangler.jsonc binding
 * INSTAGRAM_DM_COORDINATOR, migration "v4-instagram-dm"), one object per `instagram-dm|<igUserId>` (`/me`'s `user_id`).
 * Separate from the public-reply, Threads and YouTube coordinators (unchanged). Comment-triggered private replies
 * (`comment_id` recipients, replyCore.ts) are not coordinated here.
 *
 *   conversations     mode 'auto' | 'human' and a revision per conversation (no row = auto at revision 0)
 *   effects           one row per (account, conversation, inbound message): whoever inserts it first owns the answer
 *                     to that message. Actor `auto:<ruleId|default>` (inbox.ts) or `manual:<operationId>`
 *                     (inboxSendInstagramDm.ts). Payload digest and connection generation are stored for audit only.
 *   default_cooldown  per (account, recipient): when the default reply was last claimed, and by which effect
 *   tombstones, meta  purged effect keys and operation ids (permanent) and the last purge time
 *
 *   claim     ONE transaction: an automatic actor in a `human` conversation → blocked_by_takeover; an effect (or its
 *             tombstone) for the inbound event → already_claimed (same event by another actor, duplicate poll or
 *             same-account reconnect); for the default reply a cooldown not yet passed → cooldown; else INSERT the
 *             effect `claimed` and (default reply) UPSERT the cooldown → claimed. A later inbound message is another
 *             key, so a conversation is never locked by an earlier effect.
 *   settle    claimed → sent (message id) | rejected (code) | unknown (reason), once, by the claiming actor. The
 *             cooldown stays reserved after sent and unknown; only a typed `rejected` releases it.
 *   takeover  / resume: compare-and-set on the expected revision (mode human / auto, revision + 1). Takeover answers
 *             the claimed effects in flight in that conversation (it cannot retract them). Neither frees an effect.
 *   status    the conversation, and the effect of one inbound event.
 *
 * No timeouts anywhere: `claimed` and `unknown` effects are kept forever. Settled effects (`sent`, `rejected`) are
 * purged after RETENTION_MS into `tombstones`, so nothing purged is claimable again. The purge runs from `claim` and
 * `settle` (automatic-only traffic purges too), at most once per PURGE_EVERY_MS, in its own transaction with the
 * `meta` time (a failure rolls back and the next call retries). Every write increments `receipt_version`. No network
 * call is made here and no token is stored.
 *
 * DT-6B-2C-3 (additive, inboxSendInstagramDm.ts): reviewed manual DMs and verified conversation control handles.
 *   intents   immutable reviewed operations: account, generation, conversation, recipient, inbound message and its
 *             time, exact canonical text, digest (the exact POST body's SHA-256), draft revision, review deadline.
 *             prepareIntent stores one and claims nothing (same id + payload → it; a changed payload → conflict;
 *             another id for the identical live submission → that intent; a tombstoned id → conflict).
 *             claimConfirm is ONE transaction: prepared + unexpired + digest → the automation's own claim of
 *             (account, conversation, inbound) with actor `manual:<operationId>` (a manual actor is never blocked by
 *             a takeover and never changes the mode) → intent `dispatching`; a prior effect or tombstone → intent
 *             `already_claimed` (automatic | manual | retired). settle of a manual actor updates its intent in the
 *             same transaction (settleManual addresses it by operation). cancelIntent ends `prepared` only. A
 *             prepared intent past its deadline becomes `expired` (its id tombstoned) before any call reads it.
 *   controls  opaque handles minted only by registerControl, which the route calls after fresh ownership proof; a
 *             repeat for the same (conversation, recipient) converges, another recipient is a conflict.
 *             controlStatus / controlTakeover / controlResume reach the conversation through the handle only; the
 *             CAS runs once and the answer carries at most CONTROL_ROWS_MAX claimed rows plus the truthful
 *             `inFlightTotal`, `inFlightTruncated` and `uncertainTotal` (retained unknown effects).
 *   DT-6B-2C-3-R1: a successful controlStatus refreshes the handle's `used_at` (its last use) in its own small write;
 *   a control CAS conflict also carries the handle (`control`) so the route can bind the conflict to its target.
 *   Capacity (local policy): INTENTS_OPEN_MAX open intents (prepared + dispatching) and CONTROLS_MAX handles per
 *   account, refused as `capacity`; nothing is evicted to make room. The hourly purge also tombstones (`op|<id>`) and
 *   deletes terminal intents (sent, rejected, already_claimed, cancelled, expired) after RETENTION_MS, and deletes
 *   handles unused for RETENTION_MS; it never touches modes, claimed/unknown effects, dispatching/unknown intents or
 *   cooldowns. The internal raw `takeover`/`resume` ops are unchanged (no route; unbounded in-flight list).
 *
 * Plain class with `fetch` (no `cloudflare:workers` import), so index.ts can export it while plain-Node tests import
 * index.ts. The caller passes `now`.
 */

import { PATH_ID_RE } from "./inboxReadCommon";

/** Settled effects are kept this long (90 days), then purged and tombstoned. */
export const RETENTION_MS = 90 * 86_400_000;
/** The purge runs at most this often (one hour). */
export const PURGE_EVERY_MS = 3_600_000;
/** Open intents (prepared + dispatching) per account. Local policy. */
export const INTENTS_OPEN_MAX = 200;
/** Control handles per account. Local policy. */
export const CONTROLS_MAX = 100;
/** Claimed rows a control answer carries at most. Local policy. */
export const CONTROL_ROWS_MAX = 20;

/** Conversation, recipient and message ids as the Instagram inbox reader accepts them (base64 ids may end in `=`). */
export const DM_ID_RE = /^[A-Za-z0-9_=-]{1,256}$/;
export const ACTOR_RE = /^(auto|manual):[A-Za-z0-9_-]{1,100}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const GEN_RE = /^[0-9a-f]{32}$/;
const CODE_RE = /^[a-z0-9_]{1,64}$/;
const REASON_RE = /^[a-z_-]{1,64}$/;
/** A provider message id: non-empty printable text without spaces. */
const MESSAGE_ID_RE = /^[\x21-\x7e]{1,512}$/;
const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REVISION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HANDLE_RE = /^[0-9a-f]{32}$/;
/**
 * Stored text is bounded here too, in UTF-16 units: a storage cap only, never send eligibility (the route admits new
 * text up to 1000 UTF-8 bytes; intents stored under the earlier 1000-code-point policy stay readable).
 */
const TEXT_CHARS_MAX = 4000;

export type DmEffectState = "claimed" | "sent" | "rejected" | "unknown";
export type DmMode = "auto" | "human";

export interface DmKey {
  account: string;
  conversationId: string;
  inboundMessageId: string;
}

export interface DmClaimInput extends DmKey {
  recipientId: string;
  actor: string;
  payloadDigest: string;
  generation: string;
  isDefault: boolean;
  cooldownMs: number;
}

export type DmOutcome =
  | { state: "sent"; providerMessageId: string }
  | { state: "rejected"; code: string }
  | { state: "unknown"; reason: string };

export type DmIntentState =
  | "prepared"
  | "dispatching"
  | "sent"
  | "rejected"
  | "unknown"
  | "already_claimed"
  | "cancelled"
  | "expired";

export interface DmPrepareInput {
  operationId: string;
  account: string;
  generation: string;
  conversationId: string;
  recipientId: string;
  inboundMessageId: string;
  /** The inbound message's time, ms since epoch. */
  inboundAt: number;
  text: string;
  digest: string;
  draftRevision: string;
  /** ms since epoch. */
  reviewExpiresAt: number;
}

export interface DmIntent {
  operationId: string;
  account: string;
  generation: string;
  conversationId: string;
  recipientId: string;
  inboundMessageId: string;
  inboundAt: string;
  text: string;
  digest: string;
  draftRevision: string;
  state: DmIntentState;
  reviewExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  settledAt?: string;
  providerMessageId?: string;
  failureCode?: string;
  /** For already_claimed: who holds the inbound event ("automatic", "manual") or "retired" (a purged effect). */
  failureDetail?: string;
  unknownReason?: string;
  receiptVersion: number;
}

export interface DmControl {
  handleId: string;
  account: string;
  conversationId: string;
  recipientId: string;
  registeredGeneration: string;
  evidenceDigest: string;
  createdAt: string;
  usedAt: string;
}

export type DmCall =
  | ({ op: "claim"; now: number } & DmClaimInput)
  | ({ op: "settle"; actor: string; outcome: DmOutcome; now: number } & DmKey)
  | {
      op: "takeover" | "resume";
      account: string;
      conversationId: string;
      expectedRevision: number;
      now: number;
    }
  | {
      op: "status";
      account: string;
      conversationId: string;
      inboundMessageId?: string;
      now: number;
    }
  | { op: "prepareIntent"; input: DmPrepareInput; now: number }
  | { op: "claimConfirm"; account: string; operationId: string; digest: string; now: number }
  | { op: "settleManual"; account: string; operationId: string; outcome: DmOutcome; now: number }
  | { op: "cancelIntent" | "getIntent"; account: string; operationId: string; now: number }
  | {
      op: "registerControl";
      account: string;
      conversationId: string;
      recipientId: string;
      generation: string;
      evidenceDigest: string;
      now: number;
    }
  | { op: "controlStatus"; account: string; handleId: string; now: number }
  | {
      op: "controlTakeover" | "controlResume";
      account: string;
      handleId: string;
      expectedRevision: number;
      now: number;
    };

export interface DmConversation {
  account: string;
  conversationId: string;
  mode: DmMode;
  revision: number;
  updatedAt?: string;
}

export interface DmEffect extends DmKey {
  recipientId: string;
  actor: string;
  payloadDigest: string;
  generation: string;
  state: DmEffectState;
  claimedAt: string;
  settledAt?: string;
  providerMessageId?: string;
  failureCode?: string;
  unknownReason?: string;
  receiptVersion: number;
}

export interface DmCooldown {
  account: string;
  recipientId: string;
  lastDefaultAt: string;
  effectKey: string;
}

/** A control handle's view: the conversation, its bounded in-flight claims and the retained uncertainty. */
export interface DmControlView {
  control: DmControl;
  conversation: DmConversation;
  inFlight: DmEffect[];
  inFlightTotal: number;
  inFlightTruncated: boolean;
  uncertainTotal: number;
  changed?: boolean;
}

export type DmAnswer =
  | { result: "claimed"; effect: DmEffect; conversation: DmConversation }
  | { result: "already_claimed"; effect?: DmEffect; retired?: true; conversation: DmConversation }
  | { result: "blocked_by_takeover"; conversation: DmConversation }
  | { result: "cooldown"; cooldown: DmCooldown; conversation: DmConversation }
  | { effect: DmEffect; settled: boolean; intent?: DmIntent }
  | { conversation: DmConversation; changed: boolean; inFlight?: DmEffect[] }
  | { conversation: DmConversation; effect?: DmEffect }
  | { intent: DmIntent; claimed?: boolean; effect?: DmEffect; conversation?: DmConversation }
  | DmControlView
  | {
      error: "bad_request" | "not_found" | "conflict" | "capacity";
      conversation?: DmConversation;
      /** A control CAS conflict: the handle whose conversation it is (DT-6B-2C-3-R1). */
      control?: DmControl;
    };

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
/** Terminal intents the purge may retire (dispatching and unknown are kept, as claimed/unknown effects are). */
const FINISHED = "('sent','rejected','already_claimed','cancelled','expired')";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS effects (
  account TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  inbound_message_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  generation TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_message_id TEXT,
  failure_code TEXT,
  unknown_reason TEXT,
  claimed_at INTEGER NOT NULL,
  settled_at INTEGER,
  receipt_version INTEGER NOT NULL,
  PRIMARY KEY (account, conversation_id, inbound_message_id)
);
CREATE TABLE IF NOT EXISTS default_cooldown (
  account TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  last_default_at INTEGER NOT NULL,
  effect_key TEXT NOT NULL,
  PRIMARY KEY (account, recipient_id)
);
CREATE TABLE IF NOT EXISTS tombstones (key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS intents (
  operation_id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL,
  account TEXT NOT NULL,
  generation TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  inbound_message_id TEXT NOT NULL,
  inbound_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  digest TEXT NOT NULL,
  draft_revision TEXT NOT NULL,
  state TEXT NOT NULL,
  review_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed_at INTEGER,
  settled_at INTEGER,
  provider_message_id TEXT,
  failure_code TEXT,
  failure_detail TEXT,
  unknown_reason TEXT,
  receipt_version INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS live_submission ON intents (submission_key) WHERE state IN ${LIVE};
CREATE INDEX IF NOT EXISTS prepared_deadline ON intents (review_expires_at) WHERE state = 'prepared';
CREATE TABLE IF NOT EXISTS controls (
  handle_id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  registered_generation TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  UNIQUE (account, conversation_id)
)
`;

const iso = (ms: unknown) => new Date(Number(ms)).toISOString();
const at = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: iso(v) });
const opt = (k: string, v: unknown) => (v === null || v === undefined ? {} : { [k]: v });

function effectOf(r: Row): DmEffect {
  return {
    account: String(r.account),
    conversationId: String(r.conversation_id),
    recipientId: String(r.recipient_id),
    inboundMessageId: String(r.inbound_message_id),
    actor: String(r.actor),
    payloadDigest: String(r.payload_digest),
    generation: String(r.generation),
    state: r.state as DmEffectState,
    claimedAt: iso(r.claimed_at),
    ...at("settledAt", r.settled_at),
    ...opt("providerMessageId", r.provider_message_id),
    ...opt("failureCode", r.failure_code),
    ...opt("unknownReason", r.unknown_reason),
    receiptVersion: Number(r.receipt_version),
  } as DmEffect;
}

function intentOf(r: Row): DmIntent {
  return {
    operationId: String(r.operation_id),
    account: String(r.account),
    generation: String(r.generation),
    conversationId: String(r.conversation_id),
    recipientId: String(r.recipient_id),
    inboundMessageId: String(r.inbound_message_id),
    inboundAt: iso(r.inbound_ms),
    text: String(r.text),
    digest: String(r.digest),
    draftRevision: String(r.draft_revision),
    state: r.state as DmIntentState,
    reviewExpiresAt: iso(r.review_expires_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ...at("claimedAt", r.claimed_at),
    ...at("settledAt", r.settled_at),
    ...opt("providerMessageId", r.provider_message_id),
    ...opt("failureCode", r.failure_code),
    ...opt("failureDetail", r.failure_detail),
    ...opt("unknownReason", r.unknown_reason),
    receiptVersion: Number(r.receipt_version),
  } as DmIntent;
}

function controlOf(r: Row): DmControl {
  return {
    handleId: String(r.handle_id),
    account: String(r.account),
    conversationId: String(r.conversation_id),
    recipientId: String(r.recipient_id),
    registeredGeneration: String(r.registered_generation),
    evidenceDigest: String(r.evidence_digest),
    createdAt: iso(r.created_at),
    usedAt: iso(r.used_at),
  };
}

const effectKey = (k: DmKey) => `effect|${k.account}|${k.conversationId}|${k.inboundMessageId}`;

/** The fields an operation id is bound to: a retry must repeat every one of them. */
const PAYLOAD = [
  ["account", "account"],
  ["generation", "generation"],
  ["conversationId", "conversation_id"],
  ["recipientId", "recipient_id"],
  ["inboundMessageId", "inbound_message_id"],
  ["inboundAt", "inbound_ms"],
  ["text", "text"],
  ["digest", "digest"],
  ["draftRevision", "draft_revision"],
] as const;

/** One live submission: every immutable field (the digest covers the exact body, text and recipient). */
const submissionKey = (i: DmPrepareInput) => PAYLOAD.map(([k]) => String(i[k])).join("|");

const isId = (v: unknown): v is string => typeof v === "string" && DM_ID_RE.test(v);
const isAccount = (v: unknown): v is string => typeof v === "string" && PATH_ID_RE.test(v);
const isKey = (c: Partial<DmKey>) =>
  isAccount(c.account) && isId(c.conversationId) && isId(c.inboundMessageId);
const fits = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);

function validOutcome(o: unknown): o is DmOutcome {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return x.state === "sent"
    ? fits(x.providerMessageId, MESSAGE_ID_RE)
    : x.state === "rejected"
      ? fits(x.code, CODE_RE)
      : x.state === "unknown"
        ? fits(x.reason, REASON_RE)
        : false;
}

function validPrepare(i: unknown, now: number): i is DmPrepareInput {
  if (!i || typeof i !== "object") return false;
  const x = i as Record<string, unknown>;
  return (
    fits(x.operationId, OP_RE) &&
    isAccount(x.account) &&
    fits(x.generation, GEN_RE) &&
    isId(x.conversationId) &&
    isId(x.recipientId) &&
    isId(x.inboundMessageId) &&
    Number.isSafeInteger(x.inboundAt) &&
    typeof x.text === "string" &&
    x.text.length > 0 &&
    x.text.length <= TEXT_CHARS_MAX &&
    fits(x.digest, DIGEST_RE) &&
    fits(x.draftRevision, REVISION_RE) &&
    Number.isSafeInteger(x.reviewExpiresAt) &&
    (x.reviewExpiresAt as number) > now
  );
}

/** An opaque control handle: 128 random bits. */
function newHandle(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class InstagramDmCoordinator {
  private readonly storage: StorageLike;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage as unknown as StorageLike;
    for (const statement of SCHEMA.split(";").map((s) => s.trim()))
      if (statement) this.storage.sql.exec(statement);
  }

  async fetch(req: Request): Promise<Response> {
    let call: DmCall;
    try {
      call = (await req.json()) as DmCall;
    } catch {
      return Response.json({ error: "bad_request" });
    }
    return Response.json(this.run(call));
  }

  run(call: DmCall): DmAnswer {
    if (!call || typeof call !== "object" || !Number.isFinite(call.now))
      return { error: "bad_request" };
    // Synchronous from here on: a Durable Object runs this without interleaving another request.
    this.expire(call.now);
    switch (call.op) {
      case "claim":
        if (!this.validClaim(call)) return { error: "bad_request" };
        this.purge(call.now);
        return this.claim(call, call.now);
      case "settle":
        if (!isKey(call) || typeof call.actor !== "string" || !ACTOR_RE.test(call.actor))
          return { error: "bad_request" };
        this.purge(call.now);
        return this.settle(call, call.now);
      case "takeover":
      case "resume":
        if (
          !isAccount(call.account) ||
          !isId(call.conversationId) ||
          !Number.isSafeInteger(call.expectedRevision) ||
          call.expectedRevision < 0
        )
          return { error: "bad_request" };
        return this.cas(
          call.op,
          call.account,
          call.conversationId,
          call.expectedRevision,
          call.now,
        );
      case "status": {
        if (!isAccount(call.account) || !isId(call.conversationId)) return { error: "bad_request" };
        const conversation = this.conversation(call.account, call.conversationId);
        if (call.inboundMessageId === undefined) return { conversation };
        if (!isId(call.inboundMessageId)) return { error: "bad_request" };
        const e = this.effect({ ...call, inboundMessageId: call.inboundMessageId });
        return { conversation, ...(e ? { effect: effectOf(e) } : {}) };
      }
      case "prepareIntent":
        if (!validPrepare(call.input, call.now)) return { error: "bad_request" };
        this.purge(call.now);
        return this.prepareIntent(call.input, call.now);
      case "claimConfirm":
      case "settleManual":
      case "cancelIntent":
      case "getIntent":
        return this.intentCall(call);
      case "registerControl":
        if (
          !isAccount(call.account) ||
          !isId(call.conversationId) ||
          !isId(call.recipientId) ||
          !fits(call.generation, GEN_RE) ||
          !fits(call.evidenceDigest, DIGEST_RE)
        )
          return { error: "bad_request" };
        return this.registerControl(call, call.now);
      case "controlStatus":
      case "controlTakeover":
      case "controlResume":
        return this.controlCall(call);
      default:
        return { error: "bad_request" };
    }
  }

  private sql(query: string, ...bindings: (string | number | null)[]) {
    return this.storage.sql.exec(query, ...bindings);
  }

  private validClaim(c: DmClaimInput): boolean {
    return (
      isKey(c) &&
      isId(c.recipientId) &&
      typeof c.actor === "string" &&
      ACTOR_RE.test(c.actor) &&
      typeof c.payloadDigest === "string" &&
      DIGEST_RE.test(c.payloadDigest) &&
      typeof c.generation === "string" &&
      GEN_RE.test(c.generation) &&
      typeof c.isDefault === "boolean" &&
      // The default reply is the automation's `auto:default`, and nothing else is.
      c.isDefault === (c.actor === "auto:default") &&
      Number.isSafeInteger(c.cooldownMs) &&
      c.cooldownMs >= 0
    );
  }

  private conversation(account: string, conversationId: string): DmConversation {
    const r = this.sql(
      "SELECT * FROM conversations WHERE conversation_id = ?",
      conversationId,
    ).toArray()[0] as Row | undefined;
    return r
      ? {
          account,
          conversationId,
          mode: r.mode as DmMode,
          revision: Number(r.revision),
          updatedAt: iso(r.updated_at),
        }
      : { account, conversationId, mode: "auto", revision: 0 };
  }

  private effect(k: DmKey): Row | null {
    return (
      (this.sql(
        "SELECT * FROM effects WHERE account = ? AND conversation_id = ? AND inbound_message_id = ?",
        k.account,
        k.conversationId,
        k.inboundMessageId,
      ).toArray()[0] as Row | undefined) ?? null
    );
  }

  private intent(operationId: string): Row | null {
    return (
      (this.sql("SELECT * FROM intents WHERE operation_id = ?", operationId).toArray()[0] as
        Row | undefined) ?? null
    );
  }

  private retired(key: string): boolean {
    return this.sql("SELECT 1 FROM tombstones WHERE key = ?", key).toArray().length > 0;
  }

  /** A prepared intent past its review deadline is expired (its id tombstoned) before anything reads it. */
  private expire(now: number) {
    const due = this.sql(
      "SELECT operation_id FROM intents WHERE state = 'prepared' AND review_expires_at <= ?",
      now,
    ).toArray() as Row[];
    if (!due.length) return;
    this.storage.transactionSync(() => {
      for (const r of due) {
        this.sql(
          `UPDATE intents SET state = 'expired', updated_at = ?, receipt_version = receipt_version + 1
           WHERE operation_id = ? AND state = 'prepared'`,
          now,
          String(r.operation_id),
        );
        this.sql("INSERT OR IGNORE INTO tombstones (key) VALUES (?)", `op|${r.operation_id}`);
      }
    });
  }

  /** Settled effects past RETENTION_MS become tombstones; at most once per PURGE_EVERY_MS (a clock moved back runs it). */
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
         SELECT 'effect|' || account || '|' || conversation_id || '|' || inbound_message_id FROM effects
           WHERE state IN ('sent','rejected') AND settled_at < ?`,
        cutoff,
      );
      this.sql("DELETE FROM effects WHERE state IN ('sent','rejected') AND settled_at < ?", cutoff);
      // A cooldown this old has long passed; its effect may be gone.
      this.sql("DELETE FROM default_cooldown WHERE last_default_at < ?", cutoff);
      // DT-6B-2C-3: finished intents leave a permanent operation tombstone; dispatching/unknown ones stay.
      this.sql(
        `INSERT OR IGNORE INTO tombstones (key)
         SELECT 'op|' || operation_id FROM intents WHERE state IN ${FINISHED} AND updated_at < ?`,
        cutoff,
      );
      this.sql(`DELETE FROM intents WHERE state IN ${FINISHED} AND updated_at < ?`, cutoff);
      // A handle unused this long is forgotten (re-registration proves ownership again); the mode stays.
      this.sql("DELETE FROM controls WHERE used_at < ?", cutoff);
    });
  }

  private claim(c: DmClaimInput, now: number): DmAnswer {
    return this.storage.transactionSync((): DmAnswer => this.claimIn(c, now));
  }

  /** The claim's body; the caller holds the transaction. */
  private claimIn(c: DmClaimInput, now: number): DmAnswer {
    const conversation = this.conversation(c.account, c.conversationId);
    // A takeover holds the conversation for the person: automation stays out, the person's own send does not.
    if (conversation.mode === "human" && c.actor.startsWith("auto:"))
      return { result: "blocked_by_takeover", conversation };
    const key = effectKey(c);
    const held = this.effect(c);
    if (held) return { result: "already_claimed", effect: effectOf(held), conversation };
    if (this.sql("SELECT 1 FROM tombstones WHERE key = ?", key).toArray().length)
      return { result: "already_claimed", retired: true, conversation };
    if (c.isDefault) {
      const cd = this.sql(
        "SELECT * FROM default_cooldown WHERE account = ? AND recipient_id = ?",
        c.account,
        c.recipientId,
      ).toArray()[0] as Row | undefined;
      // A last time in the future (a clock moved back) also holds: conservative.
      if (cd && Number(cd.last_default_at) + c.cooldownMs > now)
        return {
          result: "cooldown",
          cooldown: {
            account: c.account,
            recipientId: c.recipientId,
            lastDefaultAt: iso(cd.last_default_at),
            effectKey: String(cd.effect_key),
          },
          conversation,
        };
    }
    const won = this.sql(
      `INSERT INTO effects (account, conversation_id, recipient_id, inbound_message_id, actor, payload_digest,
         generation, state, claimed_at, receipt_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', ?, 1) RETURNING *`,
      c.account,
      c.conversationId,
      c.recipientId,
      c.inboundMessageId,
      c.actor,
      c.payloadDigest,
      c.generation,
      now,
    ).toArray()[0] as Row;
    if (c.isDefault)
      this.sql(
        `INSERT INTO default_cooldown (account, recipient_id, last_default_at, effect_key) VALUES (?, ?, ?, ?)
         ON CONFLICT (account, recipient_id) DO UPDATE SET last_default_at = excluded.last_default_at,
           effect_key = excluded.effect_key`,
        c.account,
        c.recipientId,
        now,
        key,
      );
    return { result: "claimed", effect: effectOf(won), conversation };
  }

  private settle(c: Extract<DmCall, { op: "settle" }>, now: number): DmAnswer {
    const o = c.outcome;
    if (!validOutcome(o)) return { error: "bad_request" };
    if (!this.effect(c)) return { error: "not_found" };
    const op = c.actor.startsWith("manual:") ? c.actor.slice("manual:".length) : null;
    return this.storage.transactionSync((): DmAnswer => {
      const settled =
        this.sql(
          `UPDATE effects SET state = ?, settled_at = ?, provider_message_id = ?, failure_code = ?, unknown_reason = ?,
             receipt_version = receipt_version + 1
           WHERE account = ? AND conversation_id = ? AND inbound_message_id = ? AND actor = ? AND state = 'claimed'
           RETURNING account`,
          o.state,
          now,
          o.state === "sent" ? o.providerMessageId : null,
          o.state === "rejected" ? o.code : null,
          o.state === "unknown" ? o.reason : null,
          c.account,
          c.conversationId,
          c.inboundMessageId,
          c.actor,
        ).toArray().length === 1;
      // Only a definite refusal (nothing was sent) gives the default reply's cooldown back, and only its own.
      if (settled && o.state === "rejected")
        this.sql(
          "DELETE FROM default_cooldown WHERE account = ? AND effect_key = ?",
          c.account,
          effectKey(c),
        );
      // DT-6B-2C-3: a manual actor's intent records the same outcome in this transaction (one authority).
      if (settled && op)
        this.sql(
          `UPDATE intents SET state = ?, settled_at = ?, updated_at = ?, provider_message_id = ?, failure_code = ?,
             unknown_reason = ?, receipt_version = receipt_version + 1
           WHERE operation_id = ? AND state = 'dispatching'`,
          o.state,
          now,
          now,
          o.state === "sent" ? o.providerMessageId : null,
          o.state === "rejected" ? o.code : null,
          o.state === "unknown" ? o.reason : null,
          op,
        );
      const intent = op ? this.intent(op) : null;
      return {
        effect: effectOf(this.effect(c)!),
        settled,
        ...(intent ? { intent: intentOf(intent) } : {}),
      };
    });
  }

  /** The CAS mutation; the caller holds the transaction. */
  private flip(
    op: "takeover" | "resume",
    account: string,
    conversationId: string,
    expected: number,
    now: number,
  ):
    | { conversation: DmConversation; changed: boolean }
    | { error: "conflict"; conversation: DmConversation } {
    const current = this.conversation(account, conversationId);
    if (current.revision !== expected) return { error: "conflict", conversation: current };
    const mode: DmMode = op === "takeover" ? "human" : "auto";
    let changed = false;
    if (current.mode !== mode) {
      this.sql(
        `INSERT INTO conversations (conversation_id, mode, revision, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (conversation_id) DO UPDATE SET mode = excluded.mode, revision = excluded.revision,
           updated_at = excluded.updated_at`,
        conversationId,
        mode,
        expected + 1,
        now,
      );
      changed = true;
    }
    return { conversation: this.conversation(account, conversationId), changed };
  }

  private cas(
    op: "takeover" | "resume",
    account: string,
    conversationId: string,
    expected: number,
    now: number,
  ): DmAnswer {
    return this.storage.transactionSync((): DmAnswer => {
      const flipped = this.flip(op, account, conversationId, expected, now);
      if ("error" in flipped || op === "resume") return flipped;
      // Honest: an attempt already authorized may still be delivered; takeover cannot retract it.
      const inFlight = (
        this.sql(
          "SELECT * FROM effects WHERE account = ? AND conversation_id = ? AND state = 'claimed' ORDER BY claimed_at",
          account,
          conversationId,
        ).toArray() as Row[]
      ).map(effectOf);
      return { ...flipped, inFlight };
    });
  }

  /* ---------- DT-6B-2C-3: manual intents ---------- */

  private prepareIntent(i: DmPrepareInput, now: number): DmAnswer {
    const key = submissionKey(i);
    return this.storage.transactionSync((): DmAnswer => {
      const existing = this.intent(i.operationId);
      if (existing)
        return PAYLOAD.every(([k, col]) => existing[col] === i[k])
          ? { intent: intentOf(existing) }
          : { error: "conflict" };
      // An operation id is never repurposed, also after its row was purged.
      if (this.retired(`op|${i.operationId}`)) return { error: "conflict" };
      const live = this.sql(
        `SELECT * FROM intents WHERE submission_key = ? AND state IN ${LIVE}`,
        key,
      ).toArray()[0] as Row | undefined;
      if (live) return { intent: intentOf(live) };
      const open = this.sql(
        "SELECT COUNT(*) AS n FROM intents WHERE state IN ('prepared','dispatching')",
      ).toArray()[0] as Row;
      if (Number(open.n) >= INTENTS_OPEN_MAX) return { error: "capacity" };
      this.sql(
        `INSERT INTO intents (operation_id, submission_key, account, generation, conversation_id, recipient_id,
           inbound_message_id, inbound_ms, text, digest, draft_revision, state, review_expires_at, created_at,
           updated_at, receipt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, 1)`,
        i.operationId,
        key,
        i.account,
        i.generation,
        i.conversationId,
        i.recipientId,
        i.inboundMessageId,
        i.inboundAt,
        i.text,
        i.digest,
        i.draftRevision,
        i.reviewExpiresAt,
        now,
        now,
      );
      return { intent: intentOf(this.intent(i.operationId)!) };
    });
  }

  private intentCall(
    call: Extract<DmCall, { op: "claimConfirm" | "settleManual" | "cancelIntent" | "getIntent" }>,
  ): DmAnswer {
    if (!isAccount(call.account) || !fits(call.operationId, OP_RE)) return { error: "bad_request" };
    const r = this.intent(call.operationId);
    // Another account's operation does not exist here.
    if (!r || r.account !== call.account) return { error: "not_found" };
    const now = call.now;
    switch (call.op) {
      case "getIntent":
        return { intent: intentOf(r) };
      case "cancelIntent":
        this.sql(
          `UPDATE intents SET state = 'cancelled', updated_at = ?, receipt_version = receipt_version + 1
           WHERE operation_id = ? AND state = 'prepared'`,
          now,
          call.operationId,
        );
        return { intent: intentOf(this.intent(call.operationId)!) };
      case "claimConfirm":
        if (!fits(call.digest, DIGEST_RE)) return { error: "bad_request" };
        if (r.digest !== call.digest) return { error: "conflict" };
        this.purge(now);
        return this.claimConfirm(call.operationId, now);
      case "settleManual": {
        if (!validOutcome(call.outcome)) return { error: "bad_request" };
        this.purge(now);
        return this.settle(
          {
            op: "settle",
            account: String(r.account),
            conversationId: String(r.conversation_id),
            inboundMessageId: String(r.inbound_message_id),
            actor: `manual:${call.operationId}`,
            outcome: call.outcome,
            now,
          },
          now,
        );
      }
    }
  }

  private claimConfirm(operationId: string, now: number): DmAnswer {
    return this.storage.transactionSync((): DmAnswer => {
      const r = this.intent(operationId)!;
      // Anything past prepared (dispatching, settled, already claimed, cancelled, expired) is answered as it stands.
      if (r.state !== "prepared") return { intent: intentOf(r), claimed: false };
      const claimed = this.claimIn(
        {
          account: String(r.account),
          conversationId: String(r.conversation_id),
          recipientId: String(r.recipient_id),
          inboundMessageId: String(r.inbound_message_id),
          actor: `manual:${operationId}`,
          payloadDigest: String(r.digest),
          generation: String(r.generation),
          isDefault: false,
          cooldownMs: 0,
        },
        now,
      );
      if ("result" in claimed && claimed.result === "claimed") {
        this.sql(
          `UPDATE intents SET state = 'dispatching', claimed_at = ?, updated_at = ?,
             receipt_version = receipt_version + 1
           WHERE operation_id = ? AND state = 'prepared'`,
          now,
          now,
          operationId,
        );
        return {
          intent: intentOf(this.intent(operationId)!),
          claimed: true,
          effect: claimed.effect,
          conversation: claimed.conversation,
        };
      }
      // Someone else answered (or retired) this inbound event: this operation ends here, truthfully, and sends nothing.
      const held = "effect" in claimed ? claimed.effect : undefined;
      const by = !held ? "retired" : held.actor.startsWith("auto:") ? "automatic" : "manual";
      this.sql(
        `UPDATE intents SET state = 'already_claimed', updated_at = ?, failure_code = 'already_claimed',
           failure_detail = ?, receipt_version = receipt_version + 1
         WHERE operation_id = ?`,
        now,
        by,
        operationId,
      );
      return {
        intent: intentOf(this.intent(operationId)!),
        claimed: false,
        ...(held ? { effect: held } : {}),
      };
    });
  }

  /* ---------- DT-6B-2C-3: verified control handles ---------- */

  /** The handle's conversation, at most CONTROL_ROWS_MAX claimed rows, and the truthful totals. */
  private view(c: Row, changed?: boolean): DmControlView {
    const account = String(c.account);
    const conversationId = String(c.conversation_id);
    const count = (state: string) =>
      Number(
        (
          this.sql(
            "SELECT COUNT(*) AS n FROM effects WHERE account = ? AND conversation_id = ? AND state = ?",
            account,
            conversationId,
            state,
          ).toArray()[0] as Row
        ).n,
      );
    const inFlight = (
      this.sql(
        `SELECT * FROM effects WHERE account = ? AND conversation_id = ? AND state = 'claimed'
         ORDER BY claimed_at, inbound_message_id LIMIT ?`,
        account,
        conversationId,
        CONTROL_ROWS_MAX,
      ).toArray() as Row[]
    ).map(effectOf);
    const inFlightTotal = count("claimed");
    return {
      control: controlOf(c),
      conversation: this.conversation(account, conversationId),
      inFlight,
      inFlightTotal,
      inFlightTruncated: inFlightTotal > inFlight.length,
      uncertainTotal: count("unknown"),
      ...(changed === undefined ? {} : { changed }),
    };
  }

  private registerControl(c: Extract<DmCall, { op: "registerControl" }>, now: number): DmAnswer {
    return this.storage.transactionSync((): DmAnswer => {
      const existing = this.sql(
        "SELECT * FROM controls WHERE account = ? AND conversation_id = ?",
        c.account,
        c.conversationId,
      ).toArray()[0] as Row | undefined;
      if (existing) {
        if (existing.recipient_id !== c.recipientId) return { error: "conflict" };
        // The same verified target converges on its handle, refreshed with the newest proof.
        this.sql(
          `UPDATE controls SET registered_generation = ?, evidence_digest = ?, used_at = ? WHERE handle_id = ?`,
          c.generation,
          c.evidenceDigest,
          now,
          String(existing.handle_id),
        );
        return this.view(this.control(c.account, String(existing.handle_id))!);
      }
      const n = this.sql("SELECT COUNT(*) AS n FROM controls").toArray()[0] as Row;
      if (Number(n.n) >= CONTROLS_MAX) return { error: "capacity" };
      const handle = newHandle();
      this.sql(
        `INSERT INTO controls (handle_id, account, conversation_id, recipient_id, registered_generation,
           evidence_digest, created_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        handle,
        c.account,
        c.conversationId,
        c.recipientId,
        c.generation,
        c.evidenceDigest,
        now,
        now,
      );
      return this.view(this.control(c.account, handle)!);
    });
  }

  private control(account: string, handleId: string): Row | null {
    return (
      (this.sql(
        "SELECT * FROM controls WHERE handle_id = ? AND account = ?",
        handleId,
        account,
      ).toArray()[0] as Row | undefined) ?? null
    );
  }

  private controlCall(
    call: Extract<DmCall, { op: "controlStatus" | "controlTakeover" | "controlResume" }>,
  ): DmAnswer {
    if (!isAccount(call.account) || !fits(call.handleId, HANDLE_RE))
      return { error: "bad_request" };
    if (
      call.op !== "controlStatus" &&
      (!Number.isSafeInteger(call.expectedRevision) || call.expectedRevision < 0)
    )
      return { error: "bad_request" };
    const c = this.control(call.account, call.handleId);
    if (!c) return { error: "not_found" };
    if (call.op === "controlStatus") {
      // DT-6B-2C-3-R1: a successful read through the handle is use (its own small write; mode, revision and effects
      // stay as they are), so a handle used for recovery is not purged as unused. A clock moved back never ages it.
      this.sql(
        "UPDATE controls SET used_at = MAX(used_at, ?) WHERE handle_id = ?",
        call.now,
        call.handleId,
      );
      return this.view(this.control(call.account, call.handleId)!);
    }
    const op = call.op === "controlTakeover" ? "takeover" : "resume";
    return this.storage.transactionSync((): DmAnswer => {
      // One mutation; the bounded rows below are read in the same transaction, never by running it again.
      const flipped = this.flip(
        op,
        call.account,
        String(c.conversation_id),
        call.expectedRevision,
        call.now,
      );
      // A conflict names the handle whose conversation it is, so the route can bind it to the verified target.
      if ("error" in flipped) return { ...flipped, control: controlOf(c) };
      this.sql("UPDATE controls SET used_at = ? WHERE handle_id = ?", call.now, call.handleId);
      return this.view(this.control(call.account, call.handleId)!, flipped.changed);
    });
  }
}
