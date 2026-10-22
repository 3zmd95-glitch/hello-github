import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./store";
import type { ThreadsAnswer, ThreadsCall } from "./threadsSendCoordinator";

// 📤 DT-6B-2B-1 runtime proof (planning/tools/37-inbox-send.md) in workerd, through the Miniflare that ships with our
// pinned Wrangler (as sendCoordinator.runtime.test.ts; no new dependency). Both Durable Object classes, bindings and
// SQLite migrations come from wrangler.jsonc; storage is on disk and outlives a runtime restart; every outbound request
// is answered by a fake Threads. No provider is ever contacted.
//
// Two bundles:
//   - the real entry (src/index.ts): both classes load, and production preparation stays closed (permission_unverified);
//   - a test-only entry (built in memory here, never shipped) that runs the same `threadsSendHandler` with an injected
//     `{ ok: true }` eligibility, and wraps the coordinator binding so the calls named in FAIL_OPS fail as a storage
//     outage would. That is the only way the protocol below the closed gate runs in workerd.
// Crash = disposing the runtime while a provider answer is held (before it is sent, or mid-body after its headers);
// a new runtime on the same storage then recovers.

const requireRuntime = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireRuntime("miniflare");
const { build } = requireRuntime("esbuild");

const ROOT_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "runtime-scout-token";
const SEAL = "runtime-seal-0123456789abcdef0123456789abcdef";
const APP = "http://localhost:3000";
const ME = "25000000000000001";
const POST_ID = "90001";
const TARGET = "91001";
const CONTAINER = "17800000000000001";
const PUBLISHED = "18000000000000009";
const TH_TOKEN = "runtime-th-token";
const T0 = Date.parse("2026-10-17T09:00:00Z");
const D = "a".repeat(64);
const TH = "graph.threads.net";
const CREATE = `${TH}/v1.0/me/threads`;
const PUBLISH = `${TH}/v1.0/me/threads_publish`;

/** The test-only entry: the real handler and classes, eligibility injected, coordinator calls failable. */
const TEST_ENTRY = `
import { threadsSendHandler } from "./src/social/inboxSendThreads";
import { Store } from "./src/social/store";
export { InstagramDmCoordinator } from "./src/social/instagramDmCoordinator";
export { InstagramPublicSendCoordinator } from "./src/social/instagramPublicSendCoordinator";
export { SendCoordinator } from "./src/social/sendCoordinator";
export { ThreadsSendCoordinator } from "./src/social/threadsSendCoordinator";
export { WorkflowCoordinator } from "./src/social/workflowCoordinator";

function failable(ns, ops) {
  const bad = new Set((ops || "").split(",").filter(Boolean));
  return {
    idFromName: (name) => ns.idFromName(name),
    get: (id) => {
      const stub = ns.get(id);
      return {
        fetch: async (url, init) => {
          if (bad.has(JSON.parse(init.body).op)) throw new Error("storage down");
          return stub.fetch(url, init);
        },
      };
    },
  };
}

export default {
  async fetch(req, env) {
    const rest = new URL(req.url).pathname.split("/").filter(Boolean).slice(4);
    const handler = threadsSendHandler({ eligibility: () => ({ ok: true }) });
    const res = await handler(
      req,
      rest,
      { store: Store.from(env), seal: env.INBOX_SEAL_SECRET, coordinator: failable(env.THREADS_SEND_COORDINATOR, env.FAIL_OPS) },
      { json: (body, status) => Response.json(body, { status }) },
    );
    return res ?? new Response("not ours", { status: 404 });
  },
};
`;

interface Outbound {
  method: string;
  path: string;
  body: string;
}

let entryScript = "";
let testScript = "";
let durableObjects: Record<string, { className: string; useSQLite: boolean }> = {};
const dirs: string[] = [];

