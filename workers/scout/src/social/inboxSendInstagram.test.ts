import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { instagramSendHandler, type EligibilityCheck } from "./inboxSendInstagram";
import { PAGE_BYTES_MAX } from "./inboxRead";
import { IG_SEND_TEXT_MAX, IG_VERIFY_PAGE } from "./instagramPublicSend";
import { InstagramPublicSendCoordinator } from "./instagramPublicSendCoordinator";
import { Store } from "./store";
import type { TokenSet } from "./types";

// 📤 Reviewed Instagram public comment replies (packet DT-6B-2C-1, planning/tools/37-inbox-send.md): prepare (live token
// and connection captured once, the closed-by-default eligibility gate, bounded text, ≤ 3 bounded ownership GETs, a
// recheck of token/connection before the receipt) → review → confirm (the same checks again, a recheck immediately
// before the claim, then ONE transaction: intent dispatching + the shared (account, comment) public effect) → ONE POST.
// The coordinator is the real InstagramPublicSendCoordinator over node:sqlite, a new instance per call. Fake KV and
// fetch: no provider is ever contacted. Production eligibility is closed; the protocol runs through the handler factory
// with an injected `{ ok: true }` only.

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-17T09:00:00Z");
const IG = "graph.instagram.com/v21.0";
/** `/me`'s user_id: the Instagram account the token acts as. */
const ME = "17841000000000001";
/** The OAuth `tokens.userId` fixture: deliberately NOT the /me identity. */
const OAUTH_USER = "26000000000000009";
const MEDIA = "18000000000000001";
const COMMENT = "17900000000000001";
const REPLY = "17950000000000001";
const LIVE_TOKEN = "ig-live-token-xyz";
const SEND = "/social/inbox/instagram/send";
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

/** A Durable Object namespace of InstagramPublicSendCoordinators over node:sqlite, one database per name. */
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
        const c = new InstagramPublicSendCoordinator({
          storage: sqliteStorage(dbs.get(id)!),
        } as never);
        return c.fetch(new Request(url, init));
      },
    }),
  };
  return ns;
}

type Coord = ReturnType<typeof fakeCoordinator>;
type TestEnv = Env & { SOCIAL_KV: FakeKV };

const makeEnv = (coord: Coord | null = fakeCoordinator()): TestEnv => ({
  SCOUT_TOKEN: TOKEN,
  INBOX_SEAL_SECRET: SEAL,
  ALLOWED_ORIGINS: APP,
  SOCIAL_KV: fakeKV(),
  ...(coord
    ? { INSTAGRAM_PUBLIC_SEND_COORDINATOR: coord as unknown as DurableObjectNamespace }
    : {}),
});

const coordOf = (env: TestEnv) => env.INSTAGRAM_PUBLIC_SEND_COORDINATOR as unknown as Coord;
const direct = async (env: TestEnv, call: Record<string, unknown>) => {
  const ns = env.INSTAGRAM_PUBLIC_SEND_COORDINATOR!;
  const res = await ns.get(ns.idFromName(`instagram|${ME}`)).fetch("https://c/", {
    method: "POST",
    body: JSON.stringify({ now: NOW.getTime(), ...call }),
  });
  return (await res.json()) as Record<string, unknown>;
};

async function connect(env: TestEnv, tokens: Partial<TokenSet> = {}, connectedAt?: string) {
  const store = Store.from(env)!;
  await store.putTokens("instagram", {
    accessToken: LIVE_TOKEN,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: OAUTH_USER,
    scope:
      "instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages",
    canReply: true,
    canPublish: true,
    ...tokens,
  });
  await store.putStatus("instagram", {
    connectedAt: connectedAt ?? "2026-10-01T08:00:00.000Z",
    handle: "3z.prod",
  });
  env.SOCIAL_KV.writes = 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  const gets = () => calls().filter((c) => c.method === "GET");
  return Object.assign(fn, { calls, posts, gets });
}

