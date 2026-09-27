import type { LText } from "./domain";

/**
 * Film-canister chests (master plan round 9): one is ready every CHEST_EVERY completed quests. Loot is
 * deterministic from the chest number, so a chest opened on two devices (or after an import) gives the same
 * thing and no Math.random is involved.
 */

export const CHEST_EVERY = 5;

/** Gem amounts a chest can hold. */
export const CHEST_GEMS = [20, 35, 50] as const;

export type Loot =
  | { kind: "gems"; amount: number }
  | { kind: "freeze"; amount: 1 }
  | { kind: "prompt"; prompt: LText; index: number };

/** Random creative prompts (Hijazi / EN) a chest can hand out. */
export const CREATIVE_PROMPTS: readonly LText[] = [
  {
    ar: "صوّر ٣ لقطات لنفس الشي بثلاث زوايا مختلفة، واختار أحسنها",
    en: "Shoot the same subject from 3 different angles and pick the best one",
  },
  {
    ar: "اعمل مونتاج ١٥ ثانية على إيقاع أغنية بدون أي كلام",
    en: "Cut a 15-second edit to a beat with no dialogue at all",
  },
  {
    ar: "لوّن لقطة بلوك سينمائي ولوك ثاني وقارن بينهم",
    en: "Grade one shot with a cinematic look and a second look, then compare",
  },
  {
    ar: "صوّر لقطة وقت الساعة الذهبية بس بإضاءة الشمس",
    en: "Film one golden-hour shot using only the sun",
  },
  {
    ar: "اكتب هوك لفيديو من جملة واحدة يخلي الناس يوقفون التمرير",
    en: "Write a one-sentence hook that stops the scroll",
  },
  {
    ar: "سجّل صوت الغرفة ٣٠ ثانية وسمعه: إيش تسمع؟",
    en: "Record 30 seconds of room tone and listen: what do you hear?",
  },
  {
    ar: "اعمل match cut بين لقطتين ما لهم علاقة ببعض",
    en: "Make a match cut between two shots that have nothing in common",
  },
  {
    ar: "صوّر لقطة كلها ظل ونور، بدون وجوه",
    en: "Shoot a frame that is all light and shadow, no faces",
  },
  {
    ar: "خذ لقطة قديمة من الأرشيف وعيد مونتاجها بطريقة مختلفة",
    en: "Take an old clip from your archive and re-edit it a different way",
  },
  {
    ar: "صوّر وجه واحد بإضاءة واحدة من ٤ اتجاهات",
    en: "Light one face with one light from 4 directions",
  },
];

/**
 * Loot table. Its length spreads the chest numbers: gems appear most often, a freeze every few chests,
 * a creative prompt in between.
 */
const LOOT_TABLE: readonly (
  { kind: "gems"; amount: number } | { kind: "freeze"; amount: 1 } | { kind: "prompt" }
)[] = [
  { kind: "gems", amount: 20 },
  { kind: "prompt" },
  { kind: "gems", amount: 35 },
  { kind: "freeze", amount: 1 },
  { kind: "gems", amount: 20 },
  { kind: "prompt" },
  { kind: "gems", amount: 50 },
  { kind: "prompt" },
  { kind: "gems", amount: 20 },
  { kind: "freeze", amount: 1 },
  { kind: "gems", amount: 35 },
  { kind: "prompt" },
];

/** Small integer hash (xorshift-style) so consecutive chest numbers do not walk the table in order. */
export function chestSeed(n: number): number {
  let x = Math.imul(n, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Deterministic loot for chest number n (1-based). */
export function lootFor(n: number): Loot {
  const seed = chestSeed(Math.max(1, Math.floor(n)));
  const entry = LOOT_TABLE[seed % LOOT_TABLE.length];
  if (entry.kind === "prompt") {
    const index = Math.floor(seed / LOOT_TABLE.length) % CREATIVE_PROMPTS.length;
    return { kind: "prompt", prompt: CREATIVE_PROMPTS[index], index };
  }
  return entry;
}

/** Chests earned so far from a number of completed quests. */
export function chestsEarned(questsDone: number): number {
  return Math.floor(Math.max(0, questsDone) / CHEST_EVERY);
}

export interface ChestProgress {
  /** Quests toward the next unopened chest, 0..needed (full while a chest waits). */
  done: number;
  needed: number;
  /** A chest is waiting to be opened. */
  ready: boolean;
  /** How many chests are waiting. */
  pending: number;
}

export function chestProgress(questsDone: number, chestsOpened: number): ChestProgress {
  const pending = Math.max(0, chestsEarned(questsDone) - chestsOpened);
  const done = pending > 0 ? CHEST_EVERY : Math.max(0, questsDone) % CHEST_EVERY;
  return { done, needed: CHEST_EVERY, ready: pending > 0, pending };
}
