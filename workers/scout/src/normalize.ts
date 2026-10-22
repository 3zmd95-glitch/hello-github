/**
 * Turning Tavily search hits into reference cards (build plan 1.14). Pure functions, no Worker APIs, so
 * they are unit-tested directly.
 */

import { postedAt } from "./postDate";

export type Platform = "tt" | "ig" | "yt";
export const PLATFORMS: readonly Platform[] = ["tt", "ig", "yt"];

export const PLATFORM_DOMAIN: Record<Platform, string> = {
  tt: "tiktok.com",
  ig: "instagram.com",
  yt: "youtube.com",
};

/**
 * The public counts of one post, as far as they are known (round 31, the "Most popular" sort): whole
 * numbers ≥ 0, a count nobody showed is left out. Hand-copied from `Stats` in the dashboard's
 * lib/scoutClient.ts (the social/types.ts convention): change both together.
 */
export interface Stats {
  views?: number;
  likes?: number;
  comments?: number;
}

export interface ScoutResult {
  platform: Platform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
  thumb?: string;
  /**
   * TikTok / Instagram: read from the page text ({@link parseEngagement}); YouTube: from the Data API
   * (scout.ts `enrichYoutubeStats`). Never an empty object.
   */
  stats?: Stats;
  /**
   * When the post went up, ISO 8601: TikTok / Instagram from the post's own id (postDate.ts, whatever Tavily sent);
   * YouTube from the Data API's `publishedAt`, else Tavily's `published_date`.
   */
  published?: string;
}

/** One hit as Tavily returns it (only the fields we read). */
export interface TavilyHit {
  title?: string;
  url?: string;
  content?: string;
  /** Not documented for /search today, but read when present (future-proof, costs nothing). */
  image?: string;
  images?: (string | { url?: string })[];
  published_date?: string;
}

const SNIPPET_MAX = 220;
const TITLE_MAX = 160;

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

/**
 * One Instagram post / reel: `/reel/<id>`, `/reels/<id>`, `/p/<id>`, `/tv/<id>`, optionally behind a
 * `/<user>/` prefix. `/reels/audio/<id>` (a sound page listing many reels) is not a post.
 */
const IG_POST_PATH = /^\/(?:[\w.]+\/)?(?:reels?|p|tv)\/(?!audio\/)([\w-]+)\/?$/;
/** One TikTok video: `/@user/video/<id>`. */
const TT_VIDEO_PATH = /^\/(@[\w.-]+)\/video\/(\d+)/;

/** YouTube video id from a watch / shorts / youtu.be URL. */
export function youtubeVideoId(u: URL): string | undefined {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return u.pathname.split("/")[1] || undefined;
  if (u.pathname === "/watch") return u.searchParams.get("v") || undefined;
  return u.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
}

/** True when the URL points at one video/post (not a profile, tag, sound or search page). */
export function isVideoUrl(platform: Platform, u: URL): boolean {
  switch (platform) {
    case "tt":
      return /\/video\/\d+/.test(u.pathname);
    case "ig":
      return IG_POST_PATH.test(u.pathname);
    case "yt":
      return !!youtubeVideoId(u);
  }
}

/**
 * "@handle" from the URL path: TikTok / YouTube `/@user/...`; Instagram `/<user>/reel/<id>` (only present
 * on some shared links). YouTube and TikTok fall back to the bare hostname when the path doesn't name the
 * account; Instagram returns "" (the caller then reads the handle from the page text, never "instagram.com").
 */
export function handleFromUrl(platform: Platform, u: URL): string {
  const at = u.pathname.match(/\/(@[\w.-]+)/)?.[1];
  if (at && (platform === "tt" || platform === "yt")) return at;
  if (platform === "ig") {
    const [first, second] = u.pathname.split("/").filter(Boolean);
    if (first && second && !IG_RESERVED.has(first.toLowerCase()) && IG_RESERVED.has(second)) {
      return `@${first}`;
    }
    return "";
  }
  return u.hostname.replace(/^www\./, "");
}

