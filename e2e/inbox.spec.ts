import { expect, test, type Page } from "@playwright/test";
import type {
  InboxComment,
  InboxConversation,
  InboxMessage,
  InboxOverview,
  InboxPost,
} from "../lib/domain";
import { freshState, switchLang } from "./helpers";

// 📥 The Inbox page (read only), against a fake Scout Worker at https://scout.test stubbed with page.route (same
// pattern as autoreplies.spec.ts): the conversation and the post it lists, the "new" chip and the seen marks the
// store keeps, the tabs, Refresh, "Load older", and what the page does without a Worker.
const WORKER = "https://scout.test";
const TOKEN = "fake-scout-token";
const STORAGE_KEY = "3z-prod-v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

/* ---------- what the Worker keeps ---------- */

const SARA: InboxConversation = {
  platform: "instagram",
  id: "t1",
  peerId: "p1",
  peerName: "سارة",
  updatedAt: "2026-10-22T09:05:00.000Z",
  lastText: "حمل اللت من الرابط تحت",
  lastFrom: "auto",
  windowClosesAt: "2026-10-23T09:00:00.000Z",
  answeredBy: "auto",
};
const KHALID: InboxConversation = {
  ...SARA,
  id: "t0",
  peerId: "p0",
  peerName: "خالد",
  updatedAt: "2026-10-21T18:00:00.000Z",
  lastText: "شكراً على المحتوى",
  lastFrom: "peer",
  windowClosesAt: null,
  answeredBy: null,
};
const POST: InboxPost = {
  platform: "instagram",
  id: "m1",
  permalink: "https://www.instagram.com/reel/LUT1/",
  thumbUrl: null,
  caption: "T&O LUT reel",
  postedAt: "2026-10-20T18:00:00.000Z",
  commentCount: 3,
};
const OVERVIEW: InboxOverview = {
  platforms: {
    instagram: {
      connected: true,
      canReply: true,
      tokenExpired: false,
      lastReadAt: "2026-10-22T09:06:00.000Z",
      newestAt: "2026-10-22T09:05:00.000Z",
    },
    tiktok: {
      connected: false,
      canReply: false,
      tokenExpired: false,
      lastReadAt: null,
      newestAt: null,
    },
  },
  counts: { conversations: 1, posts: 1, comments: 3 },
};

const message = (
  id: string,
  at: string,
  sentBy: InboxMessage["sentBy"],
  text: string,
): InboxMessage => ({
  platform: "instagram",
  convId: "t1",
  id,
  at,
  fromPeer: sentBy === "peer",
  text,
  kind: "text",
  sentBy,
});
/** A thread page the way the Worker answers it: oldest first (workers/scout/README.md, "Global inbox"). */
const THREAD = [
  message("m-1", "2026-10-22T09:00:00.000Z", "peer", "ابغى اللت"),
  message("m-2", "2026-10-22T09:05:00.000Z", "auto", "حمل اللت من الرابط تحت"),
];
const THREAD_OLDER = [message("m-0", "2026-10-22T08:00:00.000Z", "peer", "السلام عليكم")];

const comment = (
  id: string,
  at: string,
  over: Partial<InboxComment> & Pick<InboxComment, "author" | "text">,
): InboxComment => ({
  platform: "instagram",
  postId: "m1",
  id,
  parentId: null,
  at,
  authorId: null,
  hidden: false,
  ours: false,
  sentBy: null,
  ...over,
});
/** Newest first, as the Worker answers. */
const COMMENTS = [
  comment("c2", "2026-10-22T09:00:00.000Z", {
    parentId: "c1",
    author: "3z.prod",
    text: "أرسلته لك على الخاص 🎬",
    ours: true,
    sentBy: "auto",
  }),
  comment("c1", "2026-10-22T08:00:00.000Z", { author: "nora", text: "وين اللت؟" }),
  comment("c0", "2026-10-22T07:00:00.000Z", {
    author: "spam_bot",
    text: "اشترك الحين",
    hidden: true,
  }),
];

