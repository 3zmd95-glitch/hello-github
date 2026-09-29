/**
 * The Saudi moments calendar as trend rows (round 30, planning/tools/08-trends.md): `planning/data/
 * saudi-events.json` is bundled at build (wrangler's esbuild imports JSON; `json.d.ts` types it for tsc)
 * and every event within `EVENT_WINDOW_DAYS`, or still running, becomes an `event` row. The row shape
 * matches the dashboard's `eventToTrendItem` (lib/trends.ts): id `event:SA:<event.id>`, title
 * "<ar> · <en>", tags [kind, …hashtags], `why` the hashtags, expiry at the Riyadh midnight after the last day.
 */

import { addDays, DAY_KEY_RE, riyadhDay } from "../social/time";
import raw from "../../../../planning/data/saudi-events.json";
import { SOURCE_LABELS, type SourceCtx, type SourceOutput, type TrendItem } from "./types";

export const EVENT_WINDOW_DAYS = 60;

export interface SaudiEvent {
  id: string;
  /** Riyadh day keys. */
  date: string;
  endDate?: string;
  name: { ar: string; en: string };
  hashtags: string[];
  leadDays: number;
  kind: "national" | "religious" | "season" | "sport" | "other";
  approx: boolean;
  note?: { ar: string; en: string };
}

const KINDS = ["national", "religious", "season", "sport", "other"];

function isLText(x: unknown): x is { ar: string; en: string } {
  const t = x as Record<string, unknown> | null;
  return !!t && typeof t === "object" && typeof t.ar === "string" && typeof t.en === "string";
}

/** One JSON entry as a SaudiEvent (defaults applied), or null when it is malformed. */
export function parseEvent(x: unknown): SaudiEvent | null {
  if (!x || typeof x !== "object") return null;
  const e = x as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) return null;
  if (typeof e.date !== "string" || !DAY_KEY_RE.test(e.date)) return null;
  if (e.endDate !== undefined && (typeof e.endDate !== "string" || !DAY_KEY_RE.test(e.endDate))) {
    return null;
  }
  if (!isLText(e.name)) return null;
  if (typeof e.kind !== "string" || !KINDS.includes(e.kind)) return null;
  const hashtags = Array.isArray(e.hashtags)
    ? e.hashtags.filter((h): h is string => typeof h === "string")
    : [];
  return {
    id: e.id,
    date: e.date,
    ...(typeof e.endDate === "string" ? { endDate: e.endDate } : {}),
    name: e.name,
    hashtags,
    leadDays: typeof e.leadDays === "number" && e.leadDays >= 0 ? Math.floor(e.leadDays) : 14,
    kind: e.kind as SaudiEvent["kind"],
    approx: e.approx === true,
    ...(isLText(e.note) ? { note: e.note } : {}),
  };
}

/** Every well-formed event of the bundled file, sorted by date. */
export const SAUDI_EVENTS: SaudiEvent[] = (Array.isArray(raw) ? raw : [])
  .map(parseEvent)
  .filter((e): e is SaudiEvent => e !== null)
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const dayIndex = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Days until the event starts (0 while it is running); null when it is over or beyond the window. */
export function daysUntil(
  event: SaudiEvent,
  today: string,
  withinDays = EVENT_WINDOW_DAYS,
): number | null {
  const last = event.endDate ?? event.date;
  if (last < today) return null;
  if (event.date <= today) return 0;
  const n = dayIndex(event.date) - dayIndex(today);
  return n <= withinDays ? n : null;
}

/** Events within the window (running ones first), as the dashboard's `upcomingEvents` orders them. */
export function upcoming(
  events: readonly SaudiEvent[],
  today: string,
  withinDays = EVENT_WINDOW_DAYS,
): { event: SaudiEvent; inDays: number }[] {
  const out: { event: SaudiEvent; inDays: number }[] = [];
  for (const event of events) {
    const inDays = daysUntil(event, today, withinDays);
    if (inDays !== null) out.push({ event, inDays });
  }
  return out.sort((a, b) =>
    a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : 0,
  );
}

/** The row for one event: the closer it is, the higher the score (running = 100). */
export function eventItem(event: SaudiEvent, inDays: number, now: Date): TrendItem {
  const last = event.endDate ?? event.date;
  return {
    id: `event:SA:${event.id}`,
    platform: "event",
    region: "SA",
    lang: "mixed",
    title: `${event.name.ar} · ${event.name.en}`,
    score: Math.max(0, Math.round(100 * (1 - inDays / EVENT_WINDOW_DAYS))),
    source: SOURCE_LABELS.events,
    why: event.hashtags.join(" ") || undefined,
    seenAt: now.toISOString(),
    expiresAt: `${addDays(last, 1)}T00:00:00+03:00`,
    tags: [event.kind, ...event.hashtags],
  };
}

export function eventItems(events: readonly SaudiEvent[], now: Date): TrendItem[] {
  return upcoming(events, riyadhDay(now)).map(({ event, inDays }) => eventItem(event, inDays, now));
}

/** No calls. */
export async function runEvents(ctx: SourceCtx): Promise<SourceOutput> {
  return { ok: true, items: eventItems(SAUDI_EVENTS, ctx.now) };
}
