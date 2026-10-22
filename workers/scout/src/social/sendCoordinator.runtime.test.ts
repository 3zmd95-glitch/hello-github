import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RETENTION_MS, type CoordinatorAnswer, type CoordinatorCall } from "./sendCoordinator";
import { Store } from "./store";

// 📤 DT-6B-2A runtime proof (planning/tools/37-inbox-send.md): the real Worker entry (src/index.ts, bundled) running in
// workerd through the Miniflare that ships with our pinned Wrangler (the tiktokProbe.runtime.test.ts approach; no new
// dependency), with the SEND_COORDINATOR binding and SQLite class read from wrangler.jsonc, on-disk Durable Object
// storage that outlives a runtime restart, and every outbound request answered by a fake Google. No provider is ever
// contacted. `@cloudflare/vitest-pool-workers` is not in the offline store; this uses the same workerd engine.

const requireRuntime = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireRuntime("miniflare");
const { build } = requireRuntime("esbuild");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TOKEN = "runtime-scout-token";
const SEAL = "runtime-seal-0123456789abcdef0123456789abcdef";
const APP = "http://localhost:3000";
const CH = "UCruntimeruntimeruntime1";
const T0 = Date.parse("2026-10-17T09:00:00Z");
const D = "a".repeat(64);

interface Outbound {
  method: string;
  url: string;
  body: string;
}

let script = "";
let durableObjects: Record<string, { className: string; useSQLite: boolean }> = {};
const dirs: string[] = [];

beforeAll(async () => {
  // The binding and the migration come from wrangler.jsonc itself, as `wrangler dev` / deploy would read them.
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
  expect(sqlite.get("SendCoordinator")).toBe(true);
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
});

function runtime(persist: string, outbound: Outbound[], google: (r: Request) => Promise<Response>) {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-01",
      script,
      durableObjects,
      // On-disk Durable Object and KV storage (Miniflare 5's shared persistence root), kept across runtimes.
      resourcePersistencePath: persist,
      kvNamespaces: ["SOCIAL_KV"],
      bindings: { SCOUT_TOKEN: TOKEN, INBOX_SEAL_SECRET: SEAL, ALLOWED_ORIGINS: APP },
      // Every outbound request is intercepted; this test cannot contact a provider.
      outboundService: async (request: Request) => {
        outbound.push({
          method: request.method,
          url: request.url,
          body: request.method === "POST" ? await request.clone().text() : "",
        });
        return google(request);
      },
    }),
  );
}

const freshDir = () => {
  const d = mkdtempSync(join(tmpdir(), "send-coordinator-"));
  dirs.push(d);
  return d;
};

type MF = ReturnType<typeof runtime>;

async function coordinator(mf: MF, name = `youtube|${CH}`) {
  const ns = await mf.getDurableObjectNamespace("SEND_COORDINATOR");
  const stub = ns.get(ns.idFromName(name));
  return async (call: CoordinatorCall): Promise<CoordinatorAnswer> => {
    const res = await stub.fetch("https://send-coordinator/", {
      method: "POST",
      body: JSON.stringify(call),
    });
    return (await res.json()) as CoordinatorAnswer;
  };
}

const prepareCall = (operationId: string, over: Record<string, unknown> = {}, now = T0) =>
  ({
    op: "prepare",
    input: {
      operationId,
      provider: "youtube",
      account: CH,
      generation: "0".repeat(32),
      threadId: "UgThreadX",
      videoId: "vid1",
      parentCommentId: "UgTop1",
      text: "Thanks!",
      digest: D,
      draftRevision: "rev-1",
      reviewExpiresAt: now + 600_000,
      ...over,
    },
    now,
  }) as CoordinatorCall;

const noGoogle = async () => new Response("no", { status: 599 });

