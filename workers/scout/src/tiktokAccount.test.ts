import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "./scout";
import { decryptJson, encryptJson } from "./social/crypto";
import {
  readAccountToken,
  TT_ACCOUNT_AUTH_URL,
  TT_CML_TRENDING_URL,
  TT_USER_REFRESH_URL,
  TT_USER_TOKEN_URL,
  type AccountToken,
} from "./tiktokAccount";
import { musicProbe } from "./tiktokMusicProbe";

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

type Entry = { value: string; ttl?: number; expiration?: number };
function fakeKV() {
  const store = new Map<string, Entry>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    put: vi.fn(
      async (
        key: string,
        value: string,
        opts?: { expirationTtl?: number; expiration?: number },
      ) => {
        store.set(key, { value, ttl: opts?.expirationTtl, expiration: opts?.expiration });
      },
    ),
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
    // DT-6B-3A-R1: the callback alone writes the connection reference, a fresh connection id around the token.
    expect(await decryptJson(SCOUT, blob)).toEqual({
      v: 2,
      connection: expect.stringMatching(/^[0-9a-f]{32}$/),
      token: {
        access_token: ACCESS,
        refresh_token: REFRESH,
        open_id: OPEN_ID,
        expires_at: "2026-10-16T14:00:00.000Z",
        refresh_expires_at: "2027-10-15T14:00:00.000Z",
        scope: "user.info.basic",
        connectedAt: NOW.toISOString(),
      },
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
    const before = kv.store.get("tiktokads:account")!.value;
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
    // DT-6B-3A-R1: the renewal lands sealed under its own connection's refresh key (a legacy record's is
    // "legacy"), bounded by the renewed refresh token; the connection reference itself is never rewritten.
    expect(kv.store.get("tiktokads:account")!.value).toBe(before);
    const kept = kv.store.get("tiktokads:account-refresh:legacy")!;
    expect(kept.value).not.toContain("new-access");
    expect(kept.expiration).toBe(Date.parse("2027-10-15T14:00:00.000Z") / 1000);
    const { connection, token: t } = (await decryptJson<{
      connection: string;
      token: AccountToken;
    }>(SCOUT, kept.value))!;
    expect(connection).toBe("legacy");
    expect(t).toMatchObject({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_at: "2026-10-16T14:00:00.000Z",
      connectedAt: "2026-10-15T10:00:00.000Z",
    });
    expect(await readAccountToken(env)).toMatchObject({ access_token: "new-access" });
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

// DT-6B-3A-R1. The callback alone writes `tiktokads:account` ({ v: 2, connection, token }; a bare sealed token is a
// legacy record, connection "legacy"); a renewal writes only `tiktokads:account-refresh:<its connection>`, read back
// only while the reference still names that connection and the same open_id.
const REF = "tiktokads:account";
const refreshKey = (connection: string) => `tiktokads:account-refresh:${connection}`;
const CONN = "0123456789abcdef0123456789abcdef";
const CHANGED = { error: "account_changed", fetchedAt: NOW.toISOString() };

function accountToken(over: Partial<AccountToken> = {}, expiresIn = -1000): AccountToken {
  return {
    access_token: "old-access",
    refresh_token: "old-refresh",
    open_id: OPEN_ID,
    expires_at: new Date(NOW.getTime() + expiresIn).toISOString(),
    refresh_expires_at: new Date(NOW.getTime() + 300 * 86400_000).toISOString(),
    scope: "user.info.basic",
    connectedAt: "2026-10-15T10:00:00.000Z",
    ...over,
  };
}
const seal = (value: unknown) => encryptJson(SCOUT, value);
async function storeV2(kv: FakeKV, token = accountToken(), connection = CONN) {
  kv.store.set(REF, { value: await seal({ v: 2, connection, token }) });
}
async function storeLegacy(kv: FakeKV, token = accountToken()) {
  kv.store.set(REF, { value: await seal(token) });
}
const refOf = async (kv: FakeKV) =>
  (await decryptJson<{ v: number; connection: string; token: AccountToken }>(
    SCOUT,
    kv.store.get(REF)!.value,
  ))!;
const overlayOf = async (kv: FakeKV, connection: string) =>
  (await decryptJson<{ connection: string; token: AccountToken }>(
    SCOUT,
    kv.store.get(refreshKey(connection))!.value,
  ))!;
const musicKeys = (kv: FakeKV) =>
  [...kv.store.keys()].filter((k) => k.startsWith("tiktokads:music:"));
const tokenReply = (access: string, openId = OPEN_ID, extra: Record<string, unknown> = {}) =>
  json({
    ...TOKEN_OK,
    data: {
      ...TOKEN_OK.data,
      access_token: access,
      refresh_token: `${access}-refresh`,
      open_id: openId,
      ...extra,
    },
  });
const chart = (list: unknown = [TRACK]) => json({ code: 0, message: "OK", data: { list } });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
/** A fake TikTok: the refresh answers `refresh()` (hold it with a deferred), the code exchange `exchange()`. */
function transport(refresh: () => Promise<Response> | Response, exchange = () => json(TOKEN_OK)) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const u = String(input);
    if (u === TT_USER_REFRESH_URL) return refresh();
    if (u === TT_USER_TOKEN_URL) return exchange();
    if (u.startsWith(TT_CML_TRENDING_URL)) return chart();
    throw new Error(`unexpected ${u}`);
  });
}
const urls = (f: ReturnType<typeof transport>) =>
  f.mock.calls.map(([u]) => String(u).split("?")[0]);
