import { expect, test, type Page } from "@playwright/test";
import {
  freshState,
  openDiscoverOptions,
  openDiscoverSearch,
  openResearchFilters,
  openDiscoverCategories,
} from "./helpers";

// Same DaVinci skill used by mastery.spec.ts: "Smart Bins + Keywords" / "الـ Smart Bins والكلمات المفتاحية",
// already shipped with real yt/tt/ig/web refs, under Editing → davinci.
const SKILL_ID = "smart-bins-keywords";
const EN_NAME_PART = "Smart Bins";

// A tiny 1x1 PNG so the stubbed YouTube result's thumbnail never makes a real network request.
const FAKE_THUMB =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function openSkillSheet(page: Page): Promise<void> {
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`).click();
  await expect(page.getByTestId("skill-sheet")).toBeVisible();
}

/** Every host of YouTube, TikTok, Instagram and Meta the ▶ player could reach (round 32). */
const PLATFORM_HOSTS =
  /^https?:\/\/([\w-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|tiktok\.com|tiktokcdn\.com|tiktokv\.com|ttwstatic\.com|instagram\.com|cdninstagram\.com|facebook\.com|facebook\.net|fbcdn\.net)(:\d+)?\//;

/**
 * ▶ Watch here (round 32): the player sheet asks YouTube and Instagram before it plays, then frames the
 * platform's player. No test here reaches a real platform: every such request is aborted and recorded (the
 * player's own flows, against stubbed players, are e2e/player.spec.ts).
 */
async function blockPlatforms(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(PLATFORM_HOSTS, (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  return asked;
}

/** The skill sheet keeps its original responsive filters. */
async function openFilters(page: Page): Promise<void> {
  await openResearchFilters(page);
}

test("skill sheet Research panel: EN topic, program hint chip, editable topic with reset, platform links", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await openSkillSheet(page);

  await page.getByTestId("research-toggle").click();
  await expect(page.getByTestId("research-panel")).toBeVisible();

  // Switch the panel's own language toggle to EN so the query uses the English skill name.
  await openDiscoverOptions(page);
  await page.getByTestId("research-lang-en").click();
  await expect(page.getByTestId("research-topic")).toHaveValue(new RegExp(EN_NAME_PART));

  // The open-on-platform links live in the search bar's overflow.
  await openDiscoverOptions(page);
  await page.getByTestId("research-more-toggle").click();
  const encoded = encodeURIComponent(EN_NAME_PART);
  for (const id of ["research-link-yt", "research-link-tt", "research-link-ig"]) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId(id)).toHaveAttribute("href", new RegExp(encoded));
    // The DaVinci skill's "+ DaVinci Resolve" hint chip is on by default and appends to every query.
    await expect(page.getByTestId(id)).toHaveAttribute("href", /DaVinci%20Resolve/);
    // Every link opens in a new tab.
    await expect(page.getByTestId(id)).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId(id)).toHaveAttribute("rel", /noopener/);
  }

  // Toggle the hint off: the queries drop the program name.
  await expect(page.getByTestId("research-hint")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("research-hint").click();
  await expect(page.getByTestId("research-hint")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("research-link-tt")).not.toHaveAttribute(
    "href",
    /DaVinci%20Resolve/,
  );

  // Override the topic: nothing changes until Enter; then "reset" brings the skill name back.
  await page.getByTestId("research-topic").fill("match cut");
  await expect(page.getByTestId("research-link-tt")).toHaveAttribute("href", new RegExp(encoded));
  await page.getByTestId("research-topic").press("Enter");
  await expect(page.getByTestId("research-link-tt")).toHaveAttribute("href", /match%20cut/);
  await page.getByTestId("research-reset").click();
  await expect(page.getByTestId("research-topic")).toHaveValue(new RegExp(EN_NAME_PART));
  await expect(page.getByTestId("research-reset")).toHaveCount(0);

  // Nothing is configured: every tab explains how to enable it instead of staying blank.
  await expect(page.getByTestId("scout-not-configured")).toBeVisible();
  await page.getByTestId("tab-yt").click();
  await expect(page.getByTestId("yt-no-key")).toBeVisible();
  await expect(page.getByTestId("yt-no-key").locator('a[href^="/settings/"]')).toHaveCount(1);
});

test("pasting a link saves a reference under Your references; it survives reload and can be removed", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();

  // Paste-a-link sits under a disclosure at the bottom of the panel.
  await expect(page.getByTestId("paste-link-url")).toBeHidden();
  await page.getByTestId("paste-toggle").click();
  await page.getByTestId("paste-link-url").fill("https://www.tiktok.com/@editor.sam/video/123");
  await page.getByTestId("paste-link-title").fill("Great match cut example");
  await page.getByTestId("paste-link-save").click();

  const savedRef = () =>
    page.getByTestId("saved-ref").filter({ hasText: "Great match cut example" });
  await expect(savedRef()).toBeVisible();
  // The paste form clears itself after a save.
  await expect(page.getByTestId("paste-link-url")).toHaveValue("");
  // One TikTok post: a ▶ beside it plays it here (round 32).
  await expect(savedRef().getByTestId("result-play")).toHaveAccessibleName(
    "شاهد «Great match cut example» هنا",
  );

  await page.reload();
  await openSkillSheet(page);
  await expect(savedRef()).toBeVisible();

  await savedRef().getByTestId("saved-ref-remove").click();
  await expect(savedRef()).toHaveCount(0);
});

test("/discover/: a topic builds an encoded YouTube link, and Discover is a phone tab", async ({
  page,
}) => {
  await freshState(page, "/discover/");

  // The tab exists in the (phone) tab bar regardless of viewport, even where CSS hides it on desktop.
  await expect(page.getByTestId("tabbar").locator('a[href="/discover/"]')).toHaveCount(1);
  await openDiscoverSearch(page);
  await expect(page.getByTestId("research-start")).toBeVisible();

  // Typing alone searches nothing; Enter commits the topic.
  await openDiscoverSearch(page);
  await page.getByTestId("discover-topic").fill("match cut");
  await expect(page.getByTestId("research-more")).toHaveCount(0);
  await openDiscoverSearch(page);
  await page.getByTestId("discover-topic").press("Enter");

  await openDiscoverOptions(page);
  await page.getByTestId("research-more-toggle").click();
  const href = await page.getByTestId("research-link-yt").getAttribute("href");
  expect(href).toMatch(/match(\+|%20)cut/);

  // With a program picked, the searches get its name but the Instagram hashtag stays the topic's own.
  await openDiscoverOptions(page);
  await page.getByTestId("discover-program").selectOption("davinci");
  await expect(page.getByTestId("research-link-yt")).toHaveAttribute("href", /DaVinci%20Resolve/);
  await expect(page.getByTestId("research-link-ig-hashtag")).toHaveAttribute(
    "href",
    "https://www.instagram.com/explore/tags/matchcut/",
  );
});

test("in-app YouTube results render from a stubbed API with filters, and attach toggles the reference", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  await expect(page.getByTestId("apikey-youtube-status")).toHaveText("ما انحفظ"); // "Not set" (Hijazi)

  await page.getByTestId("apikey-youtube-input").fill("AIzaFAKE1234567890");
  await page.getByTestId("apikey-youtube-input").press("Enter");
  await expect(page.getByTestId("apikey-youtube-status")).toHaveText("محفوظ"); // "Set" (Hijazi)
  const asked = await blockPlatforms(page);

  // `requests` holds the searches; every search that found something is followed by one statistics call.
  const requests: URL[] = [];
  const statsRequests: URL[] = [];
  await page.route("https://www.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/videos")) {
      statsRequests.push(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ id: "fakeVid1", statistics: { viewCount: "1500000", likeCount: "20000" } }],
        }),
      });
    }
    requests.push(url);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: { videoId: "fakeVid1" },
            snippet: {
              title: "Fake Match Cut Tutorial",
              channelTitle: "Fake Channel",
              description: "A &quot;fake&quot; tutorial",
              thumbnails: { medium: { url: FAKE_THUMB } },
            },
          },
        ],
      }),
    });
  });

  await page.goto("/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();

  const result = page.locator('[data-testid="result-card"][data-platform="yt"]');
  await expect(result).toBeVisible();
  await expect(result).toContainText("Fake Match Cut Tutorial");
  await expect(result).toContainText("Fake Channel");
  await expect(result.getByTestId("result-snippet")).toHaveText('A "fake" tutorial');
  await expect(result.getByTestId("result-thumb")).toHaveAttribute("src", FAKE_THUMB);
  await expect(page.getByTestId("tab-yt")).toHaveAttribute("data-count", "1");
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get("relevanceLanguage")).toBe("ar");
  expect(requests[0].searchParams.has("videoDuration")).toBe(false);
  expect(requests[0].searchParams.has("order")).toBe(false);
  // The statistics call (videos.list, 1 quota unit) puts the views on the card.
  expect(statsRequests).toHaveLength(1);
  expect(statsRequests[0].searchParams.get("id")).toBe("fakeVid1");
  await expect(result.getByTestId("result-stats")).toHaveAttribute("data-views", "1500000");

  // Length and recency filters go to the API as videoDuration / publishedAfter.
  await openFilters(page);
  await openResearchFilters(page);
  await page.getByTestId("filter-len-short").click();
  await expect(page.getByTestId("filter-len-short")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].searchParams.get("videoDuration")).toBe("short");
  await openResearchFilters(page);
  await page.getByTestId("filter-time-week").click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].searchParams.get("publishedAfter")).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  // On phones the Filters button shows how many are active.
  if (await page.getByTestId("filters-toggle").isVisible()) {
    await expect(page.getByTestId("filters-count")).toHaveText("2");
  }
  // Step back through combinations already asked for: served from the session cache, no new API call.
  await openResearchFilters(page);
  await page.getByTestId("filter-time-any").click();
  await expect(result).toBeVisible();
  await openResearchFilters(page);
  await page.getByTestId("filter-len-any").click();
  await expect(result).toBeVisible();
  expect(requests).toHaveLength(3);

  await result.getByTestId("result-attach").click();
  await expect(
    page.getByTestId("saved-ref").filter({ hasText: "Fake Match Cut Tutorial" }),
  ).toBeVisible();
  // The card reflects the saved state; tapping again removes the reference.
  await expect(result.getByTestId("result-attach")).toHaveAttribute("aria-pressed", "true");
  await result.getByTestId("result-attach").click();
  await expect(result.getByTestId("result-attach")).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByTestId("saved-ref").filter({ hasText: "Fake Match Cut Tutorial" }),
  ).toHaveCount(0);

  // ▶ Watch here (round 32): the poster is a ▶ (the picture inside it) that opens the player on top of
  // the skill sheet; nothing was asked of YouTube before the tap, and closing the player keeps the sheet.
  const play = result.getByTestId("result-play");
  await expect(play).toHaveAccessibleName("شاهد «Fake Match Cut Tutorial» هنا");
  await expect(play.getByTestId("result-thumb")).toHaveAttribute("src", FAKE_THUMB);
  expect(asked).toEqual([]);
  await play.click();
  await expect(page.getByTestId("player-sheet")).toHaveAttribute("data-platform", "yt");
  await page.getByTestId("player-close").click();
  await expect(page.getByTestId("player-sheet")).toHaveCount(0);
  await expect(page.getByTestId("skill-sheet")).toBeVisible();
  await expect(result).toBeVisible();
});

test("skill sheet Research panel: an edit genre narrows the skill's search; reset keeps the genre", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();
  await openDiscoverOptions(page);
  await page.getByTestId("research-lang-en").click();

  const skillName = encodeURIComponent("Smart Bins + Keywords");
  const tt = page.getByTestId("research-link-tt");
  const href = (q: string) => `https://www.tiktok.com/search?q=${q}`;
  await expect(tt).toHaveAttribute("href", href(`${skillName}%20DaVinci%20Resolve`));

  // The genre row sits right under the search bar; the skill's name stays the base of the search.
  await expect(page.getByTestId("genres-row")).toBeVisible();
  await openDiscoverCategories(page);
  await page.getByTestId("genre-cars").click();
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("research-topic")).toHaveValue("Smart Bins + Keywords");
  await expect(tt).toHaveAttribute("href", href(`${skillName}%20car%20edit%20DaVinci%20Resolve`));
  // The Instagram hashtag stays the skill's own (the genre's is for a genre-only search).
  await expect(page.getByTestId("research-link-ig-hashtag")).toHaveAttribute(
    "href",
    "https://www.instagram.com/explore/tags/smartbinskeywords/",
  );

  // The search language picks the genre's words; the skill's name follows it too.
  await openDiscoverOptions(page);
  await page.getByTestId("research-lang-ar").click();
  await expect(tt).toHaveAttribute(
    "href",
    new RegExp(`${encodeURIComponent("ايديت سيارات")}%20DaVinci%20Resolve$`),
  );
  await openDiscoverOptions(page);
  await page.getByTestId("research-lang-en").click();

  // An override of the topic is searched with the genre; "reset" brings the name back and keeps the genre.
  await page.getByTestId("research-topic").fill("match cut");
  await page.getByTestId("research-topic").press("Enter");
  await expect(tt).toHaveAttribute("href", href("match%20cut%20car%20edit%20DaVinci%20Resolve"));
  await page.getByTestId("research-reset").click();
  await expect(page.getByTestId("research-topic")).toHaveValue("Smart Bins + Keywords");
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "true");
  await expect(tt).toHaveAttribute("href", href(`${skillName}%20car%20edit%20DaVinci%20Resolve`));

  // The active chip again: back to the skill's plain search.
  await openDiscoverCategories(page);
  await page.getByTestId("genre-cars").click();
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "false");
  await expect(tt).toHaveAttribute("href", href(`${skillName}%20DaVinci%20Resolve`));
});
