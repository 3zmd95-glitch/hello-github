import type { Page } from "@playwright/test";

/**
 * Navigate to a fresh instance of the app: go to the path, clear any saved progress, then reload so the
 * store hydrates from an empty localStorage. Every spec starts from this so tests never depend on order.
 */
export async function freshState(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

/**
 * Celebrations (toasts and big popups) are queued and shown one at a time with their own timers.
 * This drains the queue by waiting for whichever shows up next (small toast or big celebration),
 * dismissing it (tap for big ones, wait out the small ones), until every kind in `want` has been seen
 * or `maxSteps` queue items have been drained.
 */
export async function drainCelebrations(
  page: Page,
  want: readonly string[],
  maxSteps = 12,
): Promise<Set<string>> {
  const seen = new Set<string>();
  const celebration = page.getByTestId("celebration");
  const toast = page.getByTestId("toast");

  for (let i = 0; i < maxSteps && !want.every((k) => seen.has(k)); i++) {
    const which = await Promise.race([
      celebration
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => "big" as const)
        .catch(() => null),
      toast
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => "small" as const)
        .catch(() => null),
    ]);
    if (which === "big") {
      // Grab a handle to THIS specific popup: back-to-back big celebrations (e.g. level-up then
      // mastery) can replace one another with no gap, so the generic locator never goes "hidden" -
      // only this element's own handle reliably tells us it (not some later one) is gone.
      const handle = await celebration.elementHandle();
      if (!handle) continue;
      const kind = await handle.getAttribute("data-kind");
      if (kind) seen.add(kind);
      await handle.click({ force: true }).catch(() => {});
      await handle.waitForElementState("hidden", { timeout: 5000 }).catch(() => {});
    } else if (which === "small") {
      await toast.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    } else {
      break;
    }
  }
  return seen;
}

/** Switch the app language. Training keeps the toggle in its top bar; Social keeps it in More (iOS look, round 35). */
export async function switchLang(page: Page, lang: "ar" | "en"): Promise<void> {
  const direct = page.getByTestId(`lang-${lang}`);
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.locator('a[href="/social/more/"]:visible').first().click();
  await page.getByTestId(`lang-${lang}`).click();
  await page.goBack();
}
