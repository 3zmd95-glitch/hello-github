"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { formatDayNumber, formatDayShort, weekRange } from "@/components/planner/weekLabel";
import Card from "@/components/ui/ios/Card";
import Chip from "@/components/ui/ios/Chip";
import { ListGroup } from "@/components/ui/ios/List";
import { PLATFORMS, type Post } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { PlatformGlyph } from "@/lib/platformIcons";
import {
  overduePosts,
  PLATFORM_META,
  postsByDay,
  unplannedPosts,
  weekPlanSummary,
} from "@/lib/social";
import { addDays } from "@/lib/streak";
import { weekdayLetters } from "./dates";
import { platformStyle } from "./PlatformChip";
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

/** The strip's weeks, as day offsets from `weekStart`: last week, this week (in view at rest), next week. */
const STRIP = [-7, 0, 7] as const;

/** One week's scroll distance on the strip (a week plus the gap): it overflows by two of them. */
const stride = (el: HTMLElement) => (el.scrollWidth - el.clientWidth) / 2;

/**
 * One week (Sat → Fri, Riyadh): a strip card on top (the range with ‹ › and "today", then three weeks side by side
 * that swipe and snap a week at a time, each day a `.studio-wday` cell with a dot per post; a swipe that comes to rest
 * on last or next week moves the view there, and the strip re-centers on it), the week's per-platform tally, then the
 * posts grouped by day as iOS rows, and the unplanned group. A picked day (a tap on the strip, or `#day=`) fills its
 * cell and the list scrolls to its group.
 */
