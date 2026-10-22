import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { handle, type Env } from "../scout";
import { drainOne, WORKFLOW_OBJECT, WorkflowCoordinator } from "./workflowCoordinator";
import { canonicalJson, REQUEST_BYTES_MAX, sha256Hex, weekOf } from "./workflowProtocol";

// ⚙️ DT-7B workflow routes (planning/tools/38-cloud-workflows.md) through the REAL router (scout.ts bearer + origin,
// routes.ts dispatch) over a coordinator on node:sqlite. The fake namespace records every name and call: the object
// is always the fixed server-selected WORKFLOW_OBJECT, and refusals before the coordinator make zero calls.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TOKEN = "route-scout-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://scout.test";
const NOW = new Date("2026-10-17T09:05:00.000Z");
const AT = "2026-10-17T09:00:00.000Z";
const DIG = "e".repeat(64);

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

interface Fake {
  db: DatabaseSync;
  names: string[];
  calls: A[];
  tamper?: (call: A, answer: A) => unknown;
  down?: boolean;
  idFromName(name: string): string;
  get(id: string): { fetch(url: string, init: RequestInit): Promise<Response> };
}

function fakeNamespace(): Fake {
  const ns: Fake = {
    db: new DatabaseSync(":memory:"),
    names: [],
    calls: [],
    idFromName(name) {
      ns.names.push(name);
      return name;
    },
    get: () => ({
      async fetch(url, init) {
        const call = JSON.parse(String(init.body)) as A;
        ns.calls.push(call);
        if (ns.down) throw new Error("storage down");
        const c = new WorkflowCoordinator({ storage: sqliteStorage(ns.db) } as never);
        const res = await c.fetch(new Request(url, init));
        if (!ns.tamper) return res;
        return Response.json(ns.tamper(call, (await res.json()) as A));
      },
    }),
  };
  return ns;
}

const makeEnv = (ns: Fake | null = fakeNamespace()): Env => ({
  SCOUT_TOKEN: TOKEN,
  ALLOWED_ORIGINS: APP,
  ...(ns ? { WORKFLOW_COORDINATOR: ns as unknown as DurableObjectNamespace } : {}),
});
const nsOf = (env: Env) => env.WORKFLOW_COORDINATOR as unknown as Fake;

function req(
  path: string,
  init: RequestInit & { auth?: string | null; origin?: string | null } = {},
) {
  const { auth = TOKEN, origin = APP, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth !== null) headers.set("Authorization", `Bearer ${auth}`);
  if (origin !== null) headers.set("Origin", origin);
  return new Request(`${BASE}${path}`, { ...rest, headers });
}
const run = async (env: Env, path: string, init: Parameters<typeof req>[1] = {}, now = NOW) => {
  const res = await handle(req(path, init), env, undefined, { now: () => now });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as A, raw: text };
};
const post = (
  env: Env,
  path: string,
  json: unknown,
  init: Parameters<typeof req>[1] = {},
  now = NOW,
) => run(env, path, { method: "POST", body: JSON.stringify(json), ...init }, now);

function body(owner: string, o: { id?: string; actions?: A[] } = {}): A {
  const actions = o.actions ?? [{ id: "a1", kind: "idea", text: { ar: "", en: "idea" } }];
  return {
    occurrenceId: o.id ?? "m1",
    ownerKey: owner,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: { name: { ar: "", en: "Flow" }, trigger: { kind: "manual" }, actions },
    plannerContext: actions.some((a) => a.kind === "plan")
      ? {
          targetWeek: weekOf("2026-10-17"),
          completions: [],
          planItems: [],
          settings: { gear: [], davinciEdition: "free" },
          contextAt: AT,
        }
      : null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt: AT,
  };
}
const envelope = async (b: A) => ({ body: b, payloadDigest: await sha256Hex(canonicalJson(b)) });

async function ready(env = makeEnv()) {
  const owner = (await run(env, "/social/workflows/authority")).body.ownerKey as string;
  const r = await post(
    env,
    "/social/workflows/registrations",
    {
      ownerKey: owner,
      workflowId: "w1",
      expectedEpoch: 0,
      revision: 1,
      workflowDigest: DIG,
    },
    {},
    // DT-7B-R1 fixture correction (chronology): was the default NOW (09:05), after the 09:00 executionAt (AT) of
    // every body here; now 08:55, so register → trigger is real. Assertions unchanged.
    new Date("2026-10-17T08:55:00.000Z"),
  );
  expect(r.status).toBe(200);
  return { env, owner };
}

const builder = ({ body: b, action }: A) => ({
  record: {
    id: `wf:${b.occurrenceId}:${action.id}`,
    text: "idea",
    source: "workflow",
    createdAt: b.executionAt,
  },
});
/** The test-only executor straight on the coordinator (no route exists for it). */
const drain = async (env: Env, owner: string, id: string): Promise<A> => {
  const ns = nsOf(env);
  const stub = ns.get(ns.idFromName(WORKFLOW_OBJECT));
  return drainOne(
    async (c) =>
      (await (
        await stub.fetch("https://c/", { method: "POST", body: JSON.stringify(c) })
      ).json()) as A,
    owner,
    id,
    builder as never,
    () => NOW.getTime(),
  );
};
const count = (env: Env, q: string) => (nsOf(env).db.prepare(q).get() as A).n as number;

describe("bearer, origin and wiring", () => {
  it("no bearer, a wrong bearer or a foreign origin: refused before the coordinator, zero mutation", async () => {
    const { env, owner } = await ready();
    const before = nsOf(env).calls.length;
    const sub = await envelope(body(owner));
    for (const init of [{ auth: null }, { auth: "wrong" }, { origin: "https://evil.example" }]) {
      const r = await post(env, "/social/workflows/occurrences", sub, init);
      expect([401, 403]).toContain(r.status);
      expect(r.raw).not.toContain(owner);
      expect(
        (await run(env, `/social/workflows/changes?ownerKey=${owner}&after=0`, init)).status,
      ).not.toBe(200);
    }
    expect(nsOf(env).calls.length).toBe(before);
    expect(count(env, "SELECT COUNT(*) AS n FROM occurrences")).toBe(0);
  });

  it("the object is always the fixed server name, whatever ownerKey the caller sends", async () => {
    const { env, owner } = await ready();
    await run(env, `/social/workflows/occurrences/m1?ownerKey=${"wfo_" + "1".repeat(32)}`);
    await run(env, `/social/workflows/occurrences/m1?ownerKey=${owner}`);
    expect(new Set(nsOf(env).names)).toEqual(new Set([WORKFLOW_OBJECT]));
  });

  it("no binding → 503 not_configured; a transport failure → 503 receipt_unavailable", async () => {
    const off = makeEnv(null);
    expect(await run(off, "/social/workflows/authority")).toMatchObject({
      status: 503,
      body: { error: "not_configured", detail: "workflow-store" },
    });
    const { env, owner } = await ready();
    nsOf(env).down = true;
    expect(await run(env, `/social/workflows/occurrences/m1?ownerKey=${owner}`)).toMatchObject({
      status: 503,
      body: { error: "receipt_unavailable" },
    });
  });

  // DT-7B-2: `run` (its own describe below) executes with the fixed server builder; nothing commits a caller's step.
  it("no public route commits a caller step/finish or selects a builder; unknown paths are not ours", async () => {
    const { env, owner } = await ready();
    await post(env, "/social/workflows/occurrences", await envelope(body(owner)));
    const calls = nsOf(env).calls.length;
    for (const p of [
      "/social/workflows/occurrences/m1/step",
      "/social/workflows/occurrences/m1/finish",
      "/social/workflows/run",
      "/social/workflows/occurrences/m1/commitStep",
    ])
      expect((await post(env, p, { ownerKey: owner, output: { record: {} } })).status).toBe(404);
    expect(nsOf(env).calls.length).toBe(calls);
    // A builder/output in the submit envelope or a test header changes nothing.
    const sub = await envelope(body(owner, { id: "m2" }));
    expect(
      (await post(env, "/social/workflows/occurrences", { ...sub, builder: "test" })).status,
    ).toBe(400);
    const h = await post(env, "/social/workflows/occurrences", sub, {
      headers: { "X-Test-Builder": "1" },
    });
    expect(h.body.occurrence.state).toBe("pending");
    expect(nsOf(env).calls.some((c) => c.op === "commitStep" || c.op === "finish")).toBe(false);
  });

  it("wrong methods → 405; PUT is not used (CORS allows GET, POST, DELETE)", async () => {
    const env = makeEnv();
    expect((await post(env, "/social/workflows/authority", {})).status).toBe(405);
    expect((await run(env, "/social/workflows/occurrences")).status).toBe(405);
    expect(
      (await run(env, "/social/workflows/registrations/w1", { method: "PUT", body: "{}" })).status,
    ).toBe(405);
  });
});

