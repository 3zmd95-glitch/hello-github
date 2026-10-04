import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// 💬 Auto replies: "Allow auto-replies" in Settings, the builder, the tester, sends/clicks, on/off and delete,
// against a fake Scout Worker at https://scout.test stubbed with page.route (same pattern as autopost.spec.ts).
const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";
const LUT = "https://3zprod.com/lut";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

interface Automation {
  id: string;
  enabled: boolean;
  postId: string | null;
  title?: string;
  permalink?: string;
  keywords: string[];
  match: string;
  trigger: string;
  publicReplies: string[];
  followButton: boolean;
  dmText: string;
  buttons: { title: string; url: string }[];
  createdAt?: string;
  stats: { sends: number; publicReplies: number; failures: number; clicks: number };
}

interface Fake {
  status: Record<string, Record<string, unknown>>;
  automations: Map<string, Automation>;
  saved: Record<string, unknown>[];
  deleted: string[];
  polls: number;
  connects: { platform: string; publish?: boolean; replies?: boolean }[];
  paused: boolean;
  defaultReply?: { enabled: boolean; text: string; stats: Automation["stats"] };
  settings: Record<string, unknown>[];
}

async function stubWorker(page: Page): Promise<Fake> {
  const fake: Fake = {
    status: {
      tiktok: { configured: true, connected: true, canPublish: true, handle: "3z.prod" },
      instagram: {
        configured: true,
        connected: true,
        canPublish: true,
        canReply: false,
        handle: "3z.prod",
      },
      youtube: { configured: true, connected: false, canPublish: false },
      threads: { configured: false, connected: false, canPublish: false },
    },
    automations: new Map(),
    saved: [],
    deleted: [],
    polls: 0,
    connects: [],
    paused: false,
    settings: [],
  };
  const doc = () => ({
    automations: [...fake.automations.values()],
    log: [],
    origin: WORKER,
    lastPollAt: "2026-09-29T09:00:00.000Z",
    paused: fake.paused,
    ...(fake.defaultReply ? { defaultReply: fake.defaultReply } : {}),
    ownerUsername: "3z.prod",
  });
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
      return json({
        accounts: [{ platform: "instagram", handle: "3z.prod" }],
        snapshots: [],
        postStats: [
          {
            platform: "instagram",
            postId: "18001",
            publishedAt: "2026-09-20T18:00:00+03:00",
            kind: "reel",
            title: "T&O LUT reel",
            permalink: "https://www.instagram.com/reel/LUT1/",
          },
          {
            platform: "instagram",
            postId: "18002",
            publishedAt: "2026-09-25T18:00:00+03:00",
            kind: "reel",
            title: "Match cut",
            permalink: "https://www.instagram.com/reel/CUT2/",
          },
        ],
        demographics: [],
        syncedAt: { instagram: "2026-09-29T03:00:00Z" },
      });
    }
    if (url.pathname === "/social/publish") return json({ jobs: [] });
    if (url.pathname === "/social/sync") return json({ synced: ["instagram"], errors: {} });
    if (url.pathname === "/social/replies" && req.method() === "GET") return json(doc());
    if (url.pathname === "/social/replies" && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}") as Record<string, unknown>;
      fake.saved.push(body);
      const existing = fake.automations.get(String(body.id));
      const automation = {
        ...(body as unknown as Automation),
        stats: existing?.stats ?? { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
      };
      fake.automations.set(automation.id, automation);
      return json({ automation });
    }
    if (url.pathname === "/social/replies/settings" && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}") as {
        paused?: boolean;
        defaultReply?: { enabled: boolean; text: string };
      };
      fake.settings.push(body);
      if (typeof body.paused === "boolean") fake.paused = body.paused;
      if (body.defaultReply) {
        fake.defaultReply = {
          ...body.defaultReply,
          stats: fake.defaultReply?.stats ?? { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
        };
      }
      return json(doc());
    }
    if (url.pathname === "/social/replies/poll" && req.method() === "POST") {
      fake.polls += 1;
      // Like the Worker: a paused poll does nothing and says why.
      if (fake.paused) {
        return json({ result: { checked: 0, sent: [], failed: [], skipped: "paused" }, ...doc() });
      }
      return json({ result: { checked: 2, sent: ["c1"], failed: [] }, ...doc() });
    }
    const del = /^\/social\/replies\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (del && req.method() === "DELETE") {
      fake.deleted.push(del[1]);
      fake.automations.delete(del[1]);
      return json({ ok: true });
    }
    const connect = /^\/social\/connect\/([a-z]+)$/.exec(url.pathname);
    if (connect && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}") as {
        returnTo: string;
        publish?: boolean;
        replies?: boolean;
      };
      fake.connects.push({ platform: connect[1], publish: body.publish, replies: body.replies });
      return json({ url: `${body.returnTo}?connected=${connect[1]}` });
    }
    return json({ error: "bad_request" }, 400);
  });
  return fake;
}

