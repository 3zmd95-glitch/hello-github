"use client";

import Link from "next/link";
import { useMemo } from "react";
import { dayKeyToDate, formatDayNumber } from "@/components/planner/weekLabel";
import { PLATFORMS, type Lang } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { postsForWeek, weekPlanSummary } from "@/lib/social";
import { TIME_ZONE, weekKey } from "@/lib/streak";
import { useStore } from "@/store";
import { PlatformChip, PlatformDot, calendarPostHref } from "./platform";

const weekdayShort = (key: string, lang: Lang): string =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB", {
    weekday: "short",
    timeZone: TIME_ZONE,
  }).format(dayKeyToDate(key));

/** This week's posting plan (Sat–Fri): a day strip with platform dots, posted/total and per-platform chips. */
export default function WeekPlanCard({ today }: { today: string }) {
  const { t, lang } = useT();
  const posts = useStore((s) => s.posts);
  const week = useMemo(() => weekKey(today), [today]);
  const summary = useMemo(() => weekPlanSummary(posts, week), [posts, week]);
  const weekPosts = useMemo(() => postsForWeek(posts, week), [posts, week]);
  const active = PLATFORMS.filter((p) => summary.byPlatform[p].planned > 0);

  return (
    <section
      className="px-card flex flex-col gap-3"
      data-testid="studio-week"
      data-total={summary.total}
      data-posted={summary.posted}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base">{t("social.studio.week")}</h2>
        <div className="flex items-center gap-3">
          {summary.total > 0 && (
            <span className="text-ink-2 text-xs" data-testid="studio-week-count">
              {t("social.studio.weekPosted", { p: summary.posted, n: summary.total })}
            </span>
          )}
          <Link
            href="/social/calendar/"
            className="px-link text-xs no-underline"
            data-testid="studio-week-open"
          >
            {t("social.studio.weekOpen")}
          </Link>
        </div>
      </header>

      <ol className="studio-week" aria-label={t("social.studio.week")}>
        {summary.perDay.map(({ day, count }) => (
          <li
            key={day}
            className="studio-wday"
            data-today={day === today}
            data-count={count}
            data-day={day}
          >
            <b className="text-xs">{weekdayShort(day, lang)}</b>
            <span className="num text-muted text-xs">{formatDayNumber(day)}</span>
            <span className="flex flex-wrap justify-center gap-1">
              {weekPosts
                .filter((p) => p.plannedDay === day)
                .map((p) => (
                  <Link
                    key={p.id}
                    href={calendarPostHref(p.id)}
                    className="no-underline"
                    data-testid="studio-week-post"
                  >
                    <PlatformDot platform={p.platform} title={p.title} />
                  </Link>
                ))}
            </span>
          </li>
        ))}
      </ol>

      {summary.total === 0 ? (
        <p className="text-ink-2 text-sm" data-testid="studio-week-empty">
          {t("social.studio.weekEmpty")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {active.map((p) => (
            <span key={p} className="flex items-center gap-1 text-xs">
              <PlatformChip platform={p} />
              <span className="num text-ink-2">
                {summary.byPlatform[p].posted}/{summary.byPlatform[p].planned}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
