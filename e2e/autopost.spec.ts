import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// 🚀 Auto-posting: the post popup's Auto-post tab and the hub, against a fake Scout Worker at
// https://scout.test stubbed with page.route (same pattern as accounts.spec.ts). Round 30 adds the
// "Post to" networks row of the new-post form, trimmed captions, the manual-network warning, the
// auto-resync after an edit and "Post now" on a post without a day; later in round 30 (A7), the jobs the
// Worker holds that no post in this browser follows (sent from another device), with their cancel.
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
  deleted: string[];
  connects: { platform: string; publish?: boolean }[];
  /** Job-list reads answered so far (counted when the list is taken, before any hold). */
  listed: number;
  /** While set, a job-list read keeps the list it took and answers only once this settles. */
  holdList: Promise<void> | null;
}

/** Stubs the Worker for one page, or for every tab of a context. */
async function stubWorker(page: Page | BrowserContext): Promise<Fake> {
  const fake: Fake = {
    status: {
      tiktok: { configured: true, connected: true, canPublish: false, handle: "3z.prod" },
      instagram: { configured: true, connected: true, canPublish: true, handle: "3z.prod" },
      youtube: { configured: true, connected: false, canPublish: false },
      threads: { configured: false, connected: false, canPublish: false },
    },
    jobs: new Map(),
    posted: [],
    deleted: [],
    connects: [],
    listed: 0,
    holdList: null,
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
    if (url.pathname === "/social/tiktok/creator")
      return json({
        canUpload: fake.status.tiktok.canUpload ?? fake.status.tiktok.canPublish,
        canDirectPost: fake.status.tiktok.canDirectPost ?? fake.status.tiktok.canPublish,
        ...(fake.status.tiktok.canDirectPost
          ? {
              creator: {
                username: "3z.prod",
                nickname: "3z Creator",
                privacyLevels: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
                commentDisabled: false,
                duetDisabled: true,
                stitchDisabled: false,
                maxVideoDurationSeconds: 300,
              },
            }
          : {}),
      });
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
      const jobs = [...fake.jobs.values()];
      fake.listed += 1;
      if (fake.holdList) await fake.holdList;
      return json({ jobs });
    }
    const run = /^\/social\/publish\/([^/]+)\/run$/.exec(url.pathname);
    if (run && req.method() === "POST") {
      const job = fake.jobs.get(decodeURIComponent(run[1]));
      return job ? json({ job }) : json({ error: "not_found" }, 404);
    }
    const del = /^\/social\/publish\/([^/]+)$/.exec(url.pathname);
    if (del && req.method() === "DELETE") {
      const id = decodeURIComponent(del[1]);
      fake.deleted.push(id);
      fake.jobs.delete(id);
      return json({ ok: true });
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

test("schedule API networks from the popup and keep the manual network unfinished", async ({
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

  // A TikTok post for today with a caption. The "Post to" row offers the post's own platform (locked),
  // Instagram (pre-ticked: it can post by itself) and the manual X / Snapchat (off); X is ticked here.
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-tiktok").click();
  await expect(page.getByTestId("post-networks")).toBeVisible();
  await expect(page.getByTestId("post-net-tiktok")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("post-net-tiktok")).toHaveAttribute("data-own", "true");
  await expect(page.getByTestId("post-net-instagram")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("post-net-x")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("post-net-youtube")).toHaveCount(0);
  await page.getByTestId("post-net-x").click();
  await expect(page.getByTestId("post-net-x")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("post-title").fill("Match cut");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  const card = page.getByTestId("post-card").first();
  const id = (await card.getAttribute("data-post")) ?? "";
  await card.locator("button").first().click();
  await page.getByTestId("post-caption").fill("How I do a match cut ✂️");

  // 🚀 tab: the networks picked at birth are there; TikTok has no posting permission yet.
  await page.getByTestId("post-tab-autopost").click();
  const tab = page.getByTestId("post-autopost");
  await expect(tab).toHaveAttribute("data-summary", "draft");
  await expect(page.getByTestId("autopost-net-tiktok")).toBeChecked();
  await expect(page.getByTestId("autopost-allow-tiktok")).toBeVisible();
  await expect(page.getByTestId("autopost-net-instagram")).toBeChecked();
  await expect(page.getByTestId("autopost-net-x")).toBeChecked();
  await expect(page.getByTestId("autopost-net-snapchat")).not.toBeChecked();
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

  // The Worker publishes Instagram; X still needs the owner to finish it.
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
  await expect(page.getByTestId("post-sheet")).toHaveAttribute("data-stage", "scheduled");
  await expect(page.getByTestId("post-posted-link")).toHaveCount(0);
  await page.getByTestId("post-close").click();

  // "Allow posting" from the hub reconnects TikTok with the publishing scopes.
  await page.goto("/social/automations/");
  await page.getByTestId("autopost-hub-allow-tiktok").click();
  await expect.poll(() => fake.connects).toContainEqual({ platform: "tiktok", publish: true });
});

test("long captions are trimmed per network, X only warns, and an edit re-sends the job by itself", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.status.threads = { configured: true, connected: true, canPublish: true, handle: "3z.prod" };
  await connectWorker(page);

  // A Threads post for today; Instagram comes pre-ticked, X is added by hand.
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-threads").click();
  await expect(page.getByTestId("post-net-threads")).toHaveAttribute("data-own", "true");
  await expect(page.getByTestId("post-net-instagram")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("post-net-x").click();
  await page.getByTestId("post-title").fill("Long one");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  const card = page.getByTestId("post-card").first();
  const id = (await card.getAttribute("data-post")) ?? "";
  await card.locator("button").first().click();

  // 120 words ≈ 840 characters: over Threads (500) and X (280), under Instagram (2200).
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
  await page.getByTestId("post-caption").fill(long);
  await page.getByTestId("post-tab-autopost").click();
  await page.getByTestId("autopost-media-url").fill("https://www.dropbox.com/s/abc/clip.mp4?dl=0");
  await expect(page.getByTestId("autopost-trimmed-threads")).toBeVisible();
  await expect(page.getByTestId("autopost-count-threads")).toHaveText(/^(\d{1,3})\/500$/);
  await expect(page.getByTestId("autopost-trimmed-instagram")).toHaveCount(0);
  await expect(page.getByTestId("autopost-warn-x")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  // The overlong X caption does not block: Threads and Instagram go out, Threads trimmed to fit.
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  expect(fake.posted).toHaveLength(1);
  expect(Object.keys(fake.posted[0].targets).sort()).toEqual(["instagram", "threads"]);
  const sent = String(fake.posted[0].targets.threads.caption);
  expect(sent.length).toBeLessThanOrEqual(500);
  expect(sent.endsWith("…")).toBe(true);
  expect(sent.startsWith("word0 word1 ")).toBe(true);

  // Editing the caption in Overview re-sends the job after a short pause, no button pressed.
  await page.getByTestId("post-tab-overview").click();
  await expect(page.getByTestId("post-auto-synced")).toBeVisible();
  await page.getByTestId("post-caption").fill("Short one now");
  await expect.poll(() => fake.posted.length, { timeout: 8_000 }).toBe(2);
  expect(fake.posted[1]).toMatchObject({
    id,
    targets: { threads: { caption: expect.stringMatching(/^Short one now/) } },
  });
});

test("post now on a post without a day gives it today's day", async ({ page }) => {
  const fake = await stubWorker(page);
  await connectWorker(page);

  // Instagram is the only network that can post; the post has no day yet.
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-instagram").click();
  await page.getByTestId("post-title").fill("Right away");
  await page.getByTestId("post-day").fill("");
  await page.getByTestId("post-save").click();
  await page.getByTestId("post-card").first().locator("button").first().click();
  await page.getByTestId("post-caption").fill("Going out now");
  await expect(page.getByTestId("post-plan-day")).toHaveValue("");

  await page.getByTestId("post-tab-autopost").click();
  await page.getByTestId("autopost-media-url").fill("https://cdn.example/clip.mp4");
  await page.getByTestId("autopost-now").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  expect(fake.posted).toHaveLength(1);
  await expect(page.getByTestId("post-autopost")).toHaveAttribute("data-summary", "scheduled");
  await page.getByTestId("post-tab-overview").click();
  await expect(page.getByTestId("post-plan-day")).toHaveValue(riyadhDay());
});

test("a refused post now leaves a post without a day undated", async ({ page }) => {
  const fake = await stubWorker(page);
  await connectWorker(page);

  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-instagram").click();
  await page.getByTestId("post-title").fill("Not yet");
  await page.getByTestId("post-day").fill("");
  await page.getByTestId("post-save").click();
  await page.getByTestId("post-card").first().locator("button").first().click();
  await page.getByTestId("post-caption").fill("No media yet");
  await expect(page.getByTestId("post-plan-day")).toHaveValue("");

  // No media link: Instagram cannot go, so nothing is sent and the day stays empty.
  await page.getByTestId("post-tab-autopost").click();
  await page.getByTestId("autopost-now").click();
  await expect(page.getByTestId("autopost-problems")).toBeVisible();
  expect(fake.posted).toHaveLength(0);
  await page.getByTestId("post-tab-overview").click();
  await expect(page.getByTestId("post-plan-day")).toHaveValue("");
});

test("without a Worker the tab says where to set it up and the form has no networks row", async ({
  page,
}) => {
  await freshState(page, "/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-instagram").click();
  await expect(page.getByTestId("post-networks")).toHaveCount(0);
  await page.getByTestId("post-title").fill("Reel");
  await page.getByTestId("post-save").click();
  await page.getByTestId("post-card").first().locator("button").first().click();
  await page.getByTestId("post-tab-autopost").click();
  await expect(page.getByTestId("autopost-need-worker")).toBeVisible();
  await expect(page.getByTestId("autopost-schedule")).toBeDisabled();
  await page.goto("/social/automations/");
  await expect(page.getByTestId("autopost-empty")).toBeVisible();
});

test("a job sent from another device shows in the hub with its networks and can be canceled", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  // Scheduled from the phone: no post in this browser has these ids.
  fake.jobs.set("phone-job-1", {
    id: "phone-job-1",
    scheduledAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    media: { url: "https://cdn.example/grade.mp4", kind: "video" },
    targets: {
      instagram: {
        caption: "Grading on the phone\n\n#davinci",
        state: "published",
        attempts: 0,
        permalink: "https://www.instagram.com/reel/PHONE/",
      },
      youtube: {
        caption: "Grading on the phone",
        title: "Color grade on the phone",
        privacy: "public",
        state: "queued",
        attempts: 0,
      },
    },
  });
  // Already out everywhere: removed without a question.
  fake.jobs.set("phone-job-0", {
    id: "phone-job-0",
    scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
    targets: { threads: { caption: "An older text post", state: "published", attempts: 0 } },
  });
  await connectWorker(page);

  // The hub reads the Worker when it opens: both jobs show under "from another device", soonest first.
  await page.goto("/social/automations/");
  const section = page.getByTestId("autopost-remote");
  await expect(section).toBeVisible();
  const rows = section.getByTestId("autopost-remote-job");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute("data-job", "phone-job-0");
  const row = section.locator('[data-testid="autopost-remote-job"][data-job="phone-job-1"]');
  await expect(row).toHaveAttribute("data-active", "true");
  await expect(row.getByTestId("autopost-remote-label")).toHaveText("Color grade on the phone");
  await expect(row.locator('li[data-platform="youtube"]')).toHaveAttribute("data-state", "queued");
  await expect(row.locator('[data-platform="instagram"] a')).toHaveAttribute(
    "href",
    "https://www.instagram.com/reel/PHONE/",
  );
  // The time reads like every other row of the hub (no extra time-zone note).
  await expect(row).not.toContainText("بتوقيت");
  const old = section.locator('[data-testid="autopost-remote-job"][data-job="phone-job-0"]');
  await expect(old).toHaveAttribute("data-active", "false");
  await expect(old.getByTestId("autopost-remote-label")).toHaveText("An older text post");
  await expect(old.getByTestId("autopost-remote-label")).toHaveAttribute(
    "title",
    "An older text post",
  );
  // Each row's button names its job, so a screen reader tells the rows apart.
  await expect(row.getByTestId("autopost-remote-cancel")).toHaveText("❌ إلغاء الجدولة");
  await expect(row.getByTestId("autopost-remote-cancel")).toHaveAccessibleName(
    "إلغاء جدولة «Color grade on the phone»",
  );
  await expect(old.getByTestId("autopost-remote-cancel")).toHaveAccessibleName(
    "شيل «An older text post» من الـ Worker",
  );
  expect(await fitsViewport(page)).toBe(true);

  // 🔄 reads the list again: a job the phone adds meanwhile shows up.
  fake.jobs.set("phone-job-2", {
    id: "phone-job-2",
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    targets: { threads: { caption: "Tomorrow from the phone", state: "queued", attempts: 0 } },
  });
  await page.getByTestId("autopost-refresh").click();
  await expect(rows).toHaveCount(3);

  // Canceling a job with a network still waiting asks first, naming the job, with a "keep it" that cannot
  // read as "yes"; backing out (Escape or the button) keeps it.
  await row.getByTestId("autopost-remote-cancel").click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("توقّف الجدولة دي؟");
  await expect(dialog).toContainText("«Color grade on the phone»");
  await expect(dialog.getByTestId("confirm-cancel")).toHaveText("خلّيها");
  await expect(dialog.getByTestId("confirm-ok")).toHaveText("أيوه، وقّفها");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await row.getByTestId("autopost-remote-cancel").click();
  await dialog.getByTestId("confirm-cancel").click();
  await expect(dialog).toHaveCount(0);
  expect(fake.deleted).toEqual([]);
  await row.getByTestId("autopost-remote-cancel").click();
  await page.getByTestId("confirm-ok").click();
  await expect.poll(() => fake.deleted).toEqual(["phone-job-1"]);
  await expect(row).toHaveCount(0);

  // A finished job goes without a question.
  await old.getByTestId("autopost-remote-cancel").click();
  await expect.poll(() => fake.deleted).toEqual(["phone-job-1", "phone-job-0"]);
  await expect(dialog).toHaveCount(0);
  await expect(rows).toHaveCount(1);

  // The last one canceled while a read is still out (it took the list before the cancel): the section goes
  // away, and that read's late answer does not bring the job back.
  let release = () => {};
  fake.holdList = new Promise<void>((r) => (release = r));
  const listedBefore = fake.listed;
  await page.getByTestId("autopost-refresh").click();
  await expect.poll(() => fake.listed).toBe(listedBefore + 1);
  await rows.first().getByTestId("autopost-remote-cancel").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("autopost-remote")).toHaveCount(0);
  expect(fake.deleted).toEqual(["phone-job-1", "phone-job-0", "phone-job-2"]);
  fake.holdList = null;
  release();
  await expect(page.getByTestId("autopost-refresh")).toBeEnabled();
  await expect(page.getByTestId("autopost-remote")).toHaveCount(0);
});

test("the hub drops another Worker's jobs once the settings point elsewhere", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.jobs.set("phone-job-1", {
    id: "phone-job-1",
    scheduledAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    targets: { threads: { caption: "From the phone", state: "queued", attempts: 0 } },
  });
  await connectWorker(page);
  await page.goto("/social/automations/");
  await expect(page.getByTestId("autopost-remote-job")).toHaveCount(1);

  // Another token (another Worker as far as the hub knows), changed without leaving the app: the jobs read
  // with the old one are not shown (nor canceled) against it.
  await page.getByRole("link", { name: "الإعدادات", exact: true }).first().click();
  await page.getByTestId("apikey-scoutToken-input").fill("another-token");
  await page.getByTestId("apikey-scoutToken-input").press("Enter");
  await page.goBack();
  await expect(page.getByTestId("autopost-screen")).toBeVisible();
  await expect(page.getByTestId("autopost-refresh")).toBeEnabled();
  await expect(page.getByTestId("autopost-remote")).toHaveCount(0);

  // No Worker at all: nothing from the Worker either.
  await page.getByRole("link", { name: "الإعدادات", exact: true }).first().click();
  await page.getByTestId("apikey-scoutToken-input").fill("");
  await page.getByTestId("apikey-scoutToken-input").press("Enter");
  await page.goBack();
  await expect(page.getByTestId("autopost-screen")).toBeVisible();
  await expect(page.getByTestId("autopost-remote")).toHaveCount(0);
  expect(fake.deleted).toEqual([]);
});

test("TikTok inbox completion stays manual until a real post link is confirmed, including after refresh", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.status.tiktok = {
    configured: true,
    connected: true,
    canPublish: true,
    canUpload: true,
    canDirectPost: false,
    handle: "3z.prod",
  };
  await connectWorker(page);
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-tiktok").click();
  await page.getByTestId("post-net-instagram").click();
  await page.getByTestId("post-title").fill("Keep the trending music");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  const card = page.getByTestId("post-card").first();
  const id = (await card.getAttribute("data-post"))!;
  await card.locator("button").first().click();
  await page.getByTestId("post-tab-autopost").click();
  await expect(page.getByTestId("autopost-tt-mode")).toHaveValue("inbox");
  await page.getByTestId("autopost-media-url").fill("https://cdn.example/clip.mp4");
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  expect(fake.posted[0].targets.tiktok).toMatchObject({ tiktokMode: "inbox" });
  expect(fake.posted[0].targets.tiktok.privacy).toBeUndefined();
  await page.getByTestId("post-close").click();
  fake.jobs.get(id)!.targets.tiktok = {
    state: "published",
    inbox: true,
    uploadedAt: new Date().toISOString(),
  };
  await page.goto("/social/automations/");
  await expect(page.getByTestId("tiktok-finish-card")).toBeVisible();
  await expect(page.getByTestId("autopost-done")).toHaveCount(0);
  await page.goto(`/social/calendar/#post=${id}`);
  await expect(page.getByTestId("post-sheet")).toHaveAttribute("data-stage", "scheduled");
  await page.getByTestId("post-tab-autopost").click();
  await expect(page.getByTestId("post-autopost")).toHaveAttribute("data-summary", "needsFinish");
  await expect(page.getByTestId("tiktok-finish-save")).toBeDisabled();
  await page.getByTestId("tiktok-finish-url").fill("https://www.tiktok.com/@3z.prod");
  await page.getByTestId("tiktok-finish-confirm").check();
  await expect(page.getByTestId("tiktok-finish-save")).toBeDisabled();
  await page.getByTestId("tiktok-finish-url").fill("https://www.tiktok.com/@3z.prod/video/123456");
  await page.getByTestId("tiktok-finish-save").click();
  await expect(page.getByTestId("post-sheet")).toHaveAttribute("data-stage", "posted");
  await page.getByTestId("post-close").click();
  await page.goto("/social/automations/");
  await page.getByTestId("autopost-refresh").click();
  await expect(page.getByTestId("tiktok-finish-card")).toHaveCount(0);
  await expect(page.getByTestId("autopost-done")).toBeVisible();
});

test("TikTok direct posting requires creator privacy and explicit music consent", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.status.tiktok = {
    configured: true,
    connected: true,
    canPublish: true,
    canUpload: true,
    canDirectPost: true,
    handle: "3z.prod",
  };
  await connectWorker(page);
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-tiktok").click();
  await page.getByTestId("post-net-instagram").click();
  await page.getByTestId("post-title").fill("Direct only after review");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  await page.getByTestId("post-card").first().locator("button").first().click();
  await page.getByTestId("post-tab-autopost").click();
  await page.getByTestId("autopost-media-url").fill("https://cdn.example/clip.mp4");
  await page.getByTestId("autopost-tt-mode").selectOption("direct");
  await expect(page.getByTestId("autopost-tt-creator")).toContainText("3z Creator");
  await expect(page.getByTestId("autopost-tt-privacy")).toHaveValue("");
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-problems")).toBeVisible();
  expect(fake.posted).toHaveLength(0);
  await page.getByTestId("autopost-tt-privacy").selectOption("SELF_ONLY");
  await page.getByTestId("autopost-tt-duration").fill("30");
  await page.getByTestId("autopost-tt-consent").check();
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  expect(fake.posted[0].targets.tiktok).toMatchObject({
    tiktokMode: "direct",
    privacy: "SELF_ONLY",
    tiktokConsent: true,
    disableComment: true,
    disableDuet: true,
    disableStitch: true,
  });
  expect(await fitsViewport(page)).toBe(true);
});

