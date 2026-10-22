// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorityOf } from "@/lib/cloudWorkflowProtocol";
import type { ClientFetch, ClientResponse } from "@/lib/cloudWorkflowClient";
import {
  REGISTRATION_CAPACITY,
  createIntent,
  emptyRegistrations,
  findRecord,
  prepareIntent,
  readRegistrations,
  registrationKey,
  verifyRegistrations,
  type CloudRegistrations,
} from "@/lib/cloudWorkflowRegistration";
import { createRegistrationController } from "@/lib/cloudWorkflowRegistrationClient";
import { kitProjection } from "@/lib/businessKit";
import {
  STORAGE_KEY,
  cloudRegistrationPersistence,
  saveStatus,
  savesSettled,
  setArticlesLock,
  useStore,
  type ArticlesLock,
} from "./index";

// ⚙️ DT-7C-2B-2 registration intents in the store (planning/tools/38-cloud-workflows.md): the new `cloudRegistrations`
// slice through the shared `3z-prod-articles` lock with exact read-back, locked-only ordinary saves, reset/deletion
// that keep it, the private backup merge and projections that exclude it. Isolated jsdom storage; scripted fake fetch.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const S = () => useStore.getState();
const TOKEN = "store-token-CANARY-7c2b2";
const OWNER = "wfo_" + "a".repeat(32);
const ORIGIN = "https://scout.example";
const DIG = "d".repeat(64);
const AUTH = authorityOf(ORIGIN, OWNER)!;
const KEY = registrationKey(AUTH, "w1")!;
const T_BASE = new Date("2026-01-01T00:00:00.000Z");
const opened = (e: number) => `2026-10-18T0${e}:00:00.000Z`;
function registration(epoch: number, state: "active" | "unregistered", workflowId = "w1"): A {
  return {
    workflowId,
    registrationEpoch: epoch,
    revision: 1,
    workflowDigest: DIG,
    state,
    paused: false,
    updatedAt: state === "active" ? opened(epoch) : `2026-10-18T0${epoch}:30:00.000Z`,
    epochs: Array.from({ length: epoch }, (_, i) => ({
      epoch: i + 1,
      openedAt: opened(i + 1),
      ...(i < epoch - 1 || state === "unregistered"
        ? { closedAt: `2026-10-18T0${i + 1}:30:00.000Z` }
        : {}),
    })),
  };
}
const registerReq = (o: A = {}) => ({
  kind: "register",
  ownerKey: OWNER,
  workflowId: "w1",
  expectedEpoch: 0,
  revision: 1,
  workflowDigest: DIG,
  ...o,
});
const unregisterReq = (o: A = {}) => ({
  kind: "unregister",
  ownerKey: OWNER,
  workflowId: "w1",
  registrationEpoch: 1,
  expectedRevision: 1,
  ...o,
});
/** A response whose body chunk is this realm's Uint8Array (jsdom's Response yields another realm's bytes). */
const json = (status: number, body: unknown): ClientResponse => ({
  status,
  body: new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(Array.from(Buffer.from(JSON.stringify(body)))));
      c.close();
    },
  }),
});
const okRegister = (req: A, created = true) =>
  json(200, {
    ownerKey: OWNER,
    registration: registration(req.expectedEpoch + 1, "active", req.workflowId),
    created,
  });

/** A valid manual occurrence body (as in store/cloudWorkflows.test.ts) for one journal commit. */
const occurrenceBody = () => ({
  occurrenceId: "m1",
  ownerKey: OWNER,
  workflowId: "w1",
  kind: "manual",
  registrationEpoch: 1,
  revision: 1,
  snapshot: {
    name: { ar: "", en: "Flow" },
    trigger: { kind: "manual" },
    actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea {date}" } }],
  },
  plannerContext: null,
  input: {
    title: { ar: "", en: "" },
    summary: { ar: "", en: "" },
    slug: "",
    lang: "en",
    day: "2026-10-17",
  },
  executionAt: "2026-10-17T09:00:00.000Z",
});

