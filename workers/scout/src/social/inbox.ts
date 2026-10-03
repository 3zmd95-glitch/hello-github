/**
 * 💬 Auto replies, the DM side (round 34, planning/tools/14-auto-replies-v2.md): reads the newest conversations and
 * answers the DMs and story replies that carry a message rule's keyword, plus the default reply (at most once per
 * person a day). `pollReplies` (replies.ts) runs it after the comments, under the same lock, answer cap and single
 * write. It never starts a conversation: every answer is inside the 24-hour window the person's own message opened.
 *
 *   GET  /{IG_ID}/conversations?platform=instagram&limit=20&fields=id,updated_time,messages.limit(5){…}  one call
 *   POST /{IG_ID}/messages { recipient: { id: IGSID }, message }                         replyCore.sendReply
 *
 * Where a conversation stands: `state.convos[id].seenAt`, the newest message handled. The first poll ever only
 * stamps `state.inboxSince` and answers nothing. The owner chatting by hand (a message from the account in the last
 * day that the poll did not send) keeps rules and the default reply out of that conversation. Instagram does not
 * document the order of the list, so every returned conversation is checked.
 */

import { clip, fetchJson, type Http } from "./http";
import { IG_API } from "./instagram";
import type { MetaPage } from "./meta";
import {
  DEFAULT_STATS_ID,
  graph,
  LOG_TEXT_CLIP,
  matches,
  MAX_RETRIES,
  messageButtons,
  normalizeForMatch,
  sendReply,
  TICK_STOPPERS,
  toReplyCode,
  type ReplyErrorCode,
} from "./replyCore";
import type { Automation, AutomationsDoc, PollState, ReplyLogEntry, ReplyStats } from "./replies";

/** Conversations read per poll (one call). */
export const CONVERSATIONS_PAGE = 20;
/** Newest messages read per conversation. */
export const MESSAGES_PER_CONVERSATION = 5;
/** Instagram's messaging window: only messages younger than this are answered. */
export const WINDOW_MS = 24 * 60 * 60_000;
/** A message from the account this soon after a poll's send to the same person is that send (ids may differ). */
export const OWN_SEND_SLACK_MS = 2 * 60_000;
/** Conversation positions are forgotten after a week without news. */
export const CONVO_TTL_MS = 7 * 24 * 60 * 60_000;

interface IgMessage {
  id?: string;
  created_time?: string | number;
  from?: { id?: string; username?: string };
  message?: string;
  story?: { mention?: { id?: string }; reply_to?: { id?: string } };
  is_unsupported?: boolean;
}

interface IgConversation {
  id?: string;
  updated_time?: string | number;
  messages?: { data?: IgMessage[] };
}

/** ISO 8601 or UNIX seconds (Instagram's docs show both) → epoch ms; NaN when unreadable. */
export function toMs(v: string | number | undefined): number {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && /^\d+$/.test(v)) return toMs(Number(v));
  return Date.parse(v ?? "");
}

/** Whether a message from the account is one the poll sent: by id, else by time just after a send to that person. */
export function isOwnSend(
  state: Pick<PollState, "sent">,
  id: string,
  ms: number,
  personId: string,
): boolean {
  if (state.sent[id]) return true;
  return Object.values(state.sent).some((s) => {
    const after = ms - Date.parse(s.at);
    return s.to === personId && after >= -60_000 && after <= OWN_SEND_SLACK_MS;
  });
}

/** One of the person's new messages. */
export interface InboxItem {
  id: string;
  ms: number;
  text: string;
  /** A reply to one of the account's stories. */
  story: boolean;
  /** Left alone but handled: a story mention, no text, unsupported, older than a day, or the owner is chatting. */
  skip: boolean;
}

/** A conversation with something new from the person. */
export interface ConversationBatch {
  id: string;
  personId: string;
  username?: string;
  /** The person's new messages, oldest first. */
  items: InboxItem[];
  /** The newest message time in the conversation: `seenAt` moves there once every item was handled. */
  newestMs: number;
}

