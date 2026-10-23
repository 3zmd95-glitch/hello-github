import { z } from "zod";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistStorage,
  type StateStorage,
} from "zustand/middleware";
import { getProgram, getSkill, pillars, programs } from "@/data";
import { BADGES, newBadges, type Badge, type BadgeContext } from "@/lib/badges";
import { bossState, type BossState } from "@/lib/boss";
import {
  chestProgress as chestProgressOf,
  lootFor,
  type ChestProgress,
  type Loot,
} from "@/lib/chests";
import {
  AudienceAskSchema,
  ArticleSchema,
  BadgeAwardSchema,
  CustomGenreSchema,
  DEFAULT_AVATAR,
  DemographicSchema,
  EMPTY_SOCIAL_SYNC,
  EMPTY_TRENDS,
  DrillSchema,
  FocusSessionSchema,
  FocusStateSchema,
  GemEventSchema,
  IdeaSchema,
  LTextSchema,
  MONTH_KEY_RE,
  MicroActionSchema,
  NOTE_MAX_CHARS,
  NoteSchema,
  PlanItemSchema,
  PostSchema,
  PurchaseSchema,
  QUEST_TYPES,
  QuestCompletionSchema,
  RefSchema,
  ReviewSchema,
  RewardSchema,
  SettingsSchema,
  ShotSchema,
  SocialAccountSchema,
  SocialPostStatSchema,
  SocialSnapshotSchema,
  SocialSyncStateSchema,
  TrendsFeedSchema,
  TrendsStateSchema,
  XpEventSchema,
  WorkflowRunSchema,
  WorkflowSchema,
  BrandDealSchema,
  BusinessKitSchema,
  type BrandDeal,
  type BusinessKit,
  type DealStage,
  type Article,
  type ArticleStatus,
  type ApiKeyName,
  type AudienceAsk,
  type Demographic,
  type Drill,
  type FocusMinutes,
  type FocusSession,
  type FocusState,
  type GemEvent,
  type GemReason,
  type Idea,
  type IdeaSource,
  type LText,
  type MicroAction,
  type Note,
  type PlanItem,
  type Platform,
  type Post,
  type PostInput,
  type PostStage,
  type Purchase,
  type QuestCompletion,
  type QuestType,
  type Ref,
  type Review,
  type Reward,
  type Settings,
  type Shot,
  type SocialAccount,
  type SocialPostStat,
  type SocialPostStatInput,
  type SocialSnapshot,
  type SocialSnapshotInput,
  type SocialStatusMap,
  type SocialSyncState,
  type TrendsFeedInput,
  type TrendsState,
  type XpEvent,
  type Workflow,
  type WorkflowAction,
  type WorkflowRun,
} from "@/lib/domain";
import {
  SEED_ACCOUNTS,
  SOCIAL_SEED_DAY,
  SOCIAL_SEED_PLATFORMS,
  SOCIAL_SEED_VERSION,
} from "@/data/social-seed";
import { advanceDrill, dueDrills as dueDrillsOf, newDrill } from "@/lib/drills";
import { replaceDemographics, upsertPostStats } from "@/lib/analytics";
import { upsertSnapshots } from "@/lib/growth";
import {
  bestTime,
  nextPost as nextPostOf,
  shotsFromTemplate,
  suggestHashtags,
  type NextPost,
} from "@/lib/social";
import { flowState } from "@/lib/flow";
import { customGenreId, isGenreNameTaken } from "@/lib/genres";
import { focusActive as focusActiveOf, stoppedEarly, type FocusActive } from "@/lib/focus";
import {
  FREEZE_REWARD_ID,
  GEM_RULES,
  canBuy,
  defaultRewards,
  ensureBuiltInRewards,
  gemBalance,
  questGems,
  type BuyRefusal,
} from "@/lib/gems";
import { articleIssues, articlePersisted, storageDurable } from "@/lib/articles";
import {
  JOURNAL_CAPACITY,
  candidateEntry,
  compareObservations,
  emptyJournal,
  isSuppressed,
  journalIs,
  mergeJournals,
  observationOf,
  parseJournal,
  readJournal,
  resetJournal,
  sameData,
  verifyJournal,
  verifyObservation,
  withEntry,
  withObservation,
  withoutEntry,
  type Candidate,
  type CandidateRefusal,
  type CloudJournal,
  type JournalEntry,
  type Suppression,
} from "@/lib/cloudWorkflowJournal";
import {
  ackRequestFor,
  authorityKey,
  authorityOf,
  canonicalOrigin,
  cloneJson,
  deepFreeze,
  isVerifiedReceipt,
  occurrenceKey,
  readyOccurrenceId,
  type Authority,
  type CloudRequest,
  type FullReceipt,
  type Parsed,
} from "@/lib/cloudWorkflowProtocol";
import { payloadDigestOf, type Obj } from "@/workers/scout/src/social/workflowProtocol";
import {
  ackEligibility,
  applyDeletions,
  dropDeleted,
  mergeReconciliations,
  parseReconciliation,
  planReceipt,
  readReconciliation,
  reconciliationIs,
  retireOccurrence,
  stamp,
  verifyProof,
  withCursor,
  withPending,
  type CloudReconciliation,
  type OutputLists,
} from "@/lib/cloudWorkflowReconciliation";
import type {
  AckRefusal,
  CommitInput,
  CommitOutcome,
  LocalBinding,
  ReconciliationPersistence,
  SnapshotRead,
} from "@/lib/cloudWorkflowReconciliationClient";
import type {
  CloudFence,
  OccurrencePersistence,
  OccurrenceRead,
  OccurrenceReadFailure,
  SavedOccurrence,
} from "@/lib/cloudWorkflowOccurrenceClient";
import { buildCloudSnapshot, type SnapshotRefusal } from "@/lib/cloudWorkflowSnapshot";
import {
  admitEntries,
  bindRegistration,
  captureView,
  resolveOwnership,
  verifyOwnershipEvidence,
  workflowDigestOf,
  type BindingRefusal,
  type CloudCaptureView,
  type Ownership,
  type OwnershipBlock,
} from "@/lib/cloudWorkflowCapture";
import {
  emptyRegistrations,
  mergeRegistrations,
  parseRegistrations,
  readRegistrations,
  registrationsIs,
  verifyRegistrations,
  type CloudRegistrations,
  type PersistFailure,
  type RegistrationPersistence,
} from "@/lib/cloudWorkflowRegistration";
import {
  DM_ID_RE,
  DM_MESSAGE_ID_RE,
  DM_SEND_STATES,
  IG_SEND_STATES,
  INBOX_DRAFT_MAX,
  INBOX_DRAFTS_MAX,
  SEND_STATES,
  THREADS_SEND_STATES,
  dmControlKey,
  dmOpKey,
} from "@/lib/inboxReviewState";
import {
  PUBLISH_ID_RE,
  autoPostOf,
  jobOwnership,
  rememberedJobId,
  takenJobIds,
} from "@/lib/publish";
import {
  articleInput,
  buildOutput,
  duplicateActionIds,
  manualInput,
  newAction,
  workflowIssues,
  workflowOutputId,
} from "@/lib/workflows";
import { levelFromXp } from "@/lib/level";
import { canonicalRefUrl } from "@/lib/research";
import type { ResearchItem } from "@/lib/research";
import {
  InspirationsSchema,
  InspirationSchema,
  inspirationKey,
  saveInspiration,
  INSPIRATION_NOTE_MAX,
  type InspirationStage,
} from "@/lib/inspiration";
import { rankFromXp } from "@/lib/rank";
import type { DiscoverItem } from "@/lib/discover";
import type { AiSelection } from "@/lib/localAi";
import { DiscoverSemanticResponseSchema, applicableDiscoverSemantic } from "@/lib/discoverSemantic";
import { applyInstagramEvidence, applyTikTokEvidence } from "@/lib/discoverSources";
import {
  CapturedVideoReviewResponseSchema,
  DiscoverVisualResponseSchema,
  DISCOVER_VISUAL_TTL_MS,
  applicableDiscoverVisual,
  canonicalDiscoverVisualUrl,
  discoverVisualSourceMatches,
} from "@/lib/discoverVisual";
import { canonicalNativeVideoUrl } from "@/lib/nativeVideoCapture";
import {
  DiscoverCandidatesSchema,
  DiscoverFeedbackListSchema,
  accumulateCategoryCandidates,
  changeDiscoverFeedback,
  restoreDiscoverFeedback,
  localDiscoverCandidateFallback,
  mergeDiscoverCandidates,
  discoverCreatorKey,
  discoverPostKey,
  type DiscoverCandidate,
  type DiscoverFeedbackInput,
  type DiscoverFeedbackUndo,
} from "@/lib/discoverFeed";
import {
  createDiscoverLibrary,
  indexedDiscoverLibrary,
  type DiscoverLibraryStatus,
} from "@/lib/discoverLibrary";
import {
  EditFormatSchema,
  FollowedFormatsSchema,
  formatIdentity,
  type EditFormat,
} from "@/lib/editFormats";
import type { EditorScope } from "@/lib/editorFilter";
import {
  FormatObservationsSchema,
  upsertFormatObservation,
  type FormatObservationInput,
} from "@/lib/formatObservations";
import {
  FormatQueueSchema,
  formatTargetId,
  addFormatCandidates as addFormatCandidatesToQueue,
  removeFormatCandidate as removeFormatCandidateFromQueue,
} from "@/lib/formatQueue";
import type { FormatVerificationTarget } from "@/lib/formatVerification";
import { seasonState, type SeasonState } from "@/lib/season";
import {
  FREEZE_TOTAL_CAP,
  bonusFreezesSpent,
  computeStreak,
  dayKey,
  daysToFreeze,
  freezeStock,
  weekKey,
  type StreakResult,
} from "@/lib/streak";
import { DRILL_XP, MASTERY_BONUS, REVIEW_XP, focusedXp, microXp, questXp } from "@/lib/xp";

/**
 * The one data layer: progress lives on the phone (localStorage).
 * Screens call these actions and selectors and never touch storage directly, so a Supabase adapter can
 * replace the persistence in Sprint 3 without changing screens.
 *
 * Sprint 2 adds the gamification core on top of quests: gems, chests, focus sessions, bonus freezes, badges,
 * the monthly boss, seasons, drills, weekly reviews, plan items and the rewards shop. Every new field has a
 * default so saves and export files from before it still load.
 */

export const STORAGE_KEY = "3z-prod-v1";
export const STORE_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  lang: "ar",
  sound: true,
  appearance: "light",
  reminderTime: "20:00",
  gear: ["phone", "lights"],
  davinciEdition: "studio",
  apiKeys: {},
  avatar: DEFAULT_AVATAR,
  discover: { editorScope: "mine" },
};

/** Old saves held `reviews: unknown[]`; entries that are not a Review are dropped on load. */
const ReviewsSchema = z
  .array(z.unknown())
  .default([])
  .transform((list) =>
    list.flatMap((r) => {
      const p = ReviewSchema.safeParse(r);
      return p.success ? [p.data] : [];
    }),
  );

/**
 * 📥 One private inbox draft (packet DT-6A), keyed by `inboxScope` (Worker origin, account id, kind, id): the owner's
 * own words only. Fetched messages and comments never enter the persisted root.
 */
export const InboxDraftSchema = z.object({
  text: z.string().max(INBOX_DRAFT_MAX),
  updatedAt: z.string(),
  commitId: z.string().min(1),
});
export type InboxDraft = z.infer<typeof InboxDraftSchema>;
/** The persisted draft record (also the read-back proof's schema, DT-6A-R1). */
const InboxDraftsSchema = z.record(z.string(), InboxDraftSchema);

/**
 * Send-operation handles kept on this device. Only settled ones (INBOX_SEND_SETTLED) are ever dropped, the oldest first;
 * when 50 unresolved handles are kept a new one is refused with `capacity` (DT-6B-2A-R1, 2A-3).
 */
export const INBOX_SEND_OPS_MAX = 50;
/** Handle states that can no longer send: the only ones the cap may drop, and final for their operation. */
export const INBOX_SEND_SETTLED: readonly string[] = ["sent", "rejected", "expired", "cancelled"];
/**
 * 📤 The handle of one reviewed YouTube reply (packet DT-6B-2A, planning/tools/37-inbox-send.md), keyed by the draft's
 * scope: which Worker operation it is, for which account and draft revision, the reviewed text's digest and the last
 * known state ("preparing" is written BEFORE the prepare request, so a reload never makes a second intent). Never the
 * text, a token or a provider body; the Worker's coordinator holds the receipt.
 */
export const InboxSendOpSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  account: z.string().min(1).max(256),
  draftRevision: z.string().min(1).max(64),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.enum(["preparing", ...SEND_STATES]),
  /**
   * DT-6B-2A-R1 (2A-2): the Worker's `updatedAt` (ms) of the receipt this handle last recorded. A write without it is
   * a local step (preparing, the dispatching mark before Confirm, its roll-back) and keeps the version it found.
   */
  receiptVersion: z.number().int().nonnegative().optional(),
  updatedAt: z.string(),
  commitId: z.string().min(1),
});
export type InboxSendOp = z.infer<typeof InboxSendOpSchema>;
const InboxSendOpsSchema = z.record(z.string(), InboxSendOpSchema);

/** Threads handle states that can no longer publish: the only ones the cap may drop, and final for their operation. */
export const INBOX_THREADS_SEND_SETTLED: readonly string[] = [
  "published",
  "rejected",
  "cancelled",
  "expired",
];
/** Durable Threads states each one can still reach (a later receipt may skip states this device never saw). */
const THREADS_SEND_NEXT: Record<string, readonly string[]> = {
  prepared: [
    "creating",
    "created",
    "publishing",
    "published",
    "rejected",
    "unknown_creation",
    "unknown_publication",
    "cancelled",
    "expired",
  ],
  creating: [
    "created",
    "publishing",
    "published",
    "rejected",
    "unknown_creation",
    "unknown_publication",
  ],
  created: ["publishing", "published", "rejected", "unknown_publication"],
  publishing: ["published", "rejected", "unknown_publication"],
  unknown_creation: ["published", "rejected"],
  unknown_publication: ["published", "rejected"],
};
const ThreadsId = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
/**
 * 📤 The handle of one reviewed Threads reply (packet DT-6B-2B-2, planning/tools/37-inbox-send.md), keyed by the draft's
 * v2 Threads scope (provider, Worker origin, account, reply id). Separate from YouTube's `inboxSendOps`. Two local
 * states: "preparing" (written BEFORE the prepare request) and "confirming" (written BEFORE the confirm request: the
 * request may have reached the Worker, so only Check status follows); every other state is a Worker receipt with its
 * integer `receiptVersion`. Identifiers, digest, revision, state and version only: never the text, a token or a body.
 */
