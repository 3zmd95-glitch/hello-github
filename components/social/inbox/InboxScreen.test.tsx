// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxConversation, InboxOverview, InboxPost } from "@/lib/domain";
import { INBOX_POLL_MS } from "@/lib/inbox";
import { useStore } from "@/store";
import InboxScreen from "./InboxScreen";
import { loadInbox, resetInbox } from "./useInbox";

// 📥 The Inbox page, rendered for real in jsdom against a fake Worker (`fetch`): the tabs, a conversation and a
// post, the "new" chip and the seen mark an open sets, the TikTok tab, the account states, and the reads it makes
// (none without a Worker, a poll only while the page is visible).

vi.mock("next/navigation", () => ({ usePathname: () => "/social/inbox/" }));

const T0 = "2026-10-22T10:00:00.000Z";
const T1 = "2026-10-22T11:00:00.000Z";
const T2 = "2026-10-22T12:00:00.000Z";
/** When the tests' very first read happens (after every fixture time but T2's later news). */
const READ = "2026-10-22T13:00:00.000Z";
/** A mark from an earlier visit: with it, a load is not the very first read (which takes everything as seen). */
const EARLIER = { "instagram:post:earlier": T0 };

type PlatformState = InboxOverview["platforms"]["instagram"];
const platform = (over: Partial<PlatformState> = {}): PlatformState => ({
  connected: true,
  canReply: true,
  tokenExpired: false,
  lastReadAt: T1,
  newestAt: T1,
  ...over,
});
const overview = (ig: Partial<PlatformState> = {}): InboxOverview => ({
  platforms: { instagram: platform(ig), tiktok: platform({ connected: false, canReply: false }) },
  counts: { conversations: 1, posts: 1, comments: 2 },
});
const conv = (over: Partial<InboxConversation> = {}): InboxConversation => ({
  platform: "instagram",
  id: "c1",
  peerId: "p1",
  peerName: "سارة",
  updatedAt: T1,
  lastText: "هلا والله",
  lastFrom: "peer",
  windowClosesAt: null,
  answeredBy: null,
  ...over,
});
const POST: InboxPost = {
  platform: "instagram",
  id: "m1",
  permalink: "https://www.instagram.com/p/abc/",
  thumbUrl: null,
  caption: "مونتاج جديد",
  postedAt: T0,
  commentCount: 3,
};
const message = (id: string, at: string, sentBy: "peer" | "owner" | "auto", text: string) => ({
  platform: "instagram",
  convId: "c1",
  id,
  at,
  fromPeer: sentBy === "peer",
  text,
  kind: "text",
  sentBy,
});
const THREAD = {
  conversation: conv(),
  // Each thread page comes oldest first; its `next` pages toward older messages (workers/scout/README.md).
  messages: [message("m-1", T0, "peer", "هلا"), message("m-2", T1, "auto", "أهلين")],
  more: false,
  next: null,
  window: { open: true, closesAt: null },
};

const comment = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  platform: "instagram",
  postId: "m1",
  id,
  parentId: null,
  at,
  author: "noura",
  authorId: null,
  text: id,
  hidden: false,
  ours: false,
  sentBy: null,
  ...over,
});

type Answer = { status?: number; body: unknown };
let routes: Record<string, Answer>;
let fetchMock: ReturnType<typeof vi.fn>;

