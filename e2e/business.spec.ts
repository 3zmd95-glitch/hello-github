import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { freshState, seedState, switchLang } from "./helpers";

// 💼 Business Kit (packet DT-5): the media kit with real Growth numbers and their source, autosave that survives a
// reload, print showing only the kit, an allowlisted JSON export, the brand-deal board, and the honest entry points
// (More, Quick Actions, Tools). Nothing leaves the device: no Worker, local AI or other origin is contacted.

const KEY = "3z-prod-v1";
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

const riyadhDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(
    new Date(Date.now() - daysAgo * 86_400_000),
  );
const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const state = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).state, KEY);
const saved = (page: Page) =>
  expect(page.getByTestId("business-save-status")).toHaveAttribute("data-state", "saved");

test("More opens Business (no soon chip); the kit's text, a service and a rate survive a reload", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  await freshState(page, "/social/more/");
  const row = page.getByTestId("more-business");
  await expect(row.locator(".ios-chip")).toHaveCount(0);
  await row.click();
  await expect(page).toHaveURL(/\/social\/business\/$/);
  await expect(page.getByTestId("business-local-only")).toContainText("هذا الجهاز");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByTestId("business-tagline-ar").fill("أصوّر وأمنتج");
  await page.getByTestId("business-tagline-en").fill("I film and edit");
  await page.getByTestId("business-bio-en").fill("Editor in Jeddah");
  await page.getByTestId("business-service-add").click();
  await page.getByTestId("business-service-name-en").fill("Editing");
  await page.getByTestId("business-rate-add").click();
  await page.getByTestId("business-rate-deliverable-en").fill("Reel");
  await page.getByTestId("business-rate-price").fill("1500");
  await saved(page);
  expect(await fits(page)).toBe(true);

  await page.reload();
  await expect(page.getByTestId("business-tagline-en")).toHaveValue("I film and edit");
  await expect(page.getByTestId("business-bio-en")).toHaveValue("Editor in Jeddah");
  await expect(page.getByTestId("business-service-name-en")).toHaveValue("Editing");
  await expect(page.getByTestId("business-rate-price")).toHaveValue("1500");
  expect((await state(page)).businessKit.rateCard[0].priceSar).toBe(1500);

  // English, left to right, still fits.
  await switchLang(page, "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("h1")).toHaveText("Business");
  expect(await fits(page)).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("saved Growth numbers show their source; missing data says so; the export is the public projection", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  const at = new Date().toISOString();
  await seedState(page, "/social/business/", {
    settings: { lang: "en" },
    socialSnapshots: [
      {
        platform: "instagram",
        day: riyadhDay(2),
        followers: 12_400,
        views30d: 777_777,
        engagementRate: 5,
      },
    ],
    socialAccounts: [{ platform: "threads", handle: "3z.threads" }],
    brandDeals: [
      {
        id: "d1",
        brand: "Private Brand",
        contact: "pr@private.example",
        stage: "talking",
        deliverable: "",
        valueSar: 9999,
        notes: "private note",
        createdAt: at,
        updatedAt: at,
        commitId: "d1-c",
      },
    ],
  });
  const ig = page.getByTestId("business-metric-instagram");
  await expect(ig).toContainText("12.4K");
  await expect(ig).toContainText(`Saved Growth snapshot · observed ${riyadhDay(2)}`);
  await expect(ig).not.toContainText("777");
  await expect(page.getByTestId("business-metric-threads")).toContainText("No number yet");
  await expect(page.getByTestId("business-estimator")).toContainText(
    "Estimate from your own assumptions · not a market rate",
  );

  await page.getByTestId("business-tagline-en").fill("Kit for brands");
  await saved(page);
  const download = page.waitForEvent("download");
  await page.getByTestId("business-export").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`3z-prod-media-kit-${riyadhDay()}.json`);
  const text = await readFile((await file.path())!, "utf8");
  const json = JSON.parse(text);
  expect(json).toMatchObject({ app: "3z-prod-media-kit", tagline: { en: "Kit for brands" } });
  expect(json.metrics.map((m: { platform: string }) => m.platform)).toEqual([
    "instagram",
    "threads",
  ]);
  for (const secret of [
    "brandDeals",
    "apiKeys",
    "estimator",
    "settings",
    "Private Brand",
    "pr@private.example",
    "private note",
    "views30d",
  ])
    expect(text).not.toContain(secret);
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("printing shows only the media kit", async ({ page }) => {
  await freshState(page, "/social/business/");
  await page.getByTestId("business-tagline-en").fill("Printed kit");
  await saved(page);
  await expect(page.getByTestId("kit-preview")).toBeHidden();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("kit-preview")).toBeVisible();
  await expect(page.getByTestId("kit-preview")).toContainText("Printed kit");
  await expect(page.getByTestId("business-tagline-en")).toBeHidden();
  await expect(page.getByTestId("business-local-only")).toBeHidden();
  await expect(page.locator("h1")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByTestId("business-tagline-en")).toBeVisible();
});

test("brand deals: add, move the stage, edit, and keep them after a reload", async ({ page }) => {
  await freshState(page, "/social/business/");
  await page.getByTestId("business-tab-deals").click();
  await expect(page.getByTestId("deals-empty")).toBeVisible();
  await page.getByTestId("deal-new").click();
  await page.getByTestId("deal-brand").fill("Brand A");
  await page.getByTestId("deal-value").fill("1200");
  await page.getByTestId("deal-save").click();
  const row = page.getByTestId("deal-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-stage", "lead");
  await row.getByTestId("deal-stage").selectOption("agreed");
  await expect(row).toHaveAttribute("data-stage", "agreed");
  await row.getByTestId("deal-edit").click();
  await page.getByTestId("deal-edit-deliverable").fill("2 reels");
  await page.getByTestId("deal-edit-save").click();
  await expect(row).toContainText("2 reels");
  expect(await fits(page)).toBe(true);

  await page.reload();
  await page.getByTestId("business-tab-deals").click();
  await expect(page.getByTestId("deal-row")).toHaveAttribute("data-stage", "agreed");
  await expect(page.getByTestId("deal-row")).toContainText("Brand A");
  expect((await state(page)).brandDeals[0]).toMatchObject({
    brand: "Brand A",
    stage: "agreed",
    valueSar: 1200,
    deliverable: "2 reels",
  });
});

test("Quick Actions «بزنس» and the Tools row lead to the Business kit", async ({ page }, info) => {
  await freshState(page, "/");
  const launcher = page.getByTestId("quick-launch");
  if (info.project.name === "phone") await launcher.tap();
  else await launcher.click();
  await page.getByTestId("quick-input").fill("بزنس");
  await expect(page.getByTestId("quick-item-business")).toBeVisible();
  await page.getByTestId("quick-input").press("Enter");
  await expect(page).toHaveURL(/\/social\/business\/$/);
  await expect(page.getByTestId("business-screen")).toBeVisible();

  await page.goto("/tools/");
  await expect(page.getByTestId("tools-state-business")).toHaveAttribute("data-state", "available");
});

/* ---------- DT-5-R1 ---------- */

/**
 * The text each page of a Chromium (Skia) PDF draws: every `/Type /Page` object's content streams, inflated, scanned
 * for text-showing operators (Tj / TJ / ' / ") with a non-empty string. A page with none is blank whatever its
 * stream holds (a stream of only paths or a white fill is still a blank page).
 */
function pdfPageTexts(pdf: Buffer): number[] {
  const src = pdf.toString("latin1");
  const objects = new Map<string, { dict: string; stream?: Buffer }>();
  const head = /(\d+) 0 obj\s*/g;
  for (let m = head.exec(src); m; m = head.exec(src)) {
    const start = m.index + m[0].length;
    const end = src.indexOf("endobj", start);
    const body = src.slice(start, end);
    const at = body.search(/stream\r?\n/);
    if (at < 0) {
      objects.set(m[1], { dict: body });
      continue;
    }
    const dict = body.slice(0, at);
    const dataStart = start + at + (body.slice(at, at + 8).startsWith("stream\r\n") ? 8 : 7);
    const length = Number(/\/Length (\d+)/.exec(dict)?.[1]);
    const raw = Buffer.from(src.slice(dataStart, dataStart + length), "latin1");
    objects.set(m[1], {
      dict,
      stream: /\/FlateDecode/.test(dict) ? inflateSync(raw) : raw,
    });
  }
  const shows =
    /(\((?:[^()\\]|\\.)+\)|<[0-9A-Fa-f]{2,}>)\s*(?:Tj|'|")|\[[^\]]*(?:\((?:[^()\\]|\\.)+\)|<[0-9A-Fa-f]{2,}>)[^\]]*\]\s*TJ/g;
  return [...objects.values()]
    .filter((o) => /\/Type\s*\/Page(?![A-Za-z])/.test(o.dict))
    .map((page) => {
      const ref = /\/Contents\s*(?:(\d+) 0 R|\[([^\]]*)\])/.exec(page.dict);
      const ids = ref?.[1]
        ? [ref[1]]
        : [...(ref?.[2] ?? "").matchAll(/(\d+) 0 R/g)].map((r) => r[1]);
      return ids.reduce(
        (n, id) => n + (objects.get(id)?.stream?.toString("latin1").match(shows)?.length ?? 0),
        0,
      );
    });
}

const bi = (en: string, ar: string) => ({ en, ar });

test("R7: the printed kit is as tall as the kit: one page for a small kit, no blank page for a long one", async ({
  page,
}) => {
  const at = new Date().toISOString();
  const kit = (n: number) => ({
    tagline: bi("I film and edit", "أصوّر وأمنتج"),
    bio: bi("Short bio. ".repeat(n ? 50 : 2), "نبذة قصيرة. ".repeat(n ? 45 : 2)),
    contact: {
      email: "hi@example.com",
      website: "https://example.com",
      location: bi("Jeddah", "جدة"),
    },
    services: Array.from({ length: Math.min(n, 8) || 1 }, (_, i) => ({
      id: `s${i}`,
      name: bi(`Service ${i + 1}`, `خدمة ${i + 1}`),
      desc: bi(
        "A longer description of what is included. ".repeat(4),
        "وصف أطول لما يشمله العمل. ".repeat(4),
      ),
    })),
    rateCard: Array.from({ length: Math.min(n, 12) || 1 }, (_, i) => ({
      id: `r${i}`,
      deliverable: bi(`Reel ${i + 1}`, `ريل ${i + 1}`),
      priceSar: 500 + i * 100,
      note: bi("Includes one revision", "يشمل تعديل واحد"),
    })),
    pastWork: Array.from({ length: Math.min(n, 12) || 1 }, (_, i) => ({
      id: `w${i}`,
      title: bi(`Campaign ${i + 1}`, `حملة ${i + 1}`),
      url: `https://example.com/work/${i + 1}`,
    })),
    revision: 1,
    commitId: "kit-c",
    updatedAt: at,
  });
  const snapshots = [{ platform: "instagram", day: riyadhDay(2), followers: 12_400 }];

  for (const [n, expectPages] of [
    [0, 1],
    [12, 2],
  ] as const) {
    await seedState(page, "/social/business/", {
      settings: { lang: "en" },
      socialSnapshots: snapshots,
      businessKit: kit(n),
    });
    await expect(page.getByTestId("business-print")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const layout = await page.evaluate(() => ({
      body: document.body.scrollHeight,
      doc: document.documentElement.scrollHeight,
      root: document.querySelector("[data-print-root]")!.getBoundingClientRect().height,
      viewport: window.innerHeight,
    }));
    expect(Math.abs(layout.body - layout.root)).toBeLessThanOrEqual(2);
    // The document is never shorter than the viewport; beyond that it is the kit too.
    expect(layout.doc).toBeLessThanOrEqual(Math.max(layout.root, layout.viewport) + 2);
    const texts = pdfPageTexts(await page.pdf({ format: "A4", printBackground: true }));
    if (expectPages === 1) expect(texts).toHaveLength(1);
    else expect(texts.length).toBeGreaterThanOrEqual(expectPages);
    // Every page draws text: no blank page anywhere.
    for (const t of texts) expect(t).toBeGreaterThan(0);
    await page.emulateMedia({ media: "screen" });
  }
});

test("a reply draft per deal: built from the deal and the kit, editable, saved, copied, never sent", async ({
  page,
  context,
}, info) => {
  const forbidden = watchForbidden(page);
  const at = new Date().toISOString();
  await seedState(page, "/social/business/", {
    settings: { lang: "en" },
    businessKit: {
      services: [{ id: "s1", name: bi("Video editing", "مونتاج"), desc: bi("", "") }],
      rateCard: [{ id: "r1", deliverable: bi("Reel", "ريل"), priceSar: 1500, note: bi("", "") }],
      revision: 1,
      commitId: "kit-c",
      updatedAt: at,
    },
    brandDeals: [
      {
        id: "d1",
        brand: "Brand A",
        stage: "talking",
        deliverable: "1 reel",
        valueSar: 1200,
        createdAt: at,
        updatedAt: at,
        commitId: "d1-c",
      },
    ],
  });
  if (info.project.name === "desktop")
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("business-tab-deals").click();
  await page.getByTestId("deal-reply").click();
  const box = page.getByTestId("deal-reply-text");
  await expect(page.getByTestId("deal-reply-label")).toContainText("nothing is sent");
  for (const part of ["Brand A", "1 reel", "1,200", "Video editing", "1,500", "مرحبا"])
    await expect(box).toHaveValue(new RegExp(part));
  await box.fill("Hi Brand A, thanks!\nمرحبا");
  await page.getByTestId("deal-reply-save").click();
  await expect(page.getByTestId("deal-reply-status")).toBeVisible();
  expect((await state(page)).brandDeals[0].replyDraft).toBe("Hi Brand A, thanks!\nمرحبا");
  if (info.project.name === "desktop") {
    await page.getByTestId("deal-reply-copy").click();
    await expect(page.getByTestId("deal-reply-status")).toContainText("Copied");
    // The OS clipboard may hand line breaks back as CRLF.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replace(/\r\n/g, "\n")).toBe("Hi Brand A, thanks!\nمرحبا");
  }
  expect(await fits(page)).toBe(true);
  await page.reload();
  await page.getByTestId("business-tab-deals").click();
  await page.getByTestId("deal-reply").click();
  await expect(page.getByTestId("deal-reply-text")).toHaveValue("Hi Brand A, thanks!\nمرحبا");
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("DT-5-R2 R1-E: a reply saved while a real lock is held never calls newer text saved", async ({
  page,
  context,
}) => {
  const at = new Date().toISOString();
  await seedState(page, "/social/business/", {
    settings: { lang: "en" },
    brandDeals: [
      {
        id: "d1",
        brand: "Brand A",
        stage: "talking",
        createdAt: at,
        updatedAt: at,
        commitId: "d1-c",
      },
    ],
  });
  await page.getByTestId("business-tab-deals").click();
  await page.getByTestId("deal-reply").click();
  // Another page of the app holds the shared save lock (as another tab committing).
  const holder = await context.newPage();
  await holder.goto("/social/business/");
  await holder.evaluate(() => {
    const w = window as unknown as {
      held?: boolean;
      release?: () => void;
      lock?: Promise<unknown>;
    };
    w.lock = navigator.locks.request("3z-prod-articles", async () => {
      w.held = true;
      await new Promise<void>((r) => (w.release = r));
    });
  });
  await holder.waitForFunction(() => (window as unknown as { held?: boolean }).held);
  const box = page.getByTestId("deal-reply-text");
  await box.fill("Version A");
  await page.getByTestId("deal-reply-save").click();
  await expect
    .poll(() =>
      holder.evaluate(
        async () =>
          (await navigator.locks.query()).pending?.filter((l) => l.name === "3z-prod-articles")
            .length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await box.fill("Version B");
  await holder.evaluate(async () => {
    const w = window as unknown as { release?: () => void; lock?: Promise<unknown> };
    w.release?.();
    await w.lock;
  });
  await expect(page.getByTestId("deal-reply-status")).toContainText("earlier version");
  expect((await state(page)).brandDeals[0].replyDraft).toBe("Version A");
  await expect(box).toHaveValue("Version B");
  // B is still saveable against the refreshed base.
  await page.getByTestId("deal-reply-save").click();
  await expect(page.getByTestId("deal-reply-status")).toContainText("Draft saved");
  expect((await state(page)).brandDeals[0].replyDraft).toBe("Version B");
  await expect(page.getByTestId("deal-error")).toHaveCount(0);
  await holder.close();
});
