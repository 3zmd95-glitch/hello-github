"use client";

import type { CSSProperties } from "react";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";

export type GrowthTab = "all" | Platform;

/** All · TikTok · Instagram · YouTube · X · Snapchat, each in its brand color when active. */
export default function PlatformTabs({
  value,
  onChange,
}: {
  value: GrowthTab;
  onChange: (tab: GrowthTab) => void;
}) {
  const { t, L } = useT();
  return (
    <div
      className="gr-tabs"
      role="group"
      aria-label={t("growth.tabs.aria")}
      data-testid="growth-tabs"
    >
      <button
        type="button"
        className="gr-tab"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        data-testid="growth-tab-all"
        style={{ "--c": "var(--accent)" } as CSSProperties}
      >
        <span aria-hidden>📊</span> {t("growth.tabs.all")}
      </button>
      {PLATFORMS.map((p) => (
        <button
          key={p}
          type="button"
          className="gr-tab"
          aria-pressed={value === p}
          onClick={() => onChange(p)}
          data-testid={`growth-tab-${p}`}
          style={{ "--c": PLATFORM_META[p].color } as CSSProperties}
        >
          <span aria-hidden>{PLATFORM_META[p].icon}</span> {L(PLATFORM_META[p].name)}
        </button>
      ))}
    </div>
  );
}
