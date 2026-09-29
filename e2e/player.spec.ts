import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// ▶ Watch here (round 32): the player sheet in a browser, from Discover's cards and from a saved reference in
// the skill sheet. The Scout Worker is a fake at https://scout.test (like e2e/scout.spec.ts); the three
// players and the two pre-check endpoints are tiny stub pages / replies that post what the real ones post.
// Every other request to a YouTube, TikTok, Instagram or Facebook host is aborted and recorded, and each test
// ends by asserting there was none: no test ever reaches a real platform. Every Content-Security-Policy
// violation (app/layout.tsx's meta lets only the three players frame) is recorded the same way and must stay
// empty.

const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";
const SKILL_ID = "smart-bins-keywords";

// A tiny 1x1 PNG served for every thumbnail so nothing leaves the machine.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const YT = "https://www.youtube.com/watch?v=abc123XYZ";
const YT_SHORT = "https://www.youtube.com/shorts/short000001";
const YT_OFF = "https://www.youtube.com/watch?v=noEmbed0001";
const TT = "https://www.tiktok.com/@editor.sam/video/7300000000000000001";
const TT_GONE_ID = "7300000000000000009";
const TT_GONE = `https://www.tiktok.com/@gone.user/video/${TT_GONE_ID}`;
const IG = "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF";

const RESULTS = [
  {
    platform: "yt",
    handle: "Cuts Channel",
    title: "Match cuts explained",
    snippet: "",
    url: YT,
    thumb: `${WORKER}/thumb/yt1.png`,
  },
  {
    platform: "yt",
    handle: "Shorts Lab",
    title: "Match cut in a Short",
    snippet: "",
    url: YT_SHORT,
    thumb: `${WORKER}/thumb/yt2.png`,
  },
  {
    platform: "yt",
    handle: "Label Records",
    title: "Embedding turned off",
    snippet: "",
    url: YT_OFF,
    thumb: `${WORKER}/thumb/yt3.png`,
  },
  {
    platform: "tt",
    handle: "@editor.sam",
    title: "Match cut in 10 seconds",
    snippet: "",
    url: TT,
    thumb: `${WORKER}/thumb/tt1.png`,
  },
  {
    platform: "tt",
    handle: "@gone.user",
    title: "A TikTok that was removed",
    snippet: "",
    url: TT_GONE,
  },
  {
    platform: "ig",
    handle: "@cutsbyfaisal",
    title: "Match cut reel",
    snippet: "Door to door match cut, shot on a phone.",
    url: IG,
  },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

/** Every host a platform's player or pre-check could reach (their CDNs and analytics included). */
const PLATFORM_HOST =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|ggpht\.com|tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|ttwstatic\.com|byteoversea\.com|ibytedtos\.com|instagram\.com|cdninstagram\.com|facebook\.com|facebook\.net|fbcdn\.net|fbsbx\.com)$/;

/** YouTube's player: no script API is used, so the stub only has to load. */
const YT_PAGE = `<!doctype html><html><body style="margin:0;background:#000;color:#fff"><p id="stub">YouTube stub</p></body></html>`;

/**
 * TikTok's player v1: some non-player noise, then ready / muted / playing / paused / playing again, or the
 * INVALID_VIDEO error for the removed video. It logs the commands it receives (the sheet's unMute).
 */
const TT_PAGE = `<!doctype html><html><body style="margin:0;background:#000;color:#fff"><p id="log">-</p><script>
var log = [];
addEventListener("message", function (e) {
  if (e.data && e.data["x-tiktok-player"] === true) {
    log.push(e.data.type);
    document.getElementById("log").textContent = log.join(",");
  }
});
function send(m) { m["x-tiktok-player"] = true; parent.postMessage(m, "*"); }
var id = location.pathname.split("/").pop();
setTimeout(function () {
  parent.postMessage("[tea-sdk]ready", "*");
  parent.postMessage({ signalSource: "tea", width: 1, height: 1 }, "*");
  if (id === "${TT_GONE_ID}") {
    send({ type: "onPlayerError", value: { errorCode: 1001, errorType: "INVALID_VIDEO" } });
    return;
  }
  send({ type: "onPlayerReady" });
  send({ type: "onMute", value: true });
  send({ type: "onStateChange", value: 1 });
  send({ type: "onStateChange", value: 2 });
  send({ type: "onStateChange", value: 1 });
}, 100);
</script></body></html>`;

