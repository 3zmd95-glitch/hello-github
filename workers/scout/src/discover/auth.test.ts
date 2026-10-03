import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  authorize,
  isAllowedRedirect,
  isOAuthPath,
  register,
  type AuthHelpers,
  type RegisterDeps,
} from "./auth";

const URL_ = "https://3z-scout.example.workers.dev/authorize?client_id=c&redirect_uri=x&state=s";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const WARNING =
  "كمّل بس إذا انت للتو ضغطت Connect في Claude حقّك · Only continue if you just pressed Connect in your own Claude";
function helpers(redirectUri = CLAUDE) {
  return {
    parseAuthRequest: vi.fn(async () => ({ clientId: "c", redirectUri, scope: [], state: "s" })),
    completeAuthorization: vi.fn(async () => ({
      redirectTo: "https://claude.ai/api/mcp/auth_callback?code=abc&state=s",
    })),
  } satisfies AuthHelpers;
}
const form = (token: string) =>
  new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });

describe("isAllowedRedirect", () => {
  it("allows Claude's callbacks only", () => {
    expect(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirect("https://evil.example/cb")).toBe(false);
    expect(isAllowedRedirect("http://localhost:1234/callback")).toBe(false);
  });
});

describe("isOAuthPath", () => {
  it("names the connector's paths and nothing the dashboard uses", () => {
    for (const p of [
      "/mcp",
      "/mcp/x",
      "/authorize",
      "/token",
      "/register",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      expect(isOAuthPath(p), p).toBe(true);
    }
    for (const p of [
      "/",
      "/health",
      "/search",
      "/oembed",
      "/discover",
      "/discover/usage",
      "/trends",
      "/trends/run",
      "/social/status",
      "/oauth/tiktok/callback",
      "/go/a/1",
      "/mcpx",
      "/authorize/x",
      "/.well-known/security.txt",
    ]) {
      expect(isOAuthPath(p), p).toBe(false);
    }
  });
});

describe("wrangler.jsonc", () => {
  it("MCP_RESOURCE is https://<lowercase host>/mcp (the OAuth provider refuses any other form)", () => {
    const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const json = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/,(\s*[}\]])/g, "$1");
    const value = (JSON.parse(json) as { vars: Record<string, string> }).vars.MCP_RESOURCE;
    expect(value).toBe(`https://${new URL(value).hostname}/mcp`);
  });
});

describe("authorize", () => {
  it("shows the bilingual form on GET, never framed", async () => {
    const res = await authorize(new Request(URL_), {
      SCOUT_TOKEN: "t0k",
      OAUTH_PROVIDER: helpers(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    // Chrome applies form-action to the redirect after the POST too: Claude's hosts must be in it.
    expect(res.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://claude.ai https://claude.com",
    );
    const html = await res.text();
    expect(html).toContain('<form method="post"');
    expect(html).toContain("Scout");
    expect(html).toContain(WARNING);
  });

  it("refuses a redirect that is not Claude's", async () => {
    const res = await authorize(new Request(URL_), {
      SCOUT_TOKEN: "t0k",
      OAUTH_PROVIDER: helpers("https://evil.example/cb"),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a non-Claude redirect even with the right token, completing nothing", async () => {
    const h = helpers("https://evil.example/cb");
    expect((await authorize(form("t0k"), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: h })).status).toBe(
      400,
    );
    expect(h.completeAuthorization).not.toHaveBeenCalled();
  });

  it("refuses a wrong token and lets the right one through", async () => {
    const h = helpers();
    expect((await authorize(form("nope"), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: h })).status).toBe(
      403,
    );
    expect(h.completeAuthorization).not.toHaveBeenCalled();
    const ok = await authorize(form(" t0k "), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: h });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toContain("code=abc");
    expect(h.completeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner", props: { owner: true } }),
    );
  });

  it("refuses everything when the Worker has no token", async () => {
    expect((await authorize(form(""), { OAUTH_PROVIDER: helpers() })).status).toBe(403);
  });

  it("answers 400 to a request it can't parse, 405 to other methods, 500 without the provider", async () => {
    const h = helpers();
    h.parseAuthRequest.mockRejectedValueOnce(new Error("Invalid client_id"));
    expect(
      (await authorize(new Request(URL_), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: h })).status,
    ).toBe(400);
    const put = await authorize(new Request(URL_, { method: "PUT" }), {
      SCOUT_TOKEN: "t0k",
      OAUTH_PROVIDER: helpers(),
    });
    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET, POST");
    expect((await authorize(new Request(URL_), { SCOUT_TOKEN: "t0k" })).status).toBe(500);
  });

  it("answers the bilingual page (503) when the grant can't be stored", async () => {
    const h = helpers();
    h.completeAuthorization.mockRejectedValueOnce(new Error("KV put() limit exceeded for the day"));
    const res = await authorize(form("t0k"), { SCOUT_TOKEN: "t0k", OAUTH_PROVIDER: h });
    expect(res.status).toBe(503);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const html = await res.text();
    expect(html).toContain("الطلب ناقص · Bad request");
    expect(html).not.toContain("limit exceeded");
  });
});

const registration = (body: unknown) =>
  new Request("https://3z-scout.example.workers.dev/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** The fixed OAUTH_KV key and the provider's client records, in memory, behind the four injected calls. */
function registry() {
  const clients = new Map<string, { clientId: string; registrationDate: number }>();
  let stored: string | null = null;
  let n = 0;
  const deps = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (id: string) => {
      stored = id;
    }),
    lookup: vi.fn(async (id: string) => clients.get(id) ?? null),
    create: vi.fn(async () => {
      const client = { clientId: `client-${++n}`, registrationDate: 1_790_000_000 };
      clients.set(client.clientId, client);
      return client;
    }),
  } satisfies RegisterDeps;
  return { clients, deps };
}

describe("register", () => {
  it("refuses anything but Claude's callbacks, touching nothing", async () => {
    const { deps } = registry();
    for (const body of [
      { redirect_uris: ["https://evil.example/cb"] },
      { redirect_uris: [CLAUDE, "https://evil.example/cb"] },
      { redirect_uris: [] },
      {},
      "not json",
    ]) {
      const res = await register(registration(body), deps);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_redirect_uri" });
    }
    for (const call of Object.values(deps)) expect(call).not.toHaveBeenCalled();
  });

  it("creates the shared public client once; later registrations only read", async () => {
    const { deps } = registry();
    const first = await register(registration({ redirect_uris: [CLAUDE] }), deps);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      client_id: "client-1",
      client_name: "Claude",
      redirect_uris: [
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.com/api/mcp/auth_callback",
      ],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: 1_790_000_000,
    });
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledTimes(1);
    // A confidential method asked for still gets the public client (a server may override metadata).
    const second = await register(
      registration({
        redirect_uris: ["https://claude.com/api/mcp/auth_callback"],
        token_endpoint_auth_method: "client_secret_basic",
      }),
      deps,
    );
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({
      client_id: "client-1",
      token_endpoint_auth_method: "none",
    });
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledTimes(1);
  });

  it("re-creates the client when the stored one is gone", async () => {
    const { clients, deps } = registry();
    await register(registration({ redirect_uris: [CLAUDE] }), deps);
    clients.clear();
    const res = await register(registration({ redirect_uris: [CLAUDE] }), deps);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ client_id: "client-2" });
    expect(deps.create).toHaveBeenCalledTimes(2);
    expect(deps.write).toHaveBeenCalledTimes(2);
  });
});
