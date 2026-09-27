import type { Platform } from "@/lib/domain";

/**
 * Number formatting for the Growth screen: Latin digits in both languages, compact from 1,000 up
 * ("1.2K", "12.4K", "1.5M") so tiles and table cells stay short on a phone.
 */
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en");

export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return Math.abs(n) >= 1000 ? compact.format(n) : plain.format(n);
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
  const abs = Math.round(Math.abs(p) * 10) / 10;
  const s = abs % 1 === 0 ? String(abs) : abs.toFixed(1);
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${s}%`;
}

/** Engagement as reported: "4.2%". */
export function fmtEngagement(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "–";
  const r = Math.round(p * 10) / 10;
  return `${r % 1 === 0 ? String(r) : r.toFixed(1)}%`;
}

/** Axis ticks: "1.2K" style, but whole numbers under 1,000. */
export function fmtTick(n: number): string {
  return Math.abs(n) >= 1000 ? compact.format(n) : plain.format(Math.round(n));
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
