import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareWorkersStub } from "./workers/scout/vitest.cloudflare-stub.mjs";

export default defineConfig({
  // The Worker tests below import the InboxStore Durable Object's module, which imports `cloudflare:workers`.
  plugins: [cloudflareWorkersStub],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // workers/scout/**/*.test.ts is included on purpose: `pnpm test` runs the Worker tests too (once).
    exclude: ["**/node_modules/**", ".next/**", "out/**", "e2e/**", "**/.wrangler/**", ".claude/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**", "store/**", "data/**"],
    },
  },
});