/** The cursors the fake hands out as `next`; the page must send them back unchanged as `before`. */
const CONVERSATIONS_NEXT = "2026-10-22T09:05:00.000Z|t1";
const THREAD_NEXT = "2026-10-22T09:00:00.000Z|m-1";

interface Call {
  method: string;
  path: string;
  before: string | null;
}

interface Fake {
  /** Every Worker call the page made (preflights aside), in order. */
  requests: Call[];
  /** The first page of conversations; `older` is the page behind `CONVERSATIONS_NEXT`. */
  conversations: InboxConversation[];
  older: InboxConversation[];
  /** The thread's first page, and the page behind `THREAD_NEXT`. */
  thread: InboxMessage[];
  threadOlder: InboxMessage[];
}

/** The calls the page made to one route. */
const calls = (fake: Fake, method: string, path: string) =>
  fake.requests.filter((c) => c.method === method && c.path === path);

async function stubWorker(page: Page): Promise<Fake> {
  const fake: Fake = {
    requests: [],
    conversations: [SARA],
    older: [],
    thread: THREAD,
    threadOlder: [],
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
    const before = url.searchParams.get("before");
    fake.requests.push({ method: req.method(), path: url.pathname, before });
    if (req.headers()["authorization"] !== `Bearer ${TOKEN}`)
      return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/health") {
      return json({ ok: true, auth: true, tavily: true, social: { configured: {}, kv: true } });
    }
    if (url.pathname === "/social/status") {
      return json({
        platforms: {
          tiktok: { configured: true, connected: true, canPublish: true, handle: "3z.prod" },
          instagram: {
            configured: true,
            connected: true,
            canPublish: true,
            canReply: true,
            handle: "3z.prod",
          },
          youtube: { configured: true, connected: false, canPublish: false },
          threads: { configured: false, connected: false, canPublish: false },
        },
      });
    }
    if (url.pathname === "/social/data") {
      return json({
        accounts: [{ platform: "instagram", handle: "3z.prod" }],
        snapshots: [],
        postStats: [],
        demographics: [],
        syncedAt: { instagram: "2026-10-22T03:00:00Z" },
      });
    }
    if (url.pathname === "/social/publish") return json({ jobs: [] });
    if (url.pathname === "/social/sync") return json({ synced: ["instagram"], errors: {} });
    if (url.pathname === "/social/replies" && req.method() === "GET")
      return json({ automations: [], log: [], paused: false });

    // The inbox (workers/scout/README.md, "Global inbox"): a page is `{ …, more, next }`, `next` goes back as `before`.
    if (url.pathname === "/social/inbox" && req.method() === "GET") {
      return json({
        ...OVERVIEW,
        counts: { ...OVERVIEW.counts, conversations: fake.conversations.length },
      });
    }
    if (url.pathname === "/social/inbox/refresh" && req.method() === "POST") {
      return json({ scanRequestedAt: "2026-10-22T09:10:00.000Z" });
    }
    if (url.pathname === "/social/inbox/conversations" && req.method() === "GET") {
      if (before === CONVERSATIONS_NEXT)
        return json({ conversations: fake.older, more: false, next: null });
      if (before !== null) return json({ error: "bad_request" }, 400);
      const more = fake.older.length > 0;
      return json({
        conversations: fake.conversations,
        more,
        next: more ? CONVERSATIONS_NEXT : null,
      });
    }
    if (url.pathname === "/social/inbox/conversations/t1" && req.method() === "GET") {
      const window = { open: true, closesAt: SARA.windowClosesAt };
      if (before === THREAD_NEXT)
        return json({
          conversation: SARA,
          messages: fake.threadOlder,
          more: false,
          next: null,
          window,
        });
      const more = fake.threadOlder.length > 0;
      return json({
        conversation: SARA,
        messages: fake.thread,
        more,
        next: more ? THREAD_NEXT : null,
        window,
      });
    }
    if (url.pathname === "/social/inbox/posts" && req.method() === "GET") {
      return json({ posts: [POST], more: false, next: null });
    }
    if (url.pathname === "/social/inbox/posts/instagram/m1/comments" && req.method() === "GET") {
      return json({ post: POST, comments: COMMENTS, more: false, next: null });
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

/**
 * The store as an earlier visit left it. The very first read takes everything it finds as history (no chips), so
 * a test that wants a "new" chip needs a store that already holds a seen mark. Done in an init script, before any
 * page code of the next navigation runs, so no store write of the page being left can undo it.
 */
async function afterAnEarlierVisit(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem("seeded")) return; // once: a reload keeps what the page stored since
    sessionStorage.setItem("seeded", "1");
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as { state?: object };
    const state = {
      ...saved.state,
      inboxSeen: { "instagram:post:earlier": "2026-10-01T00:00:00.000Z" },
    };
    localStorage.setItem(key, JSON.stringify({ ...saved, state }));
  }, STORAGE_KEY);
}

