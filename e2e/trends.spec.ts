import { expect, test, type Page } from "@playwright/test";
import { freshState, switchLang } from "./helpers";

// 📈 Trend Radar (round 30, planning/tools/08-trends.md): the radar in the ideas bank against a fake Scout
// Worker at https://scout.test stubbed with page.route (same pattern as autopost.spec.ts), plus the
// no-Worker state, where the moments rail and the manual links still render. Round 31 adds the edit genres:
// feeds whose keyword-scan rows carry a genre id, the genre chip on those rows, which opens Discover on that
// genre (Discover is the one place for genres: the radar has no genre select), and the ⭐ that a genre's own
// search words must not give. The volume chip names what its number counts by source (views on YouTube,
// searches on Google Trends), so a Short's view count is never shown as searches.
const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";

/** Discover, with or without the `?genre=` of the link that opened it (Discover takes it off the address). */
const DISCOVER_URL = /\/discover\/(\?[^#]*)?$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

/**
 * Two Arabic Google rows (one matches the niche keyword "مونتاج"), one English YouTube chart, one TikTok scan,
 * and one calendar moment (platform `event`, as the Worker's events source writes it), which belongs to the
 * moments rail only and must never become a trend row or count in the Studio inbox. None of them has a genre;
 * `extra` adds rows after them (the genre rows below).
 */
function feedNow(extra: readonly Record<string, unknown>[] = []) {
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
      ...extra,
    ],
    fetchedAt: seenAt,
    degraded: false,
    sources: [
      { name: "google", ok: true, at: seenAt },
      { name: "youtube", ok: true, at: seenAt },
    ],
  };
}

/**
 * Rows as the Worker's keyword scan writes them for a genre's main query (round 31): "YouTube search" rows
 * that carry the genre id and are tagged with the query that found them, then "short". Two Arabic ones
 * (cars, food) and two English ones (cars, and "drone", an id the app has no genre for), so the chips can be
 * checked under both tabs. The food row's query "مونتاج أكل" holds a niche keyword and its title does not;
 * the Saudi car row's title does ("مونتاج"); the English titles match none.
 */
function genreRows() {
  const row = { platform: "youtube", source: "YouTube search", seenAt: new Date().toISOString() };
  return [
    {
      ...row,
      id: "youtube:SA:kw:cars-ar",
      region: "SA",
      lang: "ar",
      title: "مونتاج سيارات في جدة",
      url: "https://www.youtube.com/shorts/cars-ar",
      score: 80,
      genre: "cars",
      tags: ["ايديت سيارات", "short"],
    },
    {
      ...row,
      id: "youtube:SA:kw:food-ar",
      region: "SA",
      lang: "ar",
      title: "أحلى مطاعم الرياض",
      score: 70,
      genre: "food",
      tags: ["مونتاج أكل", "short"],
    },
    {
      ...row,
      id: "youtube:US:kw:cars-en",
      region: "US",
      lang: "en",
      title: "Cinematic car edit 4K",
      score: 85,
      genre: "cars",
      tags: ["car edit", "short"],
    },
    {
      ...row,
      id: "youtube:US:kw:drone-en",
      region: "US",
      lang: "en",
      title: "FPV drone reel",
      score: 60,
      genre: "drone",
      tags: ["drone edit", "short"],
    },
  ];
}

/**
 * A Saudi YouTube chart Short with its view count, as the Worker writes it (youtube.ts `ytItems`: `volume` is
 * the video's `viewCount`): the kind of row that showed "105M searches". Its title matches no niche keyword.
 */
function viewsRow() {
  return {
    id: "youtube:SA:short105",
    platform: "youtube",
    region: "SA",
    lang: "ar",
    title: "أقوى شورت هالأسبوع",
    url: "https://www.youtube.com/shorts/short105",
    score: 95,
    volume: 105_000_000,
    source: "YouTube charts",
    why: "قناة الاختبار",
    seenAt: new Date().toISOString(),
    tags: ["short"],
  };
}

interface Fake {
  gets: number;
  runs: number;
  /** The texts `POST /search` was asked for (Discover, once a genre chip opened it), in order. */
  searches: string[];
  /** What `GET /trends` and `POST /trends/run` answer; a test may swap it between two reads. */
  feed: () => ReturnType<typeof feedNow>;
}