describe("strict requests", () => {
  it("submit: 201 then 200 created:false; a changed body 409; asserted digest of other content 400", async () => {
    const { env, owner } = await ready();
    const b = body(owner);
    const r1 = await post(env, "/social/workflows/occurrences", await envelope(b));
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({
      ownerKey: owner,
      created: true,
      occurrence: { occurrenceId: "m1", state: "pending" },
    });
    expect(r1.body.occurrence.body).toEqual(b);
    const r2 = await post(env, "/social/workflows/occurrences", await envelope(b));
    expect(r2).toMatchObject({ status: 200, body: { created: false } });
    const changed = body(owner, {
      actions: [{ id: "a9", kind: "idea", text: { ar: "", en: "x" } }],
    });
    expect(await post(env, "/social/workflows/occurrences", await envelope(changed))).toMatchObject(
      {
        status: 409,
        body: { error: "conflict", ownerKey: owner, occurrenceId: "m1" },
      },
    );
    const lie = {
      body: body(owner, { id: "m3" }),
      payloadDigest: (await envelope(b)).payloadDigest,
    };
    expect(await post(env, "/social/workflows/occurrences", lie)).toMatchObject({
      status: 400,
      body: { error: "digest_mismatch" },
    });
  });

  it("malformed, unknown fields, unsupported ids, another authority, oversized streams", async () => {
    const { env, owner } = await ready();
    const sub = await envelope(body(owner));
    const calls = nsOf(env).calls.length;
    expect(
      (await run(env, "/social/workflows/occurrences", { method: "POST", body: "{nope" })).body,
    ).toEqual({ error: "bad_request" });
    expect((await post(env, "/social/workflows/occurrences", [sub])).body).toEqual({
      error: "bad_request",
    });
    expect((await post(env, "/social/workflows/occurrences", { body: sub.body })).body).toEqual({
      error: "bad_request",
    });
    // Over the 32 KiB streaming budget: 413 before the coordinator.
    const huge = JSON.stringify({ ...sub, pad: "x".repeat(REQUEST_BYTES_MAX) });
    expect(
      await run(env, "/social/workflows/occurrences", { method: "POST", body: huge }),
    ).toMatchObject({ status: 413, body: { error: "too_large" } });
    expect(nsOf(env).calls.length).toBe(calls);
    // The coordinator's own checks.
    expect(
      (await post(env, "/social/workflows/occurrences", await envelope(body(owner, { id: "m:1" }))))
        .body,
    ).toEqual({ error: "unsupported_id" });
    const canary = { ...body(owner, { id: "m4" }), articles: [{ body: "PRIVATE-ARTICLE" }] };
    const c = await post(env, "/social/workflows/occurrences", await envelope(canary));
    expect(c).toMatchObject({ status: 400, body: { error: "bad_request" } });
    expect(c.raw).not.toContain("PRIVATE-ARTICLE");
    const foreign = await envelope(body("wfo_" + "2".repeat(32), { id: "m5" }));
    expect(await post(env, "/social/workflows/occurrences", foreign)).toMatchObject({
      status: 409,
      body: { error: "authority_mismatch" },
    });
    expect(JSON.stringify(nsOf(env).db.prepare("SELECT * FROM occurrences").all())).not.toContain(
      "PRIVATE-ARTICLE",
    );
    // Path ids and queries.
    expect((await run(env, `/social/workflows/occurrences/a:b?ownerKey=${owner}`)).body).toEqual({
      error: "unsupported_id",
    });
    expect((await run(env, `/social/workflows/occurrences/m1?ownerKey=${owner}&x=1`)).body).toEqual(
      { error: "bad_request" },
    );
    expect(
      (await run(env, `/social/workflows/occurrences/m1?ownerKey=${owner}&ownerKey=${owner}`)).body,
    ).toEqual({ error: "bad_request" });
    expect((await run(env, "/social/workflows/occurrences/m1")).body).toEqual({
      error: "bad_request",
    });
    expect(
      (await run(env, `/social/workflows/changes?ownerKey=${owner}&after=0&limit=51`)).body,
    ).toEqual({ error: "bad_request" });
    expect((await run(env, `/social/workflows/changes?ownerKey=${owner}&after=-1`)).body).toEqual({
      error: "bad_request",
    });
  });

  it("registrations: update by POST with epoch+revision CAS, pause/resume/unregister, typed conflicts", async () => {
    const { env, owner } = await ready();
    const up = {
      ownerKey: owner,
      registrationEpoch: 1,
      expectedRevision: 1,
      revision: 2,
      workflowDigest: DIG,
    };
    expect(await post(env, "/social/workflows/registrations/w1", up)).toMatchObject({
      status: 200,
      body: { ownerKey: owner, changed: true, registration: { workflowId: "w1", revision: 2 } },
    });
    expect(
      await post(env, "/social/workflows/registrations/w1", {
        ...up,
        expectedRevision: 0,
        revision: 3,
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "conflict", ownerKey: owner, registration: { revision: 2 } },
    });
    expect(
      await post(env, "/social/workflows/registrations/w1/pause", {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 2,
      }),
    ).toMatchObject({ status: 200, body: { registration: { paused: true } } });
    expect(
      await post(env, "/social/workflows/registrations/w9/resume", {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 2,
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "not_registered", ownerKey: owner, workflowId: "w9" },
    });
    expect(
      (
        await post(env, "/social/workflows/registrations/w1/pause", {
          ownerKey: owner,
          registrationEpoch: 1,
          expectedRevision: 2,
          extra: 1,
        })
      ).body,
    ).toEqual({ error: "bad_request" });
    expect(
      (
        await post(env, "/social/workflows/registrations", {
          ownerKey: owner,
          workflowId: "w:1",
          expectedEpoch: 0,
          revision: 1,
          workflowDigest: DIG,
        })
      ).body,
    ).toEqual({ error: "unsupported_id" });
  });
});

