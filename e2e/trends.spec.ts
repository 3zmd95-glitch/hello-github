import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// 📈 Trend Radar (round 30, planning/tools/08-trends.md): the radar in the ideas bank against a fake Scout
// Worker at https://scout.test stubbed with page.route (same pattern as autopost.spec.ts), plus the
// no-Worker state, where the moments rail and the manual links still render.
const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

/**
 * Two Arabic Google rows (one matches the niche keyword "مونتاج"), one English YouTube chart, one TikTok scan,
 * and one calendar moment (platform `event`, as the Worker's events source writes it), which belongs to the
 * moments rail only and must never become a trend row or count in the Studio inbox.
 */
function feedNow() {
  const seenAt = new Date().toISOString();
  return {
    items: [
      {
        id: "google:SA:حساب-المواطن",
        platform: "google",
        region: "SA",
        lang: "ar",
        title: "حساب المواطن",
        url: "https://trends.google.com/trending?geo=SA",
        score: 100,
        growthPct: 400,
        volume: 500,
        source: "Google Trends",
        why: "صرف دفعة حساب المواطن",
        seenAt,
      },
      {
        id: "google:SA:مونتاج-الايفون",
        platform: "google",
        region: "SA",
        lang: "ar",
        title: "مونتاج بالايفون",
        score: 90,
        volume: 200,
        source: "Google Trends",
        seenAt,
      },
      {
        id: "youtube:US:mrbeast",
        platform: "youtube",
        region: "US",
        lang: "en",
        title: "MrBeast · $1 vs $1,000,000 hotel",
        url: "https://www.youtube.com/watch?v=abc",
        score: 100,
        source: "YouTube charts",
        seenAt,
        tags: ["entertainment"],
      },
      {
        id: "tiktok:SA:#سعودي_فوريو",
        platform: "tiktok",
        region: "SA",
        lang: "mixed",
        title: "#سعودي_فوريو",
        source: "Tavily scan",
        why: "Recurring in 4 posts this week",
        seenAt,
        tags: ["hashtag"],
      },
      {
        id: "event:SA:e2e-moment",
        platform: "event",
        region: "SA",
        lang: "mixed",
        title: "مناسبة الاختبار · E2E moment",
        source: "3z calendar",
        why: "#مناسبة_الاختبار",
        seenAt,
        tags: ["other", "#مناسبة_الاختبار"],
      },
    ],
    fetchedAt: seenAt,
    degraded: false,
    sources: [
      { name: "google", ok: true, at: seenAt },
      { name: "youtube", ok: true, at: seenAt },
    ],
  };
}

interface Fake {
  gets: number;
  runs: number;
}

async function stubWorker(page: Page): Promise<Fake> {
  const fake: Fake = { gets: 0, runs: 0 };
  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (req.headers()["authorization"] !== `Bearer ${TOKEN}`)
      return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/health") {
      return json({ ok: true, auth: true, tavily: true, social: { configured: {}, kv: true } });
    }
    if (url.pathname === "/social/status") return json({ platforms: {} });
    if (url.pathname === "/social/data") {
      return json({ accounts: [], snapshots: [], postStats: [], demographics: [], syncedAt: {} });
    }
    if (url.pathname === "/social/publish" && req.method() === "GET") return json({ jobs: [] });
    if (url.pathname === "/trends" && req.method() === "GET") {
      fake.gets += 1;
      return json(feedNow());
    }
    if (url.pathname === "/trends/run" && req.method() === "POST") {
      fake.runs += 1;
      return json(feedNow());
    }
    return json({ error: "bad_request" }, 400);
  });
  return fake;
}

