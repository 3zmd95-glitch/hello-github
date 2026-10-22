/**
 * 💬 Reviewed existing-conversation Instagram DMs and explicit conversation takeover/resume (packet DT-6B-2C-3,
 * planning/tools/37-inbox-send.md), Worker protocol only. One plain-text DM answering one inbound message of a
 * conversation the person opened, after the owner reviewed the exact account, conversation, recipient, inbound
 * message and canonical text and pressed Send; and an explicit, revision-checked takeover/resume of one verified
 * conversation. No UI, no unsolicited DMs, no attachments/buttons, no comment-private coordination, no implicit
 * takeover on Send and no Send on takeover/resume.
 *
 *   POST /social/inbox/instagram/dm/send/prepare            { operationId, account, conversationId, recipientId,
 *                                                             inboundMessageId, text, draftRevision }
 *                                                           → { intent, verification }
 *   POST /social/inbox/instagram/dm/send/confirm            { operationId, digest, account } → { intent }
 *   GET  /social/inbox/instagram/dm/send/:operationId?account                                → { intent }
 *   POST /social/inbox/instagram/dm/send/:operationId/cancel { account }                     → { intent }
 *   POST /social/inbox/instagram/dm/control/register        { account, conversationId }      → control view
 *   GET  /social/inbox/instagram/dm/control/:handle?account                                  → control view
 *   POST /social/inbox/instagram/dm/control/:handle/takeover { account, expectedRevision }   → control view
 *   POST /social/inbox/instagram/dm/control/:handle/resume   { account, expectedRevision }   → control view
 *
 * Gate. Prepare, a NEW confirm and the initial control registration need `eligibility`; production has none and
 * answers `no_permission` / `permission_unverified` before any provider call (DM permission, window and API-version
 * semantics and a trusted record of actual grants are unverified). `canReply`, stored or requested scopes, reads and
 * settings never open it; only `instagramDmHandler({ eligibility })` can, and only tests pass one. Durable recovery
 * (status, cancel, a repeated confirm of an operation past `prepared`, control status/takeover/resume of an existing
 * handle) needs only the bearer and the durable handle: no token, grant, inbox row or provider call.
 *
 * Text. Canonicalized ONCE before review: trim, Unicode NFC, trim, no lone surrogates, and (DT-6B-3C) at most
 * DM_TEXT_BYTES_MAX UTF-8 bytes of that canonical message.text (Meta's documented limit; not the JSON envelope, the
 * recipient or escaping). Never truncated, split, replaced or normalized again after review. Intents stored under the
 * earlier 1000-code-point policy stay readable as they are (status, cancel, a repeated confirm past `prepared`); only a
 * still-`prepared` one whose stored text is over the bound or not canonical is refused by Confirm with `text_invalid`,
 * a guaranteed pre-claim refusal (no token read, GET, claim or POST), never rewritten or cancelled by itself.
 * The canonical text is stored, returned for review, and the POST body is
 * `{"recipient":{"id":…},"message":{"text":<stored text>}}` built from the stored intent; its SHA-256 is the intent's
 * digest and the effect's payload digest. The automatic serialization (instagramDmSend `bodyOf`) is untouched.
 *
 * Ownership chain (prepare, new confirm, registration; ≤ 3 GETs on the fixed IG_API host, first pages only, manual
 * redirects, POST_TIMEOUT_MS each, PAGE_BYTES_MAX each, never a provider `paging.next`, the one captured token):
 *   1. `/me?fields=user_id,username`: `user_id` must equal `account` (never the OAuth `tokens.userId`);
 *   2. `/{account}/conversations?platform=instagram&fields=id&limit=DM_PAGE`: `conversationId` must be listed;
 *   3. `/{conversationId}?fields=messages.limit(DM_PAGE){id,created_time,from}`: every row needs an id, a sender id
 *      and a valid time (else `upstream`/`malformed page`); exactly one non-owner sender (the customer). DT-6B-2C-3-R1:
 *      every page is a plain object without any `error` key (also `null`/`false`; else `malformed page`); a returned
 *      conversation `id` other than the requested one is `foreign-conversation` (an omitted one is not required); one
 *      message id with two times or senders is `ambiguous-message`; the owner is the fresh `/me` user_id only, and a
 *      username is a label that must pair with exactly one sender id (owner's included) on the page, never proof of
 *      ownership (else `ambiguous-identity`); all `target_invalid`, before any coordinator call. For a send the
 *      inbound id must be listed, from that customer (`own-message`, `mixed-senders`, `foreign-recipient`), not in the
 *      future (`future-time`) and younger than the local 24 h window by the fenced clock (`window-closed`). Absent
 *      from a first page → `target_unverified` / `outside-local-window` (never proof of deletion). A registration
 *      takes the recipient from that page, never from the request (`no-customer` when there is none).
 * Then the final fence: token and status read together, the token again, all equal to the capture (else `stale` /
 * `reconnected`), a fresh clock (`token_expired`), and nothing awaited before the coordinator call.
 *
 * Confirm: durable state first (anything past `prepared` is answered as it stands, also with the gate closed), the
 * digest, the stored text against today's rule (`text_invalid`, DT-6B-3C), the token, the gate, the generation (`stale` after a reconnect), the chain again over the STORED target
 * (fields in the request other than operationId/digest/account are ignored), the stored bytes re-hashed, the fence,
 * then ONE `claimConfirm` (InstagramDmCoordinator: the automation's own effect with actor `manual:<operationId>`;
 * expired/already_claimed claim nothing), then ONE `dispatchClaimed` POST (instagramDmSend) and ONE `settleManual`.
 * A settled receipt binding the effect and the intent to exactly the outcome is the answer. Every intent answer has
 * exactly its state's proof fields (one table, R1), the claim answer is the known version + 1, and the settlement is
 * newer than the claim in the intent and the effect; anything else is `receipt_unavailable` before the POST and
 * `settlement: "pending"` after it. Control answers (R1): the complete handle, complete claimed rows of its target,
 * and for takeover/resume the requested mode at expected + 1 (`changed`) or at expected (a no-op); a stale revision
 * is a pure conflict naming only the verified handle's own target. Without a receipt the intent
 * stays `dispatching` and the answer says `settlement: "pending"` with what was observed: a provider success is
 * `unknown` (`receipt`), a typed refusal is reported as observed and is never presented as a durable rejection.
 * Nothing is retried or reopened; a repeated confirm never dispatches again.
 *
 * Budget per request (Workers subrequests): prepare = ≤ 3 provider GETs + 1 coordinator call + 5 KV reads; new
 * confirm = ≤ 3 GETs + 1 POST + 3 coordinator calls (get, claimConfirm, settleManual; settlement always has its
 * call, coordinator calls are not drawn from the provider budgets) + 5 KV reads; registration = ≤ 3 GETs + 1
 * coordinator call + 5 KV reads; status/cancel/control = 1 coordinator call, 0 provider, 0 KV. No cap is raised.
 * Tokens, bodies and the seal key are never logged or answered.
 */

