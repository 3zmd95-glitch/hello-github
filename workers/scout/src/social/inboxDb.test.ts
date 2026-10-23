import { describe, expect, it } from "vitest";
import {
  InboxDb,
  PAGE,
  RETAIN_CONVERSATIONS,
  RETAIN_POSTS,
  type CommentRow,
  type MessageRow,
  type PostRow,
  type Sql,
} from "./inboxDb";

function nodeSql(): Sql | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    return { all: (q, ...b) => db.prepare(q).all(...b) as never, run: (ddl) => db.exec(ddl) };
  } catch {
    return null;
  }
}
// Each test gets its own in-memory database; `available` only decides whether node:sqlite loads (Node 22 needs --experimental-sqlite).
const available = nodeSql() !== null;
const conv = (id: string, updatedAt: string) => ({
  platform: "instagram" as const,
  id,
  peerId: `p${id}`,
  peerName: `peer ${id}`,
  updatedAt,
  lastText: "hi",
  lastFrom: "peer" as const,
  windowClosesAt: null,
  answeredBy: null,
});

const msg = (id: string, at: string, over: Partial<MessageRow> = {}): MessageRow => ({
  platform: "instagram",
  convId: "a",
  id,
  at,
  fromPeer: true,
  text: id,
  kind: "text",
  sentBy: "peer",
  ...over,
});
const post = (
  id: string,
  postedAt: string,
  platform: PostRow["platform"] = "instagram",
): PostRow => ({
  platform,
  id,
  permalink: "",
  thumbUrl: null,
  caption: id,
  postedAt,
  commentCount: 0,
});
const comment = (
  postId: string,
  id: string,
  at: string,
  over: Partial<CommentRow> = {},
): CommentRow => ({
  platform: "instagram",
  postId,
  id,
  parentId: null,
  at,
  author: "ali",
  authorId: null,
  text: id,
  hidden: false,
  ours: false,
  sentBy: null,
  ...over,
});

