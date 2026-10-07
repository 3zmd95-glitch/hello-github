import { expect, test, type Page } from "@playwright/test";
import { freshState, switchLang } from "./helpers";

const SOCIAL_PATHS = [
  "/social/",
  "/social/calendar/",
  "/social/growth/",
  "/social/ideas/",
  "/social/website/",
  "/social/business/",
  "/social/automations/",
  "/social/replies/",
  "/social/more/",
];

// Spec §3.1: --bg per scheme.
const BG = { light: "rgb(242, 243, 246)", dark: "rgb(11, 13, 16)" } as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });
    for (const path of SOCIAL_PATHS) {
      test(`${path} uses the iOS tokens and fits the screen`, async ({ page }) => {
        await freshState(page, path);
        await expect(page.locator("html")).toHaveAttribute("data-world", "social");
        // Routes ship only the splash: wait for the screen so the fit check measures real content.
        await expect(page.locator("main h1").first()).toBeVisible();
        const css = await page.evaluate(() => {
          const s = getComputedStyle(document.body);
          return { font: s.fontFamily, bg: s.backgroundColor };
        });
        expect(css.font).toContain("Vazirmatn");
        expect(css.bg).toBe(BG[scheme]);
        const card = await page.evaluate(() => {
          const el = document.querySelector(".px-card, .ios-card, .ios-list") as HTMLElement | null;
          if (!el) return null;
          const s = getComputedStyle(el);
          return { border: parseFloat(s.borderTopWidth), radius: parseFloat(s.borderRadius) };
        });
        if (card) {
          expect(card.border).toBe(0);
          expect(card.radius).toBeGreaterThanOrEqual(16);
        }
        // Against the page's own width: on the phone (mobile emulation) innerWidth grows to fit any overflow.
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        );
        expect(fits).toBe(true);
      });
    }
  });
}

test("Training keeps the pixel look", async ({ page }) => {
  await freshState(page, "/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  const card = page.locator(".px-card").first();
  await expect(card).toBeVisible();
  const css = await card.evaluate((el) => ({
    font: getComputedStyle(document.body).fontFamily,
    radius: parseFloat(getComputedStyle(el).borderRadius),
    border: parseFloat(getComputedStyle(el).borderTopWidth),
  }));
  expect(css.font).toContain("Baloo Bhaijaan 2");
  expect(css.radius).toBe(2);
  expect(css.border).toBe(3);
});

test("Social shell: glass tab bar with icons, compact title after scrolling", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "tab bar is phone only");
  await freshState(page, "/social/");
  const tabbar = page.getByTestId("tabbar");
  await expect(tabbar).toHaveClass(/glass/);
  await expect(tabbar.locator("svg")).toHaveCount(5);
  await expect(tabbar.locator('a[href="/social/"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("compact-title")).toHaveCSS("opacity", "0");
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.locator("html")).toHaveAttribute("data-compact", "true");
  await expect(page.getByTestId("compact-title")).toHaveText("الاستوديو");
  await expect(page.getByTestId("compact-title")).toHaveCSS("opacity", "1");
});

/** Largest gap (px) between the tab bar lens and the tab at `href`, read in one frame (Infinity if either is missing). */
function lensGap(page: Page, href: string): Promise<number> {
  return page.evaluate((href) => {
    const lens = document.querySelector('[data-testid="tab-indicator"]');
    const tab = document.querySelector(`[data-testid="tabbar"] a[href="${href}"]`);
    if (!lens || !tab) return Infinity;
    const a = lens.getBoundingClientRect();
    const b = tab.getBoundingClientRect();
    return Math.max(
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
      Math.abs(a.width - b.width),
      Math.abs(a.height - b.height),
    );
  }, href);
}

