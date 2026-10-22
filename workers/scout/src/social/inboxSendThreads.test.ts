import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { sealRef } from "./inboxReadCommon";
import {
  openThreadsSendTarget,
  sealThreadsSendTarget,
  THREADS_SEND_TEXT_MAX,
  threadsSendHandler,
  type EligibilityCheck,
} from "./inboxSendThreads";
import { sealSendTarget } from "./inboxSendYouTube";
import { Store } from "./store";
import { ThreadsSendCoordinator } from "./threadsSendCoordinator";
import type { TokenSet } from "./types";

// 📤 Reviewed Threads replies (packet DT-6B-2B-1, planning/tools/37-inbox-send.md): prepare (sealed send target, live
// token, the eligibility gate, bounded text, ONE preflight GET of the reply's ancestry) → review → confirm: an atomic
// create claim before ONE `POST /me/threads` (TEXT container with reply_to_id), the container id made durable, then an
// atomic publish claim before ONE `POST /me/threads_publish`. Uncertainty is unknown_creation or unknown_publication and
// never repeats a stage. Fake KV and fetch; the coordinator is the real ThreadsSendCoordinator over node:sqlite, a new
// instance per call (a restart between every request). Production eligibility is closed; the protocol runs with an
// injected `{ ok: true }` through the handler factory only. No provider is ever contacted.

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-17T09:00:00Z");
const TH = "graph.threads.net/v1.0";
const ME = "25000000000000001";
const ROOT = "90001";
const TARGET = "91001";
const CONTAINER = "17800000000000001";
const PUBLISHED = "18000000000000009";
const LIVE_TOKEN = "th-live-token";
const READ = "threads_basic,threads_manage_insights,threads_read_replies";
const SEND = "/social/inbox/threads/send";
const ALLOW: EligibilityCheck = () => ({ ok: true });

type FakeKV = KVNamespace & { writes: number };

function fakeKV(): FakeKV {
  const m = new Map<string, string>();
  const kv = {
    writes: 0,
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.writes += 1;
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  };
  return kv as unknown as FakeKV;
}

function sqliteStorage(db: DatabaseSync) {
  return {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        const st = db.prepare(query);
        if (/^\s*SELECT|RETURNING/i.test(query)) {
          const rows = st.all(...bindings);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        return { toArray: () => [], rowsWritten: Number(st.run(...bindings).changes) };
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

/** A Durable Object namespace of ThreadsSendCoordinators over node:sqlite, one database per name. */
function fakeCoordinator() {
  const dbs = new Map<string, DatabaseSync>();
  const ns = {
    names: [] as string[],
    ops: [] as string[],
    /** Calls (by `op`) that fail as a storage outage would. */
    failing: new Set<string>(),
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        ns.names.push(id);
        const call = JSON.parse(String(init.body)) as { op: string };
        ns.ops.push(call.op);
        if (ns.failing.has(call.op) || ns.failing.has("*")) throw new Error("storage down");
        if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
        const c = new ThreadsSendCoordinator({ storage: sqliteStorage(dbs.get(id)!) } as never);
        return c.fetch(new Request(url, init));
      },
    }),
  };
  return ns;
}

type Coord = ReturnType<typeof fakeCoordinator>;
type TestEnv = Env & { SOCIAL_KV: FakeKV; THREADS_SEND_COORDINATOR?: unknown };

const makeEnv = (coord: Coord | null = fakeCoordinator()): TestEnv => ({
  SCOUT_TOKEN: TOKEN,
  INBOX_SEAL_SECRET: SEAL,
  ALLOWED_ORIGINS: APP,
  SOCIAL_KV: fakeKV(),
  ...(coord ? { THREADS_SEND_COORDINATOR: coord as unknown as DurableObjectNamespace } : {}),
});

const coordOf = (env: TestEnv) => env.THREADS_SEND_COORDINATOR as unknown as Coord;

async function connect(env: TestEnv, tokens: Partial<TokenSet> = {}, connectedAt?: string) {
  const store = Store.from(env)!;
  await store.putTokens("threads", {
    accessToken: LIVE_TOKEN,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: ME,
    scope: READ,
    ...tokens,
  });
  await store.putStatus("threads", {
    connectedAt: connectedAt ?? "2026-10-01T08:00:00.000Z",
    handle: "3z.prod",
  });
  env.SOCIAL_KV.writes = 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const metaErr = (status: number, code: number, message = `nope ${code}`) =>
  json({ error: { message, type: "OAuthException", code } }, status);

type Handler = (url: URL, init?: RequestInit) => unknown;

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const handler = routes[`${init?.method ?? "GET"} ${url.host}${url.pathname}`];
    if (!handler) return json({ error: { message: `unmocked ${url.pathname}` } }, 404);
    const out = await handler(url, init);
    return out instanceof Response ? out : json(out);
  });
  const calls = () =>
    fn.mock.calls.map(([input, init]) => ({
      method: init?.method ?? "GET",
      url: new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url),
      body: init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : undefined,
    }));
  const posts = () => calls().filter((c) => c.method === "POST");
  return Object.assign(fn, { calls, posts });
}

/** The provider as prepare and confirm see it: a direct reply under the owned post, a container, a publish. */
const threads = (extra: Record<string, Handler> = {}, ancestry: Record<string, unknown> = {}) =>
  mockFetch({
    [`GET ${TH}/${TARGET}`]: () => ({
      id: TARGET,
      root_post: { id: ROOT },
      replied_to: { id: ROOT },
      ...ancestry,
    }),
    [`POST ${TH}/me/threads`]: () => ({ id: CONTAINER }),
    [`POST ${TH}/me/threads_publish`]: () => ({ id: PUBLISHED }),
    ...extra,
  });

