import {
  AutoPostResultSchema,
  AutoPostSchema,
  type AutoPost,
  type AutoPostResult,
  type Platform,
  type Post,
  type SocialStatusMap,
} from "./domain";
import { bestTime, PLATFORM_META } from "./social";
import type { ScoutConfig } from "./scoutClient";
import {
  call,
  isSocialPlatform,
  post as jsonPost,
  type SocialPlatform,
  type SocialResult,
  type SocialSyncOpts,
} from "./socialSync";

/**
 * 🚀 Auto-posting rules (Metricool-style "write once, post everywhere"): which networks the Worker can post
 * to, the caption each one gets, when the job fires, what blocks it, how the Worker's job maps back onto the
 * post, and the manual fallback for X and Snapchat. Pure functions; `components/social/usePublish.ts` calls
 * the Worker and writes the results into the store.
 */

/** Networks without a free publishing API: they stay a reminder with copy + open the app. */
export const MANUAL_PLATFORMS: readonly Platform[] = ["x", "snapchat"];

export const isManual = (p: Platform) => MANUAL_PLATFORMS.includes(p);

/** Caption limits the Worker enforces (YouTube: the description); X and Snapchat from PLATFORM_META. */
export const CAPTION_MAX: Record<Platform, number> = {
  tiktok: 2200,
  instagram: 2200,
  youtube: 5000,
  threads: 500,
  x: PLATFORM_META.x.captionLimit,
  snapchat: PLATFORM_META.snapchat.captionLimit,
};

export const YT_TITLE_MAX = 100;

/** The Auto-post settings of a post, with the defaults filled in (its own platform preselected). */
export function autoPostOf(post: Post): AutoPost {
  return post.autoPost ?? AutoPostSchema.parse({ platforms: [post.platform] });
}

