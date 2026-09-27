"use client";

import Link from "next/link";
import { useT, type MessageKey } from "@/lib/i18n";

/** What the Studio home will show once the Social data core lands (round 16). */
const TILES: readonly { icon: string; label: MessageKey; href: string }[] = [
  { icon: "🎬", label: "social.studio.nextPost", href: "/social/calendar" },
  { icon: "📈", label: "social.studio.growth", href: "/social/growth" },
  { icon: "💡", label: "social.studio.asks", href: "/social/ideas" },
];

/**
 * 📱 Studio: the Social world's home. Placeholder shell; the later wave fills in the next post
 * countdown, this week's plan, the growth snapshot and the inbox.
 */
export default function StudioScreen() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="studio-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("social.studio.title")}</h1>
        <p className="text-ink-2 text-sm">{t("social.studio.sub")}</p>
      </header>

      <section className="px-card flex flex-col gap-2">
        <p className="text-muted text-xs font-semibold">{t("social.studio.heroLabel")}</p>
        <p className="text-lg font-bold">{t("social.studio.heroEmpty")}</p>
        <p className="text-ink-2 text-sm">{t("social.studio.heroHint")}</p>
      </section>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TILES.map((tile) => (
          <li key={tile.href}>
            <Link
              href={tile.href}
              className="px-card text-ink flex items-center gap-3 font-bold no-underline"
            >
              <span aria-hidden className="text-xl leading-none">
                {tile.icon}
              </span>
              <span className="truncate">{t(tile.label)}</span>
              <span aria-hidden className="text-muted ms-auto rtl:rotate-180">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
