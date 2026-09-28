import { handle, type Env } from "./scout";
import { runTick, TICK_CRON } from "./social/cron";
import { runScheduled } from "./social/sync";

// Worker entry. Keep this module's exports to the default handler only: workerd treats every named
// export of the main module as an entrypoint and refuses to start on anything else.
export default {
  fetch(req, env, ctx) {
    return handle(req, env, ctx);
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
} satisfies ExportedHandler<Env>;
