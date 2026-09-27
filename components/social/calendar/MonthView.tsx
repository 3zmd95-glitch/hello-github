"use client";

import { useMemo } from "react";
import { formatDayNumber } from "@/components/planner/weekLabel";
import type { Post } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { PLATFORM_META, postsByDay } from "@/lib/social";
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
 * Month grid in Sat-first weeks; posts are small platform chips (icon, and the title from md up). Tap a chip
 * to open the post, tap the day itself to start a new post on that day.
 */
export default function MonthView({
  posts,
  monthKey,
  today,
  onMonth,
  onOpen,
  onNewOn,
}: {
  posts: readonly Post[];
  monthKey: string;
  today: string;
  onMonth: (monthKey: string) => void;
  onOpen: (id: string) => void;
  onNewOn: (day: string) => void;
}) {
  const { t, lang, dir } = useT();
  const days = useMemo(() => monthGrid(monthKey), [monthKey]);
  const byDay = useMemo(() => postsByDay(posts), [posts]);
  const prevGlyph = dir === "rtl" ? "›" : "‹";
  const nextGlyph = dir === "rtl" ? "‹" : "›";
  const isCurrentMonth = today.startsWith(`${monthKey}-`);

  return (
    <section className="flex flex-col gap-3" data-testid="calendar-month-view">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm num"
          onClick={() => onMonth(addMonths(monthKey, -1))}
          aria-label={t("calendar.prevMonth")}
          data-testid="calendar-prev"
        >
          {prevGlyph}
        </button>
        <b className="text-sm" data-testid="calendar-month">
          {formatMonth(monthKey, lang)}
        </b>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm num"
          onClick={() => onMonth(addMonths(monthKey, 1))}
          aria-label={t("calendar.nextMonth")}
          data-testid="calendar-next"
        >
          {nextGlyph}
        </button>
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
      </div>

      <div className="px-card cal-month-wrap p-2 sm:p-3">
        <div className="cal-month" role="grid" aria-label={formatMonth(monthKey, lang)}>
          {SHORT_DAY_KEYS.map((key) => (
            <div
              key={key}
              className="text-muted pb-1 text-center text-[0.68rem] font-bold"
              role="columnheader"
            >
              {t(key)}
            </div>
          ))}
          {days.map((day) => {
            const items = byDay[day] ?? [];
            const outside = !day.startsWith(`${monthKey}-`);
            const isToday = day === today;
            const label = formatDayLong(day, lang);
            return (
              <div
                key={day}
                role="gridcell"
                className="month-day"
                data-testid="month-day"
                data-day={day}
                data-today={isToday}
                data-outside={outside}
                onClick={() => onNewOn(day)}
              >
                <button
                  type="button"
                  className="num month-num"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewOn(day);
                  }}
                  aria-label={t("calendar.dayAdd", { day: label })}
                  data-testid="month-day-add"
                >
                  {formatDayNumber(day)}
                </button>
                {items.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className="month-chip"
                    style={platformStyle(post.platform)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(post.id);
                    }}
                    title={post.title}
                    aria-label={t("calendar.card.open", { title: post.title })}
                    data-testid="month-chip"
                    data-post={post.id}
                    data-platform={post.platform}
                    data-stage={post.stage}
                  >
                    <span aria-hidden>{PLATFORM_META[post.platform].icon}</span>
                    <span className="hidden truncate md:inline">{post.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
