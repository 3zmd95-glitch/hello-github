// Generates the PWA icons in public/icons/ as pixel-art PNGs, with plain Node (no dependencies).
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const GRID = 32;
const BG = [0x45, 0xe0, 0x8e]; // --accent
const SHADOW = [0x2f, 0xa5, 0x6a];
const INK = [0x07, 0x14, 0x0d];

const THREE = ["####.", "....#", "....#", ".###.", "....#", "....#", "####."];
const ZED = ["#####", "...#.", "..#..", ".#...", "#####"];

/** 32×32 grid of colors: green tile with a chunky "3z" and a hard shadow. */
function grid() {
  const g = Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => BG));
  const plot = (glyph, x0, y0, color, dx = 0, dy = 0) => {
    glyph.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== "#") return;
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++) g[y0 + y * 2 + sy + dy][x0 + x * 2 + sx + dx] = color;
      }),
    );
  };
  // "3" is 10×14 cells, "z" 10×10; 2-cell gap → 22 wide, centered.
  const x3 = 5;
  const xz = x3 + 12;
  const top = 9;
  plot(THREE, x3, top, SHADOW, 1, 1);
  plot(ZED, xz, top + 4, SHADOW, 1, 1);
  plot(THREE, x3, top, INK);
  plot(ZED, xz, top + 4, INK);
  return g;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, g) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    const gy = Math.min(GRID - 1, Math.floor((y * GRID) / size));
    for (let x = 0; x < size; x++) {
      const gx = Math.min(GRID - 1, Math.floor((x * GRID) / size));
      const [r, gg, b] = g[gy][gx];
      raw.set([r, gg, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = new URL("../public/icons/", import.meta.url);
mkdirSync(out, { recursive: true });
const g = grid();
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  // The Meta app's icon (App settings → Basic asks for 1024×1024).
  ["icon-1024.png", 1024],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(new URL(name, out), png(size, g));
  console.log(`wrote public/icons/${name} (${size}×${size})`);
}
