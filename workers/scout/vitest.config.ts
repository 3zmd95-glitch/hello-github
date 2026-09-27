import { defineConfig } from "vitest/config";

// Plain Node unit tests: the handler is called directly with a fake env and a mocked `fetch`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
