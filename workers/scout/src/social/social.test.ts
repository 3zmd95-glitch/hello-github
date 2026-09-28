import { describe, expect, it, vi } from "vitest";
import worker from "../index";
import { handle, type Env } from "../scout";
import { decryptJson, encryptJson, pkceChallenge } from "./crypto";
import { IG_REFRESH_AFTER_DAYS } from "./instagram";
import { keys, Store, type OAuthState } from "./store";
import { CRON_PLATFORMS, runScheduled, syncAll, syncPlatform } from "./sync";
import { addDays, riyadhDay, riyadhIso } from "./time";
import type { DemographicRow, PostRow, SnapshotRow, TokenSet } from "./types";

/* ---------- fixtures & fakes ---------- */

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
/** 2026-09-27 12:00 Riyadh. */
const NOW = new Date("2026-09-27T09:00:00Z");
const TODAY = "2026-09-27";
const now = () => NOW;

type KVEntry = { value: string; metadata?: unknown; expirationTtl?: number };
type FakeKV = KVNamespace & { store: Map<string, KVEntry> };

/** In-memory KV: sorted keys, `limit`/`cursor` paging, metadata on list. */
function fakeKV(): FakeKV {
  const store = new Map<string, KVEntry>();
  const kv = {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { metadata?: unknown; expirationTtl?: number }) {
      store.set(key, { value, metadata: opts?.metadata, expirationTtl: opts?.expirationTtl });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts?: { prefix?: string; cursor?: string; limit?: number }) {
      const all = [...store.keys()]
        .filter((k) => !opts?.prefix || k.startsWith(opts.prefix))
        .sort();
      const start = opts?.cursor ? Number(opts.cursor) : 0;
      const limit = opts?.limit ?? 1000;
      const page = all.slice(start, start + limit);
      const done = start + limit >= all.length;
      return {
        keys: page.map((name) => ({ name, metadata: store.get(name)?.metadata })),
        list_complete: done,
        cursor: done ? undefined : String(start + limit),
        cacheStatus: null,
      };
    },
  };
  return kv as unknown as FakeKV;
}

/** `kv: null` = no SOCIAL_KV binding. */
function makeEnv(kv: KVNamespace | null = fakeKV(), extra: Partial<Env> = {}): Env {
  return {
    SCOUT_TOKEN: TOKEN,
    ALLOWED_ORIGINS: `http://localhost:3000,${APP}`,
    SOCIAL_KV: kv ?? undefined,
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    TIKTOK_CLIENT_KEY: "tt-key",
    TIKTOK_CLIENT_SECRET: "tt-secret",
    ...extra,
  };
}

function req(
  path: string,
  init: RequestInit & { token?: string | null; origin?: string | null; json?: unknown } = {},
): Request {
  const { token = TOKEN, origin = APP, json: body, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (origin !== null) headers.set("Origin", origin);
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    rest.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

type Handler = (url: URL, init: RequestInit | undefined, form: URLSearchParams) => unknown;

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Every provider endpoint the Worker talks to, answered with fixtures for the owner's four accounts. */
const DEFAULTS: Record<string, Handler> = {
  // Instagram OAuth
  "api.instagram.com/oauth/access_token": () => ({
    access_token: "ig-short",
    user_id: 178,
    permissions: ["instagram_business_basic", "instagram_business_manage_insights"],
  }),
  "graph.instagram.com/access_token": () => ({
    access_token: "ig-long",
    token_type: "bearer",
    expires_in: 5_184_000,
  }),
  "graph.instagram.com/refresh_access_token": () => ({
    access_token: "ig-refreshed",
    token_type: "bearer",
    expires_in: 5_184_000,
  }),
  // Instagram sync
  "graph.instagram.com/v21.0/me": () => ({
    user_id: "178",
    username: "3z.prod",
    followers_count: 272,
    media_count: 40,
  }),
  "graph.instagram.com/v21.0/me/media": () => ({
    data: [
      {
        id: "m1",
        timestamp: "2026-09-20T10:00:00+0000",
        media_product_type: "REELS",
        media_type: "VIDEO",
        like_count: 30,
        comments_count: 4,
        permalink: "https://www.instagram.com/reel/AAA/",
        thumbnail_url: "https://cdn.example/1.jpg",
        caption: "Match cut\nmore lines",
      },
      {
        id: "m2",
        timestamp: "2026-09-10T08:30:00+0000",
        media_product_type: "FEED",
        media_type: "IMAGE",
        like_count: 12,
        comments_count: 1,
        permalink: "https://www.instagram.com/p/BBB/",
        media_url: "https://cdn.example/2.jpg",
      },
    ],
    paging: { cursors: { before: "x", after: "y" } },
  }),
  "graph.instagram.com/v21.0/me/stories": () => ({
    data: [{ id: "s1", timestamp: "2026-09-27T05:00:00+0000", media_type: "IMAGE" }],
  }),
  "graph.instagram.com/v21.0/s1/insights": () => ({
    data: [{ name: "views", period: "lifetime", values: [{ value: 50 }] }],
  }),
  "graph.instagram.com/v21.0/m1/insights": () => ({
    data: [
      { name: "views", total_value: { value: 1000 } },
      { name: "reach", total_value: { value: 900 } },
      { name: "likes", total_value: { value: 31 } },
      { name: "comments", total_value: { value: 4 } },
      { name: "shares", total_value: { value: 7 } },
      { name: "saved", total_value: { value: 9 } },
      { name: "ig_reels_avg_watch_time", total_value: { value: 5400 } },
    ],
  }),
  "graph.instagram.com/v21.0/m2/insights": () => ({
    data: [
      { name: "views", values: [{ value: 200 }] },
      { name: "likes", values: [{ value: 12 }] },
      { name: "comments", values: [{ value: 1 }] },
      { name: "shares", values: [{ value: 0 }] },
      { name: "saved", values: [{ value: 2 }] },
    ],
  }),
  "graph.instagram.com/v21.0/me/insights": (url) => {
    const breakdown = url.searchParams.get("breakdown");
    if (!breakdown) {
      return {
        data: [
          { name: "reach", total_value: { value: 3000 } },
          { name: "views", total_value: { value: 4321 } },
        ],
      };
    }
    const results: Record<string, [string, number][]> = {
      age: [
        ["18-24", 30],
        ["25-34", 70],
      ],
      gender: [
        ["M", 60],
        ["F", 30],
        ["U", 10],
      ],
      country: [
        ["SA", 90],
        ["AE", 10],
      ],
      city: [
        ["Riyadh, Riyadh Region", 50],
        ["Jeddah, Makkah Region", 50],
      ],
    };
    return {
      data: [
        {
          name: "follower_demographics",
          total_value: {
            breakdowns: [
              {
                dimension_keys: [breakdown],
                results: results[breakdown].map(([k, v]) => ({ dimension_values: [k], value: v })),
              },
            ],
          },
        },
      ],
    };
  },
  // Threads OAuth
  "graph.threads.net/oauth/access_token": () => ({ access_token: "th-short", user_id: 9 }),
  "graph.threads.net/access_token": () => ({
    access_token: "th-long",
    token_type: "bearer",
    expires_in: 5_184_000,
  }),
  "graph.threads.net/refresh_access_token": () => ({
    access_token: "th-refreshed",
    expires_in: 5_184_000,
  }),
  // Threads sync
  "graph.threads.net/v1.0/me": () => ({ id: "9", username: "3z.prod" }),
  "graph.threads.net/v1.0/me/threads_insights": (url) => {
    const metric = url.searchParams.get("metric") ?? "";
    if (metric === "followers_count") {
      return { data: [{ name: "followers_count", total_value: { value: 3 } }] };
    }
    return {
      data: [
        { name: "views", values: [{ value: 100 }, { value: 20 }] },
        { name: "likes", total_value: { value: 5 } },
      ],
    };
  },
  "graph.threads.net/v1.0/me/threads": () => ({
    data: [
      {
        id: "t1",
        timestamp: "2026-09-25T12:00:00+0000",
        text: "Hello threads",
        permalink: "https://www.threads.net/@3z.prod/post/X",
        media_type: "TEXT",
      },
    ],
  }),
  "graph.threads.net/v1.0/t1/insights": () => ({
    data: [
      { name: "views", values: [{ value: 120 }] },
      { name: "likes", values: [{ value: 5 }] },
      { name: "replies", values: [{ value: 2 }] },
      { name: "reposts", values: [{ value: 1 }] },
      { name: "quotes", values: [{ value: 1 }] },
      { name: "shares", values: [{ value: 3 }] },
    ],
  }),
  // Google OAuth
  "oauth2.googleapis.com/token": (_url, _init, form) =>
    form.get("grant_type") === "refresh_token"
      ? { access_token: "ya29-refreshed", expires_in: 3599, scope: "s", token_type: "Bearer" }
      : {
          access_token: "ya29-first",
          expires_in: 3599,
          refresh_token: "1//refresh",
          scope: "https://www.googleapis.com/auth/youtube.readonly",
          token_type: "Bearer",
        },
  // YouTube sync
  "www.googleapis.com/youtube/v3/channels": () => ({
    items: [
      {
        id: "UC1",
        snippet: { title: "3z Prod", customUrl: "@3zprod" },
        statistics: { subscriberCount: "6", videoCount: "2", viewCount: "500" },
        contentDetails: { relatedPlaylists: { uploads: "UU1" } },
      },
    ],
  }),
  "www.googleapis.com/youtube/v3/playlistItems": () => ({
    items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }],
  }),
  "www.googleapis.com/youtube/v3/videos": () => ({
    items: [
      {
        id: "v1",
        snippet: {
          publishedAt: "2026-09-01T15:00:00Z",
          title: "Long video",
          thumbnails: { medium: { url: "https://i.ytimg.com/vi/v1/mqdefault.jpg" } },
        },
        statistics: { viewCount: "300", likeCount: "20", commentCount: "3" },
        contentDetails: { duration: "PT10M5S" },
      },
      {
        id: "v2",
        snippet: { publishedAt: "2026-09-15T09:00:00Z", title: "Short one", thumbnails: {} },
        statistics: { viewCount: "200", likeCount: "15", commentCount: "1" },
        contentDetails: { duration: "PT45S" },
      },
    ],
  }),
  "youtubeanalytics.googleapis.com/v2/reports": (url) => {
    const dims = url.searchParams.get("dimensions");
    if (dims === "creatorContentType") {
      return {
        columnHeaders: [
          { name: "creatorContentType" },
          { name: "views" },
          { name: "estimatedMinutesWatched" },
          { name: "averageViewDuration" },
          { name: "likes" },
          { name: "comments" },
          { name: "shares" },
          { name: "subscribersGained" },
        ],
        rows: [
          ["SHORTS", 200, 10, 18.5, 15, 1, 2, 1],
          ["VIDEO_ON_DEMAND", 300, 40, 95, 20, 3, 4, 2],
        ],
      };
    }
    if (dims === "ageGroup,gender") {
      return {
        columnHeaders: [{ name: "ageGroup" }, { name: "gender" }, { name: "viewerPercentage" }],
        rows: [
          ["age18-24", "male", 40],
          ["age18-24", "female", 10],
          ["age25-34", "male", 50],
        ],
      };
    }
    return {
      columnHeaders: [{ name: "country" }, { name: "views" }],
      rows: [
        ["SA", 400],
        ["EG", 100],
      ],
    };
  },
  // TikTok OAuth
  "open.tiktokapis.com/v2/oauth/token/": (_url, _init, form) => ({
    access_token: form.get("grant_type") === "refresh_token" ? "tt-refreshed" : "tt-first",
    expires_in: 86_400,
    open_id: "o1",
    refresh_expires_in: 31_536_000,
    refresh_token: "tt-refresh",
    scope: "user.info.basic,user.info.profile,user.info.stats,video.list",
    token_type: "Bearer",
  }),
  // TikTok sync
  "open.tiktokapis.com/v2/user/info/": () => ({
    data: {
      user: {
        open_id: "o1",
        display_name: "3z",
        username: "3z.prod",
        avatar_url: "https://p16.example/a.jpg",
        follower_count: 1200,
        following_count: 10,
        likes_count: 5000,
        video_count: 2,
        profile_deep_link: "https://www.tiktok.com/@3z.prod",
      },
    },
    error: { code: "ok", message: "", log_id: "l1" },
  }),
  "open.tiktokapis.com/v2/video/list/": () => ({
    data: {
      videos: [
        {
          id: "7300000000000000001",
          create_time: unix("2026-09-20T10:00:00Z"),
          title: "Match cut in CapCut #capcut",
          cover_image_url: "https://p16.example/c1.jpg",
          share_url: "https://www.tiktok.com/@3z.prod/video/7300000000000000001",
          view_count: 10_000,
          like_count: 800,
          comment_count: 20,
          share_count: 40,
          duration: 32,
        },
        {
          id: "7200000000000000002",
          create_time: unix("2026-06-01T10:00:00Z"),
          title: "Old one",
          cover_image_url: "https://p16.example/c2.jpg",
          share_url: "https://www.tiktok.com/@3z.prod/video/7200000000000000002",
          view_count: 5000,
          like_count: 300,
          comment_count: 5,
          share_count: 10,
          duration: 15,
        },
      ],
      cursor: 1_717_000_000_000,
      has_more: false,
    },
    error: { code: "ok", message: "", log_id: "l2" },
  }),
};

