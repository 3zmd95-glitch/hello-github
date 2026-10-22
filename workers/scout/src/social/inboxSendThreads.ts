/**
 * 📤 Reviewed Threads public text replies (packet DT-6B-2B-1, planning/tools/37-inbox-send.md), Worker protocol only.
 * One plain-text public reply to one exact direct reply under the owner's own Threads post, after the owner reviewed
 * the exact account, destination and text and pressed Send. No UI here (DT-6B-2B-2).
 *
 *   POST /social/inbox/threads/send/prepare             { operationId, sendRef, text, draftRevision } → { intent }
 *   POST /social/inbox/threads/send/confirm             { operationId, digest, account }              → { intent }
 *   GET  /social/inbox/threads/send/:operationId?account                                               → { intent }
 *   POST /social/inbox/threads/send/:operationId/cancel { account }                                   → { intent }
 *
 * Eligibility gate. Production preparation and confirmation fail closed: `no_permission` with detail
 * `permission_unverified`. Readiness gap: the endpoint-specific permission for creating a reply and a trusted record
 * of what this account actually granted are unverified (Meta's permission pages answered 429 in Codex's audit; the
 * collection-level scope list is not a minimum). The stored scope string (threads.ts writes the configured TH_SCOPES,
 * not the grant), `canPublish` and the browser never open this gate. Only `threadsSendHandler({ eligibility })` can,
 * and only tests pass one.
 *
 * Prepare: live token (no refresh), the gate, a `sendRef` this Worker sealed (domain `send-target-v1|threads`) for the
 * current account and generation naming the owned root post and the exact reply, text trimmed and 1–500 code points
 * (THREADS_SEND_TEXT_MAX: local product policy, not a verified provider limit), and ONE bounded GET of
 * `/{reply}?fields=id,root_post,replied_to` that must show the same reply, the owned root and the root as parent.
 * Then the ThreadsSendCoordinator stores the immutable intent. No POST.
 *
 * Token identity (DT-6B-2B-1-R1): the stored token's own `userId` must equal the sealed account (prepare) or the
 * operation's account (confirm, both stages), else `account_mismatch` (detail `identity`) before any GET, POST or claim.
 *
 * Confirm: token, identity, gate, digest and generation again. Stage one: the coordinator's create claim BEFORE one
 * `POST /me/threads` (media_type=TEXT, text, reply_to_id; never auto_publish_text). A 2xx with a string id and no
 * error is the container, recorded durably before anything else; a refusal with Meta's error body is `rejected`; a
 * timeout, a broken connection, a 5xx, a malformed or contradictory success, or a container whose receipt cannot be
 * written is `unknown_creation`. Stage two: the publish claim BEFORE one `POST /me/threads_publish` with the stored
 * `creation_id` only: a string id is `published`, a refusal `rejected`, anything else (or a lost receipt)
 * `unknown_publication`. Nothing is retried, recreated, reclaimed or matched by text or time. A confirm on `created`
 * (container durable, publish never claimed) re-checks token, gate, generation and the exact digest and continues at
 * the publish claim only. Status and cancel make zero provider calls; cancel ends only a prepared intent.
 * Container-status reconciliation (a GET-only provider action) is a recorded follow-up, not part of this packet.
 *
 * Both POSTs carry the token in the form body, never the URL (the preflight GET uses the query parameter, as every
 * Threads read does). Bodies, tokens and the seal key are never logged or answered.
 */

import { fromBase64Url, toBase64Url } from "./crypto";
import { Budget, formPost } from "./http";
import { PAGE_BYTES_MAX, scrub } from "./inboxRead";
import {
  boundedJson,
  failureOf,
  generationV2,
  GEN_RE,
  PATH_ID_RE,
  plainId,
  same,
  SEAL_MAX,
} from "./inboxReadCommon";
import { BODY_BYTES_MAX, POST_TIMEOUT_MS, REVIEW_MS, type Reply } from "./inboxSendYouTube";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { graph } from "./replyCore";
import type { Store } from "./store";
import { TH_API } from "./threads";
import type {
  ThreadsAnswer,
  ThreadsCall,
  ThreadsIntent,
  ThreadsOutcome,
} from "./threadsSendCoordinator";
import type { TokenSet } from "./types";

