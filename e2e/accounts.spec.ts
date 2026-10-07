import { expect, test, type Page } from "@playwright/test";
import { freshState } from "./helpers";

// 🔗 Connected accounts: the dashboard side of the live social sync, against a fake Scout Worker at
// https://scout.test stubbed with page.route (same pattern as scout.spec.ts).
const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

/** Riyadh day key of now, shifted by `offset` days (mirrors lib/streak dayKey + addDays). */
function riyadhDay(offset = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const utc = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
  return new Date(utc + offset * 86_400_000).toISOString().slice(0, 10);
}

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

interface StatusEntry {
  configured: boolean;
  connected: boolean;
  handle?: string;
  url?: string;
  lastSyncAt?: string;
  lastError?: string;
  lastErrorDetail?: string;
}
type StatusMap = Record<string, StatusEntry>;

interface Calls {
  status: number;
  data: (string | null)[];
  sync: unknown[];
  connect: { platform: string; returnTo: string }[];
  disconnect: string[];
}

interface Stub {
  /** Mutable: tests and the fake DELETE handler change it, later /social/status replies follow. */
  status: StatusMap;
  data: unknown;
  /** The OAuth URL the fake Worker hands out; defaults to coming straight back with `?connected=`. */
  connectUrl: (platform: string, returnTo: string) => string;
}

/** Stub the whole fake Worker (health + /social/*). Returns live call counters. */
async function stubWorker(page: Page, stub: Stub): Promise<Calls> {
  const calls: Calls = { status: 0, data: [], sync: [], connect: [], disconnect: [] };
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
    const authed = req.headers()["authorization"] === `Bearer ${TOKEN}`;
    if (url.pathname === "/health") {
      const configured = Object.fromEntries(
        Object.entries(stub.status).map(([p, s]) => [p, s.configured]),
      );
      return json(
        authed
          ? { ok: true, auth: true, tavily: true, social: { configured, kv: true } }
          : { ok: true },
      );
    }
    if (!authed) return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/social/status") {
      calls.status++;
      return json({ platforms: stub.status });
    }
    if (url.pathname === "/social/data") {
      calls.data.push(url.searchParams.get("since"));
      return json(stub.data);
    }
    if (url.pathname === "/social/sync" && req.method() === "POST") {
      calls.sync.push(JSON.parse(req.postData() || "{}"));
      const synced = Object.entries(stub.status)
        .filter(([, s]) => s.connected)
        .map(([p]) => p);
      return json({ synced, errors: {} });
    }
    const connect = /^\/social\/connect\/([a-z]+)$/.exec(url.pathname);
    if (connect) {
      const platform = connect[1];
      if (req.method() === "POST") {
        const body = JSON.parse(req.postData() || "{}") as { returnTo?: string };
        calls.connect.push({ platform, returnTo: body.returnTo ?? "" });
        return json({ url: stub.connectUrl(platform, body.returnTo ?? "") });
      }
      if (req.method() === "DELETE") {
        calls.disconnect.push(platform);
        stub.status[platform] = { configured: true, connected: false };
        return json({ ok: true });
      }
    }
    return json({ error: "bad_request" }, 400);
  });
  return calls;
}

const EMPTY_DATA = { accounts: [], snapshots: [], postStats: [], demographics: [], syncedAt: {} };

const comeBack = (platform: string, returnTo: string) => `${returnTo}?connected=${platform}`;

/** Fill the Scout Worker URL and token in Settings (Test → "Tested OK"). */
async function connectWorker(page: Page): Promise<void> {
  await freshState(page, "/settings/");
  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await expect(page.getByTestId("apikey-scoutUrl-status")).toHaveText("محفوظ"); // "Set"
  await page.getByTestId("apikey-scoutToken-input").fill(TOKEN);
  await page.getByTestId("apikey-scoutToken-test").click();
  await expect(page.getByTestId("apikey-scoutToken-status")).toHaveText("اتأكد ✓"); // "Tested OK"
}

