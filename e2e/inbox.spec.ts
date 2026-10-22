import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import { seedState } from "./helpers";

// 📥 Inbox (packet DT-6A) against a fake Scout Worker at https://scout.test (page.route, as autoreplies.spec.ts):
// every state, both directions and the placeholder kinds, two overlapping pages deduplicated, a failing second page
// kept as partial, a held account-A page dropped after account B, drafts that survive a reload, Copy, a backup
// without fetched bodies, and not one non-GET request to the Worker. Runs on the phone and desktop projects.

const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";
const CANARY = "CANARY-e2e-dm-5d1e";
const GEN_A = "a".repeat(32);
const GEN_B = "b".repeat(32);
const ACC_A = "17841400000000001";
const ACC_B = "17841400000000002";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  // POST for the reviewed YouTube send routes (DT-6B-2A); every other test still asserts no non-GET at all.
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Handler = (
  url: URL,
  body: Record<string, string>,
) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

interface Fake {
  routes: Record<string, Handler>;
  nonGet: string[];
  calls: string[];
}

const head = (acc = ACC_A, gen = GEN_A) => ({
  accountId: acc,
  generation: gen,
  fetchedAt: new Date().toISOString(),
});
const account = (acc = ACC_A, gen = GEN_A, caps = { messages: "ok", comments: "ok" }) => ({
  body: { accountId: acc, handle: "3z.prod", generation: gen, capabilities: caps },
});
const page1 = (
  items: unknown[],
  next: string | null = null,
  coverage = "end",
  acc = ACC_A,
  gen = GEN_A,
) => ({
  body: { ...head(acc, gen), items, next, coverage },
});
const conv = (id: string, name = `fan_${id}`) => ({
  id,
  updatedAt: "2026-10-17T08:00:00.000Z",
  participants: [
    { id: ACC_A, username: "3z.prod" },
    { id: `p-${id}`, username: name },
  ],
});
const msg = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  createdAt: "2026-10-17T07:00:00.000Z",
  direction: "in",
  from: { id: "p-c1", username: "fan_c1" },
  text: `text ${id}`,
  kind: "text",
  ...over,
});

