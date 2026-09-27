import { skillKind } from "./combo";
import type {
  FocusSession,
  LText,
  MicroAction,
  Program,
  QuestCompletion,
  Skill,
  XpEvent,
} from "./domain";
import { doneQuestsBySkill } from "./planner";
import { addDays, dayKey, daysBetween, weekKey } from "./streak";

/**
 * Weekly review numbers (build plan 2.5, master plan round 15): everything a Sat–Fri Riyadh week produced,
 * derived from the ledgers, plus rules-based insights. Pure and deterministic: the same state + week always
 * give the same stats, so nothing here is stored.
 */

/* ---------- Types ---------- */

export interface WeekStatsState {
  completions: readonly QuestCompletion[];
  xpEvents: readonly XpEvent[];
  microActions: readonly MicroAction[];
  focusSessions: readonly FocusSession[];
}

export interface WeekStatsContext {
  skills: readonly Skill[];
  programs: readonly Program[];
}

export interface WeekStats {
  /** Saturday key that starts the week. */
  week: string;
  /** XP from every source (quests, mastery, micro, drills, review) earned in the week. */
  xp: number;
  quests: number;
  /** Skills mastered (4/4) in the week. */
  mastered: number;
  micro: number;
  craftQuests: number;
  softwareQuests: number;
  /** Minutes actually spent in focus sessions started in the week. */
  focusMinutes: number;
  /** Day keys (Riyadh) with a quest or a micro-action, ascending. */
  activeDays: string[];
  /** Quests per day, Saturday → Friday. */
  perDay: number[];
  /** 0 = Saturday … 6 = Friday; null when no quest was done. */
  bestDay: number | null;
  topPillarId: string | null;
  /** Quest, mastery and drill XP per pillar (zeros left out). */
  xpByPillar: Record<string, number>;
}

export interface WeekHistoryEntry {
  week: string;
  xp: number;
  quests: number;
  /** Number of active days, 0..7. */
  activeDays: number;
}

export type InsightGo = "/planner" | "/map" | "/skills" | "/rewards";

export interface Insight {
  id: string;
  icon: string;
  text: LText;
  tip: LText;
  go: InsightGo;
}

export interface InsightExtra {
  skills: readonly Skill[];
  programs: readonly Program[];
  /** All completions, to spot skills one quest from mastery. */
  completions: readonly QuestCompletion[];
  boss?: { name: LText; hp: number; hpLeft: number } | null;
  season?: { name: LText; questsDone: number; target: number; daysLeft: number } | null;
}

/* ---------- Helpers ---------- */

/** Day names, Saturday first, for insight texts (the UI uses the dictionary; lib stays pure). */
export const DAY_NAMES: readonly LText[] = [
  { ar: "السبت", en: "Saturday" },
  { ar: "الأحد", en: "Sunday" },
  { ar: "الإثنين", en: "Monday" },
  { ar: "الثلاثاء", en: "Tuesday" },
  { ar: "الأربعاء", en: "Wednesday" },
  { ar: "الخميس", en: "Thursday" },
  { ar: "الجمعة", en: "Friday" },
];

/** Whether an instant (ISO) falls in the Sat–Fri Riyadh week that starts on `week`. */
export function inWeek(at: string, week: string): boolean {
  return weekKey(dayKey(at)) === week;
}

/** 0..6 (Sat..Fri) index of an instant inside its week. */
function dayIndex(at: string): number {
  const d = dayKey(at);
  return daysBetween(weekKey(d), d);
}

/** Skill an XP event belongs to (quest, mastery and drill events only). */
function xpEventSkillId(e: XpEvent): string | undefined {
  if (!e.refId) return undefined;
  if (e.source === "quest") return e.refId.slice(0, e.refId.lastIndexOf(":"));
  if (e.source === "mastery" || e.source === "drill") return e.refId;
  return undefined;
}

