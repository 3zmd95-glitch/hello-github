import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowAction } from "@/lib/domain";
import {
  canonicalJson,
  sha256Hex,
  payloadDigestOf,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  FINISH_RETENTION_MS,
  isVerifiedReceipt,
  readyOccurrenceId,
  submitRequestOf,
  type Authority,
} from "./cloudWorkflowProtocol";
import { buildCloudSnapshot, type CloudSnapshotParams } from "./cloudWorkflowSnapshot";
import {
  createCloudWorkflowSession,
  RESPONSE_BYTES_MAX,
  type ClientFetch,
  type ClientRequestInit,
  type ExecuteResult,
  type SupportedRequest,
} from "./cloudWorkflowClient";

// ⚙️ DT-7C-2B-1 session over the REAL Worker router and SQLite coordinator, behind a fake in-memory transport (the
// same harness and computed dynamic import as cloudWorkflowProtocol.wire.test.ts: a static import would pull the
// Cloudflare-typed Worker into the app's tsc program). The global fetch throws; no socket is ever opened.

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
const NOW = new Date("2026-10-17T09:05:00.000Z");
const EARLY = new Date(NOW.getTime() - 10 * 60_000);
const AT = "2026-10-17T09:00:00.000Z";
const DIG = "e".repeat(64);
const enc = new TextEncoder();

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
interface Fake {
  db: DatabaseSync;
  down?: boolean;
  idFromName(name: string): string;
  get(id: string): { fetch(url: string, init: RequestInit): Promise<Response> };
}
function fakeNamespace(): Fake {
  const ns: Fake = {
    db: new DatabaseSync(":memory:"),
    idFromName: (name) => name,
    get: () => ({
      async fetch(url, init) {
        if (ns.down) throw new Error("storage down");
        const c = new WorkflowCoordinator({ storage: sqliteStorage(ns.db) } as never);
        return c.fetch(new Request(url, init));
      },
    }),
  };
  return ns;
}
const makeEnv = (): Env => ({
  SCOUT_TOKEN: TOKEN,
  ALLOWED_ORIGINS: APP,
  WORKFLOW_COORDINATOR: fakeNamespace(),
});

/** The fake transport: what a browser would send, routed in memory into the real Worker. Records every call. */
function transport(env: Env, clock: { now: Date }, hooks: { afterResponse?: () => void }) {
  const calls: { url: string; init: ClientRequestInit }[] = [];
  const fetchFn: ClientFetch = async (url, init) => {
    calls.push({ url, init });
    const headers = new Headers(init.headers);
    headers.set("Origin", APP); // the browser adds the Origin header; the client never sets it
    const res = await handle(
      new Request(url, {
        method: init.method,
        headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
      }),
      env,
      undefined,
      { now: () => clock.now },
    );
    hooks.afterResponse?.(); // the Worker has answered: from here on only the client's own work runs
    return res;
  };
  return { fetchFn, calls };
}

const t = (en: string, ar = "") => ({ ar, en });
const idea = (id: string): WorkflowAction =>
  ({ id, kind: "idea", text: t("Idea {date}", "فكرة {date}") }) as WorkflowAction;
const post = (id: string): WorkflowAction =>
  ({
    id,
    kind: "post",
    platform: "tiktok",
    title: t("post {date}"),
    caption: t("cap"),
    offsetDays: 1,
  }) as WorkflowAction;

async function snapshotBody(
  owner: string,
  id: string,
  actions: WorkflowAction[],
  workflowId = "w1",
) {
  const params = {
    ownerKey: owner,
    occurrenceId: id,
    registrationEpoch: 1,
    revision: 1,
    executionAt: AT,
    workflow: { id: workflowId, name: t("Flow", "سير"), trigger: { kind: "manual" }, actions },
    lang: "en",
  } as CloudSnapshotParams;
  const r = await buildCloudSnapshot(params);
  if (!r.ok) throw new Error(`snapshot refused: ${r.reason}`);
  return r.snapshot.body;
}
const kind = <K extends ExecuteResult["kind"]>(r: ExecuteResult, k: K) => {
  expect(r.kind).toBe(k);
  return r as Extract<ExecuteResult, { kind: K }>;
};

