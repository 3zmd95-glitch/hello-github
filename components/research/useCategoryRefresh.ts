"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiscoverItem } from "@/lib/discover";
import { categoryCandidates, discoverPostKey } from "@/lib/discoverFeed";
import {
  CATEGORY_EXPANSION_ROUNDS,
  discoverSourceDiagnostics,
  expandCategory,
} from "@/lib/discoverExpansion";
import { rankDiscoverItems } from "@/lib/discoverRanking";
import type { Genre } from "@/lib/domain";
import type { ResearchTab } from "@/lib/research";
import type { ScoutConfig } from "@/lib/scoutClient";
import { acquireTikTokEdits, knownTikTokIds, type TikTokCountry } from "@/lib/tiktokAccess";
import { getApiKey, useStore } from "@/store";

export interface CategoryRefreshLane {
  platform: "tt" | "yt";
  status: "pending" | "running" | "done" | "error" | "skipped";
  returned: number;
  error?: string;
  cached?: boolean;
}
export interface CategoryRefreshOutcome {
  status: "running" | "done" | "error" | "cancelled";
  returned: number;
  added: number;
  inspiration: number;
  popular: number;
  lanes: CategoryRefreshLane[];
}
type Library = Pick<
  ReturnType<typeof useStore.getState>,
  "discoverCandidates" | "discoverFeedback"
>;
// TikTok handles may change; the native acquisition contract identifies posts by numeric ID.
function postId(item: DiscoverItem): string | null {
  const url = discoverPostKey(item.platform, item.url);
  return url && (item.platform === "tt" ? `tt:${url.split("/").at(-1)}` : url);
}
function snapshot(state: Library, genreId: string) {
  const candidates = state.discoverCandidates.filter((entry) => entry.genreId === genreId);
  const items = candidates.map((entry) => entry.item);
  const visual = Object.fromEntries(
    candidates.map((entry) => [discoverPostKey(entry.item.platform, entry.item.url)!, entry]),
  );
  // Positive personal interest can display an otherwise unqualified post. It is not acquisition success.
  const feedback = state.discoverFeedback.filter((entry) => entry.action !== "more");
  const ids = (items: DiscoverItem[]) => new Set(items.flatMap((item) => postId(item) ?? []));
  const now = Date.now();
  return {
    posts: ids(items),
    inspiration: ids(
      rankDiscoverItems(items, { genreId, mode: "inspiration", feedback, visual, now }).items,
    ),
    popular: ids(
      rankDiscoverItems(items, { genreId, mode: "popular", feedback, visual, now }).items,
    ),
  };
}
const sourceKeys = (state: ReturnType<typeof useStore.getState>) =>
  JSON.stringify([
    getApiKey(state, "youtube"),
    getApiKey(state, "scoutUrl"),
    getApiKey(state, "scoutToken"),
  ]);
type Progress = {
  scope: string;
  status: CategoryRefreshOutcome["status"];
  baseline: ReturnType<typeof snapshot>;
  returnedIds: string[];
  lanes: CategoryRefreshLane[];
};
type Supply = {
  youtube: ReadonlyMap<string, number>;
  tiktok: ReadonlyMap<string, { ids: string[]; exhausted: boolean }>;
};

