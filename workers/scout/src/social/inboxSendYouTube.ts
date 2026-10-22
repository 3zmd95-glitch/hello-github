/**
 * 📤 Reviewed YouTube public text replies (packet DT-6B-2A, planning/tools/37-inbox-send.md). The only provider write
 * of the Inbox: one public reply under one top-level comment of the owner's own video, after the owner reviewed the
 * exact account, destination and text and pressed Send.
 *
 *   POST /social/inbox/youtube/send/prepare            { operationId, sendRef, text, draftRevision } → { intent }
 *   POST /social/inbox/youtube/send/confirm            { operationId, digest, account }              → { intent }
 *   GET  /social/inbox/youtube/send/:operationId?account                                              → { intent }
 *   POST /social/inbox/youtube/send/:operationId/cancel { account }                                   → { intent }
 *
 * Prepare: the stored grant must contain youtube.force-ssl (read or upload scopes never count), the access token must
 * be live (no refresh here), the `sendRef` must be one this Worker sealed for the current account and generation, the
 * text is trimmed and must be 1–SEND_TEXT_MAX characters (shown as is, nothing else changed), and ONE preflight GET of
 * the comment thread must confirm its video, the owned channel, a public thread, `canReply` and the top-level comment.
 * The intent then goes to the SendCoordinator (sendCoordinator.ts). No POST.
 *
 * Confirm: grant, token and generation again, the reviewed digest, then the coordinator's one-time claim BEFORE the
 * one comments.insert POST (15 s timeout, bounded answer). 2xx with a comment id is `sent`; a refusal with Google's
 * error body is `rejected`; a timeout, a broken connection, a 5xx, a malformed success or a receipt that cannot be
 * written is `unknown`. Nothing is retried, a claim never lapses, and an uncertain send is never turned into a new
 * intent: GET …/send/:operationId reads the same operation back.
 *
 * Bodies, tokens and the seal key are never logged or answered.
 */

import { fromBase64Url, toBase64Url } from "./crypto";
import { Budget, bearer } from "./http";
import { PAGE_BYTES_MAX, scrub } from "./inboxRead";
import { boundedJson, generationV2, GEN_RE, QUERY_ID_RE, same, SEAL_MAX } from "./inboxReadCommon";
import { isExpired } from "./oauth";
import type { CoordinatorAnswer, CoordinatorCall, Outcome } from "./sendCoordinator";
import type { Store } from "./store";
import { YT_API } from "./youtube";

/** The longest reply text (characters, after trimming). */
export const SEND_TEXT_MAX = 2000;
/** How long a prepared review stays confirmable. */
export const REVIEW_MS = 10 * 60_000;
/** The comments.insert POST is aborted (and its outcome unknown) after this. */
export const POST_TIMEOUT_MS = 15_000;
/** The one scope that lets a token insert comments (Google comments.insert). */
export const FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl";

const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REVISION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const SEAL_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const DETAIL_MAX = 200;
const RATE_REASONS = new Set(["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);

export type SendError =
  | "not_configured"
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "stale"
  | "bad_request"
  | "text_invalid"
  | "target_invalid"
  | "not_public"
  | "not_replyable"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream"
  | "receipt_unavailable"
  | "method_not_allowed";

const STATUS: Record<SendError, number> = {
  not_configured: 503,
  not_connected: 409,
  no_permission: 403,
  token_expired: 409,
  stale: 409,
  bad_request: 400,
  text_invalid: 400,
  target_invalid: 400,
  not_public: 403,
  not_replyable: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream: 502,
  receipt_unavailable: 503,
  method_not_allowed: 405,
};

/** Whether the stored grant can send (the account route's `capabilities.sendComments`). */
export const canSend = (scope: string | undefined): boolean =>
  !!scope && scope.split(/[,\s]+/).includes(FORCE_SSL);

/* ---------- the sealed send target ---------- */

/** What a send target names: account, generation, provider thread id, video id, top-level (parent) comment id. */
export interface SendTarget {
  a: string;
  g: string;
  t: string;
  v: string;
  c: string;
}

const enc = new TextEncoder();
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const keys = new Map<string, Promise<CryptoKey>>();

/** HMAC-SHA256(INBOX_SEAL_SECRET, "send-target-v1|youtube"): its own domain, so a read ref never opens here. */
function sendKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = (async () => {
      const root = await crypto.subtle.importKey("raw", enc.encode(secret), HMAC, false, ["sign"]);
      const derived = await crypto.subtle.sign("HMAC", root, enc.encode("send-target-v1|youtube"));
      return crypto.subtle.importKey("raw", derived, HMAC, false, ["sign", "verify"]);
    })();
    keys.set(secret, k);
  }
  return k;
}

