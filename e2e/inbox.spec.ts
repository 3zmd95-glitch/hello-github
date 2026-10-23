import { expect, test, type Page } from "@playwright/test";
import type {
  InboxComment,
  InboxConversation,
  InboxMessage,
  InboxOverview,
  InboxPost,
} from "../lib/domain";
import { freshState, switchLang } from "./helpers";

// 📥 The Inbox page, against a fake Scout Worker at https://scout.test stubbed with page.route (same pattern as
// autoreplies.spec.ts): the conversation and the post it lists, the "new" chip and the seen marks the store keeps,
// the tabs, Refresh, "Load older", what the page does without a Worker, and the sends (a DM, a comment's replies,
// hide and delete), whose stubbed POST bodies the cases assert.
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

/** "Now" for the cases that look at "Reply privately": inside the comments' 7-day window, whatever today is. */
const COMMENTS_NOW = new Date("2026-10-22T10:00:00.000Z");

/** The cursors the fake hands out as `next`; the page must send them back unchanged as `before`. */
const CONVERSATIONS_NEXT = "2026-10-22T09:05:00.000Z|t1";
const THREAD_NEXT = "2026-10-22T09:00:00.000Z|m-1";

interface Call {
  method: string;
  path: string;
  before: string | null;
  /** The JSON a POST sent (a send's `{ text }`, a hide's `{ hidden }`); null for a call without one. */
  body: unknown;
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
  /** Whether Instagram still lets the owner reply to the thread (the 24-hour window). */
  windowOpen: boolean;
  /** The post's comments, newest first; a hide, a delete and a reply change them as the Worker's store would. */
  comments: InboxComment[];
  /** A refusal every send is answered with, until it is cleared. */
  sendError: { status: number; body: unknown } | null;
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
    windowOpen: true,
    comments: COMMENTS,
    sendError: null,
  };
  /** What the Worker stores of a send: the text clipped to 120 characters for its log (workers/scout). */
  const clip = (text: unknown) => String(text).slice(0, 120);
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
    const body = req.method() === "POST" && req.postData() ? req.postDataJSON() : null;
    fake.requests.push({ method: req.method(), path: url.pathname, before, body });
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
      const window = { open: fake.windowOpen, closesAt: SARA.windowClosesAt };
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
      return json({ post: POST, comments: fake.comments, more: false, next: null });
    }

    // The sends (workers/scout/README.md, "Global inbox"): what the Worker keeps changes what the page reads next.
    if (req.method() === "POST" && url.pathname === "/social/inbox/conversations/t1/send") {
      if (fake.sendError) return json(fake.sendError.body, fake.sendError.status);
      const sent = message(
        `mid.${fake.thread.length + 1}`,
        "2026-10-22T09:30:00.000Z",
        "owner",
        clip((body as { text: unknown }).text),
      );
      fake.thread = [...fake.thread, sent];
      return json({ message: sent });
    }
    const act = url.pathname.match(
      /^\/social\/inbox\/comments\/instagram\/([^/]+?)(?:\/(reply|private|hide))?$/,
    );
    if (act) {
      const [, id, verb] = act;
      const target = fake.comments.find((c) => c.id === id);
      if (fake.sendError && req.method() !== "DELETE") {
        return json(fake.sendError.body, fake.sendError.status);
      }
      if (!target) return json({ error: "not_found" }, 404);
      if (req.method() === "DELETE" && !verb) {
        if (!target.ours) return json({ error: "no_permission" }, 403);
        fake.comments = fake.comments.filter((c) => c.id !== id);
        return json({ ok: true });
      }
      if (req.method() === "POST" && verb === "hide") {
        const { hidden } = body as { hidden: boolean };
        fake.comments = fake.comments.map((c) => (c.id === id ? { ...c, hidden } : c));
        return json({ ok: true });
      }
      if (req.method() === "POST" && verb === "reply") {
        // A reply to a reply is stored under the top-level comment.
        const row = comment(`r${fake.comments.length}`, "2026-10-22T09:40:00.000Z", {
          parentId: target.parentId ?? id,
          author: "3z.prod",
          text: clip((body as { text: unknown }).text),
          ours: true,
          sentBy: "owner",
        });
        fake.comments = [row, ...fake.comments];
        return json({ reply: row });
      }
      if (req.method() === "POST" && verb === "private") return json({ message: { id: "mid.p1" } });
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
  // This was the very first read, after every fixture time: the older row is history, not news.
  await expect(rows.nth(1).getByTestId("inbox-new")).toHaveCount(0);

  // The first read had no cursor; the older page used the Worker's (a 15 s poll may add more first-page reads).
  const befores = () => calls(fake, "GET", "/social/inbox/conversations").map((c) => c.before);
  expect(befores()[0]).toBeNull();
  await expect.poll(befores).toContain(CONVERSATIONS_NEXT);
  expect(await fitsViewport(page)).toBe(true);
});

