import type { Idea, Lang } from "./domain";
import { daysBetween } from "./streak";

/**
 * The weekly "paste 3 Instagram sounds" ritual (scout 02, planning/tools/08-trends.md). Instagram has no trends API
 * (hashtag search needs a business-verified app and cannot discover), so the safest real signal is the owner's own
 * eyes on the app's Trending audio list. What he pastes is saved as ideas (source `trend`, platform `instagram`)
 * whose text carries the paste day (Riyadh), so the card knows how old the sounds are without a stored slice, and
 * nothing reminds him: there is no nudge, by his choice. The date is the day he pasted, never a claim about Instagram.
 */

export const RITUAL_SOUNDS = 3;
export const RITUAL_NAME_MAX = 80;
/** A paste older than this many days is "old": the card asks for fresh sounds. */
export const RITUAL_STALE_DAYS = 7;

export type RitualKind = "sound" | "format";

const LABEL: Record<RitualKind, Record<Lang, string>> = {
  sound: { ar: "🎵 صوت انستقرام", en: "🎵 Instagram sound" },
  format: { ar: "🎞️ فورمات انستقرام", en: "🎞️ Instagram format" },
};

/** "🎵 Instagram sound · 2026-10-23: <name>" in the UI language (the name trimmed and clipped). */
export function ritualIdeaText(kind: RitualKind, name: string, day: string, lang: Lang): string {
  return `${LABEL[kind][lang]} · ${day}: ${name.trim().slice(0, RITUAL_NAME_MAX)}`;
}

/** The kind, paste day and name of a ritual idea in either language; undefined for any other idea text. */
export function parseRitualIdea(
  text: string,
): { kind: RitualKind; day: string; name: string } | undefined {
  for (const kind of ["sound", "format"] as const)
    for (const lang of ["ar", "en"] as const) {
      const prefix = `${LABEL[kind][lang]} · `;
      if (!text.startsWith(prefix)) continue;
      const m = text.slice(prefix.length).match(/^(\d{4}-\d{2}-\d{2}): (\S[\s\S]*)$/);
      if (m) return { kind, day: m[1], name: m[2] };
    }
  return undefined;
}

/**
 * The idea texts one paste saves: the sounds, then the format, trimmed and clipped, without blanks, repeats
 * (case-insensitive) or what the same day's earlier paste already saved (in either UI language).
 */
export function ritualTexts(input: {
  sounds: readonly string[];
  format: string;
  day: string;
  lang: Lang;
  ideas: readonly Idea[];
}): string[] {
  const have = new Set<string>();
  for (const i of input.ideas) {
    const p = parseRitualIdea(i.text);
    if (p && p.day === input.day) have.add(`${p.kind}:${p.name.toLowerCase()}`);
  }
  const out: string[] = [];
  const add = (kind: RitualKind, raw: string) => {
    const name = raw.trim().slice(0, RITUAL_NAME_MAX).trim();
    const key = `${kind}:${name.toLowerCase()}`;
    if (!name || have.has(key)) return;
    have.add(key);
    out.push(ritualIdeaText(kind, name, input.day, input.lang));
  };
  for (const s of input.sounds) add("sound", s);
  add("format", input.format);
  return out;
}

export interface RitualBatch {
  /** The Riyadh day the owner pasted this batch. */
  day: string;
  ageDays: number;
  stale: boolean;
  sounds: { id: string; name: string }[];
  formats: { id: string; name: string }[];
}

/** The newest paste found in the ideas bank (all its sounds and formats), or undefined before the first one. */
export function lastRitual(ideas: readonly Idea[], today: string): RitualBatch | undefined {
  const found = ideas.flatMap((idea) => {
    if (idea.source !== "trend" || idea.platform !== "instagram") return [];
    const parsed = parseRitualIdea(idea.text);
    return parsed ? [{ id: idea.id, ...parsed }] : [];
  });
  if (!found.length) return undefined;
  const day = found.reduce((a, b) => (b.day > a ? b.day : a), found[0].day);
  const pick = (kind: RitualKind) =>
    found.filter((f) => f.day === day && f.kind === kind).map(({ id, name }) => ({ id, name }));
  const ageDays = Math.max(0, daysBetween(day, today));
  return {
    day,
    ageDays,
    stale: ageDays > RITUAL_STALE_DAYS,
    sounds: pick("sound"),
    formats: pick("format"),
  };
}
