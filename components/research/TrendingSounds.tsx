"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DiscoverItem } from "@/lib/discover";
import {
  cancelNativeSearch,
  nativeResultsToItems,
  pollNativeSearch,
  startNativeSearch,
} from "@/lib/discoverNativeSearch";
import {
  applyInstagramEvidence,
  applyTikTokEvidence,
  localTikTokSource,
} from "@/lib/discoverSources";
import { localInstagramSource } from "@/lib/formatSources";
import { dropHiddenEditors, hiddenEditorsFor } from "@/lib/editorFilter";
import { useT } from "@/lib/i18n";
import {
  readSoundObservations,
  recordSoundObservations,
  searchSoundCategory,
  soundObservations,
  trendingSounds,
  TRENDING_SOUNDS_EVENT,
  type SoundObservation,
} from "@/lib/trendingSounds";
import { useStore } from "@/store";
import ResultCard, { PLATFORM_META } from "./ResultCard";

const PLATFORMS = ["ig", "tt", "yt"] as const;

/** "Refresh trending sounds": edit searches whose posts' own pages name their sounds. TikTok's web search
 * offers no date filter by URL (packet 27 live check), so these are its plain searches. */
export const SOUND_REFRESH_QUERIES = [
  "edit",
  "capcut edit",
  "davinci resolve edit",
  "transition edit",
  "car edit",
  "anime edit",
  "football edit",
] as const;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done, fail) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        fail(signal.reason);
      },
      { once: true },
    );
  });

/** One quiet TikTok + Instagram helper search per query, one after another (the helper runs one job at a
 * time). Each found post's own public page is read two at a time and its sound recorded under the query's
 * topic. Resolves with how many sounds were read. */
async function refreshSounds(signal: AbortSignal, onStep: (query: string, step: number) => void) {
  let count = 0;
  for (const [index, query] of SOUND_REFRESH_QUERIES.entries()) {
    signal.throwIfAborted();
    onStep(query, index + 1);
    const queries = { ig: query, tt: query };
    const jobId = await startNativeSearch(queries, crypto.randomUUID());
    let job;
    try {
      while ((job = await pollNativeSearch(jobId)).status === "running") await wait(1000, signal);
    } catch (error) {
      if (signal.aborted) void cancelNativeSearch(jobId).catch(() => {});
      throw error;
    }
    const items = nativeResultsToItems(
      { ...job, genreId: "sounds", queries, cached: false, asOf: new Date().toISOString() },
      "en",
    );
    const read = async (item: DiscoverItem) =>
      item.platform === "tt"
        ? applyTikTokEvidence(item, await localTikTokSource(item.url, signal))
        : applyInstagramEvidence(item, await localInstagramSource(item.url, signal));
    const enriched: DiscoverItem[] = [];
    for (let at = 0; at < items.length; at += 2)
      enriched.push(...(await Promise.all(items.slice(at, at + 2).map(read))));
    signal.throwIfAborted();
    const rows = soundObservations(enriched, searchSoundCategory(query));
    count += rows.length;
    await recordSoundObservations(rows);
  }
  return count;
}

type Refresh = { query: string; step: number } | { done: number } | { error: true } | null;

/** Stores the sounds an enriched feed's posts name, under that feed's category, once per changed set. */
export function useRecordSounds(items: readonly DiscoverItem[], category: string, active: boolean) {
  const last = useRef("");
  useEffect(() => {
    if (!active) return;
    const rows = soundObservations(items, category);
    const signature = JSON.stringify(rows.map((row) => [row.post, row.key, row.category]));
    if (!rows.length || signature === last.current) return;
    last.current = signature;
    void recordSoundObservations(rows);
  }, [items, category, active]);
}

