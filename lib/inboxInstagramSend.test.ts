import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./digest";
import {
  IG_SEND_TEXT_MAX,
  bindInstagramIntent,
  cancelInstagramSend,
  confirmInstagramSend,
  instagramSendDigest,
  instagramSendReadiness,
  instagramSendStatus,
  parseInstagramIntent,
  prepareInstagramSend,
  type InstagramIntent,
  type InstagramSendResult,
} from "./inboxInstagramSend";

// 📤 Instagram public comment replies, client wire contract (packet DT-6B-2C-4, planning/tools/37-inbox-send.md). Every
// receipt below is a REAL Worker answer: the dashboard's own transport calls the real `scout.handle` (production gate)
// or the real `instagramSendHandler` with an injected `{ ok: true }` eligibility (this test only), over the real
// InstagramPublicSendCoordinator on node:sqlite and a fake Instagram transport. Nothing leaves the process. The strict
// parsers must accept each state's real shape (an `unknown` without a settled time included) and reject missing proofs,
// contradictions, mixed envelopes, unknown keys and other operations. Text is trim-only; its digest is SHA-256 of the
// exact trimmed text (no NFC). The reader generation (HMAC) and the send generation are different values, never compared.

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const CFG = { url: BASE, token: TOKEN };
const NOW = new Date("2026-10-17T09:00:00Z");
const IG = "graph.instagram.com/v21.0";
/** `/me`'s user_id: the Instagram account the token acts as. */
const ME = "17841000000000001";
const OAUTH_USER = "26000000000000009";
const MEDIA = "18000000000000001";
const REPLY = "17950000000000001";
/** One comment per scenario: the coordinator allows one public attempt per comment. */
const C = (n: number) => `1790000000000000${n}`;
/** Outer whitespace (trimmed), internal CRLF, Arabic digits and an emoji (kept exactly). */
const TEXT = "  Thanks so much!\r\n  ٣ نقاط 🎬  ";
const CANON = TEXT.trim();

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
  putTokens(p: "instagram", t: Record<string, unknown>): Promise<void>;
  putStatus(p: "instagram", s: Record<string, unknown>): Promise<void>;
  deleteTokens(p: "instagram"): Promise<void>;
}
type Coordinator = new (state: unknown) => { fetch(req: Request): Promise<Response> };

const WORKER = "../workers/scout/src";
const load = async () => {
  const [{ handle }, { Store }, { instagramSendHandler }, { InstagramPublicSendCoordinator }] =
    await Promise.all([
      import(/* @vite-ignore */ `${WORKER}/scout`) as Promise<{ handle: Handle }>,
      import(/* @vite-ignore */ `${WORKER}/social/store`) as Promise<{
        Store: { from(env: Env): WorkerStore | null };
      }>,
      import(/* @vite-ignore */ `${WORKER}/social/inboxSendInstagram`) as Promise<{
        instagramSendHandler(o: {
          fetch: typeof fetch;
          now: () => Date;
          eligibility?: () => { ok: true };
        }): SendHandler;
      }>,
      import(/* @vite-ignore */ `${WORKER}/social/instagramPublicSendCoordinator`) as Promise<{
        InstagramPublicSendCoordinator: Coordinator;
      }>,
    ]);
  return { handle, Store, instagramSendHandler, InstagramPublicSendCoordinator };
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
  const call = async (id: string, url: string, init: RequestInit) => {
    const op = (JSON.parse(String(init.body)) as { op: string }).op;
    if (failing.has(op)) throw new Error("storage down");
    if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
    return new Coord({ storage: sqliteStorage(dbs.get(id)!) }).fetch(new Request(url, init));
  };
  return {
    failing,
    idFromName: (name: string) => name,
    get: (id: string) => ({ fetch: (url: string, init: RequestInit) => call(id, url, init) }),
    /** A direct coordinator call (the automatic acknowledgement's claim). */
    direct: async (body: Record<string, unknown>) =>
      (await call(`instagram|${ME}`, "https://c/", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Response,
  };
}

type Route = (url: URL, init?: RequestInit) => Response;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The fake Instagram Graph API: /me, the first owned-media page, the first comment page, one reply POST per comment. */
function provider(over: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    [`GET ${IG}/me`]: () => json({ user_id: ME, username: "3z.prod" }),
    [`GET ${IG}/${ME}/media`]: () => json({ data: [{ id: MEDIA }] }),
    [`GET ${IG}/${MEDIA}/comments`]: () =>
      json({ data: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: C(n) })) }),
    ...over,
  };
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const key = `${init?.method ?? "GET"} ${url.host}${url.pathname}`;
    const route = routes[key];
    if (route) return route(url, init);
    if (/^POST .*\/replies$/.test(key)) return json({ id: REPLY });
    return json({ error: { message: "unmocked" } }, 404);
  });
}

