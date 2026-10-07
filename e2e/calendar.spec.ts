import { expect, test, type Page } from "@playwright/test";
import { drainCelebrations, freshState } from "./helpers";

/** Today's Riyadh day key, computed the way lib/streak does it. */
function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
}

/** The post-card for `id`, wherever it is rendered. */
const cardFor = (page: Page, id: string) =>
  page.locator(`[data-testid="post-card"][data-post="${id}"]`);

test("plan a post from idea to posted: week, popup, script, shots, month and stages", async ({
  page,
}) => {
  const today = todayKey();
  await freshState(page, "/social/calendar/");

  // Fresh: week view (the segmented control's selected tab), today highlighted, empty state.
  await expect(page.getByTestId("calendar-view-week")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "الأسبوع" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`[data-testid="calendar-day"][data-day="${today}"]`)).toHaveAttribute(
    "data-today",
    "true",
  );
  await expect(page.getByTestId("calendar-empty")).toBeVisible();
  await expect(page.getByTestId("post-card")).toHaveCount(0);
  await noHorizontalScroll(page);

  // + New post → TikTok "Test reel" today with the template.
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await expect(page.getByTestId("post-form")).toBeVisible();
  await page.getByTestId("post-platform-tiktok").click();
  await page.getByTestId("post-title").fill("Test reel");
  await page.getByTestId("post-day").fill(today);
  await expect(page.getByTestId("post-time")).not.toHaveValue("");
  await expect(page.getByTestId("post-template")).toBeChecked();
  await page.getByTestId("post-save").click();
  await expect(page.getByTestId("post-form")).toBeHidden();

  const todayCol = page.locator(`[data-testid="calendar-day"][data-day="${today}"]`);
  const card = todayCol.getByTestId("post-card");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-stage", "idea");
  await expect(card).toHaveAttribute("data-platform", "tiktok");
  await expect(card).toContainText("Test reel");
  const id = (await card.getAttribute("data-post")) ?? "";
  expect(id).not.toBe("");
  await expect(page.getByTestId("calendar-empty")).toHaveCount(0);

  // Popup → Script tab: typing a hook + beats gives seconds > 0 and bumps the stage to "script".
  await card.locator("button").first().click();
  const sheet = page.getByTestId("post-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-post", id);
  await expect(page.getByTestId("post-stage-idea")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("post-tab-script").click();
  await page.getByTestId("script-hook").fill("وقّف! لا تكمّل تمرير قبل ما تشوف دا");
  await page.getByTestId("script-beat-1").fill("الفكرة ببساطة: اللقطة الأولى تحدد كل شي");
  await page.getByTestId("script-beat-2").fill("الخطوة اللي أغلب الناس تنساها");
  const seconds = Number(await page.getByTestId("script-length").getAttribute("data-seconds"));
  expect(seconds).toBeGreaterThan(0);
  await expect(page.getByTestId("post-stage-script")).toHaveAttribute("aria-pressed", "true");
  await expect(sheet).toHaveAttribute("data-stage", "script");

  // Shots tab: the template's shots are there; ticking them all suggests "Filmed".
  await page.getByTestId("post-tab-shots").click();
  const rows = page.getByTestId("shot-row");
  const n = await rows.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i++) await rows.nth(i).getByTestId("shot-toggle").click();
  await expect(page.locator('[data-testid="shot-row"][data-done="true"]')).toHaveCount(n);
  await expect(page.getByTestId("shots-progress")).toHaveText(`${n}/${n}`);
  await expect(page.getByTestId("shots-hint")).toBeVisible();
  await page.getByTestId("shots-apply").click();
  await expect(sheet).toHaveAttribute("data-stage", "filmed");
  await expect(page.getByTestId("post-stage-filmed")).toHaveAttribute("aria-pressed", "true");

  // Overview: link + Mark as posted → stage posted, "posted" toast.
  await page.getByTestId("post-tab-overview").click();
  await page.getByTestId("post-url").fill("https://www.tiktok.com/@3zprod/video/1");
  await page.getByTestId("post-mark-posted").click();
  await expect(sheet).toHaveAttribute("data-stage", "posted");
  const toast = page.getByTestId("toast");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-kind", "posted");
  await expect(page.getByTestId("post-posted-link")).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@3zprod/video/1",
  );
  await expect(page.getByTestId("post-unmark")).toBeVisible();
  await page.getByTestId("post-close").click();
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/#post=/);

  // Month view: a chip for today; Stages view: the card sits under "posted".
  await page.getByTestId("calendar-view-month").click();
  const todayCell = page.locator(`[data-testid="month-day"][data-day="${today}"]`);
  await expect(todayCell).toHaveAttribute("data-today", "true");
  await expect(todayCell.getByTestId("month-chip")).toHaveCount(1);
  await expect(todayCell.getByTestId("month-chip")).toHaveAttribute("data-post", id);
  await noHorizontalScroll(page);

  await page.getByTestId("calendar-view-stages").click();
  const postedCol = page.locator('[data-testid="stage-col"][data-stage="posted"]');
  await expect(postedCol.getByTestId("post-card")).toHaveAttribute("data-post", id);
  await expect(
    page.locator('[data-testid="stage-col"][data-stage="idea"]').getByTestId("post-card"),
  ).toHaveCount(0);
  await noHorizontalScroll(page);

  // Reload keeps everything.
  await page.reload();
  await expect(page.getByTestId("calendar-view-week")).toHaveAttribute("aria-selected", "true");
  await expect(cardFor(page, id)).toHaveAttribute("data-stage", "posted");
  await cardFor(page, id).locator("button").first().click();
  await expect(page.getByTestId("post-sheet")).toBeVisible();
  await page.getByTestId("post-tab-shots").click();
  await expect(page.locator('[data-testid="shot-row"][data-done="true"]')).toHaveCount(n);
  await page.getByTestId("post-tab-script").click();
  await expect(page.getByTestId("script-hook")).toHaveValue("وقّف! لا تكمّل تمرير قبل ما تشوف دا");
  await page.getByTestId("post-close").click();
  // Closing goes back off the entry the tap pushed (asynchronous): wait for it before the next navigation.
  await expect(page).not.toHaveURL(/#post=/);

  // Deep link contract: /social/calendar/#post=<id> opens that post's popup on load.
  await page.goto(`/social/calendar/#post=${id}`);
  const linked = page.getByTestId("post-sheet");
  await expect(linked).toBeVisible();
  await expect(linked).toHaveAttribute("data-post", id);
  await page.getByTestId("post-close").click();
  await expect(linked).toBeHidden();
  await expect(page).not.toHaveURL(/#post=/);

  // An unknown id falls back to the normal week view.
  await page.goto("/social/calendar/#post=nope");
  await expect(page.getByTestId("calendar-week-view")).toBeVisible();
  await expect(page.getByTestId("post-sheet")).toHaveCount(0);
  await expect(page).not.toHaveURL(/#post=/);
});

test("a post created from a skill completes its Produce quest when marked posted", async ({
  page,
}) => {
  const today = todayKey();
  await freshState(page, "/social/calendar/");

  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-youtube").click();
  await page.getByTestId("post-skill").fill("smart bins");
  await page.locator('[data-testid="post-skill-option"][data-skill="smart-bins-keywords"]').click();
  await expect(page.getByTestId("post-skill-picked")).toBeVisible();
  await page.getByTestId("post-day").fill(today);
  await page.getByTestId("post-save").click();

  const card = page.locator('[data-testid="post-card"][data-platform="youtube"]');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("post-linked-skill")).toBeVisible();
  await card.locator("button").first().click();
  const sheet = page.getByTestId("post-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("post-skill-linked")).toBeVisible();

  await page.getByTestId("post-url").fill("https://youtu.be/3zprod");
  await page.getByTestId("post-mark-posted").click();
  await expect(sheet).toHaveAttribute("data-stage", "posted");
  await expect(page.getByTestId("post-quest-done")).toBeVisible();
  // The small "posted" toast first, then the quest's XP toast (the celebration queue is one at a time).
  const toast = page.getByTestId("toast");
  await expect(toast).toHaveAttribute("data-kind", "posted");
  await expect(toast).toHaveAttribute("data-kind", "xp", { timeout: 8000 });
  await drainCelebrations(page, [], 6);

  // The Training world shows the quest done: DaVinci → the skill row reads 1/4.
  await page.goto("/skills/");
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  const row = page.locator('[data-testid="skill-row"][data-skill="smart-bins-keywords"]');
  await expect(row).toContainText("1/4");
  await row.click();
  await expect(page.getByTestId("quest-produce")).toHaveAttribute("aria-pressed", "true");
});

test("the stages board moves posts with ◀ ▶ but never into posted", async ({ page }) => {
  await freshState(page, "/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-x").click();
  await page.getByTestId("post-title").fill("Thread: color mistakes");
  await page.getByTestId("post-save").click();

  // No day: it sits in the unplanned tray.
  await expect(page.getByTestId("calendar-unplanned").getByTestId("post-card")).toHaveCount(1);

  await page.getByTestId("calendar-view-stages").click();
  const card = page.getByTestId("post-card");
  await expect(card).toHaveAttribute("data-stage", "idea");
  await expect(card.getByTestId("stage-back")).toBeDisabled();
  for (const stage of ["script", "filmed", "edited", "scheduled"]) {
    await card.getByTestId("stage-next").click();
    await expect(card).toHaveAttribute("data-stage", stage);
  }
  await expect(card.getByTestId("stage-next")).toBeDisabled();
  await card.getByTestId("stage-back").click();
  await expect(card).toHaveAttribute("data-stage", "edited");
  await noHorizontalScroll(page);

  // The platform filter hides it. Its chips show the brand glyph (an SVG) beside the name, no emoji.
  await expect(page.getByTestId("calendar-filter-tiktok").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("calendar-filter-tiktok")).toHaveText("تيك توك");
  await page.getByTestId("calendar-filter-tiktok").click();
  await expect(page.getByTestId("post-card")).toHaveCount(0);
  await page.getByTestId("calendar-filter-x").click();
  await expect(page.getByTestId("post-card")).toHaveCount(1);
});

test("the week strip rests on this week, a swipe to next week moves the view, a day can be picked", async ({
  page,
}) => {
  const today = todayKey();
  await freshState(page, "/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-x").click();
  await page.getByTestId("post-title").fill("Strip post");
  await page.getByTestId("post-day").fill(today);
  await page.getByTestId("post-save").click();

  // This week is the one in view (last and next week sit beside it, inert); today's cell carries the post's dot.
  const strip = page.getByTestId("calendar-strip");
  const page1 = () => strip.evaluate((el) => Math.abs(el.scrollLeft) / el.clientWidth);
  await expect.poll(page1).toBe(1);
  const todayCell = strip.locator(`[data-testid="calendar-strip-day"][data-day="${today}"]`);
  await expect(todayCell).toHaveAttribute("aria-current", "date");
  await expect(todayCell).toHaveAttribute("data-count", "1");
  await expect(todayCell.locator("xpath=ancestor::ol")).not.toHaveAttribute("inert");
  const thisWeek = (await page.getByTestId("calendar-week").textContent()) ?? "";

  // A swipe that comes to rest on next week moves the view there, and the strip is back on its middle week.
  await strip.evaluate((el) =>
    el.scrollBy({ left: (getComputedStyle(el).direction === "rtl" ? -1 : 1) * el.clientWidth }),
  );
  await expect(page.getByTestId("calendar-week")).not.toHaveText(thisWeek);
  await expect.poll(page1).toBe(1);
  await expect(page.getByTestId("post-card")).toHaveCount(0);
  await page.getByTestId("calendar-today").click();
  await expect(page.getByTestId("calendar-week")).toHaveText(thisWeek);

  // Picking a day fills its cell and marks its group; the month grid opens a day with posts in the week view.
  await todayCell.click();
  await expect(todayCell).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`[data-testid="calendar-day"][data-day="${today}"]`)).toHaveAttribute(
    "data-focus",
    "true",
  );
  await page.getByTestId("calendar-view-month").click();
  await page
    .locator(`[data-testid="month-day"][data-day="${today}"]`)
    .getByTestId("month-day-add")
    .click();
  await expect(page.getByTestId("calendar-view-week")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "cal-view-tab-week");
  await expect(page.getByTestId("post-card")).toHaveCount(1);
  await noHorizontalScroll(page);
});

