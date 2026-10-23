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
  "/social/inbox/",
  "/social/more/",
  "/social/settings/",
];

/** Computed border radius (px) of the first `.px-card`, or iOS `Card` (the Studio has only those). */
async function cardRadius(page: Page): Promise<number> {
  const card = page.locator(".px-card, .ios-card").first();
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
  // 🔎 Discover is a Training tab: Social has no link to it (tools/20).
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
    "more-settings",
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("more-discover")).toHaveCount(0);
  await expect(page.getByTestId("more-settings")).toHaveAttribute("href", "/social/settings/");
  await expect(page.getByTestId("more-training")).toHaveAttribute("href", "/");
  await page.getByTestId("more-website").click();
  await expect(page.getByTestId("website-screen")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
});

test("Social stays Social: Settings opens /social/settings in the Social look, and nothing links to Training routes", async ({
  page,
  isMobile,
}) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
  const nav = page.getByTestId(isMobile ? "tabbar" : "sidenav");
  for (const href of ["/discover/", "/settings/"]) {
    await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(0);
  }
  // No Social page links to a Training route, in its menu or in its content.
  for (const path of SOCIAL_PATHS) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator('a[href^="/discover"], a[href^="/settings"]')).toHaveCount(0);
  }
  await page.goto("/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
  if (isMobile) {
    await nav.locator('a[href="/social/more/"]').click();
    await expect(page.getByTestId("more-discover")).toHaveCount(0);
    await expect(page.locator('main a[href="/discover/"], main a[href="/settings/"]')).toHaveCount(0);
    await page.getByTestId("more-settings").click();
  } else {
    await nav.locator('a[href="/social/settings/"]').click();
  }
  await expect(page).toHaveURL(/\/social\/settings\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect(page.getByTestId("social-settings")).toBeVisible();
  await expect(page.getByTestId("world-social")).toHaveAttribute("aria-pressed", "true");
  // Social's cards only: the Worker rows and the accounts card, no YouTube key, gear or avatar.
  await expect(page.locator("#api-keys")).toHaveCount(1);
  await expect(page.locator("#accounts")).toHaveCount(1);
  await expect(page.getByTestId("apikey-scoutUrl")).toBeVisible();
  await expect(page.getByTestId("apikey-youtube")).toHaveCount(0);
  await expect(page.getByTestId("gear-list")).toHaveCount(0);
  await expect(page.getByTestId("export")).toBeVisible();
  await expect(page.locator("main").getByTestId("lang-en")).toBeVisible();
  await expect(page.locator("main").getByTestId("appearance-light")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  if (!isMobile) {
    await expect(nav.locator('a[href="/social/settings/"]')).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  }

  // The gear in the top bar goes to the same page, and the world switch remembers it as a Social route.
  await page.goto("/social/");
  await page.getByTestId("social-top-settings").click();
  await expect(page).toHaveURL(/\/social\/settings\/$/);
  await page.getByTestId("world-training").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await page.getByTestId("world-social").click();
  await expect(page).toHaveURL(/\/social\/settings\/$/);
  await expect(page.getByTestId("social-settings")).toBeVisible();
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
  await expect(page.getByTestId("world-social")).toHaveAccessibleName("Social");
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
    // The routes ship only the splash: measure the screen, against the page's own width (on the phone, mobile
    // emulation grows innerWidth to fit any overflow).
    await expect(page.locator("main h1").first()).toBeVisible();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(fits).toBe(true);
  });
}
