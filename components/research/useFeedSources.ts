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
import { discoverEvidence } from "@/lib/discoverRanking";
import {
  applyYoutubeEvidence,
  fetchYoutubeEvidence,
  type YoutubeSources,
} from "@/lib/youtubeEvidence";

const EMPTY_SOURCES: FormatSources = {};
const EMPTY_TIKTOK: Record<string, TikTokSource | null> = {};
const urlOf = (item: DiscoverItem) => canonicalRefUrl(item.platform, item.url);

/** Two public reads at a time, eighteen per platform. A new candidate set prioritizes unread sources. */
export function useFeedSources(items: DiscoverItem[], active: boolean, youtubeKey = "") {
  const attempted = useRef(new Map<string, number>());
  // Membership is the trigger. A corrected count must not abort/reorder its own source queue.
  const scope = JSON.stringify(
    active ? [...new Set(items.filter((item) => item.platform !== "yt").map(urlOf))].sort() : [],
  );
  const youtubeScope = JSON.stringify(
    active && youtubeKey
      ? [...new Set(items.filter((item) => item.platform === "yt").map(urlOf))].sort()
      : [],
  );
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
    sources: FormatSources;
    tiktok: Record<string, TikTokSource | null>;
    pending: boolean;
  }>({ scope: "", sources: {}, tiktok: {}, pending: false });
  useEffect(() => {
    const controller = new AbortController();
    const sources: FormatSources = {};
    const tiktok: Record<string, TikTokSource | null> = {};
    const priorities = new Map(items.map((item) => [urlOf(item), discoverEvidence(item).score]));
    const platforms = active
      ? ["ig", "tt"].map((platform) =>
          [
            ...new Map(
              items.filter((item) => item.platform === platform).map((item) => [urlOf(item), item]),
            ).values(),
          ]
            .sort(
              (a, b) =>
                (Date.parse(a.evidence?.observedAt ?? "") || attempted.current.get(urlOf(a)) || 0) -
                  (Date.parse(b.evidence?.observedAt ?? "") ||
                    attempted.current.get(urlOf(b)) ||
                    0) ||
                (priorities.get(urlOf(b)) ?? 0) - (priorities.get(urlOf(a)) ?? 0) ||
                urlOf(a).localeCompare(urlOf(b)),
            )
            .slice(0, 18)
            .map(urlOf),
        )
      : [];
    // Both platforms get a first result promptly even when one has eighteen slow public pages.
    const queue = Array.from({ length: 18 }, (_, index) =>
      platforms.flatMap((posts) => (posts[index] ? [posts[index]] : [])),
    ).flat();
    let cursor = 0;
    let settled = 0;
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
        setResult({
          scope,
          sources: { ...sources },
          tiktok: { ...tiktok },
          pending: settled < queue.length,
        });
      }
    };
    void Promise.all([next(), next()]);
    return () => controller.abort();
    // Deliberately capture the newest item evidence only when candidate membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  const sources = result.scope === scope ? result.sources : EMPTY_SOURCES;
  const tiktok = result.scope === scope ? result.tiktok : EMPTY_TIKTOK;
  const enriched = useMemo(
    () =>
      items.map((item) =>
        item.platform === "yt"
          ? applyYoutubeEvidence(
              item,
              youtube.scope === youtubeScope && youtube.key === youtubeKey
                ? youtube.sources[urlOf(item)]
                : undefined,
            )
          : item.platform === "tt"
            ? applyTikTokEvidence(item, tiktok[urlOf(item)] ?? null)
            : applyInstagramEvidence(item, sources[sourceKey(item.url)] ?? null),
      ),
    [items, sources, tiktok, youtube, youtubeScope, youtubeKey],
  );
  return {
    items: enriched,
    checking:
      (scope !== "[]" && (result.scope !== scope || result.pending)) ||
      (youtubeScope !== "[]" && (youtube.scope !== youtubeScope || youtube.key !== youtubeKey)),
  };
}
