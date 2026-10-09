"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { discoverRequestFrom, type DiscoverItem } from "@/lib/discover";
import {
  categoryCandidates,
  discoverFeedbackCreator,
  discoverFeedbackForItem,
  discoverPostKey,
  savedDiscoverInterests,
  type DiscoverFeedbackUndo,
} from "@/lib/discoverFeed";
import { CATEGORY_EXPANSION_ROUNDS, expandCategory } from "@/lib/discoverExpansion";
import { categoryRefillCost, refillCategory } from "@/lib/discoverRefill";
import { rankDiscoverItems, type DiscoverFeedMode } from "@/lib/discoverRanking";
import type { Genre } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import type { ResearchTab } from "@/lib/research";
import { scoutErrorMessageKey, type ScoutError } from "@/lib/scoutClient";
import { getApiKey, useStore } from "@/store";
import CategoryFeed, { type FeedFeedbackAction } from "./CategoryFeed";
import SaveInspirationButton from "./SaveInspirationButton";
import { useScoutConfig } from "./useScout";
import { useDiscoverQuery, useDiscoverUsage } from "./useDiscover";
import { useFeedSources } from "./useFeedSources";
import { useCategoryEntry } from "./useCategoryEntry";
import { useExpansionDiagnostics } from "./useExpansionDiagnostics";
import DiscoverUsageLine from "./DiscoverUsageLine";
import AddCategoryReference from "./AddCategoryReference";
import CategoryVisualChecks from "./CategoryVisualChecks";
import { useCategoryVisual } from "./useCategoryVisual";
import { useCreatorExpansion } from "./useCreatorExpansion";
import CreatorExpansionAction, { CreatorExpansionStatus } from "./CreatorExpansionAction";
import TikTokNativeAccess from "./TikTokNativeAccess";

