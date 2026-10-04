"use client";

import { useId, useState, type ReactNode } from "react";
import {
  creatorsOn,
  hiddenCount,
  popularItems,
  sectionItems,
  type DiscoverAlternative,
  type DiscoverAnswer,
  type DiscoverItem,
  type DiscoverPlatform,
  type DiscoverPlatformStatus,
  type DiscoverSection,
  type PicksTopic,
} from "@/lib/discover";
import { useT, type MessageKey } from "@/lib/i18n";
import type { ResearchItem, ResearchTab, SortMode } from "@/lib/research";
import PicksSection from "./PicksSection";
import ResultCard, { PLATFORM_META } from "./ResultCard";

const SHOW = 6;
const TAVILY_HOME = "https://app.tavily.com/";

const toItem = (i: DiscoverItem): ResearchItem => ({
  platform: i.platform,
  handle: i.handle,
  title: i.title,
  snippet: i.snippet,
  url: i.url,
  ...(i.thumb ? { thumb: i.thumb } : {}),
  ...(i.stats ? { stats: i.stats } : {}),
});

/**
 * Discover v2 (round 33, planning/tools/13-discover-search-v2.md): how the search was understood (and the other
 * meanings), ⭐ Claude's picks for the topic when the connector saved some, one line per platform that failed, the
 * Popular now strip, Examples, Tutorials and Creators (each section 6 cards, then "Show more"), and the off-topic
 * cards behind a count. The platform tab filters every part.
 */
