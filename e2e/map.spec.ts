import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

const PILLAR_ORDER = ["capture", "editing", "design", "ai", "projects", "growth"];
// A tier-2 DaVinci skill on the Media page (same one the mastery spec uses).
const SKILL_ID = "smart-bins-keywords";
const SKILL_SECTION = "media";

const island = (page: Page, id: string) =>
  page.locator(`[data-testid="island"][data-program="${id}"]`);
const region = (page: Page, id: string) =>
  page.locator(`[data-testid="region"][data-section="${id}"]`);
const node = (page: Page, id: string) =>
  page.locator(`[data-testid="skill-node"][data-skill="${id}"]`);

const fitsViewport = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("world map: 6 continents in pillar order, home island lit, empty islands fogged", async ({
  page,
}) => {
  await freshState(page, "/map/");
  await expect(page.getByTestId("map-screen")).toBeVisible();

  const continents = page.getByTestId("continent");
  await expect(continents).toHaveCount(6);
  const order = await continents.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-pillar")),
  );
  expect(order).toEqual(PILLAR_ORDER);
  await expect(continents.first().getByTestId("continent-level")).toHaveText("LV 1");

  // DaVinci has skills: not fogged, level 1 at the start.
  const davinci = island(page, "davinci");
  await expect(davinci).toHaveAttribute("data-fog", "false");
  await expect(davinci.getByTestId("island-level")).toHaveText("LV 1");
  await expect(davinci.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

  // A program with no skills yet is fogged and points at Discover.
  const fogged = page.locator('[data-testid="island"][data-fog="true"]');
  expect(await fogged.count()).toBeGreaterThan(0);
  await expect(fogged.first()).toHaveAttribute("href", /\/discover\/?$/);

  expect(await fitsViewport(page)).toBe(true);
});

test("DaVinci island: regions and nodes, ticking a quest updates the node, region and island live", async ({
  page,
}) => {
  await freshState(page, "/map/");

  await island(page, "davinci").click();
  const islandMap = page.locator('[data-testid="island-map"][data-program="davinci"]');
  await expect(islandMap).toBeVisible();
  await expect(page).toHaveURL(/#island=davinci$/);

  // 7 DaVinci pages as regions; one node per seeded skill (27 today, other agents may add more).
  await expect(page.getByTestId("region")).toHaveCount(7);
  const nodes = page.getByTestId("skill-node");
  expect(await nodes.count()).toBeGreaterThanOrEqual(27);
  await expect(nodes.first()).toHaveAttribute("data-done", "0");
  expect(await fitsViewport(page)).toBe(true);

  const media = region(page, SKILL_SECTION);
  const pctBefore = await media.getByTestId("region-pct").textContent();
  expect(pctBefore).toBe("0%");

  // Tap a node → skill sheet; tick Train → node, region and island bar update without leaving the map.
  const target = node(page, SKILL_ID);
  await expect(target).toHaveAttribute("data-done", "0");
  await target.click();
  const sheet = page.getByTestId("skill-sheet");
  await expect(sheet).toBeVisible();

  await page.getByTestId("quest-train").click();
  await expect(page.getByTestId("sheet-progress")).toHaveText("1/4");
  await expect(target).toHaveAttribute("data-done", "1");
  await expect(media.getByTestId("region-pct")).not.toHaveText(pctBefore ?? "");

  await page.getByTestId("sheet-close").click();
  await expect(sheet).toBeHidden();

  // Back to the world: the island's bar moved off zero, level text still shows.
  await page.getByTestId("map-back").click();
  await expect(islandMap).toBeHidden();
  await expect(page).not.toHaveURL(/#island=/);
  const davinci = island(page, "davinci");
  await expect(davinci).toBeVisible();
  await expect(davinci.getByTestId("island-level")).toContainText("LV");
  const now = await davinci.getByRole("progressbar").getAttribute("aria-valuenow");
  expect(Number(now)).toBeGreaterThan(0);
});

test("deep link #island=camera opens the Camera island directly", async ({ page }) => {
  await freshState(page, "/map/#island=camera");
  const islandMap = page.locator('[data-testid="island-map"][data-program="camera"]');
  await expect(islandMap).toBeVisible();
  expect(await page.getByTestId("region").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("map-discover")).toHaveAttribute("href", /\/discover\/?$/);
  expect(await fitsViewport(page)).toBe(true);

  await page.getByTestId("map-back").click();
  await expect(page.getByTestId("continent")).toHaveCount(6);
});