/** The post's caption with its hashtags, the default text on every network. */
export function defaultCaption(post: Post): string {
  return [post.caption.trim(), post.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

/** What a network will get: the override if one was typed, else the default caption. */
export function captionFor(post: Post, auto: AutoPost, platform: Platform): string {
  const own = auto.captions[platform];
  return own !== undefined && own.trim() ? own : defaultCaption(post);
}

/**
 * When the job fires: the planned day at the planned time (Riyadh, UTC+3, no DST), or the platform's best time
 * when no time is set. Null without a planned day.
 */
export function scheduledAtOf(post: Post): string | null {
  if (!post.plannedDay) return null;
  const time = post.plannedTime ?? bestTime(post.platform, post.plannedDay);
  return new Date(`${post.plannedDay}T${time}:00+03:00`).toISOString();
}

/**
 * Share links as a link to the file itself, which is what Instagram, Threads, YouTube and TikTok need:
 *   Dropbox  www.dropbox.com/…?dl=0  → dl.dropboxusercontent.com/… (raw file)
 *   Drive    drive.google.com/file/d/<id>/view → drive.usercontent.google.com/download?id=<id>&export=download&confirm=t
 * Anything else is returned trimmed.
 */
export function directMediaUrl(raw: string): string {
  const url = raw.trim();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.hostname === "www.dropbox.com" || u.hostname === "dropbox.com") {
    u.hostname = "dl.dropboxusercontent.com";
    u.searchParams.delete("dl");
    return u.toString();
  }
  if (u.hostname === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? u.searchParams.get("id");
    if (id) {
      return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
    }
  }
  return url;
}

/** Which media each API network can take ("none" = text alone). */
const ACCEPTS: Record<SocialPlatform, readonly AutoPost["mediaKind"][]> = {
  instagram: ["video", "image"],
  threads: ["video", "image", "none"],
  youtube: ["video"],
  tiktok: ["video"],
};

export type ProblemCode =
  | "noPlatforms"
  | "manualOnly"
  | "noDay"
  | "noMedia"
  | "badUrl"
  | "needsVideo"
  | "needsMedia"
  | "tooLong"
  | "empty"
  | "notConnected"
  | "noPermission";

export interface Problem {
  code: ProblemCode;
  platform?: Platform;
}

const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Everything that would stop the Worker from taking or finishing the job. `status` is the last connection
 * reply (null when unknown: connection problems are then not reported). `now` skips the day check.
 */
export function publishProblems(
  post: Post,
  auto: AutoPost,
  status: SocialStatusMap | null,
  { now = false }: { now?: boolean } = {},
): Problem[] {
  const out: Problem[] = [];
  if (!auto.platforms.length) out.push({ code: "noPlatforms" });
  else if (!auto.platforms.some(isSocialPlatform)) out.push({ code: "manualOnly" });
  if (!now && !post.plannedDay && auto.platforms.length) out.push({ code: "noDay" });
  const kind = auto.mediaKind;
  if (kind !== "none") {
    if (!auto.mediaUrl.trim()) out.push({ code: "noMedia" });
    else if (!isHttps(directMediaUrl(auto.mediaUrl))) out.push({ code: "badUrl" });
  }
  for (const p of auto.platforms) {
    const text = captionFor(post, auto, p);
    if (text.length > CAPTION_MAX[p]) out.push({ code: "tooLong", platform: p });
    if (!isSocialPlatform(p)) continue;
    if (!ACCEPTS[p].includes(kind)) {
      out.push({ code: kind === "image" ? "needsVideo" : "needsMedia", platform: p });
    }
    if (kind === "none" && !text.trim()) out.push({ code: "empty", platform: p });
    const st = status?.[p];
    if (status && !st?.connected) out.push({ code: "notConnected", platform: p });
    else if (status && st && !st.canPublish) out.push({ code: "noPermission", platform: p });
  }
  return out;
}

/** The `POST /social/publish` body (the API networks only). */
export interface JobInput {
  id: string;
  scheduledAt: string;
  media?: { url: string; kind: "video" | "image" };
  targets: Partial<
    Record<
      SocialPlatform,
      { caption: string; title?: string; privacy?: string; tiktokMode?: "direct" | "inbox" }
    >
  >;
}

export function buildJob(post: Post, auto: AutoPost, scheduledAt: string): JobInput {
  const targets: JobInput["targets"] = {};
  for (const p of auto.platforms) {
    if (!isSocialPlatform(p)) continue;
    const caption = captionFor(post, auto, p);
    if (p === "youtube") {
      targets.youtube = {
        caption,
        title: (auto.youtubeTitle.trim() || post.title).slice(0, YT_TITLE_MAX),
        privacy: auto.youtubePrivacy,
      };
    } else if (p === "tiktok") {
      targets.tiktok = { caption, privacy: auto.tiktokPrivacy, tiktokMode: auto.tiktokMode };
    } else {
      targets[p] = { caption };
    }
  }
  return {
    id: post.id,
    scheduledAt,
    ...(auto.mediaKind !== "none"
      ? { media: { url: directMediaUrl(auto.mediaUrl), kind: auto.mediaKind } }
      : {}),
    targets,
  };
}

/** A job as the Worker sends it back (only what the dashboard reads). */
export interface WorkerJob {
  id: string;
  scheduledAt: string;
  results: Partial<Record<SocialPlatform, AutoPostResult>>;
}

/** Keep the jobs and per-platform results we understand; drop anything else the Worker sends. */
export function parseJobs(raw: unknown): WorkerJob[] {
  const list = (raw as { jobs?: unknown })?.jobs;
  if (!Array.isArray(list)) return [];
  const out: WorkerJob[] = [];
  for (const j of list) {
    const job = parseJob(j);
    if (job) out.push(job);
  }
  return out;
}

export function parseJob(raw: unknown): WorkerJob | null {
  const j = raw as { id?: unknown; scheduledAt?: unknown; targets?: unknown };
  if (typeof j?.id !== "string" || typeof j.scheduledAt !== "string") return null;
  const results: WorkerJob["results"] = {};
  if (j.targets && typeof j.targets === "object") {
    for (const [p, t] of Object.entries(j.targets as Record<string, unknown>)) {
      if (!isSocialPlatform(p)) continue;
      const parsed = AutoPostResultSchema.safeParse(t);
      if (parsed.success) {
        const r = parsed.data;
        results[p] = Object.fromEntries(
          Object.entries(r).filter(([, v]) => v !== undefined),
        ) as AutoPostResult;
      }
    }
  }
  return { id: j.id, scheduledAt: j.scheduledAt, results };
}

/** Overall state of a post's auto-post, for chips and the hub list. */
export type AutoPostSummary =
  "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";

export function autoPostSummary(auto: AutoPost | undefined): AutoPostSummary {
  if (!auto?.sentAt) return "draft";
  const api = auto.platforms.filter(isSocialPlatform);
  const states = api.map((p) => auto.results[p]?.state ?? "queued");
  if (!states.length) return "draft";
  if (states.every((s) => s === "published")) return "published";
  if (states.some((s) => s === "processing")) return "publishing";
  if (states.every((s) => s === "failed")) return "failed";
  if (states.some((s) => s === "failed")) {
    return states.some((s) => s === "queued") ? "publishing" : "partial";
  }
  if (states.some((s) => s === "published")) return "publishing";
  return "scheduled";
}

/** The Worker still has work on this post (worth checking back). */
export function autoPostActive(auto: AutoPost | undefined): boolean {
  const s = autoPostSummary(auto);
  return s === "scheduled" || s === "publishing";
}

/** The first published link (for "Mark as posted" and the Produce quest proof). */
export function firstPermalink(auto: AutoPost): string {
  for (const p of auto.platforms) {
    const link = auto.results[p]?.permalink;
    if (link) return link;
  }
  return "";
}

/**
 * The web composer for a manual network, prefilled where the platform allows it: X takes the text through
 * its web intent; Snapchat has none, so it opens the site and the caption goes through the clipboard.
 */
export function manualComposeUrl(platform: Platform, text: string): string | null {
  if (platform === "x") return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  if (platform === "snapchat") return "https://www.snapchat.com/";
  return null;
}

/* ---------- Worker calls (`/social/publish`) ---------- */

/** `GET /social/publish`: every job the Worker holds with its per-platform state. */
export async function publishList(
  config: ScoutConfig | null,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ jobs: WorkerJob[] }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/publish", {}, opts);
  return r.ok ? { ok: true, jobs: parseJobs(r.data) } : r;
}

