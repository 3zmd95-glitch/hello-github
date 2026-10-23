import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  sha256Hex,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import type { ClientRequestInit, ClientResponse } from "./cloudWorkflowClient";
import { authorityOf, occurrenceKey, type CloudRequest } from "./cloudWorkflowProtocol";
import type { CloudFence } from "./cloudWorkflowOccurrenceClient";
import {
  createReconciliationController,
  type CommitInput,
  type CommitOutcome,
  type LocalBinding,
  type ReconcileResult,
  type ReconciliationPersistence,
} from "./cloudWorkflowReconciliationClient";

// ⚙️ DT-7C-2C reconciliation controller boundaries (planning/tools/38-cloud-workflows.md): a scripted persistence double
// and a fake transport answering exactly as the Worker does (answers pass the pinned parser). Bounded page, one status
// per item, durable-before-cursor commits, fences, truthful dispatched/unconfirmed outcomes, ack after the locked check.
// The real router/SQLite and the real store are in the .wire.test.ts and store/cloudWorkflowReconciliation.test.ts.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ORIGIN = "https://scout.test";
const TOKEN = "recon-unit-token";
const OWNER = "wfo_" + "3".repeat(32);
const AUTH = authorityOf(ORIGIN, OWNER)!;
const AT = "2026-10-17T09:00:00.000Z";
const SUBMITTED = "2026-10-17T09:05:00.000Z";

function bodyOf(id: string): OccurrenceBody {
  return {
    occurrenceId: id,
    ownerKey: OWNER,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "", en: "Flow" },
      trigger: { kind: "manual" },
      actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea" } }],
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
async function pendingReceipt(id: string, seq: number): Promise<A> {
  const b = bodyOf(id);
  return {
    occurrenceId: id,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    body: b,
    payloadDigest: await sha256Hex(canonicalJson(b)),
    state: "pending",
    receiptVersion: 1,
    changeSeq: seq,
    createdAt: SUBMITTED,
    updatedAt: SUBMITTED,
    ackedVersion: 0,
    steps: [{ idx: 0, actionId: "a1", kind: "idea", status: "pending" }],
    outputs: [],
  };
}
const feedOf = (r: A) => ({
  occurrenceId: r.occurrenceId,
  workflowId: r.workflowId,
  changeSeq: r.changeSeq,
  state: r.state,
  receiptVersion: r.receiptVersion,
  payloadDigest: r.payloadDigest,
  steps: r.steps,
});
const key = (id: string) => occurrenceKey(AUTH, id)!;
const bytes = (status: number, body: unknown): ClientResponse => ({
  status,
  body: new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(JSON.stringify(body)));
      c.close();
    },
  }),
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/* ---------- the fake Worker transport ---------- */

type Route = (url: string, init: ClientRequestInit) => Promise<ClientResponse>;
function transport() {
  const calls: { method: string; url: string; body?: string }[] = [];
  const net = {
    changes: (async () =>
      bytes(200, { ownerKey: OWNER, items: [], nextAfter: 0, more: false })) as Route,
    status: new Map<string, Route>(),
    ack: (async () => {
      throw new TypeError("no ack answer scripted");
    }) as Route,
  };
  const fetchFn = vi.fn(async (url: string, init: ClientRequestInit) => {
    calls.push({ method: init.method, url, ...(init.body ? { body: init.body } : {}) });
    const path = new URL(url).pathname;
    if (path.endsWith("/authority")) return bytes(200, { ownerKey: OWNER });
    if (path.endsWith("/changes")) return net.changes(url, init);
    if (path.endsWith("/ack")) return net.ack(url, init);
    const id = decodeURIComponent(path.split("/").pop()!);
    const r = net.status.get(id);
    if (!r) throw new TypeError("no status scripted for " + id);
    return r(url, init);
  });
  return { calls, net, fetchFn };
}
const rowAnswer =
  (r: A): Route =>
  async () =>
    bytes(200, { ownerKey: OWNER, occurrence: r });

/* ---------- the scripted persistence ---------- */

