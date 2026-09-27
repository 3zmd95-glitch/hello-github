"use client";

import { useT } from "@/lib/i18n";

/** Placeholder: replaced by the real screen in this sprint. */
export default function ReviewScreen() {
  const { t } = useT();
  return (
    <header className="flex flex-col gap-1" data-testid="review-screen">
      <h1 className="text-2xl">{t("review.title")}</h1>
      <p className="text-ink-2 text-sm">{t("review.sub")}</p>
    </header>
  );
}
