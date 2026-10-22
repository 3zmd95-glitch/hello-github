// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, useStore } from "@/store";
import {
  draftScope,
  listOf,
  loadMore,
  openInbox,
  refreshInbox,
  resetInbox,
  selectConversation,
  selectMedia,
  setInboxTab,
  useInbox,
} from "./useInbox";

// 📥 The inbox's in-memory store (packet DT-6A): reads only on open, Refresh and Load more; a request fence
// (origin, account id, generation, selection) drops late results; fetched bodies never reach the persisted store.

const WORKER = "https://scout.test";
const GEN_A = "a".repeat(32);
const GEN_B = "b".repeat(32);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const account = (accountId: string, generation: string, handle = "3z.prod") => ({
  accountId,
  handle,
  generation,
  capabilities: { messages: "ok", comments: "ok" },
});
const head = (accountId: string, generation: string) => ({
  accountId,
  generation,
  fetchedAt: "2026-10-17T09:00:00.000Z",
});
const conv = (id: string) => ({ id, updatedAt: null, participants: [] });

type Route = (url: URL) => Response | Promise<Response>;
let routes: Record<string, Route>;
let calls: { path: string; method: string; cursor: string | null }[];

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetInbox();
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        path: url.pathname,
        method: init?.method ?? "GET",
        cursor: url.searchParams.get("cursor"),
      });
      const route = routes[url.pathname];
      return route ? route(url) : json({ error: "not_found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetInbox();
});

const ids = (kind: "conversations" | "messages" | "media" | "comments", id?: string) =>
  listOf(kind, id).items.map((i) => (i as { id: string }).id);

