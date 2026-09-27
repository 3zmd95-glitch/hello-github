import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

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

test("Growth: manual snapshots, CSV import, platform tab, handle and audience asks", async ({
  page,
}) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");

  // Fresh: the empty state explains manual entry and offers both ways in.
  await expect(page.getByTestId("growth-empty")).toBeVisible();
  await expect(page.getByTestId("empty-add")).toBeVisible();
  await expect(page.getByTestId("empty-import")).toBeVisible();
  await expect(page.getByTestId("growth-tab-all")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("growth-tab-tiktok")).toHaveAttribute("aria-pressed", "false");

  // Add a TikTok snapshot through the form.
  await page.getByTestId("growth-add").click();
  await expect(page.getByTestId("snapshot-form")).toBeVisible();
  await expect(page.getByTestId("snapshot-platform")).toHaveValue("tiktok");
  await expect(page.getByTestId("snapshot-day")).toHaveValue(riyadhDay());
  await page.getByTestId("snapshot-followers").fill("1200");
  await page.getByTestId("snapshot-views").fill("5000");
  await page.getByTestId("snapshot-save").click();
  await expect(page.getByTestId("snapshot-form")).toHaveCount(0);

  await expect(page.getByTestId("growth-empty")).toHaveCount(0);
  const tiktokRow = page.locator('[data-testid="platform-row"][data-platform="tiktok"]');
  await expect(tiktokRow).toHaveAttribute("data-has-data", "true");
  await expect(tiktokRow).toContainText("1.2K");
  await expect(tiktokRow).toContainText("5K");
  await expect(page.getByTestId("total-followers")).toContainText("1.2K");
  await expect(page.getByTestId("total-followers")).toHaveAttribute("data-value", "1200");
  await expect(page.getByTestId("total-views")).toContainText("5K");
  await expect(page.getByTestId("total-platforms")).toHaveAttribute("data-value", "1");
  await expect(page.getByTestId("best-pending")).toBeVisible();
  await expect(page.getByTestId("growth-chart")).toBeVisible();

  // Import two Instagram rows: 30 days ago and today.
  const csv = [
    "platform,day,followers,views30d",
    `instagram,${riyadhDay(-30)},3000,8000`,
    `ig,${riyadhDay()},3300,9000,4.2`,
  ].join("\n");
  await page.getByTestId("growth-import").click();
  await page.getByTestId("csv-text").fill(csv);
  await expect(page.getByTestId("csv-preview")).toHaveAttribute("data-rows", "2");
  await expect(page.getByTestId("csv-errors")).toHaveCount(0);
  await page.getByTestId("csv-apply").click();
  await expect(page.getByTestId("csv-dialog")).toHaveCount(0);

  const igRow = page.locator('[data-testid="platform-row"][data-platform="instagram"]');
  await expect(igRow).toContainText("3.3K");
  const igDelta = igRow.getByTestId("platform-delta");
  await expect(igDelta).toHaveAttribute("data-dir", "up");
  await expect(igDelta).toContainText("+300");
  await expect(igDelta).toContainText("+10%");
  await expect(page.getByTestId("best-platform")).toHaveAttribute("data-platform", "instagram");
  await expect(page.getByTestId("best-platform")).toContainText("إنستقرام");
  await expect(page.getByTestId("total-followers")).toHaveAttribute("data-value", "4500");
  await expect(page.getByTestId("total-platforms")).toHaveAttribute("data-value", "2");
  expect(await fitsViewport(page)).toBe(true);

  // The Instagram tab: chart, two snapshot rows, the handle saved and persisted.
  await page.getByTestId("growth-tab-instagram").click();
  await expect(page.getByTestId("growth-tab-instagram")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("growth-chart")).toBeVisible();
  await expect(page.getByTestId("chart-followers").locator("svg")).toBeVisible();
  await expect(page.getByTestId("chart-views").locator("svg")).toBeVisible();
  await expect(page.getByTestId("snapshot-row")).toHaveCount(2);
  await expect(page.getByTestId("snapshot-row").first()).toHaveAttribute("data-day", riyadhDay());
  await expect(page.getByTestId("stat-followers")).toContainText("3.3K");
  await expect(page.getByTestId("stat-followers-delta")).toContainText("+300");
  await expect(page.getByTestId("stat-engagement")).toContainText("4.2%");
  await expect(page.getByTestId("planned-empty-link")).toHaveAttribute("href", "/social/calendar/");
  await expect(page.getByTestId("content-tip")).toHaveAttribute("data-rule", "noRecent");
  expect(await fitsViewport(page)).toBe(true);

  await page.getByTestId("account-handle").fill("3zprod");
  await page.getByTestId("account-save").click();
  await expect(page.getByTestId("account-link")).toHaveText("@3zprod");
  await page.reload();
  await page.getByTestId("growth-tab-instagram").click();
  await expect(page.getByTestId("account-handle")).toHaveValue("3zprod");
  await expect(page.getByTestId("account-link")).toHaveAttribute(
    "href",
    "https://www.instagram.com/3zprod/",
  );
  await expect(page.getByTestId("snapshot-row")).toHaveCount(2);

  // Audience asks: add, bump to 2, and see it in the All tab's top 3.
  await page.getByTestId("ask-input").fill("How to grade Log?");
  await page.getByTestId("ask-add").click();
  await expect(page.getByTestId("ask-row")).toHaveCount(1);
  await expect(page.getByTestId("ask-count")).toHaveText("1");
  await page.getByTestId("ask-bump").click();
  await expect(page.getByTestId("ask-count")).toHaveText("2");
  await page.getByTestId("growth-tab-all").click();
  await expect(page.getByTestId("top-ask")).toHaveCount(1);
  await expect(page.getByTestId("top-ask")).toContainText("How to grade Log?");
  await expect(page.getByTestId("top-ask-count")).toContainText("2");

  // Removing a snapshot goes through the confirm dialog.
  await page.getByTestId("growth-tab-tiktok").click();
  await expect(page.getByTestId("snapshot-row")).toHaveCount(1);
  await page.getByTestId("snapshot-remove").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("snapshot-row")).toHaveCount(0);
  await expect(page.getByTestId("chart-followers")).toContainText("٩٠");
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
    page.locator('[data-testid="platform-row"][data-platform="snapchat"]'),
  ).toContainText("400");
});

test("the platform tabs and the empty platform page fit the viewport", async ({ page }) => {
  await freshState(page, "/social/growth/");
  for (const p of ["tiktok", "instagram", "youtube", "x", "snapchat"]) {
    await page.getByTestId(`growth-tab-${p}`).click();
    await expect(page.getByTestId(`growth-tab-${p}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("growth-tab-all")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("stat-besttime")).toBeVisible();
    await expect(page.getByTestId("growth-chart")).toBeVisible();
    expect(await fitsViewport(page)).toBe(true);
  }
  // The form preselects the platform of the open tab.
  await page.getByTestId("growth-add").click();
  await expect(page.getByTestId("snapshot-platform")).toHaveValue("snapchat");
});
