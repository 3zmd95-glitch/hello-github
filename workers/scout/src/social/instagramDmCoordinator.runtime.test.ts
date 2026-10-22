import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RETENTION_MS, type DmAnswer, type DmCall } from "./instagramDmCoordinator";
import { emptyAutomations, emptyState, mergeAutomation, type PollState } from "./replies";
import { Store } from "./store";

// 💬 DT-6B-2C-2 runtime proof (planning/tools/37-inbox-send.md) in workerd, through the Miniflare that ships with our
// pinned Wrangler (as the earlier send runtimes; no new dependency). The four Durable Object classes, bindings and
// SQLite migrations come from wrangler.jsonc; storage is on disk and outlives a runtime restart; every outbound request
// is answered by a fake Instagram. No provider is ever contacted.
//
// Two bundles:
//   - the real entry (src/index.ts): all four classes load; the coordinator's claim/takeover/resume/cooldown races;
//   - a test-only entry (built in memory here, never shipped) that runs the real `pollReplies` against the same
//     INSTAGRAM_DM_COORDINATOR binding (wrapped so the calls named in FAIL_OPS fail as a storage outage would, or
//     removed with NO_DM_BINDING).
// Crash = disposing the runtime while the provider's answer is held (before it is sent, or mid-body after its headers);
// a new runtime on the same storage then shows what survived. A "lost result" (the poll's KV write never landed, or a
// crash left its lock) is the seeded poll state put back before the next poll.

const requireRuntime = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireRuntime("miniflare");
const { build } = requireRuntime("esbuild");

const ROOT_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "runtime-scout-token";
const SEAL = "runtime-seal-0123456789abcdef0123456789abcdef";
/** `/me`'s user_id. */
const ME = "17841000000000001";
/** Another professional account (a reconnect to it). */
const ME2 = "17841000000000002";
/** The OAuth user id: deliberately another value. */
const OAUTH_USER = "26000000000000009";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const IN1 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE=";
const IN2 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjI=";
const IG_TOKEN = "runtime-ig-token";
const IG = "graph.instagram.com";
const DM = (account = ME) => `${IG}/v21.0/${account}/messages`;
const DIGEST = "d".repeat(64);
const GEN = "0".repeat(32);

