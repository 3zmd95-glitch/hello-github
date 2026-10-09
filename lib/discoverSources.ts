import type { DiscoverItem } from "./discover";
import { canonicalRefUrl } from "./research";
import type { InstagramSource } from "../workers/scout/src/instagramSource";
import type { TikTokSource } from "../workers/scout/src/tiktokSource";
import { isLocalAiHost } from "./localAi";
import { z } from "zod";

const TikTokSourceSchema = z.object({
  status: z.enum(["available", "unavailable", "unknown"]),
  url: z
    .string()
    .url()
    .refine((value) => {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        ["www.tiktok.com", "tiktok.com"].includes(u.hostname) &&
        !u.port &&
        !u.username &&
        !u.password &&
        /^\/@[\w.-]+\/video\/\d{15,22}$/.test(u.pathname)
      );
    }),
  observedAt: z.string().datetime().nullable(),
  provenance: z.literal("tiktok-public-page"),
  caption: z.string().max(4000).optional(),
  author: z.string().max(200).optional(),
  likes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  views: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  published: z.string().datetime().optional(),
  thumbnailUrl: z
    .string()
    .url()
    .refine((value) => {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        u.hostname.endsWith(".tiktokcdn.com") &&
        !u.port &&
        !u.username &&
        !u.password
      );
    })
    .optional(),
});

export async function localTikTokSource(
  url: string,
  signal?: AbortSignal,
): Promise<TikTokSource | null> {
  if (!isLocalAiHost()) return null;
  try {
    const response = await fetch(`/api/local-ai/tiktok-source?url=${encodeURIComponent(url)}`, {
      headers: { "X-Local-AI": "1" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const parsed = TikTokSourceSchema.safeParse(await response.json());
    return parsed.success && canonicalRefUrl("tt", parsed.data.url) === canonicalRefUrl("tt", url)
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function applyTikTokEvidence(item: DiscoverItem, source: TikTokSource | null): DiscoverItem {
  if (
    item.platform !== "tt" ||
    !source ||
    source.status === "unknown" ||
    !source.observedAt ||
    canonicalRefUrl("tt", source.url) !== canonicalRefUrl("tt", item.url)
  )
    return item;
  if (
    item.evidence?.source === "tiktok-public-page" &&
    Date.parse(item.evidence.observedAt) > Date.parse(source.observedAt)
  )
    return item;
  if (
    item.evidence?.source === "tiktok-public-page" &&
    item.evidence.observedAt === source.observedAt
  )
    return item;
  if (source.status === "unavailable")
    return {
      ...item,
      evidence: {
        source: "tiktok-public-page",
        observedAt: source.observedAt,
        availability: "unavailable",
      },
    };
  return {
    ...item,
    title: source.caption?.slice(0, 160) || source.author || item.handle,
    snippet: source.caption ?? "",
    handle: source.author || item.handle,
    ...(source.published ? { published: source.published } : {}),
    ...(source.thumbnailUrl ? { thumb: source.thumbnailUrl } : {}),
    stats:
      source.likes === undefined && source.views === undefined
        ? undefined
        : {
            ...(source.likes !== undefined ? { likes: source.likes } : {}),
            ...(source.views !== undefined ? { views: source.views } : {}),
          },
    evidence: {
      source: "tiktok-public-page",
      observedAt: source.observedAt,
      availability: "available",
      caption: source.caption ?? "",
      author: source.author,
      ...(source.likes !== undefined ? { likes: source.likes } : {}),
      ...(source.views !== undefined ? { views: source.views } : {}),
      ...(source.published ? { published: source.published } : {}),
    },
  };
}

/** Authentic caption/counts replace indexed claims; absence is never promoted into verification. */
export function applyInstagramEvidence(
  item: DiscoverItem,
  source: InstagramSource | null,
): DiscoverItem {
  if (
    item.platform !== "ig" ||
    source?.status !== "available" ||
    !source.observedAt ||
    canonicalRefUrl("ig", source.url) !== canonicalRefUrl("ig", item.url)
  )
    return item;
  if (
    item.evidence?.source === "instagram-public-embed" &&
    Date.parse(item.evidence.observedAt) > Date.parse(source.observedAt)
  )
    return item;
  if (
    item.evidence?.source === "instagram-public-embed" &&
    item.evidence.observedAt === source.observedAt &&
    item.evidence.caption === source.description &&
    item.evidence.likes === source.likes &&
    item.evidence.author === source.author
  )
    return item;
  return {
    ...item,
    title: source.description.slice(0, 160) || source.author || item.handle,
    snippet: source.description,
    handle: source.author || item.handle,
    ...(source.thumbnailUrl ? { thumb: source.thumbnailUrl } : {}),
    // A refreshed source never inherits a search snippet's unverified counts.
    stats: source.likes === undefined ? undefined : { likes: source.likes },
    evidence: {
      source: "instagram-public-embed",
      observedAt: source.observedAt,
      caption: source.description,
      author: source.author,
      ...(source.likes !== undefined ? { likes: source.likes } : {}),
    },
  };
}