describe("status, feed, cancel, ack", () => {
  it("status: full row with the immutable body and executionAt, absent and pruned are distinct and authority-bound", async () => {
    const { env, owner } = await ready();
    const b = body(owner);
    await post(env, "/social/workflows/occurrences", await envelope(b));
    const s = await run(env, `/social/workflows/occurrences/m1?ownerKey=${owner}`);
    expect(s.status).toBe(200);
    expect(s.body.ownerKey).toBe(owner);
    expect(s.body.occurrence).toMatchObject({
      occurrenceId: "m1",
      body: { executionAt: AT },
      receiptVersion: 1,
      payloadDigest: (await envelope(b)).payloadDigest,
    });
    expect((await run(env, `/social/workflows/occurrences/zz?ownerKey=${owner}`)).body).toEqual({
      ownerKey: owner,
      occurrenceId: "zz",
      state: "absent",
    });
    nsOf(env).db.exec(`INSERT INTO tombstones VALUES ('old', '${"a".repeat(64)}', 0)`);
    expect((await run(env, `/social/workflows/occurrences/old?ownerKey=${owner}`)).body).toEqual({
      ownerKey: owner,
      occurrenceId: "old",
      state: "pruned",
      payloadDigest: "a".repeat(64),
      prunedAt: new Date(0).toISOString(),
    });
    expect(
      await run(env, `/social/workflows/occurrences/m1?ownerKey=${"wfo_" + "3".repeat(32)}`),
    ).toMatchObject({ status: 409, body: { error: "authority_mismatch" } });
  });

  it("feed pages via the route; cancel pending / running; ack exact, future, nonterminal, absent, pruned", async () => {
    const { env, owner } = await ready();
    for (const id of ["m1", "m2", "m3"])
      await post(env, "/social/workflows/occurrences", await envelope(body(owner, { id })));
    const p1 = await run(env, `/social/workflows/changes?ownerKey=${owner}&after=0&limit=2`);
    expect(p1.body).toMatchObject({ ownerKey: owner, nextAfter: 2, more: true });
    expect(p1.body.items.map((i: A) => i.occurrenceId)).toEqual(["m1", "m2"]);
    const p2 = await run(env, `/social/workflows/changes?ownerKey=${owner}&after=2`);
    expect(p2.body).toMatchObject({ nextAfter: 3, more: false });
    expect(
      await post(env, "/social/workflows/occurrences/m3/cancel", { ownerKey: owner }),
    ).toMatchObject({ status: 200, body: { cancelled: true, occurrence: { state: "cancelled" } } });
    expect(
      await post(env, "/social/workflows/occurrences/m1/ack", {
        ownerKey: owner,
        receiptVersion: 1,
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "not_terminal", ownerKey: owner, occurrenceId: "m1", state: "pending" },
    });
    const done = await drain(env, owner, "m1");
    const v = done.occurrence.receiptVersion;
    expect(
      await post(env, "/social/workflows/occurrences/m1/ack", {
        ownerKey: owner,
        receiptVersion: v + 1,
      }),
    ).toMatchObject({ status: 409, body: { error: "future_version", receiptVersion: v } });
    const a = await post(env, "/social/workflows/occurrences/m1/ack", {
      ownerKey: owner,
      receiptVersion: v,
    });
    expect(a).toMatchObject({
      status: 200,
      body: {
        ownerKey: owner,
        occurrenceId: "m1",
        acknowledged: true,
        ackedVersion: v,
        firstAckAt: NOW.toISOString(),
      },
    });
    expect(
      await post(env, "/social/workflows/occurrences/zz/ack", {
        ownerKey: owner,
        receiptVersion: 1,
      }),
    ).toMatchObject({
      status: 404,
      body: { error: "absent", ownerKey: owner, occurrenceId: "zz" },
    });
    nsOf(env).db.exec(`INSERT INTO tombstones VALUES ('old', '${"a".repeat(64)}', 0)`);
    expect(
      await post(env, "/social/workflows/occurrences/old/ack", {
        ownerKey: owner,
        receiptVersion: 1,
      }),
    ).toMatchObject({ status: 410, body: { error: "pruned", occurrenceId: "old" } });
    // Running → 409 running.
    await post(
      env,
      "/social/workflows/occurrences",
      await envelope(
        body(owner, {
          id: "m4",
          actions: [
            { id: "a1", kind: "idea", text: { ar: "", en: "x" } },
            { id: "a2", kind: "idea", text: { ar: "", en: "y" } },
          ],
        }),
      ),
    );
    const ns = nsOf(env);
    const st = (await run(env, `/social/workflows/occurrences/m4?ownerKey=${owner}`)).body
      .occurrence;
    await ns.get(ns.idFromName(WORKFLOW_OBJECT)).fetch("https://c/", {
      method: "POST",
      body: JSON.stringify({
        op: "commitStep",
        ownerKey: owner,
        occurrenceId: "m4",
        idx: 0,
        receiptVersion: 1,
        payloadDigest: st.payloadDigest,
        output: builder({ body: st.body, action: st.body.snapshot.actions[0] }),
        now: NOW.getTime(),
      }),
    });
    expect(
      await post(env, "/social/workflows/occurrences/m4/cancel", { ownerKey: owner }),
    ).toMatchObject({ status: 409, body: { error: "running", occurrenceId: "m4" } });
  });
});

describe("strict typed answers (mixed envelopes and foreign proof refused)", () => {
  it("a coordinator answer mixing error and proof, another ownerKey or another occurrence → 503", async () => {
    const { env, owner } = await ready();
    await post(env, "/social/workflows/occurrences", await envelope(body(owner)));
    const ns = nsOf(env);
    const status = () => run(env, `/social/workflows/occurrences/m1?ownerKey=${owner}`);
    for (const tamper of [
      (_c: A, a: A) => ({ ...a, error: "conflict" }),
      (_c: A, a: A) => ({ ...a, ownerKey: "wfo_" + "4".repeat(32) }),
      (_c: A, a: A) => ({ ...a, occurrence: { ...a.occurrence, occurrenceId: "m2" } }),
      (_c: A, a: A) => ({ ...a, occurrence: { ...a.occurrence, receiptVersion: 0 } }),
      (_c: A, a: A) => ({ ...a, occurrence: { ...a.occurrence, extra: true } }),
      (_c: A, a: A) => ({
        ...a,
        occurrence: {
          ...a.occurrence,
          body: { ...a.occurrence.body, ownerKey: "wfo_" + "5".repeat(32) },
        },
      }),
      () => ({ error: "conflict", occurrence: {} }),
      () => ({ error: "teapot" }),
      () => [],
    ]) {
      ns.tamper = tamper;
      expect(await status()).toMatchObject({ status: 503, body: { error: "receipt_unavailable" } });
    }
    ns.tamper = (_c, a) => ({ ...a, items: [{ occurrenceId: "m1" }] });
    expect((await run(env, `/social/workflows/changes?ownerKey=${owner}&after=0`)).status).toBe(
      503,
    );
    ns.tamper = (_c, a) => ({ ...a, nextAfter: 99 });
    expect((await run(env, `/social/workflows/changes?ownerKey=${owner}&after=0`)).status).toBe(
      503,
    );
    ns.tamper = undefined;
    expect((await status()).status).toBe(200);
  });
});

