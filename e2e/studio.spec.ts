import { expect, test, type Page } from "@playwright/test";
import { freshState, switchLang } from "./helpers";

// The tier-2 DaVinci skill the mastery and map specs use; first in the seed, so it always shows up in the
// ideas bank's "skills without a video" list.
const SKILL_ID = "smart-bins-keywords";
const STORAGE_KEY = "3z-prod-v1";

const fitsViewport = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Today's Riyadh day key, the way lib/streak computes it. */
const riyadhToday = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/** Open the DaVinci skill's sheet from the Skills screen. */
async function openSkillSheet(page: Page) {
  await page.goto("/skills/");
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`).click();
  const sheet = page.getByTestId("skill-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

test("fresh Studio: empty hero with a calendar CTA, empty week, all-clear inbox", async ({
  page,
}) => {
  await freshState(page, "/social/");
  await expect(page.getByTestId("studio-screen")).toBeVisible();

  const hero = page.getByTestId("studio-next");
  await expect(hero).toHaveAttribute("data-empty", "true");
  await expect(page.getByTestId("studio-next-cta")).toHaveAttribute(
    "href",
    "/social/calendar/#new",
  );
  await expect(page.getByTestId("studio-countdown")).toHaveCount(0);

  const week = page.getByTestId("studio-week");
  await expect(week).toHaveAttribute("data-total", "0");
  await expect(week.locator(".studio-wday")).toHaveCount(7);
  await expect(week.locator('.studio-wday[data-today="true"]')).toHaveCount(1);
  await expect(page.getByTestId("studio-week-empty")).toBeVisible();

  await expect(page.getByTestId("studio-inbox-empty")).toBeVisible();
  // The Social Analytics seed (Beacons, Sep 27 2026) fills the growth card on first load.
  await expect(page.getByTestId("studio-growth")).toHaveAttribute("data-empty", "false");
  await expect(page.getByTestId("studio-growth-followers")).toHaveAttribute("data-value", "1478");
  await expect(page.getByTestId("studio-growth-open")).toHaveAttribute("href", "/social/growth/");
  await expect(page.getByTestId("studio-asks-empty")).toBeVisible();

  // Nothing done in Training today → the flame is waiting, with a 🎮 way back.
  await expect(page.getByTestId("studio-reminder")).toHaveAttribute("data-flame", "waiting");
  await expect(page.getByTestId("studio-flame-go")).toHaveAttribute("href", "/");

  expect(await fitsViewport(page)).toBe(true);
});

test("ideas bank → calendar → skill sheet → map → Studio hero: the bridge round trip", async ({
  page,
}) => {
  test.slow();
  await freshState(page, "/skills/");

  // ① Tick Train on the skill: the Produce row offers to plan the video, nothing is in the calendar yet.
  let sheet = await openSkillSheet(page);
  await page.getByTestId("quest-train").click();
  await expect(page.getByTestId("sheet-progress")).toHaveText("1/4");
  const produceRow = sheet.locator('[data-quest="produce"]');
  await expect(produceRow.getByTestId("quest-plan-video")).toBeVisible();
  await expect(produceRow.getByTestId("quest-in-calendar")).toHaveCount(0);
  await page.getByTestId("sheet-close").click();
  await expect(sheet).toBeHidden();

  // ② Ideas bank: skill suggestions, the started skill first; plan its video on Instagram.
  await page.goto("/social/ideas/");
  await expect(page.getByTestId("ideas-screen")).toBeVisible();
  await expect(page.getByTestId("ideas-empty")).toBeVisible();
  const suggestions = page.getByTestId("ideas-from-skills");
  const skillRows = suggestions.getByTestId("skill-idea-row");
  expect(await skillRows.count()).toBeGreaterThanOrEqual(5);
  await expect(skillRows.first()).toHaveAttribute("data-skill", SKILL_ID);
  await expect(skillRows.first()).toHaveAttribute("data-done", "1");
  await skillRows.first().getByTestId("skill-idea-plan").click();
  await skillRows.first().getByTestId("skill-idea-post-instagram").click();
  await expect(page.getByTestId("ideas-planned-notice")).toBeVisible();
  await expect(page.getByTestId("ideas-planned-open")).toHaveAttribute(
    "href",
    /\/social\/calendar\/#post=.+/,
  );
  await expect(
    suggestions.locator(`[data-testid="skill-idea-row"][data-skill="${SKILL_ID}"]`),
  ).toHaveCount(0);

  // ③ Add an idea of my own and turn it into a TikTok post.
  await page.getByTestId("idea-new").click();
  await page.getByTestId("idea-text").fill("Grade Log in 60s");
  await page.getByTestId("idea-source-me").click();
  await page.getByTestId("idea-add").click();
  const ideaRow = page.getByTestId("idea-row");
  await expect(ideaRow).toHaveCount(1);
  await expect(ideaRow).toHaveAttribute("data-source", "me");
  await expect(ideaRow).toHaveAttribute("data-used", "false");
  await expect(ideaRow).toContainText("Grade Log in 60s");
  await ideaRow.getByTestId("idea-use").click();
  await ideaRow.getByTestId("idea-use-tiktok").click();
  await expect(ideaRow).toHaveAttribute("data-used", "true");
  await expect(ideaRow.getByTestId("idea-used-link")).toHaveAttribute(
    "href",
    /\/social\/calendar\/#post=.+/,
  );
  await expect(ideaRow.getByTestId("idea-use")).toHaveCount(0);

  // Filters: "skill" hides my idea, "me" shows it.
  await page.getByTestId("ideas-filter-skill").click();
  await expect(page.getByTestId("idea-row")).toHaveCount(0);
  await page.getByTestId("ideas-filter-me").click();
  await expect(page.getByTestId("idea-row")).toHaveCount(1);
  expect(await fitsViewport(page)).toBe(true);

  // ④ Back in Training: the Produce row shows the "in the calendar" chip instead of the plan button.
  sheet = await openSkillSheet(page);
  const chip = sheet.locator('[data-quest="produce"]').getByTestId("quest-in-calendar");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("href", /\/social\/calendar\/#post=.+/);
  await expect(sheet.getByTestId("quest-plan-video")).toHaveCount(0);
  await expect(page.getByTestId("sheet-progress")).toHaveText("1/4");
  await page.getByTestId("sheet-close").click();

  // ⑤ The map node carries the 📱 badge.
  await page.goto("/map/#island=davinci");
  const node = page.locator(`[data-testid="skill-node"][data-skill="${SKILL_ID}"]`);
  await expect(node).toHaveAttribute("data-in-calendar", "true");
  await expect(node.getByTestId("skill-node-calendar")).toBeVisible();
  await expect(page.locator('[data-testid="skill-node"][data-in-calendar="true"]')).toHaveCount(1);

  // ⑥ Give the skill's post a day (the calendar UI is another agent's) and seed one audience ask, then the
  // Studio hero shows it with a countdown and the week plan counts it.
  const today = riyadhToday();
  await page.evaluate(
    ([key, day, skillId]) => {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error("no saved state");
      const saved = JSON.parse(raw) as {
        state: {
          posts: { skillId?: string; plannedDay: string | null; plannedTime: string | null }[];
          audienceAsks: unknown[];
        };
      };
      const post = saved.state.posts.find((p) => p.skillId === skillId);
      if (!post) throw new Error("no skill post");
      post.plannedDay = day;
      post.plannedTime = "23:59";
      saved.state.audienceAsks = [
        {
          id: "ask-e2e",
          text: "How do you get the green cinematic look?",
          count: 42,
          createdAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem(key, JSON.stringify(saved));
    },
    [STORAGE_KEY, today, SKILL_ID] as const,
  );
  await page.goto("/social/");
  const hero = page.getByTestId("studio-next");
  await expect(hero).toHaveAttribute("data-empty", "false");
  await expect(hero).toHaveAttribute("data-overdue", "false");
  await expect(page.getByTestId("studio-next-linked")).toBeVisible();
  await expect(page.getByTestId("studio-countdown")).not.toBeEmpty();
  await expect(page.getByTestId("studio-next-open")).toHaveAttribute(
    "href",
    /\/social\/calendar\/#post=.+/,
  );
  const week = page.getByTestId("studio-week");
  await expect(week).toHaveAttribute("data-total", "1");
  await expect(week.getByTestId("studio-week-post")).toHaveCount(1);
  await expect(week.locator('.studio-wday[data-today="true"]')).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("studio-reminder")).toHaveAttribute("data-has-post", "true");

  // The ask can become an idea from the Studio.
  await expect(page.getByTestId("ask-row")).toHaveCount(1);
  await page.getByTestId("ask-to-idea").click();
  await expect(page.getByTestId("ask-in-ideas")).toHaveAttribute("href", "/social/ideas/");
  // The button morphed into the chip, which took its focus.
  await expect(page.getByTestId("ask-in-ideas")).toBeFocused();
  // …which the inbox now counts as waiting.
  await expect(page.locator('[data-testid="inbox-row"][data-kind="ideas"]')).toHaveAttribute(
    "href",
    "/social/ideas/",
  );
  expect(await fitsViewport(page)).toBe(true);

  // ⑦ Reload keeps everything.
  await page.reload();
  await expect(page.getByTestId("studio-next")).toHaveAttribute("data-empty", "false");
  await expect(page.getByTestId("studio-week")).toHaveAttribute("data-total", "1");
  await page.goto("/social/ideas/");
  await expect(page.getByTestId("idea-row")).toHaveCount(2);
  await expect(page.locator('[data-testid="idea-row"][data-source="me"]')).toHaveAttribute(
    "data-used",
    "true",
  );
  await expect(page.locator('[data-testid="idea-row"][data-source="audience"]')).toHaveAttribute(
    "data-used",
    "false",
  );
});

test("first visit: a date eyebrow and the staggered entrance; coming back does not stagger again", async ({
  page,
}) => {
  await freshState(page, "/social/");
  const screen = page.getByTestId("studio-screen");
  await expect(screen.locator(".ios-eyebrow")).not.toBeEmpty();
  await expect(screen.locator(".ios-stagger")).toHaveCount(1);
  // Away (a client-side navigation) and back: the cards are simply there.
  await page.getByTestId("studio-week-open").click();
  await expect(page).toHaveURL(/\/social\/calendar\/$/);
  await page.goBack();
  await expect(screen).toBeVisible();
  await expect(screen.locator(".ios-stagger")).toHaveCount(0);
  await expect(screen.locator(".ios-eyebrow")).not.toBeEmpty();
});

test("week cells: one post opens the post, two open the day, an empty day is not a link", async ({
  page,
}) => {
  await freshState(page, "/social/");
  const week = page.getByTestId("studio-week");
  // evaluateAll does not wait: let the week render its 7 days first.
  await expect(week.locator(".studio-wday")).toHaveCount(7);
  const [one, two, none] = await week
    .locator(".studio-wday")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-day") ?? ""));
  await page.evaluate(
    ([key, one, two, now]) => {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error("no saved state");
      const saved = JSON.parse(raw) as { state: { posts: unknown[] } };
      const post = (id: string, platform: string, day: string) => ({
        id,
        platform,
        title: id,
        stage: "script",
        plannedDay: day,
        plannedTime: "20:00",
        createdAt: now,
        updatedAt: now,
      });
      saved.state.posts.push(
        post("week-one", "tiktok", one),
        post("week-two-a", "instagram", two),
        post("week-two-b", "youtube", two),
      );
      localStorage.setItem(key, JSON.stringify(saved));
    },
    [STORAGE_KEY, one, two, new Date().toISOString()] as const,
  );
  await page.reload();
  await expect(week).toHaveAttribute("data-total", "3");
  const cell = (day: string) => week.locator(`.studio-wday[data-day="${day}"]`);
  await expect(cell(one)).toHaveAttribute("href", "/social/calendar/#post=week-one");
  await expect(cell(two)).toHaveAttribute("href", `/social/calendar/#day=${two}`);
  await expect(cell(two).getByTestId("studio-week-post")).toHaveCount(2);
  expect(await cell(none).evaluate((e) => [e.tagName, e.getAttribute("href")])).toEqual([
    "DIV",
    null,
  ]);
  await expect(cell(none).getByTestId("studio-week-post")).toHaveCount(0);
});

