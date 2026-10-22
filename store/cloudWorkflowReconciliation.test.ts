// @vitest-environment jsdom
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { kitProjection } from "@/lib/businessKit";
import {
  createCloudWorkflowSession,
  type ClientFetch,
  type ClientResponse,
} from "@/lib/cloudWorkflowClient";
import { readJournal, type CloudJournal } from "@/lib/cloudWorkflowJournal";
import { createOccurrenceController } from "@/lib/cloudWorkflowOccurrenceClient";
import { submitRequestOf, type CloudRequest } from "@/lib/cloudWorkflowProtocol";
import {
  PROOF_CAPACITY,
  readReconciliation,
  retireOccurrence,
  stamp,
  type CloudReconciliation,
  type ProofRecord,
} from "@/lib/cloudWorkflowReconciliation";
import {
  createReconciliationController,
  type ReconcileResult,
} from "@/lib/cloudWorkflowReconciliationClient";
import { createRegistrationController } from "@/lib/cloudWorkflowRegistrationClient";
import { workflowDigestOf } from "@/lib/cloudWorkflowCapture";
import type { Workflow } from "@/lib/domain";
import { payloadDigestOf } from "@/workers/scout/src/social/workflowProtocol";
import {
  STORAGE_KEY,
  cloudOccurrencePersistence,
  cloudReconciliationPersistence,
  cloudRegistrationPersistence,
  invalidateCloudVisit,
  savesSettled,
  setArticlesLock,
  useStore,
  type ArticlesLock,
} from "./index";

// ⚙️ DT-7C-2C reconciliation (planning/tools/38-cloud-workflows.md): REAL capture into the REAL store journal, explicit
// Submit/Run through the accepted occurrence controller, then the reconciliation controller over the store's locked
// persistence against the REAL Worker router + SQLite coordinator behind a fake in-memory transport. Exact drafts,
// initial proof, collisions, deletion evidence (incl. same-tab queued deletion), two tabs, reset/import, read-back
// failures, ack after durable proof, lost ack, bounded pages, retirement across reload, capacity, privacy. No network.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec); // eslint-disable-line @typescript-eslint/no-explicit-any

const S = () => useStore.getState();
const TOKEN = "recon-token-CANARY-7c2c";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://scout.test";
const T_BASE = new Date("2026-01-01T00:00:00.000Z");
const T0 = new Date("2026-10-18T07:00:00.000Z");
const T_CAP = new Date("2026-10-18T08:05:00.000Z");
const T_RESET = new Date("2026-10-18T10:00:00.000Z");
const SKILL = "smart-bins-keywords";
const DAY = 86_400_000;
const idea = (id: string) => ({ id, kind: "idea" as const, text: { ar: "", en: "Idea {date}" } });
const post = (id: string) => ({
  id,
  kind: "post" as const,
  platform: "tiktok",
  title: { ar: "", en: "Post {date}" },
  caption: { ar: "", en: "Caption" },
  offsetDays: 1,
});
const plan = (id: string) => ({
  id,
  kind: "plan" as const,
  quest: "train",
  skillId: SKILL,
  minutes: 30,
  day: 2,
});

/* ---------- the real Worker router behind a fake transport ---------- */

let handle: (req: Request, env: A, ctx: undefined, deps: { now: () => Date }) => Promise<Response>;
let WorkflowCoordinator: new (state: never) => { fetch(req: Request): Promise<Response> };
function sqliteStorage(db: DatabaseSync) {
  return {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        const st = db.prepare(query);
        if (/^\s*SELECT|RETURNING/i.test(query)) {
          const rows = st.all(...bindings);
          return { toArray: () => rows };
        }
        st.run(...bindings);
        return { toArray: () => [] };
      },
    },
    transactionSync<V>(fn: () => V): V {
      db.exec("BEGIN");
      try {
        const v = fn();
        db.exec("COMMIT");
        return v;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
const bytes = (status: number, text: string): ClientResponse => ({
  status,
  body: new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(Array.from(Buffer.from(text))));
      c.close();
    },
  }),
});
type Sent = { method: string; url: string; body?: string };
let rig: Awaited<ReturnType<typeof makeRig>>;
async function makeRig() {
  const db = new DatabaseSync(":memory:");
  const ns = {
    idFromName: (name: string) => name,
    get: () => ({
      async fetch(url: string, init: RequestInit) {
        return new WorkflowCoordinator({ storage: sqliteStorage(db) } as never).fetch(
          new Request(url, init),
        );
      },
    }),
  };
  const env = { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP, WORKFLOW_COORDINATOR: ns };
  const time = { ms: Date.UTC(2026, 9, 18, 8, 0, 0), step: 1000 };
  const clock = () => new Date((time.ms += time.step));
  const net = {
    mode: "deliver" as "deliver" | "lose",
    log: [] as Sent[],
    /** One-shot: the next request is processed by the router, then its answer waits for this. */
    hold: null as Promise<void> | null,
    rewrite: null as ((text: string, url: string) => string) | null,
  };
  const fetchFn: ClientFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", APP);
    net.log.push({ method: init.method, url, ...(init.body ? { body: init.body } : {}) });
    const res = await handle(
      new Request(url, { method: init.method, headers, ...(init.body ? { body: init.body } : {}) }),
      env,
      undefined,
      { now: clock },
    );
    let text = await res.text();
    const h = net.hold;
    net.hold = null;
    if (h) await h;
    if (init.method === "POST" && net.mode === "lose") throw new TypeError("answer lost");
    if (net.rewrite) text = net.rewrite(text, url);
    return bytes(res.status, text);
  };
  const ctl = createRegistrationController({
    fetch: fetchFn,
    persistence: cloudRegistrationPersistence,
  });
  ctl.configure({ origin: BASE, token: TOKEN });
  const h = await ctl.handshake();
  if (!h.ok) throw new Error(h.reason);
  return { ctl, net, time, fetch: fetchFn, owner: h.authority.ownerKey as string };
}
const authority = () => ({ origin: BASE, ownerKey: rig.owner });

