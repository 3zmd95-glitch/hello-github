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
    item(21, {
      section: "tutorial",
      lang: "ar",
      title: "شرح تأثير فلاش",
      published: "2025-05-30T10:00:00.000Z",
    }),
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

/** The Worker's trending effects (`GET /effects/trending`), 8 (its cap): a dictionary effect, a new one with YouTube up 3×, … */
const EFFECTS = {
  status: "ok",
  ranOn: "2026-10-06",
  updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  items: [
    {
      key: "clone-effect",
      name: { en: "clone effect", ar: "تأثير الاستنساخ" },
      what: { en: "You show up twice in one shot", ar: "تطلع مرتين في نفس اللقطة" },
      termId: "clone-effect",
      isNew: false,
      checked: true,
      creators: 9,
      posts: 14,
      platforms: ["ig", "tt"],
      growth: 1.5,
      samples: [],
    },
    {
      key: "swagger-trend",
      name: { en: "swagger trend", ar: "ترند السواقر" },
      what: { en: "Clone yourself with one hair flip", ar: "تستنسخ نفسك بحركة شعر" },
      isNew: true,
      checked: true,
      creators: 4,
      posts: 5,
      platforms: ["tt"],
      growth: 3,
      youtube: { newVideos: 12, views7d: 52000, growth: 3 },
      samples: [],
    },
    // Up to the Worker's cap of 8.
    ...[
      ["speed-ramp", "speed ramp", "سبيد رامب"],
      ["first-month-edit", "first month edit", "ايديت أول شهر"],
      ["mention-trend", "mention trend", "ترند المنشن"],
      ["reverse-trend", "reverse trend", "ترند العكس"],
      ["zoom-transition", "zoom transition", "انتقال زوم"],
      ["gif-sticker-overlay", "gif sticker overlay", "ستيكرات GIF فوق الفيديو"],
    ].map(([key, en, ar]) => ({
      key,
      name: { en, ar },
      isNew: true,
      checked: true,
      creators: 3,
      posts: 3,
      platforms: ["tt"],
      growth: 3,
      samples: [],
    })),
  ],
};

/** The Worker's Cars page (`GET /categories/cars`, workers/scout/src/categories/routes.ts): 2 styles and one technique
 * on each shelf, made 30 hours ago. A how-to is three labelled English lines (live fix 2). */
const technique = (en: string, ar: string, n: number, skillId?: string) => ({
  name: { en, ar },
  howTo: {
    en:
      `Shoot: Ride beside the car and keep the ${en} centred in the frame.\n` +
      "Settings: Shutter 1/30 s, 24 mm, gimbal in follow mode.\n" +
      "Edit: In CapCut smooth the ride with a speed curve.",
    ar: `صوّر ${ar} على 1/30 من سيارة ماشية، وبعدين نعّمها في المونتاج.`,
  },
  study: {
    watchFor: {
      en: "Watch how the subject stays framed as the background moves.",
      ar: "لاحظ مكان العنصر في الكادر مع حركة الخلفية.",
    },
    tryIt: {
      en: "Make a short movement study and compare two crops.",
      ar: "صوّر حركة قصيرة وقارن كادرين مختلفين.",
    },
    sourceBasis: "title-and-description",
  },
  ...(skillId ? { skillId } : {}),
  videos: [
    {
      url: `https://www.tiktok.com/@cars/video/${n}01`,
      title: `${en} example`,
      platform: "tt",
      kind: "example",
      lang: "en",
    },
    {
      url: `https://www.instagram.com/p/CARS${n}/`,
      title: `${en} reel`,
      platform: "ig",
      kind: "example",
      lang: "en",
    },
    {
      url: `https://www.youtube.com/watch?v=carTutor00${n}`,
      title: `${en} tutorial`,
      platform: "yt",
      kind: "tutorial",
      lang: "en",
    },
  ],
});
const CATEGORY_CARS = {
  status: "ok",
  updatedAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
  items: [
    {
      key: "rolling-shot",
      name: { en: "rolling shot", ar: "لقطة متحركة" },
      isNew: true,
      checked: true,
      creators: 6,
      posts: 7,
      platforms: ["ig", "tt"],
      growth: 3,
      samples: [],
    },
    {
      key: "speed-ramp",
      name: { en: "speed ramp", ar: "سبيد رامب" },
      termId: "speed-ramp",
      isNew: false,
      checked: true,
      creators: 9,
      posts: 12,
      platforms: ["tt"],
      growth: 1.2,
      samples: [],
    },
  ],
  lessons: {
    updatedAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
    photo: [technique("panning", "بانينق", 1, "phone-180-shutter")],
    video: [technique("rolling shot", "لقطة متحركة", 2)],
    edit: [technique("speed ramp", "سبيد رامب", 3, "speed-ramp-retime")],
  },
};

