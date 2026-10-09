import type { DiscoverItem } from "./discover";
import {
  discoverCreatorKey,
  discoverFeedbackCreator,
  discoverFeedbackForItem,
  type DiscoverFeedback,
} from "./discoverFeed";
import {
  canonicalDiscoverVisualUrl,
  DiscoverVisualRequestSchema,
  DiscoverVisualResponseSchema,
  type DiscoverVisualRequest,
  type DiscoverVisualResponse,
} from "./discoverVisual";
import { isLocalAiHost } from "./localAi";
import { discoverCreativeEvidence, discoverSourceCaption } from "./discoverMetadata";

export const CATEGORY_VISUAL_ATTEMPTS = 4;
export const CATEGORY_VISUAL_ASSESSMENTS = 2;
export type CategoryVisualResult =
  { ok: true; data: DiscoverVisualResponse } | { ok: false; error: string };

/** Source failures concern this post. Unknown/connection/model failures stop the whole explicit action. */
export function categoryVisualCanContinue(error: string): boolean {
  return /^(?:source_unavailable|source_low_engagement|source_engagement_unknown|source_frames_(?:source_unavailable|too_large|too_long|download_failed|decode_failed))$/.test(
    error,
  );
}

/** These are leads for a source check, never claims about the pixels or popularity. */
export function categoryVisualCandidates(
  items: readonly DiscoverItem[],
  genreId: string,
  feedback: readonly DiscoverFeedback[] = [],
  limit = CATEGORY_VISUAL_ATTEMPTS,
): DiscoverItem[] {
  const unique = new Map<string, DiscoverItem>();
  for (const item of items) {
    if (item.platform !== "ig") continue;
    const key = canonicalDiscoverVisualUrl(item.url);
    if (!key) continue;
    const previous = unique.get(key);
    const direct = item.evidence?.source === "instagram-public-embed";
    const priorDirect = previous?.evidence?.source === "instagram-public-embed";
    if (
      !previous ||
      (direct && !priorDirect) ||
      (direct === priorDirect &&
        Date.parse(item.evidence?.observedAt ?? "") >
          Date.parse(previous.evidence?.observedAt ?? ""))
    )
      unique.set(key, item);
  }
  const qualified: {
    item: DiscoverItem;
    direct: boolean;
    unresolved: boolean;
    strength: number;
  }[] = [];
  for (const item of unique.values()) {
    if (item.evidence?.availability === "unavailable") continue;
    const vote = discoverFeedbackForItem(feedback, item, genreId);
    if (vote?.action === "less" || vote?.action === "hide-creator") continue;
    const direct = item.evidence?.source === "instagram-public-embed";
    const metadata = direct
      ? discoverCreativeEvidence(genreId, discoverSourceCaption(item))
      : undefined;
    if (metadata?.exclusions.some((reason) => reason !== "empty-prose")) continue;
    const counts = direct ? item.evidence : item.stats;
    const likes = counts?.likes;
    const views = counts?.views;
    const valid = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const strength = valid(likes) ? likes / 500 : valid(views) ? views / 10000 : 0;
    if (strength < 1) continue;
    qualified.push({
      item,
      direct,
      unresolved:
        !!metadata &&
        (!metadata.category || (!metadata.namedTechniques.length && !metadata.project)),
      strength,
    });
  }
  const sorted = qualified.sort(
    (a, b) =>
      Number(b.direct) - Number(a.direct) ||
      Number(b.unresolved) - Number(a.unresolved) ||
      b.strength - a.strength ||
      a.item.url.localeCompare(b.item.url),
  );
  const selected: DiscoverItem[] = [];
  const seen = new Set<string>();
  const repeats: DiscoverItem[] = [];
  for (const { item } of sorted) {
    const creator = discoverCreatorKey(item.platform, discoverFeedbackCreator(item));
    if (creator && seen.has(creator)) repeats.push(item);
    else {
      selected.push(item);
      if (creator) seen.add(creator);
    }
  }
  return [...selected, ...repeats].slice(0, Math.max(0, Math.min(100, limit)));
}

export async function assessCategoryVisual(
  input: DiscoverVisualRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CategoryVisualResult> {
  if (!isLocalAiHost()) return { ok: false, error: "local_ai_unavailable" };
  const parsed = DiscoverVisualRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_request" };
  const request = parsed.data;
  try {
    const response = await fetchImpl("/api/local-ai/assess-category", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Local-AI": "1" },
      body: JSON.stringify(request),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(190000)])
        : AbortSignal.timeout(190000),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      return { ok: false, error: "local_ai_unavailable" };
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = raw && typeof raw === "object" && "error" in raw ? raw.error : undefined;
      return { ok: false, error: typeof error === "string" ? error : "assessment_failed" };
    }
    const result = DiscoverVisualResponseSchema.safeParse(raw);
    if (!result.success) return { ok: false, error: "invalid_response" };
    const data = result.data;
    const record = data.status === "assessed" ? data.visual : data.observation;
    const expectedUrl = canonicalDiscoverVisualUrl(request.url);
    if (
      data.selection.provider !== request.provider ||
      data.selection.model !== request.model ||
      data.selection.effort !== request.effort ||
      data.selection.accountId !== request.accountId ||
      (data.source && canonicalDiscoverVisualUrl(data.source.url) !== expectedUrl) ||
      (record && (record.url !== expectedUrl || record.genreId !== request.genreId)) ||
      (request.allowModel === false && data.modelCalls !== 0)
    )
      return { ok: false, error: "invalid_response" };
    return { ok: true, data };
  } catch {
    return { ok: false, error: signal?.aborted ? "cancelled" : "assessment_failed" };
  }
}
