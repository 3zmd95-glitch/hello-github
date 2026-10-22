"use client";

import { useState } from "react";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ConversationItem, MessageItem } from "@/lib/inbox";
import { DM_ID_RE } from "@/lib/inboxInstagramDmSend";
import { otherNames } from "./ConversationList";
import DraftBox from "./DraftBox";
import InstagramDmControl from "./InstagramDmControlReview";
import type { DmReplyTarget } from "./InstagramDmSendReview";
import { DirectionChip, ListFooter, When } from "./parts";
import { draftScope, listOf, loadMore, selectConversation, useInbox } from "./useInbox";
import { newInstagramDmVisit } from "./useInstagramDmSend";

/** The inbound message a DM reply answers, as it was when the person selected it (a refresh never replaces it). */
interface Picked {
  conversationId: string;
  id: string;
  recipientId: string;
  createdAt: string;
}

/**
 * DT-6B-2C-5A: why a row cannot be answered by a DM (null: it can). Only an inbound row with a concrete sender id that is
 * not the owner's and a usable time; never a guess from a username, the participant order or the newest row.
 */
function unanswerable(m: MessageItem, accountId: string | undefined): MessageKey | null {
  if (m.direction === "out" || (!!m.from?.id && m.from.id === accountId))
    return "inbox.igDm.pick.own";
  if (m.direction !== "in" || !m.from?.id || !DM_ID_RE.test(m.from.id) || !DM_ID_RE.test(m.id))
    return "inbox.igDm.pick.unknownSender";
  if (!m.createdAt || !Number.isFinite(Date.parse(m.createdAt))) return "inbox.igDm.pick.noTime";
  return null;
}

/** One message: who and when, then its text or an honest placeholder for what Instagram did not describe. */
function MessageRow({
  m,
  picked,
  blocked,
  onPick,
}: {
  m: MessageItem;
  picked: boolean;
  blocked: MessageKey | null;
  onPick: () => void;
}) {
  const { t } = useT();
  const placeholder = m.kind === "text" ? null : (`inbox.kind.${m.kind}` as MessageKey);
  return (
    <li
      className="ios-row flex-col items-stretch gap-1"
      data-testid="ibx-msg"
      data-id={m.id}
      data-kind={m.kind}
      data-dir={m.direction}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DirectionChip dir={m.direction} />
        <span className="text-ink-2 text-[13px]" data-testid="ibx-author">
          {m.from?.username ? <bdi dir="ltr">@{m.from.username}</bdi> : t("inbox.author.unknown")}
        </span>
        <When iso={m.createdAt} />
        {m.direction !== "out" && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm ms-auto"
            aria-pressed={picked}
            disabled={!!blocked}
            onClick={onPick}
            data-testid="ibx-msg-pick"
          >
            {t(picked ? "inbox.igDm.picked" : "inbox.igDm.pick")}
          </button>
        )}
      </div>
      {placeholder && (
        <p className="text-muted text-[14px] italic" data-testid="ibx-kind">
          {t(placeholder)}
        </p>
      )}
      {m.text && (
        <p
          className="text-[15px] break-words whitespace-pre-wrap"
          dir="auto"
          data-testid="ibx-text"
        >
          {m.text}
        </p>
      )}
      {blocked && m.direction !== "out" && (
        <p className="text-muted text-[13px]" data-testid="ibx-msg-pick-reason">
          {t(blocked)}
        </p>
      )}
    </li>
  );
}

/**
 * A conversation's messages as Instagram sends them (newest first), Load more for older ones, and the draft box.
 * DT-6B-2C-5A: an explicit "Answer this message" selector on inbound rows (the target of a reviewed DM reply); the
 * selection is a snapshot that new rows and refreshes never replace, and the draft stays at the conversation scope.
 * DT-6B-2C-5B: the conversation's takeover controls sit beside it, uncoupled from the DM opener (Send never changes the
 * mode, a mode change never sends); a selected message's sender is only a recipient the registration must match.
 */
export default function ConversationView({ id }: { id: string }) {
  const { t } = useT();
  useInbox((s) => s.lists);
  const account = useInbox((s) => s.account);
  const accountId = account?.accountId;
  const busy = useInbox((s) => Object.values(s.busy).some(Boolean));
  const [pick, setPick] = useState<Picked | null>(null);
  const conv = listOf<ConversationItem>("conversations").items.find((c) => c.id === id);
  const list = listOf<MessageItem>("messages", id);
  const scope = draftScope("conversation", id);
  const picked = pick?.conversationId === id ? pick : null;
  const choose = (m: MessageItem) => {
    if (unanswerable(m, accountId) || !m.from?.id || !m.createdAt) return;
    setPick({ conversationId: id, id: m.id, recipientId: m.from.id, createdAt: m.createdAt });
    // Another inbound message is a new DM visit: an action still waiting for storage sends nothing.
    newInstagramDmVisit();
  };
  const target: DmReplyTarget | null =
    picked && account
      ? {
          account: account.accountId,
          readerGeneration: account.generation,
          conversationId: id,
          recipientId: picked.recipientId,
          inboundMessageId: picked.id,
          inboundAt: picked.createdAt,
          accountName: account.handle,
        }
      : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => void selectConversation(null)}
          data-testid="ibx-conv-back"
        >
          {t("inbox.back")}
        </button>
        <h2 className="min-w-0 truncate text-[17px] font-semibold">
          <bdi dir="auto">
            {(conv && otherNames(conv, accountId)) ?? t("inbox.conversation.unknown")}
          </bdi>
        </h2>
      </div>
      {list.items.length > 0 && (
        <ul className="ios-list">
          {list.items.map((m) => (
            <MessageRow
              key={m.id}
              m={m}
              picked={picked?.id === m.id}
              blocked={unanswerable(m, accountId)}
              onPick={() => choose(m)}
            />
          ))}
        </ul>
      )}
      <ListFooter
        list={list}
        empty="inbox.empty.messages"
        busy={busy}
        onMore={() => void loadMore("messages")}
      />
      <DraftBox key={scope} scope={scope} dmSend={{ target }} />
      {account && (
        <InstagramDmControl
          target={{
            account: account.accountId,
            conversationId: id,
            ...(picked ? { recipientId: picked.recipientId } : {}),
          }}
          accountName={account.handle}
        />
      )}
    </div>
  );
}
