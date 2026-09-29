import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// Scout Worker (build plan 1.14) against a fake Worker at https://scout.test, stubbed with page.route.
const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";
const SKILL_ID = "smart-bins-keywords";

// A tiny 1x1 PNG served for every thumbnail so nothing leaves the machine.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// Worker results; the stub answers a one-platform request with that platform's results, up to `max`.
// They carry `stats` the way the Worker sends them (round 31): likes read off the TikTok page, views from
// YouTube, nothing for the Instagram reel. By popularity (views, else likes x 10): the Arabic TikTok
// (450,000), the first TikTok (12,000), the YouTube video (5,400), then the reel (unknown).
const RESULTS = [
  {
    platform: "tt",
    handle: "@editor.sam",
    title: "Match cut in 10 seconds",
    snippet: "Two shots, one motion: the cleanest match cut trick in CapCut.",
    url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001",
    thumb: `${WORKER}/thumb/tt1.png`,
    stats: { likes: 1200, comments: 56 },
  },
  {
    platform: "ig",
    handle: "@cutsbyfaisal",
    title: "Match cut reel",
    snippet: "Door to door match cut, shot on a phone.",
    url: "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF",
  },
  {
    platform: "yt",
    handle: "youtube.com",
    title: "Match cuts explained",
    snippet: "",
    url: "https://www.youtube.com/watch?v=abc123XYZ",
    thumb: `${WORKER}/thumb/yt1.png`,
    stats: { views: 5400, likes: 310, comments: 12 },
  },
  {
    platform: "tt",
    handle: "@cuts.hijazi",
    title: "ماتش كت بالجوال",
    snippet: "",
    url: "https://www.tiktok.com/@cuts.hijazi/video/7300000000000000002",
    stats: { likes: 45000 },
  },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface SearchBody {
  q: string;
  platforms: string[];
  lang?: string;
  max?: number;
  timeRange?: string;
  thumbs?: boolean;
}

interface Calls {
  search: number;
  oembed: number;
  bodies: SearchBody[];
  /** Requests to the Trend Radar's routes, as "METHOD /path" (round 31: Discover's "most viewed" strip). */
  trends: string[];
}

interface StubOpts {
  /** Answer the first N searches with a 503 (the search service having a problem). */
  fail?: number;
  /** Platforms that have nothing for the topic. */
  empty?: string[];
  /** Thumbnails that no longer load (TikTok's signed image URLs expire after about two days). */
  expired?: string[];
  /** What `GET /trends` answers; without it the Worker has no feed (a 404, like one without the radar). */
  feed?: () => unknown;
}

/**
 * Stub the whole fake Worker. Returns live call counters and the /search request bodies. Like the real
 * Worker it honours `platforms` and `max`, and like Tavily a mixed request is one capped answer where one
 * platform crowds out the rest (here: YouTube only), which is why the app never sends one.
 */
async function stubWorker(page: Page, opts: StubOpts = {}): Promise<Calls> {
  const calls: Calls = { search: 0, oembed: 0, bodies: [], trends: [] };
  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (pathname.startsWith("/thumb/")) {
      if (opts.expired?.includes(pathname)) return route.fulfill({ status: 403, headers: CORS });
      return route.fulfill({ status: 200, headers: CORS, contentType: "image/png", body: PNG });
    }
    const authed = req.headers()["authorization"] === `Bearer ${TOKEN}`;
    if (pathname === "/health")
      return json(authed ? { ok: true, auth: true, tavily: true } : { ok: true });
    if (!authed) return json({ error: "unauthorized" }, 401);
    if (pathname === "/search" && req.method() === "POST") {
      calls.search++;
      const body = JSON.parse(req.postData() ?? "{}") as SearchBody;
      calls.bodies.push(body);
      if (calls.search <= (opts.fail ?? 0)) return json({ error: "upstream" }, 503);
      const results = RESULTS.filter((r) =>
        body.platforms.length > 1
          ? r.platform === "yt"
          : body.platforms.includes(r.platform) && !opts.empty?.includes(r.platform),
      ).slice(0, body.max ?? 10);
      return json({ results, credits: { used: 1 } });
    }
    if (pathname === "/oembed") {
      calls.oembed++;
      return json({
        title: "Speed ramp + match cut",
        author: "@editor.sam",
        thumb: `${WORKER}/thumb/oembed.png`,
        url: new URL(req.url()).searchParams.get("url"),
      });
    }
    if (pathname.startsWith("/trends")) {
      calls.trends.push(`${req.method()} ${pathname}`);
      if (opts.feed && pathname === "/trends" && req.method() === "GET") return json(opts.feed());
    }
    return json({ error: "not_found" }, 404);
  });
  return calls;
}

interface YoutubeCalls {
  /** `search.list` requests (100 quota units each). */
  search: URL[];
  /**
   * `videos.list?part=statistics` requests (1 unit): one after every search that found something, and one
   * more each time a cached search whose statistics call had failed is asked for again.
   */
  stats: URL[];
}

interface FakeVideo {
  title: string;
  views?: number;
  likes?: number;
}

/**
 * Stub the YouTube Data API. `search.list` answers with `videos` (by video id, in that order whatever the
 * `order` asked); `videos.list` with their statistics, as strings like the real API, or with a 500 when
 * `statsDown` (read on every request, so a test can bring the statistics back). Returns the live request
 * lists.
 */
async function stubYoutube(
  page: Page,
  videos: Record<string, FakeVideo>,
  opts: { statsDown?: boolean } = {},
): Promise<YoutubeCalls> {
  const calls: YoutubeCalls = { search: [], stats: [] };
  await page.route("https://www.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/videos")) {
      calls.stats.push(url);
      if (opts.statsDown) return json({ error: { errors: [{ reason: "backendError" }] } }, 500);
      return json({
        items: Object.entries(videos).map(([id, v]) => ({
          id,
          statistics: {
            ...(v.views === undefined ? {} : { viewCount: String(v.views) }),
            ...(v.likes === undefined ? {} : { likeCount: String(v.likes) }),
          },
        })),
      });
    }
    calls.search.push(url);
    return json({
      items: Object.entries(videos).map(([id, v]) => ({
        id: { videoId: id },
        snippet: {
          title: v.title,
          channelTitle: "API Channel",
          thumbnails: { medium: { url: `${WORKER}/thumb/api.png` } },
        },
      })),
    });
  });
  return calls;
}

