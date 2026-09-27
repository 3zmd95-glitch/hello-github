"use client";

import { useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import PxBar from "@/components/ui/PxBar";
import type { ChestProgress, Loot } from "@/lib/chests";
import { useT, type I18n } from "@/lib/i18n";

/** Pixel film canister: rows of the sprite, one char per pixel (see PIXEL_COLORS). */
const CANISTER: readonly string[] = [
  "..llllllll..",
  ".llLLLLLLll.",
  ".llllllllll.",
  "..bbbbbbbb..",
  ".bbBBBBBBbb.",
  ".bbyyyyyybb.",
  ".bbyYYYYybb.",
  ".bbyYwwYybb.",
  ".bbyYwwYybb.",
  ".bbyYYYYybb.",
  ".bbyyyyyybb.",
  ".bbBBBBBBbb.",
  ".bbbbbbbbbb.",
  "..bbbbbbbb..",
  "...ffffff...",
  "..f.f..f.f..",
];
const PIXEL_COLORS: Record<string, string> = {
  l: "#8a8f98",
  L: "#c6ccd6",
  b: "#23272f",
  B: "#3a3f4a",
  y: "#ffcc4d",
  Y: "#ffe08f",
  w: "#f6f1e3",
  f: "#05080c",
};

function Canister({ className }: { className?: string }) {
  const rects: { x: number; y: number; c: string }[] = [];
  CANISTER.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PIXEL_COLORS[row[x]];
      if (c) rects.push({ x, y, c });
    }
  });
  return (
    <svg
      viewBox={`0 0 ${CANISTER[0].length} ${CANISTER.length}`}
      className={className}
      aria-hidden
      shapeRendering="crispEdges"
    >
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={1} height={1} fill={r.c} />
      ))}
    </svg>
  );
}

/** Text for a chest's loot (same wording as the celebration). */
export function lootText(loot: Loot, { t, L }: I18n): string {
  if (loot.kind === "gems") return t("xp.loot.gems", { n: loot.amount });
  if (loot.kind === "freeze") return t("xp.loot.freeze");
  return t("xp.loot.prompt", { text: L(loot.prompt) });
}

/**
 * The film-canister chest: progress toward the next one, an "Open!" button when one waits (the loot
 * celebration plays through `useGameActions().openChest`), and the last loot shown inline.
 */
export default function ChestBox({ progress }: { progress: ChestProgress }) {
  const i18n = useT();
  const { t } = i18n;
  const { openChest } = useGameActions();
  const [lastLoot, setLastLoot] = useState<Loot | null>(null);
  const left = progress.needed - progress.done;

  const onOpen = () => {
    const loot = openChest();
    if (loot) setLastLoot(loot);
  };

  return (
    <section
      className="px-card rw-chest flex flex-col gap-3"
      data-testid="chest-box"
      data-ready={progress.ready}
    >
      <div className="flex items-center gap-3">
        <div className="rw-canister-wrap" aria-hidden>
          <Canister className="rw-canister" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg">{t("rewards.chest.title")}</h2>
            <span className="num text-ink-2 ms-auto text-sm" data-testid="chest-progress">
              {t("rewards.chest.progress", { done: progress.done, needed: progress.needed })}
            </span>
          </div>
          <p className="text-muted text-xs">{t("rewards.chest.sub")}</p>
        </div>
      </div>

      <PxBar
        value={progress.done / progress.needed}
        color="var(--gold)"
        label={t("rewards.chest.title")}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-2 text-sm">
          {progress.ready
            ? progress.pending > 1
              ? t("rewards.chest.pending", { n: progress.pending })
              : t("rewards.chest.ready")
            : left === 1
              ? t("rewards.chest.leftOne")
              : t("rewards.chest.left", { n: left })}
        </span>
        <button
          type="button"
          className="px-btn px-btn-gold ms-auto"
          disabled={!progress.ready}
          onClick={onOpen}
          data-testid="chest-open"
        >
          {t("rewards.chest.open")}
          {progress.pending > 1 && <span className="num">×{progress.pending}</span>}
        </button>
      </div>

      {lastLoot && (
        <div
          className="px-inset flex items-center gap-2 text-sm"
          data-testid="chest-loot"
          data-loot={lastLoot.kind}
        >
          <span aria-hidden className="text-xl leading-none">
            {lastLoot.kind === "gems" ? "💎" : lastLoot.kind === "freeze" ? "🧊" : "💡"}
          </span>
          <span className="min-w-0">
            <small className="text-muted block text-[0.7rem]">{t("rewards.chest.last")}</small>
            <b className="block">{lootText(lastLoot, i18n)}</b>
          </span>
        </div>
      )}
    </section>
  );
}