/**
 * Canonical form used for dedupe and as the returned URL, rebuilt from the platform's video id so every
 * shape of one post collapses into one card:
 *   - YouTube `watch?v=`, `youtu.be/<id>`, `/shorts/<id>` → `https://www.youtube.com/watch?v=<id>`
 *   - Instagram `/reel/`, `/reels/`, `/p/`, `/tv/` (with or without a `/<user>/` prefix)
 *     → `https://www.instagram.com/p/<id>`
 *   - TikTok `/@user/video/<id>` on any host (www., m.) → `https://www.tiktok.com/@user/video/<id>`
 *   - anything else: lower-case host without `www.` / `m.` (then `www.` again for the three platform
 *     domains), no query, no hash, no trailing "/".
 *
 * MIRRORED in `lib/research.ts` (the dashboard dedupes pasted links and saved references by the same
 * rule): change both together.
 */
export function canonicalUrl(platform: Platform, u: URL): string {
  if (platform === "yt") {
    const id = youtubeVideoId(u);
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  if (platform === "ig") {
    const id = u.pathname.match(IG_POST_PATH)?.[1];
    if (id) return `https://www.instagram.com/p/${id}`;
  }
  if (platform === "tt") {
    const m = u.pathname.match(TT_VIDEO_PATH);
    if (m) return `https://www.tiktok.com/${m[1]}/video/${m[2]}`;
  }
  let host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
  if (Object.values(PLATFORM_DOMAIN).includes(host)) host = `www.${host}`;
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}`;
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

/* ---------- page text ---------- */

/** Bidi controls Instagram wraps Arabic names and dates in (LRM, RLM, embeddings, isolates, ALM). */
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩؜]/g;

/** Page text without bidi marks, whitespace collapsed. */
export function cleanText(text: string | undefined): string {
  return (text ?? "").replace(BIDI_MARKS, "").replace(/\s+/g, " ").trim();
}

/** The text after an opening quote, up to the last closing quote (captions may quote things themselves). */
function quotedTail(text: string, from: number): string {
  const rest = text.slice(from);
  const end = Math.max(rest.lastIndexOf('"'), rest.lastIndexOf("”"));
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

/* ---------- Instagram ---------- */

/** Instagram's own page titles that say nothing about the post. */
export function isGenericInstagramTitle(title: string): boolean {
  const t = cleanText(title);
  return (
    !t ||
    /^(?:instagram|login • instagram|instagram photos and videos)$/i.test(t) ||
    /[•·]\s*Instagram/i.test(t) ||
    // og:title of a post without a caption: "<Name> on Instagram" / "<Name> على Instagram".
    /^.+\s(?:on|على)\s+Instagram\s*:?$/i.test(t)
  );
}

/** og:title: `<Name> on Instagram: "caption"` / `<Name> على Instagram : "caption"`. */
const IG_OG_CAPTION = /^.+?\s(?:on|على)\s+Instagram\s*:\s*["“]/i;
/** The text mentions likes / comments (English or Arabic Instagram UI). */
const ENGAGEMENT_WORD = /\b(?:likes?|comments?)\b|إعجاب|تعليق/i;
/** Description head: `<n> likes, <m> comments - <username> on|في <date>` (the part before the caption). */
const IG_DESC_HEAD =
  /(?:likes?|comments?|إعجاب|تعليق\S*)[^-]{0,40}-\s*([A-Za-z0-9._]+)\s+(?:on|في)\s+[^:"“]{1,60}?(?=:|$)/i;
/** twitter:title: `<Name> (@user) • Instagram reel`. */
const IG_TWITTER_HANDLE = /\(@([A-Za-z0-9._]+)\)\s*[•·]/;
/** Text that opens with engagement counts ("12K likes, 80 comments - …"): never a sentence to show. */
const ENGAGEMENT_HEAD =
  /^[\d٠-٩.,٫٬\s]+\s*[KMB]?\s*(?:ألف|مليون)?\s*(?:likes?|comments?|تسجيلات?|إعجاب|تعليق)/i;

function igDescription(text: string): { handle: string; caption: string } | undefined {
  if (!ENGAGEMENT_WORD.test(text)) return undefined;
  const m = IG_DESC_HEAD.exec(text);
  if (!m) return undefined;
  const headEnd = m.index + m[0].length;
  const open = text.slice(headEnd).match(/^:\s*["“]/);
  const caption = open ? quotedTail(text, headEnd + open[0].length) : "";
  return { handle: m[1], caption };
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.!?؟])\s+/)[0] ?? "";
}

/**
 * Handle and title for an Instagram card from the Tavily hit (title and content already cleaned).
 *   Handle: URL `/<user>/reel/` → the description's "- <username> on|في <date>" → twitter:title
 *   "(@user) •" → "" (never the hostname).
 *   Title: the og:title caption → the description's caption → a non-generic title as-is (search engines
 *   often give the caption) → the content's first sentence unless it is engagement boilerplate → "@user"
 *   → "Instagram reel".
 */
export function instagramCard(
  urlHandle: string,
  title: string,
  content: string,
): { handle: string; title: string } {
  const contentDesc = igDescription(content);
  const desc = contentDesc ?? igDescription(title);
  const twitter = (title.match(IG_TWITTER_HANDLE) ?? content.match(IG_TWITTER_HANDLE))?.[1];
  const handle = urlHandle || (desc ? `@${desc.handle}` : twitter ? `@${twitter}` : "");

  const og = IG_OG_CAPTION.exec(title) ?? IG_OG_CAPTION.exec(content);
  const ogCaption = og ? quotedTail(og.input, og.index + og[0].length) : "";
  const boilerplate = !content || !!contentDesc || ENGAGEMENT_HEAD.test(content);
  const sentence = boilerplate ? "" : firstSentence(content);
  const cardTitle =
    ogCaption ||
    desc?.caption ||
    (isGenericInstagramTitle(title) ? "" : title) ||
    (isGenericInstagramTitle(sentence) ? "" : sentence) ||
    handle ||
    "Instagram reel";
  return { handle, title: cardTitle };
}

/* ---------- TikTok ---------- */

/** A TikTok page / oEmbed title without the " | TikTok" suffix or the "TikTok video from … (@h): " prefix. */
export function cleanTikTokTitle(raw: string | undefined): string {
  let t = cleanText(raw).replace(/\s*\|\s*TikTok$/i, "");
  const prefix = t.match(/^TikTok video from .*?\(@[\w.-]+\)\s*:\s*/i);
  if (prefix) {
    t = t.slice(prefix[0].length).trim();
    const quoted = t.match(/^["“]([\s\S]*)["”]$/);
    if (quoted) t = quoted[1].trim();
  }
  return t;
}

/** TikTok titles that say nothing about the video ("TikTok - Make Your Day", "Name (@handle)"). */
export function isGenericTikTokTitle(title: string): boolean {
  const t = cleanText(title);
  return (
    !t ||
    /^(?:tiktok(?: - make your day)?|tiktok · .+|.+ on tiktok)$/i.test(t) ||
    /\(@[\w.-]+\)$/.test(t)
  );
}

/**
 * The title a TikTok card should take from its oEmbed reply: the cleaned oEmbed title, when the card's
 * title is generic or just the handle and the oEmbed one says more; otherwise undefined (keep the card's).
 */
export function tiktokTitleFromOembed(
  card: Pick<ScoutResult, "title" | "handle">,
  oembedTitle: string | undefined,
): string | undefined {
  if (!isGenericTikTokTitle(card.title) && card.title !== card.handle) return undefined;
  const t = cleanTikTokTitle(oembedTitle);
  return t && !isGenericTikTokTitle(t) ? clip(t, TITLE_MAX) : undefined;
}

/* ---------- engagement counts ---------- */

/**
 * One count of a description head: the number (ASCII, Arabic-Indic or Persian digits, with "," "." or the
 * Arabic marks U+066C thousands / U+066B decimal), an optional multiplier (K / M / B, ألف / مليون / مليار),
 * TikTok's Arabic "من", and the word that says what was counted.
 */
const COUNT_RE =
  /(?<![\p{L}\p{N}.,\u066B\u066C])([\d\u0660-\u0669\u06F0-\u06F9]+(?:[.,\u066B\u066C][\d\u0660-\u0669\u06F0-\u06F9]+)*)\s*((?:[KMB]|thousand|million|billion)(?![a-z])|(?:[أاآ]لا?ف|ملايين|مليون|مليار)(?![\u0621-\u064A]))?\s*(?:من\s+)?((?:likes?|comments?|views?)(?![a-z])|(?:تسجيل(?:ات)?\s+)?(?:ال)?[إا]عجاب[\u0621-\u0652]*|(?:ال)?تعليق[\u0621-\u0652]*|(?:ال)?مشاهد[\u0621-\u0652]*)/giu;
/** What may stand between two counts of one head: "1,234 likes, 56 comments", "… إعجاب، ٥٥ تعليق". */
const COUNT_GAP = /^\s*(?:[,،·•|]|and\b|و)?\s*$/i;
/** What may stand before a head that opens the text. */
const COUNT_LEAD = /^[\s\p{P}]*$/u;
/** What follows a head: nothing, or punctuation ("- <user> on …", ". TikTok video from …"), never a word. */
const COUNT_TAIL = /^\s*(?:$|[-–—.:·•|,،])/;

function multiplierOf(unit: string | undefined): number {
  if (!unit) return 1;
  const u = unit.toLowerCase();
  if (u === "k" || u === "thousand" || /^[أاآ]لا?ف$/.test(u)) return 1_000;
  if (u === "b" || u === "billion" || u === "مليار") return 1_000_000_000;
  return 1_000_000;
}

/** "1,234" → 1234 · "13.5" × 1000 → 13500 · "٢٬٥٠٧" → 2507 · "١٣٫٥" × 1000 → 13500; undefined when it is no count. */
function countValue(raw: string, multiplier: number): number | undefined {
  let s = raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066C/g, ",")
    .replace(/\u066B/g, ".");
  if (multiplier === 1) {
    // A plain count is a whole number, so every mark groups thousands ("1,234", "2.431", "12,345,678").
    if (!/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(s)) return undefined;
    s = s.replace(/[.,]/g, "");
  } else {
    // Before K / M / ألف the last mark is the decimal one ("13.5K", "13,5K", "١٣٫٥ ألف").
    const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    if (last >= 0) s = `${s.slice(0, last).replace(/[.,]/g, "")}.${s.slice(last + 1)}`;
  }
  const n = Math.round(Number(s) * multiplier);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

function countKind(word: string): keyof Stats {
  if (/^v|مشاهد/i.test(word)) return "views";
  if (/^c|تعليق/i.test(word)) return "comments";
  return "likes";
}

/**
 * The counts an Instagram or TikTok page puts at the head of its description, English or Arabic UI:
 *   "1,234 likes, 56 comments - <user> on <date>: …" · "3M likes, 153K comments - …" · "12K likes"
 *   "٢٬٥٠٧ تسجيلات إعجاب، ٥٥ تعليق" · "١٣٫٥ ألف إعجاب" · "٣٣ مليون تسجيل إعجاب، ١ مليون تعليق - …"
 *   "13.5K Likes, 120 Comments. TikTok video from …" · "13.5K من تسجيلات الإعجاب، 120 من التعليقات. …"
 * Only the first run of counts is read, and only when it names at least two different counts or is the
 * whole opening of the text (a caption such as "100 likes and I post part 2" is not a head). Text is
 * expected without bidi marks ({@link cleanText}). Undefined when nothing was read, never an empty object.
 */
export function parseEngagement(text: string): Stats | undefined {
  const stats: Stats = {};
  let start = -1;
  let end = -1;
  for (const m of text.matchAll(COUNT_RE)) {
    if (start >= 0 && !COUNT_GAP.test(text.slice(end, m.index))) break;
    if (start < 0) start = m.index;
    end = m.index + m[0].length;
    const value = countValue(m[1], multiplierOf(m[2]));
    const kind = countKind(m[3]);
    if (value !== undefined && stats[kind] === undefined) stats[kind] = value;
  }
  const kinds = Object.keys(stats).length;
  if (!kinds) return undefined;
  if (kinds >= 2) return stats;
  const opens = COUNT_LEAD.test(text.slice(0, start)) && COUNT_TAIL.test(text.slice(end));
  return opens ? stats : undefined;
}

/* ---------- hits → cards ---------- */

/**
 * Normalize Tavily hits into cards: keep only the requested platforms, only single-video pages, one card
 * per canonical URL. YouTube cards get the public `i.ytimg.com` thumbnail derived from the video id;
 * TikTok and Instagram cards get `stats` when the page text opens with its counts (YouTube's come from the
 * Data API, scout.ts `enrichYoutubeStats`).
 */
export function normalizeHits(
  hits: readonly TavilyHit[],
  platforms: readonly Platform[],
  /** The run's time: a post id decoding after it (+ 1 day) is a bad decode, no date. */
  now = new Date(),
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
    const rawTitle = cleanText(hit.title);
    const content = cleanText(hit.content);
    // From the ORIGINAL URL: the canonical Instagram form drops the /<user>/ prefix.
    let handle = handleFromUrl(platform, u);
    let title: string;
    if (platform === "ig") {
      ({ handle, title } = instagramCard(handle, rawTitle, content));
    } else if (platform === "tt") {
      const t = cleanTikTokTitle(rawTitle);
      // A generic title shows the handle until the oEmbed caption replaces it (scout.ts enrichThumbs).
      title = isGenericTikTokTitle(t) ? handle : t;
    } else {
      title = rawTitle || handle;
    }
    const result: ScoutResult = {
      platform,
      handle,
      title: clip(title, TITLE_MAX),
      snippet: clip(content, SNIPPET_MAX),
      url,
    };
    if (thumb) result.thumb = thumb;
    if (platform !== "yt") {
      // The post's own id is its date (postDate.ts): Tavily sends none for Instagram, and its windows are unreliable.
      const posted = postedAt(url, now);
      if (posted) result.published = posted;
    } else if (typeof hit.published_date === "string") {
      // Tavily sends RFC 2822 ("Tue, 30 Sep 2026 17:00:00 GMT"); kept as ISO so dates sort as text.
      const t = Date.parse(hit.published_date);
      if (!Number.isNaN(t)) result.published = new Date(t).toISOString();
    }
    if (platform !== "yt") {
      const stats = parseEngagement(content) ?? parseEngagement(rawTitle);
      if (stats) result.stats = stats;
    }
    out.push(result);
  }
  return out;
}

/* ---------- profile pages (Discover v2: creator candidates) ---------- */

export interface Profile {
  platform: Platform;
  /** "@name". */
  handle: string;
  url: string;
}

const TT_PROFILE_PATH = /^\/@([\w.-]+)\/?$/;
/** `/<name>/`, also its Reels and Tagged tabs. */
const IG_PROFILE_PATH = /^\/([A-Za-z0-9._]+)(?:\/(?:reels|tagged))?\/?$/;
/** `/@name`, also its tabs. */
const YT_PROFILE_PATH =
  /^\/@([\w.-]+)(?:\/(?:videos|shorts|featured|streams|playlists|about))?\/?$/;
/** First path segments that are Instagram pages, never an account (wider than IG_RESERVED). */
const IG_NOT_PROFILE = new Set([
  ...IG_RESERVED,
  "about",
  "directory",
  "web",
  "developer",
  "legal",
  "privacy",
  "terms",
  "emails",
  "challenge",
  "direct",
  "session",
  "popular",
]);

/**
 * The account a profile page belongs to (TikTok `/@name`, Instagram `/<name>/`, YouTube `/@name`; a
 * profile tab counts as the profile), on the platform's own host only (never help.instagram.com), else
 * undefined.
 */
export function profileFromUrl(platform: Platform, u: URL): Profile | undefined {
  if (u.hostname.toLowerCase().replace(/^(?:www|m)\./, "") !== PLATFORM_DOMAIN[platform])
    return undefined;
  if (platform === "tt") {
    const m = u.pathname.match(TT_PROFILE_PATH);
    return m ? { platform, handle: `@${m[1]}`, url: `https://www.tiktok.com/@${m[1]}` } : undefined;
  }
  if (platform === "ig") {
    const m = u.pathname.match(IG_PROFILE_PATH);
    if (!m || IG_NOT_PROFILE.has(m[1].toLowerCase())) return undefined;
    return { platform, handle: `@${m[1]}`, url: `https://www.instagram.com/${m[1]}/` };
  }
  const m = u.pathname.match(YT_PROFILE_PATH);
  return m ? { platform, handle: `@${m[1]}`, url: `https://www.youtube.com/@${m[1]}` } : undefined;
}

/**
 * One platform's Tavily hits as Discover wants them: the post cards (`normalizeHits`) and, apart, the profile
 * pages a search found (dropped by `/search`; Discover lists them as creators).
 */
export function normalizeDiscoverHits(
  hits: readonly TavilyHit[],
  platform: Platform,
  now = new Date(),
): { cards: ScoutResult[]; profiles: Profile[] } {
  const cards = normalizeHits(hits, [platform], now);
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const hit of hits) {
    let u: URL;
    try {
      u = new URL(hit.url ?? "");
    } catch {
      continue;
    }
    const p = profileFromUrl(platform, u);
    if (!p || seen.has(p.handle.toLowerCase())) continue;
    seen.add(p.handle.toLowerCase());
    profiles.push(p);
  }
  return { cards, profiles };
}
