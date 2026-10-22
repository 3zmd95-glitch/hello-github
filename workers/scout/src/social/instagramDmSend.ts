/**
 * 💬 Existing-conversation Instagram DMs, the provider side (packet DT-6B-2C-2, planning/tools/37-inbox-send.md): the
 * InstagramDmCoordinator client, the ONE bounded send, and what the automation (inbox.ts::answerInbox, wired by
 * replies.ts) needs per poll tick. Only `recipient.id` sends inside a conversation the person opened; comment-triggered
 * private replies (`comment_id`) and their template fallback stay in replyCore.ts.
 *
 * `claimAndSend`: a claim the coordinator answers with the claimed row of exactly this account, conversation,
 * recipient, inbound message, actor, payload digest and generation (integer receipt version, no `error` property)
 * precedes ONE `POST ${IG_API}/{account}/messages` with the exact body replyCore.sendReply sends to an `{ id }`
 * recipient (`{ recipient: { id }, message: messagePayload(text, buttons) }`, bearer header), `redirect: "manual"`,
 * POST_TIMEOUT_MS abort and a PAGE_BYTES_MAX streaming budget. Sent only with a non-empty string `message_id`, the
 * exact expected `recipient_id` and no `error`; Meta's TYPED error (integer `code`) on a 4xx → rejected; a redirect,
 * timeout, broken connection, 5xx, malformed/contradictory/oversize answer or another recipient → unknown, never
 * repeated (the claim holds it). The receipt counts only when the coordinator records exactly that outcome; a lost
 * receipt after the provider's success is unknown (`receipt`). Anything unreadable before the POST throws DmStoreDown
 * and nothing is sent. Refusal words are scrubbed of the token and the seal key; the coordinator stores only codes.
 *
 * DT-6B-2C-2-R1: `prepare` does the attempt's only asynchronous work (the exact body's SHA-256) so the caller can run
 * its final fence AFTER it; `claimAndSend` given that preparation starts the claim with no await before it. Claim and
 * receipt answers are proof only for the complete attempt: key, recipient, actor, payload digest, generation, the
 * claim's own time, an integer receipt version and exactly the state's fields (a claim settles nothing; a settled row
 * has a valid `settledAt` and only its outcome's proof). A 4xx carrying `message_id`/`recipient_id` beside a typed
 * error is contradictory: unknown, so the default reply's cooldown stays reserved.
 *
 * Calls per DM: 1 provider POST (external) + 2 coordinator calls (internal: claim, settle) = DM_SUBREQUESTS, all
 * taken from the poll's subrequest budget (the caller reserves all three before the claim, so the receipt always
 * has its call). Per tick `dmTick` adds 1 provider GET (`/me`, skipped when the poll fetched it this tick) and 1 KV
 * read (the status stamp); each claim is preceded by the 3-KV-read fence.
 *
 * DT-6B-2C-3 (transport factoring only): `dispatchClaimed` is the same one bounded POST, exported for the reviewed
 * manual route (inboxSendInstagramDm.ts), which claims through the coordinator's own `claimConfirm` and so must
 * never call `claimAndSend` (that would claim twice). It POSTs exactly the bytes it is given: the manual route
 * builds them from the stored, reviewed canonical text, while `claimAndSend` keeps `bodyOf → messagePayload` (which
 * trims) unchanged. `coordinateDm` and `boundEffect` are exported unchanged for the same route.
 */

import { fetchJson, type Http, type JsonReply } from "./http";
import { PAGE_BYTES_MAX, scrub } from "./inboxRead";
import { PATH_ID_RE, plainId } from "./inboxReadCommon";
import { POST_TIMEOUT_MS } from "./inboxSendYouTube";
import { IG_API } from "./instagram";
import type { DmCall, DmKey, DmOutcome } from "./instagramDmCoordinator";
import { isErrorFree, isObj, isVersion, readCapped } from "./instagramPublicSend";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { graph, messagePayload, ReplyError, type LinkButton } from "./replyCore";
import type { Store } from "./store";
import type { TokenSet } from "./types";

