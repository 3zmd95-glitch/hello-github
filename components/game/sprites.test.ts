import { describe, expect, it } from "vitest";
import {
  BEARD_STYLES,
  DEFAULT_AVATAR,
  GLASSES_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR_COLORS,
  HEADWEAR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  TEE_COLORS,
} from "@/lib/domain";
import {
  AVATAR_COLORS,
  AVATAR_HEAD,
  BEARDS,
  GLASSES,
  HAIR,
  HEADWEAR,
  HEAD_PAD,
  HEAD_SIZE,
  PALETTE,
  SPRITES,
  avatarPalette,
  composeHead,
  drawSprite,
  type HeadPart,
  type Shade,
  type SpriteCtx,
  type SpriteMap,
} from "./sprites";

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

describe("avatar parts", () => {
  it("composeHead(DEFAULT_AVATAR) reproduces the reference head pixel for pixel", () => {
    const composed = composeHead(DEFAULT_AVATAR);
    expect(composed).toHaveLength(HEAD_SIZE);
    const core = composed
      .slice(HEAD_PAD, HEAD_PAD + 8)
      .map((row) => row.slice(HEAD_PAD, HEAD_PAD + 8));
    expect(core).toEqual(AVATAR_HEAD);
    // Nothing spills into the margin without headwear.
    for (const row of [...composed.slice(0, HEAD_PAD), ...composed.slice(HEAD_PAD + 8)])
      expect(row).toBe(".".repeat(HEAD_SIZE));
  });

  const partTables: Array<[string, readonly string[], Record<string, HeadPart | null>]> = [
    ["hair", HAIR_STYLES, HAIR],
    ["beard", BEARD_STYLES, BEARDS],
    ["glasses", GLASSES_STYLES, GLASSES],
    ["headwear", HEADWEAR_STYLES, HEADWEAR],
  ];
  for (const [name, values, table] of partTables) {
    it(`${name}: every enum value has an entry and every style except "none" has a sprite`, () => {
      expect(Object.keys(table).sort()).toEqual([...values].sort());
      for (const value of values) {
        if (value === "none") expect(table[value]).toBeNull();
        else expect(table[value]?.map.length, `${name}.${value}`).toBeGreaterThan(0);
      }
    });
  }

  it("every head part stays inside the composed grid (2 px margin)", () => {
    for (const table of [HAIR, BEARDS, GLASSES, HEADWEAR]) {
      for (const [name, part] of Object.entries(table)) {
        if (!part) continue;
        expect(part.dy + HEAD_PAD, name).toBeGreaterThanOrEqual(0);
        expect(part.dy + part.map.length, name).toBeLessThanOrEqual(8 + HEAD_PAD);
        expect(part.dx + HEAD_PAD, name).toBeGreaterThanOrEqual(0);
        expect(part.dx + part.map[0].length, name).toBeLessThanOrEqual(8 + HEAD_PAD);
      }
    }
  });

  it("every combination composes to a valid, same-width sprite using only palette keys", () => {
    for (const hair of HAIR_STYLES)
      for (const beard of BEARD_STYLES)
        for (const glasses of GLASSES_STYLES)
          for (const headwear of HEADWEAR_STYLES) {
            const head = composeHead({ ...DEFAULT_AVATAR, hair, beard, glasses, headwear });
            for (const row of head) {
              expect(row).toHaveLength(HEAD_SIZE);
              for (const ch of row) if (ch !== ".") expect(PALETTE[ch], ch).toBeDefined();
            }
          }
  });

  it("the cheek pixel (row 4, col 2) is skin for every hair / beard / headwear combination", () => {
    for (const hair of HAIR_STYLES)
      for (const beard of BEARD_STYLES)
        for (const headwear of HEADWEAR_STYLES) {
          const head = composeHead({ ...DEFAULT_AVATAR, hair, beard, headwear });
          expect(head[HEAD_PAD + 4][HEAD_PAD + 2], `${hair}/${beard}/${headwear}`).toBe("s");
        }
  });

  it("headwear covers the top of the hair (curls may still peek out at the sides)", () => {
    for (const headwear of HEADWEAR_STYLES) {
      if (headwear === "none") continue;
      for (const hair of HAIR_STYLES) {
        const head = composeHead({ ...DEFAULT_AVATAR, hair, headwear });
        const top = head[HEAD_PAD].slice(HEAD_PAD + 1, HEAD_PAD + 7);
        expect(top.includes("h") || top.includes("H"), `${headwear} over ${hair}`).toBe(false);
      }
    }
  });
});

describe("avatarPalette", () => {
  it("returns the shared palette untouched for the default avatar", () => {
    expect(avatarPalette(DEFAULT_AVATAR)).toEqual(PALETTE);
  });

  it("resolves every named color onto its keys and leaves the outline black", () => {
    const p = avatarPalette({
      skin: "dark",
      hair: "curly",
      hairColor: "blond",
      beard: "goatee",
      glasses: "round",
      headwear: "cap",
      headwearColor: "red",
      tee: "white",
      shirt: "navy",
      pants: "beige",
    });
    expect(p.s).toBe(AVATAR_COLORS.skin.dark.main);
    expect(p.S).toBe(AVATAR_COLORS.skin.dark.shade);
    expect(p.h).toBe(AVATAR_COLORS.hair.blond.main);
    expect(p.H).toBe(AVATAR_COLORS.hair.blond.shade);
    expect(p.d).toBe(AVATAR_COLORS.headwear.red.main);
    expect(p.D).toBe(AVATAR_COLORS.headwear.red.shade);
    expect(p.t).toBe(AVATAR_COLORS.tee.white.main);
    expect(p.o).toBe(AVATAR_COLORS.shirt.navy.main);
    expect(p.O).toBe(AVATAR_COLORS.shirt.navy.shade);
    expect(p.p).toBe(AVATAR_COLORS.pants.beige.main);
    expect(p.k).toBe(PALETTE.k);
    expect(p.q).toBe(PALETTE.q);
  });

  it("is pure and does not mutate the shared palette", () => {
    const before = { ...PALETTE };
    avatarPalette({ ...DEFAULT_AVATAR, skin: "light", tee: "green" });
    expect(PALETTE).toEqual(before);
  });

  it("every color table covers its enum and every entry is a distinct-looking hex pair", () => {
    const tables: Array<[readonly string[], Record<string, Shade>]> = [
      [SKIN_TONES, AVATAR_COLORS.skin],
      [HAIR_COLORS, AVATAR_COLORS.hair],
      [HEADWEAR_COLORS, AVATAR_COLORS.headwear],
      [TEE_COLORS, AVATAR_COLORS.tee],
      [SHIRT_COLORS, AVATAR_COLORS.shirt],
      [PANTS_COLORS, AVATAR_COLORS.pants],
    ];
    for (const [values, table] of tables) {
      expect(Object.keys(table).sort()).toEqual([...values].sort());
      const mains = new Set<string>();
      for (const shade of Object.values(table)) {
        expect(shade.main).toMatch(/^#[0-9a-f]{6}$/);
        expect(shade.shade).toMatch(/^#[0-9a-f]{6}$/);
        mains.add(shade.main);
      }
      expect(mains.size).toBe(values.length);
    }
  });
});
