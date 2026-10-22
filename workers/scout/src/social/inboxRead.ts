/**
 * 📥 Inbox reads (packet DT-6A, planning/tools/36-inbox.md): read-only Instagram conversations, messages, owned media
 * and comments for the dashboard's `/social/inbox`. Pure readers beside the reply automation (inbox.ts / replies.ts):
 * they never call `readInbox` or `pollReplies`, never write KV (no token refresh, no `replies:state`, no cursors or
 * logs), never send, never mark anything seen, and make exactly one Instagram call per request.
 *
 *   GET /social/inbox/account                                  → { accountId, handle, generation, capabilities }
 *   GET /social/inbox/conversations?account&generation&cursor? → { …page, items: Conversation[] }
 *   GET /social/inbox/conversations/:id/messages?…             → { …page, items: Message[] }
 *   GET /social/inbox/media?…                                  → { …page, items: Media[] }
 *   GET /social/inbox/media/:id/comments?…                     → { …page, items: Comment[] }
 *
 * `accountId` is `/me`'s `user_id` (the id messages and comments carry in `from.id`), never the username or the
 * OAuth user id. `generation` is an HMAC (keyed by SCOUT_TOKEN) of that id and the connection time, so the list routes
 * can trust the `account` + `generation` pair the dashboard sends back without another `/me` call, and a reconnect
 * makes every older pair and cursor stale. Cursors are opaque: `<base64url JSON>.<base64url HMAC>` bound to the
 * account, generation, edge and (for messages/comments) the conversation or media id; the Worker rebuilds every
 * request on the fixed IG_API host and never accepts or returns Instagram's `paging.next` URLs (they carry the token).
 *
 * DT-6A-R1 bounds: each upstream page is read through a byte counter and refused past PAGE_BYTES_MAX before any JSON
 * parse (Content-Length is not trusted); a 200 without a valid list is a failure, never an empty end; an emitted cursor
 * is never longer than the one the reader accepts; links longer than LINK_MAX are dropped.
 */

import { fromBase64Url, toBase64Url } from "./crypto";
import { Budget, clip, int, type Http, type JsonReply } from "./http";
import { toMs } from "./inbox";
import { IG_API } from "./instagram";
import type { MetaError, MetaPage } from "./meta";
import { isExpired } from "./oauth";
import { graph, toReplyCode } from "./replyCore";
import type { Store } from "./store";
import { SocialError, type TokenSet } from "./types";

/** Conversations and messages per page (the automation's 20 is a page size here, not a history claim). */
export const DM_PAGE = 20;
/** Media and comments per page. */
export const MEDIA_PAGE = 25;
/** Message and comment text kept (characters); longer text is cut with "…". */
export const TEXT_MAX = 2000;
const CAPTION_MAX = 200;
const NAME_MAX = 64;
const PARTICIPANTS_MAX = 10;
const DETAIL_MAX = 200;
/** The longest cursor the reader opens, and so the longest it emits (a longer one becomes a local cap). */
const CURSOR_MAX = 1500;
/** Bytes one upstream Instagram page may have (256 KiB); a larger page is refused before it is parsed. */
export const PAGE_BYTES_MAX = 256 * 1024;
/** The longest link (a media permalink) passed on; a longer one is omitted. */
const LINK_MAX = 2048;

/** Plain Graph ids (digits, or Instagram's base64-like conversation ids): never a path or a query. */
const ID_RE = /^[A-Za-z0-9_=-]{1,256}$/;
/** What may go inside `messages.after(…)` and `after=`: Instagram's cursors are base64-like. */
const AFTER_RE = /^[A-Za-z0-9_=%-]{1,1000}$/;
const GEN_RE = /^[0-9a-f]{32}$/;

export type Capability =
  | "ok"
  | "no_permission"
  | "token_expired"
  | "rate_limited"
  | "not_eligible"
  | "not_connected"
  | "upstream";

/** A failure as the dashboard gets it (README "Inbox reads"). */
export type InboxError =
  | Exclude<Capability, "ok">
  | "not_configured"
  | "bad_request"
  | "cursor_invalid"
  | "stale"
  | "method_not_allowed";

/**
 * more: a sealed `next` follows. end: Instagram said there is no more. cap: this page hit a local limit (more may
 * exist). partial: a later page failed (earlier pages stay valid). history_unavailable: Instagram did not expand the
 * messages. unavailable: the first page failed.
 */
export type Coverage = "more" | "end" | "cap" | "partial" | "history_unavailable" | "unavailable";

