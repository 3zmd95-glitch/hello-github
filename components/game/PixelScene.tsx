"use client";

import { useEffect, useRef } from "react";
import {
  BIG_LIGHT,
  BISHT_GOLD,
  BOMBER_JACKET,
  BOOM_MIC,
  CAMERA_STRAP,
  CHAIN_WATCH,
  CINEMA_CAMERA,
  CLAPPERBOARD,
  CROWN,
  DESK,
  DIRECTOR_CHAIR,
  DRONE,
  EMBER_GREY,
  FALCON,
  FIREWORKS_BURST,
  FLAME_BIG_A,
  FLAME_BIG_B,
  FLAME_MED,
  FLAME_SMALL,
  FUSION_PARTICLES,
  HEADPHONES_NECK,
  LEGS,
  MIRRORLESS_CAMERA,
  MOON,
  PALETTE,
  PERSON_SILHOUETTE,
  PHONE,
  AVATAR_HEAD,
  SHOES_DEFAULT,
  SHOES_GREEN,
  SOFTBOX_LIGHT,
  SPARKLES,
  STUDENTS_GROUP,
  STUDIO_HEADPHONES,
  SUN,
  TORSO_OVERSHIRT,
  TORSO_TEE,
  TRIPOD_LEGS,
  TROPHY,
  drawSprite,
  type SpriteMap,
} from "./sprites";

export type PixelSceneMood = "idle" | "happy" | "celebrate";

export interface PixelSceneProps {
  /** Index into RANKS (0..16). */
  rankIndex: number;
  tier: 1 | 2 | 3;
  streak: number;
  mood?: PixelSceneMood;
  className?: string;
}

/** Logical scene size in pixels; the canvas is scaled up for crispness. */
const WIDTH = 72;
const HEIGHT = 32;
/** Internal render scale so the pixel art stays crisp on retina screens. */
const SCALE = 4;
/** Animation runs at a chunky, deliberately low frame rate. */
const FRAME_MS = 1000 / 8;
/** How long a "celebrate" mood plays before settling back to idle. */
const CELEBRATE_MS = 2000;
/** How often the idle avatar blinks. */
const BLINK_PERIOD_MS = 1200;

const FLOOR_Y = HEIGHT - 8;
const AVATAR_X = 30;
const AVATAR_FEET_Y = FLOOR_Y;

type TimeBand = "day" | "dusk" | "night";
type BackdropStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function clampIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(16, Math.max(0, Math.round(value)));
}

function timeBand(hour: number): TimeBand {
  if (hour >= 6 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "dusk";
  return "night";
}

function backdropStage(rankIndex: number): BackdropStage {
  if (rankIndex <= 3) return 0; // bedroom
  if (rankIndex <= 6) return 1; // foam-panel studio
  if (rankIndex <= 9) return 2; // green screen
  if (rankIndex <= 12) return 3; // film set with truss lights
  if (rankIndex <= 14) return 4; // red carpet + spotlight
  if (rankIndex === 15) return 5; // cosmic
  return 6; // gold legend stage
}

function stageColors(stage: BackdropStage): { wall: string; floor: string } {
  switch (stage) {
    case 0:
      return { wall: "#cdbf9a", floor: "#8a7a5c" }; // bedroom
    case 1:
      return { wall: "#3d3d42", floor: "#57575c" }; // foam-panel studio
    case 2:
      return { wall: "#1e6b3a", floor: "#2a2d33" }; // green screen
    case 3:
      return { wall: "#2a2d33", floor: "#3a3020" }; // film set
    case 4:
      return { wall: "#5c1420", floor: "#7a1626" }; // red carpet
    case 5:
      return { wall: "#0b0b1a", floor: "#14142a" }; // cosmic
    default:
      return { wall: "#3a2e0a", floor: "#caa227" }; // gold legend
  }
}

/** Fixed star positions for the cosmic stage (deterministic, no flicker). */
const STAR_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [4, 3],
  [12, 6],
  [20, 2],
  [30, 5],
  [42, 3],
  [52, 6],
  [62, 2],
  [68, 5],
  [8, 9],
  [58, 9],
  [36, 1],
  [24, 8],
];

interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
}

