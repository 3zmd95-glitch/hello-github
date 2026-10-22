import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  RETENTION_MS,
  SendCoordinator,
  type CoordinatorAnswer,
  type CoordinatorCall,
  type PrepareInput,
} from "./sendCoordinator";

// 📤 The send coordinator's SQL logic (packet DT-6B-2A, planning/tools/37-inbox-send.md) over a real SQLite engine
// (node:sqlite, the same SQL dialect as a SQLite-backed Durable Object). A fresh SendCoordinator per call over one
// database is a restart between every step. The workerd runtime proof (binding, migration, persistence across a new
// runtime, concurrent claims) is sendCoordinator.runtime.test.ts.

/** `ctx.storage` of a SQLite Durable Object, backed by node:sqlite. */
function sqliteStorage(db: DatabaseSync) {
  return {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        const st = db.prepare(query);
        if (/^\s*SELECT|RETURNING/i.test(query)) {
          const rows = st.all(...bindings);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        const r = st.run(...bindings);
        return { toArray: () => [], rowsWritten: Number(r.changes) };
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

const T0 = Date.parse("2026-10-17T09:00:00Z");
const D = "a".repeat(64);
const D2 = "b".repeat(64);

const input = (over: Partial<PrepareInput> = {}): PrepareInput => ({
  operationId: "op-aaaaaaaa",
  provider: "youtube",
  account: "UCaaaaaaaaaaaaaaaaaaaaaa",
  generation: "0".repeat(32),
  threadId: "UgThread1",
  videoId: "vid1",
  parentCommentId: "UgTop1",
  text: "Thanks for watching!",
  digest: D,
  draftRevision: "rev-1",
  reviewExpiresAt: T0 + 600_000,
  ...over,
});

function harness() {
  const db = new DatabaseSync(":memory:");
  const run = async (call: CoordinatorCall): Promise<CoordinatorAnswer> => {
    const c = new SendCoordinator({ storage: sqliteStorage(db) } as never);
    const res = await c.fetch(
      new Request("https://send-coordinator/", { method: "POST", body: JSON.stringify(call) }),
    );
    return (await res.json()) as CoordinatorAnswer;
  };
  const prepare = (over: Partial<PrepareInput> = {}, now = T0) =>
    run({ op: "prepare", input: input(over), now });
  return { db, run, prepare };
}

const stateOf = (a: CoordinatorAnswer) => ("intent" in a ? a.intent.state : a.error);

describe("SendCoordinator.prepare", () => {
  it("stores one immutable intent; the same operation and payload returns it again", async () => {
    const h = harness();
    const a = await h.prepare();
    expect(a).toMatchObject({
      intent: {
        operationId: "op-aaaaaaaa",
        state: "prepared",
        text: "Thanks for watching!",
        digest: D,
        parentCommentId: "UgTop1",
        threadId: "UgThread1",
        videoId: "vid1",
        draftRevision: "rev-1",
        reviewExpiresAt: new Date(T0 + 600_000).toISOString(),
      },
    });
    expect(await h.prepare()).toEqual(a);
  });

  it("the same operation with a changed payload conflicts and keeps the first intent", async () => {
    const h = harness();
    await h.prepare();
    for (const over of [
      { digest: D2, text: "other" },
      { parentCommentId: "UgTop2" },
      { draftRevision: "rev-2" },
      { generation: "1".repeat(32) },
    ])
      expect(await h.prepare(over)).toEqual({ error: "conflict" });
    expect(await h.run({ op: "get", operationId: "op-aaaaaaaa", now: T0 })).toMatchObject({
      intent: { digest: D, parentCommentId: "UgTop1", draftRevision: "rev-1" },
    });
  });

  it("two operation ids for the same draft revision, parent and text converge on the first intent", async () => {
    const h = harness();
    await h.prepare();
    const b = await h.prepare({ operationId: "op-bbbbbbbb" });
    expect(b).toMatchObject({ intent: { operationId: "op-aaaaaaaa", state: "prepared" } });
    // A different text is a different submission.
    expect(await h.prepare({ operationId: "op-cccccccc", digest: D2, text: "x" })).toMatchObject({
      intent: { operationId: "op-cccccccc" },
    });
  });

  it("a sent or unknown submission is never prepared again under a new id; an expired one may be", async () => {
    const h = harness();
    await h.prepare();
    await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 });
    await h.run({
      op: "settle",
      operationId: "op-aaaaaaaa",
      outcome: { state: "unknown", reason: "timeout" },
      now: T0,
    });
    expect(await h.prepare({ operationId: "op-bbbbbbbb" })).toMatchObject({
      intent: { operationId: "op-aaaaaaaa", state: "unknown" },
    });
    const later = T0 + 700_000;
    await h.prepare({ operationId: "op-dddddddd", digest: D2, text: "y" });
    expect(stateOf(await h.run({ op: "get", operationId: "op-dddddddd", now: later }))).toBe(
      "expired",
    );
    expect(
      await h.prepare(
        { operationId: "op-eeeeeeee", digest: D2, text: "y", reviewExpiresAt: later + 600_000 },
        later,
      ),
    ).toMatchObject({ intent: { operationId: "op-eeeeeeee", state: "prepared" } });
  });
});

describe("SendCoordinator.claim / settle / cancel", () => {
  it("claims prepared → dispatching exactly once; a second claim returns the state without claiming", async () => {
    const h = harness();
    await h.prepare();
    const claim = () => h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 });
    const [a, b] = await Promise.all([claim(), claim()]);
    expect([a, b].filter((x) => "claimed" in x && x.claimed)).toHaveLength(1);
    expect(stateOf(a)).toBe("dispatching");
    expect(stateOf(b)).toBe("dispatching");
    expect(await claim()).toMatchObject({ claimed: false, intent: { state: "dispatching" } });
  });

  it("refuses a claim with another digest, an expired review, a cancelled or unknown intent", async () => {
    const h = harness();
    await h.prepare();
    expect(await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D2, now: T0 })).toEqual({
      error: "conflict",
    });
    expect(
      await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 + 600_000 }),
    ).toMatchObject({ claimed: false, intent: { state: "expired" } });
    expect(await h.run({ op: "claim", operationId: "op-zzzzzzzz", digest: D, now: T0 })).toEqual({
      error: "not_found",
    });
    await h.prepare({ operationId: "op-bbbbbbbb", digest: D2, text: "b" });
    await h.run({ op: "cancel", operationId: "op-bbbbbbbb", now: T0 });
    expect(
      await h.run({ op: "claim", operationId: "op-bbbbbbbb", digest: D2, now: T0 }),
    ).toMatchObject({ claimed: false, intent: { state: "cancelled" } });
  });

  it("settles once: sent keeps its comment id; a later settle cannot change it", async () => {
    const h = harness();
    await h.prepare();
    await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 });
    const sent = await h.run({
      op: "settle",
      operationId: "op-aaaaaaaa",
      outcome: { state: "sent", providerCommentId: "UgTop1.reply9" },
      now: T0 + 1000,
    });
    expect(sent).toMatchObject({
      settled: true,
      intent: { state: "sent", providerCommentId: "UgTop1.reply9" },
    });
    expect(
      await h.run({
        op: "settle",
        operationId: "op-aaaaaaaa",
        outcome: { state: "rejected", code: "forbidden" },
        now: T0 + 2000,
      }),
    ).toMatchObject({ settled: false, intent: { state: "sent" } });
  });

  it("never settles an intent that was not claimed, and cancels only a prepared one", async () => {
    const h = harness();
    await h.prepare();
    expect(
      await h.run({
        op: "settle",
        operationId: "op-aaaaaaaa",
        outcome: { state: "sent", providerCommentId: "x" },
        now: T0,
      }),
    ).toMatchObject({ settled: false, intent: { state: "prepared" } });
    await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 });
    expect(await h.run({ op: "cancel", operationId: "op-aaaaaaaa", now: T0 })).toMatchObject({
      intent: { state: "dispatching" },
    });
  });

  it("a dispatching or unknown intent never expires, however long it waits", async () => {
    const h = harness();
    await h.prepare();
    await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 });
    const far = T0 + 10 * RETENTION_MS;
    expect(await h.run({ op: "get", operationId: "op-aaaaaaaa", now: far })).toMatchObject({
      intent: { state: "dispatching" },
    });
    expect(
      await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: far }),
    ).toMatchObject({ claimed: false, intent: { state: "dispatching" } });
  });
});

