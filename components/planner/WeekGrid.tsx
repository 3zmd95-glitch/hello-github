"use client";

import type { QuestType } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { addDays } from "@/lib/streak";
import { isItemDone, type PlanItem, type WeekPlan } from "@/lib/weekPlan";
import PlanItemCard from "./PlanItemCard";
import { formatDayNumber } from "./weekLabel";

const DAY_KEYS: readonly MessageKey[] = [
  "planner.day.0",
  "planner.day.1",
  "planner.day.2",
  "planner.day.3",
  "planner.day.4",
  "planner.day.5",
  "planner.day.6",
];

/** The seven days Sat → Fri: a vertical list on phones, 4 then 7 columns from md / lg up (globals.css). */
export default function WeekGrid({
  plan,
  today,
  done,
  onTick,
  onOpen,
}: {
  plan: WeekPlan;
  /** 0..6 when the plan's week is the current one; -1 otherwise. */
  today: number;
  done: ReadonlyMap<string, ReadonlySet<QuestType>>;
  onTick: (item: PlanItem, proof?: string) => void;
  onOpen: (skillId: string) => void;
}) {
  const { t } = useT();
  return (
    <ol className="plan-week" data-testid="plan-week-grid">
      {DAY_KEYS.map((key, day) => {
        const items = plan.items.filter((i) => i.day === day);
        const minutes = items.reduce((n, i) => n + i.minutes, 0);
        const isToday = day === today;
        return (
          <li
            key={day}
            className="px-card plan-day flex flex-col gap-2 p-3"
            data-testid="plan-day"
            data-day={day}
            data-today={isToday}
          >
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <b className={isToday ? "text-gold" : ""}>{t(key)}</b>
              <span className="num text-muted text-xs">
                {formatDayNumber(addDays(plan.week, day))}
              </span>
              {isToday && (
                <span className="px-chip px-chip-gold ms-auto">{t("planner.today")}</span>
              )}
            </header>
            <span className="text-muted text-xs">
              ⏱ <span className="num">{minutes}</span> {t("planner.min")}
            </span>
            {items.length === 0 ? (
              <p className="text-muted text-xs">{t("planner.rest")}</p>
            ) : (
              items.map((item) => (
                <PlanItemCard
                  key={item.id}
                  item={item}
                  done={isItemDone(item, done)}
                  onTick={onTick}
                  onOpen={onOpen}
                />
              ))
            )}
          </li>
        );
      })}
    </ol>
  );
}