/** A connected Instagram account on a fresh Worker: KV, seal, coordinator, tokens (valid for a year). */
async function world(opts: { coordinator?: boolean; connected?: boolean } = {}) {
  const m = await load();
  const coord = coordinator(m.InstagramPublicSendCoordinator);
  const env: Env = {
    SCOUT_TOKEN: TOKEN,
    INBOX_SEAL_SECRET: SEAL,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: fakeKV(),
    ...(opts.coordinator === false ? {} : { INSTAGRAM_PUBLIC_SEND_COORDINATOR: coord }),
  };
  const store = m.Store.from(env)!;
  if (opts.connected !== false) {
    await store.putTokens("instagram", {
      accessToken: "ig-live-token",
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 365 * 86_400_000).toISOString(),
      userId: OAUTH_USER,
      scope: "instagram_business_basic,instagram_business_manage_comments",
      canReply: true,
    });
    await store.putStatus("instagram", {
      connectedAt: "2026-10-01T08:00:00.000Z",
      handle: "3z.prod",
    });
  }
  return { m, env, coord, store };
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
    const res = await w.m.instagramSendHandler({
      fetch: transport,
      now: () => now,
      eligibility: () => ({ ok: true }),
    })(
      req,
      rest,
      { store: w.store, seal: SEAL, coordinator: w.env.INSTAGRAM_PUBLIC_SEND_COORDINATOR },
      { json: (b, status) => json(b, status) },
    );
    return res!;
  };

let seq = 0;
const newOp = () => `op-igw-${String(++seq).padStart(6, "0")}`;

const ok = (r: InstagramSendResult): InstagramIntent => {
  if (!r.ok) throw new Error(`expected an intent, got ${r.error}`);
  return r.intent;
};

/** Prepare one comment through the eligible handler; returns the review and a confirm/status/cancel kit. */
async function prepared(
  w: World,
  comment: string,
  o: { transport?: typeof fetch; now?: Date; revision?: string; text?: string } = {},
) {
  const transport = o.transport ?? provider();
  const f = viaEligible(w, transport, o.now);
  const operationId = newOp();
  const draftRevision = o.revision ?? `rev-${seq}`;
  const r = await prepareInstagramSend(
    CFG,
    {
      operationId,
      account: ME,
      mediaId: MEDIA,
      commentId: comment,
      text: o.text ?? TEXT,
      draftRevision,
    },
    f,
  );
  const intent = ok(r);
  return {
    intent,
    operationId,
    draftRevision,
    f,
    confirm: (g = f) =>
      confirmInstagramSend(CFG, { operationId, digest: intent.digest, account: ME }, g),
    status: (g = f) => instagramSendStatus(CFG, operationId, ME, g),
    cancel: (g = f) => cancelInstagramSend(CFG, operationId, ME, g),
  };
}

