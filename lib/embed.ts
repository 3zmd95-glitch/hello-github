import type { Lang, RefPlatform } from "./domain";
import { canonicalRefUrl } from "./research";

/**
 * ▶ Watch here (round 32, planning/tools/12-watch-in-dashboard.md): the official embedded players of YouTube,
 * TikTok and Instagram, as plain iframes. No platform script runs in the dashboard's own origin (the owner's
 * tokens live in its storage), and nothing loads from a platform until the owner taps ▶.
 */

/** The platforms that have a player (a `web` reference only links out). */
export type EmbedPlatform = "yt" | "tt" | "ig";

/** The origin each player is served from, and the only origin its messages are accepted from. */
export const EMBED_ORIGIN: Record<EmbedPlatform, string> = {
  yt: "https://www.youtube-nocookie.com",
  tt: "https://www.tiktok.com",
  ig: "https://www.instagram.com",
};

export interface EmbedTarget {
  platform: EmbedPlatform;
  /** YouTube video id, TikTok video id or Instagram shortcode. */
  id: string;
  /** The iframe's address. */
  src: string;
}

const isEmbedPlatform = (p: RefPlatform): p is EmbedPlatform =>
  p === "yt" || p === "tt" || p === "ig";

/**
 * The id the player needs, read from the reference's canonical URL (lib/research `canonicalRefUrl`): a
 * YouTube `watch?v=<id>`, a TikTok `/@user/video/<id>`, an Instagram `/p/<shortcode>`. Undefined for a
 * profile, a search page, a `web` link or anything that is not one post.
 */
export function embedId(platform: RefPlatform, url: string): string | undefined {
  if (!isEmbedPlatform(platform)) return undefined;
  let u: URL;
  try {
    u = new URL(canonicalRefUrl(platform, url));
  } catch {
    return undefined;
  }
  if (platform === "yt") {
    const id = u.pathname === "/watch" ? u.searchParams.get("v") : null;
    return id && /^[\w-]{6,}$/.test(id) ? id : undefined;
  }
  if (platform === "tt") return u.pathname.match(/^\/@[\w.-]+\/video\/(\d+)$/)?.[1];
  return u.pathname.match(/^\/p\/([\w-]+)$/)?.[1];
}

/** True when the reference is one post of a platform that has a player. */
export function canEmbed(platform: RefPlatform, url: string): boolean {
  return embedId(platform, url) !== undefined;
}

/** The player's address for an id (see the planning file for why each parameter is there). */
export function embedSrc(platform: EmbedPlatform, id: string, lang: Lang): string {
  const safe = encodeURIComponent(id);
  if (platform === "yt") {
    return `${EMBED_ORIGIN.yt}/embed/${safe}?autoplay=1&playsinline=1&rel=0&hl=${lang}`;
  }
  if (platform === "tt") {
    return `${EMBED_ORIGIN.tt}/player/v1/${safe}?autoplay=1&rel=0&description=1&music_info=1`;
  }
  return `${EMBED_ORIGIN.ig}/p/${safe}/embed/`;
}

/** Everything the player sheet needs for a reference, or undefined when it cannot play here. */
export function embedTarget(
  platform: RefPlatform,
  url: string,
  lang: Lang,
): EmbedTarget | undefined {
  const id = embedId(platform, url);
  if (!id || !isEmbedPlatform(platform)) return undefined;
  return { platform, id, src: embedSrc(platform, id, lang) };
}

/**
 * Where "Open on …" goes: the reference's own address when it is a web link, else its canonical form (a
 * reference that can play always has one), so the link can never carry another scheme.
 */
export function openHref(platform: RefPlatform, url: string): string {
  const own = url.trim();
  return /^https?:\/\//i.test(own) ? own : canonicalRefUrl(platform, own);
}

/* ---------- The frame ---------- */

/**
 * The same sandbox on all three players: scripts and their own origin (without it YouTube and TikTok never
 * build a video), fullscreen, and popups that leave the sandbox ("Watch on YouTube", "Visit Instagram").
 * No top navigation, no forms, no downloads.
 */
const SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";
/** What the player may use from the page: sound after the ▶ tap, DRM, fullscreen, picture in picture. */
const ALLOW = "autoplay; encrypted-media; fullscreen; picture-in-picture";
/**
 * Never `no-referrer` (the cards' images use it): YouTube needs the page's origin as the Referer and shows
 * Error 153 without it. This sends the origin only, never the page's path.
 */
const REFERRER: ReferrerPolicy = "strict-origin-when-cross-origin";

export interface EmbedFrameAttrs {
  sandbox: string;
  allow: string;
  referrerPolicy: ReferrerPolicy;
}

/** The iframe attributes per platform: one entry each, so a platform can be loosened alone later. */
export const EMBED_FRAME: Record<EmbedPlatform, EmbedFrameAttrs> = {
  yt: { sandbox: SANDBOX, allow: ALLOW, referrerPolicy: REFERRER },
  tt: { sandbox: SANDBOX, allow: ALLOW, referrerPolicy: REFERRER },
  ig: { sandbox: SANDBOX, allow: ALLOW, referrerPolicy: REFERRER },
};

/* ---------- The pre-check (before the frame mounts) ---------- */

/** How long a pre-check may take before the frame mounts anyway. */
export const PRECHECK_TIMEOUT_MS = 4000;

/**
 * What a pre-check found. `play` also stands for "could not tell" (a network error, a timeout, a 429, a 5xx,
 * CORS): the frame mounts anyway and the platform's own player has the last word. `vertical` is set when
 * YouTube said the video is taller than wide (a Short).
 */
export type EmbedCheck =
  { verdict: "play"; vertical?: boolean } | { verdict: "cantPlay" } | { verdict: "gone" };

const PLAY: EmbedCheck = { verdict: "play" };

/** The Graph API error Instagram's oEmbed answers for a post it will not embed (private, off, removed). */
const IG_NOT_EMBEDDABLE = 2207045;

/**
 * The address of a platform's tokenless oEmbed for a video, called from the browser: YouTube (asked for the
 * `/shorts/` form, whose width and height tell a Short from a regular video) and Instagram. TikTok has none:
 * its player reports errors itself.
 */
export function precheckUrl(platform: EmbedPlatform, id: string): string | undefined {
  const safe = encodeURIComponent(id);
  if (platform === "yt") {
    const video = `https://www.youtube.com/shorts/${safe}`;
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(video)}`;
  }
  if (platform === "ig") {
    const post = `https://www.instagram.com/p/${safe}`;
    return `https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(post)}&omitscript=true`;
  }
  return undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Read a pre-check's answer (`body` is the parsed JSON, or undefined). YouTube: 200 plays (vertical when
 * `width < height`), 401 means the owner turned embedding off, 400 / 404 mean the video is gone. Instagram:
 * a 400 with `error.error_subcode` 2207045 means it will not embed. Anything else plays.
 */
export function readPrecheck(platform: EmbedPlatform, status: number, body: unknown): EmbedCheck {
  if (platform === "yt") {
    if (status === 401) return { verdict: "cantPlay" };
    if (status === 400 || status === 404) return { verdict: "gone" };
    if (status === 200 && isRecord(body) && positive(body.width) && positive(body.height)) {
      return { verdict: "play", vertical: body.width < body.height };
    }
    return PLAY;
  }
  if (platform === "ig" && status === 400 && isRecord(body) && isRecord(body.error)) {
    if (body.error.error_subcode === IG_NOT_EMBEDDABLE) return { verdict: "cantPlay" };
  }
  return PLAY;
}

/**
 * Ask the platform whether a video will play here, from the browser: no token, no cookies, at most
 * {@link PRECHECK_TIMEOUT_MS}. Never throws and never blocks playback: every failure answers `play`. The
 * answer is used once and never stored. `fetch` is injectable for tests; `signal` cancels it (the sheet
 * closed or moved to another video).
 */
export async function precheckEmbed(
  target: Pick<EmbedTarget, "platform" | "id">,
  opts: { fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EmbedCheck> {
  const url = precheckUrl(target.platform, target.id);
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (!url || typeof doFetch !== "function" || opts.signal?.aborted) return PLAY;
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  const timer = setTimeout(stop, opts.timeoutMs ?? PRECHECK_TIMEOUT_MS);
  opts.signal?.addEventListener("abort", stop);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, credentials: "omit" });
    let body: unknown;
    if (res.status === 200 || res.status === 400) body = await res.json().catch(() => undefined);
    return readPrecheck(target.platform, res.status, body);
  } catch {
    return PLAY;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", stop);
  }
}

