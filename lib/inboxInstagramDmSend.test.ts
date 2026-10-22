import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./digest";
import { instagramSendDigest } from "./inboxInstagramSend";
import {
  DM_TEXT_BYTES_MAX,
  DM_TEXT_MAX,
  bindDmIntent,
  cancelInstagramDm,
  confirmInstagramDm,
  dmBodyDigest,
  dmCanonicalText,
  dmOpKey,
  dmTextEligible,
  instagramDmSendReadiness,
  instagramDmStatus,
  parseDmIntent,
  prepareInstagramDm,
  type DmExpect,
  type DmIntent,
  type DmResult,
} from "./inboxInstagramDmSend";

// 💬 Reviewed existing-conversation Instagram DMs, client wire contract (packet DT-6B-2C-5A, planning/tools/37-inbox-send.md).
// Every receipt below is a REAL Worker answer: the dashboard's own transport calls the real `scout.handle` (production
// gate, recovery) or the real `instagramDmHandler` with an injected `{ ok: true }` eligibility (this test only), over the
// real InstagramDmCoordinator on node:sqlite and a fake Instagram transport. Nothing leaves the process. The DM protocol is
// its own: no `provider` field, base64-style ids with `=`, text trim → NFC → trim, the digest is SHA-256 of the exact POST
// body JSON, the strict DM state-proof table and the HTTP 200 settlement-pending envelope (durable truth: dispatching).

// Each scenario boots real Worker modules and coordinators; under a parallel suite that can outlast the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const CFG = { url: BASE, token: TOKEN };
const NOW = new Date("2026-10-17T09:00:00Z");
const MIN = 60_000;
const IG = "graph.instagram.com/v21.0";
/** `/me`'s user_id: the Instagram account the token acts as. */
const ME = "17841000000000001";
const OAUTH_USER = "26000000000000009";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const OTHER = "990000000000002";
const OWN = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjA=";
/** One inbound message per scenario: one manual attempt per inbound event. */
const IN = (n: number) => `aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOj${n}=`;
const MID = "aWdfZAG1faXRlbToxOk1lc3NhZA2U=";
/** Outer whitespace (trimmed), a decomposed é (NFC composes it), internal CRLF, Arabic digits and an emoji. */
const TEXT = "  Hi Sara! Café ٣ 🎬\r\nsee you  ";
const CANON = "Hi Sara! Café ٣ 🎬\r\nsee you";

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

/** The real DM coordinator per name on node:sqlite; `failing` makes chosen calls fail like a storage outage. */
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

