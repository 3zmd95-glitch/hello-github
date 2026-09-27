"use client";

import { useGameActions } from "@/components/celebrate/useGameActions";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import { getSkill } from "@/data";
import type { Drill } from "@/lib/domain";
import { DRILL_MINUTES, drillPrompt } from "@/lib/drills";
import { useT } from "@/lib/i18n";
import { DRILL_XP } from "@/lib/xp";

/** Drills due today on mastered skills (spaced repetition). Render only when `drills` is not empty. */
export default function DrillsCard({ drills }: { drills: readonly Drill[] }) {
  const { t, L } = useT();
  const sheet = useSkillSheet();
  const { completeDrill } = useGameActions();
  if (drills.length === 0) return null;

  return (
    <section className="px-card flex flex-col gap-3" data-testid="drills-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base">{t("today.drills.title")}</h2>
        <span className="text-muted text-xs">{t("today.drills.sub")}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {drills.map((d) => {
          const skill = getSkill(d.skillId);
          if (!skill) return null;
          const prompt = drillPrompt(d);
          return (
            <li
              key={d.skillId}
              className="px-inset flex flex-col gap-2"
              data-testid="drill-row"
              data-skill={d.skillId}
            >
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-sm">{L(skill.name)}</b>
                <span className="px-chip">⏱ {t("today.drills.min", { n: DRILL_MINUTES })}</span>
                <span className="px-chip px-chip-gold">
                  <span className="num">+{DRILL_XP} XP</span>
                </span>
              </div>
              <p className="text-ink-2 text-sm">{L(prompt.text)}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={() => sheet.open(skill.id)}
                  data-testid="drill-open"
                >
                  {t("today.drills.open")}
                </button>
                <button
                  type="button"
                  className="px-btn px-btn-sm"
                  onClick={() => completeDrill(skill.id)}
                  aria-label={t("today.drills.doneAria", { skill: L(skill.name) })}
                  data-testid="drill-done"
                >
                  {t("today.drills.done")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