/** Fill the two Scout rows in Settings and press Test (expects "Tested OK"). */
async function connectWorker(page: Page): Promise<void> {
  await freshState(page, "/settings/");

  // An http:// (non-local) address is refused and never saved.
  await page.getByTestId("apikey-scoutUrl-input").fill("http://scout.test");
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await expect(page.getByTestId("apikey-scoutUrl-error")).toBeVisible();

  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await expect(page.getByTestId("apikey-scoutUrl-status")).toHaveText("محفوظ"); // "Set"

  await page.getByTestId("apikey-scoutToken-input").fill(TOKEN);
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓"); // "Tested OK"
}

async function openSkillSheet(page: Page): Promise<void> {
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`).click();
  await expect(page.getByTestId("skill-sheet")).toBeVisible();
}

/** On phones the filter chips sit behind a "Filters" button; on desktop they're always shown. */
async function openFilters(page: Page): Promise<void> {
  const toggle = page.getByTestId("filters-toggle");
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.getByTestId("filters")).toBeVisible();
}

const card = (page: Page, platform: string) =>
  page.locator(`[data-testid="result-card"][data-platform="${platform}"]`);

test("without the Worker, Discover shows a one-line hint linking to Settings", async ({ page }) => {
  await freshState(page, "/discover/");
  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("discover-topic").press("Enter");
  const hint = page.getByTestId("scout-not-configured");
  await expect(hint).toBeVisible();
  await expect(hint.locator('a[href^="/settings/"]')).toHaveCount(1);
  // TikTok / Instagram tabs say how to enable them too; YouTube explains both of its options.
  await page.getByTestId("tab-ig").click();
  await expect(page.getByTestId("scout-not-configured")).toBeVisible();
  await page.getByTestId("tab-yt").click();
  await expect(page.getByTestId("yt-no-key")).toBeVisible();
});

test("Discover: Worker cards with thumbnails, tabs query their own platform, attach + undo, cache and saved-only", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);

  await page.goto("/discover/");
  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("discover-topic").press("Enter");

  // "All" without a YouTube key: one Worker call per platform (a mixed request would come back YouTube
  // only), 10 results each, thumbnails on. TikTok and Instagram cards show next to YouTube.
  const tt = card(page, "tt").filter({ hasText: "Match cut in 10 seconds" });
  await expect(tt).toBeVisible();
  await expect(tt).toContainText("@editor.sam");
  await expect(card(page, "ig")).toContainText("@cutsbyfaisal");
  await expect(card(page, "yt")).toContainText("Match cuts explained");
  const sorted = [...calls.bodies].sort((a, b) => a.platforms[0].localeCompare(b.platforms[0]));
  expect(sorted).toEqual(
    ["ig", "tt", "yt"].map((p) => ({
      q: "match cut",
      platforms: [p],
      lang: "ar",
      max: 10,
      thumbs: true,
    })),
  );
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "3");
  // Every platform answered, so none says it came up empty.
  await expect(page.locator('[data-testid^="research-none-"]')).toHaveCount(0);

  // Thumbnails from the Worker's `thumb`; Instagram (no thumb) and the thumb-less TikTok get a placeholder.
  await expect(tt.getByTestId("result-thumb")).toHaveAttribute("src", `${WORKER}/thumb/tt1.png`);
  await expect(card(page, "yt").getByTestId("result-thumb")).toHaveAttribute(
    "src",
    `${WORKER}/thumb/yt1.png`,
  );
  await expect(card(page, "ig").getByTestId("result-thumb-placeholder")).toBeVisible();
  await expect(card(page, "ig").getByTestId("result-thumb")).toHaveCount(0);
  await expect(tt.getByTestId("result-open")).toHaveAttribute("target", "_blank");
  // A full card grid still fits the viewport (no horizontal scroll at 390 px).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // Tab badges count what's loaded.
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "4");
  await expect(page.getByTestId("tab-tt")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("tab-ig")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("tab-yt")).toHaveAttribute("data-count", "1");

  // The TikTok tab is the same TikTok request All made (cached, no second credit), and shows only TikTok.
  await page.getByTestId("tab-tt").click();
  await expect(page.getByTestId("tab-tt")).toHaveAttribute("aria-selected", "true");
  await expect(tt).toBeVisible();
  await expect(card(page, "ig")).toHaveCount(0);
  await expect(card(page, "yt")).toHaveCount(0);
  expect(calls.search).toBe(3);
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "3");

  // Attach the TikTok result to a skill through the picker, then undo, then attach again.
  await tt.getByTestId("result-attach").click();
  await page.getByTestId("skill-picker-search").fill("Smart Bins");
  await page.getByTestId("skill-picker-option").first().click();
  await expect(tt.getByTestId("result-attached")).toContainText("Smart Bins");
  await tt.getByTestId("result-undo").click();
  await expect(tt.getByTestId("result-attached")).toHaveCount(0);
  await tt.getByTestId("result-attach").click();
  await page.getByTestId("skill-picker-search").fill("Smart Bins");
  await page.getByTestId("skill-picker-option").first().click();
  await expect(tt.getByTestId("result-attached")).toBeVisible();

  // Reload: the tab is remembered on this device, and the same topic comes from the cache (no new call).
  await page.reload();
  await expect(page.getByTestId("tab-tt")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("discover-recent-topic").filter({ hasText: "match cut" }).click();
  await expect(tt).toBeVisible();
  await expect(tt.getByTestId("result-attached")).toBeVisible();
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "3");
  expect(calls.search).toBe(3);

  // "Saved only" shows the references already attached (from the store), not search results.
  await page.getByTestId("tab-all").click();
  await openFilters(page);
  await page.getByTestId("filter-saved").click();
  await expect(page.getByTestId("result-card")).toHaveCount(1);
  await expect(card(page, "tt")).toContainText("Match cut in 10 seconds");
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("tab-ig")).toHaveAttribute("data-count", "0");
  await page.getByTestId("tab-ig").click();
  await expect(page.getByTestId("research-empty")).toBeVisible();
  expect(calls.search).toBe(3);

  // The reference was saved on the skill, with its thumbnail.
  await page.goto("/skills/");
  await openSkillSheet(page);
  const saved = page.getByTestId("saved-ref").filter({ hasText: "Match cut in 10 seconds" });
  await expect(saved).toBeVisible();
  await expect(saved.getByTestId("saved-ref-thumb")).toHaveAttribute(
    "src",
    `${WORKER}/thumb/tt1.png`,
  );
});

test("tabs switch sources: YouTube goes to the Data API when a key exists, the rest to the Worker", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await page.getByTestId("apikey-youtube-input").fill("AIzaFAKE1234567890");
  await page.getByTestId("apikey-youtube-input").press("Enter");

  const yt = await stubYoutube(page, { apiVid1: { title: "From the YouTube API", views: 1234 } });

  await page.goto("/discover/");
  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("research-search").click();

  // All: the Worker is asked for TikTok and Instagram (one request each); YouTube comes from the API.
  await expect(card(page, "yt")).toContainText("From the YouTube API");
  await expect(card(page, "tt").first()).toBeVisible();
  await expect(card(page, "ig")).toBeVisible();
  expect(calls.bodies.map((b) => b.platforms).sort()).toEqual([["ig"], ["tt"]]);
  expect(yt.search).toHaveLength(1);
  await expect(card(page, "yt")).not.toContainText("Match cuts explained");
  // One statistics call (1 quota unit) came after the search; the card shows the views it brought.
  expect(yt.stats).toHaveLength(1);
  await expect(card(page, "yt").getByTestId("result-stats")).toHaveAttribute("data-views", "1234");

  // YouTube tab: API only (cached), no Worker call.
  await page.getByTestId("tab-yt").click();
  await expect(card(page, "yt")).toContainText("From the YouTube API");
  await expect(card(page, "tt")).toHaveCount(0);
  expect(calls.bodies).toHaveLength(2);
  expect(yt.search).toHaveLength(1);
  expect(yt.stats).toHaveLength(1);

  // Instagram tab: All's Instagram request, from the cache.
  await page.getByTestId("tab-ig").click();
  await expect(card(page, "ig")).toContainText("@cutsbyfaisal");
  expect(calls.bodies).toHaveLength(2);

  // Recency goes to the Worker as timeRange (and to YouTube as publishedAfter on its tabs).
  await openFilters(page);
  await page.getByTestId("filter-time-month").click();
  await expect.poll(() => calls.bodies.length).toBe(3);
  expect(calls.bodies[2]).toMatchObject({ platforms: ["ig"], timeRange: "month" });

  // Arabic first: sends lang "ar" and sorts Arabic titles to the top.
  await page.getByTestId("research-lang-en").click();
  await page.getByTestId("tab-tt").click();
  await expect(card(page, "tt").first()).toContainText("Match cut in 10 seconds");
  await page.getByTestId("filter-arfirst").click();
  await expect(card(page, "tt").first()).toContainText("ماتش كت بالجوال");
  const last = calls.bodies[calls.bodies.length - 1];
  expect(last).toMatchObject({ platforms: ["tt"], lang: "ar", timeRange: "month" });
});

test("skill sheet: Worker results attach to the skill, and a pasted TikTok link is enriched via oEmbed", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);

  await page.goto("/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();

  const ig = card(page, "ig");
  await expect(ig).toBeVisible();
  await ig.getByTestId("result-attach").click();
  await expect(page.getByTestId("saved-ref").filter({ hasText: "Match cut reel" })).toBeVisible();
  await expect(ig.getByTestId("result-attach")).toHaveAttribute("aria-pressed", "true");

  // Paste a TikTok link with no title: title, handle and thumbnail come from the Worker's oEmbed.
  await page.getByTestId("paste-toggle").click();
  await page.getByTestId("paste-link-url").fill("https://www.tiktok.com/@editor.sam/video/42");
  await page.getByTestId("paste-link-save").click();
  const enriched = page.getByTestId("saved-ref").filter({ hasText: "Speed ramp + match cut" });
  await expect(enriched).toBeVisible();
  await expect(enriched.getByTestId("saved-ref-thumb")).toHaveAttribute(
    "src",
    `${WORKER}/thumb/oembed.png`,
  );
  expect(calls.oembed).toBe(1);
});

/** Discover: commit a topic with Enter. */
async function search(page: Page, topic = "match cut"): Promise<void> {
  await page.getByTestId("discover-topic").fill(topic);
  await page.getByTestId("discover-topic").press("Enter");
}

test("tab badges: empty until that tab's own search has answered, then its own count", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await page.goto("/discover/");

  // Start on TikTok: only TikTok is asked, and only TikTok gets a badge (not one borrowed from All).
  await page.getByTestId("tab-tt").click();
  await search(page);
  await expect(page.getByTestId("tab-tt")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("tab-ig")).toHaveAttribute("data-count", "");
  await expect(page.getByTestId("tab-yt")).toHaveAttribute("data-count", "");
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "");
  expect(calls.bodies.map((b) => b.platforms)).toEqual([["tt"]]);

  // Instagram answers: its badge; All still waits for YouTube.
  await page.getByTestId("tab-ig").click();
  await expect(page.getByTestId("tab-ig")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "");

  // All asks only what's missing (YouTube) and counts every platform.
  await page.getByTestId("tab-all").click();
  await expect(page.getByTestId("tab-yt")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "4");
  await expect(page.getByTestId("result-card")).toHaveCount(4);
  expect(calls.bodies.map((b) => b.platforms)).toEqual([["tt"], ["ig"], ["yt"]]);
});

test("Search again after a Worker error asks again, and the cards replace the error", async ({
  page,
}) => {
  // The first three searches (All's three platforms) fail with a 503.
  const calls = await stubWorker(page, { fail: 3 });
  await connectWorker(page);
  await page.goto("/discover/");
  await search(page);

  // The same failure on every platform is said once.
  const error = page.getByTestId("scout-error");
  await expect(error).toHaveCount(1);
  await expect(error).toHaveAttribute("data-error", "upstream");
  expect(calls.search).toBe(3);

  await page.getByTestId("research-search").click();
  await expect.poll(() => calls.search).toBe(6);
  await expect(card(page, "tt").first()).toBeVisible();
  await expect(card(page, "ig")).toBeVisible();
  await expect(error).toHaveCount(0);

  // Pressing it again with answers in hand is served from the cache: no new request.
  await page.getByTestId("research-search").click();
  await expect(card(page, "ig")).toBeVisible();
  expect(calls.search).toBe(6);
});

test("All: a platform with nothing says so, with a link to search it there; the ↗ menu closes", async ({
  page,
}) => {
  await stubWorker(page, { empty: ["ig"] });
  await connectWorker(page);
  await page.goto("/discover/");
  await search(page);

  await expect(card(page, "tt").first()).toBeVisible();
  const none = page.getByTestId("research-none-ig");
  await expect(none).toBeVisible();
  await expect(none).toContainText("انستقرام");
  await expect(none.getByTestId("none-link-ig-ig")).toHaveAttribute("href", /match%20cut/);
  await expect(page.getByTestId("research-none-tt")).toHaveCount(0);
  await expect(page.getByTestId("research-none-yt")).toHaveCount(0);
  await expect(page.getByTestId("tab-ig")).toHaveAttribute("data-count", "0");

  // The "↗ ⋯" menu closes on a tap outside it, on Escape, and after following one of its links.
  const menu = page.getByTestId("research-more");
  await page.getByTestId("research-more-toggle").click();
  await expect(menu).toHaveAttribute("open", "");
  // (All is the tab farthest from the menu, which covers the others on a phone.)
  await page.getByTestId("tab-all").click();
  await expect(menu).not.toHaveAttribute("open");

  await page.getByTestId("research-more-toggle").click();
  await expect(menu).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open");

  await page
    .context()
    .route("https://www.tiktok.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<p>TikTok</p>" }),
    );
  await page.getByTestId("research-more-toggle").click();
  const popup = page.waitForEvent("popup");
  await page.getByTestId("research-link-tt").click();
  await (await popup).close();
  await expect(menu).not.toHaveAttribute("open");
});

test("a YouTube key that's out of quota: YouTube comes from the Worker instead", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await page.getByTestId("apikey-youtube-input").fill("AIzaFAKE1234567890");
  await page.getByTestId("apikey-youtube-input").press("Enter");
  await page.route("https://www.googleapis.com/**", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }),
    }),
  );

  await page.goto("/discover/");
  await search(page);
  await expect(page.getByTestId("yt-error")).toHaveAttribute("data-error", "quota");
  await expect(card(page, "yt")).toContainText("Match cuts explained");
  await expect(card(page, "tt").first()).toBeVisible();
  expect(calls.bodies.map((b) => b.platforms).sort()).toEqual([["ig"], ["tt"], ["yt"]]);
  await expect(page.getByTestId("yt-via-scout")).toBeVisible();

  await page.getByTestId("tab-yt").click();
  await expect(card(page, "yt")).toContainText("Match cuts explained");
  await expect(page.getByTestId("yt-via-scout")).toBeVisible();
  expect(calls.search).toBe(3);
});

test("an expired TikTok thumbnail is swapped for a fresh one from oEmbed, asked once", async ({
  page,
}) => {
  const calls = await stubWorker(page, { expired: ["/thumb/tt1.png"] });
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("tab-tt").click();
  await search(page);

  const tt = card(page, "tt").filter({ hasText: "Match cut in 10 seconds" });
  await tt.scrollIntoViewIfNeeded(); // (thumbnails load lazily)
  await expect(tt.getByTestId("result-thumb")).toHaveAttribute("src", `${WORKER}/thumb/oembed.png`);
  expect(calls.oembed).toBe(1);
});

/* ---------- 🎬 edit genres and the "Most popular" sort (round 31) ---------- */

// The main queries of two built-in genres (planning/data/genres.json).
const CARS_AR = "ايديت سيارات";
const CARS_EN = "car edit";
const FOOD_AR = "مونتاج أكل";

/** The texts the Worker was asked for, in order. */
const asked = (calls: Calls) => calls.bodies.map((b) => b.q);
const titles = (page: Page) => page.getByTestId("result-title");
const genreOn = (page: Page) => page.getByTestId("genres-row");

test("edit genre: a chip alone searches the genre's own words, in the search language", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await page.goto("/discover/");
  // One platform, so every search is exactly one Worker request.
  await page.getByTestId("tab-tt").click();

  // The row offers every built-in genre without wrapping: the tabs stay in view, the page never scrolls
  // sideways (the row itself does).
  await expect(page.locator('[data-testid="genres-chips"] [data-testid^="genre-"]')).toHaveCount(
    12,
  );
  await expect(page.getByTestId("tab-all")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // No topic typed: the chip is the whole search, in Arabic (the search language of an Arabic dashboard).
  await page.getByTestId("genre-cars").click();
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "true");
  await expect(genreOn(page)).toHaveAttribute("data-genre", "cars");
  await expect(card(page, "tt").first()).toBeVisible();
  expect(calls.bodies).toEqual([
    { q: CARS_AR, platforms: ["tt"], lang: "ar", max: 10, thumbs: true },
  ]);
  // The topic box stays empty and a genre alone is never remembered as a recent topic.
  await expect(page.getByTestId("discover-topic")).toHaveValue("");
  await expect(page.getByTestId("discover-recent-topic")).toHaveCount(0);
  await expect(page.getByTestId("research-start")).toHaveCount(0);
  // This Worker has no trends feed (a 404): the genre's feed was asked for once, and with nothing to
  // show there is no "most viewed this week" strip and no error line (the strip is an extra).
  await expect.poll(() => calls.trends).toEqual(["GET /trends"]);
  await expect(page.getByTestId("genre-week")).toHaveCount(0);
  await expect(page.getByTestId("scout-error")).toHaveCount(0);

  // The "open on platform" links search the same words; the Instagram hashtag is the genre's own.
  await expect(page.getByTestId("research-link-tt")).toHaveAttribute(
    "href",
    `https://www.tiktok.com/search?q=${encodeURIComponent(CARS_AR)}`,
  );
  await expect(page.getByTestId("research-link-ig-hashtag")).toHaveAttribute(
    "href",
    "https://www.instagram.com/explore/tags/caredit/",
  );

  // EN as the search language: the genre's English words.
  await page.getByTestId("research-lang-en").click();
  await expect.poll(() => calls.bodies.length).toBe(2);
  expect(calls.bodies[1]).toMatchObject({ q: CARS_EN, platforms: ["tt"], lang: "en" });
  await expect(page.getByTestId("research-link-yt")).toHaveAttribute("href", /car%20edit$/);

  // A chip at the far end of the row is reachable too (the row scrolls to it).
  await page.getByTestId("genre-gym").click();
  await expect(page.getByTestId("genre-gym")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => calls.bodies.length).toBe(3);
  expect(asked(calls)[2]).toBe("gym edit");
  // Once per visit: other genres and languages do not ask for the feed again.
  expect(calls.trends).toEqual(["GET /trends"]);
});

