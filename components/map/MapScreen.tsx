"use client";

import { useEffect, useMemo, useRef } from "react";
import { getProgram } from "@/data";
import { doneQuestsBySkill } from "@/lib/planner";
import { useStore } from "@/store";
import IslandMap from "./IslandMap";
import { useMapIsland } from "./useMapIsland";
import WorldMap from "./WorldMap";

/**
 * Map: the world (6 pillar continents with program islands) or one island's region map.
 * The open island is page-local state mirrored in `#island=<id>` (see useMapIsland).
 */
export default function MapScreen() {
  const { islandId, open, close } = useMapIsland();
  const completions = useStore((s) => s.completions);
  const done = useMemo(() => doneQuestsBySkill(completions), [completions]);
  const program = islandId ? getProgram(islandId) : undefined;

  // Scroll to the top when switching views (but not on the first paint of a deep link).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [islandId]);

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="map-screen"
      data-view={program ? "island" : "world"}
    >
      {program ? (
        <IslandMap program={program} done={done} onBack={close} />
      ) : (
        <WorldMap done={done} onOpen={open} />
      )}
    </div>
  );
}
