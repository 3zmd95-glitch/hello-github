/**
 * ⚙️ Cloud workflow browser hub (packet DT-7C-3A, planning/tools/38-cloud-workflows.md). The ONE place the dashboard
 * holds the three accepted controllers (registration, occurrence, reconciliation) with the store's persistence adapters
 * and one shared plain-function `window.fetch`; the UI reads a small observable view and calls explicit actions.
 *
 *   lazy      nothing is constructed at import; `cloudHub()` creates the hub on first call in a browser and returns an
 *             inert hub (every action refuses `no-browser`) without one.
 *   config    `configure({origin, token})` on all three at creation and on every transition of
 *             `settings.apiKeys.scoutUrl` / `scoutToken` (one store subscription). The view keeps only the origin or the
 *             refusal reason; the token is never stored here.
 *   actions   explicit only: each is exactly one controller call (handshake: one per controller, in turn), busy for its
 *             key while in flight, its typed result kept in `view().last[key]`. No retry, polling, chaining (submit never
 *             runs, reconcile never acks) or automatic handshake. Fences are the controllers' and the store's own.
 *   teardown  `pagehide`: the store visit fence moves and the hub is disposed (the next `cloudHub()` is a fresh one).
 *             `leaveCloudScreen()`: the store visit fence moves and every controller visit is invalidated.
 */

import {
  cloudJournalRetained,
  cloudOccurrencePersistence,
  cloudReconciliationPersistence,
  cloudRegistrationPersistence,
  invalidateCloudVisit,
  useStore,
  type CaptureAuthority,
} from "@/store";
import { workflowDigestOf } from "./cloudWorkflowCapture";
import type { ClientFetch, ConfigureResult } from "./cloudWorkflowClient";
import type { Workflow } from "./domain";
import {
  createOccurrenceController,
  type HandshakeResult,
  type OccurrenceController,
  type OccurrenceResult,
} from "./cloudWorkflowOccurrenceClient";
import type { Authority } from "./cloudWorkflowProtocol";
import {
  readReconciliation,
  type CloudReconciliation,
  type CloudRun,
} from "./cloudWorkflowReconciliation";
import {
  createReconciliationController,
  type AckResult,
  type CheckResult,
  type ReconcileResult,
  type ReconciliationController,
} from "./cloudWorkflowReconciliationClient";
import {
  isUnresolved,
  lifecycleRequestFor,
  readRegistrations,
  registrationKey,
  type CloudRegistrations,
  type IntentState,
  type LifecycleBuild,
} from "./cloudWorkflowRegistration";
import {
  createRegistrationController,
  type ControllerResult,
  type RegistrationController,
} from "./cloudWorkflowRegistrationClient";

/** Refused by the hub itself before any controller call. */
export interface HubRefusal {
  readonly kind: "refused";
  readonly reason:
    | "no-browser"
    | "no_authority"
    | "missing"
    | "unreadable"
    | "invalid_request"
    | Extract<LifecycleBuild, { ok: false }>["reason"];
  readonly dispatched: false;
}

export interface CloudHubView {
  readonly configured:
    | { readonly ok: true; readonly origin: string }
    | {
        readonly ok: false;
        readonly reason: "none" | Extract<ConfigureResult, { ok: false }>["reason"];
      };
  /** The registration controller's authority after an explicit handshake (cleared on any config/visit change). */
  readonly authority: Authority | null;
  readonly handshake:
    "idle" | "busy" | "ok" | { readonly refused: string } | { readonly uncertain: string };
  /** Keys with an action in flight: `handshake`, `reconcile`, `wf:<workflowId>` or an occurrence key. */
  readonly busy: ReadonlySet<string>;
  /** The last typed result per key, for the UI copy. */
  readonly last: Readonly<Record<string, unknown>>;
}

/** One stored registration record, parsed through the pinned module (structure only; actions re-verify). */
export interface RegistrationView {
  readonly key: string;
  readonly workflowId: string;
  readonly origin: string;
  readonly ownerKey: string;
  /** The current intent's state. */
  readonly state: IntentState;
  /** The newest bound registration observation's state, or null when none. */
  readonly proof: "active" | "unregistered" | null;
  readonly paused: boolean;
  /** `isUnresolved(intent)`: the key accepts no new intent and Recover applies (DT-7C-3B fix round). */
  readonly unresolved: boolean;
  /** The Worker's typed error when the intent was refused. */
  readonly lastRefusal?: string;
}

