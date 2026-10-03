import { expect, test } from "@playwright/test";

// The Meta app's settings link to these three public pages (Live mode needs them), so they must keep loading.
for (const path of ["/privacy/", "/terms/", "/data-deletion/"]) {
  test(`${path} is public`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('section[lang="ar"] h1')).toBeVisible();
    await expect(page.locator('section[lang="en"] h1')).toBeVisible();
  });
}