export default function DiscoverSections({
  answer,
  q,
  tab,
  sort,
  arFirst,
  headingLevel,
  renderAction,
  onAlternative,
  onRetry,
  picks,
}: {
  answer: DiscoverAnswer;
  q: string;
  tab: ResearchTab;
  sort: SortMode;
  arFirst: boolean;
  headingLevel: "h2" | "h3";
  renderAction: (item: ResearchItem) => ReactNode;
  onAlternative: (alt: DiscoverAlternative) => void;
  onRetry: () => void;
  /** Claude's picks saved for this answer's topic. */
  picks?: PicksTopic;
}) {
  const { t, L } = useT();
  const ids = useId();
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Record<DiscoverSection, boolean>>({
    example: false,
    tutorial: false,
  });
  const H = headingLevel;
  const view = { tab, showHidden };
  const hidden = hiddenCount(answer, tab);
  const popular = popularItems(answer, view);
  const creators = creatorsOn(answer, tab);
  const pickItems = picks?.items.filter((p) => tab === "all" || p.platform === tab) ?? [];
  const failed = (
    Object.entries(answer.platforms) as [DiscoverPlatform, DiscoverPlatformStatus | undefined][]
  ).flatMap(([p, s]) =>
    s && !s.ok && (tab === "all" || tab === p) ? [{ p, error: s.error }] : [],
  );
  const quota = failed.some((f) => f.error === "quota");

  const card = (i: DiscoverItem, className?: string) => (
    <ResultCard
      key={i.url}
      item={toItem(i)}
      action={
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {i.offTopic && (
            <span className="px-chip text-xs" data-testid="discover-offtopic-chip">
              {t("search.offTopicChip")}
            </span>
          )}
          {renderAction(toItem(i))}
        </span>
      }
      {...(className ? { className } : {})}
    />
  );

  const section = (s: DiscoverSection, title: MessageKey) => {
    const list = sectionItems(answer, s, { ...view, sort, arFirst });
    if (!list.length) return null;
    const shown = open[s] ? list : list.slice(0, SHOW);
    return (
      <section
        aria-labelledby={`${ids}-${s}`}
        className="flex flex-col gap-2"
        data-testid={`discover-section-${s}`}
        data-count={list.length}
      >
        <H id={`${ids}-${s}`} className="text-sm">
          {t(title)}
        </H>
        <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
          {shown.map((i) => card(i))}
        </ul>
        {list.length > SHOW && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm w-fit"
            aria-expanded={open[s]}
            onClick={() => setOpen((o) => ({ ...o, [s]: !o[s] }))}
            data-testid={`discover-more-${s}`}
          >
            {open[s] ? t("search.showLess") : t("search.showMore", { n: list.length - SHOW })}
          </button>
        )}
      </section>
    );
  };

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="discover-sections"
      data-topic={answer.topicKey}
    >
      <div
        className="flex flex-wrap items-center gap-1.5 text-xs"
        data-testid="discover-understood"
      >
        <span className="text-ink-2">
          {answer.understood.exact
            ? t("search.exactNow", { q })
            : `${t("search.understood", { label: L(answer.understood.label) })} · ${t("search.bothLangs")}`}
        </span>
        {answer.alternatives.length > 0 && (
          <span className="text-muted">{t("search.notThis")}</span>
        )}
        {answer.alternatives.map((alt) => (
          <button
            key={"exact" in alt ? "exact" : alt.termId}
            type="button"
            className="px-fchip"
            onClick={() => onAlternative(alt)}
            data-testid={"exact" in alt ? "discover-alt-exact" : `discover-alt-${alt.termId}`}
          >
            {"exact" in alt ? t("search.exactly", { q }) : L(alt.label)}
          </button>
        ))}
        {answer.cached && (
          <span className="text-muted ms-auto" data-testid="discover-cached">
            {t("search.cached")}
          </span>
        )}
      </div>

      {picks && pickItems.length > 0 && (
        <PicksSection
          topic={{ ...picks, items: pickItems }}
          headingLevel={headingLevel}
          renderAction={renderAction}
        />
      )}

      {quota && (
        <div
          className="px-tile border-edge flex flex-wrap items-center gap-2 rounded-[2px] border-2 p-2 text-xs"
          data-testid="discover-credits-out"
        >
          <span>{t("search.creditsOut")}</span>
          <a href={TAVILY_HOME} target="_blank" rel="noopener noreferrer" className="px-link">
            {t("search.creditsOutLink")}
          </a>
        </div>
      )}
      {failed
        .filter((f) => f.error !== "quota")
        .map(({ p, error }) => {
          const name = PLATFORM_META[p].label;
          return (
            <div
              key={p}
              className="text-muted flex flex-wrap items-center gap-2 text-xs"
              data-testid={`discover-down-${p}`}
              data-error={error}
            >
              <span>
                {error === "daily_cap"
                  ? t("search.ytBackTomorrow")
                  : error === "auth"
                    ? t("search.platformAuth", { platform: name })
                    : error === "not_configured"
                      ? t("search.platformNotSet", { platform: name })
                      : t("search.platformDown", { platform: name })}
              </span>
              {error === "upstream" && (
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={onRetry}
                  data-testid={`discover-retry-${p}`}
                >
                  {t("search.retry")}
                </button>
              )}
            </div>
          );
        })}

      {popular.length > 0 && (
        <section
          aria-labelledby={`${ids}-popular`}
          className="flex min-w-0 flex-col gap-1.5"
          data-testid="discover-popular"
          data-count={popular.length}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <H id={`${ids}-popular`} className="text-sm">
              {t("search.popular")}
            </H>
            <p className="text-muted text-xs">{t("search.popularSource")}</p>
          </div>
          <ul className="flex min-w-0 snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-0.5 pb-2">
            {popular.map((i) => card(i, "w-60 shrink-0 snap-start"))}
          </ul>
        </section>
      )}

      {section("example", "search.examples")}
      {section("tutorial", "search.tutorials")}

      {creators.length > 0 && (
        <section
          aria-labelledby={`${ids}-creators`}
          className="flex flex-col gap-2"
          data-testid="discover-creators"
          data-count={creators.length}
        >
          <H id={`${ids}-creators`} className="text-sm">
            {t("search.creators")}
          </H>
          <ul className="flex flex-wrap gap-2">
            {creators.map((c) => (
              // The account's page: two YouTube channels can share a name.
              <li key={c.url}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-chip flex items-center gap-1.5"
                  dir="ltr"
                  data-testid="discover-creator"
                >
                  <span aria-hidden>{PLATFORM_META[c.platform].glyph}</span>
                  <span>{c.handle}</span>
                  <span className="text-muted text-[11px]">
                    {c.count === 1
                      ? t("search.creatorCountOne")
                      : c.count > 0
                        ? t("search.creatorCount", { n: c.count })
                        : t("search.creatorProfile")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hidden > 0 && (
        <p
          className="text-muted flex flex-wrap items-center gap-2 text-xs"
          data-testid="discover-hidden"
          data-count={hidden}
        >
          <span>{t("search.hidden", { n: hidden })}</span>
          <button
            type="button"
            className="px-link"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            data-testid="discover-hidden-toggle"
          >
            {showHidden ? t("search.hideHidden") : t("search.showHidden")}
          </button>
        </p>
      )}
    </div>
  );
}
