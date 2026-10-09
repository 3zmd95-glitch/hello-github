import type { Genre } from "./domain";
import {
  discoverSearch,
  type DiscoverAnswer,
  type DiscoverPlatform,
  type DiscoverPlatformError,
  type DiscoverResult,
} from "./discover";
import { discoverPostKey } from "./discoverFeed";
import type { ScoutConfig, ScoutSearchOpts } from "./scoutClient";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";

export const CATEGORY_EXPANSION_ROUNDS = 3;

export interface DiscoverSourceDiagnostic {
  platform: DiscoverPlatform;
  state: "found" | "empty" | "partial" | "error" | "unknown";
  /** Distinct posts in this answer, before the local evidence/relevance filter; not qualified feed size. */
  returned: number;
  error?: DiscoverPlatformError;
  cached: boolean;
}

/** Preserve the provider's explicit outcome, independent of visible cards or account-usage counters.
 * An empty successful response may reflect indexing/date filtering, never proof that no posts exist. */
export function discoverSourceDiagnostics(
  answer: DiscoverAnswer,
  requestedPlatforms: readonly DiscoverPlatform[] = ["ig", "tt", "yt"],
): DiscoverSourceDiagnostic[] {
  return [...new Set(requestedPlatforms)].map((platform) => {
    const status = answer.platforms[platform];
    const returned = new Set(
      answer.items
        .filter((item) => item.platform === platform)
        .map((item) => discoverPostKey(platform, item.url))
        .filter((url): url is string => !!url),
    ).size;
    return {
      platform,
      returned,
      cached: answer.cached,
      ...(!status
        ? { state: "unknown" as const }
        : !status.ok
          ? { state: "error" as const, error: status.error }
          : status.partial
            ? { state: "partial" as const, error: status.partial }
            : { state: returned > 0 ? ("found" as const) : ("empty" as const) }),
    };
  });
}

/** Discovery wording deliberately differs from the initial technique/example and retry queries.
 * These find candidate edits; native counts, source captions and the feed policy still decide admission. */
const EXPANSIONS: Readonly<Record<string, readonly [string, string, string]>> = {
  cars: ["car edit", "automotive cinematography reel", "car commercial visual effects"],
  food: ["food commercial edit", "restaurant cinematic reel", "food product video transitions"],
  anime: ["anime AMV edit", "anime manga motion design edit", "anime character transition edit"],
  travel: ["travel reel edit", "travel film montage", "travel video motion transitions"],
  football: [
    "football player edit",
    "soccer motion graphics montage",
    "football visual effects edit",
  ],
  coffee: ["coffee product video", "barista cinematic reel", "coffee edit transitions"],
  perfume: [
    "perfume product film",
    "fragrance bottle cinematic reel",
    "perfume visual effects edit",
  ],
  camping: ["camping outdoor film", "desert cinematic reel", "camping camera movement film"],
  fashion: ["fashion transition reel", "outfit match cut", "fashion campaign visual effects"],
  gaming: ["gaming fragmovie edit", "valorant montage edit", "gaming cinematic motion graphics"],
  weddings: ["wedding storytelling film", "bridal cinematic reel", "wedding film sound design"],
  gym: ["gym fitness edit", "workout cinematic reel", "fitness commercial motion transitions"],
};

/** One explicit query per selected platform. Ranking supplies the category/craft gate afterwards. */
export function categoryExpansionQuery(genre: Genre, round: number): string | null {
  if (!Number.isInteger(round) || round < 0 || round >= CATEGORY_EXPANSION_ROUNDS) return null;
  const subject = CATEGORY_PROFILES[genre.id]?.subject.en ?? genre.name.en;
  const words = EXPANSIONS[genre.id] ?? [
    `${subject} reel edit`,
    `${subject} creative video montage`,
    `${subject} visual effects edit`,
  ];
  return words[round]?.trim().slice(0, 200) || null;
}

export async function expandCategory(
  config: ScoutConfig,
  genre: Genre,
  options: ScoutSearchOpts & { round: number; platform?: DiscoverPlatform },
): Promise<DiscoverResult> {
  const query = categoryExpansionQuery(genre, options.round);
  if (!query) return { ok: false, error: { type: "upstream" } };
  return discoverSearch(
    config,
    {
      q: query,
      exact: true,
      lang: "en",
      // A month name in the text is not a date filter. This reaches both provider filtering and
      // the Worker's known-post-date check, while unknown dates remain explicitly unverified.
      timeRange: "month",
      ...(options.platform ? { platforms: [options.platform] } : {}),
    },
    options,
  );
}
