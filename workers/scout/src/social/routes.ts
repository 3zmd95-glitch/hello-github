/**
 * HTTP surface of the social side (contract with the dashboard, see README "Social analytics"):
 *
 *   POST   /social/connect/:platform   { returnTo } → { url }            start OAuth
 *   GET    /oauth/:platform/callback   ?code&state   → 302 returnTo      (no bearer; state is one-time)
 *   GET    /social/status                            → { platforms }
 *   POST   /social/sync                { platforms? } → { synced, errors }
 *   DELETE /social/connect/:platform                 → { ok: true }      forget tokens (rows stay)
 *   GET    /social/data?since=YYYY-MM-DD             → { accounts, snapshots, postStats, demographics, syncedAt }
 *   GET    /social/publish                           → { jobs }          the auto-post queue (publish.ts)
 *   POST   /social/publish            { id, scheduledAt, media?, targets } → { job }   add or replace a job
 *   POST   /social/publish/:id/run                   → { job }          publish now
 *   DELETE /social/publish/:id                       → { ok: true }     cancel
 *   GET    /social/replies                           → { automations, log, … }   auto-replies (replies.ts)
 *   POST   /social/replies            { id, keywords, dmText, … } → { automation }   add or replace
 *   POST   /social/replies/poll                      → { result, automations, … } check the comments now
 *   DELETE /social/replies/:id                       → { ok: true }
 *
 * `POST /social/connect/:platform` takes `publish: true` (posting scopes) and, for Instagram, `replies: true`
 * (comment + message scopes on top of the posting ones).
 *
 * The router in `scout.ts` has already checked CORS and, for /social/*, the bearer token.
 */

import { isAllowedReturnTo } from "../origins";
import { pkceChallenge, randomToken } from "./crypto";
import { Budget } from "./http";
import { credentials, isConfigured, PROVIDERS, redirectUri } from "./oauth";
import { handlePublish } from "./publish";
import { handleReplies } from "./replies";
import { defaultSince, Store, type SocialEnv } from "./store";
import { FETCH_BUDGET, syncAll, syncPlatform } from "./sync";
import { DAY_KEY_RE } from "./time";
import {
  isSocialPlatform,
  SOCIAL_PLATFORMS,
  SocialError,
  type AccountRow,
  type DemographicRow,
  type PlatformStatus,
  type PostRow,
  type SnapshotRow,
  type SocialErrorCode,
  type SocialPlatform,
  type TokenSet,
} from "./types";

export interface SocialDeps {
  fetch?: typeof fetch;
  /** Test seam for "now". */
  now?: () => Date;
}

/** Outbound calls left for the first sync after the code exchange (which itself takes up to two). */
const CALLBACK_SYNC_BUDGET = FETCH_BUDGET - 6;

const STATUS: Record<SocialErrorCode, number> = {
  not_configured: 503,
  not_connected: 409,
  state_invalid: 400,
  exchange_failed: 502,
  token_expired: 409,
  upstream: 502,
  rate_limited: 429,
  bad_request: 400,
};

function json(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

const fail = (error: SocialErrorCode, cors: Headers) => json({ error }, STATUS[error], cors);

/** `health.social`. */
export function healthSocial(env: SocialEnv): {
  configured: Record<SocialPlatform, boolean>;
  kv: boolean;
} {
  const configured = {} as Record<SocialPlatform, boolean>;
  for (const p of SOCIAL_PLATFORMS) configured[p] = isConfigured(env, p);
  return { configured, kv: !!env.SOCIAL_KV };
}

/** "/social/connect/tiktok" → ["connect", "tiktok"]. */
function socialPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).slice(1);
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* ---------- /social/* (bearer already checked) ---------- */

