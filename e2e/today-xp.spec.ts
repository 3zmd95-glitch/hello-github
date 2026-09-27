import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

test("Today shows the wallet, chest, boss and season; focus runs and stops; a quest pays gems and hits the boss", async ({
  page,
}) => {
  await freshState(page, "/");

  // Fresh account: empty wallet, empty chest, boss at full HP, season on day >= 1, no drills due.
  await expect(page.getByTestId("wallet-gems")).toHaveText("0");
  await expect(page.getByTestId("chest-progress")).toHaveText("0/5");
  await expect(page.getByTestId("chest-box")).toHaveAttribute("data-ready", "false");

  const bossHp = page.getByTestId("boss-hp");
  await expect(page.getByTestId("boss-card")).toBeVisible();
  const hp = Number(await bossHp.getAttribute("data-hp"));
  const fullLeft = Number(await bossHp.getAttribute("data-left"));
  expect(hp).toBeGreaterThan(0);
  expect(fullLeft).toBe(hp);

  const season = page.getByTestId("season-card");
  await expect(season).toBeVisible();
  expect(Number(await season.getAttribute("data-day"))).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("season-next")).toBeVisible();

  await expect(page.getByTestId("drills-card")).toHaveCount(0);

  // Focus potion: start 25 min -> live mm:ss countdown and the +25 % chip; it survives a reload; stop -> idle.
  const focus = page.getByTestId("focus-card");
  await expect(focus).toHaveAttribute("data-state", "idle");
  await page.getByTestId("focus-start-25").click();
  await expect(focus).toHaveAttribute("data-state", "running");
  const timer = page.getByTestId("focus-timer");
  await expect(timer).toBeVisible();
  await expect(timer).toHaveText(/^2[45]:\d\d$/);
  await expect(page.getByTestId("focus-chip")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("focus-timer")).toHaveText(/^2[45]:\d\d$/);

  await page.getByTestId("focus-stop").click();
  await expect(focus).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("focus-timer")).toHaveCount(0);
  await expect(page.getByTestId("focus-start-25")).toBeVisible();
  await expect(page.getByTestId("focus-start-60")).toBeVisible();

  // Complete the main quest: gems arrive, the chest fills 1/5 and the boss loses HP.
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("chest-progress")).toHaveText("1/5");
  await expect
    .poll(async () => Number(await page.getByTestId("wallet-gems").textContent()))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await bossHp.getAttribute("data-left")))
    .toBeLessThan(fullLeft);

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});
