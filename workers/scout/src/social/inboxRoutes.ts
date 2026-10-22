/**
 * `/social/inbox/*` (planning/tools/51-global-inbox.md): the dashboard's reads of the global inbox store
 * (inboxStore.ts, filled by the every-minute reader), Refresh and wipe, and the five sends: a DM, a public reply, a
 * private reply, hide/unhide and delete.
 *
 * Every list answers `next` beside `more`: the store's opaque cursor. The dashboard hands it back as `before`,
 * which is passed to the store unchanged. A store or KV failure answers `upstream` (JSON, CORS headers kept).
 *
 * A send asks Instagram last. Before any call it checks the text, the stored conversation or comment, a DM's 24-hour
 * window and the token; then it makes one Graph call (plus `/me` for the account id, when the send needs it) and
 * writes what Instagram confirmed into the store. A send that fails after Instagram took it (the store is down) still
 * answers as sent, so the owner does not send it twice; the reader brings it into the store on its next read.
 */

import { fetchJson, formPost, withQuery, type Http } from "./http";
import {
  type CommentRow,
  type InboxApi,
  type InboxPlatform,
  type MessageRow,
  type SendRow,
} from "./inboxDb";
import { inboxApi } from "./inboxStore";
import { IG_API } from "./instagram";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { igUserIdOf } from "./replies";
import {
  DM_TEXT_BYTES,
  IG_COMMENT_MAX,
  ReplyError,
  clipLog,
  graph,
  sendReply,
  toReplyCode,
  utf8Bytes,
} from "./replyCore";
import type { SocialEnv, Store } from "./store";
import type { SocialErrorCode } from "./types";

/** The outbound calls one inbox request may make (a send makes two at most: the account id, then the send). */
export const INBOX_ROUTE_BUDGET = 8;

/** KV refuses a second write to a key within a second (429); a refused `inbox:scan` write waits this long, once. */
export const REFRESH_RETRY_MS = 1_100;

export interface InboxReply {
  json: (body: unknown, status?: number) => Response;
  /** `{ error }` with the code's status; `detail` (Instagram's words, never a token) rides along when given. */
  fail: (error: SocialErrorCode, detail?: string) => Response;
}

// The colon and dot let a webhook's provisional `peer:<id>` conversation (webhooks.ts) be opened and answered.
const ID = /^[A-Za-z0-9_=:.-]{1,256}$/;

/** A path segment as the dashboard's encodeURIComponent wrote it ("peer%3Ap1" is "peer:p1"); a bad escape stays and fails ID. */
const decoded = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** `?platform=`: absent or `all` means both; anything but a platform is "bad". */
const platformOf = (v: string | null): InboxPlatform | undefined | "bad" =>
  v === null || v === "all" ? undefined : v === "instagram" || v === "tiktok" ? v : "bad";

/**
 * Answers a `/social/inbox/*` request (`segments` is the path after "inbox"), or returns null when it is not one of
 * ours. `deps.api` is the store; production leaves it out and the Durable Object's stub is used.
 */
export async function handleInbox(
  req: Request,
  env: SocialEnv,
  segments: string[],
  store: Store | null,
  now: Date,
  http: Http,
  reply: InboxReply,
  deps: { api?: InboxApi } = {},
): Promise<Response | null> {
  const api = deps.api ?? inboxApi(env);
  if (!api) return reply.fail("not_available");
  const kv = env.SOCIAL_KV;
  if (!store || !kv) return reply.fail("not_configured");

  const url = new URL(req.url);
  const before = url.searchParams.get("before") ?? undefined;
  const rest = segments.map(decoded);
  const [a, b, c, d] = rest;

  try {
    if (rest.length === 0 && req.method === "GET") {
      const ig = await store.getTokens("instagram");
      const o = await api.overview();
      const platform = (p: InboxPlatform, t: typeof ig) => ({
        connected: !!t,
        canReply: !!t?.canReply,
        tokenExpired: !!t && isExpired(t, now),
        ...o.platforms[p],
      });
      return reply.json({
        platforms: { instagram: platform("instagram", ig), tiktok: platform("tiktok", null) },
        counts: o.counts,
      });
    }
    if (rest.length === 0 && req.method === "DELETE") {
      await api.wipe();
      return reply.json({ ok: true });
    }
    if (a === "refresh" && rest.length === 1 && req.method === "POST") {
      // The reader (inboxReader.ts) reads this key on its next tick and scans everything once.
      const at = now.toISOString();
      const put = () => kv.put("inbox:scan", at, { expirationTtl: 3600 });
      try {
        await put();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_MS));
        await put(); // a second failure is thrown to the catch below: upstream
      }
      return reply.json({ scanRequestedAt: at });
    }
    const send = sendOf(req.method, rest);
    if (send) return await sendToInstagram(send, req, { api, store, now, http, reply });
    if (req.method !== "GET") return null;

    if (a === "conversations" && rest.length === 1) {
      const platform = platformOf(url.searchParams.get("platform"));
      if (platform === "bad") return reply.fail("bad_request");
      const page = await api.conversations({ platform, before });
      return reply.json({ conversations: page.items, more: page.more, next: page.next });
    }
    if (a === "conversations" && rest.length === 2 && ID.test(b)) {
      const thread = await api.thread("instagram", b, { before });
      if (!thread) return reply.json({ error: "not_found" }, 404);
      const closesAt = thread.conversation.windowClosesAt;
      return reply.json({
        conversation: thread.conversation,
        messages: thread.messages.items,
        more: thread.messages.more,
        next: thread.messages.next,
        window: { open: !!closesAt && closesAt > now.toISOString(), closesAt },
      });
    }
    if (a === "posts" && rest.length === 1) {
      const platform = platformOf(url.searchParams.get("platform"));
      if (platform === "bad") return reply.fail("bad_request");
      const page = await api.posts({ platform, before });
      return reply.json({ posts: page.items, more: page.more, next: page.next });
    }
    if (
      a === "posts" &&
      rest.length === 4 &&
      d === "comments" &&
      (b === "instagram" || b === "tiktok") &&
      ID.test(c)
    ) {
      const found = await api.comments(b, c, { before });
      if (!found) return reply.json({ error: "not_found" }, 404);
      return reply.json({
        post: found.post,
        comments: found.comments.items,
        more: found.comments.more,
        next: found.comments.next,
      });
    }
    return null;
  } catch {
    return reply.fail("upstream");
  }
}

