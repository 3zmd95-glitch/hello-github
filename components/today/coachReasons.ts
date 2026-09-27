import type { BossState } from "@/lib/boss";
import type { LText } from "@/lib/domain";
import type { MessageKey } from "@/lib/i18n";
import type { QuestPick } from "@/lib/planner";
import { skillMatchesTheme, type SeasonState } from "@/lib/season";

/** Boss HP share under which the coach mentions it. */
export const BOSS_LOW_RATIO = 0.3;

export interface CoachReason {
  key: MessageKey;
  /** Bilingual name to fill the message's {name}, if it has one. */
  name?: LText;
}

/**
 * Extra "why this quest" reasons for the coach card (master plan round 15), after the planner's own
 * nearest-to-mastery line: the quest finishes (or nearly finishes) a boss under 30 % HP, and the skill belongs
 * to the running season. At most `max` are returned, most urgent first.
 */
export function coachReasons(
  pick: QuestPick,
  boss: BossState,
  season: SeasonState,
  max = 2,
): CoachReason[] {
  const out: CoachReason[] = [];
  if (!boss.defeated && boss.hp > 0 && boss.hpLeft / boss.hp < BOSS_LOW_RATIO) {
    out.push({ key: pick.xp >= boss.hpLeft ? "today.reason.bossFinish" : "today.reason.bossLow" });
  }
  if (!season.done && skillMatchesTheme(pick.skill, season.season.theme)) {
    out.push({ key: "today.reason.season", name: season.season.name });
  }
  return out.slice(0, max);
}
