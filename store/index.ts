import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { getSkill } from "@/data";
import {
  LTextSchema,
  MicroActionSchema,
  QUEST_TYPES,
  QuestCompletionSchema,
  SettingsSchema,
  XpEventSchema,
  type LText,
  type MicroAction,
  type QuestCompletion,
  type QuestType,
  type Settings,
  type XpEvent,
} from "@/lib/domain";
import { levelFromXp } from "@/lib/level";
import { rankFromXp } from "@/lib/rank";
import { computeStreak, dayKey, daysToFreeze, freezeStock, type StreakResult } from "@/lib/streak";
import { MASTERY_BONUS, microXp, questXp } from "@/lib/xp";

/**
 * The one data layer for Sprint 1: progress lives on the phone (localStorage).
 * Screens call these actions and selectors and never touch storage directly, so a Supabase adapter can
 * replace the persistence in Sprint 3 without changing screens.
 */

export const STORAGE_KEY = "3z-prod-v1";
export const STORE_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  lang: "ar",
  sound: true,
  reminderTime: "20:00",
  gear: ["phone", "lights"],
  davinciEdition: "studio",
};

/** Persisted (and exported) part of the state. */
export const PersistedStateSchema = z.object({
  settings: SettingsSchema,
  completions: z.array(QuestCompletionSchema),
  xpEvents: z.array(XpEventSchema),
  microActions: z.array(MicroActionSchema),
  freezesUsedOn: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  /** Weekly reviews (Sprint 2). Kept opaque for now. */
  reviews: z.array(z.unknown()),
});
export type PersistedState = z.infer<typeof PersistedStateSchema>;

export const ExportFileSchema = z.object({
  app: z.literal("3z-prod"),
  version: z.number().int(),
  exportedAt: z.string(),
  state: PersistedStateSchema,
});
export type ExportFile = z.infer<typeof ExportFileSchema>;

/** What happened when a quest was completed; drives toasts and celebrations. */
export interface CompleteResult {
  /** False when the quest was already done (idempotent call) or the skill is unknown. */
  added: boolean;
  xp: number;
  mastered: boolean;
  levelBefore: number;
  levelAfter: number;
  /** Overall rank step 1..51 (rank index × 3 + tier) before and after. */
  rankStepBefore: number;
  rankStepAfter: number;
}

export interface StoreActions {
  completeQuest(skillId: string, quest: QuestType, proofUrl?: string, now?: Date): CompleteResult;
  uncompleteQuest(skillId: string, quest: QuestType): void;
  addMicroAction(text: LText, now?: Date): MicroAction;
  /** Spend streak freezes on missed days when the stock covers the gap. Returns the frozen days. */
  applyStreakFreezes(now?: Date): string[];
  setSettings(partial: Partial<Settings>): void;
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
});

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const questRef = (skillId: string, quest: QuestType) => `${skillId}:${quest}`;