/** Discover Browse: sounds seen in several recent edits Discover has read (Instagram and TikTok first). */
export default function TrendingSounds({
  renderAction,
}: {
  renderAction?: (item: DiscoverItem) => ReactNode;
}) {
  const { t, lang } = useT();
  const hidden = useStore((s) => hiddenEditorsFor(s.settings.discover.editorScope));
  const [rows, setRows] = useState<SoundObservation[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      void readSoundObservations().then((next) => {
        if (live) setRows(next);
      });
    load();
    window.addEventListener(TRENDING_SOUNDS_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(TRENDING_SOUNDS_EVENT, load);
    };
  }, []);
  const sounds = useMemo(() => trendingSounds(rows, undefined, 10, { seen: true }), [rows]);
  const [refresh, setRefresh] = useState<Refresh>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const startRefresh = () => {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    void refreshSounds(controller.signal, (query, step) => setRefresh({ query, step }))
      .then((done) => setRefresh({ done }))
      .catch(() => {
        if (!controller.signal.aborted) setRefresh({ error: true });
      })
      .finally(() => {
        if (running.current === controller) running.current = null;
      });
  };
  const busy = !!refresh && "step" in refresh;
  return (
    <details open className="border-edge border-b pb-3" data-testid="trending-sounds">
      <summary className="w-fit cursor-pointer text-base font-bold">
        {t("feed.soundsTitle")}
      </summary>
      <p className="text-muted my-2 text-xs">{t("feed.soundsHonest")}</p>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button
          type="button"
          className="px-chip"
          disabled={busy}
          onClick={startRefresh}
          data-testid="trending-sounds-refresh"
        >
          {t("feed.soundsRefresh")}
        </button>
        {refresh && (
          <span className="text-muted" role="status" data-testid="trending-sounds-refresh-status">
            {"step" in refresh
              ? t("feed.soundsRefreshing", {
                  query: refresh.query,
                  step: refresh.step,
                  total: SOUND_REFRESH_QUERIES.length,
                })
              : "done" in refresh
                ? t("feed.soundsRefreshDone", { count: refresh.done })
                : t("feed.soundsRefreshError")}
          </span>
        )}
      </div>
      {!sounds.length ? (
        <p className="text-ink-2 text-sm" data-testid="trending-sounds-empty">
          {t("feed.soundsEmpty")}
        </p>
      ) : (
        <ol className="flex flex-col gap-5">
          {sounds.map((sound) => (
            <li
              key={sound.key}
              className="flex min-w-0 flex-col gap-2"
              data-testid="trending-sound"
              data-label={sound.label}
              data-posts={sound.posts}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-bold" dir="auto">
                  {sound.title}
                </span>
                {sound.artist && (
                  <span className="text-ink-2 text-sm" dir="auto">
                    {sound.artist}
                  </span>
                )}
                <span className="px-chip text-[10px]">
                  {t(
                    sound.label === "trending"
                      ? "feed.soundsTrending"
                      : sound.label === "emerging"
                        ? "feed.soundsEmerging"
                        : "feed.soundsSeen",
                  )}
                </span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                {PLATFORMS.filter((platform) => sound.platforms[platform]).map((platform) => (
                  <span
                    key={platform}
                    className={`px-chip text-[10px] ${PLATFORM_META[platform].chip}`}
                  >
                    {PLATFORM_META[platform].glyph} {PLATFORM_META[platform].label}{" "}
                    {sound.platforms[platform]}
                  </span>
                ))}
                <span className="text-muted">
                  {t(sound.categories === 1 ? "feed.soundsStatsOne" : "feed.soundsStats", {
                    posts: sound.posts,
                    categories: sound.categories,
                    date: new Date(sound.latest).toLocaleDateString(lang),
                  })}
                </span>
              </div>
              {(sound.urls.ig || sound.urls.tt) && (
                <div className="flex flex-wrap gap-x-4 text-xs">
                  {(["ig", "tt"] as const).map(
                    (platform) =>
                      sound.urls[platform] && (
                        <a
                          key={platform}
                          className="px-link"
                          href={sound.urls[platform]}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("feed.soundsOpen", { platform: PLATFORM_META[platform].label })} ↗
                        </a>
                      ),
                  )}
                </div>
              )}
              <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-3">
                {dropHiddenEditors(sound.examples, hidden).items.map((item) => (
                  <ResultCard
                    key={item.url}
                    item={item}
                    visualFeed
                    collapseDuplicateSnippet
                    testId="trending-sound-example"
                    action={renderAction?.(item)}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
