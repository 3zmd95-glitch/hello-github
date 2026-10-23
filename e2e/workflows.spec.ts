import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { freshState, seedState } from "./helpers";

// ⚙️ Workflows (packet DT-4): local chains that create an idea, a calendar post and a planner row. Preview writes
// nothing, Run now leaves linked outputs, the article Ready commit queues runs (paused workflows none), two tabs
// draining one run make one set of outputs, and unsaved workflow edits survive leaving through the sidebar. Nothing
// leaves the device: no Worker, local AI or other origin is contacted.

const KEY = "3z-prod-v1";
const LOCK = "3z-prod-articles";
const SKILL = "smart-bins-keywords";
const AT = "2026-10-16T12:00:00.000Z";
/** The app shell's Google Fonts stylesheet and font files (app/layout.tsx): every route loads them. */
const SHELL_FONTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

function watchForbidden(page: Page): string[] {
  const forbidden: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (!url.protocol.startsWith("http") || SHELL_FONTS.has(url.hostname)) return;
    if (
      url.hostname.endsWith("workers.dev") ||
      url.pathname.startsWith("/api/local-ai/") ||
      url.hostname !== "localhost"
    )
      forbidden.push(req.url());
  });
  return forbidden;
}

const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const state = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).state, KEY);
const saved = (page: Page) =>
  expect(page.getByTestId("workflows-save-status")).toHaveAttribute("data-state", "saved");