/* ---------- store helpers ---------- */

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
function gateLock() {
  const inner = queueLock();
  let open: () => void = () => undefined;
  const gate = new Promise<void>((r) => (open = r));
  let armed = true;
  const lock: ArticlesLock = (fn) => {
    if (!armed) return inner(fn);
    armed = false;
    return inner(async () => {
      await gate;
      return fn();
    });
  };
  return { lock, release: () => open() };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = async (n = 40) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const raw = () => localStorage.getItem(STORAGE_KEY)!;
const stored = (): A => JSON.parse(raw()).state;
const journal = (): CloudJournal => readJournal(stored().cloudJournal)!;
const recon = (): CloudReconciliation => readReconciliation(stored().cloudReconciliation)!;
const proof = (key: string): ProofRecord | undefined => recon().proofs.find((p) => p.key === key);
const dispositions = (key: string) => proof(key)?.outputs.map((o) => o.disposition);
const otherTab = (edit: (state: A) => void) => {
  const r = JSON.parse(raw());
  edit(r.state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
};
const backup = (edit: (state: A) => void = () => undefined) => {
  const state = JSON.parse(raw()).state;
  edit(state);
  return JSON.stringify({ app: "3z-prod", version: 1, exportedAt: T_CAP.toISOString(), state });
};
async function workflow(actions: A[] = [idea("a1"), post("a2"), plan("a3")]): Promise<Workflow> {
  const r = await S().addWorkflow(
    { name: { ar: "", en: "Flow" }, trigger: { kind: "manual" }, actions: actions as never },
    T0,
  );
  if (!r.ok) throw new Error(r.reason);
  return r.workflow;
}
async function registered(w: Workflow) {
  const workflowDigest = (await workflowDigestOf(w))!;
  const r = await rig.ctl.register({
    kind: "register",
    ownerKey: rig.owner,
    workflowId: w.id,
    expectedEpoch: 0,
    revision: w.revision,
    workflowDigest,
  });
  expect(r).toMatchObject({ kind: "recorded", state: "settled" });
}
async function occurrences() {
  const c = createOccurrenceController({
    fetch: rig.fetch,
    persistence: cloudOccurrencePersistence,
  });
  expect(c.configure({ origin: BASE, token: TOKEN }).ok).toBe(true);
  expect(await c.handshake()).toMatchObject({ ok: true });
  return c;
}
/** One registered workflow, its captured occurrence, submitted (and run unless `run: false`). */
async function cloudRun(o: { actions?: A[]; run?: boolean; w?: Workflow } = {}) {
  const w = o.w ?? (await workflow(o.actions));
  if (!o.w) await registered(w);
  const r = await S().captureManualRun(w.id, { authority: authority() }, T_CAP);
  if (r.kind !== "cloud") throw new Error("not cloud: " + JSON.stringify(r));
  const key = r.entry.key;
  const occ = await occurrences();
  expect(await occ.submit(key)).toMatchObject({ kind: "answered" });
  if (o.run !== false) expect(await occ.run(key)).toMatchObject({ kind: "answered" });
  return { w, key, id: r.entry.occurrenceId, occ };
}
async function rc(fetch: ClientFetch = rig.fetch) {
  const c = createReconciliationController({ fetch, persistence: cloudReconciliationPersistence });
  expect(c.configure({ origin: BASE, token: TOKEN }).ok).toBe(true);
  expect(await c.handshake()).toMatchObject({ ok: true });
  return c;
}
/** The Worker's current full receipt for an id (a raw status through a fresh session). */
async function workerReceipt(id: string): Promise<A> {
  const s = createCloudWorkflowSession({ fetch: rig.fetch });
  s.configure({ origin: BASE, token: TOKEN });
  await s.handshake();
  const r = await s.execute({ kind: "status", ownerKey: rig.owner, occurrenceId: id }, authority());
  if (
    r.kind !== "answer" ||
    r.parsed.outcome !== "ok" ||
    r.parsed.kind !== "status" ||
    r.parsed.result.found !== "row"
  )
    throw new Error("no row");
  return JSON.parse(JSON.stringify(r.parsed.result.receipt));
}
const page = (r: ReconcileResult) => {
  expect(r.kind).toBe("page");
  return r as Extract<ReconcileResult, { kind: "page" }>;
};
const records = () => [...stored().ideas, ...stored().posts, ...stored().planItems] as A[];
const recordOf = (id: string) => records().find((x) => x.id === id);
const sentNow = () => rig.net.log.filter((r) => !r.url.endsWith("/social/workflows/authority"));
const clearLog = () => void (rig.net.log.length = 0);

beforeAll(async () => {
  handle = (await load("@/workers/scout/src/scout")).handle;
  WorkflowCoordinator = (await load("@/workers/scout/src/social/workflowCoordinator"))
    .WorkflowCoordinator;
}, 60_000);
beforeEach(async () => {
  localStorage.clear();
  setArticlesLock(queueLock());
  expect(await S().reset(T_BASE)).toEqual({ ok: true, retained: 0 });
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
  S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
  await savesSettled();
  rig = await makeRig();
});
afterEach(async () => {
  await savesSettled();
  setArticlesLock(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("exact idea/post/plan drafts from a verified full receipt, then ack", () => {
  it("adopts the receipt's records byte-exact with one locked commit, projects the run, acks only after read-back", async () => {
    const { key, id } = await cloudRun();
    const receipt = await workerReceipt(id);
    expect(receipt.state).toBe("done");
    const c = await rc();
    expect(await c.ack(key)).toMatchObject({ kind: "refused", reason: "not_eligible" }); // no ack before proof
    clearLog();
    const out = page(await c.reconcile());
    expect(out.items).toEqual([
      { occurrenceId: id, changeSeq: receipt.changeSeq, outcome: "proven" },
    ]);
    expect(out.blocked).toBeNull();
    // Exactly one changes page and one full status: compact items are discovery only.
    expect(sentNow().map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ["GET", "/social/workflows/changes"],
      ["GET", `/social/workflows/occurrences/${id}`],
    ]);
    for (const o of receipt.outputs) expect(recordOf(o.outputId)).toEqual(o.record);
    expect(stored().ideas).toHaveLength(1);
    expect(stored().posts).toHaveLength(1);
    expect(stored().planItems).toHaveLength(1);
    expect(stored().posts[0].autoPost).toBeUndefined(); // never a publish job
    expect(S().workflowRuns).toEqual([]); // never cast into the local WorkflowRun type
    expect(dispositions(key)).toEqual(["adopted", "adopted", "adopted"]);
    expect(proof(key)).toMatchObject({
      source: "journal",
      resetEpoch: 0,
      firstVersion: receipt.receiptVersion,
    });
    expect(recon().runs).toEqual([
      expect.objectContaining({ key, state: "done", receiptVersion: receipt.receiptVersion }),
    ]);
    expect(recon().authorities[0].cursor).toBe(receipt.changeSeq);
    clearLog();
    const ack = await c.ack(key);
    expect(ack).toMatchObject({
      kind: "answered",
      parsed: { outcome: "ok", kind: "ack", acknowledged: true },
    });
    expect(sentNow()).toEqual([
      {
        method: "POST",
        url: `${BASE}/social/workflows/occurrences/${id}/ack`,
        body: JSON.stringify({ ownerKey: rig.owner, receiptVersion: receipt.receiptVersion }),
      },
    ]);
    // The ack answer wrote nothing; an explicit check records the receipt's ack fields monotonically.
    expect(proof(key)!.receipt.ackedVersion).toBe(0);
    expect(await c.check(key)).toMatchObject({
      kind: "answered",
      recorded: { ok: true, change: "observed" },
    });
    expect(proof(key)!.receipt.ackedVersion).toBe(receipt.receiptVersion);
    expect(dispositions(key)).toEqual(["adopted", "adopted", "adopted"]);
    // Repeated reconciliation: nothing new, no status needed.
    clearLog();
    expect(page(await c.reconcile()).items).toEqual([]);
    expect(sentNow()).toHaveLength(1);
    // Zero publish/provider effects: only workflow routes were ever called.
    expect(rig.net.log.every((r) => new URL(r.url).pathname.startsWith("/social/workflows/"))).toBe(
      true,
    );
  });

  it("a cancelled occurrence proves an empty disposition set and is ack-eligible", async () => {
    const { key, id, occ } = await cloudRun({ run: false });
    expect(await occ.cancel(key)).toMatchObject({ kind: "answered" });
    const c = await rc();
    expect(page(await c.reconcile()).items[0]).toMatchObject({
      occurrenceId: id,
      outcome: "proven",
    });
    expect(proof(key)!.outputs).toEqual([]);
    expect(records()).toEqual([]);
    expect(await c.ack(key)).toMatchObject({ kind: "answered", parsed: { acknowledged: true } });
  });

  it("a nonterminal receipt is bound and projected only; the later terminal receipt adopts", async () => {
    const { key, id, occ } = await cloudRun({ run: false });
    const c = await rc();
    expect(page(await c.reconcile()).items[0]).toMatchObject({
      occurrenceId: id,
      outcome: "bound",
    });
    expect(records()).toEqual([]);
    expect(recon().runs[0].state).toBe("pending");
    expect(await c.ack(key)).toMatchObject({ kind: "refused", reason: "not_eligible" });
    expect(await occ.run(key)).toMatchObject({ kind: "answered" });
    expect(page(await c.reconcile()).items[0]).toMatchObject({ outcome: "proven" });
    expect(records()).toHaveLength(3);
    expect(proof(key)!.firstVersion).toBe(1);
  });
});

describe("initial proof, compact answers and collisions", () => {
  it("an occurrence absent from the local journal gains a remote-initial proof (no journal entry, no Submit)", async () => {
    const { key, id } = await cloudRun();
    otherTab((s) => {
      const j = readJournal(s.cloudJournal)!;
      s.cloudJournal = { ...j, entries: [], generation: j.generation + 1 };
    }); // as if captured by another browser
    await useStore.persist.rehydrate();
    const c = await rc();
    clearLog();
    expect(page(await c.reconcile()).items[0]).toMatchObject({
      occurrenceId: id,
      outcome: "proven",
    });
    expect(proof(key)!.source).toBe("remote-initial");
    expect(journal().entries).toEqual([]);
    expect(sentNow().some((r) => r.method === "POST")).toBe(false);
    expect(records()).toHaveLength(3);
  });

  it("a malformed (unverifiable) status answer adopts nothing and leaves a recoverable pending record", async () => {
    const { key, id } = await cloudRun();
    rig.net.rewrite = (text, url) =>
      url.includes(`/occurrences/${id}`)
        ? text.replace('"state":"done"', '"state":"partial"')
        : text;
    const c = await rc();
    const out = page(await c.reconcile());
    expect(out.items[0]).toMatchObject({
      outcome: "pending",
      reason: "unconfirmed:invalid_answer",
    });
    expect(records()).toEqual([]);
    expect(proof(key)).toBeUndefined();
    expect(recon().pending).toEqual([
      expect.objectContaining({ key, reason: "unconfirmed:invalid_answer" }),
    ]);
    expect(await c.ack(key)).toMatchObject({ kind: "refused", reason: "not_eligible" });
    // Explicit recovery: the pending item checked again with a clean answer.
    rig.net.rewrite = null;
    expect(await c.check(key)).toMatchObject({ recorded: { ok: true, change: "proven" } });
    expect(recon().pending).toEqual([]);
    expect(records()).toHaveLength(3);
  });

  it("an unowned local record with the wf: id is a collision: kept byte-identical, others adopted, no ack", async () => {
    const { key, id } = await cloudRun();
    const local = { id: `wf:${id}:a1`, text: "mine", source: "me", createdAt: T0.toISOString() };
    otherTab((s) => (s.ideas = [local]));
    await useStore.persist.rehydrate();
    const c = await rc();
    const out = page(await c.reconcile());
    expect(out.items[0]).toMatchObject({ outcome: "proven", collisions: [`wf:${id}:a1`] });
    expect(stored().ideas).toEqual([local]);
    expect(dispositions(key)).toEqual(["collision", "adopted", "adopted"]);
    expect(await c.ack(key)).toMatchObject({ kind: "refused", reason: "not_eligible" });
  });

  it("the same occurrence id under another authority collides with the first authority's outputs", async () => {
    const { w, key, id } = await cloudRun();
    const c = await rc();
    page(await c.reconcile());
    // A second Worker (another ownerKey on the same origin) admits a body with the same occurrence id.
    const first = rig;
    rig = await makeRig();
    await registered(w);
    const body = { ...JSON.parse(JSON.stringify(journal().entries[0].body)), ownerKey: rig.owner };
    const sub = await submitRequestOf(body);
    if (!sub.ok) throw new Error("submit");
    const s = createCloudWorkflowSession({ fetch: rig.fetch });
    s.configure({ origin: BASE, token: TOKEN });
    await s.handshake();
    expect((await s.execute(sub.request, authority())).kind).toBe("answer");
    expect(
      (await s.execute({ kind: "run", ownerKey: rig.owner, occurrenceId: id }, authority())).kind,
    ).toBe("answer");
    const c2 = await rc(rig.fetch);
    const out = page(await c2.reconcile());
    expect(out.items[0]).toMatchObject({ outcome: "proven" });
    expect(out.items[0].collisions).toHaveLength(3);
    const keyB = JSON.stringify([BASE, rig.owner, id]);
    expect(dispositions(keyB)).toEqual(["collision", "collision", "collision"]);
    expect(dispositions(key)).toEqual(["adopted", "adopted", "adopted"]);
    expect(records()).toHaveLength(3);
    // A key of the other authority is foreign to the first controller.
    expect(await c.check(keyB)).toMatchObject({ kind: "refused", reason: "foreign_key" });
    rig = first;
  });
});

describe("deletion evidence: every removal path records it in the same locked write", () => {
  async function adopted() {
    const r = await cloudRun();
    const c = await rc();
    page(await c.reconcile());
    await useStore.persist.rehydrate();
    return { ...r, c };
  }

  it("removeIdea / removePost / setPlanItems (week rebuild): deleted, never re-adopted; ack still allowed", async () => {
    const { key, id, c } = await adopted();
    S().removeIdea(`wf:${id}:a1`);
    S().removePost(`wf:${id}:a2`);
    const week = stored().planItems[0].week;
    S().setPlanItems(week, []);
    await savesSettled();
    expect(records()).toEqual([]);
    expect(dispositions(key)).toEqual(["deleted", "deleted", "deleted"]);
    expect(await c.check(key)).toMatchObject({ kind: "answered" });
    expect(records()).toEqual([]);
    expect(await c.ack(key)).toMatchObject({ kind: "answered", parsed: { acknowledged: true } });
  });

  it("an edited (dirty) owned record stays byte-identical and is retained", async () => {
    const { key, id, c } = await adopted();
    S().toggleIdeaFavorite(`wf:${id}:a1`);
    await savesSettled();
    const dirty = recordOf(`wf:${id}:a1`);
    expect(dirty!.favorite).toBe(true);
    await c.ack(key);
    expect(await c.check(key)).toMatchObject({ recorded: { ok: true } });
    expect(recordOf(`wf:${id}:a1`)).toEqual(dirty);
    expect(dispositions(key)).toEqual(["retained", "adopted", "adopted"]);
  });

  it("same-tab queued deletion: the removal waiting for the lock is written (with evidence) before the commit", async () => {
    const { key, id, occ } = await cloudRun({ run: false });
    const c = await rc();
    page(await c.reconcile()); // bound (pending)
    expect(await occ.run(key)).toMatchObject({ kind: "answered" });
    page(await c.reconcile()); // proven
    await useStore.persist.rehydrate();
    const g = gateLock();
    setArticlesLock(g.lock);
    S().removeIdea(`wf:${id}:a1`); // queued behind the gate
    const p = c.check(key);
    await tick();
    g.release();
    expect(await p).toMatchObject({ kind: "answered" });
    await savesSettled();
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    expect(dispositions(key)).toEqual(["deleted", "adopted", "adopted"]);
  });

  it("another tab's unhooked removal is recorded as deleted at the next commit (never resurrected)", async () => {
    const { key, id, c } = await adopted();
    otherTab((s) => (s.ideas = []));
    await useStore.persist.rehydrate();
    await c.ack(key);
    expect(await c.check(key)).toMatchObject({ recorded: { ok: true } });
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    expect(dispositions(key)).toEqual(["deleted", "adopted", "adopted"]);
  });

  it("an ordinary save of another slice keeps the locked proof bytes exactly", async () => {
    await adopted();
    const before = JSON.stringify(stored().cloudReconciliation);
    S().addMicroAction({ ar: "س", en: "x" });
    await savesSettled();
    expect(JSON.stringify(stored().cloudReconciliation)).toBe(before);
  });

  it("reset: owned outputs cleared become deleted, the proof is kept; a later reconcile never resurrects them", async () => {
    const { key, c } = await adopted();
    expect(await S().reset(T_RESET)).toMatchObject({ ok: true });
    expect(records()).toEqual([]);
    expect(dispositions(key)).toEqual(["deleted", "deleted", "deleted"]);
    S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    await savesSettled();
    const c2 = await rc();
    await c2.check(key);
    expect(records()).toEqual([]);
    void c;
  });

  it("a pre-reset occurrence (captured before reset) proves suppressed outputs and writes none", async () => {
    const { key, id } = await cloudRun();
    expect(await S().reset(T_RESET)).toMatchObject({ ok: true });
    S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    await savesSettled();
    const c = await rc();
    expect(page(await c.reconcile()).items[0]).toMatchObject({
      occurrenceId: id,
      outcome: "proven",
    });
    expect(dispositions(key)).toEqual(["suppressed", "suppressed", "suppressed"]);
    expect(records()).toEqual([]);
  });
});

describe("import: merge, filter and legacy backups", () => {
  it("a backup with a deleted owned output never resurrects it; a legacy backup keeps the device's proof", async () => {
    const { key, id } = await cloudRun();
    const c = await rc();
    page(await c.reconcile());
    await useStore.persist.rehydrate();
    const old = backup(); // has all three outputs
    S().removeIdea(`wf:${id}:a1`);
    await savesSettled();
    expect(await S().importState(old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    expect(dispositions(key)).toEqual(["deleted", "adopted", "adopted"]);
    const legacy = backup((s) => {
      delete s.cloudReconciliation;
      s.posts = [];
    });
    const proofBefore = JSON.stringify(proof(key)!.receipt);
    expect(await S().importState(legacy)).toMatchObject({ ok: true });
    expect(JSON.stringify(proof(key)!.receipt)).toBe(proofBefore);
    expect(dispositions(key)).toEqual(["deleted", "deleted", "adopted"]); // the import removed the post
  });

  it("an equal-version contradiction in a backup refuses the whole import; an invalid slice is an invalid file", async () => {
    const { key } = await cloudRun();
    const c = await rc();
    page(await c.reconcile());
    const contradiction = backup((s) => {
      s.cloudReconciliation.proofs[0].receipt.changeSeq += 1000;
    });
    const r = await S().importState(contradiction);
    expect(r).toMatchObject({ ok: false });
    expect(r).toMatchObject({ scope: "reconciliation" });
    expect(proof(key)).toBeDefined();
    expect(() => S().importState(backup((s) => (s.cloudReconciliation = { v: 9 })))).toThrow();
  });
});

describe("persistence failures: no proof, no ack, nothing ahead of storage", () => {
  it("a quota error on the commit write: not persisted, no output, ack refused, a later commit succeeds", async () => {
    const { key } = await cloudRun();
    const c = await rc();
    const real = Storage.prototype.setItem;
    let failed = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && String(v).includes('"proofs":[{') && failed === 0) {
        failed++;
        throw new DOMException("full", "QuotaExceededError");
      }
      return real.call(this, k, v);
    });
    const out = page(await c.reconcile());
    expect(out.blocked).toMatchObject({ reason: "not-persisted" });
    expect(out.cursor).toBe(0);
    expect(records()).toEqual([]);
    expect(S().ideas).toEqual([]); // memory never ahead of storage
    expect(proof(key)).toBeUndefined();
    expect(await c.ack(key)).toMatchObject({ kind: "refused", reason: "not_eligible" });
    vi.restoreAllMocks();
    expect(page(await c.reconcile()).items[0]).toMatchObject({ outcome: "proven" });
  });

  it("a silently dropped write is caught by the exact read-back", async () => {
    const { key } = await cloudRun();
    const c = await rc();
    const real = Storage.prototype.setItem;
    let dropped = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && String(v).includes('"proofs":[{') && !dropped) {
        dropped = true;
        return;
      }
      return real.call(this, k, v);
    });
    expect(await c.check(key)).toMatchObject({ recorded: { ok: false, reason: "not-persisted" } });
    expect(dropped).toBe(true);
    expect(proof(key)).toBeUndefined();
    expect(S().ideas).toEqual([]);
  });
});

