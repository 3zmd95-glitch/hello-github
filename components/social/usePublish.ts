"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import type { Post, SocialStatusMap } from "@/lib/domain";
import type { MessageKey } from "@/lib/i18n";
import {
  autoPostActive,
  autoPostOf,
  autoPostSummary,
  buildJob,
  firstPermalink,
  publishCancel,
  publishList,
  publishProblems,
  publishRun,
  publishSchedule,
  scheduledAtOf,
  type Problem,
  type WorkerJob,
} from "@/lib/publish";
import { scoutConfig } from "@/lib/scoutClient";
import { isSocialPlatform, socialSyncErrorMessageKey } from "@/lib/socialSync";
import { dayKey } from "@/lib/streak";
import { useStore } from "@/store";
import { useSocialSync } from "./useSocialSync";

/**
 * 🚀 Auto-posting glue between the calendar and the Worker's publish queue: send a post's job, publish now,
 * cancel, and read the per-platform results back into the post. When every network is out, the post is
 * marked as posted with the first link (the Produce quest bridge, with its celebration).
 *
 * Round 30 (planning/handovers/mastermind-2026-09-28.md · A2): a sent job follows caption / day / time edits
 * by itself (`usePublishAutoResync`), "Post now" gives a day-less post today's day, and the watcher reads the
 * results again when the tab comes back into view.
 */

/** While a job is still running, check back this often (the cron itself ticks every five minutes). */
export const WATCH_INTERVAL_MS = 60_000;

/** How long after the last edit a sent job is re-sent to the Worker. */
export const RESYNC_DEBOUNCE_MS = 1_500;

/** The debounced auto-resync waiting to fire, per post id (so an explicit send can drop it). */
const pendingResync = new Map<string, ReturnType<typeof setTimeout>>();

/** Drop the post's pending auto-resync, if any (an explicit send or cancel is on its way). */
export function cancelAutoResync(postId: string): void {
  const id = pendingResync.get(postId);
  if (id === undefined) return;
  clearTimeout(id);
  pendingResync.delete(postId);
}

export type PublishActionResult =
  { ok: true } | { ok: false; error: MessageKey } | { ok: false; problems: Problem[] };

function config() {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

/**
 * Send (or resend) the post's job for its planned time (`at` overrides it: "now") and record the reply on the
 * post. Shared by the hook's `schedule` and the auto-resync, so both write the same thing.
 */
async function sendJob(
  post: Post,
  status: SocialStatusMap | null,
  at?: string,
): Promise<PublishActionResult> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "settings.accounts.err.unconfigured" };
  const auto = autoPostOf(post);
  const problems = publishProblems(post, auto, status, { now: !!at });
  if (problems.length) return { ok: false, problems };
  const when = at ?? scheduledAtOf(post);
  if (!when) return { ok: false, problems: [{ code: "noDay" }] };
  const r = await publishSchedule(cfg, buildJob(post, auto, when));
  if (!r.ok) return { ok: false, error: socialSyncErrorMessageKey(r.error) };
  const now = new Date();
  useStore.getState().updatePost(post.id, {
    autoPost: {
      ...auto,
      sentAt: now.toISOString(),
      results: r.job.results,
      checkedAt: now.toISOString(),
    },
    ...(post.stage !== "posted" ? { stage: "scheduled" as const } : {}),
  });
  return { ok: true };
}

/** Writes a Worker job's results into its post; marks the post posted once every network is out. */
function applyJob(job: WorkerJob, markPosted: (id: string, url: string) => void, now: Date): void {
  const store = useStore.getState();
  const post = store.posts.find((p) => p.id === job.id);
  // Canceled here while the Worker still had it: nothing to follow.
  if (!post?.autoPost?.sentAt) return;
  const autoPost = {
    ...post.autoPost,
    results: { ...post.autoPost.results, ...job.results },
    checkedAt: now.toISOString(),
  };
  store.updatePost(post.id, { autoPost });
  if (autoPostSummary(autoPost) === "published" && post.stage !== "posted") {
    markPosted(post.id, firstPermalink(autoPost));
  }
}

