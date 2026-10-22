import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DM_TEXT_BYTES,
  IG_COMMENT_MAX,
  INBOX_POLL_MS,
  TT_COMMENT_MAX,
  inboxCall,
  inboxComments,
  inboxConversations,
  inboxOverview,
  inboxPosts,
  inboxRefresh,
  inboxThread,
  inboxWipe,
  seenKey,
  unreadCount,
  utf8Bytes,
} from "./inbox";

const CONFIG = { url: "https://scout.test", token: "tok" };

const conversation = {
  platform: "instagram",
  id: "c1",
  peerId: "p1",
  peerName: "سارة",
  updatedAt: "2026-10-22T10:00:00.000Z",
  lastText: "هلا",
  lastFrom: "peer",
  windowClosesAt: "2026-10-23T10:00:00.000Z",
  answeredBy: null,
};
const message = {
  platform: "instagram",
  convId: "c1",
  id: "m1",
  at: "2026-10-22T10:00:00.000Z",
  fromPeer: true,
  text: "هلا",
  kind: "text",
  sentBy: "peer",
};
const post = {
  platform: "instagram",
  id: "m9",
  permalink: "https://instagram.com/p/x",
  thumbUrl: null,
  caption: "",
  postedAt: "2026-10-20T10:00:00.000Z",
  commentCount: 2,
};
const comment = {
  platform: "instagram",
  postId: "m9",
  id: "k1",
  parentId: null,
  at: "2026-10-22T09:00:00.000Z",
  author: "sara",
  authorId: "p1",
  text: "حلو",
  hidden: false,
  ours: false,
  sentBy: null,
};
const overview = {
  platforms: {
    instagram: {
      connected: true,
      canReply: true,
      tokenExpired: false,
      lastReadAt: "2026-10-22T10:01:00.000Z",
      newestAt: "2026-10-22T10:00:00.000Z",
    },
    tiktok: {
      connected: false,
      canReply: false,
      tokenExpired: false,
      lastReadAt: null,
      newestAt: null,
    },
  },
  counts: { conversations: 1, posts: 1, comments: 2 },
};

function answer(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calledWith = (fetchMock: ReturnType<typeof answer>) => {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), init: init as RequestInit };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("limits", () => {
  it("mirrors the platforms' limits", () => {
    expect([DM_TEXT_BYTES, IG_COMMENT_MAX, TT_COMMENT_MAX, INBOX_POLL_MS]).toEqual([
      1000, 2200, 150, 15_000,
    ]);
  });
});

