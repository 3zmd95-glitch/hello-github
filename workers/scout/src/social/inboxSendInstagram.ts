/**
 * 📤 Reviewed Instagram public comment replies (packet DT-6B-2C-1, planning/tools/37-inbox-send.md), Worker protocol
 * only. One plain-text public reply under one comment on the owner's own media, after the owner reviewed the exact
 * account, destination and text and pressed Send. No UI, no DMs, no conversation takeover (later packets).
 *
 *   POST /social/inbox/instagram/send/prepare             { operationId, account, mediaId, commentId, text, draftRevision }
 *                                                         → { intent, verification }
 *   POST /social/inbox/instagram/send/confirm             { operationId, digest, account } → { intent }
 *   GET  /social/inbox/instagram/send/:operationId?account                                → { intent }
 *   POST /social/inbox/instagram/send/:operationId/cancel { account }                     → { intent }
 *
 * Eligibility gate. Production preparation and confirmation fail closed: `no_permission`, detail
 * `permission_unverified`, before any provider call. Readiness gap: the public-endpoint permission/API-version
 * semantics and a trusted record of what the account actually granted are unverified. `canReply`, stored or requested
 * scopes, the Inbox readers' capabilities and browser settings never open it. Only
 * `instagramSendHandler({ eligibility })` can, and only tests pass one.
 *
 * Raw ids are selectors, never authority: the accepted readers' bearer-derived generations and raw media paths are not
 * proof of ownership. Prepare captures the token and connection stamp ONCE, then `verifyTarget` (instagramPublicSend.ts)
 * proves the target within at most three bounded GETs (first pages only, local window): `/me`'s `user_id` must equal
 * `account` (never the OAuth `tokens.userId`), the media must be on the first owned-media page, the comment on that
 * media's first comment page. Absent → `target_unverified` / `outside-local-window`. Then the final fence: token and
 * status read together and the token once more after the status, all equal to the capture (a reconnect or account
 * change is `stale` / `reconnected`), with nothing else awaited before the InstagramPublicSendCoordinator stores the
 * immutable intent (10 min review, from the fresh time). No POST.
 *
 * Confirm: token, gate, generation (the stamp unchanged since prepare), digest and expiry; `verifyTarget` again; the
 * same final fence immediately before the claim (an expired token is `token_expired`); then ONE coordinator
 * transaction, at the fresh time (a review that ran out during the GETs is `expired`), claims both the intent and
 * the shared `(account, comment)` public effect. If the automatic acknowledgement (replies.ts) or another operation
 * holds that comment, the intent is `already_claimed` and nothing is sent. Otherwise ONE dispatch (instagramPublicSend.ts)
 * and its settle: sent (string reply id + durable receipt), rejected (Meta's known refusal), or unknown (timeout,
 * network, 5xx, malformed or oversize answer, or a receipt that could not be written). Nothing is retried or reopened.
 * Status and cancel need only the owner bearer and the stored operation: zero provider calls. Cancel ends a prepared
 * intent only and never touches the public effect.
 *
 * DT-6B-2C-1-R1: the clock is read afresh at every deadline, the claim and the receipt (routes.ts passes a live one);
 * every coordinator answer must be bound to this request (operation, account, target, state, integer version, and the
 * settled outcome) or it is `receipt_unavailable` before a POST and an unknown receipt after one.
 *
 * DT-6B-2C-1-R2: every intent answer is a complete typed intent (`validIntent`: all fields, a supported state and that
 * state's proof) bound to what the phase already knows: prepare to the exact reviewed submission (account, generation,
 * media, comment, text, digest, revision; a converging operation may answer its own id and times), the claim and the
 * receipt to the validated intent's whole payload (the receipt also to its outcome), status and cancel to operation and
 * account. An answer carrying an `error` beside anything else is never proof: `receipt_unavailable` before a POST, the
 * validated operation as unknown (receipt) after one.
 *
 * The token travels in the reply's form body (the GETs use the query parameter, as every Instagram read does). Bodies,
 * tokens and the seal key are never logged or answered.
 */

import { BODY_BYTES_MAX, REVIEW_MS, type Reply } from "./inboxSendYouTube";
import { PATH_ID_RE } from "./inboxReadCommon";
import {
  coordinateIg,
  dispatchPublicReply,
  effectFor,
  IG_SEND_TEXT_MAX,
  IG_VERIFY_PAGE,
  isObj,
  isVersion,
  readCapped,
  ReceiptDown,
  recordsOutcome,
  verifyTarget,
} from "./instagramPublicSend";
import type {
  IgIntent,
  IgOutcome,
  IgPublicAnswer,
  IgPublicCall,
  IgSendState,
} from "./instagramPublicSendCoordinator";
import { Budget } from "./http";
import { isExpired } from "./oauth";
import type { Store } from "./store";
import type { TokenSet } from "./types";

