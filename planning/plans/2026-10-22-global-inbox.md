# Global Inbox Implementation Plan (steps A–E: Instagram, store, page, sending, instant)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Inbox page in the Social world where the owner reads Instagram DMs and the comments of his posts (grouped by post) and replies from the dashboard, fed by the Worker's every-minute reader now and by Instagram webhooks once Meta approves them.

**Architecture:** The Scout Worker gains a SQLite Durable Object `InboxStore` (the only copy of conversations, messages, posts, comments and sends); a reader fills it from the Instagram Graph API on off-grid cron minutes within the free plan's subrequest budget; `GET/POST /social/inbox/*` routes serve the dashboard and send replies through the existing `sendReply`; a signed `POST /webhooks/instagram` route writes the same rows instantly. The static dashboard reads the Worker every 15 s while the page is visible and keeps only "seen" marks locally.

**Tech Stack:** Cloudflare Workers (wrangler 4.141, SQLite Durable Object, KV), vitest 5 (Node; the DB layer is tested on `node:sqlite`), Next.js 16 static export, React 19, zustand 5, zod 4, Tailwind 4, Playwright (projects `phone`, `desktop`).

**Spec:** `planning/tools/51-global-inbox.md` (steps F and G, TikTok comments and TikTok auto replies, are a later plan: they wait for TikTok's scope approval).

## Global Constraints

- Copy: friendly Hijazi Arabic first, English second; new keys in `messages/inbox.{ar,en}.json` under `inbox.*`; `messages/messages.test.ts` requires identical keys and `{placeholders}` per pair and no key in two files. `social.studio.inbox` already exists (the Studio attention card): do not reuse it.
- Limits are code constants, never retyped in copy: `DM_TEXT_BYTES = 1000` (UTF-8 bytes, `workers/scout/src/social/replyCore.ts:17`), `IG_COMMENT_MAX = 2200` (characters, new), `LOG_TEXT_CLIP = 120`.
- Free plan: 50 subrequests per Worker invocation (KV calls included); the inbox reader spends at most `INBOX_READ_BUDGET = 12` Graph calls per tick and runs only on off-grid minutes after `pollReplies` (which spends ≤ 30). KV writes stay under the replies guard; the inbox writes nothing to KV except `inbox:scan` (one key, "Refresh" requests).
- Durable Objects: SQLite-backed only (free plan). Migration tag `v1-inbox`, class `InboxStore`, binding `INBOX_STORE`. `workers/scout/src/index.ts` must export the class by name; update its "default handler only" comment.
- Every send is one Graph call per tap; the button locks until the answer; an unconfirmed answer is recorded `unconfirmed`, never retried.
- Quality gates before any push: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` (use `E2E_PORT=3111` in this worktree; `pnpm.cmd` in PowerShell). Prettier `printWidth: 100`. Working-tree files are mostly CRLF but `workers/scout/src/social/inbox.ts`, `store.ts` and `components/social/useReplies.ts` are LF: match the file.
- Node: local Node 26 has `node:sqlite`; CI runs Node 22, where it needs `NODE_OPTIONS=--experimental-sqlite` (Task 2 adds it to the test steps). Tests that need it use `describe.skipIf(!sqliteAvailable)` so an old Node skips instead of failing.
- No deploy, live send or secret from a task. The Worker deploys by itself on a push to `main` touching `workers/scout/**`; merges to `main` need the owner's word. The owner adds Worker secrets in Cloudflare.
- Hooks: a GateGuard asks for facts before the first Edit/Write of each file and before "destructive" shell commands; answer it and retry. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
| --- | --- |
| `workers/scout/src/social/inboxProbe.ts` (+ `.test.ts`) | Step A: read-only probe route, raw first items. |
| `workers/scout/src/social/inboxDb.ts` (+ `.test.ts`) | Schema, upserts, queries, retention over a tiny `Sql` interface; the `InboxApi` interface. |
| `workers/scout/src/social/inboxStore.ts` | The Durable Object class (thin: owns an `InboxDb` over `ctx.storage.sql`, exposes `InboxApi` as RPC). |
| `workers/scout/src/social/inboxReader.ts` (+ `.test.ts`) | Graph → `IngestBatch`: conversations page, post rotation, comments; auto marks from the replies state. |
| `workers/scout/src/social/inboxRoutes.ts` (+ `.test.ts`) | `handleInbox`: `/social/inbox/*` reads, refresh, wipe, sends, hide, delete. |
| `workers/scout/src/social/webhooks.ts` (+ `.test.ts`) | `GET/POST /webhooks/instagram`: verify, signature, payload → `IngestBatch`. |
| `workers/scout/src/social/replyCore.ts` | Gains `window_closed`, `too_long` codes and `IG_COMMENT_MAX`. |
| `workers/scout/src/social/cron.ts`, `src/index.ts`, `src/scout.ts`, `src/social/routes.ts`, `wrangler.jsonc` | Wiring. |
| `lib/inbox.ts` (+ `.test.ts`), `lib/domain.ts` | Dashboard client and zod schemas, limits mirrored. |
| `store/index.ts` (+ `.test.ts`) | `inboxSeen`, `inboxTab`, `markInboxSeen`, `setInboxTab`. |
| `components/social/inbox/*` | `InboxScreen`, `useInbox`, `ConversationList`, `ThreadView`, `PostList`, `CommentsView`, `ReplyBox`. |
| `app/social/inbox/page.tsx`, `components/shell/nav.ts`, `components/shell/MoreScreen.tsx`, `components/social/studio/InboxCard.tsx` | Route, navigation, Studio row. |
| `messages/inbox.{ar,en}.json`, `lib/i18n.ts` | Copy. |
| `e2e/inbox.spec.ts`, `e2e/world.spec.ts`, `e2e/social-look.spec.ts`, `components/shell/nav.test.ts` | Proof and path lists. |
| `public/privacy/index.html`, `public/data-deletion/index.html`, `components/settings/SettingsScreen.tsx` | 30-day wording, "Delete inbox store". |

---

### Task 1: Step A, the real-data probe route

**Files:**
- Create: `workers/scout/src/social/inboxProbe.ts`
- Test: `workers/scout/src/social/inboxProbe.test.ts`
- Modify: `workers/scout/src/social/routes.ts:173-184` (dispatch), `workers/scout/README.md` (one contract line)

**Interfaces:**
- Consumes: `Store.getTokens("instagram")` (`store.ts:134`, returns `TokenSet | null` with `accessToken`, `canReply`), `isExpired(tokens, now)` (`oauth.ts:97`), `fetchJson` (`http.ts`; check its exact signature there: `fetchJson<T>(http, url, init?)` → `JsonReply<T>`), `graph(reply, what)` (`replyCore.ts:179`), `IG_API` (`instagram.ts:54`), `LOG_TEXT_CLIP` (`replyCore.ts:249`), the igUserId lookup used by `pollReplies` (grep `fields=user_id` in `replies.ts`; if it is not exported, export it as `igUserIdOf(http, token): Promise<string>`).
- Produces: `handleInboxProbe(req, rest, store, now, http, reply): Promise<Response | null>` answering `GET /social/inbox/probe` with the shape below. Removed again in Task 4 (the real routes replace it).

Probe answer shape (text clipped to `LOG_TEXT_CLIP`, no tokens):

```ts
export interface ProbeReply {
  igUserId: string;
  conversations: { id: string; peer: string; updatedAt: string; messages: { from: "them" | "us"; text: string; at: string }[] }[];
  posts: { id: string; caption: string; commentCount: number; comments: { id: string; author: string; text: string; at: string; replies: number }[] }[];
  calls: number;
}
```

- [ ] **Step 1: Write the failing test** (`inboxProbe.test.ts`; copy `fakeKV`, `makeEnv`, `req`, `connect`, `mockFetch`, `IG` from `replies.test.ts:43-160`)

```ts
import { describe, expect, it } from "vitest";
import { handle } from "../scout";
// … the helpers copied from replies.test.ts (fakeKV, makeEnv, req, connect, mockFetch, IG) …

describe("GET /social/inbox/probe", () => {
  it("returns 5 conversations and the comments of the last 3 posts, clipped, with the call count", async () => {
    const env = makeEnv();
    await connect(env, "instagram", { accessToken: "instagram-token", issuedAt: "2026-10-22T00:00:00Z", canReply: true });
    const fetch = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: (u) => {
        expect(u).toContain("limit=5");
        expect(u).toContain("participants%7Bid%2Cusername%7D");
        return { data: [{ id: "t1", updated_time: "2026-10-22T10:00:00+0000", participants: { data: [{ id: "9", username: "sara" }, { id: "17841", username: "3z.prod" }] },
          messages: { data: [{ id: "m1", created_time: "2026-10-22T10:00:00+0000", from: { id: "9" }, message: "x".repeat(300) }] } }] };
      },
      [`GET ${IG}/17841/media`]: () => ({ data: [{ id: "p1", caption: "LUT reel", timestamp: "2026-10-20T10:00:00+0000", comments_count: 2 }] }),
      [`GET ${IG}/p1/comments`]: () => ({ data: [{ id: "c1", text: "لت", username: "ali", timestamp: "2026-10-21T10:00:00+0000", replies: { data: [{ id: "c1r" }] } }] }),
    });
    const res = await handle(req("/social/inbox/probe"), env, undefined, { fetch, now: () => new Date("2026-10-22T12:00:00Z") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProbeReply;
    expect(body.igUserId).toBe("17841");
    expect(body.conversations[0]).toMatchObject({ id: "t1", peer: "sara" });
    expect(body.conversations[0].messages[0]).toMatchObject({ from: "them" });
    expect(body.conversations[0].messages[0].text).toHaveLength(120);
    expect(body.posts[0]).toMatchObject({ id: "p1", commentCount: 2 });
    expect(body.posts[0].comments[0]).toMatchObject({ id: "c1", author: "ali", text: "لت", replies: 1 });
    expect(body.calls).toBe(4);
  });

  it("answers not_connected without Instagram and no_permission without canReply", async () => {
    const env = makeEnv();
    const r1 = await handle(req("/social/inbox/probe"), env, undefined, { fetch: mockFetch({}), now: () => new Date() });
    expect(r1.status).toBe(409);
    expect(await r1.json()).toEqual({ error: "not_connected" });
    await connect(env, "instagram", { accessToken: "t", issuedAt: "2026-10-22T00:00:00Z", canReply: false });
    const r2 = await handle(req("/social/inbox/probe"), env, undefined, { fetch: mockFetch({}), now: () => new Date() });
    expect(await r2.json()).toEqual({ error: "no_permission" });
  });
});
```

(If `STATUS` in `routes.ts:59` maps `not_connected` to another status, assert that status instead; the body is what matters.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter 3z-scout exec vitest run src/social/inboxProbe.test.ts`
Expected: FAIL (404 / `bad_request`: no route).

- [ ] **Step 3: Implement the probe**

```ts
// workers/scout/src/social/inboxProbe.ts
import { fetchJson, type Http } from "./http";
import { IG_API } from "./instagram";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { LOG_TEXT_CLIP, ReplyError, graph, toReplyCode } from "./replyCore";
import { igUserIdOf } from "./replies";
import type { Store } from "./store";

const clip = (s: string | undefined) => (s ?? "").slice(0, LOG_TEXT_CLIP);
const q = (base: string, params: Record<string, string | number>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
};

export async function handleInboxProbe(
  req: Request,
  rest: string[],
  store: Store | null,
  now: Date,
  http: Http,
  reply: { json: (body: unknown, status?: number) => Response; fail: (e: "not_configured" | "bad_request") => Response },
): Promise<Response | null> {
  if (rest[0] !== "probe" || req.method !== "GET") return null;
  if (!store) return reply.fail("not_configured");
  const tokens = await store.getTokens("instagram");
  if (!tokens) return reply.json({ error: "not_connected" }, 409);
  if (isExpired(tokens, now)) return reply.json({ error: "token_expired" }, 409);
  if (!tokens.canReply) return reply.json({ error: "no_permission" }, 403);
  const token = tokens.accessToken;
  let calls = 0;
  const get = async <T extends MetaError>(url: string, what: string): Promise<T> => {
    calls += 1;
    return graph(await fetchJson<T>(http, url), what);
  };
  try {
    const igUserId = await igUserIdOf(http, token); calls += 1;
    type Conv = { id: string; updated_time: string; participants?: { data: { id: string; username?: string }[] };
      messages?: { data: { id: string; created_time: string; from?: { id: string }; message?: string }[] } };
    const convs = await get<{ data?: Conv[] } & MetaError>(q(`${IG_API}/${igUserId}/conversations`, {
      platform: "instagram", limit: 5, access_token: token,
      fields: "id,updated_time,participants{id,username},messages.limit(3){id,created_time,from,message}" }), "conversations");
    type Media = { id: string; caption?: string; timestamp: string; comments_count?: number };
    const media = await get<{ data?: Media[] } & MetaError>(q(`${IG_API}/${igUserId}/media`, {
      fields: "id,caption,timestamp,comments_count", limit: 3, access_token: token }), "media");
    type Comment = { id: string; text?: string; username?: string; timestamp: string; replies?: { data: { id: string }[] } };
    const posts = [];
    for (const m of media.data ?? []) {
      const c = await get<{ data?: Comment[] } & MetaError>(q(`${IG_API}/${m.id}/comments`, {
        fields: "id,text,username,from,timestamp,replies{id}", limit: 10, access_token: token }), "comments");
      posts.push({ id: m.id, caption: clip(m.caption), commentCount: m.comments_count ?? 0,
        comments: (c.data ?? []).map((x) => ({ id: x.id, author: x.username ?? "", text: clip(x.text), at: x.timestamp, replies: x.replies?.data.length ?? 0 })) });
    }
    return reply.json({
      igUserId,
      conversations: (convs.data ?? []).map((t) => ({
        id: t.id, updatedAt: t.updated_time,
        peer: t.participants?.data.find((p) => p.id !== igUserId)?.username ?? "",
        messages: (t.messages?.data ?? []).map((m) => ({ from: m.from?.id === igUserId ? "us" : "them", text: clip(m.message), at: m.created_time })),
      })),
      posts, calls,
    });
  } catch (e) {
    const { code, detail } = toReplyCode(e instanceof ReplyError ? e : e);
    return reply.json({ error: code, detail }, 502);
  }
}
```

Dispatch in `routes.ts` next to `replies` (`:173`):

```ts
if (action === "inbox") {
  const r = await handleInboxProbe(req, socialPath(pathname).slice(1), store, now, deps.fetch, {
    json: (body, status) => json(body, status ?? 200, cors),
    fail: (error) => fail(error, cors),
  });
  if (r) return r;
}
```

- [ ] **Step 4: Run the test, then the Worker gates**

Run: `pnpm --filter 3z-scout exec vitest run src/social/inboxProbe.test.ts && pnpm typecheck:worker && pnpm lint`
Expected: PASS, no type errors.

- [ ] **Step 5: README line and commit**

Add under the auto-replies contract in `workers/scout/README.md`: `GET /social/inbox/probe → { igUserId, conversations[5], posts[3] with comments[10], calls }` (step A of `planning/tools/51-global-inbox.md`; removed in step B).

```bash
git add workers/scout/src/social/inboxProbe.ts workers/scout/src/social/inboxProbe.test.ts workers/scout/src/social/routes.ts workers/scout/README.md
git commit -m "Inbox step A: read-only probe route for the real-data check"
```

**CHECKPOINT (owner):** open a PR for Task 1 alone, the owner merges it, the Worker deploys. The planner then calls `GET /social/inbox/probe` from the owner's app session in Chrome (token never printed) and shows the raw names, texts and counts. Tasks 2+ start after that reading; if Instagram's shapes differ from the fixtures above, update the fixtures in Tasks 3 and 11 first.

---

### Task 2: `InboxDb` (SQLite schema, queries, retention) and the Durable Object

**Files:**
- Create: `workers/scout/src/social/inboxDb.ts`, `workers/scout/src/social/inboxStore.ts`
- Test: `workers/scout/src/social/inboxDb.test.ts`
- Modify: `workers/scout/wrangler.jsonc` (binding + migration), `workers/scout/src/index.ts` (named export + comment), `workers/scout/src/social/store.ts:31` (`SocialEnv` gains `INBOX_STORE?: DurableObjectNamespace<InboxStore>`), `.github/workflows/ci.yml` and `worker.yml` test steps (`NODE_OPTIONS: --experimental-sqlite`), `workers/scout/tsconfig.json` if `cloudflare:workers` types are missing (`"types": ["@cloudflare/workers-types/2023-07-01"]` already covers them in v5 types; verify with typecheck).

**Interfaces:**
- Produces (used by Tasks 3, 4, 8, 11):

```ts
export type InboxPlatform = "instagram" | "tiktok";
export interface ConversationRow { platform: InboxPlatform; id: string; peerId: string; peerName: string; updatedAt: string;
  lastText: string; lastFrom: "peer" | "owner" | "auto"; windowClosesAt: string | null; answeredBy: "auto" | null }
export interface MessageRow { platform: InboxPlatform; convId: string; id: string; at: string; fromPeer: boolean; text: string;
  kind: "text" | "story" | "share" | "unsupported"; sentBy: "peer" | "owner" | "auto" }
export interface PostRow { platform: InboxPlatform; id: string; permalink: string; thumbUrl: string | null; caption: string;
  postedAt: string; commentCount: number }
export interface CommentRow { platform: InboxPlatform; postId: string; id: string; parentId: string | null; at: string; author: string;
  authorId: string | null; text: string; hidden: boolean; ours: boolean; sentBy: "owner" | "auto" | null }
export interface SendRow { platform: InboxPlatform; kind: "dm" | "reply" | "private"; targetId: string; text: string; at: string;
  state: "sent" | "unconfirmed" | "refused"; platformId: string | null; detail: string | null }
export interface IngestBatch { conversations?: ConversationRow[]; messages?: MessageRow[]; posts?: PostRow[]; comments?: CommentRow[];
  readAt?: { platform: InboxPlatform; at: string } }
export interface Overview { platforms: Record<InboxPlatform, { lastReadAt: string | null; newestAt: string | null }>;
  counts: { conversations: number; posts: number; comments: number } }
export interface Page<T> { items: T[]; more: boolean }
export interface Sql { all<T = Record<string, unknown>>(query: string, ...binds: (string | number | null)[]): T[]; run(ddl: string): void }
export interface InboxApi {
  ingest(batch: IngestBatch): Promise<void>;
  overview(): Promise<Overview>;
  conversations(q: { platform?: InboxPlatform; before?: string; limit?: number }): Promise<Page<ConversationRow>>;
  thread(platform: InboxPlatform, id: string, q: { before?: string; limit?: number }): Promise<{ conversation: ConversationRow; messages: Page<MessageRow> } | null>;
  posts(q: { platform?: InboxPlatform; before?: string; limit?: number }): Promise<Page<PostRow>>;
  comments(platform: InboxPlatform, postId: string, q: { before?: string; limit?: number }): Promise<{ post: PostRow; comments: Page<CommentRow> } | null>;
  recordSend(row: SendRow): Promise<void>;
  setHidden(platform: InboxPlatform, commentId: string, hidden: boolean): Promise<void>;
  deleteComment(platform: InboxPlatform, commentId: string): Promise<void>;
  retain(nowIso: string): Promise<{ dropped: number }>;
  wipe(): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}
export const RETAIN_CONVERSATIONS = 200; export const RETAIN_POSTS = 50; export const RETAIN_DAYS = 30; export const PAGE = 20;
export class InboxDb implements InboxApi { constructor(sql: Sql) }
export function nodeSql(): Sql | null   // test helper exported from inboxDb.test.ts, not from inboxDb.ts
```

- [ ] **Step 1: Write the failing tests** (`inboxDb.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { InboxDb, PAGE, RETAIN_CONVERSATIONS, type Sql } from "./inboxDb";

function nodeSql(): Sql | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    return { all: (q, ...b) => db.prepare(q).all(...b) as never, run: (ddl) => db.exec(ddl) };
  } catch { return null; }
}
const sql = nodeSql();
const conv = (id: string, updatedAt: string) => ({ platform: "instagram" as const, id, peerId: `p${id}`, peerName: `peer ${id}`,
  updatedAt, lastText: "hi", lastFrom: "peer" as const, windowClosesAt: null, answeredBy: null });

describe.skipIf(!sql)("InboxDb", () => {
  it("upserts conversations and pages them newest first", async () => {
    const db = new InboxDb(sql!);
    await db.ingest({ conversations: [conv("a", "2026-10-22T10:00:00.000Z"), conv("b", "2026-10-22T11:00:00.000Z")] });
    await db.ingest({ conversations: [{ ...conv("a", "2026-10-22T12:00:00.000Z"), lastText: "again" }] });
    const page = await db.conversations({});
    expect(page.items.map((c) => c.id)).toEqual(["a", "b"]);
    expect(page.items[0].lastText).toBe("again");
    expect(page.more).toBe(false);
  });
  it("pages with before and limit", async () => {
    const db = new InboxDb(sql!);
    await db.ingest({ conversations: Array.from({ length: PAGE + 1 }, (_, i) => conv(`c${i}`, `2026-10-01T00:${String(i).padStart(2, "0")}:00.000Z`)) });
    const first = await db.conversations({});
    expect(first.items).toHaveLength(PAGE); expect(first.more).toBe(true);
    const next = await db.conversations({ before: first.items.at(-1)!.updatedAt });
    expect(next.items).toHaveLength(1); expect(next.more).toBe(false);
  });
  it("thread returns messages oldest first within the page, comments newest first, nulls for unknown ids", async () => {
    const db = new InboxDb(sql!);
    await db.ingest({ conversations: [conv("a", "2026-10-22T10:00:00.000Z")], messages: [
      { platform: "instagram", convId: "a", id: "m2", at: "2026-10-22T10:00:00.000Z", fromPeer: true, text: "two", kind: "text", sentBy: "peer" },
      { platform: "instagram", convId: "a", id: "m1", at: "2026-10-22T09:00:00.000Z", fromPeer: false, text: "one", kind: "text", sentBy: "owner" }],
      posts: [{ platform: "instagram", id: "p1", permalink: "https://www.instagram.com/reel/X/", thumbUrl: null, caption: "LUT", postedAt: "2026-10-20T00:00:00.000Z", commentCount: 1 }],
      comments: [{ platform: "instagram", postId: "p1", id: "c1", parentId: null, at: "2026-10-21T00:00:00.000Z", author: "ali", authorId: "5", text: "لت", hidden: false, ours: false, sentBy: null }] });
    const t = await db.thread("instagram", "a", {});
    expect(t?.messages.items.map((m) => m.id)).toEqual(["m1", "m2"]);
    const c = await db.comments("instagram", "p1", {});
    expect(c?.post.caption).toBe("LUT"); expect(c?.comments.items[0].text).toBe("لت");
    expect(await db.thread("instagram", "nope", {})).toBeNull();
  });
  it("records sends, hides and deletes comments, keeps meta", async () => {
    const db = new InboxDb(sql!);
    await db.ingest({ posts: [{ platform: "instagram", id: "p1", permalink: "", thumbUrl: null, caption: "", postedAt: "2026-10-20T00:00:00.000Z", commentCount: 0 }],
      comments: [{ platform: "instagram", postId: "p1", id: "c1", parentId: null, at: "2026-10-21T00:00:00.000Z", author: "ali", authorId: null, text: "x", hidden: false, ours: false, sentBy: null }] });
    await db.setHidden("instagram", "c1", true);
    expect((await db.comments("instagram", "p1", {}))?.comments.items[0].hidden).toBe(true);
    await db.deleteComment("instagram", "c1");
    expect((await db.comments("instagram", "p1", {}))?.comments.items).toHaveLength(0);
    await db.recordSend({ platform: "instagram", kind: "dm", targetId: "a", text: "hi", at: "2026-10-22T00:00:00.000Z", state: "sent", platformId: "mid", detail: null });
    await db.setMeta("lastReadAt:instagram", "2026-10-22T00:00:00.000Z");
    expect(await db.getMeta("lastReadAt:instagram")).toBe("2026-10-22T00:00:00.000Z");
    expect((await db.overview()).platforms.instagram.lastReadAt).toBe("2026-10-22T00:00:00.000Z");
  });
  it("retain drops beyond the caps and older than 30 days, and wipe empties everything", async () => {
    const db = new InboxDb(sql!);
    await db.ingest({ conversations: Array.from({ length: RETAIN_CONVERSATIONS + 5 }, (_, i) => conv(`c${i}`, `2026-10-${String(1 + (i % 20)).padStart(2, "0")}T00:00:00.000Z`)) });
    await db.ingest({ conversations: [conv("old", "2026-08-01T00:00:00.000Z")] });
    const r = await db.retain("2026-10-22T00:00:00.000Z");
    expect(r.dropped).toBeGreaterThanOrEqual(6);
    expect((await db.overview()).counts.conversations).toBe(RETAIN_CONVERSATIONS);
    await db.wipe();
    expect((await db.overview()).counts).toEqual({ conversations: 0, posts: 0, comments: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-sqlite pnpm --filter 3z-scout exec vitest run src/social/inboxDb.test.ts` (plain `pnpm …` on Node ≥ 24)
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `inboxDb.ts`**

```ts
// workers/scout/src/social/inboxDb.ts
export const RETAIN_CONVERSATIONS = 200;
export const RETAIN_POSTS = 50;
export const RETAIN_DAYS = 30;
export const PAGE = 20;
// … the types from the Interfaces block above, exported …

const DDL = `
CREATE TABLE IF NOT EXISTS conversations (platform TEXT, id TEXT, peerId TEXT, peerName TEXT, updatedAt TEXT, lastText TEXT,
  lastFrom TEXT, windowClosesAt TEXT, answeredBy TEXT, PRIMARY KEY (platform, id));
CREATE INDEX IF NOT EXISTS conversations_updated ON conversations (updatedAt DESC);
CREATE TABLE IF NOT EXISTS messages (platform TEXT, convId TEXT, id TEXT, at TEXT, fromPeer INTEGER, text TEXT, kind TEXT, sentBy TEXT,
  PRIMARY KEY (platform, id));
CREATE INDEX IF NOT EXISTS messages_conv ON messages (platform, convId, at);
CREATE TABLE IF NOT EXISTS posts (platform TEXT, id TEXT, permalink TEXT, thumbUrl TEXT, caption TEXT, postedAt TEXT, commentCount INTEGER,
  PRIMARY KEY (platform, id));
CREATE TABLE IF NOT EXISTS comments (platform TEXT, postId TEXT, id TEXT, parentId TEXT, at TEXT, author TEXT, authorId TEXT, text TEXT,
  hidden INTEGER, ours INTEGER, sentBy TEXT, PRIMARY KEY (platform, id));
CREATE INDEX IF NOT EXISTS comments_post ON comments (platform, postId, at DESC);
CREATE TABLE IF NOT EXISTS sends (seq INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, kind TEXT, targetId TEXT, text TEXT, at TEXT,
  state TEXT, platformId TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`;

const bool = (v: unknown) => v === 1 || v === true;

export class InboxDb implements InboxApi {
  constructor(private readonly sql: Sql) { sql.run(DDL); }

  async ingest(b: IngestBatch): Promise<void> {
    for (const c of b.conversations ?? [])
      this.sql.all(`INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,id) DO UPDATE SET peerName=excluded.peerName,
        updatedAt=excluded.updatedAt, lastText=excluded.lastText, lastFrom=excluded.lastFrom, windowClosesAt=excluded.windowClosesAt,
        answeredBy=COALESCE(excluded.answeredBy, conversations.answeredBy)`,
        c.platform, c.id, c.peerId, c.peerName, c.updatedAt, c.lastText, c.lastFrom, c.windowClosesAt, c.answeredBy);
    for (const m of b.messages ?? [])
      this.sql.all(`INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?,?)`,
        m.platform, m.convId, m.id, m.at, m.fromPeer ? 1 : 0, m.text, m.kind, m.sentBy);
    for (const p of b.posts ?? [])
      this.sql.all(`INSERT OR REPLACE INTO posts VALUES (?,?,?,?,?,?,?)`,
        p.platform, p.id, p.permalink, p.thumbUrl, p.caption, p.postedAt, p.commentCount);
    for (const c of b.comments ?? [])
      this.sql.all(`INSERT INTO comments VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,id) DO UPDATE SET text=excluded.text,
        hidden=excluded.hidden, author=excluded.author, sentBy=COALESCE(excluded.sentBy, comments.sentBy)`,
        c.platform, c.postId, c.id, c.parentId, c.at, c.author, c.authorId, c.text, c.hidden ? 1 : 0, c.ours ? 1 : 0, c.sentBy);
    if (b.readAt) await this.setMeta(`lastReadAt:${b.readAt.platform}`, b.readAt.at);
  }

  async overview(): Promise<Overview> {
    const count = (t: string) => Number(this.sql.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)[0]?.n ?? 0);
    const platform = async (p: InboxPlatform) => ({
      lastReadAt: await this.getMeta(`lastReadAt:${p}`),
      newestAt: this.sql.all<{ t: string | null }>(`SELECT MAX(updatedAt) AS t FROM conversations WHERE platform=?`, p)[0]?.t ?? null,
    });
    return { platforms: { instagram: await platform("instagram"), tiktok: await platform("tiktok") },
      counts: { conversations: count("conversations"), posts: count("posts"), comments: count("comments") } };
  }

  private page<T>(rows: T[], limit: number): Page<T> {
    return rows.length > limit ? { items: rows.slice(0, limit), more: true } : { items: rows, more: false };
  }

  async conversations(q: { platform?: InboxPlatform; before?: string; limit?: number }): Promise<Page<ConversationRow>> {
    const limit = q.limit ?? PAGE;
    const rows = this.sql.all<ConversationRow>(
      `SELECT * FROM conversations WHERE (? IS NULL OR platform=?) AND (? IS NULL OR updatedAt<?) ORDER BY updatedAt DESC LIMIT ?`,
      q.platform ?? null, q.platform ?? null, q.before ?? null, q.before ?? null, limit + 1);
    return this.page(rows, limit);
  }

  async thread(platform: InboxPlatform, id: string, q: { before?: string; limit?: number }) {
    const conversation = this.sql.all<ConversationRow>(`SELECT * FROM conversations WHERE platform=? AND id=?`, platform, id)[0];
    if (!conversation) return null;
    const limit = q.limit ?? PAGE;
    const rows = this.sql.all<MessageRow & { fromPeer: number }>(
      `SELECT * FROM messages WHERE platform=? AND convId=? AND (? IS NULL OR at<?) ORDER BY at DESC LIMIT ?`,
      platform, id, q.before ?? null, q.before ?? null, limit + 1);
    const page = this.page(rows, limit);
    return { conversation, messages: { more: page.more, items: page.items.reverse().map((m) => ({ ...m, fromPeer: bool(m.fromPeer) })) } };
  }

  async posts(q: { platform?: InboxPlatform; before?: string; limit?: number }): Promise<Page<PostRow>> {
    const limit = q.limit ?? PAGE;
    return this.page(this.sql.all<PostRow>(
      `SELECT * FROM posts WHERE (? IS NULL OR platform=?) AND (? IS NULL OR postedAt<?) ORDER BY postedAt DESC LIMIT ?`,
      q.platform ?? null, q.platform ?? null, q.before ?? null, q.before ?? null, limit + 1), limit);
  }

  async comments(platform: InboxPlatform, postId: string, q: { before?: string; limit?: number }) {
    const post = this.sql.all<PostRow>(`SELECT * FROM posts WHERE platform=? AND id=?`, platform, postId)[0];
    if (!post) return null;
    const limit = q.limit ?? PAGE;
    const rows = this.sql.all<CommentRow & { hidden: number; ours: number }>(
      `SELECT * FROM comments WHERE platform=? AND postId=? AND (? IS NULL OR at<?) ORDER BY at DESC LIMIT ?`,
      platform, postId, q.before ?? null, q.before ?? null, limit + 1);
    const page = this.page(rows, limit);
    return { post, comments: { more: page.more, items: page.items.map((c) => ({ ...c, hidden: bool(c.hidden), ours: bool(c.ours) })) } };
  }

  async recordSend(r: SendRow): Promise<void> {
    this.sql.all(`INSERT INTO sends (platform,kind,targetId,text,at,state,platformId,detail) VALUES (?,?,?,?,?,?,?,?)`,
      r.platform, r.kind, r.targetId, r.text, r.at, r.state, r.platformId, r.detail);
  }
  async setHidden(platform: InboxPlatform, id: string, hidden: boolean) { this.sql.all(`UPDATE comments SET hidden=? WHERE platform=? AND id=?`, hidden ? 1 : 0, platform, id); }
  async deleteComment(platform: InboxPlatform, id: string) { this.sql.all(`DELETE FROM comments WHERE platform=? AND id=?`, platform, id); }

  async retain(nowIso: string): Promise<{ dropped: number }> {
    const cutoff = new Date(new Date(nowIso).getTime() - RETAIN_DAYS * 86_400_000).toISOString();
    const before = (await this.overview()).counts;
    this.sql.all(`DELETE FROM conversations WHERE updatedAt<? OR (platform, id) NOT IN (SELECT platform, id FROM conversations ORDER BY updatedAt DESC LIMIT ?)`, cutoff, RETAIN_CONVERSATIONS);
    this.sql.all(`DELETE FROM messages WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.platform=messages.platform AND c.id=messages.convId)`);
    this.sql.all(`DELETE FROM posts WHERE postedAt<? OR (platform, id) NOT IN (SELECT platform, id FROM posts ORDER BY postedAt DESC LIMIT ?)`, cutoff, RETAIN_POSTS);
    this.sql.all(`DELETE FROM comments WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.platform=comments.platform AND p.id=comments.postId)`);
    this.sql.all(`DELETE FROM sends WHERE at<?`, cutoff);
    const after = (await this.overview()).counts;
    return { dropped: before.conversations + before.posts + before.comments - after.conversations - after.posts - after.comments };
  }
  async wipe() { for (const t of ["conversations", "messages", "posts", "comments", "sends", "meta"]) this.sql.all(`DELETE FROM ${t}`); }
  async getMeta(key: string) { return this.sql.all<{ value: string }>(`SELECT value FROM meta WHERE key=?`, key)[0]?.value ?? null; }
  async setMeta(key: string, value: string) { this.sql.all(`INSERT OR REPLACE INTO meta VALUES (?,?)`, key, value); }
}
```

(SQLite's row tuple `IN` needs SQLite ≥ 3.15; both `node:sqlite` and Workers ship newer. If the Workers typecheck rejects `?` binds typed `string | number | null`, widen `Sql.all`'s bind type to `unknown`.)

- [ ] **Step 4: Run the tests until green**

Run: `NODE_OPTIONS=--experimental-sqlite pnpm --filter 3z-scout exec vitest run src/social/inboxDb.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: The Durable Object class and wiring**

```ts
// workers/scout/src/social/inboxStore.ts
import { DurableObject } from "cloudflare:workers";
import { InboxDb, type IngestBatch, type InboxApi, type InboxPlatform, type SendRow, type Sql } from "./inboxDb";

/** The owner's inbox store (planning/tools/51-global-inbox.md): one object, idFromName("owner"). Thin: every method is InboxDb's. */
export class InboxStore extends DurableObject implements InboxApi {
  private readonly db: InboxDb;
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    const sql: Sql = {
      all: (q, ...b) => ctx.storage.sql.exec(q, ...b).toArray() as never,
      run: (ddl) => void ctx.storage.sql.exec(ddl),
    };
    this.db = new InboxDb(sql);
  }
  ingest(b: IngestBatch) { return this.db.ingest(b); }
  overview() { return this.db.overview(); }
  conversations(q: Parameters<InboxApi["conversations"]>[0]) { return this.db.conversations(q); }
  thread(p: InboxPlatform, id: string, q: Parameters<InboxApi["thread"]>[2]) { return this.db.thread(p, id, q); }
  posts(q: Parameters<InboxApi["posts"]>[0]) { return this.db.posts(q); }
  comments(p: InboxPlatform, id: string, q: Parameters<InboxApi["comments"]>[2]) { return this.db.comments(p, id, q); }
  recordSend(r: SendRow) { return this.db.recordSend(r); }
  setHidden(p: InboxPlatform, id: string, hidden: boolean) { return this.db.setHidden(p, id, hidden); }
  deleteComment(p: InboxPlatform, id: string) { return this.db.deleteComment(p, id); }
  retain(nowIso: string) { return this.db.retain(nowIso); }
  wipe() { return this.db.wipe(); }
  getMeta(k: string) { return this.db.getMeta(k); }
  setMeta(k: string, v: string) { return this.db.setMeta(k, v); }
}

