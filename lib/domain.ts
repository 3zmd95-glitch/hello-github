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
  /** Thumbnail URL (Scout Worker search results and oEmbed-enriched pasted links). */
  thumb: z.string().optional(),
});
export type Ref = z.infer<typeof RefSchema>;

/** Seed packs store refs as tuples: [platform, handle, title, url]. */
export const RefTupleSchema = z.tuple([RefPlatformSchema, z.string(), z.string(), z.string()]);
export type RefTuple = z.infer<typeof RefTupleSchema>;

export function refFromTuple([platform, handle, title, url]: RefTuple): Ref {
  return { platform, handle, title, url };
}

/* ---------- Pillars (round 22: Pillar → Program → Section → Skill) ---------- */

export const PillarSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  order: z.number().int().min(1),
  name: LTextSchema,
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Pillar = z.infer<typeof PillarSchema>;

/* ---------- Programs ---------- */

export const SectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: LTextSchema,
});
export type Section = z.infer<typeof SectionSchema>;

export const ProgramSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  pillarId: z.string().min(1),
  /** app = a specific tool; craft = technique/knowledge. Gear and combo logic use it. */
  kind: ProgramKindSchema,
  name: LTextSchema,
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sections: z.array(SectionSchema).min(1),
});
export type Program = z.infer<typeof ProgramSchema>;

/* ---------- Skills ---------- */

/** starter / studio-ai = Skill Scout packs · core = hand-written DaVinci fundamentals · draft = placeholder craft skills. */
export const SkillSourceSchema = z.enum(["starter", "studio-ai", "core", "draft"]);
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

/**
 * Owner-supplied API keys, kept on this device only. One field per provider so more slot in later
 * (e.g. an Anthropic key in Sprint 4) without another schema/store migration.
 */
export const ApiKeysSchema = z.object({
  /** YouTube Data API v3 key, used for in-app search results (Scout v0). */
  youtube: z.string().optional(),
  /** Scout Worker base URL, e.g. https://3z-scout.<subdomain>.workers.dev (build plan 1.14). */
  scoutUrl: z.string().optional(),
  /** Shared owner token the Scout Worker checks on every call (its SCOUT_TOKEN secret). */
  scoutToken: z.string().optional(),
});
export type ApiKeys = z.infer<typeof ApiKeysSchema>;
export type ApiKeyName = keyof ApiKeys;

/* ---------- Avatar (round 9: the "mini you" companion, customizable in Settings) ---------- */

export const SKIN_TONES = ["light", "tan", "medium", "brown", "dark"] as const;
export const HAIR_STYLES = ["short", "buzz", "fade", "curly", "long", "bald"] as const;
export const HAIR_COLORS = ["black", "darkBrown", "brown", "grey", "blond"] as const;
export const BEARD_STYLES = ["none", "mustache", "goatee", "full"] as const;
export const GLASSES_STYLES = ["none", "square", "round", "sunglasses"] as const;
export const HEADWEAR_STYLES = ["none", "cap", "beanie", "shemagh", "ghutra"] as const;
/** Used by the cap and beanie; the shemagh is always red/white and the ghutra white. */
export const HEADWEAR_COLORS = ["black", "green", "red", "white", "navy"] as const;
export const TEE_COLORS = ["black", "white", "green", "navy", "maroon"] as const;
/** Tints the overshirt (rank 1+) and the bomber jacket (rank 8+). */
export const SHIRT_COLORS = ["olive", "navy", "maroon", "sand", "charcoal"] as const;
export const PANTS_COLORS = ["navy", "black", "beige", "grey", "olive"] as const;

export type SkinTone = (typeof SKIN_TONES)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type HairColor = (typeof HAIR_COLORS)[number];
export type BeardStyle = (typeof BEARD_STYLES)[number];
export type GlassesStyle = (typeof GLASSES_STYLES)[number];
export type HeadwearStyle = (typeof HEADWEAR_STYLES)[number];
export type HeadwearColor = (typeof HEADWEAR_COLORS)[number];
export type TeeColor = (typeof TEE_COLORS)[number];
export type ShirtColor = (typeof SHIRT_COLORS)[number];
export type PantsColor = (typeof PANTS_COLORS)[number];

/** Every field has a default, so a partial avatar (or none at all) in an old save still loads. */
export const AvatarSchema = z.object({
  skin: z.enum(SKIN_TONES).default("tan"),
  hair: z.enum(HAIR_STYLES).default("short"),
  hairColor: z.enum(HAIR_COLORS).default("black"),
  beard: z.enum(BEARD_STYLES).default("full"),
  glasses: z.enum(GLASSES_STYLES).default("square"),
  headwear: z.enum(HEADWEAR_STYLES).default("none"),
  headwearColor: z.enum(HEADWEAR_COLORS).default("green"),
  tee: z.enum(TEE_COLORS).default("black"),
  shirt: z.enum(SHIRT_COLORS).default("olive"),
  pants: z.enum(PANTS_COLORS).default("navy"),
});
export type Avatar = z.infer<typeof AvatarSchema>;
export type AvatarPart = keyof Avatar;

/** The owner's look from master plan round 9: tan skin, short black hair, full beard, glasses, olive over black. */
export const DEFAULT_AVATAR: Avatar = {
  skin: "tan",
  hair: "short",
  hairColor: "black",
  beard: "full",
  glasses: "square",
  headwear: "none",
  headwearColor: "green",
  tee: "black",
  shirt: "olive",
  pants: "navy",
};

