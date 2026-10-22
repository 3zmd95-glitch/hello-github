import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import {
  DM_TEXT_BYTES_MAX,
  instagramDmHandler,
  type EligibilityCheck,
} from "./inboxSendInstagramDm";
import { CONTROL_ROWS_MAX, InstagramDmCoordinator, type DmCall } from "./instagramDmCoordinator";
import { Store } from "./store";
import type { TokenSet } from "./types";

// 💬 Reviewed existing-conversation Instagram DMs and explicit takeover/resume (packet DT-6B-2C-3,
// planning/tools/37-inbox-send.md), Worker protocol only. Prepare (token and connection captured once, the closed
// production gate, text canonicalized once, ≤ 3 bounded ownership GETs, the final fence) → review → confirm (durable
// state first, then the same checks, the final fence, ONE claimConfirm over the automation's own effect) → ONE POST of
// the stored bytes → ONE settlement. The coordinator is the real InstagramDmCoordinator over node:sqlite, a new
// instance per call. Fake KV and fetch: no provider is ever contacted. Production eligibility is closed; the protocol
// runs through the handler factory with an injected `{ ok: true }` only.

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
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const OTHER = "990000000000002";
const IN1 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE=";
const OWN = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjI=";
const LIVE_TOKEN = "ig-live-token-xyz";
const DM = "/social/inbox/instagram/dm";
const ALLOW: EligibilityCheck = () => ({ ok: true });
const MIN = 60_000;

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

type Tamper = (call: DmCall, answer: Record<string, unknown>) => unknown;

/** A namespace of real InstagramDmCoordinators over node:sqlite, one database per object name. */
function fakeCoordinator() {
  const dbs = new Map<string, DatabaseSync>();
  const ns = {
    names: [] as string[],
    ops: [] as string[],
    /** Calls (by `op`) that fail as a storage outage would. */
    failing: new Set<string>(),
    tamper: undefined as Tamper | undefined,
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        ns.names.push(id);
        const call = JSON.parse(String(init.body)) as DmCall;
        ns.ops.push(call.op);
        if (ns.failing.has(call.op)) throw new Error("storage down");
        if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
        const c = new InstagramDmCoordinator({ storage: sqliteStorage(dbs.get(id)!) } as never);
        const res = await c.fetch(new Request(url, init));
        if (!ns.tamper) return res;
        return Response.json(ns.tamper(call, (await res.json()) as Record<string, unknown>));
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
  ...(coord ? { INSTAGRAM_DM_COORDINATOR: coord as unknown as DurableObjectNamespace } : {}),
});

const coordOf = (env: TestEnv) => env.INSTAGRAM_DM_COORDINATOR as unknown as Coord;
const direct = async (env: TestEnv, call: Record<string, unknown>) => {
  const ns = env.INSTAGRAM_DM_COORDINATOR!;
  const res = await ns.get(ns.idFromName(`instagram-dm|${ME}`)).fetch("https://c/", {
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
      init: init ?? {},
    }));
  const posts = () => calls().filter((c) => c.method === "POST");
  const gets = () => calls().filter((c) => c.method === "GET");
  return Object.assign(fn, { calls, posts, gets });
}

interface Msg {
  id: string;
  created_time?: string;
  from?: { id?: string; username?: string };
}

const msg = (id: string, from: string, agoMs: number): Msg => ({
  id,
  created_time: new Date(NOW.getTime() - agoMs).toISOString(),
  from: { id: from, username: from === ME ? "3z.prod" : from === OTHER ? "omar" : "sara" },
});

