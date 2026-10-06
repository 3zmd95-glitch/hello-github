"use client";

import type { CSSProperties, ReactNode } from "react";
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

/**
 * A count split for display (and for a count-up that keeps its suffix): 1_478 → 1.5 "K", 184_230 → 184 "K",
 * 2_100_000 → 2.1 "M"; one decimal under 100 unless it is .0, whole numbers from 100 up and below 1,000.
 */
export function compactCount(n: number): { value: number; decimals: number; suffix: string } {
  const abs = Math.abs(n);
  const [unit, suffix] =
    abs >= 1_000_000 ? [1_000_000, "M"] : abs >= 1_000 ? [1_000, "K"] : [1, ""];
  const x = abs / unit;
  const value = unit === 1 || x >= 100 ? Math.round(x) : Number(x.toFixed(1));
  return { value: n < 0 ? -value : value, decimals: Number.isInteger(value) ? 0 : 1, suffix };
}

/** "1.2K" / "108.7K" / "1.2M" with Latin digits; below 1000 as is. */
export function fmtCount(n: number): string {
  const { value, decimals, suffix } = compactCount(n);
  return `${value.toFixed(decimals)}${suffix}`;
}

/**
 * A translated line that keeps its `{n}` placeholder (`t(key)` called without `n`), with `n` rendered as an
 * LTR-isolated `.num`, so a sign or a "K" stays beside its digits inside Arabic text.
 */
export function withNum(text: string, n: ReactNode): ReactNode {
  const [pre, post = ""] = text.split("{n}");
  return (
    <>
      {pre}
      <span className="num">{n}</span>
      {post}
    </>
  );
}

/** Link into the calendar agent's screen, opening one post. */
export function calendarPostHref(postId: string): string {
  return `/social/calendar/#post=${postId}`;
}
