import type { Platform } from "@/lib/domain";
import type { MetricFormat } from "@/lib/analytics";

/**
 * Number formatting for the Social Analytics screen, the way Beacons shows them: Latin digits in both
 * languages, compact from 1,000 up with one decimal ("1.5k", "30.2k", "1.2m"), whole numbers below.
 */
const plain = new Intl.NumberFormat("en");

const oneDecimal = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
};

export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${oneDecimal(abs / 1_000_000)}m`;
  if (abs >= 1_000) return `${sign}${oneDecimal(abs / 1_000)}k`;
  return `${sign}${plain.format(Math.round(abs))}`;
}

/** Signed compact count: "+300", "−1.2k", "0". */
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

/** Axis ticks: "1.2k" style, but whole numbers under 1,000. */
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
