"use client";

import type { AllOverview } from "@/lib/analytics";
import { useT } from "@/lib/i18n";
import { fmtCount, fmtEngagement } from "./format";

/** The "All" view's four KPI cards: Total Followers · Avg. Engagement · Avg. Likes · Avg. Views. */
export default function KpiRow({ all }: { all: AllOverview }) {
  const { t } = useT();
  const hint = t("growth.kpi.hint");
  const tiles: {
    id: string;
    label: string;
    value: number | null;
    text: string;
    hint?: string;
    /** Show the hint under the number (the tooltip is on every mean). */
    showHint?: boolean;
  }[] = [
    {
      id: "followers",
      label: t("growth.kpi.followers"),
      value: all.totalFollowers,
      text: fmtCount(all.totalFollowers),
    },
    {
      id: "engagement",
      label: t("growth.kpi.engagement"),
      value: all.avgEngagement,
      text: fmtEngagement(all.avgEngagement),
      hint,
      showHint: true,
    },
    {
      id: "likes",
      label: t("growth.kpi.likes"),
      value: all.avgLikes,
      text: all.avgLikes === null ? "–" : fmtCount(all.avgLikes),
      hint,
    },
    {
      id: "views",
      label: t("growth.kpi.views"),
      value: all.avgViews,
      text: all.avgViews === null ? "–" : fmtCount(all.avgViews),
      hint,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="kpi-row">
      {tiles.map((k) => (
        <div
          key={k.id}
          className="px-inset an-kpi"
          data-testid={`kpi-${k.id}`}
          data-value={k.value ?? ""}
          title={k.hint}
        >
          <span className="text-muted text-xs">{k.label}</span>
          <b className="gr-value">{k.text}</b>
          {k.showHint && <span className="text-muted text-[0.68rem] leading-tight">{k.hint}</span>}
        </div>
      ))}
    </div>
  );
}