export async function sealSendTarget(secret: string, t: SendTarget): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify({ a: t.a, g: t.g, t: t.t, v: t.v, c: t.c })));
  const sig = await crypto.subtle.sign("HMAC", await sendKey(secret), enc.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function openSendTarget(secret: string, sealed: unknown): Promise<SendTarget | null> {
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
    const ids = [v.a, v.t, v.v, v.c];
    if (!ids.every((x) => typeof x === "string" && QUERY_ID_RE.test(x))) return null;
    if (typeof v.g !== "string" || !GEN_RE.test(v.g)) return null;
    return { a: v.a, g: v.g, t: v.t, v: v.v, c: v.c } as SendTarget;
  } catch {
    return null;
  }
}

/* ---------- the coordinator ---------- */

class ReceiptDown extends Error {}

async function coordinate(
  ns: DurableObjectNamespace,
  account: string,
  call: CoordinatorCall,
): Promise<CoordinatorAnswer> {
  try {
    const stub = ns.get(ns.idFromName(`youtube|${account}`));
    const res = await stub.fetch("https://send-coordinator/", {
      method: "POST",
      body: JSON.stringify(call),
    });
    if (!res.ok) throw new ReceiptDown();
    return (await res.json()) as CoordinatorAnswer;
  } catch {
    throw new ReceiptDown();
  }
}

/* ---------- provider calls ---------- */

interface GoogleError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}
interface ThreadResource {
  id?: unknown;
  snippet?: {
    channelId?: unknown;
    videoId?: unknown;
    canReply?: unknown;
    isPublic?: unknown;
    topLevelComment?: { id?: unknown };
  };
}

