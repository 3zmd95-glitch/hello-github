import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

const PATHS = [
  "/",
  "/skills/",
  "/map/",
  "/notes/",
  "/planner/",
  "/review/",
  "/rewards/",
  "/discover/",
  "/settings/",
  "/more/",
];

for (const path of PATHS) {
  test(`no horizontal scroll on ${path}`, async ({ page }) => {
    await freshState(page, path);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
  });
}

test("Arabic RTL by default, EN toggle in the top bar switches dir/lang", async ({ page }) => {
  await freshState(page, "/");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");

  await page.getByTestId("lang-en").click();
  await expect(html).toHaveAttribute("dir", "ltr");
  await expect(html).toHaveAttribute("lang", "en");

  await page.getByTestId("lang-ar").click();
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");
});