test("Social tab bar: the lens follows the active tab, no lens without a tab, mini on scroll", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "tab bar is phone only");
  const html = page.locator("html");
  const tabbar = page.getByTestId("tabbar");
  // The suite runs with reduced motion, so no glide is in flight: the lens is on its final box at once.
  const lensOn = async (href: string) => {
    await expect(tabbar.locator(`a[href="${href}"]`)).toHaveAttribute("aria-current", "page");
    await expect.poll(() => lensGap(page, href)).toBeLessThanOrEqual(1);
  };

  await freshState(page, "/social/");
  await lensOn("/social/");

  // A clear scroll down minimizes the bar; back at the top it returns.
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(html).toHaveAttribute("data-tabbar", "mini");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(html).not.toHaveAttribute("data-tabbar");

  await tabbar.locator('a[href="/social/calendar/"]').click();
  await lensOn("/social/calendar/");

  // A language flip mirrors the row: the lens stays on the active tab both ways.
  await switchLang(page, "en");
  await expect(html).toHaveAttribute("dir", "ltr");
  await lensOn("/social/calendar/");
  await switchLang(page, "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
  await lensOn("/social/calendar/");

  // The same with the lens on screen during the flip: More holds the language control.
  await tabbar.locator('a[href="/social/more/"]').click();
  await lensOn("/social/more/");
  await page.getByTestId("lang-en").click();
  await expect(html).toHaveAttribute("dir", "ltr");
  await lensOn("/social/more/");
  await page.getByTestId("lang-ar").click();
  await expect(html).toHaveAttribute("dir", "rtl");
  await lensOn("/social/more/");

  // A route without a tab (opened from More) keeps the bar and shows no lens.
  await page.getByTestId("more-replies").click();
  await expect(page).toHaveURL(/\/social\/replies\/$/);
  await expect(tabbar).toBeVisible();
  await expect(page.getByTestId("tab-indicator")).toHaveCount(0);
});

test("reduced motion: the tab bar runs no transition or animation, also after a scroll", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "tab bar is phone only");
  // The suite runs with prefers-reduced-motion: reduce (playwright.config).
  await freshState(page, "/social/");
  const tabbar = page.getByTestId("tabbar");
  await expect(tabbar).toBeVisible();
  const running = () =>
    tabbar.evaluate(
      (el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    );
  expect(await running()).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.locator("html")).toHaveAttribute("data-tabbar", "mini");
  expect(await running()).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator("html")).not.toHaveAttribute("data-tabbar");
  expect(await running()).toBe(0);
});

test("theme-color follows the world and survives client navigation", async ({ page }) => {
  await freshState(page, "/social/");
  const colors = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('meta[name="theme-color"]')].map(
        (m) => `${m.getAttribute("media") ?? "all"} ${m.getAttribute("content")}`,
      ),
    );
  // Social: the page color per scheme (spec §3.1 --bg); Training: the pixel navy of the root layout.
  const social = ["(prefers-color-scheme: light) #f2f3f6", "(prefers-color-scheme: dark) #0b0d10"];
  await expect.poll(colors).toEqual(social);
  await page.locator('a[href="/social/more/"]:visible').first().click();
  await expect(page).toHaveURL(/\/social\/more\/$/);
  await expect.poll(colors).toEqual(social);
  await page.getByTestId("world-training").click();
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await expect.poll(colors).toEqual(["all #0d141d"]);
  await page.getByTestId("world-social").click();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
  await expect.poll(colors).toEqual(social);
});

test("Social navigation has no emoji", async ({ page }) => {
  await freshState(page, "/social/more/");
  await expect(page.locator("main h1").first()).toBeVisible(); // the splash has no content yet
  const text = await page.evaluate(
    () =>
      (document.querySelector('[data-testid="tabbar"], [data-testid="sidenav"]')?.textContent ??
        "") + (document.querySelector("main")?.querySelector("h1")?.textContent ?? ""),
  );
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
});

test("small controls keep their look and take taps on a 44px band; Training's stay as they are", async ({
  page,
}) => {
  await freshState(page, "/social/calendar/");
  await expect(page.locator("main h1").first()).toBeVisible();
  // The control's height, and whether a point `past` px above its visible edge (a segment's edge is its track's)
  // still lands on it.
  const probe = (testId: string, past: number) =>
    page.getByTestId(testId).evaluate((el, past) => {
      const r = el.getBoundingClientRect();
      const edge = el.closest(".ios-seg")?.getBoundingClientRect() ?? r;
      const hit = document.elementFromPoint(r.left + r.width / 2, edge.top - past);
      return { height: Math.round(r.height), above: el.contains(hit) };
    }, past);
  // A filter chip looks 34px tall and takes a tap 4px above its top (its band is 44px).
  expect(await probe("calendar-filter-tiktok", 4)).toEqual({ height: 34, above: true });
  // A segment looks 32px tall in its 38px track and takes a tap 2px above the track.
  expect(await probe("calendar-view-month", 2)).toEqual({ height: 32, above: true });
  // Training's pixel small buttons get no band.
  await freshState(page, "/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  const band = await page
    .getByTestId("sound-toggle")
    .evaluate((el) => getComputedStyle(el, "::after").content);
  expect(band).toBe("none");
});
