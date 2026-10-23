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
  jobClaim,
  jobOwnership,
  takenJobIds,
  publishCancel,
  publishJobId,
  publishList,
  publishListStrict,
  payloadHash,
  publishProblems,
  publishRun,
  publishSchedule,
  remoteJobs,
  scheduledAtOf,
  workerKey,
  tiktokCreatorInfo,
  tiktokCreatorProblems,
  type Problem,
  type TikTokCreator,
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

/**
 * Per-post lifecycle queue (DT-5 Amendment B): schedule, auto-resync, run and cancel of one post never overlap, so a
 * cancel's DELETE goes out only after a send already in flight has settled on the Worker.
 */
const lifecycle = new Map<string, Promise<unknown>>();
function serial<T>(postId: string, fn: () => Promise<T>): Promise<T> {
  const run = (lifecycle.get(postId) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  lifecycle.set(postId, tail);
  void tail.then(() => {
    if (lifecycle.get(postId) === tail) lifecycle.delete(postId);
  });
  return run;
}

/** Bumped by every cancel: a send that started before it never writes its reply back onto the post. */
const sendFence = new Map<string, number>();
const fenceOf = (postId: string) => sendFence.get(postId) ?? 0;

export type PublishActionResult =
  { ok: true } | { ok: false; error: MessageKey } | { ok: false; problems: Problem[] };

function config() {
  const k = useStore.getState().settings.apiKeys;
  return scoutConfig(k.scoutUrl, k.scoutToken);
}

const latestOf = (post: Post): Post =>
  useStore.getState().posts.find((p) => p.id === post.id) ?? post;

/**
 * Send (or resend) the post's job for its planned time (`at` overrides it: "now") and record the reply on the
 * post. Shared by the hook's `schedule` and the auto-resync, so both write the same thing. Call inside `serial`.
 * DT-5-R1: the one ownership decision first ({@link jobOwnership}: another post claiming the id → nothing is sent);
 * then, while the job is not confirmed (no `sentAt`), the id is allocated through the store's locked commit with a
 * read-back of the stored post (`allocatePublishJobId`), and the create goes out only once storage holds it. A lost
 * reply, another post leaving or a reload never makes the retry pick a different id; a refused write sends nothing.
 * DT-5-R2: after the awaits the post is read again from the store — gone, cancelled (fence moved) or holding another
 * id → `publish.superseded`; another claimant → `publish.err.ambiguousOwner` — and the job is validated and built from
 * that fresh post, so what is sent (and confirmed with `sentAt` + `sentHash`) is the newest content.
 */
async function sendJob(
  input: Post,
  status: SocialStatusMap | null,
  at?: string,
): Promise<PublishActionResult> {
  const fence = fenceOf(input.id);
  const post = latestOf(input);
  const cfg = config();
  if (!cfg) return { ok: false, error: "settings.accounts.err.unconfigured" };
  const auto = autoPostOf(post);
  const problems = publishProblems(post, auto, status, { now: !!at });
  if (problems.length) return { ok: false, problems };
  let creator: TikTokCreator | undefined;
  const asked = needsCreator(auto);
  if (asked) {
    const info = await tiktokCreatorInfo(cfg);
    creator = info.ok ? info.creator : undefined;
    const issues = tiktokCreatorProblems(auto, creator);
    if (issues.length) return { ok: false, problems: issues };
  }
  if (!(at ?? scheduledAtOf(post))) return { ok: false, problems: [{ code: "noDay" }] };
  if (fenceOf(post.id) !== fence) return { ok: false, error: "publish.superseded" };
  const posts = useStore.getState().posts;
  const own = jobOwnership(latestOf(post), posts);
  if (!own.ok && own.reason === "ambiguous")
    return { ok: false, error: ownershipError(own.reason) };
  const jobId = own.ok ? own.jobId : publishJobId(post, takenJobIds(posts, post.id));
  const before = latestOf(post).autoPost;
  if (!before?.sentAt || before.jobId !== jobId) {
    const allocated = await useStore.getState().allocatePublishJobId(post.id, jobId);
    if (!allocated.ok)
      return {
        ok: false,
        error:
          allocated.reason === "ambiguous" ? ownershipError("ambiguous") : "publish.err.allocation",
      };
  }
  // DT-5-R2: the allocation awaited; decide again on the post as it is now.
  const fresh = useStore.getState().posts.find((p) => p.id === post.id);
  if (!fresh || fenceOf(post.id) !== fence) return { ok: false, error: "publish.superseded" };
  const owner = jobOwnership(fresh, useStore.getState().posts);
  if (!owner.ok && owner.reason === "ambiguous")
    return { ok: false, error: ownershipError(owner.reason) };
  if (!owner.ok || owner.jobId !== jobId) return { ok: false, error: "publish.superseded" };
  const freshAuto = autoPostOf(fresh);
  const freshProblems = publishProblems(fresh, freshAuto, status, { now: !!at });
  if (freshProblems.length) return { ok: false, problems: freshProblems };
  if (needsCreator(freshAuto)) {
    // TikTok direct posting was turned on while this send waited: its creator check never ran.
    if (!asked) return { ok: false, error: "publish.superseded" };
    const issues = tiktokCreatorProblems(freshAuto, creator);
    if (issues.length) return { ok: false, problems: issues };
  }
  const when = at ?? scheduledAtOf(fresh);
  if (!when) return { ok: false, problems: [{ code: "noDay" }] };
  const job = { ...buildJob(fresh, freshAuto, when), id: jobId };
  const r = await publishSchedule(cfg, job);
  // Canceled while this send was out: the cancel queued behind it removes the job; nothing is written here.
  if (fenceOf(post.id) !== fence) return { ok: false, error: "publish.superseded" };
  if (!r.ok) return { ok: false, error: socialSyncErrorMessageKey(r.error) };
  const now = new Date();
  const latest = latestOf(fresh);
  useStore.getState().updatePost(post.id, {
    autoPost: {
      ...autoPostOf(latest),
      sentAt: now.toISOString(),
      // What reached the Worker; an edit made while the create was out no longer matches it (auto-resync).
      sentHash: payloadHash(job, !at),
      jobId,
      results: r.job.results,
      ...(!(r.job.results.tiktok?.state === "published" && r.job.results.tiktok.inbox)
        ? { tiktokCompletedAt: undefined, tiktokPermalink: undefined }
        : {}),
      checkedAt: now.toISOString(),
    },
    ...(latest.stage !== "posted" ? { stage: "scheduled" as const } : {}),
  });
  return { ok: true };
}

/** TikTok direct posting needs the creator's capabilities read before a send. */
const needsCreator = (auto: AutoPost) =>
  auto.platforms.includes("tiktok") && auto.tiktokMode === "direct";

/**
 * Whether the Worker holds this post's current content (DT-5-R2): its `sentHash` matches the job rebuilt from the
 * post now, with its planned time or as a "now" send. A post without a `sentHash` (sent before it was kept, or
 * confirmed by a read after a lost reply) is taken as current, as before.
 */
function sentCurrent(post: Post): boolean {
  const a = post.autoPost;
  if (!a?.sentHash || !a.jobId) return true;
  const job = { ...buildJob(post, autoPostOf(post), scheduledAtOf(post) ?? ""), id: a.jobId };
  return a.sentHash === payloadHash(job, true) || a.sentHash === payloadHash(job, false);
}

/** The existing job a run or cancel acts on, or the reason it is blocked (never a new allocation). */
function existingJob(post: Post): { ok: true; id: string } | { ok: false; error: MessageKey } {
  const r = jobOwnership(latestOf(post), useStore.getState().posts);
  return r.ok ? { ok: true, id: r.jobId } : { ok: false, error: ownershipError(r.reason) };
}

/** The error a blocked ownership decision shows (DT-5-R1 R1). */
function ownershipError(reason: "ambiguous" | "unallocated"): MessageKey {
  return reason === "ambiguous" ? "publish.err.ambiguousOwner" : "publish.jobMissing";
}

/**
 * Writes the Worker jobs' results into their posts, then marks each post posted once every network is out.
 * All in one save: every save writes the whole state, and while a burst of saves runs this tab cannot hear
 * another tab's saves, so the last of them would undo what was typed there meanwhile. DT-5-R1 R3: a job is applied
 * only to its one owner ({@link jobClaim}); a job two posts remember is a conflict: nothing is copied or marked posted
 * (the hub lists it with its claimants). R4: the owner's unconfirmed allocation (create reply lost) that the Worker
 * does hold is confirmed here (`sentAt`, scheduled).
 */
export function applyJobs(
  jobs: readonly WorkerJob[],
  markPosted: (id: string, url: string) => void,
  now: Date,
): void {
  const store = useStore.getState();
  const next = new Map<string, AutoPost>();
  const confirmed = new Set<string>();
  for (const job of jobs) {
    const claim = jobClaim(job.id, store.posts);
    // Nobody here (canceled here while the Worker still had it), or two claimants: nothing to apply.
    if (!claim || !("owner" in claim) || !claim.owner.autoPost) continue;
    const post = claim.owner;
    const before = next.get(post.id) ?? claim.owner.autoPost;
    if (!before.sentAt) confirmed.add(post.id);
    next.set(post.id, {
      ...before,
      sentAt: before.sentAt ?? now.toISOString(),
      results: { ...before.results, ...job.results },
      checkedAt: now.toISOString(),
    });
  }
  store.updatePosts(
    new Map(
      [...next].map(([id, autoPost]) => {
        const stage = store.posts.find((p) => p.id === id)?.stage;
        const scheduled = confirmed.has(id) && stage !== "posted";
        return [id, { autoPost, ...(scheduled ? { stage: "scheduled" as const } : {}) }];
      }),
    ),
    now,
  );
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
    return done(await serial(post.id, () => sendJob(post, status, at)));
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
    // A job id another post also claims: blocked before anything is sent (or a day is added).
    const own = jobOwnership(latestOf(input), useStore.getState().posts);
    if (!own.ok && own.reason === "ambiguous")
      return done({ ok: false, error: ownershipError(own.reason) });
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
    const r = await serial(post.id, async () => {
      const job = existingJob(post);
      if (!job.ok) return job;
      const res = await publishRun(cfg, job.id);
      if (!res.ok) return { ok: false as const, error: socialSyncErrorMessageKey(res.error) };
      applyJobs([res.job], mark, new Date());
      return { ok: true as const };
    });
    return done(r);
  };

  /**
   * Take the job off the Worker (what is already out stays out). A send already in flight settles first and its
   * reply is dropped; the DELETE then removes whatever it committed.
   */
  const cancel = async (post: Post): Promise<PublishActionResult> => {
    const cfg = config();
    if (!cfg) return done({ ok: false, error: "settings.accounts.err.unconfigured" });
    const blocked = existingJob(post);
    if (!blocked.ok && blocked.error === "publish.err.ambiguousOwner") return done(blocked);
    cancelAutoResync(post.id);
    sendFence.set(post.id, fenceOf(post.id) + 1);
    setBusy(true);
    const r = await serial(post.id, async (): Promise<PublishActionResult> => {
      const job = existingJob(post);
      if (!job.ok) return job;
      const res = await publishCancel(cfg, job.id);
      if (!res.ok) return { ok: false, error: socialSyncErrorMessageKey(res.error) };
      useStore.getState().updatePost(post.id, {
        autoPost: {
          ...autoPostOf(latestOf(post)),
          sentAt: undefined,
          sentHash: undefined,
          jobId: undefined,
          results: {},
          checkedAt: undefined,
          tiktokCompletedAt: undefined,
          tiktokPermalink: undefined,
        },
      });
      return { ok: true };
    });
    return done(r);
  };

  /**
   * DT-5-R1 R4: read the Worker for the post's unconfirmed allocation (no `sentAt`), queued behind any send of the
   * post so no create is in flight. `found` confirms it ({@link applyJobs}); `absent` only from a successful read
   * without the id; a failed read is `unknown`, never absent. `none`: nothing unconfirmed to check.
   */
  const checkAllocation = (post: Post): Promise<AllocationCheck> =>
    serial(post.id, () => readAllocation(post, mark));

  /**
   * Forget the post's unconfirmed allocation, only after a fresh successful read (in the same queued step) shows the
   * Worker does not hold that id. Unknown (offline) or held → kept; a held job is confirmed and cancelled instead.
   */
  const discardAllocation = async (post: Post): Promise<PublishActionResult> => {
    setBusy(true);
    const r = await serial(post.id, async (): Promise<PublishActionResult> => {
      const jobId = latestOf(post).autoPost?.jobId;
      const check = await readAllocation(post, mark);
      if (check === "none" || !jobId) return { ok: true };
      if (check === "unknown") return { ok: false, error: "publish.unconfirmed.unknown" };
      if (check === "found") return { ok: false, error: "publish.unconfirmed.found" };
      const released = await useStore.getState().releasePublishJobId(post.id, jobId);
      return released.ok ? { ok: true } : { ok: false, error: "publish.err.allocation" };
    });
    return done(r);
  };

  return {
    configured,
    status,
    busy,
    error,
    schedule,
    runNow,
    cancel,
    checkAllocation,
    discardAllocation,
  };
}

