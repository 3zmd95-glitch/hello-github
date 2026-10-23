"use client";

import { useCallback } from "react";
import { useToday } from "@/components/today/useToday";
import { learnBestTimes, timesForDay } from "@/lib/bestTimes";
import type { Platform } from "@/lib/domain";
import { useStore } from "@/store";

export interface TimeSuggestion {
  /** Up to 3 "HH:MM", best first. */
  times: string[];
  /** From the owner's own posts (true) or the usual times (false). */
  learned: boolean;
  /** Settled posts the platform has, and how many it needs to learn from them. */
  posts: number;
  needed: number;
}

/**
 * A5: the times to offer for a post on a platform and day (`suggest(platform, day)`), learned from the stored post
 * numbers and refreshed when they change or the Riyadh day rolls over. No cache: one pass over at most a few
 * hundred posts, cheaper than the render it is part of.
 */
export function useTimeSuggester(): (platform: Platform, day?: string | null) => TimeSuggestion {
  const stats = useStore((s) => s.socialPostStats);
  const today = useToday();
  return useCallback(
    (platform, day) => {
      // End of the Riyadh day: the 72-hour and 180-day windows then stay put all day.
      const learned = learnBestTimes(stats, platform, Date.parse(`${today}T23:59:59+03:00`));
      return {
        ...timesForDay(learned, day || undefined),
        posts: learned.posts,
        needed: learned.needed,
      };
    },
    [stats, today],
  );
}