/* ---------- DT-7B-R1: complete, request-bound response proof ---------- */

const T = NOW.getTime();
const I = (id: string) => ({ id, kind: "idea", text: { ar: "", en: `idea ${id}` } });
const P = (id: string) => ({
  id,
  kind: "plan",
  quest: "produce",
  skillId: "iphone-log-prores",
  minutes: 30,
  day: "lightest",
});
const S = (id: string) => ({
  id,
  kind: "post",
  platform: "tiktok",
  title: { ar: "", en: `post ${id}` },
  caption: { ar: "", en: "" },
  offsetDays: 1,
});
/** TEST-ONLY deterministic builder for the three draft kinds. */
const draft = (b: A, action: A): A => {
  const id = `wf:${b.occurrenceId}:${action.id}`;
  if (action.kind === "idea")
    return { record: { id, text: "idea", source: "workflow", createdAt: b.executionAt } };
  if (action.kind === "post")
    return {
      record: {
        id,
        platform: action.platform,
        title: `post ${action.id}`,
        caption: "",
        hashtags: [],
        stage: "idea",
        plannedDay: b.input.day,
        plannedTime: null,
        script: { hook: "", beats: ["", "", ""], cta: "" },
        shots: [],
        createdAt: b.executionAt,
        updatedAt: b.executionAt,
      },
    };
  return {
    record: {
      id,
      week: b.plannerContext.targetWeek,
      day: 0,
      skillId: action.skillId,
      quest: action.quest,
      minutes: action.minutes,
      by: "me",
    },
  };
};
/** The fixed object straight (test-only commits of a chosen step; only `run` executes through a route). */
const direct = (env: Env) => {
  const ns = nsOf(env);
  const stub = ns.get(ns.idFromName(WORKFLOW_OBJECT));
  return async (c: A): Promise<A> =>
    (await (
      await stub.fetch("https://c/", { method: "POST", body: JSON.stringify(c) })
    ).json()) as A;
};
/** Commit the next pending step: the builder's draft, or `{ error }`. */
async function commit(env: Env, owner: string, id: string, error?: string) {
  const call = direct(env);
  const o = (await call({ op: "status", ownerKey: owner, occurrenceId: id, now: T })).occurrence;
  const idx = o.steps.findIndex((s: A) => s.status === "pending");
  const output = error ? { error } : draft(o.body, o.body.snapshot.actions[idx]);
  const r = await call({
    op: "commitStep",
    ownerKey: owner,
    occurrenceId: id,
    idx,
    receiptVersion: o.receiptVersion,
    payloadDigest: o.payloadDigest,
    output,
    now: T,
  });
  expect(r.committed).toBe(true);
}
const finish = async (env: Env, owner: string, id: string) =>
  expect(
    (await direct(env)({ op: "finish", ownerKey: owner, occurrenceId: id, now: T })).finished,
  ).toBe(true);

/** Every receipt state and idempotent outcome, built by the REAL coordinator. */
async function controls() {
  const { env, owner } = await ready();
  const submit = async (id: string, actions: A[]) => {
    const r = await post(
      env,
      "/social/workflows/occurrences",
      await envelope(body(owner, { id, actions })),
    );
    expect(r.status).toBe(201);
  };
  await submit("pend", [I("a1"), I("a2")]);
  await submit("run1", [I("a1"), I("a2")]);
  await commit(env, owner, "run1");
  await submit("run2", [I("a1"), I("a2")]);
  await commit(env, owner, "run2");
  await commit(env, owner, "run2");
  await submit("runf", [I("a1"), I("a2"), I("a3")]);
  await commit(env, owner, "runf");
  await commit(env, owner, "runf", "context-stale");
  await submit("done", [I("a1"), P("p1"), S("s1")]);
  for (let n = 0; n < 3; n++) await commit(env, owner, "done");
  await finish(env, owner, "done");
  await submit("part", [I("a1"), I("a2"), I("a3")]);
  await commit(env, owner, "part");
  await commit(env, owner, "part", "invalid");
  await finish(env, owner, "part");
  await submit("fail", [I("a1"), I("a2")]);
  await commit(env, owner, "fail", "no-skill");
  await finish(env, owner, "fail");
  await submit("conf", [I("a1"), I("a2")]);
  nsOf(env).db.exec(
    `INSERT INTO outputs (output_id, occurrence_id, action_id, kind, record_json, digest, created_at)
     VALUES ('wf:conf:a2', 'conf', 'a2', 'idea', '{}', '${"c".repeat(64)}', 1)`,
  );
  await commit(env, owner, "conf");
  await commit(env, owner, "conf");
  await finish(env, owner, "conf");
  await submit("canc", [I("a1")]);
  await submit("ackd", [I("a1")]);
  await commit(env, owner, "ackd");
  await finish(env, owner, "ackd");
  return { env, owner };
}
const IDS = ["pend", "run1", "run2", "runf", "done", "part", "fail", "conf", "canc", "ackd"];

