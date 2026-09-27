"use client";

import { formatDayShort } from "@/components/planner/weekLabel";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { snapshotSource, timeAgo } from "@/lib/socialSync";
import { useStore } from "@/store";

/**
 * Where a platform's latest numbers came from: live from the connected account (with the last sync time),
 * the seeded Beacons row, a manual / CSV row, or nothing yet. `data-source` carries the value for tests.
 */
export default function SourceBadge({
  platform,
  latestDay,
  className = "",
}: {
  platform: Platform;
  /** Day key of the platform's latest snapshot, if any. */
  latestDay: string | null | undefined;
  className?: string;
}) {
  const { t, lang } = useT();
  const status = useStore((s) => s.socialSync.status?.[platform]);
  const source = snapshotSource(platform, latestDay, status);
  const day = latestDay ? formatDayShort(latestDay, lang) : "";
  const text =
    source === "live"
      ? t("growth.source.live", { ago: status?.lastSyncAt ? timeAgo(status.lastSyncAt, lang) : "" })
      : source === "beacons"
        ? t("growth.source.beacons", { day })
        : source === "manual"
          ? t("growth.source.manual", { day })
          : t("growth.source.none");
  return (
    <span
      className={`src-badge ${className}`}
      data-testid="source-badge"
      data-source={source}
      data-platform={platform}
    >
      {text}
    </span>
  );
}
