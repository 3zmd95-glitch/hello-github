import { defineConfig } from "vitest/config";
import { cloudflareWorkersStub } from "./vitest.cloudflare-stub.mjs";

// Plain Node unit tests: the handler is called directly with a fake env and a mocked `fetch`.
export default defineConfig({
  plugins: [cloudflareWorkersStub],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