test("TikTok photo carousel preserves order and cover before an inbox upload", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.status.tiktok = {
    configured: true,
    connected: true,
    canPublish: true,
    canUpload: true,
    canDirectPost: false,
  };
  await connectWorker(page);
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-tiktok").click();
  await page.getByTestId("post-net-instagram").click();
  await page.getByTestId("post-title").fill("Photo story");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  await page.getByTestId("post-card").first().locator("button").first().click();
  await page.getByTestId("post-tab-autopost").click();
  await page.getByTestId("autopost-kind-photo").click();
  await page.getByTestId("autopost-photo-add").click();
  await page.getByTestId("autopost-photo-0").fill("https://cdn.example/first.jpg");
  await page.getByTestId("autopost-photo-add").click();
  await page.getByTestId("autopost-photo-1").fill("https://cdn.example/second.jpg");
  await page.getByTestId("autopost-photo-title").fill("Two views");
  const editor = page.getByTestId("autopost-photo-editor");
  await editor.locator('input[type="radio"]').nth(1).check();
  await editor.getByRole("button", { name: "قدّم الصورة 2" }).click();
  await expect(page.getByTestId("autopost-photo-0")).toHaveValue("https://cdn.example/second.jpg");
  await expect(editor.locator('input[type="radio"]').first()).toBeChecked();
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  expect(fake.posted[0].media).toMatchObject({
    kind: "photo",
    url: "https://cdn.example/second.jpg",
    photoUrls: ["https://cdn.example/second.jpg", "https://cdn.example/first.jpg"],
  });
  expect(fake.posted[0].targets.tiktok).toMatchObject({
    tiktokMode: "inbox",
    photoTitle: "Two views",
    photoCoverIndex: 0,
    autoAddMusic: false,
  });
  expect(await fitsViewport(page)).toBe(true);
});