function persistence() {
  const fence: { v: CloudFence } = { v: { config: 0, visit: 0 } };
  const state = {
    cursor: 0,
    local: {} as Record<string, LocalBinding>,
    commits: [] as { input: CommitInput; live: boolean }[],
    snapshots: [] as string[][],
    acks: 0,
    commit: (async (input: CommitInput): Promise<CommitOutcome> =>
      input.kind === "receipt"
        ? { ok: true, change: "bound" }
        : input.kind === "pruned"
          ? { ok: true, change: "retired" }
          : input.kind === "pending"
            ? { ok: true, change: "pending" }
            : { ok: true, change: "cursor" }) as (input: CommitInput) => Promise<CommitOutcome>,
    ackGate: null as null | (() => boolean),
  };
  const p: ReconciliationPersistence = {
    fence: () => fence.v,
    async snapshot(_a, ids) {
      state.snapshots.push([...ids]);
      return {
        ok: true,
        snapshot: { base: { tag: "base" }, cursor: state.cursor, local: state.local },
      };
    },
    async commit(base, input, live) {
      expect(base).toEqual({ tag: "base" });
      const ok = live();
      state.commits.push({ input, live: ok });
      if (!ok) return { ok: false, reason: "stale" };
      const out = await state.commit(input);
      if (out.ok && "cursor" in input && input.cursor !== undefined)
        state.cursor = Math.max(state.cursor, input.cursor);
      return out;
    },
    async dispatchAck(_base, id, go) {
      state.acks += 1;
      const l = state.local[id];
      if (!l?.proof?.eligible || (state.ackGate && !state.ackGate()))
        return { ok: false, reason: "inconsistent" };
      const request: CloudRequest = {
        kind: "ack",
        ownerKey: OWNER,
        occurrenceId: id,
        receiptVersion: 3,
      };
      const value = go(request);
      return value === null ? { ok: false, reason: "superseded" } : { ok: true, value };
    },
  };
  return { p, state, fence };
}

let t: ReturnType<typeof transport>;
let s: ReturnType<typeof persistence>;
async function ready() {
  const c = createReconciliationController({ fetch: t.fetchFn, persistence: s.p });
  expect(c.configure({ origin: ORIGIN, token: TOKEN }).ok).toBe(true);
  expect(await c.handshake()).toMatchObject({ ok: true });
  t.calls.length = 0;
  return c;
}
const page = (r: ReconcileResult) => {
  expect(r.kind).toBe("page");
  return r as Extract<ReconcileResult, { kind: "page" }>;
};
const nonAuth = () => t.calls.filter((c) => !c.url.endsWith("/authority"));

