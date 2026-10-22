"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Genre } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { getApiKey, useStore } from "@/store";
import {
  NATIVE_MAX_RESULTS,
  NATIVE_SEARCH_SCOPE,
  nativeResultsToItems,
  type NativeConnection,
} from "@/lib/discoverNativeSearch";
import { dropHiddenEditors, hiddenEditorsFor } from "@/lib/editorFilter";
import { canonicalRefUrl, type ResearchTab } from "@/lib/research";
import { useNativeSearch } from "./useNativeSearch";
import { useNativeInfiniteScroll } from "./useNativeInfiniteScroll";
import { useFeedSources } from "./useFeedSources";
import { useRecordSounds } from "./TrendingSounds";
import { searchSoundCategory } from "@/lib/trendingSounds";
import ResultCard from "./ResultCard";
import { ReferencePlatformGlyph } from "@/lib/platformIcons";
import SaveInspirationButton from "./SaveInspirationButton";

const PLATFORMS = ["ig", "tt", "yt"] as const;
const LABELS = { ig: "Instagram", tt: "TikTok", yt: "YouTube" };
const STATUS = {
  loading: "feed.connectedPlatformLoading",
  done: "feed.connectedPlatformDone",
  "needs-attention": "feed.connectedPlatformAttention",
  empty: "feed.connectedPlatformEmpty",
  error: "feed.connectedPlatformError",
} as const;

/** The Search tab's keyword search through the Chrome helper: what Instagram, TikTok and YouTube
 * themselves show for the typed text, in their order, plus enrichment, the hidden-editor filter and
 * Save. Its own cache slot ("search", or an editor section's) never evicts a category's. */
