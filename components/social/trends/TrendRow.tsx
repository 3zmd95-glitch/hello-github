"use client";

import Link from "next/link";
import { fmtCount } from "@/components/social/studio/platform";
import type { TrendItem } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { sourceLabel, volumeLabelKey, volumeUnit } from "@/lib/trends";
import TrendActions, { type PlannedPost } from "./TrendActions";

/**
 * One radar row (round 30, planning/tools/08-trends.md): the title, the source badge (the honesty rule: the
 * badge is `item.source` localized through `sourceLabel`, so a YouTube chart row says "YouTube charts" /
 * "قوائم YouTube" and never "trending"; `data-source` keeps the raw label), a "new on the chart" chip for
 * `new`-tagged rows, the "why" line, growth and volume when the source gives them, ⭐ when the row matches
 * the owner's niche keywords, the 💡 / 📱 taps and ✕ to dismiss. The volume chip names what its number
 * counts, by source (lib/trends `volumeLabelKey`: searches on Google Trends, views on YouTube, pages for the
 * Tavily scan, posts on trends24.in; `data-unit` carries the unit), and a source without a known unit shows
 * no volume. `data-genre` carries the row's edit-genre id (round 31) when the Worker's keyword scan set one,
 * and the row names it in a chip (`genreLabel`: "🚗 سيارات"). Discover is the one place for genres, so for a genre the app knows the chip is a link that opens Discover on it
 * (`genreHref`), looking like the row's other chips; its accessible name says where it goes
 * (`trends.genreOpen`) and its tap area reaches a little above and below the chip, which is small for a
 * thumb. An id the app does not know stays a plain chip with the raw id.
 */
export default function TrendRow({
  item,
  star,
  genreLabel,
  genreHref,
  onDismiss,
  onPlanned,
}: {
  item: TrendItem;
  star: boolean;
  /** The name of the row's genre (lib/trends `trendGenreLabel`); none for a row without a genre. */
  genreLabel?: string;
  /** Discover opened on the row's genre (lib/trends `trendGenreHref`); none for a genre the app does not know. */
  genreHref?: string;
  onDismiss: () => void;
  onPlanned: (post: PlannedPost) => void;
}) {
  const { t } = useT();
  const volumeKey = volumeLabelKey(item);
  return (
    <li
      className="px-inset trend-row flex flex-col gap-2"
      data-testid="trend-row"
      data-id={item.id}
      data-platform={item.platform}
      data-region={item.region}
      data-lang={item.lang}
      data-source={item.source}
      data-genre={item.genre}
      data-star={star}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold break-words" dir="auto">
            {star && (
              <span aria-label={t("trends.star")} title={t("trends.star")} className="me-1">
                ⭐
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
          </p>
          {item.why && (
            <p className="text-ink-2 text-xs break-words" dir="auto">
              {item.why}
            </p>
          )}
        </div>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          onClick={onDismiss}
          aria-label={t("trends.dismissLabel", { name: item.title })}
          title={t("trends.dismiss")}
          data-testid="trend-dismiss"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
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
        {genreLabel &&
          (genreHref ? (
            <Link
              href={genreHref}
              className="px-chip relative no-underline after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
              aria-label={t("trends.genreOpen", { genre: genreLabel })}
              title={t("trends.genreOpen", { genre: genreLabel })}
              data-testid="trend-genre"
              data-genre={item.genre}
            >
              {genreLabel}
            </Link>
          ) : (
            <span
              className="px-chip"
              title={t("genres.label")}
              data-testid="trend-genre"
              data-genre={item.genre}
            >
              {genreLabel}
            </span>
          ))}
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
      <TrendActions item={item} idPrefix="trend" onPlanned={onPlanned} />
    </li>
  );
}
