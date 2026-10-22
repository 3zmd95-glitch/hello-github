import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IgPublicAnswer, IgPublicCall } from "./instagramPublicSendCoordinator";
import { emptyAutomations, mergeAutomation, type PollState } from "./replies";
import { Store } from "./store";

// 📤 DT-6B-2C-1 runtime proof (planning/tools/37-inbox-send.md) in workerd, through the Miniflare that ships with our
// pinned Wrangler (as the YouTube and Threads runtime tests; no new dependency). The three Durable Object classes,
// bindings and SQLite migrations come from wrangler.jsonc; storage is on disk and outlives a runtime restart; every
// outbound request is answered by a fake Instagram. No provider is ever contacted.
//
// Two bundles:
//   - the real entry (src/index.ts): all three classes load, and production preparation stays closed;
//   - a test-only entry (built in memory here, never shipped) that runs the same `instagramSendHandler` with an
//     injected `{ ok: true }` eligibility, and the real `pollReplies` against the same INSTAGRAM_PUBLIC_SEND_COORDINATOR
//     binding (wrapped so the calls named in FAIL_OPS fail as a storage outage would).
// Crash = disposing the runtime while a provider answer is held (before it is sent, or mid-body after its headers); a
// new runtime on the same storage then shows what survived.

const requireRuntime = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireRuntime("miniflare");
const { build } = requireRuntime("esbuild");

const ROOT_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "runtime-scout-token";
const SEAL = "runtime-seal-0123456789abcdef0123456789abcdef";
const APP = "http://localhost:3000";
/** `/me`'s user_id. */
const ME = "17841000000000001";
/** The OAuth user id: deliberately another value. */
const OAUTH_USER = "26000000000000009";
const MEDIA = "18000000000000001";
const COMMENT = "17900000000000001";
const REPLY = "17950000000000001";
const IG_TOKEN = "runtime-ig-token";
const IG = "graph.instagram.com";
const PUBLIC = `${IG}/v21.0/${COMMENT}/replies`;
const DM = `${IG}/v21.0/${ME}/messages`;
const SEND = "/social/inbox/instagram/send";

