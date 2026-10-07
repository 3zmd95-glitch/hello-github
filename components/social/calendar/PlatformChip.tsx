"use client";

import type { CSSProperties } from "react";
import type { Platform, PostStage } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";

/**
 * A platform's color as a CSS variable: `--pc` for the `.cal-*` classes and the dots, `--c` for the Studio chips and
 * buttons. It is the scheme's `--pc-*` token; Training has no such tokens, so there (the skill sheet's platform picker)
 * the brand hex it always had stands in.
 */
export function platformStyle(platform: Platform, name: "--pc" | "--c" = "--pc"): CSSProperties {
  return { [name]: `var(--pc-${platform}, ${PLATFORM_META[platform].color})` } as CSSProperties;
}

/** Brand glyph + name chip in the platform's color. */
export function PlatformChip({ platform, short }: { platform: Platform; short?: boolean }) {
  const { L } = useT();
  const meta = PLATFORM_META[platform];
  return (
    <span className="px-chip cal-pchip" style={platformStyle(platform)} data-platform={platform}>
      <PlatformGlyph platform={platform} size={13} className="shrink-0" />
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
