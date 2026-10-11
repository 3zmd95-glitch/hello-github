import { expect, test } from "@playwright/test";
import { freshState, openBrowseCategories, switchLang } from "./helpers";
import { GENRES } from "../data/genres";

/** Mock the connector only: exercise real app navigation, cards, filters and persistence. */
test("native category batches retain sparse captions, mix platforms and never invent popularity", async ({
  page,
}) => {
  const queries: string[] = [];
  await page.exposeFunction("recordNativeQuery", (query: string) => queries.push(query));
  await page.addInitScript(() => {
    const jobs = new Map<string, Record<string, unknown>>();
    let index = 0;
    const target = window as unknown as {
      chrome?: { runtime?: unknown };
      recordNativeQuery(query: string): Promise<void>;
    };
    target.chrome ??= {};
    target.chrome.runtime = {
      sendMessage(
        _id: string,
        message: { type: string; jobId?: string; queries?: Record<string, string> },
        callback: (value: unknown) => void,
      ) {
        if (message.type === "status") return callback({ ok: true, version: 1, connected: true });
        if (message.type === "search") {
          const jobId = `native-test-${++index}`;
          void target.recordNativeQuery(JSON.stringify(message.queries));
          const platforms = Object.fromEntries(
            ["ig", "tt", "yt"].map((platform) => [
              platform,
              {
                status: "done",
                searchUrl:
                  platform === "ig"
                    ? "https://www.instagram.com/explore/search/keyword/?q=anime%20edit"
                    : platform === "tt"
                      ? "https://www.tiktok.com/search?q=anime%20edit"
                      : "https://www.youtube.com/results?search_query=anime%20edit",
                results: Array.from({ length: 8 }, (_, i) => ({
                  platform,
                  url:
                    platform === "ig"
                      ? `https://www.instagram.com/p/Native${i}/`
                      : platform === "tt"
                        ? `https://www.tiktok.com/@editor/video/769500000000000000${i}`
                        : `https://www.youtube.com/watch?v=NativeEdit${i}`,
                  title: platform === "ig" ? "Instagram" : `${platform} editing reference ${i}`,
                  position: i + 1,
                  observedAt: new Date().toISOString(),
                  displayedStats: "5 likes",
                })),
              },
            ]),
          );
          jobs.set(jobId, { ok: true, jobId, status: "complete", hasMore: false, platforms });
          return callback({ ok: true, jobId });
        }
        if (message.type === "poll") return callback(jobs.get(message.jobId!));
        callback({ ok: true });
      },
    };
  });
  // Public-source fixture is unavailable: native cards must remain, and popularity must stay unknown.
  await page.route("**/api/local-ai/**", (route) => route.fulfill({ status: 404, json: {} }));
  await freshState(page, "/discover/#discover-helper=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await switchLang(page, "en");
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("native-tab-all")).toHaveAttribute("data-count", "24");
  await expect(page.getByTestId("native-tab-ig")).toHaveAttribute("data-count", "8");
  const cards = page.getByTestId("native-result-card");
  await expect(cards).toHaveCount(24);
  await expect(cards.nth(0)).toContainText("Instagram");
  await expect(cards.nth(1)).toContainText("TikTok");
  await expect(cards.nth(2)).toContainText("YouTube");
  await page.getByRole("button", { name: "Popular recently", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.getByTestId("native-search-feed")).toContainText("No received videos meet");
  await page.getByRole("button", { name: "Native search order", exact: true }).click();
  await page.getByTestId("native-tab-ig").click();
  await expect(cards).toHaveCount(8);
  // Every built-in category has a one-selection native search with all platforms requested.
  for (const genre of GENRES.filter((g) => g.id !== "anime")) {
    await page.getByTestId("browse-category-switch").selectOption(genre.id);
    await expect(page.getByTestId("native-tab-all")).toHaveAttribute("data-count", "24");
    await expect(page.getByRole("textbox", { name: "Search all three apps" })).toHaveValue(
      genre.queries.en[0],
    );
  }
  expect(queries).toHaveLength(GENRES.length);
  for (const genre of GENRES)
    expect(queries).toContain(
      JSON.stringify({ ig: genre.queries.en[0], tt: genre.queries.en[0], yt: genre.queries.en[0] }),
    );
  await switchLang(page, "ar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.reload();
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("native-tab-all")).toHaveAttribute("data-count", "24");
  expect(queries).toHaveLength(GENRES.length);
});
