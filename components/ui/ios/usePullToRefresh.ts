"use client";

import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { pullOffset } from "@/lib/motion";

/** A refresh still running after this long lets the content spring back; the caller's toast lands when it settles. */
const HOLD_MAX_MS = 8000;

/**
 * Pull-to-refresh on the window scroll (the dashboard scrolls the document). Touch only: desktop has no pull.
 * A touch that starts inside the target (default `#main`) with the page at the top translates the target down with
 * resistance; past `threshold` the release calls `onRefresh`, holds the content at 56px with `refreshing: true`
 * (≥ 1.1s, at most 8s), then springs back. While enabled the page's own overscroll bounce is off, so the two never
 * stack. `onRefresh` gets `held`, which resolves when the spinner's minimum time is over (a toast that awaits it
 * lands as the content springs back). A failed `onRefresh` still springs back: the caller reports its own errors.
 * A new pull waits until the running refresh settles, also after the 8s spring back. Every listener is passive (spec
 * §3.5: touch scrolling never waits for the main thread); `overscroll-behavior-y: none` is what keeps the browser's
 * own bounce and pull-to-reload out of the way, so nothing needs `preventDefault`.
 */
export function usePullToRefresh(
  onRefresh: (held: Promise<void>) => Promise<unknown> | void,
  {
    enabled = true,
    threshold = 70,
    targetRef,
  }: { enabled?: boolean; threshold?: number; targetRef?: RefObject<HTMLElement | null> } = {},
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useEffectEvent(onRefresh);

  useEffect(() => {
    if (!enabled) return;
    const html = document.documentElement;
    const prevOverscroll = html.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "none";
    const target = () => targetRef?.current ?? document.getElementById("main");
    let alive = true;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    let y0 = 0;
    let dy = 0;
    let pulling = false;
    // This pull wrote a transform (and `transition: none`), so its release must spring back and clear them.
    let moved = false;
    let busy = false;
    const setY = (px: number, animate: boolean) => {
      const el = target();
      if (!el) return;
      el.style.transition = animate ? "transform var(--t-spring) var(--spring)" : "none";
      el.style.transform = px ? `translateY(${px}px)` : "";
    };
    const springBack = () => {
      setPull(0);
      setY(0, true);
      clearTimeout(settle);
      settle = setTimeout(() => {
        const el = target();
        if (el) el.style.transition = "";
      }, 600);
    };
    const start = (e: TouchEvent) => {
      if (busy || window.scrollY > 0 || !target()?.contains(e.target as Node)) return;
      pulling = true;
      moved = false;
      y0 = e.touches[0].clientY;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!pulling) return;
      // Above the starting point the offset is 0 and the finger scrolls the page as usual.
      const next = pullOffset(e.touches[0].clientY - y0);
      if (next === dy) return;
      dy = next;
      moved = true;
      setY(dy, false);
      setPull(dy);
    };
    const end = () => {
      if (!pulling) return;
      pulling = false;
      if (dy < threshold) {
        if (moved) springBack(); // a plain tap wrote nothing
        return;
      }
      busy = true;
      setRefreshing(true);
      setY(56, true);
      const held = new Promise<void>((r) => setTimeout(r, 1100));
      const settled = Promise.allSettled([held, Promise.resolve().then(() => refresh(held))]);
      const capped = new Promise<void>((r) => {
        cap = setTimeout(r, HOLD_MAX_MS);
      });
      void Promise.race([settled, capped]).then(() => {
        if (!alive) return;
        setRefreshing(false);
        springBack();
      });
      void settled.then(() => {
        busy = false;
        clearTimeout(cap);
      });
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      alive = false;
      clearTimeout(settle);
      clearTimeout(cap);
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      html.style.overscrollBehaviorY = prevOverscroll;
      const el = target();
      if (el) {
        el.style.transition = "";
        el.style.transform = "";
      }
    };
  }, [enabled, threshold, targetRef]);

  return { pull, refreshing };
}
