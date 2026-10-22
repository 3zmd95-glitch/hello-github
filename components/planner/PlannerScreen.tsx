"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatDayShort } from "./weekLabel";

/** `#week=<Saturday key>` (a workflow run's planner link, packet DT-4): that week, else null. */
export function weekFromHash(hash: string): string | null {
  const key = /^#week=(\d{4}-\d{2}-\d{2})$/.exec(hash)?.[1];
  return key && weekKey(key) === key ? key : null;
}

/** Drop the week hash without a navigation (static export: no router push). */
function clearHash(): void {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/**
 * Weekly planner (build plan 2.3 + 2.4): the current Sat–Fri week within the 5 h budget, drawn by the
 * rules in lib/weekPlan.ts from progress + gear, with the owner's manual edits (store `planItems`)
 * overlaid on top — see overlay.ts for the contract.
 */
export default function PlannerScreen() {
  const { t, lang } = useT();
  const today = useToday();
  const [hashWeek, setHashWeek] = useState(() => weekFromHash(window.location.hash));
  const completions = useStore((s) => s.completions);
  const planItems = useStore((s) => s.planItems);
  const gear = useStore((s) => s.settings.gear);
  const davinciEdition = useStore((s) => s.settings.davinciEdition);
  const { completeQuest } = useGameActions();
  const sheet = useSkillSheet();

  // Read on mount and on hashchange (like Notes and Calendar); an invalid #week= is cleared.
  useEffect(() => {
    const apply = () => {
      const week = weekFromHash(window.location.hash);
      if (!week && window.location.hash.startsWith("#week=")) clearHash();
      setHashWeek(week);
    };
    if (!weekFromHash(window.location.hash) && window.location.hash.startsWith("#week="))
      clearHash();
    // An in-app link can mount this page before it writes the new URL: read again once navigation settled.
    const settle = setTimeout(apply, 0);
    window.addEventListener("hashchange", apply);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("hashchange", apply);
    };
  }, []);
  const currentWeek = weekKey(today);
  const weekStart = hashWeek ?? currentWeek;
  const backToThisWeek = () => {
    clearHash();
    setHashWeek(null);
  };
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
    <div className="flex flex-col gap-4" data-testid="planner-screen" data-week={weekStart}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("planner.title")}</h1>
        <p className="text-ink-2 text-sm">{t("planner.sub")}</p>
      </header>

      {weekStart !== currentWeek && (
        <div
          className="px-card flex flex-wrap items-center gap-2 text-sm"
          role="status"
          data-testid="plan-week-viewing"
        >
          <span>{t("planner.viewingWeek", { date: formatDayShort(weekStart, lang) })}</span>
          <button
            type="button"
            className="px-btn px-btn-sm ms-auto"
            onClick={backToThisWeek}
            data-testid="plan-week-return"
          >
            {t("planner.backToThisWeek")}
          </button>
        </div>
      )}

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