test("More opens the Inbox: a new conversation is marked until its thread is opened, and stays read after a reload", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  await afterAnEarlierVisit(page);

  await page.goto("/social/more/");
  await page.getByTestId("more-inbox").click();
  await expect(page).toHaveURL(/\/social\/inbox\/$/);
  await expect(page.getByTestId("inbox-screen")).toBeVisible();

  const conversations = page.getByTestId("inbox-messages").getByTestId("inbox-conversation");
  const posts = page.getByTestId("inbox-comments").getByTestId("inbox-post-row");
  await expect(conversations).toHaveCount(1);
  await expect(conversations).toHaveAttribute("data-id", "t1");
  await expect(conversations).toContainText("سارة");
  await expect(conversations).toContainText("رد تلقائي: حمل اللت من الرابط تحت");
  await expect(posts).toHaveCount(1);
  await expect(posts).toContainText("T&O LUT reel");
  await expect(posts).toContainText("3 تعليق");
  // Neither was ever opened.
  await expect(conversations.getByTestId("inbox-new")).toHaveText("جديد");
  await expect(posts.getByTestId("inbox-new")).toHaveText("جديد");
  expect(await fitsViewport(page)).toBe(true);

  await conversations.click();
  const thread = page.getByTestId("inbox-thread");
  await expect(thread).toBeVisible();
  const bubbles = thread.getByTestId("inbox-message");
  await expect(bubbles).toHaveCount(2);
  const theirs = thread.locator('[data-testid="inbox-message"][data-from="peer"]');
  await expect(theirs).toContainText("ابغى اللت");
  await expect(theirs).not.toContainText("رد تلقائي");
  const auto = thread.locator('[data-testid="inbox-message"][data-from="auto"]');
  await expect(auto).toContainText("حمل اللت من الرابط تحت");
  await expect(auto).toContainText("رد تلقائي"); // the auto-reply chip
  expect(calls(fake, "GET", "/social/inbox/conversations/t1")).toHaveLength(1);
  expect(await fitsViewport(page)).toBe(true);

  // Opened: that row is read at once, the post (not opened) is still new.
  await expect(conversations.getByTestId("inbox-new")).toHaveCount(0);
  await expect(posts.getByTestId("inbox-new")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(thread).toHaveCount(0);
  await expect(conversations.getByTestId("inbox-new")).toHaveCount(0);

  // The mark is in the store, so it survives a reload.
  await page.reload();
  await expect(conversations).toHaveCount(1);
  await expect(conversations.getByTestId("inbox-new")).toHaveCount(0);
  await expect(posts.getByTestId("inbox-new")).toHaveCount(1);
});

