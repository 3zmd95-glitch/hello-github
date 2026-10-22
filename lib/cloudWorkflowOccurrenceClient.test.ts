import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { payloadDigestOf } from "@/workers/scout/src/social/workflowProtocol";
import { occurrenceKey, type OccurrenceBody } from "./cloudWorkflowProtocol";
import type { ClientRequestInit, ClientResponse } from "./cloudWorkflowClient";
import {
  createOccurrenceController,
  type CloudFence,
  type OccurrencePersistence,
  type OccurrenceResult,
  type SavedOccurrence,
} from "./cloudWorkflowOccurrenceClient";

// ⚙️ DT-7C-2B-4 occurrence controller state machine (planning/tools/38-cloud-workflows.md). Fake transport and a fake
// persistence double only (the real router, coordinator, store reader and journal live in
// store/cloudWorkflowOccurrence.test.ts). Global fetch forbidden.

const ORIGIN = "https://scout.test";
const OTHER = "https://other.test";
const TOKEN = "occ-unit-token-1";
const OWNER = "wfo_" + "1".repeat(32);
const OWNER_B = "wfo_" + "2".repeat(32);
const T0 = "2026-10-17T09:00:00.000Z";
const PATH = "/social/workflows/occurrences";

const body = (o: Record<string, unknown> = {}): OccurrenceBody =>
  ({
    occurrenceId: "occ-1",
    ownerKey: OWNER,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "سير", en: "Flow" },
      trigger: { kind: "manual" },
      actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea {date}" } }],
    },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt: T0,
    ...o,
  }) as OccurrenceBody;

let DIGEST = "";
beforeAll(async () => {
  DIGEST = await payloadDigestOf(body());
});

function saved(o: Partial<SavedOccurrence> = {}): SavedOccurrence {
  const authority = o.authority ?? { origin: ORIGIN, ownerKey: OWNER };
  const b = o.body ?? body({ ownerKey: authority.ownerKey });
  return {
    key: occurrenceKey(authority, "occ-1")!,
    authority,
    occurrenceId: "occ-1",
    workflowId: "w1",
    body: b,
    payloadDigest: DIGEST,
    executionAt: T0,
    commitId: "c1",
    state: "queued",
    suppression: { epoch: 0, resetAt: null, commitId: null },
    ...o,
  };
}

const enc = new TextEncoder();
const res = (status: number, json: unknown): ClientResponse => ({
  status,
  body: new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(JSON.stringify(json)));
      c.close();
    },
  }),
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => (resolve = a));
  return { promise, resolve };
}
const tick = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

