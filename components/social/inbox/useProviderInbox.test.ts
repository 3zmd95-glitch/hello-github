// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, useStore } from "@/store";
import { draftScope } from "./useInbox";
import {
  loadMoreProvider,
  loadReplies,
  openProvider,
  providerDraftScope,
  providerList,
  refreshProvider,
  resetProviderInbox,
  selectChannel,
  selectPost,
  selectVideo,
  setInboxProvider,
  useProviderInbox,
} from "./useProviderInbox";

// 📥 Threads and YouTube comment pages (packet DT-6B-1): reads only on open, Refresh, Load more and Load replies; the
// fence (epoch, origin, provider, account, generation, selection, list session) drops late results; a provider switch
// starts new sessions; fetched bodies never reach the persisted store.

const WORKER = "https://scout.test";
const GEN_A = "a".repeat(32);
const GEN_B = "b".repeat(32);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const thAccount = (accountId = "25", generation = GEN_A, replies = "ok") => ({
  provider: "threads",
  accountId,
  handle: "3z.prod",
  generation,
  capabilities: { replies },
});
const chan = (
  accountId: string,
  generation = GEN_A,
  uploads: string | null = `up-${accountId}.s`,
) => ({
  accountId,
  title: `Channel ${accountId}`,
  generation,
  uploads,
});
const ytAccount = (channels: unknown[], needsSelection = channels.length !== 1) => ({
  provider: "youtube",
  needsSelection,
  channels,
  capabilities: { comments: "ok" },
});
const page = (
  provider: string,
  accountId: string,
  items: unknown[],
  next: string | null = null,
  coverage = "end",
  generation = GEN_A,
) => ({
  provider,
  accountId,
  generation,
  fetchedAt: "2026-10-17T09:00:00.000Z",
  items,
  next,
  coverage,
});
const post = (id: string) => ({ id, ref: `ref-${id}.s`, timestamp: null, text: `post ${id}` });
const thReply = (id: string, text = `reply ${id}`) => ({
  id,
  text,
  author: null,
  createdAt: null,
  direction: "in",
  kind: "text",
});
const video = (id: string) => ({ id, ref: `vref-${id}.s`, timestamp: null });
const comment = (id: string, text = `comment ${id}`) => ({
  id,
  text,
  author: null,
  createdAt: null,
  direction: "in",
});
const thread = (id: string, replies: unknown[] = [], total = replies.length) => ({
  id,
  ref: `cref-${id}.s`,
  comment: comment(id),
  totalReplyCount: total,
  replies,
  repliesCoverage: "embedded",
});

type Route = (url: URL) => Response | Promise<Response>;
let routes: Record<string, Route>;
let calls: { path: string; method: string; cursor: string | null }[];

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetProviderInbox();
  useProviderInbox.setState({ provider: "instagram" });
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        path: decodeURIComponent(url.pathname),
        method: init?.method ?? "GET",
        cursor: url.searchParams.get("cursor"),
      });
      const route = routes[decodeURIComponent(url.pathname)];
      return route ? route(url) : json({ error: "not_found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderInbox();
});

const ids = (
  p: "threads" | "youtube",
  kind: "posts" | "replies" | "videos" | "threads",
  id?: string,
) => providerList(p, kind, id).items.map((i) => (i as { id: string }).id);