interface Rig {
  env: Env;
  clock: { now: Date };
  hooks: { afterResponse?: () => void };
  calls: { url: string; init: ClientRequestInit }[];
  session: ReturnType<typeof createCloudWorkflowSession>;
  authority: Authority;
  owner: string;
  exec: (r: SupportedRequest) => Promise<ExecuteResult>;
}
async function rig(): Promise<Rig> {
  const env = makeEnv();
  const clock = { now: EARLY };
  const hooks: { afterResponse?: () => void } = {};
  const { fetchFn, calls } = transport(env, clock, hooks);
  const session = createCloudWorkflowSession({ fetch: fetchFn });
  session.configure({ origin: BASE, token: TOKEN });
  const h = kind(await session.handshake(), "answer");
  if (h.parsed.outcome !== "ok" || h.parsed.kind !== "authority") throw new Error("handshake");
  const authority = h.parsed.authority;
  calls.length = 0;
  return {
    env,
    clock,
    hooks,
    calls,
    session,
    authority,
    owner: authority.ownerKey,
    exec: (r) => session.execute(r, authority),
  };
}
const reg = (owner: string, o: A = {}): SupportedRequest =>
  ({
    kind: "register",
    ownerKey: owner,
    workflowId: "w1",
    expectedEpoch: 0,
    revision: 1,
    workflowDigest: DIG,
    ...o,
  }) as SupportedRequest;
async function registered(): Promise<Rig> {
  const r = await rig();
  expect(kind(await r.exec(reg(r.owner)), "answer").parsed).toMatchObject({
    outcome: "ok",
    kind: "register",
    created: true,
  });
  r.clock.now = NOW;
  r.calls.length = 0;
  return r;
}

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

