import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { freshState, seedState } from "./helpers";

// 🌐 Website CMS (packet DT-3): local bilingual articles. Create, autosave, reload, search, preview, ready gate,
// portable .md download, archive/restore, phone back, Quick Actions and the Tools hub. Nothing is public and nothing
// leaves the device: no Worker, local AI or other origin is contacted.

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

const saved = (page: Page) =>
  expect(page.getByTestId("website-save-status")).toHaveAttribute("data-state", "saved");

async function press(page: Page, info: TestInfo, testId: string): Promise<void> {
  const el = page.getByTestId(testId);
  if (info.project.name === "phone") await el.tap();
  else await el.click();
}

test("write, reload, search, preview, ready, download, archive and restore an article", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  await freshState(page, "/social/more/");
  const row = page.getByTestId("more-website");
  await expect(row.locator(".ios-chip")).toHaveCount(0);
  await row.click();
  await expect(page.getByTestId("website-screen")).toBeVisible();
  await expect(page.getByTestId("website-local-only")).toContainText("ولا شي منها منشور");
  expect(await fits(page)).toBe(true);

  await page.getByTestId("website-new").click();
  await expect(page).toHaveURL(/\/social\/website\/#a=[\w-]+$/);
  const body = page.getByTestId("website-body");
  await expect(body).toHaveAttribute("dir", "rtl");
  await page.getByTestId("website-title").fill("تلوين الليل");
  await body.fill("## مقدمة\n\nنص عربي عن التلوين");
  await saved(page);

  await page.getByTestId("website-lang-en").click();
  await expect(body).toHaveAttribute("dir", "ltr");
  await page.getByTestId("website-title").fill("Night grading");
  await body.fill("## Intro\n\nEnglish text about grading");
  await saved(page);
  expect(await fits(page)).toBe(true);

  // Saved on this device: both languages survive a reload.
  await page.reload();
  await expect(page.getByTestId("article-editor")).toBeVisible();
  await expect(page.getByTestId("website-title")).toHaveValue("تلوين الليل");
  await page.getByTestId("website-lang-en").click();
  await expect(page.getByTestId("website-body")).toHaveValue(/English text about grading/);

  // Preview renders Markdown.
  await page.getByTestId("website-preview").click();
  await expect(page.getByTestId("article-preview").locator("h2")).toHaveText("Intro");
  await page.getByTestId("website-write").click();

  // Ready is gated by the issues list; the slug fixes the last one.
  const ready = page.getByTestId("website-ready");
  await expect(ready).toBeDisabled();
  await page.getByTestId("website-summary").fill("A short summary");
  await page.getByTestId("website-slug-suggest").click();
  await expect(page.getByTestId("website-slug")).toHaveValue("night-grading");
  await saved(page);
  await expect(ready).toBeEnabled();
  await ready.click();
  await expect(page.getByTestId("website-status")).toHaveText("جاهزة");
  await expect(page.getByTestId("website-ready-note")).toContainText("مو منشورة");
  await expect(page.getByTestId("website-local-only")).toBeVisible();

  // A portable English .md with front matter and the source body.
  const download = page.waitForEvent("download");
  await page.getByTestId("website-download-en").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("night-grading.en.md");
  const md = await readFile((await file.path())!, "utf8");
  expect(md).toContain('slug: "night-grading"');
  expect(md).toContain("English text about grading");

  // The list: search in both languages, then archive and restore.
  await page.getByTestId("website-back").click();
  await expect(page).toHaveURL(/\/social\/website\/$/);
  await page.getByTestId("website-filter-ready").click();
  await page.getByTestId("website-search").fill("تلوين");
  await expect(page.getByTestId("website-row")).toHaveCount(1);
  await page.getByTestId("website-search").fill("grading");
  await expect(page.getByTestId("website-row")).toHaveCount(1);
  await page.getByTestId("website-search").fill("");
  await page.getByTestId("website-row").click();
  await page.getByTestId("website-archive").click();
  await expect(page.getByTestId("website-status")).toHaveText("مؤرشفة");
  await page.getByTestId("website-back").click();
  await page.getByTestId("website-filter-draft").click();
  await expect(page.getByTestId("website-empty")).toBeVisible();
  await page.getByTestId("website-filter-archived").click();
  await expect(page.getByTestId("website-row")).toHaveCount(1);
  await page.getByTestId("website-row").click();
  await page.getByTestId("website-restore").click();
  await expect(page.getByTestId("website-status")).toHaveText("مسودة");
  await expect(page.getByTestId("website-body")).toHaveValue(/مقدمة/);

  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("phone back returns from the editor to the list, and nothing scrolls sideways", async ({
  page,
}) => {
  await freshState(page, "/social/website/");
  await page.getByTestId("website-new").click();
  await expect(page.getByTestId("article-editor")).toBeVisible();
  expect(await fits(page)).toBe(true);
  await page.goBack();
  await expect(page.getByTestId("article-editor")).toHaveCount(0);
  await expect(page.getByTestId("website-new")).toBeVisible();
  await expect(page.getByTestId("website-row")).toHaveCount(1);
});

test("Quick Actions finds the CMS in Arabic and English, and the Tools hub calls it available", async ({
  page,
}, info) => {
  await freshState(page, "/");
  for (const query of ["موقع", "website"]) {
    await press(page, info, "quick-launch");
    await page.getByTestId("quick-input").fill(query);
    await expect(page.getByTestId("quick-item-website")).toBeVisible();
    await page.getByTestId("quick-item-website").click();
    await expect(page).toHaveURL(/\/social\/website\/$/);
    await expect(page.getByTestId("website-screen")).toBeVisible();
    await page.goto("/");
  }
  await page.goto("/tools/");
  await expect(page.getByTestId("tools-state-website")).toHaveAttribute("data-state", "available");
  await expect(page.getByTestId("tools-row-website")).not.toContainText("على الخطة");
});

// Repair round 1: an unsaved draft must survive leaving the CMS through the sidebar (Codex's adversarial scenarios).
const KEY = "3z-prod-v1";
const LOCK = "3z-prod-articles";
const ORIGINAL = "Already saved before leaving.";

async function seedOne(page: Page): Promise<void> {
  const at = "2026-10-16T12:00:00.000Z";
  const article = {
    id: "repair-a",
    title: { ar: "مقال", en: "Repair article" },
    summary: { ar: "ملخص", en: "Summary" },
    body: { ar: "نص", en: ORIGINAL },
    slug: "repair-a",
    category: "",
    tags: [],
    coverUrl: "",
    status: "draft",
    revision: 1,
    commitId: "repair-a-baseline",
    createdAt: at,
    updatedAt: at,
  };
  await seedState(page, "/social/website/#a=repair-a", {
    settings: { lang: "en" },
    articles: [article],
  });
  await expect(page.getByTestId("website-body")).toHaveValue(ORIGINAL);
}

const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).state.articles[0], KEY);

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