describe("Threads", () => {
  it("opens the account and own posts, then a post's replies through its sealed ref; GET only", async () => {
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    routes["/social/inbox/threads/posts"] = () =>
      json(page("threads", "25", [post("90001"), post("90002")]));
    routes["/social/inbox/threads/posts/ref-90001.s/replies"] = () =>
      json(page("threads", "25", [thReply("91001")], "cur.r", "more"));
    await setInboxProvider("threads");
    expect(ids("threads", "posts")).toEqual(["90001", "90002"]);
    await selectPost("90001");
    expect(ids("threads", "replies", "90001")).toEqual(["91001"]);
    routes["/social/inbox/threads/posts/ref-90001.s/replies"] = () =>
      json(page("threads", "25", [thReply("91001"), thReply("91002")]));
    await loadMoreProvider("threads", "replies");
    expect(calls.at(-1)?.cursor).toBe("cur.r");
    expect(ids("threads", "replies", "90001")).toEqual(["91001", "91002"]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(providerDraftScope("threads", "91001")).toBe(
      "v2|threads|https%3A%2F%2Fscout.test|25|comment|91001",
    );
  });

  it("without the replies permission never asks for replies", async () => {
    routes["/social/inbox/threads/account"] = () => json(thAccount("25", GEN_A, "no_permission"));
    routes["/social/inbox/threads/posts"] = () => json(page("threads", "25", [post("90001")]));
    await openProvider("threads");
    await selectPost("90001");
    expect(calls.some((c) => c.path.endsWith("/replies"))).toBe(false);
    expect(providerList("threads", "replies", "90001").coverage).toBeNull();
  });

  it("refuses a page bearing another account as stale; rows already shown stay", async () => {
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    routes["/social/inbox/threads/posts"] = (u) =>
      u.searchParams.get("cursor")
        ? json(page("threads", "26", [post("foreign")]))
        : json(page("threads", "25", [post("90001")], "cur.1", "more"));
    await openProvider("threads");
    await loadMoreProvider("threads", "posts");
    expect(ids("threads", "posts")).toEqual(["90001"]);
    expect(providerList("threads", "posts")).toMatchObject({ error: "stale", next: "cur.1" });
  });

  it("a reconnect (new generation) starts the lists over", async () => {
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    routes["/social/inbox/threads/posts"] = () => json(page("threads", "25", [post("old")]));
    await openProvider("threads");
    routes["/social/inbox/threads/account"] = () => json(thAccount("25", GEN_B));
    routes["/social/inbox/threads/posts"] = () =>
      json(page("threads", "25", [post("new")], null, "end", GEN_B));
    await refreshProvider("threads");
    expect(ids("threads", "posts")).toEqual(["new"]);
    expect(JSON.stringify(useProviderInbox.getState().lists)).not.toContain('"old"');
  });
});

describe("YouTube", () => {
  it("one channel is picked by itself and its uploads are read", async () => {
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("UCa")]));
    routes["/social/inbox/youtube/videos"] = (u) => {
      expect(u.searchParams.get("uploads")).toBe("up-UCa.s");
      return json(page("youtube", "UCa", [video("v1")]));
    };
    await setInboxProvider("youtube");
    expect(useProviderInbox.getState().channelId).toBe("UCa");
    expect(ids("youtube", "videos")).toEqual(["v1"]);
  });

  it("several channels wait for an explicit pick (never the first); an unlisted id is ignored", async () => {
    routes["/social/inbox/youtube/account"] = () =>
      json(ytAccount([chan("UCa"), chan("UCb", GEN_B)]));
    routes["/social/inbox/youtube/videos"] = () =>
      json(page("youtube", "UCb", [video("vb")], null, "end", GEN_B));
    await openProvider("youtube");
    expect(useProviderInbox.getState().channelId).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/videos"))).toBe(false);
    await selectChannel("UCz");
    expect(useProviderInbox.getState().channelId).toBeNull();
    await selectChannel("UCb");
    expect(ids("youtube", "videos")).toEqual(["vb"]);
    // A refresh with the same channels keeps the pick.
    await refreshProvider("youtube");
    expect(useProviderInbox.getState().channelId).toBe("UCb");
  });

  it("threads show embedded replies; Load replies pages by the top-level comment ref and dedupes the overlap", async () => {
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("UCa")]));
    routes["/social/inbox/youtube/videos"] = () => json(page("youtube", "UCa", [video("v1")]));
    routes["/social/inbox/youtube/videos/vref-v1.s/threads"] = () =>
      json(page("youtube", "UCa", [thread("Ug1", [comment("Ug1.r1")], 3)]));
    let n = 0;
    routes["/social/inbox/youtube/comments/cref-Ug1.s/replies"] = () => {
      n += 1;
      return n === 1
        ? json(page("youtube", "UCa", [comment("Ug1.r1"), comment("Ug1.r2")], "cur.y", "more"))
        : json(page("youtube", "UCa", [comment("Ug1.r2"), comment("Ug1.r3")]));
    };
    await openProvider("youtube");
    await selectVideo("v1");
    expect(ids("youtube", "threads", "v1")).toEqual(["Ug1"]);
    expect(calls.some((c) => c.path.endsWith("/replies"))).toBe(false);
    await loadReplies("Ug1");
    expect(ids("youtube", "replies", "Ug1")).toEqual(["Ug1.r1", "Ug1.r2"]);
    await loadReplies("Ug1");
    expect(calls.at(-1)?.cursor).toBe("cur.y");
    expect(ids("youtube", "replies", "Ug1")).toEqual(["Ug1.r1", "Ug1.r2", "Ug1.r3"]);
  });

  it("a failed first replies page keeps the embedded ones as partial and can be retried by hand", async () => {
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("UCa")]));
    routes["/social/inbox/youtube/videos"] = () => json(page("youtube", "UCa", [video("v1")]));
    routes["/social/inbox/youtube/videos/vref-v1.s/threads"] = () =>
      json(page("youtube", "UCa", [thread("Ug1", [comment("Ug1.r1")], 4)]));
    routes["/social/inbox/youtube/comments/cref-Ug1.s/replies"] = () =>
      json({ error: "rate_limited", coverage: "unavailable" }, 429);
    await openProvider("youtube");
    await selectVideo("v1");
    await loadReplies("Ug1");
    expect(providerList("youtube", "replies", "Ug1")).toMatchObject({
      coverage: "partial",
      error: "rate_limited",
    });
    expect(ids("youtube", "replies", "Ug1")).toEqual(["Ug1.r1"]);
    routes["/social/inbox/youtube/comments/cref-Ug1.s/replies"] = () =>
      json(page("youtube", "UCa", [comment("Ug1.r2")]));
    await loadReplies("Ug1");
    expect(ids("youtube", "replies", "Ug1")).toEqual(["Ug1.r1", "Ug1.r2"]);
  });

  it("keeps comments_disabled as the threads list's own state", async () => {
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("UCa")]));
    routes["/social/inbox/youtube/videos"] = () => json(page("youtube", "UCa", [video("v1")]));
    routes["/social/inbox/youtube/videos/vref-v1.s/threads"] = () =>
      json({ error: "comments_disabled", coverage: "unavailable" }, 403);
    await openProvider("youtube");
    await selectVideo("v1");
    expect(providerList("youtube", "threads", "v1")).toMatchObject({
      error: "comments_disabled",
      coverage: "unavailable",
    });
  });
});

