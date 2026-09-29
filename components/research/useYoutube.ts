"use client";

import { useEffect, useState } from "react";
import {
  cachedYoutubeSearch,
  youtubeSearchUrl,
  type YoutubeSearchError,
  type YoutubeSearchOpts,
  type YoutubeVideo,
} from "@/lib/research";
import { LOADING, OFF, settledFor, type Tagged } from "./useScout";

export type YoutubeState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ok"; items: YoutubeVideo[] }
  | { status: "error"; error: YoutubeSearchError };

type Settled = Tagged<
  { status: "ok"; items: YoutubeVideo[] } | { status: "error"; error: YoutubeSearchError }
>;

/**
 * One YouTube Data API search (null key or empty query = off), through the per-session cache so switching
 * tabs and filters back and forth doesn't spend the key's daily quota twice. A new `attempt` (the panel's
 * "Search" press counter) asks again after an error. The returned state object is stable between renders.
 */
export function useYoutubeQuery(
  apiKey: string | undefined,
  q: string,
  opts: Omit<YoutubeSearchOpts, "fetchImpl">,
  attempt = 0,
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
          ? { key, attempt, status: "ok", items: r.items }
          : { key, attempt, status: "error", error: r.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [
    active,
    apiKey,
    key,
    attempt,
    query,
    relevanceLanguage,
    maxResults,
    videoDuration,
    publishedAfter,
    regionCode,
  ]);

  if (!active) return OFF;
  return settled && settledFor(settled, key, attempt) ? settled : LOADING;
}
