"use client";

import type { ReactNode } from "react";
import PxBar from "@/components/ui/PxBar";
import { useT } from "@/lib/i18n";
import type { LevelProgress } from "@/lib/level";
import { tierLabel, type RankState } from "@/lib/rank";

export default function TodayHeader({
  rank,
  level,
  xp,
  streak,
  freezes,
  lit,
}: {
  rank: RankState;
  level: LevelProgress;
  xp: number;
  streak: number;
  freezes: number;
  /** Today already counts for the streak. */
  lit: boolean;
}) {
  const { t, L } = useT();
  return (
    <section className="px-card flex flex-col gap-3" data-testid="today-header">
      <p className="text-ink-2 text-sm">{t("hdr.hello")}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted text-xs">{t("hdr.rank")}</span>
        <h1 className="text-gold text-xl md:text-2xl" data-testid="rank-name">
          {L(rank.rank)}
        </h1>
        <span className="px-chip px-chip-gold">
          <span className="num">{tierLabel(rank.tier)}</span>
        </span>
        <span
          className="num bg-edge text-accent ms-auto rounded-[2px] px-2 py-0.5 text-sm"
          aria-label={`${t("hdr.level")} ${level.level}`}
          data-testid="level"
        >
          LV {level.level}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <PxBar value={level.ratio} label={t("hdr.level")} />
        <span className="text-muted text-xs">
          {t("hdr.xpToNext", { cur: level.current, need: level.needed })}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat
          icon={<span className={lit ? "anim-flick" : "opacity-40 grayscale"}>🔥</span>}
          value={streak}
          label={t("hdr.streak")}
          testId="streak"
        />
        <Stat
          icon="❄️"
          value={`×${freezes}`}
          label={t("hdr.freezes")}
          title={t("hdr.freezesHint")}
        />
        <Stat icon="⭐" value={xp} label={t("hdr.totalXp")} testId="total-xp" />
      </div>
    </section>
  );
}

function Stat({
  icon,
  value,
  label,
  title,
  testId,
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
  title?: string;
  testId?: string;
}) {
  return (
    <div className="px-inset flex min-w-0 items-center gap-2 px-2 py-2" title={title}>
      <span aria-hidden className="text-xl leading-none">
        {icon}
      </span>
      <span className="min-w-0">
        <b className="num block text-lg leading-none" data-testid={testId}>
          {value}
        </b>
        <small className="text-muted block truncate text-[0.7rem]">{label}</small>
      </span>
    </div>
  );
}
