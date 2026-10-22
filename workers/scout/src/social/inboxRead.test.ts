import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { sealCursor } from "./inboxRead";
import { Store } from "./store";
import type { TokenSet } from "./types";

// 📥 Inbox reads (packet DT-6A, planning/tools/36-inbox.md): pure GET readers beside the reply automation. Every
// read path leaves KV untouched (writes === 0), sends nothing (no POST/DELETE upstream) and never follows an
// upstream paging URL. Same fake KV + fake fetch harness as replies.test.ts.

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-17T09:00:00Z");
const IG = "graph.instagram.com/v21.0";
const ACCOUNT = "17841400000000001";
const ALL_SCOPES =
  "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages";

type FakeKV = KVNamespace & { store: Map<string, string>; writes: number; deletes: number };

function fakeKV(): FakeKV {
  const store = new Map<string, string>();
  const kv = {
    store,
    writes: 0,
    deletes: 0,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.writes += 1;
      store.set(key, value);
    },
    async delete(key: string) {
      kv.deletes += 1;
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  };
  return kv as unknown as FakeKV;
}

function makeEnv(): Env & { SOCIAL_KV: FakeKV } {
  return {
    SCOUT_TOKEN: TOKEN,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: fakeKV(),
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
  };
}

/** Connects Instagram with the given token fields, then zeroes the write counters (the reads are what is measured). */
async function connect(env: Env & { SOCIAL_KV: FakeKV }, tokens: Partial<TokenSet> = {}) {
  const store = Store.from(env)!;
  await store.putTokens("instagram", {
    accessToken: "ig-live-token",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: "app-scoped-999",
    canPublish: true,
    canReply: true,
    scope: ALL_SCOPES,
    ...tokens,
  });
  await store.putStatus("instagram", {
    connectedAt: "2026-10-01T08:00:00.000Z",
    handle: "3z.prod",
  });
  env.SOCIAL_KV.writes = 0;
  env.SOCIAL_KV.deletes = 0;
}

function req(path: string, init: RequestInit & { auth?: string | null; origin?: string } = {}) {
  const { auth = TOKEN, origin = APP, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth !== null) headers.set("Authorization", `Bearer ${auth}`);
  headers.set("Origin", origin);
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

type Handler = (url: URL, init: RequestInit | undefined) => unknown;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const key = `${init?.method ?? "GET"} ${url.host}${url.pathname}`;
    const handler = routes[key];
    if (!handler) return json({ error: { message: `unmocked ${key}` } }, 404);
    const out = await handler(url, init);
    return out instanceof Response ? out : json(out);
  });
  const urls = () =>
    fn.mock.calls.map(
      ([input]) =>
        new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url),
    );
  const methods = () => fn.mock.calls.map(([, init]) => init?.method ?? "GET");
  return Object.assign(fn, { urls, methods });
}

const me = () => ({ user_id: ACCOUNT, username: "3z.prod" });

