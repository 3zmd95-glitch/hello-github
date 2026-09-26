import { defineConfig, devices } from "@playwright/test";

// Optional: point at a pre-installed Chromium when the bundled revision is not downloaded
// (e.g. PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium). CI runs `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    launchOptions: { executablePath },
  },
  projects: [
    // iPhone 14 viewport and touch, run on Chromium (WebKit is not installed).
    { name: "phone", use: { ...devices["iPhone 14"], defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm build && npx serve@latest out -l 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
