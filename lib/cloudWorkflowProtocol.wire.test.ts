import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkflowAction } from "@/lib/domain";
import {
  ACK_RETENTION_MS,
  ackRequestFor,
  adoptionProofOf,
  CHANGES_LIMIT_MAX,
  describeRequest,
  EPOCHS_MAX,
  FINISH_RETENTION_MS,
  isVerifiedReceipt,
  parseAnswer,
  readyOccurrenceId,
  RUN_COMMITS_MAX,
  submitRequestOf,
  type CloudRequest,
  type Parsed,
} from "./cloudWorkflowProtocol";
import {
  buildCloudSnapshot,
  previewCloudRun,
  type CloudSnapshotParams,
} from "./cloudWorkflowSnapshot";

// ⚙️ DT-7C-1 wire fixtures (planning/tools/38-cloud-workflows.md). Every answer parsed here is the REAL answer of
// the real `scout.handle` router over the actual SQLite WorkflowCoordinator (fake in-memory transport, the same
// harness as the Worker's own route tests). Requests are the app's own descriptors (method/path/body only); the
// bearer/origin headers are added by THIS harness, never by the descriptors. Bodies come from the app's own
// buildCloudSnapshot, so the snapshot -> Worker admission -> parser chain is exercised end to end.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The real Worker router and coordinator are loaded DYNAMICALLY with a computed specifier: a static import would pull
// the whole Worker source (Cloudflare-typed: DurableObjectNamespace, KVNamespace, ExecutionContext...) into the app's
// `tsc --noEmit` program, which the app tsconfig (exclude: workers) cannot type. At run time vitest resolves the
// same files through the same "@" alias; no config is touched and no Worker file is copied.
const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec); // eslint-disable-line @typescript-eslint/no-explicit-any
type Env = Record<string, unknown>;
let handle: (
  req: Request,
  env: Env,
  ctx: undefined,
  deps: { now: () => Date },
) => Promise<Response>;
let WorkflowCoordinator: new (state: never) => { fetch(req: Request): Promise<Response> };
let W: {
  ACK: number;
  CHANGES: number;
  EPOCHS: number;
  FINISH: number;
  RUN: number;
  WORKFLOW_OBJECT: string;
  purgeAt: (f: number, a: number | null) => number;
};

const TOKEN = "wire-scout-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://scout.test";
const NOW = new Date("2026-10-17T09:05:00.000Z");
const T = NOW.getTime();
const AT = "2026-10-17T09:00:00.000Z"; // Saturday 12:00 Riyadh
const DIG = "e".repeat(64);
const SKILL = "iphone-log-prores";

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
const makeEnv = (ns: Fake | null = fakeNamespace()): Env => ({
  SCOUT_TOKEN: TOKEN,
  ALLOWED_ORIGINS: APP,
  ...(ns ? { WORKFLOW_COORDINATOR: ns } : {}),
});
const nsOf = (env: Env) => env.WORKFLOW_COORDINATOR as unknown as Fake;

