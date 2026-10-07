"use client";

import type { ReactNode } from "react";
import { useWorld } from "@/components/shell/useWorld";
import { platformStyle } from "@/components/social/calendar/PlatformChip";
import { PLATFORMS, type Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";

/**
 * Five platform buttons in a row. `idPrefix` builds each button's test id (`${idPrefix}-${platform}`).
 * Used wherever the owner picks where a post goes: ideas → post, skill → video, the skill sheet's bridge.
 * Social draws the brand glyph; the Training skill sheet keeps the platform emoji.
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
  const social = useWorld() === "social";
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
              style={platformStyle(p, "--c")}
              onClick={() => onPick(p)}
              data-testid={`${idPrefix}-${p}`}
              data-platform={p}
            >
              {social ? (
                <PlatformGlyph platform={p} size={14} className="shrink-0" />
              ) : (
                <span aria-hidden>{meta.icon}</span>
              )}
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

/**
 * A translated line with the post title in a `<bdi>` (`t` keeps a `{name}` placeholder it was not given): the
 * owner's own text keeps its direction, so a mixed Arabic/English title cannot reorder the sentence around it.
 */
export function withName(text: string, name: string | undefined): ReactNode {
  if (name === undefined) return text;
  const [pre, post = ""] = text.split("{name}");
  return (
    <>
      {pre}
      <bdi>{name}</bdi>
      {post}
    </>
  );
}

/** Link into the calendar agent's screen, opening one post. */
export function calendarPostHref(postId: string): string {
  return `/social/calendar/#post=${postId}`;
}
