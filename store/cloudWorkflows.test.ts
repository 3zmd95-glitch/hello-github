// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  payloadDigestOf,
  sha256Hex,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityOf,
  occurrenceKey,
  parseAnswer,
  type CloudRequest,
  type Parsed,
} from "@/lib/cloudWorkflowProtocol";
import {
  JOURNAL_CAPACITY,
  candidateEntry,
  observationOf,
  readJournal,
  resetJournal,
  withEntry,
  withObservation,
  type CloudJournal,
  type JournalEntry,
} from "@/lib/cloudWorkflowJournal";
import { accumulateCategoryCandidates } from "@/lib/discoverFeed";
import { instagramShortcodeAt } from "@/workers/scout/src/postDate";
import {
  STORAGE_KEY,
  accountFor,
  cloudJournalRetained,
  loadCloudJournal,
  saveStatus,
  savesSettled,
  setArticlesLock,
  useStore,
  type ArticlesLock,
} from "./index";

// ⚙️ DT-7C-2A durable cloud-workflow journal in the store (planning/tools/38-cloud-workflows.md): authority-scoped
// entries and observed receipts under the shared `3z-prod-articles` lock with exact read-back, reset that keeps the
// journal and advances suppression, and the restore merge. Isolated jsdom storage only; no network, no transport.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const S = () => useStore.getState();
const OWNER = "wfo_" + "a".repeat(32);
const ORIGIN = "https://scout.example";
const ORIGIN_B = "https://other.example";
const AT = "2026-10-17T09:00:00.000Z";
const SUBMITTED = "2026-10-17T09:05:00.000Z";
const T_BASE = new Date("2026-01-01T00:00:00.000Z");
const T_RESET = new Date("2026-10-17T10:00:00.000Z");
const T_LATER = new Date("2026-10-17T12:00:00.000Z");
const CANARY = "CANARY-7c2a-private";

const idea = (id: string, en = "Idea {date}") => ({ id, kind: "idea", text: { ar: "", en } });
function bodyOf(o: A = {}): OccurrenceBody {
  return {
    occurrenceId: o.id ?? "m1",
    ownerKey: OWNER,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "", en: o.name ?? "Flow" },
      trigger: { kind: "manual" },
      actions: [idea("a1")],
    },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt: AT,
  } as unknown as OccurrenceBody;
}
const digestOf = (b: unknown) => sha256Hex(canonicalJson(b));
async function pendingReceipt(b: OccurrenceBody): Promise<A> {
  return {
    occurrenceId: b.occurrenceId,
    workflowId: b.workflowId,
    kind: b.kind,
    registrationEpoch: 1,
    revision: 1,
    body: JSON.parse(JSON.stringify(b)),
    payloadDigest: await digestOf(b),
    state: "pending",
    receiptVersion: 1,
    changeSeq: 1,
    createdAt: SUBMITTED,
    updatedAt: SUBMITTED,
    ackedVersion: 0,
    steps: [{ idx: 0, actionId: "a1", kind: "idea", status: "pending" }],
    outputs: [],
  };
}
async function doneReceipt(b: OccurrenceBody, text = "Idea 2026-10-17"): Promise<A> {
  const id = `wf:${b.occurrenceId}:a1`;
  const record = { id, text, source: "workflow", createdAt: AT };
  const digest = await digestOf(record);
  const finished = "2026-10-17T09:06:00.000Z";
  return {
    ...(await pendingReceipt(b)),
    state: "done",
    receiptVersion: 3,
    changeSeq: 3,
    startedAt: SUBMITTED,
    finishedAt: finished,
    updatedAt: finished,
    purgeAt: new Date(Date.parse(finished) + 180 * 86_400_000).toISOString(),
    steps: [
      {
        idx: 0,
        actionId: "a1",
        kind: "idea",
        status: "done",
        outputId: id,
        outputDigest: digest,
        at: finished,
      },
    ],
    outputs: [{ outputId: id, actionId: "a1", kind: "idea", digest, record }],
  };
}
const statusReq = (id = "m1"): CloudRequest => ({
  kind: "status",
  ownerKey: OWNER,
  occurrenceId: id,
});
const statusParsed = (receipt: A, origin = ORIGIN): Promise<Parsed> =>
  parseAnswer(
    statusReq(receipt.occurrenceId),
    { status: 200, body: { ownerKey: OWNER, occurrence: receipt } },
    { origin },
  );

/** Serializes like Web Locks: each holder runs after the previous one released. */
const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
const stored = (): A => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const storedJournal = (): CloudJournal => readJournal(stored().cloudJournal)!;
/** Write the stored payload as another tab would (its storage event not delivered yet). */
const otherTab = (edit: (state: A) => void) => {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  edit(raw.state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
};
const enqueue = async (body: unknown = bodyOf(), origin = ORIGIN) => {
  const r = await S().enqueueCloudOccurrence(origin, body);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const load = async () => {
  const l = await loadCloudJournal();
  if (!l.ok) throw new Error(l.reason);
  return l;
};
const quota = () => {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
    if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
    real.call(this, k, v);
  });
};
/** Hold every SHA-256 digest until released (the asynchronous validation window). */
const holdDigests = () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = new Promise<void>((r) => (started = r));
  const real = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementation(
    async (...args: Parameters<SubtleCrypto["digest"]>) => {
      started();
      await gate;
      return real(...args);
    },
  );
  return { first, release };
};
const progressSnapshot = () => ({ completions: S().completions, xp: S().xpEvents });
/** A journal of `n` valid entries m0..m(n-1) (digests computed), as it would be stored. */
async function journalOf(n: number, prefix = "m"): Promise<CloudJournal> {
  const c = await candidateEntry(ORIGIN, bodyOf());
  if (!c.ok) throw new Error(c.reason);
  let j = readJournal(undefined)!;
  const entries: JournalEntry[] = [];
  for (let i = 0; i < n; i++) {
    const body = { ...c.entry.body, occurrenceId: `${prefix}${i}` } as OccurrenceBody;
    entries.push({
      ...c.entry,
      key: occurrenceKey(authorityOf(ORIGIN, OWNER)!, `${prefix}${i}`)!,
      occurrenceId: `${prefix}${i}`,
      body,
      payloadDigest: await payloadDigestOf(body),
      commitId: `c-${prefix}${i}`,
      state: "queued",
      observation: null,
    });
  }
  j = {
    ...j,
    generation: 1,
    commitId: "seed",
    entries: entries.sort((x, y) => (x.key < y.key ? -1 : 1)),
  };
  return j;
}

beforeEach(async () => {
  localStorage.clear();
  setArticlesLock(queueLock());
  expect(await S().reset(T_BASE)).toEqual({ ok: true, retained: 0 });
});
afterEach(() => {
  setArticlesLock(undefined);
  vi.restoreAllMocks();
});

describe("journaling an occurrence", () => {
  it("writes one authority-scoped entry with an exact read-back, and survives a real reload", async () => {
    const r = await enqueue();
    expect(r.created).toBe(true);
    expect(r.entry).toMatchObject({
      key: occurrenceKey(authorityOf(ORIGIN, OWNER)!, "m1"),
      authority: { origin: ORIGIN, ownerKey: OWNER },
      executionAt: AT,
      state: "queued",
      observation: null,
    });
    expect(storedJournal().entries).toEqual([r.entry]);
    expect(storedJournal().commitId).toBe(r.entry.commitId);
    // A reload: a new store instance reads the same durable journal back and revalidates it.
    vi.resetModules();
    const fresh = await import("./index");
    await fresh.hydrateStore();
    const l = await fresh.loadCloudJournal();
    expect(l.ok && l.entries.map((e) => [e.key, e.commitId, e.state, e.observed])).toEqual([
      [r.entry.key, r.entry.commitId, "queued", null],
    ]);
    // Nothing local was created: no run, idea, post or plan row.
    expect(S().workflowRuns).toEqual([]);
    expect(S().ideas).toEqual([]);
    expect(S().posts).toEqual([]);
    expect(S().planItems).toEqual([]);
  });

  it("is idempotent for the same key and digest (a lost answer is recovered after a reload) and conflicts on a changed digest", async () => {
    const first = await enqueue();
    vi.resetModules();
    const fresh = await import("./index");
    await fresh.hydrateStore();
    fresh.setArticlesLock(queueLock());
    const again = await fresh.useStore.getState().enqueueCloudOccurrence(ORIGIN, bodyOf());
    expect(again).toEqual({ ok: true, entry: first.entry, created: false });
    const changed = await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ name: "Changed" }));
    expect(changed).toEqual({ ok: false, reason: "conflict", current: first.entry });
    expect(storedJournal().entries).toEqual([first.entry]);
  });

  it("keeps two authorities with the same occurrence id apart", async () => {
    const a = await enqueue(bodyOf(), ORIGIN);
    const b = await enqueue(bodyOf({ name: "Other" }), ORIGIN_B);
    expect(a.entry.key).not.toBe(b.entry.key);
    expect((await load()).entries.map((e) => e.origin).sort()).toEqual([ORIGIN_B, ORIGIN].sort());
  });

  it("refuses invalid input, a cloud limitation and a suppressed trigger without writing", async () => {
    const before = localStorage.getItem(STORAGE_KEY);
    expect(await S().enqueueCloudOccurrence(ORIGIN, { ...bodyOf(), token: CANARY })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await S().enqueueCloudOccurrence("https://x.example/path", bodyOf())).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(await S().reset(T_RESET)).toEqual({ ok: true, retained: 0 });
    expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf())).toEqual({
      ok: false,
      reason: "suppressed",
    });
    expect(storedJournal().entries).toEqual([]);
  });

  it("fails honestly without Web Locks, on a lock error, on quota and on an unreadable journal (never as empty)", async () => {
    await enqueue();
    const journal = localStorage.getItem(STORAGE_KEY);
    setArticlesLock(null);
    expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m2" }))).toEqual({
      ok: false,
      reason: "unsupported-save",
    });
    setArticlesLock(() => Promise.reject(new Error("lock lost")));
    expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m2" }))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    setArticlesLock(queueLock());
    const q = quota();
    expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m2" }))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    q.mockRestore();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(journal);
    expect(readJournal(S().cloudJournal)).toEqual(storedJournal());

    otherTab((s) => (s.cloudJournal = { v: 1, broken: true }));
    await useStore.persist.rehydrate();
    expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m2" }))).toEqual({
      ok: false,
      reason: "journal-unreadable",
    });
    expect(await loadCloudJournal()).toEqual({ ok: false, reason: "journal-unreadable" });
    expect(cloudJournalRetained(S())).toBeNull();
    // An ordinary write elsewhere keeps the unreadable journal verbatim; nothing replaces it with an empty one.
    S().setSettings({ reminderTime: "06:45" });
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    expect(stored().cloudJournal).toEqual({ v: 1, broken: true });
    expect(stored().settings.reminderTime).toBe("06:45");
  });
});

