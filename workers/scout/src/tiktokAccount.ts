/**
 * TikTok's trending songs (Commercial Music Library) for 3z Prod. TikTok's Discovery API answers its track endpoints
 * only to a TikTok *account* token, not to the advertiser token tiktokads.ts keeps (live: code 40105, 2026-10-15). So
 * the owner authorizes the same app "ONUS Content Planner" once more, as a TikTok account holder (tt_user OAuth).
 *
 * TikTok's docs (business-api.tiktok.com/portal/docs, checked 2026-10-15):
 * - Account authorization, id=1738083939371009: the "TikTok account holder authorization URL"
 *   (https://www.tiktok.com/v2/auth/authorize?...) with an optional `state`; the account holder redirect URL is
 *   registered in My Apps and must be absolute https and end with "/"; `auth_code` is good 10 minutes, once.
 * - Tokens, id=1738084387220481: POST /tt_user/oauth2/token/ { client_id, client_secret, grant_type:
 *   "authorization_code", auth_code, redirect_uri } → { access_token (1 day), refresh_token (1 year), open_id, scope,
 *   expires_in, refresh_token_expires_in }; POST /tt_user/oauth2/refresh_token/ { client_id, client_secret,
 *   grant_type: "refresh_token", refresh_token } renews it.
 * - Songs, id=1825119063013505: GET /discovery/cml/trending_list/, header Access-Token, `business_id` = open_id,
 *   `genre` (ALL), `country_code`, `date_range` 1DAY|7DAY|30DAY|90DAY; up to 100 tracks.
 *
 *   GET /tiktokads/account/connect       → 302 to TikTok's account authorization page (Bearer); 409 not_configured
 *   GET /oauth/tiktokads/account/callback/ → a small HTML page: connected, or the reason (no bearer: the one-time
 *                                        state is the credential)
 *   GET /tiktokads/account/status        → { connected, openId (masked), scope, expiresAt, refreshExpiresAt }
 *   GET /tiktokads/music?country=SA|US&range=1|7|30|90&genre= → the chart, normalized, kept 6 hours a query
 *
 * KV (`SOCIAL_KV`): `tiktokads:account-state:<nonce>` { createdAt } 10 minutes; `tiktokads:account` the connection,
 * sealed as `tiktokads:token` is: `{ v: 2, connection, token }`, written only by the callback, with a fresh random id
 * per connection (a bare sealed token from before is read as connection "legacy" and never rewritten);
 * `tiktokads:account-refresh:<connection>` `{ connection, token }` sealed, a renewed token, expiring with its refresh
 * token (≤ 1 year); `tiktokads:music:<country>:<range>:<genre>` the answer, 6 hours. Tokens, the secret and the auth
 * code are never logged or echoed.
 *
 * A renewal is keyed by the connection it started from, so one still in flight when the owner reconnects lands under
 * the old id and is never read again: it cannot replace the new connection. KV is eventually consistent, so another
 * location may still see the previous connection for a while; that switch is not linearizable.
 */

import { CALL_TIMEOUT_MS } from "./discover/fetchers";
import { isRecord } from "./effects/ai";
import { json } from "./effects/routes";
import { getJson, withParams } from "./categories/top";
import { decryptJson, encryptJson, randomToken } from "./social/crypto";
import { STATE_TTL_S } from "./social/store";
import { app, hide, takeOnce, type TikTokAdsEnv } from "./tiktokads";

