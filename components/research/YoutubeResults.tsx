"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Lang } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import {
  youtubeErrorMessageKey,
  youtubeSearch,
  type YoutubeSearchError,
  type YoutubeVideo,
} from "@/lib/research";
import { getApiKey, useStore } from "@/store";

/** One fetch's outcome, tagged with the query it answers (so a stale result never renders as fresh). */
type Result =
  | { for: string; status: "ok"; items: YoutubeVideo[] }
  | { for: string; status: "error"; error: YoutubeSearchError };

/**
 * In-app YouTube results for a query (Scout v0, build plan 1.13): thumbnail, title, channel, an "open"
 * link, and a caller-supplied action per result (add as reference, or attach to a skill). Shows a one-line
 * hint linking to Settings instead when the owner hasn't stored a YouTube Data API key.
 */
export default function YoutubeResults({
  query,
  lang,
  renderAction,
}: {
  query: string;
  lang: Lang;
  renderAction: (video: YoutubeVideo) => ReactNode;
}) {
  const { t } = useT();
  const apiKey = useStore((s) => getApiKey(s, "youtube"));
  const hasQuery = query.trim().length > 0;
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!apiKey || !hasQuery) return;
    let alive = true;
    youtubeSearch(apiKey, query, { relevanceLanguage: lang }).then((r) => {
      if (!alive) return;
      setResult(
        r.ok
          ? { for: query, status: "ok", items: r.items }
          : { for: query, status: "error", error: r.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [apiKey, hasQuery, query, lang]);

  if (!apiKey || !hasQuery) {
    return (
      <p className="text-ink-2 text-sm" data-testid="yt-no-key">
        {t("research.noKey")}{" "}
        <Link href="/settings/" className="px-link">
          {t("research.noKeyLink")}
        </Link>
      </p>
    );
  }
  if (!result || result.for !== query) {
    return (
      <p className="text-muted text-sm" data-testid="yt-loading">
        {t("research.loading")}
      </p>
    );
  }
  if (result.status === "error") {
    return (
      <p className="text-danger text-sm" role="alert" data-testid="yt-error">
        {t(youtubeErrorMessageKey(result.error))}
      </p>
    );
  }
  if (result.items.length === 0) {
    return (
      <p className="text-muted text-sm" data-testid="yt-empty">
        {t("research.noResults")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="yt-results">
      {result.items.map((v) => (
        <li key={v.videoId} className="px-inset flex gap-2" data-testid="yt-result">
          {/* External thumbnail; static export has no image optimizer for it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={v.thumb}
            alt=""
            width={96}
            height={54}
            className="h-[54px] w-[96px] shrink-0 rounded-[2px] bg-[var(--panel-3)] object-cover"
          />
          <div className="min-w-0 flex-1">
            <a
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-link block truncate text-sm font-bold"
            >
              {v.title}
            </a>
            <span className="text-muted block truncate text-xs">{v.channel}</span>
            {renderAction(v)}
          </div>
        </li>
      ))}
    </ul>
  );
}
