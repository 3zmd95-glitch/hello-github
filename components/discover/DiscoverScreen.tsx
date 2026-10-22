"use client";

import ResearchPanel from "@/components/research/ResearchPanel";
import { useT } from "@/lib/i18n";
import { useGenreLink, useTikTokReturn } from "./useGenreLink";

/**
 * Discover (build plan 1.13 → 1.15): a free topic searched on YouTube, TikTok and Instagram through the
 * shared research panel (tabs, filters, thumbnails), with "attach to skill" on every card. Round 31: the
 * panel's edit-genre row (cars, food, anime…) searches a genre on its own or together with the topic, its
 * "Most popular" sort puts the most viewed / liked first, and a picked genre shows the Trend Radar's "most
 * viewed this week" above the results. Discover is the one place for genres: `/discover/?genre=<id>` (the
 * radar's genre chips) opens it with that genre on. Back from TikTok for Business (a category page's "Connect TikTok
 * trends"), a line says whether TikTok connected.
 */
export default function DiscoverScreen() {
  const { t } = useT();
  const openGenre = useGenreLink();
  const tiktok = useTikTokReturn();
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("discover.title")}</h1>
        <p className="text-ink-2 text-sm">{t("discover.sub")}</p>
        {/* Always there (empty when there is nothing to say), so its words are announced. */}
        <p role="status" className="text-sm font-bold" data-testid="tiktokads-line">
          {tiktok &&
            t(tiktok === "connected" ? "search.tiktokConnected" : "search.tiktokConnectFailed")}
        </p>
      </header>
      <ResearchPanel
        stickyTop="max-md:top-[calc(59px+env(safe-area-inset-top,0px))]"
        openGenre={openGenre}
      />
    </>
  );
}
