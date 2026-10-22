// @vitest-environment jsdom
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, payloadDigestOf } from "@/workers/scout/src/social/workflowProtocol";
import type { ClientFetch, ClientResponse } from "@/lib/cloudWorkflowClient";
import { parseAnswer, readyOccurrenceId, type CloudRequest } from "@/lib/cloudWorkflowProtocol";
import {
  createIntent,
  emptyRegistrations,
  prepareIntent,
  recordOutcome,
  reserveAttempt,
} from "@/lib/cloudWorkflowRegistration";
import { readJournal, type CloudJournal } from "@/lib/cloudWorkflowJournal";
import { createRegistrationController } from "@/lib/cloudWorkflowRegistrationClient";
import { workflowDigestOf } from "@/lib/cloudWorkflowCapture";
import type { Workflow } from "@/lib/domain";
import {
  STORAGE_KEY,
  articleBase,
  hydrateStore,
  cloudRegistrationPersistence,
  savesSettled,
  setWorkflowFault,
  setArticlesLock,
  useStore,
  workflowBase,
  type ArticlesLock,
} from "./index";

// ⚙️ DT-7C-2B-3 trigger capture in the store (planning/tools/38-cloud-workflows.md): ownership-aware Manual/Ready capture
// over registrations recorded by the accepted controller against the REAL Worker router + SQLite coordinator behind a
// fake in-memory transport (no live Worker, no network), one locked commit with exact read-back, typed stale refusals,
// whole-transition Ready refusal, and the legacy entry points' honest refusal. Isolated jsdom storage.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec); // eslint-disable-line @typescript-eslint/no-explicit-any

const S = () => useStore.getState();
const TOKEN = "capture-token-CANARY-7c2b3";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://scout.test";
const OTHER = "https://other.test";
const T_BASE = new Date("2026-01-01T00:00:00.000Z");
const T0 = new Date("2026-10-18T07:00:00.000Z");
const T_RUN = new Date("2026-10-18T09:00:00.000Z");
const SKILL = "smart-bins-keywords";
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
  let minute = 0;
  const clock = () => new Date(Date.UTC(2026, 9, 18, 8, minute++));
  const net = { mode: "deliver" as "deliver" | "lose", posts: 0 };
  const fetchFn: ClientFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", APP);
    if (init.method === "POST") net.posts += 1;
    const res = await handle(
      new Request(url, { method: init.method, headers, ...(init.body ? { body: init.body } : {}) }),
      env,
      undefined,
      { now: clock },
    );
    const text = await res.text();
    if (init.method === "POST" && net.mode === "lose") throw new TypeError("answer lost");
    return bytes(res.status, text);
  };
  const ctl = createRegistrationController({
    fetch: fetchFn,
    persistence: cloudRegistrationPersistence,
  });
  ctl.configure({ origin: BASE, token: TOKEN });
  const h = await ctl.handshake();
  if (!h.ok) throw new Error(h.reason);
  return { ctl, net, owner: h.authority.ownerKey as string };
}
const authority = () => ({ origin: BASE, ownerKey: rig.owner });

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
async function unregister(w: Workflow) {
  return rig.ctl.unregister(
    {
      kind: "unregister",
      ownerKey: rig.owner,
      workflowId: w.id,
      registrationEpoch: 1,
      expectedRevision: w.revision,
    },
    (await workflowDigestOf(w))!,
  );
}

