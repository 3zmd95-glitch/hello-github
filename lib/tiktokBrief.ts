import type { SocialPostStat } from "./domain";

export type TikTokRank = "views" | "shares" | "comments";
const DAY = 86_400_000;

/** A publishing cohort, not views received within the selected period. Counters are lifetime totals. */
export function tiktokBrief(
  stats: readonly SocialPostStat[],
  now: number,
  days: 7 | 30,
  rank: TikTokRank = "views",
) {
  const newest = new Map<string, SocialPostStat>();
  for (const post of stats) {
    const published = Date.parse(post.publishedAt);
    if (
      post.platform !== "tiktok" ||
      !Number.isFinite(published) ||
      published > now ||
      published <= now - days * DAY
    )
      continue;
    newest.set(post.postId, post);
  }
  const posts = [...newest.values()];
  const views = posts.map((p) => p.views).sort((a, b) => a - b);
  const middle = Math.floor(views.length / 2);
  const medianViews = views.length
    ? views.length % 2
      ? views[middle]
      : (views[middle - 1] + views[middle]) / 2
    : null;
  const total = (key: TikTokRank) => posts.reduce((sum, p) => sum + p[key], 0);
  const totalViews = total("views");
  const totalShares = total("shares");
  const totalComments = total("comments");
  const top = [...posts]
    .sort(
      (a, b) =>
        b[rank] - a[rank] ||
        b.views - a.views ||
        b.publishedAt.localeCompare(a.publishedAt) ||
        a.postId.localeCompare(b.postId),
    )
    .slice(0, 3);
  return {
    days,
    posts,
    top,
    medianViews,
    totalViews,
    totalShares,
    totalComments,
    sharesPerThousand: totalViews ? (totalShares / totalViews) * 1000 : null,
    commentsPerThousand: totalViews ? (totalComments / totalViews) * 1000 : null,
  };
}

/** Only open real TikTok post links. Imported CSV rows can contain arbitrary URLs. */
export function safeTikTokPostUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!["www.tiktok.com", "tiktok.com"].includes(url.hostname)) return null;
    if (!/^\/@[^/]+\/(?:video|photo)\/\d+\/?$/.test(url.pathname)) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

/** No spreadsheet-formula cells, including titles pasted from a platform export. */
export function tiktokBriefCsv(posts: readonly SocialPostStat[]): string {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [
    [
      "Post ID",
      "Title",
      "Published at",
      "Lifetime views",
      "Lifetime likes",
      "Lifetime comments",
      "Lifetime shares",
      "URL",
    ],
    ...posts.map((p) => [
      p.postId,
      p.title ?? "",
      p.publishedAt,
      p.views,
      p.likes,
      p.comments,
      p.shares,
      safeTikTokPostUrl(p.permalink) ?? "",
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