/** Instagram's bare embed page: LOADING, MEASURE 0, MOUNTED, then the real height, as JSON strings. */
const IG_PAGE = `<!doctype html><html><body style="margin:0;background:#fff"><p id="stub">Instagram stub</p><script>
function send(m) { parent.postMessage(JSON.stringify(m), "*"); }
send({ type: "LOADING", details: {} });
send({ type: "MEASURE", details: { height: 0 } });
setTimeout(function () {
  send({ type: "MOUNTED", details: { styles: [["border", "1px solid #dbdbdb"]] } });
  send({ type: "MEASURE", details: { height: 700 } });
}, 100);
</script></body></html>`;

interface PlatformCalls {
  /** Player pages loaded into a frame. */
  frames: string[];
  /** Pre-checks asked (the video address each one was about). */
  checks: string[];
  /** Requests to a platform host that no stub answers: aborted. Must stay empty. */
  leaked: string[];
  /** `securitypolicyviolation` events on any page of the test ("<directive> <blocked URL>"). Must stay empty. */
  csp: string[];
}

/**
 * Stub the three players and the two pre-checks on the page, behind a catch-all on the browser context that
 * aborts and records anything else going to a platform host (page routes win over context routes, and the
 * context one also covers a tab the page might open). CSP violations are reported through a binding, so the
 * record survives the tests' navigations.
 */
async function stubPlatforms(page: Page): Promise<PlatformCalls> {
  const calls: PlatformCalls = { frames: [], checks: [], leaked: [], csp: [] };
  await page.exposeFunction("__e2eCspViolation", (v: string) => {
    calls.csp.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener(
      "securitypolicyviolation",
      (e) => {
        const report = (window as unknown as { __e2eCspViolation(v: string): Promise<void> })
          .__e2eCspViolation;
        void report(`${e.effectiveDirective} ${e.blockedURI}`);
      },
      true,
    );
  });
  await page.context().route(
    (url) => PLATFORM_HOST.test(url.hostname),
    (route) => {
      calls.leaked.push(route.request().url());
      return route.abort();
    },
  );
  const html = (body: string) => ({ status: 200, contentType: "text/html", body });
  await page.route(
    (url) => url.hostname === "www.youtube-nocookie.com" && url.pathname.startsWith("/embed/"),
    (route) => {
      calls.frames.push(route.request().url());
      return route.fulfill(html(YT_PAGE));
    },
  );
  await page.route(
    (url) => url.hostname === "www.tiktok.com" && url.pathname.startsWith("/player/v1/"),
    (route) => {
      calls.frames.push(route.request().url());
      return route.fulfill(html(TT_PAGE));
    },
  );
  await page.route(
    (url) => url.hostname === "www.instagram.com" && /^\/p\/[\w-]+\/embed\/$/.test(url.pathname),
    (route) => {
      calls.frames.push(route.request().url());
      return route.fulfill(html(IG_PAGE));
    },
  );
  // YouTube's oEmbed: 401 when the owner turned embedding off, 113x200 for a Short, else 16:9.
  await page.route(
    (url) => url.hostname === "www.youtube.com" && url.pathname === "/oembed",
    (route) => {
      const video = new URL(route.request().url()).searchParams.get("url") ?? "";
      calls.checks.push(video);
      const headers = { "Access-Control-Allow-Origin": "*" };
      if (video.endsWith("/noEmbed0001")) {
        return route.fulfill({ status: 401, headers, body: "Unauthorized" });
      }
      const [width, height] = video.endsWith("/short000001") ? [113, 200] : [200, 113];
      return route.fulfill({
        status: 200,
        headers,
        contentType: "application/json",
        body: JSON.stringify({ type: "video", width, height }),
      });
    },
  );
  // Instagram's tokenless oEmbed: every post here embeds.
  await page.route(
    (url) => url.hostname === "graph.facebook.com" && url.pathname.endsWith("/instagram_oembed"),
    (route) => {
      calls.checks.push(new URL(route.request().url()).searchParams.get("url") ?? "");
      return route.fulfill({
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({ version: "1.0", type: "rich", html: "<blockquote></blockquote>" }),
      });
    },
  );
  return calls;
}

