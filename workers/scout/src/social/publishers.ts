/**
 * Auto-posting, one step function per platform (the queue that calls them is `publish.ts`). A step looks at
 * the target's state and moves it forward: create the platform's upload/container, check on it, publish.
 * Meta and TikTok process media asynchronously, so a target may take several cron ticks (five minutes
 * apart) to go from `queued` through `processing` to `published`.
 *
 * Instagram (Instagram API with Instagram Login, scope instagram_business_content_publish)
 *   POST /{ig-user-id}/media           image_url | video_url + media_type=REELS, caption → { id } (container)
 *   GET  /{container}?fields=status_code,status                     FINISHED | IN_PROGRESS | ERROR | EXPIRED
 *   POST /{ig-user-id}/media_publish   creation_id → { id }        (100 API posts per 24 h)
 * Threads (scope threads_content_publish)
 *   POST /me/threads                   media_type=TEXT|IMAGE|VIDEO, text, image_url | video_url → { id }
 *   GET  /{container}?fields=status,error_message                   FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED
 *   POST /me/threads_publish           creation_id → { id }        (250 posts per 24 h, 500 characters)
 * YouTube (scope youtube.upload; uploads have their own daily quota bucket. Videos from an unverified Google
 *   Cloud project created after 28 July 2020 stay private until the project passes YouTube's audit)
 *   POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status → Location
 *   PUT  <Location> with the video bytes (streamed from the media URL) → the video resource
 * TikTok (Content Posting API, scopes video.publish for Direct Post, video.upload for "send to inbox")
 *   POST /v2/post/publish/creator_info/query/        privacy options the account allows (Direct Post only)
 *   POST /v2/post/publish/video/init/ | /inbox/video/init/   source FILE_UPLOAD → { publish_id, upload_url }
 *   PUT  <upload_url> per chunk with Content-Range (bytes streamed from the media URL, Range GETs per chunk)
 *   POST /v2/post/publish/status/fetch/              PROCESSING_* | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED
 *   (an app that has not passed TikTok's audit may only post SELF_ONLY; 6 requests a minute per token)
 *
 * The media must sit at a public https URL that answers with the file itself (not an HTML page): Meta pulls
 * it from its own servers; for YouTube and TikTok the Worker streams it through without buffering.
 */

import { bearer, fetchJson, type Http, type JsonReply } from "./http";
import { IG_API } from "./instagram";
import { metaBody, type MetaError } from "./meta";
import { TH_API } from "./threads";
import { TT_API } from "./tiktok";
import { SocialError, type SocialPlatform, type TokenSet } from "./types";

/* ---------- queue types (shared with publish.ts and the dashboard's lib/publish.ts) ---------- */

export type MediaKind = "video" | "image";

export interface PublishMedia {
  /** Public https URL of the file itself. */
  url: string;
  kind: MediaKind;
}

export type TargetState = "queued" | "processing" | "published" | "failed";

export type PublishErrorCode =
  | "not_connected"
  | "no_permission"
  | "token_expired"
  | "media_unreachable"
  | "media_too_large"
  | "rejected"
  | "rate_limited"
  | "upstream"
  | "timeout";

export type YoutubePrivacy = "public" | "unlisted" | "private";
export type TiktokPrivacy =
  "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

/** What the owner chose for one platform. */
export interface TargetSpec {
  caption: string;
  /** YouTube: the video title (≤ 100 characters). */
  title?: string;
  /** YouTube privacy or TikTok privacy level. */
  privacy?: string;
  /** TikTok: post straight to the profile, or send to the TikTok inbox to finish in the app. */
  tiktokMode?: "direct" | "inbox";
}

/** One platform of a job and how far it got. */
export interface PublishTarget extends TargetSpec {
  state: TargetState;
  /** Transient failures so far (retried with back-off until MAX_ATTEMPTS). */
  attempts: number;
  /** Meta container id or TikTok publish_id, once created. */
  containerId?: string;
  /** ISO: when the container/upload was created (processing times out after PROCESSING_TIMEOUT_MS). */
  startedAt?: string;
  /** ISO: not touched again before this. */
  nextAt?: string;
  /** The platform's id of the published post. */
  postId?: string;
  permalink?: string;
  publishedAt?: string;
  /** TikTok "send to inbox": the video waits in the owner's TikTok inbox. */
  inbox?: boolean;
  error?: PublishErrorCode;
  /** The platform's own words about a failure (never a token). */
  detail?: string;
}

/* ---------- step plumbing ---------- */

export class PublishError extends Error {
  constructor(
    readonly code: PublishErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = "PublishError";
  }
}