describe("races (two tabs, held digests, held read-back)", () => {
  it("another tab journals the same key during the held validation: same digest is idempotent, other digest conflicts", async () => {
    const mine = await candidateEntry(ORIGIN, bodyOf());
    const theirs = await candidateEntry(ORIGIN, bodyOf({ name: "Theirs" }));
    if (!mine.ok || !theirs.ok) throw new Error("setup");
    for (const [other, expected] of [
      [mine.entry, "idempotent"],
      [theirs.entry, "conflict"],
    ] as const) {
      localStorage.clear();
      await S().reset(T_BASE);
      const j = withEntry(
        storedJournal(),
        { ...other, commitId: "tab-b", state: "queued", observation: null },
        "tab-b",
      );
      const h = holdDigests();
      const p = S().enqueueCloudOccurrence(ORIGIN, bodyOf());
      await h.first;
      otherTab((s) => (s.cloudJournal = j));
      h.release();
      const r = await p;
      vi.restoreAllMocks();
      const kept = j.entries[0];
      expect(r).toEqual(
        expected === "idempotent"
          ? { ok: true, entry: kept, created: false }
          : { ok: false, reason: "conflict", current: kept },
      );
      expect(storedJournal()).toEqual(j);
    }
  });

  it("two overlapping enqueues of one key with different bodies: one commits, the other conflicts", async () => {
    const h = holdDigests();
    const one = S().enqueueCloudOccurrence(ORIGIN, bodyOf());
    const two = S().enqueueCloudOccurrence(ORIGIN, bodyOf({ name: "Two" }));
    await h.first;
    h.release();
    // Either may reach the lock first once the digests are released: exactly one commits, the other conflicts with it.
    const results = await Promise.all([one, two]);
    const won = results.filter((r) => r.ok && r.created);
    const lost = results.filter((r) => !r.ok && r.reason === "conflict");
    expect([won.length, lost.length]).toEqual([1, 1]);
    expect(lost[0]).toMatchObject({ current: storedJournal().entries[0] });
    expect(storedJournal().entries).toHaveLength(1);
  });

  it("keeps another tab's unrelated write made during the held validation", async () => {
    const h = holdDigests();
    const p = S().enqueueCloudOccurrence(ORIGIN, bodyOf());
    await h.first;
    otherTab((s) => (s.settings.reminderTime = "05:15"));
    h.release();
    expect((await p).ok).toBe(true);
    expect(stored().settings.reminderTime).toBe("05:15");
    expect(S().settings.reminderTime).toBe("05:15");
  });

  it("a reset during the held validation invalidates the candidate", async () => {
    const h = holdDigests();
    const p = S().enqueueCloudOccurrence(ORIGIN, bodyOf());
    await h.first;
    expect(await S().reset(new Date("2026-03-01T00:00:00.000Z"))).toEqual({
      ok: true,
      retained: 0,
    });
    h.release();
    expect(await p).toEqual({ ok: false, reason: "stale" });
    expect(storedJournal().entries).toEqual([]);
    expect(storedJournal().suppression.epoch).toBe(1);
  });

  it("a newer journal landing before the read-back is never overwritten by the rollback", async () => {
    await enqueue();
    const base = storedJournal();
    const newer: CloudJournal = {
      ...base,
      generation: base.generation + 5,
      commitId: "tab-b-newer",
    };
    const real = Storage.prototype.setItem;
    let armed = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      real.call(this, k, v);
      if (k === STORAGE_KEY && armed) {
        armed = false;
        const raw = JSON.parse(v);
        raw.state.cloudJournal = newer;
        real.call(this, k, JSON.stringify(raw));
      }
    });
    expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m2" }))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(storedJournal()).toEqual(newer);
    expect(readJournal(S().cloudJournal)).toEqual(newer);
  });
});