/** The provider: /me, the owned-conversation first page, that conversation's first message page, the DM POST. */
const instagram = (
  o: { messages?: Msg[]; conversations?: string[]; extra?: Record<string, Handler> } = {},
) =>
  mockFetch({
    [`GET ${IG}/me`]: () => ({ user_id: ME, username: "3z.prod" }),
    [`GET ${IG}/${ME}/conversations`]: () => ({
      data: (o.conversations ?? ["aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6OTk5", CONV]).map((id) => ({
        id,
      })),
      paging: { next: "https://graph.instagram.com/v21.0/next?access_token=leak" },
    }),
    [`GET ${IG}/${CONV}`]: () => ({
      id: CONV,
      messages: {
        data: o.messages ?? [msg(OWN, ME, 30 * MIN), msg(IN1, PERSON, 5 * MIN)],
        paging: { next: "https://graph.instagram.com/v21.0/next2?access_token=leak" },
      },
    }),
    [`POST ${IG}/${ME}/messages`]: (_u, init) => {
      const b = JSON.parse(String(init?.body)) as { recipient: { id: string } };
      return { recipient_id: b.recipient.id, message_id: "aWdfZAG1faXRlbToxOk1lc3NhZA2U=" };
    },
    ...o.extra,
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
  /** A clock read afresh on every call. */
  clock?: () => Date;
}

async function dm(
  env: TestEnv,
  f: typeof fetch,
  path: string,
  init: RequestInit = {},
  o: Opts = {},
) {
  const r = req(`${DM}${path}`, init);
  const rest = new URL(r.url).pathname.split("/").filter(Boolean).slice(4);
  const handler = instagramDmHandler({
    fetch: f,
    now: () => o.clock?.() ?? NOW,
    eligibility: "eligibility" in o ? o.eligibility : ALLOW,
  });
  const res = await handler(
    r,
    rest,
    {
      store: Store.from(env),
      seal: env.INBOX_SEAL_SECRET,
      coordinator: env.INSTAGRAM_DM_COORDINATOR,
    },
    { json: (b, status) => json(b, status) },
  );
  return res!;
}
const post = (env: TestEnv, f: typeof fetch, path: string, b: unknown, o: Opts = {}) =>
  dm(
    env,
    f,
    path,
    { method: "POST", body: JSON.stringify(b), headers: { "Content-Type": "application/json" } },
    o,
  );
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;
type Intent = Record<string, unknown> & { state: string; digest: string; text: string };
const intentOf = async (res: Response) => (await body(res)).intent as Intent;

let opSeq = 0;
const newOp = () => `op-dm-${String(++opSeq).padStart(6, "0")}`;

const prepareBody = (operationId: string, over: Record<string, unknown> = {}) => ({
  operationId,
  account: ME,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: IN1,
  text: "  Hi Sara! It is an iPhone 16 Pro 🎬  ",
  draftRevision: "rev-1",
  ...over,
});
const prepare = (
  env: TestEnv,
  f: typeof fetch,
  op: string,
  over: Record<string, unknown> = {},
  o: Opts = {},
) => post(env, f, "/send/prepare", prepareBody(op, over), o);
const confirm = (
  env: TestEnv,
  f: typeof fetch,
  op: string,
  digest: string,
  o: Opts = {},
  extra: Record<string, unknown> = {},
) => post(env, f, "/send/confirm", { operationId: op, digest, account: ME, ...extra }, o);
const status = (env: TestEnv, f: typeof fetch, op: string, o: Opts = {}) =>
  dm(env, f, `/send/${op}?account=${ME}`, {}, o);
const cancel = (env: TestEnv, f: typeof fetch, op: string, o: Opts = {}) =>
  post(env, f, `/send/${op}/cancel`, { account: ME }, o);
const register = (
  env: TestEnv,
  f: typeof fetch,
  o: Opts = {},
  over: Record<string, unknown> = {},
) => post(env, f, "/control/register", { account: ME, conversationId: CONV, ...over }, o);
const ctl = (env: TestEnv, f: typeof fetch, handleId: string, action?: string, b: unknown = {}) =>
  action
    ? post(env, f, `/control/${handleId}/${action}`, { account: ME, ...(b as object) })
    : dm(env, f, `/control/${handleId}?account=${ME}`);

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const exactBody = (text: string, recipient = PERSON) =>
  JSON.stringify({ recipient: { id: recipient }, message: { text } });

afterEach(() => {
  vi.useRealTimers();
});

/* ---------- auth, configuration, the gate, durable recovery ---------- */

describe("Instagram DMs: auth, configuration, the closed production gate and durable recovery", () => {
  const ROUTES: [string, string][] = [
    [`${DM}/send/prepare`, "POST"],
    [`${DM}/send/confirm`, "POST"],
    [`${DM}/send/op-00000001?account=${ME}`, "GET"],
    [`${DM}/send/op-00000001/cancel`, "POST"],
    [`${DM}/control/register`, "POST"],
    [`${DM}/control/${"a".repeat(32)}?account=${ME}`, "GET"],
    [`${DM}/control/${"a".repeat(32)}/takeover`, "POST"],
    [`${DM}/control/${"a".repeat(32)}/resume`, "POST"],
  ];

  it("refuses a missing bearer and a foreign origin before any provider or coordinator call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    for (const [path, method] of ROUTES) {
      expect((await run(env, f, path, { method, auth: null })).status).toBe(401);
      expect((await run(env, f, path, { method, origin: "https://evil.example" })).status).toBe(
        403,
      );
    }
    expect((await run(env, f, `${DM}/send/prepare`, { method: "GET" })).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
    expect(coordOf(env).names).toEqual([]);
  });

  it("production prepare, new confirm and control registration fail closed: permission_unverified, zero provider calls", async () => {
    const env = makeEnv();
    // Every message scope granted and canReply: still not permission evidence.
    await connect(env);
    const f = instagram();
    const ready = instagram();
    const op = newOp();
    const prepared = await intentOf(await prepare(env, ready, op));
    for (const [path, b] of [
      ["/send/prepare", prepareBody(newOp())],
      ["/send/confirm", { operationId: op, digest: prepared.digest, account: ME }],
      ["/control/register", { account: ME, conversationId: CONV }],
    ] as [string, unknown][]) {
      const res = await run(env, f, `${DM}${path}`, { method: "POST", body: JSON.stringify(b) });
      expect(res.status).toBe(403);
      expect(await body(res)).toEqual({ error: "no_permission", detail: "permission_unverified" });
    }
    // The factory without an injected eligibility is the same closed gate.
    expect(await body(await prepare(env, f, newOp(), {}, { eligibility: undefined }))).toEqual({
      error: "no_permission",
      detail: "permission_unverified",
    });
    expect(f).not.toHaveBeenCalled();
    expect((await intentOf(await status(env, f, op))).state).toBe("prepared");
  });

  it("status, cancel and control status/takeover/resume recover with no connection, gate closed, zero provider calls", async () => {
    const env = makeEnv();
    await connect(env);
    const ready = instagram();
    const op = newOp();
    await prepare(env, ready, op);
    const handleId = ((await body(await register(env, ready))).control as { handleId: string })
      .handleId;
    // The connection is gone entirely.
    await Store.from(env)!.forget("instagram");
    const f = instagram();
    const closed: Opts = { eligibility: undefined };
    expect((await intentOf(await dm(env, f, `/send/${op}?account=${ME}`, {}, closed))).state).toBe(
      "prepared",
    );
    const r1 = await run(env, f, `${DM}/control/${handleId}?account=${ME}`, { method: "GET" });
    expect(await body(r1)).toMatchObject({ conversation: { mode: "auto", revision: 0 } });
    const r2 = await run(env, f, `${DM}/control/${handleId}/takeover`, {
      method: "POST",
      body: JSON.stringify({ account: ME, expectedRevision: 0 }),
    });
    expect(await body(r2)).toMatchObject({
      changed: true,
      conversation: { mode: "human", revision: 1 },
    });
    const r3 = await run(env, f, `${DM}/control/${handleId}/resume`, {
      method: "POST",
      body: JSON.stringify({ account: ME, expectedRevision: 1 }),
    });
    expect(await body(r3)).toMatchObject({
      changed: true,
      conversation: { mode: "auto", revision: 2 },
    });
    const r4 = await run(env, f, `${DM}/send/${op}/cancel`, {
      method: "POST",
      body: JSON.stringify({ account: ME }),
    });
    expect(((await body(r4)).intent as Intent).state).toBe("cancelled");
    expect(f).not.toHaveBeenCalled();
  });

  it("names the missing piece: the claim store (every route) or KV (new work only)", async () => {
    const f = instagram();
    const noCoord = makeEnv(null);
    await connect(noCoord);
    for (const [path, method] of ROUTES) {
      const res = await run(noCoord, f, path, {
        method,
        ...(method === "POST" ? { body: JSON.stringify({ account: ME }) } : {}),
      });
      expect(await body(res)).toEqual({ error: "not_configured", detail: "dm-claim-store" });
    }
    const noKv = { ...makeEnv(), SOCIAL_KV: undefined } as unknown as TestEnv;
    expect(await body(await prepare(noKv, f, newOp()))).toEqual({
      error: "not_configured",
      detail: "kv",
    });
    // Status needs no KV at all.
    expect(await body(await status(noKv, f, "op-absent-0001"))).toEqual({ error: "not_found" });
    const env = makeEnv();
    expect(await body(await prepare(env, f, newOp()))).toEqual({ error: "not_connected" });
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    expect(await body(await prepare(env, f, newOp()))).toEqual({ error: "token_expired" });
    expect(f).not.toHaveBeenCalled();
  });

  it("routes.ts answers unknown paths and wrong methods of the family", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    expect((await run(env, f, `${DM}/send/prepare`, { method: "GET" })).status).toBe(405);
    expect((await run(env, f, `${DM}/control/register`, { method: "GET" })).status).toBe(405);
    expect((await run(env, f, `${DM}/control/x/y/z`, { method: "POST" })).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });
});

/* ---------- prepare ---------- */

