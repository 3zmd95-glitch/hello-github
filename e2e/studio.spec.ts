import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// The tier-2 DaVinci skill the mastery and map specs use; first in the seed, so it always shows up in the
// ideas bank's "skills without a video" list.
const SKILL_ID = "smart-bins-keywords";
const STORAGE_KEY = "3z-prod-v1";

const fitsViewport = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

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
  await expect(page.getByTestId("studio-next-cta")).toHaveAttribute("href", "/social/calendar/");
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

test("RTL and LTR both render the Studio without horizontal scroll", async ({ page }) => {
  await freshState(page, "/social/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await fitsViewport(page)).toBe(true);
  await page.getByTestId("lang-en").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("studio-next")).toContainText("No post planned yet");
  expect(await fitsViewport(page)).toBe(true);
  await page.goto("/social/ideas/");
  await expect(page.getByTestId("ideas-screen")).toContainText("Ideas bank");
  expect(await fitsViewport(page)).toBe(true);
});