async function stubWorker(page: Page, feed: Fake["feed"] = () => feedNow()): Promise<Fake> {
  const fake: Fake = { gets: 0, runs: 0, searches: [], feed };
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
      return json(fake.feed());
    }
    if (url.pathname === "/trends/run" && req.method() === "POST") {
      fake.runs += 1;
      return json(fake.feed());
    }
    // Discover's search: nothing found, the radar's tests only look at what was asked.
    if (url.pathname === "/search" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as { q?: unknown };
      fake.searches.push(typeof body.q === "string" ? body.q : "");
      return json({ results: [], credits: { used: 1 } });
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
  await expect(page.getByTestId("trends-tab-ar")).toHaveAttribute("aria-checked", "true");
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
  // The radar has no genre select (Discover is the one place for genres), and no row of this feed has a
  // genre, so no row has a genre chip.
  await expect(page.getByTestId("trends-genre")).toHaveCount(0);
  await expect(page.getByTestId("trend-genre")).toHaveCount(0);
  await expect(radar).not.toHaveAttribute("data-genre");
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

test("a volume chip says what its number counts: views on a YouTube row, searches on a Google one", async ({
  page,
}) => {
  test.slow();
  const fake = await stubWorker(page, () => feedNow([viewsRow()]));
  await connectWorker(page);

  await page.goto("/social/ideas/");
  await expect.poll(() => fake.gets).toBeGreaterThanOrEqual(1);

  // Arabic tab: the two Google rows, the TikTok hashtag and the Saudi Short.
  const rows = page.getByTestId("trend-row");
  await expect(rows).toHaveCount(4);
  const short = page.locator('[data-testid="trend-row"][data-id="youtube:SA:short105"]');
  const google = page.locator('[data-testid="trend-row"][data-id="google:SA:حساب-المواطن"]');
  const views = short.getByTestId("trend-volume");
  const searches = google.getByTestId("trend-volume");
  await expect(short).toHaveAttribute("data-source", "YouTube charts");
  await expect(views).toHaveAttribute("data-unit", "views");
  await expect(views).toHaveText("105M مشاهدة");
  await expect(views).not.toContainText("بحث");
  await expect(searches).toHaveAttribute("data-unit", "searches");
  await expect(searches).toHaveText("500 بحث");
  // Only the rows that have a volume show one (the Tavily hashtag has none): both Google rows and the Short.
  await expect(page.getByTestId("trend-volume")).toHaveCount(3);
  await expect(page.locator('[data-testid="trend-volume"][data-unit="searches"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="trend-volume"][data-unit="views"]')).toHaveCount(1);
  expect(await fitsViewport(page)).toBe(true);

  // English UI: the same units in English, on the same Arabic tab.
  await switchLang(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("trends-tab-ar")).toHaveAttribute("aria-checked", "true");
  await expect(views).toHaveAttribute("data-unit", "views");
  await expect(views).toHaveText("105M views");
  await expect(views).not.toContainText("searches");
  await expect(searches).toHaveAttribute("data-unit", "searches");
  await expect(searches).toHaveText("500 searches");
  expect(await fitsViewport(page)).toBe(true);
});

test("genre rows name their genre in a chip that links to Discover, and the radar has no genre select", async ({
  page,
}) => {
  test.slow();
  const fake = await stubWorker(page, () => feedNow(genreRows()));
  await connectWorker(page);

  await page.goto("/social/ideas/");
  const radar = page.getByTestId("ideas-trends");
  await expect(radar).toHaveAttribute("data-configured", "true");
  await expect.poll(() => fake.gets).toBeGreaterThanOrEqual(1);

  // Arabic tab: the three rows without a genre plus the two Arabic genre rows. Discover is the one place for
  // genres, so the radar has no genre select: the language tabs and the platform chips are its only filters.
  const rows = page.getByTestId("trend-row");
  await expect(rows).toHaveCount(5);
  await expect(radar).toHaveAttribute("data-count", "5");
  await expect(page.getByTestId("trends-genre")).toHaveCount(0);
  await expect(radar.locator("select")).toHaveCount(0);
  await expect(radar).not.toHaveAttribute("data-genre");

  // ⭐ is for the owner's niche, not for how a row was found. The food row is tagged with its genre's query
  // "مونتاج أكل" and its title has no niche keyword: no star, and it keeps the place its score gives it. The
  // car row's title says "مونتاج", so it is starred like the Google row and comes right after it.
  const food = page.locator('[data-testid="trend-row"][data-genre="food"]');
  const carsAr = page.locator('[data-testid="trend-row"][data-id="youtube:SA:kw:cars-ar"]');
  await expect(food).toHaveCount(1);
  await expect(food).toHaveAttribute("data-star", "false");
  await expect(food.getByTestId("trend-star")).toHaveCount(0);
  await expect(carsAr).toHaveAttribute("data-star", "true");
  await expect(carsAr.getByRole("img", { name: "يناسب مجالك" })).toHaveAttribute(
    "data-testid",
    "trend-star",
  );
  await expect(carsAr).toHaveAttribute("data-genre", "cars");
  await expect(page.locator('[data-testid="trend-row"][data-star="true"]')).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-id", "google:SA:مونتاج-الايفون");
  await expect(rows.nth(1)).toHaveAttribute("data-id", "youtube:SA:kw:cars-ar");
  await expect(rows.nth(2)).toHaveAttribute("data-id", "google:SA:حساب-المواطن");
  await expect(rows.nth(3)).toHaveAttribute("data-id", "youtube:SA:kw:food-ar");

  // Every genre row names its genre in a chip (without the genre's emoji: Social chips carry none); the rows
  // without a genre have none.
  const carsChip = carsAr.getByTestId("trend-genre");
  const foodChip = food.getByTestId("trend-genre");
  await expect(page.getByTestId("trend-genre")).toHaveCount(2);
  await expect(carsChip).toHaveText("سيارات");
  await expect(foodChip).toHaveText("أكل ومطاعم");
  await expect(rows.nth(0).getByTestId("trend-genre")).toHaveCount(0);
  await expect(page.locator('[data-testid="trend-row"][data-genre]')).toHaveCount(2);

  // The chip of a genre the app knows is a link: Discover opened on that genre, named for where it goes.
  await expect(carsChip).toHaveAttribute("href", "/discover/?genre=cars");
  await expect(carsChip).toHaveAttribute("data-genre", "cars");
  await expect(foodChip).toHaveAttribute("href", "/discover/?genre=food");
  await expect(foodChip).toHaveAttribute("data-genre", "food");
  await expect(
    carsAr.getByRole("link", { name: "افتح سيارات في «اكتشف»", exact: true }),
  ).toHaveAttribute("data-testid", "trend-genre");
  await expect(
    food.getByRole("link", { name: "افتح أكل ومطاعم في «اكتشف»", exact: true }),
  ).toHaveAttribute("data-testid", "trend-genre");
  // It looks like the row's other chips (not like a blue underlined link) and sits beside them.
  const sameLook = await foodChip.evaluate((el) => {
    const other = el.parentElement?.querySelector('[data-testid="trend-platform"]');
    if (!other) return false;
    const look = (chip: Element) => {
      const s = getComputedStyle(chip);
      return [
        s.color,
        s.backgroundColor,
        s.fontSize,
        s.fontWeight,
        s.borderTopWidth,
        s.borderTopColor,
        s.borderTopLeftRadius,
        s.textDecorationLine,
        s.lineHeight,
        s.paddingTop,
        s.paddingInlineStart,
        s.display,
      ].join(" | ");
    };
    return el.tagName === "A" && el.classList.contains("px-chip") && look(el) === look(other);
  });
  expect(sameLook).toBe(true);
  expect(await fitsViewport(page)).toBe(true);

  // English tab: the chart row, the two English genre rows and the mixed hashtag. The car row's tag
  // "car edit" is its genre's query and its title has no niche keyword, so no star; its chip opens the same
  // genre. "drone" is an id the app has no genre for: a plain chip with the raw id, nothing to tap.
  await page.getByTestId("trends-tab-en").click();
  await expect(rows).toHaveCount(4);
  const carsEn = page.locator('[data-testid="trend-row"][data-id="youtube:US:kw:cars-en"]');
  const drone = page.locator('[data-testid="trend-row"][data-genre="drone"]');
  await expect(carsEn).toHaveAttribute("data-star", "false");
  await expect(carsEn.getByTestId("trend-source")).toHaveText("بحث YouTube");
  await expect(carsEn.getByTestId("trend-genre")).toHaveText("سيارات");
  await expect(carsEn.getByTestId("trend-genre")).toHaveAttribute("href", "/discover/?genre=cars");
  await expect(drone).toHaveAttribute("data-id", "youtube:US:kw:drone-en");
  await expect(drone.getByTestId("trend-genre")).toHaveText("drone");
  await expect(drone.getByTestId("trend-genre")).toHaveAttribute("data-genre", "drone");
  await expect(drone.getByTestId("trend-genre")).not.toHaveAttribute("href");
  await expect(drone.getByRole("link")).toHaveCount(0);
  const chipIsPlain = await drone.getByTestId("trend-genre").evaluate((el) => {
    const platform = el.parentElement?.querySelector('[data-testid="trend-platform"]');
    return (
      el.tagName === "SPAN" &&
      el.classList.contains("px-chip") &&
      !!platform &&
      el.tabIndex === -1 &&
      !el.closest("a, button, select, label")
    );
  });
  expect(chipIsPlain).toBe(true);

  // The platform chip narrows the genre rows like every other row.
  await page.getByTestId("trends-platform-youtube").click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("trend-genre")).toHaveCount(2);
  await page.getByTestId("trends-platform-google").click();
  await expect(page.getByTestId("trends-empty")).toBeVisible();
  await expect(rows).toHaveCount(0);
  await page.getByTestId("trends-platform-all").click();
  await expect(rows).toHaveCount(4);

  // ✕ on a genre row takes that row and its chip away, nothing else.
  await drone.getByTestId("trend-dismiss").click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("trend-genre")).toHaveCount(1);
  await expect(carsEn).toHaveCount(1);

  // A fresh feed without genre rows: no chip is left, and the list is the plain feed again.
  fake.feed = () => feedNow();
  await page.getByTestId("trends-refresh").click();
  await expect.poll(() => fake.runs).toBe(1);
  await expect(page.getByTestId("trend-genre")).toHaveCount(0);
  await expect(page.locator('[data-testid="trend-row"][data-genre]')).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await page.getByTestId("trends-tab-ar").click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("trends-genre")).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
});

