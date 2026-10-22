import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { previewRun, workflowOutputId } from "@/lib/workflows";
import {
  ACK_RETENTION_MS,
  drainOne,
  FINISH_RETENTION_MS,
  OPEN_MAX,
  purgeAt,
  REGISTRATIONS_MAX,
  RUN_COMMITS_MAX,
  RUN_STALE_MAX,
  WorkflowCoordinator,
  type StepBuilder,
} from "./workflowCoordinator";
import { canonicalJson, sha256Hex, weekOf } from "./workflowProtocol";
import { runStep } from "./workflowRun";

// ⚙️ DT-7B workflow coordinator (planning/tools/38-cloud-workflows.md) over a real SQLite engine (node:sqlite, the
// dialect of a SQLite-backed Durable Object). A fresh coordinator per call over one database is a restart between
// every step. The builder here is TEST-ONLY and deterministic (the real executor is validation pending: the existing
// pure builders do not resolve under the Worker's pinned toolchain); it proves the store's atomic step transactions,
// never a functioning cloud runner. The workerd proof is workflowCoordinator.runtime.test.ts.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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
    transactionSync<T>(fn: () => T): T {
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

const T0 = Date.parse("2026-10-17T09:05:00.000Z");
const DAY = 86_400_000;
const AT = "2026-10-17T09:00:00.000Z";

function harness(db = new DatabaseSync(":memory:")) {
  const storage = sqliteStorage(db);
  const call = async (c: A): Promise<A> => {
    const co = new WorkflowCoordinator({ storage } as never);
    const res = await co.fetch(
      new Request("https://workflow-coordinator/", { method: "POST", body: JSON.stringify(c) }),
    );
    return (await res.json()) as A;
  };
  return { db, call };
}

const ownerOf = async (h: ReturnType<typeof harness>) =>
  (await h.call({ op: "authority", now: T0 })).ownerKey as string;

const I = (id: string) => ({ id, kind: "idea", text: { ar: "", en: `idea ${id}` } });
const S = (id: string) => ({
  id,
  kind: "post",
  platform: "tiktok",
  title: { ar: "", en: `post ${id}` },
  caption: { ar: "", en: "" },
  offsetDays: 1,
});
const P = (id: string) => ({
  id,
  kind: "plan",
  quest: "produce",
  skillId: "iphone-log-prores",
  minutes: 30,
  day: "lightest",
});

interface BodyOpts {
  id?: string;
  wf?: string;
  epoch?: number;
  rev?: number;
  actions?: A[];
  at?: string;
}
function body(owner: string, o: BodyOpts = {}): A {
  const at = o.at ?? AT;
  const day = new Date(Date.parse(at) + 3 * 3_600_000).toISOString().slice(0, 10);
  const actions = o.actions ?? [I("a1")];
  const plan = actions.some((a) => a.kind === "plan");
  return {
    occurrenceId: o.id ?? "m1",
    ownerKey: owner,
    workflowId: o.wf ?? "w1",
    kind: "manual",
    registrationEpoch: o.epoch ?? 1,
    revision: o.rev ?? 1,
    snapshot: { name: { ar: "", en: "Flow" }, trigger: { kind: "manual" }, actions },
    plannerContext: plan
      ? {
          targetWeek: weekOf(day),
          completions: [],
          planItems: [],
          settings: { gear: ["phone"], davinciEdition: "free" },
          contextAt: at,
        }
      : null,
    input: { title: { ar: "", en: "" }, summary: { ar: "", en: "" }, slug: "", lang: "en", day },
    executionAt: at,
  };
}
const digestOf = (b: A) => sha256Hex(canonicalJson(b));
const DIG = "e".repeat(64);

/** The TEST-ONLY deterministic builder; `stale` action ids fail with context-stale (a scheduled stale snapshot). */
const testBuilder =
  (stale: Set<string> = new Set()): StepBuilder =>
  ({ body: b, action }) => {
    const id = `wf:${b.occurrenceId}:${action.id}`;
    const at = b.executionAt;
    if (stale.has(action.id)) return { error: "context-stale" };
    if (action.kind === "idea")
      return { record: { id, text: `idea ${action.id}`, source: "workflow", createdAt: at } };
    if (action.kind === "post")
      return {
        record: {
          id,
          platform: action.platform,
          title: `post ${action.id}`,
          caption: "",
          hashtags: [],
          stage: "idea",
          plannedDay: b.input.day,
          plannedTime: null,
          script: { hook: "", beats: ["", "", ""], cta: "" },
          shots: [],
          createdAt: at,
          updatedAt: at,
        },
      };
    return {
      record: {
        id,
        week: b.plannerContext!.targetWeek,
        day: 0,
        skillId: action.skillId ?? b.input.skillId!,
        quest: action.quest,
        minutes: action.minutes,
        by: "me",
      },
    };
  };

async function setup(o: { actions?: A[]; id?: string } = {}) {
  const h = harness();
  const owner = await ownerOf(h);
  const reg = await h.call({
    op: "register",
    ownerKey: owner,
    workflowId: "w1",
    expectedEpoch: 0,
    revision: 1,
    workflowDigest: DIG,
    // DT-7B-R1 fixture correction (chronology): was `now: T0` (09:05), after the 09:00 executionAt of its
    // occurrence; now 08:55, so register → trigger is real. Assertions unchanged.
    now: T0 - 600_000,
  });
  const b = body(owner, { actions: o.actions, id: o.id });
  const sub = await h.call({ op: "submit", body: b, payloadDigest: await digestOf(b), now: T0 });
  return { h, owner, reg, b, sub };
}

const drain = async (
  h: ReturnType<typeof harness>,
  owner: string,
  id: string,
  build = testBuilder(),
  now = T0,
) =>
  (await drainOne(
    (c) => h.call(c),
    owner,
    id,
    build,
    () => now,
  )) as A;

const rows = (db: DatabaseSync, q: string) => db.prepare(q).all() as A[];

describe("authority", () => {
  it("ownerKey: minted once in durable meta, stable across restarts; another storage = another authority", async () => {
    const h = harness();
    const k1 = await ownerOf(h);
    expect(k1).toMatch(/^wfo_[0-9a-f]{32}$/);
    expect(await ownerOf(h)).toBe(k1);
    expect(await ownerOf(harness(h.db))).toBe(k1);
    expect(await ownerOf(harness())).not.toBe(k1);
  });

  it("a mismatched ownerKey is refused on every operation with zero mutation", async () => {
    const { h, owner, b } = await setup();
    const other = "wfo_" + "9".repeat(32);
    const before = rows(h.db, "SELECT * FROM occurrences");
    for (const c of [
      { op: "register", workflowId: "w2", expectedEpoch: 0, revision: 1, workflowDigest: DIG },
      { op: "pause", workflowId: "w1", registrationEpoch: 1, expectedRevision: 1 },
      { op: "status", occurrenceId: "m1" },
      { op: "cancel", occurrenceId: "m1" },
      { op: "ack", occurrenceId: "m1", receiptVersion: 1 },
      { op: "changes", after: 0, limit: 10 },
    ])
      expect(await h.call({ ...c, ownerKey: other, now: T0 })).toEqual({
        error: "authority_mismatch",
      });
    const foreign = { ...body(other, { id: "m2" }) };
    expect(
      await h.call({
        op: "submit",
        body: foreign,
        payloadDigest: await digestOf(foreign),
        now: T0,
      }),
    ).toEqual({ error: "authority_mismatch" });
    expect(rows(h.db, "SELECT * FROM occurrences")).toEqual(before);
    expect(rows(h.db, "SELECT workflow_id FROM registrations")).toEqual([{ workflow_id: "w1" }]);
    expect(b.ownerKey).toBe(owner);
  });
});

describe("registrations: idempotent register, epoch+revision CAS, closed-epoch cutoffs", () => {
  const reg = (h: ReturnType<typeof harness>, owner: string, over: A) =>
    h.call({
      op: "register",
      ownerKey: owner,
      workflowId: "w1",
      revision: 1,
      workflowDigest: DIG,
      now: T0,
      ...over,
    });

  it("lost register / re-register answers never mint another epoch", async () => {
    const h = harness();
    const owner = await ownerOf(h);
    const r1 = await reg(h, owner, { expectedEpoch: 0 });
    expect(r1).toMatchObject({
      created: true,
      registration: { registrationEpoch: 1, state: "active", paused: false },
    });
    expect(await reg(h, owner, { expectedEpoch: 0 })).toMatchObject({
      created: false,
      registration: { registrationEpoch: 1 },
    });
    const un = await h.call({
      op: "unregister",
      ownerKey: owner,
      workflowId: "w1",
      registrationEpoch: 1,
      expectedRevision: 1,
      now: T0 + 1000,
    });
    expect(un).toMatchObject({ changed: true, registration: { state: "unregistered" } });
    expect(un.registration.epochs).toEqual([
      {
        epoch: 1,
        openedAt: new Date(T0).toISOString(),
        closedAt: new Date(T0 + 1000).toISOString(),
      },
    ]);
    const r2 = await reg(h, owner, { expectedEpoch: 1, now: T0 + 2000 });
    expect(r2).toMatchObject({
      created: true,
      registration: { registrationEpoch: 2, state: "active" },
    });
    expect(await reg(h, owner, { expectedEpoch: 1, now: T0 + 3000 })).toMatchObject({
      created: false,
      registration: { registrationEpoch: 2 },
    });
    // A delayed first-registration replay cannot open a third epoch.
    expect(await reg(h, owner, { expectedEpoch: 0 })).toMatchObject({ error: "conflict" });
    expect(rows(h.db, "SELECT epoch FROM registration_epochs ORDER BY epoch")).toEqual([
      { epoch: 1 },
      { epoch: 2 },
    ]);
  });

  it("revision/epoch ABA: a delayed pre-unregister update or pause cannot touch the re-registration", async () => {
    const h = harness();
    const owner = await ownerOf(h);
    await reg(h, owner, { expectedEpoch: 0 });
    await h.call({
      op: "unregister",
      ownerKey: owner,
      workflowId: "w1",
      registrationEpoch: 1,
      expectedRevision: 1,
      now: T0,
    });
    await reg(h, owner, { expectedEpoch: 1 });
    const stale = await h.call({
      op: "update",
      ownerKey: owner,
      workflowId: "w1",
      registrationEpoch: 1,
      expectedRevision: 1,
      revision: 2,
      workflowDigest: "f".repeat(64),
      now: T0,
    });
    expect(stale).toMatchObject({
      error: "conflict",
      registration: { registrationEpoch: 2, revision: 1 },
    });
    expect(
      await h.call({
        op: "pause",
        ownerKey: owner,
        workflowId: "w1",
        registrationEpoch: 1,
        expectedRevision: 1,
        now: T0,
      }),
    ).toMatchObject({ error: "conflict" });
    // Stale expected revision (matrix 6), then the right CAS, then its lost-answer replay.
    expect(
      await h.call({
        op: "update",
        ownerKey: owner,
        workflowId: "w1",
        registrationEpoch: 2,
        expectedRevision: 0,
        revision: 2,
        workflowDigest: DIG,
        now: T0,
      }),
    ).toMatchObject({ error: "conflict", registration: { revision: 1 } });
    const ok = {
      op: "update",
      ownerKey: owner,
      workflowId: "w1",
      registrationEpoch: 2,
      expectedRevision: 1,
      revision: 2,
      workflowDigest: DIG,
      now: T0,
    };
    expect(await h.call(ok)).toMatchObject({ changed: true, registration: { revision: 2 } });
    expect(await h.call(ok)).toMatchObject({ changed: false, registration: { revision: 2 } });
    expect(await h.call({ ...ok, revision: 1 })).toMatchObject({ error: "conflict" });
    expect(
      await h.call({
        op: "update",
        ownerKey: owner,
        workflowId: "w9",
        registrationEpoch: 1,
        expectedRevision: 1,
        revision: 2,
        workflowDigest: DIG,
        now: T0,
      }),
    ).toEqual({ error: "not_registered", workflowId: "w9" });
  });

  it("admission: unknown epochs refused; closed epochs admit only executionAt ≤ cutoff, also after re-registration", async () => {
    const h = harness();
    const owner = await ownerOf(h);
    const cut = Date.parse("2026-10-17T10:00:00.000Z");
    await reg(h, owner, { expectedEpoch: 0 });
    await h.call({
      op: "unregister",
      ownerKey: owner,
      workflowId: "w1",
      registrationEpoch: 1,
      expectedRevision: 1,
      now: cut,
    });
    await reg(h, owner, { expectedEpoch: 1, now: cut + 60_000 });
    const now = cut + 3_600_000;
    const submit = async (o: BodyOpts) => {
      const b = body(owner, o);
      return h.call({ op: "submit", body: b, payloadDigest: await digestOf(b), now });
    };
    expect(await submit({ id: "e1a", epoch: 1, at: "2026-10-17T10:00:00.000Z" })).toMatchObject({
      created: true,
    });
    expect(await submit({ id: "e1b", epoch: 1, at: "2026-10-17T10:00:00.001Z" })).toEqual({
      error: "not_registered",
      workflowId: "w1",
    });
    expect(await submit({ id: "e3", epoch: 3, at: "2026-10-17T10:30:00.000Z" })).toEqual({
      error: "unknown_epoch",
      workflowId: "w1",
    });
    expect(await submit({ id: "e2", epoch: 2, at: "2026-10-17T10:30:00.000Z" })).toMatchObject({
      created: true,
    });
    expect(await submit({ id: "e2r", epoch: 2, rev: 2, at: "2026-10-17T10:30:00.000Z" })).toEqual({
      error: "registration_behind",
      workflowId: "w1",
    });
    expect(await submit({ id: "nw", wf: "w7", at: "2026-10-17T10:30:00.000Z" })).toEqual({
      error: "not_registered",
      workflowId: "w7",
    });
  });

  it("at most REGISTRATIONS_MAX workflows", async () => {
    const h = harness();
    const owner = await ownerOf(h);
    for (let n = 0; n < REGISTRATIONS_MAX; n++)
      expect(await reg(h, owner, { workflowId: `w${n}`, expectedEpoch: 0 })).toMatchObject({
        created: true,
      });
    expect(await reg(h, owner, { workflowId: "wx", expectedEpoch: 0 })).toEqual({
      error: "capacity",
    });
  });
});

describe("DT-7B-R1 admission interval: opened_at ≤ executionAt ≤ closed_at of the named epoch", () => {
  const R = Date.parse("2026-10-10T09:00:00.000Z");
  const GAP_END = R + 3 * DAY;
  const LATER = GAP_END + 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const counts = (db: DatabaseSync) => ({
    seq: rows(db, "SELECT value FROM meta WHERE key = 'change_seq'")[0].value,
    occ: rows(db, "SELECT COUNT(*) AS n FROM occurrences")[0].n,
    steps: rows(db, "SELECT COUNT(*) AS n FROM steps")[0].n,
    outputs: rows(db, "SELECT COUNT(*) AS n FROM outputs")[0].n,
  });
  const refused = { error: "not_registered", workflowId: "w1" };

  it("first registration, long local-only gap, delayed old epoch, both equal bounds; refusals mutate nothing; restart + replay", async () => {
    const h = harness();
    const owner = await ownerOf(h);
    const call = (c: A, now: number) => h.call({ ownerKey: owner, workflowId: "w1", ...c, now });
    await call({ op: "register", expectedEpoch: 0, revision: 1, workflowDigest: DIG }, R);
    const submit = async (o: BodyOpts, hh = h) => {
      const b = body(owner, o);
      return hh.call({ op: "submit", body: b, payloadDigest: await digestOf(b), now: LATER });
    };
    // First registration: a day-old event (and 1 ms before opening) is not cloud-owned; equality admits.
    const before = counts(h.db);
    expect(await submit({ id: "f-day", at: iso(R - DAY) })).toEqual(refused);
    expect(await submit({ id: "f-1ms", at: iso(R - 1) })).toEqual(refused);
    expect(counts(h.db)).toEqual(before);
    expect(await submit({ id: "f-open", at: iso(R) })).toMatchObject({ created: true });
    // Unregister an hour later, re-register after a three-day local-only gap.
    await call({ op: "unregister", registrationEpoch: 1, expectedRevision: 1 }, R + 3_600_000);
    await call({ op: "register", expectedEpoch: 1, revision: 1, workflowDigest: DIG }, GAP_END);
    const mid = counts(h.db);
    // A gap event naming the new epoch is refused; naming the old one too (after its cutoff).
    expect(await submit({ id: "g-new", epoch: 2, at: iso(R + DAY) })).toEqual(refused);
    expect(await submit({ id: "g-old", epoch: 1, at: iso(R + DAY) })).toEqual(refused);
    expect(await submit({ id: "e2-1ms", epoch: 2, at: iso(GAP_END - 1) })).toEqual(refused);
    expect(await submit({ id: "e1-cut1", epoch: 1, at: iso(R + 3_600_001) })).toEqual(refused);
    expect(counts(h.db)).toEqual(mid);
    // The delayed old-epoch event at its exact cutoff, after the later registration: admitted, epoch 1.
    const old = await submit({ id: "e1-cut", epoch: 1, at: iso(R + 3_600_000) });
    expect(old).toMatchObject({ created: true, occurrence: { registrationEpoch: 1 } });
    const fresh = await submit({ id: "e2-open", epoch: 2, at: iso(GAP_END) });
    expect(fresh).toMatchObject({ created: true, occurrence: { registrationEpoch: 2 } });
    // Restart: identical replays stay created:false (the row is checked before the interval); refusals stay.
    const again = harness(h.db);
    const replay = await submit({ id: "e1-cut", epoch: 1, at: iso(R + 3_600_000) }, again);
    expect(replay).toEqual({ ...old, created: false });
    expect(await submit({ id: "g-new", epoch: 2, at: iso(R + DAY) }, again)).toEqual(refused);
    const feed = await again.call({
      op: "changes",
      ownerKey: owner,
      after: 0,
      limit: 50,
      now: LATER,
    });
    expect(feed.items.map((i: A) => i.occurrenceId)).toEqual(["f-open", "e1-cut", "e2-open"]);
    for (const id of ["f-day", "f-1ms", "g-new", "g-old", "e2-1ms", "e1-cut1"])
      expect(
        (await again.call({ op: "status", ownerKey: owner, occurrenceId: id, now: LATER })).state,
      ).toBe("absent");
  });

  it("idempotent replay of an accepted occurrence; unknown epoch, revision checks remain, the interval comes first", async () => {
    const h = harness();
    const owner = await ownerOf(h);
    await h.call({
      op: "register",
      ownerKey: owner,
      workflowId: "w1",
      expectedEpoch: 0,
      revision: 1,
      workflowDigest: DIG,
      now: R,
    });
    const send = async (o: BodyOpts) => {
      const b = body(owner, o);
      return h.call({ op: "submit", body: b, payloadDigest: await digestOf(b), now: LATER });
    };
    expect(await send({ id: "u9", epoch: 9, at: iso(R - DAY) })).toEqual({
      error: "unknown_epoch",
      workflowId: "w1",
    });
    expect(await send({ id: "rb", rev: 2, at: iso(R + 1) })).toEqual({
      error: "registration_behind",
      workflowId: "w1",
    });
    expect(await send({ id: "rb0", rev: 2, at: iso(R - 1) })).toEqual(refused);
    const ok = await send({ id: "ok", at: iso(R + 1) });
    expect(ok.created).toBe(true);
    expect(await send({ id: "ok", at: iso(R + 1) })).toEqual({ ...ok, created: false });
  });
});

describe("immutable occurrences", () => {
  it("same id + same digest → existing row, no seq bump; another digest → conflict, row unchanged (matrix 1, 2)", async () => {
    const { h, owner, b, sub } = await setup();
    expect(sub).toMatchObject({
      created: true,
      occurrence: { state: "pending", receiptVersion: 1, changeSeq: 1 },
    });
    expect(sub.occurrence.body).toEqual(b);
    expect(sub.occurrence.payloadDigest).toBe(await digestOf(b));
    const again = await h.call({
      op: "submit",
      body: b,
      payloadDigest: await digestOf(b),
      now: T0 + 5000,
    });
    expect(again).toEqual({ ...sub, created: false });
    const changed = { ...b, snapshot: { ...b.snapshot, actions: [I("zz")] } };
    expect(
      await h.call({
        op: "submit",
        body: changed,
        payloadDigest: await digestOf(changed),
        now: T0,
      }),
    ).toEqual({ error: "conflict", occurrenceId: "m1" });
    expect(
      (await h.call({ op: "status", ownerKey: owner, occurrenceId: "m1", now: T0 })).occurrence,
    ).toEqual(sub.occurrence);
  });

  it("the server recomputes the digest: an asserted digest of other content is refused", async () => {
    const { h, owner } = await setup();
    const b = body(owner, { id: "m2" });
    const other = body(owner, { id: "m2", actions: [I("b1")] });
    expect(
      await h.call({ op: "submit", body: b, payloadDigest: await digestOf(other), now: T0 }),
    ).toEqual({ error: "digest_mismatch" });
    expect(await h.call({ op: "status", ownerKey: owner, occurrenceId: "m2", now: T0 })).toEqual({
      ownerKey: owner,
      occurrenceId: "m2",
      state: "absent",
    });
  });

  it("privacy canaries and malformed bodies are refused and never stored (matrix 25)", async () => {
    const { h, owner } = await setup();
    const canary = { ...body(owner, { id: "m3" }), inbox: [{ text: "secret DM" }] };
    expect(
      await h.call({ op: "submit", body: canary, payloadDigest: await digestOf(canary), now: T0 }),
    ).toEqual({ error: "bad_request" });
    const colon = body(owner, { id: "m:3" });
    expect(
      await h.call({ op: "submit", body: colon, payloadDigest: await digestOf(colon), now: T0 }),
    ).toEqual({ error: "unsupported_id" });
    expect(JSON.stringify(rows(h.db, "SELECT * FROM occurrences"))).not.toContain("secret DM");
  });

  it("delayed old revision after the registration CAS keeps its own snapshot (matrix 5)", async () => {
    const { h, owner } = await setup();
    await h.call({
      op: "update",
      ownerKey: owner,
      workflowId: "w1",
      registrationEpoch: 1,
      expectedRevision: 1,
      revision: 2,
      workflowDigest: "f".repeat(64),
      now: T0,
    });
    const old = body(owner, { id: "old", rev: 1, actions: [I("r1")] });
    const sub = await h.call({
      op: "submit",
      body: old,
      payloadDigest: await digestOf(old),
      now: T0,
    });
    expect(sub).toMatchObject({ created: true, occurrence: { revision: 1 } });
    const done = await drain(h, owner, "old");
    expect(done.occurrence.state).toBe("done");
    expect(done.occurrence.body).toEqual(old);
    expect(done.occurrence.outputs.map((o: A) => o.outputId)).toEqual(["wf:old:r1"]);
  });

  it("capacity: 500 non-terminal occurrences → capacity, none evicted; a resend of an existing one still answers", async () => {
    const { h, owner, b } = await setup();
    for (let n = 1; n < OPEN_MAX; n++) {
      const x = body(owner, { id: `c${n}` });
      expect(
        (await h.call({ op: "submit", body: x, payloadDigest: await digestOf(x), now: T0 }))
          .created,
      ).toBe(true);
    }
    const over = body(owner, { id: "over" });
    expect(
      await h.call({ op: "submit", body: over, payloadDigest: await digestOf(over), now: T0 }),
    ).toEqual({ error: "capacity" });
    expect(
      (await h.call({ op: "submit", body: b, payloadDigest: await digestOf(b), now: T0 })).created,
    ).toBe(false);
    expect(rows(h.db, "SELECT COUNT(*) AS n FROM occurrences")[0].n).toBe(OPEN_MAX);
    // A finished one frees a slot.
    await drain(h, owner, "m1");
    expect(
      (await h.call({ op: "submit", body: over, payloadDigest: await digestOf(over), now: T0 }))
        .created,
    ).toBe(true);
  }, 60_000);

  it("pre-existing storage is never assumed empty: rows, tombstones and the sequence continue (matrix 31)", async () => {
    const { h, owner } = await setup();
    h.db.exec("UPDATE meta SET value = '1000' WHERE key = 'change_seq'");
    h.db.exec(
      "INSERT INTO tombstones (occurrence_id, payload_digest, pruned_at) VALUES ('gone', '" +
        "a".repeat(64) +
        "', 1)",
    );
    const before = rows(h.db, "SELECT * FROM occurrences");
    const b = body(owner, { id: "m9" });
    expect(
      (await h.call({ op: "submit", body: b, payloadDigest: await digestOf(b), now: T0 }))
        .occurrence.changeSeq,
    ).toBe(1001);
    expect(rows(h.db, "SELECT * FROM occurrences WHERE occurrence_id = 'm1'")).toEqual(before);
    const g = body(owner, { id: "gone" });
    expect(
      await h.call({ op: "submit", body: g, payloadDigest: await digestOf(g), now: T0 }),
    ).toEqual({
      error: "pruned",
      occurrenceId: "gone",
      payloadDigest: "a".repeat(64),
      prunedAt: new Date(1).toISOString(),
    });
  });
});

describe("transactional steps (test-only builder)", () => {
  it("drain: one output per action, monotonic receipt versions and change sequences", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), P("p1"), S("s1")] });
    const done = await drain(h, owner, "m1");
    const o = done.occurrence;
    expect(o.state).toBe("done");
    expect(o.receiptVersion).toBe(5); // submit 1, three steps, finish
    expect(o.changeSeq).toBe(5);
    expect(o.steps.map((s: A) => s.status)).toEqual(["done", "done", "done"]);
    expect(o.outputs.map((x: A) => [x.outputId, x.kind])).toEqual([
      ["wf:m1:a1", "idea"],
      ["wf:m1:p1", "plan"],
      ["wf:m1:s1", "post"],
    ]);
    for (const x of o.outputs) expect(x.digest).toBe(await sha256Hex(canonicalJson(x.record)));
    expect(o.startedAt).toBeDefined();
    expect(o.finishedAt).toBeDefined();
  });

  it("a step needs the next pending index, all prior steps done, the current version and the captured digest", async () => {
    const { h, owner, sub } = await setup({ actions: [I("a1"), I("a2")] });
    const o = sub.occurrence;
    const rec = (id: string) => ({
      record: { id: `wf:m1:${id}`, text: "x", source: "workflow", createdAt: AT },
    });
    const step = (idx: number, out: A, v = o.receiptVersion, d = o.payloadDigest) =>
      h.call({
        op: "commitStep",
        ownerKey: owner,
        occurrenceId: "m1",
        idx,
        receiptVersion: v,
        payloadDigest: d,
        output: out,
        now: T0,
      });
    expect((await step(1, rec("a2"))).error).toBe("stale");
    expect((await step(0, rec("a1"), 1, "0".repeat(64))).error).toBe("stale");
    expect((await step(0, rec("a2"))).error).toBe("bad_request"); // another action's id
    expect((await step(0, { record: { ...rec("a1").record, token: "x" } })).error).toBe(
      "bad_request",
    );
    expect((await step(0, { error: "output-conflict" })).error).toBe("bad_request"); // the store's own code
    const s0 = await step(0, rec("a1"));
    expect(s0).toMatchObject({
      committed: true,
      occurrence: { state: "running", receiptVersion: 2 },
    });
    // The lost answer: the same commit again is stale and the caller adopts the stored row.
    const lost = await step(0, rec("a1"));
    expect(lost.error).toBe("stale");
    expect(lost.occurrence).toEqual(s0.occurrence);
    expect(
      (await h.call({ op: "finish", ownerKey: owner, occurrenceId: "m1", now: T0 })).error,
    ).toBe("steps_pending");
  });

  it("an existing output with another tuple/digest fails the step (output-conflict) and skips the rest (matrix 13)", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), I("a2"), I("a3")] });
    h.db.exec(
      `INSERT INTO outputs (output_id, occurrence_id, action_id, kind, record_json, digest, created_at)
       VALUES ('wf:m1:a2', 'm1', 'a2', 'idea', '{}', '${"c".repeat(64)}', 1)`,
    );
    const done = await drain(h, owner, "m1");
    expect(done.occurrence.state).toBe("partial");
    expect(done.occurrence.steps.map((s: A) => [s.status, s.error ?? null])).toEqual([
      ["done", null],
      ["failed", "output-conflict"],
      ["skipped", null],
    ]);
    expect(rows(h.db, "SELECT digest FROM outputs WHERE output_id = 'wf:m1:a2'")[0].digest).toBe(
      "c".repeat(64),
    );
  });

  it("an identical existing output is adopted, never rebuilt (matrix 10)", async () => {
    const { h, owner } = await setup({ actions: [I("a1")] });
    const record = { id: "wf:m1:a1", text: "idea a1", source: "workflow", createdAt: AT };
    const d = await sha256Hex(canonicalJson(record));
    h.db.exec(
      `INSERT INTO outputs (output_id, occurrence_id, action_id, kind, record_json, digest, created_at)
       VALUES ('wf:m1:a1', 'm1', 'a1', 'idea', '${JSON.stringify(record)}', '${d}', 1)`,
    );
    const done = await drain(h, owner, "m1");
    expect(done.occurrence.state).toBe("done");
    expect(done.occurrence.steps[0]).toMatchObject({ status: "done", outputDigest: d });
  });

  it("fail-fast: [idea, stale plan, post] keeps the idea, skips the post → partial", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), P("p1"), S("s1")] });
    const done = await drain(h, owner, "m1", testBuilder(new Set(["p1"])));
    expect(done.occurrence.state).toBe("partial");
    expect(done.occurrence.steps.map((s: A) => [s.status, s.error ?? null])).toEqual([
      ["done", null],
      ["failed", "context-stale"],
      ["skipped", null],
    ]);
    expect(done.occurrence.outputs.map((x: A) => x.outputId)).toEqual(["wf:m1:a1"]);
  });

  it("fail-fast: [stale plan, idea] produces no idea → failed", async () => {
    const { h, owner } = await setup({ actions: [P("p1"), I("a1")] });
    const done = await drain(h, owner, "m1", testBuilder(new Set(["p1"])));
    expect(done.occurrence.state).toBe("failed");
    expect(done.occurrence.steps.map((s: A) => s.status)).toEqual(["failed", "skipped"]);
    expect(done.occurrence.outputs).toEqual([]);
    expect(rows(h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(0);
  });

  it("two concurrent drains: each step committed once; the terminal row is identical (matrix 11, 12)", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), I("a2"), I("a3")] });
    const [x, y] = await Promise.all([drain(h, owner, "m1"), drain(h, owner, "m1")]);
    expect(x.occurrence).toEqual(y.occurrence);
    expect(x.occurrence.state).toBe("done");
    expect(x.occurrence.receiptVersion).toBe(5);
    expect(rows(h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(3);
    // A stale executor after finish changes nothing.
    const late = await h.call({
      op: "commitStep",
      ownerKey: owner,
      occurrenceId: "m1",
      idx: 2,
      receiptVersion: 3,
      payloadDigest: x.occurrence.payloadDigest,
      output: { error: "invalid" },
      now: T0,
    });
    expect(late.error).toBe("stale");
    expect(
      await h.call({ op: "finish", ownerKey: owner, occurrenceId: "m1", now: T0 + DAY }),
    ).toEqual({ ownerKey: owner, occurrence: x.occurrence, finished: false });
  });
});

