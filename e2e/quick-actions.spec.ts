import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { freshState, switchLang } from "./helpers";

// ⚡ Quick Actions (packet DT-2): one launcher in each world's top bar plus Ctrl/Cmd+K open a navigation-only dialog
// over the DT-1 registry. From freshState (no Worker configured, so the shell's sync agents stay idle) opening and
// searching reaches no Worker, local AI route or other origin, and every choice is an ordinary link.

/** The app shell's Google Fonts stylesheet and font files (app/layout.tsx): every route loads them. */
const SHELL_FONTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

function watchForbidden(page: Page): string[] {
  const forbidden: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (!url.protocol.startsWith("http") || SHELL_FONTS.has(url.hostname)) return;
    if (
      url.hostname.endsWith("workers.dev") ||
      url.pathname.startsWith("/api/local-ai/") ||
      url.hostname !== "localhost"
    )
      forbidden.push(req.url());
  });
  return forbidden;
}

const launcher = (page: Page) => page.getByTestId("quick-launch");
const dialog = (page: Page) => page.getByTestId("quick-dialog");
const input = (page: Page) => page.getByTestId("quick-input");

/** A tap on the phone project, a mouse click on desktop. */
async function press(el: Locator, info: TestInfo): Promise<void> {
  if (info.project.name === "phone") await el.tap();
  else await el.click();
}

async function search(page: Page, info: TestInfo, query: string): Promise<void> {
  await press(launcher(page), info);
  await expect(dialog(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await input(page).fill(query);
}

const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("the launcher sits in both top bars", async ({ page }) => {
  await freshState(page, "/");
  await expect(launcher(page)).toBeVisible();
  await expect(launcher(page)).toHaveAttribute("aria-label", "وصول سريع · Ctrl+K");
  await page.goto("/social/");
  await expect(page.getByTestId("social-top").getByTestId("quick-launch")).toBeVisible();
});

test("Training to Calendar enters Social, with no outside request on open and search", async ({
  page,
}, info) => {
  const forbidden = watchForbidden(page);
  await freshState(page, "/");
  await search(page, info, "calendar");
  await expect(page.getByTestId("quick-item-calendar")).toHaveAttribute("aria-selected", "true");
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);

  await input(page).press("Enter");
  await expect(page).toHaveURL(/\/social\/calendar\/$/);
  await expect(page.getByTestId("social-top")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect(dialog(page)).toHaveCount(0);
});

test("Social to Notes enters Training, and the world switch returns to the remembered route", async ({
  page,
}, info) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
  await search(page, info, "notes");
  await input(page).press("Enter");
  await expect(page).toHaveURL(/\/notes\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await expect(page.getByTestId("lang-ar")).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);

  await page.getByTestId("world-social").click();
  await expect(page).toHaveURL(/\/social\/growth\/$/);
  await expect(page.getByTestId("growth-screen")).toBeVisible();
});

test("choosing the current page or a Settings anchor still closes the dialog", async ({
  page,
}, info) => {
  await freshState(page, "/notes/");
  await search(page, info, "notes");
  await press(page.getByTestId("quick-item-notes"), info);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes\/$/);

  await search(page, info, "Instagram account");
  await press(page.getByTestId("quick-item-instagram"), info);
  await expect(page).toHaveURL(/\/settings\/#accounts$/);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator("#accounts")).toBeVisible();
});

test("Ctrl+K opens and Escape closes, giving focus back to the launcher", async ({ page }) => {
  await freshState(page, "/");
  await launcher(page).focus();
  await page.keyboard.press("Control+k");
  await expect(dialog(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();

  await launcher(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.getByTestId("quick-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(dialog(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
  // Opening and closing added no history entry: Back leaves the app's first page.
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(3);
});

test("Ctrl+K inside the note editor types, it does not open the dialog", async ({ page }) => {
  await freshState(page, "/notes/#skill=smart-bins-keywords");
  const area = page.getByTestId("note-textarea");
  await area.click();
  await page.keyboard.press("Control+k");
  await expect(dialog(page)).toHaveCount(0);
  await expect(area).toBeFocused();
});

test("the dialog follows the page direction and fits the screen", async ({ page }, info) => {
  await freshState(page, "/");
  await search(page, info, "");
  expect(await dialog(page).evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  expect(await fits(page)).toBe(true);
  await page.keyboard.press("Escape");

  await switchLang(page, "en");
  await search(page, info, "");
  expect(await dialog(page).evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  await expect(page.getByTestId("quick-item-replies")).toContainText("Auto replies");
  expect(await fits(page)).toBe(true);
});

test("both top bars keep every control on screen at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/", "/social/"]) {
    await freshState(page, path);
    expect(await fits(page), path).toBe(true);
    const header = page.locator("header").first();
    for (const el of await header.locator("a:visible, button:visible").all()) {
      const box = (await el.boundingBox())!;
      expect(box.x, path).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, path).toBeLessThanOrEqual(375);
    }
    await expect(launcher(page)).toBeVisible();
  }
});

test("Tab onto a result, then the arrows and Enter open the highlighted row (Amendment A)", async ({
  page,
}, info) => {
  await freshState(page, "/");
  await search(page, info, "");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("quick-close")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("quick-item-today")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const skills = page.getByTestId("quick-item-skills");
  await expect(skills).toBeFocused();
  await expect(skills).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/skills\/$/);
  await expect(dialog(page)).toHaveCount(0);
});

test("Close dismisses without leaving the page (Amendment A)", async ({ page }, info) => {
  await freshState(page, "/planner/");
  const close = page.getByTestId("quick-close");
  if (info.project.name === "phone") {
    await search(page, info, "notes");
    const box = (await close.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await close.tap();
  } else {
    await launcher(page).focus();
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(launcher(page)).toBeFocused();
  }
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/planner\/$/);
});

test("the launcher behind an open skill sheet does not open a second dialog (Amendment B)", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.getByTestId("skill-row").first().click();
  const sheet = page.getByTestId("skill-sheet");
  await expect(sheet).toBeVisible();

  // The skill sheet keeps no Tab containment: walk back to the covered top-bar launcher.
  const onLauncher = () =>
    page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "quick-launch");
  for (let i = 0; i < 300 && !(await onLauncher()); i++) await page.keyboard.press("Shift+Tab");
  expect(await onLauncher()).toBe(true);

  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
});
