"use client";

import TrendRadar from "@/components/social/trends/TrendRadar";

/**
 * 📈 Trends in the ideas bank: the mount point of the Trend Radar (round 30, planning/tools/08-trends.md),
 * which replaced the Sprint 4 "soon" placeholder. The radar keeps `data-testid="ideas-trends"`.
 */
export default function TrendsCard() {
  return <TrendRadar />;
}
