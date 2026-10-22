/**
 * Step E of the global inbox (planning/tools/51-global-inbox.md): Instagram's webhooks, the live half of the inbox. The
 * reader (inboxReader.ts) keeps the store fresh every minute either way; once the Meta app is Live with Advanced
 * Access, Meta also pushes each new DM and comment here, so the page shows them within seconds.
 *
 *   GET  /webhooks/instagram   the verify handshake: `hub.verify_token` must be META_VERIFY_TOKEN, the answer is `hub.challenge`
 *   POST /webhooks/instagram   a signed event: `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body, META_APP_SECRET>`
 *
 * Neither route carries the bearer (Meta cannot send one): the signature is the credential, so scout.ts serves them
 * before its bearer check. A forged event answers `401` and bumps the store's `webhook:rejected` counter. A signed event
 * becomes one `ingest` (all entries together) and `200 { received }`; a store fault answers `500` so Meta delivers the
 * event again. No KV is touched, and the logs carry counts only, never a body or a secret.
 *
 * Provisional ids. A webhook names the person (`sender.id`), not the thread, so its conversation is `peer:<sender id>`;
 * the reader's next tick stores the real thread and the dashboard merges the two rows by `peerId` (useInbox.ts).
 */

import { WINDOW_MS, toMs } from "./inbox";
import type {
  CommentRow,
  ConversationRow,
  InboxApi,
  IngestBatch,
  MessageRow,
  PostRow,
} from "./inboxDb";
import { inboxApi } from "./inboxStore";
import { clipLog } from "./replyCore";
import type { SocialEnv } from "./store";
// A cycle with scout.ts (which serves these routes), as in discover/auth.ts: only used inside functions.
import { safeEqual } from "../scout";

const PATH = "/webhooks/instagram";
/** The store's count of events refused for a bad or missing signature. */
const REJECTED_KEY = "webhook:rejected";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