// The Worker answers every thread page oldest first, and `next` pages toward older messages
// (workers/scout/README.md, "Global inbox").
test("a thread reads oldest to newest, and older messages land above", async ({ page }) => {
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

/* ---------- sending: the DM box, a comment's replies, hide and delete ---------- */

/** Opens Sara's thread from the list. */
async function openThread(page: Page) {
  await page.goto("/social/inbox/");
  await page.getByTestId("inbox-conversation").click();
  const thread = page.getByTestId("inbox-thread");
  await expect(thread.getByTestId("inbox-message")).toHaveCount(2);
  return thread;
}

/** Opens the post's comments from the list. */
async function openComments(page: Page) {
  await page.goto("/social/inbox/");
  await page.getByTestId("inbox-post-row").click();
  const sheet = page.getByTestId("inbox-post");
  await expect(sheet.getByTestId("inbox-comment")).toHaveCount(3);
  return sheet;
}

/** The controls of one comment: Reply, Reply privately, the ⋯ menu and the boxes they open. */
const actionsOf = (sheet: ReturnType<Page["locator"]>, id: string) =>
  sheet.locator(`[data-testid="inbox-comment-actions"][data-id="${id}"]`);

test("a DM is sent as typed, counted in bytes, and the thread reads again with it", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  const thread = await openThread(page);

  // Instagram still lets us reply, until the time the Worker says.
  await expect(thread.getByTestId("inbox-reply-window")).toContainText("تقدر ترد لين");
  const text = thread.getByTestId("inbox-reply-text");
  const send = thread.getByTestId("inbox-reply-send");
  await expect(send).toBeDisabled();
  await text.fill("هلا والله"); // 8 Arabic letters (2 bytes each) and a space: 17 bytes
  await expect(thread.getByTestId("inbox-reply-left")).toHaveText("باقي تقريباً 983");
  await expect(send).toBeEnabled();
  await send.click();

  const status = thread.getByTestId("inbox-reply-result").getByRole("status");
  await expect(status).toHaveText("انرسل");
  await expect(thread.getByTestId("inbox-reply-result").getByRole("alert")).toHaveText("");
  await expect(text).toHaveValue("");
  const sent = calls(fake, "POST", "/social/inbox/conversations/t1/send");
  expect(sent.map((c) => c.body)).toEqual([{ text: "هلا والله" }]);
  // The thread was read again, and the new line is the owner's (never spliced in from the send's answer).
  const bubbles = thread.getByTestId("inbox-message");
  await expect(bubbles).toHaveCount(3);
  await expect(bubbles.last()).toHaveAttribute("data-from", "owner");
  await expect(bubbles.last()).toContainText("هلا والله");
  expect(calls(fake, "GET", "/social/inbox/conversations/t1")).toHaveLength(2);
  expect(await fitsViewport(page)).toBe(true);
});

test("a closed reply window turns the DM box off and says why", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.windowOpen = false;
  await freshState(page, "/settings/");
  await connectWorker(page);
  const thread = await openThread(page);

  await expect(thread.getByTestId("inbox-reply-reason")).toHaveText(
    "إنستقرام ما يسمح بالرد الحين؛ لازم الشخص يكتب لك أول",
  );
  await expect(thread.getByTestId("inbox-reply-window")).toHaveCount(0);
  await expect(thread.getByTestId("inbox-reply-text")).toBeDisabled();
  await expect(thread.getByTestId("inbox-reply-send")).toBeDisabled();
  expect(calls(fake, "POST", "/social/inbox/conversations/t1/send")).toHaveLength(0);
  expect(await fitsViewport(page)).toBe(true);
});

test("the counter counts a DM in bytes: 4-byte emoji refuse before the characters do", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  const thread = await openThread(page);
  const text = thread.getByTestId("inbox-reply-text");
  const left = thread.getByTestId("inbox-reply-left");
  const send = thread.getByTestId("inbox-reply-send");

  // 251 emoji are 251 letters to the eye but 1,004 bytes: over Instagram's 1,000-byte limit.
  await text.fill("🎬".repeat(251));
  await expect(left).toHaveText("النص أطول من الحد المسموح");
  await expect(left).toHaveClass(/text-danger/);
  await expect(send).toBeDisabled();

  // 250 are exactly 1,000 bytes: nothing left, in red, and still allowed.
  await text.fill("🎬".repeat(250));
  await expect(left).toHaveText("باقي تقريباً 0");
  await expect(left).toHaveClass(/text-danger/);
  await expect(send).toBeEnabled();
  expect(calls(fake, "POST", "/social/inbox/conversations/t1/send")).toHaveLength(0);
});