const manualActions = [
  { id: "i1", kind: "idea", text: { ar: "فكرة {date}", en: "Idea {date}" } },
  {
    id: "p1",
    kind: "post",
    platform: "tiktok",
    title: { ar: "مقطع {date}", en: "Clip {date}" },
    caption: { ar: "", en: "" },
    offsetDays: 1,
  },
  { id: "q1", kind: "plan", quest: "produce", skillId: SKILL, minutes: 30, day: "lightest" },
];
const workflow = (over: Record<string, unknown> = {}) => ({
  id: "wf-a",
  name: { ar: "يومي", en: "Daily" },
  trigger: { kind: "manual" },
  actions: manualActions,
  enabled: true,
  revision: 1,
  commitId: "wf-a-baseline",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

test("build a manual workflow, preview it without writing, run it and follow its outputs", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  await freshState(page, "/social/more/");
  await page.getByTestId("more-workflows").click();
  await expect(page.getByTestId("workflows-screen")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("workflows-local-only")).toContainText("المتصفح مفتوح");
  expect(await fits(page)).toBe(true);

  await page.getByTestId("workflows-new").click();
  await expect(page).toHaveURL(/\/social\/workflows\/#w=[\w-]+$/);
  await page.getByTestId("workflows-name-ar").fill("سلسلة يومية");
  await page.getByTestId("workflows-idea-text-ar").fill("فكرة {date}");
  await page.getByTestId("workflows-add-post").click();
  await page.getByTestId("workflows-post-title-ar").fill("مقطع {date}");
  await page.getByTestId("workflows-add-plan").click();
  await page.getByTestId("workflows-plan-skill").selectOption(SKILL);
  await saved(page);
  expect(await fits(page)).toBe(true);

  // Preview: three would-be outputs, storage byte-identical.
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await page.getByTestId("workflows-preview").click();
  await expect(page.getByTestId("workflows-preview-item")).toHaveCount(3);
  await expect(page.getByTestId("workflows-preview-panel")).toContainText("معاينة بس");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(before);

  await page.getByTestId("workflows-run").click();
  const row = page.getByTestId("workflows-run-row");
  await expect(row).toHaveAttribute("data-status", "done");
  const s = await state(page);
  expect(s.ideas).toHaveLength(1);
  expect(s.posts).toHaveLength(1);
  expect(s.planItems).toHaveLength(1);
  const ideaText: string = s.ideas[0].text;
  const postId: string = s.posts[0].id;
  const week: string = s.planItems[0].week;

  // Reload: the run history persists.
  await page.reload();
  await expect(page.getByTestId("workflows-run-row")).toHaveAttribute("data-status", "done");

  const link = (kind: string) =>
    page.locator(`[data-testid="workflows-output-link"][data-kind="${kind}"]`);
  await link("idea").click();
  await expect(page.getByTestId("ideas-screen")).toBeVisible();
  await expect(page.getByTestId("idea-row").filter({ hasText: ideaText })).toBeVisible();
  await page.goBack();
  await link("post").click();
  await expect(page).toHaveURL(new RegExp(`/social/calendar/#post=${encodeURIComponent(postId)}$`));
  await expect(page.getByTestId("post-sheet")).toBeVisible();
  await page.goto("/social/workflows/");
  await page.getByTestId("workflows-row").click();
  await link("plan").click();
  await expect(page).toHaveURL(new RegExp(`/planner/#week=${week}$`));
  await expect(page.locator('[data-testid="plan-item"][data-manual="true"]')).toHaveCount(1);

  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("an article's Ready commit queues the article-ready runs; a paused workflow queues none", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  const article = {
    id: "art-1",
    title: { ar: "تلوين الليل", en: "Night grading" },
    summary: { ar: "ملخص", en: "Summary" },
    body: { ar: "نص", en: "Text" },
    slug: "night-grading",
    category: "",
    tags: [],
    coverUrl: "",
    skillId: SKILL,
    status: "draft",
    revision: 1,
    commitId: "art-1-baseline",
    createdAt: AT,
    updatedAt: AT,
  };
  const ready = workflow({
    trigger: { kind: "article-ready" },
    actions: [
      { id: "i1", kind: "idea", text: { ar: "فكرة عن {title}", en: "Idea on {title}" } },
      { id: "q1", kind: "plan", quest: "produce", minutes: 30, day: "lightest" },
    ],
  });
  await seedState(page, "/social/website/#a=art-1", {
    settings: { lang: "en" },
    articles: [article],
    workflows: [ready],
  });
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByTestId("website-ready").click();
  await expect(page.getByTestId("website-status")).toHaveText("Ready");
  await expect.poll(async () => (await state(page)).workflowRuns.length).toBe(1);
  await expect.poll(async () => (await state(page)).workflowRuns[0].status).toBe("done");
  expect((await state(page)).ideas.map((i: { text: string }) => i.text)).toEqual([
    "Idea on Night grading",
  ]);

  await page.goto("/social/workflows/#w=wf-a");
  await expect(page.getByTestId("workflows-run-row")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("workflows-run-row")).toContainText("Article ready");
  expect(await fits(page)).toBe(true);
  // Pause, then draft → Ready again: no new run.
  await page.getByTestId("workflows-enabled").click();
  await expect(page.getByTestId("workflows-paused-note")).toBeVisible();
  await expect(page.getByTestId("workflows-run")).toBeDisabled();
  await expect.poll(async () => (await state(page)).workflows[0].enabled).toBe(false);
  await page.goto("/social/website/#a=art-1");
  await page.getByTestId("website-draft").click();
  await expect(page.getByTestId("website-status")).toHaveText("Draft");
  await page.getByTestId("website-ready").click();
  await expect(page.getByTestId("website-status")).toHaveText("Ready");
  await page.waitForTimeout(300);
  expect((await state(page)).workflowRuns).toHaveLength(1);

  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("two tabs draining the same queued run under the real Web Lock make one set of outputs", async ({
  page,
  context,
}) => {
  const run = {
    id: "run-1",
    workflowId: "wf-a",
    kind: "manual",
    status: "queued",
    attempt: 1,
    commitId: "run-1-queued",
    startedAt: AT,
    updatedAt: AT,
    snapshot: {
      workflow: workflow(),
      input: {
        title: { ar: "", en: "" },
        summary: { ar: "", en: "" },
        slug: "",
        lang: "ar",
        day: "2026-10-16",
      },
    },
    steps: manualActions.map((a) => ({ actionId: a.id, status: "pending" })),
  };
  await seedState(page, "/social/", { workflows: [workflow()], workflowRuns: [run] });
  const other = await context.newPage();
  await Promise.all([page.goto("/social/workflows/"), other.goto("/social/workflows/")]);
  await expect.poll(async () => (await state(page)).workflowRuns[0].status).toBe("done");
  await expect(other.getByTestId("workflows-row")).toContainText("آخر تشغيل: خلصت");
  const s = await state(page);
  expect(s.ideas.map((i: { id: string }) => i.id)).toEqual(["wf:run-1:i1"]);
  expect(s.posts.map((p: { id: string }) => p.id)).toEqual(["wf:run-1:p1"]);
  expect(s.planItems.map((p: { id: string }) => p.id)).toEqual(["wf:run-1:q1"]);
  await other.close();
});

// Amendment D: unsaved workflow edits survive leaving through the sidebar (the CMS's adversarial scenarios).

/** Fire beforeunload through the page's real handlers without leaving it. */
const unloadBlocked = (page: Page) =>
  page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

async function viaSidebar(page: Page, href: string): Promise<void> {
  await page.getByTestId("sidenav").locator(`a[href="${href}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
}

async function seedOne(page: Page): Promise<void> {
  await seedState(page, "/social/workflows/#w=wf-a", {
    settings: { lang: "en" },
    workflows: [workflow()],
  });
  await expect(page.getByTestId("workflows-name-en")).toHaveValue("Daily");
}

async function reopen(page: Page): Promise<void> {
  await viaSidebar(page, "/social/workflows/");
  await page.getByTestId("workflows-row").click();
  await expect(page.getByTestId("workflow-editor")).toHaveAttribute("data-id", "wf-a");
}

const storedName = async (page: Page) => (await state(page)).workflows[0].name.en as string;

/** localStorage writes throw as on a full device (the durability probe too); sessionStorage keeps working. */
const fullQuota = (page: Page, on: boolean) =>
  page.evaluate((fail) => {
    const w = window as unknown as { realSetItem?: Storage["setItem"] };
    w.realSetItem ??= Storage.prototype.setItem;
    const real = w.realSetItem;
    Storage.prototype.setItem = fail
      ? function (this: Storage, k: string, v: string) {
          if (this === window.localStorage) throw new DOMException("full", "QuotaExceededError");
          return real.call(this, k, v);
        }
      : real;
  }, on);

test("full storage: leaving for Calendar keeps the unsaved workflow guarded, and reopening restores it", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the sidebar is desktop only");
  await seedOne(page);
  await fullQuota(page, true);
  await page.getByTestId("workflows-name-en").fill("Survives a full device");
  await expect(page.getByTestId("workflows-save-status")).toHaveAttribute(
    "data-state",
    "notPersisted",
  );
  expect(await storedName(page)).toBe("Daily");
  await viaSidebar(page, "/social/calendar/");
  expect(await unloadBlocked(page)).toBe(true);

  await reopen(page);
  await expect(page.getByTestId("workflows-unsaved-prompt")).toBeVisible();
  await fullQuota(page, false);
  await page.getByTestId("workflows-unsaved-restore").click();
  await expect(page.getByTestId("workflows-name-en")).toHaveValue("Survives a full device");
  await saved(page);
  expect(await storedName(page)).toBe("Survives a full device");
  await expect.poll(() => unloadBlocked(page)).toBe(false);
});

async function holdLock(context: BrowserContext): Promise<Page> {
  const holder = await context.newPage();
  await holder.route("**/api/__workflows_lock_holder__", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body>lock holder</body>" }),
  );
  await holder.goto("/api/__workflows_lock_holder__");
  await holder.evaluate(async (name) => {
    const w = window as unknown as { release?: () => void; done?: Promise<unknown> };
    await new Promise<void>((held) => {
      w.done = navigator.locks.request(name, { mode: "exclusive" }, () => {
        held();
        return new Promise<void>((r) => (w.release = r));
      });
    });
  }, LOCK);
  return holder;
}

const queued = (holder: Page) =>
  holder.evaluate(
    async (name) => (await navigator.locks.query()).pending!.filter((l) => l.name === name).length,
    LOCK,
  );

test("held lock: leaving for Calendar and reopening before release offers the newest edit, saved once", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, "the sidebar is desktop only");
  await seedOne(page);
  const holder = await holdLock(context);
  const name = page.getByTestId("workflows-name-en");
  await name.fill("Earlier A");
  await expect.poll(() => queued(holder)).toBeGreaterThanOrEqual(1);
  await name.fill("Newer B");
  await viaSidebar(page, "/social/calendar/");
  expect(await unloadBlocked(page)).toBe(true);

  await reopen(page);
  await expect(page.getByTestId("workflows-unsaved-prompt")).toBeVisible();
  await expect(name).toHaveValue("Daily");

  await holder.evaluate(async () => {
    const w = window as unknown as { release?: () => void; done?: Promise<unknown> };
    w.release?.();
    await w.done;
  });
  await expect(page.getByTestId("workflows-unsaved-prompt")).toHaveCount(0);
  await expect(name).toHaveValue("Newer B");
  await expect.poll(() => storedName(page)).toBe("Newer B");
  expect((await state(page)).workflows[0].revision).toBe(3); // A and B, each committed once
  await expect.poll(() => unloadBlocked(page)).toBe(false);
  await holder.close();
});
