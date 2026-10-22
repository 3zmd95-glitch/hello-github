import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  bindThreadsIntent,
  cancelThreadsSend,
  confirmThreadsSend,
  parseThreadsIntent,
  prepareThreadsSend,
  threadsSendDigest,
  threadsSendReadiness,
  threadsSendStatus,
  type ThreadsIntent,
  type ThreadsSendResult,
} from "./inboxThreadsSend";

// 📤 Threads reviewed replies, client wire contract (packet DT-6B-2B-2, planning/tools/37-inbox-send.md). Every receipt
// below is a REAL Worker answer: the dashboard's own transport calls the real `scout.handle` (production gate) or the
// real `threadsSendHandler` with an injected `{ ok: true }` eligibility (this test only), over the real
// ThreadsSendCoordinator on node:sqlite and a fake Threads transport. Nothing leaves the process. The strict parsers must
// accept each stage's real shape and reject missing proofs, contradictions, unknown keys and other operations.

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const CFG = { url: BASE, token: TOKEN };
const NOW = new Date("2026-10-17T09:00:00Z");
const TH = "graph.threads.net/v1.0";
const ME = "25000000000000001";
const ROOT = "90001";
const TARGET = "91001";
const CONTAINER = "17800000000000001";
const PUBLISHED = "18000000000000009";
const TEXT = "Thanks for the reply!";

/* ---------- the real Worker modules (computed paths: neither tsc follows them across the boundary) ---------- */

type Env = Record<string, unknown>;
type Deps = { fetch: typeof fetch; now: () => Date };
type Handle = (req: Request, env: Env, ctx: undefined, deps: Deps) => Promise<Response>;
type SendHandler = (
  req: Request,
  rest: string[],
  deps: { store: unknown; seal: string | undefined; coordinator: unknown },
  reply: { json(body: unknown, status: number): Response },
) => Promise<Response | null>;
interface WorkerStore {
  putTokens(p: "threads", t: Record<string, unknown>): Promise<void>;
  putStatus(p: "threads", s: Record<string, unknown>): Promise<void>;
}
type Coordinator = new (state: unknown) => { fetch(req: Request): Promise<Response> };

const WORKER = "../workers/scout/src";
const load = async () => {
  const [{ handle }, { Store }, { threadsSendHandler }, { ThreadsSendCoordinator }] =
    await Promise.all([
      import(/* @vite-ignore */ `${WORKER}/scout`) as Promise<{ handle: Handle }>,
      import(/* @vite-ignore */ `${WORKER}/social/store`) as Promise<{
        Store: { from(env: Env): WorkerStore | null };
      }>,
      import(/* @vite-ignore */ `${WORKER}/social/inboxSendThreads`) as Promise<{
        threadsSendHandler(o: {
          fetch: typeof fetch;
          now: () => Date;
          eligibility?: () => { ok: true };
        }): SendHandler;
      }>,
      import(/* @vite-ignore */ `${WORKER}/social/threadsSendCoordinator`) as Promise<{
        ThreadsSendCoordinator: Coordinator;
      }>,
    ]);
  return { handle, Store, threadsSendHandler, ThreadsSendCoordinator };
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

/** The real coordinator per name on node:sqlite; `failing` makes chosen calls fail like a storage outage. */
function coordinator(Coord: Coordinator) {
  const dbs = new Map<string, DatabaseSync>();
  const failing = new Set<string>();
  const ns = {
    failing,
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        const call = JSON.parse(String(init.body)) as { op: string };
        if (failing.has(call.op)) throw new Error("storage down");
        if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
        return new Coord({ storage: sqliteStorage(dbs.get(id)!) }).fetch(new Request(url, init));
      },
    }),
  };
  return ns;
}

