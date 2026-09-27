"use client";

import Link from "next/link";
import { useState, type CSSProperties, type FormEvent } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatDayShort } from "@/components/planner/weekLabel";
import type { Platform, Post, PostStage } from "@/lib/domain";
import { series, snapshotDelta } from "@/lib/growth";
import { useT, type MessageKey } from "@/lib/i18n";
import { BEST_TIME, PLATFORM_META, postsForWeek } from "@/lib/social";
import { weekKey } from "@/lib/streak";
import { accountFor, useStore } from "@/store";
import Delta from "./Delta";
import LineChart, { type ChartSeries } from "./LineChart";
import { contentTip } from "./contentTip";
import { fmtCount, fmtEngagement, profileUrl } from "./format";

const STAGE_KEY: Record<PostStage, MessageKey> = {
  idea: "growth.stage.idea",
  script: "growth.stage.script",
  filmed: "growth.stage.filmed",
  edited: "growth.stage.edited",
  scheduled: "growth.stage.scheduled",
  posted: "growth.stage.posted",
};

/**
 * One platform: account, stat tiles, 90-day charts, this week's plan, top posts, tip and the history.
 * The screen mounts it with `key={platform}`, so the handle/url inputs reset when the tab changes.
 */
export default function PlatformTab({ platform, today }: { platform: Platform; today: string }) {
  const { t, L, lang } = useT();
  const meta = PLATFORM_META[platform];
  const snapshots = useStore((s) => s.socialSnapshots);
  const posts = useStore((s) => s.posts);
  const account = useStore((s) => accountFor(s, platform));
  const setAccount = useStore((s) => s.setAccount);
  const removeSnapshot = useStore((s) => s.removeSnapshot);

  const [handle, setHandle] = useState(account?.handle ?? "");
  const [url, setUrl] = useState(account?.url ?? "");
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const d = snapshotDelta(snapshots, platform, 30);
  const latest = d.latest;
  const pts = series(snapshots, platform, 90, today);
  const followersSeries: ChartSeries[] = [
    {
      id: "followers",
      label: t("growth.followers"),
      short: "F",
      color: meta.color,
      points: pts.map((p) => ({ day: p.day, value: p.followers })),
    },
  ];
  const viewsSeries: ChartSeries[] = [
    {
      id: "views",
      label: t("growth.views30"),
      short: "V",
      color: "var(--sky)",
      points: pts.map((p) => ({ day: p.day, value: p.views30d })),
    },
  ];

  const week = postsForWeek(posts, weekKey(today)).filter((p) => p.platform === platform);
  const topPosts = posts
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
        ? t("growth.tip.never", { platform: L(meta.name) })
        : t("growth.tip.noRecent", { n: tip.daysSince })
      : tip.rule === "oneStage"
        ? t("growth.tip.oneStage", { n: tip.count, stage: t(STAGE_KEY[tip.stage]) })
        : t("growth.tip.mix", { length: L(meta.idealLength) });

  return (
    <div className="flex flex-col gap-4" style={{ "--c": meta.color } as CSSProperties}>
      {/* Account header */}
      <section className="px-card flex flex-col gap-3" data-testid="account-card">
        <div className="flex flex-wrap items-center gap-3">
          <span aria-hidden className="gr-platform-icon">
            {meta.icon}
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-lg">{L(meta.name)}</h2>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer noopener"
                className="num text-ink-2 text-sm underline-offset-2 hover:underline"
                dir="ltr"
                data-testid="account-link"
              >
                @{account?.handle}
              </a>
            ) : (
              <span className="text-muted text-sm">{t("growth.account.none")}</span>
            )}
          </div>
          <span className="px-chip ms-auto">{t("growth.manual")}</span>
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

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="px-inset flex min-w-0 flex-col gap-1" data-testid="stat-followers">
          <span className="text-muted text-xs">{t("growth.followers")}</span>
          <b className="gr-value">{latest ? fmtCount(latest.followers) : "–"}</b>
          <Delta
            value={d.followers}
            pct={d.followersPct}
            pending={latest ? t("growth.delta.pending") : t("growth.noData")}
            testId="stat-followers-delta"
          />
        </div>
        <div className="px-inset flex min-w-0 flex-col gap-1" data-testid="stat-views">
          <span className="text-muted text-xs">{t("growth.views30")}</span>
          <b className="gr-value">{latest ? fmtCount(latest.views30d) : "–"}</b>
          <Delta
            value={d.views}
            pct={d.viewsPct}
            pending={latest ? t("growth.delta.pending") : t("growth.noData")}
            testId="stat-views-delta"
          />
        </div>
        <div className="px-inset flex min-w-0 flex-col gap-1" data-testid="stat-engagement">
          <span className="text-muted text-xs">{t("growth.engagement")}</span>
          <b className="gr-value">{fmtEngagement(latest?.engagementPct)}</b>
          <span className="text-muted text-xs">
            {latest?.engagementPct === undefined
              ? t("growth.engagementHint")
              : t("growth.asOf", { day: formatDayShort(latest.day, lang) })}
          </span>
        </div>
        <div className="px-inset flex min-w-0 flex-col gap-1" data-testid="stat-besttime">
          <span className="text-muted text-xs">{t("growth.bestTime")}</span>
          <b className="num text-lg leading-tight" dir="ltr">
            {BEST_TIME[platform].join(" · ")}
          </b>
          <span className="text-muted text-xs">{t("growth.bestTimeHint")}</span>
        </div>
      </div>

      {/* Charts: two small multiples on one time axis (no dual axis). */}
      <section className="px-card flex flex-col gap-3" data-testid="growth-chart">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base">{t("growth.chart.title", { platform: L(meta.name) })}</h2>
          <span className="text-muted text-xs">{t("growth.chart.days90")}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-ink-2 flex items-center gap-1.5 text-xs font-semibold">
              <i className="gr-key" style={{ background: meta.color }} aria-hidden />
              {t("growth.followers")}
            </h3>
            <LineChart
              series={followersSeries}
              today={today}
              height={150}
              title={t("growth.chart.seriesAria", {
                what: t("growth.followers"),
                platform: L(meta.name),
              })}
              testId="chart-followers"
            />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-ink-2 flex items-center gap-1.5 text-xs font-semibold">
              <i className="gr-key" style={{ background: "var(--sky)" }} aria-hidden />
              {t("growth.views30")}
            </h3>
            <LineChart
              series={viewsSeries}
              today={today}
              height={150}
              title={t("growth.chart.seriesAria", {
                what: t("growth.views30"),
                platform: L(meta.name),
              })}
              testId="chart-views"
            />
          </div>
        </div>
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

        {/* Top posts + tip */}
        <section className="px-card flex flex-col gap-2" data-testid="top-posts">
          <h2 className="text-base">{t("growth.top.title")}</h2>
          {topPosts.length === 0 ? (
            <p className="text-ink-2 text-sm">{t("growth.top.empty")}</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {topPosts.map((p, i) => (
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
      <section className="px-card flex flex-col gap-2" data-testid="snapshot-history">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base">{t("growth.history.title")}</h2>
          <span className="num text-muted text-xs">{history.length}</span>
        </div>
        {history.length === 0 ? (
          <p className="text-ink-2 text-sm">{t("growth.history.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {history.map((s) => (
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
                  <span className="text-muted text-xs">{t("growth.followers")}</span>
                  <b className="num">{fmtCount(s.followers)}</b>
                </span>
                <span className="flex items-baseline gap-1">
                  <span className="text-muted text-xs">{t("growth.views30")}</span>
                  <b className="num">{fmtCount(s.views30d)}</b>
                </span>
                {s.engagementPct !== undefined && (
                  <span className="flex items-baseline gap-1">
                    <span className="text-muted text-xs">{t("growth.engagement")}</span>
                    <b className="num">{fmtEngagement(s.engagementPct)}</b>
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
            ))}
          </ul>
        )}
      </section>

      {removing && (
        <ConfirmDialog
          title={t("growth.history.confirmTitle")}
          body={t("growth.history.confirmBody", {
            platform: L(meta.name),
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
    <li className="flex items-center gap-2 text-sm" data-testid="top-post" data-id={post.id}>
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