test("a post opens its comments, replies under their comment, hidden ones marked; opening it reads the post", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  await afterAnEarlierVisit(page);
  await page.goto("/social/inbox/");

  const post = page.getByTestId("inbox-post-row");
  await expect(post.getByTestId("inbox-new")).toHaveText("جديد");
  await post.click();
  const sheet = page.getByTestId("inbox-post");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("inbox-comment")).toHaveCount(3);
  expect(calls(fake, "GET", "/social/inbox/posts/instagram/m1/comments")).toHaveLength(1);
  await expect(sheet.getByTestId("inbox-open-post")).toHaveAttribute("href", POST.permalink);

  // The auto reply sits under the comment it answers, with its mark.
  const reply = sheet.locator('[data-reply-to="c1"] [data-testid="inbox-comment"]');
  await expect(reply).toHaveAttribute("data-id", "c2");
  await expect(reply).toContainText("أرسلته لك على الخاص 🎬");
  await expect(reply).toContainText("رد تلقائي");
  const spam = sheet.locator('[data-testid="inbox-comment"][data-id="c0"]');
  await expect(spam).toHaveAttribute("data-hidden", "true");
  await expect(spam).toContainText("مخفي");
  await expect(sheet.locator('[data-testid="inbox-comment"][data-id="c1"]')).toHaveAttribute(
    "data-hidden",
    "false",
  );
  expect(await fitsViewport(page)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(post.getByTestId("inbox-new")).toHaveCount(0);
});

test("English: the tabs switch and keep their place across a reload, TikTok points to its own app", async ({
  page,
  isMobile,
}) => {
  await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/");
  await switchLang(page, "en");
  if (isMobile) {
    await page.goto("/social/more/");
    await page.getByTestId("more-inbox").click();
  } else {
    // The sidebar is desktop only; the phone goes through More.
    await page.getByTestId("sidenav").locator('a[href="/social/inbox/"]').click();
  }
  await expect(page).toHaveURL(/\/social\/inbox\/$/);
  const screen = page.getByTestId("inbox-screen");
  await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Inbox");

  const tab = (v: string) => page.getByTestId(`inbox-tab-${v}`);
  const conversations = page.getByTestId("inbox-conversation");
  await expect(tab("all")).toHaveText("All");
  await expect(tab("instagram")).toHaveText("Instagram");
  await expect(tab("tiktok")).toHaveText("TikTok");
  await expect(tab("all")).toHaveAttribute("aria-selected", "true");
  await expect(conversations).toHaveCount(1);
  await expect(page.getByTestId("inbox-post-row")).toHaveCount(1);
  // A fresh install's first read is history, not news: nothing is marked new.
  await expect(page.getByTestId("inbox-new")).toHaveCount(0);

  await tab("instagram").click();
  await expect(tab("instagram")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inbox-panel-instagram")).toBeVisible();
  await expect(conversations).toHaveCount(1);
  await expect(conversations).toHaveAttribute("data-platform", "instagram");

  await tab("tiktok").click();
  await expect(tab("tiktok")).toHaveAttribute("aria-selected", "true");
  await expect(conversations).toHaveCount(0);
  await expect(page.getByTestId("inbox-post-row")).toHaveCount(0);
  await expect(page.getByTestId("inbox-tiktok-dm")).toContainText(
    "TikTok messages aren't available for personal accounts",
  );
  const open = page.getByTestId("inbox-tiktok-open");
  await expect(open).toHaveText("Open TikTok messages ↗");
  await expect(open).toHaveAttribute("href", "https://www.tiktok.com/messages");
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", /noopener/);
  await expect(page.getByTestId("inbox-tiktok-soon")).toHaveText(
    "TikTok comments come once TikTok approves us",
  );
  expect(await fitsViewport(page)).toBe(true);

  await page.reload();
  await expect(tab("tiktok")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("inbox-tiktok-open")).toBeVisible();
  await expect(conversations).toHaveCount(0);
});

test("Refresh asks the Worker once, waits for its next scan, and reads the inbox again", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/inbox/");

  const row = page.getByTestId("inbox-conversation");
  const refresh = page.getByTestId("inbox-refresh");
  await expect(row).toContainText("رد تلقائي: حمل اللت من الرابط تحت");
  await expect(refresh).toHaveText("حدّث الحين");
  await expect(row.getByTestId("inbox-new")).toHaveCount(0); // the very first read is history
  const readsBefore = calls(fake, "GET", "/social/inbox").length;
  expect(readsBefore).toBeGreaterThan(0);
  expect(calls(fake, "POST", "/social/inbox/refresh")).toHaveLength(0);

  // The reader's next tick finds a new message from the person.
  fake.conversations = [
    {
      ...SARA,
      updatedAt: "2026-10-22T10:00:00.000Z",
      lastText: "وصلني اللت شكراً",
      lastFrom: "peer",
    },
  ];
  await refresh.click();
  await expect(refresh).toBeDisabled(); // busy while it waits for the Worker's tick
  await expect(row).toContainText("وصلني اللت شكراً", { timeout: 10_000 });
  await expect(row.getByTestId("inbox-new")).toHaveText("جديد");
  await expect(refresh).toBeEnabled();

  expect(calls(fake, "POST", "/social/inbox/refresh")).toHaveLength(1);
  expect(calls(fake, "GET", "/social/inbox").length).toBeGreaterThan(readsBefore);
  const order = fake.requests.map((c) => `${c.method} ${c.path}`);
  expect(order.lastIndexOf("GET /social/inbox/conversations")).toBeGreaterThan(
    order.indexOf("POST /social/inbox/refresh"),
  );
  expect(await fitsViewport(page)).toBe(true);
});

