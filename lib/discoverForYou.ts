import type { DiscoverItem } from "./discover";
import {
  discoverPostKey,
  type DiscoverCandidate,
  type DiscoverFeedback,
  type DiscoverSavedInterest,
} from "./discoverFeed";
import {
  creatorKey,
  rankDiscoverItems,
  type DiscoverEvidence,
  type DiscoverFeedMode,
} from "./discoverRanking";

export interface DiscoverForYouRow {
  item: DiscoverItem;
  /** The category in which this item qualified; feedback must retain this context. */
  genreId: string;
  evidence: DiscoverEvidence;
}

export interface DiscoverForYouResult {
  rows: DiscoverForYouRow[];
  /** Distinct qualified posts before the display limit, after explicit dismissals. */
  totalQualified: number;
  /** Qualified posts per category; a post can qualify in more than one category. */
  genreCounts: Record<string, number>;
}

function time(value: string | undefined, now: number): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now + 5 * 60_000 ? parsed : 0;
}

function direct(item: DiscoverItem): boolean {
  return item.platform === "ig"
    ? item.evidence?.source === "instagram-public-embed"
    : item.platform === "yt"
      ? item.evidence?.source === "youtube-api"
      : item.evidence?.source === "tiktok-oembed" || item.evidence?.source === "tiktok-public-page";
}

/** An authentic observation belongs to the post, including when its old copy lives in another category. */
function sharedSources(candidates: readonly DiscoverCandidate[], now: number) {
  const best = new Map<string, DiscoverCandidate>();
  for (const entry of candidates) {
    const key = discoverPostKey(entry.item.platform, entry.item.url);
    if (!key) continue;
    const previous = best.get(key);
    if (
      !previous ||
      (direct(entry.item) && !direct(previous.item)) ||
      (direct(entry.item) === direct(previous.item) &&
        (time(entry.item.evidence?.observedAt, now) >
          time(previous.item.evidence?.observedAt, now) ||
          (time(entry.item.evidence?.observedAt, now) ===
            time(previous.item.evidence?.observedAt, now) &&
            time(entry.obtainedAt, now) > time(previous.obtainedAt, now))))
    )
      best.set(key, entry);
  }
  return best;
}

/** A local mix of already retrieved examples. No provider, source lookup, or implicit watch event.
 * Rank within each category first: flattening the pool would lose subject checks and category votes. */
export function discoverForYou(
  candidates: readonly DiscoverCandidate[],
  options: {
    mode?: DiscoverFeedMode;
    feedback?: DiscoverFeedback[];
    savedInterests?: DiscoverSavedInterest[];
    now?: number;
    limit?: number;
  } = {},
): DiscoverForYouResult {
  const now = Number.isFinite(options.now) ? options.now! : Date.now();
  const limit = Number.isFinite(options.limit)
    ? Math.max(0, Math.min(500, Math.floor(options.limit!)))
    : 30;
  const feedback = (options.feedback ?? []).filter((entry) => time(entry.at, now));
  const savedInterests = (options.savedInterests ?? []).filter((entry) => time(entry.savedAt, now));
  const sources = sharedSources(candidates, now);
  const groups = new Map<string, Map<string, DiscoverItem>>();
  for (const entry of candidates) {
    const key = discoverPostKey(entry.item.platform, entry.item.url);
    const source = key && sources.get(key);
    if (!key || !source || !entry.genreId.trim()) continue;
    const group = groups.get(entry.genreId) ?? new Map<string, DiscoverItem>();
    group.set(key, {
      ...source.item,
      url: key,
      // These flags belong to the retrieval's category, not to the source observation itself.
      offTopic: entry.item.offTopic,
      outsideCategory: entry.item.outsideCategory,
    });
    groups.set(entry.genreId, group);
  }

  // Do not resurrect a dismissed post under its second category in the same mixed feed.
  // The category screens keep their own scope; a later explicit More reverses this global dismissal.
  const latestVote = new Map<string, DiscoverFeedback>();
  for (const vote of [...feedback].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const key = discoverPostKey(vote.platform, vote.url);
    if (key && (vote.action === "more" || vote.action === "less")) latestVote.set(key, vote);
  }
  const qualified: DiscoverForYouRow[] = [];
  const counts = new Map<string, number>();
  const affinity = new Map<string, number>();
  for (const [genreId, items] of groups) {
    const ranked = rankDiscoverItems([...items.values()], {
      genreId,
      now,
      feedback,
      savedInterests,
      mode: options.mode ?? "inspiration",
    });
    const rows = ranked.items
      .filter((item) => latestVote.get(item.url)?.action !== "less")
      .map((item) => ({ item, genreId, evidence: ranked.evidence[item.url] }));
    counts.set(genreId, rows.length);
    qualified.push(...rows);
    const eligible = new Set(
      rows.filter((row) => row.evidence.eligible).map((row) => row.item.url),
    );
    const positive = new Set(
      feedback
        .filter(
          (vote) =>
            vote.action === "more" &&
            vote.genreId === genreId &&
            eligible.has(discoverPostKey(vote.platform, vote.url) ?? ""),
        )
        .map((vote) => vote.url),
    );
    const practice = savedInterests
      .filter((saved) => eligible.has(discoverPostKey(saved.platform, saved.url) ?? ""))
      .reduce(
        (sum, saved) => sum + ({ saved: 0.5, trying: 0.75, tried: 1 } as const)[saved.stage],
        0,
      );
    affinity.set(genreId, Math.min(4, positive.size * 1.5) + Math.min(2, practice));
  }

  const rows: DiscoverForYouRow[] = [];
  const used = new Set<string>();
  const genreUse = new Map<string, number>();
  const creatorUse = new Map<string, number>();
  const techniqueUse = new Map<string, number>();
  const mixedScore = (row: DiscoverForYouRow) =>
    row.evidence.score +
    (affinity.get(row.genreId) ?? 0) -
    row.evidence.techniques.reduce(
      (sum, technique) => sum + Math.min(2, techniqueUse.get(technique) ?? 0) * 3,
      0,
    );
  while (rows.length < limit) {
    const remaining = qualified.filter((row) => !used.has(row.item.url));
    if (!remaining.length) break;
    remaining.sort(
      (a, b) =>
        (genreUse.get(a.genreId) ?? 0) - (genreUse.get(b.genreId) ?? 0) ||
        (creatorUse.get(creatorKey(a.item)) ?? 0) - (creatorUse.get(creatorKey(b.item)) ?? 0) ||
        mixedScore(b) - mixedScore(a),
    );
    const row = remaining[0];
    rows.push(row);
    used.add(row.item.url);
    genreUse.set(row.genreId, (genreUse.get(row.genreId) ?? 0) + 1);
    const creator = creatorKey(row.item);
    creatorUse.set(creator, (creatorUse.get(creator) ?? 0) + 1);
    for (const technique of row.evidence.techniques)
      techniqueUse.set(technique, (techniqueUse.get(technique) ?? 0) + 1);
  }
  return {
    rows,
    totalQualified: new Set(qualified.map((row) => row.item.url)).size,
    genreCounts: Object.fromEntries(counts),
  };
}
