"use client";

import ResearchPanel from "@/components/research/ResearchPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { allGenres } from "@/lib/genres";
import CategoryDiscovery from "@/components/research/CategoryDiscovery";
import { initializeNativeHelper } from "@/lib/discoverNativeSearch";
import { useT } from "@/lib/i18n";
import { useStore } from "@/store";
import InspirationLibrary from "./InspirationLibrary";
import NativeResultsImport from "./NativeResultsImport";
import NativeVideoCaptureReview from "./NativeVideoCaptureReview";
import { useGenreLink, useTikTokReturn } from "./useGenreLink";
import type { FormatVerificationTarget } from "@/lib/formatVerification";

/** Explore real references, then keep personal observations and practice progress. The search remains mounted
 * while the library is open so returning to a category preserves its selected video and results. */
export default function DiscoverScreen() {
  const { t } = useT();
  useEffect(() => {
    initializeNativeHelper();
  }, []);
  const openGenre = useGenreLink();
  const tiktok = useTikTokReturn();
  const count = useStore((s) => s.inspirations.length);
  const customGenres = useStore((s) => s.customGenres);
  const genres = useMemo(() => allGenres(customGenres), [customGenres]);
  const [browseGenreId, setBrowseGenreId] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [importRevision, setImportRevision] = useState(0);
  const [formatReviewRequest, setFormatReviewRequest] = useState<{
    target: FormatVerificationTarget;
    revision: number;
  }>();
  const browseGenre = genres.find((genre) => genre.id === browseGenreId);
  const [view, setView] = useState<"browse" | "search" | "practice">("browse");
  const [openedGenre, setOpenedGenre] = useState<string | null>(null);
  if (openGenre && openGenre !== openedGenre) {
    setOpenedGenre(openGenre);
    setView("search");
  }
  const [focusUrl, setFocusUrl] = useState<string>();
  const searchButton = useRef<HTMLButtonElement>(null);
  const focusSearch = useRef(false);
  useEffect(() => {
    if (view !== "search" || !focusSearch.current) return;
    focusSearch.current = false;
    searchButton.current?.focus();
    searchButton.current?.scrollIntoView({ block: "nearest" });
  }, [view]);
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
      <NativeResultsImport
        genres={genres}
        onImported={(id) => {
          setImportRevision((previous) => previous + 1);
          setBrowseGenreId(id);
          setCategoryOpen(true);
          setView("browse");
        }}
        onFormatImported={(target) => {
          setFormatReviewRequest((previous) => ({
            target,
            revision: (previous?.revision ?? 0) + 1,
          }));
          setCategoryOpen(false);
          setView("browse");
        }}
      />
      <NativeVideoCaptureReview
        genres={genres}
        onReviewed={(id) => {
          setBrowseGenreId(id);
          setCategoryOpen(true);
          setView("browse");
        }}
      />
      <div role="group" aria-label={t("discover.title")} className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className={`px-btn min-w-0 justify-center ${view === "browse" ? "px-btn-gold" : "px-btn-ghost"}`}
          aria-pressed={view === "browse"}
          onClick={() => setView("browse")}
          data-testid="inspiration-explore"
        >
          {t("layout.browse")}
        </button>
        <button
          type="button"
          className={`px-btn min-w-0 justify-center ${view === "search" ? "px-btn-gold" : "px-btn-ghost"}`}
          aria-pressed={view === "search"}
          onClick={() => setView("search")}
          data-testid="inspiration-search"
          ref={searchButton}
        >
          {t("layout.search")}
        </button>
        <button
          type="button"
          className={`px-btn min-w-0 justify-center ${view === "practice" ? "px-btn-gold" : "px-btn-ghost"}`}
          aria-pressed={view === "practice"}
          onClick={() => {
            setFocusUrl(undefined);
            setView("practice");
          }}
          data-testid="inspiration-library-open"
        >
          {t("layout.saved", { n: count })}
        </button>
      </div>
      <div hidden={view === "practice" || (view === "browse" && categoryOpen && !!browseGenre)}>
        <ResearchPanel
          formatReviewRequest={formatReviewRequest}
          workspace={view === "browse" ? "browse" : "search"}
          onSearch={() => {
            focusSearch.current = true;
            setView("search");
          }}
          stickyTop="max-md:top-[calc(59px+env(safe-area-inset-top,0px))]"
          openGenre={openGenre}
          active={view === "search"}
          showBrowse={!categoryOpen}
          onBrowseCategory={(id) => {
            setBrowseGenreId(id);
            setCategoryOpen(true);
          }}
          onOpenInspiration={(url) => {
            setFocusUrl(url);
            setView("practice");
          }}
        />
      </div>
      {browseGenre && (
        <CategoryDiscovery
          key={importRevision}
          genre={browseGenre}
          genres={genres}
          active={view === "browse" && categoryOpen}
          onBack={() => setCategoryOpen(false)}
          onCategory={setBrowseGenreId}
          onOpenInspiration={(url) => {
            setFocusUrl(url);
            setView("practice");
          }}
        />
      )}
      {view === "practice" && (
        <InspirationLibrary focusUrl={focusUrl} onExplore={() => setView("browse")} />
      )}
    </>
  );
}
