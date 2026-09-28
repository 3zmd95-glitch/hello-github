import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// 🚀 Auto-posting: the post popup's Auto-post tab and the hub, against a fake Scout Worker at
// https://scout.test stubbed with page.route (same pattern as accounts.spec.ts).
const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function riyadhDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

interface Job {
  id: string;
  scheduledAt: string;
  media?: { url: string; kind: string };
  targets: Record<string, Record<string, unknown>>;
}

interface Fake {
  status: Record<string, Record<string, unknown>>;
  jobs: Map<string, Job>;
  posted: Job[];
  connects: { platform: string; publish?: boolean }[];
}

async function stubWorker(page: Page): Promise<Fake> {
  const fake: Fake = {
    status: {
      tiktok: { configured: true, connected: true, canPublish: false, handle: "3z.prod" },
      instagram: { configured: true, connected: true, canPublish: true, handle: "3z.prod" },
      youtube: { configured: true, connected: false, canPublish: false },
      threads: { configured: false, connected: false, canPublish: false },
    },
    jobs: new Map(),
    posted: [],
    connects: [],
  };
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
    if (url.pathname === "/social/status") return json({ platforms: fake.status });
    if (url.pathname === "/social/data") {
      return json({ accounts: [], snapshots: [], postStats: [], demographics: [], syncedAt: {} });
    }
    if (url.pathname === "/social/publish" && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}") as Job;
      fake.posted.push(body);
      const job: Job = {
        ...body,
        targets: Object.fromEntries(
          Object.entries(body.targets).map(([p, t]) => [p, { ...t, state: "queued", attempts: 0 }]),
        ),
      };
      fake.jobs.set(job.id, job);
      return json({ job });
    }
    if (url.pathname === "/social/publish" && req.method() === "GET") {
      return json({ jobs: [...fake.jobs.values()] });
    }
    const connect = /^\/social\/connect\/([a-z]+)$/.exec(url.pathname);
    if (connect && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}") as { returnTo: string; publish?: boolean };
      fake.connects.push({ platform: connect[1], publish: body.publish });
      return json({ url: `${body.returnTo}?connected=${connect[1]}` });
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

test("schedule a post everywhere from the popup, follow it in the hub, and it is marked posted", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await connectWorker(page);

  // Settings: Instagram can post by itself, TikTok offers "Allow posting".
  const ig = page.locator('[data-testid="account-row"][data-platform="instagram"]');
  await expect(ig.getByTestId("account-can-post")).toBeVisible();
  await expect(
    page
      .locator('[data-testid="account-row"][data-platform="tiktok"]')
      .getByTestId("account-allow-posting"),
  ).toBeVisible();

  // A TikTok post for today with a caption.
  await page.goto("/social/calendar/");
  await page.getByTestId("calendar-new").click();
  await page.getByTestId("post-platform-tiktok").click();
  await page.getByTestId("post-title").fill("Match cut");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  const card = page.getByTestId("post-card").first();
  const id = (await card.getAttribute("data-post")) ?? "";
  await card.locator("button").first().click();
  await page.getByTestId("post-caption").fill("How I do a match cut ✂️");

  // 🚀 tab: TikTok is preselected but has no posting permission.
  await page.getByTestId("post-tab-autopost").click();
  const tab = page.getByTestId("post-autopost");
  await expect(tab).toHaveAttribute("data-summary", "draft");
  await expect(page.getByTestId("autopost-net-tiktok")).toBeChecked();
  await expect(page.getByTestId("autopost-allow-tiktok")).toBeVisible();
  await page.getByTestId("autopost-net-instagram").check();
  await page.getByTestId("autopost-net-x").check();
  await page.getByTestId("autopost-media-url").fill("https://www.dropbox.com/s/abc/clip.mp4?dl=0");
  await expect(page.getByTestId("autopost-media-direct")).toContainText(
    "https://dl.dropboxusercontent.com/s/abc/clip.mp4",
  );
  await expect(page.getByTestId("autopost-open-x")).toHaveAttribute(
    "href",
    /^https:\/\/x\.com\/intent\/post\?text=/,
  );
  expect(await fitsViewport(page)).toBe(true);

  // Scheduling is refused while TikTok cannot post.
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-problems")).toBeVisible();
  expect(fake.posted).toHaveLength(0);

  // Without TikTok it goes: Instagram through the Worker, X stays manual.
  await page.getByTestId("autopost-net-tiktok").uncheck();
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  expect(fake.posted).toHaveLength(1);
  expect(fake.posted[0]).toMatchObject({
    id,
    media: { url: "https://dl.dropboxusercontent.com/s/abc/clip.mp4", kind: "video" },
    // The caption plus the post's hashtags (suggested ones when it was created).
    targets: { instagram: { caption: expect.stringMatching(/^How I do a match cut ✂️\n\n#/) } },
  });
  expect(Object.keys(fake.posted[0].targets)).toEqual(["instagram"]);
  await expect(tab).toHaveAttribute("data-summary", "scheduled");
  await expect(
    page.locator('[data-testid="autopost-result"][data-platform="instagram"]'),
  ).toHaveAttribute("data-state", "queued");
  await expect(page.getByTestId("post-sheet")).toHaveAttribute("data-stage", "scheduled");
  await page.getByTestId("post-close").click();

  // The Worker publishes Instagram; the hub's refresh reads it back and the post is marked posted.
  const job = fake.jobs.get(id)!;
  job.targets.instagram = {
    ...job.targets.instagram,
    state: "published",
    postId: "m1",
    permalink: "https://www.instagram.com/reel/XYZ/",
  };
  await page.goto("/social/automations/");
  const screen = page.getByTestId("autopost-screen");
  await expect(screen).toBeVisible();
  await expect(
    page.locator('[data-testid="autopost-account"][data-platform="instagram"]'),
  ).toHaveAttribute("data-can-post", "true");
  await page.getByTestId("autopost-refresh").click();
  const row = page.locator(`[data-testid="autopost-job"][data-post="${id}"]`);
  await expect(row).toHaveAttribute("data-summary", "published");
  await expect(row.locator('[data-platform="instagram"] a')).toHaveAttribute(
    "href",
    "https://www.instagram.com/reel/XYZ/",
  );
  await expect(page.getByTestId("autopost-done")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  await page.goto(`/social/calendar/#post=${id}`);
  await expect(page.getByTestId("post-sheet")).toHaveAttribute("data-stage", "posted");
  await expect(page.getByTestId("post-posted-link")).toHaveAttribute(
    "href",
    "https://www.instagram.com/reel/XYZ/",
  );
  await page.getByTestId("post-close").click();

  // "Allow posting" from the hub reconnects TikTok with the publishing scopes.
  await page.goto("/social/automations/");
  await page.getByTestId("autopost-hub-allow-tiktok").click();
  await expect.poll(() => fake.connects).toContainEqual({ platform: "tiktok", publish: true });
});

test("without a Worker the tab says where to set it up", async ({ page }) => {
  await freshState(page, "/social/calendar/");
  await page.getByTestId("calendar-new").click();
  await page.getByTestId("post-platform-instagram").click();
  await page.getByTestId("post-title").fill("Reel");
  await page.getByTestId("post-save").click();
  await page.getByTestId("post-card").first().locator("button").first().click();
  await page.getByTestId("post-tab-autopost").click();
  await expect(page.getByTestId("autopost-need-worker")).toBeVisible();
  await expect(page.getByTestId("autopost-schedule")).toBeDisabled();
  await page.goto("/social/automations/");
  await expect(page.getByTestId("autopost-empty")).toBeVisible();
});
