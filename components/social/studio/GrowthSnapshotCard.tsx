"use client";

import { RefreshCw, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, type ReactNode } from "react";
import LineChart from "@/components/social/growth/LineChart";
import Card, { CardHead, HeadLink } from "@/components/ui/ios/Card";
import EmptyState from "@/components/ui/ios/EmptyState";
import StatTile from "@/components/ui/ios/StatTile";
import { useInView } from "@/components/ui/ios/useInView";
import { allOverview } from "@/lib/analytics";
import { PLATFORMS } from "@/lib/domain";
import { bestPlatform, followerTrail, snapshotDelta, totals } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { timeAgo } from "@/lib/socialSync";
import { analyticsState, useStore } from "@/store";
import { useShallow } from "zustand/react/shallow";
import { compactCount, fmtSigned } from "../growth/format";
import { withNum } from "./platform";

/** Sum of the platforms' 30-day deltas; null when no platform has a baseline yet. */
function sumDelta(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/**
 * Followers + 30-day views across every platform with numbers (count up on the first visit), their 30-day deltas,
 * the 30-day follower sparkline and the fastest-growing platform (only when it grew). The card sits below the fold,
 * so the count-up and the draw-on wait until it is on screen and has risen.
 */
export default function GrowthSnapshotCard({ today, first }: { today: string; first: boolean }) {
  const { t, L, lang } = useT();
  const snapshots = useStore((s) => s.socialSnapshots);
  const lastPullAt = useStore((s) => s.socialSync.lastPullAt);
  const state = useStore(useShallow(analyticsState));
  // Followers come from the Social Analytics rules (sum over connected platforms); views stay the 30-day sums.
  const all = useMemo(() => allOverview(state), [state]);
  const sums = useMemo(() => totals(snapshots), [snapshots]);
  const deltas = useMemo(() => PLATFORMS.map((p) => snapshotDelta(snapshots, p)), [snapshots]);
  const best = useMemo(() => bestPlatform(snapshots), [snapshots]);
  const trail = useMemo(() => followerTrail(snapshots, 30, today), [snapshots, today]);
  const followersDelta = sumDelta(deltas.map((d) => d.followers));
  const viewsDelta = sumDelta(deltas.map((d) => d.views));
  const empty = all.platforms.length === 0;
  const cardRef = useRef<HTMLDivElement>(null);
  const seen = useInView(cardRef);

  const delta = (n: number | null): ReactNode => {
    if (n === null) return undefined;
    // No change reads "0" in the neutral grey, without an arrow.
    const Icon = n < 0 ? TrendingDown : n > 0 ? TrendingUp : null;
    const tone = n < 0 ? "text-danger" : n === 0 ? "text-ink-2" : "";
    return (
      <span className={`inline-flex items-center gap-1 ${tone}`}>
        {Icon && <Icon size={13} strokeWidth={1.75} aria-hidden />}
        {withNum(t("social.studio.growthDelta"), fmtSigned(n))}
      </span>
    );
  };
  const followers = compactCount(all.totalFollowers);
  const views = compactCount(sums.views30d);

  return (
    <Card ref={cardRef} className="@container" testId="studio-growth" data-empty={empty}>
      <CardHead title={t("social.studio.growth")}>
        {!empty && (
          <HeadLink href="/social/growth/" testId="studio-growth-open">
            {t("social.studio.growthOpen")}
          </HeadLink>
        )}
      </CardHead>

      {empty ? (
        <EmptyState
          icon={<TrendingUp size={24} strokeWidth={1.75} aria-hidden />}
          title={t("social.studio.growthEmpty")}
          testId="studio-growth-empty"
          action={
            <Link
              href="/social/growth/"
              className="px-btn px-btn-ghost px-btn-sm no-underline"
              data-testid="studio-growth-add"
            >
              {t("social.studio.growthAdd")}
            </Link>
          }
        />
      ) : (
        <>
          {/* Side by side from 18rem; a narrower card (the desktop column) stacks them so each delta fits its line. */}
          <div className="grid grid-cols-1 gap-2 @[18rem]:grid-cols-2">
            <StatTile
              label={t("social.studio.growthFollowers")}
              value={followers.value}
              decimals={followers.decimals}
              suffix={followers.suffix}
              delta={delta(followersDelta)}
              countUp={first}
              start={seen}
              testId="studio-growth-followers"
              data-value={all.totalFollowers}
            />
            <StatTile
              label={t("social.studio.growthViews")}
              value={views.value}
              decimals={views.decimals}
              suffix={views.suffix}
              delta={delta(viewsDelta)}
              countUp={first}
              start={seen}
              testId="studio-growth-views"
            />
          </div>
          {/* The 30-day sparkline draws itself once the card is on screen (first visit only). */}
          {trail.length > 1 && (
            <LineChart
              mini
              className="mt-3"
              series={[
                {
                  id: "followers",
                  label: t("social.studio.growthFollowers"),
                  short: "F",
                  color: "var(--accent)",
                  points: trail.map((p) => ({ day: p.day, value: p.followers })),
                },
              ]}
              today={today}
              animate={first}
              start={seen}
            />
          )}
          <p className="text-ink-2 mt-2.5 flex items-center gap-1.5 text-[13px]">
            {best && best.followers > 0 ? (
              <>
                <Trophy size={15} strokeWidth={1.75} className="text-warn shrink-0" aria-hidden />
                <span>
                  {withNum(
                    t("social.studio.growthBest", {
                      platform: L(PLATFORM_META[best.platform].name),
                    }),
                    fmtSigned(best.followers),
                  )}
                </span>
              </>
            ) : (
              t("social.studio.growthPlatforms", { n: sums.platforms.length })
            )}
          </p>
          {lastPullAt && (
            <p
              className="text-muted mt-1 flex items-center gap-1 text-xs"
              data-testid="studio-growth-sync"
            >
              <RefreshCw size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
              {t("social.studio.lastSync", { ago: timeAgo(lastPullAt, lang) })}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