/** Subrequests one DM spends: the claim, the POST and the receipt. */
export const DM_SUBREQUESTS = 3;

const DETAIL_MAX = 200;

/** The coordinator could not be reached, or answered something that is not proof. Nothing was sent. */
export class DmStoreDown extends Error {}

type Obj = Record<string, unknown>;

export async function coordinateDm(
  ns: DurableObjectNamespace,
  account: string,
  call: DmCall,
): Promise<Obj> {
  try {
    const stub = ns.get(ns.idFromName(`instagram-dm|${account}`));
    const res = await stub.fetch("https://instagram-dm-coordinator/", {
      method: "POST",
      body: JSON.stringify(call),
    });
    if (!res.ok) throw new DmStoreDown();
    const v = (await res.json()) as unknown;
    if (!isObj(v)) throw new DmStoreDown();
    return v;
  } catch {
    throw new DmStoreDown();
  }
}

export interface DmAttempt extends DmKey {
  recipientId: string;
  /** `auto:<ruleId>` or `auto:default`. */
  actor: string;
  generation: string;
  isDefault: boolean;
  cooldownMs: number;
  token: string;
  text: string;
  buttons: readonly LinkButton[];
  /** The fenced (fresh) time of the claim. */
  now: number;
}

export type DmResult =
  | { state: "blocked_by_takeover" | "already_claimed" | "cooldown" }
  | { state: "sent"; providerMessageId: string; recipientId: string }
  /** `reply` holds only Meta's typed fields and the scrubbed words, for the automation's mapping (`graph`). */
  | { state: "rejected"; code: string; detail?: string; reply: JsonReply<MetaError> }
  | {
      state: "unknown";
      reason:
        | "timeout"
        | "network"
        | "malformed"
        | "oversize"
        | "server"
        | "redirect"
        | "recipient"
        | "receipt";
    };

/** What the POST carries: the person and the exact text and buttons. */
export type DmMessage = Pick<DmAttempt, "recipientId" | "text" | "buttons">;

/** The exact request body and its SHA-256 (the claim's payload digest). */
export interface PreparedDm {
  body: string;
  payloadDigest: string;
}

export interface DmSender {
  /** The attempt's only asynchronous preparation: run it BEFORE the final fence. */
  prepare(m: DmMessage): Promise<PreparedDm>;
  /**
   * Throws (DmStoreDown) only before the POST; once claimed it always answers an outcome. With `prepared` (which must
   * be this attempt's body) no await precedes the claim; without it the digest is computed first.
   */
  claimAndSend(http: Http, a: DmAttempt, prepared?: PreparedDm): Promise<DmResult>;
}

const sameConversation = (c: unknown, a: DmAttempt): c is Obj =>
  isObj(c) &&
  c.account === a.account &&
  c.conversationId === a.conversationId &&
  (c.mode === "auto" || c.mode === "human") &&
  Number.isSafeInteger(c.revision) &&
  (c.revision as number) >= 0;

const sameKey = (e: unknown, k: DmKey): e is Obj =>
  isObj(e) &&
  e.account === k.account &&
  e.conversationId === k.conversationId &&
  e.inboundMessageId === k.inboundMessageId &&
  isVersion(e.receiptVersion);

/** The exact ISO time the coordinator writes for epoch `ms`; undefined when not a time. */
const isoOf = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);

const isIso = (v: unknown): v is string => typeof v === "string" && isoOf(Date.parse(v)) === v;

/**
 * The effect row of exactly this attempt (key, recipient, actor, payload digest, generation, the claim's own time,
 * integer receipt version) in `o`'s state with exactly that state's fields: a claim has nothing settled; a settled
 * row has a valid `settledAt` and only its outcome's proof.
 */
