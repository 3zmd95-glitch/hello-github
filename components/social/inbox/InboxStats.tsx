"use client";

import StatTile from "@/components/ui/ios/StatTile";
import type { InboxConversation } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { conversationUnread } from "./useInbox";

/**
 * Three tiles over the lists: new messages (conversations newer than their seen mark), conversations Instagram still
 * lets us answer (the 24-hour window is open at `now`), and the comments the Worker holds. White cards on the page
 * ground like Growth's KPI row; compact on a phone.
 */
export default function InboxStats({
  conversations,
  seen,
  comments,
  countUp,
  now,
}: {
  /** The conversations of the tab on screen. */
  conversations: readonly InboxConversation[];
  seen: Record<string, string>;
  /** The Worker's stored total (the overview's count). */
  comments: number;
  countUp: boolean;
  /** When "now" is, in ms (tests pass their clock). */
  now: number;
}) {
  const { t } = useT();
  const tiles = [
    {
      id: "new",
      label: t("inbox.stats.new"),
      value: conversations.filter((c) => conversationUnread(c, seen)).length,
    },
    {
      id: "open",
      label: t("inbox.stats.open"),
      value: conversations.filter((c) => c.windowClosesAt && Date.parse(c.windowClosesAt) > now)
        .length,
    },
    { id: "comments", label: t("inbox.stats.comments"), value: comments },
  ];
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="inbox-stats">
      {tiles.map((s) => (
        <StatTile
          key={s.id}
          className="ios-card p-3 md:p-4"
          label={s.label}
          value={s.value}
          countUp={countUp}
          testId={`inbox-stat-${s.id}`}
        />
      ))}
    </div>
  );
}