interface Wire {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function raw(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  now = NOW,
  auth = true,
): Promise<Wire> {
  const headers = new Headers({ Origin: APP });
  if (auth) headers.set("Authorization", `Bearer ${TOKEN}`);
  const res = await handle(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    }),
    env,
    undefined,
    { now: () => now },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

interface Cap {
  name: string;
  req: CloudRequest;
  wire: Wire;
  parsed: Parsed;
}
const captured: Cap[] = [];
const cap = (n: string) => {
  const c = captured.find((x) => x.name === n);
  if (!c) throw new Error(`no capture ${n}`);
  return c;
};

/** The app's descriptor -> the real router -> the app's parser. Records the exchange as a fixture. */
async function exchange(
  env: Env,
  name: string,
  req: CloudRequest,
  now = NOW,
  store = true,
): Promise<Cap> {
  const d = describeRequest(req);
  if (!d.ok) throw new Error(`descriptor refused ${name}`);
  const wire = await raw(env, d.descriptor.method, d.descriptor.path, d.descriptor.body, now);
  const parsed = await parseAnswer(req, wire, { origin: BASE });
  const c = { name, req, wire, parsed };
  if (store) captured.push(c);
  return c;
}

const t = (en: string, ar = "") => ({ ar, en });
const idea = (id: string, text = t("Idea {date}", "فكرة {date}")): WorkflowAction =>
  ({ id, kind: "idea", text }) as WorkflowAction;
const post = (id: string): WorkflowAction =>
  ({
    id,
    kind: "post",
    platform: "tiktok",
    title: t("post {date}"),
    caption: t("cap"),
    offsetDays: 1,
  }) as WorkflowAction;
const plan = (id: string, o: A = {}): WorkflowAction =>
  ({
    id,
    kind: "plan",
    quest: "produce",
    minutes: 30,
    day: "lightest",
    skillId: SKILL,
    ...o,
  }) as WorkflowAction;

let owner = "";
let env: Env;

async function bodyOf(id: string, actions: WorkflowAction[], o: A = {}) {
  const ready = o.ready ?? false;
  const params: CloudSnapshotParams = {
    ownerKey: o.owner ?? owner,
    occurrenceId: id,
    registrationEpoch: o.epoch ?? 1,
    revision: o.revision ?? 1,
    executionAt: AT,
    workflow: {
      id: o.workflowId ?? "w1",
      name: t("Flow", "سير"),
      trigger: { kind: ready ? "article-ready" : "manual" },
      actions,
    },
    lang: o.lang ?? "en",
    ...(ready
      ? {
          article: {
            id: "art1",
            title: t("Log on iPhone", "تصوير لوق"),
            summary: t("Why log", "ليش لوق"),
            slug: "log-iphone",
            skillId: SKILL,
          },
        }
      : {}),
    ...(actions.some((a) => a.kind === "plan")
      ? {
          planner: {
            completions: [{ skillId: SKILL, quest: "train", at: "2026-10-16T20:00:00+03:00" }],
            planItems: [
              {
                id: "pi1",
                week: "2026-10-17",
                day: 0,
                skillId: SKILL,
                quest: "train",
                minutes: 0,
                by: "me",
              },
              {
                id: "pi2",
                week: "2026-10-17",
                day: 1,
                skillId: SKILL,
                quest: "train",
                minutes: 60,
                by: "me",
              },
            ],
            settings: { gear: ["phone"], davinciEdition: "free" },
            contextAt: AT,
          },
        }
      : {}),
  } as CloudSnapshotParams;
  const r = await buildCloudSnapshot(params);
  if (!r.ok) throw new Error(`snapshot refused ${id}: ${r.reason}`);
  return r.snapshot;
}
const submit = async (name: string, id: string, actions: WorkflowAction[], o: A = {}) => {
  const s = await bodyOf(id, actions, o);
  const sub = await submitRequestOf(s.body);
  if (!sub.ok) throw new Error("submit request");
  return exchange(env, name, sub.request);
};

/** Test-only direct commit of the next pending idea step (only `run` executes through a route). */
async function commitIdea(id: string, error?: string) {
  const stub = nsOf(env).get(nsOf(env).idFromName(W.WORKFLOW_OBJECT));
  const call = async (c: A): Promise<A> =>
    (await (
      await stub.fetch("https://c/", { method: "POST", body: JSON.stringify(c) })
    ).json()) as A;
  const o = (await call({ op: "status", ownerKey: owner, occurrenceId: id, now: T })).occurrence;
  const idx = o.steps.findIndex((s: A) => s.status === "pending");
  const action = o.body.snapshot.actions[idx];
  const output = error
    ? { error }
    : {
        record: {
          id: `wf:${id}:${action.id}`,
          text: "idea",
          source: "workflow",
          createdAt: o.body.executionAt,
        },
      };
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

const reg = (o: A = {}): CloudRequest =>
  ({
    kind: "register",
    ownerKey: owner,
    workflowId: "w1",
    expectedEpoch: 0,
    revision: 1,
    workflowDigest: DIG,
    ...o,
  }) as CloudRequest;
const ctl = (kind: string, o: A = {}): CloudRequest =>
  ({
    kind,
    ownerKey: owner,
    workflowId: "w2",
    registrationEpoch: 1,
    expectedRevision: 1,
    ...o,
  }) as CloudRequest;
const run = (id: string, o: A = {}): CloudRequest =>
  ({ kind: "run", ownerKey: owner, occurrenceId: id, ...o }) as CloudRequest;
const status = (id: string, o: A = {}): CloudRequest =>
  ({ kind: "status", ownerKey: owner, occurrenceId: id, ...o }) as CloudRequest;
const cancel = (id: string): CloudRequest => ({
  kind: "cancel",
  ownerKey: owner,
  occurrenceId: id,
});
const ack = (id: string, v: number): CloudRequest => ({
  kind: "ack",
  ownerKey: owner,
  occurrenceId: id,
  receiptVersion: v,
});

beforeAll(async () => {
  handle = (await load("@/workers/scout/src/scout")).handle;
  const co = await load("@/workers/scout/src/social/workflowCoordinator");
  WorkflowCoordinator = co.WorkflowCoordinator;
  W = {
    ACK: co.ACK_RETENTION_MS,
    CHANGES: co.CHANGES_LIMIT_MAX,
    EPOCHS: co.EPOCHS_MAX,
    FINISH: co.FINISH_RETENTION_MS,
    RUN: co.RUN_COMMITS_MAX,
    WORKFLOW_OBJECT: co.WORKFLOW_OBJECT,
    purgeAt: co.purgeAt,
  };
  env = makeEnv();
  // 1. authority
  const a = await exchange(env, "authority", { kind: "authority" });
  if (a.parsed.outcome !== "ok" || a.parsed.kind !== "authority") throw new Error("authority");
  owner = a.parsed.authority.ownerKey;

  // 2. registrations: created, replay, typed conflicts, control lifecycle, re-register
  const early = new Date(T - 10 * 60_000);
  await exchange(env, "register.created", reg(), early);
  await exchange(env, "register.replay", reg(), early);
  await exchange(env, "register.conflict.row", reg({ expectedEpoch: 1 }));
  await exchange(env, "register.conflict.null", reg({ workflowId: "w5", expectedEpoch: 1 }));
  await exchange(env, "update.changed", {
    kind: "update",
    ownerKey: owner,
    workflowId: "w1",
    registrationEpoch: 1,
    expectedRevision: 1,
    revision: 2,
    workflowDigest: "f".repeat(64),
  });
  await exchange(env, "update.replay", {
    kind: "update",
    ownerKey: owner,
    workflowId: "w1",
    registrationEpoch: 1,
    expectedRevision: 1,
    revision: 2,
    workflowDigest: "f".repeat(64),
  });
  await exchange(env, "update.conflict", {
    kind: "update",
    ownerKey: owner,
    workflowId: "w1",
    registrationEpoch: 1,
    expectedRevision: 0,
    revision: 3,
    workflowDigest: DIG,
  });
  await exchange(env, "register.w2", reg({ workflowId: "w2" }), early);
  await exchange(env, "pause.changed", ctl("pause"));
  await exchange(env, "pause.replay", ctl("pause"));
  await exchange(env, "resume.changed", ctl("resume"));
  await exchange(env, "pause.conflict", ctl("pause", { expectedRevision: 9 }));
  await exchange(env, "resume.not_registered", ctl("resume", { workflowId: "w9" }));
  await exchange(env, "unregister.changed", ctl("unregister"));
  await exchange(env, "unregister.replay", ctl("unregister"));
  await exchange(
    env,
    "register.again",
    reg({ workflowId: "w2", expectedEpoch: 1, revision: 4 }),
    early,
  );
  await exchange(
    env,
    "register.again.replay",
    reg({ workflowId: "w2", expectedEpoch: 1, revision: 4 }),
    early,
  );
  await exchange(env, "register.w3", reg({ workflowId: "w3" }), early);
  await exchange(env, "pause.w3", ctl("pause", { workflowId: "w3" }));

  // 3. submit: created, replay, typed refusals
  await submit("submit.created", "pend", [idea("a1"), idea("a2")]);
  await submit("submit.replay", "pend", [idea("a1"), idea("a2")]);
  await submit("submit.conflict", "pend", [idea("a1"), idea("a9")]);
  const s = await bodyOf("lie", [idea("a1")]);
  await exchange(env, "submit.digest_mismatch", {
    kind: "submit",
    body: s.body,
    payloadDigest: "d".repeat(64),
  });
  await submit("submit.not_registered", "nr1", [idea("a1")], { workflowId: "w9" });
  await submit("submit.unknown_epoch", "ue1", [idea("a1")], { epoch: 3 });
  await submit("submit.registration_behind", "rb1", [idea("a1")], { revision: 9 });
  await submit("submit.authority_mismatch", "am1", [idea("a1")], {
    owner: "wfo_" + "2".repeat(32),
  });
  nsOf(env).db.exec(`INSERT INTO tombstones VALUES ('old', '${"a".repeat(64)}', 0)`);
  await submit("submit.pruned", "old", [idea("a1")]);

  // 4. executions through the real run route (real builders) and the test-only direct commits
  await submit("sub.run1", "run1", [idea("a1"), idea("a2")]);
  await commitIdea("run1");
  await submit("sub.runf", "runf", [idea("a1"), idea("a2"), idea("a3")]);
  await commitIdea("runf");
  await commitIdea("runf", "context-stale");
  await submit("sub.done", "done", [idea("a1"), plan("p1"), plan("p2"), post("s1")]);
  await submit(
    "sub.ready",
    await readyOccurrenceId("w1", "art1", "commit-1").then((v) => v!),
    [idea("a1", t("{title} / {summary}", "{title}")), plan("p1"), post("s1")],
    { ready: true },
  );
  await submit("sub.partial", "part", [
    idea("a1"),
    plan("p1", { skillId: "no-such-skill" }),
    post("s1"),
  ]);
  await submit("sub.failed", "fail", [plan("p1", { skillId: undefined }), idea("a1")]);
  await submit("sub.canc", "canc", [idea("a1")]);
  await submit("sub.ackd", "ackd", [idea("a1", t("اختبار ✓ 😀 {date}", "اختبار"))]);
  await submit("sub.pausedw", "pw", [idea("a1")], { workflowId: "w3" });

  await exchange(env, "run.done", run("done"));
  await exchange(env, "run.done.replay", run("done"));
  await exchange(
    env,
    "run.ready",
    run(
      cap("sub.ready").req.kind === "submit" ? (cap("sub.ready").req as A).body.occurrenceId : "",
    ),
  );
  await exchange(env, "run.partial", run("part"));
  await exchange(env, "run.failed", run("fail"));
  await exchange(env, "run.ackd", run("ackd"));
  await exchange(env, "run.paused", run("pw"));
  await exchange(env, "run.absent", run("never"));
  await exchange(env, "run.authority_mismatch", {
    kind: "run",
    ownerKey: "wfo_" + "3".repeat(32),
    occurrenceId: "done",
  });

  // 5. status of every state, absent and pruned; older reads
  for (const id of ["pend", "run1", "runf", "done", "part", "fail", "ackd", "pw"])
    await exchange(env, `status.${id}`, status(id));
  await exchange(env, "status.ready", status((cap("sub.ready").req as A).body.occurrenceId));
  await exchange(env, "cancel.pending", cancel("canc"));
  await exchange(env, "status.canc", status("canc"));
  await exchange(env, "status.absent", status("zz"));
  await exchange(env, "status.pruned", status("old"));
  await exchange(env, "status.authority_mismatch", {
    kind: "status",
    ownerKey: "wfo_" + "3".repeat(32),
    occurrenceId: "done",
  });
  // Read 60 days later: the body is judged at its own admission time, not the read clock.
  await exchange(env, "status.done.60d", status("done"), new Date(T + 60 * 86_400_000));

  // 6. cancel outcomes
  await exchange(env, "cancel.replay", cancel("canc"));
  await exchange(env, "cancel.terminal.noop", cancel("done"));
  await exchange(env, "cancel.running", cancel("run1"));
  await exchange(env, "cancel.absent", cancel("zz"));
  await exchange(env, "cancel.pruned", cancel("old"));

  // 7. ack outcomes
  const done = cap("run.done").parsed;
  const v = done.outcome === "ok" && done.kind === "run" ? done.receipt.receiptVersion : 0;
  const ackdV = (cap("run.ackd").parsed as A).receipt.receiptVersion as number;
  await exchange(env, "ack.not_terminal", ack("pend", 1));
  await exchange(env, "ack.future", ack("ackd", ackdV + 1));
  await exchange(env, "ack.first", ack("ackd", ackdV), new Date(T + 1000));
  await exchange(env, "ack.replay", ack("ackd", ackdV), new Date(T + 2000));
  await exchange(env, "ack.lower", ack("ackd", 1));
  await exchange(env, "ack.unacked.lower", ack("done", 1));
  await exchange(env, "ack.absent", ack("zz", 1));
  await exchange(env, "ack.pruned", ack("old", 1));
  await exchange(env, "status.ackd.acked", status("ackd"));
  await exchange(env, "ack.done", ack("done", v), new Date(T + 5000));
  await exchange(env, "status.done.acked", status("done"));

  // 8. the change feed
  await exchange(env, "changes.page1", { kind: "changes", ownerKey: owner, after: 0, limit: 3 });
  const p1 = cap("changes.page1").parsed as A;
  await exchange(env, "changes.page2", {
    kind: "changes",
    ownerKey: owner,
    after: p1.nextAfter,
    limit: 3,
  });
  await exchange(env, "changes.all", { kind: "changes", ownerKey: owner, after: 0 });
  const all = cap("changes.all").parsed as A;
  await exchange(env, "changes.empty", { kind: "changes", ownerKey: owner, after: all.nextAfter });
  await exchange(env, "changes.authority_mismatch", {
    kind: "changes",
    ownerKey: "wfo_" + "3".repeat(32),
    after: 0,
  });

  // 9. capacity: the 20th registration fits, the 21st is refused (REGISTRATIONS_MAX)
  for (let n = 0; n < 40; n++) {
    const c = await exchange(env, `register.c${n}`, reg({ workflowId: `c${n}` }), early, false);
    if (c.parsed.outcome === "refused") {
      captured.push({ ...c, name: "register.capacity" });
      break;
    }
  }
}, 60_000);

const ok = (n: string): A => {
  const p = cap(n).parsed;
  if (p.outcome !== "ok") throw new Error(`${n}: ${JSON.stringify(p)}`);
  return p as A;
};
const refusedAs = (n: string, error: string, status: number) =>
  expect(cap(n).parsed).toMatchObject({ outcome: "refused", error, status });

describe("constants the app cannot import are pinned to the coordinator's", () => {
  it("epochs, feed page, run commits, retention windows and the purge formula", () => {
    expect([
      EPOCHS_MAX,
      CHANGES_LIMIT_MAX,
      RUN_COMMITS_MAX,
      FINISH_RETENTION_MS,
      ACK_RETENTION_MS,
    ]).toEqual([W.EPOCHS, W.CHANGES, W.RUN, W.FINISH, W.ACK]);
    // The receipt's purge time follows purgeAt(finished, firstAck): checked against both real receipts below.
    expect(W.purgeAt(0, null)).toBe(W.FINISH);
    expect(W.purgeAt(0, 1000)).toBe(1000 + W.ACK);
    expect(captured.length).toBeGreaterThan(60);
  });
});

describe("real Worker answers parse: authority and registrations", () => {
  it("authority", () => {
    expect(ok("authority")).toMatchObject({
      kind: "authority",
      authority: { origin: BASE, ownerKey: owner },
    });
  });
  it("register: created, replay, re-register after unregister, typed conflicts, capacity", () => {
    expect(ok("register.created")).toMatchObject({
      kind: "register",
      created: true,
      registration: { workflowId: "w1", registrationEpoch: 1, revision: 1 },
    });
    expect(ok("register.replay")).toMatchObject({ created: false });
    expect(ok("register.again")).toMatchObject({
      created: true,
      registration: { registrationEpoch: 2, revision: 4, state: "active" },
    });
    expect(ok("register.again").registration.epochs).toHaveLength(2);
    expect(ok("register.again.replay")).toMatchObject({ created: false });
    refusedAs("register.conflict.row", "conflict", 409);
    expect(cap("register.conflict.row").parsed).toMatchObject({
      fields: { registration: { workflowId: "w1" } },
    });
    expect(cap("register.conflict.null").parsed).toMatchObject({
      outcome: "refused",
      error: "conflict",
      fields: { registration: null },
    });
    refusedAs("register.capacity", "capacity", 409);
  });
  it("update, pause, resume, unregister: changed true and the idempotent changed false", () => {
    expect(ok("update.changed")).toMatchObject({
      kind: "update",
      changed: true,
      registration: { revision: 2 },
    });
    expect(ok("update.replay")).toMatchObject({ kind: "update", changed: false });
    refusedAs("update.conflict", "conflict", 409);
    expect(ok("pause.changed")).toMatchObject({
      kind: "pause",
      changed: true,
      registration: { paused: true },
    });
    expect(ok("pause.replay")).toMatchObject({ changed: false });
    expect(ok("resume.changed")).toMatchObject({
      kind: "resume",
      changed: true,
      registration: { paused: false },
    });
    refusedAs("pause.conflict", "conflict", 409);
    expect(cap("resume.not_registered").parsed).toMatchObject({
      outcome: "refused",
      error: "not_registered",
      fields: { workflowId: "w9" },
    });
    expect(ok("unregister.changed")).toMatchObject({
      kind: "unregister",
      changed: true,
      registration: { state: "unregistered" },
    });
    expect(ok("unregister.changed").registration.epochs[0].closedAt).toBe(
      ok("unregister.changed").registration.updatedAt,
    );
    expect(ok("unregister.replay")).toMatchObject({ changed: false });
  });
});

describe("real Worker answers parse: submit", () => {
  it("created 201 and replay 200 are full verified receipts bound to the submitted body and digest", () => {
    const c = ok("submit.created");
    expect(cap("submit.created").wire.status).toBe(201);
    expect(c).toMatchObject({
      kind: "submit",
      created: true,
      receipt: { state: "pending", receiptVersion: 1, occurrenceId: "pend" },
    });
    expect(isVerifiedReceipt(c.receipt)).toBe(true);
    expect(cap("submit.replay").wire.status).toBe(200);
    expect(ok("submit.replay")).toMatchObject({ created: false });
    // The receipt's body is exactly what the snapshot helper built (nothing dropped or added).
    expect(c.receipt.body).toEqual((cap("submit.created").req as A).body);
  });
  it("typed refusals: conflict, digest_mismatch, not_registered, unknown_epoch, registration_behind, authority_mismatch, pruned", () => {
    refusedAs("submit.conflict", "conflict", 409);
    expect(cap("submit.conflict").parsed).toMatchObject({ fields: { occurrenceId: "pend" } });
    refusedAs("submit.digest_mismatch", "digest_mismatch", 400);
    refusedAs("submit.not_registered", "not_registered", 409);
    expect(cap("submit.not_registered").parsed).toMatchObject({ fields: { workflowId: "w9" } });
    refusedAs("submit.unknown_epoch", "unknown_epoch", 409);
    refusedAs("submit.registration_behind", "registration_behind", 409);
    expect(cap("submit.authority_mismatch").parsed).toEqual({
      outcome: "refused",
      error: "authority_mismatch",
      status: 409,
      fields: {},
    });
    refusedAs("submit.pruned", "pruned", 409);
  });
});

describe("real Worker answers parse: every receipt state and outcome", () => {
  const states: [string, string, string][] = [
    ["status.pend", "pending", "pending,pending"],
    ["status.run1", "running", "done,pending"],
    ["status.runf", "running", "done,failed,skipped"],
    ["status.done", "done", "done,done,done,done"],
    ["status.part", "partial", "done,failed,skipped"],
    ["status.fail", "failed", "failed,skipped"],
    ["status.canc", "cancelled", "skipped"],
    ["status.ackd", "done", "done"],
    ["status.ready", "done", "done,done,done"],
    ["status.pw", "pending", "pending"],
  ];
  it.each(states)("%s is a verified %s receipt (%s)", (name, state, steps) => {
    const r = (ok(name).result as A).receipt;
    expect(r.state).toBe(state);
    expect(r.steps.map((s: A) => s.status).join(",")).toBe(steps);
    expect(isVerifiedReceipt(r)).toBe(true);
    expect((ok(name).result as A).found).toBe("row");
  });

  it("run: done with committed, terminal replay committed 0, partial, failed, paused, absent, authority", () => {
    expect(ok("run.done")).toMatchObject({
      kind: "run",
      committed: 4,
      stopped: "terminal",
      receipt: { state: "done" },
    });
    expect(ok("run.done.replay")).toMatchObject({ committed: 0, stopped: "terminal" });
    expect(ok("run.done.replay").receipt).toEqual(ok("run.done").receipt);
    expect(ok("run.ready")).toMatchObject({
      committed: 3,
      stopped: "terminal",
      receipt: { state: "done" },
    });
    expect(ok("run.partial")).toMatchObject({
      committed: 2,
      stopped: "terminal",
      receipt: { state: "partial" },
    });
    expect(ok("run.failed")).toMatchObject({
      committed: 1,
      stopped: "terminal",
      receipt: { state: "failed" },
    });
    expect(ok("run.paused")).toMatchObject({
      committed: 0,
      stopped: "paused",
      receipt: { state: "pending" },
    });
    refusedAs("run.absent", "absent", 404);
    expect(cap("run.authority_mismatch").parsed).toMatchObject({ error: "authority_mismatch" });
  });

  it("status absent, pruned (distinct from a row) and cancelled outcomes", () => {
    expect(ok("status.absent").result).toEqual({ found: "absent", occurrenceId: "zz" });
    expect(ok("status.pruned").result).toEqual({
      found: "pruned",
      occurrenceId: "old",
      payloadDigest: "a".repeat(64),
      prunedAt: new Date(0).toISOString(),
    });
    expect(ok("cancel.pending")).toMatchObject({
      kind: "cancel",
      cancelled: true,
      receipt: { state: "cancelled" },
    });
    expect(ok("cancel.replay")).toMatchObject({
      cancelled: false,
      receipt: { state: "cancelled" },
    });
    expect(ok("cancel.terminal.noop")).toMatchObject({
      cancelled: false,
      receipt: { state: "done" },
    });
    refusedAs("cancel.running", "running", 409);
    refusedAs("cancel.absent", "absent", 404);
    refusedAs("cancel.pruned", "pruned", 410);
    refusedAs("run.authority_mismatch", "authority_mismatch", 409);
    refusedAs("status.authority_mismatch", "authority_mismatch", 409);
    refusedAs("changes.authority_mismatch", "authority_mismatch", 409);
  });

  it("an older valid receipt is still valid 60 days later (admitted time, not the read clock)", () => {
    expect(ok("status.done.60d").result.receipt).toEqual(ok("status.done").result.receipt);
  });

  it("outputs: ids, digests and records are the Worker's, and equal the app's own cloud preflight", async () => {
    const receipt = ok("run.done").receipt;
    const preview = await previewCloudRun(receipt.body);
    if (!preview.ok) throw new Error("preview");
    expect(preview.preview.outcome).toBe("done");
    expect(preview.preview.steps.map((s) => (s.status === "built" ? s.outputId : ""))).toEqual(
      receipt.outputs.map((o: A) => o.outputId),
    );
    expect(preview.preview.steps.map((s) => (s.status === "built" ? s.digest : ""))).toEqual(
      receipt.outputs.map((o: A) => o.digest),
    );
    expect(preview.preview.steps.map((s) => (s.status === "built" ? s.record : null))).toEqual(
      receipt.outputs.map((o: A) => o.record),
    );
    // Partial: the preview's prefix/suffix and error code match the Worker's receipt.
    const part = ok("run.partial").receipt;
    const pp = await previewCloudRun(part.body);
    if (!pp.ok) throw new Error("preview");
    expect(pp.preview.outcome).toBe("partial");
    expect(pp.preview.steps.map((s) => s.status)).toEqual(
      part.steps.map((s: A) => (s.status === "done" ? "built" : s.status)),
    );
    expect(part.steps[1].error).toBe((pp.preview.steps[1] as A).error);
    const failed = ok("run.failed").receipt;
    const pf = await previewCloudRun(failed.body);
    expect(pf.ok && pf.preview.outcome).toBe("failed");
    expect(failed.steps[0].error).toBe("no-skill");
    // Unicode survives the whole round trip.
    expect(ok("run.ackd").receipt.outputs[0].record.text).toBe("اختبار ✓ 😀 2026-10-17");
  });
});

describe("acknowledgement: exact version, idempotent replays, no-ops, authorization", () => {
  it("first ack, replay, lower version, unacked lower version", () => {
    const v = ok("run.ackd").receipt.receiptVersion;
    expect(ok("ack.first")).toMatchObject({ kind: "ack", acknowledged: true, ackedVersion: v });
    expect(ok("ack.replay")).toMatchObject({ acknowledged: true, ackedVersion: v });
    expect(ok("ack.lower")).toMatchObject({ acknowledged: false, ackedVersion: v });
    expect(ok("ack.unacked.lower")).toMatchObject({ acknowledged: false, ackedVersion: 0 });
    expect(ok("ack.done")).toMatchObject({ acknowledged: true });
    refusedAs("ack.not_terminal", "not_terminal", 409);
    expect(cap("ack.not_terminal").parsed).toMatchObject({
      fields: { state: "pending", receiptVersion: 1 },
    });
    refusedAs("ack.future", "future_version", 409);
    refusedAs("ack.absent", "absent", 404);
    refusedAs("ack.pruned", "pruned", 410);
  });
  it("an acknowledged receipt carries firstAckAt and an acked purge time (ackedVersion = receiptVersion)", () => {
    const r = ok("status.ackd.acked").result.receipt;
    expect(r).toMatchObject({ ackedVersion: r.receiptVersion });
    expect(r.firstAckAt).toBe(new Date(T + 1000).toISOString());
    expect(Date.parse(r.purgeAt)).toBe(
      W.purgeAt(Date.parse(r.finishedAt), Date.parse(r.firstAckAt)),
    );
    const un = ok("status.done").result.receipt;
    expect(Date.parse(un.purgeAt)).toBe(W.purgeAt(Date.parse(un.finishedAt), null));
  });
  it("only a verified terminal full receipt authorizes the exact ack request the Worker accepts", async () => {
    const r = ok("status.part").result.receipt;
    const req = ackRequestFor(r)!;
    expect(req).toEqual({
      kind: "ack",
      ownerKey: owner,
      occurrenceId: "part",
      receiptVersion: r.receiptVersion,
    });
    const c = await exchange(env, "ack.part.authorized", req, new Date(T + 9000));
    expect(c.parsed).toMatchObject({ outcome: "ok", kind: "ack", acknowledged: true });
    expect(adoptionProofOf(r)).toMatchObject({
      occurrenceId: "part",
      payloadDigest: r.payloadDigest,
    });
    expect(ackRequestFor(ok("status.run1").result.receipt)).toBeNull();
    expect(adoptionProofOf(ok("status.pend").result.receipt)).toBeNull();
  });
});

describe("the compact change feed: real pages, distinct from receipts", () => {
  it("pages carry typed, linked items and the exact cursor; `more` and the empty page are consistent", () => {
    const p1 = ok("changes.page1");
    expect(p1.items).toHaveLength(3);
    expect(p1.more).toBe(true);
    expect(p1.nextAfter).toBe(p1.items[2].changeSeq);
    const p2 = ok("changes.page2");
    expect(p2.items[0].changeSeq).toBeGreaterThan(p1.nextAfter);
    const all = ok("changes.all");
    expect(all.items.length).toBeGreaterThan(5);
    expect(all.more).toBe(false);
    const ids = all.items.map((i: A) => i.occurrenceId);
    expect(new Set(ids).size).toBe(ids.length);
    const empty = ok("changes.empty");
    expect(empty).toMatchObject({ items: [], more: false, nextAfter: all.nextAfter });
    // Terminal items carry outputs (body-free drafts), non-terminal ones do not.
    for (const i of all.items) {
      expect(i.outputs !== undefined).toBe(
        ["done", "partial", "failed", "cancelled"].includes(i.state),
      );
      expect(i.body).toBeUndefined();
    }
  });
  it("a feed item can never authorize an adoption or an acknowledgement", () => {
    for (const i of ok("changes.all").items) {
      expect(isVerifiedReceipt(i)).toBe(false);
      expect(ackRequestFor(i)).toBeNull();
      expect(adoptionProofOf(i)).toBeNull();
    }
    // Not even when it carries the very same ids/digest as a verified receipt.
    const done = ok("status.done").result.receipt;
    const item = ok("changes.all").items.find((i: A) => i.occurrenceId === "done");
    expect(item.payloadDigest).toBe(done.payloadDigest);
    expect(ackRequestFor(item)).toBeNull();
  });
});

describe("router-level answers (limits, service state) are typed refusals", () => {
  it("bad_request, unsupported_id, too_large, method_not_allowed, not_configured, receipt_unavailable", async () => {
    const req = run("done");
    const via = async (w: Wire) => parseAnswer(req, w, { origin: BASE });
    expect(
      await via(await raw(env, "POST", "/social/workflows/occurrences/done/run", "{nope")),
    ).toMatchObject({ outcome: "refused", error: "bad_request", status: 400 });
    expect(
      await via(
        await raw(env, "POST", "/social/workflows/occurrences/do:ne/run", { ownerKey: owner }),
      ),
    ).toMatchObject({ outcome: "refused", error: "unsupported_id" });
    expect(
      await via(
        await raw(
          env,
          "POST",
          "/social/workflows/occurrences/done/run",
          JSON.stringify({ ownerKey: owner, pad: "x".repeat(40_000) }),
        ),
      ),
    ).toMatchObject({ outcome: "refused", error: "too_large", status: 413 });
    expect(
      await via(await raw(env, "GET", "/social/workflows/occurrences/done/run")),
    ).toMatchObject({ outcome: "refused", error: "method_not_allowed", status: 405 });
    expect(
      await via(
        await raw(makeEnv(null), "POST", "/social/workflows/occurrences/done/run", {
          ownerKey: owner,
        }),
      ),
    ).toMatchObject({ outcome: "refused", error: "not_configured", status: 503 });
    const down = makeEnv();
    nsOf(down).down = true;
    expect(
      await via(
        await raw(down, "POST", "/social/workflows/occurrences/done/run", { ownerKey: owner }),
      ),
    ).toMatchObject({ outcome: "refused", error: "receipt_unavailable", status: 503 });
    // A missing/wrong bearer is the scout gate's answer, not a workflow answer: never a success, never a receipt.
    const gate = await raw(
      env,
      "POST",
      "/social/workflows/occurrences/done/run",
      { ownerKey: owner },
      NOW,
      false,
    );
    expect(gate.status).toBeGreaterThanOrEqual(400);
    expect((await via(gate)).outcome).not.toBe("ok");
  });
});

/* ---------- tamper tables over the real answers ---------- */

const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
const flip = (hex: string) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);

type Mut = (r: A) => void;
/** Mutations of a full receipt; each must turn a valid receipt into a refusal. */
const receiptMutations: [string, Mut][] = [
  ["occurrenceId", (r) => (r.occurrenceId = "other")],
  ["workflowId", (r) => (r.workflowId = "w9")],
  ["kind", (r) => (r.kind = r.kind === "manual" ? "article-ready" : "manual")],
  ["registrationEpoch", (r) => (r.registrationEpoch += 1)],
  ["revision", (r) => (r.revision += 1)],
  ["payloadDigest", (r) => (r.payloadDigest = flip(r.payloadDigest))],
  [
    "body.executionAt",
    (r) => (r.body.executionAt = new Date(Date.parse(r.body.executionAt) + 1000).toISOString()),
  ],
  ["body.name", (r) => (r.body.snapshot.name.en += "x")],
  ["body.ownerKey", (r) => (r.body.ownerKey = "wfo_" + "7".repeat(32))],
  ["body.unknown key", (r) => (r.body.articles = [{ body: "CANARY" }])],
  ["body.action unknown key", (r) => (r.body.snapshot.actions[0].note = "CANARY")],
  ["body removed", (r) => delete r.body],
  [
    "state",
    (r) => (r.state = r.state === "done" ? "partial" : r.state === "pending" ? "running" : "done"),
  ],
  ["state unknown", (r) => (r.state = "finished")],
  ["receiptVersion+1", (r) => (r.receiptVersion += 1)],
  ["receiptVersion-1", (r) => (r.receiptVersion -= 1)],
  ["receiptVersion 0", (r) => (r.receiptVersion = 0)],
  ["changeSeq 0", (r) => (r.changeSeq = 0)],
  [
    "ackedVersion",
    (r) => (r.ackedVersion = r.ackedVersion === 0 ? r.receiptVersion : r.ackedVersion + 1),
  ],
  ["createdAt later than executionAt skew", (r) => (r.createdAt = "2026-10-17T08:00:00.000Z")],
  // A running row's updatedAt is any instant (the Worker binds it only for pending and terminal rows).
  [
    "updatedAt",
    (r) =>
      r.state !== "running" && (r.updatedAt = new Date(Date.parse(r.updatedAt) + 1).toISOString()),
  ],
  [
    "startedAt",
    (r) => (r.startedAt === undefined ? (r.startedAt = r.createdAt) : delete r.startedAt),
  ],
  [
    "finishedAt",
    (r) => (r.finishedAt === undefined ? (r.finishedAt = r.createdAt) : delete r.finishedAt),
  ],
  [
    "purgeAt",
    (r) =>
      r.purgeAt === undefined
        ? (r.purgeAt = r.createdAt)
        : (r.purgeAt = new Date(Date.parse(r.purgeAt) + 1).toISOString()),
  ],
  [
    "firstAckAt",
    (r) => (r.firstAckAt === undefined ? (r.firstAckAt = r.createdAt) : delete r.firstAckAt),
  ],
  ["receipt unknown key", (r) => (r.CANARY = 1)],
  ["steps removed", (r) => delete r.steps],
  [
    "steps extra",
    (r) => r.steps.push({ idx: r.steps.length, actionId: "zz", kind: "idea", status: "pending" }),
  ],
  ["steps shortened", (r) => r.steps.pop()],
  [
    "step status",
    (r) => (r.steps[0].status = r.steps[0].status === "pending" ? "done" : "pending"),
  ],
  ["step idx", (r) => (r.steps[0].idx = 1)],
  ["step actionId", (r) => (r.steps[0].actionId = "zz")],
  ["step kind", (r) => (r.steps[0].kind = r.steps[0].kind === "idea" ? "post" : "idea")],
  ["step unknown key", (r) => (r.steps[0].CANARY = 1)],
  [
    "step outputId",
    (r) =>
      (r.steps[0].outputId =
        r.steps[0].outputId === undefined ? "wf:x:a1" : r.steps[0].outputId + "x"),
  ],
  [
    "step outputDigest",
    (r) =>
      (r.steps[0].outputDigest =
        r.steps[0].outputDigest === undefined ? "0".repeat(64) : flip(r.steps[0].outputDigest)),
  ],
  [
    "step error",
    (r) => (r.steps[0].error = r.steps[0].error === undefined ? "invalid" : "unknown-skill-x"),
  ],
  [
    "step at",
    (r) => (r.steps[0].at = r.steps[0].at === undefined ? r.createdAt : delete r.steps[0].at),
  ],
  ["outputs removed", (r) => delete r.outputs],
  ["outputs emptied", (r) => (r.outputs = [])],
  [
    "outputs extra",
    (r) =>
      r.outputs.push(
        clone(
          r.outputs[0] ?? {
            outputId: "wf:x:a1",
            actionId: "a1",
            kind: "idea",
            digest: "0".repeat(64),
            record: {},
          },
        ),
      ),
  ],
  ["output digest", (r) => (r.outputs[0].digest = flip(r.outputs[0].digest))],
  [
    "output record text",
    (r) =>
      r.outputs[0].record.text === undefined
        ? (r.outputs[0].record.day = 6)
        : (r.outputs[0].record.text += "!"),
  ],
  ["output record id", (r) => (r.outputs[0].record.id += "x")],
  ["output record unknown key", (r) => (r.outputs[0].record.CANARY = "x")],
  ["output record source", (r) => (r.outputs[0].record.source = "owner")],
  ["output outputId", (r) => (r.outputs[0].outputId += "x")],
  ["output actionId", (r) => (r.outputs[0].actionId = "zz")],
  ["output kind", (r) => (r.outputs[0].kind = r.outputs[0].kind === "idea" ? "post" : "idea")],
  ["outputs order", (r) => r.outputs.reverse()],
];

function mutated(wire: Wire, path: string[], mut: Mut): Wire | null {
  const w = clone(wire);
  let target: A = w.body;
  for (const p of path) target = target[p];
  const before = JSON.stringify(w);
  try {
    mut(target);
  } catch {
    return null;
  }
  return JSON.stringify(w) === before ? null : w;
}

describe("tamper tables: every real receipt-bearing answer, mutated field by field, is refused", () => {
  const receiptCaps = () =>
    captured.filter((c) => {
      const b = c.wire.body as A;
      return (
        c.wire.status < 300 &&
        b &&
        typeof b === "object" &&
        "occurrence" in b &&
        ["status", "cancel", "run", "submit"].includes(c.req.kind)
      );
    });

  it("identity, body/output digests, state fields, versions, steps, outputs and envelopes (hundreds of variants)", async () => {
    let applied = 0;
    const survivors: string[] = [];
    for (const c of receiptCaps()) {
      const base = await parseAnswer(c.req, c.wire, { origin: BASE });
      expect(base.outcome, c.name).toBe("ok");
      for (const [label, mut] of receiptMutations) {
        const w = mutated(c.wire, ["occurrence"], mut);
        if (!w) continue;
        applied++;
        const p = await parseAnswer(c.req, w, { origin: BASE });
        if (p.outcome === "ok") survivors.push(`${c.name} / ${label}`);
        else expect(JSON.stringify(p), `${c.name} / ${label}`).not.toContain("CANARY");
      }
    }
    expect(survivors).toEqual([]);
    expect(applied).toBeGreaterThan(600);
  });

  it("envelopes: unknown key, foreign ownerKey, mixed error/success, wrong status, wrong shape (all kinds)", async () => {
    let n = 0;
    for (const c of captured.filter((x) => x.parsed.outcome === "ok")) {
      const variants: [string, Wire][] = [
        ["extra key", { status: c.wire.status, body: { ...clone(c.wire.body), CANARY: 1 } }],
        [
          "mixed error",
          { status: c.wire.status, body: { ...clone(c.wire.body), error: "conflict" } },
        ],
        ["status 500", { status: 500, body: clone(c.wire.body) }],
        ["status 202", { status: 202, body: clone(c.wire.body) }],
        ["array", { status: c.wire.status, body: [clone(c.wire.body)] }],
        ["null", { status: c.wire.status, body: null }],
        ["string", { status: c.wire.status, body: "ok" }],
        ["empty", { status: c.wire.status, body: {} }],
      ];
      // (authority answers name the server authority itself: another valid ownerKey is another server)
      if ("ownerKey" in c.wire.body && c.req.kind !== "authority")
        variants.push([
          "foreign owner",
          {
            status: c.wire.status,
            body: { ...clone(c.wire.body), ownerKey: "wfo_" + "6".repeat(32) },
          },
        ]);
      for (const key of Object.keys(c.wire.body))
        variants.push([
          `drop ${key}`,
          {
            status: c.wire.status,
            body: Object.fromEntries(
              Object.entries(clone(c.wire.body)).filter(([k]) => k !== key),
            ) as A,
          },
        ]);
      for (const [label, w] of variants) {
        n++;
        const p = await parseAnswer(c.req, w, { origin: BASE });
        expect(p.outcome, `${c.name} / ${label}`).toBe("invalid");
      }
    }
    expect(n).toBeGreaterThan(300);
  });

  it("the same real answer under another request is refused (foreign id, owner, epoch, digest, version)", async () => {
    // Pairs: a real answer used to answer a request it does not belong to.
    const pairs: [string, CloudRequest][] = [
      ["status.done", status("part")],
      ["status.done", { kind: "status", ownerKey: "wfo_" + "6".repeat(32), occurrenceId: "done" }],
      ["run.done", run("part")],
      ["cancel.pending", cancel("done")],
      [
        "submit.created",
        {
          kind: "submit",
          body: (cap("sub.done").req as A).body,
          payloadDigest: (cap("sub.done").req as A).payloadDigest,
        },
      ],
      ["register.created", reg({ workflowId: "w2" })],
      ["register.created", reg({ revision: 2 })],
      ["register.created", reg({ workflowDigest: "9".repeat(64) })],
      ["register.created", reg({ expectedEpoch: 1 })],
      [
        "update.changed",
        {
          kind: "update",
          ownerKey: owner,
          workflowId: "w1",
          registrationEpoch: 1,
          expectedRevision: 1,
          revision: 3,
          workflowDigest: "f".repeat(64),
        },
      ],
      [
        "update.changed",
        {
          kind: "update",
          ownerKey: owner,
          workflowId: "w1",
          registrationEpoch: 2,
          expectedRevision: 1,
          revision: 2,
          workflowDigest: "f".repeat(64),
        },
      ],
      ["pause.changed", ctl("resume")],
      ["unregister.changed", ctl("pause")],
      ["ack.first", ack("ackd", 5)],
      ["ack.first", ack("done", 2)],
      ["changes.page1", { kind: "changes", ownerKey: owner, after: 1, limit: 3 }],
      ["changes.page1", { kind: "changes", ownerKey: owner, after: 0, limit: 2 }],
    ];
    for (const [name, req] of pairs) {
      const p = await parseAnswer(req, cap(name).wire, { origin: BASE });
      expect(p.outcome, `${name} as ${JSON.stringify(req).slice(0, 60)}`).toBe("invalid");
    }
    // Expected body / digest / version / outputs bind a status answer exactly.
    const real = (ok("status.done").result as A).receipt;
    const good = {
      body: real.body,
      payloadDigest: real.payloadDigest,
      receiptVersion: real.receiptVersion,
      outputIds: real.outputs.map((o: A) => o.outputId),
    };
    expect(
      (
        await parseAnswer(status("done", { expect: good }), cap("status.done").wire, {
          origin: BASE,
        })
      ).outcome,
    ).toBe("ok");
    const other = (ok("status.pend").result as A).receipt.body;
    for (const bad of [
      { body: other },
      { payloadDigest: flip(real.payloadDigest) },
      { receiptVersion: real.receiptVersion + 1 },
      { outputIds: [] },
      { outputIds: [...good.outputIds].reverse() },
    ])
      expect(
        (
          await parseAnswer(status("done", { expect: bad }), cap("status.done").wire, {
            origin: BASE,
          })
        ).outcome,
      ).toBe("invalid");
  });

  it("feed pages: item identity, links, digests, versions, cursor and order tampering is refused", async () => {
    const page = cap("changes.all");
    const itemMutations: [string, Mut][] = [
      ["occurrenceId dup", (i) => (i.items[1].occurrenceId = i.items[0].occurrenceId)],
      ["changeSeq order", (i) => i.items.reverse()],
      ["changeSeq 0", (i) => (i.items[0].changeSeq = 0)],
      ["nextAfter", (i) => (i.nextAfter += 1)],
      ["nextAfter low", (i) => (i.nextAfter -= 1)],
      ["owner", (i) => (i.ownerKey = "wfo_" + "6".repeat(32))],
      ["item body", (i) => (i.items[0].body = {})],
      [
        "item state",
        (i) => (i.items[0].state = i.items[0].state === "pending" ? "done" : "pending"),
      ],
      ["item version", (i) => (i.items[0].receiptVersion += 1)],
      ["item digest", (i) => (i.items[0].payloadDigest = "x")],
      ["item workflowId", (i) => (i.items[0].workflowId = "w:1")],
      ["item step status", (i) => (i.items[0].steps[0].status = "done")],
      ["item step outputId", (i) => (i.items[0].steps[0].outputId = "wf:x:a1")],
      ["item unknown key", (i) => (i.items[0].CANARY = 1)],
      ["item steps removed", (i) => (i.items[0].steps = [])],
      ["items overflow", (i) => i.items.push(clone(i.items[0]))],
    ];
    for (const [label, mut] of itemMutations) {
      const w = mutated(page.wire, [], mut);
      expect(w, label).not.toBeNull();
      expect((await parseAnswer(page.req, w!, { origin: BASE })).outcome, label).toBe("invalid");
    }
    // Output tampering inside terminal items.
    const idx = (page.wire.body.items as A[]).findIndex((i) => i.outputs && i.outputs.length > 0);
    expect(idx).toBeGreaterThan(-1);
    const outMuts: [string, Mut][] = [
      [
        "output digest",
        (i) => (i.items[idx].outputs[0].digest = flip(i.items[idx].outputs[0].digest)),
      ],
      ["output record", (i) => (i.items[idx].outputs[0].record.id += "x")],
      [
        "output text",
        (i) =>
          (i.items[idx].outputs[0].record.text = (i.items[idx].outputs[0].record.text ?? "") + "!"),
      ],
      ["outputs removed", (i) => delete i.items[idx].outputs],
      ["outputs emptied", (i) => (i.items[idx].outputs = [])],
    ];
    for (const [label, mut] of outMuts) {
      const w = mutated(page.wire, [], mut);
      expect(w, label).not.toBeNull();
      expect((await parseAnswer(page.req, w!, { origin: BASE })).outcome, label).toBe("invalid");
    }
  });

  it("registration answers: identity, epoch, revision, digest, flags and history tampering is refused", async () => {
    const regMuts: [string, Mut][] = [
      ["workflowId", (r) => (r.workflowId = "w9")],
      ["epoch", (r) => (r.registrationEpoch += 1)],
      ["revision", (r) => (r.revision += 1)],
      ["digest", (r) => (r.workflowDigest = flip(r.workflowDigest))],
      ["state", (r) => (r.state = r.state === "active" ? "unregistered" : "active")],
      // paused is bound by pause/resume only (a fresh register or update keeps the retained flag).
      ["paused", (r) => (r.paused = !r.paused)],
      ["updatedAt", (r) => (r.updatedAt = "bad")],
      ["epochs removed", (r) => (r.epochs = [])],
      [
        "epochs closedAt",
        (r) =>
          r.epochs[0].closedAt === undefined
            ? (r.epochs[0].closedAt = r.updatedAt)
            : delete r.epochs[0].closedAt,
      ],
      ["epochs unknown key", (r) => (r.epochs[0].CANARY = 1)],
      ["unknown key", (r) => (r.CANARY = 1)],
      ["epochs overflow", (r) => (r.registrationEpoch = EPOCHS_MAX + 1)],
    ];
    let n = 0;
    for (const name of [
      "register.created",
      "register.again",
      "update.changed",
      "update.replay",
      "pause.changed",
      "pause.replay",
      "resume.changed",
      "unregister.changed",
      "unregister.replay",
    ]) {
      const c = cap(name);
      for (const [label, mut] of regMuts) {
        if (label === "paused" && !/^(pause|resume)/.test(name)) continue;
        // The digest is bound by register/update only (a control request carries none).
        if (label === "digest" && /^(pause|resume|unregister)/.test(name)) continue;
        const w = mutated(c.wire, ["registration"], mut);
        if (!w) continue;
        n++;
        expect((await parseAnswer(c.req, w, { origin: BASE })).outcome, `${name} / ${label}`).toBe(
          "invalid",
        );
      }
    }
    expect(n).toBeGreaterThan(80);
  });

  it("refusals: another id/owner/extras, a wrong status code, a refusal the operation cannot answer", async () => {
    let n = 0;
    for (const c of captured.filter((x) => x.parsed.outcome === "refused")) {
      const b = c.wire.body as A;
      const variants: [string, Wire][] = [
        ["status shifted", { status: c.wire.status === 409 ? 400 : 409, body: clone(b) }],
        ["status 200", { status: 200, body: clone(b) }],
        ["extra key", { status: c.wire.status, body: { ...clone(b), CANARY: 1 } }],
        ["mixed proof", { status: c.wire.status, body: { ...clone(b), occurrence: {} } }],
        ["other error", { status: c.wire.status, body: { ...clone(b), error: "teapot" } }],
      ];
      if ("ownerKey" in b)
        variants.push([
          "foreign owner",
          { status: c.wire.status, body: { ...clone(b), ownerKey: "wfo_" + "6".repeat(32) } },
        ]);
      if ("occurrenceId" in b)
        variants.push([
          "foreign occurrence",
          { status: c.wire.status, body: { ...clone(b), occurrenceId: "foreign" } },
        ]);
      if ("workflowId" in b)
        variants.push([
          "foreign workflow",
          { status: c.wire.status, body: { ...clone(b), workflowId: "foreign" } },
        ]);
      for (const key of Object.keys(b).filter((k) => k !== "error"))
        variants.push([
          `drop ${key}`,
          {
            status: c.wire.status,
            body: Object.fromEntries(Object.entries(clone(b)).filter(([k]) => k !== key)) as A,
          },
        ]);
      for (const [label, w] of variants) {
        n++;
        const p = await parseAnswer(c.req, w, { origin: BASE });
        // A shifted status of an error whose status code is 409 -> 400 etc. is never a valid refusal.
        expect(p.outcome, `${c.name} / ${label}`).toBe("invalid");
      }
    }
    expect(n).toBeGreaterThan(100);
  });
});

describe("zero external calls", () => {
  it("parsing and describing every captured exchange makes no fetch", async () => {
    const f = vi.fn(() => {
      throw new Error("network is forbidden");
    });
    vi.stubGlobal("fetch", f);
    try {
      for (const c of captured) {
        expect(describeRequest(c.req).ok).toBe(true);
        expect(await parseAnswer(c.req, c.wire, { origin: BASE })).toEqual(c.parsed);
      }
      expect(f).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("no descriptor of any captured exchange carries a bearer, header or origin", () => {
    for (const c of captured) {
      const d = describeRequest(c.req);
      if (!d.ok) throw new Error("descriptor");
      expect(Object.keys(d.descriptor).every((k) => ["method", "path", "body"].includes(k))).toBe(
        true,
      );
      const text = JSON.stringify(d.descriptor);
      for (const word of [TOKEN, "Bearer", "Authorization", "headers", BASE, APP])
        expect(text).not.toContain(word);
    }
  });
});

describe("DT-7C-1-R1: the request is captured before any digest is awaited", () => {
  // The FIRST digest is held while the caller edits its request/expectations; real Worker answers, local only.
  const gates: (() => void)[] = [];
  afterEach(() => {
    for (const release of gates.splice(0)) release();
    vi.restoreAllMocks();
  });
  /** Start parsing, wait until the first digest is pending (or the parse already ended), edit, release, await. */
  async function held(req: CloudRequest, wire: Wire, edit: () => void): Promise<Parsed> {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const at = new Promise<void>((r) => (entered = r));
    const real = crypto.subtle.digest.bind(crypto.subtle);
    let n = 0;
    const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      if (n++ === 0) {
        entered();
        await gate;
      }
      return real(...args);
    });
    gates.push(release);
    const pending = parseAnswer(req, wire, { origin: BASE });
    try {
      await Promise.race([at, pending]);
      edit();
    } finally {
      release();
    }
    try {
      return await pending;
    } finally {
      spy.mockRestore(); // one spy at a time: a nested spy would wrap the previous mock
    }
  }
  const copy = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
  const receiptOfName = (n: string) => (ok(n).receipt ?? (ok(n).result as A).receipt) as A;

  // [capture name, request builder] for the full-receipt status / run / cancel paths of the terminal occurrence "done".
  const paths: [string, (e: A | undefined) => CloudRequest][] = [
    ["status.done", (e) => ({ ...status("done"), ...(e ? { expect: e } : {}) }) as CloudRequest],
    ["run.done", (e) => ({ ...run("done"), ...(e ? { expect: e } : {}) }) as CloudRequest],
    [
      "cancel.terminal.noop",
      (e) => ({ ...cancel("done"), ...(e ? { expect: e } : {}) }) as CloudRequest,
    ],
  ];
  const wrong = (): A[] => [
    { payloadDigest: "0".repeat(64) },
    { receiptVersion: 99 },
    { outputIds: ["wf:done:nope"] },
    { body: { ...copy(receiptOfName("status.done").body), workflowId: "w-other" } },
  ];

  it.each(paths)(
    "%s: a request that mismatches at the call still fails when it is edited to match",
    async (name, make) => {
      const r = receiptOfName(name);
      for (const [i, bad] of wrong().entries()) {
        const exp = copy(bad);
        const req = make(exp);
        const got = await held(req, cap(name).wire, () => {
          exp.payloadDigest = r.payloadDigest;
          exp.receiptVersion = r.receiptVersion;
          exp.outputIds = r.outputs.map((o: A) => o.outputId);
          exp.body = copy(r.body);
        });
        expect(got, `variant ${i}`).toEqual({ outcome: "invalid", reason: "binding" });
        expect(isVerifiedReceipt((got as A).receipt)).toBe(false);
      }
    },
  );
  it.each(paths)(
    "%s: a mismatching request whose expectations are deleted during the hold still fails",
    async (name, make) => {
      for (const bad of wrong()) {
        const req = make(copy(bad)) as A;
        const exp = req.expect as A;
        const got = await held(req as CloudRequest, cap(name).wire, () => {
          for (const k of Object.keys(exp)) delete exp[k]; // the nested expectations themselves
          delete req.expect;
        });
        expect(got).toEqual({ outcome: "invalid", reason: "binding" });
      }
    },
  );
  it.each(paths)(
    "%s: a matching request still passes when its expectations change during the hold",
    async (name, make) => {
      const r = receiptOfName(name);
      const exp: A = {
        payloadDigest: r.payloadDigest,
        receiptVersion: r.receiptVersion,
        outputIds: r.outputs.map((o: A) => o.outputId),
        body: copy(r.body),
      };
      const req = make(exp) as A;
      const got = await held(req as CloudRequest, cap(name).wire, () => {
        exp.payloadDigest = "0".repeat(64);
        exp.receiptVersion = 99;
        exp.outputIds.push("wf:done:extra");
        exp.body.workflowId = "w-other";
        exp.body.snapshot.actions.length = 0;
        req.ownerKey = "wfo_" + "9".repeat(32);
        req.occurrenceId = "elsewhere";
        delete req.expect;
      });
      expect(got).toMatchObject({ outcome: "ok" });
      const receipt = (got as A).receipt ?? (got as A).result.receipt;
      expect(isVerifiedReceipt(receipt)).toBe(true);
      expect(receipt).toEqual(r);
      // Optional-field behaviour is unchanged: an explicit undefined means "absent".
      const loose = make({ payloadDigest: undefined, body: undefined, outputIds: undefined });
      expect(await parseAnswer(loose, cap(name).wire, { origin: BASE })).toMatchObject({
        outcome: "ok",
      });
      expect(Object.isFrozen(exp)).toBe(false);
      expect(Object.isFrozen(req)).toBe(false);
    },
  );

  it("an initially unbound terminal request cannot acquire expectations (or ack/adoption authority) mid-parse", async () => {
    // Control for the other direction: nothing a caller adds later is ever read; the receipt is exactly the answer's.
    const req = status("done") as A;
    const got = await held(req as CloudRequest, cap("status.done").wire, () => {
      req.expect = { payloadDigest: "0".repeat(64) };
    });
    expect(got).toMatchObject({ outcome: "ok" });
    const receipt = (got as A).result.receipt;
    expect(ackRequestFor(receipt)).toMatchObject({ kind: "ack", occurrenceId: "done" });
    expect(adoptionProofOf(receipt)?.occurrenceId).toBe("done");
  });

  it("submit: a body/digest that mismatches at the call fails even if edited to match the answer", async () => {
    const real = cap("sub.done");
    const wire = real.wire;
    const goodBody = (real.req as A).body as A;
    const goodDigest = (real.req as A).payloadDigest as string;
    // Wrong digest, then repaired during the hold.
    const r1 = { kind: "submit", body: copy(goodBody), payloadDigest: "0".repeat(64) } as A;
    expect(
      await held(r1 as CloudRequest, wire, () => {
        r1.payloadDigest = goodDigest;
      }),
    ).toEqual({ outcome: "invalid", reason: "binding" });
    // Wrong body (a valid, different template), then repaired during the hold.
    const other = copy(goodBody);
    other.snapshot.actions[0].text.en = "a different template";
    const r2 = { kind: "submit", body: other, payloadDigest: goodDigest } as A;
    expect(
      await held(r2 as CloudRequest, wire, () => {
        r2.body = copy(goodBody);
        other.snapshot.actions[0].text = copy(goodBody.snapshot.actions[0].text);
      }),
    ).toEqual({ outcome: "invalid", reason: "binding" });
  });
  it("submit: an exact request still passes when its body and digest are edited during the hold", async () => {
    const real = cap("sub.done");
    const body = copy((real.req as A).body);
    const r = { kind: "submit", body, payloadDigest: (real.req as A).payloadDigest } as A;
    const got = await held(r as CloudRequest, real.wire, () => {
      body.snapshot.actions[0].text.en = "edited later";
      body.snapshot.actions.push(body.snapshot.actions[0]);
      r.payloadDigest = "0".repeat(64);
    });
    expect(got).toMatchObject({ outcome: "ok", kind: "submit" });
    expect((got as A).receipt.body).toEqual((real.req as A).body);
    expect(Object.isFrozen(body)).toBe(false);
  });

  it("a compact feed item never gains ack or adoption authority, whatever the caller does mid-parse", async () => {
    const feedReq = copy(cap("changes.all").req) as A;
    const got = await held(feedReq as CloudRequest, cap("changes.all").wire, () => {
      feedReq.after = 999_999;
      feedReq.limit = 1;
      feedReq.ownerKey = "wfo_" + "9".repeat(32);
    });
    expect(got).toEqual(ok("changes.all"));
    for (const item of (got as A).items) {
      expect(isVerifiedReceipt(item)).toBe(false);
      expect(ackRequestFor(item)).toBeNull();
      expect(adoptionProofOf(item)).toBeNull();
    }
    // A feed that does not fit the request at the call stays refused after the request is edited to fit.
    const bad = copy(cap("changes.all").req) as A;
    bad.after = (cap("changes.all").parsed as A).nextAfter;
    const refused = await held(bad as CloudRequest, cap("changes.all").wire, () => {
      bad.after = 0;
    });
    expect(refused).toEqual({ outcome: "invalid", reason: "feed" });
  });

  it("an input that is not plain data is an invalid request, never a throw", async () => {
    const bad = status("done") as A;
    bad.expect = { outputIds: [Object.create({ x: 1 })] };
    expect(
      await parseAnswer(bad as CloudRequest, cap("status.done").wire, { origin: BASE }),
    ).toEqual({
      outcome: "invalid",
      reason: "request",
    });
    expect(await parseAnswer(null as never, cap("status.done").wire, { origin: BASE })).toEqual({
      outcome: "invalid",
      reason: "request",
    });
  });

  it("the digest spy is restored after each test", () => {
    expect(vi.isMockFunction(crypto.subtle.digest)).toBe(false);
  });
});
