import { expect, test } from "@playwright/test";
import type { DiscoverItem } from "../lib/discover";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";
import { instagramShortcodeAt } from "../workers/scout/src/postDate";
import { openBrowseCategories, seedState } from "./helpers";

test("all twelve categories separate finished projects, planned edits and instruction", async ({
  page,
}) => {
  test.setTimeout(90000);
  const at = new Date().toISOString();
  const published = new Date(Date.now() - 86_400_000);
  const candidates = Object.entries(CATEGORY_PROFILES).flatMap(([genreId, profile], genreIndex) => {
    const subject = profile.subject.en;
    return [
      `Cinematic ${subject} film`,
      `I will make a ${subject} montage tomorrow`,
      `Should I make a ${subject} speed ramp?`,
      `5 Easy Steps To Make A Cinematic ${subject} Film`,
    ].map((caption, index) => ({
      genreId,
      obtainedAt: at,
      item: {
        platform: "ig",
        url: `https://www.instagram.com/p/${instagramShortcodeAt(published, genreIndex * 4 + index + 1)}/`,
        handle: `${genreId}_editor${index}`,
        title: caption,
        snippet: "",
        lang: "en",
        section: "example",
        evidence: {
          source: "instagram-public-embed",
          availability: "available",
          caption,
          author: `${genreId}_editor${index}`,
          observedAt: at,
          published: published.toISOString(),
          likes: 50000,
        },
      } satisfies DiscoverItem,
    }));
  });
  const modelRequests: string[] = [];
  await page.route("**/api/local-ai/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/instagram-source")) {
      const found = candidates.find((entry) =>
        url.searchParams.get("url")?.includes(entry.item.url.split("/").filter(Boolean).at(-1)!),
      );
      if (found)
        return route.fulfill({
          json: {
            status: "available",
            url: found.item.url,
            title: found.item.title,
            description: found.item.title,
            thumbnailUrl: "",
            author: found.item.handle,
            observedAt: at,
            provenance: "instagram-public-embed",
            likes: 50000,
          },
        });
    }
    if (route.request().method() === "POST") modelRequests.push(url.pathname);
    return route.fulfill({ status: 404, json: {} });
  });
  await seedState(page, "/discover/", {
    settings: { lang: "en" },
    discoverCandidates: candidates,
  });
  await expect(page.getByTestId("for-you-feed").getByTestId("feed-card")).toHaveCount(12);
  await openBrowseCategories(page);
  await page.getByTestId("genre-cars").click();
  const feed = page.getByTestId("category-feed");
  for (const [genreId, profile] of Object.entries(CATEGORY_PROFILES)) {
    await page
      .getByRole("combobox", { name: "Choose a category", exact: true })
      .selectOption(genreId);
    await page.getByTestId("feed-mode-inspiration").click();
    await expect(feed.getByTestId("feed-card")).toHaveCount(1);
    await expect(
      feed.getByRole("link", { name: `Cinematic ${profile.subject.en} film`, exact: true }),
    ).toBeVisible();
    await page.getByTestId("feed-mode-learning").click();
    await expect(feed.getByTestId("feed-card")).toHaveCount(1);
    await expect(
      feed.getByRole("link", {
        name: `5 Easy Steps To Make A Cinematic ${profile.subject.en} Film`,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByTestId("feed-mode-popular").click();
    await expect(feed.getByTestId("feed-card")).toHaveCount(1);
    await expect(
      feed.getByRole("link", { name: `Cinematic ${profile.subject.en} film`, exact: true }),
    ).toBeVisible();
  }
  expect(modelRequests).toEqual([]);
});