export interface StepContext {
  http: Http;
  tokens: TokenSet;
  media?: PublishMedia;
  now: Date;
  /** The account handle (TikTok permalinks). */
  handle?: string;
  /** Pause between two checks of a fresh container (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/** Moves a target one or more steps forward; throws PublishError / SocialError on failure. */
export type Step = (target: PublishTarget, ctx: StepContext) => Promise<PublishTarget>;

/** Outbound calls one step may need at most (the queue stops starting steps below this). */
export const STEP_MIN_BUDGET: Record<SocialPlatform, number> = {
  instagram: 5,
  threads: 5,
  youtube: 3,
  tiktok: 4,
};

/** Wait between checks on a container that is still processing. */
export const CHECK_AGAIN_MS = 60_000;

/**
 * A fresh TEXT/IMAGE container usually reports IN_PROGRESS for a few seconds (Meta suggests waiting before
 * the first status read). One short pause lets "Post now" finish in the same call instead of the next tick.
 */
export const FRESH_CONTAINER_WAIT_MS = 4_000;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const processing = (t: PublishTarget, ctx: StepContext, patch: Partial<PublishTarget> = {}) => ({
  ...t,
  ...patch,
  state: "processing" as const,
  startedAt: t.startedAt ?? ctx.now.toISOString(),
  nextAt: new Date(ctx.now.getTime() + CHECK_AGAIN_MS).toISOString(),
});

const published = (t: PublishTarget, ctx: StepContext, patch: Partial<PublishTarget>) => ({
  ...t,
  ...patch,
  state: "published" as const,
  publishedAt: ctx.now.toISOString(),
  nextAt: undefined,
  error: undefined,
  detail: undefined,
});

/** A Graph reply as a body, with the platform's message kept for the owner when it refuses the post. */
function graph<T extends MetaError>(reply: JsonReply<T>, what: string): T {
  try {
    return metaBody(reply, what);
  } catch (e) {
    if (
      e instanceof SocialError &&
      e.code === "upstream" &&
      reply.status >= 400 &&
      reply.status < 500
    ) {
      throw new PublishError("rejected", reply.body?.error?.message ?? `${what}: ${reply.status}`);
    }
    throw e;
  }
}

const form = (params: Record<string, string | undefined>): RequestInit => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  };
};

/* ---------- Meta: Instagram + Threads share the container flow ---------- */

interface Created extends MetaError {
  id?: string;
}
interface ContainerStatus extends MetaError {
  status_code?: string;
  status?: string;
  error_message?: string;
}
interface Permalink extends MetaError {
  permalink?: string;
}

interface MetaFlow {
  api: string;
  /** The path segment of the account: the IG user id, or "me". */
  owner(tokens: TokenSet): string;
  createPath: string;
  publishPath: string;
  createParams(
    t: PublishTarget,
    media: PublishMedia | undefined,
  ): Record<string, string | undefined>;
  statusFields: string;
  /** FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED, from either API's field. */
  statusOf(body: ContainerStatus): string;
}

