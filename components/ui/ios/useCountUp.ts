"use client";

import { useEffect, useRef, useState } from "react";
import { easeOutCubic, prefersReducedMotion } from "@/lib/motion";

function fmt(v: number, decimals: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Counts to `target` (1000ms, ease-out cubic): from 0 the first time, from the value on screen when the target
 * changes later (a refresh). While `start` is false it holds (0 at first) and schedules no frames, so a count below
 * the fold can wait to be seen. Reduced motion or `enabled: false` shows the target.
 */
export function useCountUp(
  target: number,
  {
    decimals = 0,
    duration = 1000,
    enabled = true,
    start = true,
  }: { decimals?: number; duration?: number; enabled?: boolean; start?: boolean } = {},
): string {
  const still = !enabled || prefersReducedMotion();
  const [shown, setShown] = useState(() => fmt(0, decimals));
  // The value on screen, where the next count starts.
  const at = useRef(0);
  useEffect(() => {
    if (still || !start) return;
    let raf = 0;
    const from = at.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      at.current = from + (target - from) * easeOutCubic(p);
      setShown(fmt(at.current, decimals));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, decimals, duration, still, start]);
  return still ? fmt(target, decimals) : shown;
}
