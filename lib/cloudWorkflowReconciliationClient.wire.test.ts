import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  sha256Hex,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import { createCloudWorkflowSession, type ClientFetch } from "./cloudWorkflowClient";
import {
  ackRequestFor,
  authorityOf,
  isVerifiedReceipt,
  occurrenceKey,
  submitRequestOf,
  type Authority,
  type FullReceipt,
} from "./cloudWorkflowProtocol";
import type { CloudFence } from "./cloudWorkflowOccurrenceClient";
import {
  createReconciliationController,
  type CommitInput,
  type ReconcileResult,
  type ReconciliationPersistence,
} from "./cloudWorkflowReconciliationClient";

// ⚙️ DT-7C-2C controller over the REAL Worker router and SQLite coordinator behind a fake in-memory transport (computed
// dynamic import, as the existing wire tests). An in-memory persistence records what the controller hands it, so this
// pins the wire: the exact changes/status/ack routes and bodies, the real compact feed (terminal items carry body-free
// outputs) never standing in for a full status, bounded pages, and no other route (no Submit/Run/Cancel chained).

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec); // eslint-disable-line @typescript-eslint/no-explicit-any
let handle: (req: Request, env: A, ctx: undefined, deps: { now: () => Date }) => Promise<Response>;
let WorkflowCoordinator: new (state: never) => { fetch(req: Request): Promise<Response> };

const TOKEN = "recon-wire-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://scout.test";

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

let log: { method: string; url: string; auth: string | null; body?: string }[];
let fetchFn: ClientFetch;
let owner: string;
let auth: Authority;
async function rig() {
  const db = new DatabaseSync(":memory:");
  const ns = {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: (url: string, init: RequestInit) =>
        new WorkflowCoordinator({ storage: sqliteStorage(db) } as never).fetch(
          new Request(url, init),
        ),
    }),
  };
  const env = { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP, WORKFLOW_COORDINATOR: ns };
  let ms = Date.UTC(2026, 9, 18, 8, 0, 0);
  log = [];
  fetchFn = async (url, init) => {
    const headers = new Headers(init.headers);
    log.push({
      method: init.method,
      url,
      auth: headers.get("Authorization"),
      ...(init.body ? { body: init.body } : {}),
    });
    headers.set("Origin", APP);
    const res = await handle(
      new Request(url, { method: init.method, headers, ...(init.body ? { body: init.body } : {}) }),
      env,
      undefined,
      { now: () => new Date((ms += 1000)) },
    );
    const text = await res.text();
    return {
      status: res.status,
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(Array.from(Buffer.from(text))));
          c.close();
        },
      }),
    };
  };
  const s = createCloudWorkflowSession({ fetch: fetchFn });
  s.configure({ origin: BASE, token: TOKEN });
  const h = await s.handshake();
  if (h.kind !== "answer" || h.parsed.outcome !== "ok" || h.parsed.kind !== "authority")
    throw new Error("handshake");
  owner = h.parsed.authority.ownerKey;
  auth = authorityOf(BASE, owner)!;
  const reg = await s.execute(
    {
      kind: "register",
      ownerKey: owner,
      workflowId: "w1",
      expectedEpoch: 0,
      revision: 1,
      workflowDigest: "e".repeat(64),
    },
    auth,
  );
  if (reg.kind !== "answer" || reg.parsed.outcome !== "ok") throw new Error("register");
  return s;
}
function bodyOf(id: string): OccurrenceBody {
  return {
    occurrenceId: id,
    ownerKey: owner,
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
      day: "2026-10-18",
    },
    executionAt: "2026-10-18T08:01:00.000Z",
  } as unknown as OccurrenceBody;
}
async function occurrence(
  s: ReturnType<typeof createCloudWorkflowSession>,
  id: string,
  run: boolean,
) {
  const sub = await submitRequestOf(bodyOf(id));
  if (!sub.ok) throw new Error("body");
  expect((await s.execute(sub.request, auth)).kind).toBe("answer");
  if (run)
    expect((await s.execute({ kind: "run", ownerKey: owner, occurrenceId: id }, auth)).kind).toBe(
      "answer",
    );
}

