import type { Lang } from "@/lib/domain";
import { TIME_ZONE } from "@/lib/streak";

// Gregorian calendar and Latin digits in Arabic too (numbers use the pixel font across the app).
const locale = (lang: Lang) => (lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB");

/** "26 Sep 2026" / "26 سبتمبر 2026" on the Riyadh day of an ISO timestamp. */
export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(d);
}
