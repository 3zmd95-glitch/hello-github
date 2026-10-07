"use client";

import ResearchPanel from "@/components/research/ResearchPanel";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import InspirationLibrary from "./InspirationLibrary";
import { useGenreLink, useTikTokReturn } from "./useGenreLink";

/** Explore real references, then keep personal observations and practice progress. The search remains mounted
 * while the library is open so returning to a category preserves its selected video and results. */
export default function DiscoverScreen() {
  const { t } = useT();
  const openGenre = useGenreLink();
  const tiktok = useTikTokReturn();
  const count = useStore((s) => s.inspirations.length);
  const [view, setView] = useState<"explore" | "practice">("explore");
  const [focusUrl, setFocusUrl] = useState<string>();
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("discover.title")}</h1>
        <p className="text-ink-2 text-sm">{t("inspiration.sub")}</p>
        {/* Always there (empty when there is nothing to say), so its words are announced. */}
        <p role="status" className="text-sm font-bold" data-testid="tiktokads-line">
          {tiktok &&
            t(tiktok === "connected" ? "search.tiktokConnected" : "search.tiktokConnectFailed")}
        </p>
      </header>
      <div role="group" aria-label={t("discover.title")} className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`px-btn ${view === "explore" ? "px-btn-gold" : "px-btn-ghost"}`}
          aria-pressed={view === "explore"}
          onClick={() => setView("explore")}
          data-testid="inspiration-explore"
        >
          {t("inspiration.explore")}
        </button>
        <button
          type="button"
          className={`px-btn ${view === "practice" ? "px-btn-gold" : "px-btn-ghost"}`}
          aria-pressed={view === "practice"}
          onClick={() => {
            setFocusUrl(undefined);
            setView("practice");
          }}
          data-testid="inspiration-library-open"
        >
          {t("inspiration.library", { n: count })}
        </button>
      </div>
      <div hidden={view !== "explore"}>
        <ResearchPanel
          stickyTop="max-md:top-[calc(59px+env(safe-area-inset-top,0px))]"
          openGenre={openGenre}
          onOpenInspiration={(url) => {
            setFocusUrl(url);
            setView("practice");
          }}
        />
      </div>
      {view === "practice" && (
        <InspirationLibrary focusUrl={focusUrl} onExplore={() => setView("explore")} />
      )}
    </>
  );
}
