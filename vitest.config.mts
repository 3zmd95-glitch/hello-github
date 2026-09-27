import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
