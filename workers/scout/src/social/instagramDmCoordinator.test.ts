import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  InstagramDmCoordinator,
  PURGE_EVERY_MS,
  RETENTION_MS,
  type DmAnswer,
  type DmCall,
  type DmOutcome,
  CONTROLS_MAX,
  CONTROL_ROWS_MAX,
  INTENTS_OPEN_MAX,
} from "./instagramDmCoordinator";

// 💬 The existing-conversation DM coordinator (packet DT-6B-2C-2, planning/tools/37-inbox-send.md) over a real SQLite
// engine (node:sqlite, the dialect of a SQLite-backed Durable Object). A fresh coordinator per call over one database
// is a restart between every step. The workerd proof (binding, migration, the real poll, crash/restart) is
// instagramDmCoordinator.runtime.test.ts.

type Storage = ReturnType<typeof sqliteStorage>;

function sqliteStorage(db: DatabaseSync, fail?: (query: string) => boolean) {
  return {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        if (fail?.(query)) throw new Error("storage write failed");
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

const T0 = Date.parse("2026-10-17T09:00:00Z");
const DAY = 86_400_000;
const ACC = "17841000000000001";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const IN1 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE=";
const IN2 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjI=";
const DIGEST = "d".repeat(64);
const GEN = "0".repeat(32);
const GEN2 = "1".repeat(32);

function harness(fail?: (query: string) => boolean) {
  const db = new DatabaseSync(":memory:");
  let storage: Storage = sqliteStorage(db);
  const run = async (call: DmCall | Record<string, unknown>): Promise<DmAnswer> => {
    const c = new InstagramDmCoordinator({ storage } as never);
    const res = await c.fetch(
      new Request("https://instagram-dm-coordinator/", {
        method: "POST",
        body: JSON.stringify(call),
      }),
    );
    return (await res.json()) as DmAnswer;
  };
  // Built once without the fault (the schema), then every later call runs through it.
  void run({ op: "status", account: ACC, conversationId: CONV, now: T0 });
  if (fail) storage = sqliteStorage(db, fail);
  const claim = (over: Record<string, unknown> = {}) =>
    run({
      op: "claim",
      account: ACC,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN1,
      actor: "auto:cam",
      payloadDigest: DIGEST,
      generation: GEN,
      isDefault: false,
      cooldownMs: DAY,
      now: T0,
      ...over,
    });
  const def = (over: Record<string, unknown> = {}) =>
    claim({ actor: "auto:default", isDefault: true, ...over });
  const settle = (outcome: DmOutcome, over: Record<string, unknown> = {}) =>
    run({
      op: "settle",
      account: ACC,
      conversationId: CONV,
      inboundMessageId: IN1,
      actor: "auto:cam",
      outcome,
      now: T0 + 1000,
      ...over,
    });
  const cas = (op: "takeover" | "resume", expectedRevision: number, now = T0) =>
    run({ op, account: ACC, conversationId: CONV, expectedRevision, now });
  const status = (inboundMessageId?: string) =>
    run({
      op: "status",
      account: ACC,
      conversationId: CONV,
      ...(inboundMessageId ? { inboundMessageId } : {}),
      now: T0,
    });
  return { db, run, claim, def, settle, cas, status };
}

const rows = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table}`).all();

describe("InstagramDmCoordinator: one effect per (account, conversation, inbound message)", () => {
  it("claims in one transaction with the full identity, receipt version 1 and the conversation", async () => {
    const h = harness();
    expect(await h.claim()).toEqual({
      result: "claimed",
      effect: {
        account: ACC,
        conversationId: CONV,
        recipientId: PERSON,
        inboundMessageId: IN1,
        actor: "auto:cam",
        payloadDigest: DIGEST,
        generation: GEN,
        state: "claimed",
        claimedAt: new Date(T0).toISOString(),
        receiptVersion: 1,
      },
      conversation: { account: ACC, conversationId: CONV, mode: "auto", revision: 0 },
    });
  });

  it("the same inbound event is already_claimed for another actor, a duplicate poll and a reconnect", async () => {
    const h = harness();
    const won = await h.claim();
    for (const over of [
      { actor: "manual:op-aaaaaaaa" },
      {},
      { generation: GEN2, payloadDigest: "e".repeat(64) },
    ]) {
      const again = await h.claim({ ...over, now: T0 + 5000 });
      expect(again).toMatchObject({ result: "already_claimed" });
      expect((again as { effect: unknown }).effect).toEqual((won as { effect: unknown }).effect);
    }
    expect(rows(h.db, "effects")).toHaveLength(1);
  });

  it("a later inbound turn in the same conversation is never locked by an earlier effect", async () => {
    const h = harness();
    await h.claim();
    await h.settle({ state: "unknown", reason: "timeout" });
    expect(await h.claim({ inboundMessageId: IN2 })).toMatchObject({
      result: "claimed",
      effect: { inboundMessageId: IN2, state: "claimed" },
    });
  });

  it("accounts and conversations are isolated", async () => {
    const h = harness();
    await h.claim();
    expect(await h.claim({ account: "17841000000000002" })).toMatchObject({ result: "claimed" });
    expect(await h.claim({ conversationId: "other-conv" })).toMatchObject({ result: "claimed" });
  });

  it("refuses malformed input: ids that could become a path, actors, digests, default without its actor", async () => {
    const h = harness();
    for (const over of [
      { account: "../me" },
      { conversationId: "a/b" },
      { recipientId: "" },
      { inboundMessageId: "x|y" },
      { actor: "cron" },
      { actor: "auto:" },
      { payloadDigest: "zz" },
      { generation: "g" },
      { isDefault: "yes" },
      { isDefault: true },
      { actor: "auto:default", isDefault: false },
      { cooldownMs: -1 },
      { cooldownMs: 1.5 },
      { now: "soon" },
    ])
      expect(await h.claim(over)).toEqual({ error: "bad_request" });
    expect(await h.run({ op: "nope", now: T0 })).toEqual({ error: "bad_request" });
    expect(rows(h.db, "effects")).toEqual([]);
  });
});

describe("InstagramDmCoordinator: the default reply's per-recipient cooldown is part of the claim", () => {
  it("two different inbound events for one recipient: one claim, the other is cooldown", async () => {
    const h = harness();
    const first = await h.def();
    expect(first).toMatchObject({ result: "claimed" });
    expect(await h.def({ inboundMessageId: IN2, conversationId: "conv-2" })).toEqual({
      result: "cooldown",
      cooldown: {
        account: ACC,
        recipientId: PERSON,
        lastDefaultAt: new Date(T0).toISOString(),
        effectKey: `effect|${ACC}|${CONV}|${IN1}`,
      },
      conversation: { account: ACC, conversationId: "conv-2", mode: "auto", revision: 0 },
    });
    // A rule's answer is not the default reply: no cooldown.
    expect(await h.claim({ inboundMessageId: IN2 })).toMatchObject({ result: "claimed" });
    // Another person is not held back.
    expect(
      await h.def({ recipientId: "990000000000002", conversationId: "c3", inboundMessageId: "i3" }),
    ).toMatchObject({ result: "claimed" });
    // Once the cooldown has passed, the same person can get the default reply again.
    expect(await h.def({ inboundMessageId: "i4", now: T0 + DAY })).toMatchObject({
      result: "claimed",
    });
  });

  it("the cooldown stays reserved after sent and after unknown delivery", async () => {
    for (const outcome of [
      { state: "sent", providerMessageId: "mid.1" },
      { state: "unknown", reason: "timeout" },
    ] as DmOutcome[]) {
      const h = harness();
      await h.def();
      expect(await h.settle(outcome, { actor: "auto:default" })).toMatchObject({ settled: true });
      expect(await h.def({ inboundMessageId: IN2, now: T0 + 60_000 })).toMatchObject({
        result: "cooldown",
      });
    }
  });

  it("a typed refusal releases the cooldown; the refused event itself is never claimable again", async () => {
    const h = harness();
    await h.def();
    await h.settle({ state: "rejected", code: "meta_10" }, { actor: "auto:default" });
    expect(await h.def({ inboundMessageId: IN2, now: T0 + 60_000 })).toMatchObject({
      result: "claimed",
    });
    expect(await h.def({ now: T0 + 2 * DAY })).toMatchObject({
      result: "already_claimed",
      effect: { state: "rejected" },
    });
  });

  it("a clock that moved back keeps the cooldown (conservative)", async () => {
    const h = harness();
    await h.def();
    expect(await h.def({ inboundMessageId: IN2, now: T0 - 60_000 })).toMatchObject({
      result: "cooldown",
    });
  });
});

describe("InstagramDmCoordinator: settle once, by the claiming actor, with state-specific proof", () => {
  it("records sent with its message id and bumps the receipt version; a repeat is settled: false", async () => {
    const h = harness();
    await h.claim();
    const out = await h.settle({ state: "sent", providerMessageId: "mid.1" });
    expect(out).toEqual({
      settled: true,
      effect: expect.objectContaining({
        state: "sent",
        providerMessageId: "mid.1",
        settledAt: new Date(T0 + 1000).toISOString(),
        receiptVersion: 2,
      }),
    });
    expect(await h.settle({ state: "unknown", reason: "timeout" })).toMatchObject({
      settled: false,
      effect: { state: "sent", receiptVersion: 2 },
    });
  });

  it("only the claiming actor settles; every outcome needs its proof", async () => {
    const h = harness();
    await h.claim();
    expect(
      await h.settle({ state: "sent", providerMessageId: "mid.1" }, { actor: "auto:other" }),
    ).toMatchObject({ settled: false, effect: { state: "claimed" } });
    for (const outcome of [
      { state: "sent", providerMessageId: "" },
      { state: "sent" },
      { state: "rejected", code: "" },
      { state: "unknown", reason: "" },
      { state: "claimed" },
      null,
    ])
      expect(await h.settle(outcome as never)).toEqual({ error: "bad_request" });
    expect(
      await h.settle({ state: "sent", providerMessageId: "m" }, { inboundMessageId: IN2 }),
    ).toEqual({ error: "not_found" });
    expect(await h.status(IN1)).toMatchObject({ effect: { state: "claimed", receiptVersion: 1 } });
  });

  it("rejected keeps its code and unknown its reason", async () => {
    const h = harness();
    await h.claim();
    expect(await h.settle({ state: "rejected", code: "meta_10" })).toMatchObject({
      effect: { state: "rejected", failureCode: "meta_10" },
    });
    await h.claim({ inboundMessageId: IN2 });
    expect(
      await h.settle({ state: "unknown", reason: "redirect" }, { inboundMessageId: IN2 }),
    ).toMatchObject({ effect: { state: "unknown", unknownReason: "redirect" } });
  });
});

describe("InstagramDmCoordinator: takeover and resume are explicit compare-and-set operations", () => {
  it("takeover before an automatic claim blocks it; a manual claim (the person's own send) still works", async () => {
    const h = harness();
    expect(await h.cas("takeover", 0)).toEqual({
      changed: true,
      conversation: {
        account: ACC,
        conversationId: CONV,
        mode: "human",
        revision: 1,
        updatedAt: new Date(T0).toISOString(),
      },
      inFlight: [],
    });
    expect(await h.claim()).toEqual({
      result: "blocked_by_takeover",
      conversation: expect.objectContaining({ mode: "human", revision: 1 }),
    });
    expect(await h.def()).toMatchObject({ result: "blocked_by_takeover" });
    expect(rows(h.db, "default_cooldown")).toEqual([]);
    expect(await h.claim({ actor: "manual:op-aaaaaaaa" })).toMatchObject({ result: "claimed" });
  });

  it("takeover after a winning claim reports the in-flight attempt honestly and blocks later automatic claims", async () => {
    const h = harness();
    const won = await h.claim();
    const t = await h.cas("takeover", 0);
    expect(t).toMatchObject({ changed: true, conversation: { mode: "human", revision: 1 } });
    expect((t as { inFlight: unknown[] }).inFlight).toEqual([(won as { effect: unknown }).effect]);
    // The authorized attempt still settles truthfully.
    expect(await h.settle({ state: "sent", providerMessageId: "mid.1" })).toMatchObject({
      settled: true,
    });
    expect(await h.claim({ inboundMessageId: IN2 })).toMatchObject({
      result: "blocked_by_takeover",
    });
  });

  it("a stale revision is a conflict and changes nothing; resume needs the current revision", async () => {
    const h = harness();
    await h.cas("takeover", 0);
    expect(await h.cas("takeover", 0)).toMatchObject({
      error: "conflict",
      conversation: { mode: "human", revision: 1 },
    });
    expect(await h.cas("resume", 0)).toMatchObject({ error: "conflict" });
    // The same revision again is a no-op, not a second bump.
    expect(await h.cas("takeover", 1)).toMatchObject({
      changed: false,
      conversation: { mode: "human", revision: 1 },
    });
    expect(await h.cas("resume", 1, T0 + 10)).toMatchObject({
      changed: true,
      conversation: { mode: "auto", revision: 2 },
    });
    expect(await h.cas("resume", 2)).toMatchObject({ changed: false });
    expect(await h.claim()).toMatchObject({ result: "claimed" });
    expect(await h.cas("takeover", 0)).toMatchObject({ error: "conflict" });
    expect(await h.cas("takeover", -1)).toEqual({ error: "bad_request" });
  });

  it("resume never frees a claimed or unknown effect; nothing times out", async () => {
    const h = harness();
    await h.claim();
    await h.claim({ inboundMessageId: IN2 });
    await h.settle({ state: "unknown", reason: "timeout" }, { inboundMessageId: IN2 });
    await h.cas("takeover", 0, T0 + 1);
    await h.cas("resume", 1, T0 + 2);
    for (const inbound of [IN1, IN2])
      expect(await h.claim({ inboundMessageId: inbound, now: T0 + 400 * DAY })).toMatchObject({
        result: "already_claimed",
      });
    expect(await h.status(IN1)).toMatchObject({
      conversation: { mode: "auto", revision: 2 },
      effect: { state: "claimed" },
    });
  });

  it("status answers the conversation (auto at revision 0 when untouched) and the effect", async () => {
    const h = harness();
    expect(await h.status()).toEqual({
      conversation: { account: ACC, conversationId: CONV, mode: "auto", revision: 0 },
    });
    await h.claim();
    expect(await h.status(IN1)).toMatchObject({ effect: { inboundMessageId: IN1 } });
    expect(await h.status(IN2)).toEqual({
      conversation: { account: ACC, conversationId: CONV, mode: "auto", revision: 0 },
    });
  });
});

describe("InstagramDmCoordinator: storage failures roll back", () => {
  it("a failed cooldown write rolls the effect insert back: nothing claimed, the retry claims", async () => {
    let broken = true;
    const h = harness((q) => broken && /INSERT INTO default_cooldown/.test(q));
    await expect(h.def()).rejects.toThrow();
    expect(rows(h.db, "effects")).toEqual([]);
    broken = false;
    expect(await h.def()).toMatchObject({ result: "claimed" });
  });

  it("a failed takeover write leaves the conversation as it was", async () => {
    let broken = true;
    const h = harness((q) => broken && /INSERT INTO conversations/.test(q));
    await expect(h.cas("takeover", 0)).rejects.toThrow();
    broken = false;
    expect(await h.status()).toMatchObject({ conversation: { mode: "auto", revision: 0 } });
  });
});

describe("InstagramDmCoordinator: retention (automatic traffic purges, throttled, permanent tombstones)", () => {
  it("settled rows past 90 days become tombstones; a purged event stays unclaimable; claimed and unknown stay", async () => {
    const h = harness();
    await h.claim();
    await h.settle({ state: "sent", providerMessageId: "mid.1" });
    await h.claim({ inboundMessageId: IN2 });
    await h.settle({ state: "unknown", reason: "timeout" }, { inboundMessageId: IN2 });
    await h.claim({ inboundMessageId: "in3" });
    const later = T0 + RETENTION_MS + DAY;
    // An automatic claim of another event runs the purge.
    await h.claim({ inboundMessageId: "in4", now: later });
    const left = (rows(h.db, "effects") as { inbound_message_id: string }[])
      .map((r) => r.inbound_message_id)
      .sort();
    expect(left).toEqual([IN2, "in3", "in4"].sort());
    expect(rows(h.db, "tombstones")).toEqual([{ key: `effect|${ACC}|${CONV}|${IN1}` }]);
    expect(await h.claim({ now: later + PURGE_EVERY_MS * 2 })).toEqual({
      result: "already_claimed",
      retired: true,
      conversation: { account: ACC, conversationId: CONV, mode: "auto", revision: 0 },
    });
  });

  it("runs at most once an hour (the last run in meta); a settlement also runs it", async () => {
    const h = harness();
    await h.claim();
    await h.settle({ state: "rejected", code: "meta_100" }, { now: T0 });
    const due = T0 + RETENTION_MS + 1;
    // A purge that runs just before the row is due.
    await h.claim({ inboundMessageId: "a1", now: due - 1 });
    await h.settle(
      { state: "sent", providerMessageId: "m" },
      { inboundMessageId: "a1", now: due + 1 },
    );
    expect(rows(h.db, "tombstones")).toEqual([]);
    await h.settle(
      { state: "sent", providerMessageId: "m" },
      { inboundMessageId: "a1", now: due + PURGE_EVERY_MS },
    );
    expect(rows(h.db, "tombstones")).toHaveLength(1);
  });

  it("a failed purge rolls back (meta included), so the next call retries it", async () => {
    let broken = false;
    const h = harness((q) => broken && /INSERT OR IGNORE INTO tombstones/.test(q));
    await h.claim();
    await h.settle({ state: "sent", providerMessageId: "m" });
    broken = true;
    const later = T0 + RETENTION_MS + DAY;
    await expect(h.claim({ inboundMessageId: IN2, now: later })).rejects.toThrow();
    expect(rows(h.db, "effects")).toHaveLength(1);
    broken = false;
    await h.claim({ inboundMessageId: IN2, now: later + 1 });
    expect(rows(h.db, "tombstones")).toHaveLength(1);
  });

  it("takeover and status never purge", async () => {
    const h = harness();
    await h.claim();
    await h.settle({ state: "sent", providerMessageId: "m" });
    await h.cas("takeover", 0, T0 + RETENTION_MS + DAY);
    await h.status(IN1);
    expect(rows(h.db, "tombstones")).toEqual([]);
  });
});

/* ---------- DT-6B-2C-3: reviewed manual intents and verified control handles ---------- */

const OP = "op-dm-00000001";
const OP2 = "op-dm-00000002";
const TEXT = "Hi Sara, it is an iPhone 16 Pro.";
const INBOUND_AT = T0 - 60_000;

function manual(fail?: (query: string) => boolean) {
  const h = harness(fail);
  const input = (over: Record<string, unknown> = {}) => ({
    operationId: OP,
    account: ACC,
    generation: GEN,
    conversationId: CONV,
    recipientId: PERSON,
    inboundMessageId: IN1,
    inboundAt: INBOUND_AT,
    text: TEXT,
    digest: DIGEST,
    draftRevision: "rev-1",
    reviewExpiresAt: T0 + 600_000,
    ...over,
  });
  const prepare = (over: Record<string, unknown> = {}, now = T0) =>
    h.run({ op: "prepareIntent", input: input(over), now });
  const confirm = (operationId = OP, now = T0 + 1000, digest = DIGEST) =>
    h.run({ op: "claimConfirm", account: ACC, operationId, digest, now });
  const settleManual = (outcome: DmOutcome, operationId = OP, now = T0 + 2000) =>
    h.run({ op: "settleManual", account: ACC, operationId, outcome, now });
  const get = (operationId = OP, now = T0 + 3000) =>
    h.run({ op: "getIntent", account: ACC, operationId, now });
  const cancel = (operationId = OP, now = T0 + 3000) =>
    h.run({ op: "cancelIntent", account: ACC, operationId, now });
  const register = (over: Record<string, unknown> = {}, now = T0) =>
    h.run({
      op: "registerControl",
      account: ACC,
      conversationId: CONV,
      recipientId: PERSON,
      generation: GEN,
      evidenceDigest: DIGEST,
      now,
      ...over,
    });
  const control = (
    op: "controlStatus" | "controlTakeover" | "controlResume",
    handleId: unknown,
    over: Record<string, unknown> = {},
  ) => h.run({ op, account: ACC, handleId, now: T0 + 5000, ...over });
  return { ...h, input, prepare, confirm, settleManual, get, cancel, register, control };
}

type AnyAnswer = Record<string, unknown> & {
  intent?: Record<string, unknown>;
  effect?: Record<string, unknown>;
  control?: Record<string, unknown>;
  inFlight?: unknown[];
};
const A = (a: unknown) => a as AnyAnswer;

describe("DT-6B-2C-3 coordinator: immutable manual intents (prepare sends nothing, never changes mode)", () => {
  it("prepare stores the full immutable intent at receipt version 1; no effect, mode untouched", async () => {
    const h = manual();
    expect(await h.prepare()).toEqual({
      intent: {
        operationId: OP,
        account: ACC,
        generation: GEN,
        conversationId: CONV,
        recipientId: PERSON,
        inboundMessageId: IN1,
        inboundAt: new Date(INBOUND_AT).toISOString(),
        text: TEXT,
        digest: DIGEST,
        draftRevision: "rev-1",
        state: "prepared",
        reviewExpiresAt: new Date(T0 + 600_000).toISOString(),
        createdAt: new Date(T0).toISOString(),
        updatedAt: new Date(T0).toISOString(),
        receiptVersion: 1,
      },
    });
    expect(rows(h.db, "effects")).toEqual([]);
    expect(rows(h.db, "conversations")).toEqual([]);
  });

  it("the same operation and payload converge; any changed immutable field is a conflict; ids never repurpose", async () => {
    const h = manual();
    const first = A(await h.prepare()).intent;
    expect(A(await h.prepare({}, T0 + 10)).intent).toEqual(first);
    for (const over of [
      { text: "other" },
      { digest: "e".repeat(64) },
      { inboundMessageId: IN2 },
      { inboundAt: INBOUND_AT + 1 },
      { recipientId: "990000000000002" },
      { conversationId: "conv-2" },
      { generation: GEN2 },
      { draftRevision: "rev-2" },
    ])
      expect(await h.prepare(over)).toEqual({ error: "conflict" });
    expect(rows(h.db, "intents")).toHaveLength(1);
  });

  it("another operation converges only on the identical live submission; a different generation is its own intent", async () => {
    const h = manual();
    await h.prepare();
    expect(A(await h.prepare({ operationId: OP2 })).intent).toMatchObject({ operationId: OP });
    expect(A(await h.prepare({ operationId: OP2, generation: GEN2 })).intent).toMatchObject({
      operationId: OP2,
      generation: GEN2,
    });
    expect(rows(h.db, "intents")).toHaveLength(2);
  });

  it("refuses malformed input", async () => {
    const h = manual();
    for (const over of [
      { operationId: "short" },
      { account: "../me" },
      { conversationId: "a/b" },
      { recipientId: "" },
      { inboundMessageId: "x|y" },
      { inboundAt: "yesterday" },
      { text: "" },
      { text: 5 },
      { digest: "zz" },
      { generation: "g" },
      { draftRevision: "a b" },
      { reviewExpiresAt: T0 },
    ])
      expect(await h.prepare(over)).toEqual({ error: "bad_request" });
    expect(rows(h.db, "intents")).toEqual([]);
  });

  it("a foreign account never reads, confirms, settles or cancels the intent", async () => {
    const h = manual();
    await h.prepare();
    for (const op of ["getIntent", "cancelIntent", "claimConfirm", "settleManual"])
      expect(
        await h.run({
          op,
          account: "17841000000000002",
          operationId: OP,
          digest: DIGEST,
          outcome: { state: "sent", providerMessageId: "m" },
          now: T0,
        }),
      ).toEqual({ error: "not_found" });
    expect(await h.get("op-unknown-0001")).toEqual({ error: "not_found" });
  });
});

describe("DT-6B-2C-3 coordinator: claimConfirm is one transaction over the automation's effect", () => {
  it("claims the same (account, conversation, inbound) effect as actor manual:<op> and marks the intent dispatching", async () => {
    const h = manual();
    await h.prepare();
    const won = A(await h.confirm());
    expect(won.claimed).toBe(true);
    expect(won.intent).toMatchObject({
      state: "dispatching",
      claimedAt: new Date(T0 + 1000).toISOString(),
      receiptVersion: 2,
    });
    expect(won.effect).toEqual({
      account: ACC,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN1,
      actor: `manual:${OP}`,
      payloadDigest: DIGEST,
      generation: GEN,
      state: "claimed",
      claimedAt: new Date(T0 + 1000).toISOString(),
      receiptVersion: 1,
    });
    // The automation's next claim of that inbound event loses, whatever its actor.
    expect(await h.claim({ now: T0 + 2000 })).toMatchObject({ result: "already_claimed" });
    // A repeated confirm reads the durable state: no second effect, no second dispatch.
    const again = A(await h.confirm(OP, T0 + 3000));
    expect(again).toMatchObject({
      claimed: false,
      intent: { state: "dispatching", receiptVersion: 2 },
    });
    expect(rows(h.db, "effects")).toHaveLength(1);
  });

  it("automation first: the manual confirm is already_claimed (automatic), terminal and truthful", async () => {
    const h = manual();
    await h.prepare();
    const auto = A(await h.claim());
    const lost = A(await h.confirm());
    expect(lost).toMatchObject({
      claimed: false,
      intent: {
        state: "already_claimed",
        failureCode: "already_claimed",
        failureDetail: "automatic",
        receiptVersion: 2,
      },
    });
    expect(lost.effect).toEqual(auto.effect);
    expect(lost.intent?.claimedAt).toBeUndefined();
  });

  it("manual first in either mode: the person's own send works under takeover and never changes the mode", async () => {
    const h = manual();
    await h.cas("takeover", 0);
    await h.prepare();
    expect(A(await h.confirm()).claimed).toBe(true);
    expect(await h.status()).toMatchObject({ conversation: { mode: "human", revision: 1 } });
    const h2 = manual();
    await h2.prepare();
    expect(A(await h2.confirm()).claimed).toBe(true);
    expect(await h2.status()).toEqual({
      conversation: { account: ACC, conversationId: CONV, mode: "auto", revision: 0 },
    });
  });

  it("two operations for one inbound event: one claim, the other already_claimed (manual)", async () => {
    const h = manual();
    await h.prepare();
    await h.prepare({ operationId: OP2, generation: GEN2 });
    expect(A(await h.confirm(OP)).claimed).toBe(true);
    expect(A(await h.confirm(OP2)).intent).toMatchObject({
      state: "already_claimed",
      failureDetail: "manual",
    });
  });

  it("a purged (tombstoned) inbound event is already_claimed (retired)", async () => {
    const h = manual();
    await h.claim();
    await h.settle({ state: "sent", providerMessageId: "m" });
    const later = T0 + RETENTION_MS + DAY;
    await h.claim({ inboundMessageId: "in4", now: later });
    await h.prepare({ reviewExpiresAt: later + 600_000 }, later);
    expect(A(await h.confirm(OP, later + 1)).intent).toMatchObject({
      state: "already_claimed",
      failureDetail: "retired",
    });
  });

  it("a changed digest is a conflict and claims nothing", async () => {
    const h = manual();
    await h.prepare();
    expect(await h.confirm(OP, T0 + 1000, "e".repeat(64))).toEqual({ error: "conflict" });
    expect(rows(h.db, "effects")).toEqual([]);
  });

  it("a failed intent write rolls the effect insert back: nothing claimed, the retry claims", async () => {
    let broken = true;
    const h = manual((q) => broken && /SET state = 'dispatching'/.test(q));
    await h.prepare();
    await expect(h.confirm()).rejects.toThrow();
    expect(rows(h.db, "effects")).toEqual([]);
    expect(A(await h.get()).intent).toMatchObject({ state: "prepared", receiptVersion: 1 });
    broken = false;
    expect(A(await h.confirm()).claimed).toBe(true);
  });
});

describe("DT-6B-2C-3 coordinator: settlement updates the effect and the intent atomically", () => {
  it("sent: both record the message id, versions step once; a repeat is settled: false and changes nothing", async () => {
    const h = manual();
    await h.prepare();
    await h.confirm();
    const s = A(await h.settleManual({ state: "sent", providerMessageId: "mid.1" }));
    expect(s.settled).toBe(true);
    expect(s.effect).toMatchObject({
      state: "sent",
      providerMessageId: "mid.1",
      receiptVersion: 2,
    });
    expect(s.intent).toMatchObject({
      state: "sent",
      providerMessageId: "mid.1",
      settledAt: new Date(T0 + 2000).toISOString(),
      receiptVersion: 3,
    });
    const again = A(await h.settleManual({ state: "rejected", code: "meta_10" }, OP, T0 + 9000));
    expect(again.settled).toBe(false);
    expect(again.intent).toEqual(s.intent);
    expect(again.effect).toEqual(s.effect);
  });

  it("rejected keeps its code, unknown its reason; every outcome needs its proof", async () => {
    for (const outcome of [
      { state: "rejected", code: "meta_100" },
      { state: "unknown", reason: "timeout" },
    ] as DmOutcome[]) {
      const h = manual();
      await h.prepare();
      await h.confirm();
      const s = A(await h.settleManual(outcome));
      expect(s.intent).toMatchObject({ state: outcome.state, receiptVersion: 3 });
      expect(s.effect).toMatchObject({ state: outcome.state });
    }
    const h = manual();
    await h.prepare();
    await h.confirm();
    for (const bad of [
      { state: "sent" },
      { state: "sent", providerMessageId: "has space" },
      { state: "rejected", code: "Bad Code" },
      { state: "unknown" },
      { state: "maybe" },
    ])
      expect(await h.settleManual(bad as DmOutcome)).toEqual({ error: "bad_request" });
  });

  it("a prepared or already_claimed intent has no effect of its own to settle", async () => {
    const h = manual();
    await h.prepare();
    expect(await h.settleManual({ state: "sent", providerMessageId: "m" })).toEqual({
      error: "not_found",
    });
    await h.claim();
    await h.confirm();
    const s = A(await h.settleManual({ state: "sent", providerMessageId: "m" }));
    expect(s.settled).toBe(false);
    expect(s.intent).toMatchObject({ state: "already_claimed" });
    expect(s.effect).toMatchObject({ actor: "auto:cam", state: "claimed" });
  });

  it("a failed intent write rolls the effect settlement back: still claimed and dispatching", async () => {
    let broken = false;
    const h = manual((q) => broken && /UPDATE intents SET state = \?/.test(q));
    await h.prepare();
    await h.confirm();
    broken = true;
    await expect(h.settleManual({ state: "sent", providerMessageId: "m" })).rejects.toThrow();
    expect(await h.status(IN1)).toMatchObject({ effect: { state: "claimed", receiptVersion: 1 } });
    expect(A(await h.get()).intent).toMatchObject({ state: "dispatching", receiptVersion: 2 });
  });

  it("the automatic settle of a manual actor's effect also settles its intent (one authority)", async () => {
    const h = manual();
    await h.prepare();
    await h.confirm();
    const s = A(await h.settle({ state: "unknown", reason: "timeout" }, { actor: `manual:${OP}` }));
    expect(s.intent).toMatchObject({ state: "unknown", unknownReason: "timeout" });
  });
});

describe("DT-6B-2C-3 coordinator: cancel, expiry, capacity", () => {
  it("cancel ends a prepared intent only; confirm after cancel claims nothing; cancel after confirm changes nothing", async () => {
    const h = manual();
    await h.prepare();
    expect(A(await h.cancel()).intent).toMatchObject({ state: "cancelled", receiptVersion: 2 });
    expect(A(await h.confirm()).intent).toMatchObject({ state: "cancelled" });
    expect(rows(h.db, "effects")).toEqual([]);
    const h2 = manual();
    await h2.prepare();
    await h2.confirm();
    expect(A(await h2.cancel()).intent).toMatchObject({ state: "dispatching", receiptVersion: 2 });
  });

  it("a prepared intent past its deadline expires (operation tombstoned) and is never claimed", async () => {
    const h = manual();
    await h.prepare();
    const expired = A(await h.confirm(OP, T0 + 600_000));
    expect(expired).toMatchObject({
      claimed: false,
      intent: { state: "expired", receiptVersion: 2 },
    });
    expect(rows(h.db, "effects")).toEqual([]);
    expect(rows(h.db, "tombstones")).toEqual([{ key: `op|${OP}` }]);
    // The same payload reads the expired intent; it never comes back to life.
    expect(
      A(await h.prepare({ reviewExpiresAt: T0 + 1_300_000 }, T0 + 700_000)).intent,
    ).toMatchObject({ state: "expired" });
  });

  it("open intents are finite: capacity is refused explicitly; expired ones free room, dispatching never evicted", async () => {
    const h = manual();
    const cap = (i: number) => `op-cap-${String(i).padStart(6, "0")}`;
    for (let i = 0; i < INTENTS_OPEN_MAX; i++)
      expect(
        A(await h.prepare({ operationId: cap(i), inboundMessageId: `in-${i}` })).intent,
      ).toBeDefined();
    await h.confirm(cap(0));
    const over = { operationId: "op-cap-over", inboundMessageId: "in-over" };
    expect(await h.prepare(over)).toEqual({ error: "capacity" });
    const later = T0 + 600_000;
    expect(
      A(await h.prepare({ ...over, reviewExpiresAt: later + 600_000 }, later)).intent,
    ).toMatchObject({ state: "prepared" });
    expect(A(await h.get(cap(0), later)).intent).toMatchObject({ state: "dispatching" });
  });
});

describe("DT-6B-2C-3 coordinator: verified control handles and offline revision CAS", () => {
  it("registration mints an opaque handle; a repeat converges; another recipient is a conflict", async () => {
    const h = manual();
    const r = A(await h.register());
    const handle = r.control?.handleId as string;
    expect(handle).toMatch(/^[0-9a-f]{32}$/);
    expect(r).toMatchObject({
      control: {
        account: ACC,
        conversationId: CONV,
        recipientId: PERSON,
        registeredGeneration: GEN,
      },
      conversation: { mode: "auto", revision: 0 },
      inFlight: [],
      inFlightTotal: 0,
      inFlightTruncated: false,
      uncertainTotal: 0,
    });
    expect(A(await h.register({ generation: GEN2 }, T0 + 10)).control).toMatchObject({
      handleId: handle,
      registeredGeneration: GEN2,
    });
    expect(await h.register({ recipientId: "990000000000002" })).toEqual({ error: "conflict" });
    expect(rows(h.db, "controls")).toHaveLength(1);
    // Registration itself never changes the mode.
    expect(rows(h.db, "conversations")).toEqual([]);
  });

  it("status, takeover and resume need an existing handle of this account; raw selectors create nothing", async () => {
    const h = manual();
    for (const op of ["controlStatus", "controlTakeover", "controlResume"] as const) {
      expect(await h.control(op, "0".repeat(32), { expectedRevision: 0 })).toEqual({
        error: "not_found",
      });
      expect(await h.control(op, CONV, { expectedRevision: 0 })).toEqual({ error: "bad_request" });
    }
    const handle = A(await h.register()).control?.handleId;
    expect(await h.control("controlStatus", handle, { account: "17841000000000002" })).toEqual({
      error: "not_found",
    });
    expect(rows(h.db, "controls")).toHaveLength(1);
    expect(rows(h.db, "conversations")).toEqual([]);
  });

  it("takeover/resume are revision CAS with truthful conflicts; takeover blocks automation, never the manual send", async () => {
    const h = manual();
    const handle = A(await h.register()).control?.handleId;
    expect(await h.control("controlResume", handle, { expectedRevision: 1 })).toMatchObject({
      error: "conflict",
      conversation: { revision: 0 },
    });
    expect(await h.control("controlTakeover", handle, { expectedRevision: 0 })).toMatchObject({
      changed: true,
      conversation: { mode: "human", revision: 1 },
      inFlight: [],
      inFlightTotal: 0,
    });
    expect(await h.control("controlTakeover", handle, { expectedRevision: 0 })).toMatchObject({
      error: "conflict",
      conversation: { mode: "human", revision: 1 },
    });
    expect(await h.claim()).toMatchObject({ result: "blocked_by_takeover" });
    await h.prepare();
    expect(A(await h.confirm()).claimed).toBe(true);
    expect(await h.control("controlStatus", handle)).toMatchObject({
      conversation: { mode: "human", revision: 1 },
      inFlightTotal: 1,
    });
    expect(await h.control("controlResume", handle, { expectedRevision: 1 })).toMatchObject({
      changed: true,
      conversation: { mode: "auto", revision: 2 },
    });
    // Resume freed nothing: the claimed effect still holds the inbound event.
    expect(await h.claim()).toMatchObject({ result: "already_claimed" });
  });

  it("takeover after claims reports the in-flight attempts, bounded, with a truthful total and uncertainty", async () => {
    const h = manual();
    const handle = A(await h.register()).control?.handleId;
    for (let i = 0; i < CONTROL_ROWS_MAX + 5; i++)
      await h.claim({ inboundMessageId: `in-${i}`, now: T0 + i });
    await h.claim({ inboundMessageId: "in-u" });
    await h.settle({ state: "unknown", reason: "timeout" }, { inboundMessageId: "in-u" });
    const t = A(await h.control("controlTakeover", handle, { expectedRevision: 0 }));
    expect(t.inFlight).toHaveLength(CONTROL_ROWS_MAX);
    expect(t.inFlightTotal).toBe(CONTROL_ROWS_MAX + 5);
    expect(t.inFlightTruncated).toBe(true);
    expect(t.uncertainTotal).toBe(1);
    // The mutation ran once: the revision moved exactly one step.
    expect(t.conversation).toMatchObject({ mode: "human", revision: 1 });
    expect((t.inFlight![0] as { inboundMessageId: string }).inboundMessageId).toBe("in-0");
  });

  it("control handles are finite: capacity refused explicitly", async () => {
    const h = manual();
    for (let i = 0; i < CONTROLS_MAX; i++)
      expect(A(await h.register({ conversationId: `conv-${i}` })).control).toBeDefined();
    expect(await h.register({ conversationId: "conv-over" })).toEqual({ error: "capacity" });
    // A repeat of a registered target still converges.
    expect(A(await h.register({ conversationId: "conv-0" })).control).toBeDefined();
  });

  it("a failed takeover write leaves the conversation as it was", async () => {
    let broken = false;
    const h = manual((q) => broken && /INSERT INTO conversations/.test(q));
    const handle = A(await h.register()).control?.handleId;
    broken = true;
    await expect(h.control("controlTakeover", handle, { expectedRevision: 0 })).rejects.toThrow();
    broken = false;
    expect(await h.control("controlStatus", handle)).toMatchObject({
      conversation: { mode: "auto", revision: 0 },
    });
  });
});

describe("DT-6B-2C-3 coordinator: retention under automatic-only traffic", () => {
  it("terminal intents past 90 days are tombstoned and deleted; dispatching/unknown, claims, mode and cooldowns stay", async () => {
    const h = manual();
    const handle = A(await h.register()).control?.handleId;
    await h.control("controlTakeover", handle, { expectedRevision: 0 });
    await h.prepare();
    await h.confirm();
    await h.settleManual({ state: "sent", providerMessageId: "m" });
    await h.prepare({ operationId: OP2, inboundMessageId: IN2 });
    await h.confirm(OP2);
    await h.settleManual({ state: "unknown", reason: "timeout" }, OP2);
    await h.prepare({ operationId: "op-dm-00000003", inboundMessageId: "in3" });
    await h.confirm("op-dm-00000003");
    await h.prepare({ operationId: "op-dm-00000004", inboundMessageId: "in4" });
    await h.cancel("op-dm-00000004");
    const later = T0 + RETENTION_MS + DAY;
    // Automatic-only traffic (a claim of another event) runs the purge.
    await h.claim({ conversationId: "conv-x", inboundMessageId: "in-x", now: later });
    const ops = (rows(h.db, "intents") as { operation_id: string }[])
      .map((r) => r.operation_id)
      .sort();
    expect(ops).toEqual([OP2, "op-dm-00000003"]);
    const keys = (rows(h.db, "tombstones") as { key: string }[]).map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining([`op|${OP}`, "op|op-dm-00000004", `effect|${ACC}|${CONV}|${IN1}`]),
    );
    // Purged ids are never reusable, even with the same payload.
    expect(await h.prepare({ reviewExpiresAt: later + 600_000 }, later)).toEqual({
      error: "conflict",
    });
    // An unused control handle ages out; the mode it set stays human (cleanup never releases it).
    expect(rows(h.db, "controls")).toEqual([]);
    expect(await h.status()).toMatchObject({ conversation: { mode: "human", revision: 1 } });
    // The unknown and dispatching claims still hold their inbound events, also after an explicit resume.
    for (const inbound of [IN2, "in3"])
      expect(await h.claim({ inboundMessageId: inbound, now: later + 1 })).toMatchObject({
        result: "blocked_by_takeover",
      });
    await h.cas("resume", 1, later + 2);
    for (const inbound of [IN2, "in3"])
      expect(await h.claim({ inboundMessageId: inbound, now: later + 3 })).toMatchObject({
        result: "already_claimed",
      });
  });

  it("control reads and CAS never purge", async () => {
    const h = manual();
    const handle = A(await h.register()).control?.handleId;
    await h.prepare();
    await h.cancel();
    const later = T0 + RETENTION_MS + DAY;
    await h.control("controlStatus", handle, { now: later });
    await h.control("controlTakeover", handle, { expectedRevision: 0, now: later });
    await h.get(OP, later);
    expect(rows(h.db, "tombstones")).toEqual([]);
    expect(rows(h.db, "intents")).toHaveLength(1);
  });
});

describe("DT-6B-2C-3-R1 coordinator: handle activity and bound CAS conflicts", () => {
  const usedAt = (h: ReturnType<typeof manual>, handleId: unknown) =>
    Number(
      (rows(h.db, "controls") as { handle_id: string; used_at: number }[]).find(
        (r) => r.handle_id === handleId,
      )?.used_at,
    );

  it("a successful status read is use: a handle read at day 89 survives the day-91 purge; an unused one goes", async () => {
    const h = manual();
    const used = A(await h.register()).control?.handleId;
    const idle = A(await h.register({ conversationId: "conv-idle" })).control?.handleId;
    await h.control("controlTakeover", used, { expectedRevision: 0, now: T0 + 1 });
    const conversations = rows(h.db, "conversations");
    const recent = T0 + RETENTION_MS - DAY;
    expect(await h.control("controlStatus", used, { now: recent })).toMatchObject({
      control: { handleId: used, usedAt: new Date(recent).toISOString() },
      conversation: { mode: "human", revision: 1 },
    });
    // Only the handle's last use moved: no mode, revision or effect change, no CAS.
    expect(rows(h.db, "conversations")).toEqual(conversations);
    expect(rows(h.db, "effects")).toEqual([]);
    // A clock moved back never ages the handle.
    await h.control("controlStatus", used, { now: T0 + 2 });
    expect(usedAt(h, used)).toBe(recent);
    const late = T0 + RETENTION_MS + DAY;
    // Automatic-only traffic runs the purge.
    await h.claim({ conversationId: "conv-x", inboundMessageId: "in-x", now: late });
    expect(await h.control("controlStatus", used, { now: late })).toMatchObject({
      control: { handleId: used },
      conversation: { mode: "human", revision: 1 },
    });
    expect(await h.control("controlStatus", idle, { now: late })).toEqual({ error: "not_found" });
  });

  it("a stale control CAS answers its handle beside the conversation and changes nothing", async () => {
    const h = manual();
    const reg = A(await h.register());
    expect(
      await h.control("controlResume", reg.control?.handleId, { expectedRevision: 4 }),
    ).toEqual({
      error: "conflict",
      conversation: { account: ACC, conversationId: CONV, mode: "auto", revision: 0 },
      control: reg.control,
    });
    expect(rows(h.db, "conversations")).toEqual([]);
    expect(usedAt(h, reg.control?.handleId)).toBe(T0);
  });
});
