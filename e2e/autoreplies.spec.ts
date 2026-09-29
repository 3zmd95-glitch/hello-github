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
  keywords: string[];
  match: string;
  publicReply: string;
  dmText: string;
  buttons: { title: string; url: string }[];
  stats: { sends: number; publicReplies: number; failures: number; clicks: number };
}

interface Fake {
  status: Record<string, Record<string, unknown>>;
  automations: Map<string, Automation>;
  saved: Record<string, unknown>[];
  deleted: string[];
  polls: number;
  connects: { platform: string; publish?: boolean; replies?: boolean }[];
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
  };
  const doc = () => ({
    automations: [...fake.automations.values()],
    log: [],
    origin: WORKER,
    lastPollAt: "2026-09-29T09:00:00.000Z",
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
    if (url.pathname === "/social/replies/poll" && req.method() === "POST") {
      fake.polls += 1;
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
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);

  // Settings: Instagram offers "Allow auto-replies"; the other rows do not.
  const ig = page.locator('[data-testid="account-row"][data-platform="instagram"]');
  await expect(ig.getByTestId("account-allow-replies")).toBeVisible();
  await expect(
    page.locator('[data-testid="account-row"][data-platform="tiktok"]').getByTestId("account-allow-replies"),
  ).toHaveCount(0);
  fake.status.instagram = { ...fake.status.instagram, canReply: true };
  await ig.getByTestId("account-allow-replies").click();
  await expect.poll(() => fake.connects).toContainEqual({
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

  // Build the LUT automation.
  await page.getByTestId("autoreplies-new").click();
  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreply-problems")).toBeVisible();
  expect(fake.saved).toHaveLength(0);
  await page.getByTestId("autoreply-post").selectOption("18001");
  await page.getByTestId("autoreply-keywords").fill("لت, LUT");
  await page.getByTestId("autoreply-public").fill("أرسلته لك على الخاص 🎬");
  await page.getByTestId("autoreply-dm").fill("حمل اللت من الرابط تحت وجربه على لقطاتك");
  await page.getByTestId("autoreply-add-button").click();
  await page.getByTestId("autoreply-button-title-0").fill("حمل اللت");
  await page.getByTestId("autoreply-button-url-0").fill(LUT);
  await expect(page.getByTestId("autoreply-preview")).toContainText(`${WORKER}/go/`);
  await page.getByTestId("autoreply-save").click();
  await expect(page.getByTestId("autoreplies-notice")).toBeVisible();
  expect(fake.saved).toHaveLength(1);
  expect(fake.saved[0]).toMatchObject({
    enabled: true,
    postId: "18001",
    permalink: "https://www.instagram.com/reel/LUT1/",
    title: "T&O LUT reel",
    keywords: ["لت", "LUT"],
    match: "contains",
    publicReply: "أرسلته لك على الخاص 🎬",
    dmText: "حمل اللت من الرابط تحت وجربه على لقطاتك",
    buttons: [{ title: "حمل اللت", url: LUT }],
  });
  const id = String(fake.saved[0].id);
  const row = page.locator(`[data-testid="autoreply-row"][data-id="${id}"]`);
  await expect(row).toHaveAttribute("data-enabled", "true");
  await expect(row.getByTestId("autoreply-sends")).toHaveText("0");
  await expect(row.getByTestId("autoreply-keyword")).toHaveCount(2);

  // The tester runs the same matcher.
  await page.getByTestId("autoreplies-tester-input").fill("ابغى اللت 🙏");
  await expect(page.getByTestId("autoreplies-tester-result")).toHaveAttribute("data-match", "true");
  await page.getByTestId("autoreplies-tester-input").fill("حلو 🔥");
  await expect(page.getByTestId("autoreplies-tester-result")).toHaveAttribute("data-match", "false");

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
  await row.getByTestId("autoreply-delete").click();
  await page.getByTestId("confirm-ok").click();
  await expect.poll(() => fake.deleted).toEqual([id]);
  await expect(page.getByTestId("autoreplies-empty")).toBeVisible();
});

test("without a Worker the screen says where to set it up", async ({ page }) => {
  await freshState(page, "/social/replies/");
  await expect(page.getByTestId("autoreplies-need-worker")).toBeVisible();
  await expect(page.getByTestId("autoreplies-new")).toHaveCount(0);
  await page.goto("/social/more/");
  await expect(page.getByTestId("more-replies")).toHaveAttribute("href", /\/social\/replies\/?$/);
});
