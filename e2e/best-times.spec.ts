import { expect, test, type Page } from "@playwright/test";
import { seedState } from "./helpers";

// A5 · Best times to post, learned from the owner's own post numbers: the Growth heat map + top slots, and the
// three tappable time chips in the new-post sheet and the post popup. Stats are seeded straight into the store.

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

const stat = (platform: string, id: string, at: string, views: number) => ({
  platform,
  postId: id,
  publishedAt: at,
  kind: "video",
  views,
  likes: 0,
  comments: 0,
  shares: 0,
});

/** 24 TikTok videos at 21:15 (4,000 views) and 10 at 13:00 (1,000), all 4-37 days old, plus 6 Instagram reels. */
function seed() {
  const stats = [
    ...Array.from({ length: 24 }, (_, i) =>
      stat("tiktok", `t${i}`, `${riyadhDay(-4 - i)}T21:15:00+03:00`, 4000),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      stat("tiktok", `n${i}`, `${riyadhDay(-28 - i)}T13:00:00+03:00`, 1000),
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      stat("instagram", `i${i}`, `${riyadhDay(-5 - i)}T20:30:00+03:00`, 800),
    ),
  ];
  return { settings: { lang: "en" }, socialPostStats: stats };
}

test("Growth shows the heat map and top times learned from the posts, and says what is missing elsewhere", async ({
  page,
}) => {
  await seedState(page, "/social/growth/", seed());
  const card = page.getByTestId("best-times");
  await expect(card).toBeVisible();
  // The platform with the most posts comes first; it has 34 settled posts.
  await expect(card).toHaveAttribute("data-platform", "tiktok");
  await expect(card).toHaveAttribute("data-ready", "true");
  await expect(card).toHaveAttribute("data-posts", "34");
  const slots = page.getByTestId("best-time-slot");
  await expect(slots).toHaveCount(3);
  await expect(slots.first()).toHaveAttribute("data-time", "21:15");
  await expect(slots.first()).toHaveAttribute("data-block", "10");
  await expect(slots.first()).toHaveAttribute("data-pct", "100");
  await expect(page.getByTestId("best-time-cell")).toHaveCount(84);
  // Cells without posts stay blank, the busy ones are tinted.
  const tinted = await page
    .getByTestId("best-time-cell")
    .evaluateAll((els) => els.filter((e) => Number(e.getAttribute("data-n")) > 0).length);
  expect(tinted).toBeGreaterThan(7);
  expect(await fitsViewport(page)).toBe(true);

  // Instagram has 6 posts: the card says so and offers the usual times.
  await page.getByTestId("best-times-platform-instagram").click();
  await expect(card).toHaveAttribute("data-platform", "instagram");
  await expect(card).toHaveAttribute("data-ready", "false");
  await expect(page.getByTestId("best-times-needs")).toContainText("need 20");
  await expect(page.getByTestId("best-times-needs")).toContainText("you have 6");
  await expect(page.getByTestId("best-times-usual").locator("li")).toHaveText([
    "20:30",
    "21:30",
    "13:00",
  ]);
  await expect(page.getByTestId("best-time-cell")).toHaveCount(0);

  // A platform's own view follows that platform and drops the chips.
  await page.getByTestId("analytics-platform-tiktok").click();
  await expect(card).toHaveAttribute("data-platform", "tiktok");
  await expect(page.getByTestId("best-times-platform-instagram")).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
});

test("the new-post sheet offers the learned times, falls back to the usual ones, and a tap sets the time", async ({
  page,
}) => {
  await seedState(page, "/social/calendar/", seed());
  await page.locator('[data-testid="calendar-new"]:visible').click();
  const chips = page.getByTestId("post-time-chip");
  // TikTok has data: its own 21:15 peak first, then the next proven block.
  await expect(page.getByTestId("post-best-time")).toHaveAttribute("data-learned", "true");
  await expect(chips).toHaveText(["21:15", "13:00"]);
  await expect(page.getByTestId("post-time")).toHaveValue("21:15");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("post-best-source")).toContainText("34 TikTok posts");

  // Instagram has too few: the usual times, and the time field follows the platform.
  await page.getByTestId("post-platform-instagram").click();
  await expect(page.getByTestId("post-best-time")).toHaveAttribute("data-learned", "false");
  await expect(chips).toHaveText(["20:30", "21:30", "13:00"]);
  await expect(page.getByTestId("post-time")).toHaveValue("20:30");
  await expect(page.getByTestId("post-best-source")).toContainText("you have 6");

  // A tap on another chip sets the time, and it then stays when the platform changes.
  await chips.nth(1).click();
  await expect(page.getByTestId("post-time")).toHaveValue("21:30");
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("post-platform-tiktok").click();
  await expect(page.getByTestId("post-time")).toHaveValue("21:30");
  expect(await fitsViewport(page)).toBe(true);
});

test("the post popup's Overview offers the same times and a tap sets the planned time", async ({
  page,
}) => {
  await seedState(page, "/social/calendar/", seed());
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-title").fill("Match cut reel");
  await page.getByTestId("post-day").fill(riyadhDay(1));
  await page.getByTestId("post-save").click();
  await expect(page.getByTestId("post-form")).toBeHidden();
  await page.getByTestId("post-card").first().locator("button").first().click();
  const chips = page.getByTestId("post-time-chip");
  await expect(chips.first()).toHaveAttribute("data-time", "21:15");
  await expect(page.getByTestId("post-plan-time")).toHaveValue("21:15");
  await chips.nth(1).click();
  await expect(page.getByTestId("post-plan-time")).toHaveValue("13:00");
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
});