export const TT_ACCOUNT_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://business-api.tiktok.com/open_api/v1.3";
export const TT_USER_TOKEN_URL = `${API}/tt_user/oauth2/token/`;
export const TT_USER_REFRESH_URL = `${API}/tt_user/oauth2/refresh_token/`;
export const TT_CML_TRENDING_URL = `${API}/discovery/cml/trending_list/`;
/** Must be registered in the app as a "TikTok account holder redirect URL" (with the trailing slash). */
export const ACCOUNT_CALLBACK_PATH = "/oauth/tiktokads/account/callback/";
/** The baseline account scope; the CML chart asks no other. */
const SCOPE = "user.info.basic";
const MUSIC_TTL_S = 6 * 3600;
/** Renew this long before the 1-day access token runs out. */
const RENEW_EARLY_MS = 5 * 60_000;
const MESSAGE_MAX = 200;
const COUNTRIES = ["SA", "US"];
const RANGES = ["1", "7", "30", "90"];
const GENRE = /^[A-Z0-9_&/-]{1,40}$/;

/** KV refuses an expiration closer than this. */
const KV_MIN_EXPIRY_MS = 60_000;
const YEAR_MS = 365 * 86400_000;
const LEGACY = "legacy";
const CONNECTION = /^[0-9a-f]{32}$/;

const keys = {
  token: "tiktokads:account",
  refresh: (connection: string) => `tiktokads:account-refresh:${connection}`,
  state: (nonce: string) => `tiktokads:account-state:${nonce}`,
  music: (country: string, range: string, genre: string) =>
    `tiktokads:music:${country}:${range}:${genre}`,
};

/** The account token: inside `tiktokads:account` (`token`) and a renewal's `tiktokads:account-refresh:<connection>`. */
export interface AccountToken {
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_at: string;
  refresh_expires_at: string;
  scope?: string;
  connectedAt: string;
}

const str = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : null);
const num = (x: unknown) => {
  const n = typeof x === "string" && x !== "" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const nonEmpty = (x: unknown): x is string => typeof x === "string" && x !== "";

const isToken = (t: unknown): t is AccountToken =>
  isRecord(t) && nonEmpty(t.access_token) && nonEmpty(t.open_id);

type Connection = { connection: string; token: AccountToken };

async function unseal(env: TikTokAdsEnv, key: string): Promise<unknown> {
  const blob = await env.SOCIAL_KV!.get(key, "text");
  return blob ? decryptJson<unknown>(env.SCOUT_TOKEN!, blob) : null;
}

/** The connection the callback wrote (`{ v: 2, connection, token }`, or a bare legacy token); null when malformed. */
async function readConnection(env: TikTokAdsEnv): Promise<Connection | null> {
  if (!env.SOCIAL_KV || !env.SCOUT_TOKEN) return null;
  const r = await unseal(env, keys.token);
  if (!isRecord(r)) return null;
  const c = r.v === undefined ? { connection: LEGACY, token: r } : r.v === 2 ? r : null;
  return c &&
    typeof c.connection === "string" &&
    (c.connection === LEGACY || CONNECTION.test(c.connection)) &&
    isToken(c.token)
    ? { connection: c.connection, token: c.token }
    : null;
}

/** The connection, with its renewal when one was kept for this very connection and account. */
async function resolveAccount(env: TikTokAdsEnv): Promise<Connection | null> {
  const c = await readConnection(env);
  if (!c) return null;
  const r = await unseal(env, keys.refresh(c.connection));
  return isRecord(r) &&
    r.connection === c.connection &&
    isToken(r.token) &&
    r.token.open_id === c.token.open_id
    ? { connection: c.connection, token: r.token }
    : c;
}

/** The current token; null when there is none or it was sealed with another SCOUT_TOKEN. A KV error throws. */
export async function readAccountToken(env: TikTokAdsEnv): Promise<AccountToken | null> {
  return (await resolveAccount(env))?.token ?? null;
}

/** A connection id: 128 random bits, hex. */
const newConnection = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

type Said = { status: number; code: number | null; message: string | null };

/** POSTs `body` to a tt_user token endpoint: the token from TikTok's `data`, or what TikTok said. */
async function tokenCall(
  doFetch: typeof fetch,
  url: string,
  body: Record<string, string>,
  now: Date,
  connectedAt: string,
): Promise<{ token: AccountToken } | Said> {
  let status = 0;
  let out: unknown = null;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    status = res.status;
    out = await res.json().catch(() => null);
  } catch {
    // No answer: status 0.
  }
  const said = isRecord(out) ? out : {};
  const d = said.code === 0 && isRecord(said.data) ? said.data : {};
  const at = (s: unknown) => new Date(now.getTime() + (num(s) ?? 0) * 1000).toISOString();
  if (nonEmpty(d.access_token) && nonEmpty(d.refresh_token) && nonEmpty(d.open_id))
    return {
      token: {
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        open_id: d.open_id,
        expires_at: at(d.expires_in),
        refresh_expires_at: at(d.refresh_token_expires_in),
        ...(typeof d.scope === "string" ? { scope: d.scope } : {}),
        connectedAt,
      },
    };
  return {
    status,
    code: typeof said.code === "number" ? said.code : null,
    message:
      typeof said.message === "string"
        ? hide(
            said.message,
            [body.client_secret, body.auth_code, body.refresh_token].filter(nonEmpty),
          ).slice(0, MESSAGE_MAX)
        : null,
  };
}

