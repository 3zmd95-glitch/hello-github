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
  "/social/replies/",
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
  // 🔎 Discover is a Training tab: Social reaches it from More and the sidebar, never from its tab bar.
  await expect(tabbar.locator('a[href="/discover/"]')).toHaveCount(0);

  // iOS look: rounded cards and Vazirmatn.
  expect(await cardRadius(page)).toBeGreaterThanOrEqual(10);
  expect(await bodyFont(page)).toContain("Vazirmatn");
});

test("switching back to Training returns home with the pixel tokens", async ({ page }) => {
  await freshState(page, "/social/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  expect(await bodyFont(page)).toContain("Vazirmatn");

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
  for (const id of [
    "more-website",
    "more-business",
    "more-automations",
    "more-replies",
    "more-discover",
    "more-settings",
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("more-discover")).toHaveAttribute("href", "/discover/");
  await expect(page.getByTestId("more-training")).toHaveAttribute("href", "/");
  await page.getByTestId("more-website").click();
  await expect(page.getByTestId("website-screen")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
});

test("Social More opens 🔎 Discover in the Training world, and the switch returns to Social's More", async ({
  page,
  isMobile,
}) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();

  // More is a phone tab; on desktop the same page opens from the sidebar.
  const nav = page.getByTestId(isMobile ? "tabbar" : "sidenav");
  await nav.locator('a[href="/social/more/"]').click();
  await expect(page).toHaveURL(/\/social\/more\/$/);
  await page.getByTestId("more-discover").click();

  // Discover is a Training route and the world comes from the URL: the Training shell, Discover active.
  await expect(page).toHaveURL(/\/discover\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await expect(page.getByTestId("world-training")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("discover-topic")).toBeVisible();
  await expect(nav.locator('a[href="/discover/"]')).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('a[href="/social/more/"]')).toHaveCount(0);

  // Discover was not remembered as a Social route: the switch returns to the last real one (More).
  await page.getByTestId("world-social").click();
  await expect(page).toHaveURL(/\/social\/more\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("more-discover")).toBeVisible();
});

test("desktop: the Social sidebar opens 🔎 Discover in the Training world, and the switch returns to the last Social route", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the sidebar is desktop only");
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();

  const sidenav = page.getByTestId("sidenav");
  const discover = sidenav.locator('a[href="/discover/"]');
  await expect(discover).toHaveCount(1);
  await expect(discover).toBeVisible();
  // Inside Social the shortcut is never the active item: Growth is, and only Growth.
  await expect(discover).not.toHaveAttribute("aria-current", "page");
  await expect(sidenav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(sidenav.locator('a[href="/social/growth/"]')).toHaveAttribute(
    "aria-current",
    "page",
  );

  await discover.click();
  await expect(page).toHaveURL(/\/discover\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await expect(page.getByTestId("world-training")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("discover-topic")).toBeVisible();
  // The sidebar is the Training one now, with Discover as its active item.
  await expect(discover).toHaveAttribute("aria-current", "page");
  await expect(sidenav.locator('a[href="/skills/"]')).toHaveCount(1);
  await expect(sidenav.locator('a[href="/social/growth/"]')).toHaveCount(0);

  // Discover was not remembered as a Social route: the switch returns to Growth.
  await page.getByTestId("world-social").click();
  await expect(page).toHaveURL(/\/social\/growth\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
});

test("RTL / LTR toggle works inside Social", async ({ page }) => {
  await freshState(page, "/social/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");

  // Social keeps the language control in More's quick settings (iOS look, round 35): use that one.
  await page.locator('a[href="/social/more/"]:visible').first().click();
  await expect(page).toHaveURL(/\/social\/more\/$/);
  const more = page.locator("main");
  await more.getByTestId("lang-en").click();
  await expect(html).toHaveAttribute("dir", "ltr");
  await expect(html).toHaveAttribute("lang", "en");
  await expect(html).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("world-social")).toHaveAccessibleName(/Social/);
  await expect(more.getByTestId("lang-en")).toHaveAttribute("aria-checked", "true");

  await more.getByTestId("lang-ar").click();
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(more.getByTestId("lang-ar")).toHaveAttribute("aria-checked", "true");
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