/** The provider: /me, the owned-media first page, the comment first page, and the reply POST. */
const instagram = (extra: Record<string, Handler> = {}) =>
  mockFetch({
    [`GET ${IG}/me`]: () => ({ user_id: ME, username: "3z.prod" }),
    [`GET ${IG}/${ME}/media`]: () => ({ data: [{ id: "18000000000000002" }, { id: MEDIA }] }),
    [`GET ${IG}/${MEDIA}/comments`]: () => ({ data: [{ id: COMMENT }] }),
    [`POST ${IG}/${COMMENT}/replies`]: () => ({ id: REPLY }),
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
  /** A clock read afresh on every call (DT-6B-2C-1-R1); wins over `now`. */
  clock?: () => Date;
}

async function send(
  env: TestEnv,
  f: typeof fetch,
  path: string,
  init: RequestInit = {},
  o: Opts = {},
) {
  const r = req(`${SEND}${path}`, init);
  const rest = new URL(r.url).pathname.split("/").filter(Boolean).slice(4);
  const handler = instagramSendHandler({
    fetch: f,
    now: () => o.clock?.() ?? o.now ?? NOW,
    eligibility: "eligibility" in o ? o.eligibility : ALLOW,
  });
  const res = await handler(
    r,
    rest,
    {
      store: Store.from(env),
      seal: env.INBOX_SEAL_SECRET,
      coordinator: env.INSTAGRAM_PUBLIC_SEND_COORDINATOR,
    },
    { json: (b, status) => json(b, status) },
  );
  return res!;
}
const post = (env: TestEnv, f: typeof fetch, path: string, b: unknown, o: Opts = {}) =>
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

let opSeq = 0;
const newOp = () => `op-ig-${String(++opSeq).padStart(6, "0")}`;

const prepareBody = (operationId: string, over: Record<string, unknown> = {}) => ({
  operationId,
  account: ME,
  mediaId: MEDIA,
  commentId: COMMENT,
  text: "  Thanks so much! 🎬  ",
  draftRevision: "rev-1",
  ...over,
});
const prepare = (
  env: TestEnv,
  f: typeof fetch,
  op: string,
  over: Record<string, unknown> = {},
  o: Opts = {},
) => post(env, f, "/prepare", prepareBody(op, over), o);
const confirm = (env: TestEnv, f: typeof fetch, op: string, digest: string, o: Opts = {}) =>
  post(env, f, "/confirm", { operationId: op, digest, account: ME }, o);

afterEach(() => {
  vi.useRealTimers();
});

/* ---------- auth, configuration, the gate ---------- */

describe("Instagram send: auth, configuration and the production eligibility gate", () => {
  it("refuses a missing bearer and a foreign origin before any provider or coordinator call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
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
    expect(f).not.toHaveBeenCalled();
    expect(coordOf(env).names).toEqual([]);
  });

  it("production preparation and confirmation fail closed: permission_unverified, zero provider calls, zero receipts", async () => {
    const env = makeEnv();
    // Every reply scope granted and canReply: still not permission evidence.
    await connect(env);
    const f = instagram();
    for (const path of ["/prepare", "/confirm"]) {
      const res = await run(env, f, `${SEND}${path}`, {
        method: "POST",
        body: JSON.stringify({ ...prepareBody("op-gate-0001"), digest: "a".repeat(64) }),
      });
      expect(res.status).toBe(403);
      expect(await body(res)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    }
    // The factory without an injected eligibility is the same closed gate.
    const res = await prepare(env, f, "op-gate-0002", {}, { eligibility: undefined });
    expect(await body(res)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    expect(f).not.toHaveBeenCalled();
    expect(coordOf(env).names).toEqual([]);
  });

  it("names the missing piece: KV or the receipt store; not connected and expired tokens before any call", async () => {
    const f = instagram();
    const noKv = { ...makeEnv(), SOCIAL_KV: undefined } as unknown as TestEnv;
    expect(await body(await prepare(noKv, f, newOp()))).toEqual({
      error: "not_configured",
      detail: "kv",
    });
    const noCoord = makeEnv(null);
    await connect(noCoord);
    expect(await body(await prepare(noCoord, f, newOp()))).toEqual({
      error: "not_configured",
      detail: "receipt-store",
    });
    const env = makeEnv();
    expect(await body(await prepare(env, f, newOp()))).toEqual({ error: "not_connected" });
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    expect(await body(await prepare(env, f, newOp()))).toEqual({ error: "token_expired" });
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("the eligibility check sees the stored tokens and the clock, and is asked again at confirm", async () => {
    const env = makeEnv();
    await connect(env);
    const seen: string[] = [];
    const check: EligibilityCheck = ({ tokens, now }) => {
      seen.push(`${tokens.accessToken}@${now.toISOString()}`);
      return { ok: true };
    };
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op, {}, { eligibility: check }));
    await confirm(env, f, op, intent.digest, { eligibility: check });
    expect(seen).toEqual([
      `${LIVE_TOKEN}@${NOW.toISOString()}`,
      `${LIVE_TOKEN}@${NOW.toISOString()}`,
    ]);
    // Closed at confirm: no claim, no POST.
    const op2 = newOp();
    const i2 = await intentOf(await prepare(env, f, op2, { draftRevision: "rev-2" }));
    const shut = await confirm(env, f, op2, i2.digest, {
      eligibility: () => ({ ok: false, reason: "permission_unverified" }),
    });
    expect(await body(shut)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    expect(f.posts()).toHaveLength(1);
  });
});

/* ---------- prepare ---------- */

describe("Instagram send: prepare proves the target within ≤ 3 bounded GETs and stores the exact intent", () => {
  it("identity is /me's user_id (not the OAuth user id); the trimmed text, digest and target are stored; no POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const res = await prepare(env, f, op);
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.verification).toEqual({ window: "first-page", pageSize: IG_VERIFY_PAGE });
    expect(b.intent).toMatchObject({
      operationId: op,
      provider: "instagram",
      account: ME,
      mediaId: MEDIA,
      commentId: COMMENT,
      text: "Thanks so much! 🎬",
      draftRevision: "rev-1",
      state: "prepared",
      receiptVersion: 1,
      reviewExpiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    const digest = (b.intent as Intent).digest;
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("Thanks so much! 🎬"));
    expect(digest).toBe(
      [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""),
    );
    expect(f.gets()).toHaveLength(3);
    expect(f.posts()).toEqual([]);
    expect(coordOf(env).names.every((n) => n === `instagram|${ME}`)).toBe(true);
    expect(JSON.stringify(b)).not.toContain(LIVE_TOKEN);
  });

  it("an account that is not the token's /me identity (e.g. the OAuth user id) is account_mismatch; nothing stored", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const res = await prepare(env, f, newOp(), { account: OAUTH_USER });
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual({ error: "account_mismatch", detail: "identity" });
    expect(coordOf(env).ops).toEqual([]);
    expect(f.posts()).toEqual([]);
  });

  it("forged or legacy selectors outside the first pages are target_unverified (outside-local-window); nothing stored", async () => {
    const env = makeEnv();
    await connect(env);
    for (const over of [
      { mediaId: "18000000000000777" },
      { commentId: "17900000000000777" },
      // A comment that exists, but under another media of the account.
      { mediaId: "18000000000000002" },
    ]) {
      const f = instagram({
        [`GET ${IG}/18000000000000002/comments`]: () => ({ data: [{ id: "1" }] }),
      });
      const res = await prepare(env, f, newOp(), over);
      expect(res.status).toBe(409);
      expect(await body(res)).toEqual({
        error: "target_unverified",
        detail: "outside-local-window",
      });
      expect(f.calls().length).toBeLessThanOrEqual(3);
      expect(f.posts()).toEqual([]);
    }
    expect(coordOf(env).ops).toEqual([]);
  });

  it("refuses malformed ids, operation ids, revisions, text and bodies before any call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    for (const over of [
      { operationId: "short" },
      { draftRevision: "has space" },
      { account: "../x" },
      { mediaId: "a/b" },
      { commentId: 5 },
    ])
      expect(await body(await prepare(env, f, newOp(), over))).toEqual({ error: "bad_request" });
    for (const text of ["   ", "", 7, "x".repeat(IG_SEND_TEXT_MAX + 1)])
      expect(await body(await prepare(env, f, newOp(), { text }))).toEqual({
        error: "text_invalid",
      });
    // Code points, not UTF-16 units: 1000 emoji fit.
    expect((await prepare(env, f, newOp(), { text: "🎬".repeat(IG_SEND_TEXT_MAX) })).status).toBe(
      200,
    );
    expect(await body(await send(env, f, "/prepare", { method: "POST", body: "[1]" }))).toEqual({
      error: "bad_request",
    });
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
      const f = instagram();
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

  it("a reconnect while the GETs run (token or connection stamp, either write first) is refused before the receipt", async () => {
    for (const write of ["token", "status"] as const) {
      const env = makeEnv();
      await connect(env);
      const store = Store.from(env)!;
      const f = instagram({
        [`GET ${IG}/${MEDIA}/comments`]: async () => {
          if (write === "token")
            await store.putTokens("instagram", {
              ...(await store.getTokens("instagram"))!,
              accessToken: "other-account-token",
            });
          else await store.putStatus("instagram", { connectedAt: "2026-10-17T08:59:00.000Z" });
          return { data: [{ id: COMMENT }] };
        },
      });
      const res = await prepare(env, f, newOp());
      expect(await body(res)).toEqual({ error: "stale", detail: "reconnected" });
      expect(coordOf(env).ops).toEqual([]);
    }
  });

  it("refusals during verification are mapped and never echo the token or the seal", async () => {
    const env = makeEnv();
    await connect(env);
    const cases: [Handler, string][] = [
      [() => json({ error: { message: `dead ${LIVE_TOKEN}`, code: 190 } }, 401), "token_expired"],
      [() => json({ error: { message: "slow", code: 4 } }, 400), "rate_limited"],
      [() => json({ error: { message: `x ${SEAL}`, code: 1 } }, 500), "upstream"],
      [() => new Response("x".repeat(PAGE_BYTES_MAX + 1)), "upstream"],
    ];
    for (const [handler, error] of cases) {
      const res = await prepare(env, instagram({ [`GET ${IG}/me`]: handler }), newOp());
      const b = await body(res);
      expect(b.error).toBe(error);
      expect(JSON.stringify(b)).not.toContain(LIVE_TOKEN);
      expect(JSON.stringify(b)).not.toContain(SEAL);
    }
    expect(coordOf(env).ops).toEqual([]);
  });

  it("two tabs preparing the same draft converge; a changed payload under one operation conflicts", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const a = await intentOf(await prepare(env, f, op));
    expect((await intentOf(await prepare(env, f, newOp()))).operationId).toBe(op);
    expect(await body(await prepare(env, f, op, { text: "other" }))).toEqual({ error: "conflict" });
    expect((await intentOf(await prepare(env, f, op))).digest).toBe(a.digest);
    expect(f.posts()).toEqual([]);
  });

  it("a coordinator outage at prepare is receipt_unavailable, never a send", async () => {
    const env = makeEnv();
    await connect(env);
    coordOf(env).failing.add("prepare");
    const f = instagram();
    expect(await body(await prepare(env, f, newOp()))).toEqual({ error: "receipt_unavailable" });
    expect(f.posts()).toEqual([]);
  });
});

