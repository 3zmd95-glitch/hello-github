import { expect, test, type Page, type Route } from "@playwright/test";
import { seedState } from "./helpers";

// DT-WIO-1: searching the LOADED Instagram conversations in the Inbox list, against a fake Scout Worker at
// https://scout.test (page.route). Synthetic data only; every request that is not localhost or the fake Worker is
// aborted and counted. Search and Clear read nothing: the only Worker calls are open, Load more and opening a result.

const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";
const GEN = "a".repeat(32);
const ME = "17841400000000001";
// The app's own font stylesheet is the only outside request it makes; it is aborted like everything else.
const FONTS = /^fonts\.(googleapis|gstatic)\.com\//;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const conv = (id: string, username?: string, pid = `p-${id}`) => ({
  id,
  updatedAt: "2026-10-17T08:00:00.000Z",
  participants: [{ id: ME, username: "3z.prod" }, username ? { id: pid, username } : { id: pid }],
});
const page1 = (items: unknown[], next: string | null = null, coverage = "end") => ({
  accountId: ME,
  generation: GEN,
  fetchedAt: new Date().toISOString(),
  items,
  next,
  coverage,
});

interface Fake {
  calls: string[];
  nonGet: string[];
  external: string[];
  conversations: (cursor: string | null) => unknown;
}

async function stub(page: Page): Promise<Fake> {
  const fake: Fake = {
    calls: [],
    nonGet: [],
    external: [],
    conversations: () => page1([]),
  };
  // Registered first, so the Worker route below (registered later) wins for scout.test.
  await page.route("**/*", (route: Route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost") return route.continue();
    fake.external.push(`${u.hostname}${u.pathname}`);
    return route.abort();
  });
  await page.route(`${WORKER}/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    fake.calls.push(`${req.method()} ${url.pathname}${url.search}`);
    if (req.method() !== "GET") fake.nonGet.push(`${req.method()} ${url.pathname}`);
    const reply = (status: number, body: unknown) =>
      route.fulfill({
        status,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/health")
      return reply(200, { ok: true, auth: true, social: { configured: {}, kv: true } });
    if (url.pathname === "/social/status") return reply(200, { platforms: {} });
    if (url.pathname === "/social/data")
      return reply(200, {
        accounts: [],
        snapshots: [],
        postStats: [],
        demographics: [],
        syncedAt: {},
      });
    if (url.pathname === "/social/inbox/account")
      return reply(200, {
        accountId: ME,
        handle: "3z.prod",
        generation: GEN,
        capabilities: { messages: "ok", comments: "ok" },
      });
    if (url.pathname === "/social/inbox/conversations")
      return reply(200, fake.conversations(url.searchParams.get("cursor")));
    if (url.pathname.endsWith("/messages")) return reply(200, page1([], null, "end"));
    return reply(404, { error: "not_found" });
  });
  return fake;
}

const SETTINGS = (lang: "ar" | "en") => ({
  settings: { lang, apiKeys: { scoutUrl: WORKER, scoutToken: TOKEN } },
});
const rows = (page: Page) => page.getByTestId("ibx-conv");
const inboxCalls = (fake: Fake) => fake.calls.filter((c) => c.includes("/social/inbox"));
const fits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("English: filter by name or id, no-match, Clear, keyboard, footer and requests", async ({
  page,
}) => {
  const fake = await stub(page);
  fake.conversations = (cursor) =>
    cursor
      ? page1([conv("c4", "fan_three"), conv("c5", "someone_else")])
      : page1(
          [conv("c1", "Fan_One"), conv("c2", "الزهراني"), conv("c3", undefined, "5550001")],
          "cur.2",
          "more",
        );
  await seedState(page, "/social/inbox/", SETTINGS("en"));
  await expect(rows(page)).toHaveCount(3);
  const before = inboxCalls(fake);
  expect(before.map((c) => c.split("?")[0])).toEqual([
    "GET /social/inbox/account",
    "GET /social/inbox/conversations",
  ]);

  const search = page.getByLabel("Find a conversation");
  await expect(search).toBeVisible();
  await expect(page.getByTestId("ibx-search-note")).toContainText("message text or older history");
  await expect(page.getByTestId("ibx-search-count")).toHaveText("Loaded conversations: 3");

  await search.fill("FAN_");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("ibx-search-count")).toHaveText("Matching: 1 of 3 loaded");
  await search.fill("555000");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-id", "c3");
  await search.fill("الزهراني");
  await expect(rows(page)).toHaveCount(1);
  await search.fill("3z.prod");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId("ibx-search-nomatch")).toBeVisible();
  await expect(page.getByTestId("ibx-empty")).toHaveCount(0);
  // The footer keeps the original coverage and Load more while nothing matches.
  await expect(page.getByTestId("ibx-footer")).toHaveAttribute("data-coverage", "more");
  await expect(page.getByTestId("ibx-more")).toBeVisible();

  await page.getByTestId("ibx-search-clear").click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(rows(page)).toHaveCount(3);
  expect(inboxCalls(fake)).toEqual(before); // search and Clear read nothing

  // Newly loaded rows join the filter; nothing loads by itself.
  await search.fill("fan");
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId("ibx-more").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId("ibx-search-count")).toHaveText("Matching: 2 of 5 loaded");
  await page.waitForTimeout(250);
  expect(inboxCalls(fake).length).toBe(before.length + 1);

  // Keyboard: the input, then the first result opens only on an explicit Enter; the focus ring is visible.
  await search.focus();
  await page.keyboard.press("Tab"); // Clear
  await expect(page.getByTestId("ibx-search-clear")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(rows(page).first()).toBeFocused();
  expect(inboxCalls(fake).filter((c) => c.includes("/messages"))).toEqual([]);
  await search.focus();
  const ring = await search.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(ring).not.toBe("none");
  await search.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ibx-conv-back")).toBeVisible();
  expect(inboxCalls(fake).filter((c) => c.includes("/messages"))).toHaveLength(1);

  expect(fake.nonGet).toEqual([]);
  expect(fake.external.filter((h) => !FONTS.test(h))).toEqual([]);
});

test("Arabic: RTL, Hijazi labels, Arabic names, fits the phone width", async ({ page }) => {
  const fake = await stub(page);
  fake.conversations = () =>
    page1([conv("c1", "محمد_العتيبي"), conv("c2", "sara.designs"), conv("c3", "أحمد")]);
  await seedState(page, "/social/inbox/", SETTINGS("ar"));
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const search = page.getByLabel("دوّر على محادثة");
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute("dir", "auto");
  await expect(page.getByTestId("ibx-search-note")).toContainText("نص الرسايل");
  expect(await fits(page)).toBe(true);

  const before = inboxCalls(fake).length;
  await search.fill("العتيبي");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("ibx-search-count")).toContainText("1");
  await search.fill("احمد"); // not folded onto the hamza form
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId("ibx-search-nomatch")).toBeVisible();
  expect(await fits(page)).toBe(true);
  await search.fill("SARA");
  await expect(rows(page)).toHaveCount(1);
  expect(await fits(page)).toBe(true);
  await page.getByTestId("ibx-search-clear").click();
  await expect(rows(page)).toHaveCount(3);
  expect(inboxCalls(fake)).toHaveLength(before);
  expect(fake.nonGet).toEqual([]);
  expect(fake.external.filter((h) => !FONTS.test(h))).toEqual([]);
});