describe("SendCoordinator retention", () => {
  it("purges terminal rows after the retention window and tombstones their ids", async () => {
    const h = harness();
    await h.prepare();
    await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 });
    await h.run({
      op: "settle",
      operationId: "op-aaaaaaaa",
      outcome: { state: "sent", providerCommentId: "c1" },
      now: T0,
    });
    const later = T0 + RETENTION_MS + 1000;
    // Any prepare runs the purge; the sent row goes, its id and submission stay blocked.
    await h.prepare(
      { operationId: "op-ffffffff", digest: D2, text: "z", reviewExpiresAt: later + 600_000 },
      later,
    );
    expect(await h.run({ op: "get", operationId: "op-aaaaaaaa", now: later })).toEqual({
      error: "not_found",
    });
    expect(
      await h.prepare({ reviewExpiresAt: later + 600_000 }, later), // the same id again
    ).toEqual({ error: "conflict" });
    expect(
      await h.prepare({ operationId: "op-gggggggg", reviewExpiresAt: later + 600_000 }, later),
    ).toEqual({ error: "conflict" });
    expect(await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: later })).toEqual(
      { error: "not_found" },
    );
  });

  it("keeps unknown and dispatching rows forever", async () => {
    const h = harness();
    await h.prepare();
    await h.run({ op: "claim", operationId: "op-aaaaaaaa", digest: D, now: T0 });
    const later = T0 + 3 * RETENTION_MS;
    await h.prepare(
      { operationId: "op-ffffffff", digest: D2, text: "z", reviewExpiresAt: later + 600_000 },
      later,
    );
    expect(stateOf(await h.run({ op: "get", operationId: "op-aaaaaaaa", now: later }))).toBe(
      "dispatching",
    );
  });

  it("answers bad_request for an unknown call", async () => {
    const h = harness();
    expect(await h.run({ op: "nope" } as never)).toEqual({ error: "bad_request" });
  });
});
