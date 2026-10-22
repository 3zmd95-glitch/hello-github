import { describe, expect, it, vi } from "vitest";
import {
  INBOX_DRAFT_MAX,
  INBOX_ITEMS_MAX,
  emptyList,
  inboxAccount,
  inboxComments,
  inboxConversations,
  inboxMedia,
  inboxMessages,
  inboxScope,
  mergeFailure,
  mergePages,
  parseAccount,
  parseCommentsPage,
  parseConversationsPage,
  parseMediaPage,
  parseMessagesPage,
  providerLink,
  validDraft,
  type ConversationItem,
  type InboxPage,
} from "./inbox";
import {
  inboxScopeV2,
  parseThreadsAccount,
  parseThreadsPostsPage,
  parseThreadsRepliesPage,
  parseYouTubeAccount,
  parseYouTubeThreadsPage,
  parseYouTubeVideosPage,
  threadsAccount,
  threadsLink,
  threadsPosts,
  threadsReplies,
  youtubeAccount,
  youtubeLink,
  youtubeReplies,
  youtubeThreads,
  youtubeVideos,
} from "./inbox";
import {
  bindIntent,
  cancelSend,
  confirmSend,
  parseSendIntent,
  prepareSend,
  sendDigest,
  sendStatus,
  youtubeCommentLink,
} from "./inbox";

// 📥 Inbox client (packet DT-6A): allowlisted parsers, scope keys, page merging with dedupe and honest coverage,
// the provider-link allowlist and the draft limit. Transport is a fake fetch: nothing here reaches Instagram.

const CFG = { url: "https://scout.example.workers.dev", token: "owner-token" };
const ACC = { accountId: "17841400000000001", generation: "0123456789abcdef0123456789abcdef" };
const head = { ...ACC, fetchedAt: "2026-10-17T09:00:00.000Z" };

const conv = (id: string): ConversationItem => ({ id, updatedAt: null, participants: [] });
const page = (ids: string[], over: Partial<InboxPage<ConversationItem>> = {}) =>
  ({
    ...head,
    items: ids.map(conv),
    next: null,
    coverage: "end",
    ...over,
  }) as InboxPage<ConversationItem>;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("parsers", () => {
  it("accept the Worker's shapes", () => {
    expect(
      parseAccount({
        accountId: ACC.accountId,
        handle: null,
        generation: ACC.generation,
        capabilities: { messages: "ok", comments: "no_permission" },
      }),
    ).toMatchObject({ accountId: ACC.accountId, capabilities: { comments: "no_permission" } });
    expect(
      parseMessagesPage({
        ...head,
        items: [
          {
            id: "m1",
            createdAt: null,
            direction: "unknown",
            from: null,
            text: "",
            kind: "story_mention",
          },
        ],
        next: "abc.def",
        coverage: "more",
      })?.items[0].kind,
    ).toBe("story_mention");
    expect(
      parseMediaPage({
        ...head,
        items: [{ id: "m1", timestamp: null, commentsCount: 2 }],
        next: null,
        coverage: "end",
      }),
    ).not.toBeNull();
    expect(
      parseCommentsPage({
        ...head,
        items: [{ id: "k1", text: "hi", author: null, createdAt: null, direction: "in" }],
        next: null,
        coverage: "cap",
      }),
    ).not.toBeNull();
  });

  it("reject extra fields, unknown kinds and directions, long text and foreign permalinks", () => {
    const base = { ...head, next: null, coverage: "end" };
    expect(
      parseConversationsPage({ ...base, items: [], paging: { next: "https://x" } }),
    ).toBeNull();
    expect(
      parseConversationsPage({ ...base, items: [{ ...conv("c1"), access_token: "t" }] }),
    ).toBeNull();
    const m = { id: "m1", createdAt: null, direction: "in", from: null, text: "x", kind: "text" };
    expect(parseMessagesPage({ ...base, items: [{ ...m, kind: "audio" }] })).toBeNull();
    expect(parseMessagesPage({ ...base, items: [{ ...m, direction: "incoming" }] })).toBeNull();
    expect(parseMessagesPage({ ...base, items: [{ ...m, text: "x".repeat(2001) }] })).toBeNull();
    expect(
      parseMediaPage({
        ...base,
        items: [
          { id: "m1", timestamp: null, commentsCount: 0, permalink: "https://evil.example/p" },
        ],
      }),
    ).toBeNull();
    expect(
      parseAccount({ accountId: "1", handle: null, generation: "nope", capabilities: {} }),
    ).toBeNull();
    expect(parseConversationsPage({ ...base, coverage: "all", items: [] })).toBeNull();
  });
});