/** Collects one real receipt per state (each test run builds its own; nothing is copied by hand). */
async function receipts() {
  const out: Record<string, InstagramIntent> = {};
  const w = await world();

  const a = await prepared(w, C(1));
  out.prepared = a.intent;
  out.sent = ok(await a.confirm());

  const b = await prepared(w, C(2), {
    transport: provider({ [`POST ${IG}/${C(2)}/replies`]: () => json({}, 500) }),
  });
  out.unknown = ok(await b.confirm());

  const c = await prepared(w, C(3), {
    transport: provider({
      [`POST ${IG}/${C(3)}/replies`]: () =>
        json({ error: { message: "nope", type: "OAuthException", code: 10 } }, 400),
    }),
  });
  out.rejected = ok(await c.confirm());

  // The receipt write after the POST is lost: the answer is unknown (no settled time); the coordinator says dispatching.
  const d = await prepared(w, C(4));
  w.coord.failing.add("settle");
  out.lostReceipt = ok(await d.confirm());
  w.coord.failing.clear();
  out.dispatching = ok(await d.status());

  // The automatic acknowledgement already holds the comment.
  await w.coord.direct({
    op: "claimAuto",
    account: ME,
    commentId: C(5),
    automationId: "ack-1",
    now: NOW.getTime(),
  });
  const e = await prepared(w, C(5));
  out.claimedAutomatic = ok(await e.confirm());

  // Two reviewed operations for one comment: the first Send wins, the second is already claimed (manual).
  const f1 = await prepared(w, C(6));
  const f2 = await prepared(w, C(6));
  ok(await f1.confirm());
  out.claimedManual = ok(await f2.confirm());

  // A sent effect purged after 90 days is retired: a new operation can never claim it again.
  const g1 = await prepared(w, C(7));
  ok(await g1.confirm());
  const later = new Date(NOW.getTime() + 91 * 86_400_000);
  const g2 = await prepared(w, C(7), { now: later });
  out.claimedRetired = ok(await g2.confirm());

  const h = await prepared(w, C(8));
  out.cancelled = ok(await h.cancel());

  const i = await prepared(w, C(9));
  out.expired = ok(await i.status(viaEligible(w, provider(), new Date(NOW.getTime() + 3_600_000))));

  return { out, w };
}