async function stubWorker(page: Page): Promise<Fake> {
  const fake: Fake = {
    nonGet: [],
    calls: [],
    routes: {
      "/social/inbox/account": () => account(),
      "/social/inbox/conversations": () => page1([conv("c1"), conv("c2")]),
    },
  };
  await page.route(`${WORKER}/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    fake.calls.push(`${req.method()} ${url.pathname}`);
    if (req.method() !== "GET") fake.nonGet.push(`${req.method()} ${url.pathname}`);
    const reply = (status: number, body: unknown) =>
      route.fulfill({
        status,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (req.headers()["authorization"] !== `Bearer ${TOKEN}`)
      return reply(401, { error: "unauthorized" });
    // The shell's own reads (health, status) are answered plainly; the inbox has its own routes.
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
    const handler = fake.routes[url.pathname];
    if (!handler) return reply(404, { error: "not_found" });
    const out = await handler(url, JSON.parse(req.postData() || "{}"));
    return reply(out.status ?? 200, out.body);
  });
  return fake;
}

const SETTINGS = (lang: "ar" | "en" = "en") => ({
  settings: { lang, apiKeys: { scoutUrl: WORKER, scoutToken: TOKEN } },
});

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

test("without a Worker the inbox says so, links to the keys, and calls nothing", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await seedState(page, "/social/inbox/", { settings: { lang: "ar" } });
  await expect(page.locator("h1")).toHaveText("صندوق المحادثات");
  await expect(page.getByTestId("ibx-state")).toHaveAttribute("data-code", "unconfigured");
  await expect(page.getByTestId("ibx-state-link")).toHaveAttribute("href", "/settings/#api-keys");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await fitsViewport(page)).toBe(true);
  expect(fake.calls.filter((c) => c.includes("/social/inbox"))).toEqual([]);
});

for (const [code, status, link] of [
  ["not_connected", 409, "/settings/#accounts"],
  ["token_expired", 409, "/settings/#accounts"],
  ["rate_limited", 429, null],
  ["upstream", 502, null],
] as const) {
  test(`account state ${code} is actionable and never retried by itself`, async ({ page }) => {
    const fake = await stubWorker(page);
    fake.routes["/social/inbox/account"] = () => ({ status, body: { error: code } });
    await seedState(page, "/social/inbox/", SETTINGS());
    await expect(page.getByTestId("ibx-state")).toHaveAttribute("data-code", code);
    if (link) await expect(page.getByTestId("ibx-state-link")).toHaveAttribute("href", link);
    else await expect(page.getByTestId("ibx-state-link")).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(fake.calls.filter((c) => c.endsWith("/social/inbox/account"))).toHaveLength(1);
    expect(fake.nonGet).toEqual([]);
  });
}

test("a denied surface shows the reconnect step while the other tab works; restricted and empty are distinct", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.routes["/social/inbox/account"] = () =>
    account(ACC_A, GEN_A, { messages: "no_permission", comments: "ok" });
  fake.routes["/social/inbox/media"] = () => ({ status: 403, body: { error: "not_eligible" } });
  await seedState(page, "/social/inbox/", SETTINGS());
  await expect(page.getByTestId("ibx-state")).toHaveAttribute("data-code", "no_permission");
  await expect(page.getByTestId("ibx-state-link")).toHaveAttribute("href", "/settings/#accounts");
  await page.getByTestId("ibx-tab-comments").click();
  await expect(page.getByTestId("ibx-state")).toHaveAttribute("data-code", "not_eligible");
  fake.routes["/social/inbox/media"] = () => page1([]);
  await page.getByTestId("ibx-refresh").click();
  await expect(page.getByTestId("ibx-empty")).toHaveText("No posts.");
  expect(fake.calls.some((c) => c.endsWith("/social/inbox/conversations"))).toBe(false);
  expect(fake.nonGet).toEqual([]);
});

test("messages: both directions, every placeholder kind, overlap dedupe, partial second page, drafts, copy and a clean backup", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          (window as unknown as { __copied?: string }).__copied = t;
        },
      },
    });
  });
  let convPage = 0;
  fake.routes["/social/inbox/conversations"] = (url) => {
    convPage += 1;
    if (!url.searchParams.get("cursor")) return page1([conv("c1"), conv("c2")], "cur.one", "more");
    return page1([conv("c2"), conv("c3")]);
  };
  let msgPage = 0;
  fake.routes["/social/inbox/conversations/c1/messages"] = () => {
    msgPage += 1;
    if (msgPage > 1) return { status: 502, body: { error: "upstream", coverage: "partial" } };
    return page1(
      [
        msg("in1", { text: CANARY }),
        msg("out1", {
          direction: "out",
          from: { id: ACC_A, username: "3z.prod" },
          text: "my answer",
        }),
        msg("anon", { direction: "unknown", from: null, createdAt: null }),
        msg("reply", { kind: "story_reply", text: "nice story" }),
        msg("mention", { kind: "story_mention", text: "" }),
        msg("share", { kind: "share", text: "" }),
        msg("unsupported", { kind: "unsupported", text: "" }),
        msg("empty", { kind: "empty", text: "" }),
      ],
      "cur.m",
      "more",
    );
  };
  await seedState(page, "/social/inbox/", SETTINGS());
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("ibx-conv")).toHaveCount(2);
  await page.getByTestId("ibx-more").click();
  await expect(page.getByTestId("ibx-conv")).toHaveCount(3);
  expect(convPage).toBe(2);
  await expect(page.getByTestId("ibx-footer")).toHaveAttribute("data-coverage", "end");

  await page.getByTestId("ibx-conv").first().click();
  await expect(page.getByTestId("ibx-msg")).toHaveCount(8);
  const row = (id: string) => page.locator(`[data-testid="ibx-msg"][data-id="${id}"]`);
  await expect(row("in1").getByTestId("ibx-dir")).toHaveText("From them");
  await expect(row("out1").getByTestId("ibx-dir")).toHaveText("From you");
  await expect(row("anon").getByTestId("ibx-dir")).toHaveText("Unknown");
  await expect(row("anon")).toContainText("Unknown author");
  await expect(row("anon")).toContainText("Time unavailable");
  await expect(row("reply")).toContainText("Reply to your story");
  await expect(row("mention")).toContainText("Mentioned you in a story");
  await expect(row("share")).toContainText("Shared a post or attachment");
  await expect(row("unsupported")).toContainText("A message type Instagram doesn't share");
  await expect(row("empty")).toContainText("No text (maybe a photo or voice note)");
  expect(await fitsViewport(page)).toBe(true);

  await page.getByTestId("ibx-more").click();
  await expect(page.getByTestId("ibx-footer")).toHaveAttribute("data-coverage", "partial");
  await expect(page.getByTestId("ibx-msg")).toHaveCount(8);

  // Fetched bodies stay in memory: never in the persisted store.
  expect(await page.evaluate(() => localStorage.getItem("3z-prod-v1") ?? "")).not.toContain(CANARY);

  await page.getByTestId("ibx-draft-text").fill("Sent you the LUT link 🎬");
  await page.getByTestId("ibx-draft-save").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  await page.getByTestId("ibx-draft-copy").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "copied");
  expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(
    "Sent you the LUT link 🎬",
  );

  // A reload reads the inbox again; the draft comes back from this device.
  fake.routes["/social/inbox/conversations/c1/messages"] = () => page1([msg("in1")]);
  await page.reload();
  await page.getByTestId("ibx-conv").first().click();
  await expect(page.getByTestId("ibx-draft-text")).toHaveValue("Sent you the LUT link 🎬");

  // The backup holds the owner's draft, never a fetched message.
  await page.goto("/settings/");
  const download = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const text = await fs.readFile((await (await download).path())!, "utf-8");
  expect(text).not.toContain(CANARY);
  expect(text).toContain("Sent you the LUT link");
  expect(fake.nonGet).toEqual([]);
});

// DT-6A-R1 (6A-1): with the real shared Web Lock held, Discard waits; text typed meanwhile survives its completion and
// then saves against the refreshed (no draft) base.
test("a held Discard keeps the text typed after it, and that text saves", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.routes["/social/inbox/conversations/c1/messages"] = () => page1([msg("in1")]);
  await seedState(page, "/social/inbox/", SETTINGS());
  await page.getByTestId("ibx-conv").first().click();
  await page.getByTestId("ibx-draft-text").fill("old draft");
  await page.getByTestId("ibx-draft-save").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  await page.evaluate(
    () =>
      new Promise<void>((held) => {
        void navigator.locks.request(
          "3z-prod-articles",
          () =>
            new Promise<void>((release) => {
              (window as unknown as { __release?: () => void }).__release = release;
              held();
            }),
        );
      }),
  );
  await page.getByTestId("ibx-draft-discard").click();
  await page.getByTestId("ibx-draft-text").fill("New text typed after Discard");
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "discarded");
  await expect(page.getByTestId("ibx-draft-text")).toHaveValue("New text typed after Discard");
  await page.getByTestId("ibx-draft-save").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  const drafts = await page.evaluate(
    () => JSON.parse(localStorage.getItem("3z-prod-v1")!).state.inboxDrafts,
  );
  expect(Object.values(drafts).map((d) => (d as { text: string }).text)).toEqual([
    "New text typed after Discard",
  ]);
  expect(fake.nonGet).toEqual([]);
});

test("a held account-A page is dropped once account B is read", async ({ page }) => {
  const fake = await stubWorker(page);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  fake.routes["/social/inbox/conversations"] = async () => {
    await held;
    return page1([conv("a1", "from_account_a")]);
  };
  await seedState(page, "/social/inbox/", SETTINGS());
  await expect.poll(() => fake.calls.filter((c) => c.endsWith("/conversations")).length).toBe(1);
  fake.routes["/social/inbox/account"] = () => account(ACC_B, GEN_B);
  fake.routes["/social/inbox/conversations"] = () =>
    page1(
      [{ id: "b1", updatedAt: null, participants: [{ id: "x", username: "from_account_b" }] }],
      null,
      "end",
      ACC_B,
      GEN_B,
    );
  await page.getByTestId("ibx-refresh").click();
  await expect(page.getByTestId("ibx-conv")).toHaveCount(1);
  await expect(page.getByTestId("ibx-conv")).toContainText("from_account_b");
  release();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("ibx-conv")).toHaveCount(1);
  await expect(page.getByText("from_account_a")).toHaveCount(0);
  expect(fake.nonGet).toEqual([]);
});

test("comments: a validated Instagram link only, directions, and Arabic RTL without overflow", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.routes["/social/inbox/media"] = () =>
    page1([
      {
        id: "m1",
        caption: "LUT reel",
        permalink: "https://www.instagram.com/reel/ABC/",
        timestamp: "2026-10-10T10:00:00.000Z",
        commentsCount: 2,
      },
      { id: "m2", timestamp: null, commentsCount: 0 },
    ]);
  fake.routes["/social/inbox/media/m1/comments"] = () =>
    page1([
      {
        id: "k1",
        text: "حلو مرة",
        author: { id: "u1", username: "fan" },
        createdAt: null,
        direction: "in",
      },
      {
        id: "k2",
        text: "شكراً",
        author: { id: ACC_A, username: "3z.prod" },
        createdAt: null,
        direction: "out",
      },
    ]);
  await seedState(page, "/social/inbox/", SETTINGS("ar"));
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("ibx-tab-comments").click();
  await expect(page.getByTestId("ibx-post")).toHaveCount(2);
  await expect(page.getByTestId("ibx-post-link")).toHaveCount(1);
  await expect(page.getByTestId("ibx-post-link")).toHaveAttribute(
    "href",
    "https://www.instagram.com/reel/ABC/",
  );
  await page.getByTestId("ibx-post-open").first().click();
  await expect(page.getByTestId("ibx-comment")).toHaveCount(2);
  await expect(page.getByTestId("ibx-comment").first().getByTestId("ibx-dir")).toHaveText("منهم");
  await expect(page.getByTestId("ibx-comment").last().getByTestId("ibx-dir")).toHaveText("منك");
  await page.getByTestId("ibx-comment-draft").first().click();
  await expect(page.getByTestId("ibx-draft")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
  expect(fake.nonGet).toEqual([]);
});

test("phone reaches the Inbox from More; desktop from the Social sidebar", async ({
  page,
  isMobile,
}) => {
  await stubWorker(page);
  await seedState(page, "/social/more/", SETTINGS("ar"));
  if (isMobile) {
    await page.getByTestId("more-inbox").click();
  } else {
    await page.locator('nav a[href="/social/inbox/"]').first().click();
  }
  await expect(page.getByTestId("ibx-screen")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-world", "social");
});

// 📥 DT-6B-1: Threads and YouTube comment reads beside Instagram, against the same fake Worker.
const TGEN = "d".repeat(32);
const LEGACY_DRAFT = `${encodeURIComponent(WORKER)}|${ACC_A}|conversation|c1`;
const thHead = { provider: "threads", accountId: "25", generation: TGEN };
const ytHead = { provider: "youtube", accountId: "UCb", generation: TGEN };
const providerPage = (
  h: object,
  items: unknown[],
  next: string | null = null,
  coverage = "end",
) => ({
  body: { ...h, fetchedAt: new Date().toISOString(), items, next, coverage },
});

/** The current Worker's real shapes (DT-6B-2B-1): Threads also names send readiness and a direct reply's sendRef. */
function stubProviders(fake: Fake, replies = "ok") {
  fake.routes["/social/inbox/threads/account"] = () => ({
    body: {
      ...thHead,
      handle: "3z.prod",
      capabilities: { replies, sendReplies: "permission_unverified" },
    },
  });
  fake.routes["/social/inbox/threads/posts"] = () =>
    providerPage(thHead, [
      {
        id: "90001",
        ref: "ref-90001.s",
        text: "my thread",
        permalink: "https://www.threads.net/@3z.prod/post/90001",
        timestamp: "2026-10-16T08:00:00.000Z",
      },
    ]);
  fake.routes["/social/inbox/threads/posts/ref-90001.s/replies"] = () =>
    providerPage(thHead, [
      {
        id: "91001",
        text: CANARY,
        author: { username: "fan_one" },
        createdAt: null,
        direction: "in",
        kind: "text",
        rootId: "90001",
        parentId: "90001",
        sendRef: "send-91001.s",
      },
      {
        id: "91002",
        text: "",
        author: null,
        createdAt: null,
        direction: "unknown",
        kind: "media",
        rootId: "90001",
        parentId: "91001",
      },
    ]);
  fake.routes["/social/inbox/youtube/account"] = () => ({
    body: {
      provider: "youtube",
      needsSelection: true,
      channels: [
        { accountId: "UCa", title: "First channel", generation: TGEN, uploads: "up-a.s" },
        { accountId: "UCb", title: "Second channel", generation: TGEN, uploads: "up-b.s" },
      ],
      capabilities: { comments: "ok" },
    },
  });
  fake.routes["/social/inbox/youtube/videos"] = () =>
    providerPage(ytHead, [
      {
        id: "vid1",
        ref: "vref-1.s",
        title: "My video",
        permalink: "https://www.youtube.com/watch?v=vid1",
        timestamp: null,
      },
    ]);
  const ytc = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    text: `yt ${id}`,
    author: { id: "UCfan", username: "fan_two" },
    createdAt: null,
    direction: "in",
    ...over,
  });
  fake.routes["/social/inbox/youtube/videos/vref-1.s/threads"] = () =>
    providerPage(ytHead, [
      {
        id: "Ug1",
        ref: "cref-1.s",
        comment: ytc("Ug1"),
        totalReplyCount: 3,
        replies: [ytc("Ug1.r1", { parentId: "Ug1", direction: "out" })],
        repliesCoverage: "embedded",
      },
    ]);
  fake.routes["/social/inbox/youtube/comments/cref-1.s/replies"] = () =>
    providerPage(ytHead, [
      ytc("Ug1.r1", { parentId: "Ug1", direction: "out" }),
      ytc("Ug1.r2", { parentId: "Ug1" }),
    ]);
}

test("Threads and YouTube: posts → replies, channel pick → videos → threads → Load replies, drafts per provider, Instagram draft intact", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  const legacy = {
    text: "old instagram draft",
    updatedAt: "2026-10-16T08:00:00.000Z",
    commitId: "c-legacy",
  };
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxDrafts: { [LEGACY_DRAFT]: legacy },
  });
  await expect(page.getByTestId("ibx-conv")).toHaveCount(2);

  await page.getByTestId("ibx-provider-threads").click();
  await expect(page.getByTestId("ibx-th-post")).toHaveCount(1);
  await expect(page.getByTestId("ibx-th-post-link")).toHaveAttribute(
    "href",
    "https://www.threads.net/@3z.prod/post/90001",
  );
  await page.getByTestId("ibx-th-post-open").click();
  await expect(page.getByTestId("ibx-th-reply")).toHaveCount(2);
  const second = page.locator('[data-testid="ibx-th-reply"][data-id="91002"]');
  await expect(second).toContainText("Media reply");
  await expect(second.getByTestId("ibx-th-nested")).toBeVisible();
  await page.getByTestId("ibx-reply-draft").first().click();
  await page.getByTestId("ibx-draft-text").fill("Thanks on Threads");
  await page.getByTestId("ibx-draft-save").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  // The carried Threads sendRef opens no send control in this round (DT-6B-2B-2 owns it).
  await expect(page.getByTestId("ibx-send-open")).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);

  await page.getByTestId("ibx-provider-youtube").click();
  await expect(page.getByTestId("ibx-yt-channel")).toHaveCount(2);
  expect(fake.calls.some((c) => c.endsWith("/youtube/videos"))).toBe(false);
  await page.getByTestId("ibx-yt-channel").nth(1).click();
  await expect(page.getByTestId("ibx-yt-video")).toHaveCount(1);
  await page.getByTestId("ibx-yt-video-open").click();
  await expect(page.getByTestId("ibx-yt-subset")).toHaveText("Showing 1 of 3 replies");
  await page.getByTestId("ibx-yt-load-replies").click();
  await expect(page.getByTestId("ibx-yt-reply")).toHaveCount(2);
  await page.getByTestId("ibx-yt-draft").first().click();
  await page.getByTestId("ibx-draft-text").fill("Thanks on YouTube");
  await page.getByTestId("ibx-draft-save").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  expect(await fitsViewport(page)).toBe(true);

  const stored = async () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state ?? {});
  const drafts = (await stored()).inboxDrafts as Record<string, { text: string }>;
  expect(drafts[LEGACY_DRAFT]).toEqual(legacy);
  expect(drafts["v2|threads|https%3A%2F%2Fscout.test|25|comment|91001"].text).toBe(
    "Thanks on Threads",
  );
  expect(drafts["v2|youtube|https%3A%2F%2Fscout.test|UCb|comment|Ug1"].text).toBe(
    "Thanks on YouTube",
  );
  expect(JSON.stringify(await stored())).not.toContain(CANARY);

  // After a reload each provider's draft comes back from this device, and Instagram's old draft still opens.
  await page.reload();
  await expect(page.getByTestId("ibx-conv")).toHaveCount(2);
  await page.getByTestId("ibx-conv").first().click();
  await expect(page.getByTestId("ibx-draft-text")).toHaveValue("old instagram draft");
  await page.getByTestId("ibx-provider-threads").click();
  await page.getByTestId("ibx-th-post-open").click();
  await page.getByTestId("ibx-reply-draft").first().click();
  await expect(page.getByTestId("ibx-draft-text")).toHaveValue("Thanks on Threads");
  expect(fake.nonGet).toEqual([]);
});

test("Arabic: Threads without the replies permission says so plainly, YouTube asks for a channel, no overflow", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake, "no_permission");
  await seedState(page, "/social/inbox/", SETTINGS("ar"));
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("ibx-provider-threads").click();
  await page.getByTestId("ibx-th-post-open").click();
  await expect(page.getByTestId("ibx-state")).toHaveAttribute("data-code", "no_permission");
  await expect(page.getByTestId("ibx-state")).toContainText("threads_read_replies");
  await expect(page.getByTestId("ibx-state-link")).toHaveCount(0);
  expect(fake.calls.some((c) => c.endsWith("/replies"))).toBe(false);
  expect(await fitsViewport(page)).toBe(true);
  await page.getByTestId("ibx-provider-youtube").click();
  await expect(page.getByTestId("ibx-yt-channel")).toHaveCount(2);
  await expect(page.getByTestId("ibx-coverage-note")).toContainText("فيديوهات قناتك");
  expect(await fitsViewport(page)).toBe(true);
  expect(fake.nonGet).toEqual([]);
});

test("DT-6B-1-R1: capped YouTube replies keep their own coverage note; an unknown total still offers Load replies", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  const ytc = (id: string) => ({
    id,
    text: `yt ${id}`,
    author: null,
    createdAt: null,
    direction: "in",
    parentId: "Ug1",
  });
  fake.routes["/social/inbox/youtube/videos/vref-1.s/threads"] = () =>
    providerPage(ytHead, [
      {
        id: "Ug1",
        ref: "cref-1.s",
        comment: { ...ytc("Ug1"), parentId: undefined },
        totalReplyCount: 4,
        replies: [ytc("Ug1.r1")],
        repliesCoverage: "embedded",
      },
      {
        id: "Ug2",
        ref: "cref-2.s",
        comment: { ...ytc("Ug2"), parentId: undefined },
        totalReplyCount: null,
        replies: [],
        repliesCoverage: "embedded",
      },
    ]);
  fake.routes["/social/inbox/youtube/comments/cref-1.s/replies"] = () =>
    providerPage(ytHead, [ytc("Ug1.r1"), ytc("Ug1.r2")], null, "cap");
  await seedState(page, "/social/inbox/", SETTINGS());
  await page.getByTestId("ibx-provider-youtube").click();
  await page.getByTestId("ibx-yt-channel").nth(1).click();
  await page.getByTestId("ibx-yt-video-open").click();
  const first = page.locator('[data-testid="ibx-yt-thread"][data-id="Ug1"]');
  const second = page.locator('[data-testid="ibx-yt-thread"][data-id="Ug2"]');
  await expect(second.getByTestId("ibx-yt-load-replies")).toHaveText("Load replies");
  await first.getByTestId("ibx-yt-load-replies").click();
  await expect(first.getByTestId("ibx-yt-reply")).toHaveCount(2);
  await expect(first.getByTestId("ibx-yt-replies-footer")).toHaveAttribute("data-coverage", "cap");
  await expect(first.getByTestId("ibx-yt-replies-footer")).toHaveText(
    "Stopped at the local limit; there may be more.",
  );
  await expect(first.getByTestId("ibx-yt-load-replies")).toHaveCount(0);
  await expect(page.getByTestId("ibx-footer").last()).toContainText(
    "replies load under each comment",
  );
  expect(await fitsViewport(page)).toBe(true);
  expect(fake.nonGet).toEqual([]);
});

// DT-6B-1-R2 (B1-R1-A, Codex's REFRESH-REPORT reproduction): a second Refresh accepted while the first one's selected
// video threads are held asks again; the held old answer never replaces the fresh embedded reply.
test("DT-6B-1-R2: a second Refresh supersedes a held first one; the fresh embedded reply stays", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  const THREADS = "/social/inbox/youtube/videos/vref-1.s/threads";
  const embedded = (text: string) =>
    providerPage(ytHead, [
      {
        id: "Ug1",
        ref: "cref-1.s",
        comment: { id: "Ug1", text: "yt Ug1", author: null, createdAt: null, direction: "in" },
        totalReplyCount: 1,
        replies: [
          {
            id: "Ug1.r1",
            text,
            author: null,
            createdAt: null,
            direction: "in",
            parentId: "Ug1",
          },
        ],
        repliesCoverage: "embedded",
      },
    ]);
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let n = 0;
  fake.routes[THREADS] = async () => {
    n += 1;
    if (n === 1) return embedded("initial embedded reply");
    if (n === 2) {
      await hold;
      return embedded("obsolete embedded reply");
    }
    return embedded("fresh embedded reply");
  };
  const threadReads = () => fake.calls.filter((c) => c === `GET ${THREADS}`).length;
  await seedState(page, "/social/inbox/", SETTINGS());
  await page.getByTestId("ibx-provider-youtube").click();
  await page.getByTestId("ibx-yt-channel").nth(1).click();
  await page.getByTestId("ibx-yt-video-open").click();
  const reply = page
    .locator('[data-testid="ibx-yt-thread"][data-id="Ug1"]')
    .getByTestId("ibx-yt-reply");
  await expect(reply).toContainText("initial embedded reply");
  await page.getByTestId("ibx-refresh").click();
  await expect.poll(threadReads).toBe(2);
  await expect(page.getByTestId("ibx-refresh")).toBeEnabled();
  await page.getByTestId("ibx-refresh").click();
  await expect.poll(threadReads).toBe(3);
  await expect(reply).toContainText("fresh embedded reply");
  const settled = page.waitForResponse((r) => new URL(r.url()).pathname === THREADS);
  release();
  await settled;
  await page.waitForTimeout(300);
  await expect(reply).toContainText("fresh embedded reply");
  await expect(reply).not.toContainText("obsolete");
  await expect(page.getByTestId("ibx-refresh")).toBeEnabled();
  expect(threadReads()).toBe(3);
  expect(fake.nonGet).toEqual([]);
});

// 📤 DT-6B-2A (planning/tools/37-inbox-send.md): a reviewed YouTube public reply against the fake Worker. Prepare →
// review (account, destination, exact text) → Send → the receipt link; an unknown outcome offers Check status and never
// a Resend; a reload reads the same operation back; Threads and Instagram drafts offer no sending.
// DT-6B-2A-R1 (2A-4): the client now trusts only an answer about the operation it asked for, so the fake Worker answers
// as the real one does: the digest of the exact text and the draft revision it was given.
const SEND = "/social/inbox/youtube/send";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const sendIntent = (
  operationId: string,
  text: string,
  state: string,
  over: Record<string, unknown> = {},
) => ({
  operationId,
  provider: "youtube",
  account: "UCb",
  generation: TGEN,
  threadId: "UgThreadX",
  videoId: "vid1",
  parentCommentId: "Ug1",
  text,
  digest: sha256(text),
  draftRevision: "rev",
  state,
  reviewExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

function stubSending(fake: Fake, confirmState: "sent" | "unknown") {
  stubProviders(fake);
  const yt = fake.routes["/social/inbox/youtube/account"];
  fake.routes["/social/inbox/youtube/account"] = (u, b) => {
    const out = yt(u, b) as { body: { capabilities: Record<string, string> } };
    out.body.capabilities.sendComments = "ok";
    return out;
  };
  const threads = fake.routes["/social/inbox/youtube/videos/vref-1.s/threads"];
  fake.routes["/social/inbox/youtube/videos/vref-1.s/threads"] = async (u, b) => {
    const out = (await threads(u, b)) as {
      body: {
        items: { sendRef?: string; replies: { sendRef?: string; replyParentNote?: boolean }[] }[];
      };
    };
    for (const th of out.body.items) {
      th.sendRef = "send-ug1.s";
      for (const r of th.replies)
        Object.assign(r, { sendRef: "send-ug1.s", replyParentNote: true });
    }
    return out;
  };
  const ops = new Map<string, { text: string; state: string; draftRevision: string }>();
  fake.routes[`${SEND}/prepare`] = (_u, b) => {
    const draftRevision = b.draftRevision;
    ops.set(b.operationId, { text: b.text.trim(), state: "prepared", draftRevision });
    return {
      body: { intent: sendIntent(b.operationId, b.text.trim(), "prepared", { draftRevision }) },
    };
  };
  fake.routes[`${SEND}/confirm`] = (_u, b) => {
    const op = ops.get(b.operationId)!;
    op.state = confirmState;
    return {
      body: {
        intent: sendIntent(b.operationId, op.text, confirmState, {
          draftRevision: op.draftRevision,
          ...(confirmState === "sent"
            ? { providerCommentId: "Ug1.reply9" }
            : { unknownReason: "timeout" }),
        }),
      },
    };
  };
  return ops;
}

async function openYouTubeDraft(page: Page, text: string) {
  await page.getByTestId("ibx-provider-youtube").click();
  await page.getByTestId("ibx-yt-channel").nth(1).click();
  await page.getByTestId("ibx-yt-video-open").click();
  await page.getByTestId("ibx-yt-draft").first().click();
  if (text) {
    await page.getByTestId("ibx-draft-text").fill(text);
    await page.getByTestId("ibx-draft-save").click();
    await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  }
}

test("DT-6B-2A: review the exact text, Send once, and see the receipt link; nothing posts before Send", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubSending(fake, "sent");
  await seedState(page, "/social/inbox/", SETTINGS());
  await openYouTubeDraft(page, "  Thanks for watching!  ");
  await page.getByTestId("ibx-send-open").click();
  const sheet = page.getByTestId("ibx-send-sheet");
  await expect(sheet).toHaveAttribute("data-phase", "review");
  await expect(page.getByTestId("ibx-send-text")).toHaveText("Thanks for watching!");
  await expect(page.getByTestId("ibx-send-account")).toHaveText("Second channel");
  await expect(page.getByTestId("ibx-send-where")).toHaveText(
    "A public reply under fan_two's comment on “My video”.",
  );
  expect(fake.nonGet).toEqual([`POST ${SEND}/prepare`]);
  expect(await fitsViewport(page)).toBe(true);
  await page.getByTestId("ibx-send-confirm").click();
  await expect(sheet).toHaveAttribute("data-phase", "sent");
  await expect(page.getByTestId("ibx-send-link")).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=vid1&lc=Ug1.reply9",
  );
  expect(fake.nonGet).toEqual([`POST ${SEND}/prepare`, `POST ${SEND}/confirm`]);
  // The handle never holds the reply text.
  const ops = await page.evaluate(
    () => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state?.inboxSendOps ?? {},
  );
  expect(Object.keys(ops)).toHaveLength(1);
  expect(JSON.stringify(ops)).not.toContain("Thanks for watching");
  await page.getByTestId("ibx-send-keep").click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("ibx-draft-text")).toHaveValue("  Thanks for watching!  ");
});

test("DT-6B-2A: an unknown outcome offers Check status only, and survives a reload as the same operation", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  const ops = stubSending(fake, "unknown");
  let statusReads = 0;
  await seedState(page, "/social/inbox/", SETTINGS());
  await openYouTubeDraft(page, "Thanks!");
  await page.getByTestId("ibx-send-open").click();
  await page.getByTestId("ibx-send-confirm").click();
  const sheet = page.getByTestId("ibx-send-sheet");
  await expect(sheet).toHaveAttribute("data-phase", "unknown");
  await expect(sheet).toContainText("it may still have posted");
  await expect(page.getByTestId("ibx-send-check")).toBeVisible();
  await expect(page.getByTestId("ibx-send-confirm")).toHaveCount(0);
  await expect(page.getByTestId("ibx-send-again")).toHaveCount(0);
  const [operationId] = [...ops.keys()];
  fake.routes[`${SEND}/${operationId}`] = () => {
    statusReads += 1;
    return {
      body: {
        intent: sendIntent(operationId, "Thanks!", "unknown", {
          unknownReason: "timeout",
          draftRevision: ops.get(operationId)!.draftRevision,
        }),
      },
    };
  };
  await page.getByTestId("ibx-send-close").click();

  await page.reload();
  await openYouTubeDraft(page, "");
  await expect(page.getByTestId("ibx-send-status")).toHaveAttribute("data-state", "unknown");
  await page.getByTestId("ibx-send-open").click();
  await expect(sheet).toHaveAttribute("data-phase", "unknown");
  await page.getByTestId("ibx-send-check").click();
  await expect.poll(() => statusReads).toBe(2);
  // Only one prepare and one confirm ever: reopening and Check status read the same operation.
  expect(fake.nonGet).toEqual([`POST ${SEND}/prepare`, `POST ${SEND}/confirm`]);
});

test("DT-6B-2A Arabic phone: a nested reply's review names the top-level parent and fits; Threads offers no Send", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubSending(fake, "sent");
  await seedState(page, "/social/inbox/", SETTINGS("ar"));
  await page.getByTestId("ibx-provider-youtube").click();
  await page.getByTestId("ibx-yt-channel").nth(1).click();
  await page.getByTestId("ibx-yt-video-open").click();
  await page.getByTestId("ibx-yt-reply").first().getByTestId("ibx-yt-draft").click();
  await page.getByTestId("ibx-draft-text").fill("شكراً لك");
  await page.getByTestId("ibx-draft-save").click();
  await page.getByTestId("ibx-send-open").click();
  await expect(page.getByTestId("ibx-send-sheet")).toHaveAttribute("data-phase", "review");
  await expect(page.getByTestId("ibx-send-where")).toContainText("التعليق الرئيسي");
  await expect(page.getByTestId("ibx-send-text")).toHaveText("شكراً لك");
  expect(await fitsViewport(page)).toBe(true);
  await page.getByTestId("ibx-send-cancel").click();
  await expect(page.getByTestId("ibx-send-sheet")).toHaveCount(0);
  await page.getByTestId("ibx-provider-threads").click();
  await page.getByTestId("ibx-th-post-open").click();
  await page.getByTestId("ibx-reply-draft").first().click();
  await expect(page.getByTestId("ibx-send-open")).toHaveCount(0);
  expect(fake.nonGet.filter((c) => c.endsWith("/confirm"))).toEqual([]);
});

// DT-6B-2A-R1 (Codex 2A-7, 2A-8, 2A-9 in the real app): an uncertain send is recovered from its stored handle alone
// (after the draft was discarded, and after a failed lookup), the review names the exact receiving comment, and Clear
// draft empties the same editor so a new reply saves.
test("DT-6B-2A-R1: an uncertain send recovers without its draft and after a failed lookup; nothing resends", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  const ops = stubSending(fake, "unknown");
  await seedState(page, "/social/inbox/", SETTINGS());
  await openYouTubeDraft(page, "Thanks!");
  await page.getByTestId("ibx-send-open").click();
  await page.getByTestId("ibx-send-confirm").click();
  const sheet = page.getByTestId("ibx-send-sheet");
  await expect(sheet).toHaveAttribute("data-phase", "unknown");
  const [operationId] = [...ops.keys()];
  let lookups = 0;
  let failing = false;
  fake.routes[`${SEND}/${operationId}`] = () => {
    lookups += 1;
    return failing
      ? { status: 503, body: { error: "receipt_unavailable" } }
      : {
          body: {
            intent: sendIntent(operationId, "Thanks!", "unknown", {
              unknownReason: "timeout",
              draftRevision: ops.get(operationId)!.draftRevision,
            }),
          },
        };
  };
  await page.getByTestId("ibx-send-close").click();
  await page.getByTestId("ibx-draft-discard").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "discarded");

  // No saved draft any more: the handle alone reads the same operation back.
  await page.reload();
  await openYouTubeDraft(page, "");
  await expect(page.getByTestId("ibx-send-open")).toBeEnabled();
  await page.getByTestId("ibx-send-open").click();
  await expect(sheet).toHaveAttribute("data-phase", "unknown");
  await expect(page.getByTestId("ibx-send-check")).toBeEnabled();
  expect(lookups).toBe(1);
  await page.getByTestId("ibx-send-close").click();

  // The lookup fails: still honest uncertainty with an enabled Check status, never "checking" forever.
  failing = true;
  await page.reload();
  await openYouTubeDraft(page, "");
  await page.getByTestId("ibx-send-open").click();
  await expect(sheet).toHaveAttribute("data-phase", "unknown");
  await expect(sheet).toContainText("it may still have posted");
  await expect(page.getByTestId("ibx-send-why")).toContainText("Couldn't reach the Worker");
  await expect(page.getByTestId("ibx-send-check")).toBeEnabled();
  failing = false;
  await page.getByTestId("ibx-send-check").click();
  await expect.poll(() => lookups).toBe(3);
  await expect(page.getByTestId("ibx-send-why")).toContainText("longer than 15 seconds");
  expect(fake.nonGet).toEqual([`POST ${SEND}/prepare`, `POST ${SEND}/confirm`]);
});

test("DT-6B-2A-R1: the review shows the receiving comment; Clear draft empties the editor and a new reply saves", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubSending(fake, "sent");
  await seedState(page, "/social/inbox/", SETTINGS());
  await openYouTubeDraft(page, "Thanks for watching!");
  await page.getByTestId("ibx-send-open").click();
  await expect(page.getByTestId("ibx-send-sheet")).toHaveAttribute("data-phase", "review");
  await expect(page.getByTestId("ibx-send-parent-text")).toHaveText("yt Ug1");
  await expect(page.getByTestId("ibx-send-parent-id")).toContainText("Ug1");
  await expect(page.getByTestId("ibx-send-parent-link")).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=vid1&lc=Ug1",
  );
  expect(await fitsViewport(page)).toBe(true);
  await page.getByTestId("ibx-send-confirm").click();
  await expect(page.getByTestId("ibx-send-sheet")).toHaveAttribute("data-phase", "sent");
  await page.getByTestId("ibx-send-clear").click();
  await expect(page.getByTestId("ibx-send-sheet")).toHaveCount(0);
  await expect(page.getByTestId("ibx-draft-text")).toHaveValue("");
  await page.getByTestId("ibx-draft-text").fill("A new reply after clearing");
  await page.getByTestId("ibx-draft-save").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  const drafts = await page.evaluate(
    () => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state?.inboxDrafts ?? {},
  );
  expect(Object.values(drafts).map((d) => (d as { text: string }).text)).toEqual([
    "A new reply after clearing",
  ]);
  // The fetched parent text never reaches storage.
  expect(await page.evaluate(() => localStorage.getItem("3z-prod-v1") ?? "")).not.toContain(
    "yt Ug1",
  );
  expect(fake.nonGet).toEqual([`POST ${SEND}/prepare`, `POST ${SEND}/confirm`]);
});

// DT-6B-2A-R2 (Codex 2A-R1-A and 2A-R1-D in the real app): leaving YouTube while Prepare waits for its handle write sends
// nothing, even after coming back; and an uncertain send stays recoverable (status only) after the connection loses
// its send permission.
test("DT-6B-2A-R2: leaving YouTube (and coming back) while Prepare waits for storage sends nothing", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubSending(fake, "sent");
  await seedState(page, "/social/inbox/", SETTINGS());
  await openYouTubeDraft(page, "Thanks!");
  await page.evaluate(
    () =>
      new Promise<void>((held) => {
        void navigator.locks.request(
          "3z-prod-articles",
          () =>
            new Promise<void>((release) => {
              (window as unknown as { __release?: () => void }).__release = release;
              held();
            }),
        );
      }),
  );
  await page.getByTestId("ibx-send-open").click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.locks.query()).pending?.filter((l) => l.name === "3z-prod-articles")
            .length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  // The sheet still says "checking"; the owner closes it and leaves YouTube, then comes back.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ibx-send-sheet")).toHaveCount(0);
  await page.getByTestId("ibx-provider-instagram").click();
  await page.getByTestId("ibx-provider-youtube").click();
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          ((await navigator.locks.query()).held ?? []).length +
          ((await navigator.locks.query()).pending ?? []).length,
      ),
    )
    .toBe(0);
  const ops = await page.evaluate(
    () => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state?.inboxSendOps ?? {},
  );
  expect(ops).toEqual({});
  expect(fake.nonGet).toEqual([]);
});

test("DT-6B-2A-R2: after the send permission is lost, an uncertain send still opens to Check status only", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  const ops = stubSending(fake, "unknown");
  await seedState(page, "/social/inbox/", SETTINGS());
  await openYouTubeDraft(page, "Thanks!");
  await page.getByTestId("ibx-send-open").click();
  await page.getByTestId("ibx-send-confirm").click();
  const sheet = page.getByTestId("ibx-send-sheet");
  await expect(sheet).toHaveAttribute("data-phase", "unknown");
  await page.getByTestId("ibx-send-close").click();
  const [operationId] = [...ops.keys()];
  let lookups = 0;
  fake.routes[`${SEND}/${operationId}`] = () => {
    lookups += 1;
    return {
      body: {
        intent: sendIntent(operationId, "Thanks!", "sent", {
          providerCommentId: "Ug1.reply9",
          draftRevision: ops.get(operationId)!.draftRevision,
        }),
      },
    };
  };
  // Same account and readable comments, but the connection can no longer post.
  const yt = fake.routes["/social/inbox/youtube/account"];
  fake.routes["/social/inbox/youtube/account"] = async (u, b) => {
    const out = (await yt(u, b)) as { body: { capabilities: Record<string, string> } };
    out.body.capabilities.sendComments = "no_permission";
    return out;
  };

  await page.reload();
  await openYouTubeDraft(page, "");
  await expect(page.getByTestId("ibx-send-note")).toContainText("youtube.force-ssl");
  await expect(page.getByTestId("ibx-send-recover-note")).toContainText(
    "check the reply you sent earlier",
  );
  const open = page.getByTestId("ibx-send-open");
  await expect(open).toBeEnabled();
  await expect(open).toHaveText("Check status");
  expect(lookups).toBe(0);
  await open.click();
  await expect(sheet).toHaveAttribute("data-phase", "sent");
  await expect(page.getByTestId("ibx-send-link")).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=vid1&lc=Ug1.reply9",
  );
  expect(lookups).toBe(1);
  expect(fake.calls.filter((c) => c === `GET ${SEND}/${operationId}`)).toHaveLength(1);
  expect(await fitsViewport(page)).toBe(true);
  // Recovery never prepared or confirmed anything new.
  expect(fake.nonGet).toEqual([`POST ${SEND}/prepare`, `POST ${SEND}/confirm`]);
});

// 📤 DT-6B-2B-2 (planning/tools/37-inbox-send.md): Threads review/recovery against the current Worker's real wire shape
// (`capabilities.sendReplies: "permission_unverified"`, a direct reply's `sendRef`). Production readiness is closed: the
// draft box says why "Send as reply" is unavailable and nothing is prepared. A retained operation from an earlier session
// survives a reload and is checked from its handle alone (no row opened, no draft): exactly one status GET.
const TH_SEND = "/social/inbox/threads/send";
const TH_OP = "op-th-retained-0001";
const TH_TEXT = "Thanks on Threads";
const TH_SCOPE = "v2|threads|https%3A%2F%2Fscout.test|25|comment|91001";
/** The Worker's receipt of a publish whose answer was lost (threadsSendCoordinator.ts intentOf). */
const thUnknownPublication = () => ({
  operationId: TH_OP,
  provider: "threads",
  account: "25",
  generation: TGEN,
  rootPostId: "90001",
  replyToId: "91001",
  text: TH_TEXT,
  digest: sha256(TH_TEXT),
  draftRevision: "rev-th-1",
  state: "unknown_publication",
  reviewExpiresAt: "2026-10-17T09:10:00.000Z",
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:03.000Z",
  createClaimedAt: "2026-10-17T09:00:01.000Z",
  containerId: "17800000000000001",
  containerRecordedAt: "2026-10-17T09:00:02.000Z",
  publishClaimedAt: "2026-10-17T09:00:02.000Z",
  unknownReason: "timeout",
  receiptVersion: 5,
});
const thHandle = {
  [TH_SCOPE]: {
    operationId: TH_OP,
    account: "25",
    draftRevision: "rev-th-1",
    digest: sha256(TH_TEXT),
    state: "unknown_publication",
    receiptVersion: 5,
    containerId: "17800000000000001",
    updatedAt: "2026-10-17T09:00:04.000Z",
    commitId: "c-th-1",
  },
};

test("DT-6B-2B-2: production Threads says why Send as reply is unavailable and prepares nothing", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  await seedState(page, "/social/inbox/", SETTINGS());
  await page.getByTestId("ibx-provider-threads").click();
  await page.getByTestId("ibx-th-post-open").click();
  await page.getByTestId("ibx-reply-draft").first().click();
  await page.getByTestId("ibx-draft-text").fill(TH_TEXT);
  await page.getByTestId("ibx-draft-save").click();
  await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("ibx-ths-open")).toBeDisabled();
  await expect(page.getByTestId("ibx-ths-open")).toHaveText("Send as reply");
  await expect(page.getByTestId("ibx-ths-unavailable")).toContainText("isn't verified yet");
  await expect(page.getByTestId("ibx-ths-check")).toHaveCount(0);
  await expect(page.getByTestId("ibx-ths-recovery")).toHaveCount(0);
  // The YouTube opener never appears for Threads.
  await expect(page.getByTestId("ibx-send-open")).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
  expect(fake.nonGet).toEqual([]);
  expect(fake.calls.some((c) => c.includes(TH_SEND))).toBe(false);
});

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2B-2 (${lang}): a retained unknown_publication survives a reload and Check status asks once`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubProviders(fake);
    let statusReads = 0;
    fake.routes[`${TH_SEND}/${TH_OP}`] = (u) => {
      statusReads += 1;
      expect(u.searchParams.get("account")).toBe("25");
      return { body: { intent: thUnknownPublication() } };
    };
    await seedState(page, "/social/inbox/", { ...SETTINGS(lang), inboxThreadsSendOps: thHandle });
    await page.reload();
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByTestId("ibx-provider-threads").click();
    const item = page.getByTestId("ibx-ths-recovery-item");
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId("ibx-ths-status")).toHaveAttribute(
      "data-state",
      "unknown_publication",
    );
    // Recovery offers status only: no Send as reply without a row.
    await expect(item.getByTestId("ibx-ths-open")).toHaveCount(0);
    expect(statusReads).toBe(0);
    await item.getByTestId("ibx-ths-check").click();
    const sheet = page.getByTestId("ibx-ths-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "unknown_publication");
    await expect(sheet).toContainText(
      lang === "ar" ? "يمكن يكون انتشر" : "it may have been published",
    );
    await expect(page.getByTestId("ibx-ths-reply-id")).toContainText("91001");
    await expect(page.getByTestId("ibx-ths-root-link")).toHaveAttribute(
      "href",
      "https://www.threads.net/@3z.prod/post/90001",
    );
    await expect(page.getByTestId("ibx-ths-sheet-check")).toBeVisible();
    await expect(page.getByTestId("ibx-ths-confirm")).toHaveCount(0);
    await expect(page.getByTestId("ibx-ths-resume")).toHaveCount(0);
    expect(statusReads).toBe(1);
    expect(fake.calls.filter((c) => c === `GET ${TH_SEND}/${TH_OP}`)).toHaveLength(1);
    expect(await fitsViewport(page)).toBe(true);
    expect(fake.nonGet).toEqual([]);
    // The handle stays (still unresolved) and never holds the reply text.
    const ops = await page.evaluate(
      () => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state?.inboxThreadsSendOps ?? {},
    );
    expect(Object.keys(ops)).toEqual([TH_SCOPE]);
    expect(JSON.stringify(ops)).not.toContain(TH_TEXT);
  });

