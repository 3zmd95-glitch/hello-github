// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, inboxDraftBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import InboxScreen from "./InboxScreen";
import { draftScope, resetInbox } from "./useInbox";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";

// 📥 Inbox screen (packet DT-6A): every state with its Settings link, direction and kind labels, honest coverage
// footers, Load more, and the private draft box (save / copy / discard acknowledged only for the submitted text in
// the same panel session). Transport is a fake Worker; draft actions never fetch.

const WORKER = "https://scout.test";
const GEN = "c".repeat(32);
const ACC = "17841400000000001";

let host: HTMLDivElement;
let root: Root;
let routes: Record<string, (url: URL) => Response | Promise<Response>>;
let calls: string[];

const S = () => useStore.getState();
const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const $$ = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const head = { accountId: ACC, generation: GEN, fetchedAt: new Date().toISOString() };
const account = (caps = { messages: "ok", comments: "ok" }) =>
  json({ accountId: ACC, handle: "3z.prod", generation: GEN, capabilities: caps });

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

async function until(fn: () => void, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    await act(() => new Promise<void>((r) => setTimeout(r, 15)));
    try {
      fn();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
  }
}

async function mount(lang: "ar" | "en" = "ar", configured = true): Promise<void> {
  await act(async () => {
    S().setSettings({
      lang,
      apiKeys: configured ? { scoutUrl: WORKER, scoutToken: "owner-token" } : {},
    });
    root.render(createElement(InboxScreen));
  });
}

async function click(id: string, index = 0): Promise<void> {
  await act(async () => $$(id)[index]!.click());
}

