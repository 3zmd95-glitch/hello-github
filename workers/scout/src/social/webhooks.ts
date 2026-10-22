/**
 * Step E of the global inbox (planning/tools/51-global-inbox.md): Instagram's webhooks, the live half of the inbox. The
 * reader (inboxReader.ts) keeps the store fresh every minute either way; once the Meta app is Live with Advanced
 * Access, Meta also pushes each new DM and comment here, so the page shows them within seconds.
 *
 *   GET  /webhooks/instagram   the verify handshake: `hub.verify_token` must be META_VERIFY_TOKEN, the answer is `hub.challenge`
 *   POST /webhooks/instagram   a signed event: `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body, META_APP_SECRET>`
 *
 * Neither route carries the bearer (Meta cannot send one): the signature is the credential, so scout.ts serves them
 * before its bearer check. A request without the header is refused untouched (no body read, no store call); a body
 * over MAX_BODY is `413`; a wrong signature answers `401` and bumps the store's `webhook:rejected` counter. A signed
 * event becomes one `ingest` (all entries together) and `200 { received }`; a store fault answers `500` so Meta delivers
 * the event again, while a payload this file cannot read answers `200 { received: 0 }` (a retry would never fix it, and
 * a run of failures can make Meta disable the subscription). No KV is touched, and the logs carry counts only, never a
 * body or a secret.
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
/** The store's count of events refused for a wrong signature. */
const REJECTED_KEY = "webhook:rejected";
/** Instagram's events are a few kilobytes; a body over 1 MB is refused before any crypto. */
export const MAX_BODY = 1_048_576;

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

/** The parts of Instagram's webhook payload this file reads; every level may be missing or null because it is data. */
type Id = string | number;
interface Payload {
  object?: string;
  entry?:
    | ({
        id?: Id;
        time?: number;
        messaging?:
          | ({
              sender?: { id?: Id };
              timestamp?: number;
              message?: {
                mid?: Id;
                text?: unknown;
                is_unsupported?: boolean;
                attachments?: unknown[];
              };
            } | null)[]
          | null;
        changes?:
          | ({
              field?: string;
              value?: {
                id?: Id;
                text?: unknown;
                from?: { id?: Id; username?: unknown };
                media?: { id?: Id };
                parent_id?: Id;
                timestamp?: number | string;
              } | null;
            } | null)[]
          | null;
      } | null)[]
    | null;
}

/** An id as the text we compare and store: Meta sends strings, a number is read as its digits, anything else is none. */
const idOf = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const listOf = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

/**
 * An event's time as epoch ms: now when it has none (or an unreadable one), null when it is a number no date can hold
 * (the event is then skipped, since the store compares dates as text).
 */
function whenOf(v: string | number | undefined, now: Date): number | null {
  const ms = toMs(v);
  if (Number.isNaN(ms)) return now.getTime();
  return Number.isFinite(new Date(ms).getTime()) ? ms : null;
}

/**
 * The rows of a webhook payload: a person's message and its provisional conversation, a comment and a placeholder post
 * for the post it is under (the caller drops the placeholders of posts the store knows; the reader's next media read
 * fills the rest). Our own echoes and comments, the read / reaction / postback / referral events, a message with nothing
 * to show, an event with an impossible time and every field but `comments` are skipped (the reader brings in what we
 * sent, with the right `sentBy`). `readAt` stays unset: only the reader's reads say how fresh the page is. It reads
 * whatever shape the payload has and may still throw (a date near the edge of what a Date holds); the caller catches.
 */
