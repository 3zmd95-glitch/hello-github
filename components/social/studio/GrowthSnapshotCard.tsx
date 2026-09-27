"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PLATFORMS } from "@/lib/domain";
import { bestPlatform, snapshotDelta, totals } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";
import { fmtCount } from "./platform";

/** Sum of the platforms' 30-day deltas; null when no platform has a baseline yet. */
function sumDelta(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

function Delta({ n }: { n: number | null }) {
  const { t } = useT();
  if (n === null) return null;
  const down = n < 0;
  return (
    <span className={`text-xs ${down ? "text-danger" : "text-accent"}`}>
      {t(down ? "social.studio.growthDeltaDown" : "social.studio.growthDelta", {
        n: fmtCount(Math.abs(n)),
      })}
    </span>
  );
}

/** Followers + 30-day views across every platform with numbers, their 30-day deltas and the best platform. */
export default function GrowthSnapshotCard() {
  const { t, L } = useT();
  const snapshots = useStore((s) => s.socialSnapshots);
  const sums = useMemo(() => totals(snapshots), [snapshots]);
  const deltas = useMemo(() => PLATFORMS.map((p) => snapshotDelta(snapshots, p)), [snapshots]);
  const best = useMemo(() => bestPlatform(snapshots), [snapshots]);
  const followersDelta = sumDelta(deltas.map((d) => d.followers));
  const viewsDelta = sumDelta(deltas.map((d) => d.views));
  const empty = sums.platforms.length === 0;

  return (
    <section className="px-card flex flex-col gap-3" data-testid="studio-growth" data-empty={empty}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base">{t("social.studio.growth")}</h2>
        {!empty && (
          <Link
            href="/social/growth/"
            className="px-link text-xs no-underline"
            data-testid="studio-growth-open"
          >
            {t("social.studio.growthOpen")}
          </Link>
        )}
      </header>

      {empty ? (
        <div className="flex flex-col items-start gap-2" data-testid="studio-growth-empty">
          <p className="text-ink-2 text-sm">{t("social.studio.growthEmpty")}</p>
          <Link
            href="/social/growth/"
            className="px-btn px-btn-ghost px-btn-sm no-underline"
            data-testid="studio-growth-add"
          >
            {t("social.studio.growthAdd")}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="px-inset flex flex-col gap-0.5">
              <span className="text-muted text-xs">{t("social.studio.growthFollowers")}</span>
              <b className="num text-xl" data-testid="studio-growth-followers">
                {fmtCount(sums.followers)}
              </b>
              <Delta n={followersDelta} />
            </div>
            <div className="px-inset flex flex-col gap-0.5">
              <span className="text-muted text-xs">{t("social.studio.growthViews")}</span>
              <b className="num text-xl" data-testid="studio-growth-views">
                {fmtCount(sums.views30d)}
              </b>
              <Delta n={viewsDelta} />
            </div>
          </div>
          <p className="text-ink-2 text-xs">
            {best
              ? t("social.studio.growthBest", {
                  platform: L(PLATFORM_META[best.platform].name),
                  n: fmtCount(best.followers),
                })
              : t("social.studio.growthPlatforms", { n: sums.platforms.length })}
          </p>
        </>
      )}
    </section>
  );
}
