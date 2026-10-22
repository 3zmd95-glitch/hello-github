import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientFetch } from "./cloudWorkflowClient";
import { authorityOf } from "./cloudWorkflowProtocol";
import {
  findRecord,
  readRegistrations,
  registrationKey,
  registrationsIs,
  verifyRegistrations,
} from "./cloudWorkflowRegistration";
import {
  createRegistrationController,
  type RegistrationPersistence,
} from "./cloudWorkflowRegistrationClient";

// ⚙️ DT-7C-2B-2 controller over the REAL Worker router and SQLite coordinator behind a fake in-memory transport (the
// computed dynamic import of the existing wire tests: a static import would pull the Cloudflare-typed Worker into the
// app's tsc program). It proves the exact-replay policy with real answers: an identical register while active returns
// the same epoch; an old expectedEpoch cannot open a later epoch; an unregister bound to its epoch/revision cannot
// affect a newer epoch - including originals delayed in transit until after the recovery and after a newer lifecycle.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec); // eslint-disable-line @typescript-eslint/no-explicit-any
type Env = Record<string, unknown>;
let handle: (
  req: Request,
  env: Env,
  ctx: undefined,
  deps: { now: () => Date },
) => Promise<Response>;
let WorkflowCoordinator: new (state: never) => { fetch(req: Request): Promise<Response> };

const TOKEN = "wire-scout-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://scout.test";
const DIG = "e".repeat(64);
const DIG2 = "f".repeat(64);

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
function fakeNamespace() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    idFromName: (name: string) => name,
    get: () => ({
      async fetch(url: string, init: RequestInit) {
        const c = new WorkflowCoordinator({ storage: sqliteStorage(db) } as never);
        return c.fetch(new Request(url, init));
      },
    }),
  };
}

/** A request captured in transit (never delivered yet), deliverable later to the same real Worker. */
interface InTransit {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function rig() {
  const ns = fakeNamespace();
  const env: Env = { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP, WORKFLOW_COORDINATOR: ns };
  let minute = 0;
  const clock = () => new Date(Date.UTC(2026, 9, 18, 8, minute++));
  /** deliver: normal; lose: the Worker applies it, the answer is lost; delay: kept in transit, not delivered. */
  const net = { mode: "deliver" as "deliver" | "lose" | "delay" };
  const delayed: InTransit[] = [];
  const posts: string[] = [];
  const toWorker = (t: InTransit) => {
    const headers = new Headers(t.headers);
    headers.set("Origin", APP); // the browser adds it; the client never sets it
    return handle(
      new Request(t.url, { method: t.method, headers, ...(t.body ? { body: t.body } : {}) }),
      env,
      undefined,
      { now: clock },
    );
  };
  const fetchFn: ClientFetch = async (url, init) => {
    const t: InTransit = {
      url,
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
    };
    if (init.method === "POST") posts.push(init.body!);
    if (init.method === "POST" && net.mode === "delay") {
      delayed.push(t);
      throw new TypeError("network: no answer");
    }
    const res = await toWorker(t);
    if (init.method === "POST" && net.mode === "lose") throw new TypeError("network: answer lost");
    return res;
  };
  /** Deliver a request that was held in transit; the real coordinator's answer. */
  const deliver = async (t: InTransit) => {
    const res = await toWorker(t);
    return { status: res.status, body: (await res.json()) as A };
  };
  const row = () =>
    ns.db.prepare("SELECT epoch, revision, workflow_digest, state FROM registrations").all() as A[];
  const epochs = () =>
    (ns.db.prepare("SELECT epoch FROM registration_epochs ORDER BY epoch").all() as A[]).map((e) =>
      Number(e.epoch),
    );

