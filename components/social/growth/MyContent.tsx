"use client";

import { useMemo, useState, type CSSProperties } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { postStatsToCsv, topPostsThisWeek } from "@/lib/analytics";
import { PLATFORMS, type SocialPostStat } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";
import type { AnalyticsFilter } from "./PlatformFilter";
import PostCard from "./PostCard";

const SEARCH_LIMIT = 24;

/**
 * Beacons' Home → My Content, at the bottom of both views: top posts this week (views, then likes, comments,
 * shares; stories excluded), a search over the imported posts with platform chips, Download CSV and Import.
 */
export default function MyContent({
  stats,
  filter,
  now,
  today,
  onImport,
}: {
  stats: readonly SocialPostStat[];
  filter: AnalyticsFilter;
  now: number;
  today: string;
  onImport: () => void;
}) {
  const { t, L } = useT();
  const removePostStat = useStore((s) => s.removePostStat);
  const [query, setQuery] = useState("");
  /** null = follow the page filter; a chip pins one platform (or all). */
  const [chip, setChip] = useState<AnalyticsFilter | null>(null);
  const [removing, setRemoving] = useState<SocialPostStat | null>(null);
  const active: AnalyticsFilter = chip ?? filter;

  const top = useMemo(() => topPostsThisWeek(stats, now, 6), [stats, now]);
  const platformsWithPosts = useMemo(
    () => PLATFORMS.filter((p) => stats.some((s) => s.platform === p)),
    [stats],
  );
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stats
      .filter(
        (p) =>
          (active === "all" || p.platform === active) &&
          (!q || (p.title ?? "").toLowerCase().includes(q) || p.postId.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, SEARCH_LIMIT);
  }, [stats, active, query]);

  const exportCsv = () => {
    const blob = new Blob([postStatsToCsv(stats)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `3z-posts-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section
      className="px-card flex flex-col gap-4"
      data-testid="my-content"
      data-count={stats.length}
    >
      <header className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-lg">{t("growth.content.title")}</h2>
          <p className="text-muted text-xs">{t("growth.content.sub")}</p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={exportCsv}
            disabled={stats.length === 0}
            data-testid="content-export"
          >
            ⬇️ {t("growth.content.export")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={onImport}
            data-testid="content-import"
          >
            📄 {t("growth.content.import")}
          </button>
        </div>
      </header>

      {stats.length === 0 ? (
        <div className="px-inset flex flex-col gap-2" data-testid="content-empty">
          <h3 className="text-base">{t("growth.content.empty.title")}</h3>
          <p className="text-ink-2 text-sm">{t("growth.content.empty.body")}</p>
          <p className="text-muted text-xs">{t("growth.content.empty.where")}</p>
          <button
            type="button"
            className="px-btn self-start"
            onClick={onImport}
            data-testid="content-empty-import"
          >
            📄 {t("growth.content.import")}
          </button>
        </div>
      ) : (
        <>
          {/* Top posts this week */}
          <div className="flex flex-col gap-2" data-testid="content-top" data-count={top.length}>
            <h3 className="text-base">{t("growth.content.top")}</h3>
            {top.length === 0 ? (
              <p className="text-ink-2 text-sm">{t("growth.content.topEmpty")}</p>
            ) : (
              <div className="an-posts">
                {top.map((p) => (
                  <PostCard key={`${p.platform}:${p.postId}`} post={p} testId="top-post" />
                ))}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="flex flex-col gap-2" data-testid="content-search-block">
            <h3 className="text-base">{t("growth.content.search")}</h3>
            <input
              type="search"
              className="px-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("growth.content.searchPlaceholder")}
              aria-label={t("growth.content.search")}
              data-testid="content-search"
            />
            <div className="gr-tabs" role="group" aria-label={t("growth.filter.aria")}>
              <button
                type="button"
                className="gr-tab"
                aria-pressed={active === "all"}
                onClick={() => setChip("all")}
                data-testid="content-platform-all"
                style={{ "--c": "var(--accent)" } as CSSProperties}
              >
                {t("growth.filter.all")}
              </button>
              {platformsWithPosts.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="gr-tab"
                  aria-pressed={active === p}
                  onClick={() => setChip(p)}
                  data-testid={`content-platform-${p}`}
                  style={{ "--c": PLATFORM_META[p].color } as CSSProperties}
                >
                  <span aria-hidden>{PLATFORM_META[p].icon}</span> {L(PLATFORM_META[p].name)}
                </button>
              ))}
            </div>
            <p
              className="num text-muted text-xs"
              data-testid="content-results"
              data-count={results.length}
            >
              {results.length === 0
                ? t("growth.content.noResults")
                : t("growth.content.results", { n: results.length })}
            </p>
            {results.length > 0 && (
              <div className="an-posts">
                {results.map((p) => (
                  <PostCard
                    key={`${p.platform}:${p.postId}`}
                    post={p}
                    testId="content-post"
                    onRemove={() => setRemoving(p)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {removing && (
        <ConfirmDialog
          title={t("growth.content.removeTitle")}
          body={t("growth.content.removeBody", {
            title: removing.title?.trim() || removing.postId,
          })}
          confirmLabel={t("growth.content.remove")}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            removePostStat(removing.platform, removing.postId);
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}
