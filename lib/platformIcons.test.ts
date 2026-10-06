import { describe, expect, it } from "vitest";
import type { Platform } from "./domain";
import { PLATFORM_PATHS } from "./platformIcons";
import { PLATFORM_META } from "./social";

describe("platform glyphs", () => {
  it("has a path for every platform", () => {
    for (const p of Object.keys(PLATFORM_META) as Platform[]) {
      expect(PLATFORM_PATHS[p], p).toMatch(/^M/);
      expect(PLATFORM_PATHS[p].length, p).toBeGreaterThan(40);
    }
  });
});
