"use client";

import { ExternalLink } from "lucide-react";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import { useT, type MessageKey } from "@/lib/i18n";

/**
 * Sources with no free API (round 30, planning/tools/08-trends.md): TikTok Creative Center (the only official list
 * with a Saudi filter), getdaytrends (its terms forbid automated reading, so a link), Google Trends' own page, and
 * the Instagram trending-audio ritual, which lives in the app and has no link at all.
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
    <div className="flex flex-col gap-1.5">
      <ListGroup header={t("trends.manual")} testId="trends-manual" aria-label={t("trends.manual")}>
        {/* ListRow's markup on a plain anchor: these leave the app, in a new tab. */}
        {LINKS.map((l) => (
          <a
            key={l.id}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="ios-row"
            data-sep="16"
            data-testid="trends-manual-link"
            data-link={l.id}
          >
            <span className="ios-tx">
              <b className="whitespace-normal">{t(l.key)}</b>
            </span>
            <ExternalLink
              size={16}
              strokeWidth={1.75}
              className="text-muted shrink-0"
              aria-hidden
            />
          </a>
        ))}
        <ListRow
          title={<span className="block whitespace-normal">{t("trends.manual.instagram")}</span>}
          sub={t("trends.manual.instagramNote")}
          testId="trends-manual-link"
          data-link="instagram"
        />
      </ListGroup>
      <p className="text-muted px-4 text-xs">{t("trends.manualSub")}</p>
    </div>
  );
}