// 📤 DT-6B-2B-2-R1: handle-only recovery without a matching account answer (same Worker), another Worker's handle named
// and never asked, Clear draft from the recovery list keeping the open editor usable, manual Check status in a retained
// review (closing it never cancels), and one automatic lookup when the device clock is past the review deadline.
/** A Worker receipt of the retained operation in `state` (threadsSendCoordinator.ts intentOf shape). */
const thReceipt = (state: string, over: Record<string, unknown> = {}) => ({
  operationId: TH_OP,
  provider: "threads",
  account: "25",
  generation: TGEN,
  rootPostId: "90001",
  replyToId: "91001",
  text: TH_TEXT,
  digest: sha256(TH_TEXT),
  draftRevision: "rev-th-1",
  state,
  reviewExpiresAt: "2050-10-17T09:10:00.000Z",
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:03.000Z",
  receiptVersion: { prepared: 1, unknown_publication: 5, published: 6 }[state] ?? 1,
  ...(state === "prepared" ? {} : { containerId: "17800000000000001" }),
  ...(state === "unknown_publication" ? { unknownReason: "timeout" } : {}),
  ...(state === "published" ? { publishedId: "17899999999999999" } : {}),
  ...over,
});
const thOp = (state: string, scope = TH_SCOPE) => {
  const i = thReceipt(state);
  return {
    [scope]: {
      operationId: TH_OP,
      account: "25",
      draftRevision: "rev-th-1",
      digest: sha256(TH_TEXT),
      state,
      receiptVersion: i.receiptVersion,
      ...("containerId" in i ? { containerId: i.containerId } : {}),
      ...("publishedId" in i ? { publishedId: i.publishedId } : {}),
      updatedAt: "2026-10-17T09:00:04.000Z",
      commitId: "c-th-1",
    },
  };
};
const thDraft = {
  [TH_SCOPE]: { text: TH_TEXT, commitId: "rev-th-1", updatedAt: "2026-10-17T09:00:00.000Z" },
};
const thDisk = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state ?? {});
const statusGets = (fake: Fake) => fake.calls.filter((c) => c === `GET ${TH_SEND}/${TH_OP}`);

