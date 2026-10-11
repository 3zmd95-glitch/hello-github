"use client";

import { useLayoutEffect, useState } from "react";
import { categoryExpansionQuery } from "@/lib/discoverExpansion";
import type { Genre } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { platformSearchUrl, type ResearchTab } from "@/lib/research";
import type { ScoutConfig } from "@/lib/scoutClient";
import type { TikTokCountry } from "@/lib/tiktokAccess";
import { useCategoryRefresh } from "./useCategoryRefresh";

/** Explicit acquisition, separate from source checks and optional AI assessments. */
export default function CategoryRefreshAction({
  genre,
  tab,
  config,
  active,
  checking = false,
  disabled = false,
  onBusyChange,
}: {
  genre: Genre;
  tab: ResearchTab;
  config: ScoutConfig | null;
  active: boolean;
  checking?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useT();
  const [country, setCountry] = useState<TikTokCountry>("US");
  const queue = useCategoryRefresh({ genre, tab, config, country, active });
  useLayoutEffect(() => {
    onBusyChange?.(queue.busy);
    return () => onBusyChange?.(false);
  }, [queue.busy, onBusyChange]);
  const query = categoryExpansionQuery(genre, 0);
  if (!active) return null;
  return (
    <div
      className="border-edge flex min-w-0 flex-col gap-2 border-t pt-3 text-xs"
      data-testid="category-refresh"
    >
      <div className="flex flex-wrap items-center gap-2">
        {tab !== "ig" && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={disabled || queue.busy || !queue.canRun}
            onClick={() => void queue.run()}
            data-testid="category-refresh-run"
          >
            {t(
              queue.busy
                ? "refresh.running"
                : tab === "tt"
                  ? "refresh.tiktok"
                  : tab === "yt"
                    ? "refresh.youtube"
                    : "refresh.all",
            )}
          </button>
        )}
        {(tab === "all" || tab === "tt") && (
          <label className="flex flex-wrap items-center gap-2">
            {t("feed.tiktokRegion")}
            <select
              className="px-input max-w-full py-1 text-xs"
              value={country}
              onChange={(event) => setCountry(event.target.value as TikTokCountry)}
              data-testid="category-refresh-region"
            >
              <option value="SA">{t("feed.regionSA")}</option>
              <option value="US">{t("feed.regionUS")}</option>
            </select>
          </label>
        )}
        {queue.busy && (
          <button
            type="button"
            className="px-link"
            onClick={queue.cancel}
            data-testid="category-refresh-cancel"
          >
            {t("feed.tiktokAccessCancel")}
          </button>
        )}
        {(tab === "all" || tab === "ig") && query && (
          <a
            className={tab === "ig" ? "px-btn px-btn-sm w-fit" : "px-link"}
            href={platformSearchUrl("ig", query)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="category-refresh-instagram"
          >
            {t("refresh.instagram")}
          </a>
        )}
      </div>
      <p className="text-muted">
        {t(
          tab === "ig"
            ? "refresh.instagramHelp"
            : tab === "tt"
              ? "refresh.tiktokHelp"
              : "refresh.help",
        )}
      </p>
      {tab === "all" && <p className="text-muted">{t("refresh.instagramHelp")}</p>}
      {tab !== "ig" && !config && <p>{t("feed.tiktokAccessConfig")}</p>}
      {(tab === "all" || tab === "yt") && queue.youtubeExhausted && (
        <p>{t("refresh.youtubeDone")}</p>
      )}
      {(tab === "all" || tab === "tt") && queue.tiktokExhausted && <p>{t("refresh.tiktokDone")}</p>}
      {queue.outcome && (
        <div role="status" className="flex flex-col gap-1" data-testid="category-refresh-result">
          {queue.outcome.status === "cancelled" && <p>{t("feed.tiktokAccessCancelled")}</p>}
          <p>
            {t("refresh.retained", {
              returned: queue.outcome.returned,
              added: queue.outcome.added,
            })}
          </p>
          <p>
            {t("refresh.qualified", {
              inspiration: queue.outcome.inspiration,
              popular: queue.outcome.popular,
            })}
          </p>
          {checking && <p className="text-muted">{t("refresh.checking")}</p>}
          {queue.outcome.lanes
            .filter((lane) => lane.error && lane.error !== "cancelled")
            .map((lane) => (
              <p key={lane.platform}>
                {t(
                  lane.status === "done"
                    ? "refresh.partial"
                    : lane.error === "quota" || lane.error === "daily_cap"
                      ? "refresh.quota"
                      : "refresh.failed",
                  {
                    platform: lane.platform === "tt" ? "TikTok" : "YouTube",
                  },
                )}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