/** A stored proof whose terminal receipt the Worker has not yet seen acknowledged: the Confirm delivery list. */
export interface DeliverableView {
  readonly key: string;
  readonly occurrenceId: string;
  readonly workflowId: string;
  readonly state: "done" | "partial" | "failed" | "cancelled";
}

/** Stored record counts (null: that slice is unreadable). */
export interface CloudCounts {
  readonly registrations: number | null;
  readonly proofs: number | null;
  readonly tombstones: number | null;
  readonly pending: number | null;
  readonly runs: number | null;
  readonly journal: number | null;
}

type Lifecycle = Promise<ControllerResult | HubRefusal>;
export interface CloudHub {
  view(): CloudHubView;
  subscribe(cb: () => void): () => void;
  handshake(): Promise<HandshakeResult>;
  register(workflowId: string): Lifecycle;
  unregister(workflowId: string): Lifecycle;
  recover(workflowId: string): Lifecycle;
  submit(key: string): Promise<OccurrenceResult | HubRefusal>;
  status(key: string): Promise<OccurrenceResult | HubRefusal>;
  run(key: string): Promise<OccurrenceResult | HubRefusal>;
  cancel(key: string): Promise<OccurrenceResult | HubRefusal>;
  reconcile(opts?: { limit?: number }): Promise<ReconcileResult | HubRefusal>;
  check(key: string): Promise<CheckResult | HubRefusal>;
  ack(key: string): Promise<AckResult | HubRefusal>;
  authorityFor(workflowId: string): Authority | null;
  captureAuthority(workflowId: string): CaptureAuthority | null;
  registrations(): readonly RegistrationView[];
  counts(): CloudCounts;
  cloudRuns(): readonly CloudRun[];
  /** Read-only: proofs ready for Confirm delivery (structure only; `ack` re-checks eligibility under the lock). */
  deliverable(): readonly DeliverableView[];
  /** Leaving the cloud screen: every controller visit invalidated, authority cleared. */
  leave(): void;
  dispose(): void;
}

export interface CloudHubDeps {
  readonly registration: RegistrationController;
  readonly occurrence: OccurrenceController;
  readonly reconciliation: ReconciliationController;
  /** The verified durable registrations (the store adapter's `read`). */
  readRegistrations(): Promise<CloudRegistrations | null>;
  onDispose?(): void;
}

/** A well-formed digest the builder validates and ignores for unregister (the proof's digest is used). */
const UNUSED_DIGEST = "0".repeat(64);

const refuse = (reason: HubRefusal["reason"]): HubRefusal => ({
  kind: "refused",
  reason,
  dispatched: false,
});

function registrationViews(): RegistrationView[] {
  const regs = readRegistrations(useStore.getState().cloudRegistrations);
  return (regs?.records ?? []).map((r) => {
    const reg = r.last?.answer.body.registration as { state?: unknown; paused?: unknown } | null;
    const proof = reg?.state === "active" || reg?.state === "unregistered" ? reg.state : null;
    const error = r.intent.state === "refused" ? r.intent.answer?.body.error : undefined;
    return {
      key: r.key,
      workflowId: r.workflowId,
      origin: r.origin,
      ownerKey: r.ownerKey,
      state: r.intent.state,
      proof,
      paused: reg?.paused === true,
      unresolved: isUnresolved(r.intent),
      ...(typeof error === "string" ? { lastRefusal: error } : {}),
    };
  });
}

function counts(): CloudCounts {
  const s = useStore.getState();
  const regs = readRegistrations(s.cloudRegistrations);
  const rec = readReconciliation(s.cloudReconciliation);
  return {
    registrations: regs ? regs.records.length : null,
    proofs: rec ? rec.proofs.length : null,
    tombstones: rec ? rec.tombstones.length : null,
    pending: rec ? rec.pending.length : null,
    runs: rec ? rec.runs.length : null,
    journal: cloudJournalRetained(s),
  };
}

const cloudRuns = (): readonly CloudRun[] =>
  readReconciliation(useStore.getState().cloudReconciliation)?.runs ?? [];

const TERMINAL = new Set(["done", "partial", "failed", "cancelled"]);
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/**
 * Proofs with a terminal stored receipt, no collision output, not retired and not yet acknowledged
 * (`ackedVersion < receiptVersion`), in stored order. A UI hint: `ack` re-derives eligibility from the verified slice.
 */
