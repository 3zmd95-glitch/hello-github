"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The ⋯ menu, a `<details>` popover: picking an item closes it, and so does a tap elsewhere or Escape. A pick or Escape
 * first hands focus to the ⋯ button, so it does not drop to <body> with the hidden item (an editor sheet opened by the
 * pick gives focus back to that button when it closes). Its look is the `ar-menu` / `ar-pop` rules in globals.css.
 */
export default function RowMenu({
  label,
  children,
  testId = "row-menu",
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const shut = (el: HTMLDetailsElement) => {
    el.querySelector("summary")?.focus({ preventScroll: true });
    el.open = false;
  };
  return (
    <details
      ref={ref}
      className="ar-menu"
      onToggle={(e) => setOpen(e.currentTarget.open)}
      onClick={(e) => {
        if ((e.target as Element).closest(".ar-pop button")) shut(e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.currentTarget.open) shut(e.currentTarget);
      }}
    >
      <summary aria-label={label} data-testid={testId}>
        <Ellipsis size={18} strokeWidth={2} aria-hidden />
      </summary>
      <div className="ar-pop">{children}</div>
    </details>
  );
}