test("edit genre: a topic and a genre are searched together, and only the topic is remembered", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("tab-tt").click();

  // Typed but not submitted: the chip commits it as the topic, then searches topic + genre.
  await page.getByTestId("discover-topic").fill("drift");
  await page.getByTestId("genre-cars").click();
  await expect(card(page, "tt").first()).toBeVisible();
  expect(asked(calls)).toEqual([`drift ${CARS_AR}`]);
  await expect(page.getByTestId("discover-topic")).toHaveValue("drift");
  await expect(page.getByTestId("discover-recent-topic")).toHaveText(["drift"]);
  await expect(page.getByTestId("research-link-tt")).toHaveAttribute(
    "href",
    `https://www.tiktok.com/search?q=${encodeURIComponent(`drift ${CARS_AR}`)}`,
  );
  // With a topic, the hashtag stays the topic's own.
  await expect(page.getByTestId("research-link-ig-hashtag")).toHaveAttribute(
    "href",
    "https://www.instagram.com/explore/tags/drift/",
  );

  // Another genre replaces the first one.
  await page.getByTestId("genre-food").click();
  await expect(page.getByTestId("genre-food")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => calls.bodies.length).toBe(2);
  expect(asked(calls)[1]).toBe(`drift ${FOOD_AR}`);

  // A new topic keeps the genre; the program name still goes last.
  await search(page, "night");
  await expect.poll(() => calls.bodies.length).toBe(3);
  expect(asked(calls)[2]).toBe(`night ${FOOD_AR}`);
  await page.getByTestId("discover-program").selectOption("davinci");
  await expect.poll(() => calls.bodies.length).toBe(4);
  expect(asked(calls)[3]).toBe(`night ${FOOD_AR} DaVinci Resolve`);
  // Recent topics hold the typed topics only, never the genre's words.
  await expect(page.getByTestId("discover-recent-topic")).toHaveText(["night", "drift"]);
});