/** Answers a `/social/*` request, or returns null when the path is not one of ours. */
export async function handleSocial(
  req: Request,
  env: SocialEnv,
  cors: Headers,
  deps: SocialDeps = {},
): Promise<Response | null> {
  const { pathname, searchParams } = new URL(req.url);
  if (!pathname.startsWith("/social/")) return null;
  const [action, rest] = socialPath(pathname);
  const now = deps.now?.() ?? new Date();
  const store = Store.from(env);

  if (action === "connect" && rest && !socialPath(pathname)[2]) {
    if (!isSocialPlatform(rest)) return fail("bad_request", cors);
    if (req.method === "POST") return connect(req, env, rest, cors, store, now);
    if (req.method === "DELETE") {
      if (!store) return fail("not_configured", cors);
      await store.forget(rest);
      return json({ ok: true }, 200, cors);
    }
    return null;
  }
  if (action === "replies") {
    return handleReplies(req, env, socialPath(pathname).slice(1), store, now, deps.fetch, {
      json: (body, status) => json(body, status, cors),
      fail: (error) => fail(error, cors),
    });
  }
  if (action === "publish") {
    return handlePublish(req, env, socialPath(pathname).slice(1), store, now, deps.fetch, {
      json: (body, code) => json(body, code, cors),
      fail: (error) => fail(error, cors),
    });
  }
  if (action === "status" && !rest && req.method === "GET") return status(env, cors, store);
  if (action === "sync" && !rest && req.method === "POST")
    return sync(req, env, cors, store, deps, now);
  if (action === "data" && !rest && req.method === "GET") {
    return data(env, cors, store, searchParams.get("since"), now);
  }
  return null;
}

async function connect(
  req: Request,
  env: SocialEnv,
  platform: SocialPlatform,
  cors: Headers,
  store: Store | null,
  now: Date,
): Promise<Response> {
  const body = await readJson(req);
  const returnTo = typeof body?.returnTo === "string" ? body.returnTo : "";
  const publish = body?.publish === true;
  const replies = body?.replies === true;
  if (!body || !returnTo || !isAllowedReturnTo(returnTo, env)) return fail("bad_request", cors);
  const provider = PROVIDERS[platform];
  // Only Instagram has reply scopes (comments + messages); asking elsewhere is a dashboard bug.
  if (replies && !provider.replyScopes) return fail("bad_request", cors);
  const creds = credentials(env, platform);
  if (!store || !creds) return fail("not_configured", cors);

  const nonce = randomToken(32);
  const verifier = provider.pkce ? randomToken(48) : undefined;
  const challenge = verifier ? await pkceChallenge(verifier) : undefined;
  await store.putState(nonce, {
    platform,
    returnTo,
    createdAt: now.toISOString(),
    ...(verifier ? { verifier } : {}),
    ...(publish ? { publish } : {}),
    ...(replies ? { replies } : {}),
  });
  const origin = new URL(req.url).origin;
  const url = provider.authorizeUrl(
    creds,
    redirectUri(origin, platform),
    nonce,
    challenge,
    publish || replies,
    replies,
  );
  return json({ url }, 200, cors);
}

async function status(env: SocialEnv, cors: Headers, store: Store | null): Promise<Response> {
  const platforms = {} as Record<SocialPlatform, PlatformStatus>;
  for (const p of SOCIAL_PLATFORMS) {
    const configured = isConfigured(env, p);
    const tokens = store ? await store.getTokens(p) : null;
    const stored = (store && (await store.getStatus(p))) ?? {};
    platforms[p] = {
      configured,
      connected: !!tokens,
      canPublish: !!tokens?.canPublish,
      canReply: !!tokens?.canReply,
      ...stored,
      ...(tokens?.expiresAt ? { tokenExpiresAt: tokens.expiresAt } : {}),
    };
  }
  return json({ platforms }, 200, cors);
}

async function sync(
  req: Request,
  env: SocialEnv,
  cors: Headers,
  store: Store | null,
  deps: SocialDeps,
  now: Date,
): Promise<Response> {
  const body = await readJson(req);
  if (!body) return fail("bad_request", cors);
  let platforms: SocialPlatform[] | undefined;
  if (body.platforms !== undefined) {
    if (!Array.isArray(body.platforms) || !body.platforms.every(isSocialPlatform)) {
      return fail("bad_request", cors);
    }
    platforms = [...new Set(body.platforms as SocialPlatform[])];
  }
  if (!store) return fail("not_configured", cors);
  const result = await syncAll(env, { fetch: deps.fetch, now }, platforms);
  return json(result, 200, cors);
}

