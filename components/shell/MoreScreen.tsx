"use client";

import Link from "next/link";
import { useT, type MessageKey } from "@/lib/i18n";

const LINKS: readonly { href: string; label: MessageKey; testId: string }[] = [
  { href: "/map", label: "morePage.map", testId: "more-map" },
  { href: "/planner", label: "morePage.planner", testId: "more-planner" },
  { href: "/review", label: "morePage.review", testId: "more-review" },
  { href: "/rewards", label: "morePage.rewards", testId: "more-rewards" },
  { href: "/discover", label: "morePage.discover", testId: "more-discover" },
  { href: "/settings", label: "morePage.settings", testId: "more-settings" },
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
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="px-card text-ink hover:border-gold flex items-center gap-3 font-bold no-underline"
              data-testid={l.testId}
            >
              {t(l.label)}
              <span aria-hidden className="text-muted ms-auto rtl:rotate-180">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
