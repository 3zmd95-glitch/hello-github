/**
 * ⚙️ Cloud workflow browser transport/session (packet DT-7C-2B-1, planning/tools/38-cloud-workflows.md): UNCONSUMED.
 * A small in-memory session over the accepted protocol (`cloudWorkflowProtocol.ts`) with a dependency-injected fetch.
 * Nothing imports it; importing or constructing it makes no request and reads no global fetch, store, journal, clock
 * or storage. It does NOT adopt, acknowledge, persist or retry anything: a later packet's durable caller records what
 * this returns (an observed receipt is never delivery). DT-7C-2C: `ack`/`changes` pass through unchanged rules; the
 * reconciliation controller owns proof and acknowledgement.
 *
 *   session   `createCloudWorkflowSession({ fetch })` -> `configure({ origin, token })`, `invalidateVisit()`,
 *             `dispose()`, `handshake()`, `execute(request, authority)`. The token and origin live in this closure only.
 *   authority only a valid `handshake()` answer installs the server ownerKey (with the captured canonical origin) for
 *             the current configuration/visit; a caller-typed owner, an imported authority or a foreign origin is
 *             refused before any fetch and is never retargeted. `execute` needs the ORIGINATING Authority and the
 *             request's ownerKey (a submit body's ownerKey) to equal the installed one.
 *   fences    `configGen` (any actual origin/token change), `visitGen` (explicit visit invalidation, even back to the
 *             same target), a monotonic action sequence (the latest action wins) and `disposed`. All are captured
 *             synchronously with a detached copy of the request before the first await, and rechecked after every
 *             await, immediately before fetch, after every streamed chunk, after the parser (digests) and before the
 *             result is returned. A superseded action returns `stale` and can neither install authority nor release
 *             another action's state. Superseding also aborts the older fetch (best effort: once a POST was invoked,
 *             an abort is NOT proof that no mutation happened, so a stale/uncertain POST keeps `dispatched`).
 *   origin    DT-7C-2B-4: `configure` accepts only `transportOrigin` (HTTPS, or HTTP on exactly localhost / 127.0.0.1 /
 *             [::1]); anything else leaves the session unconfigured, so no handshake, registration or occurrence
 *             request can carry the bearer to it.
 *   transport destination = captured canonical origin + the descriptor's fixed path; `Authorization: Bearer`,
 *             `credentials: omit`, `cache: no-store`, `redirect: manual`; a redirect or a different final URL is
 *             refused (uncertain). No caller header/method/path. The exact UTF-8 request is checked against the
 *             Worker's REQUEST_BYTES_MAX before fetch. The response is read by a bounded stream (RESPONSE_BYTES_MAX;
 *             Content-Length is not trusted; the reader is cancelled on overflow/abort/fence) under one DEADLINE_MS
 *             across network and body, and parsed as JSON only after it is complete.
 *   outcomes  refused (nothing dispatched) | answer (the parser's complete result, typed refusals unchanged and never
 *             labelled retry-safe) | uncertain (dispatched, no usable typed answer) | stale (a fence moved).
 *             Registration uncertainty is only REPORTED: there is no read-only registration route, so no recovery is
 *             invented here and nothing is ever repeated.
 */

import { REQUEST_BYTES_MAX } from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityOf,
  canonicalOrigin,
  deepFreeze,
  describeRequest,
  detachRequest,
  parseAnswer,
  type Authority,
  type CloudRequest,
  type InvalidReason,
  type Parsed,
} from "./cloudWorkflowProtocol";

/** One complete answer is at most this many bytes (a maximal full receipt is ~0.35 MB; proven in the wire test). */
export const RESPONSE_BYTES_MAX = 1_048_576;
/** One request, network and body together. */
export const DEADLINE_MS = 15_000;

/**
 * Every protocol request. DT-7C-2C admitted `ack` (POST) and `changes` (GET) through this same fenced, bounded session
 * (same capture, fences, deadline, stream bound and parser); nothing else changed.
 */
export type SupportedRequest = CloudRequest;
const SUPPORTED: ReadonlySet<string> = new Set([
  "authority",
  "register",
  "update",
  "pause",
  "resume",
  "unregister",
  "submit",
  "status",
  "run",
  "cancel",
  "ack",
  "changes",
]);

