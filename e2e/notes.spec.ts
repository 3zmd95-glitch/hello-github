import { expect, test } from "@playwright/test";
import { freshState } from "./helpers";

const SKILL_ID = "smart-bins-keywords";
const OTHER_ID = "scene-cut-detection";

test("Research opens the skill's note in the app: template, autosave, [[links]], backlinks, tick", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`).click();

  // The Research row links to the note, which opens on the Notes page in its branch.
  await page.getByTestId("quest-note").click();
  await expect(page).toHaveURL(new RegExp(`/notes/#skill=${SKILL_ID}$`));
  const editor = page.getByTestId("note-editor");
  await expect(editor).toHaveAttribute("data-skill", SKILL_ID);
  await expect(page.locator(`[data-testid="notes-row"][data-skill="${SKILL_ID}"]`)).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Nothing written yet: no tick, a template to start from.
  await expect(page.getByTestId("note-tick-research")).toBeDisabled();
  await page.getByTestId("note-template").click();
  const area = page.getByTestId("note-textarea");
  await expect(area).toHaveValue(/^# /);
  await area.fill(
    `# Smart bins\n\nKeywords feed the bins. See [[${OTHER_ID}]] and [[No such skill]].`,
  );
  await expect(page.getByTestId("note-status")).toHaveText(/✓/);

  // Read mode renders Markdown and the links.
  await page.getByTestId("note-tab-read").click();
  const preview = page.getByTestId("note-preview");
  await expect(preview.locator("h1")).toHaveText("Smart bins");
  await expect(page.getByTestId("note-link-missing")).toHaveText("No such skill");

  // Follow the [[link]]: the other note opens and lists this one under "Linked from".
  await page.getByTestId("note-link").click();
  await expect(editor).toHaveAttribute("data-skill", OTHER_ID);
  await expect(page.getByTestId("note-backlink")).toHaveCount(1);
  await page.getByTestId("note-backlink").click();
  await expect(editor).toHaveAttribute("data-skill", SKILL_ID);

  // Saved on the device: survives a reload, then the Research quest is ticked from the note.
  await page.reload();
  await expect(page.getByTestId("note-preview").locator("h1")).toHaveText("Smart bins");
  await page.getByTestId("note-tick-research").click();
  await expect(page.getByTestId("note-research-done")).toBeVisible();

  // Back in the skill popup the quest is done and the note shows its size.
  await page.getByTestId("note-open-skill").click();
  await expect(page.getByTestId("quest-research")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("quest-note")).toContainText("12");

  // Search (from the tree, on every screen size) finds the note by its text.
  await page.goto("/notes/");
  await page.getByTestId("notes-search").fill("keywords feed");
  const results = page.getByTestId("notes-results");
  await expect(results.locator(`[data-skill="${SKILL_ID}"]`)).toBeVisible();
});

test("phone: the tree and the note take turns, back returns to the tree, nothing scrolls sideways", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone layout only");
  await freshState(page, "/notes/");
  await expect(page.getByTestId("notes-vault")).toBeVisible();
  await page.locator('[data-testid="notes-branch"][data-program="davinci"] summary').click();
  await page.locator(`[data-testid="notes-row"][data-skill="${SKILL_ID}"]`).click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.getByTestId("notes-vault")).toBeHidden();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  await page.getByTestId("note-back").click();
  await expect(page.getByTestId("notes-vault")).toBeVisible();
  await expect(page.getByTestId("notes-pick")).toBeHidden();
});

test("Today's first quest is Research and links straight to its note", async ({ page }) => {
  await freshState(page, "/");
  const main = page.getByTestId("main-quest");
  const skillId = await main.getAttribute("data-skill");
  await page.getByTestId("main-note").click();
  await expect(page.getByTestId("note-editor")).toHaveAttribute("data-skill", skillId!);
});
