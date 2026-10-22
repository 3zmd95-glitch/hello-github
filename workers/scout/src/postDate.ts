/**
 * When an Instagram or TikTok post went up, read from its own id (2026-10-07). Tavily sends no `published_date` for
 * Instagram and its `time_range` there is unreliable (a "week" search returned posts from 2023 and May), so the post id
 * is the date Discover and Trending effects trust. Verified against the owner's own posts (postDate.test.ts).
 */

// Instagram: a shortcode is base64 (this alphabet) of a Snowflake-like media id; ms = (id >> 23) + 1314220021721.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// BigInt(…) rather than `64n` literals: the dashboard's tsc (target ES2017) also reads this file, through normalize.ts.
const IG_EPOCH_MS = BigInt("1314220021721");
const N64 = BigInt(64);
const N23 = BigInt(23);
const N32 = BigInt(32);
/** No post is older than this; a decode before it, or after now + 1 day, is a bad one. */
const FIRST_POST_MS = Date.UTC(2010, 0, 1);
const DAY_MS = 86_400_000;

const plausible = (d: Date, now: Date): Date | null =>
  d.getTime() >= FIRST_POST_MS && d.getTime() <= now.getTime() + DAY_MS ? d : null;

export function instagramPostedAt(shortcode: string, now = new Date()): Date | null {
  if (!shortcode) return null;
  let id = BigInt(0);
  for (const ch of shortcode) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    id = id * N64 + BigInt(i);
  }
  return plausible(new Date(Number((id >> N23) + IG_EPOCH_MS)), now);
}

// TikTok: the video id's top 32 bits are Unix seconds.
export function tiktokPostedAt(videoId: string, now = new Date()): Date | null {
  if (!/^\d+$/.test(videoId)) return null;
  return plausible(new Date(Number(BigInt(videoId) >> N32) * 1000), now);
}

/** One post: `/p|reel|reels|tv/<code>`, maybe behind `/<user>/` (as normalize.ts IG_POST_PATH; never a sound page). */
const IG_POST = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/(?!audio\/)([\w-]+)\/?$/;
const TT_POST = /^\/@[\w.-]+\/(?:video|photo)\/(\d+)/;

/** The post time (ISO 8601) of an Instagram post or TikTok video / photo link; undefined for anything else. */
export function postedAt(url: string, now = new Date()): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  const ig = on("instagram.com") ? u.pathname.match(IG_POST)?.[1] : undefined;
  const tt = on("tiktok.com") ? u.pathname.match(TT_POST)?.[1] : undefined;
  const date = ig ? instagramPostedAt(ig, now) : tt ? tiktokPostedAt(tt, now) : null;
  return date?.toISOString();
}

/** The inverse, for test fixtures: a TikTok video id posted at `at` (`n` < 2^32 keeps ids apart). */
export function tiktokIdAt(at: Date, n = 0): string {
  return String((BigInt(Math.floor(at.getTime() / 1000)) << N32) + BigInt(n));
}

/** The inverse, for test fixtures: an Instagram shortcode posted at `at` (`n` < 2^23 keeps codes apart). */
export function instagramShortcodeAt(at: Date, n = 0): string {
  let id = ((BigInt(at.getTime()) - IG_EPOCH_MS) << N23) + BigInt(n);
  let code = "";
  for (; id > BigInt(0); id /= N64) code = ALPHABET[Number(id % N64)] + code;
  return code;
}