describe("pause, resume, unregister", () => {
  const ctl = (h: ReturnType<typeof harness>, owner: string, op: string, epoch = 1, rev = 1) =>
    h.call({
      op,
      ownerKey: owner,
      workflowId: "w1",
      registrationEpoch: epoch,
      expectedRevision: rev,
      now: T0,
    });

  it("paused: submit stays pending, the first step is refused in its transaction; resume releases it", async () => {
    const { h, owner, b } = await setup({ id: "m0" });
    expect(await ctl(h, owner, "pause")).toMatchObject({
      changed: true,
      registration: { paused: true },
    });
    const p = body(owner, { id: "m1" });
    expect(
      (await h.call({ op: "submit", body: p, payloadDigest: await digestOf(p), now: T0 }))
        .occurrence.state,
    ).toBe("pending");
    const r = await drain(h, owner, "m1");
    expect(r).toMatchObject({
      error: "paused",
      occurrence: { state: "pending", receiptVersion: 1 },
    });
    expect((await drain(h, owner, "m0")).error).toBe("paused");
    expect(b.occurrenceId).toBe("m0");
    await ctl(h, owner, "resume");
    expect((await drain(h, owner, "m1")).occurrence.state).toBe("done");
  });

  it("an already running occurrence finishes while paused", async () => {
    const { h, owner, sub } = await setup({ actions: [I("a1"), I("a2")] });
    const o = sub.occurrence;
    await h.call({
      op: "commitStep",
      ownerKey: owner,
      occurrenceId: "m1",
      idx: 0,
      receiptVersion: 1,
      payloadDigest: o.payloadDigest,
      output: testBuilder()({
        body: o.body,
        idx: 0,
        action: o.body.snapshot.actions[0],
        prior: [],
      }),
      now: T0,
    });
    await ctl(h, owner, "pause");
    expect((await drain(h, owner, "m1")).occurrence.state).toBe("done");
  });

  it("unregister neither cancels nor moves pending work (matrix 8); the retained pause gates old epochs after re-register", async () => {
    const { h, owner } = await setup();
    await ctl(h, owner, "pause");
    expect(await ctl(h, owner, "unregister")).toMatchObject({
      registration: { state: "unregistered", paused: true },
    });
    expect(
      (await h.call({ op: "status", ownerKey: owner, occurrenceId: "m1", now: T0 })).occurrence
        .state,
    ).toBe("pending");
    const re = await h.call({
      op: "register",
      ownerKey: owner,
      workflowId: "w1",
      expectedEpoch: 1,
      revision: 1,
      workflowDigest: DIG,
      now: T0 + 1,
    });
    expect(re.registration).toMatchObject({ registrationEpoch: 2, paused: true });
    expect((await drain(h, owner, "m1")).error).toBe("paused"); // delayed epoch-1 work
    await ctl(h, owner, "resume", 2);
    expect((await drain(h, owner, "m1")).occurrence.state).toBe("done");
  });
});

