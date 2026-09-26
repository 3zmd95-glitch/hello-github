import { describe, expect, it } from "vitest";
import { drawSprite, PALETTE, SPRITES, type SpriteCtx, type SpriteMap } from "./sprites";

function rowLengths(map: SpriteMap): number[] {
  return map.map((row) => row.length);
}

describe("sprites", () => {
  it("has at least one sprite registered", () => {
    expect(Object.keys(SPRITES).length).toBeGreaterThan(0);
  });

  for (const [name, map] of Object.entries(SPRITES)) {
    it(`${name}: every row has the same length`, () => {
      const lengths = rowLengths(map);
      expect(map.length).toBeGreaterThan(0);
      expect(new Set(lengths).size).toBe(1);
    });

    it(`${name}: only uses palette keys (or ".")`, () => {
      for (const row of map) {
        for (const char of row) {
          if (char === ".") continue;
          expect(PALETTE[char], `unknown sprite key "${char}" in ${name}`).toBeDefined();
        }
      }
    });
  }

  it("every palette color is a usable CSS color string", () => {
    for (const [key, color] of Object.entries(PALETTE)) {
      expect(typeof color).toBe("string");
      expect(color.length, `palette key "${key}"`).toBeGreaterThan(0);
    }
  });
});

describe("drawSprite", () => {
  function makeCtx(): { ctx: SpriteCtx; calls: Array<{ x: number; y: number; color: unknown }> } {
    const calls: Array<{ x: number; y: number; color: unknown }> = [];
    const ctx: SpriteCtx = {
      fillStyle: "",
      fillRect(x: number, y: number) {
        calls.push({ x, y, color: ctx.fillStyle });
      },
    };
    return { ctx, calls };
  }

  it("draws one fillRect per non-transparent pixel, skipping '.'", () => {
    const { ctx, calls } = makeCtx();
    const map: SpriteMap = [".Y.", "YrY", ".r."];
    drawSprite(ctx, map, 0, 0, { Y: "#ffd23f", r: "#ff6a3d" });

    // 1 + 3 + 1 = 5 non-"." pixels.
    expect(calls).toHaveLength(5);
  });

  it("offsets by x/y and scale", () => {
    const { ctx, calls } = makeCtx();
    drawSprite(ctx, ["Y"], 10, 20, { Y: "#ffd23f" }, 4);
    expect(calls).toEqual([{ x: 10, y: 20, color: "#ffd23f" }]);
  });

  it("silently skips a character missing from the palette", () => {
    const { ctx, calls } = makeCtx();
    expect(() => drawSprite(ctx, ["Yz"], 0, 0, { Y: "#ffd23f" })).not.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("falls back to the shared PALETTE when none is passed", () => {
    const { ctx, calls } = makeCtx();
    drawSprite(ctx, SPRITES.EMBER_GREY, 0, 0);
    expect(calls.length).toBeGreaterThan(0);
  });
});
