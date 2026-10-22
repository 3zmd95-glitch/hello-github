import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  DM_CONTROL_ROWS_MAX,
  bindDmControl,
  dmControlKey,
  instagramDmControlReadiness,
  parseDmControlConflict,
  parseDmControlView,
  requestDmControlRegister,
  requestDmControlResume,
  requestDmControlStatus,
  requestDmControlTakeover,
  type DmControlResult,
  type DmControlView,
} from "./inboxInstagramDmControl";

// 🛟 Verified-handle Instagram conversation takeover/resume, client wire contract (packet DT-6B-2C-5B,
// planning/tools/37-inbox-send.md). Every answer below is a REAL Worker answer: the dashboard's own transport calls the
// real `scout.handle` (production: closed registration, bearer-only control status/takeover/resume of an existing
// handle) or the real `instagramDmHandler` with an injected `{ ok: true }` eligibility (registration in this test
// only), over the real InstagramDmCoordinator on node:sqlite and a fake Instagram transport. Nothing leaves the process.

vi.setConfig({ testTimeout: 30_000 });

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const CFG = { url: BASE, token: TOKEN };
const NOW = new Date("2026-10-17T09:00:00Z");
const MIN = 60_000;
const IG = "graph.instagram.com/v21.0";
const ME = "17841000000000001";
const OAUTH_USER = "26000000000000009";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const OTHER = "990000000000002";
const OWN = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjA=";
const IN = (n: number) => `aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlE${String(n).padStart(3, "0")}=`;
const CONTROL = "/social/inbox/instagram/dm/control";

/* ---------- the real Worker modules (computed paths: tsc does not follow them across the boundary) ---------- */

type Env = Record<string, unknown>;
type Deps = { fetch: typeof fetch; now: () => Date };
type Handle = (req: Request, env: Env, ctx: undefined, deps: Deps) => Promise<Response>;
type DmHandler = (
  req: Request,
  rest: string[],
  deps: { store: unknown; seal: string | undefined; coordinator: unknown },
  reply: { json(body: unknown, status: number): Response },
) => Promise<Response | null>;
interface WorkerStore {
  putTokens(p: "instagram", t: Record<string, unknown>): Promise<void>;
  putStatus(p: "instagram", s: Record<string, unknown>): Promise<void>;
  deleteTokens(p: "instagram"): Promise<void>;
}
type Coordinator = new (state: unknown) => { fetch(req: Request): Promise<Response> };

const WORKER = "../workers/scout/src";
const load = async () => {
  const [{ handle }, { Store }, { instagramDmHandler }, { InstagramDmCoordinator }] =
    await Promise.all([
      import(/* @vite-ignore */ `${WORKER}/scout`) as Promise<{ handle: Handle }>,
      import(/* @vite-ignore */ `${WORKER}/social/store`) as Promise<{
        Store: { from(env: Env): WorkerStore | null };
      }>,
      import(/* @vite-ignore */ `${WORKER}/social/inboxSendInstagramDm`) as Promise<{
        instagramDmHandler(o: {
          fetch: typeof fetch;
          now: () => Date;
          eligibility?: () => { ok: true };
        }): DmHandler;
      }>,
      import(/* @vite-ignore */ `${WORKER}/social/instagramDmCoordinator`) as Promise<{
        InstagramDmCoordinator: Coordinator;
      }>,
    ]);
  return { handle, Store, instagramDmHandler, InstagramDmCoordinator };
};

function fakeKV() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
  };
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

/** The real DM coordinator per name on node:sqlite. */
function coordinator(Coord: Coordinator) {
  const dbs = new Map<string, DatabaseSync>();
  const call = async (id: string, url: string, init: RequestInit) => {
    if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
    return new Coord({ storage: sqliteStorage(dbs.get(id)!) }).fetch(new Request(url, init));
  };
  return {
    idFromName: (name: string) => name,
    get: (id: string) => ({ fetch: (url: string, init: RequestInit) => call(id, url, init) }),
    /** A direct coordinator call (the automation's own claim and settlement). */
    direct: async (body: Record<string, unknown>) =>
      (await call(`instagram-dm|${ME}`, "https://c/", {
        method: "POST",
        body: JSON.stringify({ now: NOW.getTime(), ...body }),
      })) as Response,
  };
}

