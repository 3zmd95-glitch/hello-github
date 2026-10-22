import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { PAGE_BYTES_MAX, sealCursor } from "./inboxRead";
import { sealCursorV2, sealRef } from "./inboxReadCommon";
import { openThreadsSendTarget } from "./inboxSendThreads";
import { Store } from "./store";
import type { TokenSet } from "./types";

// 📥 Threads inbox reads (packet DT-6B-1, planning/tools/36-inbox.md): pure GET readers of the owner's own posts and
// their direct replies. Every path leaves KV untouched, sends nothing upstream but GETs on graph.threads.net, never
// refreshes a token, never follows a provider paging URL, and accepts a post only through a sealed ownership `ref`.

const TOKEN = "s3cret-token";
/** The server-only seal key (DT-6B-1-R1 B1-1): never the bearer the browser holds. */
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-17T09:00:00Z");
const TH = "graph.threads.net/v1.0";
const ME = "25000000000000001";
const ANALYTICS = "threads_basic,threads_manage_insights";
const READ = `${ANALYTICS},threads_read_replies`;

type FakeKV = KVNamespace & { writes: number; deletes: number };

function fakeKV(): FakeKV {
  const store = new Map<string, string>();
  const kv = {
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

const makeEnv = (): Env & { SOCIAL_KV: FakeKV } => ({
  SCOUT_TOKEN: TOKEN,
  INBOX_SEAL_SECRET: SEAL,
  ALLOWED_ORIGINS: APP,
  SOCIAL_KV: fakeKV(),
  META_APP_ID: "meta-id",
  META_APP_SECRET: "meta-secret",
});

async function connect(env: Env & { SOCIAL_KV: FakeKV }, tokens: Partial<TokenSet> = {}) {
  const store = Store.from(env)!;
  await store.putTokens("threads", {
    accessToken: "th-live-token",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: ME,
    scope: READ,
    ...tokens,
  });
  await store.putStatus("threads", { connectedAt: "2026-10-01T08:00:00.000Z", handle: "3z.prod" });
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (url: URL) => unknown;

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const handler = routes[`${init?.method ?? "GET"} ${url.host}${url.pathname}`];
    if (!handler) return json({ error: { message: `unmocked ${url.pathname}` } }, 404);
    const out = await handler(url);
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

const run = (env: Env, f: typeof fetch, path: string, init = {}) =>
  handle(req(path, init), env, undefined, { fetch: f, now: () => NOW });
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

function expectPure(env: Env & { SOCIAL_KV: FakeKV }, f: ReturnType<typeof mockFetch>) {
  expect(env.SOCIAL_KV.writes).toBe(0);
  expect(env.SOCIAL_KV.deletes).toBe(0);
  expect(f.methods().every((m) => m === "GET")).toBe(true);
  for (const u of f.urls()) expect(u.host).toBe("graph.threads.net");
}

async function account(env: Env) {
  const f = mockFetch({ [`GET ${TH}/me`]: () => ({ id: ME, username: "3z.prod" }) });
  const b = await body(await run(env, f, "/social/inbox/threads/account"));
  return { accountId: b.accountId as string, generation: b.generation as string };
}

const q = (a: { accountId: string; generation: string }, cursor?: string) =>
  `?account=${encodeURIComponent(a.accountId)}&generation=${a.generation}${
    cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
  }`;

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  timestamp: "2026-10-16T08:00:00+0000",
  text: `post ${id}`,
  permalink: `https://www.threads.net/@3z.prod/post/${id}`,
  media_type: "TEXT_POST",
  ...over,
});

/** The posts page's first ref, as the dashboard gets it. */
async function refOf(env: Env, a: { accountId: string; generation: string }, id = "90001") {
  const f = mockFetch({ [`GET ${TH}/me/threads`]: () => ({ data: [post(id)] }) });
  const b = await body(await run(env, f, `/social/inbox/threads/posts${q(a)}`));
  return (b.items as { ref: string }[])[0].ref;
}

describe("Threads reads: auth, method, connection", () => {
  it("rejects a missing bearer and a foreign origin on every route before any Threads call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({});
    for (const path of [
      "/social/inbox/threads/account",
      "/social/inbox/threads/posts",
      "/social/inbox/threads/posts/x.y/replies",
    ]) {
      expect((await run(env, f, path, { auth: null })).status).toBe(401);
      expect((await run(env, f, path, { origin: "https://evil.example" })).status).toBe(403);
    }
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("answers only GET, and says not_connected / token_expired with no upstream call and no refresh", async () => {
    const env = makeEnv();
    const f = mockFetch({});
    expect(await body(await run(env, f, "/social/inbox/threads/account"))).toEqual({
      error: "not_connected",
    });
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    const res = await run(env, f, "/social/inbox/threads/account");
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual({ error: "token_expired" });
    for (const method of ["POST", "DELETE", "PUT"])
      expect((await run(env, f, "/social/inbox/threads/posts", { method })).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });
});

describe("GET /social/inbox/threads/account", () => {
  it("returns /me's id as a string, the provider, a provider-bound generation and the replies capability", async () => {
    const env = makeEnv();
    await connect(env, { scope: ANALYTICS });
    const f = mockFetch({
      [`GET ${TH}/me`]: () => ({ id: 2500000000000001, username: "3z.prod" }),
    });
    const b = await body(await run(env, f, "/social/inbox/threads/account"));
    expect(b).toEqual({
      provider: "threads",
      accountId: "2500000000000001",
      handle: "3z.prod",
      generation: expect.stringMatching(/^[0-9a-f]{32}$/),
      capabilities: { replies: "no_permission", sendReplies: "permission_unverified" },
    });
    expect(f.urls()[0].searchParams.get("fields")).toBe("id,username");
    expect(JSON.stringify(b)).not.toContain("th-live-token");
    expectPure(env, f);
  });

  it("reports replies ok only when the stored scope names threads_read_replies", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({ [`GET ${TH}/me`]: () => ({ id: ME }) });
    const b = await body(await run(env, f, "/social/inbox/threads/account"));
    expect(b.capabilities).toEqual({ replies: "ok", sendReplies: "permission_unverified" });
    expect(b.handle).toBeNull();
  });

  it("maps Meta errors: 190 expired, 10 permission, 4 throttled; a /me without id is upstream", async () => {
    const env = makeEnv();
    await connect(env);
    for (const [error, expected] of [
      [{ code: 190, message: "expired" }, "token_expired"],
      [{ code: 10, message: "no" }, "no_permission"],
      [{ code: 4, message: "slow" }, "rate_limited"],
    ] as const) {
      const f = mockFetch({ [`GET ${TH}/me`]: () => json({ error }, 400) });
      expect((await body(await run(env, f, "/social/inbox/threads/account"))).error).toBe(expected);
      expectPure(env, f);
    }
    const f = mockFetch({ [`GET ${TH}/me`]: () => ({ username: "x" }) });
    expect((await body(await run(env, f, "/social/inbox/threads/account"))).error).toBe("upstream");
  });
});

describe("GET /social/inbox/threads/posts", () => {
  it("lists own posts with a sealed ref each, an allowlisted link, and a sealed cursor (never paging.next)", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${TH}/me/threads`]: (u) =>
        u.searchParams.get("after")
          ? { data: [post("90003")] }
          : {
              data: [
                post("90001"),
                post("90002", { permalink: "https://evil.example/p", text: undefined }),
              ],
              paging: { cursors: { after: "QVFIUnext" }, next: "https://evil.example/steal" },
            },
    });
    const res = await run(env, f, `/social/inbox/threads/posts${q(a)}`);
    const b = await body(res);
    expect(res.status).toBe(200);
    expect(b).toMatchObject({ provider: "threads", ...a, coverage: "more" });
    const items = b.items as Record<string, unknown>[];
    expect(items[0]).toEqual({
      id: "90001",
      ref: expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
      text: "post 90001",
      permalink: "https://www.threads.net/@3z.prod/post/90001",
      timestamp: "2026-10-16T08:00:00.000Z",
      mediaType: "TEXT_POST",
    });
    expect(items[1].permalink).toBeUndefined();
    expect(items[1].text).toBeUndefined();
    const u = f.urls()[0];
    expect(u.searchParams.get("fields")).toBe("id,timestamp,text,permalink,media_type");
    expect(u.searchParams.get("limit")).toBe("25");
    const next = await run(env, f, `/social/inbox/threads/posts${q(a, b.next as string)}`);
    expect((await body(next)).coverage).toBe("end");
    expect(f.urls()[1].host).toBe("graph.threads.net");
    expect(f.urls()[1].searchParams.get("after")).toBe("QVFIUnext");
    expectPure(env, f);
  });

  it("refuses Instagram, YouTube, tampered and over-long cursors before any Threads call", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({});
    const ig = await sealCursor(TOKEN, { a: a.accountId, g: a.generation, e: "media", after: "x" });
    const yt = await sealCursorV2(SEAL, {
      p: "youtube",
      a: a.accountId,
      g: a.generation,
      e: "posts",
      after: "x",
    });
    const good = await sealCursorV2(SEAL, {
      p: "threads",
      a: a.accountId,
      g: a.generation,
      e: "posts",
      after: "x",
    });
    for (const c of [ig, yt, `${good}x`, `${"a".repeat(1600)}.b`]) {
      const res = await run(env, f, `/social/inbox/threads/posts${q(a, c)}`);
      expect((await body(res)).error).toBe("cursor_invalid");
    }
    expect(f).not.toHaveBeenCalled();
    // A stale generation (reconnect) is refused too.
    const stale = await run(
      env,
      f,
      `/social/inbox/threads/posts${q({ ...a, generation: "0".repeat(32) })}`,
    );
    expect((await body(stale)).error).toBe("stale");
    expect(f).not.toHaveBeenCalled();
  });

  it("a 200 without a list, or with a row without an id, is unavailable; data: [] is a true end; a later failure is partial", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    for (const reply of [{}, { data: [{ text: "no id" }] }, { data: [post("1"), {}] }]) {
      const f = mockFetch({ [`GET ${TH}/me/threads`]: () => reply });
      const b = await body(await run(env, f, `/social/inbox/threads/posts${q(a)}`));
      expect(b).toMatchObject({ error: "upstream", coverage: "unavailable" });
      expect(b.items).toBeUndefined();
    }
    const empty = mockFetch({ [`GET ${TH}/me/threads`]: () => ({ data: [] }) });
    expect(await body(await run(env, empty, `/social/inbox/threads/posts${q(a)}`))).toMatchObject({
      items: [],
      next: null,
      coverage: "end",
    });
    const c = await sealCursorV2(SEAL, {
      p: "threads",
      a: a.accountId,
      g: a.generation,
      e: "posts",
      after: "x",
    });
    const later = mockFetch({
      [`GET ${TH}/me/threads`]: () => json({ error: { code: 1 } }, 500),
    });
    expect(
      await body(await run(env, later, `/social/inbox/threads/posts${q(a, c)}`)),
    ).toMatchObject({ error: "upstream", coverage: "partial" });
  });

  it("refuses a page over the byte budget before parsing it", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${TH}/me/threads`]: () =>
        new Response(`{"data":[{"id":"1","text":"${"x".repeat(PAGE_BYTES_MAX)}"}]}`),
    });
    expect(await body(await run(env, f, `/social/inbox/threads/posts${q(a)}`))).toMatchObject({
      error: "upstream",
      coverage: "unavailable",
    });
  });

  it("caps a page longer than 25 rows with no cursor", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${TH}/me/threads`]: () => ({
        data: Array.from({ length: 26 }, (_, i) => post(String(i + 1))),
        paging: { cursors: { after: "n" }, next: "https://graph.threads.net/x" },
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/threads/posts${q(a)}`));
    expect(b).toMatchObject({ next: null, coverage: "cap" });
    expect(b.items).toHaveLength(25);
  });
});