type Handler = (url: string, init: ClientRequestInit) => Promise<ClientResponse>;
function rig(entry: SavedOccurrence | null = saved(), owner = OWNER) {
  const calls: { url: string; init: ClientRequestInit }[] = [];
  let handler: Handler = async () => res(200, { ownerKey: owner });
  let fence: CloudFence = { config: 0, visit: 0 };
  const log: string[] = [];
  const hooks: { read?: () => void; dispatch?: () => void } = {};
  const persistence: OccurrencePersistence = {
    fence: () => fence,
    read: vi.fn(async (key: string) => {
      log.push("read");
      hooks.read?.();
      return entry && key === entry.key
        ? { ok: true as const, entry }
        : { ok: false as const, reason: "missing" as const };
    }),
    dispatch: vi.fn(async (e, go) => {
      log.push("dispatch");
      hooks.dispatch?.();
      expect(e).toBe(entry);
      const v = go();
      return v === null
        ? { ok: false as const, reason: "superseded" as const }
        : { ok: true as const, value: v };
    }),
    observe: vi.fn(async () => ({ ok: true as const, changed: true })),
  };
  const ctl = createOccurrenceController({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
    persistence,
  });
  return {
    ctl,
    calls,
    log,
    hooks,
    persistence,
    answer: (h: Handler) => void (handler = h),
    bump: (k: keyof CloudFence = "config") => void (fence = { ...fence, [k]: fence[k] + 1 }),
    /** Requests after the handshake. */
    sent: () => calls.filter((c) => !c.url.endsWith("/authority")),
  };
}
async function ready(entry?: SavedOccurrence | null, owner?: string) {
  const r = rig(entry, owner);
  expect(r.ctl.configure({ origin: ORIGIN, token: TOKEN })).toEqual({ ok: true, origin: ORIGIN });
  expect(await r.ctl.handshake()).toMatchObject({ ok: true });
  return r;
}
const KEY = () => saved().key;
const is = <K extends OccurrenceResult["kind"]>(r: OccurrenceResult, k: K) => {
  expect(r.kind).toBe(k);
  return r as Extract<OccurrenceResult, { kind: K }>;
};

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("nothing happens on its own", () => {
  it("construction, configuration, visit invalidation and disposal make no request and read nothing", () => {
    const r = rig();
    r.ctl.configure({ origin: ORIGIN, token: TOKEN });
    r.ctl.invalidateVisit();
    r.ctl.dispose();
    expect(r.calls).toEqual([]);
    expect(r.log).toEqual([]);
  });

  it("a handshake (reconnect) is one GET authority and starts no occurrence action", async () => {
    const r = await ready();
    await r.ctl.handshake();
    expect(r.calls.map((c) => c.url)).toEqual([
      `${ORIGIN}/social/workflows/authority`,
      `${ORIGIN}/social/workflows/authority`,
    ]);
    expect(r.log).toEqual([]);
  });

  it("an insecure origin is never configured: no handshake, no action", async () => {
    const r = rig();
    expect(r.ctl.configure({ origin: "http://scout.test", token: TOKEN })).toEqual({
      ok: false,
      reason: "insecure",
    });
    expect(await r.ctl.handshake()).toEqual({ ok: false, reason: "not_configured" });
    expect(await r.ctl.submit(KEY())).toMatchObject({ kind: "refused", reason: "not_configured" });
    expect(r.calls).toEqual([]);
  });
});