/* ---------- store helpers ---------- */

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
/** A lock whose next holder waits for `release()` (the window between preparation and the final commit). */
function gateLock() {
  const inner = queueLock();
  let open: () => void = () => undefined;
  let requested: () => void = () => undefined;
  const gate = new Promise<void>((r) => (open = r));
  const asked = new Promise<void>((r) => (requested = r));
  let armed = true;
  const lock: ArticlesLock = (fn) => {
    if (!armed) return inner(fn);
    armed = false;
    requested();
    return inner(async () => {
      await gate;
      return fn();
    });
  };
  return { lock, asked, release: () => open() };
}
const raw = () => localStorage.getItem(STORAGE_KEY)!;
const stored = (): A => JSON.parse(raw()).state;
const journal = (): CloudJournal => readJournal(stored().cloudJournal)!;
const otherTab = (edit: (state: A) => void) => {
  const r = JSON.parse(raw());
  edit(r.state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
};
const quota = () => {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
    if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
    real.call(this, k, v);
  });
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
const runsOf = (id: string) => S().workflowRuns.filter((r) => r.workflowId === id);
const noToken = () => {
  expect(JSON.stringify(stored().cloudJournal ?? null)).not.toContain(TOKEN);
  expect(JSON.stringify(stored().cloudRegistrations ?? null)).not.toContain(TOKEN);
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

describe("Manual capture: one executor, exact read-back", () => {
  it("no registration evidence: a local run (legacy shape), the minted id as run id; legacy Run now unchanged", async () => {
    const w = await workflow();
    const r = await S().captureManualRun(w.id, {}, T_RUN);
    expect(r.kind).toBe("local");
    if (r.kind !== "local") return;
    expect(r.run).toMatchObject({ workflowId: w.id, kind: "manual", status: "queued" });
    expect(stored().workflowRuns.map((x: A) => x.commitId)).toEqual([r.run.commitId]);
    expect(journal().entries).toEqual([]);
    const legacy = await S().runWorkflowNow(w.id, {}, T_RUN);
    expect(legacy.ok).toBe(true);
    await S().drainWorkflowRuns(T_RUN);
    expect(runsOf(w.id).map((x) => x.status)).toEqual(["done", "done"]);
  });

  it("a settled active registration at the configured origin: one cloud entry, no WorkflowRun, exact builder body", async () => {
    const w = await workflow();
    await registered(w);
    const before = S().workflowRuns.length;
    const r = await S().captureManualRun(w.id, { authority: authority() }, T_RUN);
    expect(r.kind).toBe("cloud");
    if (r.kind !== "cloud") return;
    expect(r.created).toBe(true);
    expect(S().workflowRuns).toHaveLength(before);
    const [e] = journal().entries;
    expect(e).toMatchObject({
      occurrenceId: r.entry.occurrenceId,
      executionAt: T_RUN.toISOString(),
      authority: { origin: BASE, ownerKey: rig.owner },
      state: "queued",
    });
    expect(e.body).toMatchObject({
      workflowId: w.id,
      kind: "manual",
      registrationEpoch: 1,
      revision: w.revision,
      plannerContext: null,
      input: { day: "2026-10-18", lang: S().settings.lang },
    });
    expect(e.occurrenceId).not.toMatch(/^(ar|sc)-/);
    expect(await payloadDigestOf(e.body)).toBe(e.payloadDigest);
    expect(await workflowDigestOf(e.body.snapshot as never)).toBe(await workflowDigestOf(w));
    expect(r.entry).toEqual({
      key: e.key,
      origin: BASE,
      ownerKey: rig.owner,
      occurrenceId: e.occurrenceId,
      workflowId: w.id,
      kind: "manual",
      executionAt: e.executionAt,
      payloadDigest: e.payloadDigest,
      commitId: e.commitId,
      state: "queued",
    });
    noToken();
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain("Idea");
    // The legacy Run now refuses honestly and writes nothing; the drain never touches the journal.
    const rawBefore = raw();
    expect(await S().runWorkflowNow(w.id, {}, T_RUN)).toEqual({ ok: false, reason: "not-local" });
    expect(raw()).toBe(rawBefore);
    await S().drainWorkflowRuns(T_RUN);
    expect(journal().entries).toEqual([e]);
    expect(rig.net.posts).toBe(1); // only the registration; capture sends nothing
  });

  it("the explicit authority must match the registration and the configured origin", async () => {
    const w = await workflow();
    await registered(w);
    const rawBefore = raw();
    expect(await S().captureManualRun(w.id, {}, T_RUN)).toMatchObject({
      kind: "refused",
      reason: "authority-mismatch",
    });
    expect(
      await S().captureManualRun(
        w.id,
        { authority: { origin: BASE, ownerKey: "wfo_" + "0".repeat(32) } },
        T_RUN,
      ),
    ).toMatchObject({ kind: "refused", reason: "authority-mismatch" });
    expect(
      await S().captureManualRun(
        w.id,
        { authority: { origin: OTHER, ownerKey: rig.owner } },
        T_RUN,
      ),
    ).toMatchObject({ kind: "refused", reason: "authority-mismatch" });
    expect(raw()).toBe(rawBefore);
    // Settings now point at another Worker: the active registration is foreign, never local.
    S().setSettings({ apiKeys: { scoutUrl: OTHER, scoutToken: TOKEN } });
    await savesSettled();
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      kind: "refused",
      reason: "blocked",
      detail: { cause: "foreign-worker" },
    });
    expect(await S().runWorkflowNow(w.id, {}, T_RUN)).toEqual({ ok: false, reason: "not-local" });
    S().setSettings({ apiKeys: {} });
    await savesSettled();
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "blocked",
      detail: { cause: "not-configured" },
    });
    expect(S().workflowRuns).toEqual([]);
    expect(journal().entries).toEqual([]);
  });

  it("cloud Manual on an article-ready workflow refuses explicitly; local behaviour is kept when not registered", async () => {
    const w = await readyWorkflow();
    const a = await draftArticle();
    const local = await S().captureManualRun(w.id, { articleId: a.id }, T_RUN);
    expect(local).toMatchObject({
      kind: "local",
      run: { snapshot: { input: { articleId: a.id } } },
    });
    expect(await S().captureManualRun(w.id, {}, T_RUN)).toMatchObject({
      kind: "refused",
      reason: "needs-article",
    });
    await registered(w);
    expect(
      await S().captureManualRun(w.id, { authority: authority(), articleId: a.id }, T_RUN),
    ).toMatchObject({ kind: "refused", reason: "manual-on-ready", workflowId: w.id });
    expect(await S().runWorkflowNow(w.id, { articleId: a.id }, T_RUN)).toEqual({
      ok: false,
      reason: "not-local",
    });
    expect(journal().entries).toEqual([]);
  });

  it("edited, paused, missing and re-revisioned definitions refuse; nothing is re-registered", async () => {
    const w = await workflow();
    await registered(w);
    const posts = rig.net.posts;
    const e = await S().updateWorkflow(
      w.id,
      { name: { ar: "", en: "Edited" } },
      workflowBase(w),
      T0,
    );
    expect(e.ok).toBe(true);
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "definition-mismatch",
    });
    const w2 = await workflow();
    await registered(w2);
    await S().setWorkflowEnabled(w2.id, false, T0);
    expect(await S().captureManualRun(w2.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "paused",
    });
    await S().setWorkflowEnabled(w2.id, true, T0); // the revision moved on: no longer the registered one
    expect(await S().captureManualRun(w2.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "definition-mismatch",
    });
    expect(await S().captureManualRun("nope", { authority: authority() }, T_RUN)).toMatchObject({
      reason: "missing",
    });
    // An executionAt before the registration epoch opened is refused, never adjusted.
    const w3 = await workflow();
    await registered(w3);
    expect(
      await S().captureManualRun(
        w3.id,
        { authority: authority() },
        new Date("2026-10-18T07:59:00Z"),
      ),
    ).toMatchObject({ reason: "chronology" });
    expect(rig.net.posts).toBe(posts + 2);
    expect(journal().entries).toEqual([]);
  });

  it("uncertain, unreadable and journal-only evidence block both capture and legacy Run now", async () => {
    const w = await workflow();
    rig.net.mode = "lose";
    expect(await register(w)).toMatchObject({ state: "uncertain" });
    rig.net.mode = "deliver";
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "blocked",
      detail: { cause: "unresolved" },
    });
    expect(await S().runWorkflowNow(w.id, {}, T_RUN)).toEqual({ ok: false, reason: "not-local" });
    const v = await workflow();
    const saved = stored().cloudRegistrations;
    otherTab((s) => (s.cloudRegistrations = { v: 1, broken: true }));
    expect(await S().captureManualRun(v.id, {}, T_RUN)).toMatchObject({
      reason: "blocked",
      detail: { cause: "unreadable" },
    });
    expect(await S().runWorkflowNow(v.id, {}, T_RUN)).toEqual({ ok: false, reason: "not-local" });
    // A stored answer the pinned parser no longer accepts is unreadable evidence, not "no evidence".
    otherTab((s) => {
      s.cloudRegistrations = saved;
      s.cloudRegistrations.records[0].intent.answer = null;
    });
    expect(await S().captureManualRun(w.id, {}, T_RUN)).toMatchObject({ reason: "blocked" });
    expect(S().workflowRuns).toEqual([]);
  });

  it("journal-only evidence (an imported backup's entries with no registration proof) blocks; import runs nothing", async () => {
    const w = await workflow();
    await registered(w);
    expect((await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).kind).toBe(
      "cloud",
    );
    const backup = JSON.parse(S().exportState(T_RUN));
    backup.state.cloudJournal = stored().cloudJournal;
    delete backup.state.cloudRegistrations;
    // A fresh device: no registrations, then the backup's journal arrives by import.
    localStorage.clear();
    expect(await S().reset(T_BASE)).toMatchObject({ ok: true });
    rig.net.posts = 0;
    expect(await S().importState(JSON.stringify(backup))).toMatchObject({ ok: true });
    await S().drainWorkflowRuns(T_RUN);
    expect(S().workflowRuns).toEqual([]);
    expect(rig.net.posts).toBe(0);
    expect(journal().entries).toHaveLength(1);
    expect(await S().captureManualRun(w.id, {}, T_RUN)).toMatchObject({
      reason: "blocked",
      detail: { cause: "journal-only" },
    });
    expect(await S().runWorkflowNow(w.id, {}, T_RUN)).toEqual({ ok: false, reason: "not-local" });
  });
});

