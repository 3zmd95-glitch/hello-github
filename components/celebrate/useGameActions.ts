"use client";

import { useCallback } from "react";
import { getSkill } from "@/data";
import type { Badge } from "@/lib/badges";
import { bossState } from "@/lib/boss";
import type { FocusMinutes, FocusState, LText, QuestType, Review } from "@/lib/domain";
import { rewardText } from "@/lib/gems";
import { levelFromXp } from "@/lib/level";
import { rankFromXp } from "@/lib/rank";
import { seasonState } from "@/lib/season";
import { dayKey } from "@/lib/streak";
import { MASTERY_BONUS, microXp } from "@/lib/xp";
import {
  streak,
  totalXp,
  useStore,
  type BuyResult,
  type ChestResult,
  type CompleteResult,
  type DrillResult,
  type FocusResult,
  type PostedResult,
  type ReviewResult,
  type XpOutcome,
} from "@/store";
import { useCelebrate } from "./CelebrationProvider";

/** Anything big coming after the XP toast? Then the toast stays silent so sounds do not overlap. */
function bigFollows(r: XpOutcome, mastered = false): boolean {
  return (
    r.levelAfter > r.levelBefore ||
    r.rankStepAfter > r.rankStepBefore ||
    mastered ||
    r.badges.length > 0 ||
    r.bossDefeated ||
    r.seasonDone
  );
}

