/**
 * Step B of the global inbox (planning/tools/51-global-inbox.md): the reader that fills the InboxStore from the Instagram
 * Graph API. It runs on the cron's off-grid minutes, after the replies poll (which spends up to 30 subrequests of the 50),
 * so it makes at most INBOX_READ_BUDGET Graph calls: the account id, one page of conversations, the comments of
 * POSTS_PER_TICK stored posts (a rotation: `ig:postCursor` is the index into the stored posts, newest first) and, every
 * MEDIA_REFRESH_TICKS ticks (`ig:tick`), the media list. A refresh from the dashboard (KV `inbox:scan`, written by
 * `POST /social/inbox/refresh`) reads the newest posts' comments once, whatever the cursor says.
 */

import { Budget, fetchJson, withQuery, type Http } from "./http";
import { WINDOW_MS, isOwnSend, toMs } from "./inbox";
import type {
  CommentRow,
  ConversationRow,
  InboxApi,
  IngestBatch,
  MessageRow,
  PostRow,
} from "./inboxDb";
import { inboxApi } from "./inboxStore";
import { IG_API } from "./instagram";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { igUserIdOf, type PollState } from "./replies";
import { LOG_TEXT_CLIP, graph, toReplyCode } from "./replyCore";
import { Store, type SocialEnv } from "./store";

/** Graph calls one tick may make. Its worst tick (media refresh) makes 8; the replies poll leaves room for 12. */
export const INBOX_READ_BUDGET = 12;
export const POSTS_PER_TICK = 5;
export const MEDIA_REFRESH_TICKS = 10;
/** The old rows are dropped hourly: `retain` scans whole tables. */
const RETAIN_TICKS = 60;

const CONVERSATIONS_FIELDS =
  "id,updated_time,participants{id,username},messages.limit(20){id,created_time,from,message,story,is_unsupported}";
const MEDIA_FIELDS = "id,caption,permalink,timestamp,thumbnail_url,media_url,comments_count";
const COMMENT_FIELDS =
  "id,text,username,from,timestamp,hidden,replies{id,text,username,from,timestamp,hidden}";

export type InboxReadResult =
  | { skipped: "no_store" | "not_connected" | "no_permission" | "token_expired" }
  | { calls: number; conversations: number; posts: number; comments: number; error?: string };

interface IgMessage {
  id: string;
  created_time: string;
  from?: { id: string };
  message?: string;
  story?: unknown;
  is_unsupported?: boolean;
}
interface IgConversation {
  id: string;
  updated_time: string;
  participants?: { data: { id: string; username?: string }[] };
  messages?: { data: IgMessage[] };
}
interface IgMedia {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp: string;
  thumbnail_url?: string;
  media_url?: string;
  comments_count?: number;
}
interface IgComment {
  id: string;
  text?: string;
  username?: string;
  from?: { id: string };
  timestamp: string;
  hidden?: boolean;
  replies?: { data: IgComment[] };
}

const clip = (s: string | undefined) => (s ?? "").slice(0, LOG_TEXT_CLIP);
/** Instagram sends `+0000` offsets; the store compares `Z` strings (inboxDb.ts retain). */
const iso = (ms: number) => new Date(ms).toISOString();

/** Instagram's answers → the rows the store ingests. `repliesState.sent` tells the replies poll's own DMs from the owner's. */
export function toBatch(
  input: {
    conversations: IgConversation[];
    media: IgMedia[];
    comments: { postId: string; rows: IgComment[] }[];
  },
  igUserId: string,
  repliesState: Pick<PollState, "sent">,
  now: Date,
): IngestBatch {
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  for (const t of input.conversations) {
    const peer = t.participants?.data.find((p) => p.id !== igUserId);
    const peerId = peer?.id ?? "";
    const rows = (t.messages?.data ?? [])
      .map((m): MessageRow => {
        const ms = toMs(m.created_time);
        const fromPeer = m.from?.id !== igUserId;
        const sentBy = fromPeer
          ? "peer"
          : isOwnSend(repliesState, m.id, ms, peerId)
            ? "auto"
            : "owner";
        const kind = m.story
          ? "story"
          : m.is_unsupported
            ? "unsupported"
            : m.message === undefined
              ? "share"
              : "text";
        return {
          platform: "instagram",
          convId: t.id,
          id: m.id,
          at: iso(ms),
          fromPeer,
          text: clip(m.message),
          kind,
          sentBy,
        };
      })
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const newest = rows.at(-1);
    const newestPeer = rows.filter((m) => m.fromPeer).at(-1);
    const newestOurs = rows.filter((m) => !m.fromPeer).at(-1);
    conversations.push({
      platform: "instagram",
      id: t.id,
      peerId,
      peerName: peer?.username ?? "?",
      updatedAt: iso(toMs(t.updated_time)),
      lastText: newest?.text ?? "",
      lastFrom: newest?.sentBy ?? "peer",
      windowClosesAt: newestPeer ? iso(Date.parse(newestPeer.at) + WINDOW_MS) : null,
      answeredBy: newestOurs?.sentBy === "auto" ? "auto" : null,
    });
    messages.push(...rows);
  }
  const posts: PostRow[] = input.media.map((m) => ({
    platform: "instagram",
    id: m.id,
    permalink: m.permalink ?? "",
    thumbUrl: m.thumbnail_url ?? m.media_url ?? null,
    caption: clip(m.caption),
    postedAt: iso(toMs(m.timestamp)),
    commentCount: m.comments_count ?? 0,
  }));
  const comments: CommentRow[] = [];
  const push = (postId: string, c: IgComment, parentId: string | null) => {
    const ours = c.from?.id === igUserId;
    comments.push({
      platform: "instagram",
      postId,
      id: c.id,
      parentId,
      at: iso(toMs(c.timestamp)),
      author: c.username ?? "",
      authorId: c.from?.id ?? null,
      text: clip(c.text),
      hidden: !!c.hidden,
      ours,
      sentBy: ours ? "owner" : null,
    });
    for (const r of c.replies?.data ?? []) push(postId, r, c.id);
  };
  for (const { postId, rows } of input.comments) for (const c of rows) push(postId, c, null);
  return {
    conversations,
    messages,
    posts,
    comments,
    readAt: { platform: "instagram", at: now.toISOString() },
  };
}