describe("observed receipts", () => {
  it("records a verified receipt with its authority; revalidates it after reload; never as delivery proof", async () => {
    const e = await enqueue();
    expect(
      await S().observeCloudReceipt(
        await statusParsed(await pendingReceipt(bodyOf())),
        statusReq(),
      ),
    ).toEqual({ ok: true, changed: true });
    expect(
      await S().observeCloudReceipt(await statusParsed(await doneReceipt(bodyOf())), statusReq()),
    ).toEqual({ ok: true, changed: true });
    const obs = storedJournal().entries[0].observation!;
    expect(obs.authority).toEqual({ origin: ORIGIN, ownerKey: OWNER });
    expect(obs.binding).toEqual({
      kind: "status",
      ownerKey: OWNER,
      occurrenceId: "m1",
      payloadDigest: e.entry.payloadDigest,
    });
    vi.resetModules();
    const fresh = await import("./index");
    const l = await fresh.loadCloudJournal();
    expect(l.ok && l.entries[0]).toMatchObject({
      state: "queued",
      observed: { state: "done", receiptVersion: 3 },
      observationRejected: false,
    });
    // Plain data only: nothing delivered, ackable or branded leaves the projection.
    expect(Object.keys(l.ok ? l.entries[0] : {}).sort()).toEqual(
      [
        "commitId",
        "executionAt",
        "key",
        "observationRejected",
        "observed",
        "occurrenceId",
        "origin",
        "ownerKey",
        "payloadDigest",
        "state",
        "workflowId",
      ].sort(),
    );
    expect(S().workflowRuns).toEqual([]);
    expect(S().ideas).toEqual([]);
  });

  it("keeps the newer receipt, refuses an older one and an equal-version contradiction", async () => {
    await enqueue();
    await S().observeCloudReceipt(await statusParsed(await doneReceipt(bodyOf())), statusReq());
    const before = localStorage.getItem(STORAGE_KEY);
    expect(
      await S().observeCloudReceipt(
        await statusParsed(await pendingReceipt(bodyOf())),
        statusReq(),
      ),
    ).toEqual({ ok: false, reason: "older" });
    expect(
      await S().observeCloudReceipt(await statusParsed(await doneReceipt(bodyOf())), statusReq()),
    ).toEqual({ ok: true, changed: false });
    expect(
      await S().observeCloudReceipt(
        await statusParsed(await doneReceipt(bodyOf(), "Idea 2026-10-17 x")),
        statusReq(),
      ),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("refuses forged and compact observations and another authority's receipt; a tampered stored one is rejected on load", async () => {
    await enqueue();
    const receipt = await pendingReceipt(bodyOf());
    const forged = {
      outcome: "ok",
      kind: "status",
      authority: { origin: ORIGIN, ownerKey: OWNER },
      result: { found: "row", receipt },
    } as unknown as Parsed;
    expect(await S().observeCloudReceipt(forged, statusReq())).toEqual({
      ok: false,
      reason: "unverified",
    });
    const feedReq: CloudRequest = { kind: "changes", ownerKey: OWNER, after: 0 };
    const feed = await parseAnswer(
      feedReq,
      {
        status: 200,
        body: {
          ownerKey: OWNER,
          items: [
            {
              occurrenceId: "m1",
              workflowId: "w1",
              changeSeq: 1,
              state: "pending",
              receiptVersion: 1,
              payloadDigest: receipt.payloadDigest,
              steps: receipt.steps,
            },
          ],
          nextAfter: 1,
          more: false,
        },
      },
      { origin: ORIGIN },
    );
    expect(await S().observeCloudReceipt(feed, feedReq)).toEqual({
      ok: false,
      reason: "compact-feed",
    });
    expect(
      await S().observeCloudReceipt(await statusParsed(receipt, ORIGIN_B), statusReq()),
    ).toEqual({ ok: false, reason: "missing" });
    expect(storedJournal().entries[0].observation).toBeNull();

    await S().observeCloudReceipt(await statusParsed(receipt), statusReq());
    otherTab((s) => (s.cloudJournal.entries[0].observation.receipt.state = "running"));
    const l = await load();
    expect(l.entries[0]).toMatchObject({ observed: null, observationRejected: true });
    // The tampered observation is kept (never silently dropped) and blocks updates instead of being compared.
    expect(
      await S().observeCloudReceipt(await statusParsed(await doneReceipt(bodyOf())), statusReq()),
    ).toEqual({ ok: false, reason: "observation-unverified" });
  });
});

describe("reset keeps the journal and advances suppression", () => {
  it("clears ordinary content, keeps every entry and its observation, and suppresses by executionAt", async () => {
    const e = await enqueue();
    await S().observeCloudReceipt(await statusParsed(await pendingReceipt(bodyOf())), statusReq());
    S().completeQuest("smart-bins-keywords", "train");
    expect(S().completions).toHaveLength(1);
    expect(cloudJournalRetained(S())).toBe(1);
    expect(await S().reset(T_RESET)).toEqual({ ok: true, retained: 1 });
    expect(S().completions).toEqual([]);
    expect(stored().completions).toEqual([]);
    const j = storedJournal();
    expect(j.suppression).toMatchObject({ epoch: 1, resetAt: T_RESET.toISOString() });
    expect(j.entries[0]).toMatchObject({
      key: e.entry.key,
      commitId: e.entry.commitId,
      state: "suppressed",
    });
    expect(j.entries[0].observation?.receipt.receiptVersion).toBe(1);
    expect(readJournal(S().cloudJournal)).toEqual(j);
  });

  it("waits for the shared lock and resolves with the result", async () => {
    await enqueue();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const queue = queueLock();
    let first = true;
    setArticlesLock((fn) =>
      queue(async () => {
        if (first) {
          first = false;
          await held;
        }
        return fn();
      }),
    );
    S().completeQuest("smart-bins-keywords", "train");
    let done = false;
    const p = S()
      .reset(T_RESET)
      .then((r) => ((done = true), r));
    await Promise.resolve();
    expect(done).toBe(false);
    expect(S().completions).toHaveLength(1);
    release();
    expect(await p).toEqual({ ok: true, retained: 1 });
    expect(S().completions).toEqual([]);
  });

  it("a failed reset (quota, unreadable journal, lock error) changes nothing", async () => {
    await enqueue();
    S().completeQuest("smart-bins-keywords", "train");
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    const before = localStorage.getItem(STORAGE_KEY);
    const progress = progressSnapshot();
    const q = quota();
    expect(await S().reset(T_RESET)).toEqual({ ok: false, reason: "not-persisted" });
    q.mockRestore();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(progressSnapshot()).toEqual(progress);
    setArticlesLock(() => Promise.reject(new Error("lock lost")));
    expect(await S().reset(T_RESET)).toEqual({ ok: false, reason: "not-persisted" });
    setArticlesLock(queueLock());
    otherTab((s) => (s.cloudJournal.entries[0].bearer = CANARY));
    const broken = localStorage.getItem(STORAGE_KEY);
    expect(await S().reset(T_RESET)).toEqual({ ok: false, reason: "journal-unreadable" });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(broken);
    expect(stored().completions).toHaveLength(1);
  });
});

describe("restore merges into the fresh durable journal", () => {
  it("round-trips entries and observations through a backup onto a cleared device, revalidated", async () => {
    const e = await enqueue();
    await S().observeCloudReceipt(await statusParsed(await doneReceipt(bodyOf())), statusReq());
    const json = S().exportState();
    localStorage.clear();
    await S().reset(T_BASE);
    expect(await S().importState(json)).toEqual({ ok: true, rejected: [] });
    const l = await load();
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]).toMatchObject({
      key: e.entry.key,
      commitId: e.entry.commitId,
      origin: ORIGIN,
      observed: { state: "done", receiptVersion: 3 },
    });
  });

  it("a legacy backup without the slice keeps the device journal", async () => {
    await enqueue();
    const j = storedJournal();
    const file = JSON.parse(S().exportState());
    delete file.state.cloudJournal;
    expect(await S().importState(JSON.stringify(file))).toEqual({ ok: true, rejected: [] });
    expect(storedJournal()).toEqual(j);
  });

  it("reset, reload, then an old backup: the entry stays and stays suppressed; the marker never goes back", async () => {
    const e = await enqueue();
    const old = S().exportState();
    expect(await S().reset(T_RESET)).toEqual({ ok: true, retained: 1 });
    const after = storedJournal();
    vi.resetModules();
    const fresh = await import("./index");
    await fresh.hydrateStore();
    fresh.setArticlesLock(queueLock());
    expect(await fresh.useStore.getState().importState(old)).toEqual({ ok: true, rejected: [] });
    const j = storedJournal();
    expect(j.suppression).toEqual(after.suppression);
    expect(j.entries).toEqual([{ ...e.entry, state: "suppressed" }]);
  });

  it("equal reset counters with different instants keep the later resetAt, in both orders", async () => {
    // A fresh device (empty reset clears memory too), then a save, so the next reset writes the journal under the lock.
    localStorage.clear();
    await S().reset(T_BASE);
    S().completeQuest("smart-bins-keywords", "train");
    await S().reset(T_LATER);
    const later = S().exportState();
    // A fresh device (empty reset clears memory too), then a save, so the next reset writes the journal under the lock.
    localStorage.clear();
    await S().reset(T_BASE);
    S().completeQuest("smart-bins-keywords", "train");
    await S().reset(T_RESET);
    const earlier = S().exportState();
    expect(JSON.parse(later).state.cloudJournal.suppression.epoch).toBe(
      JSON.parse(earlier).state.cloudJournal.suppression.epoch,
    );
    // Device at the earlier instant imports the later backup.
    expect((await S().importState(later)).ok).toBe(true);
    expect(storedJournal().suppression).toMatchObject({ epoch: 1, resetAt: T_LATER.toISOString() });
    // Device at the later instant imports the earlier backup.
    // A fresh device (empty reset clears memory too), then a save, so the next reset writes the journal under the lock.
    localStorage.clear();
    await S().reset(T_BASE);
    S().completeQuest("smart-bins-keywords", "train");
    await S().reset(T_LATER);
    expect((await S().importState(earlier)).ok).toBe(true);
    expect(storedJournal().suppression).toMatchObject({ epoch: 1, resetAt: T_LATER.toISOString() });
  });

  it("refuses a contradictory, forged or malformed journal, changing nothing", async () => {
    await enqueue();
    S().completeQuest("smart-bins-keywords", "train");
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    const before = localStorage.getItem(STORAGE_KEY);
    const conflicting = await candidateEntry(ORIGIN, bodyOf({ name: "Other" }));
    if (!conflicting.ok) throw new Error("setup");
    const file = JSON.parse(S().exportState());
    file.state.completions = [];
    file.state.cloudJournal = withEntry(
      readJournal(undefined)!,
      { ...conflicting.entry, commitId: "x", state: "queued", observation: null },
      "x",
    );
    expect(await S().importState(JSON.stringify(file))).toEqual({
      ok: false,
      reason: "journal-conflict",
      keys: [conflicting.entry.key],
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);

    await S().observeCloudReceipt(await statusParsed(await pendingReceipt(bodyOf())), statusReq());
    const withObs = JSON.parse(S().exportState());
    withObs.state.cloudJournal.entries[0].observation.receipt.state = "running";
    expect(await S().importState(JSON.stringify(withObs))).toEqual({
      ok: false,
      reason: "journal-invalid",
    });
    const flagged = JSON.parse(S().exportState());
    flagged.state.cloudJournal.entries[0].observation.verified = true;
    expect(() => S().importState(JSON.stringify(flagged))).toThrow();
    expect(stored().completions).toHaveLength(1);
  });

  it("a reset during the held revalidation is kept by the merge", async () => {
    await enqueue();
    const json = S().exportState();
    const h = holdDigests();
    const p = S().importState(json);
    await h.first;
    h.release();
    vi.restoreAllMocks();
    await S().reset(T_RESET);
    expect((await p).ok).toBe(true);
    const j = storedJournal();
    expect(j.suppression.epoch).toBe(1);
    expect(j.entries[0].state).toBe("suppressed");
  });
});

describe("capacity 600 without eviction", () => {
  it("updates an existing entry at the cap, refuses entry 601 and an overflowing restore before writing", async () => {
    const full = await journalOf(JOURNAL_CAPACITY);
    otherTab((s) => (s.cloudJournal = full));
    await useStore.persist.rehydrate();
    const m5 = bodyOf({ id: "m5" });
    expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m600" }))).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(await S().enqueueCloudOccurrence(ORIGIN, m5)).toMatchObject({
      ok: true,
      created: false,
    });
    expect(
      await S().observeCloudReceipt(await statusParsed(await pendingReceipt(m5)), statusReq("m5")),
    ).toEqual({ ok: true, changed: true });
    expect(storedJournal().entries).toHaveLength(JOURNAL_CAPACITY);
    const before = localStorage.getItem(STORAGE_KEY);
    const file = JSON.parse(S().exportState());
    file.state.cloudJournal = await journalOf(1, "x");
    expect(await S().importState(JSON.stringify(file))).toEqual({
      ok: false,
      reason: "journal-capacity",
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe("privacy and local behaviour", () => {
  it("no setting, key or private canary reaches the journal or its export", async () => {
    S().setSettings({ apiKeys: { youtube: CANARY } } as never);
    await enqueue();
    await S().observeCloudReceipt(await statusParsed(await doneReceipt(bodyOf())), statusReq());
    expect(JSON.stringify(stored().cloudJournal)).not.toContain(CANARY);
    expect(JSON.stringify(JSON.parse(S().exportState()).state.cloudJournal)).not.toContain(CANARY);
  });

  it("a local manual workflow still runs locally and leaves the journal untouched", async () => {
    await enqueue();
    const j = storedJournal();
    const w = await S().addWorkflow(
      {
        name: { ar: "", en: "Local" },
        actions: [{ id: "i1", kind: "idea", text: { ar: "فكرة", en: "Idea" } }],
      },
      new Date(AT),
    );
    if (!w.ok) throw new Error(w.reason);
    const r = await S().runWorkflowNow(w.workflow.id, {}, new Date(AT));
    expect(r.ok).toBe(true);
    expect(S().workflowRuns).toHaveLength(1);
    expect(storedJournal()).toEqual(j);
  });
});

describe("planner ruling: ordinary saves are monotonic for the journal; no Web Locks = no journal write", () => {
  it("tab A's ordinary save of unrelated state keeps tab B's newer journal byte for byte", async () => {
    const first = await enqueue(); // A's memory now holds this older journal
    const older = storedJournal();
    const m2 = await candidateEntry(ORIGIN, bodyOf({ id: "m2" }));
    const done = await observationOf(await statusParsed(await doneReceipt(bodyOf())), statusReq());
    if (!m2.ok || !done.ok) throw new Error("setup");
    // Tab B commits a newer journal (a second entry, a newer receipt, a reset); A hears nothing.
    const newer = resetJournal(
      withObservation(
        withEntry(
          older,
          { ...m2.entry, commitId: "tab-b", state: "queued", observation: null },
          "tab-b",
        ),
        first.entry.key,
        done.observation,
        "tab-b-obs",
      ),
      T_RESET,
      "tab-b-reset",
    );
    otherTab((s) => (s.cloudJournal = newer));
    const bBytes = JSON.stringify(stored().cloudJournal);
    expect(readJournal(S().cloudJournal)).toEqual(older);
    S().setSettings({ reminderTime: "07:10" });
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    expect(JSON.stringify(stored().cloudJournal)).toBe(bBytes);
    expect(stored().settings.reminderTime).toBe("07:10");
    const l = await load();
    expect(l.suppression).toEqual(newer.suppression);
    expect(l.entries.map((e) => [e.occurrenceId, e.commitId, e.state, e.observed])).toEqual([
      ["m1", first.entry.commitId, "suppressed", { state: "done", receiptVersion: 3 }],
      ["m2", "tab-b", "suppressed", null],
    ]);
  });

  it("an unreadable stored journal is never replaced by an ordinary save from a tab holding a readable one", async () => {
    await enqueue();
    otherTab((s) => (s.cloudJournal = { v: 1, broken: true }));
    S().setSettings({ reminderTime: "07:20" });
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    expect(stored().cloudJournal).toEqual({ v: 1, broken: true });
    expect(stored().settings.reminderTime).toBe("07:20");
  });

  it("without Web Locks a reset or restore that would write the journal refuses with no write; others still work", async () => {
    await enqueue();
    S().completeQuest("smart-bins-keywords", "train");
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    const json = S().exportState();
    setArticlesLock(null);
    const before = localStorage.getItem(STORAGE_KEY);
    expect(await S().reset(T_RESET)).toEqual({ ok: false, reason: "unsupported-save" });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(S().completions).toHaveLength(1);
    expect(await S().importState(json)).toEqual({ ok: false, reason: "unsupported-save" });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    // A backup without the journal does not touch it: the earlier restore still runs, journal byte for byte kept.
    const journalBytes = JSON.stringify(stored().cloudJournal);
    const legacy = JSON.parse(json);
    delete legacy.state.cloudJournal;
    legacy.state.completions = [];
    expect(await S().importState(JSON.stringify(legacy))).toEqual({ ok: true, rejected: [] });
    expect(stored().completions).toEqual([]);
    expect(JSON.stringify(stored().cloudJournal)).toBe(journalBytes);
  });

  it("without Web Locks and with no journal entries, a reset clears content and writes no journal", async () => {
    S().completeQuest("smart-bins-keywords", "train");
    expect(stored().cloudJournal).toBeUndefined();
    setArticlesLock(null);
    expect(await S().reset(T_RESET)).toEqual({ ok: true, retained: 0 });
    expect(stored().completions).toEqual([]);
    expect(stored().cloudJournal).toBeUndefined();
  });
});

// DT-7C-2A-R1 (planning/collaboration/dashboard-remaining-tools-handoff.md): every writer of the store key holds the
// shared lock. Two tabs are modelled by two real store module instances over one jsdom storage and ONE serializing lock
// (the queueLock stand-in for Web Locks); B's journal commits are real locked `enqueueCloudOccurrence` calls with their
// own read-back. This shows the serialization discipline of the store's code, not that a browser's synchronous
// localStorage is atomic across agents (it is not; the browser check uses real Web Locks).
describe("DT-7C-2A-R1: ordinary saves are serialized with journal commits", () => {
  type Store = typeof import("./index");
  /** A second tab: a fresh store module over the same storage, sharing `lock`. */
  async function tabB(lock: ArticlesLock): Promise<Store> {
    vi.resetModules();
    const b = await import("./index");
    await b.hydrateStore();
    b.setArticlesLock(lock);
    return b;
  }
  /** A lock holder that keeps the lock until released (another tab busy inside it). */
  function hold(lock: ArticlesLock, inside: () => void = () => {}) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const done = lock(async () => {
      inside();
      await gate;
    });
    return { release, done };
  }
  /** `lock` with a count of the requests made through it (so a test knows a commit is already waiting). */
  function counted(lock: ArticlesLock) {
    const c: { requests: number; lock: ArticlesLock } = {
      requests: 0,
      lock: (fn) => (c.requests++, lock(fn)),
    };
    return c;
  }
  const reminder = () => stored().settings.reminderTime;

  it("an ordinary save never reads or writes outside the lock; queued behind a real locked commit it keeps that commit", async () => {
    await enqueue();
    const lock = queueLock();
    setArticlesLock(lock);
    const B = await tabB(lock);
    const h = hold(lock);
    // A (older memory: one entry) asks for a save while another holder has the lock: nothing touches storage yet.
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    S().setSettings({ reminderTime: "07:31" });
    expect(get.mock.calls.filter(([k]) => k === STORAGE_KEY)).toHaveLength(0);
    expect(set.mock.calls.filter(([k]) => k === STORAGE_KEY)).toHaveLength(0);
    expect(S().settings.reminderTime).toBe("07:31"); // memory (UI) changes at once
    // B's real locked journal commit asks after A's save, so it runs after it (and rehydrates it).
    const b = B.useStore.getState().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "b1" }));
    h.release();
    await h.done;
    expect(await b).toMatchObject({ ok: true, created: true });
    await savesSettled();
    await B.savesSettled();
    expect(storedJournal().entries.map((e) => e.occurrenceId)).toEqual(["b1", "m1"]);
    expect(reminder()).toBe("07:31"); // B's commit rehydrated A's save first
    expect((await load()).generation).toBe(2);
  });

  it("a real locked commit first, then the stale ordinary save: the proven journal stays byte for byte", async () => {
    await enqueue();
    const lock = queueLock();
    setArticlesLock(lock);
    const viaB = counted(lock);
    const B = await tabB(viaB.lock);
    const h = hold(lock);
    const b = B.useStore.getState().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "b1" }));
    await vi.waitFor(() => expect(viaB.requests).toBe(1)); // B's commit is waiting for the lock first
    S().setSettings({ reminderTime: "07:32" }); // A never heard of b1
    expect(readJournal(S().cloudJournal)!.entries).toHaveLength(1);
    h.release();
    expect(await b).toMatchObject({ ok: true, created: true });
    const proven = JSON.stringify(stored().cloudJournal);
    await savesSettled();
    expect(JSON.stringify(stored().cloudJournal)).toBe(proven);
    expect(storedJournal().entries.map((e) => e.occurrenceId)).toEqual(["b1", "m1"]);
    expect(reminder()).toBe("07:32");
  });

  it("several queued ordinary saves are one write of the latest memory", async () => {
    await enqueue();
    const lock = queueLock();
    setArticlesLock(lock);
    const h = hold(lock);
    const set = vi.spyOn(Storage.prototype, "setItem");
    S().setSettings({ reminderTime: "07:33" });
    S().setSettings({ reminderTime: "07:34" });
    S().completeQuest("smart-bins-keywords", "train");
    h.release();
    await savesSettled();
    expect(set.mock.calls.filter(([k]) => k === STORAGE_KEY)).toHaveLength(1);
    expect(reminder()).toBe("07:34");
    expect(stored().completions).toHaveLength(1);
  });

  it("a save asked for inside a locked callback runs after the hold, without deadlock", async () => {
    await enqueue();
    const lock = queueLock();
    setArticlesLock(lock);
    let pending: Promise<unknown> | undefined;
    const h = hold(lock, () => {
      S().setSettings({ reminderTime: "07:35" });
      pending = S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m2" })); // a journal commit, too
    });
    await Promise.resolve();
    expect(reminder()).not.toBe("07:35");
    h.release();
    await h.done;
    expect(await pending).toMatchObject({ ok: true, created: true });
    await savesSettled();
    expect(reminder()).toBe("07:35");
    expect(storedJournal().entries).toHaveLength(2);
  });

  it("a pending save is written first when this tab's own locked commit is granted (never dropped by its rehydrate)", async () => {
    await enqueue();
    const lock = queueLock();
    const viaA = counted(lock);
    setArticlesLock(viaA.lock);
    const h = hold(lock);
    const commit = S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m2" }));
    await vi.waitFor(() => expect(viaA.requests).toBe(1));
    S().setSettings({ reminderTime: "07:36" }); // asked after the commit's lock request
    h.release();
    expect(await commit).toMatchObject({ ok: true });
    expect(reminder()).toBe("07:36");
    expect(S().settings.reminderTime).toBe("07:36");
  });

  it("without Web Locks an ordinary save writes at once but still never writes this tab's journal", async () => {
    await enqueue();
    const newer = { ...storedJournal(), generation: 9, commitId: "tab-b" };
    otherTab((s) => (s.cloudJournal = newer));
    setArticlesLock(null);
    S().setSettings({ reminderTime: "07:37" });
    expect(reminder()).toBe("07:37");
    expect(stored().cloudJournal).toEqual(newer);
  });
});