/** The fake Instagram API: /me, the owned-conversation first page, that conversation's first message page, the DM POST. */
function provider(over: Record<string, Route> = {}, at = NOW) {
  const row = (id: string, from: string, ago: number) => ({
    id,
    created_time: new Date(at.getTime() - ago).toISOString(),
    from: { id: from, username: from === ME ? "3z.prod" : "sara" },
  });
  const routes: Record<string, Route> = {
    [`GET ${IG}/me`]: () => json({ user_id: ME, username: "3z.prod" }),
    [`GET ${IG}/${ME}/conversations`]: () => json({ data: [{ id: CONV }] }),
    [`GET ${IG}/${CONV}`]: () =>
      json({
        id: CONV,
        messages: {
          data: [
            row(OWN, ME, 30 * MIN),
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => row(IN(n), PERSON, n * MIN)),
          ],
        },
      }),
    [`POST ${IG}/${ME}/messages`]: (_u, init) => {
      const b = JSON.parse(String(init?.body)) as { recipient: { id: string } };
      return json({ recipient_id: b.recipient.id, message_id: MID });
    },
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

/** A connected Instagram account on a fresh Worker: KV, seal, DM coordinator, tokens (valid for a year). */
async function world(opts: { coordinator?: boolean; connected?: boolean } = {}) {
  const m = await load();
  const coord = coordinator(m.InstagramDmCoordinator);
  const env: Env = {
    SCOUT_TOKEN: TOKEN,
    INBOX_SEAL_SECRET: SEAL,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: fakeKV(),
    ...(opts.coordinator === false ? {} : { INSTAGRAM_DM_COORDINATOR: coord }),
  };
  const store = m.Store.from(env)!;
  if (opts.connected !== false) {
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

/** The dashboard's transport pointed at the real DM handler with eligibility injected `{ ok: true }` (test only). */
const viaEligible =
  (w: World, transport: typeof fetch, now = NOW): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", APP);
    const req = new Request(String(input), { ...init, headers });
    const rest = new URL(req.url).pathname.split("/").filter(Boolean).slice(4);
    const res = await w.m.instagramDmHandler({
      fetch: transport,
      now: () => now,
      eligibility: () => ({ ok: true }),
    })(
      req,
      rest,
      { store: w.store, seal: SEAL, coordinator: w.env.INSTAGRAM_DM_COORDINATOR },
      { json: (b, status) => json(b, status) },
    );
    return res!;
  };

let seq = 0;
const newOp = () => `op-dmw-${String(++seq).padStart(6, "0")}`;

const ok = (r: DmResult): DmIntent => {
  if (!r.ok) throw new Error(`expected an intent, got ${r.error}`);
  return r.intent;
};

/** Prepare one inbound message through the eligible handler; returns the review and a confirm/status/cancel kit. */
async function prepared(
  w: World,
  inbound: string,
  o: { transport?: typeof fetch; now?: Date; revision?: string; text?: string } = {},
) {
  const transport = (o.transport ?? provider({}, o.now)) as ReturnType<typeof provider>;
  const f = viaEligible(w, transport, o.now);
  const operationId = newOp();
  const draftRevision = o.revision ?? `rev-${seq}`;
  const r = await prepareInstagramDm(
    CFG,
    {
      operationId,
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: inbound,
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
    transport,
    confirm: (g = f) =>
      confirmInstagramDm(CFG, { operationId, digest: intent.digest, account: ME }, g),
    status: (g = f) => instagramDmStatus(CFG, operationId, ME, g),
    cancel: (g = f) => cancelInstagramDm(CFG, operationId, ME, g),
  };
}

const autoClaim = (w: World, inbound: string) =>
  w.coord.direct({
    op: "claim",
    account: ME,
    conversationId: CONV,
    recipientId: PERSON,
    inboundMessageId: inbound,
    actor: "auto:cam",
    payloadDigest: "d".repeat(64),
    generation: "0".repeat(32),
    isDefault: false,
    cooldownMs: 0,
  });

/** Collects one real receipt per state (each run builds its own; nothing is copied by hand). */
async function receipts() {
  const out: Record<string, DmIntent> = {};
  const pending: Record<string, DmResult> = {};
  const w = await world();

  const a = await prepared(w, IN(1));
  out.prepared = a.intent;
  out.sent = ok(await a.confirm());

  const b = await prepared(w, IN(2), {
    transport: provider({
      [`POST ${IG}/${ME}/messages`]: () => json({ recipient_id: OTHER, message_id: "m" }),
    }),
  });
  out.unknown = ok(await b.confirm());

  const c = await prepared(w, IN(3), {
    transport: provider({
      [`POST ${IG}/${ME}/messages`]: () =>
        json({ error: { message: "nope", type: "OAuthException", code: 10 } }, 400),
    }),
  });
  out.rejected = ok(await c.confirm());

  // The settlement after the POST is lost: HTTP 200 pending envelope; the durable intent stays dispatching.
  const d = await prepared(w, IN(4));
  w.coord.failing.add("settleManual");
  pending.success = await d.confirm();
  w.coord.failing.clear();
  out.dispatching = ok(await d.status());

  const e = await prepared(w, IN(5), {
    transport: provider({
      [`POST ${IG}/${ME}/messages`]: () =>
        json({ error: { message: "nope words", type: "OAuthException", code: 10 } }, 400),
    }),
  });
  w.coord.failing.add("settleManual");
  pending.refusal = await e.confirm();
  w.coord.failing.clear();

  const g = await prepared(w, IN(6), {
    transport: provider({ [`POST ${IG}/${ME}/messages`]: () => json({}, 500) }),
  });
  w.coord.failing.add("settleManual");
  pending.unknown = await g.confirm();
  w.coord.failing.clear();

  // The automation already holds the inbound message.
  await autoClaim(w, IN(7));
  const h = await prepared(w, IN(7));
  out.claimedAutomatic = ok(await h.confirm());

  // Two reviewed operations (different texts) for one inbound: the first Send wins, the second is already claimed.
  const i1 = await prepared(w, IN(8), { text: "first answer" });
  const i2 = await prepared(w, IN(8), { text: "second answer" });
  ok(await i1.confirm());
  out.claimedManual = ok(await i2.confirm());

  const j = await prepared(w, IN(9));
  out.cancelled = ok(await j.cancel());

  const k = await prepared(w, IN(9), { revision: "rev-expire", text: "late answer" });
  out.expired = ok(await k.status(viaEligible(w, provider(), new Date(NOW.getTime() + 11 * MIN))));

  // A settled automatic effect purged after 90 days is retired: a new operation never claims it again.
  const r = await world();
  await autoClaim(r, IN(1));
  await r.coord.direct({
    op: "settle",
    account: ME,
    conversationId: CONV,
    inboundMessageId: IN(1),
    actor: "auto:cam",
    outcome: { state: "sent", providerMessageId: "auto-mid" },
  });
  const later = new Date(NOW.getTime() + 91 * 86_400_000);
  const rt = await prepared(r, IN(1), { now: later });
  out.claimedRetired = ok(await rt.confirm());

  return { out, pending, w };
}

const bound = (i: DmIntent, over: Partial<DmExpect> = {}): DmExpect => ({
  operationId: i.operationId,
  account: ME,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: i.inboundMessageId,
  inboundAt: i.inboundAt,
  draftRevision: i.draftRevision,
  digest: i.digest,
  text: i.text,
  sendGeneration: i.generation,
  ...over,
});

describe("Instagram DM receipts: real Worker answers through the dashboard transport", () => {
  it("every durable state parses with its own proof; the review holds the exact canonical text and the body digest", async () => {
    const { out } = await receipts();
    expect(out.prepared).toMatchObject({
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN(1),
      inboundAt: new Date(NOW.getTime() - MIN).toISOString(),
      text: CANON,
      digest: sha256Hex(JSON.stringify({ recipient: { id: PERSON }, message: { text: CANON } })),
      state: "prepared",
      receiptVersion: 1,
    });
    expect("provider" in out.prepared).toBe(false);
    expect(out.sent).toMatchObject({ state: "sent", providerMessageId: MID });
    expect(out.sent.claimedAt && out.sent.settledAt).toBeTruthy();
    expect(out.unknown).toMatchObject({ state: "unknown", unknownReason: "recipient" });
    expect(out.unknown.claimedAt && out.unknown.settledAt).toBeTruthy();
    expect(out.rejected).toMatchObject({ state: "rejected", failureCode: "meta_10" });
    expect(out.rejected.failureDetail).toBeUndefined();
    expect(out.dispatching).toMatchObject({ state: "dispatching", receiptVersion: 2 });
    expect(out.dispatching.settledAt).toBeUndefined();
    for (const [k, by] of [
      ["claimedAutomatic", "automatic"],
      ["claimedManual", "manual"],
      ["claimedRetired", "retired"],
    ])
      expect(out[k], k).toMatchObject({
        state: "already_claimed",
        failureCode: "already_claimed",
        failureDetail: by,
      });
    expect(out.cancelled.state).toBe("cancelled");
    expect(out.expired.state).toBe("expired");
    for (const r of Object.values(out)) {
      expect(Number.isInteger(r.receiptVersion) && r.receiptVersion >= 1).toBe(true);
      expect(parseDmIntent(JSON.parse(JSON.stringify(r)))).toEqual(r);
      expect(bindDmIntent({ ok: true, intent: r }, bound(r)).ok).toBe(true);
    }
  });

  it("a lost settlement is the HTTP 200 pending envelope: dispatching stays the truth, observed is only uncertainty", async () => {
    const { pending } = await receipts();
    // Provider success without a receipt: observed unknown("receipt"), never sent.
    expect(pending.success).toMatchObject({
      ok: true,
      intent: { state: "dispatching", receiptVersion: 2 },
      pending: { observed: "unknown", code: "receipt" },
    });
    // A typed provider refusal without a receipt: observed rejected, never a durable rejection; its words are dropped.
    expect(pending.refusal).toMatchObject({
      ok: true,
      intent: { state: "dispatching" },
      pending: { observed: "rejected", code: "meta_10" },
    });
    expect(JSON.stringify(pending.refusal)).not.toContain("nope");
    expect(pending.unknown).toMatchObject({
      ok: true,
      intent: { state: "dispatching" },
      pending: { observed: "unknown", code: "server" },
    });
    for (const p of Object.values(pending)) {
      if (!p.ok) throw new Error("pending");
      expect(p.intent.providerMessageId).toBeUndefined();
      expect(p.intent.failureCode).toBeUndefined();
    }
  });

  it("the reader generation (HMAC) and the learned DM send generation differ; binding never compares them", async () => {
    const w = await world();
    const res = await viaRouter(w, provider())(`${BASE}/social/inbox/account`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const reader = ((await res.json()) as { generation: string }).generation;
    expect(reader).toMatch(/^[0-9a-f]{32}$/);
    const a = await prepared(w, IN(1));
    expect(a.intent.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(a.intent.generation).not.toBe(reader);
    const r: DmResult = { ok: true, intent: a.intent };
    const e = bound(a.intent, { operationId: undefined, sendGeneration: undefined });
    expect(bindDmIntent(r, e)).toBe(r);
    expect(bindDmIntent(r, { ...e, sendGeneration: a.intent.generation })).toBe(r);
    expect(bindDmIntent(r, { ...e, sendGeneration: reader })).toEqual({
      ok: false,
      error: "mismatch",
    });
  });

  it("a second operation for the identical submission converges on the first one (and binds without an operation id)", async () => {
    const w = await world();
    const a = await prepared(w, IN(1), { revision: "rev-same" });
    const r = await prepareInstagramDm(
      CFG,
      {
        operationId: newOp(),
        account: ME,
        conversationId: CONV,
        recipientId: PERSON,
        inboundMessageId: IN(1),
        text: TEXT,
        draftRevision: "rev-same",
      },
      a.f,
    );
    expect(ok(r).operationId).toBe(a.operationId);
    expect(bindDmIntent(r, bound(a.intent, { operationId: undefined })).ok).toBe(true);
  });

  it("malformed, contradictory, non-canonical or incomplete receipts are rejected (the strict DM table)", async () => {
    const { out } = await receipts();
    const T = "2026-10-17T09:05:00.000Z";
    const bad = (base: DmIntent, over: Record<string, unknown>, drop: string[] = []) => {
      const x: Record<string, unknown> = { ...JSON.parse(JSON.stringify(base)), ...over };
      for (const k of drop) delete x[k];
      return x;
    };
    const cases: [string, Record<string, unknown>][] = [
      ["zero version", bad(out.prepared, { receiptVersion: 0 })],
      ["fractional version", bad(out.prepared, { receiptVersion: 1.5 })],
      ["string version", bad(out.prepared, { receiptVersion: "1" })],
      ["prepared with a claim", bad(out.prepared, { claimedAt: T })],
      ["dispatching without its claim", bad(out.dispatching, {}, ["claimedAt"])],
      ["dispatching settled", bad(out.dispatching, { settledAt: T })],
      ["sent without its message id", bad(out.sent, {}, ["providerMessageId"])],
      ["sent without its settlement", bad(out.sent, {}, ["settledAt"])],
      ["sent with a failure", bad(out.sent, { failureCode: "meta_1" })],
      ["rejected without its settlement", bad(out.rejected, {}, ["settledAt"])],
      ["rejected with a detail", bad(out.rejected, { failureDetail: "words" })],
      ["rejected with a message id", bad(out.rejected, { providerMessageId: MID })],
      // Unlike the public protocol, a DM unknown always carries its settlement (the lost one is the pending envelope).
      ["unknown without its settlement", bad(out.unknown, {}, ["settledAt"])],
      ["unknown with a message id", bad(out.unknown, { providerMessageId: MID })],
      ["already claimed with its own claim", bad(out.claimedManual, { claimedAt: T })],
      ["already claimed by someone", bad(out.claimedManual, { failureDetail: "someone" })],
      ["already claimed, other code", bad(out.claimedManual, { failureCode: "meta_1" })],
      ["cancelled with a claim", bad(out.cancelled, { claimedAt: T })],
      ["expired with a settlement", bad(out.expired, { settledAt: T })],
      ["a provider field", bad(out.prepared, { provider: "instagram" })],
      ["an extra key", bad(out.prepared, { extra: 1 })],
      ["another state", bad(out.prepared, { state: "published" })],
      ["no inbound time", bad(out.prepared, {}, ["inboundAt"])],
      ["a loose inbound time", bad(out.prepared, { inboundAt: "2026-10-17T08:59:00Z" })],
      ["no recipient", bad(out.prepared, {}, ["recipientId"])],
      ["a slash id", bad(out.prepared, { conversationId: "a/b" })],
      ["empty text", bad(out.prepared, { text: "" })],
      ["untrimmed text", bad(out.prepared, { text: ` ${CANON}` })],
      ["decomposed text", bad(out.prepared, { text: "Café" })],
      ["a lone surrogate", bad(out.prepared, { text: "x\ud800" })],
      ["too long", bad(out.prepared, { text: "x".repeat(DM_TEXT_MAX + 1) })],
      ["short operation", bad(out.prepared, { operationId: "short" })],
    ];
    for (const [name, x] of cases) {
      expect(parseDmIntent(x), name).toBeNull();
      const answer = vi.fn<typeof fetch>(async () => json({ intent: x }));
      expect(await instagramDmStatus(CFG, out.prepared.operationId, ME, answer), name).toEqual({
        ok: false,
        error: "upstream",
      });
    }
    // 1000 code points (not UTF-16 units) is the limit; base64 ids with `=` are DM ids.
    expect(parseDmIntent(bad(out.prepared, { text: "😀".repeat(DM_TEXT_MAX) }))).not.toBeNull();
    expect(out.prepared.conversationId.endsWith("=")).toBe(true);
  });

  it("binds operation, account, conversation, recipient, inbound id and time, revision, digest/text, generation and message id", async () => {
    const { out } = await receipts();
    const i = out.prepared;
    const r: DmResult = { ok: true, intent: i };
    expect(bindDmIntent(r, bound(i))).toBe(r);
    const mismatch = { ok: false, error: "mismatch" };
    for (const over of [
      { operationId: "op-other-0001" },
      { account: "17841000000000002" },
      { conversationId: "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6OTk5" },
      { recipientId: OTHER },
      { inboundMessageId: IN(2) },
      { inboundAt: new Date(NOW.getTime() - 2 * MIN).toISOString() },
      { draftRevision: "rev-other" },
      { digest: dmBodyDigest(PERSON, "other") },
      { text: "other" },
      { sendGeneration: "e".repeat(32) },
    ] as Partial<DmExpect>[])
      expect(bindDmIntent(r, bound(i, over)), JSON.stringify(over)).toEqual(mismatch);
    // A digest that is not the body digest of the answered recipient and text is never trusted.
    expect(
      bindDmIntent({ ok: true, intent: { ...i, text: "tampered" } }, bound(i, { text: undefined })),
    ).toEqual(mismatch);
    // The selected row's own time binds by instant (the same moment in another spelling is the same time).
    expect(bindDmIntent(r, bound(i, { inboundAt: undefined, rowAt: i.inboundAt })).ok).toBe(true);
    expect(
      bindDmIntent(r, bound(i, { inboundAt: undefined, rowAt: "2026-10-17T08:00:00.000Z" })),
    ).toEqual(mismatch);
    // A known message id binds whatever the version.
    const s = out.sent;
    expect(bindDmIntent({ ok: true, intent: s }, bound(s, { providerMessageId: MID })).ok).toBe(
      true,
    );
    expect(
      bindDmIntent({ ok: true, intent: s }, bound(s, { providerMessageId: "other-mid" })),
    ).toEqual(mismatch);
    expect(bindDmIntent({ ok: false, error: "network" }, bound(i))).toEqual({
      ok: false,
      error: "network",
    });
  });

  it("canonical text is trim → NFC → trim; the digest is the exact body JSON, not the public trim-only digest", () => {
    expect(dmCanonicalText(TEXT)).toBe(CANON);
    expect(dmCanonicalText("   ")).toBeNull();
    expect(dmCanonicalText("x\ud800")).toBeNull();
    expect(dmCanonicalText("x".repeat(DM_TEXT_MAX))).not.toBeNull();
    expect(dmCanonicalText("x".repeat(DM_TEXT_MAX + 1))).toBeNull();
    expect(dmCanonicalText("😀".repeat(DM_TEXT_MAX))).not.toBeNull();
    // Composed and decomposed é are one DM text and one digest (the public trim-only digest differs).
    expect(dmBodyDigest(PERSON, dmCanonicalText("Café")!)).toBe(
      dmBodyDigest(PERSON, dmCanonicalText("Café")!),
    );
    expect(instagramSendDigest("Café")).not.toBe(instagramSendDigest("Café"));
    expect(dmBodyDigest(PERSON, CANON)).toBe(
      sha256Hex(`{"recipient":{"id":"${PERSON}"},"message":{"text":${JSON.stringify(CANON)}}}`),
    );
    expect(dmBodyDigest(PERSON, CANON)).not.toBe(instagramSendDigest(CANON));
    expect(dmBodyDigest(OTHER, CANON)).not.toBe(dmBodyDigest(PERSON, CANON));
  });

  it("the operation key is origin | account | conversation | inbound message, each encoded", () => {
    expect(dmOpKey("https://scout.test", ME, CONV, IN(1))).toBe(
      ["https://scout.test", ME, CONV, IN(1)].map(encodeURIComponent).join("|"),
    );
    expect(dmOpKey("https://scout.test", ME, CONV, IN(1))).not.toBe(
      dmOpKey("https://scout.test", ME, CONV, IN(2)),
    );
  });
});

describe("Instagram DM refusals and transport", () => {
  it("production preparation fails closed with permission_unverified and makes no provider call", async () => {
    const w = await world();
    const t = provider();
    const r = await prepareInstagramDm(
      CFG,
      {
        operationId: newOp(),
        account: ME,
        conversationId: CONV,
        recipientId: PERSON,
        inboundMessageId: IN(1),
        text: TEXT,
        draftRevision: "rev-1",
      },
      viaRouter(w, t),
    );
    expect(r).toEqual({ ok: false, error: "no_permission", detail: "permission_unverified" });
    expect(t).not.toHaveBeenCalled();
    expect(instagramDmSendReadiness()).toEqual({ ok: false, reason: "permission_unverified" });
  });

  it("status and cancel need no connection; a missing claim store and target refusals keep only allowlisted details", async () => {
    const off = await world({ connected: false });
    expect(await instagramDmStatus(CFG, newOp(), ME, viaRouter(off, provider()))).toEqual({
      ok: false,
      error: "not_found",
    });
    const noStore = await world({ coordinator: false });
    expect(await instagramDmStatus(CFG, newOp(), ME, viaRouter(noStore, provider()))).toEqual({
      ok: false,
      error: "not_configured",
      detail: "dm-claim-store",
    });
    const w = await world();
    const body = {
      operationId: newOp(),
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: "aWdfZAG1faXRlbToxOk5vdExpc3RlZA==",
      text: TEXT,
      draftRevision: "rev-1",
    };
    expect(await prepareInstagramDm(CFG, body, viaEligible(w, provider()))).toEqual({
      ok: false,
      error: "target_unverified",
      detail: "outside-local-window",
    });
    expect(
      await prepareInstagramDm(
        CFG,
        { ...body, operationId: newOp(), inboundMessageId: OWN },
        viaEligible(w, provider()),
      ),
    ).toEqual({ ok: false, error: "target_invalid", detail: "own-message" });
    expect(
      await prepareInstagramDm(
        CFG,
        { ...body, operationId: newOp(), inboundMessageId: IN(1), recipientId: OTHER },
        viaEligible(w, provider()),
      ),
    ).toEqual({ ok: false, error: "target_invalid", detail: "foreign-recipient" });
    expect(
      await prepareInstagramDm(
        CFG,
        { ...body, operationId: newOp(), inboundMessageId: IN(1), text: "  " },
        viaEligible(w, provider()),
      ),
    ).toEqual({ ok: false, error: "text_invalid" });
    // A retained operation is still read and cancelled after the connection is gone (no token needed).
    const a = await prepared(w, IN(1));
    await w.store.deleteTokens("instagram");
    expect(ok(await a.status(viaRouter(w, provider()))).state).toBe("prepared");
    expect(ok(await a.cancel(viaRouter(w, provider()))).state).toBe("cancelled");
  });

  it("a confirm refused before any claim names its code; the stored intent stays prepared and nothing is posted", async () => {
    const w = await world();
    const a = await prepared(w, IN(1));
    // The production gate on a NEW confirm (the intent is still prepared): refused before any claim.
    expect(await a.confirm(viaRouter(w, provider()))).toEqual({
      ok: false,
      error: "no_permission",
      detail: "permission_unverified",
    });
    expect(
      await confirmInstagramDm(
        CFG,
        { operationId: a.operationId, digest: "e".repeat(64), account: ME },
        a.f,
      ),
    ).toEqual({ ok: false, error: "conflict" });
    expect(ok(await a.status()).state).toBe("prepared");
    expect(a.transport.mock.calls.filter(([, i]) => i?.method === "POST")).toEqual([]);
  });

  it("mixed envelopes, pending outside confirm, unknown keys, redirects and odd details are never proof; nothing throws", async () => {
    const { out, pending } = await receipts();
    if (!pending.success.ok) throw new Error("pending");
    const op = out.prepared.operationId;
    const reply = (body: unknown, status = 200) =>
      vi.fn<typeof fetch>(async () => json(body, status));
    const observed = { state: "unknown", reason: "receipt" };
    const disp = pending.success.intent;
    for (const [body, status] of [
      [{ intent: out.prepared, error: "conflict" }, 200],
      [{ intent: out.prepared, extra: 1 }, 200],
      [{ error: "conflict", intent: out.prepared }, 409],
      [{ intent: { state: "sent" } }, 200],
      [null, 200],
      [{ error: "weird" }, 409],
      // The pending envelope is a confirm answer only.
      [{ intent: disp, observed, settlement: "pending" }, 200],
    ] as const)
      expect(await instagramDmStatus(CFG, op, ME, reply(body, status))).toEqual({
        ok: false,
        error: "upstream",
      });
    const conf = (body: unknown) =>
      confirmInstagramDm(
        CFG,
        { operationId: disp.operationId, digest: disp.digest, account: ME },
        reply(body),
      );
    expect((await conf({ intent: disp, observed, settlement: "pending" })).ok).toBe(true);
    for (const body of [
      { intent: disp, observed, settlement: "settled" },
      { intent: disp, observed },
      { intent: disp, settlement: "pending" },
      { intent: out.sent, observed, settlement: "pending" },
      { intent: disp, observed: { state: "sent", providerMessageId: MID }, settlement: "pending" },
      { intent: disp, observed: { state: "unknown" }, settlement: "pending" },
      {
        intent: disp,
        observed: { state: "unknown", reason: "receipt", extra: 1 },
        settlement: "pending",
      },
      { intent: disp, observed: { state: "rejected", code: "Meta 10" }, settlement: "pending" },
      { intent: disp, observed, settlement: "pending", verification: {} },
    ])
      expect(await conf(body), JSON.stringify(body)).toEqual({ ok: false, error: "upstream" });
    // The prepare answer's verification window is part of a valid envelope.
    expect(
      (
        await instagramDmStatus(
          CFG,
          op,
          ME,
          reply({ intent: out.prepared, verification: { window: "first-page" } }),
        )
      ).ok,
    ).toBe(true);
    const redirect = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { Location: "https://evil.test/" } }),
    );
    expect(await instagramDmStatus(CFG, op, ME, redirect)).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(redirect.mock.calls[0][1]?.redirect).toBe("manual");
    expect(
      await instagramDmStatus(
        CFG,
        op,
        ME,
        reply({ error: "upstream", detail: "malformed page" }, 502),
      ),
    ).toEqual({ ok: false, error: "upstream" });
    expect(
      await instagramDmStatus(
        CFG,
        op,
        ME,
        reply({ error: "target_invalid", detail: "window-closed" }, 409),
      ),
    ).toEqual({ ok: false, error: "target_invalid", detail: "window-closed" });
    expect(
      await instagramDmStatus(
        CFG,
        op,
        ME,
        reply({ error: "no_permission", detail: "Meta said x" }, 403),
      ),
    ).toEqual({ ok: false, error: "no_permission" });
    expect(
      await instagramDmStatus(CFG, op, ME, reply({ error: "method_not_allowed" }, 405)),
    ).toEqual({ ok: false, error: "upstream" });
    expect(await instagramDmStatus(CFG, op, ME, reply({ error: "unauthorized" }, 401))).toEqual({
      ok: false,
      error: "auth",
    });
    expect(await instagramDmStatus(null, op, ME)).toEqual({ ok: false, error: "unconfigured" });
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await instagramDmStatus(CFG, op, ME, down)).toEqual({ ok: false, error: "network" });
  });

  it("calls the DM routes with the bearer only, the exact bodies, encoded path/query values and no redirect following", async () => {
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
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN(1),
      text: " t ",
      draftRevision: "r",
    };
    await prepareInstagramDm(CFG, prep, spy);
    await confirmInstagramDm(CFG, { operationId: op, digest: "d", account: ME }, spy);
    await instagramDmStatus(CFG, op, "a b", spy);
    await cancelInstagramDm(CFG, "op/../x", ME, spy);
    const S = `${BASE}/social/inbox/instagram/dm/send`;
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
      { method: "GET", url: `${S}/${op}?account=a+b`, body: undefined, auth, redirect: "manual" },
      {
        method: "POST",
        url: `${S}/op%2F..%2Fx/cancel`,
        body: { account: ME },
        auth,
        redirect: "manual",
      },
    ]);
  });
});

