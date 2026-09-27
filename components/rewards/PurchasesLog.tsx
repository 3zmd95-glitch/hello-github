"use client";

import type { Purchase, Reward } from "@/lib/domain";
import { rewardText } from "@/lib/gems";
import { useT } from "@/lib/i18n";
import { formatDate } from "./formatDate";

const MAX_ROWS = 10;

/** The last 10 purchases, newest first. */
export default function PurchasesLog({
  purchases,
  rewards,
}: {
  purchases: readonly Purchase[];
  rewards: readonly Reward[];
}) {
  const { t, lang } = useT();
  const rows = [...purchases].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ROWS);
  return (
    <section className="px-card flex flex-col gap-3" data-testid="purchases">
      <header>
        <h2 className="text-lg">{t("rewards.purchases.title")}</h2>
        <p className="text-muted text-xs">{t("rewards.purchases.sub")}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-ink-2 text-sm" data-testid="purchases-empty">
          {t("rewards.purchases.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((p) => {
            const reward = rewards.find((r) => r.id === p.rewardId);
            return (
              <li
                key={p.id}
                className="px-inset flex items-center gap-2 text-sm"
                data-testid="purchase-row"
                data-reward={p.rewardId}
              >
                <span aria-hidden className="text-lg leading-none">
                  {reward?.icon ?? "🗑️"}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">
                    {reward ? rewardText(reward.name, lang) : t("rewards.purchases.removed")}
                  </b>
                  <small className="text-muted block text-[0.7rem]">{formatDate(p.at, lang)}</small>
                </span>
                <span className="text-gold shrink-0 font-extrabold">
                  −<span className="num">{p.cost}</span> 💎
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
