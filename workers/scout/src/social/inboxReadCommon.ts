/**
 * 📥 Shared pieces of the Threads and YouTube inbox readers (packet DT-6B-1, planning/tools/36-inbox.md). New code
 * beside the accepted Instagram reader (inboxRead.ts, unchanged): its sealing, cursor and transport helpers are
 * private there, so the small ones are repeated here rather than extracted (the Instagram contract stays byte-for-byte
 * as accepted).
 *
 * Everything sealed here is provider-qualified and lives in its own HMAC domains, so an Instagram cursor never opens
 * here and a v2 seal never opens in inboxRead.ts. The key is server-only (DT-6B-1-R1 B1-1): HMAC-SHA256 of the Worker
 * secret INBOX_SEAL_SECRET over "inbox-seal-v1|<provider>", never the bearer the browser holds, so a dashboard client
 * cannot mint a receipt for an item its own lists never returned:
 *   generation  HMAC("gen2|<provider>|<accountId>|<connectedAt>"), 32 hex
 *   cursor      <base64url JSON {p,a,g,e,r?,after}>.<HMAC("cursor2|" + body)>
 *   ref         <base64url JSON {p,a,g,k,id}>.<HMAC("ref2|" + body)>: the ownership receipt of one item the owner's
 *               own-content list returned (a post, an uploads playlist, a video, a top-level comment). The routes
 *               that read below an item accept only its ref, never a bare id, so a foreign id is refused before any
 *               upstream call.
 */

import { fromBase64Url, toBase64Url } from "./crypto";
import type { Http, JsonReply } from "./http";
import { toMs } from "./inbox";
import { PAGE_BYTES_MAX, TEXT_MAX, scrub, type Coverage, type InboxError } from "./inboxRead";
import { toReplyCode } from "./replyCore";
import { SocialError } from "./types";

export type Provider = "threads" | "youtube";
const PROVIDERS: readonly string[] = ["threads", "youtube"];

/** Inbox errors plus the YouTube-only comment states. */
export type ReadError = InboxError | "comments_disabled" | "video_not_found";

export const STATUS: Record<ReadError, number> = {
  not_configured: 503,
  not_connected: 409,
  token_expired: 409,
  stale: 409,
  no_permission: 403,
  not_eligible: 403,
  comments_disabled: 403,
  video_not_found: 404,
  rate_limited: 429,
  upstream: 502,
  bad_request: 400,
  cursor_invalid: 400,
  method_not_allowed: 405,
};

/** Rows per page on both providers. */
export const PAGE = 25;
/** The longest cursor or ref opened, and so the longest emitted (a longer cursor becomes a local cap). */
export const SEAL_MAX = 1500;
/** The longest provider link passed on. */
const LINK_MAX = 2048;
const NAME_MAX = 64;

/** Ids that may go into a path (Threads media ids): never "." so never a path step. */
export const PATH_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;
/** Ids only ever sent as query values (YouTube channel, video, comment and reply ids "parent.reply"). */
export const QUERY_ID_RE = /^[A-Za-z0-9_.-]{1,256}$/;
/** Provider page cursors re-applied by us (Meta `after`, YouTube `pageToken`). */
const AFTER_RE = /^[A-Za-z0-9_=%-]{1,1000}$/;
export const GEN_RE = /^[0-9a-f]{32}$/;
const SEAL_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/* ---------- sealing ---------- */

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

const HMAC = { name: "HMAC", hash: "SHA-256" } as const;

/** The provider's sealing key: HMAC-SHA256(INBOX_SEAL_SECRET, "inbox-seal-v1|<provider>"), one per provider. */
function hmacKey(secret: string, provider: Provider): Promise<CryptoKey> {
  const id = `${provider}|${secret}`;
  let k = keyCache.get(id);
  if (!k) {
    k = (async () => {
      const root = await crypto.subtle.importKey("raw", enc.encode(secret), HMAC, false, ["sign"]);
      const derived = await crypto.subtle.sign(
        "HMAC",
        root,
        enc.encode(`inbox-seal-v1|${provider}`),
      );
      return crypto.subtle.importKey("raw", derived, HMAC, false, ["sign", "verify"]);
    })();
    keyCache.set(id, k);
  }
  return k;
}

async function hmac(secret: string, provider: Provider, text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(secret, provider), enc.encode(text)),
  );
}

/** The connection generation for one provider account: changes on reconnect, never the token. */
export async function generationV2(
  secret: string,
  provider: Provider,
  accountId: string,
  stamp: string,
): Promise<string> {
  const mac = await hmac(secret, provider, `gen2|${provider}|${accountId}|${stamp}`);
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function seal(
  secret: string,
  provider: Provider,
  domain: string,
  value: object,
): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify(value)));
  return `${body}.${toBase64Url(await hmac(secret, provider, `${domain}|${body}`))}`;
}