describe("inboxScope", () => {
  it("keys by Worker origin, stable account id, kind and id (never the handle or the token)", () => {
    const a = inboxScope("https://scout.example.workers.dev", ACC.accountId, "conversation", "c1");
    expect(a).toBe(
      inboxScope("https://scout.example.workers.dev", ACC.accountId, "conversation", "c1"),
    );
    expect(a).not.toBe(
      inboxScope("https://other.workers.dev", ACC.accountId, "conversation", "c1"),
    );
    expect(a).not.toBe(
      inboxScope("https://scout.example.workers.dev", "999", "conversation", "c1"),
    );
    expect(a).not.toBe(
      inboxScope("https://scout.example.workers.dev", ACC.accountId, "comment", "c1"),
    );
    expect(a).not.toContain("owner-token");
    // A "|" inside an id cannot forge another scope.
    expect(inboxScope("o", "a|b", "comment", "c")).not.toBe(inboxScope("o", "a", "comment", "b|c"));
  });
});

describe("mergePages", () => {
  it("appends a second page and deduplicates overlapping ids, keeping the first copy", () => {
    const one = mergePages(
      emptyList<ConversationItem>(),
      page(["c1", "c2"], { next: "n1", coverage: "more" }),
    );
    const two = mergePages(one, page(["c2", "c3"]));
    expect(two.items.map((i) => i.id)).toEqual(["c1", "c2", "c3"]);
    expect(two).toMatchObject({ next: null, coverage: "end", error: null });
  });

  it("replaces the list on a first page (refresh)", () => {
    const one = mergePages(emptyList<ConversationItem>(), page(["c1", "c2"]));
    expect(mergePages(one, page(["c9"]), true).items.map((i) => i.id)).toEqual(["c9"]);
  });

  it("stops at the local cap and says so", () => {
    let list = emptyList<ConversationItem>();
    for (let p = 0; p * 20 < INBOX_ITEMS_MAX + 40; p++) {
      const ids = Array.from({ length: 20 }, (_, i) => `c${p * 20 + i}`);
      list = mergePages(list, page(ids, { next: "n", coverage: "more" }));
    }
    expect(list.items).toHaveLength(INBOX_ITEMS_MAX);
    expect(list).toMatchObject({ next: null, coverage: "cap" });
  });

  it("a later page failure keeps the first page as partial; a first page failure is unavailable", () => {
    const one = mergePages(
      emptyList<ConversationItem>(),
      page(["c1"], { next: "n1", coverage: "more" }),
    );
    const partial = mergeFailure(one, { code: "upstream", coverage: "partial" });
    expect(partial).toMatchObject({ coverage: "partial", error: "upstream", next: "n1" });
    expect(partial.items.map((i) => i.id)).toEqual(["c1"]);
    const none = mergeFailure(emptyList<ConversationItem>(), { code: "rate_limited" });
    expect(none).toMatchObject({ coverage: "unavailable", error: "rate_limited", items: [] });
    const history = mergeFailure(emptyList<ConversationItem>(), {
      code: "upstream",
      coverage: "history_unavailable",
    });
    expect(history.coverage).toBe("history_unavailable");
  });
});

describe("providerLink", () => {
  it("allows only https instagram.com links", () => {
    expect(providerLink("https://www.instagram.com/reel/ABC/")).toBe(
      "https://www.instagram.com/reel/ABC/",
    );
    expect(providerLink("https://instagram.com/p/X/")).toBe("https://instagram.com/p/X/");
    for (const bad of [
      "http://www.instagram.com/p/X/",
      "https://instagram.com.evil.example/p/X/",
      "https://evil.example/?u=instagram.com",
      "javascript:alert(1)",
      "https://user:pw@www.instagram.com/p/X/",
      "",
      undefined,
    ])
      expect(providerLink(bad), String(bad)).toBeUndefined();
  });
});

describe("validDraft", () => {
  it("accepts up to 2,000 characters", () => {
    expect(validDraft("x".repeat(INBOX_DRAFT_MAX))).toBe(true);
    expect(validDraft("x".repeat(INBOX_DRAFT_MAX + 1))).toBe(false);
  });
});