describe("DT-7B-R1 real control fixtures pass the routes unchanged", () => {
  it("every receipt state, cancel and ack outcome, replay and feed page: the route answer is the coordinator's", async () => {
    const { env, owner } = await controls();
    const call = direct(env);
    const cancel = (id: string) =>
      post(env, `/social/workflows/occurrences/${id}/cancel`, { ownerKey: owner });
    const ack = (id: string, v: number) =>
      post(env, `/social/workflows/occurrences/${id}/ack`, { ownerKey: owner, receiptVersion: v });
    expect(await cancel("canc")).toMatchObject({ status: 200, body: { cancelled: true } });
    for (const id of ["canc", "done", "part", "fail"])
      expect(await cancel(id)).toMatchObject({ status: 200, body: { cancelled: false } });
    const v = (await call({ op: "status", ownerKey: owner, occurrenceId: "ackd", now: T }))
      .occurrence.receiptVersion;
    expect(await ack("ackd", v)).toMatchObject({ status: 200, body: { acknowledged: true } });
    expect(await ack("ackd", v)).toMatchObject({ status: 200, body: { acknowledged: true } });
    expect(await ack("ackd", 1)).toMatchObject({ status: 200, body: { acknowledged: false } });
    expect(await ack("done", 1)).toMatchObject({
      status: 200,
      body: { acknowledged: false, ackedVersion: 0 },
    });
    const states: Record<string, string> = {};
    // Read also 60 days later (historical bodies stay valid: admission time, not the read clock).
    for (const now of [NOW, new Date(T + 60 * 86_400_000)])
      for (const id of IDS) {
        const r = await run(env, `/social/workflows/occurrences/${id}?ownerKey=${owner}`, {}, now);
        expect(r.status).toBe(200);
        expect(r.body).toEqual(
          await call({ op: "status", ownerKey: owner, occurrenceId: id, now: now.getTime() }),
        );
        states[id] =
          `${r.body.occurrence.state}:${r.body.occurrence.steps.map((s: A) => s.status).join(",")}`;
      }
    expect(states).toEqual({
      pend: "pending:pending,pending",
      run1: "running:done,pending",
      run2: "running:done,done",
      runf: "running:done,failed,skipped",
      done: "done:done,done,done",
      part: "partial:done,failed,skipped",
      fail: "failed:failed,skipped",
      conf: "partial:done,failed",
      canc: "cancelled:skipped",
      ackd: "done:done",
    });
    // Identical replays of every state answer created:false.
    for (const id of IDS) {
      const o = (await call({ op: "status", ownerKey: owner, occurrenceId: id, now: T }))
        .occurrence;
      expect(
        await post(env, "/social/workflows/occurrences", {
          body: o.body,
          payloadDigest: o.payloadDigest,
        }),
      ).toMatchObject({ status: 200, body: { created: false, occurrence: o } });
    }
    for (const limit of [3, 50]) {
      const page = await run(
        env,
        `/social/workflows/changes?ownerKey=${owner}&after=0&limit=${limit}`,
      );
      expect(page.status).toBe(200);
      expect(page.body).toEqual(
        await call({ op: "changes", ownerKey: owner, after: 0, limit, now: T }),
      );
    }
  });

  it("registration answers: created, replay, re-register, changed true/false, pause/resume/unregister, conflicts", async () => {
    const env = makeEnv();
    const owner = (await run(env, "/social/workflows/authority")).body.ownerKey as string;
    const reg = (o: A) =>
      post(env, "/social/workflows/registrations", {
        ownerKey: owner,
        workflowId: "w1",
        revision: 1,
        workflowDigest: DIG,
        ...o,
      });
    const ctl = (verb: string, o: A = {}) =>
      post(env, `/social/workflows/registrations/w1${verb}`, {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 1,
        ...o,
      });
    const up = { revision: 2, workflowDigest: "f".repeat(64) };
    for (const [r, status, more] of [
      [await reg({ expectedEpoch: 0 }), 200, { created: true }],
      [await reg({ expectedEpoch: 0 }), 200, { created: false }],
      [await reg({ expectedEpoch: 1 }), 409, { error: "conflict" }],
      [
        await reg({ workflowId: "w5", expectedEpoch: 1 }),
        409,
        { error: "conflict", registration: null },
      ],
      [await ctl("", up), 200, { changed: true }],
      [await ctl("", up), 200, { changed: false }],
      [await ctl("", { ...up, revision: 3 }), 409, { error: "conflict" }],
      [await ctl("/pause", { expectedRevision: 2 }), 200, { changed: true }],
      [await ctl("/pause", { expectedRevision: 2 }), 200, { changed: false }],
      [await ctl("/resume", { expectedRevision: 2 }), 200, { changed: true }],
      [await ctl("/pause"), 409, { error: "conflict" }],
      [await ctl("/unregister", { expectedRevision: 2 }), 200, { changed: true }],
      [await ctl("/unregister", { expectedRevision: 2 }), 200, { changed: false }],
      [await ctl("/pause", { expectedRevision: 2 }), 200, { changed: true }],
      [await reg({ expectedEpoch: 1, revision: 4 }), 200, { created: true }],
      [await reg({ expectedEpoch: 1, revision: 4 }), 200, { created: false }],
    ] as const)
      expect(r).toMatchObject({ status, body: more });
  });
});

/** One public call under a tampered coordinator answer: 503 receipt_unavailable, no echo, exactly one call. */
async function refused(
  env: Env,
  tamper: Fake["tamper"],
  fire: () => Promise<{ status: number; body: A; raw: string }>,
) {
  const ns = nsOf(env);
  const before = ns.calls.length;
  ns.tamper = tamper;
  const r = await fire();
  ns.tamper = undefined;
  expect({ status: r.status, body: r.body }).toEqual({
    status: 503,
    body: { error: "receipt_unavailable" },
  });
  expect(r.raw).not.toContain("CANARY");
  expect(ns.calls.length).toBe(before + 1);
}
type Tamper = (a: A) => unknown;
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;

