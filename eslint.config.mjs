import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent worktrees (each has its own .next/out).
    ".claude/**",
    // Playwright's output (an interrupted `pnpm e2e` leaves a report with bundled trace-viewer scripts).
    "playwright-report/**",
    "test-results/**",
    // Wrangler generates bundled dependencies here during local Worker preview/testing.
    "**/.wrangler/**",
  ]),
]);

export default eslintConfig;
