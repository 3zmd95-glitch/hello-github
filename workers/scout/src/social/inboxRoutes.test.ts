import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { InboxDb, PAGE, type ConversationRow, type Sql } from "./inboxDb";
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
      posts: [
        {
          platform: "instagram",
          id: "p1",
          permalink: "",
          thumbUrl: null,
          caption: "",
          postedAt: "2026-10-20T00:00:00.000Z",
          commentCount: 0,
        },
      ],
    });
    const wipe = await handle(req("/social/inbox", { method: "DELETE" }), env, undefined, deps);
    expect(wipe.status).toBe(200);
    expect(await wipe.json()).toEqual({ ok: true });
    expect((await api.overview()).counts.posts).toBe(0);
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
