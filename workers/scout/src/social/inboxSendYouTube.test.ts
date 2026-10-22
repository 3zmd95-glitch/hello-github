import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { sealRef } from "./inboxReadCommon";
import { sealSendTarget, SEND_TEXT_MAX } from "./inboxSendYouTube";
import { SendCoordinator } from "./sendCoordinator";
import { Store } from "./store";
import type { TokenSet } from "./types";

// 📤 Reviewed YouTube public replies (packet DT-6B-2A, planning/tools/37-inbox-send.md): prepare (sealed send target,
// actual force-ssl grant, live token, bounded text, ONE preflight GET of the thread) → review → confirm (one claim in
// the coordinator before ONE comments.insert POST) → a receipt that is sent / rejected / unknown and recovers without
// a resend. Fake KV and fetch; the coordinator is the real SendCoordinator over node:sqlite, a new instance per call
// (a restart between every request). No provider is ever contacted.

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-17T09:00:00Z");
const YT = "www.googleapis.com/youtube/v3";
const CH = "UCaaaaaaaaaaaaaaaaaaaaaa";
const CH2 = "UCbbbbbbbbbbbbbbbbbbbbbb";
const UPLOADS = "UUaaaaaaaaaaaaaaaaaaaaaa";
const FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl";
const READ = "https://www.googleapis.com/auth/youtube.readonly";
const UPLOAD = "https://www.googleapis.com/auth/youtube.upload";
const SEND = "/social/inbox/youtube/send";

type FakeKV = KVNamespace & { writes: number };

function fakeKV(): FakeKV {
  const m = new Map<string, string>();
  const kv = {
    writes: 0,
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.writes += 1;
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  };
  return kv as unknown as FakeKV;
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

/** A Durable Object namespace whose objects are SendCoordinators over node:sqlite, one database per name. */
function fakeCoordinator() {
  const dbs = new Map<string, DatabaseSync>();
  const ns = {
    names: [] as string[],
    /** Calls (by `op`) that fail as a storage outage would. */
    failing: new Set<string>(),
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        ns.names.push(id);
        const call = JSON.parse(String(init.body)) as { op: string };
        if (ns.failing.has(call.op) || ns.failing.has("*")) throw new Error("storage down");
        if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
        const c = new SendCoordinator({ storage: sqliteStorage(dbs.get(id)!) } as never);
        return c.fetch(new Request(url, init));
      },
    }),
  };
  return ns;
}

type Coord = ReturnType<typeof fakeCoordinator>;
type TestEnv = Env & { SOCIAL_KV: FakeKV; SEND_COORDINATOR?: unknown };

const makeEnv = (coord: Coord | null = fakeCoordinator()): TestEnv => ({
  SCOUT_TOKEN: TOKEN,
  INBOX_SEAL_SECRET: SEAL,
  ALLOWED_ORIGINS: APP,
  SOCIAL_KV: fakeKV(),
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  ...(coord ? { SEND_COORDINATOR: coord as unknown as DurableObjectNamespace } : {}),
});

async function connect(env: TestEnv, tokens: Partial<TokenSet> = {}, connectedAt?: string) {
  const store = Store.from(env)!;
  await store.putTokens("youtube", {
    accessToken: "yt-live-token",
    refreshToken: "yt-refresh-token",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 3_000_000).toISOString(),
    scope: `${READ} ${FORCE_SSL}`,
    ...tokens,
  });
  await store.putStatus("youtube", {
    connectedAt: connectedAt ?? "2026-10-01T08:00:00.000Z",
    handle: "3zprod",
  });
  env.SOCIAL_KV.writes = 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const gErr = (status: number, reason: string) =>
  json({ error: { code: status, message: `nope ${reason}`, errors: [{ reason }] } }, status);

