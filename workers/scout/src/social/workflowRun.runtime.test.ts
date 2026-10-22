import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skills } from "@/data";
import { buildOutput, previewRun, workflowOutputId } from "@/lib/workflows";
import { dayKey, weekKey } from "@/lib/streak";
import { buildWeekPlan } from "@/lib/weekPlan";
import { WORKFLOW_OBJECT } from "./workflowCoordinator";
import { canonicalJson, sha256Hex } from "./workflowProtocol";

// ⚙️ DT-7B-2 runtime proof (planning/tools/38-cloud-workflows.md): the REAL adapter (workflowRun.ts → lib/workflows
// buildOutput, bundled from src/index.ts with the Worker's `@/*` resolver) executes INSIDE workerd, through the real
// router (bearer, origin, routes.ts, workflowRoutes.ts) → the WORKFLOW_COORDINATOR binding (wrangler.jsonc, migration
// "v5-workflows") → SQLite persisted on disk across runtime restarts. Every expected record is computed here, on the
// Node host, by the app's own previewRun/buildOutput; the workerd outputs must be byte-equal. Every outbound request is
// refused and recorded: none is expected (zero external effects). Direct object calls only register with a chosen
// clock and, for restart cases, commit a step with the host-built record (a crash between steps).

const requireRuntime = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireRuntime("miniflare");
const { build } = requireRuntime("esbuild");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "runtime-scout-token";
const APP = "https://3zmd95-glitch.github.io";
const DIG = "e".repeat(64);
const REG = Date.parse("2026-10-01T00:00:00.000Z");
const AT = "2026-10-17T09:00:00.000Z"; // Saturday 12:00 Riyadh
const SKILL = "iphone-log-prores";

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let script = "";
let durableObjects: Record<string, { className: string; useSQLite: boolean }> = {};
const dirs: string[] = [];
const outbound: string[] = [];

beforeAll(async () => {
  const wrangler = await import("wrangler");
  const config = wrangler.unstable_readConfig({ config: join(ROOT, "wrangler.jsonc") });
  const sqlite = wrangler.unstable_getDurableObjectClassNameToUseSQLiteMap(config.migrations);
  expect(config.durable_objects.bindings.at(-1)).toEqual({
    name: "WORKFLOW_COORDINATOR",
    class_name: "WorkflowCoordinator",
  });
  expect(config.migrations.at(-1)).toEqual({
    tag: "v5-workflows",
    new_sqlite_classes: ["WorkflowCoordinator"],
  });
  durableObjects = Object.fromEntries(
    config.durable_objects.bindings.map((b: { name: string; class_name: string }) => [
      b.name,
      { className: b.class_name, useSQLite: sqlite.get(b.class_name) === true },
    ]),
  );
  // The same bundling as the other runtime tests: no extra resolver option; tsconfig paths resolve `@/…`.
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
      bindings: { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP },
      outboundService: async (request: Request) => {
        outbound.push(`${request.method} ${request.url}`);
        return new Response("blocked", { status: 599 });
      },
    }),
  );
}
type MF = ReturnType<typeof runtime>;
const freshDir = () => {
  const d = mkdtempSync(join(tmpdir(), "workflow-run-"));
  dirs.push(d);
  return d;
};

async function api(
  mf: MF,
  method: string,
  path: string,
  json?: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` },
) {
  const res = await mf.dispatchFetch(`https://scout.test/social/workflows/${path}`, {
    method,
    headers,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
  const text = await res.text();
  return { status: res.status as number, body: (text ? JSON.parse(text) : null) as A, raw: text };
}
async function direct(mf: MF) {
  const ns = await mf.getDurableObjectNamespace("WORKFLOW_COORDINATOR");
  const stub = ns.get(ns.idFromName(WORKFLOW_OBJECT));
  return async (c: A): Promise<A> =>
    (await (
      await stub.fetch("https://workflow-coordinator/", { method: "POST", body: JSON.stringify(c) })
    ).json()) as A;
}