test("tapping a row's genre chip opens Discover with that genre picked", async ({ page }) => {
  test.slow();
  const fake = await stubWorker(page, () => feedNow(genreRows()));
  await connectWorker(page);

  await page.goto("/social/ideas/");
  await expect.poll(() => fake.gets).toBeGreaterThanOrEqual(1);
  const food = page.locator('[data-testid="trend-row"][data-genre="food"]');
  await expect(food).toHaveCount(1);
  expect(fake.searches).toEqual([]);

  // The chip is the way from a trend to its genre: Discover opens with the Food chip pressed (Discover's
  // deep link, lib/genres `discoverGenreHref`), which is a search like a tap on that chip.
  await food.getByTestId("trend-genre").click();
  await expect(page).toHaveURL(DISCOVER_URL);
  await expect(page.getByTestId("genre-food")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("genres-row")).toHaveAttribute("data-genre", "food");
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => fake.searches).toContain("مونتاج أكل");
  expect(await fitsViewport(page)).toBe(true);

  // Back in the radar the feed is still there (the store keeps it), and the car row opens Cars.
  await page.goto("/social/ideas/");
  const carsAr = page.locator('[data-testid="trend-row"][data-id="youtube:SA:kw:cars-ar"]');
  await expect(carsAr).toHaveCount(1);
  await carsAr.getByTestId("trend-genre").click();
  await expect(page).toHaveURL(DISCOVER_URL);
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("genres-row")).toHaveAttribute("data-genre", "cars");
  await expect(page.getByTestId("genre-food")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => fake.searches).toContain("ايديت سيارات");
});

