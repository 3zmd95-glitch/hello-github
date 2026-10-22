import { defineConfig } from "vitest/config";

// Plain Node unit tests: the handler is called directly with a fake env and a mocked `fetch`.
// `cloudflare:workers` exists only inside workerd, yet the cron reaches the InboxStore Durable Object's module
// (inboxReader.ts -> inboxStore.ts), so the tests that import the cron get an empty base class instead.
const STUB = "\0cloudflare-workers-stub";
export default defineConfig({
  plugins: [
    {
      name: "cloudflare-workers-stub",
      enforce: "pre",
      resolveId: (id) => (id === "cloudflare:workers" ? STUB : null),
      load: (id) => (id === STUB ? "export class DurableObject {}" : null),
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