function req(path: string, init: RequestInit & { auth?: string | null; origin?: string } = {}) {
  const { auth = TOKEN, origin = APP, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth !== null) headers.set("Authorization", `Bearer ${auth}`);
  headers.set("Origin", origin);
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

/** Through the real router (bearer, origin, routes.ts wiring): production eligibility, closed. */
const run = (env: Env, f: typeof fetch, path: string, init = {}) =>
  handle(req(path, init), env, undefined, { fetch: f, now: () => NOW });

interface Opts {
  eligibility?: EligibilityCheck;
  now?: Date;
}

/** The handler factory directly, with an injected eligibility (the only way the protocol below the gate runs). */
async function send(
  env: TestEnv,
  f: typeof fetch,
  path: string,
  init: RequestInit = {},
  o: Opts = {},
) {
  const r = req(`${SEND}${path}`, init);
  const rest = new URL(r.url).pathname.split("/").filter(Boolean).slice(4);
  const handler = threadsSendHandler({
    fetch: f,
    now: () => o.now ?? NOW,
    eligibility: "eligibility" in o ? o.eligibility : ALLOW,
  });
  const res = await handler(
    r,
    rest,
    {
      store: Store.from(env),
      seal: env.INBOX_SEAL_SECRET,
      coordinator: env.THREADS_SEND_COORDINATOR as DurableObjectNamespace | undefined,
    },
    { json: (b, status) => json(b, status) },
  );
  return res!;
}
const sendPost = (env: TestEnv, f: typeof fetch, path: string, b: unknown, o: Opts = {}) =>
  send(
    env,
    f,
    path,
    { method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json" } },
    o,
  );
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;
type Intent = Record<string, unknown> & { state: string; digest: string };
const intentOf = async (res: Response) => (await body(res)).intent as Intent;

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let opSeq = 0;
const newOp = () => `op-th-${String(++opSeq).padStart(6, "0")}`;

/** A genuine send reference from the owner's own replies listing (inboxReadThreads.ts). */
async function listing(env: TestEnv) {
  const f = mockFetch({
    [`GET ${TH}/me`]: () => ({ id: ME, username: "3z.prod" }),
    [`GET ${TH}/me/threads`]: () => ({ data: [{ id: ROOT, text: "post" }] }),
    [`GET ${TH}/${ROOT}/replies`]: () => ({
      data: [
        { id: TARGET, text: "hi", root_post: { id: ROOT }, replied_to: { id: ROOT } },
        { id: "91002", text: "nested", root_post: { id: ROOT }, replied_to: { id: TARGET } },
      ],
    }),
  });
  const acc = await body(await run(env, f, "/social/inbox/threads/account"));
  const q = `?account=${acc.accountId}&generation=${acc.generation}`;
  const posts = await body(await run(env, f, `/social/inbox/threads/posts${q}`));
  const ref = (posts.items as { ref: string }[])[0].ref;
  const replies = await body(await run(env, f, `/social/inbox/threads/posts/${ref}/replies${q}`));
  const rows = replies.items as { id: string; sendRef?: string }[];
  env.SOCIAL_KV.writes = 0;
  return { generation: acc.generation as string, sendRef: rows[0].sendRef!, rows };
}

async function prepared(
  env: TestEnv,
  f: typeof fetch,
  text = "Thanks for the reply!",
  o: Opts = {},
) {
  const { sendRef } = await listing(env);
  const operationId = newOp();
  const res = await sendPost(
    env,
    f,
    "/prepare",
    { operationId, sendRef, text, draftRevision: "rev-1" },
    o,
  );
  return { operationId, sendRef, intent: await intentOf(res) };
}

const confirm = (
  env: TestEnv,
  f: typeof fetch,
  operationId: string,
  digest: string,
  o: Opts = {},
) => sendPost(env, f, "/confirm", { operationId, digest, account: ME }, o).then(intentOf);
const status = (env: TestEnv, f: typeof fetch, operationId: string) =>
  send(env, f, `/${operationId}?account=${ME}`).then(intentOf);

afterEach(() => {
  vi.useRealTimers();
});

/* ---------- the gate, auth and configuration ---------- */

describe("Threads send: auth, configuration and the production eligibility gate", () => {
  it("refuses a missing bearer and a foreign origin before any provider or coordinator call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({});
    for (const [path, method] of [
      [`${SEND}/prepare`, "POST"],
      [`${SEND}/confirm`, "POST"],
      [`${SEND}/op-00000001?account=${ME}`, "GET"],
      [`${SEND}/op-00000001/cancel`, "POST"],
    ]) {
      expect((await run(env, f, path, { method, auth: null })).status).toBe(401);
      expect((await run(env, f, path, { method, origin: "https://evil.example" })).status).toBe(
        403,
      );
    }
    expect((await run(env, f, `${SEND}/prepare`, { method: "GET" })).status).toBe(405);
    expect((await run(env, f, `${SEND}/confirm`, { method: "DELETE" })).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
    expect(coordOf(env).names).toEqual([]);
  });

  it("names the missing piece: KV, the seal key or the receipt store, distinctly", async () => {
    const f = mockFetch({});
    const noKv = { ...makeEnv(), SOCIAL_KV: undefined } as unknown as TestEnv;
    const noSeal = makeEnv();
    delete noSeal.INBOX_SEAL_SECRET;
    const shortSeal = { ...makeEnv(), INBOX_SEAL_SECRET: "short" };
    const bearerSeal = { ...makeEnv(), INBOX_SEAL_SECRET: TOKEN.padEnd(40, "x") };
    bearerSeal.SCOUT_TOKEN = bearerSeal.INBOX_SEAL_SECRET;
    const noStore = makeEnv(null);
    for (const [env, detail] of [
      [noKv, "kv"],
      [noSeal, "seal"],
      [shortSeal, "seal"],
      [noStore, "receipt-store"],
    ] as const) {
      if (env !== noKv) await connect(env);
      const res = await run(env, f, `${SEND}/prepare`, { method: "POST", body: "{}" });
      expect(res.status).toBe(503);
      expect(await body(res)).toEqual({ error: "not_configured", detail });
    }
    await connect(bearerSeal);
    const res = await handle(
      new Request(`${BASE}${SEND}/prepare`, {
        method: "POST",
        body: "{}",
        headers: { Authorization: `Bearer ${bearerSeal.SCOUT_TOKEN}`, Origin: APP },
      }),
      bearerSeal,
      undefined,
      { fetch: f, now: () => NOW },
    );
    expect(await body(res)).toEqual({ error: "not_configured", detail: "seal" });
    expect(f).not.toHaveBeenCalled();
  });

  it("production preparation fails closed: permission_unverified, zero provider calls, zero receipts", async () => {
    // Every scope the Threads collection lists, canPublish and canReply: none of it is grant evidence.
    const env = makeEnv();
    await connect(env, {
      scope: `${READ},threads_content_publish,threads_manage_replies`,
      canPublish: true,
      canReply: true,
    });
    const { sendRef } = await listing(env);
    const f = threads();
    const prep = await run(env, f, `${SEND}/prepare`, {
      method: "POST",
      body: JSON.stringify({ operationId: newOp(), sendRef, text: "hi", draftRevision: "rev-1" }),
    });
    expect(prep.status).toBe(403);
    expect(await body(prep)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    const conf = await run(env, f, `${SEND}/confirm`, {
      method: "POST",
      body: JSON.stringify({ operationId: newOp(), digest: "a".repeat(64), account: ME }),
    });
    expect(await body(conf)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    // The factory without an injected check is the same closed gate.
    const direct = await sendPost(
      env,
      f,
      "/prepare",
      { operationId: newOp(), sendRef, text: "hi", draftRevision: "rev-1" },
      { eligibility: undefined },
    );
    expect(await body(direct)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    expect(f).not.toHaveBeenCalled();
    expect(coordOf(env).names).toEqual([]);
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("the eligibility check sees the stored tokens and the clock, and is asked again at confirm", async () => {
    const env = makeEnv();
    await connect(env);
    const seen: unknown[] = [];
    const spy: EligibilityCheck = (ctx) => {
      seen.push({ token: ctx.tokens.accessToken, now: ctx.now.toISOString() });
      return { ok: true };
    };
    const f = threads();
    const { operationId, intent } = await prepared(env, f, "hi", { eligibility: spy });
    expect(seen).toEqual([{ token: LIVE_TOKEN, now: NOW.toISOString() }]);
    // Eligibility lost between review and confirm: nothing is claimed or posted.
    const refused = await sendPost(
      env,
      f,
      "/confirm",
      { operationId, digest: intent.digest, account: ME },
      { eligibility: () => ({ ok: false, reason: "permission_unverified" }) },
    );
    expect(await body(refused)).toEqual({
      error: "no_permission",
      detail: "permission_unverified",
    });
    expect(f.posts()).toEqual([]);
    expect((await status(env, f, operationId)).state).toBe("prepared");
  });

  it("no connection is not_connected; an expired token is token_expired, never refreshed, before any call", async () => {
    const env = makeEnv();
    const f = threads();
    const res = await sendPost(env, f, "/prepare", { operationId: newOp() });
    expect(await body(res)).toEqual({ error: "not_connected" });
    await connect(env);
    const { sendRef } = await listing(env);
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    for (const [path, b] of [
      ["/prepare", { operationId: newOp(), sendRef, text: "hi", draftRevision: "rev-1" }],
      ["/confirm", { operationId: newOp(), digest: "a".repeat(64), account: ME }],
    ] as const) {
      const r = await sendPost(env, f, path, b);
      expect(r.status).toBe(409);
      expect(await body(r)).toEqual({ error: "token_expired" });
    }
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
    expect(coordOf(env).names).toEqual([]);
  });
});

/* ---------- prepare ---------- */

describe("Threads send: prepare", () => {
  it("prepares the trimmed text for the sealed target with ONE ancestry GET and no POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    const { intent } = await prepared(env, f, "  Thanks for the reply!  ");
    expect(intent).toMatchObject({
      provider: "threads",
      state: "prepared",
      account: ME,
      rootPostId: ROOT,
      replyToId: TARGET,
      text: "Thanks for the reply!",
      digest: await sha256("Thanks for the reply!"),
      draftRevision: "rev-1",
      reviewExpiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
      receiptVersion: 1,
    });
    const calls = f.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(`${calls[0].url.host}${calls[0].url.pathname}`).toBe(`${TH}/${TARGET}`);
    expect(calls[0].url.searchParams.get("fields")).toBe("id,root_post,replied_to");
    expect(coordOf(env).names.every((n) => n === `threads|${ME}`)).toBe(true);
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("refuses forged, read-kind, YouTube-domain, cross-account and stale refs before any call", async () => {
    const env = makeEnv();
    await connect(env);
    const { sendRef, generation } = await listing(env);
    const f = threads();
    const forged = `${sendRef.split(".")[0]}.${"A".repeat(43)}`;
    const readRef = await sealRef(SEAL, {
      p: "threads",
      a: ME,
      g: generation,
      k: "post",
      id: ROOT,
    });
    const youtube = await sealSendTarget(SEAL, {
      a: ME,
      g: generation,
      t: ROOT,
      v: ROOT,
      c: TARGET,
    });
    const otherKey = await sealThreadsSendTarget("another-seal-0123456789abcdef0123456789", {
      a: ME,
      g: generation,
      r: ROOT,
      t: TARGET,
    });
    for (const ref of [TARGET, forged, readRef, youtube, otherKey, undefined, 5]) {
      const r = await sendPost(env, f, "/prepare", {
        operationId: newOp(),
        sendRef: ref,
        text: "hi",
        draftRevision: "rev-1",
      });
      expect(await body(r)).toEqual({ error: "target_invalid" });
    }
    const otherAccount = await sealThreadsSendTarget(SEAL, {
      a: "25000000000000999",
      g: generation,
      r: ROOT,
      t: TARGET,
    });
    const old = await sealThreadsSendTarget(SEAL, { a: ME, g: "1".repeat(32), r: ROOT, t: TARGET });
    for (const ref of [otherAccount, old]) {
      const r = await sendPost(env, f, "/prepare", {
        operationId: newOp(),
        sendRef: ref,
        text: "hi",
        draftRevision: "rev-1",
      });
      expect(await body(r)).toEqual({ error: "stale" });
    }
    // A reconnect changes the generation: the listing's ref is stale.
    await connect(env, {}, "2026-10-16T00:00:00.000Z");
    const r = await sendPost(env, f, "/prepare", {
      operationId: newOp(),
      sendRef,
      text: "hi",
      draftRevision: "rev-1",
    });
    expect(await body(r)).toEqual({ error: "stale" });
    expect(f).not.toHaveBeenCalled();
    expect(coordOf(env).names).toEqual([]);
  });

  it("a send target opens only in its own domain with path-safe ids", async () => {
    const g = "0".repeat(32);
    const ok = await sealThreadsSendTarget(SEAL, { a: ME, g, r: ROOT, t: TARGET });
    expect(await openThreadsSendTarget(SEAL, ok)).toEqual({ a: ME, g, r: ROOT, t: TARGET });
    for (const bad of [
      { a: ME, g, r: "../x", t: TARGET },
      { a: ME, g, r: ROOT, t: "a.b" },
      { a: ME, g: "zz", r: ROOT, t: TARGET },
    ])
      expect(await openThreadsSendTarget(SEAL, await sealThreadsSendTarget(SEAL, bad))).toBeNull();
    expect(await openThreadsSendTarget(SEAL, "x".repeat(2000))).toBeNull();
  });

  it(`bounds the text at ${THREADS_SEND_TEXT_MAX} Unicode code points (local policy), after trimming`, async () => {
    const env = makeEnv();
    await connect(env);
    const { sendRef } = await listing(env);
    const f = threads();
    const prep = (text: unknown) =>
      sendPost(env, f, "/prepare", {
        operationId: newOp(),
        sendRef,
        text,
        draftRevision: `rev-${newOp()}`,
      }).then(body);
    for (const text of ["", "   ", "\n\t", undefined, 42])
      expect(await prep(text)).toEqual({ error: "text_invalid" });
    // 500 emoji are 1,000 UTF-16 units and 2,000 UTF-8 bytes, still 500 code points; Arabic counts the same way.
    for (const unit of ["😀", "ب", "a"]) {
      const at = unit.repeat(THREADS_SEND_TEXT_MAX);
      expect(((await prep(` ${at} `)).intent as Intent).text).toBe(at);
      expect(await prep(at + unit)).toEqual({ error: "text_invalid" });
    }
    expect(f.posts()).toEqual([]);
  });

  it("refuses malformed operation ids, revisions and bodies before any call", async () => {
    const env = makeEnv();
    await connect(env);
    const { sendRef } = await listing(env);
    const f = threads();
    for (const b of [
      { operationId: "short", sendRef, text: "hi", draftRevision: "rev-1" },
      { operationId: newOp(), sendRef, text: "hi", draftRevision: "bad rev" },
      { operationId: newOp(), sendRef, text: "hi" },
      [],
    ])
      expect(await body(await sendPost(env, f, "/prepare", b))).toEqual({ error: "bad_request" });
    const notJson = await send(env, f, "/prepare", { method: "POST", body: "{" });
    expect(await body(notJson)).toEqual({ error: "bad_request" });
    expect(f).not.toHaveBeenCalled();
  });

  it("missing or mismatched ancestry is target_invalid, a deleted reply not_found; nothing stored or posted", async () => {
    const env = makeEnv();
    await connect(env);
    const { sendRef } = await listing(env);
    for (const [ancestry, extra, error] of [
      [{ root_post: { id: "90002" } }, {}, "target_invalid"],
      [{ root_post: undefined }, {}, "target_invalid"],
      [{ replied_to: { id: "91000" } }, {}, "target_invalid"],
      [{ replied_to: undefined }, {}, "target_invalid"],
      [{ id: "91009" }, {}, "target_invalid"],
      [{}, { [`GET ${TH}/${TARGET}`]: () => metaErr(404, 100) }, "not_found"],
      [{}, { [`GET ${TH}/${TARGET}`]: () => metaErr(401, 190) }, "token_expired"],
      [{}, { [`GET ${TH}/${TARGET}`]: () => metaErr(400, 4) }, "rate_limited"],
      [{}, { [`GET ${TH}/${TARGET}`]: () => metaErr(403, 10) }, "no_permission"],
      [{}, { [`GET ${TH}/${TARGET}`]: () => new Response("<html>", { status: 500 }) }, "upstream"],
      [{}, { [`GET ${TH}/${TARGET}`]: () => [] }, "upstream"],
    ] as const) {
      const f = threads(extra as Record<string, Handler>, ancestry);
      const r = await sendPost(env, f, "/prepare", {
        operationId: newOp(),
        sendRef,
        text: "hi",
        draftRevision: "rev-1",
      });
      expect(await body(r)).toEqual({ error });
      expect(f.posts()).toEqual([]);
      expect(f).toHaveBeenCalledTimes(1);
    }
    expect(coordOf(env).ops.filter((o) => o !== "get")).toEqual([]);
  });

  it("a coordinator outage at prepare is receipt_unavailable, never a send", async () => {
    const env = makeEnv();
    await connect(env);
    coordOf(env).failing.add("prepare");
    const f = threads();
    const { sendRef } = await listing(env);
    const r = await sendPost(env, f, "/prepare", {
      operationId: newOp(),
      sendRef,
      text: "hi",
      draftRevision: "rev-1",
    });
    expect(r.status).toBe(503);
    expect(await body(r)).toEqual({ error: "receipt_unavailable" });
    expect(f.posts()).toEqual([]);
  });

  it("an oversized request body is cancelled at the byte budget before parsing, on every POST route", async () => {
    const env = makeEnv();
    await connect(env);
    for (const path of ["/prepare", "/confirm", "/op-bytes0001/cancel"]) {
      let chunks = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (chunks === 20) return c.close();
          chunks += 1;
          c.enqueue(new TextEncoder().encode("x".repeat(4096)));
        },
        cancel() {
          cancelled = true;
        },
      });
      const f = threads();
      const res = await send(env, f, path, {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit);
      expect(await body(res)).toEqual({ error: "bad_request" });
      expect(chunks).toBeLessThanOrEqual(6);
      expect(cancelled).toBe(true);
      expect(f).not.toHaveBeenCalled();
    }
  });
});

/* ---------- confirm: two stages ---------- */

describe("Threads send: confirm creates once, records the container, publishes once", () => {
  it("POST /me/threads (TEXT, reply_to_id, never auto_publish_text) then POST /me/threads_publish (creation_id)", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    const { operationId, intent } = await prepared(env, f);
    const coord = coordOf(env);
    coord.ops.length = 0;
    const done = await confirm(env, f, operationId, intent.digest);
    expect(done).toMatchObject({
      state: "published",
      containerId: CONTAINER,
      publishedId: PUBLISHED,
      receiptVersion: 5,
    });
    const posts = f.posts();
    expect(posts.map((p) => `${p.url.host}${p.url.pathname}`)).toEqual([
      `${TH}/me/threads`,
      `${TH}/me/threads_publish`,
    ]);
    expect(posts[0].body).toEqual({
      media_type: "TEXT",
      text: "Thanks for the reply!",
      reply_to_id: TARGET,
      access_token: LIVE_TOKEN,
    });
    expect(posts[1].body).toEqual({ creation_id: CONTAINER, access_token: LIVE_TOKEN });
    // The token travels in the form body only, never in a URL.
    for (const c of f.calls().filter((c) => c.method === "POST")) expect(c.url.search).toBe("");
    // Each stage is claimed before its POST, and the container is durable before the publish claim.
    expect(coord.ops).toEqual(["get", "claimCreate", "recordContainer", "claimPublish", "settle"]);
    // Recovery reads the receipt back: no POST, ever again.
    expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({ state: "published" });
    expect(await status(env, f, operationId)).toMatchObject({
      state: "published",
      publishedId: PUBLISHED,
    });
    expect(f.posts()).toHaveLength(2);
  });

  it("two concurrent confirms make one create and one publish; both answer the one operation", async () => {
    const env = makeEnv();
    await connect(env);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const f = threads({
      [`POST ${TH}/me/threads`]: async () => {
        await hold;
        return { id: CONTAINER };
      },
    });
    const { operationId, intent } = await prepared(env, f);
    const x = confirm(env, f, operationId, intent.digest);
    while (!f.posts().length) await new Promise((r) => setImmediate(r));
    const y = await confirm(env, f, operationId, intent.digest);
    expect(y.state).toBe("creating");
    release();
    expect((await x).state).toBe("published");
    expect(f.posts().map((p) => p.url.pathname)).toEqual([
      "/v1.0/me/threads",
      "/v1.0/me/threads_publish",
    ]);
  });

  it("a confirm arriving while the publish is in flight answers publishing and posts nothing", async () => {
    const env = makeEnv();
    await connect(env);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const f = threads({
      [`POST ${TH}/me/threads_publish`]: async () => {
        await hold;
        return { id: PUBLISHED };
      },
    });
    const { operationId, intent } = await prepared(env, f);
    const x = confirm(env, f, operationId, intent.digest);
    while (f.posts().length < 2) await new Promise((r) => setImmediate(r));
    expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({
      state: "publishing",
      containerId: CONTAINER,
    });
    // Cancel cannot claim an in-flight stage.
    const cancelled = await sendPost(env, f, `/${operationId}/cancel`, { account: ME });
    expect((await intentOf(cancelled)).state).toBe("publishing");
    release();
    expect((await x).state).toBe("published");
    expect(f.posts()).toHaveLength(2);
  });

  it("two tabs preparing the same saved draft converge; a changed payload or digest conflicts; zero POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    const { operationId, sendRef, intent } = await prepared(env, f, "hi");
    const other = await sendPost(env, f, "/prepare", {
      operationId: newOp(),
      sendRef,
      text: "hi",
      draftRevision: "rev-1",
    });
    expect((await intentOf(other)).operationId).toBe(operationId);
    const changed = await sendPost(env, f, "/prepare", {
      operationId,
      sendRef,
      text: "changed",
      draftRevision: "rev-1",
    });
    expect(await body(changed)).toEqual({ error: "conflict" });
    const wrong = await sendPost(env, f, "/confirm", {
      operationId,
      digest: "f".repeat(64),
      account: ME,
    });
    expect(await body(wrong)).toEqual({ error: "conflict" });
    expect(f.posts()).toEqual([]);
    expect((await confirm(env, f, operationId, intent.digest)).state).toBe("published");
    expect(f.posts()).toHaveLength(2);
  });

  it("an expired review or a reconnect before confirm posts nothing", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    const a = await prepared(env, f, "first");
    const late = await sendPost(
      env,
      f,
      "/confirm",
      { operationId: a.operationId, digest: a.intent.digest, account: ME },
      { now: new Date(NOW.getTime() + 600_000) },
    );
    expect((await intentOf(late)).state).toBe("expired");
    const b = await prepared(env, f, "second");
    await connect(env, {}, "2026-10-16T00:00:00.000Z");
    const stale = await sendPost(env, f, "/confirm", {
      operationId: b.operationId,
      digest: b.intent.digest,
      account: ME,
    });
    expect(await body(stale)).toEqual({ error: "stale" });
    expect(f.posts()).toEqual([]);
  });

  it("an unknown operation, a malformed account or digest is refused without a POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    expect(
      await body(
        await sendPost(env, f, "/confirm", {
          operationId: newOp(),
          digest: "a".repeat(64),
          account: ME,
        }),
      ),
    ).toEqual({ error: "not_found" });
    for (const b of [
      { operationId: newOp(), digest: "xyz", account: ME },
      { operationId: newOp(), digest: "a".repeat(64), account: "a/b" },
      { operationId: newOp(), digest: "a".repeat(64) },
    ])
      expect(await body(await sendPost(env, f, "/confirm", b))).toEqual({ error: "bad_request" });
    expect(f).not.toHaveBeenCalled();
  });

  it("a coordinator outage before the create claim is receipt_unavailable with zero POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    const { operationId, intent } = await prepared(env, f);
    coordOf(env).failing.add("claimCreate");
    const r = await sendPost(env, f, "/confirm", {
      operationId,
      digest: intent.digest,
      account: ME,
    });
    expect(await body(r)).toEqual({ error: "receipt_unavailable" });
    expect(f.posts()).toEqual([]);
    coordOf(env).failing.clear();
    expect((await status(env, f, operationId)).state).toBe("prepared");
  });
});

