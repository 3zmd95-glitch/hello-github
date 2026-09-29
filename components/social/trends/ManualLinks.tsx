"use client";

import { useT, type MessageKey } from "@/lib/i18n";

/**
 * 🔗 Sources with no free API (round 30, planning/tools/08-trends.md): TikTok Creative Center (the only
 * official list with a Saudi filter), getdaytrends (its terms forbid automated reading, so a link), Google
 * Trends' own page, and the Instagram trending-audio ritual, which lives in the app and has no link at all.
 */
const LINKS: readonly { id: string; key: MessageKey; href: string }[] = [
  {
    id: "tiktok",
    key: "trends.manual.tiktok",
    href: "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?region=SA&period=7",
  },
  {
    id: "getdaytrends",
    key: "trends.manual.getdaytrends",
    href: "https://getdaytrends.com/saudi-arabia/",
  },
  { id: "google", key: "trends.manual.google", href: "https://trends.google.com/trending?geo=SA" },
];

export default function ManualLinks() {
  const { t } = useT();
  return (
    <section
      className="flex flex-col gap-2"
      data-testid="trends-manual"
      aria-label={t("trends.manual")}
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="text-sm font-bold">{t("trends.manual")}</h3>
        <p className="text-muted text-xs">{t("trends.manualSub")}</p>
      </header>
      <ul className="flex flex-col gap-1.5">
        {LINKS.map((l) => (
          <li key={l.id}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="px-inset text-ink flex items-center gap-2 text-sm no-underline"
              data-testid="trends-manual-link"
              data-link={l.id}
            >
              <span className="min-w-0 flex-1 break-words">{t(l.key)}</span>
              <span aria-hidden className="text-muted">
                ↗
              </span>
            </a>
          </li>
        ))}
        <li
          className="px-inset flex items-center gap-2 text-sm"
          data-testid="trends-manual-link"
          data-link="instagram"
        >
          <span className="min-w-0 flex-1 break-words">{t("trends.manual.instagram")}</span>
          <span className="text-muted shrink-0 text-xs">{t("trends.manual.instagramNote")}</span>
        </li>
      </ul>
    </section>
  );
}