async function type(id: string, value: string): Promise<void> {
  const el = $(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const message = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  createdAt: "2026-10-17T07:00:00.000Z",
  direction: "in",
  from: { id: "p1", username: "fan_one" },
  text: `text ${id}`,
  kind: "text",
  ...over,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  S().reset();
  resetInbox();
  setArticlesLock(queueLock());
  calls = [];
  routes = {
    "/social/inbox/account": () => account(),
    "/social/inbox/conversations": () =>
      json({
        ...head,
        items: [
          {
            id: "c1",
            updatedAt: "2026-10-17T08:00:00.000Z",
            participants: [
              { id: ACC, username: "3z.prod" },
              { id: "p1", username: "fan_one" },
            ],
          },
          { id: "c2", updatedAt: null, participants: [] },
        ],
        next: null,
        coverage: "end",
      }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      const route = routes[url.pathname];
      return route ? route(url) : json({ error: "not_found" }, 404);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  // Nothing in this screen ever writes to the Worker.
  expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setArticlesLock(undefined);
  resetInbox();
  S().setSettings({ lang: "ar", apiKeys: {} });
});

describe("InboxScreen states", () => {
  it("without a Worker says so in Arabic and English, links to the keys, and fetches nothing", async () => {
    await mount("ar", false);
    await until(() => expect($("ibx-state")!.dataset.code).toBe("unconfigured"));
    expect(host.querySelector("h1")!.textContent).toBe("صندوق المحادثات");
    expect($("ibx-state")!.textContent).toContain("اربط الـ Worker");
    expect($("ibx-state-link")!.getAttribute("href")).toBe("/settings#api-keys");
    expect($("ibx-coverage-note")!.textContent).toContain("مو كل تاريخك");
    await mount("en", false);
    expect(host.querySelector("h1")!.textContent).toBe("Inbox");
    expect($("ibx-coverage-note")!.textContent).toBe(
      "Shows only what Instagram shares with this app, not your full history. Nothing is sent from here.",
    );
    expect(calls).toEqual([]);
  });

  it.each([
    ["not_connected", 409, "/settings#accounts"],
    ["token_expired", 409, "/settings#accounts"],
    ["rate_limited", 429, null],
    ["upstream", 502, null],
    ["auth", 401, "/settings#api-keys"],
  ])("shows the %s account state with the right next step", async (code, status, link) => {
    routes["/social/inbox/account"] = () =>
      json({ error: code === "auth" ? "unauthorized" : code }, status);
    await mount("en");
    await until(() => expect($("ibx-state")!.dataset.code).toBe(code));
    if (link) expect($("ibx-state-link")!.getAttribute("href")).toBe(link);
    else expect($("ibx-state-link")).toBeNull();
    // No automatic retry: one account read only.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(calls.filter((c) => c.endsWith("/account"))).toHaveLength(1);
  });

  it("shows a denied surface with the reconnect link while the other tab still works", async () => {
    routes["/social/inbox/account"] = () => account({ messages: "no_permission", comments: "ok" });
    routes["/social/inbox/media"] = () =>
      json({
        ...head,
        items: [{ id: "m1", timestamp: null, commentsCount: 0 }],
        next: null,
        coverage: "end",
      });
    await mount("en");
    await until(() => expect($("ibx-state")!.dataset.code).toBe("no_permission"));
    expect($("ibx-state")!.textContent).toContain("Allow auto-replies");
    expect($("ibx-state-link")!.getAttribute("href")).toBe("/settings#accounts");
    expect(calls.some((c) => c.endsWith("/conversations"))).toBe(false);
    await click("ibx-tab-comments");
    await until(() => expect($$("ibx-post")).toHaveLength(1));
    expect($("ibx-state")).toBeNull();
  });

  it("shows restricted (not_eligible) and empty lists honestly", async () => {
    routes["/social/inbox/conversations"] = () => json({ error: "not_eligible" }, 403);
    await mount("en");
    await until(() => expect($("ibx-state")!.dataset.code).toBe("not_eligible"));
    expect($("ibx-state")!.textContent).toContain("restricts");
    resetInbox();
    routes["/social/inbox/conversations"] = () =>
      json({ ...head, items: [], next: null, coverage: "end" });
    await click("ibx-refresh");
    await until(() =>
      expect($("ibx-empty")!.textContent).toBe("No conversations Instagram shares right now."),
    );
  });
});

describe("conversations and messages", () => {
  it("lists conversations by the other person and says when a time is unavailable", async () => {
    await mount("en");
    await until(() => expect($$("ibx-conv")).toHaveLength(2));
    expect($$("ibx-conv")[0].textContent).toContain("fan_one");
    expect($$("ibx-conv")[0].textContent).not.toContain("3z.prod");
    expect($$("ibx-conv")[1].textContent).toContain("Conversation");
    expect($$("ibx-conv")[1].textContent).toContain("Time unavailable");
    expect($("ibx-footer")!.dataset.coverage).toBe("end");
    expect($("ibx-readonly")!.textContent).toMatch(/^Read-only · fetched /);
  });

  // DT-6A-R1 (6A-3): a token change on the same Worker hides the old account's view at once, while the new account
  // lookup is still waiting.
  it("hides the old account's conversations as soon as the token changes", async () => {
    await mount("en");
    await until(() => expect(host.textContent).toContain("fan_one"));
    let release: (r: Response) => void = () => {};
    routes["/social/inbox/account"] = () => new Promise<Response>((r) => (release = r));
    await act(async () =>
      S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "another-token" } }),
    );
    expect(host.textContent).not.toContain("fan_one");
    expect($$("ibx-conv")).toHaveLength(0);
    await act(async () => release(json({ error: "unauthorized" }, 401)));
    await until(() => expect($("ibx-state")).not.toBeNull());
    expect(host.textContent).not.toContain("fan_one");
  });

  it("shows both directions, every kind placeholder, unknown author, and Load more → partial", async () => {
    let n = 0;
    routes["/social/inbox/conversations/c1/messages"] = () => {
      n += 1;
      if (n > 1) return json({ error: "upstream", coverage: "partial" }, 502);
      return json({
        ...head,
        items: [
          message("in1"),
          message("out1", { direction: "out", from: { id: ACC, username: "3z.prod" } }),
          message("anon", { direction: "unknown", from: null, createdAt: null }),
          message("reply", { kind: "story_reply", text: "nice" }),
          message("mention", { kind: "story_mention", text: "" }),
          message("share", { kind: "share", text: "" }),
          message("unsupported", { kind: "unsupported", text: "" }),
          message("empty", { kind: "empty", text: "" }),
        ],
        next: "cur.one",
        coverage: "more",
      });
    };
    await mount("en");
    await until(() => expect($$("ibx-conv")).toHaveLength(2));
    await click("ibx-conv");
    await until(() => expect($$("ibx-msg")).toHaveLength(8));
    const msg = (id: string) => $$("ibx-msg").find((m) => m.dataset.id === id)!;
    expect(msg("in1").querySelector('[data-testid="ibx-dir"]')!.textContent).toBe("From them");
    expect(msg("out1").querySelector('[data-testid="ibx-dir"]')!.textContent).toBe("From you");
    expect(msg("anon").querySelector('[data-testid="ibx-dir"]')!.textContent).toBe("Unknown");
    expect(msg("anon").textContent).toContain("Unknown author");
    expect(msg("anon").textContent).toContain("Time unavailable");
    expect(msg("reply").textContent).toContain("Reply to your story");
    expect(msg("reply").textContent).toContain("nice");
    expect(msg("mention").textContent).toContain("Mentioned you in a story");
    expect(msg("share").textContent).toContain("Shared a post or attachment");
    expect(msg("unsupported").textContent).toContain("A message type Instagram doesn't share");
    expect(msg("empty").textContent).toContain("No text (maybe a photo or voice note)");
    // No guessed links on messages.
    expect(host.querySelectorAll('[data-testid="ibx-msg"] a')).toHaveLength(0);
    await click("ibx-more");
    await until(() => expect($("ibx-footer")!.dataset.coverage).toBe("partial"));
    expect($$("ibx-msg")).toHaveLength(8);
    expect($("ibx-footer")!.textContent).toContain("partial");
  });

  it("says when Instagram did not share a conversation's history", async () => {
    routes["/social/inbox/conversations/c1/messages"] = () =>
      json({ error: "upstream", coverage: "history_unavailable" }, 502);
    await mount("ar");
    await until(() => expect($$("ibx-conv")).toHaveLength(2));
    await click("ibx-conv");
    await until(() =>
      expect($("ibx-footer")!.textContent).toContain("إنستقرام ما شارك تاريخ هذي المحادثة."),
    );
    expect($("ibx-empty")).toBeNull();
  });
});

describe("comments", () => {
  it("lists posts with a validated Instagram link only, and comments with direction and author", async () => {
    routes["/social/inbox/media"] = () =>
      json({
        ...head,
        items: [
          {
            id: "m1",
            caption: "LUT reel",
            permalink: "https://www.instagram.com/reel/ABC/",
            timestamp: "2026-10-10T10:00:00.000Z",
            commentsCount: 2,
          },
          { id: "m2", timestamp: null, commentsCount: 0 },
        ],
        next: null,
        coverage: "end",
      });
    routes["/social/inbox/media/m1/comments"] = () =>
      json({
        ...head,
        items: [
          {
            id: "k1",
            text: "love it",
            author: { id: "u1", username: "fan" },
            createdAt: null,
            direction: "in",
          },
          {
            id: "k2",
            text: "thanks",
            author: { id: ACC, username: "3z.prod" },
            createdAt: null,
            direction: "out",
          },
          { id: "k3", text: "who", author: null, createdAt: null, direction: "unknown" },
        ],
        next: null,
        coverage: "end",
      });
    await mount("en");
    await click("ibx-tab-comments");
    await until(() => expect($$("ibx-post")).toHaveLength(2));
    const links = $$("ibx-post-link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://www.instagram.com/reel/ABC/");
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect($$("ibx-post")[1].textContent).toContain("Post without caption");
    await click("ibx-post-open");
    await until(() => expect($$("ibx-comment")).toHaveLength(3));
    const dirs = $$("ibx-comment").map(
      (c) => c.querySelector('[data-testid="ibx-dir"]')!.textContent,
    );
    expect(dirs).toEqual(["From them", "From you", "Unknown"]);
    expect($$("ibx-comment")[2].textContent).toContain("Unknown author");
    expect($("ibx-replies-outside")!.textContent).toContain("Replies to comments");
  });
});