async function run(env: Env, fetchFn: typeof fetch, path: string, init = {}) {
  return handle(req(path, init), env, undefined, { fetch: fetchFn, now: () => NOW });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** The account's id and generation, as the dashboard gets them first. */
async function account(env: Env) {
  const f = mockFetch({ [`GET ${IG}/me`]: me });
  const res = await run(env, f, "/social/inbox/account");
  expect(res.status).toBe(200);
  const b = await body(res);
  return { accountId: b.accountId as string, generation: b.generation as string };
}

const q = (a: { accountId: string; generation: string }, cursor?: string) =>
  `?account=${encodeURIComponent(a.accountId)}&generation=${a.generation}${
    cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
  }`;

/** Zero writes, zero deletes, only GETs upstream. */
function expectPure(env: Env & { SOCIAL_KV: FakeKV }, f: ReturnType<typeof mockFetch>) {
  expect(env.SOCIAL_KV.writes).toBe(0);
  expect(env.SOCIAL_KV.deletes).toBe(0);
  expect(f.methods().every((m) => m === "GET")).toBe(true);
  for (const u of f.urls()) expect(u.host).toBe("graph.instagram.com");
}

describe("auth and origin", () => {
  it("rejects a missing or wrong bearer and a foreign origin before any Instagram read", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({ [`GET ${IG}/me`]: me });
    expect((await run(env, f, "/social/inbox/account", { auth: null })).status).toBe(401);
    expect((await run(env, f, "/social/inbox/account", { auth: "wrong" })).status).toBe(401);
    expect(
      (await run(env, f, "/social/inbox/account", { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("answers only GET: other methods are 405 with no upstream call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({});
    for (const method of ["POST", "DELETE", "PUT"]) {
      const res = await run(env, f, "/social/inbox/conversations", { method });
      expect(res.status).toBe(405);
    }
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("says not_connected without a token and not_configured without storage", async () => {
    const env = makeEnv();
    const f = mockFetch({});
    const res = await run(env, f, "/social/inbox/account");
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual({ error: "not_connected" });
    const bare = { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP } as Env;
    expect((await run(bare, f, "/social/inbox/account")).status).toBe(503);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("GET /social/inbox/account", () => {
  it("returns the /me user_id as a string, the handle, a generation and per-surface capabilities", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: 1784140000000001, username: "3z.prod" }),
    });
    const res = await run(env, f, "/social/inbox/account");
    const b = await body(res);
    expect(b).toEqual({
      accountId: "1784140000000001",
      handle: "3z.prod",
      generation: expect.stringMatching(/^[0-9a-f]{32}$/),
      capabilities: { messages: "ok", comments: "ok" },
    });
    expect(JSON.stringify(b)).not.toContain("ig-live-token");
    expect(JSON.stringify(b)).not.toContain("app-scoped-999");
    expect(f.urls()[0].searchParams.get("fields")).toBe("user_id,username");
    expect(f).toHaveBeenCalledTimes(1);
    expectPure(env, f);
  });

  it("keeps the same generation for a handle rename and changes it on reconnect", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({ [`GET ${IG}/me`]: () => ({ user_id: ACCOUNT, username: "renamed" }) });
    const renamed = await body(await run(env, f, "/social/inbox/account"));
    expect(renamed).toMatchObject({
      accountId: a.accountId,
      handle: "renamed",
      generation: a.generation,
    });
    await Store.from(env)!.putStatus("instagram", { connectedAt: "2026-10-17T08:00:00.000Z" });
    const again = await account(env);
    expect(again.accountId).toBe(a.accountId);
    expect(again.generation).not.toBe(a.generation);
  });

  it("reads capabilities from the granted scopes: one surface may be denied while the other works", async () => {
    const env = makeEnv();
    await connect(env, {
      scope: "instagram_business_basic,instagram_business_manage_messages",
    });
    const b = await body(
      await run(env, mockFetch({ [`GET ${IG}/me`]: me }), "/social/inbox/account"),
    );
    expect(b.capabilities).toEqual({ messages: "ok", comments: "no_permission" });

    const env2 = makeEnv();
    await connect(env2, { canReply: false, scope: undefined });
    const b2 = await body(
      await run(env2, mockFetch({ [`GET ${IG}/me`]: me }), "/social/inbox/account"),
    );
    expect(b2.capabilities).toEqual({ messages: "no_permission", comments: "no_permission" });
  });

  it("maps an expired token without a call, and Instagram's refusals to their codes, with no token or URL", async () => {
    const env = makeEnv();
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    const f = mockFetch({});
    const res = await run(env, f, "/social/inbox/account");
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("token_expired");
    expect(f).not.toHaveBeenCalled();

    const env2 = makeEnv();
    await connect(env2);
    const leaky = mockFetch({
      [`GET ${IG}/me`]: () =>
        json(
          {
            error: {
              message:
                "Calls limited. See https://graph.instagram.com/v21.0/me?access_token=ig-live-token",
              code: 4,
            },
          },
          400,
        ),
    });
    const limited = await run(env2, leaky, "/social/inbox/account");
    expect(limited.status).toBe(429);
    const lb = await body(limited);
    expect(lb.error).toBe("rate_limited");
    expect(JSON.stringify(lb)).not.toMatch(/ig-live-token|https?:\/\//);
    expect(String(lb.detail ?? "").length).toBeLessThanOrEqual(200);
  });
});

const convo = (id: string, updated = "2026-10-17T08:00:00+0000") => ({
  id,
  updated_time: updated,
  participants: {
    data: [
      { id: ACCOUNT, username: "3z.prod" },
      { id: `p-${id}`, username: `fan_${id}` },
    ],
  },
});

describe("GET /social/inbox/conversations", () => {
  it("lists conversations with participants, a sealed cursor and coverage; no upstream URL is returned", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({
        data: [convo("c1"), convo("c2")],
        paging: {
          cursors: { after: "QVFIUmNext" },
          next: "https://graph.instagram.com/v21.0/x/conversations?access_token=ig-live-token&after=QVFIUmNext",
        },
      }),
    });
    const res = await run(env, f, `/social/inbox/conversations${q(a)}`);
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b).toMatchObject({
      accountId: ACCOUNT,
      generation: a.generation,
      fetchedAt: NOW.toISOString(),
      coverage: "more",
      items: [
        {
          id: "c1",
          updatedAt: "2026-10-17T08:00:00.000Z",
          participants: [
            { id: ACCOUNT, username: "3z.prod" },
            { id: "p-c1", username: "fan_c1" },
          ],
        },
        { id: "c2" },
      ],
    });
    expect(typeof b.next).toBe("string");
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/ig-live-token|https?:\/\/|QVFIUmNext/);
    const u = f.urls()[0];
    expect(u.searchParams.get("platform")).toBe("instagram");
    expect(u.searchParams.get("limit")).toBe("20");
    expect(u.searchParams.get("fields")).toBe("id,updated_time,participants{id,username}");
    expect(f).toHaveBeenCalledTimes(1);
    expectPure(env, f);
  });

  it("follows its own cursor on the fixed host, never the upstream paging.next host", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const first = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({
        data: [convo("c1")],
        paging: {
          cursors: { after: "AFTER1" },
          next: "https://evil.example/steal?access_token=ig-live-token",
        },
      }),
    });
    const p1 = await body(await run(env, first, `/social/inbox/conversations${q(a)}`));
    const second = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: (u) => ({
        data: u.searchParams.get("after") === "AFTER1" ? [convo("c1"), convo("c3")] : [],
      }),
    });
    const p2 = await body(
      await run(env, second, `/social/inbox/conversations${q(a, p1.next as string)}`),
    );
    expect(second.urls()[0].host).toBe("graph.instagram.com");
    expect(second.urls()[0].searchParams.get("after")).toBe("AFTER1");
    expect([...first.urls(), ...second.urls()].some((u) => u.host === "evil.example")).toBe(false);
    // The server returns raw pages (the overlap "c1" is deduplicated by the dashboard, lib/inbox.ts).
    expect((p2.items as { id: string }[]).map((i) => i.id)).toEqual(["c1", "c3"]);
    expect(p2).toMatchObject({ next: null, coverage: "end" });
    expectPure(env, second);
  });

  it("rejects malformed, tampered, foreign-account, foreign-edge and old-generation cursors with zero calls", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f1 = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({
        data: [convo("c1")],
        paging: { cursors: { after: "AFTER1" }, next: "https://graph.instagram.com/n" },
      }),
      [`GET ${IG}/${ACCOUNT}/media`]: () => ({
        data: [{ id: "m1" }],
        paging: { cursors: { after: "MAFTER" }, next: "https://graph.instagram.com/n" },
      }),
    });
    const cursor = (await body(await run(env, f1, `/social/inbox/conversations${q(a)}`)))
      .next as string;
    const mediaCursor = (await body(await run(env, f1, `/social/inbox/media${q(a)}`)))
      .next as string;
    const f = mockFetch({});
    const bad = async (path: string) => {
      const res = await run(env, f, path);
      expect(res.status, path).toBe(400);
      expect((await body(res)).error, path).toBe("cursor_invalid");
    };
    await bad(`/social/inbox/conversations${q(a, "garbage")}`);
    await bad(`/social/inbox/conversations${q(a, `${cursor.slice(0, -2)}xx`)}`);
    const [payload, sig] = cursor.split(".");
    const forged = btoa(
      JSON.stringify({
        ...JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))),
        after: "X",
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await bad(`/social/inbox/conversations${q(a, `${forged}.${sig}`)}`);
    // Another edge's cursor.
    await bad(`/social/inbox/conversations${q(a, mediaCursor)}`);
    // A correctly signed cursor for another account (or an id on an edge that has none) is refused too.
    const signed = (p: Parameters<typeof sealCursor>[1], secret = TOKEN) => sealCursor(secret, p);
    await bad(
      `/social/inbox/conversations${q(a, await signed({ a: "other", g: a.generation, e: "conversations", after: "X" }))}`,
    );
    await bad(
      `/social/inbox/conversations${q(a, await signed({ a: a.accountId, g: a.generation, e: "conversations", id: "c1", after: "X" }))}`,
    );
    await bad(
      `/social/inbox/conversations${q(a, await signed({ a: a.accountId, g: a.generation, e: "conversations", after: "X" }, "another-secret"))}`,
    );
    expect(f).not.toHaveBeenCalled();

    // After a reconnect the old cursor is from another generation.
    await Store.from(env)!.putStatus("instagram", { connectedAt: "2026-10-17T08:30:00.000Z" });
    const b = await account(env);
    await bad(`/social/inbox/conversations${q(b, cursor)}`);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses an account/generation pair it did not issue (stale after reconnect) without calling Instagram", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({});
    const foreign = await run(
      env,
      f,
      `/social/inbox/conversations${q({ ...a, accountId: "999" })}`,
    );
    expect(foreign.status).toBe(409);
    expect((await body(foreign)).error).toBe("stale");
    await Store.from(env)!.putStatus("instagram", { connectedAt: "2026-10-17T08:30:00.000Z" });
    const stale = await run(env, f, `/social/inbox/conversations${q(a)}`);
    expect(stale.status).toBe(409);
    expect((await body(stale)).error).toBe("stale");
    const missing = await run(env, f, `/social/inbox/conversations`);
    expect(missing.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("distinguishes empty, provider end and a local cap", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const empty = await body(
      await run(
        env,
        mockFetch({ [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({ data: [] }) }),
        `/social/inbox/conversations${q(a)}`,
      ),
    );
    expect(empty).toMatchObject({ items: [], next: null, coverage: "end" });
    const many = Array.from({ length: 25 }, (_, i) => convo(`c${i}`));
    const capped = await body(
      await run(
        env,
        mockFetch({
          [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({
            data: many,
            paging: { cursors: { after: "A" }, next: "https://graph.instagram.com/n" },
          }),
        }),
        `/social/inbox/conversations${q(a)}`,
      ),
    );
    expect((capped.items as unknown[]).length).toBe(20);
    expect(capped).toMatchObject({ next: null, coverage: "cap" });
  });

  it("a later page failing says partial; a first page failing says unavailable, each with its code", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ok = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({
        data: [convo("c1")],
        paging: { cursors: { after: "A1" }, next: "https://graph.instagram.com/n" },
      }),
    });
    const p1 = await body(await run(env, ok, `/social/inbox/conversations${q(a)}`));
    const down = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () =>
        json({ error: { message: "oops", code: 2 } }, 500),
    });
    const later = await run(env, down, `/social/inbox/conversations${q(a, p1.next as string)}`);
    expect(later.status).toBe(502);
    expect(await body(later)).toMatchObject({ error: "upstream", coverage: "partial" });
    const first = await run(env, down, `/social/inbox/conversations${q(a)}`);
    expect(await body(first)).toMatchObject({ error: "upstream", coverage: "unavailable" });
  });

  it("maps token_expired, rate_limited, no_permission and not_eligible distinctly", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const cases: [unknown, number, string, number][] = [
      [{ error: { message: "Session expired", code: 190 } }, 400, "token_expired", 409],
      [{ error: { message: "Too many calls", code: 4 } }, 400, "rate_limited", 429],
      [{ error: { message: "Permission denied", code: 10 } }, 403, "no_permission", 403],
      [{ error: { message: "Needs permission", code: 200 } }, 403, "no_permission", 403],
      [{ error: { message: "App not approved for this", code: 3 } }, 400, "not_eligible", 403],
    ];
    for (const [upstream, upStatus, code, status] of cases) {
      const f = mockFetch({
        [`GET ${IG}/${ACCOUNT}/conversations`]: () => json(upstream, upStatus),
      });
      const res = await run(env, f, `/social/inbox/conversations${q(a)}`);
      expect(res.status, code).toBe(status);
      expect((await body(res)).error, code).toBe(code);
    }
  });

  it("serves no conversations when the message scope is missing, without a call", async () => {
    const env = makeEnv();
    await connect(env, { scope: "instagram_business_basic,instagram_business_manage_comments" });
    const a = await account(env);
    const f = mockFetch({});
    const res = await run(env, f, `/social/inbox/conversations${q(a)}`);
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("no_permission");
    expect(f).not.toHaveBeenCalled();
  });
});