/** The fake Worker: /health, /search (one platform per request, like the app sends) and thumbnails. */
async function stubWorker(page: Page): Promise<{ search: number }> {
  const calls = { search: 0 };
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
      const body = JSON.parse(req.postData() ?? "{}") as { platforms: string[]; max?: number };
      const results = RESULTS.filter((r) => body.platforms.includes(r.platform));
      return json({ results: results.slice(0, body.max ?? 10), credits: { used: 1 } });
    }
    return json({ error: "not_found" }, 404);
  });
  return calls;
}

/** Fill the two Scout rows in Settings and press Test (expects "Tested OK"). */
async function connectWorker(page: Page): Promise<void> {
  await freshState(page, "/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await expect(page.getByTestId("apikey-scoutUrl-status")).toHaveText("محفوظ"); // "Set"
  await page.getByTestId("apikey-scoutToken-input").fill(TOKEN);
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓"); // "Tested OK"
}

/** Discover, searched for "match cut": every card of the fake Worker is on the page. */
async function openDiscover(page: Page): Promise<void> {
  await page.goto("/discover/");
  await page.getByTestId("discover-topic").fill("match cut");
  await page.getByTestId("discover-topic").press("Enter");
  for (const r of RESULTS) await expect(card(page, r.title)).toBeVisible();
}

const card = (page: Page, title: string) =>
  page.locator('[data-testid="result-card"]').filter({ hasText: title });

const sheet = (page: Page) => page.getByTestId("player-sheet");
const frame = (page: Page) => page.getByTestId("player-frame");
const inFrame = (page: Page) => page.frameLocator('[data-testid="player-frame"]');

/** The page never scrolls sideways (the sheet fits the phone). */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

/** Nothing of ours covers the video: the middle of the frame is the frame itself. */
async function expectFrameUncovered(frameEl: Locator): Promise<void> {
  expect(
    await frameEl.evaluate((f) => {
      const r = f.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === f;
    }),
  ).toBe(true);
}

const historyMark = (page: Page) =>
  page.evaluate(() => (history.state as Record<string, unknown> | null)?.["3z-player"] ?? null);

test("▶ plays YouTube, TikTok and Instagram cards in the sheet: frames, notes, open link, closing", async ({
  page,
}) => {
  const platforms = await stubPlatforms(page);
  await stubWorker(page);
  await connectWorker(page);
  await openDiscover(page);
  // Nothing loads from a platform before ▶.
  expect(platforms.frames).toEqual([]);
  expect(platforms.checks).toEqual([]);
  await expect(page.locator("iframe")).toHaveCount(0);

  // YouTube: the pre-check, then the privacy-enhanced player in a 16:9 box, closed by ✕.
  const ytPlay = card(page, "Match cuts explained").getByTestId("result-play");
  await ytPlay.click();
  await expect(sheet(page)).toHaveAttribute("data-platform", "yt");
  await expect(frame(page)).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&playsinline=1&rel=0&hl=ar",
  );
  await expect(frame(page)).toHaveAttribute("sandbox", SANDBOX);
  await expect(frame(page)).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  await expect(frame(page)).toHaveAttribute("title", "يوتيوب · Match cuts explained");
  await expect(inFrame(page).locator("#stub")).toHaveText("YouTube stub");
  expect(platforms.checks).toEqual(["https://www.youtube.com/shorts/abc123XYZ"]);
  await expect(page.getByTestId("player-box")).toHaveAttribute("data-shape", "wide");
  const ytBox = await frame(page).boundingBox();
  expect(ytBox!.width).toBeGreaterThanOrEqual(200);
  expect(ytBox!.height).toBeGreaterThanOrEqual(200);
  await expectFrameUncovered(frame(page));
  const open = page.getByTestId("player-open");
  await expect(open).toHaveAttribute("href", YT);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");
  await expect(open).toBeVisible();
  await expect(page.getByTestId("player-privacy")).toContainText("يوتيوب");
  await expect(page.getByTestId("player-note")).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await page.getByTestId("player-close").click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(ytPlay).toBeFocused();

  // A YouTube Short: the pre-check says it is vertical, so a 9:16 box. Closed by Escape.
  await card(page, "Match cut in a Short").getByTestId("result-play").click();
  await expect(frame(page)).toHaveAttribute("src", /\/embed\/short000001\?/);
  await expect(page.getByTestId("player-box")).toHaveAttribute("data-shape", "tall");
  await expectNoSidewaysScroll(page);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);

  // TikTok: no pre-check, the player at once, the cookie hint, and the sound turned on once it plays.
  await card(page, "Match cut in 10 seconds").getByTestId("result-play").click();
  await expect(sheet(page)).toHaveAttribute("data-platform", "tt");
  await expect(frame(page)).toHaveAttribute(
    "src",
    "https://www.tiktok.com/player/v1/7300000000000000001?autoplay=1&rel=0&description=1&music_info=1",
  );
  await expect(frame(page)).toHaveAttribute("sandbox", SANDBOX);
  await expect(page.getByTestId("player-note")).toHaveText(
    "لو طلع لك طلب الكوكيز من تيك توك، جاوبه وبعدها يشتغل الفيديو.",
  );
  await expect(page.getByTestId("player-open")).toHaveAttribute("href", TT);
  // Playing, paused, playing again: exactly one unMute reached the player.
  await expect(inFrame(page).locator("#log")).toHaveText("unMute");
  expect(platforms.checks).toHaveLength(2);
  await expectFrameUncovered(frame(page));
  await expectNoSidewaysScroll(page);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);

  // Instagram: the tokenless pre-check, the bare embed page, its height from MEASURE. Closed on the backdrop.
  await card(page, "Match cut reel").getByTestId("result-play").click();
  await expect(sheet(page)).toHaveAttribute("data-platform", "ig");
  await expect(frame(page)).toHaveAttribute("src", "https://www.instagram.com/p/C1abcDEF/embed/");
  await expect(frame(page)).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  await expect(frame(page)).toHaveCSS("height", "700px");
  // A 700 px post makes the sheet scroll. Tab past its last control wraps to ✕ at the top and Shift+Tab
  // back to the link at the bottom: each one is scrolled into view inside the sheet.
  await page.getByTestId("player-open").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("player-close")).toBeFocused();
  await expect(page.getByTestId("player-close")).toBeInViewport();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("player-open")).toBeFocused();
  await expect(page.getByTestId("player-open")).toBeInViewport();
  await expect(page.getByTestId("player-note")).toHaveText(
    "انستقرام يبغى ضغطة ثانية على زر التشغيل داخل الإطار.",
  );
  await expect(page.getByTestId("player-open")).toHaveAttribute("href", IG);
  expect(platforms.checks[2]).toBe("https://www.instagram.com/p/C1abcDEF");
  // The same message from the page itself (not the player's frame) changes nothing.
  await page.evaluate(() =>
    window.postMessage(JSON.stringify({ type: "MEASURE", details: { height: 1500 } }), "*"),
  );
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  await expect(frame(page)).toHaveCSS("height", "700px");
  await expectNoSidewaysScroll(page);
  await page.getByTestId("player-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(sheet(page)).toHaveCount(0);

  expect(platforms.frames).toHaveLength(4);
  expect(platforms.leaked).toEqual([]);
  expect(platforms.csp).toEqual([]);
});