function drawBackdrop(ctx: Ctx2D, stage: BackdropStage, band: TimeBand, rankIndex: number): void {
  const { wall } = stageColors(stage);
  let { floor } = stageColors(stage);
  if (stage === 3 && rankIndex >= 12) floor = "#caa227"; // gold floor from rank 12

  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, WIDTH, FLOOR_Y);
  ctx.fillStyle = floor;
  ctx.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);

  if (stage === 0) {
    // Bedroom: a small window with a bed corner.
    ctx.fillStyle = "#efe6cf";
    ctx.fillRect(6, 4, 12, 10);
    ctx.fillStyle = PALETTE.w;
    ctx.fillRect(7, 5, 10, 8);
    drawSprite(ctx, band === "night" ? MOON : SUN, 9, 6);
    ctx.fillStyle = "#4da3ff";
    ctx.fillRect(2, FLOOR_Y - 6, 10, 6);
    ctx.fillStyle = "#d8dee5";
    ctx.fillRect(2, FLOOR_Y - 7, 10, 1);
  } else if (stage === 3) {
    // Film set: truss lights along the top.
    for (let x = 4; x < WIDTH - 4; x += 14) {
      ctx.fillStyle = "#8a8f98";
      ctx.fillRect(x, 0, 8, 2);
      ctx.fillStyle = PALETTE.a;
      ctx.fillRect(x + 2, 2, 4, 1);
    }
  } else if (stage === 4) {
    // Red carpet + a spotlight cone.
    ctx.fillStyle = "#8a0f1f";
    ctx.fillRect(AVATAR_X - 6, FLOOR_Y, 24, HEIGHT - FLOOR_Y);
    const gradient = ctx.createRadialGradient(AVATAR_X + 6, 6, 1, AVATAR_X + 6, FLOOR_Y, 18);
    gradient.addColorStop(0, "rgba(255, 245, 200, 0.35)");
    gradient.addColorStop(1, "rgba(255, 245, 200, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, FLOOR_Y);
  } else if (stage === 5) {
    for (const [x, y] of STAR_POSITIONS) {
      ctx.fillStyle = "#f5f7fa";
      ctx.fillRect(x, y, 1, 1);
    }
  } else if (stage === 6) {
    // Gold legend stage: a sparkling rim along the top.
    for (let x = 0; x < WIDTH; x += 6) {
      ctx.fillStyle = PALETTE.Y;
      ctx.fillRect(x, 0, 1, 1);
    }
  }

  // Time-of-day tint overlay.
  if (band === "dusk") {
    ctx.fillStyle = "#ff8a3d";
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
  } else if (band === "night") {
    ctx.fillStyle = "#0b1230";
    ctx.globalAlpha = 0.38;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
  }
}

interface CrewSlot {
  minIndex: number;
  x: number;
  draw: (ctx: Ctx2D, x: number) => void;
}

const CREW: readonly CrewSlot[] = [
  {
    minIndex: 4,
    x: 6,
    draw: (ctx, x) => {
      drawSprite(ctx, DESK, x, FLOOR_Y - 4);
      drawSprite(ctx, PERSON_SILHOUETTE, x + 1, FLOOR_Y - 9);
    },
  },
  {
    minIndex: 5,
    x: 58,
    draw: (ctx, x) => {
      drawSprite(ctx, BIG_LIGHT, x, FLOOR_Y - 6);
      drawSprite(ctx, PERSON_SILHOUETTE, x - 4, FLOOR_Y - 5);
    },
  },
  {
    minIndex: 7,
    x: 16,
    draw: (ctx, x) => {
      drawSprite(ctx, PERSON_SILHOUETTE, x, FLOOR_Y - 5);
      drawSprite(ctx, BOOM_MIC, x + 4, FLOOR_Y - 9);
    },
  },
  {
    minIndex: 10,
    x: 48,
    draw: (ctx, x) => {
      drawSprite(ctx, PERSON_SILHOUETTE, x, FLOOR_Y - 9);
      drawSprite(ctx, TRIPOD_LEGS, x + 5, FLOOR_Y - 3);
      drawSprite(ctx, CINEMA_CAMERA, x + 4, FLOOR_Y - 8);
    },
  },
  {
    minIndex: 11,
    x: 62,
    draw: (ctx, x) => drawSprite(ctx, DIRECTOR_CHAIR, x, FLOOR_Y - 6),
  },
  {
    minIndex: 13,
    x: 20,
    draw: (ctx, x) => drawSprite(ctx, DRONE, x, 4),
  },
  {
    minIndex: 14,
    x: 3,
    draw: (ctx, x) => drawSprite(ctx, TROPHY, x, FLOOR_Y - 4),
  },
  {
    minIndex: 15,
    x: 44,
    draw: (ctx, x) => drawSprite(ctx, STUDENTS_GROUP, x, FLOOR_Y - 3),
  },
  {
    minIndex: 16,
    x: 8,
    draw: (ctx, x) => drawSprite(ctx, FIREWORKS_BURST, x, 3),
  },
];

