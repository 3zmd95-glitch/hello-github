import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "./scout";
import { decryptJson, encryptJson } from "./social/crypto";
import {
  TT_ACCOUNT_AUTH_URL,
  TT_CML_TRENDING_URL,
  TT_USER_REFRESH_URL,
  TT_USER_TOKEN_URL,
  type AccountToken,
} from "./tiktokAccount";

// The TikTok account authorization (tt_user) of the owner's TikTok for Business app and the Commercial Music
// Library's trending songs, through the Worker's router. Every value here is fake.

const SCOUT = "scout-token";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-15T14:00:00Z");
const APP_ID = "7693488727766597653";
const SECRET = "fake-ads-secret";
const ACCESS = "fake-account-access";
const REFRESH = "fake-account-refresh";
const OPEN_ID = "-000openid-abcdef";
const CALLBACK = `${BASE}/oauth/tiktokads/account/callback/`;

type Entry = { value: string; ttl?: number };
function fakeKV() {
  const store = new Map<string, Entry>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, { value, ttl: opts?.expirationTtl });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}
type FakeKV = ReturnType<typeof fakeKV>;

const makeEnv = (kv: FakeKV = fakeKV(), extra: Partial<Env> = {}): Env => ({
  SCOUT_TOKEN: SCOUT,
  SOCIAL_KV: kv as unknown as KVNamespace,
  TIKTOK_ADS_APP_ID: APP_ID,
  TIKTOK_ADS_SECRET: SECRET,
  ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = {
  code: 0,
  message: "OK",
  data: {
    access_token: ACCESS,
    refresh_token: REFRESH,
    open_id: OPEN_ID,
    expires_in: 86400,
    refresh_token_expires_in: 31536000,
    scope: "user.info.basic",
    token_type: "Bearer",
  },
};

const get = (
  env: Env,
  path: string,
  fetch?: typeof globalThis.fetch,
  token: string | null = SCOUT,
) =>
  handle(
    new Request(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    env,
    undefined,
    { fetch, now: () => NOW },
  );
const connect = (env: Env, token: string | null = SCOUT) =>
  get(env, "/tiktokads/account/connect", undefined, token);
/** TikTok sending the owner's browser back: no bearer. */
const callback = (env: Env, query: string, fetch: typeof globalThis.fetch, now = NOW) =>
  handle(new Request(`${CALLBACK}?${query}`), env, undefined, { fetch, now: () => now });

async function stateOf(env: Env): Promise<string> {
  const res = await connect(env);
  return new URL(res.headers.get("Location")!).searchParams.get("state")!;
}

/** A stored account token, sealed, expiring `expiresIn` ms after NOW. */
async function storeToken(kv: FakeKV, expiresIn = 3600_000, refreshIn = 300 * 86400_000) {
  const t: AccountToken = {
    access_token: ACCESS,
    refresh_token: REFRESH,
    open_id: OPEN_ID,
    expires_at: new Date(NOW.getTime() + expiresIn).toISOString(),
    refresh_expires_at: new Date(NOW.getTime() + refreshIn).toISOString(),
    scope: "user.info.basic",
    connectedAt: "2026-10-15T10:00:00.000Z",
  };
  kv.store.set("tiktokads:account", { value: await encryptJson(SCOUT, t) });
}

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const level of ["log", "error", "warn"] as const)
    vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args));
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tiktokads/account/connect", () => {
  it("302s to TikTok's account authorization page and keeps a one-time state for 10 minutes", async () => {
    const kv = fakeKV();
    const res = await connect(makeEnv(kv));
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get("Location")!);
    expect(`${u.origin}${u.pathname}`).toBe(TT_ACCOUNT_AUTH_URL);
    expect(TT_ACCOUNT_AUTH_URL).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(u.searchParams.get("client_key")).toBe(APP_ID);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("user.info.basic");
    // TikTok asks account redirect URLs to end with "/".
    expect(u.searchParams.get("redirect_uri")).toBe(CALLBACK);
    const state = u.searchParams.get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const kept = kv.store.get(`tiktokads:account-state:${state}`)!;
    expect(kept.ttl).toBe(600);
    expect(JSON.parse(kept.value)).toEqual({ createdAt: NOW.toISOString() });
  });

  it("answers 200 { url } instead of redirecting for ?format=json and Accept: application/json", async () => {
    const ORIGIN = "https://3zmd95-glitch.github.io";
    for (const path of ["/tiktokads/account/connect?format=json", "/tiktokads/account/connect"]) {
      const kv = fakeKV();
      const res = await handle(
        new Request(`${BASE}${path}`, {
          headers: {
            Authorization: `Bearer ${SCOUT}`,
            Origin: ORIGIN,
            ...(path.includes("format") ? {} : { Accept: "application/json" }),
          },
        }),
        makeEnv(kv),
        undefined,
        { now: () => NOW },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Location")).toBeNull();
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      const u = new URL(((await res.json()) as { url: string }).url);
      expect(`${u.origin}${u.pathname}`).toBe(TT_ACCOUNT_AUTH_URL);
      expect(u.searchParams.get("redirect_uri")).toBe(CALLBACK);
      const state = u.searchParams.get("state")!;
      expect(kv.store.get(`tiktokads:account-state:${state}`)!.ttl).toBe(600);
    }
  });

  it("needs the bearer and the app's secret", async () => {
    const kv = fakeKV();
    expect((await connect(makeEnv(kv), null)).status).toBe(401);
    expect((await connect(makeEnv(kv), "wrong")).status).toBe(401);
    const res = await connect(makeEnv(kv, { TIKTOK_ADS_SECRET: undefined }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_configured" });
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe("GET /oauth/tiktokads/account/callback/", () => {
  it("exchanges the auth code once at /tt_user/oauth2/token/, keeps the token sealed and says connected", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const state = await stateOf(env);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(TOKEN_OK));
    const res = await callback(env, `auth_code=the-code&state=${state}`, fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const page = await res.text();
    expect(page).toContain("connected");
    expect(page).not.toContain(ACCESS);
    expect(page).not.toContain(OPEN_ID);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(TT_USER_TOKEN_URL);
    expect(TT_USER_TOKEN_URL).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: APP_ID,
      client_secret: SECRET,
      grant_type: "authorization_code",
      auth_code: "the-code",
      redirect_uri: CALLBACK,
    });
    const blob = kv.store.get("tiktokads:account")!.value;
    expect(blob).not.toContain(ACCESS);
    expect(await decryptJson(SCOUT, blob)).toEqual({
      access_token: ACCESS,
      refresh_token: REFRESH,
      open_id: OPEN_ID,
      expires_at: "2026-10-16T14:00:00.000Z",
      refresh_expires_at: "2027-10-15T14:00:00.000Z",
      scope: "user.info.basic",
      connectedAt: NOW.toISOString(),
    });
    // The state is used up.
    const again = await callback(env, `auth_code=the-code&state=${state}`, fetch);
    expect(again.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("takes `code` too, and the path without the trailing slash", async () => {
    const env = makeEnv();
    const state = await stateOf(env);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(TOKEN_OK));
    const res = await handle(
      new Request(`${BASE}/oauth/tiktokads/account/callback?code=c2&state=${state}`),
      env,
      undefined,
      { fetch, now: () => NOW },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).auth_code).toBe("c2");
  });

  it("refuses a missing, wrong, stale or advertiser state: nothing exchanged", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(TOKEN_OK));
    expect((await callback(env, "auth_code=c", fetch)).status).toBe(400);
    expect((await callback(env, "auth_code=c&state=nope", fetch)).status).toBe(400);
    kv.store.set("tiktokads:state:adv", {
      value: JSON.stringify({ returnTo: "https://x", createdAt: NOW.toISOString() }),
    });
    expect((await callback(env, "auth_code=c&state=adv", fetch)).status).toBe(400);
    const state = await stateOf(env);
    const late = new Date(NOW.getTime() + 11 * 60_000);
    expect((await callback(env, `auth_code=c&state=${state}`, fetch, late)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(kv.store.has("tiktokads:account")).toBe(false);
  });

  it("a refusal from TikTok or no code says so; never the secret or the code in logs or page", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ code: 40001, message: `bad ${SECRET} the-code` }),
    );
    const res = await callback(env, `auth_code=the-code&state=${await stateOf(env)}`, fetch);
    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toContain("exchange_failed");
    expect(page).toContain("40001");
    const all = page + JSON.stringify(logs);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("the-code");
    const none = await callback(env, `state=${await stateOf(env)}`, fetch);
    expect(await none.text()).toContain("no_code");
    expect(kv.store.has("tiktokads:account")).toBe(false);
  });
});

