import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshState, seedState } from "./helpers";

// Ideas bank, iOS look (tools/18 §6): "new idea" opens a sheet; the star button, or a swipe toward the row's end
// edge (left in Arabic), keeps an idea in favorites; the status chips (favorites, waiting, used) filter the bank
// next to the source chips; favorites survive a reload; remove asks first; a saved idea rises into the list.

/** Replace the saved state with these ideas only (as a reload after earlier visits would find them). */
async function seedIdeas(page: Page, ideas: Record<string, unknown>[]): Promise<void> {
  await seedState(page, "/social/ideas/", { ideas });
}

async function addIdea(page: Page, text: string): Promise<void> {
  await page.getByTestId("idea-new").click();
  const sheet = page.getByTestId("idea-sheet");
  await expect(sheet).toBeVisible();
  await page.getByTestId("idea-text").fill(text);
  await page.getByTestId("idea-add").click();
  await expect(sheet).toHaveCount(0);
}

test("state setup replaces saved ideas after the service worker takes control", async ({
  page,
}) => {
  await seedIdeas(page, [
    {
      id: "before-reset",
      text: "Before reset",
      source: "me",
      createdAt: "2026-01-01T09:00:00.000Z",
    },
  ]);
  await expect(page.getByTestId("idea-row")).toContainText("Before reset");
  // A second setup must unload the app even when its production worker controls navigations.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await seedIdeas(page, [
    { id: "after-reset", text: "After reset", source: "me", createdAt: "2026-01-02T09:00:00.000Z" },
  ]);
  await expect(page.getByTestId("idea-row")).toHaveCount(1);
  await expect(page.getByTestId("idea-row")).toContainText("After reset");
  await freshState(page, "/social/ideas/");
  await expect(page.getByTestId("ideas-empty")).toBeVisible();
  await expect(page.getByTestId("idea-row")).toHaveCount(0);
});

/**
 * Press on `start` and drag by (dx, dy): a finger on the phone (CDP touch events, so the row's `touch-action:
 * pan-y` is what lets a sideways drag through), the mouse on desktop.
 */
async function drag(page: Page, start: Locator, dx: number, dy = 0, touch = false): Promise<void> {
  await start.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await start.boundingBox())!;
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const at = (i: number) => ({ x: x0 + (dx * i) / 8, y: y0 + (dy * i) / 8 });
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const send = (
      type: "touchStart" | "touchMove" | "touchEnd",
      points: { x: number; y: number }[],
    ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await send("touchStart", [at(0)]);
    for (let i = 1; i <= 8; i++) await send("touchMove", [at(i)]);
    await send("touchEnd", []);
    await cdp.detach();
  } else {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(at(i).x, at(i).y);
    await page.mouse.up();
  }
}

test("ideas bank: a new idea from the sheet, favorites by the star and by a swipe, status filters", async ({
  page,
  isMobile,
}) => {
  await freshState(page, "/social/ideas/");
  await expect(page.getByTestId("ideas-empty")).toBeVisible();
  // No filters over an empty bank.
  await expect(page.getByTestId("ideas-filter-all")).toHaveCount(0);

  await addIdea(page, "Idea one");
  await addIdea(page, "Idea two");
  const rows = page.getByTestId("idea-row");
  await expect(rows).toHaveCount(2);
  const one = rows.filter({ hasText: "Idea one" });
  const two = rows.filter({ hasText: "Idea two" });
  await expect(one).toHaveAttribute("data-favorite", "false");
  // A just-saved idea rises into the list.
  await expect(two).toHaveClass(/idea-rise/);

  // The star button stars and unstars; its name says which idea.
  const star = one.getByTestId("idea-star");
  await star.click();
  await expect(one).toHaveAttribute("data-favorite", "true");
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(star).toHaveAccessibleName("مفضلة: «Idea one»");

  // A short drag springs back; past the arm point toward the end edge (left in RTL) it stars the idea; toward the
  // start edge nothing happens; the next full swipe unstars it.
  const twoRow = two.locator(".ios-row");
  await drag(page, twoRow, -40, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "false");
  await drag(page, twoRow, -110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "true");
  await drag(page, twoRow, 110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "true");
  await drag(page, twoRow, -110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "false");
  // A drag that starts vertically belongs to the page: no favorite, and the row is back in place.
  await drag(page, twoRow, -20, -160, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "false");
  await expect(twoRow).toHaveCSS("transform", /none|matrix\(1, 0, 0, 1, 0, 0\)/);
  // A swipe that starts on a control swipes the row: the button never gets a click, so its picker stays shut.
  const use = two.getByTestId("idea-use");
  await drag(page, use, -110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "true");
  await expect(two.getByTestId("idea-use-tiktok")).toHaveCount(0);
  await drag(page, use, -110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "false");
  await expect(two.getByTestId("idea-use-tiktok")).toHaveCount(0);
  await expect(use).toBeVisible();

  // Status chips: favorites, waiting (no post yet), used (planned as a post).
  await page.getByTestId("ideas-filter-favorites").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Idea one");
  await page.getByTestId("ideas-filter-used").click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId("ideas-empty")).toContainText("ما فيه أفكار هنا لسّا");
  await page.getByTestId("ideas-filter-all").click();
  await one.getByTestId("idea-use").click();
  await one.getByTestId("idea-use-tiktok").click();
  await expect(one).toHaveAttribute("data-used", "true");
  // The button turns into the calendar chip with a pop, and the chip takes the focus.
  const chip = one.getByTestId("idea-used-link");
  await expect(chip).toHaveAttribute("href", /\/social\/calendar\/#post=.+/);
  await expect(chip).toHaveClass(/ios-pop/);
  await expect(chip).toBeFocused();
  await page.getByTestId("ideas-filter-used").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Idea one");
  await page.getByTestId("ideas-filter-waiting").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Idea two");

  // A new idea is never hidden by a filter: saving one shows the whole bank again.
  await page.getByTestId("ideas-filter-favorites").click();
  await addIdea(page, "Idea three");
  await expect(page.getByTestId("ideas-filter-all")).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(3);

  // Favorites are stored with the idea.
  await page.reload();
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Idea one" })).toHaveAttribute("data-favorite", "true");
  await expect(rows.filter({ hasText: "Idea two" })).toHaveAttribute("data-favorite", "false");

  // Remove is a danger-red button that asks first (an iOS alert naming the idea): Cancel keeps it, the red
  // button removes it.
  const remove = rows.filter({ hasText: "Idea two" }).getByTestId("idea-remove");
  await expect(remove).toHaveCSS("color", "rgb(208, 51, 43)");
  await remove.click();
  const alert = page.getByRole("alertdialog");
  await expect(alert).toContainText("Idea two");
  await page.getByTestId("confirm-cancel").click();
  await expect(alert).toHaveCount(0);
  await expect(rows).toHaveCount(3);
  await remove.click();
  await page.getByTestId("confirm-ok").click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("ideas-list")).toHaveAttribute("data-count", "2");
});

