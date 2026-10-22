import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { PAGE_BYTES_MAX } from "./inboxRead";
import { sealCursorV2, sealRef } from "./inboxReadCommon";
import { openSendTarget } from "./inboxSendYouTube";
import { Store } from "./store";
import type { TokenSet } from "./types";

// 📥 YouTube inbox reads (packet DT-6B-1, planning/tools/36-inbox.md): the owner's channel, its uploads, published
// comment threads of one owned video and, on demand, the replies of one top-level comment. Pure GETs on
// www.googleapis.com with the bearer header: KV untouched, no token refresh POST (an expired token is an explicit
// state), no moderation, and every item below the channel is reached only through a sealed ownership `ref`.

const TOKEN = "s3cret-token";
/** The server-only seal key (DT-6B-1-R1 B1-1): never the bearer the browser holds. */
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-17T09:00:00Z");
const YT = "www.googleapis.com/youtube/v3";
const CH = "UCaaaaaaaaaaaaaaaaaaaaaa";
const CH2 = "UCbbbbbbbbbbbbbbbbbbbbbb";
const UPLOADS = "UUaaaaaaaaaaaaaaaaaaaaaa";
const SCOPES =
  "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly";

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
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
});

async function connect(env: Env & { SOCIAL_KV: FakeKV }, tokens: Partial<TokenSet> = {}) {
  const store = Store.from(env)!;
  await store.putTokens("youtube", {
    accessToken: "yt-live-token",
    refreshToken: "yt-refresh-token",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 3_000_000).toISOString(),
    scope: SCOPES,
    ...tokens,
  });
  await store.putStatus("youtube", { connectedAt: "2026-10-01T08:00:00.000Z", handle: "3zprod" });
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
const gErr = (status: number, reason: string) =>
  json({ error: { code: status, message: `nope ${reason}`, errors: [{ reason }] } }, status);

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
  const auths = () =>
    fn.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"));
  return Object.assign(fn, { urls, methods, auths });
}

const run = (env: Env, f: typeof fetch, path: string, init = {}) =>
  handle(req(path, init), env, undefined, { fetch: f, now: () => NOW });
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

function expectPure(env: Env & { SOCIAL_KV: FakeKV }, f: ReturnType<typeof mockFetch>) {
  expect(env.SOCIAL_KV.writes).toBe(0);
  expect(env.SOCIAL_KV.deletes).toBe(0);
  expect(f.methods().every((m) => m === "GET")).toBe(true);
  for (const u of f.urls()) {
    expect(u.host).toBe("www.googleapis.com");
    expect(u.searchParams.has("access_token")).toBe(false);
  }
  for (const a of f.auths()) expect(a).toBe("Bearer yt-live-token");
}

const channel = (id = CH, title = "3z Prod", uploads: string | null = UPLOADS) => ({
  id,
  snippet: { title },
  ...(uploads ? { contentDetails: { relatedPlaylists: { uploads } } } : {}),
});

type Chan = { accountId: string; generation: string; uploads: string | null; title: string };

async function account(env: Env): Promise<Chan> {
  const f = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [channel()] }) });
  const b = await body(await run(env, f, "/social/inbox/youtube/account"));
  return (b.channels as Chan[])[0];
}

const q = (a: { accountId: string; generation: string }, extra: Record<string, string> = {}) =>
  `?${new URLSearchParams({ account: a.accountId, generation: a.generation, ...extra })}`;

const item = (videoId: string) => ({
  id: `pl-${videoId}`,
  snippet: { title: `video ${videoId}`, publishedAt: "2026-10-10T08:00:00Z" },
  contentDetails: { videoId, videoPublishedAt: "2026-10-09T08:00:00Z" },
});

const comment = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    textDisplay: `comment ${id}`,
    authorDisplayName: "@fan_one",
    authorChannelId: { value: "UCfanfanfanfanfanfanfanf" },
    publishedAt: "2026-10-16T09:00:00Z",
    ...over,
  },
});

const thread = (id: string, replies: unknown[] = [], total = replies.length) => ({
  id,
  snippet: { videoId: "vid1", totalReplyCount: total, topLevelComment: comment(id) },
  ...(replies.length ? { replies: { comments: replies } } : {}),
});