async function connectWorker(page: Page): Promise<void> {
  await freshState(page, "/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await expect(page.getByTestId("apikey-scoutUrl-status")).toHaveText("محفوظ");
  await page.getByTestId("apikey-scoutToken-input").fill(TOKEN);
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓");
}

test("the radar reads the Worker feed: tabs, chips, save, plan, dismiss, and the Studio inbox row", async ({
  page,
}) => {
  test.slow();
  const fake = await stubWorker(page);
  await connectWorker(page);

  await page.goto("/social/ideas/");
  const radar = page.getByTestId("ideas-trends");
  await expect(radar).toBeVisible();
  await expect(radar).toHaveAttribute("data-configured", "true");
  await expect.poll(() => fake.gets).toBeGreaterThanOrEqual(1);

  // Arabic tab by default: the two Google rows and the mixed TikTok hashtag, keyword row (⭐) first.
  await expect(page.getByTestId("trends-tab-ar")).toHaveAttribute("aria-pressed", "true");
  const rows = page.getByTestId("trend-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAttribute("data-star", "true");
  await expect(rows.first()).toHaveAttribute("data-lang", "ar");
  await expect(rows.first()).toContainText("مونتاج بالايفون");
  await expect(rows.nth(1)).toHaveAttribute("data-id", "google:SA:حساب-المواطن");
  await expect(rows.nth(1).getByTestId("trend-growth")).toBeVisible();
  await expect(rows.nth(1)).toContainText("صرف دفعة حساب المواطن");
  await expect(rows.nth(2)).toHaveAttribute("data-platform", "tiktok");
  await expect(page.getByTestId("trends-updated")).toContainText("آخر تحديث");
  await expect(page.getByTestId("trends-degraded")).toHaveCount(0);
  await expect(page.getByTestId("trends-need-worker")).toHaveCount(0);
  // The feed's calendar moment is not a (dismissible) trend row; moments live in their own rail.
  const eventRows = page.locator('[data-testid="trend-row"][data-platform="event"]');
  await expect(eventRows).toHaveCount(0);
  await expect(page.getByTestId("trends-list")).not.toContainText("مناسبة الاختبار");
  await expect(page.getByTestId("trends-moments")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  // English tab: the YouTube chart row, labelled with its source in the UI language ("قوائم YouTube",
  // never "trending"); data-source keeps the Worker's raw label. Still no moment row.
  await page.getByTestId("trends-tab-en").click();
  const yt = page.locator('[data-testid="trend-row"][data-platform="youtube"]');
  await expect(yt).toHaveCount(1);
  await expect(yt).toHaveAttribute("data-source", "YouTube charts");
  await expect(yt.getByTestId("trend-source")).toHaveText("قوائم YouTube");
  await expect(eventRows).toHaveCount(0);
  await expect(yt.getByTestId("trend-link")).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=abc",
  );
  await expect(page.locator('[data-testid="trend-row"][data-lang="ar"]')).toHaveCount(0);

  // Platform chips filter the list.
  await page.getByTestId("trends-tab-ar").click();
  await page.getByTestId("trends-platform-google").click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-testid="trend-row"][data-platform="tiktok"]')).toHaveCount(0);
  await page.getByTestId("trends-platform-instagram").click();
  await expect(page.getByTestId("trends-empty")).toBeVisible();
  await page.getByTestId("trends-platform-all").click();
  await expect(rows).toHaveCount(3);

  // 💡 Save as idea: the bank gets a trend idea and the button turns into "saved".
  const list = page.getByTestId("ideas-list");
  await expect(list).toHaveAttribute("data-count", "0");
  await rows.first().getByTestId("trend-save").click();
  await expect(list).toHaveAttribute("data-count", "1");
  const idea = page.locator('[data-testid="idea-row"][data-source="trend"]');
  await expect(idea).toHaveCount(1);
  await expect(idea).toContainText("مونتاج بالايفون");
  await expect(rows.first().getByTestId("trend-saved")).toBeVisible();
  await expect(rows.first().getByTestId("trend-save")).toHaveCount(0);

  // 📱 Plan a post: platform picker → the post lands in the calendar and the notice links to it.
  await rows.nth(1).getByTestId("trend-plan").click();
  await rows.nth(1).getByTestId("trend-post-instagram").click();
  const notice = page.getByTestId("trends-planned-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("حساب المواطن");
  const href = await page.getByTestId("trends-planned-open").getAttribute("href");
  expect(href).toMatch(/\/social\/calendar\/#post=.+/);
  await expect(list).toHaveAttribute("data-count", "2");
  await expect(page.locator('[data-testid="idea-row"][data-used="true"]')).toHaveCount(1);

  // ✕ dismisses a row.
  await rows.nth(2).getByTestId("trend-dismiss").click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-testid="trend-row"][data-platform="tiktok"]')).toHaveCount(0);

  // 🔄 runs the sources, then reads the feed back; the dismissed row stays hidden.
  await page.getByTestId("trends-refresh").click();
  await expect.poll(() => fake.runs).toBe(1);
  await expect.poll(() => fake.gets).toBeGreaterThanOrEqual(2);
  await expect(rows).toHaveCount(2);

  // The moments rail and the manual links sit beside the feed.
  await expect(page.getByTestId("trends-moments")).toBeVisible();
  expect(await page.getByTestId("trend-moment").count()).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("trends-manual-link")).toHaveCount(4);
  expect(await fitsViewport(page)).toBe(true);

  // The planned post opens in the calendar.
  await page.goto(href!);
  await expect(page.getByTestId("post-sheet")).toBeVisible();
  await page.getByTestId("post-close").click();

  // The Studio inbox counts this week's trend rows (the dismissed one no longer, the moment never).
  await page.goto("/social/");
  const inboxRow = page.locator('[data-testid="inbox-row"][data-kind="trends"]');
  await expect(inboxRow).toBeVisible();
  await expect(inboxRow).toContainText("3");
  await expect(inboxRow).toHaveAttribute("href", "/social/ideas/");
});

test("without a Worker the radar still shows the moments and the manual links, and points at Settings", async ({
  page,
}) => {
  await freshState(page, "/social/ideas/");
  const radar = page.getByTestId("ideas-trends");
  await expect(radar).toBeVisible();
  await expect(radar).toHaveAttribute("data-configured", "false");
  await expect(page.getByTestId("trends-need-worker")).toBeVisible();
  await expect(page.getByTestId("trends-need-worker-link")).toHaveAttribute(
    "href",
    /\/settings\/?$/,
  );
  await expect(page.getByTestId("trends-refresh")).toBeDisabled();
  await expect(page.getByTestId("trend-row")).toHaveCount(0);

  // The Saudi moments calendar needs no Worker; a moment can be saved or planned like a trend.
  const moments = page.getByTestId("trends-moments");
  await expect(moments).toBeVisible();
  const moment = page.getByTestId("trend-moment");
  expect(await moment.count()).toBeGreaterThanOrEqual(1);
  await expect(moment.first().getByTestId("trend-moment-when")).toBeVisible();
  await moment.first().getByTestId("moment-save").click();
  await expect(page.getByTestId("ideas-list")).toHaveAttribute("data-count", "1");
  await expect(page.locator('[data-testid="idea-row"][data-source="trend"]')).toHaveCount(1);
  await expect(moment.first().getByTestId("moment-saved")).toBeVisible();

  // Manual links: three external targets in a new tab plus the in-app Instagram ritual.
  const links = page.getByTestId("trends-manual-link");
  await expect(links).toHaveCount(4);
  const tiktok = page.locator('[data-testid="trends-manual-link"][data-link="tiktok"]');
  await expect(tiktok).toHaveAttribute("target", "_blank");
  await expect(tiktok).toHaveAttribute("rel", /noopener/);
  await expect(tiktok).toHaveAttribute("href", /creativecenter.*region=SA/);
  await expect(
    page.locator('[data-testid="trends-manual-link"][data-link="getdaytrends"]'),
  ).toHaveAttribute("href", "https://getdaytrends.com/saudi-arabia/");
  await expect(
    page.locator('[data-testid="trends-manual-link"][data-link="google"]'),
  ).toHaveAttribute("href", "https://trends.google.com/trending?geo=SA");
  await expect(
    page.locator('[data-testid="trends-manual-link"][data-link="instagram"]'),
  ).toContainText("انستقرام");

  // The rest of the ideas bank is untouched, and nothing scrolls sideways.
  await expect(page.getByTestId("idea-text")).toBeVisible();
  await expect(page.getByTestId("ideas-from-skills")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  // No trend row in the Studio inbox without a feed.
  await page.goto("/social/");
  await expect(page.locator('[data-testid="inbox-row"][data-kind="trends"]')).toHaveCount(0);
});
