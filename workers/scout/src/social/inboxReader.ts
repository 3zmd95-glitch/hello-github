/**
 * Step B of the global inbox (planning/tools/51-global-inbox.md): the reader that fills the InboxStore from the Instagram
 * Graph API. It runs on the cron's off-grid minutes, after the replies poll. Per tick it reads the account id (unless the
 * replies poll cached it), one page of conversations, the comments of POSTS_PER_TICK stored posts (a rotation: the
 * cursor is the index into the stored posts, newest first) and, every MEDIA_REFRESH_TICKS ticks, the media list. A
 * refresh from the dashboard (KV `inbox:scan`, written by `POST /social/inbox/refresh`) reads the newest posts' comments
 * once, whatever the cursor says. The tick counter, the cursor and the last refresh served live in one meta row.
 *
 * Subrequests. A Worker invocation on the free plan may make 50, KV and Durable Object calls included:
 *   replies poll  <= 24 Graph (INBOX_OFFGRID_REPLIES_BUDGET, set by cron.ts) + <= 6 KV
 *   this reader   <= 8 Graph (the id, conversations, 5 comments, and the media list or the webhook subscription,
 *                 never both in one tick) + 3 KV (tokens, replies:state, inbox:scan)
 *                 + <= 7 Durable Object calls (getMeta, ingest conversations, ingest posts, posts, ingest comments,
 *                 setMeta, and retain once an hour)
 *   24 + 6 + 8 + 3 + 7 = 48, which leaves SUBREQUEST_HEADROOM (2) of the 50 for Store.write's one retry (a second KV
 *   put). inboxReader.test.ts pins that sum and measures the reader's side of it.
 *
 * Webhooks. Meta delivers an Instagram account's events only after the app enabled notifications for it, so the
 * reader does that itself, once per token (WEBHOOK_FIELDS; `ig:state` remembers the token's `issuedAt`): no owner step.
 * Never on a media tick, which is also the first tick after a connect: the subscription follows a minute later.
 */

import { Budget, fetchJson, formPost, withQuery, type Http } from "./http";
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
import { clipLog, graph, toReplyCode } from "./replyCore";
import { Store, type SocialEnv } from "./store";

/** A hard stop on the Graph calls of one tick (the worst tick makes READER_GRAPH_CALLS_MAX; a fault must not make more). */
export const INBOX_READ_BUDGET = 12;
export const POSTS_PER_TICK = 5;
export const MEDIA_REFRESH_TICKS = 10;
/**
 * The old rows are dropped hourly (`retain` scans whole tables), on this UTC minute: an off-grid one, so the reader runs
 * then. By the clock rather than the tick counter, so a disconnected account (whose ticks stop early) is trimmed too.
 * ponytail: a missed cron at that minute skips the hour; a Durable Object alarm would not depend on the cron.
 */
const RETAIN_MINUTE = 1;
/** The Graph calls the replies poll may make on an off-grid tick (30 on its own), leaving the reader its share of the 50. */
export const INBOX_OFFGRID_REPLIES_BUDGET = 24;
/** Subrequests of the 50 kept free: `Store.write` retries a failed KV put once, a second put the counts below omit. */
export const SUBREQUEST_HEADROOM = 2;
/** KV operations of one replies poll: its automations, its state, the tokens, its two state writes, a token refresh. */
export const REPLIES_KV_CALLS_MAX = 6;
/**
 * The reader's worst tick: the account id, conversations, the comments of the rotation and one of the media list
 * (every tenth tick) and the webhook subscription (once per token, never on a media tick).
 */
export const READER_GRAPH_CALLS_MAX = 1 + 1 + 1 + POSTS_PER_TICK;
/** The tokens, `replies:state` and `inbox:scan`. */
export const READER_KV_CALLS = 3;
/** getMeta, ingest (conversations), ingest (posts), posts, ingest (comments), setMeta, and the hourly retain. */
export const READER_DO_CALLS_MAX = 7;
/** The reader's one meta row: `{ tick, postCursor, lastScan, webhooksFor, webhooksAt }` as JSON. */
const STATE_KEY = "ig:state";
/** The Instagram webhook fields the app asks Meta to deliver for the connected account. */
const WEBHOOK_FIELDS = "messages,comments";

const CONVERSATIONS_FIELDS =
  "id,updated_time,participants{id,username},messages.limit(20){id,created_time,from,message,story,is_unsupported}";
const MEDIA_FIELDS = "id,caption,permalink,timestamp,thumbnail_url,media_url,comments_count";
/** Instagram omits the top-level `username` in practice: the author is `from.username`, so `from` asks for both. */
const COMMENT_FIELDS =
  "id,text,username,from{id,username},timestamp,hidden,replies{id,text,username,from{id,username},timestamp,hidden}";

export type InboxReadResult =
  | { skipped: "no_store" | "not_connected" | "no_permission" | "token_expired" }
  | {
      calls: number;
      conversations: number;
      posts: number;
      comments: number;
      /** Posts whose comments Instagram refused (a deleted post): logged, skipped, the rotation moves on. */
      skipped: number;
      error?: string;
      detail?: string;
    };

/**
 * The tick counter, the rotation's cursor and the newest refresh (`inbox:scan`) already served; and the `issuedAt` of the
 * token whose webhook notifications are enabled (a reconnect or a token refresh issues a new one, so it is asked again).
 */
interface ReaderState {
  tick: number;
  postCursor: number;
  lastScan: string;
  webhooksFor?: string;
  webhooksAt?: string;
}

