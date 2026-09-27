import { getProgram, getSkill } from "@/data";
import type { LText, QuestCompletion, Skill } from "./domain";
import { addDays, dayKey, daysBetween } from "./streak";

/**
 * Seasons (master plan round 12): 30-day themed windows on a fixed rotation anchored at SEASON_ANCHOR (Riyadh).
 * A season counts quests completed inside its window on skills that match its theme; reaching the target earns
 * the season badge and gems. Everything is derived from completions + the clock, so no extra storage is needed
 * beyond the store's list of finished season keys.
 */

export const SEASON_ANCHOR = "2026-09-01";
export const SEASON_DAYS = 30;
export const SEASON_TARGET = 10;

export interface SeasonTheme {
  pillarId?: string;
  programIds?: string[];
  /** "programId/sectionId" keys, for themes narrower than a program (e.g. the Fairlight page). */
  sections?: string[];
}

export interface Season {
  id: string;
  name: LText;
  icon: string;
  theme: SeasonTheme;
  /** Badge awarded when the target is reached (see lib/badges.ts). */
  badgeId: string;
  target: number;
}

export const SEASONS: readonly Season[] = [
  {
    id: "color",
    name: { ar: "شهر تلوين الألوان", en: "Color Grading Month" },
    icon: "🎨",
    theme: { programIds: ["davinci", "color-craft"] },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
  {
    id: "capture",
    name: { ar: "شهر التصوير", en: "Capture Month" },
    icon: "📷",
    theme: { pillarId: "capture" },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
  {
    id: "sound",
    name: { ar: "شهر الصوت", en: "Sound Month" },
    icon: "🎙️",
    theme: { programIds: ["sound", "ai-audio"], sections: ["davinci/fair"] },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
  {
    id: "story",
    name: { ar: "شهر القصة", en: "Story Month" },
    icon: "📖",
    theme: { programIds: ["story", "editing-theory"], sections: ["davinci/cut", "davinci/edit"] },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
  {
    id: "design",
    name: { ar: "شهر التصميم", en: "Design Month" },
    icon: "🖌️",
    theme: { pillarId: "design" },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
  {
    id: "ai",
    name: { ar: "شهر الذكاء الاصطناعي", en: "AI Month" },
    icon: "🤖",
    theme: { pillarId: "ai" },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
  {
    id: "projects",
    name: { ar: "شهر التنظيم والإلهام", en: "Projects & Inspiration Month" },
    icon: "🗂️",
    theme: { pillarId: "projects" },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
  {
    id: "growth",
    name: { ar: "شهر النمو", en: "Growth Month" },
    icon: "📈",
    theme: { pillarId: "growth" },
    badgeId: "season-finisher",
    target: SEASON_TARGET,
  },
];

/** Does a skill belong to a season's theme? */
export function skillMatchesTheme(skill: Skill, theme: SeasonTheme): boolean {
  if (theme.programIds?.includes(skill.programId)) return true;
  if (theme.sections?.includes(`${skill.programId}/${skill.sectionId}`)) return true;
  if (theme.pillarId && getProgram(skill.programId)?.pillarId === theme.pillarId) return true;
  return false;
}

export interface SeasonWindow {
  season: Season;
  /** Unique per occurrence: "<start day key>:<season id>". Stored in `seasonsFinished`. */
  key: string;
  /** First and last day keys of the window. */
  start: string;
  end: string;
  /** 0-based count of 30-day windows since the anchor (can be negative before it). */
  cycle: number;
}

/** The season window containing a day key. */
export function seasonForDay(day: string): SeasonWindow {
  const cycle = Math.floor(daysBetween(SEASON_ANCHOR, day) / SEASON_DAYS);
  const n = SEASONS.length;
  const season = SEASONS[((cycle % n) + n) % n];
  const start = addDays(SEASON_ANCHOR, cycle * SEASON_DAYS);
  return {
    season,
    key: `${start}:${season.id}`,
    start,
    end: addDays(start, SEASON_DAYS - 1),
    cycle,
  };
}

export interface SeasonState extends SeasonWindow {
  /** 1..30 */
  day: number;
  /** Days left in the season, counting today. */
  daysLeft: number;
  /** Quests completed inside the window on skills matching the theme. */
  questsDone: number;
  target: number;
  done: boolean;
  /** The next season in the rotation (teaser). */
  next: Season;
}

/** Quests inside a window on skills matching the theme. */
export function seasonQuests(completions: readonly QuestCompletion[], w: SeasonWindow): number {
  let n = 0;
  for (const c of completions) {
    const d = dayKey(c.at);
    if (d < w.start || d > w.end) continue;
    const skill = getSkill(c.skillId);
    if (skill && skillMatchesTheme(skill, w.season.theme)) n++;
  }
  return n;
}

export function seasonState(
  completions: readonly QuestCompletion[],
  now: Date | string = new Date(),
): SeasonState {
  const today = typeof now === "string" && /^\d{4}-\d{2}-\d{2}$/.test(now) ? now : dayKey(now);
  const w = seasonForDay(today);
  const day = daysBetween(w.start, today) + 1;
  const questsDone = seasonQuests(completions, w);
  const n = SEASONS.length;
  return {
    ...w,
    day,
    daysLeft: SEASON_DAYS - day + 1,
    questsDone,
    target: w.season.target,
    done: questsDone >= w.season.target,
    next: SEASONS[(((w.cycle + 1) % n) + n) % n],
  };
}
