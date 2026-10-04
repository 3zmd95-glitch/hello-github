import { describe, expect, it } from "vitest";
import { GENRES } from "./genres";
import { discoverPrompts } from "./discoverPrompts";

describe("Discover prompt coverage", () => {
  it("offers bilingual, distinct prompts for all 12 genres within the search length limit", () => {
    const seen = new Set<string>();
    for (const genre of GENRES) {
      const prompts = discoverPrompts(genre.id);
      expect(prompts.length).toBeGreaterThanOrEqual(2);
      for (const p of prompts) {
        expect(p.ar).toMatch(/[ء-ي]/);
        expect(p.en.length).toBeLessThanOrEqual(200);
        expect(p.ar.length).toBeLessThanOrEqual(200);
        expect(seen.has(p.en)).toBe(false);
        seen.add(p.en);
      }
    }
    expect(discoverPrompts("custom-new")).toEqual([]);
    expect(discoverPrompts()).toHaveLength(2);
  });
});