import { Budget, type Http } from "./http";
import { WINDOW_MS } from "./inbox";
import { DM_PAGE } from "./inboxRead";
import { boundedJson, failureOf, PATH_ID_RE, plainId } from "./inboxReadCommon";
import { BODY_BYTES_MAX, POST_TIMEOUT_MS, REVIEW_MS, type Reply } from "./inboxSendYouTube";
import { IG_API } from "./instagram";
import {
  ACTOR_RE,
  CONTROL_ROWS_MAX,
  DM_ID_RE,
  type DmCall,
  type DmIntent,
  type DmIntentState,
  type DmOutcome,
} from "./instagramDmCoordinator";
import { boundEffect, coordinateDm, dispatchClaimed, DmStoreDown } from "./instagramDmSend";
import { isErrorFree, isObj, isVersion, readCapped } from "./instagramPublicSend";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { graph } from "./replyCore";
import type { Store } from "./store";
import type { TokenSet } from "./types";

/** The longest reviewed DM message.text in UTF-8 bytes, after canonicalization (Meta's documented 1,000-byte limit). */
export const DM_TEXT_BYTES_MAX = 1000;

const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REVISION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const GEN_RE = /^[0-9a-f]{32}$/;
const HANDLE_RE = /^[0-9a-f]{32}$/;

export type InstagramDmError =
  | "not_configured"
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "stale"
  | "account_mismatch"
  | "bad_request"
  | "text_invalid"
  | "target_unverified"
  | "target_invalid"
  | "not_found"
  | "conflict"
  | "capacity"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  | "method_not_allowed";

const STATUS: Record<InstagramDmError, number> = {
  not_configured: 503,
  not_connected: 409,
  no_permission: 403,
  token_expired: 409,
  stale: 409,
  account_mismatch: 409,
  bad_request: 400,
  text_invalid: 400,
  target_unverified: 409,
  target_invalid: 409,
  not_found: 404,
  conflict: 409,
  capacity: 429,
  rate_limited: 429,
  upstream: 502,
  receipt_unavailable: 503,
  method_not_allowed: 405,
};

/* ---------- the eligibility gate ---------- */

export type InstagramDmEligibility = { ok: true } | { ok: false; reason: "permission_unverified" };
export type EligibilityCheck = (ctx: {
  tokens: TokenSet;
  now: Date;
}) => InstagramDmEligibility | Promise<InstagramDmEligibility>;

/** Closed until DM permission/window semantics and actual grant evidence are verified. */
const productionEligibility: EligibilityCheck = () => ({
  ok: false,
  reason: "permission_unverified",
});

/* ---------- pieces ---------- */

export interface InstagramDmDeps {
  store: Store | null;
  coordinator: DurableObjectNamespace | undefined;
  /** INBOX_SEAL_SECRET when set: only cut out of any provider words, never required here. */
  seal?: string;
}