/* ---------- sends ---------- */

type Send = { act: "dm" | "reply" | "private" | "hide" | "delete"; id: string };

/**
 * The send a request is, or null when it is none:
 *   POST   conversations/:id/send              a DM
 *   POST   comments/instagram/:id/reply        a public reply under the comment
 *   POST   comments/instagram/:id/private      a private reply (a DM to the commenter, by the comment)
 *   POST   comments/instagram/:id/hide         hide or unhide the comment ({ hidden })
 *   DELETE comments/instagram/:id              delete the owner's own comment
 */
function sendOf(method: string, rest: string[]): Send | null {
  const [a, b, c, d] = rest;
  if (a === "conversations" && rest.length === 3 && c === "send" && method === "POST" && ID.test(b))
    return { act: "dm", id: b };
  if (a !== "comments" || b !== "instagram" || rest.length < 3 || !ID.test(c)) return null;
  if (method === "DELETE" && rest.length === 3) return { act: "delete", id: c };
  if (method === "POST" && rest.length === 4 && (d === "reply" || d === "private" || d === "hide"))
    return { act: d, id: c };
  return null;
}

/** Instagram's words in a send row and an answer: no token, at most this long. */
const SAID_MAX = 200;

/** A store write that failed after the send: the answer is what Instagram said, so the fault is only logged. */
const logStoreFault = (act: Send["act"], id: string, e: unknown) =>
  console.log(JSON.stringify({ inbox: "send", act, id, error: String(e) }));

