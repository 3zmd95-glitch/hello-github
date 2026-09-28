import { defineConfig, devices } from "@playwright/test";

// Optional: point at a pre-installed Chromium when the bundled revision is not downloaded
// (e.g. PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium). CI runs `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
// Optional port so several checkouts can run their suites side by side (default 3000).
const port = Number(process.env.E2E_PORT) || 3000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${port}`,
    // Locally there are no retries, so keep the trace of a failed run: a flake then leaves evidence to read.
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    // The pixel animations run in steps(): an element can look still for two frames and then jump, so a click
    // aimed right after a popup opens could land beside its target (11 of 50 tries under load). The app turns
    // animations off for prefers-reduced-motion, which also makes every click land where it was aimed.
    reducedMotion: "reduce",
    launchOptions: { executablePath },
  },
  projects: [
    // iPhone 14 viewport and touch, run on Chromium (WebKit is not installed).
    { name: "phone", use: { ...devices["iPhone 14"], defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `pnpm build && npx serve@latest out -l ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
