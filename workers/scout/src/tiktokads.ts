/**
 * TikTok trends for the category pages (planning/tools/19-category-trends.md §6): the owner authorizes his TikTok for
 * Business app "ONUS Content Planner" (scope Discovery) once, as an advertiser, and its long-term token (it never
 * expires) reads TikTok's Discovery API on every category scan (categories/tiktok.ts). Kept apart from the social
 * connector (social/): another app and another token, never a `SocialPlatform`; the same style (a one-time state in KV,
 * `redirectBack`).
 *
 *   POST /tiktokads/connect { returnTo } → { url }: TikTok's authorization page (Bearer). 400 bad_request for a returnTo
 *                                        off ALLOWED_ORIGINS; 409 not_configured without the app's id or secret
 *   GET  /oauth/tiktokads/callback       → 302 to returnTo with ?tiktokads=connected, or ?tiktokads_error=<reason>
 *                                        (state_invalid, no_code, not_configured, exchange_failed, no_advertiser). No
 *                                        Bearer: the one-time state is the credential; a missing, wrong or used state
 *                                        is a plain 400 { error: "state_invalid" }
 *   GET  /tiktokads/status               → { connected, advertisers } (Bearer; never the token)
 *
 * KV (`SOCIAL_KV`): `tiktokads:state:<nonce>` { returnTo, createdAt } for 10 minutes, deleted when the callback takes it;
 * `tiktokads:token` the token, sealed as the social tokens are (social/crypto.ts, keyed on SCOUT_TOKEN: rotating it asks
 * for a new connect). The token, the secret and the auth code are never logged or echoed.
 */

import { isRecord } from "./effects/ai";
import { json } from "./effects/routes";
import { isAllowedReturnTo } from "./origins";
import { decryptJson, encryptJson, randomToken } from "./social/crypto";
import { redirectBack } from "./social/routes";
import { STATE_TTL_S } from "./social/store";

export const TIKTOK_ADS_AUTH_URL = "https://business-api.tiktok.com/portal/auth";
export const TIKTOK_ADS_TOKEN_URL =
  "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/";
/** The redirect registered in the app: https://3z-scout.3zmd95.workers.dev/oauth/tiktokads/callback. */
const CALLBACK_PATH = "/oauth/tiktokads/callback";
const keys = {
  token: "tiktokads:token",
  state: (nonce: string) => `tiktokads:state:${nonce}`,
};
/** TikTok's words kept in the log, at most. */
const MESSAGE_MAX = 120;

export interface TikTokAdsEnv {
  SOCIAL_KV?: KVNamespace;
  SCOUT_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  /** Var (wrangler.jsonc): the TikTok for Business app's id. Public. */
  TIKTOK_ADS_APP_ID?: string;
  /** Secret: the app's secret, added by the owner in Cloudflare. Never logged or echoed. */
  TIKTOK_ADS_SECRET?: string;
  /** Var: the country of the category pages' TikTok trends (categories/tiktok.ts; default US). */
  TIKTOK_DISCOVERY_COUNTRY?: string;
}

/** What `tiktokads:token` holds, sealed. */
export interface AdsToken {
  access_token: string;
  /** The advertisers the owner granted; the Discovery calls name the first. */
  advertiser_ids: string[];
  scope?: unknown;
  connectedAt: string;
}

