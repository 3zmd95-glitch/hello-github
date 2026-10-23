"use client";

import { useEffect, useMemo } from "react";
import { peekDiscover, type DiscoverAnswer, type DiscoverRequest } from "@/lib/discover";
import { categoryCandidates } from "@/lib/discoverFeed";
import type { ScoutConfig } from "@/lib/scoutClient";
import { useStore } from "@/store";

/** Import a previous complete answer once on entry, never on each source correction.
 * The retained library then owns the evidence, including corrections and evictions. */
export function useCategoryEntry(
  genreId: string | undefined,
  config: ScoutConfig | null,
  request: DiscoverRequest | null,
  active: boolean,
): { skipSearch: boolean; cached: DiscoverAnswer | null; loading: boolean } {
  const libraryLoading = useStore((state) => state.discoverLibraryStatus === "loading");
  const body = request ? JSON.stringify(request) : "";
  const entry = useMemo(() => {
    if (libraryLoading || !active || !genreId || !body) return null;
    const cached = peekDiscover(config, JSON.parse(body) as DiscoverRequest);
    const stored = categoryCandidates(useStore.getState().discoverCandidates, genreId);
    return { cached, skipSearch: !!cached?.items.length || stored.length > 0 };
  }, [active, genreId, config, body, libraryLoading]);
  useEffect(() => {
    if (genreId && entry?.cached?.items.length)
      useStore.getState().accumulateDiscoverCandidates(entry.cached.items, { genreId });
  }, [entry, genreId]);
  return {
    skipSearch: libraryLoading || (entry?.skipSearch ?? false),
    cached: entry?.cached ?? null,
    loading: libraryLoading,
  };
}
