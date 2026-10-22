// @vitest-environment jsdom
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientFetch, ClientResponse } from "@/lib/cloudWorkflowClient";
import { readJournal, type CloudJournal } from "@/lib/cloudWorkflowJournal";
import { createRegistrationController } from "@/lib/cloudWorkflowRegistrationClient";
import {
  createOccurrenceController,
  type OccurrenceResult,
} from "@/lib/cloudWorkflowOccurrenceClient";
import { workflowDigestOf } from "@/lib/cloudWorkflowCapture";
import type { Workflow } from "@/lib/domain";
import {
  STORAGE_KEY,
  articleBase,
  cloudFence,
  cloudOccurrencePersistence,
  cloudRegistrationPersistence,
  hydrateStore,
  invalidateCloudVisit,
  readCloudOccurrence,
  savesSettled,
  setArticlesLock,
  useStore,
  workflowBase,
  type ArticlesLock,
} from "./index";

// ⚙️ DT-7C-2B-4 saved-occurrence delivery (planning/tools/38-cloud-workflows.md): REAL capture into the REAL store journal,
// the verified durable reader, and explicit Submit / Check status / Run / Cancel through the occurrence controller against
// the REAL Worker router + SQLite coordinator behind a fake in-memory transport (no live Worker, no network). Also the
// immediate configuration/visit fences of the existing store capture. Isolated jsdom storage.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec); // eslint-disable-line @typescript-eslint/no-explicit-any

