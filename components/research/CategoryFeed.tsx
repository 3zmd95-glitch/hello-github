"use client";

import { useId, useState, type ReactNode } from "react";
import type { DiscoverItem, DiscoverPlatform } from "@/lib/discover";
import type { DiscoverSourceDiagnostic } from "@/lib/discoverExpansion";
import { discoverFeedbackCreator } from "@/lib/discoverFeed";
import type { DiscoverEvidence, DiscoverFeedMode } from "@/lib/discoverRanking";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ResearchItem, ResearchTab } from "@/lib/research";
import ResultCard from "./ResultCard";
import FeedSearchStatus from "./FeedSearchStatus";

const PAGE_SIZE = 12;
const MODES: Record<DiscoverFeedMode, MessageKey> = {
  inspiration: "feed.inspiration",
  popular: "feed.popular",
  learning: "feed.learning",
  explore: "feed.explore",
};
const HELP: Record<DiscoverFeedMode, MessageKey> = {
  inspiration: "feed.inspirationHelp",
  popular: "feed.popularHelp",
  learning: "feed.learningHelp",
  explore: "feed.exploreHelp",
};
export type FeedFeedbackAction = "more" | "less" | "hide-creator";

/** Ranking and persistence belong to the parent; changing this view never starts a search. */
export interface CategoryFeedProps {
  genre: string;
  heading?: string;
  help?: string;
  testId?: string;
  intro?: ReactNode;
  diagnostics?: DiscoverSourceDiagnostic[];
  quotaPlatforms?: DiscoverPlatform[];
  categoryForItem?: (item: DiscoverItem) => { label: string; onPick: () => void } | undefined;
  mode: DiscoverFeedMode;
  onMode: (mode: DiscoverFeedMode) => void;
  items: DiscoverItem[];
  evidence: Record<string, DiscoverEvidence>;
  tab: ResearchTab;
  renderAction: (item: ResearchItem) => ReactNode;
  onFeedback: (item: DiscoverItem, action: FeedFeedbackAction) => void;
  likedUrls: ReadonlySet<string>;
  undo?: { action: FeedFeedbackAction; onUndo: () => void };
  onFindMore?: () => void;
  onRefill?: () => void;
  refilling?: boolean;
  canRefill?: boolean;
  refillCost?: { tavilyMax: number; youtubeSearchMax: number };
  findingMore: boolean;
  canFindMore: boolean;
  checking?: boolean;
  loading?: boolean;
  searchCost: number;
  exploreCount: number;
}

const feedbackLine: Record<FeedFeedbackAction, MessageKey> = {
  more: "feed.moreSaved",
  less: "feed.lessSaved",
  "hide-creator": "feed.creatorHidden",
};