describe("transport", () => {
  it("sends GET with the bearer, account and generation, and parses the page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply({ ...head, items: [conv("c1")], next: null, coverage: "end" }),
    );
    const r = await inboxConversations(CFG, ACC, "cur.sig", fetchImpl);
    expect(r).toMatchObject({ ok: true, page: { items: [{ id: "c1" }] } });
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe(`${CFG.url}/social/inbox/conversations`);
    expect(u.searchParams.get("account")).toBe(ACC.accountId);
    expect(u.searchParams.get("generation")).toBe(ACC.generation);
    expect(u.searchParams.get("cursor")).toBe("cur.sig");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer owner-token");
  });

  it("builds the messages, media and comments paths with encoded ids", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      seen.push(new URL(String(url)).pathname);
      return reply({ ...head, items: [], next: null, coverage: "end" });
    });
    await inboxMessages(CFG, ACC, "c=1", undefined, fetchImpl);
    await inboxMedia(CFG, ACC, undefined, fetchImpl);
    await inboxComments(CFG, ACC, "m1", undefined, fetchImpl);
    expect(seen).toEqual([
      "/social/inbox/conversations/c%3D1/messages",
      "/social/inbox/media",
      "/social/inbox/media/m1/comments",
    ]);
  });

  it("keeps the Worker's inbox codes and coverage, and maps auth, network and bad bodies", async () => {
    const one = (res: Response | Error) =>
      vi.fn<typeof fetch>(async () => {
        if (res instanceof Error) throw res;
        return res;
      });
    expect(await inboxAccount(null)).toEqual({ ok: false, error: { code: "unconfigured" } });
    expect(await inboxAccount(CFG, one(reply({ error: "unauthorized" }, 401)))).toMatchObject({
      ok: false,
      error: { code: "auth" },
    });
    expect(await inboxAccount(CFG, one(new TypeError("offline")))).toMatchObject({
      ok: false,
      error: { code: "network" },
    });
    for (const code of [
      "no_permission",
      "not_eligible",
      "token_expired",
      "rate_limited",
      "not_connected",
      "cursor_invalid",
      "stale",
    ]) {
      const r = await inboxConversations(CFG, ACC, undefined, one(reply({ error: code }, 409)));
      expect(r, code).toMatchObject({ ok: false, error: { code } });
    }
    const partial = await inboxConversations(
      CFG,
      ACC,
      "c",
      one(reply({ error: "upstream", coverage: "partial", detail: "x" }, 502)),
    );
    expect(partial).toMatchObject({ ok: false, error: { code: "upstream", coverage: "partial" } });
    const odd = await inboxConversations(
      CFG,
      ACC,
      undefined,
      one(reply({ ...head, items: [{ id: "c1", sneaky: true }], next: null, coverage: "end" })),
    );
    expect(odd).toMatchObject({ ok: false, error: { code: "upstream" } });
  });

  // DT-6A-R1 (6A-5): a well-formed page for another account or generation is stale, never this account's rows.
  it("refuses a page whose account or generation is not the one asked for, on every list", async () => {
    const other = [
      { accountId: "17841400000000002", generation: ACC.generation },
      { accountId: ACC.accountId, generation: "f".repeat(32) },
    ];
    for (const id of other) {
      const body = { ...id, fetchedAt: head.fetchedAt, items: [], next: null, coverage: "end" };
      const f = vi.fn<typeof fetch>(async () => reply(body));
      for (const r of [
        await inboxConversations(CFG, ACC, undefined, f),
        await inboxMessages(CFG, ACC, "c1", undefined, f),
        await inboxMedia(CFG, ACC, undefined, f),
        await inboxComments(CFG, ACC, "m1", undefined, f),
      ])
        expect(r).toEqual({ ok: false, error: { code: "stale" } });
    }
  });
});

// 📥 DT-6B-1: Threads and YouTube comment reads. New-provider scopes live in a versioned namespace (`v2|provider|…`);
// the Instagram scope strings stay byte-for-byte what DT-6A stored.
describe("provider scopes (DT-6B-1)", () => {
  it("keeps the legacy Instagram scope string exactly and puts new providers under v2", () => {
    expect(inboxScope("https://scout.test", "17841400000000001", "conversation", "c1")).toBe(
      "https%3A%2F%2Fscout.test|17841400000000001|conversation|c1",
    );
    expect(inboxScopeV2("threads", "https://scout.test", "25", "comment", "91")).toBe(
      "v2|threads|https%3A%2F%2Fscout.test|25|comment|91",
    );
  });

  it("never lets identical ids collide across Instagram, Threads and YouTube", () => {
    const o = "https://scout.test";
    const scopes = [
      inboxScope(o, "1", "comment", "9"),
      inboxScopeV2("threads", o, "1", "comment", "9"),
      inboxScopeV2("youtube", o, "1", "comment", "9"),
    ];
    expect(new Set(scopes).size).toBe(3);
    // No legacy scope starts with "v2|": its first part is an encoded origin.
    expect(inboxScope("v2", "threads", "comment", "9")).not.toBe(scopes[1]);
    expect(inboxScopeV2("threads", o, "a|b", "comment", "c")).not.toBe(
      inboxScopeV2("threads", o, "a", "comment", "b|c"),
    );
    expect(scopes.join()).not.toContain("owner-token");
  });
});