const S = () => useStore.getState();
const TOKEN = "occurrence-token-CANARY-7c2b4";
const TOKEN_B = "occurrence-token-other-7c2b4";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://scout.test";
const OTHER = "https://other.test";
const T_BASE = new Date("2026-01-01T00:00:00.000Z");
const T0 = new Date("2026-10-18T07:00:00.000Z");
/** The capture instant: after the router's registration (08:00:0x) and within its 10-minute admission skew. */
const T_CAP = new Date("2026-10-18T08:05:00.000Z");
const T_RESET = new Date("2026-10-18T10:00:00.000Z");
const complete = {
  title: { ar: "تلوين الليل", en: "Night grading" },
  summary: { ar: "ملخص", en: "Summary" },
  body: { ar: "## مقدمة\n\nنص", en: "## Intro\n\nText" },
  slug: "night-grading",
};
const idea = (id: string, en = "Idea {date}") => ({
  id,
  kind: "idea" as const,
  text: { ar: "", en },
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
/** This realm's bytes (jsdom's Response yields another realm's Uint8Array). */
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
async function makeRig(token = TOKEN) {
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
  const env = { SCOUT_TOKEN: token, ALLOWED_ORIGINS: APP, WORKFLOW_COORDINATOR: ns };
  let clockMs = Date.UTC(2026, 9, 18, 8, 0, 0);
  const clock = () => new Date((clockMs += 1000));
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
  ctl.configure({ origin: BASE, token });
  const h = await ctl.handshake();
  if (!h.ok) throw new Error(h.reason);
  return { ctl, net, fetch: fetchFn, owner: h.authority.ownerKey as string };
}
const authority = () => ({ origin: BASE, ownerKey: rig.owner });
/** Occurrence requests (everything but authority handshakes) since the last clear. */
const sent = () => rig.net.log.filter((r) => !r.url.endsWith("/social/workflows/authority"));
const clearLog = () => void (rig.net.log.length = 0);

async function register(w: Workflow) {
  const workflowDigest = (await workflowDigestOf(w))!;
  return rig.ctl.register({
    kind: "register",
    ownerKey: rig.owner,
    workflowId: w.id,
    expectedEpoch: 0,
    revision: w.revision,
    workflowDigest,
  });
}
async function controller(fetch: ClientFetch = rig.fetch, origin = BASE, token = TOKEN) {
  const c = createOccurrenceController({ fetch, persistence: cloudOccurrencePersistence });
  expect(c.configure({ origin, token }).ok).toBe(true);
  expect(await c.handshake()).toMatchObject({ ok: true });
  return c;
}
const is = <K extends OccurrenceResult["kind"]>(r: OccurrenceResult, k: K) => {
  expect(r).toMatchObject({ kind: k });
  return r as Extract<OccurrenceResult, { kind: K }>;
};

/* ---------- store helpers ---------- */

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
/** A lock whose next holder waits for `release()`. */
function gateLock() {
  const inner = queueLock();
  let open: () => void = () => undefined;
  let requested: () => void = () => undefined;
  const gate = new Promise<void>((r) => (open = r));
  const asked = new Promise<void>((r) => (requested = r));
  let armed = true;
  let calls = 0;
  const lock: ArticlesLock = (fn) => {
    calls += 1;
    if (!armed) return inner(fn);
    armed = false;
    requested();
    return inner(async () => {
      await gate;
      return fn();
    });
  };
  return { lock, asked, release: () => open(), calls: () => calls };
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
const entryOf = (key: string) => journal().entries.find((e) => e.key === key)!;
const otherTab = (edit: (state: A) => void) => {
  const r = JSON.parse(raw());
  edit(r.state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
};
async function workflow(input: A = {}): Promise<Workflow> {
  const r = await S().addWorkflow(
    { name: { ar: "", en: "Flow" }, trigger: { kind: "manual" }, actions: [idea("a1")], ...input },
    T0,
  );
  if (!r.ok) throw new Error(r.reason);
  return r.workflow;
}
const readyWorkflow = (actions: A[] = [idea("a1", "Read {title}")]) =>
  workflow({ name: { ar: "", en: "On ready" }, trigger: { kind: "article-ready" }, actions });
async function draftArticle(slug = complete.slug) {
  const a = await S().addArticle({}, T0);
  if (!a.ok) throw new Error(a.reason);
  const r = await S().updateArticle(
    a.article.id,
    { ...complete, slug },
    articleBase(a.article),
    T0,
  );
  if (!r.ok) throw new Error(r.reason);
  return r.article;
}
async function registered(w: Workflow) {
  expect(await register(w)).toMatchObject({ kind: "recorded", state: "settled" });
}
/** One registered manual workflow and its captured cloud occurrence (real capture). */
async function cloudEntry(input: A = {}) {
  const w = await workflow(input);
  await registered(w);
  const r = await S().captureManualRun(w.id, { authority: authority() }, T_CAP);
  expect(r.kind).toBe("cloud");
  if (r.kind !== "cloud") throw new Error("not cloud");
  return { w, key: r.entry.key };
}
const submitted = (key: string) => {
  const e = entryOf(key);
  return JSON.stringify({ body: e.body, payloadDigest: e.payloadDigest });
};
/** An import file from what storage holds, edited. */
const backup = (edit: (state: A) => void = () => undefined) => {
  const state = JSON.parse(raw()).state;
  edit(state);
  return JSON.stringify({ app: "3z-prod", version: 1, exportedAt: T_CAP.toISOString(), state });
};

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

describe("the generation observer: every origin/token change bumps the in-memory fence synchronously", () => {
  it("setters, direct updates, A-B-A, import, reset and rehydration; equal values and other settings do not", async () => {
    const c0 = cloudFence().config;
    S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    S().setSettings({ lang: S().settings.lang === "ar" ? "en" : "ar" });
    expect(cloudFence().config).toBe(c0);
    S().setSettings({ apiKeys: { scoutUrl: OTHER, scoutToken: TOKEN } });
    expect(cloudFence().config).toBe(c0 + 1);
    S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    expect(cloudFence().config).toBe(c0 + 2); // A -> B -> A: two transitions, never a final-value comparison
    useStore.setState({
      settings: { ...S().settings, apiKeys: { scoutUrl: BASE, scoutToken: TOKEN_B } },
    });
    expect(cloudFence().config).toBe(c0 + 3);
    useStore.setState({
      settings: { ...S().settings, apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } },
    });
    await savesSettled();
    const c1 = cloudFence().config;
    otherTab((s) => (s.settings.apiKeys = { scoutUrl: OTHER, scoutToken: TOKEN }));
    await useStore.persist.rehydrate();
    expect(cloudFence().config).toBe(c1 + 1);
    otherTab((s) => (s.settings.apiKeys = { scoutUrl: BASE, scoutToken: TOKEN }));
    await useStore.persist.rehydrate();
    expect(cloudFence().config).toBe(c1 + 2);
    const c2 = cloudFence().config;
    expect(
      await S().importState(
        backup((s) => (s.settings.apiKeys = { scoutUrl: OTHER, scoutToken: TOKEN })),
      ),
    ).toMatchObject({ ok: true });
    expect(cloudFence().config).toBeGreaterThan(c2);
    const c3 = cloudFence().config;
    expect(await S().reset(T_RESET)).toMatchObject({ ok: true });
    expect(cloudFence().config).toBeGreaterThan(c3); // reset clears the Worker settings
    const v = cloudFence().visit;
    invalidateCloudVisit();
    expect(cloudFence()).toMatchObject({ visit: v + 1 });
    expect(rig.net.log.filter((r) => r.method === "POST")).toHaveLength(0);
  });
});

describe("the verified durable reader", () => {
  it("reads by the full key: a detached, frozen saved body with its immutable identity, never Settings", async () => {
    const { w, key } = await cloudEntry();
    S().setSettings({ apiKeys: { scoutUrl: OTHER, scoutToken: TOKEN_B } });
    const fresh = S().workflows.find((x) => x.id === w.id)!;
    await S().updateWorkflow(w.id, { name: { ar: "", en: "Renamed" } }, workflowBase(fresh), T_CAP);
    const r = await readCloudOccurrence(key);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = entryOf(key);
    expect(r.entry).toMatchObject({
      key,
      authority: e.authority,
      occurrenceId: e.occurrenceId,
      workflowId: w.id,
      body: e.body,
      payloadDigest: e.payloadDigest,
      executionAt: T_CAP.toISOString(),
      commitId: e.commitId,
      state: "queued",
    });
    expect(Object.isFrozen(r.entry.body)).toBe(true);
    expect(JSON.stringify(r.entry)).not.toContain(TOKEN);
    expect(r.entry.body.snapshot).toMatchObject({ name: { en: "Flow" } });
  });

  it("missing, non-string, unreadable and digest-tampered entries refuse", async () => {
    const { key } = await cloudEntry();
    expect(await readCloudOccurrence("nope")).toEqual({ ok: false, reason: "missing" });
    expect(await readCloudOccurrence(42)).toEqual({ ok: false, reason: "invalid" });
    const good = raw();
    otherTab((s) => (s.cloudJournal.entries[0].payloadDigest = "a".repeat(64)));
    expect(await readCloudOccurrence(key)).toEqual({ ok: false, reason: "invalid" });
    otherTab((s) => (s.cloudJournal = { v: 9 }));
    expect(await readCloudOccurrence(key)).toEqual({ ok: false, reason: "unreadable" });
    localStorage.setItem(STORAGE_KEY, good);
    expect((await readCloudOccurrence(key)).ok).toBe(true);
  });

  it("rechecks the exact durable snapshot under the lock after its asynchronous validation (moved)", async () => {
    const { key } = await cloudEntry();
    const gate = gateLock();
    setArticlesLock(gate.lock);
    const p = readCloudOccurrence(key);
    await gate.asked;
    otherTab((s) => (s.cloudJournal.entries[0].commitId = "moved-elsewhere"));
    gate.release();
    expect(await p).toEqual({ ok: false, reason: "moved" });
  });
});

describe("explicit Submit of the saved occurrence", () => {
  it("Manual: exactly the saved bytes, one POST, observed through the journal API; no Run, retry or ack", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    clearLog();
    const r = is(await c.submit(key), "answered");
    expect(r.parsed).toMatchObject({ outcome: "ok", kind: "submit", created: true });
    expect(r.recorded).toEqual({ persisted: true, changed: true });
    expect(sent()).toEqual([
      { method: "POST", url: `${BASE}/social/workflows/occurrences`, body: submitted(key) },
    ]);
    await tick();
    expect(sent()).toHaveLength(1); // never chained: no run, status, ack or feed
    const e = entryOf(key);
    expect(e.observation?.binding).toMatchObject({
      kind: "submit",
      payloadDigest: e.payloadDigest,
    });
    expect(e.observation?.receipt).toMatchObject({ state: "pending", receiptVersion: 1 });
    expect(e.state).toBe("queued");
    expect(S().workflowRuns).toEqual([]);
  });

  it("mixed Ready: the cloud member submits its saved bytes after the workflow and article were edited", async () => {
    const local = await readyWorkflow();
    const cloud = await readyWorkflow([idea("c1", "Share {title} ({slug})")]);
    await registered(cloud);
    const a = await draftArticle();
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_CAP);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    const key = r.entries[0].key;
    const before = submitted(key);
    const wf = S().workflows.find((x) => x.id === cloud.id)!;
    expect(
      (
        await S().updateWorkflow(
          cloud.id,
          { actions: [idea("c1", "Changed {title}")] },
          workflowBase(wf),
          T_CAP,
        )
      ).ok,
    ).toBe(true);
    const art = S().articles.find((x) => x.id === a.id)!;
    await S().updateArticle(
      a.id,
      { title: { ar: "", en: "Edited after" } },
      articleBase(art),
      T_CAP,
    );
    const c = await controller();
    clearLog();
    expect(is(await c.submit(key), "answered").parsed).toMatchObject({ created: true });
    expect(sent().map((x) => x.body)).toEqual([before]);
    expect(before).toContain("Night grading");
    expect(S().workflowRuns.filter((x) => x.workflowId === local.id)).toHaveLength(1);
    expect(S().workflowRuns.filter((x) => x.workflowId === cloud.id)).toEqual([]);
  });

  it("a lost Submit is unconfirmed; an explicit identical Submit converges through Worker idempotency", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    clearLog();
    rig.net.mode = "lose";
    const lost = is(await c.submit(key), "unconfirmed");
    expect(lost).toMatchObject({ action: "submit", dispatched: true });
    expect(entryOf(key).observation).toBeNull();
    await tick();
    expect(sent()).toHaveLength(1); // no automatic retry
    rig.net.mode = "deliver";
    const again = is(await c.submit(key), "answered");
    expect(again.parsed).toMatchObject({ outcome: "ok", kind: "submit", created: false });
    expect(again.recorded).toEqual({ persisted: true, changed: true });
    const bodies = sent().map((x) => x.body);
    expect(bodies).toEqual([submitted(key), submitted(key)]);
    const st = is(await c.status(key), "answered");
    expect(st.parsed).toMatchObject({ result: { found: "row", receipt: { receiptVersion: 1 } } });
    expect(st.recorded).toEqual({ persisted: true, changed: false });
  });

  it("nothing starts on construction, hydration, reconnect, import, reset or after an error", async () => {
    const { key } = await cloudEntry();
    clearLog();
    const c = createOccurrenceController({
      fetch: rig.fetch,
      persistence: cloudOccurrencePersistence,
    });
    await hydrateStore();
    c.configure({ origin: BASE, token: TOKEN });
    await c.handshake();
    await c.handshake();
    expect(sent()).toEqual([]);
    rig.net.mode = "lose";
    await c.submit(key);
    rig.net.mode = "deliver";
    expect(await S().importState(backup())).toMatchObject({ ok: true });
    await tick();
    expect(sent()).toHaveLength(1);
    expect(await S().reset(T_RESET)).toMatchObject({ ok: true, retained: 1 });
    await hydrateStore();
    await tick();
    expect(sent()).toHaveLength(1);
  });
});

