import { expect, test } from "@playwright/test";
import type { DiscoverItem } from "../lib/discover";
import type { DiscoverSemantic } from "../lib/discoverSemantic";
import { openBrowseCategories, seedState } from "./helpers";

test("week-old caption judgments survive source refresh and reload without another model request", async ({
  page,
}) => {
  const now = Date.now();
  const checkedAt = new Date(now - 7 * 86400000).toISOString();
  const published = new Date(now - 60 * 86400000).toISOString();
  const caption = "We brought this little story to life. #anime";
  const items: DiscoverItem[] = [1, 2].map((id) => ({
    platform: "ig",
    url: `https://www.instagram.com/p/DurableCaption${id}/`,
    title: caption,
    snippet: "",
    handle: `caption_editor${id}`,
    lang: "en",
    section: "example",
    evidence: {
      source: "instagram-public-embed",
      caption,
      author: `caption_editor${id}`,
      availability: "available",
      observedAt: checkedAt,
      published,
      likes: 4000,
    },
  }));
  const semantics: DiscoverSemantic[] = items.map((item, index) => ({
    version: 1,
    url: item.url,
    genreId: "anime",
    checkedAt,
    model: "test-caption",
    effort: "low",
    source: {
      provenance: "instagram-public-embed",
      caption,
      author: item.evidence!.author!,
      observedAt: checkedAt,
    },
    assessment: {
      category: "supported",
      categoryQuote: "#anime",
      project: index === 0 ? "described" : "uncertain",
      projectQuote: index === 0 ? "We brought this little story to life." : "",
      reason: "Synthetic fixture: caption-only assessment, no footage reviewed.",
    },
  }));
  const sourceReads: string[] = [];
  const modelRequests: string[] = [];
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
              accountId: "caption-test",
              models: [{ id: "test-caption", name: "Test Caption", efforts: ["low"] }],
            },
            claude: { connected: false, models: [] },
          },
        },
      });
    if (url.pathname.endsWith("/instagram-source")) {
      const item = items.find((entry) =>
        url.searchParams.get("url")?.includes(entry.url.split("/").filter(Boolean).at(-1)!),
      );
      if (!item) return route.fulfill({ status: 404, json: {} });
      sourceReads.push(item.url);
      return route.fulfill({
        json: {
          status: "available",
          url: item.url,
          title: caption,
          description: caption,
          thumbnailUrl: "",
          author: item.evidence!.author,
          observedAt: new Date(now).toISOString(),
          provenance: "instagram-public-embed",
          likes: 4500,
          published,
        },
      });
    }
    if (route.request().method() === "POST") modelRequests.push(url.pathname);
    return route.fulfill({ status: 404, json: {} });
  });
  await seedState(page, "/discover/", {
    settings: { lang: "en" },
    discoverCandidates: items.map((item, index) => ({
      item,
      genreId: "anime",
      obtainedAt: checkedAt,
      semantic: semantics[index],
    })),
  });
  await expect(page.getByTestId("for-you-feed").getByTestId("feed-card")).toHaveCount(1);
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  const feed = page.getByTestId("category-feed");
  await expect(feed.getByTestId("feed-card")).toHaveCount(1);
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  expect(sourceReads.length).toBeGreaterThan(0);
  await feed.getByTestId("feed-why").locator("summary").click();
  await expect(feed.getByTestId("feed-semantic-evidence")).toContainText("test-caption");
  const checks = page.getByTestId("category-semantic");
  await checks.locator("summary").click();
  await checks.getByTestId("ai-model").selectOption("test-caption");
  await expect(checks.getByTestId("category-semantic-assess")).toBeDisabled();
  await expect(checks).toContainText("No unchecked source captions");
  await page.getByTestId("feed-mode-popular").click();
  await expect(feed.getByTestId("feed-card")).toHaveCount(0);
  await page.getByTestId("feed-mode-learning").click();
  await expect(feed.getByTestId("feed-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("for-you-feed").getByTestId("feed-card")).toHaveCount(1);
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(feed.getByTestId("feed-card")).toHaveCount(1);
  expect(modelRequests).toEqual([]);
});
