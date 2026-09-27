/**
 * Riyadh time helpers. Saudi Arabia is UTC+03:00 all year (no DST), so the day key and the offset can be
 * computed without Intl: shift by three hours and read the UTC fields.
 */

export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(d: Date | string | number): Date {
  if (d instanceof Date) return d;
  // Meta writes offsets without a colon ("2026-09-20T10:00:00+0000"), which not every parser accepts.
  if (typeof d === "string") return new Date(d.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return new Date(d);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the Riyadh calendar day that contains the instant. */
export function riyadhDay(d: Date | string | number): string {
  const s = new Date(toDate(d).getTime() + RIYADH_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

/** "YYYY-MM-DDTHH:mm:ss+03:00" (the dashboard stores ISO timestamps with an offset). */
export function riyadhIso(d: Date | string | number): string {
  const s = new Date(toDate(d).getTime() + RIYADH_OFFSET_MS);
  return (
    `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}` +
    `T${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}+03:00`
  );
}

/** Unix seconds → Riyadh ISO. */
export function unixToRiyadhIso(seconds: number): string {
  return riyadhIso(seconds * 1000);
}

/** The day key `n` days before/after another (n may be negative). */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return riyadhDay(Date.UTC(y, m - 1, d, 0, 0, 0) - RIYADH_OFFSET_MS + n * DAY_MS);
}

/** Unix seconds of the start of a Riyadh day. */
export function dayStartUnix(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - RIYADH_OFFSET_MS) / 1000);
}

export const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
