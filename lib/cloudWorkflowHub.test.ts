// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientFetch } from "./cloudWorkflowClient";
import { workflowDigestOf } from "./cloudWorkflowCapture";
import { authorityOf, parseAnswer, type CloudRequest } from "./cloudWorkflowProtocol";
import { emptyReconciliation, type CloudReconciliation } from "./cloudWorkflowReconciliation";
import {
  createIntent,
  emptyRegistrations,
  prepareIntent,
  recordOutcome,
  registrationKey,
  reserveAttempt,
} from "./cloudWorkflowRegistration";
import { cloudFence, savesSettled, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import type { Workflow } from "./domain";

// ⚙️ DT-7C-3A browser hub (planning/tools/38-cloud-workflows.md): lazy singleton, one settings subscription, explicit
// handshake only, exactly one controller call per action, pagehide dispose. Fake controllers; one wiring test uses the
// real controllers with a fake fetch (no network).

const made = vi.hoisted(() => ({ reg: 0, occ: 0, rec: 0 }));
/** Every real controller the mocked factories built, in order. */
type Built = { dispose(): void; configure(n: never): unknown };
const built = vi.hoisted(() => [] as Built[]);
const keep = vi.hoisted(
  () =>
    <T extends Built>(c: T): T => (built.push(c), c),
);
vi.mock("./cloudWorkflowRegistrationClient", async (orig) => {
  const m = await orig<typeof import("./cloudWorkflowRegistrationClient")>();
  return {
    ...m,
    createRegistrationController: (d: Parameters<typeof m.createRegistrationController>[0]) => {
      made.reg++;
      return keep(m.createRegistrationController(d));
    },
  };
});
vi.mock("./cloudWorkflowOccurrenceClient", async (orig) => {
  const m = await orig<typeof import("./cloudWorkflowOccurrenceClient")>();
  return {
    ...m,
    createOccurrenceController: (d: Parameters<typeof m.createOccurrenceController>[0]) => {
      made.occ++;
      return keep(m.createOccurrenceController(d));
    },
  };
});
vi.mock("./cloudWorkflowReconciliationClient", async (orig) => {
  const m = await orig<typeof import("./cloudWorkflowReconciliationClient")>();
  return {
    ...m,
    createReconciliationController: (d: Parameters<typeof m.createReconciliationController>[0]) => {
      made.rec++;
      return keep(m.createReconciliationController(d));
    },
  };
});

const { cloudHub, createCloudHub, deliverableOf, leaveCloudScreen } =
  await import("./cloudWorkflowHub");

const S = () => useStore.getState();
const TOKEN = "hub-token-CANARY-7c3a";
const A = "https://scout.test";
const B = "https://other.test";
const OWNER = "wfo_" + "a".repeat(32);
const AUTH = authorityOf(A, OWNER)!;
async function addWf(): Promise<Workflow> {
  const r = await S().addWorkflow(
    { name: { ar: "", en: "Hub" }, trigger: { kind: "manual" }, actions: [] },
    new Date("2026-10-18T07:00:00.000Z"),
  );
  if (!r.ok) throw new Error(r.reason);
  return r.workflow;
}

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
const setOrigin = (scoutUrl: string, scoutToken = TOKEN) =>
  S().setSettings({ apiKeys: { scoutUrl, scoutToken } });

/** Fake controllers: every method a spy resolving a tagged result. */
function fakes(handshake: { ok: true; authority: typeof AUTH } | { ok: false; reason: string }) {
  const ctl = () => ({
    configure: vi.fn((n: { origin: unknown }) =>
      typeof n.origin === "string" && n.origin.startsWith("https://")
        ? { ok: true as const, origin: n.origin }
        : { ok: false as const, reason: "origin" as const },
    ),
    invalidateVisit: vi.fn(),
    dispose: vi.fn(),
    handshake: vi.fn(async () => handshake),
  });
  const tag = (m: string) => vi.fn(async (...args: unknown[]) => ({ kind: "fake", m, args }));
  return {
    registration: {
      ...ctl(),
      register: tag("register"),
      unregister: tag("unregister"),
      recover: tag("recover"),
    },
    occurrence: {
      ...ctl(),
      submit: tag("submit"),
      status: tag("status"),
      run: tag("run"),
      cancel: tag("cancel"),
    },
    reconciliation: { ...ctl(), reconcile: tag("reconcile"), check: tag("check"), ack: tag("ack") },
  };
}
type Fakes = ReturnType<typeof fakes>;
const hubOf = (f: Fakes, regs = emptyRegistrations()) =>
  createCloudHub({
    registration: f.registration as never,
    occurrence: f.occurrence as never,
    reconciliation: f.reconciliation as never,
    readRegistrations: async () => regs,
  });
const calls = (f: Fakes) =>
  Object.values(f).flatMap((c) =>
    Object.entries(c)
      .filter(([k]) => k !== "configure")
      .flatMap(([k, fn]) => (fn as ReturnType<typeof vi.fn>).mock.calls.map(() => k)),
  );

beforeEach(() => {
  localStorage.clear();
  setArticlesLock(queueLock());
  setOrigin(A);
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
});
afterEach(async () => {
  window.dispatchEvent(new Event("pagehide")); // disposes the singleton if one exists (never creates one)
  await savesSettled();
  setArticlesLock(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("construction and configuration", () => {
  it("is lazy: importing builds nothing; the first cloudHub() builds exactly one of each", async () => {
    vi.resetModules(); // a fresh module instance: independent of test order
    const at = () => ({ ...made });
    const before = at();
    const fresh = await import("./cloudWorkflowHub");
    expect(at()).toEqual(before);
    const h = fresh.cloudHub();
    expect(fresh.cloudHub()).toBe(h);
    expect(at()).toEqual({ reg: before.reg + 1, occ: before.occ + 1, rec: before.rec + 1 });
    h.dispose();
  });

  it("configures all three on creation and on every origin/token transition A→B→A (3 calls), no other call", () => {
    const f = fakes({ ok: false, reason: "x" });
    const h = hubOf(f);
    setOrigin(B);
    S().setSettings({ apiKeys: { scoutUrl: B, scoutToken: TOKEN } }); // not a transition
    setOrigin(A);
    for (const c of Object.values(f)) {
      expect(c.configure.mock.calls.map(([n]) => n)).toEqual([
        { origin: A, token: TOKEN },
        { origin: B, token: TOKEN },
        { origin: A, token: TOKEN },
      ]);
    }
    expect(calls(f)).toEqual([]);
    setOrigin("");
    expect(h.view().configured).toEqual({ ok: false, reason: "none" });
    h.dispose();
    setOrigin(B); // unsubscribed
    expect(f.registration.configure).toHaveBeenCalledTimes(4);
  });

  it("never keeps the token in the view", async () => {
    const f = fakes({ ok: true, authority: AUTH });
    const h = hubOf(f);
    await h.handshake();
    await h.submit("k1");
    expect(JSON.stringify(h.view())).not.toContain(TOKEN);
  });
});

describe("handshake and actions", () => {
  it("handshake is explicit: one call per controller, sets authority; a config change clears it", async () => {
    const f = fakes({ ok: true, authority: AUTH });
    const h = hubOf(f);
    expect(h.view()).toMatchObject({ authority: null, handshake: "idle" });
    const seen: string[] = [];
    h.subscribe(() => seen.push(String(JSON.stringify(h.view().handshake))));
    await h.handshake();
    expect(calls(f)).toEqual(["handshake", "handshake", "handshake"]);
    expect(h.view()).toMatchObject({ authority: { origin: A, ownerKey: OWNER }, handshake: "ok" });
    expect(seen).toContain('"busy"');
    expect(h.authorityFor("w1")).toBeNull(); // no registration record yet
    setOrigin(B);
    expect(h.view()).toMatchObject({ authority: null, handshake: "idle" });
  });

  it("a refused or uncertain handshake is reported, authority stays null", async () => {
    const h = hubOf(fakes({ ok: false, reason: "network" }));
    await h.handshake();
    expect(h.view()).toMatchObject({ authority: null, handshake: { refused: "network" } });
    const u = hubOf(fakes({ ok: false, reason: "uncertain" }));
    await u.handshake();
    expect(u.view().handshake).toEqual({ uncertain: "uncertain" });
  });

  it("a handshake only one controller accepts sets no authority (DT-7C-3B fix round) and reports that refusal", async () => {
    const f = fakes({ ok: true, authority: AUTH });
    f.reconciliation.handshake.mockResolvedValueOnce({ ok: false, reason: "answer" } as never);
    const h = hubOf(f);
    await h.handshake();
    expect(h.view()).toMatchObject({ authority: null, handshake: { refused: "answer" } });
    await h.handshake();
    expect(h.view()).toMatchObject({ authority: AUTH, handshake: "ok" });
  });

  it("each occurrence/reconciliation action is exactly one controller call, busy while in flight, result kept", async () => {
    const f = fakes({ ok: true, authority: AUTH });
    const h = hubOf(f);
    const cases = [
      ["submit", "occurrence"],
      ["status", "occurrence"],
      ["run", "occurrence"],
      ["cancel", "occurrence"],
      ["check", "reconciliation"],
      ["ack", "reconciliation"],
    ] as const;
    for (const [m, owner] of cases) {
      const before = calls(f).length;
      const p = h[m]("key-" + m);
      expect(h.view().busy.has("key-" + m)).toBe(true);
      const r = await p;
      expect(h.view().busy.has("key-" + m)).toBe(false);
      expect(r).toEqual({ kind: "fake", m, args: ["key-" + m] });
      expect(h.view().last["key-" + m]).toBe(r);
      expect(calls(f).length).toBe(before + 1);
      expect((f[owner] as Record<string, unknown>)[m]).toHaveBeenCalledTimes(1);
    }
    const r = await h.reconcile({ limit: 50 });
    expect(r).toEqual({ kind: "fake", m: "reconcile", args: [{ limit: 50 }] });
    expect(h.view().last.reconcile).toBe(r);
    expect(calls(f)).toHaveLength(7); // no chained or retried call
  });

  it("register/unregister build the request from the stored workflow; recover sends the registration key", async () => {
    const wf = await addWf();
    const f = fakes({ ok: true, authority: AUTH });
    const h = hubOf(f);
    expect(await h.register(wf.id)).toEqual({
      kind: "refused",
      reason: "no_authority",
      dispatched: false,
    });
    await h.handshake();
    const digest = await workflowDigestOf(wf);
    const r = await h.register(wf.id);
    expect(f.registration.register).toHaveBeenCalledTimes(1);
    expect(f.registration.register.mock.calls[0][0]).toEqual({
      kind: "register",
      ownerKey: OWNER,
      workflowId: wf.id,
      expectedEpoch: 0,
      revision: wf.revision,
      workflowDigest: digest,
    });
    expect(h.view().last[`wf:${wf.id}`]).toBe(r);
    // Builder refusal (no active proof): returned as the action result, no controller call.
    expect(await h.unregister(wf.id)).toEqual({
      kind: "refused",
      reason: "inactive",
      dispatched: false,
    });
    expect(f.registration.unregister).not.toHaveBeenCalled();
    expect(await h.register("nope")).toEqual({
      kind: "refused",
      reason: "missing",
      dispatched: false,
    });
    await h.recover(wf.id);
    expect(f.registration.recover.mock.calls).toEqual([[registrationKey(AUTH, wf.id)]]);
    expect(f.registration.register).toHaveBeenCalledTimes(1);
  });

  it("an unreadable registrations slice refuses register without a controller call", async () => {
    const wf = await addWf();
    const f = fakes({ ok: true, authority: AUTH });
    const h = createCloudHub({
      registration: f.registration as never,
      occurrence: f.occurrence as never,
      reconciliation: f.reconciliation as never,
      readRegistrations: async () => null,
    });
    await h.handshake();
    expect(await h.register(wf.id)).toEqual({
      kind: "refused",
      reason: "unreadable",
      dispatched: false,
    });
    expect(f.registration.register).not.toHaveBeenCalled();
  });

  it("a stale handshake (config moved, or leave(), during the call) never installs its authority", async () => {
    for (const move of ["config", "leave"] as const) {
      setOrigin(A);
      const f = fakes({ ok: true, authority: AUTH });
      let release = (): void => undefined;
      f.registration.handshake.mockImplementationOnce(
        () =>
          new Promise((res) => {
            release = () => res({ ok: true, authority: AUTH });
          }),
      );
      const h = hubOf(f);
      const p = h.handshake();
      expect(h.view().handshake).toBe("busy");
      if (move === "config") setOrigin(B);
      else h.leave();
      release();
      expect(await p).toEqual({ ok: true, authority: AUTH });
      expect(h.view()).toMatchObject({ authority: null, handshake: "idle" });
      expect(h.view().busy.size).toBe(0);
      h.dispose();
    }
  });

  it("busy counts per key: different keys clear independently; one key stays busy until both settle", async () => {
    const f = fakes({ ok: true, authority: AUTH });
    const h = hubOf(f);
    const gate = () => {
      let open = (): void => undefined;
      const p = new Promise<void>((r) => (open = r));
      return { p, open: () => open() };
    };
    const [g1, g2, g3] = [gate(), gate(), gate()];
    const held =
      (g: { p: Promise<void> }, m: string) =>
      async (...args: unknown[]) => {
        await g.p;
        return { kind: "fake", m, args };
      };
    f.occurrence.submit.mockImplementationOnce(held(g1, "submit"));
    f.occurrence.status.mockImplementationOnce(held(g2, "status"));
    f.occurrence.run.mockImplementationOnce(held(g3, "run"));
    const busy = () => [...h.view().busy].sort();
    const p1 = h.submit("k1");
    const p2 = h.status("k2");
    const p3 = h.run("k2");
    expect(busy()).toEqual(["k1", "k2"]);
    g1.open();
    await p1;
    expect(busy()).toEqual(["k2"]);
    g2.open();
    await p2;
    expect(busy()).toEqual(["k2"]); // the second k2 action is still in flight
    g3.open();
    await p3;
    expect(busy()).toEqual([]);
    expect(h.view().last.k2).toEqual({ kind: "fake", m: "run", args: ["k2"] });
  });

  it("unregister needs no local workflow: a registered workflow deleted here can still be taken off", async () => {
    const DIG = "d".repeat(64);
    const at = "2026-10-18T01:00:00.000Z";
    const req = {
      kind: "register",
      ownerKey: OWNER,
      workflowId: "w9",
      expectedEpoch: 0,
      revision: 1,
      workflowDigest: DIG,
    } as CloudRequest;
    const p = prepareIntent(req, AUTH);
    if (!p.ok) throw new Error(p.reason);
    const c = createIntent(emptyRegistrations(), p, "op-1", at);
    if (!c.ok) throw new Error(c.reason);
    const r = reserveAttempt(c.next, p.key, c.record.intent);
    if (!r.ok) throw new Error(r.reason);
    const answer = {
      status: 200,
      body: {
        ownerKey: OWNER,
        registration: {
          workflowId: "w9",
          registrationEpoch: 1,
          revision: 1,
          workflowDigest: DIG,
          state: "active",
          paused: false,
          updatedAt: at,
          epochs: [{ epoch: 1, openedAt: at }],
        },
        created: true,
      },
    };
    const parsed = await parseAnswer(req, answer, { origin: A });
    const o = recordOutcome(r.next, p.key, "op-1", r.attempt, { kind: "answer", answer, parsed });
    if (!o.changed) throw new Error(o.reason);
    expect(S().workflows.some((w) => w.id === "w9")).toBe(false);
    // DT-7C-3B fix round: the view carries isUnresolved(intent): a dispatching attempt is unresolved, a settled one not.
    const prev = S().cloudRegistrations;
    try {
      useStore.setState({ cloudRegistrations: r.next });
      expect(hubOf(fakes({ ok: false, reason: "x" })).registrations()).toMatchObject([
        { workflowId: "w9", state: "dispatching", unresolved: true, proof: null },
      ]);
      useStore.setState({ cloudRegistrations: o.next });
      expect(hubOf(fakes({ ok: false, reason: "x" })).registrations()).toMatchObject([
        { workflowId: "w9", state: "settled", unresolved: false, proof: "active" },
      ]);
    } finally {
      useStore.setState({ cloudRegistrations: prev });
    }
    const f = fakes({ ok: true, authority: AUTH });
    const h = hubOf(f, o.next);
    await h.handshake();
    await h.unregister("w9");
    expect(f.registration.unregister.mock.calls).toEqual([
      [
        {
          kind: "unregister",
          ownerKey: OWNER,
          workflowId: "w9",
          registrationEpoch: 1,
          expectedRevision: 1,
        },
        DIG,
      ],
    ]);
    // Register still needs the local workflow.
    expect(await h.register("w9")).toEqual({
      kind: "refused",
      reason: "missing",
      dispatched: false,
    });
  });

  it("read-only selectors parse the stored slices (empty store: zero counts, no runs)", () => {
    const h = hubOf(fakes({ ok: false, reason: "x" }));
    expect(h.registrations()).toEqual([]);
    expect(h.counts()).toEqual({
      registrations: 0,
      proofs: 0,
      tombstones: 0,
      pending: 0,
      runs: 0,
      journal: 0,
    });
    expect(h.cloudRuns()).toEqual([]);
    expect(h.deliverable()).toEqual([]);
    expect(h.captureAuthority("w1")).toBeNull();
  });

  it("deliverable (DT-7C-3B): terminal, no collision, not retired, not acknowledged; null slice gives none", () => {
    const proof = (key: string, state: string, extra: object = {}) => ({
      key,
      occurrenceId: key,
      workflowId: "w1",
      outputs: [] as { disposition: string }[],
      receipt: { state, receiptVersion: 3, ackedVersion: 0 },
      ...extra,
    });
    const rec = {
      ...emptyReconciliation(),
      proofs: [
        proof("done", "done"),
        proof("running", "running"),
        proof("acked", "partial", {
          receipt: { state: "partial", receiptVersion: 3, ackedVersion: 3 },
        }),
        proof("clash", "failed", { outputs: [{ disposition: "collision" }] }),
        proof("gone", "cancelled"),
      ],
      tombstones: [{ key: "gone" }],
    } as unknown as CloudReconciliation;
    expect(deliverableOf(rec)).toEqual([
      { key: "done", occurrenceId: "done", workflowId: "w1", state: "done" },
    ]);
    expect(deliverableOf(null)).toEqual([]);
  });
});

describe("singleton wiring, fences and teardown", () => {
  it("real controllers: zero fetch at creation and on configure; the explicit handshake is the first request", async () => {
    const sent: string[] = [];
    const fake: ClientFetch = async (url) => {
      sent.push(url);
      throw new TypeError("offline");
    };
    vi.stubGlobal("fetch", fake);
    const h = cloudHub();
    setOrigin(B);
    setOrigin(A);
    await Promise.resolve();
    expect(sent).toEqual([]);
    await h.handshake();
    expect(sent).toHaveLength(3);
    expect(sent.every((u) => u.startsWith(A + "/"))).toBe(true);
    expect(h.view()).toMatchObject({ authority: null, handshake: { uncertain: "uncertain" } });
    expect(JSON.stringify(h.view())).not.toContain(TOKEN);
  });

  it("pagehide moves the visit fence and disposes all three; no configure follows; the next hub is fresh", () => {
    const from = built.length;
    const h = cloudHub();
    const ctls = built.slice(from);
    expect(ctls).toHaveLength(3);
    const spies = ctls.map((c) => ({
      dispose: vi.spyOn(c, "dispose"),
      configure: vi.spyOn(c, "configure"),
    }));
    const visit = cloudFence().visit;
    window.dispatchEvent(new Event("pagehide"));
    expect(cloudFence().visit).toBe(visit + 1);
    expect(h.view().configured).toEqual({ ok: false, reason: "disposed" });
    for (const sp of spies) expect(sp.dispose).toHaveBeenCalledTimes(1);
    setOrigin(B); // unsubscribed: no configure follows
    for (const sp of spies) expect(sp.configure).not.toHaveBeenCalled();
    expect(cloudHub()).not.toBe(h);
  });

  it("leaveCloudScreen moves the store visit fence and never creates a hub", () => {
    const visit = cloudFence().visit;
    const before = { ...made };
    leaveCloudScreen();
    expect(cloudFence().visit).toBe(visit + 1);
    expect(made).toEqual(before);
  });

  it("leave() invalidates every controller visit and clears the authority (no request)", async () => {
    const f = fakes({ ok: true, authority: AUTH });
    const h = hubOf(f);
    await h.handshake();
    h.leave();
    expect(h.view()).toMatchObject({ authority: null, handshake: "idle" });
    for (const c of Object.values(f)) expect(c.invalidateVisit).toHaveBeenCalledTimes(1);
    expect(calls(f).filter((k) => k !== "invalidateVisit")).toEqual([
      "handshake",
      "handshake",
      "handshake",
    ]);
  });

  it("without a browser the hub is inert and every action refuses no-browser", async () => {
    vi.stubGlobal("window", undefined);
    const h = cloudHub();
    expect(await h.submit("k")).toEqual({
      kind: "refused",
      reason: "no-browser",
      dispatched: false,
    });
    expect(await h.register("w1")).toEqual({
      kind: "refused",
      reason: "no-browser",
      dispatched: false,
    });
    expect(await h.handshake()).toEqual({ ok: false, reason: "no-browser" });
    expect(h.view().configured).toEqual({ ok: false, reason: "none" });
    expect(h.counts()).toEqual({
      registrations: null,
      proofs: null,
      tombstones: null,
      pending: null,
      runs: null,
      journal: null,
    });
    vi.unstubAllGlobals();
  });
});
