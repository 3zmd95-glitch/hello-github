"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { calendarPostHref, withName } from "@/components/social/studio/platform";
import { useToday } from "@/components/today/useToday";
import Chip from "@/components/ui/ios/Chip";
import Segmented from "@/components/ui/ios/Segmented";
import { TREND_PLATFORMS, type Lang, type TrendPlatform } from "@/lib/domain";
import { allGenres } from "@/lib/genres";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { timeAgo } from "@/lib/socialSync";
import {
  DEFAULT_TREND_KEYWORDS,
  matchesNiche,
  trendGenreHref,
  trendGenreLabel,
  visibleTrends,
  type TrendFilter,
} from "@/lib/trends";
import { useStore } from "@/store";
import ManualLinks from "./ManualLinks";
import MomentsRail from "./MomentsRail";
import { calendarPlatformOf, type PlannedPost } from "./TrendActions";
import TrendRow from "./TrendRow";
import { useTrends } from "./useTrends";

/** The chips: the live platforms (calendar moments have their own rail). */
const CHIP_PLATFORMS = TREND_PLATFORMS.filter((p) => p !== "event");
type PlatformFilter = TrendPlatform | "all";

/** Both keyword lists: a `mixed` row (a hashtag, an event) may match either language. */
const ALL_KEYWORDS = [...DEFAULT_TREND_KEYWORDS.ar, ...DEFAULT_TREND_KEYWORDS.en];

/**
 * Trend Radar (round 30, planning/tools/08-trends.md, planning/handovers/mastermind-2026-09-28.md): one
 * glance → one tap. The Worker's feed, split into an Arabic (Saudi) tab and an English one, filtered by
 * platform chip, niche-keyword rows first, each with save / plan / dismiss, as an iOS grouped list (tools/18 §6);
 * beside it the upcoming Saudi moments rail and the links the owner opens by hand. Without a Worker the rail and
 * the links still work and a one-line hint points at Settings.
 *
 * Round 31: the feed also carries the rows the Worker found by edit genre (cars, food, anime…). The radar
 * stays about general trends and has no genre filter: Discover is the one place for genres. A row of a genre
 * names it in a chip, and for a genre the app knows (built in, or the owner's own from Settings) the chip is
 * a link that opens Discover on that genre. The star is `matchesNiche`: the search words of a row's own genre
 * do not count (the Worker tags a row with the query that found it, and "مونتاج أكل" is not the niche).
 */