export default function WeekView({
  posts,
  weekStart,
  today,
  focusDay,
  onWeek,
  onDay,
  onOpen,
  onNewOn,
}: {
  /** Already filtered by platform. */
  posts: readonly Post[];
  weekStart: string;
  today: string;
  focusDay: string | null;
  onWeek: (weekStart: string) => void;
  onDay: (day: string) => void;
  onOpen: (id: string) => void;
  onNewOn: (day: string | null) => void;
}) {
  const { t, L, lang } = useT();
  const byDay = useMemo(() => postsByDay(posts), [posts]);
  const overdue = useMemo(() => new Set(overduePosts(posts).map((p) => p.id)), [posts]);
  const unplanned = useMemo(() => unplannedPosts(posts), [posts]);
  const summary = useMemo(() => weekPlanSummary(posts, weekStart), [posts, weekStart]);
  const letters = useMemo(() => weekdayLetters(lang), [lang]);
  const range = weekRange(weekStart, lang);
  const isCurrentWeek = today >= weekStart && today <= addDays(weekStart, 6);
  const dayLabel = (day: string, i: number) => `${t(DAY_KEYS[i])} ${formatDayShort(day, lang)}`;

  // The strip rests on its middle week: set before the first paint, after every week change (the old next week is
  // the new middle one, so nothing moves on screen) and on a resize. scrollLeft, not scrollIntoView: that one would
  // also scroll the page to show the whole strip. An RTL strip counts scrollLeft down from 0.
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const center = () => {
      el.scrollLeft = (getComputedStyle(el).direction === "rtl" ? -1 : 1) * stride(el);
    };
    center();
    const ro = new ResizeObserver(center);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weekStart]);

  // A swipe moves the view once the strip has come to rest exactly on last or next week (120ms without a scroll
  // event; Safari has no scrollend). A finger holding the strip half-way is not on a week, so nothing jumps under it.
  const settle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  const onStripScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = strip.current;
      if (!el) return;
      const page = Math.abs(el.scrollLeft) / stride(el);
      if (Math.abs(page - Math.round(page)) > 0.01 || Math.round(page) === 1) return;
      onWeek(addDays(weekStart, page < 1 ? -7 : 7));
    }, 120);
  };

  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusDay) return;
    root.current
      ?.querySelector(`.cal-dgroup[data-day="${focusDay}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [focusDay, weekStart]);

  return (
    <section ref={root} className="flex flex-col gap-3" data-testid="calendar-week-view">
      <Card className="flex flex-col gap-2.5">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            {/* Plain text, not .num: an LTR-isolated "3 أكتوبر" would put the month before the day in Arabic. */}
            <b className="block text-[17px] font-semibold" data-testid="calendar-week">
              {range.from} – {range.to}
            </b>
            <span className="text-ink-2 block text-[13px]" data-testid="calendar-summary">
              {t("calendar.summary.planned", { n: summary.total })} ·{" "}
              {t("calendar.summary.posted", { n: summary.posted })}
            </span>
          </div>
          {!isCurrentWeek && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              onClick={() => onWeek(today)}
              data-testid="calendar-today"
            >
              {t("calendar.jumpToday")}
            </button>
          )}
          <button
            type="button"
            className="ios-icbtn text-tint"
            onClick={() => onWeek(addDays(weekStart, -7))}
            aria-label={t("calendar.prevWeek")}
            data-testid="calendar-prev"
          >
            <ChevronRight size={22} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
          </button>
          <button
            type="button"
            className="ios-icbtn text-tint"
            onClick={() => onWeek(addDays(weekStart, 7))}
            aria-label={t("calendar.nextWeek")}
            data-testid="calendar-next"
          >
            <ChevronLeft size={22} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
          </button>
        </div>

        <div
          ref={strip}
          className="ios-weeks"
          onScroll={onStripScroll}
          data-testid="calendar-strip"
        >
          {STRIP.map((offset) => {
            const start = addDays(weekStart, offset);
            const r = weekRange(start, lang);
            return (
              // Last and next week are inert (no tab stops, hidden from screen readers) until they become this week.
              <ol
                key={start}
                className="studio-week"
                inert={offset !== 0}
                aria-label={`${r.from} – ${r.to}`}
              >
                {DAY_KEYS.map((_, i) => {
                  const day = addDays(start, i);
                  const items = byDay[day] ?? [];
                  return (
                    <li key={day}>
                      <button
                        type="button"
                        className="cal-day studio-wday"
                        onClick={() => onDay(day)}
                        aria-label={
                          items.length
                            ? `${dayLabel(day, i)} · ${t("calendar.summary.planned", { n: items.length })}`
                            : dayLabel(day, i)
                        }
                        aria-pressed={day === focusDay}
                        aria-current={day === today ? "date" : undefined}
                        data-testid="calendar-strip-day"
                        data-day={day}
                        data-today={day === today}
                        data-count={items.length}
                      >
                        <small aria-hidden>{letters[i]}</small>
                        <b className="num">{formatDayNumber(day)}</b>
                        <span className="flex h-1.5 gap-[3px]">
                          {items.slice(0, 4).map((p) => (
                            <i
                              key={p.id}
                              className="studio-pdot"
                              style={platformStyle(p.platform)}
                              data-platform={p.platform}
                            />
                          ))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            );
          })}
        </div>
        <p className="text-muted text-center text-xs lg:hidden">{t("calendar.weekHint")}</p>

        {summary.total > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("calendar.summary.title")}>
            {PLATFORMS.filter((p) => summary.byPlatform[p].planned > 0).map((p) => {
              const s = summary.byPlatform[p];
              return (
                <li
                  key={p}
                  title={t("calendar.summary.platform", {
                    platform: L(PLATFORM_META[p].name),
                    planned: s.planned,
                    posted: s.posted,
                  })}
                  data-testid="summary-platform"
                  data-platform={p}
                >
                  <Chip icon={<PlatformGlyph platform={p} size={12} className="shrink-0" />}>
                    <span className="num">
                      {s.posted}/{s.planned}
                    </span>
                  </Chip>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-3" data-testid="calendar-week-grid">
        {DAY_KEYS.map((_, i) => {
          const day = addDays(weekStart, i);
          const items = byDay[day] ?? [];
          const isToday = day === today;
          return (
            <ListGroup
              key={day}
              header={dayLabel(day, i)}
              className="cal-dgroup"
              testId="calendar-day"
              data-day={day}
              data-today={isToday}
              data-focus={day === focusDay}
              trailing={
                <span className="flex items-center gap-1">
                  {isToday && <Chip tone="tint">{t("calendar.today")}</Chip>}
                  <button
                    type="button"
                    className="ios-icbtn text-tint -my-2 -me-2.5"
                    onClick={() => onNewOn(day)}
                    aria-label={t("calendar.dayAdd", { day: dayLabel(day, i) })}
                    data-testid="day-add"
                    data-day={day}
                  >
                    <Plus size={20} strokeWidth={1.75} aria-hidden />
                  </button>
                </span>
              }
            >
              {items.length === 0 ? (
                <p className="cal-none">{t("calendar.emptyDay")}</p>
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
            </ListGroup>
          );
        })}
      </div>

      {unplanned.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="calendar-unplanned">
          <ListGroup
            header={t("calendar.unplanned")}
            trailing={
              <Chip>
                <span className="num">{unplanned.length}</span>
              </Chip>
            }
          >
            {unplanned.map((post) => (
              <PostCard key={post.id} post={post} onOpen={onOpen} />
            ))}
          </ListGroup>
          <p className="text-ink-2 px-4 text-[13px]">{t("calendar.unplannedHint")}</p>
        </div>
      )}
    </section>
  );
}
