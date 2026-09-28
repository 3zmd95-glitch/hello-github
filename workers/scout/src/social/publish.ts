/**
 * The auto-post queue (Metricool-style "write once, post everywhere"). The dashboard sends one job per
 * calendar post — the media URL, the time and a caption per platform — and the five-minute cron publishes
 * each platform when the time comes, step by step (`publishers.ts`). The whole queue is one KV document
 * (`publish:jobs`): a tick costs one read when nothing is due, and a write only when something moved.
 *
 *   GET    /social/publish                           → { jobs }
 *   POST   /social/publish            { id, scheduledAt, media?, targets } → { job }   add or replace
 *   POST   /social/publish/:id/run                   → { job }        publish now (the parts that can go now)
 *   DELETE /social/publish/:id                       → { ok: true }
 */

import { Budget, type Http } from "./http";
import { credentials, isExpired, PROVIDERS } from "./oauth";
import {
  PublishError,
  STEP_MIN_BUDGET,
  STEPS,
  type MediaKind,
  type PublishErrorCode,
  type PublishMedia,
  type PublishTarget,
  type TargetSpec,
} from "./publishers";
import { Store, type SocialEnv } from "./store";
import {
  isSocialPlatform,
  SOCIAL_PLATFORMS,
  SocialError,
  type SocialErrorCode,
  type SocialPlatform,
  type TokenSet,
} from "./types";

export interface PublishJob {
  /** The dashboard's calendar post id. */
  id: string;
  /** ISO: not published before this. */
  scheduledAt: string;
  media?: PublishMedia;
  targets: Partial<Record<SocialPlatform, PublishTarget>>;
  createdAt: string;
  updatedAt: string;
  /** ISO: a run is working on this job until then (keeps the cron and "post now" from both publishing). */
  lockUntil?: string;
}

/**
 * Outbound calls one run may make. The free plan allows 50 subrequests per invocation, KV included: the
 * queue read and writes, up to four token reads and refresh writes and a status read leave this many.
 */
export const PUBLISH_BUDGET = 34;
/** Transient failures (upstream, rate limit) are retried this many times, 5, 10, 15 … minutes apart. */
export const MAX_ATTEMPTS = 4;
export const RETRY_STEP_MS = 5 * 60_000;
/** A container or upload still processing after this long is given up on. */
export const PROCESSING_TIMEOUT_MS = 2 * 60 * 60_000;
export const LOCK_MS = 10 * 60_000;
/** Finished jobs are forgotten after this long; the queue never holds more than MAX_JOBS. */
export const KEEP_FINISHED_MS = 30 * 24 * 60 * 60_000;
export const MAX_JOBS = 200;

/** Caption limits per platform (YouTube: the description). */
export const CAPTION_MAX: Record<SocialPlatform, number> = {
  instagram: 2200,
  threads: 500,
  youtube: 5000,
  tiktok: 2200,
};

/** What each platform can post: Threads also takes text alone; YouTube and TikTok only video here. */
export const ACCEPTS: Record<SocialPlatform, (MediaKind | "text")[]> = {
  instagram: ["video", "image"],
  threads: ["video", "image", "text"],
  youtube: ["video"],
  tiktok: ["video"],
};

const ACTIVE = new Set(["queued", "processing"]);
const isActive = (t: PublishTarget | undefined): t is PublishTarget => !!t && ACTIVE.has(t.state);

/* ---------- validation ---------- */

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const YT_PRIVACY = ["public", "unlisted", "private"];
const TT_PRIVACY = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
];

export interface JobInput {
  id: string;
  scheduledAt: string;
  media?: PublishMedia;
  targets: Partial<Record<SocialPlatform, TargetSpec>>;
}