/** The longest reply text in Unicode code points, after trimming: local product policy, not a verified provider limit. */
export const THREADS_SEND_TEXT_MAX = 500;

const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REVISION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const SEAL_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const DETAIL_MAX = 200;

export type ThreadsSendError =
  | "not_configured"
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "stale"
  | "account_mismatch"
  | "bad_request"
  | "text_invalid"
  | "target_invalid"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  | "method_not_allowed";

const STATUS: Record<ThreadsSendError, number> = {
  not_configured: 503,
  not_connected: 409,
  no_permission: 403,
  token_expired: 409,
  stale: 409,
  account_mismatch: 409,
  bad_request: 400,
  text_invalid: 400,
  target_invalid: 400,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream: 502,
  receipt_unavailable: 503,
  method_not_allowed: 405,
};

/* ---------- the eligibility gate ---------- */

export type ThreadsEligibility = { ok: true } | { ok: false; reason: "permission_unverified" };
export type EligibilityCheck = (ctx: {
  tokens: TokenSet;
  now: Date;
}) => ThreadsEligibility | Promise<ThreadsEligibility>;

/** Closed until endpoint-specific grant evidence exists (see the readiness gap above). */
const productionEligibility: EligibilityCheck = () => ({
  ok: false,
  reason: "permission_unverified",
});

/* ---------- the sealed send target ---------- */

/** What a Threads send target names: account, generation, owned root post id, the exact reply replied to. */
export interface ThreadsSendTarget {
  a: string;
  g: string;
  r: string;
  t: string;
}

const enc = new TextEncoder();
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const keys = new Map<string, Promise<CryptoKey>>();

/** HMAC-SHA256(INBOX_SEAL_SECRET, "send-target-v1|threads"): its own domain; read refs and YouTube targets never open. */
function sendKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = (async () => {
      const root = await crypto.subtle.importKey("raw", enc.encode(secret), HMAC, false, ["sign"]);
      const derived = await crypto.subtle.sign("HMAC", root, enc.encode("send-target-v1|threads"));
      return crypto.subtle.importKey("raw", derived, HMAC, false, ["sign", "verify"]);
    })();
    keys.set(secret, k);
  }
  return k;
}

export async function sealThreadsSendTarget(secret: string, t: ThreadsSendTarget): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify({ a: t.a, g: t.g, r: t.r, t: t.t })));
  const sig = await crypto.subtle.sign("HMAC", await sendKey(secret), enc.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function openThreadsSendTarget(
  secret: string,
  sealed: unknown,
): Promise<ThreadsSendTarget | null> {
  if (typeof sealed !== "string" || sealed.length > SEAL_MAX || !SEAL_RE.test(sealed)) return null;
  const [body, sig] = sealed.split(".");
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await sendKey(secret),
      fromBase64Url(sig),
      enc.encode(body),
    );
    if (!ok) return null;
    const v = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Record<string, unknown>;
    if (![v.a, v.r, v.t].every((x) => typeof x === "string" && PATH_ID_RE.test(x))) return null;
    if (typeof v.g !== "string" || !GEN_RE.test(v.g)) return null;
    return { a: v.a, g: v.g, r: v.r, t: v.t } as ThreadsSendTarget;
  } catch {
    return null;
  }
}

/* ---------- the coordinator ---------- */

class ReceiptDown extends Error {}

