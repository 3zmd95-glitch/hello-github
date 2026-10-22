import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  RETENTION_MS,
  ThreadsSendCoordinator,
  type ThreadsAnswer,
  type ThreadsCall,
  type ThreadsPrepareInput,
} from "./threadsSendCoordinator";

// 📤 The Threads send coordinator's SQL logic (packet DT-6B-2B-1, planning/tools/37-inbox-send.md) over a real SQLite
// engine (node:sqlite, the dialect of a SQLite-backed Durable Object). A fresh coordinator per call over one database
// is a restart between every step. Two stages, each behind its own atomic claim: prepared → creating → created →
// publishing → published, with distinct unknown_creation / unknown_publication that nothing ever claims again. The
// workerd proof (binding, migration, crash/restart) is threadsSendCoordinator.runtime.test.ts.

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
const OP = "op-aaaaaaaa";

const input = (over: Partial<ThreadsPrepareInput> = {}): ThreadsPrepareInput => ({
  operationId: OP,
  account: "25000000000000001",
  generation: "0".repeat(32),
  rootPostId: "90001",
  replyToId: "91001",
  text: "Thanks for the reply!",
  digest: D,
  draftRevision: "rev-1",
  reviewExpiresAt: T0 + 600_000,
  ...over,
});

function harness() {
  const db = new DatabaseSync(":memory:");
  const run = async (call: ThreadsCall): Promise<ThreadsAnswer> => {
    const c = new ThreadsSendCoordinator({ storage: sqliteStorage(db) } as never);
    const res = await c.fetch(
      new Request("https://threads-send-coordinator/", {
        method: "POST",
        body: JSON.stringify(call),
      }),
    );
    return (await res.json()) as ThreadsAnswer;
  };
  const prepare = (over: Partial<ThreadsPrepareInput> = {}, now = T0) =>
    run({ op: "prepare", input: input(over), now });
  const get = (operationId = OP, now = T0) => run({ op: "get", operationId, now });
  const claimCreate = (operationId = OP, digest = D, now = T0) =>
    run({ op: "claimCreate", operationId, digest, now });
  const record = (containerId = "17800000000000001", operationId = OP, now = T0) =>
    run({ op: "recordContainer", operationId, containerId, now });
  const claimPublish = (operationId = OP, digest = D, now = T0) =>
    run({ op: "claimPublish", operationId, digest, now });
  return { db, run, prepare, get, claimCreate, record, claimPublish };
}

const stateOf = (a: ThreadsAnswer) => ("intent" in a ? a.intent.state : a.error);
const flag = (a: ThreadsAnswer, k: "claimed" | "recorded" | "settled") =>
  "intent" in a ? a[k] : undefined;

describe("ThreadsSendCoordinator.prepare", () => {
  it("stores one immutable intent with receipt version 1; the same operation and payload returns it again", async () => {
    const h = harness();
    const a = await h.prepare();
    expect(a).toEqual({
      intent: {
        operationId: OP,
        provider: "threads",
        account: "25000000000000001",
        generation: "0".repeat(32),
        rootPostId: "90001",
        replyToId: "91001",
        text: "Thanks for the reply!",
        digest: D,
        draftRevision: "rev-1",
        state: "prepared",
        reviewExpiresAt: new Date(T0 + 600_000).toISOString(),
        createdAt: new Date(T0).toISOString(),
        updatedAt: new Date(T0).toISOString(),
        receiptVersion: 1,
      },
    });
    expect(await h.prepare()).toEqual(a);
  });

  it("the same operation with a changed payload conflicts and keeps the first intent", async () => {
    const h = harness();
    await h.prepare();
    for (const over of [
      { digest: D2, text: "other" },
      { replyToId: "91002" },
      { rootPostId: "90002" },
      { draftRevision: "rev-2" },
      { generation: "1".repeat(32) },
    ])
      expect(await h.prepare(over)).toEqual({ error: "conflict" });
    expect(await h.get()).toMatchObject({
      intent: { digest: D, replyToId: "91001", draftRevision: "rev-1", receiptVersion: 1 },
    });
  });

  it("another operation id for the same account, revision, target and digest converges; any change is new", async () => {
    const h = harness();
    await h.prepare();
    expect(await h.prepare({ operationId: "op-bbbbbbbb" })).toMatchObject({
      intent: { operationId: OP, state: "prepared" },
    });
    for (const [id, over] of [
      ["op-cccccccc", { digest: D2, text: "x" }],
      ["op-dddddddd", { replyToId: "91002" }],
      ["op-eeeeeeee", { draftRevision: "rev-2" }],
      ["op-ffffffff", { account: "25000000000000002" }],
    ] as const)
      expect(await h.prepare({ operationId: id, ...over })).toMatchObject({
        intent: { operationId: id },
      });
  });

  it("refuses a malformed input", async () => {
    const h = harness();
    expect(await h.run({ op: "prepare", input: { operationId: OP } as never, now: T0 })).toEqual({
      error: "bad_request",
    });
    expect(await h.prepare({ reviewExpiresAt: Number.NaN })).toEqual({ error: "bad_request" });
    expect(await h.run({ op: "nope", now: T0 } as never)).toEqual({ error: "bad_request" });
  });
});

