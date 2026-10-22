import { describe, expect, it, vi } from "vitest";
import { InboxDb, type PostRow, type Sql } from "./inboxDb";
import { INBOX_READ_BUDGET, readInboxTick, toBatch } from "./inboxReader";
import { Store, type SocialEnv } from "./store";
import type { TokenSet } from "./types";

// cron.ts reaches inboxStore.ts, which imports `cloudflare:workers` (workerd only); see vitest.config.ts.

/* ---------- fakes (copied from replies.test.ts and inboxDb.test.ts) ---------- */

const TOKEN = "s3cret-token";
const NOW = new Date("2026-10-22T12:00:00Z");
const IG = "graph.instagram.com/v21.0";

type FakeKV = KVNamespace & { store: Map<string, string> };

function fakeKV(): FakeKV {
  const store = new Map<string, string>();
  const kv = {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
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

function makeEnv(): SocialEnv & { SOCIAL_KV: FakeKV } {
  return { SCOUT_TOKEN: TOKEN, SOCIAL_KV: fakeKV() };
}

async function connect(env: SocialEnv, tokens: Partial<TokenSet> = {}) {
  await Store.from(env)!.putTokens("instagram", {
    accessToken: "tok",
    issuedAt: "2026-10-22T00:00:00Z",
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    canReply: true,
    ...tokens,
  });
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
// Each test gets its own in-memory database; `available` only decides whether node:sqlite loads.
const available = nodeSql() !== null;
const freshDb = () => new InboxDb(nodeSql()!);

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

/** n stored posts, p0 the newest. */
const storedPosts = (n: number): PostRow[] =>
  Array.from({ length: n }, (_, i) => ({
    platform: "instagram",
    id: `p${i}`,
    permalink: "",
    thumbUrl: null,
    caption: `post ${i}`,
    postedAt: new Date(Date.UTC(2026, 9, 20) - i * 3_600_000).toISOString(),
    commentCount: 0,
  }));

/* ---------- toBatch ---------- */

describe("toBatch", () => {
  it("maps message kinds and senders, the hidden flag, and normalises +0000 times to Z", () => {
    const at = (min: number) => `2026-10-22T11:${String(min).padStart(2, "0")}:00+0000`;
    const batch = toBatch(
      {
        conversations: [
          {
            id: "t1",
            updated_time: at(55),
            participants: {
              data: [
                { id: "17841", username: "3z.prod" },
                { id: "9", username: "sara" },
              ],
            },
            messages: {
              data: [
                { id: "m5", created_time: at(55), from: { id: "17841" }, message: "ok" },
                { id: "m4", created_time: at(54), from: { id: "9" } },
                { id: "m3", created_time: at(53), from: { id: "9" }, is_unsupported: true },
                { id: "m2", created_time: at(52), from: { id: "9" }, story: { mention: {} } },
                { id: "m1", created_time: at(51), from: { id: "9" }, message: "hi" },
              ],
            },
          },
          { id: "t2", updated_time: at(10) },
        ],
        media: [],
        comments: [
          {
            postId: "p1",
            rows: [{ id: "c1", from: { id: "5" }, timestamp: at(0), hidden: true, text: "x" }],
          },
        ],
      },
      "17841",
      { sent: {} },
      NOW,
    );
    expect(batch.messages!.map((m) => [m.id, m.kind, m.sentBy, m.fromPeer])).toEqual([
      ["m1", "text", "peer", true],
      ["m2", "story", "peer", true],
      ["m3", "unsupported", "peer", true],
      ["m4", "share", "peer", true],
      ["m5", "text", "owner", false],
    ]);
    expect(batch.messages![0].at).toBe("2026-10-22T11:51:00.000Z");
    expect(batch.conversations![0]).toMatchObject({
      peerId: "9",
      peerName: "sara",
      updatedAt: "2026-10-22T11:55:00.000Z",
      lastText: "ok",
      lastFrom: "owner",
      answeredBy: null,
      windowClosesAt: "2026-10-23T11:54:00.000Z",
    });
    // a thread with no participants or messages still maps, with the documented fallbacks
    expect(batch.conversations![1]).toMatchObject({
      peerId: "",
      peerName: "?",
      lastText: "",
      lastFrom: "peer",
      windowClosesAt: null,
    });
    expect(batch.comments![0]).toMatchObject({ id: "c1", hidden: true, ours: false });
    expect(batch.readAt).toEqual({ platform: "instagram", at: NOW.toISOString() });
  });
});

/* ---------- readInboxTick ---------- */

describe.skipIf(!available)("readInboxTick", () => {
  it("fills the store from one conversations page and the rotation's comments, marks auto replies", async () => {
    const env = makeEnv();
    await connect(env);
    const api = freshDb();
    // the replies poll's own send, 2 min ago, to peer 9
    env.SOCIAL_KV.store.set(
      "replies:state",
      JSON.stringify({ sent: { m9: { to: "9", at: "2026-10-22T11:58:00.000Z" } } }),
    );
    const fetch = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: () => ({
        data: [
          {
            id: "t1",
            updated_time: "2026-10-22T11:58:00+0000",
            participants: {
              data: [
                { id: "9", username: "sara" },
                { id: "17841", username: "3z.prod" },
              ],
            },
            messages: {
              data: [
                {
                  id: "m9",
                  created_time: "2026-10-22T11:58:00+0000",
                  from: { id: "17841" },
                  message: "auto text",
                },
                {
                  id: "m8",
                  created_time: "2026-10-22T11:57:00+0000",
                  from: { id: "9" },
                  message: "لت",
                },
              ],
            },
          },
        ],
      }),
      [`GET ${IG}/17841/media`]: () => ({
        data: [
          {
            id: "p1",
            caption: "LUT",
            permalink: "https://www.instagram.com/reel/X/",
            timestamp: "2026-10-20T00:00:00+0000",
            thumbnail_url: "https://cdn/x.jpg",
            comments_count: 1,
          },
        ],
      }),
      [`GET ${IG}/p1/comments`]: () => ({
        data: [
          {
            id: "c1",
            text: "لت",
            username: "ali",
            from: { id: "5" },
            timestamp: "2026-10-21T00:00:00+0000",
            replies: {
              data: [
                {
                  id: "c1r",
                  text: "sent it",
                  username: "3z.prod",
                  from: { id: "17841" },
                  timestamp: "2026-10-21T00:01:00+0000",
                },
              ],
            },
          },
        ],
      }),
    });
    const r = await readInboxTick(env, { fetch, now: () => NOW, api });
    expect(r).toMatchObject({ calls: 4, conversations: 1, posts: 1, comments: 2 });
    expect(fetch.calls()).toEqual([
      `GET ${IG}/me`,
      `GET ${IG}/17841/conversations`,
      `GET ${IG}/17841/media`,
      `GET ${IG}/p1/comments`,
    ]);
    const t = (await api.thread("instagram", "t1", {}))!;
    expect(t.conversation).toMatchObject({
      peerId: "9",
      peerName: "sara",
      lastFrom: "auto",
      answeredBy: "auto",
      windowClosesAt: "2026-10-23T11:57:00.000Z",
    });
    expect(t.messages.items.map((m) => m.sentBy)).toEqual(["peer", "auto"]);
    const c = (await api.comments("instagram", "p1", {}))!;
    expect(c.post).toMatchObject({
      caption: "LUT",
      thumbUrl: "https://cdn/x.jpg",
      commentCount: 1,
    });
    expect(c.comments.items.find((x) => x.id === "c1r")).toMatchObject({
      parentId: "c1",
      ours: true,
    });
    expect(await api.getMeta("lastReadAt:instagram")).toBe("2026-10-22T12:00:00.000Z");
  });

  it("skips without the binding, without a connection, without canReply, and with an expired token", async () => {
    const env = makeEnv();
    const run = () => readInboxTick(env, { fetch: mockFetch({}), now: () => NOW, api: freshDb() });
    expect(await readInboxTick(env, { fetch: mockFetch({}), now: () => NOW })).toEqual({
      skipped: "no_store",
    });
    expect(await run()).toEqual({ skipped: "not_connected" });
    await connect(env, { canReply: false });
    expect(await run()).toEqual({ skipped: "no_permission" });
    await connect(env, { expiresAt: "2026-10-22T11:00:00Z" });
    expect(await run()).toEqual({ skipped: "token_expired" });
  });

  it("rotates comments over the stored posts, five a tick, and refreshes media every tenth tick", async () => {
    const env = makeEnv();
    await connect(env);
    const api = freshDb();
    // tick counter 1, so the first tick does not refresh media
    const posts = storedPosts(12);
    await api.ingest({ posts });
    await api.setMeta("ig:tick", "1");
    const routes: Record<string, Handler> = {
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: () => ({ data: [] }),
      [`GET ${IG}/17841/media`]: () => ({ data: [] }),
    };
    for (const p of posts) routes[`GET ${IG}/${p.id}/comments`] = () => ({ data: [] });
    const fetch = mockFetch(routes);
    let t = NOW.getTime();
    const tick = async () => {
      const seen = fetch.calls().length;
      const r = await readInboxTick(env, { fetch, now: () => new Date(t), api });
      t += 60_000;
      const calls = fetch.calls().slice(seen);
      return {
        r,
        media: calls.filter((c) => c.endsWith("/17841/media")).length,
        commented: calls.flatMap((c) => c.match(/\/(p\d+)\/comments$/)?.[1] ?? []),
      };
    };

    const one = await tick();
    expect(one.commented).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(one.media).toBe(0);
    expect(one.r).toMatchObject({ calls: 7, posts: 0 });
    expect((await tick()).commented).toEqual(["p5", "p6", "p7", "p8", "p9"]);
    const three = await tick();
    expect(three.commented).toEqual(["p10", "p11", "p0", "p1", "p2"]);
    expect(three.media).toBe(0);
    expect(await api.getMeta("ig:tick")).toBe("4");
    expect(await api.getMeta("ig:postCursor")).toBe("3");

    await api.setMeta("ig:tick", "10");
    const ten = await tick();
    expect(ten.media).toBe(1);
    expect(ten.commented).toEqual(["p3", "p4", "p5", "p6", "p7"]);
    expect(ten.r).toMatchObject({ calls: 8 });
    expect(INBOX_READ_BUDGET).toBeGreaterThanOrEqual(8);
    expect(await api.getMeta("ig:tick")).toBe("11");
  });

  it("a refresh stamp newer than the last scan reads the newest five posts once and keeps the rotation", async () => {
    const env = makeEnv();
    await connect(env);
    const api = freshDb();
    const posts = storedPosts(12);
    await api.ingest({ posts });
    await api.setMeta("ig:tick", "1");
    await api.setMeta("ig:postCursor", "7");
    env.SOCIAL_KV.store.set("inbox:scan", "2026-10-22T11:59:30.000Z");
    const routes: Record<string, Handler> = {
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: () => ({ data: [] }),
    };
    for (const p of posts) routes[`GET ${IG}/${p.id}/comments`] = () => ({ data: [] });
    const fetch = mockFetch(routes);
    const commented = (from: number) =>
      fetch
        .calls()
        .slice(from)
        .flatMap((c) => c.match(/\/(p\d+)\/comments$/)?.[1] ?? []);

    await readInboxTick(env, { fetch, now: () => NOW, api });
    expect(commented(0)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(await api.getMeta("ig:postCursor")).toBe("7");
    expect(await api.getMeta("ig:lastScan")).toBe("2026-10-22T11:59:30.000Z");

    const seen = fetch.calls().length;
    await readInboxTick(env, { fetch, now: () => NOW, api });
    expect(commented(seen)).toEqual(["p7", "p8", "p9", "p10", "p11"]);
  });

  it("skips a post Instagram refuses, still ingests the rest, and moves the rotation on", async () => {
    const env = makeEnv();
    await connect(env);
    const api = freshDb();
    await api.ingest({ posts: storedPosts(2) });
    await api.setMeta("ig:tick", "1");
    const fetch = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: () => ({
        data: [{ id: "t1", updated_time: "2026-10-22T11:58:00+0000" }],
      }),
      // p0 was deleted on Instagram since the last media read
      [`GET ${IG}/p0/comments`]: () =>
        json({ error: { message: "Unsupported get request", code: 100, error_subcode: 33 } }, 400),
      [`GET ${IG}/p1/comments`]: () => ({
        data: [{ id: "c1", text: "hi", username: "ali", timestamp: "2026-10-21T00:00:00+0000" }],
      }),
    });
    const r = await readInboxTick(env, { fetch, now: () => NOW, api });
    expect(r).toEqual({ calls: 4, conversations: 1, posts: 0, comments: 1 });
    expect(await api.getMeta("ig:tick")).toBe("2");
    expect((await api.comments("instagram", "p1", {}))!.comments.items).toHaveLength(1);
  });

  it("reports a failing Graph call without moving the rotation or the read time", async () => {
    const env = makeEnv();
    await connect(env);
    const api = freshDb();
    const fetch = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: () => json({ error: { message: "boom", code: 2 } }, 500),
    });
    const r = await readInboxTick(env, { fetch, now: () => NOW, api });
    expect(r).toEqual({ calls: 2, conversations: 0, posts: 0, comments: 0, error: "upstream" });
    expect(await api.getMeta("ig:tick")).toBeNull();
    expect(await api.getMeta("lastReadAt:instagram")).toBeNull();
  });
});