const STATUS: Record<InboxError, number> = {
  not_configured: 503,
  not_connected: 409,
  token_expired: 409,
  stale: 409,
  no_permission: 403,
  not_eligible: 403,
  rate_limited: 429,
  upstream: 502,
  bad_request: 400,
  cursor_invalid: 400,
  method_not_allowed: 405,
};

type Edge = "conversations" | "messages" | "media" | "comments";

export interface CursorPayload {
  a: string;
  g: string;
  e: Edge;
  id?: string;
  after: string;
}

/* ---------- sealing ---------- */

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey(
      "raw",
      enc.encode(`3z-scout/inbox-read|${secret}`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    keyCache.set(secret, k);
  }
  return k;
}

async function hmac(secret: string, text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(text)));
}

/** The connection generation: never the token, changes on reconnect, same across handle renames. */
export async function generationOf(
  secret: string,
  accountId: string,
  stamp: string,
): Promise<string> {
  const mac = await hmac(secret, `gen|${accountId}|${stamp}`);
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sealCursor(secret: string, p: CursorPayload): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify(p)));
  return `${body}.${toBase64Url(await hmac(secret, `cursor|${body}`))}`;
}

/** The payload when the signature is ours and the fields are well formed; null otherwise. */
export async function openCursor(secret: string, cursor: string): Promise<CursorPayload | null> {
  if (cursor.length > CURSOR_MAX) return null;
  const [body, sig, extra] = cursor.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64Url(sig),
      enc.encode(`cursor|${body}`),
    );
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Partial<CursorPayload>;
    if (typeof p.a !== "string" || typeof p.g !== "string" || typeof p.after !== "string")
      return null;
    if (!AFTER_RE.test(p.after)) return null;
    if (!["conversations", "messages", "media", "comments"].includes(p.e as string)) return null;
    if (p.id !== undefined && (typeof p.id !== "string" || !ID_RE.test(p.id))) return null;
    return p as CursorPayload;
  } catch {
    return null;
  }
}

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- capabilities and errors ---------- */

const MESSAGES_SCOPE = "instagram_business_manage_messages";
const COMMENTS_SCOPE = "instagram_business_manage_comments";

/**
 * What the stored token allows, by surface: the granted scope list when Instagram sent one, else the combined
 * `canReply` flag. No probe call: the list reads report their own refusals.
 */
export function capabilities(tokens: TokenSet): { messages: Capability; comments: Capability } {
  const granted = tokens.scope ? tokens.scope.split(/[,\s]+/).filter(Boolean) : null;
  const has = (scope: string): Capability =>
    (granted ? granted.includes(scope) : !!tokens.canReply) ? "ok" : "no_permission";
  return { messages: has(MESSAGES_SCOPE), comments: has(COMMENTS_SCOPE) };
}

/** Instagram's words without the token or any link, at most DETAIL_MAX characters. */
export function scrub(text: string | undefined, token: string): string | undefined {
  if (!text) return undefined;
  const out = (token ? text.split(token).join("[token]") : text)
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[token]")
    .slice(0, DETAIL_MAX);
  return out || undefined;
}

/**
 * A read failure as an inbox code. `graph` (replyCore) already tells permission (code 10), throttling and expiry
 * apart; of the other 4xx refusals, Meta's 200–299 are missing permissions and 3 ("the app has no capability for
 * this call") is the app-role / review restriction.
 */
function failureOf(
  e: unknown,
  token: string,
): { code: Exclude<Capability, "ok">; detail?: string } {
  const { code, detail } = toReplyCode(e);
  let out: Exclude<Capability, "ok">;
  if (code === "rejected") {
    const meta = Number(/\[(\d+)(?:\/\d+)?\]$/.exec(detail ?? "")?.[1]);
    out = meta === 3 ? "not_eligible" : meta >= 200 && meta <= 299 ? "no_permission" : "upstream";
  } else out = code;
  const words = scrub(detail, token);
  return { code: out, ...(words ? { detail: words } : {}) };
}

/* ---------- rows ---------- */

const iso = (v: unknown): string | null => {
  const ms = toMs(typeof v === "string" || typeof v === "number" ? v : undefined);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** Message and comment text, every line kept (unlike `clip`, which keeps one line), cut at TEXT_MAX. */
const textOf = (v: unknown): string =>
  typeof v !== "string" ? "" : v.length > TEXT_MAX ? `${v.slice(0, TEXT_MAX - 1)}…` : v;

const plainId = (v: unknown): string | undefined =>
  typeof v === "string" && ID_RE.test(v) ? v : typeof v === "number" ? String(v) : undefined;

const nameOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, NAME_MAX) : undefined;

