/**
 * 📥 YouTube inbox reads (packet DT-6B-1, planning/tools/36-inbox.md): the owner's channel, its uploads, the published
 * comment threads of one owned video and, only on demand, the replies of one top-level comment. Pure: never writes KV,
 * never runs the token refresh POST (youtube.ts `auth.refresh` is not called: an expired access token answers
 * `token_expired`), never moderates, and makes exactly one Data API call per request (one quota unit).
 *
 *   GET /social/inbox/youtube/account                                → { provider, needsSelection, channels, capabilities }
 *   GET /social/inbox/youtube/videos?account&generation&uploads&cursor? → { …page, items: Video[] }  (sealed `ref` each)
 *   GET /social/inbox/youtube/videos/:ref/threads?…                  → { …page, items: Thread[] } (sealed `ref` each)
 *   GET /social/inbox/youtube/comments/:ref/replies?…                → { …page, items: Comment[] }
 *
 * The account is a channel id from `channels?mine=true`; with more or fewer than one channel `needsSelection` is true
 * and the dashboard asks the owner to pick (never the first by default; the title is never a key). Each channel has
 * its own generation and a sealed `uploads` ref, so only a channel this token owns can be read. Embedded replies are a
 * subset (`repliesCoverage: "embedded"`); the rest come from `comments?parentId=<top-level comment id>`.
 *
 * DT-6B-2A (additive, planning/tools/37-inbox-send.md): each thread row also carries `sendRef`, a separately sealed send
 * target (account, generation, provider thread id, video id, top-level comment id; the thread id is never assumed to
 * be the comment id), and each embedded reply carries its parent's `sendRef` with `replyParentNote: true` (a reply
 * goes under the top-level comment). The account answer adds `capabilities.sendComments`: "ok" only for a stored
 * youtube.force-ssl grant. Still pure GETs.
 */

import { Budget, bearer, clip, type Http, type JsonReply } from "./http";
import {
  PAGE,
  QUERY_ID_RE,
  ReadFailure,
  STATUS,
  boundedJson,
  failureOf,
  generationV2,
  iso,
  isRow,
  listFrame,
  nameOf,
  plainId,
  sealRef,
  textOf,
  type PageOut,
  type ReadError,
  type Reply,
} from "./inboxReadCommon";
import { canSend, sealSendTarget } from "./inboxSendYouTube";
import { isExpired } from "./oauth";
import type { Store } from "./store";
import { YT_API } from "./youtube";

