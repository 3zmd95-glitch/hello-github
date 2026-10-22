/**
 * 📤 Instagram public comment replies, the provider side (packet DT-6B-2C-1, planning/tools/37-inbox-send.md): the ONE
 * bounded dispatch both the reviewed manual confirm (inboxSendInstagram.ts) and the automatic acknowledgement
 * (replies.ts) use, the bounded ownership preflight, and the coordinator client.
 *
 * Dispatch: `POST ${IG_API}/{comment-id}/replies` form `{ message, access_token }`. That form is the one the automation
 * already used (fixture boundary: not freshly verified against Meta's current permission/API-version rules). One
 * attempt, POST_TIMEOUT_MS abort, answer read through PAGE_BYTES_MAX, no retry, no template substitution: the caller
 * passes the exact final text. 2xx with a plain string `id` and no `error` → sent; a 4xx with Meta's TYPED error body
 * (an object whose `code` is an integer) → rejected (nothing was posted); a timeout, a broken connection, a 5xx, a
 * redirect (never followed: the credential-bearing POST goes to one destination only), a malformed, contradictory or
 * oversize answer → unknown (it may have been posted). DT-6B-2C-1-R1: the rejected `reply` carries only the scrubbed
 * words, so a caller mapping it never stores Meta's raw text, the token or the seal.
 *
 * Coordinator answers are proof only when they are bound to the request: the exact account, comment, actor, state,
 * an integer receipt version and, once settled, the exact outcome (`effectFor`, `recordsOutcome`). Anything else is
 * unreadable (ReceiptDown): no claim → no POST; no receipt → the delivery stays unknown. DT-6B-2C-1-R2: an answer that
 * carries an `error` property is never proof, whatever else it carries (`isErrorFree`).
 *
 * Preflight (`verifyTarget`): at most three fixed-host GETs with the one captured token, first pages only, never a
 * provider `paging.next` or cursor: `/me?fields=user_id,username` (the identity is `user_id`, as Inbox uses it; never
 * compared to or assumed equal to the OAuth `tokens.userId`), `/{user_id}/media?fields=id&limit=IG_VERIFY_PAGE`, then
 * `/{media}/comments?fields=id&limit=IG_VERIFY_PAGE`. Exact membership at each step; an absent item is
 * `target_unverified` with detail `outside-local-window` (outside this local verification window, never proof of
 * deletion). A malformed page is `upstream`, never absence.
 */

import { Budget, formPost, type Http, type JsonReply } from "./http";
import { PAGE_BYTES_MAX, scrub } from "./inboxRead";
import { boundedJson, failureOf, isRow, PATH_ID_RE, plainId } from "./inboxReadCommon";
import { POST_TIMEOUT_MS } from "./inboxSendYouTube";
import { IG_API } from "./instagram";
import type {
  EffectState,
  IgOutcome,
  IgPublicAnswer,
  IgPublicCall,
} from "./instagramPublicSendCoordinator";
import type { MetaError, MetaPage } from "./meta";
import { graph } from "./replyCore";

/** Rows asked for on each verification page. Local policy, not a provider limit. */
export const IG_VERIFY_PAGE = 50;
/** The longest manual reply text in Unicode code points, after trimming. Local policy, not a provider limit. */
export const IG_SEND_TEXT_MAX = 1000;

const DETAIL_MAX = 200;

/* ---------- the coordinator client ---------- */

/** The coordinator could not be reached, or answered something unreadable. */
export class ReceiptDown extends Error {}

/** One call to the account's InstagramPublicSendCoordinator; throws ReceiptDown on any transport failure. */
export async function coordinateIg(
  ns: DurableObjectNamespace,
  account: string,
  call: IgPublicCall,
): Promise<IgPublicAnswer> {
  try {
    const stub = ns.get(ns.idFromName(`instagram|${account}`));
    const res = await stub.fetch("https://instagram-public-send-coordinator/", {
      method: "POST",
      body: JSON.stringify(call),
    });
    if (!res.ok) throw new ReceiptDown();
    const v = (await res.json()) as IgPublicAnswer;
    if (!isObj(v)) throw new ReceiptDown();
    return v;
  } catch {
    throw new ReceiptDown();
  }
}

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
/** A coordinator receipt version: a positive integer. */
export const isVersion = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 1;