test("edit genre: tapping the active chip (or the ✕) clears it", async ({ page }) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("tab-tt").click();
  const ttLink = page.getByTestId("research-link-tt");
  const plain = "https://www.tiktok.com/search?q=match%20cut";

  await search(page);
  await expect(card(page, "tt").first()).toBeVisible();
  await expect(page.getByTestId("genres-clear")).toHaveCount(0);

  await page.getByTestId("genre-cars").click();
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => calls.bodies.length).toBe(2);
  expect(asked(calls)).toEqual(["match cut", `match cut ${CARS_AR}`]);

  // The same chip again: no genre, and the topic alone is searched (served from the cache, no credit).
  await page.getByTestId("genre-cars").click();
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "false");
  await expect(genreOn(page)).toHaveAttribute("data-genre", "");
  await expect(ttLink).toHaveAttribute("href", plain);
  await expect(card(page, "tt").first()).toBeVisible();
  expect(calls.search).toBe(2);

  // The ✕ at the end of the row does the same, and only shows while a genre is on.
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("genre-anime")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => calls.bodies.length).toBe(3);
  await page.getByTestId("genres-clear").click();
  await expect(page.getByTestId("genre-anime")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("genres-clear")).toHaveCount(0);
  await expect(ttLink).toHaveAttribute("href", plain);
  expect(calls.search).toBe(3);

  // A genre with no topic, cleared: nothing is left to search.
  await search(page, "");
  await page.getByTestId("genre-cars").click();
  await expect.poll(() => calls.bodies.length).toBe(4);
  expect(asked(calls)[3]).toBe(CARS_AR);
  await page.getByTestId("genre-cars").click();
  await expect(page.getByTestId("research-start")).toBeVisible();
  await expect(page.getByTestId("result-card")).toHaveCount(0);
  expect(calls.search).toBe(4);
});