function parseState(raw: string | null): ReaderState {
  try {
    const v = JSON.parse(raw ?? "");
    return {
      tick: Number(v.tick) || 0,
      postCursor: Number(v.postCursor) || 0,
      lastScan: typeof v.lastScan === "string" ? v.lastScan : "",
      webhooksFor: typeof v.webhooksFor === "string" ? v.webhooksFor : undefined,
      webhooksAt: typeof v.webhooksAt === "string" ? v.webhooksAt : undefined,
    };
  } catch {
    return { tick: 0, postCursor: 0, lastScan: "" };
  }
}

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
  from?: { id: string; username?: string };
  timestamp: string;
  hidden?: boolean;
  replies?: { data: IgComment[] };
}

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
          text: clipLog(m.message),
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
    caption: clipLog(m.caption),
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
      author: c.username ?? c.from?.username ?? "",
      authorId: c.from?.id ?? null,
      text: clipLog(c.text),
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
  // What the result says even when the tick stops half way: what was ingested so far.
  const done = { conversations: 0, posts: 0, comments: 0, skipped: 0 };
  try {
    // First: the 30-day promise holds while Instagram is disconnected, its token lapsed or the permission is missing.
    if (now.getUTCMinutes() === RETAIN_MINUTE) await api.retain(now.toISOString());
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

    const state = parseState(await api.getMeta(STATE_KEY));
    // Once per token, one budgeted call, never on a media tick (which already makes READER_GRAPH_CALLS_MAX). A failure
    // only leaves `webhooksFor` unset (the next tick asks again). It is saved with the state below, so a tick that
    // fails before then asks again too (the call is idempotent).
    if (state.webhooksFor !== tokens.issuedAt && state.tick % MEDIA_REFRESH_TICKS !== 0) {
      try {
        const sub = graph(
          await fetchJson<MetaError & { success?: boolean }>(
            http,
            `${IG_API}/me/subscribed_apps`,
            formPost({ subscribed_fields: WEBHOOK_FIELDS, access_token: token }),
          ),
          "subscribed_apps",
        );
        if (sub.success !== true) throw new Error("subscribed_apps: no success");
        state.webhooksFor = tokens.issuedAt;
        state.webhooksAt = now.toISOString();
      } catch (e) {
        const { code, detail } = toReplyCode(e);
        console.log(
          JSON.stringify({
            inbox: "webhooks",
            error: code,
            detail: detail?.replaceAll(token, "…").slice(0, 200),
          }),
        );
      }
    }
    const repliesState = {
      sent: {},
      ...(await store.getRepliesState<Pick<PollState, "sent" | "igUserId">>()),
    };
    // The replies poll caches the account id; `/me` is only for an account it has not polled yet.
    const igUserId = repliesState.igUserId || (await igUserIdOf(http, token));
    const convs = await get<{ data?: IgConversation[] }>(
      `${igUserId}/conversations`,
      { platform: "instagram", limit: 20, fields: CONVERSATIONS_FIELDS },
      "conversations",
    );
    // The conversations go in first: a failing media or comments call below never stalls the DMs.
    const threads = toBatch(
      { conversations: convs.data ?? [], media: [], comments: [] },
      igUserId,
      repliesState,
      now,
    );
    await api.ingest(threads);
    done.conversations = threads.conversations!.length;

    let media: IgMedia[] = [];
    if (state.tick % MEDIA_REFRESH_TICKS === 0) {
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
      done.posts = media.length;
    }

    // The rotation: the next POSTS_PER_TICK stored posts, or the newest ones after a refresh.
    const stored = (await api.posts({ platform: "instagram", limit: 50 })).items;
    const size = Math.max(stored.length, 1);
    const scan = (await env.SOCIAL_KV?.get("inbox:scan")) ?? "";
    const forced = scan > state.lastScan;
    const cursor = forced ? 0 : state.postCursor % size;
    const targets = Array.from(
      { length: Math.min(POSTS_PER_TICK, stored.length) },
      (_, i) => stored[(cursor + i) % stored.length],
    );
    const comments: { postId: string; rows: IgComment[] }[] = [];
    let refusal: string | undefined;
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
        const { code, detail: said } = toReplyCode(e);
        if (code !== "rejected") throw e;
        // Meta's words, never the token (as the send routes scrub them).
        const detail = said?.replaceAll(token, "…");
        done.skipped += 1;
        refusal = detail;
        console.log(JSON.stringify({ inbox: "comments", post: p.id, error: code, detail }));
      }
    }
    const rows = toBatch({ conversations: [], media: [], comments }, igUserId, repliesState, now);
    await api.ingest({ comments: rows.comments });
    done.comments = rows.comments!.length;

    // A refresh leaves the rotation where it was (so pressing it often cannot starve the older posts).
    const next: ReaderState = {
      tick: state.tick + 1,
      postCursor: forced ? state.postCursor : (cursor + targets.length) % size,
      lastScan: forced ? scan : state.lastScan,
      webhooksFor: state.webhooksFor,
      webhooksAt: state.webhooksAt,
    };
    await api.setMeta(STATE_KEY, JSON.stringify(next));
    const refusedAll = targets.length > 0 && done.skipped === targets.length;
    return {
      calls: calls(),
      ...done,
      ...(refusedAll ? { error: "rejected", detail: refusal?.slice(0, 200) } : {}),
    };
  } catch (e) {
    const { code, detail } = toReplyCode(e);
    return { calls: calls(), ...done, error: code, detail: detail?.slice(0, 200) };
  }
}