const t = (en: string, ar = "") => ({ ar, en });
const I = (id: string, text = t("Idea: {title} ({date})", "فكرة: {title}")) => ({
  id,
  kind: "idea",
  text,
});
const S = (id: string, platform = "tiktok") => ({
  id,
  kind: "post",
  platform,
  title: t("{title}", "{title} بالعربي"),
  caption: t("{summary} /{slug}", "{summary} — {slug}"),
  offsetDays: 1,
});
const P = (id: string, o: A = {}) => ({
  id,
  kind: "plan",
  quest: "produce",
  minutes: 60,
  day: "lightest",
  skillId: SKILL,
  ...o,
});

function body(
  owner: string,
  id: string,
  actions: A[],
  o: { at?: string; lang?: string; ctx?: A } = {},
): A {
  const at = o.at ?? AT;
  const day = dayKey(new Date(at));
  return {
    occurrenceId: id,
    ownerKey: owner,
    workflowId: "w1",
    kind: "article-ready",
    registrationEpoch: 1,
    revision: 1,
    snapshot: { name: t("Flow"), trigger: { kind: "article-ready" }, actions },
    plannerContext: actions.some((a) => a.kind === "plan")
      ? {
          targetWeek: weekKey(day),
          completions: [],
          planItems: [],
          settings: { gear: ["phone"], davinciEdition: "free" },
          contextAt: at,
          ...o.ctx,
        }
      : null,
    input: {
      articleId: "art1",
      title: t("Log footage", "تصوير لوق"),
      summary: t("Shoot flat, grade later", "صوّر مسطح ولوّن بعدين"),
      slug: "log-footage",
      skillId: SKILL,
      lang: o.lang ?? "en",
      day,
    },
    executionAt: at,
  };
}
const submit = async (mf: MF, b: A) => {
  const r = await api(mf, "POST", "occurrences", {
    body: b,
    payloadDigest: await sha256Hex(canonicalJson(b)),
  });
  expect(r.status).toBe(201);
  return r.body.occurrence as A;
};
const runOf = (mf: MF, owner: string, id: string) =>
  api(mf, "POST", `occurrences/${id}/run`, { ownerKey: owner });
const statusOf = async (mf: MF, owner: string, id: string) =>
  (await api(mf, "GET", `occurrences/${id}?ownerKey=${owner}`)).body.occurrence as A;

/** The app's own records for this body on the Node host (previewRun, ids mapped), as canonical bytes. */
function host(b: A): (string | null)[] {
  const pc = b.plannerContext;
  const { outputs } = previewRun(
    { ...b.snapshot } as never,
    b.input,
    {
      completions: pc?.completions ?? [],
      planItems: pc?.planItems ?? [],
      settings: pc?.settings ?? { gear: [], davinciEdition: "free" },
    } as never,
    new Date(b.executionAt),
  );
  return outputs.map((s) =>
    s.ok ? canonicalJson({ ...s.record, id: workflowOutputId(b.occurrenceId, s.actionId) }) : null,
  );
}
const stored = (o: A) => o.outputs.map((x: A) => canonicalJson(x.record));
const built = (b: A) => host(b).filter((x): x is string => x !== null);

/** Authority + a registration opened at REG (a chosen clock, straight on the object), so fixed executionAt values admit. */
async function ready(mf: MF) {
  const owner = (await api(mf, "GET", "authority")).body.ownerKey as string;
  const reg = await (
    await direct(mf)
  )({
    op: "register",
    ownerKey: owner,
    workflowId: "w1",
    expectedEpoch: 0,
    revision: 1,
    workflowDigest: DIG,
    now: REG,
  });
  expect(reg.created).toBe(true);
  return owner;
}
/** A crash between steps: the next pending step committed with the HOST-built record, then the runtime disposed. */
async function commitHost(mf: MF, owner: string, id: string) {
  const call = await direct(mf);
  const o = (await call({ op: "status", ownerKey: owner, occurrenceId: id, now: Date.now() }))
    .occurrence;
  const idx = o.steps.findIndex((s: A) => s.status === "pending");
  const folded = o.outputs.filter((x: A) => x.kind === "plan").map((x: A) => x.record);
  const out = buildOutput(
    id,
    o.body.snapshot.actions[idx],
    o.body.input,
    {
      completions: o.body.plannerContext?.completions ?? [],
      planItems: [...(o.body.plannerContext?.planItems ?? []), ...folded],
      settings: o.body.plannerContext?.settings ?? {},
    } as never,
    new Date(o.body.executionAt),
  );
  expect(out.ok).toBe(true);
  const r = await call({
    op: "commitStep",
    ownerKey: owner,
    occurrenceId: id,
    idx,
    receiptVersion: o.receiptVersion,
    payloadDigest: o.payloadDigest,
    output: { record: out.ok ? out.record : null },
    now: Date.now(),
  });
  expect(r.committed).toBe(true);
}