async function videoRef(env: Env, a: Chan, id = "vid1") {
  const f = mockFetch({ [`GET ${YT}/playlistItems`]: () => ({ items: [item(id)] }) });
  const b = await body(
    await run(env, f, `/social/inbox/youtube/videos${q(a, { uploads: a.uploads! })}`),
  );
  return (b.items as { ref: string }[])[0].ref;
}

async function commentRef(env: Env, a: Chan, id = "Ugtop1") {
  const ref = await videoRef(env, a);
  const f = mockFetch({ [`GET ${YT}/commentThreads`]: () => ({ items: [thread(id)] }) });
  const b = await body(await run(env, f, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`));
  return (b.items as { ref: string }[])[0].ref;
}

describe("YouTube reads: auth, method, connection", () => {
  it("rejects a missing bearer and a foreign origin on every route before any Google call", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({});
    for (const path of [
      "/social/inbox/youtube/account",
      "/social/inbox/youtube/videos",
      "/social/inbox/youtube/videos/x.y/threads",
      "/social/inbox/youtube/comments/x.y/replies",
    ]) {
      expect((await run(env, f, path, { auth: null })).status).toBe(401);
      expect((await run(env, f, path, { origin: "https://evil.example" })).status).toBe(403);
    }
    for (const method of ["POST", "DELETE"])
      expect((await run(env, f, "/social/inbox/youtube/account", { method })).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("an expired token is token_expired: no refresh POST, no Google call, no write (even with a refresh token)", async () => {
    const env = makeEnv();
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    const f = mockFetch({ "POST oauth2.googleapis.com/token": () => ({ access_token: "new" }) });
    for (const path of ["/social/inbox/youtube/account", "/social/inbox/youtube/videos"]) {
      const res = await run(env, f, path);
      expect(res.status).toBe(409);
      expect(await body(res)).toEqual({ error: "token_expired" });
    }
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("says not_connected without a token", async () => {
    const env = makeEnv();
    const f = mockFetch({});
    expect(await body(await run(env, f, "/social/inbox/youtube/account"))).toEqual({
      error: "not_connected",
    });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("GET /social/inbox/youtube/account", () => {
  it("one owned channel: its id, title, a provider-bound generation and a sealed uploads ref", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [channel()] }) });
    const b = await body(await run(env, f, "/social/inbox/youtube/account"));
    expect(b).toEqual({
      provider: "youtube",
      needsSelection: false,
      channels: [
        {
          accountId: CH,
          title: "3z Prod",
          generation: expect.stringMatching(/^[0-9a-f]{32}$/),
          uploads: expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
        },
      ],
      // DT-6B-2A: the read-only grant cannot send public replies.
      capabilities: { comments: "ok", sendComments: "no_permission" },
    });
    const u = f.urls()[0];
    expect(u.searchParams.get("part")).toBe("id,snippet,contentDetails");
    expect(u.searchParams.get("mine")).toBe("true");
    expect(JSON.stringify(b)).not.toContain("yt-live-token");
    expectPure(env, f);
  });

  it("several channels need an explicit pick (each its own generation, never the first by default); none is an empty pick", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({
      [`GET ${YT}/channels`]: () => ({ items: [channel(), channel(CH2, "3z Prod", null)] }),
    });
    const b = await body(await run(env, f, "/social/inbox/youtube/account"));
    expect(b.needsSelection).toBe(true);
    const chans = b.channels as Chan[];
    expect(chans.map((c) => c.accountId)).toEqual([CH, CH2]);
    expect(chans[0].generation).not.toBe(chans[1].generation);
    expect(chans[1].uploads).toBeNull();
    // DT-6B-1-R1 B1-2: "none" is an explicit empty list; `{}` is upstream (see the B1-2 block below).
    const none = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [] }) });
    expect(await body(await run(env, none, "/social/inbox/youtube/account"))).toMatchObject({
      needsSelection: true,
      channels: [],
    });
    const bad = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [{ snippet: {} }] }) });
    expect((await body(await run(env, bad, "/social/inbox/youtube/account"))).error).toBe(
      "upstream",
    );
  });

  it("a stored scope without a YouTube read scope says comments: no_permission", async () => {
    const env = makeEnv();
    await connect(env, { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" });
    const f = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [channel()] }) });
    expect((await body(await run(env, f, "/social/inbox/youtube/account"))).capabilities).toEqual({
      comments: "no_permission",
      sendComments: "no_permission",
    });
  });

  it("maps 401 to token_expired, quota to rate_limited and 403 to no_permission", async () => {
    const env = makeEnv();
    await connect(env);
    for (const [res, code] of [
      [gErr(401, "authError"), "token_expired"],
      [gErr(403, "quotaExceeded"), "rate_limited"],
      [gErr(403, "insufficientPermissions"), "no_permission"],
    ] as const) {
      const f = mockFetch({ [`GET ${YT}/channels`]: () => res.clone() });
      expect((await body(await run(env, f, "/social/inbox/youtube/account"))).error).toBe(code);
      expectPure(env, f);
    }
  });
});

describe("GET /social/inbox/youtube/videos", () => {
  it("reads the uploads playlist only through its ref, with a sealed ref per video and a sealed page token", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({
      [`GET ${YT}/playlistItems`]: (u) =>
        u.searchParams.get("pageToken")
          ? { items: [item("vid3")] }
          : { items: [item("vid1"), item("vid2")], nextPageToken: "CAIQAA" },
    });
    const b = await body(
      await run(env, f, `/social/inbox/youtube/videos${q(a, { uploads: a.uploads! })}`),
    );
    expect(b).toMatchObject({ provider: "youtube", accountId: CH, coverage: "more" });
    expect((b.items as unknown[])[0]).toEqual({
      id: "vid1",
      ref: expect.stringMatching(/\./),
      title: "video vid1",
      permalink: "https://www.youtube.com/watch?v=vid1",
      timestamp: "2026-10-09T08:00:00.000Z",
    });
    const u = f.urls()[0];
    expect(u.searchParams.get("playlistId")).toBe(UPLOADS);
    expect(u.searchParams.get("part")).toBe("contentDetails,snippet");
    expect(u.searchParams.get("maxResults")).toBe("25");
    const next = await body(
      await run(
        env,
        f,
        `/social/inbox/youtube/videos${q(a, { uploads: a.uploads!, cursor: b.next as string })}`,
      ),
    );
    expect(next.coverage).toBe("end");
    expect(f.urls()[1].searchParams.get("pageToken")).toBe("CAIQAA");
    expectPure(env, f);
  });

  it("refuses a bare playlist id, a Threads ref and another channel's ref before any call; a hostile page token caps", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({});
    const threads = await sealRef(SEAL, {
      p: "threads",
      a: CH,
      g: a.generation,
      k: "uploads",
      id: UPLOADS,
    });
    const other = await sealRef(SEAL, {
      p: "youtube",
      a: CH2,
      g: a.generation,
      k: "uploads",
      id: UPLOADS,
    });
    for (const uploads of [UPLOADS, threads, other, ""]) {
      const res = await run(env, f, `/social/inbox/youtube/videos${q(a, { uploads })}`);
      expect((await body(res)).error).toBe("bad_request");
    }
    expect(f).not.toHaveBeenCalled();
    const hostile = mockFetch({
      [`GET ${YT}/playlistItems`]: () => ({
        items: [item("vid1")],
        nextPageToken: "https://evil.example/x",
      }),
    });
    const b = await body(
      await run(env, hostile, `/social/inbox/youtube/videos${q(a, { uploads: a.uploads! })}`),
    );
    expect(b).toMatchObject({ next: null, coverage: "cap" });
  });

  it("a row without a video id is unavailable; items: [] is a true end", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const bad = mockFetch({
      [`GET ${YT}/playlistItems`]: () => ({ items: [item("vid1"), { id: "pl-x", snippet: {} }] }),
    });
    expect(
      await body(
        await run(env, bad, `/social/inbox/youtube/videos${q(a, { uploads: a.uploads! })}`),
      ),
    ).toMatchObject({ error: "upstream", coverage: "unavailable" });
    const empty = mockFetch({ [`GET ${YT}/playlistItems`]: () => ({ items: [] }) });
    expect(
      await body(
        await run(env, empty, `/social/inbox/youtube/videos${q(a, { uploads: a.uploads! })}`),
      ),
    ).toMatchObject({ items: [], coverage: "end" });
  });
});

describe("GET /social/inbox/youtube/videos/:ref/threads", () => {
  it("reads published threads in plain text: embedded replies as a subset, owner direction by channel id, missing author unknown", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await videoRef(env, a);
    const f = mockFetch({
      [`GET ${YT}/commentThreads`]: () => ({
        items: [
          thread(
            "Ugtop1",
            [
              {
                ...comment("Ugtop1.r1", { authorChannelId: { value: CH } }),
                snippet: {
                  ...comment("Ugtop1.r1", { authorChannelId: { value: CH } }).snippet,
                  parentId: "Ugtop1",
                },
              },
            ],
            7,
          ),
          {
            id: "Ugtop2",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: comment("Ugtop2", {
                authorChannelId: undefined,
                authorDisplayName: undefined,
                textDisplay: "",
              }),
            },
          },
        ],
        nextPageToken: "TOK2",
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`));
    expect(b).toMatchObject({ provider: "youtube", accountId: CH, coverage: "more" });
    const items = b.items as Record<string, unknown>[];
    expect(items[0]).toEqual({
      id: "Ugtop1",
      ref: expect.stringMatching(/\./),
      sendRef: expect.stringMatching(/\./),
      comment: {
        id: "Ugtop1",
        text: "comment Ugtop1",
        author: { id: "UCfanfanfanfanfanfanfanf", username: "fan_one" },
        createdAt: "2026-10-16T09:00:00.000Z",
        direction: "in",
      },
      totalReplyCount: 7,
      replies: [
        {
          id: "Ugtop1.r1",
          text: "comment Ugtop1.r1",
          author: { id: CH, username: "fan_one" },
          createdAt: "2026-10-16T09:00:00.000Z",
          direction: "out",
          parentId: "Ugtop1",
          // DT-6B-2A: a nested reply sends to its authenticated top-level parent, and says so.
          sendRef: items[0].sendRef,
          replyParentNote: true,
        },
      ],
      repliesCoverage: "embedded",
    });
    expect(items[1]).toMatchObject({
      comment: { text: "", author: null, direction: "unknown" },
      totalReplyCount: 0,
      replies: [],
    });
    const u = f.urls()[0];
    expect(Object.fromEntries(u.searchParams)).toEqual({
      part: "snippet,replies",
      videoId: "vid1",
      textFormat: "plainText",
      order: "time",
      maxResults: "25",
    });
    expectPure(env, f);
  });

  it("comments disabled, video not found, quota and forbidden are distinct; a missing list or top-level comment is unavailable", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await videoRef(env, a);
    for (const [res, code, status] of [
      [gErr(403, "commentsDisabled"), "comments_disabled", 403],
      [gErr(404, "videoNotFound"), "video_not_found", 404],
      [gErr(403, "quotaExceeded"), "rate_limited", 429],
      [gErr(403, "forbidden"), "no_permission", 403],
      [json({}), "upstream", 502],
      [json({ items: [{ id: "Ugx", snippet: {} }] }), "upstream", 502],
    ] as const) {
      const f = mockFetch({ [`GET ${YT}/commentThreads`]: () => res.clone() });
      const out = await run(env, f, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`);
      expect(out.status).toBe(status);
      expect(await body(out)).toMatchObject({ error: code, coverage: "unavailable" });
      expectPure(env, f);
    }
  });

  it("a video ref only opens the threads route: an uploads or comment ref is refused, so is a bare video id", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const c = await commentRef(env, a);
    const f = mockFetch({});
    for (const r of ["vid1", a.uploads!, c]) {
      const res = await run(env, f, `/social/inbox/youtube/videos/${r}/threads${q(a)}`);
      expect((await body(res)).error).toBe("bad_request");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("a later page that fails is partial and the byte budget is enforced", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await videoRef(env, a);
    const cursor = await sealCursorV2(SEAL, {
      p: "youtube",
      a: CH,
      g: a.generation,
      e: "threads",
      r: "vid1",
      after: "TOK2",
    });
    const later = mockFetch({ [`GET ${YT}/commentThreads`]: () => gErr(500, "backendError") });
    expect(
      await body(
        await run(env, later, `/social/inbox/youtube/videos/${ref}/threads${q(a, { cursor })}`),
      ),
    ).toMatchObject({ error: "upstream", coverage: "partial" });
    const big = mockFetch({
      [`GET ${YT}/commentThreads`]: () => new Response(`{"items":"${"x".repeat(PAGE_BYTES_MAX)}"}`),
    });
    expect(
      await body(await run(env, big, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`)),
    ).toMatchObject({ error: "upstream", coverage: "unavailable" });
  });
});