describe("lost ack and explicit recovery", () => {
  it("a lost ack is unconfirmed; check shows the Worker applied it; an explicit repeat is idempotent", async () => {
    const { key } = await cloudRun();
    const c = await rc();
    page(await c.reconcile());
    rig.net.mode = "lose";
    expect(await c.ack(key)).toMatchObject({ kind: "unconfirmed", dispatched: true });
    rig.net.mode = "deliver";
    expect(proof(key)!.receipt.ackedVersion).toBe(0);
    await c.check(key);
    expect(proof(key)!.receipt.ackedVersion).toBeGreaterThan(0);
    expect(await c.ack(key)).toMatchObject({ kind: "answered", parsed: { acknowledged: true } });
  });
});

describe("two tabs and fences", () => {
  it("a held status across another tab's proof commit for that key is stale (nothing written)", async () => {
    const { key } = await cloudRun();
    const a = await rc();
    const b = await rc();
    const gate = deferred();
    rig.net.hold = gate.promise;
    const held = a.check(key);
    await tick();
    expect(await b.check(key)).toMatchObject({ recorded: { ok: true, change: "proven" } });
    gate.resolve();
    expect(await held).toMatchObject({
      kind: "answered",
      recorded: { ok: false, reason: "stale" },
    });
    expect(records()).toHaveLength(3);
  });

  it("a held status across a reset or an import is stale: pre-reset work yields no outputs", async () => {
    const { key } = await cloudRun();
    const c = await rc();
    const gate = deferred();
    rig.net.hold = gate.promise;
    const held = c.check(key);
    await tick();
    expect(await S().importState(backup())).toMatchObject({ ok: true });
    gate.resolve();
    const out = await held;
    expect(out.kind === "stale" || (out.kind === "answered" && out.recorded?.ok === false)).toBe(
      true,
    );
    expect(records()).toEqual([]);
    expect(proof(key)).toBeUndefined();
  });

  it("a store visit invalidation mid-page stops the page; the next call continues from the durable cursor", async () => {
    const one = await cloudRun();
    const two = await cloudRun({ w: one.w });
    const r2 = await workerReceipt(two.id);
    const r1 = await workerReceipt(one.id);
    const first = r1.changeSeq < r2.changeSeq ? one : two;
    rig.net.hold = null;
    let n = 0;
    const realFetch = rig.fetch;
    const gate = deferred();
    const fetch: ClientFetch = async (url, init) => {
      if (url.includes("/occurrences/") && ++n === 2) {
        const res = await realFetch(url, init);
        await gate.promise;
        return res;
      }
      return realFetch(url, init);
    };
    const c2 = await rc(fetch);
    const p = c2.reconcile();
    await tick(80);
    invalidateCloudVisit();
    gate.resolve();
    expect(await p).toMatchObject({ kind: "stale" });
    expect(proof(first.key)).toBeDefined();
    expect(recon().authorities[0].cursor).toBe(Math.min(r1.changeSeq, r2.changeSeq));
    const next = page(await (await rc()).reconcile()); // a new visit needs a new handshake
    expect(next.items).toHaveLength(1);
    expect(recon().proofs).toHaveLength(2);
  });
});