describe("provider links (DT-6B-1)", () => {
  it("allows only https links on the exact Threads and YouTube hosts, within the length bound", () => {
    expect(threadsLink("https://www.threads.net/@a/post/1")).toBe(
      "https://www.threads.net/@a/post/1",
    );
    expect(threadsLink("https://www.threads.com/@a/post/1")).toBe(
      "https://www.threads.com/@a/post/1",
    );
    expect(youtubeLink("https://www.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
    expect(youtubeLink("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    for (const bad of [
      "http://www.threads.net/x",
      "https://threads.net.evil.example/x",
      "https://evil.example/www.threads.net",
      "https://user:pw@www.threads.net/x",
      "https://www.threads.net:444/x",
      "https://www.youtube.com/watch?v=abc",
      `https://www.threads.net/${"x".repeat(2100)}`,
      "javascript:alert(1)",
      undefined,
    ])
      expect(threadsLink(bad)).toBeUndefined();
    for (const bad of [
      "https://m.youtube.com/watch?v=abc",
      "https://youtube.com.evil.example/",
      "https://www.threads.net/x",
      `https://youtu.be/${"x".repeat(2100)}`,
    ])
      expect(youtubeLink(bad)).toBeUndefined();
  });
});

describe("provider parsers (DT-6B-1)", () => {
  const GEN = "0123456789abcdef0123456789abcdef";
  const thHead = { provider: "threads", accountId: "25", generation: GEN, fetchedAt: "t" };
  const ytHead = { provider: "youtube", accountId: "UCa", generation: GEN, fetchedAt: "t" };
  const ytComment = (id: string) => ({
    id,
    text: "hi",
    author: null,
    createdAt: null,
    direction: "unknown",
  });

  it("accept the Worker's Threads and YouTube shapes", () => {
    expect(
      parseThreadsAccount({
        provider: "threads",
        accountId: "25",
        handle: "3z.prod",
        generation: GEN,
        capabilities: { replies: "no_permission" },
      }),
    ).toMatchObject({ capabilities: { replies: "no_permission" } });
    expect(
      parseYouTubeAccount({
        provider: "youtube",
        needsSelection: true,
        channels: [
          { accountId: "UCa", title: "A", generation: GEN, uploads: "x.y" },
          { accountId: "UCb", title: null, generation: GEN, uploads: null },
        ],
        capabilities: { comments: "ok" },
      })?.channels,
    ).toHaveLength(2);
    expect(
      parseThreadsPostsPage({
        ...thHead,
        items: [{ id: "1", ref: "a.b", timestamp: null, permalink: "https://www.threads.com/p" }],
        next: null,
        coverage: "end",
      }),
    ).not.toBeNull();
    expect(
      parseThreadsRepliesPage({
        ...thHead,
        items: [
          {
            id: "2",
            text: "",
            author: null,
            createdAt: null,
            direction: "unknown",
            kind: "media",
            rootId: "1",
            parentId: "1",
          },
        ],
        next: null,
        coverage: "end",
      }),
    ).not.toBeNull();
    expect(
      parseYouTubeVideosPage({
        ...ytHead,
        items: [
          { id: "v", ref: "a.b", permalink: "https://www.youtube.com/watch?v=v", timestamp: null },
        ],
        next: null,
        coverage: "end",
      }),
    ).not.toBeNull();
    expect(
      parseYouTubeThreadsPage({
        ...ytHead,
        items: [
          {
            id: "c",
            ref: "a.b",
            comment: ytComment("c"),
            totalReplyCount: 3,
            replies: [{ ...ytComment("c.r"), parentId: "c" }],
            repliesCoverage: "embedded",
          },
        ],
        next: "n.s",
        coverage: "more",
      }),
    ).not.toBeNull();
  });

  it("reject the wrong provider, extra fields, foreign links and more than ten channels", () => {
    const page = { items: [], next: null, coverage: "end" };
    expect(parseThreadsPostsPage({ ...ytHead, ...page })).toBeNull();
    expect(parseYouTubeVideosPage({ ...thHead, ...page })).toBeNull();
    expect(parseThreadsPostsPage({ ...thHead, ...page, extra: 1 })).toBeNull();
    expect(
      parseThreadsPostsPage({
        ...thHead,
        ...page,
        items: [{ id: "1", ref: "a.b", timestamp: null, permalink: "https://evil.example/p" }],
      }),
    ).toBeNull();
    expect(
      parseYouTubeAccount({
        provider: "youtube",
        needsSelection: true,
        channels: Array.from({ length: 11 }, (_, i) => ({
          accountId: `UC${i}`,
          title: null,
          generation: GEN,
          uploads: null,
        })),
        capabilities: { comments: "ok" },
      }),
    ).toBeNull();
  });

  it("DT-6B-1-R1 B1-3: a thread's reply total may be unknown (null), never negative or fractional", () => {
    const threadWith = (totalReplyCount: unknown) =>
      parseYouTubeThreadsPage({
        ...ytHead,
        items: [
          {
            id: "c",
            ref: "a.b",
            comment: ytComment("c"),
            totalReplyCount,
            replies: [{ ...ytComment("c.r"), parentId: "c" }],
            repliesCoverage: "embedded",
          },
        ],
        next: null,
        coverage: "end",
      });
    expect(threadWith(null)?.items[0].totalReplyCount).toBeNull();
    expect(threadWith(0)?.items[0].totalReplyCount).toBe(0);
    for (const bad of [-1, 1.5, "3", undefined]) expect(threadWith(bad)).toBeNull();
  });

  it("DT-6B-2B-1-R1 2B1-2: the additive Threads sendReplies readiness and direct-reply sendRef parse; nothing else does", () => {
    const acc = (capabilities: object) =>
      parseThreadsAccount({
        provider: "threads",
        accountId: "25",
        handle: null,
        generation: GEN,
        capabilities,
      });
    expect(acc({ replies: "ok", sendReplies: "permission_unverified" })?.capabilities).toEqual({
      replies: "ok",
      sendReplies: "permission_unverified",
    });
    expect(acc({ replies: "ok" })).not.toBeNull();
    for (const sendReplies of ["ok", "no_permission", "", null])
      expect(acc({ replies: "ok", sendReplies })).toBeNull();
    expect(acc({ replies: "ok", sendReplies: "permission_unverified", other: "ok" })).toBeNull();
    const reply = (over: Record<string, unknown>) =>
      parseThreadsRepliesPage({
        ...thHead,
        items: [
          {
            id: "2",
            text: "hi",
            author: null,
            createdAt: null,
            direction: "in",
            kind: "text",
            rootId: "1",
            parentId: "1",
            ...over,
          },
        ],
        next: null,
        coverage: "end",
      });
    expect(reply({ sendRef: "send.s" })?.items[0].sendRef).toBe("send.s");
    expect(reply({})?.items[0].sendRef).toBeUndefined();
    for (const sendRef of ["", "ab", "x".repeat(1501), 5, null])
      expect(reply({ sendRef })).toBeNull();
    expect(reply({ sendRef: "send.s", other: 1 })).toBeNull();
  });
});

describe("provider transport (DT-6B-1)", () => {
  const GEN = "0123456789abcdef0123456789abcdef";
  const TH = { accountId: "25", generation: GEN };
  const YT = { accountId: "UCa", generation: GEN, uploads: "up.ref" };
  const pageOf = (provider: string, acc: { accountId: string; generation: string }) => ({
    provider,
    accountId: acc.accountId,
    generation: acc.generation,
    fetchedAt: "t",
    items: [],
    next: null,
    coverage: "end",
  });

  it("builds every path with the sealed ref (encoded), the account, generation and cursor; GET only", async () => {
    const f = vi.fn<typeof fetch>(async (input) => {
      const yt = new URL(String(input)).pathname.includes("/youtube/");
      return reply(yt ? pageOf("youtube", YT) : pageOf("threads", TH));
    });
    expect((await threadsPosts(CFG, TH, "cur.1", f)).ok).toBe(true);
    await threadsReplies(CFG, TH, "p/ref.x", undefined, f);
    expect((await youtubeVideos(CFG, YT, undefined, f)).ok).toBe(true);
    await youtubeThreads(CFG, YT, "v.ref", undefined, f);
    await youtubeReplies(CFG, YT, "c.ref", "cur.2", f);
    const urls = f.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((u) => u.pathname)).toEqual([
      "/social/inbox/threads/posts",
      "/social/inbox/threads/posts/p%2Fref.x/replies",
      "/social/inbox/youtube/videos",
      "/social/inbox/youtube/videos/v.ref/threads",
      "/social/inbox/youtube/comments/c.ref/replies",
    ]);
    expect(urls[0].searchParams.get("cursor")).toBe("cur.1");
    expect(urls[2].searchParams.get("uploads")).toBe("up.ref");
    expect(urls[4].searchParams.get("account")).toBe("UCa");
    expect(urls[4].searchParams.get("cursor")).toBe("cur.2");
    expect(f.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("refuses a page of another provider, account or generation (never merged as this account's)", async () => {
    for (const body of [
      pageOf("youtube", TH),
      pageOf("threads", { accountId: "26", generation: GEN }),
      pageOf("threads", { accountId: "25", generation: "f".repeat(32) }),
    ]) {
      const f = vi.fn<typeof fetch>(async () => reply(body));
      expect((await threadsPosts(CFG, TH, undefined, f)).ok).toBe(false);
    }
    const f = vi.fn<typeof fetch>(async () =>
      reply(pageOf("threads", { accountId: "26", generation: GEN })),
    );
    expect(await threadsPosts(CFG, TH, undefined, f)).toEqual({
      ok: false,
      error: { code: "stale" },
    });
  });

  it("keeps the YouTube comment states and parses both accounts", async () => {
    for (const code of ["comments_disabled", "video_not_found"]) {
      const f = vi.fn<typeof fetch>(async () =>
        reply({ error: code, coverage: "unavailable" }, 403),
      );
      expect(await youtubeThreads(CFG, YT, "v.ref", undefined, f)).toEqual({
        ok: false,
        error: { code, coverage: "unavailable" },
      });
    }
    const th = vi.fn<typeof fetch>(async () =>
      reply({
        provider: "threads",
        accountId: "25",
        handle: null,
        generation: GEN,
        capabilities: { replies: "ok" },
      }),
    );
    expect((await threadsAccount(CFG, th)).ok).toBe(true);
    const yt = vi.fn<typeof fetch>(async () =>
      reply({
        provider: "youtube",
        needsSelection: true,
        channels: [],
        capabilities: { comments: "ok" },
      }),
    );
    expect(await youtubeAccount(CFG, yt)).toMatchObject({ ok: true, account: { channels: [] } });
  });
});

// 📤 DT-6B-2A (planning/tools/37-inbox-send.md): the reviewed YouTube reply client. Additive parser fields, the intent
// parser, the digest the Worker computes, the exact comment link, and the four send calls (bearer, JSON, typed codes).
describe("reviewed YouTube replies (DT-6B-2A)", () => {
  const G = "a".repeat(32);
  const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const intent = (over: Record<string, unknown> = {}) => ({
    operationId: "op-12345678",
    provider: "youtube",
    account: "UCa",
    generation: G,
    threadId: "UgThreadX",
    videoId: "vid1",
    parentCommentId: "UgTop1",
    text: "Thanks!",
    digest: EMPTY,
    draftRevision: "rev-1",
    state: "prepared",
    reviewExpiresAt: "2026-10-17T09:10:00.000Z",
    createdAt: "2026-10-17T09:00:00.000Z",
    updatedAt: "2026-10-17T09:00:00.000Z",
    ...over,
  });
  const c = { id: "Ug1.r1", text: "x", author: null, createdAt: null, direction: "in" };
  const threadsPage = (items: unknown[]) => ({
    provider: "youtube",
    accountId: "UCa",
    generation: G,
    fetchedAt: "2026-10-17T09:00:00.000Z",
    items,
    next: null,
    coverage: "end",
  });

  it("accepts the additive sendRef, replyParentNote and sendComments fields; older answers still parse", () => {
    const account = (capabilities: object) =>
      parseYouTubeAccount({
        provider: "youtube",
        needsSelection: false,
        channels: [],
        capabilities,
      });
    expect(account({ comments: "ok", sendComments: "no_permission" })?.capabilities).toEqual({
      comments: "ok",
      sendComments: "no_permission",
    });
    expect(account({ comments: "ok" })).not.toBeNull();
    expect(account({ comments: "ok", sendComments: "yes" })).toBeNull();
    const page = parseYouTubeThreadsPage(
      threadsPage([
        {
          id: "Ug1",
          ref: "r.s",
          sendRef: "send.s",
          comment: { ...c, id: "Ug1" },
          totalReplyCount: 1,
          replies: [{ ...c, sendRef: "send.s", replyParentNote: true }],
          repliesCoverage: "embedded",
        },
      ]),
    );
    expect(page?.items[0].sendRef).toBe("send.s");
    expect(page?.items[0].replies[0]).toMatchObject({ sendRef: "send.s", replyParentNote: true });
    const old = {
      id: "Ug1",
      ref: "r.s",
      comment: { ...c, id: "Ug1" },
      totalReplyCount: 0,
      replies: [],
      repliesCoverage: "embedded",
    };
    expect(parseYouTubeThreadsPage(threadsPage([old]))).not.toBeNull();
    expect(
      parseYouTubeThreadsPage(
        threadsPage([{ ...old, replies: [{ ...c, replyParentNote: false }] }]),
      ),
    ).toBeNull();
  });

  it("parses an intent strictly: unknown fields, states and oversize text are refused", () => {
    expect(parseSendIntent(intent())).toMatchObject({ state: "prepared", text: "Thanks!" });
    expect(
      parseSendIntent(
        intent({
          state: "sent",
          providerCommentId: "UgTop1.r9",
          settledAt: "2026-10-17T09:01:00Z",
        }),
      ),
    ).toMatchObject({ providerCommentId: "UgTop1.r9" });
    expect(parseSendIntent(intent({ state: "resend" }))).toBeNull();
    expect(parseSendIntent(intent({ token: "leak" }))).toBeNull();
    expect(parseSendIntent(intent({ text: "x".repeat(2001) }))).toBeNull();
  });

  it("sendDigest is the SHA-256 of the trimmed text, as the Worker computes it", async () => {
    expect(sendDigest("")).toBe(EMPTY);
    expect(sendDigest("  Thanks!\n")).toBe(sendDigest("Thanks!"));
    const web = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("شكراً لك"));
    expect(sendDigest(" شكراً لك ")).toBe(
      [...new Uint8Array(web)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
  });

  it("youtubeCommentLink builds one exact www.youtube.com link or nothing", () => {
    expect(youtubeCommentLink("vid1", "UgTop1.r9")).toBe(
      "https://www.youtube.com/watch?v=vid1&lc=UgTop1.r9",
    );
    expect(youtubeCommentLink("vid 1", "x")).toBeUndefined();
    expect(youtubeCommentLink("vid1", "a/b")).toBeUndefined();
    expect(youtubeCommentLink("vid1", "x".repeat(300))).toBeUndefined();
  });

  it("the send calls carry the bearer and JSON, and keep the Worker's send codes", async () => {
    const cfg = { url: "https://scout.test", token: "tok" };
    const seen: { method: string; url: string; auth: string | null; body: unknown }[] = [];
    const reply = (status: number, body: unknown) =>
      vi.fn<typeof fetch>(async (input, init) => {
        seen.push({
          method: init?.method ?? "GET",
          url: String(input),
          auth: new Headers(init?.headers).get("Authorization"),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify(body), { status });
      });
    const ok = reply(200, { intent: intent() });
    const op = "op-12345678";
    expect(
      await prepareSend(
        cfg,
        { operationId: op, sendRef: "s.s", text: "Thanks!", draftRevision: "rev-1" },
        ok,
      ),
    ).toMatchObject({ ok: true, intent: { state: "prepared" } });
    expect(
      await confirmSend(cfg, { operationId: op, digest: EMPTY, account: "UCa" }, ok),
    ).toMatchObject({
      ok: true,
    });
    expect(await sendStatus(cfg, op, "UCa", ok)).toMatchObject({ ok: true });
    expect(await cancelSend(cfg, op, "UCa", ok)).toMatchObject({ ok: true });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST https://scout.test/social/inbox/youtube/send/prepare",
      "POST https://scout.test/social/inbox/youtube/send/confirm",
      "GET https://scout.test/social/inbox/youtube/send/op-12345678?account=UCa",
      "POST https://scout.test/social/inbox/youtube/send/op-12345678/cancel",
    ]);
    expect(seen.every((s) => s.auth === "Bearer tok")).toBe(true);
    expect(seen[0].body).toEqual({
      operationId: op,
      sendRef: "s.s",
      text: "Thanks!",
      draftRevision: "rev-1",
    });
    expect(seen[3].body).toEqual({ account: "UCa" });
    for (const code of [
      "not_public",
      "not_replyable",
      "target_invalid",
      "text_invalid",
      "conflict",
      "receipt_unavailable",
      "stale",
      "no_permission",
    ])
      expect(await sendStatus(cfg, op, "UCa", reply(409, { error: code }))).toEqual({
        ok: false,
        error: code,
      });
    expect(
      await sendStatus(
        cfg,
        op,
        "UCa",
        reply(503, { error: "not_configured", detail: "receipt-store" }),
      ),
    ).toEqual({ ok: false, error: "not_configured", detail: "receipt-store" });
    expect(
      await sendStatus(cfg, op, "UCa", reply(503, { error: "not_configured", detail: "<b>" })),
    ).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(await sendStatus(cfg, op, "UCa", reply(401, { error: "unauthorized" }))).toEqual({
      ok: false,
      error: "auth",
    });
    expect(await sendStatus(cfg, op, "UCa", reply(200, { intent: { state: "sent" } }))).toEqual({
      ok: false,
      error: "upstream",
    });
    const broken = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(
      await confirmSend(cfg, { operationId: op, digest: EMPTY, account: "UCa" }, broken),
    ).toEqual({
      ok: false,
      error: "network",
    });
    expect(await sendStatus(null, op, "UCa", ok)).toEqual({ ok: false, error: "unconfigured" });
  });

  it("DT-6B-2A-R1 (2A-4): a settled intent must carry its proof", () => {
    // sent without the provider comment id, rejected without the reason: not a receipt.
    expect(parseSendIntent(intent({ state: "sent" }))).toBeNull();
    expect(parseSendIntent(intent({ state: "sent", providerCommentId: "" }))).toBeNull();
    expect(parseSendIntent(intent({ state: "rejected" }))).toBeNull();
    expect(parseSendIntent(intent({ state: "rejected", failureCode: "forbidden" }))).toMatchObject({
      state: "rejected",
    });
  });

  it("DT-6B-2A-R1 (2A-4): bindIntent trusts only an answer about the operation the client asked about", () => {
    const text = "Thanks!";
    const own = intent({ digest: sendDigest(text) });
    const ok = { ok: true as const, intent: parseSendIntent(own)! };
    const expect1 = {
      operationId: "op-12345678",
      account: "UCa",
      generation: G,
      draftRevision: "rev-1",
      digest: sendDigest(text),
      text,
    };
    expect(bindIntent(ok, expect1)).toBe(ok);
    // Prepare may converge on another tab's operation for the same submission: no operation id is expected then.
    const other = { ok: true as const, intent: { ...ok.intent, operationId: "op-other-tab" } };
    expect(bindIntent(other, { ...expect1, operationId: undefined })).toBe(other);
    expect(bindIntent(other, expect1)).toEqual({ ok: false, error: "mismatch" });
    for (const over of [
      { account: "UCforeign" },
      { generation: "b".repeat(32) },
      { draftRevision: "rev-2" },
      { text: "Changed", digest: sendDigest("Changed") },
      { digest: sendDigest("something else") },
    ])
      expect(bindIntent({ ok: true, intent: { ...ok.intent, ...over } }, expect1)).toEqual({
        ok: false,
        error: "mismatch",
      });
    // A status read knows no text or generation: the handle's identity still binds it.
    const handle = {
      operationId: "op-12345678",
      account: "UCa",
      draftRevision: "rev-1",
      digest: sendDigest(text),
    };
    expect(bindIntent(ok, handle)).toBe(ok);
    expect(
      bindIntent({ ok: true, intent: { ...ok.intent, operationId: "op-zzzzzzzz" } }, handle),
    ).toEqual({
      ok: false,
      error: "mismatch",
    });
    // Failures pass through untouched.
    expect(bindIntent({ ok: false, error: "network" }, handle)).toEqual({
      ok: false,
      error: "network",
    });
  });

  it("DT-6B-2A-R2 (2A-R1-C): bindIntent also binds a known parent, video and thread", () => {
    const text = "Thanks!";
    const ok = {
      ok: true as const,
      intent: parseSendIntent(intent({ digest: sendDigest(text) }))!,
    };
    const known = {
      operationId: "op-12345678",
      account: "UCa",
      draftRevision: "rev-1",
      digest: sendDigest(text),
      parentCommentId: "UgTop1",
      videoId: "vid1",
      threadId: "UgThreadX",
    };
    expect(bindIntent(ok, known)).toBe(ok);
    for (const over of [
      { parentCommentId: "UgForeign" },
      { videoId: "vidForeign" },
      { threadId: "UgThreadForeign" },
    ])
      expect(bindIntent({ ok: true, intent: { ...ok.intent, ...over } }, known)).toEqual({
        ok: false,
        error: "mismatch",
      });
    // Unknown target fields (a handle-only recovery) are not invented.
    const handle = {
      ...known,
      parentCommentId: undefined,
      videoId: undefined,
      threadId: undefined,
    };
    expect(
      bindIntent({ ok: true, intent: { ...ok.intent, parentCommentId: "UgOther" } }, handle).ok,
    ).toBe(true);
  });
});