async function coordinate(
  ns: DurableObjectNamespace,
  account: string,
  call: ThreadsCall,
): Promise<ThreadsAnswer> {
  try {
    const stub = ns.get(ns.idFromName(`threads|${account}`));
    const res = await stub.fetch("https://threads-send-coordinator/", {
      method: "POST",
      body: JSON.stringify(call),
    });
    if (!res.ok) throw new ReceiptDown();
    return (await res.json()) as ThreadsAnswer;
  } catch {
    throw new ReceiptDown();
  }
}

/* ---------- provider calls ---------- */

interface ThReplyNode extends MetaError {
  id?: unknown;
  root_post?: { id?: unknown };
  replied_to?: { id?: unknown };
}

/** The one preflight GET: the sealed reply still exists, under the owned root post, as a direct reply to it. */
async function preflight(
  doFetch: typeof fetch,
  token: string,
  seal: string,
  t: ThreadsSendTarget,
): Promise<ThreadsSendError | null> {
  const url = new URL(`${TH_API}/${t.t}`);
  url.searchParams.set("fields", "id,root_post,replied_to");
  url.searchParams.set("access_token", token);
  let node: ThReplyNode;
  try {
    const reply = await boundedJson<ThReplyNode>(
      { fetch: doFetch, budget: new Budget(1) },
      url.toString(),
    );
    if (reply.status === 404) return "not_found";
    node = graph(reply, "reply");
  } catch (e) {
    const { code } = failureOf(e, token, seal);
    if (code === "token_expired" || code === "rate_limited" || code === "no_permission")
      return code;
    return code === "not_eligible" ? "no_permission" : "upstream";
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) return "upstream";
  if (
    plainId(node.id, PATH_ID_RE) !== t.t ||
    plainId(node.root_post?.id, PATH_ID_RE) !== t.r ||
    plainId(node.replied_to?.id, PATH_ID_RE) !== t.r
  )
    return "target_invalid";
  return null;
}