type Handler = (url: URL, init?: RequestInit) => unknown;

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const handler = routes[`${init?.method ?? "GET"} ${url.host}${url.pathname}`];
    if (!handler) return json({ error: { message: `unmocked ${url.pathname}` } }, 404);
    const out = await handler(url, init);
    return out instanceof Response ? out : json(out);
  });
  const calls = () =>
    fn.mock.calls.map(([input, init]) => ({
      method: init?.method ?? "GET",
      url: new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url),
      auth: new Headers(init?.headers).get("Authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }));
  const posts = () => calls().filter((c) => c.method === "POST");
  return Object.assign(fn, { calls, posts });
}

function req(path: string, init: RequestInit & { auth?: string | null; origin?: string } = {}) {
  const { auth = TOKEN, origin = APP, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth !== null) headers.set("Authorization", `Bearer ${auth}`);
  headers.set("Origin", origin);
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

const run = (env: Env, f: typeof fetch, path: string, init = {}, now = NOW) =>
  handle(req(path, init), env, undefined, { fetch: f, now: () => now });
const post = (env: Env, f: typeof fetch, path: string, body: unknown, now = NOW) =>
  run(
    env,
    f,
    path,
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    now,
  );
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- fixtures: a genuine send target from the owner's own listing ---------- */

const comment = (id: string) => ({
  id,
  snippet: {
    textDisplay: `comment ${id}`,
    authorDisplayName: "@fan_one",
    authorChannelId: { value: "UCfanfanfanfanfanfanfanf" },
    publishedAt: "2026-10-16T09:00:00Z",
  },
});

/** The thread resource as comments preflight sees it: its own id differs from the top-level comment id. */
const threadResource = (over: Record<string, unknown> = {}) => ({
  id: "UgThreadX",
  snippet: {
    channelId: CH,
    videoId: "vid1",
    canReply: true,
    isPublic: true,
    totalReplyCount: 0,
    topLevelComment: comment("UgTop1"),
    ...over,
  },
});

type Chan = { accountId: string; generation: string; uploads: string };

async function listing(env: TestEnv) {
  const f = mockFetch({
    [`GET ${YT}/channels`]: () => ({
      items: [
        {
          id: CH,
          snippet: { title: "3z" },
          contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
        },
      ],
    }),
    [`GET ${YT}/playlistItems`]: () => ({
      items: [{ snippet: { title: "v" }, contentDetails: { videoId: "vid1" } }],
    }),
    [`GET ${YT}/commentThreads`]: () => ({
      items: [
        {
          id: "UgThreadX",
          snippet: { totalReplyCount: 1, topLevelComment: comment("UgTop1") },
          replies: {
            comments: [
              { ...comment("UgTop1.r1"), snippet: { ...comment("x").snippet, parentId: "UgTop1" } },
            ],
          },
        },
      ],
    }),
  });
  const acc = await body(await run(env, f, "/social/inbox/youtube/account"));
  const a = (acc.channels as Chan[])[0];
  const q = `?account=${a.accountId}&generation=${a.generation}`;
  const vids = await body(
    await run(env, f, `/social/inbox/youtube/videos${q}&uploads=${a.uploads}`),
  );
  const vref = (vids.items as { ref: string }[])[0].ref;
  const th = await body(await run(env, f, `/social/inbox/youtube/videos/${vref}/threads${q}`));
  const row = (th.items as { ref: string; sendRef: string; replies: { sendRef?: string }[] }[])[0];
  env.SOCIAL_KV.writes = 0;
  return { a, row, sendRef: row.sendRef, commentRef: row.ref };
}

const preflight = (over: Record<string, unknown> = {}, extra: Record<string, Handler> = {}) =>
  mockFetch({
    [`GET ${YT}/commentThreads`]: () => ({ items: [threadResource(over)] }),
    [`POST ${YT}/comments`]: (_u, init) => ({
      kind: "youtube#comment",
      id: "UgTop1.newReply1",
      snippet: { parentId: JSON.parse(String(init?.body)).snippet.parentId, textOriginal: "x" },
    }),
    ...extra,
  });

let opSeq = 0;
const newOp = () => `op-${(++opSeq).toString().padStart(8, "0")}`;

async function prepared(
  env: TestEnv,
  f: ReturnType<typeof mockFetch>,
  text = "  Thanks for watching!  ",
) {
  const { a, sendRef } = await listing(env);
  const operationId = newOp();
  const res = await post(env, f, `${SEND}/prepare`, {
    operationId,
    sendRef,
    text,
    draftRevision: "rev-1",
  });
  const b = await body(res);
  return { a, sendRef, operationId, res, b, intent: b.intent as Record<string, string> };
}

afterEach(() => {
  vi.useRealTimers();
});

/* ---------- tests ---------- */

describe("send routes: auth, method and configuration before anything else", () => {
  it("refuses a missing bearer and a foreign origin before any provider or coordinator call", async () => {
    const coord = fakeCoordinator();
    const env = makeEnv(coord);
    await connect(env);
    const f = mockFetch({});
    for (const [path, method] of [
      [`${SEND}/prepare`, "POST"],
      [`${SEND}/confirm`, "POST"],
      [`${SEND}/op-00000001?account=${CH}`, "GET"],
      [`${SEND}/op-00000001/cancel`, "POST"],
    ]) {
      expect((await run(env, f, path, { method, auth: null })).status).toBe(401);
      expect((await run(env, f, path, { method, origin: "https://evil.example" })).status).toBe(
        403,
      );
    }
    expect((await run(env, f, `${SEND}/prepare`, { method: "GET" })).status).toBe(405);
    expect((await run(env, f, `${SEND}/confirm`, { method: "DELETE" })).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
    expect(coord.names).toEqual([]);
  });

  it("names the missing piece: KV, the seal key or the receipt store, distinctly", async () => {
    const f = mockFetch({});
    const noKv = { ...makeEnv(), SOCIAL_KV: undefined } as unknown as Env;
    const noSeal = makeEnv();
    delete noSeal.INBOX_SEAL_SECRET;
    const noStore = makeEnv(null);
    for (const [env, detail] of [
      [noKv, "kv"],
      [noSeal, "seal"],
      [noStore, "receipt-store"],
    ] as const) {
      if (env !== noKv) await connect(env as TestEnv);
      const res = await post(env, f, `${SEND}/prepare`, {});
      expect(res.status).toBe(503);
      expect(await body(res)).toEqual({ error: "not_configured", detail });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("requires the actual force-ssl grant: read-only, upload-only or no stored scope is no_permission", async () => {
    for (const scope of [READ, `${READ} ${UPLOAD}`, undefined, ""]) {
      const env = makeEnv();
      await connect(env, { scope });
      const f = mockFetch({});
      const res = await post(env, f, `${SEND}/prepare`, { operationId: newOp() });
      expect(res.status).toBe(403);
      expect(await body(res)).toEqual({ error: "no_permission" });
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("an expired access token is token_expired and is never refreshed; no connection is not_connected", async () => {
    const env = makeEnv();
    await connect(env, { expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    const f = mockFetch({});
    for (const path of [`${SEND}/prepare`, `${SEND}/confirm`]) {
      const res = await post(env, f, path, {});
      expect(res.status).toBe(409);
      expect(await body(res)).toEqual({ error: "token_expired" });
    }
    expect(f).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.writes).toBe(0);
    const bare = makeEnv();
    expect(await body(await post(bare, f, `${SEND}/prepare`, {}))).toEqual({
      error: "not_connected",
    });
  });
});

describe("prepare: sealed target, bounded text, one preflight GET, zero POST", () => {
  it("prepares the exact trimmed text for the authenticated parent with one GET and no POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = preflight();
    const { res, intent, operationId } = await prepared(env, f);
    expect(res.status).toBe(200);
    expect(intent).toMatchObject({
      operationId,
      state: "prepared",
      account: CH,
      threadId: "UgThreadX",
      videoId: "vid1",
      parentCommentId: "UgTop1",
      text: "Thanks for watching!",
      digest: await sha256("Thanks for watching!"),
      draftRevision: "rev-1",
      reviewExpiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    expect(f.posts()).toEqual([]);
    const gets = f.calls();
    expect(gets).toHaveLength(1);
    expect(gets[0].url.host).toBe("www.googleapis.com");
    expect(Object.fromEntries(gets[0].url.searchParams)).toEqual({
      part: "snippet",
      id: "UgThreadX",
    });
    expect(gets[0].auth).toBe("Bearer yt-live-token");
    expect(env.SOCIAL_KV.writes).toBe(0);
    const text = JSON.stringify(intent);
    expect(text).not.toContain("yt-live-token");
    expect(text).not.toContain(SEAL);
  });

  it("refuses forged, read-kind, cross-provider, cross-account and stale refs before any call", async () => {
    const env = makeEnv();
    await connect(env);
    const { a, sendRef } = await listing(env);
    const target = { a: CH, g: a.generation, t: "UgThreadX", v: "vid1", c: "UgTop1" };
    const forged = await sealSendTarget("another-secret-0123456789abcdef0123456789", target);
    const readRef = await sealRef(SEAL, {
      p: "youtube",
      a: CH,
      g: a.generation,
      k: "comment",
      id: "UgTop1",
    });
    const otherAccount = await sealSendTarget(SEAL, { ...target, a: CH2 });
    const oldGeneration = await sealSendTarget(SEAL, { ...target, g: "f".repeat(32) });
    const f = preflight();
    for (const [ref, code] of [
      [forged, "target_invalid"],
      [readRef, "target_invalid"],
      ["x.y", "target_invalid"],
      [`${sendRef}x`, "target_invalid"],
      [otherAccount, "stale"],
      [oldGeneration, "stale"],
    ]) {
      const res = await post(env, f, `${SEND}/prepare`, {
        operationId: newOp(),
        sendRef: ref,
        text: "hi",
        draftRevision: "rev-1",
      });
      expect(await body(res)).toEqual({ error: code });
    }
    // A reconnect changes the generation: the old listing's ref is stale.
    await connect(env, {}, "2026-10-16T08:00:00.000Z");
    expect(
      await body(
        await post(env, f, `${SEND}/prepare`, {
          operationId: newOp(),
          sendRef,
          text: "hi",
          draftRevision: "r",
        }),
      ),
    ).toEqual({ error: "stale" });
    expect(f).not.toHaveBeenCalled();
  });

  it("a Threads-domain seal never opens as a YouTube send target", async () => {
    const env = makeEnv();
    await connect(env);
    const { a } = await listing(env);
    const threads = await sealRef(SEAL, {
      p: "threads",
      a: CH,
      g: a.generation,
      k: "comment",
      id: "UgTop1",
    });
    const f = preflight();
    expect(
      await body(
        await post(env, f, `${SEND}/prepare`, {
          operationId: newOp(),
          sendRef: threads,
          text: "x",
          draftRevision: "r",
        }),
      ),
    ).toEqual({ error: "target_invalid" });
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses empty, blank and over-long text, and malformed ids, before any call", async () => {
    const env = makeEnv();
    await connect(env);
    const { sendRef } = await listing(env);
    const f = preflight();
    for (const [over, code] of [
      [{ text: "" }, "text_invalid"],
      [{ text: "  \n " }, "text_invalid"],
      [{ text: "x".repeat(SEND_TEXT_MAX + 1) }, "text_invalid"],
      [{ text: 7 }, "text_invalid"],
      [{ operationId: "short" }, "bad_request"],
      [{ operationId: "op/../x-12345" }, "bad_request"],
      [{ draftRevision: "" }, "bad_request"],
    ] as [Record<string, unknown>, string][]) {
      const res = await post(env, f, `${SEND}/prepare`, {
        operationId: newOp(),
        sendRef,
        text: "fine",
        draftRevision: "rev-1",
        ...over,
      });
      expect(await body(res)).toEqual({ error: code });
    }
    // Exactly SEND_TEXT_MAX after trimming is fine.
    const ok = await post(env, f, `${SEND}/prepare`, {
      operationId: newOp(),
      sendRef,
      text: ` ${"y".repeat(SEND_TEXT_MAX)} `,
      draftRevision: "rev-1",
    });
    expect(ok.status).toBe(200);
    expect(f.posts()).toEqual([]);
  });

  it("the preflight refuses a private, closed, deleted or mismatched thread with distinct codes and stores nothing", async () => {
    for (const [f, code] of [
      [preflight({ isPublic: false }), "not_public"],
      [preflight({ canReply: false }), "not_replyable"],
      [preflight({ videoId: "vid2" }), "target_invalid"],
      [preflight({ channelId: CH2 }), "target_invalid"],
      [preflight({ topLevelComment: comment("UgOther") }), "target_invalid"],
      [
        preflight(
          {},
          {
            [`GET ${YT}/commentThreads`]: () => ({
              items: [{ ...threadResource(), id: "UgThreadY" }],
            }),
          },
        ),
        "target_invalid",
      ],
      [preflight({}, { [`GET ${YT}/commentThreads`]: () => ({ items: [] }) }), "not_found"],
      [
        preflight({}, { [`GET ${YT}/commentThreads`]: () => gErr(404, "commentThreadNotFound") }),
        "not_found",
      ],
      [
        preflight({}, { [`GET ${YT}/commentThreads`]: () => gErr(403, "commentsDisabled") }),
        "not_replyable",
      ],
      [
        preflight({}, { [`GET ${YT}/commentThreads`]: () => gErr(403, "quotaExceeded") }),
        "rate_limited",
      ],
      [
        preflight({}, { [`GET ${YT}/commentThreads`]: () => gErr(403, "forbidden") }),
        "no_permission",
      ],
      [
        preflight({}, { [`GET ${YT}/commentThreads`]: () => gErr(401, "authError") }),
        "token_expired",
      ],
      [preflight({}, { [`GET ${YT}/commentThreads`]: () => ({}) }), "upstream"],
      [
        preflight(
          {},
          { [`GET ${YT}/commentThreads`]: () => new Response("<html>", { status: 200 }) },
        ),
        "upstream",
      ],
    ] as const) {
      const env = makeEnv();
      await connect(env);
      const { operationId, b, a } = await prepared(env, f);
      expect(b).toEqual({ error: code });
      expect(f.posts()).toEqual([]);
      expect(f.calls()).toHaveLength(1);
      expect(
        await body(await run(env, f, `${SEND}/${operationId}?account=${a.accountId}`)),
      ).toEqual({
        error: "not_found",
      });
    }
  });

  it("a coordinator outage at prepare is receipt_unavailable, never a send", async () => {
    const coord = fakeCoordinator();
    const env = makeEnv(coord);
    await connect(env);
    coord.failing.add("prepare");
    const f = preflight();
    const { res, b } = await prepared(env, f);
    expect(res.status).toBe(503);
    expect(b).toEqual({ error: "receipt_unavailable" });
    expect(f.posts()).toEqual([]);
  });

  it("selects one coordinator per provider and account", async () => {
    const coord = fakeCoordinator();
    const env = makeEnv(coord);
    await connect(env);
    await prepared(env, preflight());
    expect(new Set(coord.names)).toEqual(new Set([`youtube|${CH}`]));
  });
});

describe("review: status and cancel make no provider call", () => {
  it("GET status returns the prepared intent; cancel ends it; a cancelled intent never sends", async () => {
    const env = makeEnv();
    await connect(env);
    const f = preflight();
    const { operationId, intent } = await prepared(env, f);
    const status = await body(await run(env, f, `${SEND}/${operationId}?account=${CH}`));
    expect(status.intent).toEqual(intent);
    const cancelled = await body(
      await post(env, f, `${SEND}/${operationId}/cancel`, { account: CH }),
    );
    expect((cancelled.intent as { state: string }).state).toBe("cancelled");
    const confirm = await body(
      await post(env, f, `${SEND}/confirm`, { operationId, digest: intent.digest, account: CH }),
    );
    expect((confirm.intent as { state: string }).state).toBe("cancelled");
    expect(f.posts()).toEqual([]);
    expect(f.calls()).toHaveLength(1); // the one prepare preflight
  });

  it("an unknown operation or a malformed account is refused", async () => {
    const env = makeEnv();
    await connect(env);
    const f = mockFetch({});
    expect((await run(env, f, `${SEND}/op-99999999?account=${CH}`)).status).toBe(404);
    expect((await run(env, f, `${SEND}/op-99999999?account=a/b`)).status).toBe(400);
    expect((await run(env, f, `${SEND}/bad?account=${CH}`)).status).toBe(400);
  });
});

describe("confirm: one claim, then one POST with the exact reviewed parent and text", () => {
  it("sends {snippet:{parentId,textOriginal}} once and stores the provider comment id; recovery never resends", async () => {
    const env = makeEnv();
    await connect(env);
    const f = preflight();
    const { operationId, intent } = await prepared(env, f);
    const res = await post(env, f, `${SEND}/confirm`, {
      operationId,
      digest: intent.digest,
      account: CH,
    });
    expect(res.status).toBe(200);
    expect((await body(res)).intent).toMatchObject({
      operationId,
      state: "sent",
      providerCommentId: "UgTop1.newReply1",
    });
    const posts = f.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0].url.toString()).toBe(
      "https://www.googleapis.com/youtube/v3/comments?part=snippet",
    );
    expect(posts[0].body).toEqual({
      snippet: { parentId: "UgTop1", textOriginal: "Thanks for watching!" },
    });
    expect(posts[0].auth).toBe("Bearer yt-live-token");
    // A lost acknowledgement: the status and a repeated confirm return the same receipt, no second POST.
    expect(
      (await body(await run(env, f, `${SEND}/${operationId}?account=${CH}`))).intent,
    ).toMatchObject({
      state: "sent",
      providerCommentId: "UgTop1.newReply1",
    });
    expect(
      (
        await body(
          await post(env, f, `${SEND}/confirm`, {
            operationId,
            digest: intent.digest,
            account: CH,
          }),
        )
      ).intent,
    ).toMatchObject({ state: "sent" });
    expect(f.posts()).toHaveLength(1);
    expect(env.SOCIAL_KV.writes).toBe(0);
  });

  it("two concurrent confirms make one POST and both answer the one operation", async () => {
    const env = makeEnv();
    await connect(env);
    // The provider answer is held until the second confirm has answered, so both overlap for real.
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const f = preflight(
      {},
      {
        [`POST ${YT}/comments`]: async () => {
          await hold;
          return { id: "UgTop1.newReply1", snippet: { parentId: "UgTop1" } };
        },
      },
    );
    const { operationId, intent } = await prepared(env, f);
    const confirm = () =>
      post(env, f, `${SEND}/confirm`, { operationId, digest: intent.digest, account: CH }).then(
        body,
      );
    const x = confirm();
    const y = confirm();
    const firstDone = await Promise.race([x, y]);
    expect(firstDone.intent).toMatchObject({ operationId, state: "dispatching" });
    release();
    const states = (await Promise.all([x, y])).map((r) => (r.intent as { state: string }).state);
    expect(states.sort()).toEqual(["dispatching", "sent"]);
    expect(f.posts()).toHaveLength(1);
  });

  it("two tabs preparing the same saved draft with different operation ids converge: one POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = preflight();
    const first = await prepared(env, f);
    const second = await post(env, f, `${SEND}/prepare`, {
      operationId: newOp(),
      sendRef: first.sendRef,
      text: "Thanks for watching!",
      draftRevision: "rev-1",
    });
    const converged = (await body(second)).intent as Record<string, string>;
    expect(converged.operationId).toBe(first.operationId);
    for (const op of [first.operationId, converged.operationId])
      await post(env, f, `${SEND}/confirm`, {
        operationId: op,
        digest: first.intent.digest,
        account: CH,
      });
    expect(f.posts()).toHaveLength(1);
  });

  it("the same operation id with changed text conflicts; a changed digest at confirm conflicts; zero POST", async () => {
    const env = makeEnv();
    await connect(env);
    const f = preflight();
    const { operationId, sendRef, intent } = await prepared(env, f);
    expect(
      await body(
        await post(env, f, `${SEND}/prepare`, {
          operationId,
          sendRef,
          text: "other",
          draftRevision: "rev-1",
        }),
      ),
    ).toEqual({ error: "conflict" });
    expect(
      await body(
        await post(env, f, `${SEND}/confirm`, { operationId, digest: "c".repeat(64), account: CH }),
      ),
    ).toEqual({ error: "conflict" });
    expect(
      await body(
        await post(env, f, `${SEND}/confirm`, { operationId, digest: "nothex", account: CH }),
      ),
    ).toEqual({ error: "bad_request" });
    expect(f.posts()).toEqual([]);
    expect(
      (await body(await run(env, f, `${SEND}/${operationId}?account=${CH}`))).intent,
    ).toMatchObject({
      state: "prepared",
      digest: intent.digest,
    });
  });

  it("an expired review, a reconnect or a lost grant before confirm sends nothing", async () => {
    const env = makeEnv();
    await connect(env);
    const f = preflight();
    const { operationId, intent } = await prepared(env, f);
    const late = new Date(NOW.getTime() + 600_000);
    const expired = await body(
      await post(
        env,
        f,
        `${SEND}/confirm`,
        { operationId, digest: intent.digest, account: CH },
        late,
      ),
    );
    expect((expired.intent as { state: string }).state).toBe("expired");

    const again = await prepared(env, f, "second text");
    await connect(env, {}, "2026-10-16T08:00:00.000Z");
    expect(
      await body(
        await post(env, f, `${SEND}/confirm`, {
          operationId: again.operationId,
          digest: again.intent.digest,
          account: CH,
        }),
      ),
    ).toEqual({ error: "stale" });
    await connect(env, { scope: READ });
    expect(
      await body(
        await post(env, f, `${SEND}/confirm`, {
          operationId: again.operationId,
          digest: again.intent.digest,
          account: CH,
        }),
      ),
    ).toEqual({ error: "no_permission" });
    expect(f.posts()).toEqual([]);
  });

  it("a coordinator outage before the claim is receipt_unavailable with zero POST", async () => {
    const coord = fakeCoordinator();
    const env = makeEnv(coord);
    await connect(env);
    const f = preflight();
    const { operationId, intent } = await prepared(env, f);
    for (const op of ["get", "claim"]) {
      coord.failing.clear();
      coord.failing.add(op);
      const res = await post(env, f, `${SEND}/confirm`, {
        operationId,
        digest: intent.digest,
        account: CH,
      });
      expect(res.status).toBe(503);
      expect(await body(res)).toEqual({ error: "receipt_unavailable" });
    }
    expect(f.posts()).toEqual([]);
  });
});

describe("confirm outcomes: classified once, never retried", () => {
  const outcome = async (reply: Handler) => {
    const env = makeEnv();
    await connect(env);
    const f = preflight({}, { [`POST ${YT}/comments`]: reply });
    const { operationId, intent } = await prepared(env, f);
    const res = await post(env, f, `${SEND}/confirm`, {
      operationId,
      digest: intent.digest,
      account: CH,
    });
    const first = (await body(res)).intent as Record<string, string>;
    // A second confirm and a status read never POST again.
    const second = (
      await body(
        await post(env, f, `${SEND}/confirm`, { operationId, digest: intent.digest, account: CH }),
      )
    ).intent as Record<string, string>;
    const status = (await body(await run(env, f, `${SEND}/${operationId}?account=${CH}`))).intent;
    expect(f.posts()).toHaveLength(1);
    return { first, second, status, text: JSON.stringify([first, second, status]) };
  };

  it("documented refusals are rejected with their reason", async () => {
    for (const [reply, code] of [
      [() => gErr(403, "insufficientPermissions"), "insufficientPermissions"],
      [() => gErr(403, "forbidden"), "forbidden"],
      [() => gErr(403, "commentsDisabled"), "commentsDisabled"],
      [() => gErr(400, "processingFailure"), "processingFailure"],
      [() => gErr(403, "quotaExceeded"), "quotaExceeded"],
      [() => gErr(404, "parentNotFound"), "parentNotFound"],
      [() => json({ error: { code: 400, message: "bad" } }, 400), "http_400"],
    ] as const) {
      const { first, second, status, text } = await outcome(reply);
      expect(first).toMatchObject({ state: "rejected", failureCode: code });
      expect(second).toMatchObject({ state: "rejected" });
      expect(status).toMatchObject({ state: "rejected" });
      expect(text).not.toContain("yt-live-token");
    }
  });

  it("a malformed success, a broken connection and a 5xx are unknown, with the reason", async () => {
    for (const [reply, reason] of [
      [() => ({ kind: "youtube#comment" }), "malformed"],
      [() => ({ id: "ok.id", snippet: { parentId: "UgSomeoneElse" } }), "malformed"],
      [() => new Response("not json", { status: 200 }), "malformed"],
      [() => new Response("x".repeat(300 * 1024), { status: 200 }), "malformed"],
      [() => Promise.reject(new TypeError("network")), "network"],
      [() => json({ error: { code: 503, message: "backend" } }, 503), "server"],
      [() => new Response("teapot", { status: 418 }), "server"],
    ] as const) {
      const { first, second, status } = await outcome(reply);
      expect(first).toMatchObject({ state: "unknown", unknownReason: reason });
      expect(second).toMatchObject({ state: "unknown", unknownReason: reason });
      expect(status).toMatchObject({ state: "unknown" });
    }
  });

  it("a POST that outlives 15 seconds is aborted and stays unknown (timeout)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = makeEnv();
    await connect(env);
    const f = preflight(
      {},
      {
        [`POST ${YT}/comments`]: (_u, init) =>
          new Promise((_, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      },
    );
    const { operationId, intent } = await prepared(env, f);
    const pending = post(env, f, `${SEND}/confirm`, {
      operationId,
      digest: intent.digest,
      account: CH,
    });
    // Once the POST is in flight, 15 seconds pass.
    while (!f.posts().length) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(f.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await body(await pending)).intent).toMatchObject({
      state: "unknown",
      unknownReason: "timeout",
    });
    expect(f.posts()).toHaveLength(1);
  });

  it("a provider success whose receipt cannot be written is unknown; the claim stays and nothing resends", async () => {
    const coord = fakeCoordinator();
    const env = makeEnv(coord);
    await connect(env);
    const f = preflight();
    const { operationId, intent } = await prepared(env, f);
    coord.failing.add("settle");
    const first = await body(
      await post(env, f, `${SEND}/confirm`, { operationId, digest: intent.digest, account: CH }),
    );
    expect(first.intent).toMatchObject({ state: "unknown", unknownReason: "receipt" });
    coord.failing.clear();
    // After a restart the coordinator still holds the claim: dispatching, never claimable again.
    const status = await body(await run(env, f, `${SEND}/${operationId}?account=${CH}`));
    expect(status.intent).toMatchObject({ state: "dispatching" });
    const again = await body(
      await post(env, f, `${SEND}/confirm`, { operationId, digest: intent.digest, account: CH }),
    );
    expect(again.intent).toMatchObject({ state: "dispatching" });
    expect(f.posts()).toHaveLength(1);
  });
});

describe("DT-6B-2A-R1: contradictory success, request byte budget, seal scrub", () => {
  const confirmWith = async (reply: Handler) => {
    const env = makeEnv();
    await connect(env);
    const f = preflight({}, { [`POST ${YT}/comments`]: reply });
    const { operationId, intent } = await prepared(env, f);
    const args = { operationId, digest: intent.digest, account: CH };
    const first = (await body(await post(env, f, `${SEND}/confirm`, args))).intent;
    const again = (await body(await post(env, f, `${SEND}/confirm`, args))).intent;
    const status = (await body(await run(env, f, `${SEND}/${operationId}?account=${CH}`))).intent;
    expect(f.posts()).toHaveLength(1);
    return [first, again, status] as Record<string, string>[];
  };

  it("2A-10: a 2xx carrying an error object or a non-comment kind is unknown, never sent", async () => {
    for (const reply of [
      () => ({ id: "reply1", snippet: { parentId: "UgTop1" }, error: { code: 503, message: "x" } }),
      () => ({ kind: "youtube#commentThread", id: "reply1", snippet: { parentId: "UgTop1" } }),
      () => ({ id: "reply1", error: null }),
    ])
      for (const i of await confirmWith(reply)) expect(i).toMatchObject({ state: "unknown" });
    // The ordinary receipt (with or without kind) still is sent.
    for (const reply of [
      () => ({ kind: "youtube#comment", id: "reply1", snippet: { parentId: "UgTop1" } }),
      () => ({ id: "reply1", snippet: { parentId: "UgTop1" } }),
    ])
      for (const i of await confirmWith(reply))
        expect(i).toMatchObject({ state: "sent", providerCommentId: "reply1" });
  });

  it("2A-11: an oversized request body is cancelled at the byte budget before parsing, on every POST route", async () => {
    const env = makeEnv();
    await connect(env);
    for (const path of [`${SEND}/prepare`, `${SEND}/confirm`, `${SEND}/op-bytes0001/cancel`]) {
      let chunks = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (chunks === 20) return c.close();
          chunks += 1;
          c.enqueue(new TextEncoder().encode("x".repeat(4096)));
        },
        cancel() {
          cancelled = true;
        },
      });
      const f = preflight();
      const res = await handle(
        req(path, { method: "POST", body: stream, duplex: "half" } as RequestInit),
        env,
        undefined,
        { fetch: f, now: () => NOW },
      );
      expect(await body(res)).toEqual({ error: "bad_request" });
      expect(chunks).toBeLessThanOrEqual(6);
      expect(cancelled).toBe(true);
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("2A-11: a valid Unicode body near the budget still parses; the 2,000-character text bound is unchanged", async () => {
    const env = makeEnv();
    await connect(env);
    const f = preflight();
    const { sendRef } = await listing(env);
    // 2,000 Arabic letters are 4,000 UTF-8 bytes: inside the 16,384-byte budget, at the text limit.
    const text = "ب".repeat(SEND_TEXT_MAX);
    const ok = await body(
      await post(env, f, `${SEND}/prepare`, {
        operationId: newOp(),
        sendRef,
        text,
        draftRevision: "rev-1",
      }),
    );
    expect(ok.intent).toMatchObject({ state: "prepared", text });
    const over = await body(
      await post(env, f, `${SEND}/prepare`, {
        operationId: newOp(),
        sendRef,
        text: text + "ب",
        draftRevision: "rev-1",
      }),
    );
    expect(over).toEqual({ error: "text_invalid" });
    expect(f.posts()).toEqual([]);
  });

  it("a provider refusal echoing the seal key or the token never keeps either in the receipt", async () => {
    const answers = await confirmWith(() =>
      json(
        { error: { message: `refused ${SEAL} yt-live-token`, errors: [{ reason: "forbidden" }] } },
        403,
      ),
    );
    expect(answers[0]).toMatchObject({ state: "rejected", failureCode: "forbidden" });
    const text = JSON.stringify(answers);
    expect(text).not.toContain(SEAL);
    expect(text).not.toContain("yt-live-token");
  });
});