function app(env: TikTokAdsEnv): { id: string; secret: string } | null {
  const id = env.TIKTOK_ADS_APP_ID?.trim();
  const secret = env.TIKTOK_ADS_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/** The stored token; null when there is none or it was sealed with another SCOUT_TOKEN. A KV error throws. */
export async function readAdsToken(env: TikTokAdsEnv): Promise<AdsToken | null> {
  if (!env.SOCIAL_KV || !env.SCOUT_TOKEN) return null;
  const blob = await env.SOCIAL_KV.get(keys.token, "text");
  const t = blob ? await decryptJson<AdsToken>(env.SCOUT_TOKEN, blob) : null;
  return isRecord(t) &&
    typeof t.access_token === "string" &&
    t.access_token !== "" &&
    Array.isArray(t.advertiser_ids)
    ? t
    : null;
}

/** `/tiktokads/*` (the bearer already checked), or null when the path is not one of ours. */
export async function handleTikTokAds(
  req: Request,
  env: TikTokAdsEnv,
  cors: Headers,
  deps: { now?: () => Date } = {},
): Promise<Response | null> {
  const { pathname, origin } = new URL(req.url);
  if (pathname === "/tiktokads/status" && req.method === "GET") {
    const token = await readAdsToken(env);
    return json({ connected: !!token, advertisers: token?.advertiser_ids.length ?? 0 }, 200, cors);
  }
  if (pathname !== "/tiktokads/connect" || req.method !== "POST") return null;
  const body: unknown = await req.json().catch(() => null);
  const returnTo = isRecord(body) ? body.returnTo : undefined;
  if (typeof returnTo !== "string" || !isAllowedReturnTo(returnTo, env))
    return json({ error: "bad_request" }, 400, cors);
  const creds = app(env);
  if (!creds || !env.SOCIAL_KV || !env.SCOUT_TOKEN)
    return json({ error: "not_configured" }, 409, cors);
  const nonce = randomToken(32);
  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  await env.SOCIAL_KV.put(keys.state(nonce), JSON.stringify({ returnTo, createdAt }), {
    expirationTtl: STATE_TTL_S,
  });
  const url = new URL(TIKTOK_ADS_AUTH_URL);
  url.searchParams.set("app_id", creds.id);
  url.searchParams.set("state", nonce);
  url.searchParams.set("redirect_uri", `${origin}${CALLBACK_PATH}`);
  return json({ url: url.toString() }, 200, cors);
}

/** Reads and deletes a state: a nonce is good exactly once. */
async function takeState(
  kv: KVNamespace,
  nonce: string,
): Promise<{ returnTo: string; createdAt: string } | null> {
  const text = nonce ? await kv.get(keys.state(nonce), "text") : null;
  if (!text) return null;
  await kv.delete(keys.state(nonce));
  try {
    const s: unknown = JSON.parse(text);
    return isRecord(s) && typeof s.returnTo === "string" && typeof s.createdAt === "string"
      ? { returnTo: s.returnTo, createdAt: s.createdAt }
      : null;
  } catch {
    return null;
  }
}

/** `text` with none of `secrets` in it. */
const hide = (text: string, secrets: string[]) =>
  secrets.reduce((t, s) => t.split(s).join("…"), text);

/** `GET /oauth/tiktokads/callback?auth_code&state` (TikTok may say `code`): the owner's browser, no bearer. */
export async function handleTikTokAdsCallback(
  req: Request,
  env: TikTokAdsEnv,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<Response> {
  const kv = env.SOCIAL_KV;
  if (!kv) return json({ error: "not_configured" }, 503, new Headers());
  const q = new URL(req.url).searchParams;
  const state = await takeState(kv, q.get("state") ?? "");
  if (!state || !isAllowedReturnTo(state.returnTo, env))
    return json({ error: "state_invalid" }, 400, new Headers());
  const failed = (reason: string) => redirectBack(state.returnTo, { tiktokads_error: reason });
  const now = deps.now?.() ?? new Date();
  // KV's TTL is not exact: a state over its 10 minutes is refused here too.
  if (!(now.getTime() - Date.parse(state.createdAt) <= STATE_TTL_S * 1000))
    return failed("state_invalid");
  const code = q.get("auth_code") || q.get("code");
  if (!code) return failed("no_code");
  const creds = app(env);
  if (!creds || !env.SCOUT_TOKEN) return failed("not_configured");

  let status = 0;
  let body: unknown = null;
  try {
    const res = await (deps.fetch ?? fetch)(TIKTOK_ADS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        app_id: creds.id,
        secret: creds.secret,
        auth_code: code,
        return_advertiser_ids: true,
      }),
    });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    // No answer: status 0.
  }
  // Any code but 0 is a failure.
  const data = isRecord(body) && body.code === 0 && isRecord(body.data) ? body.data : undefined;
  if (typeof data?.access_token !== "string" || !data.access_token) {
    // TikTok's own words for the live check, never the secret or the code (even when TikTok repeats them).
    const said = isRecord(body) ? body : {};
    console.log(
      JSON.stringify({
        tiktokads: {
          exchange: "failed",
          status,
          code: typeof said.code === "number" ? said.code : undefined,
          message:
            typeof said.message === "string"
              ? hide(said.message, [creds.secret, code]).slice(0, MESSAGE_MAX)
              : undefined,
        },
      }),
    );
    return failed("exchange_failed");
  }
  const advertisers = Array.isArray(data.advertiser_ids)
    ? data.advertiser_ids.filter((x): x is string => typeof x === "string" && x !== "")
    : [];
  // The Discovery calls need an advertiser: a grant without one is no connection.
  if (!advertisers.length) return failed("no_advertiser");
  const token: AdsToken = {
    access_token: data.access_token,
    advertiser_ids: advertisers,
    scope: data.scope,
    connectedAt: now.toISOString(),
  };
  await kv.put(keys.token, await encryptJson(env.SCOUT_TOKEN, token));
  return redirectBack(state.returnTo, { tiktokads: "connected" });
}
