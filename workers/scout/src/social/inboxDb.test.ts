import { describe, expect, it } from "vitest";
import { InboxDb, PAGE, RETAIN_CONVERSATIONS, type Sql } from "./inboxDb";

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
});
