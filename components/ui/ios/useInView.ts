"use client";

import { useEffect, useState, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * One-shot "seen": true once at least `threshold` of the element is in the viewport and its own entrance animation
 * (the first-visit stagger) has ended; the observer then disconnects. Motion below the fold (a count-up, a line
 * drawing itself) waits for it, so it plays where the owner can see it. True at once without IntersectionObserver
 * or with reduced motion.
 *
 * The entrance is read with `getAnimations()` rather than an `animationend` listener: the stagger starts with the
 * prerendered HTML, so it can end before hydration attaches anything, and a listener would then wait forever.
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
        if (!entries.some((e) => e.isIntersecting)) return;
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