test("an emptied bank drops its filter, so an idea saved from a skill shows and rises in", async ({
  page,
}) => {
  // One old favorite in the bank, a very long one: loaded, not new, so it does not rise.
  const long = `An old favorite ${"that keeps going and going ".repeat(12)}until the end`;
  await seedIdeas(page, [
    { id: "old", text: long, source: "me", createdAt: "2026-01-01T09:00:00.000Z", favorite: true },
  ]);
  const rows = page.getByTestId("idea-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).not.toHaveClass(/idea-rise/);

  // Favorites on, then the last idea goes: no chips are left to show the filter, so it is dropped. The trash is
  // named with the whole idea; the alert's title cuts it (about 60 characters), so the alert stays on the screen.
  await page.getByTestId("ideas-filter-favorites").click();
  const remove = rows.first().getByTestId("idea-remove");
  await expect(remove).toHaveAccessibleName(`احذف الفكرة «${long}»`);
  await remove.click();
  const alert = page.getByRole("alertdialog");
  const title = alert.getByRole("heading");
  await expect(title).toHaveText(/^احذف الفكرة «An old favorite that keeps going .*…»$/);
  expect(((await title.textContent()) ?? "").length).toBeLessThanOrEqual(80);
  const box = (await alert.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("ideas-empty")).toBeVisible();
  await expect(page.getByTestId("ideas-filter-all")).toHaveCount(0);

  // A skill saved from the suggestions (not a favorite) lands in the visible list and rises in.
  await page.getByTestId("ideas-from-skills").getByTestId("skill-idea-save").first().click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-source", "skill");
  await expect(rows.first()).toHaveClass(/idea-rise/);
  await expect(page.getByTestId("ideas-filter-all")).toHaveAttribute("aria-pressed", "true");
});

test("planning the first of many waiting ideas keeps its row in place: the page does not move", async ({
  page,
}) => {
  // Seven waiting ideas, the newest first.
  await seedIdeas(
    page,
    Array.from({ length: 7 }, (_, i) => ({
      id: `w${i}`,
      text: `Waiting idea ${i}`,
      source: "me",
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    })),
  );
  const rows = page.getByTestId("idea-row");
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toHaveAttribute("data-idea", "w6");

  // Plan the first one with its picker on screen; note where the page and the row are.
  await rows.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await rows.first().getByTestId("idea-use").click();
  const tiktok = rows.first().getByTestId("idea-use-tiktok");
  await tiktok.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  const top = await rows.first().evaluate((el) => el.getBoundingClientRect().top);
  await tiktok.click();

  // Used now, but still the first row, at the same place, the page unmoved; the chip popped where the button was
  // and has the focus.
  const first = rows.first();
  await expect(first).toHaveAttribute("data-idea", "w6");
  await expect(first).toHaveAttribute("data-used", "true");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(
    Math.abs((await first.evaluate((el) => el.getBoundingClientRect().top)) - top),
  ).toBeLessThanOrEqual(1);
  const chip = first.getByTestId("idea-used-link");
  await expect(chip).toBeInViewport();
  await expect(chip).toBeFocused();
  await expect(chip).toHaveClass(/ios-pop/);

  // The next visit sorts it with the used ideas, after the waiting ones.
  await page.reload();
  await expect(rows.last()).toHaveAttribute("data-idea", "w6");
});

test("the new-idea sheet closes with ✕ and with Back, and keeps nothing it was not told to save", async ({
  page,
}) => {
  await freshState(page, "/social/ideas/");
  const sheet = page.getByTestId("idea-sheet");
  await page.getByTestId("idea-new").click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "فكرة جديدة" })).toBeVisible();
  await expect(page.getByTestId("idea-add")).toBeDisabled();
  await page.getByTestId("idea-text").fill("Not saved");
  await sheet.getByRole("button", { name: "سكّر" }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByTestId("idea-new").click();
  await expect(sheet).toBeVisible();
  // Back is armed once the sheet has opened: it pushes its own history entry (components/player/useBackToClose).
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((history.state as Record<string, unknown> | null)?.["3z-player"]),
      ),
    )
    .toBe(true);
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/social\/ideas\/$/);
  await expect(page.getByTestId("idea-row")).toHaveCount(0);
});
