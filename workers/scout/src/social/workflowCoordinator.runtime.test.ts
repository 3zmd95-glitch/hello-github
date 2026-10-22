import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drainOne, PURGE_EVERY_MS, WORKFLOW_OBJECT, type StepBuilder } from "./workflowCoordinator";
import { canonicalJson, sha256Hex } from "./workflowProtocol";
import { riyadhDay } from "./time";

// ⚙️ DT-7B runtime proof (planning/tools/38-cloud-workflows.md) in workerd, through the Miniflare that ships with our
// pinned Wrangler (no new dependency). The real entry (src/index.ts) is bundled; the five Durable Object classes,
// bindings and SQLite migrations (incl. WORKFLOW_COORDINATOR / "v5-workflows") come from wrangler.jsonc. Storage is
// on disk and outlives a runtime restart. Every outbound request is refused and recorded: none is expected.
//
// Public calls go through the real routes (bearer, origin, routes.ts). The executor has no route: the TEST-ONLY
// deterministic builder drives `drainOne` straight on the binding's fixed object, proving the store's transactions
// (the real executor is validation pending). Clock-dependent purges call the object directly with a chosen `now`.

const requireRuntime = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireRuntime("miniflare");
const { build } = requireRuntime("esbuild");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "runtime-scout-token";
const DIG = "e".repeat(64);
const DAY = 86_400_000;

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let script = "";
let durableObjects: Record<string, { className: string; useSQLite: boolean }> = {};
const dirs: string[] = [];
const outbound: string[] = [];

beforeAll(async () => {
  const wrangler = await import("wrangler");
  const config = wrangler.unstable_readConfig({ config: join(ROOT, "wrangler.jsonc") });
  const sqlite = wrangler.unstable_getDurableObjectClassNameToUseSQLiteMap(config.migrations);
  expect(config.durable_objects.bindings).toEqual([
    { name: "SEND_COORDINATOR", class_name: "SendCoordinator" },
    { name: "THREADS_SEND_COORDINATOR", class_name: "ThreadsSendCoordinator" },
    { name: "INSTAGRAM_PUBLIC_SEND_COORDINATOR", class_name: "InstagramPublicSendCoordinator" },
    { name: "INSTAGRAM_DM_COORDINATOR", class_name: "InstagramDmCoordinator" },
    { name: "WORKFLOW_COORDINATOR", class_name: "WorkflowCoordinator" },
  ]);
  expect(config.migrations).toEqual([
    { tag: "v1-send", new_sqlite_classes: ["SendCoordinator"] },
    { tag: "v2-threads-send", new_sqlite_classes: ["ThreadsSendCoordinator"] },
    { tag: "v3-instagram-public-send", new_sqlite_classes: ["InstagramPublicSendCoordinator"] },
    { tag: "v4-instagram-dm", new_sqlite_classes: ["InstagramDmCoordinator"] },
    { tag: "v5-workflows", new_sqlite_classes: ["WorkflowCoordinator"] },
  ]);
  expect(sqlite.get("WorkflowCoordinator")).toBe(true);
  durableObjects = Object.fromEntries(
    config.durable_objects.bindings.map((b: { name: string; class_name: string }) => [
      b.name,
      { className: b.class_name, useSQLite: sqlite.get(b.class_name) === true },
    ]),
  );
  const { outputFiles } = await build({
    entryPoints: [join(ROOT, "src/index.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:*", "node:*"],
    write: false,
    logLevel: "silent",
  });
  script = outputFiles[0].text;
}, 120_000);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  expect(outbound).toEqual([]);
});

function runtime(persist: string) {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-01",
      script,
      durableObjects,
      resourcePersistencePath: persist,
      kvNamespaces: ["SOCIAL_KV"],
      bindings: { SCOUT_TOKEN: TOKEN },
      // Every outbound request is intercepted and refused; this test cannot contact anything.
      outboundService: async (request: Request) => {
        outbound.push(`${request.method} ${request.url}`);
        return new Response("blocked", { status: 599 });
      },
    }),
  );
}
type MF = ReturnType<typeof runtime>;

const freshDir = () => {
  const d = mkdtempSync(join(tmpdir(), "workflow-coordinator-"));
  dirs.push(d);
  return d;
};

/** The real router with the bearer (no Origin header: a server-side caller). */
async function api(mf: MF, method: string, path: string, json?: unknown) {
  const res = await mf.dispatchFetch(`https://scout.test/social/workflows/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}` },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
  return { status: res.status as number, body: (await res.json()) as A };
}