function drawCrew(ctx: Ctx2D, rankIndex: number): void {
  for (const slot of CREW) {
    if (rankIndex >= slot.minIndex) slot.draw(ctx, slot.x);
  }
}

interface AvatarFrame {
  hopY: number;
  blink: boolean;
  sparkle: boolean;
}

/** Draws the "mini me" avatar with every accessory unlocked up to rankIndex. */
function drawAvatar(ctx: Ctx2D, rankIndex: number, tier: 1 | 2 | 3, frame: AvatarFrame): void {
  const x = AVATAR_X;
  const y = AVATAR_FEET_Y - 18 + frame.hopY;

  const headY = y;
  const torsoY = y + 8;
  const legsY = torsoY + 4;
  const shoesY = legsY + 4;

  // Torso: pick the most-advanced unlocked layer (they replace each other).
  const torso = rankIndex >= 8 ? BOMBER_JACKET : rankIndex >= 1 ? TORSO_OVERSHIRT : TORSO_TEE;
  const shoes = rankIndex >= 3 ? SHOES_GREEN : SHOES_DEFAULT;

  drawSprite(ctx, AVATAR_HEAD, x, headY);
  if (frame.blink) {
    ctx.fillStyle = PALETTE.k;
    ctx.fillRect(x + 3, headY + 3, 2, 1);
  }
  drawSprite(ctx, torso, x, torsoY);
  drawSprite(ctx, LEGS, x, legsY);
  drawSprite(ctx, shoes, x, shoesY);

  if (rankIndex >= 2) drawSprite(ctx, CAMERA_STRAP, x + 2, torsoY);
  if (rankIndex >= 4 && rankIndex < 7) drawSprite(ctx, HEADPHONES_NECK, x, torsoY - 2);
  if (rankIndex >= 7) drawSprite(ctx, STUDIO_HEADPHONES, x, headY - 1);
  if (rankIndex >= 12) drawSprite(ctx, CHAIN_WATCH, x + 2, torsoY + 3);

  // Held item: the most advanced camera in hand replaces earlier ones.
  if (rankIndex >= 10) {
    drawSprite(ctx, CINEMA_CAMERA, x + 8, torsoY - 1);
    drawSprite(ctx, CLAPPERBOARD, x - 5, torsoY + 1);
  } else if (rankIndex >= 6) {
    drawSprite(ctx, MIRRORLESS_CAMERA, x + 8, torsoY);
  } else if (rankIndex === 0) {
    drawSprite(ctx, PHONE, x + 8, torsoY + 1);
  }

  if (rankIndex >= 5 && rankIndex < 10) drawSprite(ctx, SOFTBOX_LIGHT, x - 8, torsoY - 2);
  if (rankIndex >= 6) {
    const sparkleOffset = frame.sparkle ? 0 : 1;
    drawSprite(ctx, SPARKLES, x + 6, headY - 3 + sparkleOffset);
  }
  if (rankIndex >= 9) drawSprite(ctx, FUSION_PARTICLES, x - 3, headY - 2);

  if (rankIndex >= 11) drawSprite(ctx, BISHT_GOLD, x, torsoY);
  if (rankIndex >= 13) drawSprite(ctx, FALCON, x + 8, torsoY - 1);

  if (rankIndex >= 14) {
    // Golden aura glow behind the avatar.
    const gradient = ctx.createRadialGradient(x + 4, torsoY, 1, x + 4, torsoY, 12);
    gradient.addColorStop(0, "rgba(255, 230, 163, 0.45)");
    gradient.addColorStop(1, "rgba(255, 230, 163, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x - 12, headY - 12, 28, 36);
  }

  if (rankIndex >= 16) drawSprite(ctx, CROWN, x, headY - 4);

  // Tier marks: a small star pixel per tier above 1.
  if (tier >= 2) {
    ctx.fillStyle = PALETTE.Y;
    ctx.fillRect(x + 7, headY - 6, 1, 1);
  }
  if (tier >= 3) {
    ctx.fillStyle = PALETTE.Y;
    ctx.fillRect(x + 2, headY - 6, 1, 1);
  }
}

function flameSpriteFor(streak: number, flicker: boolean): SpriteMap {
  if (streak <= 0) return EMBER_GREY;
  if (streak <= 2) return FLAME_SMALL;
  if (streak <= 6) return FLAME_MED;
  return flicker ? FLAME_BIG_A : FLAME_BIG_B;
}

function drawFlame(ctx: Ctx2D, streak: number, flicker: boolean): void {
  const sprite = flameSpriteFor(streak, flicker);
  drawSprite(ctx, sprite, 2, HEIGHT - sprite.length - 1);
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/**
 * A procedural pixel-art scene: film-set backdrop (evolves with rank and
 * time of day), the "mini me" avatar with cumulative rank unlocks, crew that
 * joins over time, and a streak flame. Pure canvas drawing, no images.
 */
export default function PixelScene({
  rankIndex,
  tier,
  streak,
  mood = "idle",
  className,
}: PixelSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const celebrateStartRef = useRef<number | null>(null);
  const wasCelebratingRef = useRef(false);

  useEffect(() => {
    if (mood === "celebrate" && !wasCelebratingRef.current) {
      celebrateStartRef.current =
        typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    wasCelebratingRef.current = mood === "celebrate";
  }, [mood]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const idx = clampIndex(rankIndex);
    const safeStreak = Math.max(0, Math.floor(streak));
    const reduceMotion = prefersReducedMotion();

    let rafId: number | null = null;
    let lastDraw = 0;

    function render(now: number): void {
      if (!ctx) return;
      const elapsedCelebrate = celebrateStartRef.current
        ? now - celebrateStartRef.current
        : Number.POSITIVE_INFINITY;
      const effectiveMood: PixelSceneMood =
        mood === "celebrate" && elapsedCelebrate >= CELEBRATE_MS ? "idle" : mood;

      const hour = new Date().getHours();
      const band = timeBand(hour);
      const stage = backdropStage(idx);

      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.scale(SCALE, SCALE);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      drawBackdrop(ctx, stage, band, idx);
      drawCrew(ctx, idx);

      const blink = !reduceMotion && Math.floor(now / BLINK_PERIOD_MS) % 6 === 0;
      const hopping = !reduceMotion && (effectiveMood === "happy" || effectiveMood === "celebrate");
      const hopY = hopping && Math.floor(now / FRAME_MS) % 2 === 0 ? -1 : 0;
      const flicker = !reduceMotion && Math.floor(now / FRAME_MS) % 2 === 0;

      drawAvatar(ctx, idx, tier, {
        hopY,
        blink,
        sparkle: effectiveMood === "celebrate" && !reduceMotion,
      });
      drawFlame(ctx, safeStreak, flicker);

      ctx.restore();
    }

    function schedule(): void {
      rafId = requestAnimationFrame(loop);
    }

    function loop(now: number): void {
      if (now - lastDraw >= FRAME_MS) {
        lastDraw = now;
        render(now);
      }
      if (!reduceMotion) schedule();
    }

    function handleVisibility(): void {
      if (document.hidden) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        return;
      }
      render(typeof performance !== "undefined" ? performance.now() : Date.now());
      if (!reduceMotion) schedule();
    }

    render(typeof performance !== "undefined" ? performance.now() : Date.now());
    if (!reduceMotion && !document.hidden) schedule();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [rankIndex, tier, streak, mood]);

  const idx = clampIndex(rankIndex);
  const safeStreak = Math.max(0, Math.floor(streak));

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH * SCALE}
      height={HEIGHT * SCALE}
      role="img"
      aria-label={`Pixel scene, rank ${idx + 1}, streak ${safeStreak}`}
      className={className}
      style={{ width: "100%", height: "auto", imageRendering: "pixelated" }}
    />
  );
}