/** No `error` property at all: an answer naming an error is never success proof, even beside matching fields. */
export const isErrorFree = (a: unknown): a is Obj => isObj(a) && !("error" in a);

/** The effect row of exactly this account, comment and actor, in `state`, with an integer receipt version. */
export function effectFor(
  e: unknown,
  account: string,
  commentId: string,
  actor: string,
  state: EffectState,
): boolean {
  return (
    isObj(e) &&
    e.account === account &&
    e.commentId === commentId &&
    e.actor === actor &&
    e.state === state &&
    isVersion(e.receiptVersion)
  );
}

/**
 * A settle answer proves `outcome` only when its effect durably records exactly that outcome for this target and actor:
 * freshly (`settled: true`) or as a repeat over the same already-settled row (`settled: false`).
 */
export function recordsOutcome(
  a: unknown,
  account: string,
  commentId: string,
  actor: string,
  o: IgOutcome,
): boolean {
  if (!isErrorFree(a) || typeof a.settled !== "boolean") return false;
  const e = a.effect;
  if (!effectFor(e, account, commentId, actor, o.state)) return false;
  const row = e as Obj;
  return o.state === "sent"
    ? row.providerReplyId === o.providerReplyId
    : o.state === "rejected"
      ? row.failureCode === o.code
      : row.unknownReason === o.reason;
}

/** What the automatic acknowledgement needs: claim a comment's public effect, then settle it once. */
export interface PublicEffects {
  claimAuto(
    account: string,
    commentId: string,
    automationId: string,
    now: number,
  ): Promise<{ claimed: boolean }>;
  settle(
    account: string,
    commentId: string,
    actor: string,
    outcome: IgOutcome,
    now: number,
  ): Promise<void>;
}

/** The binding as PublicEffects; null without one (the caller fails the public effect closed). Methods throw. */
export function publicEffects(ns: DurableObjectNamespace | undefined): PublicEffects | null {
  if (!ns) return null;
  return {
    async claimAuto(account, commentId, automationId, now) {
      const a = await coordinateIg(ns, account, {
        op: "claimAuto",
        account,
        commentId,
        automationId,
        now,
      });
      if (!isErrorFree(a)) throw new ReceiptDown();
      const x = a as Obj;
      // Won only with the claimed row of exactly this target and actor; lost only with no row or this comment's row.
      if (
        x.claimed === true &&
        effectFor(x.effect, account, commentId, `auto:${automationId}`, "claimed")
      )
        return { claimed: true };
      const held = x.effect;
      if (
        x.claimed === false &&
        (held === undefined ||
          (isObj(held) && held.account === account && held.commentId === commentId))
      )
        return { claimed: false };
      throw new ReceiptDown();
    },
    async settle(account, commentId, actor, outcome, now) {
      const a = await coordinateIg(ns, account, {
        op: "settle",
        account,
        commentId,
        actor,
        outcome,
        now,
      });
      if (!recordsOutcome(a, account, commentId, actor, outcome)) throw new ReceiptDown();
    },
  };
}

/* ---------- the dispatch ---------- */

export type PublicDispatch =
  | { state: "sent"; providerReplyId: string }
  /** `reply` is Meta's answer, for callers that map refusals further (replies.ts runs `graph` on it). */
  | { state: "rejected"; code: string; detail?: string; reply: JsonReply<MetaError> }
  | {
      state: "unknown";
      reason: "timeout" | "network" | "malformed" | "oversize" | "server" | "redirect";
    };

