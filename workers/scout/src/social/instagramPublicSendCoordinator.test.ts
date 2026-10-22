import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  InstagramPublicSendCoordinator,
  RETENTION_MS,
  type IgPrepareInput,
  type IgPublicAnswer,
  type IgPublicCall,
} from "./instagramPublicSendCoordinator";

// 📤 The Instagram public-effect coordinator (packet DT-6B-2C-1, planning/tools/37-inbox-send.md) over a real SQLite
// engine (node:sqlite, the dialect of a SQLite-backed Durable Object). A fresh coordinator per call over one database
// is a restart between every step. One object holds both the manual intents and the shared `(account, comment)` public
// effects, so the manual confirm claim and the automatic claim race on one atomic insert. The workerd proof (binding,
// migration, routes, poll, crash/restart) is instagramPublicSendCoordinator.runtime.test.ts.

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
const ACC = "17841000000000001";
const MEDIA = "18000000000000001";
const COMMENT = "17900000000000001";

const input = (over: Partial<IgPrepareInput> = {}): IgPrepareInput => ({
  operationId: OP,
  account: ACC,
  generation: "0".repeat(32),
  mediaId: MEDIA,
  commentId: COMMENT,
  text: "Thanks for the comment!",
  digest: D,
  draftRevision: "rev-1",
  reviewExpiresAt: T0 + 600_000,
  ...over,
});

function harness() {
  const db = new DatabaseSync(":memory:");
  const run = async (call: IgPublicCall): Promise<IgPublicAnswer> => {
    const c = new InstagramPublicSendCoordinator({ storage: sqliteStorage(db) } as never);
    const res = await c.fetch(
      new Request("https://instagram-public-send-coordinator/", {
        method: "POST",
        body: JSON.stringify(call),
      }),
    );
    return (await res.json()) as IgPublicAnswer;
  };
  const prepare = (over: Partial<IgPrepareInput> = {}, now = T0) =>
    run({ op: "prepare", input: input(over), now });
  const get = (operationId = OP, now = T0) => run({ op: "get", operationId, now });
  const claimConfirm = (operationId = OP, digest = D, now = T0) =>
    run({ op: "claimConfirm", operationId, digest, now });
  const claimAuto = (automationId = "lut", commentId = COMMENT, account = ACC, now = T0) =>
    run({ op: "claimAuto", account, commentId, automationId, now });
  const effect = (commentId = COMMENT, account = ACC, now = T0) =>
    run({ op: "getEffect", account, commentId, now });
  const settle = (
    actor: string,
    outcome: Extract<IgPublicCall, { op: "settle" }>["outcome"],
    commentId = COMMENT,
    now = T0,
  ) => run({ op: "settle", account: ACC, commentId, actor, outcome, now });
  return { db, run, prepare, get, claimConfirm, claimAuto, effect, settle };
}

const stateOf = (a: IgPublicAnswer) =>
  "intent" in a && a.intent ? a.intent.state : "error" in a ? a.error : undefined;
const claimed = (a: IgPublicAnswer) => ("claimed" in a ? a.claimed : undefined);