describe("useInbox", () => {
  it("opens with the account and the conversations, GET only", async () => {
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    routes["/social/inbox/conversations"] = () =>
      json({ ...head("A", GEN_A), items: [conv("c1")], next: null, coverage: "end" });
    await openInbox();
    expect(useInbox.getState().account?.accountId).toBe("A");
    expect(ids("conversations")).toEqual(["c1"]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
  });

  it("loads more with the sealed cursor and deduplicates the overlap; a failing later page keeps the first", async () => {
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    let n = 0;
    routes["/social/inbox/conversations"] = () => {
      n += 1;
      if (n === 1)
        return json({
          ...head("A", GEN_A),
          items: [conv("c1"), conv("c2")],
          next: "cur.one",
          coverage: "more",
        });
      if (n === 2)
        return json({
          ...head("A", GEN_A),
          items: [conv("c2"), conv("c3")],
          next: "cur.two",
          coverage: "more",
        });
      return json({ error: "upstream", coverage: "partial" }, 502);
    };
    await openInbox();
    await loadMore("conversations");
    expect(calls.at(-1)?.cursor).toBe("cur.one");
    expect(ids("conversations")).toEqual(["c1", "c2", "c3"]);
    await loadMore("conversations");
    expect(ids("conversations")).toEqual(["c1", "c2", "c3"]);
    expect(listOf("conversations")).toMatchObject({ coverage: "partial", error: "upstream" });
  });

  it("drops a held account-A page once account B is loaded, and keys drafts by account", async () => {
    let release: (r: Response) => void = () => {};
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    routes["/social/inbox/conversations"] = () =>
      new Promise<Response>((resolve) => (release = resolve));
    const opening = openInbox();
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("conversations"))).toBe(true));
    const scopeA = draftScope("conversation", "c1");
    // The owner reconnects another account; Refresh reads B.
    routes["/social/inbox/account"] = () => json(account("B", GEN_B));
    routes["/social/inbox/conversations"] = () =>
      json({ ...head("B", GEN_B), items: [conv("b1")], next: null, coverage: "end" });
    await refreshInbox();
    release(json({ ...head("A", GEN_A), items: [conv("a1")], next: null, coverage: "end" }));
    await opening;
    expect(useInbox.getState().account?.accountId).toBe("B");
    expect(ids("conversations")).toEqual(["b1"]);
    expect(JSON.stringify(useInbox.getState().lists)).not.toContain("a1");
    expect(draftScope("conversation", "c1")).not.toBe(scopeA);
  });

  it("keeps lists and draft scopes when only the handle changes", async () => {
    routes["/social/inbox/account"] = () => json(account("A", GEN_A, "old.name"));
    routes["/social/inbox/conversations"] = () =>
      json({ ...head("A", GEN_A), items: [conv("c1")], next: null, coverage: "end" });
    await openInbox();
    const scope = draftScope("conversation", "c1");
    routes["/social/inbox/account"] = () => json(account("A", GEN_A, "new.name"));
    routes["/social/inbox/conversations"] = () =>
      new Promise<Response>(() => {
        /* never answers: the old list must stay */
      });
    void refreshInbox();
    await vi.waitFor(() => expect(useInbox.getState().account?.handle).toBe("new.name"));
    expect(ids("conversations")).toEqual(["c1"]);
    expect(draftScope("conversation", "c1")).toBe(scope);
  });

  it("drops a held messages page after the selection moved to another conversation", async () => {
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    routes["/social/inbox/conversations"] = () =>
      json({ ...head("A", GEN_A), items: [conv("c1"), conv("c2")], next: null, coverage: "end" });
    await openInbox();
    let release: (r: Response) => void = () => {};
    routes["/social/inbox/conversations/c1/messages"] = () =>
      new Promise<Response>((resolve) => (release = resolve));
    routes["/social/inbox/conversations/c2/messages"] = () =>
      json({ ...head("A", GEN_A), items: [], next: null, coverage: "end" });
    const first = selectConversation("c1");
    await vi.waitFor(() => expect(calls.some((c) => c.path.includes("c1"))).toBe(true));
    await selectConversation("c2");
    release(
      json({
        ...head("A", GEN_A),
        items: [
          { id: "m1", createdAt: null, direction: "in", from: null, text: "late", kind: "text" },
        ],
        next: null,
        coverage: "end",
      }),
    );
    await first;
    expect(ids("messages", "c1")).toEqual([]);
    expect(useInbox.getState().conversationId).toBe("c2");
    // The dropped request does not leave c1 stuck as busy: opening it again reads it.
    routes["/social/inbox/conversations/c1/messages"] = () =>
      json({ ...head("A", GEN_A), items: [], next: null, coverage: "end" });
    await selectConversation("c1");
    expect(listOf("messages", "c1").coverage).toBe("end");
  });

  it("reads comments only when the Comments tab or a post is opened, and keeps each surface's own error", async () => {
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    routes["/social/inbox/conversations"] = () =>
      json({ ...head("A", GEN_A), items: [conv("c1")], next: null, coverage: "end" });
    routes["/social/inbox/media"] = () => json({ error: "no_permission" }, 403);
    await openInbox();
    expect(calls.some((c) => c.path === "/social/inbox/media")).toBe(false);
    await setInboxTab("comments");
    expect(listOf("media")).toMatchObject({ error: "no_permission", coverage: "unavailable" });
    expect(ids("conversations")).toEqual(["c1"]);
    routes["/social/inbox/media/m1/comments"] = () =>
      json({ ...head("A", GEN_A), items: [], next: null, coverage: "end" });
    await selectMedia("m1");
    expect(listOf("comments", "m1")).toMatchObject({ coverage: "end", error: null });
  });

  // DT-6A-R1 (6A-3): a changed Worker URL or token is a new connection epoch: the old view goes at once and every
  // read started before it is dropped, even while the new account lookup is still waiting.
  it("a token change clears the view at once and drops an old-token page released while the new account waits", async () => {
    let releasePage: (r: Response) => void = () => {};
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    routes["/social/inbox/conversations"] = () =>
      new Promise<Response>((resolve) => (releasePage = resolve));
    const old = openInbox();
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("conversations"))).toBe(true));
    let releaseAccount: (r: Response) => void = () => {};
    routes["/social/inbox/account"] = () =>
      new Promise<Response>((resolve) => (releaseAccount = resolve));
    useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "token-B" } });
    expect(useInbox.getState().account).toBeNull();
    const fresh = openInbox();
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.path === "/social/inbox/account")).toHaveLength(2),
    );
    releasePage(
      json({
        ...head("A", GEN_A),
        items: [conv("OLD-TOKEN-private")],
        next: null,
        coverage: "end",
      }),
    );
    await old;
    expect(JSON.stringify(useInbox.getState().lists)).not.toContain("OLD-TOKEN-private");
    expect(useInbox.getState().account).toBeNull();
    releaseAccount(json({ error: "unauthorized" }, 401));
    await fresh;
    expect(useInbox.getState()).toMatchObject({ account: null, accountError: "auth" });
    expect(JSON.stringify(useInbox.getState().lists)).not.toContain("OLD-TOKEN-private");
  });

  it("a held old-token account answer is dropped after the token changed", async () => {
    let releaseOld: (r: Response) => void = () => {};
    routes["/social/inbox/account"] = () =>
      new Promise<Response>((resolve) => (releaseOld = resolve));
    const old = openInbox();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "token-B" } });
    releaseOld(json(account("A", GEN_A)));
    await old;
    expect(useInbox.getState().account).toBeNull();
  });

  it("draft scopes carry the origin and account id, never the token", async () => {
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    routes["/social/inbox/conversations"] = () =>
      json({ ...head("A", GEN_A), items: [], next: null, coverage: "end" });
    await openInbox();
    const scope = draftScope("conversation", "c1");
    useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "token-B" } });
    await openInbox();
    expect(draftScope("conversation", "c1")).toBe(scope);
    expect(scope).not.toMatch(/owner-token|token-B/);
  });

  // DT-6A-R1 (6A-4): a request belongs to one session of its list; Worker A → B → A starts new sessions, so the
  // first visit's late answer can never land in the second visit.
  it("Worker A → B → A: the first visit's late page cannot replace the current visit's", async () => {
    const OTHER = "https://other.test";
    let hold: (r: Response) => void = () => {};
    let phase = "first";
    routes["/social/inbox/account"] = (url) =>
      json(url.origin === WORKER ? account("A", GEN_A) : account("B", GEN_B));
    routes["/social/inbox/conversations"] = (url) =>
      url.origin === OTHER
        ? json({ ...head("B", GEN_B), items: [conv("B-current")], next: null, coverage: "end" })
        : phase === "first"
          ? new Promise<Response>((resolve) => (hold = resolve))
          : json({ ...head("A", GEN_A), items: [conv("A-new")], next: null, coverage: "end" });
    const old = openInbox();
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("conversations"))).toBe(true));
    useStore.getState().setSettings({ apiKeys: { scoutUrl: OTHER, scoutToken: "owner-token" } });
    await openInbox();
    expect(ids("conversations")).toEqual(["B-current"]);
    phase = "return";
    useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    await openInbox();
    expect(ids("conversations")).toEqual(["A-new"]);
    hold(json({ ...head("A", GEN_A), items: [conv("A-old")], next: null, coverage: "end" }));
    await old;
    expect(ids("conversations")).toEqual(["A-new"]);
    expect(Object.values(useInbox.getState().busy).every((x) => !x)).toBe(true);
  });

  it("an account switch and back (same Worker) also keeps the first visit's late page out", async () => {
    let hold: (r: Response) => void = () => {};
    let who = "A";
    let phase = "first";
    routes["/social/inbox/account"] = () =>
      json(who === "A" ? account("A", GEN_A) : account("B", GEN_B));
    routes["/social/inbox/conversations"] = () =>
      who === "B"
        ? json({ ...head("B", GEN_B), items: [conv("B-current")], next: null, coverage: "end" })
        : phase === "first"
          ? new Promise<Response>((resolve) => (hold = resolve))
          : json({ ...head("A", GEN_A), items: [conv("A-new")], next: null, coverage: "end" });
    const old = openInbox();
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("conversations"))).toBe(true));
    who = "B";
    await refreshInbox();
    who = "A";
    phase = "return";
    await refreshInbox();
    expect(ids("conversations")).toEqual(["A-new"]);
    hold(json({ ...head("A", GEN_A), items: [conv("A-old")], next: null, coverage: "end" }));
    await old;
    expect(ids("conversations")).toEqual(["A-new"]);
  });

  // DT-6A-R1 (6A-5): a page is accepted only for the account and generation it was asked for.
  for (const [what, page] of [
    ["another account", head("B", GEN_A)],
    ["another generation", head("A", GEN_B)],
  ] as const) {
    it(`a page bearing ${what} is refused as stale; rows already shown stay`, async () => {
      routes["/social/inbox/account"] = () => json(account("A", GEN_A));
      routes["/social/inbox/conversations"] = (url) =>
        url.searchParams.get("cursor")
          ? json({ ...page, items: [conv("foreign")], next: "cur.x", coverage: "more" })
          : json({ ...head("A", GEN_A), items: [conv("c1")], next: "cur.one", coverage: "more" });
      await openInbox();
      await loadMore("conversations");
      expect(ids("conversations")).toEqual(["c1"]);
      expect(listOf("conversations")).toMatchObject({ error: "stale", next: "cur.one" });
      resetInbox();
      routes["/social/inbox/conversations"] = () =>
        json({ ...page, items: [conv("foreign")], next: null, coverage: "end" });
      await openInbox();
      expect(ids("conversations")).toEqual([]);
      expect(listOf("conversations")).toMatchObject({ error: "stale", coverage: "unavailable" });
    });
  }

  it("says unconfigured without a Worker and never fetches", async () => {
    useStore.getState().setSettings({ apiKeys: {} });
    await openInbox();
    expect(useInbox.getState().accountError).toBe("unconfigured");
    expect(calls).toEqual([]);
  });

  it("never writes fetched bodies to the persisted store (privacy canary)", async () => {
    const CANARY = "CANARY-inbox-message-91c2";
    routes["/social/inbox/account"] = () => json(account("A", GEN_A));
    routes["/social/inbox/conversations"] = () =>
      json({
        ...head("A", GEN_A),
        items: [{ id: "c1", updatedAt: null, participants: [{ id: "p1", username: CANARY }] }],
        next: null,
        coverage: "end",
      });
    routes["/social/inbox/conversations/c1/messages"] = () =>
      json({
        ...head("A", GEN_A),
        items: [
          { id: "m1", createdAt: null, direction: "in", from: null, text: CANARY, kind: "text" },
        ],
        next: null,
        coverage: "end",
      });
    await openInbox();
    await selectConversation("c1");
    expect(JSON.stringify(useInbox.getState().lists)).toContain(CANARY);
    useStore.getState().setSettings({ lang: "en" });
    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain(CANARY);
    expect(useStore.getState().exportState()).not.toContain(CANARY);
  });
});
