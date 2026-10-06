"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useGameActions } from "@/components/celebrate/useGameActions";
import type { AutoPost, Post, SocialStatusMap } from "@/lib/domain";
import type { MessageKey } from "@/lib/i18n";
import {
  autoPostActive,
  autoPostOf,
  canAutoMarkPosted,
  buildJob,
  firstPermalink,
  publishCancel,
  publishList,
  publishProblems,
  publishRun,
  publishSchedule,
  remoteJobs,
  scheduledAtOf,
  workerKey,
  tiktokCreatorInfo,
  tiktokCreatorProblems,
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
 * results again when the tab comes back into view. A7: a sent post keeps the Worker's job id
 * (`autoPost.jobId`), and the jobs no local post follows (sent from another device, or before this browser
 * was cleared) are kept from the last read for the hub (`useWorkerOnlyJobs`), where they can be canceled.
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
  if (auto.platforms.includes("tiktok") && auto.tiktokMode === "direct") {
    const creator = await tiktokCreatorInfo(cfg);
    const issues = tiktokCreatorProblems(auto, creator.ok ? creator.creator : undefined);
    if (issues.length) return { ok: false, problems: issues };
  }
  const when = at ?? scheduledAtOf(post);
  if (!when) return { ok: false, problems: [{ code: "noDay" }] };
  const r = await publishSchedule(cfg, buildJob(post, auto, when));
  if (!r.ok) return { ok: false, error: socialSyncErrorMessageKey(r.error) };
  const now = new Date();
  useStore.getState().updatePost(post.id, {
    autoPost: {
      ...auto,
      sentAt: now.toISOString(),
      jobId: r.job.id,
      results: r.job.results,
      ...(!(r.job.results.tiktok?.state === "published" && r.job.results.tiktok.inbox)
        ? { tiktokCompletedAt: undefined, tiktokPermalink: undefined }
        : {}),
      checkedAt: now.toISOString(),
    },
    ...(post.stage !== "posted" ? { stage: "scheduled" as const } : {}),
  });
  return { ok: true };
}

/**
 * Writes the Worker jobs' results into their posts, then marks each post posted once every network is out.
 * All in one save: every save writes the whole state, and while a burst of saves runs this tab cannot hear
 * another tab's saves, so the last of them would undo what was typed there meanwhile.
 */