describe("draft box", () => {
  const openConversation = async () => {
    await mount("en");
    routes["/social/inbox/conversations/c1/messages"] = () =>
      json({ ...head, items: [message("in1")], next: null, coverage: "end" });
    await until(() => expect($$("ibx-conv")).toHaveLength(2));
    await click("ibx-conv");
    await until(() => expect($("ibx-draft")).not.toBeNull());
  };

  it("saves privately with a read-back, copies and discards, with no network call", async () => {
    await openConversation();
    const before = calls.length;
    await type("ibx-draft-text", "Sent you the LUT link");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
    const scope = draftScope("conversation", "c1");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.inboxDrafts[scope].text).toBe(
      "Sent you the LUT link",
    );
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await click("ibx-draft-copy");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("copied"));
    expect(writeText).toHaveBeenCalledWith("Sent you the LUT link");
    await click("ibx-draft-discard");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("discarded"));
    expect(S().inboxDrafts[scope]).toBeUndefined();
    expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe("");
    expect(calls.length).toBe(before);
  });

  it("says an earlier version was saved when the text changed during the save", async () => {
    await openConversation();
    let release: () => void = () => {};
    setArticlesLock((fn) => new Promise((r) => (release = () => r(fn()))) as never);
    await type("ibx-draft-text", "first");
    await click("ibx-draft-save");
    await type("ibx-draft-text", "first and more");
    setArticlesLock(queueLock());
    await act(async () => release());
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("earlierSaved"));
  });

  it("a held Discard keeps text typed after it, and that text saves against the refreshed (absent) base", async () => {
    await openConversation();
    const scope = draftScope("conversation", "c1");
    await type("ibx-draft-text", "old draft");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
    let release: () => void = () => {};
    setArticlesLock((fn) => new Promise((r) => (release = () => r(fn()))) as never);
    await click("ibx-draft-discard");
    await type("ibx-draft-text", "New text typed after Discard");
    setArticlesLock(queueLock());
    await act(async () => release());
    await until(() => expect(S().inboxDrafts[scope]).toBeUndefined());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe("New text typed after Discard");
    expect($("ibx-draft-status")!.dataset.state).toBe("discarded");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
    expect(S().inboxDrafts[scope].text).toBe("New text typed after Discard");
  });

  it("a held Discard with unchanged text still clears the editor", async () => {
    await openConversation();
    await type("ibx-draft-text", "old draft");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
    let release: () => void = () => {};
    setArticlesLock((fn) => new Promise((r) => (release = () => r(fn()))) as never);
    await click("ibx-draft-discard");
    setArticlesLock(queueLock());
    await act(async () => release());
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("discarded"));
    expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe("");
  });

  it("reports a conflict when the draft changed elsewhere, and a copy of older text is not acknowledged", async () => {
    await openConversation();
    const scope = draftScope("conversation", "c1");
    // Another tab saves a draft for the same conversation after this panel opened.
    const r = await S().saveInboxDraft(scope, "other tab", inboxDraftBase(null));
    expect(r.ok).toBe(true);
    await type("ibx-draft-text", "mine");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("conflict"));
    expect(S().inboxDrafts[scope].text).toBe("other tab");

    let finish: () => void = () => {};
    const writeText = vi.fn(() => new Promise<void>((r) => (finish = r)));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await click("ibx-draft-copy");
    await type("ibx-draft-text", "mine, edited");
    await act(async () => finish());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect($("ibx-draft-status")!.dataset.state).not.toBe("copied");
  });
});