/* ---------- DT-6B-3C: new-send eligibility (UTF-8 bytes) apart from receipt canonical format ---------- */

const bytesOf = (s: string) => new TextEncoder().encode(s).length;
const MIXED = "ab" + "ب".repeat(249) + "€" + "😀".repeat(124) + "!";
const ESCAPED = "a" + '"\\\n'.repeat(332) + "bcd";
/** [name, raw text, the eligible canonical text (null: refused), its exact UTF-8 bytes]. */
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
  ["empty after trimming", " \r\n ", null],
];
/** Old texts the 1000-code-point policy admitted that are over today's byte bound. */
const LEGACY = ["ب".repeat(501), "😀".repeat(DM_TEXT_MAX)];

describe("DT-6B-3C: new-send text eligibility is 1000 UTF-8 bytes; old receipts keep their format rule", () => {
  it("dmTextEligible: the canonical text within 1000 UTF-8 bytes, exactly as the Worker's canonicalText", async () => {
    expect(DM_TEXT_BYTES_MAX).toBe(1000);
    const { canonicalText } = (await import(
      /* @vite-ignore */ `${WORKER}/social/inboxSendInstagramDm`
    )) as { canonicalText(v: unknown): string | null };
    for (const [name, raw, canonical, bytes] of BOUNDARY) {
      expect(dmTextEligible(raw), name).toBe(canonical);
      expect(canonicalText(raw), name).toBe(canonical);
      if (canonical !== null) expect(bytesOf(canonical), name).toBe(bytes);
    }
    // Never truncated: an over-limit text is refused whole, never cut to fit.
    expect(dmTextEligible("a".repeat(5000))).toBeNull();
  });

  it("receipt canonical format keeps the earlier 1000-code-point rule (old texts over today's bytes still parse)", () => {
    for (const text of LEGACY) {
      expect(bytesOf(text)).toBeGreaterThan(DM_TEXT_BYTES_MAX);
      expect(dmCanonicalText(text)).toBe(text);
      expect(dmTextEligible(text)).toBeNull();
    }
  });

  it("an old oversized receipt parses and binds in every state (pending envelope included) with its exact digest", async () => {
    const { out } = await receipts();
    for (const text of LEGACY)
      for (const [k, base] of Object.entries(out)) {
        const digest = dmBodyDigest(base.recipientId, text);
        const old = { ...JSON.parse(JSON.stringify(base)), text, digest } as DmIntent;
        expect(parseDmIntent(old), k).toEqual(old);
        expect(bindDmIntent({ ok: true, intent: old }, bound(old)).ok, k).toBe(true);
        // The same answer through the dashboard transport (Status) is accepted as is.
        const answer = vi.fn<typeof fetch>(async () => json({ intent: old }));
        expect(await instagramDmStatus(CFG, old.operationId, ME, answer), k).toEqual({
          ok: true,
          intent: old,
        });
        // A changed digest or text is still never trusted.
        expect(bindDmIntent({ ok: true, intent: old }, bound(old, { text: "other" })).ok).toBe(
          false,
        );
      }
    for (const text of LEGACY) {
      const old = {
        ...JSON.parse(JSON.stringify(out.dispatching)),
        text,
        digest: dmBodyDigest(PERSON, text),
      } as DmIntent;
      const answer = vi.fn<typeof fetch>(async () =>
        json({
          intent: old,
          observed: { state: "unknown", reason: "receipt" },
          settlement: "pending",
        }),
      );
      const r = await confirmInstagramDm(
        CFG,
        { operationId: old.operationId, digest: old.digest, account: ME },
        answer,
      );
      expect(r).toEqual({
        ok: true,
        intent: old,
        pending: { observed: "unknown", code: "receipt" },
      });
      expect(bindDmIntent(r, bound(old)).ok).toBe(true);
    }
  });

  it("the format rule is unchanged otherwise: over 1000 code points, untrimmed or lone surrogates never parse", async () => {
    const { out } = await receipts();
    for (const text of ["😀".repeat(DM_TEXT_MAX + 1), ` ${"ب".repeat(501)}`, "ب\ud800"])
      expect(
        parseDmIntent({ ...out.prepared, text, digest: dmBodyDigest(PERSON, text) }),
      ).toBeNull();
  });
});