export function applyJobs(
  jobs: readonly WorkerJob[],
  markPosted: (id: string, url: string) => void,
  now: Date,
): void {
  const store = useStore.getState();
  const next = new Map<string, AutoPost>();
  for (const job of jobs) {
    const post = store.posts.find((p) => p.id === job.id || p.autoPost?.jobId === job.id);
    // Canceled here while the Worker still had it: nothing to follow.
    if (!post?.autoPost?.sentAt) continue;
    const before = next.get(post.id) ?? post.autoPost;
    next.set(post.id, {
      ...before,
      results: { ...before.results, ...job.results },
      checkedAt: now.toISOString(),
    });
  }
  store.updatePosts(new Map([...next].map(([id, autoPost]) => [id, { autoPost }])), now);
  for (const [id, autoPost] of next) {
    const stage = store.posts.find((p) => p.id === id)?.stage;
    if (canAutoMarkPosted(autoPost) && stage !== "posted") markPosted(id, firstPermalink(autoPost));
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
    applyJobs([r.job], mark, new Date());
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
      autoPost: {
        ...a,
        sentAt: undefined,
        jobId: undefined,
        results: {},
        checkedAt: undefined,
        tiktokCompletedAt: undefined,
        tiktokPermalink: undefined,
      },
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

/* ---------- jobs no local post follows (A7) ---------- */

const NO_JOBS: readonly WorkerJob[] = [];

/**
 * The Worker-only jobs from the last successful read, with the Worker they were read from
 * ({@link workerKey}); module-level: one list for every screen. A list read from another Worker (the
 * settings changed since) is never shown or acted on.
 */
type WorkerOnly = { key: string | null; jobs: readonly WorkerJob[] };
const NO_WORKER_ONLY: WorkerOnly = { key: null, jobs: NO_JOBS };
let workerOnly: WorkerOnly = NO_WORKER_ONLY;
const workerOnlyListeners = new Set<() => void>();

function setWorkerOnly(key: string | null, jobs: readonly WorkerJob[]): void {
  workerOnly = { key, jobs };
  for (const l of workerOnlyListeners) l();
}

function subscribeWorkerOnly(listener: () => void): () => void {
  workerOnlyListeners.add(listener);
  return () => workerOnlyListeners.delete(listener);
}

/**
 * Orders reads and cancels. A job canceled from the hub keeps the step at which its `DELETE` came back, so a
 * read that started before then (and may still list it) leaves it out; a read that starts later shows it
 * again only if the job was really sent anew under the same id.
 */
let step = 0;
const canceledJobs = new Map<string, number>();

/** The ids a read that started at `startedAt` must leave out: the jobs canceled after it started. */
function canceledSince(startedAt: number): Set<string> {
  const out = new Set<string>();
  for (const [id, at] of canceledJobs) if (at > startedAt) out.add(id);
  return out;
}

/**
 * The Worker's jobs that no post in this browser follows, from the last read (`refreshPublishJobs`) of the
 * Worker the settings point at now (none for another Worker, or without one), filtered again against the
 * posts so a job this browser sends meanwhile drops out at once.
 */
export function useWorkerOnlyJobs(): WorkerJob[] {
  const cache = useSyncExternalStore(
    subscribeWorkerOnly,
    () => workerOnly,
    () => NO_WORKER_ONLY,
  );
  const key = useStore((s) =>
    workerKey(scoutConfig(s.settings.apiKeys.scoutUrl, s.settings.apiKeys.scoutToken)),
  );
  const posts = useStore((s) => s.posts);
  return useMemo(
    () => (key !== null && cache.key === key ? remoteJobs(cache.jobs, posts) : []),
    [cache, key, posts],
  );
}

/** `DELETE` a job this browser has no post for; on success it leaves the Worker-only list. */
export async function cancelWorkerJob(id: string): Promise<PublishActionResult> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "settings.accounts.err.unconfigured" };
  const key = workerKey(cfg);
  const r = await publishCancel(cfg, id);
  if (!r.ok) return { ok: false, error: socialSyncErrorMessageKey(r.error) };
  canceledJobs.set(id, ++step);
  if (workerOnly.key === key) {
    setWorkerOnly(
      key,
      workerOnly.jobs.filter((j) => j.id !== id),
    );
  }
  return { ok: true };
}

let refreshing: { key: string; promise: Promise<readonly WorkerJob[]> } | null = null;

/**
 * `GET /social/publish`: apply every job to its post, and keep (and return) the jobs no local post follows
 * for the hub. Concurrent callers for the same Worker share one request; a failed read keeps the last list.
 * Without a Worker the list is cleared; a reply that comes back after the settings moved to another Worker
 * is dropped (neither applied nor kept), and jobs canceled while the read was out stay out.
 */
export function refreshPublishJobs(
  markPosted: (id: string, url: string) => void,
): Promise<readonly WorkerJob[]> {
  const cfg = config();
  const key = workerKey(cfg);
  if (!cfg || key === null) {
    if (workerOnly.key !== null) setWorkerOnly(null, NO_JOBS);
    return Promise.resolve(NO_JOBS);
  }
  if (refreshing?.key === key) return refreshing.promise;
  const startedAt = ++step;
  const promise: Promise<readonly WorkerJob[]> = (async () => {
    const r = await publishList(cfg);
    // The settings point at another Worker now (or none): this list is not theirs.
    if (workerKey(config()) !== key) return NO_JOBS;
    if (!r.ok) return workerOnly.key === key ? workerOnly.jobs : NO_JOBS;
    applyJobs(r.jobs, markPosted, new Date());
    setWorkerOnly(key, remoteJobs(r.jobs, useStore.getState().posts, canceledSince(startedAt)));
    return workerOnly.jobs;
  })().finally(() => {
    if (refreshing?.promise === promise) refreshing = null;
  });
  refreshing = { key, promise };
  return promise;
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
