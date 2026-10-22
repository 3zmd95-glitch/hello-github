import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Node unit tests: the handler is called directly with a fake env and a mocked `fetch`.
// DT-7B-2: `@/…` resolves to the repo root, as in the Worker tsconfig `paths` (the shared draft builders).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../..", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