describe("Instagram public send receipts: real Worker answers through the dashboard transport", () => {
  it("every state parses with its own proof; the review holds the exact trimmed text; versions are integers", async () => {
    const { out } = await receipts();
    expect(out.prepared).toMatchObject({
      provider: "instagram",
      account: ME,
      mediaId: MEDIA,
      commentId: C(1),
      text: CANON,
      digest: sha256Hex(CANON),
      draftRevision: expect.stringMatching(/^rev-\d+$/),
      state: "prepared",
    });
    // Internal CRLF, Arabic digits and the emoji survive exactly; only the outer whitespace went.
    expect(out.prepared.text).toBe("Thanks so much!\r\n  ٣ نقاط 🎬");
    expect(out.sent).toMatchObject({ state: "sent", providerReplyId: REPLY });
    expect(out.sent.settledAt).toBeDefined();
    expect(out.unknown).toMatchObject({ state: "unknown", unknownReason: "server" });
    expect(out.rejected).toMatchObject({ state: "rejected", failureCode: "meta_10" });
    expect(out.rejected.providerReplyId).toBeUndefined();
    // The lost receipt is unknown WITHOUT a settled time (it derives from the dispatching intent).
    expect(out.lostReceipt).toMatchObject({ state: "unknown", unknownReason: "receipt" });
    expect(out.lostReceipt.settledAt).toBeUndefined();
    expect(out.dispatching.state).toBe("dispatching");
    expect(out.dispatching.receiptVersion).toBe(out.lostReceipt.receiptVersion);
    expect(out.claimedAutomatic).toMatchObject({
      state: "already_claimed",
      failureDetail: "automatic",
    });
    expect(out.claimedManual).toMatchObject({ state: "already_claimed", failureDetail: "manual" });
    expect(out.claimedRetired).toMatchObject({
      state: "already_claimed",
      failureDetail: "retired",
    });
    expect(out.cancelled.state).toBe("cancelled");
    expect(out.expired.state).toBe("expired");
    for (const r of Object.values(out)) {
      expect(Number.isInteger(r.receiptVersion)).toBe(true);
      expect(parseInstagramIntent(JSON.parse(JSON.stringify(r)))).toEqual(r);
    }
    expect(out.sent.receiptVersion).toBeGreaterThan(out.prepared.receiptVersion);
  });

  it("the reader generation (HMAC) and the learned send generation differ; binding never compares them", async () => {
    const w = await world();
    const f = viaRouter(w, provider());
    const res = await f(`${BASE}/social/inbox/account`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const reader = ((await res.json()) as { generation: string }).generation;
    expect(reader).toMatch(/^[0-9a-f]{32}$/);
    const a = await prepared(w, C(1));
    expect(a.intent.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(a.intent.generation).not.toBe(reader);
    // Prepare binds without any generation; afterwards the learned send generation is what binds.
    const r: InstagramSendResult = { ok: true, intent: a.intent };
    const e = {
      account: ME,
      mediaId: MEDIA,
      commentId: C(1),
      draftRevision: a.draftRevision,
      digest: instagramSendDigest(TEXT),
      text: CANON,
    };
    expect(bindInstagramIntent(r, e)).toBe(r);
    expect(bindInstagramIntent(r, { ...e, sendGeneration: a.intent.generation })).toBe(r);
    expect(bindInstagramIntent(r, { ...e, sendGeneration: reader })).toEqual({
      ok: false,
      error: "mismatch",
    });
  });

  it("malformed, contradictory, non-canonical or incomplete receipts are rejected", async () => {
    const { out } = await receipts();
    const bad = (base: InstagramIntent, over: Record<string, unknown>, drop: string[] = []) => {
      const x: Record<string, unknown> = { ...JSON.parse(JSON.stringify(base)), ...over };
      for (const k of drop) delete x[k];
      return parseInstagramIntent(x);
    };
    // Each state's proof is required.
    expect(bad(out.sent, {}, ["providerReplyId"])).toBeNull();
    expect(bad(out.sent, { providerReplyId: "" })).toBeNull();
    expect(bad(out.rejected, {}, ["failureCode"])).toBeNull();
    expect(bad(out.unknown, {}, ["unknownReason"])).toBeNull();
    expect(bad(out.lostReceipt, {}, ["unknownReason"])).toBeNull();
    expect(bad(out.claimedAutomatic, { failureDetail: "someone" })).toBeNull();
    expect(bad(out.claimedAutomatic, {}, ["failureDetail"])).toBeNull();
    // A proof that belongs to another state contradicts this one.
    expect(bad(out.prepared, { providerReplyId: REPLY })).toBeNull();
    expect(bad(out.dispatching, { providerReplyId: REPLY })).toBeNull();
    expect(bad(out.unknown, { providerReplyId: REPLY })).toBeNull();
    expect(bad(out.rejected, { providerReplyId: REPLY })).toBeNull();
    expect(bad(out.sent, { unknownReason: "timeout" })).toBeNull();
    expect(bad(out.sent, { failureCode: "meta_1" })).toBeNull();
    expect(bad(out.cancelled, { failureCode: "meta_1" })).toBeNull();
    expect(bad(out.prepared, { unknownReason: "timeout" })).toBeNull();
    // Shapes.
    for (const receiptVersion of [1.5, -1, "3", null])
      expect(bad(out.prepared, { receiptVersion })).toBeNull();
    expect(bad(out.prepared, {}, ["receiptVersion"])).toBeNull();
    expect(bad(out.prepared, {}, ["mediaId"])).toBeNull();
    expect(bad(out.prepared, { provider: "threads" })).toBeNull();
    expect(bad(out.prepared, { state: "published" })).toBeNull();
    expect(bad(out.prepared, { extra: 1 })).toBeNull();
    expect(bad(out.prepared, { text: "" })).toBeNull();
    expect(bad(out.prepared, { text: ` ${CANON}` })).toBeNull();
    expect(bad(out.prepared, { text: "x".repeat(IG_SEND_TEXT_MAX + 1) })).toBeNull();
    expect(bad(out.prepared, { operationId: "short" })).toBeNull();
    expect(bad(out.prepared, { digest: "nothex" })).toBeNull();
    expect(bad(out.prepared, { commentId: "a/b" })).toBeNull();
    expect(bad(out.sent, { providerReplyId: "a/b" })).toBeNull();
    expect(bad(out.prepared, { reviewExpiresAt: "not a time" })).toBeNull();
    // 1000 code points (not UTF-16 units) is the limit.
    expect(bad(out.prepared, { text: "😀".repeat(IG_SEND_TEXT_MAX) })).not.toBeNull();
  });

  it("binds operation, account, media, comment, revision, digest/text and a known reply id", async () => {
    const { out } = await receipts();
    const i = out.prepared;
    const r: InstagramSendResult = { ok: true, intent: i };
    const e = {
      operationId: i.operationId,
      account: ME,
      mediaId: MEDIA,
      commentId: C(1),
      draftRevision: i.draftRevision,
      digest: instagramSendDigest(TEXT),
      text: CANON,
      sendGeneration: i.generation,
    };
    expect(bindInstagramIntent(r, e)).toBe(r);
    // Prepare may converge on another tab's operation (no operation id expected yet).
    expect(bindInstagramIntent(r, { ...e, operationId: undefined })).toBe(r);
    const mismatch = { ok: false, error: "mismatch" };
    for (const over of [
      { operationId: "op-other-0001" },
      { account: "17841000000000002" },
      { mediaId: "18000000000000002" },
      { commentId: C(2) },
      { draftRevision: "rev-other" },
      { digest: instagramSendDigest("other") },
      { text: "other" },
      { sendGeneration: "e".repeat(32) },
    ])
      expect(bindInstagramIntent(r, { ...e, ...over })).toEqual(mismatch);
    // A digest that is not the digest of the answered text is never trusted.
    expect(
      bindInstagramIntent(
        { ok: true, intent: { ...i, text: "tampered" } },
        { ...e, text: undefined },
      ),
    ).toEqual(mismatch);
    // A known reply id binds, whatever the version.
    const sent = out.sent;
    const se = {
      operationId: sent.operationId,
      account: ME,
      draftRevision: sent.draftRevision,
      digest: sent.digest,
    };
    expect(
      bindInstagramIntent({ ok: true, intent: sent }, { ...se, providerReplyId: REPLY }).ok,
    ).toBe(true);
    for (const receiptVersion of [sent.receiptVersion, sent.receiptVersion + 1])
      expect(
        bindInstagramIntent(
          { ok: true, intent: { ...sent, receiptVersion } },
          { ...se, providerReplyId: "17950000000000777" },
        ),
      ).toEqual(mismatch);
    expect(bindInstagramIntent({ ok: false, error: "network" }, e)).toEqual({
      ok: false,
      error: "network",
    });
  });

  it("a second operation for the same saved submission converges on the first one", async () => {
    const w = await world();
    const a = await prepared(w, C(1), { revision: "rev-same" });
    const b = await prepareInstagramSend(
      CFG,
      {
        operationId: newOp(),
        account: ME,
        mediaId: MEDIA,
        commentId: C(1),
        text: TEXT,
        draftRevision: "rev-same",
      },
      a.f,
    );
    expect(ok(b).operationId).toBe(a.operationId);
  });

  it("digest: SHA-256 of the exact trimmed text, never NFC-normalized", () => {
    expect(instagramSendDigest(TEXT)).toBe(sha256Hex(CANON));
    expect(instagramSendDigest("  x ")).toBe(sha256Hex("x"));
    // é composed vs decomposed: different digests (no normalization).
    expect(instagramSendDigest("café")).not.toBe(instagramSendDigest("café"));
  });
});

describe("Instagram public send refusals and transport", () => {
  it("production preparation fails closed with permission_unverified and makes no provider call", async () => {
    const w = await world();
    const t = provider();
    const r = await prepareInstagramSend(
      CFG,
      {
        operationId: newOp(),
        account: ME,
        mediaId: MEDIA,
        commentId: C(1),
        text: TEXT,
        draftRevision: "rev-1",
      },
      viaRouter(w, t),
    );
    expect(r).toEqual({ ok: false, error: "no_permission", detail: "permission_unverified" });
    expect(t).not.toHaveBeenCalled();
    expect(instagramSendReadiness()).toEqual({ ok: false, reason: "permission_unverified" });
  });

  it("status needs no connection; names a missing receipt store; out-of-window and identity details survive", async () => {
    const off = await world({ connected: false });
    expect(await instagramSendStatus(CFG, newOp(), ME, viaRouter(off, provider()))).toEqual({
      ok: false,
      error: "not_found",
    });
    const noStore = await world({ coordinator: false });
    expect(await instagramSendStatus(CFG, newOp(), ME, viaRouter(noStore, provider()))).toEqual({
      ok: false,
      error: "not_configured",
      detail: "receipt-store",
    });
    const w = await world();
    const body = {
      operationId: newOp(),
      account: ME,
      mediaId: MEDIA,
      commentId: "17900000000000099",
      text: TEXT,
      draftRevision: "rev-1",
    };
    expect(await prepareInstagramSend(CFG, body, viaEligible(w, provider()))).toEqual({
      ok: false,
      error: "target_unverified",
      detail: "outside-local-window",
    });
    expect(
      await prepareInstagramSend(
        CFG,
        { ...body, operationId: newOp(), account: "17841000000000002", commentId: C(1) },
        viaEligible(w, provider()),
      ),
    ).toEqual({ ok: false, error: "account_mismatch", detail: "identity" });
    // A retained operation is still read after the connection is gone (status needs no token).
    const a = await prepared(w, C(1));
    await w.store.deleteTokens("instagram");
    expect(ok(await a.status(viaRouter(w, provider()))).state).toBe("prepared");
  });

  it("mixed envelopes, unknown keys, redirects and odd details are never proof; nothing throws", async () => {
    const { out } = await receipts();
    const op = out.prepared.operationId;
    const reply = (body: unknown, status = 200) =>
      vi.fn<typeof fetch>(async () => json(body, status));
    expect(await instagramSendStatus(CFG, op, ME, reply({ intent: out.prepared }))).toEqual({
      ok: true,
      intent: out.prepared,
    });
    for (const [body, status] of [
      [{ intent: out.prepared, error: "conflict" }, 200],
      [{ intent: out.prepared, extra: 1 }, 200],
      [{ error: "conflict", intent: out.prepared }, 409],
      [{ intent: { state: "sent" } }, 200],
      [null, 200],
      [{ error: "weird" }, 409],
    ] as const)
      expect(await instagramSendStatus(CFG, op, ME, reply(body, status))).toEqual({
        ok: false,
        error: "upstream",
      });
    // The prepare answer's verification window is part of a valid envelope.
    expect(
      (
        await instagramSendStatus(
          CFG,
          op,
          ME,
          reply({ intent: out.prepared, verification: { window: "first-page", pageSize: 50 } }),
        )
      ).ok,
    ).toBe(true);
    // A redirect is never followed and never success.
    const redirect = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { Location: "https://evil.test/" } }),
    );
    expect(await instagramSendStatus(CFG, op, ME, redirect)).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(redirect.mock.calls[0][1]?.redirect).toBe("manual");
    // Details only where they mean something.
    expect(
      await instagramSendStatus(
        CFG,
        op,
        ME,
        reply({ error: "upstream", detail: "malformed page" }, 502),
      ),
    ).toEqual({ ok: false, error: "upstream" });
    expect(
      await instagramSendStatus(CFG, op, ME, reply({ error: "stale", detail: "reconnected" }, 409)),
    ).toEqual({ ok: false, error: "stale", detail: "reconnected" });
    expect(
      await instagramSendStatus(CFG, op, ME, reply({ error: "conflict", detail: "kv" }, 409)),
    ).toEqual({ ok: false, error: "conflict" });
    expect(await instagramSendStatus(CFG, op, ME, reply({ error: "unauthorized" }, 401))).toEqual({
      ok: false,
      error: "auth",
    });
    expect(await instagramSendStatus(null, op, ME)).toEqual({ ok: false, error: "unconfigured" });
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await instagramSendStatus(CFG, op, ME, down)).toEqual({ ok: false, error: "network" });
  });

  it("calls the Instagram routes with the bearer only, the exact bodies and no redirect following", async () => {
    const seen: {
      method: string;
      url: string;
      body: unknown;
      auth: string | null;
      redirect: unknown;
    }[] = [];
    const spy = vi.fn<typeof fetch>(async (input, init) => {
      seen.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: new Headers(init?.headers).get("Authorization"),
        redirect: init?.redirect,
      });
      return json({ error: "not_found" }, 404);
    });
    const op = "op-route-000001";
    const prep = {
      operationId: op,
      account: ME,
      mediaId: MEDIA,
      commentId: C(1),
      text: " t ",
      draftRevision: "r",
    };
    await prepareInstagramSend(CFG, prep, spy);
    await confirmInstagramSend(CFG, { operationId: op, digest: "d", account: ME }, spy);
    await instagramSendStatus(CFG, op, ME, spy);
    await cancelInstagramSend(CFG, op, ME, spy);
    const S = `${BASE}/social/inbox/instagram/send`;
    const auth = `Bearer ${TOKEN}`;
    expect(seen).toEqual([
      { method: "POST", url: `${S}/prepare`, body: prep, auth, redirect: "manual" },
      {
        method: "POST",
        url: `${S}/confirm`,
        body: { operationId: op, digest: "d", account: ME },
        auth,
        redirect: "manual",
      },
      { method: "GET", url: `${S}/${op}?account=${ME}`, body: undefined, auth, redirect: "manual" },
      {
        method: "POST",
        url: `${S}/${op}/cancel`,
        body: { account: ME },
        auth,
        redirect: "manual",
      },
    ]);
  });
});

