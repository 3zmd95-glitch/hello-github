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

test("every island on the map has the same skills in its Notes branch, under the same pillar", async ({
  page,
}) => {
  await freshState(page, "/map/");
  const islands = await page
    .locator('[data-testid="continent"] [data-testid="island"][data-fog="false"]')
    .evaluateAll((els) =>
      els.map((el) => ({
        program: el.getAttribute("data-program")!,
        pillar: el.closest('[data-testid="continent"]')!.getAttribute("data-pillar")!,
      })),
    );
  expect(islands.length).toBeGreaterThan(1);

  const onMap: Record<string, string[]> = {};
  for (const { program } of islands) {
    await page.evaluate((id) => (window.location.hash = `island=${id}`), program);
    await expect(
      page.locator(`[data-testid="island-map"][data-program="${program}"]`),
    ).toBeVisible();
    onMap[program] = await page
      .getByTestId("skill-node")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-skill")!));
    expect(onMap[program].length).toBeGreaterThan(0);
  }

  await page.goto("/notes/");
  const branches = page.getByTestId("notes-branch");
  await expect(branches).toHaveCount(islands.length);
  for (const { program, pillar } of islands) {
    const branch = page.locator(
      `[data-testid="notes-pillar"][data-pillar="${pillar}"] [data-testid="notes-branch"][data-program="${program}"]`,
    );
    const rows = await branch
      .getByTestId("notes-row")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-skill")!));
    expect(rows.sort(), program).toEqual([...onMap[program]].sort());
  }
});

test("map → note → map: a skill node opens its note in its branch, and the note marks the node", async ({
  page,
}) => {
  await freshState(page, "/map/#island=camera");
  const node = page.getByTestId("skill-node").first();
  const skillId = (await node.getAttribute("data-skill"))!;
  await expect(node).toHaveAttribute("data-has-note", "false");
  await node.click();
  await page.getByTestId("quest-note").click();
  // The first visit to /notes/ fetches its page data; give a busy machine time before checking the editor.
  await expect(page).toHaveURL(new RegExp(`/notes/#skill=${skillId}$`), { timeout: 15_000 });

  await expect(page.getByTestId("note-editor")).toHaveAttribute("data-skill", skillId);
  const branch = page.locator('[data-testid="notes-branch"][data-program="camera"]');
  await expect(branch).toHaveAttribute("open", "");
  await expect(
    branch.locator(`[data-testid="notes-row"][data-skill="${skillId}"]`),
  ).toHaveAttribute("aria-current", "page");

  await page.getByTestId("note-textarea").fill("Log keeps more light in the shadows.");
  await page.getByTestId("note-map-link").click();
  await expect(page.locator('[data-testid="island-map"][data-program="camera"]')).toBeVisible();
  const marked = page.locator(`[data-testid="skill-node"][data-skill="${skillId}"]`);
  await expect(marked).toHaveAttribute("data-has-note", "true");
  await expect(marked.getByTestId("skill-node-note")).toBeVisible();
});

test("the empty editor and its hint follow the Arabic page direction", async ({ page }) => {
  await freshState(page, "/notes/#skill=smart-bins-keywords");
  const area = page.getByTestId("note-textarea");
  await expect(area).toHaveAttribute("dir", "rtl");
  // Each typed line picks its own direction.
  await area.fill("سطر عربي\nAn English line");
  expect(await area.evaluate((el) => getComputedStyle(el).unicodeBidi)).toBe("plaintext");
});
