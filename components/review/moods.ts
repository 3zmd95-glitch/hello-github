import type { MessageKey } from "@/lib/i18n";

/** Mood scale 1..5, worst first, as in the mockup: 😫 😕 😐 🙂 🔥. */
export type Mood = 1 | 2 | 3 | 4 | 5;

export const MOODS: readonly Mood[] = [1, 2, 3, 4, 5];

export const MOOD_EMOJI: Record<Mood, string> = {
  1: "😫",
  2: "😕",
  3: "😐",
  4: "🙂",
  5: "🔥",
};

export function moodKey(mood: Mood): MessageKey {
  return `review.mood.${mood}`;
}

/** A stored mood (any integer 1..5) as the typed scale; anything else falls back to neutral. */
export function asMood(n: number): Mood {
  return n >= 1 && n <= 5 && Number.isInteger(n) ? (n as Mood) : 3;
}
