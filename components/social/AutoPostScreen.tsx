"use client";

import {
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  Hand,
  Settings,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { useCelebrate } from "@/components/celebrate/CelebrationProvider";
import { useGameActions } from "@/components/celebrate/useGameActions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Chip from "@/components/ui/ios/Chip";
import EmptyState from "@/components/ui/ios/EmptyState";
import { ListGroup, ListRow } from "@/components/ui/ios/List";
import PageHeader from "@/components/ui/ios/PageHeader";
import PlatformBadge from "@/components/ui/ios/PlatformBadge";
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
  type AutoPostSummary,
  type WorkerJob,
} from "@/lib/publish";
import { PLATFORM_META } from "@/lib/social";
import { accountState, isSocialPlatform, SOCIAL_PLATFORMS } from "@/lib/socialSync";
import { useStore } from "@/store";
import { formatInstant } from "./calendar/dates";
import TikTokFinishCard from "./calendar/TikTokFinishCard";
import { calendarPostHref } from "./studio/platform";
import { cancelWorkerJob, refreshPublishJobs, useWorkerOnlyJobs } from "./usePublish";
import { useSocialSync } from "./useSocialSync";

/** Newest finished auto-posts shown under "Already out". */
const DONE_MAX = 20;

const at = (p: Post) => scheduledAtOf(p) ?? p.autoPost?.sentAt ?? p.updatedAt;

/** The summary chip: green once out everywhere, warn while something still needs the owner. */
const SUMMARY_TONE: Partial<Record<AutoPostSummary, "tint" | "warn">> = {
  published: "tint",
  partial: "warn",
  failed: "warn",
  needsFinish: "warn",
};

/**
 * Auto-posting hub (the Automations route) in the iOS look (round 35): which accounts can post by themselves (with
 * "Allow posting" and, since round 30, "reconnect in N days" before a Meta token runs out), the scheduled posts with
 * each network's state, the posts whose X / Snapchat step the owner still has to do by hand (copy the caption, open
 * the app; `#manual`, where the Studio inbox's manual rows land), and what already went out, each as a grouped list.
 * Scheduling itself happens in the post popup's Auto-post tab; every post row opens it. A7: the Worker's jobs that no
 * post in this browser follows (sent from the phone, or before the browser was cleared) show under "On the Worker from
 * another device", after the manual list, with their networks and a cancel; the hub reads the Worker once when it opens.
 */
