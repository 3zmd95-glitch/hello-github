import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { freshState, switchLang } from "./helpers";

/** Riyadh day key of now, shifted by `offset` days (mirrors lib/streak dayKey + addDays). */
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
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

/** A TikTok Studio → Analytics → Content export: 6 videos, 2 of them in the last 7 days, 4 in the last month. */
const TIKTOK_CSV = [
  "Video title,Video link,Video publish time,Total views,Total likes,Total comments,Total shares",
  `Grade Log in 60s,https://www.tiktok.com/@3z.prod/video/7001,${riyadhDay(-1)} 14:00:00,"41,200","3,100",90,210`,
  `iPhone ProRes tips,https://www.tiktok.com/@3z.prod/video/7002,${riyadhDay(-3)} 21:00:00,"12,000",800,40,60`,
  `Lightroom presets,https://www.tiktok.com/@3z.prod/video/7003,${riyadhDay(-10)} 21:00:00,"30,000","2,400",70,120`,
  `Studio lights tour,https://www.tiktok.com/@3z.prod/video/7004,${riyadhDay(-20)} 13:00:00,"18,500","1,200",50,90`,
  `T&O LUT before after,https://www.tiktok.com/@3z.prod/video/7005,${riyadhDay(-40)} 21:00:00,"55,000","4,000",120,300`,
  `Behind the scenes,https://www.tiktok.com/@3z.prod/video/7006,${riyadhDay(-80)} 21:30:00,"9,000",600,30,40`,
].join("\n");

