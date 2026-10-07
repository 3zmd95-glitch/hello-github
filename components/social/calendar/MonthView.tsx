"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { formatDayNumber } from "@/components/planner/weekLabel";
import type { Post } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { postsByDay } from "@/lib/social";
import { addMonths, formatDayLong, formatMonth, monthGrid } from "./dates";
import { platformStyle } from "./PlatformChip";

const SHORT_DAY_KEYS: readonly MessageKey[] = [
  "calendar.dayShort.0",
  "calendar.dayShort.1",
  "calendar.dayShort.2",
  "calendar.dayShort.3",
  "calendar.dayShort.4",
  "calendar.dayShort.5",
  "calendar.dayShort.6",
];

/**
 * Month grid in Sat-first weeks: each day a small card with its number (today in accent) and a 6px dot per post in
 * its platform color (at most four). A day with posts opens it in the week view (its posts as rows); an empty day
 * starts a new post on it.
 */
export default function MonthView({
  posts,
  monthKey,
  today,
  onMonth,
  onDay,
  onNewOn,
}: {
  posts: readonly Post[];
  monthKey: string;
  today: string;
  onMonth: (monthKey: string) => void;
  onDay: (day: string) => void;
  onNewOn: (day: string) => void;
}) {
  const { t, lang } = useT();
  const days = useMemo(() => monthGrid(monthKey), [monthKey]);
  const byDay = useMemo(() => postsByDay(posts), [posts]);
  const isCurrentMonth = today.startsWith(`${monthKey}-`);
  const title = formatMonth(monthKey, lang);

  return (
    <section className="flex flex-col gap-3" data-testid="calendar-month-view">
      <div className="flex items-center gap-1 ps-1">
        <h2 className="min-w-0 flex-1 text-[17px] font-semibold" data-testid="calendar-month">
          {title}
        </h2>
        {!isCurrentMonth && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => onMonth(today.slice(0, 7))}
            data-testid="calendar-today"
          >
            {t("calendar.jumpToday")}
          </button>
        )}
        <button
          type="button"
          className="ios-icbtn text-tint"
          onClick={() => onMonth(addMonths(monthKey, -1))}
          aria-label={t("calendar.prevMonth")}
          data-testid="calendar-prev"
        >
          <ChevronRight size={22} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
        </button>
        <button
          type="button"
          className="ios-icbtn text-tint"
          onClick={() => onMonth(addMonths(monthKey, 1))}
          aria-label={t("calendar.nextMonth")}
          data-testid="calendar-next"
        >
          <ChevronLeft size={22} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
        </button>
      </div>

      <div className="cal-month" role="grid" aria-label={title}>
        {SHORT_DAY_KEYS.map((key) => (
          <div key={key} className="cal-mhead" role="columnheader">
            {t(key)}
          </div>
        ))}
        {days.map((day) => {
          const items = byDay[day] ?? [];
          const label = formatDayLong(day, lang);
          return (
            <div
              key={day}
              role="gridcell"
              className="month-day"
              data-testid="month-day"
              data-day={day}
              data-today={day === today}
              data-outside={!day.startsWith(`${monthKey}-`)}
            >
              <button
                type="button"
                onClick={() => (items.length ? onDay(day) : onNewOn(day))}
                aria-label={
                  items.length
                    ? `${label} · ${t("calendar.summary.planned", { n: items.length })}`
                    : t("calendar.dayAdd", { day: label })
                }
                aria-current={day === today ? "date" : undefined}
                data-testid="month-day-add"
              >
                <b className="num">{formatDayNumber(day)}</b>
                <span className="flex h-1.5 gap-[3px]">
                  {items.slice(0, 4).map((post) => (
                    <i
                      key={post.id}
                      className="studio-pdot"
                      style={platformStyle(post.platform)}
                      data-testid="month-chip"
                      data-post={post.id}
                      data-platform={post.platform}
                      data-stage={post.stage}
                    />
                  ))}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
