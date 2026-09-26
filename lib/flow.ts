import type { MicroAction, QuestCompletion } from "./domain";
import { dayKey } from "./streak";

/**
 * Today's flow (master plan round 17): ① main quest → ② 5-minute micro-action → ③ day complete.
 * Derived only from saved progress on the Riyadh day, so it survives reloads.
 * Step ① counts any quest completed today; step ② any micro-action today.
 */
export interface FlowState {
  /** First quest completed today, if any. */
  quest: QuestCompletion | null;
  /** First micro-action done today, if any. */
  micro: MicroAction | null;
  /** 0..3 steps done. */
  steps: number;
  dayDone: boolean;
}

export function flowState(
  s: { completions: readonly QuestCompletion[]; microActions: readonly MicroAction[] },
  today: string = dayKey(),
): FlowState {
  const quest = s.completions.find((c) => dayKey(c.at) === today) ?? null;
  const micro = s.microActions.find((m) => dayKey(m.at) === today) ?? null;
  const dayDone = quest !== null && micro !== null;
  return { quest, micro, steps: (quest ? 1 : 0) + (micro ? 1 : 0) + (dayDone ? 1 : 0), dayDone };
}
