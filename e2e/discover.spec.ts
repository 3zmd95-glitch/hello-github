import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

const WORKER = "https://3z-scout.example.workers.dev";
const TOKEN = "test-token";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

// The YouTube pick's picture (the Worker sets i.ytimg.com ones), served as a 1x1 PNG so nothing leaves the machine.
const PICK_THUMB = "https://i.ytimg.com/vi/fl4shPick01/hqdefault.jpg";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// The page does not scroll sideways: measured against the page's own width, not `innerWidth`, which on the
// phone (mobile emulation) grows to fit whatever overflows.
const fitsViewport = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const item = (n: number, over: Record<string, unknown>) => ({
  platform: "tt",
  handle: "@ed",
  title: `flash transition edit ${n}`,
  snippet: "",
  url: `https://www.tiktok.com/@ed/video/${n}`,
  thumb: "https://example.com/t.jpg",
  lang: "en",
  section: "example",
  ...over,
});

const ANSWER = {
  topicKey: "flash-transition",
  understood: {
    termId: "flash-transition",
    label: { ar: "انتقال فلاش", en: "flash transition" },
    exact: false,
  },
  alternatives: [
    { termId: "camera-flash", label: { ar: "تصوير بالفلاش", en: "camera flash photography" } },
    { exact: true },
  ],
  items: [
    ...Array.from({ length: 8 }, (_, i) => item(i + 1, {})),
    item(20, {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=abc",
      handle: "Cinecom",
      section: "tutorial",
      stats: { views: 90000 },
    }),
    item(21, { section: "tutorial", lang: "ar", title: "شرح تأثير فلاش" }),
    item(22, {
      platform: "ig",
      url: "https://www.instagram.com/p/OFF/",
      handle: "",
      title: "The Flash",
      offTopic: true,
    }),
  ],
  creators: [{ platform: "tt", handle: "@ed", url: "https://www.tiktok.com/@ed", count: 9 }],
  platforms: { tt: { ok: true }, ig: { ok: false, error: "upstream" }, yt: { ok: true } },
  cost: { tavily: 6, youtubeSearch: 3 },
  cached: false,
  // Instagram failed: not complete, so the browser keeps nothing and every search asks the Worker.
  complete: false,
};

async function stubWorker(page: Page, discover: (body: Record<string, unknown>) => unknown) {
  const asked: Record<string, unknown>[] = [];
  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const authed = req.headers()["authorization"] === `Bearer ${TOKEN}`;
    if (url.pathname === "/health")
      return reply(authed ? { ok: true, auth: true, tavily: true, discover: true } : { ok: true });
    if (!authed) return reply({ error: "unauthorized" }, 401);
    if (url.pathname === "/discover" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      asked.push(body);
      return reply(discover(body));
    }
    if (url.pathname === "/discover/usage") {
      return reply({
        tavily: { used: 412, limit: 1000 },
        youtube: { usedToday: 9, cap: 70 },
        connector: { usedToday: 0, cap: 60 },
      });
    }
    if (url.pathname === "/discover/picks") {
      return reply({
        picks: [
          {
            topicKey: "flash-transition",
            topic: "flash",
            savedAt: "2026-10-03T09:00:00Z",
            items: [
              {
                url: "https://www.tiktok.com/@ed/video/99",
                platform: "tt",
                title: "the cleanest flash",
                label: "example",
                note: "watch 0:03",
                savedAt: "x",
              },
              {
                url: "https://www.youtube.com/watch?v=fl4shPick01",
                platform: "yt",
                title: "flash transition in DaVinci",
                thumb: PICK_THUMB,
                label: "tutorial",
                savedAt: "x",
              },
            ],
          },
        ],
      });
    }
    return reply({ error: "not_found" }, 404);
  });
  await page.route(/^https?:\/\/([\w-]+\.)*(tiktok|instagram|youtube|ytimg|example)\.com\//, (r) =>
    r.abort(),
  );
  return asked;
}

async function connectWorker(page: Page) {
  await freshState(page, "/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await expect(page.getByTestId("apikey-scoutUrl-status")).toHaveText("محفوظ"); // "Set"
  await page.getByTestId("apikey-scoutToken-input").fill(TOKEN);
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓");
}

async function search(page: Page, q: string) {
  await page.goto("/discover/");
  await page.getByTestId("discover-topic").fill(q);
  await page.getByTestId("discover-topic").press("Enter");
}

// The DaVinci skill of e2e/research.spec.ts: "Smart Bins + Keywords" / "الـ Smart Bins والكلمات المفتاحية".
const SKILL_ID = "smart-bins-keywords";

async function openSkillSheet(page: Page): Promise<void> {
  await page
    .getByTestId("pillar-editing")
    .locator('[data-testid="program-card"][data-program="davinci"]')
    .click();
  await page.locator(`[data-testid="skill-row"][data-skill="${SKILL_ID}"]`).click();
  await expect(page.getByTestId("skill-sheet")).toBeVisible();
}

test("Discover v2: one search, sections, Not this?, tabs, hidden posts, a failed platform", async ({
  page,
}) => {
  const asked = await stubWorker(page, () => ANSWER);
  await connectWorker(page);
  await search(page, "flash");

  await expect(page.getByTestId("discover-sections")).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ q: "flash" });
  await expect(page.getByTestId("discover-understood")).toContainText("انتقال فلاش");
  await expect(page.getByTestId("discover-popular")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("discover-section-example")).toHaveAttribute("data-count", "8");
  await expect(page.getByTestId("discover-section-tutorial")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("discover-creator")).toHaveCount(1);
  await expect(page.getByTestId("tab-all")).toHaveAttribute("data-count", "10");
  await expect(page.getByTestId("discover-usage")).toContainText("412");

  // Show more opens the rest of a section.
  const examples = page.getByTestId("discover-section-example");
  await expect(examples.getByTestId("result-card")).toHaveCount(6);
  await page.getByTestId("discover-more-example").click();
  await expect(examples.getByTestId("result-card")).toHaveCount(8);

  // The off-topic post is behind its count.
  await expect(page.getByTestId("discover-hidden")).toHaveAttribute("data-count", "1");
  await page.getByTestId("discover-hidden-toggle").click();
  await expect(page.getByTestId("discover-offtopic-chip")).toHaveCount(1);

  // A failed platform says so (the credits banner is for quota only), and its Retry sends the same
  // request again.
  await expect(page.getByTestId("discover-down-ig")).toBeVisible();
  await expect(page.getByTestId("discover-credits-out")).toHaveCount(0);
  await page.getByTestId("discover-retry-ig").click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toEqual(asked[0]);
  await expect(page.getByTestId("discover-sections")).toBeVisible();

  // The TikTok tab filters every section.
  await page.getByTestId("tab-tt").click();
  await expect(page.getByTestId("discover-popular")).toHaveCount(0);
  await expect(page.getByTestId("discover-section-tutorial")).toHaveAttribute("data-count", "1");

  // Not this? asks again with the other meaning, then exactly.
  await page.getByTestId("discover-alt-camera-flash").click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ q: "flash", term: "camera-flash" });
  await page.getByTestId("discover-alt-exact").click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ q: "flash", exact: true });
});

