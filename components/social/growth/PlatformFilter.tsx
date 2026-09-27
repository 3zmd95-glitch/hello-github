"use client";

import type { CSSProperties } from "react";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";

export type AnalyticsFilter = "all" | Platform;

/** Platforms without a free API: still selectable, but shown greyed with a "manual only" note. */
export const MANUAL_ONLY: readonly Platform[] = ["x", "snapchat"];

/** All · TikTok · Instagram · YouTube · Threads · X · Snapchat: the filter that drives the whole page. */
export default function PlatformFilter({
  value,
  onChange,
}: {
  value: AnalyticsFilter;
  onChange: (next: AnalyticsFilter) => void;
}) {
  const { t, L } = useT();
  return (
    <div
      className="gr-tabs"
      role="group"
      aria-label={t("growth.filter.aria")}
      data-testid="analytics-platform"
      data-value={value}
    >
      <button
        type="button"
        className="gr-tab"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        data-testid="analytics-platform-all"
        style={{ "--c": "var(--accent)" } as CSSProperties}
      >
        <span aria-hidden>📊</span> {t("growth.filter.all")}
      </button>
      {PLATFORMS.map((p) => {
        const manual = MANUAL_ONLY.includes(p);
        return (
          <button
            key={p}
            type="button"
            className={`gr-tab ${manual ? "gr-tab-manual" : ""}`}
            aria-pressed={value === p}
            onClick={() => onChange(p)}
            title={manual ? t("growth.filter.manual") : undefined}
            data-testid={`analytics-platform-${p}`}
            data-manual={manual || undefined}
            style={{ "--c": PLATFORM_META[p].color } as CSSProperties}
          >
            <span aria-hidden>{PLATFORM_META[p].icon}</span> {L(PLATFORM_META[p].name)}
            {manual && <span className="gr-tab-note">{t("growth.filter.manual")}</span>}
          </button>
        );
      })}
    </div>
  );
}