for (const mode of ["account error", "another account"] as const)
  test(`DT-6B-2B-2-R1: with ${mode === "account error" ? "an account error" : "another account loaded"} on the same Worker, a retained handle is checked once by its own account`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubProviders(fake);
    fake.routes["/social/inbox/threads/account"] =
      mode === "account error"
        ? () => ({ status: 401, body: { error: "token_expired" } })
        : () => ({
            body: {
              provider: "threads",
              accountId: "26",
              generation: "e".repeat(32),
              handle: "other_owner",
              capabilities: { replies: "ok", sendReplies: "permission_unverified" },
            },
          });
    fake.routes["/social/inbox/threads/posts"] = () =>
      providerPage({ provider: "threads", accountId: "26", generation: "e".repeat(32) }, []);
    fake.routes[`${TH_SEND}/${TH_OP}`] = (u) => {
      expect(u.searchParams.get("account")).toBe("25");
      return { body: { intent: thUnknownPublication() } };
    };
    await seedState(page, "/social/inbox/", { ...SETTINGS(), inboxThreadsSendOps: thHandle });
    await page.getByTestId("ibx-provider-threads").click();
    await expect.poll(() => fake.calls.includes("GET /social/inbox/threads/account")).toBe(true);
    const recovery = page.getByTestId("ibx-ths-recovery");
    await expect(recovery).toBeVisible();
    expect(statusGets(fake)).toHaveLength(0);
    await recovery.getByTestId("ibx-ths-check").click();
    await expect(page.getByTestId("ibx-ths-sheet")).toHaveAttribute(
      "data-phase",
      "unknown_publication",
    );
    await expect(page.getByTestId("ibx-ths-sheet-check")).toBeVisible();
    await expect(page.getByTestId("ibx-ths-confirm")).toHaveCount(0);
    await expect(page.getByTestId("ibx-ths-resume")).toHaveCount(0);
    expect(statusGets(fake)).toHaveLength(1);
    expect(fake.nonGet).toEqual([]);
    expect(await fitsViewport(page)).toBe(true);
  });

test("DT-6B-2B-2-R1: another Worker's handle is named and never asked; the token never goes there", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  const old: string[] = [];
  await page.route("https://old.test/**", (route) => {
    old.push(route.request().url());
    return route.abort();
  });
  const oldScope = "v2|threads|https%3A%2F%2Fold.test|25|comment|91001";
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxThreadsSendOps: thOp("unknown_publication", oldScope),
  });
  await page.getByTestId("ibx-provider-threads").click();
  await expect(page.getByTestId("ibx-th-post-open")).toBeVisible();
  const foreign = page.getByTestId("ibx-ths-recovery-foreign");
  await expect(foreign).toBeVisible();
  await expect(foreign).toContainText("91001");
  await expect(foreign).toContainText("https://old.test");
  await expect(foreign.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("ibx-ths-recovery")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(fake.calls.some((c) => c.includes(TH_SEND))).toBe(false);
  expect(old).toEqual([]);
  expect(Object.keys((await thDisk(page)).inboxThreadsSendOps)).toEqual([oldScope]);
});

for (const newer of [false, true])
  test(`DT-6B-2B-2-R1: Clear draft from the recovery list keeps the open editor usable (${newer ? "newer typing" : "same text"})`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubProviders(fake);
    fake.routes[`${TH_SEND}/${TH_OP}`] = () => ({ body: { intent: thReceipt("published") } });
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(),
      inboxThreadsSendOps: thOp("unknown_publication"),
      inboxDrafts: thDraft,
    });
    await page.getByTestId("ibx-provider-threads").click();
    await page.getByTestId("ibx-th-post-open").click();
    await page.getByTestId("ibx-reply-draft").first().click();
    const editor = page.getByTestId("ibx-draft-text");
    await expect(editor).toHaveValue(TH_TEXT);
    if (newer) await editor.fill("Newer unsaved reply");
    await page.getByTestId("ibx-ths-recovery").getByTestId("ibx-ths-check").click();
    await expect(page.getByTestId("ibx-ths-sheet")).toHaveAttribute("data-phase", "published");
    await page.getByTestId("ibx-ths-clear").click();
    await expect(page.getByTestId("ibx-ths-sheet")).toHaveCount(0);
    expect((await thDisk(page)).inboxDrafts[TH_SCOPE]).toBeUndefined();
    await expect(editor).toHaveValue(newer ? "Newer unsaved reply" : "");
    await editor.fill("Next locally saved reply");
    await page.getByTestId("ibx-draft-save").click();
    await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
    expect((await thDisk(page)).inboxDrafts[TH_SCOPE].text).toBe("Next locally saved reply");
    expect(fake.nonGet).toEqual([]);
  });