describe("cancel", () => {
  it("pending (also paused) → cancelled with a seq bump and no outputs; running → running (matrix 15, 16)", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), I("a2")] });
    const b2 = body(owner, { id: "m2", actions: [I("a1"), I("a2")] });
    await h.call({ op: "submit", body: b2, payloadDigest: await digestOf(b2), now: T0 });
    const c = await h.call({ op: "cancel", ownerKey: owner, occurrenceId: "m1", now: T0 });
    expect(c).toMatchObject({
      cancelled: true,
      occurrence: { state: "cancelled", receiptVersion: 2, changeSeq: 3, outputs: [] },
    });
    expect(c.occurrence.steps.map((s: A) => s.status)).toEqual(["skipped", "skipped"]);
    expect(await h.call({ op: "cancel", ownerKey: owner, occurrenceId: "m1", now: T0 })).toEqual({
      ...c,
      cancelled: false,
    });
    const s = (await h.call({ op: "status", ownerKey: owner, occurrenceId: "m2", now: T0 }))
      .occurrence;
    await h.call({
      op: "commitStep",
      ownerKey: owner,
      occurrenceId: "m2",
      idx: 0,
      receiptVersion: 1,
      payloadDigest: s.payloadDigest,
      output: { record: { id: "wf:m2:a1", text: "x", source: "workflow", createdAt: AT } },
      now: T0,
    });
    expect(await h.call({ op: "cancel", ownerKey: owner, occurrenceId: "m2", now: T0 })).toEqual({
      error: "running",
      occurrenceId: "m2",
    });
    expect(await h.call({ op: "cancel", ownerKey: owner, occurrenceId: "nope", now: T0 })).toEqual({
      error: "absent",
      occurrenceId: "nope",
    });
  });
});