export function usePublish() {
  const { configured, status } = useSocialSync();
  const { markPosted } = useGameActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const mark = useCallback((id: string, url: string) => void markPosted(id, url), [markPosted]);

  const done = (r: PublishActionResult): PublishActionResult => {
    setBusy(false);
    setError(!r.ok && "error" in r ? r.error : null);
    return r;
  };

  /**
   * Send (or resend) the post's job for its planned time; `at` overrides the time ("now"). A pending
   * auto-resync of the same post is dropped first, so one click sends the job once.
   */
  const schedule = async (post: Post, at?: string): Promise<PublishActionResult> => {
    cancelAutoResync(post.id);
    setBusy(true);
    return done(await sendJob(post, status, at));
  };

  /**
   * Publish everything that can go now (sends the job first). A post without a day gets today's (Riyadh)
   * first, so it shows on the calendar where it went out, but only once the job passes the checks; when the
   * Worker then refuses the job, the day this click added is taken off again.
   */
  const runNow = async (input: Post): Promise<PublishActionResult> => {
    if (!config()) return done({ ok: false, error: "settings.accounts.err.unconfigured" });
    const problems = publishProblems(input, autoPostOf(input), status, { now: true });
    if (problems.length) return done({ ok: false, problems });
    const today = input.plannedDay ? null : dayKey();
    const post = today
      ? (useStore.getState().updatePost(input.id, { plannedDay: today }) ?? input)
      : input;
    const sent = await schedule(post, new Date().toISOString());
    if (!sent.ok) {
      const latest = useStore.getState().posts.find((p) => p.id === input.id);
      if (today && latest?.plannedDay === today) {
        useStore.getState().updatePost(input.id, { plannedDay: null });
      }
      return sent;
    }
    const cfg = config();
    if (!cfg || !auto(post)) return sent;
    setBusy(true);
    const r = await publishRun(cfg, post.id);
    if (!r.ok) return done({ ok: false, error: socialSyncErrorMessageKey(r.error) });
    applyJob(r.job, mark, new Date());
    return done({ ok: true });
  };

  /** Take the job off the Worker (what is already out stays out). */
  const cancel = async (post: Post): Promise<PublishActionResult> => {
    const cfg = config();
    if (!cfg) return done({ ok: false, error: "settings.accounts.err.unconfigured" });
    cancelAutoResync(post.id);
    setBusy(true);
    const r = await publishCancel(cfg, post.id);
    if (!r.ok) return done({ ok: false, error: socialSyncErrorMessageKey(r.error) });
    const a = autoPostOf(post);
    useStore.getState().updatePost(post.id, {
      autoPost: { ...a, sentAt: undefined, results: {}, checkedAt: undefined },
    });
    return done({ ok: true });
  };

  return { configured, status, busy, error, schedule, runNow, cancel };
}

/** True when the post has an API network chosen (something for the Worker to do). */
function auto(post: Post): boolean {
  return autoPostOf(post).platforms.some(isSocialPlatform);
}

/**
 * What the Worker's job depends on, as one string, while the job can still be replaced: the post was sent
 * and nothing is published yet. Null when there is no job to keep fresh (a draft, a job already out, a
 * posted post).
 */
export function resyncKey(post: Post): string | null {
  const a = post.autoPost;
  if (!a?.sentAt || post.stage === "posted") return null;
  if (Object.values(a.results).some((r) => r?.state === "published")) return null;
  return JSON.stringify([
    post.caption,
    post.hashtags,
    post.plannedDay,
    post.plannedTime,
    a.captions,
    a.youtubeTitle,
  ]);
}

/**
 * Keeps a sent job fresh: when the caption, hashtags, day, time or a per-network caption of a post the
 * Worker already holds changes, the job is re-sent {@link RESYNC_DEBOUNCE_MS} after the last edit, from
 * whichever tab made it. Mounted once by the post popup. A change that leaves nothing to send (the day
 * removed) is skipped; "Update schedule" stays for an explicit resend.
 */
export function usePublishAutoResync(post: Post): void {
  const key = resyncKey(post);
  const seen = useRef(key);
  useEffect(() => {
    const before = seen.current;
    seen.current = key;
    // Nothing to follow, or the job was just sent (null → key): the Worker already has this version.
    if (key === null || before === null || before === key) return;
    const id = setTimeout(() => {
      pendingResync.delete(post.id);
      const store = useStore.getState();
      const latest = store.posts.find((p) => p.id === post.id);
      if (latest && resyncKey(latest) === key) void sendJob(latest, store.socialSync.status);
    }, RESYNC_DEBOUNCE_MS);
    pendingResync.set(post.id, id);
    return () => {
      clearTimeout(id);
      if (pendingResync.get(post.id) === id) pendingResync.delete(post.id);
    };
  }, [key, post.id]);
}

let refreshing: Promise<void> | null = null;

/** `GET /social/publish` and apply every job to its post. Concurrent callers share one request. */
export function refreshPublishJobs(markPosted: (id: string, url: string) => void): Promise<void> {
  if (refreshing) return refreshing;
  const cfg = config();
  if (!cfg) return Promise.resolve();
  refreshing = (async () => {
    const r = await publishList(cfg);
    if (!r.ok) return;
    const now = new Date();
    for (const job of r.jobs) applyJob(job, markPosted, now);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Keeps the results of running jobs fresh while a Social screen is open: one read on mount, then every
 * minute while some post is still scheduled or publishing and the page is visible, and one more read each
 * time the tab comes back into view (a phone that was locked while a video uploaded).
 */
export function usePublishWatcher(): void {
  const { markPosted } = useGameActions();
  const active = useStore((s) => s.posts.some((p) => autoPostActive(p.autoPost)));
  const configured = useStore(
    (s) => scoutConfig(s.settings.apiKeys.scoutUrl, s.settings.apiKeys.scoutToken) !== null,
  );

  useEffect(() => {
    if (!active || !configured) return;
    const mark = (id: string, url: string) => void markPosted(id, url);
    const tick = () => {
      if (document.visibilityState === "visible") void refreshPublishJobs(mark);
    };
    tick();
    const id = setInterval(tick, WATCH_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, configured, markPosted]);
}
