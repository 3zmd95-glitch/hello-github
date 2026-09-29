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

test("a custom edit genre can be added, survives a reload and can be removed", async ({ page }) => {
  await freshState(page, "/settings/");

  // The built-in genres are read-only chips; the owner has none of their own yet.
  const card = page.locator("#genres");
  await expect(card.getByTestId("genre-builtin")).toHaveCount(12);
  await expect(card.locator('[data-testid="genre-builtin"][data-genre="cars"]')).toBeVisible();
  await expect(card.getByTestId("genre-remove")).toHaveCount(0);

  // Empty fields keep the button off; both are needed.
  const add = page.getByTestId("genre-add");
  await expect(add).toBeDisabled();
  await page.getByTestId("genre-add-name").fill("Drift");
  await expect(add).toBeDisabled();
  await page.getByTestId("genre-add-query").fill("drift edit");
  await expect(add).toBeEnabled();
  await add.click();

  const chip = page.getByTestId("settings-genre-custom-drift");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Drift");
  await expect(chip).toContainText("drift edit");
  await expect(page.getByTestId("genre-add-name")).toHaveValue("");
  await expect(page.getByTestId("genre-add-query")).toHaveValue("");
  await expect(add).toBeDisabled();

  // The same name again (typed another way) is ignored, and so is a built-in name. The form says so in
  // words (not only a red border), and the sentence is the name field's description.
  const name = page.getByTestId("genre-add-name");
  const exists = page.getByTestId("genre-exists");
  await expect(exists).toHaveCount(0);
  await name.fill("  drift ");
  await page.getByTestId("genre-add-query").fill("other words");
  await expect(exists).toBeVisible();
  await expect(exists).toHaveAttribute("role", "status");
  await expect(exists).toHaveText(/\S/);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription((await exists.innerText()).trim());
  await add.click();
  await expect(exists).toBeVisible();
  await name.fill("Cars");
  await expect(exists).toBeVisible();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await add.click();
  await expect(card.getByTestId("genre-remove")).toHaveCount(1);
  await expect(chip).toContainText("drift edit");

  // A free name clears the sentence and the mark.
  await name.fill("Drone");
  await expect(exists).toHaveCount(0);
  await expect(name).not.toHaveAttribute("aria-invalid");

  // Saved on the device: still there after a reload.
  await page.reload();
  await expect(chip).toBeVisible();

  await chip.getByTestId("genre-remove").click();
  await expect(chip).toHaveCount(0);
  await expect(card.getByTestId("genre-remove")).toHaveCount(0);
  await page.reload();
  await expect(card.getByTestId("genre-builtin")).toHaveCount(12);
  await expect(chip).toHaveCount(0);
});

test("a custom edit genre shows in Discover's genre row and leaves it when removed", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  await page.getByTestId("genre-add-name").fill("Drift");
  await page.getByTestId("genre-add-query").fill("drift edit");
  await page.getByTestId("genre-add").click();
  await expect(page.getByTestId("settings-genre-custom-drift")).toBeVisible();

  // Discover lists the built-in genres first, then the owner's.
  await page.goto("/discover/");
  await expect(page.getByTestId("genre-cars")).toBeVisible();
  await expect(page.getByTestId("genre-custom-drift")).toContainText("Drift");

  await page.goto("/settings/");
  await page.getByTestId("settings-genre-custom-drift").getByTestId("genre-remove").click();
  await expect(page.getByTestId("settings-genre-custom-drift")).toHaveCount(0);

  await page.goto("/discover/");
  await expect(page.getByTestId("genre-cars")).toBeVisible();
  await expect(page.getByTestId("genre-custom-drift")).toHaveCount(0);
});