const CHANNELS_MAX = 10;
const TITLE_MAX = 200;
/** Scopes that let the token read comment threads (youtube.readonly is what the analytics connection asks for). */
const READ_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube",
];
const RATE_REASONS = new Set(["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);

interface GoogleError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}
interface List<T> extends GoogleError {
  items?: T[];
  nextPageToken?: string;
}
interface YtChannel {
  id?: string;
  snippet?: { title?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}
interface YtPlaylistItem {
  snippet?: { title?: string; publishedAt?: string };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
}
interface YtComment {
  id?: string;
  snippet?: {
    textDisplay?: string;
    authorDisplayName?: string;
    authorChannelId?: { value?: string };
    publishedAt?: string;
    parentId?: string;
  };
}
interface YtThread {
  id?: string;
  snippet?: { totalReplyCount?: unknown; topLevelComment?: YtComment };
  replies?: { comments?: YtComment[] };
}

/**
 * A Data API reply's body, or the named failure (reasons before statuses: a quota 403 is not a permission 403). A 200
 * whose body is not a JSON object is `upstream` (DT-6B-1-R1 B1-2), never a success.
 */
function googleBody<T extends GoogleError>(reply: JsonReply<T>, what: string): T {
  const b: unknown = reply.body;
  if (reply.ok && typeof b === "object" && b !== null && !Array.isArray(b) && !(b as T).error)
    return b as T;
  const reason = reply.body?.error?.errors?.[0]?.reason;
  const detail = `${what}: ${reply.body?.error?.message ?? reply.status}`;
  if (reply.status === 401) throw new ReadFailure("token_expired", detail);
  if (reason === "commentsDisabled") throw new ReadFailure("comments_disabled", detail);
  if (reason === "videoNotFound") throw new ReadFailure("video_not_found", detail);
  if (reply.status === 429 || (reason && RATE_REASONS.has(reason)))
    throw new ReadFailure("rate_limited", detail);
  if (reply.status === 403) throw new ReadFailure("no_permission", detail);
  throw new ReadFailure("upstream", detail);
}

type Route =
  | { edge: "account" }
  | { edge: "videos" }
  | { edge: "threads"; ref: string }
  | { edge: "comments"; ref: string };

function route(rest: string[]): Route | null {
  const [a, ref, b, extra] = rest;
  if (extra !== undefined) return null;
  if (a === "account" && ref === undefined) return { edge: "account" };
  if (a === "videos" && ref === undefined) return { edge: "videos" };
  if (a === "videos" && ref !== undefined && b === "threads") return { edge: "threads", ref };
  if (a === "comments" && ref !== undefined && b === "replies") return { edge: "comments", ref };
  return null;
}

/** `/social/inbox/youtube/*`; `rest` is the path after "youtube". Null when the path is not ours. */
export async function handleYouTubeRead(
  req: Request,
  rest: string[],
  store: Store | null,
  secret: string | undefined,
  now: Date,
  doFetch: typeof fetch | undefined,
  reply: Reply,
): Promise<Response | null> {
  const r = route(rest);
  if (!r) return null;
  const fail = (error: ReadError, extra: Record<string, unknown> = {}) =>
    reply.json({ error, ...extra }, STATUS[error]);
  if (req.method !== "GET") return fail("method_not_allowed");
  if (!store || !secret) return fail("not_configured");

  const tokens = await store.getTokens("youtube");
  if (!tokens) return fail("not_connected");
  // Access tokens last an hour; the refresh is a POST and a write, so the reader never does it.
  if (isExpired(tokens, now)) return fail("token_expired");
  const status = await store.getStatus("youtube");
  const stamp = status?.connectedAt ?? tokens.issuedAt;
  const token = tokens.accessToken;
  const granted = tokens.scope ? tokens.scope.split(/[,\s]+/).filter(Boolean) : null;
  const comments =
    !granted || READ_SCOPES.some((s) => granted.includes(s)) ? "ok" : "no_permission";
  const http: Http = { fetch: doFetch ?? fetch, budget: new Budget(1) };
  const get = async <T extends GoogleError>(path: string, params: Record<string, string>) => {
    const url = new URL(`${YT_API}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return googleBody(await boundedJson<T>(http, url.toString(), { headers: bearer(token) }), path);
  };

  if (r.edge === "account") {
    try {
      const body = await get<List<YtChannel>>("channels", {
        part: "id,snippet,contentDetails",
        mine: "true",
      });
      // Only an explicit list is an answer (DT-6B-1-R1 B1-2): `{}` or `items: null` is unavailable, never "no channel".
      const items = body.items;
      if (!Array.isArray(items)) return fail("upstream", { detail: "channels: no channel list" });
      if (!items.every((c) => isRow(c)))
        return fail("upstream", { detail: "channels: a channel without an id" });
      const channels = await Promise.all(
        items.slice(0, CHANNELS_MAX).map(async (c) => {
          const accountId = plainId(c.id)!;
          const generation = await generationV2(secret, "youtube", accountId, stamp);
          const playlist = plainId(c.contentDetails?.relatedPlaylists?.uploads);
          return {
            accountId,
            title: nameOf(c.snippet?.title) ?? null,
            generation,
            uploads: playlist
              ? await sealRef(secret, {
                  p: "youtube",
                  a: accountId,
                  g: generation,
                  k: "uploads",
                  id: playlist,
                })
              : null,
          };
        }),
      );
      return reply.json(
        {
          provider: "youtube",
          needsSelection: items.length !== 1,
          channels,
          capabilities: {
            comments,
            sendComments: canSend(tokens.scope) ? "ok" : "no_permission",
          },
        },
        200,
      );
    } catch (e) {
      const { code, detail } = failureOf(e, token, secret);
      return fail(code, detail ? { detail } : {});
    }
  }

  const q = new URL(req.url).searchParams;
  const [refParam, refKind] =
    r.edge === "videos"
      ? [q.get("uploads") ?? "", "uploads" as const]
      : r.edge === "threads"
        ? [r.ref, "video" as const]
        : [r.ref, "comment" as const];
  const frame = await listFrame(req, secret, "youtube", stamp, r.edge, now, refParam, refKind);
  if (typeof frame === "string") return fail(frame);
  if (r.edge !== "videos" && comments !== "ok") return fail("no_permission");
  const { after, head, accountId } = frame;
  const resource = frame.ref!.id;
  const mint = (k: "video" | "comment", id: string) =>
    sealRef(secret, { p: "youtube", a: accountId, g: frame.generation, k, id });
  const commentOf = (c: YtComment) => {
    const s = c.snippet ?? {};
    const authorId = plainId(s.authorChannelId?.value);
    const username = nameOf(s.authorDisplayName?.replace(/^@/, ""));
    const parentId = plainId(s.parentId);
    return {
      id: plainId(c.id)!,
      text: textOf(s.textDisplay),
      author:
        authorId || username
          ? { ...(authorId ? { id: authorId } : {}), ...(username ? { username } : {}) }
          : null,
      createdAt: iso(s.publishedAt),
      // By channel id only: ours → out, someone else's → in, none → unknown (never by display name).
      direction: !authorId ? "unknown" : authorId === accountId ? "out" : "in",
      ...(parentId ? { parentId } : {}),
    };
  };
  const pageParams = { maxResults: String(PAGE), ...(after ? { pageToken: after } : {}) };

  try {
    let out: PageOut;
    if (r.edge === "videos") {
      const body = await get<List<YtPlaylistItem>>("playlistItems", {
        part: "contentDetails,snippet",
        playlistId: resource,
        ...pageParams,
      });
      // Rows are keyed by their video id: a row without one is malformed (the whole page fails).
      const rows = Array.isArray(body.items)
        ? body.items.map((x) => ({ id: x?.contentDetails?.videoId, x }))
        : undefined;
      const refs = new Map<string, string>();
      for (const row of rows?.slice(0, PAGE) ?? []) {
        const id = plainId(row.id);
        if (id) refs.set(id, await mint("video", id));
      }
      out = await frame.page(rows, !!body.nextPageToken, body.nextPageToken, ({ id, x }) => {
        const vid = plainId(id)!;
        const title = clip(x.snippet?.title, TITLE_MAX);
        return {
          id: vid,
          ref: refs.get(vid),
          ...(title ? { title } : {}),
          permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
          timestamp: iso(x.contentDetails?.videoPublishedAt ?? x.snippet?.publishedAt),
        };
      });
    } else if (r.edge === "threads") {
      const body = await get<List<YtThread>>("commentThreads", {
        part: "snippet,replies",
        videoId: resource,
        textFormat: "plainText",
        order: "time",
        ...pageParams,
      });
      // Rows are keyed by the top-level comment id (the replies' parentId); a thread without one, or an embedded
      // reply without an id, makes the page malformed.
      const rows = Array.isArray(body.items)
        ? body.items.map((x) => {
            const embedded = x?.replies?.comments ?? [];
            const ok = Array.isArray(embedded) && embedded.every((c) => isRow(c));
            return { id: ok ? x?.snippet?.topLevelComment?.id : undefined, x };
          })
        : undefined;
      const refs = new Map<string, string>();
      const sendRefs = new Map<string, string>();
      for (const row of rows?.slice(0, PAGE) ?? []) {
        const id = plainId(row.id, QUERY_ID_RE);
        if (id) refs.set(id, await mint("comment", id));
        const threadId = plainId(row.x?.id);
        if (id && threadId)
          sendRefs.set(
            id,
            await sealSendTarget(secret, {
              a: accountId,
              g: frame.generation,
              t: threadId,
              v: resource,
              c: id,
            }),
          );
      }
      out = await frame.page(rows, !!body.nextPageToken, body.nextPageToken, ({ id, x }) => {
        const top = plainId(id)!;
        const total = x.snippet?.totalReplyCount;
        const sendRef = sendRefs.get(top);
        return {
          id: top,
          ref: refs.get(top),
          ...(sendRef ? { sendRef } : {}),
          comment: commentOf(x.snippet!.topLevelComment!),
          // Unknown stays unknown (DT-6B-1-R1 B1-3): only a non-negative safe integer is a count, never a made-up 0.
          totalReplyCount: Number.isSafeInteger(total) && (total as number) >= 0 ? total : null,
          replies: (x.replies?.comments ?? []).slice(0, PAGE).map((c) => ({
            ...commentOf(c),
            ...(sendRef ? { sendRef, replyParentNote: true } : {}),
          })),
          repliesCoverage: "embedded",
        };
      });
    } else {
      const body = await get<List<YtComment>>("comments", {
        part: "snippet",
        parentId: resource,
        textFormat: "plainText",
        ...pageParams,
      });
      out = await frame.page(body.items, !!body.nextPageToken, body.nextPageToken, commentOf);
    }
    return reply.json({ ...head, ...out }, 200);
  } catch (e) {
    const { code, detail } = failureOf(e, token, secret);
    return fail(code, {
      ...head,
      coverage: after ? "partial" : "unavailable",
      ...(detail ? { detail } : {}),
    });
  }
}