export function webhookToBatch(payload: unknown, now: Date): IngestBatch {
  const p = (payload ?? {}) as Payload;
  const conversations = new Map<string, ConversationRow>();
  const messages: MessageRow[] = [];
  const posts = new Map<string, PostRow>();
  const comments: CommentRow[] = [];
  for (const entry of listOf(p.entry)) {
    const owner = idOf(entry?.id);
    for (const ev of listOf(entry?.messaging)) {
      const m = ev?.message;
      const mid = idOf(m?.mid);
      const sender = idOf(ev?.sender?.id);
      if (!m || !mid || !sender || sender === owner) continue;
      const kind = m.is_unsupported
        ? "unsupported"
        : typeof m.text === "string"
          ? "text"
          : listOf(m.attachments).length
            ? "share"
            : null;
      const ms = whenOf(ev?.timestamp ?? entry?.time, now);
      if (!kind || ms === null) continue;
      const at = iso(ms);
      const text = kind === "text" ? clipLog(strOf(m.text)) : "";
      const convId = `peer:${sender}`;
      messages.push({
        platform: "instagram",
        convId,
        id: mid,
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
    for (const change of listOf(entry?.changes)) {
      const c = change?.value;
      const id = idOf(c?.id);
      const postId = idOf(c?.media?.id);
      const fromId = idOf(c?.from?.id);
      if (change?.field !== "comments" || !c || !id || !postId) continue;
      if (fromId && fromId === owner) continue;
      const ms = whenOf(c.timestamp ?? entry?.time, now);
      if (ms === null) continue;
      comments.push({
        platform: "instagram",
        postId,
        id,
        parentId: idOf(c.parent_id) || null,
        at: iso(ms),
        author: strOf(c.from?.username),
        authorId: fromId || null,
        text: clipLog(strOf(c.text)),
        hidden: false,
        ours: false,
        sentBy: null,
      });
      posts.set(postId, {
        platform: "instagram",
        id: postId,
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

  // Nothing is read, hashed or stored for a body that is too big or carries no signature at all.
  if (Number(req.headers.get("Content-Length")) > MAX_BODY)
    return json({ error: "bad_request" }, 413);
  const given = req.headers.get("X-Hub-Signature-256");
  if (given === null) return json({ error: "bad_signature" }, 401);

  const api = deps.api ?? inboxApi(env);
  const raw = await req.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return json({ error: "bad_request" }, 413);
  if (!env.META_APP_SECRET || !safeEqual(given, await signatureOf(env.META_APP_SECRET, raw))) {
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

  const entries = Array.isArray(payload.entry) ? payload.entry.length : 0;
  let batch: IngestBatch;
  try {
    batch = webhookToBatch(payload, deps.now?.() ?? new Date());
  } catch {
    // Signed by Meta but unreadable: answered as received, since sending it again changes nothing.
    console.log(JSON.stringify({ webhook: "instagram", entries, error: "unreadable" }));
    return json({ received: 0 });
  }

  try {
    const messages = batch.messages ?? [];
    // A redelivered comment is not written again: the store may hold it hidden (or answered), and an upsert would undo that.
    const comments: CommentRow[] = [];
    for (const c of batch.comments ?? [])
      if (!(await api.comment("instagram", c.id))) comments.push(c);
    // The reader's media read replaces a post row, so a placeholder goes only where the store has no such post.
    // ponytail: check, then write; a post the reader stores in between is overwritten by its placeholder until the
    // next media read. An ingest that keeps a stored post would close the gap.
    const posts: PostRow[] = [];
    const wanted = new Set(comments.map((c) => c.postId));
    for (const post of batch.posts ?? [])
      if (wanted.has(post.id) && !(await api.comments("instagram", post.id, { limit: 1 })))
        posts.push(post);
    if (messages.length + comments.length)
      await api.ingest({ conversations: batch.conversations, messages, posts, comments });
    console.log(
      JSON.stringify({
        webhook: "instagram",
        entries,
        messages: messages.length,
        comments: comments.length,
      }),
    );
    return json({ received: messages.length + comments.length });
  } catch {
    // The error itself stays out of the log: a store error may quote what it was writing.
    console.log(JSON.stringify({ webhook: "instagram", error: "upstream" }));
    return json({ error: "upstream" }, 500);
  }
}
