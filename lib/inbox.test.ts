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
  inboxDelete,
  inboxErrorKey,
  inboxHide,
  inboxOverview,
  inboxPosts,
  inboxPrivate,
  inboxRefresh,
  inboxReply,
  inboxSend,
  inboxThread,
  inboxWipe,
  isUnconfirmed,
  searchFold,
  seenKey,
  unreadCount,
  utf8Bytes,
  type InboxError,
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

describe("sends", () => {
  const sent = { ...message, id: "mid.1", fromPeer: false, sentBy: "owner" };
  const reply = {
    ...comment,
    id: "r1",
    parentId: "k1",
    author: "3z.prod",
    ours: true,
    sentBy: "owner",
  };

  it("inboxSend posts the text as JSON to the conversation and reads the stored message", async () => {
    const fetchMock = answer({ message: sent });
    const r = await inboxSend(CONFIG, "peer:9", "هلا");
    expect(r).toEqual({ ok: true, message: sent });
    const { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox/conversations/peer%3A9/send");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ text: "هلا" }));
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("inboxReply posts under the comment and reads the reply row", async () => {
    const fetchMock = answer({ reply });
    expect(await inboxReply(CONFIG, "instagram", "k1", "حياك")).toEqual({ ok: true, reply });
    const { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox/comments/instagram/k1/reply");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ text: "حياك" }));
  });

  it("inboxPrivate answers the comment by DM and reads the message id", async () => {
    const fetchMock = answer({ message: { id: "mid.2" } });
    expect(await inboxPrivate(CONFIG, "k1", "الرابط عالخاص")).toEqual({
      ok: true,
      message: { id: "mid.2" },
    });
    const { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox/comments/instagram/k1/private");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ text: "الرابط عالخاص" }));
  });

  it("inboxHide sends the wanted state, inboxDelete sends no body", async () => {
    let fetchMock = answer({ ok: true });
    expect(await inboxHide(CONFIG, "instagram", "k1", true)).toEqual({ ok: true });
    let { url, init } = calledWith(fetchMock);
    expect(url).toBe("https://scout.test/social/inbox/comments/instagram/k1/hide");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ hidden: true }));

    fetchMock = answer({ ok: true });
    expect(await inboxDelete(CONFIG, "instagram", "k1")).toEqual({ ok: true });
    ({ url, init } = calledWith(fetchMock));
    expect(url).toBe("https://scout.test/social/inbox/comments/instagram/k1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("sends nothing without a Worker", async () => {
    const fetchMock = answer({});
    const none = { ok: false, error: { type: "unconfigured" } };
    expect(await inboxSend(null, "c1", "x")).toEqual(none);
    expect(await inboxReply(null, "instagram", "k1", "x")).toEqual(none);
    expect(await inboxPrivate(null, "k1", "x")).toEqual(none);
    expect(await inboxHide(null, "instagram", "k1", true)).toEqual(none);
    expect(await inboxDelete(null, "instagram", "k1")).toEqual(none);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a closed window (409) to window_closed", async () => {
    answer({ error: "window_closed" }, 409);
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual({
      ok: false,
      error: { type: "window_closed", detail: undefined },
    });
  });

  it("keeps too_long, no_permission and the platform's own words", async () => {
    answer({ error: "too_long" }, 400);
    expect(await inboxReply(CONFIG, "instagram", "k1", "x")).toEqual({
      ok: false,
      error: { type: "too_long", detail: undefined },
    });
    answer({ error: "no_permission" }, 403);
    expect(await inboxDelete(CONFIG, "instagram", "k1")).toEqual({
      ok: false,
      error: { type: "no_permission", detail: undefined },
    });
    answer({ error: "rejected", detail: "Cannot reply" }, 502);
    expect(await inboxPrivate(CONFIG, "k1", "x")).toEqual({
      ok: false,
      error: { type: "rejected", detail: "Cannot reply" },
    });
  });

  it("tells an unconfirmed send (it may have gone out) from a failed one", async () => {
    answer({ error: "upstream", detail: "unconfirmed" }, 502);
    const r = await inboxSend(CONFIG, "c1", "x");
    expect(r).toEqual({ ok: false, error: { type: "upstream", detail: "unconfirmed" } });
    expect(!r.ok && isUnconfirmed(r.error)).toBe(true);
    expect(isUnconfirmed({ type: "upstream" })).toBe(false);
    expect(isUnconfirmed({ type: "rejected", detail: "unconfirmed" })).toBe(false);
  });

  const unconfirmed = { ok: false, error: { type: "upstream", detail: "unconfirmed" } };

  it("reads a send whose request may have left but got no answer as unconfirmed", async () => {
    // fetch threw: the request may have reached the Worker.
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual(unconfirmed);
    expect(await inboxReply(CONFIG, "instagram", "k1", "x")).toEqual(unconfirmed);
    expect(await inboxPrivate(CONFIG, "k1", "x")).toEqual(unconfirmed);
  });

  it("reads a send answered 2xx with a body that is not the expected one as unconfirmed", async () => {
    answer({ message: { id: 7 } }); // wrong shape
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual(unconfirmed);
    answer({ ok: true }); // the wrong route's answer
    expect(await inboxReply(CONFIG, "instagram", "k1", "x")).toEqual(unconfirmed);
    answer({});
    expect(await inboxPrivate(CONFIG, "k1", "x")).toEqual(unconfirmed);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<html>ok</html>", { status: 200 })),
    );
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual(unconfirmed); // 2xx, not JSON
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("<html>502</html>", { status: 502 })),
    );
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual(unconfirmed); // an edge page, not the Worker
    expect(await inboxOverview(CONFIG)).toEqual({ ok: false, error: { type: "upstream" } }); // a read: plain
  });

  it("keeps a plain refusal of a send as the Worker said it (nothing was sent)", async () => {
    answer({ error: "upstream" }, 502); // a store fault before any Instagram call: no detail
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual({
      ok: false,
      error: { type: "upstream", detail: undefined },
    });
  });

  /** A fake Worker that holds every answer until `open()`, counting what it was asked. */
  function held() {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const fetchMock = vi.fn<typeof fetch>(async () => {
      await gate;
      return new Response(JSON.stringify({ message: sent }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const bodies = () => fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body);
    return { fetchMock, open, bodies };
  }

  it("joins an identical send that is still in flight instead of repeating it", async () => {
    const { fetchMock, open } = held();
    const first = inboxSend(CONFIG, "c1", "هلا");
    const second = inboxSend(CONFIG, "c1", "هلا"); // a double tap, a remount: the same promise
    expect(second).toBe(first);
    open();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ ok: true, message: sent });
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not join a send of other text, to another target, or of another kind", async () => {
    const { fetchMock, open, bodies } = held();
    const calls = [
      inboxSend(CONFIG, "c1", "a"),
      inboxSend(CONFIG, "c1", "b"), // other text
      inboxSend(CONFIG, "c2", "a"), // other conversation
      inboxReply(CONFIG, "instagram", "k1", "a"),
      inboxPrivate(CONFIG, "k1", "a"), // same comment and text as the reply, another kind
      inboxReply(CONFIG, "instagram", "k2", "a"),
    ];
    open();
    await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(bodies().slice(0, 2)).toEqual([
      JSON.stringify({ text: "a" }),
      JSON.stringify({ text: "b" }),
    ]);
  });

  it("sends the same text again once the first has settled, whether it went through or not", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (fetchMock.mock.calls.length === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ message: sent }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual(unconfirmed);
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual({ ok: true, message: sent });
    expect(await inboxSend(CONFIG, "c1", "x")).toEqual({ ok: true, message: sent });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("leaves hide, delete and the reads on their usual mapping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const network = { ok: false, error: { type: "network" } };
    expect(await inboxHide(CONFIG, "instagram", "k1", true)).toEqual(network);
    expect(await inboxDelete(CONFIG, "instagram", "k1")).toEqual(network);
    expect(await inboxOverview(CONFIG)).toEqual(network);
    answer({ nope: true });
    const upstream = { ok: false, error: { type: "upstream" } };
    expect(await inboxHide(CONFIG, "instagram", "k1", true)).toEqual(upstream);
    expect(await inboxDelete(CONFIG, "instagram", "k1")).toEqual(upstream);
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

  // The page's search compares folded texts: both the needle and what it looks through.
  describe("searchFold", () => {
    const found = (needle: string, text: string) => searchFold(text).includes(searchFold(needle));

    it("finds an alef with hamza by the plain alef, and a final yeh by the alef maqsura", () => {
      expect(found("احمد", "أحمد")).toBe(true);
      expect(found("أحمد", "احمد")).toBe(true);
      expect(found("إيمان", "ايمان")).toBe(true);
      expect(found("آية", "اية")).toBe(true);
      expect(found("مصطفي", "مصطفى")).toBe(true);
      expect(found("خالد", "أحمد")).toBe(false);
    });

    it("drops the vowel marks and the tatweel", () => {
      expect(found("محمد", "مُحمّد")).toBe(true);
      expect(found("مُحمّد", "محمد")).toBe(true);
      expect(found("سارة", "ســـارة")).toBe(true);
      expect(searchFold("مُحَمَّد")).toBe("محمد");
    });

    it("ignores the case of Latin letters and leaves other letters as they are", () => {
      expect(searchFold("Noura AL-Harbi")).toBe("noura al-harbi");
      expect(found("NOURA", "noura")).toBe(true);
      expect(searchFold("ة ه")).toBe("ة ه");
      expect(searchFold("")).toBe("");
    });
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

  it("inboxErrorKey names every error, and anything else as the platform's problem", () => {
    const cases: [InboxError["type"], string][] = [
      ["auth", "inbox.err.auth"],
      ["not_found", "inbox.err.notFound"],
      ["rejected", "inbox.err.rejected"],
      ["no_permission", "inbox.err.noPermission"],
      ["not_eligible", "inbox.err.notEligible"],
      ["rate_limited", "inbox.err.rateLimited"],
      ["network", "inbox.err.network"],
      ["not_available", "inbox.notAvailable"],
      ["unconfigured", "inbox.needWorker"],
      ["token_expired", "inbox.tokenExpired"],
      ["window_closed", "inbox.window.closed"],
      ["upstream", "inbox.err.upstream"],
      ["too_long", "inbox.tooLong"],
      ["bad_request", "inbox.err.upstream"],
    ];
    for (const [type, key] of cases) expect(inboxErrorKey({ type }), type).toBe(key);
    // The Worker's body names the code: an unknown one (or one that is an Object method) is still upstream.
    expect(inboxErrorKey({ type: "brand_new" as InboxError["type"] })).toBe("inbox.err.upstream");
    expect(inboxErrorKey({ type: "toString" as InboxError["type"] })).toBe("inbox.err.upstream");
  });
});