function metaStep(flow: MetaFlow): Step {
  return async (t, ctx) => {
    const token = ctx.tokens.accessToken;
    const base = `${flow.api}/${flow.owner(ctx.tokens)}`;
    let target = t;
    let fresh = false;
    const readStatus = async (url: string): Promise<string> => {
      const st = graph(await fetchJson<ContainerStatus>(ctx.http, url), "status");
      const code = flow.statusOf(st);
      if (code === "ERROR" || code === "EXPIRED") {
        throw new PublishError("rejected", st.error_message ?? st.status ?? code);
      }
      return code;
    };
    if (!target.containerId) {
      const created = graph(
        await fetchJson<Created>(
          ctx.http,
          `${base}/${flow.createPath}`,
          form({ ...flow.createParams(target, ctx.media), access_token: token }),
        ),
        "create",
      );
      if (!created.id) throw new PublishError("upstream", "create: no container id");
      target = processing(target, ctx, { containerId: created.id });
      // Images and text are usually ready at once: check in the same run while the budget allows.
      if (ctx.media?.kind === "video" || ctx.http.budget.left < 3) return target;
      fresh = true;
    }
    const statusUrl = `${flow.api}/${target.containerId}?fields=${flow.statusFields}&access_token=${encodeURIComponent(token)}`;
    let code = await readStatus(statusUrl);
    // A container made a moment ago often needs a few seconds: wait once and look again.
    if (fresh && code === "IN_PROGRESS" && ctx.http.budget.left >= 3) {
      await (ctx.sleep ?? realSleep)(FRESH_CONTAINER_WAIT_MS);
      code = await readStatus(statusUrl);
    }
    if (code !== "FINISHED" && code !== "PUBLISHED") return processing(target, ctx);
    if (ctx.http.budget.left < 1) return processing(target, ctx);
    const done = graph(
      await fetchJson<Created>(
        ctx.http,
        `${base}/${flow.publishPath}`,
        form({ creation_id: target.containerId, access_token: token }),
      ),
      "publish",
    );
    if (!done.id) throw new PublishError("upstream", "publish: no media id");
    let permalink: string | undefined;
    if (ctx.http.budget.ok) {
      const link = await fetchJson<Permalink>(
        ctx.http,
        `${flow.api}/${done.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      );
      permalink = link.ok ? link.body?.permalink : undefined;
    }
    return published(target, ctx, { postId: done.id, ...(permalink ? { permalink } : {}) });
  };
}

export const publishInstagram: Step = metaStep({
  api: IG_API,
  owner: (tokens) => tokens.userId ?? "me",
  createPath: "media",
  publishPath: "media_publish",
  createParams(t, media) {
    if (!media) throw new PublishError("rejected", "instagram needs an image or a video");
    return media.kind === "video"
      ? { media_type: "REELS", video_url: media.url, caption: t.caption, share_to_feed: "true" }
      : { image_url: media.url, caption: t.caption };
  },
  statusFields: "status_code,status",
  statusOf: (b) => b.status_code ?? "",
});

export const publishThreads: Step = metaStep({
  api: TH_API,
  owner: () => "me",
  createPath: "threads",
  publishPath: "threads_publish",
  createParams(t, media) {
    if (!media) return { media_type: "TEXT", text: t.caption };
    return media.kind === "video"
      ? { media_type: "VIDEO", video_url: media.url, text: t.caption }
      : { media_type: "IMAGE", image_url: media.url, text: t.caption };
  },
  statusFields: "status,error_message",
  statusOf: (b) => b.status ?? "",
});

/* ---------- streaming the media (YouTube, TikTok) ---------- */

interface OpenMedia {
  res: Response;
  size: number;
  type: string;
  ranges: boolean;
}

/** One budgeted GET of the media (optionally a byte range); refuses HTML pages and unknown sizes. */
async function openMedia(http: Http, url: string, range?: [number, number]): Promise<OpenMedia> {
  http.budget.take();
  const doFetch = http.fetch;
  let res: Response;
  try {
    res = await doFetch(url, range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : {});
  } catch {
    throw new PublishError("media_unreachable", `fetch failed: ${new URL(url).host}`);
  }
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !res.body || type.startsWith("text/")) {
    await res.body?.cancel().catch(() => undefined);
    throw new PublishError("media_unreachable", `media: ${res.status} ${type}`.trim());
  }
  const total = res.headers.get("Content-Range")?.match(/\/(\d+)$/)?.[1];
  const size = Number(range ? total : res.headers.get("Content-Length"));
  if (!Number.isFinite(size) || size <= 0) {
    await res.body.cancel().catch(() => undefined);
    throw new PublishError("media_unreachable", "media: no Content-Length");
  }
  const ranges = res.status === 206 || res.headers.get("Accept-Ranges") === "bytes";
  return { res, size, type: type || "video/mp4", ranges };
}

/**
 * The body for a PUT of `length` bytes. On Workers a FixedLengthStream makes the runtime send a
 * Content-Length (YouTube and TikTok refuse chunked uploads) while the bytes still stream straight through;
 * elsewhere (Node in the tests) the body goes as is.
 */
function sized(body: ReadableStream | null, length: number): ReadableStream | null {
  const Fixed = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream })
    .FixedLengthStream;
  if (!body || !Fixed) return body;
  const fixed = new Fixed(length);
  body.pipeTo(fixed.writable).catch(() => undefined);
  return fixed.readable;
}

async function uploadFailure(res: Response, what: string): Promise<never> {
  let message = "";
  try {
    const body = (await res.json()) as {
      error?: { message?: string; code?: string | number; errors?: { reason?: string }[] };
    };
    message = body.error?.message ?? String(body.error?.code ?? "");
    const reason = body.error?.errors?.[0]?.reason ?? "";
    if (/quota|rateLimit/i.test(reason)) throw new PublishError("rate_limited", message || reason);
  } catch (e) {
    if (e instanceof PublishError) throw e;
  }
  if (res.status === 401) throw new SocialError("token_expired", `${what}: 401`);
  if (res.status === 429) throw new PublishError("rate_limited", message || `${what}: 429`);
  if (res.status >= 400 && res.status < 500) {
    throw new PublishError("rejected", message || `${what}: ${res.status}`);
  }
  throw new PublishError("upstream", message || `${what}: ${res.status}`);
}

/* ---------- YouTube ---------- */

export const YT_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
/** YouTube's title limit. */
export const YT_TITLE_MAX = 100;

export const publishYoutube: Step = async (t, ctx) => {
  if (ctx.media?.kind !== "video") throw new PublishError("rejected", "youtube needs a video");
  const media = await openMedia(ctx.http, ctx.media.url);
  const title = (t.title?.trim() || t.caption.split("\n")[0] || "Video").slice(0, YT_TITLE_MAX);
  const privacy = (["public", "unlisted", "private"] as const).includes(t.privacy as YoutubePrivacy)
    ? t.privacy
    : "public";
  let session: Response;
  try {
    ctx.http.budget.take();
    const doFetch = ctx.http.fetch;
    session = await doFetch(YT_UPLOAD_URL, {
      method: "POST",
      headers: bearer(ctx.tokens.accessToken, {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": media.type,
        "X-Upload-Content-Length": String(media.size),
      }),
      body: JSON.stringify({
        snippet: { title, description: t.caption, categoryId: "22" },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    });
  } catch (e) {
    await media.res.body?.cancel().catch(() => undefined);
    if (e instanceof SocialError) throw e;
    throw new PublishError("upstream", "youtube: upload session failed");
  }
  const location = session.headers.get("Location");
  if (!session.ok || !location) {
    await media.res.body?.cancel().catch(() => undefined);
    return uploadFailure(session, "youtube session");
  }
  ctx.http.budget.take();
  const doFetch = ctx.http.fetch;
  let put: Response;
  try {
    put = await doFetch(location, {
      method: "PUT",
      headers: { "Content-Type": media.type, "Content-Length": String(media.size) },
      body: sized(media.res.body, media.size),
      // Node's fetch (tests, local tools) needs this for a streamed body; workerd ignores it.
      ...({ duplex: "half" } as object),
    });
  } catch {
    throw new PublishError("upstream", "youtube: upload failed");
  }
  if (!put.ok) return uploadFailure(put, "youtube upload");
  const video = (await put.json().catch(() => null)) as { id?: string } | null;
  if (!video?.id) throw new PublishError("upstream", "youtube: no video id");
  return published(t, ctx, {
    postId: video.id,
    permalink: `https://www.youtube.com/watch?v=${video.id}`,
  });
};

/* ---------- TikTok ---------- */

/** TikTok chunk rules: 5–64 MB per chunk, the last one may be up to 128 MB; under 5 MB goes whole. */
export const TT_CHUNK = 64 * 1024 * 1024;
export const TT_MIN_CHUNK = 5 * 1024 * 1024;
/** Largest video TikTok accepts through the API (4 GB). */
export const TT_MAX_VIDEO = 4 * 1024 * 1024 * 1024;

interface TtEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

function ttBody<T>(reply: JsonReply<TtEnvelope<T>>, what: string): T {
  const code = reply.body?.error?.code;
  if (reply.ok && reply.body && (!code || code === "ok")) return (reply.body.data ?? {}) as T;
  const message = reply.body?.error?.message || code || `${what}: ${reply.status}`;
  if (reply.status === 401 || code === "access_token_invalid") {
    throw new SocialError("token_expired", `${what}: ${message}`);
  }
  if (code === "scope_not_authorized") throw new PublishError("no_permission", message);
  if (
    reply.status === 429 ||
    code === "rate_limit_exceeded" ||
    code === "spam_risk_too_many_posts"
  ) {
    throw new PublishError("rate_limited", message);
  }
  if (reply.status >= 400 && reply.status < 500) throw new PublishError("rejected", message);
  throw new PublishError("upstream", message);
}

const ttPost = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: bearer(token, { "Content-Type": "application/json; charset=UTF-8" }),
  body: JSON.stringify(body),
});

