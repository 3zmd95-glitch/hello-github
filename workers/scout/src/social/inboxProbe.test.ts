import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import type { ProbeReply } from "./inboxProbe";
import { Store } from "./store";
import type { SocialPlatform, TokenSet } from "./types";

/* ---------- fakes (copied from replies.test.ts) ---------- */

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-22T12:00:00Z");
const IG = "graph.instagram.com/v21.0";

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

/* ---------- the probe ---------- */

describe("GET /social/inbox/probe", () => {
  it("returns 5 conversations and the comments of the last 3 posts, clipped, with the call count", async () => {
    const env = makeEnv();
    await connect(env, "instagram", {
      accessToken: "instagram-token",
      issuedAt: "2026-10-22T00:00:00Z",
      canReply: true,
    });
    const writesAfterConnect = env.SOCIAL_KV.writes;
    const fetch = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: (u) => {
        expect(u.toString()).toContain("limit=5");
        expect(u.toString()).toContain("participants%7Bid%2Cusername%7D");
        return {
          data: [
            {
              id: "t1",
              updated_time: "2026-10-22T10:00:00+0000",
              participants: {
                data: [
                  { id: "9", username: "sara" },
                  { id: "17841", username: "3z.prod" },
                ],
              },
              messages: {
                data: [
                  {
                    id: "m1",
                    created_time: "2026-10-22T10:00:00+0000",
                    from: { id: "9" },
                    message: "x".repeat(300),
                  },
                ],
              },
            },
          ],
        };
      },
      [`GET ${IG}/17841/media`]: () => ({
        data: [
          {
            id: "p1",
            caption: "LUT reel",
            timestamp: "2026-10-20T10:00:00+0000",
            comments_count: 2,
          },
        ],
      }),
      [`GET ${IG}/p1/comments`]: () => ({
        data: [
          {
            id: "c1",
            text: "لت",
            username: "ali",
            timestamp: "2026-10-21T10:00:00+0000",
            replies: { data: [{ id: "c1r" }] },
          },
        ],
      }),
    });
    const res = await handle(req("/social/inbox/probe"), env, undefined, {
      fetch,
      now: () => NOW,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProbeReply;
    expect(body.igUserId).toBe("17841");
    expect(body.conversations[0]).toMatchObject({ id: "t1", peer: "sara" });
    expect(body.conversations[0].messages[0]).toMatchObject({ from: "them" });
    expect(body.conversations[0].messages[0].text).toHaveLength(120);
    expect(body.posts[0]).toMatchObject({ id: "p1", commentCount: 2 });
    expect(body.posts[0].comments[0]).toMatchObject({
      id: "c1",
      author: "ali",
      text: "لت",
      replies: 1,
    });
    expect(body.calls).toBe(4);
    expect(fetch.calls()).toHaveLength(4);
    expect(env.SOCIAL_KV.writes).toBe(writesAfterConnect); // read-only: no KV write
    expect(JSON.stringify(body)).not.toContain("instagram-token");
  });

  it("answers not_connected without Instagram and no_permission without canReply", async () => {
    const env = makeEnv();
    const r1 = await handle(req("/social/inbox/probe"), env, undefined, {
      fetch: mockFetch({}),
      now: () => NOW,
    });
    expect(r1.status).toBe(409);
    expect(await r1.json()).toEqual({ error: "not_connected" });
    await connect(env, "instagram", {
      accessToken: "t",
      issuedAt: "2026-10-22T00:00:00Z",
      canReply: false,
    });
    const r2 = await handle(req("/social/inbox/probe"), env, undefined, {
      fetch: mockFetch({}),
      now: () => NOW,
    });
    expect(r2.status).toBe(403);
    expect(await r2.json()).toEqual({ error: "no_permission" });
  });
});