/**
 * Store actions wrapped with their feedback. Order of the queued moments after an XP change:
 * XP toast (gems folded in) → level-up / tier-up → mastery → day complete → chest ready → badges →
 * boss hit or boss down → season done. Plus wrapped chest / focus / drill / review / shop actions with their
 * own toasts.
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

  const queueBadges = useCallback(
    (badges: readonly Badge[]) => {
      for (const badge of badges) toast("badge", { badge });
    },
    [toast],
  );

  /**
   * The moments every XP-changing action shares, after its own toast and the level moments:
   * day complete → chest ready → badges → boss hit / boss down → season done.
   * `hitsBoss` is false for micro-actions (they do not damage the boss).
   */
  const queueOutcome = useCallback(
    (r: XpOutcome, opts: { hitsBoss: boolean; today: string }) => {
      const s = useStore.getState();
      if (r.dayDone) toast("dayDone", { streak: streak(s, opts.today).current });
      if (r.chestReady) toast("chestReady");
      queueBadges(r.badges);
      const bs = bossState(s.xpEvents);
      if (r.bossDefeated) toast("bossDown", { boss: bs.boss.name });
      else if (opts.hitsBoss && r.xp > 0) toast("bossHit", { boss: bs.boss.name, damage: r.xp });
      if (r.seasonDone) toast("seasonDone", { season: seasonState(s.completions).season.name });
    },
    [toast, queueBadges],
  );

  const completeQuest = useCallback(
    (skillId: string, quest: QuestType, proofUrl?: string): CompleteResult => {
      const before = useStore.getState();
      const today = dayKey();
      const xpBefore = totalXp(before);
      const r = before.completeQuest(skillId, quest, proofUrl?.trim() || undefined);
      if (!r.added) return r;

      const xpAfter = totalXp(useStore.getState());
      toast("xp", { xp: r.xp, gems: r.gems, sound: bigFollows(r, r.mastered) ? null : "quest" });
      queueLevelMoments(xpBefore, xpAfter);
      if (r.mastered) {
        const skill = getSkill(skillId);
        toast("mastery", { skill: skill?.name, xp: MASTERY_BONUS });
      }
      queueOutcome(r, { hitsBoss: true, today });
      pulse();
      return r;
    },
    [toast, pulse, queueLevelMoments, queueOutcome],
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
      const xpBefore = totalXp(before);
      const r = before.addMicroAction(text);
      const xpAfter = totalXp(useStore.getState());
      toast("micro", { xp: microXp(), gems: r.gems, ...(bigFollows(r) ? { sound: null } : {}) });
      queueLevelMoments(xpBefore, xpAfter);
      queueOutcome(r, { hitsBoss: false, today });
      pulse();
      return r;
    },
    [toast, pulse, queueLevelMoments, queueOutcome],
  );

  /** Open the ready chest: big loot celebration, then any badge it earned. */
  const openChest = useCallback((): ChestResult | null => {
    const loot = useStore.getState().openChest();
    if (!loot) return null;
    toast("chestLoot", { loot });
    queueBadges(loot.badges);
    pulse();
    return loot;
  }, [toast, pulse, queueBadges]);

  const startFocus = useCallback(
    (minutes: FocusMinutes): FocusState => {
      const focus = useStore.getState().startFocus(minutes);
      toast("focusStart", { minutes: focus.minutes });
      return focus;
    },
    [toast],
  );

  const stopFocus = useCallback((): FocusResult | null => {
    const session = useStore.getState().stopFocus();
    if (!session) return null;
    toast("focusEnd", { early: session.early, minutes: session.minutes });
    queueBadges(session.badges);
    return session;
  }, [toast, queueBadges]);

  const completeDrill = useCallback(
    (skillId: string): DrillResult => {
      const before = useStore.getState();
      const today = dayKey();
      const xpBefore = totalXp(before);
      const r = before.completeDrill(skillId);
      if (!r.done) return r;
      toast("drill", { xp: r.xp, gems: r.gems, ...(bigFollows(r) ? { sound: null } : {}) });
      queueLevelMoments(xpBefore, totalXp(useStore.getState()));
      queueOutcome(r, { hitsBoss: true, today });
      pulse();
      return r;
    },
    [toast, pulse, queueLevelMoments, queueOutcome],
  );

  const saveReview = useCallback(
    (review: Omit<Review, "at">): ReviewResult => {
      const before = useStore.getState();
      const today = dayKey();
      const xpBefore = totalXp(before);
      const r = before.saveReview(review);
      if (!r.added) {
        queueBadges(r.badges);
        return r;
      }
      toast("xp", { xp: r.xp, gems: r.gems, ...(bigFollows(r) ? { sound: null } : {}) });
      queueLevelMoments(xpBefore, totalXp(useStore.getState()));
      queueOutcome(r, { hitsBoss: true, today });
      pulse();
      return r;
    },
    [toast, pulse, queueLevelMoments, queueBadges, queueOutcome],
  );

  const buyReward = useCallback(
    (id: string): BuyResult => {
      const s = useStore.getState();
      const reward = s.rewards.find((r) => r.id === id);
      const res = s.buyReward(id);
      if (res.ok && reward) {
        toast("gems", { gems: -reward.cost, name: rewardText(reward.name, s.settings.lang) });
        pulse();
      }
      return res;
    },
    [toast, pulse],
  );

  /** Re-check every badge (e.g. when a screen opens) and celebrate the new ones. */
  const checkBadges = useCallback((): Badge[] => {
    const badges = useStore.getState().checkBadges();
    queueBadges(badges);
    return badges;
  }, [queueBadges]);

  /**
   * 📱 "Mark as posted" + link. A small `posted` toast (the post's title, quest sound) always; when the post's
   * linked Produce quest completed, the same moments as completeQuest follow (XP toast, level/tier, mastery,
   * day done, chest, badges, boss, season). The posted toast goes silent then, so the XP toast plays the sound.
   */
  const markPosted = useCallback(
    (id: string, url: string): PostedResult => {
      const before = useStore.getState();
      const today = dayKey();
      const xpBefore = totalXp(before);
      const res = before.markPosted(id, url);
      if (!res.post) return res;
      const r = res.quest;
      toast("posted", { name: res.post.title, ...(r ? { sound: null } : {}) });
      if (!r) return res;

      const xpAfter = totalXp(useStore.getState());
      toast("xp", { xp: r.xp, gems: r.gems, sound: bigFollows(r, r.mastered) ? null : "quest" });
      queueLevelMoments(xpBefore, xpAfter);
      if (r.mastered && res.post.skillId) {
        const skill = getSkill(res.post.skillId);
        toast("mastery", { skill: skill?.name, xp: MASTERY_BONUS });
      }
      queueOutcome(r, { hitsBoss: true, today });
      pulse();
      return res;
    },
    [toast, pulse, queueLevelMoments, queueOutcome],
  );

  return {
    completeQuest,
    uncompleteQuest,
    setProof,
    doMicroAction,
    openChest,
    startFocus,
    stopFocus,
    completeDrill,
    saveReview,
    buyReward,
    checkBadges,
    markPosted,
  };
}