/**
 * The account token, renewed when it runs out within 5 minutes. A renewal is kept sealed under the connection it
 * started from (never in `tiktokads:account`), so it cannot replace a connection the callback made meanwhile;
 * `renewed` tells the caller to check that the connection is still current.
 * ponytail: two requests renewing the same connection at the same moment may race on the refresh token; one daily
 * caller makes it rare.
 */
async function freshAccountToken(
  env: TikTokAdsEnv,
  doFetch: typeof fetch,
  now: Date,
): Promise<
  | { token: AccountToken; connection: string; renewed: boolean }
  | { error: "not_connected" | "reconnect" }
  | ({ error: "refresh_failed" } & Said)
> {
  const current = await resolveAccount(env);
  if (!current) return { error: "not_connected" };
  const { connection, token } = current;
  if (Date.parse(token.expires_at) - now.getTime() > RENEW_EARLY_MS)
    return { token, connection, renewed: false };
  const creds = app(env);
  if (!creds || !(Date.parse(token.refresh_expires_at) > now.getTime()))
    return { error: "reconnect" };
  const out = await tokenCall(
    doFetch,
    TT_USER_REFRESH_URL,
    {
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    },
    now,
    token.connectedAt,
  );
  if (!("token" in out)) return { error: "refresh_failed", ...out };
  // A renewal belongs to the account it renewed; one naming another account is neither kept nor used.
  if (out.token.open_id !== token.open_id)
    return { error: "refresh_failed", status: 0, code: null, message: "account_mismatch" };
  // The key lives as long as the renewed refresh token, a year at most; one ending within KV's minimum is no renewal.
  const until = Math.min(Date.parse(out.token.refresh_expires_at), now.getTime() + YEAR_MS);
  if (!(until - now.getTime() >= KV_MIN_EXPIRY_MS)) return { error: "reconnect" };
  try {
    await env.SOCIAL_KV!.put(
      keys.refresh(connection),
      await encryptJson(env.SCOUT_TOKEN!, { connection, token: out.token }),
      { expiration: Math.floor(until / 1000) },
    );
  } catch {
    return { error: "refresh_failed", status: 0, code: null, message: "storage_failed" };
  }
  return { token: out.token, connection, renewed: true };
}

/** One chart track as 3z Prod shows it. */
function track(x: unknown) {
  const t = isRecord(x) ? x : {};
  const history = Array.isArray(t.trending_history) ? t.trending_history : [];
  return {
    rank: num(t.rank_position),
    title: str(t.commercial_music_name),
    artist: str(t.artist),
    id: str(t.commercial_music_id),
    previewUrl: str(t.preview_url),
    thumbnail: str(t.thumbnail_url),
    trend: history
      .filter(isRecord)
      .map((h) => ({ date: str(h.date), rank: num(h.rank_position_daily) })),
  };
}