/* ---------- confirm ---------- */

describe("Instagram send: confirm claims the shared public effect once, then ONE POST", () => {
  it("re-verifies, claims, posts the exact stored text once, and records the reply id", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    const res = await confirm(env, f, op, intent.digest);
    expect(res.status).toBe(200);
    expect(await intentOf(res)).toMatchObject({
      state: "sent",
      providerReplyId: REPLY,
      receiptVersion: 3,
    });
    // 3 GETs at prepare, 3 at confirm, then the one POST.
    expect(f.gets()).toHaveLength(6);
    expect(f.posts().map((p) => p.body)).toEqual([
      { message: "Thanks so much! 🎬", access_token: LIVE_TOKEN },
    ]);
    expect(f.posts()[0].url.search).toBe("");
    expect(await direct(env, { op: "getEffect", account: ME, commentId: COMMENT })).toMatchObject({
      effect: { actor: `manual:${op}`, state: "sent", providerReplyId: REPLY },
    });
    // Repeated confirm and status never post again and make no provider call for status.
    expect((await intentOf(await confirm(env, f, op, intent.digest))).state).toBe("sent");
    const calls = f.mock.calls.length;
    const st = await send(env, f, `/${op}?account=${ME}`);
    expect((await intentOf(st)).state).toBe("sent");
    expect(f.mock.calls.length).toBe(calls);
    expect(f.posts()).toHaveLength(1);
  });

  it("two concurrent confirms make one POST; both answer the one operation", async () => {
    const env = makeEnv();
    await connect(env);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = instagram({
      [`POST ${IG}/${COMMENT}/replies`]: async () => {
        await gate;
        return { id: REPLY };
      },
    });
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    const a = confirm(env, f, op, intent.digest);
    for (let i = 0; i < 200 && !f.posts().length; i++) await new Promise((r) => setTimeout(r, 1));
    const b = await intentOf(await confirm(env, f, op, intent.digest));
    expect(b.state).toBe("dispatching");
    release();
    expect((await intentOf(await a)).state).toBe("sent");
    expect(f.posts()).toHaveLength(1);
  });

  it("the automatic acknowledgement claimed the comment first: already_claimed, truthful, zero POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    expect(
      await direct(env, { op: "claimAuto", account: ME, commentId: COMMENT, automationId: "lut" }),
    ).toMatchObject({ claimed: true });
    const res = await confirm(env, f, op, intent.digest);
    expect(res.status).toBe(200);
    expect(await intentOf(res)).toMatchObject({
      state: "already_claimed",
      failureCode: "already_claimed",
      failureDetail: "automatic",
    });
    expect(f.posts()).toEqual([]);
    // A new operation for the same comment is never reopened either.
    const op2 = newOp();
    const i2 = await intentOf(await prepare(env, f, op2, { draftRevision: "rev-9" }));
    expect((await intentOf(await confirm(env, f, op2, i2.digest))).state).toBe("already_claimed");
    expect(f.posts()).toEqual([]);
  });

  it("a known refusal is rejected; a timeout, a 5xx, a malformed or oversize answer is unknown; never retried", async () => {
    const cases: [Handler, string, string?][] = [
      [
        () => json({ error: { message: `nope ${LIVE_TOKEN}`, code: 100 } }, 400),
        "rejected",
        "meta_100",
      ],
      [() => json({ error: { message: "boom", code: 1 } }, 500), "unknown", "server"],
      [() => ({ ok: true }), "unknown", "malformed"],
      [() => ({ id: REPLY, error: { code: 2 } }), "unknown", "malformed"],
      [() => new Response("x".repeat(PAGE_BYTES_MAX + 1)), "unknown", "oversize"],
      [
        () => {
          throw new TypeError("reset");
        },
        "unknown",
        "network",
      ],
    ];
    for (const [handler, state, why] of cases) {
      const env = makeEnv();
      await connect(env);
      const f = instagram({ [`POST ${IG}/${COMMENT}/replies`]: handler });
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      const out = await intentOf(await confirm(env, f, op, intent.digest));
      expect(out.state).toBe(state);
      if (state === "rejected") expect(out.failureCode).toBe(why);
      else expect(out.unknownReason).toBe(why);
      expect(JSON.stringify(out)).not.toContain(LIVE_TOKEN);
      expect((await intentOf(await confirm(env, f, op, intent.digest))).state).toBe(state);
      expect(f.posts()).toHaveLength(1);
    }
  });

  it("a POST that outlives 15 seconds is aborted and stays unknown (timeout)", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram({
      [`POST ${IG}/${COMMENT}/replies`]: (_u, init) =>
        new Promise((_r, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    vi.useFakeTimers();
    const p = confirm(env, f, op, intent.digest);
    for (let i = 0; i < 500 && !f.posts().length; i++) await vi.advanceTimersByTimeAsync(1);
    expect(f.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await intentOf(await p)).toMatchObject({ state: "unknown", unknownReason: "timeout" });
  });

  it("a success whose receipt cannot be written is unknown (receipt); the effect stays claimed, never reposted", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    coordOf(env).failing.add("settle");
    expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
      state: "unknown",
      unknownReason: "receipt",
    });
    coordOf(env).failing.clear();
    expect((await intentOf(await confirm(env, f, op, intent.digest))).state).toBe("dispatching");
    expect(await direct(env, { op: "getEffect", account: ME, commentId: COMMENT })).toMatchObject({
      effect: { state: "claimed" },
    });
    expect(f.posts()).toHaveLength(1);
  });

  it("a coordinator outage before or at the claim is receipt_unavailable with zero POST", async () => {
    for (const op of ["get", "claimConfirm"]) {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const id = newOp();
      const intent = await intentOf(await prepare(env, f, id));
      coordOf(env).failing.add(op);
      expect(await body(await confirm(env, f, id, intent.digest))).toEqual({
        error: "receipt_unavailable",
      });
      expect(f.posts()).toEqual([]);
    }
  });

  it("a reconnect after the confirm GETs (token or stamp written first) is refused immediately before the claim", async () => {
    for (const write of ["token", "status"] as const) {
      const env = makeEnv();
      await connect(env);
      const store = Store.from(env)!;
      let armed = false;
      const f = instagram({
        [`GET ${IG}/${MEDIA}/comments`]: async () => {
          if (armed) {
            if (write === "token")
              await store.putTokens("instagram", {
                ...(await store.getTokens("instagram"))!,
                accessToken: "other-account-token",
              });
            else await store.putStatus("instagram", { connectedAt: "2026-10-17T08:59:00.000Z" });
          }
          return { data: [{ id: COMMENT }] };
        },
      });
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      armed = true;
      expect(await body(await confirm(env, f, op, intent.digest))).toEqual({
        error: "stale",
        detail: "reconnected",
      });
      expect(coordOf(env).ops).not.toContain("claimConfirm");
      expect(f.posts()).toEqual([]);
    }
  });

  it("a reconnect between prepare and confirm (new stamp) is stale; another account's token is account_mismatch", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    await Store.from(env)!.putStatus("instagram", { connectedAt: "2026-10-17T08:30:00.000Z" });
    expect(await body(await confirm(env, f, op, intent.digest))).toEqual({ error: "stale" });
    // Back to the old stamp, but the token now acts as another Instagram account.
    await Store.from(env)!.putStatus("instagram", { connectedAt: "2026-10-01T08:00:00.000Z" });
    const other = instagram({ [`GET ${IG}/me`]: () => ({ user_id: "17841000000000002" }) });
    expect(await body(await confirm(env, other, op, intent.digest))).toEqual({
      error: "account_mismatch",
      detail: "identity",
    });
    // The other account's lists are never read: /me only.
    expect(other.calls().map((c) => c.url.pathname)).toEqual(["/v21.0/me"]);
    expect([...f.posts(), ...other.posts()]).toEqual([]);
    expect(coordOf(env).ops).not.toContain("claimConfirm");
  });

  it("the target leaving the first pages before confirm is target_unverified; nothing is claimed", async () => {
    const env = makeEnv();
    await connect(env);
    const op = newOp();
    const intent = await intentOf(await prepare(env, instagram(), op));
    const f = instagram({ [`GET ${IG}/${MEDIA}/comments`]: () => ({ data: [] }) });
    expect(await body(await confirm(env, f, op, intent.digest))).toEqual({
      error: "target_unverified",
      detail: "outside-local-window",
    });
    expect(coordOf(env).ops).not.toContain("claimConfirm");
    expect(f.posts()).toEqual([]);
  });

  it("an expired review, a wrong digest, an unknown operation or a malformed account posts nothing", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    expect(await body(await confirm(env, f, op, "b".repeat(64)))).toEqual({ error: "conflict" });
    expect(await body(await confirm(env, f, "op-unknown-01", intent.digest))).toEqual({
      error: "not_found",
    });
    expect(
      await body(
        await post(env, f, "/confirm", { operationId: op, digest: intent.digest, account: "a/b" }),
      ),
    ).toEqual({ error: "bad_request" });
    const late = new Date(NOW.getTime() + 600_000);
    expect((await intentOf(await confirm(env, f, op, intent.digest, { now: late }))).state).toBe(
      "expired",
    );
    expect(f.posts()).toEqual([]);
  });
});

