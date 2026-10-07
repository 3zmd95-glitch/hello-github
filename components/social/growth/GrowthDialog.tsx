"use client";

import type { ReactNode } from "react";
import Sheet from "@/components/ui/ios/Sheet";

/**
 * The Growth forms (a day's numbers, the stats CSV, the posts import, the demographics) as iOS sheets at one full
 * detent: the height a keyboard needs. The close button, the backdrop, Esc, a drag down and Back play the exit and
 * then `onClose` runs; the forms' own Cancel / Save buttons close through `useSheetClose()`, so the exit plays too.
 */
export default function GrowthDialog({
  title,
  testId,
  onClose,
  children,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet
      onClose={onClose}
      title={title}
      titleId={`${testId}-title`}
      testId={testId}
      detents={[0.92]}
      closeTestId={`${testId}-close`}
    >
      {children}
    </Sheet>
  );
}
