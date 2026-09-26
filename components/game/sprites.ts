/**
 * Tiny procedural pixel-art building blocks for `PixelScene` (master plan
 * round 9 + round 15: the "mini me" avatar, film-set backdrop, crew and
 * streak flame). No image assets: every sprite is a small string grid where
 * each character is a palette key (or "." for transparent), drawn onto a
 * canvas with `drawSprite`.
 */

/** Maps a one-character sprite key to a CSS color. */
export type Palette = Record<string, string>;

/** A sprite: each string is one pixel row, each character one pixel. */
export type SpriteMap = readonly string[];

/** Shared palette for every sprite in this file. */
export const PALETTE: Palette = {
  k: "#14151a", // near-black: hair, black tee, outlines
  s: "#caa27a", // skin
  S: "#a97f57", // skin shadow
  g: "#e8f1f8", // glasses lens
  o: "#6f7d3c", // olive overshirt
  O: "#57632f", // olive shirt shadow
  p: "#33404f", // pants
  n: "#3b2a1d", // shoe / wood brown
  e: "#2fae4e", // green sneaker
  c: "#23262c", // camera / device body
  C: "#8fd3ff", // camera lens glass
  y: "#e8c34a", // gold
  Y: "#ffd23f", // bright yellow (flame core, sparkle)
  r: "#ff6a3d", // flame orange
  m: "#5a5f66", // grey metal / ember / headphone band
  x: "#f5f7fa", // white highlight
  a: "#ffe6a3", // soft golden glow (aura, light panel)
  f: "#6e4b2a", // falcon brown
  T: "#8a8f98", // tripod / stand metal
  v: "#b98bff", // sparkle violet
  B: "#4da3ff", // sparkle / accent blue
  w: "#d8dee5", // window glass / moon
  G: "#f4d35e", // bright gold (chain, jewel band)
};

/** 8×8 head: hair, brow, glasses with a bridge, beard and mustache. */
export const AVATAR_HEAD: SpriteMap = [
  "..kkkk..",
  ".kkkkkk.",
  ".ksssSk.",
  ".sgkgs..",
  ".ssssss.",
  ".skkkks.",
  ".kkkkkk.",
  "..kkkk..",
];

/** Black tee torso (rank 0, before the overshirt unlocks). */
export const TORSO_TEE: SpriteMap = [".kkkkkk.", ".kkkkkk.", ".kkkkkk.", ".kkkkkk."];

/** Olive overshirt over the tee (unlocked at rank 1). */
export const TORSO_OVERSHIRT: SpriteMap = [".oOOOOo.", ".oooooo.", ".oOOOOo.", ".oooooo."];

/** Bomber jacket, replaces the overshirt (unlocked at rank 8). */
export const BOMBER_JACKET: SpriteMap = [".yOOOOy.", ".oooooo.", ".yOOOOy.", ".oooooo."];

export const LEGS: SpriteMap = [".pppppp.", ".pppppp.", ".pp..pp.", ".pp..pp."];

export const SHOES_DEFAULT: SpriteMap = [".nn..nn.", ".nn..nn."];

/** Green sneakers, unlocked at rank 3. */
export const SHOES_GREEN: SpriteMap = [".ee..ee.", ".ee..ee."];

/** Long gold-trimmed bisht overlay, covers torso + legs (unlocked at rank 11). */
export const BISHT_GOLD: SpriteMap = [
  ".yoooy..",
  "oOOOOOOo",
  "oOOOOOOo",
  "oOOOOOOo",
  "oOOOOOOo",
  ".yoooy..",
];

/** Phone in hand (rank 0). */
export const PHONE: SpriteMap = ["cc", "cC", "cc"];

/** Camera strap worn diagonally across the chest (rank 2). */
export const CAMERA_STRAP: SpriteMap = ["n", "n", "n", "n"];

/** Headphones resting around the neck (rank 4). */
export const HEADPHONES_NECK: SpriteMap = [".mmmmm.", "m.....m"];

/** Studio headphones worn on the head, replaces the neck pair (rank 7). */
export const STUDIO_HEADPHONES: SpriteMap = [".mmmmmm.", "m......m"];

/** Mirrorless camera held in hand (rank 6). */
export const MIRRORLESS_CAMERA: SpriteMap = ["ccc.", "cCc.", "ccc."];

/** Cinema camera, replaces the mirrorless camera in hand (rank 10). */
export const CINEMA_CAMERA: SpriteMap = [".ccc.", "ccccc", "cCCCc", ".ccc."];

/** Clapperboard held alongside the cinema camera (rank 10). */
export const CLAPPERBOARD: SpriteMap = ["kkkk", "xkxk", "kkkk", "kkkk"];

/** Small scattered sparkle burst (color sparkles, rank 6). */
export const SPARKLES: SpriteMap = ["v...Y", ".....", "..B..", ".....", "Y...v"];

/** A second, differently colored particle burst (Fusion particles, rank 9). */
export const FUSION_PARTICLES: SpriteMap = ["B...v", ".....", "..Y..", ".....", "v...B"];

/** Gold watch + chain accent (rank 12). */
export const CHAIN_WATCH: SpriteMap = ["yGGy"];

/** Falcon perched on the forearm (rank 13). */
export const FALCON: SpriteMap = ["...f...", "..fff..", ".fffff.", "..fyf..", "...f..."];

/** Crown (rank 16). */
export const CROWN: SpriteMap = [".y.y.y..", "yyyyyyyy", "yGGGGGGy", "yyyyyyyy"];