const accessOf = (f: ReturnType<typeof transport>, i: number) =>
  (f.mock.calls.at(i)![1]?.headers as Record<string, string>)["Access-Token"];
/** Connect and complete the callback for the account `exchange()` answers; the callback must say connected. */
async function reconnect(env: Env, f: typeof globalThis.fetch) {
  const res = await callback(env, `auth_code=c&state=${await stateOf(env)}`, f);
  expect(res.status).toBe(200);
}
/** A refresh that waits for `release` after saying it was asked. */
function held() {
  const entered = deferred<void>();
  const release = deferred<Response>();
  return { entered, release, refresh: () => (entered.resolve(), release.promise) };
}

describe("DT-6B-3A-R1: a renewal never replaces a newer connection", () => {
  it("realistic race: A's renewal (same open_id) held past B's completed callback cannot replace B or chart", async () => {
    const kv = fakeKV();
    await storeLegacy(kv, accountToken({ open_id: "old-account" }));
    const env = makeEnv(kv);
    const h = held();
    const f = transport(h.refresh, () => tokenReply("new-access", "new-account"));
    const pending = get(env, "/tiktokads/music", f);
    await h.entered.promise;
    await reconnect(env, f);
    const ref = await refOf(kv);
    expect(ref).toMatchObject({
      v: 2,
      token: { open_id: "new-account", access_token: "new-access" },
    });

    h.release.resolve(tokenReply("old-renewed", "old-account"));
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(CHANGED);
    // No chart with the obsolete credentials, nothing cached; B stays the connection everywhere.
    expect(urls(f)).toEqual([TT_USER_REFRESH_URL, TT_USER_TOKEN_URL]);
    expect(musicKeys(kv)).toEqual([]);
    expect(await refOf(kv)).toEqual(ref);
    expect(await readAccountToken(env)).toMatchObject({
      open_id: "new-account",
      access_token: "new-access",
    });
    // A's renewal landed, sealed, under A's own (legacy) key, which the v2 reference never reads.
    expect(kv.store.get(refreshKey("legacy"))!.value).not.toContain("old-renewed");
    expect((await overlayOf(kv, "legacy")).token.open_id).toBe("old-account");
    const status = await (await get(env, "/tiktokads/account/status")).json();
    expect(status).toMatchObject({ connected: true, openId: "new-…nt" });
    // B's next chart: B's credentials, no renewal.
    const next = await get(env, "/tiktokads/music?range=30", f);
    expect(next.status).toBe(200);
    expect(urls(f).at(-1)).toBe(TT_CML_TRENDING_URL);
    expect(accessOf(f, -1)).toBe("new-access");
  });

  it("control: a renewal that completes before the reconnect charts A, then B is the connection", async () => {
    const kv = fakeKV();
    await storeLegacy(kv, accountToken({ open_id: "old-account" }));
    const env = makeEnv(kv);
    const f = transport(
      () => tokenReply("old-renewed", "old-account"),
      () => tokenReply("new-access", "new-account"),
    );
    const res = await get(env, "/tiktokads/music", f);
    expect(res.status).toBe(200);
    expect(accessOf(f, 1)).toBe("old-renewed");
    expect(await readAccountToken(env)).toMatchObject({ access_token: "old-renewed" });
    await reconnect(env, f);
    expect(await readAccountToken(env)).toMatchObject({
      open_id: "new-account",
      access_token: "new-access",
    });
  });

  it("held while sealing the renewal (TikTok already answered) as the callback completes: still B", async () => {
    const kv = fakeKV();
    await storeV2(kv, accountToken({ open_id: "old-account" }));
    const env = makeEnv(kv);
    const f = transport(
      () => tokenReply("old-renewed", "old-account"),
      () => tokenReply("new-access", "new-account"),
    );
    const subtle = crypto.subtle;
    const encrypt = subtle.encrypt.bind(subtle);
    const sealing = deferred<void>();
    const go = deferred<void>();
    let hold = true;
    vi.spyOn(subtle, "encrypt").mockImplementation(
      async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
        if (hold) {
          hold = false; // only the renewal's seal waits; the callback's passes
          sealing.resolve();
          await go.promise;
        }
        return encrypt(...args);
      },
    );
    const pending = get(env, "/tiktokads/music", f);
    await sealing.promise;
    await reconnect(env, f);
    go.resolve();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(CHANGED);
    expect(urls(f)).toEqual([TT_USER_REFRESH_URL, TT_USER_TOKEN_URL]);
    expect(await readAccountToken(env)).toMatchObject({ open_id: "new-account" });
    expect((await overlayOf(kv, CONN)).token.access_token).toBe("old-renewed");
    expect(musicKeys(kv)).toEqual([]);
  });

  it("held at the sealed renewal's KV write as the callback completes: still B", async () => {
    const kv = fakeKV();
    await storeV2(kv, accountToken({ open_id: "old-account" }));
    const env = makeEnv(kv);
    const put = kv.put.getMockImplementation()!;
    const writing = deferred<void>();
    const go = deferred<void>();
    kv.put.mockImplementation(async (key, value, opts) => {
      if (key === refreshKey(CONN)) {
        writing.resolve();
        await go.promise;
      }
      return put(key, value, opts);
    });
    const f = transport(
      () => tokenReply("old-renewed", "old-account"),
      () => tokenReply("new-access", "new-account"),
    );
    const pending = get(env, "/tiktokads/music", f);
    await writing.promise;
    await reconnect(env, f);
    go.resolve();
    expect(await (await pending).json()).toEqual(CHANGED);
    expect(await readAccountToken(env)).toMatchObject({ open_id: "new-account" });
    expect(musicKeys(kv)).toEqual([]);
  });

  it("same account reconnected: a fresh connection id, so its stale renewal (same open_id) is not read", async () => {
    const kv = fakeKV();
    await storeV2(kv);
    const env = makeEnv(kv);
    const h = held();
    const f = transport(h.refresh);
    const pending = get(env, "/tiktokads/music", f);
    await h.entered.promise;
    await reconnect(env, f); // TOKEN_OK: the same OPEN_ID, access ACCESS
    const first = (await refOf(kv)).connection;
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(CONN);
    h.release.resolve(tokenReply("stale-renewed"));
    expect(await (await pending).json()).toEqual(CHANGED);
    expect((await overlayOf(kv, CONN)).token).toMatchObject({
      open_id: OPEN_ID,
      access_token: "stale-renewed",
    });
    expect(await readAccountToken(env)).toMatchObject({ open_id: OPEN_ID, access_token: ACCESS });
    // Every callback mints its own id, also back to back for the same account.
    await reconnect(env, f);
    const second = (await refOf(kv)).connection;
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });

  it("legacy record: renewed while legacy, the callback moves to v2, a stale legacy renewal is ignored", async () => {
    const kv = fakeKV();
    const legacy = accountToken();
    await storeLegacy(kv, legacy);
    const before = kv.store.get(REF)!.value;
    const env = makeEnv(kv);
    expect(await readAccountToken(env)).toEqual(legacy);
    // 1. Renewed while legacy: kept under ":legacy", the bare record untouched, status shows the renewal.
    const f1 = transport(() => tokenReply("legacy-renewed"));
    expect((await get(env, "/tiktokads/music", f1)).status).toBe(200);
    expect(kv.store.get(REF)!.value).toBe(before);
    expect(await overlayOf(kv, "legacy")).toMatchObject({
      connection: "legacy",
      token: { access_token: "legacy-renewed", connectedAt: legacy.connectedAt },
    });
    expect(await (await get(env, "/tiktokads/account/status")).json()).toMatchObject({
      expiresAt: "2026-10-16T14:00:00.000Z",
    });
    // 2. The renewed token about to end too: a second legacy renewal starts, held past a callback.
    kv.store.set(refreshKey("legacy"), {
      value: await seal({
        connection: "legacy",
        token: accountToken({ access_token: "legacy-renewed" }),
      }),
    });
    const h = held();
    const f2 = transport(h.refresh, () => tokenReply("new-access", "new-account"));
    const pending = get(env, "/tiktokads/music?range=30", f2);
    await h.entered.promise;
    expect(JSON.parse(String(f2.mock.calls[0][1]?.body)).refresh_token).toBe("old-refresh");
    await reconnect(env, f2);
    expect(await refOf(kv)).toMatchObject({ v: 2, token: { open_id: "new-account" } });
    h.release.resolve(tokenReply("stale-legacy"));
    expect(await (await pending).json()).toEqual(CHANGED);
    expect((await overlayOf(kv, "legacy")).token.access_token).toBe("stale-legacy");
    expect(await readAccountToken(env)).toMatchObject({
      open_id: "new-account",
      access_token: "new-access",
    });
  });

  it("current v2 connection: a normal renewal is kept under its id (bounded) and reused without renewing", async () => {
    const kv = fakeKV();
    await storeV2(kv);
    const before = kv.store.get(REF)!.value;
    const env = makeEnv(kv);
    const f = transport(() => tokenReply("renewed"));
    const res = await get(env, "/tiktokads/music", f);
    expect(res.status).toBe(200);
    expect(accessOf(f, 1)).toBe("renewed");
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).refresh_token).toBe("old-refresh");
    expect(kv.store.get(REF)!.value).toBe(before);
    const kept = kv.store.get(refreshKey(CONN))!;
    expect(kept.expiration).toBe(Date.parse("2027-10-15T14:00:00.000Z") / 1000);
    expect(kept.ttl).toBeUndefined();
    expect(await overlayOf(kv, CONN)).toEqual({
      connection: CONN,
      token: {
        access_token: "renewed",
        refresh_token: "renewed-refresh",
        open_id: OPEN_ID,
        expires_at: "2026-10-16T14:00:00.000Z",
        refresh_expires_at: "2027-10-15T14:00:00.000Z",
        scope: "user.info.basic",
        connectedAt: "2026-10-15T10:00:00.000Z",
      },
    });
    const again = await get(env, "/tiktokads/music?range=30", f);
    expect(again.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
    expect(accessOf(f, 2)).toBe("renewed");
    // The key's expiry never passes a year, whatever TikTok says of the renewed refresh token.
    const kv2 = fakeKV();
    await storeV2(kv2);
    const long = transport(() =>
      tokenReply("renewed", OPEN_ID, { refresh_token_expires_in: 3 * 31536000 }),
    );
    expect((await get(makeEnv(kv2), "/tiktokads/music", long)).status).toBe(200);
    expect(kv2.store.get(refreshKey(CONN))!.expiration).toBe(
      Math.floor((NOW.getTime() + 365 * 86400_000) / 1000),
    );
  });

  it("a renewal naming another account is neither kept nor used: 502 refresh_failed account_mismatch", async () => {
    const kv = fakeKV();
    await storeV2(kv);
    const env = makeEnv(kv);
    const f = transport(() => tokenReply("someone-access", "someone-else"));
    const res = await get(env, "/tiktokads/music", f);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "refresh_failed",
      fetchedAt: NOW.toISOString(),
      status: 0,
      code: null,
      message: "account_mismatch",
    });
    expect(urls(f)).toEqual([TT_USER_REFRESH_URL]);
    expect(kv.store.has(refreshKey(CONN))).toBe(false);
    expect(musicKeys(kv)).toEqual([]);
    expect(await readAccountToken(env)).toMatchObject({ access_token: "old-access" });
  });

  it("a renewal that cannot be kept fails honestly: 502 refresh_failed, no chart, no cache, reference intact", async () => {
    const kv = fakeKV();
    await storeV2(kv);
    const before = kv.store.get(REF)!.value;
    const put = kv.put.getMockImplementation()!;
    kv.put.mockImplementation(async (key, value, opts) => {
      if (key.startsWith("tiktokads:account-refresh:")) throw new Error("kv down");
      return put(key, value, opts);
    });
    const env = makeEnv(kv);
    const f = transport(() => tokenReply("renewed"));
    const res = await get(env, "/tiktokads/music", f);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: "refresh_failed",
      fetchedAt: NOW.toISOString(),
      status: 0,
      code: null,
      message: "storage_failed",
    });
    expect(text).not.toContain("renewed");
    expect(JSON.stringify(logs)).not.toContain("renewed");
    expect(urls(f)).toEqual([TT_USER_REFRESH_URL]);
    expect(musicKeys(kv)).toEqual([]);
    expect(kv.store.get(REF)!.value).toBe(before);
  });

  it("a renewed refresh token already ending (under KV's 60-second minimum) asks to reconnect, keeps nothing", async () => {
    const kv = fakeKV();
    await storeV2(kv);
    const env = makeEnv(kv);
    const f = transport(() => tokenReply("renewed", OPEN_ID, { refresh_token_expires_in: 30 }));
    const res = await get(env, "/tiktokads/music", f);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "reconnect", fetchedAt: NOW.toISOString() });
    expect(urls(f)).toEqual([TT_USER_REFRESH_URL]);
    expect(kv.store.has(refreshKey(CONN))).toBe(false);
    expect(musicKeys(kv)).toEqual([]);
  });

  it("the reference gone after the renewal: 409 not_connected, no chart", async () => {
    const kv = fakeKV();
    await storeV2(kv);
    const env = makeEnv(kv);
    const h = held();
    const f = transport(h.refresh);
    const pending = get(env, "/tiktokads/music", f);
    await h.entered.promise;
    kv.store.delete(REF);
    h.release.resolve(tokenReply("renewed"));
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_connected", fetchedAt: NOW.toISOString() });
    expect(urls(f)).toEqual([TT_USER_REFRESH_URL]);
  });

  it("a refresh record is used only for the same connection and open_id; a malformed one falls back", async () => {
    const fresh = accountToken({ access_token: "ref-access" }, 3600_000);
    const cases: [string, unknown, string][] = [
      ["matching", { connection: CONN, token: { ...fresh, access_token: "overlay" } }, "overlay"],
      ["other connection", { connection: "f".repeat(32), token: fresh }, "ref-access"],
      ["other open_id", { connection: CONN, token: { ...fresh, open_id: "x" } }, "ref-access"],
      ["no token", { connection: CONN }, "ref-access"],
      ["empty access", { connection: CONN, token: { ...fresh, access_token: "" } }, "ref-access"],
      ["not an object", "nope", "ref-access"],
    ];
    for (const [name, value, access] of cases) {
      const kv = fakeKV();
      await storeV2(kv, fresh);
      kv.store.set(refreshKey(CONN), { value: await seal(value) });
      expect((await readAccountToken(makeEnv(kv)))?.access_token, name).toBe(access);
    }
    const kv = fakeKV();
    await storeV2(kv, fresh);
    kv.store.set(refreshKey(CONN), { value: "v1.garbage.garbage" });
    expect((await readAccountToken(makeEnv(kv)))?.access_token).toBe("ref-access");
    kv.store.set(refreshKey(CONN), {
      value: await encryptJson("another", { connection: CONN, token: fresh }),
    });
    expect((await readAccountToken(makeEnv(kv)))?.access_token).toBe("ref-access");
  });

  it("a malformed or foreign reference reads as not connected: status false, music 409, nothing asked", async () => {
    const token = accountToken({}, 3600_000);
    const blobs = [
      await seal({ v: 2, connection: "not-hex", token }),
      await seal({ v: 2, token }),
      await seal({ v: 2, connection: CONN }),
      await seal({ v: 2, connection: CONN, token: { ...token, open_id: "" } }),
      await seal({ v: 3, connection: CONN, token }),
      await seal("text"),
      await encryptJson("another", { v: 2, connection: CONN, token }),
      "garbage",
    ];
    const f = vi.fn<typeof globalThis.fetch>();
    for (const value of blobs) {
      const kv = fakeKV();
      kv.store.set(REF, { value });
      const env = makeEnv(kv);
      expect(await (await get(env, "/tiktokads/account/status")).json()).toEqual({
        connected: false,
      });
      const res = await get(env, "/tiktokads/music", f);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "not_connected" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("a KV read error stays 502 upstream, nothing asked", async () => {
    const kv = fakeKV();
    await storeV2(kv);
    kv.get.mockImplementation(async (key: string) => {
      if (key === refreshKey(CONN)) throw new Error("kv down");
      return kv.store.get(key)?.value ?? null;
    });
    const f = vi.fn<typeof globalThis.fetch>();
    const res = await get(makeEnv(kv), "/tiktokads/music", f);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream", fetchedAt: NOW.toISOString() });
    expect(f).not.toHaveBeenCalled();
  });

  it("status and the music probe read legacy, v2 and renewed records alike; the probe writes and renews nothing", async () => {
    const shape = {
      connected: true,
      openId: "-000…ef",
      scope: "user.info.basic",
      refreshExpiresAt: "2027-08-11T14:00:00.000Z",
    };
    const legacy = fakeKV();
    await storeLegacy(legacy, accountToken({}, 3600_000));
    const v2 = fakeKV();
    await storeV2(v2, accountToken({}, 3600_000));
    const renewed = fakeKV();
    await storeV2(renewed);
    renewed.store.set(refreshKey(CONN), {
      value: await seal({
        connection: CONN,
        token: accountToken({ access_token: "renewed" }, 86400_000),
      }),
    });
    for (const [kv, expiresAt, access] of [
      [legacy, "2026-10-15T15:00:00.000Z", "old-access"],
      [v2, "2026-10-15T15:00:00.000Z", "old-access"],
      [renewed, "2026-10-16T14:00:00.000Z", "renewed"],
    ] as const) {
      const env = makeEnv(kv);
      expect(await (await get(env, "/tiktokads/account/status")).json()).toEqual({
        ...shape,
        expiresAt,
      });
      const f = vi.fn<typeof globalThis.fetch>(async () => chart());
      kv.put.mockClear();
      const probe = await musicProbe(new Request(`${BASE}/tiktokads/music-probe`), env, f, NOW);
      expect(probe.status).toBe(200);
      expect((probe.body.attempts as { name: string }[]).map((a) => a.name)).toEqual([
        "cml_trending_list_account",
      ]);
      expect(f).toHaveBeenCalledTimes(1);
      expect((f.mock.calls[0][1]?.headers as Record<string, string>)["Access-Token"]).toBe(access);
      expect(JSON.stringify(probe.body)).not.toContain(OPEN_ID);
      expect(kv.put).not.toHaveBeenCalled();
      expect(kv.delete).not.toHaveBeenCalled();
    }
  });
});

describe("DT-6B-3A-R1: only an actual list is a chart", () => {
  for (const [name, data] of [
    ["missing", {}],
    ["null", { list: null }],
    ["an object", { list: { unexpected: "shape" } }],
    ["a string", { list: "[]" }],
  ] as const)
    it(`a list that is ${name}: 502 upstream malformed_list, no chart cached`, async () => {
      const kv = fakeKV();
      await storeToken(kv);
      const env = makeEnv(kv);
      const f = vi.fn<typeof globalThis.fetch>(async () => json({ code: 0, message: "OK", data }));
      const res = await get(env, "/tiktokads/music", f);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: "upstream",
        fetchedAt: NOW.toISOString(),
        detail: "malformed_list",
      });
      expect(kv.put).not.toHaveBeenCalled();
      expect(musicKeys(kv)).toEqual([]);
      // Nothing false was kept: the next request asks TikTok again.
      await get(env, "/tiktokads/music", f);
      expect(f).toHaveBeenCalledTimes(2);
    });

  it("an empty array is a real empty chart, kept 6 hours and served from the cache", async () => {
    const kv = fakeKV();
    await storeToken(kv);
    const env = makeEnv(kv);
    const f = vi.fn<typeof globalThis.fetch>(async () => chart([]));
    const res = await get(env, "/tiktokads/music?country=SA", f);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      fetchedAt: NOW.toISOString(),
      country: "SA",
      range: "7",
      genre: "ALL",
      items: [],
    });
    expect(kv.store.get("tiktokads:music:SA:7:ALL")!.ttl).toBe(21600);
    expect(await (await get(env, "/tiktokads/music?country=SA", f)).json()).toEqual(body);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rows keep TikTok's order (no re-sorting); each query has its own cache entry", async () => {
    const kv = fakeKV();
    await storeToken(kv);
    const env = makeEnv(kv);
    const rows = [
      { commercial_music_id: "c", rank_position: 3 },
      { commercial_music_id: "a", rank_position: 1 },
      { commercial_music_id: "b", rank_position: 2 },
    ];
    const f = vi.fn<typeof globalThis.fetch>(async (input) =>
      chart(
        new URL(String(input)).searchParams.get("country_code") === "US" ? rows : rows.slice(0, 1),
      ),
    );
    type Chart = { items: { id: string }[] };
    const us = await (await get(env, "/tiktokads/music?country=US&range=1", f)).json<Chart>();
    expect(us.items.map((i) => i.id)).toEqual(["c", "a", "b"]);
    const sa = await (await get(env, "/tiktokads/music?country=SA&range=1", f)).json<Chart>();
    expect(sa.items.map((i) => i.id)).toEqual(["c"]);
    expect(musicKeys(kv).sort()).toEqual(["tiktokads:music:SA:1:ALL", "tiktokads:music:US:1:ALL"]);
    expect(f).toHaveBeenCalledTimes(2);
    expect(await (await get(env, "/tiktokads/music?country=US&range=1", f)).json()).toEqual(us);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