describe("GET /social/inbox/threads/posts/:ref/replies", () => {
  const reply = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    text: `reply ${id}`,
    timestamp: "2026-10-16T09:00:00+0000",
    username: "fan_one",
    is_reply_owned_by_me: false,
    root_post: { id: "90001" },
    replied_to: { id: "90001" },
    ...over,
  });

  it("without threads_read_replies says no_permission before any Threads call", async () => {
    const env = makeEnv();
    await connect(env, { scope: ANALYTICS });
    const a = await account(env);
    const ref = await refOf(env, a);
    const f = mockFetch({});
    const res = await run(env, f, `/social/inbox/threads/posts/${ref}/replies${q(a)}`);
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("no_permission");
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("refuses a bare id, a forged ref, another account's ref and a YouTube ref before any Threads call", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({});
    const ref = await refOf(env, a);
    const forged = `${ref.split(".")[0]}.${"A".repeat(43)}`;
    const other = await sealRef(SEAL, {
      p: "threads",
      a: "25000000000000999",
      g: a.generation,
      k: "post",
      id: "90001",
    });
    const youtube = await sealRef(SEAL, {
      p: "youtube",
      a: a.accountId,
      g: a.generation,
      k: "video",
      id: "90001",
    });
    const wrongKind = await sealRef(SEAL, {
      p: "threads",
      a: a.accountId,
      g: a.generation,
      k: "comment",
      id: "90001",
    });
    for (const r of ["90001", forged, other, youtube, wrongKind]) {
      const res = await run(env, f, `/social/inbox/threads/posts/${r}/replies${q(a)}`);
      expect((await body(res)).error).toBe("bad_request");
    }
    const old = await sealRef(SEAL, {
      p: "threads",
      a: a.accountId,
      g: "1".repeat(32),
      k: "post",
      id: "90001",
    });
    expect(
      (await body(await run(env, f, `/social/inbox/threads/posts/${old}/replies${q(a)}`))).error,
    ).toBe("stale");
    expect(f).not.toHaveBeenCalled();
  });

  it("reads the post's direct replies: text, media-only, unknown author, root/parent links and direction", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await refOf(env, a);
    const f = mockFetch({
      [`GET ${TH}/90001/replies`]: () => ({
        data: [
          reply("91001"),
          reply("91002", { text: undefined, username: undefined, is_reply_owned_by_me: undefined }),
          reply("91003", { is_reply_owned_by_me: true, replied_to: { id: "91001" } }),
        ],
        paging: { cursors: { after: "R2" }, next: "https://evil.example/next" },
      }),
    });
    const res = await run(env, f, `/social/inbox/threads/posts/${ref}/replies${q(a)}`);
    const b = await body(res);
    expect(res.status).toBe(200);
    expect(b).toMatchObject({ provider: "threads", ...a, coverage: "more" });
    expect(b.items).toEqual([
      {
        id: "91001",
        text: "reply 91001",
        author: { username: "fan_one" },
        createdAt: "2026-10-16T09:00:00.000Z",
        direction: "in",
        kind: "text",
        rootId: "90001",
        parentId: "90001",
        sendRef: expect.stringMatching(/^[A-Za-z0-9_-]+.[A-Za-z0-9_-]+$/),
      },
      {
        id: "91002",
        text: "",
        author: null,
        createdAt: "2026-10-16T09:00:00.000Z",
        direction: "unknown",
        kind: "media",
        rootId: "90001",
        parentId: "90001",
        sendRef: expect.stringMatching(/^[A-Za-z0-9_-]+.[A-Za-z0-9_-]+$/),
      },
      {
        id: "91003",
        text: "reply 91003",
        author: { username: "fan_one" },
        createdAt: "2026-10-16T09:00:00.000Z",
        direction: "out",
        kind: "text",
        rootId: "90001",
        parentId: "91001",
      },
    ]);
    const u = f.urls()[0];
    expect(u.searchParams.get("fields")).toBe(
      "id,text,timestamp,username,is_reply_owned_by_me,root_post,replied_to",
    );
    expect(u.searchParams.get("reverse")).toBe("false");
    expect(u.searchParams.get("limit")).toBe("25");
    // The next page's cursor is bound to this post: it does not open on another post's replies.
    const ref2 = await refOf(env, a, "90002");
    const f2 = mockFetch({});
    const moved = await run(
      env,
      f2,
      `/social/inbox/threads/posts/${ref2}/replies${q(a, b.next as string)}`,
    );
    expect((await body(moved)).error).toBe("cursor_invalid");
    expect(f2).not.toHaveBeenCalled();
    expectPure(env, f);
  });

  it("DT-6B-2B-1: a send ref only for a direct reply under the owned post; it binds account, generation, root, reply", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await refOf(env, a);
    const f = mockFetch({
      [`GET ${TH}/90001/replies`]: () => ({
        data: [
          reply("91001"),
          reply("91003", { replied_to: { id: "91001" } }),
          reply("91004", { root_post: { id: "90009" } }),
          reply("91005", { root_post: undefined }),
          reply("91006", { replied_to: undefined }),
          reply("91007", { replied_to: { id: "a.b" } }),
        ],
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/threads/posts/${ref}/replies${q(a)}`));
    const rows = b.items as { id: string; sendRef?: string; ref?: string }[];
    expect(rows.filter((r) => r.sendRef).map((r) => r.id)).toEqual(["91001"]);
    expect(await openThreadsSendTarget(SEAL, rows[0].sendRef)).toEqual({
      a: a.accountId,
      g: a.generation,
      r: "90001",
      t: "91001",
    });
    // A send ref is not a read ref and is minted with the server-only key, never the bearer.
    expect(await openThreadsSendTarget(TOKEN, rows[0].sendRef)).toBeNull();
    expect(rows.every((r) => r.ref === undefined)).toBe(true);
    expectPure(env, f);
  });

  it("DT-6B-2B-1: sendReplies stays permission_unverified with every listed scope and canPublish", async () => {
    const env = makeEnv();
    await connect(env, {
      scope: `${READ},threads_content_publish,threads_manage_replies`,
      canPublish: true,
    });
    const f = mockFetch({ [`GET ${TH}/me`]: () => ({ id: ME }) });
    const b = await body(await run(env, f, "/social/inbox/threads/account"));
    expect(b.capabilities).toEqual({ replies: "ok", sendReplies: "permission_unverified" });
    expectPure(env, f);
  });

  it("a later replies page that fails is partial; a malformed first page is unavailable", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await refOf(env, a);
    const bad = mockFetch({ [`GET ${TH}/90001/replies`]: () => ({ data: [{ text: "x" }] }) });
    expect(
      await body(await run(env, bad, `/social/inbox/threads/posts/${ref}/replies${q(a)}`)),
    ).toMatchObject({ error: "upstream", coverage: "unavailable" });
    const c = await sealCursorV2(SEAL, {
      p: "threads",
      a: a.accountId,
      g: a.generation,
      e: "replies",
      r: "90001",
      after: "R2",
    });
    const later = mockFetch({
      [`GET ${TH}/90001/replies`]: () => json({ error: { code: 4 } }, 429),
    });
    expect(
      await body(await run(env, later, `/social/inbox/threads/posts/${ref}/replies${q(a, c)}`)),
    ).toMatchObject({ error: "rate_limited", coverage: "partial" });
    expectPure(env, later);
  });
});

describe("provider separation", () => {
  it("a Threads cursor never opens on the Instagram reader, and generations differ for the same id", async () => {
    const env = makeEnv();
    await connect(env);
    const store = Store.from(env)!;
    await store.putTokens("instagram", {
      accessToken: "ig-live-token",
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      scope: "instagram_business_manage_comments,instagram_business_manage_messages",
    });
    await store.putStatus("instagram", { connectedAt: "2026-10-01T08:00:00.000Z" });
    env.SOCIAL_KV.writes = 0;
    const meIg = mockFetch({
      "GET graph.instagram.com/v21.0/me": () => ({ user_id: ME, username: "3z.prod" }),
    });
    const ig = await body(await run(env, meIg, "/social/inbox/account"));
    const th = await account(env);
    expect(ig.accountId).toBe(th.accountId);
    expect(ig.generation).not.toBe(th.generation);
    const v2 = await sealCursorV2(TOKEN, {
      p: "threads",
      a: ME,
      g: ig.generation as string,
      e: "media",
      after: "x",
    });
    const f = mockFetch({});
    const res = await run(
      env,
      f,
      `/social/inbox/media${q({ accountId: ME, generation: ig.generation as string }, v2)}`,
    );
    expect((await body(res)).error).toBe("cursor_invalid");
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });
});

describe("Threads path safety", () => {
  it("a sealed post ref whose id is not a plain path id is refused before any call", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const dotted = await sealRef(SEAL, {
      p: "threads",
      a: a.accountId,
      g: a.generation,
      k: "post",
      id: "..",
    });
    const f = mockFetch({});
    const res = await run(env, f, `/social/inbox/threads/posts/${dotted}/replies${q(a)}`);
    expect((await body(res)).error).toBe("bad_request");
    expect(f).not.toHaveBeenCalled();
  });
});

/** An independent WebCrypto client (no product helper): HMAC-SHA256 under `key`, then `<domain>|<body>` signed. */
async function forge(payload: object, key: Uint8Array, domain = "ref2"): Promise<string> {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${domain}|${body}`));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

/** Every key a bearer holder could derive: the DT-6B-1 scheme, the raw bearer, and the R1 derivation over it. */
async function bearerKeys(provider: string): Promise<Uint8Array[]> {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.importKey(
    "raw",
    enc.encode(TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.sign("HMAC", raw, enc.encode(`inbox-seal-v1|${provider}`)),
  );
  return [enc.encode(`3z-scout/inbox-read-v2|${TOKEN}`), enc.encode(TOKEN), derived];
}

describe("DT-6B-1-R1 B1-1: ownership receipts need the server-only seal key", () => {
  it("a post ref or cursor forged with the bearer and the real generation is refused before any Threads call", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({});
    for (const key of await bearerKeys("threads")) {
      const ref = await forge(
        { p: "threads", a: a.accountId, g: a.generation, k: "post", id: "FOREIGNpost" },
        key,
      );
      const res = await run(env, f, `/social/inbox/threads/posts/${ref}/replies${q(a)}`);
      expect(res.status).toBe(400);
      expect((await body(res)).error).toBe("bad_request");
      const cursor = await forge(
        { p: "threads", a: a.accountId, g: a.generation, e: "posts", after: "x" },
        key,
        "cursor2",
      );
      const c = await run(env, f, `/social/inbox/threads/posts${q(a, cursor)}`);
      expect((await body(c)).error).toBe("cursor_invalid");
    }
    expect(f).not.toHaveBeenCalled();
    expectPure(env, f);
  });

  it("a genuine ref from the posts list still opens its replies", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await refOf(env, a);
    const f = mockFetch({ [`GET ${TH}/90001/replies`]: () => ({ data: [] }) });
    const res = await run(env, f, `/social/inbox/threads/posts/${ref}/replies${q(a)}`);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("without a usable seal secret (missing, short, or the bearer itself) every route is 503 not_configured, no call", async () => {
    for (const secret of [undefined, "", "short-secret", TOKEN]) {
      const env = { ...makeEnv(), INBOX_SEAL_SECRET: secret };
      await connect(env);
      const f = mockFetch({ [`GET ${TH}/me`]: () => ({ id: ME, username: "3z.prod" }) });
      const qs = `?account=${ME}&generation=${"a".repeat(32)}`;
      for (const path of [
        "/social/inbox/threads/account",
        `/social/inbox/threads/posts${qs}`,
        `/social/inbox/threads/posts/x.y/replies${qs}`,
      ]) {
        const res = await run(env, f, path);
        expect(res.status).toBe(503);
        expect(await body(res)).toEqual({ error: "not_configured" });
      }
      expect(f).not.toHaveBeenCalled();
      expectPure(env, f);
    }
  });

  it("the seal secret never appears in an answer, success or failure", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await refOf(env, a);
    const f = mockFetch({
      [`GET ${TH}/me`]: () => ({ id: ME, username: "3z.prod" }),
      [`GET ${TH}/me/threads`]: () => ({
        data: [post("90001")],
        paging: { cursors: { after: "N" }, next: "x" },
      }),
      [`GET ${TH}/90001/replies`]: () =>
        json({ error: { code: 1, message: `boom ${SEAL} th-live-token` } }, 500),
    });
    const seen: string[] = [];
    for (const path of [
      "/social/inbox/threads/account",
      `/social/inbox/threads/posts${q(a)}`,
      `/social/inbox/threads/posts/${ref}/replies${q(a)}`,
      `/social/inbox/threads/posts/nope/replies${q(a)}`,
    ])
      seen.push(await (await run(env, f, path)).text());
    expect(seen).toHaveLength(4);
    for (const text of seen) {
      expect(text).not.toContain(SEAL);
      expect(text).not.toContain(TOKEN);
    }
  });
});

describe("DT-6B-1-R1 B1-4: ids follow the id grammar, so every emitted ref is usable", () => {
  it("a fractional, unsafe or path-unsafe id makes the page malformed; a safe integer or plain string round-trips", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    for (const bad of [123.5, 2 ** 53, -0.5, 1e21, "a.b", "..", true, null]) {
      const f = mockFetch({ [`GET ${TH}/me/threads`]: () => ({ data: [{ id: bad, text: "x" }] }) });
      const b = await body(await run(env, f, `/social/inbox/threads/posts${q(a)}`));
      expect(b).toMatchObject({ error: "upstream", coverage: "unavailable" });
    }
    for (const good of [90001, "90002", "a-b_c"]) {
      const list = mockFetch({
        [`GET ${TH}/me/threads`]: () => ({ data: [{ id: good, text: "x" }] }),
      });
      const b = await body(await run(env, list, `/social/inbox/threads/posts${q(a)}`));
      const [row] = b.items as { id: string; ref: string }[];
      expect(row.id).toBe(String(good));
      const replies = mockFetch({ [`GET ${TH}/${String(good)}/replies`]: () => ({ data: [] }) });
      const res = await run(env, replies, `/social/inbox/threads/posts/${row.ref}/replies${q(a)}`);
      expect(res.status).toBe(200);
      expect(replies).toHaveBeenCalledTimes(1);
    }
  });

  it("a reply whose id is fractional is malformed too (the whole page fails)", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await refOf(env, a);
    const f = mockFetch({
      [`GET ${TH}/90001/replies`]: () => ({ data: [{ id: 1.5, text: "x" }] }),
    });
    expect(
      await body(await run(env, f, `/social/inbox/threads/posts/${ref}/replies${q(a)}`)),
    ).toMatchObject({ error: "upstream", coverage: "unavailable" });
  });
});
