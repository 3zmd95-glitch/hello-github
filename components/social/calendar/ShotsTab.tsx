"use client";

import { Check, Film } from "lucide-react";
import { useState, type FormEvent } from "react";
import PxBar from "@/components/ui/PxBar";
import { SHOT_TYPES, type Post, type ShotType } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { BROLL_CHECKLIST, PLATFORM_META, shotsFromTemplate, stageIndex } from "@/lib/social";
import { useStore } from "@/store";

/**
 * Shot list with ✓ per shot, add / remove, the platform template when empty, the reusable B-roll checklist
 * (ticks live in component state only) and the "move to Filmed?" hint once every shot is ticked.
 */
export default function ShotsTab({ post }: { post: Post }) {
  const { t, L, lang } = useT();
  const toggleShot = useStore((s) => s.toggleShot);
  const addShot = useStore((s) => s.addShot);
  const removeShot = useStore((s) => s.removeShot);
  const updatePost = useStore((s) => s.updatePost);
  const setPostStage = useStore((s) => s.setPostStage);
  const [type, setType] = useState<ShotType>("broll");
  const [text, setText] = useState("");
  const [broll, setBroll] = useState<Set<number>>(() => new Set());

  const total = post.shots.length;
  const done = post.shots.filter((s) => s.done).length;
  const allDone = total > 0 && done === total;
  const suggestFilmed = allDone && stageIndex(post.stage) < stageIndex("filmed");

  const add = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    addShot(post.id, { type, text: value });
    setText("");
  };

  return (
    <div className="flex flex-col gap-3" data-testid="post-shots">
      <div className="flex items-center gap-3">
        <span className="text-ink-2 text-[13px] font-semibold">{t("calendar.shots.title")}</span>
        <PxBar
          value={total ? done / total : 0}
          className="flex-1"
          label={t("calendar.shots.title")}
        />
        <b className="num text-sm" data-testid="shots-progress">
          {t("calendar.shots.progress", { n: done, total })}
        </b>
      </div>

      {total === 0 ? (
        <div className="px-inset flex flex-col gap-2 text-sm">
          <p className="text-ink-2">{t("calendar.shots.empty")}</p>
          <button
            type="button"
            className="px-btn px-btn-sm self-start"
            onClick={() => updatePost(post.id, { shots: shotsFromTemplate(post.platform, lang) })}
            data-testid="shots-template"
          >
            {t("calendar.shots.template", { platform: L(PLATFORM_META[post.platform].name) })}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {post.shots.map((shot) => (
            <li
              key={shot.id}
              className="px-inset flex items-center gap-2"
              data-testid="shot-row"
              data-shot={shot.id}
              data-done={shot.done}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-start"
                aria-pressed={shot.done}
                aria-label={t("calendar.shots.toggle", { text: shot.text })}
                onClick={() => toggleShot(post.id, shot.id)}
                data-testid="shot-toggle"
              >
                <span className="px-check" data-on={shot.done}>
                  <Check size={16} strokeWidth={2.5} aria-hidden />
                </span>
                <span className="px-chip shrink-0">{t(`calendar.shotType.${shot.type}`)}</span>
                <span className={`min-w-0 text-sm ${shot.done ? "text-muted line-through" : ""}`}>
                  {shot.text}
                </span>
              </button>
              <button
                type="button"
                className="text-muted hover:text-danger num shrink-0 px-1 text-lg leading-none"
                onClick={() => removeShot(post.id, shot.id)}
                aria-label={t("calendar.shots.remove")}
                title={t("calendar.shots.remove")}
                data-testid="shot-remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestFilmed && (
        <div
          className="px-inset flex flex-wrap items-center gap-2 text-sm"
          data-testid="shots-hint"
        >
          <span className="inline-flex items-center gap-1">
            <Film size={15} strokeWidth={1.75} className="shrink-0" aria-hidden />
            {t("calendar.shots.allDone")}
          </span>
          <button
            type="button"
            className="px-btn px-btn-sm ms-auto"
            onClick={() => setPostStage(post.id, "filmed")}
            data-testid="shots-apply"
          >
            {t("calendar.shots.toFilmed")}
          </button>
        </div>
      )}

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <select
          className="px-input w-auto"
          value={type}
          onChange={(e) => setType(e.target.value as ShotType)}
          aria-label={t("calendar.shots.type")}
          data-testid="shot-type"
        >
          {SHOT_TYPES.map((st) => (
            <option key={st} value={st}>
              {t(`calendar.shotType.${st}`)}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="px-input min-w-[140px] flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("calendar.shots.textPh")}
          aria-label={t("calendar.shots.textPh")}
          autoComplete="off"
          data-testid="shot-text"
        />
        <button
          type="submit"
          className="px-btn px-btn-ghost px-btn-sm"
          disabled={!text.trim()}
          data-testid="shot-add"
        >
          {t("calendar.shots.add")}
        </button>
      </form>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm">{t("calendar.shots.broll")}</h3>
        <p className="text-muted text-xs">{t("calendar.shots.brollHint")}</p>
        <div className="flex flex-wrap gap-1.5">
          {BROLL_CHECKLIST.map((item, i) => {
            const on = broll.has(i);
            return (
              <button
                key={i}
                type="button"
                className="px-fchip"
                aria-pressed={on}
                onClick={() =>
                  setBroll((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                data-testid="broll-item"
              >
                {on && <Check size={13} strokeWidth={2} aria-hidden />}
                {L(item)}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
