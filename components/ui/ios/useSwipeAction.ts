"use client";

import { useRef, useState, type HTMLAttributes, type PointerEvent } from "react";
import { rubberBand } from "@/lib/motion";

type Handlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

/**
 * Leading swipe on a row (toward the end edge: left in RTL). Returns the translateX to apply to the row, whether
 * the action is armed (past `arm` px) and pointer handlers. A vertical move at the start hands the gesture back to
 * scrolling (the row has `touch-action: pan-y`). Releasing while armed calls `onTrigger` and springs back; a
 * cancelled gesture (the browser took the pointer) only springs back.
 */
export function useSwipeAction(
  onTrigger: () => void,
  { max = 96, arm = 64, enabled = true }: { max?: number; arm?: number; enabled?: boolean } = {},
): { handlers: Handlers; x: number; armed: boolean; dragging: boolean } {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  // The offset is kept here too: the release reads the last move even before that move's render.
  const s = useRef({ x0: 0, y0: 0, x: 0, active: false, decided: false, rtl: true });

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!enabled || e.button) return;
    const st = s.current;
    st.x0 = e.clientX;
    st.y0 = e.clientY;
    st.x = 0;
    st.active = true;
    st.decided = false;
    st.rtl = (e.currentTarget.closest("[dir]") as HTMLElement | null)?.dir !== "ltr";
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const st = s.current;
    if (!st.active) return;
    // A mouse let go outside the row before the drag was decided (nothing had captured it yet) never sent its
    // pointerup here: with no button down the gesture is over, whatever the move says.
    if (e.pointerType === "mouse" && e.buttons === 0) return finish(false);
    const mx = e.clientX - st.x0;
    const my = e.clientY - st.y0;
    if (!st.decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx)) {
        st.active = false;
        return;
      }
      st.decided = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      // A mouse drag has started a text selection by now: a swipe is not a selection.
      document.getSelection()?.removeAllRanges();
    }
    // Toward the end edge only: negative in RTL, positive in LTR.
    const d = rubberBand(Math.max(0, st.rtl ? -mx : mx), max);
    st.x = st.rtl ? -d : d;
    setX(st.x);
  };
  const finish = (release: boolean) => {
    const st = s.current;
    if (!st.active) return;
    st.active = false;
    setDragging(false);
    setX(0);
    if (release && st.decided && Math.abs(st.x) >= arm) onTrigger();
  };
  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: () => finish(true),
      onPointerCancel: () => finish(false),
    },
    x,
    armed: Math.abs(x) >= arm,
    dragging,
  };
}