describe("immutable preparation, then one locked compare-and-set", () => {
  async function racing(edit: () => void | Promise<void>, w: Workflow, opts: A = {}) {
    const g = gateLock();
    setArticlesLock(g.lock);
    const p = S().captureManualRun(w.id, { authority: authority(), ...opts }, T_RUN);
    await Promise.race([g.asked, p]);
    await edit();
    g.release();
    const r = await p;
    setArticlesLock(queueLock());
    return r;
  }

  it("a workflow edited in another tab during preparation: stale, zero writes, no retry", async () => {
    const w = await workflow();
    await registered(w);
    let rawAtEdit = "";
    const r = await racing(() => {
      otherTab((s) => {
        const x = s.workflows.find((y: A) => y.id === w.id);
        x.name = { ar: "", en: "Other tab" };
        x.commitId = "other-commit";
      });
      rawAtEdit = raw();
    }, w);
    expect(r).toEqual({ kind: "refused", reason: "stale" });
    expect(journal().entries).toEqual([]);
    expect(JSON.parse(raw()).state.cloudJournal).toEqual(JSON.parse(rawAtEdit).state.cloudJournal);
  });

  it("A-B-A: the same content back under a new commit id is still stale", async () => {
    const w = await workflow();
    await registered(w);
    const r = await racing(() => {
      otherTab((s) => (s.workflows.find((y: A) => y.id === w.id).commitId = "b"));
      otherTab((s) => (s.workflows.find((y: A) => y.id === w.id).commitId = "a-again"));
    }, w);
    expect(r).toEqual({ kind: "refused", reason: "stale" });
  });

  it("a reset/import generation, a registration change or a journal change meanwhile: stale", async () => {
    const w = await workflow();
    await registered(w);
    expect(
      await racing(() => otherTab((s) => (s.discoverLibraryEpoch = "another-epoch")), w),
    ).toEqual({ kind: "refused", reason: "stale" });
    expect(await racing(() => otherTab((s) => (s.cloudRegistrations.generation += 1)), w)).toEqual({
      kind: "refused",
      reason: "stale",
    });
    expect(await racing(() => otherTab((s) => (s.settings.apiKeys.scoutUrl = OTHER)), w)).toEqual({
      kind: "refused",
      reason: "stale",
    });
    S().setSettings({ apiKeys: { scoutUrl: BASE, scoutToken: TOKEN } });
    await savesSettled();
    // Another journal commit (a cloud capture of another workflow) lands meanwhile.
    const other = await workflow();
    await registered(other);
    const r = await racing(async () => {
      setArticlesLock(queueLock());
      const x = await S().captureManualRun(other.id, { authority: authority() }, T_RUN);
      expect(x.kind).toBe("cloud");
    }, w);
    expect(r).toEqual({ kind: "refused", reason: "stale" });
    expect(journal().entries.map((e) => e.body.workflowId)).toEqual([other.id]);
  });

  it("the captured body is frozen: later edits change neither the stored body nor its digest", async () => {
    const w = await workflow();
    await registered(w);
    const r = await S().captureManualRun(w.id, { authority: authority() }, T_RUN);
    expect(r.kind).toBe("cloud");
    const [before] = journal().entries;
    const fresh = S().workflows.find((x) => x.id === w.id)!;
    expect(
      (
        await S().updateWorkflow(
          w.id,
          { name: { ar: "", en: "Renamed" }, actions: [idea("a1", "Changed {date}")] },
          workflowBase(fresh),
          T_RUN,
        )
      ).ok,
    ).toBe(true);
    expect(journal().entries).toEqual([before]);
    expect(before.body.snapshot).toMatchObject({ name: { en: "Flow" } });
  });
});

