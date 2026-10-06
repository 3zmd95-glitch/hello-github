import { expect, test } from "@playwright/test";
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

// Spec §3.1: --bg per scheme.
const BG = { light: "rgb(242, 243, 246)", dark: "rgb(11, 13, 16)" } as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });
    for (const path of SOCIAL_PATHS) {
      test(`${path} uses the iOS tokens and fits the screen`, async ({ page }) => {
        await freshState(page, path);
        await expect(page.locator("html")).toHaveAttribute("data-world", "social");
        // Routes ship only the splash: wait for the screen so the fit check measures real content.
        await expect(page.locator("main h1").first()).toBeVisible();
        const css = await page.evaluate(() => {
          const s = getComputedStyle(document.body);
          return { font: s.fontFamily, bg: s.backgroundColor };
        });
        expect(css.font).toContain("Vazirmatn");
        expect(css.bg).toBe(BG[scheme]);
        const card = await page.evaluate(() => {
          const el = document.querySelector(".px-card, .ios-card, .ios-list") as HTMLElement | null;
          if (!el) return null;
          const s = getComputedStyle(el);
          return { border: parseFloat(s.borderTopWidth), radius: parseFloat(s.borderRadius) };
        });
        if (card) {
          expect(card.border).toBe(0);
          expect(card.radius).toBeGreaterThanOrEqual(16);
        }
        // Against the page's own width: on the phone (mobile emulation) innerWidth grows to fit any overflow.
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        );
        expect(fits).toBe(true);
      });
    }
  });
}

test("Training keeps the pixel look", async ({ page }) => {
  await freshState(page, "/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  const card = page.locator(".px-card").first();
  await expect(card).toBeVisible();
  const css = await card.evaluate((el) => ({
    font: getComputedStyle(document.body).fontFamily,
    radius: parseFloat(getComputedStyle(el).borderRadius),
    border: parseFloat(getComputedStyle(el).borderTopWidth),
  }));
  expect(css.font).toContain("Baloo Bhaijaan 2");
  expect(css.radius).toBe(2);
  expect(css.border).toBe(3);
});

test("Social shell: glass tab bar with icons, compact title after scrolling", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "tab bar is phone only");
  await freshState(page, "/social/");
  const tabbar = page.getByTestId("tabbar");
  await expect(tabbar).toHaveClass(/glass/);
  await expect(tabbar.locator("svg")).toHaveCount(5);
  await expect(tabbar.locator('a[href="/social/"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("compact-title")).toHaveCSS("opacity", "0");
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.locator("html")).toHaveAttribute("data-compact", "true");
  await expect(page.getByTestId("compact-title")).toHaveText("الاستوديو");
  await expect(page.getByTestId("compact-title")).toHaveCSS("opacity", "1");
});

test("theme-color follows the world and survives client navigation", async ({ page }) => {
  await freshState(page, "/social/");
  const colors = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('meta[name="theme-color"]')].map(
        (m) => `${m.getAttribute("media") ?? "all"} ${m.getAttribute("content")}`,
      ),
    );
  // Social: the page color per scheme (spec §3.1 --bg); Training: the pixel navy of the root layout.
  const social = ["(prefers-color-scheme: light) #f2f3f6", "(prefers-color-scheme: dark) #0b0d10"];
  await expect.poll(colors).toEqual(social);
  await page.locator('a[href="/social/more/"]:visible').first().click();
  await expect(page).toHaveURL(/\/social\/more\/$/);
  await expect.poll(colors).toEqual(social);
  await page.getByTestId("world-training").click();
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await expect.poll(colors).toEqual(["all #0d141d"]);
  await page.getByTestId("world-social").click();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect.poll(colors).toEqual(social);
});