export const SettingsSchema = z.object({
  lang: LangSchema,
  sound: z.boolean(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  gear: z.array(GearSchema),
  davinciEdition: z.enum(["studio", "free"]),
  apiKeys: ApiKeysSchema.default({}),
  avatar: AvatarSchema.default(DEFAULT_AVATAR),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const QuestCompletionSchema = z.object({
  skillId: z.string().min(1),
  quest: QuestTypeSchema,
  at: z.iso.datetime({ offset: true }),
  proofUrl: z.string().optional(),
});
export type QuestCompletion = z.infer<typeof QuestCompletionSchema>;

export const XpSourceSchema = z.enum(["quest", "mastery", "micro", "review", "bonus", "drill"]);
export type XpSource = z.infer<typeof XpSourceSchema>;

export const XpEventSchema = z.object({
  id: z.string().min(1),
  source: XpSourceSchema,
  amount: z.number().int(),
  at: z.iso.datetime({ offset: true }),
  /** "skillId:quest" for quests · skillId for mastery and drills · micro-action id for micro · week key for review. */
  refId: z.string().optional(),
});
export type XpEvent = z.infer<typeof XpEventSchema>;

export const MicroActionSchema = z.object({
  id: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
  text: LTextSchema,
});
export type MicroAction = z.infer<typeof MicroActionSchema>;

/* ---------- Gamification core (Sprint 2: gems, chests, focus, badges, boss, seasons, drills) ---------- */

export const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/** Why gems moved. Positive reasons earn; `purchase` spends (negative amount). */
export const GemReasonSchema = z.enum([
  "quest",
  "mastery",
  "dayComplete",
  "review",
  "badge",
  "boss",
  "season",
  "chest",
  "purchase",
]);
export type GemReason = z.infer<typeof GemReasonSchema>;

export const GemEventSchema = z.object({
  id: z.string().min(1),
  /** Positive = earned, negative = spent. */
  amount: z.number().int(),
  at: z.iso.datetime({ offset: true }),
  reason: GemReasonSchema,
  /** quest ref, skill id, day key, week key, badge id, boss month, season key, chest number or reward id. */
  refId: z.string().optional(),
});
export type GemEvent = z.infer<typeof GemEventSchema>;

export const FOCUS_MINUTES = [25, 60] as const;
export const FocusMinutesSchema = z.union([z.literal(25), z.literal(60)]);
export type FocusMinutes = z.infer<typeof FocusMinutesSchema>;

/** The running focus session ("potion"), if any. */
export const FocusStateSchema = z.object({
  startedAt: z.iso.datetime({ offset: true }),
  minutes: FocusMinutesSchema,
});
export type FocusState = z.infer<typeof FocusStateSchema>;

export const FocusSessionSchema = z.object({
  id: z.string().min(1),
  startedAt: z.iso.datetime({ offset: true }),
  minutes: FocusMinutesSchema,
  endedAt: z.iso.datetime({ offset: true }),
  /** True when stopped before the timer ran out. */
  early: z.boolean(),
});
export type FocusSession = z.infer<typeof FocusSessionSchema>;

export const BadgeAwardSchema = z.object({
  id: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
});
export type BadgeAward = z.infer<typeof BadgeAwardSchema>;

/** Spaced-repetition drill on a mastered skill. */
export const DrillSchema = z.object({
  skillId: z.string().min(1),
  /** Riyadh day key when the drill is next due. */
  nextDue: z.string().regex(DAY_KEY_RE),
  intervalDays: z.number().int().min(1),
  /** How many times the drill was completed. */
  reps: z.number().int().min(0).default(0),
});
export type Drill = z.infer<typeof DrillSchema>;

/** Weekly review (Sprint 2). `week` is the Saturday key of the reviewed week. */
export const ReviewSchema = z.object({
  week: z.string().regex(DAY_KEY_RE),
  mood: z.number().int().min(1).max(5),
  wins: z.string(),
  blocks: z.string(),
  next: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type Review = z.infer<typeof ReviewSchema>;

export const PlanItemBySchema = z.enum(["rules", "me"]);
export type PlanItemBy = z.infer<typeof PlanItemBySchema>;

/** One planned quest in the weekly planner. Whether it is done is derived from `completions`. */
export const PlanItemSchema = z.object({
  id: z.string().min(1),
  /** Saturday key of the plan's week. */
  week: z.string().regex(DAY_KEY_RE),
  /** 0 = Saturday … 6 = Friday. */
  day: z.number().int().min(0).max(6),
  skillId: z.string().min(1),
  quest: QuestTypeSchema,
  minutes: z.number().int().min(0),
  by: PlanItemBySchema,
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

/** Seeded rewards carry bilingual names; owner-typed ones are plain strings. */
export const RewardTextSchema = z.union([z.string().min(1), LTextSchema]);
export type RewardText = z.infer<typeof RewardTextSchema>;

/** Owner-defined real-world reward in the gem shop. */
export const RewardSchema = z.object({
  id: z.string().min(1),
  name: RewardTextSchema,
  desc: RewardTextSchema.optional(),
  /** Price in gems. */
  cost: z.number().int().min(0),
  minLevel: z.number().int().min(1).optional(),
  repeatable: z.boolean(),
  icon: z.string().min(1),
  /** Built-in rewards (the streak freeze) cannot be removed. */
  builtIn: z.boolean().optional(),
});
export type Reward = z.infer<typeof RewardSchema>;

export const PurchaseSchema = z.object({
  id: z.string().min(1),
  rewardId: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
  cost: z.number().int().min(0),
});
export type Purchase = z.infer<typeof PurchaseSchema>;