type Route = (url: URL, init?: RequestInit) => Response;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The fake Threads Graph API: listing, the preflight GET, one container, one publish (each overridable). */
function provider(over: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    [`GET ${TH}/me`]: () => json({ id: ME, username: "3z.prod" }),
    [`GET ${TH}/me/threads`]: () => json({ data: [{ id: ROOT, text: "post" }] }),
    [`GET ${TH}/${ROOT}/replies`]: () =>
      json({
        data: [{ id: TARGET, text: "hi", root_post: { id: ROOT }, replied_to: { id: ROOT } }],
      }),
    [`GET ${TH}/${TARGET}`]: () =>
      json({ id: TARGET, root_post: { id: ROOT }, replied_to: { id: ROOT } }),
    [`POST ${TH}/me/threads`]: () => json({ id: CONTAINER }),
    [`POST ${TH}/me/threads_publish`]: () => json({ id: PUBLISHED }),
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

/** A connected Threads account on a fresh Worker: KV, seal, coordinator, tokens. */
async function world(opts: { userId?: string; coordinator?: boolean } = {}) {
  const m = await load();
  const coord = coordinator(m.ThreadsSendCoordinator);
  const env: Env = {
    SCOUT_TOKEN: TOKEN,
    INBOX_SEAL_SECRET: SEAL,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: fakeKV(),
    ...(opts.coordinator === false ? {} : { THREADS_SEND_COORDINATOR: coord }),
  };
  const store = m.Store.from(env)!;
  await store.putTokens("threads", {
    accessToken: "th-live-token",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: opts.userId ?? ME,
    scope: "threads_basic,threads_manage_insights,threads_read_replies",
  });
  await store.putStatus("threads", { connectedAt: "2026-10-01T08:00:00.000Z", handle: "3z.prod" });
  return { m, env, coord, store: m.Store.from(env) };
}

type World = Awaited<ReturnType<typeof world>>;

/** The dashboard's transport pointed at the real production router (`scout.handle`). */
const viaRouter =
  (w: World, transport: typeof fetch, now = NOW): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", APP);
    return w.m.handle(new Request(String(input), { ...init, headers }), w.env, undefined, {
      fetch: transport,
      now: () => now,
    });
  };

/** The dashboard's transport pointed at the real send handler with eligibility injected `{ ok: true }` (test only). */
const viaEligible =
  (w: World, transport: typeof fetch, now = NOW): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", APP);
    const req = new Request(String(input), { ...init, headers });
    const rest = new URL(req.url).pathname.split("/").filter(Boolean).slice(4);
    const res = await w.m.threadsSendHandler({
      fetch: transport,
      now: () => now,
      eligibility: () => ({ ok: true }),
    })(
      req,
      rest,
      { store: w.store, seal: SEAL, coordinator: w.env.THREADS_SEND_COORDINATOR },
      { json: (b, status) => json(b, status) },
    );
    return res!;
  };

