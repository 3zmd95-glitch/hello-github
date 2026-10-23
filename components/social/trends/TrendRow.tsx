"use client";

import { Search, Star, X } from "lucide-react";
import { fmtCount } from "@/components/social/growth/format";
import { formatDate } from "@/components/rewards/formatDate";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
import type { TrendItem } from "@/lib/domain";
import { useT, withoutEmoji } from "@/lib/i18n";
import { timeAgo } from "@/lib/socialSync";
import { newestProofAt, sourceLabel, volumeLabelKey, volumeUnit } from "@/lib/trends";
import TrendActions, { calendarPlatformOf, type PlannedPost } from "./TrendActions";

/**
 * One radar row (round 30, planning/tools/08-trends.md), an iOS list row (tools/18 §6): the platform badge (a
 * search icon for Google), the title, the source badge (the honesty rule: the badge is `item.source` localized
 * through `sourceLabel`, so a YouTube chart row says "YouTube charts" / "قوائم YouTube" and never "trending";
 * `data-source` keeps the raw label), a "new on the chart" chip for `new`-tagged rows, the "why" line, growth and
 * volume when the source gives them, a star when the row matches the owner's niche keywords, the save / plan taps
 * and ✕ to dismiss. The volume chip names what its number counts, by source (lib/trends `volumeLabelKey`:
 * searches on Google Trends, views on YouTube, pages for the Tavily scan, posts on trends24.in; `data-unit`
 * carries the unit), and a source without a known unit shows no volume. `data-genre` carries the row's edit-genre
 * id (round 31) when the Worker's keyword scan set one, and the row names it in a chip (`genreLabel`: "🚗 سيارات",
 * shown without its emoji: Social chips carry none, the genre's emoji stays Discover's).
 * A row the Worker declared a `kind` for (TikTok Discovery's hashtags, scout 02) shows it in a chip, the window its
 * source ranked it over (`periodDays`: "Last 7 days"), and its proof strip: up to 3 top videos as links out, each
 * with the date its own id carries (`postedAt`; a video without one shows none, no date is made up) and the newest
 * one named, so a hashtag is never claimed without something to open and a date to read.
 * The chip is plain: Discover is a Training route and nothing in Social links out of Social (tools/20). An id the
 * app does not know shows the raw id. The row's own text (title, why) takes its own direction and stays
 * aligned with the row.
 */
export default function TrendRow({
  item,
  star,
  genreLabel,
  onDismiss,
  onPlanned,
}: {
  item: TrendItem;
  star: boolean;
  /** The name of the row's genre (lib/trends `trendGenreLabel`); none for a row without a genre. */
  genreLabel?: string;
  onDismiss: () => void;
  onPlanned: (post: PlannedPost) => void;
}) {
  const { t, lang } = useT();
  const volumeKey = volumeLabelKey(item);
  const newest = newestProofAt(item);
  const platform = calendarPlatformOf(item.platform);
  const genre = genreLabel && withoutEmoji(genreLabel);
  return (
    <li
      className="ios-row items-start"
      data-testid="trend-row"
      data-id={item.id}
      data-platform={item.platform}
      data-region={item.region}
      data-lang={item.lang}
      data-source={item.source}
      data-genre={item.genre}
      data-star={star}
    >
      {platform ? (
        <PlatformBadge platform={platform} size={34} />
      ) : (
        <span className="ios-ic fill">
          <Search size={20} strokeWidth={1.75} aria-hidden />
        </span>
      )}
      <div className="ios-tx">
        <b
          dir="auto"
          className="[text-align:-webkit-match-parent] [text-align:match-parent] break-words whitespace-normal"
        >
          {star && (
            <span
              role="img"
              aria-label={t("trends.star")}
              title={t("trends.star")}
              className="text-warn me-1 inline-flex align-[-2px]"
              data-testid="trend-star"
            >
              <Star size={15} strokeWidth={1.75} className="fill-current" aria-hidden />
            </span>
          )}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink no-underline hover:underline"
              data-testid="trend-link"
            >
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </b>
        {item.why && (
          <small
            dir="auto"
            className="[text-align:-webkit-match-parent] [text-align:match-parent] break-words"
          >
            {item.why}
          </small>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="px-chip" data-testid="trend-source">
            {sourceLabel(item.source, t)}
          </span>
          {item.source === "kworb.net" && item.tags.includes("new") && (
            <span className="px-chip px-chip-gold" data-testid="trend-new">
              {t("trends.newOnChart")}
            </span>
          )}
          <span className="px-chip" data-testid="trend-platform">
            {t(`trends.platform.${item.platform}`)}
          </span>
          {item.kind === "hashtag" && (
            <span className="px-chip" data-testid="trend-kind" data-kind={item.kind}>
              {t("trends.kindOne.hashtag")}
            </span>
          )}
          {item.periodDays !== undefined && (
            <span className="px-chip" data-testid="trend-period" data-days={item.periodDays}>
              {t("trends.period", { n: item.periodDays })}
            </span>
          )}
          {genre && (
            <span
              className="px-chip"
              title={withoutEmoji(t("genres.label"))}
              data-testid="trend-genre"
              data-genre={item.genre}
            >
              {genre}
            </span>
          )}
          {item.growthPct !== undefined && item.growthPct > 0 && (
            <span className="px-chip px-chip-t1 num" data-testid="trend-growth">
              {t("trends.growth", { n: fmtCount(Math.round(item.growthPct)) })}
            </span>
          )}
          {volumeKey && item.volume !== undefined && item.volume > 0 && (
            <span className="px-chip num" data-testid="trend-volume" data-unit={volumeUnit(item)}>
              {t(volumeKey, { n: fmtCount(item.volume) })}
            </span>
          )}
        </div>
        {item.proof && item.proof.length > 0 && (
          <div
            className="mt-3 flex flex-col gap-1.5"
            data-testid="trend-proof"
            data-count={item.proof.length}
          >
            <p className="text-muted text-xs">
              {t("trends.proof.title")}
              {newest && (
                <span data-testid="trend-proof-newest">
                  {" · "}
                  {t("trends.proof.newest", { when: timeAgo(newest, lang) })}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {item.proof.map((p) => (
                <a
                  key={p.url}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex min-h-11 items-center"
                  data-testid="trend-proof-link"
                  data-posted-at={p.postedAt}
                >
                  <span className="px-chip no-underline group-hover:underline">
                    <bdi dir="ltr">{p.creator ?? "TikTok"}</bdi>
                    {p.postedAt && (
                      <span className="num">{` · ${formatDate(p.postedAt, lang)}`}</span>
                    )}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2.5">
          <TrendActions item={item} idPrefix="trend" onPlanned={onPlanned} />
        </div>
      </div>
      <button
        type="button"
        className="ios-icbtn text-muted -me-2.5 -mt-2"
        onClick={onDismiss}
        aria-label={t("trends.dismissLabel", { name: item.title })}
        title={t("trends.dismiss")}
        data-testid="trend-dismiss"
      >
        <X size={18} strokeWidth={1.75} aria-hidden />
      </button>
    </li>
  );
}