/** The only fetch options this client passes (a real `fetch` is assignable). */
export interface ClientRequestInit {
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials: "omit";
  readonly cache: "no-store";
  readonly redirect: "manual";
  readonly signal: AbortSignal;
}
/** The part of a `Response` this client reads. */
export interface ClientResponse {
  readonly status: number;
  readonly url?: string;
  readonly type?: string;
  readonly redirected?: boolean;
  readonly body: ReadableStream<Uint8Array> | null;
}
export type ClientFetch = (url: string, init: ClientRequestInit) => Promise<ClientResponse>;

export type ConfigureResult =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: "origin" | "insecure" | "token" | "disposed" };

/** HTTP is allowed only for these canonical loopback hosts (DT-7C-2B-4); every other origin must be HTTPS. */
const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * DT-7C-2B-4: the origin a session may send a bearer to. The accepted canonical-origin rule first (unchanged: no
 * user-info, path, query or fragment; case and default port canonicalized), then HTTPS, or HTTP only when the host is
 * exactly `localhost`, `127.0.0.1` or `[::1]` AS SPELLED (so `127.1`, `0x7f.0.0.1`, `[0:0::1]`, `localhost.` and
 * suffix lookalikes are refused). Stored/imported authorities are not validated here and never rewritten.
 */
export function transportOrigin(
  raw: unknown,
):
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: "origin" | "insecure" } {
  const origin = canonicalOrigin(raw);
  if (origin === null) return { ok: false, reason: "origin" };
  const host = new URL(origin).hostname;
  if (origin.startsWith("https:")) return { ok: true, origin };
  // canonicalOrigin accepted `raw`, so it is a string of the form scheme://host[:port][/].
  const spelled = /^https?:\/\/(\[[^\]]*\]|[^:/]*)/i.exec(raw as string)?.[1]?.toLowerCase();
  return LOOPBACK.has(host) && spelled === host
    ? { ok: true, origin }
    : { ok: false, reason: "insecure" };
}

export type RefusalReason =
  | "disposed"
  | "not_configured"
  | "unsupported_kind"
  | "invalid_request"
  | "too_large"
  | "invalid_authority"
  | "no_authority"
  | "foreign_origin"
  | "foreign_owner"
  | "owner_mismatch"
  | "superseded";

export type UncertainCategory =
  | "network"
  | "aborted"
  | "timeout"
  | "redirect"
  | "unexpected_url"
  | "read"
  | "oversized"
  | "malformed_json"
  | "invalid_answer"
  | "receipt_unavailable";

/** What was sent where: the detached, frozen request (never the caller's object) plus its fixed route. */
export interface Binding {
  readonly request: SupportedRequest;
  readonly method: "GET" | "POST";
  readonly path: string;
}
/** Nonsecret dispatch facts. `installed` is set by `handshake` only. */
export interface Meta {
  /** A fetch was invoked (for a POST that means the mutation may have happened, whatever came back). */
  readonly dispatched: boolean;
  readonly mutating: boolean;
  readonly status?: number;
  readonly installed?: boolean;
  readonly invalid?: InvalidReason;
}

export type ExecuteResult =
  | { readonly kind: "refused"; readonly reason: RefusalReason; readonly dispatched: false }
  | {
      readonly kind: "answer";
      readonly parsed: Parsed;
      readonly binding: Binding;
      readonly meta: Meta;
    }
  | {
      readonly kind: "uncertain";
      readonly category: UncertainCategory;
      readonly origin: string;
      /** The originating authority (null for a handshake: it has none yet). */
      readonly authority: Authority | null;
      readonly binding: Binding;
      readonly meta: Meta;
      /** The typed refusal when the category is receipt_unavailable. */
      readonly parsed?: Parsed;
    }
  | {
      readonly kind: "stale";
      readonly dispatched: boolean;
      readonly origin: string;
      readonly authority: Authority | null;
      readonly binding: Binding;
      readonly meta: Meta;
    };

/**
 * The reason a failed handshake reports (every controller uses this one rule). A 404 the protocol cannot read is a
 * Worker without the cloud-workflow routes (the live Worker answers its generic `{ error: "not_found" }`): reported as
 * "answer" (the Worker answered; cloud workflows aren't available there yet), never as an unclear answer.
 */
export const handshakeFailure = (r: ExecuteResult): string =>
  r.kind === "refused"
    ? r.reason
    : r.kind === "uncertain" && r.meta.status === 404
      ? "answer"
      : r.kind;