export const InboxThreadsSendOpSchema = z.strictObject({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  account: ThreadsId,
  draftRevision: z.string().min(1).max(64),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.enum(["preparing", "confirming", ...THREADS_SEND_STATES]),
  /** The Worker's receipt version this handle last recorded; a local step keeps the one it found. */
  receiptVersion: z.number().int().nonnegative().optional(),
  containerId: ThreadsId.optional(),
  publishedId: ThreadsId.optional(),
  /**
   * DT-6B-2B-2-R1 (2B2-3): the Worker origin the operation lives on; recovery asks only that Worker. Absent on 2B-2
   * handles (then the origin in the scope key stands for it); written with the operation's next durable write.
   */
  workerOrigin: z
    .string()
    .regex(/^https?:\/\/[^/?#\s]{1,253}$/)
    .optional(),
  updatedAt: z.string(),
  commitId: z.string().min(1),
});
export type InboxThreadsSendOp = z.infer<typeof InboxThreadsSendOpSchema>;
const InboxThreadsSendOpsSchema = z.record(z.string(), InboxThreadsSendOpSchema);

/** What an operation is bound to for life (DT-6B-2B-2-R1): another value for the same operation is refused. */
const THREADS_SEND_IDENTITY = ["account", "draftRevision", "digest"] as const;

/**
 * Compare-and-swap of one Threads handle against the stored one of the same operation: null when it may be written.
 * A local step (no version) only marks Confirm or rolls that mark back; a receipt older than the stored one is stale;
 * an equal version naming another state contradicts it; a later version may only move forward; a container id or a
 * publication id never changes (DT-6B-2B-2-R1, at any version), nor do the operation's account, revision, digest and
 * Worker origin.
 */
function threadsSendStep(
  prior: InboxThreadsSendOp,
  op: Omit<InboxThreadsSendOp, "updatedAt" | "commitId">,
): "stale" | "invalid" | null {
  if (THREADS_SEND_IDENTITY.some((k) => op[k] !== prior[k])) return "invalid";
  if (prior.workerOrigin && op.workerOrigin && op.workerOrigin !== prior.workerOrigin)
    return "invalid";
  if (prior.containerId && op.containerId && op.containerId !== prior.containerId) return "stale";
  if (prior.publishedId && op.publishedId && op.publishedId !== prior.publishedId) return "stale";
  // "confirming" stands for the receipt it was marked on: created when a container is known, else prepared.
  const from =
    prior.state === "confirming" ? (prior.containerId ? "created" : "prepared") : prior.state;
  const v = op.receiptVersion;
  if (v === undefined)
    return (op.state === "confirming" && (from === "prepared" || from === "created")) ||
      (prior.state === "confirming" && op.state === from)
      ? null
      : "stale";
  if (op.state === "preparing" || op.state === "confirming") return "invalid";
  if (prior.state === "preparing") return null;
  const pv = prior.receiptVersion ?? 0;
  if (v < pv) return "stale";
  if (op.state === from) return null;
  if (v === pv) return "stale";
  return THREADS_SEND_NEXT[from]?.includes(op.state) ? null : "stale";
}

/** Instagram public handle states that can no longer send: the only ones the cap may drop, and final for their operation. */
export const INBOX_IG_SEND_SETTLED: readonly string[] = [
  "sent",
  "rejected",
  "already_claimed",
  "expired",
  "cancelled",
];
/**
 * Durable Instagram public states each one can still reach. `unknown` stays open to `sent` / `rejected`: a lost receipt
 * (the Worker's answer derived from the dispatching intent) may later read back as the outcome that was recorded.
 */
const IG_SEND_NEXT: Record<string, readonly string[]> = {
  prepared: [
    "dispatching",
    "sent",
    "rejected",
    "unknown",
    "already_claimed",
    "expired",
    "cancelled",
  ],
  dispatching: ["sent", "rejected", "unknown"],
  unknown: ["sent", "rejected"],
};
const IgId = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
/**
 * 📤 The handle of one reviewed Instagram public comment reply (packet DT-6B-2C-4, planning/tools/37-inbox-send.md), keyed
 * `instagram|<comment draft scope>`. Separate from the YouTube and Threads slices. Two local states: "preparing" (written
 * BEFORE the prepare request) and "confirming" (the pending-confirm mark written BEFORE the confirm request: it may have
 * reached the Worker, so only Check status follows); every other state is a Worker receipt with its integer
 * `receiptVersion`. The Worker origin, account, raw media/comment selectors, revision and digest are the operation's
 * identity; `sendGeneration` is learned from the prepared intent (never the reader's generation); `providerReplyId` is
 * immutable proof. Never the text, a token or a provider body.
 */
export const InboxInstagramSendOpSchema = z.strictObject({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  workerOrigin: z.string().regex(/^https?:\/\/[^/?#\s]{1,253}$/),
  account: IgId,
  mediaId: IgId,
  commentId: IgId,
  draftRevision: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  sendGeneration: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  state: z.enum(["preparing", "confirming", ...IG_SEND_STATES]),
  /** The Worker's receipt version this handle last recorded; a local step keeps the one it found. */
  receiptVersion: z.number().int().nonnegative().optional(),
  providerReplyId: IgId.optional(),
  updatedAt: z.string(),
  commitId: z.string().min(1),
});
export type InboxInstagramSendOp = z.infer<typeof InboxInstagramSendOpSchema>;
const InboxInstagramSendOpsSchema = z.record(z.string(), InboxInstagramSendOpSchema);

const IG_SEND_IDENTITY = [
  "workerOrigin",
  "account",
  "mediaId",
  "commentId",
  "draftRevision",
  "digest",
] as const;

/**
 * Compare-and-swap of one Instagram public handle against the stored one of the same operation: null when it may be
 * written. A local step (no version) only marks Confirm on a prepared review; an older receipt is stale; an equal
 * version naming another state contradicts it; a later version may only move forward; a reply id never changes; the
 * identity and the learned send generation never change. DT-6B-2C-4-R1 (2C4-2): nothing written here turns the
 * pending-confirm mark back into a review (a prepared read cannot prove the Confirm will not land); only
 * rollbackInboxInstagramSendConfirm, for its two named reasons, does.
 */
function igSendStep(
  prior: InboxInstagramSendOp,
  op: Omit<InboxInstagramSendOp, "updatedAt" | "commitId">,
): "stale" | "invalid" | null {
  if (IG_SEND_IDENTITY.some((k) => op[k] !== prior[k])) return "invalid";
  if (prior.sendGeneration && op.sendGeneration && op.sendGeneration !== prior.sendGeneration)
    return "invalid";
  if (prior.providerReplyId && op.providerReplyId && op.providerReplyId !== prior.providerReplyId)
    return "stale";
  // "confirming" stands for the prepared receipt it was marked on.
  const from = prior.state === "confirming" ? "prepared" : prior.state;
  const v = op.receiptVersion;
  if (v === undefined)
    return op.state === "confirming" && prior.state === "prepared" ? null : "stale";
  if (op.state === "preparing" || op.state === "confirming") return "invalid";
  if (prior.state === "preparing") return null;
  if (prior.state === "confirming" && op.state === "prepared") return "stale";
  const pv = prior.receiptVersion ?? 0;
  if (v < pv) return "stale";
  if (op.state === from) return null;
  if (v === pv) return "stale";
  return IG_SEND_NEXT[from]?.includes(op.state) ? null : "stale";
}

/** Instagram DM handle states that can no longer send: the only ones the cap may drop, and final for their operation. */
export const INBOX_IG_DM_SETTLED: readonly string[] = [
  "sent",
  "rejected",
  "already_claimed",
  "expired",
  "cancelled",
];
/**
 * Durable Instagram DM states each one can still reach. Unlike the public protocol, a DM `unknown` is a recorded
 * settlement (claim + settlement + reason): it never moves again. A lost settlement is not `unknown` here: it stays
 * `dispatching` with the `pending` observation.
 */
const IG_DM_NEXT: Record<string, readonly string[]> = {
  prepared: [
    "dispatching",
    "sent",
    "rejected",
    "unknown",
    "already_claimed",
    "expired",
    "cancelled",
  ],
  dispatching: ["sent", "rejected", "unknown"],
};
const DmIdSchema = z.string().regex(DM_ID_RE);
/** An exact `Date#toISOString()` time. */
const ExactIso = z.string().refine((t) => {
  const ms = Date.parse(t);
  return Number.isFinite(ms) && new Date(ms).toISOString() === t;
});
/**
 * 💬 The handle of one reviewed Instagram DM (packet DT-6B-2C-5A, planning/tools/37-inbox-send.md), keyed
 * `origin|account|conversation|inbound message` (dmOpKey): one per inbound event, so a later turn never replaces an
 * unresolved answer to an earlier one. Separate from the public-reply, Threads and YouTube slices. Two local states:
 * "preparing" (written BEFORE the prepare request) and "confirming" (the pending-confirm mark written BEFORE the confirm
 * request); every other state is a Worker receipt with its integer `receiptVersion`. The Worker origin, account,
 * conversation, recipient, inbound message, revision and digest are the operation's identity; `inboundAt` and
 * `sendGeneration` are learned from the prepared intent (never the reader's generation); `providerMessageId` is immutable
 * proof; `pending` is what a lost settlement observed (only beside `dispatching`, never an outcome). Never the text, a
 * token or a provider body.
 */
export const InboxInstagramDmSendOpSchema = z
  .strictObject({
    operationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    workerOrigin: z.string().regex(/^https?:\/\/[^/?#\s]{1,253}$/),
    account: IgId,
    conversationId: DmIdSchema,
    recipientId: DmIdSchema,
    inboundMessageId: DmIdSchema,
    inboundAt: ExactIso.optional(),
    draftRevision: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    sendGeneration: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    state: z.enum(["preparing", "confirming", ...DM_SEND_STATES]),
    /** The Worker's receipt version this handle last recorded; a local step keeps the one it found. */
    receiptVersion: z.number().int().nonnegative().optional(),
    providerMessageId: z.string().regex(DM_MESSAGE_ID_RE).optional(),
    pending: z
      .strictObject({
        observed: z.enum(["unknown", "rejected"]),
        code: z.string().regex(/^[a-z0-9_-]{1,64}$/),
      })
      .optional(),
    updatedAt: z.string(),
    commitId: z.string().min(1),
  })
  .refine((o) => !o.pending || o.state === "dispatching");
export type InboxInstagramDmSendOp = z.infer<typeof InboxInstagramDmSendOpSchema>;
const InboxInstagramDmSendOpsSchema = z.record(z.string(), InboxInstagramDmSendOpSchema);

const IG_DM_IDENTITY = [
  "workerOrigin",
  "account",
  "conversationId",
  "recipientId",
  "inboundMessageId",
  "draftRevision",
  "digest",
] as const;

/**
 * Compare-and-swap of one Instagram DM handle against the stored one of the same operation: null when it may be written.
 * A local step (no version) only marks Confirm on a prepared review; an older receipt is stale; an equal version naming
 * another state contradicts it; a later version may only move forward (IG_DM_NEXT); a message id never changes; the
 * identity, the learned inbound time and the learned send generation never change; nothing written here turns the
 * pending-confirm mark back into a review (only rollbackInboxInstagramDmSendConfirm, for its two named reasons, does).
 */
function igDmStep(
  prior: InboxInstagramDmSendOp,
  op: Omit<InboxInstagramDmSendOp, "updatedAt" | "commitId">,
): "stale" | "invalid" | null {
  if (IG_DM_IDENTITY.some((k) => op[k] !== prior[k])) return "invalid";
  if (prior.sendGeneration && op.sendGeneration && op.sendGeneration !== prior.sendGeneration)
    return "invalid";
  if (prior.inboundAt && op.inboundAt && op.inboundAt !== prior.inboundAt) return "invalid";
  if (
    prior.providerMessageId &&
    op.providerMessageId &&
    op.providerMessageId !== prior.providerMessageId
  )
    return "stale";
  const from = prior.state === "confirming" ? "prepared" : prior.state;
  const v = op.receiptVersion;
  if (v === undefined)
    return op.state === "confirming" && prior.state === "prepared" ? null : "stale";
  if (op.state === "preparing" || op.state === "confirming") return "invalid";
  if (prior.state === "preparing") return null;
  if (prior.state === "confirming" && op.state === "prepared") return "stale";
  const pv = prior.receiptVersion ?? 0;
  if (v < pv) return "stale";
  if (op.state === from) return null;
  if (v === pv) return "stale";
  return IG_DM_NEXT[from]?.includes(op.state) ? null : "stale";
}

/** Verified Instagram conversation controls kept on this device at most (packet DT-6B-2C-5B). */
export const INBOX_IG_DM_CONTROLS_MAX = 50;
const SafeCount = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0);
/**
 * 🛟 The verified control handle of one Instagram conversation (packet DT-6B-2C-5B, planning/tools/37-inbox-send.md),
 * keyed `origin|account|conversation` (dmControlKey). Separate from the DM send slice. The handle, its recipient and the
 * registration proof (generation, evidence digest) come only from a validated Worker view; mode, revision and the counts
 * are the last validated full view (a narrow conflict records mode and revision and drops the counts: never manufactured).
 * `pending` is the action persisted BEFORE its request (the requested mode and the reviewed revision for takeover/resume);
 * `uncertain` marks that action's request as possibly received without a usable answer (Check status only). No message
 * text, token or provider body.
 */
export const InboxInstagramDmControlSchema = z
  .strictObject({
    workerOrigin: z.string().regex(/^https?:\/\/[^/?#\s]{1,253}$/),
    account: IgId,
    conversationId: DmIdSchema,
    handleId: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    recipientId: DmIdSchema.optional(),
    registeredGeneration: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    evidenceDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    mode: z.enum(["auto", "human"]).optional(),
    revision: SafeCount.optional(),
    inFlightTotal: SafeCount.optional(),
    inFlightTruncated: z.boolean().optional(),
    uncertainTotal: SafeCount.optional(),
    pending: z
      .strictObject({
        action: z.enum(["takeover", "resume", "register"]),
        expectedRevision: SafeCount.optional(),
        requestedMode: z.enum(["auto", "human"]).optional(),
        at: ExactIso,
      })
      .optional(),
    uncertain: z.enum(["registration", "mutation"]).optional(),
    updatedAt: z.string(),
    commitId: z.string().min(1),
  })
  .refine((o) => {
    const all = (xs: unknown[]) => xs.every((x) => x !== undefined);
    const none = (xs: unknown[]) => xs.every((x) => x === undefined);
    const proof = [o.handleId, o.recipientId, o.registeredGeneration, o.evidenceDigest];
    const state = [o.mode, o.revision];
    const counts = [o.inFlightTotal, o.inFlightTruncated, o.uncertainTotal];
    const p = o.pending;
    const pendingOk =
      !p ||
      (p.action === "register"
        ? p.expectedRevision === undefined && p.requestedMode === undefined
        : !!o.handleId &&
          p.expectedRevision !== undefined &&
          p.requestedMode === (p.action === "takeover" ? "human" : "auto"));
    return (
      (all(proof) || none(proof)) &&
      (all(state) ? !!o.handleId : none(state)) &&
      (all(counts) ? all(state) : none(counts)) &&
      pendingOk &&
      (o.uncertain === undefined ||
        (o.uncertain === "registration"
          ? p?.action === "register"
          : !!p && p.action !== "register"))
    );
  });
export type InboxInstagramDmControl = z.infer<typeof InboxInstagramDmControlSchema>;
const InboxInstagramDmControlsSchema = z
  .record(z.string(), InboxInstagramDmControlSchema)
  .refine((m) =>
    Object.entries(m).every(
      ([k, e]) => k === dmControlKey(e.workerOrigin, e.account, e.conversationId),
    ),
  );

/** An entry with work this device cannot drop: a persisted action whose outcome is not applied yet. */
export const isUnresolvedDmControl = (e: InboxInstagramDmControl | undefined): boolean =>
  !!e && (!!e.pending || !!e.uncertain);

/**
 * Compare-and-swap of a control entry against the stored one: null when it may be written. A verified handle and its
 * recipient never change or disappear (an explicit re-registration may refresh the registration proof of the same handle);
 * the revision never goes back, and one revision has one mode.
 */
function igDmControlStep(
  prior: InboxInstagramDmControl,
  next: Omit<InboxInstagramDmControl, "updatedAt" | "commitId">,
): "stale" | "invalid" | null {
  if (prior.handleId && next.handleId !== prior.handleId) return "invalid";
  if (prior.recipientId && next.recipientId !== prior.recipientId) return "invalid";
  if (prior.revision !== undefined) {
    if (next.revision === undefined || next.revision < prior.revision) return "stale";
    if (next.revision === prior.revision && next.mode !== prior.mode) return "invalid";
  }
  return null;
}

/** `e`'s pending action is still open after `other`'s proof (a newer revision or a learned handle resolves it). */
function stillOpen(e: InboxInstagramDmControl, other: InboxInstagramDmControl): boolean {
  const p = e.pending;
  if (!p) return false;
  if (p.action === "register") return !(other.handleId && !e.handleId);
  return !(other.revision !== undefined && other.revision > (p.expectedRevision ?? Infinity));
}

/** A pending takeover/resume belongs to a known revision at or after the one it expects (DT-6B-2C-5B-R1). */
const pendingConsistent = (e: InboxInstagramDmControl): boolean =>
  !e.pending ||
  e.pending.action === "register" ||
  (e.revision !== undefined && (e.pending.expectedRevision ?? Infinity) <= e.revision);

/** An imported entry that contradicts what this device already proved for the same conversation. */
const contradicts = (cur: InboxInstagramDmControl, imp: InboxInstagramDmControl): boolean =>
  !!cur.handleId &&
  !!imp.handleId &&
  (cur.handleId !== imp.handleId ||
    cur.recipientId !== imp.recipientId ||
    (cur.revision !== undefined && cur.revision === imp.revision && cur.mode !== imp.mode));

/**
 * Restore merge of the control slice (a private backup into this device): what only one side knows is kept; for one
 * conversation another handle or recipient is never swapped in, open pending work is never discarded, and older proof
 * never overwrites newer proof. An imported entry with an inconsistent pending block, or contradicting this device's
 * handle, recipient or the mode of one revision, is refused (this device's entry stays; its key goes to `rejected`).
 * Over the cap, unresolved entries all stay and the newest idle ones fill the rest.
 */
export function mergeInstagramDmControls(
  current: Record<string, InboxInstagramDmControl>,
  imported: Record<string, InboxInstagramDmControl>,
  rejected: string[] = [],
): Record<string, InboxInstagramDmControl> {
  const out = { ...current };
  for (const [k, imp] of Object.entries(imported)) {
    const cur = current[k];
    if (!pendingConsistent(imp) || (cur && contradicts(cur, imp))) rejected.push(k);
    else if (!cur) out[k] = imp;
    else if (stillOpen(cur, imp)) out[k] = cur;
    else if (stillOpen(imp, cur)) out[k] = imp;
    else if (!!imp.handleId !== !!cur.handleId) out[k] = imp.handleId ? imp : cur;
    else out[k] = (imp.revision ?? -1) > (cur.revision ?? -1) ? imp : cur;
  }
  const all = Object.entries(out);
  if (all.length <= INBOX_IG_DM_CONTROLS_MAX) return out;
  const open = all.filter(([, e]) => isUnresolvedDmControl(e));
  const idle = all
    .filter(([, e]) => !isUnresolvedDmControl(e))
    .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt));
  return Object.fromEntries([
    ...open,
    ...idle.slice(0, Math.max(0, INBOX_IG_DM_CONTROLS_MAX - open.length)),
  ]);
}

/** The inbox screen's platform tab. */
const InboxTabSchema = z.enum(["all", "instagram", "tiktok"]);

/** Persisted (and exported) part of the state. */
export const PersistedStateSchema = z.object({
  settings: SettingsSchema,
  completions: z.array(QuestCompletionSchema),
  xpEvents: z.array(XpEventSchema),
  microActions: z.array(MicroActionSchema),
  freezesUsedOn: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  /** Weekly reviews, one per Saturday key. */
  reviews: ReviewsSchema,
  /** Scout v0 (1.13): references the owner attached to a skill, by skill id. */
  savedRefs: z.record(z.string(), z.array(RefSchema)).default({}),
  inspirations: InspirationsSchema,
  followedFormats: FollowedFormatsSchema,
  formatObservations: FormatObservationsSchema,
  formatQueue: FormatQueueSchema,
  discoverCandidates: DiscoverCandidatesSchema,
  /** A reset/import fence: failed durable writes must not resurrect a previous library on reload. */
  discoverLibraryEpoch: z.string().max(200).default(""),
  discoverLibraryPendingReplacement: z.boolean().default(false),
  discoverFeedback: DiscoverFeedbackListSchema,
  /** Scout v0 (1.13): last topics typed on /discover, most recent first, capped at 8. */
  recentTopics: z.array(z.string()).default([]),
  /** 📝 One Markdown note per skill, by skill id (the Research quest's home). */
  notes: z.record(z.string(), NoteSchema).default({}),
  /** Gem ledger; the balance is its sum. */
  gemEvents: z.array(GemEventSchema).default([]),
  /** Chests opened so far (one is earned every CHEST_EVERY quests). */
  chestsOpened: z.number().int().min(0).default(0),
  /** Running focus session, if any. */
  focus: FocusStateSchema.nullable().default(null),
  focusSessions: z.array(FocusSessionSchema).default([]),
  /** Streak freezes from chests and the shop, on top of the weekly earned ones. */
  bonusFreezes: z.number().int().min(0).default(0),
  badges: z.array(BadgeAwardSchema).default([]),
  /** Month keys ("YYYY-MM") whose boss was defeated (celebrated once). */
  bossesDefeated: z.array(z.string().regex(MONTH_KEY_RE)).default([]),
  /** Season keys ("<start>:<id>") whose target was reached. */
  seasonsFinished: z.array(z.string()).default([]),
  drills: z.array(DrillSchema).default([]),
  planItems: z.array(PlanItemSchema).default([]),
  rewards: z.array(RewardSchema).default(() => defaultRewards()),
  purchases: z.array(PurchaseSchema).default([]),
  /* 📱 Social world (rounds 16–17). */
  /** Content-calendar posts (every stage, including posted). */
  posts: z.array(PostSchema).default([]),
  /** Ideas bank entries the owner stored. */
  ideas: z.array(IdeaSchema).default([]),
  /** Manually entered growth numbers, one per platform per day. */
  socialSnapshots: z.array(SocialSnapshotSchema).default([]),
  /** "What people want" questions with their counts. */
  audienceAsks: z.array(AudienceAskSchema).default([]),
  /** The owner's handle per platform. */
  socialAccounts: z.array(SocialAccountSchema).default([]),
  /* 📊 Social Analytics (round 27: the Beacons handover's posts + demographics tables). */
  /** Imported published posts with their numbers, unique by platform + postId. */
  socialPostStats: z.array(SocialPostStatSchema).default([]),
  /** Audience breakdowns per platform, day and dimension. */
  demographics: z.array(DemographicSchema).default([]),
  /** Version of data/social-seed applied (""= never): applySocialSeed never runs twice. */
  socialSeedApplied: z.string().default(""),
  /* 🔗 Connected accounts (live sync through the Scout Worker). */
  /** When the app last pulled the Worker's data, the last error, and the last per-platform status reply. */
  socialSync: SocialSyncStateSchema.default(EMPTY_SOCIAL_SYNC),
  /* 📈 Trend Radar (round 30, planning/tools/08-trends.md). */
  /** The last `GET /trends` feed the app read from the Worker, plus the ids the owner dismissed. */
  trends: TrendsStateSchema.default(EMPTY_TRENDS),
  /* 🎬 Edit genres (round 31). */
  /** Genres the owner added in Settings, in the order added; the built-in ones live in data/genres. */
  customGenres: z.array(CustomGenreSchema).default([]),
  /* 🌐 Website CMS (packet DT-3). */
  /** Local bilingual articles: draft / ready / archived, nothing public. */
  articles: z.array(ArticleSchema).default([]),
  /* ⚙️ Workflows (packet DT-4). */
  /** Saved workflows: a trigger and 1–5 actions that create local drafts. */
  workflows: z.array(WorkflowSchema).default([]),
  /** Run history with per-step receipts (at most RUNS_MAX; the oldest finished go first). */
  workflowRuns: z.array(WorkflowRunSchema).default([]),
  /* 💼 Business Kit (packet DT-5). */
  /** The owner's media kit (null until the first save). Local only; nothing is public until DT-8. */
  businessKit: BusinessKitSchema.nullable().default(null),
  /** Brand deals by stage; never deleted (stage "lost" keeps the history). */
  brandDeals: z.array(BrandDealSchema).default([]),
  /* 📥 Inbox (packet DT-6A). */
  /** Private reply drafts by scope (at most INBOX_DRAFTS_MAX; the oldest go first). Never a fetched message. */
  inboxDrafts: InboxDraftsSchema.default({}),
  /** Reviewed-reply operation handles by draft scope (packet DT-6B-2A; at most INBOX_SEND_OPS_MAX). No text. */
  inboxSendOps: InboxSendOpsSchema.default({}),
  /** Reviewed Threads reply handles by draft scope (packet DT-6B-2B-2; at most INBOX_SEND_OPS_MAX). No text. */
  inboxThreadsSendOps: InboxThreadsSendOpsSchema.default({}),
  /** Reviewed Instagram public reply handles (packet DT-6B-2C-4; at most INBOX_SEND_OPS_MAX). No text. */
  inboxInstagramSendOps: InboxInstagramSendOpsSchema.default({}),
  /** Reviewed Instagram DM handles by inbound message (packet DT-6B-2C-5A; at most INBOX_SEND_OPS_MAX). No text. */
  inboxInstagramDmSendOps: InboxInstagramDmSendOpsSchema.default({}),
  /** Verified Instagram conversation controls (packet DT-6B-2C-5B; at most INBOX_IG_DM_CONTROLS_MAX). No text. */
  inboxInstagramDmControls: InboxInstagramDmControlsSchema.default({}),
  /**
   * ⚙️ Cloud workflow journal (packet DT-7C-2A, lib/cloudWorkflowJournal.ts). Opaque here on purpose: a malformed
   * journal never makes the rest of the save unreadable, and it is kept verbatim (never replaced by an empty one);
   * every journal reader parses it strictly and fails as `journal-unreadable`. No default: a backup without it keeps
   * the device's journal.
   */
  cloudJournal: z.unknown().optional(),
  /**
   * ⚙️ Cloud workflow registration intents (packet DT-7C-2B-2, lib/cloudWorkflowRegistration.ts). Opaque like the
   * journal: kept verbatim, parsed strictly by every reader (unreadable = no mutation request). No default: a backup
   * without it keeps the device's. Observed registration only, never ownership; never in a public projection.
   */
  cloudRegistrations: z.unknown().optional(),
  /**
   * ⚙️ Cloud reconciliation proof (packet DT-7C-2C, lib/cloudWorkflowReconciliation.ts): authority-bound delivery /
   * deletion / reset proof, cursor, retirement generation, tombstones, pending feed items and the `cloudWorkflowRuns`
   * projection (`runs`). Opaque like the journal: kept verbatim, parsed strictly by every reader (unreadable = no
   * reconciliation, never coerced to empty). No default: a backup without it keeps the device's. Never public.
   */
  cloudReconciliation: z.unknown().optional(),
  /* 🗂 Global inbox (planning/tools/51-global-inbox.md). */
  /** When each conversation or post was last opened (ISO), by lib/inbox seenKey; unread = newer than this. */
  inboxSeen: z.record(z.string(), z.string()).default({}),
  inboxTab: InboxTabSchema.default("all"),
});
export type PersistedState = z.infer<typeof PersistedStateSchema>;

export const ExportFileSchema = z.object({
  app: z.literal("3z-prod"),
  version: z.number().int(),
  exportedAt: z.string(),
  state: PersistedStateSchema,
});
export type ExportFile = z.infer<typeof ExportFileSchema>;

/** What every XP-changing action reports; drives toasts and celebrations. */
export interface XpOutcome {
  /** XP gained by this call (0 when nothing changed). */
  xp: number;
  /** Gems gained by this call, including day-complete, badge, boss and season gems. */
  gems: number;
  levelBefore: number;
  levelAfter: number;
  /** Overall rank step 1..51 (rank index × 3 + tier) before and after. */
  rankStepBefore: number;
  rankStepAfter: number;
  /** Badges earned by this call (their gems are included in `gems`). */
  badges: Badge[];
  /** This call finished off the monthly boss. */
  bossDefeated: boolean;
  /** This call reached the season target. */
  seasonDone: boolean;
  /** This call made a new chest ready. */
  chestReady: boolean;
  /** This call turned today's flow into "day complete". */
  dayDone: boolean;
}

/** What happened when a quest was completed. */
export interface CompleteResult extends XpOutcome {
  /** False when the quest was already done (idempotent call) or the skill is unknown. */
  added: boolean;
  mastered: boolean;
  /** Extra quest XP from a running focus session (already included in `xp`). */
  focusBonus: number;
}

/** The recorded micro-action plus what it triggered. */
export type MicroResult = MicroAction & XpOutcome;

export interface DrillResult extends XpOutcome {
  /** False when no drill exists for the skill. */
  done: boolean;
}

export interface ReviewResult extends XpOutcome {
  /** True when this week had no review yet (XP and gems given); false when it replaced an existing one. */
  added: boolean;
}

export interface BuyResult {
  ok: boolean;
  reason?: BuyRefusal;
}

/** An opened chest: its loot, its 1-based number and any badge the opening earned. */
export type ChestResult = Loot & { number: number; badges: Badge[] };

/** A recorded focus session and any badge it earned (focus-10). */
export type FocusResult = FocusSession & { badges: Badge[] };

/* ---------- 📱 Social world inputs and results ---------- */

/**
 * What addPost needs. Everything but `platform` and `title` is optional: stage defaults to "idea", the script
 * to empty, hashtags to suggestHashtags(platform, skill) when omitted or empty, shots to the platform's
 * template when `withTemplate` is true (else none).
 */
export type NewPostInput = Omit<PostInput, "id" | "createdAt" | "updatedAt"> & {
  withTemplate?: boolean;
};

/** Everything of a post but its identity and timestamps. */
export type PostPatch = Partial<Omit<PostInput, "id" | "createdAt" | "updatedAt">>;

/** New shot: `id` and `done` are filled in when missing. */
export type NewShotInput = Omit<Shot, "id" | "done"> & Partial<Pick<Shot, "id" | "done">>;

export interface NewIdeaInput {
  text: string;
  source: IdeaSource;
  skillId?: string;
  platform?: Platform;
}

export interface NewAskInput {
  text: string;
  platform?: Platform;
  /** Mentions so far; defaults to 1. */
  count?: number;
}

/** What markPosted did: the updated post (undefined for an unknown id) and the Produce quest it completed. */
export interface PostedResult {
  post: Post | undefined;
  /** Null when the post has no skill, the quest was already done, or the post was unknown. */
  quest: CompleteResult | null;
}

export interface DiscoverVisualApplyGuard {
  epoch: string;
  genreId: string;
  url: string;
  selection: AiSelection;
  /** The active caller's abort/selection/navigation generation; never persisted. */
  isCurrent(): boolean;
}
export type DiscoverVisualApplyResult = "applied" | "unchanged" | "stale" | "invalid";
export interface DiscoverSemanticApplyGuard {
  epoch: string;
  genreId: string;
  urls: string[];
  selection: AiSelection;
  isCurrent(): boolean;
}

/* ---------- 🌐 Website CMS (packet DT-3) ---------- */

/** The editorial fields an editor saves; identity, status and timestamps are the store's. */
export type ArticlePatch = Partial<
  Pick<
    Article,
    "title" | "summary" | "body" | "slug" | "category" | "tags" | "coverUrl" | "skillId"
  >
>;

/**
 * What an editor's pending text was based on: the article's commit identity and the articles generation (bumped by
 * import, reset and a rehydration or commit that brought different articles). A save is refused when either moved.
 */
export interface ArticleBase {
  commitId: string;
  generation: number;
}

/**
 * Every CMS mutation's answer. `not-persisted`: storage is blocked, full or malformed, or did not keep the commit
 * (memory stays at what storage holds); `unsupported-save`: no Web Locks, so nothing was written; `issues`: ready refused by articleIssues;
 * `slug-duplicate`: a restore would collide with `conflictsWith`. ⚙️ DT-7C-2B-3 `workflow-not-local`: a Ready workflow
 * that would run for it is not provably local, so the whole Ready transition is refused (nothing written).
 */
export type ArticleResult =
  | { ok: true; article: Article }
  | { ok: false; reason: "not-persisted" }
  | {
      ok: false;
      reason:
        "conflict" | "missing" | "archived" | "issues" | "unsupported-save" | "workflow-not-local";
    }
  | { ok: false; reason: "slug-duplicate"; conflictsWith: Article };

/** Runs `fn` while holding the one exclusive articles lock (Web Locks in browsers; a fake in unit tests). */
export type ArticlesLock = <T>(fn: () => Promise<T>) => Promise<T>;

/* ---------- ⚙️ Workflows (packet DT-4) ---------- */

/** A locked commit's own failures: no Web Locks (nothing written), or storage did not keep it (memory rolled back). */
export type FreshFailure = { ok: false; reason: "unsupported-save" | "not-persisted" };

/** A publish-job allocation or release (DT-5-R1). */
export type PublishJobResult =
  | { ok: true; post: Post }
  | FreshFailure
  | { ok: false; reason: "missing" | "conflict" | "taken" | "ambiguous" };

/** The editable parts of a workflow (enabled has its own action). */
export type WorkflowPatch = Partial<Pick<Workflow, "name" | "trigger" | "actions">>;

/** What an editor's pending changes were based on (same rule as ArticleBase). */
export interface WorkflowBase {
  commitId: string;
  generation: number;
}

export type WorkflowResult =
  { ok: true; workflow: Workflow } | FreshFailure | { ok: false; reason: "conflict" | "missing" };

/**
 * `paused`: Run now is off while paused; `issues`: workflowIssues is not empty; `not-retryable`: not partial/failed.
 * ⚙️ DT-7C-2B-3 `not-local`: the workflow is not provably local (registered in the cloud, or its cloud status is
 * unresolved, unreadable or foreign): nothing runs here and nothing is written.
 */
export type WorkflowRunResult =
  | { ok: true; run: WorkflowRun }
  | FreshFailure
  | {
      ok: false;
      reason: "missing" | "paused" | "issues" | "not-retryable" | "needs-article" | "not-local";
    };

/**
 * `resumed`: step commits this drain made; `remaining`: queued or running runs left; `stopped`: why it stopped
 * early (storage did not keep a step, or no Web Locks): those runs stay as they are and Resume continues them.
 */
/* ---------- 💼 Business Kit (packet DT-5) ---------- */

/**
 * What a kit editor's pending text was based on: the kit's commit id (null before the first save) and the articles
 * generation (import / reset fence), captured even when no kit exists (Amendment A).
 */
export interface BusinessBase {
  commitId: string | null;
  generation: number;
}

/** The kit's editable parts. */
export type BusinessKitPatch = Partial<
  Pick<
    BusinessKit,
    | "tagline"
    | "bio"
    | "contact"
    | "services"
    | "rateCard"
    | "pastWork"
    | "featuredPlatforms"
    | "estimator"
  >
>;

export type BusinessKitResult =
  { ok: true; kit: BusinessKit } | FreshFailure | { ok: false; reason: "conflict" | "invalid" };

export type BrandDealPatch = Partial<
  Pick<
    BrandDeal,
    "brand" | "contact" | "stage" | "deliverable" | "valueSar" | "notes" | "replyDraft"
  >
>;
export type BrandDealInput = BrandDealPatch & Pick<BrandDeal, "brand">;

export type BrandDealResult =
  | { ok: true; deal: BrandDeal }
  | FreshFailure
  | { ok: false; reason: "conflict" | "missing" | "invalid" };

/**
 * A send-operation handle written or cleared (packet DT-6B-2A); `op: null` after a clear. DT-6B-2A-R1: `stale` is an
 * older answer about the same operation than the one recorded; `capacity` is a full device of unresolved handles.
 */
export type InboxSendOpResult =
  | { ok: true; op: InboxSendOp | null }
  | FreshFailure
  | { ok: false; reason: "conflict" | "invalid" | "stale" | "capacity" };

/**
 * A Threads send handle written or cleared (packet DT-6B-2B-2); `op: null` after a clear. DT-6B-2B-2-R1 (2B2-2): a
 * write also answers `current`, the handle the shared storage holds once the commit returned (another writer may have
 * landed after it); the caller shows its answer only when `current` is exactly what it wrote.
 */
export type InboxThreadsSendOpResult =
  | { ok: true; op: InboxThreadsSendOp | null; current?: InboxThreadsSendOp | null }
  | FreshFailure
  | { ok: false; reason: "conflict" | "invalid" | "stale" | "capacity" };

/**
 * An Instagram public send handle written or cleared (packet DT-6B-2C-4): the Threads contract, `current` included.
 * DT-6B-2C-4-R1: a conditional clear or a rollback refused because the stored record moved on answers `stale` with it.
 */
export type InboxInstagramSendOpResult =
  | { ok: true; op: InboxInstagramSendOp | null; current?: InboxInstagramSendOp | null }
  | FreshFailure
  | {
      ok: false;
      reason: "conflict" | "invalid" | "stale" | "capacity";
      current?: InboxInstagramSendOp | null;
    };

/** An Instagram DM send handle written or cleared (packet DT-6B-2C-5A): the Instagram public contract, `current` included. */
export type InboxInstagramDmSendOpResult =
  | { ok: true; op: InboxInstagramDmSendOp | null; current?: InboxInstagramDmSendOp | null }
  | FreshFailure
  | {
      ok: false;
      reason: "conflict" | "invalid" | "stale" | "capacity";
      current?: InboxInstagramDmSendOp | null;
    };

/**
 * A restore (DT-6B-2C-5B-R1): applied and read back (with the refused control keys), or nothing changed. DT-7C-2A: a
 * backup whose cloud journal is unreadable here, fails revalidation, contradicts the device's journal (same key, other
 * digest or contradictory equal-version receipt; `keys`) or would overflow it also changes nothing. DT-7C-2B-2: the
 * same four refusals for the registration slice carry `scope: "registrations"` (the reason set is unchanged because the
 * Settings screen maps it exhaustively; its copy says "cloud workflow records"). DT-7C-2C-R1: `retired` lists backup
 * proof/tombstone keys refused as already retired here (at or below the change_seq watermark); absent when none.
 */
export type ImportStateResult =
  | { ok: true; rejected: string[]; retired?: string[] }
  | {
      ok: false;
      reason:
        | "not-persisted"
        | "unsupported-save"
        | "journal-unreadable"
        | "journal-invalid"
        | "journal-capacity";
      scope?: "registrations" | "reconciliation";
    }
  | {
      ok: false;
      reason: "journal-conflict";
      keys: readonly string[];
      scope?: "registrations" | "reconciliation";
    };

/** ⚙️ A reset (DT-7C-2A): ordinary content cleared and the cloud journal kept (`retained` entries), read back. */
export type ResetResult =
  | { ok: true; retained: number }
  | { ok: false; reason: "not-persisted" | "unsupported-save" | "journal-unreadable" };

/** ⚙️ A cloud occurrence journaled (DT-7C-2A), read back; `created: false` = the same key and digest were there. */
export type EnqueueCloudResult =
  | { ok: true; entry: JournalEntry; created: boolean }
  | FreshFailure
  | CandidateRefusal
  | { ok: false; reason: "journal-unreadable" | "stale" | "suppressed" | "capacity" }
  | { ok: false; reason: "conflict"; current: JournalEntry };

/* ---------- ⚙️ Trigger capture (packet DT-7C-2B-3, lib/cloudWorkflowCapture.ts) ---------- */

/** The Worker authority a cloud capture is explicitly asked for (it must match the verified registration). */
export interface CaptureAuthority {
  origin: string;
  ownerKey: string;
}

/**
 * Why a capture wrote nothing. `blocked`: ownership is not provable (detail.cause, see the DT-7C-2B-3 table);
 * `stale`: an input moved between preparation and the locked commit (never retried); `snapshot` / `too-large` /
 * `limitation` / `invalid`: the accepted builder or cloud preflight refused (limits never widened, nothing truncated).
 */
export type CaptureRefusalReason =
  | "missing"
  | "paused"
  | "issues"
  | "needs-article"
  | "archived"
  | "blocked"
  | "authority-mismatch"
  | BindingRefusal
  | "manual-on-ready"
  | "snapshot"
  | "too-large"
  | "limitation"
  | "invalid"
  | "capacity"
  | "conflict"
  | "suppressed"
  | "stale"
  | "journal-unreadable"
  | "unsupported-save"
  | "not-persisted";

export interface CaptureDetail {
  cause?: OwnershipBlock;
  snapshot?: SnapshotRefusal;
  snapshotDetail?: string;
  limitation?: Extract<CandidateRefusal, { reason: "limitation" }>["limitation"];
}

export interface CaptureRefusal {
  kind: "refused";
  reason: CaptureRefusalReason;
  /** The workflow that refused (Ready: the member that refused the whole transition). */
  workflowId?: string;
  detail?: CaptureDetail;
}

/** One Manual trigger: a local run OR one cloud journal entry (never a WorkflowRun for cloud), read back. */
export type ManualCaptureResult =
  | { kind: "local"; run: WorkflowRun }
  | { kind: "cloud"; entry: CloudCaptureView; created: boolean }
  | CaptureRefusal;

/** One Ready transition: the article, every local run and every cloud entry in one commit; or a no-op; or nothing. */
export type ReadyCaptureResult =
  | { kind: "ready"; article: Article; runs: WorkflowRun[]; entries: CloudCaptureView[] }
  | { kind: "unchanged"; article: Article }
  | CaptureRefusal;

/** ⚙️ An observed receipt recorded on its entry (DT-7C-2A), read back. Observed is never delivered. */
export type ObserveCloudResult =
  | { ok: true; changed: boolean }
  | FreshFailure
  | {
      ok: false;
      reason:
        | "journal-unreadable"
        | "compact-feed"
        | "unverified"
        | "invalid"
        | "missing"
        | "stale"
        | "older"
        | "conflict"
        | "observation-unverified";
    };

/** ⚙️ What the durable journal holds, revalidated (DT-7C-2A): plain data only, never a branded receipt or proof. */
export interface CloudJournalView {
  key: string;
  origin: string;
  ownerKey: string;
  occurrenceId: string;
  workflowId: string;
  executionAt: string;
  payloadDigest: string;
  commitId: string;
  state: JournalEntry["state"];
  /** Accepted only after the pinned parser re-validated it now; never delivery proof. */
  observed: { state: string; receiptVersion: number } | null;
  /** A stored observation the parser refused: kept, never accepted. */
  observationRejected: boolean;
}
export type CloudJournalLoad =
  | {
      ok: true;
      generation: number;
      suppression: Suppression;
      entries: CloudJournalView[];
    }
  | { ok: false; reason: "journal-unreadable" };

/** A conversation control written or let go (packet DT-6B-2C-5B), `current` read back after the commit. */
export type InboxInstagramDmControlResult =
  | {
      ok: true;
      entry: InboxInstagramDmControl | null;
      current?: InboxInstagramDmControl | null;
    }
  | FreshFailure
  | {
      ok: false;
      reason: "conflict" | "invalid" | "stale" | "capacity";
      current?: InboxInstagramDmControl | null;
    };

/** An inbox draft save or discard (packet DT-6A); `draft: null` after a discard. */
export type InboxDraftResult =
  | { ok: true; draft: InboxDraft | null }
  | FreshFailure
  | { ok: false; reason: "conflict" | "invalid" };

export interface DrainResult {
  resumed: number;
  remaining: number;
  stopped?: FreshFailure["reason"];
}

/** Why the last drain in this tab stopped early (not persisted: a failed step cannot be written down). */
export const workflowDrain = create<{ stopped?: FreshFailure["reason"] }>(() => ({}));

export interface StoreActions {
  applyCapturedVideoReviewResult(
    response: unknown,
    guard: DiscoverVisualApplyGuard,
    now?: Date,
  ): DiscoverVisualApplyResult;
  applyDiscoverSemanticResult(
    response: unknown,
    guard: DiscoverSemanticApplyGuard,
    now?: Date,
  ): DiscoverVisualApplyResult;
  accumulateDiscoverCandidates(
    items: readonly DiscoverItem[],
    options: { genreId: string; manuallyAdded?: true; now?: Date },
  ): void;
  applyDiscoverVisualResult(
    response: unknown,
    guard: DiscoverVisualApplyGuard,
    now?: Date,
  ): DiscoverVisualApplyResult;
  setDiscoverFeedback(input: DiscoverFeedbackInput, now?: Date): DiscoverFeedbackUndo | undefined;
  undoDiscoverFeedback(undo: DiscoverFeedbackUndo): void;
  clearDiscoverFeedback(): void;
  followFormat(format: EditFormat, now?: Date): void;
  unfollowFormat(identity: string): void;
  refreshFollowedFormats(formats: readonly EditFormat[]): void;
  recordFormatObservation(input: FormatObservationInput, now?: Date): boolean;
  removeFormatObservation(targetKey: string, url: string): void;
  addFormatCandidates(target: FormatVerificationTarget, urls: readonly string[]): void;
  removeFormatCandidate(target: FormatVerificationTarget, url: string): void;
  saveInspiration(item: ResearchItem, now?: Date): void;
  updateInspiration(url: string, patch: { note?: string; stage?: InspirationStage }): void;
  removeInspiration(url: string): void;
  /* 📱 Social world (rounds 16–17). */
  /** Create a post; see NewPostInput for the defaults. Throws (Zod) on an invalid input. */
  addPost(input: NewPostInput, now?: Date): Post;
  /** Merge a patch into a post (validated; bumps updatedAt). Undefined when the id is unknown. */
  updatePost(id: string, patch: PostPatch, now?: Date): Post | undefined;
  /**
   * DT-5-R1 (R2): remember the Worker job id a post is about to send under, through commitFresh with a read-back of
   * the stored post, BEFORE the create request. Never via updatePost (memory ahead of storage). The same id again is a
   * no-op; another remembered id is a conflict; an id another post holds is taken; a post gone from storage is missing;
   * DT-5-R2: another post claiming the id on the fresh state (the no-op path too) is ambiguous, nothing written.
   */
  allocatePublishJobId(postId: string, jobId: string, now?: Date): Promise<PublishJobResult>;
  /**
   * R4: forget an allocation the Worker was proven not to hold (fresh list without it). Only the exact id, and only
   * while unconfirmed (no sentAt): a confirmed job is cancelled instead.
   */
  releasePublishJobId(postId: string, jobId: string, now?: Date): Promise<PublishJobResult>;
  /** Merge several post patches in one save (a whole publish-queue read); unknown ids are skipped. */
  updatePosts(patches: ReadonlyMap<string, PostPatch>, now?: Date): void;
  /** Delete a post and unlink any idea that pointed at it. */
  removePost(id: string): void;
  /**
   * Move a post along the pipeline. Setting "posted" here only stamps postedAt (no quest completion): use
   * markPosted for the bridge.
   */
  setPostStage(id: string, stage: PostStage, now?: Date): Post | undefined;
  toggleShot(postId: string, shotId: string, now?: Date): Post | undefined;
  addShot(postId: string, shot: NewShotInput, now?: Date): Shot | undefined;
  removeShot(postId: string, shotId: string, now?: Date): Post | undefined;
  /**
   * "Mark as posted" + link: stage → posted, postedAt/postedUrl set, and, when the post links a skill whose
   * Produce quest is not done yet, that quest is completed through completeQuest with `proofUrl = url`
   * (XP, gems, mastery, badges… exactly once; a second call never awards again).
   */
  markPosted(id: string, url: string, now?: Date): PostedResult;
  /** Undo a mistaken "posted": stage back to scheduled, link and time cleared; the quest is left alone. */
  unmarkPosted(id: string, now?: Date): Post | undefined;
  /**
   * The bridge from a skill's Produce quest: a post titled after the skill (owner's language), `hook` = the
   * Produce quest text, skillId set, template shots, suggested hashtags, best time filled. Refuses a duplicate:
   * when a non-posted post for the same skill + platform exists it is returned instead. Undefined for an
   * unknown skill.
   */
  createPostFromSkill(skillId: string, platform: Platform, now?: Date): Post | undefined;
  addIdea(input: NewIdeaInput, now?: Date): Idea;
  removeIdea(id: string): void;
  /** Star or unstar an idea (the ideas bank's favorites). */
  toggleIdeaFavorite(id: string): void;
  /**
   * Turn an idea into a post on a platform (title = the idea's text, skillId carried over) and link
   * `usedInPostId`. Idempotent: when the idea already has a live post, that post is returned. Undefined for an
   * unknown idea.
   */
  useIdea(ideaId: string, platform: Platform, now?: Date): Post | undefined;
  /**
   * Add or replace the snapshot of that platform + day (any of the analytics metrics may be given; the
   * engagement aliases are normalized). Throws (Zod) on an invalid snapshot.
   */
  addSnapshot(snapshot: SocialSnapshotInput): void;
  /** Upsert many snapshots at once (e.g. from parseStatsCsv or the seed). */
  importSnapshots(list: readonly SocialSnapshotInput[]): void;
  removeSnapshot(platform: Platform, day: string): void;
  /** Upsert published-post stats by platform + postId (from parsePostsCsv & co). Throws (Zod) on bad input. */
  importPostStats(list: readonly SocialPostStatInput[]): void;
  removePostStat(platform: Platform, postId: string): void;
  /**
   * Import audience breakdowns: every platform + day + dimension set present in `list` replaces the stored
   * one as a whole. Throws (Zod) on bad input.
   */
  importDemographics(list: readonly Demographic[]): void;
  /** Drop a platform's demographics (all days, or one day). */
  clearDemographics(platform: Platform, day?: string): void;
  /** Remember that the social seed of that version was applied (data/social-seed calls this). */
  setSocialSeedApplied(version: string): void;
  /** Add an ask; the same text (case-insensitive) bumps the existing ask instead. Returns the stored ask. */
  addAsk(input: NewAskInput, now?: Date): AudienceAsk;
  /** count += by (default 1). */
  bumpAsk(id: string, by?: number): void;
  removeAsk(id: string): void;
  /** Set (or replace) the owner's handle on a platform. */
  setAccount(platform: Platform, handle: string, url?: string): void;
  removeAccount(platform: Platform): void;

  /* 🔗 Connected accounts. */
  /** Remember the Worker's `/social/status` reply (and when it came). */
  setSocialSyncStatus(status: SocialStatusMap, now?: Date): void;
  /**
   * Record a pull: `at` (ISO) becomes lastPullAt when given (null keeps the previous one, so a failed pull
   * does not look like a fresh one), `error` is a message key or null.
   */
  setSocialPullResult(result: { at: string | null; error: string | null }): void;
  /**
   * Drop the Beacons Sep 27, 2026 rows the seed inserted: the snapshots and demographics of that day for the
   * four seeded platforms, and the seed accounts (only where no live or hand-typed account replaced them).
   * Keeps `socialSeedApplied` set so the seed never comes back.
   */
  removeBeaconsSeed(): void;

  /* 📈 Trend Radar (round 30). */
  /**
   * Replace the feed (items, fetchedAt, degraded, sources) with what the Worker's `GET /trends` returned.
   * Keeps only the dismissed ids that still exist in the new items. Throws (Zod) on an invalid feed.
   */
  setTrends(feed: TrendsFeedInput): void;
  /** Hide a trend row until it leaves the feed. No-op when already dismissed. */
  dismissTrend(id: string): void;
  /** Back to the empty slice (feed and dismissed ids). */
  clearTrends(): void;

  /* 🎬 Edit genres (round 31). */
  /**
   * Add an owner genre: `name` and `query` (the search words, used for both languages) are trimmed and their
   * spaces collapsed; the id comes from customGenreId(name). No-op when either is blank or a genre with that
   * normalized name exists already (a custom one, or a built-in one in Arabic or English).
   */
  addCustomGenre(name: string, query: string): void;
  /** Drop an owner genre by id. No-op for an unknown id (built-in genres cannot be removed). */
  removeCustomGenre(id: string): void;

  /* 🌐 Website CMS (packet DT-3). No XP, gems or quest completion anywhere here. Every mutation is one locked
     transaction over the freshly stored list (commitArticles). */
  /** Create an empty local draft (optionally with a title, body or skill). */
  addArticle(
    input?: Partial<Pick<Article, "title" | "body" | "skillId">>,
    now?: Date,
  ): Promise<ArticleResult>;
  /**
   * Commit editorial fields when `base` still matches (generation, and the commit id the shared storage holds). A
   * real change gets a new commit id and revision, and a ready article goes back to draft for review; an identical
   * save changes nothing.
   */
  updateArticle(
    id: string,
    patch: ArticlePatch,
    base: ArticleBase,
    now?: Date,
  ): Promise<ArticleResult>;
  /** Draft ⇄ ready (ready only without articleIssues) or archive. */
  setArticleStatus(id: string, status: ArticleStatus, now?: Date): Promise<ArticleResult>;
  /**
   * Archived → draft, losslessly. Refused when another active article has its slug, unless `newSlug` picks the
   * next free `<slug>-2`, `-3`…
   */
  restoreArticle(id: string, opts?: { newSlug?: boolean }, now?: Date): Promise<ArticleResult>;

  /* ⚙️ Workflows (packet DT-4). Every mutation is one commitFresh transaction; no XP, gems, quests, provider or
     network call anywhere here. Runs execute only in an open tab (drainWorkflowRuns). */
  /** Save a new workflow (manual trigger and one empty idea action unless given). */
  addWorkflow(input?: WorkflowPatch, now?: Date): Promise<WorkflowResult>;
  /** Commit name / trigger / actions when `base` still matches; an identical save changes nothing. */
  updateWorkflow(
    id: string,
    patch: WorkflowPatch,
    base: WorkflowBase,
    now?: Date,
  ): Promise<WorkflowResult>;
  /** Pause (no Ready runs, Run now refused) or resume. */
  setWorkflowEnabled(id: string, enabled: boolean, now?: Date): Promise<WorkflowResult>;
  /**
   * Queue a manual run with a fresh snapshot; refused while paused or with issues. An article-ready workflow needs
   * `articleId` (an existing, non-archived article): its input is captured exactly like Preview. Call
   * drainWorkflowRuns next.
   */
  runWorkflowNow(id: string, opts?: { articleId?: string }, now?: Date): Promise<WorkflowRunResult>;
  /** Re-queue a partial/failed run from its ORIGINAL snapshot (attempt + 1); finished steps keep their outputs. */
  retryWorkflowRun(runId: string, now?: Date): Promise<WorkflowRunResult>;
  /**
   * Execute queued and running runs step by step from their first pending step (one commit per step: output + receipt
   * together, deterministic ids), re-reading the fresh state each time. Safe to call from any tab at any time.
   */
  drainWorkflowRuns(now?: Date): Promise<DrainResult>;

  /* 💼 Business Kit (packet DT-5). One commitFresh transaction each, proven by the commit id read back; no XP, gems,
     quests or network call. */
  /**
   * Save kit fields when `base` still matches: `commitId: null` creates the kit and is a conflict once one exists; a
   * moved generation (import / reset) is a conflict too. An identical save changes nothing.
   */
  saveBusinessKit(
    patch: BusinessKitPatch,
    base: BusinessBase,
    now?: Date,
  ): Promise<BusinessKitResult>;
  addBrandDeal(input: BrandDealInput, now?: Date): Promise<BrandDealResult>;
  updateBrandDeal(
    id: string,
    patch: BrandDealPatch,
    base: BusinessBase,
    now?: Date,
  ): Promise<BrandDealResult>;
  setBrandDealStage(
    id: string,
    stage: DealStage,
    base: BusinessBase,
    now?: Date,
  ): Promise<BrandDealResult>;

  /* 📥 Inbox drafts (packet DT-6A). One commitFresh transaction each, proven by the commit id read back; `base` is
     the draft the editor showed (commitId null: none yet). No network call. */
  saveInboxDraft(
    scope: string,
    text: string,
    base: BusinessBase,
    now?: Date,
  ): Promise<InboxDraftResult>;
  discardInboxDraft(scope: string, base: BusinessBase): Promise<InboxDraftResult>;
  /* 📤 Reviewed replies (packet DT-6B-2A). `expected`: the operation id the caller saw stored (null: none); anything
     else is a conflict. One commitFresh transaction each, proven by the read-back. No network call. */
  setInboxSendOp(
    scope: string,
    op: Omit<InboxSendOp, "updatedAt" | "commitId">,
    expected: string | null,
    now?: Date,
  ): Promise<InboxSendOpResult>;
  clearInboxSendOp(scope: string, operationId: string): Promise<InboxSendOpResult>;
  /* 📤 Reviewed Threads replies (packet DT-6B-2B-2): the same contract on their own slice, plus the receipt-version
     compare-and-swap of threadsSendStep. */
  setInboxThreadsSendOp(
    scope: string,
    op: Omit<InboxThreadsSendOp, "updatedAt" | "commitId">,
    expected: string | null,
    now?: Date,
  ): Promise<InboxThreadsSendOpResult>;
  clearInboxThreadsSendOp(scope: string, operationId: string): Promise<InboxThreadsSendOpResult>;
  /* 📤 Reviewed Instagram public replies (packet DT-6B-2C-4): the same contract on their own slice (`instagram|` keys),
     with igSendStep's compare-and-swap. */
  setInboxInstagramSendOp(
    scope: string,
    op: Omit<InboxInstagramSendOp, "updatedAt" | "commitId">,
    expected: string | null,
    now?: Date,
  ): Promise<InboxInstagramSendOpResult>;
  clearInboxInstagramSendOp(
    scope: string,
    operationId: string,
  ): Promise<InboxInstagramSendOpResult>;
  /* DT-6B-2C-4-R1 (2C4-1): lets a preparing handle go only while it is still exactly that record (operation, state,
     version and, when given, commit); otherwise keeps the newer proof and answers it. */
  clearInboxInstagramSendOpIf(
    scope: string,
    expected: {
      operationId: string;
      state: "preparing";
      receiptVersion?: number;
      commitId?: string;
    },
  ): Promise<InboxInstagramSendOpResult>;
  /* DT-6B-2C-4-R1 (2C4-2): the only two ways a pending-confirm mark becomes its review again: "beforeRequest" (the
     action's own fence failed, no Confirm request was made) and "preClaimRefusal" (that Confirm request was refused
     conclusively before any claim). Only while the stored handle is still the captured mark (same commit). */
  rollbackInboxInstagramSendConfirm(
    scope: string,
    mark: InboxInstagramSendOp,
    why: "beforeRequest" | "preClaimRefusal",
    now?: Date,
  ): Promise<InboxInstagramSendOpResult>;

  /* 💬 Reviewed Instagram DMs (packet DT-6B-2C-5A): the Instagram public contract on their own slice, keyed
     `origin|account|conversation|inbound message` (dmOpKey), with igDmStep's compare-and-swap. */
  setInboxInstagramDmSendOp(
    key: string,
    op: Omit<InboxInstagramDmSendOp, "updatedAt" | "commitId">,
    expected: string | null,
    now?: Date,
  ): Promise<InboxInstagramDmSendOpResult>;
  clearInboxInstagramDmSendOp(
    key: string,
    operationId: string,
  ): Promise<InboxInstagramDmSendOpResult>;
  /* Lets a preparing handle go only while it is still exactly that record; otherwise keeps the newer proof. */
  clearInboxInstagramDmSendOpIf(
    key: string,
    expected: {
      operationId: string;
      state: "preparing";
      receiptVersion?: number;
      commitId?: string;
    },
  ): Promise<InboxInstagramDmSendOpResult>;
  /* The only two ways a pending-confirm mark becomes its review again ("beforeRequest", "preClaimRefusal"), only while
     the stored handle is still the captured mark (same commit). */
  rollbackInboxInstagramDmSendConfirm(
    key: string,
    mark: InboxInstagramDmSendOp,
    why: "beforeRequest" | "preClaimRefusal",
    now?: Date,
  ): Promise<InboxInstagramDmSendOpResult>;

  /* 🛟 Verified conversation controls (packet DT-6B-2C-5B): compare-and-swap on the commit the caller read (null: none
     stored), igDmControlStep, `current` read back after the commit. `null` lets go of an entry that has no verified
     handle (a conclusively refused registration). */
  setInboxInstagramDmControl(
    key: string,
    entry: Omit<InboxInstagramDmControl, "updatedAt" | "commitId"> | null,
    expectedCommit: string | null,
    now?: Date,
  ): Promise<InboxInstagramDmControlResult>;
  /* 🗂 Global inbox. */
  /** Mark a conversation or post opened at `at` (ISO). Keeps the later time: an older open never lowers the mark. No-op for an empty key or an `at` that is not a date. */
  markInboxSeen(key: string, at: string): void;
  /** Keep only the seen marks of these keys (the loaded lists), so the map never grows without bound. Anything but a string in `keep` is ignored; not an array is a no-op. */
  pruneInboxSeen(keep: string[]): void;
  /** No-op for anything but a known tab. */
  setInboxTab(tab: "all" | "instagram" | "tiktok"): void;

  completeQuest(skillId: string, quest: QuestType, proofUrl?: string, now?: Date): CompleteResult;
  uncompleteQuest(skillId: string, quest: QuestType): void;
  addMicroAction(text: LText, now?: Date): MicroResult;
  /** Spend streak freezes on missed days when the stock (earned + bonus) covers the gap. Returns the frozen days. */
  applyStreakFreezes(now?: Date): string[];
  setSettings(partial: Partial<Settings>): void;
  /** Discover's editing apps: "mine" (DaVinci Resolve and CapCut only) or "all". */
  setEditorScope(scope: EditorScope): void;
  /** Attach a reference to a skill's "Start here" box (Scout v0). No-op if the url is already saved. */
  addRef(skillId: string, ref: Ref): void;
  removeRef(skillId: string, url: string): void;
  /**
   * Save a skill's note (📝 Notes). A blank body removes the note; longer than NOTE_MAX_CHARS is cut. No-op for
   * an unknown skill or an unchanged body. Writing a note never ticks the Research quest: the owner does.
   */
  setNote(skillId: string, body: string, now?: Date): void;
  /** Record a Discover topic search, most recent first, keeping only the last 8. */
  addRecentTopic(topic: string): void;
  /** Open the next ready chest: applies its gems / freeze, returns the loot (null when none is ready). */
  openChest(now?: Date): ChestResult | null;
  /** Start a 25 or 60 minute focus session. Returns the running session (the existing one if already running). */
  startFocus(minutes: FocusMinutes, now?: Date): FocusState;
  /** Stop the running session and record it (`early` when the timer had not run out). Null when none ran. */
  stopFocus(now?: Date): FocusResult | null;
  /** Award every badge whose condition holds now and return the new ones (with their gems). */
  checkBadges(now?: Date): Badge[];
  /** Complete a due drill on a mastered skill: +5 XP and the next interval. */
  completeDrill(skillId: string, now?: Date): DrillResult;
  /** Save this week's review: +10 XP and +5 gems the first time for the week; later calls replace it. */
  saveReview(review: Omit<Review, "at">, now?: Date): ReviewResult;
  /** Edit a saved review without XP. No-op when the week has no review. */
  updateReview(week: string, patch: Partial<Omit<Review, "week" | "at">>): void;
  /** Replace a week's plan items. */
  setPlanItems(week: string, items: PlanItem[]): void;
  addPlanItem(item: PlanItem): void;
  removePlanItem(id: string): void;
  /** Buy a reward with gems; buying the freeze adds a bonus streak freeze. */
  buyReward(id: string, now?: Date): BuyResult;
  addReward(reward: Reward): void;
  updateReward(id: string, patch: Partial<Omit<Reward, "id" | "builtIn">>): void;
  /** Built-in rewards cannot be removed. */
  removeReward(id: string): void;
  exportState(now?: Date): string;
  /**
   * Replace all progress with an exported JSON file. Throws on invalid input (before anything changes). The control
   * slice merges into what storage holds now, under the control lock (DT-6B-2C-5B-R1); resolves once the write is read
   * back, with the keys of refused control entries, or `not-persisted` (nothing changed). DT-7C-2A: the backup's cloud
   * journal (structurally invalid: a throw) is revalidated before the lock and merged into the fresh durable journal
   * under it (see ImportStateResult); a backup without one keeps the device's journal.
   */
  importState(json: string): Promise<ImportStateResult>;
  /**
   * ⚙️ DT-7C-2A: clear ordinary content but keep the cloud journal, advancing its suppression marker, in one write
   * under the shared lock with an exact read-back. Resolves with the explicit result; a failure changes nothing.
   */
  reset(now?: Date): Promise<ResetResult>;
  /**
   * ⚙️ Journal one cloud occurrence (DT-7C-2A) for `origin` (caller-captured, never inferred from Settings). Validated,
   * detached and hashed first; then compared and written under the shared lock against the fresh durable journal.
   * No network, no transport, no local execution. Not a Ready/manual route (packet C2B).
   */
  enqueueCloudOccurrence(origin: string, body: unknown): Promise<EnqueueCloudResult>;
  /**
   * ⚙️ Record a parser-verified receipt on its journal entry (DT-7C-2A): monotonic by receipt version, equal-version
   * contradictions conflict. An observation, never delivery proof: nothing becomes delivered or ackable.
   */
  observeCloudReceipt(parsed: Parsed, request: CloudRequest): Promise<ObserveCloudResult>;
  /**
   * ⚙️ DT-7C-2B-3 (unconsumed by the UI): one Manual trigger for its ONE executor. Ownership is derived from the
   * parser-verified registrations, the journal and the configured origin; local writes one run (the legacy shape, not
   * drained here), cloud writes one journal entry for `authority` (manual-trigger workflows only), blocked writes
   * nothing. Inputs are detached before any await; one locked commit rechecks them (`stale`) with exact read-back.
   * No network, no execution of cloud work.
   */
  captureManualRun(
    workflowId: string,
    opts?: { authority?: CaptureAuthority; articleId?: string },
    now?: Date,
  ): Promise<ManualCaptureResult>;
  /**
   * ⚙️ DT-7C-2B-3 (unconsumed by the UI): one draft → ready transition with every participating workflow captured for
   * its executor in the SAME commit (cloud ids from the prospective Ready commit). Any refusing member refuses the
   * whole transition; already ready is a no-op. Local runs drain after the proven commit, as before.
   */
  captureArticleReady(
    articleId: string,
    opts?: { authority?: CaptureAuthority },
    now?: Date,
  ): Promise<ReadyCaptureResult>;
}

export type StoreState = PersistedState &
  StoreActions & { discoverLibraryStatus: DiscoverLibraryStatus };

const initialData = (): PersistedState => ({
  settings: {
    ...DEFAULT_SETTINGS,
    gear: [...DEFAULT_SETTINGS.gear],
    discover: { ...DEFAULT_SETTINGS.discover },
  },
  completions: [],
  xpEvents: [],
  microActions: [],
  freezesUsedOn: [],
  reviews: [],
  savedRefs: {},
  inspirations: [],
  followedFormats: [],
  formatObservations: [],
  formatQueue: [],
  discoverCandidates: [],
  discoverLibraryEpoch: "",
  discoverLibraryPendingReplacement: false,
  discoverFeedback: [],
  recentTopics: [],
  notes: {},
  gemEvents: [],
  chestsOpened: 0,
  focus: null,
  focusSessions: [],
  bonusFreezes: 0,
  badges: [],
  bossesDefeated: [],
  seasonsFinished: [],
  drills: [],
  planItems: [],
  rewards: defaultRewards(),
  purchases: [],
  posts: [],
  ideas: [],
  socialSnapshots: [],
  audienceAsks: [],
  socialAccounts: [],
  socialPostStats: [],
  demographics: [],
  socialSeedApplied: "",
  socialSync: { ...EMPTY_SOCIAL_SYNC },
  trends: { ...EMPTY_TRENDS, items: [], sources: [], dismissed: [] },
  customGenres: [],
  articles: [],
  workflows: [],
  workflowRuns: [],
  businessKit: null,
  brandDeals: [],
  inboxDrafts: {},
  inboxSendOps: {},
  inboxThreadsSendOps: {},
  inboxInstagramSendOps: {},
  inboxInstagramDmSendOps: {},
  inboxInstagramDmControls: {},
  inboxSeen: {},
  inboxTab: "all",
});

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const questRef = (skillId: string, quest: QuestType) => `${skillId}:${quest}`;

/**
 * Articles generation (not persisted): bumped by import and reset, here or in another tab (a rehydration with a new
 * library epoch), so an editor's pending text captured before can never be written over what replaced it (ABA-safe
 * with commitId; another tab's edit of the same article changes its commitId).
 */
let articlesGen = 0;
export const articlesGeneration = (): number => articlesGen;
/** The base an editor captures from the article it shows. */
export const articleBase = (a: Pick<Article, "commitId">): ArticleBase => ({
  commitId: a.commitId,
  generation: articlesGen,
});

let lockOverride: ArticlesLock | null | undefined;
/** Tests inject a deterministic lock; `null` = none available; `undefined` = back to Web Locks. */
export function setArticlesLock(lock: ArticlesLock | null | undefined): void {
  lockOverride = lock;
}
function rawArticlesLock(): ArticlesLock | null {
  if (lockOverride !== undefined) return lockOverride;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return null;
  // The callback's promise is what request() resolves with; then() only flattens the type.
  return (fn) => locks.request("3z-prod-articles", { mode: "exclusive" }, fn).then((v) => v);
}
/**
 * The shared lock every writer of the store key holds (DT-7C-2A-R1). On being granted it first writes this tab's
 * pending ordinary save (synchronously, inside the same hold: never a second acquisition), so a locked commit's
 * rehydration starts from it instead of discarding it.
 */
function articlesLock(): ArticlesLock | null {
  const lock = rawArticlesLock();
  return (
    lock &&
    ((fn) =>
      lock(async () => {
        runPendingSave();
        return fn();
      }))
  );
}

const ARTICLE_CONTENT = [
  "title",
  "summary",
  "body",
  "slug",
  "category",
  "tags",
  "coverUrl",
  "skillId",
] as const;
const sameArticleContent = (a: Article, b: Article) =>
  ARTICLE_CONTENT.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
/**
 * Whether the shared storage holds a payload the existing `merge` will accept (the same parse). Missing or malformed
 * storage is never treated as an empty list: the commit stops as not persisted.
 */
function storedPayloadValid(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return PersistedStateSchema.partial()
      .extend({ settings: SettingsSchema.partial().optional() })
      .safeParse(migrateLegacySettings(JSON.parse(raw)?.state)).success;
  } catch {
    return false;
  }
}

/** Extra slices a CMS commit writes in the same patch (the Ready trigger's runs), with their own read-back. */
interface FreshExtra {
  patch: Partial<PersistedState>;
  persisted: () => boolean;
}

type ArticleMutation =
  | { articles: Article[]; article: Article; also?: FreshExtra }
  | Exclude<ArticleResult, { ok: true } | { reason: "not-persisted" }>;

/** A mutation's answer: slices to write with the exact read-back that proves them, or a result that writes nothing. */
type FreshCommit<T> =
  | {
      patch: Partial<PersistedState>;
      result: T;
      persisted: () => boolean;
      /**
       * DT-7C-2A (journal commits only): after a failed read-back, true when storage now holds something newer than
       * the pre-commit slices; memory then reloads from storage instead of writing the rollback over it.
       */
      newer?: () => boolean;
    }
  | { result: T };

/**
 * The one transaction every CMS and workflow mutation goes through. Under the exclusive lock (named
 * `3z-prod-articles` for compatibility: one storage key, one lock, so CMS and workflow writes serialize): rehydrate
 * the whole stored payload through the existing `merge` (other tabs' articles, settings, ideas… so no slice is
 * written from stale memory), apply the mutation to that fresh state (a missing target is never recreated), write the
 * patch, and read the exact new commit back. A write the browser did not keep is rolled back to the pre-commit slices,
 * so memory never runs ahead of storage. Without Web Locks, or when the storage probe fails (blocked or full),
 * nothing is committed.
 */
async function commitFresh<T>(
  mutate: (fresh: PersistedState) => FreshCommit<T>,
): Promise<T | FreshFailure> {
  const lock = articlesLock();
  if (!lock) return { ok: false, reason: "unsupported-save" };
  return lock(async (): Promise<T | FreshFailure> => {
    if (!storageDurable() || !storedPayloadValid()) return { ok: false, reason: "not-persisted" };
    await useStore.persist.rehydrate();
    const fresh = useStore.getState();
    const out = mutate(fresh);
    if (!("patch" in out)) return out.result;
    const keys = Object.keys(out.patch) as (keyof PersistedState)[];
    const before: Partial<PersistedState> = Object.fromEntries(keys.map((k) => [k, fresh[k]]));
    // DT-7C-2A-R1: only a journal commit authors the journal slice; any other commit keeps the stored bytes.
    // DT-7C-2B-2: likewise the registration slice; each opaque slice's commit keeps the other's stored bytes.
    // DT-7C-2C: every opaque slice the patch carries is authored (one, or a retirement's proof + journal).
    const authored = OPAQUE.filter((k) => k in out.patch);
    const mode: HeldWrite = authored.length > 1 ? authored : authored.length ? authored[0] : "keep";
    if (keys.some((k) => out.patch[k] !== fresh[k])) {
      try {
        writeHeld(mode, () => useStore.setState(out.patch));
      } catch {
        // A quota error from the write: the read-back below decides.
      }
    }
    if (out.persisted()) return out.result;
    if (out.newer?.()) {
      await useStore.persist.rehydrate();
      return { ok: false, reason: "not-persisted" };
    }
    try {
      writeHeld(mode, () => useStore.setState(before));
    } catch {
      // Memory is back at the stored slices even when this write fails too.
    }
    return { ok: false, reason: "not-persisted" };
  });
}

/** CMS mutations: the articles list (plus any `also` slices) through commitFresh, proven by the article's commit id. */
function commitArticles(
  mutate: (fresh: Article[], state: PersistedState) => ArticleMutation,
): Promise<ArticleResult> {
  return commitFresh<ArticleResult>((state) => {
    const out = mutate(state.articles, state);
    if (!("articles" in out)) return { result: out };
    const { article, also } = out;
    return {
      patch: { articles: out.articles, ...also?.patch },
      result: { ok: true, article },
      persisted: () =>
        articlePersisted(STORAGE_KEY, article.id, article.commitId) && (also?.persisted() ?? true),
    };
  });
}

/**
 * The job id the shared storage holds for one post (read back, never assumed). DT-5-R2 (R1-C): a read that throws, a
 * payload that is not JSON or has no posts list, or a missing post is `{ readable: false }` — never mistaken for a
 * proved absence of the id. DT-5-C1: the stored post must pass the same `PostSchema` rehydration uses, so a string,
 * null, array or other malformed `autoPost` (or an otherwise invalid post) is unreadable too.
 */
function storedJobId(postId: string): { readable: false } | { readable: true; jobId?: string } {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.posts;
    if (!Array.isArray(list)) return { readable: false };
    const post = PostSchema.safeParse(list.find((x: { id?: unknown } | null) => x?.id === postId));
    if (!post.success) return { readable: false };
    return { readable: true, jobId: post.data.autoPost?.jobId };
  } catch {
    return { readable: false };
  }
}

/** One post's remembered job id set (or cleared) through commitFresh, proven by the stored post. */
function commitJobId(
  postId: string,
  next: string | undefined,
  allowed: (post: Post, posts: readonly Post[]) => PublishJobResult | null,
  now: Date,
): Promise<PublishJobResult> {
  return commitFresh<PublishJobResult>((fresh) => {
    const existing = fresh.posts.find((p) => p.id === postId);
    if (!existing) return { result: { ok: false, reason: "missing" } };
    const refused = allowed(existing, fresh.posts);
    if (refused) return { result: refused };
    if (existing.autoPost?.jobId === next) return { result: { ok: true, post: existing } };
    const post = patched(existing, { autoPost: { ...autoPostOf(existing), jobId: next } }, now);
    return {
      patch: { posts: fresh.posts.map((p) => (p.id === postId ? post : p)) },
      result: { ok: true, post },
      persisted: () => {
        const stored = storedJobId(postId);
        return stored.readable && stored.jobId === next;
      },
    };
  });
}

/** The commit id the shared storage holds for one workflow or run (read back, never assumed). */
function storedCommit(
  slice: "workflows" | "workflowRuns" | "brandDeals",
  id: string,
): string | undefined {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state?.[
      slice
    ];
    return Array.isArray(list)
      ? list.find((x: { id?: string } | null) => x?.id === id)?.commitId
      : undefined;
  } catch {
    return undefined;
  }
}

type WorkflowMutation =
  | { workflows: Workflow[]; workflow: Workflow }
  | Exclude<WorkflowResult, { ok: true } | FreshFailure>;

/** Workflow definition mutations, proven by the workflow's commit id. */
function commitWorkflows(mutate: (fresh: Workflow[]) => WorkflowMutation): Promise<WorkflowResult> {
  return commitFresh<WorkflowResult>((state) => {
    const out = mutate(state.workflows);
    if (!("workflows" in out)) return { result: out };
    const { workflow } = out;
    return {
      patch: { workflows: out.workflows },
      result: { ok: true, workflow },
      persisted: () => storedCommit("workflows", workflow.id) === workflow.commitId,
    };
  });
}

/** The base a kit editor or deal row captures (kit null: before the first save). */
export const businessBase = (x: Pick<BusinessKit, "commitId"> | null): BusinessBase => ({
  commitId: x?.commitId ?? null,
  generation: articlesGen,
});

/** The base an inbox draft editor captures (undefined / null: no draft yet). Same fence as the kit's. */
export const inboxDraftBase = (
  d: Pick<InboxDraft, "commitId"> | null | undefined,
): BusinessBase => ({
  commitId: d?.commitId ?? null,
  generation: articlesGen,
});

/**
 * The inbox drafts the shared storage holds (read back, never assumed). DT-6A-R1 (6A-2): the stored record must parse
 * with the persisted draft schema; unreadable JSON, a missing record, an array or any invalid entry is null, so it is
 * never mistaken for proof that a draft is absent (or present).
 */
function storedInboxDrafts(): Record<string, InboxDraft> | null {
  try {
    const drafts: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.inboxDrafts;
    const parsed = InboxDraftsSchema.safeParse(drafts);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The send-operation handles the shared storage holds (read back; anything unparsable is null, never proof). */
function storedSendOps(): Record<string, InboxSendOp> | null {
  try {
    const ops: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.inboxSendOps;
    const parsed = InboxSendOpsSchema.safeParse(ops);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The Threads send handles the shared storage holds (read back; anything unparsable is null, never proof). */
function storedThreadsSendOps(): Record<string, InboxThreadsSendOp> | null {
  try {
    const ops: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.inboxThreadsSendOps;
    const parsed = InboxThreadsSendOpsSchema.safeParse(ops);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The Instagram public send handles the shared storage holds (read back; anything unparsable is null, never proof). */
function storedInstagramSendOps(): Record<string, InboxInstagramSendOp> | null {
  try {
    const ops: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.inboxInstagramSendOps;
    const parsed = InboxInstagramSendOpsSchema.safeParse(ops);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The Instagram DM send handles the shared storage holds (read back; anything unparsable is null, never proof). */
function storedInstagramDmSendOps(): Record<string, InboxInstagramDmSendOp> | null {
  try {
    const ops: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.inboxInstagramDmSendOps;
    const parsed = InboxInstagramDmSendOpsSchema.safeParse(ops);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The conversation controls the shared storage holds (read back; anything unparsable is null, never proof). */
function storedInstagramDmControls(): Record<string, InboxInstagramDmControl> | null {
  try {
    const all: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.inboxInstagramDmControls;
    const parsed = InboxInstagramDmControlsSchema.safeParse(all);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The control slice a restore merges into (DT-6B-2C-5B-R1): what the shared storage holds now; `memory` only when
 * storage holds no saved state or a save without the slice. Unreadable storage or an invalid slice is null (never
 * treated as empty).
 */
function durableControls(
  memory: Record<string, InboxInstagramDmControl>,
): Record<string, InboxInstagramDmControl> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return memory;
    const all: unknown = JSON.parse(raw)?.state?.inboxInstagramDmControls;
    if (all === undefined) return memory;
    const parsed = InboxInstagramDmControlsSchema.safeParse(all);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A restore is durable: storage holds its epoch and exactly its control entries (read back, never assumed). */
function restoredDurably(
  epoch: string,
  controls: Record<string, InboxInstagramDmControl>,
): boolean {
  try {
    const state = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state;
    if (state?.discoverLibraryEpoch !== epoch) return false;
  } catch {
    return false;
  }
  const got = storedInstagramDmControls();
  const keys = Object.keys(controls);
  return (
    !!got &&
    Object.keys(got).length === keys.length &&
    keys.every((k) => got[k]?.commitId === controls[k].commitId)
  );
}

/* ---------- ⚙️ Cloud workflow journal (packet DT-7C-2A, lib/cloudWorkflowJournal.ts) ---------- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The stored payload, read raw (DT-7C-2A-R1): `none` (no save yet), `ok` (JSON whose root and `state` are objects; a
 * legacy save may have no journal slice) or `unreadable` (a throwing read, text that is not JSON, JSON `null`, an
 * array, a missing or non-object `state`). Unreadable is never treated as absent.
 */
type StoredPayload =
  | { kind: "none" }
  | { kind: "unreadable" }
  | { kind: "ok"; raw: string; state: Record<string, unknown> };
function storedPayload(): StoredPayload {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { kind: "none" };
    const root: unknown = JSON.parse(raw);
    const state = isRecord(root) ? root.state : undefined;
    return isRecord(state) ? { kind: "ok", raw, state } : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}

/**
 * The journal the shared storage holds (read back, never assumed): no save yet, or a readable save without the slice,
 * is the empty journal; an unreadable payload or a malformed slice is null (never treated as empty). Without a browser
 * (server render) the store is memory-only and memory is the journal.
 */
function durableJournal(): CloudJournal | null {
  if (typeof window === "undefined") return readJournal(useStore.getState().cloudJournal);
  const p = storedPayload();
  if (p.kind === "none") return emptyJournal();
  return p.kind === "ok" ? readJournal(p.state.cloudJournal) : null;
}

/** Exact read-back: storage holds, canonically, the journal a commit wrote. */
function storedJournalIs(j: CloudJournal): boolean {
  try {
    return journalIs(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state?.cloudJournal,
      j,
    );
  } catch {
    return false;
  }
}

/** After a failed read-back: storage holds another readable journal at or past the proposed generation. */
function journalMovedPast(j: CloudJournal): boolean {
  const s = durableJournal();
  return !!s && s.generation >= j.generation && !journalIs(s, j);
}

/** The library epoch storage holds (a reset's ordinary-content write, read back). */
function storedLibraryEpoch(): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state
      ?.discoverLibraryEpoch;
  } catch {
    return undefined;
  }
}

/**
 * DT-7C-2A-R1: after a reset or restore failed its read-back (inside the lock, `before` = the durable state read there).
 * Its write landed (storage holds its epoch): `before` is written back. Nothing landed: nothing is written; memory
 * goes back to `before` and reloads what storage holds, so a newer write by anyone is never clobbered.
 */
function rollBack(epoch: string, before: Partial<StoreState>): void {
  const landed = storedLibraryEpoch() === epoch;
  try {
    writeHeld(landed ? "all" : "memory", () => useStore.setState(before));
  } catch {
    // Memory is back at `before` even when the rollback write fails too.
  }
  if (!landed) void useStore.persist.rehydrate();
}

/** The journal slice exactly as storage holds it (undefined: none); without a browser, memory's. */
function storedJournalSlice(): unknown {
  if (typeof window === "undefined") return useStore.getState().cloudJournal;
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state?.cloudJournal;
  } catch {
    return undefined;
  }
}
const sameSlice = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** True only when readable storage holds no save at all (a blocked or throwing storage is not "nothing"). */
function nothingSaved(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

type JournalFailure = FreshFailure | { ok: false; reason: "journal-unreadable" };

/**
 * One journal transaction through commitFresh (the shared `3z-prod-articles` lock, fresh rehydration, exact read-back,
 * rollback): `mutate` sees the fresh DURABLE journal and answers the next journal to write, or a result that writes
 * nothing. A rollback never writes over a newer journal another writer left in storage. A lock or storage error is a
 * typed `not-persisted`.
 */
async function commitJournal<T>(
  mutate: (j: CloudJournal) => { next: CloudJournal; result: T } | { result: T },
): Promise<T | JournalFailure> {
  try {
    return await commitFresh<T | JournalFailure>(() => {
      const j = durableJournal();
      if (!j) return { result: { ok: false, reason: "journal-unreadable" } };
      const out = mutate(j);
      if (!("next" in out)) return { result: out.result };
      const { next } = out;
      return {
        patch: { cloudJournal: next },
        result: out.result,
        persisted: () => storedJournalIs(next),
        newer: () => journalMovedPast(next),
      };
    });
  } catch {
    return { ok: false, reason: "not-persisted" };
  }
}

async function enqueueCloud(origin: string, body: unknown): Promise<EnqueueCloudResult> {
  // The base is captured BEFORE the asynchronous validation: a reset or restore meanwhile (a new suppression epoch)
  // invalidates the candidate; any other journal change is reconciled by key under the lock.
  const base = durableJournal();
  if (!base) return { ok: false, reason: "journal-unreadable" };
  const c = await candidateEntry(origin, body);
  if (!c.ok) return c;
  const cand = c.entry;
  return commitJournal<EnqueueCloudResult>((j) => {
    if (j.suppression.epoch !== base.suppression.epoch)
      return { result: { ok: false, reason: "stale" } };
    if (isSuppressed(cand.executionAt, j.suppression))
      return { result: { ok: false, reason: "suppressed" } };
    const cur = j.entries.find((e) => e.key === cand.key);
    if (cur)
      return {
        result:
          cur.payloadDigest === cand.payloadDigest
            ? { ok: true, entry: cur, created: false }
            : { ok: false, reason: "conflict", current: cur },
      };
    if (j.entries.length >= JOURNAL_CAPACITY) return { result: { ok: false, reason: "capacity" } };
    const commitId = newId();
    const next = withEntry(j, { ...cand, commitId, state: "queued", observation: null }, commitId);
    const entry = next.entries.find((e) => e.key === cand.key)!;
    return { next, result: { ok: true, entry, created: true } };
  });
}

async function observeCloud(parsed: Parsed, request: CloudRequest): Promise<ObserveCloudResult> {
  const base = durableJournal();
  if (!base) return { ok: false, reason: "journal-unreadable" };
  const o = await observationOf(parsed, request);
  if (!o.ok) return o;
  const entry = base.entries.find((e) => e.key === o.key);
  if (!entry) return { ok: false, reason: "missing" };
  // Both the new observation and the one it would be compared with pass the pinned parser before the lock.
  if (!(await verifyObservation(entry, o.observation))) return { ok: false, reason: "invalid" };
  if (entry.observation && !(await verifyObservation(entry, entry.observation)))
    return { ok: false, reason: "observation-unverified" };
  const order = entry.observation ? compareObservations(entry.observation, o.observation) : "newer";
  return commitJournal<ObserveCloudResult>((j) => {
    const cur = j.entries.find((e) => e.key === o.key);
    if (!cur) return { result: { ok: false, reason: "missing" } };
    // Compare-and-set: the entry and its observation are still exactly what was validated.
    if (cur.payloadDigest !== entry.payloadDigest || !sameData(cur.observation, entry.observation))
      return { result: { ok: false, reason: "stale" } };
    if (order === "same") return { result: { ok: true, changed: false } };
    if (order !== "newer") return { result: { ok: false, reason: order } };
    const next = withObservation(j, o.key, o.observation, newId());
    return { next, result: { ok: true, changed: true } };
  });
}

/** What the durable journal holds, digests and observations revalidated through the pinned parser now. */
export async function loadCloudJournal(): Promise<CloudJournalLoad> {
  const j = durableJournal();
  const v = j ? await verifyJournal(j) : null;
  if (!j || !v?.ok) return { ok: false, reason: "journal-unreadable" };
  return {
    ok: true,
    generation: j.generation,
    suppression: j.suppression,
    entries: j.entries.map((e) => {
      const rejected = v.rejected.includes(e.key);
      return {
        key: e.key,
        origin: e.authority.origin,
        ownerKey: e.authority.ownerKey,
        occurrenceId: e.occurrenceId,
        workflowId: e.body.workflowId,
        executionAt: e.executionAt,
        payloadDigest: e.payloadDigest,
        commitId: e.commitId,
        state: e.state,
        observed:
          e.observation && !rejected
            ? {
                state: String(e.observation.receipt.state),
                receiptVersion: e.observation.receipt.receiptVersion,
              }
            : null,
        observationRejected: rejected,
      };
    }),
  };
}

/** Entries the in-memory journal keeps (null: unreadable), for the reset confirmation copy. Not a projection. */
export function cloudJournalRetained(s: Pick<PersistedState, "cloudJournal">): number | null {
  return readJournal(s.cloudJournal)?.entries.length ?? null;
}

/* ---------- ⚙️ Cloud fence and saved-occurrence reader (packet DT-7C-2B-4, lib/cloudWorkflowOccurrenceClient.ts) ---------- */

/**
 * In memory only, never persisted. `config` moves on EVERY transition of the Worker origin or token (the observer
 * registered right after the store is created: setters, direct updates, import, reset, rollbacks and every rehydration
 * all go through `setState`), so A→B→A moves it twice; `visit` moves on `invalidateCloudVisit()`.
 */
let cloudConfigGen = 0;
let cloudVisitGen = 0;
/** The latest capture per target (`wf:<id>` / `article:<id>`): a newer capture of the same target supersedes. */
let cloudActionSeq = 0;
const cloudLatest = new Map<string, number>();

export const cloudFence = (): CloudFence => ({ config: cloudConfigGen, visit: cloudVisitGen });
/** A new visit: every in-flight capture and controller action captured before it can no longer commit or dispatch. */
export function invalidateCloudVisit(): void {
  cloudVisitGen += 1;
}

/** One capture's fence, captured synchronously at its entry. */
interface CaptureFence {
  readonly fence: CloudFence;
  readonly target: string;
  readonly seq: number;
}
function captureFence(target: string): CaptureFence {
  const seq = ++cloudActionSeq;
  cloudLatest.set(target, seq); // ponytail: one number per touched target for the page's life; tiny.
  return { fence: cloudFence(), target, seq };
}
const captureHolds = (f: CaptureFence): boolean =>
  f.fence.config === cloudConfigGen &&
  f.fence.visit === cloudVisitGen &&
  cloudLatest.get(f.target) === f.seq;

/** What a saved-occurrence action depends on: the entry's identity, body, state and the suppression (not its observation). */
function occurrenceSnapshot(e: JournalEntry, s: Suppression): string {
  const { observation: _observation, ...rest } = e;
  void _observation;
  return canon({ ...rest, suppression: s });
}
/** Reader output → the exact snapshot it was verified against (only these objects can be dispatched). */
const savedSnapshots = new WeakMap<SavedOccurrence, string>();

type LockedOccurrence<T> =
  { ok: true; value: T } | { ok: false; reason: OccurrenceReadFailure | "superseded" };
/**
 * Under the shared lock (commitFresh, no patch, after its fresh rehydration): the entry is still stored with exactly
 * `snap`, then `go()` runs synchronously inside the hold. Lock or storage trouble is a typed failure, never a throw.
 */
async function lockedOccurrence<T>(
  key: string,
  snap: string,
  go: () => T | null,
): Promise<LockedOccurrence<T>> {
  try {
    return await commitFresh<LockedOccurrence<T>>(() => {
      const j = durableJournal();
      if (!j) return { result: { ok: false, reason: "unreadable" } };
      const e = j.entries.find((x) => x.key === key);
      if (!e || occurrenceSnapshot(e, j.suppression) !== snap)
        return { result: { ok: false, reason: "moved" } };
      const value = go();
      return { result: value === null ? { ok: false, reason: "superseded" } : { ok: true, value } };
    });
  } catch {
    return { ok: false, reason: "not-persisted" };
  }
}

/**
 * ⚙️ The verified durable reader (DT-7C-2B-4): one journal entry by its full authority-scoped key from fresh storage, as
 * a detached frozen copy of its body and immutable identity (never Settings, the current workflow/article or a token).
 * Its digest is recomputed, then the same exact stored snapshot is rechecked under the shared lock (`moved` otherwise).
 */
export async function readCloudOccurrence(key: unknown): Promise<OccurrenceRead> {
  if (typeof key !== "string") return { ok: false, reason: "invalid" };
  const j = durableJournal();
  if (!j) return { ok: false, reason: "unreadable" };
  const e = j.entries.find((x) => x.key === key);
  if (!e) return { ok: false, reason: "missing" };
  const snap = occurrenceSnapshot(e, j.suppression);
  const entry: SavedOccurrence = deepFreeze(
    detach({
      key: e.key,
      authority: { origin: e.authority.origin, ownerKey: e.authority.ownerKey },
      occurrenceId: e.occurrenceId,
      workflowId: e.body.workflowId,
      body: e.body,
      payloadDigest: e.payloadDigest,
      executionAt: e.executionAt,
      commitId: e.commitId,
      state: e.state,
      suppression: j.suppression,
    }),
  );
  // The accepted journal verifier on this one entry: its digest recomputed (its observation is not needed here).
  const v = await verifyJournal({ ...j, entries: [e] }).catch(() => ({ ok: false as const }));
  if (!v.ok) return { ok: false, reason: "invalid" };
  const held = await lockedOccurrence(key, snap, () => true);
  if (!held.ok) return { ok: false, reason: held.reason === "superseded" ? "moved" : held.reason };
  savedSnapshots.set(entry, snap);
  return { ok: true, entry };
}

/**
 * ⚙️ The persistence an occurrence controller is given (lib/cloudWorkflowOccurrenceClient.ts; nothing here constructs
 * one or sends anything): the in-memory fence, the verified reader, the locked same-snapshot dispatch boundary, and the
 * accepted journal observation API unchanged.
 */
export const cloudOccurrencePersistence: OccurrencePersistence = {
  fence: cloudFence,
  read: readCloudOccurrence,
  dispatch<T>(entry: SavedOccurrence, go: () => T | null): Promise<LockedOccurrence<T>> {
    const snap = savedSnapshots.get(entry);
    if (snap === undefined) return Promise.resolve({ ok: false, reason: "invalid" });
    return lockedOccurrence(entry.key, snap, go);
  },
  observe: (parsed, request) => observeCloud(parsed, request),
};

/* ---------- ⚙️ Cloud workflow registration intents (packet DT-7C-2B-2, lib/cloudWorkflowRegistration.ts) ---------- */

/**
 * The registrations the shared storage holds (structure only; `read` re-parses every answer): no save yet, or a readable
 * save without the slice, is empty; an unreadable payload or a malformed slice is null (never treated as empty).
 * Without a browser (server render) memory is the store.
 */
function durableRegistrations(): CloudRegistrations | null {
  if (typeof window === "undefined")
    return readRegistrations(useStore.getState().cloudRegistrations);
  const p = storedPayload();
  if (p.kind === "none") return emptyRegistrations();
  return p.kind === "ok" ? readRegistrations(p.state.cloudRegistrations) : null;
}

/** The registration slice exactly as storage holds it (undefined: none or unreadable); without a browser, memory's. */
function storedRegistrationsSlice(): unknown {
  if (typeof window === "undefined") return useStore.getState().cloudRegistrations;
  const p = storedPayload();
  return p.kind === "ok" ? p.state.cloudRegistrations : undefined;
}

/**
 * ⚙️ The locked persistence a registration controller is given (lib/cloudWorkflowRegistrationClient.ts; nothing here
 * constructs one, sends a request or replays anything). `read`: the durable slice, every stored answer re-parsed through
 * the pinned parser (null = unreadable). `commit`: one transaction through commitFresh (the shared `3z-prod-articles`
 * lock, fresh rehydration, exact canonical read-back, a rollback that never writes over a newer slice another writer
 * left); `mutate` sees the fresh durable slice. A lock or storage error is a typed `not-persisted`.
 */
export const cloudRegistrationPersistence: RegistrationPersistence = {
  async read() {
    const r = durableRegistrations();
    return r && (await verifyRegistrations(r)) ? r : null;
  },
  async commit<T>(
    mutate: (
      fresh: CloudRegistrations,
    ) => { readonly next: CloudRegistrations; readonly result: T } | { readonly result: T },
  ): Promise<T | PersistFailure> {
    try {
      return await commitFresh<T | PersistFailure>(() => {
        const r = durableRegistrations();
        if (!r) return { result: { ok: false, reason: "registrations-unreadable" } };
        const out = mutate(r);
        if (!("next" in out)) return { result: out.result };
        const { next } = out;
        return {
          patch: { cloudRegistrations: next },
          result: out.result,
          persisted: () => registrationsIs(storedRegistrationsSlice(), next),
          newer: () => {
            const now = durableRegistrations();
            return !!now && now.generation >= next.generation && !registrationsIs(now, next);
          },
        };
      });
    } catch {
      return { ok: false, reason: "not-persisted" };
    }
  },
};

/* ---------- ⚙️ Cloud reconciliation: adoption, proof and ack (packet DT-7C-2C, lib/cloudWorkflowReconciliation.ts) ---------- */

/**
 * The reconciliation the shared storage holds (structure only; receipts are re-verified by `verifyProof` before use): no
 * save yet, or a readable save without the slice, is empty; an unreadable payload or a malformed slice is null (never
 * treated as empty). Without a browser (server render) memory is the store.
 */
function durableRecon(): CloudReconciliation | null {
  if (typeof window === "undefined")
    return readReconciliation(useStore.getState().cloudReconciliation);
  const p = storedPayload();
  if (p.kind === "none") return readReconciliation(undefined);
  return p.kind === "ok" ? readReconciliation(p.state.cloudReconciliation) : null;
}
/** The reconciliation slice exactly as storage holds it (undefined: none or unreadable); without a browser, memory's. */
function storedReconSlice(): unknown {
  if (typeof window === "undefined") return useStore.getState().cloudReconciliation;
  const p = storedPayload();
  return p.kind === "ok" ? p.state.cloudReconciliation : undefined;
}
const storedReconIs = (r: CloudReconciliation): boolean => reconciliationIs(storedReconSlice(), r);

const rowsOf = (v: unknown): { id: string }[] =>
  Array.isArray(v)
    ? v.filter((x): x is { id: string } => isRecord(x) && typeof x.id === "string")
    : [];
const listsOf = (s: Record<string, unknown> | Partial<PersistedState>): OutputLists => ({
  ideas: rowsOf((s as Record<string, unknown>).ideas),
  posts: rowsOf((s as Record<string, unknown>).posts),
  planItems: rowsOf((s as Record<string, unknown>).planItems),
});
const NO_LISTS: OutputLists = { ideas: [], posts: [], planItems: [] };

/**
 * DT-7C-2C deletion evidence for an ordinary save (called by `runPendingSave`, which holds the shared lock or runs where
 * no lock exists): every owned cloud output storage held that this write removes is recorded `deleted` in the SAME write.
 * An unreadable slice is left verbatim (it blocks every reconciliation and ack, so nothing can be re-adopted).
 */
function withDeletionEvidence(
  fresh: Record<string, unknown>,
  state: LocalPersistedState,
): LocalPersistedState {
  const r = readReconciliation(fresh.cloudReconciliation);
  // DT-7C-2C-R1: a retired proof's tombstone still owns its present outputs.
  if (!r || (!r.proofs.length && !r.tombstones.length)) return state;
  const next = applyDeletions(
    r,
    listsOf(fresh),
    listsOf(state as unknown as Record<string, unknown>),
  );
  return next === r ? state : { ...state, cloudReconciliation: stamp(r, next, newId()) };
}

/** Every stored proof re-verified through the pinned parser now. */
const reconVerified = async (r: CloudReconciliation): Promise<boolean> =>
  (await Promise.all(r.proofs.map((p) => verifyProof(p)))).every(Boolean);

/** What a snapshot captured (synchronously, before its awaits) and verified; rechecked under the lock. */
interface ReconBase {
  readonly authority: Authority;
  readonly fence: CloudFence;
  readonly gen: number;
  readonly epoch: number;
  readonly retired: number;
  /** Verified proof bytes per key (null = verified absent); a key missing here was not verified. */
  readonly proofs: ReadonlyMap<string, string | null>;
  /** The parser-branded receipts of those proofs: the only things an ack request is built from. */
  readonly receipts: ReadonlyMap<string, FullReceipt>;
}
const reconBases = new WeakMap<object, ReconBase>();
const sameCloudFence = (a: CloudFence, b: CloudFence) =>
  a.config === b.config && a.visit === b.visit;

async function reconSnapshot(raw: Authority, ids: readonly string[]): Promise<SnapshotRead> {
  const fence = cloudFence();
  const gen = articlesGen;
  const auth = authorityOf(raw?.origin, raw?.ownerKey);
  const r = durableRecon();
  if (!auth || !r) return { ok: false, reason: "unreadable" };
  const j = durableJournal();
  if (!j) return { ok: false, reason: "journal-unreadable" };
  const lists = listsOf(useStore.getState());
  const ak = authorityKey(auth);
  const arec = r.authorities.find((a) => a.key === ak);
  const proofs = new Map<string, string | null>();
  const receipts = new Map<string, FullReceipt>();
  const local: Record<string, LocalBinding> = {};
  for (const id of new Set(ids)) {
    const key = occurrenceKey(auth, id);
    if (!key) {
      local[id] = { invalid: true };
      continue;
    }
    const b: { -readonly [K in keyof LocalBinding]: LocalBinding[K] } = {};
    const e = j.entries.find((x) => x.key === key);
    if (e) {
      if ((await payloadDigestOf(e.body)) !== e.payloadDigest) b.invalid = true;
      else b.journal = { body: detach(e.body), payloadDigest: e.payloadDigest };
    }
    const p = r.proofs.find((x) => x.key === key);
    if (p) {
      const v = await verifyProof(p);
      if (!v) b.invalid = true;
      else {
        proofs.set(key, canon(p));
        receipts.set(key, v);
        b.proof = {
          payloadDigest: p.payloadDigest,
          receiptVersion: v.receiptVersion,
          terminal: ackRequestFor(v) !== null,
          eligible: ackEligibility(r, key, lists).ok,
        };
      }
    } else proofs.set(key, null);
    const t = r.tombstones.find((x) => x.key === key);
    if (t) b.tombstone = { payloadDigest: t.payloadDigest };
    if (r.pending.some((x) => x.key === key)) b.pending = true;
    local[id] = b;
  }
  const base = {};
  reconBases.set(base, {
    authority: auth,
    fence,
    gen,
    epoch: j.suppression.epoch,
    retired: arec?.retired ?? 0,
    proofs,
    receipts,
  });
  return { ok: true, snapshot: { base, cursor: arec?.cursor ?? 0, local } };
}

/** A parser-verified full status row answered for exactly this request and authority, as plain JSON; else null. */
function verifiedRow(parsed: Parsed, request: CloudRequest, auth: Authority): Obj | null {
  if (parsed?.outcome !== "ok" || parsed.kind !== "status" || parsed.result.found !== "row")
    return null;
  const rec = parsed.result.receipt;
  if (!isVerifiedReceipt(rec) || authorityKey(parsed.authority) !== authorityKey(auth)) return null;
  if (
    request?.kind !== "status" ||
    request.ownerKey !== auth.ownerKey ||
    request.occurrenceId !== rec.occurrenceId
  )
    return null;
  return cloneJson(rec) as Obj;
}

/** The base's fences and the key's verified proof still hold on the fresh durable state (inside the lock). */
function reconHolds(
  b: ReconBase,
  r: CloudReconciliation,
  j: CloudJournal,
  key: string | null,
): "ok" | "stale" | "invalid" {
  if (!sameCloudFence(cloudFence(), b.fence) || articlesGen !== b.gen) return "stale";
  if (j.suppression.epoch !== b.epoch) return "stale";
  const arec = r.authorities.find((a) => a.key === authorityKey(b.authority));
  if ((arec?.retired ?? 0) !== b.retired) return "stale";
  if (key === null) return "ok";
  if (!b.proofs.has(key)) return "invalid";
  const cur = r.proofs.find((p) => p.key === key);
  return (cur ? canon(cur) : null) === b.proofs.get(key) ? "ok" : "stale";
}

/** Ownership resolution of the entry's workflow is identical with and without the entry (registrations as verified). */
function ownershipUnchanged(
  fresh: PersistedState,
  j: CloudJournal,
  key: string,
  workflowId: string,
  verified: CloudRegistrations | null,
): boolean {
  const regs = durableRegistrations();
  if (!verified || !regs || !same(regs, verified)) return false;
  const origin = configuredOrigin(fresh);
  const own = (journal: CloudJournal) =>
    canon(resolveOwnership({ workflowId, registrations: regs, journal, configuredOrigin: origin }));
  return own(j) === own(withoutEntry(j, key, "probe"));
}

async function reconCommit(
  baseRef: object,
  input: CommitInput,
  live: () => boolean,
): Promise<CommitOutcome> {
  const b = reconBases.get(baseRef);
  if (!b || !isRecord(input)) return { ok: false, reason: "invalid" };
  const auth = b.authority;
  // Asynchronous preparation, before the lock: the answer bound to this authority and request (plain copies only).
  let receipt: Obj | null = null;
  let pruned: { occurrenceId: string; payloadDigest: string; prunedAt: string } | null = null;
  let verifiedRegs: CloudRegistrations | null = null;
  let key: string | null = null;
  if (input.kind === "receipt") {
    receipt = verifiedRow(input.parsed, input.request, auth);
    if (!receipt) return { ok: false, reason: "invalid" };
    key = occurrenceKey(auth, receipt.occurrenceId as string);
  } else if (input.kind === "pruned") {
    const p = input.parsed;
    const req = input.request;
    if (
      p?.outcome !== "ok" ||
      p.kind !== "status" ||
      p.result.found !== "pruned" ||
      authorityKey(p.authority) !== authorityKey(auth) ||
      req?.kind !== "status" ||
      req.ownerKey !== auth.ownerKey ||
      req.occurrenceId !== p.result.occurrenceId
    )
      return { ok: false, reason: "invalid" };
    pruned = {
      occurrenceId: p.result.occurrenceId,
      payloadDigest: p.result.payloadDigest,
      prunedAt: p.result.prunedAt,
    };
    key = occurrenceKey(auth, pruned.occurrenceId);
    const entry = durableJournal()?.entries.find((e) => e.key === key);
    const regs = durableRegistrations();
    if (
      entry &&
      regs &&
      (await verifyOwnershipEvidence(regs, [entry.body.workflowId]).catch(() => false))
    )
      verifiedRegs = regs;
  } else if (input.kind === "pending") {
    key = occurrenceKey(auth, input.item?.occurrenceId);
  }
  if ((input.kind === "receipt" || input.kind === "pruned" || input.kind === "pending") && !key)
    return { ok: false, reason: "invalid" };
  const cursor = (input as { cursor?: unknown }).cursor;
  if (cursor !== undefined && !(Number.isSafeInteger(cursor) && (cursor as number) >= 0))
    return { ok: false, reason: "invalid" };
  try {
    return await commitFresh<CommitOutcome>((fresh) => {
      if (!live()) return { result: { ok: false, reason: "stale" } };
      const r = durableRecon();
      if (!r) return { result: { ok: false, reason: "unreadable" } };
      const j = durableJournal();
      if (!j) return { result: { ok: false, reason: "journal-unreadable" } };
      const held = reconHolds(
        b,
        r,
        j,
        input.kind === "receipt" || input.kind === "pruned" ? key : null,
      );
      if (held !== "ok") return { result: { ok: false, reason: held } };
      const commitId = newId();
      let next = r;
      let journalNext: CloudJournal | null = null;
      let adopted: readonly { kind: "idea" | "post" | "plan"; record: Obj }[] = [];
      let result: CommitOutcome;
      if (input.kind === "receipt") {
        const plan = planReceipt({
          recon: r,
          journal: j,
          lists: listsOf(fresh),
          authority: auth,
          receipt: receipt!,
          commitId,
        });
        if (!plan.ok) return { result: { ok: false, reason: plan.reason } };
        next = plan.next;
        adopted = plan.adopted;
        result = {
          ok: true,
          change: plan.change,
          delivered: plan.delivered,
          adopted: plan.adopted.length,
          collisions: plan.collisions,
        };
      } else if (input.kind === "pruned") {
        const entry = j.entries.find((e) => e.key === key);
        if (entry && entry.payloadDigest !== pruned!.payloadDigest)
          return { result: { ok: false, reason: "mismatch" } };
        const ret = retireOccurrence(r, { authority: auth, ...pruned!, journalKnown: !!entry });
        if (!ret.ok) return { result: { ok: false, reason: ret.reason } };
        next = ret.next;
        result = { ok: true, change: ret.retired ? "retired" : "none" };
        // Journal history is retired only when ownership stays exactly as it resolves now (else the minimum is kept).
        if (
          ret.retired &&
          entry &&
          ownershipUnchanged(fresh, j, entry.key, entry.body.workflowId, verifiedRegs)
        )
          journalNext = withoutEntry(j, entry.key, commitId);
      } else if (input.kind === "pending") {
        const it = input.item;
        if (!isRecord(it) || typeof input.reason !== "string")
          return { result: { ok: false, reason: "invalid" } };
        const w = withPending(r, {
          key: key!,
          authority: auth,
          occurrenceId: it.occurrenceId,
          changeSeq: it.changeSeq,
          receiptVersion: it.receiptVersion,
          payloadDigest: it.payloadDigest,
          reason: input.reason.slice(0, 200) || "unknown",
        });
        if (!w.ok) return { result: { ok: false, reason: w.reason } };
        next = w.next;
        result = { ok: true, change: "pending" };
      } else result = { ok: true, change: "cursor" };
      if (cursor !== undefined) next = withCursor(next, auth, cursor as number);
      next = stamp(r, next, commitId);
      if (parseReconciliation(next) === null) return { result: { ok: false, reason: "invalid" } };
      const patch: Partial<PersistedState> = {};
      if (next !== r) patch.cloudReconciliation = next;
      if (journalNext) patch.cloudJournal = journalNext;
      for (const a of adopted) {
        if (a.kind === "idea") patch.ideas = [...(patch.ideas ?? fresh.ideas), a.record as never];
        else if (a.kind === "post")
          patch.posts = [...(patch.posts ?? fresh.posts), a.record as never];
        else patch.planItems = [...(patch.planItems ?? fresh.planItems), a.record as never];
      }
      if (!Object.keys(patch).length) return { result };
      const slice = (k: "idea" | "post" | "plan") =>
        k === "idea" ? "ideas" : k === "post" ? "posts" : "planItems";
      return {
        patch,
        result,
        // Outputs AND proof read back exactly (ids alone are not proof).
        persisted: () =>
          (next === r || storedReconIs(next)) &&
          (!journalNext || storedJournalIs(journalNext)) &&
          adopted.every((a) => storedRecordIs(slice(a.kind), a.record as { id: string })),
        // A failed read-back writes no rollback: memory reloads storage (newer commits and deletions are kept).
        newer: () => true,
      };
    });
  } catch {
    return { ok: false, reason: "not-persisted" };
  }
}

async function reconDispatchAck<T>(
  baseRef: object,
  occurrenceId: string,
  go: (request: CloudRequest) => T | null,
): Promise<{ ok: true; value: T } | { ok: false; reason: AckRefusal | "superseded" }> {
  const b = reconBases.get(baseRef);
  const key =
    b && typeof occurrenceId === "string" ? occurrenceKey(b.authority, occurrenceId) : null;
  if (!b || !key) return { ok: false, reason: "invalid" };
  const verified = b.receipts.get(key);
  if (!verified) return { ok: false, reason: "missing" };
  const request = ackRequestFor(verified); // only a verified full TERMINAL receipt, at exactly its version
  if (!request) return { ok: false, reason: "not-terminal" };
  try {
    return await commitFresh<
      { ok: true; value: T } | { ok: false; reason: AckRefusal | "superseded" }
    >((fresh) => {
      const r = durableRecon();
      if (!r) return { result: { ok: false, reason: "unreadable" } };
      const j = durableJournal();
      if (!j) return { result: { ok: false, reason: "journal-unreadable" } };
      const held = reconHolds(b, r, j, key);
      if (held !== "ok") return { result: { ok: false, reason: held } };
      const el = ackEligibility(r, key, listsOf(fresh));
      if (!el.ok) return { result: { ok: false, reason: el.reason } };
      // Started synchronously inside the hold; the lock is not held across the network I/O.
      const value = go(request);
      return { result: value === null ? { ok: false, reason: "superseded" } : { ok: true, value } };
    });
  } catch {
    return { ok: false, reason: "not-persisted" };
  }
}

/**
 * ⚙️ The locked persistence a reconciliation controller is given (lib/cloudWorkflowReconciliationClient.ts; nothing here
 * constructs one or sends anything): the in-memory fence, the verified snapshot (base captured before its awaits), one
 * locked commit per item (fresh rehydration, the base rechecked, exact read-back of outputs and proof, no rollback over
 * newer state) and the locked ack eligibility check that starts the request inside the hold.
 */
export const cloudReconciliationPersistence: ReconciliationPersistence = {
  fence: cloudFence,
  snapshot: (authority, ids) => reconSnapshot(authority, Array.isArray(ids) ? ids : []),
  commit: reconCommit,
  dispatchAck: reconDispatchAck,
};

/* ---------- ⚙️ Trigger ownership and capture (packet DT-7C-2B-3, lib/cloudWorkflowCapture.ts) ---------- */

/** The configured Worker's canonical origin (Settings; never the token), or null. */
const configuredOrigin = (s: Pick<PersistedState, "settings">): string | null =>
  canonicalOrigin(s.settings.apiKeys.scoutUrl);
const detach = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const recordCanon = (regs: CloudRegistrations, ids: readonly string[]): string[] =>
  regs.records.filter((r) => ids.includes(r.workflowId)).map((r) => canon(r));

/** Registration records (canonical) that passed the pinned parser before a lock; null = unreadable or refused. */
type Verified = ReadonlySet<string> | null;

/**
 * Before a legacy trigger's lock: the durable records of `ids` re-verified through the pinned parser. With none to
 * verify the answer is immediate (no await: the legacy timing is unchanged).
 */
function legacyProof(ids: readonly string[]): Verified | Promise<Verified> {
  const regs = durableRegistrations();
  if (!regs) return null;
  const related = recordCanon(regs, ids);
  if (!related.length) return new Set();
  return verifyOwnershipEvidence(regs, ids).then(
    (ok) => (ok ? new Set(related) : null),
    () => null,
  );
}

/**
 * Inside the lock: every id provably local from the FRESH durable slices, related records accepted only when exactly
 * what was verified (anything else is unproven, never local).
 */
function provablyLocal(fresh: PersistedState, ids: readonly string[], verified: Verified): boolean {
  const regs = durableRegistrations();
  const journal = durableJournal();
  if (!verified || !regs || !journal) return false;
  if (!recordCanon(regs, ids).every((r) => verified.has(r))) return false;
  const origin = configuredOrigin(fresh);
  return ids.every(
    (workflowId) =>
      resolveOwnership({ workflowId, registrations: regs, journal, configuredOrigin: origin })
        .kind === "local",
  );
}

/** Enabled, issue-free article-ready workflows: the members a Ready transition triggers. */
const readyMembers = (s: Pick<PersistedState, "workflows">): Workflow[] =>
  s.workflows.filter(
    (w) => w.enabled && w.trigger.kind === "article-ready" && workflowIssues(w).length === 0,
  );

/**
 * Every input a capture depends on, canonical: computed once at preparation (memory + durable slices) and again on the
 * fresh state inside the lock; any difference is `stale`. Commit ids are fresh on every workflow/article commit and
 * the library epoch + articles generation on every reset/import, so A-B-A is caught; the registration slice is
 * compared whole, the journal by its monotonic generation/commit/suppression marker.
 */
function depsOf(
  s: PersistedState,
  workflows: readonly Workflow[],
  articleId: string | null,
  planner: boolean,
): string {
  const j = durableJournal();
  const a = articleId === null ? null : s.articles.find((x) => x.id === articleId);
  return canon({
    gen: articlesGen,
    epoch: s.discoverLibraryEpoch,
    lang: s.settings.lang,
    origin: configuredOrigin(s),
    workflows,
    article: a ? { id: a.id, commitId: a.commitId, status: a.status } : null,
    planner: planner
      ? {
          completions: s.completions,
          planItems: s.planItems,
          gear: s.settings.gear,
          davinciEdition: s.settings.davinciEdition,
        }
      : null,
    regs: durableRegistrations(),
    journal: j && { generation: j.generation, commitId: j.commitId, suppression: j.suppression },
  });
}

const refusal = (
  reason: CaptureRefusalReason,
  workflowId?: string,
  detail?: CaptureDetail,
): CaptureRefusal => ({
  kind: "refused",
  reason,
  ...(workflowId ? { workflowId } : {}),
  ...(detail ? { detail } : {}),
});

/** The captured planner inputs a plan step's context is built from (detached). */
type PlannerInputs = {
  completions: PersistedState["completions"];
  planItems: PersistedState["planItems"];
  settings: { gear: PersistedState["settings"]["gear"]; davinciEdition: string };
};

/**
 * One cloud member: the explicit authority checked, the accepted builder's immutable snapshot, the definition bound to
 * the registration by digest/revision/epoch, then the journal's own preflight (limits, cloud limitations, digest).
 */
async function cloudMember(p: {
  workflow: Workflow;
  own: Extract<Ownership, { kind: "cloud" }>;
  authority: Authority | null;
  origin: string | null;
  occurrenceId: string | null;
  executionAt: string;
  lang: PersistedState["settings"]["lang"];
  article?: Article;
  planner: PlannerInputs | null;
}): Promise<{ ok: true; candidate: Candidate } | CaptureRefusal> {
  const { workflow: w, own } = p;
  const no = (reason: CaptureRefusalReason, detail?: CaptureDetail) =>
    refusal(reason, w.id, detail);
  if (!p.authority || p.authority.origin !== p.origin) return no("authority-mismatch");
  if (authorityKey(p.authority) !== authorityKey(own.authority)) return no("authority-mismatch");
  if (!p.occurrenceId) return no("snapshot", { snapshot: "unsupported_id" });
  const reg = own.registration;
  const built = await buildCloudSnapshot({
    ownerKey: own.authority.ownerKey,
    occurrenceId: p.occurrenceId,
    registrationEpoch: reg.registrationEpoch,
    revision: reg.revision,
    executionAt: p.executionAt,
    workflow: { id: w.id, name: w.name, trigger: w.trigger, actions: w.actions },
    lang: p.lang,
    ...(p.article
      ? {
          article: {
            id: p.article.id,
            title: p.article.title,
            summary: p.article.summary,
            slug: p.article.slug,
            ...(p.article.skillId ? { skillId: p.article.skillId } : {}),
          },
        }
      : {}),
    ...(p.planner ? { planner: { ...p.planner, contextAt: p.executionAt } } : {}),
  });
  if (!built.ok)
    return no("snapshot", {
      snapshot: built.reason,
      ...(built.detail ? { snapshotDetail: built.detail } : {}),
    });
  const bound = bindRegistration({
    workflow: w,
    registration: reg,
    digest: await workflowDigestOf(built.snapshot.body.snapshot),
    executionAt: p.executionAt,
  });
  if (bound) return no(bound);
  const c = await candidateEntry(own.authority.origin, built.snapshot.body);
  if (!c.ok)
    return c.reason === "limitation"
      ? no("limitation", { limitation: c.limitation })
      : no(c.reason);
  if (c.entry.payloadDigest !== built.snapshot.payloadDigest) return no("invalid");
  return { ok: true, candidate: c.entry };
}

/** What a capture commits: the Ready article, local runs and cloud candidates (any may be absent). */
interface CapturePlan {
  article?: Article;
  runs: WorkflowRun[];
  candidates: Candidate[];
}

/** DT-7C-2B-3-R1: the caller's Date read once; each use gets its own copy of that instant (nothing can move it). */
function privateInstant(now: Date): () => Date {
  const ms = now.getTime();
  return () => new Date(ms);
}

/** DT-7C-2B-3-R1: storage holds exactly one record with this id in `slice`, canonically equal to `rec`. */
function storedRecordIs(
  slice: "articles" | "workflowRuns" | "ideas" | "posts" | "planItems",
  rec: { id: string },
): boolean {
  const p = storedPayload();
  const list = p.kind === "ok" ? p.state[slice] : undefined;
  if (!Array.isArray(list)) return false;
  const rows = list.filter((x) => isRecord(x) && x.id === rec.id);
  return rows.length === 1 && same(rows[0], rec);
}

/**
 * DT-7C-2B-3-R1: after a capture's failed read-back, inside its lock. Puts back only what this capture still owns in
 * storage — its article or runs (by this capture's commit ids), the journal exactly as it wrote it; a slice held
 * exactly as written goes back whole — and keeps everything else as storage holds it (another commit, a deletion, a
 * newer journal). Memory takes the same values (only memory when nothing is owned; when storage is unreadable or empty,
 * memory goes back to the pre-commit slices and nothing is written). Always true: commitFresh then reloads from storage
 * instead of writing its whole-slice rollback.
 */
function restoreOwned(
  fresh: PersistedState,
  patch: Partial<PersistedState>,
  plan: { article?: Article; runs: readonly WorkflowRun[]; journal: unknown },
): true {
  const memoryOnly = (v: Partial<PersistedState>) => {
    try {
      writeHeld("memory", () => useStore.setState(v));
    } catch {
      // Nothing to undo: memory-only writes reach no storage.
    }
    return true as const;
  };
  const before = Object.fromEntries(
    Object.keys(patch).map((k) => [k, fresh[k as keyof PersistedState]]),
  ) as Partial<PersistedState>;
  const p = storedPayload();
  if (p.kind !== "ok") return memoryOnly(before);
  const back: Partial<PersistedState> = {};
  let owned = false;
  const { article, runs } = plan;
  if (patch.articles && article) {
    const list = p.state.articles;
    if (!Array.isArray(list)) return memoryOnly(before);
    const prev = fresh.articles.find((a) => a.id === article.id);
    const mine = (a: unknown) =>
      isRecord(a) && a.id === article.id && a.commitId === article.commitId;
    if (same(list, patch.articles)) back.articles = fresh.articles;
    else if (prev && list.some(mine)) back.articles = list.map((a) => (mine(a) ? prev : a));
    else back.articles = list as Article[];
    owned ||= back.articles !== list;
  }
  if (patch.workflowRuns) {
    const list = p.state.workflowRuns;
    if (!Array.isArray(list)) return memoryOnly(before);
    const mine = (r: unknown) =>
      isRecord(r) && runs.some((x) => x.id === r.id && x.commitId === r.commitId);
    back.workflowRuns = (
      same(list, patch.workflowRuns) ? fresh.workflowRuns : list.filter((r) => !mine(r))
    ) as WorkflowRun[];
    owned ||= !same(back.workflowRuns, list);
  }
  let ownJournal = false;
  if (patch.cloudJournal) {
    ownJournal = storedJournalIs(patch.cloudJournal as CloudJournal);
    back.cloudJournal = ownJournal ? plan.journal : p.state.cloudJournal;
  }
  if (!owned && !ownJournal) return memoryOnly(back);
  try {
    writeHeld(ownJournal ? "cloudJournal" : "keep", () => useStore.setState(back));
  } catch {
    // The reload that follows shows memory whatever storage kept.
  }
  return true;
}

/**
 * The capture's one locked commit (commitFresh: shared lock, fresh rehydration, one patch, exact combined read-back,
 * rollback that never writes over a newer journal). The synchronous mutate rechecks every dependency (`stale`), then
 * admits the cloud candidates all-or-nothing against the fresh journal. DT-7C-2B-3-R1: success (and any drain) only
 * when storage holds exactly the article, every local run and the journal this commit wrote; a failed read-back puts
 * back only still-owned records (`restoreOwned`).
 */
async function lockedCapture<T extends { kind: string }>(
  fence: CaptureFence,
  deps: (fresh: PersistedState) => string,
  prepared: string,
  plan: (fresh: PersistedState) => CapturePlan | CaptureRefusal,
  done: (p: { runs: WorkflowRun[]; entries: JournalEntry[]; created: readonly string[] }) => T,
): Promise<T | CaptureRefusal> {
  try {
    const r = await commitFresh<T | CaptureRefusal>((fresh) => {
      // DT-7C-2B-4: the configuration/visit/latest-action fence first (the rehydration above may just have moved it).
      if (!captureHolds(fence)) return { result: refusal("stale") };
      if (deps(fresh) !== prepared) return { result: refusal("stale") };
      const out = plan(fresh);
      if ("kind" in out) return { result: out };
      const patch: Partial<PersistedState> = {};
      const proofs: (() => boolean)[] = [];
      let entries: JournalEntry[] = [];
      let created: readonly string[] = [];
      let base: unknown; // the journal slice exactly as storage held it before this commit
      if (out.candidates.length) {
        const j = durableJournal();
        if (!j) return { result: refusal("journal-unreadable") };
        const ad = admitEntries(j, out.candidates, newId());
        if (!ad.ok) return { result: refusal(ad.reason) };
        entries = [...ad.entries];
        created = ad.created;
        if (ad.next !== j) {
          const written = ad.next;
          base = storedJournalSlice();
          patch.cloudJournal = written;
          proofs.push(() => storedJournalIs(written));
        }
      }
      const article = out.article;
      if (article) {
        patch.articles = fresh.articles.map((a) => (a.id === article.id ? article : a));
        proofs.push(() => storedRecordIs("articles", article));
      }
      if (out.runs.length) {
        Object.assign(patch, enqueueRuns(fresh.workflowRuns, out.runs).patch);
        for (const run of out.runs) proofs.push(() => storedRecordIs("workflowRuns", run));
      }
      const result = done({ runs: out.runs, entries, created });
      if (!Object.keys(patch).length) return { result };
      return {
        patch,
        result,
        persisted: () => proofs.every((p) => p()),
        newer: () => restoreOwned(fresh, patch, { article, runs: out.runs, journal: base }),
      };
    });
    return "ok" in r ? refusal(r.reason) : r;
  } catch {
    return refusal("not-persisted");
  }
}

async function captureManual(
  workflowId: string,
  opts: { authority?: CaptureAuthority; articleId?: string },
  now: Date,
): Promise<ManualCaptureResult> {
  // Synchronous capture, before the first await: detached inputs, one occurrence id, one execution instant.
  // DT-7C-2B-3-R1: the caller's Date is read exactly once, here; every member uses this private instant.
  const instant = privateInstant(now);
  const fence = captureFence(`wf:${workflowId}`); // DT-7C-2B-4: captured once, before any await
  const s = useStore.getState();
  const found = s.workflows.find((w) => w.id === workflowId);
  if (!found) return refusal("missing");
  const w = detach(found);
  if (!w.enabled) return refusal("paused", w.id);
  if (workflowIssues(w).length) return refusal("issues", w.id);
  const art = opts.articleId ? s.articles.find((a) => a.id === opts.articleId) : undefined;
  const article = art ? detach(art) : null;
  const authority = opts.authority
    ? authorityOf(opts.authority.origin, opts.authority.ownerKey)
    : null;
  const hasPlan = w.actions.some((a) => a.kind === "plan");
  const deps = (st: PersistedState) =>
    depsOf(
      st,
      st.workflows.filter((x) => x.id === workflowId),
      article?.id ?? null,
      hasPlan,
    );
  const prepared = deps(s);
  const planner: PlannerInputs | null = hasPlan
    ? detach({
        completions: s.completions,
        planItems: s.planItems,
        settings: { gear: s.settings.gear, davinciEdition: s.settings.davinciEdition },
      })
    : null;
  const regs = durableRegistrations();
  const journal = durableJournal();
  const origin = configuredOrigin(s);
  const lang = s.settings.lang;
  const occurrenceId = newId();
  const executionAt = instant().toISOString();

  // Bounded asynchronous preparation.
  const verified = !!regs && (await verifyOwnershipEvidence(regs, [workflowId]));
  if (!captureHolds(fence)) return refusal("stale");
  const own = resolveOwnership({
    workflowId,
    registrations: verified ? regs : null,
    journal,
    configuredOrigin: origin,
  });
  if (own.kind === "blocked") return refusal("blocked", w.id, { cause: own.cause });
  if (own.kind === "local") {
    let input = manualInput(lang, instant());
    if (w.trigger.kind === "article-ready") {
      if (!article || article.status === "archived") return refusal("needs-article", w.id);
      input = articleInput(article, lang, instant());
    }
    const run: WorkflowRun = { ...newRun(w, "manual", input, instant()), id: occurrenceId };
    return lockedCapture<ManualCaptureResult>(
      fence,
      deps,
      prepared,
      () => ({ runs: [run], candidates: [] }),
      () => ({ kind: "local", run }),
    );
  }
  if (w.trigger.kind !== "manual") return refusal("manual-on-ready", w.id);
  const member = await cloudMember({
    workflow: w,
    own,
    authority,
    origin,
    occurrenceId,
    executionAt,
    lang,
    planner,
  });
  if (!captureHolds(fence)) return refusal("stale");
  if ("kind" in member) return member;
  return lockedCapture<ManualCaptureResult>(
    fence,
    deps,
    prepared,
    () => ({ runs: [], candidates: [member.candidate] }),
    ({ entries, created }) => ({
      kind: "cloud",
      entry: captureView(entries[0]),
      created: created.length === 1,
    }),
  );
}

async function captureReady(
  articleId: string,
  opts: { authority?: CaptureAuthority },
  now: Date,
): Promise<ReadyCaptureResult> {
  const instant = privateInstant(now); // DT-7C-2B-3-R1: read once, before any await
  const fence = captureFence(`article:${articleId}`); // DT-7C-2B-4: captured once, before any await
  const s = useStore.getState();
  const found = s.articles.find((a) => a.id === articleId);
  if (!found) return refusal("missing");
  const a = detach(found);
  if (a.status === "ready") {
    // Already ready: a no-op, never a new event (proven against the fresh state, nothing written).
    try {
      const r = await commitFresh<ReadyCaptureResult>((fresh) => {
        const cur = fresh.articles.find((x) => x.id === articleId);
        return {
          result:
            cur && cur.commitId === a.commitId && cur.status === "ready"
              ? { kind: "unchanged", article: cur }
              : refusal("stale"),
        };
      });
      return "ok" in r ? refusal(r.reason) : r;
    } catch {
      return refusal("not-persisted");
    }
  }
  if (a.status === "archived") return refusal("archived");
  if (articleIssues(a, s.articles).length) return refusal("issues");
  // Synchronous capture: the prospective Ready commit (its id names every cloud occurrence), members, inputs.
  const at = instant().toISOString();
  const article: Article = {
    ...a,
    status: "ready",
    revision: a.revision + 1,
    commitId: newId(),
    updatedAt: at,
  };
  const members = detach(readyMembers(s));
  const hasPlan = members.some((w) => w.actions.some((x) => x.kind === "plan"));
  const deps = (st: PersistedState) => depsOf(st, readyMembers(st), articleId, hasPlan);
  const prepared = deps(s);
  const planner: PlannerInputs | null = hasPlan
    ? detach({
        completions: s.completions,
        planItems: s.planItems,
        settings: { gear: s.settings.gear, davinciEdition: s.settings.davinciEdition },
      })
    : null;
  const authority = opts.authority
    ? authorityOf(opts.authority.origin, opts.authority.ownerKey)
    : null;
  const regs = durableRegistrations();
  const journal = durableJournal();
  const origin = configuredOrigin(s);
  const lang = s.settings.lang;
  const ids = members.map((w) => w.id);

  const verified = !!regs && (await verifyOwnershipEvidence(regs, ids));
  if (!captureHolds(fence)) return refusal("stale");
  const runs: WorkflowRun[] = [];
  const candidates: Candidate[] = [];
  for (const w of members) {
    const own = resolveOwnership({
      workflowId: w.id,
      registrations: verified ? regs : null,
      journal,
      configuredOrigin: origin,
    });
    if (own.kind === "blocked") return refusal("blocked", w.id, { cause: own.cause });
    if (own.kind === "local") {
      runs.push(newRun(w, "article-ready", articleInput(article, lang, instant()), instant()));
      continue;
    }
    const occurrenceId = await readyOccurrenceId(w.id, article.id, article.commitId);
    if (!captureHolds(fence)) return refusal("stale");
    const member = await cloudMember({
      workflow: w,
      own,
      authority,
      origin,
      occurrenceId,
      executionAt: at,
      lang,
      article,
      planner,
    });
    if (!captureHolds(fence)) return refusal("stale");
    if ("kind" in member) return member;
    candidates.push(member.candidate);
  }
  const r = await lockedCapture<ReadyCaptureResult>(
    fence,
    deps,
    prepared,
    (fresh) => {
      const cur = fresh.articles.find((x) => x.id === articleId);
      if (!cur || articleIssues(cur, fresh.articles).length) return refusal("issues");
      return { article, runs, candidates };
    },
    ({ entries }) => ({ kind: "ready", article, runs, entries: entries.map(captureView) }),
  );
  if (r.kind === "ready" && r.runs.length) void useStore.getState().drainWorkflowRuns();
  return r;
}

/** The kit commit id the shared storage holds (read back, never assumed). */
function storedKitCommit(): string | undefined {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")?.state?.businessKit
      ?.commitId;
  } catch {
    return undefined;
  }
}

const KIT_FIELDS = [
  "tagline",
  "bio",
  "contact",
  "services",
  "rateCard",
  "pastWork",
  "featuredPlatforms",
  "estimator",
] as const;
const sameKit = (a: BusinessKit, b: BusinessKit) =>
  KIT_FIELDS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
const DEAL_FIELDS = [
  "brand",
  "contact",
  "stage",
  "deliverable",
  "valueSar",
  "notes",
  "replyDraft",
] as const;
const sameDeal = (a: BrandDeal, b: BrandDeal) =>
  DEAL_FIELDS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/** One deal written through commitFresh, proven by its commit id. */
function commitDeal(
  mutate: (fresh: BrandDeal[]) => { deals: BrandDeal[]; deal: BrandDeal } | BrandDealResult,
): Promise<BrandDealResult> {
  return commitFresh<BrandDealResult>((state) => {
    const out = mutate(state.brandDeals);
    if (!("deals" in out)) return { result: out };
    const { deal } = out;
    return {
      patch: { brandDeals: out.deals },
      result: { ok: true, deal },
      persisted: () => storedCommit("brandDeals", deal.id) === deal.commitId,
    };
  });
}

/** A deal edit under its base: stale base → conflict, invalid → invalid, identical → unchanged. */
function editDeal(
  id: string,
  patch: BrandDealPatch,
  base: BusinessBase,
  now: Date,
): Promise<BrandDealResult> {
  return commitDeal((fresh) => {
    const existing = fresh.find((d) => d.id === id);
    if (!existing) return { ok: false, reason: "missing" };
    if (base.generation !== articlesGen || base.commitId !== existing.commitId)
      return { ok: false, reason: "conflict" };
    const parsed = BrandDealSchema.safeParse({ ...existing, ...patch });
    if (!parsed.success) return { ok: false, reason: "invalid" };
    if (sameDeal(parsed.data, existing)) return { deals: fresh, deal: existing };
    const deal = { ...parsed.data, commitId: newId(), updatedAt: now.toISOString() };
    return { deals: fresh.map((d) => (d.id === id ? deal : d)), deal };
  });
}

const RUNS_MAX = 200;
const FINISHED = new Set<WorkflowRun["status"]>(["done", "partial", "failed"]);

type WorkflowFault = (run: WorkflowRun, action: WorkflowAction) => string | undefined;
let workflowFault: WorkflowFault | undefined;
/** Test seam: make a step fail with the returned error (the executor's failure and retry paths). */
export function setWorkflowFault(fault: WorkflowFault | undefined): void {
  workflowFault = fault;
}

/** The base an editor captures from the workflow it shows (articles generation: import/reset fence). */
export const workflowBase = (w: Pick<Workflow, "commitId">): WorkflowBase => ({
  commitId: w.commitId,
  generation: articlesGen,
});

const sameWorkflow = (a: Workflow, b: Workflow) =>
  (["name", "trigger", "actions"] as const).every(
    (k) => JSON.stringify(a[k]) === JSON.stringify(b[k]),
  );

/** A queued run that captured the workflow and its input now. */
function newRun(
  workflow: Workflow,
  kind: WorkflowRun["kind"],
  input: WorkflowRun["snapshot"]["input"],
  now: Date,
): WorkflowRun {
  const at = now.toISOString();
  return {
    id: newId(),
    workflowId: workflow.id,
    kind,
    status: "queued",
    attempt: 1,
    commitId: newId(),
    startedAt: at,
    updatedAt: at,
    snapshot: { workflow, input },
    steps: workflow.actions.map((a) => ({ actionId: a.id, status: "pending" })),
  };
}

/** Append runs (pruning the oldest finished beyond RUNS_MAX) with the read-back of every new run's commit. */
function enqueueRuns(list: readonly WorkflowRun[], added: readonly WorkflowRun[]): FreshExtra {
  const runs = [...list, ...added];
  while (runs.length > RUNS_MAX) {
    const i = runs.findIndex((r) => FINISHED.has(r.status));
    if (i < 0) break;
    runs.splice(i, 1);
  }
  return {
    patch: { workflowRuns: runs },
    persisted: () => added.every((r) => storedCommit("workflowRuns", r.id) === r.commitId),
  };
}

/**
 * One executor step on the fresh state: the next pending step of the first queued or running run (a run another tab,
 * or this page before a reload, left mid-way resumes here: steps are atomic and idempotent under the one lock). Its
 * output and receipt go out in one patch; an output that already exists under the deterministic id is adopted, never
 * created twice. The run's new commit id is the read-back proof (an existing output is not).
 */
function drainStep(fresh: PersistedState, now: Date): FreshCommit<{ ok: true; stepped: boolean }> {
  const run = fresh.workflowRuns.find((r) => r.status === "queued" || r.status === "running");
  if (!run) return { result: { ok: true, stepped: false } };
  const at = now.toISOString();
  const patch: Partial<PersistedState> = {};
  const steps = [...run.steps];
  const i = steps.findIndex((s) => s.status === "pending");
  if (i >= 0) {
    const { actionId } = steps[i];
    const action = run.snapshot.workflow.actions.find((a) => a.id === actionId);
    const outputId = workflowOutputId(run.id, actionId);
    const list =
      action?.kind === "idea"
        ? fresh.ideas
        : action?.kind === "post"
          ? fresh.posts
          : fresh.planItems;
    // Duplicate ids would make two steps share one output: fail before any output (Amendment B).
    const dup = duplicateActionIds(run.snapshot.workflow.actions).length > 0;
    if (!dup && action && list.some((x) => x.id === outputId)) {
      steps[i] = { actionId, status: "done", outputKind: action.kind, outputId, at };
    } else {
      const fault = action && workflowFault?.(run, action);
      const out = dup
        ? ({ ok: false, error: "action-duplicate-id" } as const)
        : !action
          ? ({ ok: false, error: "invalid" } as const)
          : fault
            ? ({ ok: false, error: fault } as const)
            : buildOutput(run.id, action, run.snapshot.input, fresh, now);
      if (out.ok) {
        if (out.kind === "idea") patch.ideas = [...fresh.ideas, out.record];
        else if (out.kind === "post") patch.posts = [...fresh.posts, out.record];
        else patch.planItems = [...fresh.planItems, out.record];
        steps[i] = { actionId, status: "done", outputKind: out.kind, outputId, at };
      } else {
        steps[i] = { actionId, status: "failed", error: out.error.slice(0, 300), at };
        for (let j = i + 1; j < steps.length; j++)
          if (steps[j].status === "pending")
            steps[j] = { actionId: steps[j].actionId, status: "skipped", at };
      }
    }
  }
  const pending = steps.some((s) => s.status === "pending");
  const status: WorkflowRun["status"] = pending
    ? "running"
    : steps.every((s) => s.status === "done")
      ? "done"
      : steps.some((s) => s.status === "done")
        ? "partial"
        : "failed";
  const next: WorkflowRun = {
    ...run,
    steps,
    status,
    commitId: newId(),
    updatedAt: at,
    ...(pending ? {} : { finishedAt: at }),
  };
  patch.workflowRuns = fresh.workflowRuns.map((r) => (r.id === run.id ? next : r));
  return {
    patch,
    result: { ok: true, stepped: true },
    persisted: () => storedCommit("workflowRuns", run.id) === next.commitId,
  };
}

/** The next free `<slug>-2`, `-3`… among other active articles (at most 80 characters). */
function freeSlug(slug: string, others: readonly Article[]): string {
  const taken = new Set(others.map((a) => a.slug));
  const root = slug.replace(/-\d+$/, "") || slug;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const next = `${root.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(next)) return next;
  }
}

const gemEvent = (amount: number, at: string, reason: GemReason, refId?: string): GemEvent => ({
  id: newId(),
  amount,
  at,
  reason,
  ...(refId ? { refId } : {}),
});

const pick = (s: PersistedState): PersistedState => ({
  settings: s.settings,
  completions: s.completions,
  xpEvents: s.xpEvents,
  microActions: s.microActions,
  freezesUsedOn: s.freezesUsedOn,
  reviews: s.reviews,
  savedRefs: s.savedRefs,
  inspirations: s.inspirations,
  followedFormats: s.followedFormats,
  formatObservations: s.formatObservations,
  formatQueue: s.formatQueue,
  discoverCandidates: s.discoverCandidates,
  discoverLibraryEpoch: s.discoverLibraryEpoch,
  discoverLibraryPendingReplacement: s.discoverLibraryPendingReplacement,
  discoverFeedback: s.discoverFeedback,
  recentTopics: s.recentTopics,
  notes: s.notes,
  gemEvents: s.gemEvents,
  chestsOpened: s.chestsOpened,
  focus: s.focus,
  focusSessions: s.focusSessions,
  bonusFreezes: s.bonusFreezes,
  badges: s.badges,
  bossesDefeated: s.bossesDefeated,
  seasonsFinished: s.seasonsFinished,
  drills: s.drills,
  planItems: s.planItems,
  rewards: s.rewards,
  purchases: s.purchases,
  posts: s.posts,
  ideas: s.ideas,
  socialSnapshots: s.socialSnapshots,
  audienceAsks: s.audienceAsks,
  socialAccounts: s.socialAccounts,
  socialPostStats: s.socialPostStats,
  demographics: s.demographics,
  socialSeedApplied: s.socialSeedApplied,
  socialSync: s.socialSync,
  trends: s.trends,
  customGenres: s.customGenres,
  articles: s.articles,
  workflows: s.workflows,
  workflowRuns: s.workflowRuns,
  businessKit: s.businessKit,
  brandDeals: s.brandDeals,
  inboxDrafts: s.inboxDrafts,
  inboxSendOps: s.inboxSendOps,
  inboxThreadsSendOps: s.inboxThreadsSendOps,
  inboxInstagramSendOps: s.inboxInstagramSendOps,
  inboxInstagramDmSendOps: s.inboxInstagramDmSendOps,
  inboxInstagramDmControls: s.inboxInstagramDmControls,
  cloudJournal: s.cloudJournal,
  cloudRegistrations: s.cloudRegistrations,
  cloudReconciliation: s.cloudReconciliation,
  inboxSeen: s.inboxSeen,
  inboxTab: s.inboxTab,
});

/** Localize without importing lib/i18n (which imports this store). */
const L = (lang: Settings["lang"], text: LText): string => text[lang] || text.ar;

/** In-memory fallback so the store works during SSR / static export and when storage is blocked. */
const memoryStorage = (): StateStorage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

const safeLocalStorage = (): StateStorage => {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Access can throw in private mode or when site data is blocked.
  }
  return memoryStorage();
};

type LocalPersistedState = Omit<PersistedState, "discoverCandidates"> & {
  discoverCandidates?: PersistedState["discoverCandidates"];
};
let discoveryLibrary: ReturnType<typeof createDiscoverLibrary> | undefined;
function candidateLibrary() {
  return (discoveryLibrary ??= createDiscoverLibrary(indexedDiscoverLibrary(), {
    current: () => useStore.getState().discoverCandidates,
    epoch: () => useStore.getState().discoverLibraryEpoch,
    pendingReplacement: () => useStore.getState().discoverLibraryPendingReplacement,
    apply: (discoverCandidates, epoch) => {
      if (discoverCandidates !== useStore.getState().discoverCandidates || epoch !== undefined)
        useStore.setState({
          discoverCandidates,
          ...(epoch !== undefined ? { discoverLibraryEpoch: epoch } : {}),
        });
    },
    status: (discoverLibraryStatus) =>
      useStore.setState({
        discoverLibraryStatus,
        ...(discoverLibraryStatus === "ready" ? { discoverLibraryPendingReplacement: false } : {}),
      }),
  }));
}
/* ---------- DT-7C-2A-R1: every write of the store key is serialized under `3z-prod-articles` ---------- */

/** Whether this tab's latest ordinary save reached storage (not persisted itself). Settings shows a failure. */
export const saveStatus = create<{ failed?: "unreadable" | "not-persisted" }>(() => ({}));

/** Opaque slices, parsed strictly by their own readers (DT-7C-2A journal, DT-7C-2B-2 registrations). */
const OPAQUE = ["cloudJournal", "cloudRegistrations", "cloudReconciliation"] as const;
type Opaque = (typeof OPAQUE)[number];

/**
 * The opaque slices a write that does not author them carries: exactly what storage holds now (absent stays absent),
 * or null when storage is unreadable or any of their bytes would not be written back byte for byte.
 */
function storedOpaqueBytes(p = storedPayload()): Partial<Record<Opaque, unknown>> | null {
  if (p.kind === "none")
    return {
      cloudJournal: undefined,
      cloudRegistrations: undefined,
      cloudReconciliation: undefined,
    };
  if (p.kind === "unreadable") return null;
  const out: Partial<Record<Opaque, unknown>> = {};
  for (const k of OPAQUE) {
    const v = p.state[k];
    if (v !== undefined && !p.raw.includes(`"${k}":${JSON.stringify(v)}`)) return null;
    out[k] = v;
  }
  return out;
}

/**
 * A locked commit, reset or restore writing its own patch or rollback (synchronously, inside the lock it holds):
 * `all` writes memory as is (a reset/restore authors every slice, read back exactly); an opaque slice's name authors
 * that slice and keeps the other opaque slice's stored bytes; `keep` keeps every opaque slice's stored bytes;
 * `memory` writes nothing (memory goes back to what storage holds).
 */
type HeldWrite = "all" | Opaque | readonly Opaque[] | "keep" | "memory";
let heldWrite: HeldWrite | null = null;
function writeHeld(mode: HeldWrite, write: () => void): void {
  const prev = heldWrite;
  heldWrite = mode;
  try {
    write();
  } finally {
    heldWrite = prev;
  }
}

const localJsonStorage = createJSONStorage<LocalPersistedState>(safeLocalStorage);
let savePending = false;
let saveQueued: Promise<void> | null = null;
/**
 * DT-7C-2A-R2: the base of this tab's ordinary save's three-way merge, taken whenever memory and storage last agreed (at
 * creation, after every completed rehydrate, after every write this tab makes): `mem` = memory then (what this tab's
 * changes are measured against), `raw` = what storage held then (what other tabs' changes are measured against; the
 * two differ by the schema defaults memory fills in).
 */
type Rec = Record<string, unknown>;
let saveBase: { mem: Rec; raw: Rec } = { mem: {}, raw: {} };
/**
 * DT-7C-2A-C1: what the newest hydration saw in its ONE storage read (`none`: no save at all; `raw`: the exact payload
 * its `merge` accepted), so its base pairs memory with the bytes that produced it, never with a later read. A new
 * slot at every hydration start: an older, overlapping hydration can never fill or consume a newer one's (zustand runs
 * `merge` and the finish listeners only for the newest).
 */
let hydration: { none?: boolean; raw?: Rec } = {};

/* DT-7C-2A-R2: slices only `3z-prod-articles` holders write (field-ownership inventory in the handoff). An ordinary save
 * writes them exactly as storage holds them, never from memory. */
const LOCKED_ONLY = new Set<string>([
  "articles",
  "workflows",
  "workflowRuns",
  "businessKit",
  "brandDeals",
  "inboxDrafts",
  "inboxSendOps",
  "inboxThreadsSendOps",
  "inboxInstagramSendOps",
  "inboxInstagramDmSendOps",
  "inboxInstagramDmControls",
  "cloudJournal",
  "cloudRegistrations",
  "cloudReconciliation",
]);
/** The reset/import generation fence: a newer epoch in storage brings its pending flag with it. */
const GENERATION = ["discoverLibraryEpoch", "discoverLibraryPendingReplacement"];

/** Canonical JSON (sorted keys, undefined members dropped): equality as storage sees it. */
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : isRecord(v)
      ? `{${Object.keys(v)
          .filter((k) => v[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
          .join(",")}}`
      : (JSON.stringify(v) ?? "undefined");
const same = (a: unknown, b: unknown) => a === b || canon(a) === canon(b);

/**
 * DT-7C-2A-C1: each persisted list's logical identity, taken from its own actions and helpers (inventory in the
 * handoff), by path (`savedRefs.*` = every skill's list). `key`: rows match by it and merge whole (both tabs changed
 * one logical row → this tab's row, never a field mix of two rows); `group`: all rows with one key are one member (a
 * demographic import replaces its platform/day/dimension group whole); `whole`: the list is one value; `normalize`: the
 * field's own schema/helper then keeps one row per its identity under its revision, date, evidence and cap rules.
 * DT-7C-2A-C1-R1: a `normalize` list is also a `group` list keyed by that same identity, so MEMBERSHIP (added / removed
 * here / removed in storage / kept) is decided on the logical row before the helper sees it: a row the other side removed
 * stays removed however this tab edited it; a surviving identity's rows (both tabs' versions when both changed it) go to
 * the unchanged helper, which alone picks the winner. Unlisted lists: an element's `id`, else its value (set-like
 * primitives).
 */
type ListPolicy = {
  key?: (row: Rec) => string;
  group?: true;
  whole?: true;
  normalize?: (list: unknown[]) => unknown[];
};
/** An identity part that must be a string (a malformed row throws and so keeps its content identity). */
const idPart = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("not a string identity");
  return v;
};
/** The URL as the helpers' schemas store it. */
const idUrl = (v: unknown): string => {
  const url = canonicalDiscoverVisualUrl(idPart(v));
  if (!url) throw new Error("not a canonical URL");
  return url;
};
const POLICY: Record<string, ListPolicy> = {
  socialAccounts: { key: (a) => String(a.platform) },
  socialSnapshots: { key: (s) => `${String(s.platform)}|${String(s.day)}` },
  socialPostStats: { key: (p) => `${String(p.platform)}|${String(p.postId)}` },
  demographics: {
    key: (d) => `${String(d.platform)}|${String(d.day)}|${String(d.dimension)}`,
    group: true,
  },
  completions: { key: (c) => `${String(c.skillId)}|${String(c.quest)}` },
  reviews: { key: (r) => String(r.week) },
  drills: { key: (d) => String(d.skillId) },
  "savedRefs.*": { key: (r) => canonicalRefUrl((r as Ref).platform, (r as Ref).url) },
  inspirations: { key: (e) => inspirationKey(e.ref as Ref) },
  followedFormats: { key: (e) => formatIdentity(e.format as EditFormat) },
  "trends.sources": { key: (s) => String(s.name) },
  recentTopics: { whole: true },
  // Identities mirror each helper's own: observations `target.key` + URL; the queue's full target snapshot + URL;
  // feedback's creator hide per creator, every other vote per genre + platform + post; candidates genre + platform + URL.
  formatObservations: {
    key: (o) => `${idPart((o.target as Rec).key)}\n${idUrl(o.url)}`,
    group: true,
    normalize: (l) => FormatObservationsSchema.parse(l),
  },
  formatQueue: {
    key: (q) =>
      `${formatTargetId(q.target as FormatVerificationTarget) ?? idPart(undefined)}\n${idUrl(q.url)}`,
    group: true,
    normalize: (l) => FormatQueueSchema.parse(l),
  },
  discoverFeedback: {
    key: (f) => {
      const platform = f.platform as Parameters<typeof discoverPostKey>[0];
      if (f.action === "hide-creator")
        return `creator:${discoverCreatorKey(platform, idPart(f.creator)) ?? idPart(undefined)}`;
      const url = idPart(f.url);
      return `post:${typeof f.genreId === "string" ? f.genreId : ""}:${platform}:${discoverPostKey(platform, url) ?? url}`;
    },
    group: true,
    normalize: (l) => DiscoverFeedbackListSchema.parse(l),
  },
  discoverCandidates: {
    key: (c) => {
      const item = c.item as Rec;
      return `${idPart(c.genreId)}\n${idPart(item.platform)}\n${idPart(item.url)}`;
    },
    group: true,
    normalize: (l) => localDiscoverCandidateFallback(DiscoverCandidatesSchema.parse(l)),
  },
};

/** A list as a map by element identity (its policy key, else an object's `id`, else its content); null unless every
 * key is unique (a `group` collects its rows instead). */
function byKey(list: unknown, policy?: ListPolicy): Map<string, unknown> | null {
  if (!Array.isArray(list)) return null;
  const m = new Map<string, unknown>();
  for (const x of list) {
    const k = rowKey(x, policy?.key);
    if (policy?.group) m.set(k, [...((m.get(k) as unknown[] | undefined) ?? []), x]);
    else if (m.has(k)) return null;
    else m.set(k, x);
  }
  return m;
}
function rowKey(x: unknown, key?: (row: Rec) => string): string {
  if (!isRecord(x)) return canon(x);
  if (key)
    try {
      return `key:${key(x)}`;
    } catch {
      // A malformed row keeps its content identity.
    }
  return typeof x.id === "string" ? `id:${x.id}` : canon(x);
}

/** One member (key or list element) present in any of the four; undefined = leave it out. `whole`: merged as one
 * value (a natural-key row or group); `helper`: a normalized list's identity, whose two competing versions both go to the
 * field's helper. */
function mergeMember(
  mem: unknown,
  raw: unknown,
  ours: unknown,
  fresh: unknown,
  path: string,
  policy?: ListPolicy,
  whole: boolean | "helper" = false,
): unknown {
  // Removed here: gone, unless storage changed it meanwhile (a locked update is never dropped).
  if (mem !== undefined && ours === undefined) return same(fresh, raw) ? undefined : fresh;
  // Removed in storage (a locked deletion, a reset): never resurrected, even if this tab changed it.
  if (raw !== undefined && fresh === undefined) return undefined;
  if (whole === "helper" && !same(ours, mem) && !same(fresh, raw))
    return [...(fresh as unknown[]), ...(ours as unknown[])]; // both changed it: the helper decides by its own rule
  if (whole) return same(ours, mem) ? fresh : ours;
  return merge3(mem, raw, ours, fresh, path, policy);
}

/**
 * Three-way merge: only this tab's own changes (ours vs its base `mem`) are applied onto what storage holds (fresh, vs
 * its base `raw`). Records merge per key and lists per element identity, recursively, so another tab's change to a
 * different key, element or field survives. ponytail: a value both sides changed that is not a record or a keyed list
 * is last-writer-wins (ours), and a list both sides changed keeps storage's order with this tab's additions appended.
 */
function merge3(
  mem: unknown,
  raw: unknown,
  ours: unknown,
  fresh: unknown,
  path = "",
  policy?: ListPolicy,
): unknown {
  if (same(ours, mem)) return fresh;
  if (same(fresh, raw) || same(fresh, ours) || policy?.whole) return ours;
  const or = (v: unknown, empty: unknown) => (v === undefined ? empty : v); // absent = empty
  const [m, r] = [or(mem, {}), or(raw, {})];
  if (isRecord(m) && isRecord(r) && isRecord(ours) && isRecord(fresh)) {
    const out: Rec = {};
    for (const k of new Set([...Object.keys(fresh), ...Object.keys(ours)])) {
      const child = `${path}.${k}`;
      const v = mergeMember(
        m[k],
        r[k],
        ours[k],
        fresh[k],
        child,
        POLICY[child] ?? POLICY[`${path}.*`],
      );
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  const [bm, br, o, f] = [or(mem, []), or(raw, []), ours, fresh].map((l) => byKey(l, policy));
  if (!bm || !br || !o || !f) return ours;
  const merged = (k: string) =>
    mergeMember(
      bm.get(k),
      br.get(k),
      o.get(k),
      f.get(k),
      `${path}[]`,
      undefined,
      policy?.normalize ? "helper" : !!policy?.key,
    );
  const list = [...f.keys(), ...[...o.keys()].filter((k) => !f.has(k))]
    .map(merged)
    .filter((v) => v !== undefined);
  const rows = policy?.group ? (list as unknown[][]).flat() : list;
  return policy?.normalize ? policy.normalize(rows) : rows;
}

/**
 * DT-7C-2A-R2: what an ordinary save writes over a readable stored state. Exclusively locked slices are storage's,
 * verbatim (a journal absent stays absent); a newer reset/import generation in storage is kept; every other slice is
 * the three-way merge of this tab's changes onto storage's. A slice storage does not hold at all is memory's.
 */
function mergeSave(ours: LocalPersistedState, fresh: Rec): LocalPersistedState {
  const { mem, raw } = saveBase;
  const mine = ours as Rec;
  const newGeneration =
    fresh.discoverLibraryEpoch !== undefined &&
    !same(fresh.discoverLibraryEpoch, raw.discoverLibraryEpoch);
  const out: Rec = {};
  for (const k of Object.keys(mine))
    out[k] =
      LOCKED_ONLY.has(k) || (newGeneration && GENERATION.includes(k))
        ? k in fresh || (OPAQUE as readonly string[]).includes(k)
          ? fresh[k]
          : mine[k]
        : fresh[k] === undefined
          ? mine[k]
          : merge3(mem[k], raw[k], mine[k], fresh[k], k, POLICY[k]);
  return out as LocalPersistedState;
}

/**
 * This tab's pending ordinary save, run synchronously by whoever holds the lock: the LATEST memory (not a snapshot from
 * when it was asked for; several asks are one write), merged onto what storage holds now (`mergeSave`: other tabs'
 * locked commits, deletions and resets are kept; the journal bytes are storage's, never memory's). Unreadable storage
 * is never written over: the save is refused and `saveStatus` says so. When the write took anything from storage,
 * memory reloads it (and with it the base).
 */
function runPendingSave(): void {
  if (!savePending || !localJsonStorage) return;
  savePending = false;
  const p = storedPayload();
  if (!storedOpaqueBytes(p)) return saveStatus.setState({ failed: "unreadable" }, true);
  const ours = pickLocal(useStore.getState());
  const state =
    p.kind === "ok"
      ? withDeletionEvidence(p.state, mergeSave(ours, p.state))
      : ({
          ...ours,
          cloudJournal: undefined,
          cloudRegistrations: undefined,
          cloudReconciliation: undefined,
        } as LocalPersistedState);
  try {
    localJsonStorage.setItem(STORAGE_KEY, { state, version: STORE_VERSION });
    saveStatus.setState({}, true);
  } catch {
    saveStatus.setState({ failed: "not-persisted" }, true);
    return;
  }
  const took = (Object.keys(state) as (keyof LocalPersistedState)[]).some(
    (k) => !same(state[k], ours[k]),
  );
  if (took) void useStore.persist.rehydrate();
  else saveBase = { mem: ours, raw: state };
}

/** Resolves once this tab's queued ordinary saves have run (tests; before a durable reload). */
export async function savesSettled(): Promise<void> {
  while (saveQueued) await saveQueued;
}

/**
 * DT-7C-2A-R1 (planner ruling 1): EVERY persist write of the store key passes through here. Ordinary saves never author
 * journal bytes and never write outside the shared lock: memory changes at once, and the write is a queued, coalesced
 * task that, holding `3z-prod-articles`, reads storage fresh and writes the latest memory's own changes merged onto it,
 * with every locked slice and the journal bytes verbatim (`runPendingSave`, DT-7C-2A-R2), so a commit another tab
 * proved meanwhile can never be erased. A save asked for
 * inside a locked callback just queues behind it (nothing awaits the lock from inside a hold). Locked commits, resets
 * and restores write their own patch synchronously (`writeHeld`). Without Web Locks no tab can lock-commit a journal,
 * so an ordinary save writes at once, still with the stored journal bytes. Server render: memory only.
 * ponytail: a queued save is lost if the tab closes before the lock is granted (milliseconds unless another holder is
 * slow); flushing on pagehide would need an unlocked write, which is exactly what this forbids.
 */
function serializedStorage(
  inner: PersistStorage<LocalPersistedState> | undefined,
): PersistStorage<LocalPersistedState> | undefined {
  if (!inner) return inner;
  return {
    ...inner,
    getItem: (name) => {
      const slot = hydration;
      const value = inner.getItem(name);
      if (name === STORAGE_KEY) slot.none = value === null;
      return value;
    },
    setItem: (name, value) => {
      if (name !== STORAGE_KEY || typeof window === "undefined") return inner.setItem(name, value);
      if (heldWrite === "memory") return;
      if (heldWrite) {
        let state = value.state;
        if (heldWrite !== "all") {
          const kept = storedOpaqueBytes();
          if (!kept) throw new Error("Stored payload is unreadable");
          // DT-7C-2C: a commit may author several opaque slices at once (a retirement: proof + journal).
          const authored: readonly string[] =
            heldWrite === "keep" ? [] : typeof heldWrite === "string" ? [heldWrite] : heldWrite;
          for (const k of OPAQUE)
            if (!authored.includes(k)) state = { ...state, [k]: kept[k] } as LocalPersistedState;
        }
        inner.setItem(name, { ...value, state });
        saveBase = { mem: value.state, raw: state }; // DT-7C-2A-R2: later saves diff against this
        return;
      }
      savePending = true;
      const lock = rawArticlesLock();
      if (!lock) return runPendingSave();
      saveQueued ??= lock(async () => {
        saveQueued = null;
        runPendingSave();
      }).catch(() => {
        saveQueued = null;
        if (savePending) saveStatus.setState({ failed: "not-persisted" }, true);
      });
    },
  };
}

function pickLocal(state: StoreState): LocalPersistedState {
  const { discoverCandidates, ...progress } = pick(state);
  return discoveryLibrary?.durable()
    ? progress
    : { ...progress, discoverCandidates: localDiscoverCandidateFallback(discoverCandidates) };
}
/** Wait before exporting or testing a durable reload; this never calls a provider. */
export function flushDiscoverLibrary(): Promise<void> {
  return candidateLibrary().flush();
}

/**
 * One-time shape migration: a save from before `apiKeys` existed had a flat `settings.youtubeApiKey`.
 * Move it into `settings.apiKeys.youtube` before validating, so older exports/localStorage still work.
 */
function migrateLegacySettings(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const root = raw as { settings?: unknown };
  if (!root.settings || typeof root.settings !== "object") return raw;
  const settings = root.settings as Record<string, unknown>;
  const legacyKey = settings.youtubeApiKey;
  if (typeof legacyKey !== "string") return raw;
  const rest: Record<string, unknown> = { ...settings };
  delete rest.youtubeApiKey;
  const apiKeys = (rest.apiKeys as Record<string, unknown> | undefined) ?? {};
  return { ...root, settings: { ...rest, apiKeys: { ...apiKeys, youtube: legacyKey } } };
}

/* ---------- Internal helpers shared by the XP-changing actions ---------- */

interface Snapshot {
  xp: number;
  gems: number;
  chestsPending: number;
  dayDone: boolean;
}

function snapshot(s: PersistedState, today: string): Snapshot {
  return {
    xp: totalXp(s),
    gems: gems(s),
    chestsPending: chestProgress(s).pending,
    dayDone: flowState(s, today).dayDone,
  };
}

function baseOutcome(s: PersistedState): XpOutcome {
  const xp = totalXp(s);
  return {
    xp: 0,
    gems: 0,
    levelBefore: levelFromXp(xp),
    levelAfter: levelFromXp(xp),
    rankStepBefore: rankFromXp(xp).step,
    rankStepAfter: rankFromXp(xp).step,
    badges: [],
    bossDefeated: false,
    seasonDone: false,
    chestReady: false,
    dayDone: false,
  };
}

/**
 * After the main change of an action: hand out day-complete, boss, season and badge rewards that the change
 * unlocked. Returns the new persisted fields and what was unlocked.
 */
function settle(
  s: PersistedState,
  now: Date,
): {
  patch: Partial<PersistedState>;
  badges: Badge[];
  bossDefeated: boolean;
  seasonDone: boolean;
} {
  const at = now.toISOString();
  const today = dayKey(now);
  const gemEvents = [...s.gemEvents];
  let bossesDefeated = s.bossesDefeated;
  let seasonsFinished = s.seasonsFinished;

  // ③ day complete → +5 gems once per Riyadh day.
  if (
    flowState(s, today).dayDone &&
    !gemEvents.some((e) => e.reason === "dayComplete" && e.refId === today)
  ) {
    gemEvents.push(gemEvent(GEM_RULES.dayComplete, at, "dayComplete", today));
  }

  // Monthly boss: celebrate the month once.
  const bs = bossState(s.xpEvents, now);
  const bossDefeated = bs.defeated && !bossesDefeated.includes(bs.month);
  if (bossDefeated) {
    bossesDefeated = [...bossesDefeated, bs.month];
    gemEvents.push(gemEvent(GEM_RULES.boss, at, "boss", bs.month));
  }

  // Season target: record the occurrence once.
  const ss = seasonState(s.completions, now);
  const seasonDone = ss.done && !seasonsFinished.includes(ss.key);
  if (seasonDone) {
    seasonsFinished = [...seasonsFinished, ss.key];
    gemEvents.push(gemEvent(GEM_RULES.season, at, "season", ss.key));
  }

  // Badges (see the counters above first, so boss-slayer / season-finisher fire in the same call).
  const ctx = badgeContext({ ...s, bossesDefeated, seasonsFinished }, now);
  const earned = newBadges(ctx, s.badges);
  const badges = earned.length ? [...s.badges, ...earned.map((b) => ({ id: b.id, at }))] : s.badges;
  for (const b of earned) gemEvents.push(gemEvent(GEM_RULES.badge, at, "badge", b.id));

  return {
    patch: { gemEvents, bossesDefeated, seasonsFinished, badges },
    badges: earned,
    bossDefeated,
    seasonDone,
  };
}

function badgeContext(s: PersistedState, now: Date): BadgeContext {
  const programLevels: Record<string, number> = {};
  for (const p of programs) programLevels[p.id] = levelFromXp(programXp(s, p.id));
  const pillarLevels: Record<string, number> = {};
  for (const p of pillars) pillarLevels[p.id] = levelFromXp(pillarXp(s, p.id));
  return {
    completions: s.completions,
    microActions: s.microActions,
    xpEvents: s.xpEvents,
    streak: computeStreak(activeDays(s), new Set(s.freezesUsedOn), now),
    masteredSkillIds: masteredSkillIds(s),
    programLevels,
    pillarLevels,
    chestsOpened: s.chestsOpened,
    focusSessions: s.focusSessions,
    reviews: s.reviews,
    bossesDefeated: s.bossesDefeated,
    seasonsFinished: s.seasonsFinished,
    now,
  };
}

/** Outcome of an action from the snapshot before it and the state after settling. */
function outcome(
  before: Snapshot,
  after: PersistedState,
  today: string,
  settled: { badges: Badge[]; bossDefeated: boolean; seasonDone: boolean },
): XpOutcome {
  const xpAfter = totalXp(after);
  const cp = chestProgress(after);
  return {
    xp: xpAfter - before.xp,
    gems: gems(after) - before.gems,
    levelBefore: levelFromXp(before.xp),
    levelAfter: levelFromXp(xpAfter),
    rankStepBefore: rankFromXp(before.xp).step,
    rankStepAfter: rankFromXp(xpAfter).step,
    badges: settled.badges,
    bossDefeated: settled.bossDefeated,
    seasonDone: settled.seasonDone,
    chestReady: cp.pending > before.chestsPending,
    dayDone: !before.dayDone && flowState(after, today).dayDone,
  };
}

/** A focus session that ran out is recorded as a full session and cleared. */
function settledFocus(s: PersistedState, now: Date): Partial<PersistedState> {
  if (!s.focus || focusActiveOf(s.focus, now)) return {};
  const endedAt = new Date(
    new Date(s.focus.startedAt).getTime() + s.focus.minutes * 60_000,
  ).toISOString();
  return {
    focus: null,
    focusSessions: [
      ...s.focusSessions,
      {
        id: newId(),
        startedAt: s.focus.startedAt,
        minutes: s.focus.minutes,
        endedAt,
        early: false,
      },
    ],
  };
}

export const useStore = create<StoreState>()(
  persist<StoreState, [], [], LocalPersistedState>(
    (set, get) => ({
      ...initialData(),
      discoverLibraryStatus: "loading",

      completeQuest(skillId, quest, proofUrl, now = new Date()) {
        const state = get();
        const base: CompleteResult = {
          ...baseOutcome(state),
          added: false,
          mastered: false,
          focusBonus: 0,
        };
        const skill = getSkill(skillId);
        if (!skill) return base;

        const existing = state.completions.find((c) => c.skillId === skillId && c.quest === quest);
        if (existing) {
          if (proofUrl !== undefined && proofUrl !== existing.proofUrl) {
            set({
              completions: state.completions.map((c) => (c === existing ? { ...c, proofUrl } : c)),
            });
          }
          return base;
        }

        const today = dayKey(now);
        const before = snapshot(state, today);
        const at = now.toISOString();
        const completion: QuestCompletion = {
          skillId,
          quest,
          at,
          ...(proofUrl ? { proofUrl } : {}),
        };
        const completions = [...state.completions, completion];

        // Quest XP, boosted while a focus session runs (the mastery bonus is not).
        const focusPatch = settledFocus(state, now);
        const focusOn = !!state.focus && !!focusActiveOf(state.focus, now);
        const plain = questXp(quest, skill.tier);
        const gained = focusOn ? focusedXp(plain) : plain;
        const ref = questRef(skillId, quest);
        const xpEvents: XpEvent[] = [
          ...state.xpEvents,
          { id: newId(), source: "quest", amount: gained, at, refId: ref },
        ];
        const gemEvents: GemEvent[] = [
          ...state.gemEvents,
          gemEvent(questGems(gained), at, "quest", ref),
        ];

        const doneForSkill = new Set(
          completions.filter((c) => c.skillId === skillId).map((c) => c.quest),
        );
        const allDone = QUEST_TYPES.every((q) => doneForSkill.has(q));
        const alreadyMastered = state.xpEvents.some(
          (e) => e.source === "mastery" && e.refId === skillId,
        );
        const mastered = allDone && !alreadyMastered;
        let drills = state.drills;
        if (mastered) {
          xpEvents.push({
            id: newId(),
            source: "mastery",
            amount: MASTERY_BONUS,
            at,
            refId: skillId,
          });
          gemEvents.push(gemEvent(GEM_RULES.mastery, at, "mastery", skillId));
          if (!drills.some((d) => d.skillId === skillId))
            drills = [...drills, newDrill(skillId, today)];
        }

        set({ ...focusPatch, completions, xpEvents, gemEvents, drills });
        const settled = settle(get(), now);
        set(settled.patch);
        return {
          ...outcome(before, get(), today, settled),
          added: true,
          mastered,
          focusBonus: gained - plain,
        };
      },

      uncompleteQuest(skillId, quest) {
        const state = get();
        if (!state.completions.some((c) => c.skillId === skillId && c.quest === quest)) return;
        const ref = questRef(skillId, quest);
        set({
          completions: state.completions.filter(
            (c) => !(c.skillId === skillId && c.quest === quest),
          ),
          // Undo the quest XP and, since the skill is no longer complete, its mastery bonus and drill.
          xpEvents: state.xpEvents.filter(
            (e) =>
              !(e.source === "quest" && e.refId === ref) &&
              !(e.source === "mastery" && e.refId === skillId),
          ),
          gemEvents: state.gemEvents.filter(
            (e) =>
              !(e.reason === "quest" && e.refId === ref) &&
              !(e.reason === "mastery" && e.refId === skillId),
          ),
          drills: state.drills.filter((d) => d.skillId !== skillId),
        });
      },

      addMicroAction(text, now = new Date()) {
        const parsed = LTextSchema.parse(text);
        const state = get();
        const today = dayKey(now);
        const before = snapshot(state, today);
        const at = now.toISOString();
        const action: MicroAction = { id: newId(), at, text: parsed };
        set({
          microActions: [...state.microActions, action],
          xpEvents: [
            ...state.xpEvents,
            { id: newId(), source: "micro", amount: microXp(), at, refId: action.id },
          ],
        });
        const settled = settle(get(), now);
        set(settled.patch);
        return { ...action, ...outcome(before, get(), today, settled) };
      },

      applyStreakFreezes(now = new Date()) {
        const s = get();
        const active = activeDays(s);
        const used = new Set(s.freezesUsedOn);
        const days = daysToFreeze(active, used, now, s.bonusFreezes);
        if (!days.length) return days;
        const spentBonus = bonusFreezesSpent(active, used, now, days.length);
        set({
          freezesUsedOn: [...s.freezesUsedOn, ...days].sort(),
          bonusFreezes: Math.max(0, s.bonusFreezes - spentBonus),
        });
        return days;
      },

      setSettings(partial) {
        set((s) => ({ settings: SettingsSchema.parse({ ...s.settings, ...partial }) }));
      },

      setEditorScope(scope) {
        set((s) => ({
          settings: SettingsSchema.parse({
            ...s.settings,
            discover: { ...s.settings.discover, editorScope: scope },
          }),
        }));
      },

      saveInspiration(item, now = new Date()) {
        set((s) => ({ inspirations: saveInspiration(s.inspirations, item, now) }));
      },

      accumulateDiscoverCandidates(items, options) {
        const current = get().discoverCandidates;
        const next = accumulateCategoryCandidates(current, items, options);
        // Cached results and source-enrichment effects can repeat a payload. Keep the same state
        // identity (and original obtainedAt) until actual candidate content changes.
        if (current !== next) {
          set({ discoverCandidates: next });
          candidateLibrary().changed();
        }
      },

      applyDiscoverSemanticResult(response, guard, now = new Date()) {
        const state = get();
        if (!guard.isCurrent() || guard.epoch !== state.discoverLibraryEpoch) return "stale";
        if (!Number.isFinite(now.getTime())) return "invalid";
        const parsed = DiscoverSemanticResponseSchema.safeParse(response);
        if (!parsed.success) return "invalid";
        const result = parsed.data;
        if (
          result.selection.provider !== guard.selection.provider ||
          result.selection.model !== guard.selection.model ||
          result.selection.effort !== guard.selection.effort ||
          result.selection.accountId !== guard.selection.accountId
        )
          return "invalid";
        if (result.status !== "assessed") return "unchanged";
        const key = (url: string) => discoverPostKey("tt", url) ?? discoverPostKey("ig", url);
        const requested = new Set(guard.urls.map(key).filter(Boolean));
        if (!requested.size || requested.size > 3) return "invalid";
        const incoming: DiscoverCandidate[] = [];
        for (const semantic of result.semantics) {
          const url = key(semantic.url);
          if (!url || !requested.has(url) || semantic.genreId !== guard.genreId) return "invalid";
          const current = state.discoverCandidates.find(
            (entry) => entry.genreId === guard.genreId && key(entry.item.url) === url,
          );
          if (!current) return "stale";
          if (
            !applicableDiscoverSemantic(
              { genreId: guard.genreId, semantic },
              current.item,
              now.getTime(),
            )
          )
            return "stale";
          incoming.push({ ...current, semantic });
        }
        if (!guard.isCurrent() || guard.epoch !== get().discoverLibraryEpoch) return "stale";
        const next = mergeDiscoverCandidates(state.discoverCandidates, incoming);
        if (next === state.discoverCandidates) return "unchanged";
        set({ discoverCandidates: next });
        candidateLibrary().changed();
        return "applied";
      },

      applyCapturedVideoReviewResult(response, guard, now = new Date()) {
        const state = get();
        if (
          !guard.isCurrent() ||
          guard.epoch !== state.discoverLibraryEpoch ||
          state.discoverLibraryStatus === "loading"
        )
          return "stale";
        const url = canonicalNativeVideoUrl(guard.url);
        if (!url || !Number.isFinite(now.getTime())) return "invalid";
        const parsed = CapturedVideoReviewResponseSchema.safeParse(response);
        if (!parsed.success) return "invalid";
        const result = parsed.data;
        if (
          result.selection.provider !== guard.selection.provider ||
          result.selection.model !== guard.selection.model ||
          result.selection.effort !== guard.selection.effort ||
          result.selection.accountId !== guard.selection.accountId
        )
          return "invalid";
        // A failed check never overwrites an existing judgment or saves uploaded screenshots.
        if (result.status !== "assessed") return "unchanged";
        if (
          canonicalNativeVideoUrl(result.source.url) !== url ||
          result.visual.url !== url ||
          result.visual.genreId !== guard.genreId ||
          result.visual.media.provenance !== "browser-visible-video" ||
          !result.source.observedAt ||
          Date.parse(result.source.observedAt) > now.getTime() + 300_000 ||
          now.getTime() - Date.parse(result.visual.checkedAt) >= DISCOVER_VISUAL_TTL_MS
        )
          return "invalid";
        const current = state.discoverCandidates.find(
          (entry) =>
            entry.genreId === guard.genreId &&
            entry.item.platform === "tt" &&
            canonicalNativeVideoUrl(entry.item.url) === url,
        );
        const item = applyTikTokEvidence(
          current?.item ?? {
            platform: "tt",
            url,
            handle: "",
            title: "TikTok",
            snippet: "",
            lang: state.settings.lang,
            section: "example",
          },
          result.source,
        );
        if (
          !applicableDiscoverVisual(
            {
              genreId: guard.genreId,
              visual: result.visual,
              visualObservation: current?.visualObservation,
            },
            item,
            now.getTime(),
          )
        )
          return "stale";
        if (!guard.isCurrent() || guard.epoch !== get().discoverLibraryEpoch) return "stale";
        const next = mergeDiscoverCandidates(state.discoverCandidates, [
          {
            ...current,
            genreId: guard.genreId,
            obtainedAt: current?.obtainedAt ?? now.toISOString(),
            origin: current?.origin ?? "manual",
            item,
            visual: result.visual,
          },
        ]);
        if (next === state.discoverCandidates) return "unchanged";
        set({ discoverCandidates: next });
        candidateLibrary().changed();
        return "applied";
      },

      applyDiscoverVisualResult(response, guard, now = new Date()) {
        const state = get();
        if (!guard.isCurrent() || guard.epoch !== state.discoverLibraryEpoch) return "stale";
        const url = discoverPostKey("ig", guard.url);
        if (!url || !Number.isFinite(now.getTime())) return "invalid";
        const current = state.discoverCandidates.find(
          (entry) => entry.genreId === guard.genreId && entry.item.url === url,
        );
        if (!current) return "stale";
        const parsed = DiscoverVisualResponseSchema.safeParse(response);
        if (!parsed.success) return "invalid";
        const result = parsed.data;
        if (
          result.selection.provider !== guard.selection.provider ||
          result.selection.model !== guard.selection.model ||
          result.selection.effort !== guard.selection.effort ||
          result.selection.accountId !== guard.selection.accountId
        )
          return "invalid";
        const observation = result.status === "assessed" ? result.visual : result.observation;
        if (
          (result.source && discoverPostKey("ig", result.source.url) !== url) ||
          (observation &&
            (observation.genreId !== guard.genreId ||
              discoverPostKey("ig", observation.url) !== url))
        )
          return "invalid";
        const timestamps = [
          result.source?.observedAt,
          observation?.checkedAt,
          observation?.source.observedAt,
          observation?.media.observedAt,
        ].filter((value): value is string => typeof value === "string");
        if (
          timestamps.some(
            (value) =>
              !Number.isFinite(Date.parse(value)) || Date.parse(value) > now.getTime() + 300_000,
          )
        )
          return "invalid";
        // Returned metadata is authoritative only through the existing exact-post and time-aware merge.
        const item = result.source
          ? applyInstagramEvidence(current.item, result.source)
          : current.item;
        if (observation && !discoverVisualSourceMatches(observation, item)) return "stale";
        if (
          result.status === "assessed" &&
          (result.visual.provider !== guard.selection.provider ||
            result.visual.model !== guard.selection.model ||
            result.visual.effort !== guard.selection.effort ||
            // Stored judgments persist, but a newly received stale response must not enter as live evidence.
            now.getTime() - Date.parse(result.visual.checkedAt) >= DISCOVER_VISUAL_TTL_MS ||
            !applicableDiscoverVisual(
              { genreId: guard.genreId, visual: result.visual },
              item,
              now.getTime(),
            ))
        )
          return "invalid";
        // The same request may settle after a synchronous listener reset/import or caller cancellation.
        if (!guard.isCurrent() || guard.epoch !== get().discoverLibraryEpoch) return "stale";
        const next = mergeDiscoverCandidates(state.discoverCandidates, [
          {
            ...current,
            item,
            ...(result.status === "assessed" ? { visual: result.visual } : {}),
            ...(result.status === "unavailable" && result.observation
              ? { visualObservation: result.observation }
              : {}),
          },
        ]);
        if (next === state.discoverCandidates) return "unchanged";
        set({ discoverCandidates: next });
        candidateLibrary().changed();
        return "applied";
      },

      setDiscoverFeedback(input, now = new Date()) {
        const current = get().discoverFeedback;
        const { feedback, undo } = changeDiscoverFeedback(current, input, now);
        if (JSON.stringify(current) !== JSON.stringify(feedback))
          set({ discoverFeedback: feedback });
        return undo;
      },

      undoDiscoverFeedback(undo) {
        const current = get().discoverFeedback;
        const next = restoreDiscoverFeedback(current, undo);
        if (JSON.stringify(current) !== JSON.stringify(next)) set({ discoverFeedback: next });
      },

      clearDiscoverFeedback() {
        if (get().discoverFeedback.length) set({ discoverFeedback: [] });
      },

      followFormat(format, now = new Date()) {
        const checked = EditFormatSchema.safeParse(format);
        if (!checked.success) return;
        const key = formatIdentity(checked.data);
        set((s) => {
          const existing = s.followedFormats.find((entry) => formatIdentity(entry.format) === key);
          return {
            followedFormats: [
              { format: checked.data, followedAt: existing?.followedAt ?? now.toISOString() },
              ...s.followedFormats.filter((entry) => formatIdentity(entry.format) !== key),
            ].slice(0, 64),
          };
        });
      },

      unfollowFormat(identity) {
        set((s) => ({
          followedFormats: s.followedFormats.filter(
            (entry) => formatIdentity(entry.format) !== identity,
          ),
        }));
      },

      refreshFollowedFormats(formats) {
        const checked = formats.flatMap((format) => {
          const parsed = EditFormatSchema.safeParse(format);
          return parsed.success ? [parsed.data] : [];
        });
        const byKey = new Map(checked.map((format) => [formatIdentity(format), format]));
        set((s) => {
          let changed = false;
          const followedFormats = s.followedFormats.map((entry) => {
            const next = byKey.get(formatIdentity(entry.format));
            if (!next || Date.parse(next.lastChecked) <= Date.parse(entry.format.lastChecked))
              return entry;
            changed = true;
            return { ...entry, format: next };
          });
          return changed ? { followedFormats } : s;
        });
      },

      recordFormatObservation(input, now = new Date()) {
        const current = get().formatObservations;
        const next = upsertFormatObservation(current, input, now);
        if (next === current) return false;
        set({ formatObservations: [...next] });
        return true;
      },

      removeFormatObservation(targetKey, url) {
        const canonical = canonicalDiscoverVisualUrl(url);
        if (!canonical) return;
        const current = get().formatObservations;
        const next = current.filter((row) => row.target.key !== targetKey || row.url !== canonical);
        if (next.length !== current.length) set({ formatObservations: next });
      },

      addFormatCandidates(target, urls) {
        const current = get().formatQueue;
        const next = addFormatCandidatesToQueue(current, target, urls);
        if (next !== current) set({ formatQueue: [...next] });
      },

      removeFormatCandidate(target, url) {
        const current = get().formatQueue;
        const next = removeFormatCandidateFromQueue(current, target, url);
        if (next !== current) set({ formatQueue: [...next] });
      },

      updateInspiration(url, patch) {
        set((s) => ({
          inspirations: s.inspirations.map((entry) =>
            inspirationKey(entry.ref) !== canonicalRefUrl(entry.ref.platform, url)
              ? entry
              : InspirationSchema.parse({
                  ...entry,
                  ...patch,
                  note: (patch.note ?? entry.note).slice(0, INSPIRATION_NOTE_MAX),
                }),
          ),
        }));
      },

      removeInspiration(url) {
        set((s) => ({
          inspirations: s.inspirations.filter(
            (entry) => inspirationKey(entry.ref) !== canonicalRefUrl(entry.ref.platform, url),
          ),
        }));
      },

      // Refs compare by their canonical URL (lib/research canonicalRefUrl), so a post saved as a /reel/ link,
      // a youtu.be link or with a query string is the same ref as its search card.
      addRef(skillId, ref) {
        const s = get();
        const list = s.savedRefs[skillId] ?? [];
        const key = canonicalRefUrl(ref.platform, ref.url);
        if (list.some((r) => canonicalRefUrl(r.platform, r.url) === key)) return;
        set({ savedRefs: { ...s.savedRefs, [skillId]: [...list, ref] } });
      },

      removeRef(skillId, url) {
        const s = get();
        const list = s.savedRefs[skillId];
        const same = (r: Ref) =>
          canonicalRefUrl(r.platform, r.url) === canonicalRefUrl(r.platform, url);
        if (!list?.some(same)) return;
        set({ savedRefs: { ...s.savedRefs, [skillId]: list.filter((r) => !same(r)) } });
      },

      setNote(skillId, body, now = new Date()) {
        if (!getSkill(skillId)) return;
        const s = get();
        const text = body.slice(0, NOTE_MAX_CHARS);
        if (!text.trim()) {
          if (!(skillId in s.notes)) return;
          const rest = { ...s.notes };
          delete rest[skillId];
          set({ notes: rest });
          return;
        }
        if (s.notes[skillId]?.body === text) return;
        set({ notes: { ...s.notes, [skillId]: { body: text, updatedAt: now.toISOString() } } });
      },

      addRecentTopic(topic) {
        const text = topic.trim();
        if (!text) return;
        const s = get();
        set({ recentTopics: [text, ...s.recentTopics.filter((t) => t !== text)].slice(0, 8) });
      },

      openChest(now = new Date()) {
        const s = get();
        if (!chestProgress(s).ready) return null;
        const number = s.chestsOpened + 1;
        const loot = lootFor(number);
        const at = now.toISOString();
        const patch: Partial<PersistedState> = { chestsOpened: number };
        if (loot.kind === "gems") {
          patch.gemEvents = [...s.gemEvents, gemEvent(loot.amount, at, "chest", String(number))];
        } else if (loot.kind === "freeze") {
          patch.bonusFreezes = addBonusFreezes(s, loot.amount, now);
        }
        set(patch);
        const settled = settle(get(), now);
        set(settled.patch);
        return { ...loot, number, badges: settled.badges };
      },

      startFocus(minutes, now = new Date()) {
        const s = get();
        const running = s.focus && focusActiveOf(s.focus, now) ? s.focus : null;
        if (running) return running;
        const focus: FocusState = { startedAt: now.toISOString(), minutes };
        set({ ...settledFocus(s, now), focus });
        return focus;
      },

      stopFocus(now = new Date()) {
        const s = get();
        if (!s.focus) return null;
        const early = stoppedEarly(s.focus, now);
        const endedAt = early
          ? now.toISOString()
          : new Date(
              new Date(s.focus.startedAt).getTime() + s.focus.minutes * 60_000,
            ).toISOString();
        const session: FocusSession = {
          id: newId(),
          startedAt: s.focus.startedAt,
          minutes: s.focus.minutes,
          endedAt,
          early,
        };
        set({ focus: null, focusSessions: [...s.focusSessions, session] });
        const settled = settle(get(), now);
        set(settled.patch);
        return { ...session, badges: settled.badges };
      },

      checkBadges(now = new Date()) {
        const settled = settle(get(), now);
        set(settled.patch);
        return settled.badges;
      },

      completeDrill(skillId, now = new Date()) {
        const state = get();
        const drill = state.drills.find((d) => d.skillId === skillId);
        if (!drill) return { ...baseOutcome(state), done: false };
        const today = dayKey(now);
        const before = snapshot(state, today);
        const at = now.toISOString();
        set({
          drills: state.drills.map((d) => (d === drill ? advanceDrill(drill, today) : d)),
          xpEvents: [
            ...state.xpEvents,
            { id: newId(), source: "drill", amount: DRILL_XP, at, refId: skillId },
          ],
        });
        const settled = settle(get(), now);
        set(settled.patch);
        return { ...outcome(before, get(), today, settled), done: true };
      },

      saveReview(review, now = new Date()) {
        const state = get();
        const at = now.toISOString();
        const parsed = ReviewSchema.parse({ ...review, at });
        const today = dayKey(now);
        const before = snapshot(state, today);
        const existing = state.reviews.find((r) => r.week === parsed.week);
        const reviews = existing
          ? state.reviews.map((r) => (r === existing ? parsed : r))
          : [...state.reviews, parsed];
        const rewarded = state.xpEvents.some(
          (e) => e.source === "review" && e.refId === parsed.week,
        );
        const added = !existing && !rewarded;
        set({
          reviews,
          ...(added
            ? {
                xpEvents: [
                  ...state.xpEvents,
                  { id: newId(), source: "review", amount: REVIEW_XP, at, refId: parsed.week },
                ],
                gemEvents: [
                  ...state.gemEvents,
                  gemEvent(GEM_RULES.review, at, "review", parsed.week),
                ],
              }
            : {}),
        });
        const settled = settle(get(), now);
        set(settled.patch);
        return { ...outcome(before, get(), today, settled), added };
      },

      updateReview(week, patch) {
        const s = get();
        const existing = s.reviews.find((r) => r.week === week);
        if (!existing) return;
        const next = ReviewSchema.parse({ ...existing, ...patch, week, at: existing.at });
        set({ reviews: s.reviews.map((r) => (r === existing ? next : r)) });
      },

      setPlanItems(week, items) {
        const parsed = z.array(PlanItemSchema).parse(items);
        set((s) => ({
          planItems: [
            ...s.planItems.filter((p) => p.week !== week),
            ...parsed.filter((p) => p.week === week),
          ],
        }));
      },

      addPlanItem(item) {
        const parsed = PlanItemSchema.parse(item);
        set((s) => ({ planItems: [...s.planItems.filter((p) => p.id !== parsed.id), parsed] }));
      },

      removePlanItem(id) {
        set((s) => ({ planItems: s.planItems.filter((p) => p.id !== id) }));
      },

      buyReward(id, now = new Date()) {
        const s = get();
        const reward = s.rewards.find((r) => r.id === id);
        const check = canBuy(reward, {
          gems: gems(s),
          level: levelFromXp(totalXp(s)),
          owned: s.purchases.some((p) => p.rewardId === id),
        });
        if (!check.ok || !reward) return check;
        const patch: Partial<PersistedState> = {};
        if (reward.id === FREEZE_REWARD_ID) {
          if (streak(s, now).freezes >= FREEZE_TOTAL_CAP) return { ok: false, reason: "full" };
          patch.bonusFreezes = addBonusFreezes(s, 1, now);
        }
        const at = now.toISOString();
        const purchase: Purchase = { id: newId(), rewardId: reward.id, at, cost: reward.cost };
        set({
          ...patch,
          purchases: [...s.purchases, purchase],
          gemEvents: [...s.gemEvents, gemEvent(-reward.cost, at, "purchase", reward.id)],
        });
        return { ok: true };
      },

      addReward(reward) {
        const parsed = RewardSchema.parse({ ...reward, builtIn: false });
        set((s) => ({ rewards: [...s.rewards.filter((r) => r.id !== parsed.id), parsed] }));
      },

      updateReward(id, patch) {
        const s = get();
        const existing = s.rewards.find((r) => r.id === id);
        if (!existing) return;
        const next = RewardSchema.parse({ ...existing, ...patch, id, builtIn: existing.builtIn });
        set({ rewards: s.rewards.map((r) => (r === existing ? next : r)) });
      },

      removeReward(id) {
        set((s) => ({ rewards: s.rewards.filter((r) => r.id !== id || r.builtIn) }));
      },

      /* ---------- 📱 Social world ---------- */

      addPost(input, now = new Date()) {
        const s = get();
        const { withTemplate, ...rest } = input;
        const skill = rest.skillId ? getSkill(rest.skillId) : undefined;
        const at = now.toISOString();
        const post = PostSchema.parse({
          ...rest,
          hashtags: rest.hashtags?.length ? rest.hashtags : suggestHashtags(rest.platform, skill),
          shots: rest.shots?.length
            ? rest.shots
            : withTemplate
              ? shotsFromTemplate(rest.platform, s.settings.lang, newId)
              : [],
          id: newId(),
          createdAt: at,
          updatedAt: at,
        });
        set({ posts: [...s.posts, post] });
        return post;
      },

      updatePost(id, patch, now = new Date()) {
        return patchPost(get, set, id, patch, now);
      },

      allocatePublishJobId(postId, jobId, now = new Date()) {
        return commitJobId(
          postId,
          jobId,
          (post, posts) => {
            // DT-5-R2 (R1-A): ownership on this fresh state, before the same-id no-op too.
            const own = jobOwnership(post, posts);
            if (!own.ok && own.reason === "ambiguous") return { ok: false, reason: "ambiguous" };
            const remembered = rememberedJobId(post);
            if (remembered) return remembered === jobId ? null : { ok: false, reason: "conflict" };
            if (!PUBLISH_ID_RE.test(jobId) || takenJobIds(posts, postId).has(jobId))
              return { ok: false, reason: "taken" };
            return null;
          },
          now,
        );
      },

      releasePublishJobId(postId, jobId, now = new Date()) {
        return commitJobId(
          postId,
          undefined,
          (post) =>
            post.autoPost?.jobId === jobId && !post.autoPost.sentAt
              ? null
              : { ok: false, reason: "conflict" },
          now,
        );
      },

      updatePosts(patches, now = new Date()) {
        const s = get();
        if (!s.posts.some((p) => patches.has(p.id))) return;
        set({
          posts: s.posts.map((p) => {
            const patch = patches.get(p.id);
            return patch ? patched(p, patch, now) : p;
          }),
        });
      },

      removePost(id) {
        const s = get();
        if (!s.posts.some((p) => p.id === id)) return;
        set({
          posts: s.posts.filter((p) => p.id !== id),
          ideas: s.ideas.map((i) => {
            if (i.usedInPostId !== id) return i;
            const { usedInPostId: _unlinked, ...rest } = i;
            void _unlinked;
            return rest;
          }),
        });
      },

      setPostStage(id, stage, now = new Date()) {
        const existing = get().posts.find((p) => p.id === id);
        if (!existing) return undefined;
        const patch: PostPatch = { stage };
        if (stage === "posted" && !existing.postedAt) patch.postedAt = now.toISOString();
        return patchPost(get, set, id, patch, now);
      },

      toggleShot(postId, shotId, now = new Date()) {
        const existing = get().posts.find((p) => p.id === postId);
        if (!existing?.shots.some((sh) => sh.id === shotId)) return existing;
        return patchPost(
          get,
          set,
          postId,
          {
            shots: existing.shots.map((sh) => (sh.id === shotId ? { ...sh, done: !sh.done } : sh)),
          },
          now,
        );
      },

      addShot(postId, shot, now = new Date()) {
        const existing = get().posts.find((p) => p.id === postId);
        if (!existing) return undefined;
        const parsed = ShotSchema.parse({ done: false, ...shot, id: shot.id ?? newId() });
        patchPost(
          get,
          set,
          postId,
          { shots: [...existing.shots.filter((sh) => sh.id !== parsed.id), parsed] },
          now,
        );
        return parsed;
      },

      removeShot(postId, shotId, now = new Date()) {
        const existing = get().posts.find((p) => p.id === postId);
        if (!existing?.shots.some((sh) => sh.id === shotId)) return existing;
        return patchPost(
          get,
          set,
          postId,
          { shots: existing.shots.filter((sh) => sh.id !== shotId) },
          now,
        );
      },

      markPosted(id, url, now = new Date()) {
        const existing = get().posts.find((p) => p.id === id);
        if (!existing) return { post: undefined, quest: null };
        const link = url.trim();
        const post = patchPost(
          get,
          set,
          id,
          {
            stage: "posted",
            postedAt: existing.postedAt ?? now.toISOString(),
            ...(link ? { postedUrl: link } : {}),
          },
          now,
        );
        let quest: CompleteResult | null = null;
        if (existing.skillId && !isQuestDone(get(), existing.skillId, "produce")) {
          const r = get().completeQuest(existing.skillId, "produce", link || undefined, now);
          quest = r.added ? r : null;
        }
        return { post, quest };
      },

      unmarkPosted(id, now = new Date()) {
        const existing = get().posts.find((p) => p.id === id);
        if (!existing) return undefined;
        const { postedAt: _at, postedUrl: _url, ...rest } = existing;
        void _at;
        void _url;
        const at = now.toISOString();
        const post = PostSchema.parse({
          ...rest,
          stage: existing.stage === "posted" ? "scheduled" : existing.stage,
          updatedAt: at,
        });
        set({ posts: get().posts.map((p) => (p.id === id ? post : p)) });
        return post;
      },

      createPostFromSkill(skillId, platform, now = new Date()) {
        const skill = getSkill(skillId);
        if (!skill) return undefined;
        const s = get();
        const dup = s.posts.find(
          (p) => p.skillId === skillId && p.platform === platform && p.stage !== "posted",
        );
        if (dup) return dup;
        const lang = s.settings.lang;
        return get().addPost(
          {
            platform,
            title: L(lang, skill.name),
            hook: L(lang, skill.quests.produce),
            skillId,
            plannedTime: bestTime(platform),
            withTemplate: true,
          },
          now,
        );
      },

      addIdea(input, now = new Date()) {
        const idea = IdeaSchema.parse({ ...input, id: newId(), createdAt: now.toISOString() });
        set((s) => ({ ideas: [...s.ideas, idea] }));
        return idea;
      },

      removeIdea(id) {
        set((s) => ({ ideas: s.ideas.filter((i) => i.id !== id) }));
      },

      toggleIdeaFavorite(id) {
        set((s) => ({
          ideas: s.ideas.map((i) => (i.id === id ? { ...i, favorite: !i.favorite } : i)),
        }));
      },

      useIdea(ideaId, platform, now = new Date()) {
        const s = get();
        const idea = s.ideas.find((i) => i.id === ideaId);
        if (!idea) return undefined;
        const live = idea.usedInPostId
          ? s.posts.find((p) => p.id === idea.usedInPostId)
          : undefined;
        if (live) return live;
        const post = get().addPost(
          {
            platform,
            title: idea.text,
            ideaId: idea.id,
            ...(idea.skillId ? { skillId: idea.skillId } : {}),
            plannedTime: bestTime(platform),
          },
          now,
        );
        set({
          ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, usedInPostId: post.id } : i)),
        });
        return post;
      },

      addSnapshot(snapshot) {
        const parsed = SocialSnapshotSchema.parse(snapshot);
        set((s) => ({ socialSnapshots: upsertSnapshots(s.socialSnapshots, [parsed]) }));
      },

      importSnapshots(list) {
        const parsed = z.array(SocialSnapshotSchema).parse(list);
        set((s) => ({ socialSnapshots: upsertSnapshots(s.socialSnapshots, parsed) }));
      },

      removeSnapshot(platform, day) {
        set((s) => ({
          socialSnapshots: s.socialSnapshots.filter(
            (x) => !(x.platform === platform && x.day === day),
          ),
        }));
      },

      importPostStats(list) {
        const parsed = z.array(SocialPostStatSchema).parse(list);
        set((s) => ({ socialPostStats: upsertPostStats(s.socialPostStats, parsed) }));
      },

      removePostStat(platform, postId) {
        set((s) => ({
          socialPostStats: s.socialPostStats.filter(
            (p) => !(p.platform === platform && p.postId === postId),
          ),
        }));
      },

      importDemographics(list) {
        const parsed = z.array(DemographicSchema).parse(list);
        set((s) => ({ demographics: replaceDemographics(s.demographics, parsed) }));
      },

      clearDemographics(platform, day) {
        set((s) => ({
          demographics: s.demographics.filter(
            (d) => !(d.platform === platform && (day === undefined || d.day === day)),
          ),
        }));
      },

      setSocialSeedApplied(version) {
        set({ socialSeedApplied: version });
      },

      addAsk(input, now = new Date()) {
        const s = get();
        const text = input.text.trim();
        const key = text.toLowerCase();
        const existing = s.audienceAsks.find((a) => a.text.trim().toLowerCase() === key);
        if (existing) {
          const bumped = { ...existing, count: existing.count + Math.max(1, input.count ?? 1) };
          set({ audienceAsks: s.audienceAsks.map((a) => (a === existing ? bumped : a)) });
          return bumped;
        }
        const ask = AudienceAskSchema.parse({
          ...input,
          text,
          count: input.count ?? 1,
          id: newId(),
          createdAt: now.toISOString(),
        });
        set({ audienceAsks: [...s.audienceAsks, ask] });
        return ask;
      },

      bumpAsk(id, by = 1) {
        set((s) => ({
          audienceAsks: s.audienceAsks.map((a) =>
            a.id === id ? { ...a, count: Math.max(1, a.count + by) } : a,
          ),
        }));
      },

      removeAsk(id) {
        set((s) => ({ audienceAsks: s.audienceAsks.filter((a) => a.id !== id) }));
      },

      setAccount(platform, handle, url) {
        const account = SocialAccountSchema.parse({
          platform,
          handle: handle.trim().replace(/^@/, ""),
          ...(url?.trim() ? { url: url.trim() } : {}),
        });
        set((s) => ({
          socialAccounts: [...s.socialAccounts.filter((a) => a.platform !== platform), account],
        }));
      },

      removeAccount(platform) {
        set((s) => ({ socialAccounts: s.socialAccounts.filter((a) => a.platform !== platform) }));
      },

      setSocialSyncStatus(status, now = new Date()) {
        set((s) => ({ socialSync: { ...s.socialSync, status, statusAt: now.toISOString() } }));
      },

      setSocialPullResult({ at, error }) {
        set((s) => ({
          socialSync: {
            ...s.socialSync,
            lastPullAt: at ?? s.socialSync.lastPullAt,
            lastPullError: error,
          },
        }));
      },

      removeBeaconsSeed() {
        set((s) => {
          const seedAccount = (a: SocialAccount) =>
            SEED_ACCOUNTS.some(
              (x) => x.platform === a.platform && x.handle === a.handle && x.url === a.url,
            ) && s.socialSync.status?.[a.platform]?.connected !== true;
          return {
            socialSnapshots: s.socialSnapshots.filter((x) => !isSeedRow(x)),
            demographics: s.demographics.filter((d) => !isSeedRow(d)),
            socialAccounts: s.socialAccounts.filter((a) => !seedAccount(a)),
            socialSeedApplied: SOCIAL_SEED_VERSION,
          };
        });
      },

      setTrends(feed) {
        const parsed = TrendsFeedSchema.parse(feed);
        set((s) => {
          const ids = new Set(parsed.items.map((i) => i.id));
          return {
            trends: {
              ...parsed,
              dismissed: s.trends.dismissed.filter((id) => ids.has(id)),
            },
          };
        });
      },

      dismissTrend(id) {
        set((s) =>
          s.trends.dismissed.includes(id)
            ? {}
            : { trends: { ...s.trends, dismissed: [...s.trends.dismissed, id] } },
        );
      },

      clearTrends() {
        set({ trends: { ...EMPTY_TRENDS, items: [], sources: [], dismissed: [] } });
      },

      addCustomGenre(name, query) {
        const clean = (text: string) => text.trim().replace(/\s+/g, " ");
        const genre = { id: customGenreId(name), name: clean(name), query: clean(query) };
        if (!genre.name || !genre.query) return;
        const s = get();
        if (isGenreNameTaken(genre.name, s.customGenres)) return;
        set({ customGenres: [...s.customGenres, CustomGenreSchema.parse(genre)] });
      },

      removeCustomGenre(id) {
        const s = get();
        if (!s.customGenres.some((g) => g.id === id)) return;
        set({ customGenres: s.customGenres.filter((g) => g.id !== id) });
      },

      addArticle(input = {}, now = new Date()) {
        const at = now.toISOString();
        const article = ArticleSchema.parse({
          id: newId(),
          title: input.title ?? { ar: "", en: "" },
          body: input.body ?? { ar: "", en: "" },
          slug: "",
          ...(input.skillId ? { skillId: input.skillId } : {}),
          commitId: newId(),
          createdAt: at,
          updatedAt: at,
        });
        return commitArticles((fresh) => ({ articles: [article, ...fresh], article }));
      },

      updateArticle(id, patch, base, now = new Date()) {
        return commitArticles((fresh) => {
          const existing = fresh.find((a) => a.id === id);
          if (!existing) return { ok: false, reason: "missing" };
          if (base.generation !== articlesGen || base.commitId !== existing.commitId)
            return { ok: false, reason: "conflict" };
          if (existing.status === "archived") return { ok: false, reason: "archived" };
          const content: ArticlePatch = {};
          for (const k of ARTICLE_CONTENT)
            if (k in patch) Object.assign(content, { [k]: patch[k] });
          const next = ArticleSchema.parse({ ...existing, ...content });
          if (sameArticleContent(next, existing)) return { articles: fresh, article: existing };
          const article: Article = {
            ...next,
            status: existing.status === "ready" ? "draft" : existing.status,
            revision: existing.revision + 1,
            commitId: newId(),
            updatedAt: now.toISOString(),
          };
          return { articles: fresh.map((a) => (a.id === id ? article : a)), article };
        });
      },

      setArticleStatus(id, status, now = new Date()) {
        let queued = false;
        const go = (verified: Verified) =>
          commitArticles((fresh, state) => {
            const a = fresh.find((x) => x.id === id);
            if (!a) return { ok: false, reason: "missing" };
            if (a.status === status) return { articles: fresh, article: a };
            if (a.status === "archived") return { ok: false, reason: "archived" }; // restore first
            if (status === "ready" && articleIssues(a, fresh).length > 0)
              return { ok: false, reason: "issues" };
            const at = now.toISOString();
            const article: Article = {
              ...a,
              status,
              revision: a.revision + 1,
              commitId: newId(),
              updatedAt: at,
              ...(status === "archived" ? { archivedAt: at } : {}),
            };
            // ⚙️ DT-4: a successful draft → ready transition queues its article-ready runs in this same commit.
            // DT-7C-2B-3: only when every one of them is provably local; otherwise the whole transition is refused.
            const members = status === "ready" ? readyMembers(state) : [];
            if (
              members.length &&
              !provablyLocal(
                state,
                members.map((w) => w.id),
                verified,
              )
            )
              return { ok: false, reason: "workflow-not-local" };
            const runs =
              status === "ready"
                ? members.map((w) =>
                    newRun(
                      w,
                      "article-ready",
                      articleInput(article, state.settings.lang, now),
                      now,
                    ),
                  )
                : [];
            queued = runs.length > 0;
            return {
              articles: fresh.map((x) => (x.id === id ? article : x)),
              article,
              ...(queued ? { also: enqueueRuns(state.workflowRuns, runs) } : {}),
            };
          });
        const proof =
          status === "ready"
            ? legacyProof(
                get()
                  .workflows.filter((w) => w.trigger.kind === "article-ready")
                  .map((w) => w.id),
              )
            : new Set<string>();
        const committed = proof instanceof Promise ? proof.then(go) : go(proof);
        return committed.then((r) => {
          if (r.ok && queued) void get().drainWorkflowRuns();
          return r;
        });
      },

      restoreArticle(id, opts = {}, now = new Date()) {
        return commitArticles((fresh) => {
          const a = fresh.find((x) => x.id === id);
          if (!a) return { ok: false, reason: "missing" };
          if (a.status !== "archived") return { ok: false, reason: "conflict" };
          const active = fresh.filter((x) => x.id !== id && x.status !== "archived");
          const twin = a.slug ? active.find((x) => x.slug === a.slug) : undefined;
          if (twin && !opts.newSlug)
            return { ok: false, reason: "slug-duplicate", conflictsWith: twin };
          const { archivedAt: _archivedAt, ...rest } = a;
          void _archivedAt;
          const article: Article = {
            ...rest,
            ...(twin ? { slug: freeSlug(a.slug, active) } : {}),
            status: "draft",
            revision: a.revision + 1,
            commitId: newId(),
            updatedAt: now.toISOString(),
          };
          return { articles: fresh.map((x) => (x.id === id ? article : x)), article };
        });
      },

      addWorkflow(input = {}, now = new Date()) {
        const at = now.toISOString();
        const workflow = WorkflowSchema.parse({
          id: newId(),
          name: input.name ?? { ar: "", en: "" },
          trigger: input.trigger ?? { kind: "manual" },
          actions: input.actions ?? [newAction("idea", newId())],
          commitId: newId(),
          createdAt: at,
          updatedAt: at,
        });
        return commitWorkflows((fresh) => ({ workflows: [...fresh, workflow], workflow }));
      },

      updateWorkflow(id, patch, base, now = new Date()) {
        return commitWorkflows((fresh) => {
          const existing = fresh.find((w) => w.id === id);
          if (!existing) return { ok: false, reason: "missing" };
          if (base.generation !== articlesGen || base.commitId !== existing.commitId)
            return { ok: false, reason: "conflict" };
          const next = WorkflowSchema.parse({
            ...existing,
            ...(patch.name ? { name: patch.name } : {}),
            ...(patch.trigger ? { trigger: patch.trigger } : {}),
            ...(patch.actions ? { actions: patch.actions } : {}),
          });
          if (sameWorkflow(next, existing)) return { workflows: fresh, workflow: existing };
          const workflow: Workflow = {
            ...next,
            revision: existing.revision + 1,
            commitId: newId(),
            updatedAt: now.toISOString(),
          };
          return { workflows: fresh.map((w) => (w.id === id ? workflow : w)), workflow };
        });
      },

      setWorkflowEnabled(id, enabled, now = new Date()) {
        return commitWorkflows((fresh) => {
          const existing = fresh.find((w) => w.id === id);
          if (!existing) return { ok: false, reason: "missing" };
          if (existing.enabled === enabled) return { workflows: fresh, workflow: existing };
          const workflow: Workflow = {
            ...existing,
            enabled,
            revision: existing.revision + 1,
            commitId: newId(),
            updatedAt: now.toISOString(),
          };
          return { workflows: fresh.map((w) => (w.id === id ? workflow : w)), workflow };
        });
      },

      saveBusinessKit(patch, base, now = new Date()) {
        return commitFresh<BusinessKitResult>((fresh) => {
          const existing = fresh.businessKit;
          if (base.generation !== articlesGen || base.commitId !== (existing?.commitId ?? null))
            return { result: { ok: false, reason: "conflict" } };
          const fields = Object.fromEntries(
            KIT_FIELDS.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]),
          );
          const at = now.toISOString();
          const parsed = BusinessKitSchema.safeParse({
            ...(existing ?? { commitId: newId(), updatedAt: at }),
            ...fields,
          });
          if (!parsed.success) return { result: { ok: false, reason: "invalid" } };
          if (existing && sameKit(parsed.data, existing))
            return {
              patch: { businessKit: existing },
              result: { ok: true, kit: existing },
              persisted: () => storedKitCommit() === existing.commitId,
            };
          const kit: BusinessKit = {
            ...parsed.data,
            revision: existing ? existing.revision + 1 : 1,
            commitId: newId(),
            updatedAt: at,
          };
          return {
            patch: { businessKit: kit },
            result: { ok: true, kit },
            persisted: () => storedKitCommit() === kit.commitId,
          };
        });
      },

      saveInboxDraft(scope, text, base, now = new Date()) {
        return commitFresh<InboxDraftResult>((fresh) => {
          const existing = fresh.inboxDrafts[scope];
          if (base.generation !== articlesGen || base.commitId !== (existing?.commitId ?? null))
            return { result: { ok: false, reason: "conflict" } };
          const parsed = InboxDraftSchema.safeParse({
            text,
            updatedAt: now.toISOString(),
            commitId: newId(),
          });
          if (!scope || scope.length > 1000 || !parsed.success)
            return { result: { ok: false, reason: "invalid" } };
          const draft = parsed.data;
          // The cap drops the oldest others; the draft just written always stays.
          const others = Object.entries(fresh.inboxDrafts)
            .filter(([k]) => k !== scope)
            .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, INBOX_DRAFTS_MAX - 1);
          return {
            patch: { inboxDrafts: Object.fromEntries([...others, [scope, draft]]) },
            result: { ok: true, draft },
            persisted: () => storedInboxDrafts()?.[scope]?.commitId === draft.commitId,
          };
        });
      },

      discardInboxDraft(scope, base) {
        return commitFresh<InboxDraftResult>((fresh) => {
          const existing = fresh.inboxDrafts[scope];
          if (base.generation !== articlesGen || base.commitId !== (existing?.commitId ?? null))
            return { result: { ok: false, reason: "conflict" } };
          if (!existing) return { result: { ok: true, draft: null } };
          const rest = { ...fresh.inboxDrafts };
          delete rest[scope];
          return {
            patch: { inboxDrafts: rest },
            result: { ok: true, draft: null },
            persisted: () => {
              const drafts = storedInboxDrafts();
              return !!drafts && !(scope in drafts);
            },
          };
        });
      },

      setInboxSendOp(scope, op, expected, now = new Date()) {
        return commitFresh<InboxSendOpResult>((fresh) => {
          if ((fresh.inboxSendOps[scope]?.operationId ?? null) !== expected)
            return { result: { ok: false, reason: "conflict" } };
          const prior = fresh.inboxSendOps[scope];
          let receiptVersion = op.receiptVersion;
          // DT-6B-2A-R1 (2A-2): about the same operation, a settled receipt is final, an unknown one only settles, and
          // an older Worker version never replaces a newer one. A local step keeps the version it found.
          if (prior?.operationId === op.operationId) {
            const settled = INBOX_SEND_SETTLED.includes(prior.state);
            if (
              (settled && op.state !== prior.state) ||
              (prior.state === "unknown" &&
                op.state !== "unknown" &&
                !INBOX_SEND_SETTLED.includes(op.state)) ||
              (receiptVersion !== undefined && receiptVersion < (prior.receiptVersion ?? 0))
            )
              return { result: { ok: false, reason: "stale" } };
            receiptVersion ??= prior.receiptVersion;
          }
          const parsed = InboxSendOpSchema.safeParse({
            ...op,
            receiptVersion,
            updatedAt: now.toISOString(),
            commitId: newId(),
          });
          if (!scope || scope.length > 1000 || !parsed.success)
            return { result: { ok: false, reason: "invalid" } };
          const next = parsed.data;
          // DT-6B-2A-R1 (2A-3): the cap drops settled handles only, the oldest first; with no room a new scope is refused.
          const others = Object.entries(fresh.inboxSendOps).filter(([k]) => k !== scope);
          const over = others.length + 1 - INBOX_SEND_OPS_MAX;
          const drop = new Set(
            others
              .filter(([, o]) => INBOX_SEND_SETTLED.includes(o.state))
              .sort(([, a], [, b]) => a.updatedAt.localeCompare(b.updatedAt))
              .slice(0, Math.max(0, over))
              .map(([k]) => k),
          );
          if (!prior && over > drop.size) return { result: { ok: false, reason: "capacity" } };
          const kept = others.filter(([k]) => !drop.has(k));
          return {
            patch: { inboxSendOps: Object.fromEntries([...kept, [scope, next]]) },
            result: { ok: true, op: next },
            persisted: () => storedSendOps()?.[scope]?.commitId === next.commitId,
          };
        });
      },

      clearInboxSendOp(scope, operationId) {
        return commitFresh<InboxSendOpResult>((fresh) => {
          const existing = fresh.inboxSendOps[scope];
          if (!existing) return { result: { ok: true, op: null } };
          if (existing.operationId !== operationId)
            return { result: { ok: false, reason: "conflict" } };
          const rest = { ...fresh.inboxSendOps };
          delete rest[scope];
          return {
            patch: { inboxSendOps: rest },
            result: { ok: true, op: null },
            persisted: () => {
              const ops = storedSendOps();
              return !!ops && !(scope in ops);
            },
          };
        });
      },

      async setInboxThreadsSendOp(scope, op, expected, now = new Date()) {
        const r = await commitFresh<InboxThreadsSendOpResult>((fresh) => {
          const ops = fresh.inboxThreadsSendOps;
          if ((ops[scope]?.operationId ?? null) !== expected)
            return { result: { ok: false, reason: "conflict" } };
          const prior = ops[scope];
          const same = prior?.operationId === op.operationId;
          if (same) {
            const refused = threadsSendStep(prior, op);
            if (refused) return { result: { ok: false, reason: refused } };
          }
          const parsed = InboxThreadsSendOpSchema.safeParse({
            ...op,
            // A local step keeps the version (and ids) the stored receipt proved.
            ...(same
              ? {
                  receiptVersion: op.receiptVersion ?? prior.receiptVersion,
                  containerId: op.containerId ?? prior.containerId,
                  publishedId: op.publishedId ?? prior.publishedId,
                  workerOrigin: op.workerOrigin ?? prior.workerOrigin,
                }
              : {}),
            updatedAt: now.toISOString(),
            commitId: newId(),
          });
          if (!scope || scope.length > 1000 || !parsed.success)
            return { result: { ok: false, reason: "invalid" } };
          const next = Object.fromEntries(
            Object.entries(parsed.data).filter(([, v]) => v !== undefined),
          ) as InboxThreadsSendOp;
          // The cap drops settled handles only, the oldest first; with no room a new scope is refused.
          const others = Object.entries(ops).filter(([k]) => k !== scope);
          const over = others.length + 1 - INBOX_SEND_OPS_MAX;
          const drop = new Set(
            others
              .filter(([, o]) => INBOX_THREADS_SEND_SETTLED.includes(o.state))
              .sort(([, a], [, b]) => a.updatedAt.localeCompare(b.updatedAt))
              .slice(0, Math.max(0, over))
              .map(([k]) => k),
          );
          if (!prior && over > drop.size) return { result: { ok: false, reason: "capacity" } };
          const kept = others.filter(([k]) => !drop.has(k));
          return {
            patch: { inboxThreadsSendOps: Object.fromEntries([...kept, [scope, next]]) },
            result: { ok: true, op: next },
            persisted: () => storedThreadsSendOps()?.[scope]?.commitId === next.commitId,
          };
        });
        // Read back after the commit returned, outside its lock: what is durable now, not only what was written.
        return r.ok ? { ...r, current: storedThreadsSendOps()?.[scope] ?? null } : r;
      },

      clearInboxThreadsSendOp(scope, operationId) {
        return commitFresh<InboxThreadsSendOpResult>((fresh) => {
          const existing = fresh.inboxThreadsSendOps[scope];
          if (!existing) return { result: { ok: true, op: null } };
          if (existing.operationId !== operationId)
            return { result: { ok: false, reason: "conflict" } };
          const rest = { ...fresh.inboxThreadsSendOps };
          delete rest[scope];
          return {
            patch: { inboxThreadsSendOps: rest },
            result: { ok: true, op: null },
            persisted: () => {
              const ops = storedThreadsSendOps();
              return !!ops && !(scope in ops);
            },
          };
        });
      },

      async setInboxInstagramSendOp(scope, op, expected, now = new Date()) {
        const r = await commitFresh<InboxInstagramSendOpResult>((fresh) => {
          const ops = fresh.inboxInstagramSendOps;
          if ((ops[scope]?.operationId ?? null) !== expected)
            return { result: { ok: false, reason: "conflict" } };
          const prior = ops[scope];
          const same = prior?.operationId === op.operationId;
          if (same) {
            const refused = igSendStep(prior, op);
            if (refused) return { result: { ok: false, reason: refused } };
          }
          const parsed = InboxInstagramSendOpSchema.safeParse({
            ...op,
            // A local step keeps the version, the learned send generation and the reply id the stored receipt proved.
            ...(same
              ? {
                  receiptVersion: op.receiptVersion ?? prior.receiptVersion,
                  sendGeneration: op.sendGeneration ?? prior.sendGeneration,
                  providerReplyId: op.providerReplyId ?? prior.providerReplyId,
                }
              : {}),
            updatedAt: now.toISOString(),
            commitId: newId(),
          });
          if (!scope.startsWith("instagram|") || scope.length > 1000 || !parsed.success)
            return { result: { ok: false, reason: "invalid" } };
          const next = Object.fromEntries(
            Object.entries(parsed.data).filter(([, v]) => v !== undefined),
          ) as InboxInstagramSendOp;
          // The cap drops settled handles only, the oldest first; with no room a new scope is refused.
          const others = Object.entries(ops).filter(([k]) => k !== scope);
          const over = others.length + 1 - INBOX_SEND_OPS_MAX;
          const drop = new Set(
            others
              .filter(([, o]) => INBOX_IG_SEND_SETTLED.includes(o.state))
              .sort(([, a], [, b]) => a.updatedAt.localeCompare(b.updatedAt))
              .slice(0, Math.max(0, over))
              .map(([k]) => k),
          );
          if (!prior && over > drop.size) return { result: { ok: false, reason: "capacity" } };
          const kept = others.filter(([k]) => !drop.has(k));
          return {
            patch: { inboxInstagramSendOps: Object.fromEntries([...kept, [scope, next]]) },
            result: { ok: true, op: next },
            persisted: () => storedInstagramSendOps()?.[scope]?.commitId === next.commitId,
          };
        });
        // Read back after the commit returned, outside its lock: what is durable now, not only what was written.
        return r.ok ? { ...r, current: storedInstagramSendOps()?.[scope] ?? null } : r;
      },

      clearInboxInstagramSendOp(scope, operationId) {
        return commitFresh<InboxInstagramSendOpResult>((fresh) => {
          const existing = fresh.inboxInstagramSendOps[scope];
          if (!existing) return { result: { ok: true, op: null } };
          if (existing.operationId !== operationId)
            return { result: { ok: false, reason: "conflict" } };
          const rest = { ...fresh.inboxInstagramSendOps };
          delete rest[scope];
          return {
            patch: { inboxInstagramSendOps: rest },
            result: { ok: true, op: null },
            persisted: () => {
              const ops = storedInstagramSendOps();
              return !!ops && !(scope in ops);
            },
          };
        });
      },

      clearInboxInstagramSendOpIf(scope, expected) {
        return commitFresh<InboxInstagramSendOpResult>((fresh) => {
          const existing = fresh.inboxInstagramSendOps[scope];
          if (!existing) return { result: { ok: true, op: null } };
          if (
            existing.operationId !== expected.operationId ||
            existing.state !== expected.state ||
            existing.receiptVersion !== expected.receiptVersion ||
            (expected.commitId !== undefined && existing.commitId !== expected.commitId)
          )
            return { result: { ok: false, reason: "stale", current: existing } };
          const rest = { ...fresh.inboxInstagramSendOps };
          delete rest[scope];
          return {
            patch: { inboxInstagramSendOps: rest },
            result: { ok: true, op: null },
            persisted: () => {
              const ops = storedInstagramSendOps();
              return !!ops && !(scope in ops);
            },
          };
        });
      },

      // `why` names the transition for the reader; the hook alone decides which refusals are conclusively pre-claim.
      async rollbackInboxInstagramSendConfirm(scope, mark, _why, now = new Date()) {
        const r = await commitFresh<InboxInstagramSendOpResult>((fresh) => {
          const existing = fresh.inboxInstagramSendOps[scope];
          if (
            !existing ||
            existing.state !== "confirming" ||
            existing.operationId !== mark.operationId ||
            existing.commitId !== mark.commitId
          )
            return { result: { ok: false, reason: "stale", current: existing ?? null } };
          const next: InboxInstagramSendOp = {
            ...existing,
            state: "prepared",
            updatedAt: now.toISOString(),
            commitId: newId(),
          };
          return {
            patch: { inboxInstagramSendOps: { ...fresh.inboxInstagramSendOps, [scope]: next } },
            result: { ok: true, op: next },
            persisted: () => storedInstagramSendOps()?.[scope]?.commitId === next.commitId,
          };
        });
        // Read back after the commit returned, outside its lock (as setInboxInstagramSendOp).
        return r.ok ? { ...r, current: storedInstagramSendOps()?.[scope] ?? null } : r;
      },

      async setInboxInstagramDmSendOp(key, op, expected, now = new Date()) {
        const r = await commitFresh<InboxInstagramDmSendOpResult>((fresh) => {
          const ops = fresh.inboxInstagramDmSendOps;
          if ((ops[key]?.operationId ?? null) !== expected)
            return { result: { ok: false, reason: "conflict" } };
          const prior = ops[key];
          const same = prior?.operationId === op.operationId;
          if (same) {
            const refused = igDmStep(prior, op);
            if (refused) return { result: { ok: false, reason: refused } };
          }
          const parsed = InboxInstagramDmSendOpSchema.safeParse({
            ...op,
            // A local step keeps what the stored receipt proved: version, inbound time, send generation, message id,
            // and (still dispatching) the first observation of a lost settlement.
            ...(same
              ? {
                  receiptVersion: op.receiptVersion ?? prior.receiptVersion,
                  inboundAt: op.inboundAt ?? prior.inboundAt,
                  sendGeneration: op.sendGeneration ?? prior.sendGeneration,
                  providerMessageId: op.providerMessageId ?? prior.providerMessageId,
                  pending: op.state === "dispatching" ? (prior.pending ?? op.pending) : undefined,
                }
              : {}),
            updatedAt: now.toISOString(),
            commitId: newId(),
          });
          if (
            !parsed.success ||
            key !==
              dmOpKey(
                parsed.data.workerOrigin,
                parsed.data.account,
                parsed.data.conversationId,
                parsed.data.inboundMessageId,
              )
          )
            return { result: { ok: false, reason: "invalid" } };
          const next = Object.fromEntries(
            Object.entries(parsed.data).filter(([, v]) => v !== undefined),
          ) as InboxInstagramDmSendOp;
          // The cap drops settled handles only, the oldest first; with no room a new key is refused.
          const others = Object.entries(ops).filter(([k]) => k !== key);
          const over = others.length + 1 - INBOX_SEND_OPS_MAX;
          const drop = new Set(
            others
              .filter(([, o]) => INBOX_IG_DM_SETTLED.includes(o.state))
              .sort(([, a], [, b]) => a.updatedAt.localeCompare(b.updatedAt))
              .slice(0, Math.max(0, over))
              .map(([k]) => k),
          );
          if (!prior && over > drop.size) return { result: { ok: false, reason: "capacity" } };
          const kept = others.filter(([k]) => !drop.has(k));
          return {
            patch: { inboxInstagramDmSendOps: Object.fromEntries([...kept, [key, next]]) },
            result: { ok: true, op: next },
            persisted: () => storedInstagramDmSendOps()?.[key]?.commitId === next.commitId,
          };
        });
        // Read back after the commit returned, outside its lock: what is durable now, not only what was written.
        return r.ok ? { ...r, current: storedInstagramDmSendOps()?.[key] ?? null } : r;
      },

      clearInboxInstagramDmSendOp(key, operationId) {
        return commitFresh<InboxInstagramDmSendOpResult>((fresh) => {
          const existing = fresh.inboxInstagramDmSendOps[key];
          if (!existing) return { result: { ok: true, op: null } };
          if (existing.operationId !== operationId)
            return { result: { ok: false, reason: "conflict" } };
          const rest = { ...fresh.inboxInstagramDmSendOps };
          delete rest[key];
          return {
            patch: { inboxInstagramDmSendOps: rest },
            result: { ok: true, op: null },
            persisted: () => {
              const ops = storedInstagramDmSendOps();
              return !!ops && !(key in ops);
            },
          };
        });
      },

      clearInboxInstagramDmSendOpIf(key, expected) {
        return commitFresh<InboxInstagramDmSendOpResult>((fresh) => {
          const existing = fresh.inboxInstagramDmSendOps[key];
          if (!existing) return { result: { ok: true, op: null } };
          if (
            existing.operationId !== expected.operationId ||
            existing.state !== expected.state ||
            existing.receiptVersion !== expected.receiptVersion ||
            (expected.commitId !== undefined && existing.commitId !== expected.commitId)
          )
            return { result: { ok: false, reason: "stale", current: existing } };
          const rest = { ...fresh.inboxInstagramDmSendOps };
          delete rest[key];
          return {
            patch: { inboxInstagramDmSendOps: rest },
            result: { ok: true, op: null },
            persisted: () => {
              const ops = storedInstagramDmSendOps();
              return !!ops && !(key in ops);
            },
          };
        });
      },

      // `why` names the transition for the reader; the hook alone decides which refusals are conclusively pre-claim.
      async rollbackInboxInstagramDmSendConfirm(key, mark, _why, now = new Date()) {
        const r = await commitFresh<InboxInstagramDmSendOpResult>((fresh) => {
          const existing = fresh.inboxInstagramDmSendOps[key];
          if (
            !existing ||
            existing.state !== "confirming" ||
            existing.operationId !== mark.operationId ||
            existing.commitId !== mark.commitId
          )
            return { result: { ok: false, reason: "stale", current: existing ?? null } };
          const next: InboxInstagramDmSendOp = {
            ...existing,
            state: "prepared",
            updatedAt: now.toISOString(),
            commitId: newId(),
          };
          return {
            patch: { inboxInstagramDmSendOps: { ...fresh.inboxInstagramDmSendOps, [key]: next } },
            result: { ok: true, op: next },
            persisted: () => storedInstagramDmSendOps()?.[key]?.commitId === next.commitId,
          };
        });
        return r.ok ? { ...r, current: storedInstagramDmSendOps()?.[key] ?? null } : r;
      },

      async setInboxInstagramDmControl(key, entry, expectedCommit, now = new Date()) {
        const r = await commitFresh<InboxInstagramDmControlResult>((fresh) => {
          const all = fresh.inboxInstagramDmControls;
          const prior = all[key];
          if ((prior?.commitId ?? null) !== expectedCommit)
            return { result: { ok: false, reason: "conflict", current: prior ?? null } };
          if (!entry) {
            if (!prior) return { result: { ok: true, entry: null } };
            // A verified handle is recovery authority: it is never let go of.
            if (prior.handleId) return { result: { ok: false, reason: "invalid" } };
            const rest = { ...all };
            delete rest[key];
            return {
              patch: { inboxInstagramDmControls: rest },
              result: { ok: true, entry: null },
              persisted: () => {
                const got = storedInstagramDmControls();
                return !!got && !(key in got);
              },
            };
          }
          const refused = prior && igDmControlStep(prior, entry);
          if (refused) return { result: { ok: false, reason: refused, current: prior } };
          const parsed = InboxInstagramDmControlSchema.safeParse({
            ...entry,
            updatedAt: now.toISOString(),
            commitId: newId(),
          });
          if (
            !parsed.success ||
            key !==
              dmControlKey(
                parsed.data.workerOrigin,
                parsed.data.account,
                parsed.data.conversationId,
              )
          )
            return { result: { ok: false, reason: "invalid" } };
          const next = Object.fromEntries(
            Object.entries(parsed.data).filter(([, v]) => v !== undefined),
          ) as InboxInstagramDmControl;
          // The cap drops idle entries only, the oldest first; with no room a new key is refused.
          const others = Object.entries(all).filter(([k]) => k !== key);
          const over = others.length + 1 - INBOX_IG_DM_CONTROLS_MAX;
          const drop = new Set(
            others
              .filter(([, e]) => !isUnresolvedDmControl(e))
              .sort(([, a], [, b]) => a.updatedAt.localeCompare(b.updatedAt))
              .slice(0, Math.max(0, over))
              .map(([k]) => k),
          );
          if (!prior && over > drop.size) return { result: { ok: false, reason: "capacity" } };
          const kept = others.filter(([k]) => !drop.has(k));
          return {
            patch: { inboxInstagramDmControls: Object.fromEntries([...kept, [key, next]]) },
            result: { ok: true, entry: next },
            persisted: () => storedInstagramDmControls()?.[key]?.commitId === next.commitId,
          };
        });
        return r.ok ? { ...r, current: storedInstagramDmControls()?.[key] ?? null } : r;
      },

      addBrandDeal(input, now = new Date()) {
        const at = now.toISOString();
        const parsed = BrandDealSchema.safeParse({
          ...input,
          id: newId(),
          commitId: newId(),
          createdAt: at,
          updatedAt: at,
        });
        if (!parsed.success) return Promise.resolve({ ok: false, reason: "invalid" } as const);
        const deal = parsed.data;
        return commitDeal((fresh) => ({ deals: [...fresh, deal], deal }));
      },

      updateBrandDeal(id, patch, base, now = new Date()) {
        return editDeal(id, patch, base, now);
      },

      setBrandDealStage(id, stage, base, now = new Date()) {
        return editDeal(id, { stage }, base, now);
      },

      runWorkflowNow(id, opts = {}, now = new Date()) {
        // ⚙️ DT-7C-2B-3: only a provably local workflow runs here (verified before the lock, decided inside it).
        const go = (verified: Verified) =>
          commitFresh<WorkflowRunResult>((fresh) => {
            const w = fresh.workflows.find((x) => x.id === id);
            if (!w) return { result: { ok: false, reason: "missing" } };
            if (!w.enabled) return { result: { ok: false, reason: "paused" } };
            if (workflowIssues(w).length) return { result: { ok: false, reason: "issues" } };
            if (!provablyLocal(fresh, [id], verified))
              return { result: { ok: false, reason: "not-local" } };
            const lang = fresh.settings.lang;
            let input = manualInput(lang, now);
            if (w.trigger.kind === "article-ready") {
              const a = fresh.articles.find((x) => x.id === opts.articleId);
              if (!a || a.status === "archived")
                return { result: { ok: false, reason: "needs-article" } };
              input = articleInput(a, lang, now);
            }
            const run = newRun(w, "manual", input, now);
            return { ...enqueueRuns(fresh.workflowRuns, [run]), result: { ok: true, run } };
          });
        const proof = legacyProof([id]);
        return proof instanceof Promise ? proof.then(go) : go(proof);
      },

      retryWorkflowRun(runId, now = new Date()) {
        return commitFresh<WorkflowRunResult>((fresh) => {
          const old = fresh.workflowRuns.find((r) => r.id === runId);
          if (!old) return { result: { ok: false, reason: "missing" } };
          if (old.status !== "partial" && old.status !== "failed")
            return { result: { ok: false, reason: "not-retryable" } };
          const { finishedAt: _finishedAt, ...rest } = old;
          void _finishedAt;
          const run: WorkflowRun = {
            ...rest,
            status: "queued",
            attempt: old.attempt + 1,
            commitId: newId(),
            updatedAt: now.toISOString(),
            steps: old.steps.map((s) =>
              s.status === "done" ? s : { actionId: s.actionId, status: "pending" },
            ),
          };
          return {
            patch: { workflowRuns: fresh.workflowRuns.map((r) => (r.id === runId ? run : r)) },
            result: { ok: true, run },
            persisted: () => storedCommit("workflowRuns", runId) === run.commitId,
          };
        });
      },

      async drainWorkflowRuns(now) {
        let resumed = 0;
        for (;;) {
          const r = await commitFresh((fresh) => drainStep(fresh, now ?? new Date()));
          if (r.ok && r.stepped) {
            resumed += 1;
            continue;
          }
          const stopped = r.ok ? undefined : r.reason;
          workflowDrain.setState({ stopped }, true);
          const remaining = get().workflowRuns.filter(
            (x) => x.status === "queued" || x.status === "running",
          ).length;
          return stopped ? { resumed, remaining, stopped } : { resumed, remaining };
        }
      },

      markInboxSeen(key, at) {
        if (!key || Number.isNaN(Date.parse(at))) return;
        const seen = get().inboxSeen;
        if (seen[key] && seen[key] >= at) return;
        set({ inboxSeen: { ...seen, [key]: at } });
      },

      pruneInboxSeen(keep) {
        if (!Array.isArray(keep)) return;
        const want = new Set(keep.filter((k) => typeof k === "string"));
        const seen = get().inboxSeen;
        const kept = Object.entries(seen).filter(([k]) => want.has(k));
        if (kept.length < Object.keys(seen).length) set({ inboxSeen: Object.fromEntries(kept) });
      },

      setInboxTab(tab) {
        const parsed = InboxTabSchema.safeParse(tab);
        if (parsed.success) set({ inboxTab: parsed.data });
      },

      exportState(now = new Date()) {
        if (get().discoverLibraryStatus === "loading")
          throw new Error("Candidate library is still loading");
        const file: ExportFile = {
          app: "3z-prod",
          version: STORE_VERSION,
          exportedAt: now.toISOString(),
          state: {
            ...pick(get()),
            discoverLibraryEpoch: "",
            discoverLibraryPendingReplacement: false,
          },
        };
        return JSON.stringify(file, null, 2);
      },

      importState(json) {
        const file = ExportFileSchema.parse(JSON.parse(json));
        // DT-7C-2A: a journal slice must be exactly a journal (structurally invalid = an invalid file, before anything
        // changes); a backup without one (legacy) keeps the device's journal.
        const hasJournal = file.state.cloudJournal !== undefined;
        const imported = hasJournal ? parseJournal(file.state.cloudJournal) : null;
        if (hasJournal && !imported) throw new Error("Invalid cloud journal");
        // DT-7C-2B-2: the same for the registration slice (a backup without it keeps the device's).
        const hasRegistrations = file.state.cloudRegistrations !== undefined;
        const importedRegistrations = hasRegistrations
          ? parseRegistrations(file.state.cloudRegistrations)
          : null;
        if (hasRegistrations && !importedRegistrations)
          throw new Error("Invalid cloud registrations");
        // DT-7C-2C: the same for the reconciliation slice (a backup without it keeps the device's).
        const hasRecon = file.state.cloudReconciliation !== undefined;
        const importedRecon = hasRecon ? parseReconciliation(file.state.cloudReconciliation) : null;
        if (hasRecon && !importedRecon) throw new Error("Invalid cloud reconciliation");
        /** DT-7C-2C: the current reconciliation as verified under the lock (set in `go`). */
        let verifiedRecon: CloudReconciliation | null = null;
        const epoch = newId();
        /** DT-7C-2B-2-R1: the current registration slice as verified under the lock (set in `go`). */
        let verifiedRegs: CloudRegistrations | null = null;
        /*
         * DT-6B-2C-5B-R1: the control slice merges into what storage holds NOW (another tab's pending action is never
         * overwritten from this tab's memory), the whole restore is one write, and it counts only once read back (the
         * epoch and every control commit); otherwise memory goes back and nothing is reported as restored.
         * DT-7C-2A: so does the cloud journal (merged into the fresh durable journal, read back exactly); a refused
         * merge writes nothing and replaces no candidate library.
         */
        const restore = (): ImportStateResult => {
          // DT-7C-2A-R1: unreadable storage (any outer shape but an object `state`) is never written over.
          if (typeof window !== "undefined" && storedPayload().kind === "unreadable")
            return { ok: false, reason: "not-persisted" };
          const fresh = durableControls(get().inboxInstagramDmControls);
          if (!fresh) return { ok: false, reason: "not-persisted" };
          // A backup without the slice leaves the stored journal exactly as it is (it is not written); one with it is
          // merged into the fresh durable journal.
          const slice = storedJournalSlice();
          const freshJournal = imported ? durableJournal() : null;
          if (imported && !freshJournal) return { ok: false, reason: "journal-unreadable" };
          const merged =
            imported && freshJournal ? mergeJournals(freshJournal, imported, newId()) : null;
          if (merged && !merged.ok)
            return merged.reason === "conflict"
              ? { ok: false, reason: "journal-conflict", keys: merged.keys }
              : { ok: false, reason: "journal-capacity" };
          const journal: unknown = merged ? merged.journal : slice;
          // DT-7C-2B-2: registrations merge monotonically into the fresh durable slice (read back), or stay verbatim.
          const regSlice = storedRegistrationsSlice();
          const freshRegs = importedRegistrations ? durableRegistrations() : null;
          if (importedRegistrations && !freshRegs)
            return { ok: false, reason: "journal-unreadable", scope: "registrations" };
          // DT-7C-2B-2-R1: only the snapshot verified under this lock may merge; any other bytes refuse (fail closed).
          if (freshRegs && !(verifiedRegs && registrationsIs(freshRegs, verifiedRegs)))
            return { ok: false, reason: "journal-invalid", scope: "registrations" };
          const mergedRegs =
            importedRegistrations && freshRegs
              ? mergeRegistrations(freshRegs, importedRegistrations)
              : null;
          if (mergedRegs && !mergedRegs.ok)
            return mergedRegs.reason === "conflict"
              ? {
                  ok: false,
                  reason: "journal-conflict",
                  keys: mergedRegs.keys,
                  scope: "registrations",
                }
              : { ok: false, reason: "journal-capacity", scope: "registrations" };
          const registrations: unknown = mergedRegs ? mergedRegs.next : regSlice;
          // DT-7C-2C: the reconciliation merges monotonically into the fresh durable slice verified under this lock; the
          // backup's drafts lose every owned-and-deleted id, and owned outputs the import removes are recorded deleted.
          const reconSlice = storedReconSlice();
          const freshRecon = durableRecon();
          if (freshRecon?.authorities.some((a) => (a.watermark ?? 0) > 0))
            return {
              ok: false,
              reason: "journal-conflict",
              scope: "reconciliation",
              keys: freshRecon.authorities.filter((a) => (a.watermark ?? 0) > 0).map((a) => a.key),
            };
          if (importedRecon && !freshRecon)
            return { ok: false, reason: "journal-unreadable", scope: "reconciliation" };
          if (importedRecon && !(verifiedRecon && freshRecon && same(freshRecon, verifiedRecon)))
            return { ok: false, reason: "journal-invalid", scope: "reconciliation" };
          // The fresh merged reset applies to proofs and retired markers first learned from the backup (unknown = refuse).
          const suppression = (merged ? merged.journal : durableJournal())?.suppression;
          if (
            importedRecon &&
            (importedRecon.proofs.length || importedRecon.tombstones.length) &&
            !suppression
          )
            return { ok: false, reason: "journal-unreadable", scope: "reconciliation" };
          const mergedRecon =
            importedRecon && freshRecon
              ? mergeReconciliations(freshRecon, importedRecon, {
                  suppression,
                  present: listsOf(get()),
                })
              : null;
          if (mergedRecon && !mergedRecon.ok)
            return mergedRecon.reason === "conflict"
              ? {
                  ok: false,
                  reason: "journal-conflict",
                  keys: mergedRecon.keys,
                  scope: "reconciliation",
                }
              : { ok: false, reason: "journal-capacity", scope: "reconciliation" };
          const baseRecon = mergedRecon ? mergedRecon.next : freshRecon;
          const drafts = baseRecon
            ? dropDeleted(
                {
                  ideas: file.state.ideas,
                  posts: file.state.posts,
                  planItems: file.state.planItems,
                },
                baseRecon,
                mergedRecon?.ok ? mergedRecon.drop : [],
              )
            : { ideas: file.state.ideas, posts: file.state.posts, planItems: file.state.planItems };
          const reconNext =
            baseRecon && freshRecon
              ? stamp(freshRecon, applyDeletions(baseRecon, listsOf(get()), drafts), newId())
              : null;
          const recon: unknown = reconNext && reconNext !== freshRecon ? reconNext : reconSlice;
          const rejected: string[] = [];
          const controls = mergeInstagramDmControls(
            fresh,
            file.state.inboxInstagramDmControls,
            rejected,
          );
          const patch: Partial<StoreState> = {
            ...file.state,
            discoverLibraryEpoch: epoch,
            discoverLibraryPendingReplacement: true,
            rewards: ensureBuiltInRewards(file.state.rewards),
            inboxInstagramDmControls: controls,
            cloudJournal: journal,
            cloudRegistrations: registrations,
            ideas: drafts.ideas,
            posts: drafts.posts,
            planItems: drafts.planItems,
            cloudReconciliation: recon,
          };
          // DT-7C-2A-R1: memory was rehydrated under the lock just before (`go`), so this is the DURABLE pre-restore
          // state, never this tab's older memory; the journal is the stored slice exactly.
          const before: Partial<StoreState> = {
            ...Object.fromEntries(Object.keys(patch).map((k) => [k, get()[k as keyof StoreState]])),
            inboxInstagramDmControls: fresh,
            cloudJournal: slice,
            cloudRegistrations: regSlice,
            cloudReconciliation: reconSlice,
          };
          articlesGen += 1;
          try {
            writeHeld("all", () => set(patch));
          } catch {
            // A quota error from the write: the read-back below decides.
          }
          const journalKept = merged
            ? storedJournalIs(merged.journal)
            : sameSlice(storedJournalSlice(), slice);
          const registrationsKept = mergedRegs
            ? registrationsIs(storedRegistrationsSlice(), mergedRegs.next)
            : sameSlice(storedRegistrationsSlice(), regSlice);
          const reconKept =
            recon === reconSlice
              ? sameSlice(storedReconSlice(), reconSlice)
              : storedReconIs(recon as CloudReconciliation);
          if (restoredDurably(epoch, controls) && journalKept && registrationsKept && reconKept) {
            candidateLibrary().replace();
            const retired = mergedRecon?.ok ? [...mergedRecon.retired] : [];
            return retired.length ? { ok: true, rejected, retired } : { ok: true, rejected };
          }
          rollBack(epoch, before);
          return { ok: false, reason: "not-persisted" };
        };
        // The same lock as commitFresh and every control action. Without Web Locks no control or journal action can
        // persist at all (each refuses as unsupported), so a restore that leaves the journal alone runs at once; one
        // that writes the journal refuses (planner ruling), before anything is validated or written.
        if ((hasJournal || hasRegistrations || hasRecon) && !articlesLock())
          return Promise.resolve({ ok: false, reason: "unsupported-save" });
        // DT-7C-2A-R1: rehydrate first (inside the lock when there is one), so the rollback is the durable state. The
        // storage is synchronous, so without the lock this stays one synchronous step, as before.
        const go = (): Promise<ImportStateResult> => {
          const run = () => {
            void useStore.persist.rehydrate();
            return restore();
          };
          const lock = articlesLock();
          // DT-7C-2B-2-R1: a registration-bearing restore (always locked, see above) first verifies the CURRENT durable
          // slice through the pinned parser, as read under the lock; `restore` then merges only that exact snapshot.
          return lock
            ? lock<ImportStateResult>(async () => {
                // DT-7C-2C: a reconciliation-bearing restore verifies the CURRENT durable slice the same way.
                if (importedRecon) {
                  const current = durableRecon();
                  if (current && !(await reconVerified(current)))
                    return { ok: false, reason: "journal-invalid", scope: "reconciliation" };
                  verifiedRecon = current;
                }
                if (!importedRegistrations) return run();
                const current = durableRegistrations();
                if (current && !(await verifyRegistrations(current)))
                  return { ok: false, reason: "journal-invalid", scope: "registrations" };
                verifiedRegs = current;
                return run();
              })
            : Promise.resolve(run());
        };
        // DT-7C-2A: imported bodies and receipts are revalidated (digests, pinned parser) BEFORE the lock; only a
        // backup that carries journal entries waits for it.
        // DT-7C-2B-2: so are imported registration answers (pinned parser), also before the lock.
        const registrationsCheck = importedRegistrations?.records.length
          ? verifyRegistrations(importedRegistrations)
          : null;
        const reconCheck = importedRecon?.proofs.length ? reconVerified(importedRecon) : null;
        if (!imported?.entries.length && !registrationsCheck && !reconCheck) return go();
        return Promise.all([
          imported?.entries.length ? verifyJournal(imported) : { ok: true as const, rejected: [] },
          registrationsCheck ?? true,
          reconCheck ?? true,
        ]).then(([v, r, c]): Promise<ImportStateResult> | ImportStateResult =>
          !(v.ok && v.rejected.length === 0)
            ? { ok: false, reason: "journal-invalid" }
            : !r
              ? { ok: false, reason: "journal-invalid", scope: "registrations" }
              : !c
                ? { ok: false, reason: "journal-invalid", scope: "reconciliation" }
                : go(),
        );
      },

      reset(now = new Date()) {
        /*
         * DT-7C-2A: ordinary content is cleared, the cloud journal is KEPT (read fresh from storage; unreadable = no
         * reset at all) with its suppression advanced, all in one write proven by an exact read-back of the journal and
         * the new library epoch. A failure writes the pre-reset state back (never over a newer journal) and replaces no
         * candidate library. Without the lock (planner ruling) only a reset with no journal entries runs, and it writes no
         * journal at all (the stored slice is left exactly as it is; no suppression advance); with entries it refuses as
         * `unsupported-save` before writing.
         */
        const run = (advance: boolean): ResetResult => {
          const browser = typeof window !== "undefined";
          if (browser) {
            if (!storageDurable()) return { ok: false, reason: "not-persisted" };
            if (window.localStorage.getItem(STORAGE_KEY) !== null && !storedPayloadValid())
              return { ok: false, reason: "not-persisted" };
          }
          const journal = durableJournal();
          if (!journal) return { ok: false, reason: "journal-unreadable" };
          if (!advance && journal.entries.length) return { ok: false, reason: "unsupported-save" };
          // DT-7C-2C: the reconciliation is kept; every owned output the reset clears is recorded deleted (same write).
          // An unreadable slice stays verbatim. Without the lock, a reset that would author it refuses like the journal.
          const reconSlice = storedReconSlice();
          const freshRecon = durableRecon();
          const reconNext = freshRecon
            ? stamp(freshRecon, applyDeletions(freshRecon, listsOf(get()), NO_LISTS), newId())
            : null;
          if (!advance && reconNext && reconNext !== freshRecon)
            return { ok: false, reason: "unsupported-save" };
          const recon: unknown = reconNext && reconNext !== freshRecon ? reconNext : reconSlice;
          const next = advance ? resetJournal(journal, now, newId()) : null;
          const slice = storedJournalSlice();
          // DT-7C-2B-2: registration intents (unresolved recovery included) are kept exactly as stored.
          const regSlice = storedRegistrationsSlice();
          const epoch = newId();
          const patch: Partial<StoreState> = {
            ...initialData(),
            discoverLibraryEpoch: epoch,
            discoverLibraryPendingReplacement: true,
            cloudJournal: next ?? slice,
            cloudRegistrations: regSlice,
            cloudReconciliation: recon,
          };
          const before: Partial<StoreState> = {
            ...Object.fromEntries(Object.keys(patch).map((k) => [k, get()[k as keyof StoreState]])),
            ...(browser
              ? {
                  cloudJournal: slice,
                  cloudRegistrations: regSlice,
                  cloudReconciliation: reconSlice,
                }
              : {}),
          };
          articlesGen += 1;
          try {
            writeHeld("all", () => set(patch));
          } catch {
            // A quota error from the write: the read-back below decides.
          }
          // Without a browser the store is memory-only: there is nothing durable to prove or to protect.
          const journalKept = next ? storedJournalIs(next) : sameSlice(storedJournalSlice(), slice);
          const registrationsKept = sameSlice(storedRegistrationsSlice(), regSlice);
          const reconKept =
            recon === reconSlice
              ? sameSlice(storedReconSlice(), reconSlice)
              : storedReconIs(recon as CloudReconciliation);
          if (
            !browser ||
            (journalKept && registrationsKept && reconKept && storedLibraryEpoch() === epoch)
          ) {
            candidateLibrary().replace();
            return { ok: true, retained: next ? next.entries.length : 0 };
          }
          rollBack(epoch, before);
          return { ok: false, reason: "not-persisted" };
        };
        // The journal-writing reset runs under the same lock as commitFresh, journal commits and restores, after a fresh
        // rehydration (so the rollback is the durable pre-reset state). No browser: memory-only. No Web Locks, or no save
        // yet (no durable journal to keep): the journal-free reset above, at once.
        if (typeof window === "undefined") return Promise.resolve(run(true));
        const lock = articlesLock();
        if (!lock || nothingSaved()) return Promise.resolve(run(false));
        return lock(async () => {
          await useStore.persist.rehydrate();
          return run(true);
        }).catch((): ResetResult => ({ ok: false, reason: "not-persisted" }));
      },

      enqueueCloudOccurrence: enqueueCloud,
      observeCloudReceipt: observeCloud,
      captureManualRun: (workflowId, opts = {}, now = new Date()) =>
        captureManual(workflowId, opts, now),
      captureArticleReady: (articleId, opts = {}, now = new Date()) =>
        captureReady(articleId, opts, now),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: serializedStorage(localJsonStorage),
      partialize: pickLocal,
      // Screens call hydrateStore() on mount, so server and first client render match.
      skipHydration: true,
      onRehydrateStorage: () => (_state, error) => {
        if (!error) void candidateLibrary().rehydrate();
      },
      merge: (persisted, current) => {
        const parsed = PersistedStateSchema.partial()
          .extend({ settings: SettingsSchema.partial().optional() })
          .safeParse(migrateLegacySettings(persisted));
        if (!parsed.success) return current;
        if (isRecord(persisted)) hydration.raw = persisted; // DT-7C-2A-C1: this hydration's base, from its one read
        const p = parsed.data;
        // Another tab imported or reset (both set a new epoch): pending article edits are invalid. Its edits to
        // one article are caught by that article's commitId, so siblings never conflict.
        if (
          p.discoverLibraryEpoch !== undefined &&
          p.discoverLibraryEpoch !== current.discoverLibraryEpoch
        )
          articlesGen += 1;
        const changedEpoch =
          p.discoverLibraryEpoch !== undefined &&
          p.discoverLibraryEpoch !== current.discoverLibraryEpoch;
        return {
          ...current,
          ...p,
          discoverCandidates: changedEpoch
            ? (p.discoverCandidates ?? [])
            : p.discoverCandidates
              ? mergeDiscoverCandidates(current.discoverCandidates, p.discoverCandidates)
              : current.discoverCandidates,
          ...(changedEpoch ? { discoverLibraryStatus: "loading" as const } : {}),
          settings: { ...current.settings, ...(p.settings ?? {}) },
          rewards: ensureBuiltInRewards(p.rewards ?? current.rewards),
        } as StoreState;
      },
    },
  ),
);
// DT-7C-2A-R2: the base starts as this tab's initial state and follows every completed rehydrate.
saveBase = { mem: pickLocal(useStore.getState()), raw: pickLocal(useStore.getState()) };
// DT-7C-2B-4: the configuration generation observer. Every setState (setters, direct updates, import, reset, rollbacks,
// rehydration) notifies synchronously; any transition of the Worker origin or token moves the in-memory fence at once.
useStore.subscribe((s, prev) => {
  const a = s.settings?.apiKeys;
  const b = prev.settings?.apiKeys;
  if (a?.scoutUrl !== b?.scoutUrl || a?.scoutToken !== b?.scoutToken) cloudConfigGen += 1;
});
// DT-7C-2A-C1: both halves from the hydration's one observation. A read the schema rejected (or a version mismatch)
// left memory as it was and records no base: the last coherent pair stays, authorizing no stale replacement.
useStore.persist.onHydrate(() => {
  hydration = {};
});
useStore.persist.onFinishHydration((s) => {
  const { none, raw } = hydration;
  hydration = {};
  const mem = pickLocal(s);
  if (raw) saveBase = { mem, raw };
  else if (none) saveBase = { mem, raw: mem };
});

/** Validate and store a post patch, bumping updatedAt. Undefined when the id is unknown. */
function patchPost(
  get: () => StoreState,
  set: (partial: Partial<StoreState>) => void,
  id: string,
  patch: PostPatch,
  now: Date,
): Post | undefined {
  const s = get();
  const existing = s.posts.find((p) => p.id === id);
  if (!existing) return undefined;
  const post = patched(existing, patch, now);
  set({ posts: s.posts.map((p) => (p.id === id ? post : p)) });
  return post;
}

/** The post with a patch merged in: validated, id and createdAt kept, updatedAt bumped. */
function patched(existing: Post, patch: PostPatch, now: Date): Post {
  return PostSchema.parse({
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now.toISOString(),
  });
}

/** Bonus freezes after adding n, keeping earned + bonus within FREEZE_TOTAL_CAP. */
function addBonusFreezes(s: PersistedState, n: number, now: Date): number {
  const earned = streak({ ...s, bonusFreezes: 0 }, now).freezes;
  return Math.max(s.bonusFreezes, Math.min(s.bonusFreezes + n, FREEZE_TOTAL_CAP - earned));
}

/** Load saved progress from localStorage. Call once on the client (e.g. in a root useEffect). */
export async function hydrateStore(): Promise<void> {
  followOtherTabs();
  // DT-7C-2A-R1: memory holds a save still waiting for the lock: it is newer than storage, so do not reload over it.
  if (!savePending) await useStore.persist.rehydrate();
  await flushDiscoverLibrary();
}

let followingOtherTabs = false;

/**
 * Every write saves the whole state, so a tab still holding an older copy would wipe what another tab saved
 * since (its publish watcher writes every minute). Reload the copy whenever another tab saves, and when the
 * page comes back from the back/forward cache, where it heard no saves.
 * ponytail: two tabs saving within the same few milliseconds can still lose one save; merge posts by
 * updatedAt if that ever shows up.
 */
function followOtherTabs(): void {
  if (followingOtherTabs || typeof window === "undefined") return;
  followingOtherTabs = true;
  // DT-7C-2A-R1: not while this tab's own save is queued (reloading would drop it from memory before it is written).
  // DT-7C-2A-R2: that save merges this tab's own changes onto what the other tab wrote (`mergeSave`), then reloads.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && e.newValue && !savePending) void useStore.persist.rehydrate();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && !savePending) void useStore.persist.rehydrate();
  });
}

/* ---------- Selectors (pure; pass the state from useStore or useStore.getState()) ---------- */
// Note: selectors that return a new object/Set (activeDays, streak, chestProgress…) must not be passed to
// useStore() directly; select the raw arrays with useShallow and compute in useMemo instead.

export function totalXp(s: Pick<PersistedState, "xpEvents">): number {
  return s.xpEvents.reduce((n, e) => n + e.amount, 0);
}

/** Gem balance: the sum of the ledger. */
export function gems(s: Pick<PersistedState, "gemEvents">): number {
  return gemBalance(s.gemEvents);
}

/** The owner's stored key for one API provider, if any (Scout v0: only "youtube" exists so far). */
export function getApiKey(
  s: Pick<PersistedState, "settings">,
  name: ApiKeyName,
): string | undefined {
  return s.settings.apiKeys[name];
}

// A `savedRefs[id] ?? []` selector would hand back a brand-new array every call when there's no entry,
// which looks like a changed snapshot to useSyncExternalStore on every render and loops forever
// ("Maximum update depth exceeded"). Falling back to this one stable array avoids that.
const EMPTY_REFS: Ref[] = [];

/** Refs saved on a skill (Scout v0), or a stable empty array when it has none. */
export function refsForSkill(s: Pick<PersistedState, "savedRefs">, skillId: string): Ref[] {
  return s.savedRefs[skillId] ?? EMPTY_REFS;
}

/** A skill's note, if the owner wrote one. */
export function noteForSkill(s: Pick<PersistedState, "notes">, skillId: string): Note | undefined {
  return s.notes[skillId];
}

/** Number of quests done on a skill, 0..4. */
export function skillProgress(s: Pick<PersistedState, "completions">, skillId: string): number {
  return new Set(s.completions.filter((c) => c.skillId === skillId).map((c) => c.quest)).size;
}

export function isQuestDone(
  s: Pick<PersistedState, "completions">,
  skillId: string,
  quest: QuestType,
): boolean {
  return s.completions.some((c) => c.skillId === skillId && c.quest === quest);
}

/** Skills with all 4 quests done. */
export function masteredSkillIds(s: Pick<PersistedState, "completions">): Set<string> {
  const done = new Map<string, Set<QuestType>>();
  for (const c of s.completions) {
    const set = done.get(c.skillId) ?? new Set<QuestType>();
    set.add(c.quest);
    done.set(c.skillId, set);
  }
  const out = new Set<string>();
  for (const [id, set] of done) if (QUEST_TYPES.every((q) => set.has(q))) out.add(id);
  return out;
}

/** Skill an XP event belongs to (quest, mastery and drill events only). */
function xpEventSkillId(e: XpEvent): string | undefined {
  if (!e.refId) return undefined;
  if (e.source === "quest") return e.refId.slice(0, e.refId.lastIndexOf(":"));
  if (e.source === "mastery" || e.source === "drill") return e.refId;
  return undefined;
}

/** XP earned from a program's skills (quest XP + mastery bonuses + drills). */
export function programXp(s: Pick<PersistedState, "xpEvents">, programId: string): number {
  let n = 0;
  for (const e of s.xpEvents) {
    const skillId = xpEventSkillId(e);
    if (skillId && getSkill(skillId)?.programId === programId) n += e.amount;
  }
  return n;
}

/** XP earned across a pillar: the sum of programXp over its programs, in one pass. */
export function pillarXp(s: Pick<PersistedState, "xpEvents">, pillarId: string): number {
  let n = 0;
  for (const e of s.xpEvents) {
    const skillId = xpEventSkillId(e);
    const programId = skillId ? getSkill(skillId)?.programId : undefined;
    if (programId && getProgram(programId)?.pillarId === pillarId) n += e.amount;
  }
  return n;
}

/** Riyadh day keys with at least one quest or micro-action. */
export function activeDays(s: Pick<PersistedState, "completions" | "microActions">): Set<string> {
  const days = new Set<string>();
  for (const c of s.completions) days.add(dayKey(c.at));
  for (const m of s.microActions) days.add(dayKey(m.at));
  return days;
}

/** Streak plus freezes in hand (earned, capped at 2, plus bonus freezes; total capped at 5). */
export function streak(
  s: Pick<PersistedState, "completions" | "microActions" | "freezesUsedOn"> & {
    bonusFreezes?: number;
  },
  today: Date | string = new Date(),
): StreakResult & { freezes: number } {
  const active = activeDays(s);
  const frozen = new Set(s.freezesUsedOn);
  return {
    ...computeStreak(active, frozen, today),
    freezes: freezeStock(active, frozen, today, s.bonusFreezes ?? 0),
  };
}

/** Progress toward the next chest and whether one is waiting. */
export function chestProgress(
  s: Pick<PersistedState, "completions" | "chestsOpened">,
): ChestProgress {
  return chestProgressOf(s.completions.length, s.chestsOpened);
}

/** The running focus session with its remaining time, or null. */
export function focusActive(
  s: Pick<PersistedState, "focus">,
  now: Date = new Date(),
): FocusActive | null {
  return focusActiveOf(s.focus, now);
}

/** Drills due today or earlier, soonest first. */
export function dueDrills(s: Pick<PersistedState, "drills">, today: string = dayKey()): Drill[] {
  return dueDrillsOf(s.drills, today);
}

/** This month's boss and how much of it is left. */
export function boss(s: Pick<PersistedState, "xpEvents">, now: Date = new Date()): BossState {
  return bossState(s.xpEvents, now);
}

/** The current season and progress toward its target. */
export function season(
  s: Pick<PersistedState, "completions">,
  now: Date | string = new Date(),
): SeasonState {
  return seasonState(s.completions, now);
}

/** Plan items of a week (Saturday key), in day order. */
export function planItemsForWeek(s: Pick<PersistedState, "planItems">, week: string): PlanItem[] {
  return s.planItems.filter((p) => p.week === week).sort((a, b) => a.day - b.day);
}

/** Whether a plan item's quest was completed (derived, no `done` flag). */
export function isPlanItemDone(s: Pick<PersistedState, "completions">, item: PlanItem): boolean {
  return isQuestDone(s, item.skillId, item.quest);
}

/** The review saved for a week (Saturday key), if any. */
export function reviewForWeek(
  s: Pick<PersistedState, "reviews">,
  week: string,
): Review | undefined {
  return s.reviews.find((r) => r.week === week);
}

/** Saturday key of the week containing `today` (for saveReview / planItemsForWeek). */
export function currentWeek(today: Date | string = new Date()): string {
  return weekKey(typeof today === "string" ? today : dayKey(today));
}

/** Earned badges with their catalogue entries, most recent first. */
export function earnedBadges(s: Pick<PersistedState, "badges">): { badge: Badge; at: string }[] {
  const out: { badge: Badge; at: string }[] = [];
  for (const a of s.badges) {
    const badge = BADGES.find((b) => b.id === a.id);
    if (badge) out.push({ badge, at: a.at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------- 📱 Social world selectors ---------- */
// These return fresh arrays/objects: select `s.posts` etc. in the component and compute in useMemo.

export function postById(s: Pick<PersistedState, "posts">, id: string): Post | undefined {
  return s.posts.find((p) => p.id === id);
}

/** Posts linked to a skill's Produce quest, newest first. */
export function postsForSkill(s: Pick<PersistedState, "posts">, skillId: string): Post[] {
  return s.posts
    .filter((p) => p.skillId === skillId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The posted post (with a link) that serves as the skill's Produce proof, newest first; undefined when none. */
export function postForQuestProof(
  s: Pick<PersistedState, "posts">,
  skillId: string,
): Post | undefined {
  return s.posts
    .filter((p) => p.skillId === skillId && p.stage === "posted" && !!p.postedUrl)
    .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))[0];
}

/** The next planned, not-yet-posted post at/after `now` with its countdown (Studio home). */
export function nextPostFor(
  s: Pick<PersistedState, "posts">,
  now: Date = new Date(),
): NextPost | null {
  return nextPostOf(s.posts, now);
}

/** Ideas not yet turned into a post. */
export function unusedIdeas(s: Pick<PersistedState, "ideas" | "posts">): Idea[] {
  const live = new Set(s.posts.map((p) => p.id));
  return s.ideas.filter((i) => !i.usedInPostId || !live.has(i.usedInPostId));
}

export function ideasCount(s: Pick<PersistedState, "ideas" | "posts">): number {
  return unusedIdeas(s).length;
}

export function accountFor(
  s: Pick<PersistedState, "socialAccounts">,
  platform: Platform,
): SocialAccount | undefined {
  return s.socialAccounts.find((a) => a.platform === platform);
}

/** A snapshot or demographics row the Beacons seed inserted (its day, one of its four platforms). */
const isSeedRow = (row: { platform: Platform; day: string }): boolean =>
  row.day === SOCIAL_SEED_DAY &&
  (SOCIAL_SEED_PLATFORMS as readonly string[]).includes(row.platform);

/** True while any Beacons seed row is still stored (the Settings "remove the Beacons numbers" button shows). */
export function hasBeaconsSeed(
  s: Pick<PersistedState, "socialSnapshots" | "demographics">,
): boolean {
  return s.socialSnapshots.some(isSeedRow) || s.demographics.some(isSeedRow);
}

/** The persisted sync bookkeeping (select it directly: it is one object that changes as a whole). */
export function socialSyncState(s: Pick<PersistedState, "socialSync">): SocialSyncState {
  return s.socialSync;
}

/** The persisted Trend Radar slice (select it directly; lib/trends' visibleTrends filters it). */
export function trendsState(s: Pick<PersistedState, "trends">): TrendsState {
  return s.trends;
}

/** A platform's imported post stats, newest first. */
export function postStatsFor(
  s: Pick<PersistedState, "socialPostStats">,
  platform: Platform,
): SocialPostStat[] {
  return s.socialPostStats
    .filter((p) => p.platform === platform)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** The slice lib/analytics' platformOverview / allOverview read (select the three arrays with useShallow). */
export function analyticsState(
  s: Pick<PersistedState, "socialSnapshots" | "socialPostStats" | "socialAccounts">,
): { snapshots: SocialSnapshot[]; postStats: SocialPostStat[]; accounts: SocialAccount[] } {
  return { snapshots: s.socialSnapshots, postStats: s.socialPostStats, accounts: s.socialAccounts };
}

/** Whether a skill already has a live (not posted) post on any platform: the map's "📱 in the calendar" badge. */
export function skillInCalendar(
  s: Pick<PersistedState, "posts">,
  skillId: string,
): Post | undefined {
  return s.posts.find((p) => p.skillId === skillId && p.stage !== "posted");
}