describe("Ready fan-out: one Ready event, one commit", () => {
  it("mixed local + cloud members: article, local run and cloud entry in one commit; Ready ids are exact", async () => {
    const local = await readyWorkflow();
    const cloud = await readyWorkflow([idea("c1", "Share {title} ({slug})")]);
    await registered(cloud);
    const a = await draftArticle();
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_RUN);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.article).toMatchObject({ id: a.id, status: "ready", revision: a.revision + 1 });
    const st = stored();
    expect(st.articles.find((x: A) => x.id === a.id)).toMatchObject({
      status: "ready",
      commitId: r.article.commitId,
    });
    expect(r.runs.map((x) => x.workflowId)).toEqual([local.id]);
    expect(r.entries.map((x) => x.workflowId)).toEqual([cloud.id]);
    const [e] = journal().entries;
    expect(e.occurrenceId).toBe(await readyOccurrenceId(cloud.id, a.id, r.article.commitId));
    expect(e.body).toMatchObject({
      kind: "article-ready",
      input: { articleId: a.id, slug: complete.slug, day: "2026-10-18" },
    });
    expect(runsOf(cloud.id)).toEqual([]);
    // Local members drain only after the proven commit (legacy behaviour); the journal is untouched by it.
    await S().drainWorkflowRuns(T_RUN);
    expect(runsOf(local.id).map((x) => x.status)).toEqual(["done"]);
    expect(journal().entries).toEqual([e]);
    noToken();
  });

  it("already ready: a no-op, not a new event (nothing written)", async () => {
    const a = await draftArticle();
    expect((await S().captureArticleReady(a.id, {}, T_RUN)).kind).toBe("ready");
    const rawBefore = raw();
    const r = await S().captureArticleReady(a.id, {}, T_RUN);
    expect(r).toMatchObject({ kind: "unchanged", article: { id: a.id, status: "ready" } });
    expect(raw()).toBe(rawBefore);
  });

  it("one blocked, mismatched or over-limit member refuses the whole transition: no article, run or entry", async () => {
    const local = await readyWorkflow();
    const cloud = await readyWorkflow();
    await registered(cloud);
    const a = await draftArticle();
    const rawBefore = raw();
    expect(await S().captureArticleReady(a.id, {}, T_RUN)).toMatchObject({
      kind: "refused",
      reason: "authority-mismatch",
      workflowId: cloud.id,
    });
    // The legacy Ready path refuses the whole transition too (no local-only fallback).
    expect(await S().setArticleStatus(a.id, "ready", T_RUN)).toEqual({
      ok: false,
      reason: "workflow-not-local",
    });
    expect(raw()).toBe(rawBefore);
    // An over-limit output (a cloud-only limitation): typed detail, whole refusal.
    const long = await readyWorkflow([idea("l1", "{summary}".repeat(55))]);
    await registered(long);
    await S().updateArticle(
      a.id,
      { summary: { ar: "م".repeat(100), en: "s".repeat(100) } },
      articleBase(S().articles.find((x) => x.id === a.id)!),
      T0,
    );
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_RUN);
    expect(r).toMatchObject({
      kind: "refused",
      reason: "limitation",
      workflowId: long.id,
      detail: { limitation: { actionId: "l1", limitation: "output-too-large", built: 0 } },
    });
    expect(S().articles.find((x) => x.id === a.id)!.status).toBe("draft");
    expect(runsOf(local.id)).toEqual([]);
    expect(journal().entries).toEqual([]);
  });

  it("journal capacity: one more entry than fits refuses the whole Ready transition", async () => {
    const cloud = await readyWorkflow();
    await registered(cloud);
    const a = await draftArticle();
    // Fill the journal to 600 entries of another workflow at the registered authority (structurally valid).
    const seed = await S().captureManualRun(
      (await workflowRegistered()).id,
      { authority: authority() },
      T_RUN,
    );
    expect(seed.kind).toBe("cloud");
    const [one] = journal().entries;
    otherTab((s) => {
      const j = s.cloudJournal;
      for (let n = 1; n < 600; n++) {
        const id = `fill${n}`;
        j.entries.push({
          ...one,
          key: canonicalJson([one.authority.origin, one.authority.ownerKey, id]),
          occurrenceId: id,
          body: { ...one.body, occurrenceId: id },
        });
      }
      j.generation += 1;
    });
    expect(journal().entries).toHaveLength(600);
    const rawBefore = raw();
    expect(await S().captureArticleReady(a.id, { authority: authority() }, T_RUN)).toMatchObject({
      kind: "refused",
      reason: "capacity",
    });
    expect(raw()).toBe(rawBefore);
  });

  it("two tabs competing for one Ready: exactly one Ready event, the other a typed stale refusal", async () => {
    const local = await readyWorkflow();
    const cloud = await readyWorkflow();
    await registered(cloud);
    const a = await draftArticle();
    const lock = queueLock();
    setArticlesLock(lock);
    vi.resetModules();
    const B = await import("./index");
    await B.hydrateStore();
    B.setArticlesLock(lock);
    const [x, y] = await Promise.all([
      S().captureArticleReady(a.id, { authority: authority() }, T_RUN),
      B.useStore.getState().captureArticleReady(a.id, { authority: authority() }, T_RUN),
    ]);
    expect([x.kind, y.kind].sort()).toEqual(["ready", "refused"]);
    expect([x, y].find((r) => r.kind === "refused")).toEqual({ kind: "refused", reason: "stale" });
    expect(journal().entries).toHaveLength(1);
    expect(stored().workflowRuns.filter((r: A) => r.workflowId === local.id)).toHaveLength(1);
    // The legacy Ready path in the other tab after the event: already ready, a no-op.
    expect(await B.useStore.getState().setArticleStatus(a.id, "ready", T_RUN)).toMatchObject({
      ok: true,
    });
    expect(journal().entries).toHaveLength(1);
    await B.savesSettled();
    B.setArticlesLock(undefined);
  });

  it("the legacy Ready path with only local members keeps queueing and draining as before", async () => {
    const local = await readyWorkflow();
    const a = await draftArticle();
    const r = await S().setArticleStatus(a.id, "ready", T_RUN);
    expect(r.ok).toBe(true);
    await vi.waitFor(() => expect(runsOf(local.id).map((x) => x.status)).toEqual(["done"]));
  });
});