describe("bounded pages and change_seq ordering", () => {
  it("120 remote changes over pages of at most 50, never a drain loop", async () => {
    const { key } = await cloudRun({ actions: [idea("a1")], run: false });
    const body = journal().entries.find((e) => e.key === key)!.body;
    const s = createCloudWorkflowSession({ fetch: rig.fetch });
    s.configure({ origin: BASE, token: TOKEN });
    await s.handshake();
    for (let i = 0; i < 119; i++) {
      const sub = await submitRequestOf({
        ...JSON.parse(JSON.stringify(body)),
        occurrenceId: `bulk-${i}`,
      });
      if (!sub.ok) throw new Error("submit");
      expect((await s.execute(sub.request, authority())).kind).toBe("answer");
    }
    const c = await rc();
    const sizes: number[] = [];
    const more: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      clearLog();
      const out = page(await c.reconcile());
      sizes.push(out.items.length);
      more.push(out.more);
      expect(sentNow().filter((r) => r.url.includes("/changes"))).toHaveLength(1);
      expect(sentNow().filter((r) => r.url.includes("/occurrences/")).length).toBeLessThanOrEqual(
        50,
      );
      expect(new URL(sentNow()[0].url).searchParams.get("limit")).toBe("50");
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(more).toEqual([true, true, false]);
    expect(recon().proofs).toHaveLength(120);
    expect(recon().proofs.filter((p) => p.source === "remote-initial")).toHaveLength(119);
    expect(journal().entries).toHaveLength(1); // no entry manufactured
  }, 120_000);

  it("a later completion of an old occurrence at equal timestamps is found by change_seq", async () => {
    rig.time.step = 0; // every Worker transition at the same instant
    const old = await cloudRun({ run: false });
    const newer = await cloudRun({ w: old.w });
    const c = await rc();
    page(await c.reconcile());
    expect(proof(old.key)!.outputs).toEqual([]);
    expect(await old.occ.run(old.key)).toMatchObject({ kind: "answered" });
    const out = page(await c.reconcile());
    expect(out.items).toEqual([
      expect.objectContaining({ occurrenceId: old.id, outcome: "proven" }),
    ]);
    expect(proof(newer.key)!.outputs).toHaveLength(3);
    expect(records()).toHaveLength(6);
  });
});