/** The store's RPC stub, or null when the binding is missing (an older deploy, a test env). */
export function inboxApi(env: { INBOX_STORE?: DurableObjectNamespace<InboxStore> }): InboxApi | null {
  if (!env.INBOX_STORE) return null;
  return env.INBOX_STORE.get(env.INBOX_STORE.idFromName("owner")) as unknown as InboxApi;
}
```

`index.ts`: add `export { InboxStore } from "./social/inboxStore";` and change the comment at `:18-19` to: "Exports: the default handler and the Durable Object classes only (workerd treats every other named export of the main module as an entrypoint and refuses to start)". `store.ts:31` `SocialEnv`: add `INBOX_STORE?: DurableObjectNamespace<InboxStore>` (import type). `wrangler.jsonc` after `kv_namespaces`:

```jsonc
  // The global inbox (planning/tools/51-global-inbox.md): one SQLite Durable Object holds the latest conversations,
  // messages, posts, comments and sends; KV's write budget never sees them.
  "durable_objects": { "bindings": [{ "name": "INBOX_STORE", "class_name": "InboxStore" }] },
  "migrations": [{ "tag": "v1-inbox", "new_sqlite_classes": ["InboxStore"] }],
```

CI: in `.github/workflows/ci.yml` and `worker.yml`, on the steps that run `pnpm test` / `pnpm worker:test`, add `env: { NODE_OPTIONS: --experimental-sqlite }` (YAML form). Node ≥ 24 ignores the flag with a warning only; if the CI Node is bumped to 24 later, remove it.

- [ ] **Step 6: Gates and commit**

Run: `pnpm typecheck:worker && pnpm lint && NODE_OPTIONS=--experimental-sqlite pnpm test`
Expected: PASS; `wrangler deploy --dry-run` is NOT run (needs the account); the config schema is checked by `pnpm --filter 3z-scout exec wrangler types` if it exists in this version, otherwise skip.

```bash
git add workers/scout/src/social/inboxDb.ts workers/scout/src/social/inboxDb.test.ts workers/scout/src/social/inboxStore.ts workers/scout/src/index.ts workers/scout/src/social/store.ts workers/scout/wrangler.jsonc .github/workflows/ci.yml .github/workflows/worker.yml
git commit -m "Inbox step B: InboxStore Durable Object (SQLite) with the InboxDb layer"
```

---

### Task 3: The reader (Graph → `IngestBatch`) on the cron

**Files:**
- Create: `workers/scout/src/social/inboxReader.ts`
- Test: `workers/scout/src/social/inboxReader.test.ts`
- Modify: `workers/scout/src/social/cron.ts:88` (off-grid branch), `workers/scout/src/social/replies.ts` (export `igUserIdOf` if Task 1 did not)

**Interfaces:**
- Consumes: `InboxApi` (Task 2), `inboxApi(env)`, `Store.getTokens`, `isExpired`, `fetchJson`, `graph`, `IG_API`, `isOwnSend(state, id, ms, personId)` (`inbox.ts:74`), `toMs` (`inbox.ts:64`), `WINDOW_MS` (`inbox.ts:42`), `store.getRepliesState()` (the `replies:state` reader; name as in `store.ts`, the one `pollReplies` uses), `LOG_TEXT_CLIP`.
- Produces: `readInboxTick(env, { fetch, now }): Promise<InboxReadResult>` and `export const INBOX_READ_BUDGET = 12; POSTS_PER_TICK = 5; MEDIA_REFRESH_TICKS = 10;` and `export function toBatch(input, igUserId, repliesState, now): IngestBatch` (pure mapping).

```ts
export type InboxReadResult = { skipped: "no_store" | "not_connected" | "no_permission" | "token_expired" } | { calls: number; conversations: number; posts: number; comments: number; error?: string };
```

Rotation: `meta("ig:postCursor")` holds the index into the stored posts list (newest first); each tick reads comments for the next `POSTS_PER_TICK` posts and advances; every `MEDIA_REFRESH_TICKS` ticks (counter in `meta("ig:tick")`) one `GET /{igUserId}/media?fields=id,caption,permalink,timestamp,thumbnail_url,media_url,comments_count&limit=50` refreshes the posts table. Conversations: one `GET /{igUserId}/conversations?platform=instagram&limit=20&fields=id,updated_time,participants{id,username},messages.limit(20){id,created_time,from,message,story,is_unsupported}` per tick. Calls per tick ≤ 1 + 1 + 5 = 7 (< `INBOX_READ_BUDGET`). "Refresh" (`POST /social/inbox/refresh`, Task 4) writes KV key `inbox:scan` = ISO time; the reader reads it (1 KV read) and, when newer than `meta("ig:lastScan")`, reads comments for the newest 5 posts regardless of the cursor.

Mapping rules in `toBatch`: `peerId` = the participant whose id ≠ igUserId (fallback `""`, name fallback `"?"`); message `fromPeer` = `from.id !== igUserId`; `sentBy` = peer → `"peer"`, else `isOwnSend(repliesState, m.id, toMs(m.created_time), peerId)` → `"auto"` else `"owner"`; `kind`: `story` present → `"story"`, `is_unsupported` → `"unsupported"`, no `message` → `"share"`, else `"text"`; `lastText` = newest message's text (clipped to `LOG_TEXT_CLIP`), `lastFrom` from its `sentBy`; `windowClosesAt` = newest peer message `created_time` + `WINDOW_MS` (ISO) or null; `answeredBy` = `"auto"` when the newest owner-side message is `sentBy: "auto"`, else null. Comments: `ours` = `from.id === igUserId`; replies (`replies{...}` edge) become comment rows with `parentId`; `commentCount` from media `comments_count`.

- [ ] **Step 1: Write the failing tests** (`inboxReader.test.ts`; fake env + `mockFetch` as in Task 1; the `InboxApi` is a Node `InboxDb` from Task 2's `nodeSql()`, injected through `deps.api`)

```ts
describe.skipIf(!sql)("readInboxTick", () => {
  it("fills the store from one conversations page and the rotation's comments, marks auto replies", async () => {
    const env = makeEnv(); await connect(env, "instagram", { accessToken: "tok", issuedAt: "2026-10-22T00:00:00Z", canReply: true });
    const api = new InboxDb(sql!);
    // the replies poll's own send, 2 min ago, to peer 9
    env.SOCIAL_KV.store.set("replies:state", JSON.stringify({ sent: { m9: { to: "9", at: "2026-10-22T11:58:00.000Z" } } }));
    const fetch = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: "17841" }),
      [`GET ${IG}/17841/conversations`]: () => ({ data: [{ id: "t1", updated_time: "2026-10-22T11:58:00+0000",
        participants: { data: [{ id: "9", username: "sara" }, { id: "17841", username: "3z.prod" }] },
        messages: { data: [{ id: "m9", created_time: "2026-10-22T11:58:00+0000", from: { id: "17841" }, message: "auto text" },
                           { id: "m8", created_time: "2026-10-22T11:57:00+0000", from: { id: "9" }, message: "لت" }] } }] }),
      [`GET ${IG}/17841/media`]: () => ({ data: [{ id: "p1", caption: "LUT", permalink: "https://www.instagram.com/reel/X/", timestamp: "2026-10-20T00:00:00+0000", thumbnail_url: "https://cdn/x.jpg", comments_count: 1 }] }),
      [`GET ${IG}/p1/comments`]: () => ({ data: [{ id: "c1", text: "لت", username: "ali", from: { id: "5" }, timestamp: "2026-10-21T00:00:00+0000", replies: { data: [{ id: "c1r", text: "sent it", username: "3z.prod", from: { id: "17841" }, timestamp: "2026-10-21T00:01:00+0000" }] } }] }),
    });
    const r = await readInboxTick(env, { fetch, now: () => new Date("2026-10-22T12:00:00Z"), api });
    expect(r).toMatchObject({ calls: 4, conversations: 1, posts: 1, comments: 2 });
    const t = (await api.thread("instagram", "t1", {}))!;
    expect(t.conversation).toMatchObject({ peerId: "9", peerName: "sara", lastFrom: "auto", answeredBy: "auto", windowClosesAt: "2026-10-23T11:57:00.000Z" });
    expect(t.messages.items.map((m) => m.sentBy)).toEqual(["peer", "auto"]);
    const c = (await api.comments("instagram", "p1", {}))!;
    expect(c.comments.items.find((x) => x.id === "c1r")).toMatchObject({ parentId: "c1", ours: true });
    expect(await api.getMeta("lastReadAt:instagram")).toBe("2026-10-22T12:00:00.000Z");
  });
  it("skips without the binding, without a connection, without canReply, and never exceeds the budget", async () => {
    const env = makeEnv();
    expect(await readInboxTick(env, { fetch: mockFetch({}), now: () => new Date() })).toEqual({ skipped: "no_store" });
    expect(await readInboxTick(env, { fetch: mockFetch({}), now: () => new Date(), api: new InboxDb(sql!) })).toEqual({ skipped: "not_connected" });
    await connect(env, "instagram", { accessToken: "tok", issuedAt: "2026-10-22T00:00:00Z", canReply: false });
    expect(await readInboxTick(env, { fetch: mockFetch({}), now: () => new Date(), api: new InboxDb(sql!) })).toEqual({ skipped: "no_permission" });
  });
  it("rotates comments over the stored posts, five a tick, and refreshes media every tenth tick", async () => {
    // Seed 12 posts with api.ingest({ posts: [...] }), a mockFetch whose `GET ${IG}/<id>/comments` handlers push the id into
    // an array; run three ticks with now() stepping one minute; assert the id sets [0..4], [5..9], [10,11,0,1,2] and that
    // `GET …/media` was called on tick 1 only (tick counter 0) and again when meta ig:tick reaches 10.
  });
});
```

(Write the third test fully, following the first test's style.)

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-sqlite pnpm --filter 3z-scout exec vitest run src/social/inboxReader.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `inboxReader.ts`**

```ts
// workers/scout/src/social/inboxReader.ts
import { fetchJson, type Http } from "./http";
import { IG_API } from "./instagram";
import { WINDOW_MS, isOwnSend, toMs } from "./inbox";
import { type CommentRow, type ConversationRow, type IngestBatch, type InboxApi, type MessageRow, type PostRow } from "./inboxDb";
import { inboxApi } from "./inboxStore";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { LOG_TEXT_CLIP, graph, toReplyCode } from "./replyCore";
import { igUserIdOf } from "./replies";
import { Store, type SocialEnv } from "./store";

