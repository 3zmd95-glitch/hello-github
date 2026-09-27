import type { Lang } from "@/lib/domain";
import { addDays, TIME_ZONE } from "@/lib/streak";

/** Noon Riyadh of a day key, so formatting never slips into the neighbouring day. */
export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T12:00:00+03:00`);
}

// Gregorian calendar and Latin digits in Arabic too: the app shows numbers in the pixel font.
const locale = (lang: Lang) => (lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB");

/** "26 Sep" / "26 سبتمبر". */
export function formatDayShort(key: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
  }).format(dayKeyToDate(key));
}

/** Day of month only, e.g. "26". */
export function formatDayNumber(key: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: TIME_ZONE }).format(
    dayKeyToDate(key),
  );
}

/** Saturday and Friday of the week that starts on `weekStart`, formatted. */
export function weekRange(weekStart: string, lang: Lang): { from: string; to: string } {
  return { from: formatDayShort(weekStart, lang), to: formatDayShort(addDays(weekStart, 6), lang) };
}

/** "5:00" from minutes. */
export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
