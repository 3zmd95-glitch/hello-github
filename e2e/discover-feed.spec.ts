import { expect, test } from "@playwright/test";
import { freshState, switchLang, openBrowseCategories } from "./helpers";
import { DISCOVER_QUALITY_VERSION } from "../lib/discover";

const WORKER = "https://editor-feed.example.workers.dev";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("category feed separates popularity and learning, remembers feedback, and fits English and Arabic", async ({
  page,
}) => {
  const at = new Date().toISOString();
  const image = "https://i.ytimg.com/vi/feedPreview/hqdefault.jpg";
  const yt = (id: string, title: string, views: number) => ({
    platform: "yt",
    handle: `@${id}`,
    title,
    snippet: title,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumb: image,
    lang: "en",
    section: "example",
    published: at,
    stats: { views },
    evidence: {
      source: "youtube-api",
      observedAt: at,
      caption: title,
      author: `@${id}`,
      views,
      published: at,
    },
  });
  const lowUrl = "https://www.instagram.com/p/AnimeLowFive";
  const items = [
    yt("animePopular", "Anime beat sync edit", 40_000),
    yt("animeLesson", "Anime masking tutorial step by step", 80),
    {
      platform: "tt",
      handle: "@animeeditor",
      title: "Anime velocity edit",
      snippet: "Anime velocity edit",
      url: "https://www.tiktok.com/@animeeditor/video/1234567890123456789",
      thumb: image,
      published: at,
      lang: "en",
      section: "example",
      stats: { views: 20_000 },
    },
    {
      platform: "ig",
      handle: "@small",
      title: "Anime beat sync edit",
      snippet: "Anime beat sync edit",
      url: lowUrl,
      thumb: image,
      published: at,
      lang: "en",
      section: "example",
      stats: { likes: 5_000_000 },
    },
  ];
  const asked: unknown[] = [];
  await page.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG }),
  );
  await page.route("**/api/local-ai/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/api/local-ai/instagram-source" &&
      url.searchParams.get("url")?.includes("AnimeLowFive")
    ) {
      await route.fulfill({
        json: {
          status: "available",
          url: lowUrl,
          title: "Anime beat sync edit",
          description: "Anime beat sync edit",
          thumbnailUrl: "",
          observedAt: at,
          provenance: "instagram-public-embed",
          author: "@small",
          likes: 5,
        },
      });
    } else if (url.pathname === "/api/local-ai/tiktok-source") {
      await route.fulfill({
        json: {
          status: "available",
          url: "https://www.tiktok.com/@animeeditor/video/1234567890123456789",
          observedAt: at,
          provenance: "tiktok-public-page",
          author: "animeeditor",
          caption: "Anime velocity edit",
          views: 20_000,
          published: at,
        },
      });
    } else await route.fulfill({ status: 404, json: {} });
  });
  await page.route(`${WORKER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: CORS });
    const reply = (body: unknown) => route.fulfill({ headers: CORS, json: body });
    if (url.pathname === "/health")
      return reply({ ok: true, auth: true, tavily: true, discover: true });
    if (url.pathname === "/discover") {
      asked.push(route.request().postDataJSON());
      return reply({
        qualityVersion: DISCOVER_QUALITY_VERSION,
        topicKey: "anime",
        understood: { label: { en: "Anime", ar: "أنمي" }, exact: false },
        alternatives: [],
        items,
        creators: [],
        platforms:
          asked.length > 1
            ? {
                yt: { ok: true },
                ig: { ok: false, error: "quota" },
                tt: { ok: true, partial: "upstream" },
              }
            : { yt: { ok: true }, ig: { ok: true }, tt: { ok: true } },
        cost: { tavily: 1, youtubeSearch: 1 },
        cached: false,
        complete: true,
      });
    }
    if (url.pathname === "/discover/usage")
      return reply({
        tavily: { used: 0, limit: 1000 },
        youtube: { usedToday: 0, cap: 70 },
        connector: { usedToday: 0, cap: 60 },
      });
    return route.fulfill({ status: 404, headers: CORS, json: {} });
  });
  await freshState(page, "/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await page.getByTestId("apikey-scoutToken-input").fill("test-token");
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓");
  await page.goto("/discover/");
  await page.getByTestId("genre-anime").click();
  const feed = page.getByTestId("category-feed");
  await expect(feed).toBeVisible();
  await expect(page.getByTestId("feed-checking")).toHaveCount(0);
  await expect(page.getByTestId("feed-card")).toHaveCount(2);
  await expect(page.getByTestId("browse-tab-ig")).toHaveAttribute("data-count", "0");
  await expect(page.getByTestId("inspiration-explore")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("research-bar")).toBeHidden();
  await page.getByTestId("feed-mode-popular").click();
  await expect(page.getByTestId("feed-card")).toHaveCount(1);
  await page.getByTestId("feed-mode-learning").click();
  await expect(feed.getByTestId("result-title")).toHaveText("Anime masking tutorial step by step");
  await page.getByTestId("feed-mode-explore").click();
  const low = page.getByTestId("feed-card").filter({ has: page.locator(`a[href="${lowUrl}"]`) });
  await expect(low.getByTestId("result-stats")).toHaveAttribute("data-likes", "5");
  await low.getByTestId("feed-not-useful").click();
  await expect(low).toHaveCount(0);
  await page.getByTestId("feed-undo").click();
  await expect(low).toBeVisible();
  await page.getByTestId("feed-mode-inspiration").click();
  const first = page.getByTestId("feed-card").first();
  const hiddenTitle = await first.getByTestId("result-title").textContent();
  await first.getByTestId("feed-hide-creator").click();
  await expect(page.getByTestId("feed-card")).toHaveCount(1);
  await page.reload();
  const forYou = page.getByTestId("for-you-feed");
  await expect(forYou).toBeVisible();
  await expect(forYou.getByTestId("feed-card")).toHaveCount(1);
  await expect(forYou.getByTestId("result-title")).not.toHaveText(hiddenTitle!);
  await expect(forYou.getByTestId("feed-find-more")).toHaveCount(0);
  await expect(page.getByTestId("browse-formats")).not.toHaveAttribute("open", "");
  expect(asked).toHaveLength(1);
  await openBrowseCategories(page);
  await page.getByTestId("genre-anime").click();
  await expect(feed).toBeVisible();
  await expect(page.getByTestId("feed-card")).toHaveCount(1);
  await expect(feed.getByTestId("result-title")).not.toHaveText(hiddenTitle!);
  expect(asked).toHaveLength(1);
  await expect(page.getByTestId("feed-refill-options")).not.toHaveAttribute("open", "");
  await page.getByTestId("feed-refill-options").locator("summary").click();
  expect(asked).toHaveLength(1);
  await page.getByTestId("feed-refill").click();
  await expect(page.getByTestId("feed-search-yt")).toContainText("نتيجة محفوظة من قبل");
  await expect(page.getByTestId("feed-card")).toHaveCount(1);
  expect(asked).toHaveLength(1);
  await page.getByTestId("feed-find-more").click();
  await expect(page.getByTestId("feed-search-ig")).toHaveAttribute("data-error", "quota");
  await expect(page.getByTestId("feed-search-tt")).toHaveAttribute("data-state", "partial");
  await expect(page.getByTestId("feed-card")).toHaveCount(1);
  await expect(page.getByTestId("feed-find-more")).toBeDisabled();
  await expect(page.getByTestId("feed-refill")).toBeEnabled();
  for (const lang of ["en", "ar"] as const) {
    await switchLang(page, lang);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await expect(page.getByTestId("feed-mode-inspiration")).toHaveText(
      lang === "en" ? "Inspiration" : "إلهام",
    );
    await expect(page.getByTestId("feed-search-ig")).toContainText(
      lang === "en" ? "Search allowance reached" : "وصلنا لحدّ عمليات البحث",
    );
  }
  await page.getByTestId("feed-refill").click();
  await expect(page.getByTestId("feed-search-yt")).toContainText("نتيجة محفوظة من قبل");
  await expect(page.getByTestId("feed-find-more")).toBeDisabled();
  await expect(page.getByTestId("feed-card")).toHaveCount(1);
  expect(asked).toHaveLength(2);

  const manualUrl = "https://www.instagram.com/p/NativeManual1";
  await expect(page.getByTestId("feed-add-reference")).not.toHaveAttribute("open", "");
  await page.getByTestId("feed-add-reference").locator("summary").click();
  await page
    .getByTestId("feed-reference-url")
    .fill("https://www.instagram.com/reel/NativeManual1/?igsh=tracking");
  await page.getByTestId("feed-reference-label").fill("My native-feed reference");
  await page.getByTestId("feed-reference-note").fill("أجرّب توقيت الانتقال");
  await page.getByTestId("feed-reference-keep").check();
  await page.getByTestId("feed-reference-submit").click();
  const personal = page
    .getByTestId("feed-card")
    .filter({ has: page.locator(`a[href="${manualUrl}"]`) });
  await expect(personal.getByTestId("feed-personal-choice")).toBeVisible();
  await expect(personal.getByTestId("feed-source-note")).toContainText("مو متحقَّق");
  await expect(page.getByTestId("feed-reference-saved")).toBeVisible();
  expect(asked).toHaveLength(2);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByTestId("for-you-feed").getByTestId("feed-personal-choice")).toHaveCount(1);
  await page.getByTestId("inspiration-library-open").click();
  await expect(page.getByTestId("inspiration-card").getByTestId("result-title")).toHaveText(
    "My native-feed reference",
  );
  await expect(page.getByTestId("inspiration-note")).toHaveValue("أجرّب توقيت الانتقال");
  expect(asked).toHaveLength(2);
});