describe("GET /social/inbox/youtube/comments/:ref/replies", () => {
  it("pages the replies of one top-level comment by its id, bound to it", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await commentRef(env, a);
    const f = mockFetch({
      [`GET ${YT}/comments`]: () => ({
        items: [
          comment("Ugtop1.r1", { parentId: "Ugtop1" }),
          comment("Ugtop1.r2", { parentId: "Ugtop1" }),
        ],
        nextPageToken: "R2",
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/youtube/comments/${ref}/replies${q(a)}`));
    expect(b).toMatchObject({ provider: "youtube", coverage: "more" });
    expect((b.items as { id: string; parentId: string }[]).map((x) => [x.id, x.parentId])).toEqual([
      ["Ugtop1.r1", "Ugtop1"],
      ["Ugtop1.r2", "Ugtop1"],
    ]);
    expect(Object.fromEntries(f.urls()[0].searchParams)).toEqual({
      part: "snippet",
      parentId: "Ugtop1",
      textFormat: "plainText",
      maxResults: "25",
    });
    // Its cursor does not open on another comment's replies.
    const other = await commentRef(env, a, "Ugtop9");
    const f2 = mockFetch({});
    const moved = await run(
      env,
      f2,
      `/social/inbox/youtube/comments/${other}/replies${q(a, { cursor: b.next as string })}`,
    );
    expect((await body(moved)).error).toBe("cursor_invalid");
    expect(f2).not.toHaveBeenCalled();
    expectPure(env, f);
  });

  it("refuses a bare comment id and a video ref before any call", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const v = await videoRef(env, a);
    const f = mockFetch({});
    for (const r of ["Ugtop1", v]) {
      const res = await run(env, f, `/social/inbox/youtube/comments/${r}/replies${q(a)}`);
      expect((await body(res)).error).toBe("bad_request");
    }
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
  it("video, comment and uploads refs forged with the bearer and the real generation are refused before any Google call", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const f = mockFetch({});
    for (const key of await bearerKeys("youtube")) {
      const ref = (k: string, id: string) =>
        forge({ p: "youtube", a: a.accountId, g: a.generation, k, id }, key);
      for (const path of [
        `/social/inbox/youtube/videos/${await ref("video", "FOREIGNvideo")}/threads${q(a)}`,
        `/social/inbox/youtube/comments/${await ref("comment", "FOREIGNtop")}/replies${q(a)}`,
        `/social/inbox/youtube/videos${q(a, { uploads: await ref("uploads", "UUforeign") })}`,
      ]) {
        const res = await run(env, f, path);
        expect(res.status).toBe(400);
        expect((await body(res)).error).toBe("bad_request");
      }
    }
    expect(f).not.toHaveBeenCalled();
    expectPure(env, f);
  });

  it("genuine refs from the listings still open threads and replies", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const cref = await commentRef(env, a);
    const f = mockFetch({ [`GET ${YT}/comments`]: () => ({ items: [] }) });
    const res = await run(env, f, `/social/inbox/youtube/comments/${cref}/replies${q(a)}`);
    expect(res.status).toBe(200);
    expect(f.urls()[0].searchParams.get("parentId")).toBe("Ugtop1");
  });

  it("without a usable seal secret (missing, short, or the bearer itself) every route is 503 not_configured, no call", async () => {
    for (const secret of [undefined, "", "short-secret", TOKEN]) {
      const env = { ...makeEnv(), INBOX_SEAL_SECRET: secret };
      await connect(env);
      const f = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [channel()] }) });
      const qs = `?account=${CH}&generation=${"a".repeat(32)}`;
      for (const path of [
        "/social/inbox/youtube/account",
        `/social/inbox/youtube/videos${qs}&uploads=x.y`,
        `/social/inbox/youtube/videos/x.y/threads${qs}`,
        `/social/inbox/youtube/comments/x.y/replies${qs}`,
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
    const vref = await videoRef(env, a);
    const f = mockFetch({
      [`GET ${YT}/channels`]: () => ({ items: [channel()] }),
      [`GET ${YT}/commentThreads`]: () =>
        json({ error: { code: 500, message: `boom ${SEAL} yt-live-token` } }, 500),
    });
    const seen: string[] = [];
    for (const path of [
      "/social/inbox/youtube/account",
      `/social/inbox/youtube/videos/${vref}/threads${q(a)}`,
      `/social/inbox/youtube/videos/nope/threads${q(a)}`,
    ])
      seen.push(await (await run(env, f, path)).text());
    expect(seen).toHaveLength(3);
    for (const text of seen) {
      expect(text).not.toContain(SEAL);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("yt-live-token");
    }
  });
});

describe("DT-6B-1-R1 B1-2: a channel list needs an explicit items array", () => {
  it("{}, { items: null }, a primitive and an array are upstream failures, never an empty pick", async () => {
    const env = makeEnv();
    await connect(env);
    for (const reply of [{}, { items: null }, true, [], { items: "x" }]) {
      const f = mockFetch({ [`GET ${YT}/channels`]: () => json(reply) });
      const res = await run(env, f, "/social/inbox/youtube/account");
      expect(res.status).toBe(502);
      expect((await body(res)).error).toBe("upstream");
      expectPure(env, f);
    }
  });

  it("a genuine { items: [] } is the honest no-channel answer; two channels still need a pick", async () => {
    const env = makeEnv();
    await connect(env);
    const none = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [] }) });
    expect(await body(await run(env, none, "/social/inbox/youtube/account"))).toMatchObject({
      needsSelection: true,
      channels: [],
    });
    const two = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [channel(), channel(CH2)] }) });
    const b = await body(await run(env, two, "/social/inbox/youtube/account"));
    expect(b.needsSelection).toBe(true);
    expect(b.channels).toHaveLength(2);
  });
});

describe("DT-6B-1-R1 B1-3: an unknown reply total stays unknown", () => {
  it("missing, null, non-numeric, negative or fractional totals are null; 0 and 7 stay", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await videoRef(env, a);
    const embedded = [comment("Ugtop1.r1", { parentId: "Ugtop1" })];
    const cases: [unknown, number | null][] = [
      ["missing", null],
      [null, null],
      ["garbage", null],
      ["3", null],
      [-1, null],
      [1.5, null],
      [0, 0],
      [7, 7],
    ];
    for (const [total, want] of cases) {
      const t = thread("Ugtop1", embedded, 0) as { snippet: Record<string, unknown> };
      if (total === "missing") delete t.snippet.totalReplyCount;
      else t.snippet.totalReplyCount = total;
      const f = mockFetch({ [`GET ${YT}/commentThreads`]: () => ({ items: [t] }) });
      const b = await body(await run(env, f, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`));
      expect((b.items as { totalReplyCount: unknown }[])[0].totalReplyCount).toBe(want);
    }
  });
});