/** A mocked fetch answering from DEFAULTS, with per-endpoint overrides (`host/path` → handler). */
function mockFetch(overrides: Record<string, Handler> = {}) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const key = `${url.host}${url.pathname}`;
    const handler = overrides[key] ?? DEFAULTS[key];
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    if (!handler) {
      return new Response(JSON.stringify({ error: { message: `unmocked ${key}`, code: 100 } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const out = handler(url, init, form);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const calls = () =>
    fn.mock.calls.map(([input]) => {
      const u = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      return `${u.host}${u.pathname}`;
    });
  return Object.assign(fn, { calls });
}

const jsonRes = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stores a decryptable token set as the callback would. */
async function connectDirect(
  env: Env,
  platform: "instagram" | "threads" | "youtube" | "tiktok",
  tokens: Partial<TokenSet> = {},
) {
  const store = Store.from(env)!;
  await store.putTokens(platform, {
    accessToken: `${platform}-token`,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    ...tokens,
  });
  await store.putStatus(platform, { connectedAt: NOW.toISOString() });
}

async function kvJson<T>(kv: FakeKV, key: string): Promise<T> {
  return JSON.parse(kv.store.get(key)!.value) as T;
}

const byJson = (a: unknown, b: unknown) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);

/* ---------- unit: crypto & time ---------- */

describe("crypto", () => {
  it("round-trips JSON through AES-GCM and rejects another secret", async () => {
    const blob = await encryptJson("k1", { a: 1, s: "x" });
    expect(blob.startsWith("v1.")).toBe(true);
    expect(await decryptJson("k1", blob)).toEqual({ a: 1, s: "x" });
    expect(await decryptJson("k2", blob)).toBeNull();
    expect(await decryptJson("k1", "garbage")).toBeNull();
    // Fresh IV every time.
    expect(await encryptJson("k1", { a: 1 })).not.toBe(await encryptJson("k1", { a: 1 }));
  });

  it("computes the RFC 7636 S256 challenge", async () => {
    // Appendix B of RFC 7636.
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("time", () => {
  it("uses Riyadh (UTC+3) day keys and offsets", () => {
    expect(riyadhDay("2026-09-27T21:30:00Z")).toBe("2026-09-28");
    expect(riyadhDay("2026-09-27T20:59:59Z")).toBe("2026-09-27");
    expect(riyadhIso("2026-09-20T10:00:00+0000")).toBe("2026-09-20T13:00:00+03:00");
    expect(riyadhIso(NOW)).toBe("2026-09-27T12:00:00+03:00");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

/* ---------- health, auth, CORS ---------- */

describe("health.social", () => {
  it("reports which platforms have credentials and whether KV is bound", async () => {
    const res = await handle(
      req("/health"),
      makeEnv(fakeKV(), { TIKTOK_CLIENT_SECRET: undefined }),
    );
    const body = (await res.json()) as { social: unknown };
    expect(body.social).toEqual({
      configured: { instagram: true, threads: true, youtube: true, tiktok: false },
      kv: true,
    });
    const noKv = await handle(req("/health"), makeEnv(null));
    expect(((await noKv.json()) as { social: { kv: boolean } }).social.kv).toBe(false);
  });
});

describe("auth and CORS on the social routes", () => {
  it("requires the bearer token on every /social route", async () => {
    const env = makeEnv();
    for (const r of [
      req("/social/status", { token: null }),
      req("/social/data", { token: "wrong" }),
      req("/social/connect/tiktok", { method: "POST", token: null, json: { returnTo: APP } }),
      req("/social/connect/tiktok", { method: "DELETE", token: null }),
      req("/social/sync", { method: "POST", token: null, json: {} }),
    ]) {
      const res = await handle(r, env, undefined, { now });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("refuses unknown origins and reflects allowed ones, including DELETE in the preflight", async () => {
    const env = makeEnv();
    const bad = await handle(req("/social/status", { origin: "https://evil.example" }), env);
    expect(bad.status).toBe(403);
    const pre = await handle(
      req("/social/connect/tiktok", { method: "OPTIONS", token: null }),
      env,
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Methods")).toMatch(/DELETE/);
    const ok = await handle(req("/social/status"), env, undefined, { now });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("answers 404 for unknown /social paths and wrong methods", async () => {
    const env = makeEnv();
    expect((await handle(req("/social/nope"), env)).status).toBe(404);
    expect(
      (await handle(req("/social/connect/tiktok/extra", { method: "POST" }), env)).status,
    ).toBe(404);
    expect((await handle(req("/social/status", { method: "POST" }), env)).status).toBe(404);
  });
});

/* ---------- connect ---------- */

describe("POST /social/connect/:platform", () => {
  const RETURN = `${APP}/3z-prod/social/growth/`;

  async function connect(env: Env, platform: string, body: unknown = { returnTo: RETURN }) {
    return handle(
      req(`/social/connect/${platform}`, { method: "POST", json: body }),
      env,
      undefined,
      {
        now,
      },
    );
  }

  it("builds the Instagram URL and stores the state for ten minutes", async () => {
    const kv = fakeKV();
    const res = await connect(makeEnv(kv), "instagram");
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("meta-id");
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/oauth/instagram/callback`);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_insights",
    );
    const nonce = u.searchParams.get("state")!;
    expect(nonce.length).toBeGreaterThanOrEqual(40);
    const entry = kv.store.get(`state:${nonce}`)!;
    expect(entry.expirationTtl).toBe(600);
    expect(JSON.parse(entry.value)).toEqual({
      platform: "instagram",
      returnTo: RETURN,
      createdAt: NOW.toISOString(),
    });
    expect(u.searchParams.has("code_challenge")).toBe(false);
  });

  it("builds the Threads URL", async () => {
    const { url } = (await (await connect(makeEnv(), "threads")).json()) as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.threads.com/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe("threads_basic,threads_manage_insights");
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/oauth/threads/callback`);
  });

  it("builds the Google URL with offline access and PKCE, verifier stored with the state", async () => {
    const kv = fakeKV();
    const { url } = (await (await connect(makeEnv(kv), "youtube")).json()) as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("google-id");
    expect(u.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
    );
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("include_granted_scopes")).toBe("true");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const state = JSON.parse(
      kv.store.get(`state:${u.searchParams.get("state")}`)!.value,
    ) as OAuthState;
    expect(state.verifier!.length).toBeGreaterThanOrEqual(43);
    expect(u.searchParams.get("code_challenge")).toBe(await pkceChallenge(state.verifier!));
  });

  it("builds the TikTok URL with client_key and PKCE", async () => {
    const kv = fakeKV();
    const { url } = (await (await connect(makeEnv(kv), "tiktok")).json()) as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(u.searchParams.get("client_key")).toBe("tt-key");
    expect(u.searchParams.get("scope")).toBe(
      "user.info.basic,user.info.profile,user.info.stats,video.list",
    );
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/oauth/tiktok/callback`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const state = JSON.parse(
      kv.store.get(`state:${u.searchParams.get("state")}`)!.value,
    ) as OAuthState;
    expect(u.searchParams.get("code_challenge")).toBe(await pkceChallenge(state.verifier!));
  });

  it("rejects a returnTo outside ALLOWED_ORIGINS, bad bodies and unknown platforms", async () => {
    const env = makeEnv();
    expect((await connect(env, "tiktok", { returnTo: "https://evil.example/x" })).status).toBe(400);
    expect((await connect(env, "tiktok", { returnTo: "javascript:alert(1)" })).status).toBe(400);
    expect((await connect(env, "tiktok", {})).status).toBe(400);
    expect((await connect(env, "snapchat")).status).toBe(400);
    const raw = await handle(
      req("/social/connect/tiktok", { method: "POST", body: "{nope" }),
      env,
      undefined,
      { now },
    );
    expect(raw.status).toBe(400);
  });

  it("answers not_configured without credentials or without KV", async () => {
    const noCreds = await connect(makeEnv(fakeKV(), { TIKTOK_CLIENT_KEY: undefined }), "tiktok");
    expect(noCreds.status).toBe(503);
    expect(await noCreds.json()).toEqual({ error: "not_configured" });
    const noKv = await connect(makeEnv(null), "tiktok");
    expect(noKv.status).toBe(503);
  });
});

/* ---------- callback ---------- */

describe("GET /oauth/:platform/callback", () => {
  const RETURN = `${APP}/3z-prod/social/growth/?tab=ig#top`;

  async function seedState(
    env: Env,
    platform: OAuthState["platform"],
    extra: Partial<OAuthState> = {},
  ) {
    const nonce = `nonce-${platform}`;
    await Store.from(env)!.putState(nonce, {
      platform,
      returnTo: RETURN,
      createdAt: NOW.toISOString(),
      ...extra,
    });
    return nonce;
  }

  function callback(env: Env, platform: string, query: string, fetchMock = mockFetch()) {
    return handle(new Request(`${BASE}/oauth/${platform}/callback?${query}`), env, undefined, {
      fetch: fetchMock,
      now,
    });
  }

  async function expectConnected(res: Response, platform: string) {
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe(`${APP}/3z-prod/social/growth/`);
    expect(loc.searchParams.get("tab")).toBe("ig");
    expect(loc.searchParams.get("connected")).toBe(platform);
    expect(loc.hash).toBe("#top");
  }

  it("Instagram: exchanges, upgrades to long-lived, stores encrypted, syncs, redirects", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const nonce = await seedState(env, "instagram");
    const fetchMock = mockFetch();
    const res = await callback(env, "instagram", `code=abc%23_&state=${nonce}`, fetchMock);
    await expectConnected(res, "instagram");

    // The exchange calls, in order, then the sync.
    expect(fetchMock.calls().slice(0, 3)).toEqual([
      "api.instagram.com/oauth/access_token",
      "graph.instagram.com/access_token",
      "graph.instagram.com/v21.0/me",
    ]);
    const exchangeForm = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(exchangeForm.get("code")).toBe("abc");
    expect(exchangeForm.get("redirect_uri")).toBe(`${BASE}/oauth/instagram/callback`);
    expect(exchangeForm.get("client_secret")).toBe("meta-secret");

    // Tokens are unreadable in KV and decrypt with SCOUT_TOKEN.
    const raw = kv.store.get("tokens:instagram")!.value;
    expect(raw.startsWith("v1.")).toBe(true);
    expect(raw).not.toContain("ig-long");
    const tokens = await decryptJson<TokenSet>(TOKEN, raw);
    expect(tokens).toMatchObject({
      accessToken: "ig-long",
      userId: "178",
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 5_184_000_000).toISOString(),
    });
    expect(await Store.from(env)!.getTokens("instagram")).toEqual(tokens);

    // State is one-time.
    expect(kv.store.has(`state:${nonce}`)).toBe(false);
    const again = await callback(env, "instagram", `code=abc&state=${nonce}`);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "state_invalid" });

    // Initial sync ran: status + today's snapshot.
    expect(await kvJson(kv, "status:instagram")).toEqual({
      connectedAt: NOW.toISOString(),
      handle: "3z.prod",
      url: "https://www.instagram.com/3z.prod/",
      lastSyncAt: NOW.toISOString(),
      tokenExpiresAt: tokens!.expiresAt,
    });
    expect(kv.store.has(`snap:instagram:${TODAY}`)).toBe(true);
  });

  it("Threads: same flow on graph.threads.net", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const nonce = await seedState(env, "threads");
    const fetchMock = mockFetch();
    await expectConnected(
      await callback(env, "threads", `code=c&state=${nonce}`, fetchMock),
      "threads",
    );
    expect(fetchMock.calls().slice(0, 2)).toEqual([
      "graph.threads.net/oauth/access_token",
      "graph.threads.net/access_token",
    ]);
    const tokens = await Store.from(env)!.getTokens("threads");
    expect(tokens?.accessToken).toBe("th-long");
    expect(tokens?.userId).toBe("9");
    expect((await kvJson<{ handle: string }>(kv, "status:threads")).handle).toBe("3z.prod");
  });

  it("YouTube: sends the PKCE verifier and keeps the refresh token", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const nonce = await seedState(env, "youtube", { verifier: "the-verifier" });
    const fetchMock = mockFetch();
    await expectConnected(
      await callback(env, "youtube", `code=g&state=${nonce}`, fetchMock),
      "youtube",
    );
    const form = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(fetchMock.calls()[0]).toBe("oauth2.googleapis.com/token");
    expect(form.get("code_verifier")).toBe("the-verifier");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe("google-id");
    const tokens = await Store.from(env)!.getTokens("youtube");
    expect(tokens).toMatchObject({
      accessToken: "ya29-first",
      refreshToken: "1//refresh",
      expiresAt: new Date(NOW.getTime() + 3_599_000).toISOString(),
    });
    // Fresh token: the initial sync does not refresh.
    expect(fetchMock.calls().filter((c) => c === "oauth2.googleapis.com/token")).toHaveLength(1);
    expect((await kvJson<{ handle: string }>(kv, "status:youtube")).handle).toBe("3zprod");
  });

  it("TikTok: form-encoded exchange with client_key and verifier", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const nonce = await seedState(env, "tiktok", { verifier: "tt-verifier" });
    const fetchMock = mockFetch();
    await expectConnected(
      await callback(env, "tiktok", `code=t&state=${nonce}`, fetchMock),
      "tiktok",
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("client_key")).toBe("tt-key");
    expect(form.get("code_verifier")).toBe("tt-verifier");
    expect(form.get("redirect_uri")).toBe(`${BASE}/oauth/tiktok/callback`);
    const tokens = await Store.from(env)!.getTokens("tiktok");
    expect(tokens).toMatchObject({
      accessToken: "tt-first",
      refreshToken: "tt-refresh",
      userId: "o1",
    });
    // A token issued this second is not refreshed by the initial sync.
    expect(
      fetchMock.calls().filter((c) => c === "open.tiktokapis.com/v2/oauth/token/"),
    ).toHaveLength(1);
    expect((await kvJson<{ handle: string }>(kv, "status:tiktok")).handle).toBe("3z.prod");
  });

  it("rejects a missing or unknown state without redirecting", async () => {
    const env = makeEnv();
    const res = await callback(env, "tiktok", "code=t&state=unknown");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "state_invalid" });
    expect((await callback(env, "tiktok", "code=t")).status).toBe(400);
  });

  it("redirects with connect_error when the state is for another platform or too old", async () => {
    const env = makeEnv();
    const nonce = await seedState(env, "tiktok");
    const res = await callback(env, "youtube", `code=t&state=${nonce}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.searchParams.get("connect_error")).toBe("youtube");
    expect(loc.searchParams.get("reason")).toBe("state_invalid");

    const old = await seedState(env, "tiktok", {
      createdAt: new Date(NOW.getTime() - 11 * 60_000).toISOString(),
    });
    const stale = await callback(env, "tiktok", `code=t&state=${old}`);
    expect(new URL(stale.headers.get("Location")!).searchParams.get("reason")).toBe(
      "state_invalid",
    );
  });

  it("redirects with connect_error when the owner denied or the exchange failed", async () => {
    const env = makeEnv();
    const denied = await seedState(env, "instagram");
    const res = await callback(
      env,
      "instagram",
      `error=access_denied&error_reason=user_denied&state=${denied}`,
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.searchParams.get("connect_error")).toBe("instagram");
    expect(loc.searchParams.get("reason")).toBe("access_denied");
    expect(await Store.from(env)!.getTokens("instagram")).toBeNull();

    const failing = await seedState(env, "youtube", { verifier: "v" });
    const fetchMock = mockFetch({
      "oauth2.googleapis.com/token": () => jsonRes({ error: "invalid_grant" }, 400),
    });
    const bad = await callback(env, "youtube", `code=x&state=${failing}`, fetchMock);
    expect(new URL(bad.headers.get("Location")!).searchParams.get("reason")).toBe(
      "exchange_failed",
    );

    const noCode = await seedState(env, "tiktok");
    const missing = await callback(env, "tiktok", `state=${noCode}`);
    expect(new URL(missing.headers.get("Location")!).searchParams.get("reason")).toBe(
      "bad_request",
    );
  });

  it("answers not_configured when the platform has no credentials", async () => {
    const env = makeEnv(fakeKV(), { GOOGLE_CLIENT_SECRET: undefined });
    const nonce = await seedState(env, "youtube");
    const res = await callback(env, "youtube", `code=x&state=${nonce}`);
    expect(new URL(res.headers.get("Location")!).searchParams.get("reason")).toBe("not_configured");
    expect((await callback(makeEnv(null), "youtube", "code=x&state=n")).status).toBe(503);
  });

  it("still connects when the initial sync fails, recording the error in the status", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const nonce = await seedState(env, "tiktok", { verifier: "v" });
    const fetchMock = mockFetch({
      "open.tiktokapis.com/v2/user/info/": () =>
        jsonRes({ error: { code: "rate_limit_exceeded" } }, 429),
    });
    await expectConnected(
      await callback(env, "tiktok", `code=t&state=${nonce}`, fetchMock),
      "tiktok",
    );
    expect(await kvJson(kv, "status:tiktok")).toEqual({
      connectedAt: NOW.toISOString(),
      lastError: "rate_limited",
      tokenExpiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    });
  });
});

/* ---------- refresh logic ---------- */

describe("token refresh", () => {
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it("Instagram: refreshes a long-lived token older than 30 days, not a younger one", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "instagram", {
      issuedAt: daysAgo(IG_REFRESH_AFTER_DAYS + 1),
      expiresAt: daysAgo(-29),
    });
    let fetchMock = mockFetch();
    expect(await syncPlatform(env, "instagram", { fetch: fetchMock, now: NOW })).toEqual({
      ok: true,
    });
    expect(fetchMock.calls()[0]).toBe("graph.instagram.com/refresh_access_token");
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("grant_type")).toBe(
      "ig_refresh_token",
    );
    const tokens = await Store.from(env)!.getTokens("instagram");
    expect(tokens?.accessToken).toBe("ig-refreshed");
    expect(tokens?.issuedAt).toBe(NOW.toISOString());

    fetchMock = mockFetch();
    await syncPlatform(env, "instagram", { fetch: fetchMock, now: NOW });
    expect(fetchMock.calls()).not.toContain("graph.instagram.com/refresh_access_token");
  });

  it("Instagram: an expired long-lived token means reconnect", async () => {
    const env = makeEnv();
    await connectDirect(env, "instagram", { issuedAt: daysAgo(61), expiresAt: daysAgo(1) });
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "instagram", { fetch: fetchMock, now: NOW })).toEqual({
      ok: false,
      error: "token_expired",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await Store.from(env)!.getStatus("instagram"))?.lastError).toBe("token_expired");
  });

  it("Threads: refreshes by age with th_refresh_token", async () => {
    const env = makeEnv();
    await connectDirect(env, "threads", { issuedAt: daysAgo(40), expiresAt: daysAgo(-20) });
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "threads", { fetch: fetchMock, now: NOW })).toEqual({
      ok: true,
    });
    expect(fetchMock.calls()[0]).toBe("graph.threads.net/refresh_access_token");
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("grant_type")).toBe(
      "th_refresh_token",
    );
    expect((await Store.from(env)!.getTokens("threads"))?.accessToken).toBe("th-refreshed");
  });

  it("Google: refreshes an expired access token with the refresh token, keeps it on reply", async () => {
    const env = makeEnv();
    await connectDirect(env, "youtube", {
      refreshToken: "1//refresh",
      issuedAt: daysAgo(1),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), // inside the 5-minute margin
    });
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "youtube", { fetch: fetchMock, now: NOW })).toEqual({
      ok: true,
    });
    expect(fetchMock.calls()[0]).toBe("oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("1//refresh");
    const tokens = await Store.from(env)!.getTokens("youtube");
    expect(tokens).toMatchObject({ accessToken: "ya29-refreshed", refreshToken: "1//refresh" });
    // The refreshed bearer is what the API calls use.
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe(
      "Bearer ya29-refreshed",
    );
  });

  it("Google: a valid access token is used as is", async () => {
    const env = makeEnv();
    await connectDirect(env, "youtube", { refreshToken: "r", expiresAt: daysAgo(-1) });
    const fetchMock = mockFetch();
    await syncPlatform(env, "youtube", { fetch: fetchMock, now: NOW });
    expect(fetchMock.calls()).not.toContain("oauth2.googleapis.com/token");
  });

  it("Google: invalid_grant on refresh → token_expired (reconnect)", async () => {
    const env = makeEnv();
    await connectDirect(env, "youtube", { refreshToken: "r", expiresAt: daysAgo(1) });
    const fetchMock = mockFetch({
      "oauth2.googleapis.com/token": () => jsonRes({ error: "invalid_grant" }, 400),
    });
    expect(await syncPlatform(env, "youtube", { fetch: fetchMock, now: NOW })).toEqual({
      ok: false,
      error: "token_expired",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await Store.from(env)!.getStatus("youtube"))?.lastError).toBe("token_expired");
  });

  it("TikTok: refreshes before every sync (24-hour tokens)", async () => {
    const env = makeEnv();
    await connectDirect(env, "tiktok", {
      refreshToken: "tt-refresh",
      issuedAt: daysAgo(1),
      expiresAt: daysAgo(0),
    });
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "tiktok", { fetch: fetchMock, now: NOW })).toEqual({ ok: true });
    expect(fetchMock.calls()).toEqual([
      "open.tiktokapis.com/v2/oauth/token/",
      "open.tiktokapis.com/v2/user/info/",
      "open.tiktokapis.com/v2/video/list/",
    ]);
    const form = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("client_key")).toBe("tt-key");
    expect((await Store.from(env)!.getTokens("tiktok"))?.accessToken).toBe("tt-refreshed");

    const dead = mockFetch({
      "open.tiktokapis.com/v2/oauth/token/": () =>
        jsonRes({ error: "invalid_grant", error_description: "Refresh token is invalid" }, 400),
    });
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect(await syncPlatform(env, "tiktok", { fetch: dead, now: tomorrow })).toEqual({
      ok: false,
      error: "token_expired",
    });
  });
});

/* ---------- sync mapping per platform ---------- */

describe("sync mapping", () => {
  it("Instagram: snapshot, posts (stories, reels, images) and demographics", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "instagram");
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "instagram", { fetch: fetchMock, now: NOW })).toEqual({
      ok: true,
    });

    expect(await kvJson(kv, `snap:instagram:${TODAY}`)).toEqual({
      platform: "instagram",
      day: TODAY,
      followers: 272,
      views30d: 4321,
      avgStoryViews: 50,
      totalPosts: 40,
    });
    const posts = await kvJson<Record<string, PostRow>>(kv, "posts:instagram");
    expect(posts).toEqual({
      s1: {
        platform: "instagram",
        postId: "s1",
        publishedAt: "2026-09-27T08:00:00+03:00",
        kind: "story",
        views: 50,
      },
      m1: {
        platform: "instagram",
        postId: "m1",
        publishedAt: "2026-09-20T13:00:00+03:00",
        kind: "reel",
        likes: 31,
        comments: 4,
        title: "Match cut",
        permalink: "https://www.instagram.com/reel/AAA/",
        thumbUrl: "https://cdn.example/1.jpg",
        views: 1000,
        shares: 7,
        saves: 9,
        watchTimeS: 5.4,
      },
      m2: {
        platform: "instagram",
        postId: "m2",
        publishedAt: "2026-09-10T11:30:00+03:00",
        kind: "image",
        likes: 12,
        comments: 1,
        permalink: "https://www.instagram.com/p/BBB/",
        thumbUrl: "https://cdn.example/2.jpg",
        views: 200,
        shares: 0,
        saves: 2,
      },
    });
    const demo = await kvJson<DemographicRow[]>(kv, `demo:instagram:${TODAY}`);
    const row = (dimension: string, key: string, pct: number) => ({
      platform: "instagram",
      day: TODAY,
      dimension,
      key,
      pct,
    });
    expect(demo).toEqual([
      row("age", "18-24", 30),
      row("age", "25-34", 70),
      row("gender", "male", 66.67),
      row("gender", "female", 33.33),
      row("country", "SA", 90),
      row("country", "AE", 10),
      row("city", "Riyadh, Riyadh Region", 50),
      row("city", "Jeddah, Makkah Region", 50),
    ]);
    // Account insights ask for the trailing 30 days as totals.
    const account = fetchMock.mock.calls
      .map(([u]) => new URL(String(u)))
      .find((u) => u.pathname === "/v21.0/me/insights" && !u.searchParams.has("breakdown"))!;
    expect(account.searchParams.get("metric_type")).toBe("total_value");
    expect(account.searchParams.get("period")).toBe("day");
    const since = Number(account.searchParams.get("since"));
    const until = Number(account.searchParams.get("until"));
    expect(until).toBe(Math.floor(NOW.getTime() / 1000));
    expect(until - since).toBeLessThanOrEqual(30 * 86_400);
    // Demographics: four breakdowns of follower_demographics.
    const breakdowns = fetchMock.mock.calls
      .map(([u]) => new URL(String(u)).searchParams.get("breakdown"))
      .filter(Boolean);
    expect(breakdowns).toEqual(["age", "gender", "country", "city"]);
  });

  it("Instagram: skips demographics under 100 followers and keeps old story rows for the average", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "instagram");
    // A story from a week ago, stored by an earlier daily sync, and one too old to count.
    kv.store.set("posts:instagram", {
      value: JSON.stringify({
        s0: {
          platform: "instagram",
          postId: "s0",
          publishedAt: riyadhIso(NOW.getTime() - 7 * 86_400_000),
          kind: "story",
          views: 150,
        },
        sOld: {
          platform: "instagram",
          postId: "sOld",
          publishedAt: riyadhIso(NOW.getTime() - 40 * 86_400_000),
          kind: "story",
          views: 9999,
        },
      }),
    });
    const fetchMock = mockFetch({
      "graph.instagram.com/v21.0/me": () => ({
        username: "tiny",
        followers_count: 42,
        media_count: 2,
      }),
    });
    await syncPlatform(env, "instagram", { fetch: fetchMock, now: NOW });
    expect(
      fetchMock.calls().filter((c) => c === "graph.instagram.com/v21.0/me/insights"),
    ).toHaveLength(1);
    expect(kv.store.has(`demo:instagram:${TODAY}`)).toBe(false);
    const snap = await kvJson<SnapshotRow>(kv, `snap:instagram:${TODAY}`);
    expect(snap.avgStoryViews).toBe(100); // (150 + 50) / 2
    const posts = await kvJson<Record<string, PostRow>>(kv, "posts:instagram");
    expect(Object.keys(posts).sort()).toEqual(["m1", "m2", "s0", "s1", "sOld"]);
  });

  it("Instagram: per-media insights stop at the budget, rows keep the basic counts", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "instagram");
    const fetchMock = mockFetch();
    // me + media + stories = 3, reserve 5 (account + 4 breakdowns) → one insight call fits.
    await syncPlatform(env, "instagram", { fetch: fetchMock, now: NOW, budget: 9 });
    const insightCalls = fetchMock.calls().filter((c) => /\/v21\.0\/(s1|m1|m2)\/insights$/.test(c));
    expect(insightCalls).toEqual(["graph.instagram.com/v21.0/s1/insights"]);
    const posts = await kvJson<Record<string, PostRow>>(kv, "posts:instagram");
    expect(posts.m1).toEqual({
      platform: "instagram",
      postId: "m1",
      publishedAt: "2026-09-20T13:00:00+03:00",
      kind: "reel",
      likes: 30,
      comments: 4,
      title: "Match cut",
      permalink: "https://www.instagram.com/reel/AAA/",
      thumbUrl: "https://cdn.example/1.jpg",
    });
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("Threads: followers from threads_insights, thread rows with replies→comments and reshares→shares", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "threads");
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "threads", { fetch: fetchMock, now: NOW })).toEqual({
      ok: true,
    });
    expect(await kvJson(kv, `snap:threads:${TODAY}`)).toEqual({
      platform: "threads",
      day: TODAY,
      followers: 3,
      views30d: 120,
      totalPosts: 1,
    });
    expect(await kvJson(kv, "posts:threads")).toEqual({
      t1: {
        platform: "threads",
        postId: "t1",
        publishedAt: "2026-09-25T15:00:00+03:00",
        kind: "thread",
        title: "Hello threads",
        permalink: "https://www.threads.net/@3z.prod/post/X",
        views: 120,
        likes: 5,
        comments: 2,
        shares: 5,
      },
    });
    expect(kv.store.has(`demo:threads:${TODAY}`)).toBe(false);
    expect(await kvJson(kv, "status:threads")).toMatchObject({
      handle: "3z.prod",
      url: "https://www.threads.net/@3z.prod",
      lastSyncAt: NOW.toISOString(),
    });
  });

  it("YouTube: subscribers, shorts vs videos, watch times and demographics", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "youtube", { refreshToken: "r" });
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "youtube", { fetch: fetchMock, now: NOW })).toEqual({
      ok: true,
    });
    expect(await kvJson(kv, `snap:youtube:${TODAY}`)).toEqual({
      platform: "youtube",
      day: TODAY,
      followers: 6,
      views30d: 500,
      totalPosts: 2,
      avgVideoWatchTime: 95,
      avgShortsWatchTime: 18.5,
    });
    expect(await kvJson(kv, "posts:youtube")).toEqual({
      v1: {
        platform: "youtube",
        postId: "v1",
        publishedAt: "2026-09-01T18:00:00+03:00",
        kind: "video",
        views: 300,
        likes: 20,
        comments: 3,
        permalink: "https://www.youtube.com/watch?v=v1",
        title: "Long video",
        thumbUrl: "https://i.ytimg.com/vi/v1/mqdefault.jpg",
      },
      v2: {
        platform: "youtube",
        postId: "v2",
        publishedAt: "2026-09-15T12:00:00+03:00",
        kind: "short",
        views: 200,
        likes: 15,
        comments: 1,
        permalink: "https://www.youtube.com/watch?v=v2",
        title: "Short one",
      },
    });
    const demo = await kvJson<DemographicRow[]>(kv, `demo:youtube:${TODAY}`);
    const row = (dimension: string, key: string, pct: number, gender?: string) => ({
      platform: "youtube",
      day: TODAY,
      dimension,
      key,
      pct,
      ...(gender ? { gender } : {}),
    });
    expect([...demo].sort(byJson)).toEqual(
      [
        row("age", "18-24", 40, "male"),
        row("age", "18-24", 10, "female"),
        row("age", "25-34", 50, "male"),
        row("gender", "male", 90),
        row("gender", "female", 10),
        row("age", "18-24", 50),
        row("age", "25-34", 50),
        row("country", "SA", 80),
        row("country", "EG", 20),
      ].sort(byJson),
    );
    // The calls: channels, playlistItems, videos, three reports — with the bearer token.
    expect(fetchMock.calls()).toEqual([
      "www.googleapis.com/youtube/v3/channels",
      "www.googleapis.com/youtube/v3/playlistItems",
      "www.googleapis.com/youtube/v3/videos",
      "youtubeanalytics.googleapis.com/v2/reports",
      "youtubeanalytics.googleapis.com/v2/reports",
      "youtubeanalytics.googleapis.com/v2/reports",
    ]);
    const report = new URL(String(fetchMock.mock.calls[3][0]));
    expect(report.searchParams.get("ids")).toBe("channel==MINE");
    expect(report.searchParams.get("startDate")).toBe(addDays(TODAY, -30));
    expect(report.searchParams.get("endDate")).toBe(TODAY);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe(
      "Bearer youtube-token",
    );
    expect(await kvJson(kv, "status:youtube")).toMatchObject({
      handle: "3zprod",
      url: "https://www.youtube.com/@3zprod",
    });
  });

  it("YouTube: a missing Analytics API is not fatal; a 401 is token_expired", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "youtube", { refreshToken: "r" });
    const noAnalytics = mockFetch({
      "youtubeanalytics.googleapis.com/v2/reports": () =>
        jsonRes(
          {
            error: {
              code: 403,
              message: "API not enabled",
              errors: [{ reason: "accessNotConfigured" }],
            },
          },
          403,
        ),
    });
    expect(await syncPlatform(env, "youtube", { fetch: noAnalytics, now: NOW })).toEqual({
      ok: true,
    });
    expect(await kvJson(kv, `snap:youtube:${TODAY}`)).toEqual({
      platform: "youtube",
      day: TODAY,
      followers: 6,
      totalPosts: 2,
    });
    const dead = mockFetch({
      "www.googleapis.com/youtube/v3/channels": () => jsonRes({ error: { code: 401 } }, 401),
    });
    expect(await syncPlatform(env, "youtube", { fetch: dead, now: NOW })).toEqual({
      ok: false,
      error: "token_expired",
    });
    const quota = mockFetch({
      "www.googleapis.com/youtube/v3/channels": () =>
        jsonRes({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403),
    });
    expect(await syncPlatform(env, "youtube", { fetch: quota, now: NOW })).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("TikTok: followers, video rows, 30-day views from recent videos, no demographics", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    // A day-old token, as the cron finds it: refreshed first.
    await connectDirect(env, "tiktok", {
      refreshToken: "tt-refresh",
      issuedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
    });
    const fetchMock = mockFetch();
    expect(await syncPlatform(env, "tiktok", { fetch: fetchMock, now: NOW })).toEqual({ ok: true });
    expect(await kvJson(kv, `snap:tiktok:${TODAY}`)).toEqual({
      platform: "tiktok",
      day: TODAY,
      followers: 1200,
      views30d: 10_000,
      totalPosts: 2,
    });
    expect(await kvJson(kv, "posts:tiktok")).toEqual({
      "7300000000000000001": {
        platform: "tiktok",
        postId: "7300000000000000001",
        publishedAt: "2026-09-20T13:00:00+03:00",
        kind: "video",
        views: 10_000,
        likes: 800,
        comments: 20,
        shares: 40,
        title: "Match cut in CapCut #capcut",
        permalink: "https://www.tiktok.com/@3z.prod/video/7300000000000000001",
        thumbUrl: "https://p16.example/c1.jpg",
      },
      "7200000000000000002": {
        platform: "tiktok",
        postId: "7200000000000000002",
        publishedAt: "2026-06-01T13:00:00+03:00",
        kind: "video",
        views: 5000,
        likes: 300,
        comments: 5,
        shares: 10,
        title: "Old one",
        permalink: "https://www.tiktok.com/@3z.prod/video/7200000000000000002",
        thumbUrl: "https://p16.example/c2.jpg",
      },
    });
    expect(kv.store.has(`demo:tiktok:${TODAY}`)).toBe(false);
    // video.list is a POST with the fields in the query and the page size in the JSON body.
    const [listUrl, listInit] = fetchMock.mock.calls[2];
    expect(new URL(String(listUrl)).searchParams.get("fields")).toContain("view_count");
    expect(listInit?.method).toBe("POST");
    expect(JSON.parse(String(listInit?.body))).toEqual({ max_count: 20 });
    expect(new Headers(listInit?.headers).get("Authorization")).toBe("Bearer tt-refreshed");
    expect(await kvJson(kv, "status:tiktok")).toMatchObject({
      handle: "3z.prod",
      url: "https://www.tiktok.com/@3z.prod",
    });
  });

  it("TikTok: follows cursor/has_more up to 100 videos and maps error codes", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "tiktok", { refreshToken: "tt-refresh" });
    let page = 0;
    const fetchMock = mockFetch({
      "open.tiktokapis.com/v2/video/list/": (_u, init) => {
        const body = JSON.parse(String(init?.body)) as { cursor?: number };
        page += 1;
        if (page === 1) expect(body.cursor).toBeUndefined();
        else expect(body.cursor).toBe(page - 1);
        return {
          data: {
            videos: Array.from({ length: 20 }, (_, i) => ({
              id: `v${page}-${i}`,
              create_time: unix("2026-09-01T00:00:00Z"),
              view_count: 1,
            })),
            cursor: page,
            has_more: true,
          },
          error: { code: "ok" },
        };
      },
    });
    await syncPlatform(env, "tiktok", { fetch: fetchMock, now: NOW });
    expect(page).toBe(5);
    expect(Object.keys(await kvJson(kv, "posts:tiktok"))).toHaveLength(100);

    const invalid = mockFetch({
      "open.tiktokapis.com/v2/user/info/": () =>
        jsonRes({ data: {}, error: { code: "access_token_invalid", message: "bad" } }, 401),
    });
    expect(await syncPlatform(env, "tiktok", { fetch: invalid, now: NOW })).toEqual({
      ok: false,
      error: "token_expired",
    });
  });

  it("reports not_connected / not_configured without calling anyone", async () => {
    const fetchMock = mockFetch();
    expect(await syncPlatform(makeEnv(), "tiktok", { fetch: fetchMock })).toEqual({
      ok: false,
      error: "not_connected",
    });
    const env = makeEnv(fakeKV(), { META_APP_ID: undefined });
    await connectDirect(env, "instagram");
    expect(await syncPlatform(env, "instagram", { fetch: fetchMock })).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a network failure is `upstream` and lands in the status", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "threads");
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network down");
    });
    expect(await syncPlatform(env, "threads", { fetch: fetchMock, now: NOW })).toEqual({
      ok: false,
      error: "upstream",
    });
    expect(await kvJson(kv, "status:threads")).toMatchObject({ lastError: "upstream" });
  });
});

/* ---------- storage rules ---------- */

describe("store", () => {
  it("keeps at most 400 daily snapshots per platform", async () => {
    const kv = fakeKV();
    const store = new Store(kv, TOKEN);
    let day = "2025-01-01";
    for (let i = 0; i < 402; i++) {
      await store.putSnapshot({ platform: "tiktok", day, followers: i });
      day = addDays(day, 1);
    }
    const kept = [...kv.store.keys()].filter((k) => k.startsWith("snap:tiktok:")).sort();
    expect(kept).toHaveLength(400);
    expect(kept[0]).toBe("snap:tiktok:2025-01-03");
    expect(kept.at(-1)).toBe(`snap:tiktok:${addDays(day, -1)}`);
  });

  it("lists snapshots across KV pages and falls back to `get` without metadata", async () => {
    const kv = fakeKV();
    const store = new Store(kv, TOKEN);
    let day = "2024-01-01";
    for (let i = 0; i < 1001; i++) {
      kv.store.set(`snap:youtube:${day}`, {
        value: JSON.stringify({ platform: "youtube", day, followers: i }),
        metadata: i % 2 ? { platform: "youtube", day, followers: i } : undefined,
      });
      day = addDays(day, 1);
    }
    const rows = await store.listSnapshots("youtube", "2024-01-01");
    expect(rows).toHaveLength(1001);
    expect(rows[0]).toEqual({ platform: "youtube", day: "2024-01-01", followers: 0 });
    expect(rows[1000].followers).toBe(1000);
    expect(await store.listSnapshots("youtube", addDays(day, -3))).toHaveLength(3);
  });

  it("merges posts field by field and caps the document at 500 newest", async () => {
    const kv = fakeKV();
    const store = new Store(kv, TOKEN);
    const existing: Record<string, PostRow> = {};
    for (let i = 0; i < 505; i++) {
      existing[`p${i}`] = {
        platform: "tiktok",
        postId: `p${i}`,
        publishedAt: riyadhIso(Date.UTC(2024, 0, 1) + i * 86_400_000),
        kind: "video",
        views: 1,
      };
    }
    const merged = await store.mergePosts("tiktok", existing, [
      {
        platform: "tiktok",
        postId: "p504",
        publishedAt: existing.p504.publishedAt,
        kind: "video",
        likes: 3,
      },
    ]);
    expect(Object.keys(merged)).toHaveLength(500);
    expect(merged.p0).toBeUndefined();
    expect(merged.p504).toMatchObject({ views: 1, likes: 3 });
  });
});

/* ---------- status, data, sync, disconnect ---------- */

describe("GET /social/status", () => {
  it("lists configured / connected per platform with the stored fields", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { TIKTOK_CLIENT_KEY: undefined });
    await connectDirect(env, "instagram", { expiresAt: "2026-11-20T00:00:00.000Z" });
    await Store.from(env)!.putStatus("instagram", {
      connectedAt: "2026-09-27T09:00:00.000Z",
      handle: "3z.prod",
      url: "https://www.instagram.com/3z.prod/",
      lastSyncAt: "2026-09-27T09:00:05.000Z",
      lastError: "rate_limited",
    });
    const res = await handle(req("/social/status"), env, undefined, { now });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      platforms: {
        instagram: {
          configured: true,
          connected: true,
          connectedAt: "2026-09-27T09:00:00.000Z",
          handle: "3z.prod",
          url: "https://www.instagram.com/3z.prod/",
          lastSyncAt: "2026-09-27T09:00:05.000Z",
          lastError: "rate_limited",
          tokenExpiresAt: "2026-11-20T00:00:00.000Z",
        },
        threads: { configured: true, connected: false },
        youtube: { configured: true, connected: false },
        tiktok: { configured: false, connected: false },
      },
    });
  });

  it("works without KV (everything disconnected)", async () => {
    const res = await handle(req("/social/status"), makeEnv(null), undefined, { now });
    const body = (await res.json()) as { platforms: Record<string, { connected: boolean }> };
    expect(body.platforms.tiktok).toEqual({ configured: true, connected: false });
  });
});

describe("DELETE /social/connect/:platform", () => {
  it("forgets tokens and status but keeps the rows", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "tiktok", { refreshToken: "tt-refresh" });
    await syncPlatform(env, "tiktok", { fetch: mockFetch(), now: NOW });
    const res = await handle(req("/social/connect/tiktok", { method: "DELETE" }), env, undefined, {
      now,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(kv.store.has("tokens:tiktok")).toBe(false);
    expect(kv.store.has("status:tiktok")).toBe(false);
    expect(kv.store.has(`snap:tiktok:${TODAY}`)).toBe(true);
    expect(kv.store.has("posts:tiktok")).toBe(true);
    const status = (await (
      await handle(req("/social/status"), env, undefined, { now })
    ).json()) as {
      platforms: Record<string, { connected: boolean }>;
    };
    expect(status.platforms.tiktok).toEqual({ configured: true, connected: false });
    // Idempotent.
    expect((await handle(req("/social/connect/tiktok", { method: "DELETE" }), env)).status).toBe(
      200,
    );
  });
});

describe("POST /social/sync", () => {
  it("syncs the requested platforms and reports errors per platform", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "tiktok", { refreshToken: "tt-refresh" });
    await connectDirect(env, "threads");
    const fetchMock = mockFetch({
      "graph.threads.net/v1.0/me": () =>
        jsonRes({ error: { message: "Invalid OAuth access token", code: 190 } }, 400),
    });
    const res = await handle(
      req("/social/sync", {
        method: "POST",
        json: { platforms: ["tiktok", "threads", "youtube"] },
      }),
      env,
      undefined,
      { fetch: fetchMock, now },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      synced: ["tiktok"],
      errors: { threads: "token_expired", youtube: "not_connected" },
    });
  });

  it("with no body syncs every connected platform", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "youtube", { refreshToken: "r" });
    await connectDirect(env, "instagram");
    const res = await handle(req("/social/sync", { method: "POST" }), env, undefined, {
      fetch: mockFetch(),
      now,
    });
    expect(await res.json()).toEqual({ synced: ["instagram", "youtube"], errors: {} });
    expect(kv.store.has(`snap:instagram:${TODAY}`)).toBe(true);
    expect(kv.store.has(`snap:youtube:${TODAY}`)).toBe(true);
  });

  it("validates the platform list and needs KV", async () => {
    const env = makeEnv();
    const bad = await handle(
      req("/social/sync", { method: "POST", json: { platforms: ["x"] } }),
      env,
      undefined,
      { now },
    );
    expect(bad.status).toBe(400);
    const noKv = await handle(req("/social/sync", { method: "POST", json: {} }), makeEnv(null));
    expect(noKv.status).toBe(503);
  });

  it("syncAll shares the outbound budget between platforms", async () => {
    const env = makeEnv();
    await connectDirect(env, "instagram");
    await connectDirect(env, "tiktok", {
      refreshToken: "tt-refresh",
      issuedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
    });
    const fetchMock = mockFetch();
    const result = await syncAll(env, { fetch: fetchMock, now: NOW, budget: 20 });
    expect(result).toEqual({ synced: ["instagram", "tiktok"], errors: {} });
    // Instagram had 10 calls at most, TikTok 3 (refresh, user, videos).
    expect(
      fetchMock.calls().filter((c) => c.startsWith("graph.instagram.com")).length,
    ).toBeLessThanOrEqual(10);
    expect(fetchMock.calls().filter((c) => c.startsWith("open.tiktokapis.com"))).toHaveLength(3);
  });
});

describe("GET /social/data", () => {
  async function seeded() {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "tiktok", { refreshToken: "tt-refresh" });
    await connectDirect(env, "youtube", { refreshToken: "r" });
    const fetchMock = mockFetch();
    await syncPlatform(env, "tiktok", { fetch: fetchMock, now: NOW });
    await syncPlatform(env, "youtube", { fetch: fetchMock, now: NOW });
    // Older snapshots and an older demographics day.
    const store = Store.from(env)!;
    await store.putSnapshot({ platform: "tiktok", day: "2025-06-01", followers: 900 });
    await store.putSnapshot({ platform: "tiktok", day: "2026-09-01", followers: 1100 });
    await store.putDemographics("youtube", "2026-09-01", [
      { platform: "youtube", day: "2026-09-01", dimension: "gender", key: "male", pct: 100 },
    ]);
    return { kv, env };
  }

  it("returns the dashboard's shape over the default 400 days", async () => {
    const { env } = await seeded();
    const res = await handle(req("/social/data"), env, undefined, { now });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accounts: unknown[];
      snapshots: SnapshotRow[];
      postStats: PostRow[];
      demographics: DemographicRow[];
      syncedAt: Record<string, string>;
    };
    expect(body.accounts).toEqual([
      { platform: "youtube", handle: "3zprod", url: "https://www.youtube.com/@3zprod" },
      { platform: "tiktok", handle: "3z.prod", url: "https://www.tiktok.com/@3z.prod" },
    ]);
    // 2025-06-01 is more than 400 days before 2026-09-27 → out.
    expect(body.snapshots.map((s) => `${s.platform}:${s.day}`)).toEqual([
      `youtube:${TODAY}`,
      "tiktok:2026-09-01",
      `tiktok:${TODAY}`,
    ]);
    expect(body.snapshots[0]).toEqual({
      platform: "youtube",
      day: TODAY,
      followers: 6,
      views30d: 500,
      totalPosts: 2,
      avgVideoWatchTime: 95,
      avgShortsWatchTime: 18.5,
    });
    expect(body.postStats.map((p) => p.postId)).toEqual([
      "v2",
      "v1",
      "7300000000000000001",
      "7200000000000000002",
    ]);
    // Only the latest demographics day per platform.
    expect(body.demographics.every((d) => d.platform === "youtube" && d.day === TODAY)).toBe(true);
    expect(body.demographics).toHaveLength(9);
    expect(body.syncedAt).toEqual({ youtube: NOW.toISOString(), tiktok: NOW.toISOString() });
  });

  it("applies `since` to snapshots, posts and demographics, and validates it", async () => {
    const { env } = await seeded();
    const res = await handle(req("/social/data?since=2026-09-10"), env, undefined, { now });
    const body = (await res.json()) as {
      snapshots: SnapshotRow[];
      postStats: PostRow[];
      demographics: DemographicRow[];
    };
    expect(body.snapshots.map((s) => `${s.platform}:${s.day}`)).toEqual([
      `youtube:${TODAY}`,
      `tiktok:${TODAY}`,
    ]);
    expect(body.postStats.map((p) => p.postId)).toEqual(["v2", "7300000000000000001"]);
    expect(body.demographics).toHaveLength(9);

    const future = await handle(req(`/social/data?since=${addDays(TODAY, 1)}`), env, undefined, {
      now,
    });
    const empty = (await future.json()) as {
      snapshots: unknown[];
      postStats: unknown[];
      demographics: unknown[];
    };
    expect(empty.snapshots).toEqual([]);
    expect(empty.postStats).toEqual([]);
    expect(empty.demographics).toEqual([]);

    expect((await handle(req("/social/data?since=yesterday"), env)).status).toBe(400);
    expect(await (await handle(req("/social/data?since=yesterday"), env)).json()).toEqual({
      error: "bad_request",
    });
  });

  it("is empty without KV", async () => {
    const res = await handle(req("/social/data"), makeEnv(null), undefined, { now });
    expect(await res.json()).toEqual({
      accounts: [],
      snapshots: [],
      postStats: [],
      demographics: [],
      syncedAt: {},
    });
  });
});

/* ---------- cron ---------- */

describe("scheduled", () => {
  it("maps each cron expression to one platform and syncs it when connected", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "tiktok", { refreshToken: "tt-refresh" });
    const fetchMock = mockFetch();
    expect(CRON_PLATFORMS).toEqual({
      "0 3 * * *": "instagram",
      "10 3 * * *": "threads",
      "20 3 * * *": "youtube",
      "30 3 * * *": "tiktok",
    });
    expect(await runScheduled(env, "30 3 * * *", { fetch: fetchMock, now: NOW })).toEqual({
      synced: ["tiktok"],
      errors: {},
    });
    expect(kv.store.has(`snap:tiktok:${TODAY}`)).toBe(true);
    // Not connected → nothing to do, no calls.
    expect(await runScheduled(env, "0 3 * * *", { fetch: fetchMock, now: NOW })).toEqual({
      synced: [],
      errors: {},
    });
    expect(fetchMock.calls().some((c) => c.startsWith("graph.instagram.com"))).toBe(false);
  });

  it("an unknown cron syncs everything connected", async () => {
    const env = makeEnv();
    await connectDirect(env, "threads");
    await connectDirect(env, "youtube", { refreshToken: "r" });
    expect(await runScheduled(env, "0 4 * * *", { fetch: mockFetch(), now: NOW })).toEqual({
      synced: ["threads", "youtube"],
      errors: {},
    });
  });

  it("the Worker's scheduled handler runs without throwing", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    await connectDirect(env, "tiktok", { refreshToken: "tt-refresh" });
    vi.stubGlobal("fetch", mockFetch());
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const controller = { cron: "30 3 * * *", scheduledTime: NOW.getTime(), noRetry() {} };
      const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
      // The handler ignores ctx; call it the way workerd does.
      const scheduled = worker.scheduled as unknown as (
        c: ScheduledController,
        e: Env,
        x: ExecutionContext,
      ) => Promise<void>;
      await scheduled(controller as ScheduledController, env, ctx as unknown as ExecutionContext);
      expect(kv.store.has(`snap:tiktok:${riyadhDay(new Date())}`)).toBe(true);
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
        cron: "30 3 * * *",
        synced: ["tiktok"],
      });
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
    }
  });

  it("the Worker's fetch handler exposes the social routes", async () => {
    const env = makeEnv();
    const res = await worker.fetch!(
      req("/social/status") as unknown as Parameters<NonNullable<typeof worker.fetch>>[0],
      env,
      { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });
});

/** Type-level check that KV key helpers agree with the layout in the README. */
it("KV key layout", () => {
  expect(keys.tokens("tiktok")).toBe("tokens:tiktok");
  expect(keys.status("tiktok")).toBe("status:tiktok");
  expect(keys.snap("tiktok", TODAY)).toBe(`snap:tiktok:${TODAY}`);
  expect(keys.posts("tiktok")).toBe("posts:tiktok");
  expect(keys.demo("tiktok", TODAY)).toBe(`demo:tiktok:${TODAY}`);
  expect(keys.state("n")).toBe("state:n");
});

describe("fetchJson", () => {
  it("calls fetch unbound, like the Workers runtime requires (no `this = http` → Illegal invocation)", async () => {
    const { Budget, fetchJson } = await import("./http");
    // Behaves like the runtime's fetch: refuses to run as a method of another object.
    const strictFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response('{"ok":1}', { status: 200 }));
    } as unknown as typeof fetch;
    const reply = await fetchJson<{ ok: number }>(
      { fetch: strictFetch, budget: new Budget(1) },
      "https://oauth2.googleapis.com/token",
    );
    expect(reply).toEqual({ status: 200, ok: true, body: { ok: 1 } });
  });
});

describe("credentials", () => {
  it("Threads uses its own THREADS_APP_* pair when set, else the Meta pair; Instagram always the Meta pair", async () => {
    const { credentials } = await import("./oauth");
    const both = makeEnv(fakeKV(), { THREADS_APP_ID: "th-id", THREADS_APP_SECRET: "th-secret" });
    expect(credentials(both, "threads")).toEqual({ id: "th-id", secret: "th-secret" });
    expect(credentials(both, "instagram")).toEqual({ id: "meta-id", secret: "meta-secret" });
    expect(credentials(makeEnv(), "threads")).toEqual({ id: "meta-id", secret: "meta-secret" });
    // Half a Threads pair does not count: falls back to the Meta pair instead of a broken mix.
    const half = makeEnv(fakeKV(), { THREADS_APP_ID: "th-id" });
    expect(credentials(half, "threads")).toEqual({ id: "meta-id", secret: "meta-secret" });
  });
});