/** An in-memory persistence: accepts every verified receipt, records inputs, advances the cursor. */
function memory() {
  const fence: CloudFence = { config: 0, visit: 0 };
  const st = { cursor: 0, inputs: [] as CommitInput[], receipts: new Map<string, FullReceipt>() };
  const p: ReconciliationPersistence = {
    fence: () => fence,
    async snapshot(_a, ids) {
      const local: Record<string, A> = {};
      for (const id of ids) {
        const r = st.receipts.get(id);
        if (r)
          local[id] = {
            proof: {
              payloadDigest: r.payloadDigest,
              receiptVersion: r.receiptVersion,
              terminal: ackRequestFor(r) !== null,
              eligible: ackRequestFor(r) !== null,
            },
          };
      }
      return { ok: true, snapshot: { base: {}, cursor: st.cursor, local } };
    },
    async commit(_b, input, live) {
      if (!live()) return { ok: false, reason: "stale" };
      st.inputs.push(input);
      if (input.kind === "receipt") {
        const p = input.parsed;
        if (
          p.outcome !== "ok" ||
          p.kind !== "status" ||
          p.result.found !== "row" ||
          !isVerifiedReceipt(p.result.receipt)
        )
          return { ok: false, reason: "invalid" };
        st.receipts.set(p.result.receipt.occurrenceId, p.result.receipt);
      }
      if ("cursor" in input && input.cursor !== undefined)
        st.cursor = Math.max(st.cursor, input.cursor);
      return {
        ok: true,
        change:
          input.kind === "receipt" ? "proven" : input.kind === "pending" ? "pending" : "cursor",
      };
    },
    async dispatchAck(_b, id, go) {
      const r = st.receipts.get(id);
      const req = r && ackRequestFor(r);
      if (!req) return { ok: false, reason: "missing" };
      const value = go(req);
      return value === null ? { ok: false, reason: "superseded" } : { ok: true, value };
    },
  };
  return { p, st };
}
const page = (r: ReconcileResult) => {
  expect(r.kind).toBe("page");
  return r as Extract<ReconcileResult, { kind: "page" }>;
};

beforeAll(async () => {
  handle = (await load("@/workers/scout/src/scout")).handle;
  WorkflowCoordinator = (await load("@/workers/scout/src/social/workflowCoordinator"))
    .WorkflowCoordinator;
}, 60_000);
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the real Worker wire", () => {
  it("pages the real feed with the exact routes; terminal feed items still need a full status; ack is one exact POST", async () => {
    const s = await rig();
    await occurrence(s, "m1", true);
    await occurrence(s, "m2", false);
    await occurrence(s, "m3", true);
    const m = memory();
    const c = createReconciliationController({ fetch: fetchFn, persistence: m.p });
    c.configure({ origin: BASE, token: TOKEN });
    expect(await c.handshake()).toMatchObject({ ok: true });
    log.length = 0;
    const first = page(await c.reconcile({ limit: 2 }));
    expect(first.more).toBe(true);
    expect(first.items).toHaveLength(2);
    expect(log.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(log.map((r) => [r.method, new URL(r.url).pathname + new URL(r.url).search])).toEqual([
      ["GET", `/social/workflows/changes?ownerKey=${owner}&after=0&limit=2`],
      ...first.items.map((i) => [
        "GET",
        `/social/workflows/occurrences/${i.occurrenceId}?ownerKey=${owner}`,
      ]),
    ]);
    // Every receipt came from a status row, bound to the feed's digest: never reconstructed from the compact item.
    for (const input of m.st.inputs) {
      expect(input.kind).toBe("receipt");
      const req = (input as A).request;
      expect(req).toMatchObject({ kind: "status", expect: { payloadDigest: expect.any(String) } });
    }
    log.length = 0;
    const second = page(await c.reconcile({ limit: 2 }));
    expect(second.more).toBe(false);
    expect(new URL(log[0].url).searchParams.get("after")).toBe(String(first.cursor));
    expect(m.st.receipts.size).toBe(3);
    // Nothing chained: only changes and status GETs so far.
    expect(log.every((r) => r.method === "GET")).toBe(true);
    log.length = 0;
    const ack = await c.ack(occurrenceKey(auth, "m1"));
    expect(ack).toMatchObject({
      kind: "answered",
      parsed: { outcome: "ok", kind: "ack", acknowledged: true },
    });
    const v = m.st.receipts.get("m1")!.receiptVersion;
    expect(log).toEqual([
      {
        method: "POST",
        url: `${BASE}/social/workflows/occurrences/m1/ack`,
        auth: `Bearer ${TOKEN}`,
        body: JSON.stringify({ ownerKey: owner, receiptVersion: v }),
      },
    ]);
    // A nonterminal occurrence is never ackable (the memory persistence follows ackRequestFor).
    expect(await c.ack(occurrenceKey(auth, "m2"))).toMatchObject({
      kind: "refused",
      reason: "not_eligible",
    });
  });

  it("the real compact feed of a terminal occurrence carries body-free outputs, and status is still asked", async () => {
    const s = await rig();
    await occurrence(s, "t1", true);
    const feed = await s.execute({ kind: "changes", ownerKey: owner, after: 0 }, auth);
    if (feed.kind !== "answer" || feed.parsed.outcome !== "ok" || feed.parsed.kind !== "changes")
      throw new Error("feed");
    expect(feed.parsed.items[0].outputs).toHaveLength(1);
    expect(isVerifiedReceipt(feed.parsed.items[0])).toBe(false);
    expect(ackRequestFor(feed.parsed.items[0])).toBeNull();
    const m = memory();
    const c = createReconciliationController({ fetch: fetchFn, persistence: m.p });
    c.configure({ origin: BASE, token: TOKEN });
    await c.handshake();
    log.length = 0;
    page(await c.reconcile());
    expect(log.filter((r) => r.url.includes("/occurrences/t1"))).toHaveLength(1);
    const digest = await sha256Hex(canonicalJson(bodyOf("t1")));
    expect(m.st.receipts.get("t1")!.payloadDigest).toBe(digest);
  });
});