describe("InstagramPublicSendCoordinator.prepare", () => {
  it("stores one immutable intent with receipt version 1; the same operation and payload returns it again", async () => {
    const h = harness();
    const a = await h.prepare();
    expect(a).toEqual({
      intent: {
        operationId: OP,
        provider: "instagram",
        account: ACC,
        generation: "0".repeat(32),
        mediaId: MEDIA,
        commentId: COMMENT,
        text: "Thanks for the comment!",
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

  it("the same operation with a changed payload conflicts; another operation for the same submission converges", async () => {
    const h = harness();
    await h.prepare();
    for (const over of [
      { digest: D2, text: "other" },
      { commentId: "17900000000000002" },
      { mediaId: "18000000000000002" },
      { draftRevision: "rev-2" },
      { generation: "1".repeat(32) },
    ])
      expect(await h.prepare(over)).toEqual({ error: "conflict" });
    expect(await h.prepare({ operationId: "op-bbbbbbbb" })).toMatchObject({
      intent: { operationId: OP },
    });
    expect(
      await h.prepare({ operationId: "op-cccccccc", digest: D2, text: "other" }),
    ).toMatchObject({ intent: { operationId: "op-cccccccc" } });
  });

  it("refuses a malformed input, including ids that could become a path", async () => {
    const h = harness();
    expect(await h.run({ op: "prepare", input: { operationId: OP } as never, now: T0 })).toEqual({
      error: "bad_request",
    });
    expect(await h.prepare({ reviewExpiresAt: Number.NaN })).toEqual({ error: "bad_request" });
    expect(await h.prepare({ commentId: "../me" })).toEqual({ error: "bad_request" });
    expect(await h.run({ op: "nope", now: T0 } as never)).toEqual({ error: "bad_request" });
    expect(await h.claimAuto("bad id!")).toEqual({ error: "bad_request" });
  });

  it("preparing reserves nothing: the automatic claim still wins the comment", async () => {
    const h = harness();
    await h.prepare();
    expect(await h.claimAuto()).toMatchObject({ claimed: true });
  });
});

describe("InstagramPublicSendCoordinator: one atomic public effect per (account, comment)", () => {
  it("claimConfirm moves the intent and inserts the effect in one transaction", async () => {
    const h = harness();
    await h.prepare();
    const c = await h.claimConfirm();
    expect(c).toMatchObject({
      claimed: true,
      intent: { state: "dispatching", receiptVersion: 2, claimedAt: new Date(T0).toISOString() },
      effect: { actor: `manual:${OP}`, state: "claimed", receiptVersion: 1 },
    });
    // A second claim changes nothing.
    expect(await h.claimConfirm()).toMatchObject({
      claimed: false,
      intent: { state: "dispatching", receiptVersion: 2 },
    });
    expect(await h.claimAuto()).toMatchObject({
      claimed: false,
      effect: { actor: `manual:${OP}`, state: "claimed" },
    });
  });

  it("manual after automatic: the intent becomes already_claimed (truthful, terminal) and nothing is claimed", async () => {
    const h = harness();
    await h.prepare();
    expect(await h.claimAuto()).toMatchObject({
      claimed: true,
      effect: { actor: "auto:lut", state: "claimed" },
    });
    const c = await h.claimConfirm();
    expect(c).toMatchObject({
      claimed: false,
      intent: {
        state: "already_claimed",
        failureCode: "already_claimed",
        failureDetail: "automatic",
        receiptVersion: 2,
      },
    });
    expect(c).not.toHaveProperty("intent.claimedAt");
    expect(await h.effect()).toMatchObject({ effect: { actor: "auto:lut", state: "claimed" } });
    // Terminal: repeats and cancel answer the same.
    expect(stateOf(await h.claimConfirm())).toBe("already_claimed");
    expect(stateOf(await h.run({ op: "cancel", operationId: OP, now: T0 }))).toBe(
      "already_claimed",
    );
  });

  it("two manual operations on one comment: the second is already_claimed by a manual actor", async () => {
    const h = harness();
    await h.prepare();
    await h.prepare({ operationId: "op-bbbbbbbb", digest: D2, text: "other" });
    expect(claimed(await h.claimConfirm())).toBe(true);
    expect(await h.claimConfirm("op-bbbbbbbb", D2)).toMatchObject({
      claimed: false,
      intent: { state: "already_claimed", failureDetail: "manual" },
    });
  });

  it("duplicate automatic claims (two poll ticks, two rules): exactly one wins, the loser gets the row", async () => {
    const h = harness();
    const answers = await Promise.all([h.claimAuto("lut"), h.claimAuto("lut"), h.claimAuto("cam")]);
    expect(answers.filter((a) => claimed(a))).toHaveLength(1);
    for (const a of answers) expect(a).toMatchObject({ effect: { actor: "auto:lut" } });
  });

  it("accounts and comments are isolated", async () => {
    const h = harness();
    expect(claimed(await h.claimAuto("lut", COMMENT, ACC))).toBe(true);
    expect(claimed(await h.claimAuto("lut", COMMENT, "17841000000000002"))).toBe(true);
    expect(claimed(await h.claimAuto("lut", "17900000000000002", ACC))).toBe(true);
  });

  it("a digest that differs is a conflict and claims nothing", async () => {
    const h = harness();
    await h.prepare();
    expect(await h.claimConfirm(OP, D2)).toEqual({ error: "conflict" });
    expect(await h.claimConfirm("op-zzzzzzzz")).toEqual({ error: "not_found" });
    expect(await h.effect()).toEqual({ error: "not_found" });
  });
});

describe("InstagramPublicSendCoordinator.settle", () => {
  it("settles the effect once and mirrors a manual outcome into its intent", async () => {
    const h = harness();
    await h.prepare();
    await h.claimConfirm();
    const s = await h.settle(`manual:${OP}`, {
      state: "sent",
      providerReplyId: "17950000000000001",
    });
    expect(s).toMatchObject({
      settled: true,
      effect: { state: "sent", providerReplyId: "17950000000000001", receiptVersion: 2 },
      intent: { state: "sent", providerReplyId: "17950000000000001", receiptVersion: 3 },
    });
    const again = await h.settle(`manual:${OP}`, { state: "unknown", reason: "timeout" });
    expect(again).toMatchObject({ settled: false, effect: { state: "sent" } });
    expect(await h.get()).toMatchObject({ intent: { state: "sent", receiptVersion: 3 } });
  });

  it("only the claiming actor settles; `sent` needs a plain reply id", async () => {
    const h = harness();
    await h.claimAuto("lut");
    expect(await h.settle("auto:cam", { state: "rejected", code: "meta_100" })).toMatchObject({
      settled: false,
      effect: { state: "claimed" },
    });
    expect(await h.settle("auto:lut", { state: "sent", providerReplyId: "a/b" })).toEqual({
      error: "bad_request",
    });
    expect(
      await h.settle("auto:lut", { state: "rejected", code: "meta_100", detail: "no" }),
    ).toMatchObject({
      settled: true,
      effect: { state: "rejected", failureCode: "meta_100" },
    });
  });

  it("an unknown manual delivery stays unknown; the effect is never claimable again", async () => {
    const h = harness();
    await h.prepare();
    await h.claimConfirm();
    await h.settle(`manual:${OP}`, { state: "unknown", reason: "timeout" });
    expect(await h.get()).toMatchObject({ intent: { state: "unknown", unknownReason: "timeout" } });
    expect(claimed(await h.claimAuto())).toBe(false);
  });
});

describe("InstagramPublicSendCoordinator: expiry, cancel, retention never reopen a claimed effect", () => {
  it("cancel ends a prepared intent only, and never frees an effect", async () => {
    const h = harness();
    await h.prepare();
    expect(stateOf(await h.run({ op: "cancel", operationId: OP, now: T0 }))).toBe("cancelled");
    await h.prepare({ operationId: "op-bbbbbbbb", draftRevision: "rev-2" });
    await h.claimConfirm("op-bbbbbbbb");
    expect(stateOf(await h.run({ op: "cancel", operationId: "op-bbbbbbbb", now: T0 }))).toBe(
      "dispatching",
    );
    expect(await h.effect()).toMatchObject({ effect: { state: "claimed" } });
  });

  it("an expired review cannot be claimed; a claimed effect outlives expiry", async () => {
    const h = harness();
    await h.prepare();
    expect(stateOf(await h.claimConfirm(OP, D, T0 + 600_000))).toBe("expired");
    expect(await h.effect()).toEqual({ error: "not_found" });
    await h.claimAuto("lut");
    await h.prepare(
      { operationId: "op-bbbbbbbb", draftRevision: "rev-2", reviewExpiresAt: T0 + 1_300_000 },
      T0 + 700_000,
    );
    expect(stateOf(await h.claimConfirm("op-bbbbbbbb", D, T0 + 700_001))).toBe("already_claimed");
  });

  it("past retention, finished rows go to tombstones: purged ids and effects stay unusable; unknown stays", async () => {
    const h = harness();
    // A sent automatic effect, an unknown one, and a sent manual operation.
    await h.claimAuto("lut", "17900000000000001");
    await h.settle("auto:lut", { state: "sent", providerReplyId: "1" }, "17900000000000001");
    await h.claimAuto("lut", "17900000000000002");
    await h.settle("auto:lut", { state: "unknown", reason: "server" }, "17900000000000002");
    await h.prepare({ commentId: "17900000000000003" });
    await h.claimConfirm();
    await h.settle(`manual:${OP}`, { state: "sent", providerReplyId: "2" }, "17900000000000003");
    const later = T0 + RETENTION_MS + 86_400_000;
    // A prepare runs the purge.
    await h.prepare({ operationId: "op-later-01", commentId: "17900000000000009" }, later);
    expect(await h.get(OP, later)).toEqual({ error: "not_found" });
    expect(await h.effect("17900000000000001", ACC, later)).toEqual({ error: "not_found" });
    expect(await h.effect("17900000000000002", ACC, later)).toMatchObject({
      effect: { state: "unknown" },
    });
    // Neither the purged operation id nor the purged effects can be used again.
    expect(await h.prepare({ commentId: "17900000000000003" }, later)).toEqual({
      error: "conflict",
    });
    expect(claimed(await h.claimAuto("cam", "17900000000000001", ACC, later))).toBe(false);
    expect(claimed(await h.claimAuto("cam", "17900000000000003", ACC, later))).toBe(false);
    await h.prepare(
      {
        operationId: "op-later-02",
        commentId: "17900000000000001",
        draftRevision: "r9",
        reviewExpiresAt: later + 600_000,
      },
      later,
    );
    expect(await h.claimConfirm("op-later-02", D, later)).toMatchObject({
      claimed: false,
      intent: { state: "already_claimed", failureDetail: "retired" },
    });
  });
});

/* ---------- DT-6B-2C-1-R1 2C1-7: automatic-only traffic runs the retention purge ---------- */

describe("InstagramPublicSendCoordinator: the purge runs from claimAuto and settle (throttled)", () => {
  const count = (h: ReturnType<typeof harness>, table: string) =>
    Number((h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  const LATE = T0 + RETENTION_MS + 1;

  it("an automatic claim past retention retires an old sent effect into a permanent tombstone", async () => {
    const h = harness();
    await h.claimAuto("lut", "17900000000000001");
    await h.settle("auto:lut", { state: "sent", providerReplyId: "1" }, "17900000000000001");
    await h.claimAuto("lut", "17900000000000002", ACC, LATE);
    expect(await h.effect("17900000000000001", ACC, LATE)).toEqual({ error: "not_found" });
    expect(count(h, "tombstones")).toBeGreaterThan(0);
    // The retired comment can never be claimed again, by any actor, ever.
    expect(claimed(await h.claimAuto("cam", "17900000000000001", ACC, LATE))).toBe(false);
    expect(
      claimed(await h.claimAuto("cam", "17900000000000001", ACC, LATE + 10 * RETENTION_MS)),
    ).toBe(false);
  });

  it("a settlement past retention retires old finished rows too; claimed and unknown are never purged", async () => {
    const h = harness();
    await h.claimAuto("lut", "17900000000000001");
    await h.settle("auto:lut", { state: "rejected", code: "meta_100" }, "17900000000000001");
    await h.claimAuto("lut", "17900000000000002");
    await h.settle("auto:lut", { state: "unknown", reason: "timeout" }, "17900000000000002");
    // Still claimed (a POST may be in flight): never purged.
    await h.claimAuto("lut", "17900000000000003");
    await h.settle(
      "auto:lut",
      { state: "sent", providerReplyId: "2" },
      "17900000000000003",
      LATE + 7_200_000,
    );
    expect(await h.effect("17900000000000001", ACC, LATE)).toEqual({ error: "not_found" });
    expect(await h.effect("17900000000000002", ACC, LATE)).toMatchObject({
      effect: { state: "unknown" },
    });
    expect(await h.effect("17900000000000003", ACC, LATE)).toMatchObject({
      effect: { state: "sent", providerReplyId: "2" },
    });
  });

  it("a claimed effect survives any number of later automatic calls", async () => {
    const h = harness();
    await h.claimAuto("lut", "17900000000000001");
    for (let i = 1; i <= 3; i++)
      await h.claimAuto("lut", `1790000000000010${i}`, ACC, T0 + i * RETENTION_MS);
    expect(await h.effect("17900000000000001", ACC, T0 + 4 * RETENTION_MS)).toMatchObject({
      effect: { state: "claimed", actor: "auto:lut" },
    });
  });

  it("runs at most once an hour: a row due 30 minutes after the last purge waits for the next hour", async () => {
    const h = harness();
    await h.claimAuto("lut", "17900000000000001", ACC, T0);
    await h.settle(
      "auto:lut",
      { state: "sent", providerReplyId: "1" },
      "17900000000000001",
      T0 + 1_800_000,
    );
    // Purge at T0 + 90 d + 1 ms; the row becomes due at T0 + 90 d + 30 min.
    await h.claimAuto("lut", "17900000000000002", ACC, LATE);
    expect(count(h, "public_effects")).toBe(2);
    const due = LATE + 1_800_000;
    await h.claimAuto("lut", "17900000000000003", ACC, due);
    expect(count(h, "public_effects")).toBe(3);
    // An hour after the last purge it runs again.
    await h.claimAuto("lut", "17900000000000004", ACC, LATE + 3_600_000);
    expect(count(h, "public_effects")).toBe(3);
    expect(claimed(await h.claimAuto("cam", "17900000000000001", ACC, LATE + 3_600_000))).toBe(
      false,
    );
  });
});