// DT-6B-2C-4-R1 (2C4-5): each public state carries exactly the proof the accepted coordinator gives it. The table is
// derived from these real answers (inboxSendInstagram.ts + InstagramPublicSendCoordinator), never from the DM protocol:
// prepared/cancelled/expired/already_claimed have no own claim or settlement; dispatching has its claim only; sent has
// claim, settlement and reply id; unknown has a reason and its settled time only when the receipt was written.
describe("Instagram public send state proof (DT-6B-2C-4-R1)", () => {
  it("every stored state read through the real production router (scout.handle) parses and binds", async () => {
    const w = await world();
    const router = (now = NOW) => viaRouter(w, provider(), now);
    /** Status through the production router (no eligibility needed): what a retained handle recovers by. */
    const read = async (k: Awaited<ReturnType<typeof prepared>>, now = NOW) => {
      const got = ok(await k.status(router(now)));
      expect(parseInstagramIntent(JSON.parse(JSON.stringify(got)))).toEqual(got);
      const bound = bindInstagramIntent(
        { ok: true, intent: got },
        {
          operationId: k.operationId,
          account: ME,
          mediaId: MEDIA,
          draftRevision: k.draftRevision,
          digest: k.intent.digest,
          text: k.intent.text,
          sendGeneration: k.intent.generation,
        },
      );
      expect(bound.ok).toBe(true);
      return got;
    };
    const seen: Record<string, InstagramIntent> = {};
    const a = await prepared(w, C(1));
    seen.prepared = await read(a);
    ok(await a.confirm());
    seen.sent = await read(a);
    const b = await prepared(w, C(2), {
      transport: provider({ [`POST ${IG}/${C(2)}/replies`]: () => json({}, 500) }),
    });
    ok(await b.confirm());
    seen.unknown = await read(b);
    const c = await prepared(w, C(3), {
      transport: provider({
        [`POST ${IG}/${C(3)}/replies`]: () =>
          json({ error: { message: "nope", type: "OAuthException", code: 10 } }, 400),
      }),
    });
    ok(await c.confirm());
    seen.rejected = await read(c);
    const d = await prepared(w, C(4));
    w.coord.failing.add("settle");
    const lost = ok(await d.confirm());
    w.coord.failing.clear();
    seen.dispatching = await read(d);
    await w.coord.direct({
      op: "claimAuto",
      account: ME,
      commentId: C(5),
      automationId: "ack-1",
      now: NOW.getTime(),
    });
    const e = await prepared(w, C(5));
    ok(await e.confirm());
    seen.claimedAutomatic = await read(e);
    const f1 = await prepared(w, C(6));
    const f2 = await prepared(w, C(6));
    ok(await f1.confirm());
    ok(await f2.confirm());
    seen.claimedManual = await read(f2);
    const h = await prepared(w, C(8));
    ok(await h.cancel());
    seen.cancelled = await read(h);
    const i = await prepared(w, C(9));
    // Expiry is applied by the coordinator before any read (the clock an hour later).
    seen.expired = await read(i, new Date(NOW.getTime() + 3_600_000));
    // Last (it purges): a sent effect 91 days old is retired; the new operation is already claimed by "retired".
    const later = new Date(NOW.getTime() + 91 * 86_400_000);
    const g = await prepared(w, C(1), { now: later });
    ok(await g.confirm());
    seen.claimedRetired = await read(g, later);

    expect(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.state]))).toEqual({
      prepared: "prepared",
      sent: "sent",
      unknown: "unknown",
      rejected: "rejected",
      dispatching: "dispatching",
      claimedAutomatic: "already_claimed",
      claimedManual: "already_claimed",
      cancelled: "cancelled",
      expired: "expired",
      claimedRetired: "already_claimed",
    });
    // The two unknown forms: the durable settlement (settled time) and the lost receipt (only the dispatching intent's
    // claim). The production router refuses confirm at its gate, so the lost receipt comes from the same real handler;
    // a later status of that claim reads dispatching at the same version.
    expect(seen.unknown.claimedAt && seen.unknown.settledAt).toBeTruthy();
    expect(lost).toMatchObject({ state: "unknown", unknownReason: "receipt" });
    expect(lost.claimedAt).toBeTruthy();
    expect(lost.settledAt).toBeUndefined();
    expect(parseInstagramIntent(JSON.parse(JSON.stringify(lost)))).toEqual(lost);
    expect(seen.dispatching).toMatchObject({ receiptVersion: lost.receiptVersion });
    expect(seen.dispatching.claimedAt).toBeTruthy();
    expect(seen.dispatching.settledAt).toBeUndefined();
    expect(seen.sent.claimedAt && seen.sent.settledAt && seen.sent.providerReplyId).toBeTruthy();
    for (const k of [
      "prepared",
      "cancelled",
      "expired",
      "claimedAutomatic",
      "claimedManual",
      "claimedRetired",
    ]) {
      expect(seen[k].claimedAt, k).toBeUndefined();
      expect(seen[k].settledAt, k).toBeUndefined();
    }
  });

  it("contradictory or missing state proof is malformed: never parsed, never a transport success", async () => {
    const { out } = await receipts();
    const T = "2026-10-17T09:05:00.000Z";
    const cases: [string, string, Record<string, unknown>, string[]][] = [
      ["zero version", "sent", { receiptVersion: 0 }, []],
      ["prepared with a claim", "prepared", { claimedAt: T }, []],
      ["prepared with a settlement", "prepared", { settledAt: T }, []],
      ["dispatching without its claim", "dispatching", {}, ["claimedAt"]],
      ["dispatching already settled", "dispatching", { settledAt: T }, []],
      ["sent without its claim", "sent", {}, ["claimedAt"]],
      ["sent without its settlement", "sent", {}, ["settledAt"]],
      ["sent without claim or settlement", "sent", {}, ["claimedAt", "settledAt"]],
      ["cancelled with a claim", "cancelled", { claimedAt: T }, []],
      ["cancelled with a settlement", "cancelled", { settledAt: T }, []],
      ["expired with a claim", "expired", { claimedAt: T }, []],
      ["already claimed with its own claim", "claimedManual", { claimedAt: T }, []],
      ["already claimed with a settlement", "claimedAutomatic", { settledAt: T }, []],
      ["unknown with a reply id", "lostReceipt", { providerReplyId: REPLY }, []],
    ];
    for (const [name, base, over, drop] of cases) {
      const x: Record<string, unknown> = { ...JSON.parse(JSON.stringify(out[base])), ...over };
      for (const k of drop) delete x[k];
      expect(parseInstagramIntent(x), name).toBeNull();
      const answer = vi.fn<typeof fetch>(async () => json({ intent: x }));
      expect(await instagramSendStatus(CFG, out[base].operationId, ME, answer), name).toEqual({
        ok: false,
        error: "upstream",
      });
      expect(
        await cancelInstagramSend(CFG, out[base].operationId, ME, answer),
        `${name} (cancel)`,
      ).toEqual({ ok: false, error: "upstream" });
    }
    // Both unknown forms, all three holders and the other genuine states stay accepted.
    for (const i of Object.values(out))
      expect(parseInstagramIntent(JSON.parse(JSON.stringify(i)))).toEqual(i);
  });
});
