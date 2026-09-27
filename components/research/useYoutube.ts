"use client";

import { useEffect, useState } from "react";
import {
  cachedYoutubeSearch,
  youtubeSearchUrl,
  type YoutubeSearchError,
  type YoutubeSearchOpts,
  type YoutubeVideo,
} from "@/lib/research";

export type YoutubeState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ok"; items: YoutubeVideo[] }
  | { status: "error"; error: YoutubeSearchError };

type Settled =
  | { for: string; status: "ok"; items: YoutubeVideo[] }
  | { for: string; status: "error"; error: YoutubeSearchError };

/**
 * One YouTube Data API search (null key or empty query = off), through the per-session cache so switching
 * tabs and filters back and forth doesn't spend the key's daily quota twice.
 */
export function useYoutubeQuery(
  apiKey: string | undefined,
  q: string,
  opts: Omit<YoutubeSearchOpts, "fetchImpl">,
): YoutubeState {
  const query = q.trim();
  const active = !!apiKey && query.length > 0;
  const key = active ? youtubeSearchUrl(apiKey, query, opts) : "";
  const [settled, setSettled] = useState<Settled | null>(null);
  const { relevanceLanguage, maxResults, videoDuration, publishedAfter, regionCode } = opts;

  useEffect(() => {
    if (!active || !apiKey) return;
    let alive = true;
    cachedYoutubeSearch(apiKey, query, {
      relevanceLanguage,
      maxResults,
      videoDuration,
      publishedAfter,
      regionCode,
    }).then((r) => {
      if (!alive) return;
      setSettled(
        r.ok
          ? { for: key, status: "ok", items: r.items }
          : { for: key, status: "error", error: r.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [
    active,
    apiKey,
    key,
    query,
    relevanceLanguage,
    maxResults,
    videoDuration,
    publishedAfter,
    regionCode,
  ]);

  if (!active) return { status: "off" };
  if (!settled || settled.for !== key) return { status: "loading" };
  return settled.status === "ok"
    ? { status: "ok", items: settled.items }
    : { status: "error", error: settled.error };
}
