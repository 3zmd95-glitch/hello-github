/**
 * The connector's login (round 33, planning/tools/13-discover-search-v2.md): `/authorize` is one page, Arabic and
 * English, asking for the Scout token (dashboard → Settings → API keys, 👁 shows it). The right token completes
 * the OAuth request for "owner"; a wrong one shows the form again (403). Only Claude's callbacks are accepted as
 * redirect targets, because dynamic client registration lets anyone register a client. The OAuth helpers come from
 * `env.OAUTH_PROVIDER` (`@cloudflare/workers-oauth-provider`, injected by index.ts); this module has no runtime
 * import of that package, so Node tests run it with a fake. Also here: which paths are the connector's
 * (`isOAuthPath`) and the write-free `POST /register` (`register`).
 */

import { safeEqual } from "../scout";

export const CLAUDE_CALLBACKS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

export const isAllowedRedirect = (uri: string) => CLAUDE_CALLBACKS.includes(uri);

/** The paths index.ts sends through the OAuth provider; every other route goes straight to `handle()`. */
export const isOAuthPath = (pathname: string) =>
  pathname === "/mcp" ||
  pathname.startsWith("/mcp/") ||
  pathname === "/authorize" ||
  pathname === "/token" ||
  pathname === "/register" ||
  pathname.startsWith("/.well-known/oauth-");

/** The two `OAuthHelpers` methods used here; tsc checks the real ones against it in index.ts. */
export interface AuthHelpers {
  parseAuthRequest(req: Request): Promise<{ redirectUri: string; scope: string[] }>;
  completeAuthorization(o: {
    request: unknown;
    userId: string;
    scope: string[];
    props: unknown;
    metadata: unknown;
  }): Promise<{ redirectTo: string }>;
}

type Notice = "wrong" | "redirect" | "bad" | undefined;

const NOTICE: Record<Exclude<Notice, undefined>, string> = {
  wrong: "التوكن غلط · Wrong token",
  redirect: "هذا الطلب مو من Claude · This request is not from Claude",
  bad: "الطلب ناقص · Bad request",
};

function page(notice: Notice, status = 200): Response {
  const note = notice ? `<p class="n">${NOTICE[notice]}</p>` : "";
  const form =
    notice === "redirect" || notice === "bad"
      ? ""
      : `<form method="post">
  <p class="w">كمّل بس إذا انت للتو ضغطت Connect في Claude حقّك · Only continue if you just pressed Connect in your own Claude</p>
  <label for="t">توكن الـ Scout · Scout token</label>
  <input id="t" name="token" type="password" autocomplete="off" required>
  <p class="h">من لوحتك: الإعدادات ← مفاتيح API ← 👁 · From your dashboard: Settings → API keys → 👁</p>
  <button type="submit">اربط Claude · Connect Claude</button>
</form>`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>3z Prod · Claude</title>
<style>body{font:16px system-ui,sans-serif;background:#111;color:#eee;max-width:28rem;margin:3rem auto;padding:0 1rem}
input,button{font:inherit;width:100%;padding:.6rem;margin:.4rem 0;box-sizing:border-box}button{background:#3ddc84;border:0;font-weight:700}
.n{color:#ff8a80}.w{color:#ffd54f}.h{color:#aaa;font-size:.85rem}</style></head><body>
<h1>3z Prod ← Claude</h1><p>Claude يبغى يدوّر في Discover ويحفظ اختيارات. · Claude wants to search Discover and save picks.</p>
${note}${form}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      // Chrome checks form-action on the redirect that answers the POST too, so Claude's hosts are listed:
      // `form-action 'self'` alone blocks the 302 to the callback.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com",
    },
  });
}

/** The login form is one token field; anyone may POST, so a body past this is refused before it is read whole. */
export const MAX_AUTHORIZE_BYTES = 4 * 1024;

export async function authorize(
  req: Request,
  env: { SCOUT_TOKEN?: string; OAUTH_PROVIDER?: AuthHelpers },
): Promise<Response> {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) return page("bad", 500);
  let oauthReq: Awaited<ReturnType<AuthHelpers["parseAuthRequest"]>>;
  try {
    oauthReq = await helpers.parseAuthRequest(req);
  } catch {
    return page("bad", 400);
  }
  if (!isAllowedRedirect(oauthReq.redirectUri)) return page("redirect", 400);
  if (req.method === "GET") return page(undefined);
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  }
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX_AUTHORIZE_BYTES) return page("bad", 413);
  // Counted while read, whatever Content-Length says; a body that can't be read is no token.
  const text = await readCapped(req, MAX_AUTHORIZE_BYTES).catch(() => "");
  if (text === undefined) return page("bad", 413);
  const given = (new URLSearchParams(text).get("token") ?? "").trim();
  if (!env.SCOUT_TOKEN || !given || !safeEqual(given, env.SCOUT_TOKEN)) return page("wrong", 403);
  let redirectTo: string;
  try {
    ({ redirectTo } = await helpers.completeAuthorization({
      request: oauthReq,
      userId: "owner",
      scope: oauthReq.scope,
      props: { owner: true },
      metadata: { label: "Claude" },
    }));
  } catch {
    // The grant could not be stored (e.g. the day's KV writes are used up): the page, not a raw 500.
    return page("bad", 503);
  }
  return Response.redirect(redirectTo, 302);
}