/** The real listing's sendRef and generation for the direct reply (inboxReadThreads.ts). */
async function listing(w: World) {
  const f = viaRouter(w, provider());
  const get = async (path: string) =>
    (await (
      await f(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    ).json()) as Record<string, unknown>;
  const acc = await get("/social/inbox/threads/account");
  const q = `?account=${acc.accountId}&generation=${acc.generation}`;
  const posts = await get(`/social/inbox/threads/posts${q}`);
  const ref = (posts.items as { ref: string }[])[0].ref;
  const replies = await get(`/social/inbox/threads/posts/${ref}/replies${q}`);
  const sendRef = (replies.items as { sendRef: string }[])[0].sendRef;
  return { generation: acc.generation as string, sendRef };
}

let seq = 0;
const newOp = () => `op-wire-${String(++seq).padStart(6, "0")}`;

const ok = (r: ThreadsSendResult): ThreadsIntent => {
  if (!r.ok) throw new Error(`expected an intent, got ${r.error}`);
  return r.intent;
};

/** Prepare through the eligible handler; returns the bound review and a confirm/status/cancel kit. */
async function prepared(w: World, transport = provider(), text = TEXT) {
  const { sendRef, generation } = await listing(w);
  const f = viaEligible(w, transport);
  const operationId = newOp();
  // One draft revision per operation: the same submission would converge on the earlier operation.
  const draftRevision = `rev-${seq}`;
  const r = await prepareThreadsSend(CFG, { operationId, sendRef, text, draftRevision }, f);
  const intent = ok(r);
  return {
    intent,
    generation,
    operationId,
    f,
    confirm: (g = f) =>
      confirmThreadsSend(CFG, { operationId, digest: intent.digest, account: ME }, g),
    status: (g = f) => threadsSendStatus(CFG, operationId, ME, g),
    cancel: (g = f) => cancelThreadsSend(CFG, operationId, ME, g),
  };
}

const posts = (t: ReturnType<typeof provider>) =>
  t.mock.calls.filter(([, init]) => init?.method === "POST").length;

/** Collects one real receipt per stage (each test run builds its own; nothing is copied by hand). */
async function receipts() {
  const out: Record<string, ThreadsIntent> = {};
  const w = await world();

  const a = await prepared(w);
  out.prepared = a.intent;
  out.published = ok(await a.confirm());

  const b = await prepared(w, provider({ [`POST ${TH}/me/threads`]: () => json({}, 500) }));
  out.unknown_creation = ok(await b.confirm());

  const c = await prepared(
    w,
    provider({
      [`POST ${TH}/me/threads`]: () =>
        json({ error: { message: "nope", type: "OAuthException", code: 10 } }, 400),
    }),
  );
  out.rejectedCreate = ok(await c.confirm());

  const d = await prepared(w, provider({ [`POST ${TH}/me/threads_publish`]: () => json({}, 502) }));
  out.unknown_publication = ok(await d.confirm());

  const e = await prepared(
    w,
    provider({
      [`POST ${TH}/me/threads_publish`]: () =>
        json({ error: { message: "nope", type: "OAuthException", code: 2 } }, 400),
    }),
  );
  out.rejectedPublish = ok(await e.confirm());

  // The publish claim's store is down after the container became durable: the operation rests at `created`.
  const f = await prepared(w);
  w.coord.failing.add("claimPublish");
  const lost = await f.confirm();
  w.coord.failing.clear();
  expect(lost).toEqual({ ok: false, error: "receipt_unavailable" });
  out.created = ok(await f.status());

  // Every receipt write after the publish POST is lost: the coordinator still says `publishing`.
  const g = await prepared(w);
  w.coord.failing.add("settle");
  out.publishingAnswer = ok(await g.confirm());
  w.coord.failing.clear();
  out.publishing = ok(await g.status());

  // The container answered but its receipt (and the fallback) did not land: `creating` stays.
  const h = await prepared(w);
  w.coord.failing.add("recordContainer");
  w.coord.failing.add("settle");
  out.creatingAnswer = ok(await h.confirm());
  w.coord.failing.clear();
  out.creating = ok(await h.status());

  const i = await prepared(w);
  out.cancelled = ok(await i.cancel());

  const j = await prepared(w);
  out.expired = ok(await j.status(viaEligible(w, provider(), new Date(NOW.getTime() + 3_600_000))));

  return { out, w, f };
}

describe("Threads send receipts: real Worker answers through the dashboard transport", () => {
  it("every stage parses with its own proof; published carries both ids; versions are integers", async () => {
    const { out } = await receipts();
    expect(out.prepared).toMatchObject({
      provider: "threads",
      account: ME,
      rootPostId: ROOT,
      replyToId: TARGET,
      text: TEXT,
      digest: threadsSendDigest(TEXT),
      draftRevision: expect.stringMatching(/^rev-\d+$/),
      state: "prepared",
    });
    expect(out.published).toMatchObject({
      state: "published",
      containerId: CONTAINER,
      publishedId: PUBLISHED,
    });
    expect(out.created).toMatchObject({ state: "created", containerId: CONTAINER });
    expect(out.created.publishedId).toBeUndefined();
    expect(out.publishing).toMatchObject({ state: "publishing", containerId: CONTAINER });
    expect(out.publishingAnswer).toMatchObject({
      state: "unknown_publication",
      unknownReason: "receipt",
    });
    expect(out.creating.state).toBe("creating");
    expect(out.creating.containerId).toBeUndefined();
    expect(out.creatingAnswer).toMatchObject({
      state: "unknown_creation",
      unknownReason: "receipt",
    });
    expect(out.unknown_creation).toMatchObject({
      state: "unknown_creation",
      unknownReason: "server",
    });
    expect(out.unknown_publication).toMatchObject({
      state: "unknown_publication",
      containerId: CONTAINER,
      unknownReason: "server",
    });
    expect(out.rejectedCreate).toMatchObject({ state: "rejected", failureCode: "meta_10" });
    expect(out.rejectedCreate.containerId).toBeUndefined();
    expect(out.rejectedPublish).toMatchObject({
      state: "rejected",
      failureCode: "meta_2",
      containerId: CONTAINER,
    });
    expect(out.cancelled.state).toBe("cancelled");
    expect(out.expired.state).toBe("expired");
    for (const r of Object.values(out)) {
      expect(Number.isInteger(r.receiptVersion)).toBe(true);
      expect(parseThreadsIntent(JSON.parse(JSON.stringify(r)))).toEqual(r);
    }
    // Versions only grow along one operation.
    expect(out.published.receiptVersion).toBeGreaterThan(out.prepared.receiptVersion);
  });

  it("resuming a durable `created` publishes once and never creates again", async () => {
    const w = await world();
    const t = provider();
    const a = await prepared(w, t);
    w.coord.failing.add("claimPublish");
    expect(await a.confirm()).toEqual({ ok: false, error: "receipt_unavailable" });
    w.coord.failing.clear();
    expect(ok(await a.status()).state).toBe("created");
    expect(posts(t)).toBe(1);
    // Long after the review deadline the stored container still publishes (the deadline was for creating).
    const late = viaEligible(w, t, new Date(NOW.getTime() + 3_600_000));
    expect(ok(await a.confirm(late))).toMatchObject({ state: "published", publishedId: PUBLISHED });
    const bodies = t.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([input]) => new URL(String(input)).pathname);
    expect(bodies).toEqual(["/v1.0/me/threads", "/v1.0/me/threads_publish"]);
  });

  it("malformed, contradictory or incomplete receipts are rejected", async () => {
    const { out } = await receipts();
    const bad = (base: ThreadsIntent, over: Record<string, unknown>, drop: string[] = []) => {
      const x: Record<string, unknown> = { ...JSON.parse(JSON.stringify(base)), ...over };
      for (const k of drop) delete x[k];
      return parseThreadsIntent(x);
    };
    // Each stage's proof is required.
    expect(bad(out.created, {}, ["containerId"])).toBeNull();
    expect(bad(out.publishing, {}, ["containerId"])).toBeNull();
    expect(bad(out.published, {}, ["publishedId"])).toBeNull();
    expect(bad(out.published, {}, ["containerId"])).toBeNull();
    expect(bad(out.rejectedCreate, {}, ["failureCode"])).toBeNull();
    expect(bad(out.unknown_creation, {}, ["unknownReason"])).toBeNull();
    expect(bad(out.unknown_publication, {}, ["unknownReason"])).toBeNull();
    // A proof that belongs to another stage contradicts the state.
    expect(bad(out.prepared, { containerId: CONTAINER })).toBeNull();
    expect(bad(out.creating, { containerId: CONTAINER })).toBeNull();
    expect(bad(out.created, { publishedId: PUBLISHED })).toBeNull();
    expect(bad(out.publishing, { failureCode: "meta_1" })).toBeNull();
    expect(bad(out.published, { unknownReason: "timeout" })).toBeNull();
    expect(bad(out.unknown_publication, { publishedId: PUBLISHED })).toBeNull();
    expect(bad(out.rejectedCreate, { publishedId: PUBLISHED })).toBeNull();
    expect(bad(out.cancelled, { failureCode: "meta_1" })).toBeNull();
    // Shapes.
    for (const receiptVersion of [1.5, -1, "3", null])
      expect(bad(out.prepared, { receiptVersion })).toBeNull();
    expect(bad(out.prepared, {}, ["receiptVersion"])).toBeNull();
    expect(bad(out.prepared, { provider: "youtube" })).toBeNull();
    expect(bad(out.prepared, { state: "sent" })).toBeNull();
    expect(bad(out.prepared, { extra: 1 })).toBeNull();
    expect(bad(out.prepared, { text: "x".repeat(501) })).toBeNull();
    expect(bad(out.prepared, { text: "" })).toBeNull();
    expect(bad(out.prepared, { operationId: "short" })).toBeNull();
    expect(bad(out.prepared, { digest: "nothex" })).toBeNull();
    expect(bad(out.published, { publishedId: "" })).toBeNull();
    expect(bad(out.published, { publishedId: "a/b" })).toBeNull();
    // 500 code points (not UTF-16 units) is the local limit.
    expect(bad(out.prepared, { text: "😀".repeat(500) })).not.toBeNull();
  });

  it("binds account, generation, root, reply, revision, digest/text and operation id", async () => {
    const { out } = await receipts();
    const i = out.prepared;
    const r: ThreadsSendResult = { ok: true, intent: i };
    const e = {
      operationId: i.operationId,
      account: ME,
      generation: i.generation,
      rootPostId: ROOT,
      replyToId: TARGET,
      draftRevision: i.draftRevision,
      digest: threadsSendDigest(TEXT),
      text: TEXT,
    };
    expect(bindThreadsIntent(r, e)).toBe(r);
    // Prepare may converge on another tab's operation (no operation id expected yet).
    expect(bindThreadsIntent(r, { ...e, operationId: undefined })).toBe(r);
    const mismatch = { ok: false, error: "mismatch" };
    for (const over of [
      { operationId: "op-other-0001" },
      { account: "25000000000000002" },
      { generation: "e".repeat(32) },
      { rootPostId: "90002" },
      { replyToId: "91002" },
      { draftRevision: "rev-2" },
      { digest: threadsSendDigest("other") },
      { text: "other" },
    ])
      expect(bindThreadsIntent(r, { ...e, ...over })).toEqual(mismatch);
    // A digest that is not the digest of the answered text is never trusted.
    expect(
      bindThreadsIntent(
        { ok: true, intent: { ...i, text: "tampered" } },
        { ...e, text: undefined },
      ),
    ).toEqual(mismatch);
    // A known container id binds too.
    const pub = out.published;
    const pe = {
      operationId: pub.operationId,
      account: ME,
      draftRevision: pub.draftRevision,
      digest: pub.digest,
    };
    expect(bindThreadsIntent({ ok: true, intent: pub }, { ...pe, containerId: CONTAINER }).ok).toBe(
      true,
    );
    expect(
      bindThreadsIntent({ ok: true, intent: pub }, { ...pe, containerId: "17800000000000002" }),
    ).toEqual(mismatch);
    // DT-6B-2B-2-R1 (2B2-1): a known publication id binds too, whatever the receipt version.
    expect(
      bindThreadsIntent({ ok: true, intent: pub }, { ...pe, publishedId: pub.publishedId }).ok,
    ).toBe(true);
    for (const receiptVersion of [pub.receiptVersion, pub.receiptVersion + 1])
      expect(
        bindThreadsIntent(
          { ok: true, intent: { ...pub, receiptVersion } },
          { ...pe, publishedId: "18000000000000777" },
        ),
      ).toEqual(mismatch);
    // Failures pass through untouched.
    expect(bindThreadsIntent({ ok: false, error: "network" }, e)).toEqual({
      ok: false,
      error: "network",
    });
  });
});