const pick = (s: PersistedState): PersistedState => ({
  settings: s.settings,
  completions: s.completions,
  xpEvents: s.xpEvents,
  microActions: s.microActions,
  freezesUsedOn: s.freezesUsedOn,
  reviews: s.reviews,
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

export const useStore = create<StoreState>()(
  persist<StoreState, [], [], PersistedState>(
    (set, get) => ({
      ...initialData(),

      completeQuest(skillId, quest, proofUrl, now = new Date()) {
        const state = get();
        const xpBefore = totalXp(state);
        const base: CompleteResult = {
          added: false,
          xp: 0,
          mastered: false,
          levelBefore: levelFromXp(xpBefore),
          levelAfter: levelFromXp(xpBefore),
          rankStepBefore: rankFromXp(xpBefore).step,
          rankStepAfter: rankFromXp(xpBefore).step,
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

        const at = now.toISOString();
        const completion: QuestCompletion = {
          skillId,
          quest,
          at,
          ...(proofUrl ? { proofUrl } : {}),
        };
        const completions = [...state.completions, completion];
        const gained = questXp(quest, skill.tier);
        const xpEvents: XpEvent[] = [
          ...state.xpEvents,
          { id: newId(), source: "quest", amount: gained, at, refId: questRef(skillId, quest) },
        ];

        const doneForSkill = new Set(
          completions.filter((c) => c.skillId === skillId).map((c) => c.quest),
        );
        const allDone = QUEST_TYPES.every((q) => doneForSkill.has(q));
        const alreadyMastered = state.xpEvents.some(
          (e) => e.source === "mastery" && e.refId === skillId,
        );
        const mastered = allDone && !alreadyMastered;
        if (mastered) {
          xpEvents.push({
            id: newId(),
            source: "mastery",
            amount: MASTERY_BONUS,
            at,
            refId: skillId,
          });
        }

        set({ completions, xpEvents });
        const xpAfter = totalXp(get());
        return {
          added: true,
          xp: xpAfter - xpBefore,
          mastered,
          levelBefore: base.levelBefore,
          levelAfter: levelFromXp(xpAfter),
          rankStepBefore: base.rankStepBefore,
          rankStepAfter: rankFromXp(xpAfter).step,
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
          // Undo the quest XP and, since the skill is no longer complete, its mastery bonus.
          xpEvents: state.xpEvents.filter(
            (e) =>
              !(e.source === "quest" && e.refId === ref) &&
              !(e.source === "mastery" && e.refId === skillId),
          ),
        });
      },

      addMicroAction(text, now = new Date()) {
        const parsed = LTextSchema.parse(text);
        const at = now.toISOString();
        const action: MicroAction = { id: newId(), at, text: parsed };
        set((s) => ({
          microActions: [...s.microActions, action],
          xpEvents: [
            ...s.xpEvents,
            { id: newId(), source: "micro", amount: microXp(), at, refId: action.id },
          ],
        }));
        return action;
      },

      applyStreakFreezes(now = new Date()) {
        const s = get();
        const days = daysToFreeze(activeDays(s), new Set(s.freezesUsedOn), now);
        if (days.length) set({ freezesUsedOn: [...s.freezesUsedOn, ...days].sort() });
        return days;
      },

      setSettings(partial) {
        set((s) => ({ settings: SettingsSchema.parse({ ...s.settings, ...partial }) }));
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
        set(file.state);
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
          .safeParse(persisted);
        if (!parsed.success) return current;
        const p = parsed.data;
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
        } as StoreState;
      },
    },
  ),
);

/** Load saved progress from localStorage. Call once on the client (e.g. in a root useEffect). */
export function hydrateStore(): Promise<void> | void {
  return useStore.persist.rehydrate();
}

/* ---------- Selectors (pure; pass the state from useStore or useStore.getState()) ---------- */
// Note: selectors that return a new object/Set (activeDays, streak) must not be passed to useStore()
// directly; select the raw arrays with useShallow and compute in useMemo instead.

export function totalXp(s: Pick<PersistedState, "xpEvents">): number {
  return s.xpEvents.reduce((n, e) => n + e.amount, 0);
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

/** XP earned from a program's skills (quest XP + mastery bonuses). */
export function programXp(s: Pick<PersistedState, "xpEvents">, programId: string): number {
  let n = 0;
  for (const e of s.xpEvents) {
    if (!e.refId || (e.source !== "quest" && e.source !== "mastery")) continue;
    const skillId = e.source === "quest" ? e.refId.slice(0, e.refId.lastIndexOf(":")) : e.refId;
    if (getSkill(skillId)?.programId === programId) n += e.amount;
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

export function streak(
  s: Pick<PersistedState, "completions" | "microActions" | "freezesUsedOn">,
  today: Date | string = new Date(),
): StreakResult & { freezes: number } {
  const active = activeDays(s);
  const frozen = new Set(s.freezesUsedOn);
  return { ...computeStreak(active, frozen, today), freezes: freezeStock(active, frozen, today) };
}