describe("explicit Check status, Run and Cancel, bound to the original saved snapshot", () => {
  it("Status, Run and Status again: one request each, the saved owner/id, receipts bound to the saved body", async () => {
    const { w, key } = await cloudEntry();
    const c = await controller();
    await c.submit(key);
    const fresh = S().workflows.find((x) => x.id === w.id)!;
    await S().updateWorkflow(
      w.id,
      { actions: [idea("a1", "Edited {date}")] },
      workflowBase(fresh),
      T_CAP,
    );
    clearLog();
    const e = entryOf(key);
    const st = is(await c.status(key), "answered");
    expect(st.parsed).toMatchObject({ result: { found: "row", receipt: { state: "pending" } } });
    const run = is(await c.run(key), "answered");
    expect(run.parsed).toMatchObject({ outcome: "ok", kind: "run" });
    expect(run.recorded).toEqual({ persisted: true, changed: true });
    const after = is(await c.status(key), "answered");
    expect(after.recorded).toEqual({ persisted: true, changed: false });
    expect(sent().map((x) => [x.method, x.url])).toEqual([
      ["GET", `${BASE}/social/workflows/occurrences/${e.occurrenceId}?ownerKey=${rig.owner}`],
      ["POST", `${BASE}/social/workflows/occurrences/${e.occurrenceId}/run`],
      ["GET", `${BASE}/social/workflows/occurrences/${e.occurrenceId}?ownerKey=${rig.owner}`],
    ]);
    const rec = entryOf(key).observation!.receipt as A;
    expect(rec.body).toEqual(e.body);
    expect(rec.receiptVersion).toBeGreaterThan(1);
  });

  it("Cancel a pending occurrence; a later Run executes nothing more; never chained", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    await c.submit(key);
    clearLog();
    const x = is(await c.cancel(key), "answered");
    expect(x.parsed).toMatchObject({ outcome: "ok", kind: "cancel", cancelled: true });
    expect(entryOf(key).observation?.receipt).toMatchObject({ state: "cancelled" });
    const run = is(await c.run(key), "answered");
    expect(run.parsed).toMatchObject({ outcome: "ok", kind: "run", stopped: "terminal" });
    expect(sent()).toHaveLength(2);
  });

  it("before Submit: status is absent (nothing recorded), Run and Cancel are typed absent refusals", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    clearLog();
    const st = is(await c.status(key), "answered");
    expect(st.parsed).toMatchObject({ result: { found: "absent" } });
    expect(st.recorded).toBeNull();
    expect(is(await c.run(key), "answered").parsed).toMatchObject({
      outcome: "refused",
      error: "absent",
    });
    expect(is(await c.cancel(key), "answered").parsed).toMatchObject({
      outcome: "refused",
      error: "absent",
    });
    expect(entryOf(key).observation).toBeNull();
  });

  it("a receipt for another body (tampered answer) is unconfirmed and never recorded", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    await c.submit(key);
    const before = entryOf(key).observation;
    rig.net.rewrite = (text) => text.replace('"day":"2026-10-18"', '"day":"2026-10-19"');
    expect(await c.status(key)).toMatchObject({ kind: "unconfirmed", category: "invalid_answer" });
    rig.net.rewrite = null;
    expect(entryOf(key).observation).toEqual(before);
  });
});