/** Softbox light on a stand, placed beside the avatar (rank 5). */
export const SOFTBOX_LIGHT: SpriteMap = [".aaa.", "aaaaa", "..T..", "..T..", "..T..", ".TTT."];

/** Generic crew-member silhouette (editor, gaffer, boom op, camera op...). */
export const PERSON_SILHOUETTE: SpriteMap = ["..k..", "..s..", ".ooo.", ".o.o.", "....."];

/** Editing desk with two monitor glows (crew, rank 4+). */
export const DESK: SpriteMap = ["TTTTTTT", "T.C.C.T", "TTTTTTT"];

/** Big production light on a stand (crew gaffer, rank 5+). */
export const BIG_LIGHT: SpriteMap = ["aaa", "aaa", "aaa", ".T.", ".T.", "TTT"];

/** Boom pole + microphone (crew, rank 7+). */
export const BOOM_MIC: SpriteMap = ["mmmmm.", "....m."];

/** Tripod legs under a camera (crew, rank 10+; pairs with CINEMA_CAMERA). */
export const TRIPOD_LEGS: SpriteMap = ["..T..", ".T.T.", "T...T"];

/** Director's chair with a small gold "3Z" stripe (crew, rank 11+). */
export const DIRECTOR_CHAIR: SpriteMap = [
  ".kkkk.",
  ".kyyk.",
  ".kkkk.",
  "k....k",
  "k....k",
  ".k..k.",
];

/** Drone silhouette (crew, rank 13+). */
export const DRONE: SpriteMap = ["m.....m", ".mmmmm.", "..m.m.."];

/** Trophy (crew, rank 14+). */
export const TROPHY: SpriteMap = [".yy.", "yyyy", ".yy.", "yyyy"];

/** A few cheering students (crew, rank 15+). */
export const STUDENTS_GROUP: SpriteMap = [".k.k.k.k.", ".s.s.s.s.", "o.o.o.o.o"];

/** Firework burst (crew, rank 16+). */
export const FIREWORKS_BURST: SpriteMap = ["Y.v.Y", ".v.v.", "v.Y.v", ".v.v.", "Y.v.Y"];

/** Streak flame, small (streak 1-2). */
export const FLAME_SMALL: SpriteMap = [".Y.", "YrY", "rYr", ".r."];

/** Streak flame, medium (streak 3-6). */
export const FLAME_MED: SpriteMap = [".YY.", "YrrY", "rYYr", "rrrr", ".rr.", "..r."];

/** Streak flame, big — two flicker frames (streak 7+). */
export const FLAME_BIG_A: SpriteMap = [
  "..Y..",
  ".YrY.",
  "YrrrY",
  "rrYrr",
  "rrrrr",
  ".rrr.",
  ".rrr.",
  "..r..",
];
export const FLAME_BIG_B: SpriteMap = [
  "..Y..",
  ".rYr.",
  "YrYrY",
  "rrrrr",
  "rYrYr",
  ".rrr.",
  ".rrr.",
  "..r..",
];

/** Grey ember shown when the streak is 0. */
export const EMBER_GREY: SpriteMap = [".m.", "mmm", ".m."];

/** Sun icon for the bedroom window (day / dusk). */
export const SUN: SpriteMap = ["..Y..", ".YYY.", "YYYYY", ".YYY.", "..Y.."];

/** Moon icon for the bedroom window (night). */
export const MOON: SpriteMap = [".ww..", "w..w.", "w...w", "w..w.", ".ww.."];

/** Every sprite above, keyed by name — handy for iterating in tests/tools. */
export const SPRITES: Record<string, SpriteMap> = {
  AVATAR_HEAD,
  TORSO_TEE,
  TORSO_OVERSHIRT,
  BOMBER_JACKET,
  LEGS,
  SHOES_DEFAULT,
  SHOES_GREEN,
  BISHT_GOLD,
  PHONE,
  CAMERA_STRAP,
  HEADPHONES_NECK,
  STUDIO_HEADPHONES,
  MIRRORLESS_CAMERA,
  CINEMA_CAMERA,
  CLAPPERBOARD,
  SPARKLES,
  FUSION_PARTICLES,
  CHAIN_WATCH,
  FALCON,
  CROWN,
  SOFTBOX_LIGHT,
  PERSON_SILHOUETTE,
  DESK,
  BIG_LIGHT,
  BOOM_MIC,
  TRIPOD_LEGS,
  DIRECTOR_CHAIR,
  DRONE,
  TROPHY,
  STUDENTS_GROUP,
  FIREWORKS_BURST,
  FLAME_SMALL,
  FLAME_MED,
  FLAME_BIG_A,
  FLAME_BIG_B,
  EMBER_GREY,
  SUN,
  MOON,
};

/** The subset of CanvasRenderingContext2D that `drawSprite` needs. */
export interface SpriteCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Draws a sprite map onto a canvas context, one filled rect per non-"."
 * pixel, scaled up by `scale` device pixels per sprite pixel. Unknown
 * palette keys are skipped rather than throwing, so a bad character never
 * breaks a frame.
 */
export function drawSprite(
  ctx: SpriteCtx,
  map: SpriteMap,
  x: number,
  y: number,
  palette: Palette = PALETTE,
  scale = 1,
): void {
  for (let row = 0; row < map.length; row++) {
    const line = map[row];
    for (let col = 0; col < line.length; col++) {
      const key = line[col];
      if (key === ".") continue;
      const color = palette[key];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
    }
  }
}
