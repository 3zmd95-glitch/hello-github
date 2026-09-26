import { expect, test } from "@playwright/test";
import { drainCelebrations, freshState } from "./helpers";

// A tier-2 DaVinci skill: 15 + 23 + 38 + 45 XP for its 4 quests + 20 mastery bonus = 141 XP,
// which is exactly the level-2 threshold (round(50 * 2^1.5) = 141) -> ticking its 4 quests both
// masters the skill and levels the account up to LV 2 in the same tick.
const SKILL_ID = "smart-bins-keywords";
const QUESTS = ["train", "research", "produce", "article"] as const;

test("masters a skill quest by quest and levels up", async ({ page }) => {
  await freshState(page, "/skills/");

  // DaVinci lives under the Editing pillar.
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();

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

  // The same 141 XP all came from DaVinci, so the Editing pillar is LV2 in the Today pillar strip,
  // and tapping the strip opens the Skills screen.
  const strip = page.getByTestId("pillar-strip");
  await expect(strip.locator('[data-pillar="editing"]')).toContainText("LV2");
  await expect(strip.locator('[data-pillar="capture"]')).toContainText("LV1");
  await strip.click();
  await expect(page).toHaveURL(/\/skills\/$/);
  await expect(page.getByTestId("pillar-editing").getByTestId("pillar-level")).toHaveText("LV 2");
});
