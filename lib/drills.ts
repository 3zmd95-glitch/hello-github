import type { Drill, LText, QuestType } from "./domain";
import { addDays, dayKey } from "./streak";

/**
 * Drills (master plan round 9): 10-minute spaced-repetition redo prompts for mastered skills. Mastering a skill
 * creates a drill due in 3 days; each completed drill pushes the next one further out (3 → 7 → 14 → 30 → 30…).
 */

export const DRILL_INTERVALS = [3, 7, 14, 30] as const;
export const DRILL_MINUTES = 10;

/** The interval after the given one (stays at the last one). */
export function nextInterval(intervalDays: number): number {
  const i = DRILL_INTERVALS.findIndex((d) => d > intervalDays);
  return i === -1 ? DRILL_INTERVALS[DRILL_INTERVALS.length - 1] : DRILL_INTERVALS[i];
}

/** A fresh drill for a skill mastered on `today`. */
export function newDrill(skillId: string, today: string = dayKey()): Drill {
  return {
    skillId,
    nextDue: addDays(today, DRILL_INTERVALS[0]),
    intervalDays: DRILL_INTERVALS[0],
    reps: 0,
  };
}

/** The drill after a completion on `today`. */
export function advanceDrill(drill: Drill, today: string = dayKey()): Drill {
  const intervalDays = nextInterval(drill.intervalDays);
  return { ...drill, intervalDays, nextDue: addDays(today, intervalDays), reps: drill.reps + 1 };
}

/** Drills due on or before `today`, soonest first. */
export function dueDrills(drills: readonly Drill[], today: string = dayKey()): Drill[] {
  return drills
    .filter((d) => d.nextDue <= today)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

export interface DrillPrompt {
  id: string;
  /** Prompts tied to a quest type; generic ones have none. */
  quest?: QuestType;
  text: LText;
}

/** Generic 10-minute drill prompts (Hijazi / EN). */
export const DRILL_PROMPTS: readonly DrillPrompt[] = [
  {
    id: "redo-train",
    quest: "train",
    text: {
      ar: "أعد تمرين «تدريب» في ١٠ دقايق بدون ما تشوف الخطوات",
      en: "Redo the Train exercise in 10 minutes without looking at the steps",
    },
  },
  {
    id: "train-timer",
    quest: "train",
    text: {
      ar: "شغّل تايمر ١٠ دقايق وسوّ التمرين أسرع من آخر مرة",
      en: "Set a 10-minute timer and beat your last time on the exercise",
    },
  },
  {
    id: "explain-3-lines",
    quest: "research",
    text: {
      ar: "اشرح المهارة في ٣ سطور لواحد ما يعرفها، من راسك",
      en: "Explain the skill in 3 lines to someone new, from memory",
    },
  },
  {
    id: "note-refresh",
    quest: "research",
    text: {
      ar: "افتح ملاحظتك في Obsidian وضيف لها شي واحد جديد تعلمته",
      en: "Open your Obsidian note and add one new thing you learned",
    },
  },
  {
    id: "clip-30s",
    quest: "produce",
    text: {
      ar: "صوّر أو قصّ لقطة ٣٠ ثانية تستخدم فيها المهارة دي بس",
      en: "Shoot or cut a 30-second clip that uses only this skill",
    },
  },
  {
    id: "old-footage",
    quest: "produce",
    text: {
      ar: "طبّق المهارة على لقطة قديمة من أرشيفك وقارن قبل وبعد",
      en: "Apply the skill to an old clip from your archive and compare before/after",
    },
  },
  {
    id: "hook-line",
    quest: "article",
    text: {
      ar: "اكتب جملة هوك واحدة تقنع حد يقرأ مقال عن المهارة دي",
      en: "Write one hook line that makes someone read an article about this skill",
    },
  },
  {
    id: "cheat-sheet",
    quest: "article",
    text: {
      ar: "لخّص المهارة في ٥ نقاط كورقة مساعدة سريعة",
      en: "Summarize the skill in 5 bullet points as a quick cheat sheet",
    },
  },
  {
    id: "teach-out-loud",
    text: {
      ar: "علّم المهارة بصوت عالي لمدة دقيقتين كأنك تسجّل تيك توك",
      en: "Teach the skill out loud for 2 minutes as if recording a TikTok",
    },
  },
  {
    id: "three-mistakes",
    text: {
      ar: "اكتب ٣ أغلاط شائعة في المهارة دي وكيف تتجنبها",
      en: "List 3 common mistakes in this skill and how to avoid them",
    },
  },
  {
    id: "shortcut-sprint",
    text: {
      ar: "سوّ المهارة بالاختصارات بس، بدون ماوس، في ١٠ دقايق",
      en: "Do the skill with shortcuts only, no mouse, in 10 minutes",
    },
  },
  {
    id: "one-variation",
    text: {
      ar: "غيّر إعداد واحد في المهارة وشوف إيش يصير بالنتيجة",
      en: "Change one setting of the skill and see what happens to the result",
    },
  },
];

/**
 * Deterministic prompt for a drill: the rep number picks the quest type to revisit (train → research →
 * produce → article → generic) and the skill id spreads which prompt of that group shows.
 */
export function drillPrompt(drill: Drill): DrillPrompt {
  const groups: (QuestType | undefined)[] = ["train", "research", "produce", "article", undefined];
  const quest = groups[drill.reps % groups.length];
  const pool = DRILL_PROMPTS.filter((p) => p.quest === quest);
  let h = 0;
  for (const ch of drill.skillId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[(h + Math.floor(drill.reps / groups.length)) % pool.length];
}
