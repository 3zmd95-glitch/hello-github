/** Local, deterministic ranking of retrieved candidates. Metadata establishes relevance, never visual quality.
 * Recomputing this over cached candidates performs no network requests and cannot spend search credits. */
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";
import {
  discoverCreativeEvidence as categoryCreativeEvidence,
  discoverSourceCaption,
} from "./discoverMetadata";
import type { DiscoverItem } from "./discover";
import {
  discoverCreatorKey,
  discoverFeedbackCreator,
  discoverPostKey,
  type DiscoverFeedback,
  type DiscoverSavedInterest,
} from "./discoverFeed";

export type DiscoverFeedMode = "inspiration" | "popular" | "learning" | "explore";
export type DiscoverReason =
  | "named-technique"
  | "teaching"
  | "strong-engagement"
  | "recent-post"
  | "source-caption"
  | "indexed-only"
  | "unknown-engagement"
  | "low-engagement"
  | "stale-engagement"
  | "old-post"
  | "unknown-date"
  | "outside-category"
  | "off-topic"
  | "no-craft"
  | "personal-interest"
  | "personal-dismissed"
  | "source-unavailable";

export interface DiscoverEvidence {
  techniques: string[];
  reasons: DiscoverReason[];
  categoryMatch: boolean;
  craft: "specific" | "generic" | "none";
  /** A described creative project, not a claim of a named technique or watched visual quality. */
  project?: boolean;
  teaching: boolean;
  sourceTier: "direct" | "indexed" | "unknown";
  engagement: {
    metric?: "likes" | "views";
    value?: number;
    basis: "source" | "indexed" | "unknown";
    observedAt?: string;
    fresh: boolean;
    strong: boolean;
  };
  date: {
    published?: string;
    ageDays?: number;
    basis: "source" | "reported" | "unknown";
    recent: boolean;
  };
  /** Category/craft relevance, not a claim of watched or verified editing quality. */
  eligible: boolean;
  popular: boolean;
  score: number;
}

const DAY = 86_400_000;
const CLOCK_SKEW = 5 * 60_000;
/** Transparent screening thresholds, not growth measurements or equivalent units across platforms. */
export const DISCOVER_ENGAGEMENT_FLOORS = {
  inspiration: {
    yt: { views: 5000, likes: 100 },
    ig: { views: 10000, likes: 500 },
    tt: { views: 10000, likes: 500 },
  },
  popular: {
    yt: { views: 10000, likes: 250 },
    ig: { views: 25000, likes: 1000 },
    tt: { views: 25000, likes: 1000 },
  },
} as const;

const DIRECT_SOURCE = {
  yt: "youtube-api",
  ig: "instagram-public-embed",
  tt: "tiktok-oembed",
} as const;
function direct(item: DiscoverItem): boolean {
  return (
    item.evidence?.source === DIRECT_SOURCE[item.platform] ||
    (item.platform === "tt" && item.evidence?.source === "tiktok-public-page")
  );
}
function timestamp(value: string | undefined, now: number): number | undefined {
  if (!value?.trim()) return undefined;
  const n = Date.parse(value);
  return Number.isFinite(n) && n > 0 && n <= now + CLOCK_SKEW ? n : undefined;
}
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function textOf(item: DiscoverItem): string {
  // Never turn a contaminated search excerpt into apparent source-caption evidence.
  return direct(item) ? discoverSourceCaption(item) : `${item.title}\n${item.snippet}`;
}
function metadata(item: DiscoverItem, genreId?: string) {
  return categoryCreativeEvidence(genreId ?? "", textOf(item));
}

/** A platform-qualified creator identity; unknown creators are isolated by their post URL. */
export function creatorKey(item: DiscoverItem): string {
  return (
    discoverCreatorKey(item.platform, discoverFeedbackCreator(item)) ??
    `post:${discoverPostKey(item.platform, item.url) ?? item.url}`
  );
}