test("Most popular: cards are ordered by their stats, and each shows its views or likes", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await page.goto("/discover/");
  await search(page);

  // Best match (the default): the order the sources gave, platforms interleaved.
  await expect(titles(page)).toHaveText([
    "Match cuts explained",
    "Match cut in 10 seconds",
    "Match cut reel",
    "ماتش كت بالجوال",
  ]);

  // The stats chip: views when known (YouTube), else likes (TikTok), nothing without numbers (the reel).
  const stats = (platform: string, text: string) =>
    card(page, platform).filter({ hasText: text }).getByTestId("result-stats");
  const ytStats = stats("yt", "Match cuts explained");
  await expect(ytStats).toHaveAttribute("data-views", "5400");
  await expect(ytStats).toHaveAttribute("data-likes", "310");
  await expect(ytStats).toHaveAttribute("data-kind", "views");
  await expect(ytStats).toContainText("👁");
  const ttStats = stats("tt", "Match cut in 10 seconds");
  await expect(ttStats).toHaveAttribute("data-likes", "1200");
  await expect(ttStats).not.toHaveAttribute("data-views");
  await expect(ttStats).toHaveAttribute("data-kind", "likes");
  await expect(ttStats).toContainText("❤️");
  await expect(stats("tt", "ماتش كت بالجوال")).toHaveAttribute("data-likes", "45000");
  await expect(card(page, "ig").getByTestId("result-stats")).toHaveCount(0);
  await expect(page.getByTestId("popular-note")).toHaveCount(0);

  // Most popular: highest first (views, else likes x 10), the card without numbers last. Sorting is
  // local: no new Worker request, no credit.
  await openFilters(page);
  await expect(page.getByTestId("filter-sort-relevance")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("filter-sort-popular").click();
  await expect(page.getByTestId("filter-sort-popular")).toHaveAttribute("aria-pressed", "true");
  await expect(titles(page)).toHaveText([
    "ماتش كت بالجوال",
    "Match cut in 10 seconds",
    "Match cuts explained",
    "Match cut reel",
  ]);
  expect(calls.search).toBe(3);
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "3");
  await expect(page.getByTestId("popular-note")).toHaveCount(0);
  // It counts as an active filter on the phone's Filters button.
  if (await page.getByTestId("filters-toggle").isVisible()) {
    await expect(page.getByTestId("filters-count")).toHaveText("1");
  }
  // The badges count the same cards in any order.
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "4");

  // One platform: its own cards by popularity.
  await page.getByTestId("tab-tt").click();
  await expect(titles(page)).toHaveText(["ماتش كت بالجوال", "Match cut in 10 seconds"]);

  // No numbers on any shown card (the Instagram reel): a line says why the order did not change.
  await page.getByTestId("tab-ig").click();
  await expect(card(page, "ig")).toBeVisible();
  await expect(page.getByTestId("popular-note")).toBeVisible();
  expect(calls.search).toBe(3);

  // Back to best match: the first order again, and no note.
  await page.getByTestId("filter-sort-relevance").click();
  await expect(page.getByTestId("popular-note")).toHaveCount(0);
  await page.getByTestId("tab-all").click();
  await expect(titles(page)).toHaveText([
    "Match cuts explained",
    "Match cut in 10 seconds",
    "Match cut reel",
    "ماتش كت بالجوال",
  ]);
});

