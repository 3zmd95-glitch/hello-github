"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "@/components/player/useBackToClose";
import { useT } from "@/lib/i18n";
import { overdrag, prefersReducedMotion, settleStop } from "@/lib/motion";

const CloseContext = createContext<() => void>(() => {});

/** Close the surrounding sheet with its exit animation (for example after Save). */
export function useSheetClose(): () => void {
  return useContext(CloseContext);
}

type Phase = "enter" | "open" | "exit";
const DESKTOP = "(min-width: 768px)";
/** The exit transition takes 280ms; onClose runs after this. */
const EXIT_MS = 300;
/** Sheets open right now: #main stays scaled back until the last one closes. */
let behind = 0;

/**
 * iOS sheet (tools/18 §3.5). Portaled to <body> on the z-39 layer, so the skill popup (z-40), ConfirmDialog (z-50),
 * the player (z-60) and celebrations (z-80) open above it. Phones: a bottom sheet with detents (visible fractions of
 * the viewport), dragged by its grabber/header. md+: a centered dialog. Mounted = open; ✕, the backdrop, Esc, a drag
 * past the last detent and Back play the exit, then `onClose` runs (the caller unmounts it).
 */
export default function Sheet({
  onClose,
  title,
  sub,
  titleId,
  testId,
  detents = [0.6, 0.92],
  initialDetent = 0,
  attrs,
  backCloses = true,
  children,
}: {
  onClose: () => void;
  title: string;
  sub?: string;
  titleId: string;
  testId: string;
  detents?: readonly number[];
  initialDetent?: number;
  attrs?: Record<string, string>;
  backCloses?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("enter");
  const [detent, setDetent] = useState(() =>
    Math.min(Math.max(initialDetent, 0), detents.length - 1),
  );
  const [dragY, setDragY] = useState<number | null>(null);
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 0 : window.innerHeight));
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP).matches,
  );
  const closing = useRef(false);
  const exitTimer = useRef(0);
  const drag = useRef<{
    y0: number;
    base: number;
    y: number;
    lastY: number;
    lastT: number;
    v: number;
  } | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Viewport size and phone / desktop mode.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const read = () => {
      setVh(window.innerHeight);
      setDesktop(mq.matches);
    };
    window.addEventListener("resize", read);
    mq.addEventListener("change", read);
    return () => {
      window.removeEventListener("resize", read);
      mq.removeEventListener("change", read);
    };
  }, []);

  // Enter: one painted frame below the screen, then spring to the first detent (unless already closing).
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase((p) => (p === "enter" ? "open" : p)));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    setPhase("exit");
    exitTimer.current = window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);
  // Unmounted mid-exit (the caller dropped it early): a late onClose could close the sheet opened next.
  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  // Armed once the sheet has left "enter": an update, so React's development double effect (which runs on mount
  // only) never pushes, pops and pushes again (that popstate would close the sheet at once). Kept through the exit,
  // so the entry is dropped at unmount, after the animation.
  useBackToClose(backCloses && phase !== "enter", requestClose);

  // Scroll lock, focus in and back out, Esc.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [requestClose]);

  // Phones: the page behind scales back while a sheet is open (#main only; the sheet lives outside it).
  useEffect(() => {
    if (desktop || phase !== "open" || prefersReducedMotion()) return;
    const main = document.getElementById("main");
    if (!main) return;
    const top = main.getBoundingClientRect().top;
    main.style.transformOrigin = `50% ${Math.round(window.innerHeight / 2 - top)}px`;
    behind += 1;
    main.classList.add("ios-behind");
    return () => {
      behind -= 1;
      if (behind === 0) main.classList.remove("ios-behind");
    };
  }, [desktop, phase]);

  // Phone geometry: the panel is as tall as the largest detent; each detent is a translateY from there.
  const large = Math.max(...detents);
  const height = Math.round(large * vh);
  const restY = (i: number) => Math.round((large - detents[i]) * vh);
  const closedY = height + 24;
  const order = detents.map((_, i) => i).sort((a, b) => restY(a) - restY(b));
  const stops = [...order.map(restY), closedY];

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (desktop || phase !== "open" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const base = restY(detent);
    drag.current = { y0: e.clientY, base, y: base, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    setDragY(base);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = d.base + (e.clientY - d.y0);
    d.y = raw < 0 ? -overdrag(-raw) : raw;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setDragY(d.y);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    // A finger that stopped before lifting is not a fling: the last move's speed only counts for 80ms.
    const v = e.timeStamp - d.lastT > 80 ? 0 : d.v;
    const i = settleStop(d.y, v, stops);
    setDragY(null);
    if (i === stops.length - 1) requestClose();
    else setDetent(order[i]);
  };

  if (typeof document === "undefined") return null;
  const y = phase === "open" ? (dragY ?? restY(detent)) : closedY;
  const style = desktop
    ? undefined
    : ({
        height,
        transform: `translate3d(0, ${y}px, 0)`,
        transition: dragY === null ? undefined : "none",
        // The resting detent's hidden part, also while dragged and closing: shrinking it would clamp the body's
        // scrollTop and jump the content. It changes only when a drag settles on another detent.
        "--sheet-hidden": `${restY(detent)}px`,
      } as CSSProperties);

  return createPortal(
    <CloseContext.Provider value={requestClose}>
      <div className="ios-sheet-root" data-phase={phase}>
        <div className="ios-backdrop" data-testid="sheet-backdrop" onClick={requestClose} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="ios-sheet"
          data-mode={desktop ? "dialog" : "sheet"}
          data-testid={testId}
          style={style}
          {...attrs}
        >
          <div
            className="ios-grab"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            {!desktop && <span className="ios-handle" aria-hidden />}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id={titleId} className="ios-sheet-title">
                  {title}
                </h2>
                {sub && <p className="ios-sheet-sub">{sub}</p>}
              </div>
              <button
                type="button"
                className="ios-close"
                aria-label={t("common.close")}
                onClick={requestClose}
              >
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
          <div className="ios-sheet-body">{children}</div>
        </div>
      </div>
    </CloseContext.Provider>,
    document.body,
  );
}
