"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { useT } from "@/lib/i18n";
import { getApiKey, useStore } from "@/store";
import { NATIVE_MAX_RESULTS, nativeResultsToItems } from "@/lib/discoverNativeSearch";
import { nativeCategoryQuery } from "@/lib/genres";
import { rankDiscoverItems } from "@/lib/discoverRanking";
import { discoverFeedbackForItem } from "@/lib/discoverFeed";
import { dropHiddenEditors, hiddenEditorsFor, mentionsHiddenEditor } from "@/lib/editorFilter";
import { canonicalRefUrl, type ResearchTab } from "@/lib/research";
import BrowseCategoryFeed from "./BrowseCategoryFeed";
import { useNativeSearch } from "./useNativeSearch";
import { useNativeInfiniteScroll } from "./useNativeInfiniteScroll";
import { useFeedSources } from "./useFeedSources";
import { useRecordSounds } from "./TrendingSounds";
import ResultCard from "./ResultCard";
import { ReferencePlatformGlyph } from "@/lib/platformIcons";
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
  const defaultQuery = nativeCategoryQuery(genre);
  const snapshotQueries = native.snapshot?.genreId === genre.id ? native.snapshot.queries : null;
  const querySourceKey = JSON.stringify(snapshotQueries);
  const queryValues = Object.values(snapshotQueries ?? {});
  const activeQuery = queryValues.length
    ? queryValues.every((value) => value === queryValues[0])
      ? queryValues[0]
      : ""
    : defaultQuery;
  const [queryDraft, setQueryDraft] = useState({
    genreId: genre.id,
    value: activeQuery,
    sourceKey: querySourceKey,
    edited: false,
  });
  // Cache hydration and category changes may arrive after the input mounts. Follow the
  // actual query until the user starts a draft; source updates must never erase that draft.
  if (
    queryDraft.genreId !== genre.id ||
    (!queryDraft.edited && queryDraft.sourceKey !== querySourceKey)
  ) {
    setQueryDraft({
      genreId: genre.id,
      value: activeQuery,
      sourceKey: querySourceKey,
      edited: false,
    });
  }
  const query = queryDraft.value;
  const [previousGenre, setPreviousGenre] = useState(genre.id);
  const [limit, setLimit] = useState(24);
  if (genre.id !== previousGenre) {
    setPreviousGenre(genre.id);
    setPopular(false);
    setTab("all");
    setLimit(24);
  }
  const connected = native.connection === "connected";
  const showNative = view === "native" && (connected || !!native.snapshot);
  const items = useMemo(() => nativeResultsToItems(native.snapshot, lang), [native.snapshot, lang]);
  const youtubeKey = useStore((s) => getApiKey(s, "youtube"));
  const accumulate = useStore((s) => s.accumulateDiscoverCandidates);
  const feedback = useStore((s) => s.discoverFeedback);
  const hiddenEditors = useStore((s) => hiddenEditorsFor(s.settings.discover.editorScope));
  // Freeze the visible URL set on user/result changes. Source evidence can re-rank Popular,
  // but must never recruit another offscreen batch by itself.
  const sourceSelectionKey = JSON.stringify([
    active,
    showNative,
    genre.id,
    tab,
    popular,
    limit,
    native.snapshot?.jobId,
    native.snapshot?.queries,
    items.map((item) => canonicalRefUrl(item.platform, item.url)),
    feedback.filter((entry) => entry.action === "less" || entry.action === "hide-creator"),
    hiddenEditors,
  ]);
  const [sourceSelection, setSourceSelection] = useState({ key: "", urls: [] as string[] });
  const sources = useFeedSources(items, active && showNative, youtubeKey, {
    selectionKey: sourceSelectionKey,
    visibleUrls: sourceSelection.key === sourceSelectionKey ? sourceSelection.urls : [],
  });
  const candidates = useStore((s) => s.discoverCandidates);
  const visual = useMemo(
    () =>
      Object.fromEntries(
        candidates.filter((c) => c.genreId === genre.id).map((c) => [c.item.url, c]),
      ),
    [candidates, genre.id],
  );
  // Use the ranker's current clock on entry and each evidence update. A mount-time clock
  // would reject later source observations as future timestamps during a long visit.
  const popularItems = useMemo(
    () =>
      popular
        ? rankDiscoverItems(sources.items, {
            mode: "popular",
            genreId: genre.id,
            feedback,
            visual,
          }).items
        : [],
    [popular, sources.items, genre.id, feedback, visual],
  );
  useEffect(() => {
    if (active && showNative && sources.items.length)
      accumulate(sources.items, { genreId: genre.id });
  }, [active, showNative, sources.items, genre.id, accumulate]);
  useRecordSounds(sources.items, genre.id, active && showNative);
  // Opening a category only reads its cache. Source tabs require an explicit button.
  const search = (deep = false) => {
    if (!connected || native.busy || !query.trim()) return;
    setQueryDraft((current) => ({ ...current, value: query.trim(), edited: true }));
    setSourceSelection({ key: sourceSelectionKey, urls: [] });
    setPopular(false);
    setLimit(24);
    setView("native");
    native.search(Object.fromEntries(PLATFORMS.map((platform) => [platform, query.trim()])), {
      deep,
    });
  };
  const notDismissed = (item: (typeof items)[number]) => {
    const action = discoverFeedbackForItem(feedback, item, genre.id)?.action;
    return action !== "less" && action !== "hide-creator";
  };
  // The owner's hidden editors are dropped next to the feedback exclusions (native order kept).
  const include = (item: (typeof items)[number]) =>
    notDismissed(item) && !mentionsHiddenEditor(item, hiddenEditors);
  const pool = (popular ? popularItems : sources.items).filter(include);
  const hidden = dropHiddenEditors(
    (popular ? popularItems : sources.items).filter(
      (item) => notDismissed(item) && (tab === "all" || item.platform === tab),
    ),
    hiddenEditors,
  );
  const selected = pool.filter((item) => tab === "all" || item.platform === tab);
  // Popular needs source evidence before a card can qualify. Assess a finite native-order
  // candidate page, not the already-qualified output, so sparse matches cannot starve new reads.
  const sourceCandidates = popular
    ? sources.items.filter((item) => include(item) && (tab === "all" || item.platform === tab))
    : selected;
  const loadableCount = sourceCandidates.length;
  // Adjust before committing effects so the hook never starts work for an obsolete selection.
  if (sourceSelection.key !== sourceSelectionKey) {
    setSourceSelection({
      key: sourceSelectionKey,
      urls:
        active && showNative && native.snapshot?.genreId === genre.id
          ? sourceCandidates.slice(0, limit).map((item) => canonicalRefUrl(item.platform, item.url))
          : [],
    });
  }
  const loadMore = (origin: "automatic" | "manual") => {
    if (loadableCount > limit) {
      setLimit((current) => Math.min(current + 24, loadableCount));
    } else if (
      native.canMore &&
      connected &&
      !native.busy &&
      (origin === "manual" || native.canAutoMore)
    ) {
      // Native order reveals the incoming batch even when its retained window rolls forward.
      // Popular advances only one candidate page per request, independent of how many qualify.
      setLimit((current) => (popular ? current + 24 : NATIVE_MAX_RESULTS * PLATFORMS.length));
      native.more({ automatic: origin === "automatic" });
    }
  };
  const { sentinel: infiniteSentinel, manual: manualLoadMore } = useNativeInfiniteScroll({
    enabled: active && showNative && !popular,
    scope: JSON.stringify([genre.id, tab, native.snapshot?.queries]),
    busy: native.busy,
    progressKey: JSON.stringify(selected.slice(0, limit).map((item) => item.url)),
    canLoad: !native.error && (loadableCount > limit || (connected && native.canAutoMore)),
    loadMore,
  });
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
              onChange={(e) =>
                setQueryDraft((current) => ({ ...current, value: e.target.value, edited: true }))
              }
            />
            <button
              className="px-btn px-btn-green"
              type="submit"
              disabled={!connected || native.busy || !query.trim()}
              data-testid="native-search-run"
            >
              {t("feed.connectedSearch")}
            </button>
            <button
              className="px-btn px-btn-ghost"
              type="button"
              disabled={!connected || native.busy || !query.trim()}
              onClick={() => search(true)}
              data-testid="native-deep-search"
            >
              {t("feed.deepSearch")}
            </button>
            {native.busy && (
              <button type="button" className="px-btn px-btn-ghost" onClick={native.cancel}>
                {t("feed.connectedCancel")}
              </button>
            )}
          </form>
          <p className="text-muted text-xs">{t("feed.deepSearchHint")}</p>
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
                  <span className="inline-flex min-h-8 flex-col items-center justify-center gap-1 text-xs">
                    {platform !== "all" && <ReferencePlatformGlyph platform={platform} />}
                    {platform === "all" ? t("research.tabAll") : LABELS[platform]}
                  </span>
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
          {!native.busy && popular && sources.checking && (
            <p role="status" className="text-sm">
              {t("feed.checking")}
            </p>
          )}
          {native.error && <p role="alert">{t("feed.connectedError")}</p>}
          {native.snapshot?.deepSkipped && (
            <p className="text-muted text-xs" data-testid="native-deep-skipped">
              {t("feed.deepSkipped")}
            </p>
          )}
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
                  {LABELS[platform]} ·{" "}
                  {t(
                    state.status === "loading"
                      ? "feed.connectedPlatformLoading"
                      : state.status === "done"
                        ? "feed.connectedPlatformDone"
                        : state.status === "needs-attention"
                          ? "feed.connectedPlatformAttention"
                          : state.noResults
                            ? "feed.connectedPlatformNoResults"
                            : state.status === "empty"
                              ? "feed.connectedPlatformEmpty"
                              : "feed.connectedPlatformError",
                  )}{" "}
                  {state.staleAsOf && (
                    <span data-testid={`native-stale-${platform}`}>
                      ·{" "}
                      {t("feed.connectedPlatformStale", {
                        time: new Date(state.staleAsOf).toLocaleString(lang),
                      })}{" "}
                    </span>
                  )}
                  ↗
                </a>
              );
            })}
          </div>
          {hidden.count > 0 && (
            <p className="text-muted text-xs" data-testid="native-hidden-editors">
              {t("feed.hiddenEditors", { count: hidden.count })}
            </p>
          )}
          {!native.busy && !sources.checking && !selected.length && (
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
          <div
            ref={infiniteSentinel}
            className="h-px"
            aria-hidden="true"
            data-testid="native-scroll-sentinel"
          />
          {native.busy && (
            <p role="status" className="text-muted text-sm" data-testid="native-scroll-loading">
              {t("feed.connectedLoading")}
            </p>
          )}
          {!popular && (selected.length > limit || native.canMore) && (
            <p className="text-muted text-xs">{t("feed.connectedScrollMore")}</p>
          )}
          {(loadableCount > limit || native.canMore) && (
            <button
              type="button"
              className="px-btn px-btn-green w-fit"
              disabled={loadableCount <= limit && (native.busy || !connected)}
              onClick={manualLoadMore}
              data-testid="native-search-more"
            >
              {t(
                loadableCount > limit || native.canAutoMore
                  ? "feed.connectedMore"
                  : "feed.openSourcesMore",
              )}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