describe("latest-receipt change feed", () => {
  it("O1 created first, O2 finishes first, O1 later: O1 comes back after the cursor (matrix 17)", async () => {
    const { h, owner } = await setup({ id: "o1" });
    const b2 = body(owner, { id: "o2" });
    await h.call({ op: "submit", body: b2, payloadDigest: await digestOf(b2), now: T0 });
    await drain(h, owner, "o2");
    const p1 = await h.call({ op: "changes", ownerKey: owner, after: 0, limit: 50, now: T0 });
    expect(p1.items.map((i: A) => [i.occurrenceId, i.state])).toEqual([
      ["o1", "pending"],
      ["o2", "done"],
    ]);
    expect(p1.items[1].outputs.map((o: A) => o.outputId)).toEqual(["wf:o2:a1"]);
    expect(p1.items[0].outputs).toBeUndefined();
    await drain(h, owner, "o1");
    const p2 = await h.call({
      op: "changes",
      ownerKey: owner,
      after: p1.nextAfter,
      limit: 50,
      now: T0,
    });
    expect(p2.items.map((i: A) => [i.occurrenceId, i.state])).toEqual([["o1", "done"]]);
    expect(p2.items[0].changeSeq).toBeGreaterThan(p1.nextAfter);
    expect(p2.more).toBe(false);
  });

  it("120 rows, limit 50: 3 pages, equal timestamps ordered by seq, none missed or duplicated (matrix 18, 19)", async () => {
    const { h, owner } = await setup({ id: "r0" });
    for (let n = 1; n < 120; n++) {
      const x = body(owner, { id: `r${n}` });
      await h.call({ op: "submit", body: x, payloadDigest: await digestOf(x), now: T0 });
    }
    const seen: string[] = [];
    let after = 0;
    const pages: A[] = [];
    for (;;) {
      const p = await h.call({ op: "changes", ownerKey: owner, after, limit: 50, now: T0 });
      pages.push(p);
      seen.push(...p.items.map((i: A) => i.occurrenceId));
      expect(p.nextAfter).toBe(p.items.length ? p.items.at(-1).changeSeq : after);
      after = p.nextAfter;
      if (!p.more) break;
    }
    expect(pages.map((p) => p.items.length)).toEqual([50, 50, 20]);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, n) => `r${n}`));
    const empty = await h.call({ op: "changes", ownerKey: owner, after, limit: 50, now: T0 });
    expect(empty).toEqual({ ownerKey: owner, items: [], nextAfter: after, more: false });
  });

  it("a row mutated between pages appears on a later page with its new seq (matrix 20)", async () => {
    const { h, owner } = await setup({ id: "q0" });
    for (const id of ["q1", "q2", "q3"]) {
      const x = body(owner, { id });
      await h.call({ op: "submit", body: x, payloadDigest: await digestOf(x), now: T0 });
    }
    const p1 = await h.call({ op: "changes", ownerKey: owner, after: 0, limit: 2, now: T0 });
    expect(p1.items.map((i: A) => i.occurrenceId)).toEqual(["q0", "q1"]);
    expect(p1.more).toBe(true);
    await h.call({ op: "cancel", ownerKey: owner, occurrenceId: "q0", now: T0 });
    const p2 = await h.call({
      op: "changes",
      ownerKey: owner,
      after: p1.nextAfter,
      limit: 2,
      now: T0,
    });
    const p3 = await h.call({
      op: "changes",
      ownerKey: owner,
      after: p2.nextAfter,
      limit: 2,
      now: T0,
    });
    expect([...p2.items, ...p3.items].map((i: A) => [i.occurrenceId, i.state])).toEqual([
      ["q2", "pending"],
      ["q3", "pending"],
      ["q0", "cancelled"],
    ]);
    expect(await h.call({ op: "changes", ownerKey: owner, after: 0, limit: 51, now: T0 })).toEqual({
      error: "bad_request",
    });
  });
});