test("a job sent from this browser keeps its Worker id and is not listed as another device's", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await connectWorker(page);
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-instagram").click();
  await page.getByTestId("post-title").fill("Local one");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  const card = page.getByTestId("post-card").first();
  const id = (await card.getAttribute("data-post")) ?? "";
  await card.locator("button").first().click();
  await page.getByTestId("post-caption").fill("From the laptop");
  await page.getByTestId("post-tab-autopost").click();
  await page.getByTestId("autopost-media-url").fill("https://cdn.example/clip.mp4");
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  expect(fake.posted).toHaveLength(1);
  const jobId = await page.evaluate((postId) => {
    const saved = JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}") as {
      state?: { posts?: { id: string; autoPost?: { jobId?: string } }[] };
    };
    return saved.state?.posts?.find((p) => p.id === postId)?.autoPost?.jobId ?? null;
  }, id);
  expect(jobId).toBe(id);
  await page.getByTestId("post-close").click();

  await page.goto("/social/automations/");
  await expect(page.locator(`[data-testid="autopost-job"][data-post="${id}"]`)).toBeVisible();
  await page.getByTestId("autopost-refresh").click();
  await expect(page.getByTestId("autopost-refresh")).toBeEnabled();
  await expect(page.getByTestId("autopost-remote")).toHaveCount(0);
});

