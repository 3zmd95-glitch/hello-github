"use client";

import type { CSSProperties } from "react";
import { formatDayShort } from "@/components/planner/weekLabel";
import { PLATFORMS, type AudienceAsk, type Platform, type SocialSnapshot } from "@/lib/domain";
import { bestPlatform, latestSnapshot, series, snapshotDelta, topAsks, totals } from "@/lib/growth";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import Delta from "./Delta";
import LineChart, { ChartLegend, type ChartSeries } from "./LineChart";
import { fmtCount, fmtEngagement, fmtPct, fmtSigned } from "./format";

/** The "All" tab: totals, per-platform rows, best grower, the followers chart and the top asks. */
export default function AllTab({
  snapshots,
  asks,
  today,
  onOpenPlatform,
  onAdd,
  onImport,
}: {
  snapshots: readonly SocialSnapshot[];
  asks: readonly AudienceAsk[];
  today: string;
  onOpenPlatform: (p: Platform) => void;
  onAdd: () => void;
  onImport: () => void;
}) {
  const { t, L, lang } = useT();
  const sum = totals(snapshots);
  const best = bestPlatform(snapshots);
  const top = topAsks(asks, 3);

  const chartSeries: ChartSeries[] = PLATFORMS.flatMap((p) => {
    const pts = series(snapshots, p, 90, today);
    if (pts.length === 0) return [];
    return [
      {
        id: p,
        label: L(PLATFORM_META[p].name),
        short: PLATFORM_META[p].short,
        color: PLATFORM_META[p].color,
        points: pts.map((x) => ({ day: x.day, value: x.followers })),
      },
    ];
  });

  if (snapshots.length === 0) {
    return (
      <section className="px-card flex flex-col gap-3" data-testid="growth-empty">
        <h2 className="text-lg">{t("growth.empty.title")}</h2>
        <p className="text-ink-2 text-sm">{t("growth.empty.body")}</p>
        <p className="text-muted text-xs">{t("growth.empty.where")}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-btn" onClick={onAdd} data-testid="empty-add">
            ➕ {t("growth.add")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost"
            onClick={onImport}
            data-testid="empty-import"
          >
            📄 {t("growth.import")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label={t("growth.followers")} testId="total-followers" value={sum.followers}>
          <b className="gr-value">{fmtCount(sum.followers)}</b>
        </Tile>
        <Tile label={t("growth.views30")} testId="total-views" value={sum.views30d}>
          <b className="gr-value">{fmtCount(sum.views30d)}</b>
        </Tile>
        <Tile label={t("growth.engagementAvg")} testId="total-engagement">
          <b className="gr-value">{fmtEngagement(sum.engagementPct)}</b>
        </Tile>
        <Tile
          label={t("growth.platformsReporting")}
          testId="total-platforms"
          value={sum.platforms.length}
        >
          <b className="gr-value">
            {sum.platforms.length}
            <span className="text-muted text-base font-normal">/{PLATFORMS.length}</span>
          </b>
          <span className="flex gap-1" aria-hidden>
            {sum.platforms.map((p) => (
              <span key={p} className="text-sm leading-none">
                {PLATFORM_META[p].icon}
              </span>
            ))}
          </span>
        </Tile>
      </div>

      {/* Best growing platform */}
      {best ? (
        <button
          type="button"
          className="px-inset gr-best flex items-center gap-3 text-start"
          onClick={() => onOpenPlatform(best.platform)}
          data-testid="best-platform"
          data-platform={best.platform}
          style={{ "--c": PLATFORM_META[best.platform].color } as CSSProperties}
        >
          <span aria-hidden className="text-2xl leading-none">
            {PLATFORM_META[best.platform].icon}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-muted text-xs">{t("growth.best.label")}</span>
            <span className="text-sm font-bold">
              {t("growth.best.body", {
                platform: L(PLATFORM_META[best.platform].name),
                n: fmtSigned(best.followers),
                pct: best.followersPct === null ? "" : ` (${fmtPct(best.followersPct)})`,
              })}
            </span>
          </span>
          <span aria-hidden className="text-muted ms-auto rtl:rotate-180">
            ›
          </span>
        </button>
      ) : (
        <p className="text-muted text-xs" data-testid="best-pending">
          {t("growth.best.pending")}
        </p>
      )}

      {/* Per-platform rows */}
      <section className="px-card flex flex-col gap-2" data-testid="platform-table">
        <h2 className="text-base">{t("growth.byPlatform")}</h2>
        <div className="gr-rows" role="table" aria-label={t("growth.byPlatform")}>
          <div className="gr-row gr-row-head" role="row">
            <span role="columnheader">{t("growth.col.platform")}</span>
            <span role="columnheader">{t("growth.followers")}</span>
            <span role="columnheader">{t("growth.col.delta30")}</span>
            <span role="columnheader">{t("growth.views30")}</span>
            <span role="columnheader">{t("growth.col.updated")}</span>
          </div>
          {PLATFORMS.map((p) => {
            const meta = PLATFORM_META[p];
            const latest = latestSnapshot(snapshots, p);
            const d = snapshotDelta(snapshots, p, 30);
            return (
              <div
                key={p}
                className="gr-row"
                role="row"
                data-testid="platform-row"
                data-platform={p}
                data-has-data={!!latest}
                style={{ "--c": meta.color } as CSSProperties}
              >
                <button
                  type="button"
                  role="cell"
                  className="gr-cell-name text-start"
                  onClick={() => onOpenPlatform(p)}
                  aria-label={t("growth.openPlatform", { platform: L(meta.name) })}
                >
                  <i className="gr-key" aria-hidden />
                  <span aria-hidden>{meta.icon}</span>
                  <span className="font-semibold">{L(meta.name)}</span>
                </button>
                <span role="cell" className="gr-cell" data-label={t("growth.followers")}>
                  <b className="num">{latest ? fmtCount(latest.followers) : "–"}</b>
                </span>
                <span role="cell" className="gr-cell" data-label={t("growth.col.delta30")}>
                  <Delta
                    value={d.followers}
                    pct={d.followersPct}
                    pending={latest ? t("growth.delta.pending") : "–"}
                    testId="platform-delta"
                  />
                </span>
                <span role="cell" className="gr-cell" data-label={t("growth.views30")}>
                  <b className="num">{latest ? fmtCount(latest.views30d) : "–"}</b>
                </span>
                <span role="cell" className="gr-cell" data-label={t("growth.col.updated")}>
                  {latest ? (
                    <span className="num text-ink-2 text-xs">
                      {formatDayShort(latest.day, lang)}
                    </span>
                  ) : (
                    <span className="text-muted text-xs">{t("growth.noData")}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Followers chart */}
      <section className="px-card flex flex-col gap-2" data-testid="all-chart">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base">{t("growth.chart.followers")}</h2>
          <span className="text-muted text-xs">{t("growth.chart.days90")}</span>
        </div>
        <ChartLegend series={chartSeries} />
        <LineChart
          series={chartSeries}
          today={today}
          title={t("growth.chart.followersAria")}
          testId="growth-chart"
        />
      </section>

      {/* What people want */}
      {top.length > 0 && (
        <section className="px-card flex flex-col gap-2" data-testid="top-asks">
          <h2 className="text-base">{t("growth.asks.top")}</h2>
          <ol className="flex flex-col gap-1.5">
            {top.map((a, i) => (
              <li
                key={a.id}
                className="flex items-center gap-2 text-sm"
                data-testid="top-ask"
                data-id={a.id}
              >
                <span className="num text-muted w-4 shrink-0 text-xs">{i + 1}</span>
                <span className="min-w-0 flex-1 break-words">{a.text}</span>
                <span className="px-chip num" data-testid="top-ask-count">
                  ×{a.count}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Tile({
  label,
  testId,
  value,
  children,
}: {
  label: string;
  testId: string;
  value?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="px-inset flex min-w-0 flex-col gap-1" data-testid={testId} data-value={value}>
      <span className="text-muted text-xs">{label}</span>
      {children}
    </div>
  );
}