const row = (page: Page, platform: string) =>
  page.locator(`[data-testid="account-row"][data-platform="${platform}"]`);
const platformCard = (page: Page, platform: string) =>
  page.locator(`[data-testid="platform-card"][data-platform="${platform}"]`);
const notice = (page: Page) => page.locator('[data-testid="toast"][data-kind="notice"]');

test("without a Worker the card points at the API keys, and the Beacons seed can still be removed", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  const card = page.getByTestId("accounts-card");
  await expect(card).toBeVisible();
  await expect(page.locator("#accounts")).toHaveCount(1);
  await expect(page.getByTestId("accounts-need-worker")).toBeVisible();
  await expect(page.getByTestId("accounts-need-worker").locator('a[href="#api-keys"]')).toHaveCount(
    1,
  );
  await expect(page.getByTestId("account-row")).toHaveCount(0);
  await expect(page.getByTestId("accounts-sync")).toHaveCount(0);
  await expect(page.getByTestId("accounts-remove-seed")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test("a failed sync shows the platform's own error message under the row", async ({ page }) => {
  const stub: Stub = {
    status: {
      instagram: { configured: true, connected: true, handle: "3z.prod" },
      youtube: { configured: true, connected: false },
      tiktok: { configured: false, connected: false },
      threads: {
        configured: true,
        connected: true,
        lastError: "upstream",
        lastErrorDetail: "upstream: profile: (#100) Tried accessing nonexisting field",
      },
    },
    data: EMPTY_DATA,
    connectUrl: comeBack,
  };
  await stubWorker(page, stub);
  await connectWorker(page);
  await expect(row(page, "threads")).toHaveAttribute("data-state", "error");
  await expect(row(page, "threads").getByTestId("account-error-detail")).toHaveText(
    "upstream: profile: (#100) Tried accessing nonexisting field",
  );
  await expect(row(page, "instagram").getByTestId("account-error-detail")).toHaveCount(0);
});

test("Settings rows follow the Worker status; Connect goes through OAuth and comes back to a toast and a sync; Disconnect asks first", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const stub: Stub = {
    status: {
      instagram: {
        configured: true,
        connected: true,
        handle: "3z.prod",
        url: "https://www.instagram.com/3z.prod/",
        lastSyncAt: now,
      },
      youtube: { configured: true, connected: false },
      tiktok: { configured: false, connected: false },
      threads: { configured: true, connected: false },
    },
    data: EMPTY_DATA,
    connectUrl: comeBack,
  };
  const calls = await stubWorker(page, stub);
  await connectWorker(page);

  // Once the URL and token are in, the card pulls the status (and the data) by itself.
  await expect(page.getByTestId("accounts-need-worker")).toHaveCount(0);
  await expect(row(page, "instagram")).toHaveAttribute("data-state", "connected");
  await expect(row(page, "instagram")).toContainText("@3z.prod");
  await expect(row(page, "instagram").getByTestId("account-disconnect")).toBeVisible();
  await expect(row(page, "youtube")).toHaveAttribute("data-state", "disconnected");
  await expect(row(page, "youtube").getByTestId("account-connect")).toBeVisible();
  await expect(row(page, "tiktok")).toHaveAttribute("data-state", "not_configured");
  await expect(row(page, "tiktok").getByTestId("account-setup-link")).toHaveAttribute(
    "href",
    /planning\/tools\/06-social-analytics-apis\.md$/,
  );
  await expect(row(page, "tiktok").getByTestId("account-connect")).toHaveCount(0);
  await expect(row(page, "threads")).toHaveAttribute("data-state", "disconnected");
  await expect(page.getByTestId("accounts-last-sync")).toContainText("آخر سحب"); // "Last pull …"
  expect(calls.status).toBeGreaterThanOrEqual(1);
  expect(calls.data.length).toBeGreaterThanOrEqual(1);
  expect(calls.data[0]).toBeNull(); // first pull: everything
  expect(await fitsViewport(page)).toBe(true);

  // Connect YouTube: POST /social/connect/youtube with returnTo = this Settings page, then follow the url.
  // The fake Worker sends the browser straight back with ?connected=youtube.
  await row(page, "youtube").getByTestId("account-connect").click();
  // The page is already on /settings/, so the URL wait alone can resolve before the click's POST lands:
  // wait for the connect call itself, then for the round trip back (the ?connected= param cleaned away).
  await expect.poll(() => calls.connect.length).toBe(1);
  await page.waitForURL(
    (u) => u.pathname.endsWith("/settings/") && !u.search.includes("connected"),
  );
  expect(calls.connect).toHaveLength(1);
  expect(calls.connect[0].platform).toBe("youtube");
  expect(calls.connect[0].returnTo).toMatch(/^http:\/\/localhost:\d+\/settings\/$/);
  await expect(notice(page).first()).toBeVisible();
  await expect(notice(page).first()).toContainText("يوتيوب"); // "YouTube connected ✓"
  // Coming back from OAuth syncs the platform that was just connected.
  await expect.poll(() => calls.sync.length).toBe(1);
  expect(calls.sync[0]).toEqual({ platforms: ["youtube"] });
  expect(page.url()).not.toContain("connected=");

  // Disconnect Instagram: confirm dialog, DELETE, the row follows the refreshed status.
  await row(page, "instagram").getByTestId("account-disconnect").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await expect(page.getByTestId("confirm-dialog")).toContainText("إنستقرام");
  await page.getByTestId("confirm-ok").click();
  await expect.poll(() => calls.disconnect).toEqual(["instagram"]);
  await expect(row(page, "instagram")).toHaveAttribute("data-state", "disconnected");
  await expect(row(page, "instagram").getByTestId("account-connect")).toBeVisible();

  // The status survives a reload without another pull (hourly throttle).
  const statusCalls = calls.status;
  await page.reload();
  await expect(row(page, "youtube")).toHaveAttribute("data-state", "disconnected");
  await expect(row(page, "tiktok")).toHaveAttribute("data-state", "not_configured");
  expect(calls.status).toBe(statusCalls);
});

test("Social Analytics: live TikTok card from a pull, the seeded Instagram card stays Beacons, Sync now hits the Worker", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const today = riyadhDay();
  const post = (id: string, daysAgo: number, views: number) => ({
    platform: "tiktok",
    postId: id,
    publishedAt: `${riyadhDay(-daysAgo)}T14:00:00+03:00`,
    kind: "video",
    title: `Video ${id}`,
    views,
    likes: Math.round(views / 12),
    comments: 10,
    shares: 20,
    permalink: `https://www.tiktok.com/@3z.prod/video/${id}`,
  });
  const stub: Stub = {
    status: {
      tiktok: {
        configured: true,
        connected: true,
        handle: "3z.prod",
        url: "https://www.tiktok.com/@3z.prod",
        lastSyncAt: now,
      },
      instagram: { configured: true, connected: false },
      youtube: { configured: true, connected: false },
      threads: { configured: true, connected: false },
    },
    data: {
      accounts: [{ platform: "tiktok", handle: "3z.prod", url: "https://www.tiktok.com/@3z.prod" }],
      snapshots: [
        {
          platform: "tiktok",
          day: today,
          followers: 1300,
          engagementRate: 8.1,
          avgViews: 31000,
          avgLikes: 2400,
        },
      ],
      postStats: [
        post("8001", 1, 41200),
        post("8002", 3, 12000),
        post("8003", 10, 30000),
        post("8004", 20, 18500),
        post("8005", 40, 55000),
        post("8006", 80, 9000),
      ],
      demographics: [],
      syncedAt: { tiktok: now },
    },
    connectUrl: comeBack,
  };
  const calls = await stubWorker(page, stub);
  await connectWorker(page);
  await expect(row(page, "tiktok")).toHaveAttribute("data-state", "connected");
  await expect(page.getByTestId("accounts-last-sync")).toContainText("آخر سحب");

  await page.goto("/social/growth/");
  await expect(page.getByTestId("growth-screen")).toBeVisible();
  // Something is connected: no connect CTA, but a Sync button in the header.
  await expect(page.getByTestId("growth-connect-cta")).toHaveCount(0);
  await expect(page.getByTestId("growth-sync")).toBeVisible();

  const tt = platformCard(page, "tiktok");
  await expect(tt.getByTestId("source-badge")).toHaveAttribute("data-source", "live");
  await expect(tt.locator('[data-metric="totalFollowers"]')).toContainText("1.3K");
  await expect(tt.getByTestId("platform-card-link")).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@3z.prod",
  );
  await expect(platformCard(page, "instagram").getByTestId("source-badge")).toHaveAttribute(
    "data-source",
    "beacons",
  );
  await expect(platformCard(page, "youtube").getByTestId("source-badge")).toHaveAttribute(
    "data-source",
    "beacons",
  );
  // The six pulled posts feed the activity counters.
  await expect(page.getByTestId("activity-90")).toHaveAttribute("data-value", "6");
  await expect(page.getByTestId("activity-7")).toHaveAttribute("data-value", "2");
  expect(await fitsViewport(page)).toBe(true);

  // The platform view carries the badge too.
  await tt.getByTestId("platform-card-open").click();
  await expect(page.getByTestId("growth-screen")).toHaveAttribute("data-tab", "tiktok");
  await expect(page.getByTestId("account-card").getByTestId("source-badge")).toHaveAttribute(
    "data-source",
    "live",
  );
  await page.getByTestId("analytics-platform-all").click();

  // Sync now: POST /social/sync, then a fresh pull and a toast.
  const before = calls.sync.length;
  await page.getByTestId("growth-sync").click();
  await expect.poll(() => calls.sync.length).toBe(before + 1);
  await expect(notice(page)).toBeVisible();
  await expect(page.getByTestId("growth-sync")).toBeEnabled();

  // The Studio home shows the last sync line.
  await page.goto("/social/");
  await expect(page.getByTestId("studio-growth-sync")).toBeVisible();
});