test("Back closes only the player: /discover/ and its results stay, forward does not reopen it", async ({
  page,
}) => {
  const platforms = await stubPlatforms(page);
  const worker = await stubWorker(page);
  await connectWorker(page);
  await openDiscover(page);
  const searches = worker.search;
  const url = page.url();
  const entries = await page.evaluate(() => history.length);

  // Closing by ✕ goes back by itself: no stale entry is left for the next Back.
  await card(page, "Match cut reel").getByTestId("result-play").click();
  await expect(frame(page)).toBeVisible();
  expect(await historyMark(page)).not.toBeNull();
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  await page.getByTestId("player-close").click();
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => historyMark(page)).toBeNull();
  expect(page.url()).toBe(url);
  await expect(card(page, "Match cut reel")).toBeVisible();

  // The phone's back gesture: the sheet closes, the page does not move, reload or search again.
  await card(page, "Match cut in 10 seconds").getByTestId("result-play").click();
  await expect(frame(page)).toBeVisible();
  // Where the page is while the sheet is open (the ▶ click itself scrolled its card into view).
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(await historyMark(page)).not.toBeNull();
  await page.evaluate(() => history.back());
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(await historyMark(page)).toBeNull();
  expect(page.url()).toBe(url);
  expect(page.url()).toMatch(/\/discover\/$/);
  for (const r of RESULTS) await expect(card(page, r.title)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(worker.search).toBe(searches);

  // Forward onto the old entry: still closed, still Discover.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        addEventListener("popstate", () => resolve(), { once: true });
        history.forward();
      }),
  );
  await expect(sheet(page)).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(card(page, "Match cut reel")).toBeVisible();

  expect(platforms.leaked).toEqual([]);
  expect(platforms.csp).toEqual([]);
});

