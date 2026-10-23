import { expect, test, type Page } from "@playwright/test";
import { seedState } from "./helpers";

// 📄 Media-kit page and rate calculator (planning/tools/09 D2, D3): the printable page built from the saved Growth
// numbers (a dash where one is missing), its own language and block switches, a light A4 sheet in print even in the
// dark look, "rates on request" and nothing about the calculator on it; the private rate calculator with the owner's
// assumptions kept across a reload. Nothing leaves the device.

const KEY = "3z-prod-v1";
const SHELL_FONTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

function watchForbidden(page: Page): string[] {
  const forbidden: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (!url.protocol.startsWith("http") || SHELL_FONTS.has(url.hostname)) return;
    if (url.hostname !== "localhost" || url.pathname.startsWith("/api/local-ai/"))
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

const at = new Date().toISOString();
const kit = {
  tagline: { ar: "أصوّر وأمنتج", en: "I film and edit" },
  bio: { ar: "مونتير في جدة", en: "Editor in Jeddah" },
  contact: { email: "hi@3z.example", website: "", location: { ar: "", en: "" } },
  services: [{ id: "s1", name: { ar: "مونتاج", en: "Editing" }, desc: { ar: "", en: "" } }],
  rateCard: [
    { id: "r1", deliverable: { ar: "ريل", en: "Reel" }, priceSar: 4321, note: { ar: "", en: "" } },
  ],
  pastWork: [],
  featuredPlatforms: [],
  revision: 1,
  commitId: "kit-c1",
  updatedAt: at,
};
const growth = {
  socialSnapshots: [
    { platform: "instagram", day: riyadhDay(2), followers: 272, views30d: 0, engagementRate: 7.8 },
    { platform: "tiktok", day: riyadhDay(1), followers: 1_200, views30d: 0 },
  ],
  socialAccounts: [{ platform: "threads", handle: "3z.threads" }],
  demographics: [
    { platform: "instagram", day: riyadhDay(3), dimension: "gender", key: "male", pct: 60 },
    { platform: "instagram", day: riyadhDay(3), dimension: "gender", key: "female", pct: 40 },
    { platform: "instagram", day: riyadhDay(3), dimension: "country", key: "SA", pct: 31.5 },
  ],
};

test("Business opens the media-kit page; it shows real numbers, dashes for missing ones, and no prices", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  await seedState(page, "/social/business/", { businessKit: kit, ...growth });
  await page.getByTestId("business-open-page").click();
  await expect(page).toHaveURL(/\/social\/business\/media-kit\/$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("kit-page")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("kitpage-export")).toContainText("تصدير PDF");

  // The kit's own text and the saved numbers.
  await expect(page.getByTestId("kit-tagline")).toHaveText("أصوّر وأمنتج");
  await expect(page.getByTestId("kit-total")).toHaveText("1.5K");
  await expect(page.getByTestId("kit-tile-instagram-followers")).toContainText("272");
  await expect(page.getByTestId("kit-tile-instagram-engagement")).toContainText("7.8%");
  await expect(page.getByTestId("kit-tile-threads-followers")).toHaveText("المتابعين—");
  await expect(page.getByTestId("kit-audience-instagram")).toContainText("31.5%");
  // Rates: only "on request", never a price.
  await expect(page.getByTestId("kit-rates")).toContainText("الأسعار عند الطلب");
  const paper = (await page.getByTestId("kit-page").textContent()) ?? "";
  expect(paper).not.toMatch(/4321|4,321|ريال/);

  // The kit has its own language.
  await page.getByTestId("kitpage-lang-en").click();
  await expect(page.getByTestId("kit-page")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("kit-rates")).toContainText("Rates on request");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await fits(page)).toBe(true);

  // A block switched off stays off after a reload.
  await page.getByTestId("kitpage-block-audience").click();
  await expect(page.getByTestId("kit-audience")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("kit-platforms")).toBeVisible();
  await expect(page.getByTestId("kit-audience")).toHaveCount(0);
  expect((await state(page)).businessPrefs.blocks).toMatchObject({
    audience: false,
    platforms: true,
  });
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});