describe("ThreadsSendCoordinator: two stages, each claimed once", () => {
  it("prepared → creating → created → publishing → published, receipt version rising on every write", async () => {
    const h = harness();
    await h.prepare();
    const c = await h.claimCreate();
    expect(c).toMatchObject({ claimed: true, intent: { state: "creating", receiptVersion: 2 } });
    expect("intent" in c && c.intent.createClaimedAt).toBe(new Date(T0).toISOString());
    const r = await h.record();
    expect(r).toMatchObject({
      recorded: true,
      intent: { state: "created", containerId: "17800000000000001", receiptVersion: 3 },
    });
    const p = await h.claimPublish();
    expect(p).toMatchObject({ claimed: true, intent: { state: "publishing", receiptVersion: 4 } });
    const s = await h.run({
      op: "settle",
      operationId: OP,
      outcome: { state: "published", publishedId: "18000000000000009" },
      now: T0 + 5,
    });
    expect(s).toMatchObject({
      settled: true,
      intent: {
        state: "published",
        containerId: "17800000000000001",
        publishedId: "18000000000000009",
        receiptVersion: 5,
      },
    });
  });

  it("each claim succeeds exactly once; a repeated claim or record changes nothing", async () => {
    const h = harness();
    await h.prepare();
    expect(flag(await h.claimCreate(), "claimed")).toBe(true);
    expect(await h.claimCreate()).toMatchObject({
      claimed: false,
      intent: { state: "creating", receiptVersion: 2 },
    });
    // No publish claim before a durable container.
    expect(await h.claimPublish()).toMatchObject({
      claimed: false,
      intent: { state: "creating" },
    });
    expect(flag(await h.record(), "recorded")).toBe(true);
    expect(await h.record("17800000000000002")).toMatchObject({
      recorded: false,
      intent: { state: "created", containerId: "17800000000000001", receiptVersion: 3 },
    });
    expect(await h.claimCreate()).toMatchObject({ claimed: false, intent: { state: "created" } });
    expect(flag(await h.claimPublish(), "claimed")).toBe(true);
    expect(await h.claimPublish()).toMatchObject({
      claimed: false,
      intent: { state: "publishing", receiptVersion: 4 },
    });
    expect(await h.record("17800000000000003")).toMatchObject({
      recorded: false,
      intent: { containerId: "17800000000000001" },
    });
  });

  it("a claim with another digest conflicts; an unknown operation is not_found", async () => {
    const h = harness();
    await h.prepare();
    expect(await h.claimCreate(OP, D2)).toEqual({ error: "conflict" });
    expect(await h.claimCreate("op-zzzzzzzz")).toEqual({ error: "not_found" });
    await h.claimCreate();
    await h.record();
    expect(await h.claimPublish(OP, D2)).toEqual({ error: "conflict" });
    expect(stateOf(await h.get())).toBe("created");
  });

  it("refuses an empty or non-id container and a published receipt without a string id", async () => {
    const h = harness();
    await h.prepare();
    await h.claimCreate();
    for (const bad of ["", "../x", "a b", 5])
      expect(await h.record(bad as string)).toEqual({ error: "bad_request" });
    expect(stateOf(await h.get())).toBe("creating");
    await h.record();
    await h.claimPublish();
    for (const publishedId of ["", 7, null])
      expect(
        await h.run({
          op: "settle",
          operationId: OP,
          outcome: { state: "published", publishedId } as never,
          now: T0,
        }),
      ).toEqual({ error: "bad_request" });
    expect(stateOf(await h.get())).toBe("publishing");
  });

  it("settle only from its own stage: unknown_creation from creating, unknown_publication from publishing", async () => {
    const h = harness();
    await h.prepare();
    await h.claimCreate();
    // Publication outcomes cannot settle a creating row.
    for (const outcome of [
      { state: "published", publishedId: "18000000000000009" },
      { state: "unknown_publication", reason: "timeout" },
    ])
      expect(
        await h.run({ op: "settle", operationId: OP, outcome: outcome as never, now: T0 }),
      ).toMatchObject({ settled: false, intent: { state: "creating" } });
    expect(
      await h.run({
        op: "settle",
        operationId: OP,
        outcome: { state: "unknown_creation", reason: "timeout" },
        now: T0,
      }),
    ).toMatchObject({
      settled: true,
      intent: { state: "unknown_creation", unknownReason: "timeout", receiptVersion: 3 },
    });

    const k = harness();
    await k.prepare();
    await k.claimCreate();
    await k.record();
    await k.claimPublish();
    expect(
      await k.run({
        op: "settle",
        operationId: OP,
        outcome: { state: "unknown_creation", reason: "timeout" },
        now: T0,
      }),
    ).toMatchObject({ settled: false, intent: { state: "publishing" } });
    expect(
      await k.run({
        op: "settle",
        operationId: OP,
        outcome: { state: "unknown_publication", reason: "server" },
        now: T0,
      }),
    ).toMatchObject({
      settled: true,
      intent: {
        state: "unknown_publication",
        unknownReason: "server",
        containerId: "17800000000000001",
      },
    });
  });

  it("a known refusal settles either in-flight stage as rejected, with the stage visible by the container", async () => {
    const h = harness();
    await h.prepare();
    await h.claimCreate();
    expect(
      await h.run({
        op: "settle",
        operationId: OP,
        outcome: { state: "rejected", code: "meta_100", detail: "Invalid parameter" },
        now: T0,
      }),
    ).toMatchObject({
      settled: true,
      intent: { state: "rejected", failureCode: "meta_100", failureDetail: "Invalid parameter" },
    });
    expect(await h.get()).not.toHaveProperty("intent.containerId");
    const k = harness();
    await k.prepare();
    await k.claimCreate();
    await k.record();
    await k.claimPublish();
    expect(
      await k.run({
        op: "settle",
        operationId: OP,
        outcome: { state: "rejected", code: "meta_4" },
        now: T0,
      }),
    ).toMatchObject({
      settled: true,
      intent: { state: "rejected", failureCode: "meta_4", containerId: "17800000000000001" },
    });
  });

  it("unknown states are never claimed, recorded, settled again, cancelled or replaced by convergence", async () => {
    for (const stage of ["unknown_creation", "unknown_publication"] as const) {
      const h = harness();
      await h.prepare();
      await h.claimCreate();
      if (stage === "unknown_publication") {
        await h.record();
        await h.claimPublish();
      }
      await h.run({
        op: "settle",
        operationId: OP,
        outcome: { state: stage, reason: "timeout" },
        now: T0,
      });
      const before = await h.get();
      expect(stateOf(before)).toBe(stage);
      expect(flag(await h.claimCreate(), "claimed")).toBe(false);
      expect(flag(await h.record("17800000000000777"), "recorded")).toBe(false);
      expect(flag(await h.claimPublish(), "claimed")).toBe(false);
      for (const outcome of [
        { state: "published", publishedId: "18000000000000009" },
        { state: "rejected", code: "x" },
        { state: "unknown_creation", reason: "r" },
        { state: "unknown_publication", reason: "r" },
      ])
        expect(
          flag(
            await h.run({ op: "settle", operationId: OP, outcome: outcome as never, now: T0 }),
            "settled",
          ),
        ).toBe(false);
      expect(stateOf(await h.run({ op: "cancel", operationId: OP, now: T0 }))).toBe(stage);
      // A fresh operation for the same submission returns the uncertain one, never a new dispatchable intent.
      expect(await h.prepare({ operationId: "op-retry-01" })).toMatchObject({
        intent: { operationId: OP, state: stage },
      });
      // Never expired, never purged.
      const later = T0 + RETENTION_MS * 3;
      await h.prepare({ operationId: "op-other-01", draftRevision: "rev-9" }, later);
      expect(await h.get(OP, later)).toEqual(before);
    }
  });
});