describe("SendCoordinator in workerd (SQLite storage from wrangler.jsonc)", () => {
  it("loads the real entry with its binding; prepare is idempotent; two concurrent claims dispatch once; settle once", async () => {
    const outbound: Outbound[] = [];
    const mf = runtime(freshDir(), outbound, noGoogle);
    try {
      const call = await coordinator(mf);
      const first = await call(prepareCall("op-runtime-1"));
      expect(first).toMatchObject({ intent: { operationId: "op-runtime-1", state: "prepared" } });
      expect(await call(prepareCall("op-runtime-1"))).toEqual(first);
      expect(
        await call(prepareCall("op-runtime-1", { text: "changed", digest: "b".repeat(64) })),
      ).toEqual({
        error: "conflict",
      });
      expect(await call(prepareCall("op-runtime-2"))).toMatchObject({
        intent: { operationId: "op-runtime-1" },
      });
      const claim = () => call({ op: "claim", operationId: "op-runtime-1", digest: D, now: T0 });
      const claims = await Promise.all([claim(), claim(), claim()]);
      expect(claims.filter((c) => "claimed" in c && c.claimed)).toHaveLength(1);
      for (const c of claims) expect(c).toMatchObject({ intent: { state: "dispatching" } });
      const settle = (state: "sent" | "rejected") =>
        call({
          op: "settle",
          operationId: "op-runtime-1",
          outcome:
            state === "sent"
              ? { state, providerCommentId: "UgTop1.r9" }
              : { state, code: "forbidden" },
          now: T0 + 1,
        });
      const settled = await Promise.all([settle("sent"), settle("rejected")]);
      expect(settled.filter((s) => "settled" in s && s.settled)).toHaveLength(1);
      const final = await call({ op: "get", operationId: "op-runtime-1", now: T0 + 2 });
      expect(final).toMatchObject({ intent: { state: "sent", providerCommentId: "UgTop1.r9" } });
      expect(outbound).toEqual([]);
    } finally {
      await mf.dispose();
    }
  }, 60_000);

  it("keeps a claim, a receipt and a tombstone across a runtime restart on the same storage", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    let mf = runtime(dir, outbound, noGoogle);
    try {
      const call = await coordinator(mf);
      await call(prepareCall("op-claimed-1"));
      expect(
        await call({ op: "claim", operationId: "op-claimed-1", digest: D, now: T0 }),
      ).toMatchObject({
        claimed: true,
      });
      await call(prepareCall("op-sent-01", { draftRevision: "rev-2" }));
      await call({ op: "claim", operationId: "op-sent-01", digest: D, now: T0 });
      await call({
        op: "settle",
        operationId: "op-sent-01",
        outcome: { state: "sent", providerCommentId: "c-1" },
        now: T0,
      });
    } finally {
      await mf.dispose();
    }
    // A new runtime, a new stub, the same object id: the claim is still held and can never be claimed again.
    mf = runtime(dir, outbound, noGoogle);
    try {
      const call = await coordinator(mf);
      expect(await call({ op: "get", operationId: "op-claimed-1", now: T0 + 5_000 })).toMatchObject(
        {
          intent: { state: "dispatching" },
        },
      );
      expect(
        await call({ op: "claim", operationId: "op-claimed-1", digest: D, now: T0 + 5_000 }),
      ).toMatchObject({
        claimed: false,
        intent: { state: "dispatching" },
      });
      // Past retention the sent row is purged; its id and its submission stay blocked.
      const later = T0 + RETENTION_MS + 60_000;
      await call(prepareCall("op-other-1", { draftRevision: "rev-3" }, later));
      expect(await call({ op: "get", operationId: "op-sent-01", now: later })).toEqual({
        error: "not_found",
      });
      expect(await call(prepareCall("op-sent-01", { draftRevision: "rev-2" }, later))).toEqual({
        error: "conflict",
      });
      expect(await call(prepareCall("op-sent-02", { draftRevision: "rev-2" }, later))).toEqual({
        error: "conflict",
      });
      // The uncertain claim is never purged.
      expect(await call({ op: "get", operationId: "op-claimed-1", now: later })).toMatchObject({
        intent: { state: "dispatching" },
      });
    } finally {
      await mf.dispose();
    }
    expect(outbound).toEqual([]);
  }, 60_000);
});

