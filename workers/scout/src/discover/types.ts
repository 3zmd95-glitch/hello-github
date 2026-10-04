/**
 * Discover v2 (round 33, planning/tools/13-discover-search-v2.md): the request, the plan and the answer.
 * The answer's shape is MIRRORED in the dashboard's lib/discover.ts (hand-copied): change both together.
 */

import type { Platform, ScoutResult } from "../normalize";
import type { AiPlanMetadata, ExternalAiPlan } from "./ai-schema";
import type { Lang, LangText } from "./terms";

export type Intent = "examples" | "tutorials";
export type DiscoverTimeRange = "week" | "month" | "year";

export interface DiscoverRequest {
  q: string;
  mode?: "ai";
  /** Validated search plan from the owner's local subscription bridge. Only valid in AI mode. */
  aiPlan?: ExternalAiPlan;
  /** "Search exactly this": no dictionary, no editing words, nothing hidden. */
  exact?: boolean;
  /** A dictionary id the owner picked from "Not this?". */
  term?: string;
  /** The genre chip's main query per language (built-in or custom genre). */
  genreQuery?: { ar?: string; en?: string };
  /** "DaVinci Resolve": goes on the tutorial queries. */
  program?: string;
  timeRange?: DiscoverTimeRange;
  ytLength?: "short" | "long";
  /** Default: all three. */
  platforms?: Platform[];
  /** Claude's own queries (the connector only; never read from an HTTP body). At most 9 are used. */
  queries?: { q: string; platform: Platform; lang: Lang; intent: Intent }[];
}

export interface PlannedQuery {
  /** `<platform>-<intent>-<lang>` (Claude's own queries: `-<index>` added), unique in a plan. */
  id: string;
  platform: Platform;
  lang: Lang;
  intent: Intent;
  q: string;
  /** Asked once more with these words when the first answer holds no post (TikTok / Instagram only). */
  retryQ?: string;
}

export type Alternative = { termId: string; label: LangText } | { exact: true };

export interface SearchPlan {
  /** What was typed, trimmed. */
  topic: string;
  /** The dictionary id, else the normalized topic words: picks for "flash" and "Flash transition" meet. */
  topicKey: string;
  termId?: string;
  exact: boolean;
  understood: {
    termId?: string;
    label: LangText;
    exact: boolean;
    ai?: boolean;
  } & Partial<AiPlanMetadata>;
  timeRange?: DiscoverTimeRange;
  ytLength?: "short" | "long";
  alternatives: Alternative[];
  /** Normalized words / phrases; a card must mention one of them to be on-topic (empty: nothing is hidden). */
  topicWords: string[];
  /** The card must also mention an editing word (dictionary entries with `specific: false`). */
  needsEditingWord: boolean;
  /** Every group must match; synonyms inside one group are alternatives. */
  requiredGroups?: string[][];
  queries: PlannedQuery[];
}

export type Section = "example" | "tutorial";

export interface DiscoverItem extends ScoutResult {
  lang: Lang;
  section: Section;
  offTopic?: true;
  /** The creator's page (YouTube channel, TikTok / Instagram profile) when known. */
  profile?: string;
}

export interface Creator {
  platform: Platform;
  handle: string;
  url: string;
  /** On-topic cards of this creator in the answer (0: found as a profile page only). */
  count: number;
  views?: number;
}

export type PlatformError = "quota" | "auth" | "upstream" | "daily_cap" | "not_configured";
export type PlatformStatus =
  { ok: true; retried?: boolean; partial?: PlatformError } | { ok: false; error: PlatformError };

export interface DiscoverResponse {
  topicKey: string;
  understood: SearchPlan["understood"];
  alternatives: Alternative[];
  items: DiscoverItem[];
  creators: Creator[];
  platforms: Partial<Record<Platform, PlatformStatus>>;
  cost: { tavily: number; youtubeSearch: number };
  cached: boolean;
  /**
   * True exactly when the answer may be kept in KV: every query answered (a key that is not set never will, so
   * it does not count against it) and at least one card was found. A KV hit is complete. The dashboard keeps
   * only complete answers too: a platform's status alone cannot say that one of its queries failed.
   */
  complete: boolean;
}
