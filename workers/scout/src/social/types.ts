/**
 * Shared types of the social-analytics side of the Worker (connect the owner's accounts, pull the numbers
 * daily, serve them to the dashboard). The row types mirror the dashboard's zod schemas in `lib/domain.ts`
 * (`SocialSnapshotSchema`, `SocialPostStatSchema`, `DemographicSchema`, `SocialAccountSchema`): the Worker
 * cannot import them (it has no zod and its tsconfig only covers `src/`), so they are kept in step by hand
 * and by the mapping tests.
 */

export const SOCIAL_PLATFORMS = ["instagram", "threads", "youtube", "tiktok"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(x: unknown): x is SocialPlatform {
  return typeof x === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(x);
}

/** Error codes shared with the dashboard (README "Social analytics" → errors). */
export type SocialErrorCode =
  | "not_configured"
  | "not_connected"
  | "state_invalid"
  | "exchange_failed"
  | "token_expired"
  | "upstream"
  | "rate_limited"
  | "bad_request";

/** A typed failure the platform modules throw; `sync.ts` turns it into `status.lastError`. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SocialError";
  }
}

/* ---------- dashboard rows (lib/domain.ts) ---------- */

export type PostKind = "video" | "short" | "reel" | "story" | "thread" | "image" | "other";

/** `SocialSnapshotInput`: one platform on one Riyadh day. */
export interface SnapshotRow {
  platform: SocialPlatform;
  /** Riyadh day key YYYY-MM-DD. */
  day: string;
  followers: number;
  /** Views over the trailing 30 days as the platform reports them. */
  views30d?: number;
  avgStoryViews?: number;
  totalPosts?: number;
  avgVideoWatchTime?: number;
  avgShortsWatchTime?: number;
  note?: string;
}

/** `SocialPostStatInput`: one published post with its numbers. */
export interface PostRow {
  platform: SocialPlatform;
  postId: string;
  /** ISO timestamp with offset. */
  publishedAt: string;
  kind: PostKind;
  title?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** Seconds. */
  watchTimeS?: number;
  permalink?: string;
  thumbUrl?: string;
}

export type Gender = "male" | "female";
export type DemographicDimension = "gender" | "age" | "country" | "city";

/** `Demographic`: one slice of an audience breakdown on one day, `pct` in percent (0..100). */
export interface DemographicRow {
  platform: SocialPlatform;
  day: string;
  dimension: DemographicDimension;
  key: string;
  pct: number;
  gender?: Gender;
}

/** `SocialAccount`. */
export interface AccountRow {
  platform: SocialPlatform;
  /** Without the "@". */
  handle: string;
  url?: string;
}

/* ---------- tokens and status (KV) ---------- */

/** What `tokens:<platform>` holds once decrypted. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ISO; absent when the platform did not say (treated as "long-lived, refresh on schedule"). */
  expiresAt?: string;
  /** ISO: when this access token was issued (Instagram/Threads refresh by age). */
  issuedAt: string;
  userId?: string;
  scope?: string;
  /** Connected with the publishing scopes (the owner pressed "Allow auto-posting"). */
  canPublish?: boolean;
  /** Instagram: connected with the comment + message scopes ("Allow auto-replies", replies.ts). */
  canReply?: boolean;
}

/** What `status:<platform>` holds (never tokens). */
export interface StoredStatus {
  connectedAt?: string;
  handle?: string;
  url?: string;
  lastSyncAt?: string;
  lastError?: SocialErrorCode;
  /** The failure's own words (e.g. Meta's error message), clipped; shown next to `lastError`. */
  lastErrorDetail?: string;
  tokenExpiresAt?: string;
}

/** One entry of `GET /social/status`. */
export interface PlatformStatus extends StoredStatus {
  configured: boolean;
  connected: boolean;
  /** The stored token carries the publishing scopes (auto-posting works for this platform). */
  canPublish: boolean;
  /** TikTok only: independently granted upload and direct-publishing permissions. */
  canUpload?: boolean;
  canDirectPost?: boolean;
  /** Instagram: the token carries the comment + message scopes (auto-replies work). */
  canReply: boolean;
}

/** What one platform sync produced. */
export interface SyncResult {
  account: AccountRow;
  snapshot: SnapshotRow;
  posts: PostRow[];
  demographics: DemographicRow[];
}