test("a video that cannot play shows why and the open link, and no frame", async ({ page }) => {
  const platforms = await stubPlatforms(page);
  await stubWorker(page);
  await connectWorker(page);
  await openDiscover(page);

  // YouTube's oEmbed says embedding is off: no frame is ever mounted.
  await card(page, "Embedding turned off").getByTestId("result-play").click();
  const error = page.getByTestId("player-error");
  await expect(error).toHaveAttribute("data-reason", "cantPlay");
  await expect(error).toHaveText("هالفيديو ما ينفع يشتغل هنا. افتحه في يوتيوب.");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByTestId("player-open")).toHaveAttribute("href", YT_OFF);
  await expect(page.getByTestId("player-open")).toBeVisible();
  expect(platforms.frames).toEqual([]);
  await page.getByTestId("player-close").click();
  await expect(sheet(page)).toHaveCount(0);

  // TikTok's player reports the video as removed: the reason replaces its frame.
  await card(page, "A TikTok that was removed").getByTestId("result-play").click();
  await expect(error).toHaveAttribute("data-reason", "gone");
  await expect(error).toHaveText("الفيديو انحذف أو صار خاص.");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByTestId("player-open")).toHaveAttribute("href", TT_GONE);
  expect(platforms.frames).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);

  expect(platforms.leaked).toEqual([]);
  expect(platforms.csp).toEqual([]);
});

