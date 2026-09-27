"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { tierLabel, type RankState } from "@/lib/rank";

/** Gems · freezes · level + rank · total XP, in one row of pixel stats. */
export default function WalletStrip({
  gems,
  freezes,
  level,
  rank,
  xp,
}: {
  gems: number;
  freezes: number;
  level: number;
  rank: RankState;
  xp: number;
}) {
  const { t, L } = useT();
  return (
    <section className="rw-wallet" aria-label={t("rewards.wallet.gems")} data-testid="wallet">
      <Stat icon="💎" value={gems} label={t("rewards.wallet.gems")} testId="wallet-gems" />
      <Stat
        icon="❄️"
        value={freezes}
        label={t("rewards.wallet.freezes")}
        title={t("rewards.wallet.freezesHint")}
        testId="wallet-freezes"
      />
      <Stat
        icon="🏆"
        value={
          <>
            <span className="num">LV {level}</span>
          </>
        }
        label={
          <>
            {L(rank.rank)} <span className="num">{tierLabel(rank.tier)}</span>
          </>
        }
        testId="wallet-level"
      />
      <Stat icon="⭐" value={xp} label={t("rewards.wallet.xp")} testId="wallet-xp" />
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
  icon: string;
  value: ReactNode;
  label: ReactNode;
  title?: string;
  testId: string;
}) {
  return (
    <div className="px-inset flex min-w-0 items-center gap-2 px-2 py-2" title={title}>
      <span aria-hidden className="text-xl leading-none">
        {icon}
      </span>
      <span className="min-w-0">
        <b
          className={`block text-lg leading-none ${typeof value === "number" ? "num" : ""}`}
          data-testid={testId}
        >
          {value}
        </b>
        <small className="text-muted block truncate text-[0.7rem]">{label}</small>
      </span>
    </div>
  );
}