/** Save a (fake) YouTube Data API key in Settings; call right after connectWorker. */
async function addYoutubeKey(page: Page): Promise<void> {
  await page.getByTestId("apikey-youtube-input").fill("AIzaFAKE1234567890");
  await page.getByTestId("apikey-youtube-input").press("Enter");
  await expect(page.getByTestId("apikey-youtube-status")).toHaveText("محفوظ"); // "Set"
}

const VIDEOS: Record<string, FakeVideo> = {
  quiet: { title: "Quiet one", views: 900, likes: 40 },
  big: { title: "Big one", views: 2_500_000 },
  hidden: { title: "No numbers" },
};

test("Most popular with a YouTube key: the API is asked by view count, and its statistics fill the cards", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);
  await addYoutubeKey(page);
  const yt = await stubYoutube(page, VIDEOS);

  await page.goto("/discover/");
  await page.getByTestId("tab-yt").click();
  await page.getByTestId("genre-cars").click();
  await expect(titles(page)).toHaveText(["Quiet one", "Big one", "No numbers"]);

  // Best match: the same request as before the sort existed (no `order`), then ONE statistics call.
  expect(yt.search).toHaveLength(1);
  expect(yt.search[0].searchParams.get("q")).toBe(CARS_AR);
  expect(yt.search[0].searchParams.has("order")).toBe(false);
  expect(yt.stats).toHaveLength(1);
  expect(yt.stats[0].pathname).toBe("/youtube/v3/videos");
  expect(yt.stats[0].searchParams.get("part")).toBe("statistics");
  expect(yt.stats[0].searchParams.get("id")).toBe("quiet,big,hidden");
  const big = card(page, "yt").filter({ hasText: "Big one" }).getByTestId("result-stats");
  await expect(big).toHaveAttribute("data-views", "2500000");
  await expect(big).toContainText("👁");
  await expect(
    card(page, "yt").filter({ hasText: "No numbers" }).getByTestId("result-stats"),
  ).toHaveCount(0);

  // Most popular: a search of its own with order=viewCount, shown highest first.
  await openFilters(page);
  await page.getByTestId("filter-sort-popular").click();
  await expect.poll(() => yt.search.length).toBe(2);
  expect(yt.search[1].searchParams.get("order")).toBe("viewCount");
  expect(yt.search[1].searchParams.get("q")).toBe(CARS_AR);
  await expect(titles(page)).toHaveText(["Big one", "Quiet one", "No numbers"]);
  expect(yt.stats).toHaveLength(2);
  await expect(page.getByTestId("tab-yt")).toHaveAttribute("data-count", "3");

  // Back and forth: both answers are cached for the session.
  await page.getByTestId("filter-sort-relevance").click();
  await expect(titles(page)).toHaveText(["Quiet one", "Big one", "No numbers"]);
  await page.getByTestId("filter-sort-popular").click();
  await expect(titles(page)).toHaveText(["Big one", "Quiet one", "No numbers"]);
  expect(yt.search).toHaveLength(2);
  expect(yt.stats).toHaveLength(2);
  // The Worker was never asked for YouTube.
  expect(calls.search).toBe(0);
});

