import { expect, test } from "@playwright/test";
import { openBrowseCategories, seedState, switchLang } from "./helpers";
import type { DiscoverItem } from "../lib/discover";
import { creatorProjects } from "../workers/scout/src/categories/creatorProjects.fixture";
import { soundtrackResource } from "../workers/scout/src/categories/soundtrackResource.fixture";

test("creator uploads are explicit, bounded, source grounded and cached across feed navigation", async ({
  page,
}) => {
  const at = new Date().toISOString();
  const worker = "https://creator-fixture.example.workers.dev";
  const channel = (id: number) => `UC${String(id).padStart(22, "A")}`;
  const videoId = (id: number) => `Creator${String(id).padStart(4, "0")}`;
  const video = (id: number, title: string, views: number, creator = id): DiscoverItem => ({
    platform: "yt",
    url: `https://www.youtube.com/watch?v=${videoId(id)}`,
    title,
    snippet: "",
    handle: `Editor ${creator}`,
    profile: `https://www.youtube.com/channel/${channel(creator)}`,
    thumb: `https://i.ytimg.com/vi/${videoId(id)}/hqdefault.jpg`,
    lang: "en",
    section: "example",
    evidence: {
      source: "youtube-api",
      author: `Editor ${creator}`,
      caption: title,
      observedAt: at,
      published: at,
      views,
    },
  });
  const initial = Array.from({ length: 30 }, (_, id) =>
    video(id, `Anime velocity edit ${id}`, id ? 90_000 : 6000),
  );
  const children = [
    video(101, "Anime velocity beat sync masking edit", 900_000, 0),
    video(102, "Anime velocity edit low", 5, 0),
    video(103, "Coffee latte art guide", 200_000, 0),
  ];
  const posts = [...initial, ...children];
  const api: URL[] = [];
  const paid: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/search") || /\/(discover|plan|assess-category)$/.test(url.pathname))
      paid.push(request.url());
  });
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  await page.route(`${worker}/**`, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      headers: cors,
      json:
        path === "/health"
          ? { ok: true, auth: true, discover: true, tavily: true }
          : path === "/discover/usage"
            ? {
                tavily: { used: 0, limit: 1000 },
                youtube: { usedToday: 0, cap: 70 },
                connector: { usedToday: 0, cap: 60 },
              }
            : {},
    });
  });
  await page.route("https://www.googleapis.com/youtube/v3/**", async (route) => {
    const url = new URL(route.request().url());
    api.push(url);
    expect(url.searchParams.get("key")).toBe("test-youtube-key");
    expect(url.pathname).not.toContain("search");
    if (url.pathname.endsWith("/channels"))
      return route.fulfill({
        headers: cors,
        json: {
          items: [
            {
              id: channel(0),
              contentDetails: { relatedPlaylists: { uploads: `UU${channel(0).slice(2)}` } },
            },
          ],
        },
      });
    if (url.pathname.endsWith("/playlistItems")) {
      expect(url.searchParams.get("maxResults")).toBe("12");
      expect(url.searchParams.has("pageToken")).toBe(false);
      return route.fulfill({
        headers: cors,
        json: {
          items: [0, 101, 102, 103, 101].map((id) => ({
            contentDetails: { videoId: videoId(id) },
          })),
        },
      });
    }
    const ids = new Set(url.searchParams.get("id")?.split(","));
    return route.fulfill({
      headers: cors,
      json: {
        items: posts
          .filter((item) => ids.has(new URL(item.url).searchParams.get("v")!))
          .map((item) => ({
            id: new URL(item.url).searchParams.get("v"),
            snippet: {
              title: item.title,
              description: "",
              channelTitle: item.handle,
              channelId: item.profile!.split("/").at(-1),
              publishedAt: at,
            },
            statistics: { viewCount: String(item.evidence!.views) },
            status: { privacyStatus: "public", uploadStatus: "processed" },
          })),
      },
    });
  });
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 404, body: "" }));
  await seedState(page, "/discover/", {
    settings: {
      lang: "en",
      apiKeys: { scoutUrl: worker, scoutToken: "fixture", youtube: "test-youtube-key" },
    },
    discoverCandidates: initial.map((item) => ({ item, genreId: "anime", obtainedAt: at })),
  });
  await expect(page.getByTestId("for-you-feed")).toBeVisible();
  expect(api).toHaveLength(0);
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  await expect.poll(() => api.length).toBe(1); // Existing public source hydration, no creator acquisition.
  await page.getByTestId("browse-back").click();
  const feed = page.getByTestId("for-you-feed");
  while (await feed.getByTestId("feed-show-more").isVisible())
    await feed.getByTestId("feed-show-more").click();
  const seed = feed
    .getByTestId("feed-card")
    .filter({ has: page.locator(`a[href="${initial[0].url}"]`) });
  await expect(seed).toHaveCount(1);
  const before = api.length;
  await seed.getByTestId("feed-more-creator").click();
  await expect(feed.getByTestId("feed-creator-status")).toContainText(
    "5 uploads checked · 3 new references kept · 1 match",
  );
  expect(api.length - before).toBe(4);
  await expect(seed).toHaveCount(0); // Stronger new upload displaced the seed from the visible 30.
  const child = feed.getByTestId("feed-card").filter({
    has: page
      .getByTestId("result-title")
      .filter({ hasText: "Anime velocity beat sync masking edit" }),
  });
  await expect(child).toBeVisible();
  await expect(
    feed.getByTestId("result-title").filter({ hasText: "Anime velocity edit low" }),
  ).toHaveCount(0);
  await expect(
    feed.getByTestId("result-title").filter({ hasText: "Coffee latte art guide" }),
  ).toHaveCount(0);
  await child.getByTestId("feed-more-creator").click();
  await expect(feed.getByTestId("feed-creator-status")).toContainText(
    "0 new references kept · 0 match",
  );
  await expect(feed.getByTestId("feed-creator-status")).toContainText("cached check");
  expect(api.length - before).toBe(4);
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  expect(api.length - before).toBe(4); // Acquisition primed the real useFeedSources cache.
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
  await page.reload();
  await expect(
    page
      .getByTestId("for-you-feed")
      .getByTestId("result-title")
      .filter({ hasText: "Anime velocity beat sync masking edit" }),
  ).toBeVisible();
  expect(api.length - before).toBe(4);
  expect(paid).toHaveLength(0);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1")!).state);
  expect(state.discoverFeedback ?? []).toEqual([]);
  expect(state.inspirations ?? []).toEqual([]);
});

