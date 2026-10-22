"use client";

import Chip from "@/components/ui/ios/Chip";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { InboxConversation } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { useStore } from "@/store";
import { conversationSeen, isUnread } from "./useInbox";

/** Who wrote the last line, said before it (the person's own lines need no name). */
const FROM: Partial<Record<InboxConversation["lastFrom"], MessageKey>> = {
  owner: "inbox.thread.you",
  auto: "inbox.thread.auto",
};

/** The Messages section: one row per person, newest first, with "new" until it is opened. */
export default function ConversationList({
  conversations,
  loaded,
  more,
  onOpen,
  onMore,
}: {
  conversations: readonly InboxConversation[];
  loaded: boolean;
  more: boolean;
  onOpen: (c: InboxConversation) => void;
  /** Ignored while a read is under way (the hook's own guard). */
  onMore: () => void;
}) {
  const { t } = useT();
  const seen = useStore((s) => s.inboxSeen);
  return (
    <ListGroup header={t("inbox.section.messages")} testId="inbox-messages">
      {conversations.map((c) => {
        const from = FROM[c.lastFrom];
        return (
          <ListRow
            key={`${c.platform}:${c.id}`}
            iconRaw={<PlatformBadge platform={c.platform} />}
            title={<bdi>{c.peerName}</bdi>}
            sub={
              <span className="block truncate">
                {from && `${t(from)}: `}
                <bdi>{c.lastText}</bdi>
              </span>
            }
            trailing={
              isUnread(conversationSeen(c), seen) && (
                <Chip tone="tint" data-testid="inbox-new">
                  {t("inbox.new")}
                </Chip>
              )
            }
            onClick={() => onOpen(c)}
            testId="inbox-conversation"
            data-id={c.id}
            data-platform={c.platform}
          />
        );
      })}
      {loaded && conversations.length === 0 && (
        <ListRow title={t("inbox.empty.messages")} testId="inbox-empty-messages" />
      )}
      {!loaded && <ListRow title={t("inbox.loading")} aria-busy />}
      {more && (
        <ListRow
          title={<span className="text-tint">{t("inbox.loadOlder")}</span>}
          onClick={onMore}
          testId="inbox-more-conversations"
        />
      )}
    </ListGroup>
  );
}