test("removing the Beacons numbers empties the seeded analytics page, and they stay gone after a reload", async ({
  page,
}) => {
  await freshState(page, "/social/growth/");
  await expect(page.getByTestId("platform-card")).toHaveCount(4);
  // Nothing connected yet: the CTA links to the accounts card in Settings.
  await expect(page.getByTestId("growth-connect-cta")).toBeVisible();
  await expect(page.getByTestId("growth-connect-link")).toHaveAttribute(
    "href",
    "/settings/#accounts",
  );
  await expect(platformCard(page, "tiktok").getByTestId("source-badge")).toHaveAttribute(
    "data-source",
    "beacons",
  );
  expect(await fitsViewport(page)).toBe(true);

  await page.goto("/settings/");
  await page.getByTestId("accounts-remove-seed").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("accounts-remove-seed")).toHaveCount(0);
  await expect(page.getByTestId("accounts-notice")).toBeVisible();

  await page.goto("/social/growth/");
  await expect(page.getByTestId("growth-empty")).toBeVisible();
  await expect(page.getByTestId("platform-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("growth-empty")).toBeVisible();
  await expect(page.getByTestId("platform-card")).toHaveCount(0);
  await page.goto("/settings/");
  await expect(page.getByTestId("accounts-remove-seed")).toHaveCount(0);
});

test("coming back from OAuth with connect_error shows the reason as a toast and cleans the address", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  await page.goto("/settings/?connect_error=tiktok&reason=exchange_failed");
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText("تيك توك");
  await expect(notice(page)).toContainText("ما قبلت الربط"); // "did not accept the connection"
  await expect(page).toHaveURL(/\/settings\/$/);
});