test("printing shows only the light sheet, even in the dark look, and the PDF is A4", async ({
  page,
}, info) => {
  await seedState(page, "/social/business/media-kit/", {
    settings: { appearance: "dark" },
    businessKit: kit,
    ...growth,
  });
  const sheet = page.getByTestId("kit-page");
  await expect(sheet).toBeVisible();
  // On screen the sheet is already a white page inside the dark app.
  expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(255, 255, 255)",
  );
  expect(await sheet.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(11, 13, 16)");

  await page.emulateMedia({ media: "print" });
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("kitpage-export")).toBeHidden();
  await expect(page.getByTestId("kitpage-name")).toBeHidden();
  await expect(page.locator("h1")).toBeHidden();
  await expect(page.getByTestId("kit-hero")).toBeVisible();

  if (info.project.name === "desktop") {
    // A real PDF through the browser's own print (Arabic shaped by the browser): one A4 sheet wide.
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const raw = pdf.toString("latin1");
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);
    expect(box, "a page size in the PDF").not.toBeNull();
    expect(Math.round(Number(box![1]))).toBe(595);
    expect(Math.round(Number(box![2]))).toBe(842);
  }
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByTestId("kitpage-export")).toBeVisible();
});

test("Export PDF opens the browser's print window", async ({ page }) => {
  // The seed version is marked applied, so the app starts with no Growth numbers at all.
  await seedState(page, "/social/business/media-kit/", { socialSeedApplied: "2026-09-27" });
  await page.evaluate(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
  await page.getByTestId("kitpage-export").click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  // With nothing saved the page is honest: dashes, and a hint outside the sheet about the missing email.
  await expect(page.getByTestId("kit-total")).toHaveText("—");
  await expect(page.getByTestId("kitpage-no-email")).toBeVisible();
  expect(await fits(page)).toBe(true);
});

test("the rate calculator is private, uses the saved numbers, and keeps the owner's assumptions", async ({
  page,
}) => {
  const forbidden = watchForbidden(page);
  await seedState(page, "/social/business/", {
    settings: { lang: "en" },
    businessKit: kit,
    ...growth,
  });
  await page.getByTestId("business-tab-rates").click();
  await expect(page.getByTestId("rates-private")).toBeVisible();
  await page.getByTestId("rates-platform").selectOption("instagram");
  // 272 followers × 15 / 1000 = 4.08; no average views saved → followers only → rounds to 10 SAR.
  await expect(page.getByTestId("rates-no-views")).toBeVisible();
  await expect(page.getByTestId("rates-result")).toHaveText("≈ 10 SAR");
  await page.getByTestId("rates-platform").selectOption("tiktok");
  await page.getByTestId("rates-d-bundle").click();
  // 1.2 × 15 = 18, × 2.5 = 45 → 50 (nearest 10: 4.5 rounds up to 5).
  await expect(page.getByTestId("rates-result")).toHaveText("≈ 50 SAR");
  await page.getByTestId("rates-perk").fill("100");
  await expect(page.getByTestId("rates-result")).toHaveText("≈ 300 SAR");
  expect(await fits(page)).toBe(true);

  await page.reload();
  await page.getByTestId("business-tab-rates").click();
  await expect(page.getByTestId("rates-perk")).toHaveValue("100");
  expect((await state(page)).businessPrefs.rates.sarPerThousandFollowers).toBe(100);

  // The calculator's numbers never reach the media-kit page.
  await page.getByTestId("business-open-page").click();
  const paper = (await page.getByTestId("kit-page").textContent()) ?? "";
  expect(paper).not.toMatch(/300|SAR/);
  await page.waitForLoadState("networkidle");
  expect(forbidden).toEqual([]);
});