beforeEach(() => {
  t = transport();
  s = persistence();
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("construction and pre-dispatch refusals", () => {
  it("construction, configure, invalidate and dispose make no request and touch no storage", () => {
    const c = createReconciliationController({ fetch: t.fetchFn, persistence: s.p });
    c.configure({ origin: ORIGIN, token: TOKEN });
    c.invalidateVisit();
    c.dispose();
    expect(t.fetchFn).not.toHaveBeenCalled();
    expect(s.state.snapshots).toEqual([]);
  });

  it("refuses without a handshake, with a bad limit, a malformed or foreign key, after a store fence move", async () => {
    const c0 = createReconciliationController({ fetch: t.fetchFn, persistence: s.p });
    c0.configure({ origin: ORIGIN, token: TOKEN });
    expect(await c0.reconcile()).toMatchObject({ kind: "refused", reason: "no_authority" });
    const c = await ready();
    for (const limit of [0, 51, 1.5, Number.NaN])
      expect(await c.reconcile({ limit })).toMatchObject({
        kind: "refused",
        reason: "invalid_limit",
      });
    expect(await c.check("nope")).toMatchObject({ kind: "refused", reason: "invalid_key" });
    expect(await c.check(42)).toMatchObject({ kind: "refused", reason: "invalid_key" });
    const foreign = occurrenceKey(authorityOf("https://other.test", OWNER)!, "m1");
    expect(await c.check(foreign)).toMatchObject({ kind: "refused", reason: "foreign_key" });
    expect(await c.ack(foreign)).toMatchObject({ kind: "refused", reason: "foreign_key" });
    s.fence.v = { config: 1, visit: 0 };
    expect(await c.reconcile()).toMatchObject({ kind: "refused", reason: "handshake_required" });
    expect(nonAuth()).toEqual([]);
    expect(s.state.commits).toEqual([]);
  });
});

describe("one bounded page: one changes request, at most one status per item, durable before the cursor", () => {
  it("pages from the durable cursor with the asked limit; each item's commit carries its own sequence", async () => {
    s.state.cursor = 40;
    const r1 = await pendingReceipt("m1", 41);
    const r2 = await pendingReceipt("m2", 42);
    t.net.changes = async () =>
      bytes(200, { ownerKey: OWNER, items: [feedOf(r1), feedOf(r2)], nextAfter: 42, more: true });
    t.net.status.set("m1", rowAnswer(r1));
    t.net.status.set("m2", rowAnswer(r2));
    const c = await ready();
    const out = page(await c.reconcile({ limit: 2 }));
    expect(out).toMatchObject({ cursor: 42, more: true, blocked: null });
    expect(out.items.map((i) => [i.occurrenceId, i.outcome])).toEqual([
      ["m1", "bound"],
      ["m2", "bound"],
    ]);
    expect(
      nonAuth().map((x) => [x.method, new URL(x.url).pathname + new URL(x.url).search]),
    ).toEqual([
      ["GET", `/social/workflows/changes?ownerKey=${OWNER}&after=40&limit=2`],
      ["GET", `/social/workflows/occurrences/m1?ownerKey=${OWNER}`],
      ["GET", `/social/workflows/occurrences/m2?ownerKey=${OWNER}`],
    ]);
    expect(
      s.state.commits.map((x) => [x.input.kind, "cursor" in x.input ? x.input.cursor : null]),
    ).toEqual([
      ["receipt", 41],
      ["receipt", 42],
    ]);
    // The status request is bound to the feed's digest (a compact item never authorizes anything itself).
    const req = (s.state.commits[0].input as A).request;
    expect(req).toMatchObject({ kind: "status", expect: { payloadDigest: r1.payloadDigest } });
    expect(t.calls.some((x) => x.method === "POST")).toBe(false); // no Submit/Run/Cancel/ack chained
  });

  it("an item already proven at or past its version needs no status; a local digest mismatch is pending without one", async () => {
    const r1 = await pendingReceipt("m1", 1);
    const r2 = await pendingReceipt("m2", 2);
    s.state.local = {
      m1: {
        proof: {
          payloadDigest: r1.payloadDigest,
          receiptVersion: 3,
          terminal: true,
          eligible: true,
        },
      },
      m2: { journal: { body: bodyOf("zz") as never, payloadDigest: "9".repeat(64) } },
    };
    t.net.changes = async () =>
      bytes(200, { ownerKey: OWNER, items: [feedOf(r1), feedOf(r2)], nextAfter: 2, more: false });
    const c = await ready();
    const out = page(await c.reconcile());
    expect(out.items).toEqual([
      { occurrenceId: "m1", changeSeq: 1, outcome: "unchanged" },
      { occurrenceId: "m2", changeSeq: 2, outcome: "pending", reason: "mismatch" },
    ]);
    expect(nonAuth()).toHaveLength(1); // the changes page only
    expect(out.cursor).toBe(2);
  });

  it("a typed refusal or absent is pending and the page continues; transport loss is pending and stops (no retry)", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map((n) => pendingReceipt(`m${n}`, n)));
    t.net.changes = async () =>
      bytes(200, { ownerKey: OWNER, items: rs.map(feedOf), nextAfter: 4, more: false });
    t.net.status.set("m1", async () => bytes(409, { error: "authority_mismatch" }));
    t.net.status.set("m2", async () =>
      bytes(200, { ownerKey: OWNER, occurrenceId: "m2", state: "absent" }),
    );
    t.net.status.set("m3", async () => {
      throw new TypeError("network down");
    });
    t.net.status.set("m4", rowAnswer(rs[3]));
    const c = await ready();
    const out = page(await c.reconcile());
    expect(out.items.map((i) => [i.occurrenceId, i.outcome, i.reason])).toEqual([
      ["m1", "pending", "authority_mismatch"],
      ["m2", "pending", "absent"],
      ["m3", "pending", "unconfirmed:network"],
    ]);
    expect(out.blocked).toEqual({ occurrenceId: "m3", reason: "unconfirmed:network" });
    expect(out.more).toBe(true); // m4 was not reached
    expect(out.cursor).toBe(3);
    expect(nonAuth().filter((x) => x.url.includes("/occurrences/m3"))).toHaveLength(1);
    expect(nonAuth().some((x) => x.url.includes("/occurrences/m4"))).toBe(false);
  });

  it("proof-full or a persistence failure stops the page with the cursor unchanged; an item refusal is recorded as pending", async () => {
    const rs = await Promise.all([1, 2, 3].map((n) => pendingReceipt(`m${n}`, n)));
    t.net.changes = async () =>
      bytes(200, { ownerKey: OWNER, items: rs.map(feedOf), nextAfter: 3, more: false });
    for (const r of rs) t.net.status.set(r.occurrenceId, rowAnswer(r));
    s.state.commit = async (input) =>
      input.kind === "receipt"
        ? (input.request as A).occurrenceId === "m1"
          ? { ok: false, reason: "mismatch" }
          : { ok: false, reason: "proof-full" }
        : { ok: true, change: "pending" };
    const c = await ready();
    const out = page(await c.reconcile());
    expect(out.items).toEqual([
      { occurrenceId: "m1", changeSeq: 1, outcome: "pending", reason: "mismatch" },
    ]);
    expect(out.blocked).toEqual({ occurrenceId: "m2", reason: "proof-full" });
    expect(out.cursor).toBe(1);
    expect(s.state.cursor).toBe(1);
    expect(nonAuth().some((x) => x.url.includes("/occurrences/m3"))).toBe(false);
  });

  it("a pruned status commits a retirement; the changes request lost is unconfirmed with exactly one fetch", async () => {
    const r1 = await pendingReceipt("m1", 1);
    t.net.changes = async () =>
      bytes(200, { ownerKey: OWNER, items: [feedOf(r1)], nextAfter: 1, more: false });
    t.net.status.set("m1", async () =>
      bytes(200, {
        ownerKey: OWNER,
        occurrenceId: "m1",
        state: "pruned",
        payloadDigest: r1.payloadDigest,
        prunedAt: AT,
      }),
    );
    const c = await ready();
    expect(page(await c.reconcile()).items[0]).toMatchObject({ outcome: "retired" });
    t.calls.length = 0;
    t.net.changes = async () => {
      throw new TypeError("lost");
    };
    expect(await c.reconcile()).toMatchObject({
      kind: "unconfirmed",
      dispatched: true,
      category: "network",
    });
    expect(nonAuth()).toHaveLength(1);
  });
});

