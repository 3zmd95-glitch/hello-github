import type { Genre } from "./domain";
import {
  discoverRequestFrom,
  discoverSearch,
  type DiscoverPlatform,
  type DiscoverRequest,
  type DiscoverResult,
} from "./discover";
import type { ScoutConfig, ScoutSearchOpts } from "./scoutClient";

/** The original evergreen examples + tutorials request, including its original cache identity.
 * No date/exact/AI override: this is separate from recent monthly expansion. */
export function categoryRefillRequest(
  genre: Genre,
  platform?: DiscoverPlatform,
): DiscoverRequest | null {
  const request = discoverRequestFrom({ base: "", genre, recency: "any", length: "any" });
  return request ? { ...request, ...(platform ? { platforms: [platform] } : {}) } : null;
}

/** Upper bounds on provider search requests when the existing cache misses. Tavily billing
 * credits can differ from lookup count; these are not credit prices or a quota override.
 * English baseline: two queries per platform, plus at most two shared IG/TikTok retries. */
export function categoryRefillCost(platform?: DiscoverPlatform): {
  tavilyMax: number;
  youtubeSearchMax: number;
} {
  return {
    tavilyMax: platform === "yt" ? 0 : platform ? 4 : 6,
    youtubeSearchMax: !platform || platform === "yt" ? 2 : 0,
  };
}

/** Run only after a deliberate refill action. The normal Worker quotas/retry limits still apply.
 * A cached result can succeed even when new provider searches cannot; never pre-block by usage.
 * No forced refresh and no client retry loop, including after partial or quota responses. */
export async function refillCategory(
  config: ScoutConfig,
  genre: Genre,
  options: Omit<ScoutSearchOpts, "force"> & { platform?: DiscoverPlatform } = {},
): Promise<DiscoverResult> {
  const { platform, ...transport } = options;
  const request = categoryRefillRequest(genre, platform);
  if (!request) return { ok: false, error: { type: "upstream" } };
  return discoverSearch(config, request, { ...transport, force: false });
}
