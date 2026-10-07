"use client";

import { MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { HeadLink } from "@/components/ui/ios/Card";
import EmptyState from "@/components/ui/ios/EmptyState";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import { topAsks } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";
import { withNum } from "./platform";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Top 3 "what people want" asks with their counts, as a grouped list; each can become an idea in the bank. The
 * button then morphs into the "in the ideas bank" chip with a pop, and the chip takes the button's focus. An ask is
 * the audience's own words: its line takes the direction of its text (`dir="auto"`), so the cut lands at its end in
 * either language, while it stays aligned with the row.
 */
export default function AsksCard() {
  const { t, L } = useT();
  const asks = useStore((s) => s.audienceAsks);
  const ideas = useStore((s) => s.ideas);
  const addIdea = useStore((s) => s.addIdea);
  const top = useMemo(() => topAsks(asks, 3), [asks]);
  const inIdeas = useMemo(
    () => new Set(ideas.filter((i) => i.source === "audience").map((i) => norm(i.text))),
    [ideas],
  );
  const [converted, setConverted] = useState<string | null>(null);
  const chipRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (converted) chipRef.current?.focus();
  }, [converted]);

  return (
    <ListGroup
      header={t("social.studio.asks")}
      testId="studio-asks"
      data-empty={top.length === 0}
      trailing={
        <HeadLink href="/social/growth/" testId="studio-asks-open">
          {t("social.studio.asksOpen")}
        </HeadLink>
      }
    >
      {top.length === 0 ? (
        <EmptyState
          icon={<MessageCircle size={24} strokeWidth={1.75} aria-hidden />}
          title={t("social.studio.asksEmpty")}
          testId="studio-asks-empty"
        />
      ) : (
        top.map((ask) => {
          const just = converted === ask.id;
          return (
            <ListRow
              key={ask.id}
              icon={<MessageCircle size={22} strokeWidth={1.75} aria-hidden />}
              title={
                <span
                  dir="auto"
                  // Aligned by the row (the parent's direction); Chromium only knows the prefixed value.
                  className="block truncate [text-align:-webkit-match-parent] [text-align:match-parent]"
                >
                  {ask.text}
                </span>
              }
              sub={
                <>
                  <span data-testid="ask-count">
                    {withNum(t("social.studio.asksMentions"), ask.count)}
                  </span>
                  {ask.platform && ` · ${L(PLATFORM_META[ask.platform].name)}`}
                </>
              }
              trailing={
                inIdeas.has(norm(ask.text)) ? (
                  <Link
                    ref={just ? chipRef : undefined}
                    href="/social/ideas/"
                    // A 44px tall hit area around the 24px chip, inside the row.
                    className={`ios-chip tint relative no-underline after:absolute after:inset-x-0 after:-inset-y-2.5 ${just ? "ios-pop" : ""}`}
                    data-testid="ask-in-ideas"
                  >
                    {t("social.studio.asksInIdeas")}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    onClick={() => {
                      addIdea({
                        text: ask.text,
                        source: "audience",
                        ...(ask.platform ? { platform: ask.platform } : {}),
                      });
                      setConverted(ask.id);
                    }}
                    data-testid="ask-to-idea"
                  >
                    <Sparkles size={14} strokeWidth={1.75} aria-hidden />
                    {t("social.studio.asksToIdea")}
                  </button>
                )
              }
              testId="ask-row"
              data-ask={ask.id}
            />
          );
        })
      )}
    </ListGroup>
  );
}