describe("provider fences", () => {
  it("Threads → YouTube → Threads: the first visit's late page cannot replace the current visit's", async () => {
    let hold: (r: Response) => void = () => {};
    let phase = "first";
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    routes["/social/inbox/threads/posts"] = () =>
      phase === "first"
        ? new Promise<Response>((resolve) => (hold = resolve))
        : json(page("threads", "25", [post("current")]));
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("UCa")]));
    routes["/social/inbox/youtube/videos"] = () => json(page("youtube", "UCa", [video("v1")]));
    const first = setInboxProvider("threads");
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/posts"))).toBe(true));
    await setInboxProvider("youtube");
    phase = "return";
    await setInboxProvider("threads");
    expect(ids("threads", "posts")).toEqual(["current"]);
    hold(json(page("threads", "25", [post("late")])));
    await first;
    expect(ids("threads", "posts")).toEqual(["current"]);
    expect(ids("youtube", "videos")).toEqual(["v1"]);
    expect(Object.values(useProviderInbox.getState().busy).every((x) => !x)).toBe(true);
  });

  it("identical ids on Instagram, Threads and YouTube keep separate lists and draft scopes", async () => {
    routes["/social/inbox/threads/account"] = () => json(thAccount("1"));
    routes["/social/inbox/threads/posts"] = () => json(page("threads", "1", [post("9")]));
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("1")]));
    routes["/social/inbox/youtube/videos"] = () => json(page("youtube", "1", [video("9")]));
    await openProvider("threads");
    await openProvider("youtube");
    expect(ids("threads", "posts")).toEqual(["9"]);
    expect(ids("youtube", "videos")).toEqual(["9"]);
    const scopes = [
      draftScope("comment", "9"),
      providerDraftScope("threads", "9"),
      providerDraftScope("youtube", "9"),
    ];
    expect(new Set(scopes).size).toBe(3);
    expect(scopes.join()).not.toContain("owner-token");
  });

  it("a token change clears the view at once and drops a held page", async () => {
    let hold: (r: Response) => void = () => {};
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    routes["/social/inbox/threads/posts"] = () =>
      new Promise<Response>((resolve) => (hold = resolve));
    const old = openProvider("threads");
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/posts"))).toBe(true));
    useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "token-B" } });
    expect(useProviderInbox.getState().threads).toBeNull();
    hold(json(page("threads", "25", [post("OLD-TOKEN-private")])));
    await old;
    expect(JSON.stringify(useProviderInbox.getState().lists)).not.toContain("OLD-TOKEN-private");
  });

  it("a held account answer from before a token change is dropped", async () => {
    let hold: (r: Response) => void = () => {};
    routes["/social/inbox/youtube/account"] = () =>
      new Promise<Response>((resolve) => (hold = resolve));
    const old = openProvider("youtube");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "token-B" } });
    hold(json(ytAccount([chan("UCa")])));
    await old;
    expect(useProviderInbox.getState().youtube).toBeNull();
  });

  it("says unconfigured without a Worker and never fetches", async () => {
    useStore.getState().setSettings({ apiKeys: {} });
    await setInboxProvider("youtube");
    expect(useProviderInbox.getState().accountError.youtube).toBe("unconfigured");
    expect(calls).toEqual([]);
  });

  it("never writes fetched Threads or YouTube bodies to the persisted store (privacy canary)", async () => {
    const CANARY = "CANARY-provider-comment-4b7e";
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    routes["/social/inbox/threads/posts"] = () => json(page("threads", "25", [post("90001")]));
    routes["/social/inbox/threads/posts/ref-90001.s/replies"] = () =>
      json(page("threads", "25", [thReply("91001", CANARY)]));
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("UCa")]));
    routes["/social/inbox/youtube/videos"] = () => json(page("youtube", "UCa", [video("v1")]));
    routes["/social/inbox/youtube/videos/vref-v1.s/threads"] = () =>
      json(page("youtube", "UCa", [thread("Ug1", [comment("Ug1.r1", CANARY)])]));
    await openProvider("threads");
    await selectPost("90001");
    await openProvider("youtube");
    await selectVideo("v1");
    expect(JSON.stringify(useProviderInbox.getState().lists)).toContain(CANARY);
    useStore.getState().setSettings({ lang: "en" });
    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain(CANARY);
    expect(useStore.getState().exportState()).not.toContain(CANARY);
  });
});