async function workflowRegistered() {
  const w = await workflow();
  await registered(w);
  return w;
}

describe("durable boundary: storage failures and monotonic rollback", () => {
  it("blocked storage, a dropped write and no Web Locks: typed failure, nothing kept", async () => {
    const w = await workflowRegistered();
    const rawBefore = raw();
    const q = quota();
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      kind: "refused",
      reason: "not-persisted",
    });
    q.mockRestore();
    expect(raw()).toBe(rawBefore);
    const real = Storage.prototype.setItem;
    const drop = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k !== STORAGE_KEY) real.call(this, k, v);
    });
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "not-persisted",
    });
    drop.mockRestore();
    expect(raw()).toBe(rawBefore);
    expect(S().cloudJournal).toEqual(stored().cloudJournal);
    setArticlesLock(null);
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "unsupported-save",
    });
    setArticlesLock(queueLock());
    expect(journal().entries).toEqual([]);
  });

  it("a failed read-back never writes the rollback over a newer journal another writer left", async () => {
    const w = await workflowRegistered();
    const v = await workflowRegistered();
    expect((await S().captureManualRun(v.id, { authority: authority() }, T_RUN)).kind).toBe(
      "cloud",
    );
    const newer = { ...stored().cloudJournal, generation: 99, commitId: "newer" };
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      val,
    ) {
      if (k !== STORAGE_KEY) return real.call(this, k, val);
      const r = JSON.parse(val);
      r.state.cloudJournal = newer; // what lands is another writer's newer journal
      real.call(this, k, JSON.stringify(r));
    });
    expect(await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).toMatchObject({
      reason: "not-persisted",
    });
    spy.mockRestore();
    expect(stored().cloudJournal).toEqual(newer);
  });
});

