/**
 * 📥 Threads inbox reads (packet DT-6B-1, planning/tools/36-inbox.md): the owner's own posts and the direct replies
 * to one of them, read-only. Pure: never writes KV (no token refresh), never sends, hides or marks anything, never
 * calls sync.ts or metaList, and makes exactly one Threads call per request.
 *
 *   GET /social/inbox/threads/account                         → { provider, accountId, handle, generation, capabilities }
 *   GET /social/inbox/threads/posts?account&generation&cursor? → { …page, items: Post[] }   (each with a sealed `ref`)
 *   GET /social/inbox/threads/posts/:ref/replies?…            → { …page, items: Reply[] }
 *
 * `accountId` is `/me`'s `id` (a string). Replies use `/{post}/replies` (direct replies as the Threads API returns
 * them, with `root_post` / `replied_to` kept as ids); nested depth, hidden or pending replies and production
 * eligibility are unverified. Reading replies needs `threads_read_replies` in the stored token's scope; the analytics
 * connection (`threads_basic,threads_manage_insights`) lacks it, so the honest first state is `no_permission`. This
 * packet asks for no new scope.
 *
 * DT-6B-2B-1 (additive, planning/tools/37-inbox-send.md): a reply whose `root_post` is the owned post and whose
 * `replied_to` is that same post (a direct reply) also carries `sendRef`, a separately sealed send target
 * (inboxSendThreads.ts) binding account, generation, root post and reply; unknown or other ancestry gets none. The
 * account route adds `capabilities.sendReplies: "permission_unverified"` (never ok in this packet). Still pure.
 */

import { Budget, clip, type Http } from "./http";
import {
  PAGE,
  PATH_ID_RE,
  STATUS,
  boundedJson,
  exactLink,
  failureOf,
  generationV2,
  iso,
  listFrame,
  nameOf,
  plainId,
  sealRef,
  textOf,
  type PageOut,
  type ReadError,
  type Reply,
} from "./inboxReadCommon";
import type { MetaError, MetaPage } from "./meta";
import { isExpired } from "./oauth";
import { graph } from "./replyCore";
import { sealThreadsSendTarget } from "./inboxSendThreads";
import type { Store } from "./store";
import { TH_API } from "./threads";

/** The scope the replies edge needs (read only; never requested by this packet). */
export const TH_READ_REPLIES_SCOPE = "threads_read_replies";
const TEXT_PREVIEW = 200;
const THREADS_HOSTS = ["www.threads.net", "www.threads.com"] as const;

interface ThMe extends MetaError {
  id?: string | number;
  username?: string;
}
interface ThPost {
  id?: string;
  timestamp?: string;
  text?: string;
  permalink?: string;
  media_type?: string;
}
interface ThReply {
  id?: string;
  text?: string;
  timestamp?: string;
  username?: string;
  is_reply_owned_by_me?: boolean;
  root_post?: { id?: string };
  replied_to?: { id?: string };
}

type Route = { edge: "account" } | { edge: "posts" } | { edge: "replies"; ref: string };

function route(rest: string[]): Route | null {
  const [a, ref, b, extra] = rest;
  if (extra !== undefined) return null;
  if (a === "account" && ref === undefined) return { edge: "account" };
  if (a === "posts" && ref === undefined) return { edge: "posts" };
  if (a === "posts" && ref !== undefined && b === "replies") return { edge: "replies", ref };
  return null;
}

