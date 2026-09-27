"use client";

import { weekRange } from "@/components/planner/weekLabel";
import type { Review } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { MOOD_EMOJI, asMood, moodKey } from "./moods";

/** Every saved review, newest week first; the week label jumps the screen to that week. */
export default function PastReviews({
  reviews,
  onSelect,
}: {
  reviews: readonly Review[];
  onSelect: (week: string) => void;
}) {
  const { t, lang } = useT();
  const sorted = [...reviews].sort((a, b) => b.week.localeCompare(a.week));

  return (
    <section className="px-card flex flex-col gap-3" data-testid="past-reviews">
      <h2 className="text-base">{t("review.past.title")}</h2>
      {sorted.length === 0 ? (
        <p className="text-muted text-sm">{t("review.past.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((r) => {
            const { from, to } = weekRange(r.week, lang);
            const m = asMood(r.mood);
            return (
              <li
                key={r.week}
                className="px-inset flex flex-col gap-1"
                data-testid="past-review"
                data-week={r.week}
                data-mood={r.mood}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="px-link text-start text-sm font-bold"
                    aria-label={t("review.past.open", { from })}
                    onClick={() => onSelect(r.week)}
                  >
                    {t("review.week", { from, to })}
                  </button>
                  <span className="text-xl leading-none" role="img" aria-label={t(moodKey(m))}>
                    {MOOD_EMOJI[m]}
                  </span>
                </div>
                <Line icon="✓" text={r.wins} />
                <Line icon="⚠" text={r.blocks} muted />
                <Line icon="🎯" text={r.next} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Line({ icon, text, muted }: { icon: string; text: string; muted?: boolean }) {
  const { t } = useT();
  return (
    <span className={`text-xs break-words ${muted || !text ? "text-muted" : ""}`}>
      <span aria-hidden>{icon}</span> {text || t("review.empty")}
    </span>
  );
}