export function boundEffect(
  e: unknown,
  a: Pick<
    DmAttempt,
    | "account"
    | "conversationId"
    | "inboundMessageId"
    | "recipientId"
    | "actor"
    | "generation"
    | "now"
  >,
  digest: string,
  o: DmOutcome | { state: "claimed" },
): boolean {
  if (
    !sameKey(e, a) ||
    e.recipientId !== a.recipientId ||
    e.actor !== a.actor ||
    e.payloadDigest !== digest ||
    e.generation !== a.generation ||
    e.state !== o.state ||
    e.claimedAt !== isoOf(a.now) ||
    !isIso(e.claimedAt)
  )
    return false;
  return (
    (o.state === "claimed" ? e.settledAt === undefined : isIso(e.settledAt)) &&
    e.providerMessageId === (o.state === "sent" ? o.providerMessageId : undefined) &&
    e.failureCode === (o.state === "rejected" ? o.code : undefined) &&
    e.unknownReason === (o.state === "unknown" ? o.reason : undefined)
  );
}

/** The claim answer as a result; DmStoreDown unless every field is bound to this attempt. */
function claimResult(
  v: Obj,
  a: DmAttempt,
  digest: string,
): "claimed" | "blocked_by_takeover" | "already_claimed" | "cooldown" {
  if (!isErrorFree(v) || !sameConversation(v.conversation, a)) throw new DmStoreDown();
  const auto = a.actor.startsWith("auto:");
  const e = v.effect;
  switch (v.result) {
    case "claimed":
      if (
        (v.conversation.mode === "auto" || !auto) &&
        boundEffect(e, a, digest, { state: "claimed" })
      )
        return "claimed";
      break;
    case "already_claimed":
      if ((e === undefined && v.retired === true) || (sameKey(e, a) && typeof e.state === "string"))
        return "already_claimed";
      break;
    case "blocked_by_takeover":
      if (auto && v.conversation.mode === "human") return "blocked_by_takeover";
      break;
    case "cooldown": {
      const c = v.cooldown;
      if (
        a.isDefault &&
        isObj(c) &&
        c.account === a.account &&
        c.recipientId === a.recipientId &&
        typeof c.lastDefaultAt === "string"
      )
        return "cooldown";
      break;
    }
  }
  throw new DmStoreDown();
}

/**
 * A receipt proves `o` only when the effect of exactly this claimed attempt durably records exactly that outcome:
 * freshly (`settled: true`) or as a repeat over the same already-settled row (`settled: false`).
 */
