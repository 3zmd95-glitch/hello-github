"use client";

import { useEffect } from "react";
import Chip from "@/components/ui/ios/Chip";
import type { InboxConversation, InboxMessage } from "@/lib/domain";
import { DM_TEXT_BYTES, inboxErrorKey, inboxSend } from "@/lib/inbox";
import { useT, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import { formatInstant } from "../calendar/dates";
import ReplyBox from "./ReplyBox";
import { conversationSeen, currentConfig, useThread } from "./useInbox";

/** What stands in for a message the inbox cannot show as text. */
const KIND: Partial<Record<InboxMessage["kind"], MessageKey>> = {
  story: "inbox.thread.story",
  share: "inbox.thread.share",
  unsupported: "inbox.thread.unsupported",
};

function Bubble({ m }: { m: InboxMessage }) {
  const { t, lang } = useT();
  const kind = KIND[m.kind];
  // The person's lines at the start side, ours at the end (mirrored in Arabic, as in the apps).
  return (
    <li
      className={`flex max-w-[80%] flex-col gap-1 ${m.fromPeer ? "items-start self-start" : "items-end self-end"}`}
      data-testid="inbox-message"
      data-id={m.id}
      data-from={m.sentBy}
    >
      {m.sentBy === "auto" && <Chip tone="tint">{t("inbox.thread.auto")}</Chip>}
      {kind && <span className="text-muted text-[12px]">{t(kind)}</span>}
      {m.text && (
        <p
          dir="auto"
          className={`rounded-2xl px-3 py-2 text-[15px] break-words whitespace-pre-wrap ${m.fromPeer ? "bg-fill" : "bg-tint-bg"}`}
        >
          {m.text}
        </p>
      )}
      <time className="text-muted text-[11px] tabular-nums" dateTime={m.at}>
        {formatInstant(m.at, lang)}
      </time>
    </li>
  );
}

/**
 * One conversation, oldest message first, "Load older" on top. The list's poll moving the row's `updatedAt`
 * reads it again while it is open, and keeps it seen.
 */
export default function ThreadView({ conversation }: { conversation: InboxConversation }) {
  const { t, lang } = useT();
  const markSeen = useStore((s) => s.markInboxSeen);
  const { key, at } = conversationSeen(conversation);
  const { thread, busy, error, loadMore, reload } = useThread(conversation.id, at);

  useEffect(() => {
    markSeen(key, at);
  }, [markSeen, key, at]);

  return (
    <div className="flex flex-col gap-3" data-testid="inbox-thread-view">
      {thread?.more && (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm self-center"
          disabled={busy}
          onClick={loadMore}
          data-testid="inbox-load-older"
        >
          {t("inbox.loadOlder")}
        </button>
      )}
      {!thread && busy && (
        <p className="text-muted text-[15px]" aria-busy>
          {t("inbox.loading")}
        </p>
      )}
      {thread && (
        <ol className="flex flex-col gap-3">
          {thread.messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="text-danger text-[13px]" data-testid="inbox-thread-error">
          {t(inboxErrorKey(error), { detail: error.detail ?? "" })}
        </p>
      )}
      {thread && conversation.platform === "instagram" && (
        <div className="flex flex-col gap-1">
          {thread.window.open && thread.window.closesAt && (
            <p className="text-muted text-[12px]" data-testid="inbox-reply-window">
              {t("inbox.window.closesIn", { time: formatInstant(thread.window.closesAt, lang) })}
            </p>
          )}
          <ReplyBox
            kind="dm"
            platform={conversation.platform}
            limit={{ bytes: DM_TEXT_BYTES }}
            disabled={!thread.window.open}
            disabledReason={t("inbox.window.closed")}
            onSend={(text) => inboxSend(currentConfig(), conversation.id, text)}
            onSent={reload}
            testId="inbox-reply"
          />
        </div>
      )}
    </div>
  );
}