const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REVISION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export type InstagramSendError =
  | "not_configured"
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "stale"
  | "account_mismatch"
  | "bad_request"
  | "text_invalid"
  | "target_unverified"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  | "method_not_allowed";

const STATUS: Record<InstagramSendError, number> = {
  not_configured: 503,
  not_connected: 409,
  no_permission: 403,
  token_expired: 409,
  stale: 409,
  account_mismatch: 409,
  bad_request: 400,
  text_invalid: 400,
  target_unverified: 409,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream: 502,
  receipt_unavailable: 503,
  method_not_allowed: 405,
};

/* ---------- the eligibility gate ---------- */

export type InstagramEligibility = { ok: true } | { ok: false; reason: "permission_unverified" };
export type EligibilityCheck = (ctx: {
  tokens: TokenSet;
  now: Date;
}) => InstagramEligibility | Promise<InstagramEligibility>;

/** Closed until public-endpoint permission semantics and actual grant evidence are verified. */
const productionEligibility: EligibilityCheck = () => ({
  ok: false,
  reason: "permission_unverified",
});

/* ---------- routes ---------- */

export interface InstagramSendDeps {
  store: Store | null;
  coordinator: DurableObjectNamespace | undefined;
  /** INBOX_SEAL_SECRET when set: only cut out of any provider words, never required here. */
  seal?: string;
}

const enc = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The connection generation an intent is bound to: changes with a reconnect (connectedAt), never the token. */
const generationOf = async (account: string, stamp: string) =>
  (await sha256Hex(`ig-send-gen|${account}|${stamp}`)).slice(0, 32);

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await readCapped(req.body, BODY_BYTES_MAX);
    if (text === null) return null;
    const v = JSON.parse(text || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isId = (v: unknown): v is string => typeof v === "string" && PATH_ID_RE.test(v);

/** Coordinator refusals answered as they are; any other error from it is unreadable. */
const COORDINATOR_ERRORS: ReadonlySet<unknown> = new Set(["conflict", "not_found", "bad_request"]);

const STATES: ReadonlySet<unknown> = new Set<IgSendState>([
  "prepared",
  "dispatching",
  "sent",
  "rejected",
  "unknown",
  "expired",
  "cancelled",
  "already_claimed",
]);
/** Who an `already_claimed` intent lost to (the coordinator's `failureDetail`). */
const HOLDERS: ReadonlySet<unknown> = new Set(["automatic", "manual", "retired"]);
const fits = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isTime = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const maybe = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v);

/**
 * DT-6B-2C-1-R2: a complete, typed intent in a supported state carrying the proof that state needs (sent: its reply id;
 * rejected: a failure code; unknown: a reason; already_claimed: who holds the comment).
 */
function validIntent(i: unknown): i is IgIntent {
  if (!isObj(i)) return false;
  const proof =
    i.state === "sent"
      ? isId(i.providerReplyId)
      : i.state === "rejected"
        ? isText(i.failureCode)
        : i.state === "unknown"
          ? isText(i.unknownReason)
          : i.state === "already_claimed"
            ? HOLDERS.has(i.failureDetail)
            : true;
  return (
    proof &&
    fits(i.operationId, OP_RE) &&
    i.provider === "instagram" &&
    isId(i.account) &&
    isText(i.generation) &&
    isId(i.mediaId) &&
    isId(i.commentId) &&
    isText(i.text) &&
    fits(i.digest, DIGEST_RE) &&
    fits(i.draftRevision, REVISION_RE) &&
    STATES.has(i.state) &&
    isVersion(i.receiptVersion) &&
    [i.reviewExpiresAt, i.createdAt, i.updatedAt].every(isTime) &&
    [i.claimedAt, i.settledAt].every((t) => maybe(t, isTime)) &&
    [i.providerReplyId, i.failureCode, i.failureDetail, i.unknownReason].every((t) =>
      maybe(t, isText),
    )
  );
}

/** A valid intent whose every `want` field is equal: what this phase already knows. */
function boundIntent(i: unknown, want: Record<string, unknown>): i is IgIntent {
  return validIntent(i) && Object.entries(want).every(([k, v]) => i[k as keyof IgIntent] === v);
}

/** The immutable payload a validated intent is bound to; every later answer for it must repeat it. */
const payloadOf = (i: IgIntent) => ({
  operationId: i.operationId,
  account: i.account,
  generation: i.generation,
  mediaId: i.mediaId,
  commentId: i.commentId,
  text: i.text,
  digest: i.digest,
  draftRevision: i.draftRevision,
});