/**
 * GET /tiktokads/music: 1 KV read when kept; else ≤4 KV reads (cache, connection, renewal, the connection again after
 * a renewal), ≤2 calls (renewal + chart), ≤2 KV writes.
 */
async function music(req: Request, env: TikTokAdsEnv, doFetch: typeof fetch, now: Date) {
  const q = new URL(req.url).searchParams;
  const country = (q.get("country") ?? "US").toUpperCase();
  const range = q.get("range") ?? "7";
  const genre = (q.get("genre") || "ALL").toUpperCase();
  if (!COUNTRIES.includes(country) || !RANGES.includes(range) || !GENRE.test(genre))
    return { status: 400, body: { error: "bad_request" } };
  const fetchedAt = now.toISOString();
  const kv = env.SOCIAL_KV;
  if (!kv || !env.SCOUT_TOKEN) return { status: 409, body: { error: "not_connected", fetchedAt } };
  const key = keys.music(country, range, genre);
  let fresh;
  let current;
  try {
    const kept = await kv.get(key, "text");
    if (kept) return { status: 200, body: JSON.parse(kept) as unknown };
    fresh = await freshAccountToken(env, doFetch, now);
    // A renewal took a while: the owner may have connected again meanwhile. Never chart with an obsolete account.
    if ("token" in fresh && fresh.renewed) current = await readConnection(env);
  } catch {
    return { status: 502, body: { error: "upstream", fetchedAt } };
  }
  if (!("token" in fresh)) {
    const { error, ...said } = fresh;
    return { status: error === "refresh_failed" ? 502 : 409, body: { error, fetchedAt, ...said } };
  }
  if (fresh.renewed && current?.connection !== fresh.connection)
    return {
      status: 409,
      body: { error: current ? "account_changed" : "not_connected", fetchedAt },
    };
  const { token } = fresh;
  const r = await getJson(
    doFetch,
    withParams(TT_CML_TRENDING_URL, {
      business_id: token.open_id,
      genre,
      country_code: country,
      date_range: `${range}DAY`,
    }),
    { Accept: "application/json", "Access-Token": token.access_token },
    CALL_TIMEOUT_MS,
  );
  const body = isRecord(r.body) ? r.body : {};
  const data = isRecord(body.data) ? body.data : null;
  if (body.code !== 0 || !data)
    return {
      status: 502,
      body: {
        error: "tiktok",
        fetchedAt,
        status: r.status,
        code: typeof body.code === "number" ? body.code : null,
        message:
          typeof body.message === "string"
            ? hide(body.message, [token.access_token, token.open_id]).slice(0, MESSAGE_MAX)
            : null,
      },
    };
  // A success without an actual list is a broken answer, not an empty chart: never kept.
  if (!Array.isArray(data.list))
    return { status: 502, body: { error: "upstream", fetchedAt, detail: "malformed_list" } };
  const answer = { fetchedAt, country, range, genre, items: data.list.map(track) };
  // A cache that can't be written never fails the answer.
  await kv.put(key, JSON.stringify(answer), { expirationTtl: MUSIC_TTL_S }).catch(() => undefined);
  return { status: 200, body: answer };
}