describe("refusals before any request", () => {
  it("not configured, no handshake, a bad key, a missing entry: zero requests", async () => {
    const r = rig();
    expect(await r.ctl.submit(KEY())).toMatchObject({ kind: "refused", reason: "not_configured" });
    r.ctl.configure({ origin: ORIGIN, token: TOKEN });
    expect(await r.ctl.status(KEY())).toMatchObject({ kind: "refused", reason: "no_authority" });
    await r.ctl.handshake();
    expect(await r.ctl.run(42)).toMatchObject({ kind: "refused", reason: "invalid_key" });
    expect(await r.ctl.cancel("nope")).toMatchObject({ kind: "refused", reason: "missing" });
    expect(r.sent()).toEqual([]);
  });

  it("a foreign origin or owner (imported, retargeted or another Worker's entry) is refused, never retargeted", async () => {
    const foreign = await ready(saved({ authority: { origin: OTHER, ownerKey: OWNER } }));
    expect(
      await foreign.ctl.submit(saved({ authority: { origin: OTHER, ownerKey: OWNER } }).key),
    ).toMatchObject({ kind: "refused", reason: "foreign_origin", dispatched: false });
    const owner = saved({ authority: { origin: ORIGIN, ownerKey: OWNER_B } });
    const other = await ready(owner);
    for (const a of ["submit", "status", "run", "cancel"] as const)
      expect(await other.ctl[a](owner.key)).toMatchObject({
        kind: "refused",
        reason: "foreign_owner",
      });
    expect([...foreign.sent(), ...other.sent()]).toEqual([]);
    expect(foreign.log).not.toContain("dispatch");
  });

  it("a suppressed (pre-reset) entry refuses Submit and Run; Check status and Cancel stay available", async () => {
    const old = saved({
      state: "suppressed",
      suppression: { epoch: 1, resetAt: T0, commitId: "r1" },
    });
    const r = await ready(old);
    expect(await r.ctl.submit(old.key)).toMatchObject({ kind: "refused", reason: "suppressed" });
    expect(await r.ctl.run(old.key)).toMatchObject({ kind: "refused", reason: "suppressed" });
    expect(r.sent()).toEqual([]);
    r.answer(async () => res(200, { ownerKey: OWNER, occurrenceId: "occ-1", state: "absent" }));
    const s = is(await r.ctl.status(old.key), "answered");
    expect(s.parsed).toMatchObject({ outcome: "ok", kind: "status", result: { found: "absent" } });
    expect(s.recorded).toBeNull();
    r.answer(async () => res(404, { error: "absent", ownerKey: OWNER, occurrenceId: "occ-1" }));
    const c = is(await r.ctl.cancel(old.key), "answered");
    expect(c.parsed).toMatchObject({ outcome: "refused", error: "absent" });
    expect(r.sent().map((x) => x.init.method)).toEqual(["GET", "POST"]);
  });

  it("persistence failures are typed refusals with zero requests, never a raw exception", async () => {
    const r = await ready();
    r.persistence.read = async () => {
      throw new Error("boom");
    };
    expect(await r.ctl.submit(KEY())).toMatchObject({ kind: "refused", reason: "unreadable" });
    r.persistence.read = async () => ({ ok: false, reason: "invalid" });
    expect(await r.ctl.submit(KEY())).toMatchObject({ kind: "refused", reason: "invalid" });
    const e = saved();
    r.persistence.read = async () => ({ ok: true, entry: e });
    r.persistence.dispatch = async () => ({ ok: false, reason: "moved" });
    expect(await r.ctl.submit(e.key)).toMatchObject({ kind: "refused", reason: "moved" });
    r.persistence.dispatch = async () => ({ ok: false, reason: "not-persisted" });
    expect(await r.ctl.submit(e.key)).toMatchObject({ kind: "refused", reason: "not_persisted" });
    r.persistence.dispatch = async () => {
      throw new Error("lock");
    };
    expect(await r.ctl.submit(e.key)).toMatchObject({ kind: "refused", reason: "not_persisted" });
    expect(r.sent()).toEqual([]);
  });
});

describe("requests come only from the saved occurrence", () => {
  it("Submit sends exactly the saved body and digest; Status/Run/Cancel the saved owner and id", async () => {
    const r = await ready();
    r.answer(async () => {
      throw new TypeError("lost");
    });
    for (const a of ["submit", "status", "run", "cancel"] as const) await r.ctl[a](KEY());
    const [sub, st, run, cancel] = r.sent();
    expect(sub.url).toBe(`${ORIGIN}${PATH}`);
    expect(sub.init.body).toBe(JSON.stringify({ body: saved().body, payloadDigest: DIGEST }));
    expect(st.url).toBe(`${ORIGIN}${PATH}/occ-1?ownerKey=${OWNER}`);
    expect(run.url).toBe(`${ORIGIN}${PATH}/occ-1/run`);
    expect(cancel.url).toBe(`${ORIGIN}${PATH}/occ-1/cancel`);
    expect(run.init.body).toBe(JSON.stringify({ ownerKey: OWNER }));
    expect(r.sent()).toHaveLength(4);
  });

  it("a lost Submit answer is unconfirmed (dispatched), never failed, never retried", async () => {
    const r = await ready();
    r.answer(async () => {
      throw new TypeError("lost");
    });
    const u = is(await r.ctl.submit(KEY()), "unconfirmed");
    expect(u).toMatchObject({ action: "submit", dispatched: true, category: "network" });
    await tick();
    expect(r.sent()).toHaveLength(1);
    expect(r.persistence.observe).not.toHaveBeenCalled();
  });

  it("status absent and pruned are distinct answers and record nothing; another digest's tombstone is not this one", async () => {
    const r = await ready();
    r.answer(async () =>
      res(200, {
        ownerKey: OWNER,
        occurrenceId: "occ-1",
        state: "pruned",
        payloadDigest: DIGEST,
        prunedAt: T0,
      }),
    );
    const p = is(await r.ctl.status(KEY()), "answered");
    expect(p.parsed).toMatchObject({ result: { found: "pruned", payloadDigest: DIGEST } });
    expect(p.recorded).toBeNull();
    r.answer(async () =>
      res(200, {
        ownerKey: OWNER,
        occurrenceId: "occ-1",
        state: "pruned",
        payloadDigest: "f".repeat(64),
        prunedAt: T0,
      }),
    );
    expect(await r.ctl.status(KEY())).toMatchObject({
      kind: "unconfirmed",
      category: "invalid_answer",
    });
    expect(r.persistence.observe).not.toHaveBeenCalled();
  });
});

