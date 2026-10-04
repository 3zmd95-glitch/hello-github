"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { AutoPost, Platform, Post } from "@/lib/domain";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  autoPostActive,
  autoPostOf,
  autoPostSummary,
  CAPTION_MAX,
  captionFor,
  canPublishTo,
  jobActive,
  manualComposeUrl,
  pendingManualPlatforms,
  needsTikTokFinish,
  reconnectInDays,
  reconnectMessageKey,
  scheduledAtOf,
  type WorkerJob,
} from "@/lib/publish";
import { PLATFORM_META } from "@/lib/social";
import { accountState, isSocialPlatform, SOCIAL_PLATFORMS } from "@/lib/socialSync";
import { useStore } from "@/store";
import { formatInstant } from "./calendar/dates";
import { PlatformChip, platformStyle } from "./calendar/PlatformChip";
import { calendarPostHref } from "./studio/platform";
import { cancelWorkerJob, refreshPublishJobs, useWorkerOnlyJobs } from "./usePublish";
import { useSocialSync } from "./useSocialSync";
import TikTokFinishCard from "./calendar/TikTokFinishCard";

/** Newest finished auto-posts shown under "Already out". */
const DONE_MAX = 20;

const at = (p: Post) => scheduledAtOf(p) ?? p.autoPost?.sentAt ?? p.updatedAt;

/**
 * 🚀 Auto-posting hub (the ⚡ Automations route): which accounts can post by themselves (with "Allow
 * posting" and, since round 30, "reconnect in N days" before a Meta token runs out), the scheduled posts with
 * each network's state, the posts whose X / Snapchat step the owner still has to do by hand (copy the caption,
 * open the app; `#manual`, where the Studio inbox's manual rows land), and what already went out. Scheduling
 * itself happens in the post popup's 🚀 tab; every row links back there. A7: the Worker's jobs that no post in
 * this browser follows (sent from the phone, or before the browser was cleared) show under "📡 On the Worker
 * from another device", after the manual list, with their networks and a cancel; the hub reads the Worker
 * once when it opens.
 */
