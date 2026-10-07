"use client";

import { useEffect, useState, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * One-shot "seen": true once at least `threshold` of the element is in the viewport and its own entrance animation
 * (the first-visit stagger) has ended; the observer then disconnects. Motion below the fold (a count-up, a line
 * drawing itself) waits for it, so it plays where the owner can see it. True at once without IntersectionObserver
 * or with reduced motion.
 *
 * The entrance is read with `getAnimations()` rather than an `animationend` listener: a later visit has no entrance
 * animation, so no event would ever come, and a cancelled one never ends but its `finished` still settles. (The
 * Studio always mounts on the client after the splash, so its stagger is still running when this effect reads it.)
 *
 * An element taller than about 1/threshold viewport heights (≈ 2.9 at 0.35) never reaches the threshold, and an
 * infinite animation on the element itself never settles: either way `seen` stays false.
 */
export function useInView(ref: RefObject<Element | null>, threshold = 0.35): boolean {
  const instant = typeof IntersectionObserver === "undefined" || prefersReducedMotion();
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (instant || !el) return;
    let alive = true;
    // The element's own running animations (not its children's); none outside the stagger.
    const entered = Promise.allSettled(el.getAnimations?.().map((a) => a.finished) ?? []);
    const io = new IntersectionObserver(
      (entries) => {
        // The ratio too: Firefox reports isIntersecting for any overlap, below the threshold as well.
        if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= threshold)) return;
        io.disconnect();
        void entered.then(() => {
          if (alive) setSeen(true);
        });
      },
      { threshold },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [ref, instant, threshold]);

  return instant || seen;
}