/** How TikTok wants a video of `size` bytes cut: chunk size and count (the last chunk takes the rest). */
export function ttChunks(size: number): { chunkSize: number; count: number } {
  if (size <= TT_CHUNK) return { chunkSize: size, count: 1 };
  return { chunkSize: TT_CHUNK, count: Math.floor(size / TT_CHUNK) };
}

export const publishTiktok: Step = async (t, ctx) => {
  const token = ctx.tokens.accessToken;
  if (t.containerId) {
    const st = ttBody(
      await fetchJson<
        TtEnvelope<{
          status?: string;
          fail_reason?: string;
          publicaly_available_post_id?: (string | number)[];
        }>
      >(
        ctx.http,
        `${TT_API}/post/publish/status/fetch/`,
        ttPost(token, { publish_id: t.containerId }),
      ),
      "status",
    );
    if (st.status === "FAILED") throw new PublishError("rejected", st.fail_reason ?? "failed");
    if (st.status === "SEND_TO_USER_INBOX") return published(t, ctx, { inbox: true });
    if (st.status !== "PUBLISH_COMPLETE") return processing(t, ctx);
    const id = st.publicaly_available_post_id?.[0];
    return published(t, ctx, {
      ...(id !== undefined ? { postId: String(id) } : {}),
      ...(id !== undefined && ctx.handle
        ? { permalink: `https://www.tiktok.com/@${ctx.handle}/video/${id}` }
        : {}),
    });
  }

  if (ctx.media?.kind !== "video") throw new PublishError("rejected", "tiktok needs a video");
  const inbox = t.tiktokMode === "inbox";
  let privacy = t.privacy ?? "SELF_ONLY";
  if (!inbox) {
    // TikTok's guidelines: read the creator's allowed privacy levels right before posting. An app that has
    // not passed TikTok's audit only gets SELF_ONLY here, so the post lands private until then.
    const info = ttBody(
      await fetchJson<TtEnvelope<{ privacy_level_options?: string[] }>>(
        ctx.http,
        `${TT_API}/post/publish/creator_info/query/`,
        ttPost(token, {}),
      ),
      "creator_info",
    );
    const options = info.privacy_level_options ?? [];
    if (options.length && !options.includes(privacy)) {
      privacy = options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
    }
  }

  // The first chunk (or the whole video) doubles as the size probe.
  const probe = await openMedia(ctx.http, ctx.media.url);
  const { size } = probe;
  if (size > TT_MAX_VIDEO) {
    await probe.res.body?.cancel().catch(() => undefined);
    throw new PublishError("media_too_large", `${size} bytes`);
  }
  const { chunkSize, count } = ttChunks(size);
  if (count > 1 && !probe.ranges) {
    await probe.res.body?.cancel().catch(() => undefined);
    throw new PublishError("media_too_large", "over 64 MB and the host does not serve byte ranges");
  }
  // Each chunk after the first costs two calls (a Range GET and a PUT).
  if (ctx.http.budget.left < 1 + 2 * count) {
    await probe.res.body?.cancel().catch(() => undefined);
    throw new PublishError("media_too_large", "too many chunks for one run");
  }
  const sourceInfo = {
    source: "FILE_UPLOAD",
    video_size: size,
    chunk_size: chunkSize,
    total_chunk_count: count,
  };
  let init: { publish_id?: string; upload_url?: string };
  try {
    init = ttBody(
      await fetchJson<TtEnvelope<{ publish_id?: string; upload_url?: string }>>(
        ctx.http,
        `${TT_API}/post/publish/${inbox ? "inbox/" : ""}video/init/`,
        ttPost(
          token,
          inbox
            ? { source_info: sourceInfo }
            : {
                post_info: {
                  title: t.caption,
                  privacy_level: privacy,
                  disable_comment: false,
                  disable_duet: false,
                  disable_stitch: false,
                },
                source_info: sourceInfo,
              },
        ),
      ),
      "init",
    );
  } catch (e) {
    await probe.res.body?.cancel().catch(() => undefined);
    throw e;
  }
  if (!init.publish_id || !init.upload_url) {
    await probe.res.body?.cancel().catch(() => undefined);
    throw new PublishError("upstream", "init: no upload url");
  }

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
    let body: ReadableStream | null;
    if (i === 0 && count === 1) {
      body = probe.res.body;
    } else {
      if (i === 0) await probe.res.body?.cancel().catch(() => undefined);
      body = (await openMedia(ctx.http, ctx.media.url, [start, end])).res.body;
    }
    ctx.http.budget.take();
    const doFetch = ctx.http.fetch;
    let put: Response;
    try {
      put = await doFetch(init.upload_url, {
        method: "PUT",
        headers: {
          // TikTok takes video/mp4, video/quicktime or video/webm; hosts often say octet-stream.
          "Content-Type": probe.type.startsWith("video/") ? probe.type : "video/mp4",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
        body: sized(body, end - start + 1),
        ...({ duplex: "half" } as object),
      });
    } catch {
      throw new PublishError("upstream", "tiktok: upload failed");
    }
    if (!put.ok) return uploadFailure(put, "tiktok upload");
  }
  return processing(t, ctx, { containerId: init.publish_id, privacy });
};

export const STEPS: Record<SocialPlatform, Step> = {
  instagram: publishInstagram,
  threads: publishThreads,
  youtube: publishYoutube,
  tiktok: publishTiktok,
};