async function reopen(page: Page): Promise<void> {
  await viaSidebar(page, "/social/website/");
  await page.getByTestId("website-row").filter({ hasText: "Repair article" }).click();
  await expect(page.getByTestId("article-editor")).toHaveAttribute("data-id", "repair-a");
}

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

test("full storage: leaving for Calendar keeps the unsaved draft guarded, and reopening restores it", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the sidebar is desktop only");
  await seedOne(page);
  const text = "This last sentence must survive a full device and Calendar.";
  await fullQuota(page, true);
  await page.getByTestId("website-body").fill(text);
  await expect(page.getByTestId("website-save-status")).toHaveAttribute(
    "data-state",
    "notPersisted",
  );
  expect((await stored(page)).body.en).toBe(ORIGINAL);
  expect(await unloadBlocked(page)).toBe(true);

  await viaSidebar(page, "/social/calendar/");
  expect(await unloadBlocked(page)).toBe(true);

  await reopen(page);
  await expect(page.getByTestId("website-unsaved-prompt")).toBeVisible();
  await fullQuota(page, false);
  await page.getByTestId("website-unsaved-restore").click();
  await expect(page.getByTestId("website-body")).toHaveValue(text);
  await saved(page);
  expect((await stored(page)).body.en).toBe(text);
  await expect.poll(() => unloadBlocked(page)).toBe(false);
});

async function holdLock(context: BrowserContext): Promise<Page> {
  const holder = await context.newPage();
  await holder.route("**/api/__website_lock_holder__", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body>lock holder</body>" }),
  );
  await holder.goto("/api/__website_lock_holder__");
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

test("held lock: leaving for Calendar and reopening before release offers the newest text, saved once", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, "the sidebar is desktop only");
  await seedOne(page);
  const holder = await holdLock(context);
  const body = page.getByTestId("website-body");
  await body.fill("The earlier pending sentence.");
  await expect.poll(() => queued(holder)).toBeGreaterThanOrEqual(1);
  const latest = "The newer sentence typed while the first save waits.";
  await body.fill(latest);
  await viaSidebar(page, "/social/calendar/");
  expect(await unloadBlocked(page)).toBe(true);

  await reopen(page);
  await expect(page.getByTestId("website-unsaved-prompt")).toBeVisible();
  await expect(body).toHaveValue(ORIGINAL);

  await holder.evaluate(async () => {
    const w = window as unknown as { release?: () => void; done?: Promise<unknown> };
    w.release?.();
    await w.done;
  });
  // The closed editor's queued saves land (A, then B); its stash clears and the editor shows B.
  await expect(page.getByTestId("website-unsaved-prompt")).toHaveCount(0);
  await expect(body).toHaveValue(latest);
  await expect.poll(async () => (await stored(page)).body.en).toBe(latest);
  expect((await stored(page)).revision).toBe(3); // A and B, each committed once
  await expect.poll(() => unloadBlocked(page)).toBe(false);
  await page.reload();
  await expect(page.getByTestId("website-body")).toHaveValue(latest);
  await expect(page.getByTestId("website-unsaved-prompt")).toHaveCount(0);
  expect((await stored(page)).revision).toBe(3);
});