/** Scripted transport: the handshake answers OWNER; POSTs follow `mode`. Records every POST body. */
function net() {
  const st = {
    mode: "ok" as "ok" | "lost",
    posts: [] as string[],
    seenAtPost: [] as A[],
  };
  const fetch: ClientFetch = async (url, init) => {
    if (url.endsWith("/authority")) return json(200, { ownerKey: OWNER });
    st.posts.push(init.body!);
    st.seenAtPost.push(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.cloudRegistrations);
    if (st.mode === "lost") throw new TypeError("answer lost");
    const req = JSON.parse(init.body!);
    return url.endsWith("/unregister")
      ? json(200, {
          ownerKey: OWNER,
          registration: registration(req.registrationEpoch, "unregistered"),
          changed: false,
        })
      : okRegister(req, false);
  };
  return { st, fetch };
}
async function controller(n = net(), persistence = cloudRegistrationPersistence) {
  const ctl = createRegistrationController({ fetch: n.fetch, persistence });
  ctl.configure({ origin: ORIGIN, token: TOKEN });
  expect(await ctl.handshake()).toMatchObject({ ok: true });
  return { ctl, n };
}

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
const rawStored = () => localStorage.getItem(STORAGE_KEY)!;
const stored = (): A => JSON.parse(rawStored()).state;
const slice = (): CloudRegistrations => readRegistrations(stored().cloudRegistrations)!;
const intent = (key = KEY) => findRecord(slice(), key)?.intent;
const otherTab = (edit: (state: A) => void) => {
  const raw = JSON.parse(rawStored());
  edit(raw.state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
};
const quota = () => {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
    if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
    real.call(this, k, v);
  });
};
/** A slice of `n` pending register intents for <prefix>0..<prefix>(n-1), as another device would have stored it. */
function seeded(n: number, prefix = "w"): CloudRegistrations {
  let s = emptyRegistrations();
  for (let i = 0; i < n; i++) {
    const p = prepareIntent(registerReq({ workflowId: `${prefix}${i}` }), AUTH);
    if (!p.ok) throw new Error(p.reason);
    const r = createIntent(s, p, `seed-${i}`, "2026-10-18T07:00:00.000Z");
    if (!r.ok) throw new Error(r.reason);
    s = r.next;
  }
  return s;
}
/** An uncertain register intent for w1 (a lost answer), through the real store. */
async function uncertain() {
  const n = net();
  n.st.mode = "lost";
  const { ctl } = await controller(n);
  expect(await ctl.register(registerReq())).toMatchObject({ state: "uncertain" });
  return { ctl, n };
}

beforeEach(async () => {
  localStorage.clear();
  setArticlesLock(queueLock());
  expect(await S().reset(T_BASE)).toEqual({ ok: true, retained: 0 });
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
});
afterEach(async () => {
  await savesSettled();
  setArticlesLock(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the store adapter: durable intent before the POST, exact read-back, reload", () => {
  it("writes pending, then a reserved attempt, before the mutation fetch; settles; survives a reload revalidated", async () => {
    const { ctl, n } = await controller();
    expect(await ctl.register(registerReq())).toMatchObject({ kind: "recorded", state: "settled" });
    expect(n.st.seenAtPost).toHaveLength(1);
    const atPost = readRegistrations(n.st.seenAtPost[0])!;
    expect(findRecord(atPost, KEY)!.intent).toMatchObject({
      state: "dispatching",
      attempts: 1,
      request: registerReq(),
    });
    expect(JSON.parse(n.st.posts[0])).toEqual(findRecord(atPost, KEY)!.intent.body);
    expect(intent()).toMatchObject({ state: "settled" });
    expect(await verifyRegistrations(slice())).toBe(true);
    // A reload: a new store instance reads the same slice; nothing is replayed by itself.
    vi.resetModules();
    const fresh = await import("./index");
    await fresh.hydrateStore();
    const again = await fresh.cloudRegistrationPersistence.read();
    expect(again && findRecord(again, KEY)!.intent.state).toBe("settled");
    expect(n.st.posts).toHaveLength(1);
  });

  it("a lost answer survives a reload as uncertain and recovers only explicitly with the identical request", async () => {
    const { n } = await uncertain();
    vi.resetModules();
    const fresh = await import("./index");
    await fresh.hydrateStore();
    fresh.setArticlesLock(queueLock());
    expect(n.st.posts).toHaveLength(1); // nothing on reload/hydration
    const m = net();
    const { ctl } = await controller(m, fresh.cloudRegistrationPersistence);
    expect(await ctl.recover(KEY)).toMatchObject({ state: "settled" });
    expect(m.st.posts).toEqual([n.st.posts[0]]);
  });

  it("failed write, failed read-back, no Web Locks, a lock error and an unreadable slice: zero POST, nothing changed", async () => {
    const before = rawStored();
    const { ctl, n } = await controller();
    const q = quota();
    expect(await ctl.register(registerReq())).toMatchObject({ reason: "not_persisted" });
    q.mockRestore();
    expect(rawStored()).toBe(before);
    // A write the browser silently drops: the read-back fails and nothing is dispatched.
    const real = Storage.prototype.setItem;
    const drop = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k !== STORAGE_KEY) real.call(this, k, v);
    });
    expect(await ctl.register(registerReq())).toMatchObject({ reason: "not_persisted" });
    drop.mockRestore();
    setArticlesLock(null);
    expect(await ctl.register(registerReq())).toMatchObject({ reason: "unsupported_save" });
    setArticlesLock(() => Promise.reject(new Error("lock lost")));
    expect(await ctl.register(registerReq())).toMatchObject({ reason: "not_persisted" });
    setArticlesLock(queueLock());
    otherTab((s) => (s.cloudRegistrations = { v: 1, broken: true }));
    expect(await ctl.register(registerReq())).toMatchObject({ reason: "unreadable" });
    expect(n.st.posts).toHaveLength(0);
    // The unreadable slice is kept verbatim by an ordinary save.
    S().setSettings({ reminderTime: "06:41" });
    await savesSettled();
    expect(stored().cloudRegistrations).toEqual({ v: 1, broken: true });
  });
});