const TEST_ENTRY = `
import { pollReplies } from "./src/social/replies";
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
    if (u.pathname !== "/__poll") return new Response("not ours", { status: 404 });
    // The real poll and its default DM authority: the env binding (wrapped only to inject outages, or removed).
    const dm = env.NO_DM_BINDING === "1" ? undefined : failable(env.INSTAGRAM_DM_COORDINATOR, env.FAIL_OPS);
    return Response.json(await pollReplies({ ...env, INSTAGRAM_DM_COORDINATOR: dm }, { now: new Date() }));
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
  expect(sqlite.get("InstagramDmCoordinator")).toBe(true);
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
  o: { script?: string; failOps?: string; noBinding?: boolean } = {},
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
        META_APP_ID: "meta-id",
        META_APP_SECRET: "meta-secret",
        FAIL_OPS: o.failOps ?? "",
        NO_DM_BINDING: o.noBinding ? "1" : "",
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
  const d = mkdtempSync(join(tmpdir(), "ig-dm-"));
  dirs.push(d);
  return d;
};

type MF = ReturnType<typeof runtime>;

async function coordinator(mf: MF, account = ME) {
  const ns = await mf.getDurableObjectNamespace("INSTAGRAM_DM_COORDINATOR");
  const stub = ns.get(ns.idFromName(`instagram-dm|${account}`));
  return async (
    call: DmCall | Record<string, unknown>,
  ): Promise<DmAnswer & Record<string, unknown>> => {
    const res = await stub.fetch("https://c/", { method: "POST", body: JSON.stringify(call) });
    return (await res.json()) as DmAnswer & Record<string, unknown>;
  };
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const dmPosts = (o: Outbound[], account = ME) =>
  o.filter((x) => x.method === "POST" && x.path === DM(account));
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 1000 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

interface Ctl {
  /** `/me`'s user_id (a reconnect to another account). */
  me?: string;
  /** The person's messages in the conversation, oldest first. */
  inbound?: string[];
  /** Never answer the DM POST (a crash while it is in flight). */
  hold?: boolean;
  /** Answer 200 headers and then never finish the body (a crash after the provider answered). */
  stall?: boolean;
  /** Resolve to let held DM POSTs answer normally. */
  gate?: Promise<void>;
  /** Called when a DM POST arrives, before it is answered. */
  onPost?: () => Promise<void>;
  /** Overrides the DM POST answer. */
  answer?: (body: { recipient: { id: string } }) => Response;
}

function instagram(ctl: Ctl = {}): Provider {
  const never = new Promise<void>(() => undefined);
  let n = 0;
  return async (r: Request) => {
    const u = new URL(r.url);
    if (u.host !== IG) return new Response("blocked", { status: 599 });
    const me = ctl.me ?? ME;
    const p = u.pathname;
    if (p === "/v21.0/me") return json({ user_id: me, username: "3z.prod" });
    if (p === `/v21.0/${me}/conversations`) {
      const ids = ctl.inbound ?? [IN1];
      const messages = ids
        .map((id, i) => ({
          id,
          message: "إيش الكاميرا؟",
          created_time: new Date(Date.now() - (ids.length - i) * 60_000).toISOString(),
          from: { id: PERSON, username: "sara" },
        }))
        .reverse();
      return json({ data: [{ id: CONV, messages: { data: messages } }] });
    }
    if (p === `/v21.0/${me}/messages` && r.method === "POST") {
      const body = (await r.json()) as { recipient: { id: string } };
      await ctl.onPost?.();
      if (ctl.hold) await never;
      await ctl.gate;
      if (ctl.stall)
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"recipient_id":'));
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      if (ctl.answer) return ctl.answer(body);
      return json({ recipient_id: body.recipient.id, message_id: `mid-${++n}` });
    }
    return json({ error: { message: "unmocked", code: 100 } }, 404);
  };
}

const SINCE = () => new Date(Date.now() - 3_600_000).toISOString();

async function seed(mf: MF) {
  const store = new Store(await mf.getKVNamespace("SOCIAL_KV"), TOKEN);
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
  doc.origin = "https://scout.test";
  doc.automations.cam = mergeAutomation(
    undefined,
    {
      id: "cam",
      enabled: true,
      trigger: "message",
      postId: null,
      keywords: ["كاميرا"],
      match: "contains",
      publicReplies: [],
      dmText: "أصور بالآيفون",
      buttons: [],
      followButton: false,
    },
    new Date(Date.now() - 86_400_000),
  );
  await store.putReplies(doc);
  await resetState(mf);
}

/** The poll state as seeded: the DM side ran an hour ago, nothing else (a lost result, a crash's lock gone). */
async function resetState(mf: MF) {
  const store = new Store(await mf.getKVNamespace("SOCIAL_KV"), TOKEN);
  await store.putRepliesState({ ...emptyState(), inboxSince: SINCE() });
}

const poll = async (mf: MF) =>
  (await (await mf.dispatchFetch("https://scout.test/__poll")).json()) as Record<string, unknown>;
const pollLog = async (mf: MF) => {
  const store = new Store(await mf.getKVNamespace("SOCIAL_KV"), TOKEN);
  return ((await store.getRepliesState<PollState>())?.log ?? [])[0];
};
const effectState = async (mf: MF, inbound = IN1, account = ME) => {
  const c = await coordinator(mf, account);
  const a = await c({
    op: "status",
    account,
    conversationId: CONV,
    inboundMessageId: inbound,
    now: Date.now(),
  });
  const e = a.effect as { actor: string; state: string } | undefined;
  return e ? `${e.actor}:${e.state}` : "none";
};
const claimCall = (over: Record<string, unknown> = {}) => ({
  op: "claim",
  account: ME,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: IN1,
  actor: "auto:cam",
  payloadDigest: DIGEST,
  generation: GEN,
  isDefault: false,
  cooldownMs: 86_400_000,
  now: Date.now(),
  ...over,
});

describe("InstagramDmCoordinator in workerd (SQLite storage from wrangler.jsonc, real entry)", () => {
  it("all four classes load; competing poll/auto/manual claims of one inbound event: exactly one wins", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, instagram(), { script: entryScript });
    try {
      const c = await coordinator(mf);
      const answers = await Promise.all([
        c(claimCall()),
        c(claimCall()),
        c(claimCall({ actor: "manual:op-aaaaaaaa" })),
        c(claimCall({ actor: "auto:other", generation: "1".repeat(32) })),
      ]);
      expect(answers.filter((a) => a.result === "claimed")).toHaveLength(1);
      expect(answers.filter((a) => a.result === "already_claimed")).toHaveLength(3);
      // Distinct accounts and conversations are distinct effects (and distinct objects per account).
      const c2 = await coordinator(mf, ME2);
      expect(await c2(claimCall({ account: ME2 }))).toMatchObject({ result: "claimed" });
      expect(await c(claimCall({ conversationId: "conv-2" }))).toMatchObject({ result: "claimed" });
      // A later inbound turn is never locked by the earlier effect.
      expect(await c(claimCall({ inboundMessageId: IN2 }))).toMatchObject({ result: "claimed" });
      // The other coordinators are other classes and objects.
      const pub = await mf.getDurableObjectNamespace("INSTAGRAM_PUBLIC_SEND_COORDINATOR");
      const res = await pub.get(pub.idFromName(`instagram|${ME}`)).fetch("https://c/", {
        method: "POST",
        body: JSON.stringify({ op: "get", operationId: "op-aaaaaaaa", now: Date.now() }),
      });
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(outbound).toEqual([]);
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("takeover before/after a claim, stale resume CAS, and the concurrent default cooldown", async () => {
    const mf = runtime(freshDir(), [], instagram(), { script: entryScript });
    try {
      const c = await coordinator(mf);
      const now = Date.now();
      // After a winning claim: honest in-flight report, later automatic claims blocked.
      const won = await c(claimCall());
      const [t1, t2] = await Promise.all([
        c({ op: "takeover", account: ME, conversationId: CONV, expectedRevision: 0, now }),
        c({ op: "takeover", account: ME, conversationId: CONV, expectedRevision: 0, now }),
      ]);
      const winner = t1.error ? t2 : t1;
      expect([t1, t2].filter((t) => t.error === "conflict")).toHaveLength(1);
      expect(winner).toMatchObject({ changed: true, conversation: { mode: "human", revision: 1 } });
      expect(winner.inFlight).toEqual([won.effect]);
      expect(await c(claimCall({ inboundMessageId: IN2 }))).toMatchObject({
        result: "blocked_by_takeover",
      });
      // Stale resume, then the explicit one; the claimed effect stays claimed.
      expect(
        await c({ op: "resume", account: ME, conversationId: CONV, expectedRevision: 0, now }),
      ).toMatchObject({ error: "conflict" });
      expect(
        await c({ op: "resume", account: ME, conversationId: CONV, expectedRevision: 1, now }),
      ).toMatchObject({ changed: true, conversation: { mode: "auto", revision: 2 } });
      expect(await c(claimCall())).toMatchObject({
        result: "already_claimed",
        effect: { state: "claimed" },
      });
      // Before a claim: blocks it.
      await c({ op: "takeover", account: ME, conversationId: "c-9", expectedRevision: 0, now });
      expect(await c(claimCall({ conversationId: "c-9" }))).toMatchObject({
        result: "blocked_by_takeover",
      });
      // Two different inbound events for one person racing for the default reply: one claim, one cooldown.
      const defs = await Promise.all(
        ["x1", "x2", "x3"].map((id, i) =>
          c(
            claimCall({
              conversationId: `d-${i}`,
              inboundMessageId: id,
              actor: "auto:default",
              isDefault: true,
              recipientId: "990000000000777",
            }),
          ),
        ),
      );
      expect(defs.map((d) => d.result).sort()).toEqual(["claimed", "cooldown", "cooldown"]);
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("retention: an automatic claim 90+ days later tombstones settled effects; claimed/unknown stay; purged never reclaimable", async () => {
    const mf = runtime(freshDir(), [], instagram(), { script: entryScript });
    try {
      const c = await coordinator(mf);
      const t0 = Date.now();
      await c(claimCall({ now: t0 }));
      await c({
        op: "settle",
        account: ME,
        conversationId: CONV,
        inboundMessageId: IN1,
        actor: "auto:cam",
        outcome: { state: "sent", providerMessageId: "mid-1" },
        now: t0,
      });
      await c(claimCall({ inboundMessageId: IN2, now: t0 }));
      await c(claimCall({ inboundMessageId: "in-3", now: t0 }));
      await c({
        op: "settle",
        account: ME,
        conversationId: CONV,
        inboundMessageId: "in-3",
        actor: "auto:cam",
        outcome: { state: "unknown", reason: "timeout" },
        now: t0,
      });
      const later = t0 + RETENTION_MS + 86_400_000;
      expect(await c(claimCall({ inboundMessageId: "in-4", now: later }))).toMatchObject({
        result: "claimed",
      });
      const st = (id: string) =>
        c({ op: "status", account: ME, conversationId: CONV, inboundMessageId: id, now: later });
      expect((await st(IN1)).effect).toBeUndefined();
      expect(await st(IN2)).toMatchObject({ effect: { state: "claimed" } });
      expect(await st("in-3")).toMatchObject({ effect: { state: "unknown" } });
      expect(await c(claimCall({ now: later + 1 }))).toMatchObject({
        result: "already_claimed",
        retired: true,
      });
    } finally {
      await mf.dispose();
    }
  }, 60_000);
});

describe("the real poll through the DM authority (test entry)", () => {
  it("one DM: claim, one POST of the exact payload, receipt; a lost result never sends it again (also after restart)", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    let mf = runtime(dir, outbound, instagram());
    try {
      await seed(mf);
      expect(await poll(mf)).toMatchObject({ sent: [IN1] });
      expect(dmPosts(outbound)).toHaveLength(1);
      expect(JSON.parse(dmPosts(outbound)[0].body)).toEqual({
        recipient: { id: PERSON },
        message: { text: "أصور بالآيفون" },
      });
      expect(await effectState(mf)).toBe("auto:cam:sent");
      await resetState(mf);
      expect(await poll(mf)).toMatchObject({ sent: [] });
      expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "already_claimed" });
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir, outbound, instagram());
    try {
      await resetState(mf);
      await poll(mf);
      expect(await effectState(mf)).toBe("auto:cam:sent");
      expect(dmPosts(outbound)).toHaveLength(1);
      // The OAuth user id never names an object.
      expect(await effectState(mf, IN1, OAUTH_USER)).toBe("none");
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("overlapping polls and an internal manual claim of the same event: one POST at most", async () => {
    const outbound: Outbound[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mf = runtime(freshDir(), outbound, instagram({ gate, inbound: [IN1, IN2] }));
    try {
      await seed(mf);
      // The person's own send (manual) holds IN2 before any poll.
      const c = await coordinator(mf);
      expect(
        await c(claimCall({ inboundMessageId: IN2, actor: "manual:op-aaaaaaaa" })),
      ).toMatchObject({ result: "claimed" });
      const both = Promise.all([poll(mf), poll(mf)]);
      await until(() => dmPosts(outbound).length >= 1);
      await new Promise((r) => setTimeout(r, 200));
      release();
      await both;
      expect(dmPosts(outbound)).toHaveLength(1);
      expect(await effectState(mf, IN1)).toBe("auto:cam:sent");
      expect(await effectState(mf, IN2)).toBe("manual:op-aaaaaaaa:claimed");
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("takeover before the poll: skipped (takeover), no POST; takeover during the POST: it completes, the next turn is blocked", async () => {
    const outbound: Outbound[] = [];
    const ctl: Ctl = {};
    const mf = runtime(freshDir(), outbound, instagram(ctl));
    try {
      await seed(mf);
      const c = await coordinator(mf);
      const now = Date.now();
      await c({ op: "takeover", account: ME, conversationId: CONV, expectedRevision: 0, now });
      await poll(mf);
      expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "takeover" });
      expect(dmPosts(outbound)).toEqual([]);
      await c({ op: "resume", account: ME, conversationId: CONV, expectedRevision: 1, now });
      // The owner takes over while the poll's POST is on its way.
      let inFlight: unknown[] = [];
      ctl.onPost = async () => {
        const t = await c({
          op: "takeover",
          account: ME,
          conversationId: CONV,
          expectedRevision: 2,
          now: Date.now(),
        });
        inFlight = t.inFlight as unknown[];
      };
      ctl.inbound = [IN2];
      await poll(mf);
      expect(inFlight).toMatchObject([{ inboundMessageId: IN2, state: "claimed" }]);
      expect(await effectState(mf, IN2)).toBe("auto:cam:sent");
      expect(dmPosts(outbound)).toHaveLength(1);
      ctl.onPost = undefined;
      ctl.inbound = [IN2, "in-3"];
      await poll(mf);
      expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "takeover" });
      expect(dmPosts(outbound)).toHaveLength(1);
      // A stale resume changes nothing.
      expect(
        await c({ op: "resume", account: ME, conversationId: CONV, expectedRevision: 2, now }),
      ).toMatchObject({ error: "conflict" });
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("malformed or foreign receipts are unknown and never re-sent; a reconnect to another account uses that account", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    let mf = runtime(
      dir,
      outbound,
      instagram({ answer: () => json({ recipient_id: "990000000000999", message_id: "mid-x" }) }),
    );
    try {
      await seed(mf);
      await poll(mf);
      expect(await pollLog(mf)).toMatchObject({ dm: "failed", detail: "unknown-delivery" });
      expect(await effectState(mf)).toBe("auto:cam:unknown");
    } finally {
      await mf.dispose();
    }
    mf = runtime(
      dir,
      outbound,
      instagram({
        inbound: [IN1, IN2],
        answer: (b) => json({ recipient_id: b.recipient.id, message_id: "m", error: { code: 1 } }),
      }),
    );
    try {
      await resetState(mf);
      await poll(mf);
      expect(await effectState(mf, IN2)).toBe("auto:cam:unknown");
      expect(dmPosts(outbound)).toHaveLength(2);
      await resetState(mf);
      await poll(mf);
      expect(dmPosts(outbound)).toHaveLength(2);
    } finally {
      await mf.dispose();
    }
    // The owner reconnects another professional account: /me names it; its own object holds its effects.
    mf = runtime(dir, outbound, instagram({ me: ME2 }));
    try {
      await resetState(mf);
      expect(await poll(mf)).toMatchObject({ sent: [IN1] });
      expect(dmPosts(outbound, ME2)).toHaveLength(1);
      expect(await effectState(mf, IN1, ME2)).toBe("auto:cam:sent");
      expect(await effectState(mf, IN1, ME)).toBe("auto:cam:unknown");
    } finally {
      await mf.dispose();
    }
  }, 180_000);

  it("no binding: the rule DM fails closed (not_configured, dm-claim-store), zero DM POST", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, instagram(), { noBinding: true });
    try {
      await seed(mf);
      expect(await poll(mf)).toMatchObject({ sent: [], failed: [IN1] });
      expect(await pollLog(mf)).toMatchObject({
        dm: "failed",
        error: "not_configured",
        detail: "dm-claim-store",
      });
      expect(dmPosts(outbound)).toEqual([]);
    } finally {
      await mf.dispose();
    }
  }, 120_000);
});

describe("restart on persisted storage never causes a second DM POST", () => {
  /** Each row: what the first runtime injects, and the effect after everything. */
  const matrix: [string, { ctl?: Ctl; failOps?: string; crash?: "before" | "post" }, string][] = [
    ["crash before the claim", { crash: "before" }, "sent"],
    ["storage fails at the claim", { failOps: "claim" }, "sent"],
    ["crash with the DM POST in flight", { ctl: { hold: true }, crash: "post" }, "claimed"],
    [
      "crash after the provider answered, before the receipt",
      { ctl: { stall: true }, crash: "post" },
      "claimed",
    ],
    ["storage fails at the receipt", { failOps: "settle" }, "claimed"],
    ["crash after the receipt commit", {}, "sent"],
  ];

  for (const [name, inject, finalState] of matrix)
    it(`${name}: restart shows the truth; later polls never re-POST`, async () => {
      const dir = freshDir();
      const outbound: Outbound[] = [];
      let mf = runtime(dir, outbound, instagram(inject.ctl), { failOps: inject.failOps });
      try {
        await seed(mf);
        if (inject.crash !== "before") {
          const running = poll(mf).catch(() => ({ crashed: true }));
          if (inject.crash === "post") {
            await until(() => dmPosts(outbound).length === 1);
            await new Promise((r) => setTimeout(r, 100));
          } else {
            const first = await running;
            if (inject.failOps === "claim") {
              expect(first).toMatchObject({ sent: [], failed: [IN1] });
              expect(await pollLog(mf)).toMatchObject({ detail: "dm-claim-store" });
              expect(dmPosts(outbound)).toEqual([]);
            }
            if (inject.failOps === "settle")
              expect(await pollLog(mf)).toMatchObject({ dm: "failed", detail: "unknown-delivery" });
          }
        }
      } finally {
        await mf.dispose().catch(() => undefined);
      }
      mf = runtime(dir, outbound, instagram());
      try {
        const seen = await effectState(mf);
        expect(seen).toBe(
          inject.crash === "before" || inject.failOps === "claim"
            ? "none"
            : `auto:cam:${finalState}`,
        );
        for (let i = 0; i < 2; i++) {
          await resetState(mf);
          await poll(mf);
        }
        expect(dmPosts(outbound)).toHaveLength(1);
        expect(await effectState(mf)).toBe(`auto:cam:${finalState}`);
        expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "already_claimed" });
      } finally {
        await mf.dispose();
      }
    }, 120_000);
});

/* ---------- DT-6B-2C-3: reviewed manual DMs and verified control handles in workerd ---------- */

// A third bundle, test-only and never shipped: the real `instagramDmHandler` with an injected `{ ok: true }`
// eligibility and the real `pollReplies`, both on the same INSTAGRAM_DM_COORDINATOR binding (wrapped so the calls
// named in FAIL_OPS fail as a storage outage would). The real entry (entryScript) proves production stays closed
// and that durable recovery needs no connection.
const MANUAL_ENTRY = `
import { instagramDmHandler } from "./src/social/inboxSendInstagramDm";
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
    const ns = failable(env.INSTAGRAM_DM_COORDINATOR, env.FAIL_OPS);
    if (u.pathname === "/__poll")
      return Response.json(await pollReplies({ ...env, INSTAGRAM_DM_COORDINATOR: ns }, { now: new Date() }));
    const rest = u.pathname.split("/").filter(Boolean).slice(4);
    const handler = instagramDmHandler({ eligibility: () => ({ ok: true }) });
    const res = await handler(
      req,
      rest,
      { store: Store.from(env), coordinator: ns, seal: env.INBOX_SEAL_SECRET },
      { json: (body, status) => Response.json(body, { status }) },
    );
    return res ?? new Response("not ours", { status: 404 });
  },
};
`;

let manualScript = "";
const OP_A = "op-manual-0001";

interface MCtl extends Ctl {
  /** The fixed epoch the message times derive from (the same across a restart). */
  base?: number;
}

/** The fake Instagram for manual DMs: /me, conversations (with the automation's expansion), the thread page, the POST. */
function dmProvider(ctl: MCtl = {}): Provider {
  const base = ctl.base ?? Date.now();
  const never = new Promise<void>(() => undefined);
  let n = 0;
  return async (r: Request) => {
    const u = new URL(r.url);
    if (u.host !== IG) return new Response("blocked", { status: 599 });
    const p = u.pathname;
    const ids = ctl.inbound ?? [IN1];
    const messages = ids
      .map((id, i) => ({
        id,
        message: "إيش الكاميرا؟",
        created_time: new Date(base - (ids.length - i) * 60_000).toISOString(),
        from: { id: PERSON, username: "sara" },
      }))
      .reverse();
    if (p === "/v21.0/me") return json({ user_id: ME, username: "3z.prod" });
    if (p === `/v21.0/${ME}/conversations`)
      return json({ data: [{ id: CONV, messages: { data: messages } }] });
    if (p === `/v21.0/${CONV}`) return json({ id: CONV, messages: { data: messages } });
    if (p === `/v21.0/${ME}/messages` && r.method === "POST") {
      const body = (await r.json()) as { recipient: { id: string } };
      await ctl.onPost?.();
      if (ctl.hold) await never;
      await ctl.gate;
      if (ctl.stall)
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"recipient_id":'));
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      if (ctl.answer) return ctl.answer(body);
      return json({ recipient_id: body.recipient.id, message_id: `mid-${++n}` });
    }
    return json({ error: { message: "unmocked", code: 100 } }, 404);
  };
}

const dmCall = (mf: MF, path: string, body?: unknown) =>
  mf.dispatchFetch(`https://scout.test/social/inbox/instagram/dm${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