describe("fences: configuration/visit generations, latest action, disposal", () => {
  it("a store fence moved during the read refuses before any request (A-B-A included)", async () => {
    const r = await ready();
    r.hooks.read = () => {
      r.bump();
      r.bump();
    };
    expect(await r.ctl.submit(KEY())).toMatchObject({ kind: "refused", reason: "superseded" });
    r.hooks.read = () => r.bump("visit");
    expect(await r.ctl.submit(KEY())).toMatchObject({
      kind: "refused",
      reason: "handshake_required",
    });
    expect(r.sent()).toEqual([]);
  });

  it("a store fence moved inside the locked dispatch sends nothing", async () => {
    const r = await ready();
    r.hooks.dispatch = () => r.bump();
    expect(await r.ctl.status(KEY())).toMatchObject({ kind: "refused", reason: "superseded" });
    expect(r.sent()).toEqual([]);
  });

  it("moving away and back never revives an old authority: a fresh handshake is required", async () => {
    const r = await ready();
    r.bump();
    expect(await r.ctl.status(KEY())).toMatchObject({
      kind: "refused",
      reason: "handshake_required",
    });
    expect(r.log).toEqual([]);
    await r.ctl.handshake();
    r.answer(async () => res(200, { ownerKey: OWNER, occurrenceId: "occ-1", state: "absent" }));
    expect(await r.ctl.status(KEY())).toMatchObject({ kind: "answered" });
  });

  it("an answer arriving after the fence moved is stale: no current claim, bound evidence only", async () => {
    const r = await ready();
    const held = deferred<ClientResponse>();
    r.answer(() => held.promise);
    const p = r.ctl.status(KEY());
    await tick();
    r.bump("visit");
    held.resolve(res(200, { ownerKey: OWNER, occurrenceId: "occ-1", state: "absent" }));
    expect(await p).toMatchObject({
      kind: "stale",
      action: "status",
      dispatched: true,
      recorded: null,
    });
  });

  it("controller configure/visit changes and a newer action supersede the older one", async () => {
    const r = await ready();
    const held = deferred<ClientResponse>();
    r.answer(() => held.promise);
    const first = r.ctl.submit(KEY());
    await tick();
    r.answer(async () => res(200, { ownerKey: OWNER, occurrenceId: "occ-1", state: "absent" }));
    const second = await r.ctl.status(KEY());
    expect(await first).toMatchObject({ kind: "stale", action: "submit", dispatched: true });
    expect(second).toMatchObject({ kind: "answered", action: "status" });
    held.resolve(res(200, {}));
    const again = deferred<ClientResponse>();
    r.answer(() => again.promise);
    const third = r.ctl.status(KEY());
    await tick();
    r.ctl.configure({ origin: OTHER, token: TOKEN });
    r.ctl.configure({ origin: ORIGIN, token: TOKEN });
    expect(await third).toMatchObject({ kind: "stale", dispatched: true });
    expect(await r.ctl.status(KEY())).toMatchObject({ kind: "refused", reason: "no_authority" });
    again.resolve(res(200, {}));
  });

  it("disposal mid-flight is safe: stale, no exception, everything afterwards refused", async () => {
    const r = await ready();
    const held = deferred<ClientResponse>();
    r.answer(() => held.promise);
    const p = r.ctl.run(KEY());
    await tick();
    r.ctl.dispose();
    expect(await p).toMatchObject({ kind: "stale", dispatched: true });
    expect(await r.ctl.submit(KEY())).toMatchObject({ kind: "refused", reason: "disposed" });
    expect(await r.ctl.handshake()).toEqual({ ok: false, reason: "disposed" });
    held.resolve(res(200, {}));
  });
});