test("Social Analytics: the seeded All view, the TikTok view with demographics, posts import, search, CSV, manual demographics", async ({
  page,
}) => {
  test.slow();
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // The Sep 27, 2026 Beacons numbers are seeded on first load: 1.5k followers over four platforms.
  await expect(page.getByTestId("kpi-followers")).toHaveAttribute("data-value", "1478");
  await expect(page.getByTestId("kpi-followers")).toContainText("1.5k");
  await expect(page.getByTestId("kpi-engagement")).toContainText("7.2%");
  await expect(page.getByTestId("kpi-views")).toContainText("7.8k");
  await expect(page.getByTestId("platform-card")).toHaveCount(4);
  expect(await fitsViewport(page)).toBe(true);

  // English labels for the card checks; RTL was checked above.
  await switchLang(page, "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("growth-screen")).toContainText("Social Analytics");
  const ytCard = page.locator('[data-testid="platform-card"][data-platform="youtube"]');
  await expect(ytCard).toContainText("Subscribers");
  await expect(ytCard.locator('[data-metric="totalSubscribers"]')).toContainText("6");
  const ttCard = page.locator('[data-testid="platform-card"][data-platform="tiktok"]');
  await expect(ttCard).toContainText("7.8%");
  await expect(ttCard.getByTestId("platform-card-link")).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@3z.prod",
  );
  await expect(page.getByTestId("activity-90")).toHaveAttribute("data-value", "0");
  expect(await fitsViewport(page)).toBe(true);

  // "What changed this week?" toggles the rule-based card.
  await expect(page.getByTestId("analytics-changed-text")).toHaveCount(0);
  await page.getByTestId("analytics-changed").click();
  await expect(page.getByTestId("analytics-changed-text")).toBeVisible();
  await expect(page.getByTestId("analytics-changed-text")).toContainText("first snapshot");
  await page.getByTestId("analytics-changed").click();
  await expect(page.getByTestId("analytics-changed-text")).toHaveCount(0);
  await page.getByTestId("analytics-engagement").click();
  await expect(page.getByTestId("analytics-engagement-text")).toHaveAttribute(
    "data-platform",
    "tiktok",
  );

  // TikTok view: 5 overview rows, demographics with Saudi Arabia first and 25-34 the widest bar.
  // The filter is an iOS segmented control: tabs carry aria-selected (a tab cannot be aria-pressed).
  await page.getByTestId("analytics-platform-tiktok").click();
  await expect(page.getByTestId("analytics-platform-tiktok")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("growth-screen")).toHaveAttribute("data-tab", "tiktok");
  await expect(page.getByTestId("overview-row")).toHaveCount(5);
  await expect(
    page.locator('[data-testid="overview-row"][data-metric="engagement"]'),
  ).toContainText("7.8%");
  const avgViewsRow = page.locator('[data-testid="overview-row"][data-metric="avgViews"]');
  await expect(avgViewsRow).toHaveAttribute("data-source", "snapshot");
  await expect(page.getByTestId("demographics")).toBeVisible();
  await expect(page.getByTestId("demo-gender")).toHaveAttribute("data-male", "56");
  await expect(page.getByTestId("demo-geo-row").first()).toHaveAttribute("data-key", "SA");
  await expect(page.getByTestId("demo-geo-row").first()).toContainText("Saudi Arabia");
  const bars = page.getByTestId("demo-age-bar");
  await expect(bars).toHaveCount(5);
  const pcts = await bars.evaluateAll((els) =>
    els.map((el) => ({
      bucket: el.getAttribute("data-bucket"),
      pct: Number(el.getAttribute("data-pct")),
    })),
  );
  expect(pcts.map((p) => p.bucket)).toEqual(["18-24", "25-34", "35-44", "45-54", "55-64"]);
  const widest = pcts.reduce((a, b) => (b.pct > a.pct ? b : a));
  expect(widest.bucket).toBe("25-34");
  expect(widest.pct).toBe(53);
  // Male toggle: the seed has no per-gender buckets, so the bars change (to 0) and say so.
  await page.getByTestId("demo-age-toggle-male").click();
  await expect(page.getByTestId("demo-age")).toHaveAttribute("data-gender", "male");
  await expect(page.locator('[data-testid="demo-age-bar"][data-bucket="25-34"]')).toHaveAttribute(
    "data-pct",
    "0",
  );
  await expect(page.getByTestId("demo-age-empty")).toBeVisible();
  await page.getByTestId("demo-age-toggle-all").click();
  await expect(page.locator('[data-testid="demo-age-bar"][data-bucket="25-34"]')).toHaveAttribute(
    "data-pct",
    "53",
  );
  await expect(page.getByTestId("content-empty")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  // Import a TikTok Studio export: counters, top posts and the averages switch to the posts.
  await page.getByTestId("content-import").click();
  await expect(page.getByTestId("content-dialog")).toBeVisible();
  await expect(page.getByTestId("import-source-tiktok")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("content-csv").fill(TIKTOK_CSV);
  await expect(page.getByTestId("content-preview")).toHaveAttribute("data-rows", "6");
  await expect(page.getByTestId("content-errors")).toHaveCount(0);
  await page.getByTestId("content-apply").click();
  await expect(page.getByTestId("content-dialog")).toHaveCount(0);
  await expect(page.getByTestId("activity-7")).toHaveAttribute("data-value", "2");
  await expect(page.getByTestId("activity-30")).toHaveAttribute("data-value", "4");
  await expect(page.getByTestId("activity-90")).toHaveAttribute("data-value", "6");
  expect(await page.getByTestId("top-post").count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("top-post").first()).toHaveAttribute("data-post", "7001");
  await expect(avgViewsRow).toHaveAttribute("data-source", "posts");
  await expect(avgViewsRow).toContainText("from 6 posts");
  await page.getByTestId("analytics-cadence").click();
  await expect(page.getByTestId("analytics-cadence-text")).toContainText("4 posts");
  expect(await fitsViewport(page)).toBe(true);

  // Search filters the past posts.
  await expect(page.getByTestId("tiktok-brief-post")).toHaveCount(3);
  await expect(page.getByTestId("tiktok-brief")).toContainText("current lifetime totals");
  await page.getByTestId("tiktok-brief-days").selectOption("7");
  await expect(page.getByTestId("tiktok-brief-post")).toHaveCount(2);
  await page.getByTestId("tiktok-brief-followup").first().click();
  await expect(page.getByTestId("tiktok-brief-draft")).toHaveAttribute(
    "href",
    /\/social\/calendar\/#post=/,
  );
  const [briefDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("tiktok-brief-export").click(),
  ]);
  expect(briefDownload.suggestedFilename()).toBe("tiktok-posts-7d.csv");
  expect(readFileSync((await briefDownload.path())!, "utf8")).toContain("Lifetime views");
  expect(await fitsViewport(page)).toBe(true);

  // Search filters the past posts.
  await expect(page.getByTestId("content-post")).toHaveCount(6);
  await page.getByTestId("content-search").fill("grade");
  await expect(page.getByTestId("content-post")).toHaveCount(1);
  await expect(page.getByTestId("content-post")).toContainText("Grade Log in 60s");
  await page.getByTestId("content-search").fill("");
  await expect(page.getByTestId("content-post")).toHaveCount(6);

  // Download CSV: our own My Content export, readable back by the importer.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("content-export").click(),
  ]);
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const exported = readFileSync(csvPath as string, "utf8");
  expect(exported.split("\n")[0]).toContain("postId");
  expect(exported).toContain("7005");

  // Manual demographics for YouTube: the section appears on the YouTube view.
  await page.getByTestId("analytics-platform-youtube").click();
  await expect(page.getByTestId("demographics-empty")).toBeVisible();
  await page.getByTestId("demo-add").click();
  await expect(page.getByTestId("demo-dialog")).toBeVisible();
  await expect(page.getByTestId("demo-platform")).toHaveValue("youtube");
  await page.getByTestId("demo-male").fill("70");
  await page.getByTestId("demo-age-18-24").fill("40");
  await page.getByTestId("demo-age-25-34").fill("60");
  await page.getByTestId("demo-country-0").fill("Saudi Arabia");
  await page.getByTestId("demo-country-pct-0").fill("80");
  await page.getByTestId("demo-country-1").fill("EG");
  await page.getByTestId("demo-country-pct-1").fill("20%");
  await page.getByTestId("demo-save").click();
  await expect(page.getByTestId("demo-dialog")).toHaveCount(0);
  await expect(page.getByTestId("demographics")).toBeVisible();
  await expect(page.getByTestId("demo-gender")).toHaveAttribute("data-male", "70");
  await expect(page.getByTestId("demo-gender")).toHaveAttribute("data-female", "30");
  await expect(page.getByTestId("demo-age-bar")).toHaveCount(2);
  await expect(page.getByTestId("demo-geo-row").first()).toHaveAttribute("data-key", "SA");
  await expect(page.getByTestId("demo-geo-row").nth(1)).toHaveAttribute("data-key", "EG");

  // Removing a post drops the counters.
  await page.getByTestId("analytics-platform-tiktok").click();
  await page.getByTestId("content-remove").first().click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("activity-90")).toHaveAttribute("data-value", "5");
  await expect(page.getByTestId("activity-7")).toHaveAttribute("data-value", "1");

  // Reload keeps everything (the seed does not re-apply over the owner's data).
  await page.reload();
  await expect(page.getByTestId("kpi-followers")).toHaveAttribute("data-value", "1478");
  await expect(page.getByTestId("activity-90")).toHaveAttribute("data-value", "5");
  await expect(page.getByTestId("content-post")).toHaveCount(5);
  await page.getByTestId("analytics-platform-youtube").click();
  await expect(page.getByTestId("demographics")).toBeVisible();
  await expect(page.getByTestId("demo-gender")).toHaveAttribute("data-male", "70");
  expect(await fitsViewport(page)).toBe(true);
});

