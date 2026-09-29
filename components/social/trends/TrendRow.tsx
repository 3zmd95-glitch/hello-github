"use client";

import { fmtCount } from "@/components/social/studio/platform";
import type { TrendItem } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { sourceLabel } from "@/lib/trends";
import TrendActions, { type PlannedPost } from "./TrendActions";

/**
 * One radar row (round 30, planning/tools/08-trends.md): the title, the source badge (the honesty rule: the
 * badge is `item.source` localized through `sourceLabel`, so a YouTube chart row says "YouTube charts" /
 * "قوائم YouTube" and never "trending"; `data-source` keeps the raw label), a "new on the chart" chip for
 * `new`-tagged rows, the "why" line, growth and volume when the source gives them, ⭐ when the row matches the owner's niche
 * keywords, the 💡 / 📱 taps and ✕ to dismiss.
 */
export default function TrendRow({
  item,
  star,
  onDismiss,
  onPlanned,
}: {
  item: TrendItem;
  star: boolean;
  onDismiss: () => void;
  onPlanned: (post: PlannedPost) => void;
}) {
  const { t } = useT();
  return (
    <li
      className="px-inset trend-row flex flex-col gap-2"
      data-testid="trend-row"
      data-id={item.id}
      data-platform={item.platform}
      data-region={item.region}
      data-lang={item.lang}
      data-source={item.source}
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
        {item.growthPct !== undefined && item.growthPct > 0 && (
          <span className="px-chip px-chip-t1 num" data-testid="trend-growth">
            {t("trends.growth", { n: fmtCount(Math.round(item.growthPct)) })}
          </span>
        )}
        {item.volume !== undefined && item.volume > 0 && (
          <span className="px-chip num" data-testid="trend-volume">
            {t("trends.volume", { n: fmtCount(item.volume) })}
          </span>
        )}
      </div>
      <TrendActions item={item} idPrefix="trend" onPlanned={onPlanned} />
    </li>
  );
}