/* ---------- status and cancel ---------- */

describe("Instagram send: status and cancel use the stored operation only", () => {
  it("work without a connection, make zero provider calls, and cancel ends only a prepared intent", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    await prepare(env, f, op);
    await Store.from(env)!.forget("instagram");
    const calls = f.mock.calls.length;
    expect((await intentOf(await send(env, f, `/${op}?account=${ME}`))).state).toBe("prepared");
    const c = await post(env, f, `/${op}/cancel`, { account: ME });
    expect(await intentOf(c)).toMatchObject({ state: "cancelled", receiptVersion: 2 });
    expect(await direct(env, { op: "getEffect", account: ME, commentId: COMMENT })).toEqual({
      error: "not_found",
    });
    expect(f.mock.calls.length).toBe(calls);
  });

  it("refuse a malformed operation or account and answer not_found for an unknown one", async () => {
    const env = makeEnv();
    const f = instagram();
    expect(await body(await send(env, f, `/short?account=${ME}`))).toEqual({
      error: "bad_request",
    });
    expect(await body(await send(env, f, "/op-00000001?account=a/b"))).toEqual({
      error: "bad_request",
    });
    expect(await body(await send(env, f, `/op-00000001?account=${ME}`))).toEqual({
      error: "not_found",
    });
    expect(f).not.toHaveBeenCalled();
  });
});