// 📥 DT-6B-1: the platform selector, Threads posts → replies, YouTube channel pick → videos → threads → Load replies,
// provider-specific states in Arabic and English, and v2 drafts beside untouched Instagram drafts.
describe("InboxScreen providers (DT-6B-1)", () => {
  const TGEN = "d".repeat(32);
  const thHead = {
    provider: "threads",
    accountId: "25",
    generation: TGEN,
    fetchedAt: head.fetchedAt,
  };
  const ytHead = (accountId = "UCb") => ({
    provider: "youtube",
    accountId,
    generation: TGEN,
    fetchedAt: head.fetchedAt,
  });
  const thAccount = (replies = "ok") =>
    json({
      provider: "threads",
      accountId: "25",
      handle: "3z.prod",
      generation: TGEN,
      capabilities: { replies },
    });
  const thPosts = () =>
    json({
      ...thHead,
      items: [
        {
          id: "90001",
          ref: "ref-90001.s",
          text: "my thread",
          permalink: "https://www.threads.net/@3z.prod/post/90001",
          timestamp: null,
        },
      ],
      next: null,
      coverage: "end",
    });
  const ytComment = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    text: `yt ${id}`,
    author: { id: "UCfan", username: "fan_two" },
    createdAt: null,
    direction: "in",
    ...over,
  });

  afterEach(() => {
    resetProviderInbox();
    useProviderInbox.setState({ provider: "instagram" });
  });

  it("switches to Threads: own posts, then the honest no-permission state for replies (ar/en), no link", async () => {
    routes["/social/inbox/threads/account"] = () => thAccount("no_permission");
    routes["/social/inbox/threads/posts"] = thPosts;
    await mount("en");
    await until(() => expect($$("ibx-provider-threads")).toHaveLength(1));
    await click("ibx-provider-threads");
    await until(() => expect($$("ibx-th-post")).toHaveLength(1));
    expect($("ibx-coverage-note")!.textContent).toContain("direct replies Threads returns");
    expect($("ibx-th-post-link")!.getAttribute("href")).toBe(
      "https://www.threads.net/@3z.prod/post/90001",
    );
    await click("ibx-th-post-open");
    await until(() => expect($("ibx-state")!.dataset.code).toBe("no_permission"));
    expect($("ibx-state")!.textContent).toContain("threads_read_replies");
    expect($("ibx-state-link")).toBeNull();
    expect(calls.some((c) => c.endsWith("/replies"))).toBe(false);
    await mount("ar");
    expect($("ibx-state")!.textContent).toContain("ربط ثريدز الحالي ما يقدر يقرأ الردود");
  });

  it("Threads replies: direction, media placeholder, nested marker, unknown author, and a v2 draft beside Instagram's", async () => {
    routes["/social/inbox/threads/account"] = () => thAccount();
    routes["/social/inbox/threads/posts"] = thPosts;
    routes["/social/inbox/threads/posts/ref-90001.s/replies"] = () =>
      json({
        ...thHead,
        items: [
          {
            id: "91001",
            text: "nice one",
            author: { username: "fan_one" },
            createdAt: null,
            direction: "in",
            kind: "text",
            rootId: "90001",
            parentId: "90001",
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
        ],
        next: null,
        coverage: "end",
      });
    const legacy = "https%3A%2F%2Fscout.test|17841400000000001|conversation|c1";
    const kept = await S().saveInboxDraft(legacy, "instagram draft", inboxDraftBase(null));
    expect(kept.ok).toBe(true);
    await mount("en");
    await until(() => expect($$("ibx-provider-threads")).toHaveLength(1));
    await click("ibx-provider-threads");
    await until(() => expect($$("ibx-th-post-open")).toHaveLength(1));
    await click("ibx-th-post-open");
    await until(() => expect($$("ibx-th-reply")).toHaveLength(2));
    const [first, second] = $$("ibx-th-reply");
    expect(first.dataset.dir).toBe("in");
    expect(second.textContent).toContain("Media reply");
    expect(second.textContent).toContain("Unknown author");
    expect(second.querySelector('[data-testid="ibx-th-nested"]')).not.toBeNull();
    expect(first.querySelector('[data-testid="ibx-th-nested"]')).toBeNull();
    expect($("ibx-footer")!.textContent).toContain("everything Threads returns");
    await click("ibx-reply-draft");
    await type("ibx-draft-text", "شكراً لك");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
    const v2 = "v2|threads|https%3A%2F%2Fscout.test|25|comment|91001";
    expect(S().inboxDrafts[v2].text).toBe("شكراً لك");
    expect(S().inboxDrafts[legacy].text).toBe("instagram draft");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.inboxDrafts[legacy].text).toBe(
      "instagram draft",
    );
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await click("ibx-draft-copy");
    await until(() => expect($("ibx-draft-status")!.textContent).toContain("Paste it in Threads"));
  });

  it("YouTube: several channels need a pick; then videos, threads with the embedded subset, and Load replies", async () => {
    routes["/social/inbox/youtube/account"] = () =>
      json({
        provider: "youtube",
        needsSelection: true,
        channels: [
          { accountId: "UCa", title: "First", generation: TGEN, uploads: "up-a.s" },
          { accountId: "UCb", title: "Second", generation: TGEN, uploads: "up-b.s" },
        ],
        capabilities: { comments: "ok" },
      });
    routes["/social/inbox/youtube/videos"] = (url) =>
      json({
        ...ytHead(url.searchParams.get("account")!),
        items: [
          {
            id: "vid1",
            ref: "vref-1.s",
            title: "My video",
            permalink: "https://www.youtube.com/watch?v=vid1",
            timestamp: null,
          },
        ],
        next: null,
        coverage: "end",
      });
    routes["/social/inbox/youtube/videos/vref-1.s/threads"] = () =>
      json({
        ...ytHead(),
        items: [
          {
            id: "Ug1",
            ref: "cref-1.s",
            comment: ytComment("Ug1"),
            totalReplyCount: 3,
            replies: [ytComment("Ug1.r1", { parentId: "Ug1", direction: "out" })],
            repliesCoverage: "embedded",
          },
        ],
        next: null,
        coverage: "end",
      });
    routes["/social/inbox/youtube/comments/cref-1.s/replies"] = () =>
      json({
        ...ytHead(),
        items: [
          ytComment("Ug1.r1", { parentId: "Ug1", direction: "out" }),
          ytComment("Ug1.r2", { parentId: "Ug1" }),
        ],
        next: null,
        coverage: "end",
      });
    await mount("en");
    await until(() => expect($$("ibx-provider-youtube")).toHaveLength(1));
    await click("ibx-provider-youtube");
    await until(() => expect($$("ibx-yt-channel")).toHaveLength(2));
    expect(calls.some((c) => c.endsWith("/youtube/videos"))).toBe(false);
    await click("ibx-yt-channel", 1);
    await until(() => expect($$("ibx-yt-video")).toHaveLength(1));
    expect($("ibx-yt-video-link")!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=vid1",
    );
    await click("ibx-yt-video-open");
    await until(() => expect($$("ibx-yt-thread")).toHaveLength(1));
    expect($("ibx-yt-subset")!.textContent).toBe("Showing 1 of 3 replies");
    expect($$("ibx-yt-reply")).toHaveLength(1);
    await click("ibx-yt-load-replies");
    await until(() => expect($$("ibx-yt-reply")).toHaveLength(2));
    expect($$("ibx-yt-reply").map((r) => r.dataset.id)).toEqual(["Ug1.r1", "Ug1.r2"]);
    expect($("ibx-yt-subset")).toBeNull();
  });

  it("YouTube comment states: comments disabled on a video, an expired sign-in in Arabic", async () => {
    routes["/social/inbox/youtube/account"] = () =>
      json({
        provider: "youtube",
        needsSelection: false,
        channels: [{ accountId: "UCb", title: "Only", generation: TGEN, uploads: "up-b.s" }],
        capabilities: { comments: "ok" },
      });
    routes["/social/inbox/youtube/videos"] = () =>
      json({
        ...ytHead(),
        items: [{ id: "vid1", ref: "vref-1.s", timestamp: null }],
        next: null,
        coverage: "end",
      });
    routes["/social/inbox/youtube/videos/vref-1.s/threads"] = () =>
      json({ ...ytHead(), error: "comments_disabled", coverage: "unavailable" }, 403);
    await mount("en");
    await until(() => expect($$("ibx-provider-youtube")).toHaveLength(1));
    await click("ibx-provider-youtube");
    await until(() => expect($$("ibx-yt-video-open")).toHaveLength(1));
    await click("ibx-yt-video-open");
    await until(() => expect($("ibx-state")!.dataset.code).toBe("comments_disabled"));
    expect($("ibx-state")!.textContent).toBe("Comments are turned off on this video.");
    resetProviderInbox();
    routes["/social/inbox/youtube/account"] = () => json({ error: "token_expired" }, 409);
    await mount("ar");
    await click("ibx-refresh");
    await until(() => expect($("ibx-state")!.dataset.code).toBe("token_expired"));
    expect($("ibx-state")!.textContent).toContain("دخول يوتيوب انتهى");
    expect($("ibx-state-link")!.getAttribute("href")).toBe("/settings#accounts");
  });

  /** One channel, one video, one thread `Ug1` with `embedded` replies and `total`; replies route by `replies`. */
  async function openThread(
    total: number | null,
    embedded: string[],
    replies: () => Response = () => json({ error: "not_found" }, 404),
  ) {
    routes["/social/inbox/youtube/account"] = () =>
      json({
        provider: "youtube",
        needsSelection: false,
        channels: [{ accountId: "UCb", title: "Only", generation: TGEN, uploads: "up-b.s" }],
        capabilities: { comments: "ok" },
      });
    routes["/social/inbox/youtube/videos"] = () =>
      json({
        ...ytHead(),
        items: [{ id: "vid1", ref: "vref-1.s", timestamp: null }],
        next: null,
        coverage: "end",
      });
    routes["/social/inbox/youtube/videos/vref-1.s/threads"] = () =>
      json({
        ...ytHead(),
        items: [
          {
            id: "Ug1",
            ref: "cref-1.s",
            comment: ytComment("Ug1"),
            totalReplyCount: total,
            replies: embedded.map((id) => ytComment(id, { parentId: "Ug1" })),
            repliesCoverage: "embedded",
          },
        ],
        next: null,
        coverage: "end",
      });
    routes["/social/inbox/youtube/comments/cref-1.s/replies"] = replies;
    await mount("en");
    await until(() => expect($$("ibx-provider-youtube")).toHaveLength(1));
    await click("ibx-provider-youtube");
    await until(() => expect($$("ibx-yt-video-open")).toHaveLength(1));
    await click("ibx-yt-video-open");
    await until(() => expect($$("ibx-yt-thread")).toHaveLength(1));
  }

  const repliesPage = (ids: string[], coverage: string, next: string | null = null) =>
    json({
      ...ytHead(),
      items: ids.map((id) => ytComment(id, { parentId: "Ug1" })),
      next,
      coverage,
    });

  it("DT-6B-1-R1 B1-3: an unknown reply total still offers Load replies; a valid zero does not", async () => {
    await openThread(null, ["Ug1.r1"], () => repliesPage(["Ug1.r1", "Ug1.r2"], "end"));
    expect($$("ibx-yt-reply")).toHaveLength(1);
    expect($("ibx-yt-subset")).toBeNull();
    expect($("ibx-yt-load-replies")!.textContent).toBe("Load replies");
    await click("ibx-yt-load-replies");
    await until(() => expect($$("ibx-yt-reply")).toHaveLength(2));
    resetProviderInbox();
    useProviderInbox.setState({ provider: "instagram" });
    await openThread(0, []);
    expect($("ibx-yt-load-replies")).toBeNull();
    expect($("ibx-yt-replies-footer")).toBeNull();
  });

  it("DT-6B-1-R1 B1-8: capped replies keep their own coverage note, separate from the thread list's end", async () => {
    await openThread(4, ["Ug1.r1"], () => repliesPage(["Ug1.r1", "Ug1.r2"], "cap"));
    expect($("ibx-yt-subset")!.textContent).toBe("Showing 1 of 4 replies");
    await click("ibx-yt-load-replies");
    await until(() => expect($$("ibx-yt-reply")).toHaveLength(2));
    const footer = $("ibx-yt-replies-footer")!;
    expect(footer.dataset.coverage).toBe("cap");
    expect(footer.textContent).toBe("Stopped at the local limit; there may be more.");
    expect($("ibx-yt-load-replies")).toBeNull();
    // The thread list's own footer speaks only for the comments, never for the replies.
    const parent = $$("ibx-footer").at(-1)!;
    expect(parent.textContent).toContain("comment");
    expect(parent.textContent).not.toBe(footer.textContent);
  });

  it("DT-6B-1-R1 B1-8: replies that end, fail first or fail later each say so under their comment", async () => {
    let answer = () => repliesPage(["Ug1.r1", "Ug1.r2"], "end");
    await openThread(3, ["Ug1.r1"], () => answer());
    await click("ibx-yt-load-replies");
    await until(() => expect($("ibx-yt-replies-footer")?.dataset.coverage).toBe("end"));
    expect($("ibx-yt-replies-footer")!.textContent).toBe(
      "That's all the replies YouTube returned for this comment.",
    );
    expect($("ibx-yt-load-replies")).toBeNull();

    resetProviderInbox();
    useProviderInbox.setState({ provider: "instagram" });
    answer = () => json({ ...ytHead(), error: "upstream", coverage: "unavailable" }, 502);
    await openThread(3, ["Ug1.r1"], () => answer());
    await click("ibx-yt-load-replies");
    await until(() => expect($("ibx-yt-replies-footer")?.dataset.coverage).toBe("partial"));
    const footer = $("ibx-yt-replies-footer")!;
    expect(footer.querySelector('[data-testid="ibx-state"]')!.getAttribute("data-code")).toBe(
      "upstream",
    );
    expect($$("ibx-yt-reply")).toHaveLength(1);
    expect($("ibx-yt-load-replies")!.textContent).toBe("Retry");
    answer = () => repliesPage(["Ug1.r2"], "more", "cur.2");
    await click("ibx-yt-load-replies");
    await until(() => expect($$("ibx-yt-reply")).toHaveLength(2));
    expect($("ibx-yt-replies-footer")!.dataset.coverage).toBe("more");
    expect($("ibx-yt-load-replies")!.textContent).toBe("Load more");
    answer = () => json({ ...ytHead(), error: "rate_limited", coverage: "partial" }, 429);
    await click("ibx-yt-load-replies");
    await until(() => expect($("ibx-yt-replies-footer")?.dataset.coverage).toBe("partial"));
    expect($("ibx-yt-replies-footer")!.textContent).toContain("partial");
    expect($$("ibx-yt-reply")).toHaveLength(2);
    expect($("ibx-yt-load-replies")!.textContent).toBe("Load more");
  });

  it("DT-6B-1-R1 B1-1: a Worker without the inbox seal key says so per provider (ar/en)", async () => {
    routes["/social/inbox/threads/account"] = () => json({ error: "not_configured" }, 503);
    await mount("en");
    await until(() => expect($$("ibx-provider-threads")).toHaveLength(1));
    await click("ibx-provider-threads");
    await until(() => expect($("ibx-state")?.dataset.code).toBe("not_configured"));
    expect($("ibx-state")!.textContent).toContain("INBOX_SEAL_SECRET");
    expect($("ibx-state")!.textContent).toContain("Threads");
    resetProviderInbox();
    useProviderInbox.setState({ provider: "instagram" });
    routes["/social/inbox/youtube/account"] = () => json({ error: "not_configured" }, 503);
    await mount("ar");
    await until(() => expect($$("ibx-provider-youtube")).toHaveLength(1));
    await click("ibx-provider-youtube");
    await until(() => expect($("ibx-state")?.dataset.code).toBe("not_configured"));
    expect($("ibx-state")!.textContent).toContain("يوتيوب");
  });
});

