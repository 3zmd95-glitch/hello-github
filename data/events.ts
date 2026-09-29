import { z } from "zod";
import events from "@/planning/data/saudi-events.json";
import { SaudiEventSchema, type SaudiEvent } from "@/lib/domain";

/**
 * 📈 Saudi moments calendar (round 30, planning/tools/08-trends.md): the national days, religious dates, seasons
 * and sports events the radar's "upcoming moments" rail shows, loaded straight from planning/data/saudi-events.json
 * (no free machine-readable Saudi social calendar exists). The JSON stays the single source; this file only
 * validates it. Hijri and organiser-dependent dates carry `approx: true` and are re-checked yearly.
 */

/** Every event in the JSON, validated (defaults filled), in file order (by date). */
export const SAUDI_EVENTS: SaudiEvent[] = z.array(SaudiEventSchema).parse(events);

export function getSaudiEvent(id: string): SaudiEvent | undefined {
  return SAUDI_EVENTS.find((e) => e.id === id);
}
