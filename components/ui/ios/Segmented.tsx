"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  testId?: string;
}

/**
 * iOS segmented control. Equal-width segments; the thumb is positioned once per layout (width + translateX) and
 * then only `transform` animates. Arrow keys move the selection (ArrowLeft = forward in RTL, back in LTR). With
 * `idPrefix` each tab gets the id `${idPrefix}-tab-${value}` and `aria-controls` = `${idPrefix}-panel-${value}`: the
 * caller gives its `role="tabpanel"` that id and `aria-labelledby` the tab.
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  role = "tablist",
  className = "",
  testId,
  idPrefix,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  role?: "tablist" | "radiogroup";
  className?: string;
  testId?: string;
  idPrefix?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const seg = ref.current;
    const th = thumb.current;
    if (!seg || !th) return;
    /** Puts the thumb under the selected segment (`instant`: without the glide). No-op when it is already there. */
    const place = (instant: boolean) => {
      const btn = seg.querySelector<HTMLButtonElement>(`button[data-v="${CSS.escape(value)}"]`);
      if (!btn) return;
      const w = `${btn.offsetWidth}px`;
      const x = `${btn.offsetLeft}px`;
      if (th.style.width === w && th.style.getPropertyValue("--x") === x) return;
      if (instant) th.style.transition = "none";
      th.style.width = w;
      th.style.setProperty("--x", x);
      if (instant) {
        void th.offsetWidth; // commit the position before the transition comes back
        th.style.transition = "";
      }
    };
    // The first placement is instant (as in the mockup, not a spring in from the left edge); a new value glides.
    place(!placed.current);
    placed.current = true;
    // A re-measure puts the thumb in place, only when it moved: a resize, or <html dir> flipping after this effect
    // (useDocumentLang is a passive effect) and mirroring the row. The ResizeObserver's first call finds it in place,
    // so a glide in progress goes on.
    const snap = () => place(true);
    const ro = new ResizeObserver(snap);
    ro.observe(seg);
    const mo = new MutationObserver(snap);
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
      <span className="ios-seg-rail" aria-hidden>
        <span ref={thumb} className="ios-seg-thumb" />
      </span>
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
            id={idPrefix && `${idPrefix}-tab-${o.value}`}
            aria-controls={idPrefix && `${idPrefix}-panel-${o.value}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
