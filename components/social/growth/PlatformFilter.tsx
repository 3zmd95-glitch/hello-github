"use client";

import { useEffect, useRef } from "react";
import Segmented, { type SegmentedOption } from "@/components/ui/ios/Segmented";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";

export type AnalyticsFilter = "all" | Platform;

/** Platforms without a free API: still selectable, marked "manual only" (tooltip + read out after the name). */
export const MANUAL_ONLY: readonly Platform[] = ["x", "snapchat"];

/** The page gutter the selected segment keeps from the scroller's edges. */
const GUTTER = 16;

/**
 * How far (px, left to right) the scroller must move so the segment sits inside it, past the gutter; 0 when it
 * already does. Both are viewport rectangles, so it reads the same in RTL and LTR.
 */
function revealDelta(scroller: DOMRect, segment: DOMRect): number {
  if (segment.left < scroller.left + GUTTER) return segment.left - scroller.left - GUTTER;
  if (segment.right > scroller.right - GUTTER) return segment.right - scroller.right + GUTTER;
  return 0;
}

/**
 * All · TikTok · Instagram · YouTube · Threads · X · Snapchat: the iOS segmented control that drives the whole page.
 * Seven equal segments do not fit a phone, so the control keeps the widest label's width for each and scrolls
 * sideways, edge to edge (`.gr-seg`).
 */
export default function PlatformFilter({
  value,
  onChange,
}: {
  value: AnalyticsFilter;
  onChange: (next: AnalyticsFilter) => void;
}) {
  const { t, L } = useT();
  const scroller = useRef<HTMLDivElement>(null);
  // A platform picked elsewhere (a card's Open) can sit off-screen in the sideways scroller: bring it in by moving
  // the scroller only (scrollIntoView would scroll the page too).
  useEffect(() => {
    const sc = scroller.current;
    const seg = sc?.querySelector(`button[data-v="${value}"]`);
    if (!sc || !seg) return;
    const delta = revealDelta(sc.getBoundingClientRect(), seg.getBoundingClientRect());
    if (delta !== 0)
      sc.scrollTo({
        left: sc.scrollLeft + delta,
        behavior: prefersReducedMotion() ? "instant" : "smooth",
      });
  }, [value]);
  const options: SegmentedOption<AnalyticsFilter>[] = [
    { value: "all", label: t("growth.filter.all"), testId: "analytics-platform-all" },
    ...PLATFORMS.map((p) => {
      const manual = MANUAL_ONLY.includes(p);
      return {
        value: p,
        testId: `analytics-platform-${p}`,
        label: (
          <span
            className="inline-flex items-center gap-1"
            title={manual ? t("growth.filter.manual") : undefined}
            data-manual={manual || undefined}
          >
            <PlatformGlyph platform={p} size={13} className="shrink-0" />
            {L(PLATFORM_META[p].name)}
            {manual && <span className="sr-only"> · {t("growth.filter.manual")}</span>}
          </span>
        ),
      };
    }),
  ];
  return (
    <div ref={scroller} className="no-scrollbar -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <Segmented
        options={options}
        value={value}
        onChange={onChange}
        label={t("growth.filter.aria")}
        testId="analytics-platform"
        className="gr-seg"
        idPrefix="gr"
      />
    </div>
  );
}
