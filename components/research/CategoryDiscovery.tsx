"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useT } from "@/lib/i18n";
import { getApiKey, useStore } from "@/store";
import { NATIVE_MAX_RESULTS, nativeResultsToItems } from "@/lib/discoverNativeSearch";
import { rankDiscoverItems } from "@/lib/discoverRanking";
import { discoverFeedbackForItem } from "@/lib/discoverFeed";
import type { ResearchTab } from "@/lib/research";
import BrowseCategoryFeed from "./BrowseCategoryFeed";
import { useNativeSearch } from "./useNativeSearch";
import { useFeedSources } from "./useFeedSources";
import ResultCard from "./ResultCard";
import SaveInspirationButton from "./SaveInspirationButton";

const PLATFORMS = ["ig", "tt", "yt"] as const;
const LABELS = { ig: "Instagram", tt: "TikTok", yt: "YouTube" };

/** Native retrieval and the checked reference library have different coverage contracts. */
export default function CategoryDiscovery(props: ComponentProps<typeof BrowseCategoryFeed>) {
  const { genre, active, onCategory, onBack, onOpenInspiration } = props;
  const { t, L, lang } = useT();
  const native = useNativeSearch({ genre, active });
  const [view, setView] = useState<"native" | "reviewed">("native");
  const [tab, setTab] = useState<ResearchTab>("all");
  const [popular, setPopular] = useState(false);
  const [query, setQuery] = useState(genre.queries.en[0]);
  const [previousGenre, setPreviousGenre] = useState(genre.id);
  const [limit, setLimit] = useState(24);
  if (genre.id !== previousGenre) {
    setPreviousGenre(genre.id);
    setQuery(genre.queries.en[0]);
    setPopular(false);
    setTab("all");
    setLimit(24);
  }
  const connected = native.connection === "connected";
  const showNative = view === "native" && (connected || !!native.snapshot);
  const items = useMemo(() => nativeResultsToItems(native.snapshot, lang), [native.snapshot, lang]);
  const youtubeKey = useStore((s) => getApiKey(s, "youtube"));
  const accumulate = useStore((s) => s.accumulateDiscoverCandidates);
  const sources = useFeedSources(items, active && showNative, youtubeKey);
  const feedback = useStore((s) => s.discoverFeedback);
  const candidates = useStore((s) => s.discoverCandidates);
  const visual = useMemo(
    () =>
      Object.fromEntries(
        candidates.filter((c) => c.genreId === genre.id).map((c) => [c.item.url, c]),
      ),
    [candidates, genre.id],
  );
  const [now] = useState(() => Date.now());
  const popularItems = useMemo(
    () =>
      rankDiscoverItems(sources.items, {
        mode: "popular",
        genreId: genre.id,
        feedback,
        visual,
        now,
      }).items,
    [sources.items, genre.id, feedback, visual, now],
  );
  useEffect(() => {
    if (active && showNative && sources.items.length)
      accumulate(sources.items, { genreId: genre.id });
  }, [active, showNative, sources.items, genre.id, accumulate]);
  // Entry into a category is a user action. Re-entering a cached category does not open tabs again.
  const entered = useRef(new Set<string>());
  useEffect(() => {
    if (
      !active ||
      view !== "native" ||
      !connected ||
      !native.ready ||
      native.snapshot ||
      native.busy ||
      entered.current.has(genre.id)
    )
      return;
    entered.current.add(genre.id);
    native.search(Object.fromEntries(PLATFORMS.map((platform) => [platform, genre.queries.en[0]])));
  }, [active, view, connected, genre.id, genre.queries.en, native]);
  const search = () => {
    if (!query.trim()) return;
    setPopular(false);
    setLimit(24);
    setView("native");
    native.search(Object.fromEntries(PLATFORMS.map((platform) => [platform, query.trim()])));
  };
  const pool = (popular ? popularItems : sources.items).filter((item) => {
    const action = discoverFeedbackForItem(feedback, item, genre.id)?.action;
    return action !== "less" && action !== "hide-creator";
  });
  const selected = pool.filter((item) => tab === "all" || item.platform === tab);
  const loaded = items.filter((item) => tab === "all" || item.platform === tab).length;
  const earlierUnloaded = Object.values(native.snapshot?.platforms ?? {}).some(
    (platform) => (platform.omittedCount ?? 0) > 0,
  );
  const loadMore = () => {
    if (selected.length > limit) {
      setLimit((previous) => previous + 24);
    } else if (native.canMore && connected && !native.busy) {
      // All received matches are already visible. Include the incoming batch immediately, even
      // when the bounded window rolls forward without increasing its retained card count.
      setLimit(NATIVE_MAX_RESULTS * PLATFORMS.length);
      native.more();
    }
  };
  if (!active) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="category-discovery">
      <section className="px-card flex flex-col gap-3" data-testid="native-search-connection">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">{t("feed.connectedTitle")}</h2>
          <span className="text-muted text-xs" role="status">
            {t(
              connected
                ? "feed.connectedReady"
                : native.connection === "checking"
                  ? "feed.connectedChecking"
                  : "feed.connectedNeeded",
            )}
          </span>
        </div>
        <p className="text-ink-2 text-sm">{t("feed.connectedHelp")}</p>
        {!connected && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted text-xs">{t("feed.connectedSetup")}</p>
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={native.reconnect}
              data-testid="native-search-reconnect"
            >
              {t("feed.connectedRecheck")}
            </button>
          </div>
        )}
        {(connected || native.snapshot) && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("feed.connectedViews")}>
            <button
              type="button"
              className={`px-btn px-btn-sm ${showNative ? "px-btn-gold" : "px-btn-ghost"}`}
              aria-pressed={showNative}
              onClick={() => setView("native")}
              data-testid="native-search-view"
            >
              {t("feed.connectedLive")}
            </button>
            <button
              type="button"
              className={`px-btn px-btn-sm ${!showNative ? "px-btn-gold" : "px-btn-ghost"}`}
              aria-pressed={!showNative}
              onClick={() => setView("reviewed")}
              data-testid="native-reviewed-view"
            >
              {t("feed.connectedLibrary")}
            </button>
          </div>
        )}
      </section>
      {!showNative ? (
        <>
          <p className="text-muted text-xs" data-testid="reviewed-library-coverage">
            {t("feed.connectedLibraryHelp")}
          </p>
          {native.connection !== "checking" && <BrowseCategoryFeed {...props} />}
        </>
      ) : (
        <section className="px-card flex min-w-0 flex-col gap-3" data-testid="native-search-feed">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="px-link text-sm"
              onClick={onBack}
              data-testid="browse-back"
            >
              {t("feed.backForYou")}
            </button>
            <select
              className="px-input max-w-full py-1 text-sm"
              aria-label={t("feed.chooseCategory")}
              value={genre.id}
              onChange={(e) => onCategory(e.target.value)}
              data-testid="browse-category-switch"
            >
              {props.genres.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.emoji} {L(g.name)}
                </option>
              ))}
            </select>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <input
              className="px-input min-w-0 flex-1"
              aria-label={t("feed.connectedQuery")}
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="px-btn px-btn-green"
              type="submit"
              disabled={!connected || native.busy || !query.trim()}
              data-testid="native-search-run"
            >
              {t("feed.connectedSearch")}
            </button>
            {native.busy && (
              <button type="button" className="px-btn px-btn-ghost" onClick={native.cancel}>
                {t("feed.connectedCancel")}
              </button>
            )}
          </form>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("research.tabs")}>
            {(["all", ...PLATFORMS] as const).map((platform) => {
              const count = pool.filter(
                (item) => platform === "all" || item.platform === platform,
              ).length;
              return (
                <button
                  type="button"
                  key={platform}
                  className={`px-btn px-btn-sm min-w-0 flex-col px-1 ${tab === platform ? "px-btn-gold" : "px-btn-ghost"}`}
                  aria-pressed={tab === platform}
                  data-testid={`native-tab-${platform}`}
                  data-count={count}
                  onClick={() => {
                    setTab(platform);
                    setLimit(24);
                  }}
                >
                  <span>{platform === "all" ? t("research.tabAll") : LABELS[platform]}</span>
                  <span className="num text-xs">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("feed.modes")}>
            <button
              type="button"
              className={`px-btn px-btn-sm ${!popular ? "px-btn-green" : "px-btn-ghost"}`}
              aria-pressed={!popular}
              onClick={() => setPopular(false)}
            >
              {t("feed.connectedOrder")}
            </button>
            <button
              type="button"
              className={`px-btn px-btn-sm ${popular ? "px-btn-green" : "px-btn-ghost"}`}
              aria-pressed={popular}
              onClick={() => setPopular(true)}
            >
              {t("feed.popular")}
            </button>
          </div>
          <p className="text-muted text-xs">
            {t(popular ? "feed.popularHelp" : "feed.connectedOrderHelp")}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <p className="text-muted" data-testid="native-loaded-summary">
              {t(popular ? "feed.connectedPopularLoaded" : "feed.connectedLoaded", {
                shown: Math.min(limit, selected.length),
                loaded,
              })}
            </p>
            {popular && (
              <button
                type="button"
                className="px-link"
                data-testid="native-show-all"
                onClick={() => {
                  setPopular(false);
                  setTab("all");
                  setLimit(24);
                }}
              >
                {t("feed.connectedShowAll")}
              </button>
            )}
          </div>
          {earlierUnloaded && (
            <p className="text-muted text-xs" data-testid="native-window-note">
              {t("feed.connectedWindow")}
            </p>
          )}
          {native.snapshot?.cached && (
            <p className="text-muted text-xs">
              {t("feed.connectedCached")} {new Date(native.snapshot.asOf).toLocaleString(lang)}
            </p>
          )}
          {native.busy && (
            <p role="status" className="text-sm">
              {t("feed.connectedLoading")}
            </p>
          )}
          {native.error && <p role="alert">{t("feed.connectedError")}</p>}
          <div
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
            data-testid="native-platform-status"
          >
            {PLATFORMS.map((platform) => {
              const state = native.snapshot?.platforms[platform];
              if (!state) return null;
              return (
                <a
                  className="px-link"
                  key={platform}
                  href={state.searchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {LABELS[platform]} · {state.results.length} ·{" "}
                  {t(
                    state.status === "loading"
                      ? "feed.connectedPlatformLoading"
                      : state.status === "done"
                        ? "feed.connectedPlatformDone"
                        : state.status === "needs-attention"
                          ? "feed.connectedPlatformAttention"
                          : state.status === "empty"
                            ? "feed.connectedPlatformEmpty"
                            : "feed.connectedPlatformError",
                  )}{" "}
                  ↗
                </a>
              );
            })}
          </div>
          {!native.busy && !selected.length && (
            <p className="text-ink-2 py-4 text-sm">
              {t(popular ? "feed.connectedNoPopular" : "feed.connectedNoResults")}
            </p>
          )}
          <ul
            className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4"
            data-testid="native-result-list"
          >
            {selected.slice(0, limit).map((item) => (
              <ResultCard
                key={item.url}
                item={item}
                visualFeed
                collapseDuplicateSnippet
                testId="native-result-card"
                action={<SaveInspirationButton item={item} onOpen={onOpenInspiration} />}
              />
            ))}
          </ul>
          {(selected.length > limit || native.canMore) && (
            <button
              type="button"
              className="px-btn px-btn-green w-fit"
              disabled={selected.length <= limit && (native.busy || !connected)}
              onClick={loadMore}
              data-testid="native-search-more"
            >
              {t("feed.connectedMore")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
