"use client";

import { useEffect, useMemo, useState } from "react";
import { discoverForYou } from "@/lib/discoverForYou";
import { editFormatQuery, formatIdentity, type EditFormat } from "@/lib/editFormats";
import { dropHiddenEditors, hiddenEditorsFor } from "@/lib/editorFilter";
import { cachedTrendingEffects, fetchTrendingEffects, type TrendingEffects } from "@/lib/effects";
import { useT } from "@/lib/i18n";
import type { ScoutConfig } from "@/lib/scoutClient";
import {
  localTrendingEdits,
  mergeTrendingEdits,
  postCounts,
  workerScanDay,
  workerTrendingEdits,
} from "@/lib/trendingEdits";
import { useStore } from "@/store";
import { PLATFORM_META, ResultPreview } from "./ResultCard";

/**
 * Discover Browse, first section: editing techniques many editors posted recently, each with its proof (creators,
 * categories, first → last day) and dated examples. Zero credits: the posts Discover already read and the daily
 * scan's cached `GET /effects/trending` (no Worker, no request); nothing here runs a scan.
 */
export default function TrendingEdits({
  config,
  onPick,
}: {
  config: ScoutConfig | null;
  /** Learn this edit / Find examples: a format's own exact search when the row is a format. */
  onPick: (query: string, intent: "examples" | "tutorials", format?: EditFormat) => void;
}) {
  const { t, lang } = useT();
  const candidates = useStore((s) => s.discoverCandidates);
  const followed = useStore((s) => s.followedFormats);
  const follow = useStore((s) => s.followFormat);
  const unfollow = useStore((s) => s.unfollowFormat);
  const hidden = useStore((s) => hiddenEditorsFor(s.settings.discover.editorScope));
  // Captured once, like the panel's: the windows need no ticking clock.
  const [now] = useState(() => Date.now());
  const [effects, setEffects] = useState<TrendingEffects | null>(() =>
    config ? cachedTrendingEffects(config) : null,
  );
  useEffect(() => {
    if (!config) return;
    let live = true;
    void fetchTrendingEffects(config).then((data) => {
      if (live) setEffects(data);
    });
    return () => {
      live = false;
    };
  }, [config]);
  const local = useMemo(
    // Explore: every eligible post, smaller editors too (owner: "all editors were doing it").
    () =>
      localTrendingEdits(
        discoverForYou(candidates, { mode: "explore", limit: 500, now }).rows,
        now,
      ),
    [candidates, now],
  );
  const data = config ? effects : null;
  const edits = useMemo(
    () => mergeTrendingEdits([local, workerTrendingEdits(data, now)]),
    [local, data, now],
  );
  // A row whose every example is another editor's (Settings: my editors only) is not shown; a row with no
  // example at all (the daily scan sent none) stays, with its buttons.
  const shown = edits.flatMap((edit) => {
    const examples = dropHiddenEditors(edit.examples, hidden).items;
    return examples.length || !edit.examples.length ? [{ edit, examples }] : [];
  });
  const counts = useMemo(() => postCounts(candidates, now), [candidates, now]);
  const scanDay = workerScanDay(data, now);
  const formats = new Map(
    [...followed.map((entry) => entry.format), ...(data?.formats ?? [])].map((format) => [
      formatIdentity(format),
      format,
    ]),
  );
  const saved = new Set(followed.map((entry) => formatIdentity(entry.format)));
  const day = (date: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", {
      day: "numeric",
      month: "short",
      calendar: "gregory",
      timeZone: "UTC",
    }).format(new Date(date));

  return (
    <details open className="border-edge @container border-b pb-3" data-testid="trending-edits">
      <summary className="w-fit cursor-pointer text-base font-bold">
        {t("feed.edits.title")}
      </summary>
      <p className="text-muted my-2 text-xs">{t("feed.edits.honest")}</p>
      {!shown.length ? (
        <p className="text-ink-2 text-sm" data-testid="trending-edits-empty">
          {t("feed.edits.empty")}
        </p>
      ) : (
        <ol className="flex flex-col gap-5">
          {shown.map(({ edit, examples }) => {
            const format = edit.formatKey ? formats.get(edit.formatKey) : undefined;
            const isFollowed = !!format && saved.has(edit.formatKey!);
            const name = lang === "ar" ? (edit.name.ar ?? edit.name.en) : edit.name.en;
            return (
              <li
                key={edit.key}
                className="flex min-w-0 flex-col gap-2"
                data-testid="trending-edit"
                data-key={edit.key}
                data-tier={edit.tier}
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-bold break-words" dir="auto">
                    {name}
                  </span>
                  <span className="px-chip text-[10px]">
                    {t(edit.tier === "trending" ? "feed.edits.trending" : "feed.edits.emerging")}
                  </span>
                  {edit.rising && (
                    <span
                      className="px-chip bg-gold text-bg text-[10px]"
                      data-testid="trending-edit-rising"
                    >
                      <span aria-hidden>{t("feed.edits.rising")}</span>
                      <span className="sr-only">{t("feed.edits.risingHelp")}</span>
                    </span>
                  )}
                </div>
                <p className="text-muted text-xs" data-testid="trending-edit-proof">
                  {edit.categories
                    ? t(edit.scanCreators ? "feed.edits.proofBoth" : "feed.edits.proof", {
                        creators: edit.localCreators ?? edit.creators,
                        scan: edit.scanCreators ?? 0,
                        categories: edit.categories,
                        first: day(edit.firstSeen),
                        last: day(edit.lastSeen),
                      })
                    : // Only the daily scan counted it: its 7-day identified accounts, never "creators · categories".
                      t(edit.scanDated ? "feed.edits.proofScan" : "feed.edits.proofWorker", {
                        creators: edit.creators,
                        last: day(edit.lastSeen),
                      })}
                </p>
                {examples.length > 0 && (
                  <ul className="grid grid-cols-3 gap-2">
                    {examples.map((item) => (
                      <li
                        key={item.url}
                        className="min-w-0"
                        data-testid="trending-edit-example"
                        data-platform={item.platform}
                      >
                        <ResultPreview item={item} testId="trending-edit-preview" lookup={false} />
                        <p className="text-muted mt-1 truncate text-[11px]">
                          <span dir="ltr">{item.handle || PLATFORM_META[item.platform].label}</span>
                          {item.published && ` · ${day(item.published)}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="px-btn px-btn-sm"
                    onClick={() => onPick(edit.learnQuery, "tutorials", format)}
                    aria-label={`${t("formats.findTutorials")}: ${name}`}
                    data-testid="trending-edit-learn"
                  >
                    {t("formats.findTutorials")}
                  </button>
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm"
                    onClick={() =>
                      format
                        ? onPick(editFormatQuery(format, "examples"), "examples", format)
                        : onPick(edit.name.en, "examples", undefined)
                    }
                    aria-label={`${t("formats.primaryExamples")}: ${name}`}
                    data-testid="trending-edit-examples"
                  >
                    {t("formats.primaryExamples")}
                  </button>
                  {format && (
                    <button
                      type="button"
                      className={`px-chip min-h-8 ${isFollowed ? "bg-gold text-bg" : ""}`}
                      aria-pressed={isFollowed}
                      aria-label={`${t(isFollowed ? "formats.followed" : "formats.follow")}: ${name}`}
                      onClick={() =>
                        isFollowed ? unfollow(formatIdentity(format)) : follow(format)
                      }
                      data-testid="trending-edit-follow"
                    >
                      {t(isFollowed ? "formats.cardFollowing" : "formats.follow")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-muted mt-3 text-[11px]" data-testid="trending-edits-stats">
        {t(scanDay ? "feed.edits.stats" : "feed.edits.statsLocal", {
          posts: counts.posts,
          recent: counts.recent,
          scan: scanDay ? day(scanDay) : "",
        })}
      </p>
    </details>
  );
}