/** Reads a body through a byte counter; null (and the stream cancelled) as soon as it passes `max` bytes. */
export async function readCapped(
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

/**
 * The one public reply POST, classified; spends one call of `http.budget` (throws before any fetch when none is
 * left). Never retried. `secret` (the seal key, when there is one) is cut out of Meta's words with the token.
 */
export async function dispatchPublicReply(
  http: Http,
  token: string,
  commentId: string,
  message: string,
  secret?: string,
): Promise<PublicDispatch> {
  http.budget.take();
  // Not `http.fetch(url)`: Workers reject the runtime fetch called with `this = http` (see http.ts).
  const doFetch = http.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS);
  let res: Response;
  let raw: string | null;
  try {
    res = await doFetch(`${IG_API}/${encodeURIComponent(commentId)}/replies`, {
      ...formPost({ message, access_token: token }),
      // Never followed: a redirect would carry the token and the text to another destination as a second POST.
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
  type Answer = MetaError & { id?: unknown };
  let obj: Answer | null = null;
  try {
    const v = JSON.parse(raw) as unknown;
    obj = v && typeof v === "object" && !Array.isArray(v) ? (v as Answer) : null;
  } catch {
    obj = null;
  }
  if (res.ok)
    // A success that also carries an error, or no plain string id, is ambiguous: it may or may not have happened.
    return obj && !("error" in obj) && typeof obj.id === "string" && PATH_ID_RE.test(obj.id)
      ? { state: "sent", providerReplyId: obj.id }
      : { state: "unknown", reason: "malformed" };
  // A refusal Meta explains in its TYPED error body is known; an untyped one, or anything else, may have gone through.
  if (res.status >= 400 && res.status < 500 && obj && "error" in obj) {
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
    const detail = scrub(secret ? said?.split(secret).join("[secret]") : said, token)?.slice(
      0,
      DETAIL_MAX,
    );
    return {
      state: "rejected",
      code: `meta_${code}`,
      ...(detail ? { detail } : {}),
      // Only the typed fields and the scrubbed words: what a caller maps (and may store) is already safe.
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

/* ---------- the ownership preflight ---------- */

export type VerifyError =
  | "token_expired"
  | "rate_limited"
  | "no_permission"
  | "upstream"
  | "target_unverified"
  | "account_mismatch";
export type Verified =
  { ok: true; userId: string } | { ok: false; error: VerifyError; detail?: string };

interface IgMe extends MetaError {
  user_id?: unknown;
  username?: unknown;
}

/** The captured token's `/me` identity, then exact membership of the media and the comment in their first pages. */
export async function verifyTarget(
  doFetch: typeof fetch,
  token: string,
  /** `account`, when given, must be `/me`'s user_id: checked before any list of that account is read. */
  target: { account?: string; mediaId: string; commentId: string },
  secret?: string,
): Promise<Verified> {
  const http: Http = { fetch: doFetch, budget: new Budget(3) };
  const get = <T>(path: string, params: Record<string, string>) => {
    const url = new URL(`${IG_API}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    return boundedJson<T>(http, url.toString());
  };
  const unverified: Verified = {
    ok: false,
    error: "target_unverified",
    detail: "outside-local-window",
  };
  const malformed: Verified = { ok: false, error: "upstream", detail: "malformed page" };
  /** Exact membership in one first page; null when the page itself is malformed. */
  const listed = (page: MetaPage<unknown>, id: string): boolean | null => {
    const rows: unknown = page?.data;
    if (!Array.isArray(rows) || !rows.every((r) => isRow(r, PATH_ID_RE))) return null;
    return rows.some((r) => plainId((r as { id?: unknown }).id, PATH_ID_RE) === id);
  };
  try {
    const me = graph(await get<IgMe>("me", { fields: "user_id,username" }), "me");
    const userId = plainId(me?.user_id, PATH_ID_RE);
    if (!userId) return { ok: false, error: "upstream", detail: "me: no user_id" };
    if (target.account !== undefined && userId !== target.account)
      return { ok: false, error: "account_mismatch", detail: "identity" };
    const page = String(IG_VERIFY_PAGE);
    const media = graph(
      await get<MetaPage<unknown>>(`${userId}/media`, { fields: "id", limit: page }),
      "media",
    );
    const ownsMedia = listed(media, target.mediaId);
    if (ownsMedia === null) return malformed;
    if (!ownsMedia) return unverified;
    const comments = graph(
      await get<MetaPage<unknown>>(`${target.mediaId}/comments`, { fields: "id", limit: page }),
      "comments",
    );
    const hasComment = listed(comments, target.commentId);
    if (hasComment === null) return malformed;
    return hasComment ? { ok: true, userId } : unverified;
  } catch (e) {
    const { code, detail } = failureOf(e, token, secret);
    const error: VerifyError =
      code === "token_expired" || code === "rate_limited" || code === "no_permission"
        ? code
        : code === "not_eligible"
          ? "no_permission"
          : "upstream";
    return { ok: false, error, ...(detail ? { detail } : {}) };
  }
}
