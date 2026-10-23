// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRegistrations } from "@/lib/cloudWorkflowRegistration";
import type { Workflow } from "@/lib/domain";
import { setArticlesLock, useStore, type ArticlesLock, type CloudJournalView } from "@/store";
import { CloudResultsCard, WorkflowCloudCard } from "./WorkflowCloud";
import WorkflowsScreen from "./WorkflowsScreen";

// ⚙️ DT-7C-3B: the Workflows screen's cloud wiring over a FAKE hub (vi.mock) and faked store capture actions. Each
// button is exactly one hub/store call with the right key; buttons are disabled while their key is busy; nothing is
// called at mount; the token never reaches the DOM; local workflows keep today's Run now.

const A = "https://cloud.test";
const OWNER = "wfo_" + "a".repeat(32);
const AUTH = { origin: A, ownerKey: OWNER };
const TOKEN = "TOKEN-CANARY-3b";

const fake = vi.hoisted(() => {
  const subs = new Set<() => void>();
  const s = {
    view: {} as Record<string, unknown>,
    regs: [] as Record<string, unknown>[],
    counts: {} as Record<string, number | null>,
    runs: [] as Record<string, unknown>[],
    deliverable: [] as Record<string, unknown>[],
    capture: null as null | { origin: string; ownerKey: string },
    journal: [] as unknown[],
    /** When set, the stored proofs read as these key -> receiptVersion pairs (the 3D fix round). */
    versions: null as null | Record<string, number>,
  };
  const action = () => vi.fn(async (): Promise<unknown> => ({}));
  const hub = {
    view: () => s.view,
    subscribe: vi.fn((cb: () => void) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    }),
    handshake: action(),
    register: action(),
    unregister: action(),
    recover: action(),
    submit: action(),
    status: action(),
    run: action(),
    cancel: action(),
    reconcile: action(),
    check: action(),
    ack: action(),
    authorityFor: vi.fn(() => s.capture),
    captureAuthority: vi.fn(() => s.capture),
    registrations: () => s.regs,
    counts: () => s.counts,
    cloudRuns: () => s.runs,
    deliverable: () => s.deliverable,
    leave: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    s,
    subs,
    hub,
    cloudHub: vi.fn(() => hub),
    leaveCloudScreen: vi.fn(),
    loadCloudJournal: vi.fn(async () => ({
      ok: true,
      generation: 1,
      suppression: { epoch: 0, resetAt: null, commitId: null },
      entries: s.journal,
    })),
  };
});
vi.mock("@/lib/cloudWorkflowHub", () => ({
  cloudHub: fake.cloudHub,
  leaveCloudScreen: fake.leaveCloudScreen,
}));
vi.mock("@/lib/cloudWorkflowReconciliation", async (orig) => {
  const real = await orig<typeof import("@/lib/cloudWorkflowReconciliation")>();
  return {
    ...real,
    readReconciliation: (v: unknown) =>
      fake.s.versions
        ? ({
            // Whole enough for the store’s own save path, which parses this slice too.
            v: 1,
            generation: 1,
            commitId: "fake",
            authorities: [],
            tombstones: [],
            pending: [],
            runs: [],
            proofs: Object.entries(fake.s.versions).map(([key, receiptVersion]) => ({
              key,
              outputs: [],
              receipt: { receiptVersion },
            })),
          } as unknown as ReturnType<typeof real.readReconciliation>)
        : real.readReconciliation(v),
  };
});
vi.mock("@/store", async (orig) => ({
  ...(await orig<typeof import("@/store")>()),
  loadCloudJournal: fake.loadCloudJournal,
}));

const ACTIONS = [
  "handshake",
  "register",
  "unregister",
  "recover",
  "submit",
  "status",
  "run",
  "cancel",
  "reconcile",
  "check",
  "ack",
] as const;
type Act = (typeof ACTIONS)[number];
const fn = (k: Act) => fake.hub[k] as ReturnType<typeof vi.fn>;
const called = () => ACTIONS.filter((k) => fn(k).mock.calls.length > 0);

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let saved: Record<string, unknown>;
const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const $$ = (testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const btn = (testId: string) => $(testId) as HTMLButtonElement;

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (f) => {
    const run = tail.then(f);
    tail = run.catch(() => undefined);
    return run;
  };
};