describe("Instagram DMs: prepare canonicalizes once, proves the target in ≤ 3 GETs, and sends nothing", () => {
  it("stores and returns the canonical text (trim + NFC); the digest is the exact POST body's; zero POST, mode untouched", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    // Leading/trailing whitespace, CRLF inside, a supplementary character and a decomposed é.
    const raw = "  Hi\r\nthere 𝒜 café  ";
    const res = await prepare(env, f, op, { text: raw });
    expect(res.status).toBe(200);
    const b = await body(res);
    const intent = b.intent as Intent;
    const canonical = "Hi\r\nthere 𝒜 café";
    expect(intent).toMatchObject({
      operationId: op,
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN1,
      inboundAt: new Date(NOW.getTime() - 5 * MIN).toISOString(),
      text: canonical,
      digest: sha(exactBody(canonical)),
      draftRevision: "rev-1",
      state: "prepared",
      reviewExpiresAt: new Date(NOW.getTime() + 10 * MIN).toISOString(),
      receiptVersion: 1,
    });
    expect(b.verification).toEqual({
      window: "first-page",
      pageSize: 20,
      inboundWindowMs: 86_400_000,
    });
    expect(f.posts()).toEqual([]);
    const gets = f.gets();
    expect(gets.map((g) => g.url.pathname)).toEqual([
      "/v21.0/me",
      `/v21.0/${ME}/conversations`,
      `/v21.0/${CONV}`,
    ]);
    expect(gets.every((g) => g.url.host === "graph.instagram.com")).toBe(true);
    expect(gets.every((g) => g.init.redirect === "manual")).toBe(true);
    expect(await direct(env, { op: "status", account: ME, conversationId: CONV })).toEqual({
      conversation: { account: ME, conversationId: CONV, mode: "auto", revision: 0 },
    });
    // The same operation and submission converge without a second intent.
    expect((await intentOf(await prepare(env, f, op, { text: raw }))).operationId).toBe(op);
  });

  it("the review deadline is min(10 minutes, the inbound message's local 24-hour window)", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram({ messages: [msg(IN1, PERSON, 24 * 60 * MIN - 4 * MIN)] });
    const intent = await intentOf(await prepare(env, f, newOp()));
    expect(intent.reviewExpiresAt).toBe(new Date(NOW.getTime() + 4 * MIN).toISOString());
  });

  it("text bounds: empty, whitespace-only, over 1000 UTF-8 bytes and lone surrogates are text_invalid", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    expect(DM_TEXT_BYTES_MAX).toBe(1000);
    // DT-6B-3C: 1000 supplementary characters are 4000 UTF-8 bytes, so they are over the bound now too.
    for (const text of [
      "",
      "   \r\n ",
      "a".repeat(1001),
      "𝒜".repeat(1001),
      "𝒜".repeat(1000),
      "bad \ud800 half",
      7,
    ]) {
      const res = await prepare(env, f, newOp(), { text });
      expect(await body(res)).toEqual({ error: "text_invalid" });
    }
    // 250 supplementary characters (500 UTF-16 units) are exactly 1000 UTF-8 bytes.
    expect((await intentOf(await prepare(env, f, newOp(), { text: "𝒜".repeat(250) }))).state).toBe(
      "prepared",
    );
    expect(f.posts()).toEqual([]);
  });

  it("refuses malformed selectors before any provider call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    for (const over of [
      { operationId: "short" },
      { account: "../me" },
      { conversationId: "a/b" },
      { recipientId: "x y" },
      { inboundMessageId: "" },
      { draftRevision: "a b" },
    ])
      expect(await body(await prepare(env, f, newOp(), over))).toEqual({ error: "bad_request" });
    expect(f).not.toHaveBeenCalled();
  });

  const fails: [string, Parameters<typeof instagram>[0], Record<string, unknown>, unknown][] = [
    [
      "another /me account",
      { extra: { [`GET ${IG}/me`]: () => ({ user_id: "17841000000000002" }) } },
      {},
      { error: "account_mismatch", detail: "identity" },
    ],
    [
      "a conversation not on the owned first page",
      { conversations: ["c-1", "c-2"] },
      {},
      { error: "target_unverified", detail: "outside-local-window" },
    ],
    [
      "an inbound id not on the conversation's first page",
      { messages: [msg("in-9", PERSON, MIN)] },
      {},
      { error: "target_unverified", detail: "outside-local-window" },
    ],
    [
      "the owner's own message",
      {},
      { inboundMessageId: OWN, recipientId: ME },
      { error: "target_invalid", detail: "own-message" },
    ],
    [
      "mixed customers",
      { messages: [msg("in-0", OTHER, 9 * MIN), msg(IN1, PERSON, 5 * MIN)] },
      {},
      { error: "target_invalid", detail: "mixed-senders" },
    ],
    [
      "a foreign recipient",
      { messages: [msg(IN1, OTHER, 5 * MIN)] },
      {},
      { error: "target_invalid", detail: "foreign-recipient" },
    ],
    [
      "a future time",
      { messages: [msg(IN1, PERSON, -MIN)] },
      {},
      { error: "target_invalid", detail: "future-time" },
    ],
    [
      "an inbound older than the local 24 h window",
      { messages: [msg(IN1, PERSON, 24 * 60 * MIN + 1)] },
      {},
      { error: "target_invalid", detail: "window-closed" },
    ],
    [
      "a row without a sender",
      { messages: [{ id: IN1, created_time: NOW.toISOString() }] },
      {},
      { error: "upstream", detail: "malformed page" },
    ],
    [
      "a row without a valid time",
      { messages: [{ id: IN1, created_time: "soon", from: { id: PERSON } }] },
      {},
      { error: "upstream", detail: "malformed page" },
    ],
    [
      "bare message ids (expansion ignored)",
      { extra: { [`GET ${IG}/${CONV}`]: () => ({ id: CONV }) } },
      {},
      { error: "upstream", detail: "malformed page" },
    ],
  ];
  for (const [name, provider, over, want] of fails)
    it(`${name} fails closed: no intent, zero POST, at most 3 GETs`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram(provider);
      const op = newOp();
      expect(await body(await prepare(env, f, op, over))).toEqual(want);
      expect(f.posts()).toEqual([]);
      expect(f.gets().length).toBeLessThanOrEqual(3);
      expect(await body(await status(env, f, op))).toEqual({ error: "not_found" });
    });

  it("never follows a provider next page and never uses the OAuth user id", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    await prepare(env, f, newOp());
    const urls = f.calls().map((c) => c.url.toString());
    expect(urls.some((u) => u.includes("next"))).toBe(false);
    expect(urls.some((u) => u.includes(OAUTH_USER))).toBe(false);
  });

  const held: [string, (env: TestEnv) => Promise<void> | void, unknown][] = [
    [
      "a token-first reconnect",
      async (env) => {
        const s = Store.from(env)!;
        const t = await s.getTokens("instagram");
        await s.putTokens("instagram", { ...t!, accessToken: "ig-new-token" });
      },
      { error: "stale", detail: "reconnected" },
    ],
    [
      "a status-first reconnect",
      async (env) => {
        await Store.from(env)!.putStatus("instagram", { connectedAt: "2026-10-17T08:59:00.000Z" });
      },
      { error: "stale", detail: "reconnected" },
    ],
  ];
  for (const [name, change, want] of held)
    it(`${name} during a held GET: no intent, zero POST`, async () => {
      const env = makeEnv();
      await connect(env);
      const op = newOp();
      const f = instagram({
        extra: {
          [`GET ${IG}/${CONV}`]: async () => {
            await change(env);
            return { id: CONV, messages: { data: [msg(IN1, PERSON, 5 * MIN)] } };
          },
        },
      });
      expect(await body(await prepare(env, f, op))).toEqual(want);
      expect(await body(await status(env, f, op))).toEqual({ error: "not_found" });
      expect(f.posts()).toEqual([]);
    });

  it("token expiry or the inbound window closing while the GETs were held: no intent", async () => {
    for (const [moveTo, want] of [
      [NOW.getTime() + 31 * 86_400_000, { error: "token_expired" }],
      [NOW.getTime() + 24 * 60 * MIN, { error: "target_invalid", detail: "window-closed" }],
    ] as [number, unknown][]) {
      const env = makeEnv();
      await connect(env);
      let t = NOW.getTime();
      const f = instagram({
        extra: {
          [`GET ${IG}/${CONV}`]: () => {
            t = moveTo;
            return { id: CONV, messages: { data: [msg(IN1, PERSON, 5 * MIN)] } };
          },
        },
      });
      const op = newOp();
      expect(await body(await prepare(env, f, op, {}, { clock: () => new Date(t) }))).toEqual(want);
      expect(await body(await status(env, f, op))).toEqual({ error: "not_found" });
    }
  });
});

/* ---------- confirm ---------- */

async function prepared(env: TestEnv, f: typeof fetch, over: Record<string, unknown> = {}) {
  const op = newOp();
  const intent = await intentOf(await prepare(env, f, op, over));
  return { op, intent };
}

