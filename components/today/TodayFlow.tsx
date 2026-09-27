"use client";

import { useState, type ReactNode } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import PxBar from "@/components/ui/PxBar";
import { getSkill } from "@/data";
import type { FlowState } from "@/lib/flow";
import { useT } from "@/lib/i18n";
import type { MicroActionIdea, QuestPick } from "@/lib/planner";
import { questXp } from "@/lib/xp";

/** Today's flow card (round 17): ① main quest → ② 5-minute task → ③ day complete. */
export default function TodayFlow({
  flow,
  main,
  micro,
  streak,
  reasons = [],
}: {
  flow: FlowState;
  main: QuestPick | null;
  micro: MicroActionIdea;
  streak: number;
  /** Extra coach reasons for the main quest (round 15), already translated; shown after `flow.why`. */
  reasons?: string[];
}) {
  const { t, L } = useT();
  const { doMicroAction } = useGameActions();

  return (
    <section className="px-card border-gold flex flex-col gap-3" data-testid="flow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg">{t("flow.title")}</h2>
          <p className="text-muted text-xs">{t("flow.sub")}</p>
        </div>
        <div className="flex min-w-[110px] flex-col items-end gap-1">
          <b className="num text-xl" data-testid="flow-count">
            {flow.steps}/3
          </b>
          <PxBar value={flow.steps / 3} color="var(--gold)" small className="w-full" />
        </div>
      </div>

      <ol className="flex flex-col gap-2.5">
        <FlowStep n={1} title={t("flow.step1")} done={!!flow.quest}>
          {flow.quest ? (
            <DoneQuest skillId={flow.quest.skillId} quest={flow.quest.quest} />
          ) : main ? (
            <MainQuest key={`${main.skill.id}:${main.quest}`} pick={main} reasons={reasons} />
          ) : (
            <p className="text-ink-2 text-sm">{t("flow.allDone")}</p>
          )}
        </FlowStep>

        <FlowStep n={2} title={t("flow.step2")} done={!!flow.micro}>
          <p className={`text-sm ${flow.micro ? "text-muted line-through" : "text-ink-2"}`}>
            {L(flow.micro ? flow.micro.text : micro.text)}
          </p>
          {flow.micro ? (
            <span className="px-chip px-chip-green self-start">{t("flow.doneState")}</span>
          ) : (
            <button
              type="button"
              className="px-btn px-btn-sm self-start"
              onClick={() => doMicroAction(micro.text)}
              data-testid="micro-done"
            >
              {t("flow.done")}
            </button>
          )}
        </FlowStep>

        <FlowStep
          n={3}
          title={t("flow.step3")}
          done={flow.dayDone}
          icon={flow.dayDone ? "🔥" : "3"}
        >
          <p className={`text-sm ${flow.dayDone ? "text-orange font-bold" : "text-muted"}`}>
            {flow.dayDone ? t("flow.step3Done", { n: streak }) : t("flow.step3Wait")}
          </p>
        </FlowStep>
      </ol>
    </section>
  );
}

function FlowStep({
  n,
  title,
  done,
  icon,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <li
      data-done={done}
      data-testid={`flow-step-${n}`}
      className={`flex items-start gap-3 rounded-[2px] border-2 p-3 ${done ? "border-accent bg-[color-mix(in_srgb,var(--accent)_10%,var(--panel-2))]" : "border-edge bg-panel-2"}`}
    >
      <span
        aria-hidden
        className={`num border-edge grid h-8 w-8 shrink-0 place-items-center border-[3px] font-bold ${done ? "bg-accent text-accent-ink" : "bg-gold text-gold-ink"}`}
      >
        {done && n !== 3 ? "✓" : (icon ?? n)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-muted text-sm">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function QuestMeta({ pick }: { pick: Pick<QuestPick, "skill" | "quest" | "xp"> }) {
  const { t, L } = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <b className="text-[0.95rem]">{L(pick.skill.name)}</b>
      <span className="px-chip">{t(`quest.${pick.quest}`)}</span>
      <span className="px-chip px-chip-gold">
        <span className="num">+{pick.xp} XP</span>
      </span>
    </div>
  );
}

function MainQuest({ pick, reasons }: { pick: QuestPick; reasons: string[] }) {
  const { t, L } = useT();
  const sheet = useSkillSheet();
  const { completeQuest } = useGameActions();
  const [proof, setProof] = useState("");
  const needsProof = pick.quest === "produce" || pick.quest === "article";
  // The planner's own reason first (nearest to mastery), then up to two coach reasons (boss, season).
  const why = [...(pick.done > 0 ? [t("flow.why", { n: pick.done })] : []), ...reasons.slice(0, 2)];
  return (
    <div className="flex flex-col gap-2" data-testid="main-quest" data-skill={pick.skill.id}>
      <QuestMeta pick={pick} />
      <p className="text-ink-2 text-sm">{L(pick.skill.quests[pick.quest])}</p>
      {why.length > 0 && (
        <p className="text-muted text-xs" data-testid="main-why">
          {why.join(" · ")}
        </p>
      )}
      {needsProof && (
        <input
          type="text"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          className="px-input"
          placeholder={t("flow.proofPh")}
          aria-label={t("flow.proofPh")}
          value={proof}
          onChange={(e) => setProof(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => sheet.open(pick.skill.id)}
          data-testid="main-open"
        >
          {t("flow.openSkill")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-sm"
          onClick={() => completeQuest(pick.skill.id, pick.quest, proof)}
          data-testid="main-done"
        >
          {t("flow.done")}
        </button>
      </div>
    </div>
  );
}

function DoneQuest({ skillId, quest }: { skillId: string; quest: QuestPick["quest"] }) {
  const { t } = useT();
  const sheet = useSkillSheet();
  const skill = getSkill(skillId);
  if (!skill) return null;
  return (
    <div className="flex flex-col gap-2 opacity-90">
      <QuestMeta pick={{ skill, quest, xp: questXp(quest, skill.tier) }} />
      <div className="flex flex-wrap gap-2">
        <span className="px-chip px-chip-green">{t("flow.doneState")}</span>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => sheet.open(skill.id)}
        >
          {t("flow.openSkill")}
        </button>
      </div>
    </div>
  );
}
