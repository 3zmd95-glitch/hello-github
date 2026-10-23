import { RATE_DELIVERABLES, type RateDeliverable, type RateSettings } from "./domain";

/**
 * 💰 Rate calculator (planning/tools/09 D3). Pure. The owner's own assumptions, never a market rate:
 *
 *   SAR ≈ (followers ÷ 1000 × SAR per 1000 followers + average views ÷ 1000 × SAR per 1000 views) × multiplier
 *
 * One platform at a time (numbers are never pooled). No follower count, no quote. Missing average views are not
 * guessed: the views part is 0 and the quote says so (`viewsMissing`). The result is private: the media-kit page
 * only ever says "rates on request".
 */

export interface RateQuote {
  followers: number;
  avgViews: number | null;
  followersPart: number;
  viewsPart: number;
  base: number;
  multiplier: number;
  /** Before rounding, two decimals. */
  raw: number;
  /** The amount to quote, rounded (roundRate). */
  sar: number;
  viewsMissing: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nearest 10 SAR below 500, nearest 50 SAR from 500; a positive amount never rounds down to 0. */
export function roundRate(sar: number): number {
  if (!(sar > 0)) return 0;
  const step = sar < 500 ? 10 : 50;
  return Math.max(step, Math.round(sar / step) * step);
}

export function rateQuote(
  settings: RateSettings,
  followers: number | null,
  avgViews: number | null,
  deliverable: RateDeliverable,
): RateQuote | null {
  if (followers === null || !(followers > 0)) return null;
  const views = avgViews !== null && avgViews > 0 ? avgViews : null;
  const followersPart = round2((followers / 1000) * settings.sarPerThousandFollowers);
  const viewsPart = views === null ? 0 : round2((views / 1000) * settings.sarPerThousandViews);
  const base = round2(followersPart + viewsPart);
  const multiplier = settings.multiplier[deliverable];
  const raw = round2(base * multiplier);
  return {
    followers,
    avgViews: views,
    followersPart,
    viewsPart,
    base,
    multiplier,
    raw,
    sar: roundRate(raw),
    viewsMissing: views === null,
  };
}

/** Every deliverable's quote for one platform's numbers, in RATE_DELIVERABLES order. */
export function rateTable(
  settings: RateSettings,
  followers: number | null,
  avgViews: number | null,
): { deliverable: RateDeliverable; quote: RateQuote | null }[] {
  return RATE_DELIVERABLES.map((deliverable) => ({
    deliverable,
    quote: rateQuote(settings, followers, avgViews, deliverable),
  }));
}
