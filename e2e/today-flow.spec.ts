import { expect, test } from "@playwright/test";
import { drainCelebrations, freshState } from "./helpers";

test("today's flow goes 0/3 -> 1/3 -> 3/3, survives reload, and lights the streak", async ({
  page,
}) => {
  await freshState(page, "/");

  await expect(page.getByTestId("flow-count")).toHaveText("0/3");
  await expect(page.getByTestId("flow-step-1")).toHaveAttribute("data-done", "false");

  // Step 1: tick the main quest.
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");
  await expect(page.getByTestId("flow-step-1")).toHaveAttribute("data-done", "true");

  // Step 2: tick the 5-minute micro-action -> day complete (steps 2 and 3 both land at once).
  await page.getByTestId("micro-done").click();
  const seen = await drainCelebrations(page, ["dayDone"]);
  expect(seen.has("dayDone")).toBe(true);

  await expect(page.getByTestId("flow-count")).toHaveText("3/3");
  await expect(page.getByTestId("flow-step-3")).toHaveAttribute("data-done", "true");

  // Reload: progress and streak are read back from localStorage.
  await page.reload();
  await expect(page.getByTestId("flow-count")).toHaveText("3/3");
  await expect(page.getByTestId("streak")).toHaveText("1");
});
