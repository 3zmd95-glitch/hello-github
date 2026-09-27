"use client";

import Link from "next/link";
import { useState, type CSSProperties, type FormEvent } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatDayShort } from "@/components/planner/weekLabel";
import type { PlatformOverview } from "@/lib/analytics";
import type { Demographic, Platform, Post, PostStage } from "@/lib/domain";
import { engagementOf, series } from "@/lib/growth";
import { useT, type MessageKey } from "@/lib/i18n";
import { PLATFORM_META, postsForWeek } from "@/lib/social";
import { weekKey } from "@/lib/streak";
import { accountFor, useStore } from "@/store";
import AiButton from "./AiButton";
import Demographics, { hasDemographics } from "./Demographics";
import LineChart, { type ChartSeries } from "./LineChart";
import PostActivity from "./PostActivity";
import SourceBadge from "./SourceBadge";
import SourceHint from "./SourceHint";
import { contentTip } from "./contentTip";
import { fmtCount, fmtEngagement, fmtMetric, profileUrl } from "./format";

const STAGE_KEY: Record<PostStage, MessageKey> = {
  idea: "growth.stage.idea",
  script: "growth.stage.script",
  filmed: "growth.stage.filmed",
  edited: "growth.stage.edited",
  scheduled: "growth.stage.scheduled",
  posted: "growth.stage.posted",
};

/** Posts a week the cadence prompt aims for. */
const TARGET_PER_WEEK = 3;

/**
 * The per-platform view: "<Platform> Overview" cards, "<Platform> Demographics", "<Platform> Post Activity"
 * with the cadence prompt, then the account card, this week's plan, the latest posted, the content tip and
 * the snapshot history. The screen mounts it with `key={platform}`, so the handle/url inputs reset.
 */
