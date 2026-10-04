// The Claude connector end to end, the way Claude's custom connector does it: register a client (twice: every
// registration gets the same shared client; a non-Claude redirect is refused), log in on /authorize with the Scout
// token, swap the code for a token (PKCE S256), then MCP initialize, tools/list and a get_picks call. Usage (the
// token never goes on the command line):
//   SCOUT_TOKEN=… node workers/scout/scripts/mcp-smoke.mjs http://localhost:8787
// Local only: a login replaces the owner's earlier grant, so against the deployed Worker it signs Claude out.
const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const token = process.env.SCOUT_TOKEN;
if (!token) throw new Error("Set SCOUT_TOKEN in the environment");
const redirect = "https://claude.ai/api/mcp/auth_callback";
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const check = (ok, what) => {
  if (!ok) throw new Error(`FAIL: ${what}`);
  console.log(`ok  ${what}`);
};

const anon = await fetch(`${base}/mcp`, { method: "POST" });
check(anon.status === 401, `unauthenticated /mcp answers 401 (${anon.status})`);

const register = (redirectUris) =>
  fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "3z smoke test",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
const reg = await (await register([redirect])).json();
check(typeof reg.client_id === "string", "client registered");
const again = await (await register([redirect])).json();
check(again.client_id === reg.client_id, "a second registration gets the same shared client");
const evil = await register(["https://evil.example/cb"]);
check(evil.status === 400, `a non-Claude redirect is refused at registration (${evil.status})`);

const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
const authUrl = `${base}/authorize?${new URLSearchParams({
  response_type: "code",
  client_id: reg.client_id,
  redirect_uri: redirect,
  state: "smoke",
  code_challenge: challenge,
  code_challenge_method: "S256",
})}`;
check((await fetch(authUrl)).status === 200, "login page shows");
const wrong = await fetch(authUrl, {
  method: "POST",
  body: new URLSearchParams({ token: "wrong" }),
  redirect: "manual",
});
check(wrong.status === 403, "wrong token refused");
const login = await fetch(authUrl, {
  method: "POST",
  body: new URLSearchParams({ token }),
  redirect: "manual",
});
const location = login.headers.get("location") ?? "";
check(
  login.status === 302 && location.startsWith(redirect),
  "right token redirects to Claude with a code",
);
const code = new URL(location).searchParams.get("code");

const tok = await (
  await fetch(`${base}/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: reg.client_id,
      code_verifier: verifier,
    }),
  })
).json();
check(typeof tok.access_token === "string", "access token issued");

let id = 0;
async function rpc(method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await res.text();
  const data = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
  return { status: res.status, body: JSON.parse(data || text) };
}

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "1" },
});
check(init.status === 200 && init.body.result, "MCP initialize");
const list = await rpc("tools/list", {});
const names = (list.body.result?.tools ?? []).map((t) => t.name).sort();
check(
  JSON.stringify(names) ===
    JSON.stringify(["get_picks", "get_trends", "save_picks", "search_videos"]),
  `tools: ${names.join(", ")}`,
);
const picks = await rpc("tools/call", { name: "get_picks", arguments: {} });
check(Array.isArray(JSON.parse(picks.body.result.content[0].text).picks), "get_picks answers");
console.log("connector smoke test passed");
