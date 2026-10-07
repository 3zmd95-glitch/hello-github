import { dayKeyToDate } from "@/components/planner/weekLabel";
import { DAY_KEY_RE, type Lang } from "@/lib/domain";
import { addDays, daysBetween, TIME_ZONE, weekKey } from "@/lib/streak";

/**
 * Calendar date helpers on top of lib/streak (Riyadh day keys, Sat-first weeks). Pure functions so the
 * views stay thin.
 */

// Gregorian calendar and Latin digits in Arabic too, like the planner labels.
const locale = (lang: Lang) => (lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB");

/** "YYYY-MM" of a day key. */
export function monthKeyOf(day: string): string {
  return day.slice(0, 7);
}

/** Shift a "YYYY-MM" key by n months. */
export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Day keys of the month grid: whole Sat → Fri weeks covering the month (35 or 42 cells). */
export function monthGrid(monthKey: string): string[] {
  const start = weekKey(`${monthKey}-01`);
  const last = addDays(`${addMonths(monthKey, 1)}-01`, -1);
  const end = addDays(weekKey(last), 6);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Saturday … 6 = Friday. */
export function dowIndex(day: string): number {
  return daysBetween(weekKey(day), day);
}

/** "September 2026" / "سبتمبر 2026". */
export function formatMonth(monthKey: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(dayKeyToDate(`${monthKey}-01`));
}

/**
 * Weekday labels of the week strip, Saturday first: one letter in Arabic (س ح ن … as in the mockup and the Studio's
 * week card), "Sat" in English (one letter repeats there).
 */
export function weekdayLetters(lang: Lang): string[] {
  const fmt = new Intl.DateTimeFormat(locale(lang), {
    weekday: lang === "ar" ? "narrow" : "short",
    timeZone: TIME_ZONE,
  });
  // 2026-01-03 is a Saturday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(dayKeyToDate(addDays("2026-01-03", i))));
}

/** "Saturday 26 Sep" / "السبت 26 سبتمبر". */
export function formatDayLong(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
  }).format(dayKeyToDate(day));
}

/** "26 Sep 2026, 21:04" for a posted-at instant. */
export function formatInstant(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

/* ---------- Hash deep links ---------- */

/**
 * The calendar's hash contract: `/social/calendar/#post=<postId>` opens that post's popup, `#day=YYYY-MM-DD`
 * focuses a day in the week view (both may be combined with `&`), `#new` opens the new-post sheet. The Studio home,
 * the Ideas bank and the skill sheet link here. Static export: read on mount and on `hashchange`; `#new`, `#day=`
 * and a deep-linked popup are one-shot, cleared with `history.replaceState` (no router push).
 */
export interface CalendarHash {
  post: string | null;
  day: string | null;
  newPost: boolean;
}

export function parseCalendarHash(hash: string): CalendarHash {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const day = params.get("day");
  return {
    post: params.get("post") || null,
    day: day && DAY_KEY_RE.test(day) ? day : null,
    newPost: params.has("new"),
  };
}

export function postHash(postId: string): string {
  return `#post=${encodeURIComponent(postId)}`;
}