/** The one preflight GET: the thread must still be the sealed one, on the owned channel, public and open for replies. */
async function preflight(
  doFetch: typeof fetch,
  token: string,
  t: SendTarget,
): Promise<SendError | null> {
  const url = `${YT_API}/commentThreads?${new URLSearchParams({ part: "snippet", id: t.t })}`;
  let reply;
  try {
    reply = await boundedJson<GoogleError & { items?: ThreadResource[] }>(
      { fetch: doFetch, budget: new Budget(1) },
      url,
      { headers: bearer(token) },
    );
  } catch {
    return "upstream";
  }
  const b = reply.body;
  const reason = b?.error?.errors?.[0]?.reason;
  if (reply.status === 401) return "token_expired";
  if (reply.status === 429 || (reason && RATE_REASONS.has(reason))) return "rate_limited";
  if (reason === "commentsDisabled") return "not_replyable";
  if (reply.status === 404) return "not_found";
  if (reply.status === 403) return "no_permission";
  if (!reply.ok || !b || typeof b !== "object" || Array.isArray(b) || b.error) return "upstream";
  if (!Array.isArray(b.items)) return "upstream";
  const thread = b.items[0];
  if (!thread) return "not_found";
  const s = thread.snippet ?? {};
  if (
    thread.id !== t.t ||
    s.videoId !== t.v ||
    s.channelId !== t.a ||
    s.topLevelComment?.id !== t.c
  )
    return "target_invalid";
  if (s.isPublic !== true) return "not_public";
  if (s.canReply !== true) return "not_replyable";
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

/** The one comments.insert POST, classified. Never retried. */
async function insertReply(
  doFetch: typeof fetch,
  token: string,
  seal: string,
  parentId: string,
  text: string,
): Promise<Outcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
  let res: Response;
  let raw: string | null;
  try {
    res = await doFetch(`${YT_API}/comments?part=snippet`, {
      method: "POST",
      headers: bearer(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
      signal: ctrl.signal,
    });
    // An answer over PAGE_BYTES_MAX is one we cannot trust.
    raw = await readCapped(res.body, PAGE_BYTES_MAX);
  } catch {
    return { state: "unknown", reason: ctrl.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
  let body:
    (GoogleError & { id?: unknown; kind?: unknown; snippet?: { parentId?: unknown } }) | null =
    null;
  try {
    body = raw === null ? null : JSON.parse(raw);
  } catch {
    body = null;
  }
  const obj = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (res.ok) {
    const id = obj?.id;
    const parent = obj?.snippet?.parentId;
    // DT-6B-2A-R1 (2A-10): a success that also carries an error, or names another kind of resource, is ambiguous.
    return typeof id === "string" &&
      QUERY_ID_RE.test(id) &&
      (parent === undefined || parent === parentId) &&
      !("error" in obj!) &&
      (obj!.kind === undefined || obj!.kind === "youtube#comment")
      ? { state: "sent", providerCommentId: id }
      : { state: "unknown", reason: "malformed" };
  }
  // A refusal Google explains in its error body is known; anything else may have gone through.
  if (res.status >= 400 && res.status < 500 && obj?.error && typeof obj.error === "object") {
    const reason = obj.error.errors?.[0]?.reason;
    const code =
      typeof reason === "string" && QUERY_ID_RE.test(reason) ? reason : `http_${res.status}`;
    // The seal key is cut out as well as the token, as the read handler does (failureOf).
    const message = typeof obj.error.message === "string" ? obj.error.message : undefined;
    const detail = scrub(message?.split(seal).join("[secret]"), token)?.slice(0, DETAIL_MAX);
    return { state: "rejected", code, ...(detail ? { detail } : {}) };
  }
  return { state: "unknown", reason: "server" };
}

/* ---------- routes ---------- */

export interface SendDeps {
  store: Store | null;
  /** INBOX_SEAL_SECRET when usable (routes.ts checks length and that it is not the bearer). */
  seal: string | undefined;
  coordinator: DurableObjectNamespace | undefined;
}

export interface Reply {
  json(body: unknown, status: number): Response;
}

/** The largest request body read, in bytes: a longer one is cancelled mid-stream, before any parse (2A-11). */
export const BODY_BYTES_MAX = 16_384;

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

/** `/social/inbox/youtube/send/*`; `rest` is the path after "send". Null when the path is not ours. */
export async function handleYouTubeSend(
  req: Request,
  rest: string[],
  deps: SendDeps,
  now: Date,
  doFetch: typeof fetch | undefined,
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
  const fail = (error: SendError, more: Record<string, unknown> = {}) =>
    reply.json({ error, ...more }, STATUS[error]);
  if (req.method !== (kind === "status" ? "GET" : "POST")) return fail("method_not_allowed");

  const { store, seal, coordinator } = deps;
  if (!store) return fail("not_configured", { detail: "kv" });
  if (!seal) return fail("not_configured", { detail: "seal" });
  if (!coordinator) return fail("not_configured", { detail: "receipt-store" });
  const fetchImpl = doFetch ?? fetch;
  const at = now.getTime();
  const call = (account: string, c: CoordinatorCall) => coordinate(coordinator, account, c);
  const answer = (x: CoordinatorAnswer) =>
    "error" in x ? fail(x.error) : reply.json({ intent: x.intent }, 200);

  try {
    // Status and cancel read or end an operation without the provider: they work with an expired token too.
    if (kind === "status" || kind === "cancel") {
      const account =
        kind === "status"
          ? new URL(req.url).searchParams.get("account")
          : (await readBody(req))?.account;
      if (!OP_RE.test(a) || typeof account !== "string" || !QUERY_ID_RE.test(account))
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

    const tokens = await store.getTokens("youtube");
    if (!tokens) return fail("not_connected");
    if (!canSend(tokens.scope)) return fail("no_permission");
    // No refresh in the send path: the owner renews the connection himself.
    if (isExpired(tokens, now)) return fail("token_expired");
    const status = await store.getStatus("youtube");
    const stamp = status?.connectedAt ?? tokens.issuedAt;
    const token = tokens.accessToken;
    const input = await readBody(req);
    if (!input) return fail("bad_request");
    const operationId = input.operationId;
    if (typeof operationId !== "string" || !OP_RE.test(operationId)) return fail("bad_request");

    if (kind === "prepare") {
      const draftRevision = input.draftRevision;
      if (typeof draftRevision !== "string" || !REVISION_RE.test(draftRevision))
        return fail("bad_request");
      const target = await openSendTarget(seal, input.sendRef);
      if (!target) return fail("target_invalid");
      if (!same(target.g, await generationV2(seal, "youtube", target.a, stamp)))
        return fail("stale");
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text || text.length > SEND_TEXT_MAX) return fail("text_invalid");
      const refused = await preflight(fetchImpl, token, target);
      if (refused) return fail(refused);
      return answer(
        await call(target.a, {
          op: "prepare",
          input: {
            operationId,
            provider: "youtube",
            account: target.a,
            generation: target.g,
            threadId: target.t,
            videoId: target.v,
            parentCommentId: target.c,
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
    if (typeof account !== "string" || !QUERY_ID_RE.test(account)) return fail("bad_request");
    const got = await call(account, { op: "get", operationId, now: at });
    if ("error" in got) return fail(got.error);
    // Anything past `prepared` (sending, sent, refused, unknown, expired, cancelled) is answered as it stands.
    if (got.intent.state !== "prepared") return answer(got);
    if (got.intent.digest !== digest) return fail("conflict");
    if (!same(got.intent.generation, await generationV2(seal, "youtube", account, stamp)))
      return fail("stale");
    const claim = await call(account, { op: "claim", operationId, digest, now: at });
    if ("error" in claim || !claim.claimed) return answer(claim);

    // The claim is committed: from here the operation is never dispatched again, whatever happens.
    const outcome = await insertReply(
      fetchImpl,
      token,
      seal,
      claim.intent.parentCommentId,
      claim.intent.text,
    );
    try {
      return answer(await call(account, { op: "settle", operationId, outcome, now: at }));
    } catch {
      return reply.json(
        { intent: { ...claim.intent, state: "unknown", unknownReason: "receipt" } },
        200,
      );
    }
  } catch (e) {
    if (e instanceof ReceiptDown) return fail("receipt_unavailable");
    throw e;
  }
}