describe("reset / suppression recovery policy", () => {
  it("a suppressed entry refuses Submit and Run; Status and Cancel recover it and it stays suppressed", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    await c.submit(key);
    expect(await S().reset(T_RESET)).toEqual({ ok: true, retained: 1 });
    S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    await savesSettled();
    await c.handshake();
    clearLog();
    expect(await c.submit(key)).toMatchObject({ kind: "refused", reason: "suppressed" });
    expect(await c.run(key)).toMatchObject({ kind: "refused", reason: "suppressed" });
    expect(sent()).toEqual([]);
    expect(is(await c.status(key), "answered").parsed).toMatchObject({ result: { found: "row" } });
    const x = is(await c.cancel(key), "answered");
    expect(x.parsed).toMatchObject({ kind: "cancel", cancelled: true });
    expect(x.recorded).toEqual({ persisted: true, changed: true });
    expect(entryOf(key)).toMatchObject({ state: "suppressed" });
    expect(S().workflowRuns).toEqual([]);
    expect(sent().map((r) => r.method)).toEqual(["GET", "POST"]);
  });

  it("a reset landing during held validation: zero requests", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    clearLog();
    const gate = gateLock();
    setArticlesLock(gate.lock);
    const p = c.status(key);
    await gate.asked;
    const reset = S().reset(T_RESET);
    gate.release();
    expect(await p).toMatchObject({ kind: "refused" });
    expect(await reset).toMatchObject({ ok: true });
    expect(sent()).toEqual([]);
  });

  it("an import advancing suppression, or changing the Worker settings, during held validation: zero requests", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    clearLog();
    for (const edit of [
      (s: A) => {
        s.cloudJournal.suppression = { epoch: 1, resetAt: T_RESET.toISOString(), commitId: "x1" };
        for (const e of s.cloudJournal.entries) e.state = "suppressed";
      },
      (s: A) => (s.settings.apiKeys = { scoutUrl: OTHER, scoutToken: TOKEN }),
    ]) {
      const file = backup(edit);
      const gate = gateLock();
      setArticlesLock(gate.lock);
      const p = c.submit(key);
      await gate.asked;
      const imp = S().importState(file);
      // The import (after its own asynchronous revalidation) is queued behind the held read, before the dispatch.
      await vi.waitFor(() => expect(gate.calls()).toBe(2));
      gate.release();
      expect((await p).kind).toBe("refused");
      expect(await imp).toMatchObject({ ok: true });
    }
    expect(sent()).toEqual([]);
  });
});