describe("two tabs (two store instances, one lock)", () => {
  it("both recover one key from the same durable base: exactly one reservation and one replay", async () => {
    const { n } = await uncertain();
    const lock = queueLock();
    setArticlesLock(lock);
    vi.resetModules();
    const B = await import("./index");
    await B.hydrateStore();
    B.setArticlesLock(lock);
    const na = net();
    const nb = net();
    const { ctl: a } = await controller(na);
    const { ctl: b } = await controller(nb, B.cloudRegistrationPersistence);
    const rs = await Promise.all([a.recover(KEY), b.recover(KEY)]);
    expect(rs.map((r) => (r.kind === "refused" ? r.reason : r.kind)).sort()).toEqual([
      "recorded",
      "stale_record",
    ]);
    expect(na.st.posts.length + nb.st.posts.length).toBe(1);
    expect([...na.st.posts, ...nb.st.posts]).toEqual([n.st.posts[0]]);
    expect(intent()).toMatchObject({ state: "settled", attempts: 2 });
    await B.savesSettled();
    B.setArticlesLock(undefined);
  });
});

describe("ordinary saves and other locked commits keep the slice", () => {
  it("an ordinary save writes the stored slice verbatim, never this tab's memory (absent stays absent)", async () => {
    await uncertain();
    // Another tab advanced the slice (its storage event not delivered yet).
    otherTab((s) => (s.cloudRegistrations = { ...s.cloudRegistrations, generation: 77 }));
    const theirs = JSON.stringify(stored().cloudRegistrations);
    S().setSettings({ reminderTime: "07:11" });
    await savesSettled();
    expect(JSON.stringify(stored().cloudRegistrations)).toBe(theirs);
    // Removed in storage while memory still holds it: an ordinary save does not resurrect it.
    otherTab((s) => delete s.cloudRegistrations);
    S().setSettings({ reminderTime: "07:12" });
    await savesSettled();
    expect("cloudRegistrations" in stored()).toBe(false);
    expect(stored().settings.reminderTime).toBe("07:12");
  });

  it("slice bytes an ordinary save could not write back verbatim are refused, not rewritten", async () => {
    await uncertain();
    const all = rawStored();
    const at = all.indexOf('"generation":', all.indexOf('"cloudRegistrations":'));
    const raw = `${all.slice(0, at)}"generation": ${all.slice(at + '"generation":'.length)}`;
    expect(JSON.parse(raw)).toEqual(JSON.parse(all)); // same data, other bytes
    localStorage.setItem(STORAGE_KEY, raw);
    S().setSettings({ reminderTime: "07:13" });
    await savesSettled();
    expect(saveStatus.getState().failed).toBe("unreadable");
    expect(rawStored()).toBe(raw);
  });

  it("an article commit, a journal commit and a registration commit each keep the other opaque slice's bytes", async () => {
    await uncertain();
    const regBytes = () => JSON.stringify(stored().cloudRegistrations);
    const before = regBytes();
    expect(await S().addArticle({ title: { ar: "", en: "Keep" } })).toMatchObject({ ok: true });
    expect(regBytes()).toBe(before);
    expect(await S().enqueueCloudOccurrence(ORIGIN, occurrenceBody())).toMatchObject({ ok: true });
    expect(regBytes()).toBe(before);
    const journalBefore = JSON.stringify(stored().cloudJournal);
    const { ctl } = await controller();
    expect(await ctl.recover(KEY)).toMatchObject({ state: "settled" });
    expect(JSON.stringify(stored().cloudJournal)).toBe(journalBefore);
    expect(stored().articles).toHaveLength(1);
  });

  it("a workflow removed by another tab, then an ordinary save: the intent stays and nothing is sent", async () => {
    const { n } = await uncertain();
    expect(await S().addWorkflow({ name: { ar: "", en: "W" } })).toMatchObject({ ok: true });
    otherTab((s) => (s.workflows = []));
    S().setSettings({ reminderTime: "07:14" });
    await savesSettled();
    expect(stored().workflows).toEqual([]);
    expect(intent()).toMatchObject({ state: "uncertain" });
    expect(n.st.posts).toHaveLength(1);
  });
});