/** Minutes a focus session really ran (an early stop counts what was done, never more than its length). */
export function focusSessionMinutes(s: FocusSession): number {
  const ran = Math.round(
    (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000,
  );
  return Math.max(0, Math.min(s.minutes, ran));
}

/* ---------- Stats ---------- */

export function weekStats(state: WeekStatsState, week: string, ctx: WeekStatsContext): WeekStats {
  const skillById = new Map(ctx.skills.map((s) => [s.id, s]));
  const programById = new Map(ctx.programs.map((p) => [p.id, p]));

  let xp = 0;
  let mastered = 0;
  const xpByPillar: Record<string, number> = {};
  for (const e of state.xpEvents) {
    if (!inWeek(e.at, week)) continue;
    xp += e.amount;
    if (e.source === "mastery") mastered++;
    const skillId = xpEventSkillId(e);
    const skill = skillId ? skillById.get(skillId) : undefined;
    const pillarId = skill ? programById.get(skill.programId)?.pillarId : undefined;
    if (pillarId && e.amount !== 0) xpByPillar[pillarId] = (xpByPillar[pillarId] ?? 0) + e.amount;
  }
  for (const id of Object.keys(xpByPillar)) if (xpByPillar[id] <= 0) delete xpByPillar[id];

  const perDay = new Array<number>(7).fill(0);
  const active = new Set<string>();
  let quests = 0;
  let craftQuests = 0;
  let softwareQuests = 0;
  for (const c of state.completions) {
    if (!inWeek(c.at, week)) continue;
    quests++;
    perDay[dayIndex(c.at)]++;
    active.add(dayKey(c.at));
    const skill = skillById.get(c.skillId);
    if (skill && skillKind(skill, ctx.programs) === "craft") craftQuests++;
    else softwareQuests++;
  }

  let micro = 0;
  for (const m of state.microActions) {
    if (!inWeek(m.at, week)) continue;
    micro++;
    active.add(dayKey(m.at));
  }

  let focusMinutes = 0;
  for (const s of state.focusSessions)
    if (inWeek(s.startedAt, week)) focusMinutes += focusSessionMinutes(s);

  let bestDay: number | null = null;
  for (let d = 0; d < 7; d++)
    if (perDay[d] > 0 && (bestDay === null || perDay[d] > perDay[bestDay])) bestDay = d;

  let topPillarId: string | null = null;
  for (const [id, n] of Object.entries(xpByPillar))
    if (topPillarId === null || n > xpByPillar[topPillarId]) topPillarId = id;

  return {
    week,
    xp,
    quests,
    mastered,
    micro,
    craftQuests,
    softwareQuests,
    focusMinutes,
    activeDays: [...active].sort(),
    perDay,
    bestDay,
    topPillarId,
    xpByPillar,
  };
}

/** The last `weeksBack` weeks up to the one containing `today`, oldest first (XP, quests, active days). */
export function weekHistory(
  state: Pick<WeekStatsState, "completions" | "xpEvents" | "microActions">,
  weeksBack = 8,
  today: Date | string = new Date(),
): WeekHistoryEntry[] {
  const todayKey =
    typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : dayKey(today);
  const current = weekKey(todayKey);
  const n = Math.max(1, Math.floor(weeksBack));
  const first = addDays(current, -7 * (n - 1));
  const index = (at: string): number => {
    const w = weekKey(dayKey(at));
    return w < first || w > current ? -1 : daysBetween(first, w) / 7;
  };
  const out: WeekHistoryEntry[] = [];
  const active: Set<string>[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ week: addDays(first, 7 * i), xp: 0, quests: 0, activeDays: 0 });
    active.push(new Set());
  }
  for (const e of state.xpEvents) {
    const i = index(e.at);
    if (i >= 0) out[i].xp += e.amount;
  }
  for (const c of state.completions) {
    const i = index(c.at);
    if (i < 0) continue;
    out[i].quests++;
    active[i].add(dayKey(c.at));
  }
  for (const m of state.microActions) {
    const i = index(m.at);
    if (i >= 0) active[i].add(dayKey(m.at));
  }
  for (let i = 0; i < n; i++) out[i].activeDays = active[i].size;
  return out;
}

/* ---------- Insights ---------- */

export const MAX_INSIGHTS = 4;

/**
 * Up to four rules-based, bilingual observations with one action each. Order is by usefulness:
 * an empty week first, then the best day, the craft/software balance, XP vs last week, a skill one quest
 * from mastery, the boss, the season, and finally the focus potion when none was used.
 */
