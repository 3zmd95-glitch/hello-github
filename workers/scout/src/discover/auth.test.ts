import { describe, expect, it, vi } from "vitest";
import { authorize, isAllowedRedirect, type AuthHelpers } from "./auth";

const URL_ = "https://3z-scout.example.workers.dev/authorize?client_id=c&redirect_uri=x&state=s";
function helpers(redirectUri = "https://claude.ai/api/mcp/auth_callback") {
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
  });

  it("refuses a redirect that is not Claude's", async () => {
    const res = await authorize(new Request(URL_), {
      SCOUT_TOKEN: "t0k",
      OAUTH_PROVIDER: helpers("https://evil.example/cb"),
    });
    expect(res.status).toBe(400);
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
});