/** The fake Worker: "METHOD /path?query" or else "METHOD /path" → answer (no Worker origin). */
function serve(over: Record<string, Answer> = {}) {
  routes = {
    "GET /social/inbox": { body: overview() },
    "GET /social/inbox/conversations": {
      body: { conversations: [conv()], more: false, next: null },
    },
    "GET /social/inbox/posts": { body: { posts: [POST], more: false, next: null } },
    "GET /social/inbox/conversations/c1": { body: THREAD },
    ...over,
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const route = `${init.method ?? "GET"} ${u.pathname}`;
    const a = routes[route + u.search] ?? routes[route] ?? { status: 404, body: {} };
    const status = a.status ?? 200;
    return { ok: status < 400, status, json: async () => a.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

const calls = () =>
  fetchMock.mock.calls.map(
    ([url, init]) =>
      `${(init as RequestInit | undefined)?.method ?? "GET"} ${new URL(url as string).pathname}`,
  );

/** Every request with its query string. */
const urls = () =>
  fetchMock.mock.calls.map(([url, init]) => {
    const u = new URL(url as string);
    return `${(init as RequestInit | undefined)?.method ?? "GET"} ${u.pathname}${u.search}`;
  });
const ids = (testId: string, within: ParentNode = document) =>
  all(testId, within).map((el) => el.getAttribute("data-id"));
/** The very first read, at READ (the fake Worker's current answers), before the page mounts. */
const readFirst = () =>
  act(async () => {
    await loadInbox({ now: new Date(READ) });
  });
/** What the poll does when the page comes back into view: one quiet read. */
async function comeBack() {
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
}

function configure(on = true) {
  const s = useStore.getState();
  s.setSettings({
    apiKeys: {
      ...s.settings.apiKeys,
      scoutUrl: on ? "https://scout.test" : "",
      scoutToken: on ? "t" : "",
    },
  });
}

let host: HTMLDivElement;
let root: Root;

/** Lets the fake Worker's answers land. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<InboxScreen />));
  await settle();
}

const q = (testId: string, within: ParentNode = document) =>
  within.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const all = (testId: string, within: ParentNode = document) => [
  ...within.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver (the tabs are a Segmented) nor matchMedia (the sheets: reduced motion closes at once).
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media.includes("reduce"),
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  resetInbox();
  useStore.setState({ inboxSeen: EARLIER, inboxTab: "all" });
  useStore.getState().setSettings({ lang: "ar" });
  configure();
  serve();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("InboxScreen", () => {
  it("shows the three tabs, the conversation and the post, with the new chip", async () => {
    await mount();
    expect(calls().sort()).toEqual([
      "GET /social/inbox",
      "GET /social/inbox/conversations",
      "GET /social/inbox/posts",
    ]);
    expect(q("inbox-tab")!.getAttribute("role")).toBe("tablist");
    for (const tab of ["all", "instagram", "tiktok"])
      expect(q(`inbox-tab-${tab}`)!.getAttribute("role"), tab).toBe("tab");
    expect(q("inbox-tab-all")!.getAttribute("aria-selected")).toBe("true");
    const panel = document.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe(q("inbox-tab-all")!.id);

    expect(all("inbox-conversation")).toHaveLength(1);
    const [row] = all("inbox-conversation", q("inbox-messages")!);
    expect(row.querySelector("b")!.textContent).toBe("سارة");
    expect(row.querySelector("small")!.textContent).toBe("هلا والله");
    expect(q("inbox-new", row)!.textContent).toBe("جديد");

    expect(all("inbox-post-row")).toHaveLength(1);
    const [post] = all("inbox-post-row", q("inbox-comments")!);
    expect(post.querySelector("b")!.textContent).toBe("مونتاج جديد");
    expect(post.querySelector("small")!.textContent).toBe("3 تعليق");
    expect(q("inbox-new", post)).not.toBeNull();
  });

  it("prefixes the last line with who wrote it, and shows no chip once seen", async () => {
    serve({
      "GET /social/inbox/conversations": {
        body: {
          conversations: [
            conv({ id: "c1", peerId: "p1", lastFrom: "owner", lastText: "تم" }),
            conv({ id: "c2", peerId: "p2", updatedAt: T0, lastFrom: "auto", lastText: "الرابط" }),
          ],
          more: false,
          next: null,
        },
      },
    });
    useStore.getState().markInboxSeen("instagram:conversation:c1", T1);
    await mount();
    const [c1, c2] = all("inbox-conversation");
    expect(c1.querySelector("small")!.textContent).toBe("أنت: تم");
    expect(q("inbox-new", c1)).toBeNull();
    expect(c2.querySelector("small")!.textContent).toBe("رد تلقائي: الرابط");
    expect(q("inbox-new", c2)).not.toBeNull();
  });

  it("opens a conversation in a sheet, marks it seen, and lists its messages oldest first", async () => {
    await mount();
    act(() => all("inbox-conversation")[0].click());
    expect(useStore.getState().inboxSeen["instagram:conversation:c1"]).toBe(T1);
    await settle();
    const sheet = q("inbox-thread")!;
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.textContent).toContain("سارة");
    const msgs = all("inbox-message", sheet);
    expect(msgs.map((m) => m.getAttribute("data-id"))).toEqual(["m-1", "m-2"]);
    expect(msgs[0].className).toContain("self-start");
    expect(msgs[1].className).toContain("self-end");
    expect(msgs[1].textContent).toContain("رد تلقائي");
    expect(calls()).toContain("GET /social/inbox/conversations/c1");
    expect(q("inbox-new", all("inbox-conversation")[0])).toBeNull();
  });

  it("takes everything on the very first read as history: no chips, one mark per item; news then shows", async () => {
    useStore.setState({ inboxSeen: {} });
    await readFirst();
    await mount();
    expect(all("inbox-new")).toHaveLength(0);
    // ...and the read's own time is where history ends (for the rows a "load more" brings later).
    expect(useStore.getState().inboxSeen).toEqual({
      "instagram:conversation:c1": T1,
      "instagram:post:m1": T0,
      "inbox:firstRead": READ,
    });

    routes["GET /social/inbox/conversations"] = {
      body: {
        conversations: [conv({ id: "c2", peerId: "p2", updatedAt: T2 }), conv()],
        more: false,
        next: null,
      },
    };
    await comeBack();
    expect(all("inbox-new")).toHaveLength(1);
    expect(q("inbox-new", all("inbox-conversation")[0])).not.toBeNull();
  });

  it("a first read that finds nothing still counts as the first: what arrives next is new", async () => {
    useStore.setState({ inboxSeen: {} });
    serve({
      "GET /social/inbox/conversations": { body: { conversations: [], more: false, next: null } },
      "GET /social/inbox/posts": { body: { posts: [], more: false, next: null } },
    });
    await mount();
    expect(q("inbox-empty-messages")).not.toBeNull();
    expect(Object.keys(useStore.getState().inboxSeen)).toHaveLength(1);

    routes["GET /social/inbox/conversations"] = {
      body: { conversations: [conv()], more: false, next: null },
    };
    await comeBack();
    expect(all("inbox-new")).toHaveLength(1);
  });

  it("an opened provisional row stays read when the real conversation arrives with the same time", async () => {
    useStore.setState({ inboxSeen: { "instagram:conversation:peer:p1": T1 } });
    serve({
      "GET /social/inbox/conversations": {
        body: { conversations: [conv({ id: "peer:p1" }), conv()], more: false, next: null },
      },
    });
    await mount();
    expect(ids("inbox-conversation")).toEqual(["c1"]);
    expect(q("inbox-new", all("inbox-conversation")[0])).toBeNull();
    // The mark is carried over to the real id (so pruning the provisional one loses nothing).
    expect(useStore.getState().inboxSeen["instagram:conversation:c1"]).toBe(T1);
  });

  it("shows one person once: a provisional conversation and the real one merge, the newest wins", async () => {
    serve({
      "GET /social/inbox/conversations": {
        body: {
          conversations: [
            conv({ id: "peer:p1", updatedAt: T1, lastText: "جديدة" }),
            conv({ id: "c1", updatedAt: T0, lastText: "قديمة" }),
            conv({ id: "c9", peerId: "p9", peerName: "نورة", updatedAt: T0 }),
          ],
          more: false,
          next: null,
        },
      },
    });
    await mount();
    const rows = all("inbox-conversation");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["peer:p1", "c9"]);
    expect(rows[0].querySelector("small")!.textContent).toBe("جديدة");
  });

  it("drops the seen marks of items it no longer lists once there are more than 500", async () => {
    const old = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`instagram:conversation:gone-${i}`, T0]),
    );
    useStore.setState({
      inboxSeen: { ...old, "instagram:conversation:c1": T0, "inbox:firstRead": T0 },
    });
    await mount();
    // Where history ends is kept too.
    expect(useStore.getState().inboxSeen).toEqual({
      "instagram:conversation:c1": T0,
      "inbox:firstRead": T0,
    });

    // At or under the cap nothing is dropped.
    resetInbox();
    useStore.setState({ inboxSeen: { "instagram:conversation:gone-1": T0 } });
    act(() => root.unmount());
    await mount();
    expect(useStore.getState().inboxSeen).toEqual({ "instagram:conversation:gone-1": T0 });
  });

  it("opens a post's comments in a sheet: marks it seen, nests replies, dims hidden ones", async () => {
    serve({
      "GET /social/inbox/posts/instagram/m1/comments": {
        body: {
          post: POST,
          comments: [
            comment("k3", T2, { parentId: "k1", author: "3z", ours: true, sentBy: "owner" }),
            comment("k2", T1, { hidden: true, text: "سبام" }),
            comment("k1", T0, { text: "وش البرنامج؟" }),
          ],
          more: false,
          next: null,
        },
      },
    });
    await mount();
    act(() => all("inbox-post-row")[0].click());
    expect(useStore.getState().inboxSeen["instagram:post:m1"]).toBe(T0);
    await settle();
    expect(calls()).toContain("GET /social/inbox/posts/instagram/m1/comments");
    const sheet = q("inbox-post")!;
    expect(sheet.getAttribute("role")).toBe("dialog");
    // Newest comment first; the reply under its comment.
    expect(ids("inbox-comment", sheet)).toEqual(["k2", "k1", "k3"]);
    const parent = sheet.querySelector<HTMLElement>('[data-testid="inbox-comment"][data-id="k1"]')!;
    const reply = sheet.querySelector('[data-reply-to="k1"]')!;
    expect(parent.closest("li")!.contains(reply)).toBe(true);
    expect(ids("inbox-comment", reply)).toEqual(["k3"]);
    const hidden = sheet.querySelector<HTMLElement>('[data-testid="inbox-comment"][data-id="k2"]')!;
    expect(hidden.getAttribute("data-hidden")).toBe("true");
    expect(hidden.className).toContain("opacity-50");
    expect(hidden.textContent).toContain("مخفي");
    expect(parent.className).not.toContain("opacity-50");
    expect(q("inbox-open-post", sheet)!.getAttribute("href")).toBe(POST.permalink);
  });

  it("keeps one reply box per comment: switching to a private reply keeps its text and its pending send", async () => {
    serve({
      "GET /social/inbox/posts/instagram/m1/comments": {
        body: {
          post: POST,
          comments: [comment("k1", T0, { author: "noura", text: "وين اللت؟" })],
          more: false,
          next: null,
        },
      },
      "POST /social/inbox/comments/instagram/k1/reply": {
        body: { reply: comment("r1", T2, { parentId: "k1", ours: true, sentBy: "owner" }) },
      },
    });
    await mount();
    act(() => all("inbox-post-row")[0].click());
    await settle();
    const sheet = q("inbox-post")!;
    // The reply goes out when the gate opens: the box is pending until then.
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const inner = fetchMock.getMockImplementation() as (url: string, init: RequestInit) => unknown;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (init.method === "POST") await gate;
      return inner(url, init);
    });

    act(() => q("inbox-reply-toggle", sheet)!.click());
    const text = q("inbox-comment-reply-text", sheet) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(text); // opened from a toggle: it takes focus
    expect(text.getAttribute("aria-label")).toBe("رد @noura");
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(text, "حياك الله");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => q("inbox-comment-reply-send", sheet)!.click());
    expect((q("inbox-comment-reply-send", sheet) as HTMLButtonElement).disabled).toBe(true);

    // Reply privately: the same box, now a private reply; its text and its lock stay.
    act(() => q("inbox-private-toggle", sheet)!.click());
    expect(q("inbox-comment-reply-text", sheet)).toBeNull();
    const priv = q("inbox-comment-private-text", sheet) as HTMLTextAreaElement;
    expect(priv).toBe(text);
    expect(priv.value).toBe("حياك الله");
    expect(priv.getAttribute("aria-label")).toBe("رد على الخاص @noura");
    const privSend = q("inbox-comment-private-send", sheet) as HTMLButtonElement;
    expect(privSend.disabled).toBe(true);
    act(() => privSend.click());

    open();
    await settle();
    const posts = urls().filter((u) => u.startsWith("POST "));
    expect(posts).toEqual(["POST /social/inbox/comments/instagram/k1/reply"]);
    expect(JSON.parse(fetchMock.mock.calls.find(([, i]) => i?.method === "POST")![1].body)).toEqual(
      {
        text: "حياك الله",
      },
    );
    expect(priv.value).toBe(""); // sent: cleared
    expect((q("inbox-comment-private-send", sheet) as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives a TikTok comment no reply, private reply or menu", async () => {
    const tiktok = { ...POST, platform: "tiktok", id: "t9" };
    serve({
      "GET /social/inbox/posts": { body: { posts: [tiktok], more: false, next: null } },
      "GET /social/inbox/posts/tiktok/t9/comments": {
        body: {
          post: tiktok,
          comments: [comment("k1", T0, { platform: "tiktok", postId: "t9" })],
          more: false,
          next: null,
        },
      },
    });
    await mount();
    act(() => all("inbox-post-row")[0].click());
    await settle();
    const sheet = q("inbox-post")!;
    expect(ids("inbox-comment", sheet)).toEqual(["k1"]);
    for (const control of [
      "inbox-comment-actions",
      "inbox-reply-toggle",
      "inbox-private-toggle",
      "inbox-comment-menu",
    ])
      expect(q(control, sheet), control).toBeNull();
  });

  it("gives an Instagram comment its Reply, Reply privately and menu, and our own no private reply", async () => {
    serve({
      "GET /social/inbox/posts/instagram/m1/comments": {
        body: {
          post: POST,
          comments: [
            comment("k2", T1, { parentId: "k1", author: "3z", ours: true, sentBy: "owner" }),
            comment("k1", T0),
          ],
          more: false,
          next: null,
        },
      },
    });
    await mount();
    act(() => all("inbox-post-row")[0].click());
    await settle();
    const sheet = q("inbox-post")!;
    const actions = (id: string) =>
      sheet.querySelector<HTMLElement>(`[data-testid="inbox-comment-actions"][data-id="${id}"]`)!;
    for (const id of ["k1", "k2"]) {
      expect(q("inbox-reply-toggle", actions(id)), id).not.toBeNull();
      expect(q("inbox-comment-menu", actions(id)), id).not.toBeNull();
    }
    expect(q("inbox-private-toggle", actions("k1"))).not.toBeNull();
    expect(q("inbox-private-toggle", actions("k2"))).toBeNull();
  });

  it("loads older conversations and posts with the Worker's cursor, and a poll keeps them", async () => {
    const older = conv({ id: "c0", peerId: "p0", peerName: "ريم", updatedAt: T0 });
    const olderPost = { ...POST, id: "m0", postedAt: "2026-10-21T10:00:00.000Z" };
    serve({
      "GET /social/inbox/conversations": {
        body: { conversations: [conv()], more: true, next: "cur1" },
      },
      "GET /social/inbox/conversations?before=cur1": {
        body: { conversations: [older], more: false, next: null },
      },
      "GET /social/inbox/posts": { body: { posts: [POST], more: true, next: "pcur1" } },
      "GET /social/inbox/posts?before=pcur1": {
        body: { posts: [olderPost], more: false, next: null },
      },
    });
    await mount();
    expect(ids("inbox-conversation")).toEqual(["c1"]);
    expect(ids("inbox-post-row")).toEqual(["m1"]);

    act(() => q("inbox-more-conversations")!.click());
    await settle();
    expect(urls()).toContain("GET /social/inbox/conversations?before=cur1");
    expect(ids("inbox-conversation")).toEqual(["c1", "c0"]);
    expect(q("inbox-more-conversations")).toBeNull();

    act(() => q("inbox-more-posts")!.click());
    await settle();
    expect(urls()).toContain("GET /social/inbox/posts?before=pcur1");
    expect(ids("inbox-post-row")).toEqual(["m1", "m0"]);
    expect(q("inbox-more-posts")).toBeNull();

    // The poll reads the first pages again; the older ones stay, and no "load more" comes back.
    await comeBack();
    expect(urls().filter((u) => u === "GET /social/inbox/conversations")).toHaveLength(2);
    expect(ids("inbox-conversation")).toEqual(["c1", "c0"]);
    expect(ids("inbox-post-row")).toEqual(["m1", "m0"]);
    expect(q("inbox-more-conversations")).toBeNull();
    expect(q("inbox-more-posts")).toBeNull();
  });

  it("rows a load-more brings from before the first read are history: seen on arrival", async () => {
    useStore.setState({ inboxSeen: {} });
    const OLD = "2026-10-21T10:00:00.000Z";
    serve({
      "GET /social/inbox/conversations": {
        body: { conversations: [conv()], more: true, next: "cur1" },
      },
      "GET /social/inbox/conversations?before=cur1": {
        body: {
          conversations: [conv({ id: "c0", peerId: "p0", updatedAt: OLD })],
          more: false,
          next: null,
        },
      },
      "GET /social/inbox/posts": { body: { posts: [POST], more: true, next: "pcur1" } },
      "GET /social/inbox/posts?before=pcur1": {
        body: { posts: [{ ...POST, id: "m0", postedAt: OLD }], more: false, next: null },
      },
    });
    await readFirst();
    await mount();
    expect(useStore.getState().inboxSeen["inbox:firstRead"]).toBe(READ);
    act(() => q("inbox-more-conversations")!.click());
    await settle();
    act(() => q("inbox-more-posts")!.click());
    await settle();
    expect(ids("inbox-conversation")).toEqual(["c1", "c0"]);
    expect(ids("inbox-post-row")).toEqual(["m1", "m0"]);
    expect(all("inbox-new")).toHaveLength(0);
    expect(useStore.getState().inboxSeen["instagram:conversation:c0"]).toBe(OLD);
    expect(useStore.getState().inboxSeen["instagram:post:m0"]).toBe(OLD);
  });

  it("history ends at the first read's time, not at an item's: a page-2 row between the lists' oldest is seen", async () => {
    useStore.setState({ inboxSeen: {} });
    // The oldest post is older than the oldest conversation; the page-2 conversation lies between them.
    const OLDEST_POST = "2026-10-20T10:00:00.000Z";
    const BETWEEN = "2026-10-21T10:00:00.000Z";
    serve({
      "GET /social/inbox/conversations": {
        body: { conversations: [conv()], more: true, next: "cur1" },
      },
      "GET /social/inbox/conversations?before=cur1": {
        body: {
          conversations: [conv({ id: "c0", peerId: "p0", updatedAt: BETWEEN })],
          more: false,
          next: null,
        },
      },
      "GET /social/inbox/posts": {
        body: { posts: [{ ...POST, postedAt: OLDEST_POST }], more: false, next: null },
      },
    });
    await readFirst();
    await mount();
    expect(useStore.getState().inboxSeen["inbox:firstRead"]).toBe(READ);
    act(() => q("inbox-more-conversations")!.click());
    await settle();
    expect(ids("inbox-conversation")).toEqual(["c1", "c0"]);
    expect(all("inbox-new")).toHaveLength(0);
    expect(useStore.getState().inboxSeen["instagram:conversation:c0"]).toBe(BETWEEN);
  });

  it("a page-2 row newer than the first read (it arrived later) is new", async () => {
    useStore.setState({ inboxSeen: {} });
    await readFirst(); // sees c1 (T1) only
    // Later two newer conversations came in: the newest on the first page, the other behind the cursor.
    const LATE = "2026-10-22T14:00:00.000Z";
    routes["GET /social/inbox/conversations"] = {
      body: {
        conversations: [conv({ id: "c9", peerId: "p9", updatedAt: "2026-10-22T15:00:00.000Z" })],
        more: true,
        next: "cur1",
      },
    };
    routes["GET /social/inbox/conversations?before=cur1"] = {
      body: {
        conversations: [conv({ id: "c5", peerId: "p5", updatedAt: LATE }), conv()],
        more: false,
        next: null,
      },
    };
    await mount();
    act(() => q("inbox-more-conversations")!.click());
    await settle();
    expect(ids("inbox-conversation")).toEqual(["c9", "c5", "c1"]);
    const withChip = all("inbox-conversation")
      .filter((r) => q("inbox-new", r))
      .map((r) => r.getAttribute("data-id"));
    expect(withChip).toEqual(["c9", "c5"]);
    expect(useStore.getState().inboxSeen["instagram:conversation:c5"]).toBeUndefined();
  });

  it("a load-more row newer than the first read keeps the usual rule", async () => {
    // The first read (at T0) found nothing; c1 (T1) came after it, c0 before it.
    useStore.setState({ inboxSeen: { "inbox:firstRead": T0 } });
    serve({
      "GET /social/inbox/conversations": {
        body: {
          conversations: [conv({ id: "c3", peerId: "p3", updatedAt: T2 })],
          more: true,
          next: "cur1",
        },
      },
      "GET /social/inbox/conversations?before=cur1": {
        body: {
          conversations: [
            conv(),
            conv({ id: "c0", peerId: "p0", updatedAt: "2026-10-22T09:00:00.000Z" }),
          ],
          more: false,
          next: null,
        },
      },
    });
    await mount();
    act(() => q("inbox-more-conversations")!.click());
    await settle();
    const withChip = all("inbox-conversation")
      .filter((r) => q("inbox-new", r))
      .map((r) => r.getAttribute("data-id"));
    expect(withChip).toEqual(["c3", "c1"]);
  });

  it("loads a thread's older messages with the Worker's cursor, on top", async () => {
    serve({
      "GET /social/inbox/conversations/c1": { body: { ...THREAD, more: true, next: "t1" } },
      "GET /social/inbox/conversations/c1?before=t1": {
        body: {
          ...THREAD,
          messages: [message("m-0", "2026-10-22T09:00:00.000Z", "peer", "السلام")],
          more: false,
          next: null,
        },
      },
    });
    await mount();
    act(() => all("inbox-conversation")[0].click());
    await settle();
    const sheet = q("inbox-thread")!;
    act(() => q("inbox-load-older", sheet)!.click());
    await settle();
    expect(urls()).toContain("GET /social/inbox/conversations/c1?before=t1");
    expect(ids("inbox-message", sheet)).toEqual(["m-0", "m-1", "m-2"]);
    expect(q("inbox-load-older", sheet)).toBeNull();
  });

  it("the TikTok tab says DMs stay in the app, links them, and says comments come later", async () => {
    await mount();
    act(() => q("inbox-tab-tiktok")!.click());
    expect(useStore.getState().inboxTab).toBe("tiktok");
    expect(all("inbox-conversation")).toHaveLength(0);
    expect(all("inbox-post-row")).toHaveLength(0);
    const dm = q("inbox-tiktok-dm", q("inbox-messages")!)!;
    expect(dm.textContent).toContain("رسائل تيك توك ما تتوفر للحسابات الشخصية");
    const link = q("inbox-tiktok-open", dm) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://www.tiktok.com/messages");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(q("inbox-tiktok-soon", q("inbox-comments")!)!.textContent).toBe(
      "تعليقات تيك توك بعد موافقة تيك توك",
    );
  });

  it("asks to connect Instagram when it is not connected, with the replies permission", async () => {
    serve({
      "GET /social/inbox": { body: overview({ connected: false, canReply: false }) },
      "POST /social/connect/instagram": { status: 400, body: { error: "bad_request" } },
    });
    await mount();
    expect(q("inbox-need-ig")!.textContent).toBe("اربط إنستقرام من الإعدادات أول.");
    expect(q("inbox-connect-error")).toBeNull();
    act(() => q("inbox-connect")!.click());
    await settle();
    // The Worker refused: the page stays and says why.
    const alert = q("inbox-connect-error")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe("طلب غلط للـ Worker. حدّث الصفحة وجرّب.");
    const i = calls().indexOf("POST /social/connect/instagram");
    expect(i).toBeGreaterThan(-1);
    const init = fetchMock.mock.calls[i][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ publish: true, replies: true });
  });

  it("asks for the messages permission when Instagram is connected without it", async () => {
    serve({ "GET /social/inbox": { body: overview({ canReply: false }) } });
    await mount();
    expect(q("inbox-need-permission")).not.toBeNull();
    expect(q("inbox-allow")!.textContent).toBe("اسمح بالرسائل");
    expect(q("inbox-need-ig")).toBeNull();
  });

  it("asks to connect again when the Instagram link expired", async () => {
    serve({ "GET /social/inbox": { body: overview({ tokenExpired: true }) } });
    await mount();
    expect(q("inbox-token-expired")!.textContent).toBe(
      "انتهى ربط إنستقرام؛ اربطه من جديد من الإعدادات.",
    );
    expect(q("inbox-connect")!.textContent).toBe("أعد الربط");
  });

  it("says the Worker has no inbox yet when it answers not_available, and shows no lists", async () => {
    serve({ "GET /social/inbox": { status: 503, body: { error: "not_available" } } });
    await mount();
    expect(q("inbox-not-available")!.textContent).toContain("الوركر القديم ما فيه الرسائل بعد");
    expect(q("inbox-messages")).toBeNull();
  });

  it("names any other failure in its own words", async () => {
    serve({ "GET /social/inbox/posts": { status: 401, body: { error: "unauthorized" } } });
    await mount();
    expect(q("inbox-error")!.textContent).toBe("رمز الوركر غلط أو انتهى؛ تأكد منه في الإعدادات.");
  });

  it("Refresh asks the Worker to read now, then reads the inbox 3 s later", async () => {
    serve({ "POST /social/inbox/refresh": { body: { scanRequestedAt: T1 } } });
    await mount();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    act(() => q("inbox-refresh")!.click());
    await tick(0);
    expect(calls().slice(3)).toEqual(["POST /social/inbox/refresh"]);
    await tick(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(
      calls()
        .slice(4)
        .every((c) => c.startsWith("GET ")),
    ).toBe(true);
  });

  it("reads nothing without a Worker and points at the Settings", async () => {
    configure(false);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await mount();
    act(() => vi.advanceTimersByTime(INBOX_POLL_MS * 3));
    expect(fetchMock).not.toHaveBeenCalled();
    const empty = q("inbox-need-worker")!;
    expect(empty.querySelector("a")!.getAttribute("href")).toMatch(/^\/settings\/?#api-keys$/);
    expect(q("inbox-tab")).toBeNull();
  });

  it("polls only while the page is visible, with a fresh timer when it comes back, and only reads", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const advance = async (ms: number) => {
      act(() => vi.advanceTimersByTime(ms));
      await settle();
    };
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(INBOX_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    visibility = "hidden";
    await comeBack(); // the event fires on hiding too: the timer stops, nothing is read
    await advance(INBOX_POLL_MS * 3 + INBOX_POLL_MS / 2);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    visibility = "visible";
    await comeBack();
    expect(fetchMock).toHaveBeenCalledTimes(9); // one read at once
    await advance(INBOX_POLL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(9); // the old timer's phase is gone
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(calls().every((c) => c.startsWith("GET "))).toBe(true);

    act(() => root.unmount());
    await comeBack();
    await advance(INBOX_POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    root = createRoot(host); // afterEach unmounts again
  });
});
