import { z } from "zod";
import {
  PillarSchema,
  ProgramSchema,
  SkillSchema,
  type Pillar,
  type Program,
  type Skill,
} from "@/lib/domain";
import { pillars } from "./pillars";
import { programs } from "./programs";
import { craftDraftSkills } from "./skills/craft-draft";
import { davinciSkills } from "./skills/davinci";

export { pillars } from "./pillars";
export { programs } from "./programs";

export const skills: Skill[] = [...davinciSkills, ...craftDraftSkills];

const skillIndex = new Map(skills.map((s) => [s.id, s]));
const programIndex = new Map(programs.map((p) => [p.id, p]));

/** Skills grouped by program id (every program has an entry, possibly empty). */
export const skillsByProgram: Record<string, Skill[]> = Object.fromEntries(
  programs.map((p) => [p.id, skills.filter((s) => s.programId === p.id)]),
);

/** Programs of one pillar, in display order (empty for an unknown pillar). */
export function programsByPillar(pillarId: string): Program[] {
  return programs.filter((p) => p.pillarId === pillarId);
}

export function getPillar(id: string): Pillar | undefined {
  return pillars.find((p) => p.id === id);
}

export function getSkill(id: string): Skill | undefined {
  return skillIndex.get(id);
}

export function getProgram(id: string): Program | undefined {
  return programIndex.get(id);
}

/**
 * Parse all seed data with Zod and check cross references.
 * Throws a descriptive error on the first problem; returns the parsed seed otherwise.
 */
export function validateSeed(): { pillars: Pillar[]; programs: Program[]; skills: Skill[] } {
  const parsedPillars = z.array(PillarSchema).parse(pillars);
  const parsedPrograms = z.array(ProgramSchema).parse(programs);
  const parsedSkills = z.array(SkillSchema).parse(skills);

  const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  const dupPillars = dupes(parsedPillars.map((p) => p.id));
  if (dupPillars.length) throw new Error(`Duplicate pillar ids: ${dupPillars.join(", ")}`);
  const dupOrders = dupes(parsedPillars.map((p) => String(p.order)));
  if (dupOrders.length) throw new Error(`Duplicate pillar orders: ${dupOrders.join(", ")}`);
  const dupPrograms = dupes(parsedPrograms.map((p) => p.id));
  if (dupPrograms.length) throw new Error(`Duplicate program ids: ${dupPrograms.join(", ")}`);
  const dupSkills = dupes(parsedSkills.map((s) => s.id));
  if (dupSkills.length) throw new Error(`Duplicate skill ids: ${dupSkills.join(", ")}`);

  const pillarIds = new Set(parsedPillars.map((p) => p.id));
  for (const p of parsedPrograms) {
    if (!pillarIds.has(p.pillarId))
      throw new Error(`Program ${p.id}: unknown pillar "${p.pillarId}"`);
    const dupSections = dupes(p.sections.map((s) => s.id));
    if (dupSections.length)
      throw new Error(`Duplicate section ids in ${p.id}: ${dupSections.join(", ")}`);
  }

  for (const s of parsedSkills) {
    const program = programIndex.get(s.programId);
    if (!program) throw new Error(`Skill ${s.id}: unknown program "${s.programId}"`);
    if (!program.sections.some((sec) => sec.id === s.sectionId))
      throw new Error(`Skill ${s.id}: section "${s.sectionId}" not in program "${s.programId}"`);
  }

  return { pillars: parsedPillars, programs: parsedPrograms, skills: parsedSkills };
}
