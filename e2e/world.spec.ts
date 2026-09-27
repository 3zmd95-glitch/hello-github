import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

const SOCIAL_PATHS = [
  "/social/",
  "/social/calendar/",
  "/social/growth/",
  "/social/ideas/",
  "/social/website/",
  "/social/business/",
  "/social/automations/",
  "/social/more/",
];

/** Computed border radius (px) of the first `.px-card` on the page. */
async function cardRadius(page: Page): Promise<number> {
  const card = page.locator(".px-card").first();
  await expect(card).toBeVisible();
  return card.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius));
}

async function bodyFont(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).fontFamily);
}

test("the world switch moves from 🎮 Training to 📱 Social and restyles the shell", async ({
  page,
}) => {
  await freshState(page, "/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-world", "training");
  await expect(page.getByTestId("world-training")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("world-social")).toHaveAttribute("aria-pressed", "false");
  expect(await cardRadius(page)).toBeLessThanOrEqual(3);

  await page.getByTestId("world-social").click();
  await expect(page).toHaveURL(/\/social\/$/);
  await expect(html).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("world-social")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("studio-screen")).toBeVisible();

  // The phone tab bar shows the Social tabs, not the Training ones.
  const tabbar = page.getByTestId("tabbar");
  await expect(tabbar.locator('a[href="/social/"]')).toHaveCount(1);
  await expect(tabbar.locator('a[href="/social/calendar/"]')).toHaveCount(1);
  await expect(tabbar.locator('a[href="/social/growth/"]')).toHaveCount(1);
  await expect(tabbar.locator('a[href="/social/ideas/"]')).toHaveCount(1);
  await expect(tabbar.locator('a[href="/social/more/"]')).toHaveCount(1);
  await expect(tabbar.locator('a[href="/skills/"]')).toHaveCount(0);
  await expect(tabbar.locator('a[href="/"]')).toHaveCount(0);

  // Cinematic look: rounded cards and IBM Plex Sans Arabic.
  expect(await cardRadius(page)).toBeGreaterThanOrEqual(10);
  expect(await bodyFont(page)).toContain("IBM Plex Sans Arabic");
});

test("switching back to Training returns home with the pixel tokens", async ({ page }) => {
  await freshState(page, "/social/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  expect(await bodyFont(page)).toContain("IBM Plex Sans Arabic");

  await page.getByTestId("world-training").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).not.toHaveURL(/social/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await expect(page.getByTestId("world-training")).toHaveAttribute("aria-pressed", "true");
  expect(await cardRadius(page)).toBeLessThanOrEqual(3);
  expect(await bodyFont(page)).toContain("Baloo Bhaijaan 2");
  await expect(page.getByTestId("tabbar").locator('a[href="/skills/"]')).toHaveCount(1);
});

test("Social remembers the last visited route across a switch", async ({ page }) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();

  await page.getByTestId("world-training").click();
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");

  await page.getByTestId("world-social").click();
  await expect(page).toHaveURL(/\/social\/growth\/$/);
  await expect(page.getByTestId("growth-screen")).toBeVisible();
});

test("a nested Social route highlights its own tab, not Studio", async ({ page }) => {
  await freshState(page, "/social/calendar/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("calendar-screen")).toBeVisible();

  for (const nav of [page.getByTestId("tabbar"), page.getByTestId("sidenav")]) {
    await expect(nav.locator('a[href="/social/calendar/"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.locator('a[href="/social/"]')).not.toHaveAttribute("aria-current", "page");
  }
});

test("Social More lists the rest of the world and the way back to Training", async ({ page }) => {
  await freshState(page, "/social/more/");
  for (const id of ["more-website", "more-business", "more-automations", "more-settings"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("more-training")).toHaveAttribute("href", "/");
  await page.getByTestId("more-website").click();
  await expect(page.getByTestId("website-screen")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
});

test("RTL / LTR toggle works inside Social", async ({ page }) => {
  await freshState(page, "/social/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");

  await page.getByTestId("lang-en").click();
  await expect(html).toHaveAttribute("dir", "ltr");
  await expect(html).toHaveAttribute("lang", "en");
  await expect(html).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("world-social")).toContainText("Social");

  await page.getByTestId("lang-ar").click();
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");
});

for (const path of SOCIAL_PATHS) {
  test(`no horizontal scroll on ${path}`, async ({ page }) => {
    await freshState(page, path);
    await expect(page.locator("html")).toHaveAttribute("data-world", "social");
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
  });
}
