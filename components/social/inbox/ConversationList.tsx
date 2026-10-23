"use client";

import { Search } from "lucide-react";
import Chip from "@/components/ui/ios/Chip";
import EmptyState from "@/components/ui/ios/EmptyState";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { InboxConversation } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { timeAgo } from "@/lib/socialSync";
import { useStore } from "@/store";
import { conversationUnread } from "./useInbox";

/** Who wrote the last line, said before it (the person's own lines need no name). */
const FROM: Partial<Record<InboxConversation["lastFrom"], MessageKey>> = {
  owner: "inbox.thread.you",
  auto: "inbox.thread.auto",
};

/** The theme's colours an avatar's tint is drawn from (the theme has no blue or violet). */
const AVATAR_TINTS = [
  "--tint",
  "--warn",
  "--danger",
  "--pc-instagram",
  "--pc-snapchat",
  "--ink-2",
] as const;

/** The same name always gets the same tint (a small string hash over the tint list). */
const tintOf = (name: string) =>
  AVATAR_TINTS[
    [...name].reduce((h, ch) => (h * 31 + ch.codePointAt(0)!) >>> 0, 7) % AVATAR_TINTS.length
  ];

/**
 * A row's picture. Phones: the platform's badge, as ever. md+: a 36px circle with the name's first letter on a tint
 * of the theme (the ink stays readable on any of them), the small badge on its end-bottom corner.
 */
function Avatar({ c }: { c: InboxConversation }) {
  return (
    <span className="relative shrink-0">
      <span className="block md:hidden">
        <PlatformBadge platform={c.platform} />
      </span>
      <span
        aria-hidden
        className="text-ink hidden h-9 w-9 place-items-center rounded-full text-[15px] font-semibold md:grid"
        style={{ background: `color-mix(in srgb, var(${tintOf(c.peerName)}) 22%, var(--panel))` }}
        data-testid="inbox-avatar"
      >
        {([...c.peerName.trim()][0] ?? "?").toLocaleUpperCase()}
      </span>
      <span className="absolute -end-1 -bottom-1 hidden md:block">
        <PlatformBadge platform={c.platform} size={16} />
      </span>
    </span>
  );
}

/**
 * The Messages section: one row per person, newest first, with "new" until it is opened. On md+ each row is a
 * table row (avatar | name over last line | "new" | time); a phone keeps the stacked list.
 */
export default function ConversationList({
  conversations,
  loaded,
  more,
  noMatch = false,
  onOpen,
  onMore,
}: {
  conversations: readonly InboxConversation[];
  loaded: boolean;
  more: boolean;
  /** A search found nothing in either list: say so here, in place of the rows. */
  noMatch?: boolean;
  onOpen: (c: InboxConversation) => void;
  /** Ignored while a read is under way (the hook's own guard). */
  onMore: () => void;
}) {
  const { t, lang } = useT();
  const seen = useStore((s) => s.inboxSeen);
  return (
    <ListGroup header={t("inbox.section.messages")} testId="inbox-messages" data-layout="table">
      {conversations.map((c) => {
        const from = FROM[c.lastFrom];
        return (
          <ListRow
            key={`${c.platform}:${c.id}`}
            iconRaw={<Avatar c={c} />}
            title={<bdi>{c.peerName}</bdi>}
            sub={
              <span className="block truncate">
                {from && `${t(from)}: `}
                <bdi>{c.lastText}</bdi>
              </span>
            }
            trailing={
              <>
                {conversationUnread(c, seen) && (
                  <Chip
                    tone="tint"
                    className="md:col-start-3 md:justify-self-end"
                    data-testid="inbox-new"
                  >
                    {t("inbox.new")}
                  </Chip>
                )}
                <time
                  dateTime={c.updatedAt}
                  className="text-muted hidden text-[13px] whitespace-nowrap md:col-start-4 md:block md:justify-self-end md:text-end"
                >
                  {timeAgo(c.updatedAt, lang)}
                </time>
              </>
            }
            className="md:hover:bg-fill md:grid md:grid-cols-[auto_minmax(0,1fr)_4rem_6rem] md:items-center md:gap-4"
            onClick={() => onOpen(c)}
            testId="inbox-conversation"
            data-id={c.id}
            data-platform={c.platform}
          />
        );
      })}
      {noMatch && (
        <div role="status">
          <EmptyState
            icon={<Search size={24} strokeWidth={1.75} aria-hidden />}
            title={t("inbox.search.none")}
            testId="inbox-search-none"
          />
        </div>
      )}
      {loaded && conversations.length === 0 && !noMatch && (
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