export function deliverableOf(rec: CloudReconciliation | null): DeliverableView[] {
  if (!rec) return [];
  const retired = new Set(rec.tombstones.map((t) => t.key));
  return rec.proofs
    .filter(
      (p) =>
        TERMINAL.has(p.receipt.state as string) &&
        !retired.has(p.key) &&
        !p.outputs.some((o) => o.disposition === "collision") &&
        num(p.receipt.ackedVersion) < num(p.receipt.receiptVersion),
    )
    .map((p) => ({
      key: p.key,
      occurrenceId: p.occurrenceId,
      workflowId: p.workflowId,
      state: p.receipt.state as DeliverableView["state"],
    }));
}

/** The hub over injected controllers (the singleton's factory; tests inject fakes). */
export function createCloudHub(deps: CloudHubDeps): CloudHub {
  const { registration, occurrence, reconciliation } = deps;
  const all = [registration, occurrence, reconciliation] as const;
  let v: CloudHubView = {
    configured: { ok: false, reason: "none" },
    authority: null,
    handshake: "idle",
    busy: new Set(),
    last: {},
  };
  const subs = new Set<() => void>();
  const inflight = new Map<string, number>();
  /** Moves on every configure/leave/dispose: an older handshake never installs its authority in the view. */
  let gen = 0;
  let disposed = false;

  const set = (patch: Partial<CloudHubView>) => {
    v = { ...v, ...patch };
    for (const cb of [...subs]) cb();
  };
  const mark = (key: string, d: 1 | -1) => {
    const n = (inflight.get(key) ?? 0) + d;
    if (n > 0) inflight.set(key, n);
    else inflight.delete(key);
    set({ busy: new Set(inflight.keys()) });
  };
  async function act<T>(key: string, call: () => Promise<T>): Promise<T> {
    mark(key, 1);
    try {
      const r = await call();
      set({ last: { ...v.last, [key]: r } });
      return r;
    } finally {
      mark(key, -1);
    }
  }

  function configure(): void {
    const k = useStore.getState().settings?.apiKeys;
    const next = { origin: k?.scoutUrl, token: k?.scoutToken };
    const r = registration.configure(next);
    occurrence.configure(next);
    reconciliation.configure(next);
    gen++;
    set({
      configured: !k?.scoutUrl
        ? { ok: false, reason: "none" }
        : r.ok
          ? { ok: true, origin: r.origin }
          : { ok: false, reason: r.reason },
      authority: null,
      handshake: "idle",
    });
  }
  configure();
  const unsubscribe = useStore.subscribe((s, prev) => {
    const a = s.settings?.apiKeys;
    const b = prev.settings?.apiKeys;
    if (a?.scoutUrl !== b?.scoutUrl || a?.scoutToken !== b?.scoutToken) configure();
  });

  async function handshake(): Promise<HandshakeResult> {
    const g = gen;
    set({ handshake: "busy" });
    let done = false;
    try {
      const r = await act("handshake", async () => ({
        registration: await registration.handshake(),
        occurrence: await occurrence.handshake(),
        reconciliation: await reconciliation.handshake(),
      }));
      done = true;
      if (g === gen) {
        const reg = r.registration;
        const bad = [reg, r.occurrence, r.reconciliation].find(
          (x): x is Extract<HandshakeResult, { ok: false }> => !x.ok,
        );
        set({
          // Only a handshake all three controllers accepted enables the cloud buttons (DT-7C-3B fix round).
          authority:
            reg.ok && !bad
              ? { origin: reg.authority.origin, ownerKey: reg.authority.ownerKey }
              : null,
          handshake: !bad
            ? "ok"
            : bad.reason === "uncertain"
              ? { uncertain: bad.reason }
              : { refused: bad.reason },
        });
      }
      return r.registration;
    } finally {
      // Controllers never throw by contract; if one did, the view must not stay busy.
      if (!done && v.handshake === "busy") set({ handshake: "idle" });
    }
  }

  const lifecycle = (kind: "register" | "unregister", workflowId: string): Lifecycle =>
    act(`wf:${workflowId}`, async () => {
      const a = v.authority;
      if (!a) return refuse("no_authority");
      // Unregister binds only the verified stored proof (epoch, revision, digest): it never needs the local workflow,
      // so a workflow deleted here while on the cloud can still be taken off. The placeholders below only satisfy the
      // builder's input validation; it ignores them for unregister and they are never sent.
      const wf =
        kind === "register"
          ? useStore.getState().workflows.find((w) => w.id === workflowId)
          : { id: workflowId, revision: 1 };
      if (!wf) return refuse("missing");
      const regs = await deps.readRegistrations();
      if (!regs) return refuse("unreadable");
      const digest =
        kind === "register" ? ((await workflowDigestOf(wf as Workflow)) ?? "") : UNUSED_DIGEST;
      const b = lifecycleRequestFor(kind, regs, a, wf, digest);
      if (!b.ok) return refuse(b.reason);
      return kind === "register"
        ? registration.register(b.request)
        : registration.unregister(b.request, b.digest);
    });

  function authorityFor(workflowId: string): Authority | null {
    if (!v.configured.ok) return null;
    const origin = v.configured.origin;
    const owner = v.authority?.ownerKey;
    const list = registrationViews().filter(
      (r) => r.workflowId === workflowId && r.origin === origin && (!owner || r.ownerKey === owner),
    );
    return list.length === 1 ? { origin, ownerKey: list[0].ownerKey } : null;
  }

  return {
    view: () => v,
    subscribe(cb) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    handshake,
    register: (id) => lifecycle("register", id),
    unregister: (id) => lifecycle("unregister", id),
    recover: (id) =>
      act(`wf:${id}`, async () => {
        const a = v.authority;
        if (!a) return refuse("no_authority");
        const key = registrationKey(a, id);
        return key ? registration.recover(key) : refuse("invalid_request");
      }),
    submit: (key) => act(key, () => occurrence.submit(key)),
    status: (key) => act(key, () => occurrence.status(key)),
    run: (key) => act(key, () => occurrence.run(key)),
    cancel: (key) => act(key, () => occurrence.cancel(key)),
    reconcile: (opts) => act("reconcile", () => reconciliation.reconcile(opts)),
    check: (key) => act(key, () => reconciliation.check(key)),
    ack: (key) => act(key, () => reconciliation.ack(key)),
    authorityFor,
    captureAuthority(workflowId) {
      const a = authorityFor(workflowId);
      return a ? { origin: a.origin, ownerKey: a.ownerKey } : null;
    },
    registrations: registrationViews,
    counts,
    cloudRuns,
    deliverable: () => deliverableOf(readReconciliation(useStore.getState().cloudReconciliation)),
    leave() {
      for (const c of all) c.invalidateVisit();
      gen++;
      set({ authority: null, handshake: "idle" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      gen++;
      for (const c of all) c.dispose();
      set({ configured: { ok: false, reason: "disposed" }, authority: null, handshake: "idle" });
      deps.onDispose?.();
    },
  };
}

const noBrowser = async () => refuse("no-browser");
const INERT_VIEW: CloudHubView = {
  configured: { ok: false, reason: "none" },
  authority: null,
  handshake: "idle",
  busy: new Set(),
  last: {},
};
/** Without a browser (server render): nothing to configure, nothing to send. */
const INERT: CloudHub = {
  view: () => INERT_VIEW,
  subscribe: () => () => undefined,
  handshake: async () => ({ ok: false, reason: "no-browser" }),
  register: noBrowser,
  unregister: noBrowser,
  recover: noBrowser,
  submit: noBrowser,
  status: noBrowser,
  run: noBrowser,
  cancel: noBrowser,
  reconcile: noBrowser,
  check: noBrowser,
  ack: noBrowser,
  authorityFor: () => null,
  captureAuthority: () => null,
  registrations: () => [],
  counts: () => ({
    registrations: null,
    proofs: null,
    tombstones: null,
    pending: null,
    runs: null,
    journal: null,
  }),
  cloudRuns: () => [],
  deliverable: () => [],
  leave: () => undefined,
  dispose: () => undefined,
};

let hub: CloudHub | null = null;

/** The browser's one hub, created on first call (never at import); inert without a browser. */
export function cloudHub(): CloudHub {
  if (typeof window === "undefined") return INERT;
  if (hub) return hub;
  // A plain function, never a method reference (the session calls `fetch` unbound).
  const fetch: ClientFetch = (url, init) => window.fetch(url, init);
  const onHide = () => {
    invalidateCloudVisit();
    h.dispose();
  };
  const h = createCloudHub({
    registration: createRegistrationController({
      fetch,
      persistence: cloudRegistrationPersistence,
    }),
    occurrence: createOccurrenceController({ fetch, persistence: cloudOccurrencePersistence }),
    reconciliation: createReconciliationController({
      fetch,
      persistence: cloudReconciliationPersistence,
    }),
    readRegistrations: () => cloudRegistrationPersistence.read(),
    onDispose: () => {
      window.removeEventListener("pagehide", onHide);
      if (hub === h) hub = null;
    },
  });
  window.addEventListener("pagehide", onHide);
  return (hub = h);
}

/** Leaving the Workflows screen: the store visit fence moves; an existing hub invalidates its controllers' visits. */
export function leaveCloudScreen(): void {
  invalidateCloudVisit();
  hub?.leave();
}