export const INBOX_READ_BUDGET = 12;
export const POSTS_PER_TICK = 5;
export const MEDIA_REFRESH_TICKS = 10;
export const CONVERSATIONS_FIELDS = "id,updated_time,participants{id,username},messages.limit(20){id,created_time,from,message,story,is_unsupported}";
export const MEDIA_FIELDS = "id,caption,permalink,timestamp,thumbnail_url,media_url,comments_count";
export const COMMENT_FIELDS = "id,text,username,from,timestamp,replies{id,text,username,from,timestamp}";

export type InboxReadResult =
  | { skipped: "no_store" | "not_connected" | "no_permission" | "token_expired" }
  | { calls: number; conversations: number; posts: number; comments: number; error?: string };

interface IgMessage { id: string; created_time: string; from?: { id: string }; message?: string; story?: unknown; is_unsupported?: boolean }
interface IgConversation { id: string; updated_time: string; participants?: { data: { id: string; username?: string }[] }; messages?: { data: IgMessage[] } }
interface IgMedia { id: string; caption?: string; permalink?: string; timestamp: string; thumbnail_url?: string; media_url?: string; comments_count?: number }
interface IgComment { id: string; text?: string; username?: string; from?: { id: string }; timestamp: string; replies?: { data: IgComment[] } }
type RepliesState = Parameters<typeof isOwnSend>[0];

