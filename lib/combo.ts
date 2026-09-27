import { programs as seedPrograms } from "@/data";
import type { LText, Program, QuestCompletion, Settings, Skill } from "./domain";
import { doneQuestsBySkill, isSkillAvailable } from "./planner";
import { questMinutes } from "./weekPlan";
import { questXp } from "./xp";

/**
 * Combo quests v1 (build plan 2.4, master plan round 21): one craft skill + one software skill make a
 * mini-project that ends in one clip; that clip completes the Produce quest of both skills.
 * Rules-based and pure; the AI coach takes over in Sprint 4.
 */

export type SkillKind = "craft" | "software";

/** craft = technique program (`kind: "craft"`), software = an app program. Unknown programs count as software. */
export function skillKind(
  skill: Pick<Skill, "programId">,
  programs: readonly Program[],
): SkillKind {
  return programs.find((p) => p.id === skill.programId)?.kind === "craft" ? "craft" : "software";
}

export interface ComboPair {
  id: string;
  name: LText;
  /** Candidate craft skill ids, first available wins. Ids not in the seed yet simply never match. */
  craftSkillIds: readonly string[];
  /** Candidate software skill ids, first available wins (e.g. Retime Curve, else Speed Warp). */
  softwareSkillIds: readonly string[];
  brief: LText;
}

/**
 * The four named pairs from round 21, mapped to seed ids.
 * The lav and storyboard pairs have their DaVinci side but no craft skill in the seed yet
 * (the Sound-on-set and Story programs have no skills); they wake up when those packs land.
 */
export const COMBO_PAIRS: readonly ComboPair[] = [
  {
    id: "log-cst",
    name: { ar: "بروفايل Log ↔ CST", en: "Log profile ↔ CST" },
    craftSkillIds: ["iphone-log-prores"],
    softwareSkillIds: ["cst-log-workflow"],
    brief: {
      ar: "صوّر كليب Log وقت الساعة الذهبية ← حوّله لـ Rec.709 بالـ CST في دافنشي. كليب واحد يخلّص المهمتين.",
      en: "Shoot a Log clip at golden hour → convert it to Rec.709 with CST in DaVinci. One clip finishes both.",
    },
  },
  {
    id: "shutter-retime",
    name: { ar: "غالق ١٨٠° ↔ Retime / Speed Warp", en: "180° shutter ↔ Retime / Speed Warp" },
    craftSkillIds: ["phone-180-shutter"],
    softwareSkillIds: ["speed-ramp-retime", "superscale-speedwarp"],
    brief: {
      ar: "صوّر حركة بغالق ١٨٠° ← اعمل لها سبيد رامب أو سلوموشن في دافنشي. كليب واحد يخلّص المهمتين.",
      en: "Shoot motion at a 180° shutter → speed-ramp or slow it down in DaVinci. One clip finishes both.",
    },
  },
  {
    id: "lav-voice",
    name: { ar: "تسجيل لاف ↔ سلسلة الصوت", en: "Lav recording ↔ voice chain" },
    craftSkillIds: ["lav-recording", "lav-vs-shotgun"],
    softwareSkillIds: ["fair-voice-chain"],
    brief: {
      ar: "سجّل صوتك بمايك لاف ← نظّفه بسلسلة EQ + Compressor في Fairlight. كليب واحد يخلّص المهمتين.",
      en: "Record your voice on a lav → clean it with the EQ + compressor chain in Fairlight. One clip finishes both.",
    },
  },
  {
    id: "storyboard-source-tape",
    name: { ar: "ستوريبورد ↔ Source Tape", en: "Storyboard ↔ Source Tape" },
    craftSkillIds: ["shot-list-storyboard", "storyboard"],
    softwareSkillIds: ["source-tape"],
    brief: {
      ar: "خطّط قائمة لقطات وستوريبورد ← صوّرها واختار اللقطات بـ Source Tape في صفحة Cut. كليب واحد يخلّص المهمتين.",
      en: "Plan a shot list and storyboard → shoot it and pick selects with Source Tape on the Cut page. One clip finishes both.",
    },
  },
];

export interface Combo {
  /** A named pair id, or "generic:<craft>+<software>". */
  id: string;
  craftSkillId: string;
  softwareSkillId: string;
  brief: LText;
  /** Both produce quests, in minutes. */
  minutes: number;
  /** Both produce quests' XP. */
  xp: number;
}

export interface ComboInput {
  skills: readonly Skill[];
  completions: readonly QuestCompletion[];
  settings: Pick<Settings, "gear" | "davinciEdition">;
  /** Program list used to tell craft from software; defaults to the seed programs. */
  programs?: readonly Program[];
}

function makeCombo(id: string, craft: Skill, software: Skill, brief: LText): Combo {
  return {
    id,
    craftSkillId: craft.id,
    softwareSkillId: software.id,
    brief,
    minutes: questMinutes("produce", craft.tier) + questMinutes("produce", software.tier),
    xp: questXp("produce", craft.tier) + questXp("produce", software.tier),
  };
}

/**
 * This week's combo: the first named pair whose two produce quests are both incomplete and available;
 * otherwise the best available craft skill and software skill with an incomplete produce quest
 * (nearest to mastery, then lowest tier, then seed order). Null when one side has nothing.
 */
export function suggestCombo(input: ComboInput): Combo | null {
  const { skills, settings } = input;
  const programs = input.programs ?? seedPrograms;
  const done = doneQuestsBySkill(input.completions);
  const byId = new Map(skills.map((s) => [s.id, s]));
  const open = (s: Skill | undefined): s is Skill =>
    !!s && isSkillAvailable(s, settings) && !(done.get(s.id)?.has("produce") ?? false);

  for (const pair of COMBO_PAIRS) {
    const craft = pair.craftSkillIds.map((id) => byId.get(id)).find(open);
    const software = pair.softwareSkillIds.map((id) => byId.get(id)).find(open);
    if (craft && software) return makeCombo(pair.id, craft, software, pair.brief);
  }

  const best = (kind: SkillKind): Skill | undefined =>
    skills
      .map((skill, index) => ({ skill, index }))
      .filter(({ skill }) => open(skill) && skillKind(skill, programs) === kind)
      .sort(
        (a, b) =>
          (done.get(b.skill.id)?.size ?? 0) - (done.get(a.skill.id)?.size ?? 0) ||
          a.skill.tier - b.skill.tier ||
          a.index - b.index,
      )[0]?.skill;
  const craft = best("craft");
  const software = best("software");
  if (!craft || !software) return null;
  return makeCombo(`generic:${craft.id}+${software.id}`, craft, software, {
    ar: `صوّر «${craft.name.ar}» ← عدّله بـ «${software.name.ar}»، كليب واحد`,
    en: `Shoot ${craft.name.en} → edit it with ${software.name.en}, one clip`,
  });
}