describe("DT-6B-1-R1 B1-4: ids follow the id grammar, so every emitted ref is usable", () => {
  it("a fractional or unsafe video id makes the page malformed; a safe integer round-trips to the threads route", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const list = (videoId: unknown) =>
      mockFetch({
        [`GET ${YT}/playlistItems`]: () => ({ items: [{ contentDetails: { videoId } }] }),
      });
    for (const bad of [123.5, 2 ** 53, "a b", true]) {
      const b = await body(
        await run(env, list(bad), `/social/inbox/youtube/videos${q(a, { uploads: a.uploads! })}`),
      );
      expect(b).toMatchObject({ error: "upstream", coverage: "unavailable" });
    }
    const b = await body(
      await run(env, list(4242), `/social/inbox/youtube/videos${q(a, { uploads: a.uploads! })}`),
    );
    const [row] = b.items as { id: string; ref: string }[];
    expect(row.id).toBe("4242");
    const f = mockFetch({ [`GET ${YT}/commentThreads`]: () => ({ items: [] }) });
    const res = await run(env, f, `/social/inbox/youtube/videos/${row.ref}/threads${q(a)}`);
    expect(res.status).toBe(200);
    expect(f.urls()[0].searchParams.get("videoId")).toBe("4242");
  });

  it("a fractional top-level or reply id makes the page malformed", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await videoRef(env, a);
    for (const t of [thread("Ugtop1"), thread("Ugtop1", [comment("x")])]) {
      const bad = JSON.parse(JSON.stringify(t)) as {
        snippet: { topLevelComment: { id: unknown } };
        replies?: { comments: { id: unknown }[] };
      };
      if (bad.replies) bad.replies.comments[0].id = 2.5;
      else bad.snippet.topLevelComment.id = 1.5;
      const f = mockFetch({ [`GET ${YT}/commentThreads`]: () => ({ items: [bad] }) });
      const b = await body(await run(env, f, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`));
      expect(b).toMatchObject({ error: "upstream", coverage: "unavailable" });
    }
  });
});

// 📤 DT-6B-2A (planning/tools/37-inbox-send.md): the reads mint a separate sealed send target per thread, carrying the
// provider thread id, the video id and the top-level comment id (never assumed equal), and say whether the stored grant
// can send. The reads stay pure GETs.
describe("DT-6B-2A: send targets and the send capability on the reads", () => {
  it("a thread's sendRef opens as its send target; its nested replies carry the parent's sendRef", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await videoRef(env, a);
    const f = mockFetch({
      [`GET ${YT}/commentThreads`]: () => ({
        items: [
          { ...thread("Ugtop1", [comment("Ugtop1.r1", { parentId: "Ugtop1" })]), id: "UgThreadX" },
        ],
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`));
    const [row] = b.items as {
      id: string;
      ref: string;
      sendRef: string;
      replies: { sendRef: string; replyParentNote: boolean }[];
    }[];
    expect(row.id).toBe("Ugtop1");
    expect(row.sendRef).not.toBe(row.ref);
    expect(await openSendTarget(SEAL, row.sendRef)).toEqual({
      a: CH,
      g: a.generation,
      t: "UgThreadX",
      v: "vid1",
      c: "Ugtop1",
    });
    // The read ref never opens as a send target.
    expect(await openSendTarget(SEAL, row.ref)).toBeNull();
    expect(row.replies[0]).toMatchObject({ sendRef: row.sendRef, replyParentNote: true });
    expect(JSON.stringify(b)).not.toContain(SEAL);
    expectPure(env, f);
  });

  it("a thread without a usable thread id is still listed, without a send target", async () => {
    const env = makeEnv();
    await connect(env);
    const a = await account(env);
    const ref = await videoRef(env, a);
    const f = mockFetch({
      [`GET ${YT}/commentThreads`]: () => ({
        items: [{ ...thread("Ugtop1", [comment("Ugtop1.r1", { parentId: "Ugtop1" })]), id: 1.5 }],
      }),
    });
    const b = await body(await run(env, f, `/social/inbox/youtube/videos/${ref}/threads${q(a)}`));
    const [row] = b.items as Record<string, unknown>[];
    expect(row.id).toBe("Ugtop1");
    expect(row).not.toHaveProperty("sendRef");
    const [reply] = row.replies as Record<string, unknown>[];
    expect(reply).not.toHaveProperty("sendRef");
    expect(reply).not.toHaveProperty("replyParentNote");
  });

  it("sendComments is ok only for an actually stored force-ssl grant", async () => {
    for (const [scope, cap] of [
      [`${SCOPES} https://www.googleapis.com/auth/youtube.force-ssl`, "ok"],
      [`${SCOPES} https://www.googleapis.com/auth/youtube.upload`, "no_permission"],
      ["https://www.googleapis.com/auth/youtube", "no_permission"],
      [undefined, "no_permission"],
    ] as const) {
      const env = makeEnv();
      await connect(env, { scope });
      const f = mockFetch({ [`GET ${YT}/channels`]: () => ({ items: [channel()] }) });
      const b = await body(await run(env, f, "/social/inbox/youtube/account"));
      expect((b.capabilities as Record<string, string>).sendComments).toBe(cap);
      expectPure(env, f);
    }
  });
});