const clip = (s: string | undefined) => (s ?? "").slice(0, LOG_TEXT_CLIP);
const iso = (ms: number) => new Date(ms).toISOString();

export function toBatch(input: { conversations: IgConversation[]; media: IgMedia[]; comments: { postId: string; rows: IgComment[] }[] },
  igUserId: string, repliesState: RepliesState, now: Date): IngestBatch {
  const conversations: ConversationRow[] = []; const messages: MessageRow[] = [];
  for (const t of input.conversations) {
    const peer = t.participants?.data.find((p) => p.id !== igUserId);
    const peerId = peer?.id ?? ""; const peerName = peer?.username ?? "?";
    const rows = (t.messages?.data ?? []).map((m): MessageRow => {
      const fromPeer = m.from?.id !== igUserId;
      const sentBy = fromPeer ? "peer" : isOwnSend(repliesState, m.id, toMs(m.created_time), peerId) ? "auto" : "owner";
      const kind = m.story ? "story" : m.is_unsupported ? "unsupported" : m.message === undefined ? "share" : "text";
      return { platform: "instagram", convId: t.id, id: m.id, at: iso(toMs(m.created_time)), fromPeer, text: clip(m.message), kind, sentBy };
    }).sort((a, b) => (a.at < b.at ? -1 : 1));
    const newest = rows.at(-1); const newestPeer = [...rows].reverse().find((m) => m.fromPeer);
    const newestOurs = [...rows].reverse().find((m) => !m.fromPeer);
    conversations.push({ platform: "instagram", id: t.id, peerId, peerName, updatedAt: iso(toMs(t.updated_time)),
      lastText: newest?.text ?? "", lastFrom: newest?.sentBy ?? "peer",
      windowClosesAt: newestPeer ? iso(new Date(newestPeer.at).getTime() + WINDOW_MS) : null,
      answeredBy: newestOurs?.sentBy === "auto" ? "auto" : null });
    messages.push(...rows);
  }
  const posts: PostRow[] = input.media.map((m) => ({ platform: "instagram", id: m.id, permalink: m.permalink ?? "", thumbUrl: m.thumbnail_url ?? m.media_url ?? null,
    caption: clip(m.caption), postedAt: iso(toMs(m.timestamp)), commentCount: m.comments_count ?? 0 }));
  const comments: CommentRow[] = [];
  const push = (postId: string, c: IgComment, parentId: string | null) => {
    comments.push({ platform: "instagram", postId, id: c.id, parentId, at: iso(toMs(c.timestamp)), author: c.username ?? "", authorId: c.from?.id ?? null,
      text: clip(c.text), hidden: false, ours: c.from?.id === igUserId, sentBy: c.from?.id === igUserId ? "owner" : null });
    for (const r of c.replies?.data ?? []) push(postId, r, c.id);
  };
  for (const { postId, rows } of input.comments) for (const c of rows) push(postId, c, null);
  return { conversations, messages, posts, comments, readAt: { platform: "instagram", at: now.toISOString() } };
}