test("the genre chip names the owner's custom genre, speaks English when the app does, and opens it in Discover", async ({
  page,
}) => {
  test.slow();
  const drift = {
    id: "youtube:US:kw:drift-en",
    platform: "youtube",
    region: "US",
    lang: "en",
    title: "Night drift edit",
    score: 75,
    source: "YouTube search",
    seenAt: new Date().toISOString(),
    genre: "custom-drift",
    tags: ["drift edit", "short"],
  };
  const fake = await stubWorker(page, () => feedNow([...genreRows(), drift]));
  await connectWorker(page);

  // The owner adds a genre of their own in Settings (the Worker tags its rows "custom-drift").
  await page.getByTestId("genre-add-name").fill("Drift");
  await page.getByTestId("genre-add-query").fill("drift edit");
  await page.getByTestId("genre-add").click();
  await expect(page.getByTestId("settings-genre-custom-drift")).toBeVisible();

  await page.goto("/social/ideas/");
  await expect.poll(() => fake.gets).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("trends-genre")).toHaveCount(0);

  // English tab: the chart row, the car, drift and drone rows, and the mixed hashtag. The drift row's chip
  // names the owner's genre (the name they gave it, without Discover's ✨) and links to it; "drift edit" is
  // the genre's own words, so no star.
  await page.getByTestId("trends-tab-en").click();
  const rows = page.getByTestId("trend-row");
  await expect(rows).toHaveCount(5);
  const driftRow = page.locator('[data-testid="trend-row"][data-genre="custom-drift"]');
  const driftChip = driftRow.getByTestId("trend-genre");
  await expect(driftRow).toHaveAttribute("data-id", "youtube:US:kw:drift-en");
  await expect(driftRow).toHaveAttribute("data-star", "false");
  await expect(driftChip).toHaveText("Drift");
  await expect(driftChip).toHaveAttribute("href", "/discover/?genre=custom-drift");
  await expect(
    driftRow.getByRole("link", { name: "افتح Drift في «اكتشف»", exact: true }),
  ).toHaveAttribute("data-testid", "trend-genre");

  // English UI: the chips and their names speak English; the unknown id stays as it is. In Social the
  // switch goes through More, and coming back opens the radar on its Arabic tab again: back to English.
  await switchLang(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByTestId("trends-tab-en").click();
  await expect(rows).toHaveCount(5);
  const carsEn = page.locator('[data-testid="trend-row"][data-id="youtube:US:kw:cars-en"]');
  await expect(carsEn.getByTestId("trend-genre")).toHaveText("Cars");
  await expect(
    carsEn.getByRole("link", { name: "Open Cars in Discover", exact: true }),
  ).toHaveAttribute("href", "/discover/?genre=cars");
  await expect(driftChip).toHaveText("Drift");
  await expect(
    driftRow.getByRole("link", { name: "Open Drift in Discover", exact: true }),
  ).toHaveAttribute("data-testid", "trend-genre");
  await expect(
    page.locator('[data-testid="trend-row"][data-genre="drone"]').getByTestId("trend-genre"),
  ).toHaveText("drone");

  // The owner's genre opens in Discover like a built-in one, and its own words are searched.
  await driftChip.click();
  await expect(page).toHaveURL(DISCOVER_URL);
  await expect(page.getByTestId("genre-custom-drift")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("genres-row")).toHaveAttribute("data-genre", "custom-drift");
  await expect.poll(() => fake.searches).toContain("drift edit");
});

test("without a Worker the radar still shows the moments and the manual links, and points at Settings", async ({
  page,
}) => {
  await freshState(page, "/social/ideas/");
  const radar = page.getByTestId("ideas-trends");
  await expect(radar).toBeVisible();
  await expect(radar).toHaveAttribute("data-configured", "false");
  await expect(page.getByTestId("trends-genre")).toHaveCount(0);
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
  await expect(page.getByTestId("idea-new")).toBeVisible();
  await expect(page.getByTestId("ideas-from-skills")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  // No trend row in the Studio inbox without a feed.
  await page.goto("/social/");
  await expect(page.locator('[data-testid="inbox-row"][data-kind="trends"]')).toHaveCount(0);
});
