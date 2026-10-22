/**
 * Step A of the global inbox (`planning/tools/51-global-inbox.md`): `GET /social/inbox/probe`, a read-only look at
 * the owner's real Instagram conversations and comments so the next steps are built on what Meta really answers.
 * At most 6 Graph calls per request (the account id, conversations, media, and comments of 3 posts), no KV write,
 * no retry, no cache. Text is clipped to LOG_TEXT_CLIP and no token is ever in the answer. Removed in step B.
 */

import { fetchJson, type Http } from "./http";
import { IG_API } from "./instagram";
import type { MetaError } from "./meta";
import { isExpired } from "./oauth";
import { igUserIdOf } from "./replies";
import { LOG_TEXT_CLIP, graph, toReplyCode } from "./replyCore";
import type { Store } from "./store";

export interface ProbeReply {
  igUserId: string;
  conversations: {
    id: string;
    peer: string;
    updatedAt: string;
    messages: { from: "them" | "us"; fromId: string | null; text: string; at: string }[];
  }[];
  posts: {
    id: string;
    caption: string;
    commentCount: number;
    comments: {
      id: string;
      author: string;
      from: { id: string; username?: string } | null;
      text: string;
      at: string;
      replies: number;
    }[];
  }[];
  calls: number;
}

/** The Graph calls one probe makes at most: `/me`, conversations, media, and comments of 3 posts. */
export const PROBE_CALLS = 6;

const clip = (s: string | undefined) => (s ?? "").slice(0, LOG_TEXT_CLIP);
const q = (base: string, params: Record<string, string | number>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
};

type Conv = {
  id: string;
  updated_time: string;
  participants?: { data: { id: string; username?: string }[] };
  messages?: {
    data: { id: string; created_time: string; from?: { id: string }; message?: string }[];
  };
};
type Media = { id: string; caption?: string; timestamp: string; comments_count?: number };
type Comment = {
  id: string;
  text?: string;
  username?: string;
  from?: { id: string; username?: string };
  timestamp: string;
  replies?: { data: { id: string }[] };
};

export async function handleInboxProbe(
  req: Request,
  rest: string[],
  store: Store | null,
  now: Date,
  http: Http,
  reply: {
    json: (body: unknown, status?: number) => Response;
    fail: (e: "not_configured" | "bad_request") => Response;
  },
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
    calls += 1;
    const igUserId = await igUserIdOf(http, token);
    const convs = await get<{ data?: Conv[] } & MetaError>(
      q(`${IG_API}/${igUserId}/conversations`, {
        platform: "instagram",
        limit: 5,
        access_token: token,
        fields:
          "id,updated_time,participants{id,username},messages.limit(3){id,created_time,from,message}",
      }),
      "conversations",
    );
    const media = await get<{ data?: Media[] } & MetaError>(
      q(`${IG_API}/${igUserId}/media`, {
        fields: "id,caption,timestamp,comments_count",
        limit: 3,
        access_token: token,
      }),
      "media",
    );
    const posts: ProbeReply["posts"] = [];
    // Bounded here too: a platform that ignores `limit=3` must not push the probe past its call budget.
    for (const m of (media.data ?? []).slice(0, 3)) {
      const c = await get<{ data?: Comment[] } & MetaError>(
        q(`${IG_API}/${m.id}/comments`, {
          fields: "id,text,username,from,timestamp,replies{id}",
          limit: 10,
          access_token: token,
        }),
        "comments",
      );
      posts.push({
        id: m.id,
        caption: clip(m.caption),
        commentCount: m.comments_count ?? 0,
        comments: (c.data ?? []).map((x) => ({
          id: x.id,
          author: x.username ?? x.from?.username ?? "",
          from: x.from ?? null,
          text: clip(x.text),
          at: x.timestamp,
          replies: x.replies?.data.length ?? 0,
        })),
      });
    }
    const body: ProbeReply = {
      igUserId,
      conversations: (convs.data ?? []).map((t) => ({
        id: t.id,
        updatedAt: t.updated_time,
        peer: t.participants?.data.find((p) => p.id !== igUserId)?.username ?? "",
        messages: (t.messages?.data ?? []).map((m) => ({
          from: m.from?.id === igUserId ? "us" : "them",
          fromId: m.from?.id ?? null,
          text: clip(m.message),
          at: m.created_time,
        })),
      })),
      posts,
      calls,
    };
    return reply.json(body);
  } catch (e) {
    const { code, detail } = toReplyCode(e);
    return reply.json({ error: code, detail }, 502);
  }
}