export default function PlatformTab({
  platform,
  today,
  overview,
  demographics,
  onAddDemographics,
}: {
  platform: Platform;
  today: string;
  overview: PlatformOverview;
  demographics: readonly Demographic[];
  onAddDemographics: () => void;
}) {
  const { t, L, lang } = useT();
  const meta = PLATFORM_META[platform];
  const name = L(meta.name);
  const snapshots = useStore((s) => s.socialSnapshots);
  const posts = useStore((s) => s.posts);
  const account = useStore((s) => accountFor(s, platform));
  const setAccount = useStore((s) => s.setAccount);
  const removeSnapshot = useStore((s) => s.removeSnapshot);

  const [handle, setHandle] = useState(account?.handle ?? "");
  const [url, setUrl] = useState(account?.url ?? "");
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [cadence, setCadence] = useState(false);

  const pts = series(snapshots, platform, 90, today);
  const followersSeries: ChartSeries[] = [
    {
      id: "followers",
      label: platform === "youtube" ? t("growth.subscribers") : t("growth.followers"),
      short: "F",
      color: meta.color,
      points: pts.map((p) => ({ day: p.day, value: p.followers })),
    },
  ];

  const week = postsForWeek(posts, weekKey(today)).filter((p) => p.platform === platform);
  const posted = posts
    .filter((p) => p.platform === platform && p.stage === "posted")
    .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, 3);
  const tip = contentTip(posts, platform, today);
  const history = snapshots
    .filter((s) => s.platform === platform)
    .sort((a, b) => b.day.localeCompare(a.day));

  const saveAccount = (e: FormEvent) => {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, "");
    if (!h) return;
    setAccount(platform, h, url.trim() || undefined);
    setSaved(true);
  };
  const link = account ? account.url || profileUrl(platform, account.handle) : null;

  const tipText =
    tip.rule === "noRecent"
      ? tip.daysSince === null
        ? t("growth.tip.never", { platform: name })
        : t("growth.tip.noRecent", { n: tip.daysSince })
      : tip.rule === "oneStage"
        ? t("growth.tip.oneStage", { n: tip.count, stage: t(STAGE_KEY[tip.stage]) })
        : t("growth.tip.mix", { length: L(meta.idealLength) });

  const counts = overview.posts;
  const perWeek = Math.round((counts.posts30d / 30) * 7 * 10) / 10;
  const cadenceText =
    counts.posts30d === 0
      ? t("growth.ai.cadence.none", { platform: name })
      : perWeek >= TARGET_PER_WEEK
        ? t("growth.ai.cadence.good", { n: counts.posts30d, platform: name, perWeek })
        : t("growth.ai.cadence.low", {
            n: counts.posts30d,
            platform: name,
            perWeek,
            more: Math.max(1, Math.ceil(TARGET_PER_WEEK - perWeek)),
          });

  const byFollowers = overview.metrics.engagementByFollowers;

  return (
    <div className="flex flex-col gap-4" style={{ "--c": meta.color } as CSSProperties}>
      {/* Overview */}
      <section className="flex flex-col gap-2" data-testid="platform-overview">
        <h2 className="text-base">{t("growth.overview.title", { platform: name })}</h2>
        <div className="an-overview">
          {overview.rows.map((row) => (
            <div
              key={row.metric}
              className="px-inset an-kpi"
              data-testid="overview-row"
              data-metric={row.metric}
              data-source={row.source}
              data-value={row.value ?? ""}
            >
              <span className="text-muted text-xs">{L(row.label)}</span>
              <b className="gr-value">{fmtMetric(row.value, row.format)}</b>
              {row.metric === "engagement" && byFollowers !== null ? (
                <span
                  className="text-muted text-[0.68rem] leading-tight"
                  data-testid="overview-by-followers"
                >
                  {L({ ar: "على المتابعين", en: "by followers" })} {fmtEngagement(byFollowers)}
                </span>
              ) : (
                <SourceHint
                  source={row.source}
                  sample={overview.sample}
                  day={overview.snapshot?.day}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Demographics */}
      {hasDemographics(demographics, platform) ? (
        <Demographics platform={platform} demographics={demographics} onAdd={onAddDemographics} />
      ) : (
        <section className="px-card flex flex-col gap-2" data-testid="demographics-empty">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base">{t("growth.demo.title", { platform: name })}</h2>
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm ms-auto"
              onClick={onAddDemographics}
              data-testid="demo-add"
            >
              ✍️ {t("growth.demo.add")}
            </button>
          </div>
          <p className="text-ink-2 text-sm">{t("growth.demo.empty", { platform: name })}</p>
        </section>
      )}

      {/* Post activity + cadence prompt */}
      <PostActivity
        title={t("growth.activity.platformTitle", { platform: name })}
        counts={counts}
        note={t("growth.activity.note")}
      >
        <div className="flex flex-col gap-2">
          <AiButton
            testId="analytics-cadence"
            pressed={cadence}
            onClick={() => setCadence((v) => !v)}
          >
            {t("growth.ai.cadence.button", { platform: name })}
          </AiButton>
          {cadence && (
            <p className="px-inset an-ai-card text-sm" data-testid="analytics-cadence-text">
              {cadenceText}
            </p>
          )}
        </div>
      </PostActivity>

      {/* Account */}
      <section className="px-card flex flex-col gap-3" data-testid="account-card">
        <div className="flex flex-wrap items-center gap-3">
          <span aria-hidden className="gr-platform-icon">
            {meta.icon}
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-lg">{name}</h2>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer noopener"
                className="num text-ink-2 inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
                dir="ltr"
                data-testid="account-link"
              >
                @{account?.handle}
                <span aria-hidden className="an-ext">
                  ↗
                </span>
              </a>
            ) : (
              <span className="text-muted text-sm">{t("growth.account.none")}</span>
            )}
          </div>
          <SourceBadge platform={platform} latestDay={overview.snapshot?.day} className="ms-auto" />
        </div>
        <form
          className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]"
          onSubmit={saveAccount}
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.account.handle")}</span>
            <input
              type="text"
              className="px-input num"
              dir="ltr"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setSaved(false);
              }}
              placeholder="3zprod"
              data-testid="account-handle"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("growth.account.url")}</span>
            <input
              type="url"
              className="px-input num"
              dir="ltr"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSaved(false);
              }}
              placeholder={profileUrl(platform, handle || "3zprod")}
              data-testid="account-url"
            />
          </label>
          <button
            type="submit"
            className="px-btn px-btn-ghost self-end"
            disabled={!handle.trim()}
            data-testid="account-save"
          >
            {saved ? t("growth.account.saved") : t("growth.account.save")}
          </button>
        </form>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* This week's planned posts */}
        <section className="px-card flex flex-col gap-2" data-testid="planned-posts">
          <h2 className="text-base">{t("growth.planned.title")}</h2>
          {week.length === 0 ? (
            <p className="text-ink-2 text-sm">
              {t("growth.planned.empty")}{" "}
              <Link
                href="/social/calendar/"
                className="text-accent underline-offset-2 hover:underline"
                data-testid="planned-empty-link"
              >
                {t("growth.planned.open")}
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {week.map((p) => (
                <li
                  key={p.id}
                  className="px-inset flex items-center gap-2 text-sm"
                  data-testid="planned-post"
                  data-id={p.id}
                >
                  <span className="num text-muted shrink-0 text-xs" dir="ltr">
                    {p.plannedDay ? formatDayShort(p.plannedDay, lang) : ""}
                    {p.plannedTime ? ` · ${p.plannedTime}` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
                  <span className="px-chip">{t(STAGE_KEY[p.stage])}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Latest posted (calendar) + tip */}
        <section className="px-card flex flex-col gap-2" data-testid="posted-posts">
          <h2 className="text-base">{t("growth.posted.title")}</h2>
          {posted.length === 0 ? (
            <p className="text-ink-2 text-sm">{t("growth.posted.empty")}</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {posted.map((p, i) => (
                <PostRow key={p.id} post={p} index={i} lang={lang} />
              ))}
            </ol>
          )}
          <p className="px-inset text-sm" data-testid="content-tip" data-rule={tip.rule}>
            <span className="text-muted text-xs">{t("growth.tip.label")} · </span>
            {tipText}
          </p>
        </section>
      </div>

      {/* Snapshot history */}
      <section className="px-card flex flex-col gap-3" data-testid="snapshot-history">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base">{t("growth.history.title")}</h2>
          <span className="text-muted text-xs">
            {t("growth.chart.days90")} · <span className="num">{history.length}</span>
          </span>
        </div>
        <LineChart
          series={followersSeries}
          today={today}
          height={150}
          title={t("growth.chart.seriesAria", { what: t("growth.followers"), platform: name })}
          testId="chart-followers"
        />
        {history.length === 0 ? (
          <p className="text-ink-2 text-sm">{t("growth.history.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {history.map((s) => {
              const eng = engagementOf(s);
              return (
                <li
                  key={s.day}
                  className="px-inset gr-hist flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                  data-testid="snapshot-row"
                  data-day={s.day}
                >
                  <span className="num text-ink-2 w-20 shrink-0 text-xs" dir="ltr">
                    {formatDayShort(s.day, lang)}
                  </span>
                  <span className="flex items-baseline gap-1">
                    <span className="text-muted text-xs">
                      {platform === "youtube" ? t("growth.subscribers") : t("growth.followers")}
                    </span>
                    <b className="num">{fmtCount(s.followers)}</b>
                  </span>
                  {s.views30d > 0 && (
                    <span className="flex items-baseline gap-1">
                      <span className="text-muted text-xs">{t("growth.views30")}</span>
                      <b className="num">{fmtCount(s.views30d)}</b>
                    </span>
                  )}
                  {s.avgViews !== undefined && (
                    <span className="flex items-baseline gap-1">
                      <span className="text-muted text-xs">{t("growth.kpi.views")}</span>
                      <b className="num">{fmtCount(s.avgViews)}</b>
                    </span>
                  )}
                  {eng !== null && (
                    <span className="flex items-baseline gap-1">
                      <span className="text-muted text-xs">{t("growth.engagement")}</span>
                      <b className="num">{fmtEngagement(eng)}</b>
                    </span>
                  )}
                  {s.note && (
                    <span className="text-muted min-w-0 flex-1 truncate text-xs">{s.note}</span>
                  )}
                  <button
                    type="button"
                    className="px-btn px-btn-ghost px-btn-sm ms-auto"
                    onClick={() => setRemoving(s.day)}
                    aria-label={t("growth.history.remove")}
                    title={t("growth.history.remove")}
                    data-testid="snapshot-remove"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {removing && (
        <ConfirmDialog
          title={t("growth.history.confirmTitle")}
          body={t("growth.history.confirmBody", {
            platform: name,
            day: formatDayShort(removing, lang),
          })}
          confirmLabel={t("growth.history.remove")}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            removeSnapshot(platform, removing);
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}

function PostRow({ post, index, lang }: { post: Post; index: number; lang: "ar" | "en" }) {
  const day = post.postedAt ? formatDayShort(post.postedAt.slice(0, 10), lang) : "";
  return (
    <li className="flex items-center gap-2 text-sm" data-testid="posted-post" data-id={post.id}>
      <span className="num text-muted w-4 shrink-0 text-xs">{index + 1}</span>
      {post.postedUrl ? (
        <a
          href={post.postedUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 flex-1 truncate font-semibold underline-offset-2 hover:underline"
        >
          {post.title}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate font-semibold">{post.title}</span>
      )}
      <span className="num text-muted shrink-0 text-xs">{day}</span>
    </li>
  );
}
