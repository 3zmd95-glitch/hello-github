"use client";

import { useCallback } from "react";
import { getSkill } from "@/data";
import type { LText, QuestType } from "@/lib/domain";
import { flowState } from "@/lib/flow";
import { levelFromXp } from "@/lib/level";
import { rankFromXp } from "@/lib/rank";
import { dayKey } from "@/lib/streak";
import { MASTERY_BONUS, microXp } from "@/lib/xp";
import { streak, totalXp, useStore, type CompleteResult } from "@/store";
import { useCelebrate } from "./CelebrationProvider";

/**
 * Store actions wrapped with their feedback: XP toast, level/tier-up, mastery and day-complete
 * celebrations (queued in that order) plus the matching sounds.
 */
export function useGameActions() {
  const { toast, pulse } = useCelebrate();

  /** Queue level-up or tier-up after an XP change. Returns true when something big was queued. */
  const queueLevelMoments = useCallback(
    (xpBefore: number, xpAfter: number) => {
      const levelBefore = levelFromXp(xpBefore);
      const levelAfter = levelFromXp(xpAfter);
      const rankBefore = rankFromXp(xpBefore);
      const rankAfter = rankFromXp(xpAfter);
      if (levelAfter > levelBefore) {
        toast("levelUp", {
          level: levelAfter,
          ...(rankAfter.step > rankBefore.step
            ? { rank: rankAfter.rank, tier: rankAfter.tier }
            : {}),
        });
        return true;
      }
      if (rankAfter.step > rankBefore.step) {
        toast("tierUp", { rank: rankAfter.rank, tier: rankAfter.tier });
        return true;
      }
      return false;
    },
    [toast],
  );

  const queueDayDone = useCallback(
    (wasDone: boolean, today: string) => {
      const s = useStore.getState();
      if (!wasDone && flowState(s, today).dayDone) {
        toast("dayDone", { streak: streak(s, today).current });
      }
    },
    [toast],
  );

  const completeQuest = useCallback(
    (skillId: string, quest: QuestType, proofUrl?: string): CompleteResult => {
      const before = useStore.getState();
      const today = dayKey();
      const wasDone = flowState(before, today).dayDone;
      const xpBefore = totalXp(before);
      const r = before.completeQuest(skillId, quest, proofUrl?.trim() || undefined);
      if (!r.added) return r;

      const xpAfter = totalXp(useStore.getState());
      const willLevel = r.levelAfter > r.levelBefore || r.rankStepAfter > r.rankStepBefore;
      toast("xp", { xp: r.xp, sound: willLevel || r.mastered ? null : "quest" });
      queueLevelMoments(xpBefore, xpAfter);
      if (r.mastered) {
        const skill = getSkill(skillId);
        toast("mastery", { skill: skill?.name, xp: MASTERY_BONUS });
      }
      queueDayDone(wasDone, today);
      pulse();
      return r;
    },
    [toast, pulse, queueLevelMoments, queueDayDone],
  );

  const uncompleteQuest = useCallback((skillId: string, quest: QuestType) => {
    useStore.getState().uncompleteQuest(skillId, quest);
  }, []);

  const setProof = useCallback((skillId: string, quest: QuestType, url: string) => {
    // completeQuest is idempotent: on an already-done quest it only updates the proof link.
    useStore.getState().completeQuest(skillId, quest, url.trim());
  }, []);

  const doMicroAction = useCallback(
    (text: LText) => {
      const before = useStore.getState();
      const today = dayKey();
      const wasDone = flowState(before, today).dayDone;
      const xpBefore = totalXp(before);
      before.addMicroAction(text);
      const xpAfter = totalXp(useStore.getState());
      const big =
        levelFromXp(xpAfter) > levelFromXp(xpBefore) ||
        rankFromXp(xpAfter).step > rankFromXp(xpBefore).step;
      toast("micro", { xp: microXp(), ...(big ? { sound: null } : {}) });
      queueLevelMoments(xpBefore, xpAfter);
      queueDayDone(wasDone, today);
      pulse();
    },
    [toast, pulse, queueLevelMoments, queueDayDone],
  );

  return { completeQuest, uncompleteQuest, setProof, doMicroAction };
}