export function insights(
  stats: WeekStats,
  prevStats: WeekStats | null,
  extra: InsightExtra,
): Insight[] {
  const out: Insight[] = [];

  if (stats.quests === 0 && stats.micro === 0) {
    out.push({
      id: "empty",
      icon: "🌱",
      text: { ar: "أسبوع هادي، ما فيه مهام مسجّلة", en: "A quiet week, no quests logged" },
      tip: {
        ar: "مهمة واحدة بس تشعّل الشعلة، افتح خطة الأسبوع",
        en: "One quest lights the streak, open the week plan",
      },
      go: "/planner",
    });
  }

  if (stats.bestDay !== null && stats.quests >= 2) {
    const n = stats.perDay[stats.bestDay];
    const share = Math.round((n / stats.quests) * 100);
    const day = DAY_NAMES[stats.bestDay];
    out.push({
      id: "best-day",
      icon: "📅",
      text: {
        ar: `أفضل يوم لك: ${day.ar} (${share}٪ من مهامك)`,
        en: `Your best day: ${day.en} (${share}% of your quests)`,
      },
      tip: { ar: `حط المهام الصعبة يوم ${day.ar}`, en: `Put hard quests on ${day.en}` },
      go: "/planner",
    });
  }

  if (stats.quests >= 2) {
    const { craftQuests: craft, softwareQuests: software } = stats;
    if (craft === 0 || software === 0 || craft >= software * 3 || software >= craft * 3) {
      const missing = craft <= software ? "craft" : "software";
      out.push({
        id: `balance-${missing}`,
        icon: missing === "craft" ? "🎥" : "💻",
        text:
          missing === "craft"
            ? { ar: "أغلب مهامك برامج، الحرفة قليلة", en: "Mostly software quests, little craft" }
            : { ar: "أغلب مهامك حرفة، البرامج قليلة", en: "Mostly craft quests, little software" },
        tip:
          missing === "craft"
            ? {
                ar: "الأسبوع الجاي المخطط يضيف مهمة حرفة (صوّر شي)",
                en: "Next week the planner adds a craft quest (go shoot something)",
              }
            : {
                ar: "الأسبوع الجاي المخطط يضيف مهمة برامج (عدّل شي)",
                en: "Next week the planner adds a software quest (go edit something)",
              },
        go: "/planner",
      });
    }
  }

  if (prevStats && prevStats.xp > 0 && stats.xp !== prevStats.xp) {
    const pct = Math.round(((stats.xp - prevStats.xp) / prevStats.xp) * 100);
    if (pct >= 20) {
      out.push({
        id: "xp-up",
        icon: "🚀",
        text: { ar: `XP زاد ${pct}٪ عن الأسبوع الماضي`, en: `XP up ${pct}% on last week` },
        tip: {
          ar: "عفية! شوف الجزر اللي تنوّرت على الخريطة",
          en: "Nice! See the islands lighting up on the map",
        },
        go: "/map",
      });
    } else if (pct <= -20) {
      out.push({
        id: "xp-down",
        icon: "🪫",
        text: { ar: `XP نزل ${-pct}٪ عن الأسبوع الماضي`, en: `XP down ${-pct}% on last week` },
        tip: {
          ar: "عادي، خطة أخف الأسبوع الجاي وارجع للإيقاع",
          en: "That's fine, a lighter plan next week gets the rhythm back",
        },
        go: "/planner",
      });
    }
  }

  const done = doneQuestsBySkill(extra.completions);
  const near = extra.skills.find((s) => (done.get(s.id)?.size ?? 0) === 3);
  if (near) {
    out.push({
      id: `near-${near.id}`,
      icon: "⭐",
      text: {
        ar: `مهمة واحدة وتتقن: ${near.name.ar}`,
        en: `One quest from mastery: ${near.name.en}`,
      },
      tip: { ar: "خلّصها وخذ +20 XP إتقان", en: "Finish it for the +20 XP mastery bonus" },
      go: "/skills",
    });
  }

  const boss = extra.boss;
  if (boss && boss.hpLeft > 0 && boss.hp > 0 && boss.hpLeft <= boss.hp * 0.25) {
    out.push({
      id: "boss",
      icon: "⚔️",
      text: {
        ar: `${boss.name.ar} باقي له ${boss.hpLeft} HP بس`,
        en: `${boss.name.en} has only ${boss.hpLeft} HP left`,
      },
      tip: { ar: "مهمتين أو ثلاث وينهزم", en: "Two or three quests finish it" },
      go: "/rewards",
    });
  }

  const season = extra.season;
  if (season) {
    const left = season.target - season.questsDone;
    if (left > 0 && left <= 3) {
      out.push({
        id: "season",
        icon: "🏁",
        text: {
          ar: `${season.name.ar}: باقي ${left} مهام على الهدف`,
          en: `${season.name.en}: ${left} quests to the target`,
        },
        tip: {
          ar: `عندك ${season.daysLeft} يوم، ركّز على مهارات الموسم`,
          en: `${season.daysLeft} days left, lean into the season's skills`,
        },
        go: "/map",
      });
    }
  }

  if (stats.quests >= 1 && stats.focusMinutes === 0) {
    out.push({
      id: "no-focus",
      icon: "🧪",
      text: { ar: "ما استخدمت جرعة تركيز هذا الأسبوع", en: "No focus potion used this week" },
      tip: {
        ar: "جرّب جرعة ٢٥ دقيقة: مهامك تعطي +٢٥٪ XP",
        en: "Try a 25-min potion: quests give +25% XP",
      },
      go: "/rewards",
    });
  }

  return out.slice(0, MAX_INSIGHTS);
}