/** The request body as a JobInput, or the reason it is refused. */
export function parseJobInput(
  body: unknown,
): { ok: true; job: JobInput } | { ok: false; detail: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const bad = (detail: string) => ({ ok: false as const, detail });
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return bad("id");
  if (typeof b.scheduledAt !== "string" || Number.isNaN(Date.parse(b.scheduledAt))) {
    return bad("scheduledAt");
  }
  let media: PublishMedia | undefined;
  if (b.media !== undefined && b.media !== null) {
    const m = b.media as Record<string, unknown>;
    let url: URL | null = null;
    try {
      url = typeof m.url === "string" ? new URL(m.url) : null;
    } catch {
      url = null;
    }
    if (!url || url.protocol !== "https:") return bad("media.url");
    if (m.kind !== "video" && m.kind !== "image") return bad("media.kind");
    media = { url: url.toString(), kind: m.kind };
  }
  const raw = b.targets;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("targets");
  const targets: Partial<Record<SocialPlatform, TargetSpec>> = {};
  for (const [p, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSocialPlatform(p)) return bad(`targets.${p}`);
    const s = (spec ?? {}) as Record<string, unknown>;
    const caption = typeof s.caption === "string" ? s.caption : "";
    if (caption.length > CAPTION_MAX[p]) return bad(`${p}.caption`);
    if (!ACCEPTS[p].includes(media?.kind ?? "text")) return bad(`${p}.media`);
    if (!media && !caption.trim()) return bad(`${p}.caption`);
    const out: TargetSpec = { caption };
    if (p === "youtube") {
      if (typeof s.title === "string" && s.title.trim()) out.title = s.title.trim().slice(0, 100);
      if (typeof s.privacy === "string" && YT_PRIVACY.includes(s.privacy)) out.privacy = s.privacy;
    }
    if (p === "tiktok") {
      if (typeof s.privacy === "string" && TT_PRIVACY.includes(s.privacy)) out.privacy = s.privacy;
      if (s.tiktokMode === "inbox" || s.tiktokMode === "direct") out.tiktokMode = s.tiktokMode;
    }
    targets[p] = out;
  }
  if (!Object.keys(targets).length) return bad("targets");
  return {
    ok: true,
    job: { id: b.id, scheduledAt: new Date(b.scheduledAt).toISOString(), media, targets },
  };
}

/**
 * The job after an add/replace: platforms already processing or published keep their state (a post cannot
 * be taken back); every other platform starts over as `queued` with the new spec. A run's lock stays, so a
 * replace during a run cannot let "run" publish the same job a second time.
 */
export function mergeJob(existing: PublishJob | undefined, input: JobInput, now: Date): PublishJob {
  const targets: Partial<Record<SocialPlatform, PublishTarget>> = {};
  for (const p of SOCIAL_PLATFORMS) {
    const old = existing?.targets[p];
    if (old && (old.state === "processing" || old.state === "published")) targets[p] = old;
    else if (input.targets[p]) targets[p] = { ...input.targets[p], state: "queued", attempts: 0 };
  }
  return {
    id: input.id,
    scheduledAt: input.scheduledAt,
    ...(input.media ? { media: input.media } : {}),
    targets,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    ...(existing?.lockUntil ? { lockUntil: existing.lockUntil } : {}),
  };
}

/** Drops finished jobs older than KEEP_FINISHED_MS and keeps the newest MAX_JOBS. */
export function prune(jobs: Record<string, PublishJob>, now: Date): Record<string, PublishJob> {
  const kept = Object.values(jobs)
    .filter(
      (j) =>
        Object.values(j.targets).some(isActive) ||
        now.getTime() - Date.parse(j.updatedAt) < KEEP_FINISHED_MS,
    )
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1))
    .slice(0, MAX_JOBS);
  return Object.fromEntries(kept.map((j) => [j.id, j]));
}

/* ---------- the runner ---------- */

export interface RunDeps {
  fetch?: typeof fetch;
  now?: Date;
  budget?: number;
  /** Run this job now even if its time has not come (and ignore its lock). */
  only?: string;
}

export interface RunResult {
  /** "<jobId>:<platform>" of every target that moved. */
  advanced: string[];
  published: string[];
  failed: string[];
}

const due = (t: PublishTarget, now: Date) => !t.nextAt || Date.parse(t.nextAt) <= now.getTime();