export default function CategoryFeed(props: CategoryFeedProps) {
  const { t } = useT();
  const id = useId();
  const items = props.items.filter((item) => props.tab === "all" || item.platform === props.tab);
  const quotaReached = props.quotaPlatforms?.some(
    (platform) => props.tab === "all" || platform === props.tab,
  );
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      data-testid={props.testId ?? "category-feed"}
      data-mode={props.mode}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg" id={`${id}-title`}>
          {props.heading ?? t("feed.title", { genre: props.genre })}
        </h2>
        <p className="text-muted text-xs" data-testid="feed-count">
          {t("feed.count", { n: items.length })}
        </p>
      </div>
      <div
        role="group"
        aria-label={t("feed.modes")}
        className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
      >
        {(Object.keys(MODES) as DiscoverFeedMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`px-btn px-btn-sm min-w-0 justify-center ${props.mode === mode ? "px-btn-gold" : "px-btn-ghost"}`}
            aria-pressed={props.mode === mode}
            onClick={() => props.onMode(mode)}
            data-testid={`feed-mode-${mode}`}
          >
            {t(MODES[mode])}
          </button>
        ))}
      </div>
      <p className="text-muted text-xs" data-testid="feed-help">
        {props.help ?? t(HELP[props.mode])}
      </p>
      {props.mode === "popular" && (
        <details className="text-muted text-xs" data-testid="feed-policy">
          <summary className="px-link w-fit cursor-pointer">{t("feed.policy")}</summary>
          <p className="mt-1">{t("feed.popularPolicy")}</p>
        </details>
      )}
      {props.intro}
      {props.diagnostics && <FeedSearchStatus diagnostics={props.diagnostics} tab={props.tab} />}
      {(props.loading || props.checking) && (
        <p className="text-muted text-xs" role="status" data-testid="feed-checking">
          {t(props.loading ? "feed.loading" : "feed.checking")}
        </p>
      )}
      {props.undo && (
        <div
          className="border-edge bg-panel-2 flex flex-wrap items-center gap-2 border-s-2 p-2 text-xs"
          role="status"
          data-testid="feed-feedback-status"
        >
          <span>{t(feedbackLine[props.undo.action])}</span>
          <button
            type="button"
            className="px-link font-bold"
            onClick={props.undo.onUndo}
            data-testid="feed-undo"
          >
            {t("feed.undo")}
          </button>
        </div>
      )}
      <FeedCards key={`${props.mode}|${props.tab}`} {...props} items={items} />
      {items.length < 4 && !props.loading && !props.checking && (
        <p className="text-muted text-xs" data-testid="feed-shortage">
          {items.length
            ? t("feed.shortage")
            : t(
                props.mode === "popular"
                  ? "feed.emptyPopular"
                  : props.mode === "learning"
                    ? "feed.emptyLearning"
                    : "feed.empty",
              )}
        </p>
      )}
      {props.mode !== "explore" &&
        items.length < 4 &&
        props.exploreCount > items.length &&
        !props.loading &&
        !props.checking && (
          <button
            type="button"
            className="px-link w-fit text-start text-xs"
            onClick={() => props.onMode("explore")}
            data-testid="feed-explore-leads"
          >
            {t("feed.exploreLeads", { n: props.exploreCount })}
          </button>
        )}
      {props.onFindMore && (
        <div className="border-edge flex min-w-0 flex-col items-start gap-1.5 border-t pt-3">
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={props.onFindMore}
            disabled={
              props.loading ||
              props.findingMore ||
              props.refilling ||
              !props.canFindMore ||
              quotaReached
            }
            data-testid="feed-find-more"
          >
            {t(props.findingMore ? "feed.findingMore" : "feed.findMore")}
          </button>
          <p className="text-muted text-xs">
            {t(
              quotaReached
                ? "feed.quotaHelp"
                : props.canFindMore
                  ? "feed.findMoreHelp"
                  : "feed.noMore",
            )}
          </p>
          {props.canFindMore && (
            <p className="text-muted text-xs">{t("feed.searchCost", { n: props.searchCost })}</p>
          )}
          {props.onRefill && props.refillCost && (
            <details className="mt-1 max-w-full text-xs" data-testid="feed-refill-options">
              <summary className="px-link cursor-pointer">{t("feed.refillOptions")}</summary>
              <div className="mt-2 flex flex-col items-start gap-2">
                <p className="text-muted">{t("feed.refillHelp")}</p>
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={props.onRefill}
                  disabled={
                    props.loading || props.findingMore || props.refilling || !props.canRefill
                  }
                  data-testid="feed-refill"
                >
                  {t(props.refilling ? "feed.findingMore" : "feed.refill")}
                </button>
                <p className="text-muted">
                  {t("feed.refillCost", {
                    web: props.refillCost.tavilyMax,
                    youtube: props.refillCost.youtubeSearchMax,
                  })}
                </p>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function FeedCards(props: CategoryFeedProps) {
  const { t } = useT();
  const [shown, setShown] = useState(PAGE_SIZE);
  return (
    <>
      <ul
        className="grid min-w-0 grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3"
        data-testid="feed-list"
        aria-busy={props.checking || props.findingMore}
      >
        {props.items.slice(0, shown).map((item) => {
          const evidence = props.evidence[item.url];
          const category = props.categoryForItem?.(item);
          return (
            <ResultCard
              key={item.url}
              item={item}
              collapseDuplicateSnippet
              testId="feed-card"
              action={
                <div className="flex w-full min-w-0 flex-col gap-2">
                  {props.likedUrls.has(item.url) && (
                    <span className="text-gold text-xs" data-testid="feed-personal-choice">
                      {t("feed.personalChoice")}
                    </span>
                  )}
                  {category && (
                    <button
                      type="button"
                      className="px-link w-fit text-start text-xs"
                      onClick={category.onPick}
                      data-testid="feed-category"
                    >
                      {category.label}
                    </button>
                  )}
                  <p className="text-muted text-[11px]" data-testid="feed-source-note">
                    {t(
                      evidence?.sourceTier === "direct"
                        ? "feed.sourceRead"
                        : props.likedUrls.has(item.url)
                          ? "feed.personalUnverified"
                          : evidence?.sourceTier === "indexed"
                            ? "feed.indexed"
                            : "feed.noEvidence",
                    )}
                  </p>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {props.renderAction(item)}
                  </div>
                  <div
                    role="group"
                    aria-label={t("feed.feedbackLabel")}
                    className="flex min-w-0 flex-wrap items-center gap-1.5"
                  >
                    <button
                      type="button"
                      className="px-fchip text-xs"
                      aria-pressed={props.likedUrls.has(item.url)}
                      onClick={() => props.onFeedback(item, "more")}
                      data-testid="feed-more-like"
                    >
                      {t("feed.moreLike")}
                    </button>
                    <button
                      type="button"
                      className="px-link text-xs"
                      onClick={() => props.onFeedback(item, "less")}
                      data-testid="feed-not-useful"
                    >
                      {t("feed.less")}
                    </button>
                    {!!discoverFeedbackCreator(item) && (
                      <button
                        type="button"
                        className="px-link text-xs"
                        onClick={() => props.onFeedback(item, "hide-creator")}
                        data-testid="feed-hide-creator"
                      >
                        {t("feed.hideCreator")}
                      </button>
                    )}
                  </div>
                  <details className="text-xs" data-testid="feed-why">
                    <summary className="px-link w-fit cursor-pointer">{t("feed.why")}</summary>
                    {!!evidence?.techniques.length && (
                      <p className="mt-1" dir="auto">
                        {t("feed.technique", {
                          techniques: evidence.techniques.slice(0, 3).join(" · "),
                        })}
                      </p>
                    )}
                    {evidence?.reasons.includes("personal-interest") && (
                      <p className="mt-1">{t("feed.personal")}</p>
                    )}
                    <p className="text-muted mt-1">{t("feed.localOnly")}</p>
                  </details>
                </div>
              }
            />
          );
        })}
      </ul>
      {props.items.length > shown && (
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm w-fit"
          onClick={() => setShown((n) => n + PAGE_SIZE)}
          data-testid="feed-show-more"
        >
          {t("feed.showMore", { n: Math.min(PAGE_SIZE, props.items.length - shown) })}
        </button>
      )}
    </>
  );
}