type Route = (url: URL, init?: RequestInit) => Response;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The fake Instagram API: /me, the owned-conversation first page and that conversation's first message page. */
function provider(over: Record<string, Route> = {}, customer = PERSON) {
  const row = (id: string, from: string, ago: number) => ({
    id,
    created_time: new Date(NOW.getTime() - ago).toISOString(),
    from: { id: from, username: from === ME ? "3z.prod" : "sara" },
  });
  const routes: Record<string, Route> = {
    [`GET ${IG}/me`]: () => json({ user_id: ME, username: "3z.prod" }),
    [`GET ${IG}/${ME}/conversations`]: () => json({ data: [{ id: CONV }] }),
    [`GET ${IG}/${CONV}`]: () =>
      json({
        id: CONV,
        messages: { data: [row(OWN, ME, 30 * MIN), row(IN(1), customer, MIN)] },
      }),
    ...over,
  };
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const route = routes[`${init?.method ?? "GET"} ${url.host}${url.pathname}`];
    return route ? route(url, init) : json({ error: { message: "unmocked" } }, 404);
  });
}

async function world() {
  const m = await load();
  const coord = coordinator(m.InstagramDmCoordinator);
  const env: Env = {
    SCOUT_TOKEN: TOKEN,
    INBOX_SEAL_SECRET: SEAL,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: fakeKV(),
    INSTAGRAM_DM_COORDINATOR: coord,
  };
  const store = m.Store.from(env)!;
  await store.putTokens("instagram", {
    accessToken: "ig-live-token",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 365 * 86_400_000).toISOString(),
    userId: OAUTH_USER,
    scope: "instagram_business_basic,instagram_business_manage_messages",
    canReply: true,
  });
  await store.putStatus("instagram", {
    connectedAt: "2026-10-01T08:00:00.000Z",
    handle: "3z.prod",
  });
  return { m, env, coord, store };
}
type World = Awaited<ReturnType<typeof world>>;

/** The dashboard's transport pointed at the real production router (`scout.handle`). */
const viaRouter =
  (w: World, transport: typeof fetch = provider()): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", APP);
    return w.m.handle(new Request(String(input), { ...init, headers }), w.env, undefined, {
      fetch: transport,
      now: () => NOW,
    });
  };

/** The dashboard's transport pointed at the real DM handler with eligibility injected `{ ok: true }` (test only). */
const viaEligible =
  (w: World, transport: typeof fetch = provider()): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", APP);
    const req = new Request(String(input), { ...init, headers });
    const rest = new URL(req.url).pathname.split("/").filter(Boolean).slice(4);
    const res = await w.m.instagramDmHandler({
      fetch: transport,
      now: () => NOW,
      eligibility: () => ({ ok: true }),
    })(
      req,
      rest,
      { store: w.store, seal: SEAL, coordinator: w.env.INSTAGRAM_DM_COORDINATOR },
      { json: (b, status) => json(b, status) },
    );
    return res!;
  };