function person(id: unknown, username: unknown): { id?: string; username?: string } | null {
  const i = plainId(id);
  const u = nameOf(username);
  if (!i && !u) return null;
  return { ...(i ? { id: i } : {}), ...(u ? { username: u } : {}) };
}

/** Direction by id only: ours → out, someone else's → in, no `from` id → unknown (never by username). */
const directionOf = (fromId: string | undefined, accountId: string): "in" | "out" | "unknown" =>
  !fromId ? "unknown" : fromId === accountId ? "out" : "in";

/** Only https links on instagram.com; anything else is dropped (no raw links reach the page). */
export function instagramLink(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > LINK_MAX) return undefined;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return undefined;
    if (host !== "instagram.com" && host !== "www.instagram.com") return undefined;
    const out = u.toString();
    return out.length <= LINK_MAX ? out : undefined;
  } catch {
    return undefined;
  }
}

interface IgUser {
  id?: string;
  username?: string;
}
interface IgConversation {
  id?: string;
  updated_time?: string | number;
  participants?: { data?: IgUser[] } | IgUser[];
}
interface IgMessage {
  id?: string;
  created_time?: string | number;
  from?: IgUser;
  message?: string;
  story?: { mention?: unknown; reply_to?: unknown };
  is_unsupported?: boolean;
  /** Not requested (the field contract is unverified); read only if Instagram sends it. */
  shares?: unknown;
  attachments?: unknown;
}
interface IgMedia {
  id?: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number | string;
}
interface IgComment {
  id?: string;
  text?: string;
  username?: string;
  from?: IgUser;
  timestamp?: string;
}
interface IgMe extends MetaError {
  user_id?: string | number;
  username?: string;
}
type IgThread = MetaError & { id?: string; messages?: MetaPage<IgMessage> };

type Kind = "text" | "story_reply" | "story_mention" | "share" | "unsupported" | "empty";

function kindOf(m: IgMessage, text: string): Kind {
  if (m.is_unsupported) return "unsupported";
  if (m.story?.mention) return "story_mention";
  if (m.story?.reply_to) return "story_reply";
  if (text.trim()) return "text";
  if (m.shares || m.attachments) return "share";
  return "empty";
}

/* ---------- bounded transport ---------- */

/**
 * One budgeted GET whose body is read through a byte counter and parsed only when it stays within PAGE_BYTES_MAX
 * (DT-6A-R1, 6A-9). Local to the inbox reader: the automation's shared `fetchJson` (http.ts) is unchanged. Over the
 * budget, or a body that breaks off, throws `upstream`; a body that is not JSON is `body: null`, as in fetchJson.
 */