function setView(patch: Record<string, unknown> = {}): void {
  fake.s.view = {
    configured: { ok: true, origin: A },
    authority: AUTH,
    handshake: "ok",
    busy: new Set<string>(),
    last: {},
    ...patch,
  };
  for (const cb of [...fake.subs]) cb();
}
const notify = () => act(async () => setView(fake.s.view));
const reg = (workflowId: string, over: Record<string, unknown> = {}) => ({
  key: `k-${workflowId}`,
  workflowId,
  origin: A,
  ownerKey: OWNER,
  state: "settled",
  proof: "active",
  paused: false,
  unresolved: false,
  ...over,
});
const entry = (workflowId: string, over: Partial<CloudJournalView> = {}): CloudJournalView => ({
  key: `["${A}","${OWNER}","occ-1"]`,
  origin: A,
  ownerKey: OWNER,
  occurrenceId: "occ-1",
  workflowId,
  executionAt: "2026-10-22T09:00:00.000Z",
  payloadDigest: "d".repeat(64),
  commitId: "c1",
  state: "queued",
  observed: null,
  observationRejected: false,
  ...over,
});

async function click(testId: string, index = 0): Promise<void> {
  await act(async () => $$(testId)[index]!.click());
}
async function until(f: () => void, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    await act(() => new Promise<void>((r) => setTimeout(r, 20)));
    try {
      f();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
  }
}
async function addWf(trigger: Workflow["trigger"]["kind"] = "manual"): Promise<Workflow> {
  const r = await S().addWorkflow({
    name: { ar: "يومي", en: "Daily" },
    trigger: { kind: trigger },
    actions: [{ id: "i1", kind: "idea", text: { ar: "فكرة", en: "Idea" } }],
  });
  if (!r.ok) throw new Error(r.reason);
  return r.workflow;
}
async function card(id: string, lang: "ar" | "en" = "en", captured: string | null = null) {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(WorkflowCloudCard, { id, locked: false, captured }));
  });
  await until(() => expect(fake.loadCloudJournal).toHaveBeenCalled());
}
async function screen(hash = "", lang: "ar" | "en" = "en") {
  history.replaceState(null, "", `/social/workflows/${hash}`);
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(WorkflowsScreen));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  fake.s.versions = null;
  fetchSpy = vi.spyOn(globalThis, "fetch");
  localStorage.clear();
  S().reset();
  setArticlesLock(queueLock());
  saved = { captureManualRun: S().captureManualRun, runWorkflowNow: S().runWorkflowNow };
  Object.assign(fake.s, {
    regs: [],
    counts: { registrations: 0, proofs: 0, tombstones: 0, pending: 0, runs: 0, journal: 0 },
    runs: [],
    deliverable: [],
    capture: null,
    journal: [],
    versions: null,
  });
  setView();
  for (const k of ACTIONS) fn(k).mockClear();
  fake.hub.subscribe.mockClear();
  fake.leaveCloudScreen.mockClear();
  fake.loadCloudJournal.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(fetchSpy).not.toHaveBeenCalled();
  useStore.setState(saved);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setArticlesLock(undefined);
  S().setSettings({ lang: "ar" });
});

