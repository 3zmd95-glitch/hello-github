/**
 * Turning Tavily search hits into reference cards (build plan 1.14). Pure functions, no Worker APIs, so
 * they are unit-tested directly.
 */

export type Platform = "tt" | "ig" | "yt";
export const PLATFORMS: readonly Platform[] = ["tt", "ig", "yt"];

export const PLATFORM_DOMAIN: Record<Platform, string> = {
  tt: "tiktok.com",
  ig: "instagram.com",
  yt: "youtube.com",
};

export interface ScoutResult {
  platform: Platform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
  thumb?: string;
}

/** One hit as Tavily returns it (only the fields we read). */
export interface TavilyHit {
  title?: string;
  url?: string;
  content?: string;
  /** Not documented for /search today, but read when present (future-proof, costs nothing). */
  image?: string;
  images?: (string | { url?: string })[];
}

const SNIPPET_MAX = 220;

/** Platform for a hostname, or undefined for anything that isn't TikTok / Instagram / YouTube. */
export function platformForHost(hostname: string): Platform | undefined {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (is("tiktok.com")) return "tt";
  if (is("instagram.com")) return "ig";
  if (is("youtube.com") || host === "youtu.be") return "yt";
  return undefined;
}

/** Path segments that are Instagram routes, never an account name. */
const IG_RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "stories", "accounts"]);

/** YouTube video id from a watch / shorts / youtu.be URL. */
export function youtubeVideoId(u: URL): string | undefined {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return u.pathname.split("/")[1] || undefined;
  if (u.pathname === "/watch") return u.searchParams.get("v") || undefined;
  return u.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
}

/** True when the URL points at one video/post (not a profile, tag or search page). */
export function isVideoUrl(platform: Platform, u: URL): boolean {
  switch (platform) {
    case "tt":
      return /\/video\/\d+/.test(u.pathname);
    case "ig":
      return /\/(reels?|p|tv)\/[\w-]+/.test(u.pathname);
    case "yt":
      return !!youtubeVideoId(u);
  }
}

/**
 * "@handle" from the URL path: TikTok / YouTube `/@user/...`; Instagram `/<user>/reel/<id>` (only present
 * on some shared links). Falls back to the bare hostname when the path doesn't name the account.
 */
export function handleFromUrl(platform: Platform, u: URL): string {
  const at = u.pathname.match(/\/(@[\w.-]+)/)?.[1];
  if (at && (platform === "tt" || platform === "yt")) return at;
  if (platform === "ig") {
    const [first, second] = u.pathname.split("/").filter(Boolean);
    if (first && second && !IG_RESERVED.has(first.toLowerCase()) && IG_RESERVED.has(second)) {
      return `@${first}`;
    }
  }
  return u.hostname.replace(/^www\./, "");
}

/** Canonical form used for dedupe and as the returned URL: no tracking query, no hash, no trailing "/". */
export function canonicalUrl(platform: Platform, u: URL): string {
  if (platform === "yt") {
    const id = youtubeVideoId(u);
    if (id && u.pathname === "/watch") return `https://www.youtube.com/watch?v=${id}`;
    if (id && u.hostname.endsWith("youtu.be")) return `https://www.youtube.com/watch?v=${id}`;
  }
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${u.hostname.toLowerCase()}${path}`;
}

function firstImage(hit: TavilyHit): string | undefined {
  if (typeof hit.image === "string" && hit.image.startsWith("http")) return hit.image;
  for (const img of hit.images ?? []) {
    const url = typeof img === "string" ? img : img?.url;
    if (url && url.startsWith("http")) return url;
  }
  return undefined;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Normalize Tavily hits into cards: keep only the requested platforms, only single-video pages, one card
 * per canonical URL. YouTube cards get the public `i.ytimg.com` thumbnail derived from the video id.
 */
export function normalizeHits(
  hits: readonly TavilyHit[],
  platforms: readonly Platform[],
): ScoutResult[] {
  const wanted = new Set(platforms);
  const seen = new Set<string>();
  const out: ScoutResult[] = [];
  for (const hit of hits) {
    if (!hit.url) continue;
    let u: URL;
    try {
      u = new URL(hit.url);
    } catch {
      continue;
    }
    const platform = platformForHost(u.hostname);
    if (!platform || !wanted.has(platform) || !isVideoUrl(platform, u)) continue;
    const url = canonicalUrl(platform, u);
    if (seen.has(url)) continue;
    seen.add(url);
    const ytId = platform === "yt" ? youtubeVideoId(u) : undefined;
    const thumb = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : firstImage(hit);
    const handle = handleFromUrl(platform, u);
    const result: ScoutResult = {
      platform,
      handle,
      title: clip(hit.title || handle, 160),
      snippet: clip(hit.content ?? "", SNIPPET_MAX),
      url,
    };
    if (thumb) result.thumb = thumb;
    out.push(result);
  }
  return out;
}