  // In-memory locked persistence (the store adapter's contract).
  let raw: string | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const current = () => readRegistrations(raw === undefined ? undefined : JSON.parse(raw));
  const persistence: RegistrationPersistence = {
    async read() {
      const s = current();
      return s && (await verifyRegistrations(s)) ? s : null;
    },
    commit(mutate) {
      const run = tail.then(() => {
        const out = mutate(current()!);
        if (!("next" in out)) return out.result;
        raw = JSON.stringify(out.next);
        return registrationsIs(JSON.parse(raw), out.next)
          ? out.result
          : ({ ok: false, reason: "not-persisted" } as const);
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
  const ctl = createRegistrationController({ fetch: fetchFn, persistence });
  ctl.configure({ origin: BASE, token: TOKEN });
  return { ctl, net, delayed, deliver, row, epochs, posts, persistence, current };
}

let OWNER = "";
const keyOf = (workflowId = "w1") => registrationKey(authorityOf(BASE, OWNER)!, workflowId)!;
const register = (o: A = {}) => ({
  kind: "register",
  ownerKey: OWNER,
  workflowId: "w1",
  expectedEpoch: 0,
  revision: 1,
  workflowDigest: DIG,
  ...o,
});
const unregister = (o: A = {}) => ({
  kind: "unregister",
  ownerKey: OWNER,
  workflowId: "w1",
  registrationEpoch: 1,
  expectedRevision: 1,
  ...o,
});
async function ready() {
  const r = rig();
  const h = await r.ctl.handshake();
  if (!h.ok) throw new Error(h.reason);
  OWNER = h.authority.ownerKey;
  return r;
}
const intent = (r: ReturnType<typeof rig>, key = keyOf()) => findRecord(r.current()!, key)!.intent;

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
  vi.restoreAllMocks();
});

describe("lost answers, then explicit identical recovery (real coordinator answers)", () => {
  it("register: the Worker applied it, the answer was lost; the identical replay returns the same epoch", async () => {
    const r = await ready();
    r.net.mode = "lose";
    expect(await r.ctl.register(register())).toMatchObject({
      state: "uncertain",
      dispatched: true,
    });
    expect(r.row()).toMatchObject([{ epoch: 1, state: "active" }]);
    r.net.mode = "deliver";
    expect(await r.ctl.recover(keyOf())).toMatchObject({ reason: "handshake_required" });
    await r.ctl.handshake();
    expect(await r.ctl.recover(keyOf())).toMatchObject({ kind: "recorded", state: "settled" });
    expect(r.posts).toEqual([r.posts[0], r.posts[0]]); // byte-identical
    expect(intent(r).answer?.body).toMatchObject({
      created: false,
      registration: { registrationEpoch: 1, state: "active" },
    });
    expect(r.epochs()).toEqual([1]); // no second epoch was minted
  });

  it("unregister: the identical replay of an applied unregister answers unchanged for the same epoch", async () => {
    const r = await ready();
    expect(await r.ctl.register(register())).toMatchObject({ state: "settled" });
    r.net.mode = "lose";
    expect(await r.ctl.unregister(unregister(), DIG)).toMatchObject({ state: "uncertain" });
    expect(r.row()).toMatchObject([{ epoch: 1, state: "unregistered" }]);
    r.net.mode = "deliver";
    await r.ctl.handshake();
    expect(await r.ctl.recover(keyOf())).toMatchObject({ state: "settled" });
    expect(intent(r).answer?.body).toMatchObject({
      changed: false,
      registration: { registrationEpoch: 1, state: "unregistered" },
    });
  });
});

describe("originals delayed in transit until after the recovery and after a newer lifecycle", () => {
  it("a delayed original register after its recovery: created false, same epoch; after a newer epoch: conflict, nothing opened", async () => {
    const r = await ready();
    r.net.mode = "delay";
    expect(await r.ctl.register(register())).toMatchObject({ state: "uncertain" });
    expect(r.row()).toEqual([]); // still in transit
    r.net.mode = "deliver";
    await r.ctl.handshake();
    expect(await r.ctl.recover(keyOf())).toMatchObject({ state: "settled" });
    expect(intent(r).answer?.body.created).toBe(true); // the recovery applied it
    const [original] = r.delayed;
    const late = await r.deliver(original);
    expect(late).toMatchObject({
      status: 200,
      body: { created: false, registration: { registrationEpoch: 1, state: "active" } },
    });
    expect(r.epochs()).toEqual([1]);

    // A newer lifecycle: unregister epoch 1, re-register into epoch 2 (with another revision/digest).
    expect(await r.ctl.unregister(unregister(), DIG)).toMatchObject({ state: "settled" });
    expect(
      await r.ctl.register(register({ expectedEpoch: 1, revision: 2, workflowDigest: DIG2 })),
    ).toMatchObject({ state: "settled" });
    expect(r.row()).toMatchObject([{ epoch: 2, revision: 2, state: "active" }]);
    // The same original arrives again (a second delayed copy): its old expectedEpoch opens nothing.
    const again = await r.deliver(original);
    expect(again).toMatchObject({
      status: 409,
      body: { error: "conflict", registration: { registrationEpoch: 2, state: "active" } },
    });
    expect(r.epochs()).toEqual([1, 2]);
    expect(r.row()).toMatchObject([
      { epoch: 2, revision: 2, workflow_digest: DIG2, state: "active" },
    ]);
  });

  it("a delayed unregister bound to epoch 1 cannot affect epoch 2", async () => {
    const r = await ready();
    expect(await r.ctl.register(register())).toMatchObject({ state: "settled" });
    r.net.mode = "delay";
    expect(await r.ctl.unregister(unregister(), DIG)).toMatchObject({ state: "uncertain" });
    r.net.mode = "deliver";
    await r.ctl.handshake();
    expect(await r.ctl.recover(keyOf())).toMatchObject({ state: "settled" });
    expect(await r.ctl.register(register({ expectedEpoch: 1 }))).toMatchObject({
      state: "settled",
    });
    expect(r.row()).toMatchObject([{ epoch: 2, state: "active" }]);
    const late = await r.deliver(r.delayed[0]);
    expect(late).toMatchObject({
      status: 409,
      body: { error: "conflict", registration: { registrationEpoch: 2, state: "active" } },
    });
    expect(r.row()).toMatchObject([{ epoch: 2, state: "active" }]);
  });

  it("an old re-register (expectedEpoch 1) recovered into epoch 2 cannot open epoch 3 after epoch 2 closes", async () => {
    const r = await ready();
    expect(await r.ctl.register(register())).toMatchObject({ state: "settled" });
    expect(await r.ctl.unregister(unregister(), DIG)).toMatchObject({ state: "settled" });
    r.net.mode = "delay";
    expect(await r.ctl.register(register({ expectedEpoch: 1 }))).toMatchObject({
      state: "uncertain",
    });
    r.net.mode = "deliver";
    await r.ctl.handshake();
    expect(await r.ctl.recover(keyOf())).toMatchObject({ state: "settled" });
    expect(await r.ctl.unregister(unregister({ registrationEpoch: 2 }), DIG)).toMatchObject({
      state: "settled",
    });
    expect(r.row()).toMatchObject([{ epoch: 2, state: "unregistered" }]);
    const late = await r.deliver(r.delayed[0]);
    expect(late).toMatchObject({ status: 409, body: { error: "conflict" } });
    expect(r.epochs()).toEqual([1, 2]);
    expect(r.row()).toMatchObject([{ epoch: 2, state: "unregistered" }]);
  });

  it("a recovery that meets a newer lifecycle records the real conflict as divergent and blocks auto-resolution", async () => {
    const r = await ready();
    expect(await r.ctl.register(register())).toMatchObject({ state: "settled" });
    r.net.mode = "delay";
    expect(await r.ctl.unregister(unregister(), DIG)).toMatchObject({ state: "uncertain" });
    // Another device (same owner) closes epoch 1 and opens epoch 2 meanwhile, through the real Worker.
    r.net.mode = "deliver";
    const other = rigLike(r);
    await other.unregisterThenRegister();
    await r.ctl.handshake();
    expect(await r.ctl.recover(keyOf())).toMatchObject({ state: "divergent" });
    expect(intent(r)).toMatchObject({ state: "divergent", maybeApplied: true });
    expect(await r.ctl.register(register({ expectedEpoch: 2 }))).toMatchObject({
      reason: "unresolved",
    });
  });
});

describe("an original answer held until another tab settled and replaced its operation (DT-7C-2B-2-R1)", () => {
  it("the real coordinator's late success for the replaced register is stale; the newer unregister stays", async () => {
    const r = await ready();
    let arrived!: () => void;
    let release!: () => void;
    const atWorker = new Promise<void>((res) => (arrived = res));
    const gate = new Promise<void>((res) => (release = res));
    // Tab A shares the durable persistence; its POST reaches the real Worker, the answer is held in transit.
    const heldFetch: ClientFetch = async (url, init) => {
      const res = await r.deliver({
        url,
        method: init.method,
        headers: { ...init.headers },
        body: init.body,
      });
      if (init.method === "POST") {
        arrived();
        await gate;
      }
      return new Response(JSON.stringify(res.body), { status: res.status });
    };
    const a = createRegistrationController({
      fetch: heldFetch,
      persistence: r.persistence,
      newId: () => "original-A",
    });
    a.configure({ origin: BASE, token: TOKEN });
    expect(await a.handshake()).toMatchObject({ ok: true });
    const original = a.register(register());
    await atWorker;
    expect(r.row()).toMatchObject([{ epoch: 1, state: "active" }]);
    expect(await r.ctl.recover(keyOf())).toMatchObject({
      state: "settled",
      operationId: "original-A",
    });
    expect(await r.ctl.unregister(unregister(), DIG)).toMatchObject({ state: "settled" });
    expect(r.row()).toMatchObject([{ epoch: 1, state: "unregistered" }]);
    const newer = JSON.stringify(r.current());
    release();
    expect(await original).toEqual({
      kind: "stale",
      key: keyOf(),
      operationId: "original-A",
      dispatched: true,
    });
    expect(JSON.stringify(r.current())).toBe(newer);
    expect(intent(r)).toMatchObject({ state: "settled", request: { kind: "unregister" } });
    expect(r.row()).toMatchObject([{ epoch: 1, state: "unregistered" }]);
  });
});

/** A second device's direct calls through the same real Worker (no controller, no persistence). */
function rigLike(r: ReturnType<typeof rig>) {
  const post = (path: string, body: A) =>
    r.deliver({
      url: `${BASE}/social/workflows${path}`,
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    async unregisterThenRegister() {
      const u = await post("/registrations/w1/unregister", {
        ownerKey: OWNER,
        registrationEpoch: 1,
        expectedRevision: 1,
      });
      expect(u.status).toBe(200);
      const g = await post("/registrations", {
        ownerKey: OWNER,
        workflowId: "w1",
        expectedEpoch: 1,
        revision: 3,
        workflowDigest: DIG2,
      });
      expect(g.status).toBe(200);
    },
  };
}
