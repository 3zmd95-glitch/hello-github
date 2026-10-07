/**
 * The owner's skills as the lessons' AI may name them (planning/tools/19-category-trends.md §3): the id and English and
 * Arabic names of the DaVinci packs (planning/data/davinci-*.json) and the craft skills (data/skills/craft-draft.ts), in
 * the app's order. `skills.json` is a generated copy that data/skills/skills-index.test.ts keeps in step (the command
 * to regenerate it is in that test). Bundled like genres.json (`trends/json.d.ts` types it).
 */

import raw from "./skills.json";

export interface SkillRef {
  id: string;
  en: string;
  ar: string;
}

const isSkill = (x: unknown): x is SkillRef =>
  !!x &&
  typeof x === "object" &&
  ["id", "en", "ar"].every((k) => typeof (x as Record<string, unknown>)[k] === "string");

export const SKILLS: readonly SkillRef[] = Array.isArray(raw) ? raw.filter(isSkill) : [];
export const SKILL_IDS: ReadonlySet<string> = new Set(SKILLS.map((s) => s.id));
