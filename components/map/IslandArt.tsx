"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/** Device pixels per logical island pixel (crisp on retina). */
const SCALE = 4;
/** CSS pixels per logical island pixel. */
const DISPLAY = 3;

/** Deterministic per-pixel noise so an island always looks the same (no flicker between renders). */
function noise(x: number, y: number, r: number): number {
  return (((x + 1) * 73856093) ^ ((y + 1) * 19349663) ^ (r * 83492791)) >>> 0;
}

export interface IslandArtProps {
  /** Island radius in logical pixels (see `islandSize`). */
  size: number;
  /** Land color (theme). */
  land: string;
  /** Program color: sprinkled accent pixels and the glow. */
  accent: string;
  /** Grey mist over an island with no skills yet. */
  fog?: boolean;
  /** Glow ring (level ≥ 2). */
  glow?: boolean;
  /** Program icon drawn on top of the island. */
  emblem: string;
  /** Extra classes for the wrapper. */
  className?: string;
}

/** Logical canvas size for an island radius. Exported for layout math and tests. */
export function islandCanvasSize(size: number): { w: number; h: number; rx: number } {
  const r = Math.max(1, Math.round(size));
  const rx = Math.round(r * 1.4);
  return { w: rx * 2 + 3, h: r * 2 + 3, rx };
}

/**
 * Hand-rolled pixel island: noisy ellipse of land with a sand rim and shallow water, darker on the south side,
 * accent-colored pixels for the program, and a fog overlay for unexplored programs. Pure canvas, no images.
 */
export default function IslandArt({
  size,
  land,
  accent,
  fog = false,
  glow = false,
  emblem,
  className = "",
}: IslandArtProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const r = Math.max(1, Math.round(size));
  const { w, h, rx } = islandCanvasSize(r);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / r;
        const n = noise(x, y, r);
        const d = Math.sqrt(dx * dx + dy * dy) + ((n % 100) / 100 - 0.5) * 0.14;
        let color: string | null = null;
        if (d < 0.62) color = land;
        else if (d < 0.8) color = "#e8c98a";
        else if (d < 0.96) color = "#3f9cc4";
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        if (d < 0.62 && dy > 0.25) {
          ctx.fillStyle = "rgba(0,0,0,.2)";
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
        if (d < 0.5 && n % 17 === 0) {
          ctx.fillStyle = accent;
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
        if (fog && d < 0.85 && n % 3 !== 0) {
          ctx.fillStyle = "rgba(214,224,236,.62)";
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
    }
  }, [w, h, rx, r, land, accent, fog]);

  return (
    <span
      aria-hidden
      className={`map-isle-art ${className}`}
      data-glow={glow}
      style={{ "--c": accent } as CSSProperties}
    >
      <canvas
        ref={ref}
        width={w * SCALE}
        height={h * SCALE}
        style={{ width: w * DISPLAY, height: h * DISPLAY }}
      />
      <span className="map-isle-emblem" style={{ fontSize: Math.max(14, r * 1.6) }}>
        {emblem}
      </span>
      {fog && <span className="map-fogq">?</span>}
    </span>
  );
}
