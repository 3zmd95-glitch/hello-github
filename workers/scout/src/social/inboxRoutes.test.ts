import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import {
  InboxDb,
  PAGE,
  type CommentRow,
  type ConversationRow,
  type MessageRow,
  type PostRow,
  type SendRow,
  type Sql,
} from "./inboxDb";
import { REFRESH_RETRY_MS } from "./inboxRoutes";
import { DM_TEXT_BYTES, IG_COMMENT_MAX } from "./replyCore";
import { Store } from "./store";
import type { SocialPlatform, TokenSet } from "./types";

/* ---------- fakes (copied from replies.test.ts and inboxDb.test.ts) ---------- */

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-22T12:00:00Z");

type FakeKV = KVNamespace & { store: Map<string, string>; writes: number; written: string[] };

function fakeKV(): FakeKV {
  const store = new Map<string, string>();
  const kv = {
    store,
    writes: 0,
    written: [] as string[],
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.writes += 1;
      kv.written.push(key);
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  };
  return kv as unknown as FakeKV;
}

function makeEnv(kv: FakeKV = fakeKV()): Env & { SOCIAL_KV: FakeKV } {
  return {
    SCOUT_TOKEN: TOKEN,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: kv,
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    TIKTOK_CLIENT_KEY: "tt-key",
    TIKTOK_CLIENT_SECRET: "tt-secret",
  };
}

/** A request with the bearer and the dashboard's origin; `{ method: "POST" }` and the rest of RequestInit pass through. */
function req(path: string, init: RequestInit & { json?: unknown } = {}): Request {
  const { json: body, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", `Bearer ${TOKEN}`);
  headers.set("Origin", APP);
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    rest.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

async function connect(env: Env, platform: SocialPlatform, tokens: Partial<TokenSet> = {}) {
  const store = Store.from(env)!;
  await store.putTokens(platform, {
    accessToken: `${platform}-token`,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: platform === "instagram" ? "178" : undefined,
    canPublish: true,
    canReply: platform === "instagram",
    ...tokens,
  });
  await store.putStatus(platform, { connectedAt: NOW.toISOString(), handle: "3z.prod" });
}

type Handler = (url: URL, init: RequestInit | undefined) => unknown;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Routes by method + host + path; handlers may be async; unmocked calls answer 404. */
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
  const calls = () =>
    fn.mock.calls.map(([input, init]) => {
      const u = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      return `${init?.method ?? "GET"} ${u.host}${u.pathname}`;
    });
  return Object.assign(fn, { calls });
}

function nodeSql(): Sql | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    return { all: (q, ...b) => db.prepare(q).all(...b) as never, run: (ddl) => db.exec(ddl) };
  } catch {
    return null;
  }
}
// Each test gets its own in-memory database; `available` only decides whether node:sqlite loads (Node 22 needs --experimental-sqlite).
const available = nodeSql() !== null;
const freshDb = () => new InboxDb(nodeSql()!);

const conv = (id: string, updatedAt: string): ConversationRow => ({
  platform: "instagram",
  id,
  peerId: `p${id}`,
  peerName: `peer ${id}`,
  updatedAt,
  lastText: "hi",
  lastFrom: "peer",
  windowClosesAt: null,
  answeredBy: null,
});

/** The store is injected through `deps.inboxApi`; `now` is fixed at NOW unless a test says otherwise. */
const depsOf = (api?: InboxDb, now: Date = NOW) => ({
  fetch: mockFetch({}),
  now: () => now,
  inboxApi: api,
});

/** The first `failures` KV writes throw as Cloudflare does (429); `attempts` counts every put. */
function flakyPuts(kv: FakeKV, failures: number): { attempts: number } {
  const state = { attempts: 0 };
  const put = kv.put.bind(kv);
  kv.put = async (key: string, value: string) => {
    state.attempts += 1;
    if (state.attempts <= failures) throw new Error("KV PUT failed: 429 Too Many Requests");
    return put(key, value);
  };
  return state;
}

const minute = (i: number) => new Date(Date.UTC(2026, 9, 21, 0, i)).toISOString();
const pad = (prefix: string, i: number) => `${prefix}${String(i).padStart(2, "0")}`;
const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);

type Listed = { more: boolean; next: string | null } & Record<string, unknown>;
const getJson = async (env: Env, deps: ReturnType<typeof depsOf>, path: string) =>
  (await (await handle(req(path), env, undefined, deps)).json()) as Listed;

/** One thread of PAGE + 1 messages, PAGE + 1 posts and PAGE + 1 comments on post p00, all one minute apart. */
async function pagedStore() {
  const api = freshDb();
  const each = Array.from({ length: PAGE + 1 }, (_, i) => i);
  const messages: MessageRow[] = each.map((i) => ({
    platform: "instagram",
    convId: "t1",
    id: pad("m", i),
    at: minute(i),
    fromPeer: true,
    text: pad("m", i),
    kind: "text",
    sentBy: "peer",
  }));
  const posts: PostRow[] = each.map((i) => ({
    platform: "instagram",
    id: pad("p", i),
    permalink: "",
    thumbUrl: null,
    caption: pad("p", i),
    postedAt: minute(i),
    commentCount: 0,
  }));
  const comments: CommentRow[] = each.map((i) => ({
    platform: "instagram",
    postId: "p00",
    id: pad("c", i),
    parentId: null,
    at: minute(i),
    author: "ali",
    authorId: null,
    text: pad("c", i),
    hidden: false,
    ours: false,
    sentBy: null,
  }));
  await api.ingest({ conversations: [conv("t1", minute(0))], messages, posts, comments });
  return { env: makeEnv(), deps: depsOf(api) };
}

/* ---------- /social/inbox/* ---------- */