describe("result classification after a fence moves (DT-7C-2B-4-R1)", () => {
  const failures: [string, Handler, string][] = [
    [
      "network",
      async () => {
        throw new TypeError("lost");
      },
      "network",
    ],
    ["malformed_json", async () => ({ status: 200, body: bodyOf("{") }), "malformed_json"],
    ["invalid_answer", async () => res(200, {}), "invalid_answer"],
    [
      "receipt_unavailable",
      async () => res(503, { error: "receipt_unavailable" }),
      "receipt_unavailable",
    ],
  ];
  function bodyOf(text: string) {
    return new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(text));
        c.close();
      },
    });
  }

  for (const [name, handler, category] of failures)
    for (const move of ["config", "visit"] as const) {
      it(`${name} answer after a store ${move} change is stale, still dispatched; unmoved it is unconfirmed`, async () => {
        const unmoved = await ready();
        unmoved.answer(handler);
        expect(await unmoved.ctl.submit(KEY())).toMatchObject({
          kind: "unconfirmed",
          dispatched: true,
          category,
        });

        const r = await ready();
        const held = deferred<void>();
        r.answer(async (u, i) => {
          await held.promise;
          return handler(u, i);
        });
        const p = r.ctl.submit(KEY());
        await tick();
        r.bump(move);
        r.bump(move); // moved twice: an A-B-A on the store fence
        held.resolve();
        expect(await p).toEqual({
          kind: "stale",
          action: "submit",
          key: KEY(),
          dispatched: true,
          recorded: null,
        });
        expect(r.sent()).toHaveLength(1);
        expect(r.persistence.observe).not.toHaveBeenCalled();
      });
    }

  it("an older lost Submit is stale while a newer Status still waits on its durable read", async () => {
    const r = await ready();
    const held = deferred<void>();
    r.answer(async () => {
      await held.promise;
      throw new TypeError("lost");
    });
    const first = r.ctl.submit(KEY());
    await tick();
    const readGate = deferred<void>();
    const realRead = r.persistence.read;
    r.persistence.read = async (k) => {
      await readGate.promise;
      return realRead(k);
    };
    const second = r.ctl.status(KEY());
    await tick();
    held.resolve();
    expect(await first).toMatchObject({ kind: "stale", action: "submit", dispatched: true });
    r.answer(async () => res(200, { ownerKey: OWNER, occurrenceId: "occ-1", state: "absent" }));
    readGate.resolve();
    expect(await second).toMatchObject({ kind: "answered", action: "status" });
    expect(r.sent().map((c) => c.init.method)).toEqual(["POST", "GET"]);
  });

  it("a store whose dispatch throws after the request started never relabels it refused", async () => {
    const r = await ready();
    r.answer(async () => {
      throw new TypeError("lost");
    });
    r.persistence.dispatch = async (_e, go) => {
      go();
      throw new Error("lock released badly");
    };
    expect(await r.ctl.submit(KEY())).toMatchObject({
      kind: "unconfirmed",
      dispatched: true,
      category: "network",
    });
    expect(r.sent()).toHaveLength(1);
  });

  it("a genuine typed refusal stays an answered typed refusal", async () => {
    const r = await ready();
    r.answer(async () => res(404, { error: "absent", ownerKey: OWNER, occurrenceId: "occ-1" }));
    const typed = is(await r.ctl.cancel(KEY()), "answered");
    expect(typed.parsed).toMatchObject({ outcome: "refused", error: "absent" });
    expect(typed.recorded).toBeNull();
    expect(r.persistence.observe).not.toHaveBeenCalled();
  });
});