const msg = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  created_time: "2026-10-17T07:00:00+0000",
  from: { id: "p-c1", username: "fan_c1" },
  message: `text ${id}`,
  ...over,
});

describe("GET /social/inbox/conversations/:id/messages", () => {
  it("keeps both directions, outgoing-only, empty, story, share, unsupported and missing-author rows honestly", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const long = "س".repeat(2500);
    const f = mockFetch({
      [`GET ${IG}/c1`]: () => ({
        id: "c1",
        messages: {
          data: [
            msg("in1"),
            msg("out1", { from: { id: ACCOUNT, username: "3z.prod" }, message: "my reply" }),
            msg("same-name", { from: { id: "other-id", username: "3z.prod" } }),
            msg("empty", { message: "" }),
            msg("reply", { story: { reply_to: { id: "s1" } }, message: "nice story" }),
            msg("mention", { story: { mention: { id: "s2" } }, message: undefined }),
            msg("share", { message: undefined, shares: { data: [{ link: "https://x" }] } }),
            msg("unsupported", { is_unsupported: true, message: undefined }),
            msg("anon", { from: undefined }),
            msg("notime", { created_time: "garbage" }),
            msg("long", { message: long }),
            msg("lines", { message: "line one\nline two" }),
          ],
          paging: { cursors: { after: "M1" }, next: "https://graph.instagram.com/n" },
        },
      }),
    });
    const res = await run(env, f, `/social/inbox/conversations/c1/messages${q(a)}`);
    expect(res.status).toBe(200);
    const b = await body(res);
    const items = b.items as Record<string, unknown>[];
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(items).toHaveLength(12);
    expect(byId.in1).toEqual({
      id: "in1",
      createdAt: "2026-10-17T07:00:00.000Z",
      direction: "in",
      from: { id: "p-c1", username: "fan_c1" },
      text: "text in1",
      kind: "text",
    });
    expect(byId.out1).toMatchObject({ direction: "out", kind: "text", text: "my reply" });
    // Direction is by id only, never by username.
    expect(byId["same-name"]).toMatchObject({ direction: "in" });
    expect(byId.empty).toMatchObject({ kind: "empty", text: "" });
    expect(byId.reply).toMatchObject({ kind: "story_reply", text: "nice story" });
    expect(byId.mention).toMatchObject({ kind: "story_mention", text: "" });
    expect(byId.share).toMatchObject({ kind: "share", text: "" });
    expect(byId.share).not.toHaveProperty("shares");
    expect(byId.unsupported).toMatchObject({ kind: "unsupported", text: "" });
    expect(byId.anon).toMatchObject({ direction: "unknown", from: null });
    expect(byId.notime).toMatchObject({ createdAt: null });
    expect((byId.long.text as string).length).toBeLessThanOrEqual(2000);
    expect(byId.lines.text).toBe("line one\nline two");
    expect(b).toMatchObject({ coverage: "more" });
    expect(JSON.stringify(b)).not.toMatch(/https?:\/\/|ig-live-token/);
    expect(f.urls()[0].searchParams.get("fields")).toBe(
      "messages.limit(20){id,created_time,from,message,story,is_unsupported}",
    );
    expectPure(env, f);
  });

  it("re-applies the nested after cursor as messages.after(…).limit(20), bound to the conversation", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f1 = mockFetch({
      [`GET ${IG}/c1`]: () => ({
        id: "c1",
        messages: {
          data: [msg("m1")],
          paging: { cursors: { after: "NEST1" }, next: "https://evil.example/n" },
        },
      }),
    });
    const p1 = await body(await run(env, f1, `/social/inbox/conversations/c1/messages${q(a)}`));
    const f2 = mockFetch({
      [`GET ${IG}/c1`]: () => ({ id: "c1", messages: { data: [msg("m0")] } }),
    });
    const p2 = await body(
      await run(env, f2, `/social/inbox/conversations/c1/messages${q(a, p1.next as string)}`),
    );
    expect(f2.urls()[0].searchParams.get("fields")).toBe(
      "messages.after(NEST1).limit(20){id,created_time,from,message,story,is_unsupported}",
    );
    expect(p2).toMatchObject({ coverage: "end", next: null });
    // The same cursor on another conversation is refused.
    const f3 = mockFetch({});
    const other = await run(
      env,
      f3,
      `/social/inbox/conversations/c2/messages${q(a, p1.next as string)}`,
    );
    expect(other.status).toBe(400);
    expect(f3).not.toHaveBeenCalled();
  });

  it("reports bare-id expansion failure as history_unavailable, never as an empty conversation", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${IG}/c1`]: () => ({ id: "c1", messages: { data: [{ id: "m1" }, { id: "m2" }] } }),
    });
    const res = await run(env, f, `/social/inbox/conversations/c1/messages${q(a)}`);
    expect(res.status).toBe(502);
    expect(await body(res)).toMatchObject({ error: "upstream", coverage: "history_unavailable" });
  });

  it("refuses a conversation id that is not a plain id, without a call", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({});
    const res = await run(env, f, `/social/inbox/conversations/a.b/messages${q(a)}`);
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("GET /social/inbox/media and /media/:id/comments", () => {
  it("lists owned media with only validated Instagram permalinks", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${IG}/${ACCOUNT}/media`]: () => ({
        data: [
          {
            id: "m1",
            caption: "First line\nsecond line",
            permalink: "https://www.instagram.com/reel/ABC/",
            timestamp: "2026-10-10T10:00:00+0000",
            comments_count: 7,
          },
          { id: "m2", permalink: "https://evil.example/reel/ABC/", comments_count: "3" },
          { id: "m3", permalink: "javascript:alert(1)" },
        ],
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/media${q(a)}`));
    expect(b.items).toEqual([
      {
        id: "m1",
        caption: "First line",
        permalink: "https://www.instagram.com/reel/ABC/",
        timestamp: "2026-10-10T10:00:00.000Z",
        commentsCount: 7,
      },
      { id: "m2", timestamp: null, commentsCount: 3 },
      { id: "m3", timestamp: null, commentsCount: 0 },
    ]);
    const u = f.urls()[0];
    expect(u.searchParams.get("fields")).toBe("id,caption,permalink,timestamp,comments_count");
    expect(u.searchParams.get("limit")).toBe("25");
    expectPure(env, f);
  });

  it("returns comments with author and direction by id; unknown when from is missing", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${IG}/m1/comments`]: () => ({
        data: [
          {
            id: "k1",
            text: "love it",
            username: "fan",
            from: { id: "u1", username: "fan" },
            timestamp: "2026-10-16T10:00:00+0000",
          },
          {
            id: "k2",
            text: "thanks!",
            from: { id: ACCOUNT, username: "3z.prod" },
            timestamp: "2026-10-16T11:00:00+0000",
          },
          { id: "k3", text: "no from", username: "3z.prod" },
        ],
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/media/m1/comments${q(a)}`));
    expect(b.items).toEqual([
      {
        id: "k1",
        text: "love it",
        author: { id: "u1", username: "fan" },
        createdAt: "2026-10-16T10:00:00.000Z",
        direction: "in",
      },
      {
        id: "k2",
        text: "thanks!",
        author: { id: ACCOUNT, username: "3z.prod" },
        createdAt: "2026-10-16T11:00:00.000Z",
        direction: "out",
      },
      {
        id: "k3",
        text: "no from",
        author: { username: "3z.prod" },
        createdAt: null,
        direction: "unknown",
      },
    ]);
    expect(b.coverage).toBe("end");
    expect(f.urls()[0].searchParams.get("fields")).toBe("id,text,username,from,timestamp");
    expect(f.urls()[0].searchParams.get("limit")).toBe("25");
    expectPure(env, f);
  });

  it("serves messages while comments are denied, and the reverse", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({ data: [convo("c1")] }),
      [`GET ${IG}/m1/comments`]: () => json({ error: { message: "denied", code: 10 } }, 403),
    });
    expect((await run(env, f, `/social/inbox/conversations${q(a)}`)).status).toBe(200);
    const denied = await run(env, f, `/social/inbox/media/m1/comments${q(a)}`);
    expect(denied.status).toBe(403);
    expect((await body(denied)).error).toBe("no_permission");

    const g = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () =>
        json({ error: { message: "denied", code: 10 } }, 403),
      [`GET ${IG}/m1/comments`]: () => ({ data: [] }),
    });
    expect((await run(env, g, `/social/inbox/conversations${q(a)}`)).status).toBe(403);
    expect((await run(env, g, `/social/inbox/media/m1/comments${q(a)}`)).status).toBe(200);
  });
});

/* ---------- DT-6A-R1 (Codex findings 6A-6 … 6A-9) ---------- */

type Acc = { accountId: string; generation: string };
const later = (a: Acc, e: "conversations" | "messages" | "media" | "comments", id?: string) =>
  sealCursor(TOKEN, { a: a.accountId, g: a.generation, e, ...(id ? { id } : {}), after: "A1" });

describe("DT-6A-R1: a 200 without a valid list is never an empty end (6A-6)", () => {
  const edges = [
    [
      "conversations",
      `GET ${IG}/${ACCOUNT}/conversations`,
      "/social/inbox/conversations",
      undefined,
    ],
    ["media", `GET ${IG}/${ACCOUNT}/media`, "/social/inbox/media", undefined],
    ["comments", `GET ${IG}/m1/comments`, "/social/inbox/media/m1/comments", "m1"],
  ] as const;

  for (const [edge, key, path, id] of edges) {
    it(`${edge}: {} or a non-array data is unavailable first, partial later; data: [] stays end`, async () => {
      const env = makeEnv();
      await connect(env);
      const a = await account(env);
      for (const bad of [{}, { data: "nope" }, { data: { 0: "x" } }, { data: null }]) {
        const f = mockFetch({ [key]: () => bad });
        const first = await run(env, f, `${path}${q(a)}`);
        expect(first.status, JSON.stringify(bad)).toBe(502);
        expect(await body(first)).toMatchObject({ error: "upstream", coverage: "unavailable" });
        const next = await run(env, f, `${path}${q(a, await later(a, edge, id))}`);
        expect(next.status).toBe(502);
        expect(await body(next)).toMatchObject({ error: "upstream", coverage: "partial" });
        expectPure(env, f);
      }
      const ok = mockFetch({ [key]: () => ({ data: [] }) });
      const empty = await run(env, ok, `${path}${q(a)}`);
      expect(empty.status).toBe(200);
      expect(await body(empty)).toMatchObject({ items: [], next: null, coverage: "end" });
    });
  }

  it("messages: a messages object without a data list is unavailable first, partial later; data: [] stays end", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    for (const bad of [{}, { data: "nope" }, { data: null }]) {
      const f = mockFetch({ [`GET ${IG}/c1`]: () => ({ id: "c1", messages: bad }) });
      const first = await run(env, f, `/social/inbox/conversations/c1/messages${q(a)}`);
      expect(first.status).toBe(502);
      expect(await body(first)).toMatchObject({ error: "upstream", coverage: "unavailable" });
      const next = await run(
        env,
        f,
        `/social/inbox/conversations/c1/messages${q(a, await later(a, "messages", "c1"))}`,
      );
      expect(await body(next)).toMatchObject({ error: "upstream", coverage: "partial" });
      expectPure(env, f);
    }
    const ok = mockFetch({ [`GET ${IG}/c1`]: () => ({ id: "c1", messages: { data: [] } }) });
    const empty = await run(env, ok, `/social/inbox/conversations/c1/messages${q(a)}`);
    expect(empty.status).toBe(200);
    expect(await body(empty)).toMatchObject({ items: [], next: null, coverage: "end" });
  });
});

describe("DT-6A-R1: missing optional metadata keeps real messages (6A-7)", () => {
  const real = {
    id: "m1",
    message: "Real expanded text",
    created_time: "2026-10-17T00:00:00Z",
    from: { id: "fan" },
  };
  const read = async (rows: unknown[]) => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({ [`GET ${IG}/c1`]: () => ({ id: "c1", messages: { data: rows } }) });
    const res = await run(env, f, `/social/inbox/conversations/c1/messages${q(a)}`);
    expectPure(env, f);
    return { status: res.status, b: await body(res) };
  };

  it("a page whose rows all lack `from` keeps them with an unknown author and direction", async () => {
    const { status, b } = await read([{ ...real, from: undefined }]);
    expect(status).toBe(200);
    expect(b.items).toEqual([
      {
        id: "m1",
        createdAt: "2026-10-17T00:00:00.000Z",
        direction: "unknown",
        from: null,
        text: "Real expanded text",
        kind: "text",
      },
    ]);
  });

  it("a page whose rows all lack `created_time` keeps them with a null time", async () => {
    const { status, b } = await read([{ ...real, created_time: undefined }]);
    expect(status).toBe(200);
    expect(b.items).toEqual([
      {
        id: "m1",
        createdAt: null,
        direction: "in",
        from: { id: "fan" },
        text: "Real expanded text",
        kind: "text",
      },
    ]);
  });

  it("text, story and unsupported rows with neither `from` nor `created_time` are still messages", async () => {
    const { status, b } = await read([
      { id: "t", message: "only text" },
      { id: "s", story: { mention: { id: "s1" } } },
      { id: "u", is_unsupported: true },
    ]);
    expect(status).toBe(200);
    expect((b.items as { id: string; kind: string }[]).map((i) => [i.id, i.kind])).toEqual([
      ["t", "text"],
      ["s", "story_mention"],
      ["u", "unsupported"],
    ]);
  });

  it("only a page of bare ids is history_unavailable", async () => {
    const bare = await read([{ id: "m1" }, { id: "m2" }]);
    expect(bare.status).toBe(502);
    expect(bare.b).toMatchObject({ error: "upstream", coverage: "history_unavailable" });
    const mixed = await read([{ id: "m1" }, real]);
    expect(mixed.status).toBe(200);
    expect((mixed.b.items as unknown[]).length).toBe(2);
  });
});

describe("DT-6A-R1: every emitted cursor is one the reader accepts (6A-8)", () => {
  const LONG_AFTER = "A".repeat(1000);
  const LONG_ID = "c".repeat(256);

  it("conversations: a cursor that would exceed the input limit is a local cap with no next", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () => ({
        data: [convo("c1")],
        paging: { cursors: { after: LONG_AFTER }, next: "https://graph.instagram.com/n" },
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/conversations${q(a)}`));
    expect(b).toMatchObject({ next: null, coverage: "cap" });
    expect((b.items as unknown[]).length).toBe(1);
  });

  it("messages on a 256-character conversation id: no unusable cursor either", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${IG}/${LONG_ID}`]: () => ({
        id: LONG_ID,
        messages: {
          data: [msg("m1")],
          paging: { cursors: { after: LONG_AFTER }, next: "https://graph.instagram.com/n" },
        },
      }),
    });
    const b = await body(
      await run(env, f, `/social/inbox/conversations/${LONG_ID}/messages${q(a)}`),
    );
    expect(b).toMatchObject({ next: null, coverage: "cap" });
  });

  it("the longest cursor it does emit opens on the next call (signature and binding kept)", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    // The longest `after` whose sealed cursor still fits, found by search over the real sealer.
    let lo = 1;
    let hi = 1000;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const c = await sealCursor(TOKEN, {
        a: a.accountId,
        g: a.generation,
        e: "messages",
        id: LONG_ID,
        after: "A".repeat(mid),
      });
      if (c.length <= 1500) lo = mid;
      else hi = mid - 1;
    }
    const after = "A".repeat(lo);
    const first = mockFetch({
      [`GET ${IG}/${LONG_ID}`]: () => ({
        id: LONG_ID,
        messages: {
          data: [msg("m1")],
          paging: { cursors: { after }, next: "https://graph.instagram.com/n" },
        },
      }),
    });
    const p1 = await body(
      await run(env, first, `/social/inbox/conversations/${LONG_ID}/messages${q(a)}`),
    );
    expect(p1.coverage).toBe("more");
    const second = mockFetch({
      [`GET ${IG}/${LONG_ID}`]: () => ({ id: LONG_ID, messages: { data: [msg("m0")] } }),
    });
    const res = await run(
      env,
      second,
      `/social/inbox/conversations/${LONG_ID}/messages${q(a, p1.next as string)}`,
    );
    expect(res.status).toBe(200);
    expect(second.urls()[0].searchParams.get("fields")).toContain(`messages.after(${after})`);
    // Still bound: the same cursor on the conversations edge is refused before any call.
    const none = mockFetch({});
    const wrong = await run(env, none, `/social/inbox/conversations${q(a, p1.next as string)}`);
    expect(wrong.status).toBe(400);
    expect(none).not.toHaveBeenCalled();
  });
});

describe("DT-6A-R1: a 256 KiB byte budget per upstream page, read before parsing (6A-9)", () => {
  /** A JSON body streamed in 64 KiB chunks with no Content-Length; counts the bytes actually pulled. */
  function streamed(prefix: string, padBytes: number, suffix: string) {
    const enc = new TextEncoder();
    const parts = [enc.encode(prefix)];
    for (let left = padBytes; left > 0; left -= 65536)
      parts.push(enc.encode(" ".repeat(Math.min(65536, left))));
    parts.push(enc.encode(suffix));
    const meter = { pulled: 0, total: parts.reduce((n, p) => n + p.length, 0), cancelled: false };
    let i = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (i >= parts.length) return c.close();
          meter.pulled += parts[i].length;
          c.enqueue(parts[i++]);
        },
        cancel() {
          meter.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return { response: () => new Response(stream, { status: 200 }), meter };
  }

  it("an oversized page (no Content-Length) is unavailable first, without reading it all", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const big = streamed(`{"data":[${JSON.stringify(convo("c1"))}],"pad":"`, 2 * 1024 * 1024, `"}`);
    const f = mockFetch({ [`GET ${IG}/${ACCOUNT}/conversations`]: () => big.response() });
    const res = await run(env, f, `/social/inbox/conversations${q(a)}`);
    expect(res.status).toBe(502);
    expect(await body(res)).toMatchObject({ error: "upstream", coverage: "unavailable" });
    expect(big.meter.pulled).toBeLessThanOrEqual(256 * 1024 + 65536);
    expect(big.meter.pulled).toBeLessThan(big.meter.total);
    expectPure(env, f);
  });

  it("an oversized later page is partial; a lying small Content-Length does not help", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const big = streamed(`{"data":[${JSON.stringify(convo("c1"))}],"pad":"`, 1024 * 1024, `"}`);
    const f = mockFetch({
      [`GET ${IG}/${ACCOUNT}/conversations`]: () => {
        const r = big.response();
        return new Response(r.body, { status: 200, headers: { "Content-Length": "10" } });
      },
    });
    const res = await run(
      env,
      f,
      `/social/inbox/conversations${q(a, await later(a, "conversations"))}`,
    );
    expect(res.status).toBe(502);
    expect(await body(res)).toMatchObject({ error: "upstream", coverage: "partial" });
    expect(big.meter.pulled).toBeLessThanOrEqual(256 * 1024 + 65536);
  });

  it("a page just under the budget still reads normally", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ok = streamed(`{"data":[${JSON.stringify(convo("c1"))}],"pad":"`, 200 * 1024, `"}`);
    const f = mockFetch({ [`GET ${IG}/${ACCOUNT}/conversations`]: () => ok.response() });
    const res = await run(env, f, `/social/inbox/conversations${q(a)}`);
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ items: [{ id: "c1" }], coverage: "end" });
  });

  it("an oversized account (/me) answer is upstream too", async () => {
    const env = makeEnv();
    await connect(env);
    const big = streamed(`{"user_id":"${ACCOUNT}","pad":"`, 512 * 1024, `"}`);
    const f = mockFetch({ [`GET ${IG}/me`]: () => big.response() });
    const res = await run(env, f, "/social/inbox/account");
    expect(res.status).toBe(502);
    expect((await body(res)).error).toBe("upstream");
  });

  it("omits a permalink longer than 2,048 characters and keeps the row", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const long = `https://www.instagram.com/reel/${"A".repeat(2100)}/`;
    const edge = `https://www.instagram.com/reel/${"B".repeat(2048 - 32)}/`;
    expect(edge.length).toBe(2048);
    const f = mockFetch({
      [`GET ${IG}/${ACCOUNT}/media`]: () => ({
        data: [
          { id: "m1", permalink: long, comments_count: 1 },
          { id: "m2", permalink: edge },
        ],
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/media${q(a)}`));
    expect(b.items).toEqual([
      { id: "m1", timestamp: null, commentsCount: 1 },
      { id: "m2", permalink: edge, timestamp: null, commentsCount: 0 },
    ]);
  });
});

/** One request on a synthetic Instagram: status, body, and the purity checks every read keeps (one GET, no KV). */
async function readOnce(
  key: string,
  path: string,
  answer: unknown,
  cursor?: (a: Acc) => Promise<string>,
) {
  const env = makeEnv();
  await connect(env);
  const a = await account(env);
  const f = mockFetch({ [key]: () => answer });
  const res = await run(env, f, `${path}${q(a, cursor ? await cursor(a) : undefined)}`);
  expect(f).toHaveBeenCalledTimes(1);
  expectPure(env, f);
  const b = await body(res);
  expect(JSON.stringify(b)).not.toMatch(/https?:\/\/|example\.invalid|ig-live-token/);
  return { status: res.status, b };
}

describe("DT-6A-R2: a nonempty page with a row lacking a stable id is a failed page, never an empty end (R1-A)", () => {
  const MSG_KEY = `GET ${IG}/c1`;
  const MSG_PATH = "/social/inbox/conversations/c1/messages";
  /** Each edge: request key, path, how a list is wrapped, a minimal valid row and what it maps to. */
  const edges = [
    {
      edge: "conversations",
      key: `GET ${IG}/${ACCOUNT}/conversations`,
      path: "/social/inbox/conversations",
      id: undefined,
      size: 20,
      wrap: (rows: unknown[]) => ({ data: rows }),
      minimal: { id: "c1" },
      mapped: { id: "c1", updatedAt: null, participants: [] },
    },
    {
      edge: "messages",
      key: MSG_KEY,
      path: MSG_PATH,
      id: "c1",
      size: 20,
      wrap: (rows: unknown[]) => ({ id: "c1", messages: { data: rows } }),
      minimal: { id: "m1", message: "hi" },
      mapped: {
        id: "m1",
        createdAt: null,
        direction: "unknown",
        from: null,
        text: "hi",
        kind: "text",
      },
    },
    {
      edge: "media",
      key: `GET ${IG}/${ACCOUNT}/media`,
      path: "/social/inbox/media",
      id: undefined,
      size: 25,
      wrap: (rows: unknown[]) => ({ data: rows }),
      minimal: { id: "p1" },
      mapped: { id: "p1", timestamp: null, commentsCount: 0 },
    },
    {
      edge: "comments",
      key: `GET ${IG}/m1/comments`,
      path: "/social/inbox/media/m1/comments",
      id: "m1",
      size: 25,
      wrap: (rows: unknown[]) => ({ data: rows }),
      minimal: { id: "k1" },
      mapped: { id: "k1", text: "", author: null, createdAt: null, direction: "unknown" },
    },
  ] as const;

  it("Codex R1-W1: conversations {data:[{}]} is unavailable first and partial later, with no rows", async () => {
    const key = `GET ${IG}/${ACCOUNT}/conversations`;
    const first = await readOnce(key, "/social/inbox/conversations", { data: [{}] });
    expect(first.status).toBe(502);
    expect(first.b).toMatchObject({ error: "upstream", coverage: "unavailable" });
    expect(first.b).not.toHaveProperty("items");
    const next = await readOnce(key, "/social/inbox/conversations", { data: [{}] }, (a) =>
      later(a, "conversations"),
    );
    expect(next.status).toBe(502);
    expect(next.b).toMatchObject({ error: "upstream", coverage: "partial" });
    expect(next.b).not.toHaveProperty("items");
  });

  it("Codex R1-W1: a messages page whose text row has no id is unavailable first and partial later", async () => {
    const answer = {
      id: "c1",
      messages: { data: [{ message: "Existing text with missing stable id" }] },
    };
    const first = await readOnce(MSG_KEY, MSG_PATH, answer);
    expect(first.status).toBe(502);
    expect(first.b).toMatchObject({ error: "upstream", coverage: "unavailable" });
    expect(JSON.stringify(first.b)).not.toContain("Existing text");
    const next = await readOnce(MSG_KEY, MSG_PATH, answer, (a) => later(a, "messages", "c1"));
    expect(next.status).toBe(502);
    expect(next.b).toMatchObject({ error: "upstream", coverage: "partial" });
    expect(JSON.stringify(next.b)).not.toContain("Existing text");
  });

  for (const e of edges) {
    it(`${e.edge}: a valid row beside an id-less, unsafe-id or non-object row fails the whole page`, async () => {
      for (const bad of [{}, { id: "" }, { id: "a/b" }, { id: null }, null, "row", [e.minimal]]) {
        const rows = [e.minimal, bad];
        const first = await readOnce(e.key, e.path, e.wrap(rows));
        expect(first.status, JSON.stringify(bad)).toBe(502);
        expect(first.b).toMatchObject({ error: "upstream", coverage: "unavailable" });
        expect(first.b).not.toHaveProperty("items");
        const next = await readOnce(e.key, e.path, e.wrap(rows), (a) => later(a, e.edge, e.id));
        expect(next.status, JSON.stringify(bad)).toBe(502);
        expect(next.b).toMatchObject({ error: "upstream", coverage: "partial" });
        expect(next.b).not.toHaveProperty("items");
      }
    });

    it(`${e.edge}: a bad row past the page size still fails the page (never a cap)`, async () => {
      const rows = [
        ...Array.from({ length: e.size }, (_, i) => ({ ...e.minimal, id: `x${i}` })),
        {},
      ];
      const first = await readOnce(e.key, e.path, e.wrap(rows));
      expect(first.status).toBe(502);
      expect(first.b).toMatchObject({ error: "upstream", coverage: "unavailable" });
    });

    it(`${e.edge}: genuine data: [] stays an empty end and a minimal valid row stays valid`, async () => {
      const empty = await readOnce(e.key, e.path, e.wrap([]));
      expect(empty.status).toBe(200);
      expect(empty.b).toMatchObject({ items: [], next: null, coverage: "end" });
      const ok = await readOnce(e.key, e.path, e.wrap([e.minimal]));
      expect(ok.status).toBe(200);
      expect(ok.b).toMatchObject({ items: [e.mapped], next: null, coverage: "end" });
    });
  }
});

describe("DT-6A-R2: a share or attachment is a payload, not a bare id (R1-B)", () => {
  const KEY = `GET ${IG}/c1`;
  const PATH = "/social/inbox/conversations/c1/messages";
  const share = {
    id: "m1",
    createdAt: null,
    direction: "unknown",
    from: null,
    text: "",
    kind: "share",
  };
  const page = (rows: unknown[]) => ({ id: "c1", messages: { data: rows } });

  it("Codex R1-W2: a sole shares row without author or time is a share placeholder, no link", async () => {
    const { status, b } = await readOnce(
      KEY,
      PATH,
      page([{ id: "m1", shares: { data: [{ link: "https://example.invalid/media" }] } }]),
    );
    expect(status).toBe(200);
    expect(b).toMatchObject({ next: null, coverage: "end" });
    expect(b.items).toEqual([share]);
  });

  it("Codex R1-W2: a sole attachments row without author or time is a share placeholder, no link", async () => {
    const { status, b } = await readOnce(
      KEY,
      PATH,
      page([
        {
          id: "m1",
          attachments: { data: [{ image_data: { url: "https://example.invalid/a.jpg" } }] },
        },
      ]),
    );
    expect(status).toBe(200);
    expect(b.items).toEqual([share]);
  });

  it("each supported payload alone proves expansion; only ids-and-nothing-else is history_unavailable", async () => {
    for (const payload of [
      { message: "x" },
      { message: "" },
      { story: { mention: { id: "s1" } } },
      { shares: { data: [] } },
      { attachments: { data: [] } },
      { is_unsupported: true },
    ]) {
      const { status } = await readOnce(KEY, PATH, page([{ id: "m1", ...payload }, { id: "m2" }]));
      expect(status, JSON.stringify(payload)).toBe(200);
    }
    const bare = await readOnce(KEY, PATH, page([{ id: "m1" }, { id: "m2" }]));
    expect(bare.status).toBe(502);
    expect(bare.b).toMatchObject({ error: "upstream", coverage: "history_unavailable" });
  });
});
