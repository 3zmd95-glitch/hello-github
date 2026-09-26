import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

test("unchecking a gear item locks the skills that need it", async ({ page }) => {
  await freshState(page, "/settings/");

  // Default gear is phone + lights, so lighting-gear skills start unlocked.
  await page.goto("/skills/");
  await page.locator('[data-testid="program-card"][data-program="lighting"]').click();
  await expect(page.getByTestId("gear-lock-chip")).toHaveCount(0);

  // Uncheck "lights" in Settings.
  await page.goto("/settings/");
  await page.getByTestId("gear-lights").locator('input[type="checkbox"]').uncheck();

  // Every skill in the Lighting program now shows the locked chip.
  await page.goto("/skills/");
  await page.locator('[data-testid="program-card"][data-program="lighting"]').click();
  const rows = page.getByTestId("skill-row");
  await expect(rows.first()).toBeVisible();
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  await expect(page.getByTestId("gear-lock-chip")).toHaveCount(rowCount);
});

test("export downloads a valid backup that contains completions", async ({ page }) => {
  await freshState(page, "/");
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");

  await page.goto("/settings/");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const download = await downloadPromise;

  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await fs.readFile(path!, "utf-8");
  const json = JSON.parse(text);

  expect(json.app).toBe("3z-prod");
  expect(Array.isArray(json.state.completions)).toBe(true);
  expect(json.state.completions.length).toBeGreaterThan(0);
  expect(json.state.completions[0]).toHaveProperty("skillId");
  expect(json.state.completions[0]).toHaveProperty("quest");
});

test("reset clears all progress after confirming", async ({ page }) => {
  await freshState(page, "/");
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");

  await page.goto("/settings/");
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();

  await page.goto("/");
  await expect(page.getByTestId("flow-count")).toHaveText("0/3");
});