/* ---------- DT-6B-2C-1-R1 ---------- */

/** Replaces the coordinator's answer to one `op` (the call is still recorded); `real` reaches the real one. */
function intercept(
  env: TestEnv,
  op: string,
  answer: (call: Record<string, unknown>, real: () => Promise<Response>) => unknown,
) {
  const ns = coordOf(env);
  const get = ns.get;
  ns.get = (id: string) => {
    const stub = get(id);
    return {
      fetch: async (url: string, init: RequestInit) => {
        const call = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (call.op !== op) return stub.fetch(url, init);
        const out = await answer(call, () => stub.fetch(url, init));
        return out instanceof Response ? out : json(out);
      },
    };
  };
}

describe("2C1-1: one consistent connection observation immediately before prepare and the claim", () => {
  for (const kind of ["prepare", "confirm"] as const)
    it(`a token-first reconnect during the final status read refuses ${kind}: zero receipt write, zero POST`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const op = newOp();
      const intent = kind === "confirm" ? await intentOf(await prepare(env, f, op)) : undefined;
      coordOf(env).ops.length = 0;
      f.mockClear();
      // The real Store's permitted order: tokens are written first, the status stamp later.
      const original = Store.prototype.getStatus;
      let reads = 0;
      const spy = vi.spyOn(Store.prototype, "getStatus").mockImplementation(async function (
        this: Store,
        p,
      ) {
        const s = await original.call(this, p);
        if (p === "instagram" && ++reads === 2) {
          const t = await this.getTokens("instagram");
          await this.putTokens("instagram", { ...t!, accessToken: "reconnected-other-token" });
        }
        return s;
      });
      try {
        const res =
          kind === "prepare"
            ? await prepare(env, f, op)
            : await confirm(env, f, op, intent!.digest);
        expect(await body(res)).toEqual({ error: "stale", detail: "reconnected" });
      } finally {
        spy.mockRestore();
      }
      expect(coordOf(env).ops).not.toContain("prepare");
      expect(coordOf(env).ops).not.toContain("claimConfirm");
      expect(f.posts()).toEqual([]);
    });

  it("the same connection throughout still prepares and sends once (control)", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    expect((await intentOf(await confirm(env, f, op, intent.digest))).state).toBe("sent");
    expect(f.posts()).toHaveLength(1);
  });
});

