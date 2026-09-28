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

test("typing [[ suggests skills; Enter or a tap writes the link, and Live shows it formatted", async ({
  page,
}) => {
  await freshState(page, `/notes/#skill=${SKILL_ID}`);
  // A new note opens in Live mode: editor and formatted preview together.
  await expect(page.getByTestId("note-tab-live")).toHaveAttribute("aria-selected", "true");
  const area = page.getByTestId("note-textarea");
  await area.click();
  await area.pressSequentially("# Bins\nSee [[scene cu");

  const list = page.getByTestId("note-suggest");
  await expect(list).toBeVisible();
  await expect(list.getByTestId("note-suggest-item").first()).toHaveAttribute(
    "data-skill",
    OTHER_ID,
  );
  await page.keyboard.press("Enter");
  await expect(list).toBeHidden();
  await expect(area).toHaveValue("# Bins\nSee [[تقطيع المشاهد تلقائي (Scene Cut Detection)]]");

  // Esc closes the list and it stays closed while typing on in that link.
  await area.pressSequentially(" [[x");
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await area.pressSequentially("y");
  await expect(list).toBeHidden();
  await area.press("Backspace");
  await area.press("Backspace");
  await area.press("Backspace");
  await area.press("Backspace");

  // Keep typing after the link; then a second link by tapping a suggestion.
  await area.pressSequentially(" and [[");
  await expect(list).toBeVisible();
  const second = list.getByTestId("note-suggest-item").nth(1);
  const secondId = await second.getAttribute("data-skill");
  await second.click();
  await expect(area).toHaveValue(/ and \[\[[^\]]+\]\]$/);

  // Live preview: heading and both links, updated while typing.
  const live = page.getByTestId("note-live");
  await expect(live.locator("h1")).toHaveText("Bins");
  await expect(live.getByTestId("note-link")).toHaveCount(2);
  await live.getByTestId("note-link").nth(1).click();
  await expect(page.getByTestId("note-editor")).toHaveAttribute("data-skill", secondId!);
});

// 2×2 red PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "base64",
);

test("an image added to a note is kept on the device and shows in Live and Read", async ({
  page,
}) => {
  await freshState(page, `/notes/#skill=${SKILL_ID}`);
  await page.getByTestId("note-textarea").fill("Before the picture");
  await page
    .getByTestId("note-image-input")
    .setInputFiles({ name: "grade.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("note-textarea")).toHaveValue(
    /^Before the picture\n!\[grade\]\(img:[\w-]+\)\n$/,
  );
  const img = page.getByTestId("note-live").getByTestId("note-image");
  await expect(img).toHaveAttribute("src", /^blob:/);
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // Saved: after a reload the note opens in Read mode with the picture from the device.
  await expect(page.getByTestId("note-status")).toHaveText(/✓/);
  await page.reload();
  await expect(page.getByTestId("note-preview").getByTestId("note-image")).toHaveAttribute(
    "src",
    /^blob:/,
  );
});

test("the graph shows notes around their islands, gold lines for [[links]], and opens a note", async ({
  page,
}) => {
  await freshState(page, "/notes/");
  await page.getByTestId("notes-view-graph").click();
  await expect(page.getByTestId("note-graph-empty")).toBeVisible();

  // Write one note that links another skill.
  await page.goto(`/notes/#skill=${SKILL_ID}`);
  await page.getByTestId("note-textarea").fill(`Tag clips, then [[${OTHER_ID}]].`);
  await expect(page.getByTestId("note-status")).toHaveText(/✓/);

  await page.getByTestId("notes-view-graph").click();
  const graph = page.getByTestId("note-graph");
  await expect(graph).toBeVisible();
  await expect(
    graph.locator(`[data-testid="note-graph-node"][data-skill="${SKILL_ID}"]`),
  ).toHaveAttribute("data-has-note", "1");
  await expect(
    graph.locator(`[data-testid="note-graph-node"][data-skill="${OTHER_ID}"]`),
  ).toHaveAttribute("data-has-note", "0");
  await expect(graph.getByTestId("note-graph-link")).toHaveCount(1);
  await expect(
    graph.locator('[data-testid="note-graph-island"][data-program="davinci"]'),
  ).toHaveCount(1);
  await expect(graph.getByTestId("note-graph-node")).toHaveCount(2);

  // Every skill, each around its own island.
  await page.getByTestId("notes-graph-all").check();
  expect(await graph.getByTestId("note-graph-node").count()).toBeGreaterThan(27);
  expect(await graph.getByTestId("note-graph-island").count()).toBeGreaterThan(1);

  // A dot is a link to its note.
  await graph.locator(`[data-testid="note-graph-node"][data-skill="${OTHER_ID}"]`).click();
  await expect(page.getByTestId("note-editor")).toHaveAttribute("data-skill", OTHER_ID);
  await expect(page.getByTestId("notes-view-tree")).toHaveAttribute("aria-selected", "true");
});
