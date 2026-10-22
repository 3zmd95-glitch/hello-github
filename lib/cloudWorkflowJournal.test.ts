import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  canonicalJson,
  sha256Hex,
  weekOf,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityOf,
  isVerifiedReceipt,
  occurrenceKey,
  parseAnswer,
  type CloudRequest,
  type Parsed,
} from "./cloudWorkflowProtocol";
import {
  JOURNAL_CAPACITY,
  candidateEntry,
  compareObservations,
  emptyJournal,
  isSuppressed,
  mergeJournals,
  observationOf,
  parseJournal,
  readJournal,
  resetJournal,
  verifyJournal,
  verifyObservation,
  withEntry,
  withObservation,
  withoutEntry,
  type CloudJournal,
  type JournalEntry,
} from "./cloudWorkflowJournal";

// ⚙️ DT-7C-2A pure journal kernel (planning/tools/38-cloud-workflows.md): structural parse, canonical keys, observed
// receipts revalidated through the pinned parser, monotonic suppression and the import merge. No store, no network.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER = "wfo_" + "a".repeat(32);
const OWNER_B = "wfo_" + "b".repeat(32);
const ORIGIN = "https://scout.example";
const ORIGIN_B = "https://other.example";
const AT = "2026-10-17T09:00:00.000Z";
const SUBMITTED = "2026-10-17T09:05:00.000Z";
const CANARY = "CANARY-secret-bearer-7c2a";

