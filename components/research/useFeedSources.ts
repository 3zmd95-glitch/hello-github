"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DiscoverItem } from "@/lib/discover";
import {
  applyInstagramEvidence,
  applyTikTokEvidence,
  localTikTokSource,
} from "@/lib/discoverSources";
import { localInstagramSource, sourceKey, type FormatSources } from "@/lib/formatSources";
import type { TikTokSource } from "@/workers/scout/src/tiktokSource";
import { canonicalRefUrl } from "@/lib/research";
import {
  applyYoutubeEvidence,
  fetchYoutubeEvidence,
  type YoutubeSources,
} from "@/lib/youtubeEvidence";

const EMPTY_SOURCES: FormatSources = {};
const EMPTY_TIKTOK: Record<string, TikTokSource | null> = {};
const urlOf = (item: DiscoverItem) => canonicalRefUrl(item.platform, item.url);

export interface FeedSourceSelection {
  /** A user/result selection, never a key derived from enriched evidence. */
  selectionKey: string;
  visibleUrls: readonly string[];
}

/** Two public reads at a time in eighteen/platform batches. A frozen visible selection drains
 * only that finite set; legacy callers still request one batch per action. */
export function useFeedSources(
  items: DiscoverItem[],
  active: boolean,
  youtubeKey = "",
  selection?: FeedSourceSelection,
) {
  const attempted = useRef(new Map<string, number>());
  // Corrected counts must not abort/reorder their own source queue.
  const scope = JSON.stringify(
    active ? [...new Set(items.filter((item) => item.platform !== "yt").map(urlOf))].sort() : [],
  );
  const youtubeScope = JSON.stringify(
    active && youtubeKey
      ? [...new Set(items.filter((item) => item.platform === "yt").map(urlOf))].sort()
      : [],
  );
  const selectionScope = selection
    ? JSON.stringify([selection.selectionKey, selection.visibleUrls])
    : "legacy";
  const runScope = JSON.stringify([scope, selectionScope]);
  const [youtube, setYoutube] = useState<{ scope: string; key: string; sources: YoutubeSources }>({
    scope: "",
    key: "",
    sources: {},
  });
  useEffect(() => {
    if (youtubeScope === "[]") return;
    const controller = new AbortController();
    void fetchYoutubeEvidence(items, youtubeKey, { signal: controller.signal }).then((sources) => {
      if (!controller.signal.aborted) setYoutube({ scope: youtubeScope, key: youtubeKey, sources });
    });
    return () => controller.abort();
    // Counts and captions returned by this batch must not restart their own read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeScope, youtubeKey]);
  const [result, setResult] = useState<{
    scope: string;
    runScope: string;
    sources: FormatSources;
    tiktok: Record<string, TikTokSource | null>;
    pending: boolean;
  }>({ scope: "", runScope: "", sources: {}, tiktok: {}, pending: false });
  const [batch, setBatch] = useState(0);
  const currentRun = useRef<{
    scope: string;
    busy: boolean;
    cancelled: boolean;
    sources: FormatSources;
    tiktok: Record<string, TikTokSource | null>;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const previous = currentRun.current;
    // Completed attempts (including nulls) carry over as-is for canonical URLs still in the membership.
    const members = new Set<string>(JSON.parse(scope));
    const keep = <T>(map: Record<string, T> = {}) =>
      Object.fromEntries(Object.entries(map).filter(([url]) => members.has(url)));
    const sources: FormatSources = keep(previous?.sources);
    const tiktok: Record<string, TikTokSource | null> = keep(previous?.tiktok);
    const run = { scope, busy: false, cancelled: false, sources, tiktok };
    currentRun.current = run;
    const requested = selection ? new Set(selection.visibleUrls) : members;
    const platforms = active
      ? ["ig", "tt"].map((platform) =>
          [
            ...new Map(
              items.filter((item) => item.platform === platform).map((item) => [urlOf(item), item]),
            ).values(),
          ]
            .filter(
              (item) =>
                requested.has(urlOf(item)) && !(urlOf(item) in sources) && !(urlOf(item) in tiktok),
            )
            // Unread first, then oldest observation/attempt. Equal ages keep display order (Map keys keep
            // first-seen order and the sort is stable): the cards the user sees first are read first.
            .sort(
              (a, b) =>
                (Date.parse(a.evidence?.observedAt ?? "") || attempted.current.get(urlOf(a)) || 0) -
                (Date.parse(b.evidence?.observedAt ?? "") || attempted.current.get(urlOf(b)) || 0),
            )
            .slice(0, selection ? undefined : 18)
            .map(urlOf),
        )
      : [];
    // Interleave platforms within each bounded batch, then finish only the requested visible set.
    const batches = Array.from(
      { length: Math.ceil(Math.max(0, ...platforms.map((posts) => posts.length)) / 18) },
      (_, batchIndex) =>
        Array.from({ length: 18 }, (_, index) =>
          platforms.flatMap((posts) => {
            const url = posts[batchIndex * 18 + index];
            return url ? [url] : [];
          }),
        ).flat(),
    );
    const total = batches.reduce((sum, queue) => sum + queue.length, 0);
    run.busy = total > 0;
    // Publish retained evidence now so a grown membership never flashes empty maps.
    setResult({
      scope,
      runScope,
      sources: { ...sources },
      tiktok: { ...tiktok },
      pending: run.busy,
    });
    let settled = 0;
    const drain = async () => {
      for (const queue of batches) {
        let cursor = 0;
        const next = async () => {
          while (cursor < queue.length && !controller.signal.aborted) {
            const url = queue[cursor++];
            if (attempted.current.size >= 500)
              attempted.current.delete(attempted.current.keys().next().value!);
            attempted.current.set(url, Date.now());
            if (new URL(url).hostname.endsWith("tiktok.com"))
              tiktok[url] = await localTikTokSource(url, controller.signal);
            else sources[url] = await localInstagramSource(url, controller.signal);
            if (controller.signal.aborted) return;
            settled++;
            run.busy = settled < total;
            setResult({
              scope,
              runScope,
              sources: { ...sources },
              tiktok: { ...tiktok },
              pending: run.busy,
            });
          }
        };
        await Promise.all([next(), next()]);
        if (controller.signal.aborted) return;
      }
    };
    void drain();
    return () => {
      run.cancelled = true;
      controller.abort();
    };
    // Capture current evidence on a membership change or an explicit continuation, never a source rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runScope, batch]);
  const sources = result.scope === scope ? result.sources : EMPTY_SOURCES;
  const tiktok = result.scope === scope ? result.tiktok : EMPTY_TIKTOK;
  const enriched = useMemo(
    () =>
      items.map((item) =>
        item.platform === "yt"
          ? applyYoutubeEvidence(
              item,
              // Same key: overlapping URLs keep their last evidence while a grown batch is in flight.
              youtubeScope !== "[]" && youtube.key === youtubeKey
                ? youtube.sources[urlOf(item)]
                : undefined,
            )
          : item.platform === "tt"
            ? applyTikTokEvidence(item, tiktok[urlOf(item)] ?? null)
            : applyInstagramEvidence(item, sources[sourceKey(item.url)] ?? null),
      ),
    [items, sources, tiktok, youtube, youtubeScope, youtubeKey],
  );
  const checking =
    (scope !== "[]" && (result.runScope !== runScope || result.pending)) ||
    (youtubeScope !== "[]" && (youtube.scope !== youtubeScope || youtube.key !== youtubeKey));
  const remaining = active
    ? [...new Set(items.filter((item) => item.platform !== "yt").map(urlOf))]
        .filter((url) => !selection || selection.visibleUrls.includes(url))
        .filter((url) => !(url in sources) && !(url in tiktok)).length
    : 0;
  const checkRemaining = () => {
    const run = currentRun.current;
    if (
      !active ||
      !!selection ||
      checking ||
      run?.scope !== scope ||
      run.busy ||
      run.cancelled ||
      !items.some(
        (item) =>
          item.platform !== "yt" && !(urlOf(item) in run.sources) && !(urlOf(item) in run.tiktok),
      )
    )
      return;
    // Lock synchronously: repeated clicks before React renders still request only one batch.
    run.busy = true;
    setResult((current) => ({ ...current, pending: true }));
    setBatch((current) => current + 1);
  };
  return { items: enriched, checking, remaining, checkRemaining };
}