test("Load older asks for the next page with the Worker's own cursor and adds it below", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.older = [KHALID];
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/inbox/");

  const rows = page.getByTestId("inbox-conversation");
  const more = page.getByTestId("inbox-more-conversations");
  await expect(rows).toHaveCount(1);
  await expect(more).toHaveText("حمّل الأقدم");
  await more.click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-id", "t1");
  await expect(rows.nth(1)).toHaveAttribute("data-id", "t0");
  await expect(rows.nth(1)).toContainText("شكراً على المحتوى");
  await expect(more).toHaveCount(0);

  expect(calls(fake, "GET", "/social/inbox/conversations").map((c) => c.before)).toEqual([
    null,
    CONVERSATIONS_NEXT,
  ]);
  expect(await fitsViewport(page)).toBe(true);
});

// Task 6 defect, found while writing this spec: the Worker answers every thread page OLDEST first and `next` pages
// toward OLDER messages (workers/scout/README.md, "Global inbox"), but ThreadView reverses the page and useThread
// appends an older page after the loaded ones (both assume newest first), so a thread reads newest-first and a
// second page lands in the middle. Expected to fail until those two are fixed; then delete the `test.fail` line.
test("a thread reads oldest to newest, and older messages land above", async ({ page }) => {
  test.fail(true, "Task 6: ThreadView/useThread take the Worker's thread pages for newest-first");
  const fake = await stubWorker(page);
  fake.threadOlder = THREAD_OLDER;
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/inbox/");
  await page.getByTestId("inbox-conversation").click();

  const thread = page.getByTestId("inbox-thread");
  const bubbles = thread.getByTestId("inbox-message");
  const ids = () => bubbles.evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  await expect(bubbles).toHaveCount(2);
  expect(await ids()).toEqual(["m-1", "m-2"]);
  await thread.getByTestId("inbox-load-older").click();
  await expect(bubbles).toHaveCount(3);
  expect(await ids()).toEqual(["m-0", "m-1", "m-2"]);
});

test("without a Worker the page sends you to Settings and asks the Worker for nothing", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/social/inbox/");

  const need = page.getByTestId("inbox-need-worker");
  await expect(need).toBeVisible();
  await expect(need).toContainText("الرسائل تحتاج الوركر شغّال");
  await expect(page.getByTestId("inbox-tab")).toHaveCount(0);
  await expect(page.getByTestId("inbox-refresh")).toHaveCount(0);
  await expect(page.getByTestId("inbox-conversation")).toHaveCount(0);
  const link = page.getByTestId("inbox-screen").getByRole("link", { name: "افتح الإعدادات" });
  await expect(link).toHaveAttribute("href", /\/settings\/?#api-keys$/);
  expect(await fitsViewport(page)).toBe(true);

  await link.click();
  await expect(page).toHaveURL(/\/settings\/#api-keys$/);
  await expect(page.getByTestId("apikey-scoutUrl-input")).toBeVisible();
  expect(fake.requests).toEqual([]);
});
