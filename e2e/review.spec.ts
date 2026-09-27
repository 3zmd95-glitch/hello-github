import { expect, test } from "@playwright/test";
import { drainCelebrations, freshState } from "./helpers";

// smart-bins-keywords is a tier-2 DaVinci skill: its train quest gives round(10 × 1.5) = 15 XP.
// The first review of a week adds REVIEW_XP = 10, so the week ends on 25 XP.
const SKILL_ID = "smart-bins-keywords";

test("the weekly review shows the week's stats, saves a reflection once for XP, then edits it for free", async ({
  page,
}) => {
  await freshState(page, "/review/");

  // Fresh state: everything is 0, the week is the current one and Save waits for a mood.
  await expect(page.getByTestId("review-screen")).toBeVisible();
  await expect(page.getByTestId("review-week")).toBeVisible();
  await expect(page.getByTestId("review-next")).toBeDisabled();
  await expect(page.getByTestId("stat-xp")).toHaveAttribute("data-xp", "0");
  await expect(page.getByTestId("stat-quests")).toContainText("0");
  await expect(page.getByTestId("stat-days")).toContainText("0/7");
  await expect(page.getByTestId("stat-focus")).toContainText("0:00");
  await expect(page.getByTestId("pillar-xp-row")).toHaveCount(0);
  await expect(page.getByTestId("xp-history-bar")).toHaveCount(8);
  await expect(page.getByTestId("insight").first()).toBeVisible();
  await expect(page.getByTestId("review-save")).toBeDisabled();
  await expect(page.getByTestId("past-review")).toHaveCount(0);

  // Browsing back and forward again lands on the same week.
  const label = await page.getByTestId("review-week").textContent();
  await page.getByTestId("review-prev").click();
  await expect(page.getByTestId("review-next")).toBeEnabled();
  await expect(page.getByTestId("review-week")).not.toHaveText(label ?? "");
  await page.getByTestId("review-next").click();
  await expect(page.getByTestId("review-week")).toHaveText(label ?? "");
  await expect(page.getByTestId("review-next")).toBeDisabled();

  // Complete one quest from the Skills screen (Editing → DaVinci → Smart Bins → train).
  await page.goto("/skills/");
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`).click();
  await expect(page.getByTestId("skill-sheet")).toBeVisible();
  await page.getByTestId("quest-train").click();
  await expect(page.getByTestId("sheet-progress")).toHaveText("1/4");
  await drainCelebrations(page, ["xp"], 4);

  // The review now counts it: 15 XP, 1 quest (software), 1 active day, the Editing pillar lit.
  await page.goto("/review/");
  await expect(page.getByTestId("stat-xp")).toContainText("15");
  await expect(page.getByTestId("stat-quests")).toHaveAttribute("data-software", "1");
  await expect(page.getByTestId("stat-quests").locator("b")).toHaveText("1");
  await expect(page.getByTestId("stat-days")).toContainText("1/7");
  await expect(page.locator('[data-testid="pillar-xp-row"][data-pillar="editing"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="xp-history-bar"][data-on="true"]')).toHaveCount(1);

  // Reflection: pick a mood, answer the three questions, save → XP toast, saved card, one past review.
  await expect(page.getByTestId("review-save")).toBeDisabled();
  await page.locator('[data-testid="mood"][data-mood="4"]').click();
  await expect(page.locator('[data-testid="mood"][data-mood="4"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("review-save")).toBeEnabled();
  await page.getByTestId("review-wins").fill("خلّصت مهمة Smart Bins");
  await page.getByTestId("review-blocks").fill("ما لقيت وقت الثلاثاء");
  await page.getByTestId("review-next-goal").fill("أصوّر كليب Log");
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("toast")).toBeVisible();
  await expect(page.getByTestId("review-saved")).toBeVisible();
  await expect(page.getByTestId("review-saved")).toContainText("خلّصت مهمة Smart Bins");
  await expect(page.getByTestId("past-review")).toHaveCount(1);
  await expect(page.getByTestId("past-review")).toContainText("أصوّر كليب Log");
  await expect(page.getByTestId("stat-xp")).toHaveAttribute("data-xp", "25");

  // Reload: the review and its XP are read back from localStorage.
  await page.reload();
  await expect(page.getByTestId("review-saved")).toBeVisible();
  await expect(page.getByTestId("past-review")).toHaveCount(1);
  await expect(page.getByTestId("stat-xp")).toHaveAttribute("data-xp", "25");

  // Edit: change an answer and save again → no new XP (stays 25), text updated everywhere.
  await drainCelebrations(page, [], 2);
  await page.getByTestId("review-edit").click();
  await expect(page.getByTestId("review-save")).toBeEnabled();
  await page.getByTestId("review-wins").fill("خلّصت مهمتين");
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-saved")).toBeVisible();
  await expect(page.getByTestId("review-saved")).toContainText("خلّصت مهمتين");
  await expect(page.getByTestId("past-review")).toContainText("خلّصت مهمتين");
  await expect(page.getByTestId("toast")).toBeHidden();
  await expect(page.getByTestId("stat-xp")).toHaveAttribute("data-xp", "25");
  await expect(page.getByTestId("past-review")).toHaveCount(1);

  // No horizontal scroll on either viewport.
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});