export function discoverEvidence(
  item: DiscoverItem,
  genreId?: string,
  now = Date.now(),
): DiscoverEvidence {
  const isDirect = direct(item);
  const meta = metadata(item, genreId);
  const sourceTier = isDirect
    ? "direct"
    : item.title.trim() || item.snippet.trim()
      ? "indexed"
      : "unknown";
  // A source read with no count means unknown, even if an older indexed excerpt claimed millions.
  const stats = isDirect
    ? item.evidence
    : item.evidence?.source === "indexed-excerpt"
      ? item.evidence
      : item.stats;
  const likes = count(stats?.likes);
  const views = count(stats?.views);
  const metric =
    item.platform === "ig" && likes !== undefined
      ? "likes"
      : views !== undefined
        ? "views"
        : likes !== undefined
          ? "likes"
          : undefined;
  const value = metric === "likes" ? likes : metric === "views" ? views : undefined;
  const observed = timestamp(item.evidence?.observedAt, now);
  const fresh = observed !== undefined && now - observed <= 3 * DAY;
  const strong =
    metric !== undefined &&
    value !== undefined &&
    value >= DISCOVER_ENGAGEMENT_FLOORS.inspiration[item.platform][metric];
  const sourcePublished = isDirect ? timestamp(item.evidence?.published, now) : undefined;
  const reportedPublished = timestamp(item.published, now);
  const published = sourcePublished ?? reportedPublished;
  const ageDays = published === undefined ? undefined : Math.max(0, (now - published) / DAY);
  const recent = ageDays !== undefined && ageDays <= 30;
  const categoryMatch = !genreId || meta.category;
  const craft = meta.namedTechniques.length ? "specific" : meta.creative ? "generic" : "none";
  // Worker flags describe the indexed excerpt's query match. A native caption can independently
  // establish a known category; absent/unknown captions cannot erase a previous negative label.
  const sourceCategoryProof = isDirect && !!CATEGORY_PROFILES[genreId ?? ""] && meta.eligible;
  const offTopic = !!item.offTopic && !sourceCategoryProof;
  const outsideCategory = !!item.outsideCategory && !sourceCategoryProof;
  const unavailable = isDirect && item.evidence?.availability === "unavailable";
  const eligible =
    !unavailable &&
    !!discoverPostKey(item.platform, item.url) &&
    categoryMatch &&
    meta.creative &&
    !offTopic &&
    !outsideCategory;
  const popular =
    eligible &&
    (craft === "specific" || meta.project) &&
    !meta.teaching &&
    isDirect &&
    fresh &&
    recent &&
    metric !== undefined &&
    value !== undefined &&
    value >= DISCOVER_ENGAGEMENT_FLOORS.popular[item.platform][metric];
  const reasons: DiscoverReason[] = [];
  if (unavailable) reasons.push("source-unavailable");
  if (craft === "specific") reasons.push("named-technique");
  if (meta.teaching && meta.creative) reasons.push("teaching");
  if (isDirect && item.evidence?.caption?.trim()) reasons.push("source-caption");
  if (!isDirect) reasons.push("indexed-only");
  if (value === undefined) reasons.push("unknown-engagement");
  else if (strong) reasons.push("strong-engagement");
  else reasons.push("low-engagement");
  if (value !== undefined && !fresh) reasons.push("stale-engagement");
  if (recent) reasons.push("recent-post");
  else if (ageDays !== undefined) reasons.push("old-post");
  else reasons.push("unknown-date");
  if (!categoryMatch || outsideCategory) reasons.push("outside-category");
  if (offTopic || meta.excluded) reasons.push("off-topic");
  if (craft === "none") reasons.push("no-craft");
  // Log of a ratio to the platform's own floor; likes are never converted into fictional views.
  const engagementScore =
    metric && value !== undefined
      ? Math.min(
          18,
          Math.max(
            0,
            Math.log2(1 + value / DISCOVER_ENGAGEMENT_FLOORS.inspiration[item.platform][metric]) *
              6,
          ),
        )
      : 0;
  return {
    techniques: meta.namedTechniques,
    reasons,
    categoryMatch,
    craft,
    project: meta.project,
    teaching: meta.teaching && meta.creative,
    sourceTier,
    engagement: {
      ...(metric ? { metric, value } : {}),
      basis: value === undefined ? "unknown" : isDirect ? "source" : "indexed",
      ...(observed !== undefined ? { observedAt: new Date(observed).toISOString() } : {}),
      fresh,
      strong,
    },
    date: {
      ...(published !== undefined ? { published: new Date(published).toISOString(), ageDays } : {}),
      basis:
        sourcePublished !== undefined
          ? "source"
          : reportedPublished !== undefined
            ? "reported"
            : "unknown",
      recent,
    },
    eligible,
    popular,
    score:
      (craft === "specific" ? 45 : craft === "generic" ? 10 : 0) +
      Math.min(3, meta.namedTechniques.length) * 5 +
      engagementScore +
      (recent ? 10 : 0) +
      (isDirect ? 5 : 0) -
      (ageDays !== undefined
        ? Math.min(12, Math.max(0, Math.log2(Math.max(1, ageDays / 30))) * 3)
        : 0),
  };
}