describe("ThreadsSendCoordinator: cancel, expiry, retention", () => {
  it("cancel ends only a prepared intent; it cannot claim an in-flight or finished stage", async () => {
    const h = harness();
    await h.prepare();
    expect(await h.run({ op: "cancel", operationId: OP, now: T0 })).toMatchObject({
      intent: { state: "cancelled", receiptVersion: 2 },
    });
    expect(flag(await h.claimCreate(), "claimed")).toBe(false);
    for (const upTo of ["creating", "created", "publishing", "published"] as const) {
      const k = harness();
      await k.prepare();
      await k.claimCreate();
      if (upTo !== "creating") await k.record();
      if (upTo === "publishing" || upTo === "published") await k.claimPublish();
      if (upTo === "published")
        await k.run({
          op: "settle",
          operationId: OP,
          outcome: { state: "published", publishedId: "18000000000000009" },
          now: T0,
        });
      const before = await k.get();
      expect(await k.run({ op: "cancel", operationId: OP, now: T0 })).toEqual(before);
    }
    expect(await h.run({ op: "cancel", operationId: "op-zzzzzzzz", now: T0 })).toEqual({
      error: "not_found",
    });
  });

  it("a prepared intent past its review deadline expires; an in-flight stage never does", async () => {
    const h = harness();
    await h.prepare();
    expect(stateOf(await h.get(OP, T0 + 600_000))).toBe("expired");
    expect(flag(await h.claimCreate(OP, D, T0 + 600_000), "claimed")).toBe(false);
    for (const upTo of ["creating", "created", "publishing"] as const) {
      const k = harness();
      await k.prepare();
      await k.claimCreate();
      if (upTo !== "creating") await k.record();
      if (upTo === "publishing") await k.claimPublish();
      expect(stateOf(await k.get(OP, T0 + RETENTION_MS * 2))).toBe(upTo);
    }
  });

  it("after retention a finished row is purged, its id and a published submission stay tombstoned", async () => {
    const h = harness();
    await h.prepare();
    await h.claimCreate();
    await h.record();
    await h.claimPublish();
    await h.run({
      op: "settle",
      operationId: OP,
      outcome: { state: "published", publishedId: "18000000000000009" },
      now: T0,
    });
    await h.prepare({ operationId: "op-cancel-1", draftRevision: "rev-2" });
    await h.run({ op: "cancel", operationId: "op-cancel-1", now: T0 });
    const later = T0 + RETENTION_MS + 60_000;
    await h.prepare({ operationId: "op-other-1", draftRevision: "rev-3" }, later);
    expect(await h.get(OP, later)).toEqual({ error: "not_found" });
    expect(await h.get("op-cancel-1", later)).toEqual({ error: "not_found" });
    expect(await h.prepare({}, later)).toEqual({ error: "conflict" });
    expect(await h.prepare({ operationId: "op-again-1" }, later)).toEqual({ error: "conflict" });
    expect(await h.prepare({ operationId: "op-cancel-1", draftRevision: "rev-2" }, later)).toEqual({
      error: "conflict",
    });
    // A cancelled submission is not a send: a new operation for it may be prepared.
    expect(
      await h.prepare({ operationId: "op-cancel-2", draftRevision: "rev-2" }, later),
    ).toMatchObject({ intent: { state: "prepared" } });
  });

  it("stores no token or seal key: the row holds ids, text and the digest only", async () => {
    const h = harness();
    await h.prepare();
    const cols = (h.db.prepare("PRAGMA table_info(intents)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols.some((c) => /token|seal|secret/i.test(c))).toBe(false);
    expect(cols).toEqual(
      expect.arrayContaining(["container_id", "published_id", "receipt_version", "reply_to_id"]),
    );
  });

  it("a request that is not JSON or has no clock is bad_request", async () => {
    const db = new DatabaseSync(":memory:");
    const c = new ThreadsSendCoordinator({ storage: sqliteStorage(db) } as never);
    const res = await c.fetch(new Request("https://x/", { method: "POST", body: "{" }));
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(c.run({ op: "get", operationId: OP } as never)).toEqual({ error: "bad_request" });
  });
});
