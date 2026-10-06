import type {
  OAuthHelpers,
  OAuthProvider,
  OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import {
  authorize,
  CLAUDE_CALLBACKS,
  CLIENT_NAME,
  isOAuthPath,
  register,
  type CreatedClient,
} from "./discover/auth";
import { handle, type Env } from "./scout";
import { runTick, TICK_CRON } from "./social/cron";
import { runScheduled } from "./social/sync";

// Worker entry. Keep this module's exports to the default handler only: workerd treats every named export of
// the main module as an entrypoint and refuses to start on anything else.
//
// Claude connector (round 33, planning/tools/13-discover-search-v2.md): only the connector's own paths
// (`isOAuthPath`: /mcp, /authorize, /token, /register, /.well-known/oauth-*) go through OAuthProvider, and only with
// OAUTH_KV and MCP_RESOURCE set. Every other request goes straight to `handle()` exactly as before and never loads
// the provider or the Agents and MCP SDKs: the Free plan allows 10 ms of CPU a request, and a provider failure
// can't take the dashboard routes down. `/authorize` is our login page, and POST /register is answered here without
// a KV write (`register` in discover/auth.ts). The provider and mcp.ts are imported lazily: the OAuth package
// imports `cloudflare:workers`, and the plain-Node tests import this module (social.test.ts).

type WorkerEnv = Env & {
  OAUTH_KV?: KVNamespace;
  MCP_RESOURCE?: string;
  OAUTH_PROVIDER?: OAuthHelpers;
};

/** The OAUTH_KV key holding the id of the one client every registration gets. */
const CLIENT_KEY = "mcp:claude-client";
/** Claude stays logged in until it goes this long without using the connector (seconds). */
const LOGIN_IDLE_S = 90 * 86_400;
/** The client this isolate created and when: answered while KV still caches the miss (`register`). */
let created: CreatedClient | undefined;

const options = (env: WorkerEnv): OAuthProviderOptions<WorkerEnv> => ({
  apiRoute: "/mcp",
  // An object, not createMcpHandler's function (that throws at construction). mcp.ts, with the Agents and MCP SDKs,
  // loads on the first /mcp call that carries a valid token.
  apiHandler: {
    fetch: async (req, e, ctx) => (await import("./discover/mcp")).mcpFetch(req, e, ctx),
  },
  defaultHandler: {
    fetch: (req, e, ctx) =>
      new URL(req.url).pathname === "/authorize" ? authorize(req, e) : handle(req, e, ctx),
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // Renewed on use: a new login lasts 90 days, and every refresh moves its end to 90 days later (the provider's
  // default is a fixed 30 days from the login).
  refreshTokenTTL: LOGIN_IDLE_S,
  refreshTokenIdleTTL: LOGIN_IDLE_S,
  resourceMetadata: { resource: env.MCP_RESOURCE ?? "" },
});

let provider: OAuthProvider<WorkerEnv> | undefined;

export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    if (!env.OAUTH_KV || !env.MCP_RESOURCE || !isOAuthPath(pathname)) return handle(req, env, ctx);
    const kv = env.OAUTH_KV;
    const { OAuthProvider, getOAuthApi } = await import("@cloudflare/workers-oauth-provider");
    if (req.method === "POST" && pathname === "/register") {
      const api = getOAuthApi(options(env), env);
      return register(req, {
        read: () => kv.get(CLIENT_KEY),
        write: (id) => kv.put(CLIENT_KEY, id),
        lookup: (id) => api.lookupClient(id),
        // createClient stores the record without a TTL (DCR clients get 90 days), so it stays until deleted.
        create: () =>
          api.createClient({
            clientName: CLIENT_NAME,
            redirectUris: [...CLAUDE_CALLBACKS],
            tokenEndpointAuthMethod: "none",
            grantTypes: ["authorization_code", "refresh_token"],
            responseTypes: ["code"],
          }),
        now: Date.now,
        memo: {
          get: () => created,
          set: (c) => {
            created = c;
          },
        },
      });
    }
    provider ??= new OAuthProvider<WorkerEnv>(options(env));
    return provider.fetch(req, env, ctx);
  },
  // Cron (wrangler.jsonc `triggers.crons`): every minute the auto replies; on the five-minute grid the
  // auto-post queue, the daily social sync on the 06:00–06:30 Riyadh ticks, the Trend Radar slots, the daily
  // trending effects slot at 05:35 UTC and the four Discover category slots at 05:40–05:55 UTC (social/cron.ts). Any
  // other cron string (the four daily triggers of older deployments) still runs the sync alone.
  async scheduled(event, env) {
    const result =
      event.cron === TICK_CRON
        ? await runTick(env, event.scheduledTime)
        : await runScheduled(env, event.cron);
    console.log(JSON.stringify({ cron: event.cron, ...result }));
  },
} satisfies ExportedHandler<WorkerEnv>;
