import type { OAuthHelpers, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authorize } from "./discover/auth";
import { handle, type Env } from "./scout";
import { runTick, TICK_CRON } from "./social/cron";
import { runScheduled } from "./social/sync";

// Worker entry. Keep this module's exports to the default handler only: workerd treats every named export of
// the main module as an entrypoint and refuses to start on anything else.
//
// Claude connector (round 33, planning/tools/13-discover-search-v2.md): OAuthProvider guards `/mcp` and serves
// `/token`, `/register` and the `.well-known` documents; `/authorize` is our login page; every other route goes to
// `handle()` exactly as before. Without OAUTH_KV or MCP_RESOURCE (local dev without them) only `handle()` runs.
// The provider and the MCP server are imported on the first request that needs them, never at load: the OAuth
// package imports `cloudflare:workers`, and the plain-Node tests import this module (social.test.ts).

type WorkerEnv = Env & {
  OAUTH_KV?: KVNamespace;
  MCP_RESOURCE?: string;
  OAUTH_PROVIDER?: OAuthHelpers;
};

let provider: Promise<OAuthProvider<WorkerEnv>> | undefined;
function oauth(env: WorkerEnv): Promise<OAuthProvider<WorkerEnv>> {
  provider ??= Promise.all([
    import("@cloudflare/workers-oauth-provider"),
    import("./discover/mcp"),
  ]).then(
    ([{ OAuthProvider }, { mcpFetch }]) =>
      new OAuthProvider<WorkerEnv>({
        apiRoute: "/mcp",
        // Must be an object: handing createMcpHandler's function straight in throws at construction.
        apiHandler: { fetch: (req, e, ctx) => mcpFetch(req, e, ctx) },
        defaultHandler: {
          fetch: (req, e, ctx) =>
            new URL(req.url).pathname === "/authorize" ? authorize(req, e) : handle(req, e, ctx),
        },
        authorizeEndpoint: "/authorize",
        tokenEndpoint: "/token",
        clientRegistrationEndpoint: "/register",
        resourceMetadata: { resource: env.MCP_RESOURCE ?? "" },
      }),
  );
  return provider;
}

export default {
  async fetch(req, env, ctx) {
    if (!env.OAUTH_KV || !env.MCP_RESOURCE) return handle(req, env, ctx);
    return (await oauth(env)).fetch(req, env, ctx);
  },
  // Cron (wrangler.jsonc `triggers.crons`): every five minutes the auto-post queue, and the daily social
  // sync on the 06:00–06:30 Riyadh ticks (social/cron.ts). Any other cron string (the four daily triggers
  // of older deployments) still runs the sync alone.
  async scheduled(event, env) {
    const result =
      event.cron === TICK_CRON
        ? await runTick(env, event.scheduledTime)
        : await runScheduled(env, event.cron);
    console.log(JSON.stringify({ cron: event.cron, ...result }));
  },
} satisfies ExportedHandler<WorkerEnv>;