describe("lifecycle: unregister, reset and the drain", () => {
  it("a proven unregister: future triggers local; the old cloud entry stays cloud and never drains", async () => {
    const w = await workflowRegistered();
    // DT-7C-2B-3-R1 fixture adjustment: the old entry is captured inside the epoch the real router opened (at its
    // opening instant), so the later unregister's closed epoch covers it; at T_RUN (09:00) it would lie after the
    // router's 08:0x close, an uncovered chronology that now blocks. Assertions unchanged.
    const opened = stored().cloudRegistrations.records.find((r: A) => r.workflowId === w.id).last
      .answer.body.registration.epochs[0].openedAt;
    const c = await S().captureManualRun(w.id, { authority: authority() }, new Date(opened));
    expect(c.kind).toBe("cloud");
    const [old] = journal().entries;
    expect(await unregister(w)).toMatchObject({ kind: "recorded", state: "settled" });
    const l = await S().captureManualRun(w.id, { authority: authority() }, T_RUN);
    expect(l.kind).toBe("local");
    expect((await S().runWorkflowNow(w.id, {}, T_RUN)).ok).toBe(true);
    await S().drainWorkflowRuns(T_RUN);
    expect(runsOf(w.id).map((x) => x.status)).toEqual(["done", "done"]);
    expect(journal().entries).toEqual([old]);
    // Existing local runs stay local and retry as before, whatever the ownership now.
    const runId = runsOf(w.id)[0].id;
    expect(await S().retryWorkflowRun(runId, T_RUN)).toMatchObject({
      ok: false,
      reason: "not-retryable",
    });
  });

  it("an existing local run stays local: it retries and drains as before after its workflow is registered", async () => {
    const w = await workflow();
    setWorkflowFault(() => "boom");
    expect((await S().runWorkflowNow(w.id, {}, T_RUN)).ok).toBe(true);
    await S().drainWorkflowRuns(T_RUN);
    setWorkflowFault(undefined);
    const [failed] = runsOf(w.id);
    expect(failed.status).toBe("failed");
    await registered(w);
    expect(await S().runWorkflowNow(w.id, {}, T_RUN)).toEqual({ ok: false, reason: "not-local" });
    expect(await S().retryWorkflowRun(failed.id, T_RUN)).toMatchObject({ ok: true });
    await S().drainWorkflowRuns(T_RUN);
    expect(runsOf(w.id).map((x) => [x.id, x.status, x.attempt])).toEqual([[failed.id, "done", 2]]);
    expect(journal().entries).toEqual([]);
  });

  it("reset keeps cloud entries (suppressed), creates no local run and sends nothing", async () => {
    const w = await workflowRegistered();
    expect((await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).kind).toBe(
      "cloud",
    );
    rig.net.posts = 0;
    expect(await S().reset(new Date("2026-10-18T10:00:00.000Z"))).toEqual({
      ok: true,
      retained: 1,
    });
    await S().drainWorkflowRuns(T_RUN);
    expect(S().workflowRuns).toEqual([]);
    expect(journal().entries[0].state).toBe("suppressed");
    expect(rig.net.posts).toBe(0);
  });
});

describe("planner context and limits", () => {
  it("plan steps capture the minimal target-week context; over-count history refuses (never truncated)", async () => {
    const plan = { id: "p1", kind: "plan", quest: "train", skillId: SKILL, minutes: 30, day: 2 };
    const w = await workflow({ actions: [plan, { ...plan, id: "p2", day: "lightest" }] });
    await registered(w);
    otherTab((s) => {
      s.planItems = [
        {
          id: "x1",
          week: "2026-10-17",
          day: 1,
          skillId: SKILL,
          quest: "train",
          minutes: 20,
          by: "me",
        },
        {
          id: "x2",
          week: "2026-10-10",
          day: 1,
          skillId: SKILL,
          quest: "train",
          minutes: 20,
          by: "me",
        },
      ];
    });
    await hydrateStore(); // this tab hears the other tab first (a stale memory refuses as stale)
    const r = await S().captureManualRun(w.id, { authority: authority() }, T_RUN);
    expect(r).toMatchObject({ kind: "cloud" });
    const [e] = journal().entries;
    expect(e.body.plannerContext).toMatchObject({
      targetWeek: "2026-10-17",
      planItems: [{ id: "x1" }],
      contextAt: T_RUN.toISOString(),
    });
    const v = await workflow({ actions: [plan] });
    await registered(v);
    otherTab((s) => {
      s.completions = Array.from({ length: 201 }, (_, n) => ({
        skillId: SKILL,
        quest: "train",
        at: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString(),
      }));
    });
    await hydrateStore();
    expect(await S().captureManualRun(v.id, { authority: authority() }, T_RUN)).toMatchObject({
      kind: "refused",
      reason: "snapshot",
      detail: { snapshot: "count_exceeded" },
    });
  });
});

/* ---------- DT-7C-2B-3-R1: ownership proof, one private instant, exact proof + owned-only rollback ---------- */