/** A top video (§6) of a platform; long titles and handles, to test the phone's width. */
const topVideo = (platform: "yt" | "tt" | "ig", n: number) => ({
  url:
    platform === "yt"
      ? `https://www.youtube.com/watch?v=carTop${String(n).padStart(5, "0")}`
      : platform === "tt"
        ? `https://www.tiktok.com/@carcreator${n}/video/${7_000_000 + n}`
        : `https://www.instagram.com/p/CarTop${n}`,
  title: `The most cinematic car edit of the month, number ${n}, rolling shots and speed ramps`,
  creator: `a_very_long_creator_handle_${n}`,
  views: (60 - n) * 12_345,
  source: platform === "yt" ? "youtube" : platform === "tt" ? "tiktok-discovery" : "tavily",
  evidence: { basis: "metadata", subjects: ["car"], techniques: ["rolling shot", "speed ramp"] },
  ...(platform === "ig" ? {} : { thumbnail: "https://example.com/t.jpg" }),
});
/** Brave's TikTok answer (`GET /categories/cars/top/tt`): no stored post, Brave's group of 30, asked when the tab is
 * chosen. */
const TOP_TIKTOK = {
  platform: "tt",
  scan: [],
  brave: Array.from({ length: 30 }, (_, i) => topVideo("tt", i + 1)),
  source: "brave",
  endpoint: "videos",
};

/** A full Cars page for the 375 px check: 12 styles, 3 techniques with long names on each shelf, and top videos (50
 * on YouTube, 14 reels). */
const CATEGORY_CARS_FULL = {
  ...CATEGORY_CARS,
  top: {
    updatedAt: CATEGORY_CARS.updatedAt,
    yt: Array.from({ length: 50 }, (_, i) => topVideo("yt", i + 1)),
    tt: [],
    ig: Array.from({ length: 14 }, (_, i) => topVideo("ig", i + 1)),
  },
  items: Array.from({ length: 12 }, (_, n) => ({
    ...CATEGORY_CARS.items[0],
    key: `style-${n}`,
    name: { en: `cinematic style number ${n}`, ar: `ستايل سينمائي رقم ${n}` },
  })),
  lessons: {
    ...CATEGORY_CARS.lessons,
    photo: [1, 2, 3].map((n) =>
      technique(
        `photo technique with a long name ${n}`,
        `تقنية تصوير باسم طويل ${n}`,
        n,
        "phone-180-shutter",
      ),
    ),
    video: [4, 5, 6].map((n) => technique(`video technique ${n}`, `تقنية فيديو ${n}`, n)),
    edit: [7, 8, 9].map((n) =>
      technique(`edit technique ${n}`, `تقنية مونتاج ${n}`, n, "speed-ramp-retime"),
    ),
  },
};