function failure(
  t: PublishTarget,
  code: PublishErrorCode,
  detail: string | undefined,
): PublishTarget {
  return {
    ...t,
    state: "failed",
    error: code,
    ...(detail ? { detail: detail.slice(0, 300) } : {}),
    nextAt: undefined,
  };
}

/** Retry later, or fail for good after MAX_ATTEMPTS. */
function retryOrFail(
  t: PublishTarget,
  code: PublishErrorCode,
  detail: string | undefined,
  now: Date,
): PublishTarget {
  const attempts = t.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return failure({ ...t, attempts }, code, detail);
  return {
    ...t,
    attempts,
    error: code,
    ...(detail ? { detail: detail.slice(0, 300) } : {}),
    nextAt: new Date(now.getTime() + RETRY_STEP_MS * attempts).toISOString(),
  };
}

function toPublishCode(e: unknown): {
  code: PublishErrorCode;
  detail?: string;
  transient: boolean;
} {
  if (e instanceof PublishError) {
    return {
      code: e.code,
      detail: e.message,
      transient: e.code === "upstream" || e.code === "rate_limited",
    };
  }
  if (e instanceof SocialError) {
    const map: Partial<Record<SocialErrorCode, PublishErrorCode>> = {
      token_expired: "token_expired",
      rate_limited: "rate_limited",
      not_connected: "not_connected",
    };
    const code = map[e.code] ?? "upstream";
    return { code, detail: e.message, transient: code === "upstream" || code === "rate_limited" };
  }
  return { code: "upstream", detail: String((e as Error)?.message ?? e), transient: true };
}

/** Tokens for a platform, refreshed when due (the refreshed set is stored), or the reason there are none. */
async function tokensFor(
  env: SocialEnv,
  store: Store,
  platform: SocialPlatform,
  http: Http,
  now: Date,
): Promise<TokenSet | PublishErrorCode> {
  const creds = credentials(env, platform);
  let tokens = await store.getTokens(platform);
  if (!creds || !tokens) return "not_connected";
  if (!tokens.canPublish) return "no_permission";
  const provider = PROVIDERS[platform];
  if (provider.needsRefresh(tokens, now)) {
    tokens = await provider.refresh(creds, tokens, http, now);
    await store.putTokens(platform, tokens);
  } else if (isExpired(tokens, now)) {
    return "token_expired";
  }
  return tokens;
}

/**
 * Publishes what is due: every queued or processing platform of every job whose time has come, oldest job
 * first, while the call budget lasts (the rest waits for the next tick). Never throws.
 */
export async function runDue(env: SocialEnv, deps: RunDeps = {}): Promise<RunResult> {
  const result: RunResult = { advanced: [], published: [], failed: [] };
  const store = Store.from(env);
  if (!store) return result;
  const now = deps.now ?? new Date();
  const loaded = await store.getJobs<PublishJob>();
  const jobs = prune(loaded, now);
  const work = Object.values(jobs)
    .filter((j) => (deps.only ? j.id === deps.only : Date.parse(j.scheduledAt) <= now.getTime()))
    .filter((j) => deps.only || !j.lockUntil || Date.parse(j.lockUntil) <= now.getTime())
    .filter((j) => Object.values(j.targets).some((t) => isActive(t) && (deps.only || due(t, now))))
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));
  if (!work.length) {
    if (Object.keys(jobs).length !== Object.keys(loaded).length) await store.putJobs(jobs);
    return result;
  }

  // Claim the jobs before any platform call.
  const lockUntil = new Date(now.getTime() + LOCK_MS).toISOString();
  for (const j of work) jobs[j.id] = { ...j, lockUntil };
  await store.putJobs(jobs);

  const http: Http = {
    fetch: deps.fetch ?? fetch,
    budget: new Budget(deps.budget ?? PUBLISH_BUDGET),
  };
  const tokenCache = new Map<SocialPlatform, TokenSet | PublishErrorCode>();
  let handle: string | undefined;

  for (const j of work) {
    const job = jobs[j.id];
    for (const p of SOCIAL_PLATFORMS) {
      const t = job.targets[p];
      if (!isActive(t) || (!deps.only && !due(t, now))) continue;
      if (http.budget.left < STEP_MIN_BUDGET[p]) continue;
      const key = `${job.id}:${p}`;
      let next: PublishTarget;
      try {
        if (t.state === "processing" && t.startedAt) {
          if (now.getTime() - Date.parse(t.startedAt) > PROCESSING_TIMEOUT_MS) {
            throw new PublishError("timeout", "still processing after two hours");
          }
        }
        if (!tokenCache.has(p)) tokenCache.set(p, await tokensFor(env, store, p, http, now));
        const tokens = tokenCache.get(p)!;
        if (typeof tokens === "string") throw new PublishError(tokens);
        if (p === "tiktok" && t.state === "processing" && handle === undefined) {
          handle = (await store.getStatus("tiktok"))?.handle ?? "";
        }
        next = await STEPS[p](t, {
          http,
          tokens,
          media: job.media,
          now,
          handle: handle || undefined,
        });
      } catch (e) {
        const { code, detail, transient } = toPublishCode(e);
        if (code === "token_expired") tokenCache.set(p, "token_expired");
        next = transient ? retryOrFail(t, code, detail, now) : failure(t, code, detail);
      }
      job.targets[p] = next;
      result.advanced.push(key);
      if (next.state === "published") result.published.push(key);
      if (next.state === "failed") result.failed.push(key);
    }
    const { lockUntil: _released, ...rest } = job;
    void _released;
    jobs[j.id] = { ...rest, updatedAt: now.toISOString() };
  }
  await store.putJobs(jobs);
  return result;
}

