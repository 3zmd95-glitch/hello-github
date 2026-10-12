"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Genre } from "@/lib/domain";
import {
  discoverFeedbackCreator,
  discoverFeedbackForItem,
  savedDiscoverInterests,
  type DiscoverFeedbackUndo,
} from "@/lib/discoverFeed";
import { discoverForYou } from "@/lib/discoverForYou";
import type { DiscoverFeedMode } from "@/lib/discoverRanking";
import { useT } from "@/lib/i18n";
import type { ResearchItem } from "@/lib/research";
import { useStore } from "@/store";
import CategoryFeed, { type FeedFeedbackAction } from "./CategoryFeed";
import { useCreatorExpansion } from "./useCreatorExpansion";
import CreatorExpansionAction, { CreatorExpansionStatus } from "./CreatorExpansionAction";

/** A local view of already-found posts. Browsing, ranking and feedback never fetch candidates. */
export default function ForYouFeed({
  genres,
  categoryPicker,
  onCategory,
  renderAction,
}: {
  genres: readonly Genre[];
  categoryPicker: ReactNode;
  onCategory: (id: string) => void;
  renderAction: (item: ResearchItem) => ReactNode;
}) {
  const { t, L, lang } = useT();
  const candidates = useStore((s) => s.discoverCandidates);
  const feedback = useStore((s) => s.discoverFeedback);
  const inspirations = useStore((s) => s.inspirations);
  const setFeedback = useStore((s) => s.setDiscoverFeedback);
  const undoFeedback = useStore((s) => s.undoDiscoverFeedback);
  const savedInterests = useMemo(() => savedDiscoverInterests(inspirations), [inspirations]);
  const [mode, setMode] = useState<DiscoverFeedMode>("inspiration");
  const [now, setNow] = useState(() => Date.now());
  const [undo, setUndo] = useState<{ action: FeedFeedbackAction; token: DiscoverFeedbackUndo }>();
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const feed = useMemo(
    () => discoverForYou(candidates, { mode, feedback, savedInterests, now }),
    [candidates, mode, feedback, savedInterests, now],
  );
  const byUrl = new Map(feed.rows.map((row) => [row.item.url, row]));
  const creatorExpansion = useCreatorExpansion({
    rows: feed.rows,
    active: true,
    context: "for-you",
    mode,
    lang,
  });
  return (
    <CategoryFeed
      testId="for-you-feed"
      heading={t("feed.forYou")}
      help={mode === "inspiration" ? t("feed.forYouHelp") : undefined}
      genre=""
      mode={mode}
      onMode={setMode}
      items={feed.rows.map((row) => row.item)}
      evidence={Object.fromEntries(feed.rows.map((row) => [row.item.url, row.evidence]))}
      tab="all"
      renderAction={renderAction}
      renderCreatorAction={(item) => {
        const row = byUrl.get(item.url);
        return row ? <CreatorExpansionAction queue={creatorExpansion} row={row} /> : null;
      }}
      categoryForItem={(item) => {
        const row = byUrl.get(item.url);
        const genre = genres.find((candidate) => candidate.id === row?.genreId);
        return genre
          ? { label: `${genre.emoji} ${L(genre.name)}`, onPick: () => onCategory(genre.id) }
          : undefined;
      }}
      intro={
        <>
          <CreatorExpansionStatus queue={creatorExpansion} />
          <details
            key={feed.rows.length ? "populated" : "empty"}
            open={feed.rows.length ? undefined : true}
            className="border-edge border-y py-2"
            data-testid="browse-categories"
          >
            <summary className="w-fit cursor-pointer text-sm font-bold">
              {t("feed.chooseCategory")}
            </summary>
            <p className="text-muted my-2 text-xs">{t("feed.chooseCategoryHelp")}</p>
            {categoryPicker}
          </details>
        </>
      }
      likedUrls={
        new Set(
          feed.rows
            .filter(
              (row) => discoverFeedbackForItem(feedback, row.item, row.genreId)?.action === "more",
            )
            .map((row) => row.item.url),
        )
      }
      onFeedback={(item, action) => {
        const row = byUrl.get(item.url);
        if (!row) return;
        setNow(Date.now());
        const token = setFeedback({
          url: item.url,
          platform: item.platform,
          creator: discoverFeedbackCreator(item),
          genreId: row.genreId,
          techniques: row.evidence.techniques,
          action,
        });
        if (token) setUndo({ action, token });
      }}
      undo={
        undo
          ? {
              action: undo.action,
              onUndo: () => {
                undoFeedback(undo.token);
                setUndo(undefined);
              },
            }
          : undefined
      }
      findingMore={false}
      canFindMore={false}
      searchCost={0}
      exploreCount={0}
    />
  );
}
