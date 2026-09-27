import { z } from "zod";
import corePack from "@/planning/data/davinci-core-pack.json";
import starterPack from "@/planning/data/davinci-starter-pack.json";
import studioAiPack from "@/planning/data/davinci-studio-ai-pack.json";
import {
  ArGapSchema,
  LTextSchema,
  QuestTextsSchema,
  RefTupleSchema,
  SkillIdeaSchema,
  TierSchema,
  refFromTuple,
  type Skill,
} from "@/lib/domain";

/**
 * DaVinci Resolve skills, loaded straight from the packs in planning/data/
 * (21 starter + 6 Studio AI from Skill Scout, 35 hand-written core fundamentals with no refs).
 * The JSON stays the single source; this file only maps its shape.
 */

/** Shape of one card in the pack JSON files. */
export const PackSkillSchema = z.object({
  id: z.string(),
  page: z.enum(["media", "cut", "edit", "fusion", "color", "fair", "deliver"]),
  ar: z.string().min(1),
  en: z.string().min(1),
  tier: TierSchema,
  studio: z.boolean().optional(),
  set: z.enum(["starter", "studio", "core"]).optional(),
  related: LTextSchema.optional(),
  what: LTextSchema.optional(),
  ideasTitle: LTextSchema.optional(),
  ideas: z.array(SkillIdeaSchema).optional(),
  steps: z.array(LTextSchema).optional(),
  quests: QuestTextsSchema,
  trend: LTextSchema.optional(),
  refs: z.array(RefTupleSchema),
  arGap: ArGapSchema.optional(),
});
export type PackSkill = z.infer<typeof PackSkillSchema>;

export function packSkillToSkill(raw: unknown, fallbackSource: Skill["source"]): Skill {
  const p = PackSkillSchema.parse(raw);
  return {
    id: p.id,
    programId: "davinci",
    sectionId: p.page,
    name: { ar: p.ar, en: p.en },
    tier: p.tier,
    gear: "any",
    studio: p.studio ?? false,
    source:
      p.set === "studio"
        ? "studio-ai"
        : p.set === "starter"
          ? "starter"
          : p.set === "core"
            ? "core"
            : fallbackSource,
    related: p.related,
    what: p.what,
    ideasTitle: p.ideasTitle,
    ideas: p.ideas,
    steps: p.steps,
    quests: p.quests,
    trend: p.trend,
    refs: p.refs.map(refFromTuple),
    arGap: p.arGap,
  };
}

export const davinciStarterSkills: Skill[] = (starterPack as unknown[]).map((r) =>
  packSkillToSkill(r, "starter"),
);

export const davinciStudioAiSkills: Skill[] = (studioAiPack as unknown[]).map((r) =>
  packSkillToSkill(r, "studio-ai"),
);

/** Hand-written fundamentals (35 cards, refs: [] so the research button finds videos on demand). */
export const davinciCoreSkills: Skill[] = (corePack as unknown[]).map((r) =>
  packSkillToSkill(r, "core"),
);

export const davinciSkills: Skill[] = [
  ...davinciStarterSkills,
  ...davinciStudioAiSkills,
  ...davinciCoreSkills,
];