/* ---------- HTTP ---------- */

interface Reply {
  json(body: unknown, status: number): Response;
  fail(error: SocialErrorCode): Response;
}

const sorted = (jobs: Record<string, PublishJob>) =>
  Object.values(jobs).sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));

/** `/social/publish[/:id[/run]]`; `rest` is the path after "publish". Null when the path is not ours. */
export async function handlePublish(
  req: Request,
  env: SocialEnv,
  rest: string[],
  store: Store | null,
  now: Date,
  fetchImpl: typeof fetch | undefined,
  reply: Reply,
): Promise<Response | null> {
  const [id, action, extra] = rest;
  if (extra !== undefined) return null;

  if (!id && req.method === "GET") {
    if (!store) return reply.fail("not_configured");
    return reply.json({ jobs: sorted(await store.getJobs<PublishJob>()) }, 200);
  }

  if (!id && req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return reply.json({ error: "bad_request", detail: "json" }, 400);
    }
    const parsed = parseJobInput(body);
    if (!parsed.ok) return reply.json({ error: "bad_request", detail: parsed.detail }, 400);
    if (!store) return reply.fail("not_configured");
    const jobs = prune(await store.getJobs<PublishJob>(), now);
    const job = mergeJob(jobs[parsed.job.id], parsed.job, now);
    jobs[job.id] = job;
    await store.putJobs(jobs);
    return reply.json({ job }, 200);
  }

  if (!id || !ID_RE.test(id)) return null;

  if (!action && req.method === "DELETE") {
    if (!store) return reply.fail("not_configured");
    const jobs = await store.getJobs<PublishJob>();
    if (jobs[id]) {
      delete jobs[id];
      await store.putJobs(jobs);
    }
    return reply.json({ ok: true }, 200);
  }

  if (action === "run" && req.method === "POST") {
    if (!store) return reply.fail("not_configured");
    const jobs = await store.getJobs<PublishJob>();
    const job = jobs[id];
    if (!job) return reply.json({ error: "not_found" }, 404);
    if (job.lockUntil && Date.parse(job.lockUntil) > now.getTime()) {
      return reply.json({ job }, 200);
    }
    if (Date.parse(job.scheduledAt) > now.getTime()) {
      jobs[id] = { ...job, scheduledAt: now.toISOString() };
      await store.putJobs(jobs);
    }
    await runDue(env, { fetch: fetchImpl, now, only: id });
    const after = (await store.getJobs<PublishJob>())[id] ?? job;
    return reply.json({ job: after }, 200);
  }

  return null;
}