describe("a real session over the real router: every supported request, one fetch each", () => {
  it("handshake, register, update, pause, resume, unregister, submit, run, status (bound), cancel", async () => {
    const r = await registered();
    const o = r.owner;
    const A0: Authority = r.authority;
    const answer = async (req: SupportedRequest) => {
      const before = r.calls.length;
      const res = kind(await r.exec(req), "answer");
      expect(r.calls.length).toBe(before + 1);
      expect(res.parsed.outcome).toBe("ok");
      if (res.parsed.outcome === "ok") expect(res.parsed.authority).toEqual(A0); // complete Parsed.authority
      expect(res.meta).toMatchObject({ dispatched: true });
      return res.parsed as A;
    };
    // registration lifecycle on w2 (own epoch), then update of w1
    await answer(reg(o, { workflowId: "w2" }));
    r.clock.now = NOW;
    expect(
      await answer({
        kind: "update",
        ownerKey: o,
        workflowId: "w1",
        registrationEpoch: 1,
        expectedRevision: 1,
        revision: 2,
        workflowDigest: "f".repeat(64),
      }),
    ).toMatchObject({ kind: "update", changed: true });
    const ctl = (k: "pause" | "resume" | "unregister"): SupportedRequest => ({
      kind: k,
      ownerKey: o,
      workflowId: "w2",
      registrationEpoch: 1,
      expectedRevision: 1,
    });
    expect(await answer(ctl("pause"))).toMatchObject({ kind: "pause", changed: true });
    expect(await answer(ctl("resume"))).toMatchObject({ kind: "resume", changed: true });
    expect(await answer(ctl("unregister"))).toMatchObject({ kind: "unregister", changed: true });

    // submit -> run -> status bound to what we hold -> cancel another
    const body = await snapshotBody(o, "run1", [idea("a1"), post("s1")]);
    const sub = await submitRequestOf(body);
    if (!sub.ok) throw new Error("submit request");
    const submitted = await answer(sub.request as SupportedRequest);
    expect(submitted).toMatchObject({
      kind: "submit",
      created: true,
      receipt: { state: "pending", receiptVersion: 1 },
    });
    expect(isVerifiedReceipt(submitted.receipt)).toBe(true);
    const ran = await answer({ kind: "run", ownerKey: o, occurrenceId: "run1" });
    expect(ran).toMatchObject({ kind: "run", stopped: "terminal", receipt: { state: "done" } });
    const outputIds = ran.receipt.outputs.map((x: A) => x.outputId);
    const stat = await answer({
      kind: "status",
      ownerKey: o,
      occurrenceId: "run1",
      expect: {
        body,
        payloadDigest: ran.receipt.payloadDigest,
        receiptVersion: ran.receipt.receiptVersion,
        outputIds,
      },
    });
    expect(stat.result).toMatchObject({ found: "row", receipt: { state: "done" } });
    const pend = await snapshotBody(o, "canc1", [idea("a1")]);
    const sub2 = await submitRequestOf(pend);
    if (!sub2.ok) throw new Error("submit request");
    await answer(sub2.request as SupportedRequest);
    expect(await answer({ kind: "cancel", ownerKey: o, occurrenceId: "canc1" })).toMatchObject({
      kind: "cancel",
      cancelled: true,
    });

    // every request carried the bearer, only to the captured origin and a fixed workflow path
    for (const c of r.calls) {
      expect(c.init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.init).toMatchObject({ credentials: "omit", cache: "no-store", redirect: "manual" });
      expect(c.url.startsWith(`${BASE}/social/workflows/`)).toBe(true);
    }
  });

  it("typed refusals from the real router come back as answers, unchanged, with dispatch metadata", async () => {
    const r = await registered();
    const sub = await submitRequestOf(
      await snapshotBody(r.owner, "pend", [idea("a1"), idea("a2")]),
    );
    if (!sub.ok) throw new Error("submit");
    expect(kind(await r.exec(sub.request as SupportedRequest), "answer").parsed).toMatchObject({
      outcome: "ok",
      created: true,
    });
    const clash = await submitRequestOf(
      await snapshotBody(r.owner, "pend", [idea("a1"), idea("a9")]),
    );
    if (!clash.ok) throw new Error("submit");
    const c = kind(await r.exec(clash.request as SupportedRequest), "answer");
    expect(c.parsed).toMatchObject({
      outcome: "refused",
      error: "conflict",
      status: 409,
      fields: { occurrenceId: "pend" },
    });
    expect(c.meta).toMatchObject({ dispatched: true, mutating: true, status: 409 });
    expect(JSON.stringify(c)).not.toMatch(/retry|safe/i);
    const absent = kind(
      await r.exec({ kind: "run", ownerKey: r.owner, occurrenceId: "never" }),
      "answer",
    );
    expect(absent.parsed).toMatchObject({ outcome: "refused", error: "absent", status: 404 });
    const none = kind(
      await r.exec({ kind: "status", ownerKey: r.owner, occurrenceId: "zz" }),
      "answer",
    );
    expect(none.parsed).toMatchObject({
      outcome: "ok",
      kind: "status",
      result: { found: "absent" },
    });
  });

  it("a wrong-owner or foreign-origin request never reaches the router (zero fetch)", async () => {
    const r = await registered();
    const sub = await submitRequestOf(
      await snapshotBody("wfo_" + "3".repeat(32), "x1", [idea("a1")]),
    );
    if (!sub.ok) throw new Error("submit");
    expect(kind(await r.exec(sub.request as SupportedRequest), "refused").reason).toBe(
      "owner_mismatch",
    );
    expect(
      kind(
        await r.exec({ kind: "run", ownerKey: "wfo_" + "3".repeat(32), occurrenceId: "done" }),
        "refused",
      ).reason,
    ).toBe("owner_mismatch");
    const foreign: Authority = { origin: "https://other.test", ownerKey: r.owner };
    expect(kind(await r.session.execute(reg(r.owner), foreign), "refused").reason).toBe(
      "foreign_origin",
    );
    expect(r.calls).toHaveLength(0);
  });

  it("receipt_unavailable after a POST (real 503 from a down coordinator) is uncertain, with the typed refusal kept", async () => {
    const r = await registered();
    const sub = await submitRequestOf(await snapshotBody(r.owner, "done", [idea("a1")]));
    if (!sub.ok) throw new Error("submit");
    kind(await r.exec(sub.request as SupportedRequest), "answer");
    (r.env.WORKFLOW_COORDINATOR as Fake).down = true;
    const u = kind(
      await r.exec({ kind: "run", ownerKey: r.owner, occurrenceId: "done" }),
      "uncertain",
    );
    expect(u.category).toBe("receipt_unavailable");
    expect(u.parsed).toMatchObject({
      outcome: "refused",
      error: "receipt_unavailable",
      status: 503,
    });
    expect(u.authority).toEqual(r.authority);
    expect(u.meta).toMatchObject({ dispatched: true, mutating: true });
    expect(r.calls).toHaveLength(2); // never retried
  });

  it("a real receipt whose digest is not the one the caller holds is uncertain (foreign proof), not an answer", async () => {
    const r = await registered();
    const sub = await submitRequestOf(await snapshotBody(r.owner, "p1", [idea("a1")]));
    if (!sub.ok) throw new Error("submit");
    kind(await r.exec(sub.request as SupportedRequest), "answer");
    const u = kind(
      await r.exec({
        kind: "status",
        ownerKey: r.owner,
        occurrenceId: "p1",
        expect: { payloadDigest: "d".repeat(64) },
      }),
      "uncertain",
    );
    expect(u.category).toBe("invalid_answer");
    expect(u.meta.invalid).toBe("binding");
  });
});

