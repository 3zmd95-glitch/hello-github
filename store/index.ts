import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
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
  BadgeAwardSchema,
  DrillSchema,
  FocusSessionSchema,
  FocusStateSchema,
  GemEventSchema,
  LTextSchema,
  MONTH_KEY_RE,
  MicroActionSchema,
  PlanItemSchema,
  PurchaseSchema,
  QUEST_TYPES,
  QuestCompletionSchema,
  RefSchema,
  ReviewSchema,
  RewardSchema,
  SettingsSchema,
  XpEventSchema,
  type ApiKeyName,
  type Drill,
  type FocusMinutes,
  type FocusSession,
  type FocusState,
  type GemEvent,
  type GemReason,
  type LText,
  type MicroAction,
  type PlanItem,
  type Purchase,
  type QuestCompletion,
  type QuestType,
  type Ref,
  type Review,
  type Reward,
  type Settings,
  type XpEvent,
} from "@/lib/domain";
import { advanceDrill, dueDrills as dueDrillsOf, newDrill } from "@/lib/drills";
import { flowState } from "@/lib/flow";
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
import { levelFromXp } from "@/lib/level";
import { rankFromXp } from "@/lib/rank";
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
  reminderTime: "20:00",
  gear: ["phone", "lights"],
  davinciEdition: "studio",
  apiKeys: {},
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
  /** Scout v0 (1.13): last topics typed on /discover, most recent first, capped at 8. */
  recentTopics: z.array(z.string()).default([]),
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

export interface StoreActions {
  completeQuest(skillId: string, quest: QuestType, proofUrl?: string, now?: Date): CompleteResult;
  uncompleteQuest(skillId: string, quest: QuestType): void;
  addMicroAction(text: LText, now?: Date): MicroResult;
  /** Spend streak freezes on missed days when the stock (earned + bonus) covers the gap. Returns the frozen days. */
  applyStreakFreezes(now?: Date): string[];
  setSettings(partial: Partial<Settings>): void;
  /** Attach a reference to a skill's "Start here" box (Scout v0). No-op if the url is already saved. */
  addRef(skillId: string, ref: Ref): void;
  removeRef(skillId: string, url: string): void;
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
  /** Replace all progress with an exported JSON file. Throws on invalid input. */
  importState(json: string): void;
  reset(): void;
}

export type StoreState = PersistedState & StoreActions;

const initialData = (): PersistedState => ({
  settings: { ...DEFAULT_SETTINGS, gear: [...DEFAULT_SETTINGS.gear] },
  completions: [],
  xpEvents: [],
  microActions: [],
  freezesUsedOn: [],
  reviews: [],
  savedRefs: {},
  recentTopics: [],
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
});

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const questRef = (skillId: string, quest: QuestType) => `${skillId}:${quest}`;

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
  recentTopics: s.recentTopics,
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
});

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
  persist<StoreState, [], [], PersistedState>(
    (set, get) => ({
      ...initialData(),

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

      addRef(skillId, ref) {
        const s = get();
        const list = s.savedRefs[skillId] ?? [];
        if (list.some((r) => r.url === ref.url)) return;
        set({ savedRefs: { ...s.savedRefs, [skillId]: [...list, ref] } });
      },

      removeRef(skillId, url) {
        const s = get();
        const list = s.savedRefs[skillId];
        if (!list?.some((r) => r.url === url)) return;
        set({ savedRefs: { ...s.savedRefs, [skillId]: list.filter((r) => r.url !== url) } });
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

      exportState(now = new Date()) {
        const file: ExportFile = {
          app: "3z-prod",
          version: STORE_VERSION,
          exportedAt: now.toISOString(),
          state: pick(get()),
        };
        return JSON.stringify(file, null, 2);
      },

      importState(json) {
        const file = ExportFileSchema.parse(JSON.parse(json));
        set({ ...file.state, rewards: ensureBuiltInRewards(file.state.rewards) });
      },

      reset() {
        set(initialData());
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(safeLocalStorage),
      partialize: pick,
      // Screens call hydrateStore() on mount, so server and first client render match.
      skipHydration: true,
      merge: (persisted, current) => {
        const parsed = PersistedStateSchema.partial()
          .extend({ settings: SettingsSchema.partial().optional() })
          .safeParse(migrateLegacySettings(persisted));
        if (!parsed.success) return current;
        const p = parsed.data;
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
          rewards: ensureBuiltInRewards(p.rewards ?? current.rewards),
        } as StoreState;
      },
    },
  ),
);

/** Bonus freezes after adding n, keeping earned + bonus within FREEZE_TOTAL_CAP. */
function addBonusFreezes(s: PersistedState, n: number, now: Date): number {
  const earned = streak({ ...s, bonusFreezes: 0 }, now).freezes;
  return Math.max(s.bonusFreezes, Math.min(s.bonusFreezes + n, FREEZE_TOTAL_CAP - earned));
}

/** Load saved progress from localStorage. Call once on the client (e.g. in a root useEffect). */
export function hydrateStore(): Promise<void> | void {
  return useStore.persist.rehydrate();
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