/** `/tiktokads/account/*` and `/tiktokads/music` (the bearer already checked), or null when not ours. */
export async function handleTikTokAccount(
  req: Request,
  env: TikTokAdsEnv,
  cors: Headers,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const { pathname, origin } = new URL(req.url);
  const now = deps.now?.() ?? new Date();
  if (pathname === "/tiktokads/music") {
    const out = await music(req, env, deps.fetch ?? fetch, now);
    return json(out.body, out.status, cors);
  }
  if (pathname === "/tiktokads/account/status") {
    const t = await readAccountToken(env);
    return json(
      t
        ? {
            connected: true,
            openId: `${t.open_id.slice(0, 4)}…${t.open_id.slice(-2)}`,
            scope: t.scope ?? null,
            expiresAt: t.expires_at,
            refreshExpiresAt: t.refresh_expires_at,
          }
        : { connected: false },
      200,
      cors,
    );
  }
  if (pathname !== "/tiktokads/account/connect") return null;
  const creds = app(env);
  if (!creds || !env.SOCIAL_KV || !env.SCOUT_TOKEN)
    return json({ error: "not_configured" }, 409, cors);
  const nonce = randomToken(32);
  await env.SOCIAL_KV.put(keys.state(nonce), JSON.stringify({ createdAt: now.toISOString() }), {
    expirationTtl: STATE_TTL_S,
  });
  const url = new URL(TT_ACCOUNT_AUTH_URL);
  url.searchParams.set("client_key", creds.id);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${origin}${ACCOUNT_CALLBACK_PATH}`);
  url.searchParams.set("state", nonce);
  // A browser fetch with the bearer cannot follow a 302 into TikTok, so the dashboard asks for the link as JSON.
  const u = new URL(req.url);
  if (
    u.searchParams.get("format") === "json" ||
    req.headers.get("Accept")?.includes("application/json")
  )
    return json({ url: url.toString() }, 200, cors);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), ...Object.fromEntries(cors) },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(ok: boolean, detail = "") {
  const head = ok
    ? "تم ربط حساب تيك توك ✓ · TikTok account connected"
    : "ما زبط ربط تيك توك · Connecting TikTok failed";
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>3z Prod · TikTok</title>
<style>body{font:16px system-ui,sans-serif;background:#111;color:#eee;max-width:28rem;margin:3rem auto;padding:0 1rem}
code{color:#ffd54f}</style></head><body><h1>${head}</h1>
<p>${ok ? "تقدر تسكّر الصفحة · You can close this page." : `<code>${esc(detail)}</code>`}</p></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

/** `GET /oauth/tiktokads/account/callback/?auth_code&state` (TikTok may say `code`): the owner's browser, no bearer. */
export async function handleTikTokAccountCallback(
  req: Request,
  env: TikTokAdsEnv,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<Response> {
  const kv = env.SOCIAL_KV;
  if (!kv) return page(false, "not_configured");
  const u = new URL(req.url);
  const nonce = u.searchParams.get("state") ?? "";
  const state = nonce ? await takeOnce(kv, keys.state(nonce)) : null;
  const now = deps.now?.() ?? new Date();
  // KV's TTL is not exact: a state over its 10 minutes is refused here too.
  if (
    !isRecord(state) ||
    typeof state.createdAt !== "string" ||
    !(now.getTime() - Date.parse(state.createdAt) <= STATE_TTL_S * 1000)
  )
    return page(false, "state_invalid");
  const code = u.searchParams.get("auth_code") || u.searchParams.get("code");
  if (!code) return page(false, "no_code");
  const creds = app(env);
  if (!creds || !env.SCOUT_TOKEN) return page(false, "not_configured");
  const out = await tokenCall(
    deps.fetch ?? fetch,
    TT_USER_TOKEN_URL,
    {
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "authorization_code",
      auth_code: code,
      redirect_uri: `${u.origin}${ACCOUNT_CALLBACK_PATH}`,
    },
    now,
    now.toISOString(),
  );
  if (!("token" in out)) {
    // tokenCall already stripped the secret and the code from TikTok's message.
    console.log(JSON.stringify({ tiktokads_account: { exchange: "failed", ...out } }));
    return page(false, `exchange_failed ${out.code ?? out.status}: ${out.message ?? ""}`);
  }
  // Only a completed connection replaces the reference, always with a new id (a same-account reconnect too).
  // Earlier renewals stay under their own ids until their TTL.
  const connection = newConnection();
  await kv.put(
    keys.token,
    await encryptJson(env.SCOUT_TOKEN, { v: 2, connection, token: out.token }),
  );
  return page(true);
}