test("DT-6B-2B-2-R1: a retained review has a manual Check status, and closing it cancels nothing", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  fake.routes[`${TH_SEND}/${TH_OP}`] = () => ({ body: { intent: thReceipt("prepared") } });
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxThreadsSendOps: thOp("prepared"),
  });
  await page.getByTestId("ibx-provider-threads").click();
  await page.getByTestId("ibx-ths-recovery").getByTestId("ibx-ths-check").click();
  const sheet = page.getByTestId("ibx-ths-sheet");
  await expect(sheet).toHaveAttribute("data-phase", "review");
  await expect(page.getByTestId("ibx-ths-text")).toHaveText(TH_TEXT);
  await expect(page.getByTestId("ibx-ths-confirm")).toHaveCount(0);
  await page.getByTestId("ibx-ths-sheet-check").click();
  await expect.poll(() => statusGets(fake).length).toBe(2);
  await page.getByTestId("ibx-ths-close").click();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(fake.nonGet).toEqual([]);
  expect((await thDisk(page)).inboxThreadsSendOps[TH_SCOPE]).toMatchObject({
    operationId: TH_OP,
    state: "prepared",
  });
});

test("DT-6B-2B-2-R1: a device clock past the review deadline asks the Worker once by itself, never again", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  // The Worker still says prepared (its clock is behind this device's); the deadline is the operation's, fixed.
  const deadline = new Date(Date.now() - 60_000).toISOString();
  fake.routes[`${TH_SEND}/${TH_OP}`] = () => ({
    body: { intent: thReceipt("prepared", { reviewExpiresAt: deadline }) },
  });
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxThreadsSendOps: thOp("prepared"),
  });
  await page.getByTestId("ibx-provider-threads").click();
  await page.getByTestId("ibx-ths-recovery").getByTestId("ibx-ths-check").click();
  await expect(page.getByTestId("ibx-ths-sheet")).toHaveAttribute("data-phase", "review");
  // The owner's lookup, then exactly one automatic expiry lookup.
  await expect.poll(() => statusGets(fake).length).toBe(2);
  await page.waitForTimeout(2500);
  expect(statusGets(fake)).toHaveLength(2);
  expect(fake.nonGet).toEqual([]);
});

// 📤 DT-6B-2B-2-R2 (2B2-R1-A): an explicit Cancel from the row's review sends exactly one cancel and ends on a truthful
// terminal view with its own Close (never a lasting "Checking…"); the draft stays. An expired answer says expired. A
// failed cancel keeps the operation and Check status. Closing alone never cancels. Production sending stays closed.
const TH_CANCEL = `${TH_SEND}/${TH_OP}/cancel`;
const thTerminal = (state: "cancelled" | "expired") => ({
  ...thReceipt("prepared"),
  state,
  receiptVersion: 2,
});

async function openRowReview(page: Page, fake: Fake, lang: "en" | "ar") {
  fake.routes[`${TH_SEND}/${TH_OP}`] = (u) => {
    expect(u.searchParams.get("account")).toBe("25");
    return { body: { intent: thReceipt("prepared") } };
  };
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(lang),
    inboxThreadsSendOps: thOp("prepared"),
    inboxDrafts: thDraft,
  });
  if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("ibx-provider-threads").click();
  await page.getByTestId("ibx-th-post-open").click();
  await page.getByTestId("ibx-reply-draft").first().click();
  await expect(page.getByTestId("ibx-draft-text")).toHaveValue(TH_TEXT);
  const row = page.getByTestId("ibx-draft");
  const sheet = page.getByTestId("ibx-ths-sheet");
  await row.getByTestId("ibx-ths-check").click();
  await expect(sheet).toHaveAttribute("data-phase", "review");
  // Closing alone cancels nothing and keeps the operation.
  await page.getByTestId("ibx-ths-close").click();
  await expect(sheet).toHaveCount(0);
  expect(fake.nonGet).toEqual([]);
  expect((await thDisk(page)).inboxThreadsSendOps[TH_SCOPE].state).toBe("prepared");
  await row.getByTestId("ibx-ths-check").click();
  await expect(sheet).toHaveAttribute("data-phase", "review");
  return { row, sheet };
}

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2B-2-R2 (${lang}): an explicit Cancel from the row ends on the cancelled outcome, keeps the draft and closes`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubProviders(fake);
    const cancels: Record<string, string>[] = [];
    fake.routes[TH_CANCEL] = (_u, body) => {
      cancels.push(body);
      return { body: { intent: thTerminal("cancelled") } };
    };
    const { row, sheet } = await openRowReview(page, fake, lang);
    await page.getByTestId("ibx-ths-cancel").click();
    await expect
      .poll(async () => (await thDisk(page)).inboxThreadsSendOps[TH_SCOPE])
      .toBeUndefined();
    await expect(sheet).toHaveAttribute("data-phase", "cancelled");
    await expect(sheet).toContainText(
      lang === "ar"
        ? "انلغى. ما انرسل شي. الـWorker قفّل المراجعة ومسودتك زي ما هي."
        : "Cancelled. Nothing was sent. The Worker ended this review and your draft wasn't touched.",
    );
    await expect(sheet).not.toContainText(
      lang === "ar" ? "نشيّك على الرد في ثريدز" : "Checking the reply on Threads",
    );
    await expect(page.getByTestId("ibx-ths-sheet-check")).toHaveCount(0);
    const close = page.getByTestId("ibx-ths-close");
    await expect(close).toBeVisible();
    expect(fake.nonGet).toEqual([`POST ${TH_CANCEL}`]);
    expect(cancels).toEqual([{ account: "25" }]);
    expect((await thDisk(page)).inboxDrafts[TH_SCOPE]).toMatchObject({
      text: TH_TEXT,
      commitId: "rev-th-1",
    });
    expect(await fitsViewport(page)).toBe(true);
    await close.click();
    await expect(sheet).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(fake.nonGet).toEqual([`POST ${TH_CANCEL}`]);
    await expect(page.getByTestId("ibx-draft-text")).toHaveValue(TH_TEXT);
    await expect(row.getByTestId("ibx-ths-check")).toHaveCount(0);
    await expect(row.getByTestId("ibx-ths-open")).toBeDisabled();
  });

test("DT-6B-2B-2-R2: an expired cancel answer from the row says expired and closes", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  fake.routes[TH_CANCEL] = () => ({ body: { intent: thTerminal("expired") } });
  const { sheet } = await openRowReview(page, fake, "en");
  await page.getByTestId("ibx-ths-cancel").click();
  await expect(sheet).toHaveAttribute("data-phase", "expired");
  await expect(sheet).toContainText("expired before Send");
  await expect(sheet).not.toContainText("Checking the reply on Threads");
  expect((await thDisk(page)).inboxThreadsSendOps[TH_SCOPE]).toBeUndefined();
  expect((await thDisk(page)).inboxDrafts[TH_SCOPE].text).toBe(TH_TEXT);
  expect(fake.nonGet).toEqual([`POST ${TH_CANCEL}`]);
  await page.getByTestId("ibx-ths-close").click();
  await expect(sheet).toHaveCount(0);
});

test("DT-6B-2B-2-R2: a failed cancel from the row keeps the operation and Check status", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  stubProviders(fake);
  fake.routes[TH_CANCEL] = () => ({ status: 502, body: { error: "upstream" } });
  const { sheet } = await openRowReview(page, fake, "en");
  const reads = statusGets(fake).length;
  await page.getByTestId("ibx-ths-cancel").click();
  await expect(page.getByTestId("ibx-ths-error")).toContainText("Couldn't confirm the cancel");
  expect((await thDisk(page)).inboxThreadsSendOps[TH_SCOPE]).toMatchObject({
    operationId: TH_OP,
    state: "prepared",
  });
  await page.getByTestId("ibx-ths-sheet-check").click();
  await expect(sheet).toHaveAttribute("data-phase", "review");
  expect(statusGets(fake)).toHaveLength(reads + 1);
  expect(fake.nonGet).toEqual([`POST ${TH_CANCEL}`]);
  await page.getByTestId("ibx-ths-close").click();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(fake.nonGet).toEqual([`POST ${TH_CANCEL}`]);
  expect((await thDisk(page)).inboxThreadsSendOps[TH_SCOPE].state).toBe("prepared");
});

// 📤 DT-6B-2C-4: Instagram public-comment review and recovery. Production readiness is closed: the comment's opener is
// disabled with the reason and nothing is prepared or sent; a retained `unknown` operation survives a reload and Check
// status asks exactly once; the recovery list stays visible with an account read failure and with another account
// selected; another Worker's operation is named and never asked. EN desktop + AR phone run through both projects.
const IG_SEND = "/social/inbox/instagram/send";
const IG_OP = "op-ig-retained-0001";
const IG_TEXT = "Thanks so much!";
const IG_SCOPE = `${encodeURIComponent(WORKER)}|${ACC_A}|comment|k1`;
/** The Worker's lost-receipt answer (inboxSendInstagram.ts): unknown, derived from the dispatching intent, no settledAt. */
const igUnknown = () => ({
  operationId: IG_OP,
  provider: "instagram",
  account: ACC_A,
  generation: "e".repeat(32),
  mediaId: "m1",
  commentId: "k1",
  text: IG_TEXT,
  digest: sha256(IG_TEXT),
  draftRevision: "rev-ig-1",
  state: "unknown",
  reviewExpiresAt: "2026-10-17T09:10:00.000Z",
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:02.000Z",
  claimedAt: "2026-10-17T09:00:02.000Z",
  unknownReason: "receipt",
  receiptVersion: 2,
});
const igHandle = (origin = WORKER) => ({
  [`instagram|${encodeURIComponent(origin)}|${ACC_A}|comment|k1`]: {
    operationId: IG_OP,
    workerOrigin: origin,
    account: ACC_A,
    mediaId: "m1",
    commentId: "k1",
    draftRevision: "rev-ig-1",
    digest: sha256(IG_TEXT),
    sendGeneration: "e".repeat(32),
    state: "unknown",
    receiptVersion: 2,
    updatedAt: "2026-10-17T09:00:04.000Z",
    commitId: "c-ig-1",
  },
});
const igGets = (fake: Fake) => fake.calls.filter((c) => c === `GET ${IG_SEND}/${IG_OP}`);
function stubIgComments(fake: Fake) {
  fake.routes["/social/inbox/media"] = () =>
    page1([
      {
        id: "m1",
        caption: "LUT reel",
        permalink: "https://www.instagram.com/reel/ABC/",
        timestamp: null,
        commentsCount: 1,
      },
    ]);
  fake.routes["/social/inbox/media/m1/comments"] = () =>
    page1([
      {
        id: "k1",
        text: "love it",
        author: { id: "u1", username: "fan" },
        createdAt: null,
        direction: "in",
      },
    ]);
}

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-4 (${lang}): production says why Send as public reply is unavailable and sends nothing`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubIgComments(fake);
    await seedState(page, "/social/inbox/", SETTINGS(lang));
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByTestId("ibx-tab-comments").click();
    await page.getByTestId("ibx-post-open").click();
    await page.getByTestId("ibx-comment-draft").click();
    await page.getByTestId("ibx-draft-text").fill(IG_TEXT);
    await page.getByTestId("ibx-draft-save").click();
    await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
    const open = page.getByTestId("ibx-igs-open");
    await expect(open).toBeDisabled();
    await expect(open).toContainText(lang === "ar" ? "أرسله كرد علني" : "Send as public reply");
    await expect(page.getByTestId("ibx-igs-unavailable")).toContainText(
      lang === "ar" ? "ما تأكدنا منها" : "aren't verified yet",
    );
    await expect(page.getByTestId("ibx-igs-check")).toHaveCount(0);
    await expect(page.getByTestId("ibx-igs-recovery")).toHaveCount(0);
    // Copy still works and never sends.
    await expect(page.getByTestId("ibx-draft-copy")).toBeEnabled();
    expect(await fitsViewport(page)).toBe(true);
    expect(fake.nonGet).toEqual([]);
    expect(fake.calls.some((c) => c.includes(IG_SEND))).toBe(false);
  });

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-4 (${lang}): a retained unknown operation survives a reload and Check status asks once`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    let reads = 0;
    fake.routes[`${IG_SEND}/${IG_OP}`] = (u) => {
      reads += 1;
      expect(u.searchParams.get("account")).toBe(ACC_A);
      return { body: { intent: igUnknown() } };
    };
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramSendOps: igHandle(),
    });
    await page.reload();
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const item = page.getByTestId("ibx-igs-recovery-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("k1");
    await expect(item.getByTestId("ibx-igs-status")).toHaveAttribute("data-state", "unknown");
    await expect(item.getByTestId("ibx-igs-open")).toHaveCount(0);
    expect(reads).toBe(0);
    await item.getByTestId("ibx-igs-check").click();
    const sheet = page.getByTestId("ibx-igs-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "unknown");
    await expect(sheet).toContainText(
      lang === "ar" ? "يمكن يكون انتشر" : "it may have been posted",
    );
    await expect(page.getByTestId("ibx-igs-comment-id")).toContainText("k1");
    await expect(page.getByTestId("ibx-igs-text")).toHaveText(IG_TEXT);
    await expect(page.getByTestId("ibx-igs-sheet-check")).toBeVisible();
    await expect(page.getByTestId("ibx-igs-confirm")).toHaveCount(0);
    expect(reads).toBe(1);
    expect(igGets(fake)).toHaveLength(1);
    // Closing never cancels or erases the unresolved operation.
    await page.getByTestId("ibx-igs-close").click();
    await expect(sheet).toHaveCount(0);
    expect(await fitsViewport(page)).toBe(true);
    expect(fake.nonGet).toEqual([]);
    const ops = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state?.inboxInstagramSendOps ?? {},
    );
    expect(Object.keys(ops)).toEqual([`instagram|${IG_SCOPE}`]);
    expect(JSON.stringify(ops)).not.toContain(IG_TEXT);
  });

for (const mode of ["account error", "another account"] as const)
  test(`DT-6B-2C-4: with ${mode === "account error" ? "an account read failure" : "another account selected"}, the recovery list still checks the operation once by its own account`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    fake.routes["/social/inbox/account"] =
      mode === "account error"
        ? () => ({ status: 409, body: { error: "token_expired" } })
        : () => account(ACC_B, GEN_B);
    fake.routes["/social/inbox/conversations"] = () => page1([], null, "end", ACC_B, GEN_B);
    fake.routes[`${IG_SEND}/${IG_OP}`] = (u) => {
      expect(u.searchParams.get("account")).toBe(ACC_A);
      return { body: { intent: igUnknown() } };
    };
    await seedState(page, "/social/inbox/", { ...SETTINGS(), inboxInstagramSendOps: igHandle() });
    await expect.poll(() => fake.calls.includes("GET /social/inbox/account")).toBe(true);
    const recovery = page.getByTestId("ibx-igs-recovery");
    await expect(recovery).toBeVisible();
    expect(igGets(fake)).toHaveLength(0);
    await recovery.getByTestId("ibx-igs-check").click();
    await expect(page.getByTestId("ibx-igs-sheet")).toHaveAttribute("data-phase", "unknown");
    await expect(page.getByTestId("ibx-igs-confirm")).toHaveCount(0);
    expect(igGets(fake)).toHaveLength(1);
    expect(fake.nonGet).toEqual([]);
    expect(await fitsViewport(page)).toBe(true);
  });

test("DT-6B-2C-4: another Worker's operation is named and never asked; the token never goes there", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  const old: string[] = [];
  await page.route("https://old.test/**", (route) => {
    old.push(route.request().url());
    return route.abort();
  });
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxInstagramSendOps: igHandle("https://old.test"),
  });
  const foreign = page.getByTestId("ibx-igs-recovery-foreign");
  await expect(foreign).toBeVisible();
  await expect(foreign).toContainText("k1");
  await expect(foreign).toContainText("https://old.test");
  await expect(foreign.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("ibx-igs-recovery")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(fake.calls.some((c) => c.includes(IG_SEND))).toBe(false);
  expect(old).toEqual([]);
  expect(fake.nonGet).toEqual([]);
});

// 📤 DT-6B-2C-4-R1 (2C4-1), reachable in production (readiness closed, status only): a retained `preparing` handle (its
// Prepare never answered) is checked; that lookup hangs; a second Check records the operation's sent receipt; the first
// lookup then answers not_found. A stale not_found never erases the newer proof: the sent handle, its reply id and the
// recovery entry stay. Zero non-GET requests. EN desktop + AR phone run through both projects.
for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-4-R1 (${lang}): a late not_found from an older Check status never erases a newer sent receipt`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((r) => (releaseFirst = r));
    let reads = 0;
    fake.routes[`${IG_SEND}/${IG_OP}`] = async (u) => {
      reads += 1;
      expect(u.searchParams.get("account")).toBe(ACC_A);
      if (reads === 1) {
        await firstHeld;
        return { status: 404, body: { error: "not_found" } };
      }
      const claim = Object.entries(igUnknown()).filter(([k]) => k !== "unknownReason");
      return {
        body: {
          intent: {
            ...Object.fromEntries(claim),
            state: "sent",
            settledAt: "2026-10-17T09:00:03.000Z",
            providerReplyId: "17950000000000001",
            receiptVersion: 3,
          },
        },
      };
    };
    const [key, handle] = Object.entries(igHandle())[0];
    // A Prepare that never answered: no receipt version, no learned send generation.
    const preparing = Object.fromEntries(
      Object.entries(handle).filter(([k]) => k !== "sendGeneration" && k !== "receiptVersion"),
    );
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramSendOps: { [key]: { ...preparing, state: "preparing" } },
    });
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const item = page.getByTestId("ibx-igs-recovery-item");
    await expect(item.getByTestId("ibx-igs-status")).toHaveAttribute("data-state", "preparing");
    await item.getByTestId("ibx-igs-check").click();
    const sheet = page.getByTestId("ibx-igs-sheet");
    await expect(sheet).toBeVisible();
    await expect.poll(() => reads).toBe(1);
    // Closing (Escape) cancels nothing; a second explicit Check records the sent receipt.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await item.getByTestId("ibx-igs-check").click();
    await expect(sheet).toHaveAttribute("data-phase", "sent");
    await expect(page.getByTestId("ibx-igs-reply-id")).toContainText("17950000000000001");
    // The older lookup now answers not_found for the operation it saw as preparing.
    releaseFirst();
    await page.waitForTimeout(400);
    const ops = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state?.inboxInstagramSendOps ?? {},
    );
    expect(ops[key]).toMatchObject({
      operationId: IG_OP,
      state: "sent",
      providerReplyId: "17950000000000001",
    });
    await expect(sheet).toHaveAttribute("data-phase", "sent");
    await expect(item.getByTestId("ibx-igs-status")).toHaveAttribute("data-state", "sent");
    expect(reads).toBe(2);
    expect(igGets(fake)).toHaveLength(2);
    expect(fake.nonGet).toEqual([]);
    expect(await fitsViewport(page)).toBe(true);
  });