const bundle = async (opts: Record<string, unknown>) =>
  (
    await build({
      bundle: true,
      format: "esm",
      platform: "browser",
      conditions: ["workerd", "worker", "browser"],
      external: ["cloudflare:*", "node:*"],
      write: false,
      logLevel: "silent",
      ...opts,
    })
  ).outputFiles[0].text as string;

beforeAll(async () => {
  const wrangler = await import("wrangler");
  const config = wrangler.unstable_readConfig({ config: join(ROOT_DIR, "wrangler.jsonc") });
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
  expect(sqlite.get("SendCoordinator")).toBe(true);
  expect(sqlite.get("ThreadsSendCoordinator")).toBe(true);
  durableObjects = Object.fromEntries(
    config.durable_objects.bindings.map((b: { name: string; class_name: string }) => [
      b.name,
      { className: b.class_name, useSQLite: sqlite.get(b.class_name) === true },
    ]),
  );
  entryScript = await bundle({ entryPoints: [join(ROOT_DIR, "src/index.ts")] });
  testScript = await bundle({
    stdin: {
      contents: TEST_ENTRY,
      resolveDir: ROOT_DIR,
      loader: "ts",
      sourcefile: "test-entry.ts",
    },
  });
}, 120_000);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Provider = (r: Request) => Promise<Response>;

function runtime(
  persist: string,
  outbound: Outbound[],
  provider: Provider,
  o: { script?: string; failOps?: string } = {},
) {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-01",
      script: o.script ?? testScript,
      durableObjects,
      resourcePersistencePath: persist,
      kvNamespaces: ["SOCIAL_KV"],
      bindings: {
        SCOUT_TOKEN: TOKEN,
        INBOX_SEAL_SECRET: SEAL,
        ALLOWED_ORIGINS: APP,
        FAIL_OPS: o.failOps ?? "",
      },
      // Every outbound request is intercepted; this test cannot contact a provider.
      outboundService: async (request: Request) => {
        const u = new URL(request.url);
        outbound.push({
          method: request.method,
          path: `${u.host}${u.pathname}`,
          body: request.method === "POST" ? await request.clone().text() : "",
        });
        return provider(request);
      },
    }),
  );
}

const freshDir = () => {
  const d = mkdtempSync(join(tmpdir(), "threads-send-"));
  dirs.push(d);
  return d;
};

type MF = ReturnType<typeof runtime>;

async function coordinator(mf: MF, binding = "THREADS_SEND_COORDINATOR", name = `threads|${ME}`) {
  const ns = await mf.getDurableObjectNamespace(binding);
  const stub = ns.get(ns.idFromName(name));
  return async (call: ThreadsCall): Promise<ThreadsAnswer> => {
    const res = await stub.fetch("https://threads-send-coordinator/", {
      method: "POST",
      body: JSON.stringify(call),
    });
    return (await res.json()) as ThreadsAnswer;
  };
}

const prepareCall = (operationId: string, over: Record<string, unknown> = {}, now = T0) =>
  ({
    op: "prepare",
    input: {
      operationId,
      account: ME,
      generation: "0".repeat(32),
      rootPostId: POST_ID,
      replyToId: TARGET,
      text: "Thanks!",
      digest: D,
      draftRevision: "rev-1",
      reviewExpiresAt: now + 600_000,
      ...over,
    },
    now,
  }) as ThreadsCall;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const noProvider: Provider = async () => new Response("no", { status: 599 });
const posts = (o: Outbound[]) => o.filter((x) => x.method === "POST").map((x) => x.path);
const stateOf = (a: ThreadsAnswer) => ("intent" in a ? a.intent.state : a.error);
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 1000 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