test("a send that may have gone out keeps the text and says so", async ({ page }) => {
  const fake = await stubWorker(page);
  fake.sendError = { status: 502, body: { error: "upstream", detail: "unconfirmed" } };
  await freshState(page, "/settings/");
  await connectWorker(page);
  const thread = await openThread(page);

  await thread.getByTestId("inbox-reply-text").fill("هلا والله");
  await thread.getByTestId("inbox-reply-send").click();
  const result = thread.getByTestId("inbox-reply-result");
  await expect(result.getByRole("status")).toHaveText(
    "ما تأكد الإرسال؛ شيّك المحادثة قبل ما ترسل مرة ثانية",
  );
  await expect(result.getByRole("alert")).toHaveText("");
  await expect(thread.getByTestId("inbox-reply-text")).toHaveValue("هلا والله");
  await expect(thread.getByTestId("inbox-reply-send")).toBeEnabled();
  expect(calls(fake, "POST", "/social/inbox/conversations/t1/send")).toHaveLength(1);
  // Nothing was stored, so the thread is as it was.
  await expect(thread.getByTestId("inbox-message")).toHaveCount(2);
});

test("a comment is answered in public and in private, and hidden then shown again", async ({
  page,
}) => {
  await page.clock.setFixedTime(COMMENTS_NOW);
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  const sheet = await openComments(page);
  const nora = actionsOf(sheet, "c1");

  // A public reply, under the comment, with the box counting characters.
  await nora.getByTestId("inbox-reply-toggle").click();
  const reply = nora.getByTestId("inbox-comment-reply-text");
  await reply.fill("حياك الله");
  await expect(nora.getByTestId("inbox-comment-reply-left")).toHaveText("باقي تقريباً 2191");
  await nora.getByTestId("inbox-comment-reply-send").click();
  await expect(nora.getByTestId("inbox-comment-reply-result").getByRole("status")).toHaveText(
    "انرسل",
  );
  await expect(sheet.getByTestId("inbox-comment")).toHaveCount(4);
  const ours = sheet.locator('[data-reply-to="c1"] [data-testid="inbox-comment"]');
  await expect(ours).toHaveCount(2);
  await expect(ours.first()).toContainText("أرسلته لك على الخاص");
  await expect(ours.last()).toContainText("حياك الله");
  await expect(ours.last()).toContainText("أنت");
  expect(
    calls(fake, "POST", "/social/inbox/comments/instagram/c1/reply").map((c) => c.body),
  ).toEqual([{ text: "حياك الله" }]);

  // A private reply is the same box, switched: one at a time.
  await nora.getByTestId("inbox-private-toggle").click();
  await expect(nora.getByTestId("inbox-comment-reply")).toHaveCount(0);
  await nora.getByTestId("inbox-comment-private-text").fill("هذا اللت");
  await nora.getByTestId("inbox-comment-private-send").click();
  await expect(nora.getByTestId("inbox-comment-private-result").getByRole("status")).toHaveText(
    "انرسل",
  );
  expect(
    calls(fake, "POST", "/social/inbox/comments/instagram/c1/private").map((c) => c.body),
  ).toEqual([{ text: "هذا اللت" }]);

  // Hide it: the view reads again and shows it hidden, and the menu now offers to show it.
  const comment1 = sheet.locator('[data-testid="inbox-comment"][data-id="c1"]');
  await expect(comment1).toHaveAttribute("data-hidden", "false");
  await nora.getByTestId("inbox-comment-menu").click();
  await expect(nora.getByTestId("inbox-comment-hide")).toHaveText("إخفاء");
  await nora.getByTestId("inbox-comment-hide").click();
  await expect(comment1).toHaveAttribute("data-hidden", "true");
  expect(
    calls(fake, "POST", "/social/inbox/comments/instagram/c1/hide").map((c) => c.body),
  ).toEqual([{ hidden: true }]);
  await nora.getByTestId("inbox-comment-menu").click();
  await expect(nora.getByTestId("inbox-comment-hide")).toHaveText("إظهار");
  await nora.getByTestId("inbox-comment-hide").click();
  await expect(comment1).toHaveAttribute("data-hidden", "false");
  expect(
    calls(fake, "POST", "/social/inbox/comments/instagram/c1/hide").map((c) => c.body),
  ).toEqual([{ hidden: true }, { hidden: false }]);
  expect(await fitsViewport(page)).toBe(true);
});

