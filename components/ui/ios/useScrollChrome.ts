"use client";

import { useEffect } from "react";
import { clamp01, COMPACT_AT, MINI_DELTA, nextMini, TITLE_SPAN } from "@/lib/motion";

/**
 * Scroll-linked chrome for the Social shell: `--scroll-p` (0–1 over the first 56px) feeds the large title,
 * `data-compact` shows the glass slab + compact title past 44px, `data-tabbar="mini"` minimizes the tab bar on a
 * clear scroll down. Passive listener, one write per frame. `resetKey` (the pathname) restarts the direction memory.
 * The direction is read against an anchor that only moves once the page has moved ≥ 6px from it, so a slow scroll
 * (1–2px a frame) still minimizes and restores, the same at 60 Hz and 120 Hz.
 */
export function useScrollChrome(enabled: boolean, resetKey: string): void {
  useEffect(() => {
    const html = document.documentElement;
    const clear = () => {
      html.style.removeProperty("--scroll-p");
      delete html.dataset.compact;
      delete html.dataset.tabbar;
    };
    if (!enabled) {
      clear();
      return;
    }
    let last = window.scrollY;
    let mini = false;
    let ticking = false;
    const run = () => {
      ticking = false;
      const y = window.scrollY;
      html.style.setProperty("--scroll-p", clamp01(y / TITLE_SPAN).toFixed(3));
      if (y > COMPACT_AT) html.dataset.compact = "true";
      else delete html.dataset.compact;
      mini = nextMini(mini, y, last);
      if (mini) html.dataset.tabbar = "mini";
      else delete html.dataset.tabbar;
      if (Math.abs(y - last) >= MINI_DELTA) last = y;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(run);
    };
    run();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clear();
    };
  }, [enabled, resetKey]);
}