describe("mount: no request, no token", () => {
  it("list and editor call no hub action at mount; subscribe yes; leaving calls leaveCloudScreen once", async () => {
    S().setSettings({ apiKeys: { scoutUrl: A, scoutToken: TOKEN } });
    const w = await addWf();
    fake.s.regs = [reg(w.id)];
    fake.s.journal = [entry(w.id)];
    fake.s.deliverable = [{ key: "p1", occurrenceId: "o", workflowId: w.id, state: "done" }];
    await screen();
    expect($("workflow-cloud-results")).not.toBeNull();
    history.replaceState(null, "", `/social/workflows/#w=${w.id}`);
    await act(async () => window.dispatchEvent(new Event("hashchange")));
    await until(() => expect($("workflow-cloud-card")).not.toBeNull());
    await until(() => expect($("workflow-cloud-entry")).not.toBeNull());
    expect(called()).toEqual([]);
    expect(fake.hub.subscribe).toHaveBeenCalled();
    expect(fake.leaveCloudScreen).not.toHaveBeenCalled();
    expect(host.innerHTML).not.toContain(TOKEN);
    act(() => root.unmount());
    expect(fake.leaveCloudScreen).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it("a pageshow re-subscribes to the (fresh) hub", async () => {
    await card("w1");
    const before = fake.hub.subscribe.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(fake.hub.subscribe.mock.calls.length).toBe(before + 1);
    expect(called()).toEqual([]);
  });
});

describe("Cloud card state chip", () => {
  const cases: [string, () => void, string, string][] = [
    ["no record", () => undefined, "local", "On this device only"],
    ["active proof", () => (fake.s.regs = [reg("w1")]), "active", "On cloud"],
    ["paused", () => (fake.s.regs = [reg("w1", { paused: true })]), "paused", "Paused on cloud"],
    [
      "other origin",
      () => (fake.s.regs = [reg("w1", { origin: "https://other.test" })]),
      "another",
      "Belongs to another Worker",
    ],
    [
      "other owner after the handshake",
      () => (fake.s.regs = [reg("w1", { ownerKey: "wfo_" + "b".repeat(32) })]),
      "another",
      "Belongs to another Worker",
    ],
    [
      "unresolved intent",
      () => (fake.s.regs = [reg("w1", { state: "uncertain", unresolved: true })]),
      "unresolved",
      "Unclear — recover first",
    ],
    [
      "divergent, maybe applied (isUnresolved)",
      () => (fake.s.regs = [reg("w1", { state: "divergent", unresolved: true, proof: null })]),
      "unresolved",
      "Unclear — recover first",
    ],
    [
      "divergent, not applied, active proof (accepts a new intent)",
      () => (fake.s.regs = [reg("w1", { state: "divergent", unresolved: false })]),
      "active",
      "On cloud",
    ],
    [
      "divergent, not applied, no proof",
      () => (fake.s.regs = [reg("w1", { state: "divergent", unresolved: false, proof: null })]),
      "local",
      "On this device only",
    ],
    [
      "two owners at the configured origin before the handshake (exactly-one rule)",
      () => {
        setView({ authority: null, handshake: "idle" });
        fake.s.regs = [reg("w1"), reg("w1", { key: "k2", ownerKey: "wfo_" + "b".repeat(32) })];
      },
      "another",
      "Belongs to another Worker",
    ],
    [
      "a stored record with no Worker in Settings",
      () => {
        setView({ configured: { ok: false, reason: "none" }, authority: null, handshake: "idle" });
        fake.s.regs = [reg("w1")];
      },
      "noWorker",
      "Linked to a Worker — set it in Settings",
    ],
    [
      "refused intent",
      () => (fake.s.regs = [reg("w1", { state: "refused", proof: null, lastRefusal: "capacity" })]),
      "refused",
      "The Worker refused",
    ],
    [
      "unregistered proof",
      () => (fake.s.regs = [reg("w1", { proof: "unregistered" })]),
      "local",
      "On this device only",
    ],
    [
      "capacity",
      () => (fake.s.counts = { ...fake.s.counts, registrations: 100 }),
      "capacity",
      "Cloud is full (100 / 100)",
    ],
  ];
  for (const [name, arrange, state, copy] of cases)
    it(`${name} → ${state}`, async () => {
      arrange();
      await card("w1");
      expect($("workflow-cloud-chip")!.dataset.state).toBe(state);
      expect($("workflow-cloud-chip")!.textContent).toBe(copy);
    });

  it("an id the protocol refuses → unsupported id, no buttons", async () => {
    await card("x".repeat(65));
    expect($("workflow-cloud-chip")!.dataset.state).toBe("unsupported");
    expect($("workflow-cloud-register")).toBeNull();
  });

  it("refused shows the Worker's reason; unresolved shows only Recover; capacity disables Put on cloud", async () => {
    fake.s.regs = [reg("w1", { state: "refused", proof: null, lastRefusal: "capacity" })];
    await card("w1");
    expect($("workflow-cloud-refusal")!.textContent).toBe(
      "Last answer: The limit is reached. Remove an older one first.",
    );
    fake.s.regs = [reg("w1", { state: "pending", unresolved: true })];
    await notify();
    expect($("workflow-cloud-recover")).not.toBeNull();
    expect($("workflow-cloud-register")).toBeNull();
    expect($("workflow-cloud-unregister")).toBeNull();
    fake.s.regs = [];
    fake.s.counts = { ...fake.s.counts, registrations: 100 };
    await notify();
    expect(btn("workflow-cloud-register").disabled).toBe(true);
  });

  it("Arabic copy renders for the chip and the note", async () => {
    fake.s.regs = [reg("w1")];
    await card("w1", "ar");
    expect($("workflow-cloud-chip")!.textContent).toBe("على السحابة");
  });
});

describe("Cloud card buttons", () => {
  it("Put on cloud / Take off cloud / Recover: exactly one hub call each with the workflow id", async () => {
    fn("register").mockResolvedValueOnce({
      kind: "recorded",
      key: "k",
      operationId: "o",
      state: "settled",
      dispatched: true,
      persisted: true,
    });
    await card("w1");
    await click("workflow-cloud-register");
    expect(fn("register").mock.calls).toEqual([["w1"]]);
    await until(() =>
      expect($("workflow-cloud-result")!.textContent).toBe("Done: the Worker confirmed."),
    );
    fake.s.regs = [reg("w1")];
    await notify();
    await click("workflow-cloud-unregister");
    expect(fn("unregister").mock.calls).toEqual([["w1"]]);
    fake.s.regs = [reg("w1", { state: "uncertain", unresolved: true })];
    await notify();
    await click("workflow-cloud-recover");
    expect(fn("recover").mock.calls).toEqual([["w1"]]);
    expect(called()).toEqual(["register", "unregister", "recover"]);
  });

  it("disabled while wf:<id> is busy, and while not handshaken (Check connection = one handshake)", async () => {
    setView({ busy: new Set(["wf:w1"]) });
    await card("w1");
    expect(btn("workflow-cloud-register").disabled).toBe(true);
    await act(async () => setView({ authority: null, handshake: "idle" }));
    expect(btn("workflow-cloud-register").disabled).toBe(true);
    expect($("workflow-cloud-handshake")!.textContent).toBe(
      "Check the connection first to use the cloud buttons.",
    );
    await click("workflow-cloud-check");
    expect(called()).toEqual(["handshake"]);
    await act(async () => setView({ authority: null, busy: new Set(["handshake"]) }));
    expect(btn("workflow-cloud-check").disabled).toBe(true);
  });

  it("not configured: points to Settings, no Check connection", async () => {
    setView({ configured: { ok: false, reason: "none" }, authority: null, handshake: "idle" });
    await card("w1");
    expect($("workflow-cloud-connect")!.textContent).toContain("No Worker set yet");
    expect($("workflow-cloud-settings")!.getAttribute("href")).toMatch(/^\/settings\/?#api-keys$/);
    expect($("workflow-cloud-check")).toBeNull();
  });

  it("refusal and uncertain copy: capacity, a sent-but-unknown stale, an unknown code", async () => {
    await card("w1");
    const say = async (r: unknown, copy: string) => {
      fn("register").mockResolvedValueOnce(r);
      await click("workflow-cloud-register");
      await until(() => expect($("workflow-cloud-result")!.textContent).toBe(copy));
    };
    await say(
      { kind: "refused", reason: "capacity", dispatched: false },
      "The limit is reached. Remove an older one first.",
    );
    await say(
      { kind: "stale", key: "k", operationId: "o", dispatched: true },
      "Sent, but no clear answer. Check status before doing anything else.",
    );
    await say(
      {
        kind: "recorded",
        key: "k",
        operationId: "o",
        state: "uncertain",
        dispatched: true,
        persisted: true,
      },
      "Sent, but no clear answer — press Recover to check.",
    );
    await say(
      { kind: "refused", reason: "weird_new", dispatched: false },
      "Couldn't do that (weird_new).",
    );
  });
});

describe("journal entries and cloud runs", () => {
  it("Send / Check status / Run / Cancel: one call each with the entry key; disabled while that key is busy", async () => {
    const e = entry("w1");
    fake.s.journal = [e, entry("other", { key: "k-other" })];
    await card("w1");
    await until(() => expect($$("workflow-cloud-entry")).toHaveLength(1));
    for (const [testId, k] of [
      ["workflow-cloud-submit", "submit"],
      ["workflow-cloud-status", "status"],
      ["workflow-cloud-run", "run"],
      ["workflow-cloud-cancel", "cancel"],
    ] as const) {
      await click(testId);
      expect(fn(k).mock.calls).toEqual([[e.key]]);
    }
    await act(async () => setView({ busy: new Set([e.key]) }));
    for (const id of ["submit", "status", "run", "cancel"])
      expect(btn(`workflow-cloud-${id}`).disabled).toBe(true);
  });

  it("outcome copy: answered with a receipt, unconfirmed after sending, refused suppressed", async () => {
    fake.s.journal = [entry("w1", { observed: { state: "running", receiptVersion: 2 } })];
    await card("w1");
    await until(() => expect($("workflow-cloud-entry")).not.toBeNull());
    expect($("workflow-cloud-entry")!.textContent).toContain("Worker: Running (version 2)");
    const say = async (r: unknown, copy: string) => {
      fn("status").mockResolvedValueOnce(r);
      await click("workflow-cloud-status");
      await until(() => expect($("workflow-cloud-entry-result")!.textContent).toBe(copy));
    };
    await say(
      {
        kind: "answered",
        action: "status",
        key: "k",
        parsed: {
          outcome: "ok",
          kind: "status",
          result: { found: "row", receipt: { state: "done" } },
        },
        recorded: { persisted: true, changed: true },
      },
      "The Worker answered: Done.",
    );
    await say(
      { kind: "unconfirmed", action: "status", key: "k", dispatched: true, category: "timeout" },
      "Sent, but no clear answer. Check status before doing anything else.",
    );
    await say(
      { kind: "refused", action: "status", reason: "suppressed", dispatched: false },
      "Held after a reset: Send and Run are off; Check status and Cancel still work.",
    );
    await say(
      {
        kind: "answered",
        action: "status",
        key: "k",
        parsed: { outcome: "refused", error: "absent" },
        recorded: null,
      },
      "The Worker refused: The Worker doesn't have this run.",
    );
  });

  it("a suppressed entry disables Send and Run, keeps Check status and Cancel", async () => {
    fake.s.journal = [entry("w1", { state: "suppressed" })];
    await card("w1");
    await until(() => expect($("workflow-cloud-entry")).not.toBeNull());
    expect(btn("workflow-cloud-submit").disabled).toBe(true);
    expect(btn("workflow-cloud-run").disabled).toBe(true);
    expect(btn("workflow-cloud-status").disabled).toBe(false);
    expect(btn("workflow-cloud-cancel").disabled).toBe(false);
  });

  it("cloud runs of this workflow are listed with their own state labels", async () => {
    const run = (key: string, workflowId: string, state: string) => ({
      key,
      workflowId,
      state,
      kind: "manual",
      updatedAt: "2026-10-22T09:00:00.000Z",
    });
    fake.s.runs = [
      run("r1", "w1", "done"),
      run("r2", "w1", "partial"),
      run("r3", "w1", "failed"),
      run("r4", "w1", "cancelled"),
      run("r5", "w1", "pending"),
      run("r6", "w1", "running"),
      run("r7", "other", "done"),
    ];
    await card("w1");
    const rows = $$("workflow-cloud-run");
    expect(rows.map((r) => r.dataset.state)).toEqual([
      "done",
      "partial",
      "failed",
      "cancelled",
      "pending",
      "running",
    ]);
    expect(rows.map((r) => r.querySelector(".ios-chip")!.textContent)).toEqual([
      "Done",
      "Partly done",
      "Failed",
      "Cancelled",
      "Pending",
      "Running",
    ]);
  });
});

describe("Run now", () => {
  it("a registered workflow captures one cloud run (no local run) and its row offers Send", async () => {
    const w = await addWf();
    fake.s.capture = AUTH;
    const e = entry(w.id);
    const capture = vi.fn(async () => {
      fake.s.journal = [e];
      return { kind: "cloud", entry: { ...e, kind: "manual" }, created: true };
    });
    const local = vi.fn();
    useStore.setState({ captureManualRun: capture as never, runWorkflowNow: local as never });
    await screen(`#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await click("workflows-run");
    await until(() => expect(capture).toHaveBeenCalledTimes(1));
    expect(capture).toHaveBeenCalledWith(w.id, { authority: AUTH });
    expect(local).not.toHaveBeenCalled();
    // The faked capture writes no journal slice: the card re-reads because the captured key changed.
    await until(() => expect($("workflow-cloud-captured")).not.toBeNull());
    expect($("workflow-cloud-captured")!.textContent).toBe(
      "A cloud run was saved. Press Send on it below.",
    );
    expect($("workflow-cloud-entry")!.dataset.captured).toBe("true");
    expect(btn("workflow-cloud-submit").disabled).toBe(false);
    expect(called()).toEqual([]);
  });

  it("capture refusals render their copy", async () => {
    const w = await addWf();
    fake.s.capture = AUTH;
    useStore.setState({
      captureManualRun: (async () => ({ kind: "refused", reason: "definition-mismatch" })) as never,
    });
    await screen(`#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await click("workflows-run");
    await until(() =>
      expect($("workflows-run-error")!.textContent).toBe(
        "You edited it after putting it on the cloud. Take it off and put it on again. Nothing was saved.",
      ),
    );
  });

  it("a local workflow keeps today's runWorkflowNow path (no capture)", async () => {
    const w = await addWf();
    const capture = vi.fn();
    useStore.setState({ captureManualRun: capture as never });
    await screen(`#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await click("workflows-run");
    await until(() => expect($("workflows-run-row")?.dataset.status).toBe("done"));
    expect(capture).not.toHaveBeenCalled();
    expect(fake.hub.captureAuthority).toHaveBeenCalledWith(w.id);
  });
});

describe("Cloud results card", () => {
  it("Fetch results: one reconcile({limit: 50}); page counts, more and blocked render", async () => {
    fn("reconcile").mockResolvedValueOnce({
      kind: "page",
      cursor: 9,
      more: true,
      items: [
        { occurrenceId: "a", changeSeq: 1, outcome: "pending", reason: "absent" },
        { occurrenceId: "b", changeSeq: 2, outcome: "retired" },
        { occurrenceId: "c", changeSeq: 3, outcome: "proven" },
      ],
      blocked: { occurrenceId: "d", reason: "mismatch" },
    });
    await screen();
    await click("workflow-cloud-fetch");
    expect(fn("reconcile").mock.calls).toEqual([[{ limit: 50 }]]);
    await until(() => expect($("workflow-cloud-page")).not.toBeNull());
    expect($("workflow-cloud-page")!.textContent).toContain("1 waiting · 1 retired");
    expect($("workflow-cloud-more")).not.toBeNull();
    expect($("workflow-cloud-blocked")!.textContent).toBe(
      "Stopped at one item: The content doesn't match what we saved.",
    );
    expect($("workflow-cloud-pause")).toBeNull();
    expect(called()).toEqual(["reconcile"]);
  });

  it("disabled while reconcile is busy or not handshaken; an unconfirmed fetch says sent — check", async () => {
    setView({ busy: new Set(["reconcile"]) });
    await screen();
    expect(btn("workflow-cloud-fetch").disabled).toBe(true);
    await act(async () => setView({ authority: null, handshake: "idle" }));
    expect(btn("workflow-cloud-fetch").disabled).toBe(true);
    await act(async () => setView());
    fn("reconcile").mockResolvedValueOnce({
      kind: "unconfirmed",
      dispatched: true,
      category: "network",
    });
    await click("workflow-cloud-fetch");
    await until(() =>
      expect($("workflow-cloud-fetch-result")!.textContent).toBe(
        "Sent, but no clear answer. Check status before doing anything else.",
      ),
    );
  });

  it("proof-full / retirement-full show a visible pause (from the page or the stored counts)", async () => {
    fn("reconcile").mockResolvedValueOnce({
      kind: "page",
      cursor: 1,
      more: true,
      items: [],
      blocked: { occurrenceId: "x", reason: "proof-full" },
    });
    await screen();
    await click("workflow-cloud-fetch");
    await until(() => expect($("workflow-cloud-pause")?.dataset.state).toBe("proof-full"));
    expect($("workflow-cloud-pause")!.textContent).toContain("600 finished results");
    act(() => root.unmount());
    root = createRoot(host);
    fake.s.counts = { ...fake.s.counts, tombstones: 100 };
    await screen();
    expect($("workflow-cloud-pause")?.dataset.state).toBe("retirement-full");
    expect($("workflow-cloud-pause")!.textContent).toContain("100 retired results");
  });

  it("Confirm delivery: one ack(key) per row, disabled while that key is busy, copy for the answer", async () => {
    const w = await addWf();
    fake.s.deliverable = [
      { key: "p1", occurrenceId: "o1", workflowId: w.id, state: "done" },
      { key: "p2", occurrenceId: "o2", workflowId: "gone", state: "partial" },
    ];
    fn("ack").mockResolvedValueOnce({
      kind: "answered",
      key: "p1",
      parsed: { outcome: "ok", kind: "ack" },
    });
    await screen();
    const rows = $$("workflow-cloud-proof");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Daily"),
      expect.stringContaining("gone"),
    ]);
    await click("workflow-cloud-ack", 0);
    expect(fn("ack").mock.calls).toEqual([["p1"]]);
    await until(() =>
      expect($("workflow-cloud-ack-result")!.textContent).toBe(
        "The Worker noted it. Press Check status later so it's retired here.",
      ),
    );
    await act(async () => setView({ busy: new Set(["p2"]) }));
    expect(($$("workflow-cloud-ack")[1] as HTMLButtonElement).disabled).toBe(true);
    // Row 0 was acknowledged (disabled until its proof changes, DT-7C-3D fix round); row 1 is only busy.
    expect(($$("workflow-cloud-ack")[0] as HTMLButtonElement).disabled).toBe(true);
    expect(($$("workflow-cloud-proof-status")[1] as HTMLButtonElement).disabled).toBe(true);
    expect(called()).toEqual(["ack"]);
  });

  it("Confirm delivery: two clicks send one ack, disabled once acknowledged, enabled again when the proof changes version", async () => {
    const proof = { key: "p1", occurrenceId: "o1", workflowId: "w", state: "done" };
    fake.s.deliverable = [proof];
    fn("ack").mockResolvedValue({
      kind: "answered",
      key: "p1",
      parsed: { outcome: "ok", kind: "ack" },
    });
    await screen();
    // Set after the screen is up: the store itself parses this slice, so the stored versions are faked only now.
    fake.s.versions = { p1: 3 };
    await notify();
    await click("workflow-cloud-ack");
    await click("workflow-cloud-ack");
    expect(fn("ack").mock.calls).toEqual([["p1"]]);
    expect(btn("workflow-cloud-ack").disabled).toBe(true);
    expect($("workflow-cloud-ack-result")!.textContent).toBe(
      "The Worker noted it. Press Check status later so it's retired here.",
    );
    // The same version re-read keeps it disabled; a forced click still sends nothing.
    await notify();
    expect(btn("workflow-cloud-ack").disabled).toBe(true);
    await act(async () =>
      btn("workflow-cloud-ack").dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(fn("ack")).toHaveBeenCalledTimes(1);
    // A newer receipt version of the same proof is confirmable again.
    fake.s.versions = { p1: 4 };
    await notify();
    expect(btn("workflow-cloud-ack").disabled).toBe(false);
    await click("workflow-cloud-ack");
    expect(fn("ack").mock.calls).toEqual([["p1"], ["p1"]]);
    expect(btn("workflow-cloud-ack").disabled).toBe(true);
    // Gone from the list, then listed again at the same version: a new entry, confirmable.
    fake.s.deliverable = [];
    await notify();
    fake.s.deliverable = [proof];
    await notify();
    expect(btn("workflow-cloud-ack").disabled).toBe(false);
    // An unconfirmed ack never disables it.
    fn("ack").mockResolvedValueOnce({
      kind: "unconfirmed",
      key: "p1",
      dispatched: true,
      category: "network",
    });
    await click("workflow-cloud-ack");
    expect(fn("ack")).toHaveBeenCalledTimes(3);
    expect(btn("workflow-cloud-ack").disabled).toBe(false);
  });

  it("Check status per proof: one check(key) per click; retired and refusal copy", async () => {
    fake.s.deliverable = [{ key: "p1", occurrenceId: "o1", workflowId: "w", state: "done" }];
    fn("check").mockResolvedValueOnce({
      kind: "answered",
      key: "p1",
      parsed: { outcome: "ok", kind: "status", result: { found: "pruned" } },
      recorded: { ok: true, change: "retired" },
    });
    await screen();
    await click("workflow-cloud-proof-status");
    expect(fn("check").mock.calls).toEqual([["p1"]]);
    await until(() =>
      expect($("workflow-cloud-ack-result")!.textContent).toBe(
        "The Worker tidied it up, and it's retired here now.",
      ),
    );
    expect($("workflow-cloud-ack-result")!.getAttribute("role")).toBe("status");
    fn("check").mockResolvedValueOnce({
      kind: "answered",
      key: "p1",
      parsed: {
        outcome: "ok",
        kind: "status",
        result: { found: "row", receipt: { state: "done" } },
      },
      recorded: { ok: false, reason: "proof-full" },
    });
    await click("workflow-cloud-proof-status");
    await until(() =>
      expect($("workflow-cloud-ack-result")!.textContent).toBe(
        "The finished-results record is full.",
      ),
    );
    expect($("workflow-cloud-ack-result")!.getAttribute("role")).toBe("alert");
    expect(called()).toEqual(["check"]);
    expect(fn("check")).toHaveBeenCalledTimes(2);
  });

  it("an unconfirmed item reads as sent — check status, not a raw code", async () => {
    fn("reconcile").mockResolvedValueOnce({
      kind: "page",
      cursor: 1,
      more: true,
      items: [
        { occurrenceId: "a", changeSeq: 1, outcome: "pending", reason: "unconfirmed:network" },
      ],
      blocked: { occurrenceId: "a", reason: "unconfirmed:network" },
    });
    await screen();
    await click("workflow-cloud-fetch");
    await until(() =>
      expect($("workflow-cloud-blocked")!.textContent).toBe(
        "Stopped at one item: Sent, but no clear answer. Check status before doing anything else.",
      ),
    );
  });
});

describe("fix round: handshake and Worker copy, a11y, double click", () => {
  it("today's Worker (handshake answer) reads 'not available'; the Worker's own not_configured is the Worker side", async () => {
    fake.s.journal = [entry("w1")];
    setView({ authority: null, handshake: { refused: "answer" } });
    await card("w1");
    expect($("workflow-cloud-handshake")!.textContent).toBe(
      "Not connected: The Worker answered, but cloud workflows aren't available there yet.",
    );
    await until(() => expect($("workflow-cloud-entry")).not.toBeNull());
    expect(btn("workflow-cloud-submit").disabled).toBe(true);
    await act(async () => setView());
    fn("submit").mockResolvedValueOnce({
      kind: "answered",
      action: "submit",
      key: "k",
      parsed: { outcome: "refused", error: "not_configured" },
      recorded: null,
    });
    await click("workflow-cloud-submit");
    await until(() =>
      expect($("workflow-cloud-entry-result")!.textContent).toBe(
        "The Worker refused: Cloud workflows aren't set up on the Worker itself yet.",
      ),
    );
    expect($("workflow-cloud-entry-result")!.getAttribute("role")).toBe("alert");
    for (const code of ["compact-feed", "unknown_epoch", "receipt_unavailable"]) {
      fn("status").mockResolvedValueOnce({
        kind: "refused",
        action: "status",
        reason: code,
        dispatched: false,
      });
      await click("workflow-cloud-status");
      await until(() =>
        expect($("workflow-cloud-entry-result")!.textContent).not.toContain(`(${code})`),
      );
    }
  });

  it("entry buttons are described by the entry (time and id)", async () => {
    fake.s.journal = [entry("w1")];
    await card("w1");
    await until(() => expect($("workflow-cloud-entry")).not.toBeNull());
    const send = btn("workflow-cloud-submit");
    const desc = document.getElementById(send.getAttribute("aria-describedby")!);
    expect(desc!.textContent).toContain("occ-1");
  });

  it("a double click on Put on cloud while the hub action is pending sends exactly one register (real hub busy)", async () => {
    const real =
      await vi.importActual<typeof import("@/lib/cloudWorkflowHub")>("@/lib/cloudWorkflowHub");
    const w = await addWf();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const ctl = () => ({
      configure: vi.fn(() => ({ ok: true as const, origin: A })),
      invalidateVisit: vi.fn(),
      dispose: vi.fn(),
      handshake: vi.fn(async () => ({ ok: true as const, authority: AUTH })),
    });
    const register = vi.fn(async () => {
      await held;
      return {
        kind: "recorded",
        key: "k",
        operationId: "o",
        state: "settled",
        dispatched: true,
        persisted: true,
      };
    });
    S().setSettings({ apiKeys: { scoutUrl: A, scoutToken: TOKEN } });
    const hub = real.createCloudHub({
      registration: { ...ctl(), register, unregister: vi.fn(), recover: vi.fn() } as never,
      occurrence: ctl() as never,
      reconciliation: ctl() as never,
      readRegistrations: async () => emptyRegistrations(),
    });
    await hub.handshake();
    fake.cloudHub.mockReturnValue(hub as never);
    try {
      await card(w.id);
      expect(btn("workflow-cloud-register").disabled).toBe(false);
      await act(async () => {
        btn("workflow-cloud-register").click();
        btn("workflow-cloud-register").click();
      });
      expect(btn("workflow-cloud-register").disabled).toBe(true);
      await until(() => expect(register).toHaveBeenCalledTimes(1));
      await act(async () => release());
      await until(() =>
        expect($("workflow-cloud-result")!.textContent).toBe("Done: the Worker confirmed."),
      );
      expect(register).toHaveBeenCalledTimes(1);
    } finally {
      fake.cloudHub.mockReturnValue(fake.hub as never);
      hub.dispose();
    }
  });
});

// DT-7C-3C fix round: both cards prerender with the inert hub (no rows, nothing readable); hydration agrees with it,
// and the stored rows show up right after (no hydration warning).
describe("hydration", () => {
  async function hydrated(el: ReturnType<typeof createElement>) {
    const html = renderToString(el);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const box = document.createElement("div");
    box.innerHTML = html;
    document.body.append(box);
    let r!: Root;
    await act(async () => {
      r = hydrateRoot(box, el);
    });
    return {
      html,
      box,
      errors,
      done: () => {
        act(() => r.unmount());
        box.remove();
      },
    };
  }

  it("the workflow Cloud card: server markup is the inert one, the registration appears after hydration", async () => {
    fake.s.regs = [reg("w1")];
    fake.s.counts = { ...fake.s.counts, registrations: 1 };
    const h = await hydrated(
      createElement(WorkflowCloudCard, { id: "w1", locked: false, captured: null }),
    );
    expect(h.html).toContain('data-state="local"');
    await until(() =>
      expect(
        h.box.querySelector('[data-testid="workflow-cloud-chip"]')!.getAttribute("data-state"),
      ).toBe("active"),
    );
    expect(h.errors).not.toHaveBeenCalled();
    h.done();
  });

  it("the Cloud results card: no proof rows in the server markup, the deliverable proof after hydration", async () => {
    fake.s.deliverable = [{ key: "p1", occurrenceId: "o", workflowId: "w1", state: "done" }];
    const h = await hydrated(createElement(CloudResultsCard));
    expect(h.html).not.toContain("workflow-cloud-proof");
    await until(() =>
      expect(h.box.querySelector('[data-testid="workflow-cloud-proof"]')).not.toBeNull(),
    );
    expect(h.errors).not.toHaveBeenCalled();
    h.done();
  });
});
