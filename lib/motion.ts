/** Pure motion helpers for the Social iOS look (tools/18 §3.5). No DOM here except prefersReducedMotion(). */

/** False without a window or matchMedia (server prerender, jsdom tests), so callers never throw. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - clamp01(p), 3);
}

/** Up to `limit` moves 1:1; beyond it the extra distance is compressed with a log curve (iOS rubber band). */
export function rubberBand(raw: number, limit: number, k = 24): number {
  if (raw <= limit) return raw;
  return limit + Math.log1p((raw - limit) / k) * (k * 0.6);
}

/** How far a sheet follows a finger that pulls it above its top edge. */
export function overdrag(px: number, k = 30): number {
  return Math.log1p(Math.max(0, px) / k) * k;
}

export const TITLE_SPAN = 56;
export const COMPACT_AT = 44;
export const MINI_DOWN = 140;
export const MINI_UP = 80;
export const MINI_DELTA = 6;
/** px/ms: a release faster than this steps one stop in its direction. */
export const FLING = 0.6;

/**
 * Tab bar minimize state: down by ≥ 6px past 140px minimizes; up by ≥ 6px or above 80px restores. `lastY` is the
 * anchor: the scroll position where the last ≥ 6px move was registered (not the previous frame's position).
 */
export function nextMini(prev: boolean, y: number, lastY: number): boolean {
  if (!prev) return y - lastY >= MINI_DELTA && y > MINI_DOWN;
  if (lastY - y >= MINI_DELTA || y < MINI_UP) return false;
  return true;
}

/** Pull-to-refresh offset: resistance then a hard cap. Negative pulls (scrolling up) give 0. */
export function pullOffset(dy: number, resistance = 0.55, max = 130): number {
  if (dy <= 0) return 0;
  return Math.min(max, dy * resistance);
}

/**
 * Where a released drag settles. `stops` are translateY positions in px, ascending (the last one is "closed");
 * `velocity` is px/ms, positive = down. A fling goes to the next stop in its direction; otherwise the nearest wins.
 */
export function settleStop(y: number, velocity: number, stops: readonly number[]): number {
  if (velocity > FLING) {
    const i = stops.findIndex((s) => s > y + 1);
    return i === -1 ? stops.length - 1 : i;
  }
  if (velocity < -FLING) {
    for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < y - 1) return i;
    return 0;
  }
  let best = 0;
  for (let i = 1; i < stops.length; i++)
    if (Math.abs(stops[i] - y) < Math.abs(stops[best] - y)) best = i;
  return best;
}
