"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The Social world's dialog frame, same contract as the skill sheet: bottom sheet on phones, centered dialog
 * from md up, on the z-40 layer under the celebrations (z-80) and under ConfirmDialog (z-50). Locks body
 * scroll, closes on Esc and on a backdrop tap, moves focus in and back out.
 */
export default function SheetFrame({
  testId,
  titleId,
  onClose,
  wide,
  attrs,
  children,
}: {
  testId: string;
  titleId: string;
  onClose: () => void;
  /** Wider dialog on desktop (the post popup). */
  wide?: boolean;
  attrs?: Record<string, string>;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="anim-fade fixed inset-0 z-40 flex items-end justify-center bg-[rgba(5,8,12,.62)] md:items-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="sheet-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        {...attrs}
        className={`px-card anim-sheet cal-sheet relative flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto overscroll-contain pb-[calc(16px+env(safe-area-inset-bottom,0px))] outline-none md:pb-4 ${wide ? "md:max-w-[680px]" : "md:max-w-[520px]"}`}
      >
        {children}
      </div>
    </div>
  );
}
