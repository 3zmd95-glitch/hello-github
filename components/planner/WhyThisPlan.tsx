"use client";

import { useT } from "@/lib/i18n";

/** Collapsed "why this plan": the balance rules in plain words (the plan is deterministic, no regenerate). */
export default function WhyThisPlan() {
  const { t } = useT();
  return (
    <details className="px-card group" data-testid="plan-why">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base">🤔 {t("planner.whyTitle")}</h2>
        <span aria-hidden className="text-muted ms-auto transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ol className="text-ink-2 mt-3 flex list-decimal flex-col gap-1.5 ps-5 text-sm">
        <li>{t("planner.why1")}</li>
        <li>{t("planner.why2")}</li>
        <li>{t("planner.why3")}</li>
        <li>{t("planner.why4")}</li>
        <li>{t("planner.why5")}</li>
      </ol>
      <p className="text-muted mt-3 text-xs">{t("planner.manualSoon")}</p>
    </details>
  );
}