/** The raw JSON body and status the Worker answers (fixtures for the malformed cases). */
const raw = async (f: typeof fetch, path: string, init: RequestInit = {}) => {
  const res = await f(`${BASE}${CONTROL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const view = (r: DmControlResult): DmControlView => {
  if (!r.ok) throw new Error(`expected a view, got ${r.error}`);
  return r.view;
};

/** A registered handle (eligible test route) and its first view. */
async function registered(w: World, transport = provider()) {
  const v = view(
    await requestDmControlRegister(
      CFG,
      { account: ME, conversationId: CONV },
      viaEligible(w, transport),
    ),
  );
  return { v, handle: v.control.handleId };
}

const claim = (w: World, inbound: string, actor = "auto:cam") =>
  w.coord.direct({
    op: "claim",
    account: ME,
    conversationId: CONV,
    recipientId: PERSON,
    inboundMessageId: inbound,
    actor,
    payloadDigest: "d".repeat(64),
    generation: "0".repeat(32),
    isDefault: false,
    cooldownMs: 0,
  });
const settleUnknown = (w: World, inbound: string, actor = "auto:cam") =>
  w.coord.direct({
    op: "settle",
    account: ME,
    conversationId: CONV,
    inboundMessageId: inbound,
    actor,
    outcome: { state: "unknown", reason: "timeout" },
  });

describe("control answers: real Worker views through the dashboard transport", () => {
  it("registration learns the server-proven recipient and a 32-hex handle; the view is complete and has no `changed`", async () => {
    const w = await world();
    const { v } = await registered(w);
    expect(v.control).toMatchObject({ account: ME, conversationId: CONV, recipientId: PERSON });
    expect(v.control.handleId).toMatch(/^[0-9a-f]{32}$/);
    expect(v.control.registeredGeneration).toMatch(/^[0-9a-f]{32}$/);
    expect(v.control.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(v.conversation).toMatchObject({
      account: ME,
      conversationId: CONV,
      mode: "auto",
      revision: 0,
    });
    expect(v).toMatchObject({
      inFlight: [],
      inFlightTotal: 0,
      inFlightTruncated: false,
      uncertainTotal: 0,
    });
    expect("changed" in v).toBe(false);
  });

  it("a repeated registration converges on the same handle; another recipient is a pure conflict", async () => {
    const w = await world();
    const a = await registered(w);
    const b = await registered(w);
    expect(b.handle).toBe(a.handle);
    const r = await requestDmControlRegister(
      CFG,
      { account: ME, conversationId: CONV },
      viaEligible(w, provider({}, OTHER)),
    );
    expect(r).toEqual({ ok: false, error: "conflict" });
  });

  it("production registration is closed (permission_unverified) and asks Instagram nothing; the client readiness is the same literal", async () => {
    const w = await world();
    const transport = provider();
    const r = await requestDmControlRegister(
      CFG,
      { account: ME, conversationId: CONV },
      viaRouter(w, transport),
    );
    expect(r).toEqual({ ok: false, error: "no_permission", detail: "permission_unverified" });
    expect(transport).not.toHaveBeenCalled();
    expect(instagramDmControlReadiness()).toEqual({ ok: false, reason: "permission_unverified" });
  });

  it("a conversation without a customer is target_invalid / no-customer (allowlisted detail)", async () => {
    const w = await world();
    const r = await requestDmControlRegister(
      CFG,
      { account: ME, conversationId: CONV },
      viaEligible(
        w,
        provider({
          [`GET ${IG}/${CONV}`]: () =>
            json({
              id: CONV,
              messages: {
                data: [{ id: OWN, created_time: NOW.toISOString(), from: { id: ME } }],
              },
            }),
        }),
      ),
    );
    expect(r).toEqual({ ok: false, error: "target_invalid", detail: "no-customer" });
  });

  it("status, takeover and resume of an existing handle need only the bearer (production router, no Instagram token)", async () => {
    const w = await world();
    const { handle } = await registered(w);
    await w.store.deleteTokens("instagram");
    const transport = provider();
    const f = viaRouter(w, transport);
    const s = view(await requestDmControlStatus(CFG, handle, ME, f));
    expect(s.conversation).toMatchObject({ mode: "auto", revision: 0 });
    expect("changed" in s).toBe(false);
    const t = view(
      await requestDmControlTakeover(CFG, handle, { account: ME, expectedRevision: 0 }, f),
    );
    expect(t.conversation).toMatchObject({ mode: "human", revision: 1 });
    expect(t.changed).toBe(true);
    // A genuine no-op: already human at the expected revision.
    const n = view(
      await requestDmControlTakeover(CFG, handle, { account: ME, expectedRevision: 1 }, f),
    );
    expect(n.conversation).toMatchObject({ mode: "human", revision: 1 });
    expect(n.changed).toBe(false);
    const back = view(
      await requestDmControlResume(CFG, handle, { account: ME, expectedRevision: 1 }, f),
    );
    expect(back.conversation).toMatchObject({ mode: "auto", revision: 2 });
    expect(back.changed).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });

  it("a stale expected revision is the narrow bound conflict: no counts, no full proof, never a view", async () => {
    const w = await world();
    const { handle } = await registered(w);
    const f = viaRouter(w);
    view(await requestDmControlTakeover(CFG, handle, { account: ME, expectedRevision: 0 }, f));
    const r = await requestDmControlResume(CFG, handle, { account: ME, expectedRevision: 0 }, f);
    expect(r).toEqual({
      ok: false,
      error: "conflict",
      conflict: {
        control: { handleId: handle, account: ME, conversationId: CONV, recipientId: PERSON },
        conversation: { account: ME, conversationId: CONV, mode: "human", revision: 1 },
      },
    });
    const { status, body } = await raw(f, `/${handle}/resume`, {
      method: "POST",
      body: JSON.stringify({ account: ME, expectedRevision: 0 }),
    });
    expect(status).toBe(409);
    expect(Object.keys(body).sort()).toEqual(["control", "conversation", "error"]);
    expect(parseDmControlView(body)).toBeNull();
    expect(parseDmControlConflict(body, 0)).not.toBeNull();
    // The narrow conflict never matches the expected revision it was refused for.
    expect(parseDmControlConflict(body, 1)).toBeNull();
  });

  it("in-flight rows are complete claimed effects of the handle's target; the total stays true when rows are limited", async () => {
    const w = await world();
    const { handle } = await registered(w);
    for (let n = 1; n <= DM_CONTROL_ROWS_MAX + 3; n++) await claim(w, IN(n));
    await settleUnknown(w, IN(1));
    await settleUnknown(w, IN(2));
    const s = view(await requestDmControlStatus(CFG, handle, ME, viaRouter(w)));
    expect(s.inFlight).toHaveLength(DM_CONTROL_ROWS_MAX);
    expect(s.inFlightTotal).toBe(DM_CONTROL_ROWS_MAX + 1);
    expect(s.inFlightTruncated).toBe(true);
    expect(s.uncertainTotal).toBe(2);
    for (const e of s.inFlight)
      expect(e).toMatchObject({
        account: ME,
        conversationId: CONV,
        recipientId: PERSON,
        state: "claimed",
      });
    // Counts change without a revision change.
    expect(s.conversation.revision).toBe(0);
  });

  it("a takeover lost after its commit leaves only the network error; Status then proves the current mode", async () => {
    const w = await world();
    const { handle } = await registered(w);
    const real = viaRouter(w);
    const lossy: typeof fetch = async (input, init) => {
      await real(input, init);
      throw new TypeError("connection reset");
    };
    expect(
      await requestDmControlTakeover(CFG, handle, { account: ME, expectedRevision: 0 }, lossy),
    ).toEqual({ ok: false, error: "network" });
    const s = view(await requestDmControlStatus(CFG, handle, ME, real));
    expect(s.conversation).toMatchObject({ mode: "human", revision: 1 });
  });

  it("an unknown handle is not_found (unavailable, not auto mode); a bad handle is bad_request", async () => {
    const w = await world();
    const f = viaRouter(w);
    expect(await requestDmControlStatus(CFG, "f".repeat(32), ME, f)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await requestDmControlTakeover(CFG, "f".repeat(32), { account: ME, expectedRevision: 0 }, f),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await requestDmControlStatus(CFG, "nothex", ME, f)).toEqual({
      ok: false,
      error: "bad_request",
    });
  });
});

describe("strict shapes: malformed, mixed, foreign and contradictory answers are rejected", () => {
  type Obj = Record<string, unknown>;
  type V = Obj & { control: Obj; conversation: Obj; inFlight: Obj[] };

  async function fixtures() {
    const w = await world();
    const { handle } = await registered(w);
    await claim(w, IN(1));
    const f = viaRouter(w);
    const status = (await raw(f, `/${handle}?account=${ME}`)).body;
    const taken = (
      await raw(f, `/${handle}/takeover`, {
        method: "POST",
        body: JSON.stringify({ account: ME, expectedRevision: 0 }),
      })
    ).body;
    const conflict = (
      await raw(f, `/${handle}/resume`, {
        method: "POST",
        body: JSON.stringify({ account: ME, expectedRevision: 0 }),
      })
    ).body;
    return { handle, status, taken, conflict };
  }
  const clone = (x: unknown): V => JSON.parse(JSON.stringify(x)) as V;

  it("full views: identity, mode, revision, rows, counts and `changed` are checked exactly", async () => {
    const { status, taken } = await fixtures();
    expect(parseDmControlView(status)).not.toBeNull();
    expect(parseDmControlView(taken, { mode: "human", expected: 0 })).not.toBeNull();
    const bad: [string, (v: V) => void][] = [
      ["extra key", (v) => (v.error = "conflict")],
      ["changed on a status", (v) => (v.changed = false)],
      ["handle not hex", (v) => (v.control.handleId = "F".repeat(32))],
      ["handle short", (v) => (v.control.handleId = "f".repeat(31))],
      ["foreign conversation", (v) => (v.conversation.conversationId = "other")],
      ["foreign account", (v) => (v.conversation.account = "17841000000000002")],
      ["mode", (v) => (v.conversation.mode = "paused")],
      ["negative revision", (v) => (v.conversation.revision = -1)],
      ["fractional revision", (v) => (v.conversation.revision = 1.5)],
      ["unsafe revision", (v) => (v.conversation.revision = 2 ** 53)],
      ["settled row", (v) => (v.inFlight[0].settledAt = NOW.toISOString())],
      ["foreign row recipient", (v) => (v.inFlight[0].recipientId = OTHER)],
      ["row state", (v) => (v.inFlight[0].state = "sent")],
      ["total below rows", (v) => (v.inFlightTotal = 0)],
      ["truncated lie", (v) => (v.inFlightTruncated = true)],
      ["negative uncertainty", (v) => (v.uncertainTotal = -1)],
      ["missing counts", (v) => delete v.uncertainTotal],
      ["control missing usedAt", (v) => delete v.control.usedAt],
    ];
    for (const [name, mutate] of bad) {
      const v = clone(status);
      mutate(v);
      expect(parseDmControlView(v), name).toBeNull();
    }
    const rows = clone(status);
    rows.inFlight = Array.from({ length: 21 }, () => clone(status).inFlight[0]);
    rows.inFlightTotal = 21;
    rows.inFlightTruncated = false;
    expect(parseDmControlView(rows), "over 20 rows").toBeNull();
  });

  it("mutation success: requested mode, `changed` required, expected + 1 when changed, expected when not", async () => {
    const { taken } = await fixtures();
    const cas = { mode: "human" as const, expected: 0 };
    expect(parseDmControlView(taken, cas)).not.toBeNull();
    expect(parseDmControlView(taken, { mode: "auto", expected: 0 }), "other mode").toBeNull();
    expect(parseDmControlView(taken, { mode: "human", expected: 1 }), "other expected").toBeNull();
    const noChanged = clone(taken);
    delete noChanged.changed;
    expect(parseDmControlView(noChanged, cas)).toBeNull();
    const lie = clone(taken);
    lie.changed = false;
    expect(parseDmControlView(lie, cas), "changed:false at expected + 1").toBeNull();
    expect(parseDmControlView(taken), "changed on a non-mutation").toBeNull();
  });

  it("the narrow conflict is exactly error + narrow control + narrow conversation, bound and revision ≠ expected", async () => {
    const { conflict, handle } = await fixtures();
    expect(parseDmControlConflict(conflict, 0)).not.toBeNull();
    const bad: [string, (c: V) => void][] = [
      ["extra top key", (c) => (c.inFlightTotal = 0)],
      ["full control", (c) => (c.control.usedAt = NOW.toISOString())],
      ["updatedAt on conversation", (c) => (c.conversation.updatedAt = NOW.toISOString())],
      ["another error", (c) => (c.error = "capacity")],
      ["mixed identity", (c) => (c.conversation.conversationId = "other")],
      ["mixed account", (c) => (c.control.account = "17841000000000002")],
      ["bad mode", (c) => (c.conversation.mode = "paused")],
    ];
    for (const [name, mutate] of bad) {
      const c = clone(conflict);
      mutate(c);
      expect(parseDmControlConflict(c, 0), name).toBeNull();
    }
    const c = parseDmControlConflict(conflict, 0)!;
    const r: DmControlResult = { ok: false, error: "conflict", conflict: c };
    expect(
      bindDmControl(r, {
        account: ME,
        handleId: handle,
        conversationId: CONV,
        recipientId: PERSON,
      }),
    ).toBe(r);
    expect(bindDmControl(r, { account: ME, handleId: "e".repeat(32) })).toEqual({
      ok: false,
      error: "mismatch",
    });
  });

  it("binding refuses another account, conversation, recipient or handle", async () => {
    const { status, handle } = await fixtures();
    const r: DmControlResult = { ok: true, view: parseDmControlView(status)! };
    const e = { account: ME, conversationId: CONV, recipientId: PERSON, handleId: handle };
    expect(bindDmControl(r, e)).toBe(r);
    for (const over of [
      { account: "17841000000000002" },
      { conversationId: "other" },
      { recipientId: OTHER },
      { handleId: "e".repeat(32) },
    ])
      expect(bindDmControl(r, { ...e, ...over }), JSON.stringify(over)).toEqual({
        ok: false,
        error: "mismatch",
      });
  });

  it("the transport: encoded values, manual redirects, the bearer, allowlisted errors only", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const answer = (status: number, body: unknown) =>
      vi.fn<typeof fetch>(async (input, init) => {
        seen.push({ url: String(input), init });
        return json(body, status);
      });
    const H = "f".repeat(32);
    await requestDmControlStatus(CFG, "a/b", "x&y", answer(404, { error: "not_found" }));
    expect(seen[0].url).toBe(`${BASE}${CONTROL}/a%2Fb?account=x%26y`);
    expect(seen[0].init?.redirect).toBe("manual");
    expect(new Headers(seen[0].init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    await requestDmControlTakeover(
      CFG,
      "a b",
      { account: ME, expectedRevision: 3 },
      answer(404, { error: "not_found" }),
    );
    expect(seen[1].url).toBe(`${BASE}${CONTROL}/a%20b/takeover`);
    expect(seen[1].init?.method).toBe("POST");
    expect(JSON.parse(String(seen[1].init?.body))).toEqual({ account: ME, expectedRevision: 3 });
    // Provider words and unknown details are dropped; an error beside anything else is unreadable.
    expect(
      await requestDmControlStatus(
        CFG,
        H,
        ME,
        answer(502, { error: "upstream", detail: "me: secret" }),
      ),
    ).toEqual({ ok: false, error: "upstream" });
    expect(
      await requestDmControlStatus(CFG, H, ME, answer(404, { error: "not_found", control: {} })),
    ).toEqual({ ok: false, error: "upstream" });
    expect(await requestDmControlStatus(CFG, H, ME, answer(418, { error: "teapot" }))).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(
      await requestDmControlStatus(CFG, H, ME, answer(401, { error: "unauthorized" })),
    ).toEqual({ ok: false, error: "auth" });
    expect(await requestDmControlStatus(CFG, H, ME, answer(302, { anything: 1 }))).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(
      await requestDmControlRegister(
        CFG,
        { account: ME, conversationId: CONV },
        answer(503, { error: "not_configured", detail: "dm-claim-store" }),
      ),
    ).toEqual({ ok: false, error: "not_configured", detail: "dm-claim-store" });
    // A pure conflict on a mutation has no bound proof: unreadable, never a conflict view.
    expect(
      await requestDmControlTakeover(
        CFG,
        H,
        { account: ME, expectedRevision: 0 },
        answer(409, { error: "conflict" }),
      ),
    ).toEqual({ ok: false, error: "upstream" });
    const bad = vi.fn<typeof fetch>(async () => {
      throw new TypeError("down");
    });
    expect(await requestDmControlStatus(CFG, H, ME, bad)).toEqual({
      ok: false,
      error: "network",
    });
    expect(await requestDmControlStatus(null, H, ME, bad)).toEqual({
      ok: false,
      error: "unconfigured",
    });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("the control key is origin | account | conversation, each encoded", () => {
    expect(dmControlKey("https://scout.test", ME, CONV)).toBe(
      ["https://scout.test", ME, CONV].map(encodeURIComponent).join("|"),
    );
  });
});
