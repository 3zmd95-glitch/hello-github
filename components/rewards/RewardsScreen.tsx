"use client";

import { useEffect, useMemo } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import { useToday } from "@/components/today/useToday";
import { useT } from "@/lib/i18n";
import { levelFromXp } from "@/lib/level";
import { rankFromXp } from "@/lib/rank";
import { chestProgress, gems as gemsOf, streak as streakOf, totalXp, useStore } from "@/store";
import BadgesGrid from "./BadgesGrid";
import ChestBox from "./ChestBox";
import GemShop from "./GemShop";
import PurchasesLog from "./PurchasesLog";
import RanksGallery from "./RanksGallery";
import WalletStrip from "./WalletStrip";

/**
 * Rewards: wallet → film-canister chest → gem shop (with the owner's real-reward editor) → the 17 ranks
 * with their avatar stages → badges → purchase log. Everything reads the store; XP-changing actions go
 * through `useGameActions` so their celebrations play.
 */
export default function RewardsScreen() {
  const { t } = useT();
  const today = useToday();
  const xpEvents = useStore((s) => s.xpEvents);
  const gemEvents = useStore((s) => s.gemEvents);
  const completions = useStore((s) => s.completions);
  const microActions = useStore((s) => s.microActions);
  const freezesUsedOn = useStore((s) => s.freezesUsedOn);
  const bonusFreezes = useStore((s) => s.bonusFreezes);
  const chestsOpened = useStore((s) => s.chestsOpened);
  const rewards = useStore((s) => s.rewards);
  const purchases = useStore((s) => s.purchases);
  const badges = useStore((s) => s.badges);
  const { checkBadges } = useGameActions();

  // A badge whose condition came true elsewhere (e.g. a streak that grew overnight) is awarded on arrival.
  useEffect(() => {
    checkBadges();
  }, [checkBadges]);

  const xp = useMemo(() => totalXp({ xpEvents }), [xpEvents]);
  const gems = useMemo(() => gemsOf({ gemEvents }), [gemEvents]);
  const level = levelFromXp(xp);
  const rank = useMemo(() => rankFromXp(xp), [xp]);
  const st = useMemo(
    () => streakOf({ completions, microActions, freezesUsedOn, bonusFreezes }, today),
    [completions, microActions, freezesUsedOn, bonusFreezes, today],
  );
  const chest = useMemo(
    () => chestProgress({ completions, chestsOpened }),
    [completions, chestsOpened],
  );

  return (
    <div className="flex flex-col gap-5" data-testid="rewards-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("rewards.title")}</h1>
        <p className="text-ink-2 text-sm">{t("rewards.sub")}</p>
      </header>
      <WalletStrip gems={gems} freezes={st.freezes} level={level} rank={rank} xp={xp} />
      <ChestBox progress={chest} />
      <GemShop rewards={rewards} purchases={purchases} gems={gems} level={level} />
      <RanksGallery current={rank} />
      <BadgesGrid awards={badges} />
      <PurchasesLog purchases={purchases} rewards={rewards} />
    </div>
  );
}