function recordsDm(v: Obj, a: DmAttempt, digest: string, o: DmOutcome): boolean {
  return isErrorFree(v) && typeof v.settled === "boolean" && boundEffect(v.effect, a, digest, o);
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

const bodyOf = (m: DmMessage) =>
  JSON.stringify({ recipient: { id: m.recipientId }, message: messagePayload(m.text, m.buttons) });

async function prepareDm(m: DmMessage): Promise<PreparedDm> {
  const body = bodyOf(m);
  return { body, payloadDigest: await sha256Hex(body) };
}

export type Posted = Exclude<
  DmResult,
  { state: "blocked_by_takeover" | "already_claimed" | "cooldown" }
>;

/** Who the one POST goes to, as whom. */
export type DmTarget = Pick<DmAttempt, "account" | "recipientId" | "token">;

/**
 * The one POST of exactly `body`, classified; spends one call of `http.budget` (throws before any fetch when none is
 * left). Never retried. Call it only after a committed claim of this very attempt.
 */
export async function dispatchClaimed(
  http: Http,
  a: DmTarget,
  body: string,
  secret: string | undefined,
): Promise<Posted> {
  http.budget.take();
  // Not `http.fetch(url)`: Workers reject the runtime fetch called with `this = http` (see http.ts).
  const doFetch = http.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
  let res: Response;
  let raw: string | null;
  try {
    res = await doFetch(`${IG_API}/${encodeURIComponent(a.account)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${a.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      // Never followed: a redirect would carry the token and the message to another destination as a second POST.
      redirect: "manual",
      signal: ctrl.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => undefined);
      return { state: "unknown", reason: "redirect" };
    }
    raw = await readCapped(res.body, PAGE_BYTES_MAX);
  } catch {
    return { state: "unknown", reason: ctrl.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
  if (raw === null) return { state: "unknown", reason: "oversize" };
  let obj: Obj | null = null;
  try {
    const v = JSON.parse(raw) as unknown;
    obj = isObj(v) ? v : null;
  } catch {
    obj = null;
  }
  if (res.ok) {
    // A success that also carries an error, or no plain message id, may or may not have happened.
    if (!obj || "error" in obj || typeof obj.message_id !== "string" || !obj.message_id)
      return { state: "unknown", reason: "malformed" };
    // Delivered to someone else (or Meta did not say to whom): never counted as this answer.
    return obj.recipient_id === a.recipientId
      ? { state: "sent", providerMessageId: obj.message_id, recipientId: a.recipientId }
      : { state: "unknown", reason: "recipient" };
  }
  if (res.status >= 400 && res.status < 500 && obj && "error" in obj) {
    // DT-6B-2C-2-R1: delivery proof beside the error contradicts it: it may have been sent.
    if ("message_id" in obj || "recipient_id" in obj)
      return { state: "unknown", reason: "malformed" };
    const e: unknown = obj.error;
    if (
      !isObj(e) ||
      !Number.isSafeInteger(e.code) ||
      (e.message !== undefined && typeof e.message !== "string") ||
      (e.error_subcode !== undefined && !Number.isSafeInteger(e.error_subcode))
    )
      return { state: "unknown", reason: "malformed" };
    const code = e.code as number;
    const subcode = e.error_subcode as number | undefined;
    const said = e.message as string | undefined;
    const detail = scrub(secret ? said?.split(secret).join("[secret]") : said, a.token)?.slice(
      0,
      DETAIL_MAX,
    );
    return {
      state: "rejected",
      code: `meta_${code}`,
      ...(detail ? { detail } : {}),
      reply: {
        status: res.status,
        ok: false,
        body: {
          error: {
            code,
            ...(subcode === undefined ? {} : { error_subcode: subcode }),
            ...(detail ? { message: detail } : {}),
          },
        },
      },
    };
  }
  return { state: "unknown", reason: "server" };
}

/** The binding as a DmSender; null without one (the caller fails every rule/default DM closed). */
export function instagramDm(
  ns: DurableObjectNamespace | undefined,
  deps: { now: () => number; secret?: string },
): DmSender | null {
  if (!ns) return null;
  return {
    prepare: prepareDm,
    async claimAndSend(http, a, prepared) {
      if (prepared && prepared.body !== bodyOf(a)) throw new DmStoreDown();
      // Given the preparation, nothing is awaited between the caller's final fence and the claim below.
      const { body, payloadDigest } = prepared ?? (await prepareDm(a));
      http.budget.take();
      const claimed = claimResult(
        await coordinateDm(ns, a.account, {
          op: "claim",
          account: a.account,
          conversationId: a.conversationId,
          recipientId: a.recipientId,
          inboundMessageId: a.inboundMessageId,
          actor: a.actor,
          payloadDigest,
          generation: a.generation,
          isDefault: a.isDefault,
          cooldownMs: a.cooldownMs,
          now: a.now,
        }),
        a,
        payloadDigest,
      );
      if (claimed !== "claimed") return { state: claimed };
      // The claim is committed: this inbound message is never answered again, whatever happens below.
      const sent = await dispatchClaimed(http, a, body, deps.secret);
      const outcome: DmOutcome =
        sent.state === "sent"
          ? { state: "sent", providerMessageId: sent.providerMessageId }
          : sent.state === "rejected"
            ? { state: "rejected", code: sent.code }
            : { state: "unknown", reason: sent.reason };
      let receipt = false;
      try {
        http.budget.take();
        receipt = recordsDm(
          await coordinateDm(ns, a.account, {
            op: "settle",
            account: a.account,
            conversationId: a.conversationId,
            inboundMessageId: a.inboundMessageId,
            actor: a.actor,
            outcome,
            now: deps.now(),
          }),
          a,
          payloadDigest,
          outcome,
        );
      } catch {
        // Below: a lost receipt. The claim holds whatever happened.
      }
      return sent.state === "sent" && !receipt ? { state: "unknown", reason: "receipt" } : sent;
    },
  };
}

/* ---------- one poll tick ---------- */

export type FenceResult =
  | { ok: true; now: number }
  | { ok: false; code: "not_connected" | "token_expired" | "upstream"; detail: string };

/** What answerInbox needs for the tick's DMs. */
export interface DmTick {
  /** `/me`'s user_id, fetched this tick: the coordinator object, the conversations read and the POST path. */
  account: string;
  /** Changes with a reconnect (`connectedAt`), never with the token: stored per effect for audit only. */
  generation: string;
  /** Token and status read together, then the token again, all equal to the capture; the fresh time, or why not. */
  fence(): Promise<FenceResult>;
  /** null without the binding: every rule/default DM fails closed. */
  sender: DmSender | null;
}

/**
 * The tick's DM authority, built after the poll's token refresh: the account from a fresh `/me` (or the `user_id` the
 * poll fetched this very tick), never the cached poll account or the OAuth `tokens.userId`; the status stamp captured
 * once. Throws (ReplyError / SocialError) when `/me` cannot be read or carries no plain user_id.
 */
export async function dmTick(o: {
  http: Http;
  store: Store;
  /** The poll's tokens after its refresh: the capture every fence compares against. */
  tokens: TokenSet;
  ns: DurableObjectNamespace | undefined;
  clock: () => Date;
  /** `/me`'s user_id when the poll fetched it this tick. */
  fetchedUserId?: string;
  secret?: string;
}): Promise<DmTick> {
  let account = o.fetchedUserId === undefined ? undefined : plainId(o.fetchedUserId, PATH_ID_RE);
  if (account === undefined) {
    const url = new URL(`${IG_API}/me`);
    url.searchParams.set("fields", "user_id");
    url.searchParams.set("access_token", o.tokens.accessToken);
    const me = graph(
      await fetchJson<MetaError & { user_id?: unknown }>(o.http, url.toString()),
      "me",
    );
    account = plainId(me.user_id, PATH_ID_RE);
  }
  if (!account) throw new ReplyError("upstream", "me: no user_id");
  const token = o.tokens.accessToken;
  const stamp = (await o.store.getStatus("instagram"))?.connectedAt ?? o.tokens.issuedAt;
  const generation = (await sha256Hex(`ig-dm-gen|${account}|${stamp}`)).slice(0, 32);
  return {
    account,
    generation,
    async fence() {
      const [t1, s] = await Promise.all([
        o.store.getTokens("instagram"),
        o.store.getStatus("instagram"),
      ]);
      const t2 = await o.store.getTokens("instagram");
      if (!t1 || !t2) return { ok: false, code: "not_connected", detail: "dm: not connected" };
      if (
        t1.accessToken !== token ||
        JSON.stringify(t1) !== JSON.stringify(t2) ||
        (s?.connectedAt ?? t1.issuedAt) !== stamp
      )
        return { ok: false, code: "upstream", detail: "reconnected" };
      const now = o.clock();
      if (isExpired(t2, now))
        return { ok: false, code: "token_expired", detail: "dm: token expired" };
      return { ok: true, now: now.getTime() };
    },
    sender: instagramDm(o.ns, { now: () => o.clock().getTime(), secret: o.secret }),
  };
}