/* ---------- POST /register ---------- */

export const CLIENT_NAME = "Claude";

/** The shared client as the provider reports it (`ClientInfo`). */
export interface SharedClient {
  clientId: string;
  registrationDate?: number;
}

/** The client this isolate created and when (ms), kept in module scope by index.ts. */
export interface CreatedClient {
  client: SharedClient;
  at: number;
}

/** index.ts wires these to OAUTH_KV, the provider's `lookupClient` / `createClient`, the clock and its memo. */
export interface RegisterDeps {
  /** The shared client's id, kept under one fixed OAUTH_KV key. */
  read(): Promise<string | null>;
  write(clientId: string): Promise<void>;
  lookup(clientId: string): Promise<SharedClient | null>;
  /** A public client (token auth "none") for exactly CLAUDE_CALLBACKS. */
  create(): Promise<SharedClient>;
  now(): number;
  memo: { get(): CreatedClient | undefined; set(created: CreatedClient): void };
}

/** Claude's registration is a few hundred bytes (the provider's own handler allowed 1 MiB). */
export const MAX_REGISTRATION_BYTES = 16 * 1024;
/** KV caches a miss for about 60 s, so a client this isolate just created may not be readable yet. */
export const CREATED_MEMO_MS = 60_000;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** The body as text, or undefined once it passes `max` bytes, whatever Content-Length says (/register, /authorize). */
async function readCapped(req: Request, max: number): Promise<string | undefined> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Dynamic client registration without a write per call: anyone may POST /register, and the Free plan's 1,000 KV
 * writes a day are shared with the auto-post queue and the social sync. A registration naming only Claude's
 * callbacks gets the one shared public client (RFC 7591 §3.2.1 allows a client id for many instances), created once
 * and then only read; anything else is refused before any read or write, and a body over 16 KiB before it is read
 * whole (413). A confidential method asked for still gets the public client (a server may override requested
 * metadata). While KV still caches the miss right after a creation, this isolate answers the client it created
 * (for 60 s) instead of creating another. A KV failure answers 503 `temporarily_unavailable`.
 */
export async function register(req: Request, deps: RegisterDeps): Promise<Response> {
  const tooBig = json({ error: "invalid_client_metadata" }, 413);
  if (Number(req.headers.get("Content-Length") ?? 0) > MAX_REGISTRATION_BYTES) return tooBig;
  // A body that can't be read is no registration: refused below like one that isn't JSON.
  const text = await readCapped(req, MAX_REGISTRATION_BYTES).catch(() => "");
  if (text === undefined) return tooBig;
  let body: { redirect_uris?: unknown } | null = null;
  try {
    body = JSON.parse(text) as { redirect_uris?: unknown } | null;
  } catch {
    // not JSON: refused below
  }
  const uris = body?.redirect_uris;
  const claudeOnly =
    Array.isArray(uris) &&
    uris.length > 0 &&
    uris.every((u) => typeof u === "string" && isAllowedRedirect(u));
  if (!claudeOnly) return json({ error: "invalid_redirect_uri" }, 400);
  let client: SharedClient | null;
  try {
    const stored = await deps.read();
    client = stored ? await deps.lookup(stored) : null;
    const created = deps.memo.get();
    if (!client && created && deps.now() - created.at < CREATED_MEMO_MS) client = created.client;
    if (!client) {
      client = await deps.create();
      deps.memo.set({ client, at: deps.now() });
      await deps.write(client.clientId);
    }
  } catch {
    // KV down or out of the day's writes: an answer Claude can read, never the raw error.
    return json({ error: "temporarily_unavailable" }, 503);
  }
  return json(
    {
      client_id: client.clientId,
      client_name: CLIENT_NAME,
      redirect_uris: [...CLAUDE_CALLBACKS],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(client.registrationDate ? { client_id_issued_at: client.registrationDate } : {}),
    },
    201,
  );
}
