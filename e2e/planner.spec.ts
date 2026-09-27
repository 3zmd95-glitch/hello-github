import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

test("the week plan renders within budget, ticks an item, and opens the skill sheet", async ({
  page,
}) => {
  await freshState(page, "/planner/");

  await expect(page.getByTestId("planner-screen")).toBeVisible();
  await expect(page.getByTestId("plan-week")).toBeVisible();

  // At least 3 planned items, total time within the 5 h budget.
  const items = page.getByTestId("plan-item");
  const total = await items.count();
  expect(total).toBeGreaterThanOrEqual(3);
  const budget = page.getByTestId("plan-budget");
  const minutes = Number(await budget.getAttribute("data-minutes"));
  const cap = Number(await budget.getAttribute("data-budget"));
  expect(minutes).toBeGreaterThan(0);
  expect(minutes).toBeLessThanOrEqual(cap);
  await expect(page.getByTestId("plan-progress")).toHaveText(`0/${total}`);

  // Seven days Sat → Fri, exactly one is today.
  await expect(page.getByTestId("plan-day")).toHaveCount(7);
  await expect(page.locator('[data-testid="plan-day"][data-today="true"]')).toHaveCount(1);

  // Tick the first non-combo item: done, XP toast, progress moves.
  const first = page.locator('[data-testid="plan-item"]:not([data-kind="combo"])').first();
  await expect(first).toHaveAttribute("data-done", "false");
  await first.getByTestId("plan-tick").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(first).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("plan-progress")).toHaveText(`1/${total}`);

  // The plan is stable: a reload keeps the same items and the done mark.
  await page.reload();
  await expect(page.getByTestId("plan-item")).toHaveCount(total);
  await expect(page.getByTestId("plan-progress")).toHaveText(`1/${total}`);

  // Open button opens the skill popup for that skill.
  const second = page.getByTestId("plan-item").nth(1);
  const skillId = await second.getAttribute("data-skill");
  await second.getByTestId("plan-open").click();
  const sheet = page.getByTestId("skill-sheet");
  await expect(sheet).toBeVisible();
  expect(skillId).toBeTruthy();
  await page.getByTestId("sheet-close").click();
  await expect(sheet).toBeHidden();

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test("a combo item finishes both produce quests with one clip link", async ({ page }) => {
  await freshState(page, "/planner/");

  const combo = page.locator('[data-testid="plan-item"][data-kind="combo"]');
  await expect(combo).toHaveCount(1);
  await expect(combo).toHaveAttribute("data-quest", "produce");
  const total = await page.getByTestId("plan-item").count();

  await combo.getByTestId("plan-proof").fill("https://example.com/clip");
  await combo.getByTestId("plan-tick").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(combo).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("plan-progress")).toHaveText(`1/${total}`);

  // Both skills now have their produce quest done: the craft one opens with 1/4.
  await combo.getByTestId("plan-open").click();
  await expect(page.getByTestId("skill-sheet")).toBeVisible();
  await expect(page.getByTestId("sheet-progress")).toHaveText("1/4");
});
