import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// Ideas bank, iOS look (tools/18 §6): "new idea" opens a sheet; the star button, or a swipe toward the row's end
// edge (left in Arabic), keeps an idea in favorites; the status chips (favorites, waiting, used) filter the bank
// next to the source chips; favorites survive a reload.

async function addIdea(page: Page, text: string): Promise<void> {
  await page.getByTestId("idea-new").click();
  const sheet = page.getByTestId("idea-sheet");
  await expect(sheet).toBeVisible();
  await page.getByTestId("idea-text").fill(text);
  await page.getByTestId("idea-add").click();
  await expect(sheet).toHaveCount(0);
}

/**
 * Drag a row by (dx, dy): a finger on the phone (CDP touch events, so the row's `touch-action: pan-y` is what lets
 * a sideways drag through), the mouse on desktop.
 */
async function drag(page: Page, row: Locator, dx: number, dy = 0, touch = false): Promise<void> {
  const target = row.locator(".ios-row");
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await target.boundingBox())!;
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

  // The star button stars and unstars.
  const star = one.getByTestId("idea-star");
  await star.click();
  await expect(one).toHaveAttribute("data-favorite", "true");
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(star).toHaveAccessibleName("مفضلة");

  // A short drag springs back; past the arm point toward the end edge (left in RTL) it stars the idea; toward the
  // start edge nothing happens; the next full swipe unstars it.
  await drag(page, two, -40, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "false");
  await drag(page, two, -110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "true");
  await drag(page, two, 110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "true");
  await drag(page, two, -110, 0, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "false");
  // A drag that starts vertically belongs to the page: no favorite, and the row is back in place.
  await drag(page, two, -20, -160, isMobile);
  await expect(two).toHaveAttribute("data-favorite", "false");
  await expect(two.locator(".ios-row")).toHaveCSS("transform", /none|matrix\(1, 0, 0, 1, 0, 0\)/);

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
  await expect(one.getByTestId("idea-used-link")).toHaveAttribute(
    "href",
    /\/social\/calendar\/#post=.+/,
  );
  await page.getByTestId("ideas-filter-used").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Idea one");
  await page.getByTestId("ideas-filter-waiting").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Idea two");

  // Favorites are stored with the idea.
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Idea one" })).toHaveAttribute("data-favorite", "true");
  await expect(rows.filter({ hasText: "Idea two" })).toHaveAttribute("data-favorite", "false");

  // Remove takes the idea out of the bank.
  await rows.filter({ hasText: "Idea two" }).getByTestId("idea-remove").click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("ideas-list")).toHaveAttribute("data-count", "1");
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
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/social\/ideas\/$/);
  await expect(page.getByTestId("idea-row")).toHaveCount(0);
});