describe("DT-7B-R1 malformed or contradictory coordinator answers → 503, no echo, no further call", () => {
  it("full receipts: body, digests, identity, state/step/output table", async () => {
    const { env, owner } = await controls();
    const call = direct(env);
    const read = async (id: string) =>
      (await call({ op: "status", ownerKey: owner, occurrenceId: id, now: T })).occurrence as A;
    const done = await read("done");
    const pend = await read("pend");
    // An output with a private key, its record digest recomputed and copied to its step: still not a draft.
    const leaked = clone(done);
    leaked.outputs[0].record.token = "CANARY";
    leaked.outputs[0].digest = await sha256Hex(canonicalJson(leaked.outputs[0].record));
    leaked.steps[0].outputDigest = leaked.outputs[0].digest;
    // A body changed AND re-digested: identity no longer binds the receipt's own fields.
    const moved = clone(pend);
    moved.body.revision = 2;
    moved.payloadDigest = await sha256Hex(canonicalJson(moved.body));
    const cases: [string, Tamper][] = [
      ["pend", (a) => ((a.occurrence.body.inbox = { token: "CANARY" }), a)],
      ["pend", (a) => (delete a.occurrence.body.input, a)],
      ["pend", (a) => ((a.occurrence.body.snapshot.actions[0].text.en = "CANARY"), a)],
      [
        "pend",
        (a) => (
          (a.occurrence.body.snapshot.actions[0].kind = "publish"),
          (a.occurrence.steps[0].kind = "publish"),
          a
        ),
      ],
      ["pend", (a) => ((a.occurrence.revision = 2), a)],
      ["pend", (a) => ({ ...a, occurrence: moved })],
      // executionAt beyond the receipt's own admission time + skew (historical validity is at createdAt).
      [
        "pend",
        (a) => ((a.occurrence.createdAt = a.occurrence.updatedAt = "2026-10-17T08:00:00.000Z"), a),
      ],
      [
        "pend",
        (a) => ({
          ...a,
          occurrence: { ...a.occurrence, state: "done", finishedAt: AT, purgeAt: AT },
        }),
      ],
      ["pend", (a) => ((a.occurrence.startedAt = AT), a)],
      ["pend", (a) => ((a.occurrence.receiptVersion = 2), a)],
      ["pend", (a) => ((a.occurrence.steps[0].at = AT), a)],
      ["run1", (a) => (delete a.occurrence.startedAt, a)],
      ["run1", (a) => ((a.occurrence.steps = [a.occurrence.steps[1], a.occurrence.steps[0]]), a)],
      ["run1", (a) => ((a.occurrence.receiptVersion = 3), a)],
      ["run1", (a) => ((a.occurrence.outputs = []), a)],
      ["runf", (a) => ((a.occurrence.steps[1].error = "teapot"), a)],
      ["runf", (a) => ((a.occurrence.steps[2].status = "pending"), a)],
      ["done", (a) => ((a.occurrence.state = "cancelled"), a)],
      ["done", (a) => ((a.occurrence.outputs[0].record.text = "CANARY"), a)],
      ["done", (a) => ((a.occurrence.outputs[1].record.week = "2026-10-10"), a)],
      ["done", (a) => (delete a.occurrence.steps[2].at, a)],
      ["done", (a) => ((a.occurrence.steps[0].outputId = "wf:pend:a1"), a)],
      [
        "done",
        (a) => (
          (a.occurrence.purgeAt = new Date(Date.parse(a.occurrence.purgeAt) + 1).toISOString()),
          a
        ),
      ],
      ["done", (a) => ((a.occurrence.firstAckAt = AT), a)],
      ["done", (a) => ((a.occurrence.updatedAt = AT), a)],
      ["done", () => ({ ownerKey: owner, occurrence: leaked })],
      ["part", (a) => ((a.occurrence.state = "failed"), a)],
      ["fail", (a) => ((a.occurrence.state = "partial"), a)],
      ["canc", (a) => ((a.occurrence.startedAt = AT), a)],
      ["ackd", (a) => ((a.occurrence.ackedVersion = 1), a)],
      ["ackd", (a) => (delete a.occurrence.firstAckAt, a)],
    ];
    await call({ op: "cancel", ownerKey: owner, occurrenceId: "canc", now: T });
    const v = (await read("ackd")).receiptVersion;
    await call({ op: "ack", ownerKey: owner, occurrenceId: "ackd", receiptVersion: v, now: T });
    for (const [id, t] of cases)
      await refused(
        env,
        (_c, a) => t(a),
        () => run(env, `/social/workflows/occurrences/${id}?ownerKey=${owner}`),
      );
    // The submit answer is bound too: created:true needs a fresh pending receipt.
    await refused(
      env,
      (_c, a) => ({ ...a, created: true }),
      () =>
        post(env, "/social/workflows/occurrences", {
          body: done.body,
          payloadDigest: done.payloadDigest,
        }),
    );
  });

  it("feed items: typed steps and outputs, links, digests, state table, bounds, unique ids", async () => {
    const { env, owner } = await controls();
    const feed = () => run(env, `/social/workflows/changes?ownerKey=${owner}&after=0`);
    const at = (a: A, id: string) => a.items.find((i: A) => i.occurrenceId === id);
    const leaked = clone((await feed()).body);
    const out = at(leaked, "done").outputs[0];
    out.record.token = "CANARY";
    out.digest = await sha256Hex(canonicalJson(out.record));
    at(leaked, "done").steps[0].outputDigest = out.digest;
    const cases: Tamper[] = [
      (a) => ((at(a, "pend").steps = [{ token: "CANARY" }]), a),
      (a) => ((at(a, "done").outputs = [{ record: { token: "CANARY" } }]), a),
      (a) => ((at(a, "run1").outputs = []), a),
      (a) => (delete at(a, "done").outputs, a),
      (a) => ((at(a, "done").outputs[0].record.text = "CANARY"), a),
      (a) => ((at(a, "done").steps[1].status = "pending"), a),
      (a) => ((at(a, "pend").steps[0].idx = 1), a),
      (a) => ((at(a, "pend").steps[1].actionId = "a1"), a),
      (a) => ((at(a, "pend").steps[0].kind = "publish"), a),
      (a) => ((at(a, "pend").receiptVersion = 2), a),
      (a) => ((at(a, "done").state = "running"), a),
      (a) => ((at(a, "part").steps[1].error = "teapot"), a),
      (a) => {
        const p = at(a, "pend");
        p.steps = Array.from({ length: 6 }, (_, idx) => ({
          ...p.steps[0],
          idx,
          actionId: `x${idx}`,
        }));
        return a;
      },
      (a) => {
        const last = a.items.at(-1);
        a.items.push({ ...clone(a.items[0]), changeSeq: last.changeSeq + 1 });
        a.nextAfter = last.changeSeq + 1;
        return a;
      },
      () => leaked,
    ];
    for (const t of cases) await refused(env, (_c, a) => t(a), feed);
  });

  it("mutation success is bound to the request: epoch, revision, digest, paused, state, cancel and ack proof", async () => {
    const { env, owner } = await controls();
    const call = direct(env);
    const pend = (await call({ op: "status", ownerKey: owner, occurrenceId: "pend", now: T }))
      .occurrence;
    const done = (await call({ op: "status", ownerKey: owner, occurrenceId: "done", now: T }))
      .occurrence;
    const reg = (o: A) =>
      post(env, "/social/workflows/registrations", {
        ownerKey: owner,
        workflowId: "w2",
        expectedEpoch: 0,
        revision: 1,
        workflowDigest: DIG,
        ...o,
      });
    const ctl = (verb: string, o: A = {}) =>
      post(env, `/social/workflows/registrations/w1${verb}`, {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 1,
        ...o,
      });
    const up = { revision: 2, workflowDigest: "f".repeat(64) };
    const cases: [Tamper, () => ReturnType<typeof post>][] = [
      [
        (a) => (
          (a.registration.revision = 99),
          (a.registration.workflowDigest = "f".repeat(64)),
          a
        ),
        () => reg({}),
      ],
      [(a) => ((a.registration.workflowDigest = "f".repeat(64)), a), () => reg({})],
      [
        (a) => (
          (a.registration.state = "unregistered"),
          (a.registration.epochs[0].closedAt = AT),
          a
        ),
        () => reg({}),
      ],
      [
        (a) => ((a.registration.updatedAt = "2026-10-17T09:06:00.000Z"), a),
        () => reg({ workflowId: "w3" }),
      ],
      [(a) => ((a.created = false), (a.registration.revision = 2), a), () => reg({})],
      [(a) => ((a.registration.revision = 1), a), () => ctl("", up)],
      [(a) => ((a.registration.workflowDigest = DIG), a), () => ctl("", up)],
      [(a) => ((a.registration.paused = false), a), () => ctl("/pause", { expectedRevision: 2 })],
      [(a) => ((a.registration.revision = 3), a), () => ctl("/pause", { expectedRevision: 2 })],
      [
        (a) => ((a.registration.state = "active"), delete a.registration.epochs[0].closedAt, a),
        () => ctl("/unregister", { expectedRevision: 2 }),
      ],
      [
        () => ({ ownerKey: owner, occurrence: pend, cancelled: true }),
        () => post(env, "/social/workflows/occurrences/pend/cancel", { ownerKey: owner }),
      ],
      [
        () => ({ ownerKey: owner, occurrence: pend, cancelled: false }),
        () => post(env, "/social/workflows/occurrences/pend/cancel", { ownerKey: owner }),
      ],
      [
        () => ({ ownerKey: owner, occurrence: done, cancelled: true }),
        () => post(env, "/social/workflows/occurrences/done/cancel", { ownerKey: owner }),
      ],
      [
        (a) => ((a.ackedVersion = 0), a),
        () =>
          post(env, "/social/workflows/occurrences/done/ack", {
            ownerKey: owner,
            receiptVersion: done.receiptVersion,
          }),
      ],
      [
        // "done" is now acknowledged: a lower ack's no-op answer must keep its firstAckAt.
        (a) => (delete a.firstAckAt, a),
        () =>
          post(env, "/social/workflows/occurrences/done/ack", {
            ownerKey: owner,
            receiptVersion: 1,
          }),
      ],
      [
        (a) => ((a.firstAckAt = AT), a),
        () =>
          post(env, "/social/workflows/occurrences/part/ack", {
            ownerKey: owner,
            receiptVersion: 1,
          }),
      ],
      [
        (a) => ((a.ackedVersion = 1), (a.firstAckAt = AT), a),
        () =>
          post(env, "/social/workflows/occurrences/part/ack", {
            ownerKey: owner,
            receiptVersion: 1,
          }),
      ],
    ];
    for (const [t, fire] of cases) await refused(env, (_c, a) => t(a), fire);
    // A resume answering paused:true (w1 was paused above).
    await refused(
      env,
      (_c, a) => (((a as A).registration.paused = true), a),
      () => ctl("/resume", { expectedRevision: 2 }),
    );
  });

  it("refusals: the operation's own errors with typed, request-bound extras; mixed or contradictory ones never pass", async () => {
    const { env, owner } = await controls();
    const ack = (id = "pend", v = 1) =>
      post(env, `/social/workflows/occurrences/${id}/ack`, { ownerKey: owner, receiptVersion: v });
    const cancel = () =>
      post(env, "/social/workflows/occurrences/pend/cancel", { ownerKey: owner });
    const status = () => run(env, `/social/workflows/occurrences/pend?ownerKey=${owner}`);
    const reg = (o: A = {}) =>
      post(env, "/social/workflows/registrations", {
        ownerKey: owner,
        workflowId: "w1",
        expectedEpoch: 0,
        revision: 1,
        workflowDigest: DIG,
        ...o,
      });
    const update = () =>
      post(env, "/social/workflows/registrations/w1", {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 1,
        revision: 2,
        workflowDigest: DIG,
      });
    const registration = (await reg()).body.registration as A;
    const D = "d".repeat(64);
    const cases: [unknown, () => ReturnType<typeof post>][] = [
      [
        {
          error: "not_terminal",
          occurrenceId: "pend",
          state: { token: "CANARY" },
          receiptVersion: 0,
        },
        () => ack(),
      ],
      [
        { error: "not_terminal", occurrenceId: "pend", state: "done", receiptVersion: 1 },
        () => ack(),
      ],
      [
        { error: "not_terminal", occurrenceId: "pend", state: "pending", receiptVersion: 0 },
        () => ack(),
      ],
      [{ error: "future_version", occurrenceId: "done", receiptVersion: 9 }, () => ack("done", 5)],
      [
        { error: "future_version", occurrenceId: "done", receiptVersion: "4" },
        () => ack("done", 5),
      ],
      [
        { error: "pruned", occurrenceId: "pend", payloadDigest: "CANARY", prunedAt: AT },
        () => ack(),
      ],
      [
        { error: "pruned", occurrenceId: "pend", payloadDigest: D, prunedAt: "yesterday" },
        () => cancel(),
      ],
      [{ error: "absent", occurrenceId: "other" }, () => cancel()],
      [{ error: "running", occurrenceId: "pend" }, () => ack()],
      [
        { error: "not_terminal", occurrenceId: "pend", state: "pending", receiptVersion: 1 },
        () => cancel(),
      ],
      [{ error: "conflict", registration }, () => status()],
      [{ error: "absent", occurrenceId: "pend" }, () => status()],
      [{ error: "not_registered", workflowId: "w1" }, () => reg()],
      [{ error: "digest_mismatch" }, () => cancel()],
      [{ error: "capacity" }, () => update()],
      [{ error: "conflict", registration, extra: "CANARY" }, () => reg()],
      // Contradictory: the register replay itself, or no registration although one was expected to exist.
      [{ error: "conflict", registration }, () => reg()],
      [{ error: "conflict", registration: null }, () => reg()],
      [
        { error: "conflict", registration: { ...registration, state: "unregistered" } },
        () => reg(),
      ],
      [{ error: "conflict", registration: null }, () => update()],
      [{ error: "conflict", registration: { ...registration, revision: 1 } }, () => update()],
      [{ error: "not_registered", workflowId: 7 }, () => update()],
    ];
    for (const [answer, fire] of cases) await refused(env, () => answer, fire);
    // Honest refusals still pass, typed and bound (the ownerKey added once the coordinator accepted it).
    expect(await ack("run1", 1)).toEqual({
      status: 409,
      body: {
        error: "not_terminal",
        ownerKey: owner,
        occurrenceId: "run1",
        state: "running",
        receiptVersion: 2,
      },
      raw: expect.any(String),
    });
    expect(await reg({ expectedEpoch: 3 })).toMatchObject({
      status: 409,
      body: { error: "conflict" },
    });
  });
});