test("the post popup and history: a tap pushes #post=, Back closes it with the exit, a deep link closes in place", async ({
  page,
}) => {
  await freshState(page, "/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-title").fill("Back test");
  await page.getByTestId("post-save").click();
  const card = page.getByTestId("post-card");
  const id = (await card.getAttribute("data-post")) ?? "";
  const sheet = page.getByTestId("post-sheet");

  // A tap pushes the popup's entry; Back closes the popup with the sheet's exit (motion on for this step) and stays
  // on the calendar.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await card.locator("button").first().click();
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/social/calendar/#post=${id}$`));
  await page.locator(".ios-sheet-root").evaluate((root) => {
    const phases: string[] = [];
    (window as unknown as { phases: string[] }).phases = phases;
    new MutationObserver(() => phases.push(root.getAttribute("data-phase") ?? "")).observe(root, {
      attributes: true,
      attributeFilter: ["data-phase"],
    });
  });
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/social\/calendar\/$/);
  expect(await page.evaluate(() => (window as unknown as { phases: string[] }).phases)).toContain(
    "exit",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Escape: the first one reverts a title edit in progress (the sheet stays), the next one closes the sheet and goes
  // back off its entry.
  await card.locator("button").first().click();
  await expect(page).toHaveURL(/#post=/);
  // The sheet's body scrolls; the segmented tabs keep their height instead of shrinking with it.
  expect((await sheet.getByRole("tablist").boundingBox())?.height).toBeGreaterThanOrEqual(32);
  const title = page.getByTestId("post-title-edit");
  await title.fill("Edited");
  await title.press("Escape");
  await expect(title).toHaveValue("Back test");
  await expect(sheet).toBeVisible();
  await title.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/social\/calendar\/$/);
  await expect(card).toContainText("Back test");

  // A deep link pushed nothing: ✕ clears the hash in place and never navigates away from the calendar.
  await page.goto("/social/");
  await page.goto(`/social/calendar/#post=${id}`);
  await expect(sheet).toBeVisible();
  await page.getByTestId("post-close").click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/social\/calendar\/$/);
  await expect(page.getByTestId("calendar-screen")).toBeVisible();
});

test("#new opens the new-post sheet once: the Studio's Plan a post lands on it", async ({
  page,
}) => {
  const today = todayKey();
  await freshState(page, "/social/calendar/");
  // A planned post turns the Studio hero to its "next post" state, with "Plan a post".
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-title").fill("Hero post");
  await page.getByTestId("post-day").fill(today);
  await page.getByTestId("post-save").click();
  await expect(page.getByTestId("post-form")).toBeHidden();

  await page.goto("/social/");
  await expect(page.getByTestId("studio-next")).toHaveAttribute("data-empty", "false");
  const plan = page.getByTestId("studio-next-cta");
  await expect(plan).toHaveAttribute("href", "/social/calendar/#new");
  await plan.click();
  await expect(page.getByTestId("post-form")).toBeVisible();
  await expect(page.getByTestId("post-day")).toHaveValue(today);
  await expect(page).toHaveURL(/\/social\/calendar\/$/);

  // The hash is gone, so a reload does not reopen it.
  await page.reload();
  await expect(page.getByTestId("calendar-screen")).toBeVisible();
  await expect(page.getByTestId("post-form")).toHaveCount(0);
});
