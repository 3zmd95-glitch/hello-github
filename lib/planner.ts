import {
  QUEST_TYPES,
  type LText,
  type QuestCompletion,
  type QuestType,
  type Settings,
  type Skill,
} from "./domain";
import { questXp } from "./xp";

export interface QuestPick {
  skill: Skill;
  quest: QuestType;
  xp: number;
  /** Quests already done on this skill (0..3). */
  done: number;
}

/** Map skillId → set of done quest types. */
export function doneQuestsBySkill(
  completions: readonly QuestCompletion[],
): Map<string, Set<QuestType>> {
  const map = new Map<string, Set<QuestType>>();
  for (const c of completions) {
    let s = map.get(c.skillId);
    if (!s) map.set(c.skillId, (s = new Set()));
    s.add(c.quest);
  }
  return map;
}

/** Can the owner do this skill today with their gear and DaVinci edition? */
export function isSkillAvailable(
  skill: Skill,
  settings: Pick<Settings, "gear" | "davinciEdition">,
): boolean {
  if (skill.gear !== "any" && !settings.gear.includes(skill.gear)) return false;
  if (skill.studio && settings.davinciEdition !== "studio") return false;
  return true;
}

/**
 * Candidate quests, best first: one per available, not-yet-mastered skill, taking the skill's next
 * incomplete quest in the order research → train → produce → article.
 * Ranking: most quests done (nearest to mastery), then lowest tier, then the skill's position in `skills`.
 */
export function rankQuestCandidates(
  skills: readonly Skill[],
  completions: readonly QuestCompletion[],
  settings: Pick<Settings, "gear" | "davinciEdition">,
): QuestPick[] {
  const done = doneQuestsBySkill(completions);
  const picks: { pick: QuestPick; index: number }[] = [];
  skills.forEach((skill, index) => {
    if (!isSkillAvailable(skill, settings)) return;
    const d = done.get(skill.id) ?? new Set<QuestType>();
    const quest = QUEST_TYPES.find((q) => !d.has(q));
    if (!quest) return;
    picks.push({ pick: { skill, quest, xp: questXp(quest, skill.tier), done: d.size }, index });
  });
  picks.sort(
    (a, b) =>
      b.pick.done - a.pick.done || a.pick.skill.tier - b.pick.skill.tier || a.index - b.index,
  );
  return picks.map((p) => p.pick);
}

/** Today's main quest: the next quest of the skill nearest to mastery that the owner can do. */
export function pickMainQuest(
  skills: readonly Skill[],
  completions: readonly QuestCompletion[],
  settings: Pick<Settings, "gear" | "davinciEdition">,
): QuestPick | null {
  return rankQuestCandidates(skills, completions, settings)[0] ?? null;
}

/** Up to n suggestions after the main quest ("More for today"). */
export function pickMoreQuests(
  skills: readonly Skill[],
  completions: readonly QuestCompletion[],
  settings: Pick<Settings, "gear" | "davinciEdition">,
  n = 3,
): QuestPick[] {
  return rankQuestCandidates(skills, completions, settings).slice(1, 1 + n);
}

/* ---------- Micro-actions (5 minutes, keep the streak alive) ---------- */

export interface MicroActionIdea {
  id: string;
  text: LText;
}

export const MICRO_ACTIONS: readonly MicroActionIdea[] = [
  {
    id: "watch-tutorial",
    text: {
      ar: "شوف درس قصير (٥ دقايق) عن مهارة لسه ما خلصتها",
      en: "Watch a 5-minute tutorial on a skill you haven't finished",
    },
  },
  {
    id: "save-reference",
    text: {
      ar: "احفظ ٣ لقطات تعجبك في Cosmos واكتب ليه",
      en: "Save 3 shots you like to Cosmos and note why",
    },
  },
  {
    id: "research-lines",
    text: {
      ar: "اكتب ٣ أسطر في النوتات عن حاجة تعلمتها اليوم",
      en: "Write 3 lines in Notes about something you learned today",
    },
  },
  {
    id: "light-check",
    text: {
      ar: "طالع الضوء في غرفتك دحين: من وين جاي؟ ناعم ولا قاسي؟",
      en: "Look at the light in your room now: where is it from? Soft or hard?",
    },
  },
  {
    id: "one-shot",
    text: {
      ar: "صوّر لقطة وحدة ١٠ ثواني بالجوال بإعدادات مقفولة",
      en: "Film one 10-second shot on your phone with locked settings",
    },
  },
  {
    id: "shortcut",
    text: {
      ar: "تعلّم اختصار كيبورد واحد في دافنشي وجرّبه ٥ مرات",
      en: "Learn one DaVinci keyboard shortcut and use it 5 times",
    },
  },
  {
    id: "frame-study",
    text: {
      ar: "وقّف أي فيديو يعجبك وحلّل الكادر: حجم اللقطة والزاوية",
      en: "Pause a video you like and study the frame: shot size and angle",
    },
  },
  {
    id: "hook-ideas",
    text: { ar: "اكتب ٣ أفكار هوك لفيديو جاي", en: "Write 3 hook ideas for an upcoming video" },
  },
  {
    id: "organize-footage",
    text: {
      ar: "رتّب مجلد تصوير واحد وسمّي الملفات صح",
      en: "Tidy one footage folder and name the files properly",
    },
  },
  {
    id: "color-palette",
    text: {
      ar: "خذ لقطة شاشة من فيلم وطلّع منها باليتة ٣ ألوان",
      en: "Grab a film still and pull a 3-color palette from it",
    },
  },
];

function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic micro-action for a seed (e.g. the day key), so the same day shows the same action. */
export function pickMicroAction(seed: string | number): MicroActionIdea {
  return MICRO_ACTIONS[hashSeed(seed) % MICRO_ACTIONS.length];
}
