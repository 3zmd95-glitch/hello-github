"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { TierChip } from "@/components/ui/chips";
import { useT, type MessageKey } from "@/lib/i18n";
import type { QuestPick } from "@/lib/planner";
import { questMinutes } from "@/lib/weekPlan";

const DAY_KEYS: readonly MessageKey[] = [
  "planner.day.0",
  "planner.day.1",
  "planner.day.2",
  "planner.day.3",
  "planner.day.4",
  "planner.day.5",
  "planner.day.6",
];

/**
 * Manual edits panel under the week: "+ add from backlog" opens the next candidate quests not in the plan
 * (each lands on the lightest day), and "back to the coach's plan" drops every stored edit (behind a confirm).
 */
export default function PlanBacklog({
  backlog,
  targetDay,
  edited,
  onAdd,
  onReset,
}: {
  backlog: readonly QuestPick[];
  /** Day (0 = Sat … 6 = Fri) the next addition lands on. */
  targetDay: number;
  /** The owner has stored edits for this week. */
  edited: boolean;
  onAdd: (pick: QuestPick) => void;
  onReset: () => void;
}) {
  const { t, L } = useT();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <section className="px-card flex flex-col gap-3" data-testid="plan-edits">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="plan-add"
        >
          {t("planner.addBtn")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm ms-auto"
          onClick={() => setConfirm(true)}
          disabled={!edited}
          data-testid="plan-reset"
        >
          {t("planner.reset")}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-2" data-testid="plan-backlog">
          <div>
            <h2 className="text-base">{t("planner.addTitle")}</h2>
            <p className="text-muted text-xs">
              {t("planner.addSub")} · {t(DAY_KEYS[targetDay])}
            </p>
          </div>
          {backlog.length === 0 ? (
            <p className="text-muted text-sm">{t("planner.backlogEmpty")}</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {backlog.map((p) => (
                <li key={`${p.skill.id}:${p.quest}`}>
                  <button
                    type="button"
                    className="px-inset hover:border-accent flex w-full items-center gap-3 text-start"
                    onClick={() => onAdd(p)}
                    aria-label={t("planner.addAria", { skill: L(p.skill.name) })}
                    data-testid="plan-backlog-item"
                    data-skill={p.skill.id}
                    data-quest={p.quest}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <b className="truncate text-sm">{L(p.skill.name)}</b>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="px-chip">{t(`quest.${p.quest}`)}</span>
                        <TierChip tier={p.skill.tier} />
                        <span className="text-ink-2">
                          ⏱ <span className="num">{questMinutes(p.quest, p.skill.tier)}</span>{" "}
                          {t("planner.min")}
                        </span>
                        <span className="px-chip px-chip-gold">
                          <span className="num">+{p.xp} XP</span>
                        </span>
                      </span>
                    </span>
                    <span className="px-chip px-chip-green shrink-0">{t("planner.addOne")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={t("planner.resetTitle")}
          body={t("planner.resetBody")}
          confirmLabel={t("planner.resetOk")}
          onConfirm={() => {
            setConfirm(false);
            onReset();
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </section>
  );
}