export interface CloudWorkflowSession {
  configure(next: { origin: unknown; token: unknown }): ConfigureResult;
  invalidateVisit(): void;
  dispose(): void;
  handshake(): Promise<ExecuteResult>;
  execute(request: SupportedRequest, authority: Authority): Promise<ExecuteResult>;
}

/** Visible ASCII without spaces: a token that can be a header value without surprises. */
const TOKEN_RE = /^[\x21-\x7e]{1,4096}$/;
const enc = new TextEncoder();
const refused = (reason: RefusalReason): ExecuteResult => ({
  kind: "refused",
  reason,
  dispatched: false,
});

/** Thrown inside one action to leave through its single catch (the cause is read from the fences/signal). */
class Leave extends Error {
  constructor(readonly category: UncertainCategory) {
    super(category);
  }
}

/**
 * `p` or the signal, whichever comes first (a fake or real fetch that ignores the signal still cannot hold the
 * action past an abort). A late value is handed to `late` so a response body is never left open.
 */
function guard<T>(p: Promise<T>, signal: AbortSignal, late?: (v: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      if (!done) {
        done = true;
        reject(new Leave("aborted"));
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // Observe BOTH eventual outcomes in every branch (also when the signal was already aborted): a late value goes
    // to `late` (fire-and-forget cleanup, never awaited), a late rejection is swallowed here.
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        if (done) late?.(v);
        else {
          done = true;
          resolve(v);
        }
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (!done) {
          done = true;
          reject(e);
        }
      },
    );
    if (signal.aborted) {
      signal.removeEventListener("abort", onAbort);
      onAbort();
    }
  });
}

const closeQuietly = (b: ReadableStream<Uint8Array> | null | undefined) => {
  try {
    void b?.cancel().catch(() => {});
  } catch {
    /* already locked or closed */
  }
};

/** The session identity an action starts from: captured at the entry of execute/handshake, before caller data runs. */
interface Context {
  readonly conn: { origin: string; token: string };
  readonly authority: Authority | null;
  readonly cfgGen: number;
  readonly visitGen: number;
  readonly latest: number;
}

