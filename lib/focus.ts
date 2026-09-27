import type { FocusMinutes, FocusState } from "./domain";
import { FOCUS_MULT } from "./xp";

/**
 * Focus sessions ("potions", master plan round 9): a 25 or 60 minute timer. Every quest completed while it
 * runs gets ×FOCUS_MULT XP (the mastery bonus is never boosted). A session that runs out stays in state until
 * the store settles it; `focusActive` is the source of truth for the UI.
 */

export { FOCUS_MINUTES } from "./domain";

export interface FocusActive {
  /** ISO time the session ends. */
  endsAt: string;
  remainingMs: number;
  minutes: FocusMinutes;
  startedAt: string;
}

/** Epoch ms when a session ends. */
export function focusEndsAtMs(focus: FocusState): number {
  return new Date(focus.startedAt).getTime() + focus.minutes * 60_000;
}

/** The running session with its remaining time, or null when none runs (or it ran out). */
export function focusActive(focus: FocusState | null | undefined, now: Date): FocusActive | null {
  if (!focus) return null;
  const end = focusEndsAtMs(focus);
  const remainingMs = end - now.getTime();
  if (remainingMs <= 0) return null;
  return {
    endsAt: new Date(end).toISOString(),
    remainingMs,
    minutes: focus.minutes,
    startedAt: focus.startedAt,
  };
}

/** XP multiplier to apply to a quest completed at `now`. */
export function focusMultiplier(focus: FocusState | null | undefined, now: Date): number {
  return focusActive(focus, now) ? FOCUS_MULT : 1;
}

/** Whether a session stopped at `now` ended before its timer. */
export function stoppedEarly(focus: FocusState, now: Date): boolean {
  return now.getTime() < focusEndsAtMs(focus);
}
