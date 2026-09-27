"use client";

import { useT } from "@/lib/i18n";

/** Trends: the scan arrives with the AI coach (Sprint 4); until then this card only says so. */
export default function TrendsCard() {
  const { t } = useT();
  return (
    <section className="px-card flex flex-col gap-2" data-testid="ideas-trends">
      <div className="flex items-center gap-2">
        <h2 className="text-base">{t("ideas.trends")}</h2>
        <span className="px-chip">{t("nav.soon")}</span>
      </div>
      <p className="text-ink-2 text-sm">{t("ideas.trendsSoon")}</p>
    </section>
  );
}
