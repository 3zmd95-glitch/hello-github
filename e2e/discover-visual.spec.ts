import { expect, test } from "@playwright/test";
import type { DiscoverItem } from "../lib/discover";
import { canonicalDiscoverVisualUrl, type DiscoverVisualRequest } from "../lib/discoverVisual";
import { discoverVisualFixture } from "../lib/discoverVisual.fixture";
import { openBrowseCategories, seedState, switchLang } from "./helpers";

test("explicit sampled-frame assessments rescue caption-ambiguous category edits and persist without another model call", async ({
  page,
}, testInfo) => {
  const at = new Date().toISOString();
  const items: DiscoverItem[] = [1, 2, 3].map((id) => ({
    platform: "ig",
    // The assessment uses /p/id/ while the candidate store/ranker uses /p/id.
    url: `https://www.instagram.com/reel/VisualSparse${id}/?igsh=reference`,
    title: "#anime",
    snippet: "#anime",
    handle: `visual_editor${id}`,
    lang: "en",
    section: "example",
    evidence: {
      source: "instagram-public-embed",
      author: `visual_editor${id}`,
      caption: "#anime",
      observedAt: at,
      likes: 4000 - id,
    },
  }));
  const requests: DiscoverVisualRequest[] = [];
  const searches: string[] = [];
  const worker = "https://visual-checks.example.workers.dev";
  await page.route(`${worker}/**`, async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/health")
      return route.fulfill({
        headers,
        json: { ok: true, auth: true, tavily: true, discover: true },
      });
    if (pathname === "/discover/usage")
      return route.fulfill({
        headers,
        json: {
          tavily: { used: 0, limit: 1000 },
          youtube: { usedToday: 0, cap: 70 },
          connector: { usedToday: 0, cap: 60 },
        },
      });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(discover|plan)$/.test(new URL(request.url()).pathname))
      searches.push(request.url());
  });
  const source = (item: DiscoverItem) => ({
    status: "available",
    url: canonicalDiscoverVisualUrl(item.url)!,
    title: "#anime",
    description: "#anime",
    thumbnailUrl: "",
    author: item.evidence!.author,
    observedAt: at,
    provenance: "instagram-public-embed",
    likes: item.evidence!.likes,
  });
  await page.route("**/api/local-ai/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/status"))
      return route.fulfill({
        json: {
          available: true,
          providers: {
            chatgpt: {
              connected: true,
              sharing: true,
              accountId: "visual-test",
              models: [{ id: "test-vision", name: "Test Vision", efforts: ["high", "ultra"] }],
            },
            claude: { connected: false, models: [] },
          },
        },
      });
    if (url.pathname.endsWith("/instagram-source")) {
      const item = items.find(
        (item) =>
          canonicalDiscoverVisualUrl(item.url) ===
          canonicalDiscoverVisualUrl(url.searchParams.get("url") ?? ""),
      );
      return route.fulfill({ status: item ? 200 : 404, json: item ? source(item) : {} });
    }
    if (url.pathname.endsWith("/assess-category")) {
      const body = route.request().postDataJSON() as DiscoverVisualRequest;
      requests.push(body);
      expect(body).toMatchObject({
        provider: "chatgpt",
        model: "test-vision",
        effort: "ultra",
        accountId: "visual-test",
        genreId: "anime",
        allowModel: true,
      });
      const item = items.find(
        (item) => canonicalDiscoverVisualUrl(item.url) === canonicalDiscoverVisualUrl(body.url),
      )!;
      const visual = { ...discoverVisualFixture(item, "anime", Date.now()), effort: "ultra" };
      return route.fulfill({
        json: {
          status: "assessed",
          selection: {
            provider: body.provider,
            model: body.model,
            effort: body.effort,
            accountId: body.accountId,
          },
          visual,
          source: source(item),
          cached: false,
          modelCalls: 1,
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await seedState(page, "/discover/", {
    settings: { lang: "en", apiKeys: { scoutUrl: worker, scoutToken: "test-only" } },
    discoverCandidates: items.map((item) => ({ item, genreId: "anime", obtainedAt: at })),
  });
  await expect(page.getByTestId("for-you-feed")).toBeVisible();
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  const feed = page.getByTestId("category-feed");
  await expect(feed).toBeVisible();
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  await expect(feed.getByTestId("feed-card")).toHaveCount(0);
  const checks = page.getByTestId("category-visual");
  await expect(checks).not.toHaveAttribute("open", "");
  expect(requests).toHaveLength(0);
  await checks.locator("summary").click();
  await checks.getByTestId("ai-model").selectOption("test-vision");
  await expect(checks.getByTestId("category-visual-model")).toHaveText(
    "ChatGPT · test-vision · ultra",
  );
  await expect(checks.getByTestId("category-visual-after-lookup")).not.toBeChecked();
  expect(requests).toHaveLength(0);
  await checks.getByTestId("category-visual-assess").click();
  await expect(checks.getByTestId("category-visual-progress")).toContainText("2 assessments saved");
  await expect(feed.getByTestId("feed-card")).toHaveCount(2);
  expect(requests).toHaveLength(2);
  expect(searches).toHaveLength(0);
  const card = feed.getByTestId("feed-card").first();
  await expect(card.getByTestId("feed-source-note")).toContainText("AI checked sampled frames");
  await card.getByTestId("feed-why").locator("summary").click();
  await expect(card.getByTestId("feed-visual-evidence")).toContainText("test-vision · ultra");
  await expect(card.getByTestId("feed-visual-evidence")).toContainText("11.0s");
  await expect(card.getByTestId("feed-visual-evidence")).toContainText(
    "do not establish full motion",
  );
  for (const lang of ["ar", "en"] as const) {
    await switchLang(page, lang);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("sampled-visual-category.png"),
    fullPage: true,
  });
  await page.getByTestId("browse-back").click();
  await expect(page.getByTestId("for-you-feed").getByTestId("feed-card")).toHaveCount(2);
  // The durable library has to carry the visual observation, not just the rendered card.
  await page.reload();
  await expect(page.getByTestId("for-you-feed").getByTestId("feed-card")).toHaveCount(2);
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(feed.getByTestId("feed-card")).toHaveCount(2);
  await expect(checks).not.toHaveAttribute("open", "");
  expect(requests).toHaveLength(2);
  expect(searches).toHaveLength(0);
});
