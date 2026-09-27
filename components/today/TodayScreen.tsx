"use client";

import { useMemo } from "react";
import { useSceneMood } from "@/components/celebrate/CelebrationProvider";
import PixelScene from "@/components/game/PixelScene";
import { skills } from "@/data";
import { flowState } from "@/lib/flow";
import { useT } from "@/lib/i18n";
import { levelProgress } from "@/lib/level";
import { pickMicroAction, rankQuestCandidates } from "@/lib/planner";
import { rankFromXp } from "@/lib/rank";
import {
  boss as bossOf,
  dueDrills,
  gems as gemsOf,
  season as seasonOf,
  streak as streakOf,
  totalXp,
  useStore,
} from "@/store";
import BossSeasonCard from "./BossSeasonCard";
import { coachReasons } from "./coachReasons";
import DrillsCard from "./DrillsCard";
import FocusChestCard from "./FocusChestCard";
import MoreForToday from "./MoreForToday";
import TodayFlow from "./TodayFlow";
import TodayHeader from "./TodayHeader";
import { useToday } from "./useToday";

/**
 * Today (round 17 layout): header with the wallet → the calm 3-step flow → then, below it, the focus potion +
 * chest row, the boss + season card, drills due (only when any) and "More for today". The avatar scene sits
 * under the flow on phones and in the right column on desktop.
 */
export default function TodayScreen() {
  const today = useToday();
  const { t, L } = useT();
  const completions = useStore((s) => s.completions);
  const microActions = useStore((s) => s.microActions);
  const freezesUsedOn = useStore((s) => s.freezesUsedOn);
  const bonusFreezes = useStore((s) => s.bonusFreezes);
  const xpEvents = useStore((s) => s.xpEvents);
  const gemEvents = useStore((s) => s.gemEvents);
  const drills = useStore((s) => s.drills);
  const settings = useStore((s) => s.settings);
  const mood = useSceneMood();

  const xp = useMemo(() => totalXp({ xpEvents }), [xpEvents]);
  const gems = useMemo(() => gemsOf({ gemEvents }), [gemEvents]);
  const level = useMemo(() => levelProgress(xp), [xp]);
  const rank = useMemo(() => rankFromXp(xp), [xp]);
  const st = useMemo(
    () => streakOf({ completions, microActions, freezesUsedOn, bonusFreezes }, today),
    [completions, microActions, freezesUsedOn, bonusFreezes, today],
  );
  const flow = useMemo(
    () => flowState({ completions, microActions }, today),
    [completions, microActions, today],
  );
  const candidates = useMemo(
    () => rankQuestCandidates(skills, completions, settings),
    [completions, settings],
  );
  const micro = useMemo(() => pickMicroAction(today), [today]);
  // Noon Riyadh of today's key: a stable instant inside the day for the month / season windows.
  const boss = useMemo(
    () => bossOf({ xpEvents }, new Date(`${today}T12:00:00+03:00`)),
    [xpEvents, today],
  );
  const season = useMemo(() => seasonOf({ completions }, today), [completions, today]);
  const due = useMemo(() => dueDrills({ drills }, today), [drills, today]);

  // Before step ① the top candidate is the main quest; after it, the next ones are "more".
  const main = flow.quest ? null : (candidates[0] ?? null);
  const more = flow.quest ? candidates.slice(0, 3) : candidates.slice(1, 4);
  const reasons = useMemo(
    () =>
      main
        ? coachReasons(main, boss, season).map((r) =>
            t(r.key, r.name ? { name: L(r.name) } : undefined),
          )
        : [],
    [main, boss, season, t, L],
  );

  return (
    <>
      <TodayHeader
        rank={rank}
        level={level}
        xp={xp}
        gems={gems}
        streak={st.current}
        freezes={st.freezes}
        lit={st.todayDone}
      />
      <div className="grid gap-4 md:grid-cols-[1.35fr_1fr] md:items-start">
        <div className="md:col-start-1 md:row-start-1">
          <TodayFlow flow={flow} main={main} micro={micro} streak={st.current} reasons={reasons} />
        </div>
        <div className="md:sticky md:top-[calc(56px+3px+24px)] md:col-start-2 md:row-span-2 md:row-start-1">
          <div className="px-card overflow-hidden p-0" data-testid="scene">
            <PixelScene
              rankIndex={rank.index}
              tier={rank.tier}
              streak={st.current}
              mood={mood === "celebrate" ? "celebrate" : flow.dayDone ? "happy" : "idle"}
              className="w-full"
            />
          </div>
        </div>
        <div className="flex flex-col gap-4 md:col-start-1 md:row-start-2">
          <FocusChestCard />
          <BossSeasonCard boss={boss} season={season} />
          {due.length > 0 && <DrillsCard drills={due} />}
          <MoreForToday picks={more} />
        </div>
      </div>
    </>
  );
}