const idea = (id: string, en = "Idea {date}") => ({ id, kind: "idea", text: { ar: "", en } });
function bodyOf(o: A = {}): OccurrenceBody {
  return {
    occurrenceId: o.id ?? "m1",
    ownerKey: o.owner ?? OWNER,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "", en: o.name ?? "Flow" },
      trigger: { kind: "manual" },
      actions: o.actions ?? [idea("a1")],
    },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt: o.at ?? AT,
  } as unknown as OccurrenceBody;
}
/** An article-ready body whose second idea renders `{title}{title}<extra>` from a 2,000-unit title. */
function readyBody(extra: string): OccurrenceBody {
  const big = `{title}{title}${extra}`;
  const actions = [
    idea("a1", "ok"),
    { id: "a2", kind: "idea", text: { ar: big, en: big } },
    idea("a3", "z"),
  ];
  const title = "x".repeat(2000);
  return {
    ...bodyOf({ id: "ar-r1" }),
    kind: "article-ready",
    snapshot: { name: { ar: "", en: "Flow" }, trigger: { kind: "article-ready" }, actions },
    input: {
      articleId: "art1",
      title: { ar: title, en: title },
      summary: { ar: "", en: "S" },
      slug: "s",
      lang: "en",
      day: "2026-10-17",
    },
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
    steps: b.snapshot.actions.map((a, idx) => ({
      idx,
      actionId: a.id,
      kind: a.kind,
      status: "pending",
    })),
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
const statusReq = (id = "m1", owner = OWNER): CloudRequest => ({
  kind: "status",
  ownerKey: owner,
  occurrenceId: id,
});
async function statusParsed(receipt: A, origin = ORIGIN, owner = OWNER): Promise<Parsed> {
  return parseAnswer(
    statusReq(receipt.occurrenceId, owner),
    { status: 200, body: { ownerKey: owner, occurrence: receipt } },
    { origin },
  );
}

async function entryFor(
  body: OccurrenceBody,
  origin = ORIGIN,
  commitId = "c-" + body.occurrenceId,
): Promise<JournalEntry> {
  const c = await candidateEntry(origin, body);
  if (!c.ok) throw new Error(c.reason);
  return { ...c.entry, commitId, state: "queued", observation: null };
}
async function journalWith(...entries: JournalEntry[]): Promise<CloudJournal> {
  let j = emptyJournal();
  for (const e of entries) j = withEntry(j, e, e.commitId);
  return j;
}

describe("candidate entries: validated, detached, hashed, authority-scoped", () => {
  it("keys an entry by the canonical structured (origin, ownerKey, occurrenceId) and keeps executionAt", async () => {
    const b = bodyOf();
    const c = await candidateEntry("HTTPS://Scout.Example/", b);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const auth = authorityOf(ORIGIN, OWNER)!;
    expect(c.entry.key).toBe(occurrenceKey(auth, "m1"));
    expect(c.entry.authority).toEqual({ origin: ORIGIN, ownerKey: OWNER });
    expect(c.entry.executionAt).toBe(AT);
    expect(c.entry.payloadDigest).toBe(await digestOf(b));
    // Detached: editing the caller's body afterwards changes nothing.
    (b.snapshot.name as A).en = "edited";
    expect((c.entry.body.snapshot.name as A).en).toBe("Flow");
  });

  it("refuses an invalid origin, body or a body with extra (private) fields", async () => {
    expect((await candidateEntry("https://x.example/path", bodyOf())).ok).toBe(false);
    expect((await candidateEntry(ORIGIN, { ...bodyOf(), token: CANARY })).ok).toBe(false);
    expect((await candidateEntry(ORIGIN, { ...bodyOf(), ownerKey: "nope" })).ok).toBe(false);
    expect((await candidateEntry(ORIGIN, null)).ok).toBe(false);
  });

  it("refuses an over-limit body and a 4,000-unit cloud limitation with the exact step, prefix and suffix", async () => {
    expect(await candidateEntry(ORIGIN, bodyOf({ name: "n".repeat(81) }))).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await candidateEntry(ORIGIN, readyBody(""))).toMatchObject({ ok: true });
    expect(await candidateEntry(ORIGIN, readyBody("y"))).toEqual({
      ok: false,
      reason: "limitation",
      limitation: { actionId: "a2", limitation: "output-too-large", built: 1, skipped: ["a3"] },
    });
  });
});

describe("structural journal parse (persisted data is untrusted)", () => {
  it("round-trips through JSON and treats an absent slice as empty, a malformed one as unreadable", async () => {
    const j = await journalWith(await entryFor(bodyOf()));
    expect(parseJournal(JSON.parse(JSON.stringify(j)))).toEqual(j);
    expect(readJournal(undefined)).toEqual(emptyJournal());
    for (const bad of [null, [], "x", { v: 2 }, { ...j, extra: 1 }, { ...j, generation: -1 }])
      expect(parseJournal(bad)).toBeNull();
    expect(readJournal(null)).toBeNull();
  });

  it("refuses a retargeted key, a foreign body owner, a duplicate key and a private canary field", async () => {
    const e = await entryFor(bodyOf());
    const j = await journalWith(e);
    const raw = JSON.parse(JSON.stringify(j));
    const mutate = (f: (x: A) => void) => {
      const x = JSON.parse(JSON.stringify(raw));
      f(x);
      return parseJournal(x);
    };
    expect(mutate((x) => (x.entries[0].authority.origin = ORIGIN_B))).toBeNull();
    expect(mutate((x) => (x.entries[0].authority.ownerKey = OWNER_B))).toBeNull();
    expect(mutate((x) => (x.entries[0].occurrenceId = "m2"))).toBeNull();
    expect(mutate((x) => x.entries.push(x.entries[0]))).toBeNull();
    expect(mutate((x) => (x.entries[0].bearer = CANARY))).toBeNull();
    expect(mutate((x) => (x.entries[0].body.token = CANARY))).toBeNull();
    expect(mutate((x) => (x.entries[0].state = "suppressed"))).toBeNull();
    expect(mutate((x) => (x.entries[0].verified = true))).toBeNull();
    expect(mutate((x) => (x.suppression = { epoch: 1, resetAt: null, commitId: "r" }))).toBeNull();
  });

  it("refuses more than the capacity", async () => {
    const e = await entryFor(bodyOf());
    const raw = JSON.parse(JSON.stringify(await journalWith(e)));
    raw.entries = Array.from({ length: JOURNAL_CAPACITY + 1 }, (_, n) => ({
      ...raw.entries[0],
      occurrenceId: `m${n}`,
      key: occurrenceKey(authorityOf(ORIGIN, OWNER)!, `m${n}`),
      body: { ...raw.entries[0].body, occurrenceId: `m${n}` },
    }));
    expect(parseJournal(raw)).toBeNull();
  });

  it("verifies every body digest asynchronously (a changed body or digest is unreadable)", async () => {
    const j = await journalWith(await entryFor(bodyOf()));
    expect(await verifyJournal(j)).toEqual({ ok: true, rejected: [] });
    const x = JSON.parse(JSON.stringify(j));
    x.entries[0].body.snapshot.name.en = "Other";
    expect(await verifyJournal(parseJournal(x)!)).toEqual({ ok: false });
  });
});

describe("observed receipts: authority-bound, revalidated, never delivery proof", () => {
  it("accepts a verified receipt with its complete authority and binding, and revalidates the JSON copy", async () => {
    const b = bodyOf();
    const e = await entryFor(b);
    const parsed = await statusParsed(await pendingReceipt(b));
    const o = await observationOf(parsed, statusReq());
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.key).toBe(e.key);
    expect(o.observation.authority).toEqual({ origin: ORIGIN, ownerKey: OWNER });
    expect(o.observation.binding).toEqual({
      kind: "status",
      ownerKey: OWNER,
      occurrenceId: "m1",
      payloadDigest: e.payloadDigest,
    });
    // The stored copy is plain data: no parser brand survives, and none is needed.
    const copy = JSON.parse(JSON.stringify(o.observation));
    expect(isVerifiedReceipt(copy.receipt)).toBe(false);
    expect(await verifyObservation(e, copy)).toBe(true);
  });

  it("refuses a forged look-alike receipt, a saved verified flag, a compact feed and another authority", async () => {
    const b = bodyOf();
    const e = await entryFor(b);
    const receipt = await pendingReceipt(b);
    const forged = {
      outcome: "ok",
      kind: "status",
      authority: { origin: ORIGIN, ownerKey: OWNER },
      result: { found: "row", receipt },
    } as unknown as Parsed;
    expect(await observationOf(forged, statusReq())).toMatchObject({
      ok: false,
      reason: "unverified",
    });
    const feed = await parseAnswer(
      { kind: "changes", ownerKey: OWNER, after: 0 },
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
              payloadDigest: e.payloadDigest,
              steps: receipt.steps,
            },
          ],
          nextAfter: 1,
          more: false,
        },
      },
      { origin: ORIGIN },
    );
    expect(feed.outcome).toBe("ok");
    expect(await observationOf(feed, { kind: "changes", ownerKey: OWNER, after: 0 })).toMatchObject(
      { ok: false, reason: "compact-feed" },
    );

    const good = await observationOf(await statusParsed(receipt), statusReq());
    if (!good.ok) throw new Error("setup");
    const raw = JSON.parse(JSON.stringify(good.observation));
    expect(await verifyObservation(e, { ...raw, verified: true })).toBe(false);
    expect(
      await verifyObservation(e, { ...raw, authority: { origin: ORIGIN_B, ownerKey: OWNER } }),
    ).toBe(false);
    expect(await verifyObservation(e, { ...raw, receipt: { ...raw.receipt, state: "done" } })).toBe(
      false,
    );
    expect(
      await verifyObservation(e, { ...raw, binding: { ...raw.binding, occurrenceId: "m2" } }),
    ).toBe(false);
    // A feed item stored as if it were a receipt.
    const item = {
      occurrenceId: "m1",
      workflowId: "w1",
      changeSeq: 1,
      state: "pending",
      receiptVersion: 1,
      payloadDigest: e.payloadDigest,
      steps: receipt.steps,
    };
    expect(await verifyObservation(e, { ...raw, receipt: item })).toBe(false);
    // Another entry (same occurrence id, other body) cannot take this receipt.
    const other = await entryFor(bodyOf({ name: "Other" }));
    expect(await verifyObservation(other, raw)).toBe(false);
  });

  it("a receipt for the same occurrence id under another origin or owner is a different authority", async () => {
    const b = bodyOf();
    const p1 = await observationOf(await statusParsed(await pendingReceipt(b)), statusReq());
    const p2 = await observationOf(
      await statusParsed(await pendingReceipt(b), ORIGIN_B),
      statusReq(),
    );
    const bOwner = bodyOf({ owner: OWNER_B });
    const p3 = await observationOf(
      await statusParsed(await pendingReceipt(bOwner), ORIGIN, OWNER_B),
      statusReq("m1", OWNER_B),
    );
    if (!p1.ok || !p2.ok || !p3.ok) throw new Error("setup");
    expect(new Set([p1.key, p2.key, p3.key]).size).toBe(3);
  });

  it("orders observations: newer replaces, older never does, equal contradictions conflict, an ack only adds", async () => {
    const b = bodyOf();
    const pend = await observationOf(await statusParsed(await pendingReceipt(b)), statusReq());
    const done = await observationOf(await statusParsed(await doneReceipt(b)), statusReq());
    const doneOther = await observationOf(
      await statusParsed(await doneReceipt(b, "Idea 2026-10-17 other")),
      statusReq(),
    );
    const acked = await doneReceipt(b);
    Object.assign(acked, {
      ackedVersion: 3,
      firstAckAt: "2026-10-17T09:07:00.000Z",
      purgeAt: new Date(Date.parse("2026-10-17T09:07:00.000Z") + 90 * 86_400_000).toISOString(),
    });
    const ack = await observationOf(await statusParsed(acked), statusReq());
    if (!pend.ok || !done.ok || !doneOther.ok || !ack.ok) throw new Error("setup");
    expect(compareObservations(pend.observation, done.observation)).toBe("newer");
    expect(compareObservations(done.observation, pend.observation)).toBe("older");
    expect(
      compareObservations(done.observation, JSON.parse(JSON.stringify(done.observation))),
    ).toBe("same");
    expect(compareObservations(done.observation, doneOther.observation)).toBe("conflict");
    expect(compareObservations(done.observation, ack.observation)).toBe("newer");
    expect(compareObservations(ack.observation, done.observation)).toBe("older");
  });
});