const TEST_ENTRY = `
import { instagramSendHandler } from "./src/social/inboxSendInstagram";
import { pollReplies } from "./src/social/replies";
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
    const u = new URL(req.url);
    const coordinator = failable(env.INSTAGRAM_PUBLIC_SEND_COORDINATOR, env.FAIL_OPS);
    if (u.pathname === "/__poll") {
      // The real poll, its default claim path: the env binding (wrapped only to inject outages).
      const result = await pollReplies(
        { ...env, INSTAGRAM_PUBLIC_SEND_COORDINATOR: coordinator },
        { now: new Date() },
      );
      return Response.json(result);
    }
    const rest = u.pathname.split("/").filter(Boolean).slice(4);
    const handler = instagramSendHandler({ eligibility: () => ({ ok: true }) });
    const res = await handler(
      req,
      rest,
      { store: Store.from(env), coordinator, seal: env.INBOX_SEAL_SECRET },
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
  expect(sqlite.get("InstagramPublicSendCoordinator")).toBe(true);
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
        META_APP_ID: "meta-id",
        META_APP_SECRET: "meta-secret",
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
  const d = mkdtempSync(join(tmpdir(), "ig-public-send-"));
  dirs.push(d);
  return d;
};

type MF = ReturnType<typeof runtime>;

async function coordinator(
  mf: MF,
  binding = "INSTAGRAM_PUBLIC_SEND_COORDINATOR",
  name = `instagram|${ME}`,
) {
  const ns = await mf.getDurableObjectNamespace(binding);
  const stub = ns.get(ns.idFromName(name));
  return async (call: IgPublicCall): Promise<IgPublicAnswer> => {
    const res = await stub.fetch("https://c/", { method: "POST", body: JSON.stringify(call) });
    return (await res.json()) as IgPublicAnswer;
  };
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const posts = (o: Outbound[]) => o.filter((x) => x.method === "POST").map((x) => x.path);
const publicPosts = (o: Outbound[]) => posts(o).filter((p) => p === PUBLIC);
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 1000 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

interface Ctl {
  /** Never answer the public reply POST (a crash while it is in flight). */
  hold?: boolean;
  /** Answer 200 headers and then never finish the body (a crash after the provider answered). */
  stall?: boolean;
  /** Resolve to let held public POSTs answer normally. */
  gate?: Promise<void>;
}

function instagram(ctl: Ctl = {}): Provider {
  const never = new Promise<void>(() => undefined);
  let dm = 0;
  return async (r: Request) => {
    const u = new URL(r.url);
    if (u.host !== IG) return new Response("blocked", { status: 599 });
    const p = u.pathname;
    if (p === "/v21.0/me") return json({ user_id: ME, username: "3z.prod" });
    if (p === `/v21.0/${ME}/media`) return json({ data: [{ id: MEDIA, comments_count: 1 }] });
    if (p === `/v21.0/${MEDIA}/comments`)
      return json({
        data: [
          {
            id: COMMENT,
            text: "ابغى اللت",
            username: "fan",
            from: { id: "u1", username: "fan" },
            timestamp: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      });
    if (p === `/v21.0/${ME}/messages`)
      return json({ recipient_id: "u1", message_id: `mid${++dm}` });
    if (p === `/v21.0/${COMMENT}/replies` && r.method === "POST") {
      if (ctl.hold) await never;
      await ctl.gate;
      if (ctl.stall)
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"id":'));
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return json({ id: REPLY });
    }
    return json({ error: { message: "unmocked", code: 100 } }, 404);
  };
}

async function seed(mf: MF) {
  const kv = await mf.getKVNamespace("SOCIAL_KV");
  const store = new Store(kv, TOKEN);
  await store.putTokens("instagram", {
    accessToken: IG_TOKEN,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    userId: OAUTH_USER,
    scope:
      "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages",
    canReply: true,
    canPublish: true,
  });
  await store.putStatus("instagram", { connectedAt: "2026-10-01T08:00:00.000Z" });
  const doc = emptyAutomations();
  doc.automations.lut = mergeAutomation(
    undefined,
    {
      id: "lut",
      enabled: true,
      trigger: "comment",
      postId: null,
      keywords: ["لت"],
      match: "contains",
      publicReplies: ["تم {username}"],
      dmText: "الرابط بالخاص",
      buttons: [],
      followButton: false,
    },
    new Date(Date.now() - 86_400_000),
  );
  await store.putReplies(doc);
}

const call = (mf: MF, path: string, init: RequestInit = {}) =>
  mf.dispatchFetch(`https://scout.test${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Origin: APP, "Content-Type": "application/json" },
  });
const read = async (res: Response) => (await res.json()) as Record<string, unknown>;
type Intent = Record<string, unknown> & { state: string; digest: string };

