import { expect, test } from "@playwright/test";
import { freshState, openBrowseCategories, switchLang } from "./helpers";
import { GENRES } from "../data/genres";
import { nativeCategoryQuery } from "../lib/genres";

test("one downward gesture continues small category batches, then stops at the source end", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.exposeFunction("recordContinuousRequest", (type: string) => requests.push(type));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => {
    let count = 1;
    let running = 0;
    const target = window as unknown as {
      chrome?: { runtime?: unknown };
      recordContinuousRequest(type: string): Promise<void>;
    };
    target.chrome ??= {};
    const job = () => ({
      ok: true,
      jobId: "continuous-category",
      status: running ? "running" : "complete",
      hasMore: count < 3,
      platforms: {
        ig: {
          status: running ? "loading" : "done",
          searchUrl: "https://www.instagram.com/explore/search/keyword/?q=anime%20edit",
          results: Array.from({ length: count }, (_, index) => ({
            platform: "ig",
            url: `https://www.instagram.com/p/Continuous${index}/`,
            title: `Same category video ${index}`,
            position: index + 1,
            observedAt: new Date().toISOString(),
          })),
        },
      },
    });
    target.chrome.runtime = {
      sendMessage(_id: string, message: { type: string }, callback: (value: unknown) => void) {
        if (message.type === "status") return callback({ ok: true, version: 1, connected: true });
        if (message.type === "search") {
          void target.recordContinuousRequest("search");
          return callback({ ok: true, jobId: "continuous-category" });
        }
        if (message.type === "more") {
          void target.recordContinuousRequest("more");
          running = Date.now() + 700;
          return callback(job());
        }
        if (message.type === "poll") {
          if (running && Date.now() >= running) {
            running = 0;
            count++;
          }
          return callback(job());
        }
        return callback({ ok: true });
      },
    };
  });
  await freshState(page, "/discover/#discover-helper=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await switchLang(page, "en");
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("native-search-run")).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByTestId("native-search-run").click();
  await expect(page.getByTestId("native-result-card")).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(page.getByTestId("native-scroll-loading")).toBeVisible();
  await expect(page.getByTestId("native-result-card")).toHaveCount(3);
  await expect(page.getByTestId("browse-category-switch")).toHaveValue("anime");
  await expect(page.getByTestId("native-search-more")).toHaveCount(0);
  expect(requests).toEqual(["search", "more", "more"]);
});

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
  await page.getByTestId("native-search-run").click();
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
    if (genre.id !== "anime") await page.getByTestId("native-search-run").click();
    await expect(page.getByTestId("native-tab-all")).toHaveAttribute("data-count", "24");
    await expect(page.getByRole("textbox", { name: "Search all three apps" })).toHaveValue(
      nativeCategoryQuery(genre),
    );
  }
  expect(queries).toHaveLength(GENRES.length);
  for (const genre of GENRES)
    expect(queries).toContain(
      JSON.stringify({
        ig: nativeCategoryQuery(genre),
        tt: nativeCategoryQuery(genre),
        yt: nativeCategoryQuery(genre),
      }),
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

test("native videos continue loading on downward scrolling without pressing Load more", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.exposeFunction("recordScrollRequest", (type: string) => requests.push(type));
  await page.addInitScript(() => {
    let count = 12;
    const target = window as unknown as {
      chrome?: { runtime?: unknown };
      recordScrollRequest(type: string): Promise<void>;
    };
    target.chrome ??= {};
    // The helper answers poll and more with the full job snapshot. A real continuation keeps the
    // job running for seconds, so scroll events from the same gesture arrive while it is busy.
    let running = 0;
    const job = () => ({
      ok: true,
      jobId: "scroll-job",
      status: running > Date.now() ? "running" : "complete",
      hasMore: true,
      platforms: {
        ig: {
          status: "done",
          searchUrl: "https://www.instagram.com/explore/search/keyword/?q=anime%20edit",
          results: Array.from({ length: count }, (_, index) => ({
            platform: "ig",
            url: `https://www.instagram.com/p/Scroll${index}/`,
            title: `Native editing reference ${index}`,
            position: index + 1,
            observedAt: new Date().toISOString(),
          })),
        },
      },
    });
    target.chrome.runtime = {
      sendMessage(_id: string, message: { type: string }, callback: (value: unknown) => void) {
        if (message.type === "status") return callback({ ok: true, version: 1, connected: true });
        if (message.type === "search") {
          void target.recordScrollRequest("search");
          return callback({ ok: true, jobId: "scroll-job" });
        }
        if (message.type === "more") {
          running = Date.now() + 700;
          void target.recordScrollRequest("more");
          return callback(job());
        }
        if (message.type === "poll") {
          if (running && running <= Date.now()) {
            running = 0;
            count += 12;
          }
          return callback(job());
        }
        callback({ ok: true });
      },
    };
  });
  await page.route("**/api/local-ai/**", (route) => route.fulfill({ status: 404, json: {} }));
  await freshState(page, "/discover/#discover-helper=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await switchLang(page, "en");
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await page.getByTestId("native-search-run").click();
  const cards = page.getByTestId("native-result-card");
  await expect(cards).toHaveCount(12);
  expect(requests).toEqual(["search"]);
  for (let batch = 1; batch <= 3; batch++) {
    await page.keyboard.press("End");
    await expect(cards).toHaveCount(12 + batch * 12);
    await expect.poll(() => requests.filter((type) => type === "more").length).toBe(batch);
  }
  // A stationary end marker must not spend requests after scrolling stops.
  await page.waitForTimeout(500);
  expect(requests.filter((type) => type === "more")).toHaveLength(3);
  await expect(page.getByTestId("native-search-more")).toBeEnabled();
});

test("source tabs require a button on entry, after deep search and after reload", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.exposeFunction("recordManualSourceRequest", (type: string) => requests.push(type));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort(),
  );
  await page.addInitScript(() => {
    const target = window as unknown as {
      chrome?: { runtime?: unknown };
      recordManualSourceRequest(type: string): Promise<void>;
    };
    target.chrome ??= {};
    const job = () => ({
      ok: true,
      jobId: "manual-sources",
      status: "complete",
      hasMore: true,
      platforms: {
        ig: {
          status: "done",
          searchUrl: "https://www.instagram.com/explore/search/keyword/?q=anime%20edit",
          results: [
            {
              platform: "ig",
              url: "https://www.instagram.com/p/ManualSources/",
              title: "Explicit source result",
              position: 1,
              observedAt: new Date().toISOString(),
            },
          ],
        },
      },
    });
    target.chrome.runtime = {
      sendMessage(
        _id: string,
        message: { type: string; deep?: boolean },
        callback: (v: unknown) => void,
      ) {
        if (message.type === "status") return callback({ ok: true, version: 1, connected: true });
        if (message.type === "search") {
          void target.recordManualSourceRequest(message.deep ? "show" : "background");
          return callback({ ok: true, jobId: "manual-sources" });
        }
        if (message.type === "more") void target.recordManualSourceRequest("more");
        callback(message.type === "poll" || message.type === "more" ? job() : { ok: true });
      },
    };
  });
  await freshState(page, "/discover/#discover-helper=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await switchLang(page, "en");
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("native-deep-search")).toHaveText("Open and show source tabs");
  await page.screenshot({ path: test.info().outputPath("manual-source-buttons.png") });
  await page.keyboard.press("End");
  expect(requests).toEqual([]);
  await page.getByTestId("native-deep-search").click();
  await expect(page.getByTestId("native-result-card")).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(page.getByTestId("native-search-more")).toHaveText("Open source tabs for more");
  await expect(page.getByTestId("native-scroll-loading")).toHaveCount(0);
  expect(requests).toEqual(["show"]);
  await page.reload();
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("native-result-card")).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(page.getByTestId("native-search-more")).toHaveText("Open source tabs for more");
  expect(requests).toEqual(["show"]);
  await page.getByTestId("native-search-more").click();
  await expect.poll(() => requests.length).toBeGreaterThan(1);
  expect(requests[1]).toBe("show");
});
