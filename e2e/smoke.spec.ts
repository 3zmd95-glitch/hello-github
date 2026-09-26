import { expect, test } from "@playwright/test";

test("home page loads in RTL Arabic", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("dir", "rtl");
  await expect(html).toHaveAttribute("lang", "ar");
});
