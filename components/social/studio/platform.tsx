"use client";

import type { CSSProperties } from "react";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";

/** `--c` set to the platform's brand color, for chips, dots and hero accents. */
export function platformStyle(platform: Platform): CSSProperties {
  return { "--c": PLATFORM_META[platform].color } as CSSProperties;
}

/** Icon + localized platform name as a small chip tinted with the brand color. */
export function PlatformChip({
  platform,
  className = "",
  testId,
}: {
  platform: Platform;
  className?: string;
  testId?: string;
}) {
  const { L } = useT();
  const meta = PLATFORM_META[platform];
  return (
    <span
      className={`studio-pchip ${className}`}
      style={platformStyle(platform)}
      data-platform={platform}
      data-testid={testId}
    >
      <span aria-hidden>{meta.icon}</span>
      <span>{L(meta.name)}</span>
    </span>
  );
}

/** A coloured dot with the platform's short label (TT, IG …), for day cells. */
export function PlatformDot({ platform, title }: { platform: Platform; title?: string }) {
  return (
    <span
      className="studio-pdot num"
      style={platformStyle(platform)}
      title={title}
      aria-label={title}
      data-platform={platform}
    >
      {PLATFORM_META[platform].short}
    </span>
  );
}

/**
 * Five platform buttons in a row. `idPrefix` builds each button's test id (`${idPrefix}-${platform}`).
 * Used wherever the owner picks where a post goes: ideas → post, skill → video, the skill sheet's bridge.
 */
export function PlatformPicker({
  idPrefix,
  onPick,
  onCancel,
  label,
  cancelLabel,
}: {
  idPrefix: string;
  onPick: (platform: Platform) => void;
  onCancel?: () => void;
  label: string;
  cancelLabel?: string;
}) {
  const { L } = useT();
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-muted text-xs">{label}</span>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => {
          const meta = PLATFORM_META[p];
          return (
            <button
              key={p}
              type="button"
              className="studio-pbtn"
              style={platformStyle(p)}
              onClick={() => onPick(p)}
              data-testid={`${idPrefix}-${p}`}
              data-platform={p}
            >
              <span aria-hidden>{meta.icon}</span>
              <span>{L(meta.name)}</span>
            </button>
          );
        })}
        {onCancel && cancelLabel && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={onCancel}
            data-testid={`${idPrefix}-cancel`}
          >
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** "1.2K" / "108.7K" / "1.2M" with Latin digits; below 1000 as is. */
export function fmtCount(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}K`;
  return `${sign}${abs}`;
}

const trim = (x: number): string =>
  x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, "");

/** Link into the calendar agent's screen, opening one post. */
export function calendarPostHref(postId: string): string {
  return `/social/calendar/#post=${postId}`;
}
