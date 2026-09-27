"use client";

import { useT } from "@/lib/i18n";

/** 📅 Content calendar placeholder: the later wave adds the week/month views and the post pipeline. */
export default function CalendarScreen() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="calendar-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("social.calendar.title")}</h1>
        <p className="text-ink-2 text-sm">{t("social.calendar.sub")}</p>
      </header>
      <section className="px-card">
        <p className="text-ink-2 text-sm">{t("social.calendar.empty")}</p>
      </section>
    </div>
  );
}
