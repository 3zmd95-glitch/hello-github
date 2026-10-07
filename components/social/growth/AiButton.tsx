"use client";

import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/** Beacons' "Ask Beam" style prompt: a small tinted button with a sparkle. Toggles a rule-based answer. */
export default function AiButton({
  onClick,
  pressed,
  testId,
  children,
}: {
  onClick: () => void;
  pressed?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="px-btn px-btn-ghost px-btn-sm gr-ai"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
    >
      <Sparkles size={14} strokeWidth={1.75} aria-hidden />
      <span>{children}</span>
    </button>
  );
}