/* ---------- DT-7B-2: POST /social/workflows/occurrences/:id/run ---------- */

describe("DT-7B-2 run route: one authenticated draft-only run/resume, strict request, validated answer", () => {
  const runPath = (id = "m1") => `/social/workflows/occurrences/${id}/run`;

  it("runs the real builders through the fixed object: the answer is the coordinator's, the call is exactly op/ownerKey/id/now", async () => {
    const { env, owner } = await ready();
    await post(
      env,
      "/social/workflows/occurrences",
      await envelope(body(owner, { actions: [I("a1"), P("p1"), S("s1")] })),
    );
    const r = await post(env, runPath(), { ownerKey: owner });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["committed", "occurrence", "ownerKey", "stopped"]);
    expect(r.body).toMatchObject({ ownerKey: owner, committed: 3, stopped: "terminal" });
    expect(r.body.occurrence.state).toBe("done");
    expect(r.body.occurrence.outputs.map((o: A) => o.outputId)).toEqual([
      "wf:m1:a1",
      "wf:m1:p1",
      "wf:m1:s1",
    ]);
    const last = nsOf(env).calls.at(-1)!;
    expect(last).toEqual({ op: "run", ownerKey: owner, occurrenceId: "m1", now: T });
    expect(new Set(nsOf(env).names)).toEqual(new Set([WORKFLOW_OBJECT]));
    // Resume after completion: the same receipt, nothing committed; status agrees.
    const again = await post(env, runPath(), { ownerKey: owner });
    expect(again.body).toEqual({ ...r.body, committed: 0 });
    expect(
      (await run(env, `/social/workflows/occurrences/m1?ownerKey=${owner}`)).body.occurrence,
    ).toEqual(r.body.occurrence);
  });

  it("paused, absent, pruned and another authority are typed; the pause answer is the pending receipt", async () => {
    const { env, owner } = await ready();
    await post(env, "/social/workflows/registrations/w1/pause", {
      ownerKey: owner,
      registrationEpoch: 1,
      expectedRevision: 1,
    });
    await post(env, "/social/workflows/occurrences", await envelope(body(owner)));
    const p = await post(env, runPath(), { ownerKey: owner });
    expect(p).toMatchObject({
      status: 200,
      body: {
        committed: 0,
        stopped: "paused",
        occurrence: { state: "pending", receiptVersion: 1 },
      },
    });
    expect(await post(env, runPath("never"), { ownerKey: owner })).toMatchObject({
      status: 404,
      body: { error: "absent", ownerKey: owner, occurrenceId: "never" },
    });
    expect(await post(env, runPath(), { ownerKey: "wfo_" + "1".repeat(32) })).toMatchObject({
      status: 409,
      body: { error: "authority_mismatch" },
    });
    // A tombstoned occurrence: 410 pruned.
    const later = new Date(T + 400 * 86_400_000);
    await post(env, "/social/workflows/registrations/w1/resume", {
      ownerKey: owner,
      registrationEpoch: 1,
      expectedRevision: 1,
    });
    await post(env, runPath(), { ownerKey: owner });
    const gone = await post(env, runPath(), { ownerKey: owner }, {}, later);
    expect(gone.status).toBe(410);
    expect(gone.body).toMatchObject({ error: "pruned", ownerKey: owner, occurrenceId: "m1" });
  });

  it("unauthenticated, cross-origin, extra-field, query-toggle, wrong-method and bad-id invocations never reach the object", async () => {
    const { env, owner } = await ready();
    await post(env, "/social/workflows/occurrences", await envelope(body(owner)));
    const before = nsOf(env).calls.length;
    for (const init of [{ auth: null }, { auth: "wrong" }, { origin: "https://evil.example" }]) {
      const r = await post(env, runPath(), { ownerKey: owner }, init);
      expect([401, 403]).toContain(r.status);
      expect(r.raw).not.toContain(owner);
    }
    for (const extra of [
      { builder: "test" },
      { output: { record: {} } },
      { body: body(owner) },
      { now: T },
      { executionAt: AT },
      { retries: 3 },
      { enabled: true },
    ])
      expect((await post(env, runPath(), { ownerKey: owner, ...extra })).status).toBe(400);
    expect((await post(env, runPath(), {})).status).toBe(400);
    expect((await post(env, runPath(), { ownerKey: "nope" })).status).toBe(400);
    expect((await post(env, `${runPath()}?builder=test`, { ownerKey: owner })).status).toBe(400);
    expect((await run(env, runPath())).status).toBe(405);
    expect((await post(env, runPath("a:b"), { ownerKey: owner })).body.error).toBe(
      "unsupported_id",
    );
    expect((await post(env, `${runPath()}/again`, { ownerKey: owner })).status).toBe(404);
    expect(
      (await post(env, runPath(), { ownerKey: owner }, { headers: { "X-Test-Builder": "1" } })).body
        .occurrence.outputs[0].record.text,
    ).toBe("idea");
    // Only that last (valid) call reached the object.
    expect(nsOf(env).calls.length).toBe(before + 1);
  });

  it("malformed, mixed or contradictory run answers → 503 receipt_unavailable, no echo, no further call", async () => {
    const { env, owner } = await controls();
    const call = direct(env);
    const read = async (id: string) =>
      (await call({ op: "status", ownerKey: owner, occurrenceId: id, now: T })).occurrence as A;
    const [pend, run1, done] = [await read("pend"), await read("run1"), await read("done")];
    const ok = (occurrence: A, committed: number, stopped: string) => ({
      ownerKey: owner,
      occurrence,
      committed,
      stopped,
    });
    const leaked = clone(done);
    leaked.outputs[0].record.token = "CANARY";
    leaked.outputs[0].digest = await sha256Hex(canonicalJson(leaked.outputs[0].record));
    leaked.steps[0].outputDigest = leaked.outputs[0].digest;
    const cases: [string, A | ((a: A) => unknown)][] = [
      ["done", { ...ok(done, 3, "terminal"), extra: "CANARY" }],
      ["done", { ...ok(done, 3, "terminal"), ownerKey: "wfo_" + "1".repeat(32) }],
      ["done", ok(done, -1, "terminal")],
      ["done", ok(done, 6, "terminal")],
      ["done", ok(done, 1.5, "terminal")],
      ["done", { ...ok(done, 3, "terminal"), committed: "3" }],
      ["done", ok(done, 3, "finished")],
      ["done", ok(done, 3, "contention")],
      ["done", ok(done, 5, "limit")],
      ["done", ok(done, 0, "paused")],
      ["run1", ok(run1, 1, "terminal")],
      ["run1", ok(run1, 0, "paused")],
      ["run1", ok(run1, 2, "contention")], // more commits than resolved steps
      ["run1", ok(run1, 4, "limit")],
      ["pend", ok(pend, 1, "paused")],
      ["pend", ok(pend, 0, "terminal")],
      ["done", ok(pend, 0, "paused")], // another occurrence's receipt
      ["done", ok(leaked, 3, "terminal")],
      ["done", (a) => ((a.occurrence.outputs[0].record.text = "CANARY"), a)],
      ["done", (a) => ({ error: "absent", occurrenceId: "done", occurrence: (a as A).occurrence })],
      ["done", () => ({ error: "absent", occurrenceId: "other" })],
      ["done", () => ({ error: "stale", occurrenceId: "done" })],
      ["done", () => ({ error: "paused", occurrenceId: "done" })],
      ["done", () => ({ error: "running", occurrenceId: "done" })],
      ["done", () => ({ error: "steps_pending" })],
      ["done", () => ({ ownerKey: owner, occurrence: done, committed: 0 })],
    ];
    for (const [id, t] of cases)
      await refused(
        env,
        (_c, a) => (typeof t === "function" ? t(a) : clone(t)),
        () => post(env, runPath(id), { ownerKey: owner }),
      );
  });

  it("legitimate bounded stops pass: limit (5 commits, nonterminal) and contention (nonterminal) with valid receipts", async () => {
    const { env, owner } = await ready();
    const five = [I("a1"), I("a2"), I("a3"), I("a4"), I("a5")];
    await post(
      env,
      "/social/workflows/occurrences",
      await envelope(body(owner, { actions: five })),
    );
    for (let n = 0; n < 5; n++) await commit(env, owner, "m1");
    const call = direct(env);
    const allDone = (await call({ op: "status", ownerKey: owner, occurrenceId: "m1", now: T }))
      .occurrence;
    expect(allDone).toMatchObject({ state: "running", receiptVersion: 6 });
    const pass = async (committed: number, stopped: string) => {
      nsOf(env).tamper = () => ({ ownerKey: owner, occurrence: allDone, committed, stopped });
      const r = await post(env, runPath(), { ownerKey: owner });
      nsOf(env).tamper = undefined;
      expect(r).toMatchObject({ status: 200, body: { committed, stopped } });
    };
    await pass(5, "limit");
    await pass(0, "contention");
    await pass(3, "contention");
  });
});
