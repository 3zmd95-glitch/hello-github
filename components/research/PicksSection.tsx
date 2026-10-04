"use client";

import { useId, type ReactNode } from "react";
import type { ClaudePick, PicksTopic } from "@/lib/discover";
import { useT } from "@/lib/i18n";
import type { ResearchItem } from "@/lib/research";
import ResultCard from "./ResultCard";

const toItem = (p: ClaudePick): ResearchItem => ({
  platform: p.platform,
  handle: p.handle ?? "",
  title: p.title,
  snippet: "",
  url: p.url,
  ...(p.thumb ? { thumb: p.thumb } : {}),
});

/**
 * ⭐ Claude's picks (the connector's `save_picks`): the posts and Claude's note on each, one swipeable row. A
 * YouTube pick brings its picture; a TikTok card asks the Worker's /oembed for its own; Instagram shows its tile.
 */
export default function PicksSection({
  topic,
  headingLevel,
  renderAction,
  showTopic = false,
}: {
  topic: PicksTopic;
  headingLevel: "h2" | "h3";
  renderAction: (item: ResearchItem) => ReactNode;
  /**
   * Say which topic the picks are for, in the heading (so the section's name): the empty Discover lists several
   * topics, and their headings should read apart.
   */
  showTopic?: boolean;
}) {
  const { t } = useT();
  const id = useId();
  const H = headingLevel;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-1.5"
      data-testid="discover-picks"
      data-topic={topic.topicKey}
    >
      <H id={id} className="text-sm">
        {t("search.picks")}
        {showTopic && (
          <>
            {" "}
            <span className="text-muted ms-1 text-xs font-normal" dir="auto">
              {t("search.picksTopic", { topic: topic.topic })}
            </span>
          </>
        )}
      </H>
      <ul className="flex min-w-0 snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-0.5 pb-2">
        {topic.items.map((p) => {
          const item = toItem(p);
          return (
            <ResultCard
              key={p.url}
              item={item}
              className="w-60 shrink-0 snap-start"
              action={
                <span className="flex min-w-0 flex-col gap-1">
                  {p.note && (
                    <span
                      className="text-ink-2 text-xs"
                      dir="auto"
                      data-testid="discover-pick-note"
                    >
                      «{p.note}»
                    </span>
                  )}
                  {renderAction(item)}
                </span>
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
