"use client";

import { useT } from "@/lib/i18n";

/** Placeholder: replaced by the real screen in this sprint. */
export default function RewardsScreen() {
  const { t } = useT();
  return (
    <header className="flex flex-col gap-1" data-testid="rewards-screen">
      <h1 className="text-2xl">{t("rewards.title")}</h1>
      <p className="text-ink-2 text-sm">{t("rewards.sub")}</p>
    </header>
  );
}