async function stubWorker(
  page: Page,
  discover: (body: Record<string, unknown>) => unknown,
  /** What `GET /categories/cars` answers. */
  category: unknown = CATEGORY_CARS,
  /** What the TikTok tab's `GET /categories/cars/top/tt` answers (Brave's group of 30 by default), and what
   * `POST /tiktokads/connect` answers ({ url }; without it, 409 not_configured). */
  extra: { topTikTok?: unknown; connect?: (body: Record<string, unknown>) => unknown } = {},
) {
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
      return reply(
        authed
          ? { ok: true, auth: true, tavily: true, discover: true, discoverSubscriptions: true }
          : { ok: true },
      );
    if (!authed) return reply({ error: "unauthorized" }, 401);
    if (url.pathname === "/effects/trending") return reply(EFFECTS);
    // Scan again: the run's fresh list.
    if (url.pathname === "/effects/run" && req.method() === "POST")
      return reply({ ...EFFECTS, updatedAt: new Date().toISOString() });
    if (url.pathname === "/categories/cars") return reply(category);
    // Scan again: the scan's fresh page.
    if (url.pathname === "/categories/cars/run" && req.method() === "POST")
      return reply({ ...CATEGORY_CARS, updatedAt: new Date().toISOString() });
    // A top videos tab (§6): Brave's TikTok list; for Instagram, the stored reels alone, as without Brave's key.
    if (url.pathname === "/categories/cars/top/tt") return reply(extra.topTikTok ?? TOP_TIKTOK);
    // "Connect TikTok trends": TikTok for Business's authorization page.
    if (url.pathname === "/tiktokads/connect" && req.method() === "POST")
      return extra.connect
        ? reply(extra.connect(JSON.parse(req.postData() ?? "{}") as Record<string, unknown>))
        : reply({ error: "not_configured" }, 409);
    if (url.pathname === "/categories/cars/top/ig") {
      const ig = (category as { top?: { ig?: unknown[] } }).top?.ig ?? [];
      return reply({ platform: "ig", scan: ig, brave: [], source: "scan", note: "no_key" });
    }
    if (url.pathname === "/discover" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      asked.push(body);
      const result = discover(body);
      const error = (result as { error?: string })?.error;
      return reply(result, error === "ai_limit" ? 429 : error ? 503 : 200);
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

const SUBSCRIPTION_PLAN = {
  summary: { ar: "ماتش كت للقهوة", en: "Coffee match cuts" },
  queries: [{ q: "coffee match cut tutorial", lang: "en", intent: "tutorials" }],
  concepts: [
    ["coffee", "قهوة"],
    ["match cut", "matchcut"],
  ],
  platforms: ["yt", "ig", "tt"],
  timeRange: "any",
  ytLength: "any",
};

async function stubSubscriptions(page: Page, failure?: string) {
  const plans: Record<string, unknown>[] = [];
  const status = {
    available: true,
    providers: {
      chatgpt: {
        connected: true,
        sharing: true,
        account: "ChatGPT test",
        accountId: "chatgpt-test",
        models: [{ id: "gpt-6-astra", name: "GPT-6 Astra", efforts: ["high", "ultra"] }],
      },
      claude: {
        connected: true,
        sharing: true,
        account: "Claude max",
        accountId: "claude-test",
        models: [{ id: "claude-fable-5-1", name: "Claude Fable 5.1", efforts: ["high", "max"] }],
      },
    },
  };
  await page.route("**/api/local-ai/**", async (route) => {
    const request = route.request();
    expect(request.headers()["x-local-ai"]).toBe("1");
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/status")) return route.fulfill({ json: status });
    if (pathname.endsWith("/plan")) {
      const body = request.postDataJSON();
      expect(request.headers()).not.toHaveProperty("authorization");
      plans.push(body);
      return route.fulfill({
        status: failure ? 429 : 200,
        json: failure
          ? { error: failure }
          : {
              provider: body.provider,
              model: body.model,
              effort: body.effort,
              plan: SUBSCRIPTION_PLAN,
            },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return plans;
}

test("subscriptions: explicit model choice, maximum effort, submitted identity and cache isolation", async ({
  page,
}) => {
  const plans = await stubSubscriptions(page);
  const asked = await stubWorker(page, (body) => {
    const chosen = body.aiPlan as { provider: string; model: string; effort?: string };
    return {
      ...ANSWER,
      complete: true,
      platforms: { tt: { ok: true } },
      alternatives: [],
      understood: {
        label: SUBSCRIPTION_PLAN.summary,
        exact: false,
        ai: true,
        provider: chosen.provider,
        model: chosen.model,
        effort: chosen.effort,
      },
    };
  });
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("discover-mode-ai").click();
  await page.getByTestId("ai-provider").selectOption("chatgpt");
  await expect(page.getByTestId("chatgpt-welcome")).toBeVisible();
  await page.getByTestId("chatgpt-welcome").getByRole("button").click();
  await page.getByTestId("ai-model").selectOption("gpt-6-astra");
  await expect(page.getByTestId("ai-effort")).toHaveValue("ultra");
  await page.getByTestId("discover-topic").fill("Find coffee match cuts");
  expect(plans).toHaveLength(0);
  expect(asked).toHaveLength(0);
  await page.getByTestId("research-search").click();
  await expect(page.getByTestId("discover-ai-plan")).toContainText("gpt-6-astra · ultra");
  expect(plans).toHaveLength(1);
  expect(asked[0]).not.toHaveProperty("subscription");
  expect(asked[0].aiPlan).toMatchObject({
    provider: "chatgpt",
    model: "gpt-6-astra",
    effort: "ultra",
  });
  await page.getByTestId("ai-provider").selectOption("claude");
  await page.getByTestId("ai-model").selectOption("claude-fable-5-1");
  await expect(page.getByTestId("ai-effort")).toHaveValue("max");
  // Draft choices do not relabel or rerun the already submitted result.
  await expect(page.getByTestId("discover-ai-plan")).toContainText("gpt-6-astra");
  expect(plans).toHaveLength(1);
  await page.getByTestId("research-search").click();
  await expect(page.getByTestId("discover-ai-plan")).toContainText("claude-fable-5-1 · max");
  expect(plans).toHaveLength(2);
  await page.getByTestId("research-search").click();
  await expect(page.getByTestId("discover-cached")).toBeVisible();
  expect(plans).toHaveLength(2);
  expect(asked).toHaveLength(2);
  expect(await fitsViewport(page)).toBe(true);
});

test("subscription allowance failure never falls back or launches video searches", async ({
  page,
}) => {
  const plans = await stubSubscriptions(page, "subscription_sharing_usage_limit_exceeded");
  const asked = await stubWorker(page, () => ANSWER);
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("discover-mode-ai").click();
  await page.getByTestId("ai-provider").selectOption("claude");
  await page.getByTestId("ai-model").selectOption("claude-fable-5-1");
  await page.getByTestId("discover-topic").fill("coffee match cuts");
  await page.getByTestId("research-search").click();
  await expect(page.getByTestId("research-results")).toContainText("حد الاستخدام");
  expect(plans).toHaveLength(1);
  expect(asked).toHaveLength(0);
  await expect(page.getByTestId("discover-ai-plan")).toHaveCount(0);
  await expect(page.getByTestId("ai-provider")).toHaveValue("claude");
});

test("AI brief: preserves filters, searches only on submit, separates cache and shows interpretation", async ({
  page,
}) => {
  const asked = await stubWorker(page, (body) => ({
    ...ANSWER,
    understood: {
      label: { ar: "ماتش كت للقهوة", en: "Coffee match cuts" },
      exact: false,
      ...(body.mode === "ai" ? { ai: true } : {}),
    },
    alternatives: [],
  }));
  let trendReads = 0;
  await page.route(`${WORKER}/trends`, (route) => {
    trendReads += 1;
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: "{}",
    });
  });
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("genre-coffee").click();
  await expect(page.getByTestId("discover-sections")).toBeVisible();
  // A broad genre radar must not sit above the focused v2 results or fetch unrelated posts.
  expect(trendReads).toBe(0);
  await expect(page.getByTestId("genre-week")).toHaveCount(0);
  const before = asked.length;
  await page.getByTestId("discover-mode-ai").click();
  await page.getByTestId("discover-topic").fill("Find coffee match cuts and DaVinci tutorials");
  await expect(page.getByTestId("genre-coffee")).toHaveAttribute("aria-pressed", "true");
  expect(asked).toHaveLength(before);
  await page.getByTestId("discover-topic").press("Enter");
  await expect(page.getByTestId("discover-ai-plan")).toBeVisible();
  expect(asked.at(-1)).toMatchObject({
    mode: "ai",
    q: "Find coffee match cuts and DaVinci tutorials",
    genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
  });
  await expect(page.getByTestId("discover-understood")).toContainText("ماتش كت للقهوة");
  await expect(page.getByTestId("discover-prompts")).toContainText("قهوة");
  expect(await fitsViewport(page)).toBe(true);
  if (await page.getByTestId("filters-toggle").isVisible())
    await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-time-week").click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ mode: "ai", timeRange: "week" });
  await page.getByTestId("filter-len-short").click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ mode: "ai", ytLength: "short" });
  await expect(page.getByTestId("discover-sections")).toBeVisible();
  const afterFilters = asked.length;
  await page.getByTestId("tab-yt").click();
  await page.getByTestId("filter-sort-popular").click();
  await page.getByTestId("filter-arfirst").click();
  expect(asked).toHaveLength(afterFilters);
  await page.getByTestId("discover-mode-keyword").click();
  await expect(page.getByTestId("discover-topic")).toHaveValue(
    "Find coffee match cuts and DaVinci tutorials",
  );
  expect(asked).toHaveLength(afterFilters);
  await page.getByTestId("research-search").click();
  await expect.poll(() => asked.length).toBe(afterFilters + 1);
  expect(asked.at(-1)).not.toHaveProperty("mode");
  await expect(page.getByTestId("discover-ai-plan")).toHaveCount(0);
  const ideas = page.getByTestId("discover-category-ideas");
  await expect(ideas).toBeVisible();
  await expect(page.getByTestId("discover-category-focus")).toContainText("قهوة");
  const suggestions = ideas.getByTestId("discover-prompts").getByRole("button");
  await expect(suggestions).toHaveCount(3);
  const beforeIdea = asked.length;
  const idea = await suggestions.first().innerText();
  await suggestions.first().click();
  await expect(page.getByTestId("discover-topic")).toHaveValue(idea);
  expect(asked).toHaveLength(beforeIdea);
  await page.getByTestId("discover-category-only").click();
  await expect
    .poll(() => asked.at(-1))
    .toMatchObject({
      q: "coffee edit",
      genreQuery: { ar: "تصوير قهوة" },
      timeRange: "week",
      ytLength: "short",
    });
  await expect(page.getByTestId("discover-topic")).toHaveValue("");
  await expect(page.getByTestId("genre-coffee")).toHaveAttribute("aria-pressed", "true");
  expect(await fitsViewport(page)).toBe(true);
});

test("AI unavailable and daily limit are honest, with a working keyword recovery", async ({
  page,
}) => {
  let limited = false;
  const asked = await stubWorker(page, (body) =>
    body.mode === "ai" ? { error: limited ? "ai_limit" : "ai_unavailable" } : ANSWER,
  );
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("discover-mode-ai").click();
  await page.getByTestId("discover-topic").fill("coffee match cut");
  await page.getByTestId("research-search").click();
  await expect(page.getByTestId("research-results")).toContainText("مو متاح دحين");
  await expect(page.getByTestId("discover-ai-plan")).toHaveCount(0);
  limited = true;
  await page.getByTestId("research-search").click();
  await expect(page.getByTestId("research-results")).toContainText("الـ٢٠");
  await page.getByTestId("discover-mode-keyword").click();
  await page.getByTestId("research-search").click();
  await expect(page.getByTestId("discover-sections")).toBeVisible();
  await page.getByTestId("discover-mode-ai").click();
  await page.getByTestId("genre-cars").click();
  await expect
    .poll(() => asked.at(-1))
    .toMatchObject({ mode: "ai", genreQuery: { en: "car edit" } });
});

test("Instagram cards load missing previews and keep a playable fallback when unavailable", async ({
  page,
}) => {
  const posts = ["previewReady", "previewUnavailable"].map((id, n) =>
    item(40 + n, {
      platform: "ig",
      url: `https://www.instagram.com/p/${id}/`,
      thumb: undefined,
      title: n === 0 ? "Flash transition preview" : "Unavailable preview",
    }),
  );
  await stubWorker(page, () => ({
    ...ANSWER,
    items: posts,
    creators: [],
    platforms: { tt: { ok: true }, ig: { ok: true }, yt: { ok: true } },
  }));
  await page.route(`${WORKER}/discover/picks*`, (route) =>
    route.fulfill({
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ picks: [] }),
    }),
  );
  const lookups: string[] = [];
  await page.route(`${WORKER}/oembed?*`, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(route.request().url()).searchParams.get("url")!;
    lookups.push(url);
    await route.fulfill({
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({
        url,
        title: "",
        author: "",
        thumb: url === posts[0].url ? `${WORKER}/preview.png` : "",
      }),
    });
  });
  await page.route(`${WORKER}/preview.png`, (route) =>
    route.fulfill({ contentType: "image/png", body: PNG }),
  );
  await connectWorker(page);
  await search(page, "flash");
  const cards = page.getByTestId("discover-section-example").getByTestId("result-card");
  const ready = cards.filter({ hasText: "Flash transition preview" });
  const missing = cards.filter({ hasText: "Unavailable preview" });
  await expect(ready.getByTestId("result-thumb")).toHaveAttribute("src", `${WORKER}/preview.png`);
  await expect(ready.getByTestId("result-thumb")).toBeVisible();
  await expect
    .poll(() =>
      ready.getByTestId("result-thumb").evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  await expect(missing.getByTestId("result-thumb-placeholder")).toContainText(
    "المعاينة مو متوفّرة",
  );
  await expect(missing.getByTestId("result-play")).toBeVisible();
  expect(lookups.sort()).toEqual(posts.map((p) => p.url).sort());
  expect(await fitsViewport(page)).toBe(true);
});

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
  // Instagram and TikTok first (the owner, 2026-10-07): the tabs, and on All each section; a card shows its date.
  expect(
    await page
      .locator('[role="tab"][data-testid^="tab-"]')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-testid"))),
  ).toEqual(["tab-all", "tab-ig", "tab-tt", "tab-yt"]);
  const firstTutorial = page
    .getByTestId("discover-section-tutorial")
    .getByTestId("result-card")
    .first();
  await expect(firstTutorial).toHaveAttribute("data-platform", "tt");
  await expect(firstTutorial.getByTestId("result-date")).toHaveText("May 30, 2025");

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

test("partial platform results stay visible with a retry warning", async ({ page }) => {
  await stubWorker(page, () => ({
    ...ANSWER,
    platforms: { tt: { ok: true, partial: "upstream" }, ig: { ok: true }, yt: { ok: true } },
  }));
  await connectWorker(page);
  await search(page, "flash");
  await expect(page.getByTestId("discover-section-example")).toBeVisible();
  await expect(page.getByTestId("discover-down-tt")).toContainText("النتائج هذي ناقصة");
  await expect(page.getByTestId("discover-retry-tt")).toBeVisible();
  await expect(page.getByTestId("research-lang-en")).toHaveCount(0);
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
  // Headings: the group's title, then each topic's picks with the topic in its heading (and its region's name), so
  // the three topics an empty Discover can list read apart.
  await expect(
    latest.getByRole("heading", { level: 2, name: "⭐ آخر اختيارات Claude", exact: true }),
  ).toBeVisible();
  await expect(
    latest.getByRole("heading", { level: 3, name: "⭐ اختيارات Claude عن «flash»", exact: true }),
  ).toBeVisible();
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
  const topicPicks = page.getByTestId("discover-sections").getByTestId("discover-picks");
  await expect(topicPicks).toHaveAttribute("data-topic", "flash-transition");
  // Claude's note in « », which mirror in Arabic.
  await expect(page.getByTestId("discover-pick-note")).toHaveText("«watch 0:03»");
  await expect(latest).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
  // Asked again with the search (a KV read, no credits).
  await expect.poll(() => picksAsked.length).toBe(2);

  // Picks follow the platform tab like every section: none on Instagram (Claude picked TikTok and YouTube), the
  // YouTube one on YouTube.
  await page.getByTestId("tab-ig").click();
  await expect(page.getByTestId("research-results")).toHaveAttribute("data-tab", "ig");
  await expect(topicPicks).toHaveCount(0);
  await page.getByTestId("tab-yt").click();
  await expect(topicPicks.getByTestId("result-card")).toHaveCount(1);
  await expect(topicPicks.getByTestId("result-card")).toHaveAttribute("data-platform", "yt");
  await page.getByTestId("tab-all").click();

  // Another meaning of the word: its own topic, so the flash transition's picks are not shown.
  await page.getByTestId("discover-alt-camera-flash").click();
  await expect(page.getByTestId("discover-sections")).toHaveAttribute("data-topic", "camera-flash");
  await expect(page.getByTestId("discover-picks")).toHaveCount(0);
});

test("Discover v2: trending effects chips; a tap searches the effect with the category cleared", async ({
  page,
}) => {
  const asked = await stubWorker(page, () => ANSWER);
  await connectWorker(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover/");

  const row = page.getByTestId("trending-effects");
  await expect(row).toHaveAttribute("data-state", "list");
  await expect(row.getByTestId("trending-effect")).toHaveCount(8);
  const fresh = row.locator('[data-testid="trending-effect"][data-key="swagger-trend"]');
  await expect(fresh.getByText("جديد", { exact: true })).toBeVisible();
  await expect(fresh).toContainText("4 صنّاع · ▶ ↑3×");
  // English first in Arabic too (live fix 1): the English name, the Arabic one in the tooltip.
  await expect(fresh).toContainText("swagger trend");
  // The tooltip ends with what "4 creators" means: posted it in the last 7 days (by each post's own date).
  await expect(fresh).toHaveAttribute(
    "title",
    "Clone yourself with one hair flip\nترند السواقر\n4 صنّاع نزّلوه آخر 7 أيام",
  );
  // The 8 chips overflow their strip, which scrolls sideways; the 375 px page never does.
  const strip = row.getByTestId("trending-effect").first().locator("xpath=..");
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await fitsViewport(page)).toBe(true);

  // 🔄 Scan again runs the job now, forced past the Worker's once-a-day guard; the new list is "just now".
  await expect(row).toContainText("تحدّثت قبل 2 س");
  const scan = page.waitForRequest(
    (r) => r.url() === `${WORKER}/effects/run` && r.method() === "POST",
  );
  await row.getByTestId("trending-rescan").click();
  expect((await scan).postDataJSON()).toEqual({ force: true });
  await expect(row).toContainText("تحدّثت الحين");
  await expect(row.getByTestId("trending-effect")).toHaveCount(8);
  await expect(row.getByTestId("trending-rescan")).toBeEnabled();
  expect(await fitsViewport(page)).toBe(true);

  // With a category on, a chip searches the effect alone: the dictionary effect by its English label.
  await page.getByTestId("genre-coffee").click();
  await expect.poll(() => asked.length).toBe(1);
  await row.locator('[data-testid="trending-effect"][data-key="clone-effect"]').click();
  await expect.poll(() => asked.length).toBe(2);
  // English, with editing context (live: an Arabic query found beauty serums for "Glow Effect"), and Posted on Week:
  // the row says "this week".
  expect(asked[1]).toEqual({ q: "clone effect", lang: "en", editing: true, timeRange: "week" });
  await expect(page.getByTestId("filter-time-week")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("genre-coffee")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("discover-topic")).toHaveValue("clone effect");
  await expect(page.getByTestId("discover-recent-topic").first()).toHaveText("clone effect");
  await expect(page.getByTestId("discover-sections")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test("Discover v2: a category with nothing typed opens its page — trends, lessons, Scan again, Search all", async ({
  page,
}, testInfo) => {
  const asked = await stubWorker(page, () => ANSWER);
  await connectWorker(page);
  await page.goto("/discover/");

  // Arabic first: the page replaces the automatic category search.
  await page.getByTestId("genre-cars").click();
  const cat = page.getByTestId("category-page");
  await expect(cat).toHaveAttribute("data-state", "page");
  await expect(cat.getByRole("heading", { level: 2 })).toHaveText("🚗 سيارات");
  await expect(cat).toContainText("تحدّثت قبل 1 يوم");
  await expect(cat.getByTestId("category-style")).toHaveCount(2);
  await expect(cat.getByTestId("category-shelf")).toHaveCount(3);
  await expect(cat.getByTestId("category-technique")).toHaveCount(3);
  await expect(page.getByTestId("research-results")).toBeHidden();
  expect(asked).toHaveLength(0);
  expect(await fitsViewport(page)).toBe(true);

  // A technique's skill opens that skill; its videos play in the app's player.
  const panning = cat.getByTestId("category-technique").first();
  await expect(panning.getByTestId("category-lesson-preview")).toBeVisible();
  await expect(panning.getByTestId("category-study")).toHaveCount(0);
  await expect(panning.getByRole("heading", { level: 4 })).toHaveText("panning");
  await expect(panning.getByTestId("category-name-ar")).toHaveText("بانينق");
  const lessonSave = panning.getByTestId("inspiration-save");
  await expect(lessonSave).toHaveAttribute("aria-pressed", "false");
  await lessonSave.click();
  await expect(lessonSave).toHaveAttribute("aria-pressed", "true");
  await panning.getByTestId("category-study-toggle").click();
  const watchFor = panning.getByTestId("category-watch-for");
  expect(await watchFor.evaluate((p) => p.matches(":dir(ltr)"))).toBe(true);
  await expect(watchFor).toContainText("Watch how the subject stays framed");
  expect(
    await panning.getByTestId("category-watch-for-ar").evaluate((p) => p.matches(":dir(rtl)")),
  ).toBe(true);
  await expect(panning.getByTestId("category-study-basis")).toContainText("مو من تحليل الفيديو");
  await expect(panning).not.toContainText("1/30");
  await panning.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("synthetic-category-study.png"),
    fullPage: false,
  });
  await expect(
    cat.locator('[data-testid="category-style"][data-key="rolling-shot"]'),
  ).toContainText("rolling shot");
  await panning.getByTestId("category-skill").click();
  await expect(page.getByTestId("skill-sheet")).toBeVisible();
  await page.getByTestId("sheet-close").click();
  await panning.locator('[data-testid="category-video"][data-kind="example"]').first().click();
  await expect(page.getByTestId("player-sheet")).toHaveCount(0);
  await panning.getByTestId("result-play").click();
  await expect(page.getByTestId("player-sheet")).toBeVisible();
  await page.getByTestId("player-close").click();

  // 🔄 Scan again: forced, and the new page is "just now".
  const scan = page.waitForRequest(
    (r) => r.url() === `${WORKER}/categories/cars/run` && r.method() === "POST",
  );
  await cat.getByTestId("category-rescan").click();
  expect((await scan).postDataJSON()).toEqual({ force: true });
  await expect(cat).toContainText("تحدّثت الحين");

  // A trending style: that style within Cars, in Keywords.
  await cat.locator('[data-testid="category-style"][data-key="rolling-shot"]').click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toEqual({
    q: "rolling shot",
    genreQuery: { ar: "ايديت سيارات", en: "car edit" },
    lang: "en",
    editing: true,
    timeRange: "week",
  });
  await expect(page.getByTestId("category-page")).toHaveCount(0);
  await expect(page.getByTestId("discover-sections")).toBeVisible();

  // English: Cars off, the box cleared, Cars again opens the page; "Search all" runs today's category search.
  await page.getByTestId("lang-en").click();
  await page.getByTestId("genre-cars").click();
  await page.getByTestId("discover-topic").fill("");
  await page.getByTestId("genre-cars").click();
  await expect(
    cat.getByRole("heading", { level: 3, name: "🔥 Trending in Cars this week" }),
  ).toBeVisible();
  await expect(cat.getByTestId("category-search-all")).toHaveText("Search all Cars videos →");
  // English remains the main text; Arabic study lines follow only in the Arabic UI.
  await panning.getByTestId("category-study-toggle").click();
  expect(await watchFor.evaluate((p) => p.matches(":dir(ltr)"))).toBe(true);
  await expect(cat.getByTestId("category-watch-for-ar")).toHaveCount(0);
  await expect(cat.getByTestId("category-name-ar")).toHaveCount(0);
  await cat.getByTestId("category-search-all").click();
  // Posted is still on the style's Week: the owner widens it.
  await expect
    .poll(() => asked.at(-1))
    .toEqual({ q: "car edit", genreQuery: { ar: "ايديت سيارات" }, lang: "en", timeRange: "week" });
  await expect(page.getByTestId("category-page")).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
});

test("Discover category: save an edit, record what to try, and keep its practice state after reload", async ({
  page,
}, testInfo) => {
  await stubWorker(page, () => ANSWER, CATEGORY_CARS_FULL);
  await connectWorker(page);
  await page.setViewportSize(
    testInfo.project.name === "desktop"
      ? { width: 1440, height: 980 }
      : { width: 375, height: 812 },
  );
  await page.goto("/discover/");
  await page.getByTestId("lang-en").click();
  await page.getByTestId("genre-cars").click();
  const topCard = page.getByTestId("category-top-item").first();
  const save = topCard.getByTestId("inspiration-save");
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  // The existing Saved only filter includes one-click inspiration saves too.
  await page.getByTestId("category-search-all").click();
  if (await page.getByTestId("filters-toggle").isVisible())
    await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filter-saved").click();
  const savedResult = page.getByTestId("research-results").getByTestId("result-card");
  await expect(savedResult).toHaveCount(1);
  await expect(savedResult.getByTestId("result-title")).toHaveText(topVideo("ig", 1).title);
  await page.getByTestId("inspiration-library-open").click();
  const card = page.getByTestId("inspiration-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("result-title")).toHaveText(topVideo("ig", 1).title);
  const note =
    "Try matching the car wheel to a coffee cup, keeping the circle in the same part of the frame.";
  await card.getByTestId("inspiration-note").fill(note);
  await card.getByTestId("inspiration-stage").selectOption("trying");
  expect(await fitsViewport(page)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("synthetic-practice-library.png"),
    fullPage: true,
  });
  // Saving an already-saved card opens its notes; it never deletes the work.
  await page.getByTestId("inspiration-explore").click();
  await savedResult.getByTestId("inspiration-save").click();
  await expect(card.getByTestId("inspiration-note")).toHaveValue(note);
  await expect(card.getByTestId("inspiration-stage")).toHaveValue("trying");
  await page.reload();
  await page.getByTestId("inspiration-library-open").click();
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("inspiration-note")).toHaveValue(note);
  await expect(card.getByTestId("inspiration-stage")).toHaveValue("trying");
  await card.getByTestId("inspiration-stage").selectOption("tried");
  await page.reload();
  await page.getByTestId("inspiration-library-open").click();
  await expect(card.getByTestId("inspiration-stage")).toHaveValue("tried");
  expect(await fitsViewport(page)).toBe(true);
});

test("Discover v2: a full category page at 375 px never scrolls sideways; only the style chips scroll sideways", async ({
  page,
}) => {
  await stubWorker(page, () => ANSWER, CATEGORY_CARS_FULL);
  await connectWorker(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover/");
  await page.getByTestId("genre-cars").click();

  const cat = page.getByTestId("category-page");
  await expect(cat.getByTestId("category-style")).toHaveCount(12);
  await expect(cat.getByTestId("category-technique")).toHaveCount(9);
  const scrollsSideways = (el: Element) => el.scrollWidth > el.clientWidth;
  expect(await cat.getByTestId("category-styles").evaluate(scrollsSideways)).toBe(true);
  const shelves = await cat.getByTestId("category-shelf").all();
  expect(shelves).toHaveLength(3);
  for (const shelf of shelves)
    expect(await shelf.locator("ul").first().evaluate(scrollsSideways)).toBe(false);
  expect(await fitsViewport(page)).toBe(true);

  // English's longer words never push the page wider either.
  await page.getByTestId("lang-en").click();
  await expect(
    cat.getByRole("heading", { level: 3, name: "🔥 Trending in Cars this week" }),
  ).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test("Discover v2: a category's 🏆 top videos at 375 px — the tabs fit, TikTok loads when chosen, Brave credited, the page never scrolls sideways", async ({
  page,
}) => {
  await stubWorker(page, () => ANSWER, CATEGORY_CARS_FULL);
  await connectWorker(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover/");
  await page.getByTestId("genre-cars").click();

  const top = page.getByTestId("category-top");
  await expect(top.getByRole("heading", { level: 3 })).toHaveText("مونتاج تتعلّم منه · سيارات");
  const tabs = top.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  // Instagram, TikTok, then YouTube (the owner: "Instagram and tiktok first"), English names in Arabic too. Instagram
  // is chosen: its 14 stored reels come with the page, 12 at a time; YouTube's 50 wait on their tab.
  await expect(tabs.nth(0)).toContainText("Instagram");
  await expect(tabs.nth(1)).toContainText("TikTok");
  await expect(tabs.nth(2)).toContainText("YouTube");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(0)).toHaveAttribute("data-count", "14");
  await expect(tabs.nth(2)).toHaveAttribute("data-count", "50");
  await expect(top.locator('[data-testid="category-top-item"][data-platform="ig"]')).toHaveCount(
    12,
  );
  const firstTop = top.getByTestId("category-top-item").first();
  await expect(firstTop.getByTestId("category-match-evidence")).toContainText("rolling shot");
  const topSave = firstTop.getByTestId("inspiration-save");
  await expect(topSave).toHaveAttribute("aria-pressed", "false");
  await topSave.click();
  await expect(topSave).toHaveAttribute("aria-pressed", "true");
  // The three tabs sit inside the strip, and the strip inside the page.
  const strip = top.getByRole("tablist");
  expect(await strip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const tab of await tabs.all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  expect(await fitsViewport(page)).toBe(true);

  // TikTok (C7): arrowing onto it asks nothing; Enter chooses it and asks Brave once.
  const ttTab = top.locator('[data-testid="category-top-tab"][data-platform="tt"]');
  let topAsks = 0;
  page.on("request", (r) => {
    if (r.url() === `${WORKER}/categories/cars/top/tt`) topAsks++;
  });
  await tabs.nth(0).focus();
  await page.keyboard.press("ArrowLeft"); // forward, right to left
  await expect(ttTab).toBeFocused();
  await expect(ttTab).toHaveAttribute("aria-selected", "false");
  expect(topAsks).toBe(0);
  const asked = page.waitForRequest(
    (r) => r.url() === `${WORKER}/categories/cars/top/tt` && r.method() === "GET",
  );
  await page.keyboard.press("Enter");
  await asked;
  await expect(ttTab).toHaveAttribute("aria-selected", "true");
  await expect(ttTab).toHaveAttribute("data-count", "30");
  // Brave's group, credited under it (C2, C3).
  await expect(top.getByTestId("category-top-brave")).toHaveText("أكثر من Brave Search");
  const credit = top.getByTestId("category-top-credit").locator("a");
  await expect(credit).toHaveText("النتائج من Brave Search");
  await expect(credit).toHaveAttribute("href", "https://brave.com/search/api/");
  await expect(credit).toHaveAttribute("target", "_blank");
  await expect(top.locator('[data-testid="category-top-item"][data-platform="tt"]')).toHaveCount(
    12,
  );
  await top.getByTestId("category-top-more").click();
  await expect(top.getByTestId("category-top-item")).toHaveCount(24);
  expect(await fitsViewport(page)).toBe(true);

  // English: the same row, and the page still never scrolls sideways.
  await page.getByTestId("lang-en").click();
  await expect(top.getByRole("heading", { level: 3 })).toHaveText("Edits to study · Cars");
  expect(await fitsViewport(page)).toBe(true);
});

test("Discover v2: an empty TikTok tab connects TikTok trends — TikTok for Business's page, then Discover says TikTok is connected", async ({
  page,
  baseURL,
}) => {
  const connects: Record<string, unknown>[] = [];
  const portal = "https://business-api.tiktok.com/portal/auth?app_id=7693488727766597653&state=e2e";
  await stubWorker(page, () => ANSWER, CATEGORY_CARS_FULL, {
    // Brave off (§6): the stored TikTok list alone, none yet.
    topTikTok: {
      platform: "tt",
      scan: [],
      brave: [],
      source: "scan",
      note: "no_key",
      discoveryStatus: "not_connected",
    },
    connect: (body) => {
      connects.push(body);
      return { url: portal };
    },
  });
  // TikTok's page and the Worker's /oauth/tiktokads/callback in one step: back to Discover, connected.
  await page.route("https://business-api.tiktok.com/portal/auth**", (route) =>
    route.fulfill({
      status: 302,
      headers: { location: `${baseURL}/discover/?tiktokads=connected` },
    }),
  );
  await connectWorker(page);
  await page.goto("/discover/");
  await page.getByTestId("genre-cars").click();

  const top = page.getByTestId("category-top");
  await top.locator('[data-testid="category-top-tab"][data-platform="tt"]').click();
  await expect(top.getByTestId("category-top-line")).toHaveText(
    "اربط تيك توك عشان تضيف نتائج الاستكشاف منه.",
  );
  // Brave is off by choice: nothing about it.
  await expect(top.getByText("Brave")).toHaveCount(0);
  const connect = top.getByTestId("category-top-connect");
  await expect(connect).toHaveText("اربط ترندات تيك توك");
  await connect.click();

  await expect(page.getByTestId("tiktokads-line")).toHaveText(
    "انربط تيك توك — تبويب تيك توك يتعبّى مع الفحص الجاي حق هالفئة",
  );
  expect(connects).toEqual([{ returnTo: `${baseURL}/discover/` }]);
  // The address no longer says so, so a reload says nothing.
  await expect(page).toHaveURL(`${baseURL}/discover/`);
});