const prepare = async (mf: MF, operationId: string) =>
  (
    await read(
      await call(mf, `${SEND}/prepare`, {
        method: "POST",
        body: JSON.stringify({
          operationId,
          account: ME,
          mediaId: MEDIA,
          commentId: COMMENT,
          text: " Thanks! ",
          draftRevision: "rev-1",
        }),
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
const poll = (mf: MF) => call(mf, "/__poll").then(read);
const pollLog = async (mf: MF) => {
  const store = new Store(await mf.getKVNamespace("SOCIAL_KV"), TOKEN);
  return ((await store.getRepliesState<PollState>())?.log ?? [])[0];
};
const effectState = async (mf: MF) => {
  const c = await coordinator(mf);
  const a = await c({ op: "getEffect", account: ME, commentId: COMMENT, now: Date.now() });
  return "effect" in a && a.effect ? `${a.effect.actor}:${a.effect.state}` : "none";
};

describe("InstagramPublicSendCoordinator in workerd (SQLite storage from wrangler.jsonc)", () => {
  it("all three classes load from the real entry; production stays closed; one claim wins under concurrency", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, instagram(), { script: entryScript });
    try {
      await seed(mf);
      const gate = await call(mf, `${SEND}/prepare`, {
        method: "POST",
        body: JSON.stringify({
          operationId: "op-real-gate",
          account: ME,
          mediaId: MEDIA,
          commentId: COMMENT,
          text: "x",
          draftRevision: "r",
        }),
      });
      expect(gate.status).toBe(403);
      expect(await read(gate)).toEqual({ error: "no_permission", detail: "permission_unverified" });
      const c = await coordinator(mf);
      const now = Date.now();
      await c({
        op: "prepare",
        input: {
          operationId: "op-runtime-1",
          account: ME,
          generation: "0".repeat(32),
          mediaId: MEDIA,
          commentId: COMMENT,
          text: "Thanks!",
          digest: "a".repeat(64),
          draftRevision: "rev-1",
          reviewExpiresAt: now + 600_000,
        },
        now,
      });
      const answers = await Promise.all([
        c({ op: "claimConfirm", operationId: "op-runtime-1", digest: "a".repeat(64), now }),
        c({ op: "claimAuto", account: ME, commentId: COMMENT, automationId: "lut", now }),
        c({ op: "claimAuto", account: ME, commentId: COMMENT, automationId: "lut", now }),
      ]);
      expect(answers.filter((a) => "claimed" in a && a.claimed)).toHaveLength(1);
      // The other coordinators are other classes and objects.
      const th = await coordinator(mf, "THREADS_SEND_COORDINATOR", `threads|${ME}`);
      expect(await th({ op: "get", operationId: "op-runtime-1", now } as never)).toEqual({
        error: "not_found",
      });
      expect(outbound).toEqual([]);
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});

describe("manual confirm and the automatic acknowledgement share one claim (test entry, real poll)", () => {
  it("manual first: one public POST; the poll still DMs, skips the public reply, and restart keeps it", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    let mf = runtime(dir, outbound, instagram());
    try {
      await seed(mf);
      const intent = await prepare(mf, "op-manual-first");
      expect(intent).toMatchObject({ state: "prepared", text: "Thanks!", account: ME });
      expect(((await confirm(mf, "op-manual-first", intent.digest)).intent as Intent).state).toBe(
        "sent",
      );
      expect(await poll(mf)).toMatchObject({ sent: [COMMENT] });
      expect(await pollLog(mf)).toMatchObject({
        dm: "sent",
        publicReply: "skipped",
        detail: "already_claimed",
      });
      expect(posts(outbound)).toEqual([PUBLIC, DM]);
      expect(
        Object.fromEntries(new URLSearchParams(outbound.find((o) => o.path === PUBLIC)!.body)),
      ).toEqual({
        message: "Thanks!",
        access_token: IG_TOKEN,
      });
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir, outbound, instagram());
    try {
      expect(await status(mf, "op-manual-first")).toBe("sent");
      expect(await effectState(mf)).toBe("manual:op-manual-first:sent");
    } finally {
      await mf.dispose();
    }
    expect(publicPosts(outbound)).toHaveLength(1);
  }, 120_000);

  it("poll first: the DM then one public POST of the filled text; a manual confirm is already_claimed", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, instagram());
    try {
      await seed(mf);
      const intent = await prepare(mf, "op-poll-first1");
      expect(await poll(mf)).toMatchObject({ sent: [COMMENT] });
      expect(posts(outbound)).toEqual([DM, PUBLIC]);
      expect(
        new URLSearchParams(outbound.find((o) => o.path === PUBLIC)!.body).get("message"),
      ).toBe("تم @fan");
      expect(await pollLog(mf)).toMatchObject({ dm: "sent", publicReply: "sent" });
      expect((await confirm(mf, "op-poll-first1", intent.digest)).intent).toMatchObject({
        state: "already_claimed",
        failureDetail: "automatic",
      });
      expect(publicPosts(outbound)).toHaveLength(1);
      expect(await effectState(mf)).toBe("auto:lut:sent");
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("manual confirm racing a poll: exactly one public POST, whoever claims first", async () => {
    const outbound: Outbound[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mf = runtime(freshDir(), outbound, instagram({ gate }));
    try {
      await seed(mf);
      const intent = await prepare(mf, "op-race-00001");
      const both = Promise.all([confirm(mf, "op-race-00001", intent.digest), poll(mf)]);
      await until(() => publicPosts(outbound).length === 1);
      await new Promise((r) => setTimeout(r, 200));
      release();
      const [manual] = await both;
      const state = (manual.intent as Intent).state;
      const log = await pollLog(mf);
      expect(publicPosts(outbound)).toHaveLength(1);
      if (state === "sent")
        expect(log).toMatchObject({ publicReply: "skipped", detail: "already_claimed" });
      else {
        expect(state).toBe("already_claimed");
        expect(log).toMatchObject({ publicReply: "sent" });
      }
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("two overlapping poll ticks: the public reply is claimed and posted once (the DM is not deduplicated here)", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, instagram());
    try {
      await seed(mf);
      await Promise.all([poll(mf), poll(mf)]);
      await poll(mf);
      expect(publicPosts(outbound)).toHaveLength(1);
      expect(await effectState(mf)).toBe("auto:lut:sent");
    } finally {
      await mf.dispose();
    }
  }, 120_000);
});

describe("restart on persisted storage never causes a second public POST", () => {
  /** Each row: what the first runtime injects, the intent state after a restart, and what the effect holds. */
  const matrix: [
    string,
    { ctl?: Ctl; failOps?: string; crash?: "before" | "post" | "after" },
    string,
  ][] = [
    ["crash before the claim", { crash: "before" }, "sent"],
    ["storage fails at the claim", { failOps: "claimConfirm" }, "sent"],
    ["crash with the public POST in flight", { ctl: { hold: true }, crash: "post" }, "dispatching"],
    [
      "crash after the provider answered, before the receipt",
      { ctl: { stall: true }, crash: "post" },
      "dispatching",
    ],
    ["storage fails at the receipt", { failOps: "settle" }, "dispatching"],
    ["crash after the receipt commit", { crash: "after" }, "sent"],
  ];

  for (const [name, inject, finalState] of matrix)
    it(`${name}: restart shows the truth; repeats, status and the poll never re-POST`, async () => {
      const dir = freshDir();
      const outbound: Outbound[] = [];
      const op = "op-fault-0001";
      let digest = "";
      let mf = runtime(dir, outbound, instagram(inject.ctl), { failOps: inject.failOps });
      try {
        await seed(mf);
        digest = (await prepare(mf, op)).digest;
        if (inject.crash !== "before") {
          const running = confirm(mf, op, digest).catch(() => ({ crashed: true }));
          if (inject.crash === "post") {
            await until(() => publicPosts(outbound).length === 1);
            await new Promise((r) => setTimeout(r, 100));
          } else {
            const first = await running;
            if (inject.failOps === "claimConfirm")
              expect(first).toEqual({ error: "receipt_unavailable" });
            if (inject.failOps === "settle")
              expect(first).toMatchObject({
                intent: { state: "unknown", unknownReason: "receipt" },
              });
          }
        }
      } finally {
        await mf.dispose().catch(() => undefined);
      }
      mf = runtime(dir, outbound, instagram());
      try {
        const seen = await status(mf, op);
        expect(seen).toBe(
          inject.crash === "before" || inject.failOps === "claimConfirm" ? "prepared" : finalState,
        );
        for (let i = 0; i < 2; i++) await confirm(mf, op, digest);
        expect(await status(mf, op)).toBe(finalState);
        // The poll reaches the same comment: its public reply is already claimed by the manual operation.
        await poll(mf);
        expect(await pollLog(mf)).toMatchObject({
          publicReply: "skipped",
          detail: "already_claimed",
        });
        expect(publicPosts(outbound)).toHaveLength(1);
        expect(await effectState(mf)).toBe(
          `manual:${op}:${finalState === "sent" ? "sent" : "claimed"}`,
        );
      } finally {
        await mf.dispose();
      }
    }, 120_000);

  it("a poll crashing with its public POST in flight: restart keeps the claim; manual confirm is already_claimed", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    let mf = runtime(dir, outbound, instagram({ hold: true }));
    let digest = "";
    try {
      await seed(mf);
      digest = (await prepare(mf, "op-after-poll")).digest;
      void poll(mf).catch(() => undefined);
      await until(() => publicPosts(outbound).length === 1);
    } finally {
      await mf.dispose().catch(() => undefined);
    }
    mf = runtime(dir, outbound, instagram());
    try {
      expect(await effectState(mf)).toBe("auto:lut:claimed");
      expect((await confirm(mf, "op-after-poll", digest)).intent).toMatchObject({
        state: "already_claimed",
      });
      expect(publicPosts(outbound)).toHaveLength(1);
    } finally {
      await mf.dispose();
    }
  }, 120_000);
});
