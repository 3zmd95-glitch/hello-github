import { getSkill, programs as seedPrograms } from "@/data";
import { skillKind } from "@/lib/combo";
import type { LText, PlanItem as StoredPlanItem } from "@/lib/domain";
import type { QuestPick } from "@/lib/planner";
import {
  DAY_PREFERENCE,
  questMinutes,
  type PlanItem as DerivedPlanItem,
  type WeekPlan,
} from "@/lib/weekPlan";
import { questXp } from "@/lib/xp";

/**
 * Manual plan edits (build plan 2.3 "add/remove"), overlaid on the derived week plan.
 *
 * The rules in lib/weekPlan.ts draw the plan from progress + gear; the store keeps only what the owner changed,
 * as `planItems` rows of the persisted `PlanItem` shape (lib/domain.ts). Two kinds of rows exist, told apart
 * by `by` and `minutes`:
 *
 * - **Addition** — `by: "me"`, `minutes > 0`, id `"<week>:me:<skillId>:<quest>"`. A quest the owner picked from
 *   the backlog. It is rendered as a plan item with `manual: true` (the "you" chip) on the day it was stored on.
 * - **Tombstone** — `by: "rules"`, `minutes: 0`, id equal to a derived item's id (`"<week>:<skillId>:<quest>"` or
 *   `"<week>:combo:<comboId>"`). It hides that derived item. `minutes: 0` is what marks the row as a tombstone,
 *   so a real coach-stored item (minutes > 0, `by: "rules"`) never hides anything; such rows are ignored here
 *   until a later round stores whole plans.
 *
 * Everything is recomputed from the overlaid items (minutes, XP, mix), and "reset to the coach's plan" is simply
 * `setPlanItems(week, [])`.
 */

export const MANUAL_REASON: LText = { ar: "أنت ضفتها", en: "You added it" };

/** A derived or manual item as the planner renders it. */
export type OverlayItem = DerivedPlanItem & {
  /** True for an owner-added item (`by: "me"`). */
  manual: boolean;
};

export type OverlaidPlan = Omit<WeekPlan, "items"> & { items: OverlayItem[] };

export function isTombstone(row: StoredPlanItem): boolean {
  return row.by === "rules" && row.minutes === 0;
}

export function isManual(row: StoredPlanItem): boolean {
  return row.by === "me" && row.minutes > 0;
}

export function manualId(week: string, skillId: string, quest: StoredPlanItem["quest"]): string {
  return `${week}:me:${skillId}:${quest}`;
}

/** The stored row that hides a derived item. */
export function tombstoneFor(week: string, item: DerivedPlanItem): StoredPlanItem {
  return {
    id: item.id,
    week,
    day: item.day,
    skillId: item.skillId,
    quest: item.quest,
    minutes: 0,
    by: "rules",
  };
}

/** The stored row for a backlog quest the owner adds, on `day`. */
export function manualRow(week: string, pick: QuestPick, day: number): StoredPlanItem {
  return {
    id: manualId(week, pick.skill.id, pick.quest),
    week,
    day,
    skillId: pick.skill.id,
    quest: pick.quest,
    minutes: questMinutes(pick.quest, pick.skill.tier),
    by: "me",
  };
}

/** Minutes planned per day, 0 = Saturday … 6 = Friday. */
export function dayLoad(items: readonly Pick<DerivedPlanItem, "day" | "minutes">[]): number[] {
  const load = new Array<number>(7).fill(0);
  for (const i of items) if (i.day >= 0 && i.day < 7) load[i.day] += i.minutes;
  return load;
}

/** The least loaded day; ties follow the coach's DAY_PREFERENCE (mid-week first). */
export function lightestDay(items: readonly Pick<DerivedPlanItem, "day" | "minutes">[]): number {
  const load = dayLoad(items);
  let best = DAY_PREFERENCE[0];
  for (const d of DAY_PREFERENCE) if (load[d] < load[best]) best = d;
  return best;
}

function fromManual(row: StoredPlanItem): OverlayItem | null {
  const skill = getSkill(row.skillId);
  if (!skill) return null;
  return {
    id: row.id,
    day: row.day,
    skillId: row.skillId,
    quest: row.quest,
    minutes: row.minutes,
    xp: questXp(row.quest, skill.tier),
    kind: skillKind(skill, seedPrograms),
    reason: MANUAL_REASON,
    manual: true,
  };
}

/**
 * Derived items minus the tombstoned ones, plus the owner's additions (rows of other weeks and rows for
 * unknown skills are ignored). Totals and the craft / software / combo mix are recomputed.
 */
export function applyOverlay(derived: WeekPlan, stored: readonly StoredPlanItem[]): OverlaidPlan {
  const rows = stored.filter((r) => r.week === derived.week);
  const hidden = new Set(rows.filter(isTombstone).map((r) => r.id));
  const items: OverlayItem[] = derived.items
    .filter((i) => !hidden.has(i.id))
    .map((i) => ({ ...i, manual: false }));
  const present = new Set(items.map((i) => i.id));
  for (const row of rows) {
    if (!isManual(row) || present.has(row.id)) continue;
    const item = fromManual(row);
    if (!item) continue;
    items.push(item);
    present.add(row.id);
  }
  items.sort((a, b) => a.day - b.day || b.minutes - a.minutes || a.id.localeCompare(b.id));
  return {
    ...derived,
    items,
    minutes: items.reduce((n, i) => n + i.minutes, 0),
    xp: items.reduce((n, i) => n + i.xp, 0),
    craft: items.filter((i) => i.kind === "craft").length,
    software: items.filter((i) => i.kind === "software").length,
    combos: items.filter((i) => i.kind === "combo").length,
  };
}

/** Any plan whose items name their skills (derived or overlaid). */
type PlanLike = { items: readonly Pick<DerivedPlanItem, "skillId" | "partnerSkillId">[] };

/** Skill ids the plan already covers (combo partners included). */
export function plannedSkillIds(plan: PlanLike): Set<string> {
  const ids = new Set<string>();
  for (const i of plan.items) {
    ids.add(i.skillId);
    if (i.partnerSkillId) ids.add(i.partnerSkillId);
  }
  return ids;
}

/** The next `n` candidate quests (best first) on skills the plan does not cover yet. */
export function backlog(candidates: readonly QuestPick[], plan: PlanLike, n = 8): QuestPick[] {
  const planned = plannedSkillIds(plan);
  return candidates.filter((c) => !planned.has(c.skill.id)).slice(0, n);
}