/* ---------- DT-6B-1-R1 (B1-5, B1-6, B1-7): Codex's reproductions as regressions, plus controls ---------- */

const held = () => {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
};
const callsTo = (path: string) => calls.filter((c) => c.path === path).length;
const waitCalls = (path: string, n = 1) =>
  vi.waitFor(() => expect(callsTo(path)).toBeGreaterThanOrEqual(n));
const idle = () => Object.values(useProviderInbox.getState().busy).every((x) => !x);

const TH_POSTS = "/social/inbox/threads/posts";
const repliesOf = (id: string) => `/social/inbox/threads/posts/ref-${id}.s/replies`;
const threadsOf = (id: string) => `/social/inbox/youtube/videos/vref-${id}.s/threads`;
const C_REPLIES = "/social/inbox/youtube/comments/cref-C.s/replies";

async function openThreads(): Promise<void> {
  routes["/social/inbox/threads/account"] = () => json(thAccount());
  routes[TH_POSTS] = () => json(page("threads", "25", [post("P"), post("Q")]));
  await setInboxProvider("threads");
}

async function openYouTube(channels = [chan("UCa")]): Promise<void> {
  routes["/social/inbox/youtube/account"] = () => json(ytAccount(channels));
  routes["/social/inbox/youtube/videos"] = (u) =>
    json(page("youtube", u.searchParams.get("account")!, [video("V"), video("W")]));
  await setInboxProvider("youtube");
}

