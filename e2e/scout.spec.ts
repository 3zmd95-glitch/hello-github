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
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface Calls {
  search: number;
  oembed: number;
}

/** Stub the whole fake Worker. Returns live call counters. */
async function stubWorker(page: Page): Promise<Calls> {
  const calls: Calls = { search: 0, oembed: 0 };
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
      return json({ results: RESULTS, credits: { used: 1 } });
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

test("without the Worker, Discover shows a one-line hint linking to Settings", async ({ page }) => {
  await freshState(page, "/discover/");
  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("discover-topic").press("Enter");
  const hint = page.getByTestId("scout-not-configured");
  await expect(hint).toBeVisible();
  await expect(hint.locator('a[href="/settings/"]')).toHaveCount(1);
});

test("Discover shows TikTok and Instagram from the Worker, attaches one, counts usage, and caches the topic", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);

  await page.goto("/discover/");
  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("discover-topic").press("Enter");

  const tt = page.locator('[data-testid="scout-result"][data-platform="tt"]');
  const ig = page.locator('[data-testid="scout-result"][data-platform="ig"]');
  await expect(tt).toBeVisible();
  await expect(tt).toContainText("Match cut in 10 seconds");
  await expect(tt).toContainText("@editor.sam");
  await expect(ig).toBeVisible();
  await expect(ig).toContainText("@cutsbyfaisal");
  await expect(tt.getByTestId("scout-open")).toHaveAttribute("target", "_blank");
  // No YouTube key: the Worker's YouTube hit is the fallback YouTube list (same request, no extra credit).
  await expect(page.getByTestId("yt-result")).toContainText("Match cuts explained");
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "1");
  expect(calls.search).toBe(1);

  // Attach the TikTok result to a skill through the picker.
  await tt.getByTestId("scout-attach").click();
  await page.getByTestId("skill-picker-search").fill("Smart Bins");
  await page.getByTestId("skill-picker-option").first().click();
  await expect(tt.getByTestId("scout-attach")).toBeDisabled();

  // Same topic again after a reload (memory cache gone): served from localStorage, no new call.
  await page.reload();
  await page.getByTestId("discover-recent-topic").filter({ hasText: "match cut" }).click();
  await expect(page.locator('[data-testid="scout-result"][data-platform="tt"]')).toBeVisible();
  await expect(page.getByTestId("scout-usage")).toHaveAttribute("data-count", "1");
  expect(calls.search).toBe(1);

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

test("skill sheet: Worker results add as references, and a pasted TikTok link is enriched via oEmbed", async ({
  page,
}) => {
  const calls = await stubWorker(page);
  await connectWorker(page);

  await page.goto("/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();

  const ig = page.locator('[data-testid="scout-result"][data-platform="ig"]');
  await expect(ig).toBeVisible();
  await ig.getByTestId("scout-add-ref").click();
  await expect(page.getByTestId("saved-ref").filter({ hasText: "Match cut reel" })).toBeVisible();
  await expect(ig.getByTestId("scout-add-ref")).toBeDisabled();

  // Paste a TikTok link with no title: title, handle and thumbnail come from the Worker's oEmbed.
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