describe.skipIf(!available)("/social/inbox routes", () => {
  it("overview reports the connection and store state", async () => {
    const env = makeEnv();
    const api = freshDb();
    await connect(env, "instagram", {
      accessToken: "tok",
      issuedAt: "2026-10-22T00:00:00Z",
      canReply: true,
    });
    await api.setMeta("lastReadAt:instagram", "2026-10-22T12:00:00.000Z");
    await api.ingest({ conversations: [conv("t1", "2026-10-22T10:00:00.000Z")] });

    const res = await handle(req("/social/inbox"), env, undefined, depsOf(api));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      platforms: {
        instagram: {
          connected: true,
          canReply: true,
          tokenExpired: false,
          lastReadAt: "2026-10-22T12:00:00.000Z",
          newestAt: "2026-10-22T10:00:00.000Z",
        },
        tiktok: {
          connected: false,
          canReply: false,
          tokenExpired: false,
          lastReadAt: null,
          newestAt: null,
        },
      },
      counts: { conversations: 1, posts: 0, comments: 0 },
    });
  });

  it("overview says connected: false without tokens and tokenExpired once the token has lapsed", async () => {
    const api = freshDb();
    const bare = await handle(req("/social/inbox"), makeEnv(), undefined, depsOf(api));
    expect(await bare.json()).toMatchObject({
      platforms: { instagram: { connected: false, canReply: false, tokenExpired: false } },
    });

    const env = makeEnv();
    await connect(env, "instagram", { expiresAt: "2026-10-21T00:00:00Z", canReply: false });
    const lapsed = await handle(req("/social/inbox"), env, undefined, depsOf(api));
    expect(await lapsed.json()).toMatchObject({
      platforms: { instagram: { connected: true, canReply: false, tokenExpired: true } },
    });
  });

  it("lists conversations, a thread with its window, posts and comments; unknown ids are 404", async () => {
    const env = makeEnv();
    const api = freshDb();
    await api.ingest({
      conversations: [
        {
          platform: "instagram",
          id: "t1",
          peerId: "9",
          peerName: "sara",
          updatedAt: "2026-10-22T10:00:00.000Z",
          lastText: "hi",
          lastFrom: "peer",
          windowClosesAt: "2026-10-22T11:00:00.000Z",
          answeredBy: null,
        },
      ],
      messages: [
        {
          platform: "instagram",
          convId: "t1",
          id: "m1",
          at: "2026-10-22T10:00:00.000Z",
          fromPeer: true,
          text: "hi",
          kind: "text",
          sentBy: "peer",
        },
      ],
      posts: [
        {
          platform: "instagram",
          id: "p1",
          permalink: "",
          thumbUrl: null,
          caption: "LUT",
          postedAt: "2026-10-20T00:00:00.000Z",
          commentCount: 1,
        },
      ],
      comments: [
        {
          platform: "instagram",
          postId: "p1",
          id: "c1",
          parentId: null,
          at: "2026-10-21T00:00:00.000Z",
          author: "ali",
          authorId: null,
          text: "لت",
          hidden: false,
          ours: false,
          sentBy: null,
        },
      ],
    });
    const deps = depsOf(api);
    const get = async (path: string) => handle(req(path), env, undefined, deps);

    const conversations = await get("/social/inbox/conversations?platform=instagram");
    expect(conversations.status).toBe(200);
    expect(await conversations.json()).toEqual({
      conversations: [expect.objectContaining({ id: "t1", peerName: "sara" })],
      more: false,
      next: null,
    });

    // 12:00 is past the window's close at 11:00.
    const thread = await get("/social/inbox/conversations/t1");
    expect(thread.status).toBe(200);
    expect(await thread.json()).toMatchObject({
      conversation: { id: "t1" },
      messages: [{ id: "m1", fromPeer: true, text: "hi" }],
      more: false,
      next: null,
      window: { open: false, closesAt: "2026-10-22T11:00:00.000Z" },
    });
    const open = await handle(
      req("/social/inbox/conversations/t1"),
      env,
      undefined,
      depsOf(api, new Date("2026-10-22T10:30:00Z")),
    );
    expect(await open.json()).toMatchObject({
      window: { open: true, closesAt: "2026-10-22T11:00:00.000Z" },
    });

    const missing = await get("/social/inbox/conversations/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });

    const posts = await get("/social/inbox/posts");
    expect(posts.status).toBe(200);
    expect(await posts.json()).toMatchObject({ posts: [{ id: "p1" }], more: false, next: null });

    const comments = await get("/social/inbox/posts/instagram/p1/comments");
    expect(comments.status).toBe(200);
    expect(await comments.json()).toMatchObject({
      post: { id: "p1", caption: "LUT" },
      comments: [{ id: "c1", author: "ali", hidden: false }],
      more: false,
      next: null,
    });

    const noPost = await get("/social/inbox/posts/instagram/nope/comments");
    expect(noPost.status).toBe(404);
    expect(await noPost.json()).toEqual({ error: "not_found" });
  });

  it("hands the cursor through opaque: next of one page is before of the next", async () => {
    const env = makeEnv();
    const api = freshDb();
    const all = Array.from({ length: PAGE + 1 }, (_, i) =>
      conv(`c${String(i).padStart(2, "0")}`, new Date(Date.UTC(2026, 9, 22, 0, i)).toISOString()),
    );
    await api.ingest({ conversations: all });
    const deps = depsOf(api);

    const first = (await (
      await handle(req("/social/inbox/conversations"), env, undefined, deps)
    ).json()) as { conversations: { id: string }[]; more: boolean; next: string };
    expect(first.conversations).toHaveLength(PAGE);
    expect(first.conversations[0].id).toBe(`c${String(PAGE).padStart(2, "0")}`);
    expect(first.more).toBe(true);
    // The DB's cursor, "<updatedAt>|<id>", of the last (oldest) row on the page.
    expect(first.next).toBe(`${all[1].updatedAt}|${all[1].id}`);

    const second = await handle(
      req(`/social/inbox/conversations?before=${encodeURIComponent(first.next)}`),
      env,
      undefined,
      deps,
    );
    expect(await second.json()).toEqual({
      conversations: [expect.objectContaining({ id: "c00" })],
      more: false,
      next: null,
    });
  });

  it("refresh writes inbox:scan once and wipe empties the store", async () => {
    const env = makeEnv();
    const api = freshDb();
    const deps = depsOf(api);

    const refresh = await handle(
      req("/social/inbox/refresh", { method: "POST" }),
      env,
      undefined,
      deps,
    );
    expect(refresh.status).toBe(200);
    expect(await refresh.json()).toEqual({ scanRequestedAt: "2026-10-22T12:00:00.000Z" });
    expect(env.SOCIAL_KV.written).toEqual(["inbox:scan"]);
    expect(env.SOCIAL_KV.store.get("inbox:scan")).toBe("2026-10-22T12:00:00.000Z");

    await api.ingest({
      conversations: [conv("t1", "2026-10-22T10:00:00.000Z")],
      posts: [
        {
          platform: "instagram",
          id: "p1",
          permalink: "",
          thumbUrl: null,
          caption: "",
          postedAt: "2026-10-20T00:00:00.000Z",
          commentCount: 1,
        },
      ],
      comments: [
        {
          platform: "instagram",
          postId: "p1",
          id: "c1",
          parentId: null,
          at: "2026-10-21T00:00:00.000Z",
          author: "ali",
          authorId: null,
          text: "hi",
          hidden: false,
          ours: false,
          sentBy: null,
        },
      ],
      readAt: { platform: "instagram", at: "2026-10-22T11:59:00.000Z" },
    });
    const before = await api.overview();
    expect(before.counts).toEqual({ conversations: 1, posts: 1, comments: 1 });
    expect(before.platforms.instagram.lastReadAt).toBe("2026-10-22T11:59:00.000Z");

    const wipe = await handle(req("/social/inbox", { method: "DELETE" }), env, undefined, deps);
    expect(wipe.status).toBe(200);
    expect(await wipe.json()).toEqual({ ok: true });
    const after = await api.overview();
    expect(after.counts).toEqual({ conversations: 0, posts: 0, comments: 0 });
    expect(after.platforms.instagram.lastReadAt).toBeNull();
  });

  it("retries a refused inbox:scan write once, after REFRESH_RETRY_MS", async () => {
    vi.useFakeTimers();
    try {
      const env = makeEnv();
      const puts = flakyPuts(env.SOCIAL_KV, 1);
      let settled = false;
      const pending = handle(
        req("/social/inbox/refresh", { method: "POST" }),
        env,
        undefined,
        depsOf(freshDb()),
      ).finally(() => (settled = true));

      await vi.advanceTimersByTimeAsync(REFRESH_RETRY_MS - 1);
      expect(puts.attempts).toBe(1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const res = await pending;
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ scanRequestedAt: "2026-10-22T12:00:00.000Z" });
      expect(puts.attempts).toBe(2);
      expect(env.SOCIAL_KV.written).toEqual(["inbox:scan"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers upstream when the retried inbox:scan write is refused too", async () => {
    vi.useFakeTimers();
    try {
      const env = makeEnv();
      const puts = flakyPuts(env.SOCIAL_KV, 2);
      const pending = handle(
        req("/social/inbox/refresh", { method: "POST" }),
        env,
        undefined,
        depsOf(freshDb()),
      );
      await vi.advanceTimersByTimeAsync(REFRESH_RETRY_MS);

      const res = await pending;
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream" });
      expect(puts.attempts).toBe(2);
      expect(env.SOCIAL_KV.written).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers upstream, as JSON with the CORS headers, when the store or the KV throws", async () => {
    const env = makeEnv();
    const api = freshDb();
    vi.spyOn(api, "overview").mockRejectedValue(new Error("storage unavailable"));
    const storeDown = await handle(req("/social/inbox"), env, undefined, depsOf(api));
    expect(storeDown.status).toBe(502);
    expect(storeDown.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(storeDown.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await storeDown.json()).toEqual({ error: "upstream" });

    // The token read (KV) failing is the same answer.
    const kvEnv = makeEnv();
    kvEnv.SOCIAL_KV.get = (async () => {
      throw new Error("KV GET failed");
    }) as never;
    const kvDown = await handle(req("/social/inbox"), kvEnv, undefined, depsOf(freshDb()));
    expect(kvDown.status).toBe(502);
    expect(kvDown.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await kvDown.json()).toEqual({ error: "upstream" });
  });

  it("pages a thread with its cursor: next reaches older messages, each page is oldest first", async () => {
    const { env, deps } = await pagedStore();
    const path = "/social/inbox/conversations/t1";

    const first = await getJson(env, deps, path);
    expect(ids(first.messages)).toEqual(Array.from({ length: PAGE }, (_, k) => pad("m", k + 1)));
    expect(first.more).toBe(true);
    expect(first.next).toBe(`${minute(1)}|${pad("m", 1)}`);

    const second = await getJson(env, deps, `${path}?before=${encodeURIComponent(first.next!)}`);
    expect(ids(second.messages)).toEqual([pad("m", 0)]);
    expect(second.more).toBe(false);
    expect(second.next).toBeNull();
  });

  it("pages posts with their cursor, newest first", async () => {
    const { env, deps } = await pagedStore();

    const first = await getJson(env, deps, "/social/inbox/posts");
    expect(ids(first.posts)).toEqual(Array.from({ length: PAGE }, (_, k) => pad("p", PAGE - k)));
    expect(first.more).toBe(true);
    expect(first.next).toBe(`${minute(1)}|${pad("p", 1)}`);

    const second = await getJson(
      env,
      deps,
      `/social/inbox/posts?before=${encodeURIComponent(first.next!)}`,
    );
    expect(ids(second.posts)).toEqual([pad("p", 0)]);
    expect(second.more).toBe(false);
    expect(second.next).toBeNull();
  });

  it("pages a post's comments with their cursor, newest first", async () => {
    const { env, deps } = await pagedStore();
    const path = "/social/inbox/posts/instagram/p00/comments";

    const first = await getJson(env, deps, path);
    expect(ids(first.comments)).toEqual(Array.from({ length: PAGE }, (_, k) => pad("c", PAGE - k)));
    expect(first.more).toBe(true);
    expect(first.next).toBe(`${minute(1)}|${pad("c", 1)}`);

    const second = await getJson(env, deps, `${path}?before=${encodeURIComponent(first.next!)}`);
    expect(ids(second.comments)).toEqual([pad("c", 0)]);
    expect(second.more).toBe(false);
    expect(second.next).toBeNull();
  });

  it("answers not_available without the binding and bad_request for a bad platform", async () => {
    const env = makeEnv();

    const overview = await handle(req("/social/inbox"), env, undefined, depsOf());
    expect(overview.status).toBe(503);
    expect(await overview.json()).toEqual({ error: "not_available" });
    // Every route, writes included, answers the same and touches nothing.
    const refresh = await handle(
      req("/social/inbox/refresh", { method: "POST" }),
      env,
      undefined,
      depsOf(),
    );
    expect(refresh.status).toBe(503);
    expect(env.SOCIAL_KV.written).toEqual([]);

    const api = freshDb();
    for (const path of [
      "/social/inbox/conversations?platform=x",
      "/social/inbox/posts?platform=facebook",
    ]) {
      const bad = await handle(req(path), env, undefined, depsOf(api));
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: "bad_request" });
    }
    // `all` and `tiktok` are valid platform values.
    for (const platform of ["all", "tiktok"]) {
      const ok = await handle(
        req(`/social/inbox/conversations?platform=${platform}`),
        env,
        undefined,
        depsOf(api),
      );
      expect(ok.status).toBe(200);
    }
  });

  it("leaves other methods and malformed ids to the router's 404", async () => {
    const env = makeEnv();
    const deps = depsOf(freshDb());
    for (const [path, method] of [
      ["/social/inbox", "POST"],
      ["/social/inbox/conversations", "DELETE"],
      ["/social/inbox/refresh", "GET"],
      ["/social/inbox/conversations/bad%20id", "GET"],
      ["/social/inbox/posts/youtube/p1/comments", "GET"],
      ["/social/inbox/nothing", "GET"],
      ["/social/inbox/conversations/t1", "POST"],
      ["/social/inbox/conversations/t1/send", "GET"],
      ["/social/inbox/conversations/t1/send", "DELETE"],
      ["/social/inbox/conversations/bad%20id/send", "POST"],
      ["/social/inbox/comments/instagram/c1/reply", "GET"],
      ["/social/inbox/comments/instagram/c1/reply", "DELETE"],
      ["/social/inbox/comments/instagram/c1/nope", "POST"],
      ["/social/inbox/comments/instagram/c1", "POST"],
      ["/social/inbox/comments/tiktok/c1/reply", "POST"],
      ["/social/inbox/comments/tiktok/c1", "DELETE"],
      ["/social/inbox/comments/instagram/bad%20id", "DELETE"],
    ] as const) {
      const res = await handle(req(path, { method }), env, undefined, deps);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(env.SOCIAL_KV.written).toEqual([]);
  });

  it("is behind the bearer like the rest of /social", async () => {
    const env = makeEnv();
    const res = await handle(
      new Request(`${BASE}/social/inbox`, { headers: { Origin: APP } }),
      env,
      undefined,
      depsOf(freshDb()),
    );
    expect(res.status).toBe(401);
  });
});

/* ---------- the send routes: DM, public reply, private reply, hide, delete ---------- */

const GRAPH = "graph.instagram.com/v21.0";
const DM_URL = `POST ${GRAPH}/178/messages`;
const ME_URL = `GET ${GRAPH}/me`;
/** Their window closes an hour after NOW; `t2` closed an hour before; `t3` has no known window. */
const OPEN_UNTIL = "2026-10-22T13:00:00.000Z";
const CLOSED_AT = "2026-10-22T11:00:00.000Z";
const SENT_AT = NOW.toISOString();

/** A fixed Graph answer, a fresh Response per call. */
const ans =
  (body: unknown, status = 200): Handler =>
  () =>
    json(body, status);
const sentBody = (init: RequestInit | undefined) => JSON.parse(String(init?.body));
const posted = (path: string, json: unknown) => req(path, { method: "POST", json });

/**
 * A connected account (token "instagram-token", account id 178, handle 3z.prod), an open conversation t1 with peer 9,
 * a closed one t2 and one without a window t3, and post p1 with comment c1 (theirs) and c2 (ours, a reply to c1).
 * `graph` answers the send calls; `/me` always answers. KV writes made while connecting are forgotten.
 */
async function sendWorld(graph: Record<string, Handler | object> = {}) {
  const sql = nodeSql()!;
  const api = new InboxDb(sql);
  const env = makeEnv();
  await connect(env, "instagram");
  env.SOCIAL_KV.written.length = 0;
  await api.ingest({
    conversations: [
      { ...conv("t1", "2026-10-22T11:30:00.000Z"), peerId: "9", windowClosesAt: OPEN_UNTIL },
      { ...conv("t2", "2026-10-22T09:00:00.000Z"), peerId: "8", windowClosesAt: CLOSED_AT },
      { ...conv("t3", "2026-10-22T08:00:00.000Z"), peerId: "7" },
    ],
    posts: [
      {
        platform: "instagram",
        id: "p1",
        permalink: "",
        thumbUrl: null,
        caption: "LUT",
        postedAt: "2026-10-20T00:00:00.000Z",
        commentCount: 2,
      },
    ],
    comments: [
      {
        platform: "instagram",
        postId: "p1",
        id: "c1",
        parentId: null,
        at: "2026-10-21T00:00:00.000Z",
        author: "ali",
        authorId: "55",
        text: "لت",
        hidden: false,
        ours: false,
        sentBy: null,
      },
      {
        platform: "instagram",
        postId: "p1",
        id: "c2",
        parentId: "c1",
        at: "2026-10-21T01:00:00.000Z",
        author: "3z.prod",
        authorId: "178",
        text: "هلا",
        hidden: false,
        ours: true,
        sentBy: "owner",
      },
    ],
  });
  const answers = { [ME_URL]: { user_id: "178", username: "3z.prod" }, ...graph };
  const fetch = mockFetch(
    Object.fromEntries(
      Object.entries(answers).map(([key, v]) => [
        key,
        typeof v === "function" ? (v as Handler) : ans(v),
      ]),
    ),
  );
  const deps = { fetch, now: () => NOW, inboxApi: api };
  return {
    api,
    env,
    fetch,
    call: (request: Request) => handle(request, env, undefined, deps),
    sends: () => sql.all<SendRow>("SELECT * FROM sends ORDER BY seq"),
    comment: (id: string) => api.comment("instagram", id),
    thread: (id: string) => api.thread("instagram", id, {}),
  };
}

type SendWorld = Awaited<ReturnType<typeof sendWorld>>;

/** Sends through the world with the store's writes failing as after a Durable Object reset; `logged` counts the faults. */
async function sendWithStoreDown(w: SendWorld, request: Request) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const down = Object.create(w.api, {
      ingest: { value: async () => Promise.reject(new Error("object reset")) },
      recordSend: { value: async () => Promise.reject(new Error("object reset")) },
    });
    const res = await handle(request, w.env, undefined, {
      fetch: w.fetch,
      now: () => NOW,
      inboxApi: down,
    });
    return { res, logged: log.mock.calls.length };
  } finally {
    log.mockRestore();
  }
}