/** Explicit bounded acquisition only. Source enrichment remains the existing feed's responsibility. */
export function useCategoryRefresh({
  genre,
  tab,
  country,
  active,
  config,
}: {
  genre: Genre;
  tab: ResearchTab;
  country: TikTokCountry;
  active: boolean;
  config: ScoutConfig | null;
}) {
  const candidates = useStore((state) => state.discoverCandidates);
  const feedback = useStore((state) => state.discoverFeedback);
  const epoch = useStore((state) => state.discoverLibraryEpoch);
  const loading = useStore((state) => state.discoverLibraryStatus === "loading");
  const keys = useStore(sourceKeys);
  const scope = JSON.stringify([
    active,
    genre,
    tab,
    country,
    config?.url,
    config?.token,
    epoch,
    loading,
    keys,
  ]);
  const tiktokScope = JSON.stringify([genre.id, country, config?.url, config?.token, epoch]);
  const current = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const [supply, setSupply] = useState<Supply>(() => ({ youtube: new Map(), tiktok: new Map() }));
  const supplyRef = useRef(supply);
  const updateSupply = (next: Supply) => {
    // State drives rendered limits; the same immutable snapshot fences callbacks before a render.
    supplyRef.current = next;
    setSupply(next);
  };
  const [progress, setProgress] = useState<Progress>();
  const invalidate = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
  }, []);
  useLayoutEffect(() => {
    current.current = scope;
    return () => {
      current.current = null;
      invalidate();
    };
  }, [scope, invalidate]);
  const cancel = () => {
    if (!pending.current) return;
    invalidate();
    setProgress(
      (value) =>
        value && {
          ...value,
          status: "cancelled",
          lanes: value.lanes.map((lane) =>
            lane.status === "running"
              ? { ...lane, status: "error", error: "cancelled" }
              : lane.status === "pending"
                ? { ...lane, status: "skipped" }
                : lane,
          ),
        },
    );
  };
  const seen = supply.tiktok.get(tiktokScope);
  const youtubeExhausted = (supply.youtube.get(genre.id) ?? 0) >= CATEGORY_EXPANSION_ROUNDS;
  const tiktokExhausted =
    !!seen?.exhausted ||
    new Set([...(seen?.ids ?? []), ...knownTikTokIds(categoryCandidates(candidates, genre.id))])
      .size >= 200;
  const visible = progress?.scope === scope ? progress : undefined;
  const busy = visible?.status === "running";
  const canRun =
    active &&
    !!config &&
    !loading &&
    !busy &&
    (((tab === "all" || tab === "tt") && !tiktokExhausted) ||
      ((tab === "all" || tab === "yt") && !youtubeExhausted));
  const currentSnapshot = useMemo(
    () => snapshot({ discoverCandidates: candidates, discoverFeedback: feedback }, genre.id),
    [candidates, feedback, genre.id],
  );
  const outcome: CategoryRefreshOutcome | undefined = visible && {
    status: visible.status,
    returned: visible.returnedIds.length,
    added: visible.returnedIds.filter(
      (id) => currentSnapshot.posts.has(id) && !visible.baseline.posts.has(id),
    ).length,
    inspiration: visible.returnedIds.filter(
      (id) => currentSnapshot.inspiration.has(id) && !visible.baseline.inspiration.has(id),
    ).length,
    popular: visible.returnedIds.filter(
      (id) => currentSnapshot.popular.has(id) && !visible.baseline.popular.has(id),
    ).length,
    lanes: visible.lanes,
  };
  const run = async () => {
    const state = useStore.getState();
    if (
      !canRun ||
      !config ||
      pending.current ||
      current.current !== scope ||
      state.discoverLibraryEpoch !== epoch ||
      state.discoverLibraryStatus === "loading" ||
      sourceKeys(state) !== keys
    )
      return;
    const latestSeen = supplyRef.current.tiktok.get(tiktokScope);
    const exhausted = {
      tt:
        !!latestSeen?.exhausted ||
        new Set([
          ...(latestSeen?.ids ?? []),
          ...knownTikTokIds(categoryCandidates(state.discoverCandidates, genre.id)),
        ]).size >= 200,
      yt: (supplyRef.current.youtube.get(genre.id) ?? 0) >= CATEGORY_EXPANSION_ROUNDS,
    };
    const platforms: CategoryRefreshLane["platform"][] =
      tab === "all" ? ["tt", "yt"] : tab === "tt" ? ["tt"] : ["yt"];
    if (platforms.every((platform) => exhausted[platform])) return;
    const controller = new AbortController();
    pending.current = controller;
    const isCurrent = () => {
      const state = useStore.getState();
      return (
        pending.current === controller &&
        !controller.signal.aborted &&
        current.current === scope &&
        state.discoverLibraryEpoch === epoch &&
        state.discoverLibraryStatus !== "loading" &&
        sourceKeys(state) === keys
      );
    };
    const record: Progress = {
      scope,
      status: "running",
      baseline: snapshot(state, genre.id),
      returnedIds: [],
      lanes: platforms.map((platform) => ({
        platform,
        returned: 0,
        status: exhausted[platform] ? "skipped" : "pending",
      })),
    };
    const publish = () =>
      setProgress({
        ...record,
        returnedIds: [...record.returnedIds],
        lanes: record.lanes.map((lane) => ({ ...lane })),
      });
    const accept = (items: DiscoverItem[], lane: CategoryRefreshLane) => {
      const selected = items.filter((item) => item.platform === lane.platform && !!postId(item));
      lane.returned = new Set(selected.map((item) => postId(item)!)).size;
      record.returnedIds = [
        ...new Set([...record.returnedIds, ...selected.map((item) => postId(item)!)]),
      ];
      if (!isCurrent()) return;
      useStore.getState().accumulateDiscoverCandidates(selected, { genreId: genre.id });
    };
    publish();
    try {
      for (const lane of record.lanes) {
        if (!isCurrent()) return;
        if (lane.status === "skipped") continue;
        lane.status = "running";
        publish();
        try {
          if (lane.platform === "tt") {
            const excludeVideoIds = [
              ...new Set([
                ...(supplyRef.current.tiktok.get(tiktokScope)?.ids ?? []),
                ...knownTikTokIds(
                  categoryCandidates(useStore.getState().discoverCandidates, genre.id),
                ),
              ]),
            ].slice(0, 200);
            const result = await acquireTikTokEdits(config, genre.id, {
              country,
              excludeVideoIds,
              signal: controller.signal,
            });
            if (!isCurrent()) return;
            if (!result.ok || result.value.status !== "accepted") {
              lane.status = "error";
              lane.error = result.ok ? result.value.status : result.error;
            } else {
              const ids = [
                ...new Set([...excludeVideoIds, ...knownTikTokIds(result.value.items)]),
              ].slice(0, 200);
              updateSupply({
                ...supplyRef.current,
                tiktok: new Map(supplyRef.current.tiktok).set(tiktokScope, {
                  ids,
                  exhausted: !result.value.supply?.unseenRemaining || ids.length >= 200,
                }),
              });
              lane.status = "done";
              accept(result.value.items, lane);
            }
          } else {
            // Consume only a query that actually starts; cancelling TikTok must not spend a YouTube round.
            const round = supplyRef.current.youtube.get(genre.id) ?? 0;
            updateSupply({
              ...supplyRef.current,
              youtube: new Map(supplyRef.current.youtube).set(genre.id, round + 1),
            });
            const result = await expandCategory(config, genre, {
              platform: "yt",
              round,
              signal: controller.signal,
            });
            if (!isCurrent()) return;
            if (!result.ok) {
              lane.status = "error";
              lane.error = result.error.type;
            } else {
              const diagnostic = discoverSourceDiagnostics(result.answer, ["yt"])[0];
              lane.cached = diagnostic.cached;
              lane.error = diagnostic.error;
              lane.status =
                diagnostic.state === "error" || diagnostic.state === "unknown" ? "error" : "done";
              if (diagnostic.state === "unknown") lane.error = "upstream";
              if (lane.status === "done") accept(result.answer.items, lane);
            }
          }
        } catch {
          if (!isCurrent()) return;
          lane.status = "error";
          lane.error = "network";
        }
        // A synchronous store listener can reset/import during the merge.
        if (!isCurrent()) return;
        publish();
      }
      if (!isCurrent()) return;
      record.status = record.lanes.some((lane) => lane.status === "done") ? "done" : "error";
      publish();
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
  return { run, cancel, busy, canRun, outcome, youtubeExhausted, tiktokExhausted };
}
export type CategoryRefreshQueue = ReturnType<typeof useCategoryRefresh>;