test("Growth basics still work: add a snapshot, import a stats CSV with the th alias, handle, asks, remove", async ({
  page,
}) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("kpi-followers")).toHaveAttribute("data-value", "1478");

  // Add today's TikTok numbers through the form: the card and the KPI follow.
  await page.getByTestId("growth-add").click();
  await expect(page.getByTestId("snapshot-form")).toBeVisible();
  await expect(page.getByTestId("snapshot-platform")).toHaveValue("tiktok");
  await expect(page.getByTestId("snapshot-day")).toHaveValue(riyadhDay());
  await page.getByTestId("snapshot-followers").fill("1300");
  await page.getByTestId("snapshot-views").fill("5000");
  await page.getByTestId("snapshot-save").click();
  await expect(page.getByTestId("snapshot-form")).toHaveCount(0);
  await expect(page.locator('[data-testid="platform-card"][data-platform="tiktok"]')).toContainText(
    "1.3k",
  );
  await expect(page.getByTestId("kpi-followers")).toHaveAttribute("data-value", "1578");

  // Stats CSV with the Threads short form.
  const csv = [
    "platform,day,followers,views30d,engagementPct",
    `th,${riyadhDay()},50,900,6.5`,
  ].join("\n");
  await page.getByTestId("growth-import").click();
  await page.getByTestId("csv-text").fill(csv);
  await expect(page.getByTestId("csv-preview")).toHaveAttribute("data-rows", "1");
  await expect(page.getByTestId("csv-errors")).toHaveCount(0);
  await page.getByTestId("csv-apply").click();
  await expect(page.getByTestId("csv-dialog")).toHaveCount(0);
  const thCard = page.locator('[data-testid="platform-card"][data-platform="threads"]');
  await expect(thCard.locator('[data-metric="totalFollowers"]')).toContainText("50");
  await expect(page.getByTestId("kpi-followers")).toHaveAttribute("data-value", "1628");

  // The Threads view: the seeded handle, two snapshot rows, a new handle persists across reloads.
  await thCard.getByTestId("platform-card-open").click();
  await expect(page.getByTestId("growth-screen")).toHaveAttribute("data-tab", "threads");
  // On the seed day itself today's row replaces the seeded one, later it sits next to it.
  const rowsBefore = await page.getByTestId("snapshot-row").count();
  expect(rowsBefore).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("snapshot-row").first()).toHaveAttribute("data-day", riyadhDay());
  await expect(page.getByTestId("snapshot-row").first()).toContainText("50");
  await expect(page.getByTestId("chart-followers").locator("svg")).toBeVisible();
  await expect(page.getByTestId("account-handle")).toHaveValue("3z.prod");
  await expect(page.getByTestId("planned-empty-link")).toHaveAttribute("href", "/social/calendar/");
  await expect(page.getByTestId("content-tip")).toHaveAttribute("data-rule", "noRecent");
  await page.getByTestId("account-handle").fill("3zprod");
  await page.getByTestId("account-url").fill("");
  await page.getByTestId("account-save").click();
  await expect(page.getByTestId("account-link")).toContainText("@3zprod");
  await expect(page.getByTestId("account-link")).toHaveAttribute(
    "href",
    "https://www.threads.net/@3zprod",
  );
  await page.reload();
  await page.getByTestId("analytics-platform-threads").click();
  await expect(page.getByTestId("account-handle")).toHaveValue("3zprod");
  await expect(page.getByTestId("snapshot-row")).toHaveCount(rowsBefore);

  // Audience asks: add, bump to 2, remove.
  await page.getByTestId("ask-input").fill("How to grade Log?");
  await page.getByTestId("ask-add").click();
  await expect(page.getByTestId("ask-row")).toHaveCount(1);
  await expect(page.getByTestId("ask-count")).toHaveText("1");
  await page.getByTestId("ask-bump").click();
  await expect(page.getByTestId("ask-count")).toHaveText("2");
  await page.reload();
  await expect(page.getByTestId("ask-row")).toHaveCount(1);
  await page.getByTestId("ask-remove").click();
  await expect(page.getByTestId("ask-row")).toHaveCount(0);

  // Removing a snapshot goes through the confirm dialog.
  await page.getByTestId("analytics-platform-threads").click();
  await page.getByTestId("snapshot-remove").first().click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("snapshot-row")).toHaveCount(rowsBefore - 1);
  await page.getByTestId("analytics-platform-all").click();
  await expect(page.getByTestId("kpi-followers")).toHaveAttribute("data-value", "1578");
  expect(await fitsViewport(page)).toBe(true);
});

