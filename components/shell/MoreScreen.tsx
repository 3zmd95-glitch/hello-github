"use client";

import Link from "next/link";
import { useT, type MessageKey } from "@/lib/i18n";

const SOON: readonly MessageKey[] = [
  "morePage.map",
  "morePage.planner",
  "morePage.review",
  "morePage.rewards",
];

export default function MoreScreen() {
  const { t } = useT();
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("morePage.title")}</h1>
        <p className="text-ink-2 text-sm">{t("morePage.sub")}</p>
      </header>
      <ul className="flex flex-col gap-2">
        <li>
          <Link
            href="/settings"
            className="px-card text-ink hover:border-gold flex items-center gap-3 font-bold no-underline"
          >
            {t("morePage.settings")}
            <span aria-hidden className="text-muted ms-auto rtl:rotate-180">
              ›
            </span>
          </Link>
        </li>
        {SOON.map((key) => (
          <li
            key={key}
            className="px-card flex items-center gap-3 border-dashed font-bold opacity-55 shadow-none"
          >
            {t(key)}
            <span className="px-chip ms-auto">{t("nav.soon")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
