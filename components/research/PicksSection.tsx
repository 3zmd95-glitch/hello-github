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
  /** Say which topic the picks are for (the empty Discover lists several): it is part of the section's name. */
  showTopic?: boolean;
}) {
  const { t } = useT();
  const id = useId();
  const H = headingLevel;
  return (
    <section
      aria-labelledby={showTopic ? `${id} ${id}-topic` : id}
      className="flex min-w-0 flex-col gap-1.5"
      data-testid="discover-picks"
      data-topic={topic.topicKey}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <H id={id} className="text-sm">
          {t("search.picks")}
        </H>
        {showTopic && (
          <p id={`${id}-topic`} className="text-muted text-xs" dir="auto">
            {t("search.picksTopic", { topic: topic.topic })}
          </p>
        )}
      </div>
      <ul className="flex min-w-0 snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-0.5 pb-2">
        {topic.items.map((p) => (
          <ResultCard
            key={p.url}
            item={toItem(p)}
            className="w-60 shrink-0 snap-start"
            action={
              <span className="flex min-w-0 flex-col gap-1">
                {p.note && (
                  <span className="text-ink-2 text-xs" dir="auto" data-testid="discover-pick-note">
                    “{p.note}”
                  </span>
                )}
                {renderAction(toItem(p))}
              </span>
            }
          />
        ))}
      </ul>
    </section>
  );
}
