import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorityOf } from "./cloudWorkflowProtocol";
import type { ClientFetch, ClientRequestInit, ClientResponse } from "./cloudWorkflowClient";
import {
  findRecord,
  readRegistrations,
  registrationKey,
  registrationsIs,
  verifyRegistrations,
  type CloudRegistrations,
} from "./cloudWorkflowRegistration";
import {
  createRegistrationController,
  type ControllerResult,
  type RegistrationPersistence,
} from "./cloudWorkflowRegistrationClient";

// ⚙️ DT-7C-2B-2 controller over the accepted session with a scripted fake fetch and an in-memory locked persistence
// double (same contract as the store adapter: verified read, one serialized CAS commit, exact read-back). The real
// store adapter is covered in store/cloudWorkflowRegistration.test.ts and the real coordinator in the wire test.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TOKEN = "secret-token-CANARY-7c2b2";
const OWNER = "wfo_" + "a".repeat(32);
const OWNER_B = "wfo_" + "b".repeat(32);
const ORIGIN = "https://scout.example";
const ORIGIN_B = "https://other.example";
const DIG = "d".repeat(64);
const KEY = registrationKey(authorityOf(ORIGIN, OWNER)!, "w1")!;
const opened = (e: number) => `2026-10-18T0${e}:00:00.000Z`;
const closed = (e: number) => `2026-10-18T0${e}:30:00.000Z`;
function registration(epoch: number, state: "active" | "unregistered", o: A = {}): A {
  return {
    workflowId: "w1",
    registrationEpoch: epoch,
    revision: o.revision ?? 1,
    workflowDigest: o.digest ?? DIG,
    state,
    paused: false,
    updatedAt: state === "active" ? opened(epoch) : closed(epoch),
    epochs: Array.from({ length: epoch }, (_, i) => ({
      epoch: i + 1,
      openedAt: opened(i + 1),
      ...(i < epoch - 1 || state === "unregistered" ? { closedAt: closed(i + 1) } : {}),
    })),
  };
}
const registerReq = (o: A = {}) => ({
  kind: "register",
  ownerKey: OWNER,
  workflowId: "w1",
  expectedEpoch: 0,
  revision: 1,
  workflowDigest: DIG,
  ...o,
});
const unregisterReq = (o: A = {}) => ({
  kind: "unregister",
  ownerKey: OWNER,
  workflowId: "w1",
  registrationEpoch: 1,
  expectedRevision: 1,
  ...o,
});