describe("DT-7C-2A-R1: unreadable is not absent", () => {
  const reminder = () => stored().settings.reminderTime;

  it("a transient read failure refuses the save (status says so) and keeps a valid newer journal", async () => {
    await enqueue();
    const newer = { ...storedJournal(), generation: 7, commitId: "tab-b" };
    otherTab((s) => (s.cloudJournal = newer));
    const before = localStorage.getItem(STORAGE_KEY);
    const real = Storage.prototype.getItem;
    let failed = false;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k) {
      if (k === STORAGE_KEY && !failed) {
        failed = true;
        throw new DOMException("transient denied", "SecurityError");
      }
      return real.call(this, k);
    });
    S().setSettings({ reminderTime: "07:41" });
    await savesSettled();
    expect(failed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(saveStatus.getState()).toEqual({ failed: "unreadable" });
    expect(S().settings.reminderTime).toBe("07:41"); // memory keeps the change
    // The next save, once storage reads again, succeeds with the stored journal.
    S().setSettings({ reminderTime: "07:42" });
    await savesSettled();
    expect(saveStatus.getState()).toEqual({});
    expect(reminder()).toBe("07:42");
    expect(stored().cloudJournal).toEqual(newer);
  });

  it("malformed whole JSON and invalid outer shapes are preserved byte for byte by every durable operation", async () => {
    await enqueue();
    const json = S().exportState();
    const legacy = JSON.parse(json);
    delete legacy.state.cloudJournal;
    for (const raw of [
      "{BROKEN_UNREADABLE_SAVE",
      "null",
      "[]",
      '"text"',
      '{"state":null}',
      '{"state":[]}',
      '{"wrong":"envelope"}',
    ]) {
      localStorage.setItem(STORAGE_KEY, raw);
      S().setSettings({ reminderTime: "07:43" });
      await savesSettled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
      expect(saveStatus.getState()).toEqual({ failed: "unreadable" });
      expect(await loadCloudJournal()).toEqual({ ok: false, reason: "journal-unreadable" });
      expect(await S().enqueueCloudOccurrence(ORIGIN, bodyOf({ id: "m9" }))).toEqual({
        ok: false,
        reason: "journal-unreadable",
      });
      expect(await S().reset(T_RESET)).toMatchObject({ ok: false });
      expect(await S().importState(JSON.stringify(legacy))).toEqual({
        ok: false,
        reason: "not-persisted",
      });
      expect(await S().importState(json)).toMatchObject({ ok: false });
      expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    }
  });

  it("a malformed nested journal is kept byte for byte by an ordinary save and refused by journal actions", async () => {
    await enqueue();
    otherTab((s) => (s.cloudJournal = { v: 1, broken: "KEEP-THESE-BYTES" }));
    S().setSettings({ reminderTime: "07:44" });
    await savesSettled();
    expect(localStorage.getItem(STORAGE_KEY)).toContain(
      '"cloudJournal":{"v":1,"broken":"KEEP-THESE-BYTES"}',
    );
    expect(reminder()).toBe("07:44");
    expect(saveStatus.getState()).toEqual({});
    expect(await loadCloudJournal()).toEqual({ ok: false, reason: "journal-unreadable" });
    expect(await S().reset(T_RESET)).toEqual({ ok: false, reason: "journal-unreadable" });
  });

  it("journal bytes an ordinary save could not write back verbatim are refused, not rewritten", async () => {
    await enqueue();
    const raw = localStorage.getItem(STORAGE_KEY)!.replace('"cloudJournal":{', '"cloudJournal": {');
    localStorage.setItem(STORAGE_KEY, raw);
    S().setSettings({ reminderTime: "07:45" });
    await savesSettled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(saveStatus.getState()).toEqual({ failed: "unreadable" });
  });

  it("a valid legacy envelope (no journal) and no save at all still work as before", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: { reminderTime: "08:55" } }, version: 1 }),
    );
    expect(await load()).toMatchObject({ ok: true, generation: 0, entries: [] });
    S().setSettings({ reminderTime: "07:46" });
    await savesSettled();
    expect(reminder()).toBe("07:46");
    expect(stored().cloudJournal).toBeUndefined();
    expect(saveStatus.getState()).toEqual({});
    localStorage.removeItem(STORAGE_KEY);
    expect(await load()).toMatchObject({ ok: true, entries: [] });
  });
});