/** A storage fault seam: every write of the shared key passes through `edit` (null = drop it). */
function rewrite(edit: (state: A) => A | null) {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
    if (k !== STORAGE_KEY) return real.call(this, k, v);
    const r = JSON.parse(v);
    const state = edit(r.state);
    if (state) real.call(this, k, JSON.stringify({ ...r, state }));
  });
}
/** A valid refused FIRST registration (409 capacity, nothing applied, no observation) through the accepted transitions. */
async function refusedFirst(w: Workflow) {
  const req: CloudRequest = {
    kind: "register",
    ownerKey: rig.owner,
    workflowId: w.id,
    expectedEpoch: 0,
    revision: w.revision,
    workflowDigest: (await workflowDigestOf(w))!,
  };
  const p = prepareIntent(req, authority());
  if (!p.ok) throw new Error(p.reason);
  const c = createIntent(emptyRegistrations(), p, "op-refused", T0.toISOString());
  if (!c.ok) throw new Error(c.reason);
  const i = c.next.records[0].intent;
  const r = reserveAttempt(c.next, p.key, i);
  if (!r.ok) throw new Error(r.reason);
  const answer = { status: 409, body: { error: "capacity", ownerKey: rig.owner } };
  const parsed = await parseAnswer(req, answer, { origin: BASE });
  const out = recordOutcome(r.next, p.key, i.operationId, r.attempt, {
    kind: "answer",
    answer,
    parsed,
  });
  if (!out.changed) throw new Error(out.reason);
  expect(out.next.records[0]).toMatchObject({ last: null, intent: { state: "refused" } });
  return out.next;
}
const day = (r: A) => r.snapshot.input.day;

describe("DT-7C-2B-3-R1 ownership: lifecycle proof, not record presence", () => {
  it("a refused first registration beside same-authority cloud history blocks capture and legacy Run now; nothing runs", async () => {
    const w = await workflowRegistered();
    expect((await S().captureManualRun(w.id, { authority: authority() }, T_RUN)).kind).toBe(
      "cloud",
    );
    const regs = await refusedFirst(w);
    otherTab((s) => {
      s.cloudRegistrations = regs; // separately imported, each slice valid on its own
    });
    await hydrateStore();
    const journalBefore = stored().cloudJournal;
    expect(await S().captureManualRun(w.id, {}, T_RUN)).toEqual({
      kind: "refused",
      reason: "blocked",
      workflowId: w.id,
      detail: { cause: "journal-only" },
    });
    expect(await S().runWorkflowNow(w.id, {}, T_RUN)).toEqual({ ok: false, reason: "not-local" });
    await S().drainWorkflowRuns(T_RUN);
    expect(stored().workflowRuns).toEqual([]);
    expect(stored().ideas ?? []).toEqual([]);
    expect(stored().cloudJournal).toEqual(journalBefore);
  });

  it("a refused first registration with no cloud history stays local (positive control)", async () => {
    const w = await workflow();
    const regs = await refusedFirst(w);
    otherTab((s) => {
      s.cloudRegistrations = regs;
    });
    await hydrateStore();
    expect((await S().captureManualRun(w.id, {}, T_RUN)).kind).toBe("local");
    expect((await S().runWorkflowNow(w.id, {}, T_RUN)).ok).toBe(true);
  });
});

describe("DT-7C-2B-3-R1 one private execution instant", () => {
  const T = "2026-10-18T09:00:00.000Z";
  const moved = Date.parse("2026-10-19T09:00:00.000Z");

  it("local Manual: mutating the caller's Date after the call changes nothing", async () => {
    const w = await workflow();
    const now = new Date(T);
    const p = S().captureManualRun(w.id, {}, now);
    now.setTime(moved);
    const r = await p;
    expect(r.kind).toBe("local");
    if (r.kind !== "local") return;
    expect(r.run.startedAt).toBe(T);
    expect(day(r.run)).toBe("2026-10-18");
    expect(stored().workflowRuns[0]).toEqual(r.run);
  });

  it("local Ready: the article and its local member share the captured instant", async () => {
    await readyWorkflow();
    const a = await draftArticle();
    const now = new Date(T);
    const p = S().captureArticleReady(a.id, {}, now);
    now.setTime(moved);
    const r = await p;
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect([r.article.updatedAt, r.runs[0].startedAt, day(r.runs[0])]).toEqual([
      T,
      T,
      "2026-10-18",
    ]);
    await S().drainWorkflowRuns(T_RUN);
  });

  it("mixed Ready: article time, local input day/run time and cloud executionAt are the same captured event", async () => {
    const local = await readyWorkflow();
    const cloud = await readyWorkflow([idea("c1", "Share {title}")]);
    await registered(cloud);
    const a = await draftArticle();
    const now = new Date(T);
    const p = S().captureArticleReady(a.id, { authority: authority() }, now);
    now.setTime(moved);
    const r = await p;
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.article.updatedAt).toBe(T);
    expect(r.runs.map((x) => [x.workflowId, x.startedAt, day(x)])).toEqual([
      [local.id, T, "2026-10-18"],
    ]);
    const [e] = journal().entries;
    expect([e.executionAt, e.body.input.day]).toEqual([T, "2026-10-18"]);
    expect(e.occurrenceId).toBe(await readyOccurrenceId(cloud.id, a.id, r.article.commitId));
    await S().drainWorkflowRuns(T_RUN);
  });
});

