import type { DiscoverItem } from "./discover";
import {
  discoverCreatorKey,
  discoverFeedbackCreator,
  discoverFeedbackForItem,
  type DiscoverFeedback,
} from "./discoverFeed";
import { discoverCreativeEvidence, discoverSourceCaption } from "./discoverMetadata";
import {
  canonicalDiscoverSemanticUrl,
  DiscoverSemanticRequestSchema,
  DiscoverSemanticResponseSchema,
  type DiscoverSemanticRequest,
  type DiscoverSemanticResponse,
} from "./discoverSemantic";
import { isLocalAiHost } from "./localAi";

export const CATEGORY_SEMANTIC_BATCH = 3;
export type CategorySemanticResult =
  { ok: true; data: DiscoverSemanticResponse } | { ok: false; error: string };

const direct = (item: DiscoverItem) =>
  (item.platform === "ig" && item.evidence?.source === "instagram-public-embed") ||
  (item.platform === "tt" &&
    (item.evidence?.source === "tiktok-public-page" || item.evidence?.source === "tiktok-oembed"));

/** Only unresolved, source-captioned posts with observed engagement can spend a caption check. */
export function categorySemanticCandidates(
  items: readonly DiscoverItem[],
  genreId: string,
  feedback: readonly DiscoverFeedback[] = [],
  platform = "all",
  limit = CATEGORY_SEMANTIC_BATCH,
  now = Date.now(),
): DiscoverItem[] {
  const unique = new Map<string, DiscoverItem>();
  for (const item of items) {
    if (!direct(item) || (platform !== "all" && item.platform !== platform)) continue;
    const key = canonicalDiscoverSemanticUrl(item.url);
    if (!key) continue;
    const prior = unique.get(key);
    if (!prior || Date.parse(item.evidence!.observedAt) >= Date.parse(prior.evidence!.observedAt))
      unique.set(key, item);
  }
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const qualified = [...unique.values()].flatMap((item) => {
    const source = item.evidence!;
    const observed = Date.parse(source.observedAt);
    if (
      source.availability === "unavailable" ||
      !Number.isFinite(observed) ||
      observed > now + 300_000 ||
      now - observed > 3 * 86_400_000 ||
      !discoverSourceCaption(item).trim()
    )
      return [];
    const vote = discoverFeedbackForItem(feedback, item, genreId);
    if (vote?.action === "less" || vote?.action === "hide-creator") return [];
    const metadata = discoverCreativeEvidence(genreId, discoverSourceCaption(item));
    if (
      metadata.exclusions.some((reason) => reason !== "empty-prose") ||
      (metadata.category && (metadata.project || metadata.namedTechniques.length > 0))
    )
      return [];
    const strength = valid(source.likes)
      ? source.likes / 500
      : valid(source.views)
        ? source.views / 10000
        : 0;
    return strength >= 1 ? [{ item, strength }] : [];
  });
  qualified.sort((a, b) => b.strength - a.strength || a.item.url.localeCompare(b.item.url));
  const selected: DiscoverItem[] = [];
  const repeated: DiscoverItem[] = [];
  const creators = new Set<string>();
  for (const { item } of qualified) {
    const creator = discoverCreatorKey(item.platform, discoverFeedbackCreator(item));
    if (creator && creators.has(creator)) repeated.push(item);
    else {
      selected.push(item);
      if (creator) creators.add(creator);
    }
  }
  return [...selected, ...repeated].slice(0, Math.max(0, Math.min(100, limit)));
}

/** One explicit batch: no retries, fallback models, or sequential per-post inference. */
export async function assessCategorySemantic(
  input: DiscoverSemanticRequest,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<CategorySemanticResult> {
  if (!isLocalAiHost()) return { ok: false, error: "local_ai_unavailable" };
  const parsed = DiscoverSemanticRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_request" };
  const request = parsed.data;
  try {
    const response = await fetchImpl("/api/local-ai/assess-caption", {
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
    const result = DiscoverSemanticResponseSchema.safeParse(raw);
    if (!result.success) return { ok: false, error: "invalid_response" };
    const data = result.data;
    const urls = new Set(request.urls.map(canonicalDiscoverSemanticUrl));
    if (
      data.selection.provider !== request.provider ||
      data.selection.model !== request.model ||
      data.selection.effort !== request.effort ||
      data.selection.accountId !== request.accountId ||
      (data.status === "assessed" &&
        (new Set(data.semantics.map((record) => record.url)).size !== data.semantics.length ||
          data.semantics.some(
            (record) => !urls.has(record.url) || record.genreId !== request.genreId,
          ))) ||
      (request.allowModel === false && data.modelCalls !== 0)
    )
      return { ok: false, error: "invalid_response" };
    return { ok: true, data };
  } catch {
    return { ok: false, error: signal?.aborted ? "cancelled" : "assessment_failed" };
  }
}