describe("Instagram DMs: confirm claims the automation's effect once, then ONE POST of the reviewed bytes", () => {
  it("POSTs exactly the stored canonical bytes once and records sent in the effect and the intent", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op, intent } = await prepared(env, f, { text: "  line one\r\nline two 𝒜  " });
    f.mockClear();
    const res = await confirm(env, f, op, intent.digest);
    expect(res.status).toBe(200);
    const done = await intentOf(res);
    expect(done).toMatchObject({
      state: "sent",
      providerMessageId: "aWdfZAG1faXRlbToxOk1lc3NhZA2U=",
      text: "line one\r\nline two 𝒜",
      receiptVersion: 3,
    });
    const posts = f.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].url.toString()).toBe(`https://${IG}/${ME}/messages`);
    expect(posts[0].init.body).toBe(exactBody(intent.text));
    expect(sha(String(posts[0].init.body))).toBe(intent.digest);
    expect(posts[0].init.redirect).toBe("manual");
    expect(f.gets().length).toBeLessThanOrEqual(3);
    expect(
      await direct(env, { op: "status", account: ME, conversationId: CONV, inboundMessageId: IN1 }),
    ).toMatchObject({ effect: { actor: `manual:${op}`, state: "sent" } });
  });

  it("a repeated confirm of a terminal or in-flight operation returns durable state: no token, gate or provider work", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op, intent } = await prepared(env, f);
    await confirm(env, f, op, intent.digest);
    await Store.from(env)!.forget("instagram");
    const g = instagram();
    const again = await confirm(env, g, op, intent.digest, { eligibility: undefined });
    expect((await intentOf(again)).state).toBe("sent");
    expect(g).not.toHaveBeenCalled();
  });

  it("replacement fields in the confirm body are ignored: the stored target and text are what goes out", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op, intent } = await prepared(env, f);
    f.mockClear();
    await confirm(
      env,
      f,
      op,
      intent.digest,
      {},
      {
        conversationId: "other",
        recipientId: OTHER,
        inboundMessageId: "in-x",
        text: "something else",
      },
    );
    expect(f.posts()[0].init.body).toBe(exactBody(intent.text));
  });

  it("a changed digest is a conflict before any provider call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op } = await prepared(env, f);
    f.mockClear();
    expect(await body(await confirm(env, f, op, "e".repeat(64)))).toEqual({ error: "conflict" });
    expect(f).not.toHaveBeenCalled();
  });

  it("automation first: already_claimed, zero POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op, intent } = await prepared(env, f);
    await direct(env, {
      op: "claim",
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN1,
      actor: "auto:cam",
      payloadDigest: "d".repeat(64),
      generation: "0".repeat(32),
      isDefault: false,
      cooldownMs: 0,
    });
    f.mockClear();
    const res = await intentOf(await confirm(env, f, op, intent.digest));
    expect(res).toMatchObject({ state: "already_claimed", failureDetail: "automatic" });
    expect(f.posts()).toEqual([]);
  });

  it("a takeover never blocks the person's own send, and the send never changes the mode", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    await direct(env, { op: "takeover", account: ME, conversationId: CONV, expectedRevision: 0 });
    const { op, intent } = await prepared(env, f);
    expect((await intentOf(await confirm(env, f, op, intent.digest))).state).toBe("sent");
    expect(await direct(env, { op: "status", account: ME, conversationId: CONV })).toMatchObject({
      conversation: { mode: "human", revision: 1 },
    });
  });

  it("a review past its deadline (also when it ran out during the GETs) is expired: zero POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const a = await prepared(env, f);
    const late = await intentOf(
      await confirm(env, f, a.op, a.intent.digest, {
        clock: () => new Date(NOW.getTime() + 11 * MIN),
      }),
    );
    expect(late.state).toBe("expired");
    const b = await prepared(env, f, { draftRevision: "rev-2" });
    let t = NOW.getTime();
    const g = instagram({
      extra: {
        [`GET ${IG}/${CONV}`]: () => {
          t = NOW.getTime() + 10 * MIN;
          return { id: CONV, messages: { data: [msg(IN1, PERSON, 5 * MIN)] } };
        },
      },
    });
    const ran = await intentOf(
      await confirm(env, g, b.op, b.intent.digest, { clock: () => new Date(t) }),
    );
    expect(ran.state).toBe("expired");
    expect([...f.posts(), ...g.posts()]).toEqual([]);
  });

  it("a reconnect since prepare, or during the confirm GETs, claims nothing", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const a = await prepared(env, f);
    await Store.from(env)!.putStatus("instagram", { connectedAt: "2026-10-17T08:59:00.000Z" });
    expect(await body(await confirm(env, f, a.op, a.intent.digest))).toEqual({ error: "stale" });
    const env2 = makeEnv();
    await connect(env2);
    const b = await prepared(env2, f);
    const g = instagram({
      extra: {
        [`GET ${IG}/${CONV}`]: async () => {
          const s = Store.from(env2)!;
          const tk = await s.getTokens("instagram");
          await s.putTokens("instagram", { ...tk!, accessToken: "ig-new-token" });
          return { id: CONV, messages: { data: [msg(IN1, PERSON, 5 * MIN)] } };
        },
      },
    });
    expect(await body(await confirm(env2, g, b.op, b.intent.digest))).toEqual({
      error: "stale",
      detail: "reconnected",
    });
    expect((await intentOf(await status(env2, g, b.op))).state).toBe("prepared");
    expect([...f.posts(), ...g.posts()]).toEqual([]);
  });

  it("confirm re-proves the stored target: a message gone from the first page claims nothing", async () => {
    const env = makeEnv();
    await connect(env);
    const { op, intent } = await prepared(env, instagram());
    const g = instagram({ messages: [msg("in-later", PERSON, MIN)] });
    expect(await body(await confirm(env, g, op, intent.digest))).toEqual({
      error: "target_unverified",
      detail: "outside-local-window",
    });
    expect((await intentOf(await status(env, g, op))).state).toBe("prepared");
    expect(g.posts()).toEqual([]);
  });

  it("an unbound claim answer is receipt_unavailable before any POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op, intent } = await prepared(env, f);
    coordOf(env).tamper = (call, a) =>
      call.op === "claimConfirm"
        ? { ...a, effect: { ...(a.effect as object), recipientId: OTHER } }
        : a;
    f.mockClear();
    expect(await body(await confirm(env, f, op, intent.digest))).toEqual({
      error: "receipt_unavailable",
    });
    expect(f.posts()).toEqual([]);
  });
});

describe("Instagram DMs: receipts are durable proof only; uncertainty is never replayed", () => {
  it("a typed refusal with its durable settlement is rejected", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram({
      extra: {
        [`POST ${IG}/${ME}/messages`]: () =>
          json({ error: { code: 10, message: `no ${LIVE_TOKEN}` } }, 400),
      },
    });
    const { op, intent } = await prepared(env, f);
    const b = await body(await confirm(env, f, op, intent.digest));
    expect(b.intent).toMatchObject({ state: "rejected", failureCode: "meta_10" });
    expect(JSON.stringify(b)).not.toContain(LIVE_TOKEN);
  });

  it("an observed typed refusal whose settlement is lost stays dispatching: reported as observed, never a durable rejected receipt", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram({
      extra: { [`POST ${IG}/${ME}/messages`]: () => json({ error: { code: 10 } }, 400) },
    });
    const { op, intent } = await prepared(env, f);
    coordOf(env).failing.add("settleManual");
    const b = await body(await confirm(env, f, op, intent.digest));
    expect(b).toMatchObject({
      intent: { state: "dispatching" },
      observed: { state: "rejected", code: "meta_10" },
      settlement: "pending",
    });
    coordOf(env).failing.clear();
    expect((await intentOf(await status(env, f, op))).state).toBe("dispatching");
    // A repeat reads the durable dispatching state: no second POST.
    expect((await intentOf(await confirm(env, f, op, intent.digest))).state).toBe("dispatching");
    expect(f.posts()).toHaveLength(1);
  });

  it("a provider success whose settlement is lost is unknown (receipt), never success; no replay", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op, intent } = await prepared(env, f);
    coordOf(env).failing.add("settleManual");
    const b = await body(await confirm(env, f, op, intent.digest));
    expect(b).toMatchObject({
      intent: { state: "dispatching" },
      observed: { state: "unknown", reason: "receipt" },
      settlement: "pending",
    });
    coordOf(env).failing.clear();
    expect((await intentOf(await confirm(env, f, op, intent.digest))).state).toBe("dispatching");
    expect(f.posts()).toHaveLength(1);
  });

  for (const [name, answer, reason] of [
    ["another recipient", () => json({ recipient_id: OTHER, message_id: "m" }), "recipient"],
    [
      "success beside an error",
      () => json({ recipient_id: PERSON, message_id: "m", error: {} }),
      "malformed",
    ],
    [
      "a typed error beside delivery proof",
      () => json({ error: { code: 10 }, message_id: "m" }, 400),
      "malformed",
    ],
    ["an untyped 4xx", () => json({ error: "nope" }, 400), "malformed"],
    [
      "a redirect",
      () => new Response(null, { status: 302, headers: { Location: "https://evil" } }),
      "redirect",
    ],
    ["a 5xx", () => json({}, 503), "server"],
    ["an oversize answer", () => new Response("x".repeat(300 * 1024), { status: 200 }), "oversize"],
  ] as [string, () => Response, string][])
    it(`${name} → durable unknown (${reason}); one POST; never re-sent`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram({ extra: { [`POST ${IG}/${ME}/messages`]: answer } });
      const { op, intent } = await prepared(env, f);
      expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
        state: "unknown",
        unknownReason: reason,
      });
      await confirm(env, f, op, intent.digest);
      expect(f.posts()).toHaveLength(1);
    });

  it("a mid-body break after headers is unknown (network); a complete body whose receipt is lost is receipt-unknown", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram({
      extra: {
        [`POST ${IG}/${ME}/messages`]: () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{"recipient_id":'));
                c.error(new Error("connection reset"));
              },
            }),
            { status: 200 },
          ),
      },
    });
    const { op, intent } = await prepared(env, f);
    expect(await intentOf(await confirm(env, f, op, intent.digest))).toMatchObject({
      state: "unknown",
      unknownReason: "network",
    });
  });
});