describe("capacity and retirement", () => {
  it("at 600 proofs a new occurrence pauses the page with proof-full and the cursor unchanged", async () => {
    const seed = await cloudRun({ actions: [idea("a1")] });
    const c = await rc();
    page(await c.reconcile());
    const p = proof(seed.key)!;
    const proofs = Array.from({ length: PROOF_CAPACITY - 1 }, (_, i) =>
      JSON.parse(
        JSON.stringify(p)
          .split(seed.id)
          .join(`cap-${String(i).padStart(4, "0")}`),
      ),
    );
    otherTab((s) => {
      s.cloudReconciliation.proofs = [...s.cloudReconciliation.proofs, ...proofs].sort(
        (x: A, y: A) => (x.key < y.key ? -1 : 1),
      );
    });
    const cursor = recon().authorities[0].cursor;
    const fresh = await cloudRun({ w: seed.w });
    const out = page(await c.reconcile());
    expect(out.blocked).toMatchObject({ occurrenceId: fresh.id, reason: "proof-full" });
    expect(recon().authorities[0].cursor).toBe(cursor);
    expect(recon().proofs).toHaveLength(PROOF_CAPACITY);
    expect(proof(fresh.key)).toBeUndefined();
    // The existing proof still updates at the cap.
    expect(await c.check(seed.key)).toMatchObject({ recorded: { ok: true } });
  }, 60_000);

  it("pruned retirement with a held old status across reload: tombstone, journal entry retired, no resurrection", async () => {
    const { key, id } = await cloudRun();
    const a = await rc();
    page(await a.reconcile());
    await useStore.persist.rehydrate();
    S().removeIdea(`wf:${id}:a1`);
    await savesSettled();
    expect(await a.ack(key)).toMatchObject({ kind: "answered" });
    // A held status (row) answered BEFORE the prune.
    const gate = deferred();
    rig.net.hold = gate.promise;
    const held = a.check(key);
    await tick();
    rig.time.ms += 91 * DAY; // past firstAck + 90 d: the next request purges
    const b = await rc();
    const out = await b.check(key);
    expect(out).toMatchObject({ kind: "answered", recorded: { ok: true, change: "retired" } });
    expect(proof(key)).toBeUndefined();
    expect(recon().tombstones).toEqual([
      expect.objectContaining({ key, deleted: [`wf:${id}:a1`] }),
    ]);
    expect(recon().authorities[0].retired).toBe(1);
    expect(journal().entries).toEqual([]); // ownership unchanged without it (active registration)
    await useStore.persist.rehydrate(); // reload
    gate.resolve();
    expect(await held).toMatchObject({ recorded: { ok: false, reason: "stale" } });
    expect(proof(key)).toBeUndefined();
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    // Never retired by absence or age alone: an absent status writes nothing.
    expect(await b.check(JSON.stringify([BASE, rig.owner, "never-submitted"]))).toMatchObject({
      recorded: null,
    });
    expect(recon().tombstones).toHaveLength(1);
  });
});