describe("fences: a moved fence is stale and nothing from it is committed", () => {
  it("a visit invalidation while a status is held: stale, the held answer is not committed, the rest untouched", async () => {
    const r1 = await pendingReceipt("m1", 1);
    const r2 = await pendingReceipt("m2", 2);
    t.net.changes = async () =>
      bytes(200, { ownerKey: OWNER, items: [feedOf(r1), feedOf(r2)], nextAfter: 2, more: false });
    const held = deferred<void>();
    t.net.status.set("m1", async () => {
      await held.promise;
      return bytes(200, { ownerKey: OWNER, occurrence: r1 });
    });
    const c = await ready();
    const p = c.reconcile();
    await tick(60);
    c.invalidateVisit();
    held.resolve();
    expect(await p).toMatchObject({ kind: "stale", dispatched: true, items: [] });
    expect(s.state.commits).toEqual([]);
    expect(nonAuth().some((x) => x.url.includes("/occurrences/m2"))).toBe(false);
  });

  it("a store fence that moves inside the commit hold is checked there (live() false = nothing written)", async () => {
    const r1 = await pendingReceipt("m1", 1);
    t.net.changes = async () =>
      bytes(200, { ownerKey: OWNER, items: [feedOf(r1)], nextAfter: 1, more: false });
    t.net.status.set("m1", rowAnswer(r1));
    const c = await ready();
    const commit = s.p.commit;
    s.p.commit = (base, input, live) => {
      s.fence.v = { config: 0, visit: 9 };
      return commit(base, input, live);
    };
    expect(await c.reconcile()).toMatchObject({ kind: "stale" });
    expect(s.state.commits).toEqual([
      { input: expect.objectContaining({ kind: "receipt" }), live: false },
    ]);
    expect(s.state.cursor).toBe(0);
  });
});