// 💬 DT-6B-2C-5A: Instagram existing-conversation DM review and recovery. Production readiness is closed: the DM opener
// beside the conversation draft is disabled with the reason and nothing is prepared or sent, while the explicitly selected
// inbound message is shown; a retained lost settlement (dispatching + observed refusal) survives a reload and Check status
// asks exactly once; the recovery list stays visible with an account read failure and with another account selected;
// another Worker's operation is named and never asked; an explicit Cancel ends a prepared review; Clear draft after a
// durable sent empties the editor. EN desktop + AR phone run through both projects.
const DM_SEND = "/social/inbox/instagram/dm/send";
const DM_OP = "op-dm-retained-0001";
const DM_TEXT = "Yes, it's the 16 Pro!";
const DM_SCOPE = `${encodeURIComponent(WORKER)}|${ACC_A}|conversation|c1`;
const dmKey = (origin = WORKER) => [origin, ACC_A, "c1", "in1"].map(encodeURIComponent).join("|");
const dmDigest = sha256(JSON.stringify({ recipient: { id: "p-c1" }, message: { text: DM_TEXT } }));
/** A real DM intent shape (inboxSendInstagramDm.ts): no provider field, the strict proof of its state. */
const dmIntent = (state: string, over: Record<string, unknown> = {}) => ({
  operationId: DM_OP,
  account: ACC_A,
  generation: "e".repeat(32),
  conversationId: "c1",
  recipientId: "p-c1",
  inboundMessageId: "in1",
  inboundAt: "2026-10-17T07:00:00.000Z",
  text: DM_TEXT,
  digest: dmDigest,
  draftRevision: "rev-dm-1",
  state,
  reviewExpiresAt: "2026-10-17T07:10:00.000Z",
  createdAt: "2026-10-17T07:01:00.000Z",
  updatedAt: "2026-10-17T07:02:00.000Z",
  ...(state === "prepared" || state === "cancelled"
    ? {}
    : { claimedAt: "2026-10-17T07:02:00.000Z" }),
  ...(state === "sent"
    ? { settledAt: "2026-10-17T07:02:01.000Z", providerMessageId: "mid-c1-0001" }
    : {}),
  receiptVersion: state === "prepared" ? 1 : state === "sent" ? 3 : 2,
  ...over,
});
const dmHandle = (state: string, origin = WORKER, over: Record<string, unknown> = {}) => ({
  [dmKey(origin)]: {
    operationId: DM_OP,
    workerOrigin: origin,
    account: ACC_A,
    conversationId: "c1",
    recipientId: "p-c1",
    inboundMessageId: "in1",
    inboundAt: "2026-10-17T07:00:00.000Z",
    draftRevision: "rev-dm-1",
    digest: dmDigest,
    sendGeneration: "e".repeat(32),
    state,
    receiptVersion: state === "prepared" ? 1 : 2,
    updatedAt: "2026-10-17T07:02:00.000Z",
    commitId: "c-dm-1",
    ...over,
  },
});
const dmGets = (fake: Fake) => fake.calls.filter((c) => c === `GET ${DM_SEND}/${DM_OP}`);
const dmDisk = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state ?? {});
function stubDmConversation(fake: Fake) {
  fake.routes["/social/inbox/conversations/c1/messages"] = () =>
    page1([
      msg("in2", { createdAt: "2026-10-17T08:00:00.000Z", text: "and the price?" }),
      msg("out1", { direction: "out", from: { id: ACC_A, username: "3z.prod" }, text: "hi!" }),
      msg("in1", { text: "is it the 16 Pro?" }),
    ]);
}

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5A (${lang}): production says why Send as DM reply is unavailable, shows the selected message and sends nothing`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubDmConversation(fake);
    await seedState(page, "/social/inbox/", SETTINGS(lang));
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByTestId("ibx-conv").first().click();
    await expect(page.getByTestId("ibx-msg")).toHaveCount(3);
    const row = (id: string) => page.locator(`[data-testid="ibx-msg"][data-id="${id}"]`);
    // The owner's own message has no selector; nothing is selected by itself.
    await expect(row("out1").getByTestId("ibx-msg-pick")).toHaveCount(0);
    await expect(page.getByTestId("ibx-igdm-pick-first")).toBeVisible();
    // The older inbound message is chosen explicitly and its context is shown.
    await row("in1").getByTestId("ibx-msg-pick").click();
    await expect(row("in1").getByTestId("ibx-msg-pick")).toHaveAttribute("aria-pressed", "true");
    const ctx = page.getByTestId("ibx-igdm-target");
    await expect(ctx).toHaveAttribute("data-id", "in1");
    await expect(ctx).toContainText("@fan_c1");
    await expect(ctx).toContainText("is it the 16 Pro?");
    await page.getByTestId("ibx-draft-text").fill(DM_TEXT);
    await page.getByTestId("ibx-draft-save").click();
    await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
    const open = page.getByTestId("ibx-igdm-open");
    await expect(open).toBeDisabled();
    await expect(open).toContainText(lang === "ar" ? "أرسله كرسالة خاصة" : "Send as DM reply");
    await expect(page.getByTestId("ibx-igdm-unavailable")).toContainText(
      lang === "ar" ? "ما تأكدنا منه" : "aren't verified yet",
    );
    await expect(page.getByTestId("ibx-igdm-recovery")).toHaveCount(0);
    await expect(page.getByTestId("ibx-draft-copy")).toBeEnabled();
    expect(await fitsViewport(page)).toBe(true);
    expect(fake.nonGet).toEqual([]);
    expect(fake.calls.some((c) => c.includes("/instagram/dm"))).toBe(false);
  });

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5A (${lang}): a lost settlement survives a reload; Check status asks once and stays uncertain`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    let reads = 0;
    fake.routes[`${DM_SEND}/${DM_OP}`] = (u) => {
      reads += 1;
      expect(u.searchParams.get("account")).toBe(ACC_A);
      return { body: { intent: dmIntent("dispatching") } };
    };
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramDmSendOps: dmHandle("dispatching", WORKER, {
        pending: { observed: "rejected", code: "meta_10" },
      }),
    });
    await page.reload();
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const item = page.getByTestId("ibx-igdm-recovery-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("in1");
    const status = item.getByTestId("ibx-igdm-status");
    await expect(status).toHaveAttribute("data-state", "dispatching");
    await expect(status).toHaveAttribute("data-pending", "rejected");
    await expect(item.getByTestId("ibx-igdm-open")).toHaveCount(0);
    expect(reads).toBe(0);
    await item.getByTestId("ibx-igdm-check").click();
    const sheet = page.getByTestId("ibx-igdm-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "dispatching");
    await expect(page.getByTestId("ibx-igdm-pending")).toHaveAttribute("data-observed", "rejected");
    await expect(sheet).toContainText(lang === "ar" ? "لسه ما خلصت" : "isn't settled");
    await expect(page.getByTestId("ibx-igdm-text")).toHaveText(DM_TEXT);
    for (const id of ["ibx-igdm-confirm", "ibx-igdm-clear", "ibx-igdm-again"])
      await expect(page.getByTestId(id)).toHaveCount(0);
    expect(reads).toBe(1);
    expect(dmGets(fake)).toHaveLength(1);
    // Closing never cancels or erases the unresolved operation.
    await page.getByTestId("ibx-igdm-close").click();
    await expect(sheet).toHaveCount(0);
    expect(await fitsViewport(page)).toBe(true);
    expect(fake.nonGet).toEqual([]);
    const ops = (await dmDisk(page)).inboxInstagramDmSendOps ?? {};
    expect(Object.keys(ops)).toEqual([dmKey()]);
    expect(ops[dmKey()]).toMatchObject({ state: "dispatching", pending: { observed: "rejected" } });
    expect(JSON.stringify(ops)).not.toContain(DM_TEXT);
  });

for (const mode of ["account error", "another account"] as const)
  test(`DT-6B-2C-5A: with ${mode === "account error" ? "an account read failure" : "another account selected"}, the DM recovery list checks once by its own account`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    fake.routes["/social/inbox/account"] =
      mode === "account error"
        ? () => ({ status: 409, body: { error: "token_expired" } })
        : () => account(ACC_B, GEN_B);
    fake.routes["/social/inbox/conversations"] = () => page1([], null, "end", ACC_B, GEN_B);
    fake.routes[`${DM_SEND}/${DM_OP}`] = (u) => {
      expect(u.searchParams.get("account")).toBe(ACC_A);
      return { body: { intent: dmIntent("dispatching") } };
    };
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(),
      inboxInstagramDmSendOps: dmHandle("dispatching"),
    });
    await expect.poll(() => fake.calls.includes("GET /social/inbox/account")).toBe(true);
    const recovery = page.getByTestId("ibx-igdm-recovery");
    await expect(recovery).toBeVisible();
    expect(dmGets(fake)).toHaveLength(0);
    await recovery.getByTestId("ibx-igdm-check").click();
    await expect(page.getByTestId("ibx-igdm-sheet")).toHaveAttribute("data-phase", "dispatching");
    await expect(page.getByTestId("ibx-igdm-confirm")).toHaveCount(0);
    expect(dmGets(fake)).toHaveLength(1);
    expect(fake.nonGet).toEqual([]);
    expect(await fitsViewport(page)).toBe(true);
  });

