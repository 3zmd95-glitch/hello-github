import { z } from "zod";
import type { DiscoverItem, DiscoverPlatform } from "./discover";
import type { Inspiration, InspirationStage } from "./inspiration";
import { canonicalRefUrl } from "./research";
import {
  discoverCreativeEvidence as categoryCreativeEvidence,
  discoverSourceCaption,
} from "./discoverMetadata";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";

export const DISCOVER_CANDIDATE_MAX = 3000;
export const DISCOVER_CATEGORY_MAX = 100;
/** Independent IndexedDB corpus: six million UTF-16 characters, roughly 12 MiB of text. */
export const DISCOVER_CANDIDATE_MAX_CHARS = 6 * 1024 * 1024;
const LOCAL_CANDIDATE_MAX = 500;
const LOCAL_CANDIDATE_MAX_CHARS = 600_000;
export const DISCOVER_FEEDBACK_MAX = 500;
const GENRE = z.string().trim().min(1).max(100);
const PLATFORM = z.enum(["ig", "tt", "yt"]);
const COUNT = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const DATE = z.string().datetime({ offset: true });

function safeHttps(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

function platformHost(platform: DiscoverPlatform, host: string): boolean {
  const plain = host.toLowerCase().replace(/^(?:www|m)\./, "");
  return platform === "ig"
    ? plain === "instagram.com"
    : platform === "tt"
      ? plain === "tiktok.com"
      : plain === "youtube.com" || plain === "youtu.be";
}

/** Validate the original host before canonicalRefUrl; that helper alone is not a URL trust boundary. */
export function discoverPostKey(platform: DiscoverPlatform, value: string): string | null {
  if (!safeHttps(value)) return null;
  const u = new URL(value);
  if (!platformHost(platform, u.hostname)) return null;
  const valid =
    platform === "ig"
      ? /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/(?!audio\/)[\w-]+\/?$/.test(u.pathname)
      : platform === "tt"
        ? /^\/@[\w.-]+\/video\/\d+\/?$/.test(u.pathname)
        : u.hostname.toLowerCase().replace(/^(?:www|m)\./, "") === "youtu.be"
          ? /^\/[\w-]+\/?$/.test(u.pathname)
          : (u.pathname === "/watch" && /^[\w-]+$/.test(u.searchParams.get("v") ?? "")) ||
            /^\/(?:shorts|live|embed)\/[\w-]+\/?$/.test(u.pathname);
  if (!valid) return null;
  if (platform === "yt") {
    const id =
      u.hostname.replace(/^(?:www|m)\./, "") === "youtu.be"
        ? u.pathname.split("/")[1]
        : u.pathname === "/watch"
          ? u.searchParams.get("v")
          : u.pathname.split("/")[2];
    return `https://www.youtube.com/watch?v=${id}`;
  }
  return canonicalRefUrl(platform, value);
}

/** Platform-scoped identity; unknown or generic labels must never hide unrelated creators together. */
export function discoverCreatorKey(platform: DiscoverPlatform, creator: string): string | null {
  let name = creator.trim().normalize("NFKC");
  if (/^https?:\/\//i.test(name)) {
    if (!safeHttps(name)) return null;
    const u = new URL(name);
    if (!platformHost(platform, u.hostname)) return null;
    if (platform === "yt" && /^\/channel\/[\w-]+\/?$/.test(u.pathname))
      return `yt:channel:${u.pathname.split("/")[2]}`;
    const profile =
      platform === "ig"
        ? u.pathname.match(/^\/([\w.]+)\/?$/)?.[1]
        : platform === "tt"
          ? u.pathname.match(/^\/@([\w.-]+)\/?$/)?.[1]
          : u.pathname.match(/^\/(?:@|c\/|user\/)([\w.-]+)\/?$/)?.[1];
    if (
      !profile ||
      (platform === "ig" && /^(?:p|reel|reels|tv|explore|accounts|stories|direct)$/.test(profile))
    )
      return null;
    name = profile;
  }
  name = name.replace(/^@+/, "").trim().toLowerCase().replace(/\s+/g, " ");
  if (
    !name ||
    name.length > 200 ||
    /[<>/\\:?#]/.test(name) ||
    /^(?:unknown|unknown creator|creator|instagram|tiktok|youtube|youtube\.com|tiktok\.com|instagram\.com|www\.(?:youtube|instagram|tiktok)\.com|غير معروف|مجهول)$/.test(
      name,
    )
  )
    return null;
  return `${platform}:${name}`;
}

/** The same creator value for feedback, hide state, and ranking. Channel URLs disambiguate YouTube names. */
export function discoverFeedbackCreator(
  item: Pick<DiscoverItem, "platform" | "handle" | "profile" | "evidence">,
): string {
  const source = (
    { ig: "instagram-public-embed", tt: "tiktok-oembed", yt: "youtube-api" } as const
  )[item.platform];
  const author =
    item.evidence?.source === source ||
    (item.platform === "tt" && item.evidence?.source === "tiktok-public-page")
      ? item.evidence.author
      : undefined;
  const candidates =
    item.platform === "yt"
      ? [item.profile, author, item.handle]
      : [author, item.profile, item.handle];
  return candidates.find((value) => value && discoverCreatorKey(item.platform, value)) ?? "";
}

const EvidenceSchema = z.object({
  source: z.enum([
    "youtube-api",
    "instagram-public-embed",
    "tiktok-oembed",
    "tiktok-public-page",
    "indexed-excerpt",
  ]),
  observedAt: DATE,
  likes: COUNT.optional(),
  views: COUNT.optional(),
  published: z.string().max(80).optional(),
  caption: z.string().max(4000).optional(),
  author: z.string().max(200).optional(),
  availability: z.enum(["available", "unavailable"]).optional(),
});

/** Explicit whitelist: no provider credentials, unknown payloads, or generated popularity claims persist. */
const CandidateItemSchema = z
  .object({
    platform: PLATFORM,
    handle: z.string().max(300),
    title: z.string().max(1000),
    snippet: z.string().max(6000),
    url: z.string().max(2048),
    thumb: z.string().max(4096).refine(safeHttps).optional().catch(undefined),
    stats: z
      .object({ views: COUNT.optional(), likes: COUNT.optional(), comments: COUNT.optional() })
      .optional(),
    published: z.string().max(80).optional(),
    lang: z.enum(["ar", "en"]),
    section: z.enum(["example", "tutorial"]),
    offTopic: z.literal(true).optional(),
    outsideCategory: z.literal(true).optional(),
    profile: z.string().max(2048).refine(safeHttps).optional().catch(undefined),
    evidence: EvidenceSchema.optional(),
  })
  .refine((item) => discoverPostKey(item.platform, item.url) !== null)
  .refine((item) => {
    const source = item.evidence?.source;
    return (
      !source ||
      source === "indexed-excerpt" ||
      (item.platform === "tt" && source === "tiktok-public-page") ||
      source ===
        ({ ig: "instagram-public-embed", tt: "tiktok-oembed", yt: "youtube-api" } as const)[
          item.platform
        ]
    );
  })
  .transform((item): DiscoverItem => {
    const profile =
      item.profile && discoverCreatorKey(item.platform, item.profile)
        ? new URL(item.profile)
        : undefined;
    return {
      ...item,
      url: discoverPostKey(item.platform, item.url)!,
      ...(profile
        ? { profile: `${profile.origin}${profile.pathname.replace(/\/+$/, "")}` }
        : { profile: undefined }),
    };
  });

export interface DiscoverCandidate {
  genreId: string;
  item: DiscoverItem;
  /** When this post first entered this category, never its publication or metric observation time. */
  obtainedAt: string;
  /** A deliberately imported reference in this category, never source evidence or ranking admission. */
  origin?: "manual";
}

export const DiscoverCandidateSchema = z.object({
  genreId: GENRE,
  item: CandidateItemSchema,
  obtainedAt: DATE,
  origin: z.literal("manual").optional(),
});

function candidateKey(entry: DiscoverCandidate): string {
  return `${entry.genreId}\n${entry.item.platform}\n${entry.item.url}`;
}

function evidenceTime(item: DiscoverItem): number {
  return item.evidence ? Date.parse(item.evidence.observedAt) : 0;
}

function direct(item: DiscoverItem): boolean {
  return !!item.evidence && item.evidence.source !== "indexed-excerpt";
}

/** A stale cache/index reply must not overwrite a directly observed source, its caption, or its numbers. */
function betterCandidate(old: DiscoverCandidate, next: DiscoverCandidate): DiscoverCandidate {
  const content = betterCandidateContent(old, next);
  return (old.origin === "manual" || next.origin === "manual") && content.origin !== "manual"
    ? { ...content, origin: "manual" }
    : content;
}

function betterCandidateContent(
  old: DiscoverCandidate,
  next: DiscoverCandidate,
): DiscoverCandidate {
  if (direct(old.item) && !direct(next.item)) return old;
  const replacement = () => ({
    ...next,
    obtainedAt:
      Date.parse(old.obtainedAt) <= Date.parse(next.obtainedAt) ? old.obtainedAt : next.obtainedAt,
  });
  if (direct(next.item) && !direct(old.item)) return replacement();
  if (evidenceTime(old.item) > evidenceTime(next.item)) return old;
  if (evidenceTime(next.item) > evidenceTime(old.item)) return replacement();
  if (Date.parse(old.obtainedAt) > Date.parse(next.obtainedAt)) return old;
  return JSON.stringify(old.item) === JSON.stringify(next.item) ? old : replacement();
}

/** Cache retention only: admission and displayed popularity still belong to discoverRanking.
 * Keep useful lessons and established creative references before recently fetched weak hits.
 * A public caption replaces indexed text; a five-like source cannot inherit indexed millions. */
function retentionQuality(entry: DiscoverCandidate): { tier: number; lane: string } {
  const item = entry.item;
  const isDirect = direct(item);
  const meta = categoryCreativeEvidence(
    entry.genreId,
    isDirect ? discoverSourceCaption(item) : `${item.title}\n${item.snippet}`,
  );
  const lane = `${item.platform}:${meta.teaching ? "lesson" : "example"}`;
  if (item.evidence?.availability === "unavailable") return { tier: 0, lane };
  if (entry.origin === "manual") return { tier: 7, lane };
  const sourceCategoryProof = isDirect && !!CATEGORY_PROFILES[entry.genreId] && meta.eligible;
  if (!sourceCategoryProof && (item.offTopic || item.outsideCategory))
    return { tier: 0, lane };
  if (!meta.category || meta.excluded) return { tier: 1, lane };
  if (!meta.creative) return { tier: 2, lane };
  if (meta.teaching) return { tier: 6, lane };
  const stats =
    isDirect || item.evidence?.source === "indexed-excerpt" ? item.evidence : item.stats;
  const likes = stats?.likes;
  const views = stats?.views;
  const metric =
    item.platform === "ig" && likes !== undefined
      ? "likes"
      : views !== undefined
        ? "views"
        : likes !== undefined
          ? "likes"
          : undefined;
  const value = metric === "likes" ? likes : metric === "views" ? views : undefined;
  const meaningful =
    metric !== undefined &&
    value !== undefined &&
    value >=
      (metric === "likes"
        ? item.platform === "yt"
          ? 100
          : 500
        : item.platform === "yt"
          ? 5000
          : 10000);
  if ((meta.namedTechniques.length > 0 || meta.project) && meaningful)
    return { tier: isDirect || item.platform === "yt" ? 6 : 5, lane };
  return { tier: value === undefined || meaningful ? 4 : 3, lane };
}

/** Alternate lessons/examples and platforms at the same quality, without reserving slots for weak posts. */
function retentionOrder(entries: readonly DiscoverCandidate[]): DiscoverCandidate[] {
  const tiers = new Map<number, Map<string, DiscoverCandidate[]>>();
  for (const entry of [...entries].sort(
    (a, b) =>
      Date.parse(b.obtainedAt) - Date.parse(a.obtainedAt) ||
      candidateKey(a).localeCompare(candidateKey(b)),
  )) {
    const { tier, lane } = retentionQuality(entry);
    const lanes = tiers.get(tier) ?? new Map<string, DiscoverCandidate[]>();
    const group = lanes.get(lane) ?? [];
    group.push(entry);
    lanes.set(lane, group);
    tiers.set(tier, lanes);
  }
  const result: DiscoverCandidate[] = [];
  for (const [, lanes] of [...tiers].sort(([a], [b]) => b - a)) {
    const groups = [...lanes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => group);
    const rounds = Math.max(...groups.map((group) => group.length));
    for (let round = 0; round < rounds; round++)
      for (const group of groups) if (group[round]) result.push(group[round]);
  }
  return result;
}

const candidateSizes = new WeakMap<DiscoverCandidate, number>();
function candidateSize(entry: DiscoverCandidate): number {
  const previous = candidateSizes.get(entry);
  if (previous !== undefined) return previous;
  const size = JSON.stringify(entry).length + 1;
  candidateSizes.set(entry, size);
  return size;
}

function boundedCandidates(
  entries: readonly DiscoverCandidate[],
  max = DISCOVER_CANDIDATE_MAX,
  maxChars = DISCOVER_CANDIDATE_MAX_CHARS,
): DiscoverCandidate[] {
  const unique = new Map<string, DiscoverCandidate>();
  for (const entry of entries) {
    const key = candidateKey(entry);
    const old = unique.get(key);
    unique.set(key, old ? betterCandidate(old, entry) : entry);
  }
  const perGenre = new Map<string, number>();
  const result: DiscoverCandidate[] = [];
  const kept = new Set<string>();
  let chars = 2;
  const append = (entry: DiscoverCandidate) => {
    const key = candidateKey(entry);
    const count = perGenre.get(entry.genreId) ?? 0;
    const size = candidateSize(entry);
    if (
      kept.has(key) ||
      result.length >= max ||
      count >= DISCOVER_CATEGORY_MAX ||
      chars + size > maxChars
    )
      return;
    result.push(entry);
    kept.add(key);
    chars += size;
    perGenre.set(entry.genreId, count + 1);
  };
  const genres = new Map<string, DiscoverCandidate[]>();
  for (const entry of unique.values()) {
    const group = genres.get(entry.genreId) ?? [];
    group.push(entry);
    genres.set(entry.genreId, group);
  }
  const chronological = (a: DiscoverCandidate, b: DiscoverCandidate) =>
    Date.parse(b.obtainedAt) - Date.parse(a.obtainedAt) ||
    candidateKey(a).localeCompare(candidateKey(b));
  // Normal accumulation validates only new records. Unchanged large payloads reuse their measured size;
  // expensive quality analysis is needed only at a real safety cap, not every source result or progress save.
  if (
    unique.size <= max &&
    [...genres.values()].every((group) => group.length <= DISCOVER_CATEGORY_MAX) &&
    2 + [...unique.values()].reduce((sum, entry) => sum + candidateSize(entry), 0) <= maxChars
  )
    return [...unique.values()].sort(chronological);
  const groups = [...genres.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => retentionOrder(group));
  // All rounds are fair, including when long captions hit the byte cap before the item cap.
  // Keeping the full source payload avoids changing evidence merely to fit more records.
  for (let round = 0; round < DISCOVER_CATEGORY_MAX; round++)
    for (const group of groups) if (group[round]) append(group[round]);
  return result.sort(chronological);
}

/** Merge already validated snapshots without repeatedly parsing the whole durable corpus. */
export function mergeDiscoverCandidates(
  current: readonly DiscoverCandidate[],
  incoming: readonly DiscoverCandidate[],
): DiscoverCandidate[] {
  const next = boundedCandidates([...current, ...incoming]);
  return current.length === next.length && current.every((entry, index) => entry === next[index])
    ? (current as DiscoverCandidate[])
    : next;
}
const localFallbacks = new WeakMap<readonly DiscoverCandidate[], DiscoverCandidate[]>();
/** Progress remains safe in localStorage when IndexedDB is blocked or a write fails. */
export function localDiscoverCandidateFallback(
  entries: readonly DiscoverCandidate[],
): DiscoverCandidate[] {
  const previous = localFallbacks.get(entries);
  if (previous) return previous;
  const next = boundedCandidates(entries, LOCAL_CANDIDATE_MAX, LOCAL_CANDIDATE_MAX_CHARS);
  localFallbacks.set(entries, next);
  return next;
}

export const DiscoverCandidatesSchema = z
  .array(z.unknown())
  .default([])
  .transform((entries) =>
    boundedCandidates(
      entries.flatMap((entry) => {
        const parsed = DiscoverCandidateSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  );

/** Accumulate only deliberately retrieved category candidates. This function performs no provider requests. */
export function accumulateCategoryCandidates(
  current: readonly DiscoverCandidate[],
  incoming: readonly DiscoverItem[],
  {
    genreId,
    manuallyAdded,
    now = new Date(),
  }: { genreId: string; manuallyAdded?: true; now?: Date },
): DiscoverCandidate[] {
  if (!GENRE.safeParse(genreId).success || !Number.isFinite(now.getTime())) return [...current];
  const obtainedAt = now.toISOString();
  return mergeDiscoverCandidates(
    current,
    incoming.flatMap((item) => {
      const parsed = DiscoverCandidateSchema.safeParse({
        genreId,
        item,
        obtainedAt,
        ...(manuallyAdded ? { origin: "manual" } : {}),
      });
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

export function categoryCandidates(
  entries: readonly DiscoverCandidate[],
  genreId: string,
): DiscoverItem[] {
  return entries.filter((entry) => entry.genreId === genreId).map((entry) => entry.item);
}

export interface DiscoverSavedInterest {
  url: string;
  platform: DiscoverPlatform;
  creator: string;
  stage: InspirationStage;
  savedAt: string;
}

/** Weak, ephemeral interest from an existing deliberate save/practice action, never an engagement claim.
 * Removing a save removes this signal immediately. Notes and follows do not invent technique tags. */
export function savedDiscoverInterests(entries: readonly Inspiration[]): DiscoverSavedInterest[] {
  const latest = new Map<string, DiscoverSavedInterest>();
  for (const entry of entries) {
    const platform = PLATFORM.safeParse(entry.ref.platform);
    if (!platform.success || !DATE.safeParse(entry.savedAt).success) continue;
    const url = discoverPostKey(platform.data, entry.ref.url);
    if (!url) continue;
    const previous = latest.get(url);
    if (previous && Date.parse(previous.savedAt) > Date.parse(entry.savedAt)) continue;
    latest.set(url, {
      url,
      platform: platform.data,
      creator: discoverCreatorKey(platform.data, entry.ref.handle) ? entry.ref.handle : "",
      stage: entry.stage,
      savedAt: entry.savedAt,
    });
  }
  return [...latest.values()]
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
    .slice(0, DISCOVER_FEEDBACK_MAX);
}

export const DiscoverFeedbackActionSchema = z.enum(["more", "less", "hide-creator", "clear"]);
export const DiscoverFeedbackSchema = z
  .object({
    url: z.string().max(2048),
    platform: PLATFORM,
    creator: z.string().max(2048),
    genreId: GENRE.optional(),
    techniques: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
    action: DiscoverFeedbackActionSchema,
    at: DATE,
  })
  .refine((entry) => discoverPostKey(entry.platform, entry.url) !== null)
  .refine(
    (entry) =>
      entry.action !== "hide-creator" || discoverCreatorKey(entry.platform, entry.creator) !== null,
  )
  .transform((entry) => ({
    ...entry,
    url: discoverPostKey(entry.platform, entry.url)!,
    techniques: [...new Set(entry.techniques.map((word) => word.normalize("NFKC").toLowerCase()))],
  }));

export type DiscoverFeedback = z.infer<typeof DiscoverFeedbackSchema>;
export type DiscoverFeedbackInput = Omit<DiscoverFeedback, "at" | "techniques"> & {
  techniques?: string[];
};

function postFeedbackKey(entry: Pick<DiscoverFeedback, "platform" | "url" | "genreId">): string {
  return `post:${entry.genreId ?? ""}:${entry.platform}:${discoverPostKey(entry.platform, entry.url) ?? entry.url}`;
}

function feedbackKey(entry: DiscoverFeedback): string {
  return entry.action === "hide-creator"
    ? `creator:${discoverCreatorKey(entry.platform, entry.creator)}`
    : postFeedbackKey(entry);
}

function boundedFeedback(entries: readonly DiscoverFeedback[]): DiscoverFeedback[] {
  const latest = new Map<string, DiscoverFeedback>();
  for (const entry of [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (entry.action === "clear") {
      latest.delete(postFeedbackKey(entry));
      const creator = discoverCreatorKey(entry.platform, entry.creator);
      if (creator) latest.delete(`creator:${creator}`);
    } else latest.set(feedbackKey(entry), entry);
  }
  return [...latest.values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, DISCOVER_FEEDBACK_MAX);
}

export const DiscoverFeedbackListSchema = z
  .array(z.unknown())
  .default([])
  .transform((entries) =>
    boundedFeedback(
      entries.flatMap((entry) => {
        const parsed = DiscoverFeedbackSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  );

export interface DiscoverFeedbackUndo {
  /** Only related keys are restored; unrelated actions after this token was created are left alone. */
  keys: string[];
  before: DiscoverFeedback[];
  after: DiscoverFeedback[];
}

export function changeDiscoverFeedback(
  current: readonly DiscoverFeedback[],
  input: DiscoverFeedbackInput,
  now = new Date(),
): { feedback: DiscoverFeedback[]; undo?: DiscoverFeedbackUndo } {
  if (!Number.isFinite(now.getTime())) return { feedback: [...current] };
  const parsed = DiscoverFeedbackSchema.safeParse({ ...input, at: now.toISOString() });
  if (!parsed.success) return { feedback: [...current] };
  const entry = parsed.data;
  const creator = discoverCreatorKey(entry.platform, entry.creator);
  const keys =
    entry.action === "clear"
      ? [postFeedbackKey(entry), ...(creator ? [`creator:${creator}`] : [])]
      : [feedbackKey(entry)];
  const before = current.filter((old) => keys.includes(feedbackKey(old)));
  if (before.some((old) => Date.parse(old.at) > now.getTime())) return { feedback: [...current] };
  const untouched = current.filter((old) => !keys.includes(feedbackKey(old)));
  const feedback = boundedFeedback([...untouched, ...(entry.action === "clear" ? [] : [entry])]);
  const after = feedback.filter((old) => keys.includes(feedbackKey(old)));
  return { feedback, undo: { keys, before: [...before], after } };
}

function feedbackSnapshot(entries: readonly DiscoverFeedback[]): string {
  return JSON.stringify([...entries].sort((a, b) => feedbackKey(a).localeCompare(feedbackKey(b))));
}

/** An obsolete Undo must not overwrite a newer preference for the same post or creator. */
export function restoreDiscoverFeedback(
  current: readonly DiscoverFeedback[],
  undo: DiscoverFeedbackUndo,
): DiscoverFeedback[] {
  const affected = current.filter((entry) => undo.keys.includes(feedbackKey(entry)));
  if (feedbackSnapshot(affected) !== feedbackSnapshot(undo.after)) return [...current];
  return boundedFeedback([
    ...current.filter((entry) => !undo.keys.includes(feedbackKey(entry))),
    ...undo.before,
  ]);
}

/** Creator hides apply across genres; a taste vote applies only to the exact post and category. */
export function discoverFeedbackForItem(
  feedback: readonly DiscoverFeedback[],
  item: Pick<DiscoverItem, "platform" | "url" | "handle" | "profile" | "evidence">,
  genreId?: string,
): DiscoverFeedback | undefined {
  const creator = discoverCreatorKey(item.platform, discoverFeedbackCreator(item));
  const hidden =
    creator &&
    feedback.find(
      (entry) =>
        entry.action === "hide-creator" &&
        discoverCreatorKey(entry.platform, entry.creator) === creator,
    );
  return (
    hidden ||
    feedback.find(
      (entry) =>
        entry.action !== "hide-creator" &&
        entry.action !== "clear" &&
        postFeedbackKey(entry) === postFeedbackKey({ ...item, genreId }),
    )
  );
}
