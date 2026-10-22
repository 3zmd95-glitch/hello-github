import type { Platform } from "@/lib/domain";
import type { MetricFormat } from "@/lib/analytics";

/**
 * Number formatting for the Social world (Studio, Growth, the Trend Radar): Latin digits in both languages; counts
 * compact from 1,000 up with an uppercase K / M and one decimal where it adds information ("12.4K", "184.2K",
 * "30K", "2.1M"), whole numbers below.
 */
const plain = new Intl.NumberFormat("en");

const oneDecimal = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
};

/**
 * A count split for display and for a count-up that keeps its suffix: 1_478 → 1.5 "K", 30_000 → 30 "K",
 * 184_230 → 184.2 "K", 999 → 999 "". A rounding that reaches the next unit moves up (999_950 → 1 "M").
 * Printed as `value` with `decimals` digits, then the suffix, it reads like `fmtCount`.
 */
export function compactCount(n: number): { value: number; decimals: number; suffix: string } {
  const abs = Math.abs(n);
  const [unit, suffix] = abs >= 999_950 ? [1_000_000, "M"] : abs >= 999.5 ? [1_000, "K"] : [1, ""];
  const value = unit === 1 ? Math.round(abs) : Math.round((abs / unit) * 10) / 10;
  return { value: n < 0 ? -value : value, decimals: Number.isInteger(value) ? 0 : 1, suffix };
}

/** "12.4K", "184.2K", "−300": `compactCount` as text (a minus sign, not a hyphen). */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const { value, decimals, suffix } = compactCount(n);
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(decimals)}${suffix}`;
}

/** Signed compact count: "+300", "−1.2K", "0". */
export function fmtSigned(n: number): string {
  if (!Number.isFinite(n)) return "–";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${fmtCount(Math.abs(n))}`;
}

/** Signed percentage with one decimal at most: "+10%", "−3.5%". */
export function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return "–";
  const s = oneDecimal(Math.abs(p));
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${s}%`;
}

/** Engagement as reported: "7.8%". */
export function fmtEngagement(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "–";
  return `${oneDecimal(p)}%`;
}

/** Watch time in seconds → "45s", "1m 23s", "1h 05m". */
export function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "–";
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** A metric value in the format lib/analytics assigns it; "–" when unknown. */
export function fmtMetric(value: number | null | undefined, format: MetricFormat): string {
  if (value === null || value === undefined) return "–";
  switch (format) {
    case "pct":
      return fmtEngagement(value);
    case "seconds":
      return fmtSeconds(value);
    default:
      return fmtCount(value);
  }
}

/** Axis ticks: "1.2K" style, but whole numbers under 1,000. */
export function fmtTick(n: number): string {
  return Math.abs(n) >= 1000 ? fmtCount(n) : plain.format(Math.round(n));
}

/** Public profile URL from a handle when the owner did not type one. */
export function profileUrl(platform: Platform, handle: string): string {
  const h = encodeURIComponent(handle.replace(/^@/, ""));
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "instagram":
      return `https://www.instagram.com/${h}/`;
    case "youtube":
      return `https://www.youtube.com/@${h}`;
    case "threads":
      return `https://www.threads.net/@${h}`;
    case "x":
      return `https://x.com/${h}`;
    case "snapchat":
      return `https://www.snapchat.com/add/${h}`;
  }
}
