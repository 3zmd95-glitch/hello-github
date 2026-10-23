import { expect, test, type Page } from "@playwright/test";
import { seedState } from "./helpers";

// A8 · Saved hashtag sets: the Growth list with each set's results (joined from the platform numbers), the new-set
// form, and the picker inside a post's Overview. Everything is seeded straight into the store.

/** Riyadh day key of now, shifted by `offset` days. */
function riyadhDay(offset = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const utc = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
  return new Date(utc + offset * 86_400_000).toISOString().slice(0, 10);
}

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

const stat = (id: string, day: string, views: number, link?: string) => ({
  platform: "tiktok",
  postId: id,
  publishedAt: `${day}T20:00:00+03:00`,
  kind: "video",
  views,
  likes: 0,
  comments: 0,
  shares: 0,
  ...(link ? { permalink: link } : {}),
});

const link = (i: number) => `https://www.tiktok.com/@3z.prod/video/u${i}`;
const STAMP = "2026-10-01T10:00:00.000Z";

/**
 * 14 ordinary videos (1,000 views), 6 videos of the "Cuts" set (2,500: 2.5x the median) each posted from the
 * calendar, one draft to apply the set to, and the saved set itself.
 */
function seed() {
  return {
    settings: { lang: "en" },
    socialPostStats: [
      ...Array.from({ length: 14 }, (_, i) => stat(`o${i}`, riyadhDay(-10 - i), 1000)),
      ...Array.from({ length: 6 }, (_, i) => stat(`u${i}`, riyadhDay(-5 - i), 2500, link(i))),
    ],
    posts: [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `done${i}`,
        platform: "tiktok",
        title: `Done ${i}`,
        stage: "posted",
        hashtags: ["#Match_Cut", "#editing", "#extra"],
        postedAt: `${riyadhDay(-5 - i)}T20:00:00+03:00`,
        postedUrl: link(i),
        createdAt: STAMP,
        updatedAt: STAMP,
      })),
      {
        id: "draft1",
        platform: "tiktok",
        title: "Draft",
        stage: "idea",
        hashtags: [],
        plannedDay: riyadhDay(2),
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
    hashtagSets: [{ id: "hs1", name: "Cuts", tags: ["#match_cut", "#editing"], createdAt: STAMP }],
  };
}

test("Growth lists each set with its results, saves a new one and deletes it", async ({ page }) => {
  await seedState(page, "/social/growth/", seed());
  const rows = page.getByTestId("hashtag-set");
  await expect(rows).toHaveCount(1);
  // Six posts carry both tags and have numbers: 2.5x the platform's usual, said out loud.
  await expect(rows.first()).toHaveAttribute("data-n", "6");
  await expect(rows.first()).toHaveAttribute("data-enough", "true");
  await expect(rows.first().getByTestId("hashtag-set-stats")).toContainText("6 posts");
  await expect(rows.first().getByTestId("hashtag-set-stats")).toContainText("×2.5");
  expect(await fitsViewport(page)).toBe(true);

  // The form cleans the tags as they are typed, then the set joins the list: unused so far, so no verdict.
  await page.getByTestId("hashtag-set-name").fill("Color");
  await expect(page.getByTestId("hashtag-set-save")).toBeDisabled();
  await page.getByTestId("hashtag-set-tags").fill("grade, #LUT  grade ##look");
  await expect(page.getByTestId("hashtag-set-count")).toHaveText("3 hashtags");
  await page.getByTestId("hashtag-set-save").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("#grade #LUT #look");
  await expect(rows.nth(1).getByTestId("hashtag-set-stats")).toContainText("Not used");
  await expect(page.getByTestId("hashtag-set-name")).toHaveValue("");
  expect(await fitsViewport(page)).toBe(true);

  await page.reload();
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByTestId("hashtag-set-remove").click();
  await expect(rows).toHaveCount(1);
});

test("a post's Overview applies a saved set and saves its own hashtags as a new one", async ({
  page,
}) => {
  await seedState(page, "/social/calendar/#post=draft1", seed());
  await expect(page.getByTestId("post-overview")).toBeVisible();
  const apply = page.getByTestId("hashtag-set-apply");
  await expect(apply).toHaveCount(1);
  await expect(apply).toContainText("Cuts");
  await expect(apply).toContainText("×2.5");
  await expect(apply).toHaveAttribute("data-applied", "false");
  await expect(page.getByTestId("post-hashtag")).toHaveCount(0);

  await apply.click();
  await expect(page.getByTestId("post-hashtag")).toHaveText(["#match_cut", "#editing"]);
  await expect(apply).toHaveAttribute("data-applied", "true");
  // Applying again adds nothing.
  await apply.click();
  await expect(page.getByTestId("post-hashtag")).toHaveCount(2);

  // Its own tags as a new set.
  await page.getByTestId("post-hashtag-input").fill("#newtag");
  await page.getByTestId("post-hashtag-add").click();
  await page.getByTestId("hashtag-set-picker-new").click();
  await page.getByTestId("hashtag-set-picker-name").fill("Mine");
  await page.getByTestId("hashtag-set-picker-save").click();
  await expect(apply).toHaveCount(2);
  await expect(apply.nth(1)).toContainText("Mine");
  await expect(page.getByTestId("hashtag-set-picker-name")).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);

  await page.goto("/social/growth/");
  await expect(page.getByTestId("hashtag-set")).toHaveCount(2);
  await expect(page.getByTestId("hashtag-set").nth(1)).toContainText("#match_cut #editing #newtag");
});