/** One read of Instagram into the store (see the file comment). Never throws: a failure is the result's `error`. */
export async function readInboxTick(
  env: SocialEnv,
  deps: { fetch?: typeof fetch; now?: () => Date; api?: InboxApi } = {},
): Promise<InboxReadResult> {
  const api = deps.api ?? inboxApi(env);
  if (!api) return { skipped: "no_store" };
  const now = deps.now?.() ?? new Date();
  const budget = new Budget(INBOX_READ_BUDGET);
  const http: Http = { fetch: deps.fetch ?? fetch, budget };
  const calls = () => INBOX_READ_BUDGET - budget.left;
  try {
    const store = Store.from(env);
    const tokens = store ? await store.getTokens("instagram") : null;
    if (!store || !tokens) return { skipped: "not_connected" };
    if (isExpired(tokens, now)) return { skipped: "token_expired" };
    if (!tokens.canReply) return { skipped: "no_permission" };
    const token = tokens.accessToken;
    const get = async <T>(path: string, params: Record<string, string | number>, what: string) =>
      graph(
        await fetchJson<T & MetaError>(
          http,
          withQuery(`${IG_API}/${path}`, { ...params, access_token: token }),
        ),
        what,
      );

    const igUserId = await igUserIdOf(http, token);
    const repliesState = { sent: {}, ...(await store.getRepliesState<Pick<PollState, "sent">>()) };
    const tick = Number(await api.getMeta("ig:tick")) || 0;
    const convs = await get<{ data?: IgConversation[] }>(
      `${igUserId}/conversations`,
      { platform: "instagram", limit: 20, fields: CONVERSATIONS_FIELDS },
      "conversations",
    );
    let media: IgMedia[] = [];
    if (tick % MEDIA_REFRESH_TICKS === 0) {
      const page = await get<{ data?: IgMedia[] }>(
        `${igUserId}/media`,
        { fields: MEDIA_FIELDS, limit: 50 },
        "media",
      );
      media = page.data ?? [];
      await api.ingest({
        posts: toBatch({ conversations: [], media, comments: [] }, igUserId, repliesState, now)
          .posts,
      });
    }

    // The rotation: the next POSTS_PER_TICK stored posts, or the newest ones after a refresh.
    const stored = (await api.posts({ platform: "instagram", limit: 50 })).items;
    const scan = (await env.SOCIAL_KV?.get("inbox:scan")) ?? "";
    const forced = !!scan && scan > ((await api.getMeta("ig:lastScan")) ?? "");
    const cursor = forced
      ? 0
      : (Number(await api.getMeta("ig:postCursor")) || 0) % Math.max(stored.length, 1);
    const targets = Array.from(
      { length: Math.min(POSTS_PER_TICK, stored.length) },
      (_, i) => stored[(cursor + i) % stored.length],
    );
    const comments: { postId: string; rows: IgComment[] }[] = [];
    for (const p of targets) {
      try {
        const page = await get<{ data?: IgComment[] }>(
          `${p.id}/comments`,
          { fields: COMMENT_FIELDS, limit: 50 },
          "comments",
        );
        comments.push({ postId: p.id, rows: page.data ?? [] });
      } catch (e) {
        // A post Instagram refuses (deleted since the last media read) must not stall the rotation on it.
        if (toReplyCode(e).code !== "rejected") throw e;
      }
    }

    const batch = toBatch(
      { conversations: convs.data ?? [], media: [], comments },
      igUserId,
      repliesState,
      now,
    );
    await api.ingest(batch);
    await api.setMeta("ig:tick", String(tick + 1));
    // A refresh leaves the rotation where it was (so pressing it often cannot starve the older posts).
    if (forced) await api.setMeta("ig:lastScan", scan);
    else
      await api.setMeta(
        "ig:postCursor",
        String((cursor + targets.length) % Math.max(stored.length, 1)),
      );
    if (tick % RETAIN_TICKS === 0) await api.retain(now.toISOString());
    return {
      calls: calls(),
      conversations: batch.conversations!.length,
      posts: media.length,
      comments: batch.comments!.length,
    };
  } catch (e) {
    return { calls: calls(), conversations: 0, posts: 0, comments: 0, error: toReplyCode(e).code };
  }
}