test("DT-6B-2C-5A: another Worker's DM operation is named and never asked; the token never goes there", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  const old: string[] = [];
  await page.route("https://old.test/**", (route) => {
    old.push(route.request().url());
    return route.abort();
  });
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxInstagramDmSendOps: dmHandle("prepared", "https://old.test"),
  });
  const foreign = page.getByTestId("ibx-igdm-recovery-foreign");
  await expect(foreign).toBeVisible();
  await expect(foreign).toContainText("in1");
  await expect(foreign).toContainText("https://old.test");
  await expect(foreign.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("ibx-igdm-recovery")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(fake.calls.some((c) => c.includes("/instagram/dm"))).toBe(false);
  expect(old).toEqual([]);
  expect(fake.nonGet).toEqual([]);
});

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5A (${lang}): an explicit Cancel ends a retained prepared review; Close alone cancels nothing`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubDmConversation(fake);
    fake.routes[`${DM_SEND}/${DM_OP}`] = () => ({ body: { intent: dmIntent("prepared") } });
    fake.routes[`${DM_SEND}/${DM_OP}/cancel`] = (_u, body) => {
      expect(body).toEqual({ account: ACC_A });
      return { body: { intent: dmIntent("cancelled") } };
    };
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramDmSendOps: dmHandle("prepared"),
      inboxDrafts: {
        [DM_SCOPE]: { text: DM_TEXT, updatedAt: "2026-10-17T07:00:00.000Z", commitId: "rev-dm-1" },
      },
    });
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // Check status, then Close: zero POST, the review stays retained.
    await page.getByTestId("ibx-igdm-recovery").getByTestId("ibx-igdm-check").click();
    await expect(page.getByTestId("ibx-igdm-sheet")).toHaveAttribute("data-phase", "review");
    await expect(page.getByTestId("ibx-igdm-confirm")).toHaveCount(0);
    await page.getByTestId("ibx-igdm-close").click();
    await expect(page.getByTestId("ibx-igdm-sheet")).toHaveCount(0);
    expect(fake.nonGet).toEqual([]);
    // From the conversation editor of that very inbound message, Cancel ends it on the cancelled receipt.
    await page.getByTestId("ibx-conv").first().click();
    await page
      .locator('[data-testid="ibx-msg"][data-id="in1"]')
      .getByTestId("ibx-msg-pick")
      .click();
    await page.getByTestId("ibx-draft").getByTestId("ibx-igdm-cancel-row").click();
    const sheet = page.getByTestId("ibx-igdm-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "cancelled");
    await expect(sheet).toContainText(lang === "ar" ? "انلغت" : "Cancelled.");
    expect(fake.nonGet).toEqual([`POST ${DM_SEND}/${DM_OP}/cancel`]);
    const disk = await dmDisk(page);
    expect(disk.inboxInstagramDmSendOps ?? {}).toEqual({});
    expect(disk.inboxDrafts[DM_SCOPE].text).toBe(DM_TEXT);
    await page.getByTestId("ibx-igdm-close").click();
    await expect(page.getByTestId("ibx-igdm-recovery")).toHaveCount(0);
    expect(await fitsViewport(page)).toBe(true);
  });

// 💬 DT-6B-3C: a DM is limited to 1,000 UTF-8 bytes of its canonical text. An older retained prepared review over that
// bound (501 Arabic letters = 1,002 bytes) is recovered with its exact text, byte wording, Check status and Cancel; Send is
// never offered, nothing is prepared or confirmed, the saved draft stays as it is and production stays closed.
const DM_OLD = "ب".repeat(501);
const DM_OLD_DIGEST = sha256(
  JSON.stringify({ recipient: { id: "p-c1" }, message: { text: DM_OLD } }),
);
for (const lang of ["en", "ar"] as const)
  test(`DT-6B-3C (${lang}): an older prepared review over 1,000 UTF-8 bytes recovers with Check/Cancel and sends nothing`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubDmConversation(fake);
    const old = { text: DM_OLD, digest: DM_OLD_DIGEST };
    fake.routes[`${DM_SEND}/${DM_OP}`] = () => ({ body: { intent: dmIntent("prepared", old) } });
    fake.routes[`${DM_SEND}/${DM_OP}/cancel`] = () => ({
      body: { intent: dmIntent("cancelled", old) },
    });
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramDmSendOps: dmHandle("prepared", WORKER, { digest: DM_OLD_DIGEST }),
      inboxDrafts: {
        [DM_SCOPE]: { text: DM_OLD, updatedAt: "2026-10-17T07:00:00.000Z", commitId: "rev-dm-1" },
      },
    });
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByTestId("ibx-igdm-recovery").getByTestId("ibx-igdm-check").click();
    const sheet = page.getByTestId("ibx-igdm-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "review");
    await expect(page.getByTestId("ibx-igdm-text")).toHaveText(DM_OLD);
    const over = page.getByTestId("ibx-igdm-over-limit");
    await expect(over).toContainText("1002");
    await expect(over).toContainText(lang === "ar" ? "بايت (UTF-8)" : "UTF-8 bytes");
    await expect(over).toContainText(lang === "ar" ? "ألغِ هذي المراجعة" : "Cancel this review");
    await expect(page.getByTestId("ibx-igdm-confirm")).toHaveCount(0);
    await expect(page.getByTestId("ibx-igdm-cancel")).toBeEnabled();
    await expect(page.getByTestId("ibx-igdm-sheet-check")).toBeVisible();
    expect(await fitsViewport(page)).toBe(true);
    await page.getByTestId("ibx-igdm-close").click();
    await expect(sheet).toHaveCount(0);
    expect(fake.nonGet).toEqual([]);
    // The conversation editor keeps the saved draft exactly; production stays closed with its own wording.
    await page.getByTestId("ibx-conv").first().click();
    await expect(page.getByTestId("ibx-draft-text")).toHaveValue(DM_OLD);
    await page
      .locator('[data-testid="ibx-msg"][data-id="in1"]')
      .getByTestId("ibx-msg-pick")
      .click();
    await expect(page.getByTestId("ibx-igdm-open")).toBeDisabled();
    await expect(page.getByTestId("ibx-igdm-unavailable")).toContainText(
      lang === "ar" ? "ما تأكدنا منه" : "aren't verified yet",
    );
    // An explicit Cancel is the owner's step: it ends the review; nothing is cleared or recreated.
    await page.getByTestId("ibx-draft").getByTestId("ibx-igdm-cancel-row").click();
    await expect(sheet).toHaveAttribute("data-phase", "cancelled");
    expect(fake.nonGet).toEqual([`POST ${DM_SEND}/${DM_OP}/cancel`]);
    expect(fake.calls.some((c) => c.includes("/confirm") || c.includes("/prepare"))).toBe(false);
    const disk = await dmDisk(page);
    expect(disk.inboxDrafts[DM_SCOPE]).toMatchObject({ text: DM_OLD, commitId: "rev-dm-1" });
    expect(disk.inboxInstagramDmSendOps ?? {}).toEqual({});
    expect(await fitsViewport(page)).toBe(true);
  });

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5A (${lang}): a durable sent from Check status shows its id as text; Clear draft empties the editor`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubDmConversation(fake);
    fake.routes[`${DM_SEND}/${DM_OP}`] = () => ({ body: { intent: dmIntent("sent") } });
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramDmSendOps: dmHandle("dispatching"),
      inboxDrafts: {
        [DM_SCOPE]: { text: DM_TEXT, updatedAt: "2026-10-17T07:00:00.000Z", commitId: "rev-dm-1" },
      },
    });
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByTestId("ibx-conv").first().click();
    const editor = page.getByTestId("ibx-draft-text");
    await expect(editor).toHaveValue(DM_TEXT);
    await page.getByTestId("ibx-igdm-recovery").getByTestId("ibx-igdm-check").click();
    const sheet = page.getByTestId("ibx-igdm-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "sent");
    await expect(page.getByTestId("ibx-igdm-message-id")).toContainText("mid-c1-0001");
    await expect(sheet.locator("a")).toHaveCount(0);
    await page.getByTestId("ibx-igdm-clear").click();
    await expect(sheet).toHaveCount(0);
    await expect(editor).toHaveValue("");
    const disk = await dmDisk(page);
    expect(disk.inboxDrafts[DM_SCOPE]).toBeUndefined();
    expect(disk.inboxInstagramDmSendOps ?? {}).toEqual({});
    await expect(page.getByTestId("ibx-igdm-recovery")).toHaveCount(0);
    expect(fake.nonGet).toEqual([]);
    expect(await fitsViewport(page)).toBe(true);
  });

