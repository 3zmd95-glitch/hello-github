"use client";

import { useEffect, useState } from "react";
import { DISCOVER_GENRE_PARAM, genreById, genreIdFromSearch } from "@/lib/genres";
import { useStore } from "@/store";

/**
 * Take parameters off the address bar without a navigation (the export is static: no router push), keeping any
 * other parameter and the hash. `null` as the state is the way the Next.js guide describes: the router copies its
 * own entry state over and learns the new address, so it never writes the old one back.
 */
function dropParams(...names: string[]): void {
  const params = new URLSearchParams(window.location.search);
  for (const name of names) params.delete(name);
  const q = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`,
  );
}

/**
 * Discover's deep link, `/discover/?genre=<id>` (lib/genres' discoverGenreHref; the Trend Radar's genre chips
 * link here). The address bar is read once, after mount and in an effect: the page is a static export (no
 * `useSearchParams` without a Suspense boundary), and nothing reads `window` while rendering. A genre the
 * app knows (built in, or one the owner added: the store is loaded before any page mounts) comes back as its
 * id, for the research panel to open on; an id it does not know is ignored. Either way the parameter leaves
 * the address bar, so a reload does not force the genre again. Null until then, and when the address names
 * no genre.
 */
export function useGenreLink(): string | null {
  const [genreId, setGenreId] = useState<string | null>(null);

  useEffect(() => {
    const apply = () => {
      if (!new URLSearchParams(window.location.search).has(DISCOVER_GENRE_PARAM)) return;
      const id = genreIdFromSearch(window.location.search);
      dropParams(DISCOVER_GENRE_PARAM);
      if (id && genreById(id, useStore.getState().customGenres)) setGenreId(id);
    };
    apply();
    // A tap on an in-app link (the radar's chip, a client navigation) has written the new address before
    // this page's effects run; one more look once the navigation has settled costs nothing, in case a
    // router ever commits the page first. The parameter is gone after the first read, so it goes on once.
    const settle = setTimeout(apply, 0);
    return () => clearTimeout(settle);
  }, []);

  return genreId;
}

/**
 * Back from TikTok for Business (planning/tools/19-category-trends.md §6): the Worker's `/oauth/tiktokads/callback`
 * sends the owner to the page he tapped "Connect TikTok trends" on, with `?tiktokads=connected` or
 * `?tiktokads_error=<reason>`. Read once, on the first render (AppShell renders pages on the client only, so the
 * address is there), and taken off the address bar after mount like the genre link, so a reload says nothing again:
 * "connected", "failed", or null.
 */
export function useTikTokReturn(): "connected" | "failed" | null {
  const [state] = useState<"connected" | "failed" | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tiktokads") === "connected") return "connected";
    return params.has("tiktokads") || params.has("tiktokads_error") ? "failed" : null;
  });

  useEffect(() => {
    if (state) dropParams("tiktokads", "tiktokads_error");
  }, [state]);

  return state;
}
