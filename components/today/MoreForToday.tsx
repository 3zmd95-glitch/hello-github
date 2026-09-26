"use client";

import { useGameActions } from "@/components/celebrate/useGameActions";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import { useT } from "@/lib/i18n";
import type { QuestPick } from "@/lib/planner";

/** Collapsed "More for today": other suggested quests with a quick ✓. */
export default function MoreForToday({ picks }: { picks: QuestPick[] }) {
  const { t, L } = useT();
  const sheet = useSkillSheet();
  const { completeQuest } = useGameActions();
  return (
    <details className="px-card group" data-testid="more-today">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base">{t("more.title")}</h2>
        <span className="text-muted text-xs">{t("more.sub")}</span>
        <span aria-hidden className="text-muted ms-auto transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      {picks.length === 0 ? (
        <p className="text-muted mt-3 text-sm">{t("more.empty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {picks.map((p) => (
            <li
              key={`${p.skill.id}:${p.quest}`}
              className="px-inset flex items-center gap-3"
              data-testid="more-quest"
            >
              <button
                type="button"
                className="px-check"
                aria-label={`${t("more.tick")}: ${L(p.skill.name)}`}
                onClick={() => completeQuest(p.skill.id, p.quest)}
              >
                ✓
              </button>
              <button
                type="button"
                className="min-w-0 flex-1 text-start"
                onClick={() => sheet.open(p.skill.id)}
              >
                <b className="block truncate text-sm">{L(p.skill.name)}</b>
                <span className="text-muted text-xs">
                  {t(`quest.${p.quest}`)} · <span className="num">{p.done}/4</span>
                </span>
              </button>
              <span className="px-chip px-chip-gold shrink-0">
                <span className="num">+{p.xp} XP</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
