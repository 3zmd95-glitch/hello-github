import { expect, test, type Page } from "@playwright/test";
import { freshState, switchLang } from "./helpers";

// 🧰 Tools & integrations hub (packet DT-1, Amendments A and B): reachable from both worlds' More pages, searchable
// in Arabic and English, honest states, and read-only: from freshState (no Worker configured, so the publish
// watcher and social sync stay idle) nothing the hub does reaches a Worker, the local AI route or another origin.

/** The app shell's Google Fonts stylesheet and font files (app/layout.tsx): every route loads them. */
const SHELL_FONTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/** Requests the page makes from now on that would be a hub side effect. */
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

const rows = (page: Page) => page.locator("[data-tool]");

test("Training More opens the Tools hub", async ({ page }) => {
  await freshState(page, "/more/");
  await page.getByTestId("more-tools").click();
  await expect(page).toHaveURL(/\/tools\/$/);
  await expect(page.getByTestId("tools-search")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
});

test("Social More has no Tools row: Social never links into Training (tools/20)", async ({
  page,
}) => {
  await freshState(page, "/social/more/");
  await expect(page.getByTestId("more-training")).toBeVisible();
  await expect(page.getByTestId("more-tools")).toHaveCount(0);
});

test("opening and searching the hub makes no Worker, local AI or outside request", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  await freshState(page, "/tools/");
  await expect(rows(page).first()).toBeVisible();
  const total = await rows(page).count();
  expect(total).toBeGreaterThan(20);

  const search = page.getByTestId("tools-search");
  await search.fill("ردود");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("tools-row-replies")).toBeVisible();

  await search.fill("replies");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("tools-row-replies")).toBeVisible();

  await search.fill("zzqx");
  await expect(page.getByTestId("tools-empty")).toBeVisible();
  await page.getByTestId("tools-clear").click();
  await expect(rows(page)).toHaveCount(total);

  await search.fill("zzqx");
  await search.press("Escape");
  await expect(rows(page)).toHaveCount(total);

  // Unconfigured: honest states, nothing green.
  await expect(page.getByTestId("tools-state-website")).toHaveAttribute("data-state", "available");
  await expect(page.getByTestId("tools-state-workflows")).toHaveAttribute(
    "data-state",
    "available",
  );
  await expect(page.getByTestId("tools-state-business")).toHaveAttribute("data-state", "available");
  await expect(page.getByTestId("tools-state-inbox")).toHaveAttribute("data-state", "setup");
  await expect(page.locator('[data-state="planned"]')).toHaveCount(0);
  await expect(page.getByTestId("tools-state-scout")).toHaveAttribute("data-state", "setup");
  await expect(page.getByTestId("tools-state-instagram")).toHaveAttribute("data-state", "setup");
  await expect(page.getByTestId("tools-state-localAi")).toHaveAttribute("data-state", "hostOnly");
  await expect(page.locator('[data-state="connected"], [data-state="stale"]')).toHaveCount(0);

  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("the hub fits the screen and renders in Arabic and English", async ({ page }) => {
  await freshState(page, "/tools/");
  await expect(page.locator("h1")).toHaveText("الأدوات والربط");
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
  expect(await fits()).toBe(true);

  await switchLang(page, "en");
  await expect(page.locator("h1")).toHaveText("Tools & integrations");
  await expect(page.getByTestId("tools-row-replies")).toContainText("Auto replies");
  expect(await fits()).toBe(true);
});

test("setup links open the existing Settings controls", async ({ page }) => {
  await freshState(page, "/tools/");
  await page.getByTestId("tools-action-scout").click();
  await expect(page).toHaveURL(/\/settings\/?#api-keys$/);
  await expect(page.locator("#api-keys")).toBeVisible();

  await page.goto("/tools/");
  await page.getByTestId("tools-link-backup").click();
  await expect(page).toHaveURL(/\/settings\/?#data$/);
  await expect(page.locator("#data")).toBeVisible();
});
