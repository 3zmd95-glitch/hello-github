/**
 * ⚙️ Cloud workflow occurrence controller (packet DT-7C-2B-4, planning/tools/38-cloud-workflows.md): UNCONSUMED.
 * Explicit Submit / Check status / Run / Cancel of one SAVED, immutable journal occurrence, over the accepted session
 * (`cloudWorkflowClient.ts`) and an injected persistence (the store's `cloudOccurrencePersistence`, or a test double).
 * Nothing imports it; constructing it makes no request and reads no storage.
 *
 *   order     capture (synchronous: generations, store fence, authority, latest action) -> verified durable read by the
 *             full key (detached body + immutable identity, rechecked under the lock) -> authority/suppression checks ->
 *             locked same-snapshot check + every fence, then ONE execute started synchronously inside that hold ->
 *             the parser-validated answer -> its receipt observed only through the accepted journal API.
 *   requests  built ONLY from the saved entry: Submit = its body + digest; Status/Run/Cancel = its ownerKey and
 *             occurrenceId with `expect: { body, payloadDigest }`, so every receipt is bound to the original. Never
 *             Settings, the current workflow/article, a new id or another authority.
 *   outcomes  refused (nothing sent) | answered (the complete parsed answer; a typed refusal stays a refusal) |
 *             unconfirmed (sent, no usable answer: never "failed", never "not delivered") | stale (a fence moved after
 *             dispatch: no current-action claim; a bound receipt may still be recorded on ITS occurrence). `recorded`
 *             is the journal API's exact committed result (`persisted: false` + reason when it was not kept); null when
 *             the answer carries no receipt (status absent/pruned, typed refusals): absent and pruned stay distinct and
 *             neither discards anything.
 *   fences    this controller's configuration/visit/handshake generations, a latest-action sequence, disposal and the
 *             store's in-memory configuration/visit fence (`persistence.fence()`); captured once per action, rechecked
 *             after every await, inside the locked dispatch and at EVERY result exit after the answer (uncertain, refused
 *             and answered alike: a moved fence is `stale` with the session's own dispatched fact, never a current
 *             `unconfirmed`; unmoved uncertainty stays `unconfirmed`, typed refusals stay typed). An authority installed under another
 *             store fence needs a new handshake (moving away and back never revives old work).
 *   reset     a suppressed (pre-reset) entry refuses Submit and Run; Check status and Cancel stay available on the
 *             retained, fully bound entry (the observation never changes its suppressed state).
 *   never     automatic action on construction/hydration/import/reset/reconnect/error, Run or Cancel chained after
 *             Submit, retry, polling, feed, adoption, acknowledgement, local execution.
 */

import {
  createCloudWorkflowSession,
  type ClientFetch,
  type ConfigureResult,
  type ExecuteResult,
  type RefusalReason,
  type SupportedRequest,
  type UncertainCategory,
} from "./cloudWorkflowClient";
import {
  authorityOf,
  type Authority,
  type CloudRequest,
  type OccurrenceBody,
  type Parsed,
} from "./cloudWorkflowProtocol";

export type OccurrenceAction = "submit" | "status" | "run" | "cancel";

/** The in-memory configuration (origin/token) and visit generations of the store (never persisted). */
export interface CloudFence {
  readonly config: number;
  readonly visit: number;
}

/** A saved occurrence as the verified durable reader returns it: detached, frozen, no secret. */
export interface SavedOccurrence {
  readonly key: string;
  readonly authority: Authority;
  readonly occurrenceId: string;
  readonly workflowId: string;
  readonly body: OccurrenceBody;
  readonly payloadDigest: string;
  readonly executionAt: string;
  readonly commitId: string;
  readonly state: "queued" | "suppressed";
  readonly suppression: {
    readonly epoch: number;
    readonly resetAt: string | null;
    readonly commitId: string | null;
  };
}

export type OccurrenceReadFailure =
  "invalid" | "missing" | "unreadable" | "moved" | "not-persisted" | "unsupported-save";
export type OccurrenceRead =
  | { readonly ok: true; readonly entry: SavedOccurrence }
  | { readonly ok: false; readonly reason: OccurrenceReadFailure };
export type ObserveOutcome =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

export interface OccurrencePersistence {
  fence(): CloudFence;
  /** The verified durable reader (by the full authority-scoped key). */
  read(key: string): Promise<OccurrenceRead>;
  /**
   * Under the shared lock: the entry is still stored exactly as read, then `go()` runs synchronously inside the hold
   * (null from `go` = a fence moved: `superseded`, nothing sent).
   */
  dispatch<T>(
    entry: SavedOccurrence,
    go: () => T | null,
  ): Promise<
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: OccurrenceReadFailure | "superseded" }
  >;
  /** The accepted journal observation API (monotonic, exact read-back). */
  observe(parsed: Parsed, request: CloudRequest): Promise<ObserveOutcome>;
}

export type OccurrenceRefusal =
  | RefusalReason
  | "handshake_required"
  | "invalid_key"
  | "invalid"
  | "missing"
  | "unreadable"
  | "moved"
  | "suppressed"
  | "not_persisted"
  | "unsupported_save";