test("YouTube statistics failing: the videos still show, without numbers; Search again brings the numbers back without a second search", async ({
  page,
}) => {
  await stubWorker(page);
  await connectWorker(page);
  await addYoutubeKey(page);
  const api = { statsDown: true };
  const yt = await stubYoutube(page, VIDEOS, api);

  await page.goto("/discover/");
  await page.getByTestId("tab-yt").click();
  await search(page, "car edit");
  await expect(titles(page)).toHaveText(["Quiet one", "Big one", "No numbers"]);
  expect(yt.stats).toHaveLength(1);
  await expect(page.getByTestId("yt-error")).toHaveCount(0);
  await expect(page.getByTestId("result-stats")).toHaveCount(0);

  await openFilters(page);
  await page.getByTestId("filter-sort-popular").click();
  await expect.poll(() => yt.search.length).toBe(2);
  await expect(page.getByTestId("popular-note")).toBeVisible();
  // No numbers to sort by: the order YouTube gave.
  await expect(titles(page)).toHaveText(["Quiet one", "Big one", "No numbers"]);
  expect(yt.stats).toHaveLength(2);

  // The statistics answer again. Search again: the cached videos get their numbers from ONE statistics
  // call (1 quota unit); the search itself (100) is never repeated.
  api.statsDown = false;
  await page.getByTestId("research-search").click();
  const big = card(page, "yt").filter({ hasText: "Big one" }).getByTestId("result-stats");
  await expect(big).toHaveAttribute("data-views", "2500000");
  await expect(page.getByTestId("popular-note")).toHaveCount(0);
  await expect(titles(page)).toHaveText(["Big one", "Quiet one", "No numbers"]);
  expect(yt.search).toHaveLength(2);
  expect(yt.stats).toHaveLength(3);
  expect(yt.stats[2].searchParams.get("part")).toBe("statistics");
  expect(yt.stats[2].searchParams.get("id")).toBe("quiet,big,hidden");

  // The numbers are cached with the videos now: pressing it again asks for nothing.
  await page.getByTestId("research-search").click();
  await expect(big).toHaveAttribute("data-views", "2500000");
  expect(yt.search).toHaveLength(2);
  expect(yt.stats).toHaveLength(3);

  // The other cached search (Best match) gets its numbers the same way when it is shown again.
  await page.getByTestId("filter-sort-relevance").click();
  await expect(titles(page)).toHaveText(["Quiet one", "Big one", "No numbers"]);
  await expect(big).toHaveAttribute("data-views", "2500000");
  await expect(
    card(page, "yt").filter({ hasText: "No numbers" }).getByTestId("result-stats"),
  ).toHaveCount(0);
  expect(yt.search).toHaveLength(2);
  expect(yt.stats).toHaveLength(4);
  await expect(page.getByTestId("yt-error")).toHaveCount(0);
});

/* ---------- 📈 "Most viewed this week" and the ?genre= link (round 31b: Discover is the one place for genres) ---------- */

/**
 * The Worker's `GET /trends` feed, read just now: seven Arabic car rows of its daily keyword scan ("YouTube
 * search", the genre id, the query that found them first in the tags; best score = most viewed), a better one
 * with no link, one English car row, one food row, and a Google row without a genre.
 */
function weekFeed() {
  const seenAt = new Date().toISOString();
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id: `youtube:SA:q-${id}`,
    platform: "youtube",
    region: "SA",
    lang: "ar",
    title: `مونتاج سيارات ${id}`,
    url: `https://www.youtube.com/shorts/${id}`,
    thumb: `${WORKER}/thumb/${id}.png`,
    source: "YouTube search",
    why: "قناة السيارات",
    seenAt,
    genre: "cars",
    tags: [CARS_AR, "short"],
    ...over,
  });
  return {
    items: [
      ...Array.from({ length: 7 }, (_, i) =>
        row(`car${i + 1}`, { score: 95 - i * 10, volume: (7 - i) * 100_000 }),
      ),
      row("nolink", { score: 100, url: undefined }),
      row("caren", {
        id: "youtube:US:q-caren",
        region: "US",
        lang: "en",
        title: "Cinematic car edit",
        score: 100,
        tags: [CARS_EN, "short"],
      }),
      row("food1", {
        title: "أحلى مطاعم الرياض",
        genre: "food",
        score: 90,
        tags: [FOOD_AR, "short"],
      }),
      {
        id: "google:SA:حساب-المواطن",
        platform: "google",
        region: "SA",
        lang: "ar",
        title: "حساب المواطن",
        score: 100,
        source: "Google Trends",
        seenAt,
      },
    ],
    fetchedAt: seenAt,
    degraded: false,
    sources: [{ name: "youtubeSearch", ok: true, at: seenAt }],
  };
}

// The page does not scroll sideways: measured against the page's own width, not `innerWidth`, which on the
// phone (mobile emulation) grows to fit whatever overflows, so it could never catch it there.
const fitsViewport = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });

test("Most viewed this week: a picked genre shows the radar's rows of it in one sideways row, with the same attach", async ({
  page,
}) => {
  test.slow();
  const calls = await stubWorker(page, { feed: weekFeed });
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("tab-tt").click();

  // Without a genre there is no strip, and the feed is never asked for.
  const week = page.getByTestId("genre-week");
  const weekTitles = week.getByTestId("result-title");
  await expect(page.getByTestId("genres-row")).toBeVisible();
  await expect(week).toHaveCount(0);
  expect(calls.trends).toEqual([]);

  // A genre: the app had no feed, so it reads the Worker's once (never runs the sources), and shows the
  // genre's Arabic rows (the search language), best first, the six first of those with a link.
  await page.getByTestId("genre-cars").click();
  await expect(week).toBeVisible();
  await expect(week).toHaveAttribute("data-genre", "cars");
  expect(calls.trends).toEqual(["GET /trends"]);
  await expect(weekTitles).toHaveText([1, 2, 3, 4, 5, 6].map((n) => `مونتاج سيارات car${n}`));
  await expect(page.getByTestId("genre-week-title")).toHaveText("📈 الأكثر مشاهدة هالأسبوع");
  // Honest about what it is: the most viewed results of the radar's YouTube search for the genre.
  await expect(page.getByTestId("genre-week-source")).toHaveText(
    "من رادار الترند: بحث يوتيوب عن سيارات",
  );

  // The panel's own cards: YouTube, the channel, the views, the thumbnail, the video's watch link.
  const top = week.getByTestId("genre-week-item").first();
  await expect(top).toHaveAttribute("data-platform", "yt");
  await expect(top).toContainText("قناة السيارات");
  await expect(top.getByTestId("result-stats")).toHaveAttribute("data-views", "700000");
  await expect(top.getByTestId("result-thumb")).toHaveAttribute("src", `${WORKER}/thumb/car1.png`);
  await expect(top.getByTestId("result-open")).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=car1",
  );
  // The search's own results are a separate list below it.
  await expect(card(page, "tt").first()).toBeVisible();
  await expect(page.getByTestId("result-card")).toHaveCount(2);
  expect(await page.getByTestId("result-list").getByTestId("genre-week-item").count()).toBe(0);

  // One row that scrolls sideways; the page itself never does.
  const list = page.getByTestId("genre-week-list");
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await fitsViewport(page)).toBe(true);

  // The same attach action as a result: the skill picker, then "attached to" on the card.
  await top.getByTestId("result-attach").click();
  await page.getByTestId("skill-picker-search").fill("Smart Bins");
  await page.getByTestId("skill-picker-option").first().click();
  await expect(top.getByTestId("result-attached")).toContainText("Smart Bins");

  // The app in English (left to right): the same row, the page still never scrolls sideways, and the first
  // card still takes a tap (undo, then attach it again).
  await page.getByTestId("lang-en").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("genre-week-title")).toHaveText("📈 Most viewed this week");
  expect(await fitsViewport(page)).toBe(true);
  await top.getByTestId("result-undo").click();
  await top.getByTestId("result-attach").click();
  await page.getByTestId("skill-picker-search").fill("Smart Bins");
  await page.getByTestId("skill-picker-option").first().click();
  await expect(top.getByTestId("result-attached")).toContainText("Smart Bins");
  await page.getByTestId("lang-ar").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // English words, English rows; another genre, its own rows; a genre without rows, no strip at all.
  await page.getByTestId("research-lang-en").click();
  await expect(weekTitles).toHaveText(["Cinematic car edit"]);
  await page.getByTestId("research-lang-ar").click();
  await page.getByTestId("genre-food").click();
  await expect(week).toHaveAttribute("data-genre", "food");
  await expect(weekTitles).toHaveText(["أحلى مطاعم الرياض"]);
  await expect(page.getByTestId("genre-week-source")).toHaveText(
    "من رادار الترند: بحث يوتيوب عن أكل ومطاعم",
  );
  await page.getByTestId("genre-anime").click();
  await expect(page.getByTestId("genre-anime")).toHaveAttribute("aria-pressed", "true");
  await expect(week).toHaveCount(0);

  // Saved only hides it; off again, it is back.
  await page.getByTestId("genre-cars").click();
  await expect(weekTitles).toHaveCount(6);
  await openFilters(page);
  await page.getByTestId("filter-saved").click();
  await expect(page.getByTestId("filter-saved")).toHaveAttribute("aria-pressed", "true");
  await expect(week).toHaveCount(0);
  await page.getByTestId("filter-saved").click();
  await expect(weekTitles).toHaveCount(6);
  // The feed was read once in all of that.
  expect(calls.trends).toEqual(["GET /trends"]);

  // The skill sheet's Research panel shows it too; the stored feed is fresh now, so nothing is read, and
  // the card attached from Discover shows as attached to this skill.
  await page.goto("/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();
  await page.getByTestId("skill-sheet").getByTestId("genre-cars").click();
  const sheetWeek = page.getByTestId("skill-sheet").getByTestId("genre-week");
  await expect(sheetWeek.getByTestId("genre-week-item")).toHaveCount(6);
  await expect(
    sheetWeek.getByTestId("genre-week-item").first().getByTestId("result-attach"),
  ).toHaveAttribute("aria-pressed", "true");
  expect(calls.trends).toEqual(["GET /trends"]);
});

test("/discover/?genre=cars opens with the Cars chip pressed and the genre's search sent", async ({
  page,
}) => {
  test.slow();
  const calls = await stubWorker(page, { feed: weekFeed });
  await connectWorker(page);
  const picked = page.locator('[data-testid^="genre-"][aria-pressed="true"]');

  // The link the radar's genre chips open (lib/genres discoverGenreHref), loaded directly.
  await page.goto("/discover/?genre=cars");
  await expect(page.getByTestId("genre-cars")).toHaveAttribute("aria-pressed", "true");
  await expect(picked).toHaveCount(1);
  await expect(genreOn(page)).toHaveAttribute("data-genre", "cars");
  // Exactly like a tap on the chip: the genre's own words searched on every platform of the All tab,
  // nothing typed, nothing remembered.
  await expect
    .poll(() => calls.bodies.map((b) => b.platforms[0]).sort())
    .toEqual(["ig", "tt", "yt"]);
  expect(asked(calls)).toEqual([CARS_AR, CARS_AR, CARS_AR]);
  await expect(page.getByTestId("discover-topic")).toHaveValue("");
  await expect(page.getByTestId("discover-recent-topic")).toHaveCount(0);
  // The address no longer names the genre, and the genre's most viewed this week are there.
  await expect(page).toHaveURL(/\/discover\/$/);
  await expect(page.getByTestId("genre-week")).toHaveAttribute("data-genre", "cars");
  expect(calls.trends).toEqual(["GET /trends"]);
  expect(await fitsViewport(page)).toBe(true);

  // A reload does not force the genre again.
  await page.reload();
  await expect(page.getByTestId("genres-row")).toBeVisible();
  await expect(genreOn(page)).toHaveAttribute("data-genre", "");
  await expect(picked).toHaveCount(0);
  expect(calls.search).toBe(3);

  // A chip at the far end of the row is brought into view (the row scrolls to it on a phone).
  await page.goto("/discover/?genre=gym");
  const gym = page.getByTestId("genre-gym");
  await expect(gym).toHaveAttribute("aria-pressed", "true");
  await expect(gym).toBeInViewport();
  await expect.poll(() => calls.search).toBe(6);
  expect(asked(calls).slice(3)).toEqual(["ايديت جيم", "ايديت جيم", "ايديت جيم"]);
  await expect(page).toHaveURL(/\/discover\/$/);

  // A genre the app does not know is ignored (and taken off the address too).
  await page.goto("/discover/?genre=drone");
  await expect(page).toHaveURL(/\/discover\/$/);
  await expect(page.getByTestId("research-start")).toBeVisible();
  await expect(picked).toHaveCount(0);
  expect(calls.search).toBe(6);
});