/** `POST /social/publish`: add or replace the post's job. */
export async function publishSchedule(
  config: ScoutConfig | null,
  job: JobInput,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ job: WorkerJob }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, "/social/publish", jsonPost(job), opts);
  if (!r.ok) return r;
  const parsed = parseJob((r.data as { job?: unknown })?.job);
  return parsed ? { ok: true, job: parsed } : { ok: false, error: { type: "upstream" } };
}

/** `POST /social/publish/:id/run`: publish what can go now. */
export async function publishRun(
  config: ScoutConfig | null,
  id: string,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<{ job: WorkerJob }>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(config, `/social/publish/${encodeURIComponent(id)}/run`, jsonPost({}), opts);
  if (!r.ok) return r;
  const parsed = parseJob((r.data as { job?: unknown })?.job);
  return parsed ? { ok: true, job: parsed } : { ok: false, error: { type: "upstream" } };
}

/** `DELETE /social/publish/:id`: cancel (what is already out stays out). */
export async function publishCancel(
  config: ScoutConfig | null,
  id: string,
  opts: SocialSyncOpts = {},
): Promise<SocialResult<object>> {
  if (!config) return { ok: false, error: { type: "unconfigured" } };
  const r = await call(
    config,
    `/social/publish/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    opts,
  );
  return r.ok ? { ok: true } : r;
}
