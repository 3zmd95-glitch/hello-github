"use client";

import type { ReactNode } from "react";

/** Beacons' "Ask Beam" style prompt: an outlined accent pill with a sparkle. Toggles a rule-based answer. */
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
      className="an-ai"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
    >
      <span aria-hidden>✨</span>
      <span>{children}</span>
    </button>
  );
}