describe("acknowledgement and retention", () => {
  it("only the exact current terminal version acknowledges; firstAckAt never moves; ack never bumps the feed", async () => {
    const { h, owner } = await setup();
    const ack = (v: number, now = T0) =>
      h.call({ op: "ack", ownerKey: owner, occurrenceId: "m1", receiptVersion: v, now });
    expect(await ack(1)).toEqual({
      error: "not_terminal",
      occurrenceId: "m1",
      state: "pending",
      receiptVersion: 1,
    });
    const done = (await drain(h, owner, "m1")).occurrence;
    const v = done.receiptVersion;
    expect(await ack(v + 1)).toEqual({
      error: "future_version",
      occurrenceId: "m1",
      receiptVersion: v,
    });
    const before = await h.call({ op: "changes", ownerKey: owner, after: 0, limit: 50, now: T0 });
    const t1 = T0 + 10_000;
    const a1 = await ack(v, t1);
    expect(a1).toEqual({
      ownerKey: owner,
      occurrenceId: "m1",
      acknowledged: true,
      receiptVersion: v,
      ackedVersion: v,
      firstAckAt: new Date(t1).toISOString(),
      purgeAt: new Date(purgeAt(Date.parse(done.finishedAt), t1)).toISOString(),
    });
    // Identical repeat (also after a restart): same proof, firstAckAt unchanged.
    expect(
      await harness(h.db).call({
        op: "ack",
        ownerKey: owner,
        occurrenceId: "m1",
        receiptVersion: v,
        now: t1 + DAY,
      }),
    ).toEqual(a1);
    // Lower: a no-op that proves nothing new.
    expect(await ack(1, t1 + 2 * DAY)).toEqual({ ...a1, acknowledged: false });
    expect(await h.call({ op: "changes", ownerKey: owner, after: 0, limit: 50, now: T0 })).toEqual(
      before,
    );
    expect(
      await h.call({ op: "ack", ownerKey: owner, occurrenceId: "zz", receiptVersion: 1, now: T0 }),
    ).toEqual({ error: "absent", occurrenceId: "zz" });
  });

  it("purgeAt: min(finished + 180 d, firstAck + 90 d) when acknowledged, else finished + 180 d", () => {
    const f = T0;
    expect(FINISH_RETENTION_MS).toBe(180 * DAY);
    expect(ACK_RETENTION_MS).toBe(90 * DAY);
    expect(purgeAt(f, null)).toBe(f + 180 * DAY);
    expect(purgeAt(f, f + DAY)).toBe(f + 91 * DAY);
    expect(purgeAt(f, f + 120 * DAY)).toBe(f + 180 * DAY);
  });

  /** A finished occurrence (acknowledged at `ackAfter` ms after finishing, when given), then one probe at `probe`. */
  async function retained(ackAfter: number | null, probe: (finished: number) => number) {
    const { h, owner } = await setup();
    const done = (await drain(h, owner, "m1")).occurrence;
    const finished = Date.parse(done.finishedAt);
    if (ackAfter !== null)
      await h.call({
        op: "ack",
        ownerKey: owner,
        occurrenceId: "m1",
        receiptVersion: done.receiptVersion,
        now: finished + ackAfter,
      });
    const s = await h.call({
      op: "status",
      ownerKey: owner,
      occurrenceId: "m1",
      now: probe(finished),
    });
    return { h, owner, done, s };
  }

  it("retention boundaries: kept 1 ms before the deadline, tombstoned at it (unacknowledged, early ack, late ack)", async () => {
    for (const [ack, deadline] of [
      [null, 180 * DAY],
      [DAY, 91 * DAY],
      [120 * DAY, 180 * DAY],
    ] as const) {
      const kept = await retained(ack, (f) => f + deadline - 1);
      expect(kept.s.occurrence.state).toBe("done");
      const gone = await retained(ack, (f) => f + deadline);
      expect(gone.s).toEqual({
        ownerKey: gone.owner,
        occurrenceId: "m1",
        state: "pruned",
        payloadDigest: gone.done.payloadDigest,
        prunedAt: new Date(Date.parse(gone.done.finishedAt) + deadline).toISOString(),
      });
      expect(rows(gone.h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(0);
      expect(rows(gone.h.db, "SELECT COUNT(*) AS n FROM steps")[0].n).toBe(0);
    }
  });

  it("tombstones are permanent: resubmit, ack and cancel of a pruned id answer pruned; nonterminal work is never purged", async () => {
    const { h, owner, done } = await retained(null, (f) => f + 181 * DAY);
    const late = T0 + 400 * DAY;
    const b = body(owner);
    expect(
      await h.call({ op: "submit", body: b, payloadDigest: await digestOf(b), now: late }),
    ).toMatchObject({ error: "pruned", occurrenceId: "m1", payloadDigest: done.payloadDigest });
    expect(
      await h.call({
        op: "ack",
        ownerKey: owner,
        occurrenceId: "m1",
        receiptVersion: done.receiptVersion,
        now: late,
      }),
    ).toMatchObject({ error: "pruned" });
    expect(
      await h.call({ op: "cancel", ownerKey: owner, occurrenceId: "m1", now: late }),
    ).toMatchObject({ error: "pruned" });
    // Pending work, 1000 days on: still there.
    const p = body(owner, { id: "p1", at: "2026-10-17T09:00:00.000Z" });
    await h.call({ op: "submit", body: p, payloadDigest: await digestOf(p), now: T0 });
    expect(
      (await h.call({ op: "status", ownerKey: owner, occurrenceId: "p1", now: T0 + 1000 * DAY }))
        .occurrence.state,
    ).toBe("pending");
  });
});

/* ---------- DT-7B-2: the run op drives the REAL adapter (lib/workflows buildOutput) inside the coordinator ---------- */

describe("DT-7B-2 run: the fixed server builder inside the object, bounded, CAS-committed", () => {
  const runOf = (h: ReturnType<typeof harness>, owner: string, id = "m1", now = T0) =>
    h.call({ op: "run", ownerKey: owner, occurrenceId: id, now });
  const statusOf = async (h: ReturnType<typeof harness>, owner: string, id = "m1") =>
    (await h.call({ op: "status", ownerKey: owner, occurrenceId: id, now: T0 })).occurrence as A;
  const seq = (h: ReturnType<typeof harness>) =>
    Number(rows(h.db, "SELECT value FROM meta WHERE key = 'change_seq'")[0].value);
  /** The app's own dry run (lib/workflows previewRun) over the stored body, ids mapped to the occurrence. */
  const expected = (b: A) => {
    const pc = b.plannerContext;
    const { outputs } = previewRun(
      { ...b.snapshot } as never,
      b.input,
      {
        completions: pc?.completions ?? [],
        planItems: pc?.planItems ?? [],
        settings: pc?.settings ?? { gear: [], davinciEdition: "free" },
      } as never,
      new Date(b.executionAt),
    );
    return outputs.flatMap((s) =>
      s.ok
        ? [canonicalJson({ ...s.record, id: workflowOutputId(b.occurrenceId, s.actionId) })]
        : [],
    );
  };
  /** One step committed outside `run` with the adapter's own output (a crash/restart between steps). */
  const commitOne = async (h: ReturnType<typeof harness>, owner: string, id = "m1") => {
    const o = await statusOf(h, owner, id);
    const idx = o.steps.findIndex((s: A) => s.status === "pending");
    const output = await runStep({
      body: o.body,
      idx,
      action: o.body.snapshot.actions[idx],
      prior: o.outputs,
    });
    return h.call({
      op: "commitStep",
      ownerKey: owner,
      occurrenceId: id,
      idx,
      receiptVersion: o.receiptVersion,
      payloadDigest: o.payloadDigest,
      output,
      now: T0,
    });
  };

  it("one call builds every step with the real builders and finishes: outputs byte-equal to previewRun", async () => {
    const { h, owner, b } = await setup({ actions: [I("a1"), P("p1"), S("s1"), P("p2")] });
    const r = await runOf(h, owner);
    expect(Object.keys(r).sort()).toEqual(["committed", "occurrence", "ownerKey", "stopped"]);
    expect(r).toMatchObject({
      ownerKey: owner,
      committed: 4,
      stopped: "terminal",
      occurrence: { state: "done", receiptVersion: 6, changeSeq: 6 },
    });
    expect(r.occurrence.outputs.map((x: A) => canonicalJson(x.record))).toEqual(expected(b));
    expect(r.occurrence.outputs.map((x: A) => x.outputId)).toEqual([
      "wf:m1:a1",
      "wf:m1:p1",
      "wf:m1:s1",
      "wf:m1:p2",
    ]);
    // Stored bytes are the builder record's canonical JSON, digests recomputed.
    for (const x of rows(h.db, "SELECT record_json, digest FROM outputs ORDER BY output_id"))
      expect(x.digest).toBe(await sha256Hex(x.record_json));
    expect(r.occurrence.outputs[1].record.week).toBe(b.plannerContext.targetWeek);
  });

  it("terminal replay and lost answers: the same receipt, committed 0, no sequence or output change", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), S("s1")] });
    const first = await runOf(h, owner);
    const before = rows(h.db, "SELECT * FROM outputs ORDER BY output_id");
    const s = seq(h);
    for (const now of [T0, T0 + DAY]) {
      const again = await runOf(h, owner, "m1", now);
      expect(again).toEqual({ ...first, committed: 0 });
    }
    expect(seq(h)).toBe(s);
    expect(rows(h.db, "SELECT * FROM outputs ORDER BY output_id")).toEqual(before);
  });

  it("restart between steps and before finish: committed outputs are adopted, never rebuilt or overwritten", async () => {
    const { h, owner, b } = await setup({ actions: [I("a1"), P("p1"), I("a2")] });
    expect((await commitOne(h, owner)).committed).toBe(true);
    const held = rows(h.db, "SELECT * FROM outputs WHERE output_id = 'wf:m1:a1'")[0];
    // A fresh object per call (harness) = a restart; the run resumes at the next pending step.
    const r = await runOf(h, owner, "m1", T0 + 60_000);
    expect(r).toMatchObject({ committed: 2, stopped: "terminal", occurrence: { state: "done" } });
    expect(rows(h.db, "SELECT * FROM outputs WHERE output_id = 'wf:m1:a1'")[0]).toEqual(held);
    expect(r.occurrence.outputs.map((x: A) => canonicalJson(x.record))).toEqual(expected(b));
    // Every step committed, the finish lost: run only finishes.
    const two = await setup({ actions: [I("a1"), I("a2")], id: "m2" });
    await commitOne(two.h, two.owner, "m2");
    await commitOne(two.h, two.owner, "m2");
    const fin = await runOf(two.h, two.owner, "m2");
    expect(fin).toMatchObject({ committed: 0, stopped: "terminal", occurrence: { state: "done" } });
    expect(fin.occurrence.receiptVersion).toBe(4);
  });

  it("fail-fast through the real builders: [idea, unknown-skill plan, post] → partial; [no-skill plan, idea] → failed", async () => {
    const one = await setup({
      actions: [I("a1"), { ...P("p1"), skillId: "no-such-skill" }, S("s1")],
    });
    const a = await runOf(one.h, one.owner);
    expect(a).toMatchObject({
      committed: 2,
      stopped: "terminal",
      occurrence: { state: "partial" },
    });
    expect(a.occurrence.steps.map((s: A) => [s.status, s.error ?? null])).toEqual([
      ["done", null],
      ["failed", "unknown-skill"],
      ["skipped", null],
    ]);
    expect(a.occurrence.outputs.map((x: A) => canonicalJson(x.record))).toEqual(
      expected(one.b).slice(0, 1),
    );
    const { skillId: _drop, ...plain } = P("p1");
    void _drop;
    const two = await setup({ actions: [plain, I("a1")] });
    const f = await runOf(two.h, two.owner);
    expect(f).toMatchObject({ committed: 1, stopped: "terminal", occurrence: { state: "failed" } });
    expect(f.occurrence.steps.map((s: A) => [s.status, s.error ?? null])).toEqual([
      ["failed", "no-skill"],
      ["skipped", null],
    ]);
    expect(rows(two.h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(0);
  });

  it("pause blocks the first step atomically; resume runs it; a running occurrence finishes while paused", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), I("a2")] });
    const ctl = (op: string) =>
      h.call({
        op,
        ownerKey: owner,
        workflowId: "w1",
        registrationEpoch: 1,
        expectedRevision: 1,
        now: T0,
      });
    await ctl("pause");
    const pending = await statusOf(h, owner);
    const s = seq(h);
    expect(await runOf(h, owner)).toEqual({
      ownerKey: owner,
      occurrence: pending,
      committed: 0,
      stopped: "paused",
    });
    expect(seq(h)).toBe(s);
    await ctl("resume");
    expect((await commitOne(h, owner)).committed).toBe(true);
    await ctl("pause");
    expect(await runOf(h, owner)).toMatchObject({
      committed: 1,
      stopped: "terminal",
      occurrence: { state: "done" },
    });
  });

  it("pending cancellation wins: a cancelled occurrence is answered terminal with zero outputs", async () => {
    const { h, owner } = await setup({ actions: [I("a1"), I("a2")] });
    await h.call({ op: "cancel", ownerKey: owner, occurrenceId: "m1", now: T0 });
    const r = await runOf(h, owner);
    expect(r).toMatchObject({
      committed: 0,
      stopped: "terminal",
      occurrence: { state: "cancelled" },
    });
    expect(r.occurrence.outputs).toEqual([]);
    expect(rows(h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(0);
  });

  it("concurrent runs: each step committed exactly once; one terminal row; commits sum to the action count", async () => {
    const { h, owner, b } = await setup({ actions: [I("a1"), P("p1"), I("a2"), S("s1"), P("p2")] });
    const all = await Promise.all([runOf(h, owner), runOf(h, owner), runOf(h, owner)]);
    const end = await statusOf(h, owner);
    expect(end).toMatchObject({ state: "done", receiptVersion: 7 });
    expect(all.reduce((n, r) => n + r.committed, 0)).toBe(5);
    for (const r of all) {
      expect(["terminal", "contention"]).toContain(r.stopped);
      if (r.stopped === "terminal") expect(r.occurrence).toEqual(end);
    }
    expect(end.outputs.map((x: A) => canonicalJson(x.record))).toEqual(expected(b));
    expect(rows(h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(5);
  });

  it("stale-contention budget: three raced answers stop with the current state; fewer still finish; never spins", async () => {
    // A genuine concurrent writer: while the run awaits an output digest (between its read and its transaction),
    // another caller commits that same step through the public commitStep. The run's commit is then stale.
    const raced = async (races: number) => {
      const { h, owner } = await setup({ actions: [I("a1"), I("a2"), I("a3"), I("a4"), I("a5")] });
      const real = crypto.subtle.digest.bind(crypto.subtle);
      let left = races;
      let inside = false;
      const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (alg, data) => {
        if (left > 0 && !inside) {
          left--;
          inside = true;
          try {
            expect((await commitOne(h, owner)).committed).toBe(true);
          } finally {
            inside = false;
          }
        }
        return real(alg, data);
      });
      try {
        return { h, owner, r: await runOf(h, owner) };
      } finally {
        spy.mockRestore();
      }
    };
    const { h, owner, r } = await raced(RUN_STALE_MAX);
    expect(r).toMatchObject({ committed: 0, stopped: "contention" });
    expect(r.occurrence).toEqual(await statusOf(h, owner));
    expect(r.occurrence).toMatchObject({ state: "running", receiptVersion: 1 + RUN_STALE_MAX });
    // Recoverable: the next call finishes the rest.
    expect(await runOf(h, owner)).toMatchObject({
      committed: 5 - RUN_STALE_MAX,
      stopped: "terminal",
      occurrence: { state: "done" },
    });
    const fewer = await raced(RUN_STALE_MAX - 1);
    expect(fewer.r).toMatchObject({
      committed: 5 - (RUN_STALE_MAX - 1),
      stopped: "terminal",
      occurrence: { state: "done" },
    });
    expect(RUN_COMMITS_MAX).toBe(5);
  });

  // DT-7B-2-R1 (7B2-1): a stamp is never earlier than the row's durable lifecycle time (updated_at, which bounds
  // startedAt and every step time), so an older captured Worker clock cannot move the lifecycle backwards.
  describe("DT-7B-2-R1 monotonic lifecycle stamps", () => {
    const at = (t: number) => new Date(t).toISOString();
    const stampsOf = (o: A) => ({
      steps: o.steps.map((s: A) => s.at),
      startedAt: o.startedAt,
      finishedAt: o.finishedAt,
      updatedAt: o.updatedAt,
    });
    /** Chronology that every normally admitted occurrence must keep. */
    const expectChronology = (o: A) => {
      const times = o.steps.map((s: A) => Date.parse(s.at));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(Date.parse(o.startedAt)).toBeLessThanOrEqual(times[0]);
      expect(Date.parse(o.startedAt)).toBeLessThanOrEqual(Date.parse(o.finishedAt));
      expect(Date.parse(o.finishedAt)).toBeGreaterThanOrEqual(times[times.length - 1]);
      expect(Date.parse(o.updatedAt)).toBe(Date.parse(o.finishedAt));
    };
    const fetchSpy = () => vi.fn(() => Promise.reject(new Error("unexpected external call")));

    it("the exact two-run interleaving: A (t1) loses CAS to B (t2), then commits step 1 and finishes; nothing moves backward", async () => {
      const { h, owner, b } = await setup({ actions: [I("a1"), P("p1")] });
      const t1 = T0 + 1000;
      const t2 = T0 + 2000;
      const external = fetchSpy();
      vi.stubGlobal("fetch", external);
      const real = crypto.subtle.digest.bind(crypto.subtle);
      let calls = 0;
      const gates = new Map<number, { arrived: Promise<void>; release: () => void }>();
      const hold = (n: number) => {
        let arrive!: () => void;
        let release!: () => void;
        const arrived = new Promise<void>((r) => (arrive = r));
        const wait = new Promise<void>((r) => (release = r));
        gates.set(n, { arrived, release });
        return { arrive, wait };
      };
      const g1 = hold(1);
      const g3 = hold(3);
      const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (alg, data) => {
        const n = ++calls;
        const g = n === 1 ? g1 : n === 3 ? g3 : null;
        if (g) {
          g.arrive();
          await g.wait;
        }
        return real(alg, data);
      });
      try {
        const a = runOf(h, owner, "m1", t1);
        await gates.get(1)!.arrived; // A holds the step-0 output digest
        const bRun = runOf(h, owner, "m1", t2);
        await gates.get(3)!.arrived; // B committed step 0 at t2 and holds the step-1 digest
        const mid = rows(h.db, "SELECT updated_at FROM occurrences")[0].updated_at;
        expect(mid).toBe(t2);
        gates.get(1)!.release();
        const ra = await a; // A: stale on step 0, adopts B's progress, commits step 1, finishes
        const afterA = rows(h.db, "SELECT updated_at FROM occurrences")[0].updated_at;
        expect(afterA).toBeGreaterThanOrEqual(mid);
        gates.get(3)!.release();
        const rb = await bRun;
        const end = await statusOf(h, owner);
        expect(ra.stopped).toBe("terminal");
        expect(rb.stopped).toBe("terminal");
        expect(ra.occurrence).toEqual(end);
        expect(rb.occurrence).toEqual(end);
        expect(end).toMatchObject({ state: "done", receiptVersion: 4 });
        // Chronology: everything the later request stamped, nothing earlier than it.
        expect(stampsOf(end)).toEqual({
          steps: [at(t2), at(t2)],
          startedAt: at(t2),
          finishedAt: at(t2),
          updatedAt: at(t2),
        });
        expectChronology(end);
        // Outputs unchanged: byte-equal to the app's dry run, builder clock stays executionAt.
        expect(end.outputs.map((x: A) => canonicalJson(x.record))).toEqual(expected(b));
        expect(rows(h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(2);
        expect(external).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it("finish-only retry with a captured time older than durable progress keeps the chronology", async () => {
      const { h, owner } = await setup({ actions: [I("a1"), I("a2")], id: "m2" });
      for (const n of [0, 1]) {
        const o = await statusOf(h, owner, "m2");
        const idx = o.steps.findIndex((s: A) => s.status === "pending");
        expect(idx).toBe(n);
        const output = await runStep({
          body: o.body,
          idx,
          action: o.body.snapshot.actions[idx],
          prior: o.outputs,
        });
        const c = await h.call({
          op: "commitStep",
          ownerKey: owner,
          occurrenceId: "m2",
          idx,
          receiptVersion: o.receiptVersion,
          payloadDigest: o.payloadDigest,
          output,
          now: T0 + 5000 * (n + 1),
        });
        expect(c.committed).toBe(true);
      }
      // Every step is durable at T0+10000; a delayed retry captured an older Worker clock.
      const r = await runOf(h, owner, "m2", T0 + 1000);
      expect(r).toMatchObject({ committed: 0, stopped: "terminal", occurrence: { state: "done" } });
      expect(stampsOf(r.occurrence)).toEqual({
        steps: [at(T0 + 5000), at(T0 + 10_000)],
        startedAt: at(T0 + 5000),
        finishedAt: at(T0 + 10_000),
        updatedAt: at(T0 + 10_000),
      });
      expectChronology(r.occurrence);
      // The public finish op is the same shared point.
      const two = await setup({ actions: [I("a1")], id: "m3" });
      await commitOne(two.h, two.owner, "m3"); // stamped T0
      const fin = await two.h.call({
        op: "finish",
        ownerKey: two.owner,
        occurrenceId: "m3",
        now: T0 - 60_000,
      });
      expect(fin.occurrence).toMatchObject({
        state: "done",
        finishedAt: at(T0),
        updatedAt: at(T0),
      });
    });

    it("a normal single run (and a later clock) stamps the captured Worker time; terminal replay commits nothing", async () => {
      const { h, owner, b } = await setup({ actions: [I("a1"), S("s1"), I("a2")] });
      const t = T0 + 30_000;
      const first = await runOf(h, owner, "m1", t);
      expect(first).toMatchObject({ committed: 3, stopped: "terminal" });
      expect(stampsOf(first.occurrence)).toEqual({
        steps: [at(t), at(t), at(t)],
        startedAt: at(t),
        finishedAt: at(t),
        updatedAt: at(t),
      });
      expectChronology(first.occurrence);
      expect(first.occurrence.outputs.map((x: A) => canonicalJson(x.record))).toEqual(expected(b));
      // A forward clock moves an unfinished row forward: one step at t, the next call at t + 1 h.
      const slow = await setup({ actions: [I("a1"), I("a2")], id: "m2" });
      await commitOne(slow.h, slow.owner, "m2");
      const later = await runOf(slow.h, slow.owner, "m2", T0 + 3_600_000);
      expect(stampsOf(later.occurrence)).toEqual({
        steps: [at(T0), at(T0 + 3_600_000)],
        startedAt: at(T0),
        finishedAt: at(T0 + 3_600_000),
        updatedAt: at(T0 + 3_600_000),
      });
      // Terminal replay with any clock: same receipt, no commit, no sequence move.
      const s = seq(h);
      for (const now of [t - 20_000, t, t + DAY]) {
        expect(await runOf(h, owner, "m1", now)).toEqual({ ...first, committed: 0 });
      }
      expect(seq(h)).toBe(s);
    });
  });

  it("strict call: only op/ownerKey/occurrenceId/now; no builder, output, snapshot, clock, retry or toggle; typed refusals", async () => {
    const { h, owner } = await setup({ actions: [I("a1")] });
    const s = seq(h);
    for (const extra of [
      { builder: "test" },
      { output: { record: {} } },
      { body: {} },
      { executionAt: AT },
      { clock: T0 },
      { retries: 9 },
      { enabled: true },
      { idx: 0 },
    ])
      expect(
        await h.call({ op: "run", ownerKey: owner, occurrenceId: "m1", now: T0, ...extra }),
      ).toEqual({
        error: "bad_request",
      });
    expect(await h.call({ op: "run", ownerKey: owner, now: T0 })).toEqual({ error: "bad_request" });
    expect(await runOf(h, owner, "a:b")).toEqual({ error: "bad_request" });
    expect(await runOf(h, "wfo_" + "1".repeat(32))).toEqual({ error: "authority_mismatch" });
    expect(seq(h)).toBe(s);
    expect((await statusOf(h, owner)).state).toBe("pending");
    expect(await runOf(h, owner, "never")).toEqual({ error: "absent", occurrenceId: "never" });
  });

  it("a pruned occurrence answers pruned; nothing is rebuilt", async () => {
    const { h, owner } = await setup({ actions: [I("a1")] });
    const done = (await runOf(h, owner)).occurrence;
    const late = Date.parse(done.finishedAt) + 181 * DAY;
    expect(await runOf(h, owner, "m1", late)).toEqual({
      error: "pruned",
      occurrenceId: "m1",
      payloadDigest: done.payloadDigest,
      prunedAt: new Date(late).toISOString(),
    });
    expect(rows(h.db, "SELECT COUNT(*) AS n FROM outputs")[0].n).toBe(0);
  });
});
