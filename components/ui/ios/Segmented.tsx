"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  testId?: string;
}

/**
 * iOS segmented control. Equal-width segments; the thumb is positioned once per layout (width + translateX) and
 * then only `transform` animates. Arrow keys move the selection (ArrowLeft = forward in RTL, back in LTR).
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  role = "tablist",
  className = "",
  testId,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  role?: "tablist" | "radiogroup";
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const seg = ref.current;
    const th = thumb.current;
    if (!seg || !th) return;
    const place = () => {
      const btn = seg.querySelector<HTMLButtonElement>(`button[data-v="${CSS.escape(value)}"]`);
      if (!btn) return;
      th.style.width = `${btn.offsetWidth}px`;
      th.style.setProperty("--x", `${btn.offsetLeft}px`);
    };
    if (placed.current) place();
    else {
      // The first placement is instant (as in the mockup); otherwise the thumb springs in from the left edge.
      th.style.transition = "none";
      place();
      void th.offsetWidth; // commit the position before the transition comes back
      th.style.transition = "";
      placed.current = true;
    }
    const ro = new ResizeObserver(place);
    ro.observe(seg);
    // <html dir> flips after this effect (useDocumentLang is a passive effect) and mirrors the row without resizing it.
    const mo = new MutationObserver(place);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [value, options.length]);

  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = (ref.current?.closest("[dir]") as HTMLElement | null)?.dir !== "ltr";
    const forward = e.key === (rtl ? "ArrowLeft" : "ArrowRight");
    const back = e.key === (rtl ? "ArrowRight" : "ArrowLeft");
    if (!forward && !back) return;
    e.preventDefault();
    const next = options[(idx + (forward ? 1 : -1) + options.length) % options.length];
    onChange(next.value);
    ref.current
      ?.querySelector<HTMLButtonElement>(`button[data-v="${CSS.escape(next.value)}"]`)
      ?.focus();
  };

  const item = role === "tablist" ? "tab" : "radio";
  const state = role === "tablist" ? "aria-selected" : "aria-checked";
  return (
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className={`ios-seg ${className}`}
      onKeyDown={onKey}
      data-testid={testId}
    >
      <span ref={thumb} className="ios-seg-thumb" aria-hidden />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={item}
            {...{ [state]: on }}
            tabIndex={on ? 0 : -1}
            data-v={o.value}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
