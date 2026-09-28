"use client";

import { useCallback, useEffect, useState } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import type { Post } from "@/lib/domain";
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
import { useStore } from "@/store";
import { useSocialSync } from "./useSocialSync";

/**
 * 🚀 Auto-posting glue between the calendar and the Worker's publish queue: send a post's job, publish now,
 * cancel, and read the per-platform results back into the post. When every network is out, the post is
 * marked as posted with the first link (the Produce quest bridge, with its celebration).
 */

/** While a job is still running, check back this often (the cron itself ticks every five minutes). */
export const WATCH_INTERVAL_MS = 60_000;

export type PublishActionResult =
  { ok: true } | { ok: false; error: MessageKey } | { ok: false; problems: Problem[] };

function config() {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
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

  /** Send (or resend) the post's job for its planned time; `at` overrides the time ("now"). */
  const schedule = async (post: Post, at?: string): Promise<PublishActionResult> => {
    const cfg = config();
    if (!cfg) return done({ ok: false, error: "settings.accounts.err.unconfigured" });
    const auto = autoPostOf(post);
    const problems = publishProblems(post, auto, status, { now: !!at });
    if (problems.length) return done({ ok: false, problems });
    const when = at ?? scheduledAtOf(post);
    if (!when) return done({ ok: false, problems: [{ code: "noDay" }] });
    setBusy(true);
    const r = await publishSchedule(cfg, buildJob(post, auto, when));
    if (!r.ok) return done({ ok: false, error: socialSyncErrorMessageKey(r.error) });
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
    return done({ ok: true });
  };

  /** Publish everything that can go now (sends the job first). */
  const runNow = async (post: Post): Promise<PublishActionResult> => {
    const sent = await schedule(post, new Date().toISOString());
    if (!sent.ok) return sent;
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
 * minute while some post is still scheduled or publishing and the page is visible.
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
    return () => clearInterval(id);
  }, [active, configured, markPosted]);
}
