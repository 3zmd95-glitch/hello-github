import { BT_SCORE_CAP, median, settledStats } from "./bestTimes";
import type { HashtagSet, Platform, Post, SocialPostStat } from "./domain";
import { autoPostOf, captionFor, sendCaption } from "./publish";
import { isSocialPlatform } from "./socialSync";

/**
 * A8 · Saved hashtag sets and how each did. A post "used" a set when it carries all of its tags; its numbers come
 * from the platform stats the sync and the CSV import fill (`socialPostStats`), joined to the calendar post by the
 * Worker's post id (`autoPost.results[p].postId`) or by the link it was posted at. A set is judged by its posts' views
 * against the median of the same platform (capped at 4x, settled posts only, as in the best times), and only
 * once it has {@link HASHTAG_MIN_SAMPLE} posts. Pure functions.
 */

export const HASHTAG_MIN_SAMPLE = 5;
export const HASHTAG_MAX_TAGS = 30;

/** A tag without its leading "#"s, lowercased: how two tags are compared. */
export const tagKey = (raw: string): string => raw.trim().replace(/^#+/, "").toLowerCase();

/**
 * Tags typed or pasted as text: split on spaces, commas (Arabic ones too) and lines, each given one leading "#",
 * duplicates (in any case) and empty ones dropped, at most {@link HASHTAG_MAX_TAGS}. "a, #A ##b" gives ["#a", "#b"].
 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,،]+/)) {
    const key = tagKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(`#${raw.trim().replace(/^#+/, "")}`);
    if (out.length === HASHTAG_MAX_TAGS) break;
  }
  return out;
}

/** Whether the post carries every tag of the set (any case, any order). */
export function matchesSet(set: HashtagSet, post: Post): boolean {
  const have = new Set(post.hashtags.map(tagKey));
  return set.tags.every((t) => have.has(tagKey(t)));
}

/** A link as comparable text: no scheme, "www.", query, fragment or closing slash. Null when it is not a link. */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const statKey = (s: Pick<SocialPostStat, "platform" | "postId">): string =>
  `${s.platform}|${s.postId}`;

/** The numbers the platforms report for a posted calendar post: by the Worker's post id, else by the link. */
export function statsOfPost(post: Post, stats: readonly SocialPostStat[]): SocialPostStat[] {
  if (post.stage !== "posted") return [];
  const found = new Map<string, SocialPostStat>();
  const byLink = (platform: Platform, link: string | undefined) => {
    const want = link ? normalizeUrl(link) : null;
    if (!want) return;
    const hit = stats.find(
      (s) => s.platform === platform && !!s.permalink && normalizeUrl(s.permalink) === want,
    );
    if (hit) found.set(statKey(hit), hit);
  };
  for (const [platform, r] of Object.entries(post.autoPost?.results ?? {})) {
    if (!r) continue;
    const hit = r.postId
      ? stats.find((s) => s.platform === platform && s.postId === r.postId)
      : undefined;
    if (hit) found.set(statKey(hit), hit);
    else byLink(platform as Platform, r.permalink);
  }
  byLink(post.platform, post.postedUrl);
  return [...found.values()];
}

export interface HashtagSetStats {
  setId: string;
  /** Posts of the set with settled numbers. */
  n: number;
  avgViews: number | null;
  /** Mean of views / the platform's median, each capped at 4: 1 = as usual, 2 = twice as many views. */
  vsMedian: number | null;
  /** n reached {@link HASHTAG_MIN_SAMPLE}: enough to say something. */
  enough: boolean;
}

/** How each set did, as of `now` (ms). */
export function hashtagSetStats(
  sets: readonly HashtagSet[],
  posts: readonly Post[],
  stats: readonly SocialPostStat[],
  now: number,
): HashtagSetStats[] {
  const pools = new Map<Platform, { keys: Set<string>; median: number }>();
  const poolOf = (platform: Platform) => {
    let pool = pools.get(platform);
    if (!pool) {
      const settled = settledStats(stats, platform, now);
      pool = { keys: new Set(settled.map(statKey)), median: median(settled.map((s) => s.views)) };
      pools.set(platform, pool);
    }
    return pool;
  };
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return sets.map((set) => {
    const seen = new Set<string>();
    const views: number[] = [];
    const ratios: number[] = [];
    for (const post of posts) {
      if (!matchesSet(set, post)) continue;
      for (const s of statsOfPost(post, stats)) {
        const pool = poolOf(s.platform);
        if (seen.has(statKey(s)) || !pool.keys.has(statKey(s)) || pool.median <= 0) continue;
        seen.add(statKey(s));
        views.push(s.views);
        ratios.push(Math.min(s.views / pool.median, BT_SCORE_CAP));
      }
    }
    const n = views.length;
    return {
      setId: set.id,
      n,
      avgViews: n ? Math.round(mean(views)) : null,
      vsMedian: n ? mean(ratios) : null,
      enough: n >= HASHTAG_MIN_SAMPLE,
    };
  });
}

/* ---------- limits: what a network takes, never dropped silently ---------- */

/** Instagram takes 30 hashtags at most; the post dialog warns from 25 and adds no more past 30. */
export const HASHTAG_IG_MAX = 30;
export const HASHTAG_IG_WARN = 25;

/** The networks a post goes to: its own platform and those of its auto-post settings. */
function networksOf(post: Post): Platform[] {
  return [...new Set<Platform>([post.platform, ...(post.autoPost?.platforms ?? [])])];
}

/** The most hashtags this post may carry (Instagram's 30 when it goes there), or null when no network sets one. */
export function hashtagLimit(post: Post): number | null {
  return networksOf(post).includes("instagram") ? HASHTAG_IG_MAX : null;
}

/** ok, near the limit (25+), or full (at the limit). */
export function hashtagLevel(post: Post): "ok" | "near" | "full" {
  const limit = hashtagLimit(post);
  if (limit === null) return "ok";
  if (post.hashtags.length >= limit) return "full";
  return post.hashtags.length >= HASHTAG_IG_WARN ? "near" : "ok";
}

/**
 * Which of `tags` can be added to the post: new ones only (any case), as many as fit under its limit; `refused`
 * counts the new ones that did not fit, so the caller can say so.
 */
export function fitTags(post: Post, tags: readonly string[]): { add: string[]; refused: number } {
  const have = new Set(post.hashtags.map(tagKey));
  const limit = hashtagLimit(post);
  const add: string[] = [];
  let refused = 0;
  for (const tag of tags) {
    const key = tagKey(tag);
    if (!key || have.has(key)) continue;
    if (limit !== null && have.size >= limit) {
      refused++;
      continue;
    }
    have.add(key);
    add.push(tag);
  }
  return { add, refused };
}

const hashtagTokens = (text: string): string[] => text.match(/#[^\s#]+/g) ?? [];

/**
 * How many hashtags the caption trim of an API network (`sendCaption`: trailing hashtags first, then a word-boundary cut)
 * takes out of what the owner wrote. 0 when the caption fits.
 */
export function hashtagsCut(post: Post, platform: Platform): number {
  if (!isSocialPlatform(platform)) return 0;
  const auto = autoPostOf(post);
  const sent = sendCaption(post, auto, platform);
  if (!sent.trimmed) return 0;
  const kept = new Set(hashtagTokens(sent.text).map(tagKey));
  return hashtagTokens(captionFor(post, auto, platform)).filter((t) => !kept.has(tagKey(t))).length;
}

/** The API networks this post is sent to where hashtags get cut, with how many. */
export function hashtagCuts(post: Post): { platform: Platform; cut: number }[] {
  return (post.autoPost?.platforms ?? [])
    .filter(isSocialPlatform)
    .map((platform) => ({ platform, cut: hashtagsCut(post, platform) }))
    .filter((c) => c.cut > 0);
}
