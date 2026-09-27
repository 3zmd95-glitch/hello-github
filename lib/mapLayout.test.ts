import { describe, expect, it } from "vitest";
import { programs } from "@/data";
import {
  HOME_MAX,
  HOME_MIN,
  ISLAND_MAX,
  ISLAND_MIN,
  ISLAND_THEMES,
  KIND_THEMES,
  islandGlows,
  islandHash,
  islandSize,
  mapIslandHref,
  nodeFill,
  parseIslandHash,
  regionDone,
  regionPct,
  themeFor,
} from "./mapLayout";

describe("islandSize", () => {
  it("starts at the minimum for an empty level-1 island", () => {
    expect(islandSize(1, 0)).toBe(ISLAND_MIN);
    expect(islandSize(1, 0, true)).toBe(HOME_MIN);
  });

  it("grows with skills and level, and never shrinks below the minimum", () => {
    expect(islandSize(1, 4)).toBe(ISLAND_MIN + 1);
    expect(islandSize(2, 0)).toBe(ISLAND_MIN + 1);
    expect(islandSize(3, 8)).toBe(ISLAND_MIN + 4);
    expect(islandSize(0, -3)).toBe(ISLAND_MIN);
    expect(islandSize(Number.NaN, Number.NaN)).toBe(ISLAND_MIN);
  });

  it("is clamped at the maximum", () => {
    expect(islandSize(50, 400)).toBe(ISLAND_MAX);
    expect(islandSize(50, 400, true)).toBe(HOME_MAX);
    expect(islandSize(1, 27, true)).toBeLessThanOrEqual(HOME_MAX);
  });

  it("keeps the home island bigger than any other island at the same progress", () => {
    for (const lv of [1, 2, 5, 20]) {
      for (const n of [0, 3, 12, 40])
        expect(islandSize(lv, n, true)).toBeGreaterThan(islandSize(lv, n));
    }
  });

  it("glows from level 2", () => {
    expect(islandGlows(1)).toBe(false);
    expect(islandGlows(2)).toBe(true);
    expect(islandGlows(Number.NaN)).toBe(false);
  });
});

describe("nodeFill and regions", () => {
  it("maps 0..4 quests to 0..100 % in steps of 25", () => {
    expect([0, 1, 2, 3, 4].map(nodeFill)).toEqual([0, 25, 50, 75, 100]);
    expect(nodeFill(9)).toBe(100);
    expect(nodeFill(-1)).toBe(0);
  });

  it("regionPct averages quests over 4 per skill", () => {
    expect(regionPct([])).toBe(0);
    expect(regionPct([0, 0, 0])).toBe(0);
    expect(regionPct([4, 4])).toBe(100);
    expect(regionPct([1, 0, 0])).toBe(8); // 1 of 12 quests
    expect(regionPct([2, 2])).toBe(50);
    expect(regionPct([7, -2])).toBe(50); // clamped to 4 and 0
  });

  it("regionDone needs every skill mastered and at least one skill", () => {
    expect(regionDone([])).toBe(false);
    expect(regionDone([4, 3])).toBe(false);
    expect(regionDone([4, 4, 4])).toBe(true);
  });
});

describe("themes", () => {
  it("has a theme row for every seeded program", () => {
    for (const p of programs) expect(ISLAND_THEMES[p.id], p.id).toBeDefined();
  });

  it("falls back to the kind theme for an unknown program", () => {
    expect(themeFor("some-new-app", "app")).toBe(KIND_THEMES.app);
    expect(themeFor("some-new-craft", "craft")).toBe(KIND_THEMES.craft);
    expect(themeFor("davinci", "app").name.en).toBe("Film studio");
  });

  it("every theme has both languages and valid colors", () => {
    for (const th of [...Object.values(ISLAND_THEMES), ...Object.values(KIND_THEMES)]) {
      expect(th.name.ar.length).toBeGreaterThan(0);
      expect(th.name.en.length).toBeGreaterThan(0);
      expect(th.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(th.land).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("island hash deep links", () => {
  it("round-trips an island id", () => {
    expect(islandHash("davinci")).toBe("#island=davinci");
    expect(parseIslandHash(islandHash("davinci"))).toBe("davinci");
    expect(parseIslandHash("island=dazz-cam")).toBe("dazz-cam");
    expect(mapIslandHref("camera")).toBe("/map/#island=camera");
  });

  it("returns the world for empty, unknown or unsafe hashes", () => {
    expect(islandHash(null)).toBe("");
    expect(mapIslandHref(null)).toBe("/map/");
    expect(parseIslandHash("")).toBeNull();
    expect(parseIslandHash(null)).toBeNull();
    expect(parseIslandHash("#")).toBeNull();
    expect(parseIslandHash("#foo=bar")).toBeNull();
    expect(parseIslandHash("#island=")).toBeNull();
    expect(parseIslandHash("#island=<script>")).toBeNull();
    expect(parseIslandHash("#island=Dav_inci")).toBeNull();
  });

  it("finds the island key among other hash params", () => {
    expect(parseIslandHash("#tab=x&island=capcut")).toBe("capcut");
  });
});
