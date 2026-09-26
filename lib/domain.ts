import { z } from "zod";

/* ---------- Primitives ---------- */

export const LangSchema = z.enum(["ar", "en"]);
export type Lang = z.infer<typeof LangSchema>;

/** Bilingual text. Arabic (Hijazi) first, English second. */
export const LTextSchema = z.object({ ar: z.string().min(1), en: z.string().min(1) });
export type LText = z.infer<typeof LTextSchema>;

export const ProgramKindSchema = z.enum(["app", "craft"]);
export type ProgramKind = z.infer<typeof ProgramKindSchema>;

export const GearSchema = z.enum(["phone", "any", "camera", "gimbal", "lights", "mic"]);
export type Gear = z.infer<typeof GearSchema>;

export const QUEST_TYPES = ["train", "research", "produce", "article"] as const;
export const QuestTypeSchema = z.enum(QUEST_TYPES);
export type QuestType = z.infer<typeof QuestTypeSchema>;

/** Difficulty tier: 1 Basic ×1 · 2 Intermediate ×1.5 · 3 Advanced ×2. */
export const TierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Tier = z.infer<typeof TierSchema>;

/* ---------- References ---------- */

export const RefPlatformSchema = z.enum(["tt", "ig", "yt", "web"]);
export type RefPlatform = z.infer<typeof RefPlatformSchema>;

export const RefSchema = z.object({
  platform: RefPlatformSchema,
  handle: z.string(),
  title: z.string().min(1),
  url: z.url(),
});
export type Ref = z.infer<typeof RefSchema>;

/** Seed packs store refs as tuples: [platform, handle, title, url]. */
export const RefTupleSchema = z.tuple([RefPlatformSchema, z.string(), z.string(), z.string()]);
export type RefTuple = z.infer<typeof RefTupleSchema>;

export function refFromTuple([platform, handle, title, url]: RefTuple): Ref {
  return { platform, handle, title, url };
}

/* ---------- Programs ---------- */

export const SectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: LTextSchema,
});
export type Section = z.infer<typeof SectionSchema>;

export const ProgramSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  kind: ProgramKindSchema,
  name: LTextSchema,
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sections: z.array(SectionSchema).min(1),
});
export type Program = z.infer<typeof ProgramSchema>;

/* ---------- Skills ---------- */

export const SkillSourceSchema = z.enum(["starter", "studio-ai", "draft"]);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const SkillIdeaSchema = z.object({ name: LTextSchema, desc: LTextSchema });
export type SkillIdea = z.infer<typeof SkillIdeaSchema>;

export const QuestTextsSchema = z.object({
  train: LTextSchema,
  research: LTextSchema,
  produce: LTextSchema,
  article: LTextSchema,
});
export type QuestTexts = z.infer<typeof QuestTextsSchema>;

export const ArGapSchema = LTextSchema.extend({ has: z.boolean() });
export type ArGap = z.infer<typeof ArGapSchema>;

export const SkillSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  programId: z.string().min(1),
  sectionId: z.string().min(1),
  name: LTextSchema,
  tier: TierSchema,
  gear: GearSchema,
  /** True when the skill needs DaVinci Resolve Studio (paid). */
  studio: z.boolean(),
  source: SkillSourceSchema,
  related: LTextSchema.optional(),
  what: LTextSchema.optional(),
  ideasTitle: LTextSchema.optional(),
  ideas: z.array(SkillIdeaSchema).optional(),
  steps: z.array(LTextSchema).optional(),
  quests: QuestTextsSchema,
  trend: LTextSchema.optional(),
  refs: z.array(RefSchema),
  arGap: ArGapSchema.optional(),
});
export type Skill = z.infer<typeof SkillSchema>;

/* ---------- Owner state ---------- */

export const SettingsSchema = z.object({
  lang: LangSchema,
  sound: z.boolean(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  gear: z.array(GearSchema),
  davinciEdition: z.enum(["studio", "free"]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const QuestCompletionSchema = z.object({
  skillId: z.string().min(1),
  quest: QuestTypeSchema,
  at: z.iso.datetime({ offset: true }),
  proofUrl: z.string().optional(),
});
export type QuestCompletion = z.infer<typeof QuestCompletionSchema>;

export const XpSourceSchema = z.enum(["quest", "mastery", "micro", "review", "bonus"]);
export type XpSource = z.infer<typeof XpSourceSchema>;

export const XpEventSchema = z.object({
  id: z.string().min(1),
  source: XpSourceSchema,
  amount: z.number().int(),
  at: z.iso.datetime({ offset: true }),
  /** e.g. "skillId:quest" for quests, skillId for mastery, micro-action id for micro. */
  refId: z.string().optional(),
});
export type XpEvent = z.infer<typeof XpEventSchema>;

export const MicroActionSchema = z.object({
  id: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
  text: LTextSchema,
});
export type MicroAction = z.infer<typeof MicroActionSchema>;