describe("DT-7B-2: the real shared builders run inside workerd through POST /social/workflows/occurrences/:id/run", () => {
  it("the bundle carries the builders and the catalog; idea/post/plan, EN/AR, overlays/history and Riyadh rollover are byte-equal to the host", async () => {
    expect(script).toContain("function buildOutput(");
    expect(script).toContain("function lightestDay(");
    expect(script).toContain(`"${SKILL}"`);
    const mf = runtime(freshDir());
    try {
      const owner = await ready(mf);
      const week = weekKey(dayKey(new Date(AT)));
      const settings = { gear: ["phone", "mic"], davinciEdition: "studio" };
      const derived = buildWeekPlan({
        skills,
        completions: [],
        settings: settings as never,
        weekStart: week,
      }).items;
      const ctx = {
        completions: [{ skillId: SKILL, quest: "research", at: "2026-10-03T08:00:00.000Z" }],
        planItems: [
          {
            id: derived[0].id,
            week,
            day: derived[0].day,
            skillId: derived[0].skillId,
            quest: derived[0].quest,
            minutes: 0,
            by: "rules",
          },
          {
            id: `${week}:me:${SKILL}:train`,
            week,
            day: 3,
            skillId: SKILL,
            quest: "train",
            minutes: 90,
            by: "me",
          },
        ],
        settings,
      };
      const bodies = [
        body(owner, "ar-en", [I("i1"), S("s1"), P("p1"), P("p2", { minutes: 120 })], { ctx }),
        body(owner, "ar-ar", [I("i1"), I("i2", t("Only English {slug}")), S("s1", "youtube")], {
          lang: "ar",
        }),
        body(owner, "ar-fri", [I("i1"), S("s1", "x"), P("p1")], { at: "2026-10-16T20:59:59.999Z" }),
        body(owner, "ar-sat", [I("i1"), S("s1", "x"), P("p1")], { at: "2026-10-16T21:00:00.000Z" }),
      ];
      for (const b of bodies) {
        await submit(mf, b);
        const r = await runOf(mf, owner, b.occurrenceId);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({
          ownerKey: owner,
          committed: b.snapshot.actions.length,
          stopped: "terminal",
          occurrence: { state: "done" },
        });
        expect(stored(r.body.occurrence)).toEqual(built(b));
        expect(r.body.occurrence.outputs.map((x: A) => x.outputId)).toEqual(
          b.snapshot.actions.map((a: A) => `wf:${b.occurrenceId}:${a.id}`),
        );
      }
      // Rollover: each in its own Riyadh day and planner week (computed inside workerd).
      const fri = await statusOf(mf, owner, "ar-fri");
      const sat = await statusOf(mf, owner, "ar-sat");
      expect([fri.outputs[2].record.week, sat.outputs[2].record.week]).toEqual([
        "2026-10-10",
        "2026-10-17",
      ]);
      expect([fri.outputs[1].record.plannedDay, sat.outputs[1].record.plannedDay]).toEqual([
        "2026-10-17",
        "2026-10-18",
      ]);
      // Receipts and the feed still validate through the routes.
      const feed = await api(mf, "GET", `changes?ownerKey=${owner}&after=0`);
      expect(feed.status).toBe(200);
      expect(feed.body.items.map((i: A) => `${i.occurrenceId}:${i.state}`)).toEqual(
        bodies.map((b) => `${b.occurrenceId}:done`),
      );
      expect(outbound).toEqual([]);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("fail-fast with the builder's codes inside workerd: unknown skill → partial, earlier output kept, later skipped", async () => {
    const mf = runtime(freshDir());
    try {
      const owner = await ready(mf);
      const b = body(owner, "ar-ff", [I("i1"), P("p1", { skillId: "no-such-skill" }), S("s1")]);
      await submit(mf, b);
      const r = await runOf(mf, owner, "ar-ff");
      expect(r.body).toMatchObject({
        committed: 2,
        stopped: "terminal",
        occurrence: { state: "partial" },
      });
      expect(r.body.occurrence.steps.map((s: A) => [s.status, s.error ?? null])).toEqual([
        ["done", null],
        ["failed", "unknown-skill"],
        ["skipped", null],
      ]);
      expect(host(b)).toEqual([stored(r.body.occurrence)[0], null, null]);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("concurrent resumes, a lost answer and terminal replay: each step once, one terminal row, nothing rewritten", async () => {
    const dir = freshDir();
    let mf = runtime(dir);
    let owner = "";
    let end: A;
    const b = (o: string) => body(o, "ar-cc", [I("i1"), P("p1"), I("i2"), S("s1"), P("p2")]);
    try {
      owner = await ready(mf);
      await submit(mf, b(owner));
      const all = await Promise.all([1, 2, 3].map(() => runOf(mf, owner, "ar-cc")));
      end = await statusOf(mf, owner, "ar-cc");
      expect(end).toMatchObject({ state: "done", receiptVersion: 7 });
      expect(all.reduce((n, r) => n + r.body.committed, 0)).toBe(5);
      for (const r of all) {
        expect(r.status).toBe(200);
        expect(["terminal", "contention"]).toContain(r.body.stopped);
        if (r.body.stopped === "terminal") expect(r.body.occurrence).toEqual(end);
      }
      expect(stored(end)).toEqual(built(b(owner)));
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      // After a restart the answer that may have been lost is replayed: the same row, nothing committed or bumped.
      const again = await runOf(mf, owner, "ar-cc");
      expect(again.body).toEqual({
        ownerKey: owner,
        occurrence: end!,
        committed: 0,
        stopped: "terminal",
      });
      const feed = await api(mf, "GET", `changes?ownerKey=${owner}&after=0`);
      expect(feed.body.items).toHaveLength(1);
      expect(feed.body.items[0].changeSeq).toBe(end!.changeSeq);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("restart before the first step, between steps and before finish: committed outputs adopted, the rest built in workerd, byte-equal", async () => {
    const dir = freshDir();
    let mf = runtime(dir);
    let owner = "";
    let first: A;
    const mid = (o: string) => body(o, "ar-mid", [I("i1"), P("p1"), P("p2")]);
    const fin = (o: string) => body(o, "ar-fin", [I("i1"), S("s1")]);
    const zero = (o: string) => body(o, "ar-zero", [P("p1"), I("i1")]);
    try {
      owner = await ready(mf);
      await submit(mf, mid(owner));
      await commitHost(mf, owner, "ar-mid");
      first = (await statusOf(mf, owner, "ar-mid")).outputs[0];
      await submit(mf, fin(owner));
      await commitHost(mf, owner, "ar-fin");
      await commitHost(mf, owner, "ar-fin");
      await submit(mf, zero(owner));
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir);
    try {
      const r = await runOf(mf, owner, "ar-mid");
      expect(r.body).toMatchObject({
        committed: 2,
        stopped: "terminal",
        occurrence: { state: "done" },
      });
      expect(r.body.occurrence.outputs[0]).toEqual(first!);
      expect(stored(r.body.occurrence)).toEqual(built(mid(owner)));
      const f = await runOf(mf, owner, "ar-fin");
      expect(f.body).toMatchObject({
        committed: 0,
        stopped: "terminal",
        occurrence: { state: "done", receiptVersion: 4 },
      });
      expect(stored(f.body.occurrence)).toEqual(built(fin(owner)));
      // Pending before the restart: resumed at idx 0, one output per action.
      const z = await runOf(mf, owner, "ar-zero");
      expect(z.body).toMatchObject({
        committed: 2,
        stopped: "terminal",
        occurrence: { state: "done" },
      });
      expect(stored(z.body.occurrence)).toEqual(built(zero(owner)));
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("pause gates the first step (also after unregister); resume runs it; running work finishes while paused; cancel races stay consistent", async () => {
    const mf = runtime(freshDir());
    try {
      const owner = await ready(mf);
      const ctl = (verb: string) =>
        api(mf, "POST", `registrations/w1/${verb}`, {
          ownerKey: owner,
          registrationEpoch: 1,
          expectedRevision: 1,
        });
      await ctl("pause");
      await submit(mf, body(owner, "ar-p", [I("i1"), I("i2")]));
      const paused = await runOf(mf, owner, "ar-p");
      expect(paused.body).toMatchObject({
        committed: 0,
        stopped: "paused",
        occurrence: { state: "pending", receiptVersion: 1 },
      });
      await ctl("unregister");
      expect((await runOf(mf, owner, "ar-p")).body.stopped).toBe("paused");
      await ctl("resume");
      expect((await runOf(mf, owner, "ar-p")).body).toMatchObject({
        committed: 2,
        stopped: "terminal",
        occurrence: { state: "done" },
      });
      // Running work (a step already committed) finishes while paused.
      await submit(mf, body(owner, "ar-r", [I("i1"), S("s1")]));
      await commitHost(mf, owner, "ar-r");
      await ctl("pause");
      expect((await runOf(mf, owner, "ar-r")).body).toMatchObject({
        committed: 1,
        stopped: "terminal",
        occurrence: { state: "done" },
      });
      await ctl("resume");
      // Cancel racing a run: cancelled with zero outputs, or done with every output — never both.
      await submit(mf, body(owner, "ar-c", [I("i1"), I("i2")]));
      const [c, r] = await Promise.all([
        api(mf, "POST", "occurrences/ar-c/cancel", { ownerKey: owner }),
        runOf(mf, owner, "ar-c"),
      ]);
      expect(r.status).toBe(200);
      const end = await statusOf(mf, owner, "ar-c");
      expect(r.body.occurrence).toEqual(end);
      if (end.state === "cancelled") {
        expect(end.outputs).toEqual([]);
        expect(r.body.committed).toBe(0);
        expect(c.body.cancelled).toBe(true);
      } else {
        expect(end.state).toBe("done");
        expect(end.outputs).toHaveLength(2);
        expect([200, 409]).toContain(c.status);
      }
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("unauthenticated, cross-origin and extra-field invocations are refused with zero mutation", async () => {
    const mf = runtime(freshDir());
    try {
      const owner = await ready(mf);
      await submit(mf, body(owner, "ar-x", [I("i1")]));
      const path = "occurrences/ar-x/run";
      expect((await api(mf, "POST", path, { ownerKey: owner }, {})).status).toBe(401);
      expect(
        (await api(mf, "POST", path, { ownerKey: owner }, { Authorization: "Bearer wrong" }))
          .status,
      ).toBe(401);
      const evil = await api(
        mf,
        "POST",
        path,
        { ownerKey: owner },
        {
          Authorization: `Bearer ${TOKEN}`,
          Origin: "https://evil.example",
        },
      );
      expect(evil.status).toBe(403);
      expect(evil.raw).not.toContain(owner);
      for (const extra of [{ builder: "test" }, { output: { record: {} } }, { now: 1 }])
        expect((await api(mf, "POST", path, { ownerKey: owner, ...extra })).status).toBe(400);
      expect((await api(mf, "POST", `${path}?builder=test`, { ownerKey: owner })).status).toBe(400);
      expect(await statusOf(mf, owner, "ar-x")).toMatchObject({
        state: "pending",
        receiptVersion: 1,
      });
      // The allowed origin with the bearer runs it.
      const ok = await api(
        mf,
        "POST",
        path,
        { ownerKey: owner },
        {
          Authorization: `Bearer ${TOKEN}`,
          Origin: APP,
        },
      );
      expect(ok.body).toMatchObject({ committed: 1, stopped: "terminal" });
      expect(outbound).toEqual([]);
    } finally {
      await mf.dispose();
    }
  }, 120_000);
});