describe("reset keeps evidence and unresolved recovery", () => {
  it("clears ordinary content and workflows, keeps the slice exactly, replays nothing; recovery still works", async () => {
    const { n } = await uncertain();
    expect(await S().addWorkflow({ name: { ar: "", en: "W" } })).toMatchObject({ ok: true });
    const before = JSON.stringify(stored().cloudRegistrations);
    expect(await S().reset(new Date("2026-10-18T09:00:00.000Z"))).toMatchObject({ ok: true });
    expect(stored().workflows).toEqual([]);
    expect(JSON.stringify(stored().cloudRegistrations)).toBe(before);
    expect(n.st.posts).toHaveLength(1);
    const { ctl } = await controller();
    expect(await ctl.recover(KEY)).toMatchObject({ state: "settled" });
  });

  it("a failed reset (quota) keeps the slice", async () => {
    await uncertain();
    const before = rawStored();
    const q = quota();
    expect(await S().reset()).toEqual({ ok: false, reason: "not-persisted" });
    q.mockRestore();
    expect(rawStored()).toBe(before);
  });
});

describe("private backup: export includes it, import revalidates and merges monotonically", () => {
  async function settledThenUnregisterPending() {
    const { ctl } = await controller();
    expect(await ctl.register(registerReq())).toMatchObject({ state: "settled" });
    const backup = S().exportState(); // seq 1 settled
    const n = net();
    n.st.mode = "lost";
    const { ctl: c2 } = await controller(n);
    expect(await c2.unregister(unregisterReq(), DIG)).toMatchObject({ state: "uncertain" });
    return backup;
  }
  const fileWith = (edit: (state: A) => void) => {
    const f = JSON.parse(S().exportState());
    edit(f.state);
    return JSON.stringify(f);
  };

  it("round-trips onto a cleared device, revalidated; a legacy backup keeps the device's slice", async () => {
    await uncertain();
    const backup = S().exportState();
    expect(JSON.parse(backup).state.cloudRegistrations).toEqual(stored().cloudRegistrations);
    const legacy = fileWith((s) => delete s.cloudRegistrations);
    localStorage.clear();
    await useStore.persist.rehydrate();
    expect(await S().importState(backup)).toEqual({ ok: true, rejected: [] });
    expect(intent()).toMatchObject({ state: "uncertain" });
    const kept = JSON.stringify(stored().cloudRegistrations);
    expect(await S().importState(legacy)).toEqual({ ok: true, rejected: [] });
    expect(JSON.stringify(stored().cloudRegistrations)).toBe(kept);
  });

  it("an older backup never resurrects a settled decision; local unresolved work is preserved", async () => {
    const old = await settledThenUnregisterPending();
    expect(await S().importState(old)).toEqual({ ok: true, rejected: [] });
    expect(intent()).toMatchObject({ seq: 2, state: "uncertain", request: unregisterReq() });
  });

  it("contradictory and equal-version imports: identical is unchanged, another identity refuses with nothing changed", async () => {
    await uncertain();
    const same = S().exportState();
    expect(await S().importState(same)).toEqual({ ok: true, rejected: [] });
    const before = rawStored();
    const other = fileWith((s) => {
      s.cloudRegistrations.records[0].intent.operationId = "someone-else";
    });
    expect(await S().importState(other)).toEqual({
      ok: false,
      reason: "journal-conflict",
      keys: [KEY],
      scope: "registrations",
    });
    expect(rawStored()).toBe(before);
    // A newer intent from a backup over local unresolved work refuses too.
    const newer = fileWith((s) => {
      const i = s.cloudRegistrations.records[0].intent;
      Object.assign(i, { seq: 2, operationId: "newer", state: "pending", attempts: 0 });
      Object.assign(i, { maybeApplied: false, reservedFrom: null, answer: null });
    });
    expect(await S().importState(newer)).toMatchObject({
      reason: "journal-conflict",
      scope: "registrations",
    });
    expect(rawStored()).toBe(before);
  });

  it("a forged answer is invalid, a malformed slice throws, an overflowing union refuses, no Web Locks refuses", async () => {
    const { ctl } = await controller();
    expect(await ctl.register(registerReq())).toMatchObject({ state: "settled" });
    const before = rawStored();
    const forged = fileWith((s) => {
      s.cloudRegistrations.records[0].intent.answer.body.registration.revision = 9;
    });
    expect(await S().importState(forged)).toEqual({
      ok: false,
      reason: "journal-invalid",
      scope: "registrations",
    });
    expect(() =>
      S().importState(fileWith((s) => (s.cloudRegistrations = { v: 1, records: "x" }))),
    ).toThrow();
    expect(() => S().importState(fileWith((s) => (s.cloudRegistrations = { v: 2 })))).toThrow();
    const many = fileWith((s) => (s.cloudRegistrations = seeded(REGISTRATION_CAPACITY, "x")));
    expect(await S().importState(many)).toEqual({
      ok: false,
      reason: "journal-capacity",
      scope: "registrations",
    });
    setArticlesLock(null);
    expect(await S().importState(S().exportState())).toEqual({
      ok: false,
      reason: "unsupported-save",
    });
    setArticlesLock(queueLock());
    expect(rawStored()).toBe(before);
  });
});

