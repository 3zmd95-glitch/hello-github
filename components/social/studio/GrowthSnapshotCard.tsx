"use client";

import { RefreshCw, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import Card, { CardHead, HeadLink } from "@/components/ui/ios/Card";
import EmptyState from "@/components/ui/ios/EmptyState";
import StatTile from "@/components/ui/ios/StatTile";
import { useInView } from "@/components/ui/ios/useInView";
import { allOverview } from "@/lib/analytics";
import { PLATFORMS } from "@/lib/domain";
import { bestPlatform, followerTrail, snapshotDelta, totals } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { prefersReducedMotion } from "@/lib/motion";
import { PLATFORM_META } from "@/lib/social";
import { timeAgo } from "@/lib/socialSync";
import { daysBetween } from "@/lib/streak";
import { analyticsState, useStore } from "@/store";
import { useShallow } from "zustand/react/shallow";
import { compactCount, fmtCount, withNum } from "./platform";

/** Sum of the platforms' 30-day deltas; null when no platform has a baseline yet. */
function sumDelta(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/** "+1.2K" / "−300" / "0" (growth/format.ts `fmtSigned`'s rule): the sign rides inside the number. */
const signed = (n: number) => (n === 0 ? "0" : `${n < 0 ? "−" : "+"}${fmtCount(Math.abs(n))}`);

/** The sparkline's viewBox (mockup `.chart`); it scales to the card width. */
const W = 320;
const H = 70;
const PAD = 8;

/**
 * Line + area paths of a series in the sparkline's viewBox, smoothed like the mockup (`M` the first point, `Q`
 * through each point to the midpoint of the next segment, `T` the last point); x follows the dates, y spans
 * min…max. `end` is the last point (the dot).
 */
export function sparkPath(points: readonly { day: string; followers: number }[]): {
  line: string;
  area: string;
  end: [number, number];
} {
  const first = points[0].day;
  const span = Math.max(1, daysBetween(first, points[points.length - 1].day));
  const vals = points.map((p) => p.followers);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const xy = points.map((p): [number, number] => [
    PAD + (daysBetween(first, p.day) / span) * (W - 2 * PAD),
    H - PAD - ((p.followers - min) / (max - min || 1)) * (H - 2 * PAD - 4),
  ]);
  const f = (n: number) => n.toFixed(1);
  let line = `M${f(xy[0][0])} ${f(xy[0][1])}`;
  for (let i = 1; i < xy.length; i++) {
    const [px, py] = xy[i - 1];
    const [x, y] = xy[i];
    line += ` Q${f(px)} ${f(py)} ${f((px + x) / 2)} ${f((py + y) / 2)}`;
  }
  const end = xy[xy.length - 1];
  line += ` T${f(end[0])} ${f(end[1])}`;
  const area = `${line} L${f(end[0])} ${H - PAD} L${f(xy[0][0])} ${H - PAD} Z`;
  return { line, area, end };
}

/**
 * 30-day total followers, 70px tall at phone width. On the first visit the line waits hidden until `start` (the
 * card is on screen), then draws itself once (dash offset after a double rAF, 1.3s), the area fades in and the end
 * dot pops; later visits and reduced motion show it drawn. Hand-drawn until Phase 5 brings LineChart's `mini` mode.
 */
export function Sparkline({
  points,
  animate,
  start,
}: {
  points: readonly { day: string; followers: number }[];
  animate: boolean;
  start: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const { line, area, end } = useMemo(() => sparkPath(points), [points]);
  const draw = animate && !prefersReducedMotion();
  const started = useRef(false);

  // Hidden before the first paint, so the drawn line never flashes; measured again when new numbers change the line
  // while it still waits. The cleanup shows it again while the draw has not started: if `draw` turns false meanwhile
  // (reduced motion switched on mid-visit), nothing else would.
  useLayoutEffect(() => {
    const svg = ref.current;
    const ln = svg?.querySelector<SVGPathElement>(".studio-spark-ln");
    if (!draw || started.current || !svg || !ln) return;
    const length = ln.getTotalLength();
    ln.style.strokeDasharray = `${length}`;
    ln.style.strokeDashoffset = `${length}`;
    svg.dataset.drawn = "false";
    return () => {
      if (started.current) return;
      ln.style.strokeDasharray = "";
      ln.style.strokeDashoffset = "";
      delete svg.dataset.drawn;
    };
  }, [draw, line]);

  useEffect(() => {
    const svg = ref.current;
    const ln = svg?.querySelector<SVGPathElement>(".studio-spark-ln");
    if (!draw || !start || !svg || !ln) return;
    started.current = true;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        ln.style.transition = "stroke-dashoffset 1.3s var(--out)";
        ln.style.strokeDashoffset = "0";
        svg.dataset.drawn = "true";
      });
    });
    // Drop the dash once drawn: a longer line later (a new snapshot) would otherwise end in the dash gap.
    const settle = () => {
      ln.style.strokeDasharray = "";
      ln.style.strokeDashoffset = "";
      ln.style.transition = "";
    };
    ln.addEventListener("transitionend", settle, { once: true });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      ln.removeEventListener("transitionend", settle);
    };
  }, [draw, start]);

  return (
    <svg ref={ref} className="studio-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <defs>
        <linearGradient id="studio-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path className="studio-spark-ar" d={area} fill="url(#studio-spark-fill)" />
      <path className="studio-spark-ln" d={line} />
      <circle className="studio-spark-dot" cx={end[0]} cy={end[1]} r={4} />
    </svg>
  );
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
        {withNum(t("social.studio.growthDelta"), signed(n))}
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
          {trail.length > 1 && <Sparkline points={trail} animate={first} start={seen} />}
          <p className="text-ink-2 mt-2.5 flex items-center gap-1.5 text-[13px]">
            {best && best.followers > 0 ? (
              <>
                <Trophy size={15} strokeWidth={1.75} className="text-warn shrink-0" aria-hidden />
                <span>
                  {withNum(
                    t("social.studio.growthBest", {
                      platform: L(PLATFORM_META[best.platform].name),
                    }),
                    signed(best.followers),
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