async function open(
  secret: string,
  provider: Provider,
  domain: string,
  sealed: string,
): Promise<Record<string, unknown> | null> {
  if (sealed.length > SEAL_MAX || !SEAL_RE.test(sealed)) return null;
  const [body, sig] = sealed.split(".");
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, provider),
      fromBase64Url(sig),
      enc.encode(`${domain}|${body}`),
    );
    if (!ok) return null;
    const v = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): v is string => typeof v === "string";

export interface CursorV2 {
  p: Provider;
  a: string;
  g: string;
  /** The edge (posts, replies, videos, threads, comments). */
  e: string;
  /** The resource the page belongs to (a post, playlist, video or top-level comment id). */
  r?: string;
  after: string;
}

export const sealCursorV2 = (secret: string, c: CursorV2) => seal(secret, c.p, "cursor2", c);

export async function openCursorV2(
  secret: string,
  provider: Provider,
  cursor: string,
): Promise<CursorV2 | null> {
  const c = await open(secret, provider, "cursor2", cursor);
  if (!c || !str(c.p) || !PROVIDERS.includes(c.p) || !str(c.a) || !str(c.g) || !str(c.e))
    return null;
  if (!str(c.after) || !AFTER_RE.test(c.after)) return null;
  if (c.r !== undefined && (!str(c.r) || !QUERY_ID_RE.test(c.r))) return null;
  return c as unknown as CursorV2;
}

export type RefKind = "post" | "uploads" | "video" | "comment";

export interface RefV2 {
  p: Provider;
  a: string;
  g: string;
  k: RefKind;
  id: string;
}

export const sealRef = (secret: string, r: RefV2) => seal(secret, r.p, "ref2", r);

export async function openRef(
  secret: string,
  provider: Provider,
  ref: string,
): Promise<RefV2 | null> {
  const r = await open(secret, provider, "ref2", ref);
  if (!r || !str(r.p) || !PROVIDERS.includes(r.p) || !str(r.a) || !str(r.g) || !str(r.k))
    return null;
  if (!["post", "uploads", "video", "comment"].includes(r.k)) return null;
  if (!str(r.id) || !QUERY_ID_RE.test(r.id)) return null;
  return r as unknown as RefV2;
}

/** Constant-time string comparison. */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- rows ---------- */

export const iso = (v: unknown): string | null => {
  const ms = toMs(typeof v === "string" || typeof v === "number" ? v : undefined);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** Comment text, every line kept, cut at TEXT_MAX. */
export const textOf = (v: unknown): string =>
  typeof v !== "string" ? "" : v.length > TEXT_MAX ? `${v.slice(0, TEXT_MAX - 1)}…` : v;

/**
 * A stable id: a string matching `re`, or a JSON safe integer whose decimal string matches it (DT-6B-1-R1 B1-4: a
 * fraction, an unsafe integer or anything else is no id, so its row fails the whole page and no ref is minted that
 * the reader's own path check would refuse).
 */
export const plainId = (v: unknown, re = QUERY_ID_RE): string | undefined => {
  const s = typeof v === "string" ? v : Number.isSafeInteger(v) ? String(v) : undefined;
  return s !== undefined && re.test(s) ? s : undefined;
};

export const nameOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, NAME_MAX) : undefined;

/** A list row the mappers can read: an object with a plain stable id. */
export const isRow = (x: unknown, re = QUERY_ID_RE): boolean =>
  typeof x === "object" &&
  x !== null &&
  !Array.isArray(x) &&
  plainId((x as { id?: unknown }).id, re) !== undefined;

/** An https link on exactly one of `hosts`, without credentials, at most LINK_MAX long; anything else undefined. */
export function exactLink(v: unknown, hosts: readonly string[]): string | undefined {
  if (typeof v !== "string" || v.length > LINK_MAX) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return undefined;
    if (!hosts.includes(u.hostname.toLowerCase())) return undefined;
    const out = u.toString();
    return out.length <= LINK_MAX ? out : undefined;
  } catch {
    return undefined;
  }
}

/* ---------- failures ---------- */