// 📤 DT-6B-2C-4: Instagram public-comment review wiring. Production readiness is closed: the comment's draft box shows
// "Send as public reply" disabled with the reason (Save/Copy/Discard unchanged, nothing sent), and the retained-operation
// recovery list is mounted outside the account/capability branches: visible with an account read failure, with another
// account selected and with the comments surface denied. Nothing here writes to the Worker.
describe("Instagram public replies (DT-6B-2C-4)", () => {
  const COMMENT = "k1";
  const igOp = (account = ACC) => ({
    operationId: "op-ig-retained1",
    workerOrigin: WORKER,
    account,
    mediaId: "m1",
    commentId: COMMENT,
    draftRevision: "rev-ig-1",
    digest: "a".repeat(64),
    state: "unknown" as const,
    receiptVersion: 3,
  });
  const seedOp = async () => {
    const key = `instagram|${encodeURIComponent(WORKER)}|${ACC}|comment|${COMMENT}`;
    const r = await S().setInboxInstagramSendOp(key, igOp(), null);
    if (!r.ok) throw new Error(r.reason);
  };
  const media = () =>
    json({
      ...head,
      items: [
        {
          id: "m1",
          caption: "LUT reel",
          permalink: "https://www.instagram.com/reel/ABC/",
          timestamp: null,
          commentsCount: 1,
        },
      ],
      next: null,
      coverage: "end",
    });
  const comments = () =>
    json({
      ...head,
      items: [
        {
          id: COMMENT,
          text: "love it",
          author: { id: "u1", username: "fan" },
          createdAt: null,
          direction: "in",
        },
      ],
      next: null,
      coverage: "end",
    });

  it("a comment's draft offers Send as public reply disabled with the reason (ar/en); Save still works", async () => {
    routes["/social/inbox/media"] = media;
    routes["/social/inbox/media/m1/comments"] = comments;
    await mount("en");
    await click("ibx-tab-comments");
    await until(() => expect($$("ibx-post")).toHaveLength(1));
    await click("ibx-post-open");
    await until(() => expect($$("ibx-comment")).toHaveLength(1));
    await click("ibx-comment-draft");
    await until(() => expect($("ibx-draft")).not.toBeNull());
    const open = $("ibx-igs-open") as HTMLButtonElement;
    expect(open.textContent).toContain("Send as public reply");
    expect(open.disabled).toBe(true);
    expect($("ibx-igs-unavailable")!.textContent).toContain("aren't verified yet");
    await type("ibx-draft-text", "Thank you!");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
    expect(($("ibx-igs-open") as HTMLButtonElement).disabled).toBe(true);
    // The Instagram draft scope is unchanged (origin|account|comment|id).
    expect(S().inboxDrafts[draftScope("comment", COMMENT)]?.text).toBe("Thank you!");
    // No recovery list without a retained operation.
    expect($("ibx-igs-recovery")).toBeNull();
    S().setSettings({ lang: "ar" });
    await until(() => expect($("ibx-igs-open")!.textContent).toContain("أرسله كرد علني"));
    expect(calls.some((c) => c.includes("/instagram/send"))).toBe(false);
  });

  it("the recovery list stays visible when the account read fails", async () => {
    await seedOp();
    routes["/social/inbox/account"] = () => json({ error: "token_expired" }, 409);
    await mount("en");
    await until(() => expect($("ibx-state")).not.toBeNull());
    const list = $("ibx-igs-recovery")!;
    expect(list.textContent).toContain("Instagram public replies to check");
    expect(list.textContent).toContain(COMMENT);
    expect(list.querySelector('[data-testid="ibx-igs-check"]')).not.toBeNull();
    expect(calls.some((c) => c.includes("/instagram/send"))).toBe(false);
  });

  it("the recovery list stays visible with another account selected and with comments denied", async () => {
    await seedOp();
    routes["/social/inbox/account"] = () =>
      json({
        accountId: "17841400000000002",
        handle: "other",
        generation: GEN,
        capabilities: { messages: "ok", comments: "no_permission" },
      });
    await mount("en");
    await until(() => expect($$("ibx-tab-comments")).toHaveLength(1));
    await click("ibx-tab-comments");
    await until(() => expect($("ibx-state")).not.toBeNull());
    expect($("ibx-igs-recovery")!.textContent).toContain(COMMENT);
    // On another provider the Instagram list is not shown.
    await click("ibx-provider-threads");
    await until(() => expect($("ibx-igs-recovery")).toBeNull());
  });
});