test("no private reply is offered on a comment older than 7 days: Instagram would refuse it", async ({
  page,
}) => {
  await page.clock.setFixedTime(COMMENTS_NOW);
  const fake = await stubWorker(page);
  fake.comments = [
    ...COMMENTS,
    comment("c9", "2026-10-14T09:00:00.000Z", { author: "old_friend", text: "قديم" }),
  ];
  await freshState(page, "/settings/");
  await connectWorker(page);
  await page.goto("/social/inbox/");
  await page.getByTestId("inbox-post-row").click();
  const sheet = page.getByTestId("inbox-post");
  await expect(sheet.getByTestId("inbox-comment")).toHaveCount(4);
  await expect(actionsOf(sheet, "c1").getByTestId("inbox-private-toggle")).toBeVisible();
  const old = actionsOf(sheet, "c9");
  await expect(old.getByTestId("inbox-reply-toggle")).toBeVisible();
  await expect(old.getByTestId("inbox-private-toggle")).toHaveCount(0);
});

test("Delete is offered on our own reply only, behind a confirmation", async ({ page }) => {
  await page.clock.setFixedTime(COMMENTS_NOW);
  const fake = await stubWorker(page);
  await freshState(page, "/settings/");
  await connectWorker(page);
  const sheet = await openComments(page);

  // Someone else's comment: the menu has Hide and no Delete; and no private reply to ourselves on ours.
  const nora = actionsOf(sheet, "c1");
  await nora.getByTestId("inbox-comment-menu").click();
  await expect(nora.getByTestId("inbox-comment-hide")).toBeVisible();
  await expect(nora.getByTestId("inbox-comment-delete")).toHaveCount(0);
  await expect(nora.getByTestId("inbox-private-toggle")).toBeVisible();
  const mine = actionsOf(sheet, "c2");
  await expect(mine.getByTestId("inbox-private-toggle")).toHaveCount(0);
  await mine.getByTestId("inbox-comment-menu").click();
  await expect(mine.getByTestId("inbox-comment-delete")).toBeVisible();

  // Cancel asks nothing of the Worker.
  await mine.getByTestId("inbox-comment-delete").click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toContainText("نحذف هذا الرد من إنستقرام؟ ما ينرجع.");
  await page.getByTestId("confirm-cancel").click();
  await expect(dialog).toHaveCount(0);
  expect(calls(fake, "DELETE", "/social/inbox/comments/instagram/c2")).toHaveLength(0);
  await expect(sheet.getByTestId("inbox-comment")).toHaveCount(3);

  // Confirm deletes it, and the view reads again without it.
  await mine.getByTestId("inbox-comment-menu").click();
  await mine.getByTestId("inbox-comment-delete").click();
  await page.getByTestId("confirm-ok").click();
  await expect(sheet.getByTestId("inbox-comment")).toHaveCount(2);
  await expect(sheet.locator('[data-testid="inbox-comment"][data-id="c2"]')).toHaveCount(0);
  expect(calls(fake, "DELETE", "/social/inbox/comments/instagram/c2")).toHaveLength(1);
  expect(await fitsViewport(page)).toBe(true);
});

test("a refused hide shows the reason under the comment and leaves it as it was", async ({
  page,
}) => {
  const fake = await stubWorker(page);
  fake.sendError = { status: 403, body: { error: "no_permission" } };
  await freshState(page, "/settings/");
  await connectWorker(page);
  const sheet = await openComments(page);
  const nora = actionsOf(sheet, "c1");

  await nora.getByTestId("inbox-comment-menu").click();
  await nora.getByTestId("inbox-comment-hide").click();
  const error = nora.getByTestId("inbox-comment-error");
  await expect(error).toHaveText("ما عندنا إذن الرد؛ اضغط «اسمح بالرسائل».");
  await expect(error).toHaveAttribute("role", "alert");
  expect(calls(fake, "POST", "/social/inbox/comments/instagram/c1/hide")).toHaveLength(1);
  await expect(sheet.locator('[data-testid="inbox-comment"][data-id="c1"]')).toHaveAttribute(
    "data-hidden",
    "false",
  );

  // Opening a box clears the old refusal.
  await nora.getByTestId("inbox-reply-toggle").click();
  await expect(error).toHaveCount(0);
  expect(await fitsViewport(page)).toBe(true);
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