export type Recorded =
  | { readonly persisted: true; readonly changed: boolean }
  | { readonly persisted: false; readonly reason: string };

export type OccurrenceResult =
  | {
      readonly kind: "refused";
      readonly action: OccurrenceAction;
      readonly reason: OccurrenceRefusal;
      readonly dispatched: false;
      readonly key?: string;
    }
  | {
      readonly kind: "answered";
      readonly action: OccurrenceAction;
      readonly key: string;
      readonly parsed: Parsed;
      readonly recorded: Recorded | null;
    }
  | {
      readonly kind: "unconfirmed";
      readonly action: OccurrenceAction;
      readonly key: string;
      readonly dispatched: boolean;
      readonly category: UncertainCategory;
      readonly parsed?: Parsed;
    }
  | {
      readonly kind: "stale";
      readonly action: OccurrenceAction;
      readonly key: string;
      readonly dispatched: boolean;
      readonly recorded: Recorded | null;
    };

export type HandshakeResult =
  | { readonly ok: true; readonly authority: Authority }
  | { readonly ok: false; readonly reason: string };

export interface OccurrenceController {
  configure(next: { origin: unknown; token: unknown }): ConfigureResult;
  invalidateVisit(): void;
  dispose(): void;
  handshake(): Promise<HandshakeResult>;
  submit(key: unknown): Promise<OccurrenceResult>;
  status(key: unknown): Promise<OccurrenceResult>;
  run(key: unknown): Promise<OccurrenceResult>;
  cancel(key: unknown): Promise<OccurrenceResult>;
}

interface Ctx {
  readonly cfgGen: number;
  readonly visitGen: number;
  readonly authGen: number;
  readonly auth: Authority | null;
  readonly fence: CloudFence;
  seq: number;
}

const READ_REFUSAL: Record<OccurrenceReadFailure, OccurrenceRefusal> = {
  invalid: "invalid",
  missing: "missing",
  unreadable: "unreadable",
  moved: "moved",
  "not-persisted": "not_persisted",
  "unsupported-save": "unsupported_save",
};
const sameFence = (a: CloudFence, b: CloudFence) => a.config === b.config && a.visit === b.visit;

/** The one request an action sends, from the saved entry only. */
function requestOf(action: OccurrenceAction, e: SavedOccurrence): SupportedRequest {
  if (action === "submit") return { kind: "submit", body: e.body, payloadDigest: e.payloadDigest };
  return {
    kind: action,
    ownerKey: e.authority.ownerKey,
    occurrenceId: e.occurrenceId,
    expect: { body: e.body, payloadDigest: e.payloadDigest },
  };
}

/** True when the parsed answer carries a full receipt the journal can observe. */
const hasReceipt = (p: Parsed): boolean =>
  p.outcome === "ok" &&
  (p.kind === "submit" ||
    p.kind === "run" ||
    p.kind === "cancel" ||
    (p.kind === "status" && p.result.found === "row"));

