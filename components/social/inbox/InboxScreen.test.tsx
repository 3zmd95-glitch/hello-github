// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxConversation, InboxOverview, InboxPost } from "@/lib/domain";
import { INBOX_POLL_MS } from "@/lib/inbox";
import { useStore } from "@/store";
import InboxScreen from "./InboxScreen";
import { resetInbox } from "./useInbox";

// 📥 The Inbox page, rendered for real in jsdom against a fake Worker (`fetch`): the tabs, a conversation and a
// post, the "new" chip and the seen mark an open sets, the TikTok tab, the account states, and the reads it makes
// (none without a Worker, a poll only while the page is visible).

vi.mock("next/navigation", () => ({ usePathname: () => "/social/inbox/" }));

const T0 = "2026-10-22T10:00:00.000Z";
const T1 = "2026-10-22T11:00:00.000Z";

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
  // The Worker answers the newest first.
  messages: [message("m-2", T1, "auto", "أهلين"), message("m-1", T0, "peer", "هلا")],
  more: false,
  next: null,
  window: { open: true, closesAt: null },
};

type Answer = { status?: number; body: unknown };
let routes: Record<string, Answer>;
let fetchMock: ReturnType<typeof vi.fn>;

/** The fake Worker: "METHOD /path" → answer (the path without the Worker's origin). */
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
    const a = routes[`${init.method ?? "GET"} ${new URL(url).pathname}`] ?? {
      status: 404,
      body: {},
    };
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
  useStore.setState({ inboxSeen: {}, inboxTab: "all" });
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
    useStore.setState({ inboxSeen: { ...old, "instagram:conversation:c1": T0 } });
    await mount();
    expect(useStore.getState().inboxSeen).toEqual({ "instagram:conversation:c1": T0 });

    // At or under the cap nothing is dropped.
    resetInbox();
    useStore.setState({ inboxSeen: { "instagram:conversation:gone-1": T0 } });
    act(() => root.unmount());
    await mount();
    expect(useStore.getState().inboxSeen).toEqual({ "instagram:conversation:gone-1": T0 });
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
    act(() => q("inbox-connect")!.click());
    await settle();
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

  it("polls only while the page is visible, reads again when it comes back, and only reads", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    visibility = "hidden";
    act(() => vi.advanceTimersByTime(INBOX_POLL_MS * 2));
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    visibility = "visible";
    act(() => vi.advanceTimersByTime(INBOX_POLL_MS));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(6);

    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(calls().every((c) => c.startsWith("GET "))).toBe(true);

    act(() => root.unmount());
    act(() => vi.advanceTimersByTime(INBOX_POLL_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(9);
    root = createRoot(host); // afterEach unmounts again
  });
});
