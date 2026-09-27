"use client";

import { weekRange } from "@/components/planner/weekLabel";
import { useT } from "@/lib/i18n";

/** ‹ › over the Sat–Fri weeks. The glyphs are bidi-mirrored, so they point the right way in RTL too. */
export default function WeekPicker({
  week,
  isCurrent,
  onPrev,
  onNext,
}: {
  week: string;
  isCurrent: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t, lang } = useT();
  const { from, to } = weekRange(week, lang);
  return (
    <section className="px-card border-gold flex items-center justify-between gap-2">
      <button
        type="button"
        className="px-btn px-btn-ghost px-btn-sm num text-lg"
        aria-label={t("review.prevWeek")}
        data-testid="review-prev"
        onClick={onPrev}
      >
        ‹
      </button>
      <div className="flex min-w-0 flex-col items-center gap-1 text-center">
        <h2 className="text-lg" data-testid="review-week" data-week={week}>
          {t("review.week", { from, to })}
        </h2>
        {isCurrent && <span className="px-chip px-chip-gold">{t("review.thisWeek")}</span>}
      </div>
      <button
        type="button"
        className="px-btn px-btn-ghost px-btn-sm num text-lg"
        aria-label={t("review.nextWeek")}
        data-testid="review-next"
        onClick={onNext}
        disabled={isCurrent}
      >
        ›
      </button>
    </section>
  );
}