describe("import onto an unreadable device slice", () => {
  it("refuses with nothing changed (the unreadable slice is never replaced)", async () => {
    await uncertain();
    const backup = S().exportState();
    otherTab((s) => (s.cloudRegistrations = { v: 1, broken: true }));
    const before = rawStored();
    expect(await S().importState(backup)).toEqual({
      ok: false,
      reason: "journal-unreadable",
      scope: "registrations",
    });
    expect(rawStored()).toBe(before);
  });
});

// DT-7C-2B-2-R1 (7C2B2-1): a registration-bearing restore revalidates the CURRENT durable slice, read under the lock.
describe("import revalidates the current durable registration proof under the lock", () => {
  const INVALID = { ok: false, reason: "journal-invalid", scope: "registrations" };
  /** Corrupt the saved answer's revision (its bound request unchanged): structurally fine, protocol-invalid. */
  const corrupt = (s: A) => {
    s.cloudRegistrations.records[0].intent.answer.body.registration.revision = 9;
  };
  /** The next lock holder waits until `run` is called; later holders use a normal serial lock. */
  async function holdNextLock() {
    await savesSettled();
    const serial = queueLock();
    let run!: () => Promise<void>;
    const waiting = new Promise<void>((entered) => {
      const once: ArticlesLock = <T>(fn: () => Promise<T>) => {
        setArticlesLock(serial);
        return new Promise<T>((resolve, reject) => {
          run = () => fn().then(resolve, reject);
          entered();
        });
      };
      setArticlesLock(once);
    });
    return { waiting, run: () => run() };
  }
  async function settledBackup() {
    const { ctl } = await controller();
    expect(await ctl.register(registerReq())).toMatchObject({ state: "settled" });
    return S().exportState();
  }

  it("an invalid current proof refuses a valid backup (also an empty one) with nothing written", async () => {
    const backup = await settledBackup();
    const empty = JSON.parse(backup);
    empty.state.cloudRegistrations = emptyRegistrations();
    otherTab(corrupt);
    expect(await cloudRegistrationPersistence.read()).toBeNull();
    const before = rawStored();
    expect(await S().importState(backup)).toEqual(INVALID);
    expect(await S().importState(JSON.stringify(empty))).toEqual(INVALID);
    expect(rawStored()).toBe(before);
  });

  it("an invalid record introduced while the import waits for the lock cannot bypass the validation", async () => {
    const backup = await settledBackup();
    const hold = await holdNextLock();
    const pending = S().importState(backup);
    await hold.waiting;
    otherTab(corrupt);
    const before = rawStored();
    await hold.run();
    expect(await pending).toEqual(INVALID);
    expect(rawStored()).toBe(before);
  });

  it("a slice that changes after the verified under-lock read refuses (fail closed, no retry)", async () => {
    const backup = await settledBackup();
    const hold = await holdNextLock();
    const pending = S().importState(backup);
    await hold.waiting;
    // The first storage read inside the lock is the verified snapshot; another writer lands right after it.
    const real = Storage.prototype.getItem;
    let first = true;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k) {
      const v = real.call(this, k);
      if (k === STORAGE_KEY && first) {
        first = false;
        void Promise.resolve().then(() =>
          otherTab(
            (s) => (s.cloudRegistrations.records[0].intent.createdAt = T_BASE.toISOString()),
          ),
        );
      }
      return v;
    });
    await hold.run();
    vi.restoreAllMocks();
    const before = rawStored();
    expect(await pending).toEqual(INVALID);
    expect(rawStored()).toBe(before);
  });

  it("a valid newer local record introduced while the import waits is validated and kept by the merge", async () => {
    const backup = await settledBackup();
    const n = net();
    n.st.mode = "lost";
    const { ctl } = await controller(n);
    expect(await ctl.unregister(unregisterReq(), DIG)).toMatchObject({ state: "uncertain" });
    const newer = stored().cloudRegistrations;
    otherTab((s) => (s.cloudRegistrations = JSON.parse(backup).state.cloudRegistrations));
    const hold = await holdNextLock();
    const pending = S().importState(backup);
    await hold.waiting;
    otherTab((s) => (s.cloudRegistrations = newer));
    await hold.run();
    expect(await pending).toEqual({ ok: true, rejected: [] });
    expect(intent()).toMatchObject({ seq: 2, state: "uncertain", request: unregisterReq() });
    expect(await cloudRegistrationPersistence.read()).not.toBeNull();
  });

  it("a legacy backup over an invalid current slice keeps those bytes verbatim (no repair, no erase)", async () => {
    const backup = JSON.parse(await settledBackup());
    delete backup.state.cloudRegistrations;
    otherTab(corrupt);
    const kept = JSON.stringify(stored().cloudRegistrations);
    expect(await S().importState(JSON.stringify(backup))).toEqual({ ok: true, rejected: [] });
    expect(JSON.stringify(stored().cloudRegistrations)).toBe(kept);
  });
});

describe("capacity 100 without eviction", () => {
  it("refuses a new key at the cap; an existing key's recovery still works", async () => {
    const full = seeded(REGISTRATION_CAPACITY);
    otherTab((s) => (s.cloudRegistrations = full));
    const { ctl, n } = await controller();
    expect(await ctl.register(registerReq({ workflowId: "extra" }))).toMatchObject({
      reason: "capacity",
    });
    expect(n.st.posts).toHaveLength(0);
    const k0 = registrationKey(AUTH, "w0")!;
    expect(await ctl.recover(k0)).toMatchObject({ state: "settled" });
    expect(slice().records).toHaveLength(REGISTRATION_CAPACITY);
  });
});

describe("privacy canaries and projections", () => {
  it("no token reaches storage or the export; the public kit projection never reads the slice", async () => {
    await uncertain();
    expect(rawStored()).not.toContain(TOKEN);
    expect(S().exportState()).not.toContain(TOKEN);
    const projection = JSON.stringify(kitProjection(S()));
    expect(projection).not.toContain(OWNER);
    expect(projection).not.toContain("cloudRegistrations");
    expect(projection).not.toContain(ORIGIN);
    expect(JSON.stringify(stored().settings)).not.toContain(OWNER);
  });
});
