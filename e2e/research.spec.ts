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

test("skill sheet Research panel opens and links to all three platforms with the EN topic", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await openSkillSheet(page);

  await page.getByTestId("research-toggle").click();
  await expect(page.getByTestId("research-panel")).toBeVisible();

  // Switch the panel's own language toggle to EN so the search queries use the English topic.
  await page.getByTestId("research-lang-en").click();

  const encoded = encodeURIComponent(EN_NAME_PART);
  await expect(page.getByTestId("research-link-yt")).toHaveAttribute("href", new RegExp(encoded));
  await expect(page.getByTestId("research-link-tt")).toHaveAttribute("href", new RegExp(encoded));
  await expect(page.getByTestId("research-link-ig")).toHaveAttribute("href", new RegExp(encoded));
  // YouTube (only) gets the DaVinci program's extra " davinci resolve" suffix on the EN query.
  await expect(page.getByTestId("research-link-yt")).toHaveAttribute("href", /davinci%20resolve/);
  await expect(page.getByTestId("research-link-tt")).not.toHaveAttribute(
    "href",
    /davinci%20resolve/,
  );

  // Every link opens in a new tab.
  for (const id of ["research-link-yt", "research-link-tt", "research-link-ig"]) {
    await expect(page.getByTestId(id)).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId(id)).toHaveAttribute("rel", /noopener/);
  }
});

test("pasting a link saves a reference under Your references; it survives reload and can be removed", async ({
  page,
}) => {
  await freshState(page, "/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();

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

  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("discover-topic").press("Enter");

  const href = await page.getByTestId("research-link-yt").getAttribute("href");
  expect(href).toMatch(/match(\+|%20)cut/);
});

test("in-app YouTube results render from a stubbed API once a key is set, and Add as reference saves", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  await expect(page.getByTestId("apikey-youtube-status")).toHaveText("ما انحفظ"); // "Not set" (Hijazi)

  await page.getByTestId("apikey-youtube-input").fill("AIzaFAKE1234567890");
  await page.getByTestId("apikey-youtube-input").press("Enter");
  await expect(page.getByTestId("apikey-youtube-status")).toHaveText("محفوظ"); // "Set" (Hijazi)

  await page.route("https://www.googleapis.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: { videoId: "fakeVid1" },
            snippet: {
              title: "Fake Match Cut Tutorial",
              channelTitle: "Fake Channel",
              thumbnails: { medium: { url: FAKE_THUMB } },
            },
          },
        ],
      }),
    }),
  );

  await page.goto("/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();

  const result = page.getByTestId("yt-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("Fake Match Cut Tutorial");
  await expect(result).toContainText("Fake Channel");

  await page.getByTestId("yt-add-ref").click();
  await expect(
    page.getByTestId("saved-ref").filter({ hasText: "Fake Match Cut Tutorial" }),
  ).toBeVisible();
  // The add button reflects the saved state.
  await expect(page.getByTestId("yt-add-ref")).toBeDisabled();
});
