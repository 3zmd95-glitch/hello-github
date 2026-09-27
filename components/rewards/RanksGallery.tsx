"use client";

import { useEffect, useRef, useState } from "react";
import PixelScene from "@/components/game/PixelScene";
import { useT } from "@/lib/i18n";
import { RANKS, type RankState, type RankTier } from "@/lib/rank";
import { EVOLUTION } from "./evolution";

/**
 * All 17 ranks in order with their tier pips, the avatar stage for that rank and what it unlocks.
 * Each preview is a live PixelScene, mounted only while its card is near the viewport so 17 canvases
 * never animate at once (the scene runs an 8 fps loop per canvas).
 */
export default function RanksGallery({ current }: { current: RankState }) {
  const { t } = useT();
  return (
    <section className="flex flex-col gap-3" data-testid="ranks-gallery">
      <header>
        <h2 className="text-lg">{t("rewards.ranks.title")}</h2>
        <p className="text-muted text-xs">{t("rewards.ranks.sub")}</p>
      </header>
      <ol className="rw-ranks">
        {RANKS.map((rank, i) => {
          const isCurrent = i === current.index;
          const locked = i > current.index;
          const filled = i < current.index ? 3 : isCurrent ? current.tier : 0;
          return (
            <RankCard
              key={rank.level}
              index={i}
              level={rank.level}
              filled={filled}
              current={isCurrent}
              locked={locked}
            />
          );
        })}
      </ol>
    </section>
  );
}

function RankCard({
  index,
  level,
  filled,
  current,
  locked,
}: {
  index: number;
  level: number;
  filled: 0 | RankTier;
  current: boolean;
  locked: boolean;
}) {
  const { t, L } = useT();
  const rank = RANKS[index];
  const previewTier: RankTier = filled === 0 ? 1 : filled;
  return (
    <li
      className={`px-card rw-rank flex flex-col gap-2 ${index === RANKS.length - 1 ? "rw-rank-final" : ""}`}
      data-testid="rank-card"
      data-rank={index}
      data-current={current}
      data-locked={locked}
      aria-current={current ? "true" : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="num bg-edge text-accent rounded-[2px] px-2 py-0.5 text-xs">
          LV {level}
        </span>
        {current && <span className="px-chip px-chip-gold">{t("rewards.ranks.current")}</span>}
        {locked && <span className="px-chip px-chip-lock">🔒 {t("rewards.ranks.locked")}</span>}
        <span
          className="ms-auto flex gap-1"
          aria-label={t("rewards.ranks.tierAria", { n: filled })}
        >
          {([1, 2, 3] as const).map((tier) => (
            <i key={tier} className="px-pip" data-on={tier <= filled} />
          ))}
        </span>
      </div>
      <div className="rw-stage" data-locked={locked}>
        <LazyScene rankIndex={index} tier={previewTier} />
      </div>
      <div className="min-w-0">
        <b className="block truncate" data-testid="rank-name">
          {L(rank)}
        </b>
        <span className="text-muted block text-xs">
          {t("rewards.ranks.unlock", { text: L(EVOLUTION[index]) })}
        </span>
      </div>
    </li>
  );
}

/** Mounts the animated scene only while its box is (nearly) on screen; a static placeholder otherwise. */
function LazyScene({ rankIndex, tier }: { rankIndex: number; tier: RankTier }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { rootMargin: "160px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="rw-scene">
      {visible ? (
        <PixelScene rankIndex={rankIndex} tier={tier} streak={0} mood="idle" className="w-full" />
      ) : (
        <div className="rw-scene-blank" aria-hidden />
      )}
    </div>
  );
}
