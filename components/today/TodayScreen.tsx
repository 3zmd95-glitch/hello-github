"use client";

import { useMemo } from "react";
import { useSceneMood } from "@/components/celebrate/CelebrationProvider";
import PixelScene from "@/components/game/PixelScene";
import { skills } from "@/data";
import { flowState } from "@/lib/flow";
import { levelProgress } from "@/lib/level";
import { pickMicroAction, rankQuestCandidates } from "@/lib/planner";
import { rankFromXp } from "@/lib/rank";
import { streak as streakOf, totalXp, useStore } from "@/store";
import MoreForToday from "./MoreForToday";
import TodayFlow from "./TodayFlow";
import TodayHeader from "./TodayHeader";
import { useToday } from "./useToday";

export default function TodayScreen() {
  const today = useToday();
  const completions = useStore((s) => s.completions);
  const microActions = useStore((s) => s.microActions);
  const freezesUsedOn = useStore((s) => s.freezesUsedOn);
  const xpEvents = useStore((s) => s.xpEvents);
  const settings = useStore((s) => s.settings);
  const mood = useSceneMood();

  const xp = useMemo(() => totalXp({ xpEvents }), [xpEvents]);
  const level = useMemo(() => levelProgress(xp), [xp]);
  const rank = useMemo(() => rankFromXp(xp), [xp]);
  const st = useMemo(
    () => streakOf({ completions, microActions, freezesUsedOn }, today),
    [completions, microActions, freezesUsedOn, today],
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

  // Before step ① the top candidate is the main quest; after it, the next ones are "more".
  const main = flow.quest ? null : (candidates[0] ?? null);
  const more = flow.quest ? candidates.slice(0, 3) : candidates.slice(1, 4);

  return (
    <>
      <TodayHeader
        rank={rank}
        level={level}
        xp={xp}
        streak={st.current}
        freezes={st.freezes}
        lit={st.todayDone}
      />
      <div className="grid gap-4 md:grid-cols-[1.35fr_1fr] md:items-start">
        <div className="md:col-start-1 md:row-start-1">
          <TodayFlow flow={flow} main={main} micro={micro} streak={st.current} />
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
        <div className="md:col-start-1 md:row-start-2">
          <MoreForToday picks={more} />
        </div>
      </div>
    </>
  );
}