export async function readInboxTick(env: SocialEnv, deps: { fetch?: Http; now?: () => Date; api?: InboxApi } = {}): Promise<InboxReadResult> {
  const api = deps.api ?? inboxApi(env);
  if (!api) return { skipped: "no_store" };
  const store = Store.from(env); const now = deps.now?.() ?? new Date(); const http = deps.fetch ?? fetch;
  const tokens = store ? await store.getTokens("instagram") : null;
  if (!tokens) return { skipped: "not_connected" };
  if (isExpired(tokens, now)) return { skipped: "token_expired" };
  if (!tokens.canReply) return { skipped: "no_permission" };
  const token = tokens.accessToken; let calls = 0;
  const get = async <T extends MetaError>(url: string, params: Record<string, string | number>, what: string) => {
    if (calls >= INBOX_READ_BUDGET) throw new Error("budget");
    calls += 1; const u = new URL(url); for (const [k, v] of Object.entries({ ...params, access_token: token })) u.searchParams.set(k, String(v));
    return graph(await fetchJson<T>(http, u.toString()), what);
  };
  try {
    const igUserId = await igUserIdOf(http, token); calls += 1;
    const repliesState = ((await store!.getRepliesState()) ?? { sent: {} }) as RepliesState;
    const tick = Number((await api.getMeta("ig:tick")) ?? "0");
    const convs = await get<{ data?: IgConversation[] } & MetaError>(`${IG_API}/${igUserId}/conversations`, { platform: "instagram", limit: 20, fields: CONVERSATIONS_FIELDS }, "conversations");
    let media: IgMedia[] = [];
    if (tick % MEDIA_REFRESH_TICKS === 0) {
      media = (await get<{ data?: IgMedia[] } & MetaError>(`${IG_API}/${igUserId}/media`, { fields: MEDIA_FIELDS, limit: 50 }, "media")).data ?? [];
      await api.ingest({ posts: toBatch({ conversations: [], media, comments: [] }, igUserId, repliesState, now).posts });
    }
    const stored = (await api.posts({ platform: "instagram", limit: 50 })).items;
    const scan = await env.SOCIAL_KV.get("inbox:scan");
    const forced = !!scan && scan > ((await api.getMeta("ig:lastScan")) ?? "");
    const cursor = forced ? 0 : Number((await api.getMeta("ig:postCursor")) ?? "0") % Math.max(stored.length, 1);
    const targets = stored.length ? Array.from({ length: Math.min(POSTS_PER_TICK, stored.length) }, (_, i) => stored[(cursor + i) % stored.length]) : [];
    const comments = [];
    for (const p of targets) comments.push({ postId: p.id, rows: (await get<{ data?: IgComment[] } & MetaError>(`${IG_API}/${p.id}/comments`, { fields: COMMENT_FIELDS, limit: 50 }, "comments")).data ?? [] });
    const batch = toBatch({ conversations: convs.data ?? [], media: [], comments }, igUserId, repliesState, now);
    await api.ingest(batch);
    await api.setMeta("ig:tick", String(tick + 1));
    await api.setMeta("ig:postCursor", String((cursor + targets.length) % Math.max(stored.length, 1)));
    if (forced) await api.setMeta("ig:lastScan", scan!);
    await api.retain(now.toISOString());
    return { calls, conversations: batch.conversations!.length, posts: media.length, comments: batch.comments!.length };
  } catch (e) {
    return { calls, conversations: 0, posts: 0, comments: 0, error: toReplyCode(e).code };
  }
}
```

`cron.ts:88`, the off-grid branch, becomes:

```ts
if (new Date(scheduledTime).getUTCMinutes() % 5 !== 0) {
  const replies = await pollReplies(env, { fetch: deps.fetch, now, fiveMinuteTick: false });
  const inbox = await readInboxTick(env, { fetch: deps.fetch, now: () => now });
  return { replies, inbox };
}
```

and `TickResult` gains `inbox?: InboxReadResult`.

- [ ] **Step 4: Run the reader and cron tests, the Worker gates**

Run: `NODE_OPTIONS=--experimental-sqlite pnpm --filter 3z-scout exec vitest run src/social/inboxReader.test.ts src/social/cron.test.ts && pnpm typecheck:worker && pnpm lint`
Expected: PASS (if `cron.test.ts` asserts the off-grid return shape exactly, extend its expectation with `inbox: { skipped: "no_store" }`).

- [ ] **Step 5: Commit**

```bash
git add workers/scout/src/social/inboxReader.ts workers/scout/src/social/inboxReader.test.ts workers/scout/src/social/cron.ts workers/scout/src/social/replies.ts workers/scout/src/social/cron.test.ts
git commit -m "Inbox step B: the every-minute reader fills InboxStore within the subrequest budget"
```

---

### Task 4: Read routes, refresh, wipe (`handleInbox`)

**Files:**
- Create: `workers/scout/src/social/inboxRoutes.ts`
- Test: `workers/scout/src/social/inboxRoutes.test.ts`
- Modify: `workers/scout/src/social/routes.ts:173` (replace the probe dispatch), delete `inboxProbe.ts` + test, `workers/scout/README.md` (contract), `workers/scout/src/scout.ts:494` (`handle` deps gain `inboxApi?: InboxApi`, threaded into `handleSocial`)

**Interfaces:**
- Consumes: `InboxApi`, `inboxApi(env)`, `Store`, `isExpired`.
- Produces: `handleInbox(req, env, rest, store, now, http, reply, deps?: { api?: InboxApi }): Promise<Response | null>` serving:

```
GET  /social/inbox                              → { platforms: { instagram: { connected, canReply, tokenExpired, lastReadAt, newestAt }, tiktok: { connected: false, canReply: false, tokenExpired: false, lastReadAt, newestAt } }, counts }
GET  /social/inbox/conversations?platform=&before= → { conversations, more }
GET  /social/inbox/conversations/:id?before=        → { conversation, messages, more, window: { open: boolean, closesAt } }   (404 { error: "not_found" })
GET  /social/inbox/posts?platform=&before=          → { posts, more }
GET  /social/inbox/posts/:platform/:id/comments?before= → { post, comments, more }
POST /social/inbox/refresh                          → { scanRequestedAt }      (KV put "inbox:scan")
DELETE /social/inbox                                → { ok: true }            (api.wipe())
```

`platform` query: `all` (default) → undefined, `instagram`, `tiktok`; anything else → `bad_request`. Ids must match `/^[A-Za-z0-9_=-]{1,256}$/`. Without the binding every route answers `503 { error: "not_available" }` (add `not_available: 503` to `STATUS` in `routes.ts:59` and to the `SocialErrorCode` union it keys).

- [ ] **Step 1: Write the failing tests** (`inboxRoutes.test.ts`; seed an `InboxDb` over `nodeSql()`, inject it through `deps.inboxApi` of `handle`)

```ts
describe.skipIf(!sql)("/social/inbox routes", () => {
  it("overview reports the connection and store state", async () => {
    const env = makeEnv(); const api = new InboxDb(sql!);
    await connect(env, "instagram", { accessToken: "tok", issuedAt: "2026-10-22T00:00:00Z", canReply: true });
    await api.setMeta("lastReadAt:instagram", "2026-10-22T12:00:00.000Z");
    const res = await handle(req("/social/inbox"), env, undefined, { fetch: mockFetch({}), now: () => new Date(), inboxApi: api });
    expect(await res.json()).toMatchObject({ platforms: { instagram: { connected: true, canReply: true, lastReadAt: "2026-10-22T12:00:00.000Z" }, tiktok: { connected: false } } });
  });
  it("lists conversations, a thread with its window, posts and comments; unknown ids are 404", async () => {
    const env = makeEnv(); const api = new InboxDb(sql!); const now = new Date("2026-10-22T12:00:00Z");
    await api.ingest({ conversations: [{ platform: "instagram", id: "t1", peerId: "9", peerName: "sara", updatedAt: "2026-10-22T10:00:00.000Z", lastText: "hi", lastFrom: "peer", windowClosesAt: "2026-10-22T11:00:00.000Z", answeredBy: null }],
      messages: [{ platform: "instagram", convId: "t1", id: "m1", at: "2026-10-22T10:00:00.000Z", fromPeer: true, text: "hi", kind: "text", sentBy: "peer" }],
      posts: [{ platform: "instagram", id: "p1", permalink: "", thumbUrl: null, caption: "LUT", postedAt: "2026-10-20T00:00:00.000Z", commentCount: 1 }],
      comments: [{ platform: "instagram", postId: "p1", id: "c1", parentId: null, at: "2026-10-21T00:00:00.000Z", author: "ali", authorId: null, text: "لت", hidden: false, ours: false, sentBy: null }] });
    const deps = { fetch: mockFetch({}), now: () => now, inboxApi: api };
    expect(await (await handle(req("/social/inbox/conversations?platform=instagram"), env, undefined, deps)).json()).toMatchObject({ conversations: [{ id: "t1" }], more: false });
    expect(await (await handle(req("/social/inbox/conversations/t1"), env, undefined, deps)).json()).toMatchObject({ messages: [{ id: "m1" }], window: { open: false, closesAt: "2026-10-22T11:00:00.000Z" } });
    expect((await handle(req("/social/inbox/conversations/nope"), env, undefined, deps)).status).toBe(404);
    expect(await (await handle(req("/social/inbox/posts"), env, undefined, deps)).json()).toMatchObject({ posts: [{ id: "p1" }] });
    expect(await (await handle(req("/social/inbox/posts/instagram/p1/comments"), env, undefined, deps)).json()).toMatchObject({ post: { caption: "LUT" }, comments: [{ id: "c1" }] });
  });
  it("refresh writes inbox:scan once and wipe empties the store", async () => {
    const env = makeEnv(); const api = new InboxDb(sql!); const deps = { fetch: mockFetch({}), now: () => new Date("2026-10-22T12:00:00Z"), inboxApi: api };
    expect(await (await handle(req("/social/inbox/refresh", { method: "POST" }), env, undefined, deps)).json()).toEqual({ scanRequestedAt: "2026-10-22T12:00:00.000Z" });
    expect(env.SOCIAL_KV.written).toEqual(["inbox:scan"]);
    await api.ingest({ posts: [{ platform: "instagram", id: "p1", permalink: "", thumbUrl: null, caption: "", postedAt: "2026-10-20T00:00:00.000Z", commentCount: 0 }] });
    expect(await (await handle(req("/social/inbox", { method: "DELETE" }), env, undefined, deps)).json()).toEqual({ ok: true });
    expect((await api.overview()).counts.posts).toBe(0);
  });
  it("answers not_available without the binding and bad_request for a bad platform", async () => {
    const env = makeEnv();
    expect((await handle(req("/social/inbox"), env, undefined, { fetch: mockFetch({}), now: () => new Date() })).status).toBe(503);
    expect((await handle(req("/social/inbox/conversations?platform=x"), env, undefined, { fetch: mockFetch({}), now: () => new Date(), inboxApi: new InboxDb(sql!) })).status).toBe(400);
  });
});
```

(`req(path, { method })`: extend the copied helper to accept a method.)

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-sqlite pnpm --filter 3z-scout exec vitest run src/social/inboxRoutes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `inboxRoutes.ts`** (reads only; sends come in Task 8)

```ts
// workers/scout/src/social/inboxRoutes.ts
import { type InboxApi, type InboxPlatform } from "./inboxDb";
import { inboxApi } from "./inboxStore";
import { isExpired } from "./oauth";
import type { Http } from "./http";
import type { Store, SocialEnv } from "./store";

