"use client";

import { FileUp, Link2, LoaderCircle, Plus, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCelebrate } from "@/components/celebrate/CelebrationProvider";
import { useToday } from "@/components/today/useToday";
import EmptyState from "@/components/ui/ios/EmptyState";
import PageHeader from "@/components/ui/ios/PageHeader";
import { useFirstVisit } from "@/components/ui/ios/useFirstVisit";
import { useSocialSync } from "@/components/social/useSocialSync";
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
import TikTokBrief from "./growth/TikTokBrief";
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
  /** The numbers count up and the charts draw themselves on the first visit of this page load only. */
  const first = useFirstVisit("growth");
  const state = useStore(useShallow(analyticsState));
  const demographics = useStore((s) => s.demographics);
  const [filter, setFilter] = useState<AnalyticsFilter>("all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [changed, setChanged] = useState(false);
  const [topEngagement, setTopEngagement] = useState(false);
  const { toast } = useCelebrate();
  const sync = useSocialSync({ auto: true });
  const anyConnected =
    sync.status !== null && Object.values(sync.status).some((s) => s?.connected === true);
  const onSync = async () => {
    const r = await sync.syncNow();
    if (r.ok) toast("notice", { icon: "🔄", name: t("social.toast.synced") });
  };

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
    <div className="flex flex-col gap-3" data-testid="growth-screen" data-tab={filter}>
      <PageHeader title={t("social.growth.title")} sub={t("social.growth.sub")} />
      <div className="flex flex-wrap gap-2">
        {sync.configured && (
          <button
            type="button"
            className="px-btn px-btn-ghost px-btn-sm"
            onClick={onSync}
            disabled={sync.busy}
            aria-busy={sync.busy}
            data-testid="growth-sync"
          >
            {sync.busy ? (
              <>
                <LoaderCircle size={16} strokeWidth={1.75} className="ios-spin" aria-hidden />
                {t("growth.sync.busy")}
              </>
            ) : (
              t("growth.sync.button")
            )}
          </button>
        )}
        <button
          type="button"
          className="px-btn px-btn-sm"
          onClick={() => setDialog("add")}
          data-testid="growth-add"
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          {t("growth.add")}
        </button>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm"
          onClick={() => setDialog("import")}
          data-testid="growth-import"
        >
          <FileUp size={16} strokeWidth={1.75} aria-hidden />
          {t("growth.import")}
        </button>
      </div>

      <PlatformFilter value={filter} onChange={setFilter} />

      {/* The filter's tab panel: focusable (APG tabs), so the view under the tabs is one stop away. */}
      <div
        role="tabpanel"
        id={`gr-panel-${filter}`}
        aria-labelledby={`gr-tab-${filter}`}
        tabIndex={0}
        className={`${first ? "ios-stagger" : ""} flex flex-col gap-3`}
      >
        {filter === "all" && !anyConnected && (
          <section
            className="ios-card flex flex-wrap items-center gap-3"
            data-testid="growth-connect-cta"
          >
            <span className="ios-ic self-start">
              <Link2 size={20} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
              <h2 className="text-base">{t("growth.sync.cta.title")}</h2>
              <p className="text-ink-2 text-sm">{t("growth.sync.cta.body")}</p>
              {sync.error && (
                <p role="alert" className="text-danger text-xs" data-testid="growth-sync-error">
                  {t(sync.error)}
                </p>
              )}
            </div>
            <Link
              href="/settings/#accounts"
              className="px-btn no-underline"
              data-testid="growth-connect-link"
            >
              {t("growth.sync.cta.button")}
            </Link>
          </section>
        )}

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
            className="ios-card flex items-start gap-2 text-sm"
            data-testid="analytics-engagement-text"
            data-platform={best?.platform ?? ""}
          >
            <Sparkles
              size={16}
              strokeWidth={1.75}
              className="text-tint mt-0.5 shrink-0"
              aria-hidden
            />
            <span>{bestText}</span>
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
            animate={first}
          />
        ) : all.platforms.length === 0 ? (
          <div className="ios-list">
            <EmptyState
              icon={<TrendingUp size={24} strokeWidth={1.75} aria-hidden />}
              title={t("growth.empty.title")}
              hint={t("growth.empty.body")}
              action={
                <div className="flex flex-col items-center gap-3">
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      className="px-btn"
                      onClick={() => setDialog("add")}
                      data-testid="empty-add"
                    >
                      <Plus size={18} strokeWidth={1.75} aria-hidden />
                      {t("growth.add")}
                    </button>
                    <button
                      type="button"
                      className="px-btn px-btn-ghost"
                      onClick={() => setDialog("import")}
                      data-testid="empty-import"
                    >
                      <FileUp size={18} strokeWidth={1.75} aria-hidden />
                      {t("growth.import")}
                    </button>
                  </div>
                  <p className="text-muted max-w-[36ch] text-xs">{t("growth.empty.where")}</p>
                </div>
              }
              testId="growth-empty"
            />
          </div>
        ) : (
          <>
            <KpiRow all={all} countUp={first} />
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

        {(filter === "all" || filter === "tiktok") && <TikTokBrief now={now} />}

        <AudienceAsks platform={platform} />
      </div>

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