/** Category browsing has its own controls and state; it never edits the retained Search form. */
export default function BrowseCategoryFeed({
  genre,
  genres,
  active,
  onBack,
  onCategory,
  onOpenInspiration,
}: {
  genre: Genre;
  genres: readonly Genre[];
  active: boolean;
  onBack: () => void;
  onCategory: (id: string) => void;
  onOpenInspiration: (url: string) => void;
}) {
  const { t, L, lang } = useT();
  const config = useScoutConfig();
  const youtubeKey = useStore((s) => getApiKey(s, "youtube"));
  const candidates = useStore((s) => s.discoverCandidates);
  const feedback = useStore((s) => s.discoverFeedback);
  const inspirations = useStore((s) => s.inspirations);
  const accumulate = useStore((s) => s.accumulateDiscoverCandidates);
  const setFeedback = useStore((s) => s.setDiscoverFeedback);
  const undoFeedback = useStore((s) => s.undoDiscoverFeedback);
  const savedInterests = useMemo(() => savedDiscoverInterests(inspirations), [inspirations]);
  const [mode, setMode] = useState<DiscoverFeedMode>("inspiration");
  const [tab, setTab] = useState<ResearchTab>("all");
  const [now, setNow] = useState(() => Date.now());
  const [rounds, setRounds] = useState<Record<string, number>>({});
  const [usageRevision, setUsageRevision] = useState(0);
  const [busy, setBusy] = useState<AbortController | null>(null);
  const [refilling, setRefilling] = useState(false);
  const [error, setError] = useState<ScoutError>();
  const [undo, setUndo] = useState<{ action: FeedFeedbackAction; token: DiscoverFeedbackUndo }>();
  const [previousGenre, setPreviousGenre] = useState(genre.id);
  if (previousGenre !== genre.id) {
    setPreviousGenre(genre.id);
    setTab("all");
    setMode("inspiration");
    setUndo(undefined);
    setError(undefined);
  }
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!active) return;
    const refresh = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(refresh);
      clearInterval(tick);
    };
  }, [active]);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [active, genre.id],
  );
  const request = useMemo(
    () => discoverRequestFrom({ base: "", genre, recency: "any", length: "any" }),
    [genre],
  );
  const entry = useCategoryEntry(genre.id, config, request, active);
  const { diagnostics, quotaPlatforms, record, clear } = useExpansionDiagnostics(genre.id);
  useEffect(() => {
    if (active && entry.cached) record(entry.cached);
  }, [active, entry.cached, record]);
  const query = useDiscoverQuery(entry.skipSearch ? null : request, 0, false, active);
  useEffect(() => {
    if (!active) return;
    if (query.status === "ok") {
      accumulate(query.answer.items, { genreId: genre.id });
      record(query.answer);
    } else if (query.status === "error") clear();
  }, [active, query, genre.id, accumulate, record, clear]);
  const pool = useMemo(() => categoryCandidates(candidates, genre.id), [candidates, genre.id]);
  const sources = useFeedSources(pool, active && !entry.loading, youtubeKey);
  const visualContext = useMemo(
    () =>
      Object.fromEntries(
        candidates
          .filter((candidate) => candidate.genreId === genre.id)
          .map((candidate) => [
            discoverPostKey(candidate.item.platform, candidate.item.url) ?? candidate.item.url,
            candidate,
          ]),
      ),
    [candidates, genre.id],
  );
  const visual = useCategoryVisual({
    items: sources.items,
    genreId: genre.id,
    active: active && !entry.loading,
    lang,
    platform: tab,
    now,
  });
  useEffect(() => {
    if (active && sources.items.length) accumulate(sources.items, { genreId: genre.id });
  }, [active, sources.items, genre.id, accumulate]);
  const rank = useMemo(
    () =>
      rankDiscoverItems(sources.items, {
        genreId: genre.id,
        mode,
        now,
        feedback,
        savedInterests,
        visual: visualContext,
      }),
    [sources.items, genre.id, mode, now, feedback, savedInterests, visualContext],
  );
  const explore = useMemo(
    () =>
      rankDiscoverItems(sources.items, {
        genreId: genre.id,
        mode: "explore",
        now,
        feedback,
        savedInterests,
        visual: visualContext,
      }),
    [sources.items, genre.id, now, feedback, savedInterests, visualContext],
  );
  const creatorExpansion = useCreatorExpansion({
    rows: rank.items
      .filter((item) => tab === "all" || item.platform === tab)
      .map((item) => ({ item, genreId: genre.id })),
    active: active && !entry.loading,
    context: `${genre.id}|${tab}`,
    mode,
    lang,
  });
  const usage = useDiscoverUsage(
    active ? config : null,
    query.status === "loading" ? null : usageRevision + (query.status === "ok" ? 1 : 0),
  );
  const nextRound = Math.max(
    rounds[`${genre.id}|all`] ?? 0,
    ...(tab === "all" ? ["ig", "tt", "yt"] : [tab]).map(
      (platform) => rounds[`${genre.id}|${platform}`] ?? 0,
    ),
  );
  const findMore = async (refill = false) => {
    if (
      !active ||
      !config ||
      controller.current ||
      (!refill && nextRound >= CATEGORY_EXPANSION_ROUNDS)
    )
      return;
    const abort = new AbortController();
    const assessCohort = visual.captureNextLookup();
    controller.current = abort;
    setBusy(abort);
    setRefilling(refill);
    setError(undefined);
    if (!refill)
      setRounds((previous) => ({
        ...previous,
        ...Object.fromEntries(
          (tab === "all" ? ["all", "ig", "tt", "yt"] : [tab]).map((platform) => [
            `${genre.id}|${platform}`,
            nextRound + 1,
          ]),
        ),
      }));
    try {
      const options = { platform: tab === "all" ? undefined : tab, signal: abort.signal };
      const result = refill
        ? await refillCategory(config, genre, options)
        : await expandCategory(config, genre, { ...options, round: nextRound });
      if (abort.signal.aborted) return;
      if (result.ok) {
        accumulate(result.answer.items, { genreId: genre.id });
        record(result.answer, tab === "all" ? undefined : [tab]);
        assessCohort?.(result.answer.items);
      } else {
        clear();
        setError(result.error);
      }
    } catch {
      if (!abort.signal.aborted) {
        clear();
        setError({ type: "network" });
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy((current) => (current === abort ? null : current));
      setUsageRevision((revision) => revision + 1);
    }
  };
  const vote = (item: DiscoverItem, action: FeedFeedbackAction) => {
    setNow(Date.now());
    const token = setFeedback({
      url: item.url,
      platform: item.platform,
      creator: discoverFeedbackCreator(item),
      genreId: genre.id,
      techniques: rank.evidence[item.url]?.techniques,
      action,
    });
    if (token) setUndo({ action, token });
  };
  if (!active) return null;
  return (
    <section className="px-card flex min-w-0 flex-col gap-3" data-testid="browse-category-panel">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
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
          onChange={(event) => onCategory(event.target.value)}
          data-testid="browse-category-switch"
        >
          {genres.map((option) => (
            <option key={option.id} value={option.id}>
              {option.emoji} {L(option.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("research.tabs")}>
        {(["all", "ig", "tt", "yt"] as const).map((platform) => (
          <button
            type="button"
            key={platform}
            className={`px-btn px-btn-sm min-w-0 flex-col px-1 ${tab === platform ? "px-btn-gold" : "px-btn-ghost"}`}
            aria-pressed={tab === platform}
            onClick={() => setTab(platform)}
            data-testid={`browse-tab-${platform}`}
            data-count={
              rank.items.filter((item) => platform === "all" || item.platform === platform).length
            }
          >
            <span className="text-xs">
              {platform === "all"
                ? t("research.tabAll")
                : platform === "ig"
                  ? "Instagram"
                  : platform === "tt"
                    ? "TikTok"
                    : "YouTube"}
            </span>
            <span className="num text-xs">
              {rank.items.filter((item) => platform === "all" || item.platform === platform).length}
            </span>
          </button>
        ))}
      </div>
      {usage && <DiscoverUsageLine usage={usage} testId="browse-usage" />}
      <TikTokNativeAccess
        config={config}
        categoryId={genre.id}
        active={active && (tab === "all" || tab === "tt")}
      />
      <AddCategoryReference
        key={genre.id}
        genreId={genre.id}
        onOpen={onOpenInspiration}
        onAdded={(kept) => {
          if (kept) {
            setMode("inspiration");
            setTab("all");
          }
        }}
      />
      <CategoryVisualChecks queue={visual} lookupBusy={!!busy && !busy.signal.aborted} />
      {(error || query.status === "error") && (
        <p role="alert" className="text-sm">
          {t(
            scoutErrorMessageKey(
              error ?? (query.status === "error" ? query.error : { type: "network" }),
            ),
          )}
        </p>
      )}
      <CategoryFeed
        genre={L(genre.name)}
        intro={<CreatorExpansionStatus queue={creatorExpansion} />}
        diagnostics={diagnostics}
        quotaPlatforms={quotaPlatforms}
        mode={mode}
        onMode={setMode}
        items={rank.items}
        evidence={rank.evidence}
        tab={tab}
        renderAction={(item) => <SaveInspirationButton item={item} onOpen={onOpenInspiration} />}
        renderCreatorAction={(item) => (
          <CreatorExpansionAction queue={creatorExpansion} row={{ item, genreId: genre.id }} />
        )}
        onFeedback={vote}
        likedUrls={
          new Set(
            rank.items
              .filter(
                (item) => discoverFeedbackForItem(feedback, item, genre.id)?.action === "more",
              )
              .map((item) => item.url),
          )
        }
        undo={
          undo
            ? {
                action: undo.action,
                onUndo: () => {
                  undoFeedback(undo.token);
                  setUndo(undefined);
                },
              }
            : undefined
        }
        onFindMore={() => {
          void findMore();
        }}
        onRefill={() => {
          void findMore(true);
        }}
        refilling={!!busy && !busy.signal.aborted && refilling}
        canRefill={!!config}
        refillCost={categoryRefillCost(tab === "all" ? undefined : tab)}
        findingMore={!!busy && !busy.signal.aborted && !refilling}
        canFindMore={!!config && nextRound < CATEGORY_EXPANSION_ROUNDS}
        checking={sources.checking}
        loading={(entry.loading || query.status === "loading") && !pool.length}
        searchCost={tab === "all" ? 3 : 1}
        exploreCount={explore.items.filter((item) => tab === "all" || item.platform === tab).length}
      />
    </section>
  );
}
