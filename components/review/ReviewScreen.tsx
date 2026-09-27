"use client";

import { useMemo, useState } from "react";
import { useToday } from "@/components/today/useToday";
import { programs, skills } from "@/data";
import { useT } from "@/lib/i18n";
import { addDays, daysBetween } from "@/lib/streak";
import { insights as buildInsights, weekHistory, weekStats } from "@/lib/weekStats";
import { boss as bossOf, currentWeek, reviewForWeek, season as seasonOf, useStore } from "@/store";
import Insights from "./Insights";
import PastReviews from "./PastReviews";
import PillarXp from "./PillarXp";
import ReflectionForm from "./ReflectionForm";
import StatTiles from "./StatTiles";
import WeekPicker from "./WeekPicker";
import XpHistory from "./XpHistory";

const HISTORY_WEEKS = 8;
const ctx = { skills, programs };

/**
 * Weekly review (build plan 2.5, master plan round 15): stats of one Sat–Fri week, XP by pillar,
 * an 8-week history, rules-based insights, the mood + 3 questions reflection (+10 XP once per week)
 * and every past review. Everything is derived from the store's ledgers by lib/weekStats.ts.
 */
export default function ReviewScreen() {
  const { t } = useT();
  const today = useToday();
  const completions = useStore((s) => s.completions);
  const xpEvents = useStore((s) => s.xpEvents);
  const microActions = useStore((s) => s.microActions);
  const focusSessions = useStore((s) => s.focusSessions);
  const reviews = useStore((s) => s.reviews);

  const current = currentWeek(today);
  // Weeks back from the current one; only the past can be browsed.
  const [back, setBack] = useState(0);
  const week = addDays(current, -7 * back);
  const isCurrent = back === 0;

  const state = useMemo(
    () => ({ completions, xpEvents, microActions, focusSessions }),
    [completions, xpEvents, microActions, focusSessions],
  );
  const stats = useMemo(() => weekStats(state, week, ctx), [state, week]);
  const prev = useMemo(() => weekStats(state, addDays(week, -7), ctx), [state, week]);
  const history = useMemo(() => weekHistory(state, HISTORY_WEEKS, today), [state, today]);
  const list = useMemo(() => {
    // Boss and season are live counters, so they only make sense on the current week.
    const bs = isCurrent ? bossOf({ xpEvents }) : null;
    const ss = isCurrent ? seasonOf({ completions }, today) : null;
    return buildInsights(stats, prev, {
      skills,
      programs,
      completions,
      boss: bs ? { name: bs.boss.name, hp: bs.hp, hpLeft: bs.hpLeft } : null,
      season: ss
        ? {
            name: ss.season.name,
            questsDone: ss.questsDone,
            target: ss.target,
            daysLeft: ss.daysLeft,
          }
        : null,
    });
  }, [stats, prev, completions, xpEvents, isCurrent, today]);
  const review = useMemo(() => reviewForWeek({ reviews }, week), [reviews, week]);

  // React Compiler memoizes this; `current` is a plain string, so no manual useCallback is needed.
  const select = (w: string) => {
    const n = Math.round(daysBetween(w, current) / 7);
    if (n >= 0) setBack(n);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="review-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("review.title")}</h1>
        <p className="text-ink-2 text-sm">{t("review.sub")}</p>
      </header>

      <WeekPicker
        week={week}
        isCurrent={isCurrent}
        onPrev={() => setBack((n) => n + 1)}
        onNext={() => setBack((n) => Math.max(0, n - 1))}
      />

      <StatTiles stats={stats} prev={prev} todayIndex={isCurrent ? daysBetween(week, today) : -1} />

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <PillarXp xpByPillar={stats.xpByPillar} />
        <XpHistory history={history} selected={week} onSelect={select} />
      </div>

      <Insights list={list} />

      <ReflectionForm key={week} week={week} review={review} />

      <PastReviews reviews={reviews} onSelect={select} />
    </div>
  );
}