describe("A-B-A configuration and visit fences", () => {
  const moves: [string, () => void | Promise<void>][] = [
    [
      "origin A-B-A (setter)",
      () => {
        S().setSettings({ apiKeys: { scoutUrl: OTHER, scoutToken: TOKEN } });
        S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
      },
    ],
    [
      "token A-B-A (direct update)",
      () => {
        useStore.setState({
          settings: { ...S().settings, apiKeys: { scoutUrl: BASE, scoutToken: TOKEN_B } },
        });
        useStore.setState({
          settings: { ...S().settings, apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } },
        });
      },
    ],
    [
      "origin A-B-A (another tab, rehydration)",
      async () => {
        otherTab((s) => (s.settings.apiKeys = { scoutUrl: OTHER, scoutToken: TOKEN }));
        await useStore.persist.rehydrate();
        otherTab((s) => (s.settings.apiKeys = { scoutUrl: BASE, scoutToken: TOKEN }));
        await useStore.persist.rehydrate();
      },
    ],
    ["visit change", () => invalidateCloudVisit()],
  ];

  for (const [name, move] of moves) {
    it(`controller: ${name} during held validation sends nothing; the old authority needs a new handshake`, async () => {
      const { key } = await cloudEntry();
      const c = await controller();
      clearLog();
      const gate = gateLock();
      setArticlesLock(gate.lock);
      const p = c.submit(key);
      await gate.asked;
      await move();
      gate.release();
      expect(await p).toMatchObject({ kind: "refused", reason: "superseded", dispatched: false });
      setArticlesLock(queueLock());
      expect(await c.submit(key)).toMatchObject({ kind: "refused", reason: "handshake_required" });
      expect(sent()).toEqual([]);
      await c.handshake();
      expect(await c.submit(key)).toMatchObject({ kind: "answered" });
    });

    it(`store capture: ${name} during preparation refuses the capture (stale), zero writes`, async () => {
      const w = await workflow();
      await registered(w);
      const gate = gateLock();
      setArticlesLock(gate.lock);
      const p = S().captureManualRun(w.id, { authority: authority() }, T_CAP);
      await gate.asked;
      await move();
      gate.release();
      expect(await p).toMatchObject({ kind: "refused", reason: "stale" });
      expect(journal().entries).toHaveLength(0);
    });
  }

  it("store capture: the latest action per target wins (cloud)", async () => {
    const w = await workflow();
    await registered(w);
    const gate = gateLock();
    setArticlesLock(gate.lock);
    const first = S().captureManualRun(w.id, { authority: authority() }, T_CAP);
    await gate.asked;
    const second = S().captureManualRun(w.id, { authority: authority() }, T_CAP);
    gate.release();
    expect(await first).toMatchObject({ kind: "refused", reason: "stale" });
    expect(await second).toMatchObject({ kind: "cloud" });
    expect(journal().entries).toHaveLength(1);
  });

  it("store capture: the latest action per target wins (local); another target is independent", async () => {
    // Local members write no journal, so the existing journal dependency cannot make the other target stale.
    const w = await workflow();
    const v = await workflow();
    const gate = gateLock();
    setArticlesLock(gate.lock);
    const first = S().captureManualRun(w.id, {}, T_CAP);
    await gate.asked;
    const second = S().captureManualRun(w.id, {}, T_CAP);
    const other = S().captureManualRun(v.id, {}, T_CAP);
    gate.release();
    expect(await first).toMatchObject({ kind: "refused", reason: "stale" });
    expect(await second).toMatchObject({ kind: "local" });
    expect(await other).toMatchObject({ kind: "local" });
    expect(stored().workflowRuns).toHaveLength(2);
  });

  it("store capture control: an unchanged configuration (equal re-save) still captures", async () => {
    const w = await workflow();
    await registered(w);
    const gate = gateLock();
    setArticlesLock(gate.lock);
    const p = S().captureManualRun(w.id, { authority: authority() }, T_CAP);
    await gate.asked;
    S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    gate.release();
    expect(await p).toMatchObject({ kind: "cloud" });
  });

  it("local-only capture control: a local run, zero requests; the controller has nothing to submit for it", async () => {
    const w = await workflow();
    const c = await controller();
    clearLog();
    const r = await S().captureManualRun(w.id, {}, T_CAP);
    expect(r.kind).toBe("local");
    if (r.kind !== "local") return;
    expect(journal().entries).toEqual([]);
    expect(await c.submit(r.run.id)).toMatchObject({ kind: "refused", reason: "missing" });
    expect(sent()).toEqual([]);
  });
});

