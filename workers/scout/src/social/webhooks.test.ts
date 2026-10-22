import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { handle, type Env } from "../scout";
import { InboxDb, type InboxApi, type PostRow, type Sql } from "./inboxDb";
import { clipLog } from "./replyCore";
import { MAX_BODY, WEBHOOK_MAX_EVENTS, webhookToBatch } from "./webhooks";

const SECRET = "app-secret";
const VERIFY = "verify-me";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-22T12:00:00Z");
/** Instagram's webhook timestamps are epoch milliseconds. */
const T0 = Date.parse("2026-10-22T10:00:00Z");
const IG = "17841400000000000";

type FakeKV = KVNamespace & { writes: number };
function fakeKV(): FakeKV {
  const kv = {
    writes: 0,
    async get() {
      return null;
    },
    async put() {
      kv.writes += 1;
    },
    async delete() {
      kv.writes += 1;
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  };
  return kv as unknown as FakeKV;
}

/** A Worker env with the bearer set (the webhook routes must not ask for it) and, optionally, the two Meta secrets. */
function makeEnv(over: Partial<Env> = {}): Env & { SOCIAL_KV: FakeKV } {
  return {
    SCOUT_TOKEN: "s3cret-token",
    SOCIAL_KV: fakeKV(),
    META_APP_SECRET: SECRET,
    META_VERIFY_TOKEN: VERIFY,
    ...over,
  } as Env & { SOCIAL_KV: FakeKV };
}

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
const freshDb = () => new InboxDb(nodeSql()!);

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/** A POST as Meta sends it: no Authorization header, no Origin, the signature of the raw body. */
function signed(payload: unknown, header?: string | null): Request {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (header !== null) headers.set("X-Hub-Signature-256", header ?? sign(body));
  return new Request(`${BASE}/webhooks/instagram`, { method: "POST", body, headers });
}

const send = (req: Request, env: Env, api?: InboxApi) =>
  handle(req, env, undefined, { now: () => NOW, inboxApi: api });

/* ---------- payload builders ---------- */

const dm = (sender: string, mid: string, message: Record<string, unknown>, ts = T0) => ({
  sender: { id: sender },
  recipient: { id: IG },
  timestamp: ts,
  message: { mid, ...message },
});
const commentChange = (value: Record<string, unknown>, field = "comments") => ({ field, value });
const comment = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  text: "لت؟",
  from: { id: "u1", username: "sara" },
  media: { id: "p1", media_product_type: "REELS" },
  ...over,
});
const hook = (...entry: Record<string, unknown>[]) => ({
  object: "instagram",
  entry: entry.map((e) => ({ id: IG, time: Math.floor(T0 / 1000), ...e })),
});

const post = (id: string, caption = "LUT"): PostRow => ({
  platform: "instagram",
  id,
  permalink: "https://www.instagram.com/reel/x/",
  thumbUrl: null,
  caption,
  postedAt: "2026-10-20T00:00:00.000Z",
  commentCount: 1,
});