export default function AutoPostScreen() {
  const { t, L } = useT();
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
      <PageHeader title={t("publish.hub.title")} sub={t("publish.hub.sub")} />

      <Group
        header={t("publish.hub.accounts")}
        footer={t("publish.hub.manual")}
        testId="autopost-accounts"
      >
        {!configured || !status ? (
          <li className="ios-row">
            <span className="ios-ic fill">
              <Settings size={20} strokeWidth={1.75} aria-hidden />
            </span>
            <p className="text-ink-2 min-w-0 flex-1 text-[15px]">
              {t("publish.needWorker")}{" "}
              <Link href="/settings#accounts" className="px-link">
                {t("publish.hub.settings")}
              </Link>
            </p>
          </li>
        ) : (
          SOCIAL_PLATFORMS.map((p) => {
            const st = status[p];
            const can = canPublishTo(st, p);
            const days = reconnectInDays(st, p);
            // Connected without the posting permission: "Allow posting" takes the chip's place.
            const allow = !!st?.connected && !can;
            return (
              <ListRow
                key={p}
                as="li"
                iconRaw={<PlatformBadge platform={p} />}
                title={L(PLATFORM_META[p].name)}
                sub={
                  (allow || days !== null) && (
                    <>
                      {allow && t("publish.net.noPermission")}
                      {days !== null && (
                        <span
                          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
                          data-testid={`autopost-token-${p}`}
                        >
                          <span className="text-danger font-semibold">
                            {t(reconnectMessageKey(days), { n: days })}
                          </span>
                          <button
                            type="button"
                            className="px-btn px-btn-ghost px-btn-sm"
                            disabled={busy}
                            onClick={() => void connect(p)}
                            data-testid={`autopost-hub-reconnect-${p}`}
                          >
                            {t("settings.accounts.reconnect")}
                          </button>
                        </span>
                      )}
                    </>
                  )
                }
                trailing={
                  allow ? (
                    <button
                      type="button"
                      className="px-btn px-btn-sm shrink-0"
                      disabled={busy}
                      onClick={() => void connect(p, true)}
                      data-testid={`autopost-hub-allow-${p}`}
                    >
                      {t("publish.allow")}
                    </button>
                  ) : (
                    <Chip tone={can ? "tint" : "default"} className="shrink-0">
                      {accountState(st) === "not_configured"
                        ? t("publish.net.notSetUp")
                        : !st?.connected
                          ? t("publish.net.notConnected")
                          : t(p === "tiktok" ? "publish.tt.canUpload" : "publish.hub.canPost")}
                    </Chip>
                  )
                }
                testId="autopost-account"
                data-platform={p}
                data-can-post={can}
              />
            );
          })
        )}
      </Group>

      <ListGroup
        header={t("publish.hub.upcoming")}
        trailing={
          configured && (
            <button
              type="button"
              className="px-btn px-btn-ghost px-btn-sm"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={() => void refresh()}
              data-testid="autopost-refresh"
            >
              {t("publish.hub.refresh")}
            </button>
          )
        }
        testId="autopost-upcoming"
        listAs="ul"
      >
        {upcoming.length === 0 ? (
          <li>
            <EmptyState
              icon={<CalendarClock size={24} strokeWidth={1.75} aria-hidden />}
              title={t("publish.hub.empty")}
              action={
                <Link
                  href="/social/calendar/"
                  className="px-btn px-btn-ghost px-btn-sm no-underline"
                >
                  {t("publish.hub.openCalendar")}
                </Link>
              }
              testId="autopost-empty"
            />
          </li>
        ) : (
          upcoming.map((p) => <JobRow key={p.id} post={p} />)
        )}
      </ListGroup>

      {manual.length > 0 && (
        <Group
          id="manual"
          className="scroll-mt-20"
          header={t("publish.hub.manualTitle")}
          footer={t("publish.hub.manualSub")}
          testId="autopost-manual"
        >
          {manual.map((p) => (
            <ManualRow key={p.id} post={p} />
          ))}
        </Group>
      )}

      {configured && remote.length > 0 && (
        <Group
          header={t("publish.hub.remoteTitle")}
          footer={t("publish.hub.remoteSub")}
          testId="autopost-remote"
        >
          {remote.map((j) => (
            <RemoteJobRow key={j.id} job={j} />
          ))}
        </Group>
      )}

      {done.length > 0 && (
        <ListGroup header={t("publish.hub.done")} testId="autopost-done" listAs="ul">
          {done.map((p) => (
            <JobRow key={p.id} post={p} />
          ))}
        </ListGroup>
      )}
    </div>
  );
}

/** A grouped list of `<li>` rows with an iOS group footnote under it. */
function Group({
  footer,
  testId,
  id,
  className = "",
  ...props
}: Omit<ComponentProps<typeof ListGroup>, "listAs"> & { footer?: ReactNode }) {
  return (
    <div id={id} className={`flex flex-col gap-1.5 ${className}`} data-testid={testId}>
      <ListGroup listAs="ul" {...props} />
      {footer && <p className="text-ink-2 px-4 text-[13px]">{footer}</p>}
    </div>
  );
}

/**
 * A queued post's head line: its platform badge, the title over the time, an optional chip; the whole line opens the
 * post in the Calendar (where its Auto-post tab lives).
 */
function QueueHead({ post, children }: { post: Post; children?: ReactNode }) {
  const { lang } = useT();
  return (
    <Link href={calendarPostHref(post.id)} className="ap-open">
      <PlatformBadge platform={post.platform} />
      <span className="ios-tx">
        <b>
          <bdi>{post.title}</bdi>
        </b>
        <small className="tabular-nums">{formatInstant(at(post), lang)}</small>
      </span>
      {children}
      <ChevronLeft
        size={18}
        strokeWidth={1.75}
        className="text-muted shrink-0 ltr:rotate-180"
        aria-hidden
      />
    </Link>
  );
}