describe("check: one explicit status for one key", () => {
  it("binds to the journal entry; a row is committed, absent writes nothing, pruned retires", async () => {
    const r1 = await pendingReceipt("m1", 1);
    s.state.local = {
      m1: { journal: { body: bodyOf("m1") as never, payloadDigest: r1.payloadDigest } },
    };
    t.net.status.set("m1", rowAnswer(r1));
    const c = await ready();
    const out = await c.check(key("m1"));
    expect(out).toMatchObject({ kind: "answered", recorded: { ok: true, change: "bound" } });
    const req = (s.state.commits[0].input as A).request;
    expect(req).toEqual({
      kind: "status",
      ownerKey: OWNER,
      occurrenceId: "m1",
      expect: { body: bodyOf("m1"), payloadDigest: r1.payloadDigest },
    });
    t.net.status.set("m9", async () =>
      bytes(200, { ownerKey: OWNER, occurrenceId: "m9", state: "absent" }),
    );
    expect(await c.check(key("m9"))).toMatchObject({ kind: "answered", recorded: null });
    expect(s.state.commits).toHaveLength(1);
    t.net.status.set("m1", async () =>
      bytes(200, {
        ownerKey: OWNER,
        occurrenceId: "m1",
        state: "pruned",
        payloadDigest: r1.payloadDigest,
        prunedAt: AT,
      }),
    );
    expect(await c.check(key("m1"))).toMatchObject({ recorded: { ok: true, change: "retired" } });
    expect(s.state.commits[1].input.kind).toBe("pruned");
  });

  it("an unknown id is checked without a binding (initial proof); a lost answer is unconfirmed, never retried", async () => {
    const r1 = await pendingReceipt("m1", 1);
    t.net.status.set("m1", rowAnswer(r1));
    const c = await ready();
    expect(await c.check(key("m1"))).toMatchObject({ kind: "answered" });
    expect((s.state.commits[0].input as A).request.expect).toBeUndefined();
    t.net.status.set("m1", async () => {
      throw new TypeError("lost");
    });
    t.calls.length = 0;
    expect(await c.check(key("m1"))).toMatchObject({ kind: "unconfirmed", dispatched: true });
    expect(nonAuth()).toHaveLength(1);
  });
});

describe("ack: only after the locked eligibility check, one request, nothing written from the answer", () => {
  it("not eligible: refused with zero fetch; a locked refusal sends nothing", async () => {
    const c = await ready();
    expect(await c.ack(key("m1"))).toMatchObject({ kind: "refused", reason: "not_eligible" });
    s.state.local = {
      m1: {
        proof: { payloadDigest: "1".repeat(64), receiptVersion: 3, terminal: true, eligible: true },
      },
    };
    s.state.ackGate = () => false;
    expect(await c.ack(key("m1"))).toMatchObject({ kind: "refused", reason: "inconsistent" });
    expect(nonAuth()).toEqual([]);
  });

  it("eligible: exactly one POST ack started inside the hold; a lost answer is unconfirmed; no commit follows", async () => {
    s.state.local = {
      m1: {
        proof: { payloadDigest: "1".repeat(64), receiptVersion: 3, terminal: true, eligible: true },
      },
    };
    t.net.ack = async () =>
      bytes(200, {
        ownerKey: OWNER,
        occurrenceId: "m1",
        acknowledged: true,
        receiptVersion: 3,
        ackedVersion: 3,
        firstAckAt: AT,
        purgeAt: "2027-01-15T09:00:00.000Z",
      });
    const c = await ready();
    const out = await c.ack(key("m1"));
    expect(out).toMatchObject({
      kind: "answered",
      parsed: { outcome: "ok", kind: "ack", acknowledged: true },
    });
    expect(nonAuth()).toEqual([
      {
        method: "POST",
        url: `${ORIGIN}/social/workflows/occurrences/m1/ack`,
        body: JSON.stringify({ ownerKey: OWNER, receiptVersion: 3 }),
      },
    ]);
    expect(s.state.commits).toEqual([]);
    t.net.ack = async () => {
      throw new TypeError("lost");
    };
    expect(await c.ack(key("m1"))).toMatchObject({
      kind: "unconfirmed",
      dispatched: true,
      category: "network",
    });
    expect(nonAuth()).toHaveLength(2); // explicit repeat only; never automatic
    expect(s.state.commits).toEqual([]);
  });

  it("a held ack answer across a visit invalidation is stale with dispatched true", async () => {
    s.state.local = {
      m1: {
        proof: { payloadDigest: "1".repeat(64), receiptVersion: 3, terminal: true, eligible: true },
      },
    };
    const held = deferred<void>();
    t.net.ack = async () => {
      await held.promise;
      return bytes(200, {
        ownerKey: OWNER,
        occurrenceId: "m1",
        acknowledged: true,
        receiptVersion: 3,
        ackedVersion: 3,
        firstAckAt: AT,
        purgeAt: "2027-01-15T09:00:00.000Z",
      });
    };
    const c = await ready();
    const p = c.ack(key("m1"));
    await tick(40);
    c.invalidateVisit();
    held.resolve();
    expect(await p).toMatchObject({ kind: "stale", dispatched: true });
    expect(s.state.commits).toEqual([]);
  });
});