function sameGenre(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "") === (b ?? "");
}
function feedbackFor(item: DiscoverItem, feedback: readonly DiscoverFeedback[], genreId?: string) {
  const creator = creatorKey(item);
  const hidden = feedback.find(
    (f) => f.action === "hide-creator" && discoverCreatorKey(f.platform, f.creator) === creator,
  );
  return (
    hidden ??
    feedback.find(
      (f) =>
        f.action !== "hide-creator" &&
        f.action !== "clear" &&
        f.platform === item.platform &&
        sameGenre(f.genreId, genreId) &&
        discoverPostKey(f.platform, f.url) === discoverPostKey(item.platform, item.url),
    )
  );
}

/** Strong personal interest may preserve a reference whose authentic caption omits the editing technique.
 * A selected genre on the vote is context, not visual analysis; known off-topic/promotional posts stay out. */
function personalReference(item: DiscoverItem, genreId: string | undefined): boolean {
  const text = textOf(item);
  const meta = metadata(item, genreId);
  const sourceCategoryProof = direct(item) && !!CATEGORY_PROFILES[genreId ?? ""] && meta.eligible;
  if (
    ((item.offTopic || item.outsideCategory) && !sourceCategoryProof) ||
    (direct(item) && item.evidence?.availability === "unavailable") ||
    !discoverPostKey(item.platform, item.url)
  )
    return false;
  const prose = text.replace(/#[\p{L}\p{N}_]+|https?:\/\/\S+/gu, " ");
  if (meta.excluded && /\p{L}/u.test(prose)) return false;
  if (!genreId || meta.category) return true;
  // Unknown category metadata is allowed only through an explicit vote in this genre. A different
  // recognizable subject does not become relevant merely because it was previously miscategorized.
  return !Object.keys(CATEGORY_PROFILES).some(
    (id) => id !== genreId && categoryCreativeEvidence(id, text).category,
  );
}

export function rankDiscoverItems(
  items: DiscoverItem[],
  options: {
    genreId?: string;
    now?: number;
    feedback?: DiscoverFeedback[];
    savedInterests?: DiscoverSavedInterest[];
    mode?: DiscoverFeedMode;
  } = {},
): { items: DiscoverItem[]; evidence: Record<string, DiscoverEvidence>; excluded: number } {
  const now = Number.isFinite(options.now) ? options.now! : Date.now();
  const mode = options.mode ?? "inspiration";
  const feedback = (options.feedback ?? [])
    .filter((f) => timestamp(f.at, now) !== undefined)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const evidence: Record<string, DiscoverEvidence> = {};
  const unique = new Map<string, { item: DiscoverItem; aliases: string[]; index: number }>();
  for (const item of items) {
    const key = discoverPostKey(item.platform, item.url);
    if (!key) {
      evidence[item.url] = discoverEvidence(item, options.genreId, now);
      continue;
    }
    const previous = unique.get(key);
    const row = {
      item,
      aliases: [...(previous?.aliases ?? []), item.url, key],
      index: previous?.index ?? unique.size,
    };
    // A later indexed duplicate must not overwrite direct source counts or authentic caption data.
    const replace =
      !previous ||
      (direct(item) && !direct(previous.item)) ||
      (direct(item) === direct(previous.item) &&
        (timestamp(item.evidence?.observedAt, now) ?? 0) >
          (timestamp(previous.item.evidence?.observedAt, now) ?? 0));
    unique.set(key, replace ? row : { ...previous!, aliases: row.aliases });
  }
  const selected: { item: DiscoverItem; proof: DiscoverEvidence; index: number }[] = [];
  const saved = new Map<string, DiscoverSavedInterest>();
  for (const interest of options.savedInterests ?? []) {
    const key = discoverPostKey(interest.platform, interest.url);
    if (key && timestamp(interest.savedAt, now) !== undefined && !saved.has(key))
      saved.set(key, interest);
  }
  // Learn related interests only from saved posts present in this candidate pool with matching
  // craft/category metadata. Saved labels or creator strings alone cannot establish those facts.
  const savedExamples = [...saved.keys()].flatMap((key) => {
    const row = unique.get(key);
    if (!row) return [];
    const proof = discoverEvidence(row.item, options.genreId, now);
    const vote = feedbackFor(row.item, feedback, options.genreId);
    return proof.eligible &&
      proof.craft === "specific" &&
      vote?.action !== "less" &&
      vote?.action !== "hide-creator"
      ? [{ key, creator: creatorKey(row.item), techniques: proof.techniques }]
      : [];
  });
  for (const [key, row] of unique) {
    const proof = discoverEvidence(row.item, options.genreId, now);
    const vote = feedbackFor(row.item, feedback, options.genreId);
    const personal = vote?.action === "more" && personalReference(row.item, options.genreId);
    const dismissed = vote?.action === "less" || vote?.action === "hide-creator";
    if (personal) {
      proof.reasons.push("personal-interest");
      proof.score += 30;
    }
    if (dismissed) proof.reasons.push("personal-dismissed");
    const savedExact = saved.get(key);
    const savedRelated = savedExamples.some(
      (example) =>
        example.key !== key &&
        (example.creator === creatorKey(row.item) ||
          example.techniques.some((technique) => proof.techniques.includes(technique))),
    );
    if (!dismissed && (savedExact || savedRelated)) {
      if (!proof.reasons.includes("personal-interest")) proof.reasons.push("personal-interest");
      proof.score += savedExact
        ? ({ saved: 6, trying: 9, tried: 12 } as const)[savedExact.stage]
        : 3;
    }
    const related = feedback.filter(
      (f) =>
        sameGenre(f.genreId, options.genreId) &&
        (f.action === "more" || f.action === "less") &&
        discoverPostKey(f.platform, f.url) !== key &&
        (discoverCreatorKey(f.platform, f.creator) === creatorKey(row.item) ||
          f.techniques.some((t) => proof.techniques.includes(t))),
    );
    // Repeated likes cannot swamp relevance or let a low-signal post qualify for Inspiration.
    proof.score += Math.max(
      -12,
      Math.min(
        12,
        related.reduce((sum, f) => sum + (f.action === "more" ? 3 : -3), 0),
      ),
    );
    for (const alias of row.aliases) evidence[alias] = proof;
    const inspiration =
      proof.eligible &&
      (proof.craft === "specific" || proof.project) &&
      proof.engagement.strong &&
      // Public source counts prevent inflated Instagram/TikTok excerpts flashing into the main feed.
      // Legacy YouTube API statistics remain explicitly reported until provenance reaches the Worker.
      (row.item.platform === "yt" || proof.engagement.basis === "source");
    const allowed =
      !dismissed &&
      (mode === "popular"
        ? proof.popular
        : mode === "learning"
          ? proof.eligible && proof.teaching
          : mode === "explore"
            ? proof.eligible || personal
            : !proof.teaching && (inspiration || personal));
    if (allowed)
      selected.push({
        item: { ...row.item, url: key, section: proof.teaching ? "tutorial" : "example" },
        proof,
        index: row.index,
      });
  }
  selected.sort((a, b) => b.proof.score - a.proof.score || a.index - b.index);
  // Creator rounds give independent voices a place before one account fills the grid. Within each
  // round, gently favor an unseen named technique; never pad a sparse pool with unrelated posts.
  const result: DiscoverItem[] = [];
  const used = new Set<DiscoverItem>();
  const creators = new Map<string, number>();
  const techniques = new Map<string, number>();
  for (let round = 0; result.length < selected.length; round++) {
    const candidates = selected.filter(
      (row) => !used.has(row.item) && (creators.get(creatorKey(row.item)) ?? 0) === round,
    );
    if (!candidates.length) break;
    while (candidates.length) {
      candidates.sort(
        (a, b) =>
          b.proof.score -
            b.proof.techniques.reduce((n, t) => n + Math.min(2, techniques.get(t) ?? 0) * 4, 0) -
            (a.proof.score -
              a.proof.techniques.reduce(
                (n, t) => n + Math.min(2, techniques.get(t) ?? 0) * 4,
                0,
              )) || a.index - b.index,
      );
      const row = candidates.shift()!;
      const creator = creatorKey(row.item);
      if ((creators.get(creator) ?? 0) !== round) continue;
      result.push(row.item);
      used.add(row.item);
      creators.set(creator, round + 1);
      for (const technique of row.proof.techniques)
        techniques.set(technique, (techniques.get(technique) ?? 0) + 1);
    }
  }
  return { items: result, evidence, excluded: items.length - result.length };
}