describe("Instagram DMs: cancel and status", () => {
  it("cancel ends a prepared operation only; a confirm afterwards sends nothing; cancel after sent changes nothing", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const a = await prepared(env, f);
    expect((await intentOf(await cancel(env, f, a.op))).state).toBe("cancelled");
    expect((await intentOf(await confirm(env, f, a.op, a.intent.digest))).state).toBe("cancelled");
    const b = await prepared(env, f, { draftRevision: "rev-2" });
    await confirm(env, f, b.op, b.intent.digest);
    expect((await intentOf(await cancel(env, f, b.op))).state).toBe("sent");
    expect(f.posts()).toHaveLength(1);
  });

  it("status of an unknown or foreign operation is not_found; a malformed id is bad_request", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const { op } = await prepared(env, f);
    expect(await body(await status(env, f, "op-absent-0001"))).toEqual({ error: "not_found" });
    expect(await body(await dm(env, f, `/send/${op}?account=17841000000000002`))).toEqual({
      error: "not_found",
    });
    expect(await body(await dm(env, f, `/send/x?account=${ME}`))).toEqual({ error: "bad_request" });
  });
});

/* ---------- control ---------- */

describe("Instagram DMs: verified control handles, offline revision CAS", () => {
  it("registration proves /me, the owned conversation and its single customer (≤ 3 GETs); a repeat converges", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const b = await body(await register(env, f));
    expect(b).toMatchObject({
      control: { account: ME, conversationId: CONV, recipientId: PERSON },
      conversation: { mode: "auto", revision: 0 },
      inFlight: [],
      inFlightTotal: 0,
      inFlightTruncated: false,
      uncertainTotal: 0,
    });
    expect(f.gets()).toHaveLength(3);
    expect(f.posts()).toEqual([]);
    const again = await body(await register(env, f, {}, { recipientId: OTHER }));
    // The recipient comes from the verified page, never the request.
    expect((again.control as { handleId: string }).handleId).toBe(
      (b.control as { handleId: string }).handleId,
    );
  });

  it("registration fails closed without a single verified customer; raw selectors never create a handle", async () => {
    for (const [provider, want] of [
      [
        { messages: [msg("a", OTHER, 9 * MIN), msg(IN1, PERSON, MIN)] },
        { error: "target_invalid", detail: "mixed-senders" },
      ],
      [{ messages: [msg(OWN, ME, MIN)] }, { error: "target_invalid", detail: "no-customer" }],
      [{ conversations: ["c-1"] }, { error: "target_unverified", detail: "outside-local-window" }],
    ] as [Parameters<typeof instagram>[0], unknown][]) {
      const env = makeEnv();
      await connect(env);
      expect(await body(await register(env, instagram(provider)))).toEqual(want);
      expect(
        await direct(env, { op: "controlStatus", account: ME, handleId: "a".repeat(32) }),
      ).toEqual({
        error: "not_found",
      });
    }
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    // A raw conversation id is not a handle.
    expect(await body(await ctl(env, f, CONV))).toEqual({ error: "bad_request" });
    expect(await body(await ctl(env, f, "a".repeat(32)))).toEqual({ error: "not_found" });
    expect(
      await body(await ctl(env, f, "a".repeat(32), "takeover", { expectedRevision: 0 })),
    ).toEqual({
      error: "not_found",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("takeover/resume are revision CAS with truthful conflicts; after a claim takeover reports it and cannot retract it", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const handleId = ((await body(await register(env, f))).control as { handleId: string })
      .handleId;
    // A claimed effect in flight (an automatic claim whose POST has not settled).
    await direct(env, {
      op: "claim",
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN1,
      actor: "auto:cam",
      payloadDigest: "d".repeat(64),
      generation: "0".repeat(32),
      isDefault: false,
      cooldownMs: 0,
    });
    f.mockClear();
    expect(await body(await ctl(env, f, handleId, "resume", { expectedRevision: 3 }))).toEqual({
      error: "conflict",
      conversation: { account: ME, conversationId: CONV, mode: "auto", revision: 0 },
      control: { handleId, account: ME, conversationId: CONV, recipientId: PERSON },
    });
    const t = await body(await ctl(env, f, handleId, "takeover", { expectedRevision: 0 }));
    expect(t).toMatchObject({
      changed: true,
      conversation: { mode: "human", revision: 1 },
      inFlightTotal: 1,
      inFlightTruncated: false,
    });
    expect((t.inFlight as { actor: string }[])[0].actor).toBe("auto:cam");
    expect((t.inFlight as unknown[]).length).toBeLessThanOrEqual(CONTROL_ROWS_MAX);
    expect(
      await body(await ctl(env, f, handleId, "takeover", { expectedRevision: 0 })),
    ).toMatchObject({
      error: "conflict",
      conversation: { revision: 1 },
    });
    const r = await body(await ctl(env, f, handleId, "resume", { expectedRevision: 1 }));
    expect(r).toMatchObject({
      changed: true,
      conversation: { mode: "auto", revision: 2 },
      inFlightTotal: 1,
    });
    for (const bad of [{ expectedRevision: -1 }, { expectedRevision: "1" }, {}])
      expect(await body(await ctl(env, f, handleId, "takeover", bad))).toEqual({
        error: "bad_request",
      });
    expect(f).not.toHaveBeenCalled();
  });

  it("a foreign account's request never sees the handle", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const handleId = ((await body(await register(env, f))).control as { handleId: string })
      .handleId;
    expect(await body(await dm(env, f, `/control/${handleId}?account=17841000000000002`))).toEqual({
      error: "not_found",
    });
  });
});

/* ---------- DT-6B-2C-3-R1: complete ownership pages, owner identity, receipts and control proofs ---------- */

const UNAVAILABLE = { status: 503, body: { error: "receipt_unavailable" } };
const STATUS_OF: Record<string, number> = { upstream: 502, target_invalid: 409 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a deliberately malformed reply: any shape at all
type Loose = Record<string, any>;
type Mutate = (x: Loose) => unknown;
/** Rewrites only the answers of coordinator `op` (a fault in the reply, never in the database). */
const tamperOp = (env: TestEnv, op: string, mutate: Mutate) => {
  coordOf(env).tamper = (call, a) => {
    if (call.op !== op) return a;
    const x = structuredClone(a) as Loose;
    mutate(x);
    return x;
  };
};
const answerOf = async (res: Response) => ({ status: res.status, body: await body(res) });
const autoClaim = (env: TestEnv) =>
  direct(env, {
    op: "claim",
    account: ME,
    conversationId: CONV,
    recipientId: PERSON,
    inboundMessageId: IN1,
    actor: "auto:cam",
    payloadDigest: "d".repeat(64),
    generation: "0".repeat(32),
    isDefault: false,
    cooldownMs: 0,
  });

describe("DT-6B-2C-3-R1: contradictory ownership pages refuse before any mutation, claim or POST", () => {
  const thread = (rows: Msg[], over: Record<string, unknown> = {}) => ({
    id: CONV,
    messages: { data: rows },
    ...over,
  });
  const valid = [msg(OWN, ME, 30 * MIN), msg(IN1, PERSON, 5 * MIN)];
  const named = (m: Msg, username?: string): Msg => ({ ...m, from: { id: m.from?.id, username } });

  async function attempt(kind: "prepare" | "confirm" | "register", pages: Record<string, Handler>) {
    const env = makeEnv();
    await connect(env);
    const known = kind === "confirm" ? await prepared(env, instagram()) : null;
    coordOf(env).ops.length = 0;
    const f = instagram({ extra: pages });
    const res =
      kind === "prepare"
        ? await prepare(env, f, newOp())
        : kind === "register"
          ? await register(env, f)
          : await confirm(env, f, known!.op, known!.intent.digest);
    return {
      status: res.status,
      body: await body(res),
      writes: coordOf(env).ops.filter((o) =>
        ["prepareIntent", "registerControl", "claimConfirm"].includes(o),
      ),
      posts: f.posts().length,
    };
  }

  const malformed = { error: "upstream", detail: "malformed page" };
  const refusals: [string, Record<string, Handler>, { error: string; detail: string }][] = [
    [
      "/me with error: null",
      { [`GET ${IG}/me`]: () => ({ user_id: ME, username: "3z.prod", error: null }) },
      malformed,
    ],
    [
      "conversations with error: false",
      { [`GET ${IG}/${ME}/conversations`]: () => ({ data: [{ id: CONV }], error: false }) },
      malformed,
    ],
    [
      "messages with error: null",
      { [`GET ${IG}/${CONV}`]: () => thread(valid, { error: null }) },
      malformed,
    ],
    [
      "a returned foreign conversation id",
      { [`GET ${IG}/${CONV}`]: () => thread(valid, { id: "foreign-conversation" }) },
      { error: "target_invalid", detail: "foreign-conversation" },
    ],
    [
      "a duplicate inbound id with another time",
      { [`GET ${IG}/${CONV}`]: () => thread([...valid, msg(IN1, PERSON, 2 * 86_400_000)]) },
      { error: "target_invalid", detail: "ambiguous-message" },
    ],
    [
      "a duplicate inbound id with another sender",
      { [`GET ${IG}/${CONV}`]: () => thread([...valid, msg(IN1, OTHER, 5 * MIN)]) },
      { error: "target_invalid", detail: "ambiguous-message" },
    ],
    [
      "a non-owner id carrying the owner's username",
      {
        [`GET ${IG}/${CONV}`]: () =>
          thread([...valid, named(msg("masked", OTHER, MIN), "3z.prod")]),
      },
      { error: "target_invalid", detail: "ambiguous-identity" },
    ],
    [
      "the owner id under another username",
      { [`GET ${IG}/${CONV}`]: () => thread([named(valid[0], "imposter"), valid[1]]) },
      { error: "target_invalid", detail: "ambiguous-identity" },
    ],
    [
      "one customer id under two usernames",
      {
        [`GET ${IG}/${CONV}`]: () =>
          thread([...valid, named(msg("again", PERSON, 4 * MIN), "sara.two")]),
      },
      { error: "target_invalid", detail: "ambiguous-identity" },
    ],
    [
      "two customer ids sharing one username",
      {
        [`GET ${IG}/${CONV}`]: () => thread([...valid, named(msg("twin", OTHER, 4 * MIN), "sara")]),
      },
      { error: "target_invalid", detail: "ambiguous-identity" },
    ],
  ];
  for (const [name, pages, want] of refusals)
    for (const kind of ["prepare", "confirm", "register"] as const)
      it(`${kind}: ${name}`, async () => {
        expect(await attempt(kind, pages)).toEqual({
          status: STATUS_OF[want.error],
          body: want,
          writes: [],
          posts: 0,
        });
      });

  it("an omitted response identity is not a new requirement; identical duplicates and nameless senders prove", async () => {
    for (const rows of [valid, [...valid, valid[1]], [named(valid[0]), named(valid[1])]])
      for (const page of [thread(rows), { messages: { data: rows } }]) {
        const pages = { [`GET ${IG}/${CONV}`]: () => page };
        expect((await attempt("prepare", pages)).body.intent).toMatchObject({ state: "prepared" });
        expect((await attempt("register", pages)).body.control).toMatchObject({
          recipientId: PERSON,
        });
        const sent = await attempt("confirm", pages);
        expect(sent.body.intent).toMatchObject({ state: "sent" });
        expect(sent.posts).toBe(1);
      }
  });
});

describe("DT-6B-2C-3-R1: one exclusive state-proof table; versions bound to what the request knows", () => {
  const PROOF: Record<string, string[]> = {
    prepared: [],
    dispatching: ["claimedAt"],
    sent: ["claimedAt", "settledAt", "providerMessageId"],
    rejected: ["claimedAt", "settledAt", "failureCode"],
    unknown: ["claimedAt", "settledAt", "unknownReason"],
    already_claimed: ["failureCode", "failureDetail"],
    cancelled: [],
    expired: [],
  };
  const FIELDS: Record<string, string> = {
    claimedAt: NOW.toISOString(),
    settledAt: NOW.toISOString(),
    providerMessageId: "foreign-message",
    failureCode: "meta_10",
    failureDetail: "automatic",
    unknownReason: "timeout",
  };

  async function inState(state: string) {
    const env = makeEnv();
    await connect(env);
    const provider: Record<string, Handler> =
      state === "rejected"
        ? { [`POST ${IG}/${ME}/messages`]: () => json({ error: { code: 10 } }, 400) }
        : state === "unknown"
          ? { [`POST ${IG}/${ME}/messages`]: () => json({ recipient_id: OTHER, message_id: "m" }) }
          : {};
    const f = instagram({ extra: provider });
    const { op, intent } = await prepared(env, f);
    if (state === "dispatching") coordOf(env).failing.add("settleManual");
    if (state === "already_claimed") await autoClaim(env);
    if (["dispatching", "sent", "rejected", "unknown", "already_claimed"].includes(state))
      await confirm(env, f, op, intent.digest);
    if (state === "cancelled") await cancel(env, f, op);
    coordOf(env).failing.clear();
    const o: Opts =
      state === "expired" ? { clock: () => new Date(NOW.getTime() + 2 * 86_400_000) } : {};
    return { env, f, op, intent, o };
  }

  for (const state of Object.keys(PROOF))
    it(`${state}: its required proof present, every other proof field absent`, async () => {
      const s = await inState(state);
      expect((await intentOf(await status(s.env, s.f, s.op, s.o))).state).toBe(state);
      for (const k of Object.keys(FIELDS)) {
        tamperOp(s.env, "getIntent", (x) => {
          if (PROOF[state].includes(k)) delete x.intent[k];
          else x.intent[k] = FIELDS[k];
        });
        const got = await answerOf(await status(s.env, s.f, s.op, s.o));
        expect({ k, ...got }).toEqual({ k, ...UNAVAILABLE });
      }
    });

  it("a claim answer must be exactly the known version + 1: a skipped version sends nothing, never replays", async () => {
    const s = await inState("prepared");
    tamperOp(s.env, "claimConfirm", (x) => (x.intent.receiptVersion = 3));
    expect(await answerOf(await confirm(s.env, s.f, s.op, s.intent.digest))).toEqual(UNAVAILABLE);
    coordOf(s.env).tamper = undefined;
    expect((await intentOf(await confirm(s.env, s.f, s.op, s.intent.digest))).state).toBe(
      "dispatching",
    );
    expect(s.f.posts()).toHaveLength(0);
  });

  it("a lost claim (already_claimed) answer must be newer than the known version", async () => {
    const s = await inState("prepared");
    await autoClaim(s.env);
    tamperOp(s.env, "claimConfirm", (x) => (x.intent.receiptVersion = 1));
    expect(await answerOf(await confirm(s.env, s.f, s.op, s.intent.digest))).toEqual(UNAVAILABLE);
    coordOf(s.env).tamper = undefined;
    expect((await intentOf(await status(s.env, s.f, s.op))).state).toBe("already_claimed");
    expect(s.f.posts()).toHaveLength(0);
  });

  for (const [name, mutate] of [
    ["the intent version equals the claim's", (x) => (x.intent.receiptVersion = 2)],
    ["the effect version equals the claim's", (x) => (x.effect.receiptVersion = 1)],
  ] as [string, Mutate][])
    it(`a settlement where ${name} stays pending and is never replayed`, async () => {
      const s = await inState("prepared");
      tamperOp(s.env, "settleManual", mutate);
      expect(await body(await confirm(s.env, s.f, s.op, s.intent.digest))).toMatchObject({
        intent: { state: "dispatching" },
        observed: { state: "unknown", reason: "receipt" },
        settlement: "pending",
      });
      coordOf(s.env).tamper = undefined;
      expect((await intentOf(await status(s.env, s.f, s.op))).state).toBe("sent");
      await confirm(s.env, s.f, s.op, s.intent.digest);
      expect(s.f.posts()).toHaveLength(1);
    });

  it("a same-outcome settled:false receipt with newer versions is still the receipt", async () => {
    const s = await inState("prepared");
    tamperOp(s.env, "settleManual", (x) => (x.settled = false));
    expect(await intentOf(await confirm(s.env, s.f, s.op, s.intent.digest))).toMatchObject({
      state: "sent",
      receiptVersion: 3,
    });
    expect(s.f.posts()).toHaveLength(1);
  });
});

describe("DT-6B-2C-3-R1: control answers bound to the action, the revision and the verified handle", () => {
  async function handleOf() {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const control = (await body(await register(env, f))).control as Record<string, string>;
    return { env, f, handleId: control.handleId, control };
  }
  const cas = (s: Awaited<ReturnType<typeof handleOf>>, action: string, expectedRevision: number) =>
    ctl(s.env, s.f, s.handleId, action, { expectedRevision });

  it("takeover answers human at expected + 1 (changed) or a genuine no-op at expected; resume answers auto", async () => {
    const s = await handleOf();
    for (const [action, expected, changed, mode, revision] of [
      ["takeover", 0, true, "human", 1],
      ["takeover", 1, false, "human", 1],
      ["resume", 1, true, "auto", 2],
      ["resume", 2, false, "auto", 2],
    ] as const)
      expect(await body(await cas(s, action, expected))).toMatchObject({
        changed,
        conversation: { mode, revision },
      });
    expect(s.f.posts()).toHaveLength(0);
  });

  for (const [action, expected, name, mutate] of [
    ["takeover", 0, "mode auto", (x) => (x.conversation.mode = "auto")],
    ["takeover", 0, "revision 0", (x) => (x.conversation.revision = 0)],
    ["takeover", 0, "revision 2", (x) => (x.conversation.revision = 2)],
    ["takeover", 0, "changed false at revision 1", (x) => (x.changed = false)],
    ["takeover", 0, "no changed flag", (x) => delete x.changed],
    ["takeover", 0, "a foreign conversation", (x) => (x.conversation.conversationId = "other")],
    ["takeover", 1, "a no-op that moved the revision", (x) => (x.conversation.revision = 2)],
    ["resume", 1, "mode human", (x) => (x.conversation.mode = "human")],
    ["resume", 1, "changed true at revision 1", (x) => (x.conversation.revision = 1)],
  ] as [string, number, string, Mutate][])
    it(`${action} from revision ${expected} refuses an answer with ${name}`, async () => {
      const s = await handleOf();
      if (action === "resume" || expected === 1) await cas(s, "takeover", 0);
      tamperOp(s.env, action === "takeover" ? "controlTakeover" : "controlResume", mutate);
      expect(await answerOf(await cas(s, action, expected))).toEqual(UNAVAILABLE);
    });

  it("a stale CAS is a pure conflict with the verified handle's own target; contradictions are unreadable", async () => {
    const s = await handleOf();
    await cas(s, "takeover", 0);
    const want = {
      status: 409,
      body: {
        error: "conflict",
        conversation: { account: ME, conversationId: CONV, mode: "human", revision: 1 },
        control: { handleId: s.handleId, account: ME, conversationId: CONV, recipientId: PERSON },
      },
    };
    expect(await answerOf(await cas(s, "resume", 0))).toEqual(want);
    for (const mutate of [
      (x) => (x.conversation.conversationId = "FOREIGN-CONVERSATION"),
      (x) => (x.conversation.account = "17841000000000002"),
      (x) => (x.control.handleId = "f".repeat(32)),
      (x) => (x.control.conversationId = "FOREIGN-CONVERSATION"),
      (x) => delete x.control,
      (x) => delete x.control.evidenceDigest,
      (x) => (x.conversation.revision = 0),
      (x) => (x.extra = true),
    ] as Mutate[]) {
      tamperOp(s.env, "controlResume", mutate);
      expect(await answerOf(await cas(s, "resume", 0))).toEqual(UNAVAILABLE);
    }
    coordOf(s.env).tamper = undefined;
    expect(await answerOf(await cas(s, "resume", 0))).toEqual(want);
    expect(s.f.posts()).toHaveLength(0);
  });
});

describe("DT-6B-2C-3-R1: control status needs the complete handle and complete claimed rows of its target", () => {
  const CONTROL_FIELDS = [
    "handleId",
    "account",
    "conversationId",
    "recipientId",
    "registeredGeneration",
    "evidenceDigest",
    "createdAt",
    "usedAt",
  ];
  const ROW_FIELDS = [
    "account",
    "conversationId",
    "recipientId",
    "inboundMessageId",
    "actor",
    "generation",
    "payloadDigest",
    "claimedAt",
    "state",
    "receiptVersion",
  ];

  it("a genuine view with a claimed row reads; any missing, foreign or settled field refuses the whole answer", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const handleId = ((await body(await register(env, f))).control as { handleId: string })
      .handleId;
    await autoClaim(env);
    const read = async (mutate?: Mutate) => {
      coordOf(env).tamper = undefined;
      if (mutate) tamperOp(env, "controlStatus", mutate);
      return answerOf(await ctl(env, f, handleId));
    };
    expect((await read()).body).toMatchObject({
      control: { handleId },
      inFlight: [{ actor: "auto:cam", recipientId: PERSON, state: "claimed" }],
      inFlightTotal: 1,
    });
    for (const k of CONTROL_FIELDS)
      expect({ k, ...(await read((x) => delete x.control[k])) }).toEqual({ k, ...UNAVAILABLE });
    for (const k of ROW_FIELDS)
      expect({ k, ...(await read((x) => delete x.inFlight[0][k])) }).toEqual({ k, ...UNAVAILABLE });
    for (const [k, v] of [
      ["account", "17841000000000002"],
      ["conversationId", "other"],
      ["recipientId", OTHER],
      ["state", "sent"],
      ["actor", "robot:x"],
      ["settledAt", NOW.toISOString()],
      ["providerMessageId", "m"],
      ["failureCode", "meta_10"],
      ["unknownReason", "timeout"],
    ])
      expect({ k, ...(await read((x) => (x.inFlight[0][k] = v))) }).toEqual({ k, ...UNAVAILABLE });
    // Bounded, truthful counts are still required.
    expect(await read((x) => (x.inFlightTotal = 0))).toEqual(UNAVAILABLE);
    expect(await read((x) => (x.inFlightTruncated = true))).toEqual(UNAVAILABLE);
    expect((await read()).body).toMatchObject({ inFlightTotal: 1 });
  });
});

/* ---------- DT-6B-3C: 1000 UTF-8 bytes of the canonical message.text ---------- */

const bytesOf = (s: string) => new TextEncoder().encode(s).length;
/** The DM send generation of the `connect` fixture (`ig-dm-gen|account|connectedAt`). */
const SEND_GEN = sha(`ig-dm-gen|${ME}|2026-10-01T08:00:00.000Z`).slice(0, 32);

const MIXED = "ab" + "ب".repeat(249) + "€" + "😀".repeat(124) + "!";
const ESCAPED = "a" + '"\\\n'.repeat(332) + "bcd";
/** [name, raw text, the canonical text (null: text_invalid), its exact UTF-8 bytes]. */
const BOUNDARY: [string, string, string | null, number?][] = [
  ["ASCII 1000 bytes", "a".repeat(1000), "a".repeat(1000), 1000],
  ["ASCII 1001 bytes", "a".repeat(1001), null],
  ["Arabic 500 two-byte letters", "ب".repeat(500), "ب".repeat(500), 1000],
  ["Arabic 501 two-byte letters", "ب".repeat(501), null],
  ["emoji 250 four-byte code points", "😀".repeat(250), "😀".repeat(250), 1000],
  ["emoji 251 four-byte code points", "😀".repeat(251), null],
  ["mixed scripts at 1000 bytes", MIXED, MIXED, 1000],
  ["mixed scripts at 1001 bytes", MIXED + "a", null],
  ["NFC reduces 1500 raw bytes to 1000", "é".repeat(500), "é".repeat(500), 1000],
  ["NFC still over by one", "é".repeat(500) + "a", null],
  ["outer whitespace is not counted", " \n\t" + "a".repeat(1000) + " \r\n", "a".repeat(1000), 1000],
  ["interior newlines and JSON-escaped characters count once", ESCAPED, ESCAPED, 1000],
  ["interior escapes over by one", ESCAPED + "e", null],
  ["a lone high surrogate", "a".repeat(10) + "\ud800", null],
  ["a lone low surrogate", "\udc00" + "a".repeat(10), null],
];

/** A prepared intent written straight into the coordinator, as the code-point policy admitted it: never via Prepare. */
async function seedLegacy(env: TestEnv, text: string) {
  const operationId = newOp();
  const got = await direct(env, {
    op: "prepareIntent",
    input: {
      operationId,
      account: ME,
      generation: SEND_GEN,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN1,
      inboundAt: NOW.getTime() - 5 * MIN,
      text,
      digest: sha(exactBody(text)),
      draftRevision: "rev-legacy",
      reviewExpiresAt: NOW.getTime() + 10 * MIN,
    },
  });
  const intent = got.intent as Intent;
  expect(intent).toMatchObject({ state: "prepared", text, digest: sha(exactBody(text)) });
  return { op: operationId, intent };
}

/** Status, cancel and confirm with no store, no gate and no provider: the durable handle only. */
function offline(env: TestEnv, clock = NOW) {
  const noProvider = vi.fn<typeof fetch>(async () => {
    throw new Error("no provider call expected");
  });
  const h = instagramDmHandler({
    fetch: noProvider,
    now: () => clock,
    eligibility: () => {
      throw new Error("no gate expected");
    },
  });
  const run = async (path: string, init: RequestInit = {}) => {
    const r = req(`${DM}${path}`, init);
    const rest = new URL(r.url).pathname.split("/").filter(Boolean).slice(4);
    const deps = { store: null, seal: SEAL, coordinator: env.INSTAGRAM_DM_COORDINATOR };
    return (await h(r, rest, deps, { json: (b, s) => json(b, s) }))!;
  };
  const postJson = (path: string, b: unknown) =>
    run(path, { method: "POST", body: JSON.stringify(b) });
  return {
    noProvider,
    status: (op: string) => run(`/send/${op}?account=${ME}`),
    cancel: (op: string) => postJson(`/send/${op}/cancel`, { account: ME }),
    confirm: (op: string, digest: string) =>
      postJson("/send/confirm", { operationId: op, digest, account: ME }),
  };
}

describe("DT-6B-3C: a new manual DM is at most 1000 UTF-8 bytes of the canonical message.text", () => {
  for (const [name, raw, canonical, bytes] of BOUNDARY)
    it(`Prepare: ${name}`, async () => {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const res = await prepare(env, f, newOp(), { text: raw });
      if (canonical === null) {
        // Refused before any ownership GET or coordinator call: zero effects, nothing truncated or stored.
        expect(res.status).toBe(400);
        expect(await body(res)).toEqual({ error: "text_invalid" });
        expect(f.calls()).toEqual([]);
        expect(coordOf(env).ops).toEqual([]);
        expect(env.SOCIAL_KV.writes).toBe(0);
        return;
      }
      const intent = await intentOf(res);
      expect(intent.state).toBe("prepared");
      // Exactly the canonical text: never cut, split or replaced.
      expect(intent.text).toBe(canonical);
      expect(bytesOf(intent.text)).toBe(bytes);
      expect(intent.digest).toBe(sha(exactBody(canonical)));
      expect(f.posts()).toEqual([]);
    });

  it("a valid boundary text is confirmed as exactly its reviewed bytes: one claim, one POST, the same digest", async () => {
    for (const text of ["ب".repeat(500), "😀".repeat(250), ESCAPED]) {
      const env = makeEnv();
      await connect(env);
      const f = instagram();
      const { op, intent } = await prepared(env, f, { text });
      f.mockClear();
      const done = await intentOf(await confirm(env, f, op, intent.digest));
      expect(done).toMatchObject({ state: "sent", text, digest: intent.digest });
      const posts = f.posts();
      expect(posts).toHaveLength(1);
      expect(posts[0].init.body).toBe(exactBody(text));
      expect(sha(String(posts[0].init.body))).toBe(intent.digest);
      const wire = JSON.parse(String(posts[0].init.body)) as { message: { text: string } };
      expect(bytesOf(wire.message.text)).toBe(1000);
      expect(coordOf(env).ops.filter((o) => o === "claimConfirm")).toHaveLength(1);
    }
  });

  it("an oversized Prepare has zero effects: no GET, no coordinator, no KV write, no intent", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const op = newOp();
    for (const text of ["ب".repeat(501), "😀".repeat(251), "a".repeat(1001)])
      expect(await body(await prepare(env, f, op, { text }))).toEqual({ error: "text_invalid" });
    expect(f.calls()).toEqual([]);
    expect(coordOf(env).ops).toEqual([]);
    expect(env.SOCIAL_KV.writes).toBe(0);
    expect(await body(await status(env, f, op))).toEqual({ error: "not_found" });
  });

  it("a directly seeded legacy prepared intent over the bound is refused by Confirm before any GET, claim or POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = instagram();
    const text = "ب".repeat(501);
    const { op, intent } = await seedLegacy(env, text);
    coordOf(env).ops.length = 0;
    const res = await confirm(env, f, op, intent.digest);
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "text_invalid" });
    expect(f.calls()).toEqual([]);
    expect(coordOf(env).ops).toEqual(["getIntent"]);
    // Nothing rewritten or cancelled: the same prepared intent, text and digest.
    expect(await intentOf(await status(env, f, op))).toEqual(intent);
    // Also with no store at all (no token read): the same guaranteed pre-claim refusal.
    const o = offline(env);
    expect(await body(await o.confirm(op, intent.digest))).toEqual({ error: "text_invalid" });
    expect(o.noProvider).not.toHaveBeenCalled();
    // A changed digest is still a conflict first; the owner can still cancel it.
    expect(await body(await confirm(env, f, op, "e".repeat(64)))).toEqual({ error: "conflict" });
    expect((await intentOf(await cancel(env, f, op))).state).toBe("cancelled");
    expect(f.calls()).toEqual([]);
    expect(coordOf(env).ops).not.toContain("claimConfirm");
  });

  const LEGACY = ["ب".repeat(501), "😀".repeat(1000)];
  const STATES = [
    "prepared",
    "dispatching",
    "sent",
    "rejected",
    "unknown",
    "already_claimed",
    "cancelled",
    "expired",
  ];
  for (const text of LEGACY)
    for (const state of STATES)
      it(`an old ${bytesOf(text)}-byte ${state} receipt: offline Status, Cancel and repeated Confirm keep its proof`, async () => {
        const env = makeEnv();
        const { op, intent } = await seedLegacy(env, text);
        const at = NOW.getTime() + MIN;
        if (state === "already_claimed") await autoClaim(env);
        if (["dispatching", "sent", "rejected", "unknown", "already_claimed"].includes(state))
          await direct(env, {
            op: "claimConfirm",
            account: ME,
            operationId: op,
            digest: intent.digest,
            now: at,
          });
        const outcome =
          state === "sent"
            ? { state, providerMessageId: "mid-legacy-1" }
            : state === "rejected"
              ? { state, code: "meta_10" }
              : state === "unknown"
                ? { state, reason: "timeout" }
                : null;
        if (outcome)
          await direct(env, {
            op: "settleManual",
            account: ME,
            operationId: op,
            outcome,
            now: at + 1000,
          });
        if (state === "cancelled")
          await direct(env, { op: "cancelIntent", account: ME, operationId: op });
        const o = offline(
          env,
          state === "expired" ? new Date(NOW.getTime() + 2 * 86_400_000) : NOW,
        );
        coordOf(env).ops.length = 0;
        const before = await intentOf(await o.status(op));
        expect(before).toMatchObject({ state, text, digest: intent.digest, operationId: op });
        expect(sha(exactBody(before.text))).toBe(before.digest);
        const confirmed = await o.confirm(op, intent.digest);
        if (state === "prepared") {
          // Today's limit refuses a new send of the old text before any claim; the intent stays as it was.
          expect(await body(confirmed)).toEqual({ error: "text_invalid" });
          expect(await intentOf(await o.status(op))).toEqual(before);
          expect((await intentOf(await o.cancel(op))).state).toBe("cancelled");
        } else {
          // Status only: the stored proof is answered unchanged, never dispatched again or erased.
          expect(await intentOf(confirmed)).toEqual(before);
          expect(await intentOf(await o.cancel(op))).toEqual(before);
          expect(await intentOf(await o.status(op))).toEqual(before);
        }
        expect(o.noProvider).not.toHaveBeenCalled();
        expect(coordOf(env).ops).not.toContain("claimConfirm");
        expect(coordOf(env).ops).not.toContain("settleManual");
      });
});