/** One post with X / Snapchat still to post by hand: when, the caption to copy, the app to open. */
function ManualRow({ post }: { post: Post }) {
  const { t, L } = useT();
  const { toast } = useCelebrate();
  const auto = autoPostOf(post);
  const copy = async (p: Platform) => {
    try {
      await navigator.clipboard.writeText(captionFor(post, auto, p));
      // The Social toast draws its own check, so the text carries none; silent, as the old inline label was.
      toast("notice", { name: t("publish.hub.copied"), sound: null });
    } catch {
      // The browser refused the clipboard: nothing was copied, so nothing to say.
    }
  };
  return (
    <li className="ios-row ap-row" data-testid="autopost-manual-post" data-post={post.id}>
      <QueueHead post={post} />
      <ul className="ap-sub flex flex-col gap-2">
        {pendingManualPlatforms(post).map((p) => {
          const text = captionFor(post, auto, p);
          const name = L(PLATFORM_META[p].name);
          return (
            <li key={p} className="flex flex-wrap items-center gap-1.5" data-platform={p}>
              <Chip icon={<PlatformBadge platform={p} size={18} />} className="ps-[3px]">
                {name}
              </Chip>
              {text.length > CAPTION_MAX[p] && (
                <span className="text-danger text-xs">
                  {t("publish.hub.manualOver", { platform: name })}
                </span>
              )}
              <span className="ms-auto flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="px-btn px-btn-ghost px-btn-sm"
                  onClick={() => void copy(p)}
                  data-testid={`autopost-manual-copy-${p}`}
                >
                  {t("publish.copy")}
                </button>
                <a
                  href={manualComposeUrl(p, text) ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-btn px-btn-ghost px-btn-sm no-underline"
                  data-testid={`autopost-manual-open-${p}`}
                >
                  {t("publish.openApp", { platform: name })}
                  <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />
                </a>
              </span>
            </li>
          );
        })}
      </ul>
      <TikTokFinishCard post={post} />
    </li>
  );
}

function JobRow({ post }: { post: Post }) {
  const { t } = useT();
  const auto = post.autoPost!;
  const summary = autoPostSummary(auto);
  return (
    <li
      className="ios-row ap-row"
      data-testid="autopost-job"
      data-post={post.id}
      data-summary={summary}
    >
      <QueueHead post={post}>
        <Chip tone={SUMMARY_TONE[summary]} className="shrink-0">
          {t(`publish.summary.${summary}`)}
        </Chip>
      </QueueHead>
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
      className="ios-row ap-row"
      data-testid="autopost-remote-job"
      data-job={job.id}
      data-active={active}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="ios-ic fill h-10 w-10 rounded-[13px]">
          <Smartphone size={20} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="ios-tx">
          <b title={name} data-testid="autopost-remote-label">
            <bdi>{name}</bdi>
          </b>
          <small className="tabular-nums">{formatInstant(job.scheduledAt, lang)}</small>
        </span>
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
          {active ? (
            <X size={15} strokeWidth={2} aria-hidden />
          ) : (
            <Trash2 size={15} strokeWidth={1.75} aria-hidden />
          )}
          {active ? t("publish.hub.remoteCancel") : t("publish.hub.remoteRemove")}
        </button>
      </div>
      <NetworkStates platforms={platforms} results={job.results} />
      {job.results.tiktok?.inbox && job.results.tiktok.state === "published" && (
        <p className="ap-sub text-[13px] font-semibold">
          {t("publish.tt.finishSteps")}{" "}
          <a
            href="https://www.tiktok.com/"
            className="px-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("publish.openApp", { platform: "TikTok" })}
            <ArrowUpRight
              size={13}
              strokeWidth={1.75}
              className="ms-0.5 inline align-[-2px]"
              aria-hidden
            />
          </a>
        </p>
      )}
      {error && (
        <p
          className="ap-sub text-danger text-[13px]"
          role="alert"
          data-testid="autopost-remote-error"
        >
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

/**
 * Each network as a chip: its badge and state (the published link; the Hand icon for the ones posted by hand). The
 * entries stay `li[data-platform]` with `data-state`.
 */
function NetworkStates({
  platforms,
  results,
}: {
  platforms: readonly Platform[];
  results: AutoPost["results"];
}) {
  const { t, L } = useT();
  return (
    <ul className="ap-sub flex flex-wrap gap-1.5">
      {platforms.map((p) => {
        const r = isSocialPlatform(p) ? results[p] : undefined;
        const state = isSocialPlatform(p) ? (r?.state ?? "queued") : null;
        return (
          <li key={p} data-platform={p} data-state={state ?? "manual"}>
            <Chip
              tone={
                r?.inbox || state === "failed" ? "warn" : state === "published" ? "tint" : "default"
              }
              icon={<PlatformBadge platform={p} size={18} />}
              className="ps-[3px]"
            >
              <span className="sr-only">{L(PLATFORM_META[p].name)}: </span>
              {state === null ? (
                <span className="inline-flex" title={t("publish.net.manual")}>
                  <Hand size={14} strokeWidth={1.75} aria-hidden />
                  <span className="sr-only">{t("publish.net.manual")}</span>
                </span>
              ) : r?.permalink ? (
                <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="px-link">
                  {t("publish.state.published")}
                </a>
              ) : r?.inbox ? (
                t("publish.state.inbox")
              ) : (
                t(`publish.state.${state}`)
              )}
            </Chip>
          </li>
        );
      })}
    </ul>
  );
}
