"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useToday } from "@/components/today/useToday";
import { allOverview, platformOverview } from "@/lib/analytics";
import type { Platform } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { PLATFORM_META } from "@/lib/social";
import { analyticsState, useStore } from "@/store";
import AiButton from "./growth/AiButton";
import AudienceAsks from "./growth/AudienceAsks";
import CsvImport from "./growth/CsvImport";
import DemographicsForm from "./growth/DemographicsForm";
import KpiRow from "./growth/KpiRow";
import MyContent from "./growth/MyContent";
import PlatformCards from "./growth/PlatformCards";
import PlatformFilter, { type AnalyticsFilter } from "./growth/PlatformFilter";
import PlatformTab from "./growth/PlatformTab";
import PostActivity from "./growth/PostActivity";
import PostImport, { sourceForPlatform } from "./growth/PostImport";
import SnapshotForm from "./growth/SnapshotForm";
import WhatChanged from "./growth/WhatChanged";
import { formatDayShort } from "@/components/planner/weekLabel";
import { fmtEngagement } from "./growth/format";

type Dialog = "add" | "import" | "content" | "demo" | null;

/**
 * 📊 Social Analytics (round 27): the Beacons "Social Analytics" page rebuilt from the handover. One page,
 * driven by the platform filter: the "All" view shows the KPI row, one card per connected platform and the
 * Post Activity counters; a platform shows its Overview, Demographics, Post Activity, account and history.
 * My Content (top posts, search, CSV) and the audience asks sit at the bottom of both. Numbers come from
 * snapshots, imported posts and manual demographics through lib/analytics; the Sep 27, 2026 Beacons
 * numbers are seeded once by the shell (data/social-seed).
 */
export default function GrowthScreen() {
  const { t, L, lang } = useT();
  const today = useToday();
  /** End of the Riyadh day: the windows (7 / 30 / 90 days) then cover whole days and stay stable all day. */
  const now = useMemo(() => Date.parse(`${today}T23:59:59+03:00`), [today]);
  const state = useStore(useShallow(analyticsState));
  const demographics = useStore((s) => s.demographics);
  const [filter, setFilter] = useState<AnalyticsFilter>("all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [changed, setChanged] = useState(false);
  const [topEngagement, setTopEngagement] = useState(false);

  const platform: Platform | undefined = filter === "all" ? undefined : filter;
  const all = useMemo(() => allOverview(state, now), [state, now]);
  const overview = useMemo(
    () => (platform ? platformOverview(state, platform, now) : null),
    [state, platform, now],
  );
  const best = all.platforms
    .filter((o) => o.metrics.engagement !== null)
    .sort((a, b) => (b.metrics.engagement ?? 0) - (a.metrics.engagement ?? 0))[0];
  const bestText = best
    ? t("growth.ai.topEngagement.text", {
        platform: L(PLATFORM_META[best.platform].name),
        pct: fmtEngagement(best.metrics.engagement),
        source:
          best.sources.engagement === "posts"
            ? t("growth.source.posts", { n: best.sample })
            : t("growth.source.snapshot", {
                day: best.snapshot ? formatDayShort(best.snapshot.day, lang) : "–",
              }),
      })
    : t("growth.ai.topEngagement.none");

  return (
    <div className="flex flex-col gap-4" data-testid="growth-screen" data-tab={filter}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl">{t("social.growth.title")}</h1>
          <p className="text-ink-2 text-sm">{t("social.growth.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => setDialog("add")}
            data-testid="growth-add"
          >
            ➕ {t("growth.add")}
          </button>
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={() => setDialog("import")}
            data-testid="growth-import"
          >
            📄 {t("growth.import")}
          </button>
        </div>
      </header>

      <PlatformFilter value={filter} onChange={setFilter} />

      <div className="flex flex-wrap gap-2">
        <AiButton
          testId="analytics-changed"
          pressed={changed}
          onClick={() => setChanged((v) => !v)}
        >
          {t("growth.changed.button")}
        </AiButton>
        {filter === "all" && (
          <AiButton
            testId="analytics-engagement"
            pressed={topEngagement}
            onClick={() => setTopEngagement((v) => !v)}
          >
            {t("growth.ai.topEngagement.button")}
          </AiButton>
        )}
      </div>
      {changed && <WhatChanged snapshots={state.snapshots} now={now} />}
      {topEngagement && filter === "all" && (
        <p
          className="px-card an-ai-card text-sm"
          data-testid="analytics-engagement-text"
          data-platform={best?.platform ?? ""}
        >
          <span aria-hidden>✨</span> {bestText}
        </p>
      )}

      {platform && overview ? (
        <PlatformTab
          key={platform}
          platform={platform}
          today={today}
          overview={overview}
          demographics={demographics}
          onAddDemographics={() => setDialog("demo")}
        />
      ) : all.platforms.length === 0 ? (
        <section className="px-card flex flex-col gap-3" data-testid="growth-empty">
          <h2 className="text-lg">{t("growth.empty.title")}</h2>
          <p className="text-ink-2 text-sm">{t("growth.empty.body")}</p>
          <p className="text-muted text-xs">{t("growth.empty.where")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-btn"
              onClick={() => setDialog("add")}
              data-testid="empty-add"
            >
              ➕ {t("growth.add")}
            </button>
            <button
              type="button"
              className="px-btn px-btn-ghost"
              onClick={() => setDialog("import")}
              data-testid="empty-import"
            >
              📄 {t("growth.import")}
            </button>
          </div>
        </section>
      ) : (
        <>
          <KpiRow all={all} />
          <PlatformCards platforms={all.platforms} onOpen={setFilter} />
          <PostActivity
            title={t("growth.activity.title")}
            counts={all.posts}
            rows={all.platforms}
            note={t("growth.activity.note")}
          />
        </>
      )}

      <MyContent
        stats={state.postStats}
        filter={filter}
        now={now}
        today={today}
        onImport={() => setDialog("content")}
      />

      <AudienceAsks platform={platform} />

      {dialog === "add" && (
        <SnapshotForm platform={platform} today={today} onClose={() => setDialog(null)} />
      )}
      {dialog === "import" && <CsvImport onClose={() => setDialog(null)} />}
      {dialog === "content" && (
        <PostImport source={sourceForPlatform(platform)} onClose={() => setDialog(null)} />
      )}
      {dialog === "demo" && (
        <DemographicsForm platform={platform} today={today} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