describe("journal retirement keeps the minimum history ownership needs", () => {
  it("a journal entry whose removal would change ownership resolution is kept (proof still retired)", async () => {
    const { key } = await cloudRun();
    const c = await rc();
    page(await c.reconcile());
    expect(await c.ack(key)).toMatchObject({ kind: "answered" });
    // Without any registration record the entry is the only ownership evidence (journal-only blocks; without it: local).
    otherTab((s) => (s.cloudRegistrations = { ...s.cloudRegistrations, records: [] }));
    await useStore.persist.rehydrate();
    rig.time.ms += 91 * DAY;
    expect(await (await rc()).check(key)).toMatchObject({
      recorded: { ok: true, change: "retired" },
    });
    expect(proof(key)).toBeUndefined();
    expect(recon().tombstones).toHaveLength(1);
    expect(journal().entries.map((e) => e.key)).toEqual([key]);
  });
});

describe("unreadable proof is never coerced to empty", () => {
  it("a malformed slice blocks reconciliation and ack, and every other write keeps its bytes verbatim", async () => {
    const { key } = await cloudRun();
    otherTab((s) => (s.cloudReconciliation = { v: 1, broken: true }));
    await useStore.persist.rehydrate();
    const kept = JSON.stringify(stored().cloudReconciliation);
    const c = await rc();
    expect(await c.reconcile()).toMatchObject({ kind: "refused", reason: "unreadable" });
    expect(await c.check(key)).toMatchObject({ kind: "refused", reason: "unreadable" });
    expect(await c.ack(key)).toMatchObject({ kind: "refused", reason: "unreadable" });
    S().addMicroAction({ ar: "س", en: "x" });
    await savesSettled();
    expect(JSON.stringify(stored().cloudReconciliation)).toBe(kept);
    expect(await S().reset(T_RESET)).toMatchObject({ ok: true });
    expect(JSON.stringify(stored().cloudReconciliation)).toBe(kept);
    expect(records()).toEqual([]);
  });
});

describe("privacy canaries and projections", () => {
  it("no token in storage or export; the private backup carries the slice; the public kit projection never does", async () => {
    const { key } = await cloudRun();
    const c = await rc();
    page(await c.reconcile());
    // The token lives only in Settings (pre-existing); never in the proof slice, its export or the journal.
    expect(JSON.stringify(stored().cloudReconciliation)).not.toContain(TOKEN);
    expect(JSON.stringify(stored().cloudJournal)).not.toContain(TOKEN);
    const exported = S().exportState();
    expect(JSON.stringify(JSON.parse(exported).state.cloudReconciliation)).not.toContain(TOKEN);
    expect(JSON.parse(exported).state.cloudReconciliation.proofs[0].key).toBe(key);
    const projection = JSON.stringify(kitProjection(S()));
    expect(projection).not.toContain("cloudReconciliation");
    expect(projection).not.toContain(rig.owner);
    expect(projection).not.toContain(BASE);
  });

  it("nothing in production constructs the controller; the persistence makes no request on its own", async () => {
    const before = rig.net.log.length;
    const r = await cloudReconciliationPersistence.snapshot(authority(), ["x"]);
    expect(r.ok).toBe(true);
    expect(rig.net.log.length).toBe(before);
    void (null as unknown as CloudRequest);
  });
});

/* ---------- ⚙️ DT-7C-2C-R1: deletion after retirement, bounded fold, reset on imported first proof ---------- */

const tombstone = (key: string) => recon().tombstones.find((t) => t.key === key) as A | undefined;
/** Adopt (real flow), take a genuine export, ack, let the Worker prune it (first ack + 90 d) and retire it by check. */
async function retiredAdoption(actions: A[] = [idea("a1"), post("a2"), plan("a3")], dirty = false) {
  const r = await cloudRun({ actions });
  const c = await rc();
  page(await c.reconcile());
  await useStore.persist.rehydrate();
  const old = backup();
  if (dirty) {
    S().toggleIdeaFavorite(`wf:${r.id}:a1`);
    await savesSettled();
  }
  expect(await c.ack(r.key)).toMatchObject({ kind: "answered" });
  rig.time.ms += 91 * DAY;
  expect(await c.check(r.key)).toMatchObject({ recorded: { ok: true, change: "retired" } });
  return { ...r, c, old };
}
/** `n` compact journal-only retirements (unknown final change_seq) through the real pure transition, as another tab. */
async function unknownRetirements(n: number) {
  let r = recon();
  for (let i = 0; i < n; i++) {
    const next = retireOccurrence(r, {
      authority: authority(),
      occurrenceId: `ret-${i}`,
      payloadDigest: "a".repeat(64),
      prunedAt: new Date(rig.time.ms + i).toISOString(),
      journalKnown: true,
    });
    if (!next.ok) throw new Error(next.reason);
    r = stamp(r, next.next, `retire-${i}`);
  }
  otherTab((s) => (s.cloudReconciliation = r));
  await useStore.persist.rehydrate();
}

