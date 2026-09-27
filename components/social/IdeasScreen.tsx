"use client";

import { useT } from "@/lib/i18n";

/** 💡 Ideas bank placeholder: the later wave adds audience asks, trends and skills without a video. */
export default function IdeasScreen() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="ideas-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("social.ideas.title")}</h1>
        <p className="text-ink-2 text-sm">{t("social.ideas.sub")}</p>
      </header>
      <section className="px-card">
        <p className="text-ink-2 text-sm">{t("social.ideas.empty")}</p>
      </section>
    </div>
  );
}