describe("DT-7C-2A-R1: a failed restore preserves fresh ordinary state", () => {
  /** Another tab's newer durable save: reminder 08:55 and one more journal entry (a real locked commit). */
  async function newerElsewhere() {
    const mine = localStorage.getItem(STORAGE_KEY)!;
    await enqueue(bodyOf({ id: "other" }));
    otherTab((s) => (s.settings.reminderTime = "08:55"));
    const theirs = localStorage.getItem(STORAGE_KEY)!;
    // Back to this tab's older view in memory only (its storage event not delivered).
    localStorage.setItem(STORAGE_KEY, mine);
    await useStore.persist.rehydrate();
    localStorage.setItem(STORAGE_KEY, theirs);
    expect(S().settings.reminderTime).toBe("20:00");
    return theirs;
  }
  const dropFirstWrite = () => {
    const real = Storage.prototype.setItem;
    let dropped = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && !dropped) {
        dropped = true;
        return;
      }
      real.call(this, k, v);
    });
    return () => dropped;
  };

  for (const kind of ["legacy", "journal-bearing"] as const) {
    it(`a dropped ${kind} restore write returns not-persisted and leaves another tab's newer save intact`, async () => {
      await enqueue();
      const backup = JSON.parse(S().exportState());
      if (kind === "legacy") delete backup.state.cloudJournal;
      backup.state.settings.reminderTime = "09:00";
      const theirs = await newerElsewhere();
      const dropped = dropFirstWrite();
      expect(await S().importState(JSON.stringify(backup))).toEqual({
        ok: false,
        reason: "not-persisted",
      });
      expect(dropped()).toBe(true);
      await savesSettled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(theirs);
      expect(S().settings.reminderTime).toBe("08:55"); // memory reconciled to the newer durable truth
    });

    it(`a successful ${kind} restore applies the backup and keeps the newer journal`, async () => {
      await enqueue();
      const backup = JSON.parse(S().exportState());
      if (kind === "legacy") delete backup.state.cloudJournal;
      backup.state.settings.reminderTime = "09:00";
      await newerElsewhere();
      expect(await S().importState(JSON.stringify(backup))).toEqual({ ok: true, rejected: [] });
      expect(stored().settings.reminderTime).toBe("09:00");
      expect(storedJournal().entries.map((e) => e.occurrenceId)).toEqual(["m1", "other"]);
    });
  }

  it("a restore whose write landed but failed its read-back writes the durable pre-restore state back", async () => {
    await enqueue();
    const backup = JSON.parse(S().exportState());
    backup.state.settings.reminderTime = "09:00";
    const theirs = await newerElsewhere();
    const real = Storage.prototype.setItem;
    let tampered = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && !tampered) {
        tampered = true;
        const raw = JSON.parse(v);
        delete raw.state.cloudJournal; // the epoch lands, the journal read-back fails
        return real.call(this, k, JSON.stringify(raw));
      }
      real.call(this, k, v);
    });
    expect(await S().importState(JSON.stringify(backup))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(tampered).toBe(true);
    expect(stored().settings.reminderTime).toBe("08:55");
    expect(JSON.stringify(stored().cloudJournal)).toBe(
      JSON.stringify(JSON.parse(theirs).state.cloudJournal),
    );
  });

  it("reset: success and a landed-then-unproven write both keep the durable truth", async () => {
    await enqueue();
    const theirs = await newerElsewhere();
    const real = Storage.prototype.setItem;
    let tampered = false;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY && !tampered) {
        tampered = true;
        const raw = JSON.parse(v);
        delete raw.state.cloudJournal;
        return real.call(this, k, JSON.stringify(raw));
      }
      real.call(this, k, v);
    });
    expect(await S().reset(T_RESET)).toEqual({ ok: false, reason: "not-persisted" });
    expect(tampered).toBe(true);
    expect(stored().settings.reminderTime).toBe("08:55");
    expect(JSON.stringify(stored().cloudJournal)).toBe(
      JSON.stringify(JSON.parse(theirs).state.cloudJournal),
    );
    spy.mockRestore();
    expect(await S().reset(T_RESET)).toEqual({ ok: true, retained: 2 });
    expect(storedJournal().suppression.epoch).toBe(1);
  });
});