describe.skipIf(!available)("InboxDb", () => {
  it("upserts conversations and pages them newest first", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      conversations: [conv("a", "2026-10-22T10:00:00.000Z"), conv("b", "2026-10-22T11:00:00.000Z")],
    });
    await db.ingest({
      conversations: [{ ...conv("a", "2026-10-22T12:00:00.000Z"), lastText: "again" }],
    });
    const page = await db.conversations({});
    expect(page.items.map((c) => c.id)).toEqual(["a", "b"]);
    expect(page.items[0].lastText).toBe("again");
    expect(page.more).toBe(false);
  });
  it("pages with before and limit", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      conversations: Array.from({ length: PAGE + 1 }, (_, i) =>
        conv(`c${i}`, `2026-10-01T00:${String(i).padStart(2, "0")}:00.000Z`),
      ),
    });
    const first = await db.conversations({});
    expect(first.items).toHaveLength(PAGE);
    expect(first.more).toBe(true);
    const next = await db.conversations({ before: first.items.at(-1)!.updatedAt });
    expect(next.items).toHaveLength(1);
    expect(next.more).toBe(false);
  });
  it("thread returns messages oldest first within the page, comments newest first, nulls for unknown ids", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      conversations: [conv("a", "2026-10-22T10:00:00.000Z")],
      messages: [
        {
          platform: "instagram",
          convId: "a",
          id: "m2",
          at: "2026-10-22T10:00:00.000Z",
          fromPeer: true,
          text: "two",
          kind: "text",
          sentBy: "peer",
        },
        {
          platform: "instagram",
          convId: "a",
          id: "m1",
          at: "2026-10-22T09:00:00.000Z",
          fromPeer: false,
          text: "one",
          kind: "text",
          sentBy: "owner",
        },
      ],
      posts: [
        {
          platform: "instagram",
          id: "p1",
          permalink: "https://www.instagram.com/reel/X/",
          thumbUrl: null,
          caption: "LUT",
          postedAt: "2026-10-20T00:00:00.000Z",
          commentCount: 1,
        },
      ],
      comments: [
        {
          platform: "instagram",
          postId: "p1",
          id: "c1",
          parentId: null,
          at: "2026-10-21T00:00:00.000Z",
          author: "ali",
          authorId: "5",
          text: "لت",
          hidden: false,
          ours: false,
          sentBy: null,
        },
      ],
    });
    const t = await db.thread("instagram", "a", {});
    expect(t?.messages.items.map((m) => m.id)).toEqual(["m1", "m2"]);
    const c = await db.comments("instagram", "p1", {});
    expect(c?.post.caption).toBe("LUT");
    expect(c?.comments.items[0].text).toBe("لت");
    expect(await db.thread("instagram", "nope", {})).toBeNull();
  });
  it("records sends, hides and deletes comments, keeps meta", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      posts: [
        {
          platform: "instagram",
          id: "p1",
          permalink: "",
          thumbUrl: null,
          caption: "",
          postedAt: "2026-10-20T00:00:00.000Z",
          commentCount: 0,
        },
      ],
      comments: [
        {
          platform: "instagram",
          postId: "p1",
          id: "c1",
          parentId: null,
          at: "2026-10-21T00:00:00.000Z",
          author: "ali",
          authorId: null,
          text: "x",
          hidden: false,
          ours: false,
          sentBy: null,
        },
      ],
    });
    await db.setHidden("instagram", "c1", true);
    expect((await db.comments("instagram", "p1", {}))?.comments.items[0].hidden).toBe(true);
    await db.deleteComment("instagram", "c1");
    expect((await db.comments("instagram", "p1", {}))?.comments.items).toHaveLength(0);
    await db.recordSend({
      platform: "instagram",
      kind: "dm",
      targetId: "a",
      text: "hi",
      at: "2026-10-22T00:00:00.000Z",
      state: "sent",
      platformId: "mid",
      detail: null,
    });
    await db.setMeta("lastReadAt:instagram", "2026-10-22T00:00:00.000Z");
    expect(await db.getMeta("lastReadAt:instagram")).toBe("2026-10-22T00:00:00.000Z");
    expect((await db.overview()).platforms.instagram.lastReadAt).toBe("2026-10-22T00:00:00.000Z");
  });
  it("retain drops beyond the caps and older than 30 days, and wipe empties everything", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      conversations: Array.from({ length: RETAIN_CONVERSATIONS + 5 }, (_, i) =>
        conv(`c${i}`, `2026-10-${String(1 + (i % 20)).padStart(2, "0")}T00:00:00.000Z`),
      ),
    });
    await db.ingest({ conversations: [conv("old", "2026-08-01T00:00:00.000Z")] });
    const r = await db.retain("2026-10-22T00:00:00.000Z");
    expect(r.dropped).toBeGreaterThanOrEqual(6);
    expect((await db.overview()).counts.conversations).toBe(RETAIN_CONVERSATIONS);
    await db.wipe();
    expect((await db.overview()).counts).toEqual({ conversations: 0, posts: 0, comments: 0 });
  });
  it("pages conversations that share one timestamp without losing or repeating any", async () => {
    const db = new InboxDb(nodeSql()!);
    const T = "2026-10-22T10:00:00.000Z";
    const ids = Array.from({ length: 25 }, (_, i) => `c${String(i).padStart(2, "0")}`);
    await db.ingest({ conversations: ids.map((id) => conv(id, T)) });
    const first = await db.conversations({});
    expect(first.items).toHaveLength(PAGE);
    expect(first.more).toBe(true);
    expect(first.next).toBe(`${T}|c05`);
    const second = await db.conversations({ before: first.next! });
    expect(second.items).toHaveLength(5);
    expect(second.more).toBe(false);
    expect(second.next).toBeNull();
    expect([...first.items, ...second.items].map((c) => c.id)).toEqual([...ids].reverse());
    // A plain timestamp still works and means strictly older than it.
    expect((await db.conversations({ before: T })).items).toHaveLength(0);
    expect((await db.conversations({ before: "2026-10-22T10:00:01.000Z" })).items).toHaveLength(
      PAGE,
    );
  });
  it("pages a thread through next and keeps each page oldest first, ties included", async () => {
    const db = new InboxDb(nodeSql()!);
    // Pairs share a timestamp, and the page boundary falls inside the pair m00/m01.
    const ms = Array.from({ length: 21 }, (_, i) =>
      msg(
        `m${String(i).padStart(2, "0")}`,
        `2026-10-22T10:${String(Math.floor(i / 2)).padStart(2, "0")}:00.000Z`,
      ),
    );
    await db.ingest({ conversations: [conv("a", "2026-10-22T11:00:00.000Z")], messages: ms });
    const first = (await db.thread("instagram", "a", {}))!.messages;
    expect(first.items.map((m) => m.id)).toEqual(ms.slice(1).map((m) => m.id));
    expect(first.more).toBe(true);
    expect(first.next).toBe("2026-10-22T10:00:00.000Z|m01");
    const second = (await db.thread("instagram", "a", { before: first.next! }))!.messages;
    expect(second.items.map((m) => m.id)).toEqual(["m00"]);
    expect(second.more).toBe(false);
    expect(second.next).toBeNull();
  });
  it("keeps auto marks when a later read says otherwise", async () => {
    const db = new InboxDb(nodeSql()!);
    const T = "2026-10-22T10:00:00.000Z";
    await db.ingest({
      conversations: [{ ...conv("a", T), answeredBy: "auto" }],
      messages: [msg("m1", T, { fromPeer: false, sentBy: "auto" })],
      posts: [post("p1", T)],
      comments: [comment("p1", "c1", T, { sentBy: "auto" })],
    });
    await db.ingest({
      conversations: [conv("a", T)],
      messages: [msg("m1", T, { fromPeer: false, sentBy: "owner", text: "edited" })],
      comments: [comment("p1", "c1", T, { sentBy: null, text: "edited" })],
    });
    const t = await db.thread("instagram", "a", {});
    expect(t?.conversation.answeredBy).toBe("auto");
    expect(t?.messages.items.map((m) => [m.id, m.sentBy, m.text])).toEqual([
      ["m1", "auto", "edited"],
    ]);
    const c = await db.comments("instagram", "p1", {});
    expect(c?.comments.items[0]).toMatchObject({ sentBy: "auto", text: "edited" });
  });
  it("keeps the owner's mark on a message the dashboard sent, whatever a later read says", async () => {
    const db = new InboxDb(nodeSql()!);
    const T = "2026-10-22T10:00:00.000Z";
    // The dashboard's send is stored first; the reader then reads the same message id back.
    await db.ingest({
      conversations: [conv("a", T)],
      messages: [
        msg("m1", T, { fromPeer: false, sentBy: "owner", text: "hi" }),
        msg("m2", T, { fromPeer: false, sentBy: "owner" }),
      ],
    });
    await db.ingest({
      conversations: [conv("a", T)],
      messages: [
        msg("m1", T, { fromPeer: false, sentBy: "auto", text: "hi there" }),
        msg("m2", T, { fromPeer: false, sentBy: "owner" }),
      ],
    });
    const t = await db.thread("instagram", "a", {});
    // One row each, still the owner's; the reader only refreshes what Instagram can correct.
    expect(t?.messages.items.map((m) => [m.id, m.sentBy, m.text])).toEqual([
      ["m1", "owner", "hi there"],
      ["m2", "owner", "m2"],
    ]);
  });
  it("folds a webhook's provisional peer: thread into the real one when the reader stores it", async () => {
    const db = new InboxDb(nodeSql()!);
    const T1 = "2026-10-22T10:00:00.000Z";
    const T2 = "2026-10-22T10:01:00.000Z";
    // The webhook: the person's message under the provisional thread.
    await db.ingest({
      conversations: [{ ...conv("x", T1), id: "peer:p1", peerId: "p1" }],
      messages: [msg("mid.1", T1, { convId: "peer:p1" })],
    });
    // The reader: the real thread, with the same message and an older one.
    await db.ingest({
      conversations: [{ ...conv("t1", T2), peerId: "p1" }],
      messages: [msg("mid.0", T1, { convId: "t1" }), msg("mid.1", T1, { convId: "t1" })],
    });
    expect((await db.thread("instagram", "t1", {}))!.messages.items.map((m) => m.id)).toEqual([
      "mid.0",
      "mid.1",
    ]);
    expect(await db.thread("instagram", "peer:p1", {})).toBeNull();
    expect((await db.conversations({})).items.map((c) => c.id)).toEqual(["t1"]);
  });
  it("moves a DM the owner sent into the peer: thread too, keeping its sentBy", async () => {
    const db = new InboxDb(nodeSql()!);
    const T1 = "2026-10-22T10:00:00.000Z";
    const T2 = "2026-10-22T10:02:00.000Z";
    await db.ingest({
      conversations: [{ ...conv("x", T1), id: "peer:p1", peerId: "p1" }],
      messages: [
        msg("mid.1", T1, { convId: "peer:p1" }),
        msg("mid.2", T2, { convId: "peer:p1", fromPeer: false, sentBy: "owner" }),
      ],
    });
    // The reader's page does not reach the owner's DM yet; it still moves with the thread.
    await db.ingest({ conversations: [{ ...conv("t1", T2), peerId: "p1" }] });
    const t = (await db.thread("instagram", "t1", {}))!;
    expect(t.messages.items.map((m) => [m.id, m.convId, m.sentBy])).toEqual([
      ["mid.1", "t1", "peer"],
      ["mid.2", "t1", "owner"],
    ]);
    expect((await db.overview()).counts.conversations).toBe(1);
  });
  it("deletes a comment together with its replies, and nothing else", async () => {
    const db = new InboxDb(nodeSql()!);
    const T = "2026-10-22T10:00:00.000Z";
    await db.ingest({
      posts: [post("p1", T), post("p2", T), { ...post("p1", T), platform: "tiktok" }],
      comments: [
        comment("p1", "c1", T),
        comment("p1", "r1", T, { parentId: "c1" }),
        comment("p1", "r2", T, { parentId: "c1" }),
        comment("p1", "c2", T),
        comment("p1", "r3", T, { parentId: "c2" }),
        comment("p2", "c3", T),
        { ...comment("p1", "t1", T, { parentId: "c1" }), platform: "tiktok" },
      ],
    });
    await db.deleteComment("instagram", "c1");
    const left = await db.comments("instagram", "p1", {});
    expect(left?.comments.items.map((c) => c.id).sort()).toEqual(["c2", "r3"]);
    expect((await db.comments("instagram", "p2", {}))?.comments.items.map((c) => c.id)).toEqual([
      "c3",
    ]);
    // The other platform's rows with the same ids are not ours to remove.
    expect((await db.comments("tiktok", "p1", {}))?.comments.items.map((c) => c.id)).toEqual([
      "t1",
    ]);
    // A reply goes alone.
    await db.deleteComment("instagram", "r3");
    expect((await db.comments("instagram", "p1", {}))?.comments.items.map((c) => c.id)).toEqual([
      "c2",
    ]);
  });
  it("lists comments newest first and posts per platform, both through next", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      posts: [
        post("p1", "2026-10-01T00:00:00.000Z"),
        post("p2", "2026-10-02T00:00:00.000Z"),
        post("p3", "2026-10-03T00:00:00.000Z"),
        post("t1", "2026-10-04T00:00:00.000Z", "tiktok"),
      ],
      comments: [
        comment("p1", "c1", "2026-10-05T00:00:00.000Z"),
        comment("p1", "c2", "2026-10-07T00:00:00.000Z"),
        comment("p1", "c3", "2026-10-06T00:00:00.000Z"),
      ],
    });
    const cs = await db.comments("instagram", "p1", {});
    expect(cs?.comments.items.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
    const cFirst = await db.comments("instagram", "p1", { limit: 2 });
    expect(cFirst?.comments.items.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(cFirst?.comments.next).toBe("2026-10-06T00:00:00.000Z|c3");
    const cSecond = await db.comments("instagram", "p1", { before: cFirst!.comments.next! });
    expect(cSecond?.comments.items.map((c) => c.id)).toEqual(["c1"]);
    expect(cSecond?.comments.more).toBe(false);

    const first = await db.posts({ platform: "instagram", limit: 2 });
    expect(first.items.map((p) => p.id)).toEqual(["p3", "p2"]);
    expect(first.more).toBe(true);
    expect(first.next).toBe("2026-10-02T00:00:00.000Z|p2");
    const second = await db.posts({ platform: "instagram", before: first.next!, limit: 2 });
    expect(second.items.map((p) => p.id)).toEqual(["p1"]);
    expect(second.more).toBe(false);
    expect((await db.posts({ platform: "tiktok" })).items.map((p) => p.id)).toEqual(["t1"]);
    expect((await db.posts({})).items.map((p) => p.id)).toEqual(["t1", "p3", "p2", "p1"]);
  });
  it("retain applies the 30-day cutoff to messages, comments, posts and sends", async () => {
    const sql = nodeSql()!;
    const db = new InboxDb(sql);
    const old = "2026-08-01T00:00:00.000Z";
    await db.ingest({
      conversations: [conv("a", "2026-10-21T00:00:00.000Z")],
      messages: [msg("old", old), msg("fresh", "2026-10-20T00:00:00.000Z")],
      posts: [
        post("kept", old), // old, but one comment of it is fresh
        post("gone", old), // old, only old comments
        post("new", "2026-10-10T00:00:00.000Z"),
      ],
      comments: [
        comment("kept", "fresh", "2026-10-15T00:00:00.000Z"),
        comment("kept", "stale", "2026-08-02T00:00:00.000Z"),
        comment("gone", "stale2", "2026-08-03T00:00:00.000Z"),
        comment("new", "c", "2026-10-11T00:00:00.000Z"),
      ],
    });
    const send = (at: string) =>
      db.recordSend({
        platform: "instagram",
        kind: "dm",
        targetId: "a",
        text: "hi",
        at,
        state: "sent",
        platformId: null,
        detail: null,
      });
    await send(old);
    await send("2026-10-21T00:00:00.000Z");
    const r = await db.retain("2026-10-22T00:00:00.000Z");
    expect(r.dropped).toBe(3); // the post "gone" and the comments "stale" and "stale2"
    expect((await db.thread("instagram", "a", {}))?.messages.items.map((m) => m.id)).toEqual([
      "fresh",
    ]);
    expect((await db.posts({})).items.map((p) => p.id)).toEqual(["new", "kept"]);
    expect((await db.comments("instagram", "kept", {}))?.comments.items.map((c) => c.id)).toEqual([
      "fresh",
    ]);
    expect(await db.comments("instagram", "gone", {})).toBeNull();
    expect((await db.overview()).counts.comments).toBe(2);
    expect(sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM sends")[0].n).toBe(1);
  });
  it("retain keeps the newest 50 posts", async () => {
    const db = new InboxDb(nodeSql()!);
    const ids = Array.from({ length: 55 }, (_, i) => String(i).padStart(2, "0"));
    await db.ingest({ posts: ids.map((i) => post(`p${i}`, `2026-10-20T00:${i}:00.000Z`)) });
    await db.retain("2026-10-22T00:00:00.000Z");
    const kept = (await db.posts({ limit: 100 })).items;
    expect(kept).toHaveLength(RETAIN_POSTS);
    expect(kept[0].id).toBe("p54");
    expect(kept.at(-1)!.id).toBe("p05");
  });
  it("clamps limit to 1..100", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      conversations: Array.from({ length: 105 }, (_, i) =>
        conv(`c${String(i).padStart(3, "0")}`, "2026-10-22T10:00:00.000Z"),
      ),
    });
    const one = await db.conversations({ limit: -5 });
    expect(one.items).toHaveLength(1);
    expect(one.more).toBe(true);
    const most = await db.conversations({ limit: 500 });
    expect(most.items).toHaveLength(100);
    expect(most.more).toBe(true);
    expect((await db.conversations({ limit: Number.NaN })).items).toHaveLength(PAGE);
  });
  it("reads one stored comment by its own id, null for an unknown one", async () => {
    const db = new InboxDb(nodeSql()!);
    await db.ingest({
      posts: [post("p1", "2026-10-20T00:00:00.000Z")],
      comments: [
        comment("p1", "c1", "2026-10-21T00:00:00.000Z", { hidden: true, ours: true }),
        comment("p1", "c2", "2026-10-21T00:01:00.000Z"),
      ],
    });
    expect(await db.comment("instagram", "c1")).toMatchObject({
      id: "c1",
      postId: "p1",
      hidden: true,
      ours: true,
    });
    expect(await db.comment("instagram", "c2")).toMatchObject({ hidden: false, ours: false });
    expect(await db.comment("instagram", "nope")).toBeNull();
    expect(await db.comment("tiktok", "c1")).toBeNull();
  });
  it("unhides a comment and reports each platform's newest conversation", async () => {
    const db = new InboxDb(nodeSql()!);
    expect((await db.overview()).platforms).toEqual({
      instagram: { lastReadAt: null, newestAt: null },
      tiktok: { lastReadAt: null, newestAt: null },
    });
    await db.ingest({
      conversations: [
        conv("a", "2026-10-22T10:00:00.000Z"),
        conv("b", "2026-10-22T12:00:00.000Z"),
        { ...conv("t", "2026-10-22T09:00:00.000Z"), platform: "tiktok" },
      ],
      posts: [post("p1", "2026-10-20T00:00:00.000Z")],
      comments: [comment("p1", "c1", "2026-10-21T00:00:00.000Z", { hidden: true })],
    });
    const p = (await db.overview()).platforms;
    expect(p.instagram.newestAt).toBe("2026-10-22T12:00:00.000Z");
    expect(p.tiktok.newestAt).toBe("2026-10-22T09:00:00.000Z");
    expect((await db.comments("instagram", "p1", {}))?.comments.items[0].hidden).toBe(true);
    await db.setHidden("instagram", "c1", false);
    expect((await db.comments("instagram", "p1", {}))?.comments.items[0].hidden).toBe(false);
  });
});