async function sendToInstagram(
  { act, id }: Send,
  req: Request,
  x: { api: InboxApi; store: Store; now: Date; http: Http; reply: InboxReply },
): Promise<Response> {
  const { api, store, now, http, reply } = x;
  const at = now.toISOString();

  // The owner's input.
  const body = (await req.json().catch(() => null)) as { text?: unknown; hidden?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const hidden = body?.hidden === true;
  const kind = act === "hide" || act === "delete" ? null : act; // what the sends table calls it
  if (kind && !text) return reply.fail("bad_request");
  if (act === "hide" && typeof body?.hidden !== "boolean") return reply.fail("bad_request");
  // A private reply is a DM by transport, so it has a DM's size limit.
  if (act === "reply" && text.length > IG_COMMENT_MAX) return reply.fail("too_long");
  if ((act === "dm" || act === "private") && utf8Bytes(text) > DM_TEXT_BYTES)
    return reply.fail("too_long");

  // What the store holds: Instagram is not asked about what the store already refuses.
  const conversation =
    act === "dm" ? (await api.thread("instagram", id, { limit: 1 }))?.conversation : undefined;
  const comment = act === "dm" ? undefined : await api.comment("instagram", id);
  if (!conversation && !comment) return reply.json({ error: "not_found" }, 404);
  if (conversation && !(conversation.windowClosesAt && conversation.windowClosesAt > at))
    return reply.fail("window_closed");
  if (conversation && !conversation.peerId) return reply.fail("not_eligible"); // nobody to send to
  if (act === "delete" && !comment?.ours) return reply.fail("no_permission");

  const tokens = await store.getTokens("instagram");
  if (!tokens) return reply.fail("not_connected");
  if (isExpired(tokens, now)) return reply.fail("token_expired");
  if (!tokens.canReply) return reply.fail("no_permission");
  const token = tokens.accessToken;

  /** A failure as the answer and the send row say it. */
  const said = (e: unknown) => {
    const { code, detail } = toReplyCode(e, { dm: act === "dm" });
    return { code, detail: detail?.replaceAll(token, "…").slice(0, SAID_MAX) };
  };

  const owner = act === "reply" ? (await store.getStatus("instagram"))?.handle : undefined;
  let igUserId = "";
  if (kind) {
    try {
      igUserId = await igUserIdOf(http, token);
    } catch (e) {
      // Nothing has been sent, so there is no send row.
      const { code, detail } = said(e);
      return reply.fail(code, detail);
    }
  }

  // The one call. It answers the id Instagram gave the message or reply (the comment's own id for hide and delete).
  const target = { http, igUserId, token };
  const call = async (): Promise<string | undefined> => {
    if (act === "dm")
      return (await sendReply(target, { id: conversation?.peerId ?? "" }, text, [])).messageId;
    if (act === "private") return (await sendReply(target, { comment_id: id }, text, [])).messageId;
    if (act === "reply") {
      const made = graph(
        await fetchJson<MetaError & { id?: string }>(
          http,
          `${IG_API}/${id}/replies`,
          formPost({ message: text, access_token: token }),
        ),
        "reply",
      );
      return made.id;
    }
    const done = graph(
      await fetchJson<MetaError & { success?: boolean }>(
        http,
        withQuery(`${IG_API}/${id}`, {
          ...(act === "hide" ? { hide: String(hidden) } : {}),
          access_token: token,
        }),
        { method: act === "hide" ? "POST" : "DELETE", headers: { Accept: "application/json" } },
      ),
      act,
    );
    return done.success === true ? id : undefined;
  };
  /** A store write whose failure is logged, never answered: it must not hide what Instagram said. */
  const guard = async (work: () => Promise<unknown> | undefined) => {
    try {
      await work();
    } catch (e) {
      logStoreFault(act, id, e);
    }
  };
  /** Hide and delete are not sends: the sends table has no row for them. */
  const record = (row: Pick<SendRow, "state" | "platformId" | "detail">) =>
    guard(() =>
      kind
        ? api.recordSend({ platform: "instagram", kind, targetId: id, text, at, ...row })
        : undefined,
    );

  let platformId: string | undefined;
  let unconfirmed = "no id in the answer";
  try {
    platformId = await call();
  } catch (e) {
    const failure = said(e);
    // Meta refused: it did not send. Anything else (a thrown fetch, a 5xx or unreadable answer) may have landed.
    if (e instanceof ReplyError && e.code !== "upstream") {
      await record({ state: "refused", platformId: null, detail: failure.detail ?? null });
      return reply.fail(failure.code, failure.detail);
    }
    unconfirmed = failure.detail ?? unconfirmed;
  }
  if (!platformId) {
    await record({ state: "unconfirmed", platformId: null, detail: unconfirmed });
    return reply.fail("upstream", "unconfirmed");
  }

  // Instagram took it: its own row goes into the store now, ahead of the reader, which finds it again by its id.
  let answer: object = { ok: true };
  let write: (() => Promise<void>) | undefined;
  if (act === "dm" && conversation) {
    const message: MessageRow = {
      platform: "instagram",
      convId: id,
      id: platformId,
      at,
      fromPeer: false,
      text: clipLog(text),
      kind: "text",
      sentBy: "owner",
    };
    answer = { message };
    write = async () => {
      // The reader may have ingested the conversation since the checks above: build on its row, and leave the
      // conversation alone when it already shows something newer than this send.
      const latest =
        (await api.thread("instagram", id, { limit: 1 }))?.conversation ?? conversation;
      await api.ingest({
        messages: [message],
        conversations:
          latest.updatedAt > at
            ? []
            : [{ ...latest, updatedAt: at, lastText: message.text, lastFrom: "owner" }],
      });
    };
  } else if (act === "reply" && comment) {
    const row: CommentRow = {
      platform: "instagram",
      postId: comment.postId,
      id: platformId,
      parentId: comment.parentId ?? id, // Instagram attaches a reply to a reply to the top-level comment
      at,
      author: owner ?? "",
      authorId: igUserId,
      text: clipLog(text),
      hidden: false,
      ours: true,
      sentBy: "owner",
    };
    answer = { reply: row };
    write = () => api.ingest({ comments: [row] });
  } else if (act === "private") {
    answer = { message: { id: platformId } };
  } else if (act === "hide") {
    write = () => api.setHidden("instagram", id, hidden);
  } else if (act === "delete") {
    write = () => api.deleteComment("instagram", id);
  }
  await Promise.all([record({ state: "sent", platformId, detail: null }), guard(() => write?.())]);
  return reply.json(answer);
}