export default function NativeKeywordResults({
  query,
  igQuery,
  scope = NATIVE_SEARCH_SCOPE,
  heading,
  attempt = 0,
  deep = false,
  active,
  canStart = true,
  onBusy,
  onOpenInspiration,
  onConnection,
}: {
  query: string;
  /** Instagram's own query when it differs (the DaVinci section: "… davinci", not "… davinci resolve"). */
  igQuery?: string;
  /** The synthetic genre id and cache slot (the CapCut and DaVinci Resolve sections have their own). */
  scope?: string;
  heading?: string;
  /** The panel's search press counter: pressing Search again on the same text searches again. */
  attempt?: number;
  /** The panel's Deep search started this attempt: the helper may show its tabs to load more. */
  deep?: boolean;
  active: boolean;
  /** False while another section's helper job runs (the helper serves one job at a time). */
  canStart?: boolean;
  /** This section's job state for the submitted search key, so the panel can sequence sections. */
  onBusy?: (scope: string, busy: boolean, searchKey: string) => void;
  onOpenInspiration?: (url: string) => void;
  onConnection?: (connection: NativeConnection) => void;
}) {
  const { t, lang } = useT();
  const term = query.trim();
  const igTerm = igQuery?.trim() || term;
  const genre = useMemo<Genre>(
    () => ({
      id: scope,
      emoji: "🔎",
      name: { ar: term, en: term },
      queries: { ar: [term], en: [term] },
      hashtags: [],
    }),
    [scope, term],
  );
  const native = useNativeSearch({ genre, active });
  const connected = native.connection === "connected";
  useEffect(() => {
    onConnection?.(native.connection);
  }, [native.connection, onConnection]);
  const searchKey = `${attempt}|${term}`;
  useEffect(() => {
    onBusy?.(scope, native.busy, searchKey);
  }, [onBusy, scope, native.busy, searchKey]);
  const [tab, setTab] = useState<ResearchTab>("all");
  const [limit, setLimit] = useState(24);
  const [previousKey, setPreviousKey] = useState(searchKey);
  if (previousKey !== searchKey) {
    setPreviousKey(searchKey);
    setTab("all");
    setLimit(24);
  }
  // One native search per submitted query, after the cached copy has been read.
  const started = useRef("");
  useEffect(() => {
    if (!active || !connected || !native.ready || !canStart || !term) return;
    if (started.current === searchKey) return;
    started.current = searchKey;
    native.search({ ig: igTerm, tt: term, yt: term }, { deep });
  }, [active, connected, native, canStart, term, igTerm, searchKey, deep]);
  // The cached slot may still hold the previous query's cards until the new search answers.
  const snapshot =
    native.snapshot &&
    PLATFORMS.every(
      (platform) => native.snapshot!.queries[platform] === (platform === "ig" ? igTerm : term),
    )
      ? native.snapshot
      : null;
  const shown = active && connected && !!term;
  const items = useMemo(() => nativeResultsToItems(snapshot, lang), [snapshot, lang]);
  const youtubeKey = useStore((s) => getApiKey(s, "youtube"));
  const hiddenEditors = useStore((s) => hiddenEditorsFor(s.settings.discover.editorScope));
  // Freeze the visible URL set on user/result changes, as the category feed does: evidence for
  // the revealed cards only, never an offscreen batch.
  const selectionKey = JSON.stringify([
    shown,
    tab,
    limit,
    snapshot?.jobId,
    snapshot?.queries,
    items.map((item) => canonicalRefUrl(item.platform, item.url)),
    hiddenEditors,
  ]);
  const [selection, setSelection] = useState({ key: "", urls: [] as string[] });
  const sources = useFeedSources(items, shown && !!snapshot, youtubeKey, {
    selectionKey,
    visibleUrls: selection.key === selectionKey ? selection.urls : [],
  });
  useRecordSounds(sources.items, searchSoundCategory(term), shown && !!snapshot);
  const visible = dropHiddenEditors(sources.items, hiddenEditors).items;
  const hidden = dropHiddenEditors(
    sources.items.filter((item) => tab === "all" || item.platform === tab),
    hiddenEditors,
  );
  const selected = hidden.items;
  if (selection.key !== selectionKey) {
    setSelection({
      key: selectionKey,
      urls: shown
        ? selected.slice(0, limit).map((item) => canonicalRefUrl(item.platform, item.url))
        : [],
    });
  }
  const loadMore = (origin: "automatic" | "manual") => {
    if (selected.length > limit) {
      setLimit((current) => Math.min(current + 24, selected.length));
    } else if (
      native.canMore &&
      connected &&
      !native.busy &&
      canStart &&
      (origin === "manual" || native.canAutoMore)
    ) {
      setLimit(NATIVE_MAX_RESULTS * PLATFORMS.length);
      native.more({ automatic: origin === "automatic" });
    }
  };
  const { sentinel, manual } = useNativeInfiniteScroll({
    enabled: shown && !!snapshot,
    scope: JSON.stringify([tab, snapshot?.queries]),
    busy: native.busy,
    progressKey: JSON.stringify(selected.slice(0, limit).map((item) => item.url)),
    canLoad:
      !native.error && (selected.length > limit || (connected && canStart && native.canAutoMore)),
    loadMore,
  });
  if (!shown) return null;
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      data-testid="native-keyword-results"
      data-scope={scope}
    >
      <h2 className="text-base">{heading ?? t("search.nativeTitle")}</h2>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("research.tabs")}>
        {(["all", ...PLATFORMS] as const).map((platform) => (
          <button
            type="button"
            key={platform}
            className={`px-btn px-btn-sm min-w-0 px-1 ${tab === platform ? "px-btn-gold" : "px-btn-ghost"}`}
            aria-pressed={tab === platform}
            data-testid={`native-keyword-tab-${platform}`}
            data-count={
              visible.filter((item) => platform === "all" || item.platform === platform).length
            }
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
        ))}
      </div>
      {snapshot?.cached && (
        <p className="text-muted text-xs">
          {t("feed.connectedCached")} {new Date(snapshot.asOf).toLocaleString(lang)}
        </p>
      )}
      {native.busy && (
        <p role="status" className="text-sm">
          {t("feed.connectedLoading")}
        </p>
      )}
      {native.error && <p role="alert">{t("feed.connectedError")}</p>}
      {snapshot?.deepSkipped && (
        <p className="text-muted text-xs" data-testid="native-keyword-deep-skipped">
          {t("feed.deepSkipped")}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="native-keyword-status">
        {PLATFORMS.map((platform) => {
          const state = snapshot?.platforms[platform];
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
              {t(state.noResults ? "feed.connectedPlatformNoResults" : STATUS[state.status])}{" "}
              {state.staleAsOf && (
                <span data-testid={`native-keyword-stale-${platform}`}>
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
        <p className="text-muted text-xs" data-testid="native-keyword-hidden-editors">
          {t("feed.hiddenEditors", { count: hidden.count })}
        </p>
      )}
      {!native.busy && snapshot && !selected.length && (
        <p className="text-ink-2 py-2 text-sm">{t("feed.connectedNoResults")}</p>
      )}
      <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-3" data-testid="native-keyword-list">
        {selected.slice(0, limit).map((item) => (
          <ResultCard
            key={item.url}
            item={item}
            visualFeed
            collapseDuplicateSnippet
            testId="native-keyword-card"
            action={<SaveInspirationButton item={item} onOpen={onOpenInspiration} />}
          />
        ))}
      </ul>
      <div ref={sentinel} className="h-px" aria-hidden="true" />
      {native.busy && (
        <p role="status" className="text-muted text-sm" data-testid="native-keyword-scroll-loading">
          {t("feed.connectedLoading")}
        </p>
      )}
      {(selected.length > limit || native.canMore) && (
        <>
          <p className="text-muted text-xs">{t("feed.connectedScrollMore")}</p>
          <button
            type="button"
            className="px-btn px-btn-green w-fit"
            disabled={selected.length <= limit && (native.busy || !connected || !canStart)}
            onClick={manual}
            data-testid="native-keyword-more"
          >
            {t(
              selected.length > limit || native.canAutoMore
                ? "feed.connectedMore"
                : "feed.openSourcesMore",
            )}
          </button>
        </>
      )}
    </section>
  );
}