describe("concurrent sessions and late answers", () => {
  it("two sessions submitting the same saved occurrence converge on one Worker occurrence", async () => {
    const { key } = await cloudEntry();
    const [c1, c2] = [await controller(), await controller()];
    clearLog();
    const [x, y] = await Promise.all([c1.submit(key), c2.submit(key)]);
    const answers = [is(x, "answered"), is(y, "answered")];
    expect(answers.map((r) => (r.parsed as A).created).sort()).toEqual([false, true]);
    expect(sent().map((r) => r.body)).toEqual([submitted(key), submitted(key)]);
    expect(answers.filter((r) => r.recorded?.persisted && r.recorded.changed)).toHaveLength(1);
    expect(entryOf(key).observation?.receipt).toMatchObject({ receiptVersion: 1 });
  });

  it("a late answer after a visit change is stale and is recorded only on its own occurrence", async () => {
    const one = await cloudEntry();
    const two = await cloudEntry({ name: { ar: "", en: "Second" } });
    const c = await controller();
    await c.submit(two.key);
    const twoBefore = entryOf(two.key).observation;
    const hold = deferred();
    rig.net.hold = hold.promise;
    const p = c.submit(one.key);
    await tick();
    invalidateCloudVisit();
    hold.resolve();
    const r = is(await p, "stale");
    expect(r).toMatchObject({ action: "submit", key: one.key, dispatched: true });
    expect(r.recorded).toEqual({ persisted: true, changed: true });
    expect(entryOf(one.key).observation?.binding).toMatchObject({ kind: "submit" });
    expect(entryOf(two.key).observation).toEqual(twoBefore);
  });

  it("a newer action supersedes a dispatched Submit (still dispatched); recovery is an explicit identical Submit", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    clearLog();
    const hold = deferred();
    rig.net.hold = hold.promise;
    const first = c.submit(key);
    await tick();
    const st = await c.status(key);
    expect(await first).toMatchObject({ kind: "stale", dispatched: true, recorded: null });
    hold.resolve();
    expect(is(st, "answered").parsed).toMatchObject({ result: { found: "row" } });
    const again = is(await c.submit(key), "answered");
    expect(again.parsed).toMatchObject({ created: false });
    expect(
      sent()
        .filter((r) => r.method === "POST")
        .map((r) => r.body),
    ).toEqual([submitted(key), submitted(key)]);
  });

  it("observation write or read-back failure is reported unpersisted", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    await savesSettled();
    const real = Storage.prototype.setItem;
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    const r = is(await c.submit(key), "answered");
    quota.mockRestore();
    expect(r.recorded).toEqual({ persisted: false, reason: "not-persisted" });
    expect(entryOf(key).observation).toBeNull();
    const drop = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k !== STORAGE_KEY) real.call(this, k, v);
    });
    const r2 = is(await c.status(key), "answered");
    drop.mockRestore();
    expect(r2.recorded).toEqual({ persisted: false, reason: "not-persisted" });
    expect(entryOf(key).observation).toBeNull();
  });
});

