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

// Worker results; the stub answers each request with only the platforms it asked for.
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

/** Stub the whole fake Worker. Returns live call counters and the /search request bodies. */
async function stubWorker(page: Page): Promise<Calls> {
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
      const results = RESULTS.filter((r) => body.platforms.includes(r.platform));
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

  // "All" without a YouTube key: one Worker call for all three platforms, thumbnails on.
  const tt = card(page, "tt").filter({ hasText: "Match cut in 10 seconds" });
  await expect(tt).toBeVisible();
  await expect(tt).toContainText("@editor.sam");
  await expect(card(page, "ig")).toContainText("@cutsbyfaisal");
  await expect(card(page, "yt")).toContainText("Match cuts explained");
  expect(calls.bodies).toEqual([
    { q: "match cut", platforms: ["tt", "ig", "yt"], lang: "ar", max: 15, thumbs: true },
  ]);
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "1");

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

  // The TikTok tab asks the Worker for TikTok only, and shows only TikTok.
  await page.getByTestId("tab-tt").click();
  await expect(page.getByTestId("tab-tt")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => calls.bodies.length).toBe(2);
  expect(calls.bodies[1].platforms).toEqual(["tt"]);
  expect(calls.bodies[1].max).toBe(10);
  await expect(tt).toBeVisible();
  await expect(card(page, "ig")).toHaveCount(0);
  await expect(card(page, "yt")).toHaveCount(0);
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "2");

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
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "2");
  expect(calls.search).toBe(2);

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
  expect(calls.search).toBe(2);

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

  // All: the Worker is asked for TikTok + Instagram only; YouTube comes from the API.
  await expect(card(page, "yt")).toContainText("From the YouTube API");
  await expect(card(page, "tt").first()).toBeVisible();
  expect(calls.bodies.map((b) => b.platforms)).toEqual([["tt", "ig"]]);
  expect(ytRequests).toHaveLength(1);
  await expect(card(page, "yt")).not.toContainText("Match cuts explained");

  // YouTube tab: API only (cached), no Worker call.
  await page.getByTestId("tab-yt").click();
  await expect(card(page, "yt")).toContainText("From the YouTube API");
  await expect(card(page, "tt")).toHaveCount(0);
  expect(calls.bodies).toHaveLength(1);
  expect(ytRequests).toHaveLength(1);

  // Instagram tab: the Worker for Instagram only.
  await page.getByTestId("tab-ig").click();
  await expect(card(page, "ig")).toContainText("@cutsbyfaisal");
  await expect.poll(() => calls.bodies.length).toBe(2);
  expect(calls.bodies[1].platforms).toEqual(["ig"]);

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