/** The binding's fixed object, straight (the executor and clock-controlled calls only). */
async function direct(mf: MF) {
  const ns = await mf.getDurableObjectNamespace("WORKFLOW_COORDINATOR");
  const stub = ns.get(ns.idFromName(WORKFLOW_OBJECT));
  return async (c: A): Promise<A> =>
    (await (
      await stub.fetch("https://workflow-coordinator/", { method: "POST", body: JSON.stringify(c) })
    ).json()) as A;
}

const idea = (id: string) => ({ id, kind: "idea", text: { ar: "", en: `idea ${id}` } });
function body(
  owner: string,
  id: string,
  actions: A[] = [idea("a1")],
  o: { at?: number; epoch?: number; wf?: string } = {},
): A {
  // DT-7B-R1 fixture correction (chronology): was `Date.now() - 60_000` (a minute before the registration that
  // `ready` had just opened); now one second after the real clock, inside the 10-minute future-skew bound (the
  // routes read the Worker clock), so register → trigger is real. Assertions unchanged.
  const at = new Date(o.at ?? Date.now() + 1_000).toISOString();
  return {
    occurrenceId: id,
    ownerKey: owner,
    workflowId: o.wf ?? "w1",
    kind: "manual",
    registrationEpoch: o.epoch ?? 1,
    revision: 1,
    snapshot: { name: { ar: "", en: "Flow" }, trigger: { kind: "manual" }, actions },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: riyadhDay(at),
    },
    executionAt: at,
  };
}
const submit = async (mf: MF, b: A) =>
  api(mf, "POST", "occurrences", { body: b, payloadDigest: await sha256Hex(canonicalJson(b)) });

/** TEST-ONLY deterministic builder. */
const testBuilder: StepBuilder = ({ body: b, action }) => ({
  record: {
    id: `wf:${b.occurrenceId}:${action.id}`,
    text: `idea ${action.id}`,
    source: "workflow",
    createdAt: b.executionAt,
  },
});
const drain = async (mf: MF, owner: string, id: string) =>
  (await drainOne(await direct(mf), owner, id, testBuilder, () => Date.now())) as A;

async function ready(mf: MF) {
  const owner = (await api(mf, "GET", "authority")).body.ownerKey as string;
  const r = await api(mf, "POST", "registrations", {
    ownerKey: owner,
    workflowId: "w1",
    expectedEpoch: 0,
    revision: 1,
    workflowDigest: DIG,
  });
  expect(r.status).toBe(200);
  return owner;
}