describe.skipIf(!available)("/social/inbox send routes", () => {
  it("sends a DM to the conversation's person and stores it as the owner's last message", async () => {
    let seen: RequestInit | undefined;
    const w = await sendWorld({
      [DM_URL]: (_url, init) => {
        seen = init;
        return { recipient_id: "9", message_id: "mid.1" };
      },
    });

    const res = await w.call(posted("/social/inbox/conversations/t1/send", { text: "  hi  " }));

    expect(res.status).toBe(200);
    const message: MessageRow = {
      platform: "instagram",
      convId: "t1",
      id: "mid.1",
      at: SENT_AT,
      fromPeer: false,
      text: "hi",
      kind: "text",
      sentBy: "owner",
    };
    expect(await res.json()).toEqual({ message });
    expect(sentBody(seen)).toEqual({ recipient: { id: "9" }, message: { text: "hi" } });
    expect(seen?.headers).toMatchObject({ Authorization: "Bearer instagram-token" });
    expect(w.fetch.calls()).toEqual([ME_URL, DM_URL]);

    const stored = await w.thread("t1");
    expect(stored?.messages.items).toEqual([message]);
    expect(stored?.conversation).toMatchObject({
      peerId: "9",
      lastText: "hi",
      lastFrom: "owner",
      updatedAt: SENT_AT,
      windowClosesAt: OPEN_UNTIL,
    });
    expect(w.sends()).toEqual([
      {
        seq: 1,
        platform: "instagram",
        kind: "dm",
        targetId: "t1",
        text: "hi",
        at: SENT_AT,
        state: "sent",
        platformId: "mid.1",
        detail: null,
      },
    ]);
  });

  it("answers window_closed without a call when the window is closed, unknown or closes right now", async () => {
    const w = await sendWorld();
    await w.api.ingest({
      conversations: [{ ...conv("t4", "2026-10-22T08:00:00.000Z"), windowClosesAt: SENT_AT }],
    });
    for (const id of ["t2", "t3", "t4"]) {
      const res = await w.call(posted(`/social/inbox/conversations/${id}/send`, { text: "hi" }));
      expect(res.status, id).toBe(409);
      expect(await res.json(), id).toEqual({ error: "window_closed" });
    }
    expect(w.fetch.calls()).toEqual([]);
    expect(w.sends()).toEqual([]);
  });

  it("answers too_long without a call: a DM and a private reply count UTF-8 bytes, a public reply characters", async () => {
    const w = await sendWorld();
    const arabic = "ل".repeat(DM_TEXT_BYTES / 2 + 1); // 501 letters, 1,002 bytes
    for (const [path, text] of [
      ["/social/inbox/conversations/t1/send", "a".repeat(DM_TEXT_BYTES + 1)],
      ["/social/inbox/conversations/t1/send", arabic],
      ["/social/inbox/comments/instagram/c1/private", "a".repeat(DM_TEXT_BYTES + 1)],
      ["/social/inbox/comments/instagram/c1/private", arabic],
      ["/social/inbox/comments/instagram/c1/reply", "a".repeat(IG_COMMENT_MAX + 1)],
    ]) {
      const res = await w.call(posted(path, { text }));
      expect(res.status, `${path} ${text.length}`).toBe(400);
      expect(await res.json()).toEqual({ error: "too_long" });
    }
    expect(w.fetch.calls()).toEqual([]);
    expect(w.sends()).toEqual([]);
  });

  it("accepts the limits themselves: 1,000 bytes of DM, and 2,200 characters of public reply", async () => {
    const w = await sendWorld({
      [DM_URL]: { message_id: "mid.2" },
      [`POST ${GRAPH}/c1/replies`]: { id: "r1" },
    });
    const dm = await w.call(
      posted("/social/inbox/conversations/t1/send", { text: "ل".repeat(DM_TEXT_BYTES / 2) }),
    );
    expect(dm.status).toBe(200);
    const reply = await w.call(
      posted("/social/inbox/comments/instagram/c1/reply", { text: "a".repeat(IG_COMMENT_MAX) }),
    );
    expect(reply.status).toBe(200);
  });

  it("answers bad_request without a call for a blank, missing or malformed text and a hide without hidden", async () => {
    const w = await sendWorld();
    const bad = async (path: string, init: { json?: unknown; body?: string }) => {
      const res = await w.call(req(path, { method: "POST", ...init }));
      expect(res.status, path).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    };
    for (const path of [
      "/social/inbox/conversations/t1/send",
      "/social/inbox/comments/instagram/c1/reply",
      "/social/inbox/comments/instagram/c1/private",
    ]) {
      await bad(path, { json: { text: " \n " } });
      await bad(path, { json: {} });
      await bad(path, { json: { text: 5 } });
      await bad(path, { body: "{not json" });
      await bad(path, {});
    }
    await bad("/social/inbox/comments/instagram/c1/hide", { json: {} });
    await bad("/social/inbox/comments/instagram/c1/hide", { json: { hidden: "true" } });
    expect(w.fetch.calls()).toEqual([]);
  });

  it("answers not_found without a call for a conversation or comment the store does not hold", async () => {
    const w = await sendWorld();
    for (const [path, method, body] of [
      ["/social/inbox/conversations/nope/send", "POST", { text: "hi" }],
      ["/social/inbox/comments/instagram/nope/reply", "POST", { text: "hi" }],
      ["/social/inbox/comments/instagram/nope/private", "POST", { text: "hi" }],
      ["/social/inbox/comments/instagram/nope/hide", "POST", { hidden: true }],
      ["/social/inbox/comments/instagram/nope", "DELETE", undefined],
    ] as const) {
      const res = await w.call(req(path, { method, json: body }));
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(w.fetch.calls()).toEqual([]);
  });

  it("replies publicly under a comment with a form body and stores the reply under its post", async () => {
    let seen: RequestInit | undefined;
    const w = await sendWorld({
      [`POST ${GRAPH}/c1/replies`]: (_url, init) => {
        seen = init;
        return { id: "r1" };
      },
    });

    const res = await w.call(
      posted("/social/inbox/comments/instagram/c1/reply", { text: " شكرا " }),
    );

    expect(res.status).toBe(200);
    const reply: CommentRow = {
      platform: "instagram",
      postId: "p1",
      id: "r1",
      parentId: "c1",
      at: SENT_AT,
      author: "3z.prod",
      authorId: "178",
      text: "شكرا",
      hidden: false,
      ours: true,
      sentBy: "owner",
    };
    expect(await res.json()).toEqual({ reply });
    expect(seen?.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(new URLSearchParams(String(seen?.body)))).toEqual({
      message: "شكرا",
      access_token: "instagram-token",
    });
    expect(w.fetch.calls()).toEqual([ME_URL, `POST ${GRAPH}/c1/replies`]);
    expect(await w.comment("r1")).toEqual(reply);
    expect(w.sends()).toMatchObject([
      { kind: "reply", targetId: "c1", text: "شكرا", state: "sent", platformId: "r1" },
    ]);
  });

  it("answers a comment privately by its id, stores nothing but the send, and says only the message id", async () => {
    let seen: RequestInit | undefined;
    const w = await sendWorld({
      [DM_URL]: (_url, init) => {
        seen = init;
        return { recipient_id: "55", message_id: "mid.p" };
      },
    });

    const res = await w.call(posted("/social/inbox/comments/instagram/c1/private", { text: "hi" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: { id: "mid.p" } });
    expect(sentBody(seen)).toEqual({ recipient: { comment_id: "c1" }, message: { text: "hi" } });
    expect((await w.api.overview()).counts).toEqual({ conversations: 3, posts: 1, comments: 2 });
    expect(w.sends()).toMatchObject([
      { kind: "private", targetId: "c1", text: "hi", state: "sent", platformId: "mid.p" },
    ]);
  });

  it("hides and unhides a comment through the query and mirrors it in the store", async () => {
    const seen: URL[] = [];
    const w = await sendWorld({
      [`POST ${GRAPH}/c1`]: (url) => {
        seen.push(url);
        return { success: true };
      },
    });

    const hide = await w.call(posted("/social/inbox/comments/instagram/c1/hide", { hidden: true }));
    expect(hide.status).toBe(200);
    expect(await hide.json()).toEqual({ ok: true });
    expect((await w.comment("c1"))?.hidden).toBe(true);

    const show = await w.call(
      posted("/social/inbox/comments/instagram/c1/hide", { hidden: false }),
    );
    expect(await show.json()).toEqual({ ok: true });
    expect((await w.comment("c1"))?.hidden).toBe(false);

    expect(seen.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      { hide: "true", access_token: "instagram-token" },
      { hide: "false", access_token: "instagram-token" },
    ]);
    // Hiding is not a send, and it needs no account id.
    expect(w.fetch.calls()).toEqual([`POST ${GRAPH}/c1`, `POST ${GRAPH}/c1`]);
    expect(w.sends()).toEqual([]);
  });

  it("deletes only the owner's own comment; someone else's is no_permission without a call", async () => {
    const seen: URL[] = [];
    const w = await sendWorld({
      [`DELETE ${GRAPH}/c2`]: (url) => {
        seen.push(url);
        return { success: true };
      },
    });

    const theirs = await w.call(req("/social/inbox/comments/instagram/c1", { method: "DELETE" }));
    expect(theirs.status).toBe(403);
    expect(await theirs.json()).toEqual({ error: "no_permission" });
    expect(w.fetch.calls()).toEqual([]);
    expect(await w.comment("c1")).not.toBeNull();

    const ours = await w.call(req("/social/inbox/comments/instagram/c2", { method: "DELETE" }));
    expect(ours.status).toBe(200);
    expect(await ours.json()).toEqual({ ok: true });
    expect(seen.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      { access_token: "instagram-token" },
    ]);
    expect(w.fetch.calls()).toEqual([`DELETE ${GRAPH}/c2`]);
    expect(await w.comment("c2")).toBeNull();
    expect(await w.comment("c1")).not.toBeNull();
  });

  it("reads Meta's closed-window refusal of a DM as window_closed and records it refused", async () => {
    const w = await sendWorld({
      [DM_URL]: ans(
        { error: { message: "Outside the window", code: 10, error_subcode: 2534022 } },
        400,
      ),
    });

    const res = await w.call(posted("/social/inbox/conversations/t1/send", { text: "hi" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "window_closed",
      detail: "Outside the window [10/2534022]",
    });
    expect(w.sends()).toMatchObject([
      {
        kind: "dm",
        targetId: "t1",
        state: "refused",
        platformId: null,
        detail: "Outside the window [10/2534022]",
      },
    ]);
    // Nothing was sent, so the thread keeps what it had.
    expect((await w.thread("t1"))?.messages.items).toEqual([]);
    expect((await w.thread("t1"))?.conversation.lastFrom).toBe("peer");
  });

  it("keeps not_eligible for a private reply's closed window and for its own refusal", async () => {
    for (const [error, detail] of [
      [{ message: "Too late", code: 10, error_subcode: 2534022 }, "Too late [10/2534022]"],
      [{ message: "Invalid", code: 100, error_subcode: 2534025 }, "Invalid [100/2534025]"],
    ] as const) {
      const w = await sendWorld({ [DM_URL]: ans({ error }, 400) });
      const res = await w.call(
        posted("/social/inbox/comments/instagram/c1/private", { text: "hi" }),
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_eligible", detail });
      expect(w.sends()).toMatchObject([{ kind: "private", state: "refused", detail }]);
    }
  });

  it("answers Meta's other refusals with their code and Meta's words", async () => {
    const w = await sendWorld({
      [`POST ${GRAPH}/c1/replies`]: ans({ error: { message: "denied", code: 10 } }, 403),
      [`POST ${GRAPH}/c1`]: ans({ error: { message: "slow down", code: 4 } }, 400),
      [`DELETE ${GRAPH}/c2`]: ans({ error: { message: "Cannot delete", code: 100 } }, 400),
    });

    const reply = await w.call(posted("/social/inbox/comments/instagram/c1/reply", { text: "hi" }));
    expect(reply.status).toBe(403);
    expect(await reply.json()).toEqual({ error: "no_permission", detail: "denied [10]" });
    expect(w.sends()).toMatchObject([{ kind: "reply", state: "refused", detail: "denied [10]" }]);

    const hide = await w.call(posted("/social/inbox/comments/instagram/c1/hide", { hidden: true }));
    expect(hide.status).toBe(429);
    expect(await hide.json()).toEqual({ error: "rate_limited", detail: "slow down [4]" });
    expect((await w.comment("c1"))?.hidden).toBe(false);

    const del = await w.call(req("/social/inbox/comments/instagram/c2", { method: "DELETE" }));
    expect(del.status).toBe(502);
    expect(await del.json()).toEqual({ error: "rejected", detail: "Cannot delete [100]" });
    expect(await w.comment("c2")).not.toBeNull();
    // Hide and delete are not sends: only the reply has a send row.
    expect(w.sends()).toHaveLength(1);
  });

  it("scrubs the access token from the words it records and answers", async () => {
    const w = await sendWorld({
      [DM_URL]: ans({ error: { message: "Bad token instagram-token here", code: 190 } }, 400),
    });

    const res = await w.call(posted("/social/inbox/conversations/t1/send", { text: "hi" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "token_expired", detail: "Bad token … here [190]" });
    expect(JSON.stringify(w.sends())).not.toContain("instagram-token");
  });

  it("keeps a long detail to 200 characters", async () => {
    const w = await sendWorld({
      [DM_URL]: ans({ error: { message: "x".repeat(500), code: 100 } }, 400),
    });
    const res = await w.call(posted("/social/inbox/conversations/t1/send", { text: "hi" }));
    const { detail } = (await res.json()) as { detail: string };
    expect(detail).toHaveLength(200);
    expect(w.sends()[0].detail).toBe(detail);
  });

  it("answers upstream/unconfirmed and records the send unconfirmed when the call throws", async () => {
    const w = await sendWorld({
      [DM_URL]: () => {
        throw new TypeError("network lost");
      },
    });

    const res = await w.call(posted("/social/inbox/conversations/t1/send", { text: "hi" }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream", detail: "unconfirmed" });
    expect(w.sends()).toMatchObject([
      { kind: "dm", targetId: "t1", text: "hi", state: "unconfirmed", platformId: null },
    ]);
    expect((await w.thread("t1"))?.messages.items).toEqual([]);
  });

  it("answers unconfirmed when Meta says 200 but names no message, reply or success", async () => {
    const w = await sendWorld({
      [DM_URL]: { recipient_id: "9" },
      [`POST ${GRAPH}/c1/replies`]: {},
      [`POST ${GRAPH}/c1`]: { success: false },
      [`DELETE ${GRAPH}/c2`]: {},
    });
    const unconfirmed = async (request: Request) => {
      const res = await w.call(request);
      expect(res.status, request.url).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream", detail: "unconfirmed" });
    };

    await unconfirmed(posted("/social/inbox/conversations/t1/send", { text: "hi" }));
    await unconfirmed(posted("/social/inbox/comments/instagram/c1/reply", { text: "hi" }));
    await unconfirmed(posted("/social/inbox/comments/instagram/c1/hide", { hidden: true }));
    await unconfirmed(req("/social/inbox/comments/instagram/c2", { method: "DELETE" }));

    expect(w.sends().map((s) => [s.kind, s.state])).toEqual([
      ["dm", "unconfirmed"],
      ["reply", "unconfirmed"],
    ]);
    // Nothing is stored as sent, hidden or deleted.
    expect((await w.thread("t1"))?.messages.items).toEqual([]);
    expect((await w.comment("c1"))?.hidden).toBe(false);
    expect(await w.comment("c2")).not.toBeNull();
    expect((await w.api.overview()).counts.comments).toBe(2);
  });

  it("still answers the send when the store fails after Instagram took it, so it is not sent twice", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const w = await sendWorld({ [DM_URL]: { recipient_id: "9", message_id: "mid.1" } });
      const failing = Object.create(w.api, {
        ingest: { value: async () => Promise.reject(new Error("object reset")) },
        recordSend: { value: async () => Promise.reject(new Error("object reset")) },
      });
      const res = await handle(
        posted("/social/inbox/conversations/t1/send", { text: "hi" }),
        w.env,
        undefined,
        { fetch: w.fetch, now: () => NOW, inboxApi: failing },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ message: { id: "mid.1", text: "hi" } });
      expect(log).toHaveBeenCalled();
      expect(w.fetch.calls()).toEqual([ME_URL, DM_URL]);
    } finally {
      log.mockRestore();
    }
  });

  it("still answers Meta's refusal when the store fails to record it", async () => {
    const w = await sendWorld({
      [DM_URL]: ans(
        { error: { message: "Outside the window", code: 10, error_subcode: 2534022 } },
        400,
      ),
    });

    const { res, logged } = await sendWithStoreDown(
      w,
      posted("/social/inbox/conversations/t1/send", { text: "hi" }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "window_closed",
      detail: "Outside the window [10/2534022]",
    });
    expect(logged).toBe(1);
  });

  it("still answers unconfirmed when the store fails to record that", async () => {
    const w = await sendWorld({
      [DM_URL]: () => {
        throw new TypeError("network lost");
      },
    });

    const { res, logged } = await sendWithStoreDown(
      w,
      posted("/social/inbox/conversations/t1/send", { text: "hi" }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream", detail: "unconfirmed" });
    expect(logged).toBe(1);
  });

  it("reads a Graph 5xx or an unreadable answer as unconfirmed, not refused: the DM may have gone out", async () => {
    for (const [answer, detail] of [
      [ans({ error: { message: "boom", code: 1 } }, 500), "boom [1]"],
      [() => new Response("<html>bad gateway</html>", { status: 200 }), "dm: 200"],
      [
        () => new Response(null, { status: 302, headers: { Location: "https://x.example" } }),
        "dm: 302",
      ],
    ] as const) {
      const w = await sendWorld({ [DM_URL]: answer });

      const res = await w.call(posted("/social/inbox/conversations/t1/send", { text: "hi" }));

      expect(res.status, detail).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream", detail: "unconfirmed" });
      expect(w.sends(), detail).toMatchObject([
        { kind: "dm", targetId: "t1", state: "unconfirmed", platformId: null, detail },
      ]);
      expect((await w.thread("t1"))?.messages.items).toEqual([]);
    }
  });

  it("stores a reply to a reply under the top-level comment, where Instagram puts it", async () => {
    const w = await sendWorld({ [`POST ${GRAPH}/c2/replies`]: { id: "r2" } });

    const res = await w.call(posted("/social/inbox/comments/instagram/c2/reply", { text: "hi" }));

    expect(await res.json()).toMatchObject({ reply: { id: "r2", postId: "p1", parentId: "c1" } });
    expect((await w.comment("r2"))?.parentId).toBe("c1");
  });

  it("answers not_eligible without a call for a conversation whose person is unknown", async () => {
    const w = await sendWorld();
    await w.api.ingest({
      conversations: [
        { ...conv("t5", "2026-10-22T08:00:00.000Z"), peerId: "", windowClosesAt: OPEN_UNTIL },
      ],
    });

    const res = await w.call(posted("/social/inbox/conversations/t5/send", { text: "hi" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_eligible" });
    expect(w.fetch.calls()).toEqual([]);
    expect(w.sends()).toEqual([]);
  });

  it("builds the DM's conversation row on what the reader stored while the DM was going out", async () => {
    const sendWhileReaderIngests = async (reader: Partial<ConversationRow>) => {
      const live: { w?: SendWorld } = {};
      const w = await sendWorld({
        [DM_URL]: async () => {
          await live.w?.api.ingest({
            conversations: [
              {
                ...conv("t1", "2026-10-22T11:45:00.000Z"),
                peerId: "9",
                windowClosesAt: OPEN_UNTIL,
                ...reader,
              },
            ],
          });
          return { recipient_id: "9", message_id: "mid.1" };
        },
      });
      live.w = w;
      const res = await w.call(posted("/social/inbox/conversations/t1/send", { text: "hi" }));
      expect(res.status).toBe(200);
      return w.thread("t1");
    };

    // The reader renamed the person and moved the window: the send keeps both and adds its last message.
    const renamed = await sendWhileReaderIngests({
      peerName: "sara",
      windowClosesAt: "2026-10-22T14:00:00.000Z",
    });
    expect(renamed?.conversation).toMatchObject({
      peerName: "sara",
      windowClosesAt: "2026-10-22T14:00:00.000Z",
      lastText: "hi",
      lastFrom: "owner",
      updatedAt: SENT_AT,
    });

    // The reader already saw something newer than the send: that conversation row stays, the message is added.
    const newer = await sendWhileReaderIngests({
      updatedAt: "2026-10-22T12:00:05.000Z",
      lastText: "thanks!",
      lastFrom: "peer",
    });
    expect(newer?.conversation).toMatchObject({
      updatedAt: "2026-10-22T12:00:05.000Z",
      lastText: "thanks!",
      lastFrom: "peer",
    });
    expect(newer?.messages.items.map((m) => m.id)).toEqual(["mid.1"]);
  });

  it("refuses without a call when Instagram is not connected, its token has lapsed or it cannot reply", async () => {
    const expectRefused = async (env: Env, status: number, error: string) => {
      const api = freshDb();
      await api.ingest({
        conversations: [{ ...conv("t1", "2026-10-22T11:30:00.000Z"), windowClosesAt: OPEN_UNTIL }],
      });
      const fetch = mockFetch({});
      const res = await handle(
        posted("/social/inbox/conversations/t1/send", { text: "hi" }),
        env,
        undefined,
        { fetch, now: () => NOW, inboxApi: api },
      );
      expect(res.status, error).toBe(status);
      expect(await res.json()).toEqual({ error });
      expect(fetch.calls()).toEqual([]);
    };
    await expectRefused(makeEnv(), 409, "not_connected");
    const lapsed = makeEnv();
    await connect(lapsed, "instagram", { expiresAt: "2026-10-21T00:00:00Z" });
    await expectRefused(lapsed, 409, "token_expired");
    const readOnly = makeEnv();
    await connect(readOnly, "instagram", { canReply: false });
    await expectRefused(readOnly, 403, "no_permission");
  });

  it("spends at most two Graph calls on a send (the account id and the send) and never writes KV", async () => {
    const graph = {
      [DM_URL]: { message_id: "mid.1" },
      [`POST ${GRAPH}/c1/replies`]: { id: "r1" },
      [`POST ${GRAPH}/c1`]: { success: true },
      [`DELETE ${GRAPH}/c2`]: { success: true },
    };
    for (const [request, calls] of [
      [posted("/social/inbox/conversations/t1/send", { text: "hi" }), 2],
      [posted("/social/inbox/comments/instagram/c1/reply", { text: "hi" }), 2],
      [posted("/social/inbox/comments/instagram/c1/private", { text: "hi" }), 2],
      [posted("/social/inbox/comments/instagram/c1/hide", { hidden: true }), 1],
      [req("/social/inbox/comments/instagram/c2", { method: "DELETE" }), 1],
    ] as const) {
      const w = await sendWorld(graph);
      const res = await w.call(request);
      expect(res.status, request.url).toBe(200);
      expect(w.fetch.mock.calls, request.url).toHaveLength(calls);
      expect(w.env.SOCIAL_KV.written, request.url).toEqual([]);
    }
  });

  it("answers not_available without the store binding, sends included", async () => {
    const env = makeEnv();
    const fetch = mockFetch({});
    const res = await handle(
      posted("/social/inbox/conversations/t1/send", { text: "hi" }),
      env,
      undefined,
      { fetch, now: () => NOW },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_available" });
    expect(fetch.calls()).toEqual([]);
  });
});