describe("foreign authority / owner and insecure transport", () => {
  it("an entry for another Worker or another owner is refused with zero requests, never retargeted", async () => {
    const { key } = await cloudEntry();
    const body = entryOf(key).body;
    const foreign = await S().enqueueCloudOccurrence(OTHER, body);
    expect(foreign).toMatchObject({ ok: true });
    const otherOwner = "wfo_" + "9".repeat(32);
    const owned = await S().enqueueCloudOccurrence(BASE, { ...body, ownerKey: otherOwner });
    expect(owned).toMatchObject({ ok: true });
    if (!foreign.ok || !owned.ok) return;
    const c = await controller();
    clearLog();
    for (const a of ["submit", "status", "run", "cancel"] as const) {
      expect(await c[a](foreign.entry.key)).toMatchObject({
        kind: "refused",
        reason: "foreign_origin",
      });
      expect(await c[a](owned.entry.key)).toMatchObject({
        kind: "refused",
        reason: "foreign_owner",
      });
    }
    // Another session holding a different owner at the same origin is refused for this entry too.
    const second = await makeRig(TOKEN_B);
    const c2 = await controller(second.fetch, BASE, TOKEN_B);
    expect(await c2.submit(key)).toMatchObject({ kind: "refused", reason: "foreign_owner" });
    expect(sent()).toEqual([]);
    expect(second.net.log.filter((r) => !r.url.endsWith("/authority"))).toEqual([]);
  });

  it("an http historical entry keeps its authority; it can never be transported", async () => {
    const { key } = await cloudEntry();
    const h = await S().enqueueCloudOccurrence("http://scout.test", entryOf(key).body);
    expect(h).toMatchObject({ ok: true });
    if (!h.ok) return;
    const r = await readCloudOccurrence(h.entry.key);
    expect(r).toMatchObject({ ok: true, entry: { authority: { origin: "http://scout.test" } } });
    const c = createOccurrenceController({
      fetch: rig.fetch,
      persistence: cloudOccurrencePersistence,
    });
    expect(c.configure({ origin: "http://scout.test", token: TOKEN })).toEqual({
      ok: false,
      reason: "insecure",
    });
    clearLog();
    expect(await c.handshake()).toEqual({ ok: false, reason: "not_configured" });
    expect(await c.submit(h.entry.key)).toMatchObject({
      kind: "refused",
      reason: "not_configured",
    });
    expect(rig.net.log).toEqual([]);
  });
});