describe("WorkflowCoordinator in workerd (real index export, wrangler binding + v5-workflows)", () => {
  it("restart persistence: ownerKey, registration and occurrences survive; lost answers never duplicate", async () => {
    const dir = freshDir();
    let mf = runtime(dir);
    let owner: string;
    let first: A;
    try {
      owner = await ready(mf);
      expect(owner).toMatch(/^wfo_[0-9a-f]{32}$/);
      const b = body(owner, "m1");
      first = await submit(mf, b);
      expect(first).toMatchObject({
        status: 201,
        body: { created: true, occurrence: { receiptVersion: 1, changeSeq: 1 } },
      });
      // The lost answer: resend.
      expect(await submit(mf, b)).toMatchObject({ status: 200, body: { created: false } });
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      expect((await api(mf, "GET", "authority")).body.ownerKey).toBe(owner!);
      const s = await api(mf, "GET", `occurrences/m1?ownerKey=${owner!}`);
      expect(s.body.occurrence).toEqual(first!.body.occurrence);
      // A lost register answer replayed after the restart: same epoch.
      const again = await api(mf, "POST", "registrations", {
        ownerKey: owner!,
        workflowId: "w1",
        expectedEpoch: 0,
        revision: 1,
        workflowDigest: DIG,
      });
      expect(again.body).toMatchObject({ created: false, registration: { registrationEpoch: 1 } });
    } finally {
      await mf.dispose();
    }
    const other = runtime(freshDir());
    try {
      expect((await api(other, "GET", "authority")).body.ownerKey).not.toBe(owner!);
    } finally {
      await other.dispose();
    }
  }, 120_000);

  it("concurrent step/finish/cancel races: one commit per step, one terminal proof, unchanged after restart", async () => {
    const dir = freshDir();
    let mf = runtime(dir);
    let owner: string;
    let proof: A;
    try {
      owner = await ready(mf);
      await submit(mf, body(owner, "o1", [idea("a1"), idea("a2"), idea("a3")]));
      const [x, y, z] = await Promise.all([
        drain(mf, owner, "o1"),
        drain(mf, owner, "o1"),
        drain(mf, owner, "o1"),
      ]);
      expect(x.occurrence).toEqual(y.occurrence);
      expect(y.occurrence).toEqual(z.occurrence);
      expect(x.occurrence).toMatchObject({ state: "done", receiptVersion: 5, changeSeq: 5 });
      expect(x.occurrence.outputs.map((o: A) => o.outputId)).toEqual([
        "wf:o1:a1",
        "wf:o1:a2",
        "wf:o1:a3",
      ]);
      proof = x.occurrence;

      // Two finishes racing on a fully stepped row: one finishes, the other answers the same terminal row.
      await submit(mf, body(owner, "o2"));
      const call = await direct(mf);
      const st = (
        await call({ op: "status", ownerKey: owner, occurrenceId: "o2", now: Date.now() })
      ).occurrence;
      await call({
        op: "commitStep",
        ownerKey: owner,
        occurrenceId: "o2",
        idx: 0,
        receiptVersion: 1,
        payloadDigest: st.payloadDigest,
        output: await testBuilder({
          body: st.body,
          idx: 0,
          action: st.body.snapshot.actions[0],
          prior: [],
        }),
        now: Date.now(),
      });
      const fins = await Promise.all(
        [1, 2, 3].map(() =>
          call({ op: "finish", ownerKey: owner, occurrenceId: "o2", now: Date.now() }),
        ),
      );
      expect(fins.filter((f) => f.finished === true)).toHaveLength(1);
      expect(new Set(fins.map((f) => JSON.stringify(f.occurrence))).size).toBe(1);

      // Cancel racing a drain: either cancelled with zero outputs, or done with every output — never both.
      await submit(mf, body(owner, "o3", [idea("a1"), idea("a2")]));
      const [c, d] = await Promise.all([
        api(mf, "POST", "occurrences/o3/cancel", { ownerKey: owner }),
        drain(mf, owner, "o3"),
      ]);
      const end = (await api(mf, "GET", `occurrences/o3?ownerKey=${owner}`)).body.occurrence;
      if (end.state === "cancelled") {
        expect(end.outputs).toEqual([]);
        expect(c.body.cancelled).toBe(true);
      } else {
        expect(end.state).toBe("done");
        expect(end.outputs).toHaveLength(2);
        expect([409, 200]).toContain(c.status);
        if (c.status === 200) expect(c.body.cancelled).toBe(false);
      }
      expect(d.occurrence ?? d).toBeDefined();
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      // The completed proof is unchanged after a restart and a stale executor.
      const call = await direct(mf);
      const late = await call({
        op: "commitStep",
        ownerKey: owner!,
        occurrenceId: "o1",
        idx: 0,
        receiptVersion: 1,
        payloadDigest: proof!.payloadDigest,
        output: { error: "invalid" },
        now: Date.now(),
      });
      expect(late.error).toBe("stale");
      expect((await api(mf, "GET", `occurrences/o1?ownerKey=${owner!}`)).body.occurrence).toEqual(
        proof!,
      );
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("pause gates the first step of pending work; resume releases it; unregister keeps it cloud-owned", async () => {
    const mf = runtime(freshDir());
    try {
      const owner = await ready(mf);
      await api(mf, "POST", "registrations/w1/pause", {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 1,
      });
      expect((await submit(mf, body(owner, "p1"))).body.occurrence.state).toBe("pending");
      expect(await drain(mf, owner, "p1")).toMatchObject({
        error: "paused",
        occurrence: { state: "pending", receiptVersion: 1 },
      });
      await api(mf, "POST", "registrations/w1/unregister", {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 1,
      });
      expect((await drain(mf, owner, "p1")).error).toBe("paused");
      await api(mf, "POST", "registrations/w1/resume", {
        ownerKey: owner,
        registrationEpoch: 1,
        expectedRevision: 1,
      });
      expect((await drain(mf, owner, "p1")).occurrence.state).toBe("done");
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("feed pagination: old rows finishing later come back after the cursor, across a restart", async () => {
    const dir = freshDir();
    let mf = runtime(dir);
    let owner: string;
    let cursor: number;
    const seen: string[] = [];
    try {
      owner = await ready(mf);
      for (let n = 0; n < 55; n++) await submit(mf, body(owner, `r${n}`));
      const p1 = await api(mf, "GET", `changes?ownerKey=${owner}&after=0&limit=50`);
      expect(p1.body).toMatchObject({ nextAfter: 50, more: true });
      seen.push(...p1.body.items.map((i: A) => `${i.occurrenceId}:${i.state}`));
      await drain(mf, owner, "r0");
      await drain(mf, owner, "r7");
      cursor = p1.body.nextAfter;
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      for (;;) {
        const p = await api(mf, "GET", `changes?ownerKey=${owner!}&after=${cursor!}&limit=4`);
        seen.push(...p.body.items.map((i: A) => `${i.occurrenceId}:${i.state}`));
        cursor = p.body.nextAfter;
        if (!p.body.more) break;
      }
      expect(seen.slice(50)).toEqual([
        "r50:pending",
        "r51:pending",
        "r52:pending",
        "r53:pending",
        "r54:pending",
        "r0:done",
        "r7:done",
      ]);
      expect(seen.filter((s) => s.endsWith(":pending"))).toHaveLength(55);
      expect((await api(mf, "GET", `changes?ownerKey=${owner!}&after=${cursor!}`)).body).toEqual({
        ownerKey: owner!,
        items: [],
        nextAfter: cursor!,
        more: false,
      });
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("ack (exact terminal, firstAckAt kept across restart, no feed echo) and the tombstoned purge", async () => {
    const dir = freshDir();
    let mf = runtime(dir);
    let owner: string;
    let done: A;
    let ack: A;
    try {
      owner = await ready(mf);
      await submit(mf, body(owner, "k1"));
      await submit(mf, body(owner, "keep"));
      done = (await drain(mf, owner, "k1")).occurrence;
      const feed = await api(mf, "GET", `changes?ownerKey=${owner}&after=0`);
      expect(
        (
          await api(mf, "POST", "occurrences/k1/ack", {
            ownerKey: owner,
            receiptVersion: done.receiptVersion + 1,
          })
        ).status,
      ).toBe(409);
      expect(
        (await api(mf, "POST", "occurrences/keep/ack", { ownerKey: owner, receiptVersion: 1 })).body
          .error,
      ).toBe("not_terminal");
      ack = (
        await api(mf, "POST", "occurrences/k1/ack", {
          ownerKey: owner,
          receiptVersion: done.receiptVersion,
        })
      ).body;
      expect(ack).toMatchObject({ acknowledged: true, ackedVersion: done.receiptVersion });
      expect((await api(mf, "GET", `changes?ownerKey=${owner}&after=0`)).body).toEqual(feed.body);
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      const again = (
        await api(mf, "POST", "occurrences/k1/ack", {
          ownerKey: owner!,
          receiptVersion: done!.receiptVersion,
        })
      ).body;
      expect(again.firstAckAt).toBe(ack!.firstAckAt);
      const deadline = Date.parse(ack!.purgeAt);
      expect(deadline).toBe(
        Math.min(Date.parse(done!.finishedAt) + 180 * DAY, Date.parse(ack!.firstAckAt) + 90 * DAY),
      );
      const call = await direct(mf);
      expect(
        (await call({ op: "status", ownerKey: owner!, occurrenceId: "k1", now: deadline - 1 }))
          .occurrence.state,
      ).toBe("done");
      const gone = await call({
        op: "status",
        ownerKey: owner!,
        occurrenceId: "k1",
        now: deadline + PURGE_EVERY_MS,
      });
      expect(gone).toEqual({
        ownerKey: owner!,
        occurrenceId: "k1",
        state: "pruned",
        payloadDigest: done!.payloadDigest,
        prunedAt: new Date(deadline + PURGE_EVERY_MS).toISOString(),
      });
      // Nonterminal work is never purged.
      expect(
        (
          await call({
            op: "status",
            ownerKey: owner!,
            occurrenceId: "keep",
            now: deadline + 1000 * DAY,
          })
        ).occurrence.state,
      ).toBe("pending");
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      // The tombstone is permanent: status, resubmit and ack after another restart.
      expect((await api(mf, "GET", `occurrences/k1?ownerKey=${owner!}`)).body.state).toBe("pruned");
      expect((await submit(mf, done!.body)).body).toMatchObject({
        error: "pruned",
        occurrenceId: "k1",
      });
      expect(
        (
          await api(mf, "POST", "occurrences/k1/ack", {
            ownerKey: owner!,
            receiptVersion: done!.receiptVersion,
          })
        ).status,
      ).toBe(410);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("DT-7B-R1 admission interval through the real router: first registration, long gap, delayed old epoch, equal bounds, restart replay", async () => {
    const dir = freshDir();
    let mf = runtime(dir);
    const N = Date.now();
    const accepted: Record<string, A> = {};
    const refusedIds = ["f-day", "e1-1ms", "e1-cut1", "gap-e2", "e2-1ms"];
    let owner = "";
    let w1: A[] = [];
    let feed: A;
    const send = (id: string, o: { at: number; epoch?: number; wf?: string }) =>
      submit(mf, body(owner, id, [idea("a1")], o));
    try {
      owner = (await api(mf, "GET", "authority")).body.ownerKey as string;
      // w1's history straight on the object with chosen clocks: opened N−5 d, closed N−4 d, re-opened N−1 d.
      const call = await direct(mf);
      const ctl = (c: A, now: number) => call({ ownerKey: owner, workflowId: "w1", ...c, now });
      await ctl(
        { op: "register", expectedEpoch: 0, revision: 1, workflowDigest: DIG },
        N - 5 * DAY,
      );
      await ctl({ op: "unregister", registrationEpoch: 1, expectedRevision: 1 }, N - 4 * DAY);
      w1 = (
        await ctl({ op: "register", expectedEpoch: 1, revision: 1, workflowDigest: DIG }, N - DAY)
      ).registration.epochs;
      const [open1, cut1, open2] = [w1[0].openedAt, w1[0].closedAt, w1[1].openedAt].map(Date.parse);
      expect([open1, cut1, open2]).toEqual([N - 5 * DAY, N - 4 * DAY, N - DAY]);
      // First registration through the router (Worker clock): a day-old event is not cloud-owned.
      const r2 = await api(mf, "POST", "registrations", {
        ownerKey: owner,
        workflowId: "w2",
        expectedEpoch: 0,
        revision: 1,
        workflowDigest: DIG,
      });
      const open3 = Date.parse(r2.body.registration.epochs[0].openedAt);
      const refusal = (wf: string) => ({
        status: 409,
        body: { error: "not_registered", ownerKey: owner, workflowId: wf },
      });
      expect(await send("f-day", { wf: "w2", at: open3 - DAY })).toEqual(refusal("w2"));
      expect(await send("e1-1ms", { at: open1 - 1 })).toEqual(refusal("w1"));
      expect(await send("e1-cut1", { at: cut1 + 1 })).toEqual(refusal("w1"));
      expect(await send("gap-e2", { epoch: 2, at: N - 3 * DAY })).toEqual(refusal("w1"));
      expect(await send("e2-1ms", { epoch: 2, at: open2 - 1 })).toEqual(refusal("w1"));
      for (const [id, o] of [
        ["e1-open", { at: open1 }],
        ["e1-cut", { at: cut1 }], // a delayed old-epoch event, after the later registration
        ["e2-open", { epoch: 2, at: open2 }],
        ["f-open", { wf: "w2", at: open3 }],
      ] as const) {
        const r = await send(id, o);
        expect(r).toMatchObject({ status: 201, body: { created: true } });
        accepted[id] = r.body.occurrence;
      }
      expect(accepted["e1-cut"].registrationEpoch).toBe(1);
      for (const id of refusedIds)
        expect((await api(mf, "GET", `occurrences/${id}?ownerKey=${owner}`)).body.state).toBe(
          "absent",
        );
      feed = (await api(mf, "GET", `changes?ownerKey=${owner}&after=0`)).body;
      expect(feed.items.map((i: A) => i.occurrenceId)).toEqual(Object.keys(accepted));
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      // After a restart: identical replays answer created:false with the stored row; refusals stay refused.
      for (const [id, o] of Object.entries(accepted)) {
        const r = await submit(mf, o.body);
        expect(r).toMatchObject({ status: 200, body: { created: false } });
        expect(r.body.occurrence).toEqual(o);
        expect(id).toBe(o.occurrenceId);
      }
      expect((await send("gap-e2", { epoch: 2, at: N - 3 * DAY })).status).toBe(409);
      expect((await api(mf, "GET", `changes?ownerKey=${owner}&after=0`)).body).toEqual(feed!);
    } finally {
      await mf.dispose();
    }
  }, 120_000);
});