describe("the send routes in workerd with a fake Google", () => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

  function google(posts: { hold?: Promise<void> } = {}) {
    return async (r: Request): Promise<Response> => {
      const u = new URL(r.url);
      if (u.host !== "www.googleapis.com") return new Response("blocked", { status: 599 });
      if (u.pathname.endsWith("/channels"))
        return json({
          items: [
            {
              id: CH,
              snippet: { title: "3z" },
              contentDetails: { relatedPlaylists: { uploads: "UUruntime" } },
            },
          ],
        });
      if (u.pathname.endsWith("/playlistItems"))
        return json({ items: [{ snippet: { title: "v" }, contentDetails: { videoId: "vid1" } }] });
      const top = {
        id: "UgTop1",
        snippet: { textDisplay: "hi", publishedAt: "2026-10-16T09:00:00Z" },
      };
      if (u.pathname.endsWith("/commentThreads") && u.searchParams.get("videoId"))
        return json({
          items: [{ id: "UgThreadX", snippet: { totalReplyCount: 0, topLevelComment: top } }],
        });
      if (u.pathname.endsWith("/commentThreads") && u.searchParams.get("id") === "UgThreadX")
        return json({
          items: [
            {
              id: "UgThreadX",
              snippet: {
                channelId: CH,
                videoId: "vid1",
                canReply: true,
                isPublic: true,
                topLevelComment: top,
              },
            },
          ],
        });
      if (u.pathname.endsWith("/comments") && r.method === "POST") {
        await posts.hold;
        return json({ id: "UgTop1.runtimeReply", snippet: { parentId: "UgTop1" } });
      }
      return json({ error: { message: "unmocked" } }, 404);
    };
  }

  const call = (mf: MF, path: string, init: RequestInit = {}) =>
    mf.dispatchFetch(`https://scout.test${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: APP,
        "Content-Type": "application/json",
      },
    });
  interface Body {
    intent: Record<string, string>;
    capabilities: Record<string, string>;
    channels: Record<string, string>[];
    items: Record<string, string>[];
  }
  const read = async (res: Response) => (await res.json()) as Body;

  async function seed(mf: MF) {
    const kv = await mf.getKVNamespace("SOCIAL_KV");
    const store = new Store(kv, TOKEN);
    await store.putTokens("youtube", {
      accessToken: "runtime-yt-token",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_000_000).toISOString(),
      scope:
        "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl",
    });
    await store.putStatus("youtube", { connectedAt: "2026-10-01T08:00:00.000Z" });
  }

  it("prepare → two concurrent confirms → one POST; after a restart the receipt recovers without a resend", async () => {
    const dir = freshDir();
    const outbound: Outbound[] = [];
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let mf = runtime(dir, outbound, google({ hold }));
    let operationId = "";
    try {
      await seed(mf);
      const acc = await read(await call(mf, "/social/inbox/youtube/account"));
      expect(acc.capabilities).toEqual({ comments: "ok", sendComments: "ok" });
      const ch = acc.channels[0];
      const q = `?account=${ch.accountId}&generation=${ch.generation}`;
      const vids = await read(
        await call(mf, `/social/inbox/youtube/videos${q}&uploads=${ch.uploads}`),
      );
      const threads = await read(
        await call(mf, `/social/inbox/youtube/videos/${vids.items[0].ref}/threads${q}`),
      );
      const sendRef = threads.items[0].sendRef as string;
      operationId = "op-runtime-send-1";
      const prepared = await read(
        await call(mf, "/social/inbox/youtube/send/prepare", {
          method: "POST",
          body: JSON.stringify({
            operationId,
            sendRef,
            text: " Thank you! ",
            draftRevision: "rev-1",
          }),
        }),
      );
      expect(prepared.intent).toMatchObject({
        state: "prepared",
        text: "Thank you!",
        parentCommentId: "UgTop1",
      });
      expect(outbound.filter((o) => o.method === "POST")).toEqual([]);
      const confirm = () =>
        call(mf, "/social/inbox/youtube/send/confirm", {
          method: "POST",
          body: JSON.stringify({ operationId, digest: prepared.intent.digest, account: CH }),
        }).then(read);
      const a = confirm();
      const b = confirm();
      const firstDone = await Promise.race([a, b]);
      expect(firstDone.intent.state).toBe("dispatching");
      release();
      const states = (await Promise.all([a, b])).map((r) => r.intent.state).sort();
      expect(states).toEqual(["dispatching", "sent"]);
      const posts = outbound.filter((o) => o.method === "POST");
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe("https://www.googleapis.com/youtube/v3/comments?part=snippet");
      expect(JSON.parse(posts[0].body)).toEqual({
        snippet: { parentId: "UgTop1", textOriginal: "Thank you!" },
      });
    } finally {
      await mf.dispose();
    }
    mf = runtime(dir, outbound, google());
    try {
      const status = await read(
        await call(mf, `/social/inbox/youtube/send/${operationId}?account=${CH}`),
      );
      expect(status.intent).toMatchObject({
        state: "sent",
        providerCommentId: "UgTop1.runtimeReply",
      });
      const again = await read(
        await call(mf, "/social/inbox/youtube/send/confirm", {
          method: "POST",
          body: JSON.stringify({ operationId, digest: status.intent.digest, account: CH }),
        }),
      );
      expect(again.intent.state).toBe("sent");
      expect(outbound.filter((o) => o.method === "POST")).toHaveLength(1);
      for (const o of outbound) expect(new URL(o.url).host).toBe("www.googleapis.com");
    } finally {
      await mf.dispose();
    }
  }, 90_000);
});