test("native descriptions separate finished edits, lessons, ambience and audio resources", async ({
  page,
}) => {
  // Keep the captured Oct 7 post recent so Popular cannot pass only because it aged out.
  const observed = new Date("2026-10-09T12:00:00Z");
  await page.clock.setFixedTime(observed);
  const at = observed.toISOString();
  const worker = "https://classification-fixture.example.workers.dev";
  const records = [
    ...creatorProjects.map((project) => ({ ...project, genreId: "anime" })),
    // Preserve the captured publication date; synthetic controls use the fixed test clock.
    { ...soundtrackResource, genreId: "travel" },
    {
      id: "MaskLesson1",
      genreId: "anime",
      author: "Editing teacher",
      title: "Anime masking tutorial in After Effects",
      views: 75,
      published: at,
      description: `How to animate the mask: trace the outline, then keyframe its shape.\n${creatorProjects[1].description}`,
    },
    {
      id: "VelocityT01",
      genreId: "anime",
      author: "Velocity teacher",
      title: "Anime velocity tutorial in After Effects",
      views: 90,
      published: at,
      description: `How to make anime velocity edits: enable Time Remapping, add keyframes on each beat, then adjust the speed graph.

Keywords & Hashtags:
anime editing tips, anime velocity tutorial

Tutorial Channel :- https://youtu.be/MaskLesson1`,
    },
    {
      id: "Amh5NZMkf3I",
      genreId: "coffee",
      author: "REST EASY FILMS",
      title:
        "CAFÉ in 4K | 2 Hours | Real Cafe B-Roll Footage Relaxing Jazz Music Coffee Shop Vibes Ambience LoFi",
      views: 206500,
      published: "2022-10-18T12:00:00Z",
      description:
        "Enjoy beautiful footage of cafes, baristas, and latte art with relaxing coffee shop ambient sounds and jazz music. Play in the background as you work, study, meditate, exercise, work out, sleep, rest, focus, de-stress, or relax.",
    },
    {
      id: "CoffeeFilm1",
      genreId: "coffee",
      author: "Coffee filmmaker",
      title: "Coffee match cut film",
      views: 60_000,
      published: at,
      description:
        "A cinematic coffee match cut film with recorded café ambient sounds and sound design.",
    },
    {
      id: "CoffeeLearn",
      genreId: "coffee",
      author: "Coffee teacher",
      title: "Coffee lighting tutorial",
      views: 50,
      published: at,
      description:
        "How to light coffee B-roll: put a soft light behind the cup, then adjust the fill card step by step.",
    },
    {
      id: "TravelFilm1",
      genreId: "travel",
      author: "Travel filmmaker",
      title: "Iceland slow motion travel film",
      views: 60_000,
      published: at,
      description:
        "A cinematic travel film I shot and edited in Iceland, using slow motion and match cuts between the waterfalls and mountains.",
    },
    {
      id: "TravelLearn",
      genreId: "travel",
      author: "Travel teacher",
      title: "Travel slow motion tutorial in DaVinci Resolve",
      views: 50,
      published: at,
      description:
        "How to edit travel footage in slow motion: set the timeline frame rate, conform the clip, then adjust the retime curve step by step.",
    },
  ];
  const paid: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/(search|discover|plan|assess-category|channels|playlistItems)$/.test(path))
      paid.push(request.url());
  });
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  await page.route(`${worker}/**`, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      headers: cors,
      json:
        path === "/health"
          ? { ok: true, auth: true, discover: true, tavily: true }
          : path === "/discover/usage"
            ? {
                tavily: { used: 0, limit: 1000 },
                youtube: { usedToday: 0, cap: 70 },
                connector: { usedToday: 0, cap: 60 },
              }
            : {},
    });
  });
  await page.route("https://www.googleapis.com/youtube/v3/**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.pathname.endsWith("/videos")).toBe(true);
    const ids = new Set(url.searchParams.get("id")?.split(","));
    return route.fulfill({
      headers: cors,
      json: {
        items: records
          .filter((row) => ids.has(row.id))
          .map((row) => ({
            id: row.id,
            snippet: {
              title: row.title,
              description: row.description,
              channelTitle: row.author,
              channelId: `UC${row.id.padStart(22, "A")}`,
              publishedAt: row.published,
            },
            statistics: { viewCount: String(row.views) },
            status: { privacyStatus: "public", uploadStatus: "processed" },
          })),
      },
    });
  });
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 404, body: "" }));
  await seedState(page, "/discover/", {
    settings: {
      lang: "en",
      apiKeys: { scoutUrl: worker, scoutToken: "fixture", youtube: "test-youtube-key" },
    },
    discoverCandidates: records.map((row) => ({
      genreId: row.genreId,
      obtainedAt: at,
      item: {
        platform: "yt",
        url: `https://www.youtube.com/watch?v=${row.id}`,
        handle: row.author,
        title: row.title,
        snippet: row.description,
        lang: "en",
        // Reproduce the stale upstream section. Native post evidence must decide the actual lane.
        section: "tutorial",
        evidence: {
          source: "youtube-api",
          caption: `${row.title} ${row.description}`,
          author: row.author,
          observedAt: at,
          views: row.views,
          published: row.published,
        },
      },
    })),
  });
  await expect(page.getByTestId("for-you-feed")).toBeVisible();
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  const feed = page.getByTestId("category-feed");
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  await expect(feed.getByTestId("feed-card")).toHaveCount(creatorProjects.length);
  for (const project of creatorProjects)
    await expect(feed.getByTestId("result-title").filter({ hasText: project.title })).toBeVisible();
  await feed.getByTestId("feed-mode-learning").click();
  await expect(feed.getByTestId("result-title")).toHaveCount(2);
  for (const title of [
    "Anime masking tutorial in After Effects",
    "Anime velocity tutorial in After Effects",
  ])
    await expect(feed.getByTestId("result-title").filter({ hasText: title })).toBeVisible();
  await page.getByTestId("browse-category-switch").selectOption("coffee");
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  await expect(feed.getByTestId("result-title")).toHaveText("Coffee match cut film");
  for (const mode of ["popular", "learning", "explore", "inspiration"]) {
    await feed.getByTestId(`feed-mode-${mode}`).click();
    await expect(feed.locator('a[href="https://www.youtube.com/watch?v=Amh5NZMkf3I"]')).toHaveCount(
      0,
    );
    if (mode === "learning")
      await expect(feed.getByTestId("result-title")).toHaveText("Coffee lighting tutorial");
  }
  await page.getByTestId("browse-category-switch").selectOption("travel");
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  for (const mode of ["inspiration", "popular", "learning"]) {
    await feed.getByTestId(`feed-mode-${mode}`).click();
    await expect(feed.locator('a[href="https://www.youtube.com/watch?v=Vwk6nYu3nho"]')).toHaveCount(
      0,
    );
    await expect(feed.getByTestId("result-title")).toHaveText(
      mode === "learning"
        ? "Travel slow motion tutorial in DaVinci Resolve"
        : "Iceland slow motion travel film",
    );
  }
  // Excluding a soundtrack from editing recommendations must not delete the stored reference.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open("3z-prod-discover");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const database = request.result;
              const read = database
                .transaction("candidates")
                .objectStore("candidates")
                .get("corpus");
              read.onerror = () => {
                database.close();
                reject(read.error);
              };
              read.onsuccess = () => {
                const retained = read.result?.candidates?.some(
                  (row: { genreId: string; item: { url: string } }) =>
                    row.genreId === "travel" && row.item.url.includes("Vwk6nYu3nho"),
                );
                database.close();
                resolve(Boolean(retained));
              };
            };
          }),
      ),
    )
    .toBe(true);
  expect(paid).toEqual([]);
});