/** Settings → API keys: the Worker URL and token; "Test" pulls the status and the data. */
async function connectWorker(page: Page): Promise<void> {
  await page.goto("/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await expect(page.getByTestId("apikey-scoutUrl-status")).toHaveText("محفوظ");
  await page.getByTestId("apikey-scoutToken-input").fill(TOKEN);
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓");
}

test("allow auto-replies in Settings, build the LUT automation, test it, read sends and clicks, switch off, delete", async ({
  page,
  isMobile,
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);

  // Settings: Instagram offers "Allow auto-replies"; the other rows do not.
  const ig = page.locator('[data-testid="account-row"][data-platform="instagram"]');
  await expect(ig.getByTestId("account-allow-replies")).toBeVisible();
  await expect(
    page
      .locator('[data-testid="account-row"][data-platform="tiktok"]')
      .getByTestId("account-allow-replies"),
  ).toHaveCount(0);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  await ig.getByTestId("account-allow-replies").click();
  await expect
    .poll(() => fake.connects)
    .toContainEqual({
      platform: "instagram",
      publish: true,
      replies: true,
    });
  await expect(page).toHaveURL(/connected=instagram/);
  // "Sync now" pulls the status again (the fake now says the permission is there).
  await page.getByTestId("accounts-sync").click();
  await expect(ig.getByTestId("account-can-reply")).toBeVisible();
  await expect(ig.getByTestId("account-allow-replies")).toHaveCount(0);

  // The screen: permission ok, nothing built yet.
  await page.goto("/social/replies/");
  await expect(page.getByTestId("autoreplies-screen")).toBeVisible();
  await expect(page.getByTestId("autoreplies-can-reply")).toBeVisible();
  await expect(page.getByTestId("autoreplies-empty")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  // Build the LUT automation in the full-page editor.
  await page.getByTestId("autoreplies-new").click();
  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreply-problems")).toBeVisible();
  expect(fake.saved).toHaveLength(0);
  await page.getByTestId("autoreply-target-post").click();
  // "A specific post" with none picked yet would save as "any post": listed until a tile is picked.
  await expect(page.getByTestId("autoreply-problems")).toContainText("اختر البوست من الشبكة.");
  await page.locator('[data-testid="autoreply-post-tile"][data-post-id="18001"]').click();
  await expect(page.getByTestId("autoreply-problems")).not.toContainText("اختر البوست");
  await page.getByTestId("autoreply-keyword-input").fill("لت, LUT,");
  await expect(page.getByTestId("autoreply-keyword-chip")).toHaveCount(2);
  await page.getByTestId("autoreply-public-on").check();
  await page.getByTestId("autoreply-public-0").fill("أرسلته لك على الخاص 🎬");
  await page.getByTestId("autoreply-public-add").click();
  await page.getByTestId("autoreply-public-1").fill("شيّك على الخاص {username}");
  await page.getByTestId("autoreply-dm").fill("حمل اللت من الرابط تحت وجربه على لقطاتك");
  await page.getByTestId("autoreply-add-button").click();
  await page.getByTestId("autoreply-button-title-0").fill("حمل اللت");
  await page.getByTestId("autoreply-button-url-0").fill(LUT);
  await page.getByTestId("autoreply-follow").check();

  // The phone preview: the DM with both buttons, and the comment with a public reply under it.
  if (isMobile) await page.getByTestId("autoreply-preview-open").click();
  const preview = page.locator('[data-testid="autoreply-preview"]:visible');
  await expect(preview.getByTestId("autoreply-preview-button")).toHaveText(["حمل اللت", "تابعني"]);
  await preview.getByTestId("autoreply-preview-tab-comments").click();
  await expect(preview.getByTestId("autoreply-preview-comments")).toContainText(
    "أرسلته لك على الخاص 🎬",
  );
  expect(await fitsViewport(page)).toBe(true);

  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreplies-notice")).toBeVisible();
  expect(fake.saved).toHaveLength(1);
  expect(fake.saved[0]).toMatchObject({
    enabled: true,
    trigger: "comment",
    postId: "18001",
    permalink: "https://www.instagram.com/reel/LUT1/",
    title: "T&O LUT reel",
    keywords: ["لت", "LUT"],
    match: "contains",
    publicReplies: ["أرسلته لك على الخاص 🎬", "شيّك على الخاص {username}"],
    dmText: "حمل اللت من الرابط تحت وجربه على لقطاتك",
    buttons: [{ title: "حمل اللت", url: LUT }],
    followButton: true,
  });
  const id = String(fake.saved[0].id);
  const row = page.locator(`[data-testid="autoreply-row"][data-id="${id}"]:visible`);
  await expect(row).toHaveAttribute("data-enabled", "true");
  await expect(row.getByTestId("autoreply-sends")).toHaveText("0");
  await expect(row.getByTestId("autoreply-keyword")).toHaveCount(2);

  // The tester runs the same matcher.
  await page.getByTestId("autoreplies-tester-open").click();
  await page.getByTestId("autoreplies-tester-input").fill("ابغى اللت 🙏");
  await expect(page.getByTestId("autoreplies-tester-result")).toHaveAttribute("data-match", "true");
  await page.getByTestId("autoreplies-tester-input").fill("حلو 🔥");
  await expect(page.getByTestId("autoreplies-tester-result")).toHaveAttribute(
    "data-match",
    "false",
  );

  // "Check now" reads the fresh counters back.
  fake.automations.get(id)!.stats = { sends: 3, publicReplies: 3, failures: 0, clicks: 1 };
  await page.getByTestId("autoreplies-check").click();
  await expect.poll(() => fake.polls).toBe(1);
  await expect(row.getByTestId("autoreply-sends")).toHaveText("3");
  await expect(row.getByTestId("autoreply-clicks")).toHaveText("1");
  await expect(row.getByTestId("autoreply-ctr")).toHaveText("33%");
  expect(await fitsViewport(page)).toBe(true);

  // Off, then gone.
  await row.getByTestId("autoreply-toggle").click();
  await expect.poll(() => fake.saved.at(-1)?.enabled).toBe(false);
  await expect(row).toHaveAttribute("data-enabled", "false");
  await row.getByTestId("autoreply-menu").click();
  await row.getByTestId("autoreply-delete").click();
  await page.getByTestId("confirm-ok").click();
  await expect.poll(() => fake.deleted).toEqual([id]);
  await expect(page.getByTestId("autoreplies-empty")).toBeVisible();
});

test("a DM rule has no post or public replies, and the counter stops a DM that is too long", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  await page.getByTestId("autoreplies-new").click();
  await page.getByTestId("autoreply-target-message").click();
  await expect(page.getByTestId("autoreply-public-section")).toHaveCount(0);
  await page.getByTestId("autoreply-keyword-input").fill("كاميرا");
  await page.getByTestId("autoreply-keyword-input").press("Enter");
  await page.getByTestId("autoreply-dm").fill("ل".repeat(501));
  await expect(page.getByTestId("autoreply-dm-left")).toContainText("1");
  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreply-problems")).toBeVisible();
  expect(fake.saved).toHaveLength(0);

  await page.getByTestId("autoreply-dm").fill("أصور بالآيفون 17 برو");
  await page.getByTestId("autoreply-save").click();
  await expect.poll(() => fake.saved.length).toBe(1);
  expect(fake.saved[0]).toMatchObject({
    trigger: "message",
    postId: null,
    publicReplies: [],
    keywords: ["كاميرا"],
  });
  const id = String(fake.saved[0].id);
  await expect(
    page.locator(`[data-testid="autoreply-row"][data-id="${id}"]:visible`),
  ).toContainText("الخاص والستوري");
  expect(await fitsViewport(page)).toBe(true);
});

test("Edit far down a long list opens the editor at its top", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  for (let i = 0; i < 12; i++) {
    fake.automations.set(`dm-${i}`, {
      id: `dm-${i}`,
      enabled: true,
      postId: null,
      keywords: [`كلمة${i}`],
      match: "contains",
      trigger: "message",
      publicReplies: [],
      followButton: false,
      dmText: "الرابط تحت",
      buttons: [],
      createdAt: "2026-10-01T09:00:00.000Z",
      stats: { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
    });
  }
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  const last = page.locator('[data-testid="autoreply-row"][data-id="dm-11"]:visible');
  await last.getByTestId("autoreply-menu").click();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await last.getByTestId("autoreply-edit").click();
  await expect(page.getByRole("heading", { name: "تعديل الرد التلقائي" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("a rule on a post this browser has not synced keeps it: checked first in the grid, saved with it", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  // An older post: the fake's synced posts are 18001 and 18002 only.
  fake.automations.set("old", {
    id: "old",
    enabled: true,
    postId: "17990",
    title: "Old LUT reel",
    permalink: "https://www.instagram.com/reel/OLD/",
    keywords: ["لت"],
    match: "contains",
    trigger: "comment",
    publicReplies: [],
    followButton: false,
    dmText: "الرابط تحت",
    buttons: [],
    createdAt: "2026-09-01T09:00:00.000Z",
    stats: { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
  });
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  const row = page.locator('[data-testid="autoreply-row"][data-id="old"]:visible');
  const tiles = page.getByTestId("autoreply-post-tile");

  await row.getByTestId("autoreply-menu").click();
  await row.getByTestId("autoreply-edit").click();
  await expect(page.getByTestId("autoreply-target-post")).toHaveAttribute("aria-checked", "true");
  await expect(tiles).toHaveCount(3);
  await expect(tiles.first()).toHaveAttribute("data-post-id", "17990");
  await expect(tiles.first()).toHaveAttribute("aria-checked", "true");
  await expect(tiles.first()).toHaveText("Old LUT reel");
  await page.getByTestId("autoreply-save").click();
  await expect.poll(() => fake.saved.length).toBe(1);
  expect(fake.saved[0]).toMatchObject({
    postId: "17990",
    title: "Old LUT reel",
    permalink: "https://www.instagram.com/reel/OLD/",
  });

  // "Any post" and back: the post is still offered, so it can be picked again.
  await row.getByTestId("autoreply-menu").click();
  await row.getByTestId("autoreply-edit").click();
  await page.getByTestId("autoreply-target-anyPost").click();
  await page.getByTestId("autoreply-target-post").click();
  await expect(tiles.first()).toHaveAttribute("aria-checked", "false");
  await tiles.first().click();
  await page.getByTestId("autoreply-save").click();
  await expect.poll(() => fake.saved.length).toBe(2);
  expect(fake.saved[1]).toMatchObject({ postId: "17990", title: "Old LUT reel" });
});

test("a link without https:// gets our own message, and nothing is saved", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  await page.getByTestId("autoreplies-new").click();
  await page.getByTestId("autoreply-target-message").click();
  await page.getByTestId("autoreply-keyword-input").fill("لت,");
  await page.getByTestId("autoreply-dm").fill("حمل اللت من الرابط تحت");
  await page.getByTestId("autoreply-add-button").click();
  await page.getByTestId("autoreply-button-title-0").fill("حمل اللت");
  await page.getByTestId("autoreply-button-url-0").fill("3zprod.com/lut");
  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreply-problems")).toHaveText("الرابط لازم يبدأ بـ https://");
  expect(fake.saved).toHaveLength(0);
});

test("without a Worker the screen says where to set it up", async ({ page }) => {
  await freshState(page, "/social/replies/");
  await expect(page.getByTestId("autoreplies-need-worker")).toBeVisible();
  await expect(page.getByTestId("autoreplies-new")).toHaveCount(0);
  await page.goto("/social/more/");
  await expect(page.getByTestId("more-replies")).toHaveAttribute("href", /\/social\/replies\/?$/);
});

test("pause all, and the default reply with its size check", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  const status = page.getByTestId("autoreplies-can-reply");
  await expect(status).toHaveAttribute("data-status", "live");

  await page.getByTestId("autoreplies-pause").click();
  await expect.poll(() => fake.settings.at(-1)).toEqual({ paused: true });
  await expect(status).toHaveAttribute("data-status", "paused");
  // "Check now" while paused says why nothing was checked.
  await page.getByTestId("autoreplies-check").click();
  await expect(page.getByTestId("autoreplies-notice")).toHaveText(
    "الردود موقّفة؛ شغّلها عشان نفحص.",
  );

  // The default reply is off until it has a text; switching it on opens its editor with a suggestion.
  const row = page.locator('[data-testid="autoreply-default-row"]:visible');
  await expect(row).toHaveAttribute("data-enabled", "false");
  await row.getByTestId("autoreply-toggle").click();
  await expect(page.getByTestId("default-reply-editor")).toBeVisible();
  await expect(page.getByTestId("default-reply-text")).not.toHaveValue("");
  await page.getByTestId("default-reply-text").fill("ل".repeat(501));
  await expect(page.getByTestId("default-reply-left")).toContainText("1");
  await page.getByTestId("default-reply-save").click();
  await expect(page.getByTestId("default-reply-problems")).toBeVisible();
  expect(fake.settings).toHaveLength(1);
  await page.getByTestId("default-reply-text").fill("وصلت رسالتك 🙏");
  await page.getByTestId("default-reply-save").click();
  await expect
    .poll(() => fake.settings.at(-1))
    .toEqual({ defaultReply: { enabled: true, text: "وصلت رسالتك 🙏" } });
  await expect(row).toHaveAttribute("data-enabled", "true");
  expect(await fitsViewport(page)).toBe(true);
});

test("each rule's switch and ⋯ menu say which rule they belong to", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  // Two "any post" rules: the same content label, told apart by their first keyword.
  for (const [id, keyword] of [
    ["any-1", "لت"],
    ["any-2", "بريست"],
  ]) {
    fake.automations.set(id, {
      id,
      enabled: true,
      postId: null,
      keywords: [keyword, "lut"],
      match: "contains",
      trigger: "comment",
      publicReplies: [],
      followButton: false,
      dmText: "الرابط تحت",
      buttons: [],
      stats: { sends: 0, publicReplies: 0, failures: 0, clicks: 0 },
    });
  }
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/replies/");
  await expect(page.locator('[data-testid="autoreply-row"]:visible')).toHaveCount(2);

  for (const keyword of ["لت", "بريست"]) {
    await expect(
      page.getByRole("switch", { name: `شغّال · أي بوست · ${keyword}`, exact: true }),
    ).toHaveCount(1);
  }
  const menus = await page
    .locator('[data-testid="autoreply-menu"]:visible')
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(menus).toEqual([
    "خيارات · أي بوست · لت",
    "خيارات · أي بوست · بريست",
    "خيارات · الرد الافتراضي",
  ]);
});

test("desktop: 💬 Auto replies is in the Social sidebar", async ({ page, isMobile }) => {
  test.skip(isMobile, "the sidebar is desktop only");
  await freshState(page, "/social/growth/");
  const link = page.getByTestId("sidenav").locator('a[href="/social/replies/"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/social\/replies\/$/);
  await expect(page.getByTestId("autoreplies-screen")).toBeVisible();
});
