import type { MessageKey, Vars } from "@/lib/i18n";

/** Message key + vars for a countdown: "in 2d 4h" / "in 3h 20m" / "in 35 min" / "now!". */
export function countdownText(ms: number): { key: MessageKey; vars?: Vars } {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMin < 1) return { key: "social.studio.countdownNow" };
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return { key: "social.studio.countdownDays", vars: { d, h } };
  if (h > 0) return { key: "social.studio.countdownHours", vars: { h, m } };
  return { key: "social.studio.countdownMin", vars: { m } };
}
