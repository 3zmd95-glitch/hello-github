import { handle, type Env } from "./scout";

// Worker entry. Keep this module's exports to the default handler only: workerd treats every named
// export of the main module as an entrypoint and refuses to start on anything else.
export default {
  fetch(req, env, ctx) {
    return handle(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
