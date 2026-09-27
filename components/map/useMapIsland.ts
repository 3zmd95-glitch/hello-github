"use client";

import { useCallback, useEffect, useState } from "react";
import { getProgram } from "@/data";
import { islandHash, mapIslandHref, parseIslandHash } from "@/lib/mapLayout";

export { mapIslandHref };

export interface MapIslandApi {
  /** Program id of the open island, or null for the world map. */
  islandId: string | null;
  /** Open an island (unknown ids fall back to the world). Updates `#island=<id>` with replaceState. */
  open(programId: string): void;
  /** Back to the world map (clears the hash). */
  close(): void;
}

function readHash(): string | null {
  if (typeof window === "undefined") return null;
  const id = parseIslandHash(window.location.hash);
  return id && getProgram(id) ? id : null;
}

function writeHash(programId: string | null): void {
  if (typeof window === "undefined") return;
  const hash = islandHash(programId);
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  // No router push: the export is static and the map view is page-local. replaceState keeps history clean.
  window.history.replaceState(window.history.state, "", url);
}

/**
 * Page-local island view state, mirrored into the URL hash so `/map/#island=davinci` deep-links straight into an
 * island. Other screens link here with `mapIslandHref(programId)`.
 */
export function useMapIsland(): MapIslandApi {
  const [islandId, setIslandId] = useState<string | null>(readHash);

  useEffect(() => {
    // Manual hash edits and back/forward across pages keep the view in sync.
    const onHash = () => setIslandId(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = useCallback((programId: string) => {
    const id = getProgram(programId) ? programId : null;
    setIslandId(id);
    writeHash(id);
  }, []);

  const close = useCallback(() => {
    setIslandId(null);
    writeHash(null);
  }, []);

  return { islandId, open, close };
}