export default function AutoPostScreen() {
  const { t } = useT();
  const { configured, status, busy, connect } = useSocialSync({ auto: true });
  const { markPosted } = useGameActions();
  const posts = useStore((s) => s.posts);
  const [refreshing, setRefreshing] = useState(false);
  const remote = useWorkerOnlyJobs();
  const mark = useCallback((id: string, url: string) => void markPosted(id, url), [markPosted]);

  const sent = posts.filter((p) => p.autoPost?.sentAt);
  const upcoming = sent
    .filter((p) => autoPostActive(p.autoPost))
    .sort((a, b) => (at(a) < at(b) ? -1 : 1));
  const done = sent
    .filter((p) => !autoPostActive(p.autoPost) && !needsTikTokFinish(p.autoPost))
    .sort((a, b) => (at(a) < at(b) ? 1 : -1))
    .slice(0, DONE_MAX);
  // Planned posts with an X / Snapchat step still to do by hand (no Worker needed for these).
  const manual = posts
    .filter(
      (p) =>
        (p.plannedDay || needsTikTokFinish(p.autoPost)) && pendingManualPlatforms(p).length > 0,
    )
    .sort((a, b) => (at(a) < at(b) ? -1 : 1));

  const refresh = async () => {
    setRefreshing(true);
    await refreshPublishJobs(mark);
    setRefreshing(false);
  };

  // One read when the hub opens, so jobs sent from another device show up without a tap.
  useEffect(() => {
    if (configured) void refreshPublishJobs(mark);
  }, [configured, mark]);

  return (
    <div className="flex flex-col gap-4" data-testid="autopost-screen">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl">{t("publish.hub.title")}</h1>
        <p className="text-ink-2 text-sm">{t("publish.hub.sub")}</p>
      </header>

      <section className="px-card flex flex-col gap-3" data-testid="autopost-accounts">
        <h2 className="text-base">{t("publish.hub.accounts")}</h2>
        {!configured || !status ? (
          <p className="text-ink-2 text-sm">
            {t("publish.needWorker")}{" "}
            <Link href="/settings#accounts" className="px-link">
              {t("publish.hub.settings")}
            </Link>
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {SOCIAL_PLATFORMS.map((p) => {
              const st = status[p];
              const state = accountState(st);
              const days = reconnectInDays(st, p);
              return (
                <li
                  key={p}
                  className="px-inset flex flex-wrap items-center gap-2"
                  style={platformStyle(p)}
                  data-testid="autopost-account"
                  data-platform={p}
                  data-can-post={canPublishTo(st, p)}
                >
                  <PlatformChip platform={p} />
                  <span className="text-muted min-w-0 flex-1 truncate text-xs">
                    {state === "not_configured"
                      ? t("publish.net.notSetUp")
                      : !st?.connected
                        ? t("publish.net.notConnected")
                        : canPublishTo(st, p)
                          ? t(p === "tiktok" ? "publish.tt.canUpload" : "publish.hub.canPost")
                          : t("publish.net.noPermission")}
                  </span>
                  {st?.connected && !canPublishTo(st, p) && (
                    <button
                      type="button"
                      className="px-btn px-btn-sm shrink-0"
                      disabled={busy}
                      onClick={() => void connect(p, true)}
                      data-testid={`autopost-hub-allow-${p}`}
                    >
                      {t("publish.allow")}
                    </button>
                  )}
                  {days !== null && (
                    <span
                      className="flex w-full flex-wrap items-center gap-2 text-xs"
                      data-testid={`autopost-token-${p}`}
                    >
                      <span className="text-danger font-bold">
                        {t(reconnectMessageKey(days), { n: days })}
                      </span>
                      <button
                        type="button"
                        className="px-btn px-btn-ghost px-btn-sm ms-auto"
                        disabled={busy}
                        onClick={() => void connect(p)}
                        data-testid={`autopost-hub-reconnect-${p}`}
                      >
                        {t("settings.accounts.reconnect")}
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-muted text-xs">{t("publish.hub.manual")}</p>
      </section>

      <section className="px-card flex flex-col gap-3" data-testid="autopost-upcoming">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base">{t("publish.hub.upcoming")}</h2>
          {configured && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm ms-auto"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={() => void refresh()}
              data-testid="autopost-refresh"
            >
              {t("publish.hub.refresh")}
            </button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-ink-2 text-sm" data-testid="autopost-empty">
              {t("publish.hub.empty")}
            </p>
            <Link href="/social/calendar/" className="px-btn px-btn-ghost px-btn-sm no-underline">
              {t("publish.hub.openCalendar")}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((p) => (
              <JobRow key={p.id} post={p} />
            ))}
          </ul>
        )}
      </section>

      {manual.length > 0 && (
        <section
          id="manual"
          className="px-card flex scroll-mt-20 flex-col gap-3"
          data-testid="autopost-manual"
        >
          <h2 className="text-base">{t("publish.hub.manualTitle")}</h2>
          <p className="text-muted text-xs">{t("publish.hub.manualSub")}</p>
          <ul className="flex flex-col gap-2">
            {manual.map((p) => (
              <ManualRow key={p.id} post={p} />
            ))}
          </ul>
        </section>
      )}

      {configured && remote.length > 0 && (
        <section className="px-card flex flex-col gap-3" data-testid="autopost-remote">
          <h2 className="text-base">{t("publish.hub.remoteTitle")}</h2>
          <p className="text-muted text-xs">{t("publish.hub.remoteSub")}</p>
          <ul className="flex flex-col gap-2">
            {remote.map((j) => (
              <RemoteJobRow key={j.id} job={j} />
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="px-card flex flex-col gap-3" data-testid="autopost-done">
          <h2 className="text-base">{t("publish.hub.done")}</h2>
          <ul className="flex flex-col gap-2">
            {done.map((p) => (
              <JobRow key={p.id} post={p} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One post with X / Snapchat still to post by hand: when, the caption to copy, the app to open. */
function ManualRow({ post }: { post: Post }) {
  const { t, L, lang } = useT();
  const auto = autoPostOf(post);
  const [copied, setCopied] = useState<Platform | null>(null);
  const copy = async (p: Platform) => {
    try {
      await navigator.clipboard.writeText(captionFor(post, auto, p));
      setCopied(p);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };
  return (
    <li
      className="px-inset flex flex-col gap-1.5"
      data-testid="autopost-manual-post"
      data-post={post.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-sm">{post.title}</b>
        <Link href={calendarPostHref(post.id)} className="px-link text-xs">
          {t("publish.hub.open")}
        </Link>
      </div>
      <span className="text-muted num text-xs">{formatInstant(at(post), lang)}</span>
      <ul className="flex flex-col gap-1.5">
        {pendingManualPlatforms(post).map((p) => {
          const text = captionFor(post, auto, p);
          return (
            <li key={p} className="flex flex-wrap items-center gap-1.5" data-platform={p}>
              <PlatformChip platform={p} short />
              {text.length > CAPTION_MAX[p] && (
                <span className="text-danger text-xs">
                  {t("publish.hub.manualOver", { platform: L(PLATFORM_META[p].name) })}
                </span>
              )}
              <button
                type="button"
                className="px-btn px-btn-ghost px-btn-sm ms-auto"
                onClick={() => void copy(p)}
                data-testid={`autopost-manual-copy-${p}`}
              >
                {copied === p ? t("calendar.sheet.copied") : t("publish.copy")}
              </button>
              <a
                href={manualComposeUrl(p, text) ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="px-btn px-btn-ghost px-btn-sm no-underline"
                data-testid={`autopost-manual-open-${p}`}
              >
                {t("publish.openApp", { platform: L(PLATFORM_META[p].name) })}
              </a>
            </li>
          );
        })}
      </ul>
      <TikTokFinishCard post={post} />
    </li>
  );
}

function JobRow({ post }: { post: Post }) {
  const { t, lang } = useT();
  const auto = post.autoPost!;
  const summary = autoPostSummary(auto);
  const when = at(post);
  return (
    <li
      className="px-inset flex flex-col gap-1.5"
      data-testid="autopost-job"
      data-post={post.id}
      data-summary={summary}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-sm">{post.title}</b>
        <span className="px-chip text-xs">{t(`publish.summary.${summary}`)}</span>
        <Link href={calendarPostHref(post.id)} className="px-link text-xs">
          {t("publish.hub.open")}
        </Link>
      </div>
      <span className="text-muted num text-xs">{formatInstant(when, lang)}</span>
      <NetworkStates
        platforms={auto.platforms}
        results={
          auto.tiktokCompletedAt
            ? {
                ...auto.results,
                tiktok: { ...auto.results.tiktok!, inbox: false, permalink: auto.tiktokPermalink },
              }
            : auto.results
        }
      />
    </li>
  );
}

/**
 * A job this browser has no post for (A7): its label, when it goes out (Riyadh), each network's state and
 * links, and a cancel that asks first while something is still waiting or uploading.
 */
function RemoteJobRow({ job }: { job: WorkerJob }) {
  const { t, lang } = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const active = jobActive(job);
  const platforms = SOCIAL_PLATFORMS.filter((p) => job.results[p]);
  const name = job.label ?? t("publish.hub.remoteNoLabel");

  const cancel = async () => {
    setAsking(false);
    setBusy(true);
    const r = await cancelWorkerJob(job.id);
    // On success the row leaves the list (and this component unmounts).
    if (!r.ok) {
      setBusy(false);
      setError("error" in r ? r.error : null);
    }
  };

  return (
    <li
      className="px-inset flex flex-col gap-1.5"
      data-testid="autopost-remote-job"
      data-job={job.id}
      data-active={active}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b
          className="min-w-0 flex-1 truncate text-sm"
          title={name}
          data-testid="autopost-remote-label"
        >
          {name}
        </b>
        <button
          type="button"
          className="px-btn px-btn-ghost px-btn-sm shrink-0"
          disabled={busy}
          aria-busy={busy}
          onClick={() => (active ? setAsking(true) : void cancel())}
          aria-label={t(active ? "publish.hub.remoteCancelFor" : "publish.hub.remoteRemoveFor", {
            name,
          })}
          data-testid="autopost-remote-cancel"
        >
          {active ? t("publish.hub.remoteCancel") : t("publish.hub.remoteRemove")}
        </button>
      </div>
      <span className="text-muted num text-xs">{formatInstant(job.scheduledAt, lang)}</span>
      <NetworkStates platforms={platforms} results={job.results} />
      {job.results.tiktok?.inbox && job.results.tiktok.state === "published" && (
        <p className="text-sm font-semibold">
          {t("publish.tt.finishSteps")}{" "}
          <a
            href="https://www.tiktok.com/"
            className="px-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("publish.openApp", { platform: "TikTok" })}
          </a>
        </p>
      )}
      {error && (
        <p className="text-danger text-xs" role="alert" data-testid="autopost-remote-error">
          {t(error)}
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title={t("publish.hub.remoteConfirmTitle")}
          body={t("publish.hub.remoteConfirmBody", { name })}
          confirmLabel={t("publish.hub.remoteConfirmOk")}
          cancelLabel={t("publish.hub.remoteConfirmKeep")}
          danger
          onConfirm={() => void cancel()}
          onCancel={() => setAsking(false)}
        />
      )}
    </li>
  );
}

/** Each network's chip with its state (a link once published; ✋ for the manual ones). */
function NetworkStates({
  platforms,
  results,
}: {
  platforms: readonly Platform[];
  results: AutoPost["results"];
}) {
  const { t } = useT();
  return (
    <ul className="flex flex-wrap gap-1.5">
      {platforms.map((p) => {
        const r = isSocialPlatform(p) ? results[p] : undefined;
        const state = isSocialPlatform(p) ? (r?.state ?? "queued") : null;
        return (
          <li
            key={p}
            className="flex items-center gap-1 text-xs"
            data-platform={p}
            data-state={state ?? "manual"}
          >
            <PlatformChip platform={p} short />
            {state === null ? (
              <span className="text-muted">✋</span>
            ) : r?.permalink ? (
              <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="px-link">
                {t("publish.state.published")}
              </a>
            ) : (
              <span className={state === "failed" ? "text-danger" : "text-muted"}>
                {r?.inbox ? t("publish.state.inbox") : t(`publish.state.${state}`)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