/* ---------- uncertainty ---------- */

describe("Threads send: uncertainty is durable and never repeats a stage", () => {
  const confirmWith = async (extra: Record<string, Handler>, coordFail?: string) => {
    const env = makeEnv();
    await connect(env);
    const f = threads(extra);
    const { operationId, intent } = await prepared(env, f);
    if (coordFail) coordOf(env).failing.add(coordFail);
    const first = await confirm(env, f, operationId, intent.digest);
    coordOf(env).failing.clear();
    const again = await confirm(env, f, operationId, intent.digest);
    const st = await status(env, f, operationId);
    return { first, again, status: st, posts: f.posts(), env, f, operationId };
  };

  it("create: a broken connection, a 5xx, a malformed or contradictory success is unknown_creation; no publish", async () => {
    for (const [reply, reason] of [
      [
        () => {
          throw new TypeError("connection reset");
        },
        "network",
      ],
      [() => new Response("oops", { status: 502 }), "server"],
      [() => json({ error: { message: "x", code: 2 } }, 500), "server"],
      [() => new Response("teapot", { status: 418 }), "server"],
      [() => ({ ok: true }), "malformed"],
      [() => ({ id: "" }), "malformed"],
      [() => ({ id: 17800000000000001 }), "malformed"],
      [() => ({ id: "../x" }), "malformed"],
      [() => ({ id: CONTAINER, error: { message: "x" } }), "malformed"],
      [() => new Response("not json", { status: 200 }), "malformed"],
      [() => new Response("x".repeat(300_000), { status: 200 }), "malformed"],
    ] as const) {
      const r = await confirmWith({ [`POST ${TH}/me/threads`]: reply as Handler });
      expect(r.first).toMatchObject({ state: "unknown_creation", unknownReason: reason });
      expect(r.first).not.toHaveProperty("containerId");
      expect(r.again).toMatchObject({ state: "unknown_creation" });
      expect(r.status).toMatchObject({ state: "unknown_creation" });
      expect(r.posts.map((p) => p.url.pathname)).toEqual(["/v1.0/me/threads"]);
    }
  });

  it("create: a documented refusal is rejected with Meta's code and scrubbed words; no publish", async () => {
    const r = await confirmWith({
      [`POST ${TH}/me/threads`]: () =>
        metaErr(
          400,
          100,
          `Invalid reply_to_id ${SEAL} ${LIVE_TOKEN} https://x.example/a?access_token=zz`,
        ),
    });
    expect(r.first).toMatchObject({ state: "rejected", failureCode: "meta_100" });
    expect(r.first).not.toHaveProperty("containerId");
    const text = JSON.stringify([r.first, r.again, r.status]);
    expect(text).not.toContain(SEAL);
    expect(text).not.toContain(LIVE_TOKEN);
    expect(text).not.toContain("access_token=zz");
    expect(r.posts).toHaveLength(1);
  });

  it("create: a POST that outlives 15 seconds is aborted and stays unknown_creation (timeout)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = makeEnv();
    await connect(env);
    const f = threads({
      [`POST ${TH}/me/threads`]: (_u, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    });
    const { operationId, intent } = await prepared(env, f);
    const pending = confirm(env, f, operationId, intent.digest);
    while (!f.posts().length) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(f.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ state: "unknown_creation", unknownReason: "timeout" });
    expect(f.posts()).toHaveLength(1);
  });

  it("create: a container whose receipt cannot be written is unknown_creation; never published or recreated", async () => {
    const r = await confirmWith({}, "recordContainer");
    expect(r.first).toMatchObject({ state: "unknown_creation", unknownReason: "receipt" });
    expect(r.again).toMatchObject({ state: "unknown_creation" });
    expect(r.posts.map((p) => p.url.pathname)).toEqual(["/v1.0/me/threads"]);
  });

  it("create: when both the container receipt and the unknown receipt fail, the claim still holds", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    const { operationId, intent } = await prepared(env, f);
    coordOf(env).failing.add("recordContainer");
    coordOf(env).failing.add("settle");
    expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({
      state: "unknown_creation",
      unknownReason: "receipt",
    });
    coordOf(env).failing.clear();
    // The durable row is still `creating`: never claimable again, so a repeat posts nothing.
    expect((await status(env, f, operationId)).state).toBe("creating");
    expect((await confirm(env, f, operationId, intent.digest)).state).toBe("creating");
    const cancelled = await sendPost(env, f, `/${operationId}/cancel`, { account: ME });
    expect((await intentOf(cancelled)).state).toBe("creating");
    expect(f.posts()).toHaveLength(1);
  });

  it("publish: a broken connection, a 5xx, a malformed or contradictory success is unknown_publication", async () => {
    for (const [reply, reason] of [
      [
        () => {
          throw new TypeError("connection reset");
        },
        "network",
      ],
      [() => new Response("oops", { status: 503 }), "server"],
      [() => ({ ok: true }), "malformed"],
      [() => ({ id: "" }), "malformed"],
      [() => ({ id: PUBLISHED, error: { message: "x" } }), "malformed"],
      [() => new Response("x".repeat(300_000), { status: 200 }), "malformed"],
    ] as const) {
      const r = await confirmWith({ [`POST ${TH}/me/threads_publish`]: reply as Handler });
      expect(r.first).toMatchObject({
        state: "unknown_publication",
        unknownReason: reason,
        containerId: CONTAINER,
      });
      expect(r.again).toMatchObject({ state: "unknown_publication" });
      expect(r.status).toMatchObject({ state: "unknown_publication", containerId: CONTAINER });
      expect(r.status).not.toHaveProperty("publishedId");
      expect(r.posts.map((p) => p.url.pathname)).toEqual([
        "/v1.0/me/threads",
        "/v1.0/me/threads_publish",
      ]);
    }
  });

  it("publish: a documented refusal is rejected and keeps the container id; nothing is retried", async () => {
    const r = await confirmWith({
      [`POST ${TH}/me/threads_publish`]: () => metaErr(400, 24, `Container expired ${LIVE_TOKEN}`),
    });
    expect(r.first).toMatchObject({
      state: "rejected",
      failureCode: "meta_24",
      containerId: CONTAINER,
    });
    expect(JSON.stringify(r.first)).not.toContain(LIVE_TOKEN);
    expect(r.posts).toHaveLength(2);
  });

  it("publish: a POST that outlives 15 seconds is aborted and stays unknown_publication (timeout)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = makeEnv();
    await connect(env);
    const f = threads({
      [`POST ${TH}/me/threads_publish`]: (_u, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    });
    const { operationId, intent } = await prepared(env, f);
    const pending = confirm(env, f, operationId, intent.digest);
    while (f.posts().length < 2) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({ state: "unknown_publication", unknownReason: "timeout" });
    expect(f.posts()).toHaveLength(2);
  });

  it("publish: a success whose receipt cannot be written is unknown_publication; never republished", async () => {
    const r = await confirmWith({}, "settle");
    expect(r.first).toMatchObject({ state: "unknown_publication", unknownReason: "receipt" });
    // The durable row is still `publishing`: the publish claim holds forever.
    expect(r.again).toMatchObject({ state: "publishing", containerId: CONTAINER });
    expect(r.status).toMatchObject({ state: "publishing" });
    expect(r.posts).toHaveLength(2);
  });

  it("a coordinator outage at the publish claim leaves a durable container; the next confirm publishes once", async () => {
    const r = await confirmWith({}, "claimPublish");
    expect(r.posts.map((p) => p.url.pathname)).toEqual([
      "/v1.0/me/threads",
      "/v1.0/me/threads_publish",
    ]);
    expect(r.again).toMatchObject({ state: "published", containerId: CONTAINER });
    expect(r.posts[1].body).toEqual({ creation_id: CONTAINER, access_token: LIVE_TOKEN });
  });
});

