"use client";

import { useT } from "@/lib/i18n";

/** 📈 Growth placeholder: the later wave adds per-platform tabs, followers, views and top posts. */
export default function GrowthScreen() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="growth-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("social.growth.title")}</h1>
        <p className="text-ink-2 text-sm">{t("social.growth.sub")}</p>
      </header>
      <section className="px-card">
        <p className="text-ink-2 text-sm">{t("social.growth.empty")}</p>
      </section>
    </div>
  );
}