/** HMAC-SHA256 of the raw body as Meta sends it: `sha256=` and lowercase hex. */
async function signatureOf(secret: string, raw: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  return `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Instagram sends `+0000` offsets and epoch numbers; the store compares `Z` strings (inboxDb.ts retain). */
const iso = (ms: number) => new Date(ms).toISOString();

/** The parts of Instagram's webhook payload this file reads; everything is optional because the payload is data. */
interface Payload {
  object?: string;
  entry?: {
    id?: string;
    time?: number;
    messaging?: {
      sender?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_unsupported?: boolean;
        attachments?: unknown[];
      };
    }[];
    changes?: {
      field?: string;
      value?: {
        id?: string;
        text?: string;
        from?: { id?: string; username?: string };
        media?: { id?: string };
        parent_id?: string;
        timestamp?: number | string;
      };
    }[];
  }[];
}

/**
 * The rows of a webhook payload: a person's message and its provisional conversation, a comment and a placeholder post
 * for the post it is under (the caller drops the placeholders of posts the store knows; the reader's next media read
 * fills the rest). Our own echoes and comments, the read / reaction / postback / referral events, a message with nothing
 * to show and every field but `comments` are skipped (the reader brings in what we sent, with the right `sentBy`).
 * `readAt` stays unset: only the reader's reads say how fresh the page is.
 */
export function webhookToBatch(payload: unknown, now: Date): IngestBatch {
  const p = (payload ?? {}) as Payload;
  const conversations = new Map<string, ConversationRow>();
  const messages: MessageRow[] = [];
  const posts = new Map<string, PostRow>();
  const comments: CommentRow[] = [];
  for (const entry of Array.isArray(p.entry) ? p.entry : []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      const sender = ev.sender?.id;
      if (!m?.mid || !sender || sender === entry.id) continue;
      const kind = m.is_unsupported
        ? "unsupported"
        : typeof m.text === "string"
          ? "text"
          : m.attachments?.length
            ? "share"
            : null;
      if (!kind) continue;
      const ms = toMs(ev.timestamp ?? entry.time);
      const at = iso(Number.isFinite(ms) ? ms : now.getTime());
      const text = kind === "text" ? clipLog(m.text) : "";
      const convId = `peer:${sender}`;
      messages.push({
        platform: "instagram",
        convId,
        id: m.mid,
        at,
        fromPeer: true,
        text,
        kind,
        sentBy: "peer",
      });
      const had = conversations.get(convId);
      if (!had || at >= had.updatedAt)
        conversations.set(convId, {
          platform: "instagram",
          id: convId,
          peerId: sender,
          peerName: "?",
          updatedAt: at,
          lastText: text,
          lastFrom: "peer",
          windowClosesAt: iso(Date.parse(at) + WINDOW_MS),
          answeredBy: null,
        });
    }
    for (const change of entry.changes ?? []) {
      const c = change.value;
      if (change.field !== "comments" || !c?.id || !c.media?.id || c.from?.id === entry.id)
        continue;
      const ms = toMs(c.timestamp ?? entry.time);
      comments.push({
        platform: "instagram",
        postId: c.media.id,
        id: c.id,
        parentId: c.parent_id ?? null,
        at: iso(Number.isFinite(ms) ? ms : now.getTime()),
        author: c.from?.username ?? "",
        authorId: c.from?.id ?? null,
        text: clipLog(c.text),
        hidden: false,
        ours: false,
        sentBy: null,
      });
      posts.set(c.media.id, {
        platform: "instagram",
        id: c.media.id,
        caption: "",
        permalink: "",
        thumbUrl: null,
        postedAt: now.toISOString(),
        commentCount: 0,
      });
    }
  }
  return {
    conversations: [...conversations.values()],
    messages,
    posts: [...posts.values()],
    comments,
  };
}

/** Counts a refused event and answers the new total; a store fault (or no store) must not change the `401`. */
async function countRejection(api: InboxApi | null): Promise<number | undefined> {
  if (!api) return undefined;
  try {
    const n = (Number(await api.getMeta(REJECTED_KEY)) || 0) + 1;
    await api.setMeta(REJECTED_KEY, String(n));
    return n;
  } catch {
    return undefined;
  }
}

/**
 * Answers `/webhooks/instagram`, or returns null when the request is not one of ours. `deps.api` is the store;
 * production leaves it out and the Durable Object's stub is used.
 */
export async function handleWebhooks(
  req: Request,
  env: SocialEnv,
  deps: { now?: () => Date; api?: InboxApi } = {},
): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== PATH) return null;

  if (req.method === "GET") {
    const given = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      challenge !== null &&
      !!env.META_VERIFY_TOKEN &&
      given !== null &&
      safeEqual(given, env.META_VERIFY_TOKEN);
    return ok
      ? new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
      : json({ error: "forbidden" }, 403);
  }
  if (req.method !== "POST") return null;

  const api = deps.api ?? inboxApi(env);
  const raw = await req.arrayBuffer();
  const given = req.headers.get("X-Hub-Signature-256");
  if (
    !env.META_APP_SECRET ||
    !given ||
    !safeEqual(given, await signatureOf(env.META_APP_SECRET, raw))
  ) {
    const rejected = await countRejection(api);
    console.log(JSON.stringify({ webhook: "instagram", rejected }));
    return json({ error: "bad_signature" }, 401);
  }

  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (payload?.object !== "instagram") return json({ received: 0 });
  if (!api) return json({ error: "not_available" }, 503);

  try {
    const batch = webhookToBatch(payload, deps.now?.() ?? new Date());
    const messages = batch.messages?.length ?? 0;
    const comments = batch.comments?.length ?? 0;
    if (messages + comments) {
      // The reader's media read replaces a post row, so a placeholder goes only where the store has no such post.
      // ponytail: check, then write; a post the reader stores in between is overwritten by its placeholder until the
      // next media read. An ingest that keeps a stored post would close the gap.
      const unknown: PostRow[] = [];
      for (const post of batch.posts ?? [])
        if (!(await api.comments("instagram", post.id, { limit: 1 }))) unknown.push(post);
      await api.ingest({ ...batch, posts: unknown });
    }
    const entries = Array.isArray(payload.entry) ? payload.entry.length : 0;
    console.log(JSON.stringify({ webhook: "instagram", entries, messages, comments }));
    return json({ received: messages + comments });
  } catch {
    // The error itself stays out of the log: a store error may quote what it was writing.
    console.log(JSON.stringify({ webhook: "instagram", error: "upstream" }));
    return json({ error: "upstream" }, 500);
  }
}