describe("suppression and reset", () => {
  it("reset advances {epoch, resetAt, commitId} monotonically and suppresses by immutable executionAt", async () => {
    const early = await entryFor(bodyOf({ id: "m1" }));
    const j = await journalWith(early);
    const r1 = resetJournal(j, new Date("2026-10-17T10:00:00.000Z"), "r1");
    expect(r1.suppression).toEqual({
      epoch: 1,
      resetAt: "2026-10-17T10:00:00.000Z",
      commitId: "r1",
    });
    expect(r1.entries[0].state).toBe("suppressed");
    expect(r1.entries[0].commitId).toBe(early.commitId);
    expect(r1.generation).toBe(j.generation + 1);
    // An earlier clock never lowers resetAt.
    const r2 = resetJournal(r1, new Date("2026-10-17T08:00:00.000Z"), "r2");
    expect(r2.suppression).toEqual({
      epoch: 2,
      resetAt: "2026-10-17T10:00:00.000Z",
      commitId: "r2",
    });
    expect(isSuppressed(AT, r2.suppression)).toBe(true);
    expect(isSuppressed("2026-10-17T10:00:00.001Z", r2.suppression)).toBe(false);
  });
});

describe("import merge against the fresh durable journal", () => {
  it("keeps unresolved entries of both, original authorities and commit tokens, and is idempotent", async () => {
    const a = await entryFor(bodyOf({ id: "m1" }));
    const bOther = await entryFor(bodyOf({ id: "m1" }), ORIGIN_B, "c-other");
    const c = await entryFor(bodyOf({ id: "m2" }));
    const fresh = await journalWith(a);
    const imported = await journalWith(bOther, c);
    const m = mergeJournals(fresh, imported, "merge-1");
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.journal.entries.map((e) => [e.key, e.commitId]).sort()).toEqual(
      [
        [a.key, a.commitId],
        [bOther.key, "c-other"],
        [c.key, c.commitId],
      ].sort(),
    );
    expect(m.journal.generation).toBe(fresh.generation + 1);
    const again = mergeJournals(m.journal, imported, "merge-2");
    expect(again).toMatchObject({ ok: true, changed: false });
    if (again.ok) expect(again.journal).toEqual(m.journal);
  });

  it("refuses a changed digest under the same key and an overflowing union, before anything is written", async () => {
    const a = await entryFor(bodyOf({ id: "m1" }));
    const changed = await entryFor(bodyOf({ id: "m1", name: "Changed" }));
    expect(mergeJournals(await journalWith(a), await journalWith(changed), "x")).toEqual({
      ok: false,
      reason: "conflict",
      keys: [a.key],
    });
    const base = JSON.parse(JSON.stringify(await journalWith(a)));
    const many = (prefix: string, n: number) => ({
      ...base,
      entries: Array.from({ length: n }, (_, i) => ({
        ...base.entries[0],
        occurrenceId: `${prefix}${i}`,
        key: occurrenceKey(authorityOf(ORIGIN, OWNER)!, `${prefix}${i}`),
        body: { ...base.entries[0].body, occurrenceId: `${prefix}${i}` },
      })),
    });
    const f = parseJournal(many("f", 400))!;
    const i = parseJournal(many("i", 201))!;
    expect(mergeJournals(f, i, "x")).toEqual({ ok: false, reason: "capacity", keys: [] });
    expect(mergeJournals(f, parseJournal(many("i", 200))!, "x").ok).toBe(true);
  });

  it("merges max epoch and max resetAt independently, including equal-counter branches, in both orders", async () => {
    const e = await entryFor(bodyOf());
    const base = await journalWith(e);
    const one = resetJournal(base, new Date("2026-10-17T10:00:00.000Z"), "r-one");
    const two = resetJournal(base, new Date("2026-10-17T12:00:00.000Z"), "r-two");
    const twice = resetJournal(
      resetJournal(base, new Date("2026-10-17T09:30:00.000Z"), "r-a"),
      new Date("2026-10-17T09:40:00.000Z"),
      "r-b",
    );
    // Equal counters (epoch 1), different resetAt: the later wins in both orders.
    for (const [x, y] of [
      [one, two],
      [two, one],
    ] as const) {
      const m = mergeJournals(x, y, "m");
      if (!m.ok) throw new Error("merge");
      expect(m.journal.suppression.epoch).toBe(1);
      expect(m.journal.suppression.resetAt).toBe("2026-10-17T12:00:00.000Z");
    }
    // Higher counter with the earlier reset: epoch from one side, resetAt from the other, in both orders.
    for (const [x, y] of [
      [twice, two],
      [two, twice],
    ] as const) {
      const m = mergeJournals(x, y, "m");
      if (!m.ok) throw new Error("merge");
      expect(m.journal.suppression.epoch).toBe(2);
      expect(m.journal.suppression.resetAt).toBe("2026-10-17T12:00:00.000Z");
      expect(m.journal.entries[0].state).toBe("suppressed");
    }
  });

  it("keeps the newer observation in both orders and refuses equal-version contradictions", async () => {
    const b = bodyOf();
    const e = await entryFor(b);
    const pend = await observationOf(await statusParsed(await pendingReceipt(b)), statusReq());
    const done = await observationOf(await statusParsed(await doneReceipt(b)), statusReq());
    const other = await observationOf(
      await statusParsed(await doneReceipt(b, "Idea 2026-10-17 x")),
      statusReq(),
    );
    if (!pend.ok || !done.ok || !other.ok) throw new Error("setup");
    const jp = withObservation(await journalWith(e), e.key, pend.observation, "o1");
    const jd = withObservation(await journalWith(e), e.key, done.observation, "o2");
    const jo = withObservation(await journalWith(e), e.key, other.observation, "o3");
    for (const [x, y] of [
      [jp, jd],
      [jd, jp],
    ] as const) {
      const m = mergeJournals(x, y, "m");
      if (!m.ok) throw new Error("merge");
      expect(m.journal.entries[0].observation?.receipt.receiptVersion).toBe(3);
    }
    expect(mergeJournals(jd, jo, "m")).toEqual({ ok: false, reason: "conflict", keys: [e.key] });
  });
});

