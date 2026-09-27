"use client";

import { formatDayNumber, formatDayShort } from "@/components/planner/weekLabel";
import { useT } from "@/lib/i18n";
import type { WeekHistoryEntry } from "@/lib/weekStats";

/** Eight tiny XP bars (pure divs), oldest first; tapping one shows that week. */
export default function XpHistory({
  history,
  selected,
  onSelect,
}: {
  history: readonly WeekHistoryEntry[];
  selected: string;
  onSelect: (week: string) => void;
}) {
  const { t, lang } = useT();
  const max = history.reduce((n, w) => Math.max(n, w.xp), 0);

  return (
    <section className="px-card flex flex-col gap-3" data-testid="xp-history">
      <h2 className="text-base">{t("review.history.title")}</h2>
      <div className="rv-hist">
        {history.map((w) => {
          const pct = w.xp > 0 && max > 0 ? Math.max(8, Math.round((w.xp / max) * 100)) : 0;
          return (
            <button
              key={w.week}
              type="button"
              className="rv-bar"
              data-testid="xp-history-bar"
              data-week={w.week}
              data-xp={w.xp}
              data-on={w.xp > 0}
              aria-pressed={w.week === selected}
              aria-label={t("review.history.aria", {
                from: formatDayShort(w.week, lang),
                xp: w.xp,
                quests: w.quests,
              })}
              onClick={() => onSelect(w.week)}
            >
              <span className="num text-muted text-[0.65rem] leading-none">
                {w.xp > 0 ? w.xp : " "}
              </span>
              <span className="rv-barbox">
                <i style={{ height: `${pct}%` }} />
              </span>
              <span className="num text-[0.65rem] leading-none">{formatDayNumber(w.week)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
