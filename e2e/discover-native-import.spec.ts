import { expect, test } from "@playwright/test";
import { freshState, seedState, switchLang, openBrowseCategories } from "./helpers";

const video = "https://www.tiktok.com/@editor/video/1234567890123456789";
const second = "https://www.tiktok.com/@other/video/2234567890123456789";
const incoming = (urls = [video, second]) =>
  "/discover/#discover-import=" +
  encodeURIComponent(JSON.stringify({ version: 1, platform: "tt", urls }));

test("native links require review, retain source rules and persist without searches or preferences", async ({
  page,
}) => {
  const sourceReads: string[] = [];
  const searches: string[] = [];
  const worker = "https://native-import.example.workers.dev";
  await page.route(`${worker}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (["/discover", "/search", "/discover/expand"].includes(path)) searches.push(path);
    return route.fulfill({
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
      json: { ok: true, auth: true, discover: true },
    });
  });
  await page.route("**/api/local-ai/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/local-ai/tiktok-source") {
      sourceReads.push(url.searchParams.get("url") ?? "");
      return route.fulfill({
        json: {
          status: "available",
          url: video,
          observedAt: new Date().toISOString(),
          provenance: "tiktok-public-page",
          author: "editor",
          caption: "Coffee cinematic commercial film with match cuts",
          likes: 5,
          views: 50,
          published: new Date().toISOString(),
        },
      });
    }
    if (/discover|search|assess/.test(url.pathname)) searches.push(url.pathname);
    return route.fulfill({ status: 404, json: {} });
  });
  await seedState(page, incoming(), {
    settings: { lang: "en", apiKeys: { scoutUrl: worker, scoutToken: "fixture" } },
  });
  await switchLang(page, "en");
  await expect(page.getByTestId("native-import-review")).toBeVisible();
  await expect(page.getByTestId("native-import-confirm")).toBeDisabled();
  expect(sourceReads).toEqual([]);
  expect(new URL(page.url()).hash).toBe("");
  await page.getByTestId("native-import-category").selectOption("coffee");
  await page.getByTestId("native-import-review").getByRole("checkbox").nth(1).uncheck();
  await switchLang(page, "ar");
  await expect(page.getByTestId("native-import-confirm")).toContainText("(1)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await switchLang(page, "en");
  await page.getByTestId("native-import-confirm").click();
  await expect(page.getByTestId("native-import-result")).toContainText("1 selected");
  await expect.poll(() => sourceReads).toContain(video);
  expect(sourceReads).not.toContain(second);
  await expect(page.getByTestId("feed-checking")).toBeHidden();
  await expect(page.getByTestId("feed-list").getByTestId("feed-card")).toHaveCount(0);
  await page.getByTestId("feed-mode-popular").click();
  await expect(page.getByTestId("feed-list").getByTestId("feed-card")).toHaveCount(0);
  await page.getByTestId("feed-mode-explore").click();
  await expect(page.getByTestId("feed-list").getByTestId("feed-card")).toHaveCount(1);
  await expect(page.getByTestId("inspiration-library-open")).toContainText("0");
  expect(searches).toEqual([]);
  // A retained platform filter must not hide a new import into this same category.
  await page.getByTestId("browse-tab-yt").click();
  await page.goto(incoming([video]));
  await page.getByTestId("native-import-category").selectOption("coffee");
  await page.getByTestId("native-import-confirm").click();
  await expect(page.getByTestId("browse-tab-all")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await openBrowseCategories(page);
  await page.getByTestId("genre-coffee").click();
  await page.getByTestId("feed-mode-explore").click();
  await expect(page.getByTestId("feed-list").getByTestId("feed-card")).toHaveCount(1);
  await expect(page.getByTestId("native-import-review")).toHaveCount(0);
  expect(searches).toEqual([]);
});

test("cancelling native results leaves the category library empty", async ({ page }) => {
  const sourceReads: string[] = [];
  await page.route("**/api/local-ai/**", (route) => {
    if (route.request().url().includes("tiktok-source")) sourceReads.push(route.request().url());
    return route.fulfill({ status: 404, json: {} });
  });
  await freshState(page, incoming([video]));
  await page.getByTestId("native-import-cancel").click();
  await expect(page.getByTestId("native-import-review")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("native-import-review")).toHaveCount(0);
  expect(sourceReads).toEqual([]);
});