describe("eligibility: over-limit planner context", () => {
  it("refuses a context over 8 KiB as too-large (never truncated) and accepts the same body with a small context", async () => {
    const week = weekOf("2026-10-17");
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `plan-item-${String(i).padStart(3, "0")}`,
        week,
        day: i % 7,
        skillId: "smart-bins-keywords",
        quest: "train",
        minutes: 30,
        by: "me",
      }));
    const planBody = (n: number) =>
      ({
        ...bodyOf(),
        snapshot: {
          name: { ar: "", en: "Flow" },
          trigger: { kind: "manual" },
          actions: [{ id: "a1", kind: "plan", quest: "train", minutes: 30, day: 0 }],
        },
        plannerContext: {
          targetWeek: week,
          completions: [],
          planItems: rows(n),
          settings: { gear: ["phone"], davinciEdition: "free" },
          contextAt: AT,
        },
      }) as unknown as OccurrenceBody;
    expect(await candidateEntry(ORIGIN, planBody(100))).toEqual({ ok: false, reason: "too-large" });
    const small = await candidateEntry(ORIGIN, planBody(3));
    expect(small.ok).toBe(true);
    if (small.ok) expect(small.entry.body.plannerContext?.planItems).toHaveLength(3);
  });
});

// DT-7C-2A-R1 (7C2A-3): REAL Worker answers (the real `scout.handle` router over the actual SQLite WorkflowCoordinator,
// the harness of lib/cloudWorkflowProtocol.wire.test.ts). Loaded dynamically for the same reason as there: a static
// import would pull the Cloudflare-typed Worker source into the app's `tsc` program.
describe("real Worker receipts: request provenance is not proof (DT-7C-2A-R1)", () => {
  const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec); // eslint-disable-line @typescript-eslint/no-explicit-any
  const TOKEN = "journal-wire-token";
  const APP = "https://3zmd95-glitch.github.io";
  const BASE = "https://scout.test";
  const T0 = Date.parse(AT); // the body day (2026-10-17, Riyadh) matches executionAt
  let handle: (
    req: Request,
    env: A,
    ctx: undefined,
    deps: { now: () => Date },
  ) => Promise<Response>;
  let Coordinator: new (state: never) => { fetch(req: Request): Promise<Response> };
  beforeAll(async () => {
    handle = (await load("@/workers/scout/src/scout")).handle;
    Coordinator = (await load("@/workers/scout/src/social/workflowCoordinator"))
      .WorkflowCoordinator;
  });

  /**
   * One Worker (its own SQLite database) with a registered workflow; `now` is that Worker's clock. `owner` seeds the
   * minted identity (the same Worker identity on another storage, as after a restore), never invented receipts.
   */
  async function worker(now = T0, owner?: string) {
    const db = new DatabaseSync(":memory:");
    if (owner) {
      db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.prepare("INSERT INTO meta (key, value) VALUES ('owner_key', ?)").run(owner);
    }
    const storage = {
      sql: {
        exec(q: string, ...b: (string | number | null)[]) {
          const st = db.prepare(q);
          if (/^\s*SELECT|RETURNING/i.test(q)) {
            const rows = st.all(...b);
            return { toArray: () => rows };
          }
          st.run(...b);
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
    const ns = {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: (url: string, init: RequestInit) =>
          new Coordinator({ storage } as never).fetch(new Request(url, init)),
      }),
    };
    const env = { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP, WORKFLOW_COORDINATOR: ns };
    let clock = T0 - 600_000; // registered before the occurrence instant, then the Worker clock is `now`
    const route = async (path: string, input?: A) => {
      const res = await handle(
        new Request(`${BASE}/social/workflows/${path}`, {
          method: input ? "POST" : "GET",
          headers: { Authorization: `Bearer ${TOKEN}`, Origin: APP },
          ...(input ? { body: JSON.stringify(input) } : {}),
        }),
        env,
        undefined,
        { now: () => new Date(clock) },
      );
      return { status: res.status, body: (await res.json()) as A };
    };
    const ownerKey: string = (await route("authority")).body.ownerKey;
    const reg = await route("registrations", {
      ownerKey,
      workflowId: "w1",
      expectedEpoch: 0,
      revision: 1,
      workflowDigest: "c".repeat(64),
    });
    expect(reg.status).toBe(200);
    clock = now;
    const status = () => route(`occurrences/occ?ownerKey=${ownerKey}`);
    return { route, status, owner: ownerKey, close: () => db.close() };
  }
  type Worker = Awaited<ReturnType<typeof worker>>;
  const req = (kind: string, owner: string): CloudRequest =>
    ({ kind, ownerKey: owner, occurrenceId: "occ" }) as CloudRequest;
  async function observe(request: CloudRequest, wire: { status: number; body: unknown }) {
    const o = await observationOf(await parseAnswer(request, wire, { origin: BASE }), request);
    if (!o.ok) throw new Error(o.reason);
    return o.observation;
  }
  async function submitted(w: Worker) {
    const body = bodyOf({ id: "occ", owner: w.owner, at: new Date(T0).toISOString() });
    const payloadDigest = await digestOf(body);
    const wire = await w.route("occurrences", { body, payloadDigest });
    expect(wire.status).toBe(201);
    const submit = { kind: "submit", body, payloadDigest } as CloudRequest;
    return { body, wire, submit };
  }

  it("the identical receipt via Submit/Run and via Status is the same proof; the first provenance is kept", async () => {
    const w = await worker();
    try {
      const s = await submitted(w);
      const entry = await entryFor(s.body, BASE);
      const viaSubmit = await observe(s.submit, s.wire);
      const viaStatus = await observe(req("status", w.owner), await w.status());
      expect(viaSubmit.receipt).toEqual(viaStatus.receipt);
      expect(viaSubmit.binding.kind).toBe("submit");
      expect(compareObservations(viaSubmit, viaStatus)).toBe("same");
      expect(compareObservations(viaStatus, viaSubmit)).toBe("same");

      const run = await w.route("occurrences/occ/run", { ownerKey: w.owner });
      expect(run.body.occurrence.state).toBe("done");
      const viaRun = await observe(req("run", w.owner), run);
      const doneStatus = await observe(req("status", w.owner), await w.status());
      expect(compareObservations(viaRun, doneStatus)).toBe("same");
      expect(compareObservations(viaSubmit, viaRun)).toBe("newer");
      for (const o of [viaSubmit, viaStatus, viaRun, doneStatus])
        expect(await verifyObservation(entry, JSON.parse(JSON.stringify(o)))).toBe(true);

      // Two valid backups holding the same done receipt from Run and from Status: the union is idempotent and keeps
      // the fresh journal's (first stored) provenance, in both orders.
      const base = await journalWith(entry);
      const jRun = withObservation(base, entry.key, viaRun, "obs-run");
      const jStatus = withObservation(base, entry.key, doneStatus, "obs-status");
      expect(await verifyJournal(jRun)).toEqual({ ok: true, rejected: [] });
      expect(await verifyJournal(jStatus)).toEqual({ ok: true, rejected: [] });
      expect(mergeJournals(jRun, jStatus, "m")).toEqual({
        ok: true,
        journal: jRun,
        changed: false,
      });
      expect(mergeJournals(jStatus, jRun, "m")).toEqual({
        ok: true,
        journal: jStatus,
        changed: false,
      });

      // The acknowledgement still only enriches; an older version never replaces.
      const acked = await w.route("occurrences/occ/ack", {
        ownerKey: w.owner,
        receiptVersion: doneStatus.receipt.receiptVersion,
      });
      expect(acked.status).toBe(200);
      const ackStatus = await observe(req("status", w.owner), await w.status());
      expect(compareObservations(viaRun, ackStatus)).toBe("newer");
      expect(compareObservations(ackStatus, viaRun)).toBe("older");
    } finally {
      w.close();
    }
  });

  it("Cancel and Status observing the identical canceled receipt agree", async () => {
    const w = await worker();
    try {
      await submitted(w);
      const cancel = await w.route("occurrences/occ/cancel", { ownerKey: w.owner });
      expect(cancel.status).toBe(200);
      const viaCancel = await observe(req("cancel", w.owner), cancel);
      const viaStatus = await observe(req("status", w.owner), await w.status());
      expect(viaCancel.binding.kind).toBe("cancel");
      expect(compareObservations(viaCancel, viaStatus)).toBe("same");
    } finally {
      w.close();
    }
  });

  it("a real equal-version contradiction (two Workers, same authority and body, different receipts) still conflicts", async () => {
    const one = await worker(T0);
    const two = await worker(T0 + 1000, one.owner);
    try {
      expect(two.owner).toBe(one.owner);
      const a = await submitted(one);
      await submitted(two);
      const entry = await entryFor(a.body, BASE);
      const oa = await observe(a.submit, a.wire);
      const ob = await observe(req("status", two.owner), await two.status());
      expect(oa.receipt.receiptVersion).toBe(ob.receipt.receiptVersion);
      expect(oa.receipt).not.toEqual(ob.receipt);
      expect(await verifyObservation(entry, oa)).toBe(true);
      expect(await verifyObservation(entry, ob)).toBe(true);
      expect(compareObservations(oa, ob)).toBe("conflict");
      const base = await journalWith(entry);
      expect(
        mergeJournals(
          withObservation(base, entry.key, oa, "o1"),
          withObservation(base, entry.key, ob, "o2"),
          "m",
        ),
      ).toEqual({ ok: false, reason: "conflict", keys: [entry.key] });
    } finally {
      one.close();
      two.close();
    }
  });
});

describe("retirement helper (DT-7C-2C)", () => {
  it("withoutEntry removes exactly one key with a new generation and commit; an unknown key is the same journal", async () => {
    const a = await entryFor(bodyOf({ id: "m1" }));
    const b = await entryFor(bodyOf({ id: "m2" }));
    const j = await journalWith(a, b);
    const next = withoutEntry(j, a.key, "retire-1");
    expect(next.entries.map((e) => e.key)).toEqual([b.key]);
    expect(next.generation).toBe(j.generation + 1);
    expect(next.commitId).toBe("retire-1");
    expect(next.suppression).toEqual(j.suppression);
    expect(parseJournal(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(withoutEntry(j, "nope", "x")).toBe(j);
  });
});