type Obj = Record<string, unknown>;
const enc = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The DM generation the automation uses too: changes with a reconnect (connectedAt), never the token. */
const generationOf = async (account: string, stamp: string) =>
  (await sha256Hex(`ig-dm-gen|${account}|${stamp}`)).slice(0, 32);

/** The exact POST body of a reviewed DM: built only from the stored recipient and canonical text. */
export const manualBody = (recipientId: string, text: string) =>
  JSON.stringify({ recipient: { id: recipientId }, message: { text } });

/** Trim + NFC + trim, once; null when empty, over DM_TEXT_BYTES_MAX UTF-8 bytes, or not well-formed Unicode. */
export function canonicalText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().normalize("NFC").trim();
  if (!t || t.normalize("NFC") !== t || /\p{Cs}/u.test(t)) return null;
  return enc.encode(t).length <= DM_TEXT_BYTES_MAX ? t : null;
}

async function readBody(req: Request): Promise<Obj | null> {
  try {
    const text = await readCapped(req.body, BODY_BYTES_MAX);
    if (text === null) return null;
    const v = JSON.parse(text || "{}") as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

const isAccount = (v: unknown): v is string => typeof v === "string" && PATH_ID_RE.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && DM_ID_RE.test(v);
const fits = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
const isoOf = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);
const isIso = (v: unknown): v is string => typeof v === "string" && isoOf(Date.parse(v)) === v;
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

const STATES: ReadonlySet<unknown> = new Set<DmIntentState>([
  "prepared",
  "dispatching",
  "sent",
  "rejected",
  "unknown",
  "already_claimed",
  "cancelled",
  "expired",
]);
const HOLDERS: ReadonlySet<unknown> = new Set(["automatic", "manual", "retired"]);
/** Coordinator refusals answered as they are (a pure envelope only); anything else is unreadable. */
const COORDINATOR_ERRORS: ReadonlySet<unknown> = new Set([
  "conflict",
  "not_found",
  "bad_request",
  "capacity",
]);

const PROOF_FIELDS = [
  "claimedAt",
  "settledAt",
  "providerMessageId",
  "failureCode",
  "failureDetail",
  "unknownReason",
] as const;
/** Each state's exact proof (DT-6B-2C-3-R1): these fields are required and every other proof field is absent. */
const PROOF: Record<DmIntentState, readonly string[]> = {
  prepared: [],
  dispatching: ["claimedAt"],
  sent: ["claimedAt", "settledAt", "providerMessageId"],
  rejected: ["claimedAt", "settledAt", "failureCode"],
  unknown: ["claimedAt", "settledAt", "unknownReason"],
  already_claimed: ["failureCode", "failureDetail"],
  cancelled: [],
  expired: [],
};

/** A complete typed intent in a supported state with exactly that state's proof. */
function validIntent(i: unknown): i is DmIntent {
  if (!isObj(i) || !STATES.has(i.state)) return false;
  const need = PROOF[i.state as DmIntentState];
  const proof =
    PROOF_FIELDS.every((k) =>
      !need.includes(k) ? !(k in i) : k.endsWith("At") ? isIso(i[k]) : isText(i[k]),
    ) &&
    (i.state !== "already_claimed" ||
      (i.failureCode === "already_claimed" && HOLDERS.has(i.failureDetail)));
  return (
    proof &&
    fits(i.operationId, OP_RE) &&
    isAccount(i.account) &&
    fits(i.generation, GEN_RE) &&
    isId(i.conversationId) &&
    isId(i.recipientId) &&
    isId(i.inboundMessageId) &&
    isIso(i.inboundAt) &&
    isText(i.text) &&
    fits(i.digest, DIGEST_RE) &&
    fits(i.draftRevision, REVISION_RE) &&
    isVersion(i.receiptVersion) &&
    [i.reviewExpiresAt, i.createdAt, i.updatedAt].every(isIso)
  );
}

/** A receipt version, or NaN (every comparison with it is false). */
const versionOf = (x: unknown): number =>
  isObj(x) && isVersion(x.receiptVersion) ? (x.receiptVersion as number) : NaN;

/** A valid intent whose every `want` field is equal: what this phase already knows. */
function boundIntent(i: unknown, want: Obj): i is DmIntent {
  return validIntent(i) && Object.entries(want).every(([k, v]) => (i as unknown as Obj)[k] === v);
}

/** The immutable payload a validated intent is bound to; every later answer for it must repeat it. */
const payloadOf = (i: DmIntent) => ({
  operationId: i.operationId,
  account: i.account,
  generation: i.generation,
  conversationId: i.conversationId,
  recipientId: i.recipientId,
  inboundMessageId: i.inboundMessageId,
  inboundAt: i.inboundAt,
  text: i.text,
  digest: i.digest,
  draftRevision: i.draftRevision,
});

const validConversation = (c: unknown, account: string, conversationId?: string): c is Obj =>
  isObj(c) &&
  c.account === account &&
  isId(c.conversationId) &&
  (conversationId === undefined || c.conversationId === conversationId) &&
  (c.mode === "auto" || c.mode === "human") &&
  isCount(c.revision);

/** The complete typed handle of this account with every `want` field (handle id, or the verified target). */
const validControl = (c: unknown, account: string, want: Obj): c is Obj =>
  isObj(c) &&
  c.account === account &&
  fits(c.handleId, HANDLE_RE) &&
  isId(c.conversationId) &&
  isId(c.recipientId) &&
  fits(c.registeredGeneration, GEN_RE) &&
  fits(c.evidenceDigest, DIGEST_RE) &&
  isIso(c.createdAt) &&
  isIso(c.usedAt) &&
  Object.entries(want).every(([k, x]) => c[k] === x);

const SETTLEMENT = ["settledAt", "providerMessageId", "failureCode", "unknownReason"];
/** A complete claimed effect of the handle's own target: nothing settled. */
const claimedRow = (e: unknown, c: Obj) =>
  isObj(e) &&
  e.account === c.account &&
  e.conversationId === c.conversationId &&
  e.recipientId === c.recipientId &&
  isId(e.inboundMessageId) &&
  fits(e.actor, ACTOR_RE) &&
  fits(e.generation, GEN_RE) &&
  fits(e.payloadDigest, DIGEST_RE) &&
  isIso(e.claimedAt) &&
  e.state === "claimed" &&
  isVersion(e.receiptVersion) &&
  SETTLEMENT.every((k) => !(k in e));

/** A requested control CAS: the mode it sets and the revision the caller saw. */
type Cas = { mode: "human" | "auto"; expected: number };

/**
 * A control view bound to this account and handle (at registration, the verified target and generation): the complete
 * handle, complete claimed rows of its target, truthful counts, and for a CAS the requested mode at expected + 1
 * (`changed`) or at expected (a genuine no-op).
 */
function validView(v: Obj, account: string, want: Obj, cas?: Cas): boolean {
  const c = v.control;
  const conv = v.conversation;
  const rows = v.inFlight;
  return (
    validControl(c, account, want) &&
    validConversation(conv, account, c.conversationId as string) &&
    (cas
      ? conv.mode === cas.mode &&
        (v.changed === true
          ? conv.revision === cas.expected + 1
          : v.changed === false && conv.revision === cas.expected)
      : v.changed === undefined) &&
    Array.isArray(rows) &&
    rows.length <= CONTROL_ROWS_MAX &&
    rows.every((e) => claimedRow(e, c)) &&
    isCount(v.inFlightTotal) &&
    v.inFlightTotal >= rows.length &&
    v.inFlightTruncated === v.inFlightTotal > rows.length &&
    isCount(v.uncertainTotal)
  );
}

/* ---------- the ownership chain ---------- */

type Proof = { ok: true; recipientId: string; inboundMs?: number; evidence: string };
type Refusal = { ok: false; error: InstagramDmError; detail?: string };

interface IgMsg {
  id?: unknown;
  created_time?: unknown;
  from?: { id?: unknown; username?: unknown };
}

/** ISO 8601 or UNIX seconds → epoch ms; NaN when unreadable (inbox.ts `toMs`, strings and numbers only). */
function timeOf(v: unknown): number {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && /^\d+$/.test(v)) return timeOf(Number(v));
  return typeof v === "string" ? Date.parse(v) : NaN;
}