export interface InboxReply { json: (body: unknown, status?: number) => Response; fail: (e: "not_configured" | "bad_request" | "not_available") => Response }
const ID = /^[A-Za-z0-9_=-]{1,256}$/;
const platformOf = (v: string | null): InboxPlatform | undefined | "bad" => (v === null || v === "all" ? undefined : v === "instagram" || v === "tiktok" ? v : "bad");

export async function handleInbox(req: Request, env: SocialEnv, rest: string[], store: Store | null, now: Date, http: Http, reply: InboxReply,
  deps: { api?: InboxApi } = {}): Promise<Response | null> {
  const api = deps.api ?? inboxApi(env);
  if (!api) return reply.fail("not_available");
  if (!store) return reply.fail("not_configured");
  const url = new URL(req.url); const before = url.searchParams.get("before") ?? undefined;
  const [a, b, c, d] = rest;
  if (rest.length === 0 && req.method === "GET") {
    const ig = await store.getTokens("instagram"); const o = await api.overview();
    const platform = (p: InboxPlatform, t: typeof ig) => ({ connected: !!t, canReply: !!t?.canReply, tokenExpired: !!t && isExpired(t, now), ...o.platforms[p] });
    return reply.json({ platforms: { instagram: platform("instagram", ig), tiktok: platform("tiktok", null) }, counts: o.counts });
  }
  if (rest.length === 0 && req.method === "DELETE") { await api.wipe(); return reply.json({ ok: true }); }
  if (a === "refresh" && rest.length === 1 && req.method === "POST") {
    const at = now.toISOString(); await env.SOCIAL_KV.put("inbox:scan", at, { expirationTtl: 3600 }); return reply.json({ scanRequestedAt: at });
  }
  if (req.method !== "GET") return null;
  if (a === "conversations" && rest.length === 1) {
    const p = platformOf(url.searchParams.get("platform")); if (p === "bad") return reply.fail("bad_request");
    const page = await api.conversations({ platform: p, before }); return reply.json({ conversations: page.items, more: page.more });
  }
  if (a === "conversations" && rest.length === 2 && ID.test(b)) {
    const t = await api.thread("instagram", b, { before }); if (!t) return reply.json({ error: "not_found" }, 404);
    const closesAt = t.conversation.windowClosesAt;
    return reply.json({ conversation: t.conversation, messages: t.messages.items, more: t.messages.more, window: { open: !!closesAt && closesAt > now.toISOString(), closesAt } });
  }
  if (a === "posts" && rest.length === 1) {
    const p = platformOf(url.searchParams.get("platform")); if (p === "bad") return reply.fail("bad_request");
    const page = await api.posts({ platform: p, before }); return reply.json({ posts: page.items, more: page.more });
  }
  if (a === "posts" && rest.length === 4 && d === "comments" && (b === "instagram" || b === "tiktok") && ID.test(c)) {
    const r = await api.comments(b, c, { before }); if (!r) return reply.json({ error: "not_found" }, 404);
    return reply.json({ post: r.post, comments: r.comments.items, more: r.comments.more });
  }
  return null;
}
```

Dispatch in `routes.ts` (replacing Task 1's block): `if (action === "inbox") return handleInbox(req, env, socialPath(pathname).slice(1), store, now, deps.fetch, { json: (b, s) => json(b, s ?? 200, cors), fail: (e) => fail(e, cors) }, { api: deps.inboxApi });` and thread `deps.inboxApi` from `handle` → `handleSocial`.

- [ ] **Step 4: Gates, README, commit**

Run: `NODE_OPTIONS=--experimental-sqlite pnpm test && pnpm typecheck:worker && pnpm lint`
Expected: PASS. Replace the README's probe line with the route table above.

```bash
git rm workers/scout/src/social/inboxProbe.ts workers/scout/src/social/inboxProbe.test.ts
git add workers/scout/src/social/inboxRoutes.ts workers/scout/src/social/inboxRoutes.test.ts workers/scout/src/social/routes.ts workers/scout/src/scout.ts workers/scout/README.md
git commit -m "Inbox step B: /social/inbox read routes, Refresh and wipe"
```

---

### Task 5: Dashboard client, schemas, store slice and copy

**Files:**
- Create: `lib/inbox.ts`, `lib/inbox.test.ts`, `messages/inbox.ar.json`, `messages/inbox.en.json`
- Modify: `lib/domain.ts` (after the auto-reply schemas, ~`:584`), `store/index.ts` (schema `:224` area, initial data, `pick`, actions), `store/index.test.ts`, `lib/i18n.ts` (`:26-27`, `:68`, `:94`, `:115` pattern), `messages/ar.json` + `en.json` (`nav.inbox`)

**Interfaces:**
- Produces (used by Tasks 6, 7, 9):

```ts
// lib/domain.ts
export const INBOX_PLATFORMS = ["instagram", "tiktok"] as const; export const InboxPlatformSchema = z.enum(INBOX_PLATFORMS); export type InboxPlatform = z.infer<typeof InboxPlatformSchema>;
export const InboxConversationSchema = z.object({ platform: InboxPlatformSchema, id: z.string(), peerId: z.string(), peerName: z.string(), updatedAt: z.string(),
  lastText: z.string(), lastFrom: z.enum(["peer", "owner", "auto"]), windowClosesAt: z.string().nullable(), answeredBy: z.enum(["auto"]).nullable() });
export const InboxMessageSchema = z.object({ platform: InboxPlatformSchema, convId: z.string(), id: z.string(), at: z.string(), fromPeer: z.boolean(), text: z.string(),
  kind: z.enum(["text", "story", "share", "unsupported"]), sentBy: z.enum(["peer", "owner", "auto"]) });
export const InboxPostSchema = z.object({ platform: InboxPlatformSchema, id: z.string(), permalink: z.string(), thumbUrl: z.string().nullable(), caption: z.string(), postedAt: z.string(), commentCount: z.number().int() });
export const InboxCommentSchema = z.object({ platform: InboxPlatformSchema, postId: z.string(), id: z.string(), parentId: z.string().nullable(), at: z.string(), author: z.string(),
  authorId: z.string().nullable(), text: z.string(), hidden: z.boolean(), ours: z.boolean(), sentBy: z.enum(["owner", "auto"]).nullable() });
export const InboxOverviewSchema = z.object({ platforms: z.record(InboxPlatformSchema, z.object({ connected: z.boolean(), canReply: z.boolean(), tokenExpired: z.boolean(),
  lastReadAt: z.string().nullable(), newestAt: z.string().nullable() })), counts: z.object({ conversations: z.number(), posts: z.number(), comments: z.number() }) });
// + the inferred types InboxConversation, InboxMessage, InboxPost, InboxComment, InboxOverview

// lib/inbox.ts
export const DM_TEXT_BYTES = 1000; export const IG_COMMENT_MAX = 2200; export const TT_COMMENT_MAX = 150;
export const INBOX_POLL_MS = 15_000;
export type InboxError = { type: SocialSyncErrorType | "window_closed" | "too_long" | "rejected" | "no_permission" | "not_eligible" | "not_available" | "not_found"; detail?: string };
export type InboxResult<T> = ({ ok: true } & T) | { ok: false; error: InboxError };
export function inboxOverview(config: ScoutConfig): Promise<InboxResult<{ overview: InboxOverview }>>;
export function inboxConversations(config: ScoutConfig, q: { platform?: InboxPlatform | "all"; before?: string }): Promise<InboxResult<{ conversations: InboxConversation[]; more: boolean }>>;
export function inboxThread(config: ScoutConfig, id: string, q: { before?: string }): Promise<InboxResult<{ conversation: InboxConversation; messages: InboxMessage[]; more: boolean; window: { open: boolean; closesAt: string | null } }>>;
export function inboxPosts(config: ScoutConfig, q: { platform?: InboxPlatform | "all"; before?: string }): Promise<InboxResult<{ posts: InboxPost[]; more: boolean }>>;
export function inboxComments(config: ScoutConfig, platform: InboxPlatform, postId: string, q: { before?: string }): Promise<InboxResult<{ post: InboxPost; comments: InboxComment[]; more: boolean }>>;
export function inboxRefresh(config: ScoutConfig): Promise<InboxResult<{ scanRequestedAt: string }>>;
export function inboxWipe(config: ScoutConfig): Promise<InboxResult<{ ok: true }>>;
export function utf8Bytes(s: string): number;
export function seenKey(platform: InboxPlatform, kind: "conversation" | "post", id: string): string;   // `${platform}:${kind}:${id}`
export function unreadCount(items: { key: string; at: string }[], seen: Record<string, string>): number;  // items whose at > seen[key] (or unseen)

