"use client";

import { useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import { formatDayShort } from "@/components/planner/weekLabel";
import type { Review } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { dayKey } from "@/lib/streak";
import { useStore } from "@/store";
import { MOOD_EMOJI, MOODS, asMood, moodKey, type Mood } from "./moods";

/**
 * Mood + three questions for the shown week. The first save of a week goes through the store's XP path
 * (+10 XP, toast); a saved review shows read-only with an edit toggle that updates it without XP.
 * Mount with `key={week}` so the draft resets when the week changes.
 */
export default function ReflectionForm({ week, review }: { week: string; review?: Review }) {
  const { t, lang } = useT();
  const { saveReview } = useGameActions();
  const updateReview = useStore((s) => s.updateReview);

  const [editing, setEditing] = useState(false);
  const [mood, setMood] = useState<Mood | null>(review ? asMood(review.mood) : null);
  const [wins, setWins] = useState(review?.wins ?? "");
  const [blocks, setBlocks] = useState(review?.blocks ?? "");
  const [next, setNext] = useState(review?.next ?? "");

  const startEdit = () => {
    if (!review) return;
    setMood(asMood(review.mood));
    setWins(review.wins);
    setBlocks(review.blocks);
    setNext(review.next);
    setEditing(true);
  };

  const save = () => {
    if (mood === null) return;
    const draft = { mood, wins: wins.trim(), blocks: blocks.trim(), next: next.trim() };
    if (review) updateReview(week, draft);
    else saveReview({ week, ...draft });
    setEditing(false);
  };

  if (review && !editing) {
    const m = asMood(review.mood);
    return (
      <section className="px-card flex flex-col gap-3" data-testid="review-saved" data-week={week}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base">{t("review.reflect.title")}</h2>
          <span className="px-chip px-chip-green">{t("review.saved")}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="rv-mood" aria-hidden>
            {MOOD_EMOJI[m]}
          </span>
          <div className="flex flex-col">
            <b className="text-sm">{t(moodKey(m))}</b>
            <span className="text-muted text-xs">
              {t("review.savedAt", { date: formatDayShort(dayKey(review.at), lang) })}
            </span>
          </div>
        </div>
        <dl className="flex flex-col gap-2">
          <Answer q={t("review.q.wins")} a={review.wins} icon="✓" />
          <Answer q={t("review.q.blocks")} a={review.blocks} icon="⚠" />
          <Answer q={t("review.q.next")} a={review.next} icon="🎯" />
        </dl>
        <div>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            data-testid="review-edit"
            onClick={startEdit}
          >
            {t("review.edit")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="px-card flex flex-col gap-3" data-testid="review-form" data-week={week}>
      <div className="flex flex-col gap-1">
        <h2 className="text-base">{t("review.reflect.title")}</h2>
        {!review && <p className="text-ink-2 text-xs">{t("review.reflect.sub")}</p>}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted mb-1 text-xs">{t("review.mood")}</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("review.mood")}>
          {MOODS.map((m) => (
            <button
              key={m}
              type="button"
              className="rv-mood"
              data-testid="mood"
              data-mood={m}
              aria-pressed={mood === m}
              aria-label={t(moodKey(m))}
              title={t(moodKey(m))}
              onClick={() => setMood(m)}
            >
              {MOOD_EMOJI[m]}
            </button>
          ))}
        </div>
        {mood === null && <span className="text-muted text-xs">{t("review.pickMood")}</span>}
      </fieldset>

      <Field
        id={`rv-wins-${week}`}
        label={t("review.q.wins")}
        placeholder={t("review.ph.wins")}
        value={wins}
        onChange={setWins}
        testId="review-wins"
      />
      <Field
        id={`rv-blocks-${week}`}
        label={t("review.q.blocks")}
        placeholder={t("review.ph.blocks")}
        value={blocks}
        onChange={setBlocks}
        testId="review-blocks"
      />
      <Field
        id={`rv-next-${week}`}
        label={t("review.q.next")}
        placeholder={t("review.ph.next")}
        value={next}
        onChange={setNext}
        testId="review-next-goal"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-gold"
          data-testid="review-save"
          disabled={mood === null}
          onClick={save}
        >
          {review ? t("review.saveEdit") : t("review.save")}
        </button>
        {review && (
          <button
            type="button"
            className="px-btn px-btn-ghost"
            data-testid="review-cancel"
            onClick={() => setEditing(false)}
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className="text-sm font-bold">{label}</span>
      <textarea
        id={id}
        className="px-input rv-textarea"
        rows={2}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </label>
  );
}

function Answer({ q, a, icon }: { q: string; a: string; icon: string }) {
  const { t } = useT();
  return (
    <div className="px-inset flex flex-col gap-0.5">
      <dt className="text-muted text-xs">
        <span aria-hidden>{icon}</span> {q}
      </dt>
      <dd className={`text-sm break-words ${a ? "" : "text-muted"}`}>{a || t("review.empty")}</dd>
    </div>
  );
}