test("a Creator script applied in another tab survives this tab's job polling and a reload", async ({
  page,
  context,
}) => {
  const hook = "Watch the light change.";
  const fake = await stubWorker(context);
  await context.route(`${WORKER}/creator/draft`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({
          headers: CORS,
          json: {
            draft: {
              hook,
              beats: ["Place the cup by a window.", "Move to the side.", "Show the final frame."],
              cta: "Try it on your next shoot.",
              caption: "A simple window-light setup.",
              hashtags: ["#تصوير"],
              shots: [
                { type: "hook", text: "Finished shot" },
                { type: "wide", text: "Window setup" },
                { type: "closeup", text: "Cup detail" },
              ],
            },
          },
        }),
  );
  await connectWorker(page);

  // Tab A sends a job, so its watcher keeps reading the Worker's results (and saving them).
  await page.goto("/social/calendar/");
  await page.locator('[data-testid="calendar-new"]:visible').click();
  await page.getByTestId("post-platform-instagram").click();
  await page.getByTestId("post-title").fill("Inbox test");
  await page.getByTestId("post-day").fill(riyadhDay());
  await page.getByTestId("post-save").click();
  const sent = page.getByTestId("post-card").first();
  const sentId = (await sent.getAttribute("data-post")) ?? "";
  await sent.locator("button").first().click();
  await page.getByTestId("post-caption").fill("Test clip");
  await page.getByTestId("post-tab-autopost").click();
  await page.getByTestId("autopost-media-url").fill("https://cdn.example/clip.mp4");
  await page.getByTestId("autopost-schedule").click();
  await expect(page.getByTestId("autopost-notice")).toBeVisible();
  await page.getByTestId("post-close").click();

  // Tab B, opened later, applies a Creator script to a new draft.
  const other = await context.newPage();
  await other.goto("/social/calendar/");
  await other.locator('[data-testid="calendar-new"]:visible').click();
  await other.getByTestId("post-platform-tiktok").click();
  await other.getByTestId("post-title").fill("Coffee film");
  await other.getByTestId("post-template").uncheck();
  await other.getByTestId("post-day").fill(riyadhDay());
  await other.getByTestId("post-save").click();
  const coffee = (p: Page) => p.locator('[data-testid="post-card"]', { hasText: "Coffee film" });
  await coffee(other).locator("button").first().click();
  await other.getByTestId("post-tab-script").click();
  await other.getByTestId("creator-brief").fill("Show coffee with window light");
  await other.getByTestId("creator-generate").click();
  await expect(other.getByTestId("creator-preview")).toBeVisible();
  await other.getByTestId("creator-apply-script").check();
  await other.getByTestId("creator-apply").click();
  await expect(other.getByTestId("script-hook")).toHaveValue(hook);

  // Tab A follows B's save without a reload, then reads the job again as it comes back into view.
  await expect(coffee(page)).toHaveAttribute("data-stage", "script");
  const checkedAt = () =>
    page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}") as {
        state?: { posts?: { id: string; autoPost?: { checkedAt?: string } }[] };
      };
      return saved.state?.posts?.find((p) => p.id === id)?.autoPost?.checkedAt ?? null;
    }, sentId);
  const before = await checkedAt();
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(checkedAt).not.toBe(before);

  // B reloads from what A saved last: the script is still there.
  await other.reload();
  await expect(coffee(other)).toHaveAttribute("data-stage", "script");
  // The address still names the post, so its popup opens again by itself.
  await expect(other.getByTestId("post-sheet")).toHaveAttribute("data-stage", "script");
  await other.getByTestId("post-tab-script").click();
  await expect(other.getByTestId("script-hook")).toHaveValue(hook);
  expect(fake.listed).toBeGreaterThan(0);
});
