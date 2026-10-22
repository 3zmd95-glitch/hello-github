import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "./scout";
import { decryptJson } from "./social/crypto";
import { TIKTOK_ADS_AUTH_URL, TIKTOK_ADS_TOKEN_URL, type AdsToken } from "./tiktokads";

// The owner's TikTok for Business app (planning/tools/19-category-trends.md §6): connect, TikTok's callback and the
// status, through the Worker's router. Every value here is fake.

const SCOUT = "scout-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const RETURN = `${APP}/hello-github/discover/?x=1#top`;
const NOW = new Date("2026-10-07T09:00:00Z");
const APP_ID = "7693488727766597653";
const SECRET = "fake-ads-secret";
const ACCESS = "fake-long-term-token";

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

function makeEnv(kv: FakeKV = fakeKV(), extra: Partial<Env> = {}): Env {
  return {
    SCOUT_TOKEN: SCOUT,
    ALLOWED_ORIGINS: `http://localhost:3000,${APP}`,
    SOCIAL_KV: kv as unknown as KVNamespace,
    TIKTOK_ADS_APP_ID: APP_ID,
    TIKTOK_ADS_SECRET: SECRET,
    ...extra,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** TikTok's token endpoint answering `reply` (or throwing when it is an Error). */
const tiktok = (reply: Response | Error = json(TOKEN_OK)) =>
  vi.fn<typeof fetch>(async () => {
    if (reply instanceof Error) throw reply;
    return reply.clone();
  });
const TOKEN_OK = {
  code: 0,
  message: "OK",
  data: { access_token: ACCESS, advertiser_ids: ["111", "222"], scope: [4, 5] },
};

const connect = (env: Env, body: unknown = { returnTo: RETURN }, token: string | null = SCOUT) =>
  handle(
    new Request(`${BASE}/tiktokads/connect`, {
      method: "POST",
      headers: {
        Origin: APP,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // null: no body at all.
      body: body === null ? undefined : JSON.stringify(body),
    }),
    env,
    undefined,
    { now: () => NOW },
  );
/** TikTok sending the owner's browser back: no bearer, no Origin. */
const callback = (env: Env, query: string, fetch = tiktok(), now = NOW) =>
  handle(new Request(`${BASE}/oauth/tiktokads/callback?${query}`), env, undefined, {
    fetch,
    now: () => now,
  });
const status = (env: Env, token: string | null = SCOUT) =>
  handle(
    new Request(`${BASE}/tiktokads/status`, {
      headers: { Origin: APP, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }),
    env,
  );

/** A connect's state, read off TikTok's authorization URL. */
async function stateOf(env: Env): Promise<string> {
  const { url } = (await (await connect(env)).json()) as { url: string };
  return new URL(url).searchParams.get("state")!;
}
const back = (res: Response) => new URL(res.headers.get("Location")!);

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const level of ["log", "error", "warn"] as const)
    vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /tiktokads/connect", () => {
  it("answers TikTok's advertiser authorization page and keeps a one-time state for 10 minutes", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const res = await connect(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    const { url } = (await res.json()) as { url: string };
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(TIKTOK_ADS_AUTH_URL);
    expect(TIKTOK_ADS_AUTH_URL).toBe("https://business-api.tiktok.com/portal/auth");
    expect(u.searchParams.get("app_id")).toBe(APP_ID);
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/oauth/tiktokads/callback`);
    // The redirect is URL-encoded in the address, as TikTok asks.
    expect(url).toContain(`redirect_uri=${encodeURIComponent(`${BASE}/oauth/tiktokads/callback`)}`);
    const state = u.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(40);
    const kept = kv.store.get(`tiktokads:state:${state}`)!;
    expect(kept.ttl).toBe(600);
    expect(JSON.parse(kept.value)).toEqual({ returnTo: RETURN, createdAt: NOW.toISOString() });
    // A new state every time.
    expect(await stateOf(env)).not.toBe(state);
  });

  it("needs the bearer, a returnTo on an allowed origin and the app's secret; nothing is kept otherwise", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    expect((await connect(env, { returnTo: RETURN }, null)).status).toBe(401);
    expect((await connect(env, { returnTo: RETURN }, "wrong")).status).toBe(401);
    for (const body of [
      { returnTo: "https://evil.example/discover/" },
      { returnTo: "javascript:alert(1)" },
      { returnTo: 7 },
      {},
      null,
      "not json",
    ]) {
      const res = await connect(env, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    for (const missing of [
      { TIKTOK_ADS_SECRET: undefined },
      { TIKTOK_ADS_SECRET: "  " },
      { TIKTOK_ADS_APP_ID: undefined },
    ]) {
      const res = await connect(makeEnv(kv, missing));
      expect(res.status, JSON.stringify(missing)).toBe(409);
      expect(await res.json()).toEqual({ error: "not_configured" });
    }
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe("GET /oauth/tiktokads/callback", () => {
  it("exchanges the auth code once (a JSON body), keeps the token encrypted and sends the owner back connected", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const state = await stateOf(env);
    const fetch = tiktok();
    const res = await callback(env, `auth_code=AC%231&state=${state}`, fetch);
    expect(res.status).toBe(302);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Back where the owner was, his own query and hash kept.
    const loc = back(res);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${APP}/hello-github/discover/`);
    expect(loc.searchParams.get("x")).toBe("1");
    expect(loc.searchParams.get("tiktokads")).toBe("connected");
    expect(loc.hash).toBe("#top");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(TIKTOK_ADS_TOKEN_URL);
    expect(TIKTOK_ADS_TOKEN_URL).toBe(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      app_id: APP_ID,
      secret: SECRET,
      auth_code: "AC#1",
      return_advertiser_ids: true,
    });

    // Unreadable in KV, as the social tokens are; it opens with SCOUT_TOKEN.
    const raw = kv.store.get("tiktokads:token")!.value;
    expect(raw.startsWith("v1.")).toBe(true);
    expect(raw).not.toContain(ACCESS);
    expect(await decryptJson<AdsToken>(SCOUT, raw)).toEqual({
      access_token: ACCESS,
      advertiser_ids: ["111", "222"],
      scope: [4, 5],
      connectedAt: NOW.toISOString(),
    });
    // The state was taken.
    expect([...kv.store.keys()].filter((k) => k.startsWith("tiktokads:state:"))).toEqual([]);
  });

  it("takes `code` too, as TikTok may name it", async () => {
    const env = makeEnv();
    const fetch = tiktok();
    const res = await callback(env, `code=AC2&state=${await stateOf(env)}`, fetch);
    expect(back(res).searchParams.get("tiktokads")).toBe("connected");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ auth_code: "AC2" });
  });

  it("refuses a missing, wrong, reused or stale state: nothing exchanged", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const fetch = tiktok();
    for (const query of ["auth_code=AC", "auth_code=AC&state=", "auth_code=AC&state=nope"]) {
      const res = await callback(env, query, fetch);
      expect(res.status, query).toBe(400);
      expect(await res.json()).toEqual({ error: "state_invalid" });
    }
    const state = await stateOf(env);
    expect((await callback(env, `auth_code=AC&state=${state}`, fetch)).status).toBe(302);
    const reused = await callback(env, `auth_code=AC&state=${state}`, fetch);
    expect(reused.status).toBe(400);
    expect(await reused.json()).toEqual({ error: "state_invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Past its 10 minutes (KV's TTL is not exact): back with the reason, nothing exchanged, the state gone.
    const stale = await stateOf(env);
    const late = new Date(NOW.getTime() + 11 * 60_000);
    const res = await callback(env, `auth_code=AC&state=${stale}`, fetch, late);
    expect(back(res).searchParams.get("tiktokads_error")).toBe("state_invalid");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(kv.store.has(`tiktokads:state:${stale}`)).toBe(false);
  });

  it("a non-zero code, no answer, no advertiser or no code sends the owner back with the reason; nothing kept", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv);
    const cases: [Response | Error | null, string][] = [
      [
        json({ code: 40001, message: "Auth code is invalid or expired.", data: {} }),
        "exchange_failed",
      ],
      [json({ data: { access_token: ACCESS, advertiser_ids: ["1"] } }), "exchange_failed"],
      [json({ message: "Internal error" }, 500), "exchange_failed"],
      [new Response("<html>busy</html>", { status: 200 }), "exchange_failed"],
      [new Error("network"), "exchange_failed"],
      [json({ code: 0, data: { access_token: ACCESS, advertiser_ids: [] } }), "no_advertiser"],
      [json({ code: 0, data: { access_token: ACCESS } }), "no_advertiser"],
      [null, "no_code"],
    ];
    for (const [reply, reason] of cases) {
      const fetch = tiktok(reply ?? json(TOKEN_OK));
      const query = reply
        ? `auth_code=AC&state=${await stateOf(env)}`
        : `state=${await stateOf(env)}`;
      const res = await callback(env, query, fetch);
      expect(res.status, reason).toBe(302);
      const loc = back(res);
      expect(loc.searchParams.get("tiktokads_error"), String(reply)).toBe(reason);
      expect(loc.searchParams.has("tiktokads")).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(reply ? 1 : 0);
    }
    expect(kv.store.has("tiktokads:token")).toBe(false);
    // Without the secret now (removed after the connect): nothing asked.
    const state = await stateOf(env);
    const fetch = tiktok();
    const res = await callback(
      makeEnv(kv, { TIKTOK_ADS_SECRET: undefined }),
      `auth_code=AC&state=${state}`,
      fetch,
    );
    expect(back(res).searchParams.get("tiktokads_error")).toBe("not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never logs or echoes the secret, the code or the token, even when TikTok's message repeats them", async () => {
    const env = makeEnv();
    const echo = json({
      code: 40002,
      message: `secret ${SECRET} does not match code AC9`,
      data: {},
    });
    const failed = await callback(env, `auth_code=AC9&state=${await stateOf(env)}`, tiktok(echo));
    const ok = await callback(env, `auth_code=AC9&state=${await stateOf(env)}`);
    const said = JSON.stringify(logs);
    // TikTok's own words are logged for the live check, without the secret or the code.
    expect(said).toContain("40002");
    for (const secret of [SECRET, ACCESS, "AC9"]) {
      expect(said).not.toContain(secret);
      for (const res of [failed, ok]) {
        expect(res.headers.get("Location")).not.toContain(secret);
        expect(await res.clone().text()).not.toContain(secret);
      }
    }
  });
});

describe("GET /tiktokads/status", () => {
  it("says whether TikTok is connected and for how many advertisers, never the token; bearer only", async () => {
    const env = makeEnv();
    expect(await (await status(env)).json()).toEqual({ connected: false, advertisers: 0 });
    await callback(env, `auth_code=AC&state=${await stateOf(env)}`);
    const res = await status(env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ connected: true, advertisers: 2 });
    expect(text).not.toContain(ACCESS);
    expect((await status(env, null)).status).toBe(401);
    // A token sealed with another SCOUT_TOKEN (rotated since) reads as not connected: the owner connects again.
    expect(await (await status({ ...env, SCOUT_TOKEN: "rotated" }, "rotated")).json()).toEqual({
      connected: false,
      advertisers: 0,
    });
  });
});