describe("fences hold while the real parser verifies digests", () => {
  async function submitted() {
    const r = await registered();
    const body = await snapshotBody(r.owner, "p1", [idea("a1"), idea("a2")]);
    const sub = await submitRequestOf(body);
    if (!sub.ok) throw new Error("submit");
    kind(await r.exec(sub.request as SupportedRequest), "answer");
    r.calls.length = 0;
    return { r, body };
  }
  const statusFor = (r: Rig, expectBody?: unknown): SupportedRequest =>
    ({
      kind: "status",
      ownerKey: r.owner,
      occurrenceId: "p1",
      ...(expectBody ? { expect: { body: expectBody } } : {}),
    }) as SupportedRequest;

  it.each([
    ["visit invalidation", (r: Rig) => r.session.invalidateVisit()],
    [
      "origin A->B->A",
      (r: Rig) => {
        r.session.configure({ origin: "https://other.test", token: TOKEN });
        r.session.configure({ origin: BASE, token: TOKEN });
      },
    ],
    [
      "token A->B->A",
      (r: Rig) => {
        r.session.configure({ origin: BASE, token: "other-token" });
        r.session.configure({ origin: BASE, token: TOKEN });
      },
    ],
    ["dispose", (r: Rig) => r.session.dispose()],
  ])(
    "%s during the parser's digest check makes a verified receipt stale, never an answer",
    async (_n, flip) => {
      const { r, body } = await submitted();
      const real = crypto.subtle.digest.bind(crypto.subtle);
      let armed = false;
      let entered = false;
      r.hooks.afterResponse = () => {
        armed = true;
      };
      vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (...a: Parameters<typeof real>) => {
          if (armed && !entered) {
            entered = true;
            flip(r);
          }
          return real(...a);
        },
      );
      const res = kind(await r.exec(statusFor(r, body)), "stale");
      expect(entered).toBe(true); // the PARSER's digest check was really entered (the Worker had already answered)
      expect(res.dispatched).toBe(true);
      expect(res.authority).toEqual(r.authority);
      expect(res.binding.request).toMatchObject({ kind: "status", occurrenceId: "p1" });
      expect(r.calls).toHaveLength(1);
    },
  );

  it("editing the held expectation during the digest check changes neither the verdict nor the binding", async () => {
    const { r, body } = await submitted();
    const expectBody = JSON.parse(JSON.stringify(body)) as A;
    const req = statusFor(r, expectBody) as A;
    const real = crypto.subtle.digest.bind(crypto.subtle);
    let armed = false;
    let once = true;
    r.hooks.afterResponse = () => {
      armed = true;
    };
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...a: Parameters<typeof real>) => {
      if (armed && once) {
        once = false;
        expectBody.snapshot.actions[0].id = "tampered";
        req.expect.body = undefined;
        req.ownerKey = "wfo_" + "9".repeat(32);
      }
      return real(...a);
    });
    const res = kind(await r.exec(req as SupportedRequest), "answer");
    expect(res.parsed).toMatchObject({ outcome: "ok", kind: "status", result: { found: "row" } });
    expect((res.binding.request as A).expect.body.snapshot.actions[0].id).toBe("a1");
    expect((res.binding.request as A).ownerKey).toBe(r.owner);
    expect(once).toBe(false);
  });
});