describe("R1 7C2C-1: deleting an output after its proof retired is remembered", () => {
  it("idea/post/plan ordinary removals after retirement stay deleted on old-backup restore; a dirty draft is kept", async () => {
    const { key, id, old } = await retiredAdoption(undefined, true);
    const dirty = recordOf(`wf:${id}:a1`);
    expect(dirty!.favorite).toBe(true); // retirement never deletes a still-present (dirty) draft
    expect(tombstone(key)).toMatchObject({
      deleted: [],
      owned: [`wf:${id}:a1`, `wf:${id}:a2`, `wf:${id}:a3`],
    });
    S().removeIdea(`wf:${id}:a1`);
    S().removePost(`wf:${id}:a2`);
    S().removePlanItem(`wf:${id}:a3`);
    await savesSettled();
    expect(records()).toEqual([]);
    expect(tombstone(key)).toMatchObject({
      deleted: [`wf:${id}:a1`, `wf:${id}:a2`, `wf:${id}:a3`],
      owned: [],
    });
    expect(await S().importState(old)).toMatchObject({ ok: true });
    expect(records()).toEqual([]);
    expect(proof(key)).toBeUndefined();
  });

  it("positive control: without a removal the retired outputs restore from the old backup", async () => {
    const { key, id, old } = await retiredAdoption([idea("a1")]);
    expect(await S().importState(old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeDefined();
    expect(proof(key)).toBeUndefined(); // the tombstone still beats the old proof
    expect(tombstone(key)).toMatchObject({ owned: [`wf:${id}:a1`], deleted: [] });
  });

  it("reset and import removals after retirement are recorded; an old backup never resurrects them", async () => {
    const a = await retiredAdoption([idea("a1"), post("a2")]);
    // Import removal: a backup without the idea.
    const without = backup((s) => (s.ideas = s.ideas.filter((x: A) => x.id !== `wf:${a.id}:a1`)));
    expect(await S().importState(without)).toMatchObject({ ok: true });
    expect(tombstone(a.key)).toMatchObject({
      deleted: [`wf:${a.id}:a1`],
      owned: [`wf:${a.id}:a2`],
    });
    expect(await S().importState(a.old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${a.id}:a1`)).toBeUndefined();
    expect(recordOf(`wf:${a.id}:a2`)).toBeDefined();
    // Reset removal.
    expect(await S().reset(T_RESET)).toMatchObject({ ok: true });
    expect(tombstone(a.key)).toMatchObject({
      deleted: [`wf:${a.id}:a1`, `wf:${a.id}:a2`],
      owned: [],
    });
    expect(await S().importState(a.old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${a.id}:a1`)).toBeUndefined();
    expect(recordOf(`wf:${a.id}:a2`)).toBeUndefined();
  });

  it("old (C2C) and new backup formats both import; deletion evidence unions with the old format", async () => {
    const { key, id } = await retiredAdoption([idea("a1"), post("a2")]);
    const fresh = backup();
    const oldFormat = backup((s) =>
      s.cloudReconciliation.tombstones.forEach((t: A) => {
        delete t.owned;
        delete t.changeSeq;
      }),
    );
    S().removeIdea(`wf:${id}:a1`);
    await savesSettled();
    expect(await S().importState(oldFormat)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    expect(recordOf(`wf:${id}:a2`)).toBeDefined();
    expect(tombstone(key)).toMatchObject({ deleted: [`wf:${id}:a1`], owned: [`wf:${id}:a2`] });
    expect(await S().importState(fresh)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    expect(recordOf(`wf:${id}:a2`)).toBeDefined();
  });
});

describe("C1 retirement capacity never discards tombstones", () => {
  it("a pre-retirement deletion survives an old backup at the 100-marker bound", async () => {
    const { key, id } = await cloudRun({ actions: [idea("a1")] });
    const c = await rc();
    await c.reconcile();
    const old = backup();
    S().removeIdea(`wf:${id}:a1`);
    await savesSettled();
    await c.ack(key);
    rig.time.ms += 91 * DAY;
    expect(await c.check(key)).toMatchObject({ recorded: { ok: true, change: "retired" } });
    await unknownRetirements(99);
    expect(recon().tombstones).toHaveLength(100); // boundary: nothing folded yet
    expect(tombstone(key)).toBeDefined();
    const res = await S().importState(old);
    expect(res).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    expect(proof(key)).toBeUndefined();
  });

  it("newer work first learned from a backup still imports at the retirement bound", async () => {
    const first = await cloudRun({ actions: [idea("a1")] });
    const c = await rc();
    await c.reconcile();
    await c.ack(first.key);
    rig.time.ms += 91 * DAY;
    expect(await c.check(first.key)).toMatchObject({ recorded: { ok: true, change: "retired" } });
    await unknownRetirements(99);
    expect((recon().authorities[0] as A).watermark).toBeUndefined();
    const later = await cloudRun({ w: first.w }); // the same workflow: output a1 of a new occurrence
    await (await rc()).check(later.key);
    expect(recordOf(`wf:${later.id}:a1`)).toBeDefined();
    const withLater = backup();
    // A device that never learned it: no proof, no draft.
    otherTab((s) => {
      s.cloudReconciliation.proofs = s.cloudReconciliation.proofs.filter(
        (p: A) => p.key !== later.key,
      );
      s.ideas = s.ideas.filter((x: A) => x.id !== `wf:${later.id}:a1`);
    });
    await useStore.persist.rehydrate();
    const res = await S().importState(withLater);
    expect(res).toMatchObject({ ok: true });
    expect((res as A).retired).toBeUndefined();
    expect(proof(later.key)).toBeDefined();
    expect(recordOf(`wf:${later.id}:a1`)).toBeDefined();
  });

  it("the real pruned check refuses retirement-full and writes nothing even when a sequence is known", async () => {
    const { key } = await cloudRun({ actions: [idea("a1")] }); // journaled, never reconciled: no proof
    await unknownRetirements(100);
    const before = raw();
    rig.time.ms += 181 * DAY; // unacknowledged: finished + 180 d
    const c = await rc();
    expect(await c.check(key)).toMatchObject({
      kind: "answered",
      recorded: { ok: false, reason: "retirement-full" },
    });
    expect(raw()).toBe(before);
    expect(journal().entries.some((e) => e.key === key)).toBe(true);
    // Knowing the final sequence cannot replace per-output deletion history.
    otherTab((s) => (s.cloudReconciliation.tombstones[0].changeSeq = 1));
    await useStore.persist.rehydrate();
    const knownBefore = raw();
    expect(await (await rc()).check(key)).toMatchObject({
      recorded: { ok: false, reason: "retirement-full" },
    });
    expect(raw()).toBe(knownBefore);
    expect(recon().tombstones).toHaveLength(100);
    expect(tombstone(key)).toBeUndefined();
    expect((recon().authorities[0] as A).watermark).toBeUndefined();
  });
});

describe("R1 7C2C-3: reset suppression covers a proof first learned from a backup", () => {
  it("a browser that reset before learning the proof imports no pre-reset draft; unrelated drafts restore", async () => {
    const { key, id } = await cloudRun({ actions: [idea("a1")] });
    await (await rc()).reconcile();
    const plain = { id: "plain-1", text: "mine", source: "me", createdAt: T0.toISOString() };
    const old = backup((s) => s.ideas.push(plain));
    otherTab((s) => {
      delete s.cloudReconciliation;
      s.ideas = [];
    });
    await useStore.persist.rehydrate();
    expect((await S().reset(T_RESET)).ok).toBe(true);
    expect(await S().importState(old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    expect(recordOf("plain-1")).toEqual(plain);
    expect(dispositions(key)).toEqual(["suppressed"]);
  });

  it("positive control: a reset BEFORE the occurrence leaves its imported proof and draft intact", async () => {
    const { key, id } = await cloudRun({ actions: [idea("a1")] });
    await (await rc()).reconcile();
    const old = backup();
    otherTab((s) => {
      delete s.cloudReconciliation;
      s.ideas = [];
    });
    await useStore.persist.rehydrate();
    expect((await S().reset(new Date("2026-10-18T07:30:00.000Z"))).ok).toBe(true);
    expect(await S().importState(old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeDefined();
    expect(dispositions(key)).toEqual(["adopted"]);
  });
});

describe("C1 bounded retirement and reset compatibility", () => {
  it("refuses the 101st retirement without losing ownership or mutating storage", async () => {
    const first = await retiredAdoption([idea("a1")]);
    await unknownRetirements(99);
    const later = await cloudRun({ w: first.w });
    const c = await rc();
    await c.check(later.key);
    await c.ack(later.key);
    rig.time.ms += 91 * DAY;
    const before = raw();
    expect(await c.check(later.key)).toMatchObject({
      recorded: { ok: false, reason: "retirement-full" },
    });
    expect(raw()).toBe(before);
    expect(tombstone(first.key)?.owned).toContain(`wf:${first.id}:a1`);
    const old = backup();
    S().removeIdea(`wf:${first.id}:a1`);
    await savesSettled();
    expect(await S().importState(old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${first.id}:a1`)).toBeUndefined();
  });

  it("preserves legacy watermark state and refuses every restore without a write", async () => {
    const { key } = await retiredAdoption([idea("a1")]);
    otherTab((s) => {
      s.cloudReconciliation.authorities[0].watermark =
        s.cloudReconciliation.tombstones[0].changeSeq;
      s.cloudReconciliation.tombstones = [];
    });
    await useStore.persist.rehydrate();
    const old = backup();
    const legacy = backup((s) => {
      delete s.cloudReconciliation;
    });
    const before = raw();
    for (const file of [old, legacy]) {
      expect(await S().importState(file)).toMatchObject({
        ok: false,
        reason: "journal-conflict",
        scope: "reconciliation",
      });
      expect(raw()).toBe(before);
    }
    expect(tombstone(key)).toBeUndefined();
  });

  it("legacy watermark never permits a first status to erase missing deletion history", async () => {
    const { key, id } = await cloudRun({ actions: [idea("a1")] });
    const c = await rc();
    await c.check(key);
    const seq = proof(key)!.receipt.changeSeq;
    otherTab((s) => {
      s.cloudReconciliation.authorities = [
        {
          key: JSON.stringify([BASE, rig.owner]),
          authority: authority(),
          cursor: 0,
          retired: 1,
          watermark: seq,
        },
      ];
      s.cloudReconciliation.proofs = [];
      s.ideas = [];
    });
    await useStore.persist.rehydrate();
    expect(await (await rc()).check(key)).toMatchObject({
      recorded: { ok: false, reason: "retired" },
    });
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
  });

  it("a first-learned retired marker obeys reset, including old markers without execution time", async () => {
    const { id } = await retiredAdoption([idea("a1")]);
    const old = backup();
    const legacy = backup((s) =>
      s.cloudReconciliation.tombstones.forEach((t: A) => {
        delete t.executionAt;
      }),
    );
    for (const file of [old, legacy]) {
      otherTab((s) => {
        delete s.cloudReconciliation;
        s.ideas = [];
      });
      await useStore.persist.rehydrate();
      expect((await S().reset(new Date(rig.time.ms + DAY))).ok).toBe(true);
      expect(await S().importState(file)).toMatchObject({ ok: true });
      expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
    }
  });

  it("known post-reset retired output and unrelated ordinary drafts still restore", async () => {
    const { key, id } = await retiredAdoption([idea("a1")]);
    expect(tombstone(key)?.executionAt).toBe(T_CAP.toISOString());
    const old = backup((s) =>
      s.ideas.push({ id: "ordinary", text: "mine", source: "me", createdAt: T0.toISOString() }),
    );
    otherTab((s) => {
      delete s.cloudReconciliation;
      s.ideas = [];
    });
    await useStore.persist.rehydrate();
    expect((await S().reset(new Date("2026-10-18T07:30:00.000Z"))).ok).toBe(true);
    expect(await S().importState(old)).toMatchObject({ ok: true });
    expect(recordOf(`wf:${id}:a1`)).toBeDefined();
    expect(recordOf("ordinary")).toBeDefined();
  });

  it("a first-learned legacy marker without ownership cannot restore ambiguous pre-reset drafts", async () => {
    const { id } = await retiredAdoption([idea("a1")]);
    const old = backup((s) =>
      s.cloudReconciliation.tombstones.forEach((t: A) => {
        delete t.owned;
        delete t.executionAt;
      }),
    );
    otherTab((s) => {
      delete s.cloudReconciliation;
      s.ideas = [];
    });
    await useStore.persist.rehydrate();
    expect((await S().reset(new Date(rig.time.ms + DAY))).ok).toBe(true);
    const before = raw();
    expect(await S().importState(old)).toMatchObject({
      ok: false,
      reason: "journal-conflict",
      scope: "reconciliation",
    });
    expect(raw()).toBe(before);
    expect(recordOf(`wf:${id}:a1`)).toBeUndefined();
  });

  it("an imported legacy watermark cannot introduce missing history into a clean device", async () => {
    await retiredAdoption([idea("a1")]);
    const old = backup((s) => {
      s.cloudReconciliation.authorities[0].watermark =
        s.cloudReconciliation.tombstones[0].changeSeq;
      s.cloudReconciliation.tombstones = [];
    });
    otherTab((s) => {
      delete s.cloudReconciliation;
      s.ideas = [];
    });
    await useStore.persist.rehydrate();
    const before = raw();
    expect(await S().importState(old)).toMatchObject({
      ok: false,
      reason: "journal-conflict",
      scope: "reconciliation",
    });
    expect(raw()).toBe(before);
  });

  it("a retired-only backup refuses when the current reset history is unreadable", async () => {
    await retiredAdoption([idea("a1")]);
    const old = backup((s) => {
      delete s.cloudJournal;
    });
    otherTab((s) => {
      delete s.cloudReconciliation;
      s.cloudJournal = { broken: true };
      s.ideas = [];
    });
    await useStore.persist.rehydrate();
    const before = raw();
    expect(await S().importState(old)).toMatchObject({
      ok: false,
      reason: "journal-unreadable",
      scope: "reconciliation",
    });
    expect(raw()).toBe(before);
  });
});

describe("R1 real builder partial/failed receipts are adopted and acknowledged (no Worker failure hook)", () => {
  for (const state of ["partial", "failed"])
    it(`${state}: an empty bilingual idea text makes the real shared builder fail`, async () => {
      const seed = await cloudRun({ actions: [idea("a1")], run: false });
      const original = journal().entries.find((e) => e.key === seed.key)!;
      const body = JSON.parse(JSON.stringify(original.body));
      body.occurrenceId = `real-${state}`;
      const bad = { ...idea("bad"), text: { ar: "", en: "" } };
      body.snapshot.actions =
        state === "partial" ? [idea("ok"), bad, idea("skip")] : [bad, idea("skip")];
      const s = createCloudWorkflowSession({ fetch: rig.fetch });
      s.configure({ origin: BASE, token: TOKEN });
      await s.handshake();
      const submit = await s.execute(
        { kind: "submit", body, payloadDigest: await payloadDigestOf(body) },
        authority(),
      );
      expect(submit).toMatchObject({ kind: "answer", parsed: { outcome: "ok" } });
      expect(
        await s.execute(
          { kind: "run", ownerKey: rig.owner, occurrenceId: body.occurrenceId },
          authority(),
        ),
      ).toMatchObject({ kind: "answer", parsed: { outcome: "ok" } });
      const receipt = await workerReceipt(body.occurrenceId);
      expect(receipt.state).toBe(state);
      const key = JSON.stringify([BASE, rig.owner, body.occurrenceId]);
      const c = await rc();
      expect(await c.check(key)).toMatchObject({ recorded: { ok: true, delivered: true } });
      expect(proof(key)?.receipt.state).toBe(state);
      expect(proof(key)?.outputs).toHaveLength(state === "partial" ? 1 : 0);
      if (state === "partial") expect(recordOf(`wf:${body.occurrenceId}:ok`)).toBeDefined();
      expect(await c.ack(key)).toMatchObject({ kind: "answered", parsed: { acknowledged: true } });
    });
});
