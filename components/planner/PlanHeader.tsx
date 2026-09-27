"use client";

import PxBar from "@/components/ui/PxBar";
import { useT } from "@/lib/i18n";
import type { PlanProgress, WeekPlan } from "@/lib/weekPlan";
import { formatHours, weekRange } from "./weekLabel";

/** Week label, planned time vs the 5 h budget, expected XP, craft / software / combo mix and done count. */
export default function PlanHeader({
  plan,
  progress,
  edited = false,
}: {
  plan: WeekPlan;
  progress: PlanProgress;
  /** The owner changed this week's plan by hand (overlay.ts). */
  edited?: boolean;
}) {
  const { t, lang } = useT();
  const { from, to } = weekRange(plan.week, lang);
  const ratio = plan.budgetMin > 0 ? plan.minutes / plan.budgetMin : 0;
  const over = plan.minutes > plan.budgetMin;

  return (
    <section className="px-card border-gold flex flex-col gap-3" data-testid="plan-header">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg" data-testid="plan-week">
          {t("planner.week", { from, to })}
        </h2>
        <span className="flex flex-wrap gap-1.5">
          {edited && (
            <span className="px-chip px-chip-green" data-testid="plan-edited">
              {t("planner.edited")}
            </span>
          )}
          <span className="px-chip px-chip-gold">{t("planner.thisWeek")}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label={t("planner.budget")}>
          <div
            className="flex flex-col gap-1"
            data-testid="plan-budget"
            data-minutes={plan.minutes}
            data-budget={plan.budgetMin}
          >
            <b className="num text-base">
              {formatHours(plan.minutes)} / {formatHours(plan.budgetMin)}
            </b>
            <PxBar
              value={ratio}
              color={over ? "var(--danger)" : "var(--accent)"}
              small
              label={t("planner.budget")}
            />
          </div>
        </Stat>
        <Stat label={t("planner.xp")}>
          <b className="num text-accent text-base" data-testid="plan-xp">
            +{plan.xp}
          </b>
        </Stat>
        <Stat label={t("planner.mix")}>
          <div className="flex flex-wrap gap-1" data-testid="plan-mix">
            <span className="px-chip">
              🎥 {t("planner.craft")} <span className="num">{plan.craft}</span>
            </span>
            <span className="px-chip">
              💻 {t("planner.software")} <span className="num">{plan.software}</span>
            </span>
            <span className="px-chip px-chip-gold">
              🔗 {t("planner.combo")} <span className="num">{plan.combos}</span>
            </span>
          </div>
        </Stat>
        <Stat label={t("planner.progress")}>
          <b className="num text-base" data-testid="plan-progress">
            {progress.done}/{progress.total}
          </b>
        </Stat>
      </div>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-inset flex min-w-0 flex-col gap-1">
      <span className="text-muted text-xs">{label}</span>
      {children}
    </div>
  );
}