async function boundedJson<T>(http: Http, url: string): Promise<JsonReply<T>> {
  http.budget.take();
  // Not `http.fetch(url)`: Workers reject the runtime fetch called with `this = http` (see http.ts).
  const doFetch = http.fetch;
  let res: Response;
  try {
    res = await doFetch(url);
  } catch {
    throw new SocialError("upstream", `fetch failed: ${new URL(url).host}`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  try {
    for (;;) {
      if (!reader) break;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PAGE_BYTES_MAX) {
        await reader.cancel().catch(() => undefined);
        throw new SocialError("upstream", "inbox: page over the byte budget");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof SocialError) throw e;
    throw new SocialError("upstream", "inbox: page broke off");
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  let body: T | null = null;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

/**
 * A messages row with an id and nothing else: Instagram listed the id but did not expand it. Every payload the
 * mapper reads (message, story, shares, attachments, is_unsupported) proves expansion (DT-6A-R2, R1-B).
 */
const bareRow = (m: IgMessage): boolean =>
  m.from == null &&
  m.created_time == null &&
  m.message == null &&
  m.story == null &&
  m.shares == null &&
  m.attachments == null &&
  m.is_unsupported == null;

/** A list row the mappers can read: an object with a plain stable id (DT-6A-R2, R1-A). */
const isRow = (x: unknown): boolean =>
  typeof x === "object" &&
  x !== null &&
  !Array.isArray(x) &&
  plainId((x as { id?: unknown }).id) !== undefined;

/* ---------- the handler ---------- */

export interface InboxReply {
  json(body: unknown, status: number): Response;
}

type Route =
  | { edge: "account" }
  | { edge: "conversations" | "media" }
  | { edge: "messages" | "comments"; id: string };

function route(rest: string[]): Route | null | "bad_id" {
  const [a, id, b, extra] = rest;
  if (extra !== undefined) return null;
  if (a === "account" && id === undefined) return { edge: "account" };
  if ((a === "conversations" || a === "media") && id === undefined) return { edge: a };
  const edge =
    a === "conversations" && b === "messages"
      ? "messages"
      : a === "media" && b === "comments"
        ? "comments"
        : null;
  if (!edge || id === undefined) return null;
  return ID_RE.test(id) ? { edge, id } : "bad_id";
}

interface PageOut {
  items: unknown[];
  next: string | null;
  coverage: Coverage;
}

/**
 * `/social/inbox/*`; `rest` is the path after "inbox". Null when the path is not ours. Reads tokens and status only.
 */
export async function handleInboxRead(
  req: Request,
  rest: string[],
  store: Store | null,
  secret: string | undefined,
  now: Date,
  doFetch: typeof fetch | undefined,
  reply: InboxReply,
): Promise<Response | null> {
  const r = route(rest);
  if (!r) return null;
  const fail = (error: InboxError, extra: Record<string, unknown> = {}) =>
    reply.json({ error, ...extra }, STATUS[error]);
  if (req.method !== "GET") return fail("method_not_allowed");
  if (r === "bad_id") return fail("bad_request");
  if (!store || !secret) return fail("not_configured");

  const tokens = await store.getTokens("instagram");
  if (!tokens) return fail("not_connected");
  // Never refreshed here (that is a write): an expired token waits for the owner to reconnect.
  if (isExpired(tokens, now)) return fail("token_expired");
  const status = await store.getStatus("instagram");
  const stamp = status?.connectedAt ?? tokens.issuedAt;
  const token = tokens.accessToken;
  const caps = capabilities(tokens);
  // One Instagram call per request.
  const http: Http = { fetch: doFetch ?? fetch, budget: new Budget(1) };
  const get = <T>(path: string, params: Record<string, string>) => {
    const url = new URL(`${IG_API}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    return boundedJson<T>(http, url.toString());
  };

  if (r.edge === "account") {
    try {
      const me = graph(await get<IgMe>("me", { fields: "user_id,username" }), "me");
      const accountId = plainId(me.user_id);
      if (!accountId) return fail("upstream", { detail: "me: no user_id" });
      return reply.json(
        {
          accountId,
          handle: nameOf(me.username) ?? null,
          generation: await generationOf(secret, accountId, stamp),
          capabilities: caps,
        },
        200,
      );
    } catch (e) {
      const { code, detail } = failureOf(e, token);
      return fail(code, detail ? { detail } : {});
    }
  }

  const q = new URL(req.url).searchParams;
  const accountId = q.get("account") ?? "";
  const generation = q.get("generation") ?? "";
  if (!ID_RE.test(accountId) || !GEN_RE.test(generation)) return fail("bad_request");
  if (!same(generation, await generationOf(secret, accountId, stamp))) return fail("stale");

  const surface = r.edge === "conversations" || r.edge === "messages" ? "messages" : "comments";
  if (caps[surface] !== "ok") return fail(caps[surface] as InboxError);

  const id = "id" in r ? r.id : undefined;
  const cursorParam = q.get("cursor");
  let after: string | undefined;
  if (cursorParam !== null) {
    const c = await openCursor(secret, cursorParam);
    if (!c || c.a !== accountId || c.g !== generation || c.e !== r.edge || c.id !== id)
      return fail("cursor_invalid");
    after = c.after;
  }
  const head = { accountId, generation, fetchedAt: now.toISOString() };
  /** A sealed cursor, or null when `a` is unsafe or its cursor would be longer than openCursor accepts (6A-8). */
  const seal = async (a: string | undefined): Promise<string | null> => {
    if (!a || !AFTER_RE.test(a)) return null;
    const c = await sealCursor(secret, {
      a: accountId,
      g: generation,
      e: r.edge,
      ...(id ? { id } : {}),
      after: a,
    });
    return c.length <= CURSOR_MAX ? c : null;
  };
  /**
   * Items capped at `size`; `more` only with Instagram's `next` and a cursor we can re-apply ourselves (else `cap`,
   * the local cap, with no next). A missing or non-array `data` is a failure, never an empty end (6A-6), and so is a
   * list with any row that is not an object with a plain id, checked over the whole list before any row is kept
   * (R1-A): a malformed page never proves an empty account or history.
   */
  const page = async <T>(
    data: T[] | undefined,
    paging: MetaPage<T>["paging"],
    size: number,
    map: (x: T) => unknown | null,
  ): Promise<PageOut> => {
    if (!Array.isArray(data)) throw new SocialError("upstream", `${r.edge}: no data list`);
    if (!data.every(isRow)) throw new SocialError("upstream", `${r.edge}: a row without an id`);
    const list = data;
    const items = list
      .slice(0, size)
      .map(map)
      .filter((x) => x !== null);
    if (list.length > size) return { items, next: null, coverage: "cap" };
    if (!paging?.next) return { items, next: null, coverage: "end" };
    const next = await seal(paging.cursors?.after);
    return next ? { items, next, coverage: "more" } : { items, next: null, coverage: "cap" };
  };

  try {
    let out: PageOut;
    if (r.edge === "conversations") {
      const body = graph(
        await get<MetaPage<IgConversation>>(`${accountId}/conversations`, {
          platform: "instagram",
          limit: String(DM_PAGE),
          fields: "id,updated_time,participants{id,username}",
          ...(after ? { after } : {}),
        }),
        "conversations",
      );
      out = await page(body.data, body.paging, DM_PAGE, (c) => {
        const cid = plainId(c.id);
        if (!cid) return null;
        const raw = Array.isArray(c.participants) ? c.participants : (c.participants?.data ?? []);
        const participants = raw
          .map((p) => person(p.id, p.username))
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .slice(0, PARTICIPANTS_MAX);
        return { id: cid, updatedAt: iso(c.updated_time), participants };
      });
    } else if (r.edge === "messages") {
      const expand = `${after ? `messages.after(${after})` : "messages"}.limit(${DM_PAGE}){id,created_time,from,message,story,is_unsupported}`;
      const body = graph(await get<IgThread>(id!, { fields: expand }), "messages");
      // No messages edge, or a page of bare ids only, means Instagram ignored the expansion: say so, never "empty".
      // A row missing only its author or time is still a message (unknown direction / null time), 6A-7; a messages
      // object without a data list is a failed page (page() below), 6A-6.
      // A row without an id is not a bare row: such a page fails in page() as malformed (R1-A).
      const listed = Array.isArray(body.messages?.data) ? body.messages.data : [];
      if (!body.messages || (listed.length && listed.every((m) => isRow(m) && bareRow(m)))) {
        return fail("upstream", { ...head, coverage: "history_unavailable" });
      }
      out = await page(body.messages.data, body.messages.paging, DM_PAGE, (m) => {
        const mid = plainId(m.id);
        if (!mid) return null;
        const text = textOf(m.message);
        const from = person(m.from?.id, m.from?.username);
        return {
          id: mid,
          createdAt: iso(m.created_time),
          direction: directionOf(from?.id, accountId),
          from,
          text,
          kind: kindOf(m, text),
        };
      });
    } else if (r.edge === "media") {
      const body = graph(
        await get<MetaPage<IgMedia>>(`${accountId}/media`, {
          fields: "id,caption,permalink,timestamp,comments_count",
          limit: String(MEDIA_PAGE),
          ...(after ? { after } : {}),
        }),
        "media",
      );
      out = await page(body.data, body.paging, MEDIA_PAGE, (m) => {
        const mid = plainId(m.id);
        if (!mid) return null;
        const caption = clip(m.caption, CAPTION_MAX);
        const permalink = instagramLink(m.permalink);
        return {
          id: mid,
          ...(caption ? { caption } : {}),
          ...(permalink ? { permalink } : {}),
          timestamp: iso(m.timestamp),
          commentsCount: int(m.comments_count),
        };
      });
    } else {
      const body = graph(
        await get<MetaPage<IgComment>>(`${id}/comments`, {
          fields: "id,text,username,from,timestamp",
          limit: String(MEDIA_PAGE),
          ...(after ? { after } : {}),
        }),
        "comments",
      );
      out = await page(body.data, body.paging, MEDIA_PAGE, (c) => {
        const kid = plainId(c.id);
        if (!kid) return null;
        const author = person(c.from?.id, c.username ?? c.from?.username);
        return {
          id: kid,
          text: textOf(c.text),
          author,
          createdAt: iso(c.timestamp),
          direction: directionOf(plainId(c.from?.id), accountId),
        };
      });
    }
    return reply.json({ ...head, ...out }, 200);
  } catch (e) {
    const { code, detail } = failureOf(e, token);
    return fail(code, {
      ...head,
      coverage: after ? "partial" : "unavailable",
      ...(detail ? { detail } : {}),
    });
  }
}