/** Reads a body through a byte counter; null (and the stream cancelled) as soon as it passes `max` bytes. */
async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<string | null> {
  const reader = stream?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type Posted = { id: string } | { refused: string; detail?: string } | { unknown: string };

/** One provider POST (create or publish), classified. Never retried. */
async function postOnce(
  doFetch: typeof fetch,
  path: "me/threads" | "me/threads_publish",
  params: Record<string, string>,
  token: string,
  seal: string,
): Promise<Posted> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
  let res: Response;
  let raw: string | null;
  try {
    res = await doFetch(`${TH_API}/${path}`, {
      ...formPost({ ...params, access_token: token }),
      signal: ctrl.signal,
    });
    // An answer over PAGE_BYTES_MAX is one we cannot trust.
    raw = await readCapped(res.body, PAGE_BYTES_MAX);
  } catch {
    return { unknown: ctrl.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
  let obj: (MetaError & { id?: unknown }) | null = null;
  try {
    const v = raw === null ? null : (JSON.parse(raw) as unknown);
    obj = v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    obj = null;
  }
  if (res.ok)
    // A success that also carries an error, or no plain string id, is ambiguous: it may or may not have happened.
    return obj && !("error" in obj) && typeof obj.id === "string" && PATH_ID_RE.test(obj.id)
      ? { id: obj.id }
      : { unknown: "malformed" };
  // A refusal Meta explains in its error body is known; anything else may have gone through.
  if (res.status >= 400 && res.status < 500 && obj?.error && typeof obj.error === "object") {
    const c = obj.error.code;
    const code = Number.isSafeInteger(c) ? `meta_${c}` : `http_${res.status}`;
    const message = typeof obj.error.message === "string" ? obj.error.message : undefined;
    const detail = scrub(message?.split(seal).join("[secret]"), token)?.slice(0, DETAIL_MAX);
    return { refused: code, ...(detail ? { detail } : {}) };
  }
  return { unknown: "server" };
}

/* ---------- routes ---------- */

export interface ThreadsSendDeps {
  store: Store | null;
  /** INBOX_SEAL_SECRET when usable (routes.ts checks length and that it is not the bearer). */
  seal: string | undefined;
  coordinator: DurableObjectNamespace | undefined;
}

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

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `/social/inbox/threads/send/*` with its eligibility check; `rest` is the path after "send" and the handler answers
 * null when the path is not ours. routes.ts passes no `eligibility`, so production stays closed.
 */
export function threadsSendHandler(
  opts: { fetch?: typeof fetch; now?: () => Date; eligibility?: EligibilityCheck } = {},
) {
  const eligibility = opts.eligibility ?? productionEligibility;
  return async function handleThreadsSend(
    req: Request,
    rest: string[],
    deps: ThreadsSendDeps,
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
    const fail = (error: ThreadsSendError, more: Record<string, unknown> = {}) =>
      reply.json({ error, ...more }, STATUS[error]);
    if (req.method !== (kind === "status" ? "GET" : "POST")) return fail("method_not_allowed");

    const { store, seal, coordinator } = deps;
    if (!store) return fail("not_configured", { detail: "kv" });
    if (!seal) return fail("not_configured", { detail: "seal" });
    if (!coordinator) return fail("not_configured", { detail: "receipt-store" });
    const fetchImpl = opts.fetch ?? fetch;
    const now = opts.now?.() ?? new Date();
    const at = now.getTime();
    const call = (account: string, c: ThreadsCall) => coordinate(coordinator, account, c);
    const answer = (x: ThreadsAnswer) =>
      "error" in x ? fail(x.error) : reply.json({ intent: x.intent }, 200);

    try {
      // Status and cancel read or end an operation without the provider: they work with an expired token too.
      if (kind === "status" || kind === "cancel") {
        const account =
          kind === "status"
            ? new URL(req.url).searchParams.get("account")
            : (await readBody(req))?.account;
        if (!OP_RE.test(a) || typeof account !== "string" || !PATH_ID_RE.test(account))
          return fail("bad_request");
        return answer(
          await call(
            account,
            kind === "status"
              ? { op: "get", operationId: a, now: at }
              : { op: "cancel", operationId: a, now: at },
          ),
        );
      }

      const tokens = await store.getTokens("threads");
      if (!tokens) return fail("not_connected");
      // No refresh in the send path: the owner renews the connection himself.
      if (isExpired(tokens, now)) return fail("token_expired");
      const gate = await eligibility({ tokens, now });
      if (!gate.ok) return fail("no_permission", { detail: gate.reason });
      const status = await store.getStatus("threads");
      const stamp = status?.connectedAt ?? tokens.issuedAt;
      const token = tokens.accessToken;
      /**
       * Both POSTs go to /me/*: they act as whoever owns the token, not as the account a ref or intent names. The OAuth
       * callback writes the new token before the new connectedAt (routes.ts), so another account's token can sit next
       * to the old stamp and pass the generation check. The token must itself name the sealed/immutable account; a
       * token without an account id fails closed. Status and cancel stay credential-independent above.
       */
      const owns = (acc: string) => typeof tokens.userId === "string" && tokens.userId === acc;
      const input = await readBody(req);
      if (!input) return fail("bad_request");
      const operationId = input.operationId;
      if (typeof operationId !== "string" || !OP_RE.test(operationId)) return fail("bad_request");

      if (kind === "prepare") {
        const draftRevision = input.draftRevision;
        if (typeof draftRevision !== "string" || !REVISION_RE.test(draftRevision))
          return fail("bad_request");
        const target = await openThreadsSendTarget(seal, input.sendRef);
        if (!target) return fail("target_invalid");
        if (!same(target.g, await generationV2(seal, "threads", target.a, stamp)))
          return fail("stale");
        if (!owns(target.a)) return fail("account_mismatch", { detail: "identity" });
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text || Array.from(text).length > THREADS_SEND_TEXT_MAX) return fail("text_invalid");
        const refused = await preflight(fetchImpl, token, seal, target);
        if (refused) return fail(refused);
        return answer(
          await call(target.a, {
            op: "prepare",
            input: {
              operationId,
              account: target.a,
              generation: target.g,
              rootPostId: target.r,
              replyToId: target.t,
              text,
              digest: await sha256Hex(text),
              draftRevision,
              reviewExpiresAt: at + REVIEW_MS,
            },
            now: at,
          }),
        );
      }

      // confirm
      const { digest, account } = input;
      if (typeof digest !== "string" || !DIGEST_RE.test(digest)) return fail("bad_request");
      if (typeof account !== "string" || !PATH_ID_RE.test(account)) return fail("bad_request");
      // Before the create claim and the created-resume publish claim alike (no coordinator call at all).
      if (!owns(account)) return fail("account_mismatch", { detail: "identity" });
      const got = await call(account, { op: "get", operationId, now: at });
      if ("error" in got) return fail(got.error);
      // Only `prepared` (create next) and `created` (publish next) move; anything else is answered as it stands.
      if (got.intent.state !== "prepared" && got.intent.state !== "created") return answer(got);
      if (got.intent.digest !== digest) return fail("conflict");
      if (!same(got.intent.generation, await generationV2(seal, "threads", account, stamp)))
        return fail("stale");

      /** A provider write happened (or may have) but its receipt did not land: say so, durably if possible. */
      const lost = async (
        state: "unknown_creation" | "unknown_publication",
        intent: ThreadsIntent,
      ) => {
        try {
          return answer(
            await call(account, {
              op: "settle",
              operationId,
              outcome: { state, reason: "receipt" },
              now: at,
            }),
          );
        } catch {
          return reply.json({ intent: { ...intent, state, unknownReason: "receipt" } }, 200);
        }
      };
      const settle = async (
        outcome: ThreadsOutcome,
        unknown: "unknown_creation" | "unknown_publication",
        intent: ThreadsIntent,
      ) => {
        try {
          return answer(await call(account, { op: "settle", operationId, outcome, now: at }));
        } catch {
          return lost(unknown, intent);
        }
      };

      if (got.intent.state === "prepared") {
        const claim = await call(account, { op: "claimCreate", operationId, digest, now: at });
        if ("error" in claim || !claim.claimed) return answer(claim);
        // The create claim is committed: this operation never creates again, whatever happens.
        const created = await postOnce(
          fetchImpl,
          "me/threads",
          { media_type: "TEXT", text: claim.intent.text, reply_to_id: claim.intent.replyToId },
          token,
          seal,
        );
        if (!("id" in created))
          return settle(
            "refused" in created
              ? { state: "rejected", code: created.refused, detail: created.detail }
              : { state: "unknown_creation", reason: created.unknown },
            "unknown_creation",
            claim.intent,
          );
        let recorded: ThreadsAnswer;
        try {
          recorded = await call(account, {
            op: "recordContainer",
            operationId,
            containerId: created.id,
            now: at,
          });
        } catch {
          return lost("unknown_creation", claim.intent);
        }
        if ("error" in recorded || !recorded.recorded) return answer(recorded);
      }

      // The container is durable; the publish claim is the only way to the one publish POST.
      const pub = await call(account, { op: "claimPublish", operationId, digest, now: at });
      if ("error" in pub || !pub.claimed || !pub.intent.containerId) return answer(pub);
      const published = await postOnce(
        fetchImpl,
        "me/threads_publish",
        { creation_id: pub.intent.containerId },
        token,
        seal,
      );
      return settle(
        "id" in published
          ? { state: "published", publishedId: published.id }
          : "refused" in published
            ? { state: "rejected", code: published.refused, detail: published.detail }
            : { state: "unknown_publication", reason: published.unknown },
        "unknown_publication",
        pub.intent,
      );
    } catch (e) {
      if (e instanceof ReceiptDown) return fail("receipt_unavailable");
      throw e;
    }
  };
}