describe.skipIf(!available)("Instagram webhooks", () => {
  // The handler logs counts; the tests read them here instead of printing them.
  let log: MockInstance<typeof console.log>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe("GET /webhooks/instagram (the verify handshake)", () => {
    const get = (query: string, env: Env = makeEnv()) =>
      send(new Request(`${BASE}/webhooks/instagram?${query}`), env);

    it("answers the challenge as plain text when the verify token matches, with no bearer", async () => {
      const res = await get(
        `hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("1158201444");
      expect(res.headers.get("Content-Type")).toContain("text/plain");
    });

    it("refuses a wrong token, a wrong mode and a missing challenge", async () => {
      expect((await get("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")).status).toBe(
        403,
      );
      expect(
        (await get(`hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`)).status,
      ).toBe(403);
      expect((await get(`hub.mode=subscribe&hub.verify_token=${VERIFY}`)).status).toBe(403);
    });

    it("refuses everything while META_VERIFY_TOKEN is not set (an absent token never equals an absent one)", async () => {
      const env = makeEnv({ META_VERIFY_TOKEN: undefined });
      expect((await get("hub.mode=subscribe&hub.challenge=1", env)).status).toBe(403);
      expect((await get("hub.mode=subscribe&hub.verify_token=&hub.challenge=1", env)).status).toBe(
        403,
      );
    });
  });

  describe("POST /webhooks/instagram: a signed message", () => {
    it("stores the message and a provisional conversation whose window closes 24 h after it", async () => {
      const env = makeEnv();
      const api = freshDb();
      const body = hook({ messaging: [dm("p1", "mid.1", { text: "مرحبا" })] });

      const res = await send(signed(body), env, api);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 1 });
      const at = "2026-10-22T10:00:00.000Z";
      expect(await api.conversations({})).toMatchObject({
        items: [
          {
            platform: "instagram",
            id: "peer:p1",
            peerId: "p1",
            peerName: "?",
            updatedAt: at,
            lastText: "مرحبا",
            lastFrom: "peer",
            windowClosesAt: "2026-10-23T10:00:00.000Z",
            answeredBy: null,
          },
        ],
      });
      expect((await api.thread("instagram", "peer:p1", {}))?.messages.items).toEqual([
        {
          platform: "instagram",
          convId: "peer:p1",
          id: "mid.1",
          at,
          fromPeer: true,
          text: "مرحبا",
          kind: "text",
          sentBy: "peer",
        },
      ]);
      // The routes are open to Meta only through the signature: nothing in this file sends a bearer.
      expect(env.SOCIAL_KV.writes).toBe(0);
      // Only the reader's reads move lastReadAt.
      expect((await api.overview()).platforms.instagram.lastReadAt).toBeNull();
    });

    it("clips the text like the reader does and keeps the newest message of a person in the conversation", async () => {
      const api = freshDb();
      const long = "ب".repeat(300);
      const body = hook({
        messaging: [
          dm("p1", "mid.2", { text: "later" }, T0 + 60_000),
          dm("p1", "mid.1", { text: long }, T0),
        ],
      });

      expect((await send(signed(body), makeEnv(), api)).status).toBe(200);

      const thread = await api.thread("instagram", "peer:p1", {});
      expect(thread?.messages.items.map((m) => [m.id, m.text])).toEqual([
        ["mid.1", clipLog(long)],
        ["mid.2", "later"],
      ]);
      expect(thread?.conversation).toMatchObject({
        lastText: "later",
        updatedAt: "2026-10-22T10:01:00.000Z",
        windowClosesAt: "2026-10-23T10:01:00.000Z",
      });
    });

    it("maps unsupported messages and attachment-only messages to their kinds", async () => {
      const api = freshDb();
      const body = hook({
        messaging: [
          dm("p1", "mid.u", { is_unsupported: true }),
          dm("p1", "mid.s", { attachments: [{ type: "ig_reel", payload: { url: "https://x" } }] }),
        ],
      });

      await send(signed(body), makeEnv(), api);

      const kinds = (await api.thread("instagram", "peer:p1", {}))?.messages.items.map((m) => [
        m.id,
        m.kind,
        m.text,
      ]);
      expect(kinds).toEqual(
        expect.arrayContaining([
          ["mid.u", "unsupported", ""],
          ["mid.s", "share", ""],
        ]),
      );
    });

    it("skips our own echo, a message with nothing to show, and the read, reaction and postback events", async () => {
      const api = freshDb();
      const body = hook({
        messaging: [
          dm(IG, "mid.echo", { text: "we sent this", is_echo: true }),
          dm("p1", "mid.empty", {}),
          { sender: { id: "p1" }, recipient: { id: IG }, timestamp: T0, read: { mid: "mid.x" } },
          {
            sender: { id: "p1" },
            recipient: { id: IG },
            timestamp: T0,
            reaction: { mid: "mid.x", action: "react", reaction: "love" },
          },
          { sender: { id: "p1" }, recipient: { id: IG }, timestamp: T0, postback: { mid: "m" } },
          { sender: { id: "p1" }, recipient: { id: IG }, timestamp: T0, referral: { ref: "r" } },
        ],
      });

      const res = await send(signed(body), makeEnv(), api);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 0 });
      expect((await api.overview()).counts).toEqual({ conversations: 0, posts: 0, comments: 0 });
      expect(await api.thread("instagram", "peer:p1", {})).toBeNull();
    });

    it("writes one batch for a request with several entries", async () => {
      const api = freshDb();
      const ingest = vi.spyOn(api, "ingest");
      const body = hook(
        { messaging: [dm("p1", "mid.1", { text: "a" }), dm("p2", "mid.2", { text: "b" })] },
        { changes: [commentChange(comment("c1"))] },
      );

      const res = await send(signed(body), makeEnv(), api);

      expect(await res.json()).toEqual({ received: 3 });
      expect(ingest).toHaveBeenCalledTimes(1);
      expect((await api.overview()).counts).toEqual({ conversations: 2, posts: 1, comments: 1 });
    });
  });

  describe("POST /webhooks/instagram: a signed comment", () => {
    it("stores the comment under its post, with a placeholder post when the post is unknown", async () => {
      const api = freshDb();
      const body = hook({
        changes: [
          commentChange(comment("c1", { parent_id: "c0", timestamp: T0 })),
          commentChange(comment("c2", { text: "x".repeat(300) })),
        ],
      });

      const res = await send(signed(body), makeEnv(), api);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 2 });
      const found = await api.comments("instagram", "p1", {});
      expect(found?.post).toEqual({
        platform: "instagram",
        id: "p1",
        caption: "",
        permalink: "",
        thumbUrl: null,
        postedAt: NOW.toISOString(),
        commentCount: 0,
      });
      const byId = Object.fromEntries(found!.comments.items.map((c) => [c.id, c]));
      expect(byId.c1).toEqual({
        platform: "instagram",
        postId: "p1",
        id: "c1",
        parentId: "c0",
        at: "2026-10-22T10:00:00.000Z",
        author: "sara",
        authorId: "u1",
        text: "لت؟",
        hidden: false,
        ours: false,
        sentBy: null,
      });
      // No timestamp in the event: the entry's time (epoch seconds) dates it.
      expect(byId.c2).toMatchObject({ parentId: null, at: "2026-10-22T10:00:00.000Z" });
      expect(byId.c2.text).toBe(clipLog("x".repeat(300)));
    });

    it("keeps a post the store already knows, and replaces nothing of it", async () => {
      const api = freshDb();
      await api.ingest({ posts: [post("p1")] });
      const body = hook({ changes: [commentChange(comment("c1"))] });

      await send(signed(body), makeEnv(), api);

      const found = await api.comments("instagram", "p1", {});
      expect(found?.post).toEqual(post("p1"));
      expect(found?.comments.items.map((c) => c.id)).toEqual(["c1"]);
    });

    it("skips the account's own comment and every field but comments", async () => {
      const api = freshDb();
      const body = hook({
        changes: [
          commentChange(comment("c-own", { from: { id: IG, username: "3z.prod" } })),
          commentChange({ id: "m1", media_id: "p1" }, "mentions"),
          commentChange({ id: "l1" }, "live_comments"),
        ],
      });

      const res = await send(signed(body), makeEnv(), api);

      expect(await res.json()).toEqual({ received: 0 });
      expect((await api.overview()).counts).toEqual({ conversations: 0, posts: 0, comments: 0 });
    });
  });

  describe("POST /webhooks/instagram: refusals and faults", () => {
    const rejected = (api: InboxApi) => api.getMeta("webhook:rejected");

    it("answers 401 to a wrong signature, stores nothing and counts the rejection", async () => {
      const api = freshDb();
      const payload = hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] });

      const first = await send(
        signed(payload, sign(JSON.stringify(payload), "other")),
        makeEnv(),
        api,
      );
      expect(first.status).toBe(401);
      expect(await first.json()).toEqual({ error: "bad_signature" });
      expect(await rejected(api)).toBe("1");

      const second = await send(signed(payload, "sha256=00"), makeEnv(), api);
      expect(second.status).toBe(401);
      expect(await rejected(api)).toBe("2");
      expect((await api.overview()).counts).toEqual({ conversations: 0, posts: 0, comments: 0 });
    });

    it("answers 401 to an empty or malformed signature header and counts it as a wrong signature", async () => {
      const api = freshDb();
      const payload = hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] });
      const body = JSON.stringify(payload);

      expect((await send(signed(payload, ""), makeEnv(), api)).status).toBe(401);
      // The digest without its "sha256=" prefix is not the header Meta sends.
      expect((await send(signed(payload, sign(body).slice(7)), makeEnv(), api)).status).toBe(401);
      expect(await rejected(api)).toBe("2");
    });

    it("answers 401 to a request without the header and does not touch the store (nothing to count)", async () => {
      const api = freshDb();
      const calls = [vi.spyOn(api, "getMeta"), vi.spyOn(api, "setMeta"), vi.spyOn(api, "ingest")];
      const payload = hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] });

      const res = await send(signed(payload, null), makeEnv(), api);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "bad_signature" });
      for (const call of calls) expect(call).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(await rejected(api)).toBeNull();
    });

    it("answers 401 to everything while META_APP_SECRET is not set, even a signature made with an empty secret", async () => {
      const api = freshDb();
      const env = makeEnv({ META_APP_SECRET: undefined });
      const payload = hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] });

      expect((await send(signed(payload), env, api)).status).toBe(401);
      expect(
        (await send(signed(payload, sign(JSON.stringify(payload), "")), env, api)).status,
      ).toBe(401);
      expect((await api.overview()).counts.conversations).toBe(0);
    });

    it("checks the signature against the raw bytes, not the parsed JSON (an independent HMAC vector)", async () => {
      // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog"): a valid signature on a body that is not
      // JSON gets past the signature (400), where a wrong one stops at it (401).
      const text = "The quick brown fox jumps over the lazy dog";
      const vector = "sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
      const env = makeEnv({ META_APP_SECRET: "key" });
      const api = freshDb();

      const ok = await send(signed(text, vector), env, api);
      expect(ok.status).toBe(400);
      expect(await ok.json()).toEqual({ error: "bad_request" });
      expect((await send(signed(text, vector.replace(/.$/, "9")), env, api)).status).toBe(401);
    });

    it("answers 200 with nothing received to an object that is not instagram", async () => {
      const api = freshDb();
      const ingest = vi.spyOn(api, "ingest");

      const res = await send(signed({ object: "page", entry: [{ id: "1" }] }), makeEnv(), api);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 0 });
      expect(ingest).not.toHaveBeenCalled();
    });

    it("answers 500 upstream when the store fails, so Meta delivers the event again", async () => {
      const api = freshDb();
      vi.spyOn(api, "ingest").mockRejectedValue(new Error("DO reset"));
      const payload = hook({ messaging: [dm("p1", "mid.1", { text: "secret words" })] });

      const res = await send(signed(payload), makeEnv(), api);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "upstream" });
      // Never the body or the secret in a log line.
      expect(log.mock.calls.flat().join(" ")).not.toMatch(/secret words|app-secret/);
    });

    it("answers 503 not_available without the INBOX_STORE binding (after the signature)", async () => {
      const payload = hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] });

      const ok = await send(signed(payload), makeEnv());
      expect(ok.status).toBe(503);
      expect(await ok.json()).toEqual({ error: "not_available" });
      // A forged request still gets the signature's answer.
      expect((await send(signed(payload, "sha256=00"), makeEnv())).status).toBe(401);
    });

    it("logs counts only", async () => {
      const api = freshDb();
      const payload = hook({
        messaging: [dm("p1", "mid.1", { text: "secret words" })],
        changes: [commentChange(comment("c1", { text: "private comment" }))],
      });

      await send(signed(payload), makeEnv(), api);
      await send(signed(payload, "sha256=00"), makeEnv(), api);

      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.map((l) => JSON.parse(l))).toEqual([
        { webhook: "instagram", entries: 1, messages: 1, comments: 1, dropped: 0 },
        { webhook: "instagram", rejected: 1 },
      ]);
    });
  });

  describe("POST /webhooks/instagram: odd payloads, redeliveries and big bodies", () => {
    const counts = async (api: InboxApi) => (await api.overview()).counts;
    const nothing = { conversations: 0, posts: 0, comments: 0 };
    const ok0 = async (res: Response) => {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 0 });
    };

    it("answers received 0 to a payload of odd shape (null entries, lists that are objects), never an error", async () => {
      const api = freshDb();
      for (const entry of [
        [null],
        "nope",
        [{ id: IG, messaging: [null] }],
        [{ id: IG, messaging: {} }],
        [{ id: IG, messaging: [{ sender: null, message: null }] }],
        [{ id: IG, changes: [null, { field: "comments", value: null }, { field: "comments" }] }],
      ])
        await ok0(await send(signed({ object: "instagram", entry }), makeEnv(), api));
      expect(await counts(api)).toEqual(nothing);
    });

    it("skips an event whose time no date can hold and a message whose text is not a string", async () => {
      const api = freshDb();
      const body = hook({
        messaging: [dm("p1", "mid.far", { text: "x" }, 1e17), dm("p1", "mid.num", { text: 5 })],
        changes: [commentChange(comment("c1", { timestamp: 1e17 }))],
      });

      await ok0(await send(signed(body), makeEnv(), api));

      expect(await counts(api)).toEqual(nothing);
    });

    it("answers received 0 when the mapping itself throws, and the log carries counts only", async () => {
      // The last millisecond a Date holds: the event can be dated, its 24-hour window cannot.
      const edge = 8.64e15 - 1000;
      const api = freshDb();
      const body = hook({ messaging: [dm("p1", "mid.edge", { text: "private words" }, edge)] });

      await ok0(await send(signed(body), makeEnv(), api));

      expect(await counts(api)).toEqual(nothing);
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.map((l) => JSON.parse(l))).toEqual([
        { webhook: "instagram", entries: 1, error: "unreadable" },
      ]);
      expect(lines.join(" ")).not.toContain("private words");
    });

    it("compares ids as text: a numeric entry id still recognises our echo and our comment", async () => {
      const api = freshDb();
      const body = {
        object: "instagram",
        entry: [
          {
            id: 123,
            time: T0,
            messaging: [
              { sender: { id: "123" }, timestamp: T0, message: { mid: "mid.echo", text: "ours" } },
              { sender: { id: 456 }, timestamp: T0, message: { mid: "mid.p", text: "hi" } },
            ],
            changes: [
              commentChange(comment("c-own", { from: { id: 123, username: "3z.prod" } })),
              commentChange(comment("c2", { from: { id: 789, username: "ali" } })),
            ],
          },
        ],
      };

      const res = await send(signed(body), makeEnv(), api);

      expect(await res.json()).toEqual({ received: 2 });
      expect(await api.thread("instagram", "peer:123", {})).toBeNull();
      expect((await api.thread("instagram", "peer:456", {}))?.conversation.peerId).toBe("456");
      expect(await api.comment("instagram", "c-own")).toBeNull();
      expect(await api.comment("instagram", "c2")).toMatchObject({
        authorId: "789",
        author: "ali",
      });
    });

    it("does not write a redelivered comment again: a hidden comment stays hidden and keeps its author", async () => {
      const api = freshDb();
      await api.ingest({
        posts: [post("p1")],
        comments: [
          {
            platform: "instagram",
            postId: "p1",
            id: "c1",
            parentId: null,
            at: "2026-10-22T09:00:00.000Z",
            author: "ali",
            authorId: "u1",
            text: "original",
            hidden: true,
            ours: false,
            sentBy: null,
          },
        ],
      });
      const ingest = vi.spyOn(api, "ingest");
      const again = comment("c1", { text: "edited", from: { id: "u9", username: "someone" } });

      await ok0(await send(signed(hook({ changes: [commentChange(again)] })), makeEnv(), api));

      expect(ingest).not.toHaveBeenCalled();
      expect(await api.comment("instagram", "c1")).toMatchObject({
        hidden: true,
        text: "original",
        author: "ali",
        authorId: "u1",
      });

      // A known and a new comment in one request: only the new one is written and counted.
      const mixed = hook({ changes: [commentChange(again), commentChange(comment("c2"))] });
      const res = await send(signed(mixed), makeEnv(), api);
      expect(await res.json()).toEqual({ received: 1 });
      expect(ingest).toHaveBeenCalledTimes(1);
      expect(await api.comment("instagram", "c1")).toMatchObject({ hidden: true });
      expect(await api.comment("instagram", "c2")).toMatchObject({ hidden: false });
    });

    it("stores the first 40 events of a request and drops the rest, with no error", async () => {
      expect(WEBHOOK_MAX_EVENTS).toBe(40);
      const api = freshDb();
      const body = hook({
        messaging: Array.from({ length: 45 }, (_, i) => dm(`p${i}`, `mid.${i}`, { text: `m${i}` })),
      });

      const res = await send(signed(body), makeEnv(), api);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 40 });
      expect((await counts(api)).conversations).toBe(40);
      expect(await api.thread("instagram", "peer:p39", {})).not.toBeNull();
      expect(await api.thread("instagram", "peer:p40", {})).toBeNull();
      expect(log.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
        { webhook: "instagram", entries: 1, messages: 40, comments: 0, dropped: 5 },
      ]);
    });

    it("counts events after the skips, and a request of comments makes at most 42 store calls", async () => {
      const api = freshDb();
      const calls = (["comment", "comments", "posts", "ingest", "getMeta", "setMeta"] as const).map(
        (name) => vi.spyOn(api, name),
      );
      const changes = Array.from({ length: 45 }, (_, i) =>
        commentChange(comment(`c${i}`, { media: { id: `p${i}` } })),
      );
      // Our own comments and a field we do not read do not count towards the 40.
      const body = hook({
        changes: [
          commentChange(comment("own", { from: { id: IG, username: "3z.prod" } })),
          commentChange({ id: "m1" }, "mentions"),
          ...changes,
        ],
      });

      const res = await send(signed(body), makeEnv(), api);
      // 40 lookups of a comment, one page of posts, one ingest: under the 50 subrequests of an invocation.
      const used = calls.reduce((n, spy) => n + spy.mock.calls.length, 0);

      expect(await res.json()).toEqual({ received: 40 });
      expect(used).toBeLessThanOrEqual(42);
      expect((await counts(api)).comments).toBe(40);
      expect(await api.comment("instagram", "c39")).not.toBeNull();
      expect(await api.comment("instagram", "c40")).toBeNull();
    });

    it("takes a redelivered message in again without doubling it (messages upsert, so it counts as received)", async () => {
      const api = freshDb();
      const body = hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] });

      for (let i = 0; i < 2; i++) {
        const res = await send(signed(body), makeEnv(), api);
        expect(await res.json()).toEqual({ received: 1 });
      }

      expect((await api.thread("instagram", "peer:p1", {}))?.messages.items).toHaveLength(1);
      expect((await counts(api)).conversations).toBe(1);
    });

    it("verifies the raw bytes: a pretty-printed body signed as sent is stored, one signed as compact JSON is refused", async () => {
      const api = freshDb();
      const payload = hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] });
      const pretty = JSON.stringify(payload, null, 2);

      const stored = await send(signed(pretty), makeEnv(), api);
      expect(stored.status).toBe(200);
      expect(await stored.json()).toEqual({ received: 1 });
      expect((await api.thread("instagram", "peer:p1", {}))?.messages.items).toHaveLength(1);

      const reserialised = await send(
        signed(pretty, sign(JSON.stringify(payload))),
        makeEnv(),
        api,
      );
      expect(reserialised.status).toBe(401);
    });

    it("refuses a body over 1 MB before any crypto: by its Content-Length, or by its size once read", async () => {
      const api = freshDb();
      const hmac = vi.spyOn(crypto.subtle, "sign");
      const declared = new Request(`${BASE}/webhooks/instagram`, {
        method: "POST",
        body: "{}",
        headers: { "Content-Length": String(MAX_BODY + 1), "X-Hub-Signature-256": "sha256=00" },
      });

      const first = await send(declared, makeEnv(), api);
      expect(first.status).toBe(413);
      expect(await first.json()).toEqual({ error: "bad_request" });

      // Even a correctly signed body is refused once it is over the cap.
      const second = await send(signed("x".repeat(MAX_BODY + 1)), makeEnv(), api);
      expect(second.status).toBe(413);
      expect(await second.json()).toEqual({ error: "bad_request" });

      expect(hmac).not.toHaveBeenCalled();
      expect(await api.getMeta("webhook:rejected")).toBeNull();
      // Exactly the cap is read and checked (it is not JSON, so it stops at 400).
      expect((await send(signed("x".repeat(MAX_BODY)), makeEnv(), api)).status).toBe(400);
    });
  });

  describe("webhookToBatch", () => {
    it("builds the rows without touching readAt", () => {
      const batch = webhookToBatch(hook({ messaging: [dm("p1", "mid.1", { text: "hi" })] }), NOW);
      expect(batch.readAt).toBeUndefined();
      expect(batch.messages).toHaveLength(1);
      expect(batch.posts).toEqual([]);
    });

    it("tolerates a payload of the wrong shape", () => {
      for (const bad of [
        null,
        "x",
        1,
        {},
        { object: "instagram" },
        { object: "instagram", entry: 5 },
        { object: "instagram", entry: [null] },
      ])
        expect(webhookToBatch(bad, NOW)).toEqual({
          conversations: [],
          messages: [],
          posts: [],
          comments: [],
          dropped: 0,
        });
    });
  });
});
