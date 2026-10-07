"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { dayKeyToDate, formatDayNumber } from "@/components/planner/weekLabel";
import Card, { CardHead, HeadLink } from "@/components/ui/ios/Card";
import Chip from "@/components/ui/ios/Chip";
import { useT } from "@/lib/i18n";
import { postsForWeek, unplannedPosts, weekPlanSummary } from "@/lib/social";
import { TIME_ZONE, weekKey } from "@/lib/streak";
import { useStore } from "@/store";
import { calendarPostHref } from "./platform";

/**
 * This week's posting plan (Sat–Fri): seven day cells (weekday letter, date, today in accent, a dot per post in its
 * platform color, at most four), then "posted/total" and "without a day" chips. A day with posts opens it in the
 * calendar: the post itself when it is the only one, else the day. Today's cell is `aria-current="date"`.
 */
export default function WeekPlanCard({ today }: { today: string }) {
  const { t, lang } = useT();
  const posts = useStore((s) => s.posts);
  const week = useMemo(() => weekKey(today), [today]);
  const summary = useMemo(() => weekPlanSummary(posts, week), [posts, week]);
  const weekPosts = useMemo(() => postsForWeek(posts, week), [posts, week]);
  const unplanned = useMemo(() => unplannedPosts(posts).length, [posts]);
  // Arabic shows the one-letter weekday (س ح ن …) like the mockup; English keeps "Sat" (one letter repeats there).
  const names = useMemo(() => {
    const locale = lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB";
    const fmt = (weekday: "narrow" | "short" | "long") =>
      new Intl.DateTimeFormat(locale, { weekday, timeZone: TIME_ZONE });
    return { label: fmt(lang === "ar" ? "narrow" : "short"), full: fmt("long") };
  }, [lang]);

  return (
    <Card testId="studio-week" data-total={summary.total} data-posted={summary.posted}>
      <CardHead title={t("social.studio.week")}>
        <HeadLink href="/social/calendar/" testId="studio-week-open">
          {t("social.studio.weekOpen")}
        </HeadLink>
      </CardHead>

      <ol className="studio-week" aria-label={t("social.studio.week")}>
        {summary.perDay.map(({ day, count }) => {
          const dayPosts = weekPosts.filter((p) => p.plannedDay === day);
          const date = dayKeyToDate(day);
          const cell = {
            className: "studio-wday",
            "data-today": day === today,
            "data-count": count,
            "data-day": day,
            "aria-current": day === today ? ("date" as const) : undefined,
          };
          const body = (
            <>
              <small>
                <span aria-hidden>{names.label.format(date)}</span>
                <span className="sr-only">{names.full.format(date)}</span>
              </small>
              <b className="num">{formatDayNumber(day)}</b>
              <span className="flex h-1.5 gap-[3px]">
                {dayPosts.slice(0, 4).map((p) => (
                  <i
                    key={p.id}
                    className="studio-pdot"
                    style={{ "--pc": `var(--pc-${p.platform})` } as CSSProperties}
                    title={p.title}
                    data-platform={p.platform}
                    data-testid="studio-week-post"
                  />
                ))}
              </span>
            </>
          );
          return (
            <li key={day}>
              {dayPosts.length > 0 ? (
                <Link
                  href={
                    dayPosts.length === 1
                      ? calendarPostHref(dayPosts[0].id)
                      : `/social/calendar/#day=${day}`
                  }
                  {...cell}
                >
                  {body}
                </Link>
              ) : (
                <div {...cell}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>

      {summary.total === 0 && (
        <p className="text-ink-2 mt-2 text-[13px]" data-testid="studio-week-empty">
          {t("social.studio.weekEmpty")}
        </p>
      )}
      {(summary.total > 0 || unplanned > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summary.total > 0 && (
            <Chip
              tone="tint"
              icon={<Check size={12} strokeWidth={1.75} aria-hidden />}
              data-testid="studio-week-count"
            >
              {t("social.studio.weekPosted", { p: summary.posted, n: summary.total })}
            </Chip>
          )}
          {unplanned > 0 && (
            <Chip data-testid="studio-week-unplanned">
              <span className="num">{unplanned}</span> {t("calendar.unplanned")}
            </Chip>
          )}
        </div>
      )}
    </Card>
  );
}
