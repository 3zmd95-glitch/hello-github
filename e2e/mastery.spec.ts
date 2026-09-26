import { expect, test } from "@playwright/test";
import { drainCelebrations, freshState } from "./helpers";

// A tier-2 DaVinci skill: 15 + 23 + 38 + 45 XP for its 4 quests + 20 mastery bonus = 141 XP,
// which is exactly the level-2 threshold (round(50 * 2^1.5) = 141) -> ticking its 4 quests both
// masters the skill and levels the account up to LV 2 in the same tick.
const SKILL_ID = "smart-bins-keywords";
const QUESTS = ["train", "research", "produce", "article"] as const;

test("masters a skill quest by quest and levels up", async ({ page }) => {
  await freshState(page, "/skills/");

  await page.locator('[data-testid="program-card"][data-program="davinci"]').click();

  const skillRow = page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`);
  await skillRow.click();

  const sheet = page.getByTestId("skill-sheet");
  await expect(sheet).toBeVisible();
  // Tag the live DOM node so we can prove it is never remounted while quests are ticked.
  await sheet.evaluate((el) => {
    (el as HTMLElement).dataset.e2eKept = "yes";
  });

  for (const [i, quest] of QUESTS.entries()) {
    await page.getByTestId(`quest-${quest}`).click();
    await expect(page.getByTestId("sheet-progress")).toHaveText(`${i + 1}/4`);
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-e2e-kept", "yes");
  }

  const seen = await drainCelebrations(page, ["levelUp", "mastery"]);
  expect(seen.has("mastery")).toBe(true);
  expect(seen.has("levelUp")).toBe(true);

  await page.getByTestId("sheet-close").click();
  await expect(sheet).toBeHidden();
  await expect(skillRow).toContainText("⭐");

  await page.goto("/");
  await expect(page.getByTestId("level")).toContainText("LV 2");
});
