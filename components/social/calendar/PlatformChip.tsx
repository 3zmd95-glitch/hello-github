"use client";

import type { CSSProperties } from "react";
import type { Platform, PostStage } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";

/** Platform brand color as a CSS variable for the `.cal-*` classes. */
export function platformStyle(platform: Platform): CSSProperties {
  return { "--pc": PLATFORM_META[platform].color } as CSSProperties;
}

/** Icon + name chip in the platform's color. */
export function PlatformChip({ platform, short }: { platform: Platform; short?: boolean }) {
  const { L } = useT();
  const meta = PLATFORM_META[platform];
  return (
    <span className="px-chip cal-pchip" style={platformStyle(platform)} data-platform={platform}>
      <span aria-hidden>{meta.icon}</span>
      {short ? <span className="num">{meta.short}</span> : L(meta.name)}
    </span>
  );
}

export const STAGE_KEY: Record<PostStage, MessageKey> = {
  idea: "calendar.stage.idea",
  script: "calendar.stage.script",
  filmed: "calendar.stage.filmed",
  edited: "calendar.stage.edited",
  scheduled: "calendar.stage.scheduled",
  posted: "calendar.stage.posted",
};

/** Small stage chip: green once posted, gold when scheduled. */
export function StageChip({ stage }: { stage: PostStage }) {
  const { t } = useT();
  const tone = stage === "posted" ? "px-chip-green" : stage === "scheduled" ? "px-chip-gold" : "";
  return (
    <span className={`px-chip ${tone}`} data-stage={stage}>
      {t(STAGE_KEY[stage])}
    </span>
  );
}