export default function TrendRadar() {
  const { t, lang } = useT();
  const today = useToday();
  const { feed, configured, loading, error, refresh } = useTrends();
  const dismissTrend = useStore((s) => s.dismissTrend);
  const customGenres = useStore((s) => s.customGenres);
  const [tab, setTab] = useState<Lang>("ar");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [planned, setPlanned] = useState<PlannedPost | null>(null);

  // Every genre the app can name: the built-in ones, then the owner's own (Settings).
  const genres = useMemo(() => allGenres(customGenres), [customGenres]);

  const rows = useMemo(() => {
    // Arabic = the Saudi feed (SA rows are `ar` by region, whatever the title's script); English = `en` rows
    // from any region (the US charts, and Tavily / X rows whose title is Latin script). `mixed` rows show under
    // both. Calendar moments (platform `event`) live only in the moments rail, never as a dismissible row.
    const filter: TrendFilter = tab === "ar" ? { region: "SA", lang: "ar" } : { lang: "en" };
    if (platform !== "all") filter.platform = platform;
    return visibleTrends(feed, filter, new Date())
      .filter((item) => item.platform !== "event")
      .map((item) => ({ item, star: matchesNiche(item, ALL_KEYWORDS, genres) }))
      .sort((a, b) => Number(b.star) - Number(a.star));
  }, [feed, tab, platform, genres]);

  const updated = feed.fetchedAt
    ? t("trends.updated", { when: timeAgo(feed.fetchedAt, lang) })
    : t("trends.neverUpdated");
  const hasFeed = feed.items.length > 0;

  return (
    <section
      className="flex flex-col gap-3"
      data-testid="ideas-trends"
      data-configured={configured}
      data-tab={tab}
      data-count={rows.length}
      data-loading={loading}
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 pe-1.5 md:justify-start">
          <h2 className="ios-gh text-[13px]">{t("trends.title")}</h2>
          <button
            type="button"
            className="ios-icbtn trends-refresh text-tint -my-2 disabled:opacity-40"
            onClick={() => void refresh()}
            disabled={loading || !configured}
            aria-label={t("trends.refresh")}
            title={t("trends.refresh")}
            aria-busy={loading}
            data-testid="trends-refresh"
          >
            <RefreshCw size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <p className="text-ink-2 px-4 text-[13px]">{t("trends.sub")}</p>
        <p className="text-muted flex flex-wrap items-center gap-2 px-4 text-xs">
          <span data-testid="trends-updated">{loading ? t("trends.loading") : updated}</span>
          {feed.degraded && (
            <Chip tone="warn" data-testid="trends-degraded">
              {t("trends.degraded")}
            </Chip>
          )}
        </p>
      </header>

      {error && (
        <p className="text-danger px-4 text-xs" data-testid="trends-error">
          {t(error)}
        </p>
      )}

      {!configured && (
        <p
          className="px-inset flex flex-wrap items-center gap-2 text-sm"
          data-testid="trends-need-worker"
        >
          <span className="min-w-0 flex-1">{t("trends.needWorker")}</span>
          <Link
            href="/settings/"
            className="px-link ios-hit text-xs"
            data-testid="trends-need-worker-link"
          >
            {t("trends.needWorkerLink")}
          </Link>
        </p>
      )}

      {planned && (
        <p
          className="px-inset flex flex-wrap items-center gap-2 text-sm"
          data-testid="trends-planned-notice"
        >
          <span className="text-tint min-w-0 flex-1">
            {withName(t("trends.planned"), planned.title)}
          </span>
          <Link
            href={calendarPostHref(planned.id)}
            className="px-link ios-hit text-xs"
            data-testid="trends-planned-open"
          >
            {t("trends.plannedOpen")}
          </Link>
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr] md:items-start">
        {(configured || hasFeed) && (
          <div className="flex min-w-0 flex-col gap-3">
            <Segmented
              role="radiogroup"
              label={t("trends.tabLabel")}
              value={tab}
              onChange={setTab}
              options={(["ar", "en"] as const).map((l) => ({
                value: l,
                label: t(`trends.tab.${l}`),
                testId: `trends-tab-${l}`,
              }))}
            />
            <div className="ios-chips" role="group" aria-label={t("trends.platformLabel")}>
              {(["all", ...CHIP_PLATFORMS] as PlatformFilter[]).map((p) => {
                const glyph = p === "all" ? undefined : calendarPlatformOf(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className="px-fchip"
                    aria-pressed={platform === p}
                    onClick={() => setPlatform(p)}
                    data-testid={`trends-platform-${p}`}
                  >
                    {glyph && <PlatformGlyph platform={glyph} size={14} className="shrink-0" />}
                    {t(`trends.platform.${p}`)}
                  </button>
                );
              })}
            </div>
            {rows.length === 0 ? (
              <p className="text-ink-2 px-4 text-[13px]" data-testid="trends-empty">
                {hasFeed ? (
                  t("trends.emptyFilter")
                ) : (
                  <RefreshHint text={t("trends.empty")} label={t("trends.refresh")} />
                )}
              </p>
            ) : (
              <ul className="ios-list" data-testid="trends-list">
                {rows.map(({ item, star }) => (
                  <TrendRow
                    key={item.id}
                    item={item}
                    star={star}
                    genreLabel={item.genre ? trendGenreLabel(item.genre, genres, lang) : undefined}
                    genreHref={item.genre ? trendGenreHref(item.genre, genres) : undefined}
                    onDismiss={() => dismissTrend(item.id)}
                    onPlanned={setPlanned}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        <aside className="flex min-w-0 flex-col gap-5">
          <MomentsRail today={today} onPlanned={setPlanned} />
          <ManualLinks />
        </aside>
      </div>
    </section>
  );
}

/** `trends.empty` points at the refresh button by its icon: the `{icon}` placeholder becomes that icon, named. */
function RefreshHint({ text, label }: { text: string; label: string }) {
  const [pre, post = ""] = text.split("{icon}");
  return (
    <>
      {pre}
      <span
        role="img"
        aria-label={label}
        title={label}
        className="text-tint inline-flex align-[-3px]"
      >
        <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
      </span>
      {post}
    </>
  );
}
