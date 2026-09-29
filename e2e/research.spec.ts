import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

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

/** On phones the filter chips sit behind a "Filters" button; on desktop they're always shown. */
async function openFilters(page: Page): Promise<void> {
  const toggle = page.getByTestId("filters-toggle");
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.getByTestId("filters")).toBeVisible();
}

test("skill sheet Research panel: EN topic, program hint chip, editable topic with reset, platform links", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await openSkillSheet(page);

  await page.getByTestId("research-toggle").click();
  await expect(page.getByTestId("research-panel")).toBeVisible();

  // Switch the panel's own language toggle to EN so the query uses the English skill name.
  await page.getByTestId("research-lang-en").click();
  await expect(page.getByTestId("research-topic")).toHaveValue(new RegExp(EN_NAME_PART));

  // The open-on-platform links live in the search bar's overflow.
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
  await expect(page.getByTestId("research-start")).toBeVisible();

  // Typing alone searches nothing; Enter commits the topic.
  await page.getByTestId("discover-topic").fill("match cut");
  await expect(page.getByTestId("research-more")).toHaveCount(0);
  await page.getByTestId("discover-topic").press("Enter");

  await page.getByTestId("research-more-toggle").click();
  const href = await page.getByTestId("research-link-yt").getAttribute("href");
  expect(href).toMatch(/match(\+|%20)cut/);

  // With a program picked, the searches get its name but the Instagram hashtag stays the topic's own.
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

  const requests: URL[] = [];
  await page.route("https://www.googleapis.com/**", (route) => {
    requests.push(new URL(route.request().url()));
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

  // Length and recency filters go to the API as videoDuration / publishedAfter.
  await openFilters(page);
  await page.getByTestId("filter-len-short").click();
  await expect(page.getByTestId("filter-len-short")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].searchParams.get("videoDuration")).toBe("short");
  await page.getByTestId("filter-time-week").click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].searchParams.get("publishedAfter")).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  // On phones the Filters button shows how many are active.
  if (await page.getByTestId("filters-toggle").isVisible()) {
    await expect(page.getByTestId("filters-count")).toHaveText("2");
  }
  // Step back through combinations already asked for: served from the session cache, no new API call.
  await page.getByTestId("filter-time-any").click();
  await expect(result).toBeVisible();
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
});
