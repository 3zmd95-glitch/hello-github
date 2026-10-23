"use client";

import { Clock } from "lucide-react";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { bestTime, PLATFORM_META } from "@/lib/social";
import type { TimeSuggestion } from "./useTimeSuggester";

/**
 * A5: up to three tappable times for a post (the first is the best one), and one line saying where they come
 * from: "when your N posts did best" or the usual times with how many posts are still missing.
 */
export default function TimeChips({
  platform,
  suggestion,
  value,
  onPick,
  day,
  className = "",
}: {
  className?: string;
  /** The post's planned day: with a day and no time picked, the publisher uses the usual time, and this says so. */
  day?: string | null;
  platform: Platform;
  suggestion: TimeSuggestion;
  /** The time now in the field ("HH:MM" or ""): the matching chip shows as pressed. */
  value: string;
  onPick: (time: string, index: number) => void;
}) {
  const { t, L } = useT();
  return (
    <div
      className={`flex flex-col gap-1.5 ${className}`}
      data-testid="post-best-time"
      data-learned={suggestion.learned}
    >
      <span className="text-ink-2 inline-flex items-center gap-1 text-[13px] font-semibold">
        <Clock size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
        {t("calendar.form.bestTimes")}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {suggestion.times.map((time, i) => (
          <button
            key={time}
            type="button"
            className="px-fchip num"
            dir="ltr"
            aria-pressed={value === time}
            onClick={() => onPick(time, i)}
            data-testid="post-time-chip"
            data-time={time}
          >
            {time}
          </button>
        ))}
      </div>
      {day && !value && (
        // The same static time the publisher falls back to (`scheduledAtOf`), not the learned one above.
        <span className="text-warn text-xs" data-testid="post-no-time-note">
          {t("calendar.form.noTime", { time: bestTime(platform, day) })}
        </span>
      )}
      <span className="text-muted text-xs" data-testid="post-best-source">
        {suggestion.learned
          ? t("calendar.form.bestLearned", {
              n: suggestion.posts,
              platform: L(PLATFORM_META[platform].name),
            })
          : t("calendar.form.bestUsual", { n: suggestion.posts, needed: suggestion.needed })}
      </span>
    </div>
  );
}