/**
 * ≤ 3 bounded GETs proving `/me` is `account`, the conversation is on its first owned page, and that conversation's
 * first message page has one customer; with `inboundMessageId`, that the message is the customer's.
 */
async function proveTarget(
  doFetch: typeof fetch,
  token: string,
  t: { account: string; conversationId: string; recipientId?: string; inboundMessageId?: string },
  secret?: string,
): Promise<Proof | Refusal> {
  const http: Http = { fetch: doFetch, budget: new Budget(3) };
  const get = <T>(path: string, params: Record<string, string>) => {
    const url = new URL(`${IG_API}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    // Never followed: a redirect would carry the token to another destination.
    return boundedJson<T>(http, url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  };
  const unverified: Refusal = {
    ok: false,
    error: "target_unverified",
    detail: "outside-local-window",
  };
  const malformed: Refusal = { ok: false, error: "upstream", detail: "malformed page" };
  const invalid = (detail: string): Refusal => ({ ok: false, error: "target_invalid", detail });
  try {
    const me = graph(
      await get<MetaError & { user_id?: unknown; username?: unknown }>("me", {
        fields: "user_id,username",
      }),
      "me",
    );
    // R1: graph() refuses a truthy provider error; a page with any `error` key (also null/false) is no proof either.
    if (!strictPage(me)) return malformed;
    const userId = plainId(me.user_id, PATH_ID_RE);
    if (!userId) return { ok: false, error: "upstream", detail: "me: no user_id" };
    if (userId !== t.account) return { ok: false, error: "account_mismatch", detail: "identity" };
    const username = typeof me.username === "string" && me.username ? me.username : undefined;
    const page = String(DM_PAGE);
    const convs = graph(
      await get<MetaError & { data?: unknown }>(`${userId}/conversations`, {
        platform: "instagram",
        fields: "id",
        limit: page,
      }),
      "conversations",
    );
    if (!strictPage(convs)) return malformed;
    const list = convs.data;
    if (!Array.isArray(list) || !list.every((c) => isObj(c) && isId(plainId(c.id, DM_ID_RE))))
      return malformed;
    if (!list.some((c) => plainId((c as Obj).id, DM_ID_RE) === t.conversationId)) return unverified;
    const thread = graph(
      await get<MetaError & { id?: unknown; messages?: { data?: unknown } }>(t.conversationId, {
        fields: `messages.limit(${page}){id,created_time,from}`,
      }),
      "messages",
    );
    if (!strictPage(thread)) return malformed;
    // A returned identity, when present, must be the requested conversation (an omitted one is not required).
    if (thread.id !== undefined && plainId(thread.id, DM_ID_RE) !== t.conversationId)
      return invalid("foreign-conversation");
    const rows = thread.messages?.data;
    if (!Array.isArray(rows)) return malformed;
    const msgs: { id: string; from: string; own: boolean; ms: number }[] = [];
    const byId = new Map<string, { from: string; ms: number }>();
    // The owner is the fresh /me user_id only. A username is a label that must pair with exactly one sender id.
    const nameOf = new Map<string, string>(username ? [[userId, username]] : []);
    const idOf = new Map<string, string>(username ? [[username, userId]] : []);
    for (const r of rows as IgMsg[]) {
      const id = isObj(r) ? plainId(r.id, DM_ID_RE) : undefined;
      const from = isObj(r) && isObj(r.from) ? plainId(r.from.id, DM_ID_RE) : undefined;
      const ms = isObj(r) ? timeOf(r.created_time) : NaN;
      if (!id || !from || !Number.isFinite(ms)) return malformed;
      const seen = byId.get(id);
      if (seen && (seen.from !== from || seen.ms !== ms)) return invalid("ambiguous-message");
      byId.set(id, { from, ms });
      const name = r.from?.username;
      if (typeof name === "string" && name) {
        if ((nameOf.get(from) ?? name) !== name || (idOf.get(name) ?? from) !== from)
          return invalid("ambiguous-identity");
        nameOf.set(from, name);
        idOf.set(name, from);
      }
      msgs.push({ id, from, own: from === userId, ms });
    }
    const customers = new Set(msgs.filter((m) => !m.own).map((m) => m.from));
    const evidence = msgs.map((m) => m.id).join(",");
    if (t.inboundMessageId === undefined) {
      if (customers.size === 0) return invalid("no-customer");
      if (customers.size > 1) return invalid("mixed-senders");
      return { ok: true, recipientId: [...customers][0], evidence };
    }
    const target = msgs.find((m) => m.id === t.inboundMessageId);
    if (!target) return unverified;
    if (target.own) return invalid("own-message");
    if (customers.size > 1) return invalid("mixed-senders");
    if (target.from !== t.recipientId) return invalid("foreign-recipient");
    return { ok: true, recipientId: target.from, inboundMs: target.ms, evidence };
  } catch (e) {
    const { code, detail } = failureOf(e, token, secret);
    const error: InstagramDmError =
      code === "token_expired" || code === "rate_limited" || code === "no_permission"
        ? code
        : code === "not_eligible"
          ? "no_permission"
          : "upstream";
    return { ok: false, error, ...(detail ? { detail } : {}) };
  }
}

/** R1: a provider page is proof only as a plain object without any `error` key (a check, not a type narrowing). */
const strictPage = (page: unknown): boolean => isErrorFree(page);

/** The inbound time against the fenced clock: not in the future, inside the local 24 h window. */
const timeRefusal = (ms: number, now: number): string | null =>
  ms > now ? "future-time" : now - ms >= WINDOW_MS ? "window-closed" : null;

/* ---------- routes ---------- */

type Kind =
  | "prepare"
  | "confirm"
  | "status"
  | "cancel"
  | "register"
  | "controlStatus"
  | "takeover"
  | "resume";

function kindOf(rest: string[]): { kind: Kind; id?: string } | null {
  const [family, a, b, extra] = rest;
  if (extra !== undefined || a === undefined) return null;
  if (family === "send") {
    if (b === undefined)
      return a === "prepare" || a === "confirm" ? { kind: a } : { kind: "status", id: a };
    return b === "cancel" ? { kind: "cancel", id: a } : null;
  }
  if (family === "control") {
    if (b === undefined)
      return a === "register" ? { kind: "register" } : { kind: "controlStatus", id: a };
    return b === "takeover" || b === "resume" ? { kind: b, id: a } : null;
  }
  return null;
}

/**
 * `/social/inbox/instagram/dm/*` with its eligibility check; `rest` is the path after "dm" and the handler answers
 * null when the path is not ours. routes.ts passes no `eligibility`, so production stays closed.
 */
export function instagramDmHandler(
  opts: { fetch?: typeof fetch; now?: () => Date; eligibility?: EligibilityCheck } = {},
) {
  const eligibility = opts.eligibility ?? productionEligibility;
  return async function handleInstagramDm(
    req: Request,
    rest: string[],
    deps: InstagramDmDeps,
    reply: Reply,
  ): Promise<Response | null> {
    const route = kindOf(rest);
    if (!route) return null;
    const { kind, id } = route;
    const fail = (error: InstagramDmError, more: Obj = {}) =>
      reply.json({ error, ...more }, STATUS[error]);
    const method = kind === "status" || kind === "controlStatus" ? "GET" : "POST";
    if (req.method !== method) return fail("method_not_allowed");

    const { store, coordinator, seal } = deps;
    if (!coordinator) return fail("not_configured", { detail: "dm-claim-store" });
    const fetchImpl = opts.fetch ?? fetch;
    // Read afresh at every deadline, the claim and the receipt.
    const clock = () => opts.now?.() ?? new Date();
    const call = (account: string, c: DmCall) => coordinateDm(coordinator, account, c);
    /** A pure coordinator refusal as it is; any other `error` answer is unreadable. */
    const refusal = (x: Obj) =>
      fail(
        COORDINATOR_ERRORS.has(x.error) && Object.keys(x).length === 1
          ? (x.error as InstagramDmError)
          : "receipt_unavailable",
      );
    /** An intent answer bound to this request (`want`), else receipt_unavailable. */
    const answer = (x: Obj, want: Obj, more: Obj = {}) => {
      if ("error" in x) return refusal(x);
      return boundIntent(x.intent, want)
        ? reply.json({ intent: x.intent, ...more }, 200)
        : fail("receipt_unavailable");
    };
    /** A control view bound to this request, else receipt_unavailable. */
    const view = (x: Obj, account: string, want: Obj, cas?: Cas) => {
      if ("error" in x) {
        // A stale expected revision: a pure conflict naming only the verified handle's own target.
        if (cas && x.error === "conflict" && Object.keys(x).length === 3) {
          const { control: c, conversation: v } = x;
          return validControl(c, account, want) &&
            validConversation(v, account, c.conversationId as string) &&
            v.revision !== cas.expected
            ? reply.json(
                {
                  error: "conflict",
                  conversation: {
                    account,
                    conversationId: c.conversationId,
                    mode: v.mode,
                    revision: v.revision,
                  },
                  control: {
                    handleId: c.handleId,
                    account,
                    conversationId: c.conversationId,
                    recipientId: c.recipientId,
                  },
                },
                STATUS.conflict,
              )
            : fail("receipt_unavailable");
        }
        return refusal(x);
      }
      return validView(x, account, want, cas) ? reply.json(x, 200) : fail("receipt_unavailable");
    };

    try {
      /* ----- durable recovery: bearer + durable handle only, no token, no provider ----- */
      if (kind === "status" || kind === "cancel") {
        const account =
          kind === "status"
            ? new URL(req.url).searchParams.get("account")
            : (await readBody(req))?.account;
        if (!fits(id, OP_RE) || !isAccount(account)) return fail("bad_request");
        return answer(
          await call(account, {
            op: kind === "status" ? "getIntent" : "cancelIntent",
            account,
            operationId: id,
            now: clock().getTime(),
          }),
          { operationId: id, account },
        );
      }
      if (kind === "controlStatus" || kind === "takeover" || kind === "resume") {
        const input = kind === "controlStatus" ? null : await readBody(req);
        const account =
          kind === "controlStatus" ? new URL(req.url).searchParams.get("account") : input?.account;
        if (!fits(id, HANDLE_RE) || !isAccount(account)) return fail("bad_request");
        const now = clock().getTime();
        if (kind === "controlStatus")
          return view(
            await call(account, { op: "controlStatus", account, handleId: id, now }),
            account,
            { handleId: id },
          );
        const expectedRevision = input?.expectedRevision;
        if (!isCount(expectedRevision)) return fail("bad_request");
        return view(
          await call(account, {
            op: kind === "takeover" ? "controlTakeover" : "controlResume",
            account,
            handleId: id,
            expectedRevision,
            now,
          }),
          account,
          { handleId: id },
          { mode: kind === "takeover" ? "human" : "auto", expected: expectedRevision },
        );
      }

      /* ----- confirm: the durable state is read before any new-send work ----- */
      let input: Obj | null = null;
      let stored: DmIntent | null = null;
      if (kind === "confirm") {
        input = await readBody(req);
        const { operationId, digest, account } = input ?? {};
        if (!fits(operationId, OP_RE) || !fits(digest, DIGEST_RE) || !isAccount(account))
          return fail("bad_request");
        const mine = { operationId, account };
        const got = await call(account, {
          op: "getIntent",
          account,
          operationId,
          now: clock().getTime(),
        });
        if ("error" in got) return refusal(got);
        if (!boundIntent(got.intent, mine)) return fail("receipt_unavailable");
        // Anything past `prepared` (dispatching, settled, already claimed, cancelled, expired) as it stands.
        if (got.intent.state !== "prepared") return answer(got, mine);
        if (got.intent.digest !== digest) return fail("conflict");
        // DT-6B-3C: a still-prepared intent is sent only when its stored text meets today's rule (an older one may
        // exceed 1000 UTF-8 bytes): refused before any token read, GET, claim or POST, and left as it is.
        if (canonicalText(got.intent.text) !== got.intent.text) return fail("text_invalid");
        stored = got.intent;
      }

      /* ----- new work: connection captured once, then the closed-by-default gate ----- */
      if (!store) return fail("not_configured", { detail: "kv" });
      const tokens = await store.getTokens("instagram");
      if (!tokens) return fail("not_connected");
      // No refresh in the send path: the owner renews the connection himself.
      if (isExpired(tokens, clock())) return fail("token_expired");
      const gate = await eligibility({ tokens, now: clock() });
      if (!gate.ok) return fail("no_permission", { detail: gate.reason });
      const stamp = (await store.getStatus("instagram"))?.connectedAt ?? tokens.issuedAt;
      const token = tokens.accessToken;
      /**
       * The final fence, immediately before the coordinator call: token and status read together, then the token once
       * more (a reconnect writes the token first), all equal to the capture; the fresh time, or a refusal.
       */
      const fence = async (): Promise<number | Response> => {
        const [t1, s] = await Promise.all([
          store.getTokens("instagram"),
          store.getStatus("instagram"),
        ]);
        const t2 = await store.getTokens("instagram");
        if (
          !t1 ||
          !t2 ||
          t1.accessToken !== token ||
          JSON.stringify(t1) !== JSON.stringify(t2) ||
          (s?.connectedAt ?? t1.issuedAt) !== stamp
        )
          return fail("stale", { detail: "reconnected" });
        const now = clock();
        if (isExpired(t2, now)) return fail("token_expired");
        return now.getTime();
      };
      const refused = (p: Refusal) => fail(p.error, p.detail ? { detail: p.detail } : {});

      if (kind === "register") {
        input = await readBody(req);
        const { account, conversationId } = input ?? {};
        if (!isAccount(account) || !isId(conversationId)) return fail("bad_request");
        const proof = await proveTarget(fetchImpl, token, { account, conversationId }, seal);
        if (!proof.ok) return refused(proof);
        const generation = await generationOf(account, stamp);
        const evidenceDigest = await sha256Hex(
          `ig-dm-control|${account}|${conversationId}|${proof.recipientId}|${generation}|${proof.evidence}`,
        );
        const fenced = await fence();
        if (typeof fenced !== "number") return fenced;
        return view(
          await call(account, {
            op: "registerControl",
            account,
            conversationId,
            recipientId: proof.recipientId,
            generation,
            evidenceDigest,
            now: fenced,
          }),
          account,
          { conversationId, recipientId: proof.recipientId, registeredGeneration: generation },
        );
      }

      if (kind === "prepare") {
        input = await readBody(req);
        if (!input) return fail("bad_request");
        const { operationId, account, conversationId, recipientId, inboundMessageId } = input;
        const { draftRevision } = input;
        if (
          !fits(operationId, OP_RE) ||
          !isAccount(account) ||
          !isId(conversationId) ||
          !isId(recipientId) ||
          !isId(inboundMessageId) ||
          !fits(draftRevision, REVISION_RE)
        )
          return fail("bad_request");
        // Canonicalized ONCE: what is stored, reviewed and posted.
        const text = canonicalText(input.text);
        if (text === null) return fail("text_invalid");
        const proof = await proveTarget(
          fetchImpl,
          token,
          { account, conversationId, recipientId, inboundMessageId },
          seal,
        );
        if (!proof.ok) return refused(proof);
        // Computed before the fence: no await may sit between the fence and the coordinator call.
        const generation = await generationOf(account, stamp);
        const digest = await sha256Hex(manualBody(recipientId, text));
        const fenced = await fence();
        if (typeof fenced !== "number") return fenced;
        const inboundMs = proof.inboundMs!;
        const late = timeRefusal(inboundMs, fenced);
        if (late) return fail("target_invalid", { detail: late });
        return answer(
          await call(account, {
            op: "prepareIntent",
            input: {
              operationId,
              account,
              generation,
              conversationId,
              recipientId,
              inboundMessageId,
              inboundAt: inboundMs,
              text,
              digest,
              draftRevision,
              reviewExpiresAt: Math.min(fenced + REVIEW_MS, inboundMs + WINDOW_MS),
            },
            now: fenced,
          }),
          // Another operation for the identical live submission converges to that one: bound to every field.
          {
            account,
            generation,
            conversationId,
            recipientId,
            inboundMessageId,
            inboundAt: isoOf(inboundMs),
            text,
            digest,
            draftRevision,
          },
          { verification: { window: "first-page", pageSize: DM_PAGE, inboundWindowMs: WINDOW_MS } },
        );
      }

      /* ----- confirm: re-prove the STORED target, fence, one claim, one POST, one settlement ----- */
      const intent = stored!;
      const { operationId, account } = intent;
      if (intent.generation !== (await generationOf(account, stamp))) return fail("stale");
      const proof = await proveTarget(
        fetchImpl,
        token,
        {
          account,
          conversationId: intent.conversationId,
          recipientId: intent.recipientId,
          inboundMessageId: intent.inboundMessageId,
        },
        seal,
      );
      if (!proof.ok) return refused(proof);
      if (isoOf(proof.inboundMs!) !== intent.inboundAt)
        return fail("target_invalid", { detail: "inbound-changed" });
      // The stored bytes, re-hashed before the fence: exactly what was reviewed, or nothing.
      const body = manualBody(intent.recipientId, intent.text);
      if ((await sha256Hex(body)) !== intent.digest) return fail("receipt_unavailable");
      const fenced = await fence();
      if (typeof fenced !== "number") return fenced;
      // The fresh time: a review that ran out during the GETs is expired by the coordinator, and nothing is claimed.
      const claim = await call(account, {
        op: "claimConfirm",
        account,
        operationId,
        digest: intent.digest,
        now: fenced,
      });
      const mine = payloadOf(intent);
      if (!isErrorFree(claim)) return refusal(claim);
      if (claim.claimed !== true)
        return claim.claimed === false &&
          isObj(claim.intent) &&
          claim.intent.state !== "prepared" &&
          versionOf(claim.intent) > intent.receiptVersion
          ? answer(claim, mine)
          : fail("receipt_unavailable");
      const actor = `manual:${operationId}`;
      const attempt = {
        account,
        conversationId: intent.conversationId,
        inboundMessageId: intent.inboundMessageId,
        recipientId: intent.recipientId,
        actor,
        generation: intent.generation,
        now: fenced,
      };
      // Won only with this very intent (its whole payload) at exactly the next version, now dispatching, and the
      // claimed effect of this attempt.
      if (
        !boundIntent(claim.intent, {
          ...mine,
          state: "dispatching",
          claimedAt: isoOf(fenced),
          receiptVersion: intent.receiptVersion + 1,
        }) ||
        !boundEffect(claim.effect, attempt, intent.digest, { state: "claimed" }) ||
        !(versionOf(claim.effect) >= 1)
      )
        return fail("receipt_unavailable");
      const won = claim.intent;

      // The claim is committed: this inbound message is never answered again, whatever happens below.
      const sent = await dispatchClaimed(
        { fetch: fetchImpl, budget: new Budget(1) },
        { account, recipientId: intent.recipientId, token },
        body,
        seal,
      );
      const outcome: DmOutcome =
        sent.state === "sent"
          ? { state: "sent", providerMessageId: sent.providerMessageId }
          : sent.state === "rejected"
            ? { state: "rejected", code: sent.code }
            : { state: "unknown", reason: sent.reason };
      try {
        const settled = await call(account, {
          op: "settleManual",
          account,
          operationId,
          outcome,
          now: clock().getTime(),
        });
        // A receipt only when the effect and this intent (its whole payload) both durably record exactly this outcome,
        // each at a version newer than its claim.
        if (
          isErrorFree(settled) &&
          typeof settled.settled === "boolean" &&
          versionOf(settled.intent) > won.receiptVersion &&
          versionOf(settled.effect) > versionOf(claim.effect) &&
          boundEffect(settled.effect, attempt, intent.digest, outcome) &&
          boundIntent(settled.intent, {
            ...mine,
            state: outcome.state,
            claimedAt: won.claimedAt,
            providerMessageId: outcome.state === "sent" ? outcome.providerMessageId : undefined,
            failureCode: outcome.state === "rejected" ? outcome.code : undefined,
            unknownReason: outcome.state === "unknown" ? outcome.reason : undefined,
          })
        )
          return reply.json({ intent: settled.intent }, 200);
      } catch {
        // Below: a lost receipt.
      }
      // No durable settlement: the intent stays dispatching; what was observed is reported, never as a receipt.
      const observed =
        sent.state === "sent"
          ? { state: "unknown", reason: "receipt" }
          : sent.state === "rejected"
            ? {
                state: "rejected",
                code: sent.code,
                ...(sent.detail ? { detail: sent.detail } : {}),
              }
            : { state: "unknown", reason: sent.reason };
      return reply.json({ intent: won, observed, settlement: "pending" }, 200);
    } catch (e) {
      if (e instanceof DmStoreDown) return fail("receipt_unavailable");
      throw e;
    }
  };
}