const out = async (res: Response) => (await res.json()) as Record<string, unknown>;
type MIntent = Record<string, unknown> & { state: string; digest: string; text: string };
const RAW_TEXT = "  Hi Sara 𝒜\r\nIt is an iPhone  ";
const CANONICAL = "Hi Sara 𝒜\r\nIt is an iPhone";
const mPrepare = async (mf: MF, op = OP_A, over: Record<string, unknown> = {}) =>
  (
    await out(
      await dmCall(mf, "/send/prepare", {
        operationId: op,
        account: ME,
        conversationId: CONV,
        recipientId: PERSON,
        inboundMessageId: IN1,
        text: RAW_TEXT,
        draftRevision: "rev-1",
        ...over,
      }),
    )
  ).intent as MIntent;
const mConfirm = async (mf: MF, op: string, digest: string) =>
  out(await dmCall(mf, "/send/confirm", { operationId: op, digest, account: ME }));
const mStatus = async (mf: MF, op = OP_A) =>
  ((await out(await dmCall(mf, `/send/${op}?account=${ME}`))).intent as MIntent).state;
const sha256 = async (s: string) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
};
const reviewed = (text = CANONICAL) =>
  JSON.stringify({ recipient: { id: PERSON }, message: { text } });

describe("DT-6B-2C-3 manual DMs and control handles in workerd (current binding, fake provider)", () => {
  beforeAll(async () => {
    manualScript = await bundle({
      stdin: {
        contents: MANUAL_ENTRY,
        resolveDir: ROOT_DIR,
        loader: "ts",
        sourcefile: "manual-entry.ts",
      },
    });
  }, 120_000);

  it("real entry: new sends and registrations stay closed; recovery works offline with zero provider calls", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    let mf = runtime(dir, outbound, dmProvider(), { script: manualScript });
    let handleId = "";
    try {
      await seed(mf);
      expect((await mPrepare(mf)).state).toBe("prepared");
      handleId = (
        (await out(await dmCall(mf, "/control/register", { account: ME, conversationId: CONV })))
          .control as { handleId: string }
      ).handleId;
      expect(handleId).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      await mf.dispose();
    }
    const before = outbound.length;
    mf = runtime(dir, outbound, dmProvider(), { script: entryScript });
    try {
      for (const [path, body] of [
        ["/send/prepare", { operationId: "op-manual-gate", account: ME }],
        ["/send/confirm", { operationId: OP_A, digest: "0".repeat(64), account: ME }],
        ["/control/register", { account: ME, conversationId: CONV }],
      ] as [string, unknown][]) {
        const res = await dmCall(mf, path, body);
        // A confirm with a wrong digest of a prepared intent is a conflict before the gate; the right one is closed.
        if (path === "/send/confirm") expect(await out(res)).toEqual({ error: "conflict" });
        else
          expect(await out(res)).toEqual({
            error: "no_permission",
            detail: "permission_unverified",
          });
      }
      const intent = (await out(await dmCall(mf, `/send/${OP_A}?account=${ME}`))).intent as MIntent;
      expect(
        await out(
          await dmCall(mf, "/send/confirm", {
            operationId: OP_A,
            digest: intent.digest,
            account: ME,
          }),
        ),
      ).toEqual({ error: "no_permission", detail: "permission_unverified" });
      // The connection is gone entirely: durable recovery still answers.
      await new Store(await mf.getKVNamespace("SOCIAL_KV"), TOKEN).forget("instagram");
      expect(await mStatus(mf)).toBe("prepared");
      expect(await out(await dmCall(mf, `/control/${handleId}?account=${ME}`))).toMatchObject({
        conversation: { mode: "auto", revision: 0 },
        inFlightTotal: 0,
      });
      expect(
        await out(
          await dmCall(mf, `/control/${handleId}/takeover`, { account: ME, expectedRevision: 0 }),
        ),
      ).toMatchObject({ changed: true, conversation: { mode: "human", revision: 1 } });
      expect(
        await out(
          await dmCall(mf, `/control/${handleId}/takeover`, { account: ME, expectedRevision: 0 }),
        ),
      ).toMatchObject({ error: "conflict", conversation: { revision: 1 } });
      expect(
        await out(
          await dmCall(mf, `/control/${handleId}/resume`, { account: ME, expectedRevision: 1 }),
        ),
      ).toMatchObject({ changed: true, conversation: { mode: "auto", revision: 2 } });
      expect(
        ((await out(await dmCall(mf, `/send/${OP_A}/cancel`, { account: ME }))).intent as MIntent)
          .state,
      ).toBe("cancelled");
      // Raw selectors and absent handles never stand in for verified proof.
      expect(await out(await dmCall(mf, `/control/${CONV}?account=${ME}`))).toEqual({
        error: "bad_request",
      });
      expect(await out(await dmCall(mf, `/control/${"a".repeat(32)}?account=${ME}`))).toEqual({
        error: "not_found",
      });
      expect(await out(await dmCall(mf, `/control/${handleId}?account=${ME2}`))).toEqual({
        error: "not_found",
      });
      expect(outbound.length).toBe(before);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("manual first: one POST of exactly the reviewed bytes; the poll then skips that inbound event; restart keeps it", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    const base = Date.now();
    let mf = runtime(dir, outbound, dmProvider({ base }), { script: manualScript });
    try {
      await seed(mf);
      const intent = await mPrepare(mf);
      expect(intent.text).toBe(CANONICAL);
      expect(intent.digest).toBe(await sha256(reviewed()));
      expect(dmPosts(outbound)).toEqual([]);
      expect(await mConfirm(mf, OP_A, intent.digest)).toMatchObject({
        intent: { state: "sent", providerMessageId: "mid-1" },
      });
      expect(dmPosts(outbound)).toHaveLength(1);
      expect(dmPosts(outbound)[0].body).toBe(reviewed());
      expect(await effectState(mf)).toBe(`manual:${OP_A}:sent`);
      expect(await poll(mf)).toMatchObject({ sent: [] });
      expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "already_claimed" });
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir, outbound, dmProvider({ base }), { script: manualScript });
    try {
      await resetState(mf);
      await poll(mf);
      expect(await mStatus(mf)).toBe("sent");
      expect((await mConfirm(mf, OP_A, "0".repeat(64))).intent).toMatchObject({ state: "sent" });
      expect(dmPosts(outbound)).toHaveLength(1);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("poll first: the manual confirm is already_claimed (automatic), zero manual POST", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, dmProvider(), { script: manualScript });
    try {
      await seed(mf);
      const intent = await mPrepare(mf);
      expect(await poll(mf)).toMatchObject({ sent: [IN1] });
      expect((await mConfirm(mf, OP_A, intent.digest)).intent).toMatchObject({
        state: "already_claimed",
        failureDetail: "automatic",
      });
      expect(dmPosts(outbound)).toHaveLength(1);
      expect(JSON.parse(dmPosts(outbound)[0].body).message.text).toBe("أصور بالآيفون");
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("a poll and three duplicate confirms racing: exactly one POST, whoever claims first", async () => {
    const outbound: Outbound[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mf = runtime(freshDir(), outbound, dmProvider({ gate }), { script: manualScript });
    try {
      await seed(mf);
      const intent = await mPrepare(mf);
      const all = Promise.all([
        poll(mf),
        mConfirm(mf, OP_A, intent.digest),
        mConfirm(mf, OP_A, intent.digest),
        mConfirm(mf, OP_A, intent.digest),
      ]);
      await until(() => dmPosts(outbound).length >= 1);
      await new Promise((r) => setTimeout(r, 300));
      release();
      await all;
      expect(dmPosts(outbound)).toHaveLength(1);
      expect(await effectState(mf)).toMatch(/:sent$/);
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("cancel racing confirm: either cancelled with zero POST or dispatched once, never both", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, dmProvider(), { script: manualScript });
    try {
      await seed(mf);
      const intent = await mPrepare(mf);
      const [cancelled, confirmed] = await Promise.all([
        out(await dmCall(mf, `/send/${OP_A}/cancel`, { account: ME })),
        mConfirm(mf, OP_A, intent.digest),
      ]);
      const c = (cancelled.intent as MIntent).state;
      const f = (confirmed.intent as MIntent).state;
      if (c === "cancelled") {
        expect(f).toBe("cancelled");
        expect(dmPosts(outbound)).toEqual([]);
      } else {
        expect(["dispatching", "sent"]).toContain(c);
        expect(f).toBe("sent");
        expect(dmPosts(outbound)).toHaveLength(1);
      }
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("takeover through a verified handle blocks the poll, never the person's send; resume frees nothing", async () => {
    const outbound: Outbound[] = [];
    const ctl: MCtl = {};
    const mf = runtime(freshDir(), outbound, dmProvider(ctl), { script: manualScript });
    try {
      await seed(mf);
      const reg = await out(
        await dmCall(mf, "/control/register", { account: ME, conversationId: CONV }),
      );
      const handleId = (reg.control as { handleId: string }).handleId;
      expect(
        await out(
          await dmCall(mf, `/control/${handleId}/takeover`, { account: ME, expectedRevision: 0 }),
        ),
      ).toMatchObject({ changed: true, inFlightTotal: 0 });
      await poll(mf);
      expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "takeover" });
      expect(dmPosts(outbound)).toEqual([]);
      // The person's own send works under the takeover and leaves the mode as it is.
      const intent = await mPrepare(mf);
      let inFlight: Record<string, unknown> = {};
      ctl.onPost = async () => {
        inFlight = await out(await dmCall(mf, `/control/${handleId}?account=${ME}`));
      };
      expect((await mConfirm(mf, OP_A, intent.digest)).intent).toMatchObject({ state: "sent" });
      expect(inFlight).toMatchObject({
        conversation: { mode: "human", revision: 1 },
        inFlightTotal: 1,
        inFlight: [{ actor: `manual:${OP_A}`, state: "claimed" }],
      });
      expect(
        await out(
          await dmCall(mf, `/control/${handleId}/resume`, { account: ME, expectedRevision: 0 }),
        ),
      ).toMatchObject({ error: "conflict", conversation: { revision: 1 } });
      expect(
        await out(
          await dmCall(mf, `/control/${handleId}/resume`, { account: ME, expectedRevision: 1 }),
        ),
      ).toMatchObject({ changed: true, conversation: { mode: "auto", revision: 2 } });
      await resetState(mf);
      await poll(mf);
      expect(dmPosts(outbound)).toHaveLength(1);
      expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "already_claimed" });
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it("bounded in-flight answers, capacity, expiry, tombstones and automatic-only retention on the real binding", async () => {
    const mf = runtime(freshDir(), [], dmProvider(), { script: manualScript });
    try {
      await seed(mf);
      const reg = await out(
        await dmCall(mf, "/control/register", { account: ME, conversationId: CONV }),
      );
      const handleId = (reg.control as { handleId: string }).handleId;
      const c = await coordinator(mf);
      const now = Date.now();
      for (let i = 0; i < 25; i++)
        await c(claimCall({ inboundMessageId: `in-${i}`, now: now + i }));
      const t = await out(
        await dmCall(mf, `/control/${handleId}/takeover`, { account: ME, expectedRevision: 0 }),
      );
      expect((t.inFlight as unknown[]).length).toBe(20);
      expect(t).toMatchObject({
        inFlightTotal: 25,
        inFlightTruncated: true,
        conversation: { revision: 1 },
      });
      const input = (op: string, inbound: string, at: number) => ({
        operationId: op,
        account: ME,
        generation: GEN,
        conversationId: "conv-cap",
        recipientId: PERSON,
        inboundMessageId: inbound,
        inboundAt: at - 60_000,
        text: "hi",
        digest: DIGEST,
        draftRevision: "r1",
        reviewExpiresAt: at + 600_000,
      });
      for (let i = 0; i < 200; i++)
        expect(
          await c({
            op: "prepareIntent",
            input: input(`op-cap-${String(i).padStart(4, "0")}`, `c-${i}`, now),
            now,
          }),
        ).toHaveProperty("intent");
      expect(
        await c({ op: "prepareIntent", input: input("op-cap-over", "c-over", now), now }),
      ).toEqual({
        error: "capacity",
      });
      // Expiry frees room; expired operations are tombstoned and never claimed.
      const later = now + 600_000;
      expect(
        await c({
          op: "claimConfirm",
          account: ME,
          operationId: "op-cap-0000",
          digest: DIGEST,
          now: later,
        }),
      ).toMatchObject({ claimed: false, intent: { state: "expired" } });
      expect(
        await c({ op: "prepareIntent", input: input("op-cap-over", "c-over", later), now: later }),
      ).toMatchObject({ intent: { state: "prepared" } });
      // 90+ days later an automatic claim alone purges finished intents (tombstoned ids) and keeps the takeover.
      const far = later + RETENTION_MS + 86_400_000;
      expect(
        await c(claimCall({ conversationId: "conv-x", inboundMessageId: "x-1", now: far })),
      ).toMatchObject({
        result: "claimed",
      });
      expect(
        await c({ op: "getIntent", account: ME, operationId: "op-cap-0000", now: far }),
      ).toEqual({
        error: "not_found",
      });
      expect(
        await c({ op: "prepareIntent", input: input("op-cap-0000", "c-0", far), now: far }),
      ).toEqual({
        error: "conflict",
      });
      expect(await c({ op: "status", account: ME, conversationId: CONV, now: far })).toMatchObject({
        conversation: { mode: "human", revision: 1 },
      });
      for (let i = 0; i < 25; i++)
        expect(
          await c(
            claimCall({ inboundMessageId: `in-${i}`, actor: "manual:op-later-01", now: far }),
          ),
        ).toMatchObject({ result: "already_claimed" });
    } finally {
      await mf.dispose();
    }
  }, 180_000);

  it("DT-6B-2C-3-R1: a status read through a verified handle is use; day 89 survives the day-91 purge, unused goes", async () => {
    const mf = runtime(freshDir(), [], dmProvider(), { script: manualScript });
    try {
      await seed(mf);
      const reg = await out(
        await dmCall(mf, "/control/register", { account: ME, conversationId: CONV }),
      );
      const handleId = (reg.control as { handleId: string }).handleId;
      expect(
        await out(
          await dmCall(mf, `/control/${handleId}/takeover`, { account: ME, expectedRevision: 0 }),
        ),
      ).toMatchObject({ changed: true, conversation: { mode: "human", revision: 1 } });
      const c = await coordinator(mf);
      const now = Date.now();
      const idle = (
        (await c({
          op: "registerControl",
          account: ME,
          conversationId: "conv-idle",
          recipientId: PERSON,
          generation: GEN,
          evidenceDigest: DIGEST,
          now,
        })) as { control: { handleId: string } }
      ).control.handleId;
      const day = 86_400_000;
      const recent = now + RETENTION_MS - day;
      expect(await c({ op: "controlStatus", account: ME, handleId, now: recent })).toMatchObject({
        control: { usedAt: new Date(recent).toISOString() },
        conversation: { mode: "human", revision: 1 },
      });
      const late = now + RETENTION_MS + day;
      expect(
        await c(claimCall({ conversationId: "conv-x", inboundMessageId: "x-1", now: late })),
      ).toMatchObject({ result: "claimed" });
      expect(await c({ op: "controlStatus", account: ME, handleId, now: late })).toMatchObject({
        control: { handleId },
        conversation: { mode: "human", revision: 1 },
      });
      expect(await c({ op: "controlStatus", account: ME, handleId: idle, now: late })).toEqual({
        error: "not_found",
      });
    } finally {
      await mf.dispose();
    }
  }, 180_000);
});

describe("DT-6B-2C-3 restart on persisted storage never causes a second manual DM POST", () => {
  type Inject = { ctl?: MCtl; failOps?: string; crash?: boolean };
  /** What the first runtime injects; the durable intent state after it; the first answer (when one arrives). */
  const matrix: [string, Inject, string, Record<string, unknown> | null][] = [
    [
      "storage fails at the claim",
      { failOps: "claimConfirm" },
      "prepared",
      { error: "receipt_unavailable" },
    ],
    [
      "crash with the manual POST in flight",
      { ctl: { hold: true }, crash: true },
      "dispatching",
      null,
    ],
    [
      "crash mid-body after the provider's headers",
      { ctl: { stall: true }, crash: true },
      "dispatching",
      null,
    ],
    [
      "complete success body, settlement lost",
      { failOps: "settleManual" },
      "dispatching",
      {
        intent: { state: "dispatching" },
        observed: { state: "unknown", reason: "receipt" },
        settlement: "pending",
      },
    ],
    [
      "typed refusal observed, settlement lost",
      {
        failOps: "settleManual",
        ctl: { answer: () => json({ error: { code: 10, message: "no" } }, 400) },
      },
      "dispatching",
      {
        intent: { state: "dispatching" },
        observed: { state: "rejected", code: "meta_10" },
        settlement: "pending",
      },
    ],
    ["the receipt committed", {}, "sent", { intent: { state: "sent" } }],
  ];

  for (const [name, inject, durable, first] of matrix)
    it(`${name}: restart shows the truth; repeats, status and the poll never re-POST`, async () => {
      const dir = freshDir();
      const outbound: Outbound[] = [];
      const base = Date.now();
      let mf = runtime(dir, outbound, dmProvider({ base, ...inject.ctl }), {
        script: manualScript,
        failOps: inject.failOps,
      });
      let digest = "";
      try {
        await seed(mf);
        digest = (await mPrepare(mf)).digest;
        if (inject.crash) {
          void mConfirm(mf, OP_A, digest).catch(() => undefined);
          await until(() => dmPosts(outbound).length === 1);
          await new Promise((r) => setTimeout(r, 100));
        } else expect(await mConfirm(mf, OP_A, digest)).toMatchObject(first!);
      } finally {
        await mf.dispose().catch(() => undefined);
      }
      const posted = dmPosts(outbound).length;
      expect(posted).toBe(inject.failOps === "claimConfirm" ? 0 : 1);
      mf = runtime(dir, outbound, dmProvider({ base }), { script: manualScript });
      try {
        expect(await mStatus(mf)).toBe(durable);
        // Never a durable rejected receipt without the settlement.
        expect(await effectState(mf)).toBe(
          durable === "prepared"
            ? "none"
            : `manual:${OP_A}:${durable === "sent" ? "sent" : "claimed"}`,
        );
        const again = await mConfirm(mf, OP_A, digest);
        if (durable === "prepared") {
          // Nothing was claimed: the reviewed operation can still go out, exactly once.
          expect(again).toMatchObject({ intent: { state: "sent" } });
          expect(dmPosts(outbound)).toHaveLength(1);
        } else {
          expect(again).toMatchObject({ intent: { state: durable } });
          expect(dmPosts(outbound)).toHaveLength(posted);
        }
        for (let i = 0; i < 2; i++) {
          await resetState(mf);
          await poll(mf);
        }
        expect(dmPosts(outbound)).toHaveLength(1);
        expect(await pollLog(mf)).toMatchObject({ dm: "skipped", detail: "already_claimed" });
      } finally {
        await mf.dispose();
      }
    }, 120_000);
});