export type AllocationCheck = "found" | "absent" | "unknown" | "none";

/** One Worker read for a post's unconfirmed allocation (call inside the post's `serial`). */
async function readAllocation(
  post: Post,
  markPosted: (id: string, url: string) => void,
): Promise<AllocationCheck> {
  const a = latestOf(post).autoPost;
  if (!a?.jobId || a.sentAt) return "none";
  const cfg = config();
  if (!cfg) return "unknown";
  const key = workerKey(cfg);
  // DT-5-R2 (R1-D): only a complete, valid list proves absence; a malformed 200 is unknown like a failed read.
  const r = await publishListStrict(cfg);
  if (!r.ok || workerKey(config()) !== key) return "unknown";
  if (!r.jobs.some((j) => j.id === a.jobId)) return "absent";
  applyJobs(r.jobs, markPosted, new Date());
  return "found";
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
    a.firstComment,
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
    // Nothing to follow, or the job was just sent (null → key) and the Worker has this version (DT-5-R2: its sent
    // digest still matches; an edit made while the create was out is re-sent).
    if (key === null || before === key) return;
    const stored = useStore.getState().posts.find((p) => p.id === post.id);
    if (before === null && (!stored || sentCurrent(stored))) return;
    const id = setTimeout(() => {
      pendingResync.delete(post.id);
      const store = useStore.getState();
      const latest = store.posts.find((p) => p.id === post.id);
      if (!latest || resyncKey(latest) !== key) return;
      // The fence at fire time: a cancel clicked before this send starts drops it (never resync while cancelled).
      const fence = fenceOf(post.id);
      void serial(post.id, async () => {
        const now = useStore.getState().posts.find((p) => p.id === post.id);
        if (fenceOf(post.id) !== fence || !now || resyncKey(now) !== key) return;
        await sendJob(now, useStore.getState().socialSync.status);
      });
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
