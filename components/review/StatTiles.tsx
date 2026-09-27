"use client";

import { formatDayNumber, formatHours } from "@/components/planner/weekLabel";
import { useT, type MessageKey } from "@/lib/i18n";
import { addDays } from "@/lib/streak";
import type { WeekStats } from "@/lib/weekStats";

const DAY_KEYS: readonly MessageKey[] = [
  "review.day.0",
  "review.day.1",
  "review.day.2",
  "review.day.3",
  "review.day.4",
  "review.day.5",
  "review.day.6",
];

/** XP (+ delta), quests with the craft/software split, active days with 7 dots, focus time. */
export default function StatTiles({
  stats,
  prev,
  todayIndex,
}: {
  stats: WeekStats;
  prev: WeekStats;
  /** 0..6 when the shown week is the current one; -1 otherwise. */
  todayIndex: number;
}) {
  const { t } = useT();
  const delta = stats.xp - prev.xp;
  const total = stats.craftQuests + stats.softwareQuests;
  const craftPct = total ? Math.round((stats.craftQuests / total) * 100) : 0;
  const active = new Set(stats.activeDays);

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Tile label={t("review.stat.xp")} testId="stat-xp" data={{ "data-xp": stats.xp }}>
        <b className="num text-accent text-xl">{stats.xp}</b>
        <span
          className={`text-xs ${delta > 0 ? "text-accent" : delta < 0 ? "text-danger" : "text-muted"}`}
          data-testid="stat-xp-delta"
        >
          {delta > 0
            ? t("review.stat.deltaUp", { n: delta })
            : delta < 0
              ? t("review.stat.deltaDown", { n: -delta })
              : t("review.stat.deltaSame")}
        </span>
      </Tile>

      <Tile
        label={t("review.stat.quests")}
        testId="stat-quests"
        data={{ "data-craft": stats.craftQuests, "data-software": stats.softwareQuests }}
      >
        <b className="num text-xl">{stats.quests}</b>
        <div
          className="rv-split"
          role="img"
          aria-label={t("review.stat.split", {
            craft: stats.craftQuests,
            software: stats.softwareQuests,
          })}
        >
          <i data-kind="craft" style={{ width: `${craftPct}%` }} />
          <i data-kind="software" style={{ width: `${total ? 100 - craftPct : 0}%` }} />
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="px-chip">
            <i className="px-pip" style={{ background: "var(--sky)" }} aria-hidden />
            {t("review.craft")} <span className="num">{stats.craftQuests}</span>
          </span>
          <span className="px-chip">
            <i className="px-pip" style={{ background: "var(--accent)" }} aria-hidden />
            {t("review.software")} <span className="num">{stats.softwareQuests}</span>
          </span>
        </div>
      </Tile>

      <Tile
        label={t("review.stat.days")}
        testId="stat-days"
        data={{ "data-active": stats.activeDays.length }}
      >
        <b className="num text-xl">{stats.activeDays.length}/7</b>
        <ul className="flex gap-1.5" aria-label={t("review.stat.days")}>
          {DAY_KEYS.map((key, i) => {
            const dayKeyOf = addDays(stats.week, i);
            const on = active.has(dayKeyOf);
            const day = t(key);
            return (
              <li key={key} className="flex flex-col items-center gap-0.5">
                <span
                  className="px-pip rv-dot"
                  data-on={on}
                  data-today={i === todayIndex}
                  data-testid="day-dot"
                  data-day={i}
                  role="img"
                  aria-label={t(on ? "review.dayActive" : "review.dayIdle", { day })}
                  title={i === todayIndex ? `${day} · ${t("review.today")}` : day}
                />
                <span
                  aria-hidden
                  className={`num text-[0.55rem] leading-none ${i === todayIndex ? "text-gold" : "text-muted"}`}
                >
                  {formatDayNumber(dayKeyOf)}
                </span>
              </li>
            );
          })}
        </ul>
      </Tile>

      <Tile
        label={t("review.stat.focus")}
        testId="stat-focus"
        data={{ "data-minutes": stats.focusMinutes }}
      >
        <b className="num text-xl">{formatHours(stats.focusMinutes)}</b>
        <span className="text-muted text-xs">🧪 {t("review.stat.focusHint")}</span>
      </Tile>
    </div>
  );
}

function Tile({
  label,
  testId,
  data,
  children,
}: {
  label: string;
  testId: string;
  data?: Record<string, string | number>;
  children: React.ReactNode;
}) {
  return (
    <div className="px-inset flex min-w-0 flex-col gap-1" data-testid={testId} {...data}>
      <span className="text-muted text-xs">{label}</span>
      {children}
    </div>
  );
}