// store/index.ts
inboxSeen: z.record(z.string(), z.string()).default({});   // seenKey → ISO of the last open
inboxTab: z.enum(["all", "instagram", "tiktok"]).default("all");
markInboxSeen(key: string, at: string): void;   // keeps the max
setInboxTab(tab: "all" | "instagram" | "tiktok"): void;
```

`lib/inbox.ts` uses its own fetch helper (`inboxCall`) modelled on `lib/socialSync.ts:140-162` `call`, but keeps the body's `error` and `detail` for every non-OK answer (the inbox codes are not in `MESSAGE_KEYS`): 401 → `auth`, 429 → `rate_limited`, else `{ type: body.error ?? "upstream", detail: body.detail }`; network throw → `network`; missing config → `unconfigured`.

Copy keys (both files, same keys; Arabic values Hijazi): `inbox.title` ("الرسائل" / "Inbox"), `inbox.sub`, `inbox.tab.all`, `inbox.tab.instagram`, `inbox.tab.tiktok`, `inbox.tab.soon`, `inbox.section.messages`, `inbox.section.comments`, `inbox.refresh`, `inbox.lastRead` ("آخر تحديث {ago}"), `inbox.unread` ("{n} جديد"), `inbox.empty.messages`, `inbox.empty.comments`, `inbox.needWorker`, `inbox.needWorkerLink`, `inbox.needIg`, `inbox.needPermission`, `inbox.allow` (button, reuse the replies connect flow), `inbox.tokenExpired`, `inbox.notAvailable` ("الوركر القديم ما فيه الرسائل بعد؛ انتظر التحديث"), `inbox.tiktok.noDm` ("رسائل تيك توك ما تتوفر للحسابات الشخصية"), `inbox.tiktok.openDm` ("افتح رسائل تيك توك ↗"), `inbox.tiktok.soon` ("تعليقات تيك توك بعد موافقة تيك توك"), `inbox.thread.you`, `inbox.thread.auto` ("رد تلقائي"), `inbox.thread.story`, `inbox.thread.share`, `inbox.thread.unsupported`, `inbox.window.closed` ("إنستقرام قفل النافذة؛ لازم الشخص يكتب أول"), `inbox.window.closesIn` ("تقدر ترد لين {time}"), `inbox.comments.count` ("{n} تعليق"), `inbox.comments.new` ("{n} جديد"), `inbox.comments.untitled` ("منشور بدون كابشن"), `inbox.comments.openPost` ("افتح المنشور ↗"), `inbox.reply`, `inbox.replyPrivately`, `inbox.hide`, `inbox.unhide`, `inbox.hidden` ("مخفي"), `inbox.delete`, `inbox.deleteConfirm`, `inbox.send`, `inbox.sending`, `inbox.sent`, `inbox.unconfirmed` ("ما تأكد الإرسال؛ شيّك في التطبيق"), `inbox.left` ("باقي {n}"), `inbox.tooLong`, `inbox.loadOlder`, `inbox.err.rejected` ("المنصة رفضت: {detail}"), `inbox.err.noPermission`, `inbox.err.notEligible` ("ما نقدر نراسل هذا الشخص"), `inbox.err.rateLimited`, `inbox.err.upstream`, `inbox.err.network`, `inbox.studio.row` ("{n} رسالة وتعليق جديد"), `inbox.settings.wipe` ("احذف مخزن الرسائل"), `inbox.settings.wipeConfirm`, `inbox.settings.wiped`. Base files: `nav.inbox` = "الرسائل" / "Inbox".

- [ ] **Step 1: Write the failing tests**

`lib/inbox.test.ts` (pattern: `lib/replies.test.ts` if it exists, else `lib/socialSync.test.ts`): mock `globalThis.fetch`; assert `inboxOverview` parses a valid body, returns `{ ok: false, error: { type: "upstream" } }` on a bad body, keeps `detail` on `{ error: "rejected", detail: "x" }` 502, maps 401 → `auth`; `utf8Bytes("لت")` is 4; `unreadCount` counts unseen and newer items only. `store/index.test.ts`: `markInboxSeen` keeps the later time and persists; `setInboxTab` persists; `exportState` includes both. `messages/messages.test.ts` runs as is (parity).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run lib/inbox.test.ts store/index.test.ts messages`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** the schemas, the client, the store slice (follow `customGenres`: schema `:224`, initial `:518`, `pick` `:568`, interface `:434`, implementation `:1482`), the two message files, the four i18n registration spots, `nav.inbox` in `ar.json`/`en.json`.

- [ ] **Step 4: Run the tests and gates**

Run: `pnpm vitest run lib/inbox.test.ts store/index.test.ts messages && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/inbox.ts lib/inbox.test.ts lib/domain.ts store/index.ts store/index.test.ts lib/i18n.ts messages/inbox.ar.json messages/inbox.en.json messages/ar.json messages/en.json
git commit -m "Inbox step C: client, schemas, seen marks and copy"
```

---

### Task 6: The Inbox page (read-only), navigation, Studio row

