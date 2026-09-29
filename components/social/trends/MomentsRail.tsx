"use client";

import { useMemo } from "react";
import { SAUDI_EVENTS } from "@/data/events";
import { useT } from "@/lib/i18n";
import { eventToTrendItem, upcomingEvents } from "@/lib/trends";
import TrendActions, { type PlannedPost } from "./TrendActions";

/** How far ahead the rail looks (days). */
const WITHIN_DAYS = 60;

/**
 * 📅 Upcoming Saudi moments (round 30, planning/tools/08-trends.md): the next two months of the static
 * calendar (data/events), each with its lead time, hashtags and the same 💡 / 📱 taps as a live trend (through
 * `eventToTrendItem`). Needs no Worker, so the radar always has something to act on.
 */
export default function MomentsRail({
  today,
  onPlanned,
}: {
  /** Riyadh day key. */
  today: string;
  onPlanned: (post: PlannedPost) => void;
}) {
  const { t, L } = useT();
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const list = useMemo(() => upcomingEvents(SAUDI_EVENTS, today, WITHIN_DAYS), [today]);

  return (
    <section
      className="flex flex-col gap-2"
      data-testid="trends-moments"
      data-count={list.length}
      aria-label={t("trends.moments")}
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="text-sm font-bold">{t("trends.moments")}</h3>
        <p className="text-muted text-xs">{t("trends.momentsSub")}</p>
      </header>
      {list.length === 0 ? (
        <p className="text-ink-2 text-sm" data-testid="trends-moments-empty">
          {t("trends.momentsEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(({ event, inDays }) => (
            <li
              key={event.id}
              className="px-inset flex flex-col gap-2"
              data-testid="trend-moment"
              data-event={event.id}
              data-in-days={inDays}
            >
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold">{L(event.name)}</p>
                <span
                  className={`px-chip shrink-0 ${inDays === 0 ? "px-chip-green" : "px-chip-gold"}`}
                  data-testid="trend-moment-when"
                >
                  {inDays === 0
                    ? t("trends.momentNow")
                    : inDays === 1
                      ? t("trends.momentTomorrow")
                      : inDays === 2
                        ? t("trends.momentTwoDays")
                        : t("trends.momentIn", { n: inDays })}
                </span>
              </div>
              {(event.hashtags.length > 0 || event.approx) && (
                <p className="text-ink-2 flex flex-wrap items-center gap-1.5 text-xs break-words">
                  {event.hashtags.map((h) => (
                    <span key={h} className="num" dir="auto">
                      {h}
                    </span>
                  ))}
                  {event.approx && (
                    <span className="px-chip px-chip-lock" title={event.note && L(event.note)}>
                      {t("trends.momentApprox")}
                    </span>
                  )}
                </p>
              )}
              <TrendActions
                item={eventToTrendItem(event, nowIso)}
                idPrefix="moment"
                onPlanned={onPlanned}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
