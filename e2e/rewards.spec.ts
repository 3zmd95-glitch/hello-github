import { expect, test, type Page } from "@playwright/test";
import { drainCelebrations, freshState } from "./helpers";

// Same tier-2 DaVinci skill as mastery.spec.ts: its 4 quests master it (badge "first-mastery") and
// level up to LV 2. A 5th quest on a neighbouring skill fills the first film canister (CHEST_EVERY = 5).
const SKILL_ID = "smart-bins-keywords";
const FIFTH_SKILL_ID = "transcribe-search";
const QUESTS = ["train", "research", "produce", "article"] as const;

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Open the DaVinci program and tick `quests` of a skill through its sheet. */
async function tickQuests(page: Page, skillId: string, quests: readonly string[]) {
  await page.locator(`[data-testid="skill-row"][data-skill="${skillId}"]`).click();
  const sheet = page.getByTestId("skill-sheet");
  await expect(sheet).toBeVisible();
  for (const quest of quests) await page.getByTestId(`quest-${quest}`).click();
  return sheet;
}

test("fresh state: empty wallet, chest not ready, 17 ranks, no badges", async ({ page }) => {
  await freshState(page, "/rewards/");
  await expect(page.getByTestId("rewards-screen")).toBeVisible();

  await expect(page.getByTestId("wallet-gems")).toHaveText("0");
  await expect(page.getByTestId("wallet-freezes")).toHaveText("0");
  await expect(page.getByTestId("chest-box")).toHaveAttribute("data-ready", "false");
  await expect(page.getByTestId("chest-progress")).toHaveText("0/5");
  await expect(page.getByTestId("chest-open")).toBeDisabled();
  const rankCards = page.getByTestId("rank-card");
  await expect(rankCards).toHaveCount(17);
  await expect(rankCards.nth(0)).toHaveAttribute("data-current", "true");
  await expect(rankCards.nth(0)).toHaveAttribute("data-locked", "false");
  await expect(rankCards.nth(1)).toHaveAttribute("data-current", "false");
  await expect(rankCards.nth(1)).toHaveAttribute("data-locked", "true");
  await expect(rankCards.nth(16)).toHaveAttribute("data-rank", "16");
  await expect(page.getByTestId("badges-count")).toHaveText(/^0\/\d+$/);
  await expect(page.locator('[data-testid="badge"][data-earned="true"]')).toHaveCount(0);
  await expect(page.getByTestId("reward-card")).toHaveCount(4);
  // The pro-mist filter needs LV 10: its buy button is disabled with the level hint.
  const proMist = page.locator('[data-testid="reward-card"][data-reward="pro-mist"]');
  await expect(proMist.getByTestId("reward-buy")).toBeDisabled();
  await expect(proMist).toHaveAttribute("data-can-buy", "false");
  await expect(page.getByTestId("purchases-empty")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("five quests fill the chest; open it, then add, buy and remove a real reward", async ({
  page,
}) => {
  // Celebrations play one after another with fixed durations, so this flow needs more than 30 s.
  test.setTimeout(120_000);
  await freshState(page, "/skills/");
  const rankCards = page.getByTestId("rank-card");

  // Five quests fast: master one skill (4 quests), then a train quest on another skill.
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  let sheet = await tickQuests(page, SKILL_ID, QUESTS);
  await expect(page.getByTestId("sheet-progress")).toHaveText("4/4");
  const seen = await drainCelebrations(page, ["mastery", "badge"]);
  expect(seen.has("mastery")).toBe(true);
  await page.getByTestId("sheet-close").click();
  await expect(sheet).toBeHidden();

  sheet = await tickQuests(page, FIFTH_SKILL_ID, ["train"]);
  await expect(page.getByTestId("sheet-progress")).toHaveText("1/4");
  await drainCelebrations(page, ["chestReady"], 6);
  await page.getByTestId("sheet-close").click();
  await expect(sheet).toBeHidden();

  // Back on Rewards: the chest waits, gems came in, the first badge is earned.
  await page.goto("/rewards/");
  await expect(page.getByTestId("chest-box")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("chest-progress")).toHaveText("5/5");
  const gemsBefore = Number(await page.getByTestId("wallet-gems").textContent());
  expect(gemsBefore).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="badge"][data-badge="first-mastery"]')).toHaveAttribute(
    "data-earned",
    "true",
  );
  const countText = (await page.getByTestId("badges-count").textContent()) ?? "0/0";
  expect(Number(countText.split("/")[0])).toBeGreaterThanOrEqual(1);
  await expect(rankCards.nth(1)).toHaveAttribute("data-current", "true");
  await expect(rankCards.nth(0)).toHaveAttribute("data-locked", "false");

  // Open the chest: the loot celebration plays, the loot shows inline, the chest is spent.
  await page.getByTestId("chest-open").click();
  const celebration = page.getByTestId("celebration");
  await expect(celebration).toBeVisible();
  await expect(celebration).toHaveAttribute("data-kind", "chestLoot");
  await drainCelebrations(page, ["chestLoot"], 6);
  await expect(page.getByTestId("chest-loot")).toBeVisible();
  await expect(page.getByTestId("chest-box")).toHaveAttribute("data-ready", "false");
  await expect(page.getByTestId("chest-progress")).toHaveText("0/5");
  // Opening the first chest also earns the "first-chest" badge.
  await expect(page.locator('[data-testid="badge"][data-badge="first-chest"]')).toHaveAttribute(
    "data-earned",
    "true",
  );

  // Add a real reward and buy it.
  const gemsAfterChest = Number(await page.getByTestId("wallet-gems").textContent());
  await page.getByTestId("reward-add").click();
  const form = page.getByTestId("reward-form");
  await expect(form).toBeVisible();
  await page.getByTestId("reward-name").fill("Coffee");
  await page.getByTestId("reward-cost").fill("1");
  await page.getByTestId("reward-save").click();
  await expect(form).toBeHidden();
  const coffee = page.locator('[data-testid="reward-card"]', { hasText: "Coffee" });
  await expect(coffee).toHaveCount(1);
  await expect(page.getByTestId("reward-card")).toHaveCount(5);

  await coffee.getByTestId("reward-buy").click();
  await expect(page.getByTestId("purchase-row")).toHaveCount(1);
  await expect(page.getByTestId("purchase-row").first()).toContainText("Coffee");
  await expect(page.getByTestId("wallet-gems")).toHaveText(String(gemsAfterChest - 1));

  // Remove it (behind the confirm dialog): the card is gone, the purchase stays in the log.
  await coffee.getByTestId("reward-remove").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(coffee).toHaveCount(0);
  await expect(page.getByTestId("reward-card")).toHaveCount(4);
  await expect(page.getByTestId("purchase-row")).toHaveCount(1);

  await expectNoHorizontalScroll(page);
});