describe("GET /tiktokads/account/status", () => {
  it("says connected, the open_id masked, the scope and expiry; never a token", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    expect(await (await get(env, "/tiktokads/account/status")).json()).toEqual({
      connected: false,
    });
    await storeToken(kv);
    const res = await get(env, "/tiktokads/account/status");
    const text = await res.text();
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(REFRESH);
    expect(text).not.toContain(OPEN_ID);
    expect(JSON.parse(text)).toEqual({
      connected: true,
      openId: "-000…ef",
      scope: "user.info.basic",
      expiresAt: "2026-10-15T15:00:00.000Z",
      refreshExpiresAt: "2027-08-11T14:00:00.000Z",
    });
    expect((await get(env, "/tiktokads/account/status", undefined, null)).status).toBe(401);
  });
});

const TRACK = {
  commercial_music_id: "777",
  commercial_music_name: "Song A",
  artist: "Artist A",
  rank_position: "1",
  duration: 60,
  preview_url: "https://p16.example/preview.mp3",
  thumbnail_url: "https://p16.example/t.jpg",
  trending_history: [
    { date: "2026-10-13", rank_position_daily: "3" },
    { date: "2026-10-14", rank_position_daily: 1 },
  ],
};

describe("GET /tiktokads/music", () => {
  it("reads the CML chart with the account token and open_id, normalizes it and keeps it 6 hours", async () => {
    const kv = fakeKV();
    await storeToken(kv);
    const env = makeEnv(kv);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ code: 0, message: "OK", data: { list: [TRACK, { rank_position: 2 }] } }),
    );
    const res = await get(env, "/tiktokads/music?country=sa&range=30&genre=arabic_pop", fetch);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(ACCESS);
    expect(JSON.parse(text)).toEqual({
      fetchedAt: NOW.toISOString(),
      country: "SA",
      range: "30",
      genre: "ARABIC_POP",
      items: [
        {
          rank: 1,
          title: "Song A",
          artist: "Artist A",
          id: "777",
          previewUrl: "https://p16.example/preview.mp3",
          thumbnail: "https://p16.example/t.jpg",
          trend: [
            { date: "2026-10-13", rank: 3 },
            { date: "2026-10-14", rank: 1 },
          ],
        },
        {
          rank: 2,
          title: null,
          artist: null,
          id: null,
          previewUrl: null,
          thumbnail: null,
          trend: [],
        },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    const u = new URL(String(url));
    expect(`${u.origin}${u.pathname}`).toBe(TT_CML_TRENDING_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      business_id: OPEN_ID,
      genre: "ARABIC_POP",
      country_code: "SA",
      date_range: "30DAY",
    });
    expect((init?.headers as Record<string, string>)["Access-Token"]).toBe(ACCESS);
    const cached = kv.store.get("tiktokads:music:SA:30:ARABIC_POP")!;
    expect(cached.ttl).toBe(21600);

    // Asked again: the kept answer, nothing fetched.
    const again = await get(env, "/tiktokads/music?country=SA&range=30&genre=ARABIC_POP", fetch);
    expect(await again.json()).toEqual(JSON.parse(text));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("defaults to US, 7 days and ALL; refuses other values", async () => {
    const kv = fakeKV();
    await storeToken(kv);
    const env = makeEnv(kv);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ code: 0, message: "OK", data: { list: [] } }),
    );
    const res = await get(env, "/tiktokads/music", fetch);
    expect(await res.json()).toMatchObject({ country: "US", range: "7", genre: "ALL", items: [] });
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get("date_range")).toBe("7DAY");
    for (const q of ["?country=GB", "?range=14", "?genre=a%20b", `?genre=${"A".repeat(41)}`])
      expect((await get(env, `/tiktokads/music${q}`, fetch)).status).toBe(400);
    expect((await get(env, "/tiktokads/music", fetch, null)).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a TikTok error or no answer is data (502 with its code and message), never kept", async () => {
    const kv = fakeKV();
    await storeToken(kv);
    const env = makeEnv(kv);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ code: 40105, message: `Access token ${ACCESS} is incorrect` }),
    );
    const res = await get(env, "/tiktokads/music", fetch);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "tiktok",
      fetchedAt: NOW.toISOString(),
      status: 200,
      code: 40105,
      message: "Access token … is incorrect",
    });
    const down = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("network");
    });
    expect(await (await get(env, "/tiktokads/music", down)).json()).toMatchObject({
      error: "tiktok",
      status: 0,
      code: null,
    });
    expect([...kv.store.keys()].some((k) => k.startsWith("tiktokads:music:"))).toBe(false);
  });

  it("not connected: 409 not_connected, nothing asked", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const res = await get(makeEnv(), "/tiktokads/music", fetch);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_connected" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renews an expiring token first, keeps the new one sealed, then reads the chart (2 calls)", async () => {
    const kv = fakeKV();
    await storeToken(kv, 60_000);
    const env = makeEnv(kv);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input) === TT_USER_REFRESH_URL
        ? json({
            ...TOKEN_OK,
            data: { ...TOKEN_OK.data, access_token: "new-access", refresh_token: "new-refresh" },
          })
        : json({ code: 0, message: "OK", data: { list: [TRACK] } }),
    );
    const res = await get(env, "/tiktokads/music", fetch);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(TT_USER_REFRESH_URL).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/refresh_token/",
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      client_id: APP_ID,
      client_secret: SECRET,
      grant_type: "refresh_token",
      refresh_token: REFRESH,
    });
    expect((fetch.mock.calls[1][1]?.headers as Record<string, string>)["Access-Token"]).toBe(
      "new-access",
    );
    const t = await decryptJson<AccountToken>(SCOUT, kv.store.get("tiktokads:account")!.value);
    expect(t).toMatchObject({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_at: "2026-10-16T14:00:00.000Z",
      connectedAt: "2026-10-15T10:00:00.000Z",
    });
  });

  it("a failed renewal is data (502 refresh_failed); a dead refresh token asks to reconnect (409)", async () => {
    const kv = fakeKV();
    await storeToken(kv, -1000);
    const env = makeEnv(kv);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ code: 40104, message: `bad ${REFRESH}` }),
    );
    const res = await get(env, "/tiktokads/music", fetch);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "refresh_failed",
      fetchedAt: NOW.toISOString(),
      status: 200,
      code: 40104,
      message: "bad …",
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await storeToken(kv, -1000, -1000);
    const dead = await get(env, "/tiktokads/music", fetch);
    expect(dead.status).toBe(409);
    expect(await dead.json()).toMatchObject({ error: "reconnect" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