/* ---------- limits: the largest supported request and the largest supported full receipt ---------- */

const control = (n: number) => "\u0001".repeat(n); // 6 JSON bytes per UTF-16 unit: the costliest text the validators admit

describe("size limits against real validators", () => {
  it("the largest admissible request (16 KiB body of 3-byte UTF-8 text) is sent whole, under 32 KiB, and the real router accepts it", async () => {
    const r = await registered();
    const id = (await readyOccurrenceId("w1", "art1", "commit-max"))!;
    const mk = (n: number, slug = "s"): OccurrenceBody =>
      ({
        occurrenceId: id,
        ownerKey: r.owner,
        workflowId: "w1",
        kind: "article-ready",
        registrationEpoch: 1,
        revision: 1,
        snapshot: {
          name: t("Flow", "سير"),
          trigger: { kind: "article-ready" },
          actions: [{ id: "a1", kind: "idea", text: t("{title}", "{title}") }],
        },
        plannerContext: null,
        input: {
          articleId: "art1",
          title: t("字".repeat(n), "字".repeat(n)),
          summary: t("字".repeat(n), "字".repeat(n)),
          slug,
          lang: "en",
          day: "2026-10-17",
        },
        executionAt: AT,
      }) as unknown as OccurrenceBody;
    let n = 1;
    while (enc.encode(canonicalJson(mk(n + 1))).length <= 16_384 && n < 2000) n++;
    const gap = 16_384 - enc.encode(canonicalJson(mk(n))).length;
    const body = mk(n, "s" + "x".repeat(gap)); // exactly BODY_BYTES_MAX canonical bytes
    const bodyBytes = enc.encode(canonicalJson(body)).length;
    expect(bodyBytes).toBeLessThanOrEqual(16_384);
    expect(bodyBytes).toBe(16_384);
    const sub = await submitRequestOf(body);
    if (!sub.ok) throw new Error("submit request");
    const res = kind(await r.exec(sub.request as SupportedRequest), "answer");
    expect(res.parsed).toMatchObject({ outcome: "ok", kind: "submit", created: true });
    const sent = r.calls[0].init.body!;
    expect(sent.length).toBeLessThan(enc.encode(sent).length); // UTF-8 bytes, not UTF-16 units
    expect(enc.encode(sent).length).toBeLessThanOrEqual(32_768);
    expect(enc.encode(sent).length).toBeGreaterThan(16_384);
  });

  /** A complete DONE receipt of the largest shape the pinned validators admit, as the Worker's `run` answer. */
  async function maximalRunAnswer(owner: string) {
    const occ = (await readyOccurrenceId("w1", "art1", "commit-full"))!;
    const actions = ["a1", "a2", "a3", "a4", "a5"].map((id) => ({
      id,
      kind: "post",
      platform: "tiktok",
      title: t("p"),
      caption: t("c"),
      offsetDays: 1,
    }));
    const bodyWith = (units: number, slug = "s"): OccurrenceBody =>
      ({
        occurrenceId: occ,
        ownerKey: owner,
        workflowId: "w1",
        kind: "article-ready",
        registrationEpoch: 1,
        revision: 1,
        snapshot: { name: t("Flow", "سير"), trigger: { kind: "article-ready" }, actions },
        plannerContext: null,
        input: {
          articleId: "art1",
          title: t(
            control(Math.min(units, 2000)),
            control(Math.min(Math.max(units - 2000, 0), 2000)),
          ),
          summary: t(
            control(Math.min(Math.max(units - 4000, 0), 2000)),
            control(Math.min(Math.max(units - 6000, 0), 2000)),
          ),
          slug,
          lang: "en",
          day: "2026-10-17",
        },
        executionAt: AT,
      }) as unknown as OccurrenceBody;
    // Pad the body to EXACTLY BODY_BYTES_MAX canonical bytes: 6-byte control characters, then ASCII for the remainder.
    const rem = 16_384 - enc.encode(canonicalJson(bodyWith(0))).length;
    const body = bodyWith(Math.floor(rem / 6), "s" + "x".repeat(rem % 6));
    expect(enc.encode(canonicalJson(body)).length).toBe(16_384);
    const created = "2026-10-17T09:05:00.000Z";
    const finished = "2026-10-17T09:06:00.000Z";
    const steps: A[] = [];
    const outputs: A[] = [];
    for (const [idx, a] of actions.entries()) {
      const outputId = `wf:${occ}:${a.id}`;
      const record = {
        id: outputId,
        platform: "tiktok",
        title: control(4000),
        caption: control(4000),
        hashtags: Array.from({ length: 30 }, () => control(100)),
        stage: "idea",
        plannedDay: null,
        plannedTime: null,
        script: { hook: "", beats: ["", "", ""], cta: "" },
        shots: [],
        createdAt: AT,
        updatedAt: AT,
      };
      const digest = await sha256Hex(canonicalJson(record));
      steps.push({
        idx,
        actionId: a.id,
        kind: "post",
        status: "done",
        outputId,
        outputDigest: digest,
        at: finished,
      });
      outputs.push({ outputId, actionId: a.id, kind: "post", digest, record });
    }
    const receipt = {
      occurrenceId: occ,
      workflowId: "w1",
      kind: "article-ready",
      registrationEpoch: 1,
      revision: 1,
      body,
      payloadDigest: await payloadDigestOf(body),
      state: "done",
      receiptVersion: 7, // five done steps + 2
      changeSeq: 7,
      createdAt: created,
      updatedAt: finished,
      ackedVersion: 0,
      startedAt: created,
      finishedAt: finished,
      purgeAt: new Date(Date.parse(finished) + FINISH_RETENTION_MS).toISOString(),
      steps,
      outputs,
    };
    return {
      occ,
      wire: { ownerKey: owner, occurrence: receipt, committed: 5, stopped: "terminal" },
    };
  }

  it("a maximal supported full receipt (16 KiB body, five costliest post outputs) fits RESPONSE_BYTES_MAX and is verified", async () => {
    const r = await rig();
    const { occ, wire } = await maximalRunAnswer(r.owner);
    const text = JSON.stringify(wire);
    const size = enc.encode(text).length;
    // Worst case by construction: body at BODY_BYTES_MAX; per output, title+caption 4000 units each and 30 hashtags of
    // 100 units, every unit a 6-byte JSON escape (isText admits control characters; astral pairs cost only 2 bytes/unit).
    const bound = 16_384 + 5 * (2 * 4000 * 6 + 30 * (100 * 6 + 3) + 1_200) + 5 * 400 + 2_000;
    expect(size).toBeLessThanOrEqual(bound);
    expect(size).toBeLessThan(RESPONSE_BYTES_MAX / 2); // about a third of the cap: real headroom, not a coincidence
    expect(bound).toBeLessThan(RESPONSE_BYTES_MAX);
    // and the whole thing really crosses the client: stream -> bounded read -> real parser -> verified receipt
    const calls: ClientRequestInit[] = [];
    const session = createCloudWorkflowSession({
      fetch: async (_u, init) => {
        calls.push(init);
        return init.method === "GET"
          ? new Response(JSON.stringify({ ownerKey: r.owner }), { status: 200 })
          : new Response(text, { status: 200 });
      },
    });
    session.configure({ origin: BASE, token: TOKEN });
    await session.handshake();
    const out = await session.execute(
      { kind: "run", ownerKey: r.owner, occurrenceId: occ },
      r.authority,
    );
    const res = kind(out, "answer");
    expect(res.parsed).toMatchObject({
      outcome: "ok",
      kind: "run",
      committed: 5,
      stopped: "terminal",
    });
    if (res.parsed.outcome === "ok" && res.parsed.kind === "run") {
      expect(isVerifiedReceipt(res.parsed.receipt)).toBe(true);
      expect(res.parsed.receipt.outputs).toHaveLength(5);
    }
    expect(size).toBeGreaterThan(300_000); // the fixture really is maximal, not a toy
  });
});
