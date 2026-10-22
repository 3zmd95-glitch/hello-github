/**
 * `/social/inbox/*` (planning/tools/51-global-inbox.md): the dashboard's reads of the global inbox store
 * (inboxStore.ts, filled by the every-minute reader), Refresh and wipe. Sends come with the send routes.
 *
 * Every list answers `next` beside `more`: the store's opaque cursor. The dashboard hands it back as `before`,
 * which is passed to the store unchanged. A store or KV failure answers `upstream` (JSON, CORS headers kept).
 */

import { type InboxApi, type InboxPlatform } from "./inboxDb";
import { inboxApi } from "./inboxStore";
import type { Http } from "./http";
import { isExpired } from "./oauth";
import type { SocialEnv, Store } from "./store";

/** The outbound calls one inbox request may make (the send routes spend them). */
export const INBOX_ROUTE_BUDGET = 8;

/** KV refuses a second write to a key within a second (429); a refused `inbox:scan` write waits this long, once. */
export const REFRESH_RETRY_MS = 1_100;

export interface InboxReply {
  json: (body: unknown, status?: number) => Response;
  fail: (error: "not_configured" | "bad_request" | "not_available" | "upstream") => Response;
}

const ID = /^[A-Za-z0-9_=-]{1,256}$/;

/** `?platform=`: absent or `all` means both; anything but a platform is "bad". */
const platformOf = (v: string | null): InboxPlatform | undefined | "bad" =>
  v === null || v === "all" ? undefined : v === "instagram" || v === "tiktok" ? v : "bad";

/**
 * Answers a `/social/inbox/*` request (`rest` is the path after "inbox"), or returns null when it is not one of
 * ours. `deps.api` is the store; production leaves it out and the Durable Object's stub is used.
 */
export async function handleInbox(
  req: Request,
  env: SocialEnv,
  rest: string[],
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