describe("reads", () => {
  it("inboxOverview sends the bearer token and parses a valid body", async () => {
    const fetchMock = answer(overview);
    const res = await inboxOverview(CONFIG);
    expect(res).toEqual({ ok: true, overview });
    const { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("answers upstream when the body is not the expected shape", async () => {
    answer({ platforms: {}, counts: {} });
    expect(await inboxOverview(CONFIG)).toEqual({ ok: false, error: { type: "upstream" } });
  });

  it("answers upstream for an OK answer that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })),
    );
    expect(await inboxOverview(CONFIG)).toEqual({ ok: false, error: { type: "upstream" } });
  });

  it("answers unconfigured without calling when there is no Worker", async () => {
    const fetchMock = answer(overview);
    expect(await inboxOverview(null)).toEqual({ ok: false, error: { type: "unconfigured" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("inboxConversations asks for a platform and passes the cursor through untouched", async () => {
    const fetchMock = answer({ conversations: [conversation], more: true, next: "t|c1" });
    const res = await inboxConversations(CONFIG, { platform: "instagram", before: "t|c1" });
    expect(res).toEqual({ ok: true, conversations: [conversation], more: true, next: "t|c1" });
    const params = new URL(calledWith(fetchMock).url).searchParams;
    expect(new URL(calledWith(fetchMock).url).pathname).toBe("/social/inbox/conversations");
    expect(params.get("platform")).toBe("instagram");
    expect(params.get("before")).toBe("t|c1");
  });

  it("leaves out the platform for all and the cursor when there is none", async () => {
    const fetchMock = answer({ conversations: [], more: false, next: null });
    await inboxConversations(CONFIG, { platform: "all" });
    expect(calledWith(fetchMock).url).toBe("https://scout.test/social/inbox/conversations");
  });

  it("inboxThread reads a conversation with its window", async () => {
    const fetchMock = answer({
      conversation,
      messages: [message],
      more: false,
      next: null,
      window: { open: true, closesAt: conversation.windowClosesAt },
    });
    const res = await inboxThread(CONFIG, "c 1", { before: "x|y" });
    expect(res).toEqual({
      ok: true,
      conversation,
      messages: [message],
      more: false,
      next: null,
      window: { open: true, closesAt: conversation.windowClosesAt },
    });
    const { url } = calledWith(fetchMock);
    expect(new URL(url).pathname).toBe("/social/inbox/conversations/c%201");
    expect(new URL(url).searchParams.get("before")).toBe("x|y");
  });

  it("inboxPosts lists posts", async () => {
    const fetchMock = answer({ posts: [post], more: false, next: null });
    const res = await inboxPosts(CONFIG, { platform: "tiktok" });
    expect(res).toEqual({ ok: true, posts: [post], more: false, next: null });
    expect(calledWith(fetchMock).url).toBe("https://scout.test/social/inbox/posts?platform=tiktok");
  });

  it("inboxComments reads one post's comments", async () => {
    const fetchMock = answer({ post, comments: [comment], more: true, next: "c|k1" });
    const res = await inboxComments(CONFIG, "instagram", "m9", {});
    expect(res).toEqual({ ok: true, post, comments: [comment], more: true, next: "c|k1" });
    expect(calledWith(fetchMock).url).toBe(
      "https://scout.test/social/inbox/posts/instagram/m9/comments",
    );
  });

  it("drops fields the Worker adds later", async () => {
    answer({ posts: [{ ...post, extra: 1 }], more: false, next: null, later: true });
    expect(await inboxPosts(CONFIG, {})).toEqual({
      ok: true,
      posts: [post],
      more: false,
      next: null,
    });
  });

  it("reads a message kind a newer Worker adds as unsupported", async () => {
    answer({
      conversation,
      messages: [{ ...message, kind: "sticker" }, message],
      more: false,
      next: null,
      window: { open: false, closesAt: null },
    });
    const res = await inboxThread(CONFIG, "c1", {});
    expect(res.ok && res.messages.map((m) => m.kind)).toEqual(["unsupported", "text"]);
  });

  it("refuses a conversation whose lastFrom is unknown", async () => {
    answer({ conversations: [{ ...conversation, lastFrom: "bot" }], more: false, next: null });
    expect(await inboxConversations(CONFIG, {})).toEqual({
      ok: false,
      error: { type: "upstream" },
    });
  });
});

describe("inboxCall", () => {
  it("keeps the caller's headers beside the bearer token", async () => {
    const fetchMock = answer({ ok: true });
    const schema = z.object({ ok: z.literal(true) });
    await inboxCall(CONFIG, "/send", schema, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer other" },
      body: "{}",
    });
    const { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox/send");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });
});

describe("refresh and wipe", () => {
  it("inboxRefresh posts and returns when the scan was asked for", async () => {
    const fetchMock = answer({ scanRequestedAt: "2026-10-22T10:00:00.000Z" });
    expect(await inboxRefresh(CONFIG)).toEqual({
      ok: true,
      scanRequestedAt: "2026-10-22T10:00:00.000Z",
    });
    const { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox/refresh");
    expect(init.method).toBe("POST");
  });

  it("inboxWipe deletes the store", async () => {
    const fetchMock = answer({ ok: true });
    expect(await inboxWipe(CONFIG)).toEqual({ ok: true });
    const { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox");
    expect(init.method).toBe("DELETE");
  });
});

describe("errors", () => {
  it("keeps the code and detail of a refused answer", async () => {
    answer({ error: "rejected", detail: "x" }, 502);
    expect(await inboxOverview(CONFIG)).toEqual({
      ok: false,
      error: { type: "rejected", detail: "x" },
    });
  });

  it("keeps window_closed, not_found and not_available", async () => {
    for (const code of ["window_closed", "not_found", "not_available"]) {
      answer({ error: code }, 409);
      expect(await inboxOverview(CONFIG)).toEqual({
        ok: false,
        error: { type: code, detail: undefined },
      });
    }
  });

  it("maps the Worker codes origin and unauthorized to auth, as socialSync does", async () => {
    for (const code of ["origin", "unauthorized"]) {
      answer({ error: code, detail: "ignored" }, 403);
      expect(await inboxOverview(CONFIG)).toEqual({ ok: false, error: { type: "auth" } });
    }
  });

  it("maps 401 to auth and 429 to rate_limited", async () => {
    answer({ error: "rejected", detail: "ignored" }, 401);
    expect(await inboxOverview(CONFIG)).toEqual({ ok: false, error: { type: "auth" } });
    answer({}, 429);
    expect(await inboxOverview(CONFIG)).toEqual({ ok: false, error: { type: "rate_limited" } });
  });

  it("answers upstream for a non-JSON failure (a Cloudflare error page)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<html>bad gateway</html>", { status: 502 })),
    );
    expect(await inboxOverview(CONFIG)).toEqual({ ok: false, error: { type: "upstream" } });
  });

  it("answers network when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await inboxWipe(CONFIG)).toEqual({ ok: false, error: { type: "network" } });
  });
});

describe("helpers", () => {
  it("utf8Bytes counts bytes, not letters", () => {
    expect(utf8Bytes("لت")).toBe(4);
    expect(utf8Bytes("lut")).toBe(3);
    expect(utf8Bytes("")).toBe(0);
    expect(utf8Bytes("🎬")).toBe(4);
  });

  it("seenKey joins platform, kind and id", () => {
    expect(seenKey("instagram", "conversation", "c1")).toBe("instagram:conversation:c1");
    expect(seenKey("tiktok", "post", "7")).toBe("tiktok:post:7");
  });

  it("unreadCount counts unseen and newer items only", () => {
    const items = [
      { key: "a", at: "2026-10-22T10:00:00.000Z" },
      { key: "b", at: "2026-10-22T10:00:00.000Z" },
      { key: "c", at: "2026-10-22T10:00:00.000Z" },
      { key: "d", at: "2026-10-22T10:00:00.000Z" },
    ];
    const seen = {
      a: "2026-10-22T09:00:00.000Z", // older than the item: unread
      b: "2026-10-22T10:00:00.000Z", // same moment: read
      c: "2026-10-22T11:00:00.000Z", // opened after: read
      // d never opened: unread
    };
    expect(unreadCount(items, seen)).toBe(2);
    expect(unreadCount([], seen)).toBe(0);
    expect(unreadCount(items, {})).toBe(4);
  });
});