test("pull to refresh: the page follows the finger, holds while the spinner turns, then springs back with a toast", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "a touch gesture");
  await freshState(page, "/social/");
  await expect(page.getByTestId("studio-screen")).toBeVisible();
  // The pull is armed once the page's own overscroll bounce is off (usePullToRefresh's effect).
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.overscrollBehaviorY))
    .toBe("none");
  const main = () =>
    page.evaluate(() => {
      const m = document.getElementById("main")!;
      return { transform: m.style.transform, transition: m.style.transition };
    });
  // Real touch events (CDP), from the hero downwards: 200px of finger = 110px of page (resistance 0.55).
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y = 0) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }],
    });
  await touch("touchStart", 260);
  for (let d = 20; d <= 200; d += 20) await touch("touchMove", 260 + d);
  // The listeners are passive: the browser does not wait for them, so the last move lands a moment later.
  await expect.poll(async () => (await main()).transform).toBe("translateY(110px)");
  // The spinner is portaled to <body>: inside the moving #main it would ride along.
  expect(
    await page.getByTestId("studio-ptr").evaluate((e) => e.parentElement === document.body),
  ).toBe(true);

  // Past 70px: the release holds the page at 56px while the spinner turns; the toast waits for its 1.1s.
  await touch("touchEnd");
  const released = Date.now();
  await expect(page.getByTestId("studio-ptr")).toHaveAttribute("data-spin", "true");
  expect((await main()).transform).toBe("translateY(56px)");
  await expect(page.getByTestId("toast")).toContainText("تم التحديث الحين");
  expect(Date.now() - released).toBeGreaterThanOrEqual(1000);
  // Sprung back: no inline transform left, and the transition is cleared after it.
  await expect.poll(main).toEqual({ transform: "", transition: "" });
  await expect(page.getByTestId("studio-ptr")).toHaveCount(0);
});

