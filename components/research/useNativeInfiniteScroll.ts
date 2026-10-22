"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

type NativeLoadOrigin =
  "wheel" | "key" | "touch" | "scroll" | "scroll-pointer" | "manual" | "observer";
interface NativeLoadDecision {
  t: number;
  origin: NativeLoadOrigin;
  busy: boolean;
  near: boolean;
  intent: boolean;
  scrollTop: number;
  started: boolean;
}
const nativeLoads: NativeLoadDecision[] = [];
/** Opt-in, local-only record of the last 20 load decisions for live checks:
 * `localStorage.setItem("3z-debug-native", "1")`, reload, then read `window.__3zNativeLoads`. */
function nativeLoadLog() {
  try {
    if (localStorage.getItem("3z-debug-native") !== "1") return undefined;
    if (!("__3zNativeLoads" in window))
      Object.defineProperty(window, "__3zNativeLoads", {
        configurable: true,
        get: () => Object.freeze(nativeLoads.map((entry) => Object.freeze({ ...entry }))),
      });
    return (entry: NativeLoadDecision) => {
      nativeLoads.push(entry);
      if (nativeLoads.length > 20) nativeLoads.shift();
    };
  } catch {
    return undefined;
  }
}

/** Reader input starts a continuation. While the reader stays near the end, a newly
 * delivered batch can continue it without another gesture. An unchanged batch never
 * loops; upward input, a new scope, or leaving this view clears continuation intent. */
export function useNativeInfiniteScroll(options: {
  enabled: boolean;
  scope: string;
  busy: boolean;
  canLoad: boolean;
  /** Visible card identities, not metadata: also changes when a bounded window rolls. */
  progressKey: string;
  loadMore(origin: "automatic" | "manual"): void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const current = useRef(options);
  const locked = useRef(false);
  const near = useRef(false);
  const intent = useRef(false);
  const requestedProgress = useRef<string | null>(null);
  const continueAfterRender = useRef<(() => void) | null>(null);
  const log = useRef<ReturnType<typeof nativeLoadLog>>(undefined);
  const record = (origin: NativeLoadOrigin, started: boolean) =>
    log.current?.({
      t: Date.now(),
      origin,
      busy: current.current.busy,
      near: near.current,
      intent: intent.current,
      scrollTop: (document.scrollingElement ?? document.documentElement).scrollTop,
      started,
    });
  useLayoutEffect(() => {
    current.current = options;
    if (!options.busy) locked.current = false;
  });
  useEffect(() => {
    if (options.busy) return;
    // Let layout/IntersectionObserver catch up with the new cards first.
    const frame = requestAnimationFrame(() => continueAfterRender.current?.());
    return () => cancelAnimationFrame(frame);
  }, [options.busy, options.progressKey, options.canLoad]);
  useEffect(() => {
    const node = sentinel.current;
    if (!options.enabled || !node || typeof IntersectionObserver === "undefined") return;
    log.current = nativeLoadLog();
    let disposed = false;
    let pointer = false;
    let touchY: number | undefined;
    near.current = false;
    intent.current = false;
    requestedProgress.current = null;
    const positions = new WeakMap<Element, number>();
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      positions.set(parent, parent.scrollTop);
    const attempt = (origin: NativeLoadOrigin) => {
      const latest = current.current;
      const start = !(
        disposed ||
        !near.current ||
        !intent.current ||
        requestedProgress.current === latest.progressKey ||
        locked.current ||
        !latest.enabled ||
        latest.busy ||
        !latest.canLoad
      );
      if (near.current || origin === "observer") record(origin, start);
      if (!start) return;
      requestedProgress.current = latest.progressKey;
      locked.current = true;
      latest.loadMore("automatic");
    };
    continueAfterRender.current = () => {
      const rect = node.getBoundingClientRect();
      near.current = rect.bottom >= -480 && rect.top <= window.innerHeight + 480;
      if (document.visibilityState === "visible") attempt("observer");
    };
    const downward = (origin: NativeLoadOrigin) => {
      // Keep intent during loading, but only new cards can release the next batch.
      if (current.current.busy || locked.current) {
        intent.current = true;
        return;
      }
      if (!current.current.canLoad) return;
      requestedProgress.current = null;
      intent.current = true;
      attempt(origin);
    };
    const upward = () => {
      intent.current = false;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        near.current = entries.some((entry) => entry.target === node && entry.isIntersecting);
        attempt("observer");
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(node);
    const scroll = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : (document.scrollingElement ?? document.documentElement);
      if (!target.contains(node)) return;
      const previous = positions.get(target) ?? target.scrollTop;
      positions.set(target, target.scrollTop);
      if (target.scrollTop > previous + 1) {
        if (pointer) downward("scroll-pointer");
        else if (near.current) record("scroll", false);
      } else if (pointer && target.scrollTop < previous - 1) upward();
    };
    const press = () => {
      pointer = true;
    };
    const release = () => {
      pointer = false;
    };
    const wheel = (event: WheelEvent) => {
      if (event.deltaY > 0) downward("wheel");
      else if (event.deltaY < 0) upward();
    };
    const touchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY;
    };
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y !== undefined && touchY !== undefined) {
        if (touchY - y > 4) downward("touch");
        else if (y - touchY > 4) upward();
      }
      touchY = y;
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      if (
        ["ArrowDown", "PageDown", "End"].includes(event.key) ||
        (event.key === " " && !event.shiftKey)
      )
        downward("key");
      else if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      )
        upward();
    };
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    window.addEventListener("pointerdown", press, { capture: true, passive: true });
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchmove", touchMove, { passive: true });
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      continueAfterRender.current = null;
      observer.disconnect();
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("keydown", key);
    };
  }, [options.enabled, options.scope]);
  /** The Load more button: a manual request spends any pending downward input. */
  const manual = () => {
    record("manual", true);
    intent.current = false;
    requestedProgress.current = current.current.progressKey;
    current.current.loadMore("manual");
  };
  return { sentinel, manual };
}