test("a bad CSV line is listed and cannot be imported", async ({ page }) => {
  await freshState(page, "/social/growth/");
  await page.getByTestId("growth-import").click();
  await page.getByTestId("csv-text").fill("foo,bar\n");
  await expect(page.getByTestId("csv-errors")).toBeVisible();
  await expect(page.getByTestId("csv-error")).toHaveCount(1);
  await expect(page.getByTestId("csv-error")).toContainText("1");
  await expect(page.getByTestId("csv-preview")).toHaveAttribute("data-rows", "0");
  await expect(page.getByTestId("csv-apply")).toBeDisabled();

  // A mixed paste keeps the good line and still lists the bad one.
  await page.getByTestId("csv-text").fill(`mars,${riyadhDay()},1,2\nsnap,${riyadhDay()},400,900`);
  await expect(page.getByTestId("csv-error")).toHaveCount(1);
  await expect(page.getByTestId("csv-preview")).toHaveAttribute("data-rows", "1");
  await expect(page.getByTestId("csv-apply")).toBeEnabled();
  await page.getByTestId("csv-apply").click();
  await expect(
    page.locator('[data-testid="platform-card"][data-platform="snapchat"]'),
  ).toContainText("400");
  await expect(page.getByTestId("platform-card")).toHaveCount(5);

  // A posts import with no date column is refused too.
  await page.getByTestId("content-import").click();
  await page.getByTestId("content-csv").fill("title,views\nfoo,12");
  await expect(page.getByTestId("content-preview")).toHaveAttribute("data-rows", "0");
  await expect(page.getByTestId("content-errors")).toBeVisible();
  await expect(page.getByTestId("content-apply")).toBeDisabled();
});

