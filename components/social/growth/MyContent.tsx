"use client";

import { Download, FileUp } from "lucide-react";
import { useMemo, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Card from "@/components/ui/ios/Card";
import { ListGroup } from "@/components/ui/ios/List";
import { postStatsToCsv, topPostsThisWeek } from "@/lib/analytics";
import { PLATFORMS, type SocialPostStat } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PlatformGlyph } from "@/lib/platformIcons";
import { PLATFORM_META } from "@/lib/social";
import { useStore } from "@/store";
import type { AnalyticsFilter } from "./PlatformFilter";
import PostCard from "./PostCard";

const SEARCH_LIMIT = 24;

/**
 * The Beacons Home → My Content block, at the bottom of both views: top posts this week (views, then likes,
 * comments, shares; stories excluded) as a grouped list, a search over the imported posts with platform chips and
 * its own list of rows, Download CSV and Import.
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
    <section className="flex flex-col gap-3" data-testid="my-content" data-count={stats.length}>
      <header className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-base">{t("growth.content.title")}</h2>
          <p className="text-ink-2 text-[13px]">{t("growth.content.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={exportCsv}
            disabled={stats.length === 0}
            data-testid="content-export"
          >
            <Download size={16} strokeWidth={1.75} aria-hidden />
            {t("growth.content.export")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={onImport}
            data-testid="content-import"
          >
            <FileUp size={16} strokeWidth={1.75} aria-hidden />
            {t("growth.content.import")}
          </button>
        </div>
      </header>

      {stats.length === 0 ? (
        <Card className="flex flex-col gap-2" testId="content-empty">
          <h3 className="text-[17px] font-semibold">{t("growth.content.empty.title")}</h3>
          <p className="text-ink-2 text-sm">{t("growth.content.empty.body")}</p>
          <p className="text-muted text-xs">{t("growth.content.empty.where")}</p>
          <button
            type="button"
            className="px-btn mt-1 self-start"
            onClick={onImport}
            data-testid="content-empty-import"
          >
            <FileUp size={18} strokeWidth={1.75} aria-hidden />
            {t("growth.content.import")}
          </button>
        </Card>
      ) : (
        <>
          {/* Top posts this week */}
          <ListGroup
            header={t("growth.content.top")}
            listAs="ul"
            testId="content-top"
            data-count={top.length}
          >
            {top.length === 0 ? (
              <li className="ios-row text-ink-2 text-sm" data-sep="16">
                {t("growth.content.topEmpty")}
              </li>
            ) : (
              top.map((p) => (
                <PostCard key={`${p.platform}:${p.postId}`} post={p} testId="top-post" />
              ))
            )}
          </ListGroup>

          {/* Search: a field and chips on the page ground, the results as their own list. */}
          <section className="flex flex-col gap-2" data-testid="content-search-block">
            <h3 className="ios-gh text-[13px]">{t("growth.content.search")}</h3>
            <input
              type="search"
              className="px-input bg-panel"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("growth.content.searchPlaceholder")}
              aria-label={t("growth.content.search")}
              data-testid="content-search"
            />
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("growth.filter.aria")}>
              <button
                type="button"
                className="px-fchip"
                aria-pressed={active === "all"}
                onClick={() => setChip("all")}
                data-testid="content-platform-all"
              >
                {t("growth.filter.all")}
              </button>
              {platformsWithPosts.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="px-fchip"
                  aria-pressed={active === p}
                  onClick={() => setChip(p)}
                  data-testid={`content-platform-${p}`}
                >
                  <PlatformGlyph platform={p} size={14} className="shrink-0" />
                  {L(PLATFORM_META[p].name)}
                </button>
              ))}
            </div>
            <p
              className="num text-muted px-4 text-xs"
              data-testid="content-results"
              data-count={results.length}
            >
              {results.length === 0
                ? t("growth.content.noResults")
                : t("growth.content.results", { n: results.length })}
            </p>
            {results.length > 0 && (
              <ul className="ios-list">
                {results.map((p) => (
                  <PostCard
                    key={`${p.platform}:${p.postId}`}
                    post={p}
                    testId="content-post"
                    onRemove={() => setRemoving(p)}
                  />
                ))}
              </ul>
            )}
          </section>
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
