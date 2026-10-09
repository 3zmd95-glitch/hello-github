import { expect, type Page } from "@playwright/test";

/** Change workspace without changing or submitting the retained query. Skill-sheet panels have no workspace tabs. */
export async function openDiscoverSearch(page: Page): Promise<void> {
  if (!/^\/discover\/?$/.test(new URL(page.url()).pathname)) return;
  const button = page.getByTestId("inspiration-search");
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}

async function openDetails(page: Page, testId: string): Promise<void> {
  const details = page.getByTestId(testId);
  if (
    (await details.count()) &&
    (await details.isVisible()) &&
    (await details.getAttribute("open")) === null
  )
    await details.locator(":scope > summary").click();
}

/** Browse opens categories when its local feed is empty; both workspaces otherwise keep them in a disclosure. */
export async function openDiscoverCategories(page: Page): Promise<void> {
  await openDiscoverSearch(page);
  await openDetails(page, "search-categories");
}

export async function openBrowseCategories(page: Page): Promise<void> {
  await page.getByTestId("inspiration-explore").click();
  if (await page.getByTestId("browse-back").isVisible())
    await page.getByTestId("browse-back").click();
  await openDetails(page, "browse-categories");
}

export async function openBrowseFormats(page: Page): Promise<void> {
  await page.getByTestId("inspiration-explore").click();
  if (await page.getByTestId("browse-back").isVisible())
    await page.getByTestId("browse-back").click();
  await openDetails(page, "browse-formats");
}

export async function openDiscoverOptions(page: Page): Promise<void> {
  await openDiscoverSearch(page);
  const toggle = page.getByTestId("search-options-toggle");
  if (await toggle.isVisible()) {
    const details = toggle.locator("xpath=ancestor::details[1]");
    if ((await details.getAttribute("open")) === null) await toggle.click();
  }
}

export async function openDiscoverHistory(page: Page): Promise<void> {
  await openDiscoverSearch(page);
  await openDetails(page, "search-history");
}

/** Discover collapses filters on every viewport; the existing skill-sheet behavior stays unchanged. */
export async function openResearchFilters(page: Page): Promise<void> {
  const toggle = page.getByTestId("filters-toggle");
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(page.getByTestId("filters")).toBeVisible();
}

export async function openBrowseTechniques(page: Page): Promise<void> {
  await page.getByTestId("inspiration-explore").click();
  if (await page.getByTestId("browse-back").isVisible())
    await page.getByTestId("browse-back").click();
  await openDetails(page, "browse-techniques");
}

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

/**
 * Switch the app language. Training keeps the toggle in its top bar; Social keeps it in More (iOS look, round 35).
 * The world is read from `<html data-world>`. The Social path navigates to More and back, so screen-local state
 * (an open tab, a filter, an unsaved field) resets.
 */
export async function switchLang(page: Page, lang: "ar" | "en"): Promise<void> {
  if ((await page.locator("html").getAttribute("data-world")) === "training") {
    await page.getByTestId(`lang-${lang}`).click();
    return;
  }
  await page.locator('a[href="/social/more/"]:visible').first().click();
  await page.getByTestId(`lang-${lang}`).click();
  await page.goBack();
}