describe("DT-6B-1-R1 B1-5: every target navigation starts a fresh session", () => {
  it("Threads post P → Q → P: the return visit asks again and the abandoned answer is dropped", async () => {
    await openThreads();
    const h = held();
    let n = 0;
    routes[repliesOf("P")] = () =>
      ++n === 1 ? h.promise : json(page("threads", "25", [thReply("fresh")]));
    routes[repliesOf("Q")] = () => json(page("threads", "25", []));
    const first = selectPost("P");
    await waitCalls(repliesOf("P"));
    await selectPost("Q");
    await selectPost("P");
    expect(callsTo(repliesOf("P"))).toBe(2);
    h.resolve(json(page("threads", "25", [thReply("obsolete")])));
    await first;
    expect(ids("threads", "replies", "P")).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("YouTube video V → W → V: the return visit asks again and the abandoned answer is dropped", async () => {
    await openYouTube();
    const h = held();
    let n = 0;
    routes[threadsOf("V")] = () =>
      ++n === 1 ? h.promise : json(page("youtube", "UCa", [thread("fresh")]));
    routes[threadsOf("W")] = () => json(page("youtube", "UCa", []));
    const first = selectVideo("V");
    await waitCalls(threadsOf("V"));
    await selectVideo("W");
    await selectVideo("V");
    h.resolve(json(page("youtube", "UCa", [thread("obsolete")])));
    await first;
    expect(ids("youtube", "threads", "V")).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("YouTube channel A → B → A: the return visit asks again and the abandoned answer is dropped", async () => {
    routes["/social/inbox/youtube/account"] = () =>
      json(ytAccount([chan("UCa"), chan("UCb", GEN_B)]));
    await setInboxProvider("youtube");
    const h = held();
    let n = 0;
    routes["/social/inbox/youtube/videos"] = (u) =>
      u.searchParams.get("account") === "UCa"
        ? ++n === 1
          ? h.promise
          : json(page("youtube", "UCa", [video("fresh")]))
        : json(page("youtube", "UCb", [], null, "end", GEN_B));
    const first = selectChannel("UCa");
    await waitCalls("/social/inbox/youtube/videos");
    await selectChannel("UCb");
    await selectChannel("UCa");
    h.resolve(json(page("youtube", "UCa", [video("obsolete")])));
    await first;
    expect(ids("youtube", "videos")).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("leaving to null and back: a late error from the first visit never lands on the second", async () => {
    await openThreads();
    const h = held();
    let n = 0;
    routes[repliesOf("P")] = () =>
      ++n === 1 ? h.promise : json(page("threads", "25", [thReply("fresh")]));
    const first = selectPost("P");
    await waitCalls(repliesOf("P"));
    await selectPost(null);
    await selectPost("P");
    h.resolve(json({ error: "rate_limited", coverage: "unavailable" }, 429));
    await first;
    expect(providerList("threads", "replies", "P")).toMatchObject({ coverage: "end", error: null });
    expect(ids("threads", "replies", "P")).toEqual(["fresh"]);
  });

  it("an abandoned answer neither blocks nor releases the new visit's request", async () => {
    await openThreads();
    const h1 = held();
    const h2 = held();
    let n = 0;
    routes[repliesOf("P")] = () => (++n === 1 ? h1.promise : h2.promise);
    routes[repliesOf("Q")] = () => json(page("threads", "25", []));
    const first = selectPost("P");
    await waitCalls(repliesOf("P"));
    await selectPost("Q");
    const second = selectPost("P");
    await waitCalls(repliesOf("P"), 2);
    h1.resolve(json(page("threads", "25", [thReply("obsolete")])));
    await first;
    // Still the second visit's session: not released, nothing landed.
    expect(idle()).toBe(false);
    expect(providerList("threads", "replies", "P").coverage).toBeNull();
    h2.resolve(json(page("threads", "25", [thReply("fresh")])));
    await second;
    expect(ids("threads", "replies", "P")).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("control: a target already read keeps its rows on return and is not asked again", async () => {
    await openThreads();
    routes[repliesOf("P")] = () => json(page("threads", "25", [thReply("kept")]));
    routes[repliesOf("Q")] = () => json(page("threads", "25", []));
    await selectPost("P");
    await selectPost("Q");
    await selectPost("P");
    expect(ids("threads", "replies", "P")).toEqual(["kept"]);
    expect(callsTo(repliesOf("P"))).toBe(1);
  });
});

describe("DT-6B-1-R1 B1-6: provider visits fence account and open continuations", () => {
  it("leaving while the account answer is held never starts a hidden posts read", async () => {
    const h = held();
    routes["/social/inbox/threads/account"] = () => h.promise;
    routes[TH_POSTS] = () => json(page("threads", "25", [post("hidden")]));
    const first = setInboxProvider("threads");
    await waitCalls("/social/inbox/threads/account");
    await setInboxProvider("instagram");
    h.resolve(json(thAccount()));
    await first;
    expect(callsTo(TH_POSTS)).toBe(0);
    expect(useProviderInbox.getState().threads).toBeNull();
    expect(useProviderInbox.getState().accountBusy.threads).toBeFalsy();
    // Coming back opens the provider afresh.
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    await setInboxProvider("threads");
    expect(ids("threads", "posts")).toEqual(["hidden"]);
  });

  it("returning to Threads while the selected post's replies were held goes back to the posts list", async () => {
    await openThreads();
    const h = held();
    routes[repliesOf("P")] = () => h.promise;
    const old = selectPost("P");
    await waitCalls(repliesOf("P"));
    await setInboxProvider("instagram");
    await setInboxProvider("threads");
    expect(useProviderInbox.getState().postId).toBeNull();
    expect(ids("threads", "posts")).toEqual(["P", "Q"]);
    h.resolve(json(page("threads", "25", [thReply("obsolete")])));
    await old;
    expect(providerList("threads", "replies", "P").coverage).toBeNull();
    expect(callsTo(repliesOf("P"))).toBe(1);
    expect(idle()).toBe(true);
  });

  it("returning to YouTube while the selected video's threads were held goes back to the videos list", async () => {
    await openYouTube();
    const h = held();
    routes[threadsOf("V")] = () => h.promise;
    const old = selectVideo("V");
    await waitCalls(threadsOf("V"));
    await setInboxProvider("instagram");
    await setInboxProvider("youtube");
    expect(useProviderInbox.getState().videoId).toBeNull();
    expect(ids("youtube", "videos")).toEqual(["V", "W"]);
    h.resolve(json(page("youtube", "UCa", [thread("obsolete")])));
    await old;
    expect(providerList("youtube", "threads", "V").coverage).toBeNull();
    expect(callsTo(threadsOf("V"))).toBe(1);
  });

  it("control: returning to a provider whose selected view is loaded keeps it, with no new read and no reply fan-out", async () => {
    await openYouTube();
    routes[threadsOf("V")] = () =>
      json(page("youtube", "UCa", [thread("C", [comment("C.r1")], 5)]));
    await selectVideo("V");
    const before = calls.length;
    await setInboxProvider("instagram");
    await setInboxProvider("youtube");
    expect(useProviderInbox.getState().videoId).toBe("V");
    expect(ids("youtube", "threads", "V")).toEqual(["C"]);
    expect(calls.slice(before).some((c) => c.path.includes("/youtube/"))).toBe(false);
  });
});

describe("DT-6B-1-R1 B1-7: Refresh drops the refreshed video's loaded replies", () => {
  async function loadedReplies(): Promise<void> {
    await openYouTube();
    routes[threadsOf("V")] = () =>
      json(page("youtube", "UCa", [thread("C", [comment("R", "old")], 2)]));
    routes[C_REPLIES] = () => json(page("youtube", "UCa", [comment("R", "old"), comment("gone")]));
    await selectVideo("V");
    await loadReplies("C");
    expect(ids("youtube", "replies", "C")).toEqual(["R", "gone"]);
  }

  it("an edit, a deletion and a new count show after Refresh; replies reload only on demand", async () => {
    await loadedReplies();
    routes[threadsOf("V")] = () =>
      json(page("youtube", "UCa", [thread("C", [comment("R", "fresh")], 1)]));
    routes[C_REPLIES] = () => json(page("youtube", "UCa", [comment("R", "fresh")]));
    const before = callsTo(C_REPLIES);
    await refreshProvider("youtube");
    expect(providerList("youtube", "replies", "C").coverage).toBeNull();
    expect(callsTo(C_REPLIES)).toBe(before);
    const t = providerList<{ id: string; totalReplyCount: number; replies: { text: string }[] }>(
      "youtube",
      "threads",
      "V",
    ).items[0];
    expect(t.totalReplyCount).toBe(1);
    expect(t.replies.map((r) => r.text)).toEqual(["fresh"]);
    await loadReplies("C");
    expect(
      providerList<{ id: string; text: string }>("youtube", "replies", "C").items.map(
        (r) => r.text,
      ),
    ).toEqual(["fresh"]);
  });

  it("a reply page held across Refresh never lands afterwards", async () => {
    await loadedReplies();
    const h = held();
    routes[C_REPLIES] = () => h.promise;
    await refreshProvider("youtube");
    const old = loadReplies("C");
    await waitCalls(C_REPLIES, 2);
    routes[threadsOf("V")] = () =>
      json(page("youtube", "UCa", [thread("C", [comment("R", "newest")], 1)]));
    await refreshProvider("youtube");
    h.resolve(json(page("youtube", "UCa", [comment("R", "old"), comment("gone")])));
    await old;
    expect(providerList("youtube", "replies", "C").coverage).toBeNull();
    expect(idle()).toBe(true);
  });

  it("private drafts are untouched by Refresh", async () => {
    await loadedReplies();
    const scope = providerDraftScope("youtube", "gone");
    useStore.setState({
      inboxDrafts: {
        [scope]: {
          text: "my private reply",
          updatedAt: "2026-10-17T09:00:00.000Z",
          commitId: "c1",
        },
      },
    });
    const drafts = JSON.stringify(useStore.getState().inboxDrafts);
    await refreshProvider("youtube");
    expect(JSON.stringify(useStore.getState().inboxDrafts)).toBe(drafts);
  });

  it("control: Refresh with unchanged replies shows the embedded ones until Load replies", async () => {
    await loadedReplies();
    await refreshProvider("youtube");
    const t = providerList<{ replies: { text: string }[] }>("youtube", "threads", "V").items[0];
    expect(t.replies.map((r) => r.text)).toEqual(["old"]);
    await loadReplies("C");
    expect(ids("youtube", "replies", "C")).toEqual(["R", "gone"]);
  });
});

/* ---------- DT-6B-1-R2 (B1-R1-A): a newer read of the same list supersedes the pending one ---------- */

describe("DT-6B-1-R2 B1-R1-A: a newer read supersedes a pending one", () => {
  type T = { replies: { text: string }[] };
  const embedded = (text: string) =>
    json(page("youtube", "UCa", [thread("C", [comment("R", text)], 1)]));
  const shownReply = () =>
    providerList<T>("youtube", "threads", "V").items.map((t) => t.replies[0]?.text);
  const threadsBusy = () =>
    Object.entries(useProviderInbox.getState().busy).filter(
      ([k, v]) => v && k.split("|")[4] === "threads",
    ).length;

  async function videoOpen(): Promise<void> {
    await openYouTube();
    routes[threadsOf("V")] = () => embedded("initial");
    await selectVideo("V");
    expect(shownReply()).toEqual(["initial"]);
  }

  it("Refresh #1 held, Refresh #2 asks again; the old answer (obsolete) never lands, #2 (fresh) does", async () => {
    await videoOpen();
    const h = held();
    let n = 0;
    routes[threadsOf("V")] = () => (++n === 1 ? h.promise : embedded("fresh"));
    const first = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 2);
    await refreshProvider("youtube");
    expect(callsTo(threadsOf("V"))).toBe(3);
    expect(shownReply()).toEqual(["fresh"]);
    h.resolve(embedded("obsolete"));
    await first;
    expect(shownReply()).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("the superseded Refresh settling as an error neither marks the list nor replaces fresh rows", async () => {
    await videoOpen();
    const h = held();
    let n = 0;
    routes[threadsOf("V")] = () => (++n === 1 ? h.promise : embedded("fresh"));
    const first = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 2);
    await refreshProvider("youtube");
    expect(callsTo(threadsOf("V"))).toBe(3);
    h.resolve(json({ error: "rate_limited" }, 429));
    await first;
    expect(shownReply()).toEqual(["fresh"]);
    expect(providerList("youtube", "threads", "V").error).toBeNull();
    expect(idle()).toBe(true);
  });

  it("an initial read still pending is superseded by Refresh", async () => {
    await openYouTube();
    const h = held();
    let n = 0;
    routes[threadsOf("V")] = () => (++n === 1 ? h.promise : embedded("fresh"));
    const opening = selectVideo("V");
    await waitCalls(threadsOf("V"));
    await refreshProvider("youtube");
    expect(callsTo(threadsOf("V"))).toBe(2);
    h.resolve(embedded("obsolete"));
    await opening;
    expect(shownReply()).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("Threads: the first posts read still pending is superseded by Refresh", async () => {
    routes["/social/inbox/threads/account"] = () => json(thAccount());
    const h = held();
    let n = 0;
    routes[TH_POSTS] = () => (++n === 1 ? h.promise : json(page("threads", "25", [post("fresh")])));
    const opening = setInboxProvider("threads");
    await waitCalls(TH_POSTS);
    await refreshProvider("threads");
    expect(callsTo(TH_POSTS)).toBe(2);
    h.resolve(json(page("threads", "25", [post("obsolete")])));
    await opening;
    expect(ids("threads", "posts")).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("a pending next page is superseded by Refresh: the newer first page shows, no duplicate rows", async () => {
    routes["/social/inbox/youtube/account"] = () => json(ytAccount([chan("UCa")]));
    const h = held();
    routes["/social/inbox/youtube/videos"] = (u) =>
      u.searchParams.get("cursor")
        ? h.promise
        : json(page("youtube", "UCa", [video("V"), video("W")], "cur.2", "more"));
    await setInboxProvider("youtube");
    expect(ids("youtube", "videos")).toEqual(["V", "W"]);
    const more = loadMoreProvider("youtube", "videos");
    await vi.waitFor(() => expect(calls.some((c) => c.cursor === "cur.2")).toBe(true));
    routes["/social/inbox/youtube/videos"] = (u) =>
      u.searchParams.get("cursor")
        ? h.promise
        : json(page("youtube", "UCa", [video("N"), video("V"), video("W")]));
    await refreshProvider("youtube");
    expect(calls.filter((c) => c.path === "/social/inbox/youtube/videos").length).toBe(3);
    expect(ids("youtube", "videos")).toEqual(["N", "V", "W"]);
    h.resolve(json(page("youtube", "UCa", [video("W"), video("X")])));
    await more;
    expect(ids("youtube", "videos")).toEqual(["N", "V", "W"]);
    expect(providerList("youtube", "videos").coverage).toBe("end");
    expect(idle()).toBe(true);
  });

  it("the old settlement never releases the newer session's busy state", async () => {
    await videoOpen();
    const h1 = held();
    const h2 = held();
    let n = 0;
    routes[threadsOf("V")] = () => (++n === 1 ? h1.promise : h2.promise);
    const first = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 2);
    const second = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 3);
    const before = { ...useProviderInbox.getState().busy };
    expect(threadsBusy()).toBe(1);
    h1.resolve(embedded("obsolete"));
    await first;
    expect(useProviderInbox.getState().busy).toEqual(before);
    expect(shownReply()).toEqual(["initial"]);
    h2.resolve(embedded("fresh"));
    await second;
    expect(shownReply()).toEqual(["fresh"]);
    expect(idle()).toBe(true);
  });

  it("leaving the video during the wait: neither the superseded nor the superseding answer lands", async () => {
    await videoOpen();
    const h1 = held();
    const h2 = held();
    let n = 0;
    routes[threadsOf("V")] = () => (++n === 1 ? h1.promise : h2.promise);
    const first = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 2);
    const second = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 3);
    await selectVideo(null);
    h2.resolve(embedded("superseding"));
    h1.resolve(embedded("obsolete"));
    await Promise.all([first, second]);
    expect(shownReply()).toEqual(["initial"]);
    expect(idle()).toBe(true);
  });

  it("a provider switch during the wait: neither answer lands, nothing is revived on return", async () => {
    await videoOpen();
    const h1 = held();
    const h2 = held();
    let n = 0;
    routes[threadsOf("V")] = () => (++n === 1 ? h1.promise : h2.promise);
    const first = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 2);
    const second = refreshProvider("youtube");
    await waitCalls(threadsOf("V"), 3);
    await setInboxProvider("instagram");
    h1.resolve(embedded("obsolete"));
    h2.resolve(embedded("superseding"));
    await Promise.all([first, second]);
    await setInboxProvider("youtube");
    expect(shownReply()).toEqual(["initial"]);
    expect(callsTo(threadsOf("V"))).toBe(3);
    expect(idle()).toBe(true);
  });
});