describe("2C1-2: a fresh clock at every deadline, the claim and the receipt", () => {
  it("a review deadline passing during the confirm GETs is expired: zero POST", async () => {
    const env = makeEnv();
    await connect(env);
    let clock = NOW.getTime();
    let advance = false;
    const f = instagram({
      [`GET ${IG}/me`]: () => {
        if (advance) clock = NOW.getTime() + 601_000;
        return { user_id: ME };
      },
    });
    const at = { clock: () => new Date(clock) };
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op, {}, at));
    clock = NOW.getTime() + 599_000;
    advance = true;
    f.mockClear();
    expect((await intentOf(await confirm(env, f, op, intent.digest, at))).state).toBe("expired");
    expect(f.posts()).toEqual([]);
  });

  it("a token expiring while the confirm GETs run is token_expired before the claim: zero POST", async () => {
    const env = makeEnv();
    // Expires at 09:10 (the 60 s margin makes it unusable from 09:09).
    await connect(env, { expiresAt: new Date(NOW.getTime() + 600_000).toISOString() });
    let clock = NOW.getTime();
    let advance = false;
    const f = instagram({
      [`GET ${IG}/${MEDIA}/comments`]: () => {
        if (advance) clock = NOW.getTime() + 545_000;
        return { data: [{ id: COMMENT }] };
      },
    });
    const at = { clock: () => new Date(clock) };
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op, {}, at));
    clock = NOW.getTime() + 60_000;
    advance = true;
    coordOf(env).ops.length = 0;
    expect(await body(await confirm(env, f, op, intent.digest, at))).toEqual({
      error: "token_expired",
    });
    expect(coordOf(env).ops).not.toContain("claimConfirm");
    expect(f.posts()).toEqual([]);
  });

  it("a token expiring while the prepare GETs run is token_expired before the receipt", async () => {
    const env = makeEnv();
    await connect(env, { expiresAt: new Date(NOW.getTime() + 600_000).toISOString() });
    let clock = NOW.getTime();
    const f = instagram({
      [`GET ${IG}/me`]: () => {
        clock = NOW.getTime() + 545_000;
        return { user_id: ME };
      },
    });
    expect(
      await body(await prepare(env, f, newOp(), {}, { clock: () => new Date(clock) })),
    ).toEqual({ error: "token_expired" });
    expect(coordOf(env).ops).toEqual([]);
  });

  it("an unexpired review sends; the review window, claim and receipt carry the fresh times (control)", async () => {
    const env = makeEnv();
    await connect(env);
    let clock = NOW.getTime();
    const f = instagram({
      [`GET ${IG}/${MEDIA}/comments`]: () => {
        clock += 2_000;
        return { data: [{ id: COMMENT }] };
      },
      [`POST ${IG}/${COMMENT}/replies`]: () => {
        clock += 3_000;
        return { id: REPLY };
      },
    });
    const at = { clock: () => new Date(clock) };
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op, {}, at));
    // Prepared after the GETs: the review window starts at 09:00:02.
    expect(intent.reviewExpiresAt).toBe(new Date(NOW.getTime() + 2_000 + 600_000).toISOString());
    clock = NOW.getTime() + 595_000;
    const out = await intentOf(await confirm(env, f, op, intent.digest, at));
    expect(out).toMatchObject({
      state: "sent",
      claimedAt: new Date(NOW.getTime() + 597_000).toISOString(),
      settledAt: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    expect(f.posts()).toHaveLength(1);
  });

  it("routes.ts passes a live clock: time moving during the request reaches the Instagram handler", async () => {
    const env = makeEnv();
    await connect(env);
    let clock = NOW.getTime();
    const kv = env.SOCIAL_KV;
    const get = kv.get.bind(kv);
    // The first storage read moves the clock 31 days on: the 30-day token is then expired.
    (kv as unknown as { get: typeof get }).get = (async (...args: Parameters<typeof get>) => {
      clock = NOW.getTime() + 31 * 86_400_000;
      return get(...args);
    }) as typeof get;
    const f = instagram();
    const res = await handle(
      req(`${SEND}/prepare`, { method: "POST", body: JSON.stringify(prepareBody(newOp())) }),
      env,
      undefined,
      { fetch: f, now: () => new Date(clock) },
    );
    expect(await body(res)).toEqual({ error: "token_expired" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("2C1-3 / 2C1-4: one destination, and only a typed refusal is rejected", () => {
  for (const status of [307, 308])
    it(`a ${status} from the reply POST is unknown (redirect): one POST, the effect stays held`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram({
        [`POST ${IG}/${COMMENT}/replies`]: () =>
          new Response(null, { status, headers: { Location: "https://elsewhere.invalid/" } }),
      });
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
        state: "unknown",
        unknownReason: "redirect",
      });
      expect(f.posts()).toHaveLength(1);
      expect(f.mock.calls.at(-1)?.[1]?.redirect).toBe("manual");
    });

  for (const [name, error] of [
    ["an empty error", {}],
    ["an error array", []],
    ["a string code", { code: "100", message: "not typed" }],
  ] as const)
    it(`${name} on a 400 is unknown (malformed), never rejected; the effect is retained`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram({ [`POST ${IG}/${COMMENT}/replies`]: () => json({ error }, 400) });
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
        state: "unknown",
        unknownReason: "malformed",
      });
      expect(await direct(env, { op: "getEffect", account: ME, commentId: COMMENT })).toMatchObject(
        { effect: { state: "unknown", actor: `manual:${op}` } },
      );
      expect(f.posts()).toHaveLength(1);
    });
});

describe("2C1-5: the manual handler accepts only answers bound to its own operation", () => {
  const foreignIntent = (call: Record<string, unknown>) => ({
    intent: {
      operationId: "op-foreign-01",
      account: ME,
      commentId: COMMENT,
      state: "dispatching",
      digest: call.digest,
      receiptVersion: 2,
    },
    claimed: true,
    effect: {
      account: ME,
      commentId: COMMENT,
      actor: "manual:op-foreign-01",
      state: "claimed",
      receiptVersion: 1,
    },
  });
  const cases: [
    string,
    (call: Record<string, unknown>, real: () => Promise<Response>) => unknown,
  ][] = [
    ["claimed without any proof", () => ({ claimed: true })],
    ["another operation's intent and effect", foreignIntent],
    [
      "this intent with another actor's effect",
      async (_call, real) => {
        const a = (await (await real()).json()) as Record<string, Record<string, unknown>>;
        return { ...a, effect: { ...a.effect, actor: "auto:lut" } };
      },
    ],
    [
      "this intent with a fractional version",
      async (_call, real) => {
        const a = (await (await real()).json()) as Record<string, Record<string, unknown>>;
        return { ...a, intent: { ...a.intent, receiptVersion: 2.5 } };
      },
    ],
  ];
  for (const [name, answer] of cases)
    it(`${name} is not claim proof: receipt_unavailable, zero POST`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      intercept(env, "claimConfirm", answer);
      expect(await body(await confirm(env, f, op, intent.digest))).toEqual({
        error: "receipt_unavailable",
      });
      expect(f.posts()).toEqual([]);
    });

  const settles: [
    string,
    (call: Record<string, unknown>, real: () => Promise<Response>) => unknown,
  ][] = [
    ["an empty object", () => ({})],
    ["an array", () => []],
    [
      "a still-claimed effect",
      (call) => ({
        settled: false,
        effect: {
          account: ME,
          commentId: COMMENT,
          actor: call.actor,
          state: "claimed",
          receiptVersion: 1,
        },
      }),
    ],
    [
      "another operation's sent effect",
      () => ({
        settled: true,
        effect: {
          account: ME,
          commentId: COMMENT,
          actor: "manual:op-foreign-01",
          state: "sent",
          providerReplyId: REPLY,
          receiptVersion: 2,
        },
        intent: { operationId: "op-foreign-01", account: ME, state: "sent", receiptVersion: 3 },
      }),
    ],
  ];
  for (const [name, answer] of settles)
    it(`${name} is not a receipt: unknown (receipt), one POST`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      intercept(env, "settle", answer);
      expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
        state: "unknown",
        unknownReason: "receipt",
      });
      expect(f.posts()).toHaveLength(1);
    });

  it("a repeated settlement proving the same durable outcome is accepted (control)", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    // The receipt is written, then the answer is lost and the settle repeated: settled false, same outcome.
    intercept(env, "settle", async (_call, real) => {
      await real();
      return real();
    });
    expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
      state: "sent",
      providerReplyId: REPLY,
    });
  });

  it("a status answer for another operation is receipt_unavailable", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    await prepare(env, f, op);
    intercept(env, "get", async (_call, real) => {
      const a = (await (await real()).json()) as Record<string, Record<string, unknown>>;
      return { intent: { ...a.intent, operationId: "op-foreign-01" } };
    });
    expect(await body(await send(env, f, `/${op}?account=${ME}`))).toEqual({
      error: "receipt_unavailable",
    });
  });
});