describe("DT-7C-2B-3-R1 exact combined proof and owned-only rollback (injected storage faults)", () => {
  it("ordinary persistence: the stored article, local run and journal entry are exactly the returned capture", async () => {
    await readyWorkflow();
    const cloud = await readyWorkflow();
    await registered(cloud);
    const a = await draftArticle();
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_RUN);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(stored().articles.find((x: A) => x.id === a.id)).toEqual(r.article);
    expect(stored().workflowRuns.find((x: A) => x.id === r.runs[0].id)).toEqual(r.runs[0]);
    expect(journal().entries.map((e) => e.key)).toEqual(r.entries.map((e) => e.key));
    await S().drainWorkflowRuns(T_RUN);
  });

  it("a stored draft carrying the proposed Ready commit id: not-persisted; the owned journal entry is rolled back", async () => {
    const w = await readyWorkflow();
    await registered(w);
    const a = await draftArticle();
    const spy = rewrite((s) => {
      const row = s.articles.find((x: A) => x.id === a.id);
      if (row?.status === "ready") row.status = "draft";
      return s;
    });
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_RUN);
    spy.mockRestore();
    expect(r).toEqual({ kind: "refused", reason: "not-persisted" });
    expect(stored().articles.find((x: A) => x.id === a.id)).toMatchObject({
      status: "draft",
      commitId: a.commitId,
    });
    expect(journal().entries).toEqual([]);
    expect(S().articles.find((x) => x.id === a.id)?.status).toBe("draft");
  });

  it("an altered local snapshot under the same run id/commit: not-persisted, nothing kept, nothing drains", async () => {
    const w = await workflow();
    const spy = rewrite((s) => {
      for (const row of s.workflowRuns)
        if (row.status === "queued") row.snapshot.workflow.actions[0].text.en = "Other";
      return s;
    });
    const r = await S().captureManualRun(w.id, {}, T_RUN);
    spy.mockRestore();
    expect(r).toEqual({ kind: "refused", reason: "not-persisted" });
    expect(stored().workflowRuns).toEqual([]);
    expect(S().workflowRuns).toEqual([]);
  });

  it("mixed Ready with an altered local run: not-persisted; article, run and journal all put back; no drain", async () => {
    const local = await readyWorkflow();
    const cloud = await readyWorkflow();
    await registered(cloud);
    const a = await draftArticle();
    const spy = rewrite((s) => {
      for (const row of s.workflowRuns)
        if (row.status === "queued") row.snapshot.input.slug = "tampered";
      return s;
    });
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_RUN);
    spy.mockRestore();
    expect(r).toEqual({ kind: "refused", reason: "not-persisted" });
    expect(stored().articles.find((x: A) => x.id === a.id)).toMatchObject({
      status: "draft",
      commitId: a.commitId,
    });
    expect(stored().workflowRuns).toEqual([]);
    expect(journal().entries).toEqual([]);
    await S().drainWorkflowRuns(T_RUN);
    expect(runsOf(local.id)).toEqual([]);
    expect(stored().ideas ?? []).toEqual([]);
  });

  it("a foreign newer article commit is never overwritten; only this capture's journal entry is put back", async () => {
    const w = await readyWorkflow();
    await registered(w);
    const a = await draftArticle();
    let once = false;
    const spy = rewrite((s) => {
      const row = s.articles.find((x: A) => x.id === a.id);
      if (row?.status === "ready" && !once) {
        once = true;
        row.commitId = "later-article-commit";
        row.title.en = "Later article";
      }
      return s;
    });
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_RUN);
    spy.mockRestore();
    expect(r).toEqual({ kind: "refused", reason: "not-persisted" });
    expect(stored().articles.find((x: A) => x.id === a.id)).toMatchObject({
      commitId: "later-article-commit",
      title: { en: "Later article" },
    });
    expect(journal().entries).toEqual([]);
    expect(S().articles.find((x) => x.id === a.id)?.commitId).toBe("later-article-commit");
  });

  it("a foreign run commit under the capture's run id is kept; the owned article is put back", async () => {
    await readyWorkflow();
    const a = await draftArticle();
    const spy = rewrite((s) => {
      for (const row of s.workflowRuns) if (row.status === "queued") row.commitId = "foreign-run";
      return s;
    });
    const r = await S().captureArticleReady(a.id, {}, T_RUN);
    spy.mockRestore();
    expect(r).toEqual({ kind: "refused", reason: "not-persisted" });
    expect(stored().workflowRuns.map((x: A) => x.commitId)).toEqual(["foreign-run"]);
    expect(stored().articles.find((x: A) => x.id === a.id)).toMatchObject({
      status: "draft",
      commitId: a.commitId,
    });
  });

  it("a newer journal left by another writer is kept; the owned article is put back", async () => {
    const w = await readyWorkflow();
    await registered(w);
    const a = await draftArticle();
    const newer = { ...stored().cloudJournal, generation: 99, commitId: "newer" };
    const spy = rewrite((s) => ({ ...s, cloudJournal: newer }));
    const r = await S().captureArticleReady(a.id, { authority: authority() }, T_RUN);
    spy.mockRestore();
    expect(r).toEqual({ kind: "refused", reason: "not-persisted" });
    expect(stored().cloudJournal).toEqual(newer);
    expect(stored().articles.find((x: A) => x.id === a.id)).toMatchObject({
      status: "draft",
      commitId: a.commitId,
    });
  });
});