/** A failure a reader already named (YouTube's reasons); anything else goes through `failureOf`. */
export class ReadFailure extends Error {
  constructor(
    readonly code: Exclude<ReadError, "method_not_allowed">,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

/**
 * A read failure as an inbox code, the Meta mapping of inboxRead.ts repeated: `graph` (replyCore) tells permission,
 * throttling and expiry apart; of the other refusals, Meta's 200–299 are missing permissions and 3 the app-role or
 * review restriction.
 */
export function failureOf(
  e: unknown,
  token: string,
  secret?: string,
): { code: Exclude<ReadError, "method_not_allowed">; detail?: string } {
  let code: Exclude<ReadError, "method_not_allowed">;
  let detail: string | undefined;
  if (e instanceof ReadFailure) {
    code = e.code;
    detail = e.message;
  } else {
    const r = toReplyCode(e);
    detail = r.detail;
    if (r.code === "rejected") {
      const meta = Number(/\[(\d+)(?:\/\d+)?\]$/.exec(detail ?? "")?.[1]);
      code =
        meta === 3 ? "not_eligible" : meta >= 200 && meta <= 299 ? "no_permission" : "upstream";
    } else code = r.code;
  }
  // The seal secret is cut out as well as the provider token: neither ever reaches an answer.
  const words = scrub(secret ? detail?.split(secret).join("[secret]") : detail, token);
  return { code, ...(words ? { detail: words } : {}) };
}

/* ---------- bounded transport ---------- */

/**
 * One budgeted GET whose body is read through a byte counter and parsed only within PAGE_BYTES_MAX (the transport of
 * inboxRead.ts, with request headers for YouTube's bearer). Over the budget or broken off throws `upstream`; a body
 * that is not JSON is `body: null`.
 */
export async function boundedJson<T>(
  http: Http,
  url: string,
  init?: RequestInit,
): Promise<JsonReply<T>> {
  http.budget.take();
  // Not `http.fetch(url)`: Workers reject the runtime fetch called with `this = http` (see http.ts).
  const doFetch = http.fetch;
  let res: Response;
  try {
    res = await doFetch(url, { ...init, method: "GET" });
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

/* ---------- the request frame ---------- */

export interface Reply {
  json(body: unknown, status: number): Response;
}

export interface PageOut {
  items: unknown[];
  next: string | null;
  coverage: Coverage;
}

/** What a list route knows once its account, generation, ref and cursor checked out. */
export interface ListFrame {
  accountId: string;
  generation: string;
  /** The opened ref (routes below an owned item), else undefined. */
  ref?: RefV2;
  /** The provider cursor to re-apply, when a sealed cursor was sent. */
  after?: string;
  head: { provider: Provider; accountId: string; generation: string; fetchedAt: string };
  /**
   * Items capped at PAGE; `more` only when the provider said so AND its cursor can be sealed within SEAL_MAX (else
   * `cap`). A missing list, or any row that is not an object with a plain id (checked over the whole list first), is a
   * failure, never an empty end.
   */
  page<T>(
    data: T[] | undefined,
    more: boolean,
    after: string | undefined,
    map: (x: T) => unknown,
    idRe?: RegExp,
  ): Promise<PageOut>;
}

/**
 * The checks every list route makes before its one upstream call, in order: account + generation well formed and
 * current (`stale` otherwise), the ref (when `refKind` is given) sealed by us for this provider, account and kind
 * (`stale` for an older generation, `bad_request` otherwise), and the cursor bound to provider, account, generation,
 * edge and resource (`cursor_invalid`).
 */
export async function listFrame(
  req: Request,
  secret: string,
  provider: Provider,
  stamp: string,
  edge: string,
  now: Date,
  refParam: string | undefined,
  refKind: RefKind | undefined,
): Promise<ListFrame | ReadError> {
  const q = new URL(req.url).searchParams;
  const accountId = q.get("account") ?? "";
  const generation = q.get("generation") ?? "";
  if (!QUERY_ID_RE.test(accountId) || !GEN_RE.test(generation)) return "bad_request";
  if (!same(generation, await generationV2(secret, provider, accountId, stamp))) return "stale";
  let ref: RefV2 | undefined;
  if (refKind) {
    const r = refParam ? await openRef(secret, provider, refParam) : null;
    if (!r || r.p !== provider || r.a !== accountId || r.k !== refKind) return "bad_request";
    if (r.g !== generation) return "stale";
    ref = r;
  }
  const resource = ref?.id;
  const cursorParam = q.get("cursor");
  let after: string | undefined;
  if (cursorParam !== null) {
    const c = await openCursorV2(secret, provider, cursorParam);
    if (
      !c ||
      c.p !== provider ||
      c.a !== accountId ||
      c.g !== generation ||
      c.e !== edge ||
      c.r !== resource
    )
      return "cursor_invalid";
    after = c.after;
  }
  const sealNext = async (a: string | undefined): Promise<string | null> => {
    if (!a || !AFTER_RE.test(a)) return null;
    const c = await sealCursorV2(secret, {
      p: provider,
      a: accountId,
      g: generation,
      e: edge,
      ...(resource ? { r: resource } : {}),
      after: a,
    });
    return c.length <= SEAL_MAX ? c : null;
  };
  return {
    accountId,
    generation,
    ...(ref ? { ref } : {}),
    ...(after ? { after } : {}),
    head: { provider, accountId, generation, fetchedAt: now.toISOString() },
    async page(data, more, a, map, idRe) {
      if (!Array.isArray(data)) throw new SocialError("upstream", `${edge}: no data list`);
      if (!data.every((x) => isRow(x, idRe)))
        throw new SocialError("upstream", `${edge}: a row without an id`);
      const items = data.slice(0, PAGE).map(map);
      if (data.length > PAGE) return { items, next: null, coverage: "cap" };
      if (!more) return { items, next: null, coverage: "end" };
      const next = await sealNext(a);
      return next ? { items, next, coverage: "more" } : { items, next: null, coverage: "cap" };
    },
  };
}
