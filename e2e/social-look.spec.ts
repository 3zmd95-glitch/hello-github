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