/* ---------- DT-6B-2C-1-R2 ---------- */

describe("2C1-R1-A: a complete typed intent, bound to what each phase already knows", () => {
  type Obj = Record<string, unknown>;
  /** The real coordinator answers; `change` rewrites only its intent. */
  const mutateIntent = (env: TestEnv, op: string, change: (i: Obj) => unknown) =>
    intercept(env, op, async (_call, real) => {
      const a = (await (await real()).json()) as Obj;
      return { ...a, intent: change(a.intent as Obj) };
    });
  const omit =
    (k: string) =>
    (i: Obj): Obj =>
      Object.fromEntries(Object.entries(i).filter(([key]) => key !== k));
  const TRIMMED = "Thanks so much! 🎬";

  const prepares: [string, (i: Obj) => unknown][] = [
    ["another media", (i) => ({ ...i, mediaId: "18000000000000002" })],
    ["changed text under the reviewed digest", (i) => ({ ...i, text: "Unreviewed changed text" })],
    ["another comment", (i) => ({ ...i, commentId: "17900000000000999" })],
    ["another account", (i) => ({ ...i, account: "17841000000000999" })],
    ["another generation", (i) => ({ ...i, generation: "0".repeat(32) })],
    ["another revision", (i) => ({ ...i, draftRevision: "rev-2" })],
    ["another digest", (i) => ({ ...i, digest: "a".repeat(64) })],
    ["no provider", omit("provider")],
    ["an unsupported state", (i) => ({ ...i, state: "done" })],
    ["a sent state without its reply id", (i) => ({ ...i, state: "sent" })],
    ["an unparseable creation time", (i) => ({ ...i, createdAt: "yesterday" })],
    ["a string receipt version", (i) => ({ ...i, receiptVersion: "1" })],
  ];
  for (const [name, change] of prepares)
    it(`a prepare answer with ${name} is receipt_unavailable; nothing is posted`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      mutateIntent(env, "prepare", change);
      expect(await body(await prepare(env, f, newOp()))).toEqual({ error: "receipt_unavailable" });
      expect(f.posts()).toEqual([]);
    });

  it("a prepare answer carrying an error beside a valid intent is receipt_unavailable", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    intercept(env, "prepare", async (_call, real) => ({
      error: "conflict",
      ...((await (await real()).json()) as Obj),
    }));
    expect(await body(await prepare(env, f, newOp()))).toEqual({ error: "receipt_unavailable" });
  });

  it("convergence for the same exact submission answers the original operation and times (control)", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const first = await intentOf(await prepare(env, f, op));
    const later = new Date(NOW.getTime() + 60_000);
    const again = await prepare(env, f, newOp(), {}, { now: later });
    expect(again.status).toBe(200);
    expect(await intentOf(again)).toEqual(first);
    expect(first).toMatchObject({ operationId: op, text: TRIMMED, createdAt: NOW.toISOString() });
  });

  const statuses: [string, (i: Obj) => unknown][] = [
    [
      "the minimal sent shape",
      (i) => ({ operationId: i.operationId, account: i.account, state: "sent", receiptVersion: 3 }),
    ],
    ["sent without a reply id", (i) => ({ ...i, state: "sent" })],
    ["sent with an empty reply id", (i) => ({ ...i, state: "sent", providerReplyId: "" })],
    ["rejected without a failure code", (i) => ({ ...i, state: "rejected" })],
    ["unknown without a reason", (i) => ({ ...i, state: "unknown" })],
    [
      "already_claimed without the winning actor",
      (i) => ({ ...i, state: "already_claimed", failureCode: "already_claimed" }),
    ],
    ["an unsupported state", (i) => ({ ...i, state: "posted" })],
    ["a non-string text", (i) => ({ ...i, text: 42 })],
    ["no generation", omit("generation")],
    ["no media", omit("mediaId")],
    ["a malformed digest", (i) => ({ ...i, digest: "xyz" })],
    ["an unparseable update time", (i) => ({ ...i, updatedAt: "soon" })],
    ["a fractional receipt version", (i) => ({ ...i, receiptVersion: 1.5 })],
  ];
  for (const kind of ["status", "cancel"] as const)
    for (const [name, change] of statuses)
      it(`a ${kind} answer with ${name} is receipt_unavailable with zero provider calls`, async () => {
        const env = makeEnv();
        await connect(env);
        const f = instagram();
        const op = newOp();
        await prepare(env, f, op);
        const calls = f.mock.calls.length;
        mutateIntent(env, kind === "status" ? "get" : "cancel", change);
        const res =
          kind === "status"
            ? await send(env, f, `/${op}?account=${ME}`)
            : await post(env, f, `/${op}/cancel`, { account: ME });
        expect(await body(res)).toEqual({ error: "receipt_unavailable" });
        expect(f.mock.calls.length).toBe(calls);
      });

  it("status and cancel answers carrying an error beside a valid intent are receipt_unavailable", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    await prepare(env, f, op);
    for (const o of ["get", "cancel"])
      intercept(env, o, async (_call, real) => ({
        error: "not_found",
        ...((await (await real()).json()) as Obj),
      }));
    expect(await body(await send(env, f, `/${op}?account=${ME}`))).toEqual({
      error: "receipt_unavailable",
    });
    expect(await body(await post(env, f, `/${op}/cancel`, { account: ME }))).toEqual({
      error: "receipt_unavailable",
    });
  });

  /** Brings a real operation into `state` through the real coordinator. */
  const reach = async (state: string) => {
    const env = makeEnv();
    await connect(env);
    const replyAnswer: Handler =
      state === "rejected"
        ? () => json({ error: { code: 100, message: "nope" } }, 400)
        : state === "unknown"
          ? () => json({ error: { message: "down" } }, 500)
          : () => ({ id: REPLY });
    const f = instagram({ [`POST ${IG}/${COMMENT}/replies`]: replyAnswer });
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    if (state === "cancelled") await post(env, f, `/${op}/cancel`, { account: ME });
    if (state === "already_claimed")
      await direct(env, { op: "claimAuto", account: ME, commentId: COMMENT, automationId: "lut" });
    if (state === "dispatching") coordOf(env).failing.add("settle");
    if (["sent", "rejected", "unknown", "dispatching", "already_claimed"].includes(state))
      await confirm(env, f, op, intent.digest);
    coordOf(env).failing.clear();
    return { env, op };
  };
  for (const state of [
    "prepared",
    "dispatching",
    "sent",
    "rejected",
    "unknown",
    "expired",
    "cancelled",
    "already_claimed",
  ])
    it(`a real ${state} receipt is a valid status and cancel answer without any credential (control)`, async () => {
      const { env, op } = await reach(state);
      await Store.from(env)!.forget("instagram");
      const f = instagram();
      const o = state === "expired" ? { now: new Date(NOW.getTime() + 11 * 60_000) } : {};
      const status = await send(env, f, `/${op}?account=${ME}`, {}, o);
      expect(status.status).toBe(200);
      const got = await intentOf(status);
      expect(got).toMatchObject({ operationId: op, account: ME, state, text: TRIMMED });
      if (state !== "prepared") {
        const cancelled = await post(env, f, `/${op}/cancel`, { account: ME }, o);
        expect(await intentOf(cancelled)).toEqual(got);
      }
      expect(f).not.toHaveBeenCalled();
    });

  it("an incomplete prepared intent read at confirm is receipt_unavailable before any GET", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    const calls = f.mock.calls.length;
    mutateIntent(env, "get", omit("text"));
    expect(await body(await confirm(env, f, op, intent.digest))).toEqual({
      error: "receipt_unavailable",
    });
    expect(f.mock.calls.length).toBe(calls);
  });

  const withIntent = (a: Obj, change: (i: Obj) => Obj) => ({
    ...a,
    intent: change(a.intent as Obj),
  });
  const claims: [string, (a: Obj) => unknown][] = [
    ["an error beside the real claim", (a) => ({ error: "conflict", ...a })],
    [
      "a won intent of another generation",
      (a) => withIntent(a, (i) => ({ ...i, generation: "0".repeat(32) })),
    ],
    [
      "a won intent of another revision",
      (a) => withIntent(a, (i) => ({ ...i, draftRevision: "rev-9" })),
    ],
    ["an incomplete won intent", (a) => withIntent(a, omit("updatedAt"))],
  ];
  for (const [name, change] of claims)
    it(`${name} is not claim proof: receipt_unavailable, zero POST`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      intercept(env, "claimConfirm", async (_call, real) =>
        change((await (await real()).json()) as Obj),
      );
      expect(await body(await confirm(env, f, op, intent.digest))).toEqual({
        error: "receipt_unavailable",
      });
      expect(f.posts()).toEqual([]);
    });

  const settles: [string, (a: Obj) => unknown][] = [
    [
      "a mirrored intent for another comment",
      (a) => withIntent(a, (i) => ({ ...i, commentId: "17900000000000999" })),
    ],
    [
      "a mirrored intent with other text",
      (a) => withIntent(a, (i) => ({ ...i, text: "Unreviewed changed text" })),
    ],
    [
      "a mirrored intent for another media",
      (a) => withIntent(a, (i) => ({ ...i, mediaId: "18000000000000002" })),
    ],
    [
      "a mirrored intent of another operation",
      (a) => withIntent(a, (i) => ({ ...i, operationId: "op-foreign-01" })),
    ],
    ["a mirrored intent without its reply id", (a) => withIntent(a, omit("providerReplyId"))],
    ["an incomplete mirrored intent", (a) => withIntent(a, omit("createdAt"))],
    ["an error beside the real receipt", (a) => ({ error: "conflict", ...a })],
  ];
  for (const [name, change] of settles)
    it(`${name} is not a receipt: the validated operation is unknown (receipt), one POST, never retried`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const op = newOp();
      const intent = await intentOf(await prepare(env, f, op));
      intercept(env, "settle", async (_call, real) => change((await (await real()).json()) as Obj));
      expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
        operationId: op,
        account: ME,
        mediaId: MEDIA,
        commentId: COMMENT,
        text: TRIMMED,
        digest: intent.digest,
        state: "unknown",
        unknownReason: "receipt",
      });
      await confirm(env, f, op, intent.digest);
      expect(f.posts()).toHaveLength(1);
    });

  it("a rejected receipt mirroring another failure code is unknown (receipt)", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram({
      [`POST ${IG}/${COMMENT}/replies`]: () => json({ error: { code: 100, message: "no" } }, 400),
    });
    const op = newOp();
    const intent = await intentOf(await prepare(env, f, op));
    mutateIntent(env, "settle", (i) => ({ ...i, failureCode: "meta_999" }));
    expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
      state: "unknown",
      unknownReason: "receipt",
    });
    expect(f.posts()).toHaveLength(1);
  });
});