// 💬 DT-6B-2C-5A: the explicit inbound-message selector of an opened conversation, the production-disabled DM opener
// beside Save/Copy/Discard, and the DM recovery list mounted outside the account and capability branches.
describe("Instagram DMs (DT-6B-2C-5A)", () => {
  beforeEach(() => {
    // The previous describe ends on another provider; this one starts on Instagram.
    resetProviderInbox();
    useProviderInbox.setState({ provider: "instagram" });
  });
  const CONV_MSGS = "/social/inbox/conversations/c1/messages";
  const rows = (items: unknown[]) => json({ ...head, items, next: null, coverage: "end" as const });
  const page = () =>
    rows([
      message("in2", { createdAt: "2026-10-17T08:00:00.000Z", text: "is it the 16 Pro?" }),
      message("out1", { direction: "out", from: { id: ACC, username: "3z.prod" } }),
      message("anon", { direction: "unknown", from: null }),
      message("notime", { createdAt: null }),
      message("in1"),
    ]);
  const dmOp = (account = ACC) => ({
    operationId: "op-dm-retained1",
    workerOrigin: WORKER,
    account,
    conversationId: "c1",
    recipientId: "p1",
    inboundMessageId: "in1",
    draftRevision: "rev-dm-1",
    digest: "a".repeat(64),
    state: "dispatching" as const,
    receiptVersion: 2,
    pending: { observed: "rejected" as const, code: "meta_10" },
  });
  const seedDm = async () => {
    const key = [WORKER, ACC, "c1", "in1"].map(encodeURIComponent).join("|");
    const r = await S().setInboxInstagramDmSendOp(key, dmOp(), null);
    if (!r.ok) throw new Error(r.reason);
  };
  const msg = (id: string) => $$("ibx-msg").find((m) => m.dataset.id === id)!;
  const pick = (id: string) =>
    msg(id).querySelector<HTMLButtonElement>('[data-testid="ibx-msg-pick"]');

  it("only an inbound row with a concrete non-owner sender and a usable time can be selected; no latest-row guess", async () => {
    routes[CONV_MSGS] = page;
    await mount("en");
    await until(() => expect($$("ibx-conv")).toHaveLength(2));
    await click("ibx-conv");
    await until(() => expect($$("ibx-msg")).toHaveLength(5));
    // Reading order is unchanged (newest first, as Instagram sends them).
    expect($$("ibx-msg").map((m) => m.dataset.id)).toEqual([
      "in2",
      "out1",
      "anon",
      "notime",
      "in1",
    ]);
    expect(pick("in2")!.disabled).toBe(false);
    expect(pick("in1")!.disabled).toBe(false);
    // The owner's own message has no selector; unknown sender and missing time are disabled with the reason.
    expect(pick("out1")).toBeNull();
    expect(pick("anon")!.disabled).toBe(true);
    expect(msg("anon").textContent).toContain("didn't say who sent this");
    expect(pick("notime")!.disabled).toBe(true);
    expect(msg("notime").textContent).toContain("didn't say when this was sent");
    // Nothing is selected by itself: the DM opener asks for a choice first and is disabled with the reason.
    expect($("ibx-igdm-pick-first")!.textContent).toContain("Choose the message you're answering");
    expect($("ibx-igdm-target")).toBeNull();
    const open = $("ibx-igdm-open") as HTMLButtonElement;
    expect(open.textContent).toContain("Send as DM reply");
    expect(open.disabled).toBe(true);
    expect($("ibx-igdm-unavailable")!.textContent).toContain("aren't verified yet");
    // The older inbound message is selected explicitly; its context shows; the newer one never replaces it.
    await act(async () => pick("in1")!.click());
    expect(pick("in1")!.getAttribute("aria-pressed")).toBe("true");
    expect($("ibx-igdm-target")!.dataset.id).toBe("in1");
    expect($("ibx-igdm-target")!.textContent).toContain("@fan_one");
    expect($("ibx-igdm-target")!.textContent).toContain("text in1");
    await click("ibx-refresh");
    await until(() => expect(calls.filter((c) => c.endsWith("/c1/messages"))).toHaveLength(2));
    expect($("ibx-igdm-target")!.dataset.id).toBe("in1");
    // Save still works at the conversation scope and never sends; the opener stays disabled in production.
    await type("ibx-draft-text", "Yes, it is!");
    await click("ibx-draft-save");
    await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
    expect(S().inboxDrafts[draftScope("conversation", "c1")]?.text).toBe("Yes, it is!");
    expect(($("ibx-igdm-open") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-igdm-recovery")).toBeNull();
    S().setSettings({ lang: "ar" });
    await until(() => expect($("ibx-igdm-open")!.textContent).toContain("أرسله كرسالة خاصة"));
    expect($("ibx-igdm-unavailable")!.textContent).toContain("ما تأكدنا منه");
    expect(calls.some((c) => c.includes("/instagram/dm"))).toBe(false);
  });

  it("the DM recovery list stays visible when the account read fails, and shows the pending observation as uncertainty", async () => {
    await seedDm();
    routes["/social/inbox/account"] = () => json({ error: "token_expired" }, 409);
    await mount("en");
    await until(() => expect($("ibx-state")).not.toBeNull());
    const list = $("ibx-igdm-recovery")!;
    expect(list.textContent).toContain("Instagram DMs to check");
    expect(list.textContent).toContain("in1");
    const status = list.querySelector<HTMLElement>('[data-testid="ibx-igdm-status"]')!;
    expect(status.dataset.state).toBe("dispatching");
    expect(status.dataset.pending).toBe("rejected");
    expect(status.textContent).toContain("isn't settled");
    expect(list.querySelector('[data-testid="ibx-igdm-check"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="ibx-igdm-open"]')).toBeNull();
    expect(calls.some((c) => c.includes("/instagram/dm"))).toBe(false);
  });

  it("the DM recovery list stays visible with another account selected and with messages denied", async () => {
    await seedDm();
    routes["/social/inbox/account"] = () =>
      json({
        accountId: "17841400000000002",
        handle: "other",
        generation: GEN,
        capabilities: { messages: "no_permission", comments: "ok" },
      });
    await mount("en");
    await until(() => expect($("ibx-state")).not.toBeNull());
    expect($("ibx-igdm-recovery")!.textContent).toContain("in1");
    await click("ibx-provider-threads");
    await until(() => expect($("ibx-igdm-recovery")).toBeNull());
  });
});

describe("Instagram conversation takeover (DT-6B-2C-5B)", () => {
  beforeEach(() => {
    resetProviderInbox();
    useProviderInbox.setState({ provider: "instagram" });
  });
  const CONV_MSGS = "/social/inbox/conversations/c1/messages";
  const KEY = [WORKER, ACC, "c1"].map(encodeURIComponent).join("|");
  const seedControl = async () => {
    const r = await S().setInboxInstagramDmControl(
      KEY,
      {
        workerOrigin: WORKER,
        account: ACC,
        conversationId: "c1",
        handleId: "a".repeat(32),
        recipientId: "p1",
        registeredGeneration: "e".repeat(32),
        evidenceDigest: "f".repeat(64),
        mode: "human",
        revision: 2,
        inFlightTotal: 1,
        inFlightTruncated: false,
        uncertainTotal: 0,
      },
      null,
    );
    if (!r.ok) throw new Error(r.reason);
  };

  it("an open conversation shows the takeover controls beside the DM opener; linking is closed with the reason (ar/en)", async () => {
    routes[CONV_MSGS] = () =>
      json({ ...head, items: [message("in1")], next: null, coverage: "end" });
    await mount("en");
    await until(() => expect($$("ibx-conv")).toHaveLength(2));
    await click("ibx-conv");
    await until(() => expect($$("ibx-msg")).toHaveLength(1));
    const ctl = $("ibx-igctl")!;
    expect(ctl.dataset.key).toBe(KEY);
    expect(($("ibx-igctl-register") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-igctl-register-unavailable")!.textContent).toContain("isn't verified yet");
    // The DM opener stays its own control: neither one drives the other.
    expect($("ibx-igdm-open")).not.toBeNull();
    expect(ctl.contains($("ibx-igdm-open"))).toBe(false);
    S().setSettings({ lang: "ar" });
    await until(() => expect($("ibx-igctl-register")!.textContent).toContain("اربط هذي المحادثة"));
    expect(calls.some((c) => c.includes("/instagram/dm"))).toBe(false);
  });

  it("the control recovery list stays mounted when the account read fails and on another provider; it asks nothing by itself", async () => {
    await seedControl();
    routes["/social/inbox/account"] = () => json({ error: "token_expired" }, 409);
    await mount("en");
    await until(() => expect($("ibx-state")).not.toBeNull());
    const list = $("ibx-igctl-recovery")!;
    expect(list.textContent).toContain("c1");
    expect(list.querySelector<HTMLElement>('[data-testid="ibx-igctl-status"]')!.dataset.mode).toBe(
      "human",
    );
    expect(list.querySelector('[data-testid="ibx-igctl-check"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="ibx-igctl-register"]')).toBeNull();
    await click("ibx-provider-threads");
    await until(() => expect(useProviderInbox.getState().provider).toBe("threads"));
    expect($("ibx-igctl-recovery")).not.toBeNull();
    expect(calls.some((c) => c.includes("/instagram/dm"))).toBe(false);
  });
});
