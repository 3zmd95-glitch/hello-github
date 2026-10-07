"use client";

import StatTile from "@/components/ui/ios/StatTile";
import type { AllOverview } from "@/lib/analytics";
import { useT } from "@/lib/i18n";
import { compactCount } from "./format";

/**
 * The "All" view's four KPI tiles (white cards on the page ground, as in the mockup): Total Followers · Avg.
 * Engagement · Avg. Likes · Avg. Views. The numbers count up on the first visit; a mean without data reads "–".
 */
export default function KpiRow({ all, countUp }: { all: AllOverview; countUp: boolean }) {
  const { t } = useT();
  const hint = t("growth.kpi.hint");
  const counted = (n: number | null) => (n === null ? null : compactCount(n));
  const tiles = [
    {
      id: "followers",
      label: t("growth.kpi.followers"),
      value: all.totalFollowers,
      parts: counted(all.totalFollowers),
    },
    {
      id: "engagement",
      label: t("growth.kpi.engagement"),
      value: all.avgEngagement,
      parts:
        all.avgEngagement === null
          ? null
          : { value: Math.round(all.avgEngagement * 10) / 10, decimals: 1, suffix: "%" },
      hint,
      /** Show the hint under the number (the tooltip is on every mean). */
      showHint: true,
    },
    {
      id: "likes",
      label: t("growth.kpi.likes"),
      value: all.avgLikes,
      parts: counted(all.avgLikes),
      hint,
    },
    {
      id: "views",
      label: t("growth.kpi.views"),
      value: all.avgViews,
      parts: counted(all.avgViews),
      hint,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="kpi-row">
      {tiles.map((k) =>
        k.parts ? (
          <StatTile
            key={k.id}
            className="ios-card"
            label={k.label}
            value={k.parts.value}
            decimals={k.parts.decimals}
            suffix={k.parts.suffix}
            countUp={countUp}
            delta={k.showHint ? <span className="text-muted">{k.hint}</span> : undefined}
            testId={`kpi-${k.id}`}
            data-value={k.value ?? ""}
            title={k.hint}
          />
        ) : (
          <div
            key={k.id}
            className="ios-stat ios-card"
            data-testid={`kpi-${k.id}`}
            data-value=""
            title={k.hint}
          >
            <small>{k.label}</small>
            <b className="num">–</b>
            {k.showHint && <span className="ios-delta text-muted">{k.hint}</span>}
          </div>
        ),
      )}
    </div>
  );
}
