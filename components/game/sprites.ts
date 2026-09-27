/**
 * Tiny procedural pixel-art building blocks for `PixelScene` (master plan
 * round 9 + round 15: the "mini me" avatar, film-set backdrop, crew and
 * streak flame). No image assets: every sprite is a small string grid where
 * each character is a palette key (or "." for transparent), drawn onto a
 * canvas with `drawSprite`.
 *
 * The avatar's head is composed from parts (face, beard, glasses, hair,
 * headwear) picked by an `Avatar` (Settings → "Your look"); `avatarPalette`
 * resolves its named colors onto the shared palette keys.
 */

import type {
  Avatar,
  BeardStyle,
  GlassesStyle,
  HairColor,
  HairStyle,
  HeadwearColor,
  HeadwearStyle,
  PantsColor,
  ShirtColor,
  SkinTone,
  TeeColor,
} from "@/lib/domain";

/** Maps a one-character sprite key to a CSS color. */
export type Palette = Record<string, string>;

/** A sprite: each string is one pixel row, each character one pixel. */
export type SpriteMap = readonly string[];

/** Shared palette for every sprite in this file. */
export const PALETTE: Palette = {
  k: "#14151a", // near-black: outlines, eyes, blink line
  h: "#14151a", // avatar hair + beard (resolved from the avatar's hair color)
  H: "#3d4048", // hair fade / buzz shade
  s: "#caa27a", // skin
  S: "#a97f57", // skin shadow
  g: "#e8f1f8", // glasses lens
  t: "#14151a", // avatar tee
  o: "#6f7d3c", // olive overshirt
  O: "#57632f", // olive shirt shadow
  p: "#33404f", // pants
  d: "#2fae4e", // headwear (cap / beanie) main
  D: "#1f7d37", // headwear shade (cap band, beanie roll)
  q: "#c8322a", // shemagh red (fixed)
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

/**
 * The default composed head, kept as a reference: tan skin, short black
 * hair, square glasses and a full beard (master plan round 9). Tests check
 * that `composeHead(DEFAULT_AVATAR)` reproduces it pixel for pixel.
 */
export const AVATAR_HEAD: SpriteMap = [
  "..hhhh..",
  ".hhhhhh.",
  ".hsssSh.",
  ".sgkgss.",
  ".ssssss.",
  ".shhhhs.",
  ".hhhhhh.",
  "..hhhh..",
];

/**
 * A head part is a small grid stamped at (dx, dy) relative to the 8×8 head's
 * top-left corner. Parts may reach 2 px above (headwear), 2 px below and 2 px
 * out to each side (shemagh / ghutra drape), never further.
 */
export interface HeadPart {
  dx: number;
  dy: number;
  map: SpriteMap;
}

/** Margin around the 8×8 head that `composeHead` reserves for headwear and drapes. */
export const HEAD_PAD = 2;
/** Composed head size (8 + 2 × HEAD_PAD). */
export const HEAD_SIZE = 8 + 2 * HEAD_PAD;

/** Bare face: skin, eyes on row 3, a mouth line on row 5 and a chin shadow. */
export const FACE: HeadPart = {
  dx: 0,
  dy: 2,
  map: [".ssssSs.", ".skskss.", ".ssssss.", ".ssSSss.", ".ssssss.", "..SSSS.."],
};

/** Hair styles, drawn over the face (and glasses) with the hair keys h / H. */
export const HAIR: Record<HairStyle, HeadPart | null> = {
  short: { dx: 0, dy: 0, map: ["..hhhh..", ".hhhhhh.", ".h....h."] },
  buzz: { dx: 0, dy: 0, map: ["..HHHH..", ".HHHHHH.", ".H....H."] },
  fade: { dx: 0, dy: 0, map: ["..hhhh..", ".hhhhhh.", ".H....H."] },
  curly: { dx: 0, dy: 0, map: [".h.hh.h.", "hhhhhhhh", "hh....hh", ".h....h."] },
  long: {
    dx: 0,
    dy: 0,
    map: ["..hhhh..", ".hhhhhh.", ".h....h.", "hh....hh", "h......h", "h......h", "h......h"],
  },
  /** Bald draws the scalp in skin instead of hair. */
  bald: { dx: 0, dy: 0, map: ["..ssss..", ".ssssSs."] },
};

/** Beards use the hair color and sit on rows 5–7 (mouth, jaw, chin). */
export const BEARDS: Record<BeardStyle, HeadPart | null> = {
  none: null,
  mustache: { dx: 0, dy: 5, map: ["..hhhh.."] },
  goatee: { dx: 0, dy: 5, map: ["..hhhh..", "...hh...", "..hhhh.."] },
  full: { dx: 0, dy: 5, map: ["..hhhh..", ".hhhhhh.", "..hhhh.."] },
};

/** Glasses sit on the eye row (row 3). Sunglasses are one dark band. */
export const GLASSES: Record<GlassesStyle, HeadPart | null> = {
  none: null,
  square: { dx: 0, dy: 3, map: ["..gkg..."] },
  round: { dx: 0, dy: 3, map: ["..gyg..."] },
  sunglasses: { dx: 0, dy: 3, map: [".kkkkk.."] },
};

/**
 * Headwear draws last, over the hair. Cap and beanie use the headwear color
 * (d / D); the shemagh is a fixed red/white check and the ghutra white with a
 * black agal. Both drape down the sides onto the shoulders (rows 8–9).
 */
export const HEADWEAR: Record<HeadwearStyle, HeadPart | null> = {
  none: null,
  cap: { dx: 0, dy: -1, map: ["..dddd....", ".dddddd...", ".DDDDDDDD."] },
  beanie: {
    dx: 0,
    dy: -2,
    map: ["...dd...", "..dddd..", ".dddddd.", ".DDDDDD.", ".D....D."],
  },
  shemagh: {
    dx: -1,
    dy: -1,
    map: [
      "..qxqxqx..",
      ".xqxqxqxq.",
      ".qxqxqxqx.",
      ".xq....qx.",
      ".qx....xq.",
      ".xq....qx.",
      "qx......xq",
      "xq......qx",
      "qx......xq",
      ".xq....qx.",
      "..q....q..",
    ],
  },
  ghutra: {
    dx: -1,
    dy: -1,
    map: [
      "..xxxxxx..",
      ".xxxxxxxx.",
      ".kkkkkkkk.",
      ".xw....wx.",
      ".xw....wx.",
      ".xw....wx.",
      "xxw....wxx",
      "xx......xx",
      "xx......xx",
      ".xx....xx.",
      "..x....x..",
    ],
  },
};

/** Tee torso (rank 0, before the overshirt unlocks). */
export const TORSO_TEE: SpriteMap = [".tttttt.", ".tttttt.", ".tttttt.", ".tttttt."];

/** Overshirt over the tee, the tee showing at the open collar (unlocked at rank 1). */
export const TORSO_OVERSHIRT: SpriteMap = [".oOttOo.", ".oooooo.", ".oOOOOo.", ".oooooo."];

/** Bomber jacket, replaces the overshirt (unlocked at rank 8). */
export const BOMBER_JACKET: SpriteMap = [".yOttOy.", ".oooooo.", ".yOOOOy.", ".oooooo."];

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

function partMaps(
  prefix: string,
  parts: Record<string, HeadPart | null>,
): Record<string, SpriteMap> {
  const out: Record<string, SpriteMap> = {};
  for (const [name, part] of Object.entries(parts)) if (part) out[`${prefix}_${name}`] = part.map;
  return out;
}

/** Every sprite above (head parts flattened), keyed by name — handy for iterating in tests/tools. */
export const SPRITES: Record<string, SpriteMap> = {
  AVATAR_HEAD,
  FACE: FACE.map,
  ...partMaps("HAIR", HAIR),
  ...partMaps("BEARD", BEARDS),
  ...partMaps("GLASSES", GLASSES),
  ...partMaps("HEADWEAR", HEADWEAR),
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

/* ---------- Avatar colors ---------- */

/** A main color and its shadow / secondary shade. */
export interface Shade {
  main: string;
  shade: string;
}

/**
 * Named avatar colors in one place. `shade` is the darker tone for skin,
 * shirt and headwear; for hair it is the lighter "fade" tone (sides of a fade,
 * a buzz cut) since skin shows through very short hair.
 */
export const AVATAR_COLORS = {
  skin: {
    light: { main: "#f1d3b3", shade: "#d9ac86" },
    tan: { main: "#caa27a", shade: "#a97f57" },
    medium: { main: "#b07d4f", shade: "#8c5f38" },
    brown: { main: "#7d4e2b", shade: "#5f3a1f" },
    dark: { main: "#4a2e1c", shade: "#33200f" },
  },
  hair: {
    black: { main: "#14151a", shade: "#3d4048" },
    darkBrown: { main: "#3b2a1d", shade: "#5c4432" },
    brown: { main: "#6e4b2a", shade: "#96683d" },
    grey: { main: "#9a9ea6", shade: "#c9ccd2" },
    blond: { main: "#d9b55a", shade: "#efd58e" },
  },
  headwear: {
    black: { main: "#2a2c33", shade: "#14151a" },
    green: { main: "#2fae4e", shade: "#1f7d37" },
    red: { main: "#d8352b", shade: "#a3241c" },
    white: { main: "#f5f7fa", shade: "#c9ced6" },
    navy: { main: "#2b4a7a", shade: "#1d3358" },
  },
  tee: {
    black: { main: "#14151a", shade: "#14151a" },
    white: { main: "#f5f7fa", shade: "#d8dee5" },
    green: { main: "#2fae4e", shade: "#1f7d37" },
    navy: { main: "#2b4a7a", shade: "#1d3358" },
    maroon: { main: "#7a1f2e", shade: "#5a1521" },
  },
  shirt: {
    olive: { main: "#6f7d3c", shade: "#57632f" },
    navy: { main: "#2e4a75", shade: "#213556" },
    maroon: { main: "#7a2233", shade: "#5a1724" },
    sand: { main: "#c9ad7a", shade: "#a88c5a" },
    charcoal: { main: "#3b3f47", shade: "#292c32" },
  },
  pants: {
    navy: { main: "#33404f", shade: "#26303c" },
    black: { main: "#1c1d22", shade: "#14151a" },
    beige: { main: "#c4ae86", shade: "#a08c66" },
    grey: { main: "#6b7078", shade: "#50545b" },
    olive: { main: "#5e6a3a", shade: "#48522c" },
  },
} satisfies {
  skin: Record<SkinTone, Shade>;
  hair: Record<HairColor, Shade>;
  headwear: Record<HeadwearColor, Shade>;
  tee: Record<TeeColor, Shade>;
  shirt: Record<ShirtColor, Shade>;
  pants: Record<PantsColor, Shade>;
};

/**
 * The shared palette with the avatar's named colors resolved onto the avatar
 * keys: skin s/S, hair h/H, tee t, shirt o/O, pants p, headwear d/D. Pure; the
 * outline key k stays black whatever the hair or tee color.
 */
export function avatarPalette(avatar: Avatar): Palette {
  const skin = AVATAR_COLORS.skin[avatar.skin];
  const hair = AVATAR_COLORS.hair[avatar.hairColor];
  const headwear = AVATAR_COLORS.headwear[avatar.headwearColor];
  const shirt = AVATAR_COLORS.shirt[avatar.shirt];
  return {
    ...PALETTE,
    s: skin.main,
    S: skin.shade,
    h: hair.main,
    H: hair.shade,
    t: AVATAR_COLORS.tee[avatar.tee].main,
    o: shirt.main,
    O: shirt.shade,
    p: AVATAR_COLORS.pants[avatar.pants].main,
    d: headwear.main,
    D: headwear.shade,
  };
}

/**
 * Composes the head for an avatar into one HEAD_SIZE × HEAD_SIZE sprite:
 * face → beard → glasses → hair → headwear (later parts cover earlier ones).
 * The 8×8 head sits at offset (HEAD_PAD, HEAD_PAD); draw the result at
 * (headX - HEAD_PAD, headY - HEAD_PAD).
 */
export function composeHead(avatar: Avatar): SpriteMap {
  const grid: string[][] = Array.from({ length: HEAD_SIZE }, () => Array(HEAD_SIZE).fill("."));
  const stamp = (part: HeadPart | null) => {
    if (!part) return;
    for (let row = 0; row < part.map.length; row++) {
      const y = row + part.dy + HEAD_PAD;
      if (y < 0 || y >= HEAD_SIZE) continue;
      const line = part.map[row];
      for (let col = 0; col < line.length; col++) {
        const key = line[col];
        if (key === ".") continue;
        const x = col + part.dx + HEAD_PAD;
        if (x < 0 || x >= HEAD_SIZE) continue;
        grid[y][x] = key;
      }
    }
  };
  stamp(FACE);
  stamp(BEARDS[avatar.beard]);
  stamp(GLASSES[avatar.glasses]);
  stamp(HAIR[avatar.hair]);
  stamp(HEADWEAR[avatar.headwear]);
  return grid.map((row) => row.join(""));
}