export function createCloudWorkflowSession(deps: { fetch: ClientFetch }): CloudWorkflowSession {
  // Called as a plain function: a native fetch throws "Illegal invocation" when called as a method of another object.
  const send = deps.fetch;
  let cfg: { origin: string; token: string } | null = null;
  let authority: Authority | null = null;
  let configGen = 0;
  let visitGen = 0;
  let latest = 0;
  let disposed = false;
  const live = new Set<AbortController>();
  const supersede = () => {
    for (const ac of live) ac.abort("stale");
    live.clear();
  };

  function configure(next: { origin: unknown; token: unknown }): ConfigureResult {
    if (disposed) return { ok: false, reason: "disposed" };
    const rawOrigin = next?.origin;
    const rawToken = next?.token;
    const checked = transportOrigin(rawOrigin); // DT-7C-2B-4: before any bearer request can exist
    const origin = checked.ok ? checked.origin : null;
    const valid = origin !== null && typeof rawToken === "string" && TOKEN_RE.test(rawToken);
    const target = valid ? { origin, token: rawToken } : null;
    const same =
      cfg === target ||
      (cfg !== null &&
        target !== null &&
        cfg.origin === target.origin &&
        cfg.token === target.token);
    if (!same) {
      configGen++;
      authority = null;
      cfg = target;
      supersede();
    }
    return valid
      ? { ok: true, origin }
      : { ok: false, reason: checked.ok ? "token" : checked.reason };
  }

  function invalidateVisit(): void {
    if (disposed) return;
    visitGen++;
    authority = null;
    supersede();
  }

  function dispose(): void {
    disposed = true;
    cfg = null;
    authority = null;
    configGen++;
    visitGen++;
    supersede();
  }

  /** Synchronous snapshot of the session identity (callers have checked `cfg` and `disposed` first). */
  const capture = (): Context => ({
    conn: cfg!,
    authority,
    cfgGen: configGen,
    visitGen,
    latest,
  });
  /**
   * The exact captured identity still holds: not disposed, same configuration object and generations, same authority
   * and no newer action started since (a refused call never starts one, so it cannot invalidate this).
   */
  const holds = (c: Context): boolean =>
    !disposed &&
    cfg === c.conn &&
    configGen === c.cfgGen &&
    visitGen === c.visitGen &&
    authority === c.authority &&
    latest === c.latest;
  const lost = (): ExecuteResult => refused(disposed ? "disposed" : "superseded");

  /** Runs one already-validated, already-captured action. Everything it needs was read before the first await. */
  async function run(
    request: SupportedRequest,
    method: "GET" | "POST",
    path: string,
    bodyText: string | undefined,
    intended: Authority | null,
    handshake: boolean,
    ctx: Context,
  ): Promise<ExecuteResult> {
    // ---- capture (synchronous): the identity was captured at the entry of execute/handshake and `holds(ctx)` was just
    // verified, so these are exactly the originating values ----
    const conn = ctx.conn;
    const origin = conn.origin;
    const gens = { cfg: ctx.cfgGen, visit: ctx.visitGen };
    supersede(); // the older actions are superseded: abort them, then take the next sequence number
    const mine = ++latest;
    const fresh = () =>
      !disposed && gens.cfg === configGen && gens.visit === visitGen && mine === latest;
    const binding: Binding = deepFreeze({ request, method, path });
    const ac = new AbortController();
    live.add(ac);
    let dispatched = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const meta = (extra: Partial<Meta> = {}): Meta => ({
      dispatched,
      mutating: method === "POST",
      ...extra,
    });
    const stale = (): ExecuteResult => ({
      kind: "stale",
      dispatched,
      origin,
      authority: intended,
      binding,
      meta: meta(),
    });
    const uncertain = (
      category: UncertainCategory,
      extra: Partial<Meta> = {},
      parsed?: Parsed,
    ): ExecuteResult => ({
      kind: "uncertain",
      category,
      origin,
      authority: intended,
      binding,
      meta: meta(extra),
      ...(parsed ? { parsed } : {}),
    });
    let status: number | undefined;
    try {
      const url = `${origin}${path}`;
      const init: ClientRequestInit = {
        method,
        headers: Object.freeze({
          Authorization: `Bearer ${conn.token}`,
          ...(bodyText !== undefined ? { "Content-Type": "application/json" } : {}),
        }),
        ...(bodyText !== undefined ? { body: bodyText } : {}),
        credentials: "omit",
        cache: "no-store",
        redirect: "manual",
        signal: ac.signal,
      };
      if (!fresh()) return stale();
      timer = setTimeout(() => ac.abort("timeout"), DEADLINE_MS);
      dispatched = true;
      let pending: Promise<ClientResponse>;
      try {
        pending = Promise.resolve(send(url, init));
      } catch (e) {
        pending = Promise.reject(e);
      }
      const res = await guard(pending, ac.signal, (r) => closeQuietly(r?.body));
      if (!fresh()) {
        closeQuietly(res?.body);
        return stale();
      }
      status = res.status;
      if (
        res.type === "opaqueredirect" ||
        res.redirected === true ||
        [301, 302, 303, 307, 308].includes(res.status)
      ) {
        closeQuietly(res.body);
        return uncertain("redirect", { status });
      }
      if (typeof res.url === "string" && res.url !== "" && !sameUrl(res.url, url)) {
        closeQuietly(res.body);
        return uncertain("unexpected_url", { status });
      }

      const bytes = await readBounded(res.body, ac.signal, fresh);
      // The fence moved after the last read completed: nothing is decoded and no early result is returned.
      if (!fresh()) return stale();
      clearTimeout(timer);
      let wire: unknown;
      try {
        wire = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        return uncertain("malformed_json", { status });
      }
      const parsed = await parseAnswer(request, { status: res.status, body: wire }, { origin });
      if (!fresh()) return stale();
      if (parsed.outcome === "invalid")
        return uncertain("invalid_answer", { status, invalid: parsed.reason });
      if (
        method === "POST" &&
        parsed.outcome === "refused" &&
        parsed.error === "receipt_unavailable"
      )
        return uncertain("receipt_unavailable", { status }, parsed);
      // Only the latest handshake's valid answer installs authority (fresh() was checked just above, no await since).
      let installed = false;
      if (handshake && parsed.outcome === "ok" && parsed.kind === "authority") {
        authority = parsed.authority;
        installed = true;
      }
      return {
        kind: "answer",
        parsed,
        binding,
        meta: meta({ status, ...(handshake ? { installed } : {}) }),
      };
    } catch (e) {
      // A fence that moved wins over whatever the failure was: the answer would not apply to this visit anyway.
      if (!fresh()) return stale();
      const reason = ac.signal.aborted ? (ac.signal.reason as unknown) : undefined;
      if (reason === "timeout") return uncertain("timeout", { status });
      if (e instanceof Leave) return uncertain(e.category, { status });
      const name = (e as { name?: unknown } | null)?.name;
      return uncertain(!dispatched || name === "AbortError" ? "aborted" : "network", { status });
    } finally {
      clearTimeout(timer);
      live.delete(ac);
    }
  }

  /** Reads the whole body or throws; never more than RESPONSE_BYTES_MAX bytes, whatever Content-Length said. */
  async function readBounded(
    body: ReadableStream<Uint8Array> | null,
    signal: AbortSignal,
    fresh: () => boolean,
  ): Promise<Uint8Array> {
    if (!body) return new Uint8Array(0);
    const reader = body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const r = await guard(reader.read(), signal);
        if (!fresh()) throw new Leave("aborted");
        if (r.done) break;
        if (!(r.value instanceof Uint8Array)) throw new Leave("read");
        total += r.value.byteLength;
        if (total > RESPONSE_BYTES_MAX) throw new Leave("oversized");
        parts.push(r.value);
      }
    } catch (e) {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        /* nothing left to cancel */
      }
      throw e instanceof Leave || signal.aborted ? e : new Leave("read");
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  }

  /** The `ownerKey` a supported request is addressed to (a submit's lives in its body). */
  const ownerOf = (r: SupportedRequest): string | null =>
    r.kind === "authority" ? null : r.kind === "submit" ? r.body.ownerKey : r.ownerKey;
  const ownerMismatch = (r: SupportedRequest, intended: Authority): boolean => {
    const owner = ownerOf(r);
    return owner !== null && owner !== intended.ownerKey;
  };

  /**
   * Validates the request (this is where caller accessors run, so `ctx` was captured BEFORE) and hands over to `run`
   * only if the exact captured identity still holds. A synchronous throw anywhere in here is a refusal. Nothing here
   * awaits, and a refused plan never touches `latest` or any other action.
   */
  function plan(
    raw: unknown,
    intended: Authority | null,
    handshake: boolean,
    ctx: Context,
  ): Promise<ExecuteResult> | ExecuteResult {
    let reason: RefusalReason = "invalid_request";
    let go: (() => Promise<ExecuteResult>) | null = null;
    try {
      const request = detachRequest(raw as CloudRequest) as SupportedRequest;
      if (!SUPPORTED.has(request.kind)) reason = "unsupported_kind";
      else {
        const d = describeRequest(request);
        if (!d.ok) reason = "invalid_request";
        else if (intended !== null && ownerMismatch(request, intended)) reason = "owner_mismatch";
        else {
          const bodyText =
            d.descriptor.body === undefined ? undefined : JSON.stringify(d.descriptor.body);
          if (bodyText !== undefined && enc.encode(bodyText).length > REQUEST_BYTES_MAX)
            reason = "too_large";
          else {
            const { method, path } = d.descriptor;
            go = () => run(request, method, path, bodyText, intended, handshake, ctx);
          }
        }
      }
    } catch {
      reason = "invalid_request";
    }
    // An intervening configure/invalidateVisit/dispose/newer action wins over any request verdict: zero fetch.
    if (!holds(ctx)) return lost();
    return go ? go() : refused(reason);
  }

  async function handshake(): Promise<ExecuteResult> {
    if (disposed) return refused("disposed");
    if (!cfg) return refused("not_configured");
    return plan({ kind: "authority" }, null, true, capture());
  }

  async function execute(request: SupportedRequest, intended: Authority): Promise<ExecuteResult> {
    if (disposed) return refused("disposed");
    if (!cfg) return refused("not_configured");
    // The identity is captured HERE, before any caller data (the authority's fields, the request's accessors) runs.
    const ctx = capture();
    // Read each field of the caller's authority exactly once; only the canonical copy is used afterwards.
    const origin = (intended as { origin?: unknown } | null)?.origin;
    const ownerKey = (intended as { ownerKey?: unknown } | null)?.ownerKey;
    const claimed = authorityOf(origin, ownerKey);
    if (!holds(ctx)) return lost();
    if (claimed === null) return refused("invalid_authority");
    if (ctx.authority === null) return refused("no_authority");
    if (claimed.origin !== ctx.authority.origin) return refused("foreign_origin");
    if (claimed.ownerKey !== ctx.authority.ownerKey) return refused("foreign_owner");
    return plan(request, ctx.authority, false, ctx);
  }

  return { configure, invalidateVisit, dispose, handshake, execute };
}

const sameUrl = (a: string, b: string): boolean => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};