test("a saved reference plays on top of the skill sheet, and Escape closes only the player", async ({
  page,
}) => {
  const platforms = await stubPlatforms(page);
  await stubWorker(page);
  await connectWorker(page);
  await openDiscover(page);

  // Save the Instagram reel on a skill.
  const reel = card(page, "Match cut reel");
  await reel.getByTestId("result-attach").click();
  await page.getByTestId("skill-picker-search").fill("Smart Bins");
  await page.getByTestId("skill-picker-option").first().click();
  await expect(reel.getByTestId("result-attached")).toContainText("Smart Bins");

  await page.goto("/skills/");
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`).click();
  const skillSheet = page.getByTestId("skill-sheet");
  await expect(skillSheet).toBeVisible();

  // The row keeps its plain thumbnail (YouTube wants 120x70 for a thumbnail that plays; this one is 48 px
  // tall) and gets a small ▶ of its own before the ✕.
  const row = page.getByTestId("saved-ref").filter({ hasText: "Match cut reel" });
  const play = row.getByTestId("result-play");
  await expect(play).toHaveText("▶");
  await expect(play).toHaveAccessibleName("شاهد «Match cut reel» هنا");
  expect(
    await play.evaluate(
      (b) => b.nextElementSibling?.getAttribute("data-testid") === "saved-ref-remove",
    ),
  ).toBe(true);
  // At the narrowest phone (320 px): the ▶ and the ✕ fit in the row beside the title, nothing overflows,
  // and the buttons never make the row taller than its thumbnail or its two lines of text.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 640 });
  const fit = await row.evaluate((li) => {
    const box = li.getBoundingClientRect();
    const [thumb, text] = [...li.children].map((c) => c.getBoundingClientRect());
    const buttons = [...li.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    const pad =
      parseFloat(getComputedStyle(li).paddingTop) + parseFloat(getComputedStyle(li).paddingBottom);
    return {
      overflow: li.scrollWidth - li.clientWidth,
      buttons: buttons.length,
      inside: buttons.every((b) => b.left >= box.left && b.right <= box.right),
      shorterThanThumb: buttons.every((b) => b.height <= thumb.height),
      extraHeight: box.height - (Math.max(thumb.height, text.height) + pad),
      titleWidth: text.width,
    };
  });
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.buttons).toBe(2);
  expect(fit.inside).toBe(true);
  expect(fit.shorterThanThumb).toBe(true);
  expect(Math.abs(fit.extraHeight)).toBeLessThan(1);
  expect(fit.titleWidth).toBeGreaterThan(0);
  await expectNoSidewaysScroll(page);
  await page.setViewportSize(viewport);

  await play.click();
  await expect(sheet(page)).toHaveAttribute("data-platform", "ig");
  await expect(frame(page)).toHaveAttribute("src", "https://www.instagram.com/p/C1abcDEF/embed/");
  await expect(skillSheet).toBeVisible();
  // The player is the top layer: its ✕ is not covered by the skill sheet.
  expect(
    await page.getByTestId("player-close").evaluate((b) => {
      const r = b.getBoundingClientRect();
      return (
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button") === b
      );
    }),
  ).toBe(true);
  await expectNoSidewaysScroll(page);

  // One Escape closes the player only; focus is back on the reference's own ▶ button in the skill sheet.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(skillSheet).toBeVisible();
  await expect(play).toBeFocused();

  // The next Escape is the skill sheet's own.
  await page.keyboard.press("Escape");
  await expect(skillSheet).toHaveCount(0);

  expect(platforms.leaked).toEqual([]);
  expect(platforms.csp).toEqual([]);
});

test("the page's CSP lets only the three players be framed: anything else is refused and reported", async ({
  page,
}) => {
  const platforms = await stubPlatforms(page);
  // The meta from app/layout.tsx is in the served page's <head>. Next hoists its own charset / viewport
  // metas, stylesheets and async chunk scripts above it: nothing there is a frame, an object or a <base>,
  // the only things this policy governs.
  const html = await (await page.request.get("/discover/")).text();
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).toContain(
    `<meta http-equiv="Content-Security-Policy" content="frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.tiktok.com https://www.instagram.com; object-src &#x27;none&#x27;; base-uri &#x27;self&#x27;"/>`,
  );
  expect(head).not.toMatch(/<(iframe|object|embed|base)\b/i);
  await page.goto("/discover/");
  await expect(page.locator('head > meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    "content",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.tiktok.com https://www.instagram.com; object-src 'none'; base-uri 'self'",
  );
  expect(platforms.csp).toEqual([]);

  // A frame from anywhere else is refused before any request, and the listener the other tests rely on
  // hears about it (so their empty list means something). The browser reports a cross-origin blocked
  // address by its origin only.
  await page.evaluate(() => {
    const f = document.createElement("iframe");
    f.src = "https://scout.test/not-a-player";
    document.body.append(f);
  });
  await expect.poll(() => platforms.csp).toEqual(["frame-src https://scout.test"]);
  expect(platforms.leaked).toEqual([]);
});