/** `/social/inbox/threads/*`; `rest` is the path after "threads". Null when the path is not ours. */
export async function handleThreadsRead(
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

  const tokens = await store.getTokens("threads");
  if (!tokens) return fail("not_connected");
  // Never refreshed here (a refresh is a write): an expired token waits for the owner to reconnect.
  if (isExpired(tokens, now)) return fail("token_expired");
  const status = await store.getStatus("threads");
  const stamp = status?.connectedAt ?? tokens.issuedAt;
  const token = tokens.accessToken;
  const granted = (tokens.scope ?? "").split(/[,\s]+/).filter(Boolean);
  const replies = granted.includes(TH_READ_REPLIES_SCOPE) ? "ok" : "no_permission";
  const http: Http = { fetch: doFetch ?? fetch, budget: new Budget(1) };
  const get = <T>(path: string, params: Record<string, string>) => {
    const url = new URL(`${TH_API}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token);
    return boundedJson<T>(http, url.toString());
  };

  if (r.edge === "account") {
    try {
      const me = graph(await get<ThMe>("me", { fields: "id,username" }), "me");
      const accountId = plainId(me.id, PATH_ID_RE);
      if (!accountId) return fail("upstream", { detail: "me: no id" });
      return reply.json(
        {
          provider: "threads",
          accountId,
          handle: nameOf(me.username) ?? null,
          generation: await generationV2(secret, "threads", accountId, stamp),
          // Sending stays closed until the reply permission and grant evidence are verified (inboxSendThreads.ts).
          capabilities: { replies, sendReplies: "permission_unverified" },
        },
        200,
      );
    } catch (e) {
      const { code, detail } = failureOf(e, token, secret);
      return fail(code, detail ? { detail } : {});
    }
  }

  const frame = await listFrame(
    req,
    secret,
    "threads",
    stamp,
    r.edge,
    now,
    r.edge === "replies" ? r.ref : undefined,
    r.edge === "replies" ? "post" : undefined,
  );
  if (typeof frame === "string") return fail(frame);
  if (r.edge === "replies" && replies !== "ok") return fail("no_permission");
  // A post id goes into the path: never anything but a plain id (refs are ours, this is defence in depth).
  if (frame.ref && !PATH_ID_RE.test(frame.ref.id)) return fail("bad_request");
  const { after, head } = frame;
  const paging = (p: MetaPage<unknown>["paging"]) => ({ more: !!p?.next, a: p?.cursors?.after });

  try {
    let out: PageOut;
    if (r.edge === "posts") {
      const body = graph(
        await get<MetaPage<ThPost>>("me/threads", {
          fields: "id,timestamp,text,permalink,media_type",
          limit: String(PAGE),
          ...(after ? { after } : {}),
        }),
        "threads",
      );
      const { more, a } = paging(body.paging);
      const rows = body.data;
      // Refs are minted for the rows kept (first PAGE); the whole list is validated first.
      const refs = new Map<string, string>();
      if (Array.isArray(rows))
        for (const p of rows.slice(0, PAGE)) {
          const id = plainId(p?.id, PATH_ID_RE);
          if (id)
            refs.set(
              id,
              await sealRef(secret, {
                p: "threads",
                a: frame.accountId,
                g: frame.generation,
                k: "post",
                id,
              }),
            );
        }
      out = await frame.page(
        rows,
        more,
        a,
        (p) => {
          const id = plainId(p.id, PATH_ID_RE)!;
          const text = clip(p.text, TEXT_PREVIEW);
          const permalink = exactLink(p.permalink, THREADS_HOSTS);
          const mediaType = nameOf(p.media_type);
          return {
            id,
            ref: refs.get(id),
            ...(text ? { text } : {}),
            ...(permalink ? { permalink } : {}),
            timestamp: iso(p.timestamp),
            ...(mediaType ? { mediaType } : {}),
          };
        },
        PATH_ID_RE,
      );
    } else {
      const postId = frame.ref!.id;
      const body = graph(
        await get<MetaPage<ThReply>>(`${postId}/replies`, {
          fields: "id,text,timestamp,username,is_reply_owned_by_me,root_post,replied_to",
          reverse: "false",
          limit: String(PAGE),
          ...(after ? { after } : {}),
        }),
        "replies",
      );
      const { more, a } = paging(body.paging);
      // Send refs only for direct replies under this owned post, sealed before the (synchronous) row mapping.
      const sendRefs = new Map<string, string>();
      if (Array.isArray(body.data))
        for (const x of body.data.slice(0, PAGE)) {
          const id = plainId(x?.id, PATH_ID_RE);
          if (
            id &&
            plainId(x.root_post?.id, PATH_ID_RE) === postId &&
            plainId(x.replied_to?.id, PATH_ID_RE) === postId
          )
            sendRefs.set(
              id,
              await sealThreadsSendTarget(secret, {
                a: frame.accountId,
                g: frame.generation,
                r: postId,
                t: id,
              }),
            );
        }
      out = await frame.page(
        body.data,
        more,
        a,
        (x) => {
          const text = textOf(x.text);
          const username = nameOf(x.username);
          const rootId = plainId(x.root_post?.id);
          const parentId = plainId(x.replied_to?.id);
          const id = plainId(x.id, PATH_ID_RE)!;
          const sendRef = sendRefs.get(id);
          return {
            id,
            text,
            author: username ? { username } : null,
            createdAt: iso(x.timestamp),
            direction:
              x.is_reply_owned_by_me === true
                ? "out"
                : x.is_reply_owned_by_me === false
                  ? "in"
                  : "unknown",
            // A reply without text is media (image, video, link card): shown as a placeholder, never fetched.
            kind: text.trim() ? "text" : "media",
            ...(rootId ? { rootId } : {}),
            ...(parentId ? { parentId } : {}),
            ...(sendRef ? { sendRef } : {}),
          };
        },
        PATH_ID_RE,
      );
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