describe("Threads send refusals: the real production router", () => {
  it("production preparation fails closed with permission_unverified and makes no provider call", async () => {
    const w = await world();
    const { sendRef } = await listing(w);
    const t = provider();
    const r = await prepareThreadsSend(
      CFG,
      { operationId: newOp(), sendRef, text: TEXT, draftRevision: "rev-1" },
      viaRouter(w, t),
    );
    expect(r).toEqual({ ok: false, error: "no_permission", detail: "permission_unverified" });
    expect(t).not.toHaveBeenCalled();
    // The shipped readiness agrees: closed, for the same reason.
    expect(threadsSendReadiness()).toEqual({ ok: false, reason: "permission_unverified" });
  });

  it("names a missing receipt store, and another account's token as account_mismatch/identity", async () => {
    const noStore = await world({ coordinator: false });
    expect(await threadsSendStatus(CFG, newOp(), ME, viaRouter(noStore, provider()))).toEqual({
      ok: false,
      error: "not_configured",
      detail: "receipt-store",
    });
    const w = await world();
    const { sendRef: ref } = await listing(w);
    // The token is swapped for another account's after the listing (the reconnect window).
    await w.store!.putTokens("threads", {
      accessToken: "th-other-token",
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
      userId: "25000000000000002",
      scope: "threads_basic",
    });
    expect(
      await prepareThreadsSend(
        CFG,
        { operationId: newOp(), sendRef: ref, text: TEXT, draftRevision: "rev-1" },
        viaEligible(w, provider()),
      ),
    ).toEqual({ ok: false, error: "account_mismatch", detail: "identity" });
  });

  it("status of an unknown operation is not_found; transport failures are typed and never throw", async () => {
    const w = await world();
    expect(await threadsSendStatus(CFG, newOp(), ME, viaRouter(w, provider()))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await threadsSendStatus(null, newOp(), ME)).toEqual({
      ok: false,
      error: "unconfigured",
    });
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await threadsSendStatus(CFG, newOp(), ME, down)).toEqual({
      ok: false,
      error: "network",
    });
    const reply = (body: unknown, status = 200) =>
      vi.fn<typeof fetch>(async () => json(body, status));
    expect(
      await threadsSendStatus(CFG, newOp(), ME, reply({ error: "unauthorized" }, 401)),
    ).toEqual({
      ok: false,
      error: "auth",
    });
    expect(await threadsSendStatus(CFG, newOp(), ME, reply({ error: "weird" }, 409))).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(
      await threadsSendStatus(CFG, newOp(), ME, reply({ intent: { state: "published" } })),
    ).toEqual({
      ok: false,
      error: "upstream",
    });
    // A detail is kept only where it means something.
    expect(
      await threadsSendStatus(CFG, newOp(), ME, reply({ error: "conflict", detail: "seal" }, 409)),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await threadsSendStatus(
        CFG,
        newOp(),
        ME,
        reply({ error: "no_permission", detail: "x" }, 403),
      ),
    ).toEqual({ ok: false, error: "no_permission" });
  });

  it("calls the Threads routes with the bearer only and the exact bodies", async () => {
    const seen: { method: string; url: string; body: unknown; auth: string | null }[] = [];
    const spy = vi.fn<typeof fetch>(async (input, init) => {
      seen.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: new Headers(init?.headers).get("Authorization"),
      });
      return json({ error: "not_found" }, 404);
    });
    const op = "op-route-000001";
    await prepareThreadsSend(
      CFG,
      { operationId: op, sendRef: "a.b", text: "t", draftRevision: "r" },
      spy,
    );
    await confirmThreadsSend(CFG, { operationId: op, digest: "d", account: ME }, spy);
    await threadsSendStatus(CFG, op, ME, spy);
    await cancelThreadsSend(CFG, op, ME, spy);
    expect(seen).toEqual([
      {
        method: "POST",
        url: `${BASE}/social/inbox/threads/send/prepare`,
        body: { operationId: op, sendRef: "a.b", text: "t", draftRevision: "r" },
        auth: `Bearer ${TOKEN}`,
      },
      {
        method: "POST",
        url: `${BASE}/social/inbox/threads/send/confirm`,
        body: { operationId: op, digest: "d", account: ME },
        auth: `Bearer ${TOKEN}`,
      },
      {
        method: "GET",
        url: `${BASE}/social/inbox/threads/send/${op}?account=${ME}`,
        body: undefined,
        auth: `Bearer ${TOKEN}`,
      },
      {
        method: "POST",
        url: `${BASE}/social/inbox/threads/send/${op}/cancel`,
        body: { account: ME },
        auth: `Bearer ${TOKEN}`,
      },
    ]);
  });
});