test("RTL and LTR both render the Studio without horizontal scroll", async ({ page }) => {
  await freshState(page, "/social/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await fitsViewport(page)).toBe(true);
  await switchLang(page, "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("studio-next")).toContainText("No post planned yet");
  expect(await fitsViewport(page)).toBe(true);
  await page.goto("/social/ideas/");
  await expect(page.getByTestId("ideas-screen")).toContainText("Ideas bank");
  expect(await fitsViewport(page)).toBe(true);
});

test("a post whose X step is due shows a manual inbox row that opens the hub's list", async ({
  page,
}) => {
  await freshState(page, "/social/");
  await expect(page.getByTestId("studio-inbox-empty")).toBeVisible();

  // Seed a TikTok post with X in its auto-post, planned for 00:00 today (Riyadh): its X step is due.
  const at = new Date().toISOString();
  await page.evaluate(
    ([key, day, now]) => {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error("no saved state");
      const saved = JSON.parse(raw) as { state: { posts: unknown[] } };
      saved.state.posts.push(
        {
          id: "manual-e2e",
          platform: "tiktok",
          title: "Match cut",
          caption: "How I do a match cut",
          stage: "scheduled",
          plannedDay: day,
          plannedTime: "00:00",
          autoPost: { platforms: ["tiktok", "x"] },
          createdAt: now,
          updatedAt: now,
        },
        // Tomorrow: nothing due yet.
        {
          id: "manual-later",
          platform: "tiktok",
          title: "Tomorrow's one",
          stage: "scheduled",
          plannedDay: new Date(Date.parse(`${day}T12:00:00+03:00`) + 86_400_000)
            .toISOString()
            .slice(0, 10),
          plannedTime: "00:00",
          autoPost: { platforms: ["tiktok", "snapchat"] },
          createdAt: now,
          updatedAt: now,
        },
      );
      localStorage.setItem(key, JSON.stringify(saved));
    },
    [STORAGE_KEY, riyadhToday(), at] as const,
  );
  await page.reload();

  const manual = page.locator('[data-testid="inbox-row"][data-kind="manual"]');
  await expect(manual).toHaveCount(1);
  await expect(manual).toHaveAttribute("href", "/social/automations/#manual");
  await expect(manual).toContainText("Match cut");
  await expect(manual).toContainText("إكس");
  // The post is past its time too, but the manual row stands in for it: one row, counted once.
  const kinds = await page
    .getByTestId("inbox-row")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
  expect(kinds).toEqual(["manual"]);
  await expect(page.getByTestId("studio-inbox")).toHaveAttribute("data-count", "1");
  expect(await fitsViewport(page)).toBe(true);

  await switchLang(page, "en");
  await expect(manual).toContainText("ready for X");

  // It lands on the hub's "Post these yourself" list, scrolled into view.
  await manual.click();
  await expect(page).toHaveURL(/\/social\/automations\/#manual$/);
  await expect(page.getByTestId("autopost-manual")).toBeInViewport();
  await expect(
    page.locator('[data-testid="autopost-manual-post"][data-post="manual-e2e"]'),
  ).toBeVisible();
});