export interface InboxDeps {
  http: Http;
  token: string;
  igUserId: string;
  config: AutomationsDoc;
  state: PollState;
  now: Date;
  /** A rule's counters (or the default reply's), created on first use. */
  statsOf: (id: string) => ReplyStats;
  /** Puts an entry at the top of the log. */
  log: (entry: ReplyLogEntry) => void;
}

export interface InboxOutcome {
  /** Message ids answered. */
  sent: string[];
  failed: string[];
  /** A failure after which nothing else will work this poll. */
  stop?: ReplyErrorCode;
  changed: boolean;
}

/** Whether the DM side has anything to do: a switched-on message rule, or the default reply. */
export function inboxActive(config: AutomationsDoc): boolean {
  return (
    !!config.defaultReply?.enabled ||
    Object.values(config.automations).some((a) => a.enabled && a.trigger === "message")
  );
}

/** The first switched-on message rule (oldest first) that matches and was on when the message came. */
export function pickMessageRule(
  config: AutomationsDoc,
  text: string,
  ms: number,
): Automation | undefined {
  return Object.values(config.automations)
    .filter(
      (a) =>
        a.enabled && a.trigger === "message" && (!a.enabledAt || Date.parse(a.enabledAt) <= ms),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .find((a) => matches(text, a));
}

/**
 * The conversations with new messages from the person. The very first read only stamps `state.inboxSince`.
 * Conversations whose news is only the account's own messages move their `seenAt` here. Throws (ReplyError /
 * SocialError) when the list cannot be read.
 */
export async function readInbox(
  d: InboxDeps,
): Promise<{ batches: ConversationBatch[]; changed: boolean }> {
  const { state, now, igUserId } = d;
  if (!state.inboxSince) {
    state.inboxSince = now.toISOString();
    return { batches: [], changed: true };
  }
  const url = new URL(`${IG_API}/${igUserId}/conversations`);
  url.searchParams.set("platform", "instagram");
  url.searchParams.set("limit", String(CONVERSATIONS_PAGE));
  url.searchParams.set(
    "fields",
    `id,updated_time,messages.limit(${MESSAGES_PER_CONVERSATION}){id,created_time,from,message,story,is_unsupported}`,
  );
  url.searchParams.set("access_token", d.token);
  const page = graph(
    await fetchJson<MetaPage<IgConversation>>(d.http, url.toString()),
    "conversations",
  );
  const nowMs = now.getTime();
  const batches: ConversationBatch[] = [];
  let changed = false;
  for (const c of page.data ?? []) {
    if (!c.id) continue;
    const seen = toMs(state.convos[c.id]?.seenAt ?? state.inboxSince);
    const msgs = (c.messages?.data ?? [])
      .filter((m): m is IgMessage & { id: string } => !!m.id)
      .map((m) => ({ m, ms: toMs(m.created_time) }))
      .filter((x) => Number.isFinite(x.ms))
      .sort((a, b) => a.ms - b.ms);
    const newestMs = msgs.length ? msgs[msgs.length - 1].ms : NaN;
    if (!(newestMs > seen)) continue;
    const person = msgs.find((x) => x.m.from?.id && x.m.from.id !== igUserId)?.m.from;
    const personId = person?.id;
    const fresh = msgs.filter((x) => x.ms > seen && x.m.from?.id !== igUserId);
    if (!personId || !fresh.length) {
      state.convos[c.id] = { seenAt: new Date(newestMs).toISOString() };
      changed = true;
      continue;
    }
    const ownerChatting = msgs.some(
      (x) =>
        x.m.from?.id === igUserId &&
        nowMs - x.ms <= WINDOW_MS &&
        !isOwnSend(state, x.m.id, x.ms, personId),
    );
    batches.push({
      id: c.id,
      personId,
      ...(person?.username ? { username: person.username } : {}),
      newestMs,
      items: fresh.map(({ m, ms }) => {
        const text = m.message ?? "";
        return {
          id: m.id,
          ms,
          text,
          story: !!m.story?.reply_to,
          skip:
            ownerChatting ||
            !!m.story?.mention ||
            !!m.is_unsupported ||
            !text.trim() ||
            nowMs - ms > WINDOW_MS,
        };
      }),
    });
  }
  return { batches, changed };
}

/**
 * Answers the batches while `capLeft` answers and the call budget last, and moves each conversation's `seenAt` up to
 * the last message handled. A refusal is final for its message; a glitch is retried on later polls (up to
 * MAX_RETRIES) and its conversation waits for it; a tick stopper ends the poll.
 */
export async function answerInbox(
  d: InboxDeps,
  batches: readonly ConversationBatch[],
  capLeft: number,
): Promise<InboxOutcome> {
  const { state, now, config } = d;
  const at = now.toISOString();
  const out: InboxOutcome = { sent: [], failed: [], changed: false };
  const def = config.defaultReply;
  for (const batch of batches) {
    if (out.stop) break;
    let handledUpTo: number | undefined;
    let done = true;
    for (const item of batch.items) {
      const rule = item.skip ? undefined : pickMessageRule(config, item.text, item.ms);
      const lastDefault = state.defaultSentAt[batch.personId];
      const useDefault =
        !item.skip &&
        !rule &&
        !item.story &&
        !!def?.enabled &&
        !!def.text &&
        !!normalizeForMatch(item.text) &&
        (!def.enabledAt || Date.parse(def.enabledAt) <= item.ms) &&
        !(lastDefault && now.getTime() - Date.parse(lastDefault) < WINDOW_MS);
      if (!rule && !useDefault) {
        handledUpTo = item.ms;
        continue;
      }
      if (out.sent.length >= capLeft || !d.http.budget.ok) {
        done = false;
        break;
      }
      const id = rule?.id ?? DEFAULT_STATS_ID;
      const s = d.statsOf(id);
      const entry: ReplyLogEntry = {
        at,
        kind: rule ? (item.story ? "story" : "message") : "default",
        automationId: id,
        messageId: item.id,
        ...(batch.username ? { username: batch.username } : {}),
        text: clip(item.text, LOG_TEXT_CLIP) ?? "",
        publicReply: "skipped",
        dm: "failed",
      };
      let final = true;
      try {
        const messageId = await sendReply(
          { http: d.http, igUserId: d.igUserId, token: d.token },
          { id: batch.personId },
          rule ? rule.dmText : (def?.text ?? ""),
          rule ? messageButtons(rule, config.origin, state.ownerUsername) : [],
        );
        entry.dm = "sent";
        s.sends += 1;
        s.lastSentAt = at;
        s.lastError = undefined;
        if (messageId) state.sent[messageId] = { to: batch.personId, at };
        if (!rule) state.defaultSentAt[batch.personId] = at;
        delete state.retries[item.id];
        out.sent.push(item.id);
      } catch (e) {
        const { code, detail, transient } = toReplyCode(e);
        entry.error = code;
        if (detail) entry.detail = detail.slice(0, 200);
        s.failures += 1;
        s.lastError = code;
        out.failed.push(item.id);
        if (TICK_STOPPERS.has(code)) {
          out.stop = code;
          final = false;
        } else if (transient) {
          const tries = (state.retries[item.id] ?? 0) + 1;
          if (tries < MAX_RETRIES) {
            state.retries[item.id] = tries;
            final = false;
          } else {
            delete state.retries[item.id];
          }
        }
      }
      d.log(entry);
      out.changed = true;
      if (!final) {
        done = false;
        break;
      }
      handledUpTo = item.ms;
    }
    const upTo = done ? batch.newestMs : handledUpTo;
    const seen = toMs(state.convos[batch.id]?.seenAt ?? state.inboxSince);
    if (upTo !== undefined && upTo > seen) {
      state.convos[batch.id] = { seenAt: new Date(upTo).toISOString() };
      out.changed = true;
    }
  }
  return out;
}
