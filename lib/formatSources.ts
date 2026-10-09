import type { DiscoverAnswer } from "./discover";
import {
  formatItemMatches,
  formatVisualEvidence,
  withFormatItems,
  type EditFormat,
} from "./editFormats";
import {
  assessFormatSource,
  formatVerificationTarget,
  FormatVerificationResponseSchema,
  InstagramSourceSchema,
} from "./formatVerification";
import { isLocalAiHost, type AiSelection } from "./localAi";
import { canonicalRefUrl } from "./research";
import type { InstagramSource } from "../workers/scout/src/instagramSource";

export const sourceKey = (url: string) => canonicalRefUrl("ig", url);

/** Public metadata only. Neither browser credentials nor indexed excerpts are sent to this reader. */
export async function localInstagramSource(
  url: string,
  signal?: AbortSignal,
): Promise<InstagramSource | null> {
  if (!isLocalAiHost()) return null;
  try {
    const response = await fetch(`/api/local-ai/instagram-source?url=${encodeURIComponent(url)}`, {
      headers: { "X-Local-AI": "1" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const parsed = InstagramSourceSchema.safeParse(await response.json());
    return parsed.success && sourceKey(parsed.data.url) === sourceKey(url) ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function inspectFormatPreview(
  selection: AiSelection,
  format: EditFormat,
  url: string,
  lang: "ar" | "en",
  signal?: AbortSignal,
  mode: "preview" | "frames" = "frames",
) {
  if (!isLocalAiHost()) return { ok: false as const, error: "local_ai_unavailable" };
  try {
    const response = await fetch("/api/local-ai/verify-format", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Local-AI": "1" },
      body: JSON.stringify({
        ...selection,
        format: formatVerificationTarget(format),
        url,
        lang,
        mode,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(190_000)])
        : AbortSignal.timeout(190_000),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      return { ok: false as const, error: "local_ai_unavailable" };
    const raw = await response.json();
    if (!response.ok)
      return {
        ok: false as const,
        error: typeof raw?.error === "string" ? raw.error : "verification_failed",
      };
    const parsed = FormatVerificationResponseSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.provider !== selection.provider ||
      parsed.data.model !== selection.model ||
      parsed.data.effort !== selection.effort ||
      parsed.data.verification.formatKey !== format.key ||
      sourceKey(parsed.data.verification.url) !== sourceKey(url) ||
      sourceKey(parsed.data.verification.source.url) !== sourceKey(url) ||
      parsed.data.verification.basis !==
        (mode === "frames" ? "source-frames-and-metadata" : "source-thumbnail-and-metadata")
    )
      return { ok: false as const, error: "invalid_response" };
    return { ok: true as const, data: parsed.data };
  } catch {
    return { ok: false as const, error: "verification_failed" };
  }
}

export type FormatSources = Record<string, InstagramSource | null>;

/** Source metadata supersedes a search excerpt. Preserve the raw answer/cache and its original retrieval cost. */
export function applyFormatSources(
  answer: DiscoverAnswer,
  format: EditFormat,
  intent: "examples" | "tutorials",
  sources: FormatSources,
) {
  const excluded: { url: string; title: string; reason: "audio" | "caption" }[] = [];
  const items = answer.items.filter((item) => {
    const indexedMatch = formatItemMatches(item, format, intent);
    const source = item.platform === "ig" ? sources[sourceKey(item.url)] : undefined;
    if (!source || source.status !== "available") return indexedMatch;
    const audio = assessFormatSource(formatVerificationTarget(format), source).audio;
    if (audio === "mismatch") {
      if (indexedMatch)
        excluded.push({ url: item.url, title: source.title || item.title, reason: "audio" });
      return false;
    }
    const knownReviewed =
      intent === "examples" &&
      format.source === "reviewed-reference" &&
      format.samples.some(
        (sample) => sample.platform === "ig" && sourceKey(sample.url) === sourceKey(item.url),
      );
    const visual = formatVisualEvidence(source.description, format, intent);
    const sourceMatch =
      knownReviewed ||
      (visual &&
        (audio === "match" ||
          formatItemMatches({ ...item, title: "", snippet: source.description }, format, intent)));
    if (!sourceMatch && indexedMatch)
      excluded.push({ url: item.url, title: source.title || item.title, reason: "caption" });
    return sourceMatch;
  });
  // Reuse the creator recount, without changing the accepted posts' original titles or cached answer.
  return { answer: withFormatItems(answer, items), excluded };
}
