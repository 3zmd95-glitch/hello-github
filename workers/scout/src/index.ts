import { handle, type Env } from "./scout";
import { runScheduled } from "./social/sync";

// Worker entry. Keep this module's exports to the default handler only: workerd treats every named
// export of the main module as an entrypoint and refuses to start on anything else.
export default {
  fetch(req, env, ctx) {
    return handle(req, env, ctx);
  },
  // Cron (wrangler.jsonc `triggers.crons`): the daily social sync, one platform per trigger.
  async scheduled(event, env) {
    const result = await runScheduled(env, event.cron);
    console.log(JSON.stringify({ cron: event.cron, ...result }));
  },
} satisfies ExportedHandler<Env>;