test("Discover v2: Tavily's limit shows the pay-as-you-go banner", async ({ page }) => {
  await stubWorker(page, () => ({
    ...ANSWER,
    platforms: {
      tt: { ok: false, error: "quota" },
      ig: { ok: false, error: "quota" },
      yt: { ok: true },
    },
  }));
  await connectWorker(page);
  await search(page, "flash");
  await expect(page.getByTestId("discover-credits-out")).toBeVisible();
});

test("Discover v2 in a skill's Research panel: one search, and a card attaches to the skill", async ({
  page,
}) => {
  const asked = await stubWorker(page, () => ANSWER);
  await connectWorker(page);
  await page.goto("/skills/");
  await openSkillSheet(page);
  await page.getByTestId("research-toggle").click();

  // The panel searches the skill's name (with its program) in one POST /discover.
  const result = page
    .getByTestId("discover-section-tutorial")
    .locator('[data-testid="result-card"][data-platform="yt"]');
  await expect(result).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({
    q: expect.stringContaining("Smart Bins"),
    program: "DaVinci Resolve",
  });

  // Attach toggles the reference, as on the old path (e2e/research.spec.ts).
  const saved = page.getByTestId("saved-ref").filter({ hasText: "flash transition edit 20" });
  await result.getByTestId("result-attach").click();
  await expect(saved).toBeVisible();
  await expect(result.getByTestId("result-attach")).toHaveAttribute("aria-pressed", "true");
  await result.getByTestId("result-attach").click();
  await expect(result.getByTestId("result-attach")).toHaveAttribute("aria-pressed", "false");
  await expect(saved).toHaveCount(0);
});

test("Discover v2: Claude's picks show on the topic and on an empty Discover", async ({ page }) => {
  // "Not this?" answers another meaning: another topic, without picks of its own.
  await stubWorker(page, (body) => (body.term ? { ...ANSWER, topicKey: body.term } : ANSWER));
  // Registered last, so it answers before the stub's block of the platforms' hosts.
  await page.route("https://i.ytimg.com/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  const picksAsked: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && r.url().startsWith(`${WORKER}/discover/picks`))
      picksAsked.push(r.url());
  });
  await connectWorker(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover/");

  // Nothing typed: the newest topics' picks, each saying its topic, asked once on opening.
  const latest = page.getByTestId("discover-picks-latest");
  await expect(latest).toBeVisible();
  await expect(latest.getByTestId("discover-picks")).toHaveAttribute(
    "data-topic",
    "flash-transition",
  );
  // The topic line is part of the section's name (the empty Discover can list three topics).
  await expect(
    latest.getByRole("region", { name: "⭐ اختيارات Claude عن «flash»", exact: true }),
  ).toBeVisible();
  // The YouTube pick shows its picture; the row scrolls sideways, the 375 px page never does.
  await expect(
    latest.locator('[data-testid="result-card"][data-platform="yt"]').getByTestId("result-thumb"),
  ).toHaveAttribute("src", PICK_THUMB);
  const row = latest.getByTestId("discover-picks").locator("ul");
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await fitsViewport(page)).toBe(true);
  expect(picksAsked).toHaveLength(1);

  await page.getByTestId("discover-topic").fill("flash");
  await page.getByTestId("discover-topic").press("Enter");
  await expect(page.getByTestId("discover-sections").getByTestId("discover-picks")).toHaveAttribute(
    "data-topic",
    "flash-transition",
  );
  await expect(page.getByTestId("discover-pick-note")).toContainText("watch 0:03");
  await expect(latest).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
  // Asked again with the search (a KV read, no credits).
  await expect.poll(() => picksAsked.length).toBe(2);

  // Another meaning of the word: its own topic, so the flash transition's picks are not shown.
  await page.getByTestId("discover-alt-camera-flash").click();
  await expect(page.getByTestId("discover-sections")).toHaveAttribute("data-topic", "camera-flash");
  await expect(page.getByTestId("discover-picks")).toHaveCount(0);
});