async function data(
  env: SocialEnv,
  cors: Headers,
  store: Store | null,
  sinceParam: string | null,
  now: Date,
): Promise<Response> {
  if (sinceParam !== null && !DAY_KEY_RE.test(sinceParam)) return fail("bad_request", cors);
  const since = sinceParam ?? defaultSince(now);
  const accounts: AccountRow[] = [];
  const snapshots: SnapshotRow[] = [];
  const postStats: PostRow[] = [];
  const demographics: DemographicRow[] = [];
  const syncedAt: Partial<Record<SocialPlatform, string>> = {};
  if (store) {
    for (const p of SOCIAL_PLATFORMS) {
      const st = await store.getStatus(p);
      if (st?.handle)
        accounts.push({ platform: p, handle: st.handle, ...(st.url ? { url: st.url } : {}) });
      if (st?.lastSyncAt) syncedAt[p] = st.lastSyncAt;
      snapshots.push(...(await store.listSnapshots(p, since)));
      const posts = Object.values(await store.getPosts(p))
        .filter((row) => row.publishedAt.slice(0, 10) >= since)
        .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
      postStats.push(...posts);
      demographics.push(...(await store.latestDemographics(p, since)));
    }
  }
  return json({ accounts, snapshots, postStats, demographics, syncedAt }, 200, cors);
}

/* ---------- GET /oauth/:platform/callback (no bearer) ---------- */

function redirectBack(returnTo: string, params: Record<string, string>): Response {
  const u = new URL(returnTo);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: { Location: u.toString(), "Cache-Control": "no-store" },
  });
}

export async function handleOAuthCallback(
  req: Request,
  env: SocialEnv,
  platform: string,
  deps: SocialDeps = {},
): Promise<Response> {
  const plain = (body: unknown, status: number) => json(body, status, new Headers());
  if (!isSocialPlatform(platform)) return plain({ error: "bad_request" }, 400);
  const q = new URL(req.url).searchParams;
  const store = Store.from(env);
  if (!store) return plain({ error: "not_configured" }, 503);
  const now = deps.now?.() ?? new Date();

  const state = await store.takeState(q.get("state") ?? "");
  if (!state || !isAllowedReturnTo(state.returnTo, env))
    return plain({ error: "state_invalid" }, 400);
  const back = (params: Record<string, string>) => redirectBack(state.returnTo, params);
  const error = (reason: string) => back({ connect_error: platform, reason });
  if (state.platform !== platform) return error("state_invalid");
  if (Date.parse(state.createdAt) < now.getTime() - 10 * 60_000) return error("state_invalid");

  const providerError = q.get("error");
  if (providerError) {
    // Shows up in the Worker's Observability logs; the provider's own words, never a token.
    console.log(
      JSON.stringify({ oauth: platform, providerError, detail: q.get("error_description") }),
    );
    return error(providerError === "access_denied" ? "access_denied" : "exchange_failed");
  }
  const code = q.get("code");
  if (!code) return error("bad_request");
  const creds = credentials(env, platform);
  if (!creds) return error("not_configured");

  const http = { fetch: deps.fetch ?? fetch, budget: new Budget(6) };
  let tokens: TokenSet;
  try {
    tokens = await PROVIDERS[platform].exchange(
      creds,
      code,
      redirectUri(new URL(req.url).origin, platform),
      state.verifier,
      http,
      now,
    );
  } catch (e) {
    // e.g. "exchange_failed: invalid_client" or "…: redirect_uri_mismatch"; the reply's error field only.
    console.log(
      JSON.stringify({ oauth: platform, exchangeError: String((e as Error)?.message ?? e) }),
    );
    return error(e instanceof SocialError && e.code !== "upstream" ? e.code : "exchange_failed");
  }
  if (state.publish || state.replies) tokens = { ...tokens, canPublish: true };
  if (state.replies) {
    // The reply scopes are asked for together with the posting ones (oauth.ts scopeFor), but the consent
    // dialog lets the owner untick one: trust the granted list when the provider sent it.
    const granted = tokens.scope ? tokens.scope.split(/[,\s]+/).filter(Boolean) : null;
    const wanted = PROVIDERS[platform].replyScopes?.split(/[,\s]+/).filter(Boolean) ?? [];
    const canReply = !granted || wanted.every((s) => granted.includes(s));
    tokens = { ...tokens, canReply };
  }
  await store.putTokens(platform, tokens);
  const previous = (await store.getStatus(platform)) ?? {};
  await store.putStatus(platform, {
    ...previous,
    connectedAt: now.toISOString(),
    lastError: undefined,
    tokenExpiresAt: tokens.expiresAt,
  });
  // The first pull right away, so the dashboard has numbers when the owner lands back on it. A failure
  // here is recorded in the status, not reported on the redirect: the account is connected either way.
  await syncPlatform(env, platform, { fetch: deps.fetch, now, budget: CALLBACK_SYNC_BUDGET });
  return back({ connected: platform });
}