// DT-7C-2A-R2 (planning/collaboration/dashboard-remaining-tools-handoff.md, finding 7C2A-R1-A): a queued ordinary save
// applies only this tab's own changes onto the fresh durable state (three-way merge against the state this tab last
// knew), so another tab's successful locked commits, retained Inbox handles, deletions and resets are never undone.
// Two tabs = two real store module instances over one jsdom storage and ONE serializing lock (the queueLock stand-in for
// Web Locks); B's actions are the real locked transactions with their own read-back. No network.
describe("DT-7C-2A-R2: a queued ordinary save keeps other tabs' locked commits", () => {
  type Store = typeof import("./index");
  const tabs: Store[] = [];
  /** A second tab: a fresh store module over the same storage, sharing `lock`. */
  async function tabB(lock: ArticlesLock): Promise<Store> {
    vi.resetModules();
    const b = await import("./index");
    await b.hydrateStore();
    b.setArticlesLock(lock);
    tabs.push(b);
    return b;
  }
  /** A lock holder that keeps the lock until released (another tab busy inside it). */
  function hold(lock: ArticlesLock) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const done = lock(() => gate);
    return { release, done };
  }
  /** `lock` with a count of the requests made through it (so a test knows a commit is already waiting). */
  function counted(lock: ArticlesLock) {
    const c: { requests: number; lock: ArticlesLock } = {
      requests: 0,
      lock: (fn) => (c.requests++, lock(fn)),
    };
    return c;
  }
  /** One shared lock; B's requests are counted. */
  async function twoTabs() {
    const lock = queueLock();
    setArticlesLock(lock);
    const viaB = counted(lock);
    const B = await tabB(viaB.lock);
    return { lock, viaB, b: () => B.useStore.getState() };
  }
  const net = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", net));
  afterEach(async () => {
    for (const t of tabs.splice(0)) {
      await t.savesSettled();
      t.setArticlesLock(undefined);
    }
    await savesSettled();
    expect(net).not.toHaveBeenCalled(); // no request of any kind
    vi.unstubAllGlobals();
    net.mockReset();
  });
  const reminder = () => stored().settings.reminderTime;
  const SCOPE = "v2|youtube|https%3A%2F%2Fscout.example|UC-r2|comment|Ug-r2";
  const handle = (receiptVersion: number) => ({
    operationId: "r2-unknown-01",
    account: "UC-r2",
    draftRevision: "draft-one",
    digest: "c".repeat(64),
    state: "unknown" as const,
    receiptVersion,
  });
  const readyPost = (title: string) => {
    const p = S().addPost({ platform: "instagram", title });
    S().updatePost(p.id, { autoPost: { platforms: ["instagram"] } });
    return p.id;
  };
  const storedPost = (id: string) => stored().posts.find((p: A) => p.id === id);
  const LOCKED = [
    "articles",
    "workflows",
    "workflowRuns",
    "businessKit",
    "brandDeals",
    "inboxDrafts",
    "inboxSendOps",
    "inboxThreadsSendOps",
    "inboxInstagramSendOps",
    "inboxInstagramDmSendOps",
    "inboxInstagramDmControls",
    "cloudJournal",
  ];

  it("articles (locked): B's article commits first, then A's stale Settings save: B's read-back holds and both survive", async () => {
    await enqueue();
    const { lock, viaB, b } = await twoTabs();
    const h = hold(lock);
    const created = b().addArticle({ title: { ar: "", en: "B durable article" } });
    await vi.waitFor(() => expect(viaB.requests).toBe(1)); // B's commit waits first
    const afterB = lock(async () => stored()); // storage after B's commit, before A's save
    S().setSettings({ reminderTime: "07:58" }); // A never heard of the article
    h.release();
    const r = await created;
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect((await afterB).articles.map((a: A) => [a.id, a.commitId])).toEqual([
      [r.article.id, r.article.commitId],
    ]); // B's durable read-back
    await savesSettled();
    expect(stored().articles.map((a: A) => [a.id, a.commitId])).toEqual([
      [r.article.id, r.article.commitId],
    ]);
    expect(reminder()).toBe("07:58");
    expect(storedJournal().entries).toHaveLength(1);
    expect(S().articles.map((a) => a.id)).toEqual([r.article.id]); // A's memory follows
    expect(S().settings.reminderTime).toBe("07:58");
  });

  it("articles (locked), reverse order: A's Settings save first, then B's article: both survive", async () => {
    const { lock, b } = await twoTabs();
    const h = hold(lock);
    S().setSettings({ reminderTime: "07:59" });
    const created = b().addArticle({ title: { ar: "", en: "B after A" } });
    h.release();
    const r = await created;
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    await savesSettled();
    expect(stored().articles.map((a: A) => a.id)).toEqual([r.article.id]);
    expect(reminder()).toBe("07:59");
  });

  it("inboxSendOps (locked): B's unresolved unknown handle survives A's queued save", async () => {
    const { lock, viaB, b } = await twoTabs();
    const h = hold(lock);
    const saved = b().setInboxSendOp(SCOPE, handle(1), null);
    await vi.waitFor(() => expect(viaB.requests).toBe(1));
    const afterB = lock(async () => stored()); // storage after B's commit, before A's save
    S().setSettings({ reminderTime: "08:01" });
    h.release();
    const r = await saved;
    expect(r).toMatchObject({ ok: true, op: handle(1) });
    if (!r.ok) return;
    expect((await afterB).inboxSendOps[SCOPE]).toEqual(r.op); // B's durable read-back
    await savesSettled();
    expect(stored().inboxSendOps[SCOPE]).toEqual(r.op);
    expect(reminder()).toBe("08:01");
    expect(S().inboxSendOps[SCOPE]).toEqual(r.op);
  });

  it("inboxSendOps (locked): a monotonic receipt update is never regressed by A's memory of the older version", async () => {
    const { lock, viaB, b } = await twoTabs();
    expect(await b().setInboxSendOp(SCOPE, handle(1), null)).toMatchObject({ ok: true });
    await useStore.persist.rehydrate(); // A heard of version 1 (a storage event)
    expect(S().inboxSendOps[SCOPE]?.receiptVersion).toBe(1);
    const h = hold(lock);
    const newer = b().setInboxSendOp(SCOPE, handle(4), handle(1).operationId);
    await vi.waitFor(() => expect(viaB.requests).toBe(2));
    S().setSettings({ reminderTime: "08:02" }); // A's memory still holds version 1
    h.release();
    const r = await newer;
    expect(r).toMatchObject({ ok: true, op: { state: "unknown", receiptVersion: 4 } });
    if (!r.ok) return;
    await savesSettled();
    expect(stored().inboxSendOps[SCOPE]).toEqual(r.op);
    expect(reminder()).toBe("08:02");
  });

  it("inboxSendOps (locked deletion): B's removal of a handle is not resurrected by A's memory", async () => {
    const { lock, viaB, b } = await twoTabs();
    expect(await b().setInboxSendOp(SCOPE, handle(1), null)).toMatchObject({ ok: true });
    await useStore.persist.rehydrate();
    expect(S().inboxSendOps[SCOPE]).toBeDefined();
    const h = hold(lock);
    const cleared = b().clearInboxSendOp(SCOPE, handle(1).operationId);
    await vi.waitFor(() => expect(viaB.requests).toBe(2));
    S().setSettings({ reminderTime: "08:03" });
    h.release();
    expect(await cleared).toEqual({ ok: true, op: null });
    await savesSettled();
    expect(stored().inboxSendOps).toEqual({});
    expect(reminder()).toBe("08:03");
    expect(S().inboxSendOps).toEqual({});
  });

  it("several queued ordinary edits coalesce into one write that keeps B's article and handle", async () => {
    const { lock, viaB, b } = await twoTabs();
    const h = hold(lock);
    const art = b().addArticle({ title: { ar: "", en: "B article" } });
    const op = b().setInboxSendOp(SCOPE, handle(2), null);
    await vi.waitFor(() => expect(viaB.requests).toBe(2));
    const set = vi.spyOn(Storage.prototype, "setItem");
    S().setSettings({ reminderTime: "08:04" });
    S().setSettings({ reminderTime: "08:05" });
    S().completeQuest("smart-bins-keywords", "train");
    const idea = S().addIdea({ text: "A idea", source: "me" });
    h.release();
    const [ra, ro] = await Promise.all([art, op]);
    expect(ra).toMatchObject({ ok: true });
    expect(ro).toMatchObject({ ok: true });
    if (!ra.ok || !ro.ok) return;
    await savesSettled();
    // B's two commits and A's ONE coalesced save.
    expect(set.mock.calls.filter(([k]) => k === STORAGE_KEY)).toHaveLength(3);
    expect(reminder()).toBe("08:05");
    expect(stored().completions).toHaveLength(1);
    expect(stored().ideas.map((i: A) => i.id)).toEqual([idea.id]);
    expect(stored().articles.map((a: A) => a.id)).toEqual([ra.article.id]);
    expect(stored().inboxSendOps[SCOPE]).toEqual(ro.op);
  });

  it("posts (mixed): B's locked job id and A's queued ordinary edit of the same post both survive", async () => {
    const id = readyPost("Shared");
    await savesSettled();
    const { lock, viaB, b } = await twoTabs();
    const h = hold(lock);
    const alloc = b().allocatePublishJobId(id, "job-b");
    await vi.waitFor(() => expect(viaB.requests).toBe(1));
    const afterB = lock(async () => stored()); // storage after B's commit, before A's save
    S().updatePost(id, { title: "A's edit" }); // A's memory has no job id
    h.release();
    expect(await alloc).toMatchObject({ ok: true });
    expect((await afterB).posts.find((p: A) => p.id === id).autoPost.jobId).toBe("job-b"); // B's read-back
    await savesSettled();
    expect(storedPost(id)).toMatchObject({
      title: "A's edit",
      autoPost: { platforms: ["instagram"], jobId: "job-b" },
    });
    expect(S().posts.find((p) => p.id === id)?.autoPost?.jobId).toBe("job-b");
  });

  it("same tab: a pending ordinary edit, then its own locked job-id commit: nothing obsolete is replayed afterwards", async () => {
    const id = readyPost("Own");
    await savesSettled();
    const lock = queueLock();
    const viaA = counted(lock);
    setArticlesLock(viaA.lock);
    const h = hold(lock);
    S().updatePost(id, { title: "Pending edit" }); // queued ordinary save (request 1)
    const alloc = S().allocatePublishJobId(id, "job-own"); // queued after it (request 2)
    await vi.waitFor(() => expect(viaA.requests).toBe(2));
    h.release();
    expect(await alloc).toMatchObject({ ok: true });
    await savesSettled();
    expect(storedPost(id)).toMatchObject({ title: "Pending edit", autoPost: { jobId: "job-own" } });
    S().setSettings({ reminderTime: "08:06" }); // a later ordinary save diffs against the commit
    await savesSettled();
    expect(storedPost(id)).toMatchObject({ title: "Pending edit", autoPost: { jobId: "job-own" } });
    expect(reminder()).toBe("08:06");
  });

  it("B's reset: A's stale save resurrects nothing it removed and keeps the suppressed journal and new generation", async () => {
    await enqueue();
    const old = S().addIdea({ text: "Pre-reset idea", source: "me" });
    expect(await S().addArticle({ title: { ar: "", en: "Pre-reset" } })).toMatchObject({
      ok: true,
    });
    await savesSettled();
    const { lock, viaB, b } = await twoTabs();
    const h = hold(lock);
    const reset = b().reset(T_RESET);
    await vi.waitFor(() => expect(viaB.requests).toBe(1));
    const afterB = lock(async () => stored()); // storage after B's commit, before A's save
    S().setSettings({ reminderTime: "08:07" }); // A still remembers the idea and the article
    const added = S().addIdea({ text: "Added after", source: "me" });
    const afterA = lock(async () => stored()); // storage right after A's save
    h.release();
    expect(await reset).toEqual({ ok: true, retained: 1 });
    const durable = await afterB;
    const epoch = durable.discoverLibraryEpoch;
    expect(readJournal(durable.cloudJournal)!.entries.map((e) => e.state)).toEqual(["suppressed"]);
    expect(durable.articles).toEqual([]); // B's durable read-back
    // Right after A's save, and once every later save (B's library) has run too.
    for (const s of [await afterA, (await savesSettled(), stored())]) {
      expect(s.articles).toEqual([]);
      expect(s.ideas.map((i: A) => i.id)).toEqual([added.id]); // A's own later idea only
      expect(s.ideas.map((i: A) => i.id)).not.toContain(old.id);
      expect(s.discoverLibraryEpoch).toBe(epoch);
      expect(s.discoverLibraryPendingReplacement).toBe(true);
      expect(readJournal(s.cloudJournal)!.entries.map((e) => e.state)).toEqual(["suppressed"]);
      expect(s.settings.reminderTime).toBe("08:07");
    }
    expect(S().articles).toEqual([]);
  });

  it("every exclusively locked slice is written from storage verbatim, never from A's memory (raw-storage complement)", async () => {
    await enqueue();
    otherTab((s) => {
      for (const k of LOCKED) s[k] = { committedBy: "another tab", k };
    });
    const before = stored();
    S().setSettings({ reminderTime: "08:08" });
    await savesSettled();
    for (const k of LOCKED) expect([k, stored()[k]]).toEqual([k, before[k]]);
    expect(reminder()).toBe("08:08");
  });

  it("ideas/planItems (mixed) and settings (ordinary): another tab's additions and keys merge with A's own changes", async () => {
    const gone = S().addIdea({ text: "A removes this", source: "me" });
    await savesSettled();
    const at = "2026-10-17T09:00:00.000Z";
    otherTab((s) => {
      s.ideas.push({ id: "wf:x:a1", text: "Workflow idea", source: "workflow", createdAt: at });
      s.planItems.push({ id: "wf:x:a2", week: "2026-10-17", day: 0, title: "Workflow row" });
      s.settings.lang = "en";
    });
    S().removeIdea(gone.id);
    const mine = S().addIdea({ text: "A adds this", source: "me" });
    S().setSettings({ reminderTime: "08:09" });
    await savesSettled();
    expect(stored().ideas.map((i: A) => i.id)).toEqual(["wf:x:a1", mine.id]);
    expect(stored().planItems.map((p: A) => p.id)).toEqual(["wf:x:a2"]);
    expect(stored().settings).toMatchObject({ lang: "en", reminderTime: "08:09" });
  });

  it("a partial stored state (keys memory fills by default): A's change to such a key and another tab's change both survive", async () => {
    const state = { settings: { lang: "ar", apiKeys: {}, gear: ["phone"] } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state }));
    await useStore.persist.rehydrate();
    otherTab((s) => (s.settings.gear = ["phone", "lights"]));
    S().setSettings({ reminderTime: "08:10" }); // storage never held reminderTime
    await savesSettled();
    expect(stored().settings).toMatchObject({
      lang: "ar",
      reminderTime: "08:10",
      gear: ["phone", "lights"],
    });
  });

  describe("DT-7C-2A-C1: one coherent hydration base; merges by each list's logical identity", () => {
    const tabB = () => tabs[tabs.length - 1];
    const jobOf = (id: string) => S().posts.find((p) => p.id === id)?.autoPost?.jobId;
    /**
     * A's next rehydrate makes its one read of `seen`; right after that read `landing` is written, as another tab's
     * commit landing between A's hydration read and the end of its hydration (no storage event delivered yet). A
     * deterministic storage interleaving with real committed bytes, not a browser race.
     */
    async function rehydrateReading(seen: string, landing: string) {
      localStorage.setItem(STORAGE_KEY, seen);
      const realGet = Storage.prototype.getItem;
      const realSet = Storage.prototype.setItem;
      let reads = 0;
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
        this: Storage,
        k: string,
      ) {
        const got = realGet.call(this, k);
        if (k === STORAGE_KEY && reads++ === 0) realSet.call(this, k, landing);
        return got;
      });
      await useStore.persist.rehydrate();
      spy.mockRestore();
      expect(reads).toBeGreaterThan(0);
    }

    it("R2-A: B's real job-id commit landing between A's hydration read and its base survives A's title edit", async () => {
      const id = readyPost("Hydrated");
      await savesSettled();
      const { b } = await twoTabs();
      const old = localStorage.getItem(STORAGE_KEY)!;
      expect(await b().allocatePublishJobId(id, "job-during-hydrate")).toMatchObject({ ok: true }); // commit + read-back
      const newer = localStorage.getItem(STORAGE_KEY)!; // B's exact committed bytes
      await rehydrateReading(old, newer);
      expect(jobOf(id)).toBeUndefined(); // A hydrated the older bytes
      expect(storedPost(id).autoPost.jobId).toBe("job-during-hydrate");
      S().updatePost(id, { title: "A title" }); // before any storage notification
      await savesSettled();
      expect(storedPost(id)).toMatchObject({
        title: "A title",
        autoPost: { platforms: ["instagram"], jobId: "job-during-hydrate" },
      });
      expect(jobOf(id)).toBe("job-during-hydrate");
    });

    it("coherent bases: an old base, B's commit, then a coherent newer base all keep B's job", async () => {
      const id = readyPost("Coherent");
      await savesSettled();
      const { b } = await twoTabs();
      await useStore.persist.rehydrate(); // a coherent old base
      expect(await b().allocatePublishJobId(id, "job-coherent")).toMatchObject({ ok: true });
      S().updatePost(id, { title: "Before notification" });
      await savesSettled();
      expect(storedPost(id)).toMatchObject({
        title: "Before notification",
        autoPost: { jobId: "job-coherent" },
      });
      await useStore.persist.rehydrate(); // a coherent newer base (the storage event)
      expect(jobOf(id)).toBe("job-coherent");
      S().updatePost(id, { title: "After notification" });
      await savesSettled();
      expect(storedPost(id)).toMatchObject({
        title: "After notification",
        autoPost: { jobId: "job-coherent" },
      });
    });

    it("a hydration read the schema rejects records no base: B's job id landing meanwhile is kept", async () => {
      const id = readyPost("Malformed read");
      await savesSettled();
      const { b } = await twoTabs();
      expect(await b().allocatePublishJobId(id, "job-after-bad-read")).toMatchObject({ ok: true });
      const newer = localStorage.getItem(STORAGE_KEY)!;
      await rehydrateReading(JSON.stringify({ version: 1, state: { posts: "not a list" } }), newer);
      expect(jobOf(id)).toBeUndefined(); // memory left as it was
      S().updatePost(id, { title: "A title" });
      await savesSettled();
      expect(storedPost(id)).toMatchObject({
        title: "A title",
        autoPost: { jobId: "job-after-bad-read" },
      });
    });

    it("overlapping hydrations: only the newest observation becomes memory and base", async () => {
      const id = readyPost("Overlap");
      await savesSettled();
      const { b } = await twoTabs();
      const old = localStorage.getItem(STORAGE_KEY)!;
      expect(await b().allocatePublishJobId(id, "job-overlap")).toMatchObject({ ok: true });
      const newer = localStorage.getItem(STORAGE_KEY)!;
      localStorage.setItem(STORAGE_KEY, old);
      const realGet = Storage.prototype.getItem;
      const realSet = Storage.prototype.setItem;
      let inner: Promise<void> | void = undefined;
      let started = false;
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
        this: Storage,
        k: string,
      ) {
        const got = realGet.call(this, k);
        if (k === STORAGE_KEY && !started) {
          started = true;
          realSet.call(this, k, newer);
          inner = useStore.persist.rehydrate(); // a newer hydration starts inside the older one's read
        }
        return got;
      });
      await useStore.persist.rehydrate(); // this (older) read saw `old`
      await inner;
      spy.mockRestore();
      expect(started).toBe(true);
      expect(jobOf(id)).toBe("job-overlap");
      S().updatePost(id, { title: "A title" });
      await savesSettled();
      expect(storedPost(id)).toMatchObject({
        title: "A title",
        autoPost: { jobId: "job-overlap" },
      });
    });

    it("R2-B: both tabs set the same platform's account: one row (this tab's) survives and the first-match read shows it", async () => {
      S().setAccount("instagram", "before");
      await savesSettled();
      const { lock, b } = await twoTabs();
      const h = hold(lock);
      b().setAccount("instagram", "B-new");
      S().setAccount("instagram", "A-new");
      h.release();
      await h.done;
      await tabB().savesSettled();
      await savesSettled();
      const rows = stored().socialAccounts.filter((a: A) => a.platform === "instagram");
      expect(rows).toEqual([{ platform: "instagram", handle: "A-new" }]);
      expect(accountFor(stored() as never, "instagram")?.handle).toBe("A-new");
      expect(accountFor(S(), "instagram")?.handle).toBe("A-new");
    });

    it("distinct platforms set in both tabs both survive", async () => {
      const { lock, b } = await twoTabs();
      const h = hold(lock);
      b().setAccount("tiktok", "b-tt");
      S().setAccount("youtube", "a-yt");
      h.release();
      await h.done;
      await tabB().savesSettled();
      await savesSettled();
      expect(
        stored()
          .socialAccounts.map((a: A) => [a.platform, a.handle])
          .sort(),
      ).toEqual([
        ["tiktok", "b-tt"],
        ["youtube", "a-yt"],
      ]);
    });

    it("compound-key upserts keep one row per snapshot platform+day and per post-stat platform+postId", async () => {
      const AT_POST = "2026-10-01T10:00:00.000Z";
      S().addSnapshot({ platform: "instagram", day: "2026-10-01", followers: 10 });
      S().importPostStats([{ platform: "tiktok", postId: "p1", publishedAt: AT_POST, views: 1 }]);
      await savesSettled();
      const { lock, b } = await twoTabs();
      const h = hold(lock);
      b().addSnapshot({ platform: "instagram", day: "2026-10-01", followers: 20 });
      b().addSnapshot({ platform: "instagram", day: "2026-10-02", followers: 21 }); // independent row
      b().importPostStats([{ platform: "tiktok", postId: "p1", publishedAt: AT_POST, views: 2 }]);
      S().addSnapshot({ platform: "instagram", day: "2026-10-01", followers: 30 });
      S().importPostStats([
        { platform: "tiktok", postId: "p1", publishedAt: AT_POST, views: 3 },
        { platform: "tiktok", postId: "p2", publishedAt: AT_POST, views: 4 },
      ]);
      h.release();
      await h.done;
      await tabB().savesSettled();
      await savesSettled();
      expect(stored().socialSnapshots.map((s: A) => [s.day, s.followers])).toEqual([
        ["2026-10-01", 30],
        ["2026-10-02", 21],
      ]);
      expect(stored().socialPostStats.map((p: A) => [p.postId, p.views])).toEqual([
        ["p1", 3],
        ["p2", 4],
      ]);
    });

    it("a demographic import replaces its whole platform/day/dimension group; other groups from both tabs survive", async () => {
      const group = (dimension: string, rows: [string, number][]) =>
        rows.map(([key, pct]) => ({
          platform: "instagram",
          day: "2026-10-01",
          dimension,
          key,
          pct,
        }));
      S().importDemographics(
        group("gender", [
          ["male", 60],
          ["female", 40],
        ]) as never,
      );
      await savesSettled();
      const { lock, b } = await twoTabs();
      const h = hold(lock);
      b().importDemographics([
        ...group("gender", [
          ["male", 55],
          ["female", 45],
        ]),
        ...group("country", [
          ["SA", 80],
          ["other", 20],
        ]),
      ] as never);
      S().importDemographics([
        ...group("gender", [["male", 100]]),
        ...group("age", [
          ["25-34", 70],
          ["18-24", 30],
        ]),
      ] as never);
      h.release();
      await h.done;
      await tabB().savesSettled();
      await savesSettled();
      const rows = (d: string) =>
        stored()
          .demographics.filter((r: A) => r.dimension === d)
          .map((r: A) => [r.key, r.pct]);
      expect(rows("gender")).toEqual([["male", 100]]); // A's whole group, no stale or foreign slice
      expect(rows("country")).toEqual([
        ["SA", 80],
        ["other", 20],
      ]);
      expect(rows("age")).toEqual([
        ["25-34", 70],
        ["18-24", 30],
      ]);
    });

    it("removal vs update on a natural key: a removal in storage is never resurrected; a local removal keeps storage's update", async () => {
      S().setAccount("instagram", "before");
      S().setAccount("tiktok", "before-tt");
      S().addSnapshot({ platform: "instagram", day: "2026-10-01", followers: 10 });
      await savesSettled();
      const { lock, b } = await twoTabs();
      const h = hold(lock);
      b().removeAccount("instagram");
      b().setAccount("tiktok", "B-tt");
      b().removeSnapshot("instagram", "2026-10-01");
      S().setAccount("instagram", "A-stale");
      S().removeAccount("tiktok");
      S().addSnapshot({ platform: "instagram", day: "2026-10-01", followers: 30 });
      h.release();
      await h.done;
      await tabB().savesSettled();
      await savesSettled();
      expect(stored().socialAccounts).toEqual([{ platform: "tiktok", handle: "B-tt" }]);
      expect(stored().socialSnapshots).toEqual([]);
    });

    it("other natural keys stay single: completion, weekly review, a skill's saved ref by canonical URL, recent topics", async () => {
      const skill = "smart-bins-keywords";
      const week = "2026-10-17";
      S().completeQuest(skill, "produce", "https://youtu.be/a");
      S().saveReview({ week, mood: 3, wins: "", blocks: "", next: "" });
      S().addRecentTopic("one");
      await savesSettled();
      const { lock, b } = await twoTabs();
      const h = hold(lock);
      b().completeQuest(skill, "produce", "https://youtu.be/b");
      b().updateReview(week, { mood: 4 });
      b().addRef(skill, {
        platform: "ig",
        handle: "x",
        title: "B",
        url: "https://www.instagram.com/reel/ABC/",
      });
      b().addRecentTopic("two");
      S().completeQuest(skill, "produce", "https://youtu.be/c");
      S().updateReview(week, { mood: 5 });
      S().addRef(skill, {
        platform: "ig",
        handle: "x",
        title: "A",
        url: "https://instagram.com/p/ABC?igsh=1",
      });
      S().addRecentTopic("three");
      h.release();
      await h.done;
      await tabB().savesSettled();
      await savesSettled();
      expect(
        stored()
          .completions.filter((c: A) => c.skillId === skill && c.quest === "produce")
          .map((c: A) => c.proofUrl),
      ).toEqual(["https://youtu.be/c"]);
      expect(stored().reviews.map((r: A) => [r.week, r.mood])).toEqual([[week, 5]]);
      expect(stored().savedRefs[skill].map((r: A) => r.title)).toEqual(["A"]);
      expect(stored().recentTopics).toEqual(["three", "one"]);
    });

    describe("DT-7C-2A-C1-R1: helper-normalized lists decide deletion by logical identity before normalization", () => {
      const D0 = new Date("2026-10-17T08:00:00.000Z");
      const D1 = new Date("2026-10-17T09:00:00.000Z");
      const D2 = new Date("2026-10-17T10:00:00.000Z");
      const D3 = new Date("2026-10-17T11:00:00.000Z");
      type Vote = Parameters<ReturnType<typeof S>["setDiscoverFeedback"]>[0];
      const vote = (
        action: "more" | "less" | "hide-creator",
        id = "ABC123",
        creator = "@editor",
      ): Vote => ({
        url: `https://www.instagram.com/reel/${id}/`,
        platform: "ig",
        creator,
        genreId: "coffee",
        techniques: ["Match cut"],
        action,
      });
      /** A and B both hydrate the seeded state; B's save queues first behind the held lock, then A's. */
      async function seeded(seed: () => void) {
        seed();
        await savesSettled();
        const two = await twoTabs();
        return { ...two, h: hold(two.lock) };
      }
      async function finish(h: { release: () => void; done: Promise<unknown> }) {
        h.release();
        await h.done;
        await tabB().savesSettled();
        await savesSettled();
      }

      describe("discoverFeedback", () => {
        const seed = () => S().setDiscoverFeedback(vote("more"), D0);

        it("B's clearDiscoverFeedback: A's pre-notification edit of the same feedback to less is not resurrected", async () => {
          const { b, h } = await seeded(seed);
          b().clearDiscoverFeedback();
          S().setDiscoverFeedback(vote("less"), D1);
          expect(S().discoverFeedback).toHaveLength(1); // A's memory holds the edit
          await finish(h);
          expect(stored().discoverFeedback).toEqual([]);
        });

        it("B's successful locked reset: A's pre-notification edit of the same feedback is not resurrected", async () => {
          const { viaB, b, h } = await seeded(seed);
          const reset = b().reset(T_RESET);
          await vi.waitFor(() => expect(viaB.requests).toBe(1));
          S().setDiscoverFeedback(vote("less"), D1);
          h.release();
          await h.done;
          expect(await reset).toMatchObject({ ok: true });
          await tabB().savesSettled();
          await savesSettled();
          expect(stored().discoverFeedback).toEqual([]);
        });

        it("control: a settings-only edit after B's clear keeps it cleared and saves the setting", async () => {
          const { b, h } = await seeded(seed);
          b().clearDiscoverFeedback();
          S().setSettings({ reminderTime: "11:22" });
          await finish(h);
          expect(stored().discoverFeedback).toEqual([]);
          expect(stored().settings.reminderTime).toBe("11:22");
        });

        it("control: independent feedback keys from both tabs survive", async () => {
          const { b, h } = await seeded(seed);
          b().setDiscoverFeedback(vote("less", "OTHER01"), D1);
          S().setDiscoverFeedback(vote("less", "THIRD02"), D2);
          await finish(h);
          expect(
            stored()
              .discoverFeedback.map((x: A) => x.url)
              .sort(),
          ).toEqual([
            "https://www.instagram.com/p/ABC123",
            "https://www.instagram.com/p/OTHER01",
            "https://www.instagram.com/p/THIRD02",
          ]);
        });

        it("a surviving identity goes through the helper: B's later feedback beats A's earlier edit", async () => {
          const { b, h } = await seeded(seed);
          b().setDiscoverFeedback(vote("more"), D2);
          S().setDiscoverFeedback(vote("less"), D1);
          await finish(h);
          expect(stored().discoverFeedback).toHaveLength(1);
          expect(stored().discoverFeedback[0]).toMatchObject({
            action: "more",
            at: D2.toISOString(),
          });
        });

        it("a surviving identity goes through the helper: A's later edit beats B's earlier one", async () => {
          const { b, h } = await seeded(seed);
          b().setDiscoverFeedback(vote("less"), D1);
          S().setDiscoverFeedback(vote("more"), D2);
          await finish(h);
          expect(stored().discoverFeedback).toHaveLength(1);
          expect(stored().discoverFeedback[0]).toMatchObject({
            action: "more",
            at: D2.toISOString(),
          });
        });

        it("local deletion versus a newer durable update keeps the existing rule: B's update survives A's clear", async () => {
          const { b, h } = await seeded(seed);
          b().setDiscoverFeedback(vote("less"), D2);
          S().clearDiscoverFeedback();
          await finish(h);
          expect(stored().discoverFeedback).toHaveLength(1);
          expect(stored().discoverFeedback[0]).toMatchObject({
            action: "less",
            at: D2.toISOString(),
          });
        });

        it("creator hide and post feedback are separate identities: B's clear removes both despite A's edits to each", async () => {
          const { b, h } = await seeded(() => {
            S().setDiscoverFeedback(vote("more"), D0);
            S().setDiscoverFeedback(vote("hide-creator", "HIDE001"), D0);
          });
          expect(S().discoverFeedback).toHaveLength(2);
          b().clearDiscoverFeedback();
          S().setDiscoverFeedback(vote("less"), D1); // the post identity
          S().setDiscoverFeedback(vote("hide-creator", "HIDE002", "@Editor"), D1); // the creator identity
          await finish(h);
          expect(stored().discoverFeedback).toEqual([]);
        });

        it("a creator hide is one identity per creator, separate from the post vote; the helper keeps the latest of each", async () => {
          const { b, h } = await seeded(seed);
          b().setDiscoverFeedback(vote("hide-creator", "HIDE001"), D1);
          S().setDiscoverFeedback(vote("hide-creator", "HIDE002", "@EDITOR"), D2);
          await finish(h);
          const rows: A[] = stored().discoverFeedback;
          expect(rows.filter((r) => r.action === "hide-creator")).toHaveLength(1);
          expect(rows.find((r) => r.action === "hide-creator")).toMatchObject({
            at: D2.toISOString(),
          });
          expect(rows.filter((r) => r.action === "more")).toHaveLength(1);
        });

        it("canonical post URLs: an edit through a tracking-parameter URL is the cleared row's identity", async () => {
          const { b, h } = await seeded(seed);
          b().clearDiscoverFeedback();
          S().setDiscoverFeedback(
            { ...vote("less"), url: "https://instagram.com/reel/ABC123?igsh=track" },
            D1,
          );
          await finish(h);
          expect(stored().discoverFeedback).toEqual([]);
        });
      });

      describe("formatObservations", () => {
        const url = `https://www.instagram.com/reel/${instagramShortcodeAt(new Date("2026-10-10T12:00:00Z"))}/`;
        const observation = (observedAt: Date, key = "format-one", title = "Figures") => ({
          target: {
            key,
            name: { en: "Track figures" },
            visualPattern: { en: "Repeated figures" },
            audio: { title: "Track", artist: "Artist" },
          },
          source: {
            status: "available" as const,
            url,
            title,
            description: title,
            author: "creator.one",
            thumbnailUrl: "https://scontent.cdninstagram.com/image.jpg",
            observedAt: observedAt.toISOString(),
            provenance: "instagram-public-embed" as const,
            audio: { title: "Track", artist: "Artist" },
          },
        });
        const record = (
          store: () => ReturnType<typeof S>,
          observedAt: Date,
          key?: string,
          title?: string,
        ) =>
          expect(
            store().recordFormatObservation(observation(observedAt, key, title), observedAt),
          ).toBe(true);
        const seed = () => record(S, D0);
        const rows = () => stored().formatObservations as A[];

        it("B removes the observation: A's newer revision of the same target+URL is not resurrected", async () => {
          const { b, h } = await seeded(seed);
          expect(rows()).toHaveLength(1);
          b().removeFormatObservation("format-one", url);
          record(S, D2, "format-one", "A edit");
          await finish(h);
          expect(rows()).toEqual([]);
        });

        it("control: an independent target from the other tab survives the same removal", async () => {
          const { b, h } = await seeded(seed);
          b().removeFormatObservation("format-one", url);
          record(S, D2, "format-two");
          await finish(h);
          expect(rows().map((r) => r.target.key)).toEqual(["format-two"]);
        });

        it("a surviving identity goes through the helper: the newest source revision wins, never a mix", async () => {
          const { b, h } = await seeded(seed);
          record(b, D3, "format-one", "B newest");
          record(S, D2, "format-one", "A older");
          await finish(h);
          expect(rows()).toHaveLength(1);
          expect(rows()[0].source).toMatchObject({
            title: "B newest",
            observedAt: D3.toISOString(),
          });
        });

        it("a surviving identity: A's newer revision beats B's older one", async () => {
          const { b, h } = await seeded(seed);
          record(b, D1, "format-one", "B older");
          record(S, D3, "format-one", "A newest");
          await finish(h);
          expect(rows()).toHaveLength(1);
          expect(rows()[0].source).toMatchObject({
            title: "A newest",
            observedAt: D3.toISOString(),
          });
        });

        it("local removal versus a newer durable update keeps the existing rule: B's revision survives A's removal", async () => {
          const { b, h } = await seeded(seed);
          record(b, D2, "format-one", "B newer");
          S().removeFormatObservation("format-one", url);
          await finish(h);
          expect(rows()).toHaveLength(1);
          expect(rows()[0].source.title).toBe("B newer");
        });
      });

      describe("formatQueue", () => {
        const target = (pattern = "Repeated figures") => ({
          key: "trip-figures",
          name: { en: "Track figures" },
          visualPattern: { en: pattern },
          audio: { title: "Track", artist: "Artist" },
        });
        const url = "https://www.instagram.com/p/Post0/";
        const lead = (addedAt: Date, pattern?: string) => ({
          target: target(pattern),
          url,
          addedAt: addedAt.toISOString(),
        });
        const seed = () => useStore.setState({ formatQueue: [lead(D1)] });
        const rows = () => stored().formatQueue as A[];

        it("B removes the lead: A's re-dated copy of the same target snapshot+URL is not resurrected", async () => {
          const { b, h } = await seeded(seed);
          expect(rows()).toHaveLength(1);
          b().removeFormatCandidate(target(), url);
          useStore.setState({ formatQueue: [lead(D2)] });
          await finish(h);
          expect(rows()).toEqual([]);
        });

        it("control: a lead A adds for a distinct full target snapshot survives the same removal", async () => {
          const { b, h } = await seeded(seed);
          b().removeFormatCandidate(target(), url);
          S().addFormatCandidates(target("Stacked cars"), [url]);
          await finish(h);
          expect(rows().map((r) => r.target.visualPattern.en)).toEqual(["Stacked cars"]);
        });

        it("distinct target snapshots with one URL are separate identities when both tabs add them", async () => {
          const { b, h } = await seeded(seed);
          b().addFormatCandidates(target("Stacked cars"), [url]);
          S().addFormatCandidates(target("Mirror turns"), [url]);
          await finish(h);
          expect(
            rows()
              .map((r) => r.target.visualPattern.en)
              .sort(),
          ).toEqual(["Mirror turns", "Repeated figures", "Stacked cars"]);
        });

        it.each([
          ["A holds the original date", D0, D2],
          ["B holds the original date", D2, D0],
        ])(
          "a surviving identity goes through the helper: the earliest date wins (%s)",
          async (_n, a, bDate) => {
            const { h } = await seeded(seed);
            useStore.setState({ formatQueue: [lead(a)] });
            tabB().useStore.setState({ formatQueue: [lead(bDate)] });
            await finish(h);
            expect(rows()).toHaveLength(1);
            expect(rows()[0].addedAt).toBe(D0.toISOString());
          },
        );

        it("local removal versus a newer durable update keeps the existing rule: B's re-dated lead survives A's removal", async () => {
          const { h } = await seeded(seed);
          tabB().useStore.setState({ formatQueue: [lead(D0)] }); // B's update is saved first
          S().removeFormatCandidate(target(), url);
          expect(S().formatQueue).toEqual([]);
          await finish(h);
          expect(rows()).toHaveLength(1);
          expect(rows()[0].addedAt).toBe(D0.toISOString());
        });
      });

      describe("discoverCandidates (localStorage fallback)", () => {
        const found = (code: string, snippet: string, now: Date, genreId = "coffee") =>
          accumulateCategoryCandidates(
            [],
            [
              {
                platform: "ig",
                url: `https://www.instagram.com/p/${code}`,
                handle: "editor",
                title: "Coffee match cut",
                snippet,
                section: "example",
                lang: "en",
              },
            ],
            { genreId, now },
          );
        const seed = () => useStore.setState({ discoverCandidates: found("CAND1", "seed", D0) });
        const rows = () => stored().discoverCandidates as A[];

        it("B's successful locked reset: A's pre-notification re-observation of the same genre/platform/URL is not resurrected", async () => {
          const { viaB, b, h } = await seeded(seed);
          expect(rows()).toHaveLength(1);
          const reset = b().reset(T_RESET);
          await vi.waitFor(() => expect(viaB.requests).toBe(1));
          useStore.setState({ discoverCandidates: found("CAND1", "A edit", D2) });
          h.release();
          await h.done;
          expect(await reset).toMatchObject({ ok: true });
          await tabB().savesSettled();
          await savesSettled();
          expect(rows()).toEqual([]);
        });

        it("control: the same URL in another genre is another identity and survives B's removal", async () => {
          const { h } = await seeded(seed);
          tabB().useStore.setState({ discoverCandidates: [] });
          useStore.setState({
            discoverCandidates: [
              ...found("CAND1", "seed", D0),
              ...found("CAND1", "other", D2, "food"),
            ],
          });
          await finish(h);
          expect(rows().map((r) => r.genreId)).toEqual(["food"]);
        });

        it.each([
          ["A's later evidence wins", D2, D1, "A edit"],
          ["B's later evidence wins", D1, D2, "B edit"],
        ])("a surviving identity goes through the helper: %s", async (_n, aAt, bAt, snippet) => {
          const { h } = await seeded(seed);
          useStore.setState({ discoverCandidates: found("CAND1", "A edit", aAt) });
          tabB().useStore.setState({ discoverCandidates: found("CAND1", "B edit", bAt) });
          await finish(h);
          expect(rows()).toHaveLength(1);
          expect(rows()[0].item.snippet).toBe(snippet);
        });

        it("local removal versus a newer durable update keeps the existing rule: B's re-observation survives A's removal", async () => {
          const { h } = await seeded(seed);
          tabB().useStore.setState({ discoverCandidates: found("CAND1", "B edit", D2) }); // B saves first
          useStore.setState({ discoverCandidates: [] });
          await finish(h);
          expect(rows()).toHaveLength(1);
          expect(rows()[0].item.snippet).toBe("B edit");
        });
      });
    });
  });
});
