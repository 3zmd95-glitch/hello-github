"use client";

import { useEffect, useMemo, useRef } from "react";
import { formatDayNumber, weekRange } from "@/components/planner/weekLabel";
import { PLATFORMS, type Post } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  overduePosts,
  PLATFORM_META,
  postsByDay,
  postsForWeek,
  unplannedPosts,
  weekPlanSummary,
} from "@/lib/social";
import { addDays } from "@/lib/streak";
import { formatDayLong } from "./dates";
import PostCard from "./PostCard";

const DAY_KEYS: readonly MessageKey[] = [
  "calendar.day.0",
  "calendar.day.1",
  "calendar.day.2",
  "calendar.day.3",
  "calendar.day.4",
  "calendar.day.5",
  "calendar.day.6",
];

/**
 * Sat → Fri of one week (Riyadh): a vertical list on phones, 2 columns from sm, 7 from lg. Today is
 * highlighted; a `focusDay` (from `#day=`) gets an accent outline and is scrolled into view. Below the grid:
 * the "unplanned" tray and the week summary from `weekPlanSummary`.
 */
export default function WeekView({
  posts,
  weekStart,
  today,
  focusDay,
  onWeek,
  onOpen,
  onNewOn,
}: {
  /** Already filtered by platform. */
  posts: readonly Post[];
  weekStart: string;
  today: string;
  focusDay: string | null;
  onWeek: (weekStart: string) => void;
  onOpen: (id: string) => void;
  onNewOn: (day: string | null) => void;
}) {
  const { t, L, lang, dir } = useT();
  const week = useMemo(() => postsForWeek(posts, weekStart), [posts, weekStart]);
  const byDay = useMemo(() => postsByDay(week), [week]);
  const overdue = useMemo(() => new Set(overduePosts(posts).map((p) => p.id)), [posts]);
  const unplanned = useMemo(() => unplannedPosts(posts), [posts]);
  const summary = useMemo(() => weekPlanSummary(posts, weekStart), [posts, weekStart]);
  const range = weekRange(weekStart, lang);
  const isCurrentWeek = today >= weekStart && today <= addDays(weekStart, 6);

  const focusRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focusDay) focusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusDay, weekStart]);

  const prevGlyph = dir === "rtl" ? "›" : "‹";
  const nextGlyph = dir === "rtl" ? "‹" : "›";

  return (
    <section className="flex flex-col gap-3" data-testid="calendar-week-view">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm num"
          onClick={() => onWeek(addDays(weekStart, -7))}
          aria-label={t("calendar.prevWeek")}
          data-testid="calendar-prev"
        >
          {prevGlyph}
        </button>
        <b className="text-sm" data-testid="calendar-week">
          <span className="num">{range.from}</span> – <span className="num">{range.to}</span>
        </b>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm num"
          onClick={() => onWeek(addDays(weekStart, 7))}
          aria-label={t("calendar.nextWeek")}
          data-testid="calendar-next"
        >
          {nextGlyph}
        </button>
        {!isCurrentWeek && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => onWeek(addDays(today, 0))}
            data-testid="calendar-today"
          >
            {t("calendar.jumpToday")}
          </button>
        )}
        <span className="text-muted ms-auto text-xs" data-testid="calendar-summary">
          {t("calendar.summary.planned", { n: summary.total })} ·{" "}
          {t("calendar.summary.posted", { n: summary.posted })}
        </span>
      </div>

      {summary.total > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("calendar.summary.title")}>
          {PLATFORMS.filter((p) => summary.byPlatform[p].planned > 0).map((p) => {
            const s = summary.byPlatform[p];
            return (
              <li
                key={p}
                className="px-chip"
                title={t("calendar.summary.platform", {
                  platform: L(PLATFORM_META[p].name),
                  planned: s.planned,
                  posted: s.posted,
                })}
                data-testid="summary-platform"
                data-platform={p}
              >
                <span aria-hidden>{PLATFORM_META[p].icon}</span>
                <span className="num">
                  {s.posted}/{s.planned}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ol className="cal-week" data-testid="calendar-week-grid">
        {DAY_KEYS.map((key, i) => {
          const day = addDays(weekStart, i);
          const items = byDay[day] ?? [];
          const isToday = day === today;
          const isFocus = day === focusDay;
          return (
            <li
              key={day}
              ref={isFocus ? focusRef : undefined}
              className="px-card cal-day flex flex-col gap-2 p-3"
              data-testid="calendar-day"
              data-day={day}
              data-today={isToday}
              data-focus={isFocus}
            >
              <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <b className={isToday ? "text-accent" : ""}>{t(key)}</b>
                <span className="num text-muted text-xs">{formatDayNumber(day)}</span>
                {isToday && (
                  <span className="px-chip px-chip-green ms-auto">{t("calendar.today")}</span>
                )}
              </header>
              {items.length === 0 ? (
                <p className="text-muted text-xs">{t("calendar.emptyDay")}</p>
              ) : (
                items.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    overdue={overdue.has(post.id)}
                    onOpen={onOpen}
                  />
                ))
              )}
              <button
                type="button"
                className="text-muted hover:text-accent mt-auto self-start text-xs"
                onClick={() => onNewOn(day)}
                aria-label={t("calendar.dayAdd", { day: formatDayLong(day, lang) })}
                data-testid="day-add"
                data-day={day}
              >
                {t("calendar.new")}
              </button>
            </li>
          );
        })}
      </ol>

      {unplanned.length > 0 && (
        <section className="px-card flex flex-col gap-2" data-testid="calendar-unplanned">
          <header className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-base">📥 {t("calendar.unplanned")}</h2>
            <span className="num text-muted text-xs">{unplanned.length}</span>
          </header>
          <p className="text-muted text-xs">{t("calendar.unplannedHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unplanned.map((post) => (
              <PostCard key={post.id} post={post} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
