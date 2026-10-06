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
        const css = await page.evaluate(() => {
          const s = getComputedStyle(document.body);
          return { font: s.fontFamily, bg: s.backgroundColor };
        });
        expect(css.font).toContain("Vazirmatn");
        expect(css.bg).toBe(BG[scheme]);
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        );
        expect(fits).toBe(true);
      });
    }
  });
}

test("Training keeps the pixel look", async ({ page }) => {
  await freshState(page, "/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  const css = await page.evaluate(() => {
    const card = document.querySelector(".px-card") as HTMLElement;
    return {
      font: getComputedStyle(document.body).fontFamily,
      radius: parseFloat(getComputedStyle(card).borderRadius),
      border: parseFloat(getComputedStyle(card).borderTopWidth),
    };
  });
  expect(css.font).toContain("Baloo Bhaijaan 2");
  expect(css.radius).toBe(2);
  expect(css.border).toBe(3);
});
