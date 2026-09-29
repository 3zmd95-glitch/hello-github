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
const RESULTS = [
  {
    platform: "tt",
    handle: "@editor.sam",
    title: "Match cut in 10 seconds",
    snippet: "Two shots, one motion: the cleanest match cut trick in CapCut.",
    url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001",
    thumb: `${WORKER}/thumb/tt1.png`,
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
  },
  {
    platform: "tt",
    handle: "@cuts.hijazi",
    title: "ماتش كت بالجوال",
    snippet: "",
    url: "https://www.tiktok.com/@cuts.hijazi/video/7300000000000000002",
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
}

interface StubOpts {
  /** Answer the first N searches with a 503 (the search service having a problem). */
  fail?: number;
  /** Platforms that have nothing for the topic. */
  empty?: string[];
  /** Thumbnails that no longer load (TikTok's signed image URLs expire after about two days). */
  expired?: string[];
}

/**
 * Stub the whole fake Worker. Returns live call counters and the /search request bodies. Like the real
 * Worker it honours `platforms` and `max`, and like Tavily a mixed request is one capped answer where one
 * platform crowds out the rest (here: YouTube only), which is why the app never sends one.
 */
async function stubWorker(page: Page, opts: StubOpts = {}): Promise<Calls> {
  const calls: Calls = { search: 0, oembed: 0, bodies: [] };
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
    return json({ error: "not_found" }, 404);
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

  const ytRequests: URL[] = [];
  await page.route("https://www.googleapis.com/**", (route) => {
    ytRequests.push(new URL(route.request().url()));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: { videoId: "apiVid1" },
            snippet: {
              title: "From the YouTube API",
              channelTitle: "API Channel",
              thumbnails: { medium: { url: `${WORKER}/thumb/api.png` } },
            },
          },
        ],
      }),
    });
  });

  await page.goto("/discover/");
  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("research-search").click();

  // All: the Worker is asked for TikTok and Instagram (one request each); YouTube comes from the API.
  await expect(card(page, "yt")).toContainText("From the YouTube API");
  await expect(card(page, "tt").first()).toBeVisible();
  await expect(card(page, "ig")).toBeVisible();
  expect(calls.bodies.map((b) => b.platforms).sort()).toEqual([["ig"], ["tt"]]);
  expect(ytRequests).toHaveLength(1);
  await expect(card(page, "yt")).not.toContainText("Match cuts explained");

  // YouTube tab: API only (cached), no Worker call.
  await page.getByTestId("tab-yt").click();
  await expect(card(page, "yt")).toContainText("From the YouTube API");
  await expect(card(page, "tt")).toHaveCount(0);
  expect(calls.bodies).toHaveLength(2);
  expect(ytRequests).toHaveLength(1);

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