// 💬 DT-6B-2C-5A-R1: a Refresh that returns the selected message id from another sender (or at another time) never
// lends its text to the selected target: the target keeps its id, says the preview is unavailable, Send stays disabled
// and no DM request is made. A refresh back to the matching row shows its preview again.
for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5A-R1 (${lang}): a refreshed same-id row from another sender or time lends no preview; Send stays disabled`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    let selected: Record<string, unknown> = { text: "is it the 16 Pro?" };
    fake.routes["/social/inbox/conversations/c1/messages"] = () =>
      page1([
        msg("in2", { createdAt: "2026-10-17T08:00:00.000Z", text: "and the price?" }),
        msg("in1", selected),
      ]);
    await seedState(page, "/social/inbox/", SETTINGS(lang));
    await page.getByTestId("ibx-conv").first().click();
    const row = (id: string) => page.locator(`[data-testid="ibx-msg"][data-id="${id}"]`);
    await row("in1").getByTestId("ibx-msg-pick").click();
    const ctx = page.getByTestId("ibx-igdm-target");
    await expect(ctx).toContainText("is it the 16 Pro?");
    await page.getByTestId("ibx-draft-text").fill(DM_TEXT);
    await page.getByTestId("ibx-draft-save").click();
    await expect(page.getByTestId("ibx-draft-status")).toHaveAttribute("data-state", "saved");
    const refreshTo = async (next: Record<string, unknown>, canary: string) => {
      selected = next;
      await page.getByTestId("ibx-refresh").click();
      await expect(row("in1")).toContainText(canary);
    };
    for (const [next, canary] of [
      [
        { from: { id: "p-other", username: "other_customer" }, text: "OTHER_SENDER_CANARY" },
        "OTHER_SENDER_CANARY",
      ],
      [{ createdAt: "2026-10-17T07:30:00.000Z", text: "OTHER_TIME_CANARY" }, "OTHER_TIME_CANARY"],
    ] as const) {
      await refreshTo(next, canary);
      await expect(ctx).toHaveAttribute("data-id", "in1");
      await expect(ctx).not.toContainText(canary);
      await expect(ctx).not.toContainText("other_customer");
      await expect(ctx.getByTestId("ibx-igdm-target-unavailable")).toContainText(
        lang === "ar" ? "معاينة الرسالة مو متاحة" : "preview unavailable",
      );
      await expect(ctx.getByTestId("ibx-igdm-target-unavailable")).toContainText("in1");
      await expect(page.getByTestId("ibx-igdm-open")).toBeDisabled();
    }
    await refreshTo({ text: "is it the 16 Pro? (edited)" }, "(edited)");
    await expect(ctx).toContainText("is it the 16 Pro? (edited)");
    await expect(ctx.getByTestId("ibx-igdm-target-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("ibx-igdm-open")).toBeDisabled();
    expect(await fitsViewport(page)).toBe(true);
    expect(fake.nonGet).toEqual([]);
    expect(fake.calls.some((c) => c.includes("/instagram/dm"))).toBe(false);
  });

// 🛟 DT-6B-2C-5B: verified-handle conversation takeover/resume. Linking a NEW conversation is closed in production: the
// Link button beside the conversation is disabled with the reason and nothing is asked. A retained verified handle opens
// from the recovery list to Check status (truthful counts: the true total with limited rows, the unknown-outcome count
// separately), then to explicit reviews of Take over and Resume that each send exactly one request; a pending change
// survives a reload as Check status only with zero automatic repeats; another Worker's link is named and never asked.
// EN desktop + AR phone run through both projects.
const CONTROL = "/social/inbox/instagram/dm/control";
const HANDLE = "a".repeat(32);
const ctlKey = (origin = WORKER) => [origin, ACC_A, "c1"].map(encodeURIComponent).join("|");
const ctlEntry = (origin = WORKER, over: Record<string, unknown> = {}) => ({
  [ctlKey(origin)]: {
    workerOrigin: origin,
    account: ACC_A,
    conversationId: "c1",
    handleId: HANDLE,
    recipientId: "p-c1",
    registeredGeneration: "e".repeat(32),
    evidenceDigest: "f".repeat(64),
    mode: "auto",
    revision: 0,
    inFlightTotal: 23,
    inFlightTruncated: true,
    uncertainTotal: 2,
    updatedAt: "2026-10-17T07:02:00.000Z",
    commitId: "c-ctl-1",
    ...over,
  },
});
/** A real control view shape (inboxSendInstagramDm.ts validView): complete handle, claimed rows, truthful counts. */
const ctlView = (o: {
  mode: string;
  revision: number;
  rows?: number;
  total?: number;
  changed?: boolean;
}) => {
  const rows = Array.from({ length: o.rows ?? 0 }, (_, i) => ({
    account: ACC_A,
    conversationId: "c1",
    recipientId: "p-c1",
    inboundMessageId: `in${i + 1}`,
    actor: "auto:cam",
    payloadDigest: "d".repeat(64),
    generation: "0".repeat(32),
    state: "claimed",
    claimedAt: "2026-10-17T07:01:00.000Z",
    receiptVersion: 1,
  }));
  const total = o.total ?? rows.length;
  return {
    control: {
      handleId: HANDLE,
      account: ACC_A,
      conversationId: "c1",
      recipientId: "p-c1",
      registeredGeneration: "e".repeat(32),
      evidenceDigest: "f".repeat(64),
      createdAt: "2026-10-17T07:00:00.000Z",
      usedAt: "2026-10-17T07:02:00.000Z",
    },
    conversation: { account: ACC_A, conversationId: "c1", mode: o.mode, revision: o.revision },
    inFlight: rows,
    inFlightTotal: total,
    inFlightTruncated: total > rows.length,
    uncertainTotal: 2,
    ...(o.changed === undefined ? {} : { changed: o.changed }),
  };
};
const ctlCalls = (fake: Fake) => fake.calls.filter((c) => c.includes(CONTROL));

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5B (${lang}): production says why linking a conversation is unavailable and asks nothing`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    stubDmConversation(fake);
    await seedState(page, "/social/inbox/", SETTINGS(lang));
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByTestId("ibx-conv").first().click();
    await expect(page.getByTestId("ibx-msg")).toHaveCount(3);
    const ctl = page.getByTestId("ibx-igctl");
    await expect(ctl).toHaveAttribute("data-key", ctlKey());
    const link = ctl.getByTestId("ibx-igctl-register");
    await expect(link).toBeDisabled();
    await expect(link).toContainText(
      lang === "ar" ? "اربط هذي المحادثة" : "Link this conversation",
    );
    await expect(ctl.getByTestId("ibx-igctl-register-unavailable")).toContainText(
      lang === "ar" ? "لسه ما تأكدنا منه" : "isn't verified yet",
    );
    await expect(ctl.getByTestId("ibx-igctl-takeover")).toHaveCount(0);
    // Selecting a message for a DM never links or takes over anything.
    await page
      .locator('[data-testid="ibx-msg"][data-id="in1"]')
      .getByTestId("ibx-msg-pick")
      .click();
    await expect(link).toBeDisabled();
    await page.waitForTimeout(300);
    expect(await fitsViewport(page)).toBe(true);
    expect(ctlCalls(fake)).toEqual([]);
    expect(fake.nonGet).toEqual([]);
  });

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5B (${lang}): explicit take over and resume of a retained handle, with truthful counts`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    const bodies: unknown[] = [];
    fake.routes[`${CONTROL}/${HANDLE}`] = (u) => {
      expect(u.searchParams.get("account")).toBe(ACC_A);
      return { body: ctlView({ mode: "auto", revision: 0, rows: 20, total: 23 }) };
    };
    fake.routes[`${CONTROL}/${HANDLE}/takeover`] = (_u, body) => {
      bodies.push(body);
      return { body: ctlView({ mode: "human", revision: 1, rows: 1, changed: true }) };
    };
    fake.routes[`${CONTROL}/${HANDLE}/resume`] = (_u, body) => {
      bodies.push(body);
      return { body: ctlView({ mode: "auto", revision: 2, rows: 1, changed: true }) };
    };
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramDmControls: ctlEntry(),
    });
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const item = page.getByTestId("ibx-igctl-recovery-item");
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId("ibx-igctl-status")).toHaveAttribute("data-mode", "auto");
    await page.waitForTimeout(300);
    expect(ctlCalls(fake)).toEqual([]);
    await item.getByTestId("ibx-igctl-check").click();
    const sheet = page.getByTestId("ibx-igctl-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "status");
    await expect(sheet.getByTestId("ibx-igctl-inflight")).toHaveAttribute("data-total", "23");
    await expect(sheet.getByTestId("ibx-igctl-row")).toHaveCount(20);
    await expect(sheet.getByTestId("ibx-igctl-rows-limited")).toContainText(
      lang === "ar" ? "أول 20 من 23" : "first 20 of 23",
    );
    await expect(sheet.getByTestId("ibx-igctl-uncertain-count")).toHaveAttribute("data-count", "2");
    await expect(sheet.getByTestId("ibx-igctl-checked")).toBeVisible();
    expect(await fitsViewport(page)).toBe(true);
    // Take over: an explicit review, then exactly one request.
    await sheet.getByTestId("ibx-igctl-sheet-takeover").click();
    await expect(sheet).toHaveAttribute("data-phase", "review");
    await expect(sheet.getByTestId("ibx-igctl-change")).toHaveAttribute("data-mode", "human");
    await expect(sheet.getByTestId("ibx-igctl-copy")).toContainText(
      lang === "ar" ? "ممكن توصل" : "may still arrive",
    );
    await expect(sheet.getByTestId("ibx-igctl-recipient-id")).toContainText("p-c1");
    expect(bodies).toEqual([]);
    await sheet.getByTestId("ibx-igctl-confirm").click();
    await expect(sheet).toHaveAttribute("data-phase", "done");
    await expect(sheet.getByTestId("ibx-igctl-result")).toHaveAttribute("data-changed", "true");
    expect(bodies).toEqual([{ account: ACC_A, expectedRevision: 0 }]);
    await sheet.getByTestId("ibx-igctl-close").click();
    await expect(sheet).toHaveCount(0);
    await expect(item.getByTestId("ibx-igctl-status")).toHaveAttribute("data-mode", "human");
    // Resume: its own review (no replay, nothing sent now), then exactly one request.
    await item.getByTestId("ibx-igctl-resume").click();
    await expect(sheet).toHaveAttribute("data-phase", "review");
    await expect(sheet.getByTestId("ibx-igctl-copy")).toContainText(
      lang === "ar" ? "ما يعيد الرسائل القديمة" : "doesn't replay past messages",
    );
    await sheet.getByTestId("ibx-igctl-confirm").click();
    await expect(sheet).toHaveAttribute("data-phase", "done");
    expect(bodies).toEqual([
      { account: ACC_A, expectedRevision: 0 },
      { account: ACC_A, expectedRevision: 1 },
    ]);
    expect(fake.nonGet).toEqual([
      `POST ${CONTROL}/${HANDLE}/takeover`,
      `POST ${CONTROL}/${HANDLE}/resume`,
    ]);
    expect(ctlCalls(fake).filter((c) => c.startsWith("GET "))).toHaveLength(1);
    const disk = await dmDisk(page);
    expect(disk.inboxInstagramDmControls[ctlKey()]).toMatchObject({ mode: "auto", revision: 2 });
    expect(disk.inboxInstagramDmControls[ctlKey()].pending).toBeUndefined();
    expect(fake.calls.some((c) => c.includes(DM_SEND))).toBe(false);
  });

for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5B (${lang}): a pending change survives a reload as Check status only; nothing repeats`, async ({
    page,
  }) => {
    const fake = await stubWorker(page);
    fake.routes[`${CONTROL}/${HANDLE}`] = () => ({
      body: ctlView({ mode: "human", revision: 1, rows: 1 }),
    });
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramDmControls: ctlEntry(WORKER, {
        pending: {
          action: "takeover",
          expectedRevision: 0,
          requestedMode: "human",
          at: "2026-10-17T07:03:00.000Z",
        },
        uncertain: "mutation",
      }),
    });
    await page.reload();
    if (lang === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const item = page.getByTestId("ibx-igctl-recovery-item");
    await expect(item.getByTestId("ibx-igctl-blocked")).toBeVisible();
    await expect(item.getByTestId("ibx-igctl-takeover")).toBeDisabled();
    await page.waitForTimeout(400);
    expect(ctlCalls(fake)).toEqual([]);
    await item.getByTestId("ibx-igctl-check").click();
    const sheet = page.getByTestId("ibx-igctl-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "status");
    await expect(sheet.getByTestId("ibx-igctl-resolved")).toBeVisible();
    await expect(sheet.getByTestId("ibx-igctl-observed")).toHaveAttribute("data-mode", "human");
    await page.waitForTimeout(300);
    expect(ctlCalls(fake)).toEqual([`GET ${CONTROL}/${HANDLE}`]);
    expect(fake.nonGet).toEqual([]);
    const disk = await dmDisk(page);
    expect(disk.inboxInstagramDmControls[ctlKey()]).toMatchObject({ mode: "human", revision: 1 });
    expect(disk.inboxInstagramDmControls[ctlKey()].pending).toBeUndefined();
    expect(await fitsViewport(page)).toBe(true);
  });

test("DT-6B-2C-5B: another Worker's conversation link is named and never asked; the token never goes there", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  const old: string[] = [];
  await page.route("https://old.test/**", (route) => {
    old.push(route.request().url());
    return route.abort();
  });
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxInstagramDmControls: ctlEntry("https://old.test"),
  });
  const foreign = page.getByTestId("ibx-igctl-recovery-foreign");
  await expect(foreign).toBeVisible();
  await expect(foreign).toContainText("c1");
  await expect(foreign).toContainText("https://old.test");
  await expect(foreign.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("ibx-igctl-recovery")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(ctlCalls(fake)).toEqual([]);
  expect(old).toEqual([]);
  expect(fake.nonGet).toEqual([]);
});

// 🛟 DT-6B-2C-5B-R1: a review's rows belong to the exact durable record they were recorded as (another tab's newer check
// of the same revision shows its totals, rows not loaded), and a Settings restore merges into what storage holds now
// (another tab's pending takeover survives an ordinary backup even before this tab hears about it).
for (const lang of ["en", "ar"] as const)
  test(`DT-6B-2C-5B-R1 (${lang}): a review after another tab's newer same-revision check shows its totals, not old rows`, async ({
    page,
    context,
  }) => {
    const fake = await stubWorker(page);
    fake.routes[`${CONTROL}/${HANDLE}`] = () => ({
      body: ctlView({ mode: "auto", revision: 0, rows: 1, total: 1 }),
    });
    await seedState(page, "/social/inbox/", {
      ...SETTINGS(lang),
      inboxInstagramDmControls: ctlEntry(),
    });
    const item = page.getByTestId("ibx-igctl-recovery-item");
    await item.getByTestId("ibx-igctl-check").click();
    const sheet = page.getByTestId("ibx-igctl-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "status");
    await expect(sheet.getByTestId("ibx-igctl-row")).toHaveCount(1);
    await sheet.getByTestId("ibx-igctl-close").click();
    await expect(sheet).toHaveCount(0);
    // Another tab checks the same revision and saves newer counts.
    const other = await context.newPage();
    const otherFake = await stubWorker(other);
    otherFake.routes[`${CONTROL}/${HANDLE}`] = () => ({
      body: ctlView({ mode: "auto", revision: 0, rows: 0, total: 7 }),
    });
    await other.goto("/social/inbox/");
    await other.getByTestId("ibx-igctl-recovery-item").getByTestId("ibx-igctl-check").click();
    await expect(other.getByTestId("ibx-igctl-sheet")).toHaveAttribute("data-phase", "status");
    await other.close();
    await expect(item.getByTestId("ibx-igctl-inflight")).toHaveAttribute("data-total", "7");
    await item.getByTestId("ibx-igctl-takeover").click();
    await expect(sheet).toHaveAttribute("data-phase", "review");
    await expect(sheet.getByTestId("ibx-igctl-inflight")).toHaveAttribute("data-total", "7");
    await expect(sheet.getByTestId("ibx-igctl-row")).toHaveCount(0);
    await expect(sheet.getByTestId("ibx-igctl-rows-not-loaded")).toBeVisible();
    expect(await fitsViewport(page)).toBe(true);
    expect(ctlCalls(fake)).toEqual([`GET ${CONTROL}/${HANDLE}`]);
    expect(fake.nonGet).toEqual([]);
    expect(otherFake.nonGet).toEqual([]);
  });

test("DT-6B-2C-5B-R1: a Settings restore keeps another tab's pending takeover and says it imported", async ({
  page,
  context,
}) => {
  // Test-only scheduling: this tab's storage events wait in a queue, so the restore runs before it hears about the
  // other tab's pending write (nothing is fabricated; both writes are the app's own).
  await page.addInitScript(() => {
    const w = window as unknown as { __queue: (() => void)[]; __hold: boolean };
    const add = window.addEventListener;
    w.__queue = [];
    w.__hold = true;
    window.addEventListener = function (
      this: Window,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== "storage") return add.call(this, type, listener, options);
      const wrapped = (e: Event) => {
        const run = () =>
          typeof listener === "function" ? listener.call(window, e) : listener.handleEvent(e);
        if (w.__hold) w.__queue.push(run);
        else run();
      };
      return add.call(this, type, wrapped, options);
    } as typeof window.addEventListener;
  });
  await seedState(page, "/social/inbox/", {
    ...SETTINGS(),
    inboxInstagramDmControls: ctlEntry(),
  });
  await expect(page.getByTestId("ibx-igctl-recovery-item")).toHaveCount(1);
  await page.goto("/settings/");
  const downloadReady = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const actualExport = await downloadReady;
  const backup = await fs.readFile((await actualExport.path())!, "utf-8");
  await page.getByTestId("import-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await expect(page.getByTestId("confirm-ok")).toBeVisible();
  const other = await context.newPage();
  const fake = await stubWorker(other);
  let answer!: () => void;
  const held = new Promise<void>((r) => (answer = r));
  fake.routes[`${CONTROL}/${HANDLE}/takeover`] = async () => {
    await held;
    return { status: 502, body: { error: "receipt_unavailable" } };
  };
  try {
    await other.goto("/social/inbox/");
    await other.getByTestId("ibx-igctl-recovery-item").getByTestId("ibx-igctl-takeover").click();
    const sheet = other.getByTestId("ibx-igctl-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "review");
    await sheet.getByTestId("ibx-igctl-confirm").click();
    await expect.poll(() => fake.nonGet.length).toBe(1);
    await expect
      .poll(async () => (await dmDisk(page)).inboxInstagramDmControls[ctlKey()].pending?.action)
      .toBe("takeover");
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("confirm-ok")).toHaveCount(0);
    await expect(page.getByText("Progress imported ✓")).toBeVisible();
    const after = (await dmDisk(page)).inboxInstagramDmControls[ctlKey()];
    expect(after.pending).toMatchObject({
      action: "takeover",
      expectedRevision: 0,
      requestedMode: "human",
    });
    answer();
    await expect(sheet).toHaveAttribute("data-phase", "uncertain");
    expect((await dmDisk(page)).inboxInstagramDmControls[ctlKey()]).toMatchObject({
      pending: { action: "takeover" },
      uncertain: "mutation",
    });
    expect(fake.nonGet).toEqual([`POST ${CONTROL}/${HANDLE}/takeover`]);
  } finally {
    answer();
    await page.evaluate(() => {
      const w = window as unknown as { __queue: (() => void)[]; __hold: boolean };
      w.__hold = false;
      w.__queue.splice(0).forEach((run) => run());
    });
    await other.close();
  }
});