/** In-memory locked persistence: one serialized holder at a time, canonical read-back, failure switches. */
function memoryStore() {
  const st = {
    raw: undefined as string | undefined,
    unreadable: false,
    dropWrite: false,
    commits: 0,
    entered: 0,
    /** Awaited inside the lock before mutate runs (a slow lock / another holder), with the commit's number. */
    gate: null as null | ((n: number) => Promise<void>),
    /** Awaited inside the lock after the write, with the commit's number. */
    after: null as null | ((n: number) => Promise<void>),
  };
  let tail: Promise<unknown> = Promise.resolve();
  const current = () => readRegistrations(st.raw === undefined ? undefined : JSON.parse(st.raw));
  const persistence: RegistrationPersistence = {
    async read() {
      if (st.unreadable) return null;
      const s = current();
      return s && (await verifyRegistrations(s)) ? s : null;
    },
    commit(mutate) {
      const run = tail.then(async () => {
        const n = ++st.entered;
        if (st.gate) await st.gate(n);
        const fresh = st.unreadable ? null : current();
        if (!fresh) return { ok: false, reason: "registrations-unreadable" } as const;
        const out = mutate(fresh);
        if (!("next" in out)) return out.result;
        st.commits++;
        if (!st.dropWrite) st.raw = JSON.stringify(out.next);
        if (st.after) await st.after(n);
        const back = st.raw === undefined ? undefined : JSON.parse(st.raw);
        return registrationsIs(back, out.next)
          ? out.result
          : ({ ok: false, reason: "not-persisted" } as const);
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
  const slice = (): CloudRegistrations => current()!;
  return { st, persistence, slice, intent: () => findRecord(slice(), KEY)?.intent };
}

type Script = (url: string, init: ClientRequestInit) => Promise<ClientResponse> | ClientResponse;
const json = (status: number, body: unknown): ClientResponse =>
  new Response(JSON.stringify(body), { status }) as unknown as ClientResponse;
function fakeFetch(script: Script, owner = OWNER) {
  const calls: { url: string; init: ClientRequestInit; body?: A }[] = [];
  const fetch: ClientFetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith("/social/workflows/authority")) return json(200, { ownerKey: owner });
    return script(url, init);
  };
  const posts = () => calls.filter((c) => c.init.method === "POST");
  return { fetch, calls, posts };
}
const okRegister = (req: A, created = true) =>
  json(200, {
    ownerKey: req.ownerKey,
    registration: registration(req.expectedEpoch + 1, "active"),
    created,
  });
const okUnregister = (req: A, changed = true) =>
  json(200, {
    ownerKey: req.ownerKey,
    registration: registration(req.registrationEpoch, "unregistered"),
    changed,
  });
const lost = (): ClientResponse => {
  throw new TypeError("network lost");
};
/** A response held until released. */
function held() {
  let release!: (r: ClientResponse) => void;
  let fail!: (e: unknown) => void;
  const started = { value: false };
  const promise = new Promise<ClientResponse>((res, rej) => ((release = res), (fail = rej)));
  return { promise, release, fail, started };
}

async function setup(script: Script, owner = OWNER) {
  const mem = memoryStore();
  const net = fakeFetch(script, owner);
  let n = 0;
  const ctl = createRegistrationController({
    fetch: net.fetch,
    persistence: mem.persistence,
    now: () => new Date("2026-10-18T07:00:00.000Z"),
    newId: () => `op-${++n}`,
  });
  ctl.configure({ origin: ORIGIN, token: TOKEN });
  return { mem, net, ctl };
}
const kindOf = (r: ControllerResult) => r.kind;

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("construction, authority and refusals (zero mutation requests)", () => {
  it("constructing makes no request and needs a validated handshake before any intent", async () => {
    const { mem, net, ctl } = await setup(() => okRegister(registerReq()));
    expect(net.calls).toHaveLength(0);
    expect(await ctl.register(registerReq())).toEqual({
      kind: "refused",
      reason: "no_authority",
      dispatched: false,
    });
    expect(await ctl.handshake()).toEqual({
      ok: true,
      authority: { origin: ORIGIN, ownerKey: OWNER },
    });
    expect(await ctl.register(registerReq({ ownerKey: OWNER_B }))).toMatchObject({
      reason: "foreign_owner",
    });
    expect(await ctl.register(unregisterReq())).toMatchObject({ reason: "invalid_request" });
    expect(await ctl.unregister(unregisterReq(), "nope")).toMatchObject({
      reason: "invalid_request",
    });
    expect(await ctl.register({ ...registerReq(), token: TOKEN })).toMatchObject({
      reason: "invalid_request",
    });
    expect(net.posts()).toHaveLength(0);
    expect(mem.st.commits).toBe(0);
  });

  it("failed, unsupported or unreadable persistence means zero mutation requests", async () => {
    const { mem, net, ctl } = await setup(() => okRegister(registerReq()));
    await ctl.handshake();
    mem.st.unreadable = true;
    expect(await ctl.register(registerReq())).toMatchObject({ reason: "unreadable" });
    mem.st.unreadable = false;
    mem.st.dropWrite = true; // the write is not kept: the read-back fails
    expect(await ctl.register(registerReq())).toMatchObject({ reason: "not_persisted" });
    expect(net.posts()).toHaveLength(0);
    const unsupported = createRegistrationController({
      fetch: net.fetch,
      persistence: {
        read: mem.persistence.read,
        commit: async () => ({ ok: false, reason: "unsupported-save" }),
      },
    });
    unsupported.configure({ origin: ORIGIN, token: TOKEN });
    await unsupported.handshake();
    mem.st.dropWrite = false;
    expect(await unsupported.register(registerReq())).toMatchObject({ reason: "unsupported_save" });
    expect(net.posts()).toHaveLength(0);
  });
});

describe("durable intent before the mutation fetch, then exact recovery", () => {
  it("persists the exact validated request (pending, then a reserved attempt) BEFORE the POST, then settles", async () => {
    const seen: A[] = [];
    const ctx = await setup((_url, init) => {
      const i = ctx.mem.intent()!;
      seen.push({
        state: i.state,
        attempts: i.attempts,
        sent: JSON.parse(init.body!),
        body: i.body,
      });
      return okRegister(registerReq());
    });
    const { mem, net, ctl } = ctx;
    await ctl.handshake();
    const r = await ctl.register(registerReq());
    expect(r).toEqual({
      kind: "recorded",
      key: KEY,
      operationId: "op-1",
      state: "settled",
      dispatched: true,
      persisted: true,
    });
    expect(seen).toEqual([
      { state: "dispatching", attempts: 1, sent: seen[0].body, body: seen[0].body },
    ]);
    expect(net.posts()).toHaveLength(1);
    expect(mem.intent()).toMatchObject({ state: "settled", request: registerReq() });
    // Privacy: no token in what is stored, in results or in the authority record.
    expect(mem.st.raw).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("a lost register answer stays uncertain, is never replayed by itself, and recovers only explicitly with the identical request after a new handshake", async () => {
    let mode: "lost" | "ok" = "lost";
    const { mem, net, ctl } = await setup(() =>
      mode === "lost" ? lost() : okRegister(registerReq(), false),
    );
    await ctl.handshake();
    const first = await ctl.register(registerReq());
    expect(first).toMatchObject({ kind: "recorded", state: "uncertain", dispatched: true });
    expect(net.posts()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(net.posts()).toHaveLength(1); // nothing automatic
    // A new intent for the key is blocked while it is unresolved.
    expect(await ctl.register(registerReq({ revision: 2 }))).toMatchObject({
      reason: "unresolved",
    });
    // Recovery needs a NEW handshake since this controller's last attempt.
    expect(await ctl.recover(KEY)).toMatchObject({ reason: "handshake_required" });
    expect(net.posts()).toHaveLength(1);
    await ctl.handshake();
    mode = "ok";
    const again = await ctl.recover(KEY);
    expect(again).toMatchObject({ kind: "recorded", state: "settled", operationId: "op-1" });
    const [a, b] = net.posts();
    expect(b.init.body).toBe(a.init.body); // byte-identical replay
    expect(b.url).toBe(a.url);
    expect(mem.intent()).toMatchObject({ attempts: 2, state: "settled" });
    expect(await ctl.recover(KEY)).toMatchObject({ reason: "handshake_required" });
    await ctl.handshake();
    expect(await ctl.recover(KEY)).toMatchObject({ reason: "not_recoverable" });
  });

  it("a lost unregister answer recovers the same way", async () => {
    let mode: "lost" | "ok" = "lost";
    const { mem, net, ctl } = await setup(() =>
      mode === "lost" ? lost() : okUnregister(unregisterReq(), false),
    );
    await ctl.handshake();
    expect(await ctl.unregister(unregisterReq(), DIG)).toMatchObject({ state: "uncertain" });
    await ctl.handshake();
    mode = "ok";
    expect(await ctl.recover(KEY)).toMatchObject({ state: "settled" });
    expect(net.posts().map((c) => c.init.body)).toEqual([
      net.posts()[0].init.body,
      net.posts()[0].init.body,
    ]);
    expect(mem.intent()).toMatchObject({ workflowDigest: DIG, revision: 1 });
  });

  it("an outcome that cannot be persisted leaves the intent dispatching (recoverable, blocking new intents)", async () => {
    const ctx = await setup(() => {
      ctx.mem.st.dropWrite = true;
      return okRegister(registerReq());
    });
    await ctx.ctl.handshake();
    expect(await ctx.ctl.register(registerReq())).toMatchObject({
      kind: "recorded",
      state: "dispatching",
      persisted: false,
    });
    ctx.mem.st.dropWrite = false;
    expect(ctx.mem.intent()).toMatchObject({ state: "dispatching", attempts: 1 });
    expect(await ctx.ctl.register(registerReq())).toMatchObject({ reason: "unresolved" });
  });
});

describe("fences: configuration/token/visit A-B-A, dispose, latest action, foreign authority", () => {
  /** Holds the persistence lock at commit number `n` (before or after its write) until released. */
  function holdCommit(
    mem: ReturnType<typeof memoryStore>,
    n: number,
    at: "gate" | "after" = "gate",
  ) {
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    mem.st[at] = async (k: number) => {
      if (k !== n) return;
      entered();
      await gate;
    };
    return { inside, release };
  }

  for (const [name, move] of [
    [
      "origin A-B-A",
      (c: A) => (
        c.configure({ origin: ORIGIN_B, token: TOKEN }),
        c.configure({ origin: ORIGIN, token: TOKEN })
      ),
    ],
    [
      "token A-B-A",
      (c: A) => (
        c.configure({ origin: ORIGIN, token: "other" }),
        c.configure({ origin: ORIGIN, token: TOKEN })
      ),
    ],
    ["visit invalidation", (c: A) => c.invalidateVisit()],
    ["dispose", (c: A) => c.dispose()],
    ["a newer action", (c: A) => void c.handshake()],
  ] as const) {
    it(`${name} while the intent is being created: nothing is written or sent`, async () => {
      const { mem, net, ctl } = await setup(() => okRegister(registerReq()));
      await ctl.handshake();
      const h = holdCommit(mem, 1);
      const p = ctl.register(registerReq());
      await h.inside;
      move(ctl as unknown as A);
      h.release();
      expect(kindOf(await p)).toBe("refused");
      expect(mem.st.raw).toBeUndefined();
      expect(net.posts()).toHaveLength(0);
    });

    it(`${name} while the attempt is being reserved: the intent stays pending, zero POST`, async () => {
      const { mem, net, ctl } = await setup(() => okRegister(registerReq()));
      await ctl.handshake();
      const h = holdCommit(mem, 2); // the create commit passes; the reservation's lock is held
      const p = ctl.register(registerReq());
      await h.inside;
      move(ctl as unknown as A);
      h.release();
      expect(await p).toMatchObject({ kind: "stale", dispatched: false, key: KEY });
      expect(mem.intent()).toMatchObject({ state: "pending", attempts: 0 });
      expect(net.posts()).toHaveLength(0);
    });
  }

  it("a fence moving after the reservation releases it as not dispatched (zero POST)", async () => {
    const { mem, net, ctl } = await setup(() => okRegister(registerReq()));
    await ctl.handshake();
    const h = holdCommit(mem, 2, "after"); // the reservation is written; the lock is still held
    const p = ctl.register(registerReq());
    await h.inside;
    ctl.invalidateVisit();
    h.release();
    expect(await p).toMatchObject({ kind: "stale", dispatched: false });
    expect(mem.intent()).toMatchObject({ state: "pending", attempts: 1 });
    expect(net.posts()).toHaveLength(0);
  });

  it("an answer arriving after a fence moved is recorded on its ORIGINAL intent only; the caller gets stale", async () => {
    const h = held();
    const { mem, net, ctl } = await setup(() => h.promise);
    await ctl.handshake();
    const p = ctl.register(registerReq());
    await vi.waitFor(() => expect(net.posts()).toHaveLength(1));
    ctl.configure({ origin: ORIGIN_B, token: TOKEN }); // the session aborts the in-flight POST
    h.release(okRegister(registerReq()));
    expect(await p).toMatchObject({ kind: "stale", dispatched: true, key: KEY });
    // Abort is not proof of "not applied": the intent is uncertain under its original authority.
    expect(findRecord(mem.slice(), KEY)).toMatchObject({ origin: ORIGIN, ownerKey: OWNER });
    expect(mem.intent()).toMatchObject({ state: "uncertain", maybeApplied: true });
  });

  it("recovery never retargets: another origin or owner is refused with zero POST", async () => {
    const { net, ctl, mem } = await setup(lost);
    await ctl.handshake();
    await ctl.register(registerReq());
    ctl.configure({ origin: ORIGIN_B, token: TOKEN });
    await ctl.handshake();
    expect(await ctl.recover(KEY)).toMatchObject({ reason: "foreign_origin" });
    const other = createRegistrationController({
      fetch: fakeFetch(lost, OWNER_B).fetch,
      persistence: mem.persistence,
    });
    other.configure({ origin: ORIGIN, token: TOKEN });
    await other.handshake();
    expect(await other.recover(KEY)).toMatchObject({ reason: "foreign_owner" });
    expect(net.posts()).toHaveLength(1);
  });

  it("captures the caller's request once: an accessor that reconfigures is refused, later edits change nothing", async () => {
    const { mem, net, ctl } = await setup(() => okRegister(registerReq()));
    await ctl.handshake();
    const sneaky = {
      ...registerReq(),
      get revision() {
        ctl.configure({ origin: ORIGIN_B, token: TOKEN });
        return 1;
      },
    };
    expect(await ctl.register(sneaky)).toMatchObject({ kind: "refused", reason: "superseded" });
    expect(mem.st.raw).toBeUndefined();
    ctl.configure({ origin: ORIGIN, token: TOKEN });
    await ctl.handshake();
    const raw = registerReq() as A;
    const p = ctl.register(raw);
    raw.revision = 7;
    raw.workflowDigest = "f".repeat(64);
    expect(await p).toMatchObject({ state: "settled" });
    expect(mem.intent()!.request).toEqual(registerReq());
    expect(net.posts()[0].body).toMatchObject({ revision: 1, workflowDigest: DIG });
  });
});

describe("concurrency: two tabs, one recovery per key, late answers vs newer durable truth", () => {
  it("two controllers recovering one key from the same base: one reserves and sends, the other is refused", async () => {
    const mem = memoryStore();
    let mode: "lost" | "ok" = "lost";
    const netA = fakeFetch(() => (mode === "lost" ? lost() : okRegister(registerReq(), false)));
    const netB = fakeFetch(() => okRegister(registerReq(), false));
    const a = createRegistrationController({ fetch: netA.fetch, persistence: mem.persistence });
    const b = createRegistrationController({ fetch: netB.fetch, persistence: mem.persistence });
    for (const c of [a, b]) {
      c.configure({ origin: ORIGIN, token: TOKEN });
      await c.handshake();
    }
    expect(await a.register(registerReq())).toMatchObject({ state: "uncertain" });
    await a.handshake();
    mode = "ok";
    const [ra, rb] = await Promise.all([a.recover(KEY), b.recover(KEY)]);
    const results = [ra, rb].map((r) => (r.kind === "refused" ? r.reason : r.kind));
    expect(results.sort()).toEqual(["recorded", "stale_record"]);
    expect(netA.posts().length + netB.posts().length).toBe(2); // the original + ONE recovery
    expect(mem.intent()).toMatchObject({ state: "settled", attempts: 2 });
  });

  it("no parallel recovery of one key inside one controller", async () => {
    const h = held();
    let mode: "lost" | "held" = "lost";
    const { ctl, net } = await setup(() => (mode === "lost" ? lost() : h.promise));
    await ctl.handshake();
    await ctl.register(registerReq());
    await ctl.handshake();
    mode = "held";
    const first = ctl.recover(KEY);
    expect(await ctl.recover(KEY)).toMatchObject({ reason: "busy" });
    await vi.waitFor(() => expect(net.posts()).toHaveLength(2));
    h.release(okRegister(registerReq(), false));
    expect(await first).toMatchObject({ state: "settled" });
  });

  it("a late failure of an older attempt never overwrites a newer tab's settled truth", async () => {
    const mem = memoryStore();
    const h = held();
    const netA = fakeFetch(() => h.promise);
    const netB = fakeFetch(() => okRegister(registerReq(), false));
    const a = createRegistrationController({ fetch: netA.fetch, persistence: mem.persistence });
    const b = createRegistrationController({ fetch: netB.fetch, persistence: mem.persistence });
    for (const c of [a, b]) {
      c.configure({ origin: ORIGIN, token: TOKEN });
      await c.handshake();
    }
    const pa = a.register(registerReq());
    await vi.waitFor(() => expect(netA.posts()).toHaveLength(1));
    // Tab B sees the dispatching intent (as after a crash) and recovers it explicitly.
    expect(await b.recover(KEY)).toMatchObject({ state: "settled" });
    h.fail(new TypeError("late network failure"));
    expect(await pa).toMatchObject({
      kind: "recorded",
      state: "settled",
      dispatched: true,
      persisted: true,
    });
    expect(mem.intent()).toMatchObject({ state: "settled", attempts: 2 });
  });

  // DT-7C-2B-2-R1 (7C2B2-2): the operation-identity CAS result reaches the caller.
  for (const late of ["success", "failure"] as const) {
    it(`a late ${late} of an operation another tab settled and replaced is stale, never recorded/dispatching`, async () => {
      const mem = memoryStore();
      const h = held();
      const netA = fakeFetch(() => h.promise);
      const netB = fakeFetch((url) =>
        url.endsWith("/unregister")
          ? okUnregister(unregisterReq())
          : okRegister(registerReq(), false),
      );
      const a = createRegistrationController({
        fetch: netA.fetch,
        persistence: mem.persistence,
        newId: () => "op-A",
      });
      const b = createRegistrationController({
        fetch: netB.fetch,
        persistence: mem.persistence,
        newId: () => "op-B",
      });
      for (const c of [a, b]) {
        c.configure({ origin: ORIGIN, token: TOKEN });
        await c.handshake();
      }
      const pa = a.register(registerReq());
      await vi.waitFor(() => expect(netA.posts()).toHaveLength(1));
      expect(await b.recover(KEY)).toMatchObject({ state: "settled", operationId: "op-A" });
      expect(await b.unregister(unregisterReq(), DIG)).toMatchObject({
        kind: "recorded",
        state: "settled",
        operationId: "op-B",
      });
      const newer = mem.st.raw;
      const commits = mem.st.commits;
      if (late === "success") h.release(okRegister(registerReq()));
      else h.fail(new TypeError("late original network failure"));
      expect(await pa).toEqual({ kind: "stale", key: KEY, operationId: "op-A", dispatched: true });
      expect(mem.st.raw).toBe(newer); // the newer record is untouched: no write, no retry
      expect(mem.st.commits).toBe(commits);
      expect(mem.intent()).toMatchObject({ operationId: "op-B", state: "settled" });
      expect(netA.posts()).toHaveLength(1);
    });
  }
});