/**
 * `/social/inbox/instagram/send/*` with its eligibility check; `rest` is the path after "send" and the handler answers
 * null when the path is not ours. routes.ts passes no `eligibility`, so production stays closed.
 */
export function instagramSendHandler(
  opts: { fetch?: typeof fetch; now?: () => Date; eligibility?: EligibilityCheck } = {},
) {
  const eligibility = opts.eligibility ?? productionEligibility;
  return async function handleInstagramSend(
    req: Request,
    rest: string[],
    deps: InstagramSendDeps,
    reply: Reply,
  ): Promise<Response | null> {
    const [a, b, extra] = rest;
    const kind =
      a === "prepare" && b === undefined
        ? "prepare"
        : a === "confirm" && b === undefined
          ? "confirm"
          : a !== undefined && b === undefined
            ? "status"
            : a !== undefined && b === "cancel" && extra === undefined
              ? "cancel"
              : null;
    if (!kind || extra !== undefined) return null;
    const fail = (error: InstagramSendError, more: Record<string, unknown> = {}) =>
      reply.json({ error, ...more }, STATUS[error]);
    if (req.method !== (kind === "status" ? "GET" : "POST")) return fail("method_not_allowed");

    const { store, coordinator, seal } = deps;
    if (!store) return fail("not_configured", { detail: "kv" });
    if (!coordinator) return fail("not_configured", { detail: "receipt-store" });
    const fetchImpl = opts.fetch ?? fetch;
    // DT-6B-2C-1-R1 2C1-2: read afresh at every deadline, the claim and the receipt; `at` is the request start, used
    // only by status, cancel and the first read of an operation.
    const clock = () => opts.now?.() ?? new Date();
    const at = clock().getTime();
    const call = (account: string, c: IgPublicCall) => coordinateIg(coordinator, account, c);
    /** An intent answer bound to this request (`want`: operation, account, target…), else receipt_unavailable. */
    const answer = (
      x: IgPublicAnswer,
      want: Record<string, unknown>,
      more: Record<string, unknown> = {},
    ) => {
      const r = x as Record<string, unknown>;
      // Only a pure error envelope is a refusal; an error beside anything else is unreadable, never proof.
      if ("error" in r)
        return fail(
          COORDINATOR_ERRORS.has(r.error) && Object.keys(r).length === 1
            ? (r.error as InstagramSendError)
            : "receipt_unavailable",
        );
      return boundIntent(r.intent, want)
        ? reply.json({ intent: r.intent, ...more }, 200)
        : fail("receipt_unavailable");
    };

    try {
      // Status and cancel read or end an operation without the provider: they work with no connection at all.
      if (kind === "status" || kind === "cancel") {
        const account =
          kind === "status"
            ? new URL(req.url).searchParams.get("account")
            : (await readBody(req))?.account;
        if (!OP_RE.test(a) || !isId(account)) return fail("bad_request");
        return answer(
          await call(
            account,
            kind === "status"
              ? { op: "get", operationId: a, now: at }
              : { op: "cancel", operationId: a, now: at },
          ),
          { operationId: a, account },
        );
      }

      // The token and the connection stamp are captured once; every later check compares against these.
      const tokens = await store.getTokens("instagram");
      if (!tokens) return fail("not_connected");
      // No refresh in the send path: the owner renews the connection himself.
      if (isExpired(tokens, clock())) return fail("token_expired");
      const gate = await eligibility({ tokens, now: clock() });
      if (!gate.ok) return fail("no_permission", { detail: gate.reason });
      const status = await store.getStatus("instagram");
      const stamp = status?.connectedAt ?? tokens.issuedAt;
      const token = tokens.accessToken;
      /**
       * 2C1-1, the final fence, immediately before the receipt write or the claim: token and status read together, then
       * the token once more after the status (a reconnect writes the token first), all equal to the capture. Answers the
       * fresh time for that one coordinator call, or a refusal; nothing else is awaited between the fence and the call.
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
      /** The bounded ownership proof; the identity is `/me`'s user_id and must be the account named. */
      const prove = async (account: string, mediaId: string, commentId: string) => {
        const v = await verifyTarget(fetchImpl, token, { account, mediaId, commentId }, seal);
        return v.ok ? null : fail(v.error, v.detail ? { detail: v.detail } : {});
      };

      const input = await readBody(req);
      if (!input) return fail("bad_request");
      const operationId = input.operationId;
      if (typeof operationId !== "string" || !OP_RE.test(operationId)) return fail("bad_request");

      if (kind === "prepare") {
        const { account, mediaId, commentId, draftRevision } = input;
        if (typeof draftRevision !== "string" || !REVISION_RE.test(draftRevision))
          return fail("bad_request");
        if (!isId(account) || !isId(mediaId) || !isId(commentId)) return fail("bad_request");
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text || Array.from(text).length > IG_SEND_TEXT_MAX) return fail("text_invalid");
        const refused = await prove(account, mediaId, commentId);
        if (refused) return refused;
        // Computed before the fence: no await may sit between the fence and the receipt write.
        const generation = await generationOf(account, stamp);
        const digest = await sha256Hex(text);
        const fenced = await fence();
        if (typeof fenced !== "number") return fenced;
        return answer(
          await call(account, {
            op: "prepare",
            input: {
              operationId,
              account,
              generation,
              mediaId,
              commentId,
              text,
              digest,
              draftRevision,
              reviewExpiresAt: fenced + REVIEW_MS,
            },
            now: fenced,
          }),
          // Another operation for the same live submission converges to that one (its id and times): bound to the
          // exact reviewed submission instead, target and text included.
          { account, generation, mediaId, commentId, text, digest, draftRevision },
          // The verification window is part of the answer: only targets on these first pages can be prepared.
          { verification: { window: "first-page", pageSize: IG_VERIFY_PAGE } },
        );
      }

      // confirm
      const { digest, account } = input;
      if (typeof digest !== "string" || !DIGEST_RE.test(digest)) return fail("bad_request");
      if (!isId(account)) return fail("bad_request");
      const mine = { operationId, account };
      const got = await call(account, { op: "get", operationId, now: at });
      if ("error" in got) return answer(got, mine);
      if (!("intent" in got) || !boundIntent(got.intent, mine)) return fail("receipt_unavailable");
      const intent = got.intent;
      // Anything past `prepared` (dispatching, sent, rejected, unknown, already claimed, expired, cancelled) as it stands.
      if (intent.state !== "prepared") return answer(got, mine);
      if (intent.digest !== digest) return fail("conflict");
      if (intent.generation !== (await generationOf(account, stamp))) return fail("stale");
      const refused = await prove(account, intent.mediaId, intent.commentId);
      if (refused) return refused;

      const fenced = await fence();
      if (typeof fenced !== "number") return fenced;
      // The fresh time: a review that ran out during the GETs is expired by the coordinator, and nothing is claimed.
      const claim = (await call(account, {
        op: "claimConfirm",
        operationId,
        digest,
        now: fenced,
      })) as Record<string, unknown>;
      if ("error" in claim || claim.claimed !== true) return answer(claim as IgPublicAnswer, mine);
      // 2C1-5: won only with this very intent (its whole payload), now dispatching, and the claimed effect of this
      // target and actor.
      const actor = `manual:${operationId}`;
      const won = claim.intent as IgIntent;
      if (
        !boundIntent(won, { ...payloadOf(intent), state: "dispatching" }) ||
        !effectFor(claim.effect, account, intent.commentId, actor, "claimed")
      )
        return fail("receipt_unavailable");

      // The claim is committed: this comment's public reply is never dispatched again, whatever happens.
      const sent = await dispatchPublicReply(
        { fetch: fetchImpl, budget: new Budget(1) },
        token,
        won.commentId,
        won.text,
        seal,
      );
      const outcome: IgOutcome =
        sent.state === "sent"
          ? sent
          : sent.state === "rejected"
            ? {
                state: "rejected",
                code: sent.code,
                ...(sent.detail ? { detail: sent.detail } : {}),
              }
            : { state: "unknown", reason: sent.reason };
      try {
        const settled = await call(account, {
          op: "settle",
          account,
          commentId: won.commentId,
          actor,
          outcome,
          now: clock().getTime(),
        });
        // A receipt only when the effect and this intent (its whole payload) both durably record exactly this outcome.
        const mirrored = (settled as { intent?: unknown }).intent;
        if (
          recordsOutcome(settled, account, won.commentId, actor, outcome) &&
          boundIntent(mirrored, {
            ...payloadOf(won),
            state: outcome.state,
            ...(outcome.state === "sent"
              ? { providerReplyId: outcome.providerReplyId }
              : outcome.state === "rejected"
                ? { failureCode: outcome.code }
                : { unknownReason: outcome.reason }),
          })
        )
          return reply.json({ intent: mirrored }, 200);
      } catch {
        // Below: a lost receipt.
      }
      // A lost or unreadable receipt is never success: unknown, and the claim still holds.
      return reply.json({ intent: { ...won, state: "unknown", unknownReason: "receipt" } }, 200);
    } catch (e) {
      if (e instanceof ReceiptDown) return fail("receipt_unavailable");
      throw e;
    }
  };
}
