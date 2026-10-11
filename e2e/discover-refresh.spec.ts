import { expect, test } from "@playwright/test";
import { DISCOVER_QUALITY_VERSION, type DiscoverItem } from "../lib/discover";
import { openBrowseCategories, seedState, switchLang } from "./helpers";

test("category refresh combines bounded native batches, counts qualified additions and keeps them after reload", async ({
  page,
}, testInfo) => {
  const at = new Date().toISOString();
  const worker = "https://refresh-fixture.example.workers.dev";
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const youtube = (id: string, published: string): DiscoverItem => ({
    platform: "yt",
    url: `https://www.youtube.com/watch?v=${id}`,
    handle: id,
    title: "Coffee match cut film",
    snippet: "Coffee match cut film",
    lang: "en",
    section: "example",
    evidence: {
      source: "youtube-api",
      author: id,
      caption: "Coffee match cut film",
      observedAt: at,
      published,
      views: 60_000,
    },
  });
  const old = youtube("OldCoffee01", "2025-01-01T00:00:00.000Z");
  const fresh = youtube("NewCoffee01", at);
  const tt: DiscoverItem = {
    platform: "tt",
    url: `https://www.tiktok.com/@refresh_editor/video/${BigInt(Math.floor(Date.now() / 1000)) << BigInt(32)}`,
    handle: "refresh_editor",
    title: "Coffee match cut film",
    snippet: "Coffee match cut film",
    lang: "en",
    section: "example",
  };
  const requested: string[] = [];
  const models: string[] = [];
  let releaseSource!: () => void;
  const sourceHold = new Promise<void>((resolve) => {
    releaseSource = resolve;
  });
  await page.route("**/api/local-ai/**", async (route) => {
    const url = new URL(route.request().url());
    if (/assess|plan/.test(url.pathname)) models.push(url.pathname);
    if (url.pathname.endsWith("/tiktok-source")) {
      await sourceHold;
      return route.fulfill({
        json: {
          status: "available",
          url: tt.url,
          provenance: "tiktok-public-page",
          author: tt.handle,
          caption: tt.title,
          observedAt: at,
          published: at,
          likes: 12_000,
          views: 90_000,
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${worker}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    const reply = (json: unknown) => route.fulfill({ headers: cors, json });
    if (path === "/health") return reply({ ok: true, auth: true, discover: true, tavily: true });
    if (path === "/discover/usage")
      return reply({
        tavily: { used: 1000, limit: 1000 },
        youtube: { usedToday: 0, cap: 66 },
        connector: { usedToday: 0, cap: 60 },
      });
    if (path.endsWith("/native/tt/acquire")) {
      requested.push("tt");
      expect(req.postDataJSON()).toEqual({ country: "US", excludeVideoIds: [] });
      return reply({
        version: 1,
        categoryId: "coffee",
        country: "US",
        dateRange: "7DAY",
        checkedAt: at,
        status: "accepted",
        captioned: 1,
        items: [tt],
        supply: { matchedHashtags: 1, videoCandidates: 1, unseenRemaining: 0, skippedKnown: 0 },
      });
    }
    if (path === "/discover") {
      requested.push("yt");
      expect(requested).toEqual(["tt", "yt"]);
      expect(req.postDataJSON()).toMatchObject({
        platforms: ["yt"],
        exact: true,
        timeRange: "month",
      });
      expect(req.postDataJSON().mode).toBeUndefined();
      return reply({
        qualityVersion: DISCOVER_QUALITY_VERSION,
        topicKey: "coffee",
        understood: { label: { ar: "قهوة", en: "coffee" }, exact: true },
        alternatives: [],
        items: [fresh],
        creators: [],
        platforms: { yt: { ok: true } },
        cost: { tavily: 0, youtubeSearch: 1 },
        cached: false,
        complete: true,
      });
    }
    return route.fulfill({ status: 404, headers: cors, json: {} });
  });
  await seedState(page, "/discover/", {
    settings: { lang: "en", apiKeys: { scoutUrl: worker, scoutToken: "fixture" } },
    discoverCandidates: [{ item: old, genreId: "coffee", obtainedAt: at }],
  });
  await openBrowseCategories(page);
  await page.getByTestId("genre-coffee").click();
  const feed = page.getByTestId("category-feed");
  await expect(feed.getByTestId("feed-card")).toHaveCount(1);
  const refresh = page.getByTestId("category-refresh");
  await expect(page.getByTestId("feed-indexed-options")).not.toHaveAttribute("open", "");
  expect(requested).toEqual([]);
  await refresh.getByTestId("category-refresh-run").click();
  await expect(refresh.getByTestId("category-refresh-result")).toContainText("Returned: 2");
  await expect(refresh.getByTestId("category-refresh-result")).toContainText(
    "1 Inspiration · 1 Popular recently",
  );
  await expect(feed.getByTestId("feed-card")).toHaveCount(2);
  releaseSource();
  await expect(refresh.getByTestId("category-refresh-result")).toContainText(
    "2 Inspiration · 2 Popular recently",
  );
  await expect(feed.getByTestId("feed-card")).toHaveCount(3);
  await page.getByTestId("feed-mode-popular").click();
  await expect(feed.getByTestId("feed-card")).toHaveCount(2);
  await page.getByTestId("browse-tab-ig").click();
  await expect(refresh.getByTestId("category-refresh-run")).toHaveCount(0);
  await expect(refresh.getByTestId("category-refresh-instagram")).toHaveAttribute(
    "href",
    /instagram\.com.*coffee/,
  );
  await expect(refresh).toContainText("pinned Discover helper");
  for (const lang of ["ar", "en"] as const) {
    await switchLang(page, lang);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
  expect(requested).toEqual(["tt", "yt"]);
  expect(models).toEqual([]);
  await page.reload();
  await openBrowseCategories(page);
  await page.getByTestId("genre-coffee").click();
  await expect(feed.getByTestId("feed-card")).toHaveCount(3);
  expect(requested).toEqual(["tt", "yt"]);
  expect(models).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("category-refresh.png"), fullPage: true });
});