/* ---------- resume from created ---------- */

describe("Threads send: resume from a durable container", () => {
  async function created(env: TestEnv) {
    const f = threads();
    const { operationId, intent } = await prepared(env, f);
    const ns = env.THREADS_SEND_COORDINATOR as unknown as DurableObjectNamespace;
    const stub = ns.get(ns.idFromName(`threads|${ME}`));
    const call = (c: unknown) =>
      stub.fetch("https://x/", { method: "POST", body: JSON.stringify(c) }).then((r) => r.json());
    await call({ op: "claimCreate", operationId, digest: intent.digest, now: NOW.getTime() });
    await call({
      op: "recordContainer",
      operationId,
      containerId: CONTAINER,
      now: NOW.getTime(),
    });
    return { operationId, intent };
  }

  it("publishes the stored container once and never recreates it", async () => {
    const env = makeEnv();
    await connect(env);
    const { operationId, intent } = await created(env);
    const f = threads();
    expect((await status(env, f, operationId)).state).toBe("created");
    expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({
      state: "published",
      containerId: CONTAINER,
      publishedId: PUBLISHED,
    });
    expect(f.posts().map((p) => p.url.pathname)).toEqual(["/v1.0/me/threads_publish"]);
    expect(f.posts()[0].body).toEqual({ creation_id: CONTAINER, access_token: LIVE_TOKEN });
    expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({ state: "published" });
    expect(f.posts()).toHaveLength(1);
    // Resuming does not need the ancestry GET again.
    expect(f.calls().filter((c) => c.method === "GET")).toEqual([]);
  });

  it("re-validates eligibility, token, generation and the exact digest before the publish claim", async () => {
    const env = makeEnv();
    await connect(env);
    const { operationId, intent } = await created(env);
    const f = threads();
    const closed = await sendPost(
      env,
      f,
      "/confirm",
      { operationId, digest: intent.digest, account: ME },
      { eligibility: undefined },
    );
    expect(await body(closed)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    const wrong = await sendPost(env, f, "/confirm", {
      operationId,
      digest: "f".repeat(64),
      account: ME,
    });
    expect(await body(wrong)).toEqual({ error: "conflict" });
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    const expired = await sendPost(env, f, "/confirm", {
      operationId,
      digest: intent.digest,
      account: ME,
    });
    expect(await body(expired)).toEqual({ error: "token_expired" });
    await connect(env, {}, "2026-10-16T00:00:00.000Z");
    const stale = await sendPost(env, f, "/confirm", {
      operationId,
      digest: intent.digest,
      account: ME,
    });
    expect(await body(stale)).toEqual({ error: "stale" });
    expect(f).not.toHaveBeenCalled();
    expect((await status(env, f, operationId)).state).toBe("created");
    const cancelled = await sendPost(env, f, `/${operationId}/cancel`, { account: ME });
    expect((await intentOf(cancelled)).state).toBe("created");
  });
});

/* ---------- the current token's account (DT-6B-2B-1-R1, 2B1-1) ---------- */

describe("Threads send: the current token must belong to the reviewed account", () => {
  const OTHER = "25000000000000002";
  const MISMATCH = { error: "account_mismatch", detail: "identity" };

  /**
   * The OAuth callback's real write order (routes.ts): `putTokens` first, `putStatus` after. Between the two, KV holds
   * the new account's token next to the old account's `connectedAt`, so the old sealed ref and intent still pass the
   * generation check. Only the token is replaced here; the status (and so the generation) stays the old account's.
   */
  const otherToken = (env: TestEnv) =>
    Store.from(env)!.putTokens("threads", {
      accessToken: "other-account-token",
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      userId: OTHER,
      scope: READ,
    });
  /** A live token that names no account at all. */
  const unattributedToken = (env: TestEnv) =>
    Store.from(env)!.putTokens("threads", {
      accessToken: "unattributed-token",
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      scope: READ,
    });
  const SWAPS = [otherToken, unattributedToken];

  async function createdOp(env: TestEnv) {
    const { operationId, intent } = await prepared(env, threads());
    const ns = env.THREADS_SEND_COORDINATOR as unknown as DurableObjectNamespace;
    const stub = ns.get(ns.idFromName(`threads|${ME}`));
    for (const c of [
      { op: "claimCreate", operationId, digest: intent.digest, now: NOW.getTime() },
      { op: "recordContainer", operationId, containerId: CONTAINER, now: NOW.getTime() },
    ])
      await stub.fetch("https://x/", { method: "POST", body: JSON.stringify(c) });
    return { operationId, intent };
  }

  it("prepare: another account's token next to the old stamp, or an unattributed token, is refused before the GET", async () => {
    for (const swap of SWAPS) {
      const env = makeEnv();
      await connect(env);
      const { sendRef } = await listing(env);
      await swap(env);
      const f = threads();
      const r = await sendPost(env, f, "/prepare", {
        operationId: newOp(),
        sendRef,
        text: "Exact reviewed text",
        draftRevision: "rev-1",
      });
      expect(r.status).toBe(409);
      expect(await body(r)).toEqual(MISMATCH);
      expect(f).not.toHaveBeenCalled();
      expect(coordOf(env).ops).toEqual([]);
    }
  });

  it("confirm: a prepared intent is never created or published with another account's token or an unattributed one", async () => {
    for (const swap of SWAPS) {
      const env = makeEnv();
      await connect(env);
      const { operationId, intent } = await prepared(env, threads());
      await swap(env);
      const before = coordOf(env).ops.length;
      const f = threads();
      const r = await sendPost(env, f, "/confirm", {
        operationId,
        digest: intent.digest,
        account: ME,
      });
      expect(r.status).toBe(409);
      expect(await body(r)).toEqual(MISMATCH);
      expect(f).not.toHaveBeenCalled();
      expect(coordOf(env).ops.slice(before)).not.toContain("claimCreate");
      expect(coordOf(env).ops.slice(before)).not.toContain("claimPublish");
      // Status stays credential-independent; the operation is untouched and still the owner's to send.
      expect((await status(env, f, operationId)).state).toBe("prepared");
      // The same account again (same stamp, so the same generation): the reviewed operation sends exactly once.
      await connect(env);
      expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({
        state: "published",
        account: ME,
      });
      expect(f.posts().map((p) => p.body?.access_token)).toEqual([LIVE_TOKEN, LIVE_TOKEN]);
    }
  });

  it("created-resume: the publish claim never runs with another account's token or an unattributed one", async () => {
    for (const swap of SWAPS) {
      const env = makeEnv();
      await connect(env);
      const { operationId, intent } = await createdOp(env);
      await swap(env);
      const before = coordOf(env).ops.length;
      const f = threads();
      const r = await sendPost(env, f, "/confirm", {
        operationId,
        digest: intent.digest,
        account: ME,
      });
      expect(r.status).toBe(409);
      expect(await body(r)).toEqual(MISMATCH);
      expect(f).not.toHaveBeenCalled();
      expect(coordOf(env).ops.slice(before)).not.toContain("claimPublish");
      expect((await status(env, f, operationId)).state).toBe("created");
      const cancelled = await sendPost(env, f, `/${operationId}/cancel`, { account: ME });
      expect((await intentOf(cancelled)).state).toBe("created");
      expect(f).not.toHaveBeenCalled();
      await connect(env);
      expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({
        state: "published",
        containerId: CONTAINER,
        account: ME,
      });
      expect(f.posts().map((p) => p.url.pathname)).toEqual(["/v1.0/me/threads_publish"]);
      expect(f.posts()[0].body).toEqual({ creation_id: CONTAINER, access_token: LIVE_TOKEN });
    }
  });

  it("status and cancel keep working for an old handle while another account is connected", async () => {
    const env = makeEnv();
    await connect(env);
    const { operationId } = await prepared(env, threads());
    await otherToken(env);
    const f = mockFetch({});
    expect(await status(env, f, operationId)).toMatchObject({ state: "prepared", account: ME });
    const cancelled = await sendPost(env, f, `/${operationId}/cancel`, { account: ME });
    expect(await intentOf(cancelled)).toMatchObject({ state: "cancelled", account: ME });
    expect(f).not.toHaveBeenCalled();
  });
});

/* ---------- status and cancel ---------- */

describe("Threads send: status and cancel make zero provider calls", () => {
  it("status returns the intent and cancel ends only a prepared one, with an expired token too", async () => {
    const env = makeEnv();
    await connect(env);
    const f = threads();
    const { operationId, intent } = await prepared(env, f);
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    const g = mockFetch({});
    expect(await status(env, g, operationId)).toMatchObject({ state: "prepared" });
    const cancelled = await intentOf(
      await sendPost(env, g, `/${operationId}/cancel`, { account: ME }),
    );
    expect(cancelled).toMatchObject({ state: "cancelled" });
    await connect(env);
    expect(await confirm(env, f, operationId, intent.digest)).toMatchObject({ state: "cancelled" });
    expect(g).not.toHaveBeenCalled();
    expect(f.posts()).toEqual([]);
  });

  it("status and cancel refuse a malformed operation or account and answer not_found for an unknown one", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({});
    expect(await body(await send(env, f, `/bad?account=${ME}`))).toEqual({ error: "bad_request" });
    expect(await body(await send(env, f, `/${newOp()}?account=a/b`))).toEqual({
      error: "bad_request",
    });
    expect(await body(await send(env, f, `/${newOp()}`))).toEqual({ error: "bad_request" });
    expect(await body(await sendPost(env, f, `/${newOp()}/cancel`, {}))).toEqual({
      error: "bad_request",
    });
    expect(await body(await send(env, f, `/${newOp()}?account=${ME}`))).toEqual({
      error: "not_found",
    });
    expect(await send(env, f, `/a/b/c`)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