export function createOccurrenceController(deps: {
  fetch: ClientFetch;
  persistence: OccurrencePersistence;
}): OccurrenceController {
  const session = createCloudWorkflowSession({ fetch: deps.fetch });
  const store = deps.persistence;
  let cfg: { origin: string; token: string } | null = null;
  let auth: Authority | null = null;
  /** The store fence the installed authority was obtained under. */
  let authFence: CloudFence | null = null;
  let cfgGen = 0;
  let visitGen = 0;
  let authGen = 0;
  let latest = 0;
  let disposed = false;

  const capture = (): Ctx => ({
    cfgGen,
    visitGen,
    authGen,
    auth,
    fence: store.fence(),
    seq: latest,
  });
  const holds = (c: Ctx): boolean =>
    !disposed &&
    c.cfgGen === cfgGen &&
    c.visitGen === visitGen &&
    c.authGen === authGen &&
    c.auth === auth &&
    c.seq === latest &&
    sameFence(c.fence, store.fence());

  function configure(next: { origin: unknown; token: unknown }): ConfigureResult {
    if (disposed) return { ok: false, reason: "disposed" };
    // Each caller field is read exactly once; the session gets the same values.
    const origin = next?.origin;
    const token = next?.token;
    const r = session.configure({ origin, token });
    const target = r.ok ? { origin: r.origin, token: token as string } : null;
    const unchanged =
      cfg === target ||
      (cfg !== null &&
        target !== null &&
        cfg.origin === target.origin &&
        cfg.token === target.token);
    if (!unchanged) {
      cfgGen++;
      cfg = target;
      auth = null;
    }
    return r;
  }

  function invalidateVisit(): void {
    if (disposed) return;
    session.invalidateVisit();
    visitGen++;
    auth = null;
  }

  function dispose(): void {
    disposed = true;
    session.dispose();
    cfg = null;
    auth = null;
    cfgGen++;
    visitGen++;
  }

  async function handshake(): Promise<HandshakeResult> {
    if (disposed) return { ok: false, reason: "disposed" };
    if (!cfg) return { ok: false, reason: "not_configured" };
    const c = capture();
    c.seq = ++latest;
    const want = cfg.origin;
    const r = await session.handshake();
    if (!holds(c)) return { ok: false, reason: "stale" };
    if (
      r.kind === "answer" &&
      r.meta.installed === true &&
      r.parsed.outcome === "ok" &&
      r.parsed.kind === "authority"
    ) {
      const a = authorityOf(r.parsed.authority.origin, r.parsed.authority.ownerKey);
      if (!a || a.origin !== want) return { ok: false, reason: "invalid" };
      auth = a;
      authFence = c.fence;
      authGen++;
      return { ok: true, authority: a };
    }
    return { ok: false, reason: r.kind === "refused" ? r.reason : r.kind };
  }

  async function act(action: OccurrenceAction, rawKey: unknown): Promise<OccurrenceResult> {
    const refused = (reason: OccurrenceRefusal, key?: string): OccurrenceResult => ({
      kind: "refused",
      action,
      reason,
      dispatched: false,
      ...(key !== undefined ? { key } : {}),
    });
    if (disposed) return refused("disposed");
    if (!cfg) return refused("not_configured");
    const c = capture();
    if (!c.auth) return refused("no_authority");
    if (!authFence || !sameFence(authFence, c.fence)) return refused("handshake_required");
    if (typeof rawKey !== "string") return refused("invalid_key");
    const key = rawKey;
    c.seq = ++latest; // every older action of this controller is superseded from here
    const lost = () => refused(disposed ? "disposed" : "superseded", key);

    let read: OccurrenceRead;
    try {
      read = await store.read(key);
    } catch {
      read = { ok: false, reason: "unreadable" };
    }
    if (!holds(c)) return lost();
    if (!read.ok) return refused(READ_REFUSAL[read.reason] ?? "unreadable", key);
    const saved = read.entry;
    if (saved.key !== key) return refused("invalid", key);
    if (saved.authority.origin !== c.auth.origin) return refused("foreign_origin", key);
    if (saved.authority.ownerKey !== c.auth.ownerKey) return refused("foreign_owner", key);
    if ((action === "submit" || action === "run") && saved.state !== "queued")
      return refused("suppressed", key);
    const request = requestOf(action, saved);
    const a = c.auth;

    let sent:
      | { readonly ok: true; readonly value: Promise<ExecuteResult> }
      | { readonly ok: false; readonly reason: OccurrenceReadFailure | "superseded" };
    // Set synchronously by the one execute call: a started request is never relabelled "refused / not sent".
    const flight: { p?: Promise<ExecuteResult> } = {};
    try {
      // The execute call starts (and invokes fetch) synchronously inside the locked same-snapshot check.
      sent = await store.dispatch(saved, () =>
        holds(c) ? (flight.p = session.execute(request, a)) : null,
      );
    } catch {
      sent = { ok: false, reason: "not-persisted" };
    }
    if (flight.p) sent = { ok: true, value: flight.p };
    if (!sent.ok)
      return sent.reason === "superseded" ? lost() : refused(READ_REFUSAL[sent.reason], key);
    const res = await sent.value;

    // Every exit below is after an await: a moved controller/store fence (config, visit, authority, newer action,
    // disposal) dominates whatever came back. `dispatched` stays exactly what the session reported (an invoked POST is
    // never relabelled refused / not sent); nothing is retried, polled or erased.
    const staleNow = (dispatched: boolean, recorded: Recorded | null = null): OccurrenceResult => ({
      kind: "stale",
      action,
      key,
      dispatched,
      recorded,
    });
    if (res.kind === "refused") return holds(c) ? refused(res.reason, key) : staleNow(false);
    if (res.kind === "stale") return staleNow(res.dispatched);
    if (res.kind === "uncertain")
      return !holds(c)
        ? staleNow(res.meta.dispatched)
        : {
            kind: "unconfirmed",
            action,
            key,
            dispatched: res.meta.dispatched,
            category: res.category,
            ...(res.parsed ? { parsed: res.parsed } : {}),
          };
    const parsed = res.parsed;
    // The session bound the answer to the originating authority; the parser bound any receipt to the saved body.
    let recorded: Recorded | null = null;
    if (hasReceipt(parsed)) {
      try {
        const o = await store.observe(parsed, request);
        recorded = o.ok
          ? { persisted: true, changed: o.changed }
          : { persisted: false, reason: o.reason };
      } catch {
        recorded = { persisted: false, reason: "error" };
      }
    }
    // A fence that moved since the capture: bound evidence may have been kept, but this is not the current action.
    if (!holds(c)) return staleNow(true, recorded);
    return { kind: "answered", action, key, parsed, recorded };
  }

  return {
    configure,
    invalidateVisit,
    dispose,
    handshake,
    submit: (key) => act("submit", key),
    status: (key) => act("status", key),
    run: (key) => act("run", key),
    cancel: (key) => act("cancel", key),
  };
}