describe("result classification after a fence moves (DT-7C-2B-4-R1)", () => {
  type Failure = "network" | "malformed_json" | "invalid_answer" | "receipt_unavailable";
  const FAILURES: Failure[] = [
    "network",
    "malformed_json",
    "invalid_answer",
    "receipt_unavailable",
  ];
  /** The real router processes the POST, then its answer is replaced by this failure once `hold` opens. */
  const failing = (failure: Failure, hold: Promise<void>, arrived: () => void): ClientFetch => {
    return async (url, init) => {
      const answer = await rig.fetch(url, init);
      if (init.method !== "POST") return answer;
      arrived();
      await hold;
      if (failure === "network") throw new TypeError("answer lost");
      if (failure === "malformed_json") return bytes(200, "{");
      if (failure === "invalid_answer") return bytes(200, "{}");
      return bytes(503, JSON.stringify({ error: "receipt_unavailable" }));
    };
  };
  const moves = {
    "store visit invalidation": () => invalidateCloudVisit(),
    "token A-B-A": () => {
      S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN_B } });
      S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    },
  };

  for (const failure of FAILURES)
    for (const [move, run] of Object.entries(moves))
      it(`${failure} after ${move} is stale (still dispatched), never a current unconfirmed`, async () => {
        const { key } = await cloudEntry();
        const hold = deferred();
        const arrived = deferred();
        const c = await controller(failing(failure, hold.promise, arrived.resolve));
        clearLog();
        const pending = c.submit(key);
        await arrived.promise;
        run();
        hold.resolve();
        expect(await pending).toEqual({
          kind: "stale",
          action: "submit",
          key,
          dispatched: true,
          recorded: null,
        });
        expect(sent()).toHaveLength(1);
        expect(entryOf(key).observation).toBeNull();
        await tick(5);
        expect(sent()).toHaveLength(1); // no retry, status poll, adoption or acknowledgement
      });

  it("an older lost Submit is stale while a newer Status still waits on its durable read", async () => {
    const { key } = await cloudEntry();
    const hold = deferred();
    const arrived = deferred();
    const readGate = deferred();
    const reading = deferred();
    let holdRead = false;
    const persistence = {
      ...cloudOccurrencePersistence,
      read: async (k: string) => {
        if (holdRead) {
          reading.resolve();
          await readGate.promise;
        }
        return cloudOccurrencePersistence.read(k);
      },
    };
    const c = createOccurrenceController({
      fetch: failing("network", hold.promise, arrived.resolve),
      persistence,
    });
    c.configure({ origin: BASE, token: TOKEN });
    expect((await c.handshake()).ok).toBe(true);
    clearLog();
    const first = c.submit(key);
    await arrived.promise;
    holdRead = true;
    const second = c.status(key);
    await reading.promise; // the newer action has not created its fetch yet
    hold.resolve();
    expect(await first).toEqual({
      kind: "stale",
      action: "submit",
      key,
      dispatched: true,
      recorded: null,
    });
    readGate.resolve();
    expect(is(await second, "answered").parsed).toMatchObject({ result: { found: "row" } });
    expect(sent().map((r) => r.method)).toEqual(["POST", "GET"]);
  });

  it("unchanged context: a lost answer stays unconfirmed; a genuine typed refusal stays typed", async () => {
    const { key } = await cloudEntry();
    const never = await cloudEntry({ name: { ar: "", en: "Never sent" } });
    const c = await controller();
    clearLog();
    rig.net.mode = "lose";
    expect(await c.submit(key)).toMatchObject({
      kind: "unconfirmed",
      action: "submit",
      key,
      dispatched: true,
      category: "network",
    });
    expect(entryOf(key).observation).toBeNull();
    rig.net.mode = "deliver";
    const typed = is(await c.cancel(never.key), "answered");
    expect(typed.parsed).toMatchObject({ outcome: "refused", error: "absent" });
    expect(typed.recorded).toBeNull();
    expect(sent().filter((r) => r.method === "POST")).toHaveLength(2);
  });

  it("a valid late bound receipt is recorded only for its own entry; the caller gets stale", async () => {
    const one = await cloudEntry();
    const two = await cloudEntry({ name: { ar: "", en: "Second" } });
    const c = await controller();
    const hold = deferred();
    rig.net.hold = hold.promise;
    const p = c.submit(one.key);
    await tick();
    moves["token A-B-A"]();
    hold.resolve();
    expect(await p).toEqual({
      kind: "stale",
      action: "submit",
      key: one.key,
      dispatched: true,
      recorded: { persisted: true, changed: true },
    });
    expect(entryOf(one.key).observation?.binding).toMatchObject({ kind: "submit" });
    expect(entryOf(two.key).observation).toBeNull();
  });

  it("a moved fence plus an observation storage failure is stale and honestly unpersisted", async () => {
    const { key } = await cloudEntry();
    const c = await controller();
    await savesSettled();
    clearLog();
    const hold = deferred();
    rig.net.hold = hold.promise;
    const p = c.submit(key);
    await tick();
    invalidateCloudVisit();
    const real = Storage.prototype.setItem;
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    hold.resolve();
    const r = await p;
    quota.mockRestore();
    expect(r).toMatchObject({
      kind: "stale",
      dispatched: true,
      recorded: { persisted: false, reason: "not-persisted" },
    });
    expect(entryOf(key).observation).toBeNull();
    expect(sent()).toHaveLength(1);
  });
});