describe("ThreadsSendCoordinator in workerd (SQLite storage from wrangler.jsonc)", () => {
  it("both classes load from the real entry; each stage claims once under concurrency; YouTube is separate", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, noProvider, { script: entryScript });
    try {
      const call = await coordinator(mf);
      const first = await call(prepareCall("op-runtime-1"));
      expect(first).toMatchObject({ intent: { state: "prepared", receiptVersion: 1 } });
      expect(await call(prepareCall("op-runtime-1"))).toEqual(first);
      expect(await call(prepareCall("op-runtime-2"))).toMatchObject({
        intent: { operationId: "op-runtime-1" },
      });
      const op = "op-runtime-1";
      const claimCreate = () => call({ op: "claimCreate", operationId: op, digest: D, now: T0 });
      const creates = await Promise.all([claimCreate(), claimCreate(), claimCreate()]);
      expect(creates.filter((c) => "claimed" in c && c.claimed)).toHaveLength(1);
      const records = await Promise.all(
        ["17800000000000001", "17800000000000002"].map((containerId) =>
          call({ op: "recordContainer", operationId: op, containerId, now: T0 }),
        ),
      );
      expect(records.filter((r) => "recorded" in r && r.recorded)).toHaveLength(1);
      const claimPublish = () => call({ op: "claimPublish", operationId: op, digest: D, now: T0 });
      const pubs = await Promise.all([claimPublish(), claimPublish(), claimPublish()]);
      expect(pubs.filter((c) => "claimed" in c && c.claimed)).toHaveLength(1);
      const settles = await Promise.all([
        call({
          op: "settle",
          operationId: op,
          outcome: { state: "published", publishedId: PUBLISHED },
          now: T0,
        }),
        call({
          op: "settle",
          operationId: op,
          outcome: { state: "unknown_publication", reason: "timeout" },
          now: T0,
        }),
      ]);
      expect(settles.filter((s) => "settled" in s && s.settled)).toHaveLength(1);
      expect(await call({ op: "get", operationId: op, now: T0 })).toMatchObject({
        intent: { receiptVersion: 5 },
      });
      // The YouTube coordinator is another class and another object: it has never heard of this operation.
      const yt = await coordinator(mf, "SEND_COORDINATOR", `youtube|${ME}`);
      expect(await yt({ op: "get", operationId: op, now: T0 })).toEqual({ error: "not_found" });
      expect(outbound).toEqual([]);
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("keeps every in-flight and unknown stage across a restart and past retention; none is claimable again", async () => {
    const dir = freshDir();
    let mf = runtime(dir, [], noProvider);
    const ops = {
      creating: "op-creating-1",
      publishing: "op-publish-01",
      unknown_creation: "op-unk-create",
      unknown_publication: "op-unk-publish",
    };
    try {
      const call = await coordinator(mf);
      let rev = 0;
      for (const [stage, op] of Object.entries(ops)) {
        await call(prepareCall(op, { draftRevision: `rev-${++rev}` }));
        await call({ op: "claimCreate", operationId: op, digest: D, now: T0 });
        if (stage === "unknown_creation")
          await call({
            op: "settle",
            operationId: op,
            outcome: { state: "unknown_creation", reason: "timeout" },
            now: T0,
          });
        if (stage === "publishing" || stage === "unknown_publication") {
          await call({ op: "recordContainer", operationId: op, containerId: CONTAINER, now: T0 });
          await call({ op: "claimPublish", operationId: op, digest: D, now: T0 });
        }
        if (stage === "unknown_publication")
          await call({
            op: "settle",
            operationId: op,
            outcome: { state: "unknown_publication", reason: "server" },
            now: T0,
          });
      }
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir, [], noProvider);
    try {
      const call = await coordinator(mf);
      const later = T0 + 365 * 86_400_000;
      // A purge runs (prepare) far past retention: nothing in flight or uncertain is touched.
      await call(prepareCall("op-later-01", { draftRevision: "rev-later" }, later));
      for (const [stage, op] of Object.entries(ops)) {
        expect(stateOf(await call({ op: "get", operationId: op, now: later }))).toBe(stage);
        const answers = await Promise.all([
          call({ op: "claimCreate", operationId: op, digest: D, now: later }),
          call({ op: "claimPublish", operationId: op, digest: D, now: later }),
          call({ op: "cancel", operationId: op, now: later }),
          // Only the request that made the create POST records its container (a creating row awaits exactly that).
          ...(stage === "creating"
            ? []
            : [
                call({
                  op: "recordContainer",
                  operationId: op,
                  containerId: "17800000000000999",
                  now: later,
                }),
              ]),
        ]);
        for (const a of answers) {
          expect(stateOf(a)).toBe(stage);
          expect(a).not.toMatchObject({ claimed: true });
          expect(a).not.toMatchObject({ recorded: true });
        }
      }
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});

/* ---------- the routes in workerd with a fake Threads ---------- */

interface Ctl {
  /** Never answer the create / publish POST (a crash while it is in flight). */
  holdCreate?: boolean;
  holdPublish?: boolean;
  /** Answer 200 headers and then never finish the body (a crash after the provider answered). */
  stallCreate?: boolean;
  stallPublish?: boolean;
  /** Resolve to let held create POSTs answer normally. */
  gate?: Promise<void>;
}

function threads(ctl: Ctl = {}): Provider {
  const never = new Promise<void>(() => undefined);
  const stalled = () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"id":'));
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  return async (r: Request) => {
    const u = new URL(r.url);
    if (u.host !== TH) return new Response("blocked", { status: 599 });
    const p = u.pathname;
    if (p === "/v1.0/me") return json({ id: ME, username: "3z.prod" });
    if (p === "/v1.0/me/threads" && r.method === "GET")
      return json({ data: [{ id: POST_ID, text: "post" }] });
    if (p === `/v1.0/${POST_ID}/replies`)
      return json({
        data: [{ id: TARGET, text: "hi", root_post: { id: POST_ID }, replied_to: { id: POST_ID } }],
      });
    if (p === `/v1.0/${TARGET}`)
      return json({ id: TARGET, root_post: { id: POST_ID }, replied_to: { id: POST_ID } });
    if (p === "/v1.0/me/threads" && r.method === "POST") {
      if (ctl.holdCreate) await never;
      await ctl.gate;
      return ctl.stallCreate ? stalled() : json({ id: CONTAINER });
    }
    if (p === "/v1.0/me/threads_publish" && r.method === "POST") {
      if (ctl.holdPublish) await never;
      return ctl.stallPublish ? stalled() : json({ id: PUBLISHED });
    }
    return json({ error: { message: "unmocked", code: 100 } }, 404);
  };
}

const call = (mf: MF, path: string, init: RequestInit = {}) =>
  mf.dispatchFetch(`https://scout.test${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Origin: APP, "Content-Type": "application/json" },
  });
const read = async (res: Response) => (await res.json()) as Record<string, unknown>;
type Intent = Record<string, unknown> & { state: string; digest: string };

async function seed(mf: MF) {
  const kv = await mf.getKVNamespace("SOCIAL_KV");
  const store = new Store(kv, TOKEN);
  await store.putTokens("threads", {
    accessToken: TH_TOKEN,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_000_000).toISOString(),
    userId: ME,
    // Every scope the collection lists and canPublish: still not grant evidence for the real entry.
    scope:
      "threads_basic,threads_manage_insights,threads_read_replies,threads_content_publish,threads_manage_replies",
    canPublish: true,
  });
  await store.putStatus("threads", { connectedAt: "2026-10-01T08:00:00.000Z" });
}

/** A genuine send reference from the real entry's replies listing (inboxReadThreads.ts, pure GETs). */
async function sendRefOf(dir: string, outbound: Outbound[]) {
  const mf = runtime(dir, outbound, threads(), { script: entryScript });
  try {
    await seed(mf);
    const acc = await read(await call(mf, "/social/inbox/threads/account"));
    expect(acc.capabilities).toEqual({ replies: "ok", sendReplies: "permission_unverified" });
    const q = `?account=${acc.accountId}&generation=${acc.generation}`;
    const list = await read(await call(mf, `/social/inbox/threads/posts${q}`));
    const ref = (list.items as { ref: string }[])[0].ref;
    const replies = await read(await call(mf, `/social/inbox/threads/posts/${ref}/replies${q}`));
    const sendRef = (replies.items as { sendRef: string }[])[0].sendRef;
    // The real entry keeps production closed: no POST, no receipt.
    const gate = await call(mf, "/social/inbox/threads/send/prepare", {
      method: "POST",
      body: JSON.stringify({ operationId: "op-real-gate", sendRef, text: "x", draftRevision: "r" }),
    });
    expect(gate.status).toBe(403);
    expect(await read(gate)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    expect(posts(outbound)).toEqual([]);
    return sendRef;
  } finally {
    await mf.dispose();
  }
}

const SEND = "/social/inbox/threads/send";
const prepare = async (mf: MF, sendRef: string, operationId: string) =>
  (
    await read(
      await call(mf, `${SEND}/prepare`, {
        method: "POST",
        body: JSON.stringify({ operationId, sendRef, text: " Thanks! ", draftRevision: "rev-1" }),
      }),
    )
  ).intent as Intent;
const confirm = (mf: MF, operationId: string, digest: string) =>
  call(mf, `${SEND}/confirm`, {
    method: "POST",
    body: JSON.stringify({ operationId, digest, account: ME }),
  }).then(read);
const status = async (mf: MF, operationId: string) =>
  ((await read(await call(mf, `${SEND}/${operationId}?account=${ME}`))).intent as Intent).state;

describe("the Threads send routes in workerd (test entry, eligibility injected)", () => {
  it("prepare → two concurrent confirms → one create, one publish; the receipt recovers after a restart", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    const sendRef = await sendRefOf(dir, outbound);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let mf = runtime(dir, outbound, threads({ gate }));
    const op = "op-runtime-send-1";
    let digest = "";
    try {
      const intent = await prepare(mf, sendRef, op);
      digest = intent.digest;
      expect(intent).toMatchObject({ state: "prepared", text: "Thanks!", replyToId: TARGET });
      expect(posts(outbound)).toEqual([]);
      const a = confirm(mf, op, intent.digest);
      await until(() => posts(outbound).length === 1);
      const b = await confirm(mf, op, intent.digest);
      expect((b.intent as Intent).state).toBe("creating");
      release();
      expect(((await a).intent as Intent).state).toBe("published");
      expect(posts(outbound)).toEqual([CREATE, PUBLISH]);
      const bodies = outbound.filter((o) => o.method === "POST").map((o) => o.body);
      expect(Object.fromEntries(new URLSearchParams(bodies[0]))).toEqual({
        media_type: "TEXT",
        text: "Thanks!",
        reply_to_id: TARGET,
        access_token: TH_TOKEN,
      });
      expect(Object.fromEntries(new URLSearchParams(bodies[1]))).toEqual({
        creation_id: CONTAINER,
        access_token: TH_TOKEN,
      });
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir, outbound, threads());
    try {
      expect(await status(mf, op)).toBe("published");
      expect(((await confirm(mf, op, digest)).intent as Intent).state).toBe("published");
    } finally {
      await mf.dispose();
    }
    expect(posts(outbound)).toEqual([CREATE, PUBLISH]);
    for (const o of outbound) expect(o.path.startsWith(TH)).toBe(true);
  }, 120_000);

  /**
   * The fault matrix. Each row: what is injected in the first runtime, the state a new runtime on the same storage
   * shows, and the POSTs after two more confirms there. Never more than one create and one publish.
   */
  const matrix: [string, { ctl?: Ctl; failOps?: string; crash?: string }, string, string[]][] = [
    ["crash before the create claim", { crash: "before" }, "published", [CREATE, PUBLISH]],
    [
      "storage fails at the create claim",
      { failOps: "claimCreate" },
      "published",
      [CREATE, PUBLISH],
    ],
    [
      "crash with the create POST in flight",
      { ctl: { holdCreate: true }, crash: CREATE },
      "creating",
      [CREATE],
    ],
    [
      "crash after the create answer, before the container receipt",
      { ctl: { stallCreate: true }, crash: CREATE },
      "creating",
      [CREATE],
    ],
    [
      "storage fails at the container receipt",
      { failOps: "recordContainer" },
      "unknown_creation",
      [CREATE],
    ],
    [
      "storage fails at the container and the unknown receipt",
      { failOps: "recordContainer,settle" },
      "creating",
      [CREATE],
    ],
    [
      "storage fails at the publish claim (container durable)",
      { failOps: "claimPublish" },
      "published",
      [CREATE, PUBLISH],
    ],
    [
      "crash with the publish POST in flight",
      { ctl: { holdPublish: true }, crash: PUBLISH },
      "publishing",
      [CREATE, PUBLISH],
    ],
    [
      "crash after the publish answer, before its receipt",
      { ctl: { stallPublish: true }, crash: PUBLISH },
      "publishing",
      [CREATE, PUBLISH],
    ],
    [
      "storage fails at the published receipt",
      { failOps: "settle" },
      "publishing",
      [CREATE, PUBLISH],
    ],
    ["crash after the receipt commit", { crash: "after" }, "published", [CREATE, PUBLISH]],
  ];

  for (const [name, inject, afterRestart, finalPosts] of matrix)
    it(`${name}: restart shows ${afterRestart}; repeats never duplicate a stage`, async () => {
      const dir = freshDir();
      const outbound: Outbound[] = [];
      const sendRef = await sendRefOf(dir, outbound);
      const op = "op-fault-0001";
      let digest = "";
      let mf = runtime(dir, outbound, threads(inject.ctl), { failOps: inject.failOps });
      try {
        const intent = await prepare(mf, sendRef, op);
        digest = intent.digest;
        if (inject.crash !== "before") {
          const running = confirm(mf, op, digest).catch(() => ({ crashed: true }));
          if (inject.crash && inject.crash !== "after") {
            await until(() => posts(outbound).includes(inject.crash!));
            // Give a stalled body time to reach the Worker before the crash.
            await new Promise((r) => setTimeout(r, 100));
          } else {
            const first = await running;
            if (inject.failOps === "recordContainer")
              expect(first).toMatchObject({ intent: { state: "unknown_creation" } });
            if (inject.failOps === "settle")
              expect(first).toMatchObject({
                intent: { state: "unknown_publication", unknownReason: "receipt" },
              });
            if (inject.failOps?.startsWith("claim"))
              expect(first).toEqual({ error: "receipt_unavailable" });
          }
        }
      } finally {
        // The crash (or the end of the first runtime): no further step runs there.
        await mf.dispose().catch(() => undefined);
      }
      mf = runtime(dir, outbound, threads());
      try {
        const seen = await status(mf, op);
        // A refused claim or a crash before any claim leaves the intent ready; a repeat then runs it once.
        expect(seen).toBe(
          inject.crash === "before" || inject.failOps === "claimCreate"
            ? "prepared"
            : inject.failOps === "claimPublish"
              ? "created"
              : afterRestart,
        );
        for (let i = 0; i < 2; i++) await confirm(mf, op, digest);
        expect(await status(mf, op)).toBe(afterRestart);
        expect(posts(outbound)).toEqual(finalPosts);
        if (finalPosts.length === 2) {
          const publish = outbound.find((o) => o.path === PUBLISH)!;
          expect(Object.fromEntries(new URLSearchParams(publish.body))).toEqual({
            creation_id: CONTAINER,
            access_token: TH_TOKEN,
          });
        }
      } finally {
        await mf.dispose();
      }
    }, 120_000);
});