**Files:**
- Create: `components/social/inbox/useInbox.ts`, `InboxScreen.tsx`, `ConversationList.tsx`, `ThreadView.tsx`, `PostList.tsx`, `CommentsView.tsx`, `app/social/inbox/page.tsx`
- Test: `components/social/inbox/InboxScreen.test.tsx` (render pattern: `components/social/trends/TrendRadar.test.ts`), `components/shell/nav.test.ts`
- Modify: `components/shell/nav.ts:54-92` (insert before `/social/automations`: `{ href: "/social/inbox", icon: "📥", lucide: Inbox, label: "nav.inbox", desktopOnly: true }`), `components/shell/MoreScreen.tsx:106` (a `ListRow` for the inbox after the replies row, `testId="more-inbox"`), `components/social/studio/InboxCard.tsx` (new row kind `"messages"` fed by `useInbox`'s unread total; only when the Worker is configured; errors silent), `components/shell/nav.test.ts:8-20` (`SOCIAL_PATHS` + `/social/inbox/`), `e2e/world.spec.ts:4-14`, `e2e/social-look.spec.ts` (path arrays)

**Interfaces:**
- Consumes: Task 5's client and store; `Segmented`, `ListGroup`, `ListRow`, `Chip`, `EmptyState`, `PageHeader`, `PlatformBadge`, `Sheet` (`components/ui/ios/`); `connect("instagram", true, true)` from `useSocialSync` for the permission button.
- Produces: `useInbox()` (module-level external store like `useReplies.ts`):

```ts
export interface InboxState { overview: InboxOverview | null; conversations: InboxConversation[]; posts: InboxPost[]; moreConversations: boolean; morePosts: boolean;
  loadedAt: number | null; busy: boolean; error: InboxError | null }
export function useInbox(): InboxState & { configured: boolean };
export async function loadInbox(opts?: { quiet?: boolean }): Promise<void>;   // overview + first pages (3 calls)
export async function loadMoreConversations(): Promise<void>; export async function loadMorePosts(): Promise<void>;
export async function refreshInbox(): Promise<void>;                         // POST refresh, then loadInbox after 3 s
export function useInboxPoll(enabled: boolean): void;                        // setInterval INBOX_POLL_MS while document.visibilityState === "visible"; one load on visibilitychange
export function useThread(id: string | null): { thread: ThreadData | null; busy: boolean; error: InboxError | null; reload(): void };
export function useComments(platform: InboxPlatform | null, postId: string | null): { data: CommentsData | null; busy: boolean; error: InboxError | null; reload(): void };
```

Screen structure (`InboxScreen.tsx`): `PageHeader` (title, sub, trailing Refresh button `inbox-refresh` + "last read {ago}"), `Segmented` tabs `inbox-tab` (`all`, `instagram`, `tiktok`; the tab in `store.inboxTab`), then two `ListGroup`s: Messages (`inbox-messages`) and Comments (`inbox-comments`). Rows: conversation → `ListRow` with `PlatformBadge` icon, `title=peerName`, `sub=lastText` (prefixed "أنت: " / "رد تلقائي: " for owner/auto), trailing `Chip` "جديد" when `updatedAt > inboxSeen[key]`, `onClick` opens `ThreadView` in a `Sheet` (`inbox-thread`) and calls `markInboxSeen(key, updatedAt)`; post → `ListRow` with the thumbnail as `iconRaw`, `title=caption || t("inbox.comments.untitled")`, `sub` "{n} تعليق · {m} جديد", opens `CommentsView` in a `Sheet` (`inbox-post`). Tab `tiktok`: Messages group shows `inbox.tiktok.noDm` + the `inbox.tiktok.openDm` link (`href="https://www.tiktok.com/messages" target="_blank" rel="noopener noreferrer"`), Comments group shows `inbox.tiktok.soon`. Tab `all`: both platforms' rows merged newest first, each with its badge. States: not configured → `EmptyState` with the Settings link; `overview.platforms.instagram.connected === false` → `inbox.needIg` + connect button; `canReply === false` → `inbox.needPermission` + `inbox.allow`; `error.type === "not_available"` → `inbox.notAvailable`. `ThreadView`: messages oldest first; peer left / ours right (`dir`-aware: use `self-start`/`self-end`), auto ones with a `Chip` "رد تلقائي"; placeholders for `story`/`share`/`unsupported`; "Load older" at the top. `CommentsView`: comments newest first with replies indented under their parent; hidden ones dimmed with `inbox.hidden`; `inbox.comments.openPost` link to `permalink`. (Reply boxes come in Task 9; leave a `ReplyBox` slot.)

Studio: in `InboxCard.tsx` add a row kind `"messages"` with icon `📥`, label `inbox.studio.row` `{n}` = `unreadCount` over the loaded conversations + posts (a post counts as new when its `postedAt` is newer than its seen mark), `href="/social/inbox"`; the card calls `loadInbox({ quiet: true })` once when configured; a failed load (older Worker → 400/503) renders no row.

- [ ] **Step 1: Write the failing tests**: `InboxScreen.test.tsx` renders with a fake `fetch` returning an overview + one conversation + one post: asserts the tab buttons, the two rows, the "جديد" chip, that opening a conversation calls `markInboxSeen`, the TikTok tab's link, the not-connected state, and that no `fetch` happens when the Worker is not configured. `nav.test.ts`: the new item sits before `/social/automations`, `desktopOnly`, has `lucide`; `SOCIAL_PATHS` includes `/social/inbox/`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run components/social/inbox components/shell/nav.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the hook, the components, the page (`metadata.title = "الرسائل · 3z Prod"`), nav, More row, Studio row, path lists.

- [ ] **Step 4: Run tests and gates**

Run: `pnpm vitest run components/social/inbox components/shell components/social/studio && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS; `/social/inbox/` prerenders.

- [ ] **Step 5: Commit**

```bash
git add components/social/inbox app/social/inbox components/shell/nav.ts components/shell/nav.test.ts components/shell/MoreScreen.tsx components/social/studio/InboxCard.tsx e2e/world.spec.ts e2e/social-look.spec.ts
git commit -m "Inbox step C: the Inbox page (read), navigation and the Studio row"
```

---

### Task 7: Browser proof of the read page

**Files:**
- Create: `e2e/inbox.spec.ts`

**Interfaces:** consumes the test ids of Task 6 (`inbox-tab`, `inbox-messages`, `inbox-comments`, `inbox-thread`, `inbox-post`, `inbox-refresh`, `more-inbox`), the Settings ids (`apikey-scoutUrl-input`, `apikey-scoutToken-input`, `apikey-scoutToken-test`, status text "اتأكد ✓").

- [ ] **Step 1: Write the spec** (stub pattern from `e2e/autoreplies.spec.ts:53-179`: `WORKER = "https://scout.test"`, CORS, 401 on a bad bearer, `/health`, `/social/status`, `/social/data`, `/social/publish`, `/social/replies` GET → a minimal doc, plus the inbox routes answering fixtures; fallthrough 400). Cases: (a) phone AR: the page opens from More → Inbox, shows 1 conversation and 1 post, "جديد" chip disappears after opening the thread and survives a reload (store), the thread shows peer/auto bubbles; (b) desktop EN (`switchLang(page, "en")`): sidebar entry, tabs switch and persist across reload, TikTok tab shows the messages link and "soon"; (c) Refresh posts `/social/inbox/refresh` once and the page re-reads; (d) no Worker configured → the Settings link, zero requests; (e) `fitsViewport` on both.

- [ ] **Step 2: Run on both projects**

Run: `E2E_PORT=3111 pnpm e2e e2e/inbox.spec.ts e2e/world.spec.ts e2e/social-look.spec.ts e2e/studio.spec.ts`
Expected: PASS phone + desktop (the Studio spec proves the silent 400 on the old stub).

- [ ] **Step 3: Commit**

```bash
git add e2e/inbox.spec.ts
git commit -m "Inbox step C: browser proof of the read page"
```

---

### Task 8: Worker sends: DM, public reply, private reply, hide, delete

**Files:**
- Modify: `workers/scout/src/social/replyCore.ts` (`ReplyErrorCode` + `window_closed` | `too_long`; `IG_COMMENT_MAX = 2200`; `toReplyCode` maps code 10 / subcode 2534022 to `window_closed` instead of `not_eligible` when the caller passes `{ dm: true }`: add an optional second argument `toReplyCode(e, ctx?: { dm?: boolean })`), `workers/scout/src/social/inboxRoutes.ts` (+ tests), `workers/scout/src/social/routes.ts:59` (`STATUS`: `window_closed: 409`, `too_long: 400`), `workers/scout/README.md`
- Test: `workers/scout/src/social/inboxRoutes.test.ts`, `replyCore.test.ts`

**Interfaces:**
- Consumes: `sendReply(t, recipient, text, [])` (`replyCore.ts:272`), `igUserIdOf`, `InboxApi.recordSend/ingest/setHidden/deleteComment`, `utf8Bytes`.
- Produces the routes:

```
POST /social/inbox/conversations/:id/send      { text } → 200 { message: MessageRow }   | 409 { error: "window_closed" } | 400 { error: "too_long" } | 502 { error, detail }
POST /social/inbox/comments/instagram/:id/reply   { text } → 200 { reply: CommentRow }
POST /social/inbox/comments/instagram/:id/private { text } → 200 { message: { id } }
POST /social/inbox/comments/instagram/:id/hide    { hidden } → 200 { ok: true }
DELETE /social/inbox/comments/instagram/:id                  → 200 { ok: true }   (only when the stored row has ours = true; else 403 { error: "no_permission" })
```

Graph calls: DM `sendReply(target, { id: conversation.peerId }, text, [])`; public reply `POST ${IG_API}/${commentId}/replies` form `message=<text>&access_token=<token>` → `{ id }`; private reply `sendReply(target, { comment_id: commentId }, text, [])`; hide `POST ${IG_API}/${commentId}?hide=true|false&access_token=`; delete `DELETE ${IG_API}/${commentId}?access_token=`. Checks before any call: text trimmed non-empty; DM `utf8Bytes(text) <= DM_TEXT_BYTES`, comment `text.length <= IG_COMMENT_MAX`; DM window: `conversation.windowClosesAt` null or past → `window_closed` without a call. After a success: `recordSend({ state: "sent", platformId })` and `ingest` the new row (`MessageRow` with `sentBy: "owner"`, `fromPeer: false`; the conversation's `lastText/lastFrom/updatedAt`; or a `CommentRow` with `parentId: commentId`, `ours: true`, `sentBy: "owner"`). A Graph throw → `recordSend({ state: "refused", detail })` and `{ error: code, detail }` with `STATUS[code]`; a network throw or a 200 without an id → `recordSend({ state: "unconfirmed" })` and `502 { error: "upstream", detail: "unconfirmed" }`.

- [ ] **Step 1: Write the failing tests** (in `inboxRoutes.test.ts`): send DM happy path asserts the Graph body `{ recipient: { id: "9" }, message: { text: "hi" } }` and the stored message; window closed → 409 and no Graph call; too long (1,001 bytes) → 400; public reply asserts the form body and the stored reply row with `parentId`; private reply asserts `{ recipient: { comment_id: "c1" } }`; hide asserts `hide=true`; delete of a non-ours row → 403; a Graph error `{ error: { code: 10, error_subcode: 2534022 } }` on a DM → 409 `window_closed`; a thrown fetch → 502 `upstream`/`unconfirmed` with the send recorded `unconfirmed`. `replyCore.test.ts`: `toReplyCode(err10_2534022, { dm: true }).code === "window_closed"`.

- [ ] **Step 2: Run to verify they fail**; **Step 3: implement**; **Step 4:** `NODE_OPTIONS=--experimental-sqlite pnpm test && pnpm typecheck:worker && pnpm lint` → PASS; README route table extended.

- [ ] **Step 5: Commit**

```bash
git add workers/scout/src/social/replyCore.ts workers/scout/src/social/replyCore.test.ts workers/scout/src/social/inboxRoutes.ts workers/scout/src/social/inboxRoutes.test.ts workers/scout/src/social/routes.ts workers/scout/README.md
git commit -m "Inbox step D: DM, public reply, private reply, hide and delete through the Worker"
```

---

### Task 9: Dashboard sending: `ReplyBox`, client sends, e2e

**Files:**
- Create: `components/social/inbox/ReplyBox.tsx`, `components/social/inbox/ReplyBox.test.tsx`
- Modify: `lib/inbox.ts` (+ test): `inboxSend(config, id, text)`, `inboxReply(config, platform, commentId, text)`, `inboxPrivate(config, commentId, text)`, `inboxHide(config, platform, commentId, hidden)`, `inboxDelete(config, platform, commentId)`; `ThreadView.tsx`, `CommentsView.tsx` (mount the box; per-comment menu); `e2e/inbox.spec.ts`

**Interfaces:** `ReplyBox({ kind: "dm" | "comment" | "private", platform, limit: { bytes?: number; chars?: number }, disabled?: boolean, disabledReason?: string, onSend(text): Promise<InboxResult<unknown>>, testId })`: a textarea (`${testId}-text`), the live counter `inbox.left` (bytes for `dm`, chars otherwise; red at 0; Send disabled over the limit or empty), Send (`${testId}-send`) locked while the promise is pending, a result line (`${testId}-result`): sent → clears the box; `unconfirmed` → `inbox.unconfirmed`; refused → `inbox.err.*` with `{detail}`. `ThreadView` passes `disabled` + `inbox.window.closed` when `window.open` is false, `inbox.window.closesIn` otherwise; after a sent DM it reloads the thread. `CommentsView`: under each comment a Reply toggle opening a `ReplyBox` (`kind: "comment"`), on Instagram a "Reply privately" toggle (`kind: "private"`), a `⋯` menu with Hide/Unhide and, on `ours` rows, Delete behind `ConfirmDialog` (`components/ui/ConfirmDialog`); after any action it reloads.

- [ ] **Step 1: Failing tests**: `ReplyBox.test.tsx` (counter for 4-byte Arabic letters, lock during a pending promise, the three result lines, the disabled reason); `lib/inbox.test.ts` additions (send maps `{ error: "window_closed" }` 409 to `type: "window_closed"`); e2e cases: reply to a DM (asserts the stubbed POST body), closed-window state, reply + private reply + hide on a comment, delete only on own reply, the counter refuses over-limit text.

- [ ] **Step 2: Run to verify they fail**; **Step 3: implement**; **Step 4:** `pnpm vitest run components/social/inbox lib/inbox.test.ts && pnpm lint && pnpm typecheck && pnpm build && E2E_PORT=3111 pnpm e2e e2e/inbox.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/social/inbox lib/inbox.ts lib/inbox.test.ts e2e/inbox.spec.ts
git commit -m "Inbox step D: reply boxes, hide and delete from the dashboard"
```

**CHECKPOINT (owner):** PR for Tasks 2–9, the full gates, the owner merges; the Worker deploys (the `v1-inbox` migration runs with it). Then the live test: a friend DMs @3z.prod and comments on a post; the owner replies to both from `/social/inbox/`; the replies are confirmed in the Instagram app; "Reply privately" once; Hide once. Record the outcome in `planning/tools/51-global-inbox.md` ("Live test, date").

---

### Task 10: Privacy pages and "Delete inbox store" in Settings

**Files:**
- Modify: `public/privacy/index.html` (AR `:89-96` area, EN `:177-184` area: one new `<li>` each), `public/data-deletion/index.html` (AR `:53-56`, EN `:88-94`: the "about a day" sentence gains "and the latest conversations and comments about 30 days"), `components/settings/SettingsScreen.tsx` (a "Delete inbox store" button under the connected accounts, `ConfirmDialog`, calls `inboxWipe`, toast `inbox.settings.wiped`), the nearest settings test, `e2e/legal.spec.ts` (if it asserts the list lengths), `e2e/settings.spec.ts` (the button posts `DELETE /social/inbox` once)

- [ ] **Step 1: Failing tests** (settings component/e2e). **Step 2: run, fail.** **Step 3: implement** (AR line: "آخر محادثاتك وتعليقاتك معنا (الاسم والنص والوقت): حوالي 30 يوم، عشان نقراها ونرد عليك من لوحة التحكم؛ تقدر تطلب حذفها من صفحة حذف البيانات." EN: "The latest conversations and comments with us (name, text, time): about 30 days, so we can read and answer them from the dashboard; deletion on request, see the data deletion page."). **Step 4:** `pnpm lint && pnpm typecheck && pnpm build && E2E_PORT=3111 pnpm e2e e2e/settings.spec.ts e2e/legal.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/privacy/index.html public/data-deletion/index.html components/settings e2e/settings.spec.ts e2e/legal.spec.ts
git commit -m "Inbox step D: privacy wording for the 30-day store and a Delete inbox store button"
```

---

### Task 11: Step E, Instagram webhooks

**Files:**
- Create: `workers/scout/src/social/webhooks.ts`, `workers/scout/src/social/webhooks.test.ts`
- Modify: `workers/scout/src/scout.ts` (before `:532`: `const hook = await handleWebhooks(req, env, deps); if (hook) return hook;`), `workers/scout/src/social/store.ts` (`SocialEnv` + `META_VERIFY_TOKEN?: string`), `workers/scout/wrangler.jsonc` (secrets comment: `META_VERIFY_TOKEN`), `workers/scout/README.md`

**Interfaces:**
- Consumes: `env.META_APP_SECRET`, `env.META_VERIFY_TOKEN`, `inboxApi(env)`, `LOG_TEXT_CLIP`, `WINDOW_MS`.
- Produces: `handleWebhooks(req, env, deps: { now?: () => Date; api?: InboxApi }): Promise<Response | null>` and `webhookToBatch(payload, now): IngestBatch`:
  - `GET /webhooks/instagram?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y` → `200 Y` (text) when `X === env.META_VERIFY_TOKEN`, else `403`.
  - `POST /webhooks/instagram` with header `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body with META_APP_SECRET>` → verify with `crypto.subtle` (compare equal-length hex strings character by character, no early exit), parse `{ object: "instagram", entry: [{ id: <igUserId>, time, messaging?: [{ sender: { id }, recipient: { id }, timestamp, message?: { mid, text?, is_unsupported? } }], changes?: [{ field: "comments", value: { id, text, from: { id, username }, media: { id }, parent_id?, timestamp? } }] }] }` → `IngestBatch` (a message from a sender ≠ entry.id → `MessageRow` `{ fromPeer: true, sentBy: "peer", kind by text/is_unsupported, convId: "peer:" + senderId }` plus a conversation upsert `{ id: "peer:" + senderId, peerId: senderId, peerName: "?", updatedAt, lastText, lastFrom: "peer", windowClosesAt: timestamp + WINDOW_MS }`; the next reader tick upserts the real thread id and the dashboard merges by `peerId`; a comment → `CommentRow` under `media.id` with `hidden: false`, and if the post is unknown a placeholder `PostRow { caption: "", permalink: "", thumbUrl: null, postedAt: now, commentCount: 0 }`), `api.ingest`, `200 { received: n }`; bad or missing signature → `401` and `api.setMeta("webhook:rejected", String(n + 1))`; unknown object → `200 { received: 0 }`.
  - Anything else → `null`.

- [ ] **Step 1: Write the failing tests**: verify handshake ok/forbidden; a signed messaging payload creates the message and the provisional conversation (`lastFrom: "peer"`, `windowClosesAt` = timestamp + 24 h); a signed comment payload creates the comment under its post (post missing → still stored, with the placeholder post); a wrong signature → 401 and the counter; the routes need no bearer (no `Authorization` header in the test request) and sit before the bearer check.

- [ ] **Step 2: Run to verify they fail**; **Step 3: implement** (HMAC with `crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])`, `crypto.subtle.sign`, hex compare); **Step 4:** `NODE_OPTIONS=--experimental-sqlite pnpm test && pnpm typecheck:worker && pnpm lint` → PASS. README: the two routes, the secret, and the Meta dashboard steps (object `instagram`, fields `messages`, `comments`, callback `https://3z-scout.3zmd95.workers.dev/webhooks/instagram`).

- [ ] **Step 5: Commit**

```bash
git add workers/scout/src/social/webhooks.ts workers/scout/src/social/webhooks.test.ts workers/scout/src/scout.ts workers/scout/src/social/store.ts workers/scout/wrangler.jsonc workers/scout/README.md
git commit -m "Inbox step E: Instagram webhooks (verify, signed events) write InboxStore"
```

**CHECKPOINT (owner):** PR, merge, deploy. The owner adds the secret `META_VERIFY_TOKEN` in Cloudflare (any long random string) and, in the Meta app, sets the Instagram webhook callback + verify token, subscribes `messages` and `comments`. Meta's App Review for Advanced Access (`instagram_business_manage_messages`, `instagram_business_manage_comments`) with the inbox screencast; after approval, Publish → Live. Until then the reader keeps the page fresh every minute.

---

## Self-review (planner)

- Spec coverage: screen (Tasks 6, 9), All/Instagram/TikTok tabs with the TikTok link (6), store (2), reader + budget + rotation (3), 15-s refresh + Refresh button (6, 4), retention 200/50/30 (2), sends + limits + lock + unconfirmed (8, 9), hide/delete (8, 9), auto marks (3), webhooks + signature (11), privacy + wipe (10, 4), Studio count (6), paperwork (checkpoints). Steps F/G: a later plan, by design.
- Open items carried, not blockers: `igUserIdOf` may already exist under another name in `replies.ts` (Task 1 Step 3 names the grep); `cron.test.ts` may assert the off-grid shape (Task 3 Step 4); CI Node 22 needs the sqlite flag (Task 2 Step 5).
- Type consistency: `InboxApi`, `IngestBatch`, the row types and `inboxApi()` are defined once in Task 2 and used by name in 3, 4, 8, 11; the dashboard schemas mirror the row fields one to one (Task 5).
