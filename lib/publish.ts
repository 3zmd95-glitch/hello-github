import {
  AutoPostResultSchema,
  AutoPostSchema,
  type AutoPost,
  type AutoPostResult,
  type Platform,
  type Post,
  type SocialConnectionStatus,
  type SocialStatusMap,
} from "./domain";
import { bestTime, PLATFORM_META } from "./social";
import type { ScoutConfig } from "./scoutClient";
import {
  accountState,
  call,
  isSocialPlatform,
  post as jsonPost,
  type SocialPlatform,
  type SocialResult,
  type SocialSyncOpts,
} from "./socialSync";

/**
 * 🚀 Auto-posting rules (Metricool-style "write once, post everywhere"): which networks the Worker can post
 * to, the caption each one gets (trimmed to the network's limit since round 30), when the job fires, what
 * blocks it, how the Worker's job maps back onto the post, the manual fallback for X and Snapchat, and the
 * token-expiry warning. Pure functions; `components/social/usePublish.ts` calls the Worker and writes the
 * results into the store.
 *
 * Round 30 (planning/tools/08-trends.md, planning/handovers/mastermind-2026-09-28.md · A2 + A6): captions
 * that fit, manual networks warn instead of blocking, "reconnect in N days".
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

/** What a network will get as typed: the override if one was typed, else the default caption. */
export function captionFor(post: Post, auto: AutoPost, platform: Platform): string {
  const own = auto.captions[platform];
  return own !== undefined && own.trim() ? own : defaultCaption(post);
}

/** The ellipsis a cut caption ends with (one character, so it counts as one in every network's limit). */
export const ELLIPSIS = "…";

/** A trailing hashtag token (with the whitespace before it), e.g. " #capcut" at the very end. */
const TRAILING_HASHTAG_RE = /\s*#[^\s#]+\s*$/;

/**
 * Fit a caption into a network's limit: drop hashtags from the end one by one (the last one goes first),
 * then, if still over, cut at a word boundary (never inside an emoji) and end with "…". Text within the limit
 * comes back untouched; text over it only by trailing whitespace loses that whitespace but is not "trimmed".
 */
export function trimCaption(platform: Platform, text: string): { text: string; trimmed: boolean } {
  const max = CAPTION_MAX[platform];
  if (text.length <= max) return { text, trimmed: false };
  let out = text.trimEnd();
  // Over only because of trailing whitespace: nothing the reader sees is lost.
  if (out.length <= max) return { text: out, trimmed: false };
  while (out.length > max && TRAILING_HASHTAG_RE.test(out)) {
    out = out.replace(TRAILING_HASHTAG_RE, "").trimEnd();
  }
  if (out.length > max) {
    const room = max - ELLIPSIS.length;
    const head = out.slice(0, room + 1);
    // Cut at the last whitespace within the room, unless that would throw away more than half of it.
    const space = head.search(/\s\S*$/);
    let cut = space > room / 2 ? space : room;
    // Never split an emoji (a surrogate pair): back off before its high half.
    const code = out.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    out = out.slice(0, cut).trimEnd() + ELLIPSIS;
  }
  return { text: out, trimmed: true };
}

/**
 * What the Worker sends to an API network: the caption for it, trimmed to fit. Manual networks (X, Snapchat)
 * are never sent, so their caption comes back as typed (see {@link captionWarnings}).
 */
export function sendCaption(
  post: Post,
  auto: AutoPost,
  platform: Platform,
): { text: string; trimmed: boolean } {
  const text = captionFor(post, auto, platform);
  return isSocialPlatform(platform) ? trimCaption(platform, text) : { text, trimmed: false };
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
  | "empty"
  | "notConnected"
  | "noPermission";

export interface Problem {
  code: ProblemCode;
  platform?: Platform;
}

/** Something worth a line under the captions but never a blocker (the Worker does not send these networks). */
export interface Warning {
  code: "tooLong";
  platform: Platform;
}

/**
 * The manual networks (X, Snapchat) whose caption is over the limit: the owner posts those by hand, so an
 * overlong caption is a warning, not something that stops the API networks from going out.
 */
export function captionWarnings(post: Post, auto: AutoPost): Warning[] {
  const out: Warning[] = [];
  for (const p of auto.platforms) {
    if (!isManual(p)) continue;
    if (captionFor(post, auto, p).length > CAPTION_MAX[p])
      out.push({ code: "tooLong", platform: p });
  }
  return out;
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
 * reply (null when unknown: connection problems are then not reported). `now` skips the day check. Caption
 * length is never a problem: API captions are trimmed to fit ({@link sendCaption}), manual ones only warn.
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
    if (!isSocialPlatform(p)) continue;
    if (!ACCEPTS[p].includes(kind)) {
      out.push({ code: kind === "image" ? "needsVideo" : "needsMedia", platform: p });
    }
    if (kind === "none" && !sendCaption(post, auto, p).text.trim()) {
      out.push({ code: "empty", platform: p });
    }
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

/** The job body; every caption is trimmed to its network's limit so the Worker never refuses it for length. */
export function buildJob(post: Post, auto: AutoPost, scheduledAt: string): JobInput {
  const targets: JobInput["targets"] = {};
  for (const p of auto.platforms) {
    if (!isSocialPlatform(p)) continue;
    const caption = sendCaption(post, auto, p).text;
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

/** The manual networks of a post's auto-post (X, Snapchat) that the owner still has to post by hand. */
export function pendingManualPlatforms(post: Post): Platform[] {
  if (post.stage === "posted" || !post.autoPost) return [];
  return post.autoPost.platforms.filter(isManual);
}

/* ---------- token expiry ---------- */

/** Warn this many days before a token the Worker cannot renew runs out. */
export const RECONNECT_WARN_DAYS = 7;

/**
 * Platforms whose token has no refresh token in the Worker (Meta's 60-day tokens): once it runs out the
 * owner must reconnect. Google and TikTok renew their short tokens by themselves, so their `tokenExpiresAt`
 * is not a reason to warn.
 */
const RECONNECT_PLATFORMS: ReadonlySet<SocialPlatform> = new Set(["instagram", "threads"]);

/**
 * Days left before a connected platform's token runs out, when that is within {@link RECONNECT_WARN_DAYS}
 * (0 = today); null otherwise, for a self-renewing platform, or once it has already expired (then the row
 * is in the `error` state and says "reconnect").
 */
export function reconnectInDays(
  status: SocialConnectionStatus | undefined,
  platform: SocialPlatform,
  now: number = Date.now(),
): number | null {
  if (!RECONNECT_PLATFORMS.has(platform) || !status?.tokenExpiresAt) return null;
  if (accountState(status, platform) !== "connected") return null;
  const exp = Date.parse(status.tokenExpiresAt);
  if (Number.isNaN(exp) || exp <= now) return null;
  const days = Math.floor((exp - now) / 86_400_000);
  return days <= RECONNECT_WARN_DAYS ? days : null;
}

/**
 * The "reconnect" line for {@link reconnectInDays}: today, tomorrow and two days get their own wording (Arabic
 * has a dual, and "1 days" reads wrong in English); three and up say "within {n} days".
 */
export function reconnectMessageKey(
  days: number,
): "publish.tokenToday" | "publish.tokenTomorrow" | "publish.tokenTwoDays" | "publish.tokenSoon" {
  if (days <= 0) return "publish.tokenToday";
  if (days === 1) return "publish.tokenTomorrow";
  if (days === 2) return "publish.tokenTwoDays";
  return "publish.tokenSoon";
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
