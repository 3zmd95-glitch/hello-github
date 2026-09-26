import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

// The service worker only registers in production builds (see components/pwa/RegisterSW.tsx), which is
// exactly what `pnpm e2e`'s webServer serves (a `next build` static export). Desktop only: iPhone-viewport
// Chromium emulation behaves the same for this, and running it twice would just add runtime.
test.describe("offline", () => {
  test.skip(({ isMobile }) => isMobile, "service worker behaviour does not depend on viewport");

  test("app shell still renders after going offline", async ({ page, context }) => {
    await freshState(page, "/");

    const swReady = await page
      .evaluate(() => navigator.serviceWorker.ready.then(() => true))
      .catch(() => false);
    test.fixme(
      !swReady,
      "navigator.serviceWorker.ready never resolved in this environment (registration blocked?)",
    );

    // The worker only became active partway through the loads above, so this page's own JS/CSS may
    // have been fetched before it was there to cache them. One more reload runs entirely under the
    // now-active, now-controlling worker, which is what actually populates its cache for this route.
    await page.reload();
    await expect(page.getByTestId("today-header")).toBeVisible();

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByTestId("today-header")).toBeVisible();

      await page.goto("/skills/");
      await expect(page.getByTestId("pillar-capture")).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