/* ---------- Messages from the frames ---------- */

/**
 * True only for a message from the player's own origin sent by the sheet's own frame. Anything else (another
 * tab, another frame, the page itself, a look-alike origin) is ignored before its data is read.
 */
export function isFromPlayer(
  platform: EmbedPlatform,
  e: { origin: string; source: MessageEventSource | null },
  frame: Window | null | undefined,
): boolean {
  return !!frame && e.origin === EMBED_ORIGIN[platform] && e.source === frame;
}

/** Instagram's frame heights we accept (a real embed measures about 600 to 750 px). */
const IG_MIN_HEIGHT = 200;
const IG_MAX_HEIGHT = 2000;

/**
 * Instagram's `{"type":"MEASURE","details":{"height":…}}` (a JSON string, what its embed.js listens for):
 * the height its content needs, when finite and within 200..2000 px. Undefined for anything else, including
 * the first MEASURE (height 0) and the LOADING / MOUNTED messages.
 */
export function parseIgMeasure(data: unknown): number | undefined {
  if (typeof data !== "string" || data.length > 20_000) return undefined;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(msg) || msg.type !== "MEASURE" || !isRecord(msg.details)) return undefined;
  const h = msg.details.height;
  if (typeof h !== "number" || !Number.isFinite(h)) return undefined;
  return h >= IG_MIN_HEIGHT && h <= IG_MAX_HEIGHT ? Math.ceil(h) : undefined;
}

/** TikTok's player error for a removed, private or unknown video. */
const TT_INVALID_VIDEO = 1001;
/**
 * TikTok's "autoplay was blocked": the video is fine and TikTok's own play button starts it, so it never
 * replaces the frame with an error.
 */
const TT_AUTOPLAY_ERROR = 3002;

export type TiktokSignal = { type: "playing" } | { type: "error"; reason: "gone" | "cantPlay" };

/**
 * TikTok's player messages (`{"x-tiktok-player": true, type, value}`, developers.tiktok.com/doc/embed-player):
 * `onStateChange` 1 is "playing"; `onPlayerError` with `errorCode` 1001 means the video is gone, any other
 * code (but autoplay) that it cannot play here. Undefined for every other message (the frame also sends
 * non-player noise).
 */
export function parseTiktokMessage(data: unknown): TiktokSignal | undefined {
  if (!isRecord(data) || data["x-tiktok-player"] !== true) return undefined;
  if (data.type === "onStateChange") return data.value === 1 ? { type: "playing" } : undefined;
  if (data.type !== "onPlayerError") return undefined;
  const code = isRecord(data.value) ? data.value.errorCode : undefined;
  if (code === TT_AUTOPLAY_ERROR) return undefined;
  return { type: "error", reason: code === TT_INVALID_VIDEO ? "gone" : "cantPlay" };
}

/** The command that turns the TikTok player's sound on (it starts muted), posted once it plays. */
export const TIKTOK_UNMUTE = { type: "unMute", "x-tiktok-player": true } as const;

/** What the sheet does with a player's message: resize (Instagram), unmute or show an error (TikTok). */
export type PlayerSignal =
  | { kind: "height"; px: number }
  | { kind: "playing" }
  | { kind: "error"; reason: "gone" | "cantPlay" };

/**
 * One message from a player, already checked with {@link isFromPlayer}, read into a {@link PlayerSignal}.
 * YouTube's frame is not listened to (no script API: a load timeout stands in).
 */
export function readPlayerMessage(
  platform: EmbedPlatform,
  data: unknown,
): PlayerSignal | undefined {
  if (platform === "ig") {
    const px = parseIgMeasure(data);
    return px === undefined ? undefined : { kind: "height", px };
  }
  if (platform === "tt") {
    const s = parseTiktokMessage(data);
    if (!s) return undefined;
    return s.type === "playing" ? { kind: "playing" } : { kind: "error", reason: s.reason };
  }
  return undefined;
}
