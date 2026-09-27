"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import { useSkillSheet } from "@/components/skills/SkillSheetProvider";
import { useToday } from "@/components/today/useToday";
import { skills } from "@/data";
import { useT } from "@/lib/i18n";
import { doneQuestsBySkill, rankQuestCandidates, type QuestPick } from "@/lib/planner";
import { daysBetween, weekKey } from "@/lib/streak";
import { buildWeekPlan, itemQuests, planProgress } from "@/lib/weekPlan";
import { useStore } from "@/store";
import {
  applyOverlay,
  backlog as backlogOf,
  lightestDay,
  manualRow,
  tombstoneFor,
  type OverlayItem,
} from "./overlay";
import PlanBacklog from "./PlanBacklog";
import PlanHeader from "./PlanHeader";
import WeekGrid from "./WeekGrid";
import WhyThisPlan from "./WhyThisPlan";

/**
 * Weekly planner (build plan 2.3 + 2.4): the current Sat–Fri week within the 5 h budget, drawn by the
 * rules in lib/weekPlan.ts from progress + gear, with the owner's manual edits (store `planItems`)
 * overlaid on top — see overlay.ts for the contract.
 */
export default function PlannerScreen() {
  const { t } = useT();
  const today = useToday();
  const completions = useStore((s) => s.completions);
  const planItems = useStore((s) => s.planItems);
  const gear = useStore((s) => s.settings.gear);
  const davinciEdition = useStore((s) => s.settings.davinciEdition);
  const { completeQuest } = useGameActions();
  const sheet = useSkillSheet();

  const weekStart = weekKey(today);
  const derived = useMemo(
    () => buildWeekPlan({ skills, completions, settings: { gear, davinciEdition }, weekStart }),
    [completions, gear, davinciEdition, weekStart],
  );
  const stored = useMemo(
    () => planItems.filter((p) => p.week === weekStart),
    [planItems, weekStart],
  );
  const plan = useMemo(() => applyOverlay(derived, stored), [derived, stored]);
  const candidates = useMemo(
    () => rankQuestCandidates(skills, completions, { gear, davinciEdition }),
    [completions, gear, davinciEdition],
  );
  const backlog = useMemo(() => backlogOf(candidates, plan), [candidates, plan]);
  const targetDay = useMemo(() => lightestDay(plan.items), [plan.items]);
  const done = useMemo(() => doneQuestsBySkill(completions), [completions]);
  const progress = useMemo(() => planProgress(plan, completions), [plan, completions]);
  const todayIndex = daysBetween(weekStart, today);

  const tick = useCallback(
    (item: OverlayItem, proof?: string) => {
      // A combo covers two produce quests; both take the same clip link.
      for (const q of itemQuests(item)) completeQuest(q.skillId, q.quest, proof);
    },
    [completeQuest],
  );
  const open = useCallback((skillId: string) => sheet.open(skillId), [sheet]);

  /** A manual item is dropped; a derived one gets a tombstone row that hides it. */
  const remove = useCallback(
    (item: OverlayItem) => {
      const s = useStore.getState();
      if (item.manual) s.removePlanItem(item.id);
      else s.addPlanItem(tombstoneFor(weekStart, item));
    },
    [weekStart],
  );
  const add = useCallback(
    (pick: QuestPick) => useStore.getState().addPlanItem(manualRow(weekStart, pick, targetDay)),
    [weekStart, targetDay],
  );
  const reset = useCallback(() => useStore.getState().setPlanItems(weekStart, []), [weekStart]);

  return (
    <div className="flex flex-col gap-4" data-testid="planner-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("planner.title")}</h1>
        <p className="text-ink-2 text-sm">{t("planner.sub")}</p>
      </header>

      <PlanHeader plan={plan} progress={progress} edited={stored.length > 0} />

      {plan.items.length === 0 ? (
        <EmptyWeek />
      ) : (
        <WeekGrid
          plan={plan}
          today={todayIndex}
          done={done}
          onTick={tick}
          onOpen={open}
          onRemove={remove}
        />
      )}

      <PlanBacklog
        backlog={backlog}
        targetDay={targetDay}
        edited={stored.length > 0}
        onAdd={add}
        onReset={reset}
      />

      <WhyThisPlan />
    </div>
  );
}

/** Nothing available with the current gear / edition: point to Settings and Discover. */
function EmptyWeek() {
  const { t } = useT();
  return (
    <section className="px-card flex flex-col gap-3" data-testid="plan-empty">
      <h2 className="text-lg">{t("planner.emptyTitle")}</h2>
      <p className="text-ink-2 text-sm">{t("planner.emptyBody")}</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/settings" className="px-btn px-btn-ghost px-btn-sm no-underline">
          {t("planner.emptySettings")}
        </Link>
        <Link href="/discover" className="px-btn px-btn-sm no-underline">
          {t("planner.emptyDiscover")}
        </Link>
      </div>
    </section>
  );
}
