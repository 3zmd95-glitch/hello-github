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
import { useActiveSnapshot } from "./useActiveSnapshot";

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
 * `opts.order` ("Most popular") is part of the request, so it is a search of its own; the videos come with
 * their `stats` when the statistics call answered. When it did not, the videos show without numbers, and
 * the next time the same search is asked for (a new `attempt`, or coming back to it) the cache asks for
 * the numbers alone (1 quota unit, never the search again): the videos stay up meanwhile, and the same
 * ones with their `stats` take their place once that call answers.
 */
export function useYoutubeQuery(
  requestedApiKey: string | undefined,
  requestedQuery: string,
  requestedOpts: Omit<YoutubeSearchOpts, "fetchImpl">,
  requestedAttempt = 0,
  enabled = true,
): YoutubeState {
  const selection = useActiveSnapshot(
    { apiKey: requestedApiKey, q: requestedQuery, opts: requestedOpts, attempt: requestedAttempt },
    enabled,
  );
  const { apiKey, q = "", opts = {}, attempt = 0 } = selection ?? {};
  const query = q.trim();
  const active = !!apiKey && query.length > 0;
  const key = active ? youtubeSearchUrl(apiKey, query, opts) : "";
  const [settled, setSettled] = useState<Settled | null>(null);
  const { relevanceLanguage, maxResults, videoDuration, publishedAfter, regionCode, order } = opts;

  useEffect(() => {
    if (!active || !apiKey) return;
    let alive = true;
    cachedYoutubeSearch(apiKey, query, {
      relevanceLanguage,
      maxResults,
      videoDuration,
      publishedAfter,
      regionCode,
      order,
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
    order,
  ]);

  if (!active) return OFF;
  return settled && settledFor(settled, key, attempt) ? settled : LOADING;
}