test("every platform view, including the manual-only ones, fits the viewport", async ({ page }) => {
  await freshState(page, "/social/growth/");
  for (const p of ["instagram", "youtube", "threads", "x", "snapchat"]) {
    await page.getByTestId(`analytics-platform-${p}`).click();
    await expect(page.getByTestId(`analytics-platform-${p}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("analytics-platform-all")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(await page.getByTestId("overview-row").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("post-activity")).toBeVisible();
    await expect(page.getByTestId("account-card")).toBeVisible();
    expect(await fitsViewport(page)).toBe(true);
  }
  // X and Snapchat say "manual only" (a tooltip, and read out after the name).
  const manualX = page.getByTestId("analytics-platform-x").locator("[data-manual]");
  await expect(manualX).toHaveAttribute("data-manual", "true");
  await expect(manualX).toHaveAttribute("title", "يدوي بس");
  await expect(page.getByTestId("analytics-platform-tiktok").locator("[data-manual]")).toHaveCount(
    0,
  );
  // Snapchat has no breakdown and offers the manual entry; Instagram's comes from the seed.
  await expect(page.getByTestId("demographics-empty")).toBeVisible();
  await page.getByTestId("analytics-platform-instagram").click();
  await expect(page.getByTestId("demo-geo-row").first()).toHaveAttribute("data-key", "SA");
  // The form preselects the platform of the open view.
  await page.getByTestId("analytics-platform-snapchat").click();
  await page.getByTestId("growth-add").click();
  await expect(page.getByTestId("snapshot-platform")).toHaveValue("snapchat");
});
