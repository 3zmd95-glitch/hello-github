"use client";

import { useEffect, useState } from "react";
import { easeOutCubic, prefersReducedMotion } from "@/lib/motion";

function fmt(v: number, decimals: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Counts from 0 to `target` (1000ms, ease-out cubic). Reduced motion or `enabled: false` shows the target. */
export function useCountUp(
  target: number,
  {
    decimals = 0,
    duration = 1000,
    enabled = true,
  }: { decimals?: number; duration?: number; enabled?: boolean } = {},
): string {
  const still = !enabled || prefersReducedMotion();
  const [shown, setShown] = useState(() => fmt(0, decimals));
  useEffect(() => {
    if (still) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(fmt(target * easeOutCubic(p), decimals));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, decimals, duration, still]);
  return still ? fmt(target, decimals) : shown;
}
